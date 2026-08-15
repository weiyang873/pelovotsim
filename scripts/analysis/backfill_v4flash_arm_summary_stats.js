#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "../..");
const DEFAULT_RUN_ROOT = path.join(ROOT, "runs_v4flash_0731");
const DEFAULT_ARMS = ["simple", "layered"];

function resolvePath(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  return path.isAbsolute(text) ? text : path.join(ROOT, text);
}

function parseArgs(argv) {
  const args = { runRoot: DEFAULT_RUN_ROOT, arms: DEFAULT_ARMS };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--run-root") args.runRoot = resolvePath(argv[++index]);
    else if (arg === "--arms") args.arms = String(argv[++index] || "").split(",").map((item) => item.trim()).filter(Boolean);
    else throw new Error(`unknown argument: ${arg}`);
  }
  return args;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function incrementNested(object, first, second) {
  if (!object[first]) object[first] = {};
  object[first][second] = (object[first][second] || 0) + 1;
}

function errorKind(errorText) {
  const text = String(errorText || "");
  if (/compatibility validation failed/i.test(text)) return "compatibility_validation";
  if (/missing tier/i.test(text)) return "missing_tier";
  if (/invalid tier/i.test(text)) return "invalid_tier";
  if (/cards must contain at least/i.test(text)) return "cards_min_count";
  if (/price .*(outside slider bounds|out of .* range)/i.test(text)) return "price_range";
  if (/Unexpected token|Unexpected end|JSON|parse/i.test(text)) return "json_parse";
  if (/grid_id must be non-empty text/i.test(text)) return "missing_grid_id";
  return text.split(/\r?\n/)[0].slice(0, 160) || "unknown";
}

function stageOfCall(call) {
  return call?.stage || call?.attempt_log?.find((attempt) => attempt?.stage)?.stage || "unknown";
}

function collectCallObjectsFrom(value, out, seen, chain) {
  if (!value) return;
  if (Array.isArray(value)) {
    for (const item of value) collectCallObjectsFrom(item, out, seen, chain);
    return;
  }
  if (typeof value !== "object") return;
  if (Array.isArray(value.attempt_log) && typeof value.attempts !== "undefined") {
    const stage = stageOfCall(value);
    const key = `${chain}|${stage}|${value.prompt_sha256 || ""}|${value.attempt_log.map((item) => item.raw_sha256 || "").join(",")}`;
    if (!seen.has(key)) {
      seen.add(key);
      out.push(value);
    }
  }
  for (const item of Object.values(value)) collectCallObjectsFrom(item, out, seen, chain);
}

function collectCallObjectsFromArtifact(artifact) {
  const out = [];
  const seen = new Set();
  const row = artifact.row || {};
  const chain = artifact.chain_key || row.source_chain_key || `${artifact.persona_id || row.persona_id}|${artifact.condition || row.condition}|${Number(artifact.rep || row.rep || 1)}`;
  collectCallObjectsFrom(row.question_definition, out, seen, chain);
  collectCallObjectsFrom(row.r1_choice, out, seen, chain);
  collectCallObjectsFrom(row.r2, out, seen, chain);
  return out;
}

function buildStats(chainsDir) {
  const files = fs.readdirSync(chainsDir).filter((file) => file.endsWith(".json")).sort((a, b) => a.localeCompare(b));
  const attemptsDistributionByStage = {};
  const validatorErrorsByKindStage = {};
  let call_objects_total = 0;
  let validator_error_attempts_total = 0;

  for (const file of files) {
    const artifact = readJson(path.join(chainsDir, file));
    const calls = collectCallObjectsFromArtifact(artifact);
    call_objects_total += calls.length;
    for (const call of calls) {
      const stage = stageOfCall(call);
      incrementNested(attemptsDistributionByStage, stage, String(call.attempts || 0));
      for (const attempt of call.attempt_log || []) {
        if (attempt.validator_status !== "error") continue;
        validator_error_attempts_total += 1;
        incrementNested(validatorErrorsByKindStage, errorKind(attempt.validator_error), attempt.stage || stage);
      }
    }
  }

  return {
    chains_examined: files.length,
    call_objects_total,
    validator_error_attempts_total,
    attempts_distribution_by_stage: attemptsDistributionByStage,
    validator_errors_by_kind_stage: validatorErrorsByKindStage
  };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const results = [];
  for (const arm of args.arms) {
    const armDir = path.join(args.runRoot, arm);
    const chainsDir = path.join(armDir, "chains");
    const summaryPath = path.join(armDir, "arm_summary.json");
    if (!fs.existsSync(chainsDir)) throw new Error(`chains dir missing: ${chainsDir}`);
    if (!fs.existsSync(summaryPath)) throw new Error(`arm_summary missing: ${summaryPath}`);
    const stats = buildStats(chainsDir);
    const summary = readJson(summaryPath);
    summary.attempts_distribution_by_stage = stats.attempts_distribution_by_stage;
    summary.validator_errors_by_kind_stage = stats.validator_errors_by_kind_stage;
    writeJson(summaryPath, summary);
    const result = {
      arm_id: arm,
      arm_summary: path.relative(ROOT, summaryPath),
      ...stats
    };
    results.push(result);
  }
  const output = { run_root: path.relative(ROOT, args.runRoot), arms: results };
  process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
}

if (require.main === module) {
  main();
}
