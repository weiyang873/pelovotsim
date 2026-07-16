// rd.js - route handlers for R&D module (http-native)
const {
  calculate,
  validateSelections,
  computeSoftPenalties,
  computeAdoption,
  DEFAULT_PARAMS,
  buildCapabilityGroupsForDisplay
} = require("../llm/rdCalculator");
const TeamManager = require("../multiplayer/teamManager");
const rules = require("../../data/compatibility_rules_v2.json");
const gridPriors = require("../../data/grid_priors_v4_cap_weights.json");

function makeResponse(status, body) {
  return { status, body };
}

async function enrichRound1Context(payload) {
  const nextPayload = payload && typeof payload === "object" ? { ...payload } : {};
  const hasRound1GridId = String(
    nextPayload.round1GridId ||
    nextPayload.round1_grid_id ||
    ((nextPayload.round1Context || {}).gridId) ||
    ((nextPayload.round1Context || {}).grid_id) ||
    ""
  ).trim().length > 0;
  if (hasRound1GridId) return nextPayload;

  const teamId = String(nextPayload.teamId || nextPayload.team_id || "").trim();
  if (!teamId) return nextPayload;

  const team = await TeamManager.getTeam(teamId);
  const round1GridId = String(team?.final_grid_id || "").trim();
  if (!round1GridId) return nextPayload;

  nextPayload.round1GridId = round1GridId;
  nextPayload.round1Context = {
    ...(nextPayload.round1Context && typeof nextPayload.round1Context === "object" ? nextPayload.round1Context : {}),
    gridId: round1GridId
  };
  return nextPayload;
}

async function calculateRoute(body) {
  try {
    const payload = await enrichRound1Context(body || {});
    const selections = Array.isArray(payload.selections) ? payload.selections : [];
    const validation = validateSelections(selections);

    if (validation.hardViolationCount > 0) {
      return makeResponse(200, {
        ok: false,
        violations: validation.violations,
        hardViolationCount: validation.hardViolationCount
      });
    }

    const result = await calculate(payload);
    return makeResponse(200, { ok: true, ...result });
  } catch (e) {
    return makeResponse(400, { ok: false, error: e.message });
  }
}

async function previewPriceRoute(body) {
  try {
    const payload = body || {};
    const P = Number(payload.P || 0);
    const WTP = Number(payload.WTP || 1);
    const e = Number(payload.e || 1.2);
    const V = Number(payload.V || 0);
    const COGSbase = Number(payload.COGSbase || 0);
    const dCOGS = Number(payload.dCOGS || 0);
    const f = Number(payload.f || 0);
    const TAM = Number(payload.TAM || 0);
    const H = Number(payload.H || 0);
    const S_competitive = Number(payload.S_competitive || 0);
    const R = Number(payload.R != null ? payload.R : 1);
    const gamma = Number(DEFAULT_PARAMS.gamma || 0.3);

    const wtpPrime = WTP * (1 + gamma * V);
    const adoption = computeAdoption(P, wtpPrime, e, DEFAULT_PARAMS);
    const share = adoption * S_competitive * R;
    const units = Math.round(TAM * H * share);
    const unitProfit = P * (1 - f) - (COGSbase + dCOGS);
    const profit = units * unitProfit;

    return makeResponse(200, {
      ok: true,
      adoption,
      share,
      units,
      unitProfit,
      profit: Math.round(profit),
      wtpPrime
    });
  } catch (e) {
    return makeResponse(400, { ok: false, error: e.message });
  }
}

async function validateRoute(body) {
  try {
    const payload = body || {};
    const selections = Array.isArray(payload.selections) ? payload.selections : [];
    const validation = validateSelections(selections);
    const soft = computeSoftPenalties(selections, payload.COGSbase || 6000);

    return makeResponse(200, {
      ok: true,
      valid: validation.valid,
      violations: validation.violations,
      hardViolationCount: validation.hardViolationCount,
      soft
    });
  } catch (e) {
    return makeResponse(400, { ok: false, error: e.message });
  }
}

async function cards() {
  return makeResponse(200, { ok: true, ...buildCapabilityGroupsForDisplay() });
}

async function rulesDetail() {
  return makeResponse(200, { ok: true, ...rules });
}

async function gridDetail(gridId) {
  const grid = (gridPriors.grids || []).find((g) => g.id === gridId);
  if (!grid) return makeResponse(404, { ok: false, error: "Grid not found" });
  return makeResponse(200, { ok: true, grid });
}

async function analysisStream(res) {
  res.writeHead(410, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify({ ok: false, error: "R&D analysis stream is deprecated in v6" }));
}

module.exports = {
  enrichRound1Context,
  calculateRoute,
  previewPriceRoute,
  validateRoute,
  cards,
  rulesDetail,
  gridDetail,
  analysisStream
};
