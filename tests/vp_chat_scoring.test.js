const test = require("node:test");
const assert = require("node:assert/strict");

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function withMockedVpChat({ session, chatImpl, scoreVpImpl }) {
  const routePath = require.resolve("../server/routes/vpChat");
  const coachPath = require.resolve("../server/llm/vpCoach");
  const scorerPath = require.resolve("../server/llm/vpScorer");
  const sessionsPath = require.resolve("../server/llm/sessions");
  const originalRoute = require.cache[routePath];
  const originalCoach = require.cache[coachPath];
  const originalScorer = require.cache[scorerPath];
  const originalSessions = require.cache[sessionsPath];

  let storedSession = clone(session);
  const chatCalls = [];
  const scoreCalls = [];
  const appendCalls = [];
  const updateCalls = [];

  delete require.cache[routePath];
  require.cache[coachPath] = {
    id: coachPath,
    filename: coachPath,
    loaded: true,
    exports: {
      chat: async (...args) => {
        chatCalls.push(args);
        return chatImpl(...args);
      },
      startWithCanvas: async () => ({ replyText: "", vpResult: null })
    }
  };
  require.cache[scorerPath] = {
    id: scorerPath,
    filename: scorerPath,
    loaded: true,
    exports: {
      scoreVp: async (...args) => {
        scoreCalls.push(args);
        return scoreVpImpl(...args);
      }
    }
  };
  require.cache[sessionsPath] = {
    id: sessionsPath,
    filename: sessionsPath,
    loaded: true,
    exports: {
      createVpSession: async () => "session-1",
      appendMessage: async (sessionId, role, content) => {
        appendCalls.push({ sessionId, role, content });
        storedSession.messages = Array.isArray(storedSession.messages) ? storedSession.messages : [];
        storedSession.messages.push({ role, content });
      },
      getSession: async () => clone(storedSession),
      updateSession: async (_sessionId, patch) => {
        updateCalls.push(clone(patch));
        storedSession = { ...storedSession, ...clone(patch) };
        return clone(storedSession);
      }
    }
  };

  const vpChat = require("../server/routes/vpChat");
  return {
    vpChat,
    chatCalls,
    scoreCalls,
    appendCalls,
    updateCalls,
    restore() {
      delete require.cache[routePath];
      if (originalRoute) require.cache[routePath] = originalRoute;
      if (originalCoach) require.cache[coachPath] = originalCoach;
      else delete require.cache[coachPath];
      if (originalScorer) require.cache[scorerPath] = originalScorer;
      else delete require.cache[scorerPath];
      if (originalSessions) require.cache[sessionsPath] = originalSessions;
      else delete require.cache[sessionsPath];
    }
  };
}

function makeConfirmResult() {
  return {
    replyText: "最终版价值主张",
    vpResult: {
      target_customer: "独居老人",
      scenario_pain: "夜间起夜时缺少照护，存在安全隐患",
      value_creation: "通过提醒与陪伴降低照护压力",
      boundary: "不适用于急性医疗场景"
    },
    vpResultRaw: "{\"target_customer\":\"独居老人\"}"
  };
}

function makeScoreResult() {
  return {
    features: { has_clear_customer: 2, has_scenario: 1 },
    scores: { C: 2.6, G: 1.5, E: 2.5 },
    feedback: "建议补充更高频的真实痛点场景。"
  };
}

test("vpChat score mode reuses cached score when message count is unchanged", async () => {
  const cachedSession = {
    sessionId: "session-1",
    strategy: { cell_label: "ToC·COST·ELDER", architecture: "Function" },
    messages: [{ role: "user", content: "我们想服务独居老人。" }],
    pmfScore: {
      target_customer: "独居老人",
      scores: {
        C: { score: 2.6, feedback: "" },
        G: { score: 1.5, feedback: "" },
        E: { score: 2.5, feedback: "" }
      },
      feedback: "缓存命中",
      _scoring_features: { has_clear_customer: 2 },
      _scored_at_msg_count: 1
    }
  };

  const { vpChat, chatCalls, scoreCalls, appendCalls, updateCalls, restore } = withMockedVpChat({
    session: cachedSession,
    chatImpl: async () => makeConfirmResult(),
    scoreVpImpl: async () => makeScoreResult()
  });

  try {
    const res = await vpChat.chatTurn({ sessionId: "session-1", mode: "score" });
    assert.equal(res.status, 200);
    assert.equal(res.body.scoreValid, true);
    assert.deepEqual(res.body.scorePreview, {
      coverage: 2.6,
      generalizability: 1.5,
      effectiveness: 2.5
    });
    assert.equal(res.body.reply, "缓存命中");
    assert.equal(chatCalls.length, 0);
    assert.equal(scoreCalls.length, 0);
    assert.equal(appendCalls.length, 0);
    assert.equal(updateCalls.length, 0);
  } finally {
    restore();
  }
});

test("vpChat score and confirm share the same scoring path but differ in side effects", async () => {
  const baseSession = {
    sessionId: "session-1",
    strategy: { cell_label: "ToC·COST·ELDER", architecture: "Function" },
    messages: [{ role: "user", content: "我们想服务独居老人。" }],
    pmfScore: null
  };

  const scoreHarness = withMockedVpChat({
    session: baseSession,
    chatImpl: async (_session, _message, options) => {
      assert.equal(options.mode, "confirm");
      assert.equal(options.temperature, 0);
      return makeConfirmResult();
    },
    scoreVpImpl: async (text) => {
      assert.match(text, /目标客户：独居老人/);
      return makeScoreResult();
    }
  });

  const confirmHarness = withMockedVpChat({
    session: baseSession,
    chatImpl: async (_session, _message, options) => {
      assert.equal(options.mode, "confirm");
      assert.equal(options.temperature, 0);
      return makeConfirmResult();
    },
    scoreVpImpl: async () => makeScoreResult()
  });

  try {
    const scoreRes = await scoreHarness.vpChat.chatTurn({ sessionId: "session-1", mode: "score" });
    const confirmRes = await confirmHarness.vpChat.chatTurn({ sessionId: "session-1", mode: "confirm" });

    assert.deepEqual(scoreRes.body.scorePreview, confirmRes.body.scorePreview);
    assert.equal(scoreRes.body.scoreValid, true);
    assert.equal(confirmRes.body.scoreValid, true);

    assert.equal(scoreHarness.appendCalls.length, 0);
    assert.equal(scoreHarness.updateCalls.length, 1);
    assert.deepEqual(Object.keys(scoreHarness.updateCalls[0]), ["pmfScore"]);

    assert.equal(confirmHarness.appendCalls.length, 2);
    assert.equal(confirmHarness.updateCalls.length, 1);
    assert.equal(confirmHarness.updateCalls[0].status, "submitted");
    assert.ok(confirmHarness.updateCalls[0].pmfScore);
  } finally {
    scoreHarness.restore();
    confirmHarness.restore();
  }
});
