#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const ROOT = path.resolve(__dirname, "../..");
const DEFAULT_POOL_PATH = path.join(ROOT, "data", "persona_pool_random42_interface_v1", "persona_pool_v2.json");
const DEFAULT_OUTPUT_ROOT = path.join(ROOT, "runs_v4flash_0731", "single_ui_parity_pilot");
const CLIENT_RENDER_MANIFEST_PATH = path.join(ROOT, "client", "render_manifest.json");
const LAYERED_GENERATION_SEED = 20260806;
const CONDITION = "S";
const REP = 1;

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
    personas: 10,
    concurrency: 10,
    batch: `single_simple_layered_ui_parity_${now}`,
    poolPath: DEFAULT_POOL_PATH,
    outputRoot: DEFAULT_OUTPUT_ROOT
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--arms") args.arms = String(argv[++index] || "").split(",").map((item) => item.trim()).filter(Boolean);
    else if (arg === "--personas") args.personas = Number(argv[++index]);
    else if (arg === "--concurrency") args.concurrency = Number(argv[++index]);
    else if (arg === "--batch") args.batch = String(argv[++index] || "").trim();
    else if (arg === "--pool-path") args.poolPath = path.resolve(ROOT, String(argv[++index] || "").trim());
    else if (arg === "--output-root") args.outputRoot = path.resolve(ROOT, String(argv[++index] || "").trim());
    else throw new Error(`unknown argument: ${arg}`);
  }
  if (!args.arms.length || args.arms.some((arm) => !["simple", "layered"].includes(arm))) {
    throw new Error("--arms must contain simple and/or layered");
  }
  if (!Number.isInteger(args.personas) || args.personas < 1) throw new Error("--personas must be a positive integer");
  if (!Number.isInteger(args.concurrency) || args.concurrency < 1) throw new Error("--concurrency must be a positive integer");
  if (!args.batch) throw new Error("--batch required");
  return args;
}

function sha256(value) {
  return crypto.createHash("sha256").update(String(value)).digest("hex");
}

function readJson(filePath) {
  if (!fs.existsSync(filePath)) throw new Error(`missing file: ${filePath}`);
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function surfaceSentence(record) {
  const surface = record.surface || {};
  const gender = surface.gender === "female" ? "女" : "男";
  const overseas = surface.overseas?.hasOverseas
    ? `${surface.overseas.destination}，${surface.overseas.duration}`
    : "无海外经历";
  return [
    `染色身份：${surface.name}，${gender}，${surface.age}岁`,
    `学历${surface.edu}`,
    `海外经历${overseas}`,
    `MBTI ${surface.mbti}`,
    `表达风格：${surface.expression_style}`
  ].join("；");
}

function seededPick(items, seedText) {
  const list = Array.isArray(items) ? items : [];
  if (!list.length) return "";
  const digest = crypto.createHash("sha256").update(String(seedText)).digest("hex");
  const index = parseInt(digest.slice(0, 8), 16) % list.length;
  return list[index];
}

function genderTweak(profile, gender, key) {
  if (gender !== "female") return "";
  return String(profile?.genderModifiers?.female?.[key] || "").trim();
}

function educationBand(education) {
  const value = String(education || "");
  if (/博士|MBA|海归硕士|海外硕士|985|211/.test(value)) return "high";
  if (/本科|硕士/.test(value)) return "medium";
  if (/高中|中专|大专/.test(value)) return "low";
  return "medium";
}

function sanitizeLayeredPromptText(text) {
  return String(text || "")
    .replace(/[0-9０-９]+\s*[-~—–]\s*[0-9０-９]+\s*(?:年|个月|岁|万元|万|亿|DAU|页|个|家|轮|次|条|%)/gi, "若干")
    .replace(/[0-9０-９]+\s*(?:年|个月|岁|万元|万|亿|DAU|页|个|家|轮|次|条|%)/gi, "若干")
    .replace(/[0-9０-９]+/g, "若干");
}

function buildSimplePersona(basePersona, poolRecord) {
  return {
    ...basePersona,
    id: poolRecord.persona_id,
    label: basePersona.label,
    desc: `${basePersona.desc}\n【你的人生经验】\n${surfaceSentence(poolRecord)}`,
    profile: {
      ...(basePersona.profile || {}),
      surface: poolRecord.surface,
      synthetic: true
    },
    archetype: poolRecord.archetype,
    surface: poolRecord.surface,
    synthetic: true,
    persona_pool_record: poolRecord
  };
}

function buildLayeredStudent(basePersona, poolRecord) {
  const { deriveExpressionModifier } = require("../sim/persona_pool");
  const profile = basePersona.profile || {};
  const surface = poolRecord.surface || {};
  const expressionStyle = String(surface.expression_style || profile.expressionStyle || "");
  const interviewTweak = genderTweak(profile, surface.gender, "interviewTweak");
  return {
    ...profile,
    id: poolRecord.persona_id,
    personaId: poolRecord.persona_id,
    label: basePersona.label,
    name: String(surface.name || poolRecord.persona_id),
    gender: surface.gender || "male",
    age: Number(surface.age || 0) || "",
    education: String(surface.edu || profile.education || ""),
    overseas: surface.overseas || { hasOverseas: false, destination: "", duration: "" },
    mbti: String(surface.mbti || ""),
    expressionStyle,
    expressionModifier: deriveExpressionModifier(surface.edu || profile.education || ""),
    fullExpressionStyle: expressionStyle,
    role: String(profile.role || ""),
    background: String(profile.background || basePersona.desc || ""),
    industry: String(profile.industry || ""),
    decisionStyle: String(profile.decisionStyle || ""),
    riskPreference: String(profile.riskPreference || ""),
    blindSpots: String(profile.blindSpots || basePersona.core_blind_spot || ""),
    interviewStyle: String(profile.interviewStyle || ""),
    interviewStyleFull: [String(profile.interviewStyle || ""), interviewTweak].filter(Boolean).join("。"),
    pricingBias: String(profile.pricingBias || ""),
    vpQuirks: String(profile.vpQuirks || "")
  };
}

function buildLayeredSeedMemory(student, poolRecord) {
  const baseSeed = `${LAYERED_GENERATION_SEED}:L0:${poolRecord.persona_id}`;
  return {
    backstory: `${student.background || student.role || "有多年行业经验"}；现在以${student.role || "企业管理者"}身份来读 EMBA，希望把自己的经验迁移到 AI 宠物机器人这类新业务。`,
    decision_habit: `${student.decisionStyle || "先凭经验判断，再看数据验证。"}遇到不确定时，会先回到自己熟悉的行业和组织经验里找类比。`,
    discussion_style: `${student.fullExpressionStyle || student.expressionStyle || "讨论时会带着明显个人风格。"}课堂讨论中${seededPick(["会先抛观点再补理由", "会先听一轮再抓关键点回应", "会把问题拉回落地和资源约束", "会用自己熟悉的案例解释判断"], `${baseSeed}:discussion`)}。`,
    confidence_zone: `${student.industry || "自己熟悉的行业"}、渠道打法、组织资源和真实客户场景里的判断最有把握。`,
    blind_zone: `${student.blindSpots || "对陌生领域容易忽略或回避。"}在 AI 机器人、能力卡组合和用户研究细节上容易带入既有经验。`,
    under_pressure: seededPick([
      "时间紧时会先做一个能讲得通的选择，再把细节留到后面修。",
      "时间紧时会把问题简化成资源、客户和回款三件事。",
      "时间紧时会优先选择自己能解释清楚、能管得住风险的方案。",
      "时间紧时会抓一个最像既有业务的路径，避免过度发散。"
    ], `${baseSeed}:pressure`),
    pet_phrases: seededPick([
      "先把这个事落到具体人群上。",
      "不能光听着高级，要能卖得出去。",
      "这个逻辑要闭环。",
      "我先按自己的经验判断。"
    ], `${baseSeed}:phrase`)
  };
}

function buildLayeredClassroomProfile(student, seedMemory, poolRecord) {
  const baseSeed = `${LAYERED_GENERATION_SEED}:L1:${poolRecord.persona_id}`;
  const band = educationBand(student.education);
  return {
    abstraction_ability: band === "high" ? "high" : band === "low" ? "low" : "medium",
    writing_precision: band === "low" ? "low" : seededPick(["medium", "high"], `${baseSeed}:writing`),
    coach_receptiveness: seededPick(["medium", "medium", "high", "low"], `${baseSeed}:coach`),
    effort_style: seededPick(["认真打磨", "先交差后面改", "先交差后面改", "依赖队友"], `${baseSeed}:effort`),
    team_role: seededPick(["主导", "质疑", "跟随", "调停"], `${baseSeed}:role`),
    why_here: `希望把${student.industry || "既有行业"}经验系统化，并借课堂判断 AI 宠物机器人是否能形成新增长点。`,
    knowledge_ceiling: seedMemory.blind_zone || "在陌生领域的市场定位与用户研究容易停留在直觉层面。",
    response_to_AI_coach: seededPick([
      "会先看建议是否实用，能落地就采纳，太虚就保留意见。",
      "会接受能帮他收敛目标用户和能力配置的反馈，但会抵触纯框架化表达。",
      "会把 AI Coach 当成提醒清单，最终仍按自己的行业经验拍板。",
      "会认真吸收结构化建议，但会要求它解释清楚为什么能赚钱。"
    ], `${baseSeed}:ai_coach`)
  };
}

function buildLayeredPersona(basePersona, poolRecord) {
  const { PersonaStudent } = require("../sim/persona_student");
  const student = buildLayeredStudent(basePersona, poolRecord);
  const seedMemory = buildLayeredSeedMemory(student, poolRecord);
  const classroomProfile = buildLayeredClassroomProfile(student, seedMemory, poolRecord);
  const actor = new PersonaStudent({ student, seedMemory, classroomProfile });
  const systemPrompt = sanitizeLayeredPromptText(actor.buildLayeredSystemPrompt({ includeVpLengthConstraint: false }));
  const layered = {
    seed: LAYERED_GENERATION_SEED,
    l0_seed: `${LAYERED_GENERATION_SEED}:L0:${poolRecord.persona_id}`,
    l1_seed: `${LAYERED_GENERATION_SEED}:L1:${poolRecord.persona_id}`,
    generator_module: "scripts/sim/persona_student.js",
    generator_entrypoint: "PersonaStudent.buildLayeredSystemPrompt",
    generation_method: "deterministic_seeded_L0_L1_from_frozen_persona_pool_surface",
    student,
    seed_memory: seedMemory,
    classroom_profile: classroomProfile,
    system_prompt_sha256: sha256(systemPrompt)
  };
  return {
    ...basePersona,
    id: poolRecord.persona_id,
    label: basePersona.label,
    desc: [
      basePersona.desc,
      "【你的人生经验】",
      surfaceSentence(poolRecord),
      "【你的做事习惯】",
      systemPrompt
    ].join("\n"),
    profile: {
      ...(basePersona.profile || {}),
      surface: poolRecord.surface,
      synthetic: true,
      layered
    },
    archetype: poolRecord.archetype,
    surface: poolRecord.surface,
    synthetic: true,
    persona_pool_record: poolRecord,
    layered_system_prompt: systemPrompt,
    layered_seed_memory: seedMemory,
    layered_classroom_profile: classroomProfile
  };
}

function buildPersonaForArm(basePersona, poolRecord, arm) {
  if (arm === "simple") return buildSimplePersona(basePersona, poolRecord);
  if (arm === "layered") return buildLayeredPersona(basePersona, poolRecord);
  throw new Error(`unsupported arm: ${arm}`);
}

function numberValue(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : NaN;
}

function mean(values) {
  const arr = values.filter(Number.isFinite);
  if (!arr.length) return null;
  return arr.reduce((sum, value) => sum + value, 0) / arr.length;
}

function sd(values) {
  const arr = values.filter(Number.isFinite);
  if (arr.length < 2) return 0;
  const avg = mean(arr);
  return Math.sqrt(arr.reduce((sum, value) => sum + Math.pow(value - avg, 2), 0) / (arr.length - 1));
}

function percentile(values, pct) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const index = Math.ceil((pct / 100) * sorted.length) - 1;
  return sorted[Math.max(0, Math.min(sorted.length - 1, index))];
}

function summarizeRows(rows, arm) {
  const subset = rows.filter((row) => row.arm_id === arm);
  const ok = subset.filter((row) => row.status === "OK");
  const profits = ok.map((row) => numberValue(row.r2?.calculate?.output?.profit ?? row.r2?.calculate?.metrics?.profit));
  const prices = ok.map((row) => numberValue(row.r2?.d5?.parsed?.aligned_price ?? row.r2?.d5?.parsed?.price));
  const cardCounts = ok.map((row) => Array.isArray(row.r2?.d4?.parsed?.cards) ? row.r2.d4.parsed.cards.length : NaN);
  const losses = profits.filter((value) => Number.isFinite(value) && value < 0).length;
  return {
    arm,
    chains_expected: subset.length,
    chains_ok: ok.length,
    chains_failed: subset.length - ok.length,
    loss_count: losses,
    loss_rate: ok.length ? losses / ok.length : null,
    profit_p50: percentile(profits, 50),
    profit_sd: sd(profits),
    price_p50: percentile(prices, 50),
    price_sd: sd(prices),
    card_count_p50: percentile(cardCounts, 50)
  };
}

async function main() {
  loadLocalEnv();
  process.env.LLM_PROVIDER = "deepseek";
  process.env.DEEPSEEK_DISABLE_THINKING = "1";
  process.env.LLM_DISABLE_THINKING = "1";

  const args = parseArgs(process.argv.slice(2));
  const modelRegistry = require("../../server/llm/modelRegistry");
  const deepseek = require("../../server/llm/deepseekClient");
  if (modelRegistry.getProvider() !== "deepseek") throw new Error(`LLM_PROVIDER must resolve to deepseek, got ${modelRegistry.getProvider()}`);
  if (!deepseek.hasAnyKey()) throw new Error("missing DEEPSEEK_API_KEY");
  if (!fs.existsSync(args.poolPath)) throw new Error(`missing pool path: ${args.poolPath}`);

  const FullGame = require("./full_game_all_personas");
  const { extractTags } = require("../../server/llm/tagExtractor");
  const { scoreTagsToDimensions } = require("../../server/llm/dimensionScorer");
  const vpWordScorer = require("../../server/llm/vpWordScorer");
  const vpCoach = require("../../server/llm/vpCoach");
  const personaGenerator = require("../../server/llm/personaGenerator");
  const embeddingService = require("../../server/llm/embeddingService");
  await embeddingService.init();

  const materials = FullGame.loadMaterials();
  materials.renderManifest = readJson(CLIENT_RENDER_MANIFEST_PATH);
  const pool = readJson(args.poolPath).slice(0, args.personas);
  const outputDir = path.join(args.outputRoot, args.batch);
  const chainsDir = path.join(outputDir, "chains");
  fs.mkdirSync(chainsDir, { recursive: true });

  const baseByArchetype = new Map(materials.personas.map((persona) => [persona.id, persona]));
  const tasks = [];
  for (const arm of args.arms) {
    for (const record of pool) {
      const base = baseByArchetype.get(record.archetype);
      if (!base) throw new Error(`missing base archetype materials for ${record.archetype}`);
      tasks.push({
        arm,
        record,
        persona: buildPersonaForArm(base, record, arm),
        runId: `${args.batch}_${arm}`
      });
    }
  }

  const runtime = {
    chatCompletion: deepseek.chatCompletion,
    extractTags,
    scoreTagsToDimensions,
    vpWordScorer,
    vpCoach,
    personaGenerator
  };
  const { default: pLimit } = await import("p-limit");
  const limit = pLimit(args.concurrency);
  const startedAt = new Date().toISOString();
  const rows = [];
  await Promise.all(tasks.map((task, index) => limit(async () => {
    console.error(`[single-ui-parity] start ${index + 1}/${tasks.length} arm=${task.arm} persona=${task.record.persona_id}`);
    const row = await FullGame.runPlaythrough(runtime, task.persona, materials, task.runId, {
      condition: CONDITION,
      rep: REP,
      jinangDraw: task.record.jinang_draw,
      questionDefinition: false,
      infoSetManifest: materials.renderManifest,
      promptMode: "interface"
    });
    row.arm_id = task.arm;
    row.synthetic = true;
    row.persona_pool_record = task.record;
    row.persona_injection_mode = task.arm;
    row.formal_contract = {
      mode: "single_ui_parity_pilot",
      prompt_mode: "interface",
      condition: CONDITION,
      q_s_enabled: false,
      persona_pool_source: path.relative(ROOT, args.poolPath),
      persona_pool_seed: task.record.seed || null,
      provider: modelRegistry.getProvider(),
      model: modelRegistry.getModel("chat_service"),
      disable_thinking: true
    };
    rows.push(row);
    writeJson(path.join(chainsDir, `${task.arm}_${task.record.persona_id}.json`), row);
    console.error(`[single-ui-parity] done arm=${task.arm} persona=${task.record.persona_id} status=${row.status} price=${row.r2?.d5?.parsed?.aligned_price ?? ""} profit=${row.r2?.calculate?.output?.profit ?? ""}`);
  })));
  const finishedAt = new Date().toISOString();
  rows.sort((a, b) => `${a.arm_id}:${a.persona_id}`.localeCompare(`${b.arm_id}:${b.persona_id}`));
  const summary = {
    run_id: args.batch,
    mode: "single_ui_parity_pilot",
    output_dir: path.relative(ROOT, outputDir),
    provider: modelRegistry.getProvider(),
    model: modelRegistry.getModel("chat_service"),
    base_url_host: new URL(modelRegistry.getBaseUrl()).host,
    disable_thinking: true,
    prompt_mode: "interface",
    condition: CONDITION,
    q_s_enabled: false,
    arms: args.arms,
    personas_per_arm: args.personas,
    concurrency: args.concurrency,
    pool_path: path.relative(ROOT, args.poolPath),
    selected_persona_ids: pool.map((record) => record.persona_id),
    started_at: startedAt,
    finished_at: finishedAt,
    wall_clock_ms: new Date(finishedAt).getTime() - new Date(startedAt).getTime(),
    by_arm: Object.fromEntries(args.arms.map((arm) => [arm, summarizeRows(rows, arm)]))
  };
  writeJson(path.join(outputDir, "summary.json"), summary);
  writeJson(path.join(outputDir, "rows.json"), rows);
  console.log(JSON.stringify(summary, null, 2));
  if (rows.some((row) => row.status !== "OK")) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error.stack || error.message || String(error));
  process.exit(1);
});
