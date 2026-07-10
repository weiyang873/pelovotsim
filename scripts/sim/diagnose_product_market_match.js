"use strict";

const CAP_GROUPS = require("../../data/capability_groups_v2.json");
const GRID_PRIORS = require("../../data/grid_priors_v4_cap_weights.json");
const { computeProductMarketMatch } = require("../../server/llm/rdCalculator");

const DIM_GROUP_TO_MATCH_KEY = {
  interaction_expression: "interaction",
  perception_understanding: "perception",
  mobility_navigation: "mobility",
  safety_trust: "safety_privacy",
  expand_connect: "integration",
  ops_maintenance: "operations"
};

const DIM_KEYS = ["interaction", "perception", "mobility", "safety_privacy", "integration", "operations"];

function capsForGroups(groupIds) {
  const wanted = new Set(groupIds);
  return (CAP_GROUPS.groups || [])
    .filter((group) => wanted.has(group.group_id))
    .flatMap((group) => (group.capabilities || []).map((cap) => ({
      cap_id: cap.cap_id,
      group_id: group.group_id,
      dim: DIM_GROUP_TO_MATCH_KEY[group.group_id]
    })));
}

function scoreHighTierGroupCaps(groupIds) {
  const scores = Object.fromEntries(DIM_KEYS.map((key) => [key, 4]));
  for (const cap of capsForGroups(groupIds)) {
    scores[cap.dim] += 3;
  }
  for (const key of DIM_KEYS) {
    scores[key] = Number(Math.max(1, Math.min(9, scores[key])).toFixed(1));
  }
  return scores;
}

function sortMatches(allMatches) {
  return Object.entries(allMatches || {}).sort((a, b) => Number(b[1]) - Number(a[1]));
}

function printFixture(name, groupIds) {
  const caps = capsForGroups(groupIds);
  const cardScores = scoreHighTierGroupCaps(groupIds);
  const match = computeProductMarketMatch(cardScores, GRID_PRIORS);
  console.log(`\n## ${name}`);
  console.log(`groups: ${groupIds.join(", ")}`);
  console.log(`caps_high: ${caps.map((cap) => cap.cap_id).join(", ")}`);
  console.log(`cardScores: ${JSON.stringify(cardScores)}`);
  console.log(`argmax: ${match.bestGrid} (${match.bestMatch})`);
  console.log("| rank | grid | match |");
  console.log("| --- | --- | --- |");
  sortMatches(match.allMatches).forEach(([grid, score], index) => {
    console.log(`| ${index + 1} | ${grid} | ${score} |`);
  });
  return match;
}

function main() {
  const a = printFixture("A 安全/运维全高档", ["safety_trust", "ops_maintenance"]);
  const b = printFixture("B 交互/感知全高档", ["interaction_expression", "perception_understanding"]);
  if (a.bestGrid === b.bestGrid) {
    throw new Error(`product-market rematch fixture failed: both fixtures argmax=${a.bestGrid}`);
  }
  console.log(`\nOK: argmax 不同，A=${a.bestGrid}，B=${b.bestGrid}`);
}

if (require.main === module) {
  main();
}

