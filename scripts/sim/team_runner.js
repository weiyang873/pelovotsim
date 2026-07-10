"use strict";

const fs = require("fs");
const path = require("path");
const { CAP_GROUPS, GLOBAL_PARAMS, NRE_TIER_MULT, PRICE_SCALE, validateSelections } = require("../../server/llm/rdCalculator");
const { toCalcGridId } = require("../../server/routes/round2Routes");
const { chatCompletion } = require("../../server/llm/deepseekClient");
const { ApiError } = require("./api_client");
const { DeepSeekStudent } = require("./deepseek_student");
const { DecisionTracker, scoreProduct } = require("./decision_tracker");
const { PersonaStudent } = require("./persona_student");
const { getStudentGridChoice } = require("./persona_pool");
const {
  assert,
  createTeamResult,
  finishResult,
  runStep,
  skip,
  warn
} = require("./assertions");

const DIM_TO_GROUP = {
  interaction: "interaction_expression",
  perception: "perception_understanding",
  motion: "mobility_navigation",
  safety: "safety_trust",
  extend: "expand_connect",
  ops: "ops_maintenance"
};

const DIM_LABELS = {
  interaction: "交互与表达",
  perception: "感知与理解",
  motion: "移动与导航",
  safety: "安全与信任",
  extend: "扩展与连接",
  ops: "运维与维护"
};

let lastSummaryLlMAt = 0;

const GROUP_TO_CARDS = new Map(
  (CAP_GROUPS.groups || []).map((group) => [
    group.group_id,
    (group.capabilities || []).map((cap) => cap.cap_id)
  ])
);

const CAPABILITY_BY_ID = new Map(
  (CAP_GROUPS.groups || []).flatMap((group) => (
    (group.capabilities || []).map((cap) => [cap.cap_id, cap])
  ))
);

const SAFE_GROUP_CARDS = {
  interaction_expression: ["music_companion", "voice_basic", "touch_hug"],
  perception_understanding: ["perception_base", "memory_album", "adaptive_learning"],
  mobility_navigation: ["basic_avoidance", "follow_mode"],
  safety_trust: ["privacy_trust", "family_guardian", "child_safety"],
  expand_connect: ["cloud_update", "api_iot", "edu_content"],
  ops_maintenance: ["self_diag", "remote_monitor", "predictive_maint"]
};

const DEFAULT_PRICING_UI = {
  price_min: 1000,
  price_max: 6000,
  price_step: 100,
  default_price: 3500
};

function loadPricingUiConfig() {
  const fp = path.join(__dirname, "..", "..", "game_config_v0.1", "round2_engine_params.json");
  let raw = {};
  try {
    raw = JSON.parse(fs.readFileSync(fp, "utf8"));
  } catch (_) {
    raw = {};
  }
  const src = raw.pricing_ui && typeof raw.pricing_ui === "object" ? raw.pricing_ui : {};
  const min = Number(src.price_min ?? DEFAULT_PRICING_UI.price_min);
  const max = Number(src.price_max ?? DEFAULT_PRICING_UI.price_max);
  const step = Number(src.price_step ?? DEFAULT_PRICING_UI.price_step);
  const defaultPrice = Number(src.default_price ?? DEFAULT_PRICING_UI.default_price);
  if (!Number.isFinite(min) || !Number.isFinite(max) || !Number.isFinite(step) || !Number.isFinite(defaultPrice) || min <= 0 || max <= min || step <= 0) {
    throw new Error("round2 pricing_ui config invalid");
  }
  return {
    price_min: min,
    price_max: max,
    price_step: step,
    default_price: Math.max(min, Math.min(max, defaultPrice))
  };
}

function roundMoney(value, digits = 0) {
  const num = Number(value);
  if (!Number.isFinite(num)) return 0;
  const factor = 10 ** digits;
  return Math.round(num * factor) / factor;
}

function summarizeSelectionCosts(selections, cogsBase) {
  let dCOGSTotal = 0;
  let nreTotalWan = 0;
  const missing = [];

  for (const item of Array.isArray(selections) ? selections : []) {
    const capId = String(item?.cap_id || "").trim();
    const tier = String(item?.tier || "mid").trim() || "mid";
    const cap = CAPABILITY_BY_ID.get(capId);
    const tierParams = cap?.tiers?.[tier] || {};
    if (!cap) {
      missing.push(capId);
      continue;
    }
    dCOGSTotal += Number(tierParams.dCOGS || 0);
    nreTotalWan += Number(cap.nre || 0) * Number(NRE_TIER_MULT[tier] || 1);
  }

  const baseVariableCost = roundMoney(cogsBase || 600, 0);
  const fbaseWan = roundMoney(Number(GLOBAL_PARAMS.F || 0) / 10000, 2);
  const roundedDCOGS = roundMoney(dCOGSTotal, 0);
  const roundedNREWan = roundMoney(nreTotalWan, 2);

  return {
    baseVariableCost,
    dCOGSTotal: roundedDCOGS,
    unitVariableCost: roundMoney(baseVariableCost + roundedDCOGS, 0),
    fbaseWan,
    nreTotalWan: roundedNREWan,
    upfrontInvestmentWan: roundMoney(fbaseWan + roundedNREWan, 2),
    missingCapabilityIds: missing
  };
}

const PRICING_EVIDENCE_KEYWORDS = [
  "价格",
  "预算",
  "贵",
  "便宜",
  "支付",
  "付费",
  "花钱",
  "愿意",
  "买",
  "采购",
  "审批",
  "性价比",
  "投入产出",
  "人力成本",
  "回本",
  "万元",
  "千元",
  "元"
];

function containsPricingEvidence(text) {
  const source = String(text || "");
  return PRICING_EVIDENCE_KEYWORDS.some((keyword) => source.includes(keyword));
}

function trimEvidenceText(text, maxLen = 120) {
  const source = String(text || "").replace(/\s+/g, " ").trim();
  if (source.length <= maxLen) return source;
  return `${source.slice(0, maxLen - 1)}…`;
}

function buildPricingDemandSummary(tracker, maxItems = 6) {
  const evidence = [];
  const members = Object.values(tracker?.members || {}).sort((a, b) => {
    return Number(a.memberIndex || 0) - Number(b.memberIndex || 0);
  });

  for (const member of members) {
    for (const item of Array.isArray(member.interviewLog) ? member.interviewLog : []) {
      if (item.role !== "interviewee") continue;
      if (!containsPricingEvidence(item.message_text)) continue;
      const who = item.interview_persona_name || `受访者${item.interview_persona_id || ""}` || "受访者";
      evidence.push(`- ${who}：${trimEvidenceText(item.message_text)}`);
      if (evidence.length >= maxItems) break;
    }
    if (evidence.length >= maxItems) break;
  }

  if (evidence.length > 0) {
    return evidence.join("\n");
  }

  const summaries = members
    .map((member) => String(member.r2_interview_summary || "").trim())
    .filter(Boolean);
  if (summaries.length > 0) {
    return Array.from(new Set(summaries)).slice(0, 4).map((item) => `- 访谈摘要标签：${item}`).join("\n");
  }

  return "- 未记录到明确的消费能力或价格态度原话；请只根据已获得的客户痛点、采购语境和成本信息定价。";
}

function parseJsonObjectLocal(text) {
  const raw = String(text || "").replace(/```json|```/g, "").trim();
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  const candidate = start >= 0 && end > start ? raw.slice(start, end + 1) : raw;
  try {
    return JSON.parse(candidate);
  } catch (_) {
    return JSON.parse(candidate.replace(/[\u0000-\u001F]+/g, " "));
  }
}

async function rateLimitedSummaryChat(messages, options = {}) {
  const maxAttempts = 3;
  let lastErr = null;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const now = Date.now();
    const waitMs = Math.max(0, 220 - (now - lastSummaryLlMAt));
    const retryWaitMs = attempt === 0 ? 0 : 1500 * attempt;
    if (waitMs + retryWaitMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, waitMs + retryWaitMs));
    }
    try {
      const out = await chatCompletion(messages, options);
      lastSummaryLlMAt = Date.now();
      return out;
    } catch (err) {
      lastErr = err;
      const message = String(err?.message || err || "");
      const transient = /ENOTFOUND|ECONNRESET|ETIMEDOUT|EAI_AGAIN|429|5\d\d/i.test(message);
      if (!transient || attempt === maxAttempts - 1) {
        throw err;
      }
    }
  }
  throw lastErr;
}

function logActorLLM(actor, entry) {
  if (actor && typeof actor.logStudentLLM === "function") {
    actor.logStudentLLM(entry);
  }
}

async function requestStrictJson(actor, messages, options, meta, validate) {
  if (!process.env.DEEPSEEK_API_KEY && !process.env.DEEPSEEK_API_KEY_1) {
    throw new Error(`${meta.step}: DeepSeek API key missing`);
  }

  let activeMessages = messages;
  let completion = "";
  let lastErr = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const startedAt = Date.now();
    try {
      completion = String(await rateLimitedSummaryChat(activeMessages, {
        model: "deepseek-chat",
        temperature: options.temperature,
        max_tokens: options.max_tokens
      }) || "").trim();
      const data = parseJsonObjectLocal(completion);
      const validated = validate ? validate(data) : { ok: true, value: data };
      if (validated && validated.ok === true) {
        logActorLLM(actor, {
          caller: meta.caller,
          step: meta.step,
          prompt: activeMessages,
          completion,
          durationMs: Date.now() - startedAt,
          usedFallback: false
        });
        return validated.value;
      }
      lastErr = new Error(validated?.error || "invalid JSON payload");
    } catch (err) {
      lastErr = err;
    }

    if (attempt >= 2) break;
    activeMessages = [
      ...messages,
      { role: "assistant", content: completion || "(空输出)" },
      {
        role: "user",
        content: [
          `上一次输出无法通过校验：${String(lastErr?.message || lastErr || "")}`,
          "请只输出同一决策的合法 JSON，不要 Markdown，不要解释。"
        ].join("\n")
      }
    ];
  }
  throw new Error(`${meta.step} failed after retries: ${String(lastErr?.message || lastErr || "")}`);
}

function flattenCardsPayloadLocal(cards) {
  const groups = Array.isArray(cards?.groups) ? cards.groups : [];
  const catalog = [];
  for (const group of groups) {
    for (const capability of group.capabilities || []) {
      catalog.push({
        cap_id: capability.cap_id,
        name: capability.name,
        dimension: group.name || group.group_id,
        dimensionId: group.group_id,
        covers: Array.isArray(capability.covers) ? capability.covers : [],
        tiers: {
          low: capability.tiers?.low
            ? { dCOGS: capability.tiers.low.dCOGS, risk: capability.tiers.low.risk, nre: capability.nre }
            : null,
          mid: capability.tiers?.mid
            ? { dCOGS: capability.tiers.mid.dCOGS, risk: capability.tiers.mid.risk, nre: capability.nre }
            : null,
          high: capability.tiers?.high
            ? { dCOGS: capability.tiers.high.dCOGS, risk: capability.tiers.high.risk, nre: capability.nre }
            : null
        }
      });
    }
  }
  return catalog;
}

function normalizeCardSelectionsLocal(rawSelections, validCards) {
  const out = [];
  const seen = new Set();
  const list = Array.isArray(rawSelections) ? rawSelections : [];
  for (const item of list) {
    const capId = String(item?.cap_id || "").trim();
    const tier = String(item?.tier || "").trim().toLowerCase();
    if (!capId || seen.has(capId)) continue;
    const card = validCards.get(capId);
    if (!card) continue;
    if (!["low", "mid", "high"].includes(tier) || !card.tiers?.[tier]) continue;
    out.push({
      cap_id: capId,
      tier,
      reason: String(item?.reason || "").trim()
    });
    seen.add(capId);
  }
  return out;
}

function reportTitle(report, fallbackIndex) {
  return String(report?.persona_name || report?.persona_id || report?.title || `P${fallbackIndex + 1}`).trim();
}

function reportText(report) {
  return String(report?.report_text || report?.text || report?.summary_text || "").trim();
}

function buildReportsInput(readReports) {
  const reports = Array.isArray(readReports) ? readReports : [];
  if (!reports.length) {
    return "你还没有读到任何客户调研报告。";
  }
  return reports.map((item, idx) => {
    const report = item.report || {};
    return [
      `### 已读报告 ${idx + 1}：${reportTitle(report, item.report_index ?? idx)}`,
      reportText(report)
    ].join("\n");
  }).join("\n\n");
}

function buildPricingDemandSummaryFromReports(memberReports, maxItems = 8) {
  const evidence = [];
  const seen = new Set();
  for (const item of memberReports || []) {
    const memberName = item.memberName || "成员";
    for (const reportItem of item.reports || []) {
      const report = reportItem.report || {};
      const lines = reportText(report).split(/\n+/).map((line) => line.trim()).filter(Boolean);
      for (const line of lines) {
        if (!containsPricingEvidence(line)) continue;
        const key = trimEvidenceText(line, 90);
        if (seen.has(key)) continue;
        seen.add(key);
        evidence.push(`- ${memberName}读到的${reportTitle(report, reportItem.report_index || 0)}：${trimEvidenceText(line)}`);
        if (evidence.length >= maxItems) break;
      }
      if (evidence.length >= maxItems) break;
    }
    if (evidence.length >= maxItems) break;
  }
  if (evidence.length > 0) return evidence.join("\n");
  return "- 已读调研报告中没有直接价格原话；请只根据报告里的生活/采购语境和成本信息定价。";
}

function resolveSummarySessionId(options, stateData) {
  return String(options.sessionId || options.session_id || stateData?.session_id || process.env.SESSION_ID || "default").trim() || "default";
}

function resolveExplicitSessionId(options) {
  return String(options.sessionId || options.session_id || process.env.SESSION_ID || "").trim();
}

function buildSummaryQuery(params) {
  const query = new URLSearchParams();
  Object.entries(params || {}).forEach(([key, value]) => {
    if (value !== undefined && value !== null && String(value) !== "") {
      query.set(key, String(value));
    }
  });
  return query.toString();
}

function normalizeInterviewMode(stateData) {
  const raw = String(stateData?.session_config?.interview_mode || stateData?.interview_mode || "summary").trim().toLowerCase();
  return raw === "live" ? "live" : "summary";
}

function memberDisplayName(member, fallbackIndex) {
  return String(member?.member_name || member?.name || member?.memberName || `成员${fallbackIndex + 1}`).trim();
}

async function askContinueReading(actor, context) {
  const messages = [
    { role: "system", content: typeof actor?.buildLayeredSystemPrompt === "function" ? actor.buildLayeredSystemPrompt() : "你是一位认真的 EMBA 学员，请按自己的判断完成团队任务。" },
    {
      role: "user",
      content: [
        "## 当前任务：客户调研报告阅读决策",
        "你面前有 3 份客户调研报告。你已经读了至少 1 份，时间有限，你的队友也在读。",
        "你需要决定是否继续查看下一位受访者的报告。",
        "",
        `## 你的已读进度`,
        `- 已读：${context.readCount}/3 份`,
        `- 下一份：${context.nextLabel}`,
        "",
        "## 你已经读过的报告",
        buildReportsInput(context.readReports),
        "",
        "请根据你的课堂画像、时间意识和信息需求做决定。",
        "只输出可 JSON.parse 的 JSON：",
        '{ "continue": true, "reason": "一句话理由" }'
      ].join("\n")
    }
  ];

  return requestStrictJson(actor, messages, {
    temperature: 0.45,
    max_tokens: 500
  }, {
    caller: "team_runner.askContinueReading",
    step: "R2.summary_read_decision"
  }, (data) => {
    if (typeof data?.continue !== "boolean") {
      return { ok: false, error: "continue must be boolean" };
    }
    return {
      ok: true,
      value: {
        continue: data.continue,
        reason: String(data.reason || "").trim()
      }
    };
  });
}

async function generateSummaryCardSelection(actor, context) {
  const cardCatalog = flattenCardsPayloadLocal(context.cards);
  const validCards = new Map(cardCatalog.map((card) => [card.cap_id, card]));
  const assignedDims = (Array.isArray(context.assignedDims) ? context.assignedDims : [])
    .map((dim) => ({ id: dim, label: DIM_LABELS[dim] || dim }));
  const validationIssues = normalizeViolationsList(context.validationIssues);
  const previousSelections = Array.isArray(context.previousSelections) ? context.previousSelections : [];
  const messages = [
    { role: "system", content: typeof actor?.buildLayeredSystemPrompt === "function" ? actor.buildLayeredSystemPrompt() : "你是一位认真的 EMBA 学员，请按自己的判断完成团队任务。" },
    {
      role: "user",
      content: [
        "## 当前任务：根据你实际读过的客户调研报告选择研发能力卡",
        "你只知道下面这些自己实际读过的报告。没有读过的报告不要假设、不要补全。",
        "",
        "## 你实际读过的报告原文",
        buildReportsInput(context.readReports),
        "",
        validationIssues.length > 0 ? [
          "## 你上次的选卡组合有以下问题",
          validationIssues.map((item) => `- ${String(item?.message || item || "").trim()}`).filter(Boolean).join("\n"),
          "",
          "请修正后重新选卡，优先消除依赖或冲突问题。"
        ].join("\n") : "",
        previousSelections.length > 0 ? [
          "## 你上次提交的选卡",
          JSON.stringify(previousSelections, null, 2)
        ].join("\n") : "",
        "",
        "## 你负责的维度",
        assignedDims.length > 0
          ? assignedDims.map((dim) => `- ${dim.label}（${dim.id}）`).join("\n")
          : "- 综合判断",
        "",
        "## 可选卡列表",
        JSON.stringify(cardCatalog, null, 2),
        "",
        "请选择 2-4 张卡，只输出可 JSON.parse 的 JSON：",
        "{",
        '  "selections": [',
        '    { "cap_id": "xxx", "tier": "mid", "reason": "一句话理由" }',
        "  ]",
        "}",
        "",
        "选卡原则：",
        "- 优先选跟你读过的报告证据相关的卡",
        "- 你负责的维度必须有清晰覆盖",
        "- 必须满足卡之间的依赖关系，不能选出硬性 requires/excludes 冲突",
        "- tier 选择反映你的风险偏好和成本意识"
      ].filter(Boolean).join("\n")
    }
  ];

  return requestStrictJson(actor, messages, {
    temperature: 0.65,
    max_tokens: 1600
  }, {
    caller: "team_runner.generateSummaryCardSelection",
    step: "R2.summary_card_selection"
  }, (data) => {
    const parsed = normalizeCardSelectionsLocal(data?.selections, validCards);
    if (parsed.length < 2) {
      return { ok: false, error: "at least 2 valid selections required" };
    }
    if (parsed.length > 4) {
      return { ok: false, error: "at most 4 valid selections allowed" };
    }
    return { ok: true, value: parsed };
  });
}

const WRITING_POWER = {
  "MBA（海外）": 9,
  "MBA（国内）": 8,
  "博士（海归）": 7,
  "硕士（海外）": 7,
  "硕士（海归）": 7,
  "硕士（国内）": 6,
  "本科（985）": 5,
  "本科（海外）": 5,
  "本科（国内）": 4,
  "本科（非985）": 4,
  "大专": 3,
  "高中": 2,
  "中专/高中": 2
};

function countUserTurns(history) {
  return (Array.isArray(history) ? history : []).filter((item) => item.role === "user").length;
}

function majorityVote(submissions) {
  const counts = new Map();
  for (const item of submissions || []) {
    const submission = item?.submission || {};
    const key = `${submission.grid_id}__${submission.architecture}`;
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  const winner = Array.from(counts.entries()).sort((a, b) => b[1] - a[1])[0];
  if (!winner) {
    return null;
  }
  const parts = winner[0].split("__");
  return {
    grid_id: parts[0],
    architecture: parts[1],
    count: winner[1]
  };
}

function buildTeamName(teamIndex) {
  return `ai_sim_team_${String(teamIndex + 1).padStart(2, "0")}_${Date.now()}`;
}

function writingPower(student) {
  return WRITING_POWER[student?.education] || 3;
}

function pickVPLeadWriter(teamStudents) {
  return teamStudents
    .map((student, index) => ({ student, index, power: writingPower(student) }))
    .sort((a, b) => b.power - a.power)[0]?.index ?? 0;
}

function pickVPSpeakers(teamStudents, leadWriterIndex) {
  const sorted = teamStudents
    .map((student, index) => ({ student, index, power: writingPower(student) }))
    .sort((a, b) => b.power - a.power);
  if (sorted.length === 0) return [leadWriterIndex, leadWriterIndex, leadWriterIndex];
  if (sorted.length === 1) return [sorted[0].index, sorted[0].index, sorted[0].index];
  if (sorted.length === 2) return [sorted[0].index, sorted[1].index, sorted[0].index];
  return [
    sorted[0].index,
    sorted[sorted.length - 1].index,
    sorted[Math.floor(sorted.length / 2)].index
  ];
}

function isNotFound(err) {
  return err instanceof ApiError && err.status === 404;
}

function logLine(log, enabled, message) {
  if (!enabled || !log || typeof log.log !== "function") return;
  log.log(message);
}

function stepApi(api, step, memberId = null) {
  return api.withContext(step, memberId);
}

function getStudentProfile(options, memberIndex) {
  return Array.isArray(options.students) ? options.students[memberIndex] || null : null;
}

function resolveTeamStrategy(options, teamIndex) {
  if (options.teamStrategy && typeof options.teamStrategy === "object") {
    return options.teamStrategy;
  }
  if (Array.isArray(options.teamStrategies)) {
    return options.teamStrategies[teamIndex] || null;
  }
  return null;
}

function resolvePhase1GridChoice(options, teamIndex, memberIndex, student) {
  const teamStrategy = resolveTeamStrategy(options, teamIndex);
  if (teamStrategy) return teamStrategy;
  return getStudentGridChoice(teamIndex, memberIndex, student);
}

function getSpeakerMeta(options, members, memberIndex) {
  const student = getStudentProfile(options, memberIndex);
  const member = Array.isArray(members) ? members[memberIndex] : null;
  return {
    memberId: member?.id || null,
    persona: student?.personaId || student?.id || null,
    name: student?.name || member?.member_name || null
  };
}

function round2ChannelFeePercent(gridId) {
  const raw = String(gridId || "").toUpperCase();
  return raw.includes("TOB") || raw.includes("B2B") ? 15 : 25;
}

function normalizeVpDraftText(candidate, fallback = "") {
  if (candidate == null) return String(fallback || "").trim();
  if (typeof candidate === "string") {
    return String(candidate || "").trim() || String(fallback || "").trim();
  }
  if (typeof candidate === "object") {
    const parts = [
      candidate.who || candidate.WHO || "",
      candidate.pain || candidate.PAIN || "",
      candidate.how || candidate.HOW || ""
    ].map((part) => String(part || "").trim()).filter(Boolean);
    return (parts.join("。") || String(fallback || "").trim()).trim();
  }
  return String(fallback || "").trim();
}

function extractVpField(text, key) {
  const match = String(text || "").match(new RegExp(`${key}\\s*[：:]\\s*([^\\n]+)`));
  return match ? match[1].trim() : "";
}

function extractMarkdownVpSection(text, labels) {
  const source = String(text || "");
  for (const label of labels) {
    const escaped = String(label || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const pattern = new RegExp(`(?:^|\\n)\\s*(?:\\*\\*)?${escaped}(?:\\*\\*)?\\s*[：:]?\\s*([\\s\\S]*?)(?=\\n\\s*\\*\\*[^\\n]+\\*\\*|\\n\\s*---|$)`, "i");
    const match = source.match(pattern);
    if (match && String(match[1] || "").trim()) {
      return String(match[1] || "")
        .replace(/^\s*[：:]\s*/, "")
        .replace(/\*\*/g, "")
        .trim();
    }
  }
  return "";
}

function buildVpResultFromText(vpText, fallback = null) {
  const source = fallback && typeof fallback === "object" ? fallback : {};
  const scenario = extractMarkdownVpSection(vpText, ["在", "场景", "使用场景"]);
  const promisedOutcome = extractMarkdownVpSection(vpText, ["让他们感受到", "让他们", "因此"]);
  const painFromScenario = [scenario, promisedOutcome].filter(Boolean).join("；");
  return {
    target_customer: extractVpField(vpText, "WHO") || extractMarkdownVpSection(vpText, ["为谁", "目标客户", "WHO", "为"]) || source.target_customer || source.who || "",
    scenario_pain: extractVpField(vpText, "PAIN") || extractMarkdownVpSection(vpText, ["核心痛点", "他们面临的是", "痛点", "场景痛点", "PAIN"]) || painFromScenario || source.scenario_pain || source.pain || "",
    value_creation: extractVpField(vpText, "HOW") || extractMarkdownVpSection(vpText, ["我们提供", "提供", "在那一刻", "解决方式", "价值创造", "HOW"]) || source.value_creation || source.how || "",
    alternative: extractMarkdownVpSection(vpText, ["相比", "替代方案", "现有方案"]) || source.alternative || "",
    boundary: extractMarkdownVpSection(vpText, ["但请注意，这个方案在以下情况可能不奏效", "边界条件", "但请注意"]) || String(source.boundary || "").trim()
  };
}

function fallbackConfirmedFieldFromVpText(vpText, maxLength = 500) {
  return String(vpText || "")
    .replace(/\*\*/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

function buildConfirmedFieldsFromVp(vpResult, vpText = "") {
  const result = vpResult && typeof vpResult === "object" ? vpResult : {};
  const fallbackText = fallbackConfirmedFieldFromVpText(vpText);
  return {
    who_raw: String(result.target_customer || result.who || extractVpField(vpText, "WHO") || fallbackText).trim(),
    pain_raw: String(result.scenario_pain || result.pain || extractVpField(vpText, "PAIN") || fallbackText).trim(),
    how_raw: String(result.value_creation || result.how || extractVpField(vpText, "HOW") || fallbackText).trim(),
    alternative_raw: String(result.alternative || "").trim(),
    boundary_raw: String(result.boundary || "").trim()
  };
}

function buildFallbackCoachReply(gridId, architecture) {
  return `继续围绕 ${String(gridId || "").trim() || "当前定位"} / ${String(architecture || "").trim() || "当前架构"} 打磨价值主张：把目标用户写得更具体，把触发场景和核心痛点说清楚，再明确为什么你的方案比现有替代方案更有效。`;
}

function buildTeamJinangContext(tracker) {
  const members = Object.values(tracker.members || {});
  return {
    market: members.map((member) => member.jinang_market?.name || member.jinang_market?.id || "").filter(Boolean),
    tech: members.map((member) => member.jinang_tech?.name || member.jinang_tech?.id || "").filter(Boolean)
  };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function resolveLeaderMemberId(...candidates) {
  for (const candidate of candidates) {
    const value = String(candidate || "").trim();
    if (value) return value;
  }
  return "";
}

function hasValidVpScores(data) {
  return data &&
    data.ok === true &&
    data.score_valid === true &&
    Number.isFinite(Number(data.scores?.coverage)) &&
    Number.isFinite(Number(data.scores?.generalizability)) &&
    Number.isFinite(Number(data.scores?.effectiveness));
}

function hasVpResultPayload(data) {
  return data && data.ok === true && data.vp_result && typeof data.vp_result === "object";
}

async function scoreVPDraft(api, teamId, majority, vpDraft, options = {}) {
  const retries = Math.max(0, Number(options.retries || 0));
  const retryDelayMs = Math.max(0, Number(options.retryDelayMs || 800));
  const fallbackData = hasValidVpScores(options.fallbackData) ? options.fallbackData : null;
  let lastData = null;
  let lastError = null;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const data = await stepApi(api, "R1.5_vp_score").submitVP(teamId, {
        mode: "score",
        grid_id: majority.grid_id,
        architecture: majority.architecture,
        vp_text: vpDraft
      });
      lastData = data;
      if (hasValidVpScores(data)) return data;
      if (attempt < retries) {
        if (typeof options.onWarn === "function") {
          options.onWarn(`VP score invalid, retry ${attempt + 1}/${retries}`, {
            step: "r1_vp_score",
            attempt: attempt + 1,
            score_valid: data?.score_valid,
            scores: data?.scores || null
          });
        }
        await sleep(retryDelayMs);
        continue;
      }
    } catch (err) {
      lastError = err;
      if (attempt < retries) {
        if (typeof options.onWarn === "function") {
          options.onWarn(`VP score request failed, retry ${attempt + 1}/${retries}`, {
            step: "r1_vp_score",
            attempt: attempt + 1,
            error: err.message || String(err)
          });
        }
        await sleep(retryDelayMs);
        continue;
      }
    }
  }

  if (fallbackData) {
    if (typeof options.onWarn === "function") {
      options.onWarn("VP score recovery used last valid scores", {
        step: "r1_vp_score",
        error: lastError?.message || null,
        score_valid: lastData?.score_valid,
        fallback_scores: fallbackData.scores || null
      });
    }
    return {
      ...fallbackData,
      recovered_from_previous_valid_score: true,
      recovered_for_vp_text: vpDraft,
      raw_score_payload: lastData || null
    };
  }

  if (lastError) throw lastError;
  assert(lastData?.ok === true, "submitVP score returned ok=false");
  assert(lastData?.score_valid === true, "submitVP score returned score_valid=false");
  assert(Number.isFinite(Number(lastData?.scores?.coverage)), "coverage missing from submitVP score");
  assert(Number.isFinite(Number(lastData?.scores?.generalizability)), "generalizability missing from submitVP score");
  assert(Number.isFinite(Number(lastData?.scores?.effectiveness)), "effectiveness missing from submitVP score");
  return lastData;
}

async function confirmVPDraft(api, teamId, majority, vpDraft, jinangContext, options = {}) {
  const retries = Math.max(0, Number(options.retries || 0));
  const retryDelayMs = Math.max(0, Number(options.retryDelayMs || 800));
  const fallbackScores = options.fallbackScores && typeof options.fallbackScores === "object"
    ? options.fallbackScores
    : null;
  const fallbackVpResult = options.fallbackVpResult && typeof options.fallbackVpResult === "object"
    ? options.fallbackVpResult
    : null;
  let lastData = null;
  let lastError = null;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const vpResult = buildVpResultFromText(vpDraft, fallbackVpResult);
      const confirmedFields = buildConfirmedFieldsFromVp(vpResult, vpDraft);
      const data = await stepApi(api, "R1.5_vp_confirm").confirmAndScoreVP({
        teamId,
        memberId: resolveLeaderMemberId(options.memberId, majority.leader_member_id, majority.member_id, majority.memberId),
        grid_id: majority.grid_id,
        architecture: majority.architecture,
        vpText: vpDraft,
        confirmedFields,
        jinang: jinangContext
      });
      if (data?.ok === true) {
        data.vp_text = data.vp_text || data.final_vp_text || vpDraft;
        data.final_vp_text = data.final_vp_text || data.vp_text || vpDraft;
        data.scores = data.scores || {
          coverage: fallbackScores?.coverage ?? null,
          generalizability: fallbackScores?.generalizability ?? null,
          effectiveness: fallbackScores?.effectiveness ?? null
        };
        data.vp_result = data.vp_result || buildVpResultFromText(data.vp_text, fallbackVpResult);
      }
      lastData = data;
      if (hasVpResultPayload(data)) return data;
      if (attempt < retries) {
        if (typeof options.onWarn === "function") {
          options.onWarn(`VP confirm missing vp_result, retry ${attempt + 1}/${retries}`, {
            step: "r1_vp_confirm",
            attempt: attempt + 1
          });
        }
        await sleep(retryDelayMs);
        continue;
      }
    } catch (err) {
      lastError = err;
      if (attempt < retries) {
        if (typeof options.onWarn === "function") {
          options.onWarn(`VP confirm request failed, retry ${attempt + 1}/${retries}`, {
            step: "r1_vp_confirm",
            attempt: attempt + 1,
            error: err.message || String(err)
          });
        }
        await sleep(retryDelayMs);
        continue;
      }
    }
  }

  if (lastData?.ok === true) {
    const recoveredVpText = normalizeVpDraftText(lastData.vp_text || lastData.final_vp_text, vpDraft);
    const recoveredScores = {
      coverage: lastData.scores?.coverage ?? fallbackScores?.coverage ?? null,
      generalizability: lastData.scores?.generalizability ?? fallbackScores?.generalizability ?? null,
      effectiveness: lastData.scores?.effectiveness ?? fallbackScores?.effectiveness ?? null
    };
    if (typeof options.onWarn === "function") {
      options.onWarn("VP confirm recovered locally from latest valid draft", {
        step: "r1_vp_confirm",
        error: lastError?.message || null,
        recovered_vp_text: recoveredVpText
      });
    }
    return {
      ...lastData,
      ok: true,
      vp_text: recoveredVpText,
      final_vp_text: recoveredVpText,
      scores: recoveredScores,
      vp_result: buildVpResultFromText(recoveredVpText, fallbackVpResult),
      recovered_from_confirm_fallback: true
    };
  }

  if (lastError) throw lastError;
  assert(lastData?.ok === true, "submitVP confirm returned ok=false");
  assert(lastData?.vp_result && typeof lastData.vp_result === "object", "submitVP confirm missing vp_result");
  return lastData;
}

async function chatWithVpCoach(api, teamId, payload, options = {}) {
  const retries = Math.max(0, Number(options.retries || 0));
  const retryDelayMs = Math.max(0, Number(options.retryDelayMs || 800));
  const timeoutMs = Math.max(1000, Number(options.timeoutMs || 30000));
  const fallbackReply = String(options.fallbackReply || "").trim();
  let lastError = null;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const data = await stepApi(api, "R1.5_vp_chat").post(
        `/api/team/${encodeURIComponent(teamId)}/phase3/chat`,
        payload,
        { retries: 0, timeoutMs }
      );
      if (data?.ok === true && String(data.coach_reply || "").trim()) {
        return data;
      }
      lastError = new Error(`vp chat response invalid on attempt ${attempt + 1}`);
    } catch (err) {
      lastError = err;
    }

    if (attempt < retries) {
      if (typeof options.onWarn === "function") {
        options.onWarn(`VP chat request failed, retry ${attempt + 1}/${retries}`, {
          step: "r1_vp_chat",
          attempt: attempt + 1,
          error: lastError?.message || String(lastError)
        });
      }
      await sleep(retryDelayMs);
      continue;
    }
  }

  if (fallbackReply) {
    if (typeof options.onWarn === "function") {
      options.onWarn("VP chat recovered with local fallback coach reply", {
        step: "r1_vp_chat",
        error: lastError?.message || String(lastError || ""),
        fallback_reply: fallbackReply
      });
    }
    return {
      ok: true,
      coach_reply: fallbackReply,
      recovered_from_chat_fallback: true
    };
  }

  throw lastError || new Error("vp chat failed");
}

function createStudentActor(options, teamIndex, memberIndex, teamId, memberId, fallbackMemberName) {
  const studentProfile = getStudentProfile(options, memberIndex);
  const memberName = studentProfile?.name || fallbackMemberName || `成员${memberIndex + 1}`;
  const teamStrategy = resolveTeamStrategy(options, teamIndex);
  if (studentProfile) {
    return new PersonaStudent({
      apiKey: process.env.DEEPSEEK_API_KEY,
      strictMode: options.strictDeepSeek,
      logger: options.logger,
      teamId,
      memberId,
      student: studentProfile,
      teamIndex,
      memberIndex
    });
  }
  return new DeepSeekStudent({
    apiKey: process.env.DEEPSEEK_API_KEY,
    strictMode: options.strictDeepSeek,
    logger: options.logger,
    teamId,
    memberId,
    teamStrategy,
    teamProfile: {
      teamIndex,
      memberIndex,
      memberName
    }
  });
}

function normalizeAssignments(assignments, fallbackMembers) {
  if (Array.isArray(assignments) && assignments.length > 0) return assignments;
  return (fallbackMembers || []).map((member) => ({
    memberId: member.id,
    memberName: member.member_name,
    dims: []
  }));
}

function pickCard(groupId, usedCaps) {
  const preferred = SAFE_GROUP_CARDS[groupId] || [];
  const candidates = preferred.length > 0 ? preferred : (GROUP_TO_CARDS.get(groupId) || []);
  for (const capId of candidates) {
    if (usedCaps.has(capId)) continue;
    return { cap_id: capId, tier: "mid" };
  }
  return null;
}

function planSelections(assignments, teamSize) {
  const byMember = new Map();
  const usedCaps = new Set();
  const baseGroups = [
    "interaction_expression",
    "perception_understanding",
    "mobility_navigation",
    "safety_trust",
    "expand_connect",
    "ops_maintenance"
  ];
  let targetGroups = baseGroups;
  if (teamSize > 3 && teamSize <= 6) {
    targetGroups = baseGroups.concat(["interaction_expression", "expand_connect"]);
  } else if (teamSize > 6) {
    targetGroups = baseGroups.concat([
      "interaction_expression",
      "expand_connect",
      "ops_maintenance",
      "perception_understanding"
    ]);
  }

  for (const assignment of assignments) {
    byMember.set(assignment.memberId, []);
  }

  const memberCycle = assignments.length > 0 ? assignments : [];
  targetGroups.forEach((groupId, index) => {
    if (memberCycle.length === 0) return;
    const selection = pickCard(groupId, usedCaps);
    if (!selection) return;
    const assignment = memberCycle[index % memberCycle.length];
    const current = byMember.get(assignment.memberId) || [];
    current.push(selection);
    byMember.set(assignment.memberId, current);
    usedCaps.add(selection.cap_id);
  });

  const merged = [];
  for (const selections of byMember.values()) {
    for (const item of selections) {
      merged.push(item);
    }
  }

  const validation = validateSelections(merged);
  if (!validation.valid) {
    throw new Error(`selection plan invalid: ${validation.violations.map((item) => item.message).join(", ")}`);
  }

  return {
    byMember,
    merged
  };
}

function buildInterviewSummary(member, fallbackInterviewResults) {
  const parts = [];
  if (member?.r2_interview_summary) {
    parts.push(`访谈标签：${member.r2_interview_summary}`);
  }
  if (member?.r2_evi != null) {
    parts.push(`证据强度 EVI：${member.r2_evi}`);
  }
  if (member?.r2_radar_scores && typeof member.r2_radar_scores === "object") {
    const radarText = Object.entries(member.r2_radar_scores)
      .filter(([, value]) => Number.isFinite(Number(value)))
      .map(([key, value]) => `${key}:${value}`)
      .join(", ");
    if (radarText) {
      parts.push(`维度雷达：${radarText}`);
    }
  }
  if (parts.length > 0) {
    return parts.join("\n");
  }
  const fallbackTags = (fallbackInterviewResults || [])
    .flatMap((item) => Array.isArray(item?.tags) ? item.tags : [])
    .map((item) => typeof item === "string" ? item : item?.tag)
    .filter(Boolean);
  if (fallbackTags.length > 0) {
    return `团队访谈共识标签：${Array.from(new Set(fallbackTags)).join("、")}`;
  }
  return "暂无明确访谈摘要，请优先覆盖你负责的维度并保持保守预算。";
}

function normalizeViolationsList(violations) {
  return (Array.isArray(violations) ? violations : []).map((item) => ({
    type: item?.type || null,
    source: item?.source || null,
    target: item?.target || null,
    message: String(item?.message || "").trim()
  })).filter((item) => item.message);
}

async function runRound2Summary(result, api, teamId, members, memberActors, teamIndex, options, tracker, context) {
  const { recap, stateData, assignments } = context;
  const sessionId = resolveSummarySessionId(options, stateData);
  const leaderMemberId = resolveLeaderMemberId(
    stateData.leader_member_id,
    stateData.leaderMemberId,
    members[0]?.id
  );

  const reportsByMember = new Map();
  const summaryQueryBase = {
    teamId,
    sessionId,
    session_id: sessionId
  };

  const reportCatalogData = await runStep(result, "r2_summary_get_reports", async () => {
    const query = buildSummaryQuery(summaryQueryBase);
    const data = await stepApi(api, "R2.summary_get_reports").get(`/api/round2/persona-reports?${query}`);
    assert(data.ok === true, "persona-reports returned ok=false");
    assert(Array.isArray(data.reports), "persona-reports missing reports");
    assert(data.reports.length > 0, "persona-reports returned no reports");
    return data;
  });

  const reportCount = Math.max(
    Array.isArray(reportCatalogData.available_reports) ? reportCatalogData.available_reports.length : 0,
    Array.isArray(reportCatalogData.reports) ? reportCatalogData.reports.length : 0,
    3
  );
  const totalReports = Math.min(3, reportCount);
  const readingMembers = assignments.filter((assignment) => assignment.memberId);

  const readingStatus = await runStep(result, "r2_summary_member_reading", async () => {
    await Promise.all(readingMembers.map(async (assignment) => {
      const memberIndex = members.findIndex((member) => member.id === assignment.memberId);
      const actor = getStudentProfile(options, memberIndex)
        ? memberActors[memberIndex]
        : createStudentActor(options, teamIndex, memberIndex, teamId, assignment.memberId, assignment.memberName);
      const readReports = [];

      for (let reportIndex = 0; reportIndex < totalReports; reportIndex += 1) {
        if (reportIndex > 0) {
          const decision = await askContinueReading(actor, {
            readCount: readReports.length,
            nextLabel: `P${reportIndex + 1}`,
            readReports
          });
          if (decision.continue !== true) {
            break;
          }
        }

        const query = buildSummaryQuery({
          ...summaryQueryBase,
          memberId: assignment.memberId
        });
        const data = await stepApi(api, "R2.summary_get_persona_report", assignment.memberId)
          .get(`/api/round2/persona-report/${reportIndex}?${query}`);
        assert(data.ok === true, `persona-report ${reportIndex + 1} failed for ${assignment.memberName}`);
        assert(data.report && typeof data.report === "object", `persona-report ${reportIndex + 1} missing report for ${assignment.memberName}`);
        assert(String(reportText(data.report)).trim(), `persona-report ${reportIndex + 1} empty text for ${assignment.memberName}`);
        readReports.push({
          report_index: reportIndex,
          persona_id: data.report.persona_id || `P${reportIndex + 1}`,
          report: data.report
        });
      }

      assert(readReports.length > 0, `member ${assignment.memberName} read no reports`);
      const completeData = await stepApi(api, "R2.summary_complete_reading", assignment.memberId)
        .post("/api/round2/complete-reading", {
          teamId,
          memberId: assignment.memberId,
          sessionId,
          session_id: sessionId
        });
      assert(completeData.ok === true, `complete-reading failed for ${assignment.memberName}`);

      const trackerMember = tracker.getMember(assignment.memberId);
      if (trackerMember) {
        trackerMember.r2_interview_turns = readReports.length;
        trackerMember.r2_interview_summary = readReports.map((item) => reportTitle(item.report, item.report_index)).join(" | ");
        trackerMember.interview_persona_id = readReports.map((item) => item.persona_id).join(" | ");
        trackerMember.interview_persona_name = trackerMember.r2_interview_summary;
        trackerMember.interviewLog = readReports.map((item, index) => ({
          turn_number: index + 1,
          role: "interviewee",
          message_text: reportText(item.report),
          interview_persona_id: item.persona_id,
          interview_persona_name: reportTitle(item.report, item.report_index)
        }));
      }

      reportsByMember.set(assignment.memberId, {
        memberId: assignment.memberId,
        memberName: assignment.memberName,
        reports: readReports
      });
    }));

    const query = buildSummaryQuery({
      ...summaryQueryBase,
      memberId: leaderMemberId
    });
    const data = await stepApi(api, "R2.summary_team_reading_status").get(`/api/round2/team-reading-status?${query}`);
    assert(data.ok === true, "team-reading-status returned ok=false");
    assert(Array.isArray(data.members), "team-reading-status missing members");
    return data;
  });

  await runStep(result, "r2_summary_freeze_reports", async () => {
    const data = await stepApi(api, "R2.summary_persona_select").post("/api/round2/persona-select", {
      teamId,
      memberId: leaderMemberId,
      sessionId,
      session_id: sessionId
    });
    assert(data.ok === true, "persona-select returned ok=false");
    assert(data.locked === true, "persona-select did not lock summary reports");
    return data;
  });

  const cardsData = await runStep(result, "r2_get_cards", async () => {
    const cards = await stepApi(api, "R2.3_get_rd_cards").getRDCards();
    assert(cards.ok === true, "getRDCards returned ok=false");
    assert(Array.isArray(cards.groups), "getRDCards missing groups");
    return cards;
  });
  const selectionContexts = assignments.map((assignment) => {
    const member = tracker.getMember(assignment.memberId);
    const memberIndex = members.findIndex((item) => item.id === assignment.memberId);
    return {
      assignment,
      member,
      memberIndex,
      actor: getStudentProfile(options, memberIndex)
        ? memberActors[memberIndex]
        : createStudentActor(options, teamIndex, memberIndex, teamId, assignment.memberId, assignment.memberName),
      readReports: reportsByMember.get(assignment.memberId)?.reports || []
    };
  });

  async function saveSummarySelections(validationIssues = null) {
    await Promise.all(selectionContexts.map(async (selectionContext) => {
      const currentMember = tracker.getMember(selectionContext.assignment.memberId);
      const generatedSelections = await generateSummaryCardSelection(selectionContext.actor, {
        cards: cardsData,
        readReports: selectionContext.readReports,
        assignedDims: selectionContext.assignment.dims,
        validationIssues,
        previousSelections: currentMember?.r2_personal_selections || []
      });
      const apiSelections = generatedSelections.map((item) => ({
        cap_id: item.cap_id,
        tier: item.tier
      }));
      const data = await stepApi(api, "R2.4_member_selection", selectionContext.assignment.memberId).saveMemberSelection(
        teamId,
        selectionContext.assignment.memberId,
        apiSelections
      );
      assert(data.ok === true, `saveMemberSelection failed for ${selectionContext.assignment.memberName}`);
      assert(Number(data.count) === apiSelections.length, `selection count mismatch for ${selectionContext.assignment.memberName}`);
      tracker.recordPersonalSelections(selectionContext.assignment.memberId, generatedSelections);
    }));
  }

  async function mergeTeamSelectionsSummary() {
    const data = await stepApi(api, "R2.5_merge_team").mergeTeam(teamId, recap.COGSbase || "");
    assert(data.ok === true, "mergeTeam returned ok=false");
    assert(Array.isArray(data.teamSelections), "mergeTeam missing teamSelections");
    assert(data.teamSelections.length >= 6, `mergeTeam card_count=${data.teamSelections.length}, expected at least 6`);
    tracker.recordMerge(data);
    return data;
  }

  async function validateMergedSelectionsSummary(currentMergeData) {
    const data = await stepApi(api, "R2.6_validate").validateSelections({
      selections: currentMergeData.teamSelections,
      COGSbase: recap.COGSbase || 600
    });
    assert(data.ok === true, "validateSelections returned ok=false");
    return data;
  }

  await runStep(result, "r2_member_selections", async () => {
    await saveSummarySelections();
  });

  let mergeData = await runStep(result, "r2_merge_team", async () => mergeTeamSelectionsSummary());

  await runStep(result, "r2_validate", async () => {
    let validation = await validateMergedSelectionsSummary(mergeData);
    let retryCount = 0;
    while (validation.valid !== true && retryCount < 2) {
      await saveSummarySelections(validation.violations || []);
      mergeData = await mergeTeamSelectionsSummary();
      validation = await validateMergedSelectionsSummary(mergeData);
      retryCount += 1;
    }
    assert(validation.valid === true, `validateSelections returned valid=${validation.valid}`);
  });

  const pricingStudent = memberActors[0] || createStudentActor(
    options,
    teamIndex,
    0,
    teamId,
    members[0]?.id || null,
    members[0]?.member_name || "成员1"
  );
  const pricingUi = loadPricingUiConfig();
  const channelFee = round2ChannelFeePercent(recap.final_grid_id);
  const costSummary = summarizeSelectionCosts(mergeData.teamSelections, recap.COGSbase || 600);
  const memberReportRows = Array.from(reportsByMember.values());
  const demandSummary = buildPricingDemandSummaryFromReports(memberReportRows);
  if (costSummary.missingCapabilityIds.length > 0) {
    warn(result, "pricing cost summary skipped unknown capabilities", {
      missing_capability_ids: costSummary.missingCapabilityIds
    });
  }
  const price = await pricingStudent.generatePriceChoice({
    basePrice: pricingUi.default_price,
    min: pricingUi.price_min,
    max: pricingUi.price_max,
    step: pricingUi.price_step,
    defaultPrice: pricingUi.default_price,
    totalCOGS: costSummary.unitVariableCost,
    baseVariableCost: costSummary.baseVariableCost,
    dCOGSTotal: costSummary.dCOGSTotal,
    fbaseWan: costSummary.fbaseWan,
    nreTotalWan: costSummary.nreTotalWan,
    upfrontInvestmentWan: costSummary.upfrontInvestmentWan,
    channelFee,
    demandSummary
  });
  const pricingWtp = Number(tracker.team.r1_wtp_adj || recap.wtp_breakdown?.final_result?.WTPadj || 0);
  tracker.recordPrice(price, pricingWtp > 0 ? Number((price / pricingWtp).toFixed(4)) : null);

  const previewData = await runStep(result, "r2_calculate_preview", async () => {
    const calcGridId = toCalcGridId(recap.final_grid_id, recap.architecture || stateData.round1_context?.architecture || "");
    const data = await stepApi(api, "R2.7_calculate_preview").calculateRD({
      gridId: calcGridId,
      round1GridId: recap.final_grid_id,
      selections: mergeData.teamSelections,
      radar: mergeData.mergedInterview?.radar || {},
      tags: mergeData.mergedInterview?.tags || [],
      evi: Number.isFinite(Number(mergeData.mergedInterview?.evi)) ? Number(mergeData.mergedInterview.evi) : 0.7,
      P: price,
      Pmax: Number(recap.Pmax || 0),
      WTP: Number(recap.WTP || 0),
      e: Number(recap.e || 1.2),
      COGSbase: Number(recap.COGSbase || 600),
      TAM: Number(recap.TAM || 50000),
      H: Number(recap.H || 0.3),
      wtp_multiplier: tracker.team.r1_wtp_multiplier,
      WTPref_override: Number(tracker.team.r1_wtp_ref || 0) > 0 ? Number(tracker.team.r1_wtp_ref) * PRICE_SCALE : undefined,
      teamId,
      sessionId: `${sessionId}_preview`
    });
    assert(data.ok === true, "calculateRD returned ok=false");
    assert(Number.isFinite(Number(data.share)), "calculateRD missing share");
    assert(Number.isFinite(Number(data.units)), "calculateRD missing units");
    assert(Number.isFinite(Number(data.profit)), "calculateRD missing profit");
    return data;
  });
  tracker.team.r2_coverCore = Number.isFinite(Number(previewData.coverCore)) ? Number(previewData.coverCore) : tracker.team.r2_coverCore;
  tracker.team.r2_coverNice = Number.isFinite(Number(previewData.coverNice)) ? Number(previewData.coverNice) : tracker.team.r2_coverNice;

  await runStep(result, "r2_submit_final", async () => {
    const data = await stepApi(api, "R2.7_submit_final").submitFinal(teamId, {
      member_id: leaderMemberId,
      memberId: leaderMemberId,
      sessionId,
      session_id: sessionId,
      price,
      selections: mergeData.teamSelections,
      radar: mergeData.mergedInterview?.radar || {},
      tags: mergeData.mergedInterview?.tags || [],
      evi: Number.isFinite(Number(mergeData.mergedInterview?.evi)) ? Number(mergeData.mergedInterview.evi) : 0.7,
      bestGrid: recap.final_grid_id,
      wtp_multiplier: tracker.team.r1_wtp_multiplier
    });
    assert(data.ok === true, "submitFinal returned ok=false");
    assert(data.result && typeof data.result === "object", "submitFinal missing result");
    assert(Number.isFinite(Number(data.result.profit)), "submitFinal missing result.profit");
    assert(Number.isFinite(Number(data.result.units)), "submitFinal missing result.units");
  });

  const teamResultData = await runStep(result, "r2_get_team_result", async () => {
    const data = await stepApi(api, "R2.7_get_team_result").getTeamResult(teamId, sessionId);
    assert(data.ok === true, "getTeamResult returned ok=false");
    assert(data.result && typeof data.result === "object", "getTeamResult missing result");
    assert(Number.isFinite(Number(data.result.profit)), "team result profit is not finite");
    return data;
  });
  tracker.recordFinalResult(previewData, teamResultData);

  result.meta.round2 = {
    interview_mode: "summary",
    session_id: sessionId,
    interview_member_count: 0,
    report_reading_member_count: readingMembers.length,
    team_viewed_count: Number(readingStatus.team_viewed_count || 0),
    preview_profit: Number(previewData.profit || 0),
    price
  };
}

async function runRound1(result, api, teamSize, teamIndex, options, tracker) {
  const verbose = options.logLevel === "verbose";
  const teamName = buildTeamName(teamIndex);

  const createData = await runStep(result, "r1_create_team", async () => {
    const data = await stepApi(api, "R1.1_create_team").createTeam(teamName, teamSize);
    assert(data.ok === true, "createTeam returned ok=false");
    assert(data.team?.id, "createTeam missing team.id");
    assert(Array.isArray(data.team?.members), "createTeam missing team.members");
    assert(data.team.members.length === teamSize, `team member count ${data.team.members.length} != ${teamSize}`);
    const uniqueMemberIds = new Set(data.team.members.map((member) => member.id));
    assert(uniqueMemberIds.size === teamSize, "member ids are not unique");
    result.teamId = data.team.id;
    result.meta.teamName = teamName;
    result.meta.createdTeamId = data.team.id;
    api.setTeamId(data.team.id);
    tracker.setTeamId(data.team.id);
    data.team.members.forEach((member, memberIndex) => {
      tracker.initMember(member.id, memberIndex, getStudentProfile(options, memberIndex));
    });
    return data;
  });

  const teamId = createData.team.id;
  const members = createData.team.members;
  const memberActors = members.map((member, memberIndex) => createStudentActor(
    options,
    teamIndex,
    memberIndex,
    teamId,
    member.id,
    member.member_name
  ));
  logLine(options.log, options.logLevel !== "quiet", `Team ${teamIndex + 1}: created ${teamId}`);

  await runStep(result, "r1_get_jinang", async () => {
    const jinangList = await Promise.all(members.map((member) => stepApi(api, "R1.2_get_jinang", member.id).getJinang(teamId, member.id)));
    const signatures = new Set();
    for (let i = 0; i < jinangList.length; i += 1) {
      const item = jinangList[i];
      assert(item.ok === true, `getJinang failed for member ${i + 1}`);
      assert(item.jinang?.market?.id, `market jinang missing for member ${i + 1}`);
      assert(item.jinang?.tech?.id, `tech jinang missing for member ${i + 1}`);
      tracker.recordJinang(members[i]?.id, item.jinang);
      signatures.add(`${item.jinang.market.id}__${item.jinang.tech.id}`);
    }
    if (signatures.size <= 1) {
      warn(result, "All members received the same jinang pair", { step: "r1_get_jinang" });
    }
  });

  await runStep(result, "r1_init_persona_layers", async () => {
    await Promise.all(memberActors.map(async (actor, memberIndex) => {
      if (!actor || typeof actor.generateSeedMemory !== "function") return;
      await actor.generateSeedMemory();
      if (typeof actor.generateClassroomProfile === "function") {
        await actor.generateClassroomProfile();
      }
      const member = tracker.getMember(members[memberIndex]?.id);
      if (member) {
        member.seed_memory_json = actor.seedMemory || null;
        member.classroom_profile_json = actor.classroomProfile || null;
      }
    }));
  });

  await runStep(result, "r1_submit_phase1", async () => {
    const responses = await Promise.all(members.map(async (member, memberIndex) => {
      const choice = await memberActors[memberIndex].generatePhase1Choice(
        resolvePhase1GridChoice(options, teamIndex, memberIndex, getStudentProfile(options, memberIndex))
      );
      const data = await stepApi(api, "R1.3_phase1_submit", member.id).submitPhase1(teamId, member.id, choice);
      assert(data.ok === true, `phase1 submit failed for member ${memberIndex + 1}`);
      assert(Number.isFinite(Number(data.personal_gm_max)), `personal_gm_max missing for member ${memberIndex + 1}`);
      tracker.recordPhase1Choice(member.id, choice, data);
      return data;
    }));
    const maxSubmitted = Math.max(...responses.map((item) => Number(item.submitted_count || 0)));
    assert(maxSubmitted === teamSize, `submitted_count ended at ${maxSubmitted}, expected ${teamSize}`);
    result.meta.round1SubmittedCount = maxSubmitted;
  });

  const submissionsData = await runStep(result, "r1_verify_submissions", async () => {
    const status = await stepApi(api, "R1.4_verify_submissions").getTeamStatus(teamId);
    assert(status.ok === true, "getTeamStatus returned ok=false");
    assert(status.all_submitted === true, `all_submitted=${status.all_submitted}`);
    assert(Number(status.submitted_count) === teamSize, `submitted_count=${status.submitted_count}, expected ${teamSize}`);

    const data = await stepApi(api, "R1.4_verify_submissions").getSubmissions(teamId);
    const submissions = Array.isArray(data.submissions) ? data.submissions : [];
    assert(data.ok === true, "getSubmissions returned ok=false");
    assert(submissions.length === teamSize, `submissions length=${submissions.length}, expected ${teamSize}`);
    return data;
  });

  const majority = majorityVote(submissionsData.submissions);
  assert(majority, "failed to determine majority strategy");
  if (majority.count < Math.ceil(teamSize / 2)) {
    warn(result, "Majority strategy is weak; submissions are highly split", { step: "r1_verify_submissions" });
  }

  const teamStudents = members.map((member, memberIndex) => getStudentProfile(options, memberIndex) || {
    name: member.member_name,
    education: null
  });
  const leadWriterIndex = pickVPLeadWriter(teamStudents);
  const speakerOrder = pickVPSpeakers(teamStudents, leadWriterIndex);
  const leadWriterActor = memberActors[leadWriterIndex];
  result.meta.round1LeadWriter = getSpeakerMeta(options, members, leadWriterIndex);
  result.meta.round1SpeakerOrder = speakerOrder.map((memberIndex) => getSpeakerMeta(options, members, memberIndex));

  const jinangContext = buildTeamJinangContext(tracker);
  const initialVpDraft = typeof leadWriterActor.generateVPDraft === "function"
    ? await leadWriterActor.generateVPDraft({
      grid_id: majority.grid_id,
      architecture: majority.architecture
    })
    : await leadWriterActor.generatePhase1Choice({
      grid_id: majority.grid_id,
      architecture: majority.architecture
  });
  let vpDraft = normalizeVpDraftText(initialVpDraft);
  const baselineScoreData = await runStep(result, "r1_vp_score", async () => scoreVPDraft(api, teamId, majority, vpDraft, {
    retries: 2,
    onWarn: (message, details) => warn(result, message, details)
  }));
  let lastValidVpScoreData = baselineScoreData;
  tracker.recordVpScoreFeatures(baselineScoreData.features, baselineScoreData.scores);
  tracker.pushVpIteration({
    iteration: 0,
    trigger: "baseline_score",
    speaker: getSpeakerMeta(options, members, leadWriterIndex),
    vp_text: vpDraft,
    scores: {
      C: baselineScoreData.scores?.coverage,
      G: baselineScoreData.scores?.generalizability,
      E: baselineScoreData.scores?.effectiveness
    },
    coach_reply: baselineScoreData.coach_reply || null,
    speaker_reply: null
  });
  const chatHistory = [];
  await runStep(result, "r1_vp_chat", async () => {
    let lastCoachReply = "";
    for (let round = 0; round < 3; round += 1) {
      const speakerIndex = speakerOrder[round] ?? leadWriterIndex;
      const speaker = getSpeakerMeta(options, members, speakerIndex);
      const speakerActor = memberActors[speakerIndex];
      const speakerReply = round === 0
        ? `我们团队目前主张的定位是 ${majority.grid_id} / ${majority.architecture}，请指出最该补强的一点。`
        : await speakerActor.generateVPChatReply(lastCoachReply, chatHistory);
      const chatData = await chatWithVpCoach(api, teamId, {
        message: speakerReply,
        grid_id: majority.grid_id,
        architecture: majority.architecture,
        jinang: jinangContext
      }, {
        retries: 2,
        timeoutMs: 30000,
        retryDelayMs: 800,
        fallbackReply: buildFallbackCoachReply(majority.grid_id, majority.architecture),
        onWarn: (message, details) => warn(result, message, details)
      });
      assert(chatData.ok === true, `vp chat round ${round + 1} failed`);
      assert(String(chatData.coach_reply || "").trim(), `vp chat round ${round + 1} reply is empty`);
      chatHistory.push({ role: "user", content: speakerReply });
      chatHistory.push({ role: "assistant", content: chatData.coach_reply });

      const previousVp = vpDraft;
      const revisedVp = await leadWriterActor.generateVPRevision({
        currentVP: previousVp,
        coachReply: chatData.coach_reply,
        speakerReply,
        conversationHistory: chatHistory
      });
      vpDraft = normalizeVpDraftText(revisedVp, previousVp);
      const revisedScoreData = await scoreVPDraft(api, teamId, majority, vpDraft, {
        retries: 2,
        fallbackData: lastValidVpScoreData,
        onWarn: (message, details) => warn(result, message, details)
      });
      const revisedScores = {
        C: revisedScoreData.scores?.coverage,
        G: revisedScoreData.scores?.generalizability,
        E: revisedScoreData.scores?.effectiveness
      };
      if (hasValidVpScores(revisedScoreData)) {
        lastValidVpScoreData = revisedScoreData;
      }
      tracker.recordVpScoreFeatures(revisedScoreData.features, revisedScoreData.scores);
      tracker.pushVpIteration({
        iteration: round + 1,
        trigger: `coach_round_${round + 1}`,
        speaker,
        vp_text: vpDraft,
        scores: revisedScores,
        coach_reply: chatData.coach_reply,
        speaker_reply: speakerReply,
        changes: {
          who_changed: vpDraft !== previousVp,
          pain_changed: vpDraft !== previousVp,
          how_changed: vpDraft !== previousVp
        }
      });
      tracker.pushVpChatLog({
        round_number: round + 1,
        coach_message: chatData.coach_reply,
        speaker_persona: speaker.persona,
        speaker_name: speaker.name,
        speaker_reply: speakerReply,
        lead_writer_persona: result.meta.round1LeadWriter?.persona || null,
        lead_writer_name: result.meta.round1LeadWriter?.name || null,
        vp_before: previousVp,
        vp_after: vpDraft,
        score_product_before: scoreProduct(tracker.team.vpIterations[tracker.team.vpIterations.length - 2]?.scores),
        score_product_after: scoreProduct(revisedScores),
        score_C: revisedScores.C,
        score_G: revisedScores.G,
        score_E: revisedScores.E
      });
      lastCoachReply = chatData.coach_reply;
      if (verbose) {
        logLine(options.log, true, `Team ${teamIndex + 1}: VP chat round ${round + 1} ok`);
      }
    }
  });
  tracker.team.vp_coach_turns_total = countUserTurns(chatHistory);

  const preConfirmPhase3State = await stepApi(api, "R1.5_phase3_state_pre_confirm").getPhase3State(teamId);
  const preConfirmLeaderMemberId = resolveLeaderMemberId(
    preConfirmPhase3State.leader_member_id,
    preConfirmPhase3State.leaderMemberId,
    members[leadWriterIndex]?.id,
    members[0]?.id
  );

  const confirmData = await runStep(result, "r1_vp_confirm", async () => confirmVPDraft(
    api,
    teamId,
    majority,
    vpDraft,
    jinangContext,
    {
      retries: 2,
      memberId: preConfirmLeaderMemberId,
      fallbackScores: lastValidVpScoreData?.scores || baselineScoreData?.scores || null,
      fallbackVpResult: buildVpResultFromText(vpDraft),
      onWarn: (message, details) => warn(result, message, details)
    }
  ));
  const confirmedVpText = normalizeVpDraftText(confirmData.vp_text || confirmData.final_vp_text, vpDraft);
  const confirmScores = {
    C: confirmData.scores?.coverage ?? baselineScoreData.scores?.coverage,
    G: confirmData.scores?.generalizability ?? baselineScoreData.scores?.generalizability,
    E: confirmData.scores?.effectiveness ?? baselineScoreData.scores?.effectiveness
  };
  const confirmScoreProduct = scoreProduct(confirmScores);
  const bestHistorical = tracker.getBestVpIteration();
  const bestOverall = !bestHistorical || (confirmScoreProduct != null && confirmScoreProduct >= bestHistorical.score)
    ? {
        iteration: 4,
        trigger: "confirm_submit",
        score: confirmScoreProduct,
        vp_text: confirmedVpText,
        scores: confirmScores
      }
    : bestHistorical;
  const useBestIteration = !!(
    bestHistorical &&
    bestHistorical.score != null &&
    (confirmScoreProduct == null || confirmScoreProduct < bestHistorical.score)
  );
  const selectedVpText = useBestIteration ? bestHistorical.vp_text : confirmedVpText;
  const selectedScoreData = useBestIteration
    ? await runStep(result, "r1_vp_rescore_best", async () => {
        try {
          return await scoreVPDraft(api, teamId, majority, selectedVpText);
        } catch (err) {
          warn(result, "Best iteration rescore failed; falling back to the stored best-iteration scores", {
            step: "r1_vp_rescore_best",
            error: err.message || String(err)
          });
          return {
            scores: {
              coverage: bestHistorical?.scores?.C,
              generalizability: bestHistorical?.scores?.G,
              effectiveness: bestHistorical?.scores?.E
            },
            features: null,
            recovered_from_iteration: true
          };
        }
      })
    : confirmData;
  const selectedScores = {
    C: selectedScoreData.scores?.coverage ?? bestHistorical?.scores?.C ?? confirmScores.C,
    G: selectedScoreData.scores?.generalizability ?? bestHistorical?.scores?.G ?? confirmScores.G,
    E: selectedScoreData.scores?.effectiveness ?? bestHistorical?.scores?.E ?? confirmScores.E
  };
  const selectedVpResult = useBestIteration
    ? buildVpResultFromText(selectedVpText, confirmData.vp_result || null)
    : (confirmData.vp_result || buildVpResultFromText(selectedVpText));
  tracker.recordVpScoreFeatures(
    selectedScoreData.features || confirmData.features || baselineScoreData.features,
    selectedScores || baselineScoreData.scores
  );
  tracker.pushVpIteration({
    iteration: 4,
    trigger: "confirm_submit",
    speaker: getSpeakerMeta(options, members, leadWriterIndex),
    vp_text: selectedVpText,
    scores: selectedScores,
    coach_reply: confirmData.coach_reply || null,
    speaker_reply: null,
    changes: {
      who_changed: selectedVpText !== vpDraft,
      pain_changed: selectedVpText !== vpDraft,
      how_changed: selectedVpText !== vpDraft
    },
    used_best_iteration: useBestIteration,
    best_iteration: bestOverall?.trigger ?? null,
    best_score: bestOverall?.score ?? null
  });
  tracker.setVpBestSelection(useBestIteration, bestOverall?.trigger ?? null, bestOverall?.score ?? null);
  result.steps.r1_vp_confirm.used_best_iteration = useBestIteration;
  result.steps.r1_vp_confirm.vp_best_iteration = bestOverall?.trigger ?? null;
  result.steps.r1_vp_confirm.vp_best_score = bestOverall?.score ?? null;
  result.meta.round1VpSelection = {
    used_best_iteration: useBestIteration,
    vp_best_iteration: bestOverall?.trigger ?? null,
    vp_best_score: bestOverall?.score ?? null
  };

  const phase3State = await stepApi(api, "R1.5_phase3_state").getPhase3State(teamId);
  const leaderMemberId = resolveLeaderMemberId(
    phase3State.leader_member_id,
    phase3State.leaderMemberId,
    members[leadWriterIndex]?.id,
    members[0]?.id
  );
  tracker.team.vp_coach_turns_total = Math.max(
    tracker.team.vp_coach_turns_total || 0,
    countUserTurns(phase3State.coach_history)
  );
  await runStep(result, "r1_finalize_vp", async () => {
    const data = await stepApi(api, "R1.6_finalize_vp").finalizeVP(teamId, {
      grid_id: majority.grid_id,
      architecture: majority.architecture,
      scores: selectedScores || confirmData.scores || baselineScoreData.scores,
      vp_text: selectedVpText,
      confirmed_fields: buildConfirmedFieldsFromVp(selectedVpResult, selectedVpText),
      member_id: leaderMemberId,
      source_iteration: useBestIteration ? bestHistorical?.trigger || "confirm_submit" : "confirm_submit",
      used_best_iteration: useBestIteration,
      conversation_history: phase3State.coach_history || [],
      vp_result: selectedVpResult,
      vp_result_raw: confirmData.vp_result_raw || null
    });
    assert(data.ok === true, "finalizeVP returned ok=false");
    assert(data.status === "phase4", `finalizeVP status=${data.status}, expected phase4`);
  });

  await runStep(result, "r1_get_phase4", async () => {
    const data = await stepApi(api, "R1.7_get_phase4").getPhase4(teamId);
    assert(data.ok === true, "getPhase4 returned ok=false");
    assert(data.team?.final_grid_id || data.r1_result?.grid_id, "phase4 missing final grid");
    assert(data.vp_scores || data.vp_summary, "phase4 missing VP result data");
    result.meta.round1 = {
      grid_id: majority.grid_id,
      architecture: majority.architecture,
      vp_scores: data.vp_scores || null,
      used_best_iteration: tracker.team.vp_used_best === true,
      vp_best_iteration: tracker.team.vp_best_iteration,
      vp_best_score: tracker.team.vp_best_score
    };
    tracker.recordPhase4(data);
  });

  await runStep(result, "r1_freeze", async () => {
    const data = await stepApi(api, "R1.8_freeze", leaderMemberId).freezeTeam(teamId, {
      member_id: leaderMemberId
    });
    assert(data.ok === true, "freezeTeam returned ok=false");
    assert(data.status === "frozen", `freezeTeam status=${data.status}, expected frozen`);
  });

  return { teamId, members, memberActors };
}

async function runRound2(result, api, teamId, members, memberActors, teamIndex, options, tracker) {
  const round2Disabled = String(process.env.SKIP_ROUND2 || "").trim() === "1";
  if (round2Disabled) {
    skip(result, "r2_all", "SKIP_ROUND2=1");
    return;
  }

  let recap = null;
  try {
    recap = await runStep(result, "r2_get_recap", async () => {
      const data = await stepApi(api, "R2.0_get_recap").getRecap(teamId);
      assert(data.ok === true, "round2 recap returned ok=false");
      assert(String(data.final_grid_id || "").trim(), "round2 recap missing final_grid_id");
      return data;
    });
  } catch (err) {
    if (isNotFound(err)) {
      skip(result, "r2_get_recap", "Round 2 recap endpoint not available");
      skip(result, "r2_all", "Round 2 endpoints unavailable");
      return;
    }
    throw err;
  }

  let assignedDimensionRows = [];
  const stateData = await runStep(result, "r2_get_state", async () => {
    const round2SessionId = resolveExplicitSessionId(options);
    const assignData = round2SessionId
      ? await stepApi(api, "R2.0_assign_dimensions").post("/api/round2/assign-dimensions", {
          teamId,
          memberCount: members.length,
          sessionId: round2SessionId,
          session_id: round2SessionId
        })
      : await stepApi(api, "R2.0_assign_dimensions").assignDimensions(teamId, members.length);
    assignedDimensionRows = Array.isArray(assignData.assignments) ? assignData.assignments : [];
    const data = round2SessionId
      ? await stepApi(api, "R2.0_get_state").get(`/api/round2/state?${buildSummaryQuery({ teamId, sessionId: round2SessionId, session_id: round2SessionId })}`)
      : await stepApi(api, "R2.0_get_state").getRound2State(teamId);
    assert(data.ok === true, "round2 state returned ok=false");
    assert(Array.isArray(data.members), "round2 state missing members");
    return data;
  });

  const assignments = normalizeAssignments(
    (assignedDimensionRows.length > 0 ? assignedDimensionRows : stateData.members).map((member) => ({
      memberId: member.memberId || member.id,
      memberName: member.memberName || member.name,
      dims: Array.isArray(member.dims) ? member.dims : []
    })),
    members
  );
  tracker.recordAssignments(assignments);

  if (normalizeInterviewMode(stateData) !== "live") {
    await runRound2Summary(result, api, teamId, members, memberActors, teamIndex, options, tracker, {
      recap,
      stateData,
      assignments
    });
    return;
  }

  const interviewMembers = assignments.filter((assignment) => assignment.dims.length > 0);
  const sessionIds = new Set();
  const interviewResults = await runStep(result, "r2_interviews", async () => {
    const out = await Promise.all(interviewMembers.map(async (assignment) => {
      const student = new DeepSeekStudent({
        apiKey: process.env.DEEPSEEK_API_KEY,
        strictMode: options.strictDeepSeek,
        logger: options.logger,
        teamId,
        memberId: assignment.memberId,
        teamProfile: {
          teamIndex,
          memberIndex: members.findIndex((member) => member.id === assignment.memberId),
          memberName: assignment.memberName
        }
      });
      const memberIndex = members.findIndex((member) => member.id === assignment.memberId);
      const actor = getStudentProfile(options, memberIndex)
        ? memberActors[memberIndex]
        : student;
      const startData = await stepApi(api, "R2.1_start_interview", assignment.memberId).startInterview(teamId, assignment.memberId, {
        memberDims: assignment.dims
      });
      assert(startData.ok === true, `startInterview failed for ${assignment.memberName}`);
      assert(String(startData.sessionId || "").trim(), `startInterview missing sessionId for ${assignment.memberName}`);
      sessionIds.add(startData.sessionId);

      const history = [];
      let lastPersonaReply = String(startData.persona?.desc || startData.persona?.name || "我们可以开始聊。");
      let replyData = null;
      for (let turn = 0; turn < 5; turn += 1) {
        const message = await actor.generateInterviewReply(lastPersonaReply, history, assignment.dims);
        history.push({ role: "user", content: message });
        replyData = await stepApi(api, "R2.1_reply_interview", assignment.memberId).replyInterview(startData.sessionId, message);
        assert(replyData.ok === true, `interview reply failed for ${assignment.memberName} turn ${turn + 1}`);
        assert(String(replyData.reply || "").trim(), `interview reply empty for ${assignment.memberName} turn ${turn + 1}`);
        lastPersonaReply = replyData.reply;
        history.push({ role: "assistant", content: lastPersonaReply });
        if (replyData.isComplete === true) break;
      }

        const endData = replyData?.isComplete === true
        ? replyData
        : await stepApi(api, "R2.1_end_interview", assignment.memberId).endInterview(startData.sessionId);
      assert(endData.ok === true, `endInterview failed for ${assignment.memberName}`);
      assert(endData.isComplete === true, `interview did not complete for ${assignment.memberName}`);
      assert(endData.round <= 10, `interview round exceeded limit for ${assignment.memberName}`);
      assert(endData.radar && typeof endData.radar === "object", `interview radar missing for ${assignment.memberName}`);
      tracker.recordInterview(assignment.memberId, history, endData, {
        interview_persona_id: startData.persona?.id || null,
        interview_persona_name: startData.persona?.name || null
      });
      return {
        memberId: assignment.memberId,
        dims: assignment.dims,
        sessionId: startData.sessionId,
        radar: endData.radar,
        tags: endData.tags || [],
        evi: endData.evi
      };
    }));

    assert(sessionIds.size === interviewMembers.length, "interview session ids are not unique");
    return out;
  });

  const cardsData = await runStep(result, "r2_get_cards", async () => {
    const cards = await stepApi(api, "R2.3_get_rd_cards").getRDCards();
    assert(cards.ok === true, "getRDCards returned ok=false");
    assert(Array.isArray(cards.groups), "getRDCards missing groups");
    return cards;
  });
  const fallbackPlan = planSelections(assignments, members.length);
  const budgetCap = Math.round(Number(recap.Pmax || recap.WTP || recap.P || 0) * 0.2);
  const selectionContexts = assignments.map((assignment) => {
    const member = tracker.getMember(assignment.memberId);
    const memberIndex = members.findIndex((item) => item.id === assignment.memberId);
    return {
      assignment,
      member,
      memberIndex,
      actor: getStudentProfile(options, memberIndex)
        ? memberActors[memberIndex]
        : createStudentActor(options, teamIndex, memberIndex, teamId, assignment.memberId, assignment.memberName),
      fallbackSelections: fallbackPlan.byMember.get(assignment.memberId) || []
    };
  });

  async function saveSelectionsForContexts(validationIssues = null, forceFallback = false) {
    const issues = normalizeViolationsList(validationIssues);
    await Promise.all(selectionContexts.map(async (context) => {
      const currentMember = tracker.getMember(context.assignment.memberId);
      const generatedSelections = forceFallback
        ? context.fallbackSelections
        : (typeof context.actor.generateCardSelection === "function"
          ? await context.actor.generateCardSelection({
              cards: cardsData,
              interviewSummary: buildInterviewSummary(currentMember, interviewResults),
              assignedDims: context.assignment.dims,
              budgetCap,
              fallbackSelections: context.fallbackSelections,
              validationIssues: issues,
              previousSelections: currentMember?.r2_personal_selections || []
            })
          : context.fallbackSelections);
      const storedSelections = Array.isArray(generatedSelections) && generatedSelections.length > 0
        ? generatedSelections
        : context.fallbackSelections;
      const apiSelections = storedSelections.map((item) => ({
        cap_id: item.cap_id,
        tier: item.tier
      }));
      const data = await stepApi(api, "R2.4_member_selection", context.assignment.memberId).saveMemberSelection(
        teamId,
        context.assignment.memberId,
        apiSelections
      );
      assert(data.ok === true, `saveMemberSelection failed for ${context.assignment.memberName}`);
      assert(Number(data.count) === apiSelections.length, `selection count mismatch for ${context.assignment.memberName}`);
      tracker.recordPersonalSelections(context.assignment.memberId, storedSelections);
    }));
  }

  async function mergeTeamSelections() {
    const data = await stepApi(api, "R2.5_merge_team").mergeTeam(teamId, recap.COGSbase || "");
    assert(data.ok === true, "mergeTeam returned ok=false");
    assert(Array.isArray(data.teamSelections), "mergeTeam missing teamSelections");
    assert(data.teamSelections.length >= 6, `mergeTeam card_count=${data.teamSelections.length}, expected at least 6`);
    tracker.recordMerge(data);
    return data;
  }

  async function validateMergedSelections(currentMergeData) {
    const data = await stepApi(api, "R2.6_validate").validateSelections({
      selections: currentMergeData.teamSelections,
      COGSbase: recap.COGSbase || 600
    });
    assert(data.ok === true, "validateSelections returned ok=false");
    return data;
  }

  await runStep(result, "r2_member_selections", async () => {
    assert(fallbackPlan.merged.length >= 6, `planned merged selections=${fallbackPlan.merged.length}, expected at least 6`);
    await saveSelectionsForContexts();
  });

  let mergeData = await runStep(result, "r2_merge_team", async () => mergeTeamSelections());

  await runStep(result, "r2_validate", async () => {
    let validation = await validateMergedSelections(mergeData);
    let retryCount = 0;

    while (validation.valid !== true && retryCount < 2) {
      await saveSelectionsForContexts(validation.violations || []);
      mergeData = await mergeTeamSelections();
      validation = await validateMergedSelections(mergeData);
      retryCount += 1;
    }

    if (validation.valid !== true) {
      await saveSelectionsForContexts(validation.violations || [], true);
      mergeData = await mergeTeamSelections();
      validation = await validateMergedSelections(mergeData);
    }

    assert(validation.valid === true, `validateSelections returned valid=${validation.valid}`);
  });

  const pricingStudent = memberActors[0] || createStudentActor(
    options,
    teamIndex,
    0,
    teamId,
    members[0]?.id || null,
    members[0]?.member_name || "成员1"
  );
  const pricingUi = loadPricingUiConfig();
  const channelFee = round2ChannelFeePercent(recap.final_grid_id);
  const costSummary = summarizeSelectionCosts(mergeData.teamSelections, recap.COGSbase || 600);
  const demandSummary = buildPricingDemandSummary(tracker);
  if (costSummary.missingCapabilityIds.length > 0) {
    warn(result, "pricing cost summary skipped unknown capabilities", {
      missing_capability_ids: costSummary.missingCapabilityIds
    });
  }
  const price = await pricingStudent.generatePriceChoice({
    basePrice: pricingUi.default_price,
    min: pricingUi.price_min,
    max: pricingUi.price_max,
    step: pricingUi.price_step,
    defaultPrice: pricingUi.default_price,
    totalCOGS: costSummary.unitVariableCost,
    baseVariableCost: costSummary.baseVariableCost,
    dCOGSTotal: costSummary.dCOGSTotal,
    fbaseWan: costSummary.fbaseWan,
    nreTotalWan: costSummary.nreTotalWan,
    upfrontInvestmentWan: costSummary.upfrontInvestmentWan,
    channelFee,
    demandSummary
  });
  const pricingWtp = Number(tracker.team.r1_wtp_adj || recap.wtp_breakdown?.final_result?.WTPadj || 0);
  tracker.recordPrice(price, pricingWtp > 0 ? Number((price / pricingWtp).toFixed(4)) : null);

  const previewData = await runStep(result, "r2_calculate_preview", async () => {
    const calcGridId = toCalcGridId(recap.final_grid_id, recap.architecture || stateData.round1_context?.architecture || "");
    const data = await stepApi(api, "R2.7_calculate_preview").calculateRD({
      gridId: calcGridId,
      round1GridId: recap.final_grid_id,
      selections: mergeData.teamSelections,
      radar: mergeData.mergedInterview?.radar || {},
      tags: mergeData.mergedInterview?.tags || [],
      evi: Number.isFinite(Number(mergeData.mergedInterview?.evi)) ? Number(mergeData.mergedInterview.evi) : 0.7,
      P: price,
      Pmax: Number(recap.Pmax || 0),
      WTP: Number(recap.WTP || 0),
      e: Number(recap.e || 1.2),
      COGSbase: Number(recap.COGSbase || 600),
      TAM: Number(recap.TAM || 50000),
      H: Number(recap.H || 0.3),
      wtp_multiplier: tracker.team.r1_wtp_multiplier,
      WTPref_override: Number(tracker.team.r1_wtp_ref || 0) > 0 ? Number(tracker.team.r1_wtp_ref) * PRICE_SCALE : undefined,
      teamId,
      sessionId: "preview"
    });
    assert(data.ok === true, "calculateRD returned ok=false");
    assert(Number.isFinite(Number(data.share)), "calculateRD missing share");
    assert(Number.isFinite(Number(data.units)), "calculateRD missing units");
    assert(Number.isFinite(Number(data.profit)), "calculateRD missing profit");
    return data;
  });
  tracker.team.r2_coverCore = Number.isFinite(Number(previewData.coverCore)) ? Number(previewData.coverCore) : tracker.team.r2_coverCore;
  tracker.team.r2_coverNice = Number.isFinite(Number(previewData.coverNice)) ? Number(previewData.coverNice) : tracker.team.r2_coverNice;

  await runStep(result, "r2_submit_final", async () => {
    const round2LeaderMemberId = resolveLeaderMemberId(
      stateData.leader_member_id,
      stateData.leaderMemberId,
      members[0]?.id
    );
    const data = await stepApi(api, "R2.7_submit_final").submitFinal(teamId, {
      member_id: round2LeaderMemberId,
      price,
      selections: mergeData.teamSelections,
      radar: mergeData.mergedInterview?.radar || {},
      tags: mergeData.mergedInterview?.tags || [],
      evi: Number.isFinite(Number(mergeData.mergedInterview?.evi)) ? Number(mergeData.mergedInterview.evi) : 0.7,
      bestGrid: recap.final_grid_id,
      wtp_multiplier: tracker.team.r1_wtp_multiplier
    });
    assert(data.ok === true, "submitFinal returned ok=false");
    assert(data.result && typeof data.result === "object", "submitFinal missing result");
    assert(Number.isFinite(Number(data.result.profit)), "submitFinal missing result.profit");
    assert(Number.isFinite(Number(data.result.units)), "submitFinal missing result.units");
  });

  const teamResultData = await runStep(result, "r2_get_team_result", async () => {
    const data = await stepApi(api, "R2.7_get_team_result").getTeamResult(teamId);
    assert(data.ok === true, "getTeamResult returned ok=false");
    assert(data.result && typeof data.result === "object", "getTeamResult missing result");
    assert(Number.isFinite(Number(data.result.profit)), "team result profit is not finite");
    return data;
  });
  tracker.recordFinalResult(previewData, teamResultData);

  result.meta.round2 = {
    interview_member_count: interviewResults.length,
    preview_profit: Number(previewData.profit || 0),
    price
  };
}

async function runTeam(teamIndex, teamSize, api, logger, log = console, options = {}) {
  const result = createTeamResult(teamIndex, teamSize);
  const tracker = new DecisionTracker(teamIndex, teamSize);
  options.log = log;
  options.logger = logger || null;
  try {
    const { teamId, members, memberActors } = await runRound1(result, api, teamSize, teamIndex, options, tracker);
    await runRound2(result, api, teamId, members, memberActors, teamIndex, options, tracker);
  } catch (_) {
    // step-level errors are already recorded; stop remaining work for this team
  }
  finishResult(result);
  Object.defineProperty(result, "tracker", {
    value: tracker,
    enumerable: false
  });
  const icon = result.status === "passed" ? "✅" : "❌";
  const message = `${icon} Team ${teamIndex + 1} ${result.status} (${Object.keys(result.timing).length} steps)`;
  logLine(log, options.logLevel !== "quiet", message);
  return result;
}

module.exports = {
  runTeam
};
