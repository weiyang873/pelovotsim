const path = require("node:path");
const { runSql, sqlQuote } = require("../db/pgSql");

const Engine = require("../../engine");
const TeamRoutes = require("./teamRoutes");
const { chatCompletion } = require("../llm/deepseekClient");
const { withLlmLogging } = require("../llm/llm_logger");
const { generatePersona } = require("../llm/personaGenerator");
const { getTeamSessions } = require("../llm/sessions");
const { getTeam, setTeamLeader } = require("../multiplayer/teamManager");
const { scheduleStages } = require("../multiplayer/computationLog");
const {
  calculate,
  validateSelections,
  computeSoftPenalties,
  getCapabilityParams
} = require("../llm/rdCalculator");
const { assignDimensions, mergeTeamSelections } = require("../multiplayer/rdTeamAdapter");
const { getRound2MarketInfo } = require("../multiplayer/marketInfo");
const {
  ensureSchema: ensureRound2StateSchema,
  updateTeamRound2Status,
  updateMemberProgress,
  getTeamRound2State
} = require("../multiplayer/round2State");
const CAP_GROUPS = require("../../data/capability_groups_v2.json");

const ROOT = path.join(__dirname, "..", "..");
const CONFIG_DIR = path.join(ROOT, "game_config_v0.1");
const GRID_PRIOR_PATH = path.join(ROOT, "data", "grid_priors_v4_cap_weights.json");
let cachedEngineConfig = null;
let cachedGridPriors = null;
const ROUND2_PERSONA_POOL_VERSION = 4;

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
  safety: ["隐私保护", "儿童安全", "远程控制"],
  extend: ["智能家居", "家庭版", "OTA更新"],
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
const ALLOWED_INTERVIEW_TAGS = [
  "安全与信任", "便携版", "表情显示", "场景感知", "穿搭评价", "搭配建议", "多轮对话", "儿童安全",
  "个性化推荐", "跟随陪伴", "记忆回溯", "家庭版", "拍照功能", "碰撞保护", "情感陪伴", "情绪识别",
  "室内导航", "音乐播放", "隐私保护", "语音交互", "远程控制", "智能家居", "自动充电", "自主移动", "OTA更新"
];
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
const PERSONA_SEEDS_BY_GROUP = {
  ELDER: [
    { id: "elder_zhou", name: "周阿姨", age: 67, occupation: "退休教师", living_situation: "独居，女儿住在同城", desc: "退休教师，独居，重视安全感" },
    { id: "elder_liu", name: "刘先生", age: 45, occupation: "社区护工", living_situation: "和爱人一起住，经常往返多个老人家庭", desc: "社区护工，关注跌倒风险" },
    { id: "elder_wang", name: "王女士", age: 39, occupation: "财务经理", living_situation: "与丈夫和上小学的孩子同住", desc: "家属决策者，关注远程看护" },
    { id: "elder_zhang", name: "张奶奶", age: 72, occupation: "退休工人", living_situation: "和老伴住在老小区，白天常常两个人在家", desc: "老年用户，想要温和陪伴" }
  ],
  CHILD: [
    { id: "child_chen", name: "陈女士", age: 36, occupation: "市场经理", living_situation: "和丈夫、8岁女儿同住", desc: "双职工家长，关注放学后陪伴与安全" },
    { id: "child_sun", name: "孙先生", age: 41, occupation: "销售主管", living_situation: "和爱人、两个孩子一起生活", desc: "家长，最头疼孩子放学后的安排" },
    { id: "child_lin", name: "林妈妈", age: 34, occupation: "自由职业者", living_situation: "和6岁儿子住在一起，白天一边工作一边带娃", desc: "居家带娃，担心孩子独处时太无聊或不安全" },
    { id: "child_he", name: "何女士", age: 38, occupation: "小学老师", living_situation: "和丈夫、上三年级的孩子同住", desc: "注重孩子作息和情绪陪伴" }
  ],
  ADULT: [
    { id: "adult_lin", name: "林先生", age: 32, occupation: "产品经理", living_situation: "和伴侣住在城市公寓", desc: "工作忙，希望回家后轻松一点" },
    { id: "adult_gao", name: "高女士", age: 29, occupation: "品牌策划", living_situation: "独自租房，作息不太规律", desc: "独居上班族，回家后偶尔会觉得空落落的" },
    { id: "adult_xie", name: "谢先生", age: 35, occupation: "程序员", living_situation: "和妻子住在新婚小家，常常加班", desc: "晚归较多，想减少家务和精神负担" },
    { id: "adult_deng", name: "邓女士", age: 31, occupation: "咨询顾问", living_situation: "经常出差，周末才有完整休息时间", desc: "节奏快，希望生活里的琐事更省心" }
  ]
};
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
const PRODUCT_TERMS_RE = /LOVOT|机器人|智能家居|家用机器人|产品|功能|设备|机器人类/iu;

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

function makeResponse(status, body) {
  return { status, body };
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

async function ensureSchema() {
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

    CREATE TABLE IF NOT EXISTS round2_interview_sessions (
      session_id TEXT PRIMARY KEY,
      team_id TEXT NOT NULL,
      member_id TEXT NOT NULL,
      member_dims_json TEXT NOT NULL,
      personas_json TEXT NOT NULL,
      history_json TEXT NOT NULL,
      result_json TEXT,
      round_no INTEGER NOT NULL,
      is_complete BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMPTZ NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL
    );

    CREATE TABLE IF NOT EXISTS round2_submissions (
      team_id TEXT NOT NULL,
      session_id TEXT NOT NULL DEFAULT 'default',
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
  `);
  await ensureRound2StateSchema();
}

function nowIso() {
  return new Date().toISOString();
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
  return {
    team_id: row.team_id,
    price: Number.isFinite(Number(row.price)) ? Number(row.price) : null,
    selections: safeJsonParse(row.selections_json, []),
    updated_by: row.updated_by || "",
    updated_at: row.updated_at || null
  };
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
        "16. 如果访谈内容无法匹配合法标签列表中的任何标签，该需求写进 evidence/needs/scenarios/pain_points，但不要输出 tag。"
      ].join("\n")
    },
    {
      role: "user",
      content: [
        "请从以下访谈中提取结构化证据。",
        "",
        `背景：`,
        `- grid_id: ${String(gridId || "")}`,
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
        "  - 从对话中提取 4-8 个需求标签（不少于 4 个），覆盖尽量多的维度方向",
        "  - 每个标签必须有访谈证据支持",
        "  - 如果访谈内容无法匹配列表中的任何标签，该需求记录在 evidence 中但不输出 tag",
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

function normalizeExtractedTags(tags, memberDims, dimensionEvidence = {}) {
  const normalized = normalizeTextList(tags)
    .filter((tag) => ALLOWED_INTERVIEW_TAG_SET.has(tag))
    .slice(0, 8);
  const result = [];
  const seen = new Set();
  normalized.forEach((tag) => {
    if (seen.has(tag)) return;
    seen.add(tag);
    result.push(tag);
  });

  const currentDimSet = new Set(result.map((tag) => TAG_TO_DIM_SHORT.get(tag)).filter(Boolean));
  const ownedDims = Array.isArray(memberDims) ? uniqueStrings(memberDims) : [];
  const mentionedDims = DIM_KEYS_SHORT.filter((dim) => dimensionEvidence?.[dim]?.mentioned);
  const uncoveredMentionedDims = mentionedDims.filter((dim) => !currentDimSet.has(dim));
  const uncoveredOwnedDims = ownedDims.filter((dim) => !currentDimSet.has(dim));
  const remainingDims = DIM_KEYS_SHORT.filter((dim) => !currentDimSet.has(dim) && !mentionedDims.includes(dim) && !ownedDims.includes(dim));

  const dimExpansionOrder = [
    ...uncoveredMentionedDims,
    ...uncoveredOwnedDims,
    ...remainingDims
  ];

  if (currentDimSet.size < 3) {
    buildTagCandidatesForDims(dimExpansionOrder, result).forEach((tag) => {
      if (result.length >= 8 || currentDimSet.size >= 3) return;
      result.push(tag);
      const dim = TAG_TO_DIM_SHORT.get(tag);
      if (dim) currentDimSet.add(dim);
    });
  }

  if (result.length < 4) {
    const fillOrder = [
      ...mentionedDims,
      ...ownedDims,
      ...DIM_KEYS_SHORT
    ];
    buildTagCandidatesForDims(fillOrder, result).forEach((tag) => {
      if (result.length >= 4 || result.length >= 8) return;
      result.push(tag);
      const dim = TAG_TO_DIM_SHORT.get(tag);
      if (dim) currentDimSet.add(dim);
    });
  }

  if (result.length > 0) return result.slice(0, 8);
  return buildTagCandidatesForDims(ownedDims.length > 0 ? ownedDims : DIM_KEYS_SHORT, []).slice(0, 6);
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
  const extractedTags = normalizeExtractedTags(extracted?.tags, memberDims, dimensionEvidence)
    .map((tag) => ({ tag, polarity: 1 }));
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
    "7. 除非学生先介绍了产品并邀请你评价，否则不要主动提到 LOVOT、机器人、功能，也不要主动追问产品能做什么",
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

  let extracted = null;
  try {
    const messages = buildExtractInterviewMessages({ gridId, memberDims, conversation });
    const raw = await withLlmLogging({
      caller: "round2Routes.extractInterviewResult",
      teamId: null,
      memberId: null,
      messages
    }, () => chatCompletion(messages, { temperature: 0.2, max_tokens: 2500 }));
    const txt = String(raw || "").replace(/```json|```/g, "").trim();
    const start = txt.indexOf("{");
    const end = txt.lastIndexOf("}");
    extracted = cleanExtractedPayload(
      JSON.parse(start >= 0 && end > start ? txt.slice(start, end + 1) : txt)
    );
  } catch (_) {
    extracted = null;
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
  console.log("[R2] 读取 WTPadj:", Number(team.final_wtp_adj || 0), "来源表:", "teams", "字段:", "final_wtp_adj");

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

  const Pmax = Number(base.pmax || base.P_max || 14200);
  const WTP = Number(base.WTP || base.wtp_median_price || Pmax);
  const e = Number(base.e || base.price_elasticity || 1.2);
  const f = getRound2ChannelFeeByGrid(team.final_grid_id);
  const COGSbase = Number(base.cogs_proxy || base.COGS_proxy || 2000);
  const budget_cap = Math.round(COGSbase * 0.13);

  const vpScores = phase4Body?.vp_scores || {};
  const marketInfo = getRound2MarketInfo(team.final_grid_id);
  const matchedMarketCount = settleItems.filter((x) => x?.matched && x?.jinang_type === "market").length;
  const matchedTechCount = settleItems.filter((x) => x?.matched && x?.jinang_type === "tech").length;
  const displayedWtpAdj = Number(phase4Body?.wtp_breakdown?.final_result?.WTPadj || team.final_wtp_adj || 0);
  const vpSummary = normalizeVpSummary(phase4Body?.team?.final_vp_summary || team.final_vp_summary, phase4Body?.team?.final_vp_text || team.final_vp_text || "");
  console.log("[R2 pricing] 显示给学生的 WTPadj:", displayedWtpAdj);

  return {
    final_grid_id: team.final_grid_id,
    architecture: team.final_architecture || "",
    margin_headroom: phase4Body?.margin_headroom?.tier || "中等",
    market_space_tier: phase4Body?.market_space?.tier || "M",
    difficulty_tier: phase4Body?.market_space?.difficulty_tier || "中",
    vp_score: Number(phase4Body?.vp_scores?.VPscore || phase4Body?.r1_result?.VPscore || 0),
    vp_feedback: String(phase4Body?.vp_feedback || "").trim() || null,
    vp_scores: {
      C: Number(vpScores.C || 3),
      G: Number(vpScores.G || 3),
      E: Number(vpScores.E || 3)
    },
    vp_summary: vpSummary,
    wtp_breakdown: phase4Body?.wtp_breakdown || null,
    jinang_tech: tech
      ? { card_id: tech.jinang_id, match_strength: Number(tech.match_strength || 0), name: tech.name || tech.jinang_id }
      : null,
    jinang_market: market
      ? { card_id: market.jinang_id, match_strength: Number(market.match_strength || 0), name: market.name || market.jinang_id }
      : null,
    jinang_summary: {
      total_count: settleItems.length,
      matched_count: settleItems.filter((x) => Boolean(x?.matched)).length,
      matched_market_count: matchedMarketCount,
      matched_tech_count: matchedTechCount
    },
    P: Number(base.P || 12800),
    Pmax,
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

function createLegacyPersonaPool(memberName, gridId) {
  const group = getPersonaGroup(gridId);
  const seeds = PERSONA_SEEDS_BY_GROUP[group] || PERSONA_SEEDS_BY_GROUP.ADULT;
  const start = Math.abs(String(memberName || "").split("").reduce((a, c) => a + c.charCodeAt(0), 0)) % seeds.length;
  const pool = [];
  for (let index = 0; index < Math.min(MAX_INTERVIEWS_PER_MEMBER, seeds.length); index += 1) {
    pool.push({ ...seeds[(start + index) % seeds.length], group });
  }
  return pool;
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
  if (!round1Context?.who_raw) return null;
  return generatePersona(null, {
    teamId: round1Context.teamId,
    gridLabel: round1Context.gridLabel,
    who_raw: round1Context.who_raw,
    architectureLabel: round1Context.architectureLabel,
    isToB: round1Context.isToB,
    previousPersonas
  });
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
  return list.every((item) => isPersonaConsistentWithRound1Context(item, round1Context));
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
    if (isPersonaConsistentWithRound1Context(persona, round1Context)) continue;

    const userTurns = (Array.isArray(session.history) ? session.history : []).filter((item) => item?.role === "user").length;
    if (userTurns > 0) continue;

    const replacement = (Array.isArray(personaPool) ? personaPool : []).find((item) => {
      if (!isPersonaConsistentWithRound1Context(item, round1Context)) return false;
      return !completedIds.has(item.id);
    });
    if (!replacement) continue;

    const updated = {
      ...session,
      personas: [replacement],
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
  const existingPoolValid = round1Context
    ? isPersonaPoolConsistent(existingPool, round1Context)
    : existingPool.length > 0;
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
    const fallbackPool = createLegacyPersonaPool(row.memberName || row.memberId, team?.final_grid_id).slice(0, Math.max(targetCount, 1));
    nextAssignments[assignmentIndex] = { ...row, personaPool: fallbackPool, personaVersion: ROUND2_PERSONA_POOL_VERSION };
    return { assignments: nextAssignments, personaPool: fallbackPool };
  }

  const personaPool = seedPool.slice();
  while (personaPool.length < targetCount) {
    let nextPersona = null;
    try {
      nextPersona = await generatePersonaVariant(round1Context, personaPool);
    } catch (_) {
      nextPersona = null;
    }
    if (!nextPersona) break;
    const nextId = String(nextPersona.id || "").trim();
    if (nextId && personaPool.some((item) => String(item?.id || "").trim() === nextId)) break;
    personaPool.push(nextPersona);
  }

  if (personaPool.length === 0) {
    const fallbackPool = createLegacyPersonaPool(row.memberName || row.memberId, team?.final_grid_id).slice(0, Math.max(targetCount, 1));
    nextAssignments[assignmentIndex] = { ...row, personaPool: fallbackPool, personaVersion: ROUND2_PERSONA_POOL_VERSION };
    return { assignments: nextAssignments, personaPool: fallbackPool };
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
    return { assignments, personaPool: createLegacyPersonaPool(memberId, team?.final_grid_id).slice(0, Math.max(minCount, 1)) };
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
    INSERT INTO round2_member_selections (team_id, member_id, selections_json, updated_at)
    VALUES (
      ${sqlQuote(teamId)},
      ${sqlQuote(memberId)},
      ${sqlQuote(JSON.stringify(Array.isArray(selections) ? selections : []))},
      ${sqlQuote(now)}
    )
    ON CONFLICT(team_id, member_id) DO UPDATE SET
      selections_json = excluded.selections_json,
      updated_at = excluded.updated_at;
  `);
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
  await runSql(`
    INSERT INTO round2_interview_sessions (
      session_id, team_id, member_id, member_dims_json,
      personas_json, history_json, result_json,
      round_no, is_complete, created_at, updated_at
    ) VALUES (
      ${sqlQuote(row.session_id)},
      ${sqlQuote(row.team_id)},
      ${sqlQuote(row.member_id)},
      ${sqlQuote(JSON.stringify(row.member_dims || []))},
      ${sqlQuote(JSON.stringify(row.personas || []))},
      ${sqlQuote(JSON.stringify(row.history || []))},
      ${sqlQuote(row.result ? JSON.stringify(row.result) : null)},
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
        const tag = String(t?.tag || "").trim();
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

function pickPersonaNames(memberName, gridId) {
  return createLegacyPersonaPool(memberName, gridId);
}

function enrichPersona(persona) {
  const raw = persona && typeof persona === "object" ? persona : {};
  const allSeeds = Object.values(PERSONA_SEEDS_BY_GROUP).flat();
  const seed = allSeeds.find((item) => item.id === raw.id || item.name === raw.name) || null;
  const title = String(raw.title || raw.occupation || seed?.title || seed?.occupation || "").trim();
  const orgType = String(raw.org_type || "").trim();
  const orgScale = String(raw.org_scale || "").trim();
  const livingSituation = String(raw.living_situation || seed?.living_situation || [orgType, orgScale].filter(Boolean).join("，")).trim();
  const desc = String(raw.desc || seed?.desc || [title, orgType, raw.personality].filter(Boolean).join("，")).trim();
  return {
    ...(seed || {}),
    ...raw,
    id: String(raw.id || seed?.id || raw.name || "persona").trim(),
    group: String(raw.group || seed?.group || "").trim(),
    name: String(raw.name || seed?.name || "访谈对象").trim(),
    age: Number(raw.age || seed?.age || 0),
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
  const org = [safePersona.org_type, safePersona.org_scale].filter(Boolean).join("，");
  const living = safePersona.living_situation || org || "平时主要在家和工作两头跑";
  const pressures = Array.isArray(safePersona.pressures) ? safePersona.pressures.filter(Boolean) : [];

  if (safePersona.org_type || safePersona.title) {
    const pressureText = pressures[0] ? `最近最头疼的是${pressures[0]}。` : "最近手上的运营压力一直在堆。";
    return `我现在负责${occupation}，所在机构是${living}。${pressureText} 比起先谈产品，我更愿意先把真实场景和决策压力说清楚。`;
  }

  if (occupation.includes("护工")) {
    return `我平时做${occupation}，${living}。白天经常要在几个照护对象之间来回跑，最怕临时有状况撞在一起。对我来说，先把日常照看里的麻烦和压力聊清楚会更有意义。`;
  }
  if (occupation.includes("财务") || living.includes("孩子")) {
    return `我平时做${occupation}，${living}。工作和家里的事情常常挤在一起，最头疼的是一忙起来就顾不过来。比起先谈产品，我更想先说说哪些时刻最容易手忙脚乱。`;
  }
  if (occupation.includes("退休") || living.includes("独居")) {
    return `我现在是${occupation}，${living}。平时生活节奏比较固定，但真碰到一个人不太方便的时候，会特别在意安心和别太折腾。要不我先和你说说我平常最在意的几个场景。`;
  }
  return `我平时是${occupation}，${living}。日常里最在意的是别给自己添太多负担，真有事的时候也能稳得住。我们可以先从我平常怎么生活、哪些时候最麻烦开始聊。`;
}

function enforceLifeFirstReply(reply, persona, productIntroduced) {
  if (productIntroduced) return String(reply || "").trim();
  const text = String(reply || "").trim();
  if (!text) return buildLifeAnchoredReply(persona);
  if (PRODUCT_TERMS_RE.test(text)) return buildLifeAnchoredReply(persona);
  if (/[？?]/.test(text)) return buildLifeAnchoredReply(persona);
  return text;
}

function sanitizeInterviewHistory(history, persona) {
  const list = normalizeInterviewHistory(history);
  let productIntroduced = false;
  return list.map((item) => {
    if (item?.role === "user") {
      if (PRODUCT_TERMS_RE.test(String(item?.text || ""))) {
        productIntroduced = true;
      }
      return item;
    }
    return {
      ...item,
      text: enforceLifeFirstReply(item?.text, persona, productIntroduced)
    };
  });
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
  return {
    sessionId: session.session_id,
    teamId: session.team_id,
    memberId: session.member_id,
    memberDims: Array.isArray(session.member_dims) ? session.member_dims : [],
    persona,
    personas,
    history,
    result: session.result || null,
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

  const teamState = await getTeamRound2State(teamId);
  const everyoneDone = (teamState?.members || []).every((item) => {
    if (item.id === memberId) return interviewStatus === "completed";
    return item.interviewStatus === "completed";
  });
  await updateTeamRound2Status(teamId, everyoneDone ? "R2_INDIVIDUAL_CARDS" : "R2_INTERVIEWING");

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
  const channel = channelRaw === "TOB" ? "B2B" : "B2C";
  const strategy = strategyRaw.includes("COST") ? "Cost" : "Differentiation";

  const archRaw = String(architecture || "").trim().toLowerCase();
  let focus = "Experience";
  if (archRaw === "hybrid") focus = "Mixed";
  if (archRaw === "function") focus = "Function";
  return `${channel}_${strategy}_${focus}`;
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
  const marketInfo = getRound2MarketInfo(row.best_grid || storedResult.best_grid || "");
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
    units: row.units == null ? null : Number(row.units),
    profit: row.profit == null ? null : Number(row.profit),
    profit_per_unit: row.profit_per_unit == null ? null : Number(row.profit_per_unit),
    vscore: row.vscore == null ? null : Number(row.vscore),
    best_grid: row.best_grid || null,
    market_size_yi: marketSizeYi,
    hhi,
    hhi_label: hhiLabel,
    result: {
      ...storedResult,
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
      team_id, session_id, price, selections_json, cards_json, card_count,
      dcogs, risk_total, best_grid, submitted_at
    ) VALUES (
      ${sqlQuote(teamId)},
      ${sqlQuote(sessionId)},
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
      price = EXCLUDED.price,
      selections_json = EXCLUDED.selections_json,
      cards_json = EXCLUDED.cards_json,
      card_count = EXCLUDED.card_count,
      dcogs = EXCLUDED.dcogs,
      risk_total = EXCLUDED.risk_total,
      best_grid = EXCLUDED.best_grid,
      submitted_at = EXCLUDED.submitted_at;

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

    INSERT INTO round2_results (
      team_id, session_id, units, profit, profit_per_unit,
      vscore, best_grid, result_json, computed_at
    ) VALUES (
      ${sqlQuote(teamId)},
      ${sqlQuote(sessionId)},
      ${result.units == null ? "NULL" : Number(result.units)},
      ${result.profit == null ? "NULL" : Number(result.profit)},
      ${result.profit_per_unit == null ? "NULL" : Number(result.profit_per_unit)},
      ${result.vscore == null ? "NULL" : Number(result.vscore)},
      ${sqlQuote(result.best_grid || null)},
      ${sqlQuote(JSON.stringify(result.result || {}))},
      ${sqlQuote(result.computed_at || now)}
    )
    ON CONFLICT(team_id, session_id) DO UPDATE SET
      units = EXCLUDED.units,
      profit = EXCLUDED.profit,
      profit_per_unit = EXCLUDED.profit_per_unit,
      vscore = EXCLUDED.vscore,
      best_grid = EXCLUDED.best_grid,
      result_json = EXCLUDED.result_json,
      computed_at = EXCLUDED.computed_at;
  `);
}

async function computeStoredTeamResult(teamId, sessionId, submissionInput, radarInput) {
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
    team_final_wtp_adj: Number(team?.final_wtp_adj || 0),
    team_final_wtp_ref: Number(team?.final_wtp_ref || 0),
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
    COGSbase: Number(recapData.COGSbase || 2000),
    TAM: Number(recapData.TAM || 50000),
    H: Number(recapData.H || 0.3),
    wtp_multiplier: Number(team?.final_wtp_multiplier || 1),
    WTPref_override: Number(team?.final_wtp_ref || 0) || undefined,
    teamId,
    sessionId,
    source: "web"
  });

  const profitPerUnit = Number(calcResult.units || 0) > 0
    ? Math.round(Number(calcResult.profit || 0) / Number(calcResult.units || 1))
    : 0;
  const bestGrid = String(submission.best_grid || recapData.final_grid_id || "");
  const marketInfo = getRound2MarketInfo(recapData.final_grid_id || bestGrid || calcGridId);
  const resultPayload = {
    ...calcResult,
    market_size_yi: marketInfo.market_size_yi,
    hhi: marketInfo.hhi,
    hhi_label: marketInfo.hhi_label
  };
  const result = {
    team_id: teamId,
    session_id: sessionId,
    units: Number(calcResult.units || 0),
    profit: Number(calcResult.profit || 0),
    profit_per_unit: profitPerUnit,
    vscore: Number(calcResult.V || 0),
    best_grid: bestGrid,
    best_grid_label: inferBestGridLabel(bestGrid),
    market_size_yi: marketInfo.market_size_yi,
    hhi: marketInfo.hhi,
    hhi_label: marketInfo.hhi_label,
    result: resultPayload,
    computed_at: nowIso()
  };

  const nextSubmission = {
    ...submission,
    dcogs: Number(calcResult.dCOGS || 0),
    risk_total: Number(calcResult.risk || 0),
    card_count: Array.isArray(submission.selections) ? submission.selections.length : Number(submission.card_count || 0),
    best_grid: bestGrid,
    cards: Array.isArray(submission.cards) && submission.cards.length ? submission.cards : buildCardSummary(submission.selections),
    submitted_at: submission.submitted_at || nowIso()
  };
  const nextRadar = {
    radar: normalizeRadarPayload(radar.radar),
    tags: Array.isArray(radar.tags) ? radar.tags : [],
    evi: Number.isFinite(Number(radar.evi)) ? Number(radar.evi) : 0.7,
    updated_at: radar.updated_at || nowIso()
  };

  await persistTeamSnapshot(teamId, sessionId, nextSubmission, nextRadar, result);
  return {
    submission: nextSubmission,
    radar: nextRadar,
    result
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

    const p4 = await TeamRoutes.phase4Data(teamId);
    if (!p4?.body?.ok) {
      return makeResponse(p4?.status || 400, p4?.body || { ok: false, error: "phase4 unavailable" });
    }

    const data = await buildRound2Recap(teamId, p4.body);
    return makeResponse(200, { ok: true, ...data });
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

    const memberCount = Number(body?.memberCount || listTeamMembers(team).length || 4);
    const assignments = await buildAssignments(team, memberCount);
    await saveAssignments(teamId, assignments);

    return makeResponse(200, { ok: true, assignments });
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
    const member = listTeamMembers(team).find((m) => m.id === memberId);
    const assignments = await ensureAssignments(team);
    const row = assignments.find((x) => x.memberId === memberId);
    const memberDims = Array.isArray(body?.memberDims) && body.memberDims.length ? body.memberDims : (row?.dims || ["interaction", "safety"]);
    const { personaPool } = await ensureMemberPersonaPool(team, member?.id || memberId, 1);
    const personas = [personaPool[0] || null].filter(Boolean);
    const history = generateAutoHistory(personas, memberDims);
    const recapRes = await recap({ teamId });
    const gridId = recapRes?.body?.final_grid_id || "B2B_Differentiation_Experience";
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
      round_no: 3,
      is_complete: true,
      created_at: nowIso(),
      updated_at: nowIso()
    });

    const syncResult = await syncMemberInterviewState(teamId, memberId);

    return makeResponse(200, {
      ok: true,
      sessionId,
      personas,
      transcript: history,
      round: 3,
      isComplete: true,
      canEnd: true,
      reachedLimit: false,
      radar: result.radar,
      tags: result.tags,
      evi: result.evi,
      confidence: result.confidence,
      lowConfidenceDims: result.lowConfidenceDims,
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
    const member = listTeamMembers(team).find((m) => m.id === memberId);
    const assignments = await ensureAssignments(team);
    const row = assignments.find((x) => x.memberId === memberId);
    const memberDims = Array.isArray(body?.memberDims) && body.memberDims.length ? body.memberDims : (row?.dims || ["interaction", "safety"]);
    const forceNew = body?.forceNew === true;
    let sessions = await listInterviewSessionsForMember(teamId, memberId);
    const completedSessions = sessions.filter((item) => item.is_complete);
    const { personaPool } = await ensureMemberPersonaPool(team, member?.id || memberId, Math.min(MAX_INTERVIEWS_PER_MEMBER, completedSessions.length + 1));
    sessions = await repairStaleInterviewSessions(team, member?.id || memberId, sessions, personaPool);
    const progress = buildMemberInterviewProgress(sessions, personaPool);
    const activeSession = sessions.find((item) => !item.is_complete) || null;

    if (activeSession && !forceNew) {
      return makeResponse(200, {
        ok: true,
        ...serializeSession(activeSession),
        maxRounds: MAX_INTERVIEW_TURNS,
        minTurnsToEnd: MIN_TURNS_TO_END,
        progress,
        dimensionGuide: buildDimensionGuide(memberDims)
      });
    }

    if (progress.reachedInterviewLimit) {
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

    const nextPersona = progress.nextPersona || personaPool[progress.completedCount] || personaPool[0];
    const personas = [nextPersona].filter(Boolean);

    const sessionId = `r2_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    const history = [];
    await saveInterviewSession({
      session_id: sessionId,
      team_id: teamId,
      member_id: memberId,
      member_dims: memberDims,
      personas,
      history,
      result: null,
      round_no: 0,
      is_complete: false,
      created_at: nowIso(),
      updated_at: nowIso()
    });

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

    if (session.is_complete) {
      return makeResponse(200, {
        ok: true,
        reply: "访谈已完成，可以进入选卡。",
        round: session.round_no,
        isComplete: true,
        radar: session.result?.radar,
        tags: session.result?.tags,
        evi: session.result?.evi
      });
    }

    const personas = enrichPersonas(session.personas);
    const persona = personas[0] || null;
    const historyBase = sanitizeInterviewHistory(session.history, persona);
    const round = historyBase.filter((item) => item.role === "user").length + 1;
    const speaker = persona?.name || "访谈对象";
    const recapRes = await recap({ teamId: session.team_id });
    const recapData = recapRes?.body?.ok ? recapRes.body : {};
    const gridDesc = String(recapData.final_grid_id || "ToB_Differentiation_Elder_Experience");
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
        : `${systemPrompt}\n\n【当前轮额外约束】学生还没有介绍具体产品。你这轮只能聊自己的生活、困扰、期待和真实场景，不能提 LOVOT、机器人、产品、功能，也不能反问学生。`
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

    let reply = "对我来说，平时相处起来别太折腾最重要。真遇到状况的时候也得靠谱，不然我很难长期接受。";
    try {
      const out = await withLlmLogging({
        caller: "round2Routes.interviewReply",
        teamId: session?.team_id || session?.teamId || null,
        memberId: session?.member_id || session?.memberId || null,
        messages: llmMessages
      }, () => chatCompletion(llmMessages, { temperature: 0.7, max_tokens: 300 }));
      if (String(out || "").trim()) reply = String(out).trim();
    } catch (_) {}
    reply = enforceLifeFirstReply(reply, persona, productIntroduced);

    const history = [...historyBase, { role: "user", speaker: "学生", text: message }, { role: "assistant", speaker, text: reply }];
    const isComplete = round >= MAX_INTERVIEW_TURNS;
    const result = isComplete
      ? await extractInterviewResult({
          gridId: String(recapData.final_grid_id || "B2B_Differentiation_Experience"),
          architecture: String(recapData.architecture || ""),
          memberDims: session.member_dims,
          history
        })
      : null;

    await saveInterviewSession({
      ...session,
      history,
      round_no: round,
      is_complete: isComplete,
      result,
      updated_at: nowIso()
    });

    const syncResult = await syncMemberInterviewState(session.team_id, session.member_id);

    return makeResponse(200, {
      ok: true,
      reply,
      speaker,
      round,
      isComplete,
      canEnd: round >= MIN_TURNS_TO_END,
      reachedLimit: round >= MAX_INTERVIEW_TURNS,
      radar: result?.radar,
      tags: result?.tags,
      evi: result?.evi,
      confidence: result?.confidence,
      lowConfidenceDims: result?.lowConfidenceDims,
      insightsByDim: result?.insightsByDim,
      scoreSource: result?.scoreSource,
      summary: result?.summary,
      progress: syncResult.progress,
      completedInterview: isComplete ? syncResult.progress.latestCompletedInterview : null
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
    if (session.is_complete) {
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
        radar: session.result?.radar,
        tags: session.result?.tags,
        evi: session.result?.evi,
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
      gridId: String(recapData.final_grid_id || "B2B_Differentiation_Experience"),
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
    const responseBody = {
      ok: true,
      round,
      isComplete: true,
      endedBy: "manual",
      radar: result?.radar,
      tags: result?.tags,
      evi: result?.evi,
      confidence: result?.confidence,
      lowConfidenceDims: result?.lowConfidenceDims,
      insightsByDim: result?.insightsByDim,
      scoreSource: result?.scoreSource,
      summary: result?.summary,
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
    const member = listTeamMembers(team).find((item) => item.id === memberId);
    let sessions = await listInterviewSessionsForMember(teamId, memberId);
    const completedSessions = sessions.filter((item) => item.is_complete);
    const { personaPool } = await ensureMemberPersonaPool(team, member?.id || memberId, Math.min(MAX_INTERVIEWS_PER_MEMBER, completedSessions.length + 1));
    sessions = await repairStaleInterviewSessions(team, member?.id || memberId, sessions, personaPool);
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
    const selections = Array.isArray(body?.selections) ? body.selections : [];
    if (!teamId || !memberId) return makeResponse(400, { ok: false, error: "teamId/memberId required" });
    await saveMemberSelections(teamId, memberId, selections);
    await updateMemberProgress(teamId, memberId, {
      card_status: "submitted",
      cards_selected: selections.length,
      current_step: "waiting_merge",
      last_activity_at: nowIso()
    });

    const teamState = await getTeamRound2State(teamId);
    const everyoneSubmitted = (teamState?.members || []).every((member) => {
      if (member.id === memberId) return true;
      return member.cardStatus === "submitted";
    });
    await updateTeamRound2Status(teamId, everyoneSubmitted ? "R2_TEAM_MERGE" : "R2_INDIVIDUAL_CARDS");

    return makeResponse(200, { ok: true, teamId, memberId, count: selections.length });
  } catch (e) {
    return makeResponse(400, { ok: false, error: e.message });
  }
}

async function mergeApi(body) {
  try {
    const teamId = String(body?.teamId || "").trim();
    const memberId = String(body?.memberId || body?.member_id || "").trim();
    if (!teamId) return makeResponse(400, { ok: false, error: "teamId required" });
    let team = await getTeam(teamId);
    if (!team) return makeResponse(404, { ok: false, error: "team not found" });
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
    const softPenalties = computeSoftPenalties(teamSelections, Number(body?.COGSbase || 2000));
    const interviewByMember = await getLatestInterviewByMember(teamId);
    const mergedInterview = aggregateInterviewByOwner({ assignments, memberMap, interviewByMember });
    const totalCost = teamSelections.reduce((sum, sel) => {
      try {
        return sum + Number(getCapabilityParams(sel.cap_id, sel.tier)?.dCOGS || 0);
      } catch (_) {
        return sum;
      }
    }, 0);

    await updateTeamRound2Status(teamId, "R2_TEAM_MERGE");
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
      team_draft: draft,
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

    const permission = await ensureRound2LeaderPermission(teamId, memberId);
    if (!permission.ok) return permission.response;

    const patch = {};
    if (body?.price !== undefined) {
      const price = Number(body.price);
      if (!Number.isFinite(price) || price <= 0) {
        return makeResponse(400, { ok: false, error: "valid price required" });
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

    const radar = normalizeRadarPayload(body?.radar || body?.mergedInterview?.radar || {});
    const tags = Array.isArray(body?.tags)
      ? body.tags
      : Array.isArray(body?.mergedInterview?.tags)
        ? body.mergedInterview.tags
        : [];
    const evi = Number.isFinite(Number(body?.evi))
      ? Number(body.evi)
      : Number.isFinite(Number(body?.mergedInterview?.evi))
        ? Number(body.mergedInterview.evi)
        : 0.7;
    const bestGrid = String(body?.bestGrid || body?.best_grid || team.final_grid_id || "").trim();

    const submission = {
      team_id: teamId,
      session_id: sessionId,
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
      radar: snapshot.radar,
      result: snapshot.result,
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
    return makeResponse(200, {
      ok: true,
      team_id: teamId,
      session_id: sessionId,
      submission: snapshot?.submission || null,
      radar: snapshot?.radar || null,
      result: snapshot?.result || null
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

    const team = await getTeam(teamId);
    if (!team) return makeResponse(404, { ok: false, error: "team not found" });
    await ensureAssignments(team);

    const teamState = await getTeamRound2State(teamId);
    if (!teamState) return makeResponse(404, { ok: false, error: "team not found" });
    const teamDraft = await readRound2TeamDraft(teamId);
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

    return makeResponse(200, {
      ok: true,
      team_id: teamId,
      team_status: teamState.r2.status,
      team_status_label: teamState.r2.statusLabel,
      entered_at: teamState.r2.enteredAt,
      duration_minutes: teamState.r2.durationMinutes,
      ...buildLeaderMeta(teamState, memberId),
      team_draft: teamDraft,
      round1_context: round1Context,
      member: member
        ? {
            id: member.id,
            name: member.name,
            dims: Array.isArray(member.dims) ? member.dims : [],
            interview_status: member.interviewStatus,
            interview_rounds: member.interviewRounds,
            completed_interviews: Number(member.completedInterviews || 0),
            card_status: member.cardStatus,
            cards_selected: member.cardsSelected,
            current_step: member.currentStep,
            forced_by_teacher: member.forcedByTeacher,
            is_leader: Boolean(memberId && member.id === teamState.leaderMemberId)
          }
        : null,
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
      }, () => chatCompletion(messages, { temperature: 0.3, max_tokens: 600 }));
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
  normalizeSelectionsPayload,
  buildCardSummary,
  toCalcGridId,
  saveTeamDraftApi,
  teamSubmitApi,
  teamResultApi,
  teamStatusApi,
  getTeamResultSnapshot,
  recap,
  assignDimensionsApi,
  interviewAuto,
  interviewSessionApi,
  interviewStart,
  interviewEnd,
  interviewReply,
  saveMemberSelectionApi,
  mergeApi,
  reflectionApi,
  __test: {
    getRound2ChannelFeeByGrid,
    getPriorRadarByGrid,
    buildAssignments,
    buildExtractInterviewMessages,
    cleanExtractedPayload,
    inferWeakEvidenceFromConversation,
    mapEvidenceToResult,
    isPersonaConsistentWithRound1Context
  }
};
