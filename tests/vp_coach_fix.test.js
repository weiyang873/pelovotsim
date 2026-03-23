const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildSystemPrompt,
  parseVpScore,
  normalizeScore,
  compactText,
  chat
} = require("../server/llm/vpCoach");

function withMockedChatCompletion(mockImpl) {
  const coachPath = require.resolve("../server/llm/vpCoach");
  const clientPath = require.resolve("../server/llm/deepseekClient");
  const originalClient = require.cache[clientPath];
  const originalCoach = require.cache[coachPath];

  delete require.cache[coachPath];
  require.cache[clientPath] = {
    id: clientPath,
    filename: clientPath,
    loaded: true,
    exports: { chatCompletion: mockImpl }
  };

  const mockedCoach = require("../server/llm/vpCoach");

  return {
    mockedCoach,
    restore() {
      delete require.cache[coachPath];
      if (originalCoach) require.cache[coachPath] = originalCoach;
      if (originalClient) require.cache[clientPath] = originalClient;
      else delete require.cache[clientPath];
    }
  };
}

test("vp coach prompt delegates scoring to system and keeps confirm json score-free", () => {
  const prompt = buildSystemPrompt({ cellLabel: "企业市场·差异化·老人", architecture: "Experience" }, {});
  assert.match(prompt, /评分由系统独立计算/);
  assert.match(prompt, /学生可以随时点击"查看评分"查看当前分数/);
  assert.doesNotMatch(prompt, /## 评分/);
  assert.match(prompt, /"target_customer"/);
  assert.match(prompt, /"scenario_pain"/);
  assert.match(prompt, /"value_creation"/);
  assert.match(prompt, /"boundary"/);
  assert.doesNotMatch(prompt, /"scores"/);
});

test("normalizeScore rounds to 0.1 and clamps range", () => {
  assert.equal(normalizeScore("3.44"), 3.4);
  assert.equal(normalizeScore("5.9"), 5.0);
  assert.equal(normalizeScore("-1"), 1.0);
  assert.equal(normalizeScore("bad"), null);
  assert.equal(normalizeScore("bad", 3.0), 3.0);
});

test("compactText preserves single and double newlines", () => {
  const text = compactText("A\r\n\r\n\r\nB\nC\n\nD");
  assert.equal(text, "A\n\nB\nC\n\nD");
});

test("chat does not short-circuit partial input with '不知道'", async () => {
  let recordedMessages = null;
  const { mockedCoach, restore } = withMockedChatCompletion(async (messages) => {
    recordedMessages = messages;
    return "你已经给了 WHO。现在补一句：客户接待最常出现的具体痛点发生在什么时刻？";
  });

  try {
    const result = await mockedCoach.chat(
      { messages: [], strategy: {} },
      "服务业的客户接待，痛点不知道",
      { mode: "chat" }
    );

    assert.equal(result.replyText, "你已经给了 WHO。现在补一句：客户接待最常出现的具体痛点发生在什么时刻？");
    assert.ok(Array.isArray(recordedMessages));
    assert.equal(recordedMessages.at(-1).content, "服务业的客户接待，痛点不知道");
  } finally {
    restore();
  }
});

test("score mode is treated as plain coaching chat", async () => {
  let recordedMessages = null;
  const { mockedCoach, restore } = withMockedChatCompletion(async (messages) => {
    recordedMessages = messages;
    return "先把场景写到一个具体时刻，再决定要不要确认提交。";
  });

  try {
    const result = await mockedCoach.chat(
      { messages: [], strategy: {} },
      "请基于当前内容给出评分",
      { mode: "score" }
    );

    assert.equal(result.replyText, "先把场景写到一个具体时刻，再决定要不要确认提交。");
    assert.equal(result.scoreValid, false);
    assert.equal(result.scorePreview, null);
    assert.equal(recordedMessages.at(-1).content, "请基于当前内容给出评分");
    assert.equal(recordedMessages.filter((m) => m.role === "user").length, 1);
  } finally {
    restore();
  }
});

test("confirm mode asks coach to omit scores from vp_result", async () => {
  let recordedMessages = null;
  const { mockedCoach, restore } = withMockedChatCompletion(async (messages) => {
    recordedMessages = messages;
    return [
      "最终版一句话价值主张",
      "<vp_result>",
      "{",
      '  "target_customer": "养老院采购负责人",',
      '  "scenario_pain": "夜间值班时住户情绪波动，护理员难以及时安抚",',
      '  "value_creation": "机器人通过主动互动和陪伴降低安抚压力",',
      '  "boundary": "重度医疗护理场景不适用"',
      "}",
      "</vp_result>"
    ].join("\n");
  });

  try {
    const result = await mockedCoach.chat(
      { messages: [], strategy: {} },
      "我们决定确认提交",
      { mode: "confirm" }
    );

    assert.match(recordedMessages.at(-1).content, /scores 字段不需要你填/);
    assert.deepEqual(result.vpResult, {
      target_customer: "养老院采购负责人",
      scenario_pain: "夜间值班时住户情绪波动，护理员难以及时安抚",
      value_creation: "机器人通过主动互动和陪伴降低安抚压力",
      boundary: "重度医疗护理场景不适用"
    });
    assert.equal(result.scoreValid, false);
  } finally {
    restore();
  }
});

test("parseVpScore is deprecated and returns null", () => {
  const parsed = parseVpScore([
    "说明文字",
    "<vp_score>",
    "{",
    '  "scores": {',
    '    "C": { "score": 3.2, "feedback": "..." },',
    '    "G": { "score": 2.0, "feedback": "..." },',
    '    "E": { "score": 2.5, "feedback": "..." }',
    "  }",
    "}",
    "</vp_score>"
  ].join("\n"));

  assert.equal(parsed, null);
});

test("chat does not append personal-experience question if latest assistant already asked it", async () => {
  const { mockedCoach, restore } = withMockedChatCompletion(async () => {
    return "先把场景写到一个具体时刻。";
  });

  try {
    const result = await mockedCoach.chat(
      {
        messages: [
          { role: "assistant", content: "你们身边有没有人会是这个产品的真实用户？" },
          { role: "user", content: "有，我们采访过两位家长。" }
        ],
        strategy: {}
      },
      "我们想再补一下痛点",
      { mode: "chat" }
    );

    assert.equal(result.replyText, "先把场景写到一个具体时刻。");
  } finally {
    restore();
  }
});
