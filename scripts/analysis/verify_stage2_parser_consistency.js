#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "../..");
const DEFAULT_CHAIN_DIR = path.join(ROOT, "runs_v4flash_0731", "d4d5_chat", "chains");
const DEFAULT_OUTPUT = path.join(ROOT, "runs_v4flash_0731", "d4d5_chat", "parser_consistency_diff.json");

function resolvePath(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  return path.isAbsolute(text) ? text : path.join(ROOT, text);
}

function parseArgs(argv) {
  const args = { chainDir: DEFAULT_CHAIN_DIR, output: DEFAULT_OUTPUT };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--chain-dir") args.chainDir = resolvePath(argv[++index]);
    else if (arg === "--output") args.output = resolvePath(argv[++index]);
    else throw new Error(`unknown argument: ${arg}`);
  }
  return args;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
}

function diffValues(left, right, prefix = "") {
  const leftJson = JSON.stringify(stable(left));
  const rightJson = JSON.stringify(stable(right));
  if (leftJson === rightJson) return [];
  if (!left || !right || typeof left !== "object" || typeof right !== "object") {
    return [{ path: prefix || "$", landed: left, reparsed: right }];
  }
  if (Array.isArray(left) || Array.isArray(right)) {
    const max = Math.max(Array.isArray(left) ? left.length : 0, Array.isArray(right) ? right.length : 0);
    const out = [];
    for (let index = 0; index < max; index += 1) {
      out.push(...diffValues(left?.[index], right?.[index], `${prefix}[${index}]`));
    }
    return out;
  }
  const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
  const out = [];
  for (const key of [...keys].sort()) {
    out.push(...diffValues(left[key], right[key], prefix ? `${prefix}.${key}` : key));
  }
  return out;
}

function normalizeParseError(error) {
  return String(error?.message || error || "").split(/\r?\n/)[0].slice(0, 300);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!fs.existsSync(args.chainDir)) throw new Error(`chain dir missing: ${args.chainDir}`);

  const FullGame = require("./full_game_all_personas");
  const materials = FullGame.loadMaterials();
  const {
    parseCardsFromChat,
    parsePriceFromChat
  } = require("./formal_v3_chat_format_paired");

  const files = fs.readdirSync(args.chainDir).filter((file) => file.endsWith(".json")).sort((a, b) => a.localeCompare(b));
  const affected = [];
  const parseErrors = [];

  for (const file of files) {
    const filePath = path.join(args.chainDir, file);
    const artifact = readJson(filePath);
    const row = artifact.row || {};
    const chainKey = artifact.source_chain_key || row.source_chain_key || `${artifact.persona_id || row.persona_id}|${artifact.condition || row.condition}|${Number(artifact.rep || row.rep || 1)}`;
    const checks = [
      {
        stage: "D4",
        landed: row.r2?.d4?.parsed,
        raw: row.r2?.d4?.raw_response,
        parser: (raw) => parseCardsFromChat(raw, materials)
      },
      {
        stage: "D5",
        landed: row.r2?.d5?.parsed,
        raw: row.r2?.d5?.raw_response,
        parser: parsePriceFromChat
      }
    ];

    for (const check of checks) {
      try {
        const reparsed = check.parser(check.raw);
        const diffs = diffValues(check.landed, reparsed);
        if (diffs.length) {
          affected.push({
            chain_key: chainKey,
            file: path.relative(ROOT, filePath),
            stage: check.stage,
            diff_count: diffs.length,
            diffs
          });
        }
      } catch (error) {
        parseErrors.push({
          chain_key: chainKey,
          file: path.relative(ROOT, filePath),
          stage: check.stage,
          error: normalizeParseError(error)
        });
      }
    }
  }

  const result = {
    chain_dir: path.relative(ROOT, args.chainDir),
    parser_source: "scripts/analysis/formal_v3_chat_format_paired.js",
    parser_version: "current_worktree",
    chains_examined: files.length,
    stages_examined_per_chain: ["D4", "D5"],
    diff_count: affected.length,
    parse_error_count: parseErrors.length,
    affected_chains: affected,
    parse_errors: parseErrors,
    status: affected.length === 0 && parseErrors.length === 0 ? "empty_diff" : "diff_or_parse_error"
  };

  fs.mkdirSync(path.dirname(args.output), { recursive: true });
  fs.writeFileSync(args.output, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

if (require.main === module) {
  main();
}
