"use strict";

const fs = require("node:fs");
const path = require("node:path");

const LOG_DIR = path.join(__dirname, "..", "..", "data", "llm_logs");
const LOG_ENABLED = process.env.LLM_LOG !== "0";

let buffer = [];
let timer = null;
let hooksRegistered = false;

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
  buffer.push({
    timestamp: new Date().toISOString(),
    caller: entry.caller || "unknown",
    teamId: entry.teamId || null,
    memberId: entry.memberId || null,
    personaId: entry.personaId || null,
    personaLabel: entry.personaLabel || null,
    model: entry.model || process.env.DEEPSEEK_MODEL || "deepseek-chat",
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
