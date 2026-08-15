#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "../..");
const RUN_ROOT = path.join(ROOT, "runs_v4flash_0731");
const ARMS = ["simple", "d4d5_chat", "d4d5_chat_satisfice", "layered"];
const CONDITIONS = ["Q", "S"];
const OUTPUT_JSON = path.join(RUN_ROOT, "master_table.json");
const OUTPUT_CSV = path.join(RUN_ROOT, "master_table.csv");

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function csvCell(value) {
  const text = String(value == null ? "" : typeof value === "object" ? JSON.stringify(value) : value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, "\"\"")}"` : text;
}

function writeCsv(filePath, rows, columns) {
  fs.writeFileSync(filePath, `${[columns.join(","), ...rows.map((row) => columns.map((column) => csvCell(row[column])).join(","))].join("\n")}\n`, "utf8");
}

function round(value, digits = 6) {
  const num = Number(value);
  if (!Number.isFinite(num)) return null;
  const scale = 10 ** digits;
  return Math.round(num * scale) / scale;
}

function percentileNearest(values, pct) {
  const sorted = values.filter((value) => Number.isFinite(Number(value))).map(Number).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const index = Math.ceil((pct / 100) * sorted.length) - 1;
  return sorted[Math.max(0, Math.min(sorted.length - 1, index))];
}

function populationSd(values) {
  const nums = values.filter((value) => Number.isFinite(Number(value))).map(Number);
  if (!nums.length) return null;
  const mean = nums.reduce((sum, value) => sum + value, 0) / nums.length;
  const variance = nums.reduce((sum, value) => sum + ((value - mean) ** 2), 0) / nums.length;
  return Math.sqrt(variance);
}

function increment(object, key) {
  const text = String(key);
  object[text] = (object[text] || 0) + 1;
}

function profitOf(row) {
  return Number(row?.r2?.calculate?.metrics?.profit ?? row?.r2?.calculate?.output?.profit);
}

function priceOf(row) {
  return Number(row?.r2?.d5?.parsed?.aligned_price ?? row?.r2?.d5?.parsed?.price ?? row?.r2?.calculate?.input?.P);
}

function cardsOf(row) {
  return Array.isArray(row?.r2?.d4?.parsed?.cards) ? row.r2.d4.parsed.cards : [];
}

function configKey(cards) {
  return cards
    .map((card) => `${String(card.id || card.cap_id || "").trim()}@${String(card.tier || "").trim()}`)
    .filter((item) => item !== "@")
    .sort((a, b) => a.localeCompare(b))
    .join("|");
}

function chainKeyFromArtifact(artifact) {
  const row = artifact.row || {};
  return artifact.chain_key || artifact.source_chain_key || row.source_chain_key || `${artifact.persona_id || row.persona_id}|${artifact.condition || row.condition}|${Number(artifact.rep || row.rep || 1)}`;
}

function loadArmRows(arm) {
  const chainsDir = path.join(RUN_ROOT, arm, "chains");
  if (!fs.existsSync(chainsDir)) throw new Error(`chains dir missing: ${chainsDir}`);
  return fs.readdirSync(chainsDir)
    .filter((file) => file.endsWith(".json"))
    .sort((a, b) => a.localeCompare(b))
    .map((file) => {
      const artifact = readJson(path.join(chainsDir, file));
      const row = artifact.row || {};
      return {
        arm,
        file: path.relative(ROOT, path.join(chainsDir, file)),
        chain_key: chainKeyFromArtifact(artifact),
        persona_id: artifact.persona_id || row.persona_id,
        archetype: artifact.archetype || row.archetype || row.persona_pool_record?.archetype || String(artifact.persona_id || row.persona_id || "").split("-")[0],
        condition: artifact.condition || row.condition,
        rep: Number(artifact.rep || row.rep || 1),
        row
      };
    });
}

function summarizeGroup(arm, condition, records) {
  const profits = records.map((record) => profitOf(record.row)).filter(Number.isFinite);
  const prices = records.map((record) => priceOf(record.row)).filter(Number.isFinite);
  const cardCountDistribution = {};
  const configKeys = new Set();
  const missing = [];

  for (const record of records) {
    const profit = profitOf(record.row);
    const price = priceOf(record.row);
    const cards = cardsOf(record.row);
    if (!Number.isFinite(profit) || !Number.isFinite(price) || !cards.length) {
      missing.push({
        chain_key: record.chain_key,
        file: record.file,
        has_profit: Number.isFinite(profit),
        has_price: Number.isFinite(price),
        card_count: cards.length
      });
    }
    increment(cardCountDistribution, cards.length);
    configKeys.add(configKey(cards));
  }

  const lossCount = profits.filter((profit) => profit < 0).length;
  return {
    arm,
    condition,
    paired_key: "persona_id",
    chains_total: records.length,
    personas_total: new Set(records.map((record) => record.persona_id)).size,
    loss_chain_count: lossCount,
    loss_rate: round(records.length ? lossCount / records.length : 0, 6),
    profit_p25: percentileNearest(profits, 25),
    profit_p50: percentileNearest(profits, 50),
    profit_p75: percentileNearest(profits, 75),
    selected_card_count_distribution: cardCountDistribution,
    price_p50: percentileNearest(prices, 50),
    price_sd: round(populationSd(prices), 6),
    unique_config_count: configKeys.size,
    missing_value_count: missing.length,
    missing_values: missing
  };
}

function main() {
  const rows = [];
  for (const arm of ARMS) {
    const records = loadArmRows(arm);
    for (const condition of CONDITIONS) {
      rows.push(summarizeGroup(arm, condition, records.filter((record) => record.condition === condition)));
    }
  }

  const result = {
    generated_at: new Date().toISOString(),
    source_root: path.relative(ROOT, RUN_ROOT),
    arms: ARMS,
    conditions: CONDITIONS,
    row_grain: "arm × condition",
    paired_key: "persona_id",
    methods: {
      loss_rule: "profit < 0",
      profit_source: "row.r2.calculate.metrics.profit, fallback row.r2.calculate.output.profit",
      percentile_method: "nearest_rank",
      price_source: "row.r2.d5.parsed.aligned_price, fallback parsed.price/calculate.input.P",
      price_sd_method: "population",
      unique_config_key: "sorted D4 selected cards as cap_id@tier; price not included"
    },
    rows
  };

  fs.writeFileSync(OUTPUT_JSON, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  const csvRows = rows.map((row) => ({
    ...row,
    selected_card_count_distribution: JSON.stringify(row.selected_card_count_distribution),
    missing_values: JSON.stringify(row.missing_values)
  }));
  writeCsv(OUTPUT_CSV, csvRows, [
    "arm",
    "condition",
    "paired_key",
    "chains_total",
    "personas_total",
    "loss_chain_count",
    "loss_rate",
    "profit_p25",
    "profit_p50",
    "profit_p75",
    "selected_card_count_distribution",
    "price_p50",
    "price_sd",
    "unique_config_count",
    "missing_value_count",
    "missing_values"
  ]);
  process.stdout.write(`${JSON.stringify({
    master_table_json: path.relative(ROOT, OUTPUT_JSON),
    master_table_csv: path.relative(ROOT, OUTPUT_CSV),
    rows: rows.length
  }, null, 2)}\n`);
}

if (require.main === module) {
  main();
}
