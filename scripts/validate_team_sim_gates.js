#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { PERSONAS } = require("./sim/persona_pool");

const ROOT = path.resolve(__dirname, "..");
const OUTPUT_ROOT = path.join(ROOT, "data", "synthetic", "team_sim");
const CONFIG_PATH = path.join(ROOT, "game_config_v0.1", "team_sim_config.json");

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
  if (!fs.existsSync(filePath)) throw new Error(`missing file: ${path.relative(ROOT, filePath)}`);
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function makeRng(seedInput) {
  let state = crypto.createHash("sha256").update(String(seedInput)).digest().readUInt32LE(0);
  return function rng() {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function sampleWithoutReplacement(items, count, rng) {
  if (count > items.length) throw new Error(`cannot sample ${count} from ${items.length}`);
  const copy = items.slice();
  const picked = [];
  while (picked.length < count) {
    const index = Math.floor(rng() * copy.length);
    picked.push(copy.splice(index, 1)[0]);
  }
  return picked;
}

function buildProfilePoolIds() {
  const tendencies = ["high", "mid", "low"];
  const ids = Object.keys(PERSONAS).sort();
  const pool = [];
  for (const id of ids) {
    for (let i = 0; i < 5; i += 1) {
      pool.push({
        profile_id: `${id}-${String(i + 1).padStart(2, "0")}`,
        archetype_id: id,
        speaking_tendency: tendencies[(ids.indexOf(id) + i) % tendencies.length]
      });
    }
  }
  return pool;
}

function expectedSample(seed, teamSize) {
  const rng = makeRng(seed);
  const members = sampleWithoutReplacement(buildProfilePoolIds(), teamSize, rng);
  const leaderIdx = Math.floor(rng() * members.length);
  return {
    profile_ids: members.map((member) => member.profile_id),
    leader_id: members[leaderIdx].profile_id
  };
}

function collectSharedEntries(r1, r2) {
  const entries = [];
  for (const entry of r1.transcript || []) {
    entries.push({ stage: "r1", speaker: entry.speaker, text: String(entry.text || "") });
  }
  for (const block of r2.transcript || []) {
    for (const entry of block.transcript || []) {
      entries.push({ stage: `r2:${block.decision_point}`, speaker: entry.speaker, text: String(entry.text || "") });
    }
  }
  return entries;
}

function privateCardOwners(r1) {
  const owners = new Map();
  for (const proposal of r1.proposals || []) {
    const system = String(proposal.prompt?.[0]?.content || "");
    const user = String(proposal.prompt?.[1]?.content || "");
    const id = (system.match(/姓名代号：([^\n]+)/) || [])[1];
    if (!id) throw new Error("proposal prompt missing profile id");
    for (const match of user.matchAll(/(市场锦囊|技术锦囊)：([^。]+)。/g)) {
      owners.set(match[2], id);
    }
  }
  return owners;
}

function validatePrivateContext(r1, r2) {
  const owners = privateCardOwners(r1);
  const sharedEntries = collectSharedEntries(r1, r2);
  const hits = [];
  const violations = [];
  for (const [card, owner] of owners.entries()) {
    for (const entry of sharedEntries) {
      if (!entry.text.includes(card)) continue;
      const hit = { card, owner, stage: entry.stage, speaker: entry.speaker, text: entry.text };
      hits.push(hit);
      if (entry.speaker !== owner) violations.push(hit);
    }
  }
  return {
    checked_cards: Array.from(owners.entries()).map(([card, owner]) => ({ card, owner })),
    hits,
    violations,
    pass: violations.length === 0
  };
}

function collectR1Speakers(r1) {
  const speakers = new Set();
  for (const entry of r1.transcript || []) {
    if (entry.speaker && entry.speaker !== "moderator") speakers.add(entry.speaker);
  }
  for (const turn of r1.turns || []) {
    for (const speaker of turn.speakers || []) {
      if (speaker.speaker && speaker.speaker !== "moderator") speakers.add(speaker.speaker);
    }
  }
  return Array.from(speakers).sort();
}

function countWillingnessDefaults(...logs) {
  let count = 0;
  for (const log of logs) {
    const blocks = Array.isArray(log.transcript) ? log.transcript : [log];
    for (const block of blocks) {
      for (const turn of block.turns || []) {
        for (const item of turn.willingness || []) {
          if (item.defaulted === true) count += 1;
        }
      }
    }
  }
  return count;
}

function splitSentences(text) {
  return String(text || "")
    .split(/[。！？!?；;\n]+/)
    .map((item) => item.trim())
    .filter((item) => item.length > 5);
}

function validateNoR1TranscriptLeak(r1, r2) {
  const r1Sentences = [];
  for (const entry of r1.transcript || []) {
    if (entry.speaker === "moderator") continue;
    for (const sentence of splitSentences(entry.text)) r1Sentences.push(sentence);
  }
  const leaks = [];
  for (const block of r2.transcript || []) {
    for (const entry of block.transcript || []) {
      for (const sentence of r1Sentences) {
        if (String(entry.text || "").includes(sentence)) {
          leaks.push({ decision_point: block.decision_point, speaker: entry.speaker, sentence });
        }
      }
    }
  }
  return { checked_sentence_count: r1Sentences.length, leaks, pass: leaks.length === 0 };
}

function teamDirs(batchDir) {
  if (!fs.existsSync(batchDir)) throw new Error(`missing batch dir: ${path.relative(ROOT, batchDir)}`);
  return fs.readdirSync(batchDir)
    .filter((name) => fs.statSync(path.join(batchDir, name)).isDirectory())
    .sort()
    .map((name) => path.join(batchDir, name));
}

function validateTeam(teamDir, config) {
  const runMeta = readJson(path.join(teamDir, "run_meta.json"));
  const r1 = readJson(path.join(teamDir, "r1_transcript.json"));
  const r1Frozen = readJson(path.join(teamDir, "r1_frozen.json"));
  const r2Checkpoints = readJson(path.join(teamDir, "r2_checkpoints.json"));
  const r2Transcript = readJson(path.join(teamDir, "r2_transcript.json"));
  const settlement = readJson(path.join(teamDir, "settlement.json"));
  const rawFiles = fs.readdirSync(teamDir)
    .filter((name) => name.endsWith(".json"))
    .map((name) => fs.readFileSync(path.join(teamDir, name), "utf8"))
    .join("\n");

  const expected = expectedSample(runMeta.seed, Number(config.team_size));
  const speakers = collectR1Speakers(r1);
  const privateContext = validatePrivateContext(r1, r2Transcript);
  const noR1TranscriptLeak = validateNoR1TranscriptLeak(r1, r2Transcript);
  const checkpointNames = r2Checkpoints.checkpoints.map((item) => item.decision_point);
  const finalCardCheckpoint = r2Checkpoints.checkpoints.find((item) => item.decision_point === "cards_segment_3");
  const compatibility = finalCardCheckpoint?.compatibility;

  const gate1 = {
    r1_frozen_exists: Boolean(r1Frozen.synthetic),
    no_parse_failure_marker: !rawFiles.includes("parse_failure"),
    no_invalid_reason_marker: !rawFiles.includes("invalid_reason"),
    willingness_default_count: countWillingnessDefaults(r1, r2Transcript),
    r1_speakers: speakers,
    r1_speaker_count: speakers.length,
    r1_speaker_gate_pass: speakers.length >= 4,
    deterministic_sample: {
      expected_profile_ids: expected.profile_ids,
      actual_profile_ids: runMeta.profile_ids,
      expected_leader_id: expected.leader_id,
      actual_leader_id: runMeta.leader_id,
      profiles_match: JSON.stringify(expected.profile_ids) === JSON.stringify(runMeta.profile_ids),
      leader_match: expected.leader_id === runMeta.leader_id
    },
    private_context: privateContext
  };

  const gate2 = {
    checkpoint_count: r2Checkpoints.checkpoints.length,
    checkpoint_names: checkpointNames,
    all_five_checkpoints_present: JSON.stringify(checkpointNames) === JSON.stringify([
      "prototype",
      "cards_segment_1",
      "cards_segment_2",
      "cards_segment_3",
      "price"
    ]),
    final_selection_hardViolationCount: compatibility?.hardViolationCount,
    final_selection_violations: compatibility?.violations,
    final_selection_valid: compatibility?.hardViolationCount === 0,
    no_r1_transcript_leak: noR1TranscriptLeak,
    settlement_has_rd_fields: Number.isFinite(Number(settlement.r2?.profit)) && Number.isFinite(Number(settlement.r2?.share)),
    settlement_profit: settlement.profit,
    settlement_profitable: settlement.profitable
  };

  const teamResult = {
    team_id: runMeta.team_id,
    seed: runMeta.seed,
    directory: path.relative(ROOT, teamDir),
    gate1,
    gate2,
    pass: gate1.r1_frozen_exists
      && gate1.no_parse_failure_marker
      && gate1.no_invalid_reason_marker
      && gate1.willingness_default_count === 0
      && gate1.r1_speaker_gate_pass
      && gate1.deterministic_sample.profiles_match
      && gate1.deterministic_sample.leader_match
      && gate1.private_context.pass
      && gate2.all_five_checkpoints_present
      && gate2.final_selection_valid
      && gate2.no_r1_transcript_leak.pass
      && gate2.settlement_has_rd_fields
  };
  if (runMeta.seed === 43) {
    teamResult.gate1_status = "conditional";
    teamResult.gate1_status_note = "r1_speaker_count=2，已归因为多数派单边发言+moderator 早收敛；≥4 标准待真实课堂发言分布校准后裁定";
  }
  return teamResult;
}

function main() {
  const args = parseArgs(process.argv);
  const batch = String(args.batch || "").trim();
  if (!batch) throw new Error("--batch required");
  const expectedTeams = args["expected-teams"] === undefined ? null : Number(args["expected-teams"]);
  const config = readJson(CONFIG_PATH);
  const batchDir = path.join(OUTPUT_ROOT, batch);
  const dirs = teamDirs(batchDir);
  const teams = dirs.map((dir) => validateTeam(dir, config));
  const result = {
    synthetic: true,
    batch,
    expected_teams: expectedTeams,
    actual_teams: teams.length,
    team_count_pass: expectedTeams === null || teams.length === expectedTeams,
    teams,
    pass: (expectedTeams === null || teams.length === expectedTeams) && teams.every((team) => team.pass)
  };
  console.log(JSON.stringify(result, null, 2));
  if (!result.pass) process.exitCode = 1;
}

main();
