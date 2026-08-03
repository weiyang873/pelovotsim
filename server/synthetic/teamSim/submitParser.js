"use strict";

const { chatCompletion } = require("../../llm/deepseekClient");

const GRID_IDS = [
  "ToC_DIFF_CHILD",
  "ToC_COST_CHILD",
  "ToB_DIFF_CHILD",
  "ToB_COST_CHILD",
  "ToC_DIFF_ADULT",
  "ToC_COST_ADULT",
  "ToB_DIFF_ADULT",
  "ToB_COST_ADULT",
  "ToC_DIFF_ELDER",
  "ToC_COST_ELDER",
  "ToB_DIFF_ELDER",
  "ToB_COST_ELDER"
];

const ARCHITECTURES = new Set(["Experience", "Hybrid", "Function"]);
const TIERS = new Set(["low", "mid", "high"]);

function parseJsonLoose(raw) {
  const text = String(raw).replace(/```json|```/g, "").trim();
  try {
    return JSON.parse(text);
  } catch (_) {
    const left = text.indexOf("{");
    const right = text.lastIndexOf("}");
    if (left >= 0 && right > left) {
      return JSON.parse(text.slice(left, right + 1));
    }
  }
  throw new Error("json_parse_failed");
}

function requireText(value, field) {
  const text = String(value ?? "").trim();
  if (!text) throw new Error(`${field} required`);
  return text;
}

function normalizeArchitecture(value) {
  const raw = String(value ?? "").trim();
  const lower = raw.toLowerCase();
  if (lower === "experience" || raw.includes("体验")) return "Experience";
  if (lower === "hybrid" || raw.includes("混合")) return "Hybrid";
  if (lower === "function" || raw.includes("功能")) return "Function";
  throw new Error(`invalid architecture: ${value}`);
}

function validateR1(parsed) {
  const gridId = requireText(parsed.grid_id, "grid_id");
  if (!GRID_IDS.includes(gridId)) throw new Error(`invalid grid_id: ${gridId}`);
  const architecture = normalizeArchitecture(parsed.architecture);
  if (!ARCHITECTURES.has(architecture)) throw new Error(`invalid architecture: ${architecture}`);
  return {
    grid_id: gridId,
    architecture,
    vp_summary: {
      who: requireText(parsed.vp_summary?.who ?? parsed.vp_draft?.who, "vp_summary.who"),
      pain: requireText(parsed.vp_summary?.pain ?? parsed.vp_draft?.pain, "vp_summary.pain"),
      how: requireText(parsed.vp_summary?.how ?? parsed.vp_draft?.how, "vp_summary.how")
    },
    rationale: requireText(parsed.rationale ?? parsed.reason, "rationale")
  };
}

function validatePrototype(parsed) {
  const prototype = requireText(parsed.prototype, "prototype");
  if (!["elder_care", "adult_companion"].includes(prototype)) {
    throw new Error(`invalid prototype: ${prototype}`);
  }
  return {
    prototype,
    rationale: requireText(parsed.rationale ?? parsed.reason, "rationale")
  };
}

function buildCapabilitySet(capabilityGroups) {
  const ids = new Set();
  const groupByCap = new Map();
  for (const group of capabilityGroups.groups) {
    for (const cap of group.capabilities) {
      ids.add(cap.cap_id);
      groupByCap.set(cap.cap_id, group.group_id);
    }
  }
  return { ids, groupByCap };
}

function readSelectionConstraints(context) {
  const perGroupMin = Number(context.selectionConstraints?.per_group_min);
  const totalMin = Number(context.selectionConstraints?.total_min);
  if (!Number.isFinite(perGroupMin) || perGroupMin < 1) {
    throw new Error("selection_constraints.per_group_min must be >= 1");
  }
  if (!Number.isFinite(totalMin) || totalMin < 1) {
    throw new Error("selection_constraints.total_min must be >= 1");
  }
  return { perGroupMin, totalMin };
}

function validateCards(parsed, context) {
  const cards = Array.isArray(parsed.cards) ? parsed.cards : [];
  if (!cards.length) throw new Error("cards required");
  const { perGroupMin } = readSelectionConstraints(context);
  const { ids, groupByCap } = buildCapabilitySet(context.capabilityGroups);
  const allowedGroups = new Set(context.allowedGroups);
  const normalized = cards.map((card) => {
    const capId = requireText(card.cap_id ?? card.id, "card.cap_id");
    const tier = requireText(card.tier, "card.tier");
    if (!ids.has(capId)) throw new Error(`unknown cap_id: ${capId}`);
    if (!TIERS.has(tier)) throw new Error(`invalid tier for ${capId}: ${tier}`);
    const groupId = groupByCap.get(capId);
    if (!allowedGroups.has(groupId)) throw new Error(`cap_id not in current segment: ${capId}`);
    return { cap_id: capId, tier };
  });
  const groupCounts = new Map();
  for (const card of normalized) {
    const groupId = groupByCap.get(card.cap_id);
    groupCounts.set(groupId, (groupCounts.get(groupId) ?? 0) + 1);
  }
  for (const groupId of allowedGroups) {
    const count = groupCounts.get(groupId) ?? 0;
    if (count < perGroupMin) {
      throw new Error(`segment group must have at least ${perGroupMin} card(s): ${groupId}, got ${count}`);
    }
  }
  return {
    cards: normalized,
    rationale: requireText(parsed.rationale ?? parsed.reason, "rationale")
  };
}

function validatePrice(parsed, context) {
  const price = Number(parsed.price);
  if (!Number.isFinite(price)) throw new Error("price must be finite");
  if (price < context.priceMin || price > context.priceMax) {
    throw new Error(`price out of range: ${price}`);
  }
  return {
    price: Math.round(price),
    rationale: requireText(parsed.rationale ?? parsed.reason, "rationale")
  };
}

function parserInstruction(decisionType, context) {
  if (decisionType === "r1") {
    return `抽取 Round 1 最终提交。输出 JSON：{"grid_id":"12格之一","architecture":"Experience|Hybrid|Function","vp_summary":{"who":"...","pain":"...","how":"..."},"rationale":"..."}。合法 grid_id：${GRID_IDS.join(", ")}`;
  }
  if (decisionType === "prototype") {
    return '抽取 R2 客户原型选择。输出 JSON：{"prototype":"elder_care|adult_companion","rationale":"..."}。';
  }
  if (decisionType === "cards") {
    const { perGroupMin, totalMin } = readSelectionConstraints(context);
    return `抽取当前选卡段的最终卡片。只允许当前段 group：${context.allowedGroups.join(", ")}；当前段每个 group 至少 ${perGroupMin} 张；全队最终累计总数至少 ${totalMin} 张；无硬性总数上限。输出 JSON：{"cards":[{"cap_id":"真实cap_id","tier":"low|mid|high"}],"rationale":"..."}。`;
  }
  if (decisionType === "price") {
    return `抽取最终定价。合法区间 ${context.priceMin}-${context.priceMax}。输出 JSON：{"price":数字,"rationale":"..."}。`;
  }
  throw new Error(`unknown decision type: ${decisionType}`);
}

function validateParsed(decisionType, parsed, context) {
  if (decisionType === "r1") return validateR1(parsed);
  if (decisionType === "prototype") return validatePrototype(parsed);
  if (decisionType === "cards") return validateCards(parsed, context);
  if (decisionType === "price") return validatePrice(parsed, context);
  throw new Error(`unknown decision type: ${decisionType}`);
}

async function parseSubmission({ text, decisionType, context, temperature }) {
  const messages = [
    {
      role: "system",
      content: "你是商业模拟提交解析器。只抽取发言中明确提交的内容，不补充、不猜测、不代填。只输出 JSON。"
    },
    {
      role: "user",
      content: `${parserInstruction(decisionType, context)}\n\n组长发言：\n${String(text)}`
    }
  ];
  const raw = await chatCompletion(messages, {
    role: "chat_service",
    temperature,
    max_tokens: 900,
    timeoutMs: 90000,
    maxRetries: 2,
    disableThinking: true
  });
  const parsed = parseJsonLoose(raw);
  return {
    raw,
    parsed: validateParsed(decisionType, parsed, context)
  };
}

module.exports = {
  parseSubmission,
  parseJsonLoose,
  validateParsed,
  GRID_IDS
};
