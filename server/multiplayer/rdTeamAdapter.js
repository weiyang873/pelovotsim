// server/multiplayer/rdTeamAdapter.js
// Round 2 多人 R&D 适配层：分工、合并、锦囊修正

const { getCapabilityParams, TIER_ORDER } = require("../llm/rdCalculator");

const DIMENSION_IDS = [
  "interaction_expression",
  "perception_understanding",
  "mobility_navigation",
  "safety_trust",
  "expand_connect",
  "ops_maintenance"
];

function assignDimensions(memberCount = 4) {
  const count = Math.max(1, Number(memberCount) || 1);
  if (count === 1) {
    return [[...DIMENSION_IDS]];
  }
  if (count === 2) {
    return [
      ["interaction_expression", "perception_understanding", "safety_trust"],
      ["mobility_navigation", "expand_connect", "ops_maintenance"]
    ];
  }
  if (count === 3) {
    return [
      ["interaction_expression", "safety_trust"],
      ["perception_understanding", "mobility_navigation"],
      ["expand_connect", "ops_maintenance"]
    ];
  }
  if (count === 4) {
    return [
      ["interaction_expression", "safety_trust"],
      ["perception_understanding", "mobility_navigation"],
      ["expand_connect", "ops_maintenance"],
      ["perception_understanding", "interaction_expression"]
    ];
  }
  if (count === 5) {
    return [
      ["interaction_expression", "safety_trust"],
      ["perception_understanding", "mobility_navigation"],
      ["expand_connect", "ops_maintenance"],
      ["interaction_expression", "perception_understanding"],
      ["safety_trust", "expand_connect"]
    ];
  }
  return [
    ["interaction_expression", "ops_maintenance"],
    ["perception_understanding", "interaction_expression"],
    ["mobility_navigation", "perception_understanding"],
    ["safety_trust", "mobility_navigation"],
    ["expand_connect", "safety_trust"],
    ["ops_maintenance", "expand_connect"]
  ];
}

function mergeTeamSelections(memberSelections) {
  const all = Array.isArray(memberSelections) ? memberSelections : [];
  const mergedMap = new Map();

  for (const row of all) {
    if (!Array.isArray(row)) continue;
    for (const sel of row) {
      if (!sel || !sel.cap_id || !sel.tier) continue;
      const prev = mergedMap.get(sel.cap_id);
      if (!prev || TIER_ORDER[sel.tier] > TIER_ORDER[prev.tier]) {
        mergedMap.set(sel.cap_id, { cap_id: sel.cap_id, tier: sel.tier });
      }
    }
  }

  const selections = Array.from(mergedMap.values());
  const total = selections.length;
  const violations = [];
  if (total < 6) violations.push({ type: "total_min", message: `总数 ${total} < 6` });

  return {
    selections,
    total,
    validTotal: violations.length === 0,
    violations
  };
}

function resolveDiscount(capId, techJinnang, matchStrength) {
  if (!techJinnang || typeof techJinnang !== "object") return 0;

  const explicitByCard = techJinnang.card_discounts || techJinnang.capability_discounts || {};
  if (explicitByCard[capId] != null) return Number(explicitByCard[capId]) * matchStrength;

  const effect = techJinnang.effect_applied || techJinnang.effect || {};
  const cardDiscounts = effect.r2_dCOGS_discount_for_cards || {};
  if (cardDiscounts[capId] != null) return Number(cardDiscounts[capId]) * matchStrength;

  const globalDiscount = techJinnang.dCOGS_discount || effect.r2_total_dCOGS_discount || 0;
  return Number(globalDiscount || 0) * matchStrength;
}

function resolveRiskReduction(capId, groupId, techJinnang, matchStrength) {
  if (!techJinnang || typeof techJinnang !== "object") return 0;

  const effect = techJinnang.effect_applied || techJinnang.effect || {};
  const byCard = techJinnang.risk_reduction_by_card || {};
  if (byCard[capId] != null) return Number(byCard[capId]) * matchStrength;

  const byGroup = effect.r2_risk_reduction_for_group || {};
  if (byGroup[groupId] != null) return Number(byGroup[groupId]) * matchStrength;

  const global = techJinnang.risk_reduction_global || effect.r2_risk_reduction_global || 0;
  return Number(global || 0) * matchStrength;
}

function applyTechJinnang(selections, techJinnang) {
  const selList = Array.isArray(selections) ? selections : [];
  const matchStrength = Math.max(0, Math.min(1, Number(techJinnang?.match_strength || 0)));

  return selList.map((sel) => {
    const base = getCapabilityParams(sel.cap_id, sel.tier);
    const discount = Math.max(0, Math.min(1, resolveDiscount(sel.cap_id, techJinnang, matchStrength)));
    const riskReduction = Math.max(0, resolveRiskReduction(sel.cap_id, base.group_id, techJinnang, matchStrength));

    return {
      ...sel,
      dCOGS_base: base.dCOGS,
      risk_base: base.risk,
      dCOGS_eff: base.dCOGS * (1 - discount),
      risk_eff: Math.max(0, base.risk - riskReduction),
      tech_applied: {
        match_strength: matchStrength,
        discount,
        risk_reduction: riskReduction
      }
    };
  });
}

module.exports = {
  DIMENSION_IDS,
  assignDimensions,
  mergeTeamSelections,
  applyTechJinnang
};
