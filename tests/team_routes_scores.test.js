const test = require("node:test");
const assert = require("node:assert/strict");

const {
  clipScore,
  vpResultToApiScores,
  buildVpResultScoringText
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
