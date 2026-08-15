#!/usr/bin/env node
// Offline regression: replay every leader "operate" turn that was indexed as action=none in the
// failed 2026-08-14 task-blind runs, through the fixed normalizeR1ActorUiEvent + deterministic
// click detectors. No LLM calls: uses the recorded actor text and recorded extractor LLM output.
const fs = require("fs");
const path = require("path");
const { __r1ActorTestables } = require("../../server/synthetic/teamSim/orchestrator.js");
const { normalizeR1ActorUiEvent } = __r1ActorTestables;

const RUNS_ROOT = process.argv[2];
if (!RUNS_ROOT) {
  console.error("usage: node replay_r1_actor_isolated_noop_fix.js <team_pilot_run_dir>");
  process.exit(1);
}

function loadJsonl(file) {
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line));
}

const teamDirs = fs.readdirSync(RUNS_ROOT)
  .map((name) => path.join(RUNS_ROOT, name))
  .filter((dir) => fs.existsSync(path.join(dir, "r1_actor_isolated_checkpoint.json")));

let totalNoop = 0;
let nowIndexed = 0;
const perTeam = [];
for (const dir of teamDirs) {
  const checkpoint = JSON.parse(fs.readFileSync(path.join(dir, "r1_actor_isolated_checkpoint.json"), "utf8"));
  if (checkpoint.phase === "submitted") continue;
  const extractorRows = loadJsonl(path.join(dir, "r1_actor_isolated_extractors.jsonl"));
  const llmByEvent = new Map();
  for (const row of extractorRows) {
    if (row.status === "ok" && row.raw) llmByEvent.set(row.event, row.raw);
  }
  let uiState = { grid_id: "", architecture: "", vp_summary: { who: "", pain: "", how: "" } };
  let teamNoop = 0;
  let teamFixed = 0;
  let unblocks = null;
  for (const turn of checkpoint.turns) {
    const before = JSON.parse(JSON.stringify(uiState));
    uiState = turn.ui_state_after;
    if (turn.entrance_decision !== "operate" || turn.indexed_ui_event.action !== "none") continue;
    teamNoop += 1;
    totalNoop += 1;
    let parsed = null;
    const llmRaw = llmByEvent.get(turn.event);
    if (llmRaw) {
      try { parsed = JSON.parse(llmRaw.replace(/^```json\s*|```\s*$/g, "")); } catch { parsed = null; }
    }
    let event;
    try {
      event = normalizeR1ActorUiEvent(parsed || { action: "none" }, {
        phase: turn.phase,
        isLeader: true,
        raw: turn.raw,
        uiState: before
      });
    } catch (error) {
      event = { action: "none", error: error.message };
    }
    if (event.action !== "none") {
      teamFixed += 1;
      nowIndexed += 1;
      if (!unblocks) unblocks = { event: turn.event, action: event.action, grid: event.grid_id, arch: event.architecture, evidence: (event.evidence_quote || "").slice(0, 60) };
    }
  }
  perTeam.push({
    seed: path.basename(dir).split(":").pop(),
    stuck_phase: checkpoint.phase,
    noop_operates: teamNoop,
    now_indexed: teamFixed,
    first_unblock: unblocks
  });
}

perTeam.sort((a, b) => a.seed.localeCompare(b.seed));
for (const row of perTeam) {
  console.log(`seed ${row.seed} [${row.stuck_phase}] noop_operates=${row.noop_operates} now_indexed=${row.now_indexed}` +
    (row.first_unblock ? ` first_unblock=ev${row.first_unblock.event} ${row.first_unblock.action} ${row.first_unblock.grid || ""}${row.first_unblock.arch || ""} | ${row.first_unblock.evidence}` : " STILL_BLOCKED"));
}
console.log(`\ntotal formerly-noop operate turns: ${totalNoop}, now indexed: ${nowIndexed}`);
console.log(`teams unblocked (>=1 formerly-noop turn now indexes): ${perTeam.filter((t) => t.now_indexed > 0).length}/${perTeam.length}`);
