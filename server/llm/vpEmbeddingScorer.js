"use strict";

const fs = require("fs");
const path = require("path");

const { chatCompletion } = require("./deepseekClient");
const { withLlmLogging } = require("./llm_logger");
const embeddingService = require("./embeddingService");

const LLM_TIMEOUT_MS = 60000;

const PROFILES_PATH = path.join(__dirname, "..", "..", "game_config_v0.1", "vp_anchor_profiles.json");
const EMBEDDINGS_PATH = path.join(__dirname, "..", "..", "game_config_v0.1", "vp_anchor_embeddings.json");

const GRID_TO_PROFILE = {
  "ToB_Differentiation_Elder": { market: "ToB_Elder", strategy: "Differentiation" },
  "ToB_Cost_Elder": { market: "ToB_Elder", strategy: "Cost" },
  "ToB_Differentiation_Adult": { market: "ToB_Adult", strategy: "Differentiation" },
  "ToB_Cost_Adult": { market: "ToB_Adult", strategy: "Cost" },
  "ToB_Differentiation_Child": { market: "ToB_Child", strategy: "Differentiation" },
  "ToB_Cost_Child": { market: "ToB_Child", strategy: "Cost" },
  "ToC_Differentiation_Elder": { market: "ToC_Elder", strategy: "Differentiation" },
  "ToC_Cost_Elder": { market: "ToC_Elder", strategy: "Cost" },
  "ToC_Differentiation_Adult": { market: "ToC_Adult", strategy: "Differentiation" },
  "ToC_Cost_Adult": { market: "ToC_Adult", strategy: "Cost" },
  "ToC_Differentiation_Child": { market: "ToC_Child", strategy: "Differentiation" },
  "ToC_Cost_Child": { market: "ToC_Child", strategy: "Cost" }
};

let cachedProfiles = null;
let cachedAnchors = null;

function parseJsonLoose(raw) {
  const text = String(raw || "").replace(/```json|```/gi, "").trim();
  try {
    return JSON.parse(text);
  } catch (_) {}

  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start >= 0 && end > start) {
    return JSON.parse(text.slice(start, end + 1));
  }
  throw new Error("json parse failed");
}

function normalizeArchitectureKey(architectureLabel) {
  const text = String(architectureLabel || "").trim();
  if (text === "Experience" || text === "体验" || text === "体验型") return "Experience";
  if (text === "Hybrid" || text === "混合" || text === "混合型") return "Hybrid";
  if (text === "Function" || text === "功能" || text === "功能型") return "Function";
  return text || "Hybrid";
}

function gridToProfileKey(gridLabel) {
  const text = String(gridLabel || "");
  const channel = /ToB/i.test(text) ? "ToB" : "ToC";
  const strategy = /差异/.test(text) ? "Differentiation" : "Cost";
  const age = /老人/.test(text) ? "Elder" : (/儿童/.test(text) ? "Child" : "Adult");
  return `${channel}_${strategy}_${age}`;
}

function cosine(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length === 0 || a.length !== b.length) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

function clipScore(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.round(Math.max(1.0, Math.min(5.0, n)) * 10) / 10;
}

function rawToScore(raw) {
  return Math.max(1.0, Math.min(5.0, Math.round(raw * 5 * 10) / 10));
}

function scoreBoundary(boundaryText, marketKey) {
  if (!boundaryText || boundaryText === "未明确") return 0.0;

  const text = String(boundaryText).trim();
  if (text.length < 4) return 0.0;

  const relevantKeywords = {
    "ToB_Elder": ["失智", "认知障碍", "重症", "自理", "瘫痪", "临终", "夜间", "白天"],
    "ToB_Adult": ["隐私", "噪音", "空间", "人流", "高峰"],
    "ToB_Child": ["年龄", "婴儿", "特殊需求", "过敏", "恐惧", "空间"],
    "ToC_Elder": ["失智", "认知", "视力", "听力", "行动不便", "抗拒"],
    "ToC_Adult": ["出差", "长期不在", "多人", "空间", "抵触"],
    "ToC_Child": ["年龄", "婴幼儿", "过敏", "上瘾", "屏幕"]
  };

  const keywords = relevantKeywords[marketKey] || [];
  const isRelevant = keywords.some((keyword) => text.includes(keyword));
  return isRelevant ? 1.0 : 0.5;
}

function loadProfiles() {
  if (!cachedProfiles) {
    cachedProfiles = JSON.parse(fs.readFileSync(PROFILES_PATH, "utf8"));
  }
  return cachedProfiles;
}

function loadAnchors() {
  if (!cachedAnchors) {
    cachedAnchors = JSON.parse(fs.readFileSync(EMBEDDINGS_PATH, "utf8"));
  }
  return cachedAnchors;
}

function buildExtractPrompt(vpText, options = {}) {
  const last5Turns = String(options.last5Turns || "").trim();
  return `你是一个文本切片工具。把下面这句价值主张拆成 5 个字段。

规则：
- 只从原文中切出相关片段，不要改写、润色、抽象化
- 保留原文的核心名词和动词
- 如果某个字段在原文中没有提到，填 "未明确"
- 不要补充原文里没有的信息
- 只输出 JSON
- 重要：who 只放客户身份描述（是谁、什么类型、什么规模），
  不要放处境和状态描述（加班、孤独、忙不过来这些放到 pain 里）
- 重要：boundary 是"什么情况下这个方案不管用/有局限"，
  包括排除的人群、不适用的场景、需要额外条件的情况。
  "XX除外""XX不适用""需结合XX"这类表述都算 boundary

以下是学生和 AI 策略顾问的对话记录（仅供参考）：
${last5Turns || "（无）"}

以下是学生最终确认的价值主张：
"${vpText}"

请从价值主张原文和对话记录中，提取 5 个字段。

补充要求：
- 优先使用价值主张原文；只有原文没写清、但对话里明确提到时，才允许从对话里补足
- alternative 可以从对话里捞学生明确提到的“现有做法/替代方案”
- boundary 可以从对话里捞学生明确提到的“不适用场景/边界条件”

输出格式：
{
  "who_raw": "目标客户是谁（只放身份，不放处境）",
  "pain_raw": "痛点是什么（包括处境、状态、困境）",
  "how_raw": "怎么解决的",
  "alternative_raw": "跟什么替代方案比",
  "boundary_raw": "什么时候不管用/有局限"
}`;
}

async function extractVpFields(vpText, options = {}) {
  const messages = [
    { role: "system", content: "你是一个文本切片工具。只输出 JSON。" },
    { role: "user", content: buildExtractPrompt(vpText, options) }
  ];

  const raw = await withLlmLogging({
    caller: "vpEmbeddingScorer.extractVpFields",
    teamId: null,
    memberId: null,
    messages
  }, () => chatCompletion(messages, { role: "vp_embedding_scorer", temperature: 0, max_tokens: 1200, timeoutMs: LLM_TIMEOUT_MS }));

  const parsed = parseJsonLoose(raw);
  return {
    who_raw: String(parsed.who_raw || "未明确").trim() || "未明确",
    pain_raw: String(parsed.pain_raw || "未明确").trim() || "未明确",
    how_raw: String(parsed.how_raw || "未明确").trim() || "未明确",
    alternative_raw: String(parsed.alternative_raw || "未明确").trim() || "未明确",
    boundary_raw: String(parsed.boundary_raw || "未明确").trim() || "未明确",
    raw: String(raw || "")
  };
}

async function getEmbedding(text) {
  await embeddingService.init();
  return embeddingService.embed(text);
}

function buildFeedbackFromDetails(scores, details, fields) {
  return [
    `C ${scores.C}/5.0：目标客户与场景匹配度 ${details.who_sim.toFixed(2)}/${details.pain_summary_sim.toFixed(2)}，客户表述是“${fields.who_raw}”。`,
    `G ${scores.G}/5.0：痛点与市场高频痛点的 top match 为 ${details.pain_top2.map((item) => `${item.sim.toFixed(2)}*${item.weight}`).join(", ")}。`,
    `E ${scores.E}/5.0：解法匹配 market/strategy/arch = ${details.how_market_sim.toFixed(2)}/${details.how_strategy_sim.toFixed(2)}/${details.how_arch_sim.toFixed(2)}，替代方案匹配 ${details.alt_sim.toFixed(2)}，边界 ${details.boundary_score.toFixed(2)}。`
  ].join("\n");
}

async function scoreVpByEmbedding(vpText, gridLabel, architectureLabel) {
  if (!vpText || vpText.length < 10) {
    return {
      fields: null,
      scores: null,
      feedback: "VP 文本过短，无法评分。",
      details: null,
      raw: null
    };
  }

  const profileKey = gridToProfileKey(gridLabel);
  const mapping = GRID_TO_PROFILE[profileKey];
  if (!mapping) {
    throw new Error(`Unknown grid mapping: ${gridLabel}`);
  }

  const marketKey = mapping.market;
  const strategyKey = mapping.strategy;
  const archKey = normalizeArchitectureKey(architectureLabel);
  const profiles = loadProfiles();
  const anchors = loadAnchors();
  const fields = await extractVpFields(vpText);

  const whoVec = await getEmbedding(fields.who_raw);
  const painVec = await getEmbedding(fields.pain_raw);
  const howVec = await getEmbedding(fields.how_raw);
  const altVec = fields.alternative_raw !== "未明确" ? await getEmbedding(fields.alternative_raw) : null;

  const simWho = cosine(whoVec, anchors[`market.${marketKey}.customer_group`]);
  const simPainSummary = cosine(painVec, anchors[`market.${marketKey}.solution_expectations`]);
  const cRaw = 0.55 * simWho + 0.45 * simPainSummary;

  const painAnchors = profiles.market[marketKey].pain_anchors;
  const painMatches = painAnchors.map((anchor, index) => ({
    text: anchor.text,
    sim: cosine(painVec, anchors[`market.${marketKey}.pain_anchor_${index}`]),
    weight: anchor.weight
  }));
  painMatches.sort((a, b) => (b.sim * b.weight) - (a.sim * a.weight));
  const top2 = painMatches.slice(0, 2);
  const gPain = (top2[0].sim * top2[0].weight + (top2[1]?.sim * top2[1]?.weight || 0)) /
    (top2[0].weight + (top2[1]?.weight || 0));
  const simPainStrategy = cosine(painVec, anchors[`strategy.${strategyKey}.customer_traits`]);
  const gRaw = 0.7 * gPain + 0.3 * simPainStrategy;

  const simHowMarket = cosine(howVec, anchors[`market.${marketKey}.solution_expectations`]);
  const simHowStrategy = cosine(howVec, anchors[`strategy.${strategyKey}.solution_expectations`]);
  const simHowArch = cosine(howVec, anchors[`architecture.${archKey}.solution_expectations`]);
  const simAlt = altVec ? cosine(altVec, anchors[`market.${marketKey}.alternatives`]) : 0;
  const boundaryScore = scoreBoundary(fields.boundary_raw, marketKey);
  const eRaw = 0.30 * simHowMarket + 0.25 * simHowStrategy + 0.25 * simHowArch + 0.12 * simAlt + 0.08 * boundaryScore;

  const scores = {
    C: clipScore(rawToScore(cRaw)),
    G: clipScore(rawToScore(gRaw)),
    E: clipScore(rawToScore(eRaw))
  };

  const details = {
    marketKey,
    strategyKey,
    archKey,
    who_sim: simWho,
    pain_summary_sim: simPainSummary,
    pain_top2: top2.map((item) => ({ text: item.text, sim: item.sim, weight: item.weight })),
    pain_strategy_sim: simPainStrategy,
    how_market_sim: simHowMarket,
    how_strategy_sim: simHowStrategy,
    how_arch_sim: simHowArch,
    alt_sim: simAlt,
    boundary_score: boundaryScore,
    raw_scores: {
      C_raw: cRaw,
      G_raw: gRaw,
      E_raw: eRaw
    }
  };

  return {
    fields,
    scores,
    details,
    feedback: buildFeedbackFromDetails(scores, details, fields),
    raw: {
      extractReply: fields.raw
    }
  };
}

module.exports = {
  scoreVpByEmbedding,
  extractVpFields,
  loadAnchors,
  rawToScore,
  scoreBoundary
};
