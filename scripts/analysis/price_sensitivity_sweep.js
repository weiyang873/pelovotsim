#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");

const {
  DEFAULT_PARAMS,
  GLOBAL_PARAMS,
  GRID_PARAMS,
  calculateProfit,
  computeValueScore,
  parseGridId
} = require("../../server/llm/rdCalculator");

const ROOT = path.join(__dirname, "..", "..");
const RUN_ID = "sim_layered_newflow_2026-07-10T23-54-52-761Z";
const RUN_DIR = path.join(ROOT, "data", "persona_sim_logs", RUN_ID);
const TEAMS_SUMMARY = path.join(RUN_DIR, "teams_summary.csv");
const EVI_RECALC = path.join(RUN_DIR, "evi_085_recalc.csv");
const BY_TEAM_DIR = path.join(RUN_DIR, "by_team");
const OUT_DIR = __dirname;
const RESULTS_CSV = path.join(OUT_DIR, "price_sweep_results.csv");
const SUMMARY_CSV = path.join(OUT_DIR, "price_sweep_summary.csv");

const PRICE_MIN = 1000;
const PRICE_MAX = 7000;
const PRICE_STEP = 100;
const COVER_CORE_CONDITIONS = [
  { label: "actual_7_10", value: null },
  { label: "low_0.35", value: 0.35 },
  { label: "mid_0.50", value: 0.5 },
  { label: "high_0.65", value: 0.65 }
];

function assertFile(file) {
  if (!fs.existsSync(file)) {
    throw new Error(`required file not found: ${path.relative(ROOT, file)}`);
  }
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const ch = text[index];
    const next = text[index + 1];

    if (ch === "\"") {
      if (inQuotes && next === "\"") {
        field += "\"";
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (ch === "," && !inQuotes) {
      row.push(field);
      field = "";
      continue;
    }

    if ((ch === "\n" || ch === "\r") && !inQuotes) {
      if (ch === "\r" && next === "\n") index += 1;
      row.push(field);
      if (row.some((value) => value !== "")) rows.push(row);
      row = [];
      field = "";
      continue;
    }

    field += ch;
  }

  if (field !== "" || row.length > 0) {
    row.push(field);
    if (row.some((value) => value !== "")) rows.push(row);
  }

  if (rows.length === 0) return [];
  const headers = rows[0];
  return rows.slice(1).map((values) => {
    const out = {};
    headers.forEach((header, index) => {
      out[header] = values[index] ?? "";
    });
    return out;
  });
}

function readCsv(file) {
  return parseCsv(fs.readFileSync(file, "utf8"));
}

function csvEscape(value) {
  if (value === null || value === undefined) return "";
  const text = String(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, "\"\"")}"` : text;
}

function writeCsv(file, rows, headers) {
  const lines = [headers.join(",")];
  rows.forEach((row) => {
    lines.push(headers.map((header) => csvEscape(row[header])).join(","));
  });
  fs.writeFileSync(file, `${lines.join("\n")}\n`);
}

function toNumber(value, fallback = 0) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function round(value, digits = 6) {
  const num = Number(value);
  if (!Number.isFinite(num)) return "";
  const factor = 10 ** digits;
  return Math.round(num * factor) / factor;
}

function toCalcGridId(gridId) {
  return String(gridId || "")
    .replace(/^ToB_/, "B2B_")
    .replace(/^ToC_/, "B2C_");
}

function getChannelFee(gridId) {
  const parsed = parseGridId(gridId);
  const cfg = GRID_PARAMS[`${parsed.channel}_${parsed.age}`];
  if (!cfg) throw new Error(`grid params missing for ${gridId}`);
  return Number(cfg.f || 0);
}

function readPreviewByTeam(teamId) {
  const file = path.join(BY_TEAM_DIR, `${teamId}.json`);
  assertFile(file);
  const entries = JSON.parse(fs.readFileSync(file, "utf8"));
  const preview = entries.find((entry) => entry.step === "R2.7_calculate_preview");
  if (!preview?.responseBody?.ok) {
    throw new Error(`R2.7_calculate_preview response missing for team ${teamId}`);
  }
  return {
    request: preview.requestBody || {},
    response: preview.responseBody || {}
  };
}

function buildContext(teamRow, eviRow) {
  const teamId = String(eviRow.team_id || "").trim();
  if (!teamId) {
    throw new Error(`team_id missing for team_index=${teamRow.team_index}`);
  }

  const preview = readPreviewByTeam(teamId);
  const req = preview.request;
  const res = preview.response;
  const calcGrid = req.gridId || toCalcGridId(teamRow.grid);
  const actualCoverCore = toNumber(teamRow.coverCore, toNumber(res.coverCore));
  const coverNice = toNumber(teamRow.coverNice, toNumber(res.coverNice));
  const dCOGS = toNumber(teamRow.r2_dCOGS, toNumber(res.dCOGS));
  const totalNREWan = toNumber(teamRow.r2_NRE, toNumber(res.nre_total_wan));
  const cogsBase = toNumber(res.COGSbase, toNumber(GLOBAL_PARAMS.V));
  const positiveDCOGS = toNumber(res.positiveDCOGS, Math.max(0, dCOGS));
  const complexity = toNumber(res.complexity, cogsBase > 0 ? positiveDCOGS / cogsBase : 0);
  const subLift = toNumber(res.subLift);
  const risk = toNumber(res.risk);
  const evi = toNumber(res.evi, toNumber(eviRow.original_evi, 0.7));
  const sev = toNumber(res.sev, toNumber(eviRow.original_sev, 0.5));

  return {
    run_id: RUN_ID,
    team_index: toNumber(teamRow.team_index),
    team_id: teamId,
    grid: teamRow.grid,
    calcGrid,
    arch: teamRow.arch,
    wtp_adj: toNumber(teamRow.r1_wtp_adj),
    wtp_ref: toNumber(teamRow.r1_wtp_ref),
    wtp_multiplier: toNumber(teamRow.r1_wtp_multiplier, toNumber(res.rawWtpMult, 1)),
    compressed_wtp_multiplier: toNumber(teamRow.r1_wtp_mult_compressed, toNumber(res.compressedWtpMult, 1)),
    actual_price: toNumber(teamRow.r2_price, toNumber(res.P)),
    actual_profit_reported: toNumber(teamRow.r2_profit, toNumber(res.profit)),
    vp_C: toNumber(teamRow.vp_C),
    vp_G: toNumber(teamRow.vp_G),
    vp_E: toNumber(teamRow.vp_E),
    dCOGS,
    positiveDCOGS,
    totalNREWan,
    coverCore: actualCoverCore,
    coverNice,
    subLift,
    risk,
    evi,
    sev,
    complexity,
    cogsBase,
    channelFee: getChannelFee(calcGrid),
    Fbase: toNumber(GLOBAL_PARAMS.F),
    wtpParams: {
      WTPref: toNumber(res.WTPref_adjusted, toNumber(res.WTPref, toNumber(eviRow.wtp_ref))),
      WTPmean: toNumber(res.WTPref_adjusted, toNumber(res.WTPref, toNumber(eviRow.wtp_ref))),
      WTPmedian: toNumber(res.WTP, 0),
      gamma: toNumber(res.gammaRaw, toNumber(res.gamma)),
      channel: parseGridId(calcGrid).channel,
      strategy: parseGridId(calcGrid).strategy,
      age: parseGridId(calcGrid).age
    }
  };
}

function recomputeDemandContext(context, coverCore) {
  // Mirrors server/llm/rdCalculator.js calculate(): I, fit, X, and Vscore.
  const params = DEFAULT_PARAMS;
  const I = context.evi * (
    0.5 * context.sev +
    0.35 * coverCore +
    0.1 * context.coverNice
  );
  const fit = Math.max(0, Math.min(1, 0.7 * coverCore + 0.3 * context.coverNice));
  const X = params.wI * I +
    params.wfit * fit +
    params.wsub * context.subLift +
    params.wrisk * context.risk +
    params.wcx * context.complexity;
  const Vscore = computeValueScore(
    coverCore,
    context.coverNice,
    context.subLift,
    context.risk,
    context.positiveDCOGS,
    context.cogsBase,
    params
  );
  return { I, fit, X, Vscore };
}

function withMutedEngineLogs(fn) {
  const originalLog = console.log;
  console.log = () => {};
  try {
    return fn();
  } finally {
    console.log = originalLog;
  }
}

function calculatePoint(context, price, condition) {
  const coverCore = condition.value == null ? context.coverCore : condition.value;
  const demand = recomputeDemandContext(context, coverCore);
  const result = withMutedEngineLogs(() => calculateProfit(
    price,
    context.calcGrid,
    demand.X,
    context.dCOGS,
    coverCore,
    context.coverNice,
    context.subLift,
    context.risk,
    context.wtpParams,
    0,
    demand.Vscore,
    context.totalNREWan
  ));

  return {
    run_id: context.run_id,
    team_index: context.team_index,
    team_id: context.team_id,
    grid: context.grid,
    coverCore_condition: condition.label,
    coverCore,
    price,
    units: result.Q,
    profit: Math.round(result.totalProfit),
    is_profitable: result.totalProfit > 0,
    share: round(result.shareRate, 8),
    X: round(demand.X, 6),
    Vscore: round(demand.Vscore, 6),
    unit_margin: round(result.unitMargin, 6),
    channelFee: context.channelFee,
    COGSbase: context.cogsBase,
    dCOGS: context.dCOGS,
    NRE: context.totalNREWan,
    actual_price_7_10: context.actual_price
  };
}

function summarizeCurve(context, condition, rows) {
  const best = rows.reduce((acc, row) => (acc == null || row.profit > acc.profit ? row : acc), null);
  const profitable = rows.filter((row) => row.profit > 0);
  const actualAtCondition = rows.find((row) => row.price === context.actual_price)
    || calculatePoint(context, context.actual_price, condition);
  const low = profitable.length ? profitable[0].price : "";
  const high = profitable.length ? profitable[profitable.length - 1].price : "";
  const width = profitable.length ? Number(high) - Number(low) : 0;

  return {
    grid: context.grid,
    coverCore_condition: condition.label,
    coverCore: actualAtCondition.coverCore,
    p_star: best ? best.price : "",
    max_profit: best ? best.profit : "",
    breakeven_low: low,
    breakeven_high: high,
    window_width: width,
    actual_price_7_10: context.actual_price,
    actual_profit_7_10: actualAtCondition.profit,
    reported_profit_7_10: Math.round(context.actual_profit_reported),
    distance_to_p_star: best ? context.actual_price - best.price : "",
    p_star_at_boundary: best ? best.price === PRICE_MIN || best.price === PRICE_MAX : "",
    actual_units_at_condition: actualAtCondition.units,
    vp_C: context.vp_C,
    vp_G: context.vp_G,
    vp_E: context.vp_E
  };
}

function main() {
  assertFile(TEAMS_SUMMARY);
  assertFile(EVI_RECALC);
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const teamRows = readCsv(TEAMS_SUMMARY);
  const eviRows = new Map(readCsv(EVI_RECALC).map((row) => [String(row.team_index), row]));
  if (teamRows.length !== 12) {
    throw new Error(`expected 12 team rows, got ${teamRows.length}`);
  }

  const contexts = teamRows.map((teamRow) => {
    const eviRow = eviRows.get(String(teamRow.team_index));
    if (!eviRow) throw new Error(`evi row missing for team_index=${teamRow.team_index}`);
    return buildContext(teamRow, eviRow);
  });

  const resultRows = [];
  const summaryRows = [];
  const consoleLines = [];

  contexts.forEach((context) => {
    const summaryByCondition = [];
    COVER_CORE_CONDITIONS.forEach((condition) => {
      const rows = [];
      for (let price = PRICE_MIN; price <= PRICE_MAX; price += PRICE_STEP) {
        const row = calculatePoint(context, price, condition);
        rows.push(row);
        resultRows.push(row);
      }
      const summary = summarizeCurve(context, condition, rows);
      summaryRows.push(summary);
      summaryByCondition.push(summary);
    });

    const compact = summaryByCondition
      .map((item) => {
        const windowText = item.breakeven_low === "" ? "none" : `${item.breakeven_low}-${item.breakeven_high}`;
        return `${item.coverCore_condition}:P*=${item.p_star},win=${windowText},actual=${item.actual_profit_7_10}`;
      })
      .join(" | ");
    consoleLines.push(`${context.grid}: ${compact}`);
  });

  writeCsv(RESULTS_CSV, resultRows, [
    "run_id",
    "team_index",
    "team_id",
    "grid",
    "coverCore_condition",
    "coverCore",
    "price",
    "units",
    "profit",
    "is_profitable",
    "share",
    "X",
    "Vscore",
    "unit_margin",
    "channelFee",
    "COGSbase",
    "dCOGS",
    "NRE",
    "actual_price_7_10"
  ]);
  writeCsv(SUMMARY_CSV, summaryRows, [
    "grid",
    "coverCore_condition",
    "coverCore",
    "p_star",
    "max_profit",
    "breakeven_low",
    "breakeven_high",
    "window_width",
    "actual_price_7_10",
    "actual_profit_7_10",
    "reported_profit_7_10",
    "distance_to_p_star",
    "p_star_at_boundary",
    "actual_units_at_condition",
    "vp_C",
    "vp_G",
    "vp_E"
  ]);

  consoleLines.forEach((line) => console.log(line));

  const boundaryRows = summaryRows.filter((row) => row.p_star_at_boundary === true);
  if (boundaryRows.length > 0) {
    console.warn(`Warning: ${boundaryRows.length} P* values are on scan boundaries (${PRICE_MIN}-${PRICE_MAX}).`);
  }
}

main();
