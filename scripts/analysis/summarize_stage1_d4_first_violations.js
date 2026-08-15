#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "../..");
const DEFAULT_SOURCE_DIR = path.join(ROOT, "runs_v4flash_0731", "simple", "chains");
const DEFAULT_OUTPUT_PATH = path.join(ROOT, "runs_v4flash_0731", "simple", "d4_first_violations_by_archetype.json");

function parseArgs(argv) {
  const args = { sourceDir: DEFAULT_SOURCE_DIR, output: DEFAULT_OUTPUT_PATH };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--source-dir") args.sourceDir = resolvePath(argv[++index]);
    else if (arg === "--output") args.output = resolvePath(argv[++index]);
    else throw new Error(`unknown argument: ${arg}`);
  }
  return args;
}

function resolvePath(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  return path.isAbsolute(text) ? text : path.join(ROOT, text);
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function splitValidatorError(errorText) {
  const text = String(errorText || "").trim();
  if (!text) return ["unknown"];
  const compatibility = text.match(/^compatibility validation failed:\s*(.+)$/i);
  if (compatibility) {
    return compatibility[1]
      .split(/\s*;\s*/u)
      .map((item) => item.trim())
      .filter(Boolean)
      .map((item) => `compatibility:${item}`);
  }
  if (/cards must contain at least/i.test(text)) return ["cards_min_count"];
  if (/missing tier/i.test(text)) return ["missing_tier"];
  if (/invalid tier/i.test(text)) return ["invalid_tier"];
  if (/unknown cap_id/i.test(text)) return ["unknown_cap_id"];
  if (/duplicate cap_id/i.test(text)) return ["duplicate_cap_id"];
  if (/Unexpected token|Unexpected end|JSON|parse/i.test(text)) return ["json_parse"];
  return [text.split(/\r?\n/)[0].slice(0, 200)];
}

function incrementCross(cross, errorType, archetype) {
  if (!cross[errorType]) cross[errorType] = {};
  cross[errorType][archetype] = (cross[errorType][archetype] || 0) + 1;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!fs.existsSync(args.sourceDir)) throw new Error(`source dir missing: ${args.sourceDir}`);
  const files = fs.readdirSync(args.sourceDir).filter((file) => file.endsWith(".json")).sort((a, b) => a.localeCompare(b));
  const cross = {};
  const byArchetype = {};
  const byErrorType = {};
  const missingAttemptLog = [];
  let chainsWithD4AttemptLog = 0;
  let violatingChains = 0;
  let violationItems = 0;

  for (const file of files) {
    const filePath = path.join(args.sourceDir, file);
    const artifact = readJson(filePath);
    const row = artifact.row || {};
    const archetype = artifact.archetype || row.archetype || row.persona_pool_record?.archetype || String(row.persona_id || artifact.persona_id || "").split("-")[0] || "unknown";
    const chainKey = artifact.chain_key || row.source_chain_key || `${row.persona_id || artifact.persona_id}|${row.condition || artifact.condition}|${Number(row.rep || artifact.rep || 1)}`;
    const attemptLog = row.r2?.d4?.attempt_log;
    if (!Array.isArray(attemptLog) || !attemptLog.length) {
      missingAttemptLog.push({ chain_key: chainKey, file: path.relative(ROOT, filePath) });
      continue;
    }
    chainsWithD4AttemptLog += 1;
    const first = attemptLog[0];
    if (first.validator_status !== "error") continue;
    violatingChains += 1;
    const errorTypes = splitValidatorError(first.validator_error);
    for (const errorType of errorTypes) {
      violationItems += 1;
      incrementCross(cross, errorType, archetype);
      byArchetype[archetype] = (byArchetype[archetype] || 0) + 1;
      byErrorType[errorType] = (byErrorType[errorType] || 0) + 1;
    }
  }

  const result = {
    source_dir: path.relative(ROOT, args.sourceDir),
    stage: "D4",
    attempt_index: 0,
    attempt_label: "first",
    chains_examined: files.length,
    chains_with_d4_attempt_log: chainsWithD4AttemptLog,
    d4_first_violating_chains: violatingChains,
    d4_first_violation_items: violationItems,
    cross_counts_error_type_by_archetype: cross,
    totals_by_error_type: byErrorType,
    totals_by_archetype: byArchetype,
    missing_d4_attempt_log: missingAttemptLog
  };

  fs.mkdirSync(path.dirname(args.output), { recursive: true });
  fs.writeFileSync(args.output, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

if (require.main === module) {
  main();
}
