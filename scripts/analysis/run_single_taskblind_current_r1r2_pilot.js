#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const ROOT = path.resolve(__dirname, "../..");
const DEFAULT_POOL_PATH = path.join(
  ROOT,
  "data",
  "task_blind_persona_pipeline_v1",
  "r1_pool42_20260812",
  "persona_pool_task_blind_narrative_v1.json"
);
const DEFAULT_OUTPUT_ROOT = path.join(ROOT, "runs_v4flash_0731", "single_taskblind_current_r1r2");
const CLIENT_RENDER_MANIFEST_PATH = path.join(ROOT, "client", "render_manifest.json");
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
    personas: 12,
    offset: 0,
    concurrency: 10,
    batch: `single_taskblind_current_r1r2_${now}`,
    poolPath: DEFAULT_POOL_PATH,
    outputRoot: DEFAULT_OUTPUT_ROOT
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--personas") args.personas = Number(argv[++index]);
    else if (arg === "--offset") args.offset = Number(argv[++index]);
    else if (arg === "--concurrency") args.concurrency = Number(argv[++index]);
    else if (arg === "--batch") args.batch = String(argv[++index] || "").trim();
    else if (arg === "--pool-path") args.poolPath = path.resolve(ROOT, String(argv[++index] || "").trim());
    else if (arg === "--output-root") args.outputRoot = path.resolve(ROOT, String(argv[++index] || "").trim());
    else throw new Error(`unknown argument: ${arg}`);
  }
  if (!Number.isInteger(args.personas) || args.personas < 1) throw new Error("--personas must be a positive integer");
  if (!Number.isInteger(args.offset) || args.offset < 0) throw new Error("--offset must be a non-negative integer");
  if (!Number.isInteger(args.concurrency) || args.concurrency < 1) throw new Error("--concurrency must be a positive integer");
  if (!args.batch) throw new Error("--batch required");
  return args;
}

function readJson(filePath) {
  if (!fs.existsSync(filePath)) throw new Error(`missing file: ${filePath}`);
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  fs.renameSync(tmp, filePath);
}

function sha256(value) {
  return crypto.createHash("sha256").update(String(value || "")).digest("hex");
}

function hashInt(parts, modulo) {
  const hex = sha256(parts.join("|")).slice(0, 12);
  return Number.parseInt(hex, 16) % modulo;
}

function deterministicSingleDraw(jinangConfig, record, index) {
  const market = Array.isArray(jinangConfig.market) ? jinangConfig.market : [];
  const tech = Array.isArray(jinangConfig.tech) ? jinangConfig.tech : [];
  if (!market.length || !tech.length) throw new Error("jinang config must contain market and tech cards");
  const seed = record.seed || record.persona_id || String(index);
  return {
    market: market[hashInt(["taskblind-single", seed, "market"], market.length)],
    tech: tech[hashInt(["taskblind-single", seed, "tech"], tech.length)],
    method: "deterministic_single_task_blind_persona_draw_sha256"
  };
}

function surfaceLine(record) {
  const surface = record.surface || {};
  const gender = surface.gender === "female" ? "女" : surface.gender === "male" ? "男" : "未知";
  const overseas = surface.overseas?.hasOverseas
    ? `${surface.overseas.destination || "海外"}，${surface.overseas.duration || ""}`.replace(/，$/u, "")
    : "无";
  return [
    `姓名：${surface.name || record.persona_id}`,
    `性别：${gender}`,
    surface.age ? `年龄：${surface.age}岁` : "",
    surface.edu ? `学历：${surface.edu}` : "",
    surface.region ? `地域：${surface.region}` : "",
    `海外经历：${overseas}`
  ].filter(Boolean).join("；");
}

function buildPersona(record) {
  if (record?.schema !== "task_blind_narrative_v1") {
    throw new Error(`expected task_blind_narrative_v1, got ${record?.schema || "(missing schema)"}`);
  }
  if (!String(record.biography || "").trim()) throw new Error(`missing biography for ${record.persona_id}`);
  return {
    id: record.persona_id,
    label: record.surface?.name || record.persona_id,
    desc: [
      "你是一个中欧高管项目里的具体学员，不是 A-G 原型。",
      surfaceLine(record),
      "【人物小传】",
      record.biography,
      "【扮演规则】",
      "你现在就是小传中的这个人。像本人临场一样看界面、作选择和写备注。",
      "不要复述或分析小传；人物小传没覆盖的地方，就按这个人当下会有的直觉、犹豫或误解处理。"
    ].join("\n"),
    profile: {
      surface: record.surface,
      task_blind_biography: record.biography,
      behavioral_fingerprint: record.behavioral_fingerprint
    },
    no_cognitive_map: true,
    map_sha256: sha256(record.biography),
    task_blind_biography: record.biography,
    persona_pool_record: record,
    synthetic: true
  };
}

function numberValue(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : NaN;
}

function mean(values) {
  const arr = values.filter(Number.isFinite);
  return arr.length ? arr.reduce((sum, value) => sum + value, 0) / arr.length : null;
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
  const fraction = pct > 1 ? pct / 100 : pct;
  const index = Math.floor((sorted.length - 1) * fraction);
  return sorted[Math.max(0, Math.min(sorted.length - 1, index))];
}

function countBy(values) {
  const out = {};
  for (const value of values) {
    const key = String(value || "");
    if (!key) continue;
    out[key] = (out[key] || 0) + 1;
  }
  return Object.fromEntries(Object.entries(out).sort((a, b) => a[0].localeCompare(b[0])));
}

function summarizeRows(rows) {
  const ok = rows.filter((row) => row.status === "OK");
  const prices = ok.map((row) => numberValue(row.r2?.d5?.parsed?.aligned_price ?? row.r2?.d5?.parsed?.price));
  const profits = ok.map((row) => numberValue(row.r2?.calculate?.metrics?.profit ?? row.r2?.calculate?.output?.profit));
  const cardCounts = ok.map((row) => Array.isArray(row.r2?.d4?.parsed?.cards) ? row.r2.d4.parsed.cards.length : NaN);
  const gridIds = ok.map((row) => row.r1_choice?.parsed?.grid_id);
  const strategies = gridIds.map((gridId) => String(gridId || "").includes("_COST_") ? "COST" : String(gridId || "").includes("_DIFF_") ? "DIFF" : "");
  const customers = gridIds.map((gridId) => String(gridId || "").startsWith("ToB") ? "ToB" : String(gridId || "").startsWith("ToC") ? "ToC" : "");
  const ages = gridIds.map((gridId) => {
    const match = String(gridId || "").match(/_(CHILD|ADULT|ELDER)$/u);
    return match ? match[1] : "";
  });
  const losses = profits.filter((value) => Number.isFinite(value) && value < 0).length;
  return {
    chains_total: rows.length,
    chains_ok: ok.length,
    chains_failed: rows.length - ok.length,
    loss_count: losses,
    loss_rate: ok.length ? losses / ok.length : null,
    price_min: prices.length ? Math.min(...prices.filter(Number.isFinite)) : null,
    price_p25: percentile(prices, 25),
    price_p50: percentile(prices, 50),
    price_p75: percentile(prices, 75),
    price_max: prices.length ? Math.max(...prices.filter(Number.isFinite)) : null,
    price_sd: sd(prices),
    profit_p25: percentile(profits, 25),
    profit_p50: percentile(profits, 50),
    profit_p75: percentile(profits, 75),
    profit_sd: sd(profits),
    card_count_p50: percentile(cardCounts, 50),
    card_count_sd: sd(cardCounts),
    grid_distribution: countBy(gridIds),
    customer_distribution: countBy(customers),
    strategy_distribution: countBy(strategies),
    age_distribution: countBy(ages),
    architecture_distribution: countBy(ok.map((row) => row.r1_choice?.parsed?.architecture)),
    price_distribution: countBy(prices.filter(Number.isFinite))
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
  if (!materials.renderManifest || typeof materials.renderManifest !== "object" || !Object.keys(materials.renderManifest).length) {
    throw new Error(`required infoSetManifest failed to load from ${CLIENT_RENDER_MANIFEST_PATH}`);
  }

  const poolAll = readJson(args.poolPath);
  if (!Array.isArray(poolAll)) throw new Error(`pool must be an array: ${args.poolPath}`);
  const pool = poolAll.slice(args.offset, args.offset + args.personas);
  if (pool.length !== args.personas) throw new Error(`requested ${args.personas} personas from offset ${args.offset}, got ${pool.length}`);

  const outputDir = path.join(args.outputRoot, args.batch);
  const chainsDir = path.join(outputDir, "chains");
  fs.mkdirSync(chainsDir, { recursive: true });

  const runtime = {
    chatCompletion: deepseek.chatCompletion,
    extractTags,
    scoreTagsToDimensions,
    vpWordScorer,
    vpCoach,
    personaGenerator
  };
  const tasks = pool.map((record, index) => ({
    record,
    persona: buildPersona(record),
    draw: deterministicSingleDraw(materials.jinangConfig, record, args.offset + index)
  }));
  const { default: pLimit } = await import("p-limit");
  const limit = pLimit(args.concurrency);
  const startedAt = new Date().toISOString();
  const startedMs = Date.now();
  const rows = [];

  await Promise.all(tasks.map((task, index) => limit(async () => {
    console.error(`[single-taskblind] start ${index + 1}/${tasks.length} persona=${task.record.persona_id}`);
    const row = await FullGame.runPlaythrough(runtime, task.persona, materials, args.batch, {
      condition: CONDITION,
      rep: REP,
      jinangDraw: task.draw,
      questionDefinition: false,
      infoSetManifest: materials.renderManifest,
      promptMode: "interface"
    });
    row.arm_id = "single_taskblind_current_r1r2";
    row.persona_pool_record = task.record;
    row.formal_contract = {
      mode: "single_taskblind_current_r1r2",
      prompt_mode: "interface",
      condition: CONDITION,
      q_s_enabled: false,
      persona_pool_source: path.relative(ROOT, args.poolPath),
      provider: modelRegistry.getProvider(),
      model: modelRegistry.getModel("chat_service"),
      disable_thinking: true,
      draw_method: task.draw.method
    };
    rows.push(row);
    writeJson(path.join(chainsDir, `${task.record.persona_id}_${CONDITION}${REP}.json`), row);
    console.error(`[single-taskblind] done persona=${task.record.persona_id} status=${row.status} grid=${row.r1_choice?.parsed?.grid_id || ""} price=${row.r2?.d5?.parsed?.aligned_price ?? ""} profit=${Math.round(Number(row.r2?.calculate?.metrics?.profit ?? NaN))}`);
  })));

  rows.sort((a, b) => String(a.persona_id).localeCompare(String(b.persona_id)));
  const finishedAt = new Date().toISOString();
  const summary = {
    run_id: args.batch,
    mode: "single_taskblind_current_r1r2",
    output_dir: path.relative(ROOT, outputDir),
    provider: modelRegistry.getProvider(),
    model: modelRegistry.getModel("chat_service"),
    base_url_host: new URL(modelRegistry.getBaseUrl()).host,
    disable_thinking: true,
    prompt_mode: "interface",
    condition: CONDITION,
    q_s_enabled: false,
    personas_requested: args.personas,
    personas_offset: args.offset,
    concurrency: args.concurrency,
    pool_path: path.relative(ROOT, args.poolPath),
    selected_persona_ids: pool.map((record) => record.persona_id),
    started_at: startedAt,
    finished_at: finishedAt,
    wall_clock_ms: Date.now() - startedMs,
    summary: summarizeRows(rows),
    failures: rows
      .filter((row) => row.status !== "OK")
      .map((row) => ({ persona_id: row.persona_id, error: row.error }))
  };
  writeJson(path.join(outputDir, "rows.json"), rows);
  writeJson(path.join(outputDir, "summary.json"), summary);
  console.log(JSON.stringify(summary, null, 2));
  if (summary.failures.length > 0) process.exitCode = 1;
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.stack || error.message || String(error));
    process.exit(1);
  });
}
