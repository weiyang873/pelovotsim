"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { Pool } = require("pg");
const { chromium, expect, request } = require("@playwright/test");

const { ApiClient } = require("./sim/api_client");
const { createConsoleMonitor } = require("../tests/e2e/helpers/consoleMonitor");
const { createNetworkTracker } = require("../tests/e2e/helpers/networkTracker");
const {
  STUDENT_SESSION_KEY,
  completeInterviewCycle,
  resolveBaseUrl,
  runRound1Flow,
  setRangeValue
} = require("../tests/e2e/helpers/flowHelpers");
const { loadJinangConfig } = require("../server/multiplayer/jinangDealer");
const { applyTechJinnang } = require("../server/multiplayer/rdTeamAdapter");
const { readLogEntries } = require("../server/llm/llm_logger");

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

const STUDENT_SUMMARY_COLUMNS = [
  "run_id", "team_index", "member_index", "name", "persona", "gender", "mbti", "age", "education", "has_overseas", "industry",
  "seed_memory_json", "classroom_profile_json",
  "jinang_market", "jinang_tech", "jinang_market_match", "jinang_tech_match",
  "r1_grid", "r1_arch", "r1_personal_wtp_adj",
  "r1_who", "r1_pain", "r1_how",
  "r2_dims", "r2_interview_turns",
  "r2_evi", "r2_evidence_count", "r2_strong_dim_count", "r2_missing_dim_count",
  "r2_radar_perception", "r2_radar_motion", "r2_radar_interaction", "r2_radar_safety", "r2_radar_extension", "r2_radar_maintenance",
  "r2_cards_selected", "r2_high_tier_count", "r2_jinang_dCOGS_saved"
];

const INTERVIEW_LOG_COLUMNS = [
  "run_id", "team_index", "member_index", "member_name", "member_persona",
  "interview_persona_id", "interview_persona_name",
  "turn_number", "role", "message_text"
];

const VP_CHAT_LOG_COLUMNS = [
  "run_id", "team_index", "round_number",
  "coach_message",
  "speaker_persona", "speaker_name", "speaker_reply",
  "lead_writer_persona", "lead_writer_name",
  "vp_before", "vp_after",
  "score_product_before", "score_product_after",
  "score_C", "score_G", "score_E"
];

const VP_ITERATION_COLUMNS = [
  "run_id", "team_index", "iteration", "trigger", "speaker_persona", "speaker_name",
  "vp_text",
  "vp_who", "vp_pain", "vp_how",
  "score_C", "score_G", "score_E", "score_product",
  "who_changed", "pain_changed", "how_changed", "coach_reply", "speaker_reply"
];

const JINANG_EFFECT_COLUMNS = [
  "run_id", "team_index", "member_name", "persona", "jinang_tech_name", "match_strength",
  "cap_id", "cap_name", "dimension", "tier",
  "original_dCOGS", "discounted_dCOGS", "saving", "original_risk", "discounted_risk", "risk_saving"
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

const CAP_GROUPS = require("../data/capability_groups_v2.json");
const CAPABILITY_MAP = new Map();
for (const group of CAP_GROUPS.groups || []) {
  for (const capability of group.capabilities || []) {
    CAPABILITY_MAP.set(capability.cap_id, {
      cap_id: capability.cap_id,
      cap_name: capability.name,
      dimension: group.group_id
    });
  }
}

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

function parseJson(value, fallback) {
  if (value == null || value === "") return fallback;
  if (typeof value === "object") return value;
  try {
    return JSON.parse(value);
  } catch (_) {
    return fallback;
  }
}

function normalizeText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function extractNumericValue(text) {
  const match = String(text || "").match(/-?\d+(\.\d+)?/);
  return match ? Number(match[0]) : Number.NaN;
}

function fetchDatesBetween(startedAt, endedAt) {
  const dates = [];
  const cursor = new Date(startedAt);
  cursor.setHours(0, 0, 0, 0);
  const end = new Date(endedAt);
  end.setHours(0, 0, 0, 0);
  while (cursor.getTime() <= end.getTime()) {
    dates.push(cursor.toISOString().slice(0, 10));
    cursor.setDate(cursor.getDate() + 1);
  }
  return dates;
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

  writeJson(path.join(logDir, "teacher_session_status.json"), sessionStatus.body || {
    ok: sessionStatus.ok,
    status: sessionStatus.status,
    raw: sessionStatus.text
  });
  writeJson(path.join(logDir, "teacher_debrief_data.json"), debriefData.body || {
    ok: debriefData.ok,
    status: debriefData.status,
    raw: debriefData.text
  });
  fs.writeFileSync(path.join(logDir, "teacher_export.csv"), exportCsv.text || "");

  return {
    sessionStatus,
    debriefData,
    exportCsv
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

function parseGrid(gridId) {
  const parts = String(gridId || "").trim().split("_");
  return {
    customer: parts[0] || "",
    strategy: parts[1] || "",
    age: parts[2] || ""
  };
}

function normalizeGridId(gridId) {
  return String(gridId || "")
    .trim()
    .replace("_CostLeadership_", "_Cost_")
    .replace(/^B2B_/, "ToB_")
    .replace(/^B2C_/, "ToC_");
}

function buildGridTestId(gridId) {
  const meta = parseGrid(gridId);
  const customer = meta.customer.toLowerCase();
  const strategy = String(meta.strategy || "").toLowerCase().includes("cost") ? "cost" : "diff";
  const age = String(meta.age || "").toLowerCase();
  return `grid-${customer}-${strategy}-${age}`;
}

function buildArchTestId(arch) {
  return `arch-${String(arch || "").toLowerCase()}`;
}

function buildTeamArchTestId(arch) {
  return `team-arch-${String(arch || "").toLowerCase()}`;
}

function buildStoredSession(teamId, member) {
  return {
    teamId,
    memberId: member.id,
    studentName: member.name,
    entryMode: "trial"
  };
}

function createContextOptions(baseUrl) {
  return {
    baseURL: baseUrl,
    ignoreHTTPSErrors: true
  };
}

async function openRound2Context(browser, baseUrl, teamId, member) {
  const context = await browser.newContext(createContextOptions(baseUrl));
  await context.addInitScript(({ key, session }) => {
    window.localStorage.setItem(key, JSON.stringify(session));
  }, {
    key: STUDENT_SESSION_KEY,
    session: buildStoredSession(teamId, member)
  });
  const page = await context.newPage();
  await page.goto("/multiplayer/round2?session_id=default");
  await expect(page.locator("[data-testid='r2-recap-container']")).toBeVisible({ timeout: 120000 });
  return { context, page, member };
}

async function enterRound2FromRecap(page) {
  if (await page.locator("[data-testid='r2-interview-container']").count()) return;
  await expect(page.locator("[data-testid='r2-recap-container']")).toBeVisible({ timeout: 120000 });
  await expect(page.locator("[data-testid='r2-recap-space-tier']")).not.toHaveText("", { timeout: 30000 });
  await page.getByRole("button", { name: "进入第二轮 →" }).click();
  await expect(page.locator("[data-testid='r2-interview-container']")).toBeVisible({ timeout: 120000 });
}

function parsePersonaName(cardText) {
  const match = String(cardText || "").match(/访谈对象：([^\n]+)/);
  return match ? match[1].trim() : "";
}

async function getActivePersonaMeta(page, expectedAgeGroup = "") {
  const personaCard = page
    .locator("[data-testid='r2-interview-container'] div")
    .filter({ hasText: /TA 同意参加你们的产品调研/ })
    .first();
  await expect(personaCard).toBeVisible({ timeout: 30000 });
  const cardText = await personaCard.innerText();
  const personaName = parsePersonaName(cardText);
  expect(personaName).not.toBe("");

  const ageMatch = String(cardText).match(/(\d+)岁/);
  if (expectedAgeGroup) {
    expect(ageMatch, "persona card should include age").toBeTruthy();
    const ageValue = Number(ageMatch[1]);
    if (expectedAgeGroup === "ELDER") expect(ageValue).toBeGreaterThanOrEqual(60);
    if (expectedAgeGroup === "ADULT") {
      expect(ageValue).toBeGreaterThanOrEqual(18);
      expect(ageValue).toBeLessThan(60);
    }
    if (expectedAgeGroup === "CHILD") expect(ageValue).toBeLessThan(18);
  }

  return {
    personaName,
    cardText
  };
}

async function completeInterviewWithAssertions(page, interviewScript, expectedAgeGroup = "") {
  let currentPersonaName = "";
  return completeInterviewCycle(page, {
    script: interviewScript,
    beforeSend: async () => {
      const meta = await getActivePersonaMeta(page, expectedAgeGroup);
      currentPersonaName = meta.personaName;
    },
    afterReply: async ({ beforePersonaCount }) => {
      const personaMessage = page.locator("[data-testid='r2-interview-persona-msg']").nth(beforePersonaCount);
      await expect(personaMessage).toBeVisible({ timeout: 30000 });
      const speaker = normalizeText(await personaMessage.locator("div").first().innerText());
      const replyText = normalizeText(await personaMessage.locator("div").nth(1).innerText());
      expect(speaker).toBe(currentPersonaName);
      expect(replyText).not.toContain("我现在负责");
      expect(replyText).not.toContain("所在机构是");
    }
  });
}

async function resolvePostInterviewState(page) {
  const cardSelection = page.locator("[data-testid='r2-card-selection-container']");
  const enterCardsButton = page.locator("button").filter({ hasText: /进入个人选卡/ }).first();
  const nextInterviewButton = page.locator("button").filter({ hasText: /开始下一次访谈|再访谈一位/ }).first();
  const interviewInput = page.locator("[data-testid='r2-interview-input']");
  const endButton = page.locator("button").filter({ hasText: /结束本次访谈/ }).first();

  if (await cardSelection.isVisible().catch(() => false)) return "cards";
  if (await enterCardsButton.isVisible().catch(() => false)) return "enter-cards";
  if (await nextInterviewButton.isVisible().catch(() => false)) return "next-interview";
  if (await interviewInput.isEditable().catch(() => false)) return "interviewing";
  if (await endButton.isVisible().catch(() => false)) return "ending";
  return "waiting";
}

async function waitForActionablePostInterviewState(page, initialState = "waiting", timeout = 120000) {
  if (initialState && initialState !== "waiting" && initialState !== "ending") {
    return initialState;
  }
  await expect.poll(async () => {
    const state = await resolvePostInterviewState(page);
    if (state === "ending") return "waiting";
    return state;
  }, {
    timeout,
    intervals: [1000, 2000, 3000, 5000]
  }).not.toBe("waiting");
  return resolvePostInterviewState(page);
}

async function completeTwoInterviewsAndEnterCards(page, interviewScript, expectedAgeGroup = "") {
  const firstInterview = await completeInterviewWithAssertions(page, interviewScript, expectedAgeGroup);
  const firstPostState = await waitForActionablePostInterviewState(page, firstInterview?.postEndState);
  const cardSelection = page.locator("[data-testid='r2-card-selection-container']");
  const enterCardsButton = page.locator("button").filter({ hasText: /进入个人选卡/ }).first();
  const nextInterviewButton = page.locator("button").filter({ hasText: /开始下一次访谈|再访谈一位/ }).first();

  if (firstPostState === "cards") {
    await expect(cardSelection).toBeVisible({ timeout: 30000 });
    return;
  }
  if (firstPostState === "enter-cards") {
    await enterCardsButton.click();
    await expect(cardSelection).toBeVisible({ timeout: 30000 });
    return;
  }
  if (firstPostState === "next-interview") {
    await nextInterviewButton.click();
  }

  const secondInterview = await completeInterviewWithAssertions(page, interviewScript, expectedAgeGroup);
  const secondPostState = await waitForActionablePostInterviewState(page, secondInterview?.postEndState);
  if (secondPostState === "cards") {
    await expect(cardSelection).toBeVisible({ timeout: 30000 });
    return;
  }
  if (secondPostState === "enter-cards") {
    await enterCardsButton.click();
  }
  await expect(cardSelection).toBeVisible({ timeout: 30000 });
}

function chooseCardPlan(meta) {
  return [
    meta.age === "Child" && meta.customer === "ToC" ? "music_companion" : (meta.strategy === "Differentiation" ? "persona_dialog" : "voice_basic"),
    meta.strategy === "Differentiation" ? "adaptive_learn" : "percep_base",
    meta.strategy === "Cost" || meta.age === "Child" ? "basic_avoid" : "auto_follow",
    meta.age === "Child" ? "child_safety" : "privacy_trust",
    meta.age === "Child" ? "edu_content" : (meta.strategy === "Differentiation" ? "api_iot" : "cloud_update"),
    meta.customer === "ToB" ? "remote_monitor" : (meta.strategy === "Cost" ? "self_diag" : "remote_monitor")
  ];
}

async function selectCardsAndSubmit(page, strategy, expectWaiting) {
  await expect(page.locator("[data-testid='r2-card-selection-container']")).toBeVisible({ timeout: 30000 });
  const desiredCards = chooseCardPlan(parseGrid(strategy.grid_id));
  for (const cardId of desiredCards) {
    let card = page.locator(`[data-testid='r2-card-${cardId}']`).first();
    if (!(await card.count())) continue;
    await expect(card).toBeVisible({ timeout: 30000 });
    const checkbox = card.locator("input[type='checkbox']");
    if (!(await checkbox.isChecked())) {
      await checkbox.click();
    }
    const tierButton = card.locator(`[data-testid='r2-tier-${cardId}-LOW']`);
    if (await tierButton.count()) {
      await tierButton.click();
    }
  }

  const selectedText = await page.locator("[data-testid='r2-budget-display'] strong").innerText();
  expect(extractNumericValue(selectedText)).toBeGreaterThan(0);

  await page.getByRole("button", { name: /提交个人选卡/ }).click();
  if (expectWaiting) {
    await expect.poll(async () => {
      if (await page.locator("[data-testid='r2-merge-container']").isVisible().catch(() => false)) return "merge";
      if (await page.getByText("等待其他成员提交").isVisible().catch(() => false)) return "waiting";
      if (await page.locator("[data-testid='r2-card-selection-container']").isVisible().catch(() => false)) return "cards";
      return "pending";
    }, {
      timeout: 120000,
      intervals: [1000, 2000, 3000, 5000]
    }).not.toBe("pending");
    return;
  }
  await expect(page.locator("[data-testid='r2-merge-container']")).toBeVisible({ timeout: 120000 });
}

function getStrategyInputs(strategy) {
  const meta = parseGrid(strategy.grid_id);
  const isCost = meta.strategy === "Cost";
  const isB = meta.customer === "ToB";

  const base = (() => {
    if (isB && meta.age === "Elder") {
      return {
        who: "养老机构与社区照护服务团队",
        pain: "夜间巡视和日常照护人手紧张，异常情况响应不及时",
        how: isCost
          ? "用可规模化部署、易维护的陪护机器人分担巡视提醒与异常上报，降低照护成本"
          : "用具备情感陪伴、健康提醒和异常预警能力的机器人提升照护质量与差异化服务",
        coachMessages: [
          "我们的客户是养老机构和社区照护服务团队，场景是老人日常陪护与夜间巡视",
          isCost
            ? "他们最痛的是人手紧张和服务成本高，希望方案稳定、标准化、易维护"
            : "他们最痛的是照护质量不稳定和异常响应慢，希望服务更安心、更有温度"
        ],
        interviewScript: [
          "你们平时在老人日常照护里，最容易出现人手跟不上的时刻是什么？",
          "夜间巡视或者异常预警这类事情，现在最让你们头疼的细节是什么？",
          "如果引入新方案，你们最担心的是培训、维护还是误报漏报？",
          "真正会影响采购决策的，是成本、照护效果，还是家属满意度？",
          "你们最希望先把哪一个高频场景处理得更稳？"
        ],
        expectedAgeGroup: ""
      };
    }
    if (isB && meta.age === "Adult") {
      return {
        who: "企业服务团队与成人客户运营负责人",
        pain: "服务流程重复、响应体验一般，人工成本和服务一致性难兼顾",
        how: isCost
          ? "用标准化、可运维的机器人方案降低重复服务的人力成本并提升交付效率"
          : "用更有体验感和互动感的机器人方案提升成人客户服务体验与品牌差异化",
        coachMessages: [
          "我们的客户是企业服务团队，目标是改善成人用户或来访者的服务体验",
          isCost
            ? "他们更关注人力替代率、部署成本和维护效率"
            : "他们更关注服务体验、品牌感知和用户满意度提升"
        ],
        interviewScript: [
          "在你们服务成年用户或来访者的流程里，最容易让人不满意的环节是什么？",
          "如果把重复性的服务动作拆开看，哪一部分最耗人力却又最难标准化？",
          "你们现在最怕新方案带来的，是培训负担、兼容问题，还是落地效果不稳定？",
          "真正影响采购推进的，是预算、审批流程，还是服务效果难量化？",
          "如果只能先优化一个关键触点，你会优先选哪一步？"
        ],
        expectedAgeGroup: ""
      };
    }
    if (isB && meta.age === "Child") {
      return {
        who: "托管机构与儿童教育服务团队",
        pain: "老师和运营人员难以同时兼顾儿童陪伴、安全提醒与课堂秩序",
        how: isCost
          ? "用稳定易部署、低维护成本的机器人分担陪伴与提醒任务，提升运营效率"
          : "用更有互动性和学习体验的机器人提升儿童参与度与家长感知价值",
        coachMessages: [
          "我们的客户是托管和儿童教育服务团队，场景是课后陪伴、互动和安全提醒",
          isCost
            ? "他们最关注规模化部署成本、维护负担和老师是否容易上手"
            : "他们最关注互动体验、家长感知和机构差异化口碑"
        ],
        interviewScript: [
          "你们在托管或儿童教学现场，最容易顾不过来的时刻通常发生在什么时候？",
          "如果孩子人数一多，最影响秩序和体验的细节是什么？",
          "你们最担心新方案带来的是安全风险、老师负担，还是家长不认可？",
          "真正影响采购决策的，是预算、效果证明，还是合规与安全要求？",
          "如果先解决一个高频问题，你最希望优先缓解哪件事？"
        ],
        expectedAgeGroup: ""
      };
    }
    if (!isB && meta.age === "Elder") {
      return {
        who: "独居老人及其异地子女",
        pain: "老人日常孤独、提醒容易遗漏，异常情况发生后家属难以及时知道",
        how: isCost
          ? "通过低门槛、易上手的陪伴与提醒机器人，让老人更安心且家庭更可负担"
          : "通过情感陪伴、健康提醒和异常预警，让老人获得更有温度的日常支持",
        coachMessages: [
          "我们的目标用户是独居老人及其异地子女，场景是居家陪伴和日常提醒",
          isCost
            ? "他们最痛的是请人陪护太贵、设备又复杂，希望方案便宜、稳定、别折腾"
            : "他们最痛的是孤独感和异常无人知晓，希望机器人既能陪伴也能及时提醒家属"
        ],
        interviewScript: [
          "您一个人在家的时候，最不方便或者最让您不安心的时刻通常是什么？",
          "如果身体不舒服、忘记吃药或者临时需要帮忙，现在一般是谁来发现和处理？",
          "平时和家里人联系这件事，您觉得最麻烦或者最不满意的地方是什么？",
          "您会担心设备太复杂、不会用，还是更担心它不够可靠？",
          "如果先改善一件生活里的烦心事，您最希望优先解决什么？"
        ],
        expectedAgeGroup: "ELDER"
      };
    }
    if (!isB && meta.age === "Adult") {
      return {
        who: "独居或高压工作的城市成人",
        pain: "下班后孤独、情绪压力大，生活琐事提醒和自我照顾容易被拖延",
        how: isCost
          ? "用价格更可接受、维护更简单的陪伴机器人提供基础互动和提醒支持"
          : "用更懂情绪、更有互动感的陪伴机器人缓解孤独感并提升生活幸福感",
        coachMessages: [
          "我们的目标用户是独居或高压工作的城市成人，场景是下班后的陪伴和生活提醒",
          isCost
            ? "他们最痛的是孤独但不愿为高价设备付费，希望方案轻量、实用、负担小"
            : "他们最痛的是情绪压力和缺乏陪伴，希望产品能提供更有温度的互动体验"
        ],
        interviewScript: [
          "你下班回家之后，一般最容易在哪些时刻感到烦躁、空落或者提不起劲？",
          "生活里有哪些小事你明知道该做，但总是会拖到很晚甚至忘掉？",
          "如果多一个能陪你互动的设备，你最担心它显得打扰、幼稚，还是不够懂你？",
          "你现在用过的智能设备里，最让你失望的体验是什么？",
          "如果只能先改善一个下班后的场景，你最希望先解决哪件事？"
        ],
        expectedAgeGroup: "ADULT"
      };
    }
    return {
      who: "有儿童陪伴与教育需求的家庭",
      pain: "孩子独处时缺少高质量互动，家长在安全、陪伴和学习之间难以兼顾",
      how: isCost
        ? "用更可负担、易维护的互动机器人提供基础陪伴和提醒，减轻家长负担"
        : "用更有趣、更能互动和引导学习的机器人提升孩子陪伴体验与家长安心感",
      coachMessages: [
        "我们的目标用户是有儿童陪伴与教育需求的家庭，场景是放学后和居家互动",
        isCost
          ? "家长最痛的是高质量陪伴很贵又占时间，希望方案实用、耐用、成本可接受"
          : "家长最痛的是孩子陪伴质量和安全感，希望产品既有趣又让家长更安心"
      ],
      interviewScript: [
        "孩子放学回家或者自己玩的时候，最让你分心或者担心的通常是什么？",
        "如果大人一时顾不过来，孩子最需要的是陪玩、提醒，还是学习上的引导？",
        "你会更担心新设备不安全、内容无聊，还是很快就被孩子丢在一边？",
        "以前尝试过的玩具或智能设备，最让你不满意的地方是什么？",
        "如果先改善一个高频场景，你最想先解决哪件事？"
      ],
      expectedAgeGroup: ""
    };
  })();

  return {
    personalGridTestId: buildGridTestId(strategy.grid_id),
    teamGridTestId: buildGridTestId(strategy.grid_id),
    architectureTestId: buildArchTestId(strategy.architecture),
    teamArchitectureTestId: buildTeamArchTestId(strategy.architecture),
    vpDraft: `${base.who}，${base.pain}，${base.how}`,
    coachMessages: base.coachMessages,
    confirmedFieldFallbacks: {
      who_raw: base.who,
      pain_raw: base.pain,
      how_raw: base.how
    },
    interviewScript: base.interviewScript,
    expectedAgeGroup: base.expectedAgeGroup
  };
}

function buildStepRecorder() {
  const steps = {};
  return {
    async run(name, fn) {
      const startedAt = Date.now();
      try {
        const value = await fn();
        steps[name] = {
          passed: true,
          duration_ms: Date.now() - startedAt
        };
        return value;
      } catch (error) {
        steps[name] = {
          passed: false,
          duration_ms: Date.now() - startedAt,
          error: String(error.message || error)
        };
        throw error;
      }
    },
    steps
  };
}

async function launchSharedBrowser() {
  const preferredChannel = String(process.env.PLAYWRIGHT_CHROME_CHANNEL || "chrome").trim();
  if (preferredChannel) {
    try {
      return await chromium.launch({ channel: preferredChannel });
    } catch (error) {
      console.warn(`[UI-SIM] failed to launch channel=${preferredChannel}, fallback to bundled browser: ${error.message}`);
    }
  }
  return chromium.launch();
}

function choosePrice(recap) {
  const pmax = safeNumber(recap?.Pmax, 12000);
  const p = safeNumber(recap?.P, pmax);
  const wtp = safeNumber(recap?.WTP, pmax);
  const target = Math.min(pmax, Math.max(5000, Math.round(Math.max(p * 0.95, wtp * 0.75) / 100) * 100));
  return Number.isFinite(target) ? target : 12000;
}

async function fetchTeamExportJson(baseUrl, teamId) {
  const response = await fetchResource(baseUrl, `/api/test/export/${encodeURIComponent(teamId)}?format=json`, {
    headers: { "X-Test-Export": "true" }
  });
  if (!response.ok) {
    throw new Error(`team export failed (${teamId}): ${response.status} ${response.text}`);
  }
  return response.body;
}

async function runUiTeam(browser, apiRequest, baseUrl, apiClient, strategy, teamIndex) {
  const inputs = getStrategyInputs(strategy);
  const recorder = buildStepRecorder();
  const leaderContext = await browser.newContext(createContextOptions(baseUrl));
  const leaderPage = await leaderContext.newPage();
  const leaderMonitor = createConsoleMonitor(leaderPage);
  const leaderTracker = createNetworkTracker(leaderPage);
  const memberSessions = [];
  const errors = [];
  const startedAt = Date.now();
  let flowContext = null;
  let recapData = null;

  try {
    flowContext = await recorder.run("round1_ui_flow", () => runRound1Flow({
      page: leaderPage,
      request: apiRequest,
      monitor: leaderMonitor,
      tracker: leaderTracker,
      stepResults: [],
      freezeAtEnd: true,
      createViaUi: false,
      teamSize: 6,
      personalGridTestId: inputs.personalGridTestId,
      teamGridTestId: inputs.teamGridTestId,
      architectureTestId: inputs.architectureTestId,
      teamArchitectureTestId: inputs.teamArchitectureTestId,
      vpDraft: inputs.vpDraft,
      coachMessages: inputs.coachMessages,
      confirmedFieldFallbacks: inputs.confirmedFieldFallbacks
    }));

    recapData = await recorder.run("round2_recap_fetch", () => apiClient.getRecap(flowContext.teamId));

    await recorder.run("round2_open_contexts", async () => {
      const members = [...(flowContext.members || [])].sort((a, b) => a.index - b.index);
      const leaderMember = members.find((member) => member.id === flowContext.memberId) || members[0];
      memberSessions.push({
        context: leaderContext,
        page: leaderPage,
        member: leaderMember
      });
      for (const member of members) {
        if (member.id === leaderMember.id) continue;
        memberSessions.push(await openRound2Context(browser, baseUrl, flowContext.teamId, member));
      }
      await Promise.all(memberSessions.map((session) => enterRound2FromRecap(session.page)));
    });

    await recorder.run("round2_interviews_batch_1", async () => {
      await Promise.all(
        memberSessions.slice(0, 3).map((session) =>
          completeTwoInterviewsAndEnterCards(session.page, inputs.interviewScript, inputs.expectedAgeGroup)
        )
      );
    });

    await recorder.run("round2_interviews_batch_2", async () => {
      await Promise.all(
        memberSessions.slice(3).map((session) =>
          completeTwoInterviewsAndEnterCards(session.page, inputs.interviewScript, inputs.expectedAgeGroup)
        )
      );
    });

    await recorder.run("round2_member_card_submit", async () => {
      await Promise.all(memberSessions.slice(0, 5).map((session) => selectCardsAndSubmit(session.page, strategy, true)));
      await selectCardsAndSubmit(memberSessions[5].page, strategy, false);
      await Promise.all(
        memberSessions.map((session) =>
          expect(session.page.locator("[data-testid='r2-merge-container']")).toBeVisible({ timeout: 120000 })
        )
      );
    });

    await recorder.run("round2_team_merge_submit", async () => {
      const leaderPageRef = memberSessions[0].page;
      await leaderPageRef.getByRole("button", { name: /进入集体讨论/ }).click();
      await expect(leaderPageRef.locator("[data-testid='r2-price-input']")).toBeVisible({ timeout: 30000 });
      await setRangeValue(leaderPageRef, "[data-testid='r2-price-input']", choosePrice(recapData));
      await leaderPageRef.getByRole("button", { name: /确认产品方案与定价/ }).click();
      await expect(leaderPageRef.locator("[data-testid='r2-final-submit']")).toBeVisible({ timeout: 30000 });
      await leaderPageRef.locator("[data-testid='r2-final-submit']").click();
    });

    await recorder.run("round2_results_visible", async () => {
      await Promise.all(
        memberSessions.map((session) =>
          expect(session.page.locator("[data-testid='r2-results-container']")).toBeVisible({ timeout: 120000 })
        )
      );
      const profitText = await memberSessions[0].page.locator("[data-testid='r2-profit-value']").innerText();
      const profitValue = safeNumber(String(profitText).replace(/[^\d.-]/g, ""), null);
      if (profitValue == null) {
        throw new Error(`invalid profit text: ${profitText}`);
      }
    });

    return {
      teamIndex,
      teamId: flowContext.teamId,
      status: "passed",
      steps: recorder.steps,
      timing: {
        total_ms: Date.now() - startedAt
      },
      warnings: leaderMonitor.getReport().warnings,
      errors,
      meta: {
        expected_grid: strategy.grid_id,
        expected_arch: strategy.architecture,
        actual_grid: strategy.grid_id,
        actual_arch: strategy.architecture,
        member_count: flowContext.members?.length || 0,
        vp_score: recapData?.vp_score || 0
      }
    };
  } catch (error) {
    errors.push({ message: String(error.message || error) });
    return {
      teamIndex,
      teamId: flowContext?.teamId || "",
      status: "failed",
      steps: recorder.steps,
      timing: {
        total_ms: Date.now() - startedAt
      },
      warnings: leaderMonitor.getReport().warnings,
      errors,
      meta: {
        expected_grid: strategy.grid_id,
        expected_arch: strategy.architecture
      }
    };
  } finally {
    leaderTracker.dispose();
    leaderMonitor.dispose();
    await Promise.all(memberSessions.map(async (session) => {
      if (session.context && session.context !== leaderContext) {
        await session.context.close().catch(() => {});
      }
    }));
    await leaderContext.close().catch(() => {});
  }
}

async function loadDbRows(pool, teamIds) {
  const ids = teamIds.filter(Boolean);
  const [teams, members, submissions, settlements, assignments, interviews, selections, vpIterations, vpSessions] = await Promise.all([
    pool.query(`
      SELECT id, team_name, team_size, leader_member_id, final_grid_id, final_architecture,
             final_target_gm, final_sam, final_wtp_adj, final_wtp_ref,
             final_vp_c, final_vp_g, final_vp_e_adj, final_vp_scores, final_vp_text, created_at
      FROM teams
      WHERE id = ANY($1::text[])
      ORDER BY created_at ASC
    `, [ids]),
    pool.query(`
      SELECT id, team_id, member_name, member_index, is_leader, jinang_market_id, jinang_tech_id, vp_confirmed_fields, vp_scores
      FROM team_members
      WHERE team_id = ANY($1::text[])
      ORDER BY team_id ASC, member_index ASC
    `, [ids]),
    pool.query(`
      SELECT member_id, team_id, grid_id, architecture, vp_draft, personal_gm_max, submitted_at
      FROM member_submissions
      WHERE team_id = ANY($1::text[])
      ORDER BY team_id ASC, submitted_at ASC
    `, [ids]),
    pool.query(`
      SELECT team_id, member_id, jinang_id, jinang_type, matched, match_reason, effect_applied
      FROM jinang_settlements
      WHERE team_id = ANY($1::text[])
      ORDER BY team_id ASC, member_id ASC
    `, [ids]),
    pool.query(`
      SELECT team_id, assignments_json, updated_at
      FROM round2_dimension_assignments
      WHERE team_id = ANY($1::text[])
    `, [ids]),
    pool.query(`
      SELECT session_id, team_id, member_id, member_dims_json, personas_json, history_json, result_json,
             round_no, is_complete, created_at, updated_at
      FROM round2_interview_sessions
      WHERE team_id = ANY($1::text[])
      ORDER BY team_id ASC, created_at ASC, updated_at ASC
    `, [ids]),
    pool.query(`
      SELECT team_id, member_id, selections_json, updated_at
      FROM round2_member_selections
      WHERE team_id = ANY($1::text[])
      ORDER BY team_id ASC, member_id ASC
    `, [ids]),
    pool.query(`
      SELECT team_id, session_id, member_id, iteration, trigger, speaker_name, speaker_persona,
             vp_before, vp_after, score_before, score_after, score_c, score_g, score_e, created_at
      FROM vp_iterations
      WHERE team_id = ANY($1::text[])
      ORDER BY team_id ASC, iteration ASC, created_at ASC
    `, [ids]),
    pool.query(`
      SELECT session_id, team_key, messages, pmf_score, created_at, updated_at
      FROM vp_sessions
      WHERE team_key = ANY($1::text[])
      ORDER BY team_key ASC, created_at ASC
    `, [ids])
  ]);

  return {
    teams: teams.rows,
    members: members.rows,
    submissions: submissions.rows,
    settlements: settlements.rows,
    assignments: assignments.rows,
    interviews: interviews.rows,
    selections: selections.rows,
    vpIterations: vpIterations.rows,
    vpSessions: vpSessions.rows
  };
}

function buildMaps(dbRows) {
  const maps = {
    teamById: new Map(),
    membersByTeam: new Map(),
    memberById: new Map(),
    submissionByMember: new Map(),
    settlementsByMember: new Map(),
    assignmentsByTeam: new Map(),
    interviewsByTeam: new Map(),
    interviewsByMember: new Map(),
    latestInterviewByMember: new Map(),
    selectionsByMember: new Map(),
    vpIterationsByTeam: new Map(),
    vpSessionsByTeam: new Map()
  };

  for (const team of dbRows.teams) {
    maps.teamById.set(team.id, team);
  }
  for (const row of dbRows.members) {
    maps.memberById.set(row.id, row);
    if (!maps.membersByTeam.has(row.team_id)) maps.membersByTeam.set(row.team_id, []);
    maps.membersByTeam.get(row.team_id).push(row);
  }
  for (const row of dbRows.submissions) {
    maps.submissionByMember.set(row.member_id, row);
  }
  for (const row of dbRows.settlements) {
    if (!maps.settlementsByMember.has(row.member_id)) maps.settlementsByMember.set(row.member_id, []);
    maps.settlementsByMember.get(row.member_id).push(row);
  }
  for (const row of dbRows.assignments) {
    maps.assignmentsByTeam.set(row.team_id, parseJson(row.assignments_json, []));
  }
  for (const row of dbRows.interviews) {
    const parsedRow = {
      ...row,
      member_dims: parseJson(row.member_dims_json, []),
      personas: parseJson(row.personas_json, []),
      history: parseJson(row.history_json, []),
      result: parseJson(row.result_json, {})
    };
    if (!maps.interviewsByTeam.has(row.team_id)) maps.interviewsByTeam.set(row.team_id, []);
    maps.interviewsByTeam.get(row.team_id).push(parsedRow);
    if (!maps.interviewsByMember.has(row.member_id)) maps.interviewsByMember.set(row.member_id, []);
    maps.interviewsByMember.get(row.member_id).push(parsedRow);
    const prev = maps.latestInterviewByMember.get(row.member_id);
    if (!prev || new Date(prev.updated_at).getTime() <= new Date(row.updated_at).getTime()) {
      maps.latestInterviewByMember.set(row.member_id, parsedRow);
    }
  }
  for (const row of dbRows.selections) {
    maps.selectionsByMember.set(row.member_id, parseJson(row.selections_json, []));
  }
  for (const row of dbRows.vpIterations) {
    if (!maps.vpIterationsByTeam.has(row.team_id)) maps.vpIterationsByTeam.set(row.team_id, []);
    maps.vpIterationsByTeam.get(row.team_id).push(row);
  }
  for (const row of dbRows.vpSessions) {
    if (!maps.vpSessionsByTeam.has(row.team_key)) maps.vpSessionsByTeam.set(row.team_key, []);
    maps.vpSessionsByTeam.get(row.team_key).push({
      ...row,
      messages: parseJson(row.messages, []),
      pmf_score: parseJson(row.pmf_score, {})
    });
  }

  for (const members of maps.membersByTeam.values()) {
    members.sort((a, b) => Number(a.member_index || 0) - Number(b.member_index || 0));
  }

  return maps;
}

function buildCardMaps() {
  const config = loadJinangConfig();
  return {
    market: new Map((config.market || []).map((card) => [card.id, card])),
    tech: new Map((config.tech || []).map((card) => [card.id, card]))
  };
}

function computeMatchStrength(settlement) {
  const effect = parseJson(settlement?.effect_applied, {});
  const value = Number(effect?.match_strength ?? settlement?.match_strength ?? 0);
  return Number.isFinite(value) ? value : 0;
}

function extractVpField(text, label) {
  const src = String(text || "");
  const match = src.match(new RegExp(`${label}\\s*[：:]\\s*([^\\n]+)`));
  return match ? match[1].trim() : "";
}

function buildJinangEffectRows(runId, teamOrder, maps) {
  const rows = [];
  const savingByMember = new Map();
  for (const teamId of teamOrder) {
    const teamIndex = teamOrder.indexOf(teamId);
    for (const member of maps.membersByTeam.get(teamId) || []) {
      const settlements = maps.settlementsByMember.get(member.id) || [];
      const techSettlement = settlements.find((item) => item.jinang_type === "tech" && item.matched);
      if (!techSettlement) continue;
      const selections = maps.selectionsByMember.get(member.id) || [];
      const effectApplied = parseJson(techSettlement.effect_applied, {});
      const adjusted = applyTechJinnang(selections, {
        effect_applied: effectApplied,
        match_strength: effectApplied.match_strength || computeMatchStrength(techSettlement)
      });
      for (const item of adjusted) {
        const saving = Number(item.dCOGS_base || 0) - Number(item.dCOGS_eff || 0);
        const riskSaving = Number(item.risk_base || 0) - Number(item.risk_eff || 0);
        if (saving <= 0 && riskSaving <= 0) continue;
        const meta = CAPABILITY_MAP.get(item.cap_id) || {};
        rows.push({
          run_id: runId,
          team_index: teamIndex,
          team_id: teamId,
          member_id: member.id,
          member_name: member.member_name,
          persona: "",
          jinang_tech_name: member.jinang_tech_id || "",
          match_strength: roundNumber(computeMatchStrength(techSettlement), 4, ""),
          cap_id: item.cap_id,
          cap_name: meta.cap_name || item.cap_id,
          dimension: meta.dimension || "",
          tier: item.tier || "",
          original_dCOGS: roundNumber(item.dCOGS_base, 2, ""),
          discounted_dCOGS: roundNumber(item.dCOGS_eff, 2, ""),
          saving: roundNumber(saving, 2, ""),
          original_risk: roundNumber(item.risk_base, 2, ""),
          discounted_risk: roundNumber(item.risk_eff, 2, ""),
          risk_saving: roundNumber(riskSaving, 2, "")
        });
        savingByMember.set(member.id, (savingByMember.get(member.id) || 0) + saving);
      }
    }
  }
  return { rows, savingByMember };
}

function countTeamLlmCalls(entries, teamId) {
  return (entries || []).filter((entry) => entry.teamId === teamId).length;
}

function buildInterviewLogRows(runId, teamOrder, maps) {
  const rows = [];
  for (const teamId of teamOrder) {
    const teamIndex = teamOrder.indexOf(teamId);
    for (const member of maps.membersByTeam.get(teamId) || []) {
      const sessions = maps.interviewsByMember.get(member.id) || [];
      for (const session of sessions) {
        const persona = Array.isArray(session.personas) && session.personas.length > 0 ? session.personas[0] : {};
        let turnNumber = 0;
        for (const message of session.history || []) {
          const text = String(message?.text || message?.content || "").trim();
          if (!text) continue;
          turnNumber += 1;
          rows.push({
            run_id: runId,
            team_index: teamIndex,
            member_index: member.member_index,
            member_name: member.member_name,
            member_persona: "",
            interview_persona_id: String(persona?.id || persona?.persona_id || "").trim(),
            interview_persona_name: String(persona?.name || "").trim(),
            turn_number: turnNumber,
            role: String(message?.role || "") === "user" ? "interviewer" : "interviewee",
            message_text: text
          });
        }
      }
    }
  }
  return rows;
}

function buildVpChatLogRows(runId, teamOrder, maps) {
  const rows = [];
  for (const teamId of teamOrder) {
    const teamIndex = teamOrder.indexOf(teamId);
    const team = maps.teamById.get(teamId);
    const leader = maps.memberById.get(team?.leader_member_id || "");
    const sessions = maps.vpSessionsByTeam.get(teamId) || [];
    let roundNumber = 0;
    for (const session of sessions) {
      const messages = Array.isArray(session.messages) ? session.messages : [];
      for (let index = 0; index < messages.length; index += 1) {
        const current = messages[index];
        if (String(current?.role || "") !== "assistant") continue;
        roundNumber += 1;
        const nextUser = messages.slice(index + 1).find((message) => String(message?.role || "") === "user");
        rows.push({
          run_id: runId,
          team_index: teamIndex,
          round_number: roundNumber,
          coach_message: String(current?.content || "").trim(),
          speaker_persona: "",
          speaker_name: leader?.member_name || "",
          speaker_reply: String(nextUser?.content || "").trim(),
          lead_writer_persona: "",
          lead_writer_name: leader?.member_name || "",
          vp_before: "",
          vp_after: "",
          score_product_before: "",
          score_product_after: roundNumber === 1 ? "" : "",
          score_C: roundNumber === 1 ? "" : "",
          score_G: roundNumber === 1 ? "" : "",
          score_E: roundNumber === 1 ? "" : ""
        });
      }
    }
  }
  return rows;
}

function buildVpIterationRows(runId, teamOrder, maps) {
  const rows = [];
  for (const teamId of teamOrder) {
    const teamIndex = teamOrder.indexOf(teamId);
    for (const row of maps.vpIterationsByTeam.get(teamId) || []) {
      const vpBefore = String(row.vp_before || "").trim();
      const vpAfter = String(row.vp_after || "").trim();
      const vpWhoBefore = extractVpField(vpBefore, "WHO");
      const vpPainBefore = extractVpField(vpBefore, "PAIN");
      const vpHowBefore = extractVpField(vpBefore, "HOW");
      const vpWho = extractVpField(vpAfter, "WHO");
      const vpPain = extractVpField(vpAfter, "PAIN");
      const vpHow = extractVpField(vpAfter, "HOW");
      rows.push({
        run_id: runId,
        team_index: teamIndex,
        iteration: row.iteration,
        trigger: row.trigger,
        speaker_persona: row.speaker_persona || "",
        speaker_name: row.speaker_name || "",
        vp_text: vpAfter,
        vp_who: vpWho,
        vp_pain: vpPain,
        vp_how: vpHow,
        score_C: roundNumber(row.score_c, 4, ""),
        score_G: roundNumber(row.score_g, 4, ""),
        score_E: roundNumber(row.score_e, 4, ""),
        score_product: roundNumber(row.score_after, 4, ""),
        who_changed: String(vpWhoBefore || "") !== String(vpWho || ""),
        pain_changed: String(vpPainBefore || "") !== String(vpPain || ""),
        how_changed: String(vpHowBefore || "") !== String(vpHow || ""),
        coach_reply: "",
        speaker_reply: ""
      });
    }
  }
  return rows;
}

function countEvidenceDetails(result) {
  const dimensionEvidence = result?.dimensionEvidence || {};
  const evidenceBlocks = Object.values(dimensionEvidence).filter((item) => item && typeof item === "object");
  return {
    evidenceCount: evidenceBlocks.reduce((sum, item) => sum + (Array.isArray(item.evidence) ? item.evidence.length : 0), 0),
    strongDimCount: evidenceBlocks.filter((item) => item.strength === "strong").length,
    missingDimCount: Array.isArray(result?.missingDimensions) ? result.missingDimensions.length : 0
  };
}

function buildStudentSummaryRows(runId, teamOrder, exportPayloads, maps, cardMaps, savingByMember) {
  const rows = [];
  for (const teamId of teamOrder) {
    const teamIndex = teamOrder.indexOf(teamId);
    const teamExport = exportPayloads[teamId] || {};
    const extractedFields = teamExport.vpCoach?.extractedFields || {};
    const assignments = maps.assignmentsByTeam.get(teamId) || [];
    const dimsByMember = new Map(assignments.map((item) => [item.memberId || item.member_id, Array.isArray(item.dims || item.dimensions) ? (item.dims || item.dimensions) : []]));
    for (const member of maps.membersByTeam.get(teamId) || []) {
      const settlements = maps.settlementsByMember.get(member.id) || [];
      const marketSettlement = settlements.find((item) => item.jinang_type === "market");
      const techSettlement = settlements.find((item) => item.jinang_type === "tech");
      const submission = maps.submissionByMember.get(member.id) || {};
      const latestInterview = maps.latestInterviewByMember.get(member.id) || {};
      const interviewSessions = maps.interviewsByMember.get(member.id) || [];
      const result = latestInterview.result || {};
      const radar = result.radar || {};
      const evidenceInfo = countEvidenceDetails(result);
      const selections = maps.selectionsByMember.get(member.id) || [];
      rows.push({
        run_id: runId,
        team_index: teamIndex,
        member_index: member.member_index,
        name: member.member_name,
        persona: "",
        gender: "",
        mbti: "",
        age: "",
        education: "",
        has_overseas: "",
        industry: "",
        seed_memory_json: "",
        classroom_profile_json: "",
        jinang_market: cardMaps.market.get(member.jinang_market_id)?.name || member.jinang_market_id || "",
        jinang_tech: cardMaps.tech.get(member.jinang_tech_id)?.name || member.jinang_tech_id || "",
        jinang_market_match: roundNumber(computeMatchStrength(marketSettlement), 4, ""),
        jinang_tech_match: roundNumber(computeMatchStrength(techSettlement), 4, ""),
        r1_grid: submission.grid_id || "",
        r1_arch: submission.architecture || "",
        r1_personal_wtp_adj: "",
        r1_who: extractedFields.WHO || "",
        r1_pain: extractedFields.PAIN || "",
        r1_how: extractedFields.HOW || "",
        r2_dims: JSON.stringify(dimsByMember.get(member.id) || []),
        r2_interview_turns: interviewSessions.reduce((sum, session) => sum + (Array.isArray(session.history) ? session.history.filter((item) => String(item?.role || "") === "user").length : 0), 0),
        r2_evi: roundNumber(result.evi, 4, ""),
        r2_evidence_count: evidenceInfo.evidenceCount,
        r2_strong_dim_count: evidenceInfo.strongDimCount,
        r2_missing_dim_count: evidenceInfo.missingDimCount,
        r2_radar_perception: roundNumber(radar.perception, 4, ""),
        r2_radar_motion: roundNumber(radar.motion, 4, ""),
        r2_radar_interaction: roundNumber(radar.interaction, 4, ""),
        r2_radar_safety: roundNumber(radar.safety, 4, ""),
        r2_radar_extension: roundNumber(radar.extend, 4, ""),
        r2_radar_maintenance: roundNumber(radar.ops, 4, ""),
        r2_cards_selected: selections.length,
        r2_high_tier_count: selections.filter((item) => String(item?.tier || "").toUpperCase() === "HIGH").length,
        r2_jinang_dCOGS_saved: roundNumber(savingByMember.get(member.id) || 0, 2, "")
      });
    }
  }
  return rows;
}

function buildStudentRoster(teamOrder, maps, cardMaps) {
  return teamOrder.map((teamId, teamIndex) => {
    const team = maps.teamById.get(teamId) || {};
    return {
      team_index: teamIndex,
      team_id: teamId,
      target_grid: team.final_grid_id || FULL_GRID_STRATEGIES[teamIndex]?.grid_id || "",
      target_arch: team.final_architecture || FULL_GRID_STRATEGIES[teamIndex]?.architecture || "",
      members: (maps.membersByTeam.get(teamId) || []).map((member) => ({
        member_id: member.id,
        member_index: member.member_index,
        name: member.member_name,
        is_leader: member.is_leader === true,
        jinang_market_id: member.jinang_market_id || "",
        jinang_market: cardMaps.market.get(member.jinang_market_id)?.name || "",
        jinang_tech_id: member.jinang_tech_id || "",
        jinang_tech: cardMaps.tech.get(member.jinang_tech_id)?.name || ""
      }))
    };
  });
}

function buildTeamSummaryRows(teamOrder, exportPayloads, computationChains, maps, jinangEffectRows, llmEntries) {
  const jinangSavingsByTeam = new Map();
  for (const row of jinangEffectRows) {
    jinangSavingsByTeam.set(row.team_id, (jinangSavingsByTeam.get(row.team_id) || 0) + Number(row.saving || 0));
  }

  return teamOrder.map((teamId, teamIndex) => {
    const exportData = exportPayloads[teamId] || {};
    const teamRow = maps.teamById.get(teamId) || {};
    const chain = computationChains[teamId] || {};
    const coverage = chain.latest_chain?.r2_coverage || {};
    const profit = chain.latest_chain?.r2_profit || {};
    const volume = chain.latest_chain?.r2_volume || {};
    const tagStage = chain.latest_chain?.r2_tag_layering || {};
    const rawTags = Array.isArray(tagStage.tags) ? tagStage.tags : (exportData.round2?.interview?.sessions || []).flatMap((session) => session.tags || []);
    const coreTags = Array.isArray(tagStage.core_tags)
      ? tagStage.core_tags
      : rawTags.filter((item) => String(item?.tier || "").trim() === "core").map((item) => normalizeTag(item));
    const niceTags = Array.isArray(tagStage.nice_tags)
      ? tagStage.nice_tags
      : rawTags.filter((item) => String(item?.tier || "").trim() === "nice").map((item) => normalizeTag(item));
    const allTags = rawTags.map((item) => normalizeTag(item)).filter(Boolean);
    const finalGrid = normalizeGridId(teamRow.final_grid_id || exportData.members?.[0]?.strategy?.grid || FULL_GRID_STRATEGIES[teamIndex].grid_id);
    const finalArch = teamRow.final_architecture || exportData.members?.[0]?.strategy?.architecture || FULL_GRID_STRATEGIES[teamIndex].architecture;
    const conflictingTags = findConflictingTags(allTags, finalGrid);
    const calculations = exportData.round2?.calculations || {};
    const llmCalls = countTeamLlmCalls(llmEntries, teamId);
    const r1WtpAdj = safeNumber(chain.latest_chain?.r1_wtp_adj?.WTPadj || teamRow.final_wtp_adj, null);

    return {
      team_index: teamIndex,
      team_id: teamId,
      grid: finalGrid,
      arch: finalArch,
      r1_wtp_ref: roundNumber(teamRow.final_wtp_ref, 2, ""),
      r1_sam_billion: roundNumber(teamRow.final_sam, 4, ""),
      vp_C: roundNumber(exportData.scoring?.C || teamRow.final_vp_c, 4, ""),
      vp_G: roundNumber(exportData.scoring?.G || teamRow.final_vp_g, 4, ""),
      vp_E: roundNumber(exportData.scoring?.E || teamRow.final_vp_e_adj, 4, ""),
      vp_score: roundNumber(exportData.scoring?.vpScore, 4, ""),
      r2_cards: (exportData.round2?.selections || []).map((item) => `${item.cap_id}:${item.tier}`).join("|"),
      r2_dCOGS: roundNumber(calculations.totalDCOGS || profit.dCOGS, 2, ""),
      r2_NRE: roundNumber(chain.latest_chain?.r2_product_scores?.NRE || profit.NRE, 2, ""),
      r2_price: roundNumber(calculations.price, 2, ""),
      r2_price_vs_wtp: roundNumber(
        safeNumber(calculations.price, null) != null && safeNumber(r1WtpAdj, null) > 0
          ? safeNumber(calculations.price) / safeNumber(r1WtpAdj)
          : chain.latest_chain?.r2_profit?.price_vs_wtp,
        4,
        ""
      ),
      tags_count: allTags.length,
      core_tags: coreTags.filter(Boolean).join("|"),
      nice_tags: niceTags.filter(Boolean).join("|"),
      conflicting_tags: conflictingTags.join("|"),
      coverCore: roundNumber(coverage.coverCore, 4, ""),
      coverNice: roundNumber(coverage.coverNice, 4, ""),
      r2_gross_margin: roundNumber(profit.actual_gm, 4, ""),
      r2_share: roundNumber(calculations.share || volume.share, 6, ""),
      r2_units: roundNumber(calculations.units || volume.Q, 2, ""),
      r2_profit_hw: roundNumber(profit.profit_hw, 2, ""),
      r2_profit_sub: roundNumber(profit.profit_sub, 2, ""),
      r2_profit: roundNumber(calculations.profit || profit.total_profit, 2, ""),
      r2_is_profitable: safeNumber(calculations.profit || profit.total_profit, null) != null
        ? String(safeNumber(calculations.profit || profit.total_profit, 0) > 0)
        : "",
      jinang_dCOGS_saved_total: roundNumber(jinangSavingsByTeam.get(teamId) || 0, 2, ""),
      total_llm_calls: llmCalls
    };
  });
}

function buildTeamValidations(results, summaryRows, computationChains, interviewRows) {
  const resultByTeamId = new Map();
  for (const item of results) {
    resultByTeamId.set(item.teamId, item);
  }
  const leaksByTeam = new Map();
  for (const row of interviewRows) {
    if (row.role !== "interviewee") continue;
    if (!hasPersonaLeak(row.message_text)) continue;
    if (!leaksByTeam.has(row.team_id)) leaksByTeam.set(row.team_id, []);
    leaksByTeam.get(row.team_id).push({
      member_name: row.member_name,
      text: row.message_text
    });
  }

  return summaryRows.map((row) => {
    const expected = FULL_GRID_STRATEGIES[row.team_index] || {};
    const chain = computationChains[row.team_id] || {};
    const missingStages = REQUIRED_CHAIN_STAGES.filter((stage) => {
      const params = chain.latest_chain?.[stage];
      return !params || (typeof params === "object" && Object.keys(params).length === 0);
    });
    const profitValue = safeNumber(row.r2_profit, null);
    const validations = {
      team_steps_passed: resultByTeamId.get(row.team_id)?.status === "passed",
      grid_match: row.grid === expected.grid_id,
      arch_match: row.arch === expected.architecture,
      tags_min: Number(row.tags_count || 0) >= 5,
      cover_core_positive: safeNumber(row.coverCore, 0) > 0,
      vp_score_positive: safeNumber(row.vp_score, 0) > 0,
      profit_finite: profitValue != null,
      no_conflicting_tags: String(row.conflicting_tags || "").trim() === "",
      no_persona_leak: !leaksByTeam.has(row.team_id),
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
      persona_leaks: leaksByTeam.get(row.team_id) || []
    };
  });
}

function buildReport(results, validations, exportMeta) {
  const validationByTeamId = new Map();
  validations.forEach((item) => validationByTeamId.set(item.team_id, item));
  const teams = results.map((result, index) => ({
    team_index: index,
    team_id: result.teamId || "",
    status: result.status || "failed",
    pass: Boolean(validationByTeamId.get(result.teamId)?.pass),
    steps: sanitizeForJson(result.steps || {}),
    timing: sanitizeForJson(result.timing || {}),
    warnings: sanitizeForJson(result.warnings || []),
    errors: sanitizeForJson(result.errors || []),
    meta: sanitizeForJson(result.meta || {}),
    validation: sanitizeForJson(validationByTeamId.get(result.teamId) || {})
  }));

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
    return { file, exists, size };
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

  const baseUrl = process.env.BASE_URL || resolveBaseUrl() || "http://127.0.0.1:8787";
  const adminCode = String(process.env.ADMIN_CODE || "").trim();
  const sessionId = "default";
  const numTeams = 12;
  const startedAt = Date.now();

  if (!adminCode) {
    throw new Error("ADMIN_CODE not configured");
  }

  const api = new ApiClient(baseUrl);
  await api.health();

  console.log("\n12-grid full UI simulation");
  console.log(`base_url=${baseUrl}`);
  console.log(`teams=${numTeams} team_size=6`);

  const resetInfo = await resetTeacherSession(baseUrl, adminCode);
  console.log(`teacher session reset: deleted_teams=${resetInfo.deleted_teams || 0} deleted_members=${resetInfo.deleted_members || 0}`);

  const browser = await launchSharedBrowser();
  const apiRequest = await request.newContext({ baseURL: baseUrl, ignoreHTTPSErrors: true });
  const results = [];
  try {
    for (let teamIndex = 0; teamIndex < FULL_GRID_STRATEGIES.length; teamIndex += 1) {
      const strategy = FULL_GRID_STRATEGIES[teamIndex];
      console.log(`[UI-SIM] team ${teamIndex + 1}/${FULL_GRID_STRATEGIES.length} ${strategy.grid_id} / ${strategy.architecture}`);
      results.push(await runUiTeam(browser, apiRequest, baseUrl, api, strategy, teamIndex));
    }
  } finally {
    await apiRequest.dispose().catch(() => {});
    await browser.close().catch(() => {});
  }

  const teamIds = results.map((item) => item.teamId).filter(Boolean);
  const runId = new Date().toISOString().replace(/[:.]/g, "-");
  const logDir = path.join("data", "persona_sim_logs", runId);
  ensureDir(logDir);

  const exportPayloads = {};
  for (const teamId of teamIds) {
    exportPayloads[teamId] = await fetchTeamExportJson(baseUrl, teamId);
  }

  try {
    await fetch(`${baseUrl}/api/admin/flush-llm-logs`, { method: "POST" });
  } catch (_) {}

  const computationChains = {};
  for (const teamId of teamIds) {
    const raw = await api.getComputationChain(teamId);
    computationChains[teamId] = buildComputationExport(raw);
  }
  writeJson(path.join(logDir, "computation_log.json"), computationChains);

  const pool = new Pool();
  const dbRows = await loadDbRows(pool, teamIds);
  await pool.end();

  const maps = buildMaps(dbRows);
  const cardMaps = buildCardMaps();
  const roster = buildStudentRoster(teamIds, maps, cardMaps);
  writeJson(path.join(logDir, "student_roster.json"), roster);

  const llmDates = fetchDatesBetween(startedAt, Date.now());
  const llmEntries = llmDates
    .flatMap((date) => readLogEntries(date))
    .filter((entry) => {
      const ts = new Date(entry.timestamp || "").getTime();
      return Number.isFinite(ts) && ts >= startedAt;
    });

  const { rows: jinangEffectRows, savingByMember } = buildJinangEffectRows(runId, teamIds, maps);
  writeCsv(path.join(logDir, "jinang_effects.csv"), JINANG_EFFECT_COLUMNS, jinangEffectRows);

  const interviewRows = buildInterviewLogRows(runId, teamIds, maps).map((row) => ({
    ...row,
    team_id: teamIds[row.team_index] || ""
  }));
  writeCsv(path.join(logDir, "interview_log.csv"), INTERVIEW_LOG_COLUMNS, interviewRows);

  const vpChatRows = buildVpChatLogRows(runId, teamIds, maps);
  writeCsv(path.join(logDir, "vp_chat_log.csv"), VP_CHAT_LOG_COLUMNS, vpChatRows);

  const vpIterationRows = buildVpIterationRows(runId, teamIds, maps);
  writeCsv(path.join(logDir, "vp_iterations.csv"), VP_ITERATION_COLUMNS, vpIterationRows);

  const studentSummaryRows = buildStudentSummaryRows(runId, teamIds, exportPayloads, maps, cardMaps, savingByMember);
  writeCsv(path.join(logDir, "students_summary.csv"), STUDENT_SUMMARY_COLUMNS, studentSummaryRows);

  const summaryRows = buildTeamSummaryRows(teamIds, exportPayloads, computationChains, maps, jinangEffectRows, llmEntries);
  writeCsv(path.join(logDir, "teams_summary.csv"), TEAM_SUMMARY_COLUMNS, summaryRows);

  const teacher = await captureTeacherArtifacts(baseUrl, adminCode, sessionId, logDir);
  const validations = buildTeamValidations(results, summaryRows, computationChains, interviewRows);
  const reportPayload = buildReport(results, validations, {
    base_url: baseUrl,
    run_id: runId,
    session_id: sessionId,
    mode: "full_ui"
  });
  writeJson(path.join(logDir, "report.json"), reportPayload);

  const teacherCaptureSummary = buildTeacherCaptureSummary({
    runId,
    sessionId,
    logDir,
    exportSummary: {
      interview_rows: interviewRows.length,
      vp_chat_rows: vpChatRows.length,
      vp_iteration_rows: vpIterationRows.length,
      jinang_effect_rows: jinangEffectRows.length,
      student_rows: studentSummaryRows.length,
      team_rows: summaryRows.length
    },
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
