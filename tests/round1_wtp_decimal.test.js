const test = require("node:test");
const assert = require("node:assert/strict");

const Engine = require("../engine");

test("round1 WTP uses decimal lambda interpolation and continuous Eadj uplift", () => {
  const r1 = Engine.computeRound1V2(
    "ToC_DIFF_ADULT",
    "Experience",
    { C: 3.2, G: 3.8, E: 2.5 },
    0.5
  );

  assert.equal(r1.Eadj, 3.0);
  assert.equal(r1.lambda_G, 0.98);
  assert.equal(r1.lambda_E, 0.90);
  assert.equal(Number(r1.wtp_multiplier.toFixed(3)), 0.882);
  assert.equal(Math.round(((r1.WTPadj / r1.WTPref) - 1) * 100), -12);
});

test("round1 WTP does not ceil decimal E scores to 5", () => {
  const r1 = Engine.computeRound1V2(
    "ToC_Differentiation_Child",
    "Hybrid",
    { C: 3.8, G: 3.6, E: 4.1 },
    0
  );

  assert.equal(r1.Eadj, 4.1);
  assert.equal(r1.lambda_G, 0.96);
  assert.equal(r1.lambda_E, 1.01);
  assert.equal(Math.round(((r1.WTPadj / r1.WTPref) - 1) * 100), -3);
});
