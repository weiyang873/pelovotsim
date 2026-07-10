#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");

const {
  calculate,
  computeWTPParams,
  parseGridId,
  GRID_PARAMS,
  GLOBAL_PARAMS
} = require("../../server/llm/rdCalculator");
const Round2 = require("../../server/routes/round2Routes");

const ROOT = path.join(__dirname, "..", "..");
const SOURCE_RUN = path.join(
  ROOT,
  "data",
  "sim_logs",
  "decision_benchmark_v2",
  "decision_benchmark_v2_20260710_retry"
);
const OUT_DIR = path.join(ROOT, "data", "sim_logs", "pricing_scan_diagnostics", "pricing_scan_20260710");
const ARMS = ["simple", "layered"];
const RATIOS = Array.from({ length: 14 }, (_, index) => Number((0.4 + index * 0.05).toFixed(2)));

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function csvEscape(value) {
  if (value === null || value === undefined) return "";
  const text = typeof value === "object" ? JSON.stringify(value) : String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function writeCsv(file, rows, headers) {
  const lines = [headers.join(",")];
  rows.forEach((row) => {
    lines.push(headers.map((key) => csvEscape(row[key])).join(","));
  });
  fs.writeFileSync(file, `${lines.join("\n")}\n`);
}

function round(value, digits = 2) {
  const num = Number(value);
  if (!Number.isFinite(num)) return "";
  const m = 10 ** digits;
  return Math.round(num * m) / m;
}

function roundPrice(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return 0;
  return Math.round(num / 100) * 100;
}

function groupBy(rows, keyFn) {
  const map = new Map();
  rows.forEach((row) => {
    const key = keyFn(row);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(row);
  });
  return map;
}

function medianRow(rows) {
  const sorted = rows
    .filter((row) => Number.isFinite(Number(row.profit)))
    .slice()
    .sort((a, b) => Number(a.profit) - Number(b.profit));
  return sorted[Math.floor(sorted.length / 2)] || null;
}

function getMarketParams(gridId) {
  const parsed = parseGridId(toCalcGridId(gridId));
  const params = GRID_PARAMS[`${parsed.channel}_${parsed.age}`] || {};
  const n = parsed.strategy === "DIFF" ? Number(params.N_DIFF || 0) : Number(params.N_COST || 0);
  const meff = n * Number(params.Aw || 0) * Number(params.friction || 1);
  return {
    N: n,
    Aw: Number(params.Aw || 0),
    friction: Number(params.friction || 1),
    Meff: meff,
    f: Number(params.f || 0)
  };
}

function toCalcGridId(gridId) {
  return String(gridId || "")
    .replace(/^ToB_/, "B2B_")
    .replace(/^ToC_/, "B2C_");
}

function evidenceFor(row) {
  const legacyGrid = String(row.grid || "")
    .replace(/^ToB_/, "B2B_")
    .replace(/^ToC_/, "B2C_");
  const evidenceRow = Round2.__test.getGridDimensionEvidenceRow(row.grid)
    || Round2.__test.getGridDimensionEvidenceRow(legacyGrid);
  if (!evidenceRow) {
    throw new Error(`grid_dimension_evidence missing for ${row.grid}`);
  }
  const result = Round2.__test.buildStaticSummaryModeRadarResult({
    gridId: row.grid,
    architecture: row.architecture,
    evidenceRow,
    mapEvidenceToResultFn: Round2.__test.mapEvidenceToResult,
    eviOverride: Number(row.evi || 0.85)
  });
  return {
    radar: result.radar || {},
    tags: Array.isArray(result.tags) ? result.tags : [],
    evi: Number(result.evi || row.evi || 0.85)
  };
}

async function scanRow(row) {
  const calcGridId = toCalcGridId(row.grid);
  const wtp = computeWTPParams(calcGridId);
  const wtpRef = Number(wtp.WTPref || row.WTPref || 0);
  const evidence = evidenceFor(row);
  const market = getMarketParams(row.grid);
  const curves = [];
  let best = null;
  for (const ratio of RATIOS) {
    const price = roundPrice(wtpRef * ratio);
    const result = await calculate({
      gridId: calcGridId,
      round1GridId: calcGridId,
      round1Context: { gridId: calcGridId },
      selections: row.selections,
      radar: evidence.radar,
      tags: evidence.tags,
      evi: evidence.evi,
      P: price,
      Pmax: wtpRef,
      WTP: wtp.WTPmedian,
      COGSbase: GLOBAL_PARAMS.V,
      TAM: 50000,
      H: 0.3,
      source: "pricing_scan"
    });
    const detail = result.detail || {};
    const profit = Number(result.profit ?? detail.profit ?? 0);
    const out = {
      arm: row.arm,
      grid: row.grid,
      median_repeat: row.repeat,
      architecture: row.architecture,
      ratio,
      price,
      WTPref: round(wtpRef, 2),
      profit: Math.round(profit),
      Q: Math.round(Number(result.units ?? detail.Q ?? 0)),
      BEQ: Math.round(Number(detail.breakeven_q ?? result.breakeven_q ?? 0)),
      X: round(detail.X, 4),
      z: round(detail.z, 4),
      sigma_z: round(detail.adoption ?? detail.share ?? 0, 6),
      Meff: round(detail.Meff || market.Meff, 2),
      N: market.N,
      Aw: market.Aw,
      dCOGS: round(detail.dCOGS ?? row.dCOGS, 2),
      NRE_wan: round(detail.totalNREWan ?? row.NRE_wan, 2)
    };
    curves.push(out);
    if (!best || out.profit > best.profit) best = out;
  }
  const profitable = curves.filter((item) => Number(item.profit) > 0);
  return {
    curves,
    window: {
      arm: row.arm,
      grid: row.grid,
      median_repeat: row.repeat,
      architecture: row.architecture,
      card_count: row.card_count,
      original_price: row.price,
      original_profit: row.profit,
      WTPref: round(wtpRef, 2),
      P_low: profitable.length ? profitable[0].price : "",
      P_high: profitable.length ? profitable[profitable.length - 1].price : "",
      P_star: best?.price ?? "",
      max_profit: best?.profit ?? "",
      max_Q: best?.Q ?? "",
      max_sigma_z: best?.sigma_z ?? "",
      median_cards: (row.selections || []).map((sel) => `${sel.cap_id}:${sel.tier}`).join("|")
    },
    params: {
      arm: row.arm,
      grid: row.grid,
      median_repeat: row.repeat,
      architecture: row.architecture,
      N: market.N,
      Aw: market.Aw,
      friction: market.friction,
      Meff: round(market.Meff, 2),
      WTPref: round(wtpRef, 2),
      BEQ_at_original_price: row.BEQ,
      original_price: row.price,
      original_profit: row.profit,
      dCOGS: row.dCOGS,
      NRE_wan: row.NRE_wan,
      X: row.X,
      card_count: row.card_count
    }
  };
}

function summarizeChildCostDiff(paramRows, windowRows) {
  const rows = [];
  for (const arm of ARMS) {
    const tob = paramRows.find((row) => row.arm === arm && row.grid === "ToB_Cost_Child");
    const toc = paramRows.find((row) => row.arm === arm && row.grid === "ToC_Cost_Child");
    const tobWin = windowRows.find((row) => row.arm === arm && row.grid === "ToB_Cost_Child");
    const tocWin = windowRows.find((row) => row.arm === arm && row.grid === "ToC_Cost_Child");
    if (!tob || !toc) continue;
    rows.push({
      arm,
      metric: "N",
      ToB_Cost_Child: tob.N,
      ToC_Cost_Child: toc.N,
      diff: Number(tob.N || 0) - Number(toc.N || 0)
    });
    ["Aw", "friction", "Meff", "WTPref", "BEQ_at_original_price", "original_price", "original_profit", "dCOGS", "NRE_wan", "X"].forEach((metric) => {
      rows.push({
        arm,
        metric,
        ToB_Cost_Child: tob[metric],
        ToC_Cost_Child: toc[metric],
        diff: round(Number(tob[metric] || 0) - Number(toc[metric] || 0), 4)
      });
    });
    rows.push({
      arm,
      metric: "scan_max_profit",
      ToB_Cost_Child: tobWin?.max_profit ?? "",
      ToC_Cost_Child: tocWin?.max_profit ?? "",
      diff: round(Number(tobWin?.max_profit || 0) - Number(tocWin?.max_profit || 0), 2)
    });
  }
  return rows;
}

async function main() {
  ensureDir(OUT_DIR);
  const allRows = [];
  for (const arm of ARMS) {
    const rows = readJson(path.join(SOURCE_RUN, arm, "partial_rows.json"));
    allRows.push(...rows.map((row) => ({ ...row, arm })));
  }
  const medianRows = [];
  for (const [key, rows] of groupBy(allRows, (row) => `${row.arm}:${row.grid}`)) {
    const row = medianRow(rows);
    if (!row) throw new Error(`median row not found for ${key}`);
    medianRows.push(row);
  }
  medianRows.sort((a, b) => `${a.arm}:${a.grid}`.localeCompare(`${b.arm}:${b.grid}`));

  const curveRows = [];
  const windowRows = [];
  const paramRows = [];
  for (const row of medianRows) {
    const result = await scanRow(row);
    curveRows.push(...result.curves);
    windowRows.push(result.window);
    paramRows.push(result.params);
  }

  const childRows = summarizeChildCostDiff(paramRows, windowRows);
  writeCsv(path.join(OUT_DIR, "profit_curves.csv"), curveRows, [
    "arm", "grid", "median_repeat", "architecture", "ratio", "price", "WTPref",
    "profit", "Q", "BEQ", "X", "z", "sigma_z", "Meff", "N", "Aw", "dCOGS", "NRE_wan"
  ]);
  writeCsv(path.join(OUT_DIR, "profit_windows.csv"), windowRows, [
    "arm", "grid", "median_repeat", "architecture", "card_count", "original_price",
    "original_profit", "WTPref", "P_low", "P_high", "P_star", "max_profit", "max_Q",
    "max_sigma_z", "median_cards"
  ]);
  writeCsv(path.join(OUT_DIR, "grid_params.csv"), paramRows, [
    "arm", "grid", "median_repeat", "architecture", "N", "Aw", "friction", "Meff",
    "WTPref", "BEQ_at_original_price", "original_price", "original_profit",
    "dCOGS", "NRE_wan", "X", "card_count"
  ]);
  writeCsv(path.join(OUT_DIR, "child_cost_diff.csv"), childRows, [
    "arm", "metric", "ToB_Cost_Child", "ToC_Cost_Child", "diff"
  ]);

  const markdown = [
    "# Pricing Scan Diagnostics",
    "",
    `Source: ${path.relative(ROOT, SOURCE_RUN)}`,
    "",
    "## Outputs",
    "",
    "- `profit_curves.csv`: 12 grids × 2 arms × 14 price points.",
    "- `profit_windows.csv`: profitable window, P*, and max profit per grid/arm.",
    "- `grid_params.csv`: N / Aw / Meff / WTPref / BEQ and median-card params.",
    "- `child_cost_diff.csv`: ToB_Cost_Child vs ToC_Cost_Child parameter diff.",
    "",
    "## Window Preview",
    "",
    "| arm | grid | P_low | P_high | P* | max_profit | original_profit |",
    "|---|---:|---:|---:|---:|---:|---:|",
    ...windowRows.map((row) => [
      row.arm,
      row.grid,
      row.P_low,
      row.P_high,
      row.P_star,
      row.max_profit,
      row.original_profit
    ].join(" | ")).map((line) => `| ${line} |`)
  ].join("\n");
  fs.writeFileSync(path.join(OUT_DIR, "summary.md"), `${markdown}\n`);

  console.log(JSON.stringify({
    out_dir: OUT_DIR,
    curves: curveRows.length,
    windows: windowRows.length,
    params: paramRows.length
  }, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
