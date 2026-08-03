#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const OUTPUT_ROOT = path.join(ROOT, "data", "synthetic", "team_sim");

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith("--")) throw new Error(`unexpected arg: ${token}`);
    const key = token.slice(2);
    const value = argv[i + 1];
    if (value === undefined || value.startsWith("--")) throw new Error(`missing value for --${key}`);
    args[key] = value;
    i += 1;
  }
  return args;
}

function readJson(filePath) {
  if (!fs.existsSync(filePath)) return null;
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify({ synthetic: true, ...value }, null, 2)}\n`);
}

function teamDirs(batchDir) {
  if (!fs.existsSync(batchDir)) throw new Error(`missing batch dir: ${path.relative(ROOT, batchDir)}`);
  return fs.readdirSync(batchDir)
    .filter((name) => fs.statSync(path.join(batchDir, name)).isDirectory())
    .sort((a, b) => seedFromTeamId(a) - seedFromTeamId(b))
    .map((name) => path.join(batchDir, name));
}

function seedFromTeamId(teamId) {
  const match = String(teamId).match(/-(\d+)$/);
  return match ? Number(match[1]) : NaN;
}

function mean(values) {
  const valid = values.filter((value) => Number.isFinite(value));
  if (!valid.length) return null;
  return valid.reduce((sum, value) => sum + value, 0) / valid.length;
}

function sd(values) {
  const valid = values.filter((value) => Number.isFinite(value));
  if (!valid.length) return null;
  const m = mean(valid);
  const variance = valid.reduce((sum, value) => sum + ((value - m) ** 2), 0) / valid.length;
  return Math.sqrt(variance);
}

function increment(map, key) {
  const k = String(key ?? "missing");
  map[k] = (map[k] || 0) + 1;
}

function collectR1Speakers(r1) {
  const speakers = new Set();
  for (const entry of r1?.transcript || []) {
    if (entry.speaker && entry.speaker !== "moderator") speakers.add(entry.speaker);
  }
  for (const turn of r1?.turns || []) {
    for (const speaker of turn.speakers || []) {
      if (speaker.speaker && speaker.speaker !== "moderator") speakers.add(speaker.speaker);
    }
  }
  return Array.from(speakers).sort();
}

function pointType(decisionPoint) {
  if (String(decisionPoint).startsWith("cards_segment_")) return "cards";
  if (decisionPoint === "prototype") return "prototype";
  if (decisionPoint === "price") return "price";
  return "other";
}

function longestCommonSubstringLength(a, b) {
  const left = Array.from(String(a || ""));
  const right = Array.from(String(b || ""));
  if (!left.length || !right.length) return 0;
  let best = 0;
  let previous = new Array(right.length + 1).fill(0);
  for (let i = 1; i <= left.length; i += 1) {
    const current = new Array(right.length + 1).fill(0);
    for (let j = 1; j <= right.length; j += 1) {
      if (left[i - 1] === right[j - 1]) {
        current[j] = previous[j - 1] + 1;
        if (current[j] > best) best = current[j];
      }
    }
    previous = current;
  }
  return best;
}

function repetitionStats(r2Transcript) {
  let utterances = 0;
  let repeatedUtterances = 0;
  let pairs = 0;
  let repeatedPairs = 0;
  const repeatedKeys = new Set();
  for (const block of r2Transcript?.transcript || []) {
    const items = (block.transcript || [])
      .map((entry, index) => ({ ...entry, index }))
      .filter((entry) => entry.speaker && entry.speaker !== "moderator" && String(entry.text || "").trim());
    utterances += items.length;
    for (let i = 0; i < items.length; i += 1) {
      for (let j = i + 1; j < items.length; j += 1) {
        pairs += 1;
        const a = String(items[i].text || "");
        const b = String(items[j].text || "");
        const denom = Math.min(Array.from(a).length, Array.from(b).length);
        const overlap = denom > 0 ? longestCommonSubstringLength(a, b) / denom : 0;
        if (overlap > 0.8) {
          repeatedPairs += 1;
          repeatedKeys.add(`${block.decision_point}:${items[i].index}`);
          repeatedKeys.add(`${block.decision_point}:${items[j].index}`);
        }
      }
    }
  }
  repeatedUtterances += repeatedKeys.size;
  return {
    r2_utterances: utterances,
    r2_repeated_utterances: repeatedUtterances,
    r2_repetition_utterance_ratio: utterances ? repeatedUtterances / utterances : null,
    r2_utterance_pairs: pairs,
    r2_repeated_pairs: repeatedPairs,
    r2_repeated_pair_ratio: pairs ? repeatedPairs / pairs : null
  };
}

function summarizeTeam(teamDir) {
  const teamId = path.basename(teamDir);
  const seed = seedFromTeamId(teamId);
  const error = readJson(path.join(teamDir, "team_error.json"));
  const runMeta = readJson(path.join(teamDir, "run_meta.json"));
  const r1Frozen = readJson(path.join(teamDir, "r1_frozen.json"));
  const r1Transcript = readJson(path.join(teamDir, "r1_transcript.json"));
  const r2Checkpoints = readJson(path.join(teamDir, "r2_checkpoints.json"));
  const r2Transcript = readJson(path.join(teamDir, "r2_transcript.json"));
  const settlement = readJson(path.join(teamDir, "settlement.json"));
  const terminationTuple = (r2Checkpoints?.checkpoints || []).map((item) => ({
    decision_point: item.decision_point,
    termination: item.termination
  }));
  const repeated = repetitionStats(r2Transcript);
  if (error || !settlement) {
    return {
      team_id: teamId,
      seed,
      failed: true,
      error: error?.error || { message: "missing settlement.json" },
      r1_grid: r1Frozen?.grid_id || null,
      r1_architecture: r1Frozen?.architecture || null,
      r2_prototype: settlement?.r2_prototype?.prototype || null,
      cards_count: Array.isArray(settlement?.r2_cards) ? settlement.r2_cards.length : null,
      price: settlement?.r2_price ?? null,
      profit: settlement?.profit ?? null,
      profitable: settlement?.profitable ?? null,
      coverCore: settlement?.r2?.coverCore ?? null,
      termination_tuple: terminationTuple,
      r1_speaker_count: collectR1Speakers(r1Transcript).length,
      ...repeated
    };
  }
  return {
    team_id: teamId,
    seed,
    failed: false,
    r1_grid: r1Frozen?.grid_id || settlement.r1_frozen?.grid_id || null,
    r1_architecture: r1Frozen?.architecture || settlement.r1_frozen?.architecture || null,
    r2_prototype: settlement.r2_prototype?.prototype || null,
    cards_count: Array.isArray(settlement.r2_cards) ? settlement.r2_cards.length : null,
    price: settlement.r2_price,
    profit: settlement.profit,
    profitable: settlement.profitable,
    coverCore: settlement.r2?.coverCore ?? null,
    termination_tuple: terminationTuple,
    r1_speaker_count: collectR1Speakers(r1Transcript).length,
    profile_ids: runMeta?.profile_ids || [],
    leader_id: runMeta?.leader_id || null,
    ...repeated
  };
}

function buildBatchSummary(rows) {
  const successes = rows.filter((row) => !row.failed);
  const failures = rows.filter((row) => row.failed);
  const prices = successes.map((row) => Number(row.price));
  const cardsCounts = successes.map((row) => Number(row.cards_count));
  const cardsDistribution = {};
  const gridDistribution = {};
  const prototypeDistribution = {};
  const r1SpeakerDistribution = {};
  const leaderByPoint = {};
  const leaderByType = {};
  for (const row of successes) {
    increment(cardsDistribution, row.cards_count);
    increment(gridDistribution, row.r1_grid);
    increment(prototypeDistribution, row.r2_prototype);
    increment(r1SpeakerDistribution, row.r1_speaker_count);
    for (const item of row.termination_tuple || []) {
      const point = item.decision_point;
      const type = pointType(point);
      if (!leaderByPoint[point]) leaderByPoint[point] = { leader_decision: 0, total: 0, ratio: null };
      if (!leaderByType[type]) leaderByType[type] = { leader_decision: 0, total: 0, ratio: null };
      leaderByPoint[point].total += 1;
      leaderByType[type].total += 1;
      if (item.termination === "leader_decision") {
        leaderByPoint[point].leader_decision += 1;
        leaderByType[type].leader_decision += 1;
      }
    }
  }
  for (const obj of [leaderByPoint, leaderByType]) {
    for (const value of Object.values(obj)) {
      value.ratio = value.total ? value.leader_decision / value.total : null;
    }
  }
  const totalUtterances = successes.reduce((sum, row) => sum + Number(row.r2_utterances || 0), 0);
  const repeatedUtterances = successes.reduce((sum, row) => sum + Number(row.r2_repeated_utterances || 0), 0);
  const totalPairs = successes.reduce((sum, row) => sum + Number(row.r2_utterance_pairs || 0), 0);
  const repeatedPairs = successes.reduce((sum, row) => sum + Number(row.r2_repeated_pairs || 0), 0);
  return {
    team_count: rows.length,
    successful_team_count: successes.length,
    failed_team_count: failures.length,
    failures: failures.map((row) => ({ seed: row.seed, team_id: row.team_id, error: row.error })),
    loss_rate: successes.length ? successes.filter((row) => row.profitable === false).length / successes.length : null,
    price_mean: mean(prices),
    price_sd: sd(prices),
    cards_count_distribution: cardsDistribution,
    cards_count_mean: mean(cardsCounts),
    cards_count_sd: sd(cardsCounts),
    grid_distribution: gridDistribution,
    prototype_distribution: prototypeDistribution,
    leader_decision_by_decision_point: leaderByPoint,
    leader_decision_by_type: leaderByType,
    r1_speaker_count_distribution: r1SpeakerDistribution,
    r2_repetition: {
      utterances: totalUtterances,
      repeated_utterances: repeatedUtterances,
      repetition_utterance_ratio: totalUtterances ? repeatedUtterances / totalUtterances : null,
      utterance_pairs: totalPairs,
      repeated_pairs: repeatedPairs,
      repeated_pair_ratio: totalPairs ? repeatedPairs / totalPairs : null
    }
  };
}

function main() {
  const args = parseArgs(process.argv);
  const batch = String(args.batch || "").trim();
  if (!batch) throw new Error("--batch required");
  const batchDir = path.join(OUTPUT_ROOT, batch);
  const rows = teamDirs(batchDir).map(summarizeTeam);
  const result = {
    batch,
    generated_at: new Date().toISOString(),
    teams: rows,
    batch_summary: buildBatchSummary(rows)
  };
  writeJson(path.join(batchDir, "batch_summary.json"), result);
  console.log(JSON.stringify({ synthetic: true, ...result }, null, 2));
}

main();
