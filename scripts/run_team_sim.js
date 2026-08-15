#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const OUTPUT_ROOT = path.join(ROOT, "data", "synthetic", "team_sim");
const { configureBatchLlmDefaults } = require("./sim/llm_env");

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

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify({ synthetic: true, ...value }, null, 2)}\n`);
}

function writeFailureRecord({ batch, seed, error }) {
  const teamId = `SYN-${batch}-${seed}`;
  const outputDir = path.join(OUTPUT_ROOT, batch, teamId);
  const record = {
    failed: true,
    batch,
    seed,
    team_id: teamId,
    failed_at: new Date().toISOString(),
    error: {
      name: String(error?.name || "Error"),
      message: String(error?.message || error),
      stack: String(error?.stack || "")
    }
  };
  writeJson(path.join(outputDir, "team_error.json"), record);
  return { ...record, output_dir: outputDir };
}

async function main() {
  loadEnvFile();
  const args = parseArgs(process.argv);
  if (args.model) {
    process.env.LLM_MODEL_OVERRIDE = String(args.model).trim();
    const provider = String(process.env.LLM_PROVIDER || "").trim().toLowerCase();
    if (provider === "qwen") process.env.QWEN_MODEL = process.env.LLM_MODEL_OVERRIDE;
    if (provider === "deepseek") process.env.DEEPSEEK_MODEL = process.env.LLM_MODEL_OVERRIDE;
  }
  configureBatchLlmDefaults();
  const seed = Number(args.seed);
  if (!Number.isInteger(seed)) throw new Error("--seed must be an integer");
  const batch = String(args.batch ?? "").trim();
  if (!batch) throw new Error("--batch required");
  const teams = args.teams === undefined ? 1 : Number(args.teams);
  if (!Number.isInteger(teams) || teams < 1) throw new Error("--teams must be a positive integer");

  const { runTeam } = require("../server/synthetic/teamSim/orchestrator");
  const results = [];
  const failures = [];
  for (let i = 0; i < teams; i += 1) {
    const teamSeed = seed + i;
    console.log(`[teamSim] start seed=${teamSeed} batch=${batch} model=${process.env.LLM_MODEL_OVERRIDE}`);
    try {
      const result = await runTeam({ seed: teamSeed, batch });
      results.push(result);
      console.log(`[teamSim] done ${result.team_id} profit=${result.r2_profit} price=${result.r2_price} cards=${result.r2_card_count}`);
    } catch (error) {
      const failure = writeFailureRecord({ batch, seed: teamSeed, error });
      failures.push(failure);
      console.error(`[teamSim] failed seed=${teamSeed}`, error);
    }
  }
  const summary = { synthetic: true, batch, seed, teams, results, failures };
  console.log(JSON.stringify(summary, null, 2));
  if ((teams === 1 && failures.length > 0) || failures.length >= 5) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error("[teamSim] failed", error);
  process.exitCode = 1;
});
