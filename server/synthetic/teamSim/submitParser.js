"use strict";

const { chatCompletion } = require("../../llm/deepseekClient");
const { validateRound2Price } = require("../../multiplayer/pricingContext");

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
const PRICING_ACTIONS = new Set(["lower_price_for_volume", "higher_price_for_margin"]);

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

function firstText(...values) {
  for (const value of values) {
    const text = String(value ?? "").trim();
    if (text) return text;
  }
  return "";
}

function fallbackRationale(parsed, fallback) {
  return firstText(
    parsed.rationale,
    parsed.reason,
    parsed.explanation,
    parsed["理由"],
    parsed["原因"],
    fallback
  );
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
  const vp = parsed.vp_summary || parsed.vp_draft || parsed.value_proposition || parsed["价值主张"] || {};
  const who = firstText(vp.who, vp.WHO, vp.target_user, vp.customer, vp.segment, vp["目标用户"], vp["用户"], parsed.who, parsed.WHO, parsed["目标用户"]);
  const pain = firstText(vp.pain, vp.PAIN, vp.pain_point, vp.problem, vp.need, vp["痛点"], vp["需求"], parsed.pain, parsed.PAIN, parsed["痛点"]);
  const how = firstText(vp.how, vp.HOW, vp.solution, vp.approach, vp.value, vp["方案"], vp["解决方案"], parsed.how, parsed.HOW, parsed["方案"]);
  return {
    grid_id: gridId,
    architecture,
    vp_summary: {
      who: requireText(who, "vp_summary.who"),
      pain: requireText(pain, "vp_summary.pain"),
      how: requireText(how, "vp_summary.how")
    },
    rationale: requireText(fallbackRationale(parsed, how), "rationale")
  };
}

function validatePrototype(parsed) {
  const prototype = requireText(parsed.prototype, "prototype");
  if (!["elder_care", "adult_companion"].includes(prototype)) {
    throw new Error(`invalid prototype: ${prototype}`);
  }
  return {
    prototype,
    rationale: requireText(fallbackRationale(parsed, prototype), "rationale")
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

function allowedCardRows(context) {
  const groups = Array.isArray(context.allowedGroups) ? new Set(context.allowedGroups) : null;
  const rows = [];
  for (const group of context.capabilityGroups.groups || []) {
    if (groups && !groups.has(group.group_id)) continue;
    for (const cap of group.capabilities || []) {
      rows.push({
        group_id: group.group_id,
        cap_id: cap.cap_id,
        name: cap.name || cap.cap_id
      });
    }
  }
  return rows;
}

function formatAllowedCards(context) {
  const rows = Array.isArray(context.allowedCards) && context.allowedCards.length
    ? context.allowedCards
    : allowedCardRows(context);
  return rows
    .map((row) => `${row.cap_id}（${row.name || row.cap_id}；group=${row.group_id}）`)
    .join("；");
}

function normalizeSubmittedCapId(raw, ids) {
  const capId = requireText(raw, "card.cap_id");
  if (ids.has(capId)) return capId;
  const colonParts = capId.split(":");
  const suffix = colonParts[colonParts.length - 1]?.trim();
  if (suffix && ids.has(suffix)) return suffix;
  return capId;
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
  const cards = Array.isArray(parsed.cards)
    ? parsed.cards
    : (Array.isArray(parsed.selected_cards)
        ? parsed.selected_cards
        : (Array.isArray(parsed.capabilities)
            ? parsed.capabilities
            : (Array.isArray(parsed.selection)
                ? parsed.selection
                : (Array.isArray(parsed["能力卡"]) ? parsed["能力卡"] : []))));
  if (!cards.length) throw new Error("cards required");
  const { perGroupMin } = readSelectionConstraints(context);
  const { ids, groupByCap } = buildCapabilitySet(context.capabilityGroups);
  const allowedGroups = new Set(context.allowedGroups);
  const allowedIds = new Set(allowedCardRows(context).map((row) => row.cap_id));
  const normalized = cards.map((card) => {
    const capId = normalizeSubmittedCapId(card.cap_id ?? card.id, ids);
    const tier = requireText(card.tier, "card.tier");
    if (!ids.has(capId)) throw new Error(`unknown cap_id: ${capId}`);
    if (!allowedIds.has(capId)) throw new Error(`cap_id not in allowed card list: ${capId}`);
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
    rationale: requireText(fallbackRationale(parsed, `selected ${normalized.length} card(s)`), "rationale")
  };
}

function validatePrice(parsed, context) {
  const price = Number(parsed.price);
  const pricing = {
    price_min: Number(context.priceMin),
    price_max: Number(context.priceMax),
    price_step: Number(context.priceStep)
  };
  const check = validateRound2Price(price, pricing);
  if (!check.ok) throw new Error(`${check.error}: ${price}`);
  return {
    price: Math.round(price),
    rationale: requireText(fallbackRationale(parsed, `final price ${Math.round(price)}`), "rationale")
  };
}

function normalizePricingAction(value) {
  const raw = String(value ?? "").trim();
  if (PRICING_ACTIONS.has(raw)) return raw;
  if (/压低|低价|抢量|走量|volume/i.test(raw)) return "lower_price_for_volume";
  if (/抬高|高价|守毛利|毛利|margin/i.test(raw)) return "higher_price_for_margin";
  throw new Error(`invalid pricing_action: ${value}`);
}

function validatePricingAction(parsed) {
  return {
    pricing_action: normalizePricingAction(parsed.pricing_action ?? parsed.action),
    rationale: requireText(fallbackRationale(parsed, parsed.pricing_action ?? parsed.action), "rationale")
  };
}

function normalizePricingTier(value) {
  const raw = String(value ?? "").trim();
  const lower = raw.toLowerCase();
  if (lower === "low" || raw === "低" || raw.includes("低档")) return "low";
  if (lower === "mid" || lower === "middle" || raw === "中" || raw.includes("中档")) return "mid";
  if (lower === "high" || raw === "高" || raw.includes("高档")) return "high";
  throw new Error(`invalid pricing_tier: ${value}`);
}

function validatePricingTier(parsed) {
  return {
    tier: normalizePricingTier(parsed.tier ?? parsed.pricing_tier),
    rationale: requireText(fallbackRationale(parsed, parsed.tier ?? parsed.pricing_tier), "rationale")
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
    return [
      `抽取当前选卡段的最终卡片。只允许当前段 group：${context.allowedGroups.join(", ")}；当前段每个 group 至少 ${perGroupMin} 张；全队最终累计总数至少 ${totalMin} 张；无硬性总数上限。`,
      `合法 cap_id 清单：${formatAllowedCards(context)}。`,
      context.compatibilityFeedback ? `界面错误提示：${context.compatibilityFeedback}` : "",
      '如果组长用了中文名或简称，只能映射到上述清单中的真实 cap_id；禁止创造清单外 cap_id。输出 JSON：{"cards":[{"cap_id":"真实cap_id","tier":"low|mid|high"}],"rationale":"..."}。'
    ].filter(Boolean).join("\n");
  }
  if (decisionType === "price") {
    return `抽取最终定价。合法区间 ${context.priceMin}-${context.priceMax}。输出 JSON：{"price":数字,"rationale":"..."}。`;
  }
  if (decisionType === "pricing_action") {
    return '抽取 D5 定价动作。只能是 lower_price_for_volume（压低售价抢量）或 higher_price_for_margin（抬高售价守毛利）。输出 JSON：{"pricing_action":"lower_price_for_volume|higher_price_for_margin","rationale":"..."}。';
  }
  if (decisionType === "pricing_tier") {
    return '抽取 D5 相对价格档位。只能是 low / mid / high。输出 JSON：{"tier":"low|mid|high","rationale":"..."}。';
  }
  throw new Error(`unknown decision type: ${decisionType}`);
}

function validateParsed(decisionType, parsed, context) {
  if (decisionType === "r1") return validateR1(parsed);
  if (decisionType === "prototype") return validatePrototype(parsed);
  if (decisionType === "cards") return validateCards(parsed, context);
  if (decisionType === "price") return validatePrice(parsed, context);
  if (decisionType === "pricing_action") return validatePricingAction(parsed);
  if (decisionType === "pricing_tier") return validatePricingTier(parsed);
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
