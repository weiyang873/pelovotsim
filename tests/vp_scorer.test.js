const test = require("node:test");
const assert = require("node:assert/strict");

const { calculateScores } = require("../server/llm/vpScorer");

function withMockedVpScorer(mockImpl) {
  const scorerPath = require.resolve("../server/llm/vpScorer");
  const clientPath = require.resolve("../server/llm/deepseekClient");
  const originalScorer = require.cache[scorerPath];
  const originalClient = require.cache[clientPath];

  delete require.cache[scorerPath];
  require.cache[clientPath] = {
    id: clientPath,
    filename: clientPath,
    loaded: true,
    exports: { chatCompletion: mockImpl }
  };

  const mockedScorer = require("../server/llm/vpScorer");
  return {
    mockedScorer,
    restore() {
      delete require.cache[scorerPath];
      if (originalScorer) require.cache[scorerPath] = originalScorer;
      if (originalClient) require.cache[clientPath] = originalClient;
      else delete require.cache[clientPath];
    }
  };
}

test("calculateScores applies additive weights and penalties", () => {
  const scores = calculateScores({
    has_clear_customer: 2,
    has_scenario: 2,
    scenario_is_recurring: 2,
    pain_has_specificity: 2,
    pain_has_structural_cause: 2,
    pain_not_extreme_trigger: 2,
    pain_transferable: 2,
    gain_not_niche: 2,
    has_mechanism: 2,
    has_alternative_comparison: 2,
    has_boundary: 2,
    architecture_consistent: 0,
    tob_customer_is_institution: 0
  });

  assert.deepEqual(scores, {
    C: 3.2,
    G: 4.5,
    E: 3.7
  });
});

test("scoreVp normalizes extracted booleans and returns rule-based scores", async () => {
  let callIndex = 0;
  const { mockedScorer, restore } = withMockedVpScorer(async () => {
    callIndex += 1;
    if (callIndex === 1) {
      return JSON.stringify({
        has_clear_customer: 2,
        has_scenario: 1,
        scenario_is_recurring: 2,
        pain_has_specificity: 2,
        pain_has_structural_cause: 0,
        pain_not_extreme_trigger: 2,
        pain_transferable: 2,
        gain_not_niche: 0,
        has_mechanism: 2,
        has_alternative_comparison: 0,
        has_boundary: 2,
        architecture_consistent: 2,
        tob_customer_is_institution: null
      });
    }
    return "C 目前已经比较清楚，下一步是把替代方案和边界说得更明确。";
  });

  try {
    const result = await mockedScorer.scoreVp(
      "user: WHO: 连锁酒店前台经理\nassistant: 请补充高峰期场景",
      "ToC·DIFF·ADULT",
      "体验型"
    );

    assert.deepEqual(result.features, {
      has_clear_customer: 2,
      has_scenario: 1,
      scenario_is_recurring: 2,
      pain_has_specificity: 2,
      pain_has_structural_cause: 0,
      pain_not_extreme_trigger: 2,
      pain_transferable: 2,
      gain_not_niche: 0,
      has_mechanism: 2,
      has_alternative_comparison: 0,
      has_boundary: 2,
      architecture_consistent: 2,
      tob_customer_is_institution: null
    });
    assert.deepEqual(result.scores, {
      C: 3.5,
      G: 3.0,
      E: 3.0
    });
    assert.match(result.feedback, /替代方案/);
    assert.equal(typeof result.raw.extractReply, "string");
    assert.equal(typeof result.raw.feedbackReply, "string");
  } finally {
    restore();
  }
});

test("scoreVp returns null scores when extraction fails twice", async () => {
  const { mockedScorer, restore } = withMockedVpScorer(async () => "not-json");

  try {
    const result = await mockedScorer.scoreVp("user: test", "ToB·DIFF·ADULT", "功能型");
    assert.equal(result.features, null);
    assert.equal(result.scores, null);
    assert.equal(result.feedback, "");
    assert.equal(result.raw.feedbackReply, null);
  } finally {
    restore();
  }
});
