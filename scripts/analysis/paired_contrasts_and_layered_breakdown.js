#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "../..");
const RUN_ROOT = path.join(ROOT, "runs_v4flash_0731");
const OUTPUT = path.join(RUN_ROOT, "paired_contrasts_layered_breakdown.json");
const BOOTSTRAP_B = 5000;
const BOOTSTRAP_SEED = 20260806;
const CONDITIONS = ["Q", "S"];
const ARM_DIRS = {
  simple: "simple",
  chat: "d4d5_chat",
  satisfice: "d4d5_chat_satisfice",
  layered: "layered"
};
const CONTRASTS = [
  { id: "layered-simple", treatment: "layered", base: "simple" },
  { id: "chat-simple", treatment: "chat", base: "simple" },
  { id: "satisfice-chat", treatment: "satisfice", base: "chat" },
  { id: "satisfice-simple", treatment: "satisfice", base: "simple", note: "extra fourth contrast inferred from four-contrast request" }
];

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function createSeededRandom(seedText) {
  let h = 2166136261;
  const text = String(seedText || "");
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return function random() {
    h += 0x6D2B79F5;
    let t = h;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function round(value, digits = 6) {
  const num = Number(value);
  if (!Number.isFinite(num)) return null;
  const scale = 10 ** digits;
  return Math.round(num * scale) / scale;
}

function median(values) {
  const sorted = values.filter((value) => Number.isFinite(Number(value))).map(Number).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function percentile(values, pct) {
  const sorted = values.filter((value) => Number.isFinite(Number(value))).map(Number).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const rank = (pct / 100) * (sorted.length - 1);
  const low = Math.floor(rank);
  const high = Math.ceil(rank);
  if (low === high) return sorted[low];
  return sorted[low] + (sorted[high] - sorted[low]) * (rank - low);
}

function increment(object, key, by = 1) {
  const text = String(key);
  object[text] = (object[text] || 0) + by;
}

function chainKey(artifact) {
  const row = artifact.row || {};
  return artifact.chain_key || artifact.source_chain_key || row.source_chain_key || `${artifact.persona_id || row.persona_id}|${artifact.condition || row.condition}|${Number(artifact.rep || row.rep || 1)}`;
}

function profitOf(row) {
  return Number(row?.r2?.calculate?.metrics?.profit ?? row?.r2?.calculate?.output?.profit);
}

function priceOf(row) {
  return Number(row?.r2?.d5?.parsed?.aligned_price ?? row?.r2?.d5?.parsed?.price ?? row?.r2?.calculate?.input?.P);
}

function loadArm(armAlias) {
  const dir = path.join(RUN_ROOT, ARM_DIRS[armAlias], "chains");
  const records = [];
  for (const file of fs.readdirSync(dir).filter((name) => name.endsWith(".json")).sort((a, b) => a.localeCompare(b))) {
    const artifact = readJson(path.join(dir, file));
    const row = artifact.row || {};
    const profit = profitOf(row);
    records.push({
      arm: armAlias,
      file: path.relative(ROOT, path.join(dir, file)),
      chain_key: chainKey(artifact),
      persona_id: artifact.persona_id || row.persona_id,
      archetype: artifact.archetype || row.archetype || row.persona_pool_record?.archetype || String(artifact.persona_id || row.persona_id || "").split("-")[0],
      condition: artifact.condition || row.condition,
      profit,
      loss: Number.isFinite(profit) ? profit < 0 : null,
      price: priceOf(row),
      row
    });
  }
  return records;
}

function indexByPersonaCondition(records) {
  const map = new Map();
  for (const record of records) {
    map.set(`${record.persona_id}|${record.condition}`, record);
  }
  return map;
}

function bootstrapLossRateDiff(pairs, b, seed) {
  const random = createSeededRandom(seed);
  const n = pairs.length;
  const values = [];
  for (let iter = 0; iter < b; iter += 1) {
    let sum = 0;
    for (let index = 0; index < n; index += 1) {
      const pair = pairs[Math.floor(random() * n)];
      sum += Number(pair.treatment_loss) - Number(pair.base_loss);
    }
    values.push(sum / n);
  }
  return {
    B: b,
    seed,
    ci95: [round(percentile(values, 2.5), 6), round(percentile(values, 97.5), 6)]
  };
}

function buildContrastRows(data) {
  const rows = [];
  for (const contrast of CONTRASTS) {
    const treatment = data[contrast.treatment];
    const base = data[contrast.base];
    for (const condition of CONDITIONS) {
      const pairs = [];
      for (const personaId of [...new Set(base.records.filter((record) => record.condition === condition).map((record) => record.persona_id))].sort()) {
        const baseRecord = base.byKey.get(`${personaId}|${condition}`);
        const treatmentRecord = treatment.byKey.get(`${personaId}|${condition}`);
        if (!baseRecord || !treatmentRecord) continue;
        pairs.push({
          persona_id: personaId,
          base_loss: baseRecord.loss,
          treatment_loss: treatmentRecord.loss,
          base_profit: baseRecord.profit,
          treatment_profit: treatmentRecord.profit,
          profit_diff: treatmentRecord.profit - baseRecord.profit
        });
      }
      const table = {
        base_nonloss_treatment_nonloss: 0,
        base_nonloss_treatment_loss: 0,
        base_loss_treatment_nonloss: 0,
        base_loss_treatment_loss: 0
      };
      for (const pair of pairs) {
        if (!pair.base_loss && !pair.treatment_loss) table.base_nonloss_treatment_nonloss += 1;
        else if (!pair.base_loss && pair.treatment_loss) table.base_nonloss_treatment_loss += 1;
        else if (pair.base_loss && !pair.treatment_loss) table.base_loss_treatment_nonloss += 1;
        else table.base_loss_treatment_loss += 1;
      }
      const lossRateDiff = pairs.reduce((sum, pair) => sum + Number(pair.treatment_loss) - Number(pair.base_loss), 0) / pairs.length;
      rows.push({
        contrast: contrast.id,
        treatment_arm: contrast.treatment,
        base_arm: contrast.base,
        condition,
        paired_key: "persona_id",
        pairs: pairs.length,
        mcnemar_table: table,
        discordant_worse_count: table.base_nonloss_treatment_loss,
        discordant_better_count: table.base_loss_treatment_nonloss,
        treatment_loss_rate_minus_base: round(lossRateDiff, 6),
        bootstrap_loss_rate_diff_ci95: bootstrapLossRateDiff(pairs, BOOTSTRAP_B, `${BOOTSTRAP_SEED}:${contrast.id}:${condition}`),
        profit_diff_median: median(pairs.map((pair) => pair.profit_diff)),
        note: contrast.note || ""
      });
    }
  }
  return rows;
}

function classifyLayeredQLoss(record, profitableShareMedian) {
  const output = record.row?.r2?.calculate?.output || {};
  const unitMargin = Number(output.unitMargin);
  const actualGm = Number(output.actualGm);
  const units = Number(output.units);
  const breakeven = Number(output.breakeven_q);
  const share = Number(output.share ?? output.adoption);
  if (Number.isFinite(unitMargin) && unitMargin <= 0) return "price_too_low";
  if (Number.isFinite(actualGm) && actualGm <= 0) return "price_too_low";
  if (Number.isFinite(breakeven) && Number.isFinite(units) && units < breakeven) {
    if (Number.isFinite(share) && Number.isFinite(profitableShareMedian) && share < profitableShareMedian) return "share_insufficient";
    return "cost_too_high";
  }
  return "cost_too_high";
}

function layeredQBreakdown(layeredRecords) {
  const qRecords = layeredRecords.filter((record) => record.condition === "Q");
  const losses = qRecords.filter((record) => record.loss);
  const profitableShareMedian = median(qRecords
    .filter((record) => !record.loss)
    .map((record) => Number(record.row?.r2?.calculate?.output?.share ?? record.row?.r2?.calculate?.output?.adoption)));
  const lossByArchetype = {};
  const attribution = {};
  const attributionByArchetype = {};
  const lossDetails = [];
  for (const record of losses) {
    increment(lossByArchetype, record.archetype);
    const cause = classifyLayeredQLoss(record, profitableShareMedian);
    increment(attribution, cause);
    if (!attributionByArchetype[cause]) attributionByArchetype[cause] = {};
    increment(attributionByArchetype[cause], record.archetype);
    const output = record.row?.r2?.calculate?.output || {};
    lossDetails.push({
      persona_id: record.persona_id,
      archetype: record.archetype,
      profit: record.profit,
      price: record.price,
      attribution: cause,
      unitMargin: Number(output.unitMargin),
      actualGm: round(output.actualGm, 6),
      units: Number(output.units),
      breakeven_q: Number.isFinite(Number(output.breakeven_q)) ? Number(output.breakeven_q) : null,
      share: round(output.share ?? output.adoption, 6),
      f_total: Number(output.f_total),
      dCOGS: Number(output.dCOGS),
      COGS: Number(output.COGS)
    });
  }

  const d5Groups = {
    d5_once: qRecords.filter((record) => Number(record.row?.r2?.d5?.attempts || 0) <= 1),
    d5_repaired: qRecords.filter((record) => Number(record.row?.r2?.d5?.attempts || 0) > 1)
  };
  const d5RepairBreakdown = {};
  for (const [name, records] of Object.entries(d5Groups)) {
    const lossCount = records.filter((record) => record.loss).length;
    d5RepairBreakdown[name] = {
      chains: records.length,
      price_p50: median(records.map((record) => record.price)),
      loss_count: lossCount,
      loss_rate: round(records.length ? lossCount / records.length : 0, 6)
    };
  }

  return {
    cell: "layered × Q",
    chains: qRecords.length,
    loss_chains: losses.length,
    profitable_share_median_threshold: round(profitableShareMedian, 6),
    loss_by_archetype: lossByArchetype,
    attribution_rule: {
      price_too_low: "unitMargin <= 0 or actualGm <= 0",
      share_insufficient: "positive unit margin but units < breakeven_q and share below profitable layered×Q median share",
      cost_too_high: "positive unit margin loss not below the share threshold; fixed/total cost burden remains above realized contribution"
    },
    attribution_counts: attribution,
    attribution_by_archetype: attributionByArchetype,
    d5_repair_breakdown: d5RepairBreakdown,
    loss_details: lossDetails
  };
}

function simplePriceDistribution(simpleRecords) {
  const out = {};
  for (const condition of CONDITIONS) {
    const records = simpleRecords.filter((record) => record.condition === condition);
    const distribution = {};
    const lossByPrice = {};
    for (const record of records) {
      increment(distribution, record.price);
      if (record.loss) increment(lossByPrice, record.price);
    }
    out[condition] = {
      chains: records.length,
      price_p50: median(records.map((record) => record.price)),
      loss_count: records.filter((record) => record.loss).length,
      loss_rate: round(records.filter((record) => record.loss).length / records.length, 6),
      price_distribution: distribution,
      loss_count_by_price: lossByPrice
    };
  }
  return out;
}

function main() {
  const data = {};
  for (const arm of Object.keys(ARM_DIRS)) {
    const records = loadArm(arm);
    data[arm] = { records, byKey: indexByPersonaCondition(records) };
  }
  const result = {
    generated_at: new Date().toISOString(),
    source_root: path.relative(ROOT, RUN_ROOT),
    bootstrap: {
      B: BOOTSTRAP_B,
      seed: BOOTSTRAP_SEED,
      resampling_unit: "persona_id within condition",
      ci: "percentile 95%"
    },
    contrasts: buildContrastRows(data),
    layered_q_breakdown: layeredQBreakdown(data.layered.records),
    simple_q_vs_s_price_distribution: simplePriceDistribution(data.simple.records)
  };
  writeJson(OUTPUT, result);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

if (require.main === module) {
  main();
}
