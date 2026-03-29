const test = require("node:test");
const assert = require("node:assert/strict");

const {
  clipScore,
  lambdaMap,
  rhoDiscount,
  buildRound1Outcome,
  vpResultToApiScores,
  buildVpResultScoringText,
  vpResultToConfirmedFields
} = require("../server/routes/teamRoutes");

test("clipScore keeps null-like values as null instead of coercing to 1.0", () => {
  assert.equal(clipScore(null, 1, 5), null);
  assert.equal(clipScore(undefined, 1, 5), null);
  assert.equal(clipScore("", 1, 5), null);
});

test("vpResultToApiScores preserves decimal scores from vp_result", () => {
  const scores = vpResultToApiScores({
    scores: {
      C: { score: 4.3, feedback: "..." },
      G: { score: 4.4, feedback: "..." },
      E: { score: 4.2, feedback: "..." }
    }
  });

  assert.deepEqual(scores, {
    coverage: 4.3,
    generalizability: 4.4,
    effectiveness: 4.2
  });
});

test("vpResultToApiScores keeps 1.0 as 1.0 instead of expanding to legacy 5-point max", () => {
  const scores = vpResultToApiScores({
    scores: {
      C: { score: 4.5, feedback: "..." },
      G: { score: 4.5, feedback: "..." },
      E: { score: 1.0, feedback: "..." }
    }
  });

  assert.deepEqual(scores, {
    coverage: 4.5,
    generalizability: 4.5,
    effectiveness: 1.0
  });
});

test("vpResultToApiScores still upscales genuine legacy fractional scores below 1.0", () => {
  const scores = vpResultToApiScores({
    scores: {
      C: { score: 0.7, feedback: "..." },
      G: { score: 0.5, feedback: "..." },
      E: { score: 0.2, feedback: "..." }
    }
  });

  assert.deepEqual(scores, {
    coverage: 3.5,
    generalizability: 2.5,
    effectiveness: 1.0
  });
});

test("buildVpResultScoringText formats confirm-path vp_result into labeled scoring text", () => {
  const conversation = buildVpResultScoringText({
    target_customer: "独居老人",
    scenario_pain: "夜间起夜时家人不在身边，存在安全隐患",
    value_creation: "通过夜间陪伴与提醒降低照护压力",
    boundary: "不适用于需要专业医疗处置的急症"
  });

  assert.equal(
    conversation,
    [
      "目标客户：独居老人",
      "场景痛点：夜间起夜时家人不在身边，存在安全隐患",
      "价值创造：通过夜间陪伴与提醒降低照护压力",
      "边界条件：不适用于需要专业医疗处置的急症"
    ].join("\n")
  );
});

test("buildVpResultScoringText skips empty fields instead of filling placeholders", () => {
  const conversation = buildVpResultScoringText({
    target_customer: "经常出差的父母",
    value_creation: "远程互动陪伴孩子学习"
  });

  assert.equal(
    conversation,
    [
      "目标客户：经常出差的父母",
      "价值创造：远程互动陪伴孩子学习"
    ].join("\n")
  );
  assert.doesNotMatch(conversation, /未明确/);
});

test("vpResultToConfirmedFields maps vp_result fields into Round 2 persona context", () => {
  const fields = vpResultToConfirmedFields({
    target_customer: "夜间巡视压力大的民营养老院",
    scenario_pain: "护工成本上涨且夜班覆盖不足",
    value_creation: "通过夜间巡检与异常提醒降低跌倒漏检风险",
    boundary: "不适用于急性医疗处置"
  });

  assert.deepEqual(fields, {
    who_raw: "夜间巡视压力大的民营养老院",
    pain_raw: "护工成本上涨且夜班覆盖不足",
    how_raw: "通过夜间巡检与异常提醒降低跌倒漏检风险",
    alternative_raw: "未明确",
    boundary_raw: "不适用于急性医疗处置"
  });
});

test("vpResultToConfirmedFields falls back to vp text labels when vp_result is incomplete", () => {
  const fields = vpResultToConfirmedFields({}, [
    "WHO：独居白领",
    "PAIN：每天加班到 9 点回家没人说话",
    "HOW：通过陪伴互动缓解下班后的孤独感",
    "BOUNDARY：高强度心理危机不适用"
  ].join("\n"));

  assert.deepEqual(fields, {
    who_raw: "独居白领",
    pain_raw: "每天加班到 9 点回家没人说话",
    how_raw: "通过陪伴互动缓解下班后的孤独感",
    alternative_raw: "未明确",
    boundary_raw: "高强度心理危机不适用"
  });
});

test("rhoDiscount applies customer clarity discount to WTP multiplier", () => {
  assert.equal(lambdaMap(5), 1.1);
  assert.equal(rhoDiscount(3), 0.9);

  const round1 = buildRound1Outcome(
    "ToC_Differentiation_Adult",
    "Experience",
    { C: 3, G: 5, E: 5 },
    0
  );

  assert.equal(round1.C, 3);
  assert.equal(round1.G, 5);
  assert.equal(round1.E_raw, 5);
  assert.equal(round1.lambda_G, 1.1);
  assert.equal(round1.lambda_E, 1.1);
  assert.equal(round1.rho_C, 0.9);
  assert.equal(Number(round1.wtp_multiplier.toFixed(3)), 1.089);
  assert.equal(round1.jinang_wtp_bonus, 0);
  assert.equal(round1.WTPadj, 18421);
});

test("buildRound1Outcome applies jinang bonus to WTP without changing E", () => {
  const round1 = buildRound1Outcome(
    "ToC_Differentiation_Adult",
    "Experience",
    { C: 3, G: 5, E: 4 },
    0.7
  );

  assert.equal(round1.E_raw, 4);
  assert.equal(round1.jinang_E_boost, 0);
  assert.equal(round1.jinang_wtp_bonus, 0.035);
  assert.equal(Number(round1.wtp_multiplier.toFixed(4)), 1.0246);
  assert.equal(round1.WTPadj, 17686);
  assert.equal(round1.VPscore, 3.7);
});
