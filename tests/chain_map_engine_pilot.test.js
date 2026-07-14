"use strict";

const assert = require("node:assert/strict");
const Pilot = require("../scripts/analysis/chain_map_engine_pilot");

const materials = Pilot.loadPilotMaterials();
const task = { archetype: "草根老板", condition: "M", rep: 1 };
const validCards = [
  { id: "voice_basic", tier: "low" },
  { id: "perception_base", tier: "low" },
  { id: "basic_avoidance", tier: "low" },
  { id: "privacy_trust", tier: "low" },
  { id: "cloud_update", tier: "low" },
  { id: "self_diag", tier: "low" }
];

function d4Raw(cards = validCards) {
  return JSON.stringify({
    cards,
    cost_stance: { text: "先守住现金流，再按验证结果追加投入", source: materials.maps[task.archetype][0].id },
    updated_constraints: [{ text: "六个维度均保留最低可交付能力" }]
  });
}

function testValidD4() {
  const parsed = Pilot.validatePilotResponse("D4", d4Raw(), task, materials);
  assert.equal(parsed.cards.length, 6);
  assert.equal(parsed.compatibility.valid, true);
  assert.deepEqual(Pilot.toEngineSelections(parsed.cards)[0], { cap_id: "voice_basic", tier: "low" });
}

function testRejectsUnknownTier() {
  const cards = validCards.map((item) => ({ ...item }));
  cards[0].tier = "ultra";
  assert.throws(
    () => Pilot.validatePilotResponse("D4", d4Raw(cards), task, materials),
    /invalid tier/
  );
}

function testRejectsMissingDimension() {
  const cards = validCards.filter((item) => item.id !== "self_diag");
  cards.push({ id: "music_companion", tier: "low" });
  assert.throws(
    () => Pilot.validatePilotResponse("D4", d4Raw(cards), task, materials),
    /compatibility validation failed.*可运营与可维护/
  );
}

function testRejectsConflict() {
  const cards = [
    ...validCards,
    { id: "visual_expression", tier: "mid" },
    { id: "no_screen_costdown", tier: "low" }
  ];
  assert.throws(
    () => Pilot.validatePilotResponse("D4", d4Raw(cards), task, materials),
    /compatibility validation failed.*冲突/
  );
}

function testD4PromptContainsFullMaterials() {
  const prompt = Pilot.buildPilotPrompt("D4", task, materials, []);
  assert.match(prompt, /真实能力卡池；全量/);
  assert.match(prompt, /compatibility_rules|真实兼容性规则/);
  for (const id of materials.capabilityIndex.keys()) assert.equal(prompt.includes(`"cap_id": "${id}"`), true, id);
  assert.match(prompt, /"tier":"low\|mid\|high"/);
}

function testD3PromptIsReusedExactly() {
  const pilotPrompt = Pilot.buildPilotPrompt("D3", task, materials, []);
  const benchPrompt = require("../scripts/analysis/chain_map_bench").buildPrompt("D3", task, materials, []);
  assert.equal(pilotPrompt, benchPrompt);
}

function testTagExtractorAdapter() {
  const messages = Pilot.buildTagExtractorMessages({
    key_evidence: ["夜班人力紧张", "家属重视机构口碑"],
    market_judgment: "先做小规模验证"
  });
  assert.equal(messages.length, 1);
  assert.equal(messages[0].role, "assistant");
  assert.match(messages[0].content, /夜班人力紧张/);
  assert.match(messages[0].content, /先做小规模验证/);
}

function testPriceAlignment() {
  assert.equal(Pilot.alignPrice(1049), 1000);
  assert.equal(Pilot.alignPrice(1050), 1100);
  assert.equal(Pilot.alignPrice(5999), 6000);
  assert.equal(Pilot.alignPrice(800), 1000);
  assert.equal(Pilot.alignPrice(7000), 6000);
}

testValidD4();
testRejectsUnknownTier();
testRejectsMissingDimension();
testRejectsConflict();
testD4PromptContainsFullMaterials();
testD3PromptIsReusedExactly();
testTagExtractorAdapter();
testPriceAlignment();
console.log("chain_map_engine_pilot tests passed");
