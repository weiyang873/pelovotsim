"use strict";

const fs = require("node:fs");
const path = require("node:path");
const {
  FROZEN_PRESETS,
  applyPresetDefaults,
  assertRunMetaMatchesPreset,
  listPresets,
  rejectLockedOverrides
} = require("./team_sim_presets");

const ROOT = path.join(__dirname, "..", "..");
const DEFAULT_POOL_PATH = path.join(ROOT, "data", "persona_pool_random42_interface_v1", "persona_pool_v2.json");
const DEFAULT_OUTPUT_ROOT = path.join(ROOT, "runs_v4flash_0731", "team_pilot");
const SUPPORTED_ARMS = new Set(["simple", "layered", "layered_nomap", "team_layered_nomap", "team_room_roleplay_ui", "team_room_roleplay_stateful_v1", "team_room_roleplay_stateful_review_v1", "team_room_d4_human_pick_v1", "team_room_d4_stateful_pick_v1", "team_room_d4_stateful_d5_nosubmit_v1", "team_room_story_d4_v1", "team_room_story_d4d5_v1", "team_room_story_d4d5_narrator_d5_v1", "team_room_story_r1_d4d5_narrator_v1", "team_room_r1_private_trace_v1", "team_room_r1_story_process_v1", "team_room_r1_reading_story_v1", "team_room_r1_screenplay_v1", "team_room_r1_actor_isolated_v1"]);

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

function parseArgs(argv) {
  const now = new Date().toISOString().replace(/[-:]/g, "").replace(/\..+$/u, "Z");
  const args = {
    arms: ["simple", "layered"],
    teams: 1,
    concurrency: 1,
    seed: "20260806-team-pilot",
    seedList: null,
    batch: `team_simple_layered_pilot_${now}`,
    poolPath: DEFAULT_POOL_PATH,
    outputRoot: DEFAULT_OUTPUT_ROOT,
    configOverrides: {},
    runtimeArmAliases: {},
    r1Only: false,
    presetMeta: null,
    listPresets: false,
    showPreset: null
  };
  let presetName = "";
  let forkFrom = "";
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--preset") presetName = String(argv[++index] || "").trim();
    else if (arg === "--fork-from") forkFrom = String(argv[++index] || "").trim();
    else if (arg === "--show-preset") index += 1;
    else if (arg.startsWith("--") && !["--list-presets", "--r1-only"].includes(arg)) index += 1;
  }
  if (presetName && forkFrom) throw new Error("use either --preset or --fork-from, not both");
  const activePresetName = presetName || forkFrom;
  if (activePresetName) applyPresetDefaults(args, activePresetName, "team_run", Boolean(forkFrom));
  const cliTouched = new Set();
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--preset" || arg === "--fork-from") {
      index += 1;
    } else if (arg === "--list-presets") {
      args.listPresets = true;
    } else if (arg === "--show-preset") {
      args.showPreset = String(argv[++index] || "").trim();
    } else if (arg === "--arms") {
      args.arms = String(argv[++index] || "").split(",").map((item) => item.trim()).filter(Boolean);
      cliTouched.add("arms");
    }
    else if (arg === "--teams") {
      args.teams = Number(argv[++index]);
      cliTouched.add("teams");
    }
    else if (arg === "--concurrency") {
      args.concurrency = Number(argv[++index]);
      cliTouched.add("concurrency");
    }
    else if (arg === "--seed") {
      args.seed = String(argv[++index] || "").trim();
      cliTouched.add("seed");
    }
    else if (arg === "--seed-list") {
      args.seedList = String(argv[++index] || "")
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean)
        .map((item) => item.padStart(2, "0"));
      cliTouched.add("seedList");
    }
    else if (arg === "--batch") {
      args.batch = String(argv[++index] || "").trim();
      cliTouched.add("batch");
    }
    else if (arg === "--pool-path") {
      args.poolPath = path.resolve(ROOT, String(argv[++index] || "").trim());
      cliTouched.add("poolPath");
    }
    else if (arg === "--output-root") {
      args.outputRoot = path.resolve(ROOT, String(argv[++index] || "").trim());
      cliTouched.add("outputRoot");
    }
    else if (arg === "--team-size") {
      args.configOverrides.team_size = Number(argv[++index]);
      cliTouched.add("team_size");
    }
    else if (arg === "--r1-actor-event-cap") {
      args.configOverrides.max_r1_actor_events = Number(argv[++index]);
      cliTouched.add("max_r1_actor_events");
    }
    else if (arg === "--max-turns-r1") {
      args.configOverrides.max_turns_r1_discussion = Number(argv[++index]);
      cliTouched.add("max_turns_r1_discussion");
    }
    else if (arg === "--max-turns-r2") {
      args.configOverrides.max_turns_r2_per_segment = Number(argv[++index]);
      cliTouched.add("max_turns_r2_per_segment");
    }
    else if (arg === "--temperature") {
      args.configOverrides.temperature = Number(argv[++index]);
      cliTouched.add("temperature");
    }
    else if (arg === "--r1-only") {
      args.r1Only = true;
      cliTouched.add("r1Only");
    }
    else throw new Error(`unknown argument: ${arg}`);
  }
  if (activePresetName) rejectLockedOverrides(cliTouched, "team_run", Boolean(forkFrom), activePresetName);
  if (args.listPresets || args.showPreset) return args;
  if (!args.arms.length || args.arms.some((arm) => !SUPPORTED_ARMS.has(resolveRuntimeArm(args, arm)))) {
    throw new Error("--arms contains an unsupported arm");
  }
  if (!Number.isInteger(args.teams) || args.teams < 1) throw new Error("--teams must be a positive integer");
  if (!Number.isInteger(args.concurrency) || args.concurrency < 1) throw new Error("--concurrency must be a positive integer");
  if (args.seedList && args.seedList.some((item) => !/^\d{2}$/u.test(item))) {
    throw new Error("--seed-list must be comma-separated numeric suffixes like 02,04,13");
  }
  if (!args.seed) throw new Error("--seed required");
  if (!args.batch) throw new Error("--batch required");
  for (const [key, value] of Object.entries(args.configOverrides)) {
    if (!Number.isFinite(value)) throw new Error(`${key} override must be finite`);
  }
  return args;
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function resolveRuntimeArm(args, arm) {
  return args.runtimeArmAliases?.[arm] || arm;
}

function summarizeResult(result) {
  const publicArm = result.public_arm || result.arm;
  return {
    arm: publicArm,
    runtime_arm: publicArm === result.arm ? null : result.arm,
    team_id: result.team_id,
    leader_id: result.leader_id,
    profile_ids: result.profile_ids,
    grid_id: result.r1?.grid_id || "",
    architecture: result.r1?.architecture || "",
    VPscore: result.r1?.VPscore ?? null,
    r1_only: Boolean(result.r1_only),
    price: result.r2_price ?? null,
    card_count: result.r2_card_count ?? null,
    profit: result.r2_profit == null ? null : Math.round(Number(result.r2_profit)),
    loss: result.r2_profit == null ? null : Number(result.r2_profit) < 0,
    output_dir: path.relative(ROOT, result.output_dir)
  };
}

function boolEnv(name) {
  const raw = process.env[name];
  if (raw === undefined) return false;
  return /^(1|true|yes|on)$/i.test(String(raw).trim());
}

async function main() {
  loadLocalEnv();
  const args = parseArgs(process.argv.slice(2));
  if (args.listPresets) {
    console.log(JSON.stringify(listPresets("team_run"), null, 2));
    return;
  }
  if (args.showPreset) {
    const preset = FROZEN_PRESETS[args.showPreset];
    if (!preset) throw new Error(`unknown preset: ${args.showPreset}`);
    console.log(JSON.stringify(preset, null, 2));
    return;
  }
  const modelRegistry = require("../../server/llm/modelRegistry");
  const deepseek = require("../../server/llm/deepseekClient");
  if (!deepseek.hasAnyKey()) throw new Error("missing LLM API key");
  if (!fs.existsSync(args.poolPath)) throw new Error(`missing pool path: ${args.poolPath}`);

  const { runTeam } = require("../../server/synthetic/teamSim/orchestrator");
  const startedAt = new Date().toISOString();
  const startedMs = Date.now();
  const results = [];
  const failures = [];
  const tasks = [];

  for (const arm of args.arms) {
    const runtimeArm = resolveRuntimeArm(args, arm);
    const seedSuffixes = args.seedList || Array.from({ length: args.teams }, (_, teamIndex) => String(teamIndex + 1).padStart(2, "0"));
    for (const suffix of seedSuffixes) {
      tasks.push({
        arm,
        runtimeArm,
        teamIndex: Number(suffix) - 1,
        seed: `${args.seed}:${suffix}`
      });
    }
  }

  const { default: pLimit } = await import("p-limit");
  const limit = pLimit(args.concurrency);
  await Promise.all(tasks.map((task) => limit(async () => {
      const runtimeLabel = task.runtimeArm === task.arm ? "" : ` runtime_arm=${task.runtimeArm}`;
      console.error(`[team-pilot] start arm=${task.arm}${runtimeLabel} seed=${task.seed}`);
      try {
        const result = await runTeam({
          seed: task.seed,
          batch: args.batch,
          arm: task.runtimeArm,
          publicArm: task.arm,
          poolPath: args.poolPath,
          outputRoot: args.outputRoot,
          configOverrides: args.configOverrides,
          r1Only: args.r1Only,
          presetMeta: args.presetMeta
        });
        if (args.presetMeta) {
          assertRunMetaMatchesPreset(readJson(path.join(result.output_dir, "run_meta.json")), args.presetMeta);
        }
        const row = summarizeResult(result);
        results.push(row);
        console.error(`[team-pilot] done arm=${task.arm}${runtimeLabel} team=${row.team_id} price=${row.price} cards=${row.card_count} profit=${row.profit} r1_only=${row.r1_only}`);
      } catch (error) {
        const failure = {
          arm: task.arm,
          runtime_arm: task.runtimeArm === task.arm ? null : task.runtimeArm,
          seed: task.seed,
          error: String(error?.stack || error?.message || error)
        };
        failures.push(failure);
        console.error(`[team-pilot] failed arm=${task.arm} seed=${task.seed}: ${String(error?.message || error)}`);
      }
  })));

  const finishedAt = new Date().toISOString();
  results.sort((a, b) => `${a.arm}:${a.team_id}`.localeCompare(`${b.arm}:${b.team_id}`));
  failures.sort((a, b) => `${a.arm}:${a.seed}`.localeCompare(`${b.arm}:${b.seed}`));
  const summary = {
    run_id: args.batch,
    started_at: startedAt,
    finished_at: finishedAt,
    wall_clock_ms: Date.now() - startedMs,
    provider: modelRegistry.getProvider(),
    model: modelRegistry.getModel("chat_service"),
    base_url_host: new URL(modelRegistry.getBaseUrl()).host,
    enable_thinking: modelRegistry.getProvider() === "qwen" ? false : null,
    disable_thinking: boolEnv("LLM_DISABLE_THINKING") || boolEnv("DEEPSEEK_DISABLE_THINKING") || boolEnv("QWEN_DISABLE_THINKING"),
    pool_path: path.relative(ROOT, args.poolPath),
    output_root: path.relative(ROOT, args.outputRoot),
    arms: args.arms,
    runtime_arm_aliases: args.runtimeArmAliases,
    runtime_arms: args.arms.map((arm) => resolveRuntimeArm(args, arm)),
    teams_per_arm: args.seedList ? args.seedList.length : args.teams,
    concurrency: args.concurrency,
    seed: args.seed,
    seed_list: args.seedList,
    r1_only: args.r1Only,
    preset: args.presetMeta,
    config_overrides: args.configOverrides,
    results,
    failures
  };
  const summaryPath = path.join(args.outputRoot, args.batch, "pilot_summary.json");
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
