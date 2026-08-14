"use strict";

const path = require("node:path");

const ROOT = path.join(__dirname, "..", "..");
const RANDOM42_FREE_POOL = "data/persona_pool_random42_free_0731_interface_20260814/persona_pool_v2.json";
const TEAM_OUTPUT_ROOT = "runs_v4flash_0731/team_pilot";
const SINGLE_OUTPUT_ROOT = "runs_v4flash_0731";

const COMMON_DEEPSEEK_OFFICIAL_ENV = {
  LLM_PROVIDER: "deepseek",
  LLM_BASE_URL: "https://api.deepseek.com",
  DEEPSEEK_MODEL: "deepseek-v4-flash",
  LLM_CONCURRENCY: "8",
  LLM_DISABLE_THINKING: "1",
  DEEPSEEK_DISABLE_THINKING: "1"
};

const FROZEN_PRESETS = {
  random42_simple_layered_team5_v1: {
    runner_type: "team_run",
    lifecycle: "frozen",
    description: "Current best random42 free-persona simple/layered team method: 42 paired five-person teams, simple vs team_layered_nomap, interface prompt, no fixed grid/persona decision.",
    evidence: [
      "runs_v4flash_0731/team_pilot/random42_free_0731_interface_team5_simple_teamlayerednomap_deepseek_20260814/pilot_summary.json"
    ],
    env: COMMON_DEEPSEEK_OFFICIAL_ENV,
    args: {
      arms: ["simple", "team_layered_nomap"],
      teams: 42,
      concurrency: 2,
      seed: "20260814-random42-free-persona-team5-interface",
      batch: "random42_simple_layered_team5_v1",
      poolPath: RANDOM42_FREE_POOL,
      outputRoot: TEAM_OUTPUT_ROOT,
      r1Only: false,
      configOverrides: {
        team_size: 5,
        temperature: 0.55
      }
    },
    expect_run_meta: {
      profile_pool_source: RANDOM42_FREE_POOL,
      jinang_prompt_visibility: "visible_in_synthetic_prompts",
      r1_strategy_mode: "explicit_diff_cost_grid_button",
      r1_only: false,
      "model_config.provider": "deepseek",
      "model_config.base_url": "https://api.deepseek.com",
      "model_config.default_model": "deepseek-v4-flash",
      "config_snapshot.team_size": 5,
      "config_snapshot.temperature": 0.55
    }
  },

  random42_simple_layered_individual_v1: {
    runner_type: "single_ui_parity",
    lifecycle: "frozen",
    description: "Current random42 free-persona individual simple/layered UI-parity method: 42 personas per arm, interface prompt, condition S only.",
    evidence: [
      "runs_v4flash_0731/random42_free_0731_interface_simple_20260814/arm_summary.json",
      "runs_v4flash_0731/random42_free_0731_interface_layered_20260814/arm_summary.json"
    ],
    env: COMMON_DEEPSEEK_OFFICIAL_ENV,
    args: {
      arms: ["simple", "layered"],
      personas: 42,
      concurrency: 6,
      batch: "random42_simple_layered_individual_v1",
      poolPath: RANDOM42_FREE_POOL,
      outputRoot: SINGLE_OUTPUT_ROOT
    },
    expect_summary: {
      mode: "single_ui_parity_pilot",
      provider: "deepseek",
      base_url_host: "api.deepseek.com",
      disable_thinking: true,
      prompt_mode: "interface",
      condition: "S",
      q_s_enabled: false,
      personas_per_arm: 42,
      pool_path: RANDOM42_FREE_POOL
    }
  }
};

const LOCKED_TEAM_RUN_FIELDS = new Set([
  "arms",
  "teams",
  "seed",
  "seedList",
  "poolPath",
  "team_size",
  "max_r1_actor_events",
  "max_turns_r1_discussion",
  "max_turns_r2_per_segment",
  "temperature",
  "r1Only"
]);

const LOCKED_SINGLE_FIELDS = new Set([
  "arms",
  "personas",
  "poolPath"
]);

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function resolveRootPath(inputPath) {
  return path.isAbsolute(inputPath) ? inputPath : path.join(ROOT, inputPath);
}

function pathForRuntime(inputPath) {
  return resolveRootPath(inputPath);
}

function getPreset(name) {
  const preset = FROZEN_PRESETS[name];
  if (!preset) {
    const names = Object.keys(FROZEN_PRESETS).sort().join(", ");
    throw new Error(`unknown preset: ${name}; available presets: ${names}`);
  }
  return preset;
}

function listPresets(runnerType = null) {
  return Object.entries(FROZEN_PRESETS)
    .filter(([, preset]) => !runnerType || preset.runner_type === runnerType)
    .map(([name, preset]) => ({
      name,
      runner_type: preset.runner_type,
      lifecycle: preset.lifecycle,
      description: preset.description
    }));
}

function setPresetEnv(env) {
  for (const [key, value] of Object.entries(env || {})) {
    process.env[key] = String(value);
  }
}

function applyPresetDefaults(args, presetName, runnerType, fork) {
  const preset = getPreset(presetName);
  if (preset.runner_type !== runnerType) {
    throw new Error(`preset ${presetName} is for ${preset.runner_type}, not ${runnerType}`);
  }
  const presetArgs = clone(preset.args || {});
  setPresetEnv(preset.env);
  if (presetArgs.arms) args.arms = presetArgs.arms.slice();
  if (presetArgs.teams !== undefined) args.teams = presetArgs.teams;
  if (presetArgs.personas !== undefined) args.personas = presetArgs.personas;
  if (presetArgs.concurrency !== undefined) args.concurrency = presetArgs.concurrency;
  if (presetArgs.seed !== undefined) args.seed = presetArgs.seed;
  if (presetArgs.seedList !== undefined) args.seedList = presetArgs.seedList;
  if (presetArgs.batch !== undefined) args.batch = presetArgs.batch;
  if (presetArgs.poolPath !== undefined) args.poolPath = pathForRuntime(presetArgs.poolPath);
  if (presetArgs.outputRoot !== undefined) args.outputRoot = pathForRuntime(presetArgs.outputRoot);
  if (presetArgs.r1Only !== undefined) args.r1Only = Boolean(presetArgs.r1Only);
  args.configOverrides = {
    ...args.configOverrides,
    ...(presetArgs.configOverrides || {})
  };
  args.presetMeta = buildPresetMeta(presetName, preset, fork);
}

function buildPresetMeta(presetName, preset, fork) {
  return {
    name: presetName,
    lifecycle: fork ? "fork" : preset.lifecycle,
    forked_from: fork ? presetName : null,
    description: preset.description,
    evidence: clone(preset.evidence || []),
    env: clone(preset.env || {}),
    expected_run_meta: clone(preset.expect_run_meta || {}),
    expected_summary: clone(preset.expect_summary || {})
  };
}

function lockedFieldsForRunner(runnerType) {
  if (runnerType === "single_ui_parity") return LOCKED_SINGLE_FIELDS;
  if (runnerType === "team_run") return LOCKED_TEAM_RUN_FIELDS;
  return new Set();
}

function rejectLockedOverrides(cliTouched, runnerType, fork, presetName) {
  if (fork) return;
  const locked = lockedFieldsForRunner(runnerType);
  const touchedLocked = Array.from(cliTouched).filter((item) => locked.has(item));
  if (touchedLocked.length > 0) {
    throw new Error(
      `preset ${presetName} is frozen; locked overrides require --fork-from instead of --preset: ${touchedLocked.join(", ")}`
    );
  }
}

function getPath(value, dottedPath) {
  return dottedPath.split(".").reduce((current, key) => {
    if (current == null || typeof current !== "object") return undefined;
    return current[key];
  }, value);
}

function assertExpected(value, expected, label, presetName) {
  const mismatches = [];
  for (const [key, expectedValue] of Object.entries(expected || {})) {
    const actualValue = getPath(value, key);
    if (actualValue !== expectedValue) {
      mismatches.push(`${key}: expected ${JSON.stringify(expectedValue)}, got ${JSON.stringify(actualValue)}`);
    }
  }
  if (mismatches.length > 0) {
    throw new Error(`preset guard failed for ${presetName} ${label}: ${mismatches.join("; ")}`);
  }
}

function assertRunMetaMatchesPreset(runMeta, presetMeta) {
  if (!presetMeta || presetMeta.lifecycle === "fork") return;
  assertExpected(runMeta, presetMeta.expected_run_meta, "run_meta", presetMeta.name);
}

function assertSummaryMatchesPreset(summary, presetMeta) {
  if (!presetMeta || presetMeta.lifecycle === "fork") return;
  assertExpected(summary, presetMeta.expected_summary, "summary", presetMeta.name);
}

module.exports = {
  FROZEN_PRESETS,
  applyPresetDefaults,
  assertRunMetaMatchesPreset,
  assertSummaryMatchesPreset,
  listPresets,
  rejectLockedOverrides
};
