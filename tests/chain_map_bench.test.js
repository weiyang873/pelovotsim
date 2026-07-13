"use strict";

const assert = require("node:assert/strict");
const {
  loadMaterials,
  buildPrompt,
  validateResponse,
  makeStackRecord
} = require("../scripts/analysis/chain_map_bench");

const materials = loadMaterials();
const taskM = { archetype: "草根老板", condition: "M", rep: 1 };
const taskC = { archetype: "二代接班人", condition: "C", rep: 1 };
const reportFingerprint = materials.reportsText.slice(0, 80);

const d1M = validateResponse("D1", JSON.stringify({
  constraints: [{ text: "先试单", source: "map_caogen_12" }],
  goal: "先验证回款"
}), taskM, materials);
const stack1 = [makeStackRecord("D1", d1M)];

assert.match(buildPrompt("D1", taskM, materials, []), /map_caogen_50/);
assert.doesNotMatch(buildPrompt("D1", taskC, materials, []), /map_erdai_01/);
assert.ok(buildPrompt("D3", taskM, materials, stack1).includes(reportFingerprint));
for (const point of ["D1", "D2", "D4", "D5"]) {
  assert.ok(!buildPrompt(point, taskM, materials, stack1).includes(reportFingerprint), `${point} leaked report text`);
}
assert.match(buildPrompt("D4", taskM, materials, stack1), /这是你此前一路形成的判断，是你现在的立场，不要推翻/);
assert.match(buildPrompt("D5", taskM, materials, stack1), /D1：目标=先验证回款/);

assert.throws(() => validateResponse("D1", JSON.stringify({
  constraints: [{ text: "先试单", source: "map_unknown" }],
  goal: "赚钱"
}), taskM, materials), /invalid map source/);

const d4 = validateResponse("D4", JSON.stringify({
  config: {
    perception: "中",
    motion: "低",
    interaction: "高",
    safety: "高",
    extension: "中",
    maintenance: "高"
  },
  cost_stance: { text: "先试再扩", source: "map_caogen_12" },
  updated_constraints: [{ text: "现金回收" }]
}), taskM, materials);
assert.equal(Object.keys(d4.config).length, 6);
assert.throws(() => validateResponse("D4", JSON.stringify({
  config: { perception: "极高" },
  cost_stance: { text: "先试", source: "map_caogen_12" },
  updated_constraints: [{ text: "现金" }]
}), taskM, materials), /six required dimensions/);

assert.equal(validateResponse("D5", JSON.stringify({
  price: 5200,
  basis: { text: "承接市场判断", source: "承前:D3" },
  reasoning: "保留利润"
}), taskM, materials).price, 5200);
assert.throws(() => validateResponse("D5", JSON.stringify({
  price: 5200,
  basis: { text: "非法承前", source: "承前:D5" },
  reasoning: "保留利润"
}), taskM, materials), /invalid basis source/);
assert.throws(() => validateResponse("D5", JSON.stringify({
  price: 7000,
  basis: { text: "越界", source: "承前:D3" },
  reasoning: "越界"
}), taskM, materials), /within 1000-6000/);

console.log("chain_map_bench.test.js: PASS");
