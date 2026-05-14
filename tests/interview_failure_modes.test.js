const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

function loadLocalEnvFile() {
  const envPath = path.join(__dirname, "..", ".env");
  if (!fs.existsSync(envPath)) return;
  const content = fs.readFileSync(envPath, "utf8");
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith("\"") && value.endsWith("\"")) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!Object.prototype.hasOwnProperty.call(process.env, key)) {
      process.env[key] = value;
    }
  }
}

loadLocalEnvFile();

const { runSql, sqlQuote } = require("../server/db/pgSql");
const TeamManager = require("../server/multiplayer/teamManager");
const Sessions = require("../server/llm/sessions");

const ROUND2_MODULE_PATH = require.resolve("../server/routes/round2Routes");
const DEEPSEEK_MODULE_PATH = require.resolve("../server/llm/deepseekClient");
const PERSONA_GENERATOR_MODULE_PATH = require.resolve("../server/llm/personaGenerator");

function uniqueName(prefix) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

async function createTestTeam() {
  await TeamManager.ensureSchema();
  const team = await TeamManager.createTeam(uniqueName("round2_team"), 1);
  return TeamManager.getTeam(team.id);
}

async function seedRound1Context(teamId) {
  const sessionId = await Sessions.createVpSession(teamId, {});
  await Sessions.updateSession(sessionId, {
    pmfScore: {
      _confirmed_fields: {
        who_raw: "独居上班族"
      }
    }
  });
  await runSql(`
    UPDATE teams
    SET final_grid_id = 'ToB_Differentiation_Adult',
        final_architecture = 'Experience'
    WHERE id = ${sqlQuote(teamId)};
  `);
}

function buildHistory(turns) {
  const history = [];
  for (let i = 0; i < turns; i += 1) {
    history.push({ role: "user", speaker: "学生", text: `学生问题 ${i + 1}` });
    history.push({ role: "assistant", speaker: "访谈对象", text: `用户回答 ${i + 1}` });
  }
  return history;
}

async function insertInterviewSession({ teamId, memberId, roundNo, history, isComplete = false, result = null }) {
  const sessionId = `session_${crypto.randomUUID()}`;
  const now = new Date().toISOString();
  await runSql(`
    INSERT INTO round2_interview_sessions (
      session_id, team_id, member_id, member_dims_json, personas_json, history_json,
      result_json, persona_locked_at, round_no, is_complete, created_at, updated_at
    ) VALUES (
      ${sqlQuote(sessionId)},
      ${sqlQuote(teamId)},
      ${sqlQuote(memberId)},
      ${sqlQuote(JSON.stringify(["interaction", "safety"]))},
      ${sqlQuote(JSON.stringify([{ id: "persona-1", name: "测试访谈对象" }]))},
      ${sqlQuote(JSON.stringify(history))},
      ${sqlQuote(result ? JSON.stringify(result) : null)},
      ${sqlQuote(now)},
      ${Number(roundNo)},
      ${isComplete ? "TRUE" : "FALSE"},
      ${sqlQuote(now)},
      ${sqlQuote(now)}
    );
  `);
  return sessionId;
}

async function readInterviewSession(sessionId) {
  const rows = await runSql(`
    SELECT round_no, is_complete, history_json, result_json
    FROM round2_interview_sessions
    WHERE session_id = ${sqlQuote(sessionId)}
    LIMIT 1;
  `);
  return rows[0] || null;
}

function buildMockPersonaPayload(overrides = {}) {
  return JSON.stringify({
    name: "张院长",
    age: 48,
    title: "运营副院长",
    org_type: "民营养老院",
    org_scale: "120张床位，护工团队15人",
    pressures: ["夜班覆盖不足", "家属对夜间安全很敏感"],
    budget: "年度设备采购预算50万，超过20万需集团审批",
    trigger: "上个月夜巡记录被检查点名",
    personality: "务实谨慎，但愿意试点",
    background: "护理出身，做养老机构管理8年",
    daily_routine: "白天处理排班、投诉和运营数据，晚上经常盯夜班交接。",
    tech_comfort: "愿意尝试新技术，但必须先看稳定性和ROI。",
    interview_style: "会先讲场景和约束，需要你问到落地细节。",
    desires: ["降低夜班风险", "减少一线团队重复劳动"],
    pains: ["夜班人手紧张", "家属对安全问题很敏感"],
    hidden_pain: "最怕再出一次夜间事故，自己要承担责任。",
    contradictions: ["想尽快上系统但担心员工学不会", "预算有限但整改时间很紧"],
    ...overrides
  });
}

function buildMockConstraintPayload() {
  return JSON.stringify({
    age_range: [35, 55],
    living_situations: ["机构值班", "多院区来回跑"],
    key_pains: ["夜班风险高", "人手紧张"],
    key_jobs: ["保障安全", "控制运营成本"],
    context_clues: ["养老机构负责人", "有采购决策权"]
  });
}

function withMockedRound2(chatCompletionImpl) {
  const originalRound2 = require.cache[ROUND2_MODULE_PATH];
  const originalDeepseek = require.cache[DEEPSEEK_MODULE_PATH];
  const originalPersonaGenerator = require.cache[PERSONA_GENERATOR_MODULE_PATH];

  delete require.cache[ROUND2_MODULE_PATH];
  delete require.cache[PERSONA_GENERATOR_MODULE_PATH];
  require.cache[DEEPSEEK_MODULE_PATH] = {
    id: DEEPSEEK_MODULE_PATH,
    filename: DEEPSEEK_MODULE_PATH,
    loaded: true,
    exports: { chatCompletion: chatCompletionImpl, hasAnyKey: () => true }
  };

  const Round2 = require("../server/routes/round2Routes");
  return {
    Round2,
    restore() {
      delete require.cache[ROUND2_MODULE_PATH];
      delete require.cache[PERSONA_GENERATOR_MODULE_PATH];
      if (originalRound2) require.cache[ROUND2_MODULE_PATH] = originalRound2;
      if (originalPersonaGenerator) require.cache[PERSONA_GENERATOR_MODULE_PATH] = originalPersonaGenerator;
      if (originalDeepseek) require.cache[DEEPSEEK_MODULE_PATH] = originalDeepseek;
      else delete require.cache[DEEPSEEK_MODULE_PATH];
    }
  };
}

test("R7: chatCompletion throws -> 503, no DB write", { concurrency: false }, async () => {
  const team = await createTestTeam();
  const memberId = team.members[0].id;
  const history = buildHistory(3);

  const harness = withMockedRound2(async () => {
    throw new Error("boom");
  });

  try {
    await harness.Round2.ensureSchema();
    await seedRound1Context(team.id);
    const sessionId = await insertInterviewSession({
      teamId: team.id,
      memberId,
      roundNo: 3,
      history
    });

    const before = await readInterviewSession(sessionId);
    const out = await harness.Round2.interviewReply({ sessionId, message: "继续聊聊" });
    const after = await readInterviewSession(sessionId);

    assert.equal(out.status, 503);
    assert.equal(out.body?.error, "llm_unavailable");
    assert.equal(Number(after.round_no), Number(before.round_no));
    assert.equal(after.history_json, before.history_json);
    assert.equal(after.is_complete, before.is_complete);
  } finally {
    harness.restore();
  }
});

test("R7: chatCompletion returns empty -> 503, no DB write", { concurrency: false }, async () => {
  const team = await createTestTeam();
  const memberId = team.members[0].id;
  const history = buildHistory(2);

  const harness = withMockedRound2(async () => "   ");

  try {
    await harness.Round2.ensureSchema();
    await seedRound1Context(team.id);
    const sessionId = await insertInterviewSession({
      teamId: team.id,
      memberId,
      roundNo: 2,
      history
    });

    const before = await readInterviewSession(sessionId);
    const out = await harness.Round2.interviewReply({ sessionId, message: "还有别的吗" });
    const after = await readInterviewSession(sessionId);

    assert.equal(out.status, 503);
    assert.equal(out.body?.error, "llm_unavailable");
    assert.equal(after.history_json, before.history_json);
  } finally {
    harness.restore();
  }
});

test("R8: extractor failure on final turn preserves history and marks needsRescore", { concurrency: false }, async () => {
  const team = await createTestTeam();
  const memberId = team.members[0].id;
  const history = buildHistory(9);

  const harness = withMockedRound2(async (messages) => {
    const systemPrompt = String(messages?.[0]?.content || "");
    const userPrompt = String(messages?.[1]?.content || "");
    if (userPrompt.includes("请从以下访谈中提取结构化证据")) {
      throw new Error("extract failed");
    }
    if (systemPrompt.includes("需求分析助手")) {
      return buildMockConstraintPayload();
    }
    if (userPrompt.includes("你需要为一个商业模拟游戏生成一个用户访谈对象画像")) {
      return buildMockPersonaPayload();
    }
    return "这是正常的人设回复。";
  });

  try {
    await harness.Round2.ensureSchema();
    await seedRound1Context(team.id);
    const sessionId = await insertInterviewSession({
      teamId: team.id,
      memberId,
      roundNo: 9,
      history
    });

    const out = await harness.Round2.interviewReply({ sessionId, message: "最后一个问题" });
    const after = await readInterviewSession(sessionId);
    const savedHistory = JSON.parse(after.history_json);

    assert.equal(out.status, 503);
    assert.equal(out.body?.needsRescore, true);
    assert.equal(Number(after.round_no), 10);
    assert.equal(after.is_complete, false);
    assert.equal(savedHistory.length, history.length + 2);
  } finally {
    harness.restore();
  }
});

test("R8 rescore: succeeds when extractor recovers", { concurrency: false }, async () => {
  const team = await createTestTeam();
  const memberId = team.members[0].id;
  const history = buildHistory(10);
  let personaVariant = 0;

  const harness = withMockedRound2(async (messages) => {
    const systemPrompt = String(messages?.[0]?.content || "");
    const userPrompt = String(messages?.[1]?.content || "");
    if (userPrompt.includes("请从以下访谈中提取结构化证据")) {
      return JSON.stringify({
        dimension_evidence: {
          interaction: { mentioned: true, evidence: [{ quote: "想有人陪我说话", reason: "需要互动" }], needs: ["情感陪伴"], scenarios: ["下班回家"], pain_points: ["一个人太安静"] },
          safety: { mentioned: true, evidence: [{ quote: "家里黑的时候会担心", reason: "需要安全感" }], needs: ["夜间提醒"], scenarios: ["夜间起床"], pain_points: ["担心磕碰"] }
        },
        other_dimensions: {},
        tags: ["情感陪伴", "夜间提醒", "安全监护", "语音交互", "家庭关怀", "陪伴互动"],
        interview_quality: {
          specificity: "high",
          consistency: "medium",
          actionability: "medium"
        }
      });
    }
    if (systemPrompt.includes("需求分析助手")) {
      return buildMockConstraintPayload();
    }
    if (userPrompt.includes("你需要为一个商业模拟游戏生成一个用户访谈对象画像")) {
      personaVariant += 1;
      return buildMockPersonaPayload({
        name: personaVariant === 1 ? "张院长" : "李总监",
        title: personaVariant === 1 ? "运营副院长" : "采购总监",
        org_scale: personaVariant === 1 ? "120张床位，护工团队15人" : "3家院区，260张床位，护理团队42人",
        trigger: personaVariant === 1 ? "上个月夜巡记录被检查点名" : "新院区开业后，夜班投诉在两周内连续增加"
      });
    }
    return "这是正常的人设回复。";
  });

  try {
    await harness.Round2.ensureSchema();
    await seedRound1Context(team.id);
    const sessionId = await insertInterviewSession({
      teamId: team.id,
      memberId,
      roundNo: 10,
      history,
      isComplete: false,
      result: null
    });

    const out = await harness.Round2.rescoreInterview({ sessionId });
    const after = await readInterviewSession(sessionId);

    assert.equal(out.status, 200);
    assert.equal(out.body?.isComplete, true);
    assert.equal(after.is_complete, true);
    assert.ok(after.result_json);
  } finally {
    harness.restore();
  }
});

test("R8 rescore: idempotent on already-complete session", { concurrency: false }, async () => {
  const team = await createTestTeam();
  const memberId = team.members[0].id;
  const history = buildHistory(10);

  const harness = withMockedRound2(async () => {
    throw new Error("should not be called");
  });

  try {
    await harness.Round2.ensureSchema();
    await seedRound1Context(team.id);
    const sessionId = await insertInterviewSession({
      teamId: team.id,
      memberId,
      roundNo: 10,
      history,
      isComplete: true,
      result: {
        radar: { interaction: 6.2 },
        tags: ["情感陪伴"],
        evi: 0.82
      }
    });

    const out = await harness.Round2.rescoreInterview({ sessionId });
    assert.equal(out.status, 200);
    assert.equal(out.body?.idempotent, true);
    assert.deepEqual(out.body?.tags, ["情感陪伴"]);
  } finally {
    harness.restore();
  }
});

test("R8 rescore: rejects premature rescore", { concurrency: false }, async () => {
  const team = await createTestTeam();
  const memberId = team.members[0].id;
  const history = buildHistory(5);

  const harness = withMockedRound2(async () => {
    throw new Error("should not be called");
  });

  try {
    await harness.Round2.ensureSchema();
    await seedRound1Context(team.id);
    const sessionId = await insertInterviewSession({
      teamId: team.id,
      memberId,
      roundNo: 5,
      history,
      isComplete: false,
      result: null
    });

    const out = await harness.Round2.rescoreInterview({ sessionId });
    assert.equal(out.status, 400);
    assert.equal(out.body?.error, "interview not yet at final turn");
  } finally {
    harness.restore();
  }
});
