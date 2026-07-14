"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Effort = require("../scripts/analysis/chain_map_search_effort");
const Pilot = require("../scripts/analysis/chain_map_engine_pilot");

const ROOT = path.join(__dirname, "..");
const V5_JSONL = path.join(ROOT, "scripts", "analysis", "chain_map_engine_pilot_v5_2026-07-14.jsonl");
const EFFORT_JSONL = path.join(ROOT, "scripts", "analysis", "chain_map_search_effort_v1_2026-07-14.jsonl");
const materials = Pilot.loadPilotMaterials();
const sourceRows = fs.readFileSync(V5_JSONL, "utf8").trim().split(/\r?\n/).map((line) => JSON.parse(line));

function testReferenceExtraction() {
  assert.equal(sourceRows.length, 2);
  for (const source of sourceRows) {
    const row = { ...source, effort: Effort.extractEffortMetrics(source, materials) };
    Effort.assertCompleteEffort(row);
    assert.equal(row.effort.steps.length, 5);
    const d4 = row.effort.steps.find((item) => item.decision_point === "D4");
    const d5 = row.effort.steps.find((item) => item.decision_point === "D5");
    assert.equal(d4.card_dimension_count, 6);
    assert.equal(d5.constraint_stack_complexity, d4.constraint_stack_complexity);
    assert.equal(d5.step_constraint_output_count, 0);
    assert.equal(d5.theme_breadth, 0);
    assert.ok(d5.reasoning_text_length > 0);
    assert.ok(row.effort.steps.find((item) => item.decision_point === "D3").reasoning_text_length > 0);
    assert.equal(row.effort.steps.find((item) => item.decision_point === "D1").reasoning_text_length, 0);
    for (let index = 1; index < row.effort.steps.length; index += 1) {
      assert.ok(row.effort.steps[index].map_reference_breadth >= row.effort.steps[index - 1].map_reference_breadth);
    }
  }
}

function testKnownV5CardBreadth() {
  const byPersona = Object.fromEntries(sourceRows.map((row) => [row.persona, Effort.extractEffortMetrics(row, materials)]));
  assert.equal(byPersona["草根老板"].steps.find((item) => item.decision_point === "D4").card_count, 8);
  assert.equal(byPersona["二代接班人"].steps.find((item) => item.decision_point === "D4").card_count, 15);
}

function testThemeBreadthUsesDistinctThemes() {
  const themes = Effort.themeNames([
    { text: "先做小批试用，验证后再投入，控制现金和回款" },
    { text: "继续小批验证，不要重复算命中次数" }
  ]);
  assert.deepEqual(themes, ["试单/验证", "现金/回款"]);
}

function testReferenceLoader() {
  const rows = Effort.loadReferenceRows(materials);
  assert.equal(rows.length, 2);
  assert.equal(rows.every((row) => row.effort.steps.length === 5), true);
}

function testCompletedRunWhenPresent() {
  if (!fs.existsSync(EFFORT_JSONL)) return;
  const rows = fs.readFileSync(EFFORT_JSONL, "utf8").trim().split(/\r?\n/).map((line) => JSON.parse(line));
  assert.equal(rows.length, 6);
  assert.equal(rows.every((row) => row.status === "OK"), true);
  for (const row of rows) {
    Effort.assertCompleteEffort(row);
    const d4 = row.steps.find((step) => step.decision_point === "D4").parsed;
    assert.equal(d4.compatibility.valid, true);
    assert.equal(d4.compatibility.hardViolationCount, 0);
    assert.ok(d4.cards.length >= 6);
    assert.equal(new Set(d4.cards.map((card) => materials.groupByCapability.get(card.id).group_id)).size, 6);
  }
  const decision = Effort.buildDecision(rows);
  assert.equal(decision.cardComparison.heirHigher, 3);
  assert.equal(decision.themeComparison.heirHigher, 11);
}

testReferenceExtraction();
testKnownV5CardBreadth();
testThemeBreadthUsesDistinctThemes();
testReferenceLoader();
testCompletedRunWhenPresent();
console.log("chain_map_search_effort tests passed");
