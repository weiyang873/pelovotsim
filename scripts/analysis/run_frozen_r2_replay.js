"use strict";
// Preset-driven Round-2 replay for frozen lines (r2_replay presets in team_sim_presets.js).
// Usage: node scripts/analysis/run_frozen_r2_replay.js --preset <name> --rep <1..5> [--concurrency N] [--control <controlName>]
const fs = require("node:fs");
const path = require("node:path");
const { FROZEN_PRESETS } = require("./team_sim_presets");
const ROOT = path.join(__dirname, "..", "..");

function loadLocalEnv() {
  const envPath = path.join(ROOT, ".env");
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const t = line.trim(); if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("="); if (i <= 0) continue;
    const k = t.slice(0, i).trim(); let v = t.slice(i + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (!Object.prototype.hasOwnProperty.call(process.env, k)) process.env[k] = v;
  }
}

function parseArgs(argv) {
  const args = { preset: "", rep: 0, concurrency: null, control: "", limit: 0 };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--preset") args.preset = String(argv[++i] || "");
    else if (a === "--rep") args.rep = Number(argv[++i]);
    else if (a === "--concurrency") args.concurrency = Number(argv[++i]);
    else if (a === "--control") args.control = String(argv[++i] || "");
    else if (a === "--limit") args.limit = Number(argv[++i]);
    else throw new Error(`unknown argument: ${a}`);
  }
  if (!args.preset) throw new Error("--preset required");
  if (!Number.isInteger(args.rep) || args.rep < 1) throw new Error("--rep must be a positive integer");
  return args;
}

async function main() {
  loadLocalEnv();
  const args = parseArgs(process.argv.slice(2));
  const preset = FROZEN_PRESETS[args.preset];
  if (!preset || preset.runner_type !== "r2_replay") throw new Error(`unknown r2_replay preset: ${args.preset}`);
  const env = { ...preset.env };
  let batchPrefix = preset.args.batchPrefix;
  if (args.control) {
    const control = preset.controls?.[args.control];
    if (!control || !control.env_delta) throw new Error(`unknown control: ${args.control}`);
    Object.assign(env, control.env_delta);
    batchPrefix = control.evidence_prefix || `${batchPrefix}_${args.control}`;
  }
  for (const [k, v] of Object.entries(env)) process.env[k] = String(v);
  const modulePath = path.join(ROOT, preset.module);
  if (!fs.existsSync(modulePath)) throw new Error(`frozen module missing: ${preset.module}`);
  const { runR2FromExistingR1 } = require(modulePath);
  const sources = (preset.source_batches[args.rep - 1] || []).map((rel) => path.join(ROOT, rel)).filter((dir) => fs.existsSync(dir));
  if (!sources.length) throw new Error(`no source batches for rep ${args.rep}`);
  const sourceDirs = [];
  for (const batchDir of sources) {
    for (const name of fs.readdirSync(batchDir)) {
      const dir = path.join(batchDir, name);
      if (fs.existsSync(path.join(dir, "r1_frozen.json"))) sourceDirs.push(dir);
    }
  }
  const pickedDirs = args.limit > 0 ? sourceDirs.slice(0, args.limit) : sourceDirs;
  const batch = `${batchPrefix}${args.limit > 0 ? "_smoke" : ""}_rep${args.rep}_${new Date().toISOString().slice(0, 10).replace(/-/g, "")}`;
  const concurrency = args.concurrency || preset.args.concurrency || 3;
  const { default: pLimit } = await import("p-limit");
  const limit = pLimit(concurrency);
  const results = []; const failures = [];
  await Promise.all(pickedDirs.map((sourceDir) => limit(async () => {
    try {
      const r = await runR2FromExistingR1({ sourceDir, batch, arm: preset.args.arm });
      const price = r.r2_price ?? r.price ?? null;
      const cards = Array.isArray(r.r2_cards) ? r.r2_cards.length : (Array.isArray(r.cards) ? r.cards.length : (r.r2_card_count ?? null));
      const profit = r.r2_profit ?? r.profit ?? null;
      results.push({ source: path.relative(ROOT, sourceDir), price, cards, profit, output_dir: r.output_dir ? path.relative(ROOT, r.output_dir) : null });
      console.error(`[frozen-r2] done ${path.basename(sourceDir)} price=${price} cards=${cards}`);
    } catch (error) {
      failures.push({ source: path.relative(ROOT, sourceDir), error: String(error?.message || error) });
      console.error(`[frozen-r2] failed ${path.basename(sourceDir)}: ${String(error?.message || error)}`);
    }
  })));
  const summary = { preset: args.preset, control: args.control || null, code_tag: preset.code_tag, module: preset.module, batch, env, arm: preset.args.arm, rep: args.rep, sources: sources.map((d) => path.relative(ROOT, d)), results, failures };
  const outDir = path.join(ROOT, "runs_v4flash_0731", "team_r2_replay", batch);
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, "frozen_replay_summary.json"), `${JSON.stringify(summary, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({ batch, ok: results.length, failed: failures.length }, null, 2));
  if (failures.length) process.exitCode = 1;
}

if (require.main === module) main().catch((e) => { console.error(e.stack || e.message || String(e)); process.exitCode = 1; });
