const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildSystemPrompt,
  parseVpScore,
  normalizeScore,
  compactText,
  chat,
  synthesizeVP,
  generateSynthesisFeedback
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
  assert.match(prompt, /^## 格子一致性（最高优先级/);
  assert.match(prompt, /绝对不能建议、举例、暗示任何不属于这个市场的客户类型/);
  assert.match(prompt, /评分模式以外不要输出 C\/G\/E 分数或任何评分/);
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
      { messages: [{ role: "assistant", content: "前置开场已发送" }], strategy: {} },
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
      { messages: [{ role: "assistant", content: "前置开场已发送" }], strategy: {} },
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

test("buildSystemPrompt asks coach to reuse team ability hints naturally after opening", () => {
  const prompt = buildSystemPrompt({
    cell_label: "ToB·差异·老人",
    architecture: "Experience",
    jinang: {
      market: ["机构客户需求挖掘"],
      tech: ["健康数据与算法"]
    }
  }, { chatTurnIndex: 2 });

  assert.match(prompt, /如果学生在写解法（HOW）或讨论痛点（PAIN）时/);
  assert.match(prompt, /最多提 2 次/);
  assert.match(prompt, /不要说“根据你们的锦囊”/);
  assert.match(prompt, /你们团队的XX能力/);
});

test("buildSystemPrompt keeps the correction template aligned with current cell", () => {
  const prompt = buildSystemPrompt({
    cell_label: "ToB·差异·成人",
    market: "ToB",
    segment: "ADULT",
    architecture: "Experience"
  }, { chatTurnIndex: 2 });

  assert.match(prompt, /^## 格子一致性（最高优先级/);
  assert.match(prompt, /你们选的是ToB·差异·成人市场/);
  assert.match(prompt, /适合的客户类型比如：科技公司、金融机构、酒店/);
});

test("synthesizeVP reuses cached result when message count is unchanged", async () => {
  let callCount = 0;
  const { mockedCoach, restore } = withMockedChatCompletion(async () => {
    callCount += 1;
    return "不应触发新的模型调用";
  });

  try {
    const result = await mockedCoach.synthesizeVP({
      messages: [{ role: "assistant", content: "前置开场已发送" }],
      pmfScore: {
        _synthesis_message_count: 1,
        _vp_sentence: "为科技公司前台提供接待陪伴服务",
        _synthesis_feedback: "我帮你整理了一版，填在下方文本框里了。这版五个要素都覆盖了，可以点'提交VP'了。",
        _synthesis_raw: "\"为科技公司前台提供接待陪伴服务\""
      },
      strategy: {
        cell_label: "ToB·差异·成人",
        architecture: "Experience"
      }
    });

    assert.equal(callCount, 0);
    assert.equal(result.cached, true);
    assert.equal(result.vpText, "为科技公司前台提供接待陪伴服务");
    assert.match(result.feedback, /我帮你整理了一版/);
  } finally {
    restore();
  }
});

test("synthesizeVP feedback flags cell mismatch before other feedback", async () => {
  let callCount = 0;
  const { mockedCoach, restore } = withMockedChatCompletion(async () => {
    callCount += 1;
    if (callCount === 1) {
      return "\"为养老机构夜间值班场景提供陪伴机器人服务——减轻护理安抚压力。（待补充）\"";
    }
    return "当前已经说清了客户、痛点和解法，但还缺替代方案对比与边界条件，补完这些再点'提交VP'。";
  });

  try {
    const result = await mockedCoach.synthesizeVP({
      teamId: "team-1",
      messages: [
        { role: "assistant", content: "前置开场已发送" },
        { role: "user", content: "我们想服务企业前台接待场景" }
      ],
      strategy: {
        cell_label: "ToB·差异·成人",
        market: "ToB",
        segment: "ADULT",
        architecture: "Experience",
        jinang: {
          market: ["机构客户需求挖掘"],
          tech: ["健康数据与算法"]
        }
      }
    });

    assert.equal(result.cached, false);
    assert.equal(callCount, 2);
    assert.match(result.feedback, /^我帮你整理了一版，填在下方文本框里了。/);
    assert.match(result.feedback, /你们选的是ToB·差异·成人市场/);
    assert.match(result.feedback, /养老机构/);
    assert.doesNotMatch(result.feedback, /C\/G\/E|评分/);
  } finally {
    restore();
  }
});

test("generateSynthesisFeedback falls back to concrete non-scoring advice when model mentions score terms", async () => {
  const { mockedCoach, restore } = withMockedChatCompletion(async () => (
    "这版在人群覆盖面和解法说服力上还差一点，建议继续补充。"
  ));

  try {
    const feedback = await mockedCoach.generateSynthesisFeedback(
      {
        strategy: {
          cell_label: "ToB·差异·成人",
          market: "ToB",
          segment: "ADULT",
          architecture: "Experience",
          jinang: {
            market: ["机构客户需求挖掘"],
            tech: ["健康数据与算法"]
          }
        }
      },
      "为企业前台接待场景提供情绪安抚机器人服务，解决等待焦虑的问题——现有人工寒暄很难持续稳定。",
      ["机构客户需求挖掘", "健康数据与算法"]
    );

    assert.match(feedback, /^我帮你整理了一版，填在下方文本框里了。/);
    assert.match(feedback, /这版已经把客户、痛点、解法、替代方案对比说出来了/);
    assert.match(feedback, /边界条件还没落下/);
    assert.match(feedback, /补完这些再点'提交VP'。/);
    assert.match(feedback, /你们团队的机构客户需求挖掘能力|你们团队的健康数据与算法能力/);
    assert.doesNotMatch(feedback, /人群覆盖面|解法说服力|C\/G\/E|评分/);
  } finally {
    restore();
  }
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
