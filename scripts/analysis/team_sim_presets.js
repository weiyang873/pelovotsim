"use strict";

const path = require("node:path");

const ROOT = path.join(__dirname, "..", "..");
const RANDOM42_FREE_POOL = "data/persona_pool_random42_free_0731_interface_20260814/persona_pool_v2.json";
const TASK_BLIND_POOL42 = "data/task_blind_persona_pipeline_v1/r1_pool42_20260812/persona_pool_task_blind_narrative_v1.json";
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
  team_r1_taskblind_actor_isolated_v1: {
    runner_type: "team_run",
    lifecycle: "frozen",
    description: "Five-person team Round 1, actor-isolated discussion, task-blind pool42, cap24 forced-submission semantics.",
    evidence: [
      "runs_v4flash_0731/team_pilot/r1_actor_cap24_forced_submit_12teams_20260814_v1/pilot_summary.json",
      "runs_v4flash_0731/team_pilot/r1_actor_cap24_forced_submit_retry0309_20260814_v2/pilot_summary.json",
      "runs_v4flash_0731/team_pilot/r1_actor_cap24_forced_submit_retry09_20260814_v3/pilot_summary.json"
    ],
    env: {
      ...COMMON_DEEPSEEK_OFFICIAL_ENV,
      LLM_MODEL_OVERRIDE: "deepseek-v4-flash",
      TEAM_SIM_HIDE_JINANG: "1",
      TEAM_SIM_R1_STRATEGY_MODE: "explicit_diff_cost_grid_button"
    },
    args: {
      arms: ["team_room_r1_actor_isolated_v1"],
      teams: 42,
      concurrency: 10,
      seed: "20260813-taskblind-team-actor-r1r2-full42",
      batch: "team_r1_taskblind_actor_isolated_v1",
      poolPath: TASK_BLIND_POOL42,
      outputRoot: TEAM_OUTPUT_ROOT,
      r1Only: true,
      configOverrides: {
        team_size: 5,
        temperature: 0.55,
        max_r1_actor_events: 24
      }
    },
    expect_run_meta: {
      arm: "team_room_r1_actor_isolated_v1",
      profile_pool_source: TASK_BLIND_POOL42,
      jinang_prompt_visibility: "hidden_from_synthetic_prompts",
      r1_strategy_mode: "explicit_diff_cost_grid_button",
      r1_only: true,
      "config_snapshot.team_size": 5,
      "config_snapshot.temperature": 0.55,
      "config_snapshot.max_r1_actor_events": 24,
      r1_actor_event_cap: 24
    }
  },

  random42_simple_layered_team5_v1: {
    runner_type: "team_run",
    lifecycle: "frozen",
    description: "Current best random42 free-persona team simple/layered method: 42 paired five-person teams, interface prompt, no fixed grid/persona decision; team layered resolves to the accepted no-map implementation.",
    evidence: [
      "runs_v4flash_0731/team_pilot/random42_free_0731_interface_team5_simple_teamlayerednomap_deepseek_20260814/pilot_summary.json"
    ],
    env: COMMON_DEEPSEEK_OFFICIAL_ENV,
    args: {
      arms: ["simple", "layered"],
      runtimeArmAliases: {
        layered: "team_layered_nomap"
      },
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

  team_r2_story3_converge_v1: {
    runner_type: "r2_replay",
    lifecycle: "frozen",
    description: "Team Round 2 replayed from frozen team R1 (actor_isolated cap24, five rounds): story D4 (task-blind reading habits from biography, no lean scaffolds) + six-segment screenplay review + three-scene screenplay D5 with per-member private three-stage commitment, biography-derived pricing view, R1 memory carried into every call, room converges to one member's position. Freeze evidence 5x42: SD 1029+/-113, mean 3600+/-109, cards 12.0, coverCore 0.67, loss 63+/-5%, team price = a member's private price 88+/-4%.",
    module: "server/synthetic/teamSim/teamR2StoryScreenplaySim.js",
    code_tag: "frozen/team-r2-story3-B-20260816",
    evidence: [1, 2, 3, 4, 5].map((i) => `runs_v4flash_0731/team_r2_replay/team_r2_story3_B_rep${i}_20260816`),
    source_batches: [1, 2, 3, 4, 5].map((i) => [`runs_v4flash_0731/team_pilot/teamr1_cap24_rep${i}_20260815`, `runs_v4flash_0731/team_pilot/teamr1_cap24_rep${i}_retry_20260815`]),
    env: {
      ...COMMON_DEEPSEEK_OFFICIAL_ENV,
      TEAM_SIM_HIDE_JINANG: "1",
      TEAM_SIM_D5_IDEOLOGY: "1",
      TEAM_SIM_D5_PRIVATE_STAGE: "1",
      TEAM_SIM_D5_CONVERGE: "1"
    },
    args: {
      arm: "team_room_story_d4_screenplay3_d5_v1",
      concurrency: 3,
      batchPrefix: "team_r2_story3_B"
    },
    controls: {
      no_converge_rule: { env_delta: { TEAM_SIM_D5_CONVERGE: "0" }, evidence_prefix: "team_r2_story3_A", note: "same machine, room may compromise: SD 661+/-21, loss 52+/-6%" }
    }
  },

  solo_r2_v2q_perdim_reading_v1: {
    runner_type: "r2_replay",
    lifecycle: "frozen",
    description: "Solo Round 2 replayed from frozen solo R1 (hidden jinang, five rounds): pricing-action persona D5, individual pick asked one dimension group per call (real page structure) with reading habit inferred from the biography. Freeze evidence 5x42: SD 912+/-49, mean 4296+/-134, cards 14.6+/-0.4, coverCore 0.74, loss 53+/-6%. Supersedes solo v1 (one-call pick: SD 877+/-64, cards 10.1, loss 17.7+/-4.1%), which is kept as reference.",
    module: "server/synthetic/teamSim/soloRoleplayV2Sim.js",
    code_tag: "frozen/solo-v2Q-20260816",
    evidence: [1, 2, 3, 4, 5].map((i) => `runs_v4flash_0731/team_r2_replay/solo_r2_v2Q_rep${i}_20260816`),
    source_batches: [1, 2, 3, 4, 5].map((i) => [`runs_v4flash_0731/team_pilot/solo_r1_hidden_rep${i}_20260815`, `runs_v4flash_0731/team_pilot/solo_r1_hidden_rep${i}_retry_20260815`]),
    env: {
      ...COMMON_DEEPSEEK_OFFICIAL_ENV,
      TEAM_SIM_HIDE_JINANG: "1",
      TEAM_SIM_D4_PER_DIM: "1",
      TEAM_SIM_D4_READING: "1"
    },
    args: {
      arm: "team_room_roleplay_ui",
      concurrency: 3,
      batchPrefix: "solo_r2_v2Q"
    },
    controls: {
      perdim_only: { env_delta: { TEAM_SIM_D4_READING: "0" }, evidence_prefix: "solo_r2_v2P", note: "SD 935+/-143, cards 13.9, loss 43+/-7%" },
      solo_v1_reference: { note: "one-call pick, 8/12 code snapshot; SD 877+/-64, mean 4294+/-77, cards 10.1, loss 17.7+/-4.1% (downgraded to reference 2026-08-16)" }
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
      arms: preset.args?.arms || [],
      runtime_arm_aliases: preset.args?.runtimeArmAliases || {},
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
  if (presetArgs.runtimeArmAliases !== undefined) args.runtimeArmAliases = clone(presetArgs.runtimeArmAliases);
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
    runtime_arm_aliases: clone(preset.args?.runtimeArmAliases || {}),
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
