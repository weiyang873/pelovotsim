#!/usr/bin/env node
// Regression guard: replay every leader operate turn that WAS successfully indexed in past runs
// through the fixed normalizeR1ActorUiEvent, and diff the result against the recorded event.
const fs = require("fs");
const path = require("path");
const { __r1ActorTestables } = require("../../server/synthetic/teamSim/orchestrator.js");
const { normalizeR1ActorUiEvent } = __r1ActorTestables;

const roots = process.argv.slice(2);
if (!roots.length) {
  console.error("usage: node replay_r1_actor_isolated_regression.js <run_dir> [run_dir...]");
  process.exit(1);
}

function loadJsonl(file) {
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line));
}

let checked = 0;
let same = 0;
const diffs = [];
for (const root of roots) {
  const teamDirs = fs.readdirSync(root)
    .map((name) => path.join(root, name))
    .filter((dir) => fs.existsSync(path.join(dir, "r1_actor_isolated_checkpoint.json")));
  for (const dir of teamDirs) {
    const checkpoint = JSON.parse(fs.readFileSync(path.join(dir, "r1_actor_isolated_checkpoint.json"), "utf8"));
    const extractorRows = loadJsonl(path.join(dir, "r1_actor_isolated_extractors.jsonl"));
    const llmByEvent = new Map();
    for (const row of extractorRows) {
      if (row.status === "ok" && row.raw) llmByEvent.set(row.event, row.raw);
    }
    let uiState = { grid_id: "", architecture: "", vp_summary: { who: "", pain: "", how: "" } };
    for (const turn of checkpoint.turns) {
      const before = JSON.parse(JSON.stringify(uiState));
      uiState = turn.ui_state_after;
      const recorded = turn.indexed_ui_event;
      if (turn.entrance_decision !== "operate" || recorded.action === "none") continue;
      const llmRaw = llmByEvent.get(turn.event);
      if (!llmRaw) continue;
      let parsed = null;
      try { parsed = JSON.parse(llmRaw.replace(/^```json\s*|```\s*$/g, "")); } catch { continue; }
      checked += 1;
      let event;
      try {
        event = normalizeR1ActorUiEvent(parsed, { phase: turn.phase, isLeader: true, raw: turn.raw, uiState: before });
      } catch (error) {
        event = { action: "THROW:" + error.message };
      }
      const fields = (e) => [e.action, e.grid_id || "", e.architecture || "", (e.vp_summary || {}).who || "", (e.vp_summary || {}).pain || "", (e.vp_summary || {}).how || ""].join("|");
      if (fields(event) === fields(recorded)) {
        same += 1;
      } else {
        diffs.push({
          team: path.basename(dir).split("-").pop(),
          event: turn.event,
          phase: turn.phase,
          recorded: fields(recorded).slice(0, 120),
          recomputed: fields(event).slice(0, 120),
          raw: turn.raw.slice(0, 100)
        });
      }
    }
  }
}
console.log(`checked previously-indexed operate events: ${checked}, unchanged: ${same}, changed: ${diffs.length}`);
for (const diff of diffs.slice(0, 25)) {
  console.log(`\n[${diff.team} ev${diff.event} ${diff.phase}]`);
  console.log("  recorded  :", diff.recorded);
  console.log("  recomputed:", diff.recomputed);
  console.log("  raw       :", diff.raw.replace(/\n/g, " "));
}
