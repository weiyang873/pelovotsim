"use strict";

const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..", "..");
const BASELINE_CSV = path.join(ROOT, "data/persona_sim_logs/2026-04-05T02-36-24-020Z/teams_summary.csv");

const REPLAY_STRATEGIES = [
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
  const content = fs.readFileSync(envPath, "utf8");
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if ((value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!Object.prototype.hasOwnProperty.call(process.env, key)) {
      process.env[key] = value;
    }
  }
}

function splitCsvLine(line) {
  const out = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === "\"") {
      if (inQuotes && line[i + 1] === "\"") {
        current += "\"";
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === "," && !inQuotes) {
      out.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  out.push(current);
  return out;
}

function parseCsv(text) {
  const lines = String(text || "").split(/\r?\n/).filter(Boolean);
  if (!lines.length) return [];
  const headers = splitCsvLine(lines[0]);
  return lines.slice(1).map((line) => {
    const cells = splitCsvLine(line);
    const row = {};
    headers.forEach((header, index) => {
      row[header] = cells[index] ?? "";
    });
    return row;
  });
}

function csvEscape(value) {
  const text = value == null ? "" : String(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, "\"\"")}"` : text;
}

function writeCsv(filePath, rows) {
  const headers = [
    "grid",
    "arch",
    "april_profit",
    "april_profit_x0_3",
    "current_profit",
    "delta_vs_scaled_april",
    "current_profitable",
    "price",
    "pricing_reason",
    "team_id"
  ];
  const lines = [headers.join(",")];
  rows.forEach((row) => {
    lines.push(headers.map((header) => csvEscape(row[header])).join(","));
  });
  fs.writeFileSync(filePath, `${lines.join("\n")}\n`);
}

function readBaseline() {
  const rows = parseCsv(fs.readFileSync(BASELINE_CSV, "utf8"));
  const out = new Map();
  rows.forEach((row) => {
    const grid = String(row.grid || "").trim();
    if (!grid) return;
    out.set(grid, {
      grid,
      arch: row.arch,
      profit: Number(row.r2_profit)
    });
  });
  return out;
}

function extractPricingReason(logger, teamId) {
  const entries = Array.isArray(logger.entries) ? logger.entries : [];
  const found = entries
    .filter((entry) => entry.type === "student_llm" && entry.teamId === teamId && entry.step === "R2.7_generate_price")
    .slice(-1)[0];
  const completion = String(found?.completion || "").trim();
  if (!completion) return "";
  const jsonText = (completion.match(/\{[\s\S]*\}/) || [])[0] || completion;
  try {
    const parsed = JSON.parse(jsonText);
    return String(parsed.reason || "").trim();
  } catch (_) {
    return completion.replace(/\s+/g, " ").slice(0, 240);
  }
}

function buildComparisonRows(trackers, logger) {
  const baseline = readBaseline();
  return trackers.map((tracker) => {
    const grid = String(tracker.team.finalGrid || "").trim();
    const april = baseline.get(grid) || {};
    const aprilProfit = Number(april.profit);
    const currentProfit = Number(tracker.team.r2_profit);
    return {
      grid,
      arch: tracker.team.finalArch,
      april_profit: Number.isFinite(aprilProfit) ? Math.round(aprilProfit) : "",
      april_profit_x0_3: Number.isFinite(aprilProfit) ? Math.round(aprilProfit * 0.3) : "",
      current_profit: Number.isFinite(currentProfit) ? Math.round(currentProfit) : "",
      delta_vs_scaled_april: Number.isFinite(aprilProfit) && Number.isFinite(currentProfit)
        ? Math.round(currentProfit - aprilProfit * 0.3)
        : "",
      current_profitable: tracker.team.r2_is_profitable === true,
      price: tracker.team.r2_finalPrice,
      pricing_reason: extractPricingReason(logger, tracker.teamId),
      team_id: tracker.teamId
    };
  });
}

function writeComparisonMarkdown(filePath, rows, meta) {
  const lines = [
    "# April Layered Replay Comparison",
    "",
    `- run_id: ${meta.runId}`,
    `- baseline: ${BASELINE_CSV}`,
    `- teams: ${rows.length}`,
    `- profitable: ${rows.filter((row) => row.current_profitable === true).length}/${rows.length}`,
    "",
    "| grid | arch | 4月利润×0.3 | 本次利润 | delta | price | reason |",
    "|---|---:|---:|---:|---:|---:|---|"
  ];
  rows.forEach((row) => {
    lines.push([
      row.grid,
      row.arch,
      row.april_profit_x0_3,
      row.current_profit,
      row.delta_vs_scaled_april,
      row.price,
      String(row.pricing_reason || "").replace(/\|/g, " / ")
    ].join(" | ").replace(/^/, "| ").replace(/$/, " |"));
  });
  fs.writeFileSync(filePath, `${lines.join("\n")}\n`);
}

async function configureDefaultSessionLive(baseUrl) {
  const code = String(process.env.ADMIN_CODE || process.env.TEACHER_CODE || "").trim();
  if (!code) throw new Error("ADMIN_CODE or TEACHER_CODE is required");
  const res = await fetch(`${baseUrl}/api/teacher/session-config`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-teacher-code": code },
    body: JSON.stringify({
      session_id: "default",
      config: {
        interview_mode: "live",
        hold_before_r2: false,
        reveal_r1_results: true
      }
    })
  });
  const text = await res.text();
  const body = text ? JSON.parse(text) : {};
  if (!res.ok || body.ok === false) {
    throw new Error(`session-config live failed: ${text}`);
  }
  return body;
}

async function main() {
  loadLocalEnvFile();
  const { ApiClient } = require("./api_client");
  const { DataExporter } = require("./data_export");
  const { SimLogger } = require("./logger");
  const { initializeAllStudents } = require("./persona_pool");
  const { generateReport } = require("./report");
  const { runTeam } = require("./team_runner");

  const baseUrl = process.env.BASE_URL || "http://127.0.0.1:8787";
  process.env.STRICT_DEEPSEEK = "1";
  process.env.SIM_STRUCTURED_VP_DRAFT = "1";
  if (process.env.DEEPSEEK_DISABLE_THINKING === undefined) {
    process.env.DEEPSEEK_DISABLE_THINKING = "1";
  }
  if (process.env.LLM_MODEL_OVERRIDE === undefined) {
    process.env.LLM_MODEL_OVERRIDE = process.env.DEEPSEEK_MODEL || "deepseek-v4-flash";
  }
  const teamSize = 6;
  const logger = new SimLogger();
  const apiTimeoutMs = 600000;
  const api = new ApiClient(baseUrl, { logger, timeoutMs: apiTimeoutMs });
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const runId = `sim_replay_april_${timestamp}`;
  const logDir = path.join(ROOT, "data", "persona_sim_logs", runId);
  fs.mkdirSync(logDir, { recursive: true });

  if (!process.env.DEEPSEEK_API_KEY) {
    throw new Error("STRICT_DEEPSEEK=1 but DEEPSEEK_API_KEY is missing");
  }

  await api.health();
  await configureDefaultSessionLive(baseUrl);
  const allStudents = await initializeAllStudents();
  const results = [];

  for (let teamIndex = 0; teamIndex < REPLAY_STRATEGIES.length; teamIndex += 1) {
    const strategy = REPLAY_STRATEGIES[teamIndex];
    console.log(`[april_replay] ${teamIndex + 1}/${REPLAY_STRATEGIES.length} ${strategy.grid_id} / ${strategy.architecture}`);
    const studentPool = allStudents[teamIndex % allStudents.length] || [];
    const teamStudents = studentPool.slice(0, teamSize);
    const teamApi = new ApiClient(baseUrl, { logger, timeoutMs: apiTimeoutMs });
    const result = await runTeam(teamIndex, teamSize, teamApi, logger, console, {
      logLevel: "normal",
      strictDeepSeek: true,
      students: teamStudents,
      teamStrategy: strategy
    });
    results.push({ status: "fulfilled", value: result });
    logger.exportByTeam(path.join(logDir, "by_team"));
    logger.exportAll(path.join(logDir, "all_entries.json"));
  }

  const trackers = results.map((item) => item.value.tracker).filter(Boolean);
  const exporter = new DataExporter(runId, logDir, logger);
  const exportSummary = await exporter.exportAll(trackers);
  const reportPath = path.join(logDir, "report.json");
  generateReport(results, reportPath, {
    baseUrl,
    numTeams: REPLAY_STRATEGIES.length,
    teamSize,
    concurrency: 1,
    logLevel: "normal",
    strictDeepSeek: true,
    rosterPath: "",
    logDir,
    exportSummary,
    teacher: { enabled: false, reason: "april replay one-off runner" }
  });

  const comparisonRows = buildComparisonRows(trackers, logger);
  writeCsv(path.join(logDir, "april_replay_comparison.csv"), comparisonRows);
  writeComparisonMarkdown(path.join(logDir, "april_replay_comparison.md"), comparisonRows, { runId });

  console.log(`\n[april_replay] output: ${logDir}`);
  console.log(`[april_replay] profitable: ${comparisonRows.filter((row) => row.current_profitable === true).length}/${comparisonRows.length}`);
}

main().catch((err) => {
  console.error(err.stack || err.message || String(err));
  process.exit(1);
});
