#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");

const {
  CALLS_PATH,
  EXPECTED_MODEL,
  OUTPUT_DIR,
  PROVIDER,
  SUMMARY_PATH,
  TEMPERATURE,
  createSmokeMonitor,
  ensureOutputDir,
  loadLocalEnv,
  readSmokeConfig,
  runSmokePersona,
  selectSmokePersonas
} = require("./smoke_single_v4flash");

function parseArgs(argv) {
  const args = { concurrency: null };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--concurrency") {
      args.concurrency = Number(argv[++index]);
    } else {
      throw new Error(`unknown argument: ${arg}`);
    }
  }
  if (!Number.isInteger(args.concurrency) || args.concurrency < 1) {
    throw new Error("--concurrency must be a positive integer");
  }
  return args;
}

function percentile(values, pct) {
  const sorted = values.filter((value) => Number.isFinite(Number(value))).map(Number).sort((a, b) => a - b);
  if (!sorted.length) return 0;
  const index = Math.ceil((pct / 100) * sorted.length) - 1;
  return sorted[Math.max(0, Math.min(sorted.length - 1, index))];
}

function mean(values) {
  const nums = values.filter((value) => Number.isFinite(Number(value))).map(Number);
  if (!nums.length) return 0;
  return nums.reduce((sum, value) => sum + value, 0) / nums.length;
}

function applicationRepairCalls(results) {
  return results.reduce((sum, result) => {
    const decisionJsonCalls = Number(result?.row?.calls?.decision_json || 0);
    return sum + Math.max(0, decisionJsonCalls - 4);
  }, 0);
}

function writeSummary(summary) {
  fs.mkdirSync(path.dirname(SUMMARY_PATH), { recursive: true });
  fs.writeFileSync(SUMMARY_PATH, `${JSON.stringify(summary, null, 2)}\n`);
}

function buildSummary({ concurrency, tasks, results, monitor, startedAt }) {
  const calls = monitor.calls;
  const fixedSixteenBaseline = tasks.length * 16;
  return {
    model: EXPECTED_MODEL,
    provider: PROVIDER,
    enable_thinking: false,
    temperature: TEMPERATURE,
    concurrency,
    personas_total: tasks.length,
    personas_ok: results.filter((item) => item?.row?.status === "OK").length,
    personas_failed: results.filter((item) => item?.row?.status !== "OK").length,
    calls_total: calls.length,
    count_429: calls.reduce((sum, call) => sum + Number(call.rate_limited_attempts || 0), 0),
    count_empty: calls.reduce((sum, call) => sum + Number(call.empty_attempts || 0), 0),
    transport_retry_count: calls.reduce((sum, call) => sum + Number(call.retry_count || 0), 0),
    application_repair_calls: applicationRepairCalls(results),
    expected_calls_if_fixed_16_steps: fixedSixteenBaseline,
    calls_delta_from_fixed_16_steps: calls.length - fixedSixteenBaseline,
    non_16_step_personas: results
      .filter((item) => Number.isFinite(Number(item?.chain_steps)) && Number(item.chain_steps) !== 16)
      .map((item) => ({ persona_id: item.persona_id, chain_steps: item.chain_steps })),
    latency_p50_ms: percentile(calls.map((call) => call.latency_ms), 50),
    latency_p95_ms: percentile(calls.map((call) => call.latency_ms), 95),
    wall_clock_total_ms: Date.now() - startedAt,
    completion_tokens_mean: mean(calls.map((call) => call.completion_tokens)),
    output_chars_mean: mean(calls.map((call) => call.output_chars))
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  loadLocalEnv();
  ensureOutputDir({ resetCalls: true });
  const config = readSmokeConfig();
  const monitor = createSmokeMonitor(config, { callsPath: CALLS_PATH });
  const { default: pLimit } = await import("p-limit");
  const FullGame = require("./analysis/full_game_all_personas");
  const materials = FullGame.loadMaterials();
  const tasks = selectSmokePersonas(materials, 20);
  const startedAt = Date.now();
  const limit = pLimit(args.concurrency);
  const results = new Array(tasks.length);
  let fatalError = null;

  await Promise.all(tasks.map((task, index) => limit(async () => {
    if (fatalError) {
      results[index] = { row: { status: "SKIPPED", error: fatalError.message }, persona_id: task.smokePersonaId };
      return;
    }
    const result = await runSmokePersona(task, {
      monitor,
      materials,
      enforceThinkingGuard: true
    });
    results[index] = result;
  }).catch((error) => {
    if (error.code === "THINKING_GUARD") {
      fatalError = fatalError || error;
    }
    results[index] = { row: { status: "FAIL", error: error.message || String(error) }, persona_id: task.smokePersonaId };
  })));

  const summary = buildSummary({
    concurrency: args.concurrency,
    tasks,
    results,
    monitor,
    startedAt
  });
  writeSummary(summary);

  process.stderr.write(`calls: ${path.relative(process.cwd(), CALLS_PATH)}\n`);
  process.stderr.write(`summary: ${path.relative(process.cwd(), SUMMARY_PATH)}\n`);
  if (fatalError || summary.personas_failed > 0) {
    process.exitCode = 1;
  }
}

if (require.main === module) {
  const originalLog = console.log;
  console.log = (...args) => console.error(...args);
  main().catch((error) => {
    console.error(error.stack || error.message || String(error));
    process.exitCode = 1;
  }).finally(() => {
    console.log = originalLog;
  });
}
