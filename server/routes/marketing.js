// marketing.js - route handlers for Marketing module (http-native)
const { generatePersona, formatPersonaCard } = require("../llm/personaGenerator");
const { conductInterview } = require("../llm/interviewCoach");
const { extractTags } = require("../llm/tagExtractor");
const { scoreTagsToDimensions } = require("../llm/dimensionScorer");
const { getDimensions } = require("../llm/embeddingService");
const { generateInterviewSummary } = require("../llm/requirementBuilder");
const {
  createMarketingSession,
  appendMessage,
  getSession,
  updateSession,
  getTeamSessions,
  getCompletedSessions
} = require("../llm/marketingSessions");

function makeResponse(status, body) {
  return { status, body };
}

async function start(body) {
  const { teamKey, memberId, strategy, vpCanvas } = body || {};
  if (!teamKey || !strategy || !vpCanvas) {
    return makeResponse(400, { ok: false, error: "teamKey, memberId, strategy, vpCanvas required" });
  }
  const normalizedMemberId = String(memberId || "member-1").trim() || "member-1";

  const persona = await generatePersona(vpCanvas, strategy);
  const personaCard = formatPersonaCard(persona);
  const sessionId = await createMarketingSession(teamKey, normalizedMemberId, strategy, vpCanvas, persona);

  return makeResponse(200, {
    ok: true,
    sessionId,
    memberId: normalizedMemberId,
    persona: personaCard,
    personaFull: persona
  });
}

async function interview(body) {
  const { sessionId, message } = body || {};
  if (!sessionId || !message) {
    return makeResponse(400, { ok: false, error: "sessionId and message required" });
  }

  const session = await getSession(sessionId);
  if (!session) return makeResponse(404, { ok: false, error: "session not found" });
  if (session.status !== "interviewing") {
    return makeResponse(400, { ok: false, error: "interview already ended" });
  }

  const { reply, turnCount, canEnd, assessment, reachedLimit } = await conductInterview(session, message);

  await appendMessage(sessionId, "user", message);
  await appendMessage(sessionId, "assistant", reply, { turnCount });

  let hint = null;
  if (reachedLimit) {
    hint = "已达到最大轮次（10轮），请点击\"结束访谈\"生成需求清单。";
  } else if (canEnd && assessment) {
    hint = `信息收集完整度：${assessment.coverage}%。${assessment.reason} 你可以继续追问，或点击\"结束访谈\"。`;
  }

  return makeResponse(200, {
    ok: true,
    reply,
    turnCount,
    canEnd,
    hint,
    assessment,
    reachedLimit
  });
}

async function endInterview(body) {
  const { sessionId } = body || {};
  if (!sessionId) return makeResponse(400, { ok: false, error: "sessionId required" });

  const session = await getSession(sessionId);
  if (!session) return makeResponse(404, { ok: false, error: "session not found" });

  try {
    await updateSession(sessionId, { status: "scoring" });
    const tags = await extractTags(session.messages || []);
    console.log("[marketing/end-interview] 提取标签:", tags);

    const scoreResult = await scoreTagsToDimensions(tags);
    console.log("[marketing/end-interview] 维度分数:", scoreResult.scores);

    const dimensions = getDimensions();
    const summary = await generateInterviewSummary(session.messages || [], session.persona || {});
    await updateSession(sessionId, {
      tags,
      dimensionScores: scoreResult.scores,
      anchorVersion: scoreResult.anchorVersion,
      summary,
      status: "completed"
    });

    return makeResponse(200, {
      ok: true,
      tags,
      scores: scoreResult.scores,
      dimensions,
      anchorVersion: scoreResult.anchorVersion,
      summary
    });
  } catch (e) {
    try {
      await updateSession(sessionId, { status: "interviewing" });
    } catch (_) {}
    throw e;
  }
}

async function teamSummary(query = {}) {
  const teamKey = String(query.teamKey || "").trim();
  if (!teamKey) return makeResponse(400, { ok: false, error: "teamKey required" });

  const completed = await getCompletedSessions(teamKey);
  const allStarted = await getTeamSessions(teamKey);
  if (!completed.length) {
    return makeResponse(200, { ok: true, ready: false, message: "尚无成员完成访谈" });
  }

  const dimKeys = ["interaction", "perception", "motion", "safety", "extend", "ops"];
  const aliasMap = {
    motion: ["motion", "mobility"],
    safety: ["safety", "safety_privacy"],
    extend: ["extend", "integration"],
    ops: ["ops", "operations"],
    interaction: ["interaction"],
    perception: ["perception"]
  };
  const scoreOf = (session, dim) => {
    const scoreObj = session?.dimensionScores || {};
    const aliases = aliasMap[dim] || [dim];
    for (const key of aliases) {
      const n = Number(scoreObj[key] || 0);
      if (Number.isFinite(n) && n > 0) return n;
    }
    return 0;
  };
  const mergedScores = {};
  dimKeys.forEach((d) => {
    const scores = completed
      .map((s) => scoreOf(s, d))
      .filter((v) => Number.isFinite(v) && v > 0);
    mergedScores[d] = scores.length
      ? Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 10) / 10
      : 0;
  });

  const summaries = completed.map((s) => ({
    memberId: s.memberId || "member-1",
    summary: s.summary || "（未生成摘要）",
    personaName: s.persona?.name || "未知"
  }));

  return makeResponse(200, {
    ok: true,
    ready: true,
    completedCount: completed.length,
    totalStarted: allStarted.length,
    mergedScores,
    summaries
  });
}

async function getSessionDetail(sessionId) {
  const session = await getSession(sessionId);
  if (!session) return makeResponse(404, { ok: false, error: "session not found" });
  return makeResponse(200, { ok: true, session });
}

async function exportSession(sessionId) {
  const session = await getSession(sessionId);
  if (!session) return makeResponse(404, { ok: false, error: "session not found" });

  const lines = [];
  lines.push("=== LOVOT Marketing 访谈记录 ===");
  lines.push(`小组：${session.teamKey}`);
  lines.push(`时间：${session.createdAt}`);
  lines.push(`策略：${JSON.stringify(session.strategy || {})}`);
  lines.push("");

  lines.push("=== 客户 Persona ===");
  lines.push(`${session.persona?.name || ""}，${session.persona?.age || ""}岁，${session.persona?.occupation || ""}`);
  lines.push(`居住：${session.persona?.living_situation || ""}`);
  lines.push(`性格：${session.persona?.personality || ""}`);
  lines.push("");

  lines.push("=== 访谈对话记录 ===");
  (session.messages || []).forEach((m) => {
    const role = m.role === "user" ? "学生(Marketing)" : `客户(${session.persona?.name || "客户"})`;
    lines.push(`[${role}] ${m.timestamp || ""}`);
    lines.push(String(m.content || ""));
    lines.push("");
  });

  if (Array.isArray(session.tags) && session.tags.length) {
    lines.push("=== 提取标签 ===");
    lines.push(
      session.tags
        .map((t) => `${t?.polarity === "negative" ? "✗" : "✓"} ${String(t?.tag || "")}`)
        .join("、")
    );
    lines.push("");
  }

  if (session.dimensionScores && typeof session.dimensionScores === "object") {
    lines.push("=== 市场需求维度分数 ===");
    Object.entries(session.dimensionScores).forEach(([key, score]) => {
      const s = Number(score || 0);
      lines.push(`${key}: ${"★".repeat(s)}${"☆".repeat(Math.max(0, 3 - s))} (${s}/3)`);
    });
  }

  const text = lines.join("\n");
  return makeResponse(200, {
    ok: true,
    filename: `marketing-record-${session.teamKey || "team"}-${Date.now()}.txt`,
    text
  });
}

module.exports = {
  start,
  interview,
  endInterview,
  teamSummary,
  getSessionDetail,
  exportSession
};
