"use strict";

const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..", "..");
const {
  configureBatchLlmDefaults,
  getMissingKeyMessage,
  hasConfiguredLlmKey
} = require("./llm_env");
const MODE = process.env.SIM_MODE || "layered_newflow_summary";
const SOURCE_RUN = process.env.SOURCE_RUN || "sim_layered_newflow_2026-07-10T23-54-52-761Z";
const RUN_ID_PREFIX = process.env.RUN_ID_PREFIX || "sim_layered_newflow_summary_v2";
const ROSTER_PATH = path.join(ROOT, "data", "persona_sim_logs", SOURCE_RUN, "students_summary.csv");

const STRATEGIES = [
  { grid_id: "ToB_Differentiation_Elder", architecture: "Experience" },
  { grid_id: "ToB_Differentiation_Adult", architecture: "Hybrid" },
  { grid_id: "ToB_Differentiation_Child", architecture: "Experience" },
  { grid_id: "ToB_Cost_Elder", architecture: "Function" },
  { grid_id: "ToB_Cost_Adult", architecture: "Function" },
  { grid_id: "ToB_Cost_Child", architecture: "Hybrid" },
  { grid_id: "ToC_Differentiation_Elder", architecture: "Experience" },
  { grid_id: "ToC_Differentiation_Adult", architecture: "Experience" },
  { grid_id: "ToC_Differentiation_Child", architecture: "Experience" },
  { grid_id: "ToC_Cost_Elder", architecture: "Function" },
  { grid_id: "ToC_Cost_Adult", architecture: "Function" },
  { grid_id: "ToC_Cost_Child", architecture: "Hybrid" }
];

function loadLocalEnvFile() {
  const envPath = path.join(ROOT, ".env");
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if ((value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!Object.prototype.hasOwnProperty.call(process.env, key)) process.env[key] = value;
  }
}

function splitCsvLine(line) {
  const cells = [];
  let current = "";
  let inQuotes = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === "\"") {
      if (inQuotes && line[index + 1] === "\"") {
        current += "\"";
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === "," && !inQuotes) {
      cells.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  cells.push(current);
  return cells;
}

function parseCsv(text) {
  const lines = String(text || "").split(/\r?\n/).filter(Boolean);
  const headers = splitCsvLine(lines[0] || "");
  return lines.slice(1).map((line) => {
    const cells = splitCsvLine(line);
    return Object.fromEntries(headers.map((header, index) => [header, cells[index] || ""]));
  });
}

function parseMaybeJson(value) {
  try {
    return value ? JSON.parse(String(value)) : null;
  } catch (_) {
    return null;
  }
}

function personaIdByLabel(label, personas) {
  return Object.values(personas || {}).find((persona) => persona.label === label)?.id || null;
}

function buildStudent(row, personas) {
  const label = String(row.persona || "").trim();
  const personaId = personaIdByLabel(label, personas);
  const base = personaId ? personas[personaId] || {} : {};
  return {
    ...base,
    id: personaId,
    personaId,
    label,
    name: String(row.name || "").trim(),
    gender: String(row.gender || "").trim(),
    mbti: String(row.mbti || "").trim(),
    age: Number(row.age || 0),
    education: String(row.education || "").trim(),
    overseas: { hasOverseas: String(row.has_overseas || "").trim().toLowerCase() === "true" },
    industry: String(row.industry || base.industry || "").trim(),
    seedMemory: parseMaybeJson(row.seed_memory_json),
    classroomProfile: parseMaybeJson(row.classroom_profile_json)
  };
}

function loadRoster(personas) {
  const rows = parseCsv(fs.readFileSync(ROSTER_PATH, "utf8"));
  if (rows.length !== 72) throw new Error(`expected 72 roster rows, got ${rows.length}`);
  const teams = Array.from({ length: 12 }, () => []);
  for (const row of rows) {
    const teamIndex = Number(row.team_index);
    const memberIndex = Number(row.member_index);
    teams[teamIndex][memberIndex] = buildStudent(row, personas);
  }
  teams.forEach((team, index) => {
    if (team.filter(Boolean).length !== 6) throw new Error(`roster team ${index} is incomplete`);
  });
  return teams;
}

async function configureSummarySession(baseUrl) {
  const code = String(process.env.ADMIN_CODE || process.env.TEACHER_CODE || "").trim();
  if (!code) throw new Error("ADMIN_CODE or TEACHER_CODE is required");
  const response = await fetch(`${baseUrl}/api/teacher/session-config`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-teacher-code": code },
    body: JSON.stringify({
      session_id: "default",
      config: { interview_mode: "summary", hold_before_r2: false, reveal_r1_results: true }
    })
  });
  const text = await response.text();
  const body = text ? JSON.parse(text) : {};
  if (!response.ok || body.ok === false) throw new Error(`summary session config failed: ${text}`);
}

async function main() {
  loadLocalEnvFile();
  process.env.STRICT_DEEPSEEK = "1";
  configureBatchLlmDefaults();
  if (!hasConfiguredLlmKey()) throw new Error(getMissingKeyMessage());

  const { ApiClient } = require("./api_client");
  const { DataExporter } = require("./data_export");
  const { SimLogger } = require("./logger");
  const { PERSONAS } = require("./persona_pool");
  const { generateReport } = require("./report");
  const { runTeam } = require("./team_runner");

  const baseUrl = process.env.BASE_URL || "http://127.0.0.1:8787";
  const logger = new SimLogger();
  const controlApi = new ApiClient(baseUrl, { logger, timeoutMs: 120000 });
  const serverHealth = await controlApi.health();
  await configureSummarySession(baseUrl);
  const roster = loadRoster(PERSONAS);
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const runId = `${RUN_ID_PREFIX}_${timestamp}`;
  const logDir = path.join(ROOT, "data", "persona_sim_logs", runId);
  fs.mkdirSync(logDir, { recursive: true });
  const results = [];
  const startIndex = Math.max(0, Math.min(STRATEGIES.length, Number(process.env.START_INDEX || 0)));
  const endIndex = Math.max(startIndex, Math.min(
    STRATEGIES.length,
    Number(process.env.END_INDEX || STRATEGIES.length)
  ));

  for (let teamIndex = startIndex; teamIndex < endIndex; teamIndex += 1) {
    const strategy = STRATEGIES[teamIndex];
    let result = null;
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      console.log(`[layered_summary_v2] ${teamIndex + 1}/12 ${strategy.grid_id} / ${strategy.architecture} attempt=${attempt}`);
      const api = new ApiClient(baseUrl, { logger, timeoutMs: 120000 });
      result = await runTeam(teamIndex, 6, api, logger, console, {
        logLevel: "normal",
        strictDeepSeek: true,
        students: roster[teamIndex],
        teamStrategy: strategy,
        mode: MODE
      });
      if (result?.status === "passed") break;
      console.warn(`[layered_summary_v2] retrying failed team ${teamIndex + 1}: ${result?.errors?.[0]?.message || "unknown error"}`);
    }
    results.push({ status: "fulfilled", value: result });
    logger.exportByTeam(path.join(logDir, "by_team"));
    logger.exportAll(path.join(logDir, "all_entries.json"));
  }

  const trackers = results.map((item) => item.value?.tracker).filter(Boolean);
  const failedTeams = results.filter((item) => item.value?.status !== "passed");
  if (failedTeams.length > 0) {
    throw new Error(`strict layered summary failed after retry: ${failedTeams.length} team(s)`);
  }
  const exporter = new DataExporter(runId, logDir, logger, {
    mode: MODE,
    strict: true,
    serverHealth
  });
  const exportSummary = await exporter.exportAll(trackers);
  generateReport(results, path.join(logDir, "report.json"), {
    runId,
    baseUrl,
    mode: MODE,
    strictDeepSeek: true,
    rosterPath: ROSTER_PATH,
    sourceRun: SOURCE_RUN,
    strategies: STRATEGIES,
    exportSummary
  });
  logger.exportByTeam(path.join(logDir, "by_team"));
  logger.exportAll(path.join(logDir, "all_entries.json"));

  const profitable = trackers.filter((tracker) => tracker.team.r2_is_profitable === true).length;
  console.log(`[layered_summary_v2] output=${logDir}`);
  console.log(`[layered_summary_v2] profitable=${profitable}/${trackers.length}`);
}

main().catch((error) => {
  console.error(error.stack || error.message || String(error));
  process.exitCode = 1;
});
