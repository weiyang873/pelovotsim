#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");

function loadEnvFile() {
  const envPath = path.join(ROOT, ".env");
  if (!fs.existsSync(envPath)) return;
  const lines = fs.readFileSync(envPath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const index = trimmed.indexOf("=");
    if (index <= 0) continue;
    const key = trimmed.slice(0, index).trim();
    let value = trimmed.slice(index + 1).trim();
    value = value.replace(/^['"]|['"]$/g, "");
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

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

async function main() {
  loadEnvFile();
  if (process.env.LLM_MODEL_OVERRIDE === undefined && process.env.DEEPSEEK_MODEL !== undefined) {
    process.env.LLM_MODEL_OVERRIDE = process.env.DEEPSEEK_MODEL;
  }
  if (process.env.DEEPSEEK_DISABLE_THINKING === undefined) {
    process.env.DEEPSEEK_DISABLE_THINKING = "1";
  }
  const args = parseArgs(process.argv);
  const seed = Number(args.seed);
  if (!Number.isInteger(seed)) throw new Error("--seed must be an integer");
  const batch = String(args.batch ?? "").trim();
  if (!batch) throw new Error("--batch required");
  const teams = args.teams === undefined ? 1 : Number(args.teams);
  if (!Number.isInteger(teams) || teams < 1) throw new Error("--teams must be a positive integer");

  const { runTeam } = require("../server/synthetic/teamSim/orchestrator");
  const results = [];
  for (let i = 0; i < teams; i += 1) {
    const teamSeed = seed + i;
    console.log(`[teamSim] start seed=${teamSeed} batch=${batch} model=${process.env.LLM_MODEL_OVERRIDE}`);
    const result = await runTeam({ seed: teamSeed, batch });
    results.push(result);
    console.log(`[teamSim] done ${result.team_id} profit=${result.r2_profit} price=${result.r2_price} cards=${result.r2_card_count}`);
  }
  console.log(JSON.stringify({ synthetic: true, batch, seed, teams, results }, null, 2));
}

main().catch((error) => {
  console.error("[teamSim] failed", error);
  process.exitCode = 1;
});
