const crypto = require("node:crypto");
const { runSql, sqlQuote } = require("../db/pgSql");
const { chatCompletion } = require("../llm/deepseekClient");
const { withLlmLogging } = require("../llm/llm_logger");
const { getTeamSessions } = require("../llm/sessions");
const { buildDataUrl, generateLovotImage } = require("../llm/lovotImageGen");
const { loadJinangConfig } = require("../multiplayer/jinangDealer");
const { listTeamIterations } = require("../multiplayer/vpIterationStore");
const Round2 = require("./round2Routes");
const PROMPT_CACHE_VERSION = "teacher_debrief_v2";
const TEAM_COLORS = [
  "#E8634A", "#3B82C4", "#2FAB6E", "#D4A03C", "#8B5CF6",
  "#EC4899", "#14B8A6", "#F97316", "#06B6D4", "#84CC16"
];
const ARCH_DISPLAY = {
  Experience: { label: "体验●", color: "#8B5CF6", symbol: "●" },
  Hybrid: { label: "混合▲", color: "#F59E0B", symbol: "▲" },
  Function: { label: "功能■", color: "#3B82F6", symbol: "■" }
};
let __teacherDebriefSchemaPromise = null;

function makeResponse(status, body) {
  return { status, body };
}

function normalizeSessionId(value) {
  const raw = String(value || "").trim();
  return raw || "default";
}

function safeJsonParse(text, fallback) {
  if (text == null || text === "") return fallback;
  if (typeof text === "object") return text;
  try {
    return JSON.parse(text);
  } catch (_) {
    return fallback;
  }
}

function toFiniteNumber(value, fallback = null) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function normalizeTeacherCode(value) {
  return String(value || "").trim();
}

function readTeacherCode({ headers, query, body }) {
  const hdrs = headers || {};
  const auth = String(hdrs.authorization || hdrs.Authorization || "").trim();
  if (/^Bearer\s+/i.test(auth)) {
    return normalizeTeacherCode(auth.replace(/^Bearer\s+/i, ""));
  }
  return normalizeTeacherCode(
    body?.code ||
    (typeof query?.get === "function" ? query.get("code") : query?.code) ||
    hdrs["x-admin-code"] ||
    hdrs["x-teacher-code"] ||
    hdrs["x-access-code"]
  );
}

function verifyTeacherAuth(ctx) {
  const expected = normalizeTeacherCode(process.env.ADMIN_CODE);
  if (!expected) return makeResponse(500, { ok: false, error: "ADMIN_CODE not configured" });
  const actual = readTeacherCode(ctx);
  if (!actual || actual !== expected) return makeResponse(403, { ok: false, error: "密码错误" });
  return makeResponse(200, { ok: true });
}

async function ensureSchema() {
  if (__teacherDebriefSchemaPromise) return __teacherDebriefSchemaPromise;
  __teacherDebriefSchemaPromise = (async () => {
    await Round2.ensureSchema();
    await runSql(`
      ALTER TABLE teams ADD COLUMN IF NOT EXISTS session_id TEXT DEFAULT 'default';
      ALTER TABLE teams ADD COLUMN IF NOT EXISTS lovot_image TEXT;
      ALTER TABLE teams ADD COLUMN IF NOT EXISTS lovot_image_mime TEXT DEFAULT 'image/png';
      UPDATE teams SET session_id = 'default' WHERE session_id IS NULL;
      UPDATE teams
      SET lovot_image_mime = 'image/png'
      WHERE (lovot_image_mime IS NULL OR lovot_image_mime = '')
        AND COALESCE(lovot_image, '') <> '';

      CREATE TABLE IF NOT EXISTS debrief_cache (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        round INTEGER NOT NULL,
        type TEXT NOT NULL,
        content TEXT NOT NULL,
        generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_debrief_cache_lookup
        ON debrief_cache(session_id, round, type);
    `);
  })();
  try {
    await __teacherDebriefSchemaPromise;
  } catch (err) {
    __teacherDebriefSchemaPromise = null;
    throw err;
  }
  return __teacherDebriefSchemaPromise;
}

function formatArchitectureLabel(arch) {
  const raw = String(arch || "").trim().toLowerCase();
  if (raw === "experience") return "体验●";
  if (raw === "hybrid") return "混合▲";
  if (raw === "function") return "功能■";
  return String(arch || "");
}

function normalizeArchitectureKey(arch) {
  const raw = String(arch || "").trim().toLowerCase();
  if (raw === "experience") return "Experience";
  if (raw === "hybrid") return "Hybrid";
  if (raw === "function") return "Function";
  return String(arch || "").trim();
}

function getArchDisplay(arch) {
  const key = normalizeArchitectureKey(arch);
  return ARCH_DISPLAY[key] || {
    label: formatArchitectureLabel(key),
    color: "#64748b",
    symbol: ""
  };
}

function formatGridLabel(gridId) {
  const raw = String(gridId || "").trim();
  if (!raw) return "";
  const parts = raw.split("_");
  const channelMap = { B2B: "ToB", TOB: "ToB", B2C: "ToC", TOC: "ToC" };
  const strategyMap = { DIFFERENTIATION: "差异化", DIFF: "差异化", COST: "成本" };
  const focusMap = {
    ELDER: "老人",
    ADULT: "成人",
    CHILD: "儿童",
    EXPERIENCE: "体验",
    HYBRID: "混合",
    MIXED: "混合",
    FUNCTION: "功能"
  };
  return [
    channelMap[String(parts[0] || "").toUpperCase()] || parts[0] || "",
    strategyMap[String(parts[1] || "").toUpperCase()] || parts[1] || "",
    focusMap[String(parts[2] || "").toUpperCase()] || parts[2] || ""
  ].filter(Boolean).join("·");
}

function extractVpField(text, key) {
  const re = new RegExp(`${key}\\s*[：:]\\s*([^\\n]+)`);
  const match = String(text || "").match(re);
  return match ? match[1].trim() : "";
}

function normalizeRadar(radar) {
  const src = radar && typeof radar === "object" ? radar : {};
  return {
    interaction: Number(src.interaction || 0),
    perception: Number(src.perception || 0),
    motion: Number(src.motion != null ? src.motion : src.mobility != null ? src.mobility : 0),
    safety: Number(src.safety != null ? src.safety : src.safety_privacy != null ? src.safety_privacy : 0),
    extend: Number(src.extend != null ? src.extend : src.integration != null ? src.integration : 0),
    ops: Number(src.ops != null ? src.ops : src.operations != null ? src.operations : 0)
  };
}

function computeCsvMetrics(team) {
  const grid = String(team?.r1?.grid || "");
  const price = Number(team?.r2?.price || 0);
  const dCOGS = Number(team?.r2?.dCOGS || 0);
  const units = Number(team?.r2?.units || 0);
  const profit = Number(team?.r2?.profit || 0);
  const f = grid.includes("B2B") ? 0.15 : 0.25;
  const totalCost = 2000 + dCOGS;
  const gmRatio = team?.r2?.actualGm != null
    ? Number(team.r2.actualGm)
    : (price > 0 ? ((price * (1 - f) - totalCost) / price) : 0);
  const gm = gmRatio * 100;
  const roi = units > 0 && dCOGS > 0 ? (profit / (units * dCOGS)) * 100 : 0;
  const consistent = String(team?.r1?.grid || "") === String(team?.r2?.bestGrid || "") ? "是" : "否";
  return { gm, roi, consistent };
}

function computeVpCompositeScore(C, G, E) {
  const c = Math.max(1, Math.min(5, Number(C || 0) || 3));
  const g = Math.max(1, Math.min(5, Number(G || 0) || 3));
  const e = Math.max(1, Math.min(5, Number(E || 0) || 3));
  const avgGE = (g + e) / 2;
  return Math.min(5, Math.round(Math.sqrt(c * avgGE) * 10) / 10);
}

function formatDisplayName(name, fallbackIndex) {
  const raw = String(name || "").trim();
  const canonical = `第${fallbackIndex + 1}组`;
  if (!raw) return canonical;
  const match = raw.match(/^第\s*(\d+)\s*组$/);
  if (match) return `第${Number(match[1])}组`;
  return canonical;
}

function roundNumber(value, digits = 1) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Number(n.toFixed(digits));
}

function computeImprovementPct(initialScore, finalScore) {
  const start = Number(initialScore);
  const end = Number(finalScore);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  if (start <= 0 && end > 0) return 100;
  if (start <= 0) return 0;
  return Math.round(((end - start) / start) * 100);
}

function buildIterationNote(scoreBefore, scoreAfter, options = {}) {
  const before = Number(scoreBefore);
  const after = Number(scoreAfter);
  const delta = Number.isFinite(before) && Number.isFinite(after) ? after - before : 0;
  if (options.usedBest) return "最终提交采用了历史最佳版本。";
  if (delta >= 1) return "这一轮迭代让 VP 明显变清晰了。";
  if (delta >= 0.3) return "这一轮有提升，主要是表述更聚焦。";
  if (delta <= -0.8) return "这一轮回退明显，可能偏离了用户场景。";
  if (delta <= -0.3) return "这一轮略有回退，需要重新收敛。";
  return "这一轮主要是微调表达，分数变化有限。";
}

function csvEscape(value) {
  const str = value == null ? "" : String(value);
  return `"${str.replace(/"/g, "\"\"")}"`;
}

function generateCsv(teams) {
  const headers = [
    "组名", "格子", "架构", "VP", "C", "G", "E", "Eadj", "SAM", "WTPadj",
    "定价", "dCOGS", "卡数", "风险", "产品力", "销量", "利润", "单台利润",
    "毛利率", "研发ROI", "R2最匹配格子", "战略一致"
  ];
  const rows = (Array.isArray(teams) ? teams : []).map((team) => {
    const metrics = computeCsvMetrics(team);
    return [
      team.name || "",
      team.r1?.grid || "",
      team.r1?.arch || "",
      team.r1?.vp || "",
      team.r1?.C ?? "",
      team.r1?.G ?? "",
      team.r1?.E ?? "",
      team.r1?.Eadj ?? "",
      team.r1?.sam ?? "",
      team.r1?.wtpAdj ?? "",
      team.r2?.price ?? "",
      team.r2?.dCOGS ?? "",
      team.r2?.cardCount ?? "",
      team.r2?.riskTotal ?? "",
      team.r2?.vscore ?? "",
      team.r2?.units ?? "",
      team.r2?.profit ?? "",
      team.r2?.profitPerUnit ?? "",
      Math.round(metrics.gm),
      Math.round(metrics.roi),
      team.r2?.bestGrid || "",
      metrics.consistent
    ].map(csvEscape).join(",");
  });
  return [headers.map(csvEscape).join(","), ...rows].join("\n");
}

async function getLatestActivityIso(sessionId) {
  await ensureSchema();
  const sid = normalizeSessionId(sessionId);
  const rows = await runSql(`
    SELECT MAX(ts) AS latest_ts
    FROM (
      SELECT MAX(t.created_at)::text AS ts
      FROM teams t
      WHERE COALESCE(t.session_id, 'default') = ${sqlQuote(sid)}

      UNION ALL

      SELECT MAX(vs.updated_at)::text AS ts
      FROM vp_sessions vs
      JOIN teams t ON t.id = vs.team_key
      WHERE COALESCE(t.session_id, 'default') = ${sqlQuote(sid)}

      UNION ALL

      SELECT MAX(submitted_at)::text AS ts
      FROM round2_submissions
      WHERE session_id = ${sqlQuote(sid)}

      UNION ALL

      SELECT MAX(updated_at)::text AS ts
      FROM fg_team_radar
      WHERE session_id = ${sqlQuote(sid)}

      UNION ALL

      SELECT MAX(computed_at)::text AS ts
      FROM round2_results
      WHERE session_id = ${sqlQuote(sid)}

      UNION ALL

      SELECT MAX(timestamp)::text AS ts
      FROM computation_log
      WHERE session_id = ${sqlQuote(sid)}
    ) q;
  `);
  return String(rows[0]?.latest_ts || "");
}

async function getCache(sessionId, round, type) {
  await ensureSchema();
  const rows = await runSql(`
    SELECT id, content, generated_at
    FROM debrief_cache
    WHERE session_id = ${sqlQuote(normalizeSessionId(sessionId))}
      AND round = ${Number(round || 0)}
      AND type = ${sqlQuote(type)}
    LIMIT 1;
  `);
  const row = rows[0];
  if (!row) return null;
  return {
    id: row.id,
    generated_at: row.generated_at,
    content: safeJsonParse(row.content, null)
  };
}

async function setCache(sessionId, round, type, content) {
  await ensureSchema();
  const sid = normalizeSessionId(sessionId);
  const id = `${sid}:${round}:${type}`;
  await runSql(`
    INSERT INTO debrief_cache (id, session_id, round, type, content, generated_at)
    VALUES (
      ${sqlQuote(id)},
      ${sqlQuote(sid)},
      ${Number(round || 0)},
      ${sqlQuote(type)},
      ${sqlQuote(JSON.stringify(content || {}))},
      NOW()
    )
    ON CONFLICT(id) DO UPDATE SET
      content = EXCLUDED.content,
      generated_at = EXCLUDED.generated_at;
  `);
}

function cacheIsFresh(cache, latestActivityIso) {
  if (!cache?.generated_at) return false;
  if (cache?.content?.prompt_version !== PROMPT_CACHE_VERSION) return false;
  if (!latestActivityIso) return true;
  const cacheTime = new Date(cache.generated_at).getTime();
  const latestTime = new Date(latestActivityIso).getTime();
  if (!Number.isFinite(cacheTime) || !Number.isFinite(latestTime)) return false;
  return cacheTime >= latestTime;
}

async function getTeamsForSession(sessionId) {
  await ensureSchema();
  const sid = normalizeSessionId(sessionId);
  return runSql(`
    SELECT
      id,
      team_name,
      team_size,
      created_at,
      COALESCE(session_id, 'default') AS session_id,
      final_grid_id,
      final_architecture,
      final_vp_text,
      final_vp_summary,
      final_vp_c,
      final_vp_g,
      final_vp_e_raw,
      final_vp_e_adj,
      final_sam,
      final_wtp_adj,
      final_vp_scores,
      (COALESCE(lovot_image, '') <> '') AS has_lovot_image
    FROM teams
    WHERE COALESCE(session_id, 'default') = ${sqlQuote(sid)}
    ORDER BY created_at ASC, team_name ASC;
  `);
}

async function getMemberRows(teamId) {
  return runSql(`
    SELECT id, member_name, member_index, jinang_market_id, jinang_tech_id
    FROM team_members
    WHERE team_id = ${sqlQuote(teamId)}
    ORDER BY member_index ASC;
  `);
}

async function getSubmissionRows(teamId) {
  return runSql(`
    SELECT member_id, grid_id, architecture, vp_draft, submitted_at
    FROM member_submissions
    WHERE team_id = ${sqlQuote(teamId)}
    ORDER BY submitted_at ASC NULLS LAST, member_id ASC;
  `);
}

async function getLatestMemberInterviewRows(teamId) {
  return runSql(`
    SELECT DISTINCT ON (member_id)
      member_id,
      result_json,
      updated_at
    FROM round2_interview_sessions
    WHERE team_id = ${sqlQuote(teamId)}
      AND is_complete = TRUE
    ORDER BY member_id ASC, updated_at DESC;
  `);
}

async function getJinangSettlements(teamId) {
  return runSql(`
    SELECT member_id, jinang_type, matched, effect_applied
    FROM jinang_settlements
    WHERE team_id = ${sqlQuote(teamId)};
  `);
}

function parseEffectStrength(row) {
  const effect = safeJsonParse(row?.effect_applied, {});
  const strength = Number(effect.match_strength ?? effect.matchStrength ?? 0);
  return Number.isFinite(strength) ? Number(strength.toFixed(2)) : 0;
}

function mapJinangConfig() {
  const cfg = loadJinangConfig();
  return {
    market: Object.fromEntries((cfg.market || []).map((item) => [item.id, item])),
    tech: Object.fromEntries((cfg.tech || []).map((item) => [item.id, item]))
  };
}

async function buildTeamMembers(teamId) {
  const [memberRows, submissionRows, settlementRows, interviewRows] = await Promise.all([
    getMemberRows(teamId),
    getSubmissionRows(teamId),
    getJinangSettlements(teamId),
    getLatestMemberInterviewRows(teamId)
  ]);
  const submissionMap = Object.fromEntries(submissionRows.map((row) => [row.member_id, row]));
  const interviewMap = Object.fromEntries(interviewRows.map((row) => [row.member_id, {
    result: safeJsonParse(row.result_json, null),
    updated_at: row.updated_at || null
  }]));
  const settlementMap = {};
  settlementRows.forEach((row) => {
    if (!settlementMap[row.member_id]) settlementMap[row.member_id] = {};
    settlementMap[row.member_id][row.jinang_type] = row;
  });
  const jinangMap = mapJinangConfig();

  return memberRows.map((member) => {
    const submission = submissionMap[member.id] || null;
    const interview = interviewMap[member.id] || null;
    const marketSettlement = settlementMap[member.id]?.market || null;
    const techSettlement = settlementMap[member.id]?.tech || null;
    return {
      id: member.id,
      name: member.member_name || `成员${member.member_index || ""}`,
      persona: "",
      r1_personal: {
        grid: submission?.grid_id || "",
        gridLabel: formatGridLabel(submission?.grid_id),
        arch: normalizeArchitectureKey(submission?.architecture),
        who: extractVpField(submission?.vp_draft, "WHO"),
        pain: extractVpField(submission?.vp_draft, "PAIN"),
        how: extractVpField(submission?.vp_draft, "HOW")
      },
      r2_evi: toFiniteNumber(interview?.result?.evi, null),
      jinang_market: jinangMap.market[member.jinang_market_id]?.name || member.jinang_market_id || "",
      jinang_tech: jinangMap.tech[member.jinang_tech_id]?.name || member.jinang_tech_id || "",
      jinang_market_match: parseEffectStrength(marketSettlement),
      jinang_tech_match: parseEffectStrength(techSettlement)
    };
  });
}

async function getMarketMatchStrength(teamId) {
  const rows = await runSql(`
    SELECT effect_applied
    FROM jinang_settlements
    WHERE team_id = ${sqlQuote(teamId)} AND jinang_type = 'market';
  `);
  let best = 0;
  rows.forEach((row) => {
    const effect = safeJsonParse(row.effect_applied, {});
    const strength = Number(effect.match_strength || effect.matchStrength || 0);
    if (Number.isFinite(strength)) best = Math.max(best, strength);
  });
  return Number(best.toFixed(2));
}

async function getLatestRound2Logs(teamId, sessionId) {
  const rows = await runSql(`
    SELECT stage, params, timestamp, id
    FROM computation_log
    WHERE team_id = ${sqlQuote(teamId)}
      AND session_id = ${sqlQuote(normalizeSessionId(sessionId))}
      AND stage IN ('r2_profit', 'r2_volume', 'r2_tag_layering', 'r2_card_selection', 'r2_coverage')
    ORDER BY timestamp DESC, id DESC;
  `);
  const picked = {
    r2_profit: null,
    r2_volume: null,
    r2_tag_layering: null,
    r2_card_selection: null,
    r2_coverage: null
  };
  rows.forEach((row) => {
    if (!picked[row.stage]) {
      picked[row.stage] = row.params && typeof row.params === "object"
        ? row.params
        : safeJsonParse(row.params, {});
    }
  });
  return picked;
}

function normalizeTagList(list) {
  return Array.from(new Set(
    (Array.isArray(list) ? list : [])
      .map((item) => String(item || "").trim())
      .filter(Boolean)
  ));
}

function getCausalWarning(coverCore, vscore) {
  const coreCoverage = Number(coverCore);
  const productV = Number(vscore);
  if (Number.isFinite(coreCoverage) && coreCoverage < 0.5) {
    const missPct = ((1 - coreCoverage) * 100).toFixed(0);
    return {
      type: "card_drift",
      label: "选卡偏移",
      explain: `访谈发现的核心需求有${missPct}%未被选卡覆盖，产品与用户需求脱节`
    };
  }
  if (Number.isFinite(productV) && productV < 0.25) {
    return {
      type: "low_v",
      label: "产品力不足",
      explain: "选卡覆盖了核心需求但档位偏低或亮点需求缺失，产品整体竞争力不足"
    };
  }
  return { type: null, label: null, explain: null };
}

function buildCausalDetail(result, logs, coverCore, vscore) {
  const coverageLog = logs?.r2_coverage || {};
  const tagLayeringLog = logs?.r2_tag_layering || {};
  const cardSelectionLog = logs?.r2_card_selection || {};
  const tagBreakdown = Array.isArray(coverageLog.tag_breakdown)
    ? coverageLog.tag_breakdown
    : [];

  let coreTags = normalizeTagList(
    tagBreakdown.filter((item) => item?.tier === "core").map((item) => item.tag)
  );
  let niceTags = normalizeTagList(
    tagBreakdown.filter((item) => item?.tier === "nice").map((item) => item.tag)
  );

  if (!coreTags.length && !niceTags.length) {
    coreTags = normalizeTagList(tagLayeringLog.core_tags);
    niceTags = normalizeTagList(tagLayeringLog.nice_tags);
  }

  if (!coreTags.length && !niceTags.length && Array.isArray(result?.tagBreakdown)) {
    coreTags = normalizeTagList(
      result.tagBreakdown.filter((item) => item?.tier === "core").map((item) => item.tag)
    );
    niceTags = normalizeTagList(
      result.tagBreakdown.filter((item) => item?.tier === "nice").map((item) => item.tag)
    );
  }

  let coveredTagSet = new Set(
    tagBreakdown
      .filter((item) => Number(item?.covered || 0) > 0)
      .map((item) => String(item.tag || "").trim())
      .filter(Boolean)
  );

  if (coveredTagSet.size === 0) {
    coveredTagSet = new Set(
      (Array.isArray(cardSelectionLog.selections) ? cardSelectionLog.selections : [])
        .flatMap((item) => Array.isArray(item?.covers) ? item.covers : [])
        .map((item) => String(item || "").trim())
        .filter(Boolean)
    );
  }

  if (!coreTags.length && !niceTags.length) {
    return null;
  }

  const coveredCoreTags = coreTags.filter((tag) => coveredTagSet.has(tag));
  const uncoveredCoreTags = coreTags.filter((tag) => !coveredTagSet.has(tag));
  const coveredNiceTags = niceTags.filter((tag) => coveredTagSet.has(tag));
  const uncoveredNiceTags = niceTags.filter((tag) => !coveredTagSet.has(tag));
  const warning = getCausalWarning(coverCore, vscore);

  return {
    coreTags,
    coveredCoreTags,
    uncoveredCoreTags,
    niceTags,
    coveredNiceTags,
    uncoveredNiceTags,
    warningType: warning.type,
    warningLabel: warning.label,
    warningExplain: warning.explain
  };
}

async function getRound1VpLogs(teamId, sessionId) {
  const rows = await runSql(`
    SELECT stage, params, timestamp, id
    FROM computation_log
    WHERE team_id = ${sqlQuote(teamId)}
      AND session_id = ${sqlQuote(normalizeSessionId(sessionId))}
      AND stage IN ('r1_vp_score', 'r1_vp_score_final')
    ORDER BY timestamp ASC, id ASC;
  `);
  return rows.map((row) => ({
    stage: row.stage,
    timestamp: row.timestamp,
    params: row.params && typeof row.params === "object" ? row.params : safeJsonParse(row.params, {})
  }));
}

async function buildVpIterationData(teamId, sessionId, fallbackVpText) {
  const storedIterations = await listTeamIterations(teamId);
  if (storedIterations.length) {
    const iterations = storedIterations.map((item) => ({
      round: Number(item.iteration || 0),
      speaker: String(item.speakerName || "").trim() || "团队成员",
      persona: String(item.speakerPersona || "").trim(),
      scoreBefore: roundNumber(item.scoreBefore, 1),
      scoreAfter: roundNumber(item.scoreAfter, 1),
      vpBefore: String(item.vpBefore || "").trim(),
      vpAfter: String(item.vpAfter || "").trim(),
      scoreC: roundNumber(item.scoreC, 1),
      scoreG: roundNumber(item.scoreG, 1),
      scoreE: roundNumber(item.scoreE, 1),
      sourceIteration: item.sourceIteration || null,
      usedBest: item.usedBestIteration === true,
      note: buildIterationNote(item.scoreBefore, item.scoreAfter, { usedBest: item.usedBestIteration === true }),
      timestamp: item.createdAt || null
    }));
    const validScores = iterations
      .map((entry) => Number(entry.scoreAfter))
      .filter((value) => Number.isFinite(value));
    const initialScore = validScores.length ? validScores[0] : null;
    const finalScore = validScores.length ? validScores[validScores.length - 1] : null;
    const bestScore = validScores.length ? Math.max(...validScores) : finalScore;
    const usedBest = iterations.some((entry) => entry.usedBest);
    return {
      iterations,
      initialScore,
      finalScore,
      bestScore,
      improvementPct: computeImprovementPct(initialScore, finalScore),
      usedBest
    };
  }

  const [scoreLogs, sessions] = await Promise.all([
    getRound1VpLogs(teamId, sessionId),
    getTeamSessions(teamId)
  ]);
  const session = Array.isArray(sessions) && sessions.length ? sessions[sessions.length - 1] : null;
  const userMessages = Array.isArray(session?.messages)
    ? session.messages.filter((item) => item?.role === "user")
    : [];
  const scoreEvents = scoreLogs.length
    ? scoreLogs
    : [{
        stage: "r1_vp_score_final",
        timestamp: null,
        params: {
          vp_text: String(fallbackVpText || "").trim()
        }
      }];

  const iterations = [];
  let previousScore = null;
  let previousVpText = "";
  scoreEvents.forEach((event, index) => {
    const params = event.params || {};
    const scoreAfter = roundNumber(
      params.VPscore != null
        ? params.VPscore
        : computeVpCompositeScore(params.raw_C, params.raw_G, params.raw_E),
      1
    );
    const vpText = String(params.vp_text || fallbackVpText || "").trim();
    const speakerMessage = userMessages[index] || userMessages[userMessages.length - 1] || null;
    const speaker = String(speakerMessage?.speaker || speakerMessage?.name || "").trim() || "团队成员";
    const persona = String(speakerMessage?.persona || "").trim();
    iterations.push({
      round: index + 1,
      speaker,
      persona,
      scoreBefore: previousScore,
      scoreAfter,
      vpBefore: previousVpText,
      vpAfter: vpText,
      scoreC: roundNumber(params.raw_C, 1),
      scoreG: roundNumber(params.raw_G, 1),
      scoreE: roundNumber(params.raw_E != null ? params.raw_E : params.Eadj, 1),
      sourceIteration: String(params.source_iteration || "").trim() || null,
      usedBest: params.used_best_iteration === true,
      note: buildIterationNote(previousScore, scoreAfter, { usedBest: params.used_best_iteration === true }),
      timestamp: event.timestamp || null
    });
    previousScore = scoreAfter;
    previousVpText = vpText;
  });

  const validScores = iterations
    .map((item) => Number(item.scoreAfter))
    .filter((value) => Number.isFinite(value));
  const initialScore = validScores.length ? validScores[0] : null;
  const finalScore = validScores.length ? validScores[validScores.length - 1] : null;
  const bestScore = validScores.length ? Math.max(...validScores) : finalScore;
  const usedBest = iterations.some((item) => item.usedBest);

  return {
    iterations,
    initialScore,
    finalScore,
    bestScore,
    improvementPct: computeImprovementPct(initialScore, finalScore),
    usedBest
  };
}

async function buildTeamRecord(teamRow, sessionId, teamIndex) {
  const rawScores = safeJsonParse(teamRow.final_vp_scores, {}) || {};
  const vpSummary = safeJsonParse(teamRow.final_vp_summary, {}) || {};
  const members = await buildTeamMembers(teamRow.id);
  const vpJourney = await buildVpIterationData(teamRow.id, sessionId, teamRow.final_vp_text);
  const r1 = {
    grid: teamRow.final_grid_id || "",
    gridLabel: formatGridLabel(teamRow.final_grid_id),
    arch: normalizeArchitectureKey(teamRow.final_architecture),
    archLabel: formatArchitectureLabel(teamRow.final_architecture),
    archMeta: getArchDisplay(teamRow.final_architecture),
    vp: String(teamRow.final_vp_text || "").replace(/\s+/g, " ").trim(),
    who: String(vpSummary.who || vpSummary.WHO || extractVpField(teamRow.final_vp_text, "WHO") || "").trim(),
    pain: String(vpSummary.pain || vpSummary.PAIN || extractVpField(teamRow.final_vp_text, "PAIN") || "").trim(),
    how: String(vpSummary.how || vpSummary.HOW || extractVpField(teamRow.final_vp_text, "HOW") || "").trim(),
    C: teamRow.final_vp_c != null ? Number(teamRow.final_vp_c) : Number(rawScores.C || 0),
    G: teamRow.final_vp_g != null ? Number(teamRow.final_vp_g) : Number(rawScores.G || 0),
    E: teamRow.final_vp_e_raw != null ? Number(teamRow.final_vp_e_raw) : Number(rawScores.E || 0),
    Eadj: teamRow.final_vp_e_adj != null ? Number(teamRow.final_vp_e_adj) : Number(rawScores.E || 0),
    VPscore: rawScores.VPscore != null ? Number(rawScores.VPscore) : null,
    sam: teamRow.final_sam != null ? Number(teamRow.final_sam) : null,
    wtpAdj: teamRow.final_wtp_adj != null ? Number(teamRow.final_wtp_adj) : null,
    jinangMatch: await getMarketMatchStrength(teamRow.id),
    vpInitialScore: vpJourney.initialScore,
    vpFinalScore: vpJourney.finalScore,
    vpBestScore: vpJourney.bestScore,
    vpImprovementPct: vpJourney.improvementPct,
    vpIterations: vpJourney.iterations.length,
    vpUsedBest: vpJourney.usedBest
  };

  const snapshot = await Round2.getTeamResultSnapshot(teamRow.id, sessionId);
  const logs = await getLatestRound2Logs(teamRow.id, sessionId);
  const profitLog = logs.r2_profit || {};
  const volumeLog = logs.r2_volume || {};
  const result = snapshot?.result?.result || {};
  const bestGrid = snapshot?.result?.best_grid || snapshot?.submission?.best_grid || r1.grid;
  const cards = Array.isArray(snapshot?.submission?.cards)
    ? snapshot.submission.cards.map((item) => item.label || `${item.name || item.id}·${item.tierLabel || item.tier || ""}`)
    : [];
  const submissionPrice = snapshot?.submission?.price;
  const submissionDcogs = snapshot?.submission?.dcogs;
  const units = toFiniteNumber(snapshot?.result?.units, profitLog.Q);
  const totalProfit = toFiniteNumber(snapshot?.result?.profit, profitLog.total_profit);
  const actualGm = toFiniteNumber(profitLog.actual_gm, result.actualGm);
  const profitPerUnit = units > 0
    ? Math.round(Number(totalProfit || 0) / units)
    : (snapshot?.result?.profit_per_unit ?? null);
  const vscore = toFiniteNumber(volumeLog.Vscore, snapshot?.result?.vscore);
  const evi = toFiniteNumber(snapshot?.radar?.evi, result.evi);
  const effectiveWtpAdj = toFiniteNumber(result.wtpPrime, result.WTP, r1.wtpAdj);

  const r2 = {
    // 优先读 submission / result 快照（学生提交时的固化值），log 仅作 fallback。
    price: toFiniteNumber(submissionPrice, profitLog.P),
    wtpAdj: effectiveWtpAdj,
    dCOGS: toFiniteNumber(submissionDcogs, profitLog.dCOGS),
    cardCount: snapshot?.submission?.card_count ?? 0,
    riskTotal: snapshot?.submission?.risk_total ?? toFiniteNumber(result.risk, null),
    vscore,
    radar: normalizeRadar(snapshot?.radar?.radar || {}),
    bestGrid,
    bestGridLabel: formatGridLabel(bestGrid),
    units,
    Q: units,
    profit: totalProfit,
    totalProfit,
    profitHw: toFiniteNumber(profitLog.profit_hw, result.profitHW),
    profitSub: toFiniteNumber(profitLog.profit_sub, result.profitSub),
    profitPerUnit,
    submittedAt: snapshot?.submission?.submitted_at || null,
    cards,
    roi: result.roi == null ? null : Number(result.roi),
    nre: toFiniteNumber(result.nre_total_wan, null),
    coverCore: toFiniteNumber(result.coverCore, null),
    coverNice: toFiniteNumber(result.coverNice, null),
    evi,
    gm: actualGm,
    actualGm
  };
  const causalDetail = buildCausalDetail(result, logs, r2.coverCore, r2.vscore);

  const counterfactualPrice = Number.isFinite(Number(r2.wtpAdj)) && Number(r2.wtpAdj) > 0
    ? Math.round(Number(r2.wtpAdj) * 0.72)
    : null;

  if (snapshot?.submission && Number.isFinite(counterfactualPrice) && counterfactualPrice > 0) {
    try {
      const counterfactual = await Round2.computeProfitAtPrice(teamRow.id, sessionId, counterfactualPrice);
      r2.counterfactual = {
        price: counterfactualPrice,
        units: toFiniteNumber(counterfactual?.units, null),
        profit: toFiniteNumber(counterfactual?.profit, null),
        unitMargin: toFiniteNumber(counterfactual?.unitMargin, null),
        profitDelta: Number.isFinite(Number(counterfactual?.profit)) && Number.isFinite(Number(r2.profit))
          ? Number(counterfactual.profit) - Number(r2.profit)
          : null
      };
    } catch (_) {
      r2.counterfactual = null;
    }
  } else {
    r2.counterfactual = null;
  }

  return {
    id: teamRow.id,
    name: teamRow.team_name || teamRow.id,
    displayName: formatDisplayName(teamRow.team_name, teamIndex),
    color: TEAM_COLORS[teamIndex % TEAM_COLORS.length],
    teamIndex,
    hasLovotImage: Boolean(teamRow.has_lovot_image),
    has_lovot_image: Boolean(teamRow.has_lovot_image),
    members,
    memberCount: Number(teamRow.team_size || members.length || 0),
    r1,
    r2,
    causalDetail,
    vpTimeline: vpJourney.iterations
  };
}

function extractLovotVpData(teamRow) {
  const summary = safeJsonParse(teamRow?.final_vp_summary, {}) || {};
  const who = String(summary.who || summary.WHO || extractVpField(teamRow?.final_vp_text, "WHO") || "").trim();
  const pain = String(summary.pain || summary.PAIN || extractVpField(teamRow?.final_vp_text, "PAIN") || "").trim();
  const how = String(summary.how || summary.HOW || extractVpField(teamRow?.final_vp_text, "HOW") || "").trim();

  return { who, pain, how };
}

async function getLovotTeamRow(teamId) {
  await ensureSchema();
  const rows = await runSql(`
    SELECT
      id,
      team_name,
      status,
      final_grid_id,
      final_architecture,
      final_vp_text,
      final_vp_summary,
      lovot_image,
      lovot_image_mime
    FROM teams
    WHERE id = ${sqlQuote(teamId)}
    LIMIT 1;
  `);
  return rows[0] || null;
}

async function generateLovotForTeam(teamId) {
  const team = await getLovotTeamRow(teamId);
  if (!team) {
    const notFound = new Error("Team not found");
    notFound.status = 404;
    throw notFound;
  }

  const { who, pain, how } = extractLovotVpData(team);
  if (!who && !pain && !how) {
    const invalid = new Error("该组尚未提交 VP，无法生成形象");
    invalid.status = 400;
    throw invalid;
  }

  const gridLabel = formatGridLabel(team.final_grid_id);
  const generated = await generateLovotImage({
    who,
    pain,
    how,
    gridLabel,
    arch: team.final_architecture
  });

  await runSql(`
    UPDATE teams
    SET lovot_image = ${sqlQuote(generated.base64)},
        lovot_image_mime = ${sqlQuote(generated.mimeType || "image/png")}
    WHERE id = ${sqlQuote(teamId)};
  `);

  return {
    ok: true,
    team_id: teamId,
    mimeType: generated.mimeType || "image/png",
    image: buildDataUrl(generated.base64, generated.mimeType || "image/png"),
    modelUsed: generated.modelUsed || ""
  };
}

async function getLovotImageApi(teamId) {
  const team = await getLovotTeamRow(teamId);
  if (!team || !String(team.lovot_image || "").trim()) {
    return makeResponse(404, { ok: false, error: "尚未生成" });
  }
  return makeResponse(200, {
    ok: true,
    team_id: String(team.id || teamId),
    image: buildDataUrl(team.lovot_image, team.lovot_image_mime || "image/png")
  });
}

async function buildDebriefData(sessionId) {
  const sid = normalizeSessionId(sessionId);
  const teamRows = await getTeamsForSession(sid);
  const teams = [];
  for (let index = 0; index < teamRows.length; index += 1) {
    teams.push(await buildTeamRecord(teamRows[index], sid, index));
  }

  const meta = {
    totalStudents: teams.reduce((sum, team) => sum + Number(team.memberCount || 0), 0),
    totalTeams: teams.length,
    teamsSubmittedR1: teams.filter((team) => team.r1?.grid).length,
    teamsSubmittedR2: teams.filter((team) => team.r2?.price != null && team.r2?.profit != null).length
  };

  return { teams, meta };
}

function compactRound1PromptData(data) {
  return (data.teams || []).map((team) => ({
    组别: team.displayName || team.name,
    定位: team.r1.gridLabel,
    架构: team.r1.archLabel || team.r1.arch,
    VP: team.r1.vp,
    C: team.r1.C,
    G: team.r1.G,
    E: team.r1.E,
    Eadj: team.r1.Eadj,
    SAM: team.r1.sam,
    WTPadj: team.r1.wtpAdj,
    锦囊匹配: team.r1.jinangMatch
  }));
}

function compactRound2PromptData(data) {
  return (data.teams || [])
    .filter((team) => Number.isFinite(Number(team.r2?.profit)))
    .map((team) => ({
      组别: team.displayName || team.name,
      R1定位: team.r1.gridLabel,
      定价: team.r2.price,
      dCOGS: team.r2.dCOGS,
      卡数: team.r2.cardCount,
      风险: team.r2.riskTotal,
      产品力: team.r2.vscore,
      雷达: team.r2.radar,
      匹配格子: team.r2.bestGridLabel,
      销量: team.r2.units,
      硬件利润: team.r2.profitHw,
      订阅利润: team.r2.profitSub,
      利润: team.r2.profit,
      实际毛利率: team.r2.actualGm,
      单台利润: team.r2.profitPerUnit,
      毛利率: team.r2.gm,
      提交时间: team.r2.submittedAt,
      卡片: team.r2.cards
    }));
}

function buildRound2PromptSummary(data) {
  const validTeams = (data.teams || [])
    .filter((team) => Number.isFinite(Number(team.r2?.profit)))
    .map((team) => ({
      组别: team.displayName || team.name,
      R1定位: team.r1.gridLabel,
      R2匹配格子: team.r2.bestGridLabel,
      定价: Number(team.r2.price || 0),
      dCOGS: Number(team.r2.dCOGS || 0),
      产品力: Number(team.r2.vscore || 0),
      销量: Number(team.r2.units || 0),
      硬件利润: Number(team.r2.profitHw || 0),
      订阅利润: Number(team.r2.profitSub || 0),
      利润: Number(team.r2.profit || 0),
      毛利率: team.r2.actualGm == null ? null : Number(team.r2.actualGm),
      提交时间: team.r2.submittedAt || ""
    }));

  const byProfitDesc = validTeams.slice().sort((a, b) => b.利润 - a.利润);
  const byProfitAsc = validTeams.slice().sort((a, b) => a.利润 - b.利润);
  const byDcogsDesc = validTeams.slice().sort((a, b) => b.dCOGS - a.dCOGS);
  const bySubmitDesc = validTeams
    .slice()
    .sort((a, b) => String(b.提交时间 || "").localeCompare(String(a.提交时间 || "")));

  return {
    总组数: Number(data?.meta?.totalTeams || 0),
    R1已提交组数: Number(data?.meta?.teamsSubmittedR1 || 0),
    R2已提交组数: Number(data?.meta?.teamsSubmittedR2 || 0),
    有效R2样本数: validTeams.length,
    利润冠军候选: byProfitDesc.slice(0, 3),
    利润最低候选: byProfitAsc.slice(0, 3),
    高dCOGS候选: byDcogsDesc.slice(0, 3),
    最新提交候选: bySubmitDesc.slice(0, 3)
  };
}

function buildGlobalPrompt(round, data) {
  if (Number(round) === 1) {
    return [
      "你是一位EMBA商业模拟课程的教学助手。以下是本届学生在Round 1（市场定位）的决策数据。",
      "请生成一份中文课堂复盘讲解稿，供教授在课堂上直接使用。",
      "",
      "## 数据",
      JSON.stringify(compactRound1PromptData(data), null, 2),
      "",
      "## 输出格式",
      "",
      "严格按以下结构输出，使用 Markdown 格式：",
      "",
      "## 全局观察",
      "2-3句话总结本届学生整体的选择倾向。包括：",
      "- 哪些格子最热门/最冷门",
      "- 差异化 vs 成本策略的比例",
      "- 架构选择（体验/混合/功能）和策略的一致性",
      "- 有没有集体盲点（所有人都忽略的市场）",
      "",
      "## 典型对比：第X组 vs 第Y组",
      "自动选择对比度最大的一对组。优先比较同格子但VP质量差距大的组，其次比较相似策略但结果分化大的组。",
      "用3-5句话解释两组差异，必须引用具体数据（SAM、WTPadj、C/G/E）。",
      "",
      "## 课堂讨论引导",
      "生成2个问题，每个问题都以“请第X组”开头，不要给答案。",
      "",
      "## 注意事项",
      "- 语言风格像经验丰富的教授课堂发言，不像书面报告",
      "- 不要说“数据显示”",
      "- 可以用反问句增加互动感",
      "- 引用数据时用自然语言"
    ].join("\n");
  }

  return [
    "你是一位EMBA商业模拟课程的教学助手。以下是本届学生在Round 2（产品研发+定价）的完整决策和结果数据。",
    "请生成一份中文课堂复盘讲解稿，供教授在课堂上直接使用。",
    "",
    "## 数据",
    JSON.stringify({
      汇总: buildRound2PromptSummary(data),
      有效样本: compactRound2PromptData(data)
    }, null, 2),
    "",
    "## 输出格式",
    "",
    "严格按以下结构输出，使用 Markdown 格式：",
    "",
    "## 全局观察",
    "2-3句话总结结果分布。必须包括：",
    "- 利润冠军是谁，赢在哪里",
    "- 利润最低的已提交组，问题出在哪里",
    "- 一个出乎意料的发现",
    "",
    "## 利润冠军分析：第X组（定位，Y万）",
    "3-5句话深入分析冠军成功原因，必须包括赛道、选卡纪律、定价精准度，并引用具体数字。",
    "",
    "## 堆料教训：第X组（定位，Y万）",
    "优先选择“已提交且亏损”或“dCOGS 最高且利润明显不佳”的组；如果有效样本只有2组，就直接选择亏损或表现更差的那一组。分析高成本如何被渠道费放大，以及如果降档会怎样。",
    "",
    "## 战略一致性",
    "一句话总结多少组R1和R2保持一致；如果有跑偏的组，用2句话说明原因和结果。",
    "",
    "## 课堂讨论引导",
    "生成3个问题，分别关于渠道费结构效应、ToB vs ToC利润差异、堆料 vs 精准选卡。",
    "",
    "## 强约束",
    "- 只允许从“已提交且有有效利润结果”的组里选冠军组和最低利润组，严禁把未提交空白组写成最低利润组",
    "- 如果有效样本数 <= 3，必须逐一提到全部有效样本，不能只讲冠军",
    "- 如果存在亏损组，必须明确点名至少1个亏损组并解释亏损原因",
    "- 如果存在最新提交的有效样本，优先把它纳入“出乎意料的发现”或“堆料教训”",
    "- 可以提到未提交组，但只能放在“战略执行断层”语境里，不能把它们当成经营结果样本",
    "",
    "## 注意事项",
    "- 语言风格同Round 1",
    "- 毛利率公式：GM = (P×(1-f) - V - dCOGS) / P，其中 V=2000，ToB f=0.15，ToC f=0.25",
    "- 研发ROI = 利润 ÷ (销量 × dCOGS)",
    "- 不要暴露模型参数，只用自然语言描述因果",
    "- 若样本少，要直接说“当前有效样本较少”，但仍要完成比较，不要说“无法分析”或“暂无典型组别”"
  ].join("\n");
}

function extractJsonObject(text) {
  const raw = String(text || "").replace(/```json|```/g, "").trim();
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start >= 0 && end > start) {
    return safeJsonParse(raw.slice(start, end + 1), null);
  }
  return safeJsonParse(raw, null);
}

async function generateGlobalDebrief(round, sessionId) {
  const sid = normalizeSessionId(sessionId);
  const latestActivity = await getLatestActivityIso(sid);
  const cache = await getCache(sid, round, "global");
  if (cacheIsFresh(cache, latestActivity) && cache?.content?.text) {
    return cache.content;
  }

  const data = await buildDebriefData(sid);
  const prompt = buildGlobalPrompt(round, data);
  const globalMessages = [
    { role: "system", content: "你是EMBA课程的课堂复盘助手。请严格遵守用户给定结构输出中文 Markdown。" },
    { role: "user", content: prompt }
  ];
  const text = await withLlmLogging({
    caller: "teacherDebrief.generateGlobalDebrief",
    teamId: null,
    memberId: null,
    messages: globalMessages
  }, () => chatCompletion(globalMessages, { temperature: 0.4, max_tokens: 1400 }));

  const payload = {
    round: Number(round),
    session_id: sid,
    prompt_version: PROMPT_CACHE_VERSION,
    text: String(text || "").trim()
  };
  await setCache(sid, round, "global", payload);
  return payload;
}

async function generateTeamReview(teamId, sessionId) {
  const sid = normalizeSessionId(sessionId);
  const type = `team_${teamId}`;
  const latestActivity = await getLatestActivityIso(sid);
  const cache = await getCache(sid, 2, type);
  if (cacheIsFresh(cache, latestActivity) && cache?.content?.insight && cache?.content?.review) {
    return cache.content;
  }

  const data = await buildDebriefData(sid);
  const team = (data.teams || []).find((item) => item.id === teamId);
  if (!team) throw new Error("team not found");

  const profits = data.teams.map((item) => Number(item.r2?.profit || 0)).filter((n) => Number.isFinite(n));
  const dcogs = data.teams.map((item) => Number(item.r2?.dCOGS || 0)).filter((n) => Number.isFinite(n));
  const prompt = [
    "你是一位EMBA商业模拟课程的教学助手。以下是一个团队的完整决策数据（Round 1 + Round 2）。",
    "请生成两段文字。",
    "",
    "## 数据",
    JSON.stringify(team, null, 2),
    `全班利润范围：${Math.min(...profits, 0)} - ${Math.max(...profits, 0)}`,
    `全班dCOGS范围：${Math.min(...dcogs, 0)} - ${Math.max(...dcogs, 0)}`,
    "",
    "## 输出格式（严格JSON）",
    "{",
    '  "insight": "一句话（20-40字），概括这组做对了什么或做错了什么，像报纸标题一样精炼",',
    '  "review": "3-5句话的详细分析（150-250字）。必须包含：(1)从R1到R2的战略一致性，(2)选卡亮点或问题，(3)定价和渠道的互动效果。引用具体数字。"',
    "}",
    "",
    "## 注意事项",
    "- 返回纯 JSON，不要 markdown 代码块",
    "- insight 要有判断性，不要中性描述",
    "- review 语气像教授点评学生作业，直接但不尖锐"
  ].join("\n");

  const teamMessages = [
    { role: "system", content: "你是EMBA课堂点评助手。只输出 JSON。" },
    { role: "user", content: prompt }
  ];
  const raw = await withLlmLogging({
    caller: "teacherDebrief.generateTeamReview",
    teamId,
    memberId: null,
    messages: teamMessages
  }, () => chatCompletion(teamMessages, { temperature: 0.4, max_tokens: 700 }));
  const parsed = extractJsonObject(raw);
  if (!parsed?.insight || !parsed?.review) {
    throw new Error("team review parse failed");
  }
  const payload = {
    team_id: teamId,
    session_id: sid,
    prompt_version: PROMPT_CACHE_VERSION,
    insight: String(parsed.insight).trim(),
    review: String(parsed.review).trim()
  };
  await setCache(sid, 2, type, payload);
  return payload;
}

async function debriefDataApi(query) {
  try {
    const data = await buildDebriefData(query?.session_id || query?.sessionId);
    return makeResponse(200, { ok: true, ...data });
  } catch (e) {
    return makeResponse(500, { ok: false, error: e.message });
  }
}

async function vpIterationsApi(query) {
  try {
    const teamId = String(
      (typeof query?.get === "function" ? query.get("team_id") || query.get("teamId") : query?.team_id || query?.teamId) || ""
    ).trim();
    if (!teamId) return makeResponse(400, { ok: false, error: "team_id required" });
    const sid = typeof query?.get === "function" ? query.get("session_id") || query.get("sessionId") : query?.session_id || query?.sessionId;
    const data = await buildDebriefData(sid);
    const team = (data.teams || []).find((item) => item.id === teamId);
    if (!team) return makeResponse(404, { ok: false, error: "team not found" });
    return makeResponse(200, {
      ok: true,
      team_id: teamId,
      session_id: normalizeSessionId(sid),
      iterations: team.vpTimeline || []
    });
  } catch (e) {
    return makeResponse(500, { ok: false, error: e.message });
  }
}

async function generateDebriefApi(body) {
  try {
    const round = Number(body?.round || 0);
    if (round !== 1 && round !== 2) {
      return makeResponse(400, { ok: false, error: "round must be 1 or 2" });
    }
    const out = await generateGlobalDebrief(round, body?.session_id || body?.sessionId);
    return makeResponse(200, { ok: true, ...out });
  } catch (e) {
    return makeResponse(500, { ok: false, error: e.message });
  }
}

async function generateTeamReviewApi(body) {
  try {
    const teamId = String(body?.team_id || body?.teamId || "").trim();
    if (!teamId) return makeResponse(400, { ok: false, error: "team_id required" });
    const out = await generateTeamReview(teamId, body?.session_id || body?.sessionId);
    return makeResponse(200, { ok: true, ...out });
  } catch (e) {
    return makeResponse(500, { ok: false, error: e.message });
  }
}

async function generateLovotApi(body) {
  try {
    const teamId = String(body?.team_id || body?.teamId || "").trim();
    if (!teamId) return makeResponse(400, { ok: false, error: "team_id required" });
    const out = await generateLovotForTeam(teamId);
    return makeResponse(200, out);
  } catch (e) {
    const status = Number(e?.status || 0);
    return makeResponse(status >= 400 && status < 500 ? status : 500, { ok: false, error: e.message });
  }
}

async function generateLovotBatchApi() {
  try {
    await ensureSchema();
    const teamRows = await runSql(`
      SELECT id
      FROM teams
      WHERE status IN ('frozen', 'phase4')
        AND COALESCE(lovot_image, '') = ''
      ORDER BY created_at ASC, team_name ASC;
    `);

    const results = [];
    for (const row of teamRows) {
      try {
        await generateLovotForTeam(row.id);
        results.push({ team_id: row.id, ok: true });
      } catch (e) {
        results.push({ team_id: row.id, ok: false, error: e.message || String(e) });
      }
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }

    return makeResponse(200, {
      ok: true,
      total: teamRows.length,
      results
    });
  } catch (e) {
    return makeResponse(500, { ok: false, error: e.message });
  }
}

async function exportCsv(sessionId) {
  const sid = normalizeSessionId(sessionId);
  const data = await buildDebriefData(sid);
  return {
    filename: `teacher-debrief-${sid}.csv`,
    csv: generateCsv(data.teams),
    session_id: sid
  };
}

async function exportPptApi() {
  return makeResponse(501, { ok: false, error: "PPT 导出尚未实现" });
}

async function exportPdfApi() {
  return makeResponse(501, { ok: false, error: "PDF 导出尚未实现" });
}

module.exports = {
  ensureSchema,
  verifyTeacherAuth,
  debriefDataApi,
  vpIterationsApi,
  generateDebriefApi,
  generateTeamReviewApi,
  generateLovotApi,
  generateLovotBatchApi,
  getLovotImageApi,
  exportCsv,
  exportPptApi,
  exportPdfApi,
  __test: {
    formatGridLabel,
    formatArchitectureLabel,
    generateCsv,
    computeCsvMetrics
  }
};
