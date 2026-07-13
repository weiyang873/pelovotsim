"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const ROOT = path.join(__dirname, "..", "..");
const LOG_ROOT = path.join(ROOT, "data", "persona_sim_logs");
const V2_PATH = path.join(ROOT, "game_config_v0.1", "grid_dimension_evidence_v2.json");
const ENGINE_PATH = path.join(ROOT, "server", "llm", "rdCalculator.js");

const RUNS = [
  { key: "R0", runId: "sim_layered_newflow_2026-07-10T23-54-52-761Z", arm: "layered (7/10 original)" },
  { key: "R1", runId: "sim_layered_newflow_2026-07-12T13-00-04-209Z", arm: "layered (rerun)" },
  { key: "R2", runId: "sim_layered_structured_v1_2026-07-12T10-49-47-429Z", arm: "structured (P1)" },
  { key: "R2a", runId: "sim_structured_no_pricing_v1_2026-07-12T12-36-46-679Z", arm: "structured no-pricing ablation" },
  { key: "R3", runId: "sim_simple_persona_v1_2026-07-12T11-17-30-309Z", arm: "simple (A1)" },
  { key: "R4", runId: "sim_harness_enforced_v1_2026-07-12T12-17-49-445Z", arm: "harness (P2)" }
];

const CSV_COLUMNS = [
  "team_index", "grid", "price", "cards", "high_tier_count",
  "coverCore_v2", "coverNice_v2", "vscore_v2", "share_v2",
  "units_v2", "profit_v2", "is_profitable_v2"
];

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function sha256File(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function csvValue(value) {
  const text = value == null ? "" : String(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, "\"\"")}"` : text;
}

function writeCsv(filePath, rows) {
  const lines = [CSV_COLUMNS.join(",")];
  for (const row of rows) {
    lines.push(CSV_COLUMNS.map((column) => csvValue(row[column])).join(","));
  }
  fs.writeFileSync(filePath, `${lines.join("\n")}\n`, "utf8");
}

function median(values) {
  const sorted = values.map(Number).filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function formatNumber(value, digits = 3) {
  const number = Number(value);
  return Number.isFinite(number) ? number.toFixed(digits) : "N/A";
}

function cardsLabel(selections) {
  return (selections || []).map((selection) => `${selection.cap_id}:${selection.tier}`).join("|");
}

function engineInput(preview, submit, tags, radar) {
  const previewBody = preview.requestBody || {};
  const submitBody = submit.requestBody || {};
  const input = {
    ...previewBody,
    selections: submitBody.selections,
    radar: radar || submitBody.radar || {},
    tags,
    evi: Number.isFinite(Number(submitBody.evi)) ? Number(submitBody.evi) : Number(previewBody.evi),
    P: Number(submitBody.price),
    wtp_multiplier: Number.isFinite(Number(submitBody.wtp_multiplier))
      ? Number(submitBody.wtp_multiplier)
      : Number(previewBody.wtp_multiplier),
    sessionId: "replay_v2_tags"
  };
  delete input.teamId;
  return input;
}

function summarizeOriginal(rows) {
  return {
    profitable: rows.filter((row) => row.originalProfit > 0).length,
    totalProfit: rows.reduce((sum, row) => sum + row.originalProfit, 0),
    meanPrice: rows.reduce((sum, row) => sum + row.price, 0) / rows.length,
    coverCoreMedian: median(rows.map((row) => row.originalCoverCore)),
    coverNiceMedian: median(rows.map((row) => row.originalCoverNice)),
    vscoreMedian: median(rows.map((row) => row.originalVscore))
  };
}

function summarizeV2(rows) {
  return {
    profitable: rows.filter((row) => row.profit_v2 > 0).length,
    totalProfit: rows.reduce((sum, row) => sum + row.profit_v2, 0),
    meanPrice: rows.reduce((sum, row) => sum + row.price, 0) / rows.length,
    coverCoreMedian: median(rows.map((row) => row.coverCore_v2)),
    coverNiceMedian: median(rows.map((row) => row.coverNice_v2)),
    vscoreMedian: median(rows.map((row) => row.vscore_v2))
  };
}

function writeSummary(filePath, summaries) {
  const lines = [
    "# Replay Under v2 Tags",
    "",
    "> DATA CAVEAT：本 replay 中 AI 决策时并不知道 v2 tags（决策依据是报告文本，与 v2 tags 同源但非精确对齐）。结果定性为\"决策与判分基准间接对齐\"条件下的经济后果，可用于臂间相对比较；绝对水平的正式基线以 runner 信息集对齐后的重跑为准。",
    "",
    "| Run | Arm | Profitable original | Profitable v2 | Total profit original | Total profit v2 | Mean price | coverCore median original | coverCore median v2 | coverNice median original | coverNice median v2 | vscore median original | vscore median v2 |",
    "|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|"
  ];
  for (const item of summaries) {
    const original = item.original;
    const v2 = item.v2;
    lines.push(`| ${item.key} | ${item.arm} | ${original.profitable}/12 | ${v2.profitable}/12 | ${Math.round(original.totalProfit)} | ${Math.round(v2.totalProfit)} | ${formatNumber(v2.meanPrice, 0)} | ${formatNumber(original.coverCoreMedian)} | ${formatNumber(v2.coverCoreMedian)} | ${formatNumber(original.coverNiceMedian)} | ${formatNumber(v2.coverNiceMedian)} | ${formatNumber(original.vscoreMedian, 4)} | ${formatNumber(v2.vscoreMedian, 4)} |`);
  }
  fs.writeFileSync(filePath, `${lines.join("\n")}\n`, "utf8");
}

async function replayRun(run, tagsByGrid, calculate) {
  const runDir = path.join(LOG_ROOT, run.runId);
  const entries = readJson(path.join(runDir, "all_entries.json"));
  const previews = entries.filter((entry) => entry.step === "R2.7_calculate_preview");
  const submits = entries.filter((entry) => entry.step === "R2.7_submit_final");
  if (previews.length !== 12 || submits.length !== 12) {
    throw new Error(`${run.runId}: expected 12 previews and submits, got ${previews.length}/${submits.length}`);
  }

  const rows = [];
  for (let teamIndex = 0; teamIndex < previews.length; teamIndex += 1) {
    const preview = previews[teamIndex];
    const submit = submits.find((entry) => entry.teamId === preview.teamId);
    if (!submit) throw new Error(`${run.runId} team ${teamIndex}: submit not found`);
    const submitBody = submit.requestBody || {};
    const grid = String(preview.requestBody?.gridId || "").trim();
    const v2Tags = tagsByGrid.get(grid);
    if (!v2Tags) throw new Error(`${run.runId} team ${teamIndex}: v2 tags missing for ${grid}`);

    const finalRadar = submit.responseBody?.radar?.radar || submitBody.radar || {};
    const originalTags = Array.isArray(submit.responseBody?.radar?.tags)
      ? submit.responseBody.radar.tags
      : (Array.isArray(submitBody.tags) ? submitBody.tags : []);
    const loggedProfit = Number(submit.responseBody?.result?.profit);
    const originalEviCandidates = Array.from(new Set([
      Number(submitBody.evi),
      0.85
    ].filter(Number.isFinite)));
    let originalResult = null;
    let originalEvi = null;
    for (const candidateEvi of originalEviCandidates) {
      const candidateInput = engineInput(preview, submit, originalTags, finalRadar);
      candidateInput.evi = candidateEvi;
      const candidateResult = await calculate(candidateInput);
      if (Number.isFinite(loggedProfit) && Math.abs(Number(candidateResult.profit) - loggedProfit) <= 1) {
        originalResult = candidateResult;
        originalEvi = candidateEvi;
        break;
      }
    }
    if (!originalResult) {
      throw new Error(`${run.runId} team ${teamIndex}: no original EVI candidate reproduced logged profit ${loggedProfit}`);
    }

    const v2Result = await calculate(engineInput(preview, submit, v2Tags, submitBody.radar || {}));
    const selections = Array.isArray(submitBody.selections) ? submitBody.selections : [];
    rows.push({
      team_index: teamIndex,
      grid,
      price: Number(submitBody.price),
      cards: cardsLabel(selections),
      high_tier_count: selections.filter((selection) => selection.tier === "high").length,
      coverCore_v2: Number(v2Result.coverCore),
      coverNice_v2: Number(v2Result.coverNice),
      vscore_v2: Number(v2Result.V),
      share_v2: Number(v2Result.share),
      units_v2: Number(v2Result.units),
      profit_v2: Number(v2Result.profit),
      is_profitable_v2: Number(v2Result.profit) > 0,
      originalProfit: loggedProfit,
      originalCoverCore: Number(originalResult.coverCore),
      originalCoverNice: Number(originalResult.coverNice),
      originalVscore: Number(submit.responseBody?.result?.vscore),
      originalEvi
    });
  }
  return rows;
}

async function main() {
  const generatedAt = new Date().toISOString();
  const outDir = path.join(LOG_ROOT, `replay_v2_tags_${generatedAt.replace(/[:.]/g, "-")}`);
  fs.mkdirSync(outDir, { recursive: true });
  const evidence = readJson(V2_PATH);
  const tagsByGrid = new Map((evidence.grids || []).map((row) => [row.grid_id, row.tags]));
  const { calculate } = require("../../server/llm/rdCalculator");

  const originalLog = console.log;
  const originalWarn = console.warn;
  console.log = () => {};
  console.warn = () => {};
  const summaries = [];
  try {
    for (const run of RUNS) {
      const rows = await replayRun(run, tagsByGrid, calculate);
      writeCsv(path.join(outDir, `${run.runId}_replay_v2.csv`), rows);
      summaries.push({
        key: run.key,
        runId: run.runId,
        arm: run.arm,
        original: summarizeOriginal(rows),
        v2: summarizeV2(rows)
      });
    }
  } finally {
    console.log = originalLog;
    console.warn = originalWarn;
  }

  const r1 = summaries.find((item) => item.key === "R1");
  if (r1?.v2?.profitable !== 8) {
    throw new Error(`R1 anchor failed: expected 8/12 profitable, got ${r1?.v2?.profitable}/12`);
  }
  writeSummary(path.join(outDir, "replay_summary.md"), summaries);

  const commitResult = spawnSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" });
  const dirtyResult = spawnSync("git", ["status", "--porcelain"], { cwd: ROOT, encoding: "utf8" });
  const manifest = {
    replay_version: "v1",
    generated_at: generatedAt,
    rows: summaries.length * 12,
    tags_source: {
      file: path.relative(ROOT, V2_PATH),
      sha256: sha256File(V2_PATH)
    },
    engine: {
      file: path.relative(ROOT, ENGINE_PATH),
      sha256: sha256File(ENGINE_PATH),
      commit: String(commitResult.stdout || "").trim(),
      worktree_dirty: String(dirtyResult.stdout || "").trim().length > 0
    },
    source_runs: RUNS.map((run) => ({ key: run.key, run_id: run.runId, arm: run.arm })),
    anchor: {
      run_id: RUNS.find((run) => run.key === "R1").runId,
      expected_profitable: 8,
      actual_profitable: r1.v2.profitable,
      passed: true
    }
  };
  fs.writeFileSync(path.join(outDir, "replay_meta.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({ outDir, summaries, manifest }, null, 2));
}

main().catch((error) => {
  console.error(error.stack || error.message || String(error));
  process.exitCode = 1;
});
