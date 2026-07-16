// vpChat.js - route handlers for VP chat (http-native)
const { chat, startWithCanvas } = require("../llm/vpCoach");
const { scoreVp } = require("../llm/vpScorer");
const { createVpSession, appendMessage, getSession, updateSession } = require("../llm/sessions");

function makeResponse(status, body) {
  return { status, body };
}

function clipScore(v, lo = 1, hi = 5) {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return Math.max(lo, Math.min(hi, Math.round(n * 10) / 10));
}

function emptyApiScores() {
  return {
    coverage: null,
    generalizability: null,
    effectiveness: null
  };
}

function scorerScoresToApi(scores) {
  if (!scores || typeof scores !== "object") return null;
  const coverage = clipScore(scores.C);
  const generalizability = clipScore(scores.G);
  const effectiveness = clipScore(scores.E);
  if (coverage == null || generalizability == null || effectiveness == null) return null;
  return { coverage, generalizability, effectiveness };
}

function areApiScoresEmpty(scores) {
  if (!scores || typeof scores !== "object") return true;
  return ["coverage", "generalizability", "effectiveness"].every((key) => scores[key] == null);
}

function vpResultToApiScores(vpResult) {
  if (!vpResult || typeof vpResult !== "object") return null;
  const scores = vpResult.scores;
  if (!scores || typeof scores !== "object") return null;
  const coverage = clipScore(scores.C?.score ?? scores.C);
  const generalizability = clipScore(scores.G?.score ?? scores.G);
  const effectiveness = clipScore(scores.E?.score ?? scores.E);
  if (coverage == null || generalizability == null || effectiveness == null) return null;
  return { coverage, generalizability, effectiveness };
}

function toArchitecturePromptLabel(arch) {
  if (arch === "Experience") return "体验型";
  if (arch === "Function") return "功能型";
  if (arch === "Hybrid") return "混合型";
  return arch || "未提供";
}

function buildVpResultScoringText(vpResult) {
  const result = vpResult && typeof vpResult === "object" ? vpResult : null;
  if (!result) return "";
  return [
    result.target_customer || result.who ? `目标客户：${String(result.target_customer || result.who || "").trim()}` : "",
    result.scenario_pain || result.pain ? `场景痛点：${String(result.scenario_pain || result.pain || "").trim()}` : "",
    result.value_creation || result.how ? `价值创造：${String(result.value_creation || result.how || "").trim()}` : "",
    result.boundary ? `边界条件：${String(result.boundary || "").trim()}` : ""
  ].filter(Boolean).join("\n");
}

function buildFallbackVpResult(session, replyText, scorePreview) {
  const messages = Array.isArray(session?.messages) ? session.messages : [];
  const parts = messages.map((m) => String(m?.content || ""));
  parts.push(String(replyText || ""));
  const readField = (label) => {
    for (let i = parts.length - 1; i >= 0; i -= 1) {
      const text = String(parts[i] || "");
      const match = text.match(new RegExp(`${label}\\s*[：:]\\s*([^\\n]+)`));
      if (match) return match[1].trim();
    }
    return "";
  };
  return {
    target_customer: readField("WHO") || "未提取到明确目标人群",
    scenario_pain: readField("PAIN") || "未提取到明确痛点场景",
    value_creation: readField("HOW") || "未提取到明确解决机制",
    boundary: readField("BOUNDARY") || "未明确",
    scores: {
      C: { score: scorePreview?.coverage ?? null, feedback: "" },
      G: { score: scorePreview?.generalizability ?? null, feedback: "" },
      E: { score: scorePreview?.effectiveness ?? null, feedback: "" }
    }
  };
}

async function runScoring(session) {
  const cellLabel = session.strategy?.cell_label || session.strategy?.cellLabel || "未提供";
  const archLabel = toArchitecturePromptLabel(
    session.strategy?.architecture_label || session.strategy?.architecture
  );
  const confirmMsg = "我们决定确认提交最终版价值主张，请给出最终提交结果。";

  const tempSession = {
    ...session,
    messages: Array.isArray(session.messages)
      ? session.messages.map((item) => ({ ...item }))
      : []
  };

  let out = await chat(tempSession, confirmMsg, { mode: "confirm", temperature: 0 });
  let replyText = out.replyText || "";
  let vpResult = out.vpResult || null;
  let vpResultRaw = out.vpResultRaw || null;

  if (!vpResult) {
    out = await chat(session, confirmMsg, { mode: "confirm", temperature: 0 });
    replyText = out.replyText || "";
    vpResult = out.vpResult || null;
    vpResultRaw = out.vpResultRaw || null;
  }

  if (!vpResult) {
    vpResult = buildFallbackVpResult(session, replyText, null);
  }

  const scoringText = buildVpResultScoringText(vpResult) || replyText || "（暂无）";
  const scoringResult = await scoreVp(scoringText, cellLabel, archLabel).catch(() => null);

  const features = scoringResult?.features || null;
  let scorePreview = scorerScoresToApi(scoringResult?.scores);
  let scoreValid = Boolean(scorePreview);
  if (!scoreValid) {
    scorePreview = emptyApiScores();
  }

  if (vpResult && scoreValid) {
    vpResult = {
      ...vpResult,
      scores: {
        C: { score: scorePreview?.coverage ?? null, feedback: "" },
        G: { score: scorePreview?.generalizability ?? null, feedback: "" },
        E: { score: scorePreview?.effectiveness ?? null, feedback: "" }
      }
    };
  }

  const pmfScorePayload = scoreValid ? {
    ...vpResult,
    ...(features ? { _scoring_features: features } : {}),
    feedback: String(scoringResult?.feedback || "").trim(),
    _scored_at_msg_count: Array.isArray(session.messages) ? session.messages.length : 0
  } : null;

  return {
    replyText,
    vpResult,
    vpResultRaw,
    scorePreview,
    scoreValid,
    features,
    pmfScorePayload
  };
}

async function createSession(body) {
  const { teamKey, strategy } = body || {};
  if (!teamKey) return makeResponse(400, { ok: false, error: "teamKey required" });
  const sessionId = await createVpSession(teamKey, strategy);
  return makeResponse(200, { ok: true, sessionId });
}

async function submitCanvas(body) {
  const { sessionId, vpCanvas } = body || {};
  if (!sessionId || !vpCanvas) return makeResponse(400, { ok: false, error: "sessionId and vpCanvas required" });

  const session = await getSession(sessionId);
  if (!session) return makeResponse(404, { ok: false, error: "session not found" });

  await updateSession(sessionId, { vpCanvas });
  const { replyText, vpResult } = await startWithCanvas(session, vpCanvas);

  const canvasText = typeof vpCanvas === "string" ? vpCanvas : JSON.stringify(vpCanvas);
  await appendMessage(sessionId, "user", `[VP Canvas 提交]\n${canvasText}`);
  await appendMessage(sessionId, "assistant", replyText);

  return makeResponse(200, { ok: true, reply: replyText, vpResult });
}

async function chatTurn(body) {
  const payload = body || {};
  const sessionId = String(payload.sessionId || "").trim();
  const rawMessage = String(payload.message || "").trim();
  const mode = String(payload.mode || payload.action || (payload.isSubmit ? "score" : "chat")).toLowerCase();
  if (!sessionId) return makeResponse(400, { ok: false, error: "sessionId required" });
  if (mode !== "chat" && mode !== "score" && mode !== "confirm") {
    return makeResponse(400, { ok: false, error: "mode must be chat, score, or confirm" });
  }
  if (mode === "chat" && !rawMessage) {
    return makeResponse(400, { ok: false, error: "message required" });
  }

  const session = await getSession(sessionId);
  if (!session) return makeResponse(404, { ok: false, error: "session not found" });

  if (mode === "chat") {
    const out = await chat(session, rawMessage, { mode: "chat" });
    await appendMessage(sessionId, "user", rawMessage);
    await appendMessage(sessionId, "assistant", out.replyText);
    await updateSession(sessionId, { status: "chatting" });

    return makeResponse(200, {
      ok: true,
      mode,
      reply: out.replyText,
      vpResult: null,
      vpResultRaw: null,
      scorePreview: null,
      scoreValid: false,
      features: null
    });
  }

  if (mode === "score") {
    const cached = session.pmfScore;
    const msgCount = Array.isArray(session.messages) ? session.messages.length : 0;
    const cachedPreview = vpResultToApiScores(cached);
    const cachedFeatures = cached?._scoring_features || null;
    if (
      cached &&
      cached._scored_at_msg_count === msgCount &&
      cachedPreview &&
      !areApiScoresEmpty(cachedPreview)
    ) {
      return makeResponse(200, {
        ok: true,
        mode,
        reply: String(cached.feedback || "").trim(),
        vpResult: cached,
        vpResultRaw: null,
        scorePreview: cachedPreview,
        scoreValid: true,
        features: cachedFeatures
      });
    }
  }

  const result = await runScoring(session);

  if (mode === "score") {
    await updateSession(sessionId, { pmfScore: result.pmfScorePayload });
  }

  if (mode === "confirm") {
    const userMsg = "我们决定确认提交最终版价值主张，请给出最终提交结果。";
    await appendMessage(sessionId, "user", userMsg);
    await appendMessage(sessionId, "assistant", result.replyText);
    await updateSession(sessionId, {
      pmfScore: result.pmfScorePayload,
      status: "submitted"
    });
  }

  return makeResponse(200, {
    ok: true,
    mode,
    reply: result.replyText,
    vpResult: result.vpResult,
    vpResultRaw: result.vpResultRaw,
    scorePreview: result.scorePreview,
    scoreValid: result.scoreValid,
    features: result.features
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
  lines.push("=== AI 宠物机器人 VP Coach 对话记录 ===");
  lines.push(`小组：${session.teamKey || ""}`);
  lines.push(`时间：${session.createdAt || ""}`);
  lines.push(`策略：${JSON.stringify(session.strategy || {})}`);
  lines.push("");

  if (session.vpCanvas && typeof session.vpCanvas === "object") {
    const c = session.vpCanvas;
    lines.push("=== 最终 VP Canvas ===");
    lines.push(`Customer Jobs：${c.customerJobs || ""}`);
    lines.push(`Pains：${c.pains || ""}`);
    lines.push(`Gains：${c.gains || ""}`);
    lines.push(`Products & Services：${c.products || ""}`);
    lines.push(`Pain Relievers：${c.painRelievers || ""}`);
    lines.push(`Gain Creators：${c.gainCreators || ""}`);
    lines.push("");
  }

  lines.push("=== 对话记录 ===");
  (session.messages || []).forEach((m) => {
    const role = m.role === "user" ? "学生" : "Coach";
    lines.push(`[${role}] ${m.timestamp || ""}`);
    lines.push(String(m.content || ""));
    lines.push("");
  });

  if (session.pmfScore && session.pmfScore.scores) {
    const s = session.pmfScore.scores;
    const getScore = (x) => Number((x && typeof x === "object") ? x.score : x);
    const getFeedback = (x) => String((x && typeof x === "object") ? x.feedback || "" : "").trim();
    const formatScore = (x) => Number.isFinite(x) ? x.toFixed(1) : "0.0";
    lines.push("=== C/G/E 评分 ===");
    lines.push(`Coverage (C)：${formatScore(getScore(s.C))}/5.0 ${getFeedback(s.C)}`);
    lines.push(`Generalizability (G)：${formatScore(getScore(s.G))}/5.0 ${getFeedback(s.G)}`);
    lines.push(`Effectiveness (E)：${formatScore(getScore(s.E))}/5.0 ${getFeedback(s.E)}`);
  }

  const text = lines.join("\n");
  return makeResponse(200, {
    ok: true,
    filename: `vp-record-${session.teamKey || "team"}-${Date.now()}.txt`,
    text
  });
}

module.exports = {
  createSession,
  submitCanvas,
  chatTurn,
  getSessionDetail,
  exportSession
};
