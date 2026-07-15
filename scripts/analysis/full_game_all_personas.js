"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { spawnSync } = require("node:child_process");

const Engine = require("../../engine");
const RD = require("../../server/llm/rdCalculator");
const { loadJinangConfig } = require("../../server/multiplayer/jinangDealer");
const { computeJinangWtpBonus, clamp01 } = require("../../server/multiplayer/jinangCoeff");
const { scaleStoredMoney, PRICE_SCALE, MONEY_SCALE_CONTRACT } = require("../../server/multiplayer/moneyScale");
const { assertInfoSet, FORBIDDEN_PATTERNS, STAGE_ALLOWED_NUMBERS } = require("./info_set_assert");

const ROOT = path.join(__dirname, "..", "..");
const RUN_ID = "full_game_all_personas_v2_2026-07-14";
const V1_RUN_ID = "full_game_all_personas_v1_2026-07-14";
const V1_JSONL_PATH = path.join(__dirname, `${V1_RUN_ID}.jsonl`);
const CONDITION = "M";
const TEMPERATURE = 0.55;
const MAX_REPAIRS = 2;
const COACH_ROUNDS = 3;
const PERSONA_ORDER = ["A", "D", "E", "B", "F", "C", "G"];
const FROZEN_MAP_FILES = {
  A: path.join(__dirname, "cognitive_map_caogen_min.json"),
  D: path.join(__dirname, "cognitive_map_erdai_min.json")
};
const GENERATED_MAPS_PATH = path.join(__dirname, "ai_generated_persona_maps_v2_2026-07-14_maps.json");
const SPEC_PATH = path.join(ROOT, "docs", "CODEX_FULL_GAME_ALL_PERSONAS.md");
const INFO_SET_SPEC_PATH = path.join(ROOT, "docs", "CODEX_INFO_SET_ALIGNMENT.md");
const PERSONA_MAPS_SPEC_PATH = path.join(ROOT, "docs", "CODEX_AI_GENERATED_PERSONA_MAPS.md");
const CAPABILITY_PATH = path.join(ROOT, "data", "capability_groups_v2.json");
const COMPATIBILITY_PATH = path.join(ROOT, "data", "compatibility_rules_v2.json");
const TAG_MAP_PATH = path.join(ROOT, "data", "tag_map_v2_1.json");
const DIMENSION_ANCHOR_PATH = path.join(ROOT, "data", "round2_dim_anchors_v1.json");
const GRID_PRIORS_PATH = path.join(ROOT, "data", "grid_priors_v4_cap_weights.json");
const ROUND1_MODEL_PATH = path.join(ROOT, "game_config_v0.1", "round1_gm_model.json");
const ROUND2_PARAMS_PATH = path.join(ROOT, "game_config_v0.1", "round2_engine_params.json");
const JINANG_PATH = path.join(ROOT, "game_config_v0.1", "jinang_cards_v2.json");
const INFO_SET_ASSERT_PATH = path.join(__dirname, "info_set_assert.js");
const ROUND2_FLOW_PATH = path.join(ROOT, "client", "src", "pages", "Round2Flow.jsx");
const MULTIPLAYER_FLOW_PATH = path.join(ROOT, "client", "src", "pages", "MultiplayerFlow.jsx");

const RADAR_KEYS = ["perception", "mobility", "interaction", "safety_privacy", "integration", "operations"];
const RADAR_LABELS = {
  perception: "感知与理解",
  mobility: "运动与导航",
  interaction: "交互与表达",
  safety_privacy: "安全与信任",
  integration: "可扩展与连接",
  operations: "可运营与可维护"
};
const STACK_REFERENCES = new Set(["承前:R1", "承前:Coach", "承前:D3", "承前:D4"]);
const GRID_OPTIONS = [
  { grid_id: "ToC_DIFF_CHILD", customer_type: "ToC", strategy: "DIFF", age: "CHILD", label: "ToC / 儿童 / 差异化", generatorLabel: "ToC 儿童家庭差异化市场" },
  { grid_id: "ToC_COST_CHILD", customer_type: "ToC", strategy: "COST", age: "CHILD", label: "ToC / 儿童 / 成本", generatorLabel: "ToC 儿童家庭成本市场" },
  { grid_id: "ToB_DIFF_CHILD", customer_type: "ToB", strategy: "DIFF", age: "CHILD", label: "ToB / 儿童 / 差异化", generatorLabel: "ToB 儿童服务机构差异化市场" },
  { grid_id: "ToB_COST_CHILD", customer_type: "ToB", strategy: "COST", age: "CHILD", label: "ToB / 儿童 / 成本", generatorLabel: "ToB 儿童服务机构成本市场" },
  { grid_id: "ToC_DIFF_ADULT", customer_type: "ToC", strategy: "DIFF", age: "ADULT", label: "ToC / 成人 / 差异化", generatorLabel: "ToC 成人个人差异化市场" },
  { grid_id: "ToC_COST_ADULT", customer_type: "ToC", strategy: "COST", age: "ADULT", label: "ToC / 成人 / 成本", generatorLabel: "ToC 成人个人成本市场" },
  { grid_id: "ToB_DIFF_ADULT", customer_type: "ToB", strategy: "DIFF", age: "ADULT", label: "ToB / 成人 / 差异化", generatorLabel: "ToB 成人服务机构差异化市场" },
  { grid_id: "ToB_COST_ADULT", customer_type: "ToB", strategy: "COST", age: "ADULT", label: "ToB / 成人 / 成本", generatorLabel: "ToB 成人服务机构成本市场" },
  { grid_id: "ToC_DIFF_ELDER", customer_type: "ToC", strategy: "DIFF", age: "ELDER", label: "ToC / 老人 / 差异化", generatorLabel: "ToC 老人家庭差异化市场" },
  { grid_id: "ToC_COST_ELDER", customer_type: "ToC", strategy: "COST", age: "ELDER", label: "ToC / 老人 / 成本", generatorLabel: "ToC 老人家庭成本市场" },
  { grid_id: "ToB_DIFF_ELDER", customer_type: "ToB", strategy: "DIFF", age: "ELDER", label: "ToB / 老人 / 差异化", generatorLabel: "ToB 养老机构差异化市场" },
  { grid_id: "ToB_COST_ELDER", customer_type: "ToB", strategy: "COST", age: "ELDER", label: "ToB / 老人 / 成本", generatorLabel: "ToB 养老机构成本市场" }
];

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

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function fileSha256(filePath) {
  return sha256(fs.readFileSync(filePath));
}

function gitHead() {
  const result = spawnSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" });
  return result.status === 0 ? result.stdout.trim() : null;
}

function parseArgs(argv) {
  const args = { runId: RUN_ID, concurrency: 1, summarizeOnly: false, recoverCalculateOnly: false, reuseJinangFrom: V1_JSONL_PATH };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--run-id") args.runId = String(argv[++index] || "").trim();
    else if (arg === "--concurrency") args.concurrency = Number(argv[++index]);
    else if (arg === "--summarize-only") args.summarizeOnly = true;
    else if (arg === "--recover-calculate-only") args.recoverCalculateOnly = true;
    else if (arg === "--reuse-jinang-from") args.reuseJinangFrom = String(argv[++index] || "").trim();
    else if (arg === "--no-reuse-jinang") args.reuseJinangFrom = "";
    else throw new Error(`unknown argument: ${arg}`);
  }
  if (!args.runId || !Number.isInteger(args.concurrency) || args.concurrency < 1) {
    throw new Error("invalid run id or concurrency");
  }
  return args;
}

function outputPaths(runId) {
  return {
    jsonl: path.join(__dirname, `${runId}.jsonl`),
    summary: path.join(__dirname, `${runId}_summary.md`),
    samples: path.join(__dirname, `${runId}_raw_samples.md`),
    meta: path.join(__dirname, `${runId}_meta.json`)
  };
}

function parseJsonObject(raw) {
  const text = String(raw || "").replace(/```json|```/gi, "").trim();
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  return JSON.parse(start >= 0 && end > start ? text.slice(start, end + 1) : text);
}

function requireText(value, label) {
  const text = String(value || "").trim();
  if (!text) throw new Error(`${label} must be non-empty text`);
  return text;
}

function loadJson(filePath) {
  if (!fs.existsSync(filePath)) throw new Error(`required file missing: ${path.relative(ROOT, filePath)}`);
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function appendJsonl(filePath, row) {
  fs.appendFileSync(filePath, `${JSON.stringify(row)}\n`, "utf8");
}

function loadJsonl(filePath) {
  if (!fs.existsSync(filePath)) return [];
  return fs.readFileSync(filePath, "utf8").split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
}

function chainKey(row) {
  return `${row.persona_id}|${row.condition}|${row.rep}`;
}

function latestRows(rows) {
  const latest = new Map();
  for (const row of rows) latest.set(chainKey(row), row);
  return PERSONA_ORDER.map((id) => latest.get(`${id}|${CONDITION}|1`)).filter(Boolean);
}

function latestRowsForRun(filePath, runId) {
  if (!filePath || !fs.existsSync(filePath)) return [];
  const rows = loadJsonl(filePath).filter((row) => !runId || row.run_id === runId);
  return latestRows(rows);
}

function loadJinangDrawsFromJsonl(filePath) {
  const draws = new Map();
  for (const row of latestRowsForRun(filePath, V1_RUN_ID)) {
    if (row.status === "OK" && row.r0_jinang?.market?.id && row.r0_jinang?.tech?.id) {
      draws.set(row.persona_id, row.r0_jinang);
    }
  }
  return draws;
}

function runPool(tasks, concurrency, worker) {
  let cursor = 0;
  async function lane() {
    while (true) {
      const index = cursor;
      cursor += 1;
      if (index >= tasks.length) return;
      await worker(tasks[index], index);
    }
  }
  return Promise.all(Array.from({ length: Math.min(concurrency, tasks.length) }, () => lane()));
}

function renderMap(items) {
  return items.map((item) => `- ${item.id}［${item.type}］${item.content}`).join("\n");
}

function renderStack(records) {
  if (!records.length) return "";
  return [
    "【累计决策栈】",
    "这些是你之前已经形成的判断与约束。后续决策应承接它，不要把每一步当成全新任务。",
    ...records.map((record) => `${record.point}：${record.summary}`)
  ].join("\n");
}

function validateQuestionDefinition(raw) {
  const parsed = parseJsonObject(raw);
  return {
    question: requireText(parsed.question, "question")
  };
}

function buildQuestionDefinitionPrompt(persona, stack, neutralDescription) {
  return [
    `你是一位"${persona.label}"型的企业管理者。`,
    `一句话背景：${persona.desc}`,
    `核心盲区摘要：${persona.core_blind_spot || persona.profile.blindSpots || ""}`,
    "【你的认知地图；M 条件，全量在场】",
    renderMap(persona.map_items),
    renderStack(stack),
    "【中性局面描述】",
    neutralDescription,
    "【问题定义】在做这个决策之前，以你的经验和直觉，你觉得此刻必须先搞清楚的问题是什么？只写问题本身（一两句话），不要回答它。",
    '输出 JSON：{"question":"<问题本身>"}',
    "只输出可 JSON.parse 的 JSON，不要 Markdown，不要额外文字。"
  ].join("\n");
}

function questionStackRecord(stage, question) {
  return {
    point: `问题定义(${stage})`,
    summary: `此刻先问：${question}`
  };
}

function neutralQuestionDescription(stage) {
  if (stage === "R1") {
    return "现在到了开局选定位的环节。可见边界：12 个市场格子（3 类人群 × 2 类渠道 × 2 类策略）与 3 个架构标签。";
  }
  if (stage === "D4") {
    return "现在到了配置产品能力卡的环节。可见边界：每个能力维度至少 1 张，总数至少 6 张，tier 有 low/mid/high 三档。";
  }
  if (stage === "D5") {
    return "现在到了定价环节。可见边界：价格范围 1000-6000 元，步进 100 元。";
  }
  return "现在到了一个新的决策环节。";
}

async function runQuestionDefinition(runtime, options, row, persona, stage, stack) {
  if (!options?.questionDefinition) return null;
  const neutralDescription = neutralQuestionDescription(stage);
  const prompt = buildQuestionDefinitionPrompt(persona, stack, neutralDescription);
  const startedAt = new Date().toISOString();
  const call = await callJson(runtime.chatCompletion, prompt, validateQuestionDefinition, {
    max_tokens: 500,
    infoSetStage: stage
  });
  const record = {
    stage,
    neutral_description: neutralDescription,
    started_at: startedAt,
    ended_at: new Date().toISOString(),
    ...call
  };
  row.question_definition = row.question_definition || { enabled: true, calls: [] };
  row.question_definition.calls.push(record);
  row.calls.question_definition = Number(row.calls.question_definition || 0) + Number(call.attempts || 0);
  if (call.status !== "OK") throw new Error(`D_q ${stage} failed: ${call.error}`);
  return record;
}

function normalizeArchitecture(value) {
  const raw = String(value || "").trim();
  const low = raw.toLowerCase();
  if (low === "experience" || raw.includes("体验")) return "Experience";
  if (low === "hybrid" || raw.includes("混合")) return "Hybrid";
  if (low === "function" || raw.includes("功能")) return "Function";
  throw new Error(`architecture must be Experience/Hybrid/Function: ${value}`);
}

function getGrid(gridId) {
  const grid = GRID_OPTIONS.find((item) => item.grid_id === String(gridId || "").trim());
  if (!grid) throw new Error(`unknown grid_id: ${gridId}`);
  return grid;
}

function toVpScorerGridId(gridId) {
  const grid = getGrid(gridId);
  const strategy = grid.strategy === "DIFF" ? "Differentiation" : "Cost";
  const age = grid.age.charAt(0) + grid.age.slice(1).toLowerCase();
  return `${grid.customer_type}_${strategy}_${age}`;
}

function toGridPriorId(gridId) {
  const grid = getGrid(gridId);
  const channel = grid.customer_type === "ToB" ? "B2B" : "B2C";
  const strategy = grid.strategy === "DIFF" ? "Differentiation" : "Cost";
  const age = grid.age.charAt(0) + grid.age.slice(1).toLowerCase();
  return `${channel}_${strategy}_${age}`;
}

function formatJinangForPrompt(draw) {
  const market = draw.market || {};
  const tech = draw.tech || {};
  return [
    `市场锦囊：${market.name || market.id}（${market.r1_display || market.desc_for_player || ""}）`,
    `技术锦囊：${tech.name || tech.id}（${tech.r1_display || tech.desc_for_player || ""}）`
  ].join("\n");
}

function loadGeneratedMaps() {
  const artifact = loadJson(GENERATED_MAPS_PATH);
  const candidates = artifact?.generation?.candidates;
  if (!Array.isArray(candidates) || candidates.length < 5) {
    throw new Error("generated persona maps artifact does not contain generation.candidates");
  }
  const byLabel = new Map(candidates.map((candidate) => [candidate.label, candidate]));
  return { artifact, byLabel };
}

function loadMaterials() {
  if (!fs.existsSync(SPEC_PATH)) throw new Error(`spec missing: ${path.relative(ROOT, SPEC_PATH)}`);
  const { PERSONAS } = require("../sim/persona_pool");
  const generated = loadGeneratedMaps();
  const mapFiles = {};
  const maps = {};
  const personas = PERSONA_ORDER.map((id) => {
    const base = PERSONAS[id];
    if (!base) throw new Error(`persona missing from persona_pool: ${id}`);
    let items;
    let mapSource;
    let coreBlindSpot = base.blindSpots || "";
    if (FROZEN_MAP_FILES[id]) {
      items = loadJson(FROZEN_MAP_FILES[id]);
      mapSource = FROZEN_MAP_FILES[id];
      mapFiles[id] = mapSource;
    } else {
      const candidate = generated.byLabel.get(base.label);
      if (!candidate || !Array.isArray(candidate.items)) throw new Error(`generated map missing for ${base.label}`);
      items = candidate.items;
      coreBlindSpot = candidate.core_blind_spot || coreBlindSpot;
      mapSource = GENERATED_MAPS_PATH;
    }
    if (!Array.isArray(items) || items.length < 25) {
      throw new Error(`${base.label} map shape invalid: ${Array.isArray(items) ? items.length : "not-array"}`);
    }
    maps[base.label] = items;
    return {
      id,
      label: base.label,
      desc: base.desc,
      profile: base,
      core_blind_spot: coreBlindSpot,
      map_source: path.relative(ROOT, mapSource),
      map_items: items,
      map_sha256: sha256(JSON.stringify({ id, label: base.label, items }))
    };
  });

  const capabilityGroups = loadJson(CAPABILITY_PATH);
  const compatibilityRules = loadJson(COMPATIBILITY_PATH);
  const tagMap = loadJson(TAG_MAP_PATH);
  const dimensionAnchors = loadJson(DIMENSION_ANCHOR_PATH);
  const round1Model = loadJson(ROUND1_MODEL_PATH);
  const jinangConfig = loadJinangConfig();
  const capabilityIndex = new Map();
  const groupByCapability = new Map();
  for (const group of capabilityGroups.groups || []) {
    for (const capability of group.capabilities || []) {
      capabilityIndex.set(capability.cap_id, capability);
      groupByCapability.set(capability.cap_id, {
        group_id: group.group_id,
        name: group.name
      });
    }
  }
  if ((capabilityGroups.groups || []).length !== 6 || capabilityIndex.size !== 23) {
    throw new Error(`unexpected capability pool shape: groups=${(capabilityGroups.groups || []).length}, cards=${capabilityIndex.size}`);
  }
  return {
    personas,
    maps,
    generated,
    capabilityGroups,
    compatibilityRules,
    tagMap,
    dimensionAnchors,
    round1Model,
    jinangConfig,
    capabilityIndex,
    groupByCapability
  };
}

function drawJinang(jinangConfig) {
  const market = Array.isArray(jinangConfig.market) ? jinangConfig.market : [];
  const tech = Array.isArray(jinangConfig.tech) ? jinangConfig.tech : [];
  if (!market.length || !tech.length) throw new Error("jinang config must contain market and tech cards");
  return {
    market: market[Math.floor(Math.random() * market.length)],
    tech: tech[Math.floor(Math.random() * tech.length)],
    method: "true_random_single_member_draw_from_jinang_cards_v2; same config as production dealer, DB-free for independent script"
  };
}

function mean(values) {
  const arr = values.filter((value) => Number.isFinite(value));
  if (!arr.length) return 0;
  return arr.reduce((sum, value) => sum + value, 0) / arr.length;
}

function scoreMarketJinang(card, grid) {
  const weights = card?.affinity_weights || {};
  return clamp01(mean([
    Number(weights.customer_type?.[grid.customer_type]),
    Number(weights.strategy?.[grid.strategy]),
    Number(weights.age?.[grid.age])
  ]));
}

function selectedR2Groups(architecture) {
  if (architecture === "Experience") {
    return ["interaction_expression", "perception_understanding", "scalable_connectable", "expand_connect"];
  }
  if (architecture === "Function") {
    return ["motion_navigation", "mobility_navigation", "safety_trust", "ops_maintenance"];
  }
  return ["interaction_expression", "perception_understanding", "motion_navigation", "mobility_navigation", "safety_trust", "scalable_connectable", "expand_connect", "ops_maintenance"];
}

function scoreTechJinang(card, grid, architecture) {
  const weights = card?.affinity_weights || {};
  const groups = selectedR2Groups(architecture);
  const groupWeights = groups.map((group) => Number(weights.r2_groups?.[group])).filter((value) => Number.isFinite(value));
  return clamp01(mean([
    Number(weights.architecture?.[architecture]),
    Number(weights.strategy?.[grid.strategy]),
    groupWeights.length ? Math.max(...groupWeights) : NaN
  ]));
}

function settleJinang(draw, grid, architecture) {
  const marketStrength = scoreMarketJinang(draw.market, grid);
  const techStrength = scoreTechJinang(draw.tech, grid, architecture);
  const marketMatched = marketStrength >= 0.5;
  const techMatched = techStrength >= 0.5;
  return {
    market: {
      id: draw.market.id,
      name: draw.market.name,
      match_strength: Number(marketStrength.toFixed(4)),
      matched: marketMatched,
      bonus: marketMatched ? computeJinangWtpBonus(marketStrength) : 0
    },
    tech: {
      id: draw.tech.id,
      name: draw.tech.name,
      match_strength: Number(techStrength.toFixed(4)),
      matched: techMatched,
      effect_at_full_match: draw.tech.effect_at_full_match || {}
    }
  };
}

function computeVpCompositeScore(C, G, E) {
  const c = Math.max(1, Math.min(5, Number(C || 3)));
  const g = Math.max(1, Math.min(5, Number(G || 3)));
  const e = Math.max(1, Math.min(5, Number(E || 3)));
  return Math.min(5, Math.round(Math.sqrt(c * ((g + e) / 2)) * 10) / 10);
}

function buildRound1Outcome(gridId, architecture, vpScores, jinangSettlement, materials) {
  const baseNoJinang = Engine.computeRound1V2(gridId, architecture, vpScores, 0);
  const grid = getGrid(gridId);
  const C = Number(vpScores.C || baseNoJinang.C || 3);
  const G = Number(vpScores.G || baseNoJinang.G || 3);
  const E = Number(vpScores.E || baseNoJinang.E || 3);
  const vpEffectOnly = Number((Number(baseNoJinang.lambda_G || 1) * Number(baseNoJinang.lambda_E || 1) * Number(baseNoJinang.rho_C || 1)).toFixed(4));
  const wtpMultiplier = Number((vpEffectOnly * (1 + Number(jinangSettlement.market.bonus || 0))).toFixed(4));
  const compressedMult = RD.compressWtpMult(wtpMultiplier);
  const WTPrefRaw = Math.round(Number(baseNoJinang.WTPref || 0));
  const WTPadjRaw = Math.round(WTPrefRaw * wtpMultiplier);
  const WTPadjCompressedRaw = Math.round(WTPrefRaw * compressedMult);
  const targetGm = Math.min(
    Number(materials.round1Model.GM_cap || 0.65),
    Number(((Number(baseNoJinang.rho_C || 0.45)) * Number(materials.round1Model.target_gm_suggest_multiplier || 0.85)).toFixed(4))
  );
  return {
    ...baseNoJinang,
    grid_label: grid.label,
    C,
    G,
    E_raw: E,
    Eadj: E,
    VPscore: computeVpCompositeScore(C, G, E),
    WTPref: WTPrefRaw,
    WTPadj_raw: WTPadjRaw,
    WTPadj: WTPadjCompressedRaw,
    WTPref_scaled: scaleStoredMoney(WTPrefRaw, { positiveOnly: true }),
    WTPadj_scaled: scaleStoredMoney(WTPadjCompressedRaw, { positiveOnly: true }),
    wtp_vp_effect: vpEffectOnly,
    jinang_wtp_bonus: Number(jinangSettlement.market.bonus || 0),
    wtp_multiplier: wtpMultiplier,
    wtp_mult_compressed: compressedMult,
    jinang_match_strength: jinangSettlement.market.matched ? jinangSettlement.market.match_strength : 0,
    jinang_settlement: jinangSettlement,
    target_gm: targetGm,
    target_gm_rule: "min(GM_cap, rho_C * target_gm_suggest_multiplier)"
  };
}

async function callJson(chatCompletion, prompt, validator, options = {}) {
  if (options.infoSetStage) assertInfoSet(prompt, options.infoSetStage);
  let messages = [{ role: "user", content: prompt }];
  let raw = "";
  let lastError = null;
  for (let attempt = 0; attempt <= MAX_REPAIRS; attempt += 1) {
    try {
      raw = await chatCompletion(messages, {
        temperature: options.temperature ?? TEMPERATURE,
        max_tokens: options.max_tokens || 1600,
        maxRetries: 1
      });
      const parsed = validator(raw);
      return {
        prompt,
        prompt_sha256: sha256(prompt),
        raw_response: raw,
        parsed,
        attempts: attempt + 1,
        status: "OK",
        error: ""
      };
    } catch (error) {
      lastError = error;
      if (attempt < MAX_REPAIRS) {
        messages = [
          { role: "user", content: prompt },
          { role: "assistant", content: raw || "(空输出)" },
          { role: "user", content: `上一次输出无法用于实验：${error.message || error}。请只修正为合法 JSON，不要改变核心决策。` }
        ];
      }
    }
  }
  return {
    prompt,
    prompt_sha256: sha256(prompt),
    raw_response: raw,
    parsed: null,
    attempts: MAX_REPAIRS + 1,
    status: "FAIL",
    error: String(lastError?.message || lastError || "unknown error")
  };
}

function normalizeConstraints(value, validMapIds, label, max = 5) {
  if (!Array.isArray(value) || value.length === 0) throw new Error(`${label} must be a non-empty array`);
  if (value.length > max) throw new Error(`${label} may contain at most ${max} rows`);
  return value.map((item, index) => {
    const text = requireText(item?.text, `${label}[${index}].text`);
    const source = requireText(item?.source, `${label}[${index}].source`);
    if (!validMapIds.has(source) && !STACK_REFERENCES.has(source)) throw new Error(`${label}[${index}] invalid source: ${source}`);
    return { text, source };
  });
}

function validateR1Choice(raw, persona) {
  const parsed = parseJsonObject(raw);
  const validMapIds = new Set(persona.map_items.map((item) => item.id));
  const gridId = requireText(parsed.grid_id, "grid_id");
  getGrid(gridId);
  const architecture = normalizeArchitecture(parsed.architecture);
  const vpDraft = {
    who: requireText(parsed.vp_draft?.who, "vp_draft.who"),
    pain: requireText(parsed.vp_draft?.pain, "vp_draft.pain"),
    how: requireText(parsed.vp_draft?.how, "vp_draft.how")
  };
  const mapSources = (Array.isArray(parsed.map_sources) ? parsed.map_sources : []).map((item, index) => {
    const source = requireText(item, `map_sources[${index}]`);
    if (!validMapIds.has(source)) throw new Error(`invalid map source: ${source}`);
    return source;
  });
  if (!mapSources.length) throw new Error("map_sources must contain at least one valid map id");
  return {
    grid_id: gridId,
    grid_label: getGrid(gridId).label,
    architecture,
    vp_draft: vpDraft,
    choice_reason: requireText(parsed.choice_reason, "choice_reason"),
    map_sources: mapSources,
    updated_constraints: normalizeConstraints(parsed.updated_constraints, validMapIds, "updated_constraints", 5)
  };
}

function buildR1Prompt(persona, draw, questionDefinition = null) {
  const qLines = questionDefinition
    ? [
      "【你刚刚提出的问题】",
      questionDefinition.parsed.question,
      "【输出契约】围绕你自己的问题，填好 R1 JSON：grid_id 必须来自上方 12 个合法市场格子；architecture 必须是 Experience/Hybrid/Function；VP 草稿必须包含 WHO/PAIN/HOW；updated_constraints 与 map_sources 必须引用真实地图 id。"
    ]
    : [
      "【任务】做出 R1 的第一个战略选择：自选完整 12 格之一、架构标签、VP 草稿（WHO/PAIN/HOW），并把你的当前约束压栈。",
      "不要为了分散而分散；按你的认知地图自然判断。updated_constraints 与 map_sources 必须引用真实地图 id。"
    ];
  return [
    `你是一位"${persona.label}"型的企业管理者。`,
    `一句话背景：${persona.desc}`,
    `核心盲区摘要：${persona.core_blind_spot || persona.profile.blindSpots || ""}`,
    "【你的认知地图；M 条件，全量在场】",
    renderMap(persona.map_items),
    "【通用游戏场景】你在中国推广一款陪伴机器人产品，目标是找到一个能盈利的市场定位。",
    "【本轮随机锦囊；只按玩家可见文案理解，不要反推出隐藏权重】",
    formatJinangForPrompt(draw),
    "【12 个合法市场格子；必须自选其中一个完整 grid_id】",
    GRID_OPTIONS.map((item) => `- ${item.grid_id}: ${item.label}`).join("\n"),
    "【架构标签；必须自选其一】Experience=体验型，Hybrid=混合型，Function=功能型。",
    ...qLines,
    '输出 JSON：{"grid_id":"ToC_DIFF_CHILD|...","architecture":"Experience|Hybrid|Function","vp_draft":{"who":"...","pain":"...","how":"..."},"choice_reason":"一句话理由","map_sources":["map_xx"],"updated_constraints":[{"text":"...","source":"map_xx"}]}',
    "只输出可 JSON.parse 的 JSON，不要 Markdown，不要额外文字。"
  ].join("\n");
}

function r1StackRecord(parsed) {
  return {
    point: "R1",
    summary: `格子=${parsed.grid_label}(${parsed.grid_id})；架构=${parsed.architecture}；VP草稿[WHO=${parsed.vp_draft.who}；PAIN=${parsed.vp_draft.pain}；HOW=${parsed.vp_draft.how}]；理由=${parsed.choice_reason}；约束=${parsed.updated_constraints.map((item) => item.text).join("；")}`
  };
}

function buildPersonaReplyPrompt(persona, stack, coachMessage) {
  return [
    `你是"${persona.label}"本人，不是旁白。按你的认知地图自然回答 VP Coach。`,
    `一句话背景：${persona.desc}`,
    "【你的认知地图】",
    renderMap(persona.map_items),
    renderStack(stack),
    "【Coach 刚刚说】",
    coachMessage,
    "【任务】用第一人称回复。承接前面选择，不要推翻方向；可以补充 WHO/PAIN/HOW/边界/替代方案。120-220字。"
  ].join("\n");
}

async function preparePromptContext(options, row, persona, stage, stack, taskDescription, extra = {}) {
  if (!options?.bandwidthLayer) return { persona, stack };
  const prepared = await options.bandwidthLayer.prepare({
    persona,
    stage,
    stack,
    taskDescription,
    ...extra
  });
  row.bandwidth_audit = row.bandwidth_audit || {
    params: options.bandwidthLayer.params || {},
    calls: []
  };
  row.bandwidth_audit.calls.push(prepared.audit);
  return {
    persona: prepared.persona,
    stack: prepared.stack
  };
}

async function runCoach(runtime, persona, r1, draw, stack, options = {}) {
  const vpCoach = runtime.vpCoach;
  const grid = getGrid(r1.grid_id);
  const session = {
    teamId: `full_game_${persona.id}`,
    memberId: persona.id,
    messages: [],
    strategy: {
      grid_id: r1.grid_id,
      cellLabel: grid.label,
      cell_label: grid.label,
      architecture: r1.architecture,
      architectureLabel: r1.architecture,
      team_size: 1,
      who_raw: r1.vp_draft.who,
      marketJinang: [draw.market?.name].filter(Boolean),
      techJinang: [draw.tech?.name].filter(Boolean),
      jinang: {
        market: [draw.market?.name].filter(Boolean),
        tech: [draw.tech?.name].filter(Boolean)
      }
    }
  };
  const turns = [];
  const opening = await vpCoach.chat(session, "开始", { mode: "chat", temperature: 0.55 });
  session.messages.push({ role: "user", content: "开始" });
  session.messages.push({ role: "assistant", content: opening.replyText });
  turns.push({ role: "assistant", content: opening.replyText, mode: "chat", raw: opening });

  for (let index = 0; index < COACH_ROUNDS; index += 1) {
    const lastCoach = session.messages.filter((message) => message.role === "assistant").slice(-1)[0]?.content || "";
    const promptContext = await preparePromptContext(
      options,
      options.row,
      persona,
      "Coach",
      stack,
      `VP Coach 回复：承接 R1 选择，补充 WHO/PAIN/HOW/边界/替代方案。Coach 问题：${lastCoach}`,
      { callId: `Coach_${index + 1}` }
    );
    const replyPrompt = buildPersonaReplyPrompt(promptContext.persona, promptContext.stack, lastCoach);
    const studentReply = String(await runtime.chatCompletion([
      { role: "user", content: replyPrompt }
    ], { temperature: 0.75, max_tokens: 500, maxRetries: 1 })).trim();
    session.messages.push({ role: "user", content: studentReply });
    turns.push({ role: "user", content: studentReply, prompt: replyPrompt, prompt_sha256: sha256(replyPrompt) });
    const coach = await vpCoach.chat(session, studentReply, { mode: "chat", temperature: 0.55, forceSubmitGuide: index === COACH_ROUNDS - 1 });
    session.messages.push({ role: "assistant", content: coach.replyText });
    turns.push({ role: "assistant", content: coach.replyText, mode: "chat", raw: coach });
  }

  const synthesis = await vpCoach.synthesizeVP(session);
  return {
    status: "OK",
    session_strategy: session.strategy,
    turns,
    rounds: COACH_ROUNDS,
    synthesis,
    final_vp_text: String(synthesis?.vpText || "").trim()
  };
}

function vpFieldsFromText(fallbackVp, r1, synthesis) {
  const vpText = String(synthesis?.vpText || fallbackVp || "").trim();
  return {
    who_raw: r1.vp_draft.who,
    pain_raw: r1.vp_draft.pain,
    how_raw: r1.vp_draft.how,
    alternative_raw: "",
    boundary_raw: "",
    _vpText: vpText
  };
}

async function scoreFinalVp(runtime, r1, coach) {
  const vpText = coach.final_vp_text || `${r1.vp_draft.who}：${r1.vp_draft.pain}；${r1.vp_draft.how}`;
  const fields = vpFieldsFromText(vpText, r1, coach.synthesis);
  try {
    const extracted = runtime.vpWordScorer.extractVpFields(vpText);
    if (extracted?.who_raw) fields.who_raw = extracted.who_raw;
    if (extracted?.pain_raw) fields.pain_raw = extracted.pain_raw;
    if (extracted?.how_raw) fields.how_raw = extracted.how_raw;
    if (extracted?.alternative_raw) fields.alternative_raw = extracted.alternative_raw;
    if (extracted?.boundary_raw) fields.boundary_raw = extracted.boundary_raw;
  } catch (_) {
    // Keep the structured R1 draft fallback.
  }
  const scorerGridId = toVpScorerGridId(r1.grid_id);
  const result = await runtime.vpWordScorer.scoreVpByWord(fields, scorerGridId, r1.architecture);
  return {
    input: { fields, gridId: scorerGridId, engineGridId: r1.grid_id, architecture: r1.architecture },
    output: result
  };
}

function buildPersonaSummaryText(personaCard, grid, r1) {
  const rows = [
    `画像对象：${personaCard.name}，${personaCard.age}岁，${personaCard.occupation || personaCard.title || "访谈对象"}`,
    `格子来源：${grid.label}`,
    `R1 WHO：${r1.vp_draft.who}`,
    `背景/机构：${personaCard.living_situation || personaCard.org_type || ""} ${personaCard.org_scale || ""}`.trim(),
    `日常情境：${personaCard.daily_routine || ""}`,
    `科技态度：${personaCard.tech_comfort || ""}`,
    `表面需求：${(personaCard.desires || []).join("；")}`,
    `核心痛点：${(personaCard.pains || personaCard.pressures || []).join("；")}`,
    `深层触发：${personaCard.hidden_pain || personaCard.trigger || ""}`,
    `矛盾点：${(personaCard.contradictions || []).join("；")}`,
    `沟通风格：${personaCard.interview_style || personaCard.personality || ""}`
  ];
  return rows.filter((line) => line.replace(/：\s*$/, "").trim()).join("\n");
}

async function generateDynamicPersonaSummary(runtime, persona, r1) {
  const grid = getGrid(r1.grid_id);
  const strategy = {
    teamId: `full_game_${persona.id}`,
    gridLabel: grid.generatorLabel,
    who_raw: r1.vp_draft.who,
    architectureLabel: r1.architecture,
    isToB: grid.customer_type === "ToB",
    previousPersonas: []
  };
  const generated = await runtime.personaGenerator.generatePersona(null, strategy);
  return {
    status: "OK",
    method: "personaGenerator.generatePersona(null, strategy) -> experiment summary text",
    strategy,
    persona_card: generated,
    summary_text: buildPersonaSummaryText(generated, grid, r1),
    note: "D3 device is dynamic persona summary for the actual selected grid, not fixed persona_reports_v1.1."
  };
}

function validateD3(raw, persona) {
  const parsed = parseJsonObject(raw);
  const validMapIds = new Set(persona.map_items.map((item) => item.id));
  if (!Array.isArray(parsed.key_evidence) || parsed.key_evidence.length < 1 || parsed.key_evidence.length > 3) {
    throw new Error("key_evidence must contain one to three rows");
  }
  return {
    key_evidence: parsed.key_evidence.map((item, index) => requireText(item, `key_evidence[${index}]`)),
    market_judgment: requireText(parsed.market_judgment, "market_judgment"),
    evidence_themes: Array.isArray(parsed.evidence_themes)
      ? parsed.evidence_themes.slice(0, 5).map((item, index) => requireText(item, `evidence_themes[${index}]`))
      : [],
    updated_constraints: normalizeConstraints(parsed.updated_constraints, validMapIds, "updated_constraints", 5)
  };
}

function buildD3Prompt(persona, stack, summaryText) {
  return [
    `你是一位"${persona.label}"型的企业管理者。`,
    "【你的认知地图】",
    renderMap(persona.map_items),
    renderStack(stack),
    "【动态用户画像 summary；这是按你 R1 实际所选格子即时生成的，不是 bench 固定报告】",
    summaryText,
    "【任务】从 summary 中最多提取三条与你既有立场最相关的关键证据，形成市场判断，并更新约束。不要重做价值主张。",
    "updated_constraints 必须引用真实地图 id 或承前:R1/承前:Coach。",
    '输出 JSON：{"key_evidence":["summary中的具体证据"],"market_judgment":"...","evidence_themes":["主题词"],"updated_constraints":[{"text":"...","source":"map_xx或承前:R1"}]}',
    "只输出可 JSON.parse 的 JSON，不要 Markdown，不要额外文字。"
  ].join("\n");
}

function d3StackRecord(parsed) {
  return {
    point: "D3",
    summary: `证据=${parsed.key_evidence.join("；")}；市场判断=${parsed.market_judgment}；约束=${parsed.updated_constraints.map((item) => item.text).join("；")}`
  };
}

function tagExtractorMessages(d3, summaryText) {
  return [
    { role: "assistant", content: summaryText },
    {
      role: "assistant",
      content: [
        "D3 已筛选的关键证据：",
        ...d3.key_evidence.map((item, index) => `${index + 1}. ${item}`),
        `D3 市场判断：${d3.market_judgment}`
      ].join("\n")
    }
  ];
}

function assertRadarScores(scores) {
  const normalized = {};
  for (const key of RADAR_KEYS) {
    const value = Number(scores?.[key]);
    if (!Number.isFinite(value) || value < 1 || value > 10) {
      throw new Error(`invalid radar score ${key}: ${scores?.[key]}`);
    }
    normalized[key] = value;
  }
  return normalized;
}

async function extractEvidenceSignals(runtime, d3, summaryText, materials) {
  const messages = tagExtractorMessages(d3, summaryText);
  const tags = await runtime.extractTags(messages);
  if (!Array.isArray(tags) || tags.length < 8 || tags.length > 12) {
    throw new Error(`tagExtractor returned invalid tag count: ${Array.isArray(tags) ? tags.length : "not-array"}`);
  }
  const dimensionResult = await runtime.scoreTagsToDimensions(tags);
  const radarScores = assertRadarScores(dimensionResult.scores);
  const evi = Number(await RD.computeEvi({ tags, scores: radarScores }));
  if (!Number.isFinite(evi)) throw new Error(`non-finite evi: ${evi}`);
  const exactTagMap = tags.map((item) => ({
    tag: item.tag,
    polarity: item.polarity,
    exact_dimension: materials.tagMap.need_tag_to_dim?.[item.tag] || null
  }));
  return {
    tag_extraction: {
      input_messages: messages,
      output_tags: tags,
      exact_tag_map: exactTagMap,
      exact_mapped_count: exactTagMap.filter((item) => item.exact_dimension).length,
      unmapped_count: exactTagMap.filter((item) => !item.exact_dimension).length
    },
    dimension_aggregation: {
      method: "dimensionScorer.scoreTagsToDimensions",
      anchor_version: dimensionResult.anchorVersion,
      scores: radarScores
    },
    evi: {
      method: "rdCalculator.computeEvi",
      value: evi
    }
  };
}

function publicCardRows(materials) {
  return (materials.capabilityGroups.groups || []).map((group) => ({
    dimension: group.name,
    group_id: group.group_id,
    min_select: 1,
    cards: (group.capabilities || []).map((capability) => ({
      cap_id: capability.cap_id,
      name: capability.name,
      covers: capability.covers || [],
      tiers: ["low", "mid", "high"]
    }))
  }));
}

function qualitativeCompatibilityHints(materials) {
  const hints = [];
  const capName = (id) => materials.capabilityIndex.get(id)?.name || id;
  for (const group of materials.capabilityGroups.groups || []) {
    for (const capability of group.capabilities || []) {
      for (const [tier, tierData] of Object.entries(capability.tiers || {})) {
        for (const req of tierData.requires || []) {
          if (typeof req === "string") hints.push(`${capability.name} 的 ${tier} 档通常需要同时考虑 ${capName(req)}。`);
          else if (req?.cap) hints.push(`${capability.name} 的 ${tier} 档通常需要 ${capName(req.cap)} 达到 ${req.min_tier || "low"} 或以上。`);
        }
        for (const exc of tierData.excludes || []) {
          if (typeof exc === "string") hints.push(`${capability.name} 与 ${capName(exc)} 不能同时作为同一方案的核心选择。`);
          else if (exc?.cap) hints.push(`${capability.name} 与 ${capName(exc.cap)} 不能同时作为同一方案的核心选择。`);
        }
      }
      for (const exc of capability.excludes || []) {
        if (typeof exc === "string") hints.push(`${capability.name} 与 ${capName(exc)} 不能同时作为同一方案的核心选择。`);
      }
    }
  }
  return Array.from(new Set(hints));
}

function validateD4(raw, persona, materials) {
  const parsed = parseJsonObject(raw);
  if (!Array.isArray(parsed.cards) || parsed.cards.length < 6) {
    throw new Error("cards must contain at least six rows");
  }
  const seen = new Set();
  const cards = parsed.cards.map((item, index) => {
    const id = requireText(item?.id, `cards[${index}].id`);
    const tier = requireText(item?.tier, `cards[${index}].tier`).toLowerCase();
    if (seen.has(id)) throw new Error(`duplicate card id: ${id}`);
    seen.add(id);
    const capability = materials.capabilityIndex.get(id);
    if (!capability) throw new Error(`unknown card id: ${id}`);
    if (!Object.prototype.hasOwnProperty.call(capability.tiers || {}, tier)) {
      throw new Error(`invalid tier for ${id}: ${tier}`);
    }
    return { id, tier };
  });
  const validation = RD.validateSelections(cards.map((card) => ({ cap_id: card.id, tier: card.tier })));
  if (!validation.valid || validation.hardViolationCount !== 0) {
    const details = (validation.violations || []).map((item) => item.message || JSON.stringify(item)).join("; ");
    throw new Error(`compatibility validation failed: ${details || "unknown violation"}`);
  }
  const validMapIds = new Set(persona.map_items.map((item) => item.id));
  const costStance = {
    text: requireText(parsed.cost_stance?.text, "cost_stance.text"),
    source: requireText(parsed.cost_stance?.source, "cost_stance.source")
  };
  if (!validMapIds.has(costStance.source) && !STACK_REFERENCES.has(costStance.source)) {
    throw new Error(`invalid cost_stance.source: ${costStance.source}`);
  }
  return {
    cards,
    cost_stance: costStance,
    updated_constraints: normalizeConstraints(parsed.updated_constraints, validMapIds, "updated_constraints", 5),
    compatibility: validation
  };
}

function buildD4Prompt(persona, stack, materials, d3Summary, r1Outcome, questionDefinition = null) {
  void r1Outcome;
  const qLines = questionDefinition
    ? [
      "【你刚刚提出的问题】",
      questionDefinition.parsed.question,
      "【输出契约】围绕你自己的问题，填好能力卡 JSON：每张卡必须同时选择真实 cap_id 和 low/mid/high tier；每个维度至少 1 张、总数至少 6 张；具体张数、卡片和 tier 都由你决定。"
    ]
    : [
      "【任务】依据 R1-R2 栈选择能力卡。每张卡必须同时选择真实 cap_id 和 low/mid/high tier；每个维度至少 1 张、总数至少 6 张。具体张数、卡片和 tier 都由你决定。"
    ];
  return [
    `你是一位"${persona.label}"型的企业管理者。`,
    "【你的认知地图】",
    renderMap(persona.map_items),
    renderStack(stack),
    "【D3 市场证据摘要】",
    d3Summary,
    "【能力卡池；学生可见信息】",
    JSON.stringify(publicCardRows(materials), null, 2),
    "【兼容提示；学生可见文字提示】",
    qualitativeCompatibilityHints(materials).join("\n") || "无额外提示。",
    ...qLines,
    "cost_stance.source 必须引用真实地图 id 或承前:R1/承前:D3。",
    '输出 JSON：{"cards":[{"id":"<真实cap_id>","tier":"low|mid|high"}],"cost_stance":{"text":"<成本立场>","source":"map_xx或承前:D3"},"updated_constraints":[{"text":"<约束>","source":"map_xx或承前:D3"}]}',
    "只输出可 JSON.parse 的 JSON，不要 Markdown，不要额外文字。"
  ].join("\n");
}

function d4StackRecord(parsed, materials) {
  const grouped = new Map();
  for (const card of parsed.cards) {
    const group = materials.groupByCapability.get(card.id);
    const key = group?.name || group?.group_id || "未知维度";
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(`${card.id}@${card.tier}`);
  }
  return {
    point: "D4",
    summary: `选卡${parsed.cards.length}张[${Array.from(grouped.entries()).map(([name, values]) => `${name}=${values.join(",")}`).join("；")}]；成本立场=${parsed.cost_stance.text}；约束=${parsed.updated_constraints.map((item) => item.text).join("；")}`
  };
}

function validateD5(raw, persona) {
  const parsed = parseJsonObject(raw);
  const price = Number(parsed.price);
  if (!Number.isFinite(price) || price < 1000 || price > 6000) throw new Error(`price must be numeric within 1000-6000: ${parsed.price}`);
  const validMapIds = new Set(persona.map_items.map((item) => item.id));
  const basis = {
    text: requireText(parsed.basis?.text, "basis.text"),
    source: requireText(parsed.basis?.source, "basis.source")
  };
  if (!validMapIds.has(basis.source) && !STACK_REFERENCES.has(basis.source)) throw new Error(`invalid basis.source: ${basis.source}`);
  return {
    price,
    aligned_price: Math.max(1000, Math.min(6000, Math.round(price / 100) * 100)),
    basis,
    reasoning: requireText(parsed.reasoning, "reasoning")
  };
}

function buildD5Prompt(persona, stack, r1Outcome, questionDefinition = null) {
  void r1Outcome;
  const qLines = questionDefinition
    ? [
      "【你刚刚提出的问题】",
      questionDefinition.parsed.question,
      "【输出契约】围绕你自己的问题，填好定价 JSON：价格范围 1000-6000 元，步进 100 元。"
    ]
    : [
      "【任务】依据既有栈做最终定价，赚最多的钱。可定价范围 1000-6000 元，步进 100 元。"
    ];
  return [
    `你是一位"${persona.label}"型的企业管理者。`,
    "【你的认知地图】",
    renderMap(persona.map_items),
    renderStack(stack),
    ...qLines,
    "basis.source 必须引用真实地图 id 或承前:R1/承前:Coach/承前:D3/承前:D4。",
    '输出 JSON：{"price":1000到6000之间、且为100的整数倍,"basis":{"text":"<依据>","source":"map_xx或承前:D4"},"reasoning":"<理由>"}',
    "只输出可 JSON.parse 的 JSON，不要 Markdown，不要额外文字。"
  ].join("\n");
}

function cardsByTier(cards) {
  const result = { low: 0, mid: 0, high: 0 };
  for (const card of cards || []) result[card.tier] = (result[card.tier] || 0) + 1;
  return result;
}

function cardDimensionCoverage(cards, materials) {
  const groups = new Set();
  for (const card of cards || []) {
    const group = materials.groupByCapability.get(card.id);
    if (group?.group_id) groups.add(group.group_id);
  }
  return Array.from(groups).sort();
}

async function calculateR2(row, materials) {
  const r1 = row.r1_settlement;
  const d4 = row.r2.d4.parsed;
  const d5 = row.r2.d5.parsed;
  const signals = row.r2.evidence_signals;
  const price = d5.aligned_price;
  const selections = d4.cards.map((card) => ({ cap_id: card.id, tier: card.tier }));
  const calcGridId = toGridPriorId(r1.grid_id);
  const input = {
    gridId: calcGridId,
    engineGridId: r1.grid_id,
    round1GridId: r1.grid_id,
    round1Context: { gridId: r1.grid_id },
    selections,
    radar: signals.dimension_aggregation.scores,
    tags: signals.tag_extraction.output_tags,
    evi: Number(signals.evi.value),
    P: price,
    Pmax: Number(r1.WTPadj_scaled || r1.WTPref_scaled || 0),
    WTPref_override: Number(r1.WTPref_scaled || 0) || undefined,
    WTP: Number(r1.WTPadj_scaled || r1.WTPref_scaled || 0),
    e: 1.2,
    COGSbase: Number(RD.GLOBAL_PARAMS.V || 600),
    wtp_multiplier: Number(r1.wtp_multiplier || 1),
    source: "scripts/analysis/full_game_all_personas.js"
  };
  const output = await RD.calculate(input);
  const exactMappedCount = Number(signals.tag_extraction.exact_mapped_count || 0);
  const engineTags = (output.tagBreakdown || []).map((item) => ({
    tag: item.tag,
    dimension: item.dimCN || null,
    tier: item.tier || null,
    weight: Number(item.w || 0)
  }));
  return {
    input,
    output,
    tag_flow: {
      extracted_tags: signals.tag_extraction.output_tags.map((item) => item.tag),
      exact_mapped_count: exactMappedCount,
      effective_tags: engineTags,
      fallback_used: exactMappedCount < Math.min(signals.tag_extraction.output_tags.length, 6),
      note: "rdCalculator.ensureSufficientTags fills missing exact tags from grid prior / radar fallback."
    },
    metrics: {
      cost: Number(output.COGS || 0),
      dCOGS: Number(output.dCOGS || 0),
      risk: Number(output.risk || 0),
      Vscore: Number(output.V || 0),
      Q: Number(output.units || 0),
      profit: Number(output.profit || 0),
      actualGm: Number(output.actualGm || 0),
      evi: Number(output.evi || 0)
    }
  };
}

function assertFiniteOutput(row) {
  if (row.status !== "OK") return;
  const output = row.r2?.calculate?.output || {};
  for (const key of ["profit", "units", "P", "V", "dCOGS", "risk", "evi"]) {
    const value = Number(output[key]);
    if (!Number.isFinite(value)) throw new Error(`${row.persona_label} non-finite ${key}: ${output[key]}`);
  }
}

async function runPlaythrough(runtime, persona, materials, runId, options = {}) {
  const createdAt = new Date().toISOString();
  const row = {
    run_id: runId,
    created_at: createdAt,
    persona_id: persona.id,
    persona_label: persona.label,
    condition: options.condition || CONDITION,
    map_condition: CONDITION,
    rep: Number(options.rep || 1),
    status: "RUNNING",
    error: "",
    map_sha256: persona.map_sha256,
    defect: options.defect || null,
    defect_audit: {},
    question_definition: options.questionDefinition ? { enabled: true, calls: [] } : null,
    r0_jinang: null,
    r1_choice: null,
    coach: null,
    vp_report_only: null,
    r1_settlement: null,
    r2: null,
    calls: { decision_json: 0, question_definition: 0, coach_persona_replies: 0, persona_generator: 0, tag_extractor: 0, vp_word_scorer: 0 }
  };
  try {
    const draw = options.jinangDraw || drawJinang(materials.jinangConfig);
    row.r0_jinang = draw;

    const r1Question = await runQuestionDefinition(runtime, options, row, persona, "R1", []);
    const r1Context = await preparePromptContext(
      options,
      row,
      persona,
      "R1",
      [],
      "R1 选战略：在中国推广陪伴机器人，自选 12 格市场、架构标签、VP 草稿与当前约束。",
      { callId: "R1" }
    );
    const r1Prompt = buildR1Prompt(r1Context.persona, draw, r1Question);
    const r1Call = await callJson(runtime.chatCompletion, r1Prompt, (raw) => validateR1Choice(raw, persona), { max_tokens: 1800, infoSetStage: "R1" });
    row.calls.decision_json += r1Call.attempts;
    if (r1Call.status !== "OK") throw new Error(`R1 choice failed: ${r1Call.error}`);
    row.r1_choice = r1Call;
    let stack = [
      ...(r1Question ? [questionStackRecord("R1", r1Question.parsed.question)] : []),
      r1StackRecord(r1Call.parsed)
    ];

    const coach = await runCoach(runtime, persona, r1Call.parsed, draw, stack, { ...options, row });
    row.calls.coach_persona_replies += COACH_ROUNDS;
    row.coach = coach;
    stack = [...stack, {
      point: "Coach",
      summary: `Coach轮数=${coach.rounds}；最终VP=${coach.final_vp_text || "（空）"}`
    }];

    const vpScore = await scoreFinalVp(runtime, r1Call.parsed, coach);
    row.calls.vp_word_scorer += 1;
    row.vp_report_only = {
      enters_profit_or_Q: false,
      ...vpScore
    };
    const grid = getGrid(r1Call.parsed.grid_id);
    const jinangSettlement = settleJinang(draw, grid, r1Call.parsed.architecture);
    row.r1_settlement = buildRound1Outcome(
      r1Call.parsed.grid_id,
      r1Call.parsed.architecture,
      vpScore.output.scores,
      jinangSettlement,
      materials
    );

    const dynamicSummary = await generateDynamicPersonaSummary(runtime, persona, r1Call.parsed);
    row.calls.persona_generator += 1;
    let d3SummaryText = dynamicSummary.summary_text;
    if (typeof options.beforeD3Summary === "function") {
      const result = options.beforeD3Summary({
        summaryText: d3SummaryText,
        row,
        persona,
        r1: r1Call.parsed,
        dynamicSummary,
        stack: stack.slice()
      }) || {};
      d3SummaryText = String(result.summaryText || d3SummaryText);
      row.defect_audit.d3_summary = result.audit || null;
      dynamicSummary.original_summary_text = dynamicSummary.summary_text;
      dynamicSummary.summary_text = d3SummaryText;
      dynamicSummary.summary_modified_by_hook = true;
    }
    const d3Context = await preparePromptContext(
      options,
      row,
      persona,
      "D3",
      stack,
      "D3 市场证据提取：从动态用户画像 summary 中提取关键证据、形成市场判断、更新约束。",
      { callId: "D3" }
    );
    const d3Prompt = buildD3Prompt(d3Context.persona, d3Context.stack, d3SummaryText);
    const d3Call = await callJson(runtime.chatCompletion, d3Prompt, (raw) => validateD3(raw, persona), { max_tokens: 1600, infoSetStage: "D3" });
    row.calls.decision_json += d3Call.attempts;
    if (d3Call.status !== "OK") throw new Error(`D3 failed: ${d3Call.error}`);
    stack = [...stack, d3StackRecord(d3Call.parsed)];

    const evidenceSignals = await extractEvidenceSignals(runtime, d3Call.parsed, d3SummaryText, materials);
    row.calls.tag_extractor += 1;

    const d4Question = await runQuestionDefinition(runtime, options, row, persona, "D4", stack);
    if (d4Question) stack = [...stack, questionStackRecord("D4", d4Question.parsed.question)];
    const d4Context = await preparePromptContext(
      options,
      row,
      persona,
      "D4",
      stack,
      "D4 能力卡选择：依据 R1-R2 栈选择 cap_id 与 tier，每个维度至少 1 张、总数至少 6 张，并形成成本立场。",
      { callId: "D4" }
    );
    const d4Prompt = buildD4Prompt(
      d4Context.persona,
      d4Context.stack,
      materials,
      `${d3Call.parsed.key_evidence.join("；")} / ${d3Call.parsed.market_judgment}`,
      row.r1_settlement,
      d4Question
    );
    const d4Call = await callJson(runtime.chatCompletion, d4Prompt, (raw) => validateD4(raw, persona, materials), { max_tokens: 4000, infoSetStage: "D4" });
    row.calls.decision_json += d4Call.attempts;
    if (d4Call.status !== "OK") throw new Error(`D4 failed: ${d4Call.error}`);
    stack = [...stack, d4StackRecord(d4Call.parsed, materials)];

    let d5PromptOutcome = row.r1_settlement;
    if (typeof options.beforeD5Prompt === "function") {
      const result = options.beforeD5Prompt({
        r1Outcome: row.r1_settlement,
        row,
        persona,
        stack: stack.slice()
      }) || {};
      d5PromptOutcome = result.r1Outcome || d5PromptOutcome;
      row.defect_audit.d5_prompt = result.audit || null;
    }
    const d5Question = await runQuestionDefinition(runtime, options, row, persona, "D5", stack);
    if (d5Question) stack = [...stack, questionStackRecord("D5", d5Question.parsed.question)];
    const d5Context = await preparePromptContext(
      options,
      row,
      persona,
      "D5",
      stack,
      "D5 最终定价：依据既有栈与选卡方案，在价格滑块范围内确定最终价格。",
      { callId: "D5" }
    );
    const d5Prompt = buildD5Prompt(d5Context.persona, d5Context.stack, d5PromptOutcome, d5Question);
    const d5Call = await callJson(runtime.chatCompletion, d5Prompt, (raw) => validateD5(raw, persona), { max_tokens: 1600, infoSetStage: "D5" });
    row.calls.decision_json += d5Call.attempts;
    if (d5Call.status !== "OK") throw new Error(`D5 failed: ${d5Call.error}`);
    stack = [...stack, {
      point: "D5",
      summary: `定价=${d5Call.parsed.aligned_price}；依据=${d5Call.parsed.basis.text}；理由=${d5Call.parsed.reasoning}`
    }];

    row.r2 = {
      dynamic_summary: dynamicSummary,
      d3: d3Call,
      evidence_signals: evidenceSignals,
      d4: d4Call,
      d5: d5Call,
      calculate: null
    };
    row.r2.calculate = await calculateR2(row, materials);
    row.final_stack = stack;
    row.status = "OK";
    assertFiniteOutput(row);
    return row;
  } catch (error) {
    row.status = "FAIL";
    row.error = String(error?.message || error);
    return row;
  }
}

function getStep(row, key) {
  if (key === "R1") return row.r1_choice;
  if (key === "D3") return row.r2?.d3;
  if (key === "D4") return row.r2?.d4;
  if (key === "D5") return row.r2?.d5;
  return null;
}

function fmt(value, digits = 2) {
  const num = Number(value);
  if (!Number.isFinite(num)) return "";
  return digits === 0 ? String(Math.round(num)) : String(Math.round(num * (10 ** digits)) / (10 ** digits));
}

function gridDistributionRows(rows) {
  return rows.map((row) => {
    const r1 = row.r1_choice?.parsed || {};
    return `| ${row.persona_label} | ${r1.grid_label || ""} | ${r1.architecture || ""} | ${String(r1.choice_reason || "").replace(/\|/g, "｜")} |`;
  });
}

function vpRows(rows) {
  return rows.map((row) => {
    const r1 = row.r1_choice?.parsed || {};
    const scores = row.vp_report_only?.output?.scores || {};
    return `| ${row.persona_label} | ${r1.vp_draft?.who || ""} | ${r1.vp_draft?.pain || ""} | ${r1.vp_draft?.how || ""} | ${row.coach?.rounds ?? ""} | ${fmt(scores.C)}/${fmt(scores.G)}/${fmt(scores.E)} | ${fmt(scores.VPscore)} |`;
  });
}

function qualitativeFit(item) {
  const name = item?.name || item?.id || "";
  const strength = Number(item?.match_strength || 0);
  if (item?.matched && strength >= 0.75) return `${name}：高度契合`;
  if (item?.matched && strength >= 0.5) return `${name}：部分契合`;
  return `${name}：契合度有限`;
}

function r1SettlementRows(rows) {
  return rows.map((row) => {
    const r1 = row.r1_settlement || {};
    const jinang = r1.jinang_settlement || {};
    return `| ${row.persona_label} | ${r1.grid_label || ""} | ${r1.arch_tag || r1.architecture || ""} | ${fmt(r1.VPscore)} | ${qualitativeFit(jinang.market)} | ${qualitativeFit(jinang.tech)} |`;
  });
}

function r2DecisionRows(rows, materials) {
  return rows.map((row) => {
    const d3 = row.r2?.d3?.parsed || {};
    const d4 = row.r2?.d4?.parsed || {};
    const d5 = row.r2?.d5?.parsed || {};
    const tier = cardsByTier(d4.cards || []);
    const dims = cardDimensionCoverage(d4.cards || [], materials);
    return `| ${row.persona_label} | ${(d3.evidence_themes || []).join("、") || d3.key_evidence?.slice(0, 2).join("；") || ""} | ${(d4.cards || []).length} | ${dims.length}/6 | low ${tier.low || 0}, mid ${tier.mid || 0}, high ${tier.high || 0} | ${fmt(d5.aligned_price, 0)} |`;
  });
}

function economicsRows(rows) {
  return rows
    .slice()
    .sort((a, b) => Number(b.r2?.calculate?.metrics?.profit || -Infinity) - Number(a.r2?.calculate?.metrics?.profit || -Infinity))
    .map((row, index) => {
      const m = row.r2?.calculate?.metrics || {};
      return `| ${index + 1} | ${row.persona_label} | ${fmt(m.cost, 0)} | ${fmt(m.dCOGS, 0)} | ${fmt(m.risk)} | ${fmt(m.Vscore)} | ${fmt(m.Q, 0)} | ${fmt(m.profit, 0)} | ${row.r2?.calculate?.tag_flow?.fallback_used ? "是" : "否"} |`;
    });
}

function rowMapByPersona(rows) {
  return new Map(rows.map((row) => [row.persona_id, row]));
}

function isProfitable(row) {
  return Number(row.r2?.calculate?.metrics?.profit || 0) > 0;
}

function hasOverspend(row) {
  const output = row.r2?.calculate?.output || {};
  return Number(output.overBudget || 0) > 0 ||
    Number(output.overCap || 0) > 0 ||
    Number(output.hardViolationCount || 0) > 0 ||
    (Array.isArray(output.violations) && output.violations.length > 0);
}

function priceOverTrueWtp(row) {
  const output = row.r2?.calculate?.output || {};
  const price = Number(output.P);
  const wtp = Number(output.WTPref_adjusted || output.WTP || output.WTPref);
  return Number.isFinite(price) && Number.isFinite(wtp) && price > wtp;
}

function executionStats(rows) {
  const ok = rows.filter((row) => row.status === "OK");
  return {
    ok: ok.length,
    profitable: ok.filter(isProfitable).length,
    zeroOverspend: ok.filter((row) => !hasOverspend(row)).length,
    underTrueWtp: ok.filter((row) => !priceOverTrueWtp(row)).length,
    targetGmUsageFields: ok.filter((row) => row.r2?.d5?.parsed && Object.prototype.hasOwnProperty.call(row.r2.d5.parsed, "target_gm_usage")).length
  };
}

function executionAuditRows(v2Rows, v1Rows) {
  const v1Map = rowMapByPersona(v1Rows);
  return v2Rows.map((row) => {
    const v1 = v1Map.get(row.persona_id);
    const output = row.r2?.calculate?.output || {};
    const price = Number(output.P);
    const trueWtp = Number(output.WTPref_adjusted || output.WTP || output.WTPref);
    const overBudget = Number(output.overBudget || 0);
    const overCap = Number(output.overCap || 0);
    return `| ${row.persona_label} | ${v1 ? fmt(v1.r2?.calculate?.metrics?.profit, 0) : "NA"} | ${fmt(row.r2?.calculate?.metrics?.profit, 0)} | ${overBudget > 0 || overCap > 0 ? `是（budget ${fmt(overBudget, 0)} / cap ${fmt(overCap, 0)}）` : "否"} | ${priceOverTrueWtp(row) ? `是（P ${fmt(price, 0)} > WTP ${fmt(trueWtp, 0)}）` : `否（P ${fmt(price, 0)} / WTP ${fmt(trueWtp, 0)}）`} |`;
  });
}

function profitabilityRows(v2Rows, v1Rows) {
  const v2Stats = executionStats(v2Rows);
  const v1Stats = executionStats(v1Rows);
  const v1Value = v1Stats.ok ? `${v1Stats.profitable}/${v1Stats.ok}` : "6/7";
  return [
    `| full_game v2 | ${v2Stats.profitable}/${v2Stats.ok || 7} | 闭卷：D4/D5 不给精确成本、WTP、target_gm、预算惩罚公式 |`,
    `| full_game v1 | ${v1Value} | 开卷泄漏：D4/D5 含精确成本/WTP/target_gm/公式字段 |`,
    "| 真人 BQ | 37.5% | 真人 UI 信息集 |",
    "| layered 四臂 | 67% | 已核实无 full_game v1 这类精确泄漏 |"
  ];
}

function stabilityRows(v2Rows, v1Rows) {
  const v1Map = rowMapByPersona(v1Rows);
  return v2Rows.map((row) => {
    const v1 = v1Map.get(row.persona_id);
    const v1R1 = v1?.r1_choice?.parsed || {};
    const v2R1 = row.r1_choice?.parsed || {};
    const v1D3 = v1?.r2?.d3?.parsed || {};
    const v2D3 = row.r2?.d3?.parsed || {};
    const gridStable = v1 && v1R1.grid_id === v2R1.grid_id ? "稳定" : "变化";
    return `| ${row.persona_label} | ${v1R1.grid_label || "NA"} → ${v2R1.grid_label || ""} | ${v1R1.architecture || "NA"} → ${v2R1.architecture || ""} | ${gridStable} | ${(v1D3.evidence_themes || []).join("、") || "NA"} → ${(v2D3.evidence_themes || []).join("、") || ""} |`;
  });
}

function leakMappingRows() {
  return [
    "| D4 每卡 dCOGS/risk/sub_lift/load/NRE | 移除；只保留 cap_id/name/covers 与 low/mid/high 档位存在 |",
    "| D4 预算惩罚公式/兼容性机器规则 | 移除；只保留学生可见文字兼容提示 |",
    "| D5 WTPadj/WTPref/定价天花板 | 移除；只保留价格滑块范围与步进 |",
    "| D5 target_gm/target_gm_rule/强制毛利算术 | 移除；输出 schema 不再要求 target_gm_usage |",
    "| 锦囊 match_strength/effect_at_full_match 精确值 | prompt 中不注入；报告只用定性契合标签 |"
  ];
}

function compatibilityRows(rows) {
  return rows.map((row) => {
    const compat = row.r2?.d4?.parsed?.compatibility || {};
    return `| ${row.persona_label} | ${compat.valid ? "OK" : "FAIL"} | ${compat.hardViolationCount ?? ""} | ${(compat.violations || []).length} |`;
  });
}

function mapTraceRows(rows) {
  return rows.map((row) => {
    const sources = new Set();
    const r1 = row.r1_choice?.parsed;
    (r1?.map_sources || []).forEach((item) => sources.add(item));
    (r1?.updated_constraints || []).forEach((item) => sources.add(item.source));
    (row.r2?.d3?.parsed?.updated_constraints || []).forEach((item) => sources.add(item.source));
    (row.r2?.d4?.parsed?.updated_constraints || []).forEach((item) => sources.add(item.source));
    if (row.r2?.d4?.parsed?.cost_stance?.source) sources.add(row.r2.d4.parsed.cost_stance.source);
    if (row.r2?.d5?.parsed?.basis?.source) sources.add(row.r2.d5.parsed.basis.source);
    return `| ${row.persona_label} | ${Array.from(sources).filter((item) => !STACK_REFERENCES.has(item)).sort().join(", ")} |`;
  });
}

function oneSentenceObservation(rows) {
  const ok = rows.filter((row) => row.status === "OK");
  const grids = new Set(ok.map((row) => row.r1_choice?.parsed?.grid_id).filter(Boolean));
  const profits = ok.map((row) => ({ label: row.persona_label, profit: Number(row.r2?.calculate?.metrics?.profit || 0) }))
    .sort((a, b) => b.profit - a.profit);
  if (!ok.length) return "本轮没有完成链路，无法观察 persona 分化。";
  return `7 条链路在 ${grids.size} 个首选格子上展开；利润最高为${profits[0]?.label || "N/A"}，最低为${profits[profits.length - 1]?.label || "N/A"}，可重点看是否出现“叙事方向清楚但选卡/定价被成本或需求覆盖吃掉”的教学型反差。`;
}

function writeSummary(paths, rows, materials) {
  const latest = latestRows(rows);
  const okRows = latest.filter((row) => row.status === "OK");
  const v1Rows = latestRowsForRun(V1_JSONL_PATH, V1_RUN_ID).filter((row) => row.status === "OK");
  const v2Stats = executionStats(okRows);
  const v1Stats = executionStats(v1Rows);
  const lines = [
    `# ${RUN_ID} Summary`,
    "",
    "## Device / Info-set Note",
    "",
    "本轮 D3 使用真实 `personaGenerator.js` 按 persona 实际所选格子动态生成用户画像 summary；既往 bench/engine/search/persona D1-D4 链的 D3 使用固定 `persona_reports_v1.1`（且主要只有 B2B_Differentiation_Elder 素材）。两套装置不可做价差/主题频次的直接横向比较，本报告只比较本轮 7 人内部结果。",
    "",
    "v2 另接入 `assertInfoSet(promptText, stage)`：D4/D5 不再向 persona 注入精确成本、WTP、target_gm、预算/惩罚公式或机器可读兼容规则；结算账本仍按真实引擎参数计算。",
    "",
    "## Completion",
    "",
    `- Latest rows: ${latest.length}/7`,
    `- OK: ${okRows.length}/7`,
    `- Failed: ${latest.filter((row) => row.status !== "OK").map((row) => `${row.persona_label}: ${row.error}`).join("；") || "none"}`,
    `- Money scale: ${MONEY_SCALE_CONTRACT}`,
    `- Reused v1 jinang draws: ${v1Rows.length}/7`,
    `- Info-set checks: ${okRows.length ? "R1/D3/D4/D5 prompts passed at call time" : "pending"}`,
    "",
    "## 1. v1 泄漏项 → v2 处置",
    "",
    "| v1 泄漏项 | v2 处置 |",
    "|---|---|",
    ...leakMappingRows(),
    "",
    "## 2. 执行完美度退化情况",
    "",
    `- v1 zero overspend: ${v1Stats.ok ? `${v1Stats.zeroOverspend}/${v1Stats.ok}` : "NA"}；v2 zero overspend: ${v2Stats.ok ? `${v2Stats.zeroOverspend}/${v2Stats.ok}` : "NA"}`,
    `- v1 price <= true WTP: ${v1Stats.ok ? `${v1Stats.underTrueWtp}/${v1Stats.ok}` : "NA"}；v2 price <= true WTP: ${v2Stats.ok ? `${v2Stats.underTrueWtp}/${v2Stats.ok}` : "NA"}`,
    `- v1 D5 target_gm_usage fields: ${v1Stats.ok ? `${v1Stats.targetGmUsageFields}/${v1Stats.ok}` : "NA"}；v2 D5 target_gm_usage fields: ${v2Stats.ok ? `${v2Stats.targetGmUsageFields}/${v2Stats.ok}` : "NA"}`,
    "",
    "| Persona | v1 profit | v2 profit | v2 超预算/超容量 | v2 定价是否越过真实 WTP |",
    "|---|---:|---:|---|---|",
    ...executionAuditRows(okRows, v1Rows),
    "",
    "## 3. 盈利率四数并排",
    "",
    "| 条件 | 盈利率 | 信息集条件 |",
    "|---|---:|---|",
    ...profitabilityRows(okRows, v1Rows),
    "",
    "## 4. 格子选择 / VP / 证据主题稳定性",
    "",
    "| Persona | 格子 v1→v2 | 架构 v1→v2 | 格子稳定性 | D3 证据主题 v1→v2 |",
    "|---|---|---|---|---|",
    ...stabilityRows(okRows, v1Rows),
    "",
    "## 5. 格子分布表（v2）",
    "",
    "| Persona | 格子 | 架构 | 一句话选择理由摘录 |",
    "|---|---|---|---|",
    ...gridDistributionRows(okRows),
    "",
    "## 6. VP 与 Coach（v2）",
    "",
    "| Persona | WHO | PAIN | HOW | Coach轮数 | C/G/E | VPscore |",
    "|---|---|---|---|---:|---:|---:|",
    ...vpRows(okRows),
    "",
    "## 7. R1 结算（v2，prompt 不注入精确内部数值）",
    "",
    "| Persona | 格子 | 架构 | VPscore | market jinang fit | tech jinang fit |",
    "|---|---|---|---:|---|---|",
    ...r1SettlementRows(okRows),
    "",
    "## 8. R2 决策（v2）",
    "",
    "| Persona | 证据主题 | 选卡数 | 维度覆盖 | tier分布 | 价格 |",
    "|---|---|---:|---:|---|---:|",
    ...r2DecisionRows(okRows, materials),
    "",
    "## 9. 最终经济结果（v2，按 profit 排序）",
    "",
    "| Rank | Persona | COGS | dCOGS | risk | Vscore | Q | profit | evi fallback |",
    "|---:|---|---:|---:|---:|---:|---:|---:|---|",
    ...economicsRows(okRows),
    "",
    "## 10. 校验表",
    "",
    "| Persona | D4 compatibility | hard violations | total violations |",
    "|---|---|---:|---:|",
    ...compatibilityRows(okRows),
    "",
    "## Map Reference Trace",
    "",
    "| Persona | referenced real map ids |",
    "|---|---|",
    ...mapTraceRows(okRows),
    "",
    "## One-sentence Observation",
    "",
    `${oneSentenceObservation(okRows)} v2 若出现超支或越过真实 WTP，按本 spec 记为真人式误估候选，而不是失败。`,
    ""
  ];
  fs.writeFileSync(paths.summary, lines.join("\n"), "utf8");
}

function writeSamples(paths, rows) {
  const latest = latestRows(rows);
  const lines = [`# ${RUN_ID} Raw Samples`, ""];
  for (const row of latest) {
    lines.push(`## ${row.persona_label} (${row.status})`, "");
    if (row.error) lines.push(`Error: ${row.error}`, "");
    lines.push("### R0 Jinang", "", "```json", JSON.stringify(row.r0_jinang, null, 2), "```", "");
    lines.push("### R1 Choice", "", "#### Prompt", "", row.r1_choice?.prompt || "", "", "#### Raw", "", row.r1_choice?.raw_response || "", "", "#### Parsed", "", "```json", JSON.stringify(row.r1_choice?.parsed || null, null, 2), "```", "");
    lines.push("### Coach Dialogue", "");
    for (const turn of row.coach?.turns || []) {
      lines.push(`- ${turn.role}: ${turn.content}`);
    }
    lines.push("", "#### Synthesis", "", "```json", JSON.stringify(row.coach?.synthesis || null, null, 2), "```", "");
    lines.push("### R1 Settlement", "", "```json", JSON.stringify(row.r1_settlement || null, null, 2), "```", "");
    lines.push("### Dynamic Persona Summary", "", row.r2?.dynamic_summary?.summary_text || "", "", "```json", JSON.stringify(row.r2?.dynamic_summary?.persona_card || null, null, 2), "```", "");
    lines.push("### D3 Evidence", "", "#### Prompt", "", row.r2?.d3?.prompt || "", "", "#### Raw", "", row.r2?.d3?.raw_response || "", "", "#### Parsed", "", "```json", JSON.stringify(row.r2?.d3?.parsed || null, null, 2), "```", "");
    lines.push("### Evidence Signals", "", "```json", JSON.stringify(row.r2?.evidence_signals || null, null, 2), "```", "");
    lines.push("### D4 Cards", "", "#### Prompt", "", row.r2?.d4?.prompt || "", "", "#### Raw", "", row.r2?.d4?.raw_response || "", "", "#### Parsed", "", "```json", JSON.stringify(row.r2?.d4?.parsed || null, null, 2), "```", "");
    lines.push("### D5 Price", "", "#### Prompt", "", row.r2?.d5?.prompt || "", "", "#### Raw", "", row.r2?.d5?.raw_response || "", "", "#### Parsed", "", "```json", JSON.stringify(row.r2?.d5?.parsed || null, null, 2), "```", "");
    lines.push("### R2 Calculate", "", "```json", JSON.stringify(row.r2?.calculate || null, null, 2), "```", "");
  }
  fs.writeFileSync(paths.samples, lines.join("\n"), "utf8");
}

function writeMeta(paths, rows, args, materials) {
  const configFiles = [
    SPEC_PATH,
    INFO_SET_SPEC_PATH,
    INFO_SET_ASSERT_PATH,
    PERSONA_MAPS_SPEC_PATH,
    GENERATED_MAPS_PATH,
    CAPABILITY_PATH,
    COMPATIBILITY_PATH,
    TAG_MAP_PATH,
    DIMENSION_ANCHOR_PATH,
    GRID_PRIORS_PATH,
    ROUND1_MODEL_PATH,
    ROUND2_PARAMS_PATH,
    JINANG_PATH,
    V1_JSONL_PATH,
    ROUND2_FLOW_PATH,
    MULTIPLAYER_FLOW_PATH
  ].filter((filePath) => fs.existsSync(filePath));
  const stageAllowedNumbers = Object.fromEntries(
    Object.entries(STAGE_ALLOWED_NUMBERS).map(([stage, allowed]) => [stage, Array.from(allowed)])
  );
  const meta = {
    run_id: args.runId,
    generated_at: new Date().toISOString(),
    git_head: gitHead(),
    script_sha256: fileSha256(__filename),
    rows_total: rows.filter((row) => row.run_id === args.runId).length,
    latest_rows: latestRows(rows).length,
    ok_rows: latestRows(rows).filter((row) => row.status === "OK").length,
    money_scale: {
      PRICE_SCALE,
      MONEY_SCALE_CONTRACT
    },
    d3_device_note: "Dynamic persona summary generated from the actual selected grid via server/llm/personaGenerator.js; not directly comparable to fixed-report bench D3.",
    info_set_alignment: {
      spec_path: path.relative(ROOT, INFO_SET_SPEC_PATH),
      assert_module: path.relative(ROOT, INFO_SET_ASSERT_PATH),
      assert_enabled_for_stages: ["R1", "D3", "D4", "D5"],
      numeric_whitelist_by_stage: stageAllowedNumbers,
      forbidden_pattern_ids: FORBIDDEN_PATTERNS.map((item) => item.id),
      boundary_verification: {
        round2_individual_card_selection: {
          source: path.relative(ROOT, ROUND2_FLOW_PATH),
          finding: "Round2Flow Step2 personal card selection renders cards with showCost=false and has a NO cost numbers code comment; v2 D4 aligns to this individual/card-selection information set."
        },
        round2_team_merge_discussion: {
          source: path.relative(ROOT, ROUND2_FLOW_PATH),
          finding: "Later team merge/discussion UI can render exact cost/NRE fields; v2 deliberately does not expose them to the individual D4 persona prompt per CODEX_INFO_SET_ALIGNMENT v2."
        },
        target_gm_visibility: {
          source: path.relative(ROOT, ROUND2_FLOW_PATH),
          finding: "R2 target_gm recap is rendered inside display:none, so v2 D5 does not inject target_gm or target_gm_rule."
        },
        round1_results_visibility: {
          source: path.relative(ROOT, MULTIPLAYER_FLOW_PATH),
          finding: "R1 result UI exposes qualitative/summary settlement outputs, but v2 R2 prompts do not inject exact WTP, target_gm, or hidden multipliers."
        }
      },
      v1_leak_to_v2_handling: {
        d4_card_costs: "Removed from prompt; public card pool only includes cap_id/name/covers and tier options.",
        d4_budget_penalty_and_machine_rules: "Removed from prompt; only qualitative compatibility hints are rendered.",
        d5_wtp_and_target_gm: "Removed from prompt and output schema; D5 only sees price range and step.",
        jinang_exact_strengths: "Not injected into prompt; summary reports qualitative fit only.",
        settlement_parameters: "Retained only as internal engine/audit data after decisions; not visible to persona prompts."
      }
    },
    map_sha256: Object.fromEntries(materials.personas.map((persona) => [persona.label, persona.map_sha256])),
    config_sha256: Object.fromEntries(configFiles.map((filePath) => [path.relative(ROOT, filePath), fileSha256(filePath)])),
    assumptions: {
      single_member_team: true,
      condition: CONDITION,
      n_per_persona: 1,
      no_server_or_ui: true,
      target_gm_visibility: "target_gm is not carried into D5 prompt or output schema in v2; current rdCalculator.calculate still uses true WTP/cost parameters internally as settlement bookkeeping.",
      jinang_random_draw: args.reuseJinangFrom ? `market+tech draws reused from ${path.relative(ROOT, args.reuseJinangFrom)} when available.` : "market+tech drawn from production jinang_cards_v2 config in an independent DB-free script."
    }
  };
  fs.writeFileSync(paths.meta, JSON.stringify(meta, null, 2), "utf8");
  return meta;
}

function writeOutputs(paths, rows, args, materials) {
  const runRows = rows.filter((row) => row.run_id === args.runId);
  writeSummary(paths, runRows, materials);
  writeSamples(paths, runRows);
  return writeMeta(paths, runRows, args, materials);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const paths = outputPaths(args.runId);
  loadLocalEnv();
  const materials = loadMaterials();
  let rows = loadJsonl(paths.jsonl).filter((row) => row.run_id === args.runId);

  if (args.recoverCalculateOnly) {
    const latest = latestRows(rows);
    const recoverable = latest.filter((row) => row.status !== "OK" && row.r1_settlement && row.r2?.d5?.parsed && !row.r2?.calculate);
    console.log(`[full_game_all_personas] recover-calculate-only recoverable=${recoverable.length}`);
    for (const row of recoverable) {
      const recovered = JSON.parse(JSON.stringify(row));
      recovered.created_at = new Date().toISOString();
      recovered.recovered_from = {
        status: row.status,
        error: row.error,
        recovered_at: recovered.created_at,
        mode: "recover-calculate-only"
      };
      try {
        recovered.r2.calculate = await calculateR2(recovered, materials);
        recovered.status = "OK";
        recovered.error = "";
        assertFiniteOutput(recovered);
      } catch (error) {
        recovered.status = "FAIL";
        recovered.error = `recover_calculate: ${error.message || error}`;
      }
      appendJsonl(paths.jsonl, recovered);
      console.log(`[full_game_all_personas] recover ${recovered.persona_label} ${recovered.status} error=${recovered.error || ""}`);
    }
    rows = loadJsonl(paths.jsonl).filter((row) => row.run_id === args.runId);
  } else if (!args.summarizeOnly) {
    const { chatCompletion, hasAnyKey } = require("../../server/llm/deepseekClient");
    const { extractTags } = require("../../server/llm/tagExtractor");
    const { scoreTagsToDimensions } = require("../../server/llm/dimensionScorer");
    const vpWordScorer = require("../../server/llm/vpWordScorer");
    const vpCoach = require("../../server/llm/vpCoach");
    const personaGenerator = require("../../server/llm/personaGenerator");
    const embeddingService = require("../../server/llm/embeddingService");
    if (!hasAnyKey()) throw new Error("DeepSeek API key is required");
    await embeddingService.init();
    const runtime = { chatCompletion, extractTags, scoreTagsToDimensions, vpWordScorer, vpCoach, personaGenerator };
    const completed = new Set(latestRows(rows).filter((row) => row.status === "OK").map(chainKey));
    const reusedJinangDraws = loadJinangDrawsFromJsonl(args.reuseJinangFrom);
    const tasks = materials.personas.filter((persona) => !completed.has(`${persona.id}|${CONDITION}|1`));
    console.log(`[full_game_all_personas] existing=${rows.length} remaining=${tasks.length} concurrency=${args.concurrency} reused_jinang=${reusedJinangDraws.size}`);
    await runPool(tasks, args.concurrency, async (persona, index) => {
      const row = await runPlaythrough(runtime, persona, materials, args.runId, {
        condition: CONDITION,
        rep: 1,
        jinangDraw: reusedJinangDraws.get(persona.id) || undefined
      });
      appendJsonl(paths.jsonl, row);
      console.log(`[full_game_all_personas] ${index + 1}/${tasks.length} ${row.persona_label} ${row.status} calls=${JSON.stringify(row.calls)} error=${row.error || ""}`);
    });
    rows = loadJsonl(paths.jsonl).filter((row) => row.run_id === args.runId);
  }

  const meta = writeOutputs(paths, rows, args, materials);
  console.log(JSON.stringify({ paths, meta }, null, 2));
}

module.exports = {
  RUN_ID,
  CONDITION,
  PERSONA_ORDER,
  GRID_OPTIONS,
  loadMaterials,
  validateR1Choice,
  validateD3,
  validateD4,
  validateD5,
  buildQuestionDefinitionPrompt,
  neutralQuestionDescription,
  buildRound1Outcome,
  settleJinang,
  calculateR2,
  drawJinang,
  runPlaythrough
};

if (require.main === module) {
  main().catch((error) => {
    console.error(error.stack || error.message || String(error));
    process.exitCode = 1;
  });
}
