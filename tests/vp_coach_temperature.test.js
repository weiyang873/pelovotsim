const test = require("node:test");
const assert = require("node:assert/strict");

function withMockedVpCoach(chatCompletionImpl) {
  const coachPath = require.resolve("../server/llm/vpCoach");
  const clientPath = require.resolve("../server/llm/deepseekClient");
  const loggerPath = require.resolve("../server/llm/llm_logger");
  const originalCoach = require.cache[coachPath];
  const originalClient = require.cache[clientPath];
  const originalLogger = require.cache[loggerPath];

  delete require.cache[coachPath];
  require.cache[clientPath] = {
    id: clientPath,
    filename: clientPath,
    loaded: true,
    exports: { chatCompletion: chatCompletionImpl }
  };
  require.cache[loggerPath] = {
    id: loggerPath,
    filename: loggerPath,
    loaded: true,
    exports: { withLlmLogging: async (_ctx, fn) => fn() }
  };

  const mockedCoach = require("../server/llm/vpCoach");
  return {
    mockedCoach,
    restore() {
      delete require.cache[coachPath];
      if (originalCoach) require.cache[coachPath] = originalCoach;
      if (originalClient) require.cache[clientPath] = originalClient;
      else delete require.cache[clientPath];
      if (originalLogger) require.cache[loggerPath] = originalLogger;
      else delete require.cache[loggerPath];
    }
  };
}

test("vpCoach.chat forwards explicit temperature to chatCompletion", async () => {
  const seenOptions = [];
  const { mockedCoach, restore } = withMockedVpCoach(async (_messages, options) => {
    seenOptions.push(options);
    return "好的";
  });

  try {
    await mockedCoach.chat({ strategy: {}, messages: [] }, "测试", { mode: "confirm", temperature: 0 });
    assert.equal(seenOptions.length, 1);
    assert.equal(seenOptions[0].temperature, 0);
  } finally {
    restore();
  }
});

test("vpCoach.chat keeps default temperature when not provided", async () => {
  const seenOptions = [];
  const { mockedCoach, restore } = withMockedVpCoach(async (_messages, options) => {
    seenOptions.push(options);
    return "好的";
  });

  try {
    await mockedCoach.chat({ strategy: {}, messages: [] }, "测试", { mode: "chat" });
    assert.equal(seenOptions.length, 1);
    assert.equal(seenOptions[0].temperature, 0.6);
  } finally {
    restore();
  }
});
