"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const ROOT = path.join(__dirname, "..", "..");
const BASELINE_CSV = path.join(ROOT, "data/persona_sim_logs/2026-04-05T02-36-24-020Z/teams_summary.csv");
const STRUCTURED_MODE = "layered_structured_v1";
const STRUCTURED_VP_MODE = "layered_structured_vp_v1";
const STRUCTURED_NO_PRICING_MODE = "structured_no_pricing_v1";
const SIMPLE_PERSONA_MODE = "simple_persona_v1";
const HARNESS_ENFORCED_MODE = "harness_enforced_v1";
const STRUCTURED_SOURCE_RUN = "sim_layered_newflow_2026-07-10T23-54-52-761Z";
const DEFAULT_STRUCTURED_ROSTER = path.join(ROOT, "data", "persona_sim_logs", STRUCTURED_SOURCE_RUN, "students_summary.csv");
const DEFAULT_STRUCTURED_PROFILES = path.join(ROOT, "scripts", "sim", "structured_profiles_v1.json");
const DEFAULT_NO_PRICING_PROFILES = path.join(ROOT, "scripts", "sim", "structured_profiles_v1_no_pricing.json");
const NO_PRICING_ABLATED_FIELDS = [
  "belief_policy",
  "aspirations.acceptable_margin",
  "aspirations.price_position",
  "objectives_rank"
];

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

function parseMaybeJson(value) {
  if (!value) return null;
  if (typeof value === "object") return value;
  try {
    const parsed = JSON.parse(String(value));
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch (_) {
    return null;
  }
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

function sha256File(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function isSummaryRosterMode(mode) {
  return mode === STRUCTURED_MODE || mode === STRUCTURED_VP_MODE || mode === STRUCTURED_NO_PRICING_MODE || mode === SIMPLE_PERSONA_MODE || mode === HARNESS_ENFORCED_MODE;
}

function isStructuredProfileMode(mode) {
  return mode === STRUCTURED_MODE || mode === STRUCTURED_VP_MODE || mode === STRUCTURED_NO_PRICING_MODE || mode === HARNESS_ENFORCED_MODE;
}

function defaultProfilesForMode(mode) {
  return mode === STRUCTURED_NO_PRICING_MODE ? DEFAULT_NO_PRICING_PROFILES : DEFAULT_STRUCTURED_PROFILES;
}

function parseArgs(argv) {
  const args = {
    mode: process.env.SIM_MODE || "april_replay_live",
    roster: process.env.ROSTER_PATH || "",
    profiles: process.env.STRUCTURED_PROFILES || ""
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--mode") {
      args.mode = String(argv[i + 1] || "").trim();
      i += 1;
    } else if (arg === "--roster") {
      args.roster = path.resolve(argv[i + 1]);
      i += 1;
    } else if (arg === "--profiles") {
      args.profiles = path.resolve(argv[i + 1]);
      i += 1;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  if (isSummaryRosterMode(args.mode) && !args.roster) {
    args.roster = DEFAULT_STRUCTURED_ROSTER;
  }
  if (isStructuredProfileMode(args.mode) && !args.profiles) {
    args.profiles = defaultProfilesForMode(args.mode);
  }
  return args;
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

function personaIdByLabel(label, personas) {
  const found = Object.values(personas || {}).find((persona) => persona.label === label);
  return found?.id || null;
}

function buildStudentFromRosterRow(row, personas) {
  const label = String(row.persona || "").trim();
  const personaId = personaIdByLabel(label, personas);
  const base = personaId ? personas[personaId] || {} : {};
  const gender = String(row.gender || "").trim();
  const seedMemory = parseMaybeJson(row.seed_memory_json);
  const classroomProfile = parseMaybeJson(row.classroom_profile_json);
  return {
    ...base,
    id: personaId,
    personaId,
    label,
    name: String(row.name || "").trim(),
    gender,
    mbti: String(row.mbti || "").trim(),
    age: Number(row.age || 0),
    education: String(row.education || "").trim(),
    overseas: {
      hasOverseas: String(row.has_overseas || "").trim().toLowerCase() === "true"
    },
    industry: String(row.industry || base.industry || "").trim(),
    seedMemory,
    classroomProfile
  };
}

function parseDims(value) {
  try {
    const parsed = JSON.parse(String(value || "[]"));
    return Array.isArray(parsed) ? parsed.map((item) => String(item || "").trim()).filter(Boolean) : [];
  } catch (_) {
    return [];
  }
}

function loadRosterFromStudentsSummary(filePath, personas) {
  const rows = parseCsv(fs.readFileSync(filePath, "utf8"));
  if (rows.length !== 72) {
    throw new Error(`Expected 72 roster rows from ${filePath}, got ${rows.length}`);
  }
  const teams = Array.from({ length: 12 }, () => []);
  const assignments = {};
  for (const row of rows) {
    const teamIndex = Number(row.team_index);
    const memberIndex = Number(row.member_index);
    if (!Number.isInteger(teamIndex) || !Number.isInteger(memberIndex) || teamIndex < 0 || teamIndex >= 12 || memberIndex < 0 || memberIndex >= 6) {
      throw new Error(`Invalid roster position team=${row.team_index} member=${row.member_index}`);
    }
    teams[teamIndex][memberIndex] = buildStudentFromRosterRow(row, personas);
    assignments[`t${teamIndex}_m${memberIndex}`] = parseDims(row.r2_dims);
  }
  for (let teamIndex = 0; teamIndex < 12; teamIndex += 1) {
    if (teams[teamIndex].filter(Boolean).length !== 6) {
      throw new Error(`Roster team ${teamIndex} does not have 6 members`);
    }
  }
  return { teams, assignments };
}

function loadStructuredProfiles(filePath) {
  const profiles = JSON.parse(fs.readFileSync(filePath, "utf8"));
  if (!Array.isArray(profiles) || profiles.length !== 72) {
    throw new Error(`Expected 72 structured profiles from ${filePath}`);
  }
  return new Map(profiles.map((profile) => [profile.member_key, profile]));
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

async function configureDefaultSession(baseUrl, interviewMode) {
  const code = String(process.env.ADMIN_CODE || process.env.TEACHER_CODE || "").trim();
  if (!code) throw new Error("ADMIN_CODE or TEACHER_CODE is required");
  const res = await fetch(`${baseUrl}/api/teacher/session-config`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-teacher-code": code },
    body: JSON.stringify({
      session_id: "default",
      config: {
        interview_mode: interviewMode,
        hold_before_r2: false,
        reveal_r1_results: true
      }
    })
  });
  const text = await res.text();
  const body = text ? JSON.parse(text) : {};
  if (!res.ok || body.ok === false) {
    throw new Error(`session-config ${interviewMode} failed: ${text}`);
  }
  return body;
}

async function main() {
  loadLocalEnvFile();
  const args = parseArgs(process.argv.slice(2));
  const { ApiClient } = require("./api_client");
  const { DataExporter } = require("./data_export");
  const { SimLogger } = require("./logger");
  const { initializeAllStudents, PERSONAS } = require("./persona_pool");
  const { generateReport } = require("./report");
  const { getSubjectiveElicitationMetadata, getVpConditioningMetadata, runTeam } = require("./team_runner");

  const baseUrl = process.env.BASE_URL || "http://127.0.0.1:8787";
  process.env.STRICT_DEEPSEEK = "1";
  const teamSize = 6;
  const logger = new SimLogger();
  const api = new ApiClient(baseUrl, { logger, timeoutMs: 120000 });
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const runId = args.mode === STRUCTURED_MODE
    ? `sim_layered_structured_v1_${timestamp}`
    : (args.mode === STRUCTURED_VP_MODE
      ? `sim_layered_structured_vp_v1_${timestamp}`
      : (args.mode === STRUCTURED_NO_PRICING_MODE
      ? `sim_structured_no_pricing_v1_${timestamp}`
      : (args.mode === SIMPLE_PERSONA_MODE
        ? `sim_simple_persona_v1_${timestamp}`
        : (args.mode === HARNESS_ENFORCED_MODE ? `sim_harness_enforced_v1_${timestamp}` : `sim_replay_april_${timestamp}`))));
  const logDir = path.join(ROOT, "data", "persona_sim_logs", runId);
  fs.mkdirSync(logDir, { recursive: true });

  if (!process.env.DEEPSEEK_API_KEY) {
    throw new Error("STRICT_DEEPSEEK=1 but DEEPSEEK_API_KEY is missing");
  }

  await api.health();
  await configureDefaultSession(baseUrl, isSummaryRosterMode(args.mode) ? "summary" : "live");
  const rosterData = isSummaryRosterMode(args.mode)
    ? loadRosterFromStudentsSummary(args.roster, PERSONAS)
    : null;
  const structuredProfileMap = isStructuredProfileMode(args.mode)
    ? loadStructuredProfiles(args.profiles)
    : null;
  const allStudents = rosterData ? rosterData.teams : await initializeAllStudents();
  const results = [];

  for (let teamIndex = 0; teamIndex < REPLAY_STRATEGIES.length; teamIndex += 1) {
    const strategy = REPLAY_STRATEGIES[teamIndex];
    console.log(`[april_replay] ${teamIndex + 1}/${REPLAY_STRATEGIES.length} ${strategy.grid_id} / ${strategy.architecture}`);
    const studentPool = allStudents[teamIndex % allStudents.length] || [];
    const teamStudents = studentPool.slice(0, teamSize);
    const teamApi = new ApiClient(baseUrl, { logger, timeoutMs: 120000 });
    const result = await runTeam(teamIndex, teamSize, teamApi, logger, console, {
      logLevel: "normal",
      strictDeepSeek: true,
      students: teamStudents,
      teamStrategy: strategy,
      mode: args.mode,
      structuredProfileMap,
      rosterAssignments: rosterData?.assignments || null
    });
    results.push({ status: "fulfilled", value: result });
    logger.exportByTeam(path.join(logDir, "by_team"));
    logger.exportAll(path.join(logDir, "all_entries.json"));
  }

  const trackers = results.map((item) => item.value.tracker).filter(Boolean);
  const exporter = new DataExporter(runId, logDir, logger);
  const exportSummary = await exporter.exportAll(trackers);
  const profilesFileSha256 = isStructuredProfileMode(args.mode) ? sha256File(args.profiles) : null;
  const subjectiveElicitation = getSubjectiveElicitationMetadata();
  const vpConditioning = args.mode === STRUCTURED_VP_MODE
    ? getVpConditioningMetadata()
    : { vp_conditioned: false, vp_template_sha256: "" };
  const actualCommit = require("node:child_process").spawnSync("git", ["rev-parse", "HEAD"], {
    cwd: ROOT,
    encoding: "utf8"
  }).stdout.trim();
  const runMeta = {
    runId,
    baseUrl,
    gitCommit: actualCommit,
    baselineGitCommit: "6f2edb0ffda3b8f21c0b584d6a77edd7cd896403",
    mode: args.mode,
    harness_version: args.mode === HARNESS_ENFORCED_MODE ? "v1" : "",
    ablatedFields: args.mode === STRUCTURED_NO_PRICING_MODE ? NO_PRICING_ABLATED_FIELDS : [],
    profilesFile: isStructuredProfileMode(args.mode) ? args.profiles : "",
    profilesFileSha256,
    subjective_elicitation: subjectiveElicitation,
    vp_conditioned: vpConditioning.vp_conditioned,
    vp_template_sha256: vpConditioning.vp_template_sha256,
    rosterSource: isSummaryRosterMode(args.mode) ? args.roster : "",
    sourceRun: isSummaryRosterMode(args.mode) ? STRUCTURED_SOURCE_RUN : "",
    strict: true,
    strategies: REPLAY_STRATEGIES
  };
  fs.writeFileSync(path.join(logDir, "run_meta.json"), JSON.stringify(runMeta, null, 2));
  const reportPath = path.join(logDir, "report.json");
  generateReport(results, reportPath, {
    baseUrl,
    runId,
    gitCommit: actualCommit,
    numTeams: REPLAY_STRATEGIES.length,
    teamSize,
    concurrency: 1,
    logLevel: "normal",
    strictDeepSeek: true,
    mode: args.mode,
    harness_version: args.mode === HARNESS_ENFORCED_MODE ? "v1" : "",
    ablatedFields: args.mode === STRUCTURED_NO_PRICING_MODE ? NO_PRICING_ABLATED_FIELDS : [],
    profilesFileSha256,
    subjective_elicitation: subjectiveElicitation,
    vp_conditioned: vpConditioning.vp_conditioned,
    vp_template_sha256: vpConditioning.vp_template_sha256,
    rosterSource: isSummaryRosterMode(args.mode) ? args.roster : "",
    rosterPath: isSummaryRosterMode(args.mode) ? args.roster : "",
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
