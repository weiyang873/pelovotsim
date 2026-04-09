const path = require("node:path");
const { runSql, sqlQuote } = require("../db/pgSql");

const Engine = require("../../engine");
const { chat, synthesizeVP } = require("../llm/vpCoach");
const { extractVpFields } = require("../llm/vpEmbeddingScorer");
const { scoreVp } = require("../llm/vpScorer");
const { scoreVpByWord, generateVpFeedback } = require("../llm/vpWordScorer");
const { chatCompletion } = require("../llm/deepseekClient");
const { withLlmLogging } = require("../llm/llm_logger");
const { computeWTPParams, compressWtpMult, GRID_PARAMS, PERCENTILES, SHAPE_PARAMS, GLOBAL_PARAMS } = require("../llm/rdCalculator");
const {
  createVpSession,
  appendMessage,
  getSession,
  updateSession,
  getTeamSessions
} = require("../llm/sessions");
const { settleAllJinang } = require("../multiplayer/jinangSettler");
const { getMemberJinang, loadJinangConfig } = require("../multiplayer/jinangDealer");
const { scheduleStages } = require("../multiplayer/computationLog");
const { appendIteration: appendVpIteration } = require("../multiplayer/vpIterationStore");
const {
  getTeam,
  updateTeamStatus,
  createTeam: createTeamRow,
  joinTeam: joinTeamRow,
  setTeamLeader
} = require("../multiplayer/teamManager");
const { getTeamRound2State } = require("../multiplayer/round2State");

const ROOT = path.join(__dirname, "..", "..");
const CONFIG_DIR = path.join(ROOT, "game_config_v0.1");

let cachedEngineConfig = null;
const VP_FEEDBACK_VERSION = 2;

function makeResponse(status, body) {
  return { status, body };
}

function readRequesterMemberId(body = {}, fallback = "") {
  return String(
    body?.memberId ||
    body?.member_id ||
    body?.requester_member_id ||
    fallback ||
    ""
  ).trim();
}

function parseJsonColumnValue(value) {
  if (value == null || value === "") return null;
  if (typeof value === "object") return value;
  try {
    return JSON.parse(String(value));
  } catch (_) {
    return null;
  }
}

function buildLeaderMeta(team, requesterMemberId = "") {
  const leaderMemberId = String(team?.leader_member_id || "").trim();
  const leaderName = String(team?.leader_name || "").trim();
  const memberId = String(requesterMemberId || "").trim();
  return {
    leader_member_id: leaderMemberId || null,
    leader_name: leaderName || "",
    is_leader: Boolean(memberId && leaderMemberId && memberId === leaderMemberId)
  };
}

function makeOnlyLeaderResponse(team, requesterMemberId = "") {
  return makeResponse(403, {
    ok: false,
    error: "only_leader",
    ...buildLeaderMeta(team, requesterMemberId)
  });
}

function getEngineConfig() {
  if (!cachedEngineConfig) {
    cachedEngineConfig = Engine.loadConfig(CONFIG_DIR);
  }
  return cachedEngineConfig;
}

function clipScore(v, lo, hi) {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return Math.max(lo, Math.min(hi, Math.round(n * 10) / 10));
}

function roundToTenth(value, fallback = 0) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.round(n * 10) / 10;
}

function clamp01(value) {
  return Math.max(0, Math.min(1, Number(value || 0)));
}

function mean(values) {
  const list = (Array.isArray(values) ? values : []).filter((item) => Number.isFinite(item));
  if (!list.length) return 0;
  return list.reduce((sum, item) => sum + item, 0) / list.length;
}

function roundForLog(value, digits = 6) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Number(n.toFixed(digits));
}

function buildComputationContext({ teamId, sessionId, memberId, source = "web" }) {
  const team_id = String(teamId || "").trim();
  const session_id = String(sessionId || "").trim();
  if (!team_id || !session_id) return null;
  const member_id = String(memberId || "").trim();
  return {
    team_id,
    session_id,
    member_id: member_id || null,
    source
  };
}

function lambdaMap(score) {
  const clamped = clipScore(score, 1, 5) ?? 3;
  return Number((0.60 + clamped * 0.10).toFixed(2));
}

function rhoDiscount(score) {
  const clamped = clipScore(score, 1, 5) ?? 3;
  return Number((0.75 + clamped * 0.05).toFixed(2));
}

function computeVpCompositeScore(C, G, EScore) {
  const c = clipScore(C, 1, 5) ?? 3;
  const g = clipScore(G, 1, 5) ?? 3;
  const e = clipScore(EScore, 1, 5) ?? 3;
  const avgGE = (g + e) / 2;
  return Math.min(5, Math.round(Math.sqrt(c * avgGE) * 10) / 10);
}

function toCompressedPercent(multiplier) {
  return Math.round((compressWtpMult(Number(multiplier || 1)) - 1) * 100);
}

function toCompressedDeltaPercent(fromMultiplier, toMultiplier) {
  const from = compressWtpMult(Number(fromMultiplier || 1));
  const to = compressWtpMult(Number(toMultiplier || 1));
  return Math.round((to - from) * 100);
}

function toRawBonusPercent(bonus) {
  return Math.round(Number(bonus || 0) * 100);
}

async function resolveIterationSpeaker(teamId, memberId) {
  const mid = String(memberId || "").trim();
  if (!mid) return { memberId: null, speakerName: "", speakerPersona: "" };
  try {
    const member = await assertMemberInTeam(teamId, mid);
    return {
      memberId: mid,
      speakerName: String(member?.member_name || "").trim(),
      speakerPersona: ""
    };
  } catch (_) {
    return { memberId: null, speakerName: "", speakerPersona: "" };
  }
}

function normalizeIterationScores(scores) {
  const src = scores && typeof scores === "object" ? scores : {};
  const c = clipScore(src.coverage ?? src.C ?? src.raw_C, 1, 5);
  const g = clipScore(src.generalizability ?? src.G ?? src.raw_G, 1, 5);
  const e = clipScore(src.effectiveness ?? src.E ?? src.raw_E ?? src.Eadj, 1, 5);
  const composite = src.VPscore != null
    ? clipScore(src.VPscore, 1, 5)
    : (c != null && g != null && e != null ? computeVpCompositeScore(c, g, e) : null);
  return {
    C: c,
    G: g,
    E: e,
    VPscore: composite
  };
}

async function recordVpIteration(entry) {
  const teamId = String(entry?.teamId || "").trim();
  const vpAfter = String(entry?.vpAfter || "").trim();
  if (!teamId || !vpAfter) return null;
  const speaker = await resolveIterationSpeaker(teamId, entry?.memberId);
  const normalized = normalizeIterationScores(entry?.scores || {});
  return appendVpIteration({
    teamId,
    sessionId: entry?.sessionId,
    memberId: speaker.memberId,
    trigger: entry?.trigger,
    speakerName: entry?.speakerName || speaker.speakerName,
    speakerPersona: entry?.speakerPersona || speaker.speakerPersona,
    vpBefore: entry?.vpBefore,
    vpAfter,
    scoreBefore: entry?.scoreBefore,
    scoreAfter: normalized.VPscore,
    scoreC: normalized.C,
    scoreG: normalized.G,
    scoreE: normalized.E,
    sourceIteration: entry?.sourceIteration,
    usedBestIteration: entry?.usedBestIteration === true
  }).catch(() => null);
}

function buildPersistedVpScores(C, G, EScore) {
  const c = clipScore(C, 1, 5);
  const g = clipScore(G, 1, 5);
  const e = clipScore(EScore, 1, 5);
  return {
    C: c,
    G: g,
    E: e,
    VPscore: computeVpCompositeScore(c, g, e)
  };
}

function computeJinangWtpBonus(matchStrength) {
  return Number((clamp01(matchStrength) * 0.05).toFixed(4));
}

function roundJinangBonus(value) {
  return Number(Number(value || 0).toFixed(4));
}

function normalizeMarketJinangEffect(input) {
  if (input && typeof input === "object" && !Array.isArray(input)) {
    return {
      topMatchStrength: clamp01(input.topMatchStrength),
      totalBonus: roundJinangBonus(Math.max(0, Number(input.totalBonus || 0)))
    };
  }
  const topMatchStrength = clamp01(input);
  return {
    topMatchStrength,
    totalBonus: computeJinangWtpBonus(topMatchStrength)
  };
}

function parseSettlementEffect(item) {
  try {
    return item?.effect_applied && typeof item.effect_applied === "object"
      ? item.effect_applied
      : JSON.parse(item?.effect_applied || "{}");
  } catch (_) {
    return {};
  }
}

function summarizeEligibleMarketSettlements(settlements) {
  const list = Array.isArray(settlements) ? settlements : [];
  const items = list
    .filter((item) => item && item.jinang_type === "market" && item.matched)
    .map((item) => {
      const effect = parseSettlementEffect(item);
      if (!effect.E_boost_eligible) return null;
      const matchStrength = clamp01(effect.match_strength ?? item.match_strength ?? 0);
      const bonus = roundJinangBonus(
        Number.isFinite(Number(effect.bonus))
          ? Number(effect.bonus)
          : computeJinangWtpBonus(matchStrength)
      );
      return {
        ...item,
        match_strength: matchStrength,
        bonus
      };
    })
    .filter(Boolean)
    .sort((a, b) => Number(b.match_strength || 0) - Number(a.match_strength || 0));

  return {
    items,
    topItem: items[0] || null,
    topMatchStrength: items[0] ? Number(items[0].match_strength || 0) : 0,
    totalBonus: roundJinangBonus(items.reduce((sum, item) => sum + Number(item.bonus || 0), 0))
  };
}

function scoreMarketCardPreview(card, decision) {
  const weights = card?.affinity_weights || {};
  const dims = [];

  const customerScore = Number(weights.customer_type?.[decision.customerType]);
  if (Number.isFinite(customerScore)) dims.push(customerScore);

  const strategyScore = Number(weights.strategy?.[decision.strategy]);
  if (Number.isFinite(strategyScore)) dims.push(strategyScore);

  const ageScore = Number(weights.age?.[decision.ageGroup]);
  if (Number.isFinite(ageScore)) dims.push(ageScore);

  return clamp01(mean(dims));
}

async function getPreviewMarketJinang(teamId, gridId, architecture) {
  const team = await getTeam(teamId);
  if (!team) throw new Error("team not found");

  const parsed = parseGridId(gridId);
  const decision = {
    customerType: parsed.customerType,
    strategy: parsed.strategy,
    ageGroup: parsed.ageGroup,
    architecture: normalizeArchitecture(architecture)
  };
  const cfg = loadJinangConfig();
  const marketMap = Object.fromEntries((cfg.market || []).map((card) => [card.id, card]));
  const members = Array.isArray(team.members) ? team.members : [];

  const matchedItems = members.map((member) => {
    const card = marketMap[member.jinang_market_id];
    if (!card) return null;
    const matchStrength = roundToTenth(scoreMarketCardPreview(card, decision), 0);
    const matched = matchStrength >= 0.5;
    return matched ? {
      id: card.id,
      name: card.name,
      member_id: member.id,
      member_name: member.member_name,
      match_strength: matchStrength,
      matched,
      bonus: computeJinangWtpBonus(matchStrength)
    } : null;
  })
    .filter(Boolean)
    .sort((a, b) => Number(b.match_strength || 0) - Number(a.match_strength || 0));

  return {
    items: matchedItems,
    top: matchedItems[0] || null,
    topMatchStrength: matchedItems[0] ? Number(matchedItems[0].match_strength || 0) : 0,
    totalBonus: roundJinangBonus(matchedItems.reduce((sum, item) => sum + Number(item.bonus || 0), 0))
  };
}

function buildRound1Outcome(gridId, architecture, rawScores, marketMatchStrength, options = {}) {
  const base = Engine.computeRound1V2(gridId, architecture, rawScores, 0);
  const C = clipScore(rawScores?.C ?? base?.C, 1, 5) ?? 3;
  const G = clipScore(rawScores?.G ?? base?.G, 1, 5) ?? 3;
  const ERaw = clipScore(rawScores?.E ?? base?.E_raw, 1, 5) ?? 3;
  const Eadj = ERaw;
  const marketJinang = normalizeMarketJinangEffect(marketMatchStrength);
  const jinangMatchStrength = marketJinang.topMatchStrength;
  const lambdaG = lambdaMap(G);
  const lambdaE = lambdaMap(ERaw);
  const rhoC = rhoDiscount(C);
  const vpEffect = Number((lambdaG * lambdaE * rhoC).toFixed(4));
  const jinangWtpBonus = marketJinang.totalBonus;
  const wtpMultiplier = Number((vpEffect * (1 + jinangWtpBonus)).toFixed(4));
  const compressedMult = compressWtpMult(wtpMultiplier);
  const WTPref = Math.round(Number(base?.WTPref || 0));
  const WTPadjRaw = Math.round(WTPref * wtpMultiplier);
  const WTPadj = Math.round(WTPref * compressedMult);
  const VPscore = computeVpCompositeScore(C, G, ERaw);
  const computationContext = buildComputationContext(options);
  if (computationContext) {
    const wtpParams = computeWTPParams(gridId);
    const gridCfg = GRID_PARAMS[`${wtpParams.channel}_${wtpParams.age}`] || {};
    const marketSize = wtpParams.strategy === "DIFF"
      ? Number(gridCfg.N_DIFF || 0) / 10000
      : Number(gridCfg.N_COST || 0) / 10000;
    const shapeValue = wtpParams.strategy === "DIFF"
      ? Number(SHAPE_PARAMS.cv[wtpParams.age] || 0)
      : Number(SHAPE_PARAMS.sigma_log[wtpParams.age] || 0);
    scheduleStages(computationContext, [
      {
        stage: "r1_wtp_params",
        params: {
          gridId,
          channel: wtpParams.channel,
          strategy: wtpParams.strategy,
          age: wtpParams.age,
          Panchor: Number(GLOBAL_PARAMS.Panchor || 0),
          ps: roundForLog(PERCENTILES[wtpParams.age] || 0),
          "cv/sigma_log": roundForLog(shapeValue),
          WTPmean: roundForLog(wtpParams.WTPmean),
          WTPmedian: roundForLog(wtpParams.WTPmedian),
          WTPref: roundForLog(wtpParams.WTPref),
          gamma: roundForLog(wtpParams.gamma)
        }
      },
      {
        stage: "r1_sam",
        params: {
          gridId,
          N: marketSize,
          Aw: roundForLog(gridCfg.Aw || 0),
          WTPmean: roundForLog(wtpParams.WTPmean),
          SAM_billion: Number(base?.SAM_billion || 0)
        }
      },
      {
        stage: "r1_vp_score",
        params: {
          vp_text: String(options.vpText || "").trim(),
          raw_C: Number(C || 0),
          raw_G: Number(G || 0),
          raw_E: Number(ERaw || 0),
          jinang_market_match: roundForLog(jinangMatchStrength),
          jinang_tech_match: roundForLog(options.jinangTechMatch || 0),
          delta: roundForLog(Eadj - ERaw),
          Eadj: Number(Eadj || 0),
          lambda_G: roundForLog(lambdaG),
          lambda_Eadj: roundForLog(lambdaE),
          wtp_mult_raw: roundForLog(wtpMultiplier)
        }
      },
      {
        stage: "r1_wtp_adj",
        params: {
          WTPref: Number(WTPref || 0),
          lambda_G: roundForLog(lambdaG),
          lambda_Eadj: roundForLog(lambdaE),
          wtp_mult_raw: roundForLog(wtpMultiplier),
          wtp_mult_compressed: roundForLog(compressedMult),
          WTPref_adjusted: Number(WTPadj || 0)
        }
      }
    ]);
  }

  return {
    ...base,
    C,
    G,
    E_raw: ERaw,
    Eadj,
    VPscore,
    WTPref,
    WTPadj,
    WTPadj_raw: WTPadjRaw,
    rho_C: rhoC,
    lambda_G: lambdaG,
    lambda_E: lambdaE,
    wtp_vp_effect: vpEffect,
    jinang_wtp_bonus: jinangWtpBonus,
    wtp_multiplier: wtpMultiplier,
    wtp_mult_compressed: compressedMult,
    jinang_match_strength: jinangMatchStrength,
    jinang_E_boost: 0
  };
}

function normalizeVpScoresInput(scores) {
  if (!scores || typeof scores !== "object") return null;
  const coverage = clipScore(scores.coverage ?? scores.C, 1, 5);
  const generalizability = clipScore(scores.generalizability ?? scores.G, 1, 5);
  const effectiveness = clipScore(scores.effectiveness ?? scores.E, 1, 5);
  if (coverage == null || generalizability == null || effectiveness == null) return null;
  return { coverage, generalizability, effectiveness };
}

function scheduleFinalRound1Stages(context, outcome, options = {}) {
  const computationContext = buildComputationContext(context);
  if (!computationContext || !outcome) return 0;
  const sourceIteration = String(options.source_iteration || "confirm_submit").trim() || "confirm_submit";
  const usedBestIteration = options.used_best_iteration === true;
  const vpText = String(options.vp_text || "").trim();
  return scheduleStages(computationContext, [
    {
      stage: "r1_vp_score_final",
      params: {
        is_final: true,
        source_iteration: sourceIteration,
        used_best_iteration: usedBestIteration,
        raw_C: Number(outcome.C || 0),
        raw_G: Number(outcome.G || 0),
        raw_E: Number(outcome.E_raw || 0),
        Eadj: Number(outcome.Eadj || 0),
        lambda_G: roundForLog(outcome.lambda_G),
        lambda_Eadj: roundForLog(outcome.lambda_E),
        wtp_mult_raw: roundForLog(outcome.wtp_multiplier),
        wtp_mult_compressed: roundForLog(outcome.wtp_mult_compressed),
        WTPref: Number(outcome.WTPref || 0),
        WTPref_adjusted: Number(outcome.WTPadj || 0),
        vp_text: vpText
      }
    },
    {
      stage: "r1_wtp_adj_final",
      params: {
        is_final: true,
        WTPref: Number(outcome.WTPref || 0),
        wtp_mult_raw: roundForLog(outcome.wtp_multiplier),
        wtp_mult_compressed: roundForLog(outcome.wtp_mult_compressed),
        WTPref_adjusted: Number(outcome.WTPadj || 0)
      }
    }
  ]);
}

function hasAnyScore(scores) {
  if (!scores || typeof scores !== "object") return false;
  return ["C", "G", "E"].some((key) => clipScore(scores[key], 1, 5) != null);
}

function isClearlyBrokenScoreSet(scores) {
  if (!scores || typeof scores !== "object") return true;
  const values = ["C", "G", "E"].map((key) => clipScore(scores[key], 1, 5));
  if (values.every((v) => v == null)) return true;
  return values.every((v) => v != null && v <= 1.0);
}

async function getRecoveredVpScores(teamId) {
  const sessions = await getTeamSessions(teamId);
  const list = Array.isArray(sessions) ? sessions.slice().reverse() : [];
  for (const session of list) {
    const recovered = vpResultToApiScores(session?.pmfScore || null);
    if (!recovered) continue;
    return {
      C: clipScore(recovered.coverage, 1, 5),
      G: clipScore(recovered.generalizability, 1, 5),
      E: clipScore(recovered.effectiveness, 1, 5)
    };
  }
  return null;
}

function getLatestPhase3Session(sessions) {
  const list = Array.isArray(sessions) ? sessions : [];
  return list
    .filter((s) => s && s.sessionId)
    .sort((a, b) => String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")))[0] || null;
}

function shouldHideRestoredUserMessage(text) {
  const src = String(text || "").trim();
  if (!src) return true;
  if (/^你是 EMBA 课程中的 AI 产品教练/.test(src)) return true;
  if (/^请基于我们目前的讨论内容给出本轮评分/.test(src)) return true;
  if (/^请基于我们目前的讨论，继续以教练方式指出这一版最需要补强的一点/.test(src)) return true;
  if (/^我们决定确认提交最终版价值主张/.test(src)) return true;
  return false;
}

function inferCoachMessageType(text) {
  const src = String(text || "");
  if (/<vp_result>/i.test(src) || /确认提交|最终结果/.test(src)) return "confirm";
  if (/\d\.\d\/5\.0/.test(src)) return "score";
  return "chat";
}

function restoreCoachHistory(messages) {
  const list = Array.isArray(messages) ? messages : [];
  return list
    .filter((m) => m && m.role && (! (m.role === "user" && shouldHideRestoredUserMessage(m.content))))
    .map((m, idx) => ({
      type: m.role === "assistant" ? inferCoachMessageType(m.content) : "chat",
      role: m.role === "assistant" ? "coach" : "user",
      text: String(m.content || ""),
      ts: m.timestamp || `${idx}`
    }));
}

function parseGridId(gridId) {
  const raw = String(gridId || "").trim();
  if (!raw) throw new Error("grid_id is required");
  const parts = raw.split("_");
  if (parts.length < 3) {
    throw new Error(`invalid grid_id: ${raw}`);
  }

  const customerRaw = String(parts[0] || "").toLowerCase();
  const strategyRaw = String(parts[1] || "").toLowerCase();
  const ageRaw = String(parts[2] || "").toLowerCase();

  const customerType = customerRaw === "tob" || customerRaw === "b2b" ? "ToB" : "ToC";
  const strategy = strategyRaw.includes("cost") ? "COST" : "DIFF";
  let ageGroup = "ADULT";
  if (ageRaw.includes("child")) ageGroup = "CHILD";
  if (ageRaw.includes("elder")) ageGroup = "ELDER";

  return { customerType, strategy, ageGroup };
}

function normalizeArchitecture(value) {
  const v = String(value || "").trim().toLowerCase();
  if (v === "experience") return "Experience";
  if (v === "hybrid") return "Hybrid";
  if (v === "function") return "Function";
  throw new Error("architecture must be Experience / Hybrid / Function");
}

function normalizeConfirmedArchitecture(value) {
  const raw = String(value || "").trim();
  if (!raw) return null;
  const low = raw.toLowerCase();
  if (low === "experience" || low.includes("体验")) return "Experience";
  if (low === "hybrid" || low.includes("混合")) return "Hybrid";
  if (low === "function" || low.includes("功能")) return "Function";
  return null;
}

function computePersonalGmMax({ gridId, architecture }) {
  const arch = normalizeArchitecture(architecture);
  const result = Engine.computeRound1(
    {
      round1: {
        cell_id: gridId,
        arch_tag: arch,
        vp_scores: { C: 3, G: 3, E: 3 },
        jinang_market_match_strength: 0
      }
    },
    getEngineConfig()
  );
  return {
    gmMax: Number(result.WTPadj || result.WTPref || 0),
    channelPrefNormalized: null
  };
}

async function readSubmission(teamId, memberId) {
  const rows = await runSql(`
    SELECT id, member_id, team_id, grid_id, architecture, channel_pref, vp_draft, personal_gm_max, submitted_at
    FROM member_submissions
    WHERE team_id = ${sqlQuote(teamId)} AND member_id = ${sqlQuote(memberId)}
    LIMIT 1;
  `);
  return rows[0] || null;
}


async function countTeamSubmissions(teamId) {
  const rows = await runSql(`
    SELECT COUNT(*) AS c
    FROM member_submissions
    WHERE team_id = ${sqlQuote(teamId)};
  `);
  return Number(rows[0]?.c || 0);
}

async function assertMemberInTeam(teamId, memberId) {
  const rows = await runSql(`
    SELECT id, team_id, member_name, member_index, jinang_market_id, jinang_tech_id, joined_at
    FROM team_members
    WHERE id = ${sqlQuote(memberId)} AND team_id = ${sqlQuote(teamId)}
    LIMIT 1;
  `);
  if (!rows[0]) throw new Error("member not found in team");
  return rows[0];
}

async function getFirstRound1Submitter(teamId) {
  const rows = await runSql(`
    SELECT member_id
    FROM member_submissions
    WHERE team_id = ${sqlQuote(teamId)}
    ORDER BY submitted_at ASC, id ASC
    LIMIT 1;
  `);
  return String(rows[0]?.member_id || "").trim() || null;
}

async function assignRound1LeaderIfNeeded(teamId) {
  const team = await getTeam(teamId);
  if (!team) return null;
  if (String(team.leader_member_id || "").trim()) return team;
  const firstSubmitterId = await getFirstRound1Submitter(teamId);
  if (!firstSubmitterId) return team;
  return setTeamLeader(teamId, firstSubmitterId);
}

async function ensureLeaderPermission(teamId, memberId) {
  const team = await getTeam(teamId);
  if (!team) return { ok: false, response: makeResponse(404, { ok: false, error: "team not found" }) };
  const requesterId = String(memberId || "").trim();
  if (!requesterId) {
    return { ok: false, response: makeOnlyLeaderResponse(team, requesterId) };
  }
  await assertMemberInTeam(teamId, requesterId);
  const teamWithLeader = String(team.leader_member_id || "").trim()
    ? team
    : await assignRound1LeaderIfNeeded(teamId);
  const leaderMeta = buildLeaderMeta(teamWithLeader, requesterId);
  if (!leaderMeta.is_leader) {
    return { ok: false, response: makeOnlyLeaderResponse(teamWithLeader, requesterId) };
  }
  return { ok: true, team: teamWithLeader, leaderMeta };
}

async function readRound1TeamDraft(teamId) {
  const rows = await runSql(`
    SELECT team_id, grid_id, architecture, vp_text, updated_by, updated_at
    FROM round1_team_drafts
    WHERE team_id = ${sqlQuote(teamId)}
    LIMIT 1;
  `);
  const row = rows[0];
  if (!row) return null;
  return {
    team_id: row.team_id,
    grid_id: row.grid_id || "",
    architecture: row.architecture || "",
    vp_text: row.vp_text || "",
    updated_by: row.updated_by || "",
    updated_at: row.updated_at || null
  };
}

async function saveRound1TeamDraft(teamId, memberId, patch = {}) {
  const existing = await readRound1TeamDraft(teamId);
  const next = {
    grid_id: String(patch.grid_id ?? existing?.grid_id ?? "").trim(),
    architecture: String(patch.architecture ?? existing?.architecture ?? "").trim(),
    vp_text: String(patch.vp_text ?? existing?.vp_text ?? "").trim(),
    updated_by: String(memberId || "").trim(),
    updated_at: new Date().toISOString()
  };

  await runSql(`
    INSERT INTO round1_team_drafts (
      team_id, grid_id, architecture, vp_text, updated_by, updated_at
    ) VALUES (
      ${sqlQuote(teamId)},
      ${sqlQuote(next.grid_id || null)},
      ${sqlQuote(next.architecture || null)},
      ${sqlQuote(next.vp_text || null)},
      ${sqlQuote(next.updated_by || null)},
      ${sqlQuote(next.updated_at)}
    )
    ON CONFLICT (team_id) DO UPDATE SET
      grid_id = EXCLUDED.grid_id,
      architecture = EXCLUDED.architecture,
      vp_text = EXCLUDED.vp_text,
      updated_by = EXCLUDED.updated_by,
      updated_at = EXCLUDED.updated_at;
  `);

  return readRound1TeamDraft(teamId);
}


async function submitPhase1(teamId, memberId, body) {
  try {
    const team = await getTeam(teamId);
    if (!team) return makeResponse(404, { ok: false, error: "team not found" });
    await assertMemberInTeam(teamId, memberId);
    if (await readSubmission(teamId, memberId)) {
      return makeResponse(400, { ok: false, error: "already submitted" });
    }

    const payload = body || {};
    const gridId = String(payload.grid_id || "").trim();
    const architecture = String(payload.architecture || "").trim();
    const outline = String(payload.vp_outline || "").trim();
    const who = String(payload.who || outline || "").trim();
    const pain = String(payload.pain || outline || "").trim();
    const how = String(payload.how || outline || "").trim();
    const vpDraft = `WHO: ${who}\nPAIN: ${pain}\nHOW: ${how}`.trim();
    if (!gridId) return makeResponse(400, { ok: false, error: "grid_id required" });
    if (!architecture) return makeResponse(400, { ok: false, error: "architecture required" });
    if (!who || !pain || !how) return makeResponse(400, { ok: false, error: "who, pain, how required" });

    const calc = computePersonalGmMax({
      gridId,
      architecture
    });

    const id = cryptoRandomId();
    const now = new Date().toISOString();
    await runSql(`
      INSERT INTO member_submissions (
        id, member_id, team_id, grid_id, architecture, channel_pref, vp_draft, personal_gm_max, submitted_at
      ) VALUES (
        ${sqlQuote(id)},
        ${sqlQuote(memberId)},
        ${sqlQuote(teamId)},
        ${sqlQuote(gridId)},
        ${sqlQuote(normalizeArchitecture(architecture))},
        NULL,
        ${sqlQuote(vpDraft)},
        ${Number(calc.gmMax)},
        ${sqlQuote(now)}
      );
    `);

    const submittedCount = await countTeamSubmissions(teamId);
    const teamSize = Number(team.team_size || 0);
    let statusUpdated = false;
    if (submittedCount >= teamSize && team.status !== "phase2") {
      await updateTeamStatus(teamId, "phase2");
      await assignRound1LeaderIfNeeded(teamId);
      statusUpdated = true;
    }

    const updatedTeam = statusUpdated ? await getTeam(teamId) : team;

    return makeResponse(200, {
      ok: true,
      submission_id: id,
      personal_gm_max: Number(calc.gmMax),
      submitted_count: submittedCount,
      team_size: teamSize,
      team_status_updated_to_phase2: statusUpdated,
      ...buildLeaderMeta(updatedTeam, memberId)
    });
  } catch (e) {
    return makeResponse(400, { ok: false, error: e.message });
  }
}

function cryptoRandomId() {
  return `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function scoreToFiveDecimal(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  // Legacy 0-1 scores should only be upscaled when they are strictly below 1.
  // Current scoring pipeline already uses 1.0-5.0, so 1.0 must stay 1.0.
  if (n > 0 && n < 1) return Math.max(1.0, Math.min(5.0, Math.round(n * 5 * 10) / 10));
  return Math.max(1.0, Math.min(5.0, Math.round(n * 10) / 10));
}

function vpResultToApiScores(vpResult) {
  if (!vpResult || typeof vpResult !== "object") return null;
  const scores = vpResult.scores;
  if (!scores || typeof scores !== "object") return null;
  const read = (x) => {
    if (x && typeof x === "object") return scoreToFiveDecimal(x.score);
    return scoreToFiveDecimal(x);
  };
  const coverage = read(scores.C);
  const generalizability = read(scores.G);
  const effectiveness = read(scores.E);
  if (!coverage || !generalizability || !effectiveness) return null;
  return { coverage, generalizability, effectiveness };
}

function readPreviewScoresFromSession(pmfScore) {
  const preview = pmfScore?.preview_scores;
  if (!preview || typeof preview !== "object") return null;
  const scores = {
    coverage: clipScore(preview.coverage, 1, 5),
    generalizability: clipScore(preview.generalizability, 1, 5),
    effectiveness: clipScore(preview.effectiveness, 1, 5)
  };
  return areApiScoresEmpty(scores) ? null : scores;
}

function areApiScoresEmpty(scores) {
  if (!scores || typeof scores !== "object") return true;
  return ["coverage", "generalizability", "effectiveness"].every((key) => scores[key] == null);
}

function pickLatestLabeledValue(parts, label) {
  const list = Array.isArray(parts) ? parts : [];
  for (let i = list.length - 1; i >= 0; i -= 1) {
    const value = extractTextValue(list[i], label);
    if (value) return value;
  }
  return "";
}

function buildFallbackVpResult({ sessionMessages, replyText, userMessage, scores }) {
  const parts = [];
  const list = Array.isArray(sessionMessages) ? sessionMessages : [];
  list.forEach((m) => {
    parts.push(String(m?.content || ""));
  });
  parts.push(String(replyText || ""));
  parts.push(String(userMessage || ""));

  const who = pickLatestLabeledValue(parts, "WHO") || "未提取到明确目标人群";
  const pain = pickLatestLabeledValue(parts, "PAIN") || "未提取到明确痛点场景";
  const how = pickLatestLabeledValue(parts, "HOW") || "未提取到明确解决机制";
  const normalizedScores = {
    coverage: clipScore(scores?.coverage, 1, 5),
    generalizability: clipScore(scores?.generalizability, 1, 5),
    effectiveness: clipScore(scores?.effectiveness, 1, 5)
  };

  return {
    target_customer: who,
    scenario_pain: pain,
    value_creation: how,
    boundary: pickLatestLabeledValue(parts, "BOUNDARY") || "未明确",
    scores: {
      C: { score: normalizedScores.coverage, feedback: "" },
      G: { score: normalizedScores.generalizability, feedback: "" },
      E: { score: normalizedScores.effectiveness, feedback: "" }
    }
  };
}

function buildMemberLinks(teamId, members) {
  const arr = Array.isArray(members) ? members : [];
  return arr.map((m) => ({
    member_id: m.id,
    member_name: m.member_name,
    member_index: m.member_index,
    flow_url: `/multiplayer?teamId=${encodeURIComponent(teamId)}&memberId=${encodeURIComponent(m.id)}`
  }));
}

async function getOrCreatePhase3Session(teamId) {
  const all = await getTeamSessions(teamId) || [];
  const existing = all
    .filter((s) => s && s.status !== "submitted")
    .sort((a, b) => String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")))[0];
  if (existing?.sessionId) return existing.sessionId;
  return createVpSession(teamId, {});
}

async function getLatestPhase3SessionRecord(teamId) {
  const all = await getTeamSessions(teamId) || [];
  return all
    .filter((s) => s && s.sessionId)
    .sort((a, b) => String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")))[0] || null;
}

async function buildPhase3JinangContext(teamId) {
  const team = await getTeam(teamId);
  const members = Array.isArray(team?.members) ? team.members : [];
  const market = [];
  const tech = [];
  for (const member of members) {
    try {
      const jinang = await getMemberJinang(member.id);
      if (jinang?.market?.name || jinang?.market?.id) {
        market.push(jinang.market.name || jinang.market.id);
      }
      if (jinang?.tech?.name || jinang?.tech?.id) {
        tech.push(jinang.tech.name || jinang.tech.id);
      }
    } catch (_) {
      // ignore missing jinang and keep best-effort prompt context
    }
  }
  return { market, tech };
}

function toArchLabel(arch) {
  if (arch === "Experience") return "体验";
  if (arch === "Function") return "功能";
  if (arch === "Hybrid") return "混合";
  return arch || "未知";
}

function toArchitecturePromptLabel(arch) {
  if (arch === "Experience") return "体验型";
  if (arch === "Function") return "功能型";
  if (arch === "Hybrid") return "混合型";
  return arch || "未提供";
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
  const coverage = clipScore(scores.C, 1, 5);
  const generalizability = clipScore(scores.G, 1, 5);
  const effectiveness = clipScore(scores.E, 1, 5);
  if (coverage == null || generalizability == null || effectiveness == null) return null;
  return { coverage, generalizability, effectiveness };
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

function normalizeVpSummaryPayload(summary, options = {}) {
  const src = summary && typeof summary === "object" ? summary : {};
  const fallbackText = String(options.fallbackText || "").trim();
  const confirmedFields = options.confirmedFields && typeof options.confirmedFields === "object"
    ? normalizeConfirmedFieldsPayload(options.confirmedFields)
    : null;
  return {
    who: String(
      src.who ||
      src.target_customer ||
      confirmedFields?.who_raw ||
      extractTextValue(fallbackText, "WHO") ||
      extractTextValue(fallbackText, "目标客户") ||
      ""
    ).trim(),
    pain: String(
      src.pain ||
      src.scenario_pain ||
      confirmedFields?.pain_raw ||
      extractTextValue(fallbackText, "PAIN") ||
      extractTextValue(fallbackText, "场景痛点") ||
      ""
    ).trim(),
    how: String(
      src.how ||
      src.value_creation ||
      confirmedFields?.how_raw ||
      extractTextValue(fallbackText, "HOW") ||
      extractTextValue(fallbackText, "价值创造") ||
      ""
    ).trim(),
    boundary: String(
      src.boundary ||
      confirmedFields?.boundary_raw ||
      extractTextValue(fallbackText, "BOUNDARY") ||
      extractTextValue(fallbackText, "边界条件") ||
      ""
    ).trim(),
    archConsistency: String(src.archConsistency || src.arch_consistency || "").trim(),
    coachComment: String(src.coachComment || src.coach_comment || "").trim(),
    confirmedArchitecture: normalizeConfirmedArchitecture(
      src.confirmedArchitecture ||
      src.confirmed_architecture ||
      ""
    )
  };
}

function normalizeConfirmedFieldValue(value, { emptyAsUndefined = false } = {}) {
  const text = String(value || "").trim();
  if (!text || text === "未明确") {
    return emptyAsUndefined ? "" : "未明确";
  }
  return text;
}

function normalizeConfirmedFieldsPayload(raw) {
  const src = raw && typeof raw === "object" ? raw : {};
  return {
    who_raw: normalizeConfirmedFieldValue(src.who_raw, { emptyAsUndefined: true }),
    pain_raw: normalizeConfirmedFieldValue(src.pain_raw, { emptyAsUndefined: true }),
    how_raw: normalizeConfirmedFieldValue(src.how_raw, { emptyAsUndefined: true }),
    alternative_raw: normalizeConfirmedFieldValue(src.alternative_raw),
    boundary_raw: normalizeConfirmedFieldValue(src.boundary_raw)
  };
}

function vpResultToConfirmedFields(vpResult, vpText = "") {
  const result = vpResult && typeof vpResult === "object" ? vpResult : {};
  const sourceText = String(vpText || "").trim();
  const confirmedFields = normalizeConfirmedFieldsPayload({
    who_raw: result.who_raw || result.target_customer || result.who || extractTextValue(sourceText, "WHO") || extractTextValue(sourceText, "目标客户"),
    pain_raw: result.pain_raw || result.scenario_pain || result.pain || extractTextValue(sourceText, "PAIN") || extractTextValue(sourceText, "场景痛点"),
    how_raw: result.how_raw || result.value_creation || result.how || extractTextValue(sourceText, "HOW") || extractTextValue(sourceText, "价值创造"),
    alternative_raw: result.alternative_raw || result.alternative || "",
    boundary_raw: result.boundary_raw || result.boundary || extractTextValue(sourceText, "BOUNDARY") || extractTextValue(sourceText, "边界条件")
  });
  return Object.values(confirmedFields).some((value) => String(value || "").trim()) ? confirmedFields : null;
}

function buildConfirmedVpResult(confirmedFields, scores = null) {
  const fields = confirmedFields && typeof confirmedFields === "object" ? confirmedFields : {};
  const result = {
    target_customer: String(fields.who_raw || "").trim() || "未提取到明确目标人群",
    scenario_pain: String(fields.pain_raw || "").trim() || "未提取到明确痛点场景",
    value_creation: String(fields.how_raw || "").trim() || "未提取到明确解决机制",
    boundary: String(fields.boundary_raw || "").trim() || "未明确"
  };
  if (scores && typeof scores === "object") {
    result.scores = {
      C: { score: clipScore(scores.C, 1, 5), feedback: "" },
      G: { score: clipScore(scores.G, 1, 5), feedback: "" },
      E: { score: clipScore(scores.E, 1, 5), feedback: "" }
    };
  }
  return result;
}

function extractTextValue(src, key) {
  const text = String(src || "");
  const re = new RegExp(`${key}\\s*[：:]\\s*([^\\n]+)`);
  const m = text.match(re);
  return m ? m[1].trim() : "";
}

async function summarizeVpFromConversation({ gridId, architecture, sessionMessages, payloadConversation, payloadVpResult }) {
  const directVpResult = payloadVpResult && typeof payloadVpResult === "object" ? payloadVpResult : null;
  if (directVpResult) {
    const normalized = normalizeVpSummaryPayload(directVpResult);
    return {
      text: [
        `WHO：${normalized.who || "未提取到明确目标人群"}`,
        `PAIN：${normalized.pain || "未提取到明确痛点场景"}`,
        `HOW：${normalized.how || "未提取到明确解决机制"}`,
        `BOUNDARY：${normalized.boundary || "未明确"}`,
        `架构一致性：${toArchLabel(architecture)}（待确认）`,
        "AI策略顾问点评：已按确认版本写入最终价值主张。"
      ].join("\n"),
      ...normalized,
      archConsistency: `${toArchLabel(architecture)}（待确认）`,
      coachComment: "已按确认版本写入最终价值主张。",
      confirmedArchitecture: null
    };
  }

  const convoLines = [];
  const msgs = Array.isArray(sessionMessages) ? sessionMessages : [];
  msgs.forEach((m) => {
    const role = m.role === "assistant" ? "Coach" : "Team";
    convoLines.push(`[${role}] ${String(m.content || "").trim()}`);
  });
  const payloadLines = Array.isArray(payloadConversation) ? payloadConversation : [];
  payloadLines.forEach((m) => {
    const role = m.role === "coach" ? "Coach" : "Team";
    convoLines.push(`[${role}] ${String(m.text || "").trim()}`);
  });
  const convoText = convoLines.join("\n").trim() || "（暂无有效对话记录）";

  const prompt = `请根据以下小组与 AI 教练的对话记录，提取并输出最终的 Value Proposition 摘要。
请仅输出 JSON（不要输出代码块），字段如下：
{
  "who": "一句话",
  "pain": "一句话",
  "how": "一句话",
  "arch_consistency": "一句话",
  "coach_comment": "一句话",
  "confirmed_architecture": "Experience|Hybrid|Function|null"
}

补充上下文：
- 小组定位格子：${gridId}
- 架构标签：${toArchLabel(architecture)}

架构提取规则：
- 如果对话中 Coach 明确说“明确了是XX型”或同义确认语句，以该架构为准
- 如果学生在对话中改变了架构选择，以最后一次明确表态为准
- 如果对话中从未讨论过架构，返回 null

对话记录：
${convoText}`;

  try {
    const messages = [
      { role: "system", content: "你是 EMBA 课程助教。请严格按给定格式输出，简洁清晰，不要输出多余段落。" },
      { role: "user", content: prompt }
    ];
    const raw = await withLlmLogging({
      caller: "teamRoutes.summarizeVpFromConversation",
      teamId: null,
      memberId: null,
      messages
    }, () => chatCompletion(
      messages,
      { temperature: 0.2, max_tokens: 500 }
    ));
    let parsed = null;
    const jsonMatch = String(raw || "").match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      try {
        parsed = JSON.parse(jsonMatch[0]);
      } catch (_) {
        parsed = null;
      }
    }
    const summaryFields = normalizeVpSummaryPayload({
      who: String(parsed?.who || "").trim() || extractTextValue(raw, "WHO（目标人群）") || extractTextValue(raw, "WHO"),
      pain: String(parsed?.pain || "").trim() || extractTextValue(raw, "PAIN（核心痛点\\+触发情境）") || extractTextValue(raw, "PAIN"),
      how: String(parsed?.how || "").trim() || extractTextValue(raw, "HOW（解决机制）") || extractTextValue(raw, "HOW"),
      archConsistency: String(parsed?.arch_consistency || "").trim() || extractTextValue(raw, "架构一致性"),
      coachComment:
        String(parsed?.coach_comment || "").trim() ||
        extractTextValue(raw, "AI策略顾问点评") ||
        extractTextValue(raw, "Coach 最终评价")
    });
    const confirmedArchitecture = normalizeConfirmedArchitecture(
      parsed?.confirmed_architecture ||
      extractTextValue(raw, "confirmed_architecture") ||
      extractTextValue(raw, "确认架构")
    );
    const summaryText = [
      `WHO：${summaryFields.who || "未提取到明确目标人群"}`,
      `PAIN：${summaryFields.pain || "未提取到明确痛点场景"}`,
      `HOW：${summaryFields.how || "未提取到明确解决机制"}`,
      `架构一致性：${summaryFields.archConsistency || `${toArchLabel(architecture)}（待确认）`}`,
      `AI策略顾问点评：${summaryFields.coachComment || "建议继续补充关键细节后再提交。"}`
    ].join("\n");
    return {
      ...summaryFields,
      text: summaryText,
      confirmedArchitecture
    };
  } catch (_) {
    return {
      text: [
      "WHO：未提取到明确目标人群",
      "PAIN：未提取到明确痛点场景",
      "HOW：未提取到明确解决机制",
      `架构一致性：${toArchLabel(architecture)}（待确认）`,
      "AI策略顾问点评：AI策略顾问暂不可用，建议手动整理 VP 后重试。"
      ].join("\n"),
      who: "",
      pain: "",
      how: "",
      boundary: "",
      archConsistency: `${toArchLabel(architecture)}（待确认）`,
      coachComment: "AI策略顾问暂不可用，建议手动整理 VP 后重试。",
      confirmedArchitecture: null
    };
  }
}

async function createTeamApi(body) {
  try {
    const teamName = String(body?.teamName || "").trim();
    const teamSize = Number(body?.teamSize);
    const team = await createTeamRow(teamName, teamSize);
    const full = await getTeam(team.id);
    return makeResponse(200, {
      ok: true,
      team: full,
      member_links: buildMemberLinks(full.id, full.members),
      flow_url: `/multiplayer?teamId=${encodeURIComponent(full.id)}`
    });
  } catch (e) {
    return makeResponse(400, { ok: false, error: e.message });
  }
}

async function joinTeamApi(body) {
  try {
    const teamId = String(body?.teamId || "").trim();
    const memberName = String(body?.memberName || "").trim();
    const member = await joinTeamRow(teamId, memberName);
    const full = await getTeam(teamId);
    return makeResponse(200, {
      ok: true,
      team: full,
      member,
      flow_url: `/multiplayer?teamId=${encodeURIComponent(teamId)}&memberId=${encodeURIComponent(member.id)}`,
      member_links: buildMemberLinks(teamId, full?.members || [])
    });
  } catch (e) {
    return makeResponse(400, { ok: false, error: e.message });
  }
}

async function getTeamApi(teamId) {
  try {
    const tid = String(teamId || "").trim();
    let team = await getTeam(tid);
    if (!team) return makeResponse(404, { ok: false, error: "team not found" });
    if (!String(team.leader_member_id || "").trim() && ["phase2", "phase3", "phase4", "frozen"].includes(String(team.status || ""))) {
      team = await assignRound1LeaderIfNeeded(tid) || team;
    }
    return makeResponse(200, {
      ok: true,
      team,
      member_links: buildMemberLinks(team.id, team.members)
    });
  } catch (e) {
    return makeResponse(400, { ok: false, error: e.message });
  }
}


function resolvePhase3Strategy(gridId, architecture) {
  const parsed = parseGridId(gridId);
  const normalizedArchitecture = normalizeArchitecture(architecture);
  const cellLabel = `${parsed.customerType}·${parsed.strategy === "DIFF" ? "差异" : "成本"}·${parsed.ageGroup === "CHILD" ? "儿童" : (parsed.ageGroup === "ELDER" ? "老人" : "成人")}`;
  return {
    grid_id: gridId,
    cell_label: cellLabel,
    market: parsed.customerType === "ToC" ? "ToC" : "ToB",
    competitive: parsed.strategy === "DIFF" ? "DIFF" : "COST",
    segment: parsed.ageGroup,
    architecture: normalizedArchitecture,
    architecture_label: normalizedArchitecture
  };
}

function getPhaseByStatus(status) {
  const s = String(status || "").toLowerCase();
  if (s === "forming" || s === "phase1") return "phase1";
  if (s === "phase2") return "phase2";
  if (s === "phase3") return "phase3";
  if (s === "phase4") return "phase4";
  if (s === "frozen") return "frozen";
  return "phase1";
}

async function readTeamSubmissions(teamId) {
  const members = await runSql(`
    SELECT id, member_name, member_index
    FROM team_members
    WHERE team_id = ${sqlQuote(teamId)}
    ORDER BY member_index ASC;
  `);

  const out = [];
  for (const m of members) {
    const row = (await runSql(`
      SELECT id, member_id, team_id, grid_id, architecture, channel_pref, vp_draft, personal_gm_max, submitted_at
      FROM member_submissions
      WHERE team_id = ${sqlQuote(teamId)} AND member_id = ${sqlQuote(m.id)}
      LIMIT 1;
    `))[0] || null;

    let hints = { market: null, tech: null };
    try {
      const j = await getMemberJinang(m.id);
      hints = {
        market: j?.market?.hint_keyword || null,
        tech: j?.tech?.hint_keyword || null
      };
    } catch (_) {}

    let channelPref = null;
    if (row?.channel_pref) {
      try {
        channelPref = JSON.parse(row.channel_pref);
      } catch (_) {
        channelPref = null;
      }
    }

    out.push({
      member_id: m.id,
      member_name: m.member_name,
      member_index: m.member_index,
      submitted: Boolean(row),
      submission: row
        ? {
            id: row.id,
            grid_id: row.grid_id,
            architecture: row.architecture,
            channel_pref: channelPref,
            vp_draft: row.vp_draft,
            personal_gm_max: Number(row.personal_gm_max || 0),
            submitted_at: row.submitted_at
          }
        : null,
      hint_keyword: hints
    });
  }
  return out;
}


async function teamSubmissions(teamId) {
  try {
    let team = await getTeam(teamId);
    if (!team) return makeResponse(404, { ok: false, error: "team not found" });
    if (!String(team.leader_member_id || "").trim() && ["phase2", "phase3", "phase4", "frozen"].includes(String(team.status || ""))) {
      team = await assignRound1LeaderIfNeeded(teamId) || team;
    }
    const submissions = await readTeamSubmissions(teamId);
    const draft = await readRound1TeamDraft(teamId);
    return makeResponse(200, {
      ok: true,
      team: {
        id: team.id,
        team_name: team.team_name,
        team_size: Number(team.team_size || 0),
        status: team.status || "forming",
        ...buildLeaderMeta(team)
      },
      team_draft: draft,
      submissions
    });
  } catch (e) {
    return makeResponse(400, { ok: false, error: e.message });
  }
}

async function savePhase2Draft(teamId, body) {
  try {
    const memberId = readRequesterMemberId(body);
    const permission = await ensureLeaderPermission(teamId, memberId);
    if (!permission.ok) return permission.response;

    const gridId = String(body?.grid_id || body?.gridId || "").trim();
    const architecture = String(body?.architecture || "").trim();
    if (!gridId || !architecture) {
      return makeResponse(400, { ok: false, error: "grid_id and architecture required" });
    }

    const draft = await saveRound1TeamDraft(teamId, memberId, {
      grid_id: gridId,
      architecture: normalizeArchitecture(architecture)
    });

    return makeResponse(200, {
      ok: true,
      team_id: teamId,
      team_draft: draft,
      ...buildLeaderMeta(permission.team, memberId)
    });
  } catch (e) {
    return makeResponse(400, { ok: false, error: e.message });
  }
}

async function savePhase3Draft(teamId, body) {
  try {
    const memberId = readRequesterMemberId(body);
    const permission = await ensureLeaderPermission(teamId, memberId);
    if (!permission.ok) return permission.response;

    const patch = {};
    const gridId = String(body?.grid_id || body?.gridId || "").trim();
    const architecture = String(body?.architecture || "").trim();
    if (gridId) patch.grid_id = gridId;
    if (architecture) patch.architecture = normalizeArchitecture(architecture);
    if (body?.vp_text !== undefined || body?.vpText !== undefined) {
      patch.vp_text = String(body?.vp_text ?? body?.vpText ?? "").trim();
    }

    const draft = await saveRound1TeamDraft(teamId, memberId, patch);
    return makeResponse(200, {
      ok: true,
      team_id: teamId,
      team_draft: draft,
      ...buildLeaderMeta(permission.team, memberId)
    });
  } catch (e) {
    return makeResponse(400, { ok: false, error: e.message });
  }
}

async function persistConfirmedVpResult({
  teamId,
  memberId,
  vpText,
  confirmedFields,
  scores,
  confirmedAt,
  feedback
}) {
  console.log("[confirm-and-score] 写入数据库:", "PostgreSQL", teamId);
  if (teamId && memberId) {
    await assertMemberInTeam(teamId, memberId);
    await runSql(`
      UPDATE team_members
      SET vp_text = ${sqlQuote(String(vpText || "").trim())},
          vp_confirmed_fields = ${sqlQuote(JSON.stringify(confirmedFields || {}))}::jsonb,
          vp_scores = ${sqlQuote(JSON.stringify(scores || {}))}::jsonb,
          vp_confirmed_at = ${sqlQuote(confirmedAt)},
          vp_feedback = ${sqlQuote(String(feedback || "").trim() || null)}
      WHERE id = ${sqlQuote(memberId)} AND team_id = ${sqlQuote(teamId)};
    `);
  }

  const latestSession = await getLatestPhase3SessionRecord(teamId);
  const sessionId = latestSession?.sessionId || await getOrCreatePhase3Session(teamId);
  const session = await getSession(sessionId);
  const nextPmfScore = {
    ...(session?.pmfScore && typeof session.pmfScore === "object" ? session.pmfScore : {}),
    ...buildConfirmedVpResult(confirmedFields, scores),
    _vp_sentence: String(vpText || "").trim(),
    _confirmed_fields: confirmedFields,
    _confirmed_at: confirmedAt,
    _vp_word_scores: scores,
    _vp_feedback: String(feedback || "").trim(),
    _vp_feedback_version: VP_FEEDBACK_VERSION,
    _scorer: "vpWordScorer"
  };

  await updateSession(sessionId, {
    pmfScore: nextPmfScore,
    status: "submitted"
  });

  return { sessionId, sessionPayload: nextPmfScore };
}

async function readPersistedPhase3VpText(teamId, memberId) {
  const tid = String(teamId || "").trim();
  const mid = String(memberId || "").trim();
  if (!tid || !mid) return "";
  const rows = await runSql(`
    SELECT vp_text
    FROM team_members
    WHERE id = ${sqlQuote(mid)} AND team_id = ${sqlQuote(tid)}
    LIMIT 1;
  `);
  return String(rows[0]?.vp_text || "").trim();
}

async function readPersistedPhase3Confirmation(teamId, requesterMemberId = "", leaderMemberId = "") {
  const tid = String(teamId || "").trim();
  if (!tid) return null;
  const requesterId = String(requesterMemberId || "").trim() || "__requester__";
  const leaderId = String(leaderMemberId || "").trim() || "__leader__";
  const rows = await runSql(`
    SELECT id, vp_text, vp_confirmed_fields, vp_scores, vp_confirmed_at, vp_feedback, joined_at
    FROM team_members
    WHERE team_id = ${sqlQuote(tid)}
      AND (
        vp_confirmed_fields IS NOT NULL
        OR vp_scores IS NOT NULL
        OR vp_confirmed_at IS NOT NULL
        OR NULLIF(BTRIM(COALESCE(vp_text, '')), '') IS NOT NULL
        OR NULLIF(BTRIM(COALESCE(vp_feedback, '')), '') IS NOT NULL
      )
    ORDER BY
      CASE
        WHEN id = ${sqlQuote(leaderId)} THEN 0
        WHEN id = ${sqlQuote(requesterId)} THEN 1
        WHEN vp_confirmed_at IS NOT NULL THEN 2
        ELSE 3
      END,
      vp_confirmed_at DESC NULLS LAST,
      joined_at ASC NULLS LAST,
      id ASC
    LIMIT 1;
  `);
  const row = rows[0];
  if (!row) return null;
  return {
    member_id: String(row.id || "").trim() || null,
    vp_text: String(row.vp_text || "").trim(),
    fields: parseJsonColumnValue(row.vp_confirmed_fields),
    scores: parseJsonColumnValue(row.vp_scores),
    confirmed_at: String(row.vp_confirmed_at || "").trim() || "",
    feedback: String(row.vp_feedback || "").trim()
  };
}

async function persistVpFeedback(teamId, feedback, memberId = "") {
  const latestSession = await getLatestPhase3SessionRecord(teamId);
  if (!latestSession?.sessionId) return null;
  const nextPmfScore = {
    ...(latestSession?.pmfScore && typeof latestSession.pmfScore === "object" ? latestSession.pmfScore : {}),
    _vp_feedback: String(feedback || "").trim(),
    _vp_feedback_version: VP_FEEDBACK_VERSION
  };
  await updateSession(latestSession.sessionId, { pmfScore: nextPmfScore });

  const targetMemberId = String(memberId || "").trim() || String((await getTeam(teamId).catch(() => null))?.leader_member_id || "").trim();
  if (teamId && targetMemberId) {
    await runSql(`
      UPDATE team_members
      SET vp_feedback = ${sqlQuote(String(feedback || "").trim() || null)}
      WHERE id = ${sqlQuote(targetMemberId)} AND team_id = ${sqlQuote(String(teamId || "").trim())};
    `).catch(() => {});
  }

  return latestSession.sessionId;
}

async function synthesizePhase3Vp(teamId, body) {
  try {
    const payload = body || {};
    const memberId = readRequesterMemberId(payload);
    const permission = await ensureLeaderPermission(teamId, memberId);
    if (!permission.ok) return permission.response;
    const team = permission.team;
    const requestedGridId = String(payload.grid_id || "").trim();
    const requestedArch = String(payload.architecture || "").trim();
    const latestSession = await getLatestPhase3SessionRecord(teamId);
    if (String(latestSession?.status || "") === "submitted") {
      return makeResponse(400, { ok: false, error: "vp already confirmed and locked" });
    }

    const sessionId = latestSession?.sessionId || await getOrCreatePhase3Session(teamId);
    if (requestedGridId && requestedArch) {
      const jinangContext = payload.jinang && typeof payload.jinang === "object"
        ? payload.jinang
        : await buildPhase3JinangContext(teamId);
      const strategy = {
        ...resolvePhase3Strategy(requestedGridId, requestedArch),
        jinang: jinangContext
      };
      await updateSession(sessionId, { strategy });
    }

    const session = await getSession(sessionId);
    if (!session) return makeResponse(500, { ok: false, error: "vp session not found" });

    const out = await synthesizeVP(session);
    const nextPmfScore = {
      ...(session?.pmfScore && typeof session.pmfScore === "object" ? session.pmfScore : {}),
      _vp_sentence: String(out?.vpText || "").trim(),
      _synthesis_raw: String(out?.raw || "").trim(),
      _synthesis_feedback: String(out?.feedback || "").trim(),
      _synthesis_message_count: Number(out?.messageCount || (Array.isArray(session?.messages) ? session.messages.length : 0))
    };
    await updateSession(sessionId, { pmfScore: nextPmfScore });
    if (!out?.cached && String(out?.feedback || "").trim()) {
      await appendMessage(sessionId, "assistant", String(out.feedback || "").trim());
    }
    const previewScores = await (async () => {
      try {
        return scoreVpByWord(String(out?.vpText || "").trim(), requestedGridId || session?.strategy?.grid_id, requestedArch || session?.strategy?.architecture);
      } catch (_) {
        return null;
      }
    })();
    await recordVpIteration({
      teamId,
      sessionId,
      memberId,
      trigger: "synthesize",
      vpAfter: String(out?.vpText || "").trim(),
      scores: previewScores?.scores || null
    });
    await saveRound1TeamDraft(teamId, memberId, {
      grid_id: requestedGridId || session?.strategy?.grid_id || "",
      architecture: requestedArch || session?.strategy?.architecture || "",
      vp_text: String(out?.vpText || "").trim()
    }).catch(() => {});

    return makeResponse(200, {
      ok: true,
      session_id: sessionId,
      vp_text: String(out?.vpText || "").trim(),
      raw: String(out?.raw || ""),
      feedback: String(out?.feedback || "").trim(),
      cached: Boolean(out?.cached)
    });
  } catch (e) {
    return makeResponse(400, { ok: false, error: e.message });
  }
}

async function extractVpFieldsApi(body) {
  try {
    const vpText = String(body?.vpText || "").trim();
    const last5Turns = String(body?.last5Turns || "").trim();
    if (vpText.length < 5) {
      return makeResponse(400, { ok: false, error: "VP 文本太短" });
    }
    const extracted = await extractVpFields(vpText, { last5Turns });
    return makeResponse(200, {
      ok: true,
      fields: {
        who_raw: String(extracted?.who_raw || "未明确").trim() || "未明确",
        pain_raw: String(extracted?.pain_raw || "未明确").trim() || "未明确",
        how_raw: String(extracted?.how_raw || "未明确").trim() || "未明确",
        alternative_raw: String(extracted?.alternative_raw || "未明确").trim() || "未明确",
        boundary_raw: String(extracted?.boundary_raw || "未明确").trim() || "未明确"
      }
    });
  } catch (e) {
    console.error("[extract-fields] error:", e);
    return makeResponse(500, { ok: false, error: "切片失败，请重试" });
  }
}

async function confirmAndScoreVp(body) {
  try {
    const payload = body || {};
    const teamId = String(payload.teamId || "").trim();
    const memberId = String(payload.memberId || "").trim();
    const vpText = String(payload.vpText || "").trim();
    const gridId = String(payload.grid_id || payload.gridId || "").trim();
    const architecture = String(payload.architecture || "").trim();
    const confirmedFields = normalizeConfirmedFieldsPayload(payload.confirmedFields);

    if (!teamId) {
      return makeResponse(400, { ok: false, error: "缺少 teamId" });
    }
    const permission = await ensureLeaderPermission(teamId, memberId);
    if (!permission.ok) return permission.response;
    const team = permission.team;
    if (!gridId || !architecture) {
      return makeResponse(400, { ok: false, error: "缺少必要参数" });
    }
    if (!confirmedFields.who_raw || confirmedFields.who_raw.length < 2) {
      return makeResponse(400, { ok: false, error: "目标客户不能为空" });
    }
    if (!confirmedFields.pain_raw || confirmedFields.pain_raw.length < 2) {
      return makeResponse(400, { ok: false, error: "痛点不能为空" });
    }
    if (!confirmedFields.how_raw || confirmedFields.how_raw.length < 2) {
      return makeResponse(400, { ok: false, error: "解决方式不能为空" });
    }

    const result = await scoreVpByWord(confirmedFields, gridId, architecture);
    const previewMarketJinang = await getPreviewMarketJinang(teamId, gridId, architecture).catch(() => null);
    const round1Outcome = buildRound1Outcome(gridId, architecture, result?.scores || {}, {
      topMatchStrength: previewMarketJinang?.topMatchStrength || 0,
      totalBonus: previewMarketJinang?.totalBonus || 0
    }, {
      teamId,
      sessionId: `confirm:${teamId}:${memberId || "member"}`,
      memberId,
      vpText
    });
    const confirmedAt = new Date().toISOString();
    console.log(
      "[confirm-and-score] wtpMultiplier:",
      round1Outcome.wtp_multiplier,
      "vpEffect:",
      round1Outcome.wtp_vp_effect,
      "jinangBonus:",
      round1Outcome.jinang_wtp_bonus,
      "rhoDiscount:",
      round1Outcome.rho_C
    );
    const normalizedScores = {
      C: clipScore(round1Outcome.C, 1, 5),
      G: clipScore(round1Outcome.G, 1, 5),
      E: clipScore(round1Outcome.E_raw, 1, 5),
      Eadj: clipScore(round1Outcome.Eadj, 1, 5),
      VPscore: clipScore(round1Outcome.VPscore, 1, 5)
    };
    const feedback = await generateVpFeedback({
      vpText,
      confirmedFields,
      scores: normalizedScores,
      gridLabel: resolvePhase3Strategy(gridId, architecture).cell_label,
      archLabel: toArchitecturePromptLabel(architecture),
      teamId,
      memberId
    });
    const persisted = await persistConfirmedVpResult({
      teamId,
      memberId,
      vpText,
      confirmedFields,
      scores: normalizedScores,
      confirmedAt,
      feedback
    });
    await recordVpIteration({
      teamId,
      sessionId: persisted.sessionId,
      memberId,
      trigger: "confirm_score",
      vpAfter: vpText,
      scores: normalizedScores
    });
    await saveRound1TeamDraft(teamId, memberId, {
      grid_id: gridId,
      architecture,
      vp_text: vpText
    }).catch(() => {});

    return makeResponse(200, {
      ok: true,
      scores: normalizedScores,
      feedback: feedback || "",
      confirmedAt,
      fields: confirmedFields,
      session_id: persisted.sessionId,
      vp_result: buildConfirmedVpResult(confirmedFields, normalizedScores),
      jinang: {
        marketJinang: previewMarketJinang?.top ? {
          id: previewMarketJinang.top.id,
          name: previewMarketJinang.top.name,
          member_id: previewMarketJinang.top.member_id,
          member_name: previewMarketJinang.top.member_name,
          match_strength: Number(previewMarketJinang.top.match_strength || 0),
          bonus: Number(previewMarketJinang.top.bonus || 0)
        } : null,
        marketJinangs: Array.isArray(previewMarketJinang?.items)
          ? previewMarketJinang.items.map((item) => ({
              id: item.id,
              name: item.name,
              member_id: item.member_id,
              member_name: item.member_name,
              match_strength: Number(item.match_strength || 0),
              bonus: Number(item.bonus || 0)
            }))
          : [],
        marketJinangBonusTotal: round1Outcome.jinang_wtp_bonus
      },
      wtp: {
        vpEffect: round1Outcome.wtp_vp_effect,
        jinangBonus: round1Outcome.jinang_wtp_bonus,
        multiplier: round1Outcome.wtp_multiplier,
        lambdaG: round1Outcome.lambda_G,
        lambdaE: round1Outcome.lambda_E,
        rhoC: round1Outcome.rho_C,
        percentChange: toCompressedPercent(round1Outcome.wtp_multiplier)
      }
    });
  } catch (e) {
    console.error("[confirm-and-score] error:", e);
    return makeResponse(500, { ok: false, error: "评分失败，请重试" });
  }
}

async function generateVpFeedbackApi(body) {
  try {
    const payload = body || {};
    const teamId = String(payload.teamId || "").trim();
    const memberId = String(payload.memberId || "").trim();
    const vpText = String(payload.vpText || "").trim();
    const gridLabel = String(payload.gridLabel || "").trim();
    const archLabel = String(payload.archLabel || "").trim();
    const confirmedFields = payload.confirmedFields && typeof payload.confirmedFields === "object"
      ? payload.confirmedFields
      : null;
    const scores = payload.scores && typeof payload.scores === "object"
      ? payload.scores
      : null;

    if (!confirmedFields || !scores) {
      return makeResponse(400, { ok: false, error: "缺少必要参数" });
    }

    const feedback = await generateVpFeedback({
      vpText,
      confirmedFields,
      scores,
      gridLabel,
      archLabel,
      teamId,
      memberId
    });

    if (teamId && feedback) {
      await persistVpFeedback(teamId, feedback).catch(() => {});
    }

    return makeResponse(200, { ok: true, feedback: feedback || null });
  } catch (e) {
    console.error("[generate-feedback] error:", e);
    return makeResponse(503, { ok: false, error: "AI 服务暂时不可用，请重试" });
  }
}


async function submitPhase3Vp(teamId, body) {
  const payload = body || {};
  const mode = String(payload.mode || payload.action || "score").toLowerCase();
  const isSubmit = payload.isSubmit === true || String(payload.isSubmit || "").toLowerCase() === "true";
  if (mode === "confirm" || isSubmit) {
    console.warn("[submitPhase3Vp] DEPRECATED: confirm 模式已迁移到 /api/vp/confirm-and-score，请使用新 endpoint");
    return makeResponse(410, {
      ok: false,
      error: "此确认入口已停用，请使用 /api/vp/confirm-and-score"
    });
  }

  try {
    const team = await getTeam(teamId);
    if (!team) return makeResponse(404, { ok: false, error: "team not found" });

    const memberId = String(payload.memberId || payload.member_id || "").trim();
    const requestedGridId = String(payload.grid_id || "").trim();
    const requestedArch = String(payload.architecture || "").trim();
    const gridId = requestedGridId || String(team.final_grid_id || "").trim();
    const architecture = requestedArch || String(team.final_architecture || "Experience").trim();
    if (!gridId || !architecture) {
      return makeResponse(400, { ok: false, error: "grid_id and architecture required" });
    }

    const jinangContext = payload.jinang && typeof payload.jinang === "object"
      ? payload.jinang
      : await buildPhase3JinangContext(teamId);
    const strategy = {
      ...resolvePhase3Strategy(gridId, architecture),
      jinang: jinangContext
    };
    const architectureLabel = toArchitecturePromptLabel(strategy.architecture_label || strategy.architecture);
    const sessionId = await getOrCreatePhase3Session(teamId);
    await updateSession(sessionId, { strategy });
    const session = await getSession(sessionId);
    if (!session) return makeResponse(500, { ok: false, error: "vp session not found" });

    if (mode === "score") {
      const vpText = String(payload.vp_text || payload.vpText || "").trim();
      if (vpText.length < 5) {
        return makeResponse(400, { ok: false, error: "vp_text required" });
      }

      let scoringResult = null;
      try {
        scoringResult = await scoreVpByWord(vpText, gridId, architecture);
      } catch (_) {
        scoringResult = null;
      }
      const rawWordScores = scoringResult?.scores || {};
      const scores = {
        coverage: clipScore(rawWordScores.C, 1, 5),
        generalizability: clipScore(rawWordScores.G, 1, 5),
        effectiveness: clipScore(rawWordScores.E, 1, 5)
      };
      const scoreValid = scores.coverage != null && scores.generalizability != null && scores.effectiveness != null;
      const previewMarketJinang = await getPreviewMarketJinang(teamId, gridId, architecture).catch(() => null);
      const round1Outcome = buildRound1Outcome(gridId, architecture, {
        C: scores.coverage,
        G: scores.generalizability,
        E: scores.effectiveness
      }, {
        topMatchStrength: previewMarketJinang?.topMatchStrength || 0,
        totalBonus: previewMarketJinang?.totalBonus || 0
      }, {
        teamId,
        sessionId,
        vpText
      });

      await updateSession(sessionId, {
        pmfScore: {
          _vp_sentence: vpText,
          _scoring_features: scoringResult?.details || null,
          preview_scores: scores
        },
        status: "chatting"
      });
      await recordVpIteration({
        teamId,
        sessionId,
        memberId,
        trigger: "score_preview",
        vpAfter: vpText,
        scores
      });

      return makeResponse(200, {
        ok: true,
        mode,
        session_id: sessionId,
        has_score_preview: true,
        score_valid: scoreValid,
        scores,
        features: scoringResult?.details || null,
        vp_draft: vpText,
        scored_at_user_msg_count: 0,
        bottleneck: "建议继续打磨目标客户、痛点场景和价值表达。",
        coach_reply: null,
        vp_result: null,
        vp_result_raw: null,
        wtp_preview: {
          multiplier: round1Outcome.wtp_multiplier,
          wtp_adj: round1Outcome.WTPadj,
          vp_effect: round1Outcome.wtp_vp_effect
        }
      });
    }

    if (mode !== "confirm") {
      return makeResponse(400, { ok: false, error: "mode must be score or confirm" });
    }

    const confirmUserMessage = "我们决定确认提交最终版价值主张，请给出最终提交结果。";
    let replyText = "";
    let vpResult = null;
    let vpResultRaw = null;
    let scoreValid = false;
    let scores = emptyApiScores();
    let features = null;
    let pmfScorePayload = null;
    const out = await chat(session, confirmUserMessage, { mode: "confirm", temperature: 0 });
    replyText = String(out?.replyText || "").trim();
    vpResult = out?.vpResult || null;
    vpResultRaw = out?.vpResultRaw || null;

    await appendMessage(sessionId, "user", confirmUserMessage);
    await appendMessage(sessionId, "assistant", replyText);

    if (vpResult) {
      const confirmedScoringConversation = buildVpResultScoringText(vpResult);
      let scoringResult = null;
      try {
        scoringResult = await scoreVp(confirmedScoringConversation, strategy.cell_label, architectureLabel);
      } catch (_) {
        scoringResult = null;
      }
      features = scoringResult?.features || null;
      const confirmedScores = scorerScoresToApi(scoringResult?.scores);
      if (confirmedScores) {
        scoreValid = true;
        scores = confirmedScores;
      } else {
        scores = emptyApiScores();
        scoreValid = false;
      }
    }

    const confirmedFields = vpResultToConfirmedFields(
      vpResult,
      String(payload.vp_text || payload.vpText || buildVpResultScoringText(vpResult) || "").trim()
    );
    const confirmedAt = confirmedFields ? new Date().toISOString() : null;

    if (vpResult && scoreValid) {
      vpResult = {
        ...vpResult,
        scores: {
          C: { score: scores.coverage, feedback: "" },
          G: { score: scores.generalizability, feedback: "" },
          E: { score: scores.effectiveness, feedback: "" }
        }
      };
    }

    pmfScorePayload = vpResult
      ? {
          ...vpResult,
          ...(features ? { _scoring_features: features } : {}),
          ...(confirmedFields ? {
            _vp_sentence: String(payload.vp_text || payload.vpText || buildVpResultScoringText(vpResult) || "").trim(),
            _confirmed_fields: confirmedFields,
            _confirmed_at: confirmedAt
          } : {})
        }
      : null;

    await updateSession(sessionId, {
      pmfScore: pmfScorePayload,
      status: "submitted"
    });

    const bottleneck = String(replyText || "").split(/\n+/).map((s) => s.trim()).find(Boolean) || "建议补充更具体场景。";

    return makeResponse(200, {
      ok: true,
      mode,
      session_id: sessionId,
      has_score_preview: true,
      score_valid: scoreValid,
      scores,
      features,
      vp_draft: null,
      scored_at_user_msg_count: 0,
      bottleneck,
      coach_reply: replyText,
      vp_result: vpResult || null,
      vp_result_raw: vpResultRaw || null
    });
  } catch (e) {
    return makeResponse(400, { ok: false, error: e.message });
  }
}

async function chatPhase3(teamId, body) {
  try {
    const team = await getTeam(teamId);
    if (!team) return makeResponse(404, { ok: false, error: "team not found" });
    const message = String(body?.message || "").trim();
    const memberId = String(body?.memberId || body?.member_id || "").trim();
    if (!message) return makeResponse(400, { ok: false, error: "message required" });
    const requestedGridId = String(body?.grid_id || "").trim();
    const requestedArch = String(body?.architecture || "").trim();
    const jinangContext = body?.jinang && typeof body.jinang === "object"
      ? body.jinang
      : await buildPhase3JinangContext(teamId);

    const sessionId = await getOrCreatePhase3Session(teamId);
    if (requestedGridId && requestedArch) {
      const strategy = {
        ...resolvePhase3Strategy(requestedGridId, requestedArch),
        jinang: jinangContext
      };
      await updateSession(sessionId, { strategy });
    }
    const session = await getSession(sessionId);
    if (!session) return makeResponse(500, { ok: false, error: "vp session not found" });

    const out = await chat(session, message, { mode: "chat" });
    await appendMessage(sessionId, "user", message);
    await appendMessage(sessionId, "assistant", out.replyText);
    if (String(session.status || "") !== "submitted") {
      await updateSession(sessionId, { status: "chatting" });
    }

    return makeResponse(200, {
      ok: true,
      session_id: sessionId,
      coach_reply: out.replyText,
      member_id: memberId || null
    });
  } catch (e) {
    return makeResponse(400, { ok: false, error: e.message });
  }
}

async function finalizePhase3(teamId, body) {
  try {
    const payload = body || {};
    const memberId = String(payload.memberId || payload.member_id || "").trim();
    const permission = await ensureLeaderPermission(teamId, memberId);
    if (!permission.ok) return permission.response;
    const team = permission.team;
    const gridId = String(payload.grid_id || "").trim();
    const architecture = String(payload.architecture || "").trim();
    if (!gridId || !architecture) {
      return makeResponse(400, { ok: false, error: "grid_id and architecture required" });
    }

    const arch = normalizeArchitecture(architecture);
    const latestSession = await getLatestPhase3SessionRecord(teamId);
    const sessionId = latestSession?.sessionId || await getOrCreatePhase3Session(teamId);
    const session = latestSession || await getSession(sessionId);
    const draft = await readRound1TeamDraft(teamId).catch(() => null);
    const vpSummary = await summarizeVpFromConversation({
      gridId,
      architecture: arch,
      sessionMessages: session?.messages || [],
      payloadConversation: payload.conversation_history || [],
      payloadVpResult: payload.vp_result || null
    });
    const persistedVpText = await readPersistedPhase3VpText(teamId, memberId).catch(() => "");
    const finalVpText = String(
      payload.vp_text ||
      payload.vpText ||
      persistedVpText ||
      session?.pmfScore?._vp_sentence ||
      draft?.vp_text ||
      ""
    ).trim() || vpSummary.text;
    const confirmedArch = normalizeConfirmedArchitecture(vpSummary?.confirmedArchitecture);
    const finalArch = confirmedArch && confirmedArch !== arch ? confirmedArch : arch;
    const archSource = confirmedArch && confirmedArch !== arch ? "coach_confirmed" : "player_selected";

    const payloadScores = normalizeVpScoresInput(payload.scores);
    const sessionScores = vpResultToApiScores(session?.pmfScore || null);
    const finalScores = payloadScores || sessionScores || emptyApiScores();
    const confirmedFields = payload.confirmed_fields && typeof payload.confirmed_fields === "object"
      ? (() => {
          const normalized = normalizeConfirmedFieldsPayload(payload.confirmed_fields);
          return Object.values(normalized).some((value) => String(value || "").trim()) ? normalized : null;
        })()
      : vpResultToConfirmedFields(payload.vp_result || null, finalVpText);
    const confirmedAt = confirmedFields ? new Date().toISOString() : null;
    const finalVpSummary = normalizeVpSummaryPayload(vpSummary, {
      fallbackText: finalVpText,
      confirmedFields
    });
    const vpScores = buildPersistedVpScores(
      finalScores?.coverage,
      finalScores?.generalizability,
      finalScores?.effectiveness
    );
    const engineVpScores = {
      C: vpScores.C ?? 3,
      G: vpScores.G ?? 3,
      E: vpScores.E ?? 3
    };

    await runSql(`
      UPDATE teams
      SET final_grid_id = ${sqlQuote(gridId)},
          final_architecture = ${sqlQuote(finalArch)},
          final_architecture_source = ${sqlQuote(archSource)},
          final_vp_text = ${sqlQuote(finalVpText)},
          final_vp_summary = ${sqlQuote(JSON.stringify(finalVpSummary))}::jsonb,
          final_vp_scores = ${sqlQuote(JSON.stringify(vpScores))}
      WHERE id = ${sqlQuote(teamId)};
    `);

    const settle = await settleAllJinang(teamId);
    const marketJinangSummary = summarizeEligibleMarketSettlements(settle?.settlements || []);
    const r1 = buildRound1Outcome(gridId, finalArch, engineVpScores, marketJinangSummary, {
      teamId,
      sessionId,
      vpText: finalVpText
    });
    scheduleFinalRound1Stages(
      { teamId, sessionId, source: "web" },
      r1,
      {
        source_iteration: payload.source_iteration,
        used_best_iteration: payload.used_best_iteration === true,
        vp_text: finalVpText
      }
    );

    await runSql(`
      UPDATE teams
      SET final_sam = ${Number(r1.SAM_billion)},
          final_wtp_adj = ${Number(r1.WTPadj)},
          final_wtp_ref = ${Number(r1.WTPref)},
          final_vp_c = ${Number(r1.C)},
          final_vp_g = ${Number(r1.G)},
          final_vp_e_raw = ${Number(r1.E_raw)},
          final_vp_e_adj = ${Number(r1.Eadj)},
          final_rho_c = ${Number(r1.rho_C)},
          final_wtp_multiplier = ${Number(r1.wtp_multiplier)}
      WHERE id = ${sqlQuote(teamId)};
    `);
    console.log("[Round1 finalize] 存储 WTP:", {
      table: "teams",
      final_wtp_adj: Number(r1.WTPadj),
      final_wtp_ref: Number(r1.WTPref),
      final_wtp_multiplier: Number(r1.wtp_multiplier),
      wtp_vp_effect: Number(r1.wtp_vp_effect),
      jinang_wtp_bonus: Number(r1.jinang_wtp_bonus)
    });

    if (sessionId) {
      const nextPmfScore = {
        ...(session?.pmfScore && typeof session.pmfScore === "object" ? session.pmfScore : {}),
        ...(payloadScores ? {
          scores: {
            C: { score: vpScores.C, feedback: "" },
            G: { score: vpScores.G, feedback: "" },
            E: { score: vpScores.E, feedback: "" }
          }
        } : {}),
        ...(confirmedFields ? {
          _vp_sentence: finalVpText,
          _confirmed_fields: confirmedFields,
          _confirmed_at: confirmedAt
        } : {})
      };
      await updateSession(sessionId, { pmfScore: nextPmfScore }).catch(() => {});
    }

    await updateTeamStatus(teamId, "phase4");
    await recordVpIteration({
      teamId,
      sessionId,
      memberId,
      trigger: "finalize",
      vpAfter: finalVpText,
      scores: vpScores,
      sourceIteration: payload.source_iteration,
      usedBestIteration: payload.used_best_iteration === true
    });
    await saveRound1TeamDraft(teamId, memberId, {
      grid_id: gridId,
      architecture: finalArch,
      vp_text: finalVpText
    }).catch(() => {});

    return makeResponse(200, {
      ok: true,
      team_id: teamId,
      status: "phase4",
      r1_result: r1,
      vp_summary: finalVpSummary,
      settle
    });
  } catch (e) {
    return makeResponse(400, { ok: false, error: e.message });
  }
}

async function buildPhase4Data(teamId) {
  const team = await getTeam(teamId);
  if (!team) return { ok: false, status: 404, error: "team not found" };
  if (!team.final_grid_id || !team.final_architecture) {
    return { ok: false, status: 400, error: "team final decision incomplete" };
  }

  let rawScores = {};
  try {
    rawScores = JSON.parse(team.final_vp_scores || "{}");
  } catch (_) {
    rawScores = {};
  }
  if (!hasAnyScore(rawScores) || isClearlyBrokenScoreSet(rawScores)) {
    const recoveredScores = await getRecoveredVpScores(teamId);
    if (recoveredScores && !isClearlyBrokenScoreSet(recoveredScores)) {
      rawScores = recoveredScores;
      await runSql(`
        UPDATE teams
        SET final_vp_scores = ${sqlQuote(JSON.stringify(buildPersistedVpScores(recoveredScores.C, recoveredScores.G, recoveredScores.E)))},
            final_vp_c = ${Number(recoveredScores.C)},
            final_vp_g = ${Number(recoveredScores.G)},
            final_vp_e_raw = ${Number(recoveredScores.E)}
        WHERE id = ${sqlQuote(teamId)};
      `);
    }
  }
  const vpScores = buildPersistedVpScores(
    rawScores.C ?? team.final_vp_c,
    rawScores.G ?? team.final_vp_g,
    rawScores.E ?? team.final_vp_e_raw
  );
  const engineVpScores = {
    C: vpScores.C ?? 3,
    G: vpScores.G ?? 3,
    E: vpScores.E ?? 3
  };

  const settle = await settleAllJinang(teamId);
  const marketJinangSummary = summarizeEligibleMarketSettlements(settle?.settlements || []);
  const sessions = await getTeamSessions(teamId);
  const latestSession = getLatestPhase3Session(sessions);
  const vpText = team.final_vp_text || "";
  const confirmedFields = latestSession?.pmfScore?._confirmed_fields && typeof latestSession.pmfScore._confirmed_fields === "object"
    ? latestSession.pmfScore._confirmed_fields
    : null;
  const vpSummary = normalizeVpSummaryPayload(team.final_vp_summary, {
    fallbackText: vpText,
    confirmedFields
  });
  const r1Base = buildRound1Outcome(team.final_grid_id, team.final_architecture, engineVpScores, {
    topMatchStrength: 0,
    totalBonus: 0
  });
  const r1 = buildRound1Outcome(team.final_grid_id, team.final_architecture, engineVpScores, marketJinangSummary, {
    teamId,
    sessionId: latestSession?.sessionId || `phase4:${teamId}`,
    vpText
  });
  const extractField = (text, key) => {
    const re = new RegExp(key + "\\s*[：:]\\s*([^\\n]+)");
    const match = String(text || "").match(re);
    return match ? match[1].trim() : "";
  };

  await runSql(`
    UPDATE teams
    SET final_sam = ${Number(r1.SAM_billion)},
        final_wtp_adj = ${Number(r1.WTPadj)},
        final_wtp_ref = ${Number(r1.WTPref)},
        final_vp_c = ${Number(r1.C)},
        final_vp_g = ${Number(r1.G)},
        final_vp_e_raw = ${Number(r1.E_raw)},
        final_vp_e_adj = ${Number(r1.Eadj)},
        final_rho_c = ${Number(r1.rho_C)},
        final_wtp_multiplier = ${Number(r1.wtp_multiplier)}
    WHERE id = ${sqlQuote(teamId)};
  `);
  console.log("[Phase4] 刷新 WTP:", {
    table: "teams",
    final_wtp_adj: Number(r1.WTPadj),
    final_wtp_ref: Number(r1.WTPref),
    final_wtp_multiplier: Number(r1.wtp_multiplier),
    wtp_vp_effect: Number(r1.wtp_vp_effect),
    jinang_wtp_bonus: Number(r1.jinang_wtp_bonus)
  });

  let vpFeedback = String(latestSession?.pmfScore?._vp_feedback || "").trim() || null;
  const vpFeedbackVersion = Number(latestSession?.pmfScore?._vp_feedback_version || 0);
  if ((!vpFeedback || vpFeedbackVersion < VP_FEEDBACK_VERSION) && confirmedFields) {
    try {
      vpFeedback = await generateVpFeedback({
        vpText: String(latestSession?.pmfScore?._vp_sentence || vpText || "").trim(),
        confirmedFields,
        scores: {
          C: clipScore(r1.C, 1, 5),
          G: clipScore(r1.G, 1, 5),
          E: clipScore(r1.E_raw, 1, 5),
          Eadj: clipScore(r1.Eadj, 1, 5),
          VPscore: clipScore(r1.VPscore, 1, 5)
        },
        gridLabel: resolvePhase3Strategy(team.final_grid_id, team.final_architecture).cell_label,
        archLabel: toArchitecturePromptLabel(team.final_architecture),
        teamId,
        memberId: latestSession?.pmfScore?._member_id || null
      });
      if (vpFeedback) {
        await persistVpFeedback(teamId, vpFeedback).catch(() => {});
      }
    } catch (_) {
      vpFeedback = null;
    }
  }
  const topMarketJinang = marketJinangSummary.topItem;

  return {
    ok: true,
    team: {
      id: team.id,
      team_name: team.team_name,
      status: team.status,
      final_grid_id: team.final_grid_id,
      final_architecture: team.final_architecture,
      final_architecture_source: team.final_architecture_source || "player_selected",
      final_vp_text: team.final_vp_text,
      final_vp_summary: vpSummary
    },
    r1_result: r1,
    wtp_breakdown: {
      base_result: r1Base,
      final_result: r1,
      market_jinang_match_strength: marketJinangSummary.topMatchStrength,
      rho_discount: r1.rho_C,
      vp_effect: r1.wtp_vp_effect,
      jinang_bonus: r1.jinang_wtp_bonus,
      market_jinang_bonus_total: marketJinangSummary.totalBonus,
      multiplier: r1.wtp_multiplier,
      base_pct: toCompressedPercent(r1.wtp_vp_effect),
      final_pct: toCompressedPercent(r1.wtp_multiplier),
      jinang_delta_pct: toRawBonusPercent(r1.jinang_wtp_bonus),
      compressed_jinang_delta_pct: toCompressedDeltaPercent(r1.wtp_vp_effect, r1.wtp_multiplier)
    },
    vp_scores: {
      C: clipScore(rawScores.C ?? vpScores.C, 1, 5),
      G: clipScore(rawScores.G ?? vpScores.G, 1, 5),
      E: clipScore(rawScores.E ?? vpScores.E, 1, 5),
      Eadj: clipScore(r1.Eadj, 1, 5),
      VPscore: clipScore(r1.VPscore, 1, 5)
    },
    vp_summary: {
      who: vpSummary.who || extractField(vpText, "WHO"),
      pain: vpSummary.pain || extractField(vpText, "PAIN"),
      how: vpSummary.how || extractField(vpText, "HOW"),
      boundary: vpSummary.boundary || extractField(vpText, "BOUNDARY"),
      archConsistency: vpSummary.archConsistency || "",
      coachComment: vpSummary.coachComment || ""
    },
    vp_feedback: vpFeedback,
    jinang: {
      market_jinang: topMarketJinang ? {
        id: topMarketJinang.jinang_id,
        name: topMarketJinang.name,
        member_id: topMarketJinang.member_id,
        member_name: topMarketJinang.member_name,
        match_strength: Number(topMarketJinang.match_strength || 0),
        bonus: Number(topMarketJinang.bonus || 0)
      } : null,
      market_jinangs: marketJinangSummary.items.map((item) => ({
        id: item.jinang_id,
        name: item.name,
        member_id: item.member_id,
        member_name: item.member_name,
        match_strength: Number(item.match_strength || 0),
        bonus: Number(item.bonus || 0)
      })),
      market_jinang_bonus_total: marketJinangSummary.totalBonus
    },
    settle
  };
}

async function phase4Data(teamId) {
  try {
    const data = await buildPhase4Data(teamId);
    if (!data.ok) return makeResponse(data.status || 400, { ok: false, error: data.error || "phase4 failed" });
    return makeResponse(200, data);
  } catch (e) {
    return makeResponse(400, { ok: false, error: e.message });
  }
}

async function phase3State(teamId, requesterMemberId = "") {
  try {
    let team = await getTeam(teamId);
    if (!team) return makeResponse(404, { ok: false, error: "team not found" });
    if (!String(team.leader_member_id || "").trim() && ["phase2", "phase3", "phase4", "frozen"].includes(String(team.status || ""))) {
      team = await assignRound1LeaderIfNeeded(teamId) || team;
    }
    const draft = await readRound1TeamDraft(teamId);

    const sessions = await getTeamSessions(teamId);
    const session = getLatestPhase3Session(sessions);
    if (!session) {
      return makeResponse(200, {
        ok: true,
        team_id: teamId,
        ...buildLeaderMeta(team, requesterMemberId),
        team_draft: draft,
        session_id: null,
        status: "chatting",
        strategy: draft?.grid_id && draft?.architecture
          ? resolvePhase3Strategy(draft.grid_id, draft.architecture)
          : null,
        coach_history: [],
        vp_confirmation: null,
        score_state: {
          has_score_preview: false,
          score_valid: false,
          scores: {
            coverage: null,
            generalizability: null,
            effectiveness: null
          },
          vp_draft: null,
          scored_at_user_msg_count: 0
        }
      });
    }

    const messages = Array.isArray(session.messages) ? session.messages : [];
    const coachHistory = restoreCoachHistory(messages);
    const persistedConfirmation = await readPersistedPhase3Confirmation(
      teamId,
      requesterMemberId,
      String(team?.leader_member_id || "").trim()
    ).catch(() => null);
    const previewScores = readPreviewScoresFromSession(session.pmfScore || null);
    const vpDraft = String(
      persistedConfirmation?.vp_text ||
      session?.pmfScore?._vp_sentence ||
      draft?.vp_text ||
      ""
    ).trim();
    const confirmedFields = persistedConfirmation?.fields
      || (session?.pmfScore?._confirmed_fields && typeof session.pmfScore._confirmed_fields === "object"
        ? session.pmfScore._confirmed_fields
        : null);
    const confirmedAt = String(
      persistedConfirmation?.confirmed_at ||
      session?.pmfScore?._confirmed_at ||
      ""
    ).trim();
    const confirmationScores = persistedConfirmation?.scores
      || (session?.pmfScore?._vp_word_scores && typeof session.pmfScore._vp_word_scores === "object"
        ? session.pmfScore._vp_word_scores
        : null);
    const feedback = String(
      persistedConfirmation?.feedback ||
      session?.pmfScore?._vp_feedback ||
      ""
    ).trim();
    const scores = previewScores || {
      coverage: null,
      generalizability: null,
      effectiveness: null
    };
    const scoreValid = Object.values(scores).some((v) => v != null);
    const status = String(session.status || "chatting");
    const hasScorePreview = status === "scored" || status === "submitted" || previewScores != null;

    return makeResponse(200, {
      ok: true,
      team_id: teamId,
      ...buildLeaderMeta(team, requesterMemberId),
      team_draft: draft,
      session_id: session.sessionId,
      status,
      strategy: session.strategy || (draft?.grid_id && draft?.architecture
        ? resolvePhase3Strategy(draft.grid_id, draft.architecture)
        : null),
      coach_history: coachHistory,
      vp_confirmation: confirmedFields ? {
        status: confirmedAt ? "scored" : "confirming",
        vp_text: vpDraft || "",
        fields: confirmedFields,
        scores: confirmationScores || null,
        confirmed_at: confirmedAt || "",
        feedback: feedback || ""
      } : null,
      score_state: {
        has_score_preview: hasScorePreview,
        score_valid: scoreValid,
        scores,
        vp_draft: vpDraft || "",
        scored_at_user_msg_count: Number(session?.pmfScore?._scored_at_user_msg_count || 0)
      }
    });
  } catch (e) {
    return makeResponse(400, { ok: false, error: e.message });
  }
}

async function getPhase3Scores(teamId) {
  try {
    const team = await getTeam(teamId);
    if (!team) return makeResponse(404, { ok: false, error: "team not found" });

    const sessions = await getTeamSessions(teamId);
    const session = getLatestPhase3Session(sessions);
    if (!session) {
      return makeResponse(200, {
        ok: true,
        team_id: teamId,
        session_id: null,
        score_valid: false,
        scores: {
          coverage: null,
          generalizability: null,
          effectiveness: null
        },
        vp_draft: null,
        scored_at_user_msg_count: 0
      });
    }

    const scores = vpResultToApiScores(session.pmfScore || null) || {
      coverage: null,
      generalizability: null,
      effectiveness: null
    };
    const vpDraft = String(session?.pmfScore?._vp_sentence || "").trim();
    const scoreValid = !areApiScoresEmpty(scores);

    return makeResponse(200, {
      ok: true,
      team_id: teamId,
      session_id: session.sessionId,
      score_valid: scoreValid,
      scores,
      vp_draft: vpDraft || "",
      scored_at_user_msg_count: Number(session?.pmfScore?._scored_at_user_msg_count || 0)
    });
  } catch (e) {
    return makeResponse(400, { ok: false, error: e.message });
  }
}

async function freezeTeam(teamId, body = {}) {
  try {
    const memberId = readRequesterMemberId(body);
    const permission = await ensureLeaderPermission(teamId, memberId);
    if (!permission.ok) return permission.response;
    const team = permission.team;
    if (!team.final_grid_id) {
      return makeResponse(400, { ok: false, error: "must finalize before freezing" });
    }
    await updateTeamStatus(teamId, "frozen");
    return makeResponse(200, { ok: true, status: "frozen", ...buildLeaderMeta(team, memberId) });
  } catch (e) {
    return makeResponse(400, { ok: false, error: e.message });
  }
}

async function getTeamStatus(teamId, requesterMemberId = "") {
  try {
    let team = await getTeam(teamId);
    if (!team) return makeResponse(404, { ok: false, error: "team not found" });
    if (!String(team.leader_member_id || "").trim() && ["phase2", "phase3", "phase4", "frozen"].includes(String(team.status || ""))) {
      team = await assignRound1LeaderIfNeeded(teamId) || team;
    }
    const memberCount = Array.isArray(team.members) ? team.members.length : 0;
    const submittedCount = await countTeamSubmissions(teamId);
    const status = String(team.status || "forming");
    const round2State = await getTeamRound2State(teamId);
    const draft = await readRound1TeamDraft(teamId);
    return makeResponse(200, {
      ok: true,
      status,
      phase: getPhaseByStatus(status),
      all_submitted: submittedCount >= memberCount && memberCount > 0,
      member_count: memberCount,
      submitted_count: submittedCount,
      ...buildLeaderMeta(team, requesterMemberId),
      team_draft: draft,
      r2_status: round2State?.r2?.status || "R2_NOT_STARTED",
      r2_status_label: round2State?.r2?.statusLabel || "未开始"
    });
  } catch (e) {
    return makeResponse(400, { ok: false, error: e.message });
  }
}

async function getMemberJinangApi(teamId, memberId) {
  try {
    await assertMemberInTeam(teamId, memberId);
    const jinang = await getMemberJinang(memberId);
    return makeResponse(200, {
      ok: true,
      jinang: {
        member_id: jinang.member_id,
        team_id: jinang.team_id,
        member_name: jinang.member_name,
        market: jinang.market ? {
          id: jinang.market.id,
          name: jinang.market.name,
          desc_for_player: jinang.market.desc_for_player
        } : null,
        tech: jinang.tech ? {
          id: jinang.tech.id,
          name: jinang.tech.name,
          desc_for_player: jinang.tech.desc_for_player
        } : null
      }
    });
  } catch (e) {
    return makeResponse(400, { ok: false, error: e.message });
  }
}

module.exports = {
  createTeamApi,
  joinTeamApi,
  getTeamApi,
  submitPhase1,
  teamSubmissions,
  savePhase2Draft,
  savePhase3Draft,
  synthesizePhase3Vp,
  submitPhase3Vp,
  chatPhase3,
  extractVpFieldsApi,
  confirmAndScoreVp,
  generateVpFeedbackApi,
  finalizePhase3,
  phase3State,
  getPhase3Scores,
  phase4Data,
  freezeTeam,
  getTeamStatus,
  getMemberJinangApi,
  clipScore,
  lambdaMap,
  rhoDiscount,
  buildRound1Outcome,
  vpResultToApiScores,
  buildVpResultScoringText,
  vpResultToConfirmedFields
};
