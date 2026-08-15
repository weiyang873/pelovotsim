"use strict";

const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..", "..");
const DEFAULT_OUTPUT_ROOT = path.join(ROOT, "runs_v4flash_0731", "team_r2_replay");
const SUPPORTED_REPLAY_ARMS = new Set(["legacy", "simple", "layered", "team_room_roleplay_ui", "team_room_roleplay_stateful_v1", "team_room_roleplay_stateful_review_v1", "team_room_d4_human_pick_v1", "team_room_d4_stateful_pick_v1", "team_room_d4_stateful_d5_nosubmit_v1", "team_room_story_d4_v1", "team_room_story_d4d5_v1", "team_room_story_d4d5_narrator_d5_v1", "team_room_story_r1_d4d5_narrator_v1", "team_room_r1_private_trace_v1", "team_room_r1_story_process_v1", "team_room_r1_reading_story_v1", "team_room_r1_screenplay_v1", "team_room_r1_actor_isolated_v1", "team_room_pricing_action_actor_v1"]);

function loadLocalEnv() {
  const envPath = path.join(ROOT, ".env");
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const splitAt = trimmed.indexOf("=");
    if (splitAt <= 0) continue;
    const key = trimmed.slice(0, splitAt).trim();
    let value = trimmed.slice(splitAt + 1).trim();
    if ((value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!Object.prototype.hasOwnProperty.call(process.env, key)) process.env[key] = value;
  }
}

function resolveRootPath(inputPath) {
  return path.isAbsolute(inputPath) ? inputPath : path.join(ROOT, inputPath);
}

function parseArgs(argv) {
  const now = new Date().toISOString().replace(/[-:]/g, "").replace(/\..+$/u, "Z");
  const args = {
    sourceDirs: [],
    sourceBatches: [],
    batch: `team_r2_replay_${now}`,
    outputRoot: DEFAULT_OUTPUT_ROOT,
    concurrency: 1,
    arm: null,
    poolPath: null,
    useCurrentConfig: false,
    configOverrides: {}
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--source-dir") {
      args.sourceDirs.push(resolveRootPath(String(argv[++index] || "").trim()));
    }
    else if (arg === "--source-batch") {
      args.sourceBatches.push(resolveRootPath(String(argv[++index] || "").trim()));
    }
    else if (arg === "--batch") {
      args.batch = String(argv[++index] || "").trim();
    }
    else if (arg === "--output-root") {
      args.outputRoot = resolveRootPath(String(argv[++index] || "").trim());
    }
    else if (arg === "--concurrency") {
      args.concurrency = Number(argv[++index]);
    }
    else if (arg === "--arm") {
      args.arm = String(argv[++index] || "").trim();
    }
    else if (arg === "--pool-path") {
      args.poolPath = resolveRootPath(String(argv[++index] || "").trim());
    }
    else if (arg === "--use-current-config") {
      args.useCurrentConfig = true;
    }
    else if (arg === "--team-size") {
      args.configOverrides.team_size = Number(argv[++index]);
    }
    else if (arg === "--max-turns-r2") {
      args.configOverrides.max_turns_r2_per_segment = Number(argv[++index]);
    }
    else if (arg === "--temperature") {
      args.configOverrides.temperature = Number(argv[++index]);
    }
    else throw new Error(`unknown argument: ${arg}`);
  }
  if (!args.sourceDirs.length && !args.sourceBatches.length) {
    throw new Error("provide --source-dir and/or --source-batch");
  }
  if (!Number.isInteger(args.concurrency) || args.concurrency < 1) {
    throw new Error("--concurrency must be a positive integer");
  }
  if (args.arm && !SUPPORTED_REPLAY_ARMS.has(args.arm)) {
    throw new Error("--arm contains an unsupported replay arm");
  }
  for (const [key, value] of Object.entries(args.configOverrides)) {
    if (!Number.isFinite(value)) throw new Error(`${key} override must be finite`);
  }
  return args;
}

function isReplaySourceDir(dirPath) {
  return fs.existsSync(path.join(dirPath, "run_meta.json"))
    && fs.existsSync(path.join(dirPath, "r1_frozen.json"))
    && fs.existsSync(path.join(dirPath, "r1_transcript.json"));
}

function collectSourceDirs(args) {
  const dirs = [];
  for (const dirPath of args.sourceDirs) {
    if (!isReplaySourceDir(dirPath)) throw new Error(`not a replayable source dir: ${dirPath}`);
    dirs.push(dirPath);
  }
  for (const batchPath of args.sourceBatches) {
    if (!fs.existsSync(batchPath)) throw new Error(`missing source batch: ${batchPath}`);
    for (const entry of fs.readdirSync(batchPath, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const candidate = path.join(batchPath, entry.name);
      if (isReplaySourceDir(candidate)) dirs.push(candidate);
    }
  }
  return Array.from(new Set(dirs)).sort();
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function boolEnv(name) {
  const raw = process.env[name];
  if (raw === undefined) return false;
  return /^(1|true|yes|on)$/i.test(String(raw).trim());
}

function summarizeResult(result) {
  return {
    arm: result.arm,
    source_dir: path.relative(ROOT, result.source_dir),
    team_id: result.team_id,
    leader_id: result.leader_id,
    profile_ids: result.profile_ids,
    grid_id: result.r1?.grid_id || "",
    architecture: result.r1?.architecture || "",
    price: result.r2_price,
    card_count: result.r2_card_count,
    profit: Math.round(Number(result.r2_profit)),
    loss: Number(result.r2_profit) < 0,
    output_dir: path.relative(ROOT, result.output_dir)
  };
}

async function main() {
  loadLocalEnv();
  const args = parseArgs(process.argv.slice(2));
  const sourceDirs = collectSourceDirs(args);
  const modelRegistry = require("../../server/llm/modelRegistry");
  const deepseek = require("../../server/llm/deepseekClient");
  if (!deepseek.hasAnyKey()) throw new Error("missing LLM API key");

  const { runR2FromExistingR1 } = require("../../server/synthetic/teamSim/orchestrator");
  const startedAt = new Date().toISOString();
  const startedMs = Date.now();
  const results = [];
  const failures = [];
  const { default: pLimit } = await import("p-limit");
  const limit = pLimit(args.concurrency);

  await Promise.all(sourceDirs.map((sourceDir) => limit(async () => {
    console.error(`[r2-replay] start source=${path.relative(ROOT, sourceDir)}`);
    try {
      const result = await runR2FromExistingR1({
        sourceDir,
        batch: args.batch,
        arm: args.arm,
        poolPath: args.poolPath,
        outputRoot: args.outputRoot,
        configOverrides: args.configOverrides,
        useCurrentConfig: args.useCurrentConfig
      });
      const row = summarizeResult(result);
      results.push(row);
      console.error(`[r2-replay] done source=${row.source_dir} price=${row.price} cards=${row.card_count} profit=${row.profit}`);
    } catch (error) {
      const failure = {
        source_dir: path.relative(ROOT, sourceDir),
        error: String(error?.stack || error?.message || error)
      };
      failures.push(failure);
      console.error(`[r2-replay] failed source=${failure.source_dir}: ${String(error?.message || error)}`);
    }
  })));

  results.sort((a, b) => `${a.arm}:${a.source_dir}`.localeCompare(`${b.arm}:${b.source_dir}`));
  failures.sort((a, b) => a.source_dir.localeCompare(b.source_dir));
  const summary = {
    run_id: args.batch,
    replay_scope: "R2 only; existing R1 files reused from source dirs",
    started_at: startedAt,
    finished_at: new Date().toISOString(),
    wall_clock_ms: Date.now() - startedMs,
    provider: modelRegistry.getProvider(),
    model: modelRegistry.getModel("chat_service"),
    base_url_host: new URL(modelRegistry.getBaseUrl()).host,
    enable_thinking: modelRegistry.getProvider() === "qwen" ? false : null,
    disable_thinking: boolEnv("LLM_DISABLE_THINKING") || boolEnv("DEEPSEEK_DISABLE_THINKING") || boolEnv("QWEN_DISABLE_THINKING"),
    source_dirs: sourceDirs.map((dirPath) => path.relative(ROOT, dirPath)),
    output_root: path.relative(ROOT, args.outputRoot),
    batch: args.batch,
    concurrency: args.concurrency,
    arm_override: args.arm,
    pool_path_override: args.poolPath ? path.relative(ROOT, args.poolPath) : null,
    use_current_config: args.useCurrentConfig,
    config_overrides: args.configOverrides,
    results,
    failures
  };
  const summaryPath = path.join(args.outputRoot, args.batch, "r2_replay_summary.json");
  writeJson(summaryPath, summary);
  console.log(JSON.stringify(summary, null, 2));
  if (failures.length > 0) process.exitCode = 1;
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.stack || error.message || String(error));
    process.exitCode = 1;
  });
}
