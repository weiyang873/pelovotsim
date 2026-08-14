const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { runSql, sqlQuote } = require("../db/pgSql");

const Engine = require("../../engine");
const TeamRoutes = require("./teamRoutes");
const { chatCompletion, hasAnyKey } = require("../llm/deepseekClient");
const { withLlmLogging } = require("../llm/llm_logger");
const { generatePersona } = require("../llm/personaGenerator");
const { getTeamSessions } = require("../llm/sessions");
const { getTeam, setTeamLeader } = require("../multiplayer/teamManager");
const { scheduleStages } = require("../multiplayer/computationLog");
const {
  calculate,
  computeProductMarketMatch,
  validateSelections,
  computeSoftPenalties,
  getCapabilityParams,
  CAP_GROUPS,
  GLOBAL_PARAMS,
  computeWTPParams
} = require("../llm/rdCalculator");
const { assignDimensions, mergeTeamSelections } = require("../multiplayer/rdTeamAdapter");
const { getRound2MarketInfo } = require("../multiplayer/marketInfo");
const {
  ensureSchema: ensureRound2StateSchema,
  updateTeamRound2Status,
  updateMemberProgress,
  updateTeamRound2StatusFromInterviewCompletion,
  updateTeamRound2StatusFromCardSubmissions,
  statusIndex,
  getTeamRound2State,
  logTeacherAction
} = require("../multiplayer/round2State");
const {
  SUMMARY_FLOW_VERSION,
  loadPersonaArchetypes,
  generatePersonaReports,
  buildSummaryModeRadarResult
} = require("../multiplayer/round2SummaryMode");
const { getSessionConfig } = require("../multiplayer/sessionConfig");
const {
  PRICE_SCALE,
  MONEY_SCALE_CONTRACT,
  scaleStoredMoney
} = require("../multiplayer/moneyScale");
const {
  loadRound2PricingContextConfig,
  validateRound2Price
} = require("../multiplayer/pricingContext");
const TAG_MAP = require("../../data/tag_map_v2_1.json");

const ROOT = path.join(__dirname, "..", "..");
let __round2RoutesSchemaPromise = null;
const ROUND2_LLM_TIMEOUT_MS = 60000;
const CONFIG_DIR = path.join(ROOT, "game_config_v0.1");
const GRID_PRIOR_PATH = path.join(ROOT, "data", "grid_priors_v4_cap_weights.json");
const STATIC_PERSONA_REPORTS_PATH = path.join(CONFIG_DIR, "persona_reports_v1.3.json");
const GRID_DIMENSION_EVIDENCE_PATH = path.join(CONFIG_DIR, "grid_dimension_evidence_v2.json");
let cachedEngineConfig = null;
let cachedGridPriors = null;
let cachedStaticPersonaReports = null;
let cachedGridDimensionEvidence = null;
const ROUND2_PERSONA_POOL_VERSION = 5;
const SUMMARY_DYNAMIC_EVI_MAX = 0.85;
const LEGACY_LIVE_EVI_FALLBACK = 0.7;
const ROUND1_NOT_FINALIZED_MESSAGE = "第一轮尚未定稿,无法进行第二轮操作";

const DIM_KEYS_SHORT = ["interaction", "perception", "motion", "safety", "extend", "ops"];
const DIM_SHORT_TO_GROUP = {
  interaction: "interaction_expression",
  perception: "perception_understanding",
  motion: "mobility_navigation",
  safety: "safety_trust",
  extend: "expand_connect",
  ops: "ops_maintenance"
};
const DIM_GROUP_TO_SHORT = Object.fromEntries(Object.entries(DIM_SHORT_TO_GROUP).map(([k, v]) => [v, k]));
const DIM_LABEL = {
  interaction: "交互与表达",
  perception: "感知与理解",
  motion: "运动与导航",
  safety: "安全与信任",
  extend: "可扩展与连接",
  ops: "可运营与可维护"
};

const DIM_TAGS = {
  interaction: ["语音交互", "情感陪伴", "多轮对话"],
  perception: ["情绪识别", "场景感知", "个性化推荐"],
  motion: ["自主移动", "自动充电", "碰撞保护"],
  safety: ["隐私保护", "儿童安全", "安全与信任"],
  extend: ["智能家居", "远程控制", "OTA更新"],
  ops: ["OTA更新", "搭配建议", "便携版"]
};

const DIM_PROMPT_MAP = {
  interaction: { name: "交互与表达", tags: "语音交互、情感陪伴、触摸响应、多轮对话、表情显示、音乐播放" },
  perception: { name: "感知与理解", tags: "情绪识别、场景感知、自适应学习、拍照回忆、个性化推荐" },
  motion: { name: "运动与导航", tags: "室内导航、避障、跟随陪伴、自动充电、碰撞保护" },
  safety: { name: "安全与信任", tags: "隐私保护、跌倒检测、儿童安全、老人监护、内容合规" },
  extend: { name: "可扩展与连接", tags: "手机联动、智能家居、第三方插件、多设备协同、离线模式" },
  ops: { name: "可运营与可维护", tags: "OTA更新、远程诊断、质量体系、成本工程、客服SLA" }
};
const ALLOWED_INTERVIEW_TAGS = Object.keys(TAG_MAP.need_tag_to_dim || {});
const ALLOWED_INTERVIEW_TAG_SET = new Set(ALLOWED_INTERVIEW_TAGS);
const TAG_TO_DIM_SHORT = (() => {
  const map = new Map();
  Object.entries(DIM_TAGS).forEach(([dim, tags]) => {
    (tags || []).forEach((tag) => {
      map.set(tag, dim);
    });
  });
  return map;
})();
const DIM_EVIDENCE_HINTS = {
  interaction: "任何关于回应、说话、聊天、提醒、陪伴、被听见、回应感的描述，都可以算 interaction 证据。",
  perception: "任何关于被理解、被看见、懂情绪、懂场景、懂分寸、感知环境变化的描述，都可以算 perception 证据。",
  motion: "任何关于靠近、跟随、移动、起身负担、挡路、距离、在家中走动、行动辅助的描述，都可以算 motion 证据。",
  safety: "任何关于跌倒、隐私、误操作、危险、监护、信任、受伤风险的描述，都可以算 safety 证据。",
  extend: "任何关于开灯、放音乐、提醒、手机联动、设备协作、智能家居、环境控制的描述，都可以算 extend 证据。",
  ops: "任何关于麻烦、照顾负担、维护、充电、耐用、使用门槛、操作复杂、日常维持成本的描述，都可以算 ops 证据。"
};
const MAX_INTERVIEW_TURNS = 10;
const MIN_TURNS_TO_END = 5;
const MIN_INTERVIEWS_REQUIRED = 2;
const MAX_INTERVIEWS_PER_MEMBER = 3;
const MIN_NORMALIZED_TAG_COUNT = 6;
const DIMENSION_GUIDE = {
  perception: {
    label: "感知与理解",
    hint: "试着了解 TA 希望机器人能「看懂」或「听懂」什么：能认出人吗？能感受情绪吗？能理解说的话吗？"
  },
  motion: {
    label: "运动与导航",
    hint: "聊聊 TA 希望机器人怎么移动：跟着人走？自己找路？待在一个地方不动？会不会担心磕碰？"
  },
  interaction: {
    label: "交互与表达",
    hint: "试着了解 TA 希望怎么跟机器人沟通：说话？触摸？表情？声音？还是越安静越好？"
  },
  safety: {
    label: "安全与信任",
    hint: "聊聊 TA 的顾虑：隐私？数据安全？机器人会不会伤到人？坏了怎么办？能信任它吗？"
  },
  extend: {
    label: "可扩展与连接",
    hint: "了解 TA 对「连接」的期待：能连手机吗？能和家里其他设备配合吗？以后能加新功能吗？"
  },
  ops: {
    label: "可运营与可维护",
    hint: "聊聊日常使用的顾虑：充电麻烦吗？坏了谁修？需要经常更新吗？用着用着会不会淘汰？"
  }
};
const PRODUCT_TERMS_RE = /AI\s*宠物机器人|机器人|智能家居|家用机器人|产品|功能|设备|机器人类|认得|识别|提醒|报警|跟随|充电|联动|传感|监测|摄像|语音|屏幕|APP|远程/iu;

class InterviewScoringError extends Error {
  constructor(reason, cause) {
    super(`interview scoring failed: ${reason}`);
    this.name = "InterviewScoringError";
    this.code = "INTERVIEW_SCORING_FAILED";
    this.reason = reason;
    if (cause) this.cause = cause;
  }
}

const CAPABILITY_MAP = (() => {
  const map = new Map();
  (CAP_GROUPS.groups || []).forEach((group) => {
    (group.capabilities || []).forEach((cap) => {
      map.set(cap.cap_id || cap.id, {
        id: cap.cap_id || cap.id,
        name: cap.name || cap.cap_id || cap.id
      });
    });
  });
  return map;
})();

const TIER_LABELS = {
  low: "基础",
  mid: "标准",
  high: "旗舰"
};
const MATCH_CARD_SCORE_STEP = {
  low: 1,
  mid: 2,
  high: 3
};
const DIM_SHORT_TO_MATCH_KEY = {
  interaction: "interaction",
  perception: "perception",
  motion: "mobility",
  safety: "safety_privacy",
  extend: "integration",
  ops: "operations"
};
const CAPABILITY_TO_DIM_SHORT = (() => {
  const map = new Map();
  (CAP_GROUPS.groups || []).forEach((group) => {
    const dimShort = DIM_GROUP_TO_SHORT[String(group.group_id || "").trim()];
    if (!dimShort) return;
    (group.capabilities || []).forEach((cap) => {
      const capId = String(cap.cap_id || cap.id || "").trim();
      if (!capId) return;
      map.set(capId, dimShort);
    });
  });
  return map;
})();

function makeResponse(status, body) {
  return { status, body };
}

function matchStrengthToTier(value) {
  const strength = Math.max(0, Math.min(1, Number(value || 0)));
  if (strength >= 0.7) return "高度契合";
  if (strength >= 0.5) return "部分契合";
  return "契合度有限";
}

function scaleRound1MoneyValue(value) {
  return scaleStoredMoney(value, { positiveOnly: true });
}

function scaleStudentFacingMoneyValue(value) {
  return scaleRound1MoneyValue(value);
}

function buildStudentRound1MoneyView(raw = {}) {
  const round1Sam = scaleStudentFacingMoneyValue(raw.round1Sam);
  const round1WtpAdj = scaleStudentFacingMoneyValue(raw.round1WtpAdj);
  const matchedGridSam = scaleStudentFacingMoneyValue(raw.matchedGridSam);
  const matchedGridWtpRef = scaleStudentFacingMoneyValue(raw.matchedGridWtpRef);
  const matchedGridWtpMean = scaleStudentFacingMoneyValue(raw.matchedGridWtpMean);
  return {
    round1_sam: round1Sam,
    round1_sam_scaled: round1Sam,
    round1_sam_raw: raw.round1Sam ?? null,
    round1_wtp_adj: round1WtpAdj,
    round1_wtp_adj_scaled: round1WtpAdj,
    round1_wtp_adj_raw: raw.round1WtpAdj ?? null,
    matched_grid_sam: matchedGridSam,
    matched_grid_sam_scaled: matchedGridSam,
    matched_grid_sam_raw: raw.matchedGridSam ?? null,
    matched_grid_wtp_ref: matchedGridWtpRef,
    matched_grid_wtp_ref_scaled: matchedGridWtpRef,
    matched_grid_wtp_ref_raw: raw.matchedGridWtpRef ?? null,
    matched_grid_wtp_mean: matchedGridWtpMean,
    matched_grid_wtp_mean_scaled: matchedGridWtpMean,
    matched_grid_wtp_mean_raw: raw.matchedGridWtpMean ?? null
  };
}

function buildRound2PricingContextForTeam(_team) {
  const pricing = loadRound2PricingContextConfig();
  const fixedBase = Number(GLOBAL_PARAMS.F || 0);
  return {
    ...pricing,
    COGSbase: Number(GLOBAL_PARAMS.V || 0),
    fixed_base: fixedBase,
    fixed_base_wan: Number((fixedBase / 10000).toFixed(1))
  };
}

function validateRound2PriceForTeam(team, price) {
  const pricing = buildRound2PricingContextForTeam(team);
  return validateRound2Price(price, pricing);
}

function buildLeaderMeta(team, requesterMemberId = "") {
  const leaderMemberId = String(team?.leader_member_id || team?.leaderMemberId || "").trim();
  const leaderName = String(team?.leader_name || team?.leaderName || "").trim();
  const memberId = String(requesterMemberId || "").trim();
  return {
    leader_member_id: leaderMemberId || null,
    leader_name: leaderName || "",
    is_leader: Boolean(memberId && leaderMemberId && memberId === leaderMemberId)
  };
}

function makeOnlyLeaderResponse(team, requesterMemberId = "") {
  return makeResponse(403, {
    ok: false,
    error: "only_leader",
    ...buildLeaderMeta(team, requesterMemberId)
  });
}

function isRound1FinalizedTeam(team) {
  return String(team?.status || "").trim() === "frozen"
    && String(team?.final_grid_id || "").trim().length > 0;
}

async function ensureRound1Finalized(teamOrId) {
  const team = typeof teamOrId === "string"
    ? await getTeam(teamOrId)
    : teamOrId;
  if (!team) {
    return { ok: false, response: makeResponse(404, { ok: false, error: "team not found" }) };
  }
  if (!isRound1FinalizedTeam(team)) {
    return {
      ok: false,
      response: makeResponse(400, {
        ok: false,
        error: "round1_not_finalized",
        message: ROUND1_NOT_FINALIZED_MESSAGE
      })
    };
  }
  return { ok: true, team };
}

async function ensureSchema() {
  if (__round2RoutesSchemaPromise) return __round2RoutesSchemaPromise;
  __round2RoutesSchemaPromise = (async () => {
    await runSql(`
      CREATE TABLE IF NOT EXISTS round2_dimension_assignments (
        team_id TEXT PRIMARY KEY,
        assignments_json TEXT NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL
      );

      CREATE TABLE IF NOT EXISTS round2_member_selections (
        team_id TEXT NOT NULL,
        member_id TEXT NOT NULL,
        selections_json TEXT NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL,
        PRIMARY KEY (team_id, member_id)
      );
      ALTER TABLE round2_member_selections ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'submitted';
      ALTER TABLE round2_member_selections ADD COLUMN IF NOT EXISTS skipped_by TEXT;
      ALTER TABLE round2_member_selections ADD COLUMN IF NOT EXISTS skipped_at TIMESTAMPTZ;
      UPDATE round2_member_selections
      SET status = COALESCE(status, 'submitted')
      WHERE status IS NULL;

      CREATE TABLE IF NOT EXISTS round2_interview_sessions (
        session_id TEXT PRIMARY KEY,
        team_id TEXT NOT NULL,
        member_id TEXT NOT NULL,
        member_dims_json TEXT NOT NULL,
        personas_json TEXT NOT NULL,
        history_json TEXT NOT NULL,
        result_json TEXT,
        persona_locked_at TIMESTAMPTZ,
        round_no INTEGER NOT NULL,
        is_complete BOOLEAN NOT NULL DEFAULT FALSE,
        created_at TIMESTAMPTZ NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL
      );

      CREATE TABLE IF NOT EXISTS round2_submissions (
        team_id TEXT NOT NULL,
        session_id TEXT NOT NULL DEFAULT 'default',
        flow_version TEXT,
        price DOUBLE PRECISION NOT NULL,
        selections_json TEXT NOT NULL,
        cards_json TEXT NOT NULL,
        card_count INTEGER NOT NULL DEFAULT 0,
        dcogs DOUBLE PRECISION,
        risk_total DOUBLE PRECISION,
        best_grid TEXT,
        submitted_at TIMESTAMPTZ NOT NULL,
        PRIMARY KEY (team_id, session_id)
      );

      CREATE TABLE IF NOT EXISTS fg_team_radar (
        team_id TEXT NOT NULL,
        session_id TEXT NOT NULL DEFAULT 'default',
        radar_json TEXT NOT NULL,
        tags_json TEXT NOT NULL,
        evi DOUBLE PRECISION,
        updated_at TIMESTAMPTZ NOT NULL,
        PRIMARY KEY (team_id, session_id)
      );

      CREATE TABLE IF NOT EXISTS round2_results (
        team_id TEXT NOT NULL,
        session_id TEXT NOT NULL DEFAULT 'default',
        flow_version TEXT,
        units INTEGER,
        profit DOUBLE PRECISION,
        profit_per_unit DOUBLE PRECISION,
        vscore DOUBLE PRECISION,
        best_grid TEXT,
        result_json TEXT NOT NULL,
        computed_at TIMESTAMPTZ NOT NULL,
        PRIMARY KEY (team_id, session_id)
      );

      CREATE TABLE IF NOT EXISTS round2_team_drafts (
        team_id TEXT PRIMARY KEY,
        price DOUBLE PRECISION,
        selections_json TEXT NOT NULL,
        updated_by TEXT,
        updated_at TIMESTAMPTZ NOT NULL
      );

      CREATE TABLE IF NOT EXISTS round2_persona_reports (
        session_id TEXT NOT NULL DEFAULT 'default',
        team_id TEXT NOT NULL,
        archetype_id TEXT NOT NULL,
        summary_text TEXT NOT NULL,
        flow_version TEXT NOT NULL DEFAULT 'merged_v1',
        generated_at TIMESTAMPTZ NOT NULL,
        PRIMARY KEY (session_id, team_id, archetype_id)
      );

      CREATE TABLE IF NOT EXISTS round2_persona_choices (
        session_id TEXT NOT NULL DEFAULT 'default',
        team_id TEXT NOT NULL,
        archetype_id TEXT NOT NULL,
        radar_json TEXT NOT NULL,
        tags_json TEXT NOT NULL,
        evi DOUBLE PRECISION,
        summary_text TEXT,
        flow_version TEXT NOT NULL DEFAULT 'merged_v1',
        selected_by TEXT,
        selected_at TIMESTAMPTZ NOT NULL,
        PRIMARY KEY (session_id, team_id)
      );

      CREATE TABLE IF NOT EXISTS round2_persona_views (
        session_id TEXT NOT NULL DEFAULT 'default',
        team_id TEXT NOT NULL,
        member_id TEXT NOT NULL,
        persona_id TEXT NOT NULL,
        viewed_at TIMESTAMPTZ NOT NULL,
        PRIMARY KEY (session_id, team_id, member_id, persona_id)
      );
    `);
    await runSql(`
      ALTER TABLE round2_interview_sessions
      ADD COLUMN IF NOT EXISTS persona_locked_at TIMESTAMPTZ;
    `);
    await runSql(`
      ALTER TABLE round2_persona_choices
      ADD COLUMN IF NOT EXISTS grid_id TEXT;
      ALTER TABLE round2_persona_choices
      ADD COLUMN IF NOT EXISTS covered_keywords_json TEXT;
      ALTER TABLE round2_persona_choices
      ADD COLUMN IF NOT EXISTS uncovered_keywords_json TEXT;
      ALTER TABLE round2_persona_choices
      ADD COLUMN IF NOT EXISTS reports_viewed_json TEXT;
      ALTER TABLE round2_persona_choices
      ADD COLUMN IF NOT EXISTS coverage_ratio DOUBLE PRECISION;
    `);
    await runSql(`
      ALTER TABLE round2_submissions
      ADD COLUMN IF NOT EXISTS flow_version TEXT;
      ALTER TABLE round2_results
      ADD COLUMN IF NOT EXISTS flow_version TEXT;
      ALTER TABLE round2_results
      ADD COLUMN IF NOT EXISTS matched_grid TEXT;
      ALTER TABLE round2_results
      ADD COLUMN IF NOT EXISTS match_score_json TEXT;
    `);
    await runSql(`
      DELETE FROM round2_interview_sessions
      WHERE is_complete = false
        AND round_no = 0
        AND COALESCE(history_json, '[]') IN ('[]', '');
    `);
    await runSql(`
      DELETE FROM round2_interview_sessions a
      USING round2_interview_sessions b
      WHERE a.team_id = b.team_id
        AND a.member_id = b.member_id
        AND a.session_id <> b.session_id
        AND a.is_complete = false
        AND b.is_complete = false
        AND (
          a.round_no < b.round_no
          OR (a.round_no = b.round_no AND a.created_at < b.created_at)
          OR (a.round_no = b.round_no AND a.created_at = b.created_at AND a.session_id < b.session_id)
        );
    `);
    await runSql(`
      CREATE UNIQUE INDEX IF NOT EXISTS round2_interview_one_active
        ON round2_interview_sessions (team_id, member_id)
        WHERE is_complete = false;
    `);
    await ensureRound2StateSchema();
  })();
  try {
    await __round2RoutesSchemaPromise;
  } catch (err) {
    __round2RoutesSchemaPromise = null;
    throw err;
  }
  return __round2RoutesSchemaPromise;
}

function nowIso() {
  return new Date().toISOString();
}

function readJsonFile(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function sha256File(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function getSummarySourceMetadata() {
  return {
    tags_source: {
      file: path.basename(GRID_DIMENSION_EVIDENCE_PATH),
      sha256: sha256File(GRID_DIMENSION_EVIDENCE_PATH)
    },
    persona_reports: {
      file: path.basename(STATIC_PERSONA_REPORTS_PATH),
      sha256: sha256File(STATIC_PERSONA_REPORTS_PATH)
    }
  };
}

function loadStaticPersonaReportsConfig() {
  if (!cachedStaticPersonaReports) {
    cachedStaticPersonaReports = readJsonFile(STATIC_PERSONA_REPORTS_PATH);
  }
  return cachedStaticPersonaReports;
}

function loadGridDimensionEvidenceConfig() {
  if (!cachedGridDimensionEvidence) {
    cachedGridDimensionEvidence = readJsonFile(GRID_DIMENSION_EVIDENCE_PATH);
    if (String(cachedGridDimensionEvidence?.version || "").trim() !== "v2") {
      throw new Error(`grid dimension evidence must be v2: ${GRID_DIMENSION_EVIDENCE_PATH}`);
    }
  }
  return cachedGridDimensionEvidence;
}

function hashStringToUint32(value) {
  let hash = 2166136261;
  const text = String(value || "");
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function pickDeterministicIndex(seed, size) {
  const count = Number(size || 0);
  if (count <= 0) return -1;
  return hashStringToUint32(seed) % count;
}

function getStaticPersonaGrid(gridId) {
  const config = loadStaticPersonaReportsConfig();
  const normalizedGridId = String(gridId || "").trim();
  return (config?.grids || []).find((item) => String(item?.grid_id || "").trim() === normalizedGridId) || null;
}

function getReportTextTitle(reportText) {
  const lines = String(reportText || "").split("\n").map((line) => line.trim()).filter(Boolean);
  if (lines[0] === "━━━━━━━━━━━━━━━━━━━━" && lines[2]) return lines[2];
  return lines[0] || "客户调研报告";
}

function getGridDimensionEvidenceRow(gridId, config = loadGridDimensionEvidenceConfig()) {
  const normalizedGridId = String(gridId || "").trim();
  return (config?.grids || []).find((item) => String(item?.grid_id || "").trim() === normalizedGridId) || null;
}

function requireGridDimensionEvidenceRow(gridId, config = loadGridDimensionEvidenceConfig()) {
  const row = getGridDimensionEvidenceRow(gridId, config);
  if (!row) {
    throw new Error(`grid dimension evidence v2 missing grid ${String(gridId || "").trim()}`);
  }
  return row;
}

function sanitizeStudentPersonaReport(report) {
  if (!report || typeof report !== "object") return null;
  return {
    grid_id: String(report.grid_id || "").trim(),
    report_index: Number.isFinite(Number(report.report_index)) ? Number(report.report_index) : 0,
    persona_id: String(report.persona_id || report.archetype_id || "").trim(),
    archetype_id: String(report.persona_id || report.archetype_id || "").trim(),
    title: String(report.title || getReportTextTitle(report.summary_text || report.report_text || "")).trim(),
    summary_text: String(report.summary_text || report.report_text || "").trim(),
    report_text: String(report.report_text || report.summary_text || "").trim(),
    char_count: Number(report.char_count || 0),
    leakage_check_passed: report.leakage_check_passed !== false,
    reviewed: report.reviewed === true,
    change_level: String(report.change_level || "").trim(),
    flow_version: String(report.flow_version || SUMMARY_FLOW_VERSION).trim() || SUMMARY_FLOW_VERSION,
    generated_at: report.generated_at || null
  };
}

function sanitizeStudentPersonaChoice(choice) {
  if (!choice || typeof choice !== "object") return null;
  return {
    session_id: choice.session_id,
    team_id: choice.team_id,
    grid_id: choice.grid_id || "",
    persona_id: choice.persona_id || choice.archetype_id || "",
    archetype_id: choice.persona_id || choice.archetype_id || "",
    summary_text: String(choice.summary_text || "").trim(),
    flow_version: choice.flow_version || SUMMARY_FLOW_VERSION,
    selected_by: choice.selected_by || "",
    selected_at: choice.selected_at || null
  };
}

function getStaticPersonaReportsForGrid(gridId) {
  const grid = getStaticPersonaGrid(gridId);
  return Array.isArray(grid?.reports) ? grid.reports : [];
}

function buildStudentPersonaCatalog(gridId) {
  return getStaticPersonaReportsForGrid(gridId).map((report, index) => ({
    report_index: index,
    persona_id: String(report?.persona_id || "").trim(),
    title: getReportTextTitle(report?.report_text || "")
  }));
}

function getDefaultPersonaReportIndex(teamId, gridId) {
  return pickDeterministicIndex(String(teamId || "").trim(), getStaticPersonaReportsForGrid(gridId).length);
}

function getInitialPersonaReportIndex(gridId) {
  return 0;
}

function getStaticPersonaReportByIndex(gridId, reportIndex) {
  const reports = getStaticPersonaReportsForGrid(gridId);
  const index = Number(reportIndex);
  if (!Number.isInteger(index) || index < 0 || index >= reports.length) {
    return null;
  }
  const selected = reports[index];
  if (!selected) return null;
  return {
    grid_id: String(gridId || "").trim(),
    report_index: index,
    persona_id: String(selected?.persona_id || "").trim(),
    title: getReportTextTitle(selected?.report_text || ""),
    report_text: String(selected?.report_text || "").trim(),
    char_count: Number(selected?.char_count || 0),
    leakage_check_passed: selected?.leakage_check_passed !== false,
    reviewed: selected?.reviewed === true,
    change_level: String(selected?.change_level || "").trim(),
    grid_keywords_full: uniqueStrings(selected?.grid_keywords_full),
    covered_keywords: uniqueStrings(selected?.covered_keywords),
    uncovered_keywords: uniqueStrings(selected?.uncovered_keywords)
  };
}

function getStaticPersonaReportByPersonaId(gridId, personaId) {
  const normalizedPersonaId = String(personaId || "").trim();
  if (!normalizedPersonaId) return null;
  const reports = getStaticPersonaReportsForGrid(gridId);
  const index = reports.findIndex((report) => String(report?.persona_id || "").trim() === normalizedPersonaId);
  if (index < 0) return null;
  return getStaticPersonaReportByIndex(gridId, index);
}

function getGridKeywordsFull(gridId) {
  const reports = getStaticPersonaReportsForGrid(gridId);
  for (const report of reports) {
    const keywords = uniqueStrings(report?.grid_keywords_full);
    if (keywords.length) return keywords;
  }
  return [];
}

function selectStaticPersonaReport({ teamId, gridId }) {
  const reports = getStaticPersonaReportsForGrid(gridId);
  if (!reports.length) {
    throw new Error(`static persona reports not found for grid ${gridId}`);
  }
  const selectedIndex = getDefaultPersonaReportIndex(teamId, gridId);
  const selected = reports[selectedIndex];
  if (!selected) {
    throw new Error(`static persona report selection failed for grid ${gridId}`);
  }
  return getStaticPersonaReportByIndex(gridId, selectedIndex);
}

function computeCoverageRatioForViewedReports(gridId, viewedPersonaIds) {
  const fullKeywords = getGridKeywordsFull(gridId);
  if (!fullKeywords.length) return 0;
  const coveredUnion = new Set();
  uniqueStrings(viewedPersonaIds).forEach((personaId) => {
    const report = getStaticPersonaReportByPersonaId(gridId, personaId);
    (report?.covered_keywords || []).forEach((keyword) => coveredUnion.add(keyword));
  });
  return coveredUnion.size / fullKeywords.length;
}

function computeDynamicSummaryEvi(coverageRatio, maxEvi = SUMMARY_DYNAMIC_EVI_MAX) {
  const normalized = Number(coverageRatio);
  if (!Number.isFinite(normalized) || normalized <= 0) return 0;
  return roundTo(clamp(normalized, 0, 1) * Number(maxEvi || SUMMARY_DYNAMIC_EVI_MAX), 4);
}

function buildStaticSummaryModeRadarResult({ gridId, architecture, evidenceRow, mapEvidenceToResultFn, eviOverride = null }) {
  const configuredTags = Array.isArray(evidenceRow?.tags)
    ? evidenceRow.tags.map((tag) => String(tag || "").trim()).filter(Boolean)
    : [];
  if (!configuredTags.length) {
    throw new Error(`grid dimension evidence v2 has no tags for grid ${String(gridId || "").trim()}`);
  }
  const invalidTags = configuredTags.filter((tag) => !ALLOWED_INTERVIEW_TAG_SET.has(tag));
  if (invalidTags.length > 0 || new Set(configuredTags).size !== configuredTags.length) {
    throw new Error(`grid dimension evidence v2 has invalid or duplicate tags for grid ${String(gridId || "").trim()}: ${invalidTags.join(",")}`);
  }
  const extracted = {
    focused_dimensions: [],
    dimension_evidence: evidenceRow?.dimension_evidence && typeof evidenceRow.dimension_evidence === "object"
      ? evidenceRow.dimension_evidence
      : {},
    other_dimensions: {},
    tags: configuredTags,
    interview_quality: {
      specificity: "medium",
      consistency: "medium",
      actionability: "medium"
    }
  };
  const result = mapEvidenceToResultFn({
    gridId,
    architecture,
    memberDims: DIM_KEYS_SHORT,
    extracted,
    history: [],
    conversation: JSON.stringify(extracted.dimension_evidence)
  });
  // Summary final tags are frozen configuration, so interview normalization must not append priors.
  result.tags = configuredTags.map((tag) => ({ tag, polarity: 1, source: "evidence_v2" }));
  if (result.eviMeta) result.eviMeta.tag_count = configuredTags.length;
  const nextEvi = Number(eviOverride);
  if (Number.isFinite(nextEvi)) {
    result.evi = nextEvi;
    if (result.eviMeta) {
      result.eviMeta.raw_evi = nextEvi;
      result.eviMeta.final_evi = nextEvi;
    }
  }
  return result;
}

async function readRound2TeamDraft(teamId) {
  await ensureSchema();
  const rows = await runSql(`
    SELECT team_id, price, selections_json, updated_by, updated_at
    FROM round2_team_drafts
    WHERE team_id = ${sqlQuote(teamId)}
    LIMIT 1;
  `);
  const row = rows[0];
  if (!row) return null;
  const rawPrice = row.price;
  return {
    team_id: row.team_id,
    price: rawPrice === null || rawPrice === undefined || rawPrice === ""
      ? null
      : (Number.isFinite(Number(rawPrice)) ? Number(rawPrice) : null),
    selections: safeJsonParse(row.selections_json, []),
    updated_by: row.updated_by || "",
    updated_at: row.updated_at || null
  };
}

async function readPersonaReports(teamId, sessionId = "default") {
  await ensureSchema();
  const rows = await runSql(`
    SELECT session_id, team_id, archetype_id, summary_text, flow_version, generated_at
    FROM round2_persona_reports
    WHERE team_id = ${sqlQuote(teamId)}
      AND session_id = ${sqlQuote(sessionId)}
    ORDER BY archetype_id ASC;
  `);
  return rows.map((row) => ({
    session_id: row.session_id,
    team_id: row.team_id,
    archetype_id: row.archetype_id,
    summary_text: row.summary_text || "",
    flow_version: row.flow_version || SUMMARY_FLOW_VERSION,
    generated_at: row.generated_at || null
  }));
}

async function persistPersonaReports(teamId, sessionId, reports) {
  await ensureSchema();
  for (const report of Array.isArray(reports) ? reports : []) {
    await runSql(`
      INSERT INTO round2_persona_reports (
        session_id, team_id, archetype_id, summary_text, flow_version, generated_at
      ) VALUES (
        ${sqlQuote(sessionId)},
        ${sqlQuote(teamId)},
        ${sqlQuote(String(report.archetype_id || "").trim())},
        ${sqlQuote(String(report.summary_text || "").trim())},
        ${sqlQuote(String(report.flow_version || SUMMARY_FLOW_VERSION).trim() || SUMMARY_FLOW_VERSION)},
        ${sqlQuote(report.generated_at || nowIso())}
      )
      ON CONFLICT (session_id, team_id, archetype_id) DO NOTHING;
    `);
  }
}

async function readPersonaChoice(teamId, sessionId = "default") {
  await ensureSchema();
  const rows = await runSql(`
    SELECT session_id, team_id, archetype_id, radar_json, tags_json, evi, summary_text,
      flow_version, selected_by, selected_at, grid_id, covered_keywords_json, uncovered_keywords_json,
      reports_viewed_json, coverage_ratio
    FROM round2_persona_choices
    WHERE team_id = ${sqlQuote(teamId)}
      AND session_id = ${sqlQuote(sessionId)}
    LIMIT 1;
  `);
  const row = rows[0];
  if (!row) return null;
  return {
    session_id: row.session_id,
    team_id: row.team_id,
    grid_id: row.grid_id || "",
    persona_id: row.archetype_id,
    archetype_id: row.archetype_id,
    radar: normalizeRadarPayload(safeJsonParse(row.radar_json, {})),
    tags: safeJsonParse(row.tags_json, []),
    summary_text: row.summary_text || "",
    flow_version: row.flow_version || SUMMARY_FLOW_VERSION,
    selected_by: row.selected_by || "",
    selected_at: row.selected_at || null,
    evi: row.evi == null ? null : Number(row.evi),
    coverage_ratio: row.coverage_ratio == null ? null : Number(row.coverage_ratio),
    reports_viewed: safeJsonParse(row.reports_viewed_json, []),
    covered_keywords: safeJsonParse(row.covered_keywords_json, []),
    uncovered_keywords: safeJsonParse(row.uncovered_keywords_json, [])
  };
}

async function savePersonaChoice(teamId, sessionId, choice) {
  await ensureSchema();
  await runSql(`
    INSERT INTO round2_persona_choices (
      session_id, team_id, archetype_id, radar_json, tags_json, evi,
      summary_text, flow_version, selected_by, selected_at, grid_id,
      covered_keywords_json, uncovered_keywords_json, reports_viewed_json, coverage_ratio
    ) VALUES (
      ${sqlQuote(sessionId)},
      ${sqlQuote(teamId)},
      ${sqlQuote(String(choice?.persona_id || choice?.archetype_id || "").trim())},
      ${sqlQuote(JSON.stringify(choice?.radar || {}))},
      ${sqlQuote(JSON.stringify(choice?.tags || []))},
      ${choice?.evi == null ? "NULL" : Number(choice.evi)},
      ${sqlQuote(String(choice?.summary_text || "").trim() || null)},
      ${sqlQuote(String(choice?.flow_version || SUMMARY_FLOW_VERSION).trim() || SUMMARY_FLOW_VERSION)},
      ${sqlQuote(String(choice?.selected_by || "").trim() || null)},
      ${sqlQuote(choice?.selected_at || nowIso())},
      ${sqlQuote(String(choice?.grid_id || "").trim() || null)},
      ${sqlQuote(JSON.stringify(uniqueStrings(choice?.covered_keywords)))},
      ${sqlQuote(JSON.stringify(uniqueStrings(choice?.uncovered_keywords)))},
      ${sqlQuote(JSON.stringify(uniqueStrings(choice?.reports_viewed)))},
      ${choice?.coverage_ratio == null ? "NULL" : Number(choice.coverage_ratio)}
    )
    ON CONFLICT (session_id, team_id) DO UPDATE SET
      archetype_id = EXCLUDED.archetype_id,
      radar_json = EXCLUDED.radar_json,
      tags_json = EXCLUDED.tags_json,
      evi = EXCLUDED.evi,
      summary_text = EXCLUDED.summary_text,
      flow_version = EXCLUDED.flow_version,
      selected_by = EXCLUDED.selected_by,
      selected_at = EXCLUDED.selected_at,
      grid_id = EXCLUDED.grid_id,
      covered_keywords_json = EXCLUDED.covered_keywords_json,
      uncovered_keywords_json = EXCLUDED.uncovered_keywords_json,
      reports_viewed_json = EXCLUDED.reports_viewed_json,
      coverage_ratio = EXCLUDED.coverage_ratio;
  `);
  return readPersonaChoice(teamId, sessionId);
}

async function recordPersonaView(sessionId, teamId, memberId, personaId) {
  await ensureSchema();
  await runSql(`
    INSERT INTO round2_persona_views (
      session_id, team_id, member_id, persona_id, viewed_at
    ) VALUES (
      ${sqlQuote(sessionId)},
      ${sqlQuote(teamId)},
      ${sqlQuote(memberId)},
      ${sqlQuote(personaId)},
      ${sqlQuote(nowIso())}
    )
    ON CONFLICT (session_id, team_id, member_id, persona_id) DO NOTHING;
  `);
}

async function getTeamViewedPersonas(teamId, sessionId = "default") {
  await ensureSchema();
  const rows = await runSql(`
    SELECT persona_id, MIN(viewed_at) AS first_viewed_at
    FROM round2_persona_views
    WHERE team_id = ${sqlQuote(teamId)}
      AND session_id = ${sqlQuote(sessionId)}
    GROUP BY persona_id
    ORDER BY MIN(viewed_at) ASC, persona_id ASC;
  `);
  return rows.map((row) => String(row.persona_id || "").trim()).filter(Boolean);
}

async function getMemberViewedPersonas(teamId, memberId, sessionId = "default") {
  await ensureSchema();
  const rows = await runSql(`
    SELECT persona_id, MIN(viewed_at) AS first_viewed_at
    FROM round2_persona_views
    WHERE team_id = ${sqlQuote(teamId)}
      AND member_id = ${sqlQuote(memberId)}
      AND session_id = ${sqlQuote(sessionId)}
    GROUP BY persona_id
    ORDER BY MIN(viewed_at) ASC, persona_id ASC;
  `);
  return rows.map((row) => String(row.persona_id || "").trim()).filter(Boolean);
}

async function getMemberReadingDetails(teamId, sessionId = "default") {
  await ensureSchema();
  const teamState = await getTeamRound2State(teamId);
  const rows = await runSql(`
    SELECT member_id, persona_id, MIN(viewed_at) AS first_viewed_at
    FROM round2_persona_views
    WHERE team_id = ${sqlQuote(teamId)}
      AND session_id = ${sqlQuote(sessionId)}
    GROUP BY member_id, persona_id
    ORDER BY member_id ASC, MIN(viewed_at) ASC, persona_id ASC;
  `);
  const viewedByMember = new Map();
  rows.forEach((row) => {
    const key = String(row.member_id || "").trim();
    if (!key) return;
    if (!viewedByMember.has(key)) viewedByMember.set(key, []);
    viewedByMember.get(key).push(String(row.persona_id || "").trim());
  });
  return (teamState?.members || []).map((member) => ({
    member_id: String(member.id || "").trim(),
    name: String(member.name || "").trim() || "成员",
    reading_status: String(member.readingStatus || member.reading_status || "not_started").trim() || "not_started",
    viewed: uniqueStrings(viewedByMember.get(String(member.id || "").trim()) || [])
  }));
}

async function upsertTeamRadar(teamId, sessionId, radar) {
  const now = nowIso();
  await runSql(`
    INSERT INTO fg_team_radar (
      team_id, session_id, radar_json, tags_json, evi, updated_at
    ) VALUES (
      ${sqlQuote(teamId)},
      ${sqlQuote(sessionId)},
      ${sqlQuote(JSON.stringify(radar.radar || {}))},
      ${sqlQuote(JSON.stringify(radar.tags || []))},
      ${radar.evi == null ? "NULL" : Number(radar.evi)},
      ${sqlQuote(radar.updated_at || now)}
    )
    ON CONFLICT(team_id, session_id) DO UPDATE SET
      radar_json = EXCLUDED.radar_json,
      tags_json = EXCLUDED.tags_json,
      evi = EXCLUDED.evi,
      updated_at = EXCLUDED.updated_at;
  `);
}

async function renderPersonaSummaryWithLlm({ teamId, prompt }) {
  const messages = [
    {
      role: "system",
      content: "你是客户研究叙事写作者。只写生活情境、痛点、情绪与行为，不写功能、能力、解决方案。"
    },
    {
      role: "user",
      content: prompt
    }
  ];
  return withLlmLogging({
    caller: "round2Routes.renderPersonaSummary",
    teamId,
    memberId: null,
    messages
  }, () => chatCompletion(messages, {
    temperature: 0.6,
    max_tokens: 1200,
    maxRetries: 2,
    timeoutMs: ROUND2_LLM_TIMEOUT_MS
  }));
}

async function ensurePersonaReportsForTeam(teamId, sessionId = "default") {
  const existing = await readPersonaReports(teamId, sessionId);
  const config = loadPersonaArchetypes();
  const existingIds = new Set(existing.map((item) => item.archetype_id));
  const allPresent = config.archetypes.length > 0 && config.archetypes.every((item) => existingIds.has(item.id));
  if (allPresent) {
    return existing;
  }
  const recapRes = await recap({ teamId });
  const recapData = recapRes?.body?.ok ? recapRes.body : {};
  const team = await getTeam(teamId);
  const generated = await generatePersonaReports({
    archetypes: config.archetypes,
    existingReports: existing,
    teamName: team?.team_name || teamId,
    recapData,
    renderSummary: ({ prompt }) => renderPersonaSummaryWithLlm({ teamId, prompt }),
    onFallback: ({ archetypeId, hadRenderError, lastErrorMessage, leakageMatches, lastCharCount, retryReason }) => {
      console.warn("persona summary fallback: no LLM key/call failed", JSON.stringify({
        teamId,
        sessionId,
        archetypeId,
        has_llm_key: hasAnyKey(),
        had_render_error: hadRenderError,
        last_error: lastErrorMessage || "",
        leakage_matches: Array.isArray(leakageMatches) ? leakageMatches : [],
        last_char_count: Number(lastCharCount || 0),
        retry_reason: retryReason || ""
      }));
    },
    flowVersion: SUMMARY_FLOW_VERSION
  });
  await persistPersonaReports(teamId, sessionId, generated.filter((item) => {
    return !existing.some((row) => row.archetype_id === item.archetype_id);
  }));
  return readPersonaReports(teamId, sessionId);
}

function isSummaryModeSession(sessionConfig) {
  return String(sessionConfig?.interview_mode || "summary").trim().toLowerCase() !== "live";
}

function buildStudentReadingStatusPayload({ allViewed, myViewed, totalReports, members = [], memberId = "" }) {
  const normalizedMembers = (Array.isArray(members) ? members : []).map((member) => ({
    member_id: String(member?.member_id || "").trim(),
    name: String(member?.name || "").trim() || "成员",
    reading_status: String(member?.reading_status || "not_started").trim() || "not_started",
    viewed: uniqueStrings(member?.viewed)
  })).filter((member) => member.member_id);
  const requesterId = String(memberId || "").trim();
  const completedCount = normalizedMembers.filter((member) => member.reading_status === "completed").length;
  const allCompleted = normalizedMembers.length > 0 && completedCount >= normalizedMembers.length;
  const teamViewed = uniqueStrings(allViewed);
  const myViewedList = uniqueStrings(myViewed);
  return {
    total_reports: Number(totalReports || 0),
    team_viewed_count: teamViewed.length,
    team_viewed_personas: teamViewed,
    members: normalizedMembers,
    completed_count: completedCount,
    all_completed: allCompleted,
    my_reading_status: normalizedMembers.find((member) => member.member_id === requesterId)?.reading_status || "not_started",
    my_viewed: myViewedList,
    my_viewed_personas: myViewedList
  };
}

function getDefaultStaticSummaryReportForTeam(team) {
  const teamId = String(team?.id || team?.team_id || "").trim();
  if (!teamId) return null;
  const calcGridId = toCalcGridId(team?.final_grid_id || "", team?.final_architecture || "");
  if (!calcGridId) return null;
  return selectStaticPersonaReport({
    teamId,
    gridId: calcGridId
  });
}

function getInitialStaticSummaryReportForTeam(team) {
  const calcGridId = toCalcGridId(team?.final_grid_id || "", team?.final_architecture || "");
  if (!calcGridId) return null;
  return getStaticPersonaReportByIndex(calcGridId, getInitialPersonaReportIndex(calcGridId));
}

async function freezeStaticSummaryChoiceForTeam(team, sessionId = "default", selectedBy = "system_summary_freeze") {
  const teamId = String(team?.id || team?.team_id || "").trim();
  if (!teamId) return null;
  const normalizedSessionId = normalizeSessionId(sessionId);

  const sessionConfig = await getSessionConfig(normalizedSessionId);
  if (!isSummaryModeSession(sessionConfig)) return null;

  const existingChoice = await readPersonaChoice(teamId, normalizedSessionId);
  if (existingChoice?.summary_text) {
    return existingChoice;
  }

  const calcGridId = toCalcGridId(team?.final_grid_id || "", team?.final_architecture || "");
  if (!calcGridId) return null;

  const allViewed = await getTeamViewedPersonas(teamId, normalizedSessionId);
  const fallbackReport = getDefaultStaticSummaryReportForTeam(team);
  const reportsViewed = uniqueStrings(allViewed.length ? allViewed : [fallbackReport?.persona_id || ""]);
  const fullKeywords = getGridKeywordsFull(calcGridId);
  const coveredKeywordSet = new Set();
  reportsViewed.forEach((personaId) => {
    const report = getStaticPersonaReportByPersonaId(calcGridId, personaId);
    (report?.covered_keywords || []).forEach((keyword) => coveredKeywordSet.add(keyword));
  });
  const coveredKeywords = Array.from(coveredKeywordSet);
  const uncoveredKeywords = fullKeywords.filter((keyword) => !coveredKeywordSet.has(keyword));
  const coverageRatio = computeCoverageRatioForViewedReports(calcGridId, reportsViewed);
  const dynamicEvi = computeDynamicSummaryEvi(coverageRatio, SUMMARY_DYNAMIC_EVI_MAX);
  const evidenceRow = requireGridDimensionEvidenceRow(calcGridId);

  const summaryResult = buildStaticSummaryModeRadarResult({
    gridId: calcGridId,
    architecture: String(team?.final_architecture || "").trim(),
    evidenceRow,
    mapEvidenceToResultFn: mapEvidenceToResult,
    eviOverride: dynamicEvi
  });

  const summaryReport = fallbackReport || getStaticPersonaReportByPersonaId(calcGridId, reportsViewed[0]);

  const nextChoice = await savePersonaChoice(teamId, normalizedSessionId, {
    grid_id: calcGridId,
    persona_id: summaryReport?.persona_id || reportsViewed[0] || "",
    radar: summaryResult.radar,
    tags: summaryResult.tags,
    evi: summaryResult.evi,
    summary_text: summaryReport?.report_text || "",
    flow_version: SUMMARY_FLOW_VERSION,
    selected_by: String(selectedBy || "").trim() || "system_summary_freeze",
    selected_at: nowIso(),
    covered_keywords: coveredKeywords,
    uncovered_keywords: uncoveredKeywords,
    reports_viewed: reportsViewed,
    coverage_ratio: coverageRatio
  });

  await upsertTeamRadar(teamId, normalizedSessionId, {
    radar: summaryResult.radar,
    tags: summaryResult.tags,
    evi: summaryResult.evi,
    updated_at: nowIso()
  });

  return nextChoice;
}

async function listStudentPersonaReportsForTeam(team, sessionId = "default") {
  const choice = await readPersonaChoice(String(team?.id || team?.team_id || "").trim(), sessionId);
  if (choice?.summary_text) {
    const selectedReport = getStaticPersonaReportByPersonaId(choice.grid_id || "", choice.persona_id || choice.archetype_id || "");
    return [sanitizeStudentPersonaReport({
      ...(selectedReport || {}),
      grid_id: choice.grid_id || "",
      report_index: Number.isFinite(Number(selectedReport?.report_index)) ? Number(selectedReport.report_index) : 0,
      persona_id: choice.persona_id || choice.archetype_id || "",
      summary_text: String(choice.summary_text || "").trim(),
      report_text: String(choice.summary_text || "").trim(),
      flow_version: choice.flow_version || SUMMARY_FLOW_VERSION,
      generated_at: choice.selected_at || null
    })];
  }
  const defaultReport = getInitialStaticSummaryReportForTeam(team);
  if (!defaultReport) return [];
  return [sanitizeStudentPersonaReport({
    ...defaultReport,
    flow_version: SUMMARY_FLOW_VERSION,
    generated_at: null
  })];
}

async function saveRound2TeamDraft(teamId, memberId, draft = {}) {
  await ensureSchema();
  const existing = await readRound2TeamDraft(teamId);
  const selections = Array.isArray(draft.selections)
    ? draft.selections
    : Array.isArray(existing?.selections)
      ? existing.selections
      : [];
  const nextPrice = draft.price === undefined
    ? existing?.price ?? null
    : (Number.isFinite(Number(draft.price)) ? Number(draft.price) : null);

  await runSql(`
    INSERT INTO round2_team_drafts (
      team_id, price, selections_json, updated_by, updated_at
    ) VALUES (
      ${sqlQuote(teamId)},
      ${nextPrice == null ? "NULL" : Number(nextPrice)},
      ${sqlQuote(JSON.stringify(selections || []))},
      ${sqlQuote(String(memberId || "").trim() || null)},
      ${sqlQuote(nowIso())}
    )
    ON CONFLICT (team_id) DO UPDATE SET
      price = EXCLUDED.price,
      selections_json = EXCLUDED.selections_json,
      updated_by = EXCLUDED.updated_by,
      updated_at = EXCLUDED.updated_at;
  `);

  return readRound2TeamDraft(teamId);
}

async function ensureRound2LeaderPermission(teamId, memberId) {
  const team = await getTeam(teamId);
  if (!team) return { ok: false, response: makeResponse(404, { ok: false, error: "team not found" }) };
  const requesterId = String(memberId || "").trim();
  if (!requesterId) return { ok: false, response: makeOnlyLeaderResponse(team, requesterId) };
  const member = (team.members || []).find((item) => item.id === requesterId);
  if (!member) return { ok: false, response: makeResponse(400, { ok: false, error: "member not found in team" }) };
  if (!String(team.leader_member_id || "").trim()) {
    const nextTeam = await setTeamLeader(teamId, requesterId);
    return { ok: true, team: nextTeam, leaderMeta: buildLeaderMeta(nextTeam, requesterId) };
  }
  const leaderMeta = buildLeaderMeta(team, requesterId);
  if (!leaderMeta.is_leader) return { ok: false, response: makeOnlyLeaderResponse(team, requesterId) };
  return { ok: true, team, leaderMeta };
}

function normalizeTimestamp(value) {
  if (!value) return nowIso();
  if (value instanceof Date) return value.toISOString();
  const text = String(value).trim();
  if (!text) return nowIso();
  const parsed = new Date(text);
  if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
  return nowIso();
}

function getEngineConfig() {
  if (!cachedEngineConfig) {
    cachedEngineConfig = Engine.loadConfig(CONFIG_DIR);
  }
  return cachedEngineConfig;
}

function getGridPriors() {
  if (!cachedGridPriors) {
    cachedGridPriors = require(GRID_PRIOR_PATH);
  }
  return cachedGridPriors;
}

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

function jitter(mean) {
  const delta = (Math.random() - 0.5) * 1.0; // ±0.5
  return Number(clamp(mean + delta, 1, 9).toFixed(1));
}

function getPriorRadarByGrid(gridId, architecture) {
  const priors = getGridPriors();
  const normalizedGridId = /^B2[BC]_/.test(String(gridId || "").trim())
    ? String(gridId || "").trim()
    : toCalcGridId(gridId, architecture);
  const grid = (priors.grids || []).find((g) => g.id === normalizedGridId) || {};
  const w = grid.radar_weight_prior || {};
  // 将先验权重映射到 1-9 的分值均值（中心在5附近）
  const toScore = (weight) => clamp(4 + Number(weight || 0) * 10, 1, 9);
  const priorRadar = {
    interaction: toScore(w["交互与表达"]),
    perception: toScore(w["感知与理解"]),
    motion: toScore(w["运动与导航"]),
    safety: toScore(w["安全与信任"]),
    extend: toScore(w["可扩展与连接"]),
    ops: toScore(w["可运营与可维护"])
  };
  console.log("[Round2][PriorRadar]", JSON.stringify({
    rawGridId: String(gridId || ""),
    architecture: String(architecture || ""),
    normalizedGridId,
    priorRadar
  }));
  return priorRadar;
}

function dimToRadarKeys(dimScores) {
  return {
    perception: Number(dimScores.perception || 5),
    mobility: Number(dimScores.motion || 5),
    interaction: Number(dimScores.interaction || 5),
    safety_privacy: Number(dimScores.safety || 5),
    integration: Number(dimScores.extend || 5),
    operations: Number(dimScores.ops || 5)
  };
}

function radarToDimKeys(radar) {
  return {
    interaction: Number(radar?.interaction || 0),
    perception: Number(radar?.perception || 0),
    motion: Number(radar?.mobility || 0),
    safety: Number(radar?.safety_privacy || 0),
    extend: Number(radar?.integration || 0),
    ops: Number(radar?.operations || 0)
  };
}

function roundTo(value, digits) {
  return Number(Number(value || 0).toFixed(digits));
}

function roundForLog(value, digits = 6) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Number(n.toFixed(digits));
}

function pickFiniteNumber(...values) {
  for (const value of values) {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function pickNonEmptyString(...values) {
  for (const value of values) {
    const text = String(value || "").trim();
    if (text) return text;
  }
  return "";
}

function withDefinedEntries(entries) {
  return Object.fromEntries(entries.filter(([, value]) => value !== null && value !== undefined && value !== ""));
}

function sanitizeStudentTeamResult(result) {
  if (!result || typeof result !== "object") return result;
  const detail = result.result && typeof result.result === "object" ? result.result : {};
  const nestedResult = detail.result && typeof detail.result === "object" ? detail.result : null;
  const safeNestedResult = nestedResult
    ? withDefinedEntries([
        ["units", pickFiniteNumber(nestedResult.units)],
        ["profit", pickFiniteNumber(nestedResult.profit)],
        ["revenueNet", pickFiniteNumber(nestedResult.revenueNet)],
        ["variableCost", pickFiniteNumber(nestedResult.variableCost)],
        ["fixedCost", pickFiniteNumber(nestedResult.fixedCost, nestedResult.f_total)],
        ["f_total", pickFiniteNumber(nestedResult.f_total, nestedResult.fixedCost)],
        ["unitMargin", pickFiniteNumber(nestedResult.unitMargin, nestedResult.unitProfitHW)],
        ["breakeven_q", pickFiniteNumber(nestedResult.breakeven_q)],
        ["profitSub", pickFiniteNumber(nestedResult.profitSub)],
        ["penalty", pickFiniteNumber(nestedResult.penalty)],
        ["V", pickFiniteNumber(nestedResult.V)],
        ["coverCore", pickFiniteNumber(nestedResult.coverCore)],
        ["card_scores", nestedResult.card_scores && typeof nestedResult.card_scores === "object" ? nestedResult.card_scores : undefined]
      ])
    : null;
  const safeDetail = withDefinedEntries([
    ["units", pickFiniteNumber(detail.units, result.units)],
    ["profit", pickFiniteNumber(detail.profit, result.profit)],
    ["revenueNet", pickFiniteNumber(detail.revenueNet)],
    ["variableCost", pickFiniteNumber(detail.variableCost)],
    ["fixedCost", pickFiniteNumber(detail.fixedCost, detail.f_total)],
    ["f_total", pickFiniteNumber(detail.f_total, detail.fixedCost)],
    ["unitMargin", pickFiniteNumber(detail.unitMargin, detail.unitProfitHW, result.profit_per_unit)],
    ["breakeven_q", pickFiniteNumber(detail.breakeven_q)],
    ["profitSub", pickFiniteNumber(detail.profitSub)],
    ["penalty", pickFiniteNumber(detail.penalty)],
    ["price", pickFiniteNumber(detail.P, detail.price)],
    ["dCOGS", pickFiniteNumber(detail.dCOGS)],
    ["risk", pickFiniteNumber(detail.risk)],
    ["nre_total_wan", pickFiniteNumber(detail.nre_total_wan)],
    ["card_scores", detail.card_scores && typeof detail.card_scores === "object" ? detail.card_scores : undefined],
    ["matched_grid", pickNonEmptyString(detail.matched_grid, result.matched_grid)],
    ["market_size_yi", pickFiniteNumber(detail.market_size_yi, result.market_size_yi)],
    ["hhi", pickFiniteNumber(detail.hhi, result.hhi)],
    ["hhi_label", pickNonEmptyString(detail.hhi_label, result.hhi_label)],
    ["result", safeNestedResult && Object.keys(safeNestedResult).length ? safeNestedResult : undefined]
  ]);
  return withDefinedEntries([
    ["flow_version", pickNonEmptyString(result.flow_version)],
    ["units", pickFiniteNumber(result.units, safeDetail.units)],
    ["profit", pickFiniteNumber(result.profit, safeDetail.profit)],
    ["profit_per_unit", pickFiniteNumber(result.profit_per_unit)],
    ["unitMargin", pickFiniteNumber(safeDetail.unitMargin, result.profit_per_unit)],
    ["revenueNet", pickFiniteNumber(safeDetail.revenueNet)],
    ["variableCost", pickFiniteNumber(safeDetail.variableCost)],
    ["fixedCost", pickFiniteNumber(safeDetail.fixedCost)],
    ["f_total", pickFiniteNumber(safeDetail.f_total)],
    ["nre_total_wan", pickFiniteNumber(safeDetail.nre_total_wan)],
    ["breakeven_q", pickFiniteNumber(safeDetail.breakeven_q)],
    ["profitSub", pickFiniteNumber(safeDetail.profitSub)],
    ["penalty", pickFiniteNumber(safeDetail.penalty)],
    ["price", pickFiniteNumber(safeDetail.price)],
    ["dCOGS", pickFiniteNumber(safeDetail.dCOGS)],
    ["risk_total", pickFiniteNumber(safeDetail.risk)],
    ["vscore", pickFiniteNumber(result.vscore, safeNestedResult?.V)],
    ["best_grid", pickNonEmptyString(result.best_grid, result.matched_grid)],
    ["matched_grid", pickNonEmptyString(result.matched_grid, result.best_grid)],
    ["market_size_yi", pickFiniteNumber(result.market_size_yi, safeDetail.market_size_yi)],
    ["hhi", pickFiniteNumber(result.hhi, safeDetail.hhi)],
    ["hhi_label", pickNonEmptyString(result.hhi_label, safeDetail.hhi_label)],
    ["computed_at", result.computed_at || null],
    ["result", Object.keys(safeDetail).length ? safeDetail : undefined]
  ]);
}

function sanitizeStudentInterviewResult(result) {
  if (!result || typeof result !== "object") return result || null;
  return withDefinedEntries([
    ["radar", result.radar && typeof result.radar === "object" ? normalizeRadarPayload(result.radar) : undefined],
    ["summary", String(result.summary || "").trim()],
    ["tags", Array.isArray(result.tags) ? result.tags : undefined],
    ["evi", Number.isFinite(Number(result.evi)) ? Number(result.evi) : undefined],
    ["interviewQuality", result.interviewQuality && typeof result.interviewQuality === "object" ? result.interviewQuality : undefined]
  ]);
}

function sanitizeStudentStoredRadar(radar) {
  if (!radar || typeof radar !== "object") return radar;
  return withDefinedEntries([
    ["radar", radar.radar && typeof radar.radar === "object" ? normalizeRadarPayload(radar.radar) : undefined],
    ["tags", Array.isArray(radar.tags) ? radar.tags : undefined],
    ["evi", Number.isFinite(Number(radar.evi)) ? Number(radar.evi) : undefined],
    ["updated_at", radar.updated_at || null]
  ]);
}

function buildComputationContext({ teamId, sessionId, memberId, source = "web" }) {
  const team_id = String(teamId || "").trim();
  const session_id = String(sessionId || "").trim();
  if (!team_id || !session_id) return null;
  const member_id = String(memberId || "").trim();
  return {
    team_id,
    session_id,
    member_id: member_id || null,
    source
  };
}

function uniqueStrings(list) {
  return Array.from(new Set((Array.isArray(list) ? list : [])
    .map((item) => String(item || "").trim())
    .filter(Boolean)));
}

function countInterviewTurns(history) {
  return (Array.isArray(history) ? history : []).filter((item) => item?.role === "user").length;
}

function cleanExtractedString(value) {
  return String(value || "")
    .replace(/\uFFFD/g, "")
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .trim();
}

function cleanExtractedPayload(value) {
  if (Array.isArray(value)) {
    return value.map((item) => cleanExtractedPayload(item));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, cleanExtractedPayload(item)])
    );
  }
  if (typeof value === "string") {
    return cleanExtractedString(value);
  }
  return value;
}

function normalizeTextList(list) {
  return uniqueStrings(list).slice(0, 8);
}

function normalizeEvidenceList(list) {
  return (Array.isArray(list) ? list : [])
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const quote = String(item.quote || "").trim();
      const reason = String(item.reason || "").trim();
      if (!quote && !reason) return null;
      return { quote, reason };
    })
    .filter(Boolean)
    .slice(0, 4);
}

function normalizeStrength(value, evidenceList, scenarioList, painList) {
  const raw = String(value || "").trim().toLowerCase();
  if (raw === "strong" || raw === "weak") return raw;
  if (evidenceList.length >= 2 && (scenarioList.length > 0 || painList.length > 0)) return "strong";
  if (evidenceList.length > 0 || scenarioList.length > 0 || painList.length > 0) return "weak";
  return "weak";
}

function normalizeDimensionEvidence(entry) {
  if (!entry || typeof entry !== "object") {
    return {
      mentioned: false,
      strength: "weak",
      evidence: [],
      needs: [],
      scenarios: [],
      pain_points: []
    };
  }
  const evidence = normalizeEvidenceList(entry.evidence);
  const needs = normalizeTextList(entry.needs);
  const scenarios = normalizeTextList(entry.scenarios);
  const painPoints = normalizeTextList(entry.pain_points);
  const mentioned = entry.mentioned === true || evidence.length > 0 || needs.length > 0 || scenarios.length > 0 || painPoints.length > 0;
  return {
    mentioned,
    strength: normalizeStrength(entry.strength, evidence, scenarios, painPoints),
    evidence,
    needs,
    scenarios,
    pain_points: painPoints
  };
}

function normalizeInterviewQuality(raw) {
  const quality = raw && typeof raw === "object" ? raw : {};
  const normalize = (value) => {
    const text = String(value || "").trim().toLowerCase();
    if (text === "high" || text === "medium" || text === "low") return text;
    return "medium";
  };
  return {
    specificity: normalize(quality.specificity),
    consistency: normalize(quality.consistency),
    actionability: normalize(quality.actionability)
  };
}

function summarizeTextList(list, maxItems = 2) {
  return uniqueStrings(list).slice(0, maxItems).join("、");
}

function trimSummaryText(text, limit = 120) {
  return String(text || "").replace(/\s+/g, " ").trim().slice(0, limit);
}

function buildDimensionInsight(dim, evidenceBlock) {
  const label = DIM_LABEL[dim] || dim;
  if (!evidenceBlock?.mentioned) {
    return `该维度暂无明确访谈证据，当前评分主要来自 ${label} 的战略先验。`;
  }

  const scenarioText = summarizeTextList(evidenceBlock.scenarios, 2);
  const painText = summarizeTextList(evidenceBlock.pain_points, 2);
  const needText = summarizeTextList(evidenceBlock.needs, 2);
  const quoteText = trimSummaryText(evidenceBlock.evidence?.[0]?.quote || "", 80);

  const parts = [];
  if (scenarioText) parts.push(`场景：${scenarioText}`);
  if (painText) parts.push(`痛点：${painText}`);
  if (needText) parts.push(`需求：${needText}`);
  if (!parts.length && quoteText) parts.push(`原话：${quoteText}`);
  if (!parts.length) {
    return `${label} 有访谈提及，但证据较弱，当前评分基于有限访谈信号。`;
  }
  return parts.join("；");
}

function buildInterviewSummaryText(memberDims, insightsByDim) {
  const lines = (Array.isArray(memberDims) ? memberDims : [])
    .map((dim) => {
      const insight = String(insightsByDim?.[dim] || "").trim();
      if (!insight) return "";
      return `${DIM_LABEL[dim] || dim}：${insight}`;
    })
    .filter(Boolean)
    .slice(0, 3);
  return lines.join(" ");
}

function buildFocusedDimensionHints(memberDims) {
  return (Array.isArray(memberDims) ? memberDims : [])
    .map((dim) => `- ${dim}: ${DIM_EVIDENCE_HINTS[dim] || ""}`)
    .filter((line) => !line.endsWith(": "))
    .join("\n");
}

function buildDimensionSummaryLines(memberDims) {
  return DIM_KEYS_SHORT.map((dim) => {
    const focusMark = Array.isArray(memberDims) && memberDims.includes(dim) ? "重点分析" : "可选记录";
    return `- ${dim}: ${DIM_LABEL[dim]}，${focusMark}`;
  }).join("\n");
}

function buildExtractInterviewMessages({ gridId, memberDims, conversation }) {
  const focused = Array.isArray(memberDims) && memberDims.length ? memberDims : ["interaction", "safety"];
  const exampleFocused = focused.slice(0, 2);
  if (exampleFocused.length < 2) exampleFocused.push(exampleFocused[0] === "interaction" ? "safety" : "interaction");
  const [exampleDim1, exampleDim2] = exampleFocused;
  const allowedTagsText = ALLOWED_INTERVIEW_TAGS.join("、");
  const gridLabel = inferBestGridLabel(gridId);
  return [
    {
      role: "system",
      content: [
        "你是访谈证据提取助手。你的任务不是主观打分，而是从对话中提取明确出现过的用户需求证据。",
        "",
        "严格规则：",
        "1. 只输出 JSON，不要输出 markdown、解释或额外文字。",
        "2. 只能依据访谈原文提取，不要脑补，不要根据常识补全。",
        "3. 如果某个维度没有明确证据，就不要强行判断。",
        "4. 不要给 6 个维度直接打分。",
        "5. 每条 evidence 必须能在对话中找到对应语句或明确含义。",
        "6. 如果用户表达模糊，就标记为 weak；如果表达具体、有场景、有后果，就标记为 strong。",
        "7. 未提及的维度必须列入 missing_dimensions。",
        "8. tags 必须来自访谈真实内容，不要机械复述维度名。",
        "9. 如果没有看到明确语句，不要写“可能”“推测”“应该”。",
        "10. focused_dimensions 里的维度才输出详细 evidence/needs/scenarios/pain_points。",
        "11. other_dimensions 只输出 mentioned 和 brief，不要输出详细 evidence 块。",
        "12. 对 focused_dimensions，只要访谈里出现了与该维度相关的具体场景、困扰或期待，即使没有直接说产品方案，也应该标记 mentioned=true，并用 weak/strong 区分证据强度。",
        "13. 不要把“没有明确说产品功能”误判为“没有维度证据”。",
        "14. tags 只能从给定的合法标签列表中选择，不要自创标签。",
        "15. 每个 tag 都必须有访谈证据支持，不能因为常识或联想就输出。",
        "16. 如果访谈内容无法匹配合法标签列表中的任何标签，该需求写进 evidence/needs/scenarios/pain_points，但不要输出 tag。",
        "17. 只输出访谈中有明确证据支撑的标签。如果访谈内容不足，宁可输出少量标签，不要凑数。",
        `18. 不要输出与当前市场（${gridLabel || String(gridId || "")}）明显无关的标签。`
      ].join("\n")
    },
    {
      role: "user",
      content: [
        "请从以下访谈中提取结构化证据。",
        "",
        `背景：`,
        `- grid_id: ${String(gridId || "")}`,
        `- 当前市场: ${gridLabel || String(gridId || "")}`,
        `- 本成员负责维度: ${focused.join(", ")}`,
        "- 只重点分析这些负责维度，但如果对其他维度也有明确证据，可以记录在 other_dimensions 中",
        "- 维度定义：",
        buildDimensionSummaryLines(focused),
        "  - interaction: 用户希望机器人如何沟通、回应、表达情感、理解说话节奏",
        "  - perception: 用户希望机器人理解情绪、识别人、识别场景、感知状态",
        "  - motion: 用户希望机器人如何移动、跟随、避障、靠近、保持距离",
        "  - safety: 用户关心隐私、安全、跌倒、监护、误操作、伤害风险、信任",
        "  - extend: 用户关心与手机/家居/其他设备连接、扩展功能、联动",
        "  - ops: 用户关心充电、维护、故障、耐用、售后、使用门槛、持续运营",
        "- focused_dimensions 的识别提示：",
        buildFocusedDimensionHints(focused),
        "- 合法标签列表（只能从这里选，不要自创）：",
        allowedTagsText,
        "- tags 输出规则：",
        "  - tags 只能从上面的列表中选取，不要自创标签",
        "  - 只能输出访谈中有明确证据支撑的标签",
        "  - 从对话中提取 0-8 个需求标签，证据不足时宁可少量，不要凑数",
        "  - 每个标签必须有访谈证据支持",
        "  - 如果访谈内容无法匹配列表中的任何标签，该需求记录在 evidence 中但不输出 tag",
        `  - 不要输出与当前市场（${gridLabel || String(gridId || "")}）明显无关的标签`,
        "",
        "访谈记录：",
        conversation,
        "",
        "请输出 JSON，格式严格如下：",
        "{",
        `  \"focused_dimensions\": [\"${exampleDim1}\", \"${exampleDim2}\"],`,
        "  \"dimension_evidence\": {",
        `    \"${exampleDim1}\": {`,
        "      \"mentioned\": true,",
        "      \"strength\": \"strong\",",
        "      \"evidence\": [",
        "        {",
          "          \"quote\": \"原话摘要或短句\",",
        `          \"reason\": \"为什么它说明了 ${exampleDim1} 需求\"`,
        "        }",
        "      ],",
        "      \"needs\": [\"从访谈原文提炼出的需求\"],",
        "      \"scenarios\": [\"下班回家开门时\"],",
        "      \"pain_points\": [\"从访谈原文提炼出的痛点\"]",
        "    }",
        "  },",
        "  \"other_dimensions\": {",
        "    \"safety\": {",
        "      \"mentioned\": false,",
        "      \"brief\": \"\"",
        "    }",
        "  },",
        "  \"tags\": [\"情感陪伴\", \"语音交互\"],",
        "  \"interview_quality\": {",
        "    \"specificity\": \"high\",",
        "    \"consistency\": \"medium\",",
        "    \"actionability\": \"medium\"",
        "  },",
        "  \"missing_dimensions\": [\"perception\", \"safety\", \"extend\", \"ops\"]",
        "}"
      ].join("\n")
    }
  ];
}

function inferWeakEvidenceFromConversation(dim, conversation) {
  const text = String(conversation || "");
  if (!text) return null;
  const rules = {
    interaction: {
      pattern: /回应|说话|聊天|接话|声音|提醒|互动|陪伴|陪着|被听见|回应感|喊一声/u,
      reason: "访谈中出现了与回应、说话或陪伴相关的具体生活表达，可视为交互需求的弱证据。"
    },
    perception: {
      pattern: /看见|见证|懂|理解|情绪|状态|分寸|察觉|光线|安静|环境/u,
      reason: "访谈中出现了希望被理解、被看见或对环境状态有感知的表达，可视为感知需求的弱证据。"
    },
    motion: {
      pattern: /起身|走动|移动|跟着|靠近|跑过来|挡路|距离|蹭|沙发|玄关|拿.*水|拿.*充电宝|洗澡|换衣/u,
      reason: "访谈中出现了行动负担、靠近方式或在家中移动的具体场景，可视为运动需求的弱证据。"
    },
    safety: {
      pattern: /跌倒|摔|隐私|危险|监护|信任|受伤|误操作|安全/u,
      reason: "访谈中出现了安全、风险或信任相关表述，可视为安全需求的弱证据。"
    },
    extend: {
      pattern: /开灯|灯没关|空调|烧水|放音乐|手机|联动|设备|提醒|智能家居|电视|环境控制/u,
      reason: "访谈中出现了设备联动、环境控制或提醒相关场景，可视为扩展连接需求的弱证据。"
    },
    ops: {
      pattern: /麻烦|负担|维护|充电|没电|坏了|修|售后|照顾|不想动|操作|记不住|成本|折腾|还得自己|操心/u,
      reason: "访谈中出现了使用负担、维护成本或操作门槛相关场景，可视为运营维护需求的弱证据。"
    }
  };
  const rule = rules[dim];
  if (!rule || !rule.pattern.test(text)) return null;
  const sentence = text.split(/\n/).find((line) => rule.pattern.test(line)) || text.slice(0, 80);
  return {
    mentioned: true,
    strength: "weak",
    evidence: [{ quote: sentence.trim().slice(0, 120), reason: rule.reason }],
    needs: [],
    scenarios: [],
    pain_points: []
  };
}

function scoreDimensionFromEvidence({ evidenceBlock, turnCount }) {
  const evidenceCount = evidenceBlock.evidence.length;
  const needCount = evidenceBlock.needs.length;
  const scenarioCount = evidenceBlock.scenarios.length;
  const painCount = evidenceBlock.pain_points.length;
  const strength = evidenceBlock.strength || "weak";

  let base = 3.5;

  if (strength === "strong") base += 1.0;
  if (strength === "weak") base += 0.3;

  if (evidenceCount >= 2) base += 0.8;
  else if (evidenceCount === 1) base += 0.3;

  if (scenarioCount >= 1) base += 0.5;
  if (painCount >= 1) base += 0.5;
  if (needCount >= 2) base += 0.4;

  if (turnCount >= 6) base += 0.3;
  if (turnCount <= 3) base -= 0.3;

  let confidence = "medium";
  if (strength === "strong" && evidenceCount >= 2 && scenarioCount >= 1) {
    confidence = "high";
  } else if (evidenceCount === 0) {
    confidence = "low";
  }

  return {
    score: roundTo(clamp(base, 1, 9), 1),
    confidence
  };
}

function computeEviFromEvidence({ extracted, focusedBlocks, history }) {
  const normalizedBlocks = Array.isArray(focusedBlocks)
    ? focusedBlocks.filter((block) => block && block.mentioned)
    : [];

  const totalEvidence = normalizedBlocks.reduce((sum, block) => sum + block.evidence.length, 0);
  const strongDims = normalizedBlocks.filter((block) => block.strength === "strong").length;
  const scenarioDims = normalizedBlocks.filter((block) => block.scenarios.length > 0).length;
  const painDims = normalizedBlocks.filter((block) => block.pain_points.length > 0).length;
  const turnCount = countInterviewTurns(history);
  const quality = normalizeInterviewQuality(extracted?.interview_quality);

  let evi = 0.20;
  evi += Math.min(totalEvidence * 0.08, 0.24);
  evi += strongDims * 0.08;
  evi += scenarioDims * 0.06;
  evi += painDims * 0.06;

  if (turnCount >= 6) evi += 0.06;
  if (turnCount >= 8) evi += 0.04;

  if (quality.specificity === "high") evi += 0.05;
  if (quality.consistency === "high") evi += 0.04;
  if (quality.actionability === "high") evi += 0.04;
  if (quality.actionability === "low") evi -= 0.04;

  return roundTo(clamp(evi, 0.3, 0.85), 2);
}

function buildTagCandidatesForDims(dims, currentTags) {
  const used = new Set(currentTags);
  const candidates = [];
  (Array.isArray(dims) ? dims : []).forEach((dim) => {
    (DIM_TAGS[dim] || []).forEach((tag) => {
      if (!ALLOWED_INTERVIEW_TAG_SET.has(tag) || used.has(tag)) return;
      used.add(tag);
      candidates.push(tag);
    });
  });
  return candidates;
}

function toTagEntry(tag, source = "interview") {
  const text = typeof tag === "string" ? tag : tag?.tag;
  const normalizedTag = String(text || "").trim();
  if (!normalizedTag) return null;
  const entry = tag && typeof tag === "object" ? { ...tag } : {};
  entry.tag = normalizedTag;
  if (!entry.source) entry.source = source;
  return entry;
}

function dedupeTagEntries(tags, limit = 8) {
  const result = [];
  const seen = new Set();
  for (const item of Array.isArray(tags) ? tags : []) {
    const entry = toTagEntry(item);
    const tag = String(entry?.tag || "").trim();
    if (!tag || !ALLOWED_INTERVIEW_TAG_SET.has(tag) || seen.has(tag)) continue;
    seen.add(tag);
    result.push(entry);
    if (result.length >= limit) break;
  }
  return result;
}

function getGridDefaultTags(gridId, architecture) {
  const normalizedGridId = /^B2[BC]_/.test(String(gridId || "").trim())
    ? String(gridId || "").trim()
    : toCalcGridId(gridId, architecture);
  const priors = getGridPriors();
  const grid = (priors.grids || []).find((item) => item.id === normalizedGridId);
  return uniqueStrings([
    ...(grid?.recommended_core_tags || []),
    ...(grid?.recommended_nice_tags || [])
  ]).filter((tag) => ALLOWED_INTERVIEW_TAG_SET.has(tag));
}

function filterIncompatibleTags(tags, gridLabel) {
  const grid = String(gridLabel || "").toLowerCase();
  return (Array.isArray(tags) ? tags : []).filter((item) => {
    const tag = String((typeof item === "string" ? item : item?.tag) || "").toLowerCase();
    if (!tag) return false;
    if (grid.includes("老人") && (tag.includes("儿童") || tag.includes("幼儿"))) return false;
    if (grid.includes("儿童") && (tag.includes("退休") || tag.includes("养老") || tag.includes("失智"))) return false;
    return true;
  });
}

function normalizeExtractedTags(tags, memberDims, dimensionEvidence = {}, options = {}) {
  const gridLabel = String(options.gridLabel || inferBestGridLabel(options.gridId || "") || "").trim();
  let result = dedupeTagEntries(
    filterIncompatibleTags(
      normalizeTextList(tags).map((tag) => ({ tag, source: "interview" })),
      gridLabel
    ),
    8
  );
  const existing = new Set(result.map((item) => item.tag));

  if (result.length < MIN_NORMALIZED_TAG_COUNT) {
    console.warn(`[tag_layering] 访谈标签不足(${result.length}), 用格子先验补充`);
    const gridDefaultTags = filterIncompatibleTags(
      getGridDefaultTags(options.gridId, options.architecture),
      gridLabel
    );
    for (const tag of gridDefaultTags) {
      if (result.length >= MIN_NORMALIZED_TAG_COUNT) break;
      if (existing.has(tag)) continue;
      existing.add(tag);
      result.push({ tag, polarity: 1, source: "grid_prior" });
    }
  }

  if (result.length < MIN_NORMALIZED_TAG_COUNT) {
    const ownedDims = Array.isArray(memberDims) ? uniqueStrings(memberDims) : [];
    const mentionedDims = DIM_KEYS_SHORT.filter((dim) => dimensionEvidence?.[dim]?.mentioned);
    const fillOrder = [
      ...mentionedDims,
      ...ownedDims,
      ...DIM_KEYS_SHORT
    ];
    const dimFallbackTags = filterIncompatibleTags(
      buildTagCandidatesForDims(fillOrder, Array.from(existing)),
      gridLabel
    );
    for (const tag of dimFallbackTags) {
      if (result.length >= MIN_NORMALIZED_TAG_COUNT) break;
      if (existing.has(tag)) continue;
      existing.add(tag);
      result.push({ tag, polarity: 1, source: "dim_fallback" });
    }
  }

  if (result.length > 0) return result.slice(0, 8);

  const ownedDims = Array.isArray(memberDims) ? uniqueStrings(memberDims) : [];
  const mentionedDims = DIM_KEYS_SHORT.filter((dim) => dimensionEvidence?.[dim]?.mentioned);
  const fillOrder = [
    ...mentionedDims,
    ...ownedDims,
    ...DIM_KEYS_SHORT
  ];
  return dedupeTagEntries(
    filterIncompatibleTags(
      buildTagCandidatesForDims(fillOrder, []).map((tag) => ({ tag, source: "dim_fallback" })),
      gridLabel
    ),
    6
  );
}

function mapEvidenceToResult({ gridId, architecture, memberDims, extracted, history, conversation }) {
  const prior = getPriorRadarByGrid(gridId, architecture);
  const responsible = new Set(Array.isArray(memberDims) ? memberDims : []);
  const dimScores = {};
  const confidence = {};
  const lowConfidenceDims = [];
  const focusedBlocks = [];
  const insightsByDim = {};
  const scoreSource = {};
  const rawExtractedTags = normalizeTextList(extracted?.tags)
    .filter((tag) => ALLOWED_INTERVIEW_TAG_SET.has(tag))
    .slice(0, 8);

  DIM_KEYS_SHORT.forEach((dim) => {
    if (!responsible.has(dim)) {
      dimScores[dim] = jitter(prior[dim]);
      confidence[dim] = "low";
      scoreSource[dim] = "not_owned";
      lowConfidenceDims.push(dim);
      return;
    }

    const evidenceBlock = normalizeDimensionEvidence(
      extracted?.dimension_evidence?.[dim] || extracted?.other_dimensions?.[dim]
    );

    const inferredEvidence = !evidenceBlock.mentioned
      ? inferWeakEvidenceFromConversation(dim, conversation)
      : null;
    const finalEvidence = inferredEvidence
      ? normalizeDimensionEvidence(inferredEvidence)
      : evidenceBlock;
    focusedBlocks.push(finalEvidence);

    if (!finalEvidence.mentioned) {
      dimScores[dim] = roundTo(clamp(prior[dim], 1, 9), 1);
      confidence[dim] = "low";
      scoreSource[dim] = "grid_prior";
      insightsByDim[dim] = buildDimensionInsight(dim, finalEvidence);
      lowConfidenceDims.push(dim);
      console.log("[Round2][DimensionScore]", JSON.stringify({
        dim,
        inputTags: rawExtractedTags,
        priorScore: roundTo(clamp(prior[dim], 1, 9), 1),
        finalScore: dimScores[dim],
        scoreSource: scoreSource[dim],
        confidence: confidence[dim],
        evidence: finalEvidence
      }));
      return;
    }

    const scoreInfo = scoreDimensionFromEvidence({
      evidenceBlock: finalEvidence,
      turnCount: countInterviewTurns(history)
    });

    dimScores[dim] = scoreInfo.score;
    confidence[dim] = scoreInfo.confidence;
    scoreSource[dim] = "interview_evidence";
    insightsByDim[dim] = buildDimensionInsight(dim, finalEvidence);
    if (scoreInfo.confidence !== "high") lowConfidenceDims.push(dim);
    console.log("[Round2][DimensionScore]", JSON.stringify({
      dim,
      inputTags: rawExtractedTags,
      priorScore: roundTo(clamp(prior[dim], 1, 9), 1),
      finalScore: dimScores[dim],
      scoreSource: scoreSource[dim],
      confidence: confidence[dim],
      evidence: finalEvidence
    }));
  });

  const evi = computeEviFromEvidence({ extracted, focusedBlocks, history });
  const dimensionEvidence = {};
  DIM_KEYS_SHORT.forEach((dim) => {
    const evidenceBlock = normalizeDimensionEvidence(
      extracted?.dimension_evidence?.[dim] || extracted?.other_dimensions?.[dim]
    );
    dimensionEvidence[dim] = evidenceBlock;
  });
  const extractedTags = normalizeExtractedTags(extracted?.tags, memberDims, dimensionEvidence, {
    gridId,
    architecture,
    gridLabel: inferBestGridLabel(gridId)
  }).map((item) => ({
    tag: item.tag,
    polarity: Number.isFinite(Number(item.polarity)) ? Number(item.polarity) : 1,
    source: item.source || "interview"
  }));
  const ownedDims = Array.isArray(memberDims) ? memberDims : [];
  const mentionedOwnedDims = ownedDims.filter((dim) => dimensionEvidence[dim]?.mentioned).length;
  const interviewQuality = normalizeInterviewQuality(extracted?.interview_quality);
  const summary = buildInterviewSummaryText(memberDims, insightsByDim);
  console.log("[Round2][InterviewPipeline]", JSON.stringify({
    rawGridId: String(gridId || ""),
    architecture: String(architecture || ""),
    inputTags: rawExtractedTags,
    normalizedTags: extractedTags,
    evi,
    radar: dimToRadarKeys(dimScores),
    confidence,
    scoreSource
  }));

  return {
    radar: dimToRadarKeys(dimScores),
    tags: extractedTags,
    evi,
    confidence,
    lowConfidenceDims: uniqueStrings(lowConfidenceDims),
    insightsByDim,
    scoreSource,
    summary,
    dimensionEvidence,
    interviewQuality,
    eviMeta: {
      raw_evi: roundForLog(evi),
      tag_count: extractedTags.length,
      dim_coverage: ownedDims.length > 0 ? roundForLog(mentionedOwnedDims / ownedDims.length) : 0,
      final_evi: roundForLog(evi)
    }
  };
}

function buildInterviewSystemPrompt({ persona, gridDesc, vpSummary, memberDims }) {
  const dims = (Array.isArray(memberDims) ? memberDims : []).slice(0, 2);
  const d1 = DIM_PROMPT_MAP[dims[0]] || { name: "交互与表达", tags: "语音交互、情感陪伴" };
  const d2 = DIM_PROMPT_MAP[dims[1]] || { name: "安全与信任", tags: "隐私保护、跌倒检测" };
  const basePersona = persona || {};
  const personaName = String(basePersona.name || "访谈对象").trim();
  const personaAge = Number(basePersona.age || 0) > 0 ? `${Number(basePersona.age)}岁` : "";
  const personaOccupation = String(basePersona.title || basePersona.occupation || "普通用户").trim();
  const personaOrg = [String(basePersona.org_type || "").trim(), String(basePersona.org_scale || "").trim()].filter(Boolean).join("，");
  const personaLiving = String(basePersona.living_situation || personaOrg || "日常生活节奏稳定").trim();
  const personaTrigger = String(basePersona.trigger || "").trim();

  return [
    "你正在扮演一个真实的人，参加一场产品调研访谈。",
    "",
    `姓名：${personaName}${personaAge ? `，${personaAge}` : ""}`,
    `角色：${personaOccupation}`,
    `${personaOrg ? `机构：${personaOrg}` : `背景：${personaLiving}`}`,
    `${personaTrigger ? `最近触发事件：${personaTrigger}` : ""}`,
    "",
    "## 扮演规则",
    "1. 你不知道自己想要什么产品，只知道自己的生活和感受",
    "2. 学生问\"你想要什么功能\"时，要用生活语言回答，不用产品语言",
    "3. 不会主动说出所有痛点，需要学生追问",
    "4. 回答要简短自然，像真实对话",
    "5. 如果学生问得很表面，你就给表面答案；问得深入，你才深入回答",
    "6. 你是被邀请来聊天的，不是来咨询产品的",
    "7. 除非学生先介绍了产品并邀请你评价，否则不要主动提到 AI 宠物机器人、机器人、功能，也不要主动追问产品能做什么",
    "8. 你的默认状态是：聊自己的生活、困扰、期待和真实场景",
    "",
    "## 关于访谈背景",
    "有人邀请你参加一个产品调研，说是关于\"智能家居\"或\"家用机器人\"方面的，你答应了但具体是什么产品你也不太清楚。你来了就是聊聊，没什么预设期待。",
    "",
    "## 访谈内部关注点",
    "以下内容仅用于帮助你联想到自己的生活场景，不要主动复述，更不要主动使用其中的品牌名或功能名：",
    `- 目标市场：${gridDesc}`,
    `- 讨论摘要：${vpSummary}`,
    `- ${d1.name}：关注 ${d1.tags}`,
    `- ${d2.name}：关注 ${d2.tags}`,
    "",
    "全程中文。"
  ].join("\n");
}

async function extractInterviewResult({ gridId, architecture, memberDims, history }) {
  const conversation = (history || [])
    .map((m) => `${m.role === "user" ? "学生" : m.speaker || "用户"}：${m.text || ""}`)
    .join("\n");

  let extracted;
  try {
    const messages = buildExtractInterviewMessages({ gridId, memberDims, conversation });
    const raw = await withLlmLogging({
      caller: "round2Routes.extractInterviewResult",
      teamId: null,
      memberId: null,
      messages
    }, () => chatCompletion(messages, {
      temperature: 0.2,
      max_tokens: 6000,
      maxRetries: 5,
      response_format: { type: "json_object" },
      timeoutMs: ROUND2_LLM_TIMEOUT_MS
    }));
    const txt = String(raw || "").replace(/```json|```/g, "").trim();
    if (!txt) {
      throw new InterviewScoringError("llm_empty");
    }
    const start = txt.indexOf("{");
    const end = txt.lastIndexOf("}");
    const jsonText = start >= 0 && end > start ? txt.slice(start, end + 1) : txt;
    let parsed;
    try {
      parsed = JSON.parse(jsonText);
    } catch (parseErr) {
      throw new InterviewScoringError("llm_unparseable", parseErr);
    }
    extracted = cleanExtractedPayload(parsed);
    if (!extracted || typeof extracted !== "object") {
      throw new InterviewScoringError("llm_invalid_shape");
    }
  } catch (err) {
    if (err instanceof InterviewScoringError) throw err;
    console.error("[extractInterviewResult] LLM failed:", err.message, {
      gridId: String(gridId || ""),
      architecture: String(architecture || ""),
      memberDims: Array.isArray(memberDims) ? memberDims : []
    });
    throw new InterviewScoringError("llm_failed", err);
  }

  console.log("[Round2][TagExtract]", JSON.stringify({
    rawGridId: String(gridId || ""),
    architecture: String(architecture || ""),
    memberDims: Array.isArray(memberDims) ? memberDims : [],
    tags: normalizeExtractedTags(extracted?.tags, memberDims),
    missingDimensions: Array.isArray(extracted?.missing_dimensions) ? extracted.missing_dimensions : []
  }));

  return mapEvidenceToResult({ gridId, architecture, memberDims, extracted, history, conversation });
}

function parseGridId(gridId) {
  const raw = String(gridId || "").trim();
  const parts = raw.split("_");
  const customerRaw = String(parts[0] || "").toLowerCase();
  const strategyRaw = String(parts[1] || "").toLowerCase();
  const ageRaw = String(parts[2] || "").toLowerCase();

  const customerType = customerRaw === "tob" || customerRaw === "b2b" ? "ToB" : "ToC";
  const strategy = strategyRaw.includes("cost") ? "COST" : "DIFF";
  let ageGroup = "ADULT";
  if (ageRaw.includes("child")) ageGroup = "CHILD";
  if (ageRaw.includes("elder")) ageGroup = "ELDER";

  return { customerType, strategy, ageGroup };
}

function getRound2ChannelFeeByGrid(gridId) {
  const parsed = parseGridId(gridId);
  return parsed.customerType === "ToB" ? 0.15 : 0.25;
}

function normalizeArchitecture(value) {
  const v = String(value || "").trim().toLowerCase();
  if (v === "experience") return "Experience";
  if (v === "hybrid") return "Hybrid";
  if (v === "function") return "Function";
  return "Experience";
}

function extractVpField(text, key) {
  const re = new RegExp(key + "\\s*[：:]\\s*([^\\n]+)");
  const match = String(text || "").match(re);
  return match ? match[1].trim() : "";
}

function normalizeVpSummary(summary, fallbackText = "") {
  const src = summary && typeof summary === "object" ? summary : {};
  const text = String(fallbackText || "").trim();
  return {
    who: String(src.who || extractVpField(text, "WHO") || "").trim(),
    pain: String(src.pain || extractVpField(text, "PAIN") || "").trim(),
    how: String(src.how || extractVpField(text, "HOW") || "").trim(),
    boundary: String(src.boundary || extractVpField(text, "BOUNDARY") || "").trim(),
    archConsistency: String(src.archConsistency || src.arch_consistency || "").trim(),
    coachComment: String(src.coachComment || src.coach_comment || "").trim()
  };
}

function normalizeChannels(c1, c2, share1) {
  const mapChannel = (c) => {
    const u = String(c || "").toUpperCase();
    if (u === "DIRECT") return "Direct";
    if (u === "DISTRIBUTOR") return "Distributor";
    return "Ecommerce";
  };
  const s = Number.isFinite(Number(share1)) ? Number(share1) : 60;
  return {
    channels: [mapChannel(c1), mapChannel(c2)],
    channelShare: [s / 100, (100 - s) / 100]
  };
}

function listTeamMembers(team) {
  return (Array.isArray(team?.members) ? team.members : [])
    .slice()
    .sort((a, b) => Number(a.member_index || 0) - Number(b.member_index || 0));
}

async function buildRound2Recap(teamId, phase4Body) {
  const team = await getTeam(teamId);
  if (!team) throw new Error("team not found");
  const round2State = await getTeamRound2State(teamId).catch(() => null);
  const sessionConfig = await getSessionConfig(team.session_id || "default");
  const effectiveRound2Status = String(round2State?.r2?.status || team.r2_status || "").trim();
  const revealR1Results = sessionConfig.reveal_r1_results === true || effectiveRound2Status === "R2_SUBMITTED";
  console.log("[R2] 读取 WTPadj(raw storage):", Number(team.final_wtp_adj || 0), "来源表:", "teams", "字段:", "final_wtp_adj");

  const parsed = parseGridId(team.final_grid_id);
  const ch = normalizeChannels(team.final_channel1, team.final_channel2, team.final_channel1_share);

  const base = Engine.computeRound1(
    {
      round1: {
        cell_id: team.final_grid_id,
        customer_type: parsed.customerType,
        strategy: parsed.strategy,
        age_group: parsed.ageGroup,
        arch_tag: normalizeArchitecture(team.final_architecture),
        fit_text: 1,
        channels: ch.channels,
        channel_share: ch.channelShare
      }
    },
    getEngineConfig()
  );

  const settleItems = Array.isArray(phase4Body?.settle?.settlements) ? phase4Body.settle.settlements : [];
  const market = settleItems
    .filter((x) => x.jinang_type === "market")
    .sort((a, b) => Number(b.match_strength || 0) - Number(a.match_strength || 0))[0] || null;
  const tech = settleItems
    .filter((x) => x.jinang_type === "tech")
    .sort((a, b) => Number(b.match_strength || 0) - Number(a.match_strength || 0))[0] || null;

  const share1 = Number(team.final_channel1_share || 60);
  const channelDesc = `${String(team.final_channel1 || "DIRECT").toUpperCase()} ${share1}% / ${String(team.final_channel2 || "ECOMMERCE").toUpperCase()} ${Math.max(0, 100 - share1)}%`;

  const calcGridId = toCalcGridId(team.final_grid_id, team.final_architecture || "");
  const round2Wtp = computeWTPParams(calcGridId, {
    round1GridId: team.final_grid_id,
    round1Context: { gridId: team.final_grid_id }
  });
  const Pmax = Math.round(Number(round2Wtp.WTPref || base.pmax || base.P_max || 14200));
  const WTP = Math.round(Number(round2Wtp.WTPmedian || round2Wtp.WTPref || base.WTP || base.wtp_median_price || Pmax));
  const pricingContext = buildRound2PricingContextForTeam(team);
  const e = Number(base.e || base.price_elasticity || 1.2);
  const f = getRound2ChannelFeeByGrid(team.final_grid_id);
  const COGSbase = Number(GLOBAL_PARAMS.V || base.cogs_proxy || base.COGS_proxy || 2000);
  const budget_cap = Math.round(COGSbase * 0.13);

  const vpScores = phase4Body?.vp_scores || {};
  const marketInfo = getRound2MarketInfo(team.final_grid_id);
  const matchedMarketCount = settleItems.filter((x) => x?.matched && x?.jinang_type === "market").length;
  const matchedTechCount = settleItems.filter((x) => x?.matched && x?.jinang_type === "tech").length;
  const displayedWtpAdjRaw = Number(phase4Body?.wtp_breakdown?.final_result?.WTPadj || team.final_wtp_adj || 0);
  const round1Baseline = buildGridBaselineMetrics(team.final_grid_id, team.final_architecture);
  const storedResult = revealR1Results ? await getStoredResult(teamId, team.session_id || "default") : null;
  const matchedGrid = String(storedResult?.matched_grid || storedResult?.best_grid || "").trim();
  const matchedBaseline = matchedGrid ? buildGridBaselineMetrics(matchedGrid, team.final_architecture) : null;
  const round1MarketLabel = inferBestGridLabel(team.final_grid_id);
  const round1SamRaw = team.final_sam != null && team.final_sam !== ""
    ? Number(team.final_sam)
    : (round1Baseline ? Number(round1Baseline.sam || 0) : null);
  const round1WtpAdjRaw = displayedWtpAdjRaw > 0
    ? displayedWtpAdjRaw
    : (team.final_wtp_adj != null && team.final_wtp_adj !== "" ? Number(team.final_wtp_adj) : null);
  const comparisonMoney = buildStudentRound1MoneyView({
    round1Sam: round1SamRaw,
    round1WtpAdj: round1WtpAdjRaw,
    matchedGridSam: matchedBaseline?.sam,
    matchedGridWtpRef: matchedBaseline?.wtp_ref,
    matchedGridWtpMean: matchedBaseline?.wtp_mean
  });
  const executionAlignment = matchedGrid && team.final_grid_id
    ? (toCalcGridId(team.final_grid_id, team.final_architecture) === matchedGrid ? "aligned" : "shifted")
    : "";
  const vpSummary = normalizeVpSummary(phase4Body?.team?.final_vp_summary || team.final_vp_summary, phase4Body?.team?.final_vp_text || team.final_vp_text || "");
  const marketJinangList = Array.isArray(phase4Body?.jinang?.market_jinangs)
    ? phase4Body.jinang.market_jinangs
    : [];
  const revealedJinangMarketList = marketJinangList.map((item) => ({
    card_id: item.id,
    name: item.name,
    member_id: item.member_id,
    member_name: item.member_name,
    match_tier: matchStrengthToTier(item.match_strength),
    bonus: Number(item.bonus || 0)
  }));
  const recapWtpBreakdown = phase4Body?.wtp_breakdown && typeof phase4Body.wtp_breakdown === "object"
    ? (() => {
        const nextBreakdown = { ...phase4Body.wtp_breakdown };
        if (!revealR1Results) {
          delete nextBreakdown.market_jinang_match_tier;
        }
        return nextBreakdown;
      })()
    : (phase4Body?.wtp_breakdown || null);
  console.log("[R2 pricing] 显示给学生的 WTPadj:", comparisonMoney.round1_wtp_adj, "raw:", displayedWtpAdjRaw);

  return {
    r1_results_revealed: revealR1Results,
    money_scale: PRICE_SCALE,
    money_scale_contract: MONEY_SCALE_CONTRACT,
    final_grid_id: team.final_grid_id,
    architecture: team.final_architecture || "",
    ...(revealR1Results
      ? {
          round1_grid_label: round1MarketLabel,
          ...comparisonMoney,
          matched_grid: matchedGrid || null,
          matched_grid_label: matchedBaseline?.grid_label || "",
          execution_alignment: executionAlignment,
          execution_alignment_label: executionAlignment === "aligned"
            ? "战略执行一致"
            : (executionAlignment === "shifted" ? "战略执行发生位移" : "")
        }
      : {}),
    vp_score: Number(phase4Body?.vp_scores?.VPscore || phase4Body?.r1_result?.VPscore || 0),
    vp_feedback: String(phase4Body?.vp_feedback || "").trim() || null,
    vp_scores: {
      C: Number(vpScores.C || 3),
      G: Number(vpScores.G || 3),
      E: Number(vpScores.E || 3)
    },
    vp_summary: vpSummary,
    wtp_breakdown: recapWtpBreakdown,
    jinang_tech: tech
      ? {
          card_id: tech.jinang_id,
          name: tech.name || tech.jinang_id,
          ...(revealR1Results ? { match_tier: matchStrengthToTier(tech.match_strength) } : {})
        }
      : null,
    jinang_market: market
      ? {
          card_id: market.jinang_id,
          name: market.name || market.jinang_id,
          bonus: Number(market.bonus || 0),
          ...(revealR1Results ? { match_tier: matchStrengthToTier(market.match_strength) } : {})
        }
      : null,
    ...(revealR1Results ? { jinang_market_list: revealedJinangMarketList } : {}),
    jinang_summary: {
      total_count: settleItems.length,
      matched_count: settleItems.filter((x) => Boolean(x?.matched)).length,
      matched_market_count: matchedMarketCount,
      matched_tech_count: matchedTechCount
    },
    P: pricingContext.default_price,
    Pmax,
    pricing_context: {
      ...pricingContext,
      money_scale: PRICE_SCALE,
      money_scale_contract: MONEY_SCALE_CONTRACT
    },
    price_min: pricingContext.price_min,
    price_max: pricingContext.price_max,
    price_step: pricingContext.price_step,
    default_price: pricingContext.default_price,
    WTP,
    e,
    f,
    COGSbase,
    channel_desc: channelDesc,
    budget_cap,
    TAM: 50000,
    H: 0.3,
    priceSensitive: false,
    market_size_yi: marketInfo.market_size_yi,
    hhi: marketInfo.hhi,
    hhi_label: marketInfo.hhi_label
  };
}

function mapAssignmentDims(groupDims) {
  return (Array.isArray(groupDims) ? groupDims : []).map((gid) => DIM_GROUP_TO_SHORT[gid] || gid);
}

function getPersonaGroup(gridId, personaAge = 0) {
  const raw = String(gridId || "").toUpperCase();
  if (raw.includes("ELDER")) return "ELDER";
  if (raw.includes("CHILD")) return "CHILD";
  if (raw.includes("ADULT")) return "ADULT";
  return Number(personaAge || 0) >= 60 ? "ELDER" : "ADULT";
}

function getLatestPhase3SessionRecord(sessions) {
  return (Array.isArray(sessions) ? sessions : [])
    .filter((item) => item && item.sessionId)
    .sort((a, b) => String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")))[0] || null;
}

function formatRound1ArchitectureLabel(architecture) {
  const raw = String(architecture || "").trim().toLowerCase();
  if (raw === "function" || raw === "功能" || raw === "功能型") return "功能型";
  if (raw === "experience" || raw === "体验" || raw === "体验型") return "体验型";
  return "混合型";
}

async function buildRound1PersonaContext(team) {
  if (!team?.id) return null;
  const sessions = await getTeamSessions(team.id).catch(() => []);
  const latestSession = getLatestPhase3SessionRecord(sessions);
  const confirmedFields = latestSession?.pmfScore?._confirmed_fields && typeof latestSession.pmfScore._confirmed_fields === "object"
    ? latestSession.pmfScore._confirmed_fields
    : null;
  const whoRaw = String(confirmedFields?.who_raw || "").trim();
  if (!whoRaw) return null;
  console.log("[R2 init] 读取数据库:", "PostgreSQL", team.id, "who_raw:", whoRaw);

  const gridId = String(team.final_grid_id || "").trim();
  const architecture = String(team.final_architecture || "").trim();
  const parsed = parseGridId(gridId);
  return {
    teamId: team.id,
    who_raw: whoRaw,
    gridId,
    gridLabel: inferBestGridLabel(gridId),
    architecture,
    architectureLabel: formatRound1ArchitectureLabel(architecture),
    isToB: parsed.customerType === "ToB"
  };
}

function hasNonEmptyText(value) {
  return String(value || "").trim().length > 0;
}

function hasNonEmptyList(value) {
  return Array.isArray(value) && value.some((item) => hasNonEmptyText(item));
}

function isLegacySeedPersona(persona) {
  const id = String(persona?.id || "").trim();
  return /^(elder|adult|child)_[a-z0-9_]+$/i.test(id);
}

function hasCompletePersonaProfile(persona) {
  if (!persona || typeof persona !== "object") return false;
  return hasNonEmptyText(persona.daily_routine)
    && hasNonEmptyList(persona.desires)
    && hasNonEmptyList(persona.pains)
    && hasNonEmptyText(persona.hidden_pain)
    && hasNonEmptyList(persona.contradictions);
}

function isReusableGeneratedPersona(persona, round1Context) {
  if (!persona || isLegacySeedPersona(persona) || !hasCompletePersonaProfile(persona)) return false;
  return isPersonaConsistentWithRound1Context(persona, round1Context);
}

async function generatePersonaVariant(round1Context, previousPersonas) {
  console.log("[round2Routes] generatePersonaVariant", {
    teamId: round1Context?.teamId || null,
    who_raw: String(round1Context?.who_raw || "").trim() || null,
    gridLabel: String(round1Context?.gridLabel || "").trim() || null,
    isToB: round1Context?.isToB === true,
    previousPersonasCount: Array.isArray(previousPersonas) ? previousPersonas.length : 0,
    previousPersonas: (Array.isArray(previousPersonas) ? previousPersonas : []).map((item) => ({
      name: String(item?.name || "").trim() || null,
      title: String(item?.title || item?.occupation || "").trim() || null
    }))
  });
  if (!round1Context?.who_raw || !round1Context?.gridLabel) {
    throw new Error("缺少 Round 1 who_raw/gridLabel，无法生成访谈对象");
  }

  let lastError = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const persona = await generatePersona(null, {
        teamId: round1Context.teamId,
        gridLabel: round1Context.gridLabel,
        who_raw: round1Context.who_raw,
        architectureLabel: round1Context.architectureLabel,
        isToB: round1Context.isToB,
        previousPersonas
      });
      if (hasCompletePersonaProfile(persona)) {
        return persona;
      }
      lastError = new Error("Persona 缺少必要字段");
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError || new Error("Persona 生成失败，请重试");
}

function isDecisionMakerTitle(title) {
  const src = String(title || "").trim();
  return /院长|总监|负责人|主任|经理|行长|副总|总经理|采购|运营|主管/.test(src);
}

function isPersonaConsistentWithRound1Context(persona, round1Context) {
  if (!persona || !round1Context) return false;
  const constraintWho = String(persona?.constraints?.who_raw || "").trim();
  const constraintGrid = String(persona?.constraints?.gridLabel || "").trim();
  if (constraintWho && constraintWho !== round1Context.who_raw) return false;
  if (constraintGrid && constraintGrid !== round1Context.gridLabel) return false;

  const title = String(persona?.title || persona?.occupation || "").trim();
  const orgType = String(persona?.org_type || "").trim();
  const budget = String(persona?.budget || "").trim();
  const pressures = Array.isArray(persona?.pressures) ? persona.pressures.filter(Boolean) : [];
  const family = String(persona?.family || "").trim();
  const spending = String(persona?.spending || "").trim();
  const dailyScenes = Array.isArray(persona?.daily_scenes) ? persona.daily_scenes.filter(Boolean) : [];

  if (round1Context.isToB) {
    const hasInstitutionSignal = Boolean(orgType) || Boolean(budget) || pressures.length > 0 || isDecisionMakerTitle(title);
    const hasConsumerSignal = Boolean(family) || Boolean(spending) || dailyScenes.length > 0;
    return hasInstitutionSignal && !hasConsumerSignal;
  }

  return !orgType && !budget && pressures.length === 0;
}

function isPersonaPoolConsistent(personaPool, round1Context) {
  const list = Array.isArray(personaPool) ? personaPool : [];
  if (!list.length) return false;
  return list.every((item) => isReusableGeneratedPersona(item, round1Context));
}

async function repairStaleInterviewSessions(team, memberId, sessions, personaPool) {
  const round1Context = await buildRound1PersonaContext(team);
  if (!round1Context) return Array.isArray(sessions) ? sessions : [];

  const nextSessions = Array.isArray(sessions) ? sessions.slice() : [];
  const completedIds = new Set(
    nextSessions
      .filter((item) => item?.is_complete)
      .map((item) => enrichPersonas(item.personas)[0]?.id)
      .filter(Boolean)
  );

  for (let index = 0; index < nextSessions.length; index += 1) {
    const session = nextSessions[index];
    if (!session || session.is_complete || session.member_id !== memberId) continue;

    const persona = enrichPersonas(session.personas)[0] || null;
    if (isReusableGeneratedPersona(persona, round1Context)) continue;

    // session 创建后 60 秒内锁定 persona，避免首轮输入时被并发请求替换。
    const lockedAt = session.persona_locked_at || session.created_at;
    if (lockedAt && (Date.now() - new Date(lockedAt).getTime()) < 60000) {
      continue;
    }

    const userTurns = (Array.isArray(session.history) ? session.history : []).filter((item) => item?.role === "user").length;
    if (userTurns > 0) continue;

    const replacement = (Array.isArray(personaPool) ? personaPool : []).find((item) => {
      if (!isReusableGeneratedPersona(item, round1Context)) return false;
      return !completedIds.has(item.id);
    });
    if (!replacement) continue;

    const updated = {
      ...session,
      personas: [replacement],
      // 替换 persona 后，清空旧 persona 生成的开场白/历史消息。
      history: [],
      messages: [],
      updated_at: nowIso()
    };
    await saveInterviewSession(updated);
    nextSessions[index] = updated;
  }

  return nextSessions;
}

async function ensureAssignmentPersonaPool({ assignments, assignmentIndex, team, minCount = 1 }) {
  const nextAssignments = Array.isArray(assignments) ? assignments.slice() : [];
  const row = nextAssignments[assignmentIndex];
  if (!row) return { assignments: nextAssignments, personaPool: [] };

  const targetCount = Math.max(0, Math.min(MAX_INTERVIEWS_PER_MEMBER, Number(minCount || 0)));
  const round1Context = await buildRound1PersonaContext(team);
  const existingVersion = Number(row.personaVersion || 0);
  const existingPool = existingVersion >= ROUND2_PERSONA_POOL_VERSION && Array.isArray(row.personaPool)
    ? row.personaPool.slice()
    : [];
  const existingPoolValid = round1Context ? isPersonaPoolConsistent(existingPool, round1Context) : false;
  const seedPool = existingPoolValid ? existingPool.slice() : [];
  if (seedPool.length >= targetCount) {
    return { assignments: nextAssignments, personaPool: seedPool };
  }
  if (existingPool.length && !existingPoolValid) {
    nextAssignments[assignmentIndex] = {
      ...row,
      personaPool: [],
      personaVersion: 0
    };
  }
  if (!round1Context) {
    throw new Error("缺少 Round 1 who_raw/gridLabel，无法生成访谈对象");
  }

  const otherMemberPersonas = nextAssignments
    .filter((_, idx) => idx !== assignmentIndex)
    .flatMap((item) => Array.isArray(item.personaPool) ? item.personaPool : []);
  const personaPool = seedPool.slice();
  let skipCount = 0;
  while (personaPool.length < targetCount) {
    if (skipCount >= 5) {
      console.warn("[ensureAssignmentPersonaPool] 跨成员去重重试超过 5 次，接受当前 persona");
    }
    const allPrevious = [...personaPool, ...otherMemberPersonas];
    const nextPersona = await generatePersonaVariant(round1Context, allPrevious);
    const nextId = String(nextPersona.id || "").trim();
    const nextName = String(nextPersona.name || "").trim();
    if (nextId && personaPool.some((item) => String(item?.id || "").trim() === nextId)) {
      if (skipCount < 5) {
        console.warn(`[ensureAssignmentPersonaPool] 跳过与本成员重复的 persona: ${nextId}`);
        skipCount += 1;
        continue;
      }
      nextPersona.id = `${nextId}_v${personaPool.length + 1}`;
    }
    if (skipCount < 5 && nextName && otherMemberPersonas.some((item) => String(item?.name || "").trim() === nextName)) {
      console.warn(`[ensureAssignmentPersonaPool] 跳过与其他成员重复的 persona: ${nextName}`);
      skipCount += 1;
      continue;
    }
    personaPool.push(nextPersona);
  }

  nextAssignments[assignmentIndex] = { ...row, personaPool, personaVersion: ROUND2_PERSONA_POOL_VERSION };
  return { assignments: nextAssignments, personaPool };
}

async function buildAssignments(team, memberCount) {
  const members = listTeamMembers(team);
  const raw = assignDimensions(memberCount);
  return members.map((m, idx) => {
    const dims = mapAssignmentDims(raw[idx] || []);
    const peerNames = members.filter((x) => x.id !== m.id).map((x) => x.member_name).slice(0, 2).join("，");
    return {
      memberId: m.id,
      memberName: m.member_name,
      dims,
      personas: peerNames || "访谈对象",
      personaPool: [],
      personaVersion: ROUND2_PERSONA_POOL_VERSION
    };
  });
}

async function saveAssignments(teamId, assignments) {
  await ensureSchema();
  const now = nowIso();
  await runSql(`
    INSERT INTO round2_dimension_assignments (team_id, assignments_json, updated_at)
    VALUES (${sqlQuote(teamId)}, ${sqlQuote(JSON.stringify(assignments || []))}, ${sqlQuote(now)})
    ON CONFLICT(team_id) DO UPDATE SET
      assignments_json = excluded.assignments_json,
      updated_at = excluded.updated_at;
  `);
}

async function getAssignments(teamId) {
  await ensureSchema();
  const rows = await runSql(`
    SELECT assignments_json
    FROM round2_dimension_assignments
    WHERE team_id = ${sqlQuote(teamId)}
    LIMIT 1;
  `);
  if (!rows[0]) return null;
  try {
    return JSON.parse(rows[0].assignments_json || "[]");
  } catch (_) {
    return null;
  }
}

async function ensureAssignments(team) {
  const existing = await getAssignments(team?.id);
  if (Array.isArray(existing) && existing.length) return existing;
  const created = await buildAssignments(team, listTeamMembers(team).length || Number(team?.team_size || 0) || 4);
  await saveAssignments(team.id, created);
  return created;
}

async function ensureMemberPersonaPool(team, memberId, minCount = 1) {
  let assignments = await ensureAssignments(team);
  const assignmentIndex = assignments.findIndex((item) => item.memberId === memberId);
  if (assignmentIndex < 0) {
    throw new Error(`member assignment not found: ${memberId}`);
  }

  const ensured = await ensureAssignmentPersonaPool({
    assignments,
    assignmentIndex,
    team,
    minCount
  });
  assignments = ensured.assignments;
  await saveAssignments(team.id, assignments);
  return {
    assignments,
    personaPool: Array.isArray(ensured.personaPool) ? ensured.personaPool : []
  };
}

async function saveMemberSelections(teamId, memberId, selections) {
  await ensureSchema();
  const now = nowIso();
  await runSql(`
    INSERT INTO round2_member_selections (team_id, member_id, selections_json, updated_at, status, skipped_by, skipped_at)
    VALUES (
      ${sqlQuote(teamId)},
      ${sqlQuote(memberId)},
      ${sqlQuote(JSON.stringify(Array.isArray(selections) ? selections : []))},
      ${sqlQuote(now)},
      'submitted',
      NULL,
      NULL
    )
    ON CONFLICT(team_id, member_id) DO UPDATE SET
      selections_json = excluded.selections_json,
      updated_at = excluded.updated_at,
      status = 'submitted',
      skipped_by = NULL,
      skipped_at = NULL;
  `);
}

async function markMemberSelectionSkippedByLeader(teamId, memberId, leaderMemberId) {
  await ensureSchema();
  const now = nowIso();
  await runSql(`
    INSERT INTO round2_member_selections (team_id, member_id, selections_json, updated_at, status, skipped_by, skipped_at)
    VALUES (
      ${sqlQuote(teamId)},
      ${sqlQuote(memberId)},
      '[]',
      ${sqlQuote(now)},
      'skipped_by_leader',
      ${sqlQuote(leaderMemberId)},
      ${sqlQuote(now)}
    )
    ON CONFLICT(team_id, member_id) DO UPDATE SET
      selections_json = '[]',
      updated_at = EXCLUDED.updated_at,
      status = 'skipped_by_leader',
      skipped_by = EXCLUDED.skipped_by,
      skipped_at = EXCLUDED.skipped_at;
  `);
}

async function markReadingSkippedByLeaderIfPending(teamId, memberId) {
  await ensureSchema();
  const rows = await runSql(`
    UPDATE team_members
    SET reading_status = 'skipped_by_leader',
        current_step = 'selecting_cards',
        last_activity_at = ${sqlQuote(nowIso())}
    WHERE team_id = ${sqlQuote(teamId)}
      AND id = ${sqlQuote(memberId)}
      AND COALESCE(reading_status, 'not_started') <> 'completed'
    RETURNING id;
  `);
  return rows.length > 0;
}

async function markCardsSkippedByLeaderIfPending(teamId, memberId, leaderMemberId) {
  await ensureSchema();
  const rows = await runSql(`
    UPDATE team_members
    SET card_status = 'skipped_by_leader',
        cards_selected = 0,
        current_step = 'waiting_merge',
        last_activity_at = ${sqlQuote(nowIso())}
    WHERE team_id = ${sqlQuote(teamId)}
      AND id = ${sqlQuote(memberId)}
      AND COALESCE(card_status, 'not_started') <> 'submitted'
    RETURNING id;
  `);
  if (!rows.length) return false;
  await markMemberSelectionSkippedByLeader(teamId, memberId, leaderMemberId);
  return true;
}

async function markMemberCardsSubmittedIfOpen(teamId, memberId, selectedCount) {
  await ensureSchema();
  const rows = await runSql(`
    UPDATE team_members
    SET card_status = 'submitted',
        cards_selected = ${Math.max(0, Math.floor(Number(selectedCount || 0)))},
        current_step = 'waiting_merge',
        last_activity_at = ${sqlQuote(nowIso())}
    FROM teams
    WHERE team_members.team_id = ${sqlQuote(teamId)}
      AND team_members.id = ${sqlQuote(memberId)}
      AND teams.id = team_members.team_id
      AND teams.r2_status IN ('R2_INDIVIDUAL_CARDS', 'R2_TEAM_MERGE')
      AND COALESCE(team_members.card_status, 'not_started') <> 'skipped_by_leader'
    RETURNING team_members.id;
  `);
  return rows.length > 0;
}

async function getMemberSelections(teamId) {
  await ensureSchema();
  const rows = await runSql(`
    SELECT team_id, member_id, selections_json, updated_at
    FROM round2_member_selections
    WHERE team_id = ${sqlQuote(teamId)};
  `);
  return rows.map((r) => {
    let selections = [];
    try { selections = JSON.parse(r.selections_json || "[]"); } catch (_) {}
    return {
      team_id: r.team_id,
      member_id: r.member_id,
      selections: Array.isArray(selections) ? selections : [],
      updated_at: r.updated_at
    };
  });
}

async function saveInterviewSession(row) {
  await ensureSchema();
  const createdAt = normalizeTimestamp(row.created_at);
  const updatedAt = normalizeTimestamp(row.updated_at);
  const personaLockedAt = row.persona_locked_at ? normalizeTimestamp(row.persona_locked_at) : null;
  await runSql(`
    INSERT INTO round2_interview_sessions (
      session_id, team_id, member_id, member_dims_json,
      personas_json, history_json, result_json, persona_locked_at,
      round_no, is_complete, created_at, updated_at
    ) VALUES (
      ${sqlQuote(row.session_id)},
      ${sqlQuote(row.team_id)},
      ${sqlQuote(row.member_id)},
      ${sqlQuote(JSON.stringify(row.member_dims || []))},
      ${sqlQuote(JSON.stringify(row.personas || []))},
      ${sqlQuote(JSON.stringify(row.history || []))},
      ${sqlQuote(row.result ? JSON.stringify(row.result) : null)},
      ${sqlQuote(personaLockedAt)},
      ${Number.isFinite(Number(row.round_no)) ? Number(row.round_no) : 1},
      ${row.is_complete ? "TRUE" : "FALSE"},
      ${sqlQuote(createdAt)},
      ${sqlQuote(updatedAt)}
    )
    ON CONFLICT(session_id) DO UPDATE SET
      member_dims_json = excluded.member_dims_json,
      personas_json = excluded.personas_json,
      history_json = excluded.history_json,
      result_json = excluded.result_json,
      persona_locked_at = COALESCE(excluded.persona_locked_at, round2_interview_sessions.persona_locked_at),
      round_no = excluded.round_no,
      is_complete = excluded.is_complete,
      updated_at = excluded.updated_at;
  `);
}

async function getInterviewSession(sessionId) {
  await ensureSchema();
  const rows = await runSql(`
    SELECT *
    FROM round2_interview_sessions
    WHERE session_id = ${sqlQuote(sessionId)}
    LIMIT 1;
  `);
  const row = rows[0];
  if (!row) return null;
  const parse = (t, fallback) => {
    try { return JSON.parse(t); } catch (_) { return fallback; }
  };
  return {
    session_id: row.session_id,
    team_id: row.team_id,
    member_id: row.member_id,
    member_dims: parse(row.member_dims_json, []),
    personas: parse(row.personas_json, []),
    history: parse(row.history_json, []),
    result: row.result_json ? parse(row.result_json, null) : null,
    persona_locked_at: row.persona_locked_at ? normalizeTimestamp(row.persona_locked_at) : null,
    round_no: Number.isFinite(Number(row.round_no)) ? Number(row.round_no) : 1,
    is_complete: row.is_complete === true || row.is_complete === "t",
    created_at: normalizeTimestamp(row.created_at),
    updated_at: normalizeTimestamp(row.updated_at)
  };
}

async function getLatestInterviewSessionForMember(teamId, memberId) {
  await ensureSchema();
  const rows = await runSql(`
    SELECT session_id
    FROM round2_interview_sessions
    WHERE team_id = ${sqlQuote(teamId)}
      AND member_id = ${sqlQuote(memberId)}
    ORDER BY updated_at DESC
    LIMIT 1;
  `);
  if (!rows[0]?.session_id) return null;
  return getInterviewSession(rows[0].session_id);
}

async function listInterviewSessionsForMember(teamId, memberId) {
  await ensureSchema();
  const rows = await runSql(`
    SELECT session_id
    FROM round2_interview_sessions
    WHERE team_id = ${sqlQuote(teamId)}
      AND member_id = ${sqlQuote(memberId)}
    ORDER BY created_at ASC, updated_at ASC;
  `);

  const out = [];
  for (const row of rows) {
    const session = await getInterviewSession(row.session_id);
    if (session) out.push(session);
  }
  return out;
}

async function getLatestInterviewByMember(teamId) {
  await ensureSchema();
  const rows = await runSql(`
    SELECT member_id, result_json, updated_at
    FROM round2_interview_sessions
    WHERE team_id = ${sqlQuote(teamId)} AND is_complete = TRUE
    ORDER BY updated_at DESC;
  `);

  const byMember = {};
  rows.forEach((r) => {
    if (byMember[r.member_id]) return;
    try {
      byMember[r.member_id] = {
        result: JSON.parse(r.result_json || "{}"),
        updated_at: r.updated_at
      };
    } catch (_) {}
  });
  return byMember;
}

function aggregateInterviewByOwner({ assignments, memberMap, interviewByMember }) {
  const ownersByDim = {};
  (assignments || []).forEach((a) => {
    (a.dims || []).forEach((d) => {
      if (!ownersByDim[d]) ownersByDim[d] = [];
      ownersByDim[d].push(a.memberId);
    });
  });

  const mergedDimScores = {};
  const sourceByDim = {};
  const tagSet = new Set();
  const eviList = [];

  DIM_KEYS_SHORT.forEach((dim) => {
    const owners = ownersByDim[dim] || [];
    const highCandidates = [];
    const fallbackCandidates = [];

    owners.forEach((memberId) => {
      const item = interviewByMember[memberId];
      if (!item?.result?.radar) return;
      const dimRadar = radarToDimKeys(item.result.radar);
      const score = Number(dimRadar[dim] || 0);
      if (!Number.isFinite(score) || score <= 0) return;

      const confidence = item.result?.confidence?.[dim] || "low";
      const row = {
        memberId,
        memberName: memberMap[memberId] || memberId,
        score,
        confidence,
        scoreSource: item.result?.scoreSource?.[dim] || "unknown",
        insight: String(item.result?.insightsByDim?.[dim] || "").trim()
      };
      fallbackCandidates.push(row);
      if (confidence === "high") highCandidates.push(row);

      (item.result?.tags || []).forEach((t) => {
        const tag = String(typeof t === "string" ? t : (t?.tag || "")).trim();
        if (tag) tagSet.add(tag);
      });
      if (Number.isFinite(Number(item.result?.evi))) {
        eviList.push(Number(item.result.evi));
      }
    });

    const pool = highCandidates.length > 0 ? highCandidates : fallbackCandidates;
    if (pool.length === 0) {
      mergedDimScores[dim] = 5;
      sourceByDim[dim] = [];
      return;
    }

    const avg = pool.reduce((a, b) => a + b.score, 0) / pool.length;
    mergedDimScores[dim] = Number(avg.toFixed(2));
    sourceByDim[dim] = pool;
  });

  const radar = dimToRadarKeys(mergedDimScores);
  const tags = Array.from(tagSet).slice(0, 10).map((tag) => ({ tag, polarity: 1 }));
  const evi = eviList.length > 0
    ? Number((eviList.reduce((a, b) => a + b, 0) / eviList.length).toFixed(2))
    : 0.7;
  const merged = {
    radar,
    tags,
    evi,
    sourceByDim
  };
  console.log("[Round2][MergeResponseBody]", JSON.stringify(merged));
  return merged;
}

function buildMergedInterviewFromPersonaChoice(choice) {
  if (!choice?.radar) return null;
  return {
    radar: normalizeRadarPayload(choice.radar),
    tags: Array.isArray(choice.tags) ? choice.tags : [],
    evi: Number.isFinite(Number(choice.evi)) ? Number(choice.evi) : null,
    sourceByDim: {},
    selectedArchetypeId: choice.persona_id || choice.archetype_id || "",
    summaryText: choice.summary_text || "",
    flowVersion: choice.flow_version || SUMMARY_FLOW_VERSION
  };
}

function resolveAuthoritativeSubmitEvi({ body, personaChoice, sessionConfig, teamId, sessionId }) {
  const bodyEvi = Number(body?.evi);
  const mergedEvi = Number(body?.mergedInterview?.evi);
  const choiceEvi = Number(personaChoice?.evi);
  const hasBodyEvi = Number.isFinite(bodyEvi);
  const hasMergedEvi = Number.isFinite(mergedEvi);
  const hasChoiceEvi = Number.isFinite(choiceEvi);

  if (isSummaryModeSession(sessionConfig)) {
    if (hasBodyEvi || hasMergedEvi) {
      console.warn("[Round2][EVIOverrideIgnored]", JSON.stringify({
        teamId,
        sessionId,
        interview_mode: sessionConfig?.interview_mode || "summary",
        body_evi: hasBodyEvi ? bodyEvi : null,
        merged_interview_evi: hasMergedEvi ? mergedEvi : null,
        authoritative_evi: hasChoiceEvi ? choiceEvi : null
      }));
    }
    if (!hasChoiceEvi) {
      throw new Error("summary evi missing from frozen persona choice");
    }
    return choiceEvi;
  }

  if (hasBodyEvi) return bodyEvi;
  if (hasMergedEvi) return mergedEvi;
  if (hasChoiceEvi) return choiceEvi;

  console.warn("[Round2][LegacyEviFallback]", JSON.stringify({
    teamId,
    sessionId,
    interview_mode: sessionConfig?.interview_mode || "live",
    fallback_evi: LEGACY_LIVE_EVI_FALLBACK
  }));
  return LEGACY_LIVE_EVI_FALLBACK;
}

function sanitizeStudentMergedInterview(mergedInterview, options = {}) {
  if (!mergedInterview || typeof mergedInterview !== "object") return mergedInterview;
  const next = { ...mergedInterview };
  delete next.radar;
  delete next.sourceByDim;
  delete next.scoreSource;
  delete next.insightsByDim;
  delete next.lowConfidenceDims;
  delete next.confidence;
  delete next.dimensionEvidence;
  delete next.dimension_evidence;
  delete next.other_dimensions;
  delete next.missing_dimensions;
  if (options?.stripEvi) {
    delete next.evi;
  }
  if (options?.stripTags) {
    delete next.tags;
  }
  return next;
}

function enrichPersona(persona) {
  const raw = persona && typeof persona === "object" ? persona : {};
  const title = String(raw.title || raw.occupation || "").trim();
  const orgType = String(raw.org_type || "").trim();
  const orgScale = String(raw.org_scale || "").trim();
  const livingSituation = String(raw.living_situation || [orgType, orgScale].filter(Boolean).join("，")).trim();
  const inferredGridLabel = String(raw?.constraints?.gridLabel || raw.gridLabel || "").trim();
  const desc = String(raw.desc || [title, orgType, raw.personality].filter(Boolean).join("，")).trim();
  return {
    ...raw,
    id: String(raw.id || raw.name || "persona").trim(),
    group: String(raw.group || getPersonaGroup(inferredGridLabel, raw.age)).trim(),
    name: String(raw.name || "访谈对象").trim(),
    age: Number(raw.age || 0),
    title,
    occupation: title,
    org_type: orgType,
    org_scale: orgScale,
    living_situation: livingSituation,
    pressures: Array.isArray(raw.pressures) ? raw.pressures.filter(Boolean).map(String) : [],
    budget: String(raw.budget || "").trim(),
    trigger: String(raw.trigger || "").trim(),
    family: String(raw.family || "").trim(),
    daily_scenes: Array.isArray(raw.daily_scenes) ? raw.daily_scenes.filter(Boolean).map(String) : [],
    spending: String(raw.spending || "").trim(),
    background: String(raw.background || "").trim(),
    personality: String(raw.personality || "").trim(),
    desc
  };
}

function enrichPersonas(personas) {
  return (Array.isArray(personas) ? personas : []).map((item) => enrichPersona(item));
}

function normalizeInterviewHistory(history) {
  const list = Array.isArray(history) ? history.filter((item) => String(item?.text || "").trim()) : [];
  const firstUserIndex = list.findIndex((item) => item.role === "user");
  if (firstUserIndex < 0) return [];
  return list.slice(firstUserIndex);
}

function hasStudentIntroducedProduct(history, latestMessage = "") {
  const userTexts = [
    ...(Array.isArray(history) ? history.filter((item) => item?.role === "user").map((item) => String(item?.text || "")) : []),
    String(latestMessage || "")
  ];
  return userTexts.some((text) => PRODUCT_TERMS_RE.test(text));
}

function buildLifeAnchoredReply(persona) {
  const safePersona = enrichPersona(persona);
  const occupation = safePersona.title || safePersona.occupation || "普通上班族";
  const living = safePersona.living_situation || "平时主要在家和工作两头跑";
  const pressures = Array.isArray(safePersona.pressures) ? safePersona.pressures.filter(Boolean) : [];

  if (safePersona.org_type || safePersona.title) {
    const pressureText = pressures[0] ? `最近最头疼的是${pressures[0]}。` : "最近手上的压力一直在堆。";
    return `${pressureText} 我比较在意真实使用场景、出问题时谁来处理，以及后续会不会增加额外负担。`;
  }

  if (occupation.includes("护工")) {
    return "白天经常要在几个照护对象之间来回跑，最怕临时有状况撞在一起。日常照看里的麻烦和压力确实不少。";
  }
  if (occupation.includes("财务") || living.includes("孩子")) {
    return "工作和家里的事情常常挤在一起，一忙起来就顾不过来。";
  }
  if (occupation.includes("退休") || living.includes("独居")) {
    return "平时生活节奏比较固定，但真碰到一个人不太方便的时候，会特别在意安心和别太折腾。";
  }
  return "日常里我最在意的是别给自己添太多负担，真有事的时候也能稳得住。";
}

function isPersonaLeakage(reply, persona) {
  const text = String(reply || "");
  const markers = [
    persona?.org_type,
    persona?.org_scale,
    persona?.budget,
    "比起先谈产品",
    "我更愿意先把真实场景",
    "决策压力说清楚",
    "所在机构是",
    "我现在负责"
  ].filter((marker) => marker && String(marker).length >= 4);
  return markers.filter((marker) => text.includes(marker)).length >= 2;
}

function enforceLifeFirstReply(reply, persona, productIntroduced) {
  const text = String(reply || "").trim();
  if (!text) return buildLifeAnchoredReply(persona);
  return text;
}

function sanitizeInterviewHistory(history, persona) {
  return normalizeInterviewHistory(history);
}

function toConversationMessages(history) {
  return (Array.isArray(history) ? history : [])
    .map((item) => ({
      role: item.role === "user" ? "user" : "assistant",
      speaker: item.speaker || (item.role === "user" ? "学生" : "访谈对象"),
      text: String(item.text || "").trim()
    }))
    .filter((item) => item.text);
}

function serializeSession(session) {
  const personas = enrichPersonas(session.personas);
  const persona = personas[0] || null;
  const history = sanitizeInterviewHistory(session.history, persona);
  const result = sanitizeStudentInterviewResult(session.result);
  return {
    sessionId: session.session_id,
    teamId: session.team_id,
    memberId: session.member_id,
    memberDims: Array.isArray(session.member_dims) ? session.member_dims : [],
    personaLockedAt: session.persona_locked_at || null,
    persona,
    personas,
    history,
    result,
    round: history.filter((item) => item.role === "user").length,
    isComplete: Boolean(session.is_complete),
    createdAt: session.created_at,
    updatedAt: session.updated_at
  };
}

function summarizeCompletedInterview(session) {
  const serialized = serializeSession(session);
  const persona = serialized.persona || {};
  return {
    session_id: serialized.sessionId,
    persona_id: String(persona.id || persona.name || "persona").trim(),
    persona_name: persona.name || "访谈对象",
    persona,
    messages: serialized.history,
    turn_count: serialized.round,
    assessment: null,
    summary: null,
    result: serialized.result || null
  };
}

function buildMemberInterviewProgress(sessions, personaPool) {
  const sorted = (Array.isArray(sessions) ? sessions : [])
    .slice()
    .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
  const activeSession = sorted.find((item) => !item.is_complete) || null;
  const completedSessions = sorted.filter((item) => item.is_complete);
  const completedInterviews = completedSessions.map((item) => summarizeCompletedInterview(item));
  const usedIds = new Set(
    sorted
      .map((item) => enrichPersonas(item.personas)[0]?.id)
      .filter(Boolean)
  );
  const nextPersona = (Array.isArray(personaPool) ? personaPool : []).find((item) => !usedIds.has(item.id)) || null;

  return {
    completedCount: completedSessions.length,
    totalSessions: sorted.length,
    minInterviewsRequired: MIN_INTERVIEWS_REQUIRED,
    maxInterviews: MAX_INTERVIEWS_PER_MEMBER,
    canProceed: completedSessions.length >= MIN_INTERVIEWS_REQUIRED,
    canStartAnother: completedSessions.length < MAX_INTERVIEWS_PER_MEMBER && Boolean(nextPersona) && !activeSession,
    reachedInterviewLimit: completedSessions.length >= MAX_INTERVIEWS_PER_MEMBER,
    personaPool: Array.isArray(personaPool) ? personaPool : [],
    nextPersona,
    activeSessionId: activeSession?.session_id || "",
    completedInterviews,
    latestCompletedInterview: completedInterviews[completedInterviews.length - 1] || null
  };
}

function buildMemberInterviewProgressLite(sessions) {
  const sorted = (Array.isArray(sessions) ? sessions : [])
    .slice()
    .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
  const activeSession = sorted.find((item) => !item.is_complete) || null;
  const completedSessions = sorted.filter((item) => item.is_complete);
  const completedInterviews = completedSessions.map((item) => summarizeCompletedInterview(item));

  return {
    completedCount: completedSessions.length,
    totalSessions: sorted.length,
    minInterviewsRequired: MIN_INTERVIEWS_REQUIRED,
    maxInterviews: MAX_INTERVIEWS_PER_MEMBER,
    canProceed: completedSessions.length >= MIN_INTERVIEWS_REQUIRED,
    canStartAnother: false,
    reachedInterviewLimit: completedSessions.length >= MAX_INTERVIEWS_PER_MEMBER,
    personaPool: [],
    nextPersona: null,
    activeSessionId: activeSession?.session_id || "",
    completedInterviews,
    latestCompletedInterview: completedInterviews[completedInterviews.length - 1] || null
  };
}

function buildDimensionGuide(memberDims) {
  return (Array.isArray(memberDims) ? memberDims : [])
    .map((dimId) => {
      const guide = DIMENSION_GUIDE[dimId];
      if (!guide) return null;
      return {
        id: dimId,
        label: guide.label,
        hint: guide.hint
      };
    })
    .filter(Boolean);
}

async function syncMemberInterviewState(teamId, memberId) {
  const team = await getTeam(teamId);
  const member = listTeamMembers(team).find((item) => item.id === memberId);
  const sessions = await listInterviewSessionsForMember(teamId, memberId);
  const completedSessions = sessions.filter((item) => item.is_complete);
  const desiredPersonaCount = Math.min(MAX_INTERVIEWS_PER_MEMBER, completedSessions.length + 1);
  const { personaPool } = await ensureMemberPersonaPool(team, member?.id || memberId, desiredPersonaCount);
  const repairedSessions = await repairStaleInterviewSessions(team, member?.id || memberId, sessions, personaPool);
  const activeSession = repairedSessions.find((item) => !item.is_complete) || null;
  const progress = buildMemberInterviewProgress(repairedSessions, personaPool);
  const latestSession = repairedSessions[repairedSessions.length - 1] || null;
  const interviewStatus = progress.completedCount >= MIN_INTERVIEWS_REQUIRED
    ? "completed"
    : (repairedSessions.find((item) => !item.is_complete) || progress.completedCount > 0 ? "in_progress" : "not_started");
  const currentStep = progress.completedCount >= MIN_INTERVIEWS_REQUIRED
    ? "interview_done"
    : (repairedSessions.find((item) => !item.is_complete) || progress.completedCount > 0 ? "interviewing" : "idle");
  const roundCount = activeSession?.round_no || latestSession?.round_no || 0;

  await updateMemberProgress(teamId, memberId, {
    interview_status: interviewStatus,
    interview_rounds: roundCount,
    current_step: currentStep,
    last_activity_at: nowIso()
  });

  await updateTeamRound2StatusFromInterviewCompletion(teamId);

  return {
    progress,
    personaPool
  };
}

function generateAutoHistory(personas, dims) {
  const p1 = personas[0]?.name || "用户A";
  const p2 = personas[1]?.name || "用户B";
  const dimText = (dims || []).map((d) => DIM_LABEL[d] || d).join("、");
  return [
    { role: "assistant", speaker: p1, text: `我们最在意的是 ${dimText}，希望机器人在真实生活里稳定可靠。` },
    { role: "assistant", speaker: p2, text: "如果能更自然地陪伴、并在关键时刻预警，家属会更愿意付费。" },
    { role: "assistant", speaker: "访谈教练", text: "建议你把核心需求分成：高频体验、关键风险、可接受成本。" }
  ];
}

function normalizeSessionId(value) {
  const raw = String(value || "").trim();
  return raw || "default";
}

function safeJsonParse(text, fallback) {
  try {
    return JSON.parse(text);
  } catch (_) {
    return fallback;
  }
}

function normalizeSelectionsPayload(input) {
  if (Array.isArray(input)) {
    return input
      .map((item) => ({
        cap_id: String(item?.cap_id || item?.id || "").trim(),
        tier: String(item?.tier || "mid").trim().toLowerCase()
      }))
      .filter((item) => item.cap_id && TIER_LABELS[item.tier]);
  }

  if (input && typeof input === "object") {
    return Object.entries(input)
      .map(([capId, tier]) => ({
        cap_id: String(capId || "").trim(),
        tier: String(tier || "mid").trim().toLowerCase()
      }))
      .filter((item) => item.cap_id && TIER_LABELS[item.tier]);
  }

  return [];
}

function normalizeRadarPayload(radar) {
  const src = radar && typeof radar === "object" ? radar : {};
  return {
    interaction: Number(src.interaction || 5),
    perception: Number(src.perception || 5),
    motion: Number(src.motion != null ? src.motion : src.mobility != null ? src.mobility : 5),
    safety: Number(src.safety != null ? src.safety : src.safety_privacy != null ? src.safety_privacy : 5),
    extend: Number(src.extend != null ? src.extend : src.integration != null ? src.integration : 5),
    ops: Number(src.ops != null ? src.ops : src.operations != null ? src.operations : 5)
  };
}

function buildCardScoresFromSelections(selections) {
  const totals = {
    interaction: 0,
    perception: 0,
    motion: 0,
    safety: 0,
    extend: 0,
    ops: 0
  };
  normalizeSelectionsPayload(selections).forEach((sel) => {
    const dimShort = CAPABILITY_TO_DIM_SHORT.get(sel.cap_id);
    if (!dimShort) return;
    totals[dimShort] += Number(MATCH_CARD_SCORE_STEP[sel.tier] || 0);
  });
  return Object.fromEntries(
    Object.entries(totals).map(([dimShort, total]) => [
      dimShort,
      Number(clamp(4 + Number(total || 0), 1, 9).toFixed(1))
    ])
  );
}

function toAuthorityMatchScores(cardScores) {
  const src = cardScores && typeof cardScores === "object" ? cardScores : {};
  return {
    interaction: Number(src.interaction || 0),
    perception: Number(src.perception || 0),
    mobility: Number(src.motion || 0),
    safety_privacy: Number(src.safety || 0),
    integration: Number(src.extend || 0),
    operations: Number(src.ops || 0)
  };
}

function computeAuthorityProductMarketMatch(selections, gridPriors = getGridPriors()) {
  const cardScores = buildCardScoresFromSelections(selections);
  const match = computeProductMarketMatch(toAuthorityMatchScores(cardScores), gridPriors);
  return {
    cardScores,
    bestGrid: String(match.bestGrid || "").trim(),
    bestMatch: Number(match.bestMatch || 0),
    allMatches: match.allMatches || {}
  };
}

function buildGridBaselineMetrics(gridId, architecture) {
  const normalizedGridId = /^B2[BC]_/.test(String(gridId || "").trim())
    ? String(gridId || "").trim()
    : toCalcGridId(gridId, architecture);
  if (!normalizedGridId) return null;
  const base = Engine.computeRound1V2(normalizedGridId, normalizeArchitecture(architecture || "Experience"), {
    C: 3,
    G: 3,
    E: 3
  }, 0);
  return {
    grid_id: normalizedGridId,
    grid_label: inferBestGridLabel(normalizedGridId),
    sam: Number(base.SAM_billion || 0),
    wtp_ref: Number(base.WTPref || 0),
    wtp_mean: Number(base.WTPmean || 0)
  };
}

function buildCardSummary(selections) {
  return normalizeSelectionsPayload(selections).map((sel) => {
    const cap = CAPABILITY_MAP.get(sel.cap_id);
    const name = cap?.name || sel.cap_id;
    const tierLabel = TIER_LABELS[sel.tier] || sel.tier;
    return {
      id: sel.cap_id,
      name,
      tier: sel.tier,
      tierLabel,
      label: `${name}·${tierLabel}`
    };
  });
}

function inferBestGridLabel(gridId) {
  const raw = String(gridId || "").trim();
  if (!raw) return "";
  const parts = raw.split("_");
  const channelMap = { B2B: "ToB", TOB: "ToB", B2C: "ToC", TOC: "ToC" };
  const strategyMap = { DIFFERENTIATION: "差异化", DIFF: "差异化", COST: "成本" };
  const focusMap = {
    ELDER: "老人",
    ADULT: "成人",
    CHILD: "儿童",
    EXPERIENCE: "体验",
    HYBRID: "混合",
    MIXED: "混合",
    FUNCTION: "功能"
  };
  const p0 = channelMap[String(parts[0] || "").toUpperCase()] || parts[0] || "";
  const p1 = strategyMap[String(parts[1] || "").toUpperCase()] || parts[1] || "";
  const p2 = focusMap[String(parts[2] || "").toUpperCase()] || parts[2] || "";
  return [p0, p1, p2].filter(Boolean).join("·");
}

function toCalcGridId(gridId, architecture) {
  const rawGrid = String(gridId || "").trim();
  if (!rawGrid) return "";
  if (/^B2[BC]_/.test(rawGrid)) return rawGrid;

  const parts = rawGrid.split("_");
  const channelRaw = String(parts[0] || "").toUpperCase();
  const strategyRaw = String(parts[1] || "").toUpperCase();
  const ageRaw = String(parts[2] || "").toUpperCase();
  const channel = channelRaw === "TOB" ? "B2B" : "B2C";
  const strategy = strategyRaw.includes("COST") ? "Cost" : "Differentiation";
  let age = "Adult";
  if (ageRaw.includes("ELDER")) age = "Elder";
  if (ageRaw.includes("CHILD")) age = "Child";
  return `${channel}_${strategy}_${age}`;
}

async function getStoredSubmission(teamId, sessionId) {
  await ensureSchema();
  const rows = await runSql(`
    SELECT *
    FROM round2_submissions
    WHERE team_id = ${sqlQuote(teamId)} AND session_id = ${sqlQuote(sessionId)}
    LIMIT 1;
  `);
  const row = rows[0];
  if (!row) return null;
  return {
    team_id: row.team_id,
    session_id: row.session_id,
    flow_version: row.flow_version || "",
    price: Number(row.price || 0),
    selections: safeJsonParse(row.selections_json, []),
    cards: safeJsonParse(row.cards_json, []),
    card_count: Number(row.card_count || 0),
    dcogs: row.dcogs == null ? null : Number(row.dcogs),
    risk_total: row.risk_total == null ? null : Number(row.risk_total),
    best_grid: row.best_grid || null,
    submitted_at: row.submitted_at
  };
}

async function getStoredRadar(teamId, sessionId) {
  await ensureSchema();
  const rows = await runSql(`
    SELECT *
    FROM fg_team_radar
    WHERE team_id = ${sqlQuote(teamId)} AND session_id = ${sqlQuote(sessionId)}
    LIMIT 1;
  `);
  const row = rows[0];
  if (!row) return null;
  return {
    team_id: row.team_id,
    session_id: row.session_id,
    radar: normalizeRadarPayload(safeJsonParse(row.radar_json, {})),
    tags: safeJsonParse(row.tags_json, []),
    evi: row.evi == null ? null : Number(row.evi),
    updated_at: row.updated_at
  };
}

async function getStoredResult(teamId, sessionId) {
  await ensureSchema();
  const rows = await runSql(`
    SELECT *
    FROM round2_results
    WHERE team_id = ${sqlQuote(teamId)} AND session_id = ${sqlQuote(sessionId)}
    LIMIT 1;
  `);
  const row = rows[0];
  if (!row) return null;
  const storedResult = safeJsonParse(row.result_json, {});
  const matchedGrid = String(row.matched_grid || storedResult.matched_grid || row.best_grid || storedResult.best_grid || "").trim();
  const marketInfo = getRound2MarketInfo(matchedGrid || row.best_grid || storedResult.best_grid || "");
  const marketSizeYi = Number.isFinite(Number(storedResult.market_size_yi))
    ? Number(storedResult.market_size_yi)
    : marketInfo.market_size_yi;
  const hhi = Number.isFinite(Number(storedResult.hhi))
    ? Number(storedResult.hhi)
    : marketInfo.hhi;
  const hhiLabel = String(storedResult.hhi_label || marketInfo.hhi_label || "");
  return {
    team_id: row.team_id,
    session_id: row.session_id,
    flow_version: row.flow_version || "",
    units: row.units == null ? null : Number(row.units),
    profit: row.profit == null ? null : Number(row.profit),
    profit_per_unit: row.profit_per_unit == null ? null : Number(row.profit_per_unit),
    vscore: row.vscore == null ? null : Number(row.vscore),
    best_grid: matchedGrid || row.best_grid || null,
    matched_grid: matchedGrid || null,
    match_score_json: safeJsonParse(row.match_score_json, storedResult.match_score_json || {}),
    market_size_yi: marketSizeYi,
    hhi,
    hhi_label: hhiLabel,
    result: {
      ...storedResult,
      matched_grid: matchedGrid || null,
      market_size_yi: marketSizeYi,
      hhi,
      hhi_label: hhiLabel
    },
    computed_at: row.computed_at
  };
}

async function persistTeamSnapshot(teamId, sessionId, submission, radar, result) {
  const now = nowIso();
  await runSql(`
    INSERT INTO round2_submissions (
      team_id, session_id, flow_version, price, selections_json, cards_json, card_count,
      dcogs, risk_total, best_grid, submitted_at
    ) VALUES (
      ${sqlQuote(teamId)},
      ${sqlQuote(sessionId)},
      ${sqlQuote(String(submission.flow_version || "").trim() || null)},
      ${Number(submission.price || 0)},
      ${sqlQuote(JSON.stringify(submission.selections || []))},
      ${sqlQuote(JSON.stringify(submission.cards || []))},
      ${Number(submission.card_count || 0)},
      ${submission.dcogs == null ? "NULL" : Number(submission.dcogs)},
      ${submission.risk_total == null ? "NULL" : Number(submission.risk_total)},
      ${sqlQuote(submission.best_grid || null)},
      ${sqlQuote(submission.submitted_at || now)}
    )
    ON CONFLICT(team_id, session_id) DO UPDATE SET
      flow_version = EXCLUDED.flow_version,
      price = EXCLUDED.price,
      selections_json = EXCLUDED.selections_json,
      cards_json = EXCLUDED.cards_json,
      card_count = EXCLUDED.card_count,
      dcogs = EXCLUDED.dcogs,
      risk_total = EXCLUDED.risk_total,
      best_grid = EXCLUDED.best_grid,
      submitted_at = EXCLUDED.submitted_at;

    INSERT INTO round2_results (
      team_id, session_id, flow_version, units, profit, profit_per_unit,
      vscore, best_grid, matched_grid, match_score_json, result_json, computed_at
    ) VALUES (
      ${sqlQuote(teamId)},
      ${sqlQuote(sessionId)},
      ${sqlQuote(String(result.flow_version || "").trim() || null)},
      ${result.units == null ? "NULL" : Number(result.units)},
      ${result.profit == null ? "NULL" : Number(result.profit)},
      ${result.profit_per_unit == null ? "NULL" : Number(result.profit_per_unit)},
      ${result.vscore == null ? "NULL" : Number(result.vscore)},
      ${sqlQuote(result.best_grid || null)},
      ${sqlQuote(result.matched_grid || null)},
      ${sqlQuote(JSON.stringify(result.match_score_json || {}))},
      ${sqlQuote(JSON.stringify(result.result || {}))},
      ${sqlQuote(result.computed_at || now)}
    )
    ON CONFLICT(team_id, session_id) DO UPDATE SET
      flow_version = EXCLUDED.flow_version,
      units = EXCLUDED.units,
      profit = EXCLUDED.profit,
      profit_per_unit = EXCLUDED.profit_per_unit,
      vscore = EXCLUDED.vscore,
      best_grid = EXCLUDED.best_grid,
      matched_grid = EXCLUDED.matched_grid,
      match_score_json = EXCLUDED.match_score_json,
      result_json = EXCLUDED.result_json,
      computed_at = EXCLUDED.computed_at;
  `);
  await upsertTeamRadar(teamId, sessionId, {
    radar: radar.radar || {},
    tags: radar.tags || [],
    evi: radar.evi,
    updated_at: radar.updated_at || now
  });
}

async function buildComputedTeamSnapshot(teamId, sessionId, submissionInput, radarInput, options = {}) {
  const submission = submissionInput || await getStoredSubmission(teamId, sessionId);
  if (!submission) return null;

  const radar = radarInput || await getStoredRadar(teamId, sessionId) || {
    radar: normalizeRadarPayload({}),
    tags: [],
    evi: 0.7,
    updated_at: nowIso()
  };

  const recapRes = await recap({ teamId });
  if (!recapRes?.body?.ok) {
    throw new Error(recapRes?.body?.error || "round2 recap unavailable");
  }
  const recapData = recapRes.body;
  const team = await getTeam(teamId);
  const calcGridId = toCalcGridId(recapData.final_grid_id, team?.final_architecture || "");
  console.log("[R2 calc] 传给利润计算的 WTP 相关参数:", {
    recap_WTP: Number(recapData.WTP || 0),
    team_final_wtp_adj_raw: Number(team?.final_wtp_adj || 0),
    team_final_wtp_adj_scaled: scaleRound1MoneyValue(team?.final_wtp_adj),
    team_final_wtp_ref_raw: Number(team?.final_wtp_ref || 0),
    team_final_wtp_ref_scaled: scaleRound1MoneyValue(team?.final_wtp_ref),
    team_final_wtp_multiplier: Number(team?.final_wtp_multiplier || 1)
  });
  const calcResult = await calculate({
    gridId: calcGridId,
    round1GridId: String(team?.final_grid_id || "").trim(),
    round1Context: team?.final_grid_id
      ? {
          gridId: String(team.final_grid_id || "").trim()
        }
      : undefined,
    selections: submission.selections,
    radar: radar.radar,
    tags: Array.isArray(radar.tags) ? radar.tags : [],
    evi: Number.isFinite(Number(radar.evi)) ? Number(radar.evi) : 0.7,
    P: Number(submission.price || 0),
    Pmax: Number(recapData.Pmax || 0),
    WTP: Number(recapData.WTP || 0),
    e: Number(recapData.e || 1.2),
    COGSbase: Number(recapData.COGSbase || GLOBAL_PARAMS.V || 600),
    TAM: Number(recapData.TAM || 50000),
    H: Number(recapData.H || 0.3),
    wtp_multiplier: Number(team?.final_wtp_multiplier || 1),
    WTPref_override: scaleRound1MoneyValue(team?.final_wtp_ref) || undefined,
    teamId,
    sessionId,
    source: "web"
  });
  const productMarketMatch = computeAuthorityProductMarketMatch(submission.selections, getGridPriors());
  const clientBestGrid = String(submission.best_grid || "").trim();
  const matchedGrid = String(productMarketMatch.bestGrid || recapData.final_grid_id || "").trim();
  if (clientBestGrid && matchedGrid && clientBestGrid !== matchedGrid) {
    console.warn("[Round2] client best_grid ignored; server authority match wins", JSON.stringify({
      teamId,
      sessionId,
      client_best_grid: clientBestGrid,
      matched_grid: matchedGrid
    }));
  }

  const profitPerUnit = Number(calcResult.units || 0) > 0
    ? Math.round(Number(calcResult.profit || 0) / Number(calcResult.units || 1))
    : 0;
  const marketInfo = getRound2MarketInfo(matchedGrid || recapData.final_grid_id || calcGridId);
  const resultPayload = {
    ...calcResult,
    matched_grid: matchedGrid || null,
    match_score_json: productMarketMatch.allMatches,
    card_scores: productMarketMatch.cardScores,
    market_size_yi: marketInfo.market_size_yi,
    hhi: marketInfo.hhi,
    hhi_label: marketInfo.hhi_label
  };
  const result = {
    team_id: teamId,
    session_id: sessionId,
    flow_version: submission.flow_version || "",
    units: Number(calcResult.units || 0),
    profit: Number(calcResult.profit || 0),
    profit_per_unit: profitPerUnit,
    vscore: Number(calcResult.V || 0),
    best_grid: matchedGrid || null,
    matched_grid: matchedGrid || null,
    best_grid_label: inferBestGridLabel(matchedGrid),
    match_score_json: productMarketMatch.allMatches,
    market_size_yi: marketInfo.market_size_yi,
    hhi: marketInfo.hhi,
    hhi_label: marketInfo.hhi_label,
    result: resultPayload,
    computed_at: nowIso()
  };

  const nextSubmission = {
    ...submission,
    flow_version: submission.flow_version || result.flow_version || "",
    dcogs: Number(calcResult.dCOGS || 0),
    risk_total: Number(calcResult.risk || 0),
    card_count: Array.isArray(submission.selections) ? submission.selections.length : Number(submission.card_count || 0),
    best_grid: matchedGrid || null,
    cards: Array.isArray(submission.cards) && submission.cards.length ? submission.cards : buildCardSummary(submission.selections),
    submitted_at: submission.submitted_at || nowIso()
  };
  const nextRadar = {
    radar: normalizeRadarPayload(radar.radar),
    tags: Array.isArray(radar.tags) ? radar.tags : [],
    evi: Number.isFinite(Number(radar.evi)) ? Number(radar.evi) : 0.7,
    updated_at: radar.updated_at || nowIso()
  };

  if (options.persist !== false) {
    await persistTeamSnapshot(teamId, sessionId, nextSubmission, nextRadar, result);
  }
  return {
    submission: nextSubmission,
    radar: nextRadar,
    result
  };
}

async function computeStoredTeamResult(teamId, sessionId, submissionInput, radarInput) {
  return buildComputedTeamSnapshot(teamId, sessionId, submissionInput, radarInput, { persist: true });
}

async function computeCounterfactualAtPrice(teamId, sessionIdInput, priceInput) {
  const sessionId = normalizeSessionId(sessionIdInput);
  const price = Number(priceInput);
  if (!Number.isFinite(price) || price <= 0) {
    return null;
  }

  const submission = await getStoredSubmission(teamId, sessionId);
  if (!submission) return null;
  const radar = await getStoredRadar(teamId, sessionId);

  return buildComputedTeamSnapshot(
    teamId,
    sessionId,
    {
      ...submission,
      price
    },
    radar,
    { persist: false }
  );
}

async function computeProfitAtPrice(teamId, sessionIdInput, priceInput) {
  const price = Number(priceInput);
  if (!Number.isFinite(price) || price <= 0) {
    return null;
  }

  const snapshot = await computeCounterfactualAtPrice(teamId, sessionIdInput, price);
  if (!snapshot) return null;

  const summary = snapshot?.result || {};
  const detail = summary?.result || {};
  const units = Number.isFinite(Number(summary.units))
    ? Number(summary.units)
    : (Number.isFinite(Number(detail.units)) ? Number(detail.units) : null);
  const profit = Number.isFinite(Number(summary.profit))
    ? Number(summary.profit)
    : (Number.isFinite(Number(detail.profit)) ? Number(detail.profit) : null);
  const unitMargin = Number.isFinite(Number(detail.unitMargin))
    ? Number(detail.unitMargin)
    : (Number.isFinite(Number(detail.unitProfitHW)) ? Number(detail.unitProfitHW) : null);

  return {
    price,
    units,
    profit,
    unitMargin,
    snapshot
  };
}

async function getTeamResultSnapshot(teamId, sessionIdInput) {
  const sessionId = normalizeSessionId(sessionIdInput);
  const submission = await getStoredSubmission(teamId, sessionId);
  const radar = await getStoredRadar(teamId, sessionId);
  let result = await getStoredResult(teamId, sessionId);

  if (!submission) {
    return { submission: null, radar, result: null };
  }

  if (!result) {
    return computeStoredTeamResult(teamId, sessionId, submission, radar);
  }

  return { submission, radar, result };
}

async function recap(query) {
  try {
    const teamId = String(query?.teamId || "").trim();
    if (!teamId) return makeResponse(400, { ok: false, error: "teamId required" });

    const p4 = await TeamRoutes.phase4Data(teamId, { includeRawMatchStrength: true });
    if (!p4?.body?.ok) {
      return makeResponse(p4?.status || 400, p4?.body || { ok: false, error: "phase4 unavailable" });
    }

    const data = await buildRound2Recap(teamId, p4.body);
    const revealR1Results = data?.r1_results_revealed === true;
    const responseBody = { ok: true, ...data };
    return makeResponse(200, revealR1Results ? responseBody : TeamRoutes.hideDeferredRound1Fields(responseBody));
  } catch (e) {
    return makeResponse(400, { ok: false, error: e.message });
  }
}

async function syncSummaryModeChoice(teamId, sessionId = "default", selectedBy = "") {
  const teamState = await getTeamRound2State(teamId);
  for (const member of teamState?.members || []) {
    await updateMemberProgress(teamId, member.id, {
      interview_status: "completed",
      interview_rounds: Math.max(1, Number(member.interviewRounds || 0)),
      current_step: member.cardStatus === "submitted" ? "waiting_merge" : "selecting_cards",
      last_activity_at: nowIso()
    });
  }
  await updateTeamRound2StatusFromInterviewCompletion(teamId);
  const choice = await readPersonaChoice(teamId, sessionId);
  return {
    ok: true,
    team_id: teamId,
    selected_by: selectedBy,
    choice
  };
}

async function personaReportsApi(query) {
  try {
    const teamId = String(query?.teamId || query?.team_id || "").trim();
    const sessionId = normalizeSessionId(query?.sessionId || query?.session_id);
    if (!teamId) return makeResponse(400, { ok: false, error: "teamId required" });
    const team = await getTeam(teamId);
    if (!team) return makeResponse(404, { ok: false, error: "team not found" });
    const calcGridId = toCalcGridId(team?.final_grid_id || "", team?.final_architecture || "");
    const reports = await listStudentPersonaReportsForTeam(team, sessionId);
    const choice = await readPersonaChoice(teamId, sessionId);
    return makeResponse(200, {
      ok: true,
      team_id: teamId,
      session_id: sessionId,
      flow_version: SUMMARY_FLOW_VERSION,
      default_report_index: getInitialPersonaReportIndex(calcGridId),
      available_reports: buildStudentPersonaCatalog(calcGridId),
      selected_archetype_id: choice?.persona_id || choice?.archetype_id || "",
      reports
    });
  } catch (e) {
    return makeResponse(400, { ok: false, error: e.message });
  }
}

async function personaReportByIndexApi(params, query) {
  try {
    const teamId = String(query?.teamId || query?.team_id || "").trim();
    const memberId = String(query?.memberId || query?.member_id || "").trim();
    const sessionId = normalizeSessionId(query?.sessionId || query?.session_id);
    const reportIndex = Number(params?.reportIndex);
    if (!teamId || !memberId) {
      return makeResponse(400, { ok: false, error: "teamId/memberId required" });
    }

    const team = await getTeam(teamId);
    if (!team) return makeResponse(404, { ok: false, error: "team not found" });
    const finalized = await ensureRound1Finalized(team);
    if (!finalized.ok) return finalized.response;

    const calcGridId = toCalcGridId(team?.final_grid_id || "", team?.final_architecture || "");
    const report = getStaticPersonaReportByIndex(calcGridId, reportIndex);
    if (!report) {
      return makeResponse(404, { ok: false, error: "persona report not found" });
    }

    await recordPersonaView(sessionId, teamId, memberId, report.persona_id);
    return makeResponse(200, {
      ok: true,
      team_id: teamId,
      session_id: sessionId,
      report: sanitizeStudentPersonaReport({
        ...report,
        flow_version: SUMMARY_FLOW_VERSION,
        generated_at: null
      })
    });
  } catch (e) {
    return makeResponse(400, { ok: false, error: e.message });
  }
}

async function teamReadingStatusApi(query) {
  try {
    const teamId = String(query?.teamId || query?.team_id || "").trim();
    const memberId = String(query?.memberId || query?.member_id || "").trim();
    const sessionId = normalizeSessionId(query?.sessionId || query?.session_id);
    if (!teamId || !memberId) {
      return makeResponse(400, { ok: false, error: "teamId/memberId required" });
    }

    const team = await getTeam(teamId);
    if (!team) return makeResponse(404, { ok: false, error: "team not found" });

    const calcGridId = toCalcGridId(team?.final_grid_id || "", team?.final_architecture || "");
    const allViewed = await getTeamViewedPersonas(teamId, sessionId);
    const myViewed = await getMemberViewedPersonas(teamId, memberId, sessionId);
    const members = await getMemberReadingDetails(teamId, sessionId);
    return makeResponse(200, {
      ok: true,
      team_id: teamId,
      session_id: sessionId,
      ...buildStudentReadingStatusPayload({
        allViewed,
        myViewed,
        members,
        memberId,
        totalReports: getStaticPersonaReportsForGrid(calcGridId).length
      })
    });
  } catch (e) {
    return makeResponse(400, { ok: false, error: e.message });
  }
}

async function completeSummaryReadingApi(body) {
  try {
    const teamId = String(body?.teamId || body?.team_id || "").trim();
    const memberId = String(body?.memberId || body?.member_id || "").trim();
    const sessionId = normalizeSessionId(body?.sessionId || body?.session_id);
    if (!teamId || !memberId) {
      return makeResponse(400, { ok: false, error: "teamId/memberId required" });
    }

    const team = await getTeam(teamId);
    if (!team) return makeResponse(404, { ok: false, error: "team not found" });
    const finalized = await ensureRound1Finalized(team);
    if (!finalized.ok) return finalized.response;
    const teamState = await getTeamRound2State(teamId);
    const memberState = (teamState?.members || []).find((member) => member.id === memberId) || null;
    if (memberState?.readingStatus === "skipped_by_leader") {
      return makeResponse(409, {
        ok: false,
        error: "reading_skipped_by_leader",
        message: "组长已跳过该成员的阅读完成，本轮不能补交。"
      });
    }
    const myViewed = await getMemberViewedPersonas(teamId, memberId, sessionId);
    if (!myViewed.length) {
      return makeResponse(400, { ok: false, error: "read at least one report before completing" });
    }

    await updateMemberProgress(teamId, memberId, {
      reading_status: "completed",
      interview_status: "completed",
      interview_rounds: 1,
      current_step: "interview_done",
      last_activity_at: nowIso()
    });
    await updateTeamRound2StatusFromInterviewCompletion(teamId);

    const calcGridId = toCalcGridId(team?.final_grid_id || "", team?.final_architecture || "");
    const allViewed = await getTeamViewedPersonas(teamId, sessionId);
    const members = await getMemberReadingDetails(teamId, sessionId);
    return makeResponse(200, {
      ok: true,
      team_id: teamId,
      session_id: sessionId,
      ...buildStudentReadingStatusPayload({
        allViewed,
        myViewed,
        members,
        memberId,
        totalReports: getStaticPersonaReportsForGrid(calcGridId).length
      })
    });
  } catch (e) {
    return makeResponse(400, { ok: false, error: e.message });
  }
}

async function selectPersonaArchetypeApi(body) {
  try {
    const teamId = String(body?.teamId || body?.team_id || "").trim();
    const memberId = String(body?.memberId || body?.member_id || "").trim();
    const sessionId = normalizeSessionId(body?.sessionId || body?.session_id);
    if (!teamId || !memberId) {
      return makeResponse(400, { ok: false, error: "teamId/memberId required" });
    }

    const team = await getTeam(teamId);
    if (!team) return makeResponse(404, { ok: false, error: "team not found" });
    const finalized = await ensureRound1Finalized(team);
    if (!finalized.ok) return finalized.response;

    const nextChoice = await freezeStaticSummaryChoiceForTeam(team, sessionId, memberId);
    if (!nextChoice) {
      return makeResponse(404, { ok: false, error: "static persona report not ready" });
    }
    await syncSummaryModeChoice(teamId, sessionId, memberId);

    return makeResponse(200, {
      ok: true,
      locked: true,
      team_id: teamId,
      session_id: sessionId,
      selected_archetype_id: nextChoice.persona_id || nextChoice.archetype_id || "",
      choice: sanitizeStudentPersonaChoice(nextChoice)
    });
  } catch (e) {
    return makeResponse(400, { ok: false, error: e.message });
  }
}

async function assignDimensionsApi(body) {
  try {
    const teamId = String(body?.teamId || "").trim();
    if (!teamId) return makeResponse(400, { ok: false, error: "teamId required" });
    const team = await getTeam(teamId);
    if (!team) return makeResponse(404, { ok: false, error: "team not found" });
    const finalized = await ensureRound1Finalized(team);
    if (!finalized.ok) return finalized.response;

    const memberCount = Number(body?.memberCount || listTeamMembers(team).length || 4);
    const assignments = await buildAssignments(team, memberCount);
    await saveAssignments(teamId, assignments);
    const sessionId = normalizeSessionId(body?.sessionId || body?.session_id);
    const calcGridId = toCalcGridId(team?.final_grid_id || "", team?.final_architecture || "");

    return makeResponse(200, {
      ok: true,
      assignments,
      default_report_index: getInitialPersonaReportIndex(calcGridId),
      available_reports: buildStudentPersonaCatalog(calcGridId),
      persona_choice: sanitizeStudentPersonaChoice(await readPersonaChoice(teamId, sessionId)),
      persona_reports: await listStudentPersonaReportsForTeam(team, sessionId)
    });
  } catch (e) {
    return makeResponse(400, { ok: false, error: e.message });
  }
}

async function interviewAuto(body) {
  try {
    const teamId = String(body?.teamId || "").trim();
    const memberId = String(body?.memberId || "").trim();
    if (!teamId || !memberId) return makeResponse(400, { ok: false, error: "teamId/memberId required" });

    const team = await getTeam(teamId);
    if (!team) return makeResponse(404, { ok: false, error: "team not found" });
    const finalized = await ensureRound1Finalized(team);
    if (!finalized.ok) return finalized.response;
    const member = listTeamMembers(team).find((m) => m.id === memberId);
    const assignments = await ensureAssignments(team);
    const row = assignments.find((x) => x.memberId === memberId);
    const memberDims = Array.isArray(body?.memberDims) && body.memberDims.length ? body.memberDims : (row?.dims || ["interaction", "safety"]);
    const { personaPool } = await ensureMemberPersonaPool(team, member?.id || memberId, 1);
    const personas = [personaPool[0] || null].filter(Boolean);
    const history = generateAutoHistory(personas, memberDims);
    const recapRes = await recap({ teamId });
    const gridId = recapRes?.body?.final_grid_id || "ToB_Differentiation_Adult";
    const result = await extractInterviewResult({
      gridId,
      architecture: String(recapRes?.body?.architecture || ""),
      memberDims,
      history
    });

    const sessionId = `auto_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    await saveInterviewSession({
      session_id: sessionId,
      team_id: teamId,
      member_id: memberId,
      member_dims: memberDims,
      personas,
      history,
      result,
      persona_locked_at: nowIso(),
      round_no: 3,
      is_complete: true,
      created_at: nowIso(),
      updated_at: nowIso()
    });

    const syncResult = await syncMemberInterviewState(teamId, memberId);
    const studentResult = sanitizeStudentInterviewResult(result);

    return makeResponse(200, {
      ok: true,
      sessionId,
      personas,
      transcript: history,
      round: 3,
      isComplete: true,
      canEnd: true,
      reachedLimit: false,
      radar: studentResult?.radar,
      tags: studentResult?.tags,
      evi: studentResult?.evi,
      summary: studentResult?.summary,
      progress: syncResult.progress
    });
  } catch (e) {
    return makeResponse(400, { ok: false, error: e.message });
  }
}

async function interviewStart(body) {
  try {
    const teamId = String(body?.teamId || "").trim();
    const memberId = String(body?.memberId || "").trim();
    if (!teamId || !memberId) return makeResponse(400, { ok: false, error: "teamId/memberId required" });

    const team = await getTeam(teamId);
    if (!team) return makeResponse(404, { ok: false, error: "team not found" });
    const finalized = await ensureRound1Finalized(team);
    if (!finalized.ok) return finalized.response;

    const member = listTeamMembers(team).find((m) => m.id === memberId);
    const assignments = await ensureAssignments(team);
    const row = assignments.find((x) => x.memberId === memberId);
    const memberDims = Array.isArray(body?.memberDims) && body.memberDims.length
      ? body.memberDims
      : (row?.dims || ["interaction", "safety"]);
    const forceNew = body?.forceNew === true;
    let sessions = await listInterviewSessionsForMember(teamId, memberId);
    const activeSession = sessions.find((item) => !item.is_complete) || null;

    if (activeSession && !forceNew) {
      const progress = buildMemberInterviewProgressLite(sessions);
      return makeResponse(200, {
        ok: true,
        ...serializeSession(activeSession),
        maxRounds: MAX_INTERVIEW_TURNS,
        minTurnsToEnd: MIN_TURNS_TO_END,
        progress,
        dimensionGuide: buildDimensionGuide(memberDims)
      });
    }

    const completedSessions = sessions.filter((item) => item.is_complete);
    if (completedSessions.length >= MAX_INTERVIEWS_PER_MEMBER) {
      const progress = buildMemberInterviewProgressLite(sessions);
      return makeResponse(200, {
        ok: true,
        sessionId: "",
        persona: null,
        personas: [],
        round: 0,
        maxRounds: MAX_INTERVIEW_TURNS,
        minTurnsToEnd: MIN_TURNS_TO_END,
        progress,
        dimensionGuide: buildDimensionGuide(memberDims)
      });
    }

    const { personaPool } = await ensureMemberPersonaPool(
      team,
      member?.id || memberId,
      Math.min(MAX_INTERVIEWS_PER_MEMBER, completedSessions.length + 1)
    );
    sessions = await repairStaleInterviewSessions(team, member?.id || memberId, sessions, personaPool);
    const progress = buildMemberInterviewProgress(sessions, personaPool);

    // 清理 ghost sessions（0 轮次且未完成的旧 session）。
    // 有唯一约束后正常不会命中，但保留对历史脏数据的防御性清理。
    const ghostSessions = sessions.filter((s) =>
      !s.is_complete &&
      (Number(s.round_no) === 0 || !Array.isArray(s.history) || s.history.length === 0)
    );
    for (const ghost of ghostSessions) {
      await runSql(`DELETE FROM round2_interview_sessions WHERE session_id = ${sqlQuote(ghost.session_id)};`);
    }

    const nextPersona = progress.nextPersona || personaPool[progress.completedCount] || personaPool[0];
    const personas = [nextPersona].filter(Boolean);

    const sessionId = `r2_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    const history = [];
    try {
      await saveInterviewSession({
        session_id: sessionId,
        team_id: teamId,
        member_id: memberId,
        member_dims: memberDims,
        personas,
        history,
        result: null,
        persona_locked_at: nowIso(),
        round_no: 0,
        is_complete: false,
        created_at: nowIso(),
        updated_at: nowIso()
      });
    } catch (e) {
      if (e.code === "23505") {
        const existingSessions = await listInterviewSessionsForMember(teamId, memberId);
        const existing = existingSessions.find((item) => !item.is_complete);
        if (existing) {
          return makeResponse(200, {
            ok: true,
            ...serializeSession(existing),
            maxRounds: MAX_INTERVIEW_TURNS,
            minTurnsToEnd: MIN_TURNS_TO_END,
            progress: buildMemberInterviewProgressLite(existingSessions),
            dimensionGuide: buildDimensionGuide(memberDims)
          });
        }
      }
      throw e;
    }

    const syncResult = await syncMemberInterviewState(teamId, memberId);

    return makeResponse(200, {
      ok: true,
      sessionId,
      persona: personas[0] || null,
      personas,
      round: 0,
      maxRounds: MAX_INTERVIEW_TURNS,
      minTurnsToEnd: MIN_TURNS_TO_END,
      progress: syncResult.progress,
      dimensionGuide: buildDimensionGuide(memberDims)
    });
  } catch (e) {
    return makeResponse(400, { ok: false, error: e.message });
  }
}

async function interviewReply(body) {
  try {
    const sessionId = String(body?.sessionId || "").trim();
    const message = String(body?.message || "").trim();
    if (!sessionId || !message) return makeResponse(400, { ok: false, error: "sessionId/message required" });

    const session = await getInterviewSession(sessionId);
    if (!session) return makeResponse(404, { ok: false, error: "session not found" });
    const finalized = await ensureRound1Finalized(session.team_id);
    if (!finalized.ok) return finalized.response;

    if (session.is_complete) {
      const studentResult = sanitizeStudentInterviewResult(session.result);
      return makeResponse(200, {
        ok: true,
        reply: "访谈已完成，可以进入选卡。",
        round: session.round_no,
        isComplete: true,
        radar: studentResult?.radar,
        tags: studentResult?.tags,
        evi: studentResult?.evi,
        summary: studentResult?.summary
      });
    }

    const personas = enrichPersonas(session.personas);
    const persona = personas[0] || null;
    const historyBase = sanitizeInterviewHistory(session.history, persona);
    const round = historyBase.filter((item) => item.role === "user").length + 1;
    const speaker = persona?.name || "访谈对象";
    const recapRes = await recap({ teamId: session.team_id });
    const recapData = recapRes?.body?.ok ? recapRes.body : {};
    const gridDesc = String(recapData.final_grid_id || "ToB_Differentiation_Elder");
    const vpSummary = String(recapData.vp_summary || "围绕陪伴体验与关键安全做取舍");
    const systemPrompt = buildInterviewSystemPrompt({
      persona,
      gridDesc,
      vpSummary,
      memberDims: session.member_dims
    });
    const productIntroduced = hasStudentIntroducedProduct(historyBase, message);

    const llmMessages = [{
      role: "system",
      content: productIntroduced
        ? systemPrompt
        : `${systemPrompt}\n\n【当前轮额外约束】学生还没有介绍具体产品。你这轮只能聊自己的生活、困扰、期待和真实场景，不能提 AI 宠物机器人、机器人、产品、功能，也不能反问学生。`
    }];
    if (round >= 8) {
      llmMessages[0].content += "\n\n【注意】这是访谈的最后几轮，你可以适当透露更多信息，帮助访谈收尾。";
    }
    historyBase.forEach((m) => {
      llmMessages.push({
        role: m.role === "user" ? "user" : "assistant",
        content: String(m.text || "")
      });
    });
    llmMessages.push({ role: "user", content: message });

    let reply;
    try {
      const out = await withLlmLogging({
        caller: "round2Routes.interviewReply",
        teamId: session?.team_id || session?.teamId || null,
        memberId: session?.member_id || session?.memberId || null,
        messages: llmMessages
      }, () => chatCompletion(llmMessages, { temperature: 0.7, max_tokens: 600, timeoutMs: ROUND2_LLM_TIMEOUT_MS }));
      reply = String(out || "").trim();
      if (!reply) {
        throw new Error("llm returned empty reply");
      }
    } catch (err) {
      console.error("[interviewReply] LLM call failed:", err.message, {
        sessionId: session?.session_id || session?.id,
        teamId: session?.team_id,
        memberId: session?.member_id,
        round
      });
      return makeResponse(503, {
        ok: false,
        error: "llm_unavailable",
        retry: true,
        message: "网络繁忙，请稍后重试"
      });
    }
    for (let retry = 0; retry < 2 && isPersonaLeakage(reply, persona); retry += 1) {
      console.warn(`[round2Routes.interviewReply] persona leakage detected, retry ${retry + 1}`);
      const retryMessages = [
        ...llmMessages,
        { role: "assistant", content: reply },
        { role: "user", content: "请用自然对话回答，不要介绍自己的背景信息。" }
      ];
      try {
        const out = await withLlmLogging({
          caller: "round2Routes.interviewReply",
          teamId: session?.team_id || session?.teamId || null,
          memberId: session?.member_id || session?.memberId || null,
          messages: retryMessages
        }, () => chatCompletion(retryMessages, { temperature: 0.9, max_tokens: 600, timeoutMs: ROUND2_LLM_TIMEOUT_MS }));
        if (String(out || "").trim()) reply = String(out).trim();
      } catch (_) {}
    }
    if (isPersonaLeakage(reply, persona)) {
      reply = "（想了想）这个问题……你能说得更具体一点吗？";
    }
    reply = enforceLifeFirstReply(reply, persona, productIntroduced);

    const history = [
      ...historyBase,
      { role: "user", speaker: "学生", text: message },
      { role: "assistant", speaker, text: reply }
    ];
    const reachedLimit = round >= MAX_INTERVIEW_TURNS;
    let result = null;
    let scoringError = null;
    let isComplete = false;

    if (reachedLimit) {
      try {
        result = await extractInterviewResult({
          gridId: String(recapData.final_grid_id || "ToB_Differentiation_Adult"),
          architecture: String(recapData.architecture || ""),
          memberDims: session.member_dims,
          history
        });
        isComplete = true;
      } catch (err) {
        if (err instanceof InterviewScoringError) {
          scoringError = err.reason;
          isComplete = false;
        } else {
          throw err;
        }
      }
    }

    await saveInterviewSession({
      ...session,
      history,
      round_no: round,
      is_complete: isComplete,
      result,
      updated_at: nowIso()
    });

    const syncResult = await syncMemberInterviewState(session.team_id, session.member_id);

    const studentResult = sanitizeStudentInterviewResult(result);
    return makeResponse(scoringError ? 503 : 200, {
      ok: !scoringError,
      reply,
      speaker,
      round,
      isComplete,
      canEnd: round >= MIN_TURNS_TO_END,
      reachedLimit,
      needsRescore: reachedLimit && !isComplete,
      scoringError: scoringError || undefined,
      radar: studentResult?.radar,
      tags: studentResult?.tags,
      evi: studentResult?.evi,
      summary: studentResult?.summary,
      progress: syncResult.progress,
      completedInterview: isComplete ? syncResult.progress.latestCompletedInterview : null
    });
  } catch (e) {
    return makeResponse(400, { ok: false, error: e.message });
  }
}

async function rescoreInterview(body) {
  try {
    const sessionId = String(body?.sessionId || "").trim();
    if (!sessionId) return makeResponse(400, { ok: false, error: "sessionId required" });

    const session = await getInterviewSession(sessionId);
    if (!session) return makeResponse(404, { ok: false, error: "session not found" });
    const finalized = await ensureRound1Finalized(session.team_id);
    if (!finalized.ok) return finalized.response;

    if (session.is_complete) {
      const studentResult = sanitizeStudentInterviewResult(session.result);
      return makeResponse(200, {
        ok: true,
        idempotent: true,
        isComplete: true,
        radar: studentResult?.radar,
        tags: studentResult?.tags,
        evi: studentResult?.evi,
        summary: studentResult?.summary
      });
    }

    if (Number(session.round_no || 0) < MAX_INTERVIEW_TURNS) {
      return makeResponse(400, {
        ok: false,
        error: "interview not yet at final turn",
        round_no: session.round_no
      });
    }

    const recapRes = await recap({ teamId: session.team_id });
    const recapData = recapRes?.body?.ok ? recapRes.body : {};

    let result;
    try {
      result = await extractInterviewResult({
        gridId: String(recapData.final_grid_id || "ToB_Differentiation_Adult"),
        architecture: String(recapData.architecture || ""),
        memberDims: session.member_dims,
        history: session.history
      });
    } catch (err) {
      if (err instanceof InterviewScoringError) {
        return makeResponse(503, {
          ok: false,
          scoringError: err.reason,
          retry: true,
          message: "评分失败，请稍后重试"
        });
      }
      throw err;
    }

    await saveInterviewSession({
      ...session,
      is_complete: true,
      result,
      updated_at: nowIso()
    });

    await syncMemberInterviewState(session.team_id, session.member_id);

    const studentResult = sanitizeStudentInterviewResult(result);
    return makeResponse(200, {
      ok: true,
      isComplete: true,
      radar: studentResult?.radar,
      tags: studentResult?.tags,
      evi: studentResult?.evi,
      summary: studentResult?.summary
    });
  } catch (e) {
    return makeResponse(400, { ok: false, error: e.message });
  }
}

async function interviewEnd(body) {
  try {
    const sessionId = String(body?.sessionId || "").trim();
    if (!sessionId) return makeResponse(400, { ok: false, error: "sessionId required" });

    const session = await getInterviewSession(sessionId);
    if (!session) return makeResponse(404, { ok: false, error: "session not found" });
    const finalized = await ensureRound1Finalized(session.team_id);
    if (!finalized.ok) return finalized.response;
    if (session.is_complete) {
      const studentResult = sanitizeStudentInterviewResult(session.result);
      const sessions = await listInterviewSessionsForMember(session.team_id, session.member_id);
      const team = await getTeam(session.team_id);
      const member = listTeamMembers(team).find((item) => item.id === session.member_id);
      const completedSessions = sessions.filter((item) => item.is_complete);
      const { personaPool } = await ensureMemberPersonaPool(team, member?.id || session.member_id, Math.min(MAX_INTERVIEWS_PER_MEMBER, completedSessions.length + 1));
      const progress = buildMemberInterviewProgress(sessions, personaPool);
      return makeResponse(200, {
        ok: true,
        alreadyComplete: true,
        round: Number(session.round_no || 0),
        isComplete: true,
        radar: studentResult?.radar,
        tags: studentResult?.tags,
        evi: studentResult?.evi,
        summary: studentResult?.summary,
        progress
      });
    }

    const personas = enrichPersonas(session.personas);
    const persona = personas[0] || null;
    const history = sanitizeInterviewHistory(session.history, persona);
    const round = history.filter((item) => item.role === "user").length;
    if (round < MIN_TURNS_TO_END) {
      return makeResponse(400, { ok: false, error: `至少完成 ${MIN_TURNS_TO_END} 轮后才能结束访谈` });
    }

    const recapRes = await recap({ teamId: session.team_id });
    const recapData = recapRes?.body?.ok ? recapRes.body : {};
    const result = await extractInterviewResult({
      gridId: String(recapData.final_grid_id || "ToB_Differentiation_Adult"),
      architecture: String(recapData.architecture || ""),
      memberDims: session.member_dims,
      history
    });
    const computationContext = buildComputationContext({
      teamId: session.team_id,
      sessionId,
      memberId: session.member_id
    });
    if (computationContext) {
      scheduleStages(computationContext, [
        {
          stage: "r2_interview_extract",
          params: {
            member_id: session.member_id,
            persona_count: personas.length,
            total_turns: round,
            dimension_evidence: result?.dimensionEvidence || {},
            tags: Array.isArray(result?.tags) ? result.tags.map((item) => item?.tag || item).filter(Boolean) : [],
            interview_quality: result?.interviewQuality || {}
          }
        },
        {
          stage: "r2_evi",
          params: {
            member_id: session.member_id,
            raw_evi: roundForLog(result?.eviMeta?.raw_evi ?? result?.evi),
            tag_count: Number(result?.eviMeta?.tag_count || 0),
            dim_coverage: roundForLog(result?.eviMeta?.dim_coverage || 0),
            final_evi: roundForLog(result?.eviMeta?.final_evi ?? result?.evi)
          }
        }
      ]);
    }

    await saveInterviewSession({
      ...session,
      personas,
      history,
      result,
      round_no: round,
      is_complete: true,
      updated_at: nowIso()
    });

    const syncResult = await syncMemberInterviewState(session.team_id, session.member_id);
    const studentResult = sanitizeStudentInterviewResult(result);
    const responseBody = {
      ok: true,
      round,
      isComplete: true,
      endedBy: "manual",
      radar: studentResult?.radar,
      tags: studentResult?.tags,
      evi: studentResult?.evi,
      summary: studentResult?.summary,
      progress: syncResult.progress,
      completedInterview: syncResult.progress.latestCompletedInterview
    };
    console.log("[Round2][InterviewEndResponseBody]", JSON.stringify(responseBody));
    return makeResponse(200, responseBody);
  } catch (e) {
    return makeResponse(400, { ok: false, error: e.message });
  }
}

async function interviewSessionApi(query) {
  try {
    const teamId = String(query?.teamId || query?.team_id || "").trim();
    const memberId = String(query?.memberId || query?.member_id || "").trim();
    if (!teamId || !memberId) {
      return makeResponse(400, { ok: false, error: "teamId/memberId required" });
    }

    const team = await getTeam(teamId);
    if (!team) return makeResponse(404, { ok: false, error: "team not found" });
    const finalized = await ensureRound1Finalized(team);
    if (!finalized.ok) return finalized.response;
    const member = listTeamMembers(team).find((item) => item.id === memberId);
    let sessions = await listInterviewSessionsForMember(teamId, memberId);
    const completedSessions = sessions.filter((item) => item.is_complete);
    const { personaPool } = await ensureMemberPersonaPool(team, member?.id || memberId, Math.min(MAX_INTERVIEWS_PER_MEMBER, completedSessions.length + 1));
    const progress = buildMemberInterviewProgress(sessions, personaPool);
    const activeSession = sessions.find((item) => !item.is_complete) || null;
    const latestSession = sessions[sessions.length - 1] || null;
    const session = activeSession || latestSession || null;

    if (!session) {
      return makeResponse(200, {
        ok: true,
        session: null,
        progress,
        interviews: [],
        dimensionGuide: buildDimensionGuide([])
      });
    }

    const serialized = serializeSession(session);
    return makeResponse(200, {
      ok: true,
      session: activeSession ? serialized : null,
      latestSession: serialized,
      progress,
      interviews: progress.completedInterviews,
      dimensionGuide: buildDimensionGuide(serialized.memberDims)
    });
  } catch (e) {
    return makeResponse(400, { ok: false, error: e.message });
  }
}

async function saveMemberSelectionApi(body) {
  try {
    const teamId = String(body?.teamId || "").trim();
    const memberId = String(body?.memberId || "").trim();
    const sessionId = normalizeSessionId(body?.sessionId || body?.session_id);
    const selections = Array.isArray(body?.selections) ? body.selections : [];
    if (!teamId || !memberId) return makeResponse(400, { ok: false, error: "teamId/memberId required" });
    const team = await getTeam(teamId);
    if (!team) return makeResponse(404, { ok: false, error: "team not found" });
    const finalized = await ensureRound1Finalized(team);
    if (!finalized.ok) return finalized.response;
    const teamState = await getTeamRound2State(teamId);
    const memberState = (teamState?.members || []).find((member) => member.id === memberId) || null;
    if (memberState?.cardStatus === "skipped_by_leader") {
      return makeResponse(409, {
        ok: false,
        error: "submission_skipped_by_leader",
        message: "组长已跳过该成员的个人选卡，本轮不能补交。"
      });
    }
    if (statusIndex(teamState?.r2?.status) >= statusIndex("R2_TEAM_MERGE") && memberState?.cardStatus !== "submitted") {
      return makeResponse(409, {
        ok: false,
        error: "submission_closed",
        message: "团队已进入合并阶段，个人选卡提交已关闭。"
      });
    }
    if (team) {
      const sessionConfig = await getSessionConfig(sessionId);
      if (isSummaryModeSession(sessionConfig)) {
        await freezeStaticSummaryChoiceForTeam(team, sessionId, memberId);
      }
    }
    const markedSubmitted = await markMemberCardsSubmittedIfOpen(teamId, memberId, selections.length);
    if (!markedSubmitted) {
      return makeResponse(409, {
        ok: false,
        error: "submission_closed",
        message: "团队已进入合并阶段或该成员已被组长跳过，个人选卡提交已关闭。"
      });
    }
    await saveMemberSelections(teamId, memberId, selections);

    const statusResult = await updateTeamRound2StatusFromCardSubmissions(teamId);
    const finalStatus = statusResult.team_status || "R2_INDIVIDUAL_CARDS";

    return makeResponse(200, { ok: true, teamId, memberId, count: selections.length, team_status: finalStatus });
  } catch (e) {
    return makeResponse(400, { ok: false, error: e.message });
  }
}

function summarizeSkippedMembers(members, predicate) {
  return (Array.isArray(members) ? members : [])
    .filter(predicate)
    .map((member) => ({
      id: member.id,
      name: member.name || member.memberName || member.id
    }));
}

async function forceAdvanceRound2Api(body = {}) {
  try {
    const teamId = String(body?.teamId || body?.team_id || "").trim();
    const memberId = String(body?.memberId || body?.member_id || "").trim();
    const gate = String(body?.gate || body?.target_gate || body?.targetGate || "").trim().toLowerCase();
    const sessionId = normalizeSessionId(body?.sessionId || body?.session_id);
    if (!teamId || !memberId) return makeResponse(400, { ok: false, error: "teamId/memberId required" });
    if (!["reading", "cards"].includes(gate)) {
      return makeResponse(400, { ok: false, error: "invalid_force_gate" });
    }
    const finalized = await ensureRound1Finalized(teamId);
    if (!finalized.ok) return finalized.response;

    const permission = await ensureRound2LeaderPermission(teamId, memberId);
    if (!permission.ok) return permission.response;
    const team = permission.team;
    const beforeState = await getTeamRound2State(teamId);
    if (!beforeState) return makeResponse(404, { ok: false, error: "team not found" });

    if (gate === "reading") {
      const plannedSkippedMembers = summarizeSkippedMembers(
        beforeState.members,
        (member) => String(member.readingStatus || "") !== "completed"
      );
      const sessionConfig = await getSessionConfig(sessionId);
      let summaryChoice = null;
      if (isSummaryModeSession(sessionConfig)) {
        summaryChoice = await freezeStaticSummaryChoiceForTeam(team, sessionId, memberId);
      }
      const skippedMembers = [];
      for (const skipped of plannedSkippedMembers) {
        if (await markReadingSkippedByLeaderIfPending(teamId, skipped.id)) {
          skippedMembers.push(skipped);
        }
      }
      const statusResult = await updateTeamRound2StatusFromInterviewCompletion(teamId, nowIso(), { force: true });
      await logTeacherAction({
        action: "force_advance_by_leader",
        teamId,
        memberId,
        details: {
          gate: "round2_reading",
          from: beforeState.r2.status,
          to: statusResult.team_status || "R2_INDIVIDUAL_CARDS",
          force_advanced_by: memberId,
          force_advanced_at: nowIso(),
          skipped_members: skippedMembers
        }
      });
      const afterState = await getTeamRound2State(teamId);
      return makeResponse(200, {
        ok: true,
        team_id: teamId,
        force_gate: "round2_reading",
        force_advanced: true,
        team_status: afterState?.r2?.status || statusResult.team_status || "R2_INDIVIDUAL_CARDS",
        choice: sanitizeStudentPersonaChoice(summaryChoice),
        evi: summaryChoice?.evi ?? null,
        skipped_members: skippedMembers,
        ...buildLeaderMeta(afterState || team, memberId)
      });
    }

    const submittedMembers = (beforeState.members || []).filter((member) => member.cardStatus === "submitted");
    if (!submittedMembers.length) {
      return makeResponse(400, {
        ok: false,
        error: "no_submitted_member_selections",
        message: "至少需要一名成员已提交选卡，才能由组长强推合并。"
      });
    }
    const plannedSkippedMembers = summarizeSkippedMembers(
      beforeState.members,
      (member) => member.cardStatus !== "submitted"
    );
    const skippedMembers = [];
    for (const skipped of plannedSkippedMembers) {
      if (await markCardsSkippedByLeaderIfPending(teamId, skipped.id, memberId)) {
        skippedMembers.push(skipped);
      }
    }
    const statusResult = await updateTeamRound2StatusFromCardSubmissions(teamId, nowIso(), { force: true });
    await logTeacherAction({
      action: "force_advance_by_leader",
      teamId,
      memberId,
      details: {
        gate: "round2_cards",
        from: beforeState.r2.status,
        to: statusResult.team_status || "R2_TEAM_MERGE",
        force_advanced_by: memberId,
        force_advanced_at: nowIso(),
        skipped_members: skippedMembers,
        submitted_member_count: submittedMembers.length
      }
    });
    const afterState = await getTeamRound2State(teamId);
    return makeResponse(200, {
      ok: true,
      team_id: teamId,
      force_gate: "round2_cards",
      force_advanced: true,
      team_status: afterState?.r2?.status || statusResult.team_status || "R2_TEAM_MERGE",
      skipped_members: skippedMembers,
      submitted_member_count: submittedMembers.length,
      ...buildLeaderMeta(afterState || team, memberId)
    });
  } catch (e) {
    return makeResponse(400, { ok: false, error: e.message });
  }
}

async function mergeApi(body) {
  try {
    const teamId = String(body?.teamId || "").trim();
    const memberId = String(body?.memberId || body?.member_id || "").trim();
    const sessionId = normalizeSessionId(body?.sessionId || body?.session_id);
    if (!teamId) return makeResponse(400, { ok: false, error: "teamId required" });
    let team = await getTeam(teamId);
    if (!team) return makeResponse(404, { ok: false, error: "team not found" });
    const finalized = await ensureRound1Finalized(team);
    if (!finalized.ok) return finalized.response;
    if (!String(team.leader_member_id || "").trim() && memberId) {
      team = await setTeamLeader(teamId, memberId);
    }

    const rows = await getMemberSelections(teamId);
    const members = listTeamMembers(team);
    const memberMap = Object.fromEntries(members.map((m) => [m.id, m.member_name]));
    const assignments = await ensureAssignments(team);

    const merged = mergeTeamSelections(rows.map((r) => r.selections));

    const selectedByMap = {};
    rows.forEach((r) => {
      (r.selections || []).forEach((sel) => {
        if (!selectedByMap[sel.cap_id]) selectedByMap[sel.cap_id] = [];
        if (!selectedByMap[sel.cap_id].includes(memberMap[r.member_id] || r.member_id)) {
          selectedByMap[sel.cap_id].push(memberMap[r.member_id] || r.member_id);
        }
      });
    });

    const teamSelections = merged.selections.map((s) => ({
      ...s,
      selectedBy: selectedByMap[s.cap_id] || []
    }));

    const validation = validateSelections(teamSelections);
    const softPenalties = computeSoftPenalties(teamSelections, Number(body?.COGSbase || GLOBAL_PARAMS.V || 600));
    const sessionConfig = await getSessionConfig(sessionId);
    const personaChoice = isSummaryModeSession(sessionConfig)
      ? await freezeStaticSummaryChoiceForTeam(team, sessionId, memberId || "system_merge")
      : await readPersonaChoice(teamId, sessionId);
    const interviewByMember = personaChoice ? {} : await getLatestInterviewByMember(teamId);
    const mergedInterview = personaChoice
      ? sanitizeStudentMergedInterview(buildMergedInterviewFromPersonaChoice(personaChoice), {
          stripEvi: isSummaryModeSession(sessionConfig),
          stripTags: isSummaryModeSession(sessionConfig)
        })
      : sanitizeStudentMergedInterview(aggregateInterviewByOwner({ assignments, memberMap, interviewByMember }));
    const totalCost = teamSelections.reduce((sum, sel) => {
      try {
        return sum + Number(getCapabilityParams(sel.cap_id, sel.tier)?.dCOGS || 0);
      } catch (_) {
        return sum;
      }
    }, 0);

    const statusResult = await updateTeamRound2StatusFromCardSubmissions(teamId);
    if (statusIndex(statusResult.team_status) < statusIndex("R2_TEAM_MERGE")) {
      return makeResponse(400, { ok: false, error: "not_all_members_submitted", message: "等待所有成员提交个人选卡" });
    }

    for (const member of members) {
      await updateMemberProgress(teamId, member.id, {
        last_activity_at: nowIso()
      });
    }

    let draft = await readRound2TeamDraft(teamId);
    if (!draft) {
      draft = await saveRound2TeamDraft(teamId, memberId || team?.leader_member_id || members[0]?.id || "", {
        selections: teamSelections
      });
    }
    const pricingContext = buildRound2PricingContextForTeam(team);

    const responseBody = {
      ok: true,
      teamSelections,
      card_count: teamSelections.length,
      total_cost: Number(totalCost),
      validTotal: merged.validTotal,
      mergeViolations: merged.violations,
      violations: validation.violations,
      hardViolationCount: validation.hardViolationCount,
      softPenalties,
      mergedInterview,
      selected_persona_id: personaChoice?.persona_id || personaChoice?.archetype_id || "",
      team_draft: draft,
      pricing_context: pricingContext,
      price_min: pricingContext.price_min,
      price_max: pricingContext.price_max,
      price_step: pricingContext.price_step,
      default_price: pricingContext.default_price,
      ...buildLeaderMeta(team, memberId)
    };
    console.log("[Round2][TeamMergeResponseBody]", JSON.stringify(responseBody));
    return makeResponse(200, responseBody);
  } catch (e) {
    return makeResponse(400, { ok: false, error: e.message });
  }
}

async function saveTeamDraftApi(body) {
  try {
    const teamId = String(body?.teamId || body?.team_id || "").trim();
    const memberId = String(body?.memberId || body?.member_id || "").trim();
    if (!teamId || !memberId) return makeResponse(400, { ok: false, error: "teamId/memberId required" });
    const finalized = await ensureRound1Finalized(teamId);
    if (!finalized.ok) return finalized.response;

    const permission = await ensureRound2LeaderPermission(teamId, memberId);
    if (!permission.ok) return permission.response;

    const patch = {};
    if (body?.price !== undefined) {
      const price = Number(body.price);
      const priceCheck = validateRound2PriceForTeam(permission.team, price);
      if (!priceCheck.ok) {
        return makeResponse(400, {
          ok: false,
          error: "price_out_of_range",
          message: priceCheck.message,
          ...priceCheck.pricing
        });
      }
      patch.price = price;
    }
    if (body?.selections !== undefined) {
      patch.selections = normalizeSelectionsPayload(body.selections);
    }

    const draft = await saveRound2TeamDraft(teamId, memberId, patch);
    await updateTeamRound2Status(teamId, "R2_TEAM_DISCUSSION");
    const teamState = await getTeamRound2State(teamId);
    for (const member of teamState?.members || []) {
      await updateMemberProgress(teamId, member.id, {
        current_step: "in_discussion",
        last_activity_at: nowIso()
      });
    }

    return makeResponse(200, {
      ok: true,
      team_id: teamId,
      team_draft: draft,
      ...buildLeaderMeta(permission.team, memberId)
    });
  } catch (e) {
    return makeResponse(400, { ok: false, error: e.message });
  }
}

async function teamSubmitApi(body) {
  try {
    const teamId = String(body?.teamId || body?.team_id || "").trim();
    const memberId = String(body?.memberId || body?.member_id || "").trim();
    const sessionId = normalizeSessionId(body?.sessionId || body?.session_id);
    if (!teamId) return makeResponse(400, { ok: false, error: "teamId required" });
    const finalized = await ensureRound1Finalized(teamId);
    if (!finalized.ok) return finalized.response;

    const permission = await ensureRound2LeaderPermission(teamId, memberId);
    if (!permission.ok) return permission.response;
    const team = permission.team;
    if (!team.final_grid_id) {
      return makeResponse(400, { ok: false, error: "team must finish Round 1 before Round 2 submit" });
    }

    const selections = normalizeSelectionsPayload(body?.selections);
    const price = Number(body?.price);
    if (!Array.isArray(selections) || selections.length === 0) {
      return makeResponse(400, { ok: false, error: "selections required" });
    }
    if (!Number.isFinite(price) || price <= 0) {
      return makeResponse(400, { ok: false, error: "valid price required" });
    }
    const priceCheck = validateRound2PriceForTeam(team, price);
    if (!priceCheck.ok) {
      return makeResponse(400, {
        ok: false,
        error: "price_out_of_range",
        message: priceCheck.message,
        ...priceCheck.pricing
      });
    }

    const sessionConfig = await getSessionConfig(sessionId);
    const isSummaryMode = isSummaryModeSession(sessionConfig);
    const personaChoice = isSummaryMode
      ? await freezeStaticSummaryChoiceForTeam(team, sessionId, memberId || "system_submit")
      : await readPersonaChoice(teamId, sessionId);
    const liveMergedInterview = !isSummaryMode && !personaChoice
      ? aggregateInterviewByOwner({
          assignments: await ensureAssignments(team),
          memberMap: Object.fromEntries(listTeamMembers(team).map((m) => [m.id, m.member_name])),
          interviewByMember: await getLatestInterviewByMember(teamId)
        })
      : null;
    const flowVersion = personaChoice?.flow_version
      || (sessionConfig.interview_mode === "live" ? "twophase_v1" : SUMMARY_FLOW_VERSION);
    const fallbackRadar = personaChoice?.radar || {};
    const fallbackTags = Array.isArray(personaChoice?.tags) ? personaChoice.tags : [];
    const radar = isSummaryMode
      ? normalizeRadarPayload(fallbackRadar)
      : normalizeRadarPayload(liveMergedInterview?.radar || fallbackRadar);
    const tags = isSummaryMode
      ? fallbackTags
      : (Array.isArray(liveMergedInterview?.tags) ? liveMergedInterview.tags : fallbackTags);
    const evi = resolveAuthoritativeSubmitEvi({
      body: !isSummaryMode && liveMergedInterview
        ? {
            ...body,
            mergedInterview: {
              ...(body?.mergedInterview || {}),
              evi: liveMergedInterview.evi
            }
          }
        : body,
      personaChoice,
      sessionConfig,
      teamId,
      sessionId
    });
    const bestGrid = String(body?.bestGrid || body?.best_grid || "").trim();

    const submission = {
      team_id: teamId,
      session_id: sessionId,
      flow_version: flowVersion,
      price,
      selections,
      cards: buildCardSummary(selections),
      card_count: selections.length,
      dcogs: null,
      risk_total: null,
      best_grid: bestGrid,
      submitted_at: nowIso()
    };
    const radarRow = {
      team_id: teamId,
      session_id: sessionId,
      radar,
      tags,
      evi,
      updated_at: nowIso()
    };

    const snapshot = await computeStoredTeamResult(teamId, sessionId, submission, radarRow);
    await updateTeamRound2Status(teamId, "R2_SUBMITTED");
    const teamState = await getTeamRound2State(teamId);
    for (const member of teamState?.members || []) {
      await updateMemberProgress(teamId, member.id, {
        current_step: "done",
        last_activity_at: nowIso()
      });
    }
    return makeResponse(200, {
      ok: true,
      team_id: teamId,
      session_id: sessionId,
      submission: snapshot.submission,
      radar: sanitizeStudentStoredRadar(snapshot.radar),
      result: sanitizeStudentTeamResult(snapshot.result),
      flow_version: flowVersion,
      ...buildLeaderMeta(team, memberId)
    });
  } catch (e) {
    return makeResponse(400, { ok: false, error: e.message });
  }
}

async function teamResultApi(query) {
  try {
    const teamId = String(query?.teamId || query?.team_id || "").trim();
    const sessionId = normalizeSessionId(query?.sessionId || query?.session_id);
    if (!teamId) return makeResponse(400, { ok: false, error: "teamId required" });

    const snapshot = await getTeamResultSnapshot(teamId, sessionId);
    const personaChoice = await readPersonaChoice(teamId, sessionId);
    return makeResponse(200, {
      ok: true,
      team_id: teamId,
      session_id: sessionId,
      submission: snapshot?.submission || null,
      radar: sanitizeStudentStoredRadar(snapshot?.radar || null),
      result: sanitizeStudentTeamResult(snapshot?.result || null),
      selected_persona_id: personaChoice?.persona_id || personaChoice?.archetype_id || "",
      flow_version: personaChoice?.flow_version || ""
    });
  } catch (e) {
    return makeResponse(400, { ok: false, error: e.message });
  }
}

async function teamStatusApi(query) {
  try {
    const teamId = String(query?.teamId || query?.team_id || "").trim();
    const memberId = String(query?.memberId || query?.member_id || "").trim();
    if (!teamId) return makeResponse(400, { ok: false, error: "teamId required" });
    const lite = query?.lite === "1" || query?.lite === 1 || query?.lite === true;

    if (lite) {
      const teamState = await getTeamRound2State(teamId);
      if (!teamState) return makeResponse(404, { ok: false, error: "team not found" });
      const pricingContext = buildRound2PricingContextForTeam(teamState);
      const sessionConfig = await getSessionConfig(normalizeSessionId(query?.sessionId || query?.session_id));
      const member = memberId
        ? (teamState.members || []).find((item) => item.id === memberId) || null
        : null;
      const memberState = member
        ? {
            id: member.id,
            name: member.name,
            dims: Array.isArray(member.dims) ? member.dims : [],
            interview_status: member.interviewStatus,
            interview_rounds: member.interviewRounds,
            completed_interviews: Number(member.completedInterviews || 0),
            completedInterviews: Number(member.completedInterviews || 0),
            card_status: member.cardStatus,
            cards_selected: member.cardsSelected,
            current_step: member.currentStep,
            forced_by_teacher: member.forcedByTeacher,
            is_leader: Boolean(memberId && member.id === teamState.leaderMemberId)
          }
        : null;
      return makeResponse(200, {
        ok: true,
        lite: true,
        team_id: teamId,
        team_status: teamState.r2.status,
        team_status_label: teamState.r2.statusLabel,
        entered_at: teamState.r2.enteredAt,
        duration_minutes: teamState.r2.durationMinutes,
        ...buildLeaderMeta(teamState, memberId),
        session_config: sessionConfig,
        pricing_context: pricingContext,
        price_min: pricingContext.price_min,
        price_max: pricingContext.price_max,
        price_step: pricingContext.price_step,
        default_price: pricingContext.default_price,
        member: memberState,
        member_state: memberState,
        members: teamState.members.map((item) => ({
          id: item.id,
          name: item.name,
          dims: Array.isArray(item.dims) ? item.dims : [],
          interview_status: item.interviewStatus,
          interview_rounds: item.interviewRounds,
          completed_interviews: Number(item.completedInterviews || 0),
          card_status: item.cardStatus,
          cards_selected: item.cardsSelected,
          current_step: item.currentStep,
          forced_by_teacher: item.forcedByTeacher
        }))
      });
    }

    const team = await getTeam(teamId);
    if (!team) return makeResponse(404, { ok: false, error: "team not found" });
    const pricingContext = buildRound2PricingContextForTeam(team);
    await ensureAssignments(team);
    const sessionId = normalizeSessionId(query?.sessionId || query?.session_id);
    const personaChoice = await readPersonaChoice(teamId, sessionId);
    const personaReports = await listStudentPersonaReportsForTeam(team, sessionId);
    const calcGridId = toCalcGridId(team?.final_grid_id || "", team?.final_architecture || "");
    const defaultReportIndex = getInitialPersonaReportIndex(calcGridId);
    const availableReports = buildStudentPersonaCatalog(calcGridId);

    const teamState = await getTeamRound2State(teamId);
    if (!teamState) return makeResponse(404, { ok: false, error: "team not found" });
    const teamDraft = await readRound2TeamDraft(teamId);
    const sessionConfig = await getSessionConfig(sessionId);
    const round1Context = team
      ? (() => {
          const vpSummary = normalizeVpSummary(team.final_vp_summary, team.final_vp_text || "");
          return {
            grid_id: team.final_grid_id || "",
            architecture: team.final_architecture || "",
            vp_text: team.final_vp_text || "",
            final_vp_summary: vpSummary,
            vp_summary: vpSummary
          };
        })()
      : null;
    const member = memberId
      ? (teamState.members || []).find((item) => item.id === memberId) || null
      : null;
    let memberRow = null;
    let completedInterviewCount = 0;
    if (memberId) {
      const memberRows = await runSql(`
        SELECT id, card_status
        FROM team_members
        WHERE team_id = ${sqlQuote(teamId)}
          AND id = ${sqlQuote(memberId)}
        LIMIT 1;
      `);
      memberRow = memberRows[0] || null;

      const countRows = await runSql(`
        SELECT COUNT(*)::int AS completed_count
        FROM round2_interview_sessions
        WHERE team_id = ${sqlQuote(teamId)}
          AND member_id = ${sqlQuote(memberId)}
          AND is_complete = TRUE;
      `);
      completedInterviewCount = Number(countRows[0]?.completed_count || 0);
    }
    const existingMemberState = member
      ? {
          id: member.id,
          name: member.name,
          dims: Array.isArray(member.dims) ? member.dims : [],
          interview_status: member.interviewStatus,
          interview_rounds: member.interviewRounds,
          completed_interviews: Number(member.completedInterviews || 0),
          cards_selected: member.cardsSelected,
          current_step: member.currentStep,
          forced_by_teacher: member.forcedByTeacher,
          is_leader: Boolean(memberId && member.id === teamState.leaderMemberId)
        }
      : null;
    const memberState = existingMemberState
      ? {
          ...existingMemberState,
          card_status: memberRow?.card_status || null,
          completedInterviews: completedInterviewCount
        }
      : null;
    console.log("[round2/state] member_state:", {
      memberId,
      card_status: memberRow?.card_status || null,
      completedInterviews: completedInterviewCount
    });

    return makeResponse(200, {
      ok: true,
      team_id: teamId,
      team_status: teamState.r2.status,
      team_status_label: teamState.r2.statusLabel,
      entered_at: teamState.r2.enteredAt,
      duration_minutes: teamState.r2.durationMinutes,
      ...buildLeaderMeta(teamState, memberId),
      session_config: sessionConfig,
      pricing_context: pricingContext,
      price_min: pricingContext.price_min,
      price_max: pricingContext.price_max,
      price_step: pricingContext.price_step,
      default_price: pricingContext.default_price,
      team_draft: teamDraft,
      persona_choice: sanitizeStudentPersonaChoice(personaChoice),
      persona_reports: personaReports,
      default_report_index: defaultReportIndex,
      available_reports: availableReports,
      flow_version: personaChoice?.flow_version || "",
      round1_context: round1Context,
      member: memberState,
      member_state: memberState,
      members: teamState.members.map((item) => ({
        id: item.id,
        name: item.name,
        dims: Array.isArray(item.dims) ? item.dims : [],
        interview_status: item.interviewStatus,
        interview_rounds: item.interviewRounds,
        completed_interviews: Number(item.completedInterviews || 0),
        card_status: item.cardStatus,
        cards_selected: item.cardsSelected,
        current_step: item.currentStep,
        forced_by_teacher: item.forcedByTeacher
      }))
    });
  } catch (e) {
    return makeResponse(400, { ok: false, error: e.message });
  }
}

async function reflectionApi(body) {
  try {
    const teamId = String(body?.teamId || "").trim();
    const calcResult = body?.calcResult || {};
    if (!teamId) return makeResponse(400, { ok: false, error: "teamId required" });
    const finalized = await ensureRound1Finalized(teamId);
    if (!finalized.ok) return finalized.response;

    const prompt = [
      "请用中文输出一段 Round 2 反思报告，包含：策略亮点、主要取舍、风险点、下一步改进建议。",
      `团队: ${teamId}`,
      `核心结果: share=${calcResult.share || 0}, profit=${calcResult.profit || 0}, risk=${calcResult.risk || 0}, z_penalty=${calcResult.z_penalty || 0}`
    ].join("\n");

    let report = "";
    try {
      const messages = [
        { role: "system", content: "你是商学院产品战略教练。输出简洁、结构化中文。" },
        { role: "user", content: prompt }
      ];
      report = await withLlmLogging({
        caller: "round2Routes.reflectionApi",
        teamId,
        memberId: null,
        messages
      }, () => chatCompletion(messages, { temperature: 0.3, max_tokens: 600, timeoutMs: ROUND2_LLM_TIMEOUT_MS }));
    } catch (_) {
      report = [
        "策略亮点：方案在核心体验与成本约束之间做了平衡。",
        "主要取舍：为控制预算压低了部分高阶能力，牺牲了一定溢价空间。",
        "风险点：若后续需求集中在未覆盖标签，转化会受限。",
        "建议：优先补足高权重标签对应能力，并持续压缩高负载模块。"
      ].join("\n");
    }

    return makeResponse(200, { ok: true, report });
  } catch (e) {
    return makeResponse(400, { ok: false, error: e.message });
  }
}

module.exports = {
  ensureSchema,
  getSummarySourceMetadata,
  normalizeSelectionsPayload,
  buildCardSummary,
  toCalcGridId,
  saveTeamDraftApi,
  teamSubmitApi,
  teamResultApi,
  teamStatusApi,
  getTeamResultSnapshot,
  computeProfitAtPrice,
  computeCounterfactualAtPrice,
  recap,
  assignDimensionsApi,
  personaReportsApi,
  personaReportByIndexApi,
  teamReadingStatusApi,
  completeSummaryReadingApi,
  selectPersonaArchetypeApi,
  interviewAuto,
  interviewSessionApi,
  interviewStart,
  interviewEnd,
  interviewReply,
  rescoreInterview,
  saveMemberSelectionApi,
  forceAdvanceRound2Api,
  mergeApi,
  reflectionApi,
  __test: {
    InterviewScoringError,
    getRound2ChannelFeeByGrid,
    getPriorRadarByGrid,
    buildAssignments,
    buildExtractInterviewMessages,
    cleanExtractedPayload,
    filterIncompatibleTags,
    getGridDefaultTags,
    inferWeakEvidenceFromConversation,
    extractInterviewResult,
    ensurePersonaReportsForTeam,
    buildMergedInterviewFromPersonaChoice,
    mapEvidenceToResult,
    normalizeExtractedTags,
    isPersonaLeakage,
    isPersonaConsistentWithRound1Context,
    readPersonaReports,
    readPersonaChoice,
    selectStaticPersonaReport,
    getDefaultPersonaReportIndex,
    getStaticPersonaReportByIndex,
    getStaticPersonaReportByPersonaId,
    getGridKeywordsFull,
    buildStudentPersonaCatalog,
    computeCoverageRatioForViewedReports,
    computeDynamicSummaryEvi,
    buildStaticSummaryModeRadarResult,
    buildStudentReadingStatusPayload,
    completeSummaryReadingApi,
    freezeStaticSummaryChoiceForTeam,
    recordPersonaView,
    getTeamViewedPersonas,
    getMemberViewedPersonas,
    sanitizeStudentPersonaChoice,
    sanitizeStudentPersonaReport,
    sanitizeStudentInterviewResult,
    sanitizeStudentMergedInterview,
    sanitizeStudentTeamResult,
    sanitizeStudentStoredRadar,
    getGridDimensionEvidenceRow,
    requireGridDimensionEvidenceRow,
    buildRound2PricingContextForTeam,
    validateRound2PriceForTeam,
    scaleStudentFacingMoneyValue,
    buildStudentRound1MoneyView
  }
};
