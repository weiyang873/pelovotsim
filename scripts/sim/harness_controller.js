"use strict";

const crypto = require("node:crypto");

const CATEGORY_DIMENSIONS = {
  customer: new Set(["perception", "interaction"]),
  technical: new Set(["safety", "extension", "maintenance", "extend", "ops"]),
  cost: new Set([])
};

const CATEGORY_KEYWORDS = {
  customer: ["体验", "情绪", "满意", "尊严", "陪伴", "交互", "对话", "识别", "感知", "家属", "用户"],
  technical: ["安全", "隐私", "联网", "数据", "稳定", "误报", "维护", "运维", "接口", "API", "摄像头", "监测"],
  cost: ["成本", "预算", "价格", "采购", "审批", "付费", "溢价", "租赁", "人力成本", "回本", "元", "万", "块"]
};

const LEVEL_KEEP_RATIO = {
  high: 1,
  medium: 0.6,
  low: 0.3
};

function stableUnit(seed) {
  const hex = crypto.createHash("sha256").update(String(seed)).digest("hex").slice(0, 12);
  return Number.parseInt(hex, 16) / 0xffffffffffff;
}

function levelOf(value, fallback = "medium") {
  const text = String(value || "").trim();
  return ["high", "medium", "low"].includes(text) ? text : fallback;
}

function classifyReport(report) {
  const dims = [
    report?.dimension,
    report?.dimension_id,
    report?.dimensionId,
    report?.tag,
    ...(Array.isArray(report?.dimensions) ? report.dimensions : [])
  ].map((item) => String(item || "").trim()).filter(Boolean);
  const text = [
    report?.title,
    report?.summary_text,
    report?.report_text,
    report?.text
  ].map((item) => String(item || "")).join("\n");
  const scores = { customer: 0, technical: 0, cost: 0 };
  for (const dim of dims) {
    for (const [category, knownDims] of Object.entries(CATEGORY_DIMENSIONS)) {
      if (knownDims.has(dim)) scores[category] += 3;
    }
  }
  for (const [category, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
    for (const keyword of keywords) {
      if (text.includes(keyword)) scores[category] += 1;
    }
  }
  const ranked = Object.entries(scores).sort((a, b) => b[1] - a[1]);
  return ranked[0]?.[1] > 0 ? ranked[0][0] : "customer";
}

function filterReports(profile, reports, seed = "") {
  const list = Array.isArray(reports) ? reports : [];
  if (list.length <= 1) {
    return { reports: list, total: list.length, shown: list.length };
  }
  const attention = profile?.attention || {};
  const byCategory = new Map();
  list.forEach((item, index) => {
    const category = classifyReport(item?.report || item);
    if (!byCategory.has(category)) byCategory.set(category, []);
    byCategory.get(category).push({ item, index });
  });

  const keepIndexes = new Set();
  for (const [category, items] of byCategory.entries()) {
    const profileKey = category === "customer"
      ? "customer_visible_value"
      : (category === "technical" ? "technical_dependencies" : "cost_structure");
    const ratio = LEVEL_KEEP_RATIO[levelOf(attention[profileKey])] ?? 0.6;
    const keepCount = Math.max(1, Math.ceil(items.length * ratio));
    items
      .map((entry) => ({
        ...entry,
        score: stableUnit(`${seed}:${category}:${entry.index}`)
      }))
      .sort((a, b) => a.score - b.score)
      .slice(0, keepCount)
      .forEach((entry) => keepIndexes.add(entry.index));
  }

  const filtered = list.filter((_, index) => keepIndexes.has(index));
  return {
    reports: filtered.length > 0 ? filtered : [list[0]],
    total: list.length,
    shown: filtered.length > 0 ? filtered.length : 1
  };
}

function getAnchorParams(profile) {
  const belief = profile?.belief_policy || {};
  const trust = levelOf(belief.trust_in_reports);
  const style = String(belief.wtp_anchor_style || "gut_feel").trim();
  let anchorMode = "raw";
  if (trust === "high" || style === "report_numbers") anchorMode = "extracted";
  if (trust === "low") anchorMode = "redacted";
  return {
    trustInReports: trust,
    anchorStyle: style,
    anchorMode
  };
}

function getCardOrder(profile) {
  const aspirations = profile?.aspirations || {};
  if (aspirations.nre_tolerance === "high" && aspirations.price_position === "premium") return "high_first";
  if (aspirations.nre_tolerance === "low" || aspirations.price_position === "budget") return "low_first";
  return "default";
}

function getHarnessParams(profile, step = "r2") {
  const search = profile?.search_policy || {};
  const constraint = profile?.constraint_policy || {};
  const aspirations = profile?.aspirations || {};
  const anchor = getAnchorParams(profile);
  return {
    reports: {
      attention: profile?.attention || {}
    },
    anchor,
    search: {
      breadth: String(search.breadth || "wide").trim() === "narrow" ? "narrow" : "wide",
      stopRule: ["first_satisfying", "compare_few", "exhaustive"].includes(search.stop_rule)
        ? search.stop_rule
        : "first_satisfying",
      reviseIfBelowAspiration: search.revise_if_below_aspiration === true,
      minimumCoreCoverage: ["high", "medium", "low"].includes(aspirations.minimum_core_coverage)
        ? aspirations.minimum_core_coverage
        : "medium"
    },
    constraint: {
      validateDepth: ["full", "partial", "minimal"].includes(constraint.dependency_check_depth)
        ? constraint.dependency_check_depth
        : "full",
      assumesTeammateChecked: constraint.assumes_teammate_checked === "high" ? "high" : "low"
    },
    cardPresentationOrder: getCardOrder(profile),
    step
  };
}

module.exports = {
  filterReports,
  getHarnessParams,
  stableUnit
};
