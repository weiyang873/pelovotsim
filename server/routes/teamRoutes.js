const path = require("node:path");
const { runSql, runTransaction, sqlQuote } = require("../db/pgSql");

const Engine = require("../../engine");
const { chat, synthesizeVP } = require("../llm/vpCoach");
const { extractVpFields } = require("../llm/vpEmbeddingScorer");
const { scoreVp } = require("../llm/vpScorer");
const {
  scoreVpByWord,
  generateVpFeedback,
  sanitizeGeneratedFeedback,
  buildFallbackVpFeedback
} = require("../llm/vpWordScorer");
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
  advanceTeamStatusToPhase2IfAllSubmitted,
  createTeam: createTeamRow,
  joinTeam: joinTeamRow,
  setTeamLeader
} = require("../multiplayer/teamManager");
const {
  getTeamRound2State,
  ensureSchema: ensureRound2StateSchema,
  refreshCachedTeamRound2State,
  logTeacherAction,
  nowIso
} = require("../multiplayer/round2State");
const { clearTeamStateCache } = require("../cache/teamStateCache");
const { computeJinangWtpBonus } = require("../multiplayer/jinangCoeff");
const { getSessionConfig } = require("../multiplayer/sessionConfig");
const {
  addScaledMoneyFields,
  scaleStoredMoney
} = require("../multiplayer/moneyScale");

const ROOT = path.join(__dirname, "..", "..");
const CONFIG_DIR = path.join(ROOT, "game_config_v0.1");

let cachedEngineConfig = null;
const VP_FEEDBACK_VERSION = 3;
const VP_LLM_TIMEOUT_MS = 60000;
const vpFeedbackJobs = new Set();
const freezeRefreshJobs = new Set();

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

function countChars(text) {
  return Array.from(String(text || "")).length;
}

function sliceChars(text, limit) {
  return Array.from(String(text || "")).slice(0, limit).join("");
}

function matchStrengthToTier(value) {
  const strength = clamp01(value);
  if (strength >= 0.7) return "高度契合";
  if (strength >= 0.5) return "部分契合";
  return "契合度有限";
}

function toStudentFacingMatch(item) {
  if (!item) return null;
  const { match_strength, ...rest } = item;
  return {
    ...rest,
    match_tier: matchStrengthToTier(match_strength)
  };
}

function sanitizeStudentR1Result(result) {
  if (!result || typeof result !== "object") return result;
  const { jinang_match_strength, ...rest } = result;
  return addScaledMoneyFields(rest, [
    "SAM_billion",
    "WTPmean",
    "WTPmedian",
    "WTPref",
    "WTPadj",
    "WTPadj_raw",
    "WTPref_adjusted"
  ]);
}

function sanitizeStudentSettle(settle) {
  const src = settle && typeof settle === "object" ? settle : {};
  const settlements = Array.isArray(src.settlements) ? src.settlements : [];
  return {
    ...src,
    settlements: settlements.map((item) => {
      const effect = parseSettlementEffect(item);
      const { match_strength, ...restEffect } = effect;
      return {
        ...item,
        match_tier: matchStrengthToTier(item?.match_strength),
        effect_applied: {
          ...restEffect,
          bonus: Number.isFinite(Number(restEffect?.bonus)) ? Number(restEffect.bonus) : undefined
        }
      };
    }).map((item) => {
      const { match_strength, ...rest } = item;
      return rest;
    })
  };
}

const DEFERRED_SENSITIVE_KEY_SET = new Set([
  "SAM_billion",
  "SAM_billion_scaled",
  "WTPmedian",
  "WTPmean",
  "WTPref",
  "WTPadj",
  "WTPadj_raw",
  "WTPref_adjusted",
  "wtp_breakdown",
  "wtp_premium",
  "vp_premium",
  "jinang_premium",
  "premium_pct",
  "jinang_bonus",
  "market_jinang_bonus_total",
  "match_strength_pct",
  "base_pct",
  "final_pct",
  "jinang_delta_pct",
  "compressed_jinang_delta_pct",
  "rho_discount",
  "vp_effect",
  "multiplier",
  "wtp_multiplier",
  "wtp_mult_compressed",
  "wtp_vp_effect",
  "bonus",
  "jinang_match_strength",
  "match_strength"
]);

const DEFERRED_VP_SCORE_KEY_SET = new Set([
  "vp_score",
  "vp_scores",
  "VPscore",
  "coverage",
  "generalizability",
  "effectiveness",
  "C",
  "G",
  "E",
  "Eadj",
  "E_raw",
  "raw_C",
  "raw_G",
  "raw_E"
]);

function shouldStripDeferredKey(key) {
  const text = String(key || "").trim();
  if (!text) return false;
  if (DEFERRED_SENSITIVE_KEY_SET.has(text)) return true;
  const lower = text.toLowerCase();
  if (lower.includes("margin")) return true;
  if (lower.includes("share")) return true;
  if (lower === "gm" || lower.startsWith("gm_") || lower.endsWith("_gm") || lower.includes("gmmax")) return true;
  if (lower.includes("wtp")) return true;
  if (lower.includes("premium") || lower.includes("bonus")) return true;
  if (lower.includes("pct") || lower.includes("percent")) return true;
  if (lower.includes("multiplier") || lower.includes("vp_effect") || lower.includes("rho_discount")) return true;
  return false;
}

function shouldStripDeferredVpScoreKey(key) {
  const text = String(key || "").trim();
  if (!text) return false;
  if (DEFERRED_VP_SCORE_KEY_SET.has(text)) return true;
  const lower = text.toLowerCase();
  return lower === "vp_score"
    || lower === "vp_scores"
    || lower === "vpscore"
    || lower === "coverage"
    || lower === "generalizability"
    || lower === "effectiveness"
    || lower === "c"
    || lower === "g"
    || lower === "e"
    || lower === "eadj"
    || lower === "e_raw"
    || lower === "raw_c"
    || lower === "raw_g"
    || lower === "raw_e";
}

function stripDeferredSensitiveFields(value) {
  if (Array.isArray(value)) {
    return value.map((item) => stripDeferredSensitiveFields(item));
  }
  if (!value || typeof value !== "object") return value;
  const next = {};
  for (const [key, raw] of Object.entries(value)) {
    if (shouldStripDeferredKey(key)) continue;
    next[key] = stripDeferredSensitiveFields(raw);
  }
  return next;
}

function stripDeferredVpScoreFields(value) {
  if (Array.isArray(value)) {
    return value.map((item) => stripDeferredVpScoreFields(item));
  }
  if (!value || typeof value !== "object") return value;
  const next = {};
  for (const [key, raw] of Object.entries(value)) {
    if (shouldStripDeferredVpScoreKey(key)) continue;
    next[key] = stripDeferredVpScoreFields(raw);
  }
  return next;
}

function hideDeferredRound1Fields(payload) {
  const src = payload && typeof payload === "object" ? payload : {};
  const next = stripDeferredVpScoreFields(stripDeferredSensitiveFields(src));

  if (next.jinang && typeof next.jinang === "object") {
    const nextJinang = { ...next.jinang };
    next.jinang = nextJinang;
  }

  if (next.settle && typeof next.settle === "object" && Array.isArray(next.settle.settlements)) {
    next.settle = {
      ...next.settle,
      settlements: next.settle.settlements.map((item) => {
        const { match_tier, ...restItem } = item || {};
        return restItem;
      })
    };
  }

  return next;
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
  return Number((0.755 + clamped * 0.07).toFixed(3));
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
          SAM_billion: scaleStoredMoney(base?.SAM_billion) || 0,
          SAM_billion_raw: Number(base?.SAM_billion || 0)
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
          WTPref: scaleStoredMoney(WTPref) || 0,
          WTPref_raw: Number(WTPref || 0),
          lambda_G: roundForLog(lambdaG),
          lambda_Eadj: roundForLog(lambdaE),
          wtp_mult_raw: roundForLog(wtpMultiplier),
          wtp_mult_compressed: roundForLog(compressedMult),
          WTPref_adjusted: scaleStoredMoney(WTPadj) || 0,
          WTPref_adjusted_raw: Number(WTPadj || 0)
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
        WTPref: scaleStoredMoney(outcome.WTPref) || 0,
        WTPref_raw: Number(outcome.WTPref || 0),
        WTPref_adjusted: scaleStoredMoney(outcome.WTPadj) || 0,
        WTPref_adjusted_raw: Number(outcome.WTPadj || 0),
        vp_text: vpText
      }
    },
    {
      stage: "r1_wtp_adj_final",
      params: {
        is_final: true,
        WTPref: scaleStoredMoney(outcome.WTPref) || 0,
        WTPref_raw: Number(outcome.WTPref || 0),
        wtp_mult_raw: roundForLog(outcome.wtp_multiplier),
        wtp_mult_compressed: roundForLog(outcome.wtp_mult_compressed),
        WTPref_adjusted: scaleStoredMoney(outcome.WTPadj) || 0,
        WTPref_adjusted_raw: Number(outcome.WTPadj || 0)
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

async function getDefaultTeamLeaderMemberId(teamId) {
  const rows = await runSql(`
    SELECT id
    FROM team_members
    WHERE team_id = ${sqlQuote(teamId)}
    ORDER BY member_index ASC, joined_at ASC, id ASC
    LIMIT 1;
  `);
  return String(rows[0]?.id || "").trim() || null;
}

function shouldAssignLeaderForStatus(status) {
  return ["forming", "phase1", "phase2", "phase3", "phase4", "frozen"].includes(String(status || ""));
}

async function assignRound1LeaderIfNeeded(teamId) {
  const team = await getTeam(teamId);
  if (!team) return null;
  if (String(team.leader_member_id || "").trim()) return team;
  const defaultLeaderId = await getDefaultTeamLeaderMemberId(teamId);
  if (!defaultLeaderId) return team;
  return setTeamLeader(teamId, defaultLeaderId);
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
    const existing = await readSubmission(teamId, memberId);
    if (!existing && ["phase2", "phase3", "phase4", "frozen"].includes(String(team.status || ""))) {
      return makeResponse(409, {
        ok: false,
        error: "submission_closed",
        message: "团队已被推进，个人战略提交已关闭。",
        ...buildLeaderMeta(team, memberId)
      });
    }
    if (existing) {
      const submittedCount = await countTeamSubmissions(teamId);
      const teamSize = Number(team.team_size || 0);
      return makeResponse(200, {
        ok: true,
        idempotent: true,
        submission_id: existing.id,
        personal_gm_max: Number(existing.personal_gm_max),
        submitted_count: submittedCount,
        team_size: teamSize,
        team_status_updated_to_phase2: false,
        ...buildLeaderMeta(team, memberId)
      });
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
    const inserted = await runSql(`
      INSERT INTO member_submissions (
        id, member_id, team_id, grid_id, architecture, channel_pref, vp_draft, personal_gm_max, submitted_at
      )
      SELECT
        ${sqlQuote(id)},
        ${sqlQuote(memberId)},
        ${sqlQuote(teamId)},
        ${sqlQuote(gridId)},
        ${sqlQuote(normalizeArchitecture(architecture))},
        NULL,
        ${sqlQuote(vpDraft)},
        ${Number(calc.gmMax)},
        ${sqlQuote(now)}
      WHERE EXISTS (
        SELECT 1 FROM teams
        WHERE id = ${sqlQuote(teamId)}
          AND status IN ('forming', 'phase1')
      )
      ON CONFLICT (team_id, member_id) DO NOTHING
      RETURNING id, personal_gm_max;
    `);

    let actualId = id;
    let actualGmMax = Number(calc.gmMax);
    if (Array.isArray(inserted) && inserted.length > 0) {
      actualId = inserted[0].id;
      actualGmMax = Number(inserted[0].personal_gm_max);
    } else {
      const winner = await readSubmission(teamId, memberId);
      if (!winner) {
        return makeResponse(409, {
          ok: false,
          error: "submission_closed",
          message: "团队已被推进，个人战略提交已关闭。",
          ...buildLeaderMeta(await getTeam(teamId), memberId)
        });
      }
      actualId = winner.id;
      actualGmMax = Number(winner.personal_gm_max);
    }

    const submittedCount = await countTeamSubmissions(teamId);
    const teamSize = Number(team.team_size || 0);
    const phase2Result = await advanceTeamStatusToPhase2IfAllSubmitted(teamId);
    const statusUpdated = phase2Result.updated === true;
    if (statusUpdated) {
      await assignRound1LeaderIfNeeded(teamId);
    }

    const updatedTeam = statusUpdated ? await getTeam(teamId) : team;

    return makeResponse(200, {
      ok: true,
      submission_id: actualId,
      personal_gm_max: actualGmMax,
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

function sanitizeStudentVpConfirmationResponse(payload) {
  const src = payload && typeof payload === "object" ? payload : {};
  const fields = normalizeConfirmedFieldsPayload(src.fields);
  return {
    ok: src.ok === true,
    feedback: String(src.feedback || "").trim(),
    confirmedAt: String(src.confirmedAt || "").trim(),
    fields,
    session_id: String(src.session_id || "").trim() || null,
    vp_result: buildConfirmedVpResult(fields)
  };
}

function buildVpTextFromConfirmedFields(fields) {
  const src = normalizeConfirmedFieldsPayload(fields);
  return [
    src.who_raw ? `WHO：${src.who_raw}` : "",
    src.pain_raw ? `PAIN：${src.pain_raw}` : "",
    src.how_raw ? `HOW：${src.how_raw}` : "",
    src.alternative_raw && src.alternative_raw !== "未明确" ? `替代方案对比：${src.alternative_raw}` : "",
    src.boundary_raw && src.boundary_raw !== "未明确" ? `BOUNDARY：${src.boundary_raw}` : ""
  ].filter(Boolean).join("\n");
}

function normalizeSimplifiedVpFields(payload = {}) {
  return normalizeConfirmedFieldsPayload({
    who_raw: payload.who ?? payload.who_raw,
    pain_raw: payload.pain ?? payload.pain_raw,
    how_raw: payload.how ?? payload.how_raw,
    alternative_raw: payload.alternative ?? payload.alternative_raw,
    boundary_raw: payload.boundary ?? payload.boundary_raw
  });
}

function readSimplifiedVpPayload(payload = {}) {
  const fields = normalizeSimplifiedVpFields(payload);
  const hasSimplifiedFields = Boolean(
    String(payload.who ?? "").trim() ||
    String(payload.pain ?? "").trim() ||
    String(payload.how ?? "").trim()
  );
  return {
    hasSimplifiedFields,
    fields,
    vpText: String(payload.vpText || payload.vp_text || "").trim() || buildVpTextFromConfirmedFields(fields)
  };
}

function parseFeedbackJson(raw) {
  const text = String(raw || "").trim();
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    const parsed = JSON.parse(match[0]);
    const feedback = {
      good: String(parsed?.good || "").trim(),
      improve: String(parsed?.improve || "").trim(),
      suggest: String(parsed?.suggest || "").trim()
    };
    return feedback.good && feedback.improve && feedback.suggest ? feedback : null;
  } catch (_) {
    return null;
  }
}

function buildFallbackDraftFeedback(fields) {
  const src = normalizeConfirmedFieldsPayload(fields);
  const who = src.who_raw;
  const pain = src.pain_raw;
  const how = src.how_raw;
  const mismatch = /老人|养老|长者/.test(who) && /上班|加班|白领|通勤|职场|年轻/.test(pain);
  return {
    good: who && pain ? `初稿已经把目标客户和痛点分开表达，"${sliceChars(who, 24)}"这个方向有继续打磨的空间。` : "选题方向有潜力，已经开始按 WHO / PAIN / HOW 拆分价值主张。",
    improve: mismatch
      ? "WHO 和 PAIN 之间存在不一致：目标客户像是老人或养老场景，但痛点描述更接近年轻上班族，需要先统一用户画像。"
      : `最需要改进的是${how && countChars(how) >= 20 ? "把 WHO 和 PAIN 写得更具体" : "HOW 的因果链"}，现在读者还不容易判断具体场景和解决机制是否真正对应。`,
    suggest: "下一步请补上一句具体触发场景，并说明你的方案通过什么机制缓解这个痛点。"
  };
}

function fitFinalVpComment(text, min = 150, max = 250) {
  const plain = String(text || "").replace(/\s+/g, " ").trim();
  if (!plain) return "";
  if (countChars(plain) <= max && countChars(plain) >= min) return plain;
  if (countChars(plain) > max) {
    const clipped = sliceChars(plain, max);
    return /[。！？]$/.test(clipped) ? clipped : `${clipped}。`;
  }
  return plain;
}

async function generateDraftVpFeedback({ teamId, memberId, gridLabel, archLabel, fields }) {
  const src = normalizeConfirmedFieldsPayload(fields);
  const prompt = [
    "你是一位产品战略顾问，正在审阅一份价值主张初稿。",
    "",
    "团队信息：",
    `- 目标市场：${gridLabel}`,
    `- 产品架构：${archLabel}`,
    "",
    "学生初稿：",
    `WHO：${src.who_raw}`,
    `PAIN：${src.pain_raw}`,
    `HOW：${src.how_raw}`,
    src.alternative_raw && src.alternative_raw !== "未明确" ? `替代方案对比：${src.alternative_raw}` : "",
    src.boundary_raw && src.boundary_raw !== "未明确" ? `边界条件：${src.boundary_raw}` : "",
    "",
    "请给出结构化反馈，严格按以下 JSON 格式输出，不要有任何其他内容：",
    "",
    "{",
    "  \"good\": \"1-2 句话，指出初稿中写得最好的部分，引用原文中的具体措辞\",",
    "  \"improve\": \"1-2 句话，指出最需要改进的一个问题，说清楚为什么有问题\",",
    "  \"suggest\": \"1 句话，给出一个具体的改进方向，告诉学生下一步可以怎么改\"",
    "}",
    "",
    "约束：",
    "- 不要重写学生的 VP，只给反馈",
    "- 不要给出产品建议或解决方案",
    "- 反馈针对 VP 的写法质量，不评判市场选择对错",
    "- 重点检查 WHO 是否足够具体、PAIN 是否有具体触发情境、HOW 是否有因果链",
    "- 如果 WHO/PAIN/HOW 之间逻辑不一致，优先指出",
    "- good 部分要真诚，不要为了鼓励而夸"
  ].filter(Boolean).join("\n");

  const messages = [
    { role: "system", content: "你是 EMBA 课程中的产品战略顾问。只输出合法 JSON。" },
    { role: "user", content: prompt }
  ];
  try {
    const raw = await withLlmLogging({
      caller: "teamRoutes.round1VpFeedback",
      teamId,
      memberId,
      messages
    }, () => chatCompletion(messages, {
      temperature: 0.2,
      max_tokens: 500,
      timeoutMs: VP_LLM_TIMEOUT_MS
    }));
    return parseFeedbackJson(raw) || buildFallbackDraftFeedback(src);
  } catch (err) {
    console.warn("[round1/vp-feedback] fallback:", err?.message || err);
    return buildFallbackDraftFeedback(src);
  }
}

async function generateFinalVpComment({ teamId, memberId, fields, scores }) {
  const src = normalizeConfirmedFieldsPayload(fields);
  const scoreSet = scores && typeof scores === "object" ? scores : {};
  const prompt = [
    "你是一位产品战略顾问，请为以下价值主张撰写一段简短评语。",
    "",
    "学生提交的 VP：",
    `WHO：${src.who_raw}`,
    `PAIN：${src.pain_raw}`,
    `HOW：${src.how_raw}`,
    "",
    "评分结果（仅供你参考，不要在评语中提及具体分数）：",
    `- 客户描述覆盖度 C = ${scoreSet.C}（满分 5）`,
    `- 痛点泛化能力 G = ${scoreSet.G}（满分 5）`,
    `- 方案有效性 E = ${scoreSet.E}（满分 5）`,
    "",
    "请用 150-250 字中文写一段评语，包含：",
    "1. 对初稿的整体判断（一句话）",
    "2. 最突出的优点（引用原文中的具体措辞）",
    "3. 最需要改进的地方和改进方向",
    "4. 对下一轮（产品研发阶段）的一句提醒",
    "",
    "约束：",
    "- 不要提及任何数字分数",
    "- 不要给出产品建议或解决方案",
    "- 语气专业但温和"
  ].join("\n");
  const messages = [
    { role: "system", content: "你是 EMBA 课程中的产品战略顾问。输出一段中文评语，不要列分数。" },
    { role: "user", content: prompt }
  ];
  try {
    const raw = await withLlmLogging({
      caller: "teamRoutes.round1VpSubmitComment",
      teamId,
      memberId,
      messages
    }, () => chatCompletion(messages, {
      temperature: 0.3,
      max_tokens: 500,
      timeoutMs: VP_LLM_TIMEOUT_MS
    }));
    const cleaned = sanitizeGeneratedFeedback(raw);
    return fitFinalVpComment(cleaned, 150, 250);
  } catch (err) {
    console.warn("[round1/vp-submit] feedback fallback:", err?.message || err);
    return fitFinalVpComment(buildFallbackVpFeedback({ vpText: buildVpTextFromConfirmedFields(src), confirmedFields: src, scores }), 150, 250);
  }
}

function buildStudentJinangMatch(previewMarketJinang) {
  const items = Array.isArray(previewMarketJinang?.items) ? previewMarketJinang.items : [];
  return items.map((item) => ({
    name: String(item?.name || item?.id || "").trim(),
    tier: matchStrengthToTier(item?.match_strength)
  })).filter((item) => item.name);
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
      { temperature: 0.2, max_tokens: 500, timeoutMs: VP_LLM_TIMEOUT_MS }
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
    if (!String(team.leader_member_id || "").trim() && shouldAssignLeaderForStatus(team.status)) {
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
    if (!String(team.leader_member_id || "").trim() && shouldAssignLeaderForStatus(team.status)) {
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

function pendingRound1SubmissionMembers(team, submissions) {
  const submittedIds = new Set(
    (Array.isArray(submissions) ? submissions : [])
      .filter((item) => item?.submitted)
      .map((item) => String(item.member_id || "").trim())
  );
  return (Array.isArray(team?.members) ? team.members : [])
    .filter((member) => !submittedIds.has(String(member.id || "").trim()))
    .map((member) => ({
      id: member.id,
      name: member.member_name || member.name || member.id
    }));
}

async function forceAdvancePhase1(teamId, body = {}) {
  try {
    const memberId = readRequesterMemberId(body);
    let team = await getTeam(teamId);
    if (!team) return makeResponse(404, { ok: false, error: "team not found" });
    if (!String(team.leader_member_id || "").trim()) {
      team = await assignRound1LeaderIfNeeded(teamId) || team;
    }
    await assertMemberInTeam(teamId, memberId);
    const leaderMeta = buildLeaderMeta(team, memberId);
    if (!leaderMeta.is_leader) {
      return makeOnlyLeaderResponse(team, memberId);
    }

    const submissions = await readTeamSubmissions(teamId);
    const skippedMembers = pendingRound1SubmissionMembers(team, submissions);
    const fromStatus = String(team.status || "forming");
    if (!skippedMembers.length) {
      const normal = await advanceTeamStatusToPhase2IfAllSubmitted(teamId);
      const updatedTeam = await getTeam(teamId);
      return makeResponse(200, {
        ok: true,
        team_id: teamId,
        force_gate: "round1_strategy",
        force_advanced: false,
        team_status: normal.team_status || updatedTeam?.status || "phase2",
        skipped_members: [],
        ...buildLeaderMeta(updatedTeam || team, memberId)
      });
    }

    const statusResult = await advanceTeamStatusToPhase2IfAllSubmitted(teamId, { force: true });
    team = await getTeam(teamId) || team;
    await logTeacherAction({
      action: "force_advance_by_leader",
      teamId,
      memberId,
      details: {
        gate: "round1_strategy",
        from: fromStatus,
        to: statusResult.team_status || "phase2",
        force_advanced_by: memberId,
        force_advanced_at: nowIso(),
        skipped_members: skippedMembers
      }
    });

    return makeResponse(200, {
      ok: true,
      team_id: teamId,
      force_gate: "round1_strategy",
      force_advanced: true,
      team_status: statusResult.team_status || "phase2",
      skipped_members: skippedMembers,
      ...buildLeaderMeta(team, memberId)
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

async function generateAndPersistPhase4VpFeedback({
  teamId,
  latestSession,
  team,
  r1,
  confirmedFields
}) {
  const jobKey = String(teamId || "").trim();
  const startedAt = Date.now();
  let generated = false;
  try {
    const vpText = String(latestSession?.pmfScore?._vp_sentence || team?.final_vp_text || "").trim();
    const feedback = await generateVpFeedback({
      vpText,
      confirmedFields,
      scores: {
        C: clipScore(r1.C, 1, 5),
        G: clipScore(r1.G, 1, 5),
        E: clipScore(r1.E_raw, 1, 5),
        Eadj: clipScore(r1.Eadj, 1, 5),
        VPscore: clipScore(r1.VPscore, 1, 5)
      },
      details: null,
      gridLabel: resolvePhase3Strategy(team.final_grid_id, team.final_architecture).cell_label,
      archLabel: toArchitecturePromptLabel(team.final_architecture),
      teamId,
      memberId: latestSession?.pmfScore?._member_id || null,
      timeoutMs: VP_LLM_TIMEOUT_MS
    });
    if (feedback) {
      await persistVpFeedback(teamId, feedback, latestSession?.pmfScore?._member_id || "").catch(() => {});
      generated = true;
    }
  } catch (err) {
    console.warn("[round1/vp-feedback-bg] failed:", err?.message || err);
  } finally {
    vpFeedbackJobs.delete(jobKey);
    console.log("[round1/vp-feedback-bg-timing]", JSON.stringify({
      team_id: teamId,
      generated,
      llm_feedback_ms: Date.now() - startedAt
    }));
  }
}

function schedulePhase4VpFeedbackGeneration(args) {
  const jobKey = String(args?.teamId || "").trim();
  if (!jobKey || !args?.confirmedFields) return false;
  if (vpFeedbackJobs.has(jobKey)) return true;
  vpFeedbackJobs.add(jobKey);
  setTimeout(() => {
    generateAndPersistPhase4VpFeedback(args);
  }, 0);
  return true;
}

async function runFreezePostCommitRefresh({ teamId }) {
  const jobKey = String(teamId || "").trim();
  const startedAt = Date.now();
  const timing = {};
  let ok = false;
  try {
    const cacheStartedAt = Date.now();
    await refreshCachedTeamRound2State(jobKey);
    timing.r2_cache_refresh_ms = Date.now() - cacheStartedAt;

    const phase4StartedAt = Date.now();
    const phase4 = await buildPhase4Data(jobKey);
    timing.phase4_recompute_ms = Date.now() - phase4StartedAt;
    ok = phase4?.ok === true;
    if (!ok) {
      console.warn("[round1/freeze-bg] phase4 refresh returned non-ok:", {
        team_id: jobKey,
        status: phase4?.status,
        error: phase4?.error
      });
    }
  } catch (err) {
    console.warn("[round1/freeze-bg] failed:", {
      team_id: jobKey,
      error: err?.message || String(err)
    });
  } finally {
    freezeRefreshJobs.delete(jobKey);
    console.log("[round1/freeze-bg-timing]", JSON.stringify({
      team_id: jobKey,
      ok,
      ...timing,
      total_ms: Date.now() - startedAt
    }));
  }
}

function scheduleFreezePostCommitRefresh(teamId) {
  const jobKey = String(teamId || "").trim();
  if (!jobKey) return false;
  if (freezeRefreshJobs.has(jobKey)) return true;
  freezeRefreshJobs.add(jobKey);
  setTimeout(() => {
    runFreezePostCommitRefresh({ teamId: jobKey });
  }, 0);
  return true;
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

async function round1VpFeedbackApi(body) {
  try {
    const payload = body || {};
    const teamId = String(payload.team_id || payload.teamId || "").trim();
    const memberId = String(payload.member_id || payload.memberId || "").trim();
    if (!teamId || !memberId) {
      return makeResponse(400, { ok: false, error: "team_id/member_id required" });
    }
    await assertMemberInTeam(teamId, memberId);
    const team = await getTeam(teamId);
    if (!team) return makeResponse(404, { ok: false, error: "team not found" });

    const fields = normalizeSimplifiedVpFields(payload);
    if (!fields.who_raw || !fields.pain_raw || !fields.how_raw) {
      return makeResponse(400, { ok: false, error: "WHO/PAIN/HOW required" });
    }

    const draft = await readRound1TeamDraft(teamId).catch(() => null);
    const gridId = String(payload.grid_id || payload.gridId || draft?.grid_id || team.final_grid_id || "").trim();
    const architecture = normalizeArchitecture(payload.architecture || draft?.architecture || team.final_architecture || "Experience");
    if (!gridId || !architecture) {
      return makeResponse(400, { ok: false, error: "grid_id and architecture required" });
    }

    const strategy = resolvePhase3Strategy(gridId, architecture);
    const feedback = await generateDraftVpFeedback({
      teamId,
      memberId,
      gridLabel: strategy.cell_label,
      archLabel: toArchitecturePromptLabel(architecture),
      fields
    });

    return makeResponse(200, { ok: true, feedback });
  } catch (e) {
    console.error("[round1/vp-feedback] error:", e);
    return makeResponse(400, { ok: false, error: e.message || "vp feedback failed" });
  }
}

async function confirmAndScoreVp(body) {
  try {
    const payload = body || {};
    const teamId = String(payload.teamId || payload.team_id || "").trim();
    const memberId = String(payload.memberId || payload.member_id || "").trim();
    const simplified = readSimplifiedVpPayload(payload);
    const hasSimplifiedPayload = simplified.hasSimplifiedFields || payload.accepted_feedback !== undefined;
    const confirmedFields = hasSimplifiedPayload
      ? simplified.fields
      : normalizeConfirmedFieldsPayload(payload.confirmedFields);
    const vpText = String(payload.vpText || payload.vp_text || "").trim()
      || (hasSimplifiedPayload ? simplified.vpText : "");

    if (!teamId) {
      return makeResponse(400, { ok: false, error: "缺少 teamId" });
    }
    const permission = await ensureLeaderPermission(teamId, memberId);
    if (!permission.ok) return permission.response;
    const team = permission.team;
    const draft = await readRound1TeamDraft(teamId).catch(() => null);
    const gridId = String(payload.grid_id || payload.gridId || draft?.grid_id || team.final_grid_id || "").trim();
    const architecture = normalizeArchitecture(payload.architecture || draft?.architecture || team.final_architecture || "");
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

    const existing = await readPersistedPhase3Confirmation(
      teamId,
      memberId,
      String(team?.leader_member_id || "").trim()
    ).catch(() => null);
    if (existing?.confirmed_at && existing?.fields) {
      const previewMarketJinang = await getPreviewMarketJinang(teamId, gridId, architecture).catch(() => null);
      const frozenResponse = {
        status: "confirmed",
        feedback_text: String(existing.feedback || "").trim(),
        jinang_match: buildStudentJinangMatch(previewMarketJinang),
        confirmed_at: existing.confirmed_at,
        fields: existing.fields
      };
      return makeResponse(200, hasSimplifiedPayload
        ? frozenResponse
        : sanitizeStudentVpConfirmationResponse({
            ok: true,
            feedback: existing.feedback || "",
            confirmedAt: existing.confirmed_at,
            fields: existing.fields,
            session_id: null,
            vp_result: buildConfirmedVpResult(existing.fields)
          }));
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
    const feedback = hasSimplifiedPayload
      ? await generateFinalVpComment({
        teamId,
        memberId,
        fields: confirmedFields,
        scores: normalizedScores
      })
      : await generateVpFeedback({
      vpText: vpText || buildVpTextFromConfirmedFields(confirmedFields),
      confirmedFields,
      scores: normalizedScores,
      details: result?.details || null,
      gridLabel: resolvePhase3Strategy(gridId, architecture).cell_label,
      archLabel: toArchitecturePromptLabel(architecture),
      teamId,
      memberId,
      timeoutMs: VP_LLM_TIMEOUT_MS
    });
    const persisted = await persistConfirmedVpResult({
      teamId,
      memberId,
      vpText: vpText || buildVpTextFromConfirmedFields(confirmedFields),
      confirmedFields,
      scores: normalizedScores,
      confirmedAt,
      feedback
    });
    // 冻结 WTP 值到 teams 表，后续 phase4 直接读取不重算。
    await runSql(`
      UPDATE teams
      SET final_wtp_multiplier = ${Number(round1Outcome.wtp_multiplier)},
          final_wtp_adj = ${Number(round1Outcome.WTPadj)},
          final_wtp_ref = ${Number(round1Outcome.WTPref)},
          final_wtp_vp_effect = ${Number(round1Outcome.wtp_vp_effect)},
          final_jinang_wtp_bonus = ${Number(round1Outcome.jinang_wtp_bonus)},
          final_rho_c = ${Number(round1Outcome.rho_C)},
          final_vp_c = ${Number(normalizedScores.C)},
          final_vp_g = ${Number(normalizedScores.G)},
          final_vp_e_raw = ${Number(normalizedScores.E)},
          final_vp_e_adj = ${Number(normalizedScores.Eadj)},
          final_vp_scores = ${sqlQuote(JSON.stringify(normalizedScores))}
      WHERE id = ${sqlQuote(teamId)};
    `);
    await recordVpIteration({
      teamId,
      sessionId: persisted.sessionId,
      memberId,
      trigger: "confirm_score",
      vpAfter: vpText || buildVpTextFromConfirmedFields(confirmedFields),
      scores: normalizedScores
    });
    await saveRound1TeamDraft(teamId, memberId, {
      grid_id: gridId,
      architecture,
      vp_text: vpText || buildVpTextFromConfirmedFields(confirmedFields)
    }).catch(() => {});

    if (hasSimplifiedPayload) {
      return makeResponse(200, {
        status: "confirmed",
        feedback_text: feedback || "",
        jinang_match: buildStudentJinangMatch(previewMarketJinang),
        confirmed_at: confirmedAt,
        fields: confirmedFields
      });
    }

    return makeResponse(200, sanitizeStudentVpConfirmationResponse({
      ok: true,
      feedback: feedback || "",
      confirmedAt,
      fields: confirmedFields,
      session_id: persisted.sessionId,
      vp_result: buildConfirmedVpResult(confirmedFields)
    }));
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
    const details = payload.details && typeof payload.details === "object"
      ? payload.details
      : null;

    if (!confirmedFields || !scores) {
      return makeResponse(400, { ok: false, error: "缺少必要参数" });
    }

    const feedback = await generateVpFeedback({
      vpText,
      confirmedFields,
      scores,
      details,
      gridLabel,
      archLabel,
      teamId,
      memberId,
      timeoutMs: VP_LLM_TIMEOUT_MS
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
  const timingStartedAt = Date.now();
  const timing = {};
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
    const persistedConfirmation = await readPersistedPhase3Confirmation(
      teamId,
      memberId,
      String(team?.leader_member_id || "").trim()
    ).catch(() => null);
    const vpSummaryStartedAt = Date.now();
    const vpSummary = await summarizeVpFromConversation({
      gridId,
      architecture: arch,
      sessionMessages: session?.messages || [],
      payloadConversation: payload.conversation_history || [],
      payloadVpResult: payload.vp_result || null
    });
    timing.vp_summary_ms = Date.now() - vpSummaryStartedAt;
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

    const vpScoringStartedAt = Date.now();
    const persistedScores = scorerScoresToApi(persistedConfirmation?.scores || null);
    const payloadScores = normalizeVpScoresInput(payload.scores);
    const sessionScores = vpResultToApiScores(session?.pmfScore || null);
    const finalScores = persistedScores || payloadScores || sessionScores;
    if (!finalScores) {
      return makeResponse(409, {
        ok: false,
        error: "vp scores missing; submit and score the value proposition before finalizing"
      });
    }
    const confirmedFields = payload.confirmed_fields && typeof payload.confirmed_fields === "object"
      ? (() => {
          const normalized = normalizeConfirmedFieldsPayload(payload.confirmed_fields);
          return Object.values(normalized).some((value) => String(value || "").trim()) ? normalized : null;
        })()
      : (persistedConfirmation?.fields || vpResultToConfirmedFields(payload.vp_result || null, finalVpText));
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
    timing.vp_scoring_ms = Date.now() - vpScoringStartedAt;

    const freezePersistStartedAt = Date.now();
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
    timing.freeze_persist_ms = Date.now() - freezePersistStartedAt;

    const jinangStartedAt = Date.now();
    const settle = await settleAllJinang(teamId);
    timing.jinang_settlement_ms = Date.now() - jinangStartedAt;
    const marketJinangSummary = summarizeEligibleMarketSettlements(settle?.settlements || []);
    const engineStartedAt = Date.now();
    const r1 = buildRound1Outcome(gridId, finalArch, engineVpScores, marketJinangSummary, {
      teamId,
      sessionId,
      vpText: finalVpText
    });
    timing.round1_engine_ms = Date.now() - engineStartedAt;
    scheduleFinalRound1Stages(
      { teamId, sessionId, source: "web" },
      r1,
      {
        source_iteration: payload.source_iteration,
        used_best_iteration: payload.used_best_iteration === true,
        vp_text: finalVpText
      }
    );

    const phase4PersistStartedAt = Date.now();
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
    timing.phase4_persist_ms = Date.now() - phase4PersistStartedAt;
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

    console.log("[round1/finalize-timing]", JSON.stringify({
      team_id: teamId,
      ...timing,
      total_ms: Date.now() - timingStartedAt
    }));
    return makeResponse(200, {
      ok: true,
      team_id: teamId,
      status: "phase4",
      r1_result: sanitizeStudentR1Result(r1),
      vp_summary: finalVpSummary,
      settle: sanitizeStudentSettle(settle)
    });
  } catch (e) {
    console.warn("[round1/finalize-timing]", JSON.stringify({
      team_id: teamId,
      ...timing,
      total_ms: Date.now() - timingStartedAt,
      error: e.message
    }));
    return makeResponse(400, { ok: false, error: e.message });
  }
}

async function finalizeRound1FromDraftForTeacher(teamId, options = {}) {
  try {
    const team = await getTeam(teamId);
    if (!team) return makeResponse(404, { ok: false, error: "team not found" });
    if (team.final_grid_id && team.final_architecture && String(team.status || "") === "frozen") {
      return makeResponse(200, {
        ok: true,
        team_id: teamId,
        already_finalized: true,
        auto_finalized_from_draft: false
      });
    }

    const draft = await readRound1TeamDraft(teamId).catch(() => null);
    const gridId = String(draft?.grid_id || team.final_grid_id || "").trim();
    const architectureInput = String(draft?.architecture || team.final_architecture || "").trim();
    if (!gridId || !architectureInput) {
      return makeResponse(409, {
        ok: false,
        error: "round1_draft_missing",
        message: "该队 R1 未定稿且没有可用草稿，无法强推进入第二轮"
      });
    }
    const architecture = normalizeArchitecture(architectureInput);

    const leaderId = String(team.leader_member_id || draft?.updated_by || team.members?.[0]?.id || "").trim();
    if (!leaderId) {
      return makeResponse(409, {
        ok: false,
        error: "leader_missing",
        message: "该队没有成员，无法按草稿自动定稿"
      });
    }
    if (!String(team.leader_member_id || "").trim()) {
      await setTeamLeader(teamId, leaderId);
    }

    const latestSession = await getLatestPhase3SessionRecord(teamId).catch(() => null);
    const sessionId = latestSession?.sessionId || `teacher-auto-finalize:${teamId}`;
    const persistedConfirmation = await readPersistedPhase3Confirmation(
      teamId,
      leaderId,
      String(team.leader_member_id || "").trim()
    ).catch(() => null);
    const persistedScores = scorerScoresToApi(persistedConfirmation?.scores || null);
    const vpScores = buildPersistedVpScores(
      persistedScores?.coverage ?? 3,
      persistedScores?.generalizability ?? 3,
      persistedScores?.effectiveness ?? 3
    );
    const engineVpScores = {
      C: vpScores.C ?? 3,
      G: vpScores.G ?? 3,
      E: vpScores.E ?? 3
    };
    const finalVpText = String(
      persistedConfirmation?.vp_text ||
      draft?.vp_text ||
      team.final_vp_text ||
      "教师强推：按当前 R1 草稿定稿"
    ).trim();
    const confirmedFields = persistedConfirmation?.fields || vpResultToConfirmedFields(null, finalVpText);
    const finalVpSummary = normalizeVpSummaryPayload(team.final_vp_summary, {
      fallbackText: finalVpText,
      confirmedFields
    });

    await runTransaction(async (sql) => {
      await sql(`
        UPDATE teams
        SET status = 'frozen',
            final_grid_id = ${sqlQuote(gridId)},
            final_architecture = ${sqlQuote(architecture)},
            final_architecture_source = ${sqlQuote("teacher_draft")},
            final_vp_text = ${sqlQuote(finalVpText)},
            final_vp_summary = ${sqlQuote(JSON.stringify(finalVpSummary))}::jsonb,
            final_vp_scores = ${sqlQuote(JSON.stringify(vpScores))},
            final_vp_c = ${Number(engineVpScores.C)},
            final_vp_g = ${Number(engineVpScores.G)},
            final_vp_e_raw = ${Number(engineVpScores.E)}
        WHERE id = ${sqlQuote(teamId)};
      `);
      await sql(`
        INSERT INTO round1_team_drafts (
          team_id, grid_id, architecture, vp_text, updated_by, updated_at
        ) VALUES (
          ${sqlQuote(teamId)},
          ${sqlQuote(gridId)},
          ${sqlQuote(architecture)},
          ${sqlQuote(finalVpText)},
          ${sqlQuote(leaderId)},
          ${sqlQuote(new Date().toISOString())}
        )
        ON CONFLICT (team_id) DO UPDATE SET
          grid_id = EXCLUDED.grid_id,
          architecture = EXCLUDED.architecture,
          vp_text = EXCLUDED.vp_text,
          updated_by = EXCLUDED.updated_by,
          updated_at = EXCLUDED.updated_at;
      `);
    });

    const settle = await settleAllJinang(teamId);
    const marketJinangSummary = summarizeEligibleMarketSettlements(settle?.settlements || []);
    const r1 = buildRound1Outcome(gridId, architecture, engineVpScores, marketJinangSummary, {
      teamId,
      sessionId,
      vpText: finalVpText
    });

    await runTransaction(async (sql) => {
      await sql(`
        UPDATE teams
        SET final_sam = ${Number(r1.SAM_billion)},
            final_wtp_adj = ${Number(r1.WTPadj)},
            final_wtp_ref = ${Number(r1.WTPref)},
            final_wtp_vp_effect = ${Number(r1.wtp_vp_effect)},
            final_jinang_wtp_bonus = ${Number(r1.jinang_wtp_bonus)},
            final_vp_c = ${Number(r1.C)},
            final_vp_g = ${Number(r1.G)},
            final_vp_e_raw = ${Number(r1.E_raw)},
            final_vp_e_adj = ${Number(r1.Eadj)},
            final_rho_c = ${Number(r1.rho_C)},
            final_wtp_multiplier = ${Number(r1.wtp_multiplier)}
        WHERE id = ${sqlQuote(teamId)};
      `);
    });
    await logTeacherAction({
      action: "teacher_auto_finalize_round1_from_draft",
      teamId,
      memberId: leaderId,
      details: {
        source: String(options.source || "teacher_console"),
        grid_id: gridId,
        architecture,
        used_fallback_scores: !persistedScores,
        message: "该队 R1 未定稿，教师强推已按当前草稿定稿后进入第二轮"
      }
    });
    try {
      scheduleFinalRound1Stages(
        { teamId, sessionId, memberId: leaderId, source: "teacher" },
        r1,
        {
          source_iteration: "teacher_auto_finalize_from_draft",
          used_best_iteration: false,
          vp_text: finalVpText
        }
      );
    } catch (scheduleErr) {
      console.warn("[teacher-auto-finalize] scheduleFinalRound1Stages failed after freeze persisted", JSON.stringify({
        team_id: teamId,
        error: scheduleErr?.message || String(scheduleErr)
      }));
    }
    clearTeamStateCache(teamId);

    return makeResponse(200, {
      ok: true,
      team_id: teamId,
      status: "frozen",
      auto_finalized_from_draft: true,
      used_fallback_scores: !persistedScores,
      message: "该队 R1 未定稿，已按当前草稿定稿后强推进入第二轮",
      r1_result: sanitizeStudentR1Result(r1)
    });
  } catch (e) {
    return makeResponse(400, { ok: false, error: e.message });
  }
}

async function submitAndFinalizeRound1Vp(body) {
  const payload = body || {};
  const teamId = String(payload.team_id || payload.teamId || "").trim();
  const memberId = String(payload.member_id || payload.memberId || "").trim();
  if (!teamId || !memberId) {
    return makeResponse(400, { ok: false, error: "team_id/member_id required" });
  }

  const confirmation = await confirmAndScoreVp(payload);
  if (confirmation.status !== 200) return confirmation;

  try {
    const team = await getTeam(teamId);
    if (!team) return makeResponse(404, { ok: false, error: "team not found" });
    const draft = await readRound1TeamDraft(teamId).catch(() => null);
    const persisted = await readPersistedPhase3Confirmation(
      teamId,
      memberId,
      String(team.leader_member_id || "").trim()
    );
    const gridId = String(
      payload.grid_id || payload.gridId || draft?.grid_id || team.final_grid_id || ""
    ).trim();
    const architecture = normalizeArchitecture(
      payload.architecture || draft?.architecture || team.final_architecture || ""
    );
    if (!gridId || !architecture || !persisted?.fields || !persisted?.scores) {
      return makeResponse(409, {
        ok: false,
        error: "value proposition confirmation is incomplete; retry the final submission"
      });
    }

    const finalized = await finalizePhase3(teamId, {
      grid_id: gridId,
      architecture,
      memberId,
      conversation_history: [],
      vp_text: persisted.vp_text,
      confirmed_fields: persisted.fields,
      scores: persisted.scores,
      vp_result: buildConfirmedVpResult(persisted.fields, persisted.scores),
      source_iteration: "simplified_vp_submit"
    });
    if (finalized.status !== 200) {
      return makeResponse(finalized.status || 409, {
        ok: false,
        error: finalized.body?.error || "final round1 result generation failed"
      });
    }

    return makeResponse(200, {
      ...confirmation.body,
      ok: true,
      finalized: true,
      result_ready: true,
      team_status: "phase4"
    });
  } catch (e) {
    return makeResponse(409, {
      ok: false,
      error: e.message || "final round1 result generation failed"
    });
  }
}

async function buildPhase4Data(teamId) {
  const timingStartedAt = Date.now();
  const timing = {};
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
  timing.vp_scoring_ms = Date.now() - timingStartedAt;

  const jinangStartedAt = Date.now();
  const settle = await settleAllJinang(teamId);
  timing.jinang_settlement_ms = Date.now() - jinangStartedAt;
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
  const hasStoredWtp = team.final_wtp_vp_effect != null
    && team.final_wtp_vp_effect !== ""
    && team.final_wtp_multiplier != null
    && team.final_wtp_multiplier !== ""
    && Number.isFinite(Number(team.final_wtp_vp_effect))
    && Number.isFinite(Number(team.final_wtp_multiplier));
  const engineStartedAt = Date.now();
  const r1Base = buildRound1Outcome(team.final_grid_id, team.final_architecture, engineVpScores, {
    topMatchStrength: 0,
    totalBonus: 0
  });
  let r1;
  if (hasStoredWtp) {
    const r1Fresh = buildRound1Outcome(team.final_grid_id, team.final_architecture, engineVpScores, marketJinangSummary, {
      teamId,
      sessionId: latestSession?.sessionId || `phase4:${teamId}`,
      vpText
    });
    r1 = {
      ...r1Fresh,
      wtp_vp_effect: Number(team.final_wtp_vp_effect),
      jinang_wtp_bonus: team.final_jinang_wtp_bonus != null && team.final_jinang_wtp_bonus !== ""
        ? Number(team.final_jinang_wtp_bonus)
        : Number(r1Fresh.jinang_wtp_bonus || 0),
      wtp_multiplier: Number(team.final_wtp_multiplier),
      rho_C: team.final_rho_c != null && team.final_rho_c !== ""
        ? Number(team.final_rho_c)
        : Number(r1Fresh.rho_C),
      WTPadj: team.final_wtp_adj != null && team.final_wtp_adj !== ""
        ? Number(team.final_wtp_adj)
        : Number(r1Fresh.WTPadj),
      WTPref: team.final_wtp_ref != null && team.final_wtp_ref !== ""
        ? Number(team.final_wtp_ref)
        : Number(r1Fresh.WTPref)
    };
  } else {
    r1 = buildRound1Outcome(team.final_grid_id, team.final_architecture, engineVpScores, marketJinangSummary, {
      teamId,
      sessionId: latestSession?.sessionId || `phase4:${teamId}`,
      vpText
    });
  }
  timing.round1_engine_ms = Date.now() - engineStartedAt;
  const extractField = (text, key) => {
    const re = new RegExp(key + "\\s*[：:]\\s*([^\\n]+)");
    const match = String(text || "").match(re);
    return match ? match[1].trim() : "";
  };

  if (!hasStoredWtp) {
    const wtpPersistStartedAt = Date.now();
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
          final_wtp_multiplier = ${Number(r1.wtp_multiplier)},
          final_wtp_vp_effect = ${Number(r1.wtp_vp_effect)},
          final_jinang_wtp_bonus = ${Number(r1.jinang_wtp_bonus)}
      WHERE id = ${sqlQuote(teamId)};
    `);
    timing.wtp_persist_ms = Date.now() - wtpPersistStartedAt;
  } else {
    timing.wtp_persist_ms = 0;
  }
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
  let vpFeedbackPending = false;
  if ((!vpFeedback || vpFeedbackVersion < VP_FEEDBACK_VERSION) && confirmedFields) {
    const feedbackStartedAt = Date.now();
    vpFeedbackPending = schedulePhase4VpFeedbackGeneration({
      teamId,
      latestSession,
      team,
      r1,
      confirmedFields
    });
    timing.llm_feedback_enqueue_ms = Date.now() - feedbackStartedAt;
  } else {
    timing.llm_feedback_enqueue_ms = 0;
  }
  const topMarketJinang = marketJinangSummary.topItem;
  timing.phase4_assembly_ms = Date.now() - timingStartedAt;
  console.log("[round1/phase4-timing]", JSON.stringify({
    team_id: teamId,
    ...timing,
    vp_feedback_pending: vpFeedbackPending,
    total_ms: Date.now() - timingStartedAt
  }));

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
    r1_result: sanitizeStudentR1Result(r1),
    wtp_breakdown: (() => {
      const finalPct = Math.round((Number(r1.wtp_multiplier || 1) - 1) * 100);
      const jinangDeltaPct = Math.round(Number(r1.jinang_wtp_bonus || 0) * 100);
      const basePct = finalPct - jinangDeltaPct;
      return {
        base_result: r1Base,
        final_result: sanitizeStudentR1Result(r1),
        market_jinang_match_tier: matchStrengthToTier(marketJinangSummary.topMatchStrength),
        rho_discount: r1.rho_C,
        vp_effect: r1.wtp_vp_effect,
        jinang_bonus: r1.jinang_wtp_bonus,
        market_jinang_bonus_total: marketJinangSummary.totalBonus,
        multiplier: r1.wtp_multiplier,
        base_pct: basePct,
        final_pct: finalPct,
        jinang_delta_pct: jinangDeltaPct,
        compressed_jinang_delta_pct: toCompressedDeltaPercent(r1.wtp_vp_effect, r1.wtp_multiplier)
      };
    })(),
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
    vp_feedback_pending: vpFeedbackPending,
    jinang: {
      market_jinang: topMarketJinang ? toStudentFacingMatch({
        id: topMarketJinang.jinang_id,
        name: topMarketJinang.name,
        member_id: topMarketJinang.member_id,
        member_name: topMarketJinang.member_name,
        match_strength: Number(topMarketJinang.match_strength || 0),
        bonus: Number(topMarketJinang.bonus || 0)
      }) : null,
      market_jinangs: marketJinangSummary.items.map((item) => toStudentFacingMatch({
        id: item.jinang_id,
        name: item.name,
        member_id: item.member_id,
        member_name: item.member_name,
        match_strength: Number(item.match_strength || 0),
        bonus: Number(item.bonus || 0)
      })),
      market_jinang_bonus_total: marketJinangSummary.totalBonus
    },
    settle: sanitizeStudentSettle(settle),
    settle_raw: settle
  };
}

async function phase4Data(teamId, options = {}) {
  try {
    const data = await buildPhase4Data(teamId);
    if (!data.ok) return makeResponse(data.status || 400, { ok: false, error: data.error || "phase4 failed" });
    if (options?.includeRawMatchStrength) {
      return makeResponse(200, {
        ...data,
        settle: data.settle_raw || data.settle
      });
    }
    const { settle_raw, ...studentData } = data;
    const team = await getTeam(teamId);
    const round2State = await getTeamRound2State(teamId).catch(() => null);
    const sessionConfig = await getSessionConfig(team?.session_id || "default");
    const effectiveRound2Status = String(round2State?.r2?.status || team?.r2_status || "").trim();
    const revealR1Results = sessionConfig.reveal_r1_results === true || effectiveRound2Status === "R2_SUBMITTED";
    const studentPayload = {
      ...studentData,
      r1_results_revealed: revealR1Results,
      r1_result: sanitizeStudentR1Result(studentData.r1_result),
      wtp_breakdown: studentData?.wtp_breakdown
        ? {
            ...studentData.wtp_breakdown,
            base_result: sanitizeStudentR1Result(studentData.wtp_breakdown.base_result),
            final_result: sanitizeStudentR1Result(studentData.wtp_breakdown.final_result)
          }
        : studentData?.wtp_breakdown,
      settle: sanitizeStudentSettle(studentData.settle)
    };
    return makeResponse(200, revealR1Results ? studentPayload : hideDeferredRound1Fields(studentPayload));
  } catch (e) {
    return makeResponse(400, { ok: false, error: e.message });
  }
}

async function phase3State(teamId, requesterMemberId = "") {
  try {
    let team = await getTeam(teamId);
    if (!team) return makeResponse(404, { ok: false, error: "team not found" });
    if (!String(team.leader_member_id || "").trim() && shouldAssignLeaderForStatus(team.status)) {
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
  const timingStartedAt = Date.now();
  const timing = {};
  try {
    const memberId = readRequesterMemberId(body);
    const authStartedAt = Date.now();
    const permission = await ensureLeaderPermission(teamId, memberId);
    timing.leader_auth_ms = Date.now() - authStartedAt;
    if (!permission.ok) return permission.response;
    const team = permission.team;
    if (!team.final_grid_id) {
      return makeResponse(400, { ok: false, error: "must finalize before freezing" });
    }
    const sessionConfigStartedAt = Date.now();
    const sessionConfig = await getSessionConfig(team.session_id || "default");
    timing.session_config_ms = Date.now() - sessionConfigStartedAt;
    const nextRound2Status = sessionConfig.hold_before_r2 ? "R2_NOT_STARTED" : "R2_INTERVIEWING";
    const criticalPersistStartedAt = Date.now();
    await ensureRound2StateSchema();
    const rows = await runSql(`
      UPDATE teams
      SET status = 'frozen',
          r2_status = ${sqlQuote(nextRound2Status)},
          r2_status_entered_at = CASE
            WHEN r2_status IS DISTINCT FROM ${sqlQuote(nextRound2Status)}
              OR r2_status_entered_at IS NULL
            THEN ${sqlQuote(nowIso())}
            ELSE r2_status_entered_at
          END
      WHERE id = ${sqlQuote(teamId)}
      RETURNING id, status, r2_status;
    `);
    if (!rows[0]) {
      return makeResponse(404, { ok: false, error: "team not found" });
    }
    clearTeamStateCache(teamId);
    timing.freeze_db_ms = Date.now() - criticalPersistStartedAt;

    const enqueueStartedAt = Date.now();
    const refreshPending = scheduleFreezePostCommitRefresh(teamId);
    timing.phase4_refresh_enqueue_ms = Date.now() - enqueueStartedAt;

    console.log("[round1/freeze-timing]", JSON.stringify({
      team_id: teamId,
      ...timing,
      deferred: {
        r2_cache_refresh: refreshPending,
        phase4_recompute: refreshPending,
        jinang_settlement: refreshPending,
        round1_engine: refreshPending,
        phase4_assembly: refreshPending
      },
      total_ms: Date.now() - timingStartedAt
    }));

    return makeResponse(200, {
      ok: true,
      status: "frozen",
      r2_status: nextRound2Status,
      freeze_async: true,
      freeze_refresh_pending: refreshPending,
      session_config: sessionConfig,
      ...buildLeaderMeta(team, memberId)
    });
  } catch (e) {
    console.warn("[round1/freeze-timing]", JSON.stringify({
      team_id: teamId,
      ...timing,
      total_ms: Date.now() - timingStartedAt,
      error: e.message
    }));
    return makeResponse(400, { ok: false, error: e.message });
  }
}

async function leaderStartRound2(teamId, body = {}) {
  // DEPRECATED: R2 状态已经在 freezeTeam 时自动推进。
  // 此接口保留为 no-op 仅为了兼容仍在缓存里的老前端代码。
  try {
    const memberId = readRequesterMemberId(body);
    const team = await getTeam(teamId);
    if (!team) return makeResponse(404, { ok: false, error: "team not found" });
    return makeResponse(200, {
      ok: true,
      status: String(team.status || ""),
      r2_status: "R2_INTERVIEWING",
      deprecated: true,
      ...buildLeaderMeta(team, memberId)
    });
  } catch (e) {
    return makeResponse(400, { ok: false, error: e.message });
  }
}

async function getTeamStatus(teamId, requesterMemberId = "", options = {}) {
  try {
    const lite = options?.lite === true;
    let team = await getTeam(teamId);
    if (!team) return makeResponse(404, { ok: false, error: "team not found" });
    if (!String(team.leader_member_id || "").trim() && shouldAssignLeaderForStatus(team.status)) {
      team = await assignRound1LeaderIfNeeded(teamId) || team;
    }
    const memberCount = Array.isArray(team.members) ? team.members.length : 0;
    const submissions = await readTeamSubmissions(teamId);
    const submittedCount = submissions.filter((item) => item?.submitted).length;
    const status = String(team.status || "forming");
    const draft = await readRound1TeamDraft(teamId);
    const body = {
      ok: true,
      status,
      phase: getPhaseByStatus(status),
      final_grid_id: String(team.final_grid_id || "").trim() || null,
      final_architecture: String(team.final_architecture || "").trim() || null,
      all_submitted: submittedCount >= memberCount && memberCount > 0,
      member_count: memberCount,
      submitted_count: submittedCount,
      pending_members: pendingRound1SubmissionMembers(team, submissions),
      self_submitted: submissions.some(
        (item) => item?.submitted && String(item.member_id || "").trim() === String(requesterMemberId || "").trim()
      ),
      ...buildLeaderMeta(team, requesterMemberId),
      team_draft: draft
    };
    if (!lite) {
      const round2State = await getTeamRound2State(teamId);
      body.r2_status = round2State?.r2?.status || "R2_NOT_STARTED";
      body.r2_status_label = round2State?.r2?.statusLabel || "未开始";
    }
    return makeResponse(200, body);
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
  round1VpFeedbackApi,
  confirmAndScoreVp,
  submitAndFinalizeRound1Vp,
  generateVpFeedbackApi,
  finalizePhase3,
  finalizeRound1FromDraftForTeacher,
  phase3State,
  getPhase3Scores,
  phase4Data,
  freezeTeam,
  leaderStartRound2,
  getTeamStatus,
  forceAdvancePhase1,
  getMemberJinangApi,
  hideDeferredRound1Fields,
  sanitizeStudentVpConfirmationResponse,
  clipScore,
  lambdaMap,
  rhoDiscount,
  buildRound1Outcome,
  vpResultToApiScores,
  buildVpResultScoringText,
  vpResultToConfirmedFields,
  sanitizeStudentR1Result
};
