#!/usr/bin/env node
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { runSql } = require("../../server/db/pgSql");

const ROOT = path.join(__dirname, "..", "..");
const SQLITE_DB = path.join(ROOT, "sim.db");

function sqliteCount(table) {
  const out = spawnSync("sqlite3", ["-json", SQLITE_DB, `SELECT COUNT(*) AS c FROM ${table};`], { encoding: "utf8" });
  if (out.status !== 0) throw new Error(out.stderr || `sqlite read failed: ${table}`);
  const rows = JSON.parse(String(out.stdout || "[]") || "[]");
  return Number(rows?.[0]?.c || 0);
}

async function pgCount(table) {
  const rows = await runSql(`SELECT COUNT(*)::int AS c FROM ${table};`);
  return Number(rows?.[0]?.c || 0);
}

async function checkPair(table) {
  const s = sqliteCount(table);
  const p = await pgCount(table);
  return { table, sqlite: s, postgres: p, match: s === p };
}

async function main() {
  const legacy = [
    "teams",
    "team_members",
    "member_submissions",
    "jinang_settlements",
    "round2_dimension_assignments",
    "round2_member_selections",
    "round2_interview_sessions",
    "team_runs",
    "iteration_events",
    "llm_wizard_outputs",
    "llm_call_metrics"
  ];

  const results = [];
  for (const table of legacy) {
    results.push(await checkPair(table));
  }
  const canonical = {
    games: await pgCount("games"),
    teams: await pgCount("teams"),
    members: await pgCount("members"),
    round1_individual: await pgCount("round1_individual"),
    round1_team: await pgCount("round1_team"),
    round2_team: await pgCount("round2_team"),
    global_config: await pgCount("global_config")
  };

  const ok = results.every((r) => r.match);
  console.log(JSON.stringify({ ok, legacy: results, canonical }, null, 2));
  if (!ok) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
