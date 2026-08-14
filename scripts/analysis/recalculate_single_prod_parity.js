#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "../..");
const RUN_ROOT = path.join(ROOT, "runs_v4flash_0731");
const DEFAULT_RUNS = [
  "simple",
  "layered",
  "simple_interface",
  "layered_interface",
  "random42_simple_interface",
  "random42_layered_interface",
  "f912715_replay",
  "random_persona_nomap_f912715_replay",
  "random_persona_f912715_replay",
  "roleplay_first_pilot_42S"
];

function parseArgs(argv) {
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..+$/u, "Z");
  const args = {
    runs: DEFAULT_RUNS.slice(),
    outDir: path.join(RUN_ROOT, `single_prod_parity_recalc_${stamp}`),
    verbose: false
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--runs") {
      args.runs = String(argv[++index] || "").split(",").map((item) => item.trim()).filter(Boolean);
    } else if (arg === "--out-dir") {
      args.outDir = path.resolve(ROOT, String(argv[++index] || "").trim());
    } else if (arg === "--verbose") {
      args.verbose = true;
    } else {
      throw new Error(`unknown argument: ${arg}`);
    }
  }
  if (!args.runs.length) throw new Error("--runs must not be empty");
  return args;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function appendJsonl(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.appendFileSync(filePath, `${JSON.stringify(value)}\n`, "utf8");
}

function csvCell(value) {
  const text = String(value == null ? "" : typeof value === "object" ? JSON.stringify(value) : value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, "\"\"")}"` : text;
}

function writeCsv(filePath, rows, columns) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${[columns.join(","), ...rows.map((row) => columns.map((column) => csvCell(row[column])).join(","))].join("\n")}\n`, "utf8");
}

function round(value, digits = 6) {
  const num = Number(value);
  if (!Number.isFinite(num)) return null;
  const scale = 10 ** digits;
  return Math.round(num * scale) / scale;
}

function populationSd(values) {
  const nums = values.filter((value) => Number.isFinite(Number(value))).map(Number);
  if (!nums.length) return null;
  const mean = nums.reduce((sum, value) => sum + value, 0) / nums.length;
  const variance = nums.reduce((sum, value) => sum + ((value - mean) ** 2), 0) / nums.length;
  return Math.sqrt(variance);
}

function percentileNearest(values, pct) {
  const sorted = values.filter((value) => Number.isFinite(Number(value))).map(Number).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const index = Math.ceil((pct / 100) * sorted.length) - 1;
  return sorted[Math.max(0, Math.min(sorted.length - 1, index))];
}

function chainKey(artifact, row) {
  return artifact.chain_key || artifact.source_chain_key || row.source_chain_key || `${artifact.persona_id || row.persona_id}|${artifact.condition || row.condition}|${Number(artifact.rep || row.rep || 1)}`;
}

function profitOf(calculate) {
  return Number(calculate?.metrics?.profit ?? calculate?.output?.profit);
}

function priceOf(row) {
  return Number(row?.r2?.d5?.parsed?.aligned_price ?? row?.r2?.d5?.parsed?.price ?? row?.r2?.calculate?.input?.P);
}

function cardsOf(row) {
  return Array.isArray(row?.r2?.d4?.parsed?.cards) ? row.r2.d4.parsed.cards : [];
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function normalizeEvidenceSignals(row) {
  const evi = row?.r2?.evidence_signals?.evi;
  if (!evi || typeof evi !== "object") return;
  if (Number.isFinite(Number(evi.base_value))) {
    row.r2.evidence_signals.evi = {
      ...evi,
      method: evi.base_method || "rdCalculator.computeEvi",
      value: Number(evi.base_value),
      production_parity_note: "simulation-only evi bonus removed for offline production-parity recalculation"
    };
  }
}

function rebuildRound1(row, materials, FullGame) {
  const r1 = row.r1_choice?.parsed;
  const scores = row.vp_report_only?.output?.scores || row.vp_report_only?.scores;
  const jinangSettlement = row.r1_settlement?.jinang_settlement;
  if (!r1?.grid_id || !r1?.architecture) throw new Error("missing r1_choice.parsed grid_id/architecture");
  if (!scores) throw new Error("missing vp_report_only scores");
  if (!jinangSettlement) throw new Error("missing r1_settlement.jinang_settlement");
  return FullGame.buildRound1Outcome(r1.grid_id, r1.architecture, scores, jinangSettlement, materials);
}

function loadChainArtifacts(runName) {
  const chainsDir = path.join(RUN_ROOT, runName, "chains");
  if (!fs.existsSync(chainsDir)) throw new Error(`chains dir missing: ${path.relative(ROOT, chainsDir)}`);
  return fs.readdirSync(chainsDir)
    .filter((file) => file.endsWith(".json"))
    .sort((a, b) => a.localeCompare(b))
    .map((file) => {
      const filePath = path.join(chainsDir, file);
      const artifact = readJson(filePath);
      const row = artifact.row || artifact;
      return {
        run: runName,
        file,
        file_path: path.relative(ROOT, filePath),
        artifact,
        row
      };
    });
}

async function recalcRecord(record, materials, FullGame) {
  const oldRow = record.row;
  if (oldRow.status !== "OK") throw new Error(`source row not OK: ${oldRow.status || ""}`);
  const row = clone(oldRow);
  normalizeEvidenceSignals(row);
  row.r1_settlement = rebuildRound1(row, materials, FullGame);
  const oldCalculate = oldRow.r2?.calculate;
  const newCalculate = await FullGame.calculateR2(row, materials);
  row.r2.calculate = newCalculate;
  const oldProfit = profitOf(oldCalculate);
  const newProfit = profitOf(newCalculate);
  const price = priceOf(row);
  const cards = cardsOf(row);
  return {
    run: record.run,
    chain_key: chainKey(record.artifact, oldRow),
    file: record.file_path,
    persona_id: record.artifact.persona_id || oldRow.persona_id || "",
    archetype: record.artifact.archetype || oldRow.archetype || oldRow.persona_pool_record?.archetype || String(record.artifact.persona_id || oldRow.persona_id || "").split("-")[0],
    condition: record.artifact.condition || oldRow.condition || "",
    rep: Number(record.artifact.rep || oldRow.rep || 1),
    price,
    card_count: cards.length,
    old_profit: Number.isFinite(oldProfit) ? Math.round(oldProfit) : null,
    new_profit: Number.isFinite(newProfit) ? Math.round(newProfit) : null,
    profit_delta: Number.isFinite(oldProfit) && Number.isFinite(newProfit) ? Math.round(newProfit - oldProfit) : null,
    old_loss: Number.isFinite(oldProfit) ? oldProfit < 0 : null,
    new_loss: Number.isFinite(newProfit) ? newProfit < 0 : null,
    loss_flip: Number.isFinite(oldProfit) && Number.isFinite(newProfit) && (oldProfit < 0) !== (newProfit < 0),
    old_wtp_multiplier: round(oldRow.r1_settlement?.wtp_multiplier, 6),
    new_wtp_multiplier: round(row.r1_settlement?.wtp_multiplier, 6),
    old_wtpadj_scaled: round(oldRow.r1_settlement?.WTPadj_scaled, 6),
    new_wtpadj_scaled: round(row.r1_settlement?.WTPadj_scaled, 6),
    old_pmax: round(oldCalculate?.input?.Pmax, 6),
    new_pmax: round(newCalculate?.input?.Pmax, 6),
    old_wtp: round(oldCalculate?.input?.WTP, 6),
    new_wtp: round(newCalculate?.input?.WTP, 6),
    old_evi: round(oldCalculate?.input?.evi, 6),
    new_evi: round(newCalculate?.input?.evi, 6),
    r1_source: row.r1_settlement?.production_source || "",
    r2_source: newCalculate?.input?.source || ""
  };
}

function summarize(records) {
  const groups = new Map();
  for (const record of records) {
    const key = `${record.run}|${record.condition || "ALL"}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(record);
  }
  const rows = [];
  for (const [key, items] of groups.entries()) {
    const [run, condition] = key.split("|");
    const oldProfits = items.map((item) => item.old_profit).filter(Number.isFinite);
    const newProfits = items.map((item) => item.new_profit).filter(Number.isFinite);
    const prices = items.map((item) => item.price).filter(Number.isFinite);
    rows.push({
      run,
      condition,
      chains: items.length,
      old_loss_count: items.filter((item) => item.old_loss === true).length,
      old_loss_rate: round(items.filter((item) => item.old_loss === true).length / items.length, 6),
      new_loss_count: items.filter((item) => item.new_loss === true).length,
      new_loss_rate: round(items.filter((item) => item.new_loss === true).length / items.length, 6),
      loss_flips: items.filter((item) => item.loss_flip).length,
      old_profit_p50: percentileNearest(oldProfits, 50),
      new_profit_p50: percentileNearest(newProfits, 50),
      profit_delta_median: percentileNearest(items.map((item) => item.profit_delta), 50),
      price_p50: percentileNearest(prices, 50),
      price_sd: round(populationSd(prices), 6)
    });
  }
  return rows.sort((a, b) => `${a.run}|${a.condition}`.localeCompare(`${b.run}|${b.condition}`));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const originalLog = console.log;
  if (!args.verbose) console.log = () => {};
  const FullGame = require("./full_game_all_personas");
  const materials = FullGame.loadMaterials();
  const startedAt = new Date().toISOString();
  const rowsPath = path.join(args.outDir, "rows.jsonl");
  const rowsCsvPath = path.join(args.outDir, "rows.csv");
  const summaryPath = path.join(args.outDir, "summary.json");
  const summaryCsvPath = path.join(args.outDir, "summary.csv");
  fs.mkdirSync(args.outDir, { recursive: true });
  fs.writeFileSync(rowsPath, "", "utf8");

  const records = [];
  const failures = [];
  for (const run of args.runs) {
    const artifacts = loadChainArtifacts(run);
    for (const artifact of artifacts) {
      try {
        const record = await recalcRecord(artifact, materials, FullGame);
        records.push(record);
        appendJsonl(rowsPath, record);
      } catch (error) {
        failures.push({
          run,
          file: artifact.file_path,
          error: String(error?.stack || error?.message || error)
        });
      }
    }
  }

  const summaryRows = summarize(records);
  const summary = {
    generated_at: new Date().toISOString(),
    started_at: startedAt,
    source_runs: args.runs,
    chains_recalculated: records.length,
    failures_count: failures.length,
    failures,
    output_files: {
      rows_jsonl: path.relative(ROOT, rowsPath),
      rows_csv: path.relative(ROOT, rowsCsvPath),
      summary_json: path.relative(ROOT, summaryPath),
      summary_csv: path.relative(ROOT, summaryCsvPath)
    },
    method: {
      api_calls: false,
      r1: "rebuilt via scripts/analysis/full_game_all_personas.js::buildRound1Outcome, which delegates to server/routes/teamRoutes.js::buildRound1Outcome",
      r2: "rebuilt via scripts/analysis/full_game_all_personas.js::calculateR2 using production-parity Round2 Pmax/WTP/COGS inputs",
      decisions_reused: "source chain parsed R1 choice, VP scores, D4 cards, D5 price, and evidence signals"
    },
    by_run_condition: summaryRows
  };

  writeCsv(rowsCsvPath, records, Object.keys(records[0] || {
    run: "", chain_key: "", file: "", persona_id: "", archetype: "", condition: "", rep: "", price: "", card_count: "",
    old_profit: "", new_profit: "", profit_delta: "", old_loss: "", new_loss: "", loss_flip: ""
  }));
  writeCsv(summaryCsvPath, summaryRows, Object.keys(summaryRows[0] || {
    run: "", condition: "", chains: "", old_loss_count: "", old_loss_rate: "", new_loss_count: "", new_loss_rate: "", loss_flips: ""
  }));
  writeJson(summaryPath, summary);
  console.log = originalLog;
  process.stdout.write(`${JSON.stringify({
    output_dir: path.relative(ROOT, args.outDir),
    chains_recalculated: records.length,
    failures_count: failures.length,
    summary_json: path.relative(ROOT, summaryPath),
    summary_csv: path.relative(ROOT, summaryCsvPath)
  }, null, 2)}\n`);
  if (failures.length) process.exitCode = 1;
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.stack || error.message || String(error));
    process.exitCode = 1;
  });
}
