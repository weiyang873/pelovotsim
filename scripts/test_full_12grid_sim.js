"use strict";

const fs = require("node:fs");
const path = require("node:path");

const { ApiClient } = require("./sim/api_client");
const { DataExporter } = require("./sim/data_export");
const { SimLogger } = require("./sim/logger");
const { initializeAllStudents } = require("./sim/persona_pool");
const { scoreProduct } = require("./sim/decision_tracker");
const { runTeam } = require("./sim/team_runner");

const FULL_GRID_STRATEGIES = [
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

const TEAM_SUMMARY_COLUMNS = [
  "grid",
  "arch",
  "r1_wtp_ref",
  "r1_sam_billion",
  "vp_C",
  "vp_G",
  "vp_E",
  "vp_score",
  "r2_cards",
  "r2_dCOGS",
  "r2_NRE",
  "r2_price",
  "r2_price_vs_wtp",
  "tags_count",
  "core_tags",
  "nice_tags",
  "conflicting_tags",
  "coverCore",
  "coverNice",
  "r2_gross_margin",
  "r2_share",
  "r2_units",
  "r2_profit_hw",
  "r2_profit_sub",
  "r2_profit",
  "r2_is_profitable",
  "jinang_dCOGS_saved_total",
  "total_llm_calls"
];

const REQUIRED_EXPORT_FILES = [
  "report.json",
  "computation_log.json",
  "teams_summary.csv",
  "teacher_export.csv",
  "teacher_debrief_data.json",
  "teacher_session_status.json",
  "interview_log.csv",
  "vp_chat_log.csv",
  "vp_iterations.csv",
  "jinang_effects.csv",
  "students_summary.csv",
  "student_roster.json",
  "teacher_capture_summary.json"
];

const REQUIRED_CHAIN_STAGES = [
  "r1_wtp_params",
  "r1_sam",
  "r1_vp_score",
  "r1_wtp_adj",
  "r2_interview_extract",
  "r2_evi",
  "r2_weight_fusion",
  "r2_tag_layering",
  "r2_card_selection",
  "r2_coverage",
  "r2_product_scores",
  "r2_volume",
  "r2_profit"
];

const FORBIDDEN_PERSONA_LEAKS = ["所在机构是", "我现在负责"];

function loadLocalEnvFile() {
  const envPath = path.join(process.cwd(), ".env");
  if (!fs.existsSync(envPath)) return;
  const content = fs.readFileSync(envPath, "utf8");
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith("\"") && value.endsWith("\"")) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!Object.prototype.hasOwnProperty.call(process.env, key)) {
      process.env[key] = value;
    }
  }
}

function pLimit(concurrency) {
  const queue = [];
  let activeCount = 0;

  const next = () => {
    if (activeCount >= concurrency || queue.length === 0) return;
    activeCount += 1;
    const item = queue.shift();
    item.fn()
      .then(item.resolve, item.reject)
      .finally(() => {
        activeCount -= 1;
        next();
      });
  };

  return (fn) => new Promise((resolve, reject) => {
    queue.push({ fn, resolve, reject });
    next();
  });
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function csvValue(value) {
  if (value == null) return "";
  const text = typeof value === "object" ? JSON.stringify(value) : String(value);
  if (/[,"\n]/.test(text)) {
    return `"${text.replace(/"/g, "\"\"")}"`;
  }
  return text;
}

function writeCsv(filePath, columns, rows) {
  ensureDir(path.dirname(filePath));
  const lines = [columns.join(",")];
  for (const row of rows) {
    lines.push(columns.map((column) => csvValue(row[column])).join(","));
  }
  fs.writeFileSync(filePath, `${lines.join("\n")}\n`);
}

function safeNumber(value, fallback = null) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function roundNumber(value, digits = 4, fallback = "") {
  const n = safeNumber(value, null);
  if (n == null) return fallback;
  return Number(n.toFixed(digits));
}

function sanitizeForJson(value) {
  if (value == null) return "";
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : "";
  }
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeForJson(item));
  }
  if (typeof value === "object") {
    const out = {};
    Object.entries(value).forEach(([key, item]) => {
      out[key] = sanitizeForJson(item);
    });
    return out;
  }
  return value;
}

function writeJson(filePath, payload) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, `${JSON.stringify(sanitizeForJson(payload), null, 2)}\n`);
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === "\"") {
        if (text[i + 1] === "\"") {
          field += "\"";
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }

    if (ch === "\"") {
      inQuotes = true;
      continue;
    }
    if (ch === ",") {
      row.push(field);
      field = "";
      continue;
    }
    if (ch === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      continue;
    }
    if (ch === "\r") continue;
    field += ch;
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  const filtered = rows.filter((item) => item.length > 1 || item[0] !== "");
  if (filtered.length === 0) return { columns: [], rows: [] };
  const columns = filtered[0];
  return {
    columns,
    rows: filtered.slice(1).map((values) => {
      const out = {};
      columns.forEach((column, index) => {
        out[column] = values[index] ?? "";
      });
      return out;
    })
  };
}

function buildRoster(allStudents, strategies) {
  return allStudents.map((team, teamIndex) => ({
    team_index: teamIndex,
    target_grid: strategies[teamIndex]?.grid_id || "",
    target_arch: strategies[teamIndex]?.architecture || "",
    members: team.map((student) => ({
      name: student.name,
      persona: student.label,
      persona_id: student.personaId,
      gender: student.gender,
      mbti: student.mbti,
      age: student.age,
      education: student.education,
      overseas: student.overseas,
      role: student.role,
      industry: student.industry
    }))
  }));
}

async function fetchResource(baseUrl, resourcePath, options = {}) {
  const res = await fetch(`${baseUrl}${resourcePath}`, {
    method: options.method || "GET",
    headers: options.headers || {},
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  const contentType = String(res.headers.get("content-type") || "").toLowerCase();
  const text = await res.text();
  let body = null;
  if (contentType.includes("application/json")) {
    try {
      body = text ? JSON.parse(text) : null;
    } catch (_) {
      body = null;
    }
  }
  return {
    ok: res.ok && (!body || body.ok !== false),
    status: res.status,
    contentType,
    text,
    body
  };
}

async function resetTeacherSession(baseUrl, adminCode) {
  const response = await fetchResource(baseUrl, "/api/teacher/reset-session", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-teacher-code": adminCode
    },
    body: { confirm: true }
  });
  if (!response.ok) {
    throw new Error(`teacher reset session failed (${response.status}): ${response.text}`);
  }
  return response.body || {};
}

async function captureTeacherArtifacts(baseUrl, adminCode, sessionId, logDir) {
  const query = `?session_id=${encodeURIComponent(sessionId)}`;
  const headers = { "x-teacher-code": adminCode };
  const sessionStatus = await fetchResource(baseUrl, `/api/teacher/session-status${query}`, { headers });
  const debriefData = await fetchResource(baseUrl, `/api/teacher/debrief-data${query}`, { headers });
  const exportCsv = await fetchResource(baseUrl, `/api/teacher/export-csv${query}`, { headers });

  const sessionStatusPath = path.join(logDir, "teacher_session_status.json");
  const debriefDataPath = path.join(logDir, "teacher_debrief_data.json");
  const exportCsvPath = path.join(logDir, "teacher_export.csv");

  writeJson(sessionStatusPath, sessionStatus.body || {
    ok: sessionStatus.ok,
    status: sessionStatus.status,
    raw: sessionStatus.text
  });
  writeJson(debriefDataPath, debriefData.body || {
    ok: debriefData.ok,
    status: debriefData.status,
    raw: debriefData.text
  });
  fs.writeFileSync(exportCsvPath, exportCsv.text || "");

  return {
    sessionStatus,
    debriefData,
    exportCsv,
    files: {
      sessionStatusPath,
      debriefDataPath,
      exportCsvPath
    }
  };
}

function buildComputationExport(rawChain) {
  const groupedLogs = {};
  Object.entries(rawChain?.grouped_logs || {}).forEach(([stage, logs]) => {
    groupedLogs[stage] = (Array.isArray(logs) ? logs : []).map((log) => ({
      id: safeNumber(log?.id, ""),
      session_id: String(log?.session_id || ""),
      team_id: String(log?.team_id || ""),
      member_id: String(log?.member_id || ""),
      timestamp: String(log?.timestamp || ""),
      source: String(log?.source || ""),
      params: sanitizeForJson(log?.params || {})
    }));
  });

  const latestChain = {};
  REQUIRED_CHAIN_STAGES.forEach((stage) => {
    latestChain[stage] = sanitizeForJson(rawChain?.latest_chain?.[stage]?.params || {});
  });

  return {
    team_id: String(rawChain?.team_id || ""),
    latest_chain: latestChain,
    grouped_logs: groupedLogs
  };
}

function normalizeTag(tag) {
  if (typeof tag === "string") return tag.trim();
  return String(tag?.tag || "").trim();
}

function findConflictingTags(tags, gridId) {
  const grid = String(gridId || "").toLowerCase();
  return (Array.isArray(tags) ? tags : [])
    .map((tag) => normalizeTag(tag))
    .filter(Boolean)
    .filter((tag) => {
      const text = tag.toLowerCase();
      if (grid.includes("elder") && (text.includes("儿童") || text.includes("幼儿"))) return true;
      if (grid.includes("child") && (text.includes("退休") || text.includes("养老"))) return true;
      return false;
    });
}

function hasPersonaLeak(text) {
  const content = String(text || "");
  return FORBIDDEN_PERSONA_LEAKS.some((item) => content.includes(item));
}

function countTeamLlmCalls(entries, teamId) {
  return (Array.isArray(entries) ? entries : []).filter((entry) => {
    if (entry.teamId !== teamId) return false;
    if (entry.type === "student_llm") return true;
    const pathText = String(entry.path || "");
    return entry.type === "api" && (
      pathText.includes("/phase3/chat") ||
      pathText.includes("/phase3/submit-vp") ||
      pathText.includes("/round2/interview/start") ||
      pathText.includes("/round2/interview/reply") ||
      pathText.includes("/round2/interview/end")
    );
  }).length;
}

function getTagLayeringInfo(tracker, chain) {
  const stage = chain?.latest_chain?.r2_tag_layering || {};
  const stageTags = Array.isArray(stage.tags) ? stage.tags : [];
  const resultTags = Array.isArray(tracker?.team?.r2_finalCalcResult?.tagBreakdown)
    ? tracker.team.r2_finalCalcResult.tagBreakdown
    : [];
  const tags = stageTags.length > 0 ? stageTags : resultTags;
  const coreTags = Array.isArray(stage.core_tags)
    ? stage.core_tags
    : tags.filter((item) => String(item?.tier || "").trim() === "core").map((item) => normalizeTag(item));
  const niceTags = Array.isArray(stage.nice_tags)
    ? stage.nice_tags
    : tags.filter((item) => String(item?.tier || "").trim() === "nice").map((item) => normalizeTag(item));
  return {
    tags,
    coreTags: coreTags.filter(Boolean),
    niceTags: niceTags.filter(Boolean)
  };
}

function buildTeamSummaryRows(trackers, computationChains, logger) {
  return trackers
    .slice()
    .sort((a, b) => a.teamIndex - b.teamIndex)
    .map((tracker) => {
      const chain = computationChains[tracker.teamId] || {};
      const coverage = chain.latest_chain?.r2_coverage || {};
      const profit = chain.latest_chain?.r2_profit || {};
      const volume = chain.latest_chain?.r2_volume || {};
      const tagInfo = getTagLayeringInfo(tracker, chain);
      const allTags = tagInfo.tags.map((item) => normalizeTag(item)).filter(Boolean);
      const finalGrid = tracker.team.finalGrid || FULL_GRID_STRATEGIES[tracker.teamIndex]?.grid_id || "";
      const finalArch = tracker.team.finalArch || FULL_GRID_STRATEGIES[tracker.teamIndex]?.architecture || "";
      const conflictingTags = findConflictingTags(allTags, finalGrid);
      const llmCalls = countTeamLlmCalls(logger.entries, tracker.teamId);

      return {
        team_index: tracker.teamIndex,
        team_id: tracker.teamId,
        grid: finalGrid,
        arch: finalArch,
        r1_wtp_ref: roundNumber(tracker.team.r1_wtp_ref, 2, ""),
        r1_sam_billion: roundNumber(tracker.team.r1_sam_billion, 4, ""),
        vp_C: roundNumber(tracker.team.vp_score_c, 4, ""),
        vp_G: roundNumber(tracker.team.vp_score_g, 4, ""),
        vp_E: roundNumber(tracker.team.vp_score_e, 4, ""),
        vp_score: roundNumber(
          tracker.team.vp_final_score != null
            ? tracker.team.vp_final_score
            : scoreProduct({
                C: tracker.team.vp_score_c,
                G: tracker.team.vp_score_g,
                E: tracker.team.vp_score_e
              }),
          4,
          ""
        ),
        r2_cards: (tracker.team.r2_teamSelections || []).map((item) => `${item.cap_id}:${item.tier}`).join("|"),
        r2_dCOGS: roundNumber(tracker.team.r2_total_dCOGS, 2, ""),
        r2_NRE: roundNumber(tracker.team.r2_total_NRE, 2, ""),
        r2_price: roundNumber(tracker.team.r2_finalPrice, 2, ""),
        r2_price_vs_wtp: roundNumber(
          tracker.team.r2_price_vs_wtp != null
            ? tracker.team.r2_price_vs_wtp
            : (safeNumber(tracker.team.r2_finalPrice, null) != null && safeNumber(tracker.team.r1_wtp_adj, null) > 0
              ? safeNumber(tracker.team.r2_finalPrice) / safeNumber(tracker.team.r1_wtp_adj)
              : null),
          4,
          ""
        ),
        tags_count: allTags.length,
        core_tags: tagInfo.coreTags.join("|"),
        nice_tags: tagInfo.niceTags.join("|"),
        conflicting_tags: conflictingTags.join("|"),
        coverCore: roundNumber(tracker.team.r2_coverCore ?? coverage.coverCore, 4, ""),
        coverNice: roundNumber(tracker.team.r2_coverNice ?? coverage.coverNice, 4, ""),
        r2_gross_margin: roundNumber(tracker.team.r2_gross_margin ?? profit.actual_gm, 4, ""),
        r2_share: roundNumber(tracker.team.r2_share ?? volume.share, 6, ""),
        r2_units: roundNumber(tracker.team.r2_units ?? volume.Q, 2, ""),
        r2_profit_hw: roundNumber(tracker.team.r2_profit_hw ?? profit.profit_hw, 2, ""),
        r2_profit_sub: roundNumber(tracker.team.r2_profit_sub ?? profit.profit_sub, 2, ""),
        r2_profit: roundNumber(tracker.team.r2_profit ?? profit.total_profit, 2, ""),
        r2_is_profitable: safeNumber(tracker.team.r2_profit, null) != null
          ? String(tracker.team.r2_profit > 0)
          : "",
        jinang_dCOGS_saved_total: roundNumber(tracker.team.jinang_tech_discount_total, 2, ""),
        total_llm_calls: llmCalls
      };
    });
}

function buildTeamValidations(results, trackers, summaryRows, computationChains) {
  const resultByTeamId = new Map();
  (results || []).forEach((item) => {
    if (item?.teamId) resultByTeamId.set(item.teamId, item);
  });
  const trackerByTeamId = new Map();
  (trackers || []).forEach((tracker) => trackerByTeamId.set(tracker.teamId, tracker));

  return summaryRows.map((row) => {
    const result = resultByTeamId.get(row.team_id) || null;
    const tracker = trackerByTeamId.get(row.team_id) || null;
    const chain = computationChains[row.team_id] || {};
    const leakMatches = [];
    Object.values(tracker?.members || {}).forEach((member) => {
      (member.interviewLog || []).forEach((entry) => {
        if (entry.role !== "interviewee") return;
        if (hasPersonaLeak(entry.message_text)) {
          leakMatches.push({
            member_id: member.memberId,
            member_name: member.name,
            text: String(entry.message_text || "")
          });
        }
      });
    });

    const expected = FULL_GRID_STRATEGIES[row.team_index] || {};
    const missingStages = REQUIRED_CHAIN_STAGES.filter((stage) => {
      const params = chain.latest_chain?.[stage];
      return !params || (typeof params === "object" && Object.keys(params).length === 0);
    });

    const profitValue = safeNumber(row.r2_profit, null);
    const validations = {
      team_steps_passed: result?.status === "passed",
      grid_match: row.grid === expected.grid_id,
      arch_match: row.arch === expected.architecture,
      tags_min: Number(row.tags_count || 0) >= 5,
      cover_core_positive: safeNumber(row.coverCore, 0) > 0,
      vp_score_positive: safeNumber(row.vp_score, 0) > 0,
      profit_finite: profitValue != null,
      no_conflicting_tags: String(row.conflicting_tags || "").trim() === "",
      no_persona_leak: leakMatches.length === 0,
      computation_chain_complete: missingStages.length === 0
    };

    return {
      team_index: row.team_index,
      team_id: row.team_id,
      grid: row.grid,
      arch: row.arch,
      pass: Object.values(validations).every(Boolean),
      validations,
      missing_stages: missingStages,
      persona_leaks: leakMatches
    };
  });
}

function buildReport(results, validations, exportMeta) {
  const validationByTeamId = new Map();
  validations.forEach((item) => validationByTeamId.set(item.team_id, item));
  const teams = (results || []).map((result, index) => {
    const validation = validationByTeamId.get(result.teamId) || null;
    return {
      team_index: index,
      team_id: result.teamId || "",
      status: result.status || "failed",
      pass: validation ? validation.pass : false,
      steps: sanitizeForJson(result.steps || {}),
      timing: sanitizeForJson(result.timing || {}),
      warnings: sanitizeForJson(result.warnings || []),
      errors: sanitizeForJson(result.errors || []),
      meta: sanitizeForJson(result.meta || {}),
      validation: sanitizeForJson(validation || {})
    };
  });

  return {
    generated_at: new Date().toISOString(),
    summary: {
      total_teams: teams.length,
      passed_teams: teams.filter((item) => item.pass).length,
      failed_teams: teams.filter((item) => !item.pass).length
    },
    exports: sanitizeForJson(exportMeta),
    teams
  };
}

function buildTeacherCaptureSummary(context) {
  const teacherRows = parseCsv(context.teacher.exportCsv.text || "");
  return {
    run_id: context.runId,
    session_id: context.sessionId,
    generated_at: new Date().toISOString(),
    team_count: context.summaryRows.length,
    teacher_export_rows: teacherRows.rows.length,
    teacher_session_team_count: Array.isArray(context.teacher.sessionStatus.body?.teams)
      ? context.teacher.sessionStatus.body.teams.length
      : 0,
    teacher_debrief_team_count: Array.isArray(context.teacher.debriefData.body?.teams)
      ? context.teacher.debriefData.body.teams.length
      : 0,
    export_summary: sanitizeForJson(context.exportSummary),
    validation_summary: {
      passed_teams: context.validations.filter((item) => item.pass).length,
      failed_teams: context.validations.filter((item) => !item.pass).length
    },
    files: Object.fromEntries(
      REQUIRED_EXPORT_FILES.map((name) => [name, path.join(context.logDir, name)])
    )
  };
}

function printSummaryTable(summaryRows, validations) {
  const validationByTeamId = new Map();
  validations.forEach((item) => validationByTeamId.set(item.team_id, item));
  const header = [
    "格子".padEnd(28),
    "tags".padStart(4),
    "core".padStart(4),
    "conflict".padStart(9),
    "coverC".padStart(7),
    "Vscore".padStart(7),
    "Q".padStart(8),
    "P".padStart(7),
    "profit(万)".padStart(10),
    "状态".padStart(6)
  ].join(" | ");

  console.log(`\n${header}`);
  summaryRows.forEach((row) => {
    const validation = validationByTeamId.get(row.team_id);
    const coreCount = String(row.core_tags || "").trim() ? String(row.core_tags).split("|").filter(Boolean).length : 0;
    const profitWan = safeNumber(row.r2_profit, 0) / 10000;
    const cells = [
      String(row.grid || "").padEnd(28),
      String(row.tags_count || 0).padStart(4),
      String(coreCount).padStart(4),
      (String(row.conflicting_tags || "").trim() ? "YES" : "NO").padStart(9),
      String(row.coverCore || "").padStart(7),
      String(row.vp_score || "").padStart(7),
      String(Math.round(safeNumber(row.r2_units, 0))).padStart(8),
      String(Math.round(safeNumber(row.r2_price, 0))).padStart(7),
      String(Math.round(profitWan)).padStart(10),
      String(validation?.pass ? "PASS" : "FAIL").padStart(6)
    ];
    console.log(cells.join(" | "));
  });
}

function verifyExportFiles(logDir) {
  return REQUIRED_EXPORT_FILES.map((file) => {
    const filePath = path.join(logDir, file);
    const exists = fs.existsSync(filePath);
    const size = exists ? fs.statSync(filePath).size : 0;
    return {
      file,
      exists,
      size
    };
  });
}

function scanForForbiddenLiterals(logDir) {
  const findings = [];
  REQUIRED_EXPORT_FILES.forEach((file) => {
    const filePath = path.join(logDir, file);
    if (!fs.existsSync(filePath)) return;
    const content = fs.readFileSync(filePath, "utf8");
    const matches = content.match(/\b(?:NaN|undefined|null)\b/g);
    if (matches && matches.length > 0) {
      findings.push({
        file,
        matches: Array.from(new Set(matches))
      });
    }
  });
  return findings;
}

async function main() {
  loadLocalEnvFile();

  const baseUrl = process.env.BASE_URL || "http://127.0.0.1:8787";
  const adminCode = String(process.env.ADMIN_CODE || "").trim();
  const numTeams = 12;
  const teamSize = 6;
  const concurrency = Number(process.env.CONCURRENCY || 3);
  const logLevel = String(process.env.LOG_LEVEL || "normal").toLowerCase();
  const strictDeepSeek = String(process.env.STRICT_DEEPSEEK || "").trim() === "1";
  const sessionId = "default";

  if (FULL_GRID_STRATEGIES.length !== numTeams) {
    throw new Error(`FULL_GRID_STRATEGIES length=${FULL_GRID_STRATEGIES.length}, expected ${numTeams}`);
  }
  if (!adminCode) {
    throw new Error("ADMIN_CODE not configured");
  }
  if (strictDeepSeek && !process.env.DEEPSEEK_API_KEY) {
    throw new Error("STRICT_DEEPSEEK=1 but DEEPSEEK_API_KEY is missing");
  }

  const startedAt = Date.now();
  const healthApi = new ApiClient(baseUrl);
  await healthApi.health();

  console.log("\n12-grid full AI simulation");
  console.log(`base_url=${baseUrl}`);
  console.log(`teams=${numTeams} team_size=${teamSize} concurrency=${concurrency}`);

  const resetInfo = await resetTeacherSession(baseUrl, adminCode);
  console.log(`teacher session reset: deleted_teams=${resetInfo.deleted_teams || 0} deleted_members=${resetInfo.deleted_members || 0}`);

  const allStudents = await initializeAllStudents(numTeams, teamSize);
  const logger = new SimLogger();
  const limit = pLimit(Math.max(1, concurrency));
  const resultsSettled = await Promise.allSettled(
    FULL_GRID_STRATEGIES.map((teamStrategy, teamIndex) => limit(() => {
      const api = new ApiClient(baseUrl, { logger });
      return runTeam(teamIndex, teamSize, api, logger, console, {
        logLevel,
        strictDeepSeek,
        teamStrategy,
        students: (allStudents[teamIndex] || []).slice(0, teamSize)
      });
    }))
  );

  const results = resultsSettled.map((item, teamIndex) => {
    if (item.status === "fulfilled") return item.value;
    return {
      teamIndex,
      teamSize,
      teamId: "",
      status: "failed",
      steps: {},
      timing: {},
      warnings: [],
      errors: [{ message: String(item.reason?.message || item.reason || "Unknown failure") }],
      meta: {
        expected_grid: FULL_GRID_STRATEGIES[teamIndex]?.grid_id || "",
        expected_arch: FULL_GRID_STRATEGIES[teamIndex]?.architecture || ""
      }
    };
  });

  const trackers = results
    .filter((result) => result?.tracker?.teamId)
    .map((result) => result.tracker);

  const runId = new Date().toISOString().replace(/[:.]/g, "-");
  const logDir = path.join("data", "persona_sim_logs", runId);
  ensureDir(logDir);

  writeJson(path.join(logDir, "student_roster.json"), buildRoster(allStudents, FULL_GRID_STRATEGIES));

  try {
    await fetch(`${baseUrl}/api/admin/flush-llm-logs`, { method: "POST" });
  } catch (_) {}

  const exporter = new DataExporter(runId, logDir, logger);
  const exportSummary = await exporter.exportAll(trackers);

  const computationChains = {};
  await Promise.all(trackers.map(async (tracker) => {
    const raw = await healthApi.getComputationChain(tracker.teamId);
    computationChains[tracker.teamId] = buildComputationExport(raw);
  }));
  writeJson(path.join(logDir, "computation_log.json"), computationChains);

  const teacher = await captureTeacherArtifacts(baseUrl, adminCode, sessionId, logDir);
  const summaryRows = buildTeamSummaryRows(trackers, computationChains, logger);
  writeCsv(path.join(logDir, "teams_summary.csv"), TEAM_SUMMARY_COLUMNS, summaryRows);

  const validations = buildTeamValidations(results, trackers, summaryRows, computationChains);
  const reportPayload = buildReport(results, validations, {
    base_url: baseUrl,
    run_id: runId,
    session_id: sessionId,
    export_summary: exportSummary
  });
  writeJson(path.join(logDir, "report.json"), reportPayload);

  const teacherCaptureSummary = buildTeacherCaptureSummary({
    runId,
    sessionId,
    logDir,
    exportSummary,
    summaryRows,
    validations,
    teacher
  });
  writeJson(path.join(logDir, "teacher_capture_summary.json"), teacherCaptureSummary);

  const fileChecks = verifyExportFiles(logDir);
  const literalFindings = scanForForbiddenLiterals(logDir);
  const teamsSummaryCsv = parseCsv(fs.readFileSync(path.join(logDir, "teams_summary.csv"), "utf8"));
  const teacherExportCsv = parseCsv(fs.readFileSync(path.join(logDir, "teacher_export.csv"), "utf8"));

  const exportValidation = {
    required_files_present: fileChecks.every((item) => item.exists && item.size > 0),
    teams_summary_12_rows: teamsSummaryCsv.rows.length === numTeams,
    computation_log_12_teams: Object.keys(computationChains).length === numTeams,
    teacher_status_12_teams: Array.isArray(teacher.sessionStatus.body?.teams) && teacher.sessionStatus.body.teams.length === numTeams,
    teacher_debrief_12_teams: Array.isArray(teacher.debriefData.body?.teams) && teacher.debriefData.body.teams.length === numTeams,
    teacher_export_has_rows: teacherExportCsv.rows.length >= numTeams,
    no_forbidden_literals: literalFindings.length === 0
  };

  printSummaryTable(summaryRows, validations);

  console.log(`\noutput_dir=${logDir}`);
  console.log(`elapsed_seconds=${((Date.now() - startedAt) / 1000).toFixed(1)}`);

  const failedTeamValidations = validations.filter((item) => !item.pass);
  const failedExportValidations = Object.entries(exportValidation).filter(([, ok]) => !ok);

  if (failedTeamValidations.length > 0) {
    console.error(`\nteam validation failed: ${failedTeamValidations.length}`);
    failedTeamValidations.forEach((item) => {
      console.error(`- ${item.grid} (${item.team_id}) missing=${item.missing_stages.join(",") || "none"} leaks=${item.persona_leaks.length}`);
    });
  }
  if (failedExportValidations.length > 0) {
    console.error("\nexport validation failed:");
    failedExportValidations.forEach(([name]) => console.error(`- ${name}`));
  }
  if (literalFindings.length > 0) {
    console.error("\nforbidden literals found:");
    literalFindings.forEach((item) => console.error(`- ${item.file}: ${item.matches.join(",")}`));
  }

  process.exit(failedTeamValidations.length === 0 && failedExportValidations.length === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
