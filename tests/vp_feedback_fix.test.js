const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildFallbackVpFeedback
} = require("../server/llm/vpWordScorer");

function withMockedChatCompletion(mockImpl) {
  const scorerPath = require.resolve("../server/llm/vpWordScorer");
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

  const mockedScorer = require("../server/llm/vpWordScorer");

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

test("buildFallbackVpFeedback returns a single usable paragraph", () => {
  const feedback = buildFallbackVpFeedback({
    vpText: "为财富管理中心提供等待区情绪安抚机器人服务。",
    confirmedFields: {
      who_raw: "财富管理中心",
      pain_raw: "高净值客户等待时焦虑戒备、破冰时间长",
      how_raw: "通过云端更新互动内容的LOVOT提供非功利情绪安抚",
      alternative_raw: "静态豪华装修或人工寒暄",
      boundary_raw: "深度隐私咨询前仅限一般业务介绍"
    },
    scores: { C: 2.7, G: 5, Eadj: 5, VPscore: 3.7 }
  });

  assert.ok(feedback);
  assert.equal(/\n/.test(feedback), false);
  assert.ok(feedback.length >= 150);
  assert.ok(feedback.length <= 250);
  assert.doesNotMatch(feedback, /人群覆盖面|痛点典型性|解法说服力|综合评分|\/5/);
});

test("generateVpFeedback falls back when model output mentions score dimensions", async () => {
  const { mockedScorer, restore } = withMockedChatCompletion(async () => (
    "你的价值主张做得非常出色，尤其是在“痛点典型性”和“解法说服力”上。你精准抓住了“高净值客户等待时焦虑戒备、破冰时间长”这个问题，也给出了“通过云端更新互动内容的LOVOT来提供非功利的情绪安抚”这一解法。扣分主要在于“人群覆盖面”上，目前“财富管理中心”这个表述还偏宽，建议明确到最关键的决策角色。"
  ));

  try {
    const feedback = await mockedScorer.generateVpFeedback({
      vpText: "为财富管理中心提供等待区情绪安抚机器人服务。",
      confirmedFields: {
        who_raw: "财富管理中心",
        pain_raw: "高净值客户等待时焦虑戒备、破冰时间长",
        how_raw: "通过云端更新互动内容的LOVOT提供非功利情绪安抚",
        alternative_raw: "静态豪华装修或人工寒暄",
        boundary_raw: "深度隐私咨询前仅限一般业务介绍"
      },
      scores: { C: 2.7, G: 5, Eadj: 5, VPscore: 3.7 },
      gridLabel: "ToB·差异·成人",
      archLabel: "混合型"
    });

    assert.ok(feedback);
    assert.ok(feedback.length >= 150);
    assert.ok(feedback.length <= 250);
    assert.doesNotMatch(feedback, /人群覆盖面|痛点典型性|解法说服力|综合评分|\/5/);
  } finally {
    restore();
  }
});
