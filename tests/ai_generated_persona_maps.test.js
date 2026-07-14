"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Generated = require("../scripts/analysis/ai_generated_persona_maps");
const Pilot = require("../scripts/analysis/chain_map_engine_pilot");

const ROOT = path.join(__dirname, "..");

function fixtureCandidate(seed, overrides = {}) {
  const sectors = [
    "银行", "医院", "学校", "工厂", "零售门店",
    "汽车企业", "地产公司", "能源企业", "农场", "物流公司",
    "酒店", "媒体公司", "政府", "咨询公司", "通信公司",
    "保险公司", "餐饮企业", "建筑公司", "软件公司", "外贸公司"
  ];
  return {
    label: seed.label,
    core_blind_spot: "把流程完整误当成客户已经接受，忽略现场的非正式抵触",
    items: Array.from({ length: 25 }, (_, index) => ({
      id: `map_${seed.prefix}_${String(index + 1).padStart(2, "0")}`,
      type: index < 20 ? "经验" : "信条",
      content: index < 20 ? `201${index % 10}年在${sectors[index]}复盘第${index + 1}次业务判断` : `信条${index - 19}要从事实出发`
    })),
    ...overrides
  };
}

function testSeedsAreMinimalProjection() {
  const seeds = Generated.loadSeeds();
  assert.equal(seeds.length, 5);
  assert.deepEqual(seeds.map((seed) => seed.label), ["体制转型者", "职业经理人", "销售铁军", "技术创业者", "互联网PM转型"]);
  const prompt = Generated.buildBatchPrompt(seeds);
  assert.doesNotMatch(prompt, /decisionStyle|riskPreference|blindSpots|pricingBias|gridPreference/);
  assert.doesNotMatch(prompt, /互斥|行业分散|不得出现|成本|差异化|ToC|ToB/);
  for (const seed of seeds) {
    assert.match(prompt, new RegExp(seed.label));
    assert.match(prompt, new RegExp(seed.desc.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
}

function testNumberDetection() {
  assert.equal(Generated.hasConcreteNumber("2018年带过3个项目"), true);
  assert.equal(Generated.hasConcreteNumber("带过三家工厂的整合"), true);
  assert.equal(Generated.hasConcreteNumber("长期负责复杂项目"), false);
}

function testCandidateShapeAndAudits() {
  const seed = Generated.loadSeeds()[0];
  const candidate = Generated.normalizeCandidate(fixtureCandidate(seed), seed);
  assert.equal(candidate.items.length, 25);
  assert.equal(Generated.numericFailures(candidate).length, 0);
  const domain = Generated.auditDomains(candidate);
  assert.equal(domain.valid, true);
  assert.equal(domain.classifiedExperiences, 20);
}

function testDomainConcentrationLimit() {
  const seed = Generated.loadSeeds()[0];
  const raw = fixtureCandidate(seed);
  for (let index = 0; index < 5; index += 1) raw.items[index].content = `202${index}年在养老院完成第${index + 1}次项目复盘`;
  const audit = Generated.auditDomains(Generated.normalizeCandidate(raw, seed));
  assert.equal(audit.valid, true);
  assert.equal(audit.advisoryOnly, true);
  assert.deepEqual(audit.concentrationsAbove4[0], { domain: "养老康养", count: 5, reference: 4 });
}

function testGameTermScanUsesRepositoryCatalog() {
  const seed = Generated.loadSeeds()[0];
  const raw = fixtureCandidate(seed);
  raw.items[0].content = "2024年参与LOVOT项目复盘";
  const candidate = Generated.normalizeCandidate(raw, seed);
  const catalog = Generated.buildGameTermCatalog(Pilot.loadPilotMaterials());
  const hits = Generated.scanGameTerms(candidate, catalog);
  assert.equal(hits.some((row) => row.term === "LOVOT"), true);
  assert.equal(catalog.some((row) => row.term === "成本"), false);
  assert.equal(catalog.some((row) => row.term === "差异化"), false);
  assert.equal(catalog.filter((row) => row.source.includes("cap_id")).length, 23);
  assert.equal(catalog.filter((row) => row.source.includes("capability_name")).length, 23);
  assert.equal(catalog.filter((row) => row.source.includes("group_name")).length, 6);
}

function testCompletedRunWhenPresent() {
  const paths = Generated.outputPaths(Generated.RUN_ID);
  if (!fs.existsSync(paths.maps) || !fs.existsSync(paths.jsonl)) return;
  const artifact = JSON.parse(fs.readFileSync(paths.maps, "utf8"));
  const rows = fs.readFileSync(paths.jsonl, "utf8").trim().split(/\r?\n/).map((line) => JSON.parse(line));
  assert.equal(artifact.generation.candidates.length, 5);
  assert.equal(artifact.generation.candidates.every((candidate) => artifact.generation.audits[candidate.label].valid), true);
  assert.equal(artifact.generation.generatedBlindSpotSimilarity.advisoryOnly, true);
  assert.equal(artifact.generation.oldHarnessBlindSpotSimilarity.advisoryOnly, true);
  assert.equal(rows.length, 5);
  assert.equal(rows.every((row) => row.status === "OK" && row.steps.length === 4), true);
  for (const row of rows) {
    const d4 = row.steps.find((step) => step.decision_point === "D4").parsed;
    assert.equal(d4.compatibility.valid, true);
    assert.equal(d4.compatibility.hardViolationCount, 0);
    assert.equal(row.effort.schema_version, "ai_persona_search_effort_v1_d1_d4");
    assert.equal(row.effort.steps.find((step) => step.decision_point === "D4").card_dimension_count, 6);
  }
}

testSeedsAreMinimalProjection();
testNumberDetection();
testCandidateShapeAndAudits();
testDomainConcentrationLimit();
testGameTermScanUsesRepositoryCatalog();
testCompletedRunWhenPresent();
console.log("ai_generated_persona_maps tests passed");
