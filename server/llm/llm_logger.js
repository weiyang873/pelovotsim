"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { getModel } = require("./modelRegistry");

const LOG_DIR = path.join(__dirname, "..", "..", "data", "llm_logs");
const LOG_ENABLED = process.env.LLM_LOG !== "0";
const CALLER_ROLE_PREFIXES = [
  ["personaGenerator.", "persona_generator"],
  ["vpCoach.", "vp_coach"],
  ["interviewCoach.", "interview_coach"],
  ["tagExtractor.", "tag_extractor"],
  ["requirementBuilder.", "requirement_builder"],
  ["vpScorer.", "vp_scorer"],
  ["vpEmbeddingScorer.", "vp_embedding_scorer"],
  ["vpWordScorer.", "vp_word_scorer"]
];

let buffer = [];
let timer = null;
let hooksRegistered = false;

function inferRoleFromCaller(caller) {
  const text = String(caller || "");
  const matched = CALLER_ROLE_PREFIXES.find(([prefix]) => text.startsWith(prefix));
  return matched ? matched[1] : null;
}

function resolveLogRole(entry) {
  const explicitRole = String(entry.role || "").trim();
  return explicitRole || inferRoleFromCaller(entry.caller);
}

function resolveLogModel(entry, role) {
  const explicitModel = String(entry.model || "").trim();
  if (explicitModel) return explicitModel;
  if (!role) return null;
  return getModel(role);
}

function currentLogFile() {
  return path.join(LOG_DIR, `llm_${new Date().toISOString().slice(0, 10)}.jsonl`);
}

function scheduleFlush() {
  if (timer) return;
  timer = setTimeout(() => {
    flushAll();
  }, 5000);
  if (typeof timer.unref === "function") timer.unref();
}

function logLLMCall(entry) {
  if (!LOG_ENABLED) return;
  const role = resolveLogRole(entry);
  buffer.push({
    timestamp: new Date().toISOString(),
    caller: entry.caller || "unknown",
    role,
    teamId: entry.teamId || null,
    memberId: entry.memberId || null,
    personaId: entry.personaId || null,
    personaLabel: entry.personaLabel || null,
    model: resolveLogModel(entry, role),
    messages: Array.isArray(entry.messages) ? entry.messages : [],
    completion: entry.completion ?? null,
    tokens: entry.tokens || null,
    durationMs: entry.durationMs ?? null,
    error: entry.error || null
  });
  if (buffer.length >= 10) {
    flushAll();
    return;
  }
  scheduleFlush();
}

async function withLlmLogging(meta, runner) {
  const startedAt = Date.now();
  let completion = null;
  let tokens = null;
  let error = null;
  try {
    const result = await runner();
    completion = typeof result === "string" ? result : (result?.content ?? null);
    tokens = result?.usage || null;
    return result;
  } catch (err) {
    error = String(err.message || err);
    throw err;
  } finally {
    logLLMCall({
      ...meta,
      completion,
      tokens,
      durationMs: Date.now() - startedAt,
      error
    });
  }
}

function flushAll() {
  if (!LOG_ENABLED) return;
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  if (buffer.length === 0) return;
  fs.mkdirSync(LOG_DIR, { recursive: true });
  const lines = buffer.map((entry) => JSON.stringify(entry)).join("\n") + "\n";
  fs.appendFileSync(currentLogFile(), lines);
  buffer = [];
}

function registerExitHooks() {
  if (hooksRegistered) return;
  hooksRegistered = true;
  process.on("beforeExit", flushAll);
  process.on("exit", flushAll);
  process.on("SIGINT", flushAll);
  process.on("SIGTERM", flushAll);
}

registerExitHooks();

function readLogEntries(date) {
  const safeDate = String(date || new Date().toISOString().slice(0, 10)).trim();
  const filePath = path.join(LOG_DIR, `llm_${safeDate}.jsonl`);
  if (!fs.existsSync(filePath)) return [];
  const raw = fs.readFileSync(filePath, "utf8");
  return raw
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

module.exports = {
  logLLMCall,
  withLlmLogging,
  flushAll,
  readLogEntries
};
