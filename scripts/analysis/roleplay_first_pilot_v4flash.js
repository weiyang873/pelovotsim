"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { AsyncLocalStorage } = require("node:async_hooks");

const ROOT = path.join(__dirname, "..", "..");
const DEFAULT_POOL_PATH = path.join(ROOT, "data", "persona_pool_random42_interface_v1", "persona_pool_v2.json");
const DEFAULT_OUT_DIR = path.join(ROOT, "runs_v4flash_0731", "roleplay_first_pilot");
const RUN_ID = "v4flash_0731_roleplay_first_pilot";
const TEMPERATURE_ROLEPLAY = 1.0;
const TEMPERATURE_INDEXER = 0;
const PERSONA_SURFACE_SOURCE = "persona_surface";

const roleplayStore = new AsyncLocalStorage();

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
  const args = {
    poolPath: DEFAULT_POOL_PATH,
    outDir: DEFAULT_OUT_DIR,
    limit: 12,
    concurrency: 2,
    condition: "S",
    offset: 0
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--pool") args.poolPath = path.resolve(ROOT, String(argv[++index] || "").trim());
    else if (arg === "--out-dir") args.outDir = path.resolve(ROOT, String(argv[++index] || "").trim());
    else if (arg === "--limit") args.limit = Number(argv[++index]);
    else if (arg === "--offset") args.offset = Number(argv[++index]);
    else if (arg === "--concurrency") args.concurrency = Number(argv[++index]);
    else if (arg === "--condition") args.condition = String(argv[++index] || "").trim().toUpperCase();
    else throw new Error(`unknown argument: ${arg}`);
  }
  if (!Number.isInteger(args.limit) || args.limit < 1) throw new Error("--limit must be a positive integer");
  if (!Number.isInteger(args.offset) || args.offset < 0) throw new Error("--offset must be a non-negative integer");
  if (!Number.isInteger(args.concurrency) || args.concurrency < 1) throw new Error("--concurrency must be a positive integer");
  if (!["Q", "S"].includes(args.condition)) throw new Error("--condition must be Q or S");
  return args;
}

function sha256(value) {
  return crypto.createHash("sha256").update(String(value || "")).digest("hex");
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  fs.renameSync(tmp, filePath);
}

function appendJsonl(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.appendFileSync(filePath, `${JSON.stringify(value)}\n`, "utf8");
}

function loadJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function surfaceSentence(poolRecord) {
  const surface = poolRecord.surface || {};
  const overseas = surface.overseas?.hasOverseas
    ? `${surface.overseas.destination || "海外"}，${surface.overseas.duration || "若干时间"}`
    : "无明显海外经历";
  return [
    `染色身份：${surface.name || poolRecord.persona_id}`,
    surface.gender === "female" ? "女" : "男",
    `${surface.age || "未知"}岁`,
    `学历${surface.edu || "未知"}`,
    `海外经历${overseas}`,
    `MBTI ${surface.mbti || "未知"}`,
    `表达风格：${surface.expression_style || "自然表达"}`
  ].join("；");
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

function detectDecisionStage(prompt) {
  const text = String(prompt || "");
  if (!text.includes("输出 JSON")) return "";
  if (text.includes("【界面：选择你的战略定位】")) return "R1";
  if (text.includes("【界面：客户调研报告】")) return "D3";
  if (text.includes("【界面：个人选卡】")) return "D4";
  if (text.includes("【界面：定价决策】")) return "D5";
  return "";
}

function stripJsonContract(prompt) {
  const stopMarkers = [
    "【提交字段】",
    "输出 JSON：",
    "只输出可 JSON.parse",
    "cost_stance 和 updated_constraints",
    "basis 和 reasoning"
  ];
  const lines = String(prompt || "").split(/\r?\n/);
  const kept = [];
  for (const line of lines) {
    if (stopMarkers.some((marker) => line.includes(marker))) break;
    kept.push(line);
  }
  return kept.join("\n").trim();
}

function roleplayInstruction(stage) {
  if (stage === "R1") {
    return [
      "你现在只是在界面上做个人初选。像真实学生一样边看边决定。",
      "自然说出你最后点击了哪个市场格子、选了哪个产品定位按钮，以及一句话 VP 草稿大概怎么填。",
      "可以犹豫、改口、说担心点；最后一句要清楚落到最终提交动作。"
    ].join("\n");
  }
  if (stage === "D3") {
    return [
      "你现在读完客户调研报告，在界面摘记一到三条关键信息。",
      "自然说出哪些句子打动你、你怎么判断市场，以及下一步会记住什么。",
      "不要像研究员归纳标签，像学生在填摘记框。"
    ].join("\n");
  }
  if (stage === "D4") {
    return [
      "你现在在个人选卡界面逐格点选能力卡。",
      "必须按六个功能区分别说：感知与理解、运动与导航、交互与表达、安全与信任、可扩展与连接、可运营与可维护。",
      "每个功能区至少说出最终留下的卡和档位；可以先想选高档又退到中档，也可以说某张删掉。",
      "最后一句总结你提交了哪些卡。不要输出表格或 JSON。"
    ].join("\n");
  }
  if (stage === "D5") {
    return [
      "你现在拖动定价滑块并提交最终价格。",
      "自然说出你为什么舍不得太低或不敢太高；可以出现矛盾心理。",
      "最后一句必须清楚说出最终提交的一个价格数字。不要输出 JSON。"
    ].join("\n");
  }
  return "自然完成这一步界面操作。";
}

function buildRoleplayPrompt(stage, originalPrompt) {
  return [
    "你是一名 EMBA 课堂模拟里的参与者，不是研究助理，也不是优化器。",
    "下面是你此刻看到的界面和前面已经提交过的内容。",
    "请只用第一人称自然话完成这一步界面操作。不要输出 JSON、字段名、schema、Markdown。",
    "人的犹豫可以出现：你可以说“我本来想……但又觉得……所以最后……”。",
    "",
    `【这一步】${stage}`,
    roleplayInstruction(stage),
    "",
    "【界面上下文】",
    stripJsonContract(originalPrompt)
  ].join("\n");
}

function indexerSchema(stage) {
  if (stage === "R1") {
    return `{
  "grid_id": "ToC_DIFF_CHILD|ToC_COST_CHILD|ToB_DIFF_CHILD|ToB_COST_CHILD|ToC_DIFF_ADULT|ToC_COST_ADULT|ToB_DIFF_ADULT|ToB_COST_ADULT|ToC_DIFF_ELDER|ToC_COST_ELDER|ToB_DIFF_ELDER|ToB_COST_ELDER",
  "architecture": "Experience|Hybrid|Function",
  "vp_draft": { "who": "...", "pain": "...", "how": "..." },
  "choice_reason": "一句最直接的选择备注",
  "evidence_sources": ["${PERSONA_SURFACE_SOURCE}"],
  "updated_constraints": [{ "text": "下一步要记住的一条界面备注", "source": "${PERSONA_SURFACE_SOURCE}" }]
}`;
  }
  if (stage === "D3") {
    return `{
  "key_evidence": ["summary中的具体证据，1到3条"],
  "market_judgment": "一句市场判断",
  "evidence_themes": ["主题词"],
  "updated_constraints": [{ "text": "下一步要记住的一条界面备注", "source": "${PERSONA_SURFACE_SOURCE}" }]
}`;
  }
  if (stage === "D4") {
    return `{
  "cards": [{ "id": "<真实cap_id>", "tier": "low|mid|high" }],
  "cost_stance": { "text": "一句选卡取舍备注", "source": "${PERSONA_SURFACE_SOURCE}" },
  "updated_constraints": [{ "text": "下一步要记住的一条界面备注", "source": "${PERSONA_SURFACE_SOURCE}" }]
}`;
  }
  if (stage === "D5") {
    return `{
  "price": "<最终价格数字>",
  "basis": { "text": "一句定价备注", "source": "${PERSONA_SURFACE_SOURCE}" },
  "reasoning": "一句自然说明"
}`;
  }
  throw new Error(`unsupported stage for indexing: ${stage}`);
}

function buildIndexerPrompt(stage, originalPrompt, roleplayRaw) {
  return [
    "你是事后编码员，只把学生自然话转成结构化记录。",
    "不要替学生优化选择，不要补商业分析，不要把犹豫改写成果断理由。",
    "如果学生有犹豫或改口，只记录最后明确提交的动作。",
    "如果某个必需字段没有完全明说，做最小必要补全以通过界面校验，并让备注保持接近原话。",
    "只输出可 JSON.parse 的 JSON，不要 Markdown，不要额外文字。",
    "",
    `【目标步骤】${stage}`,
    "",
    "【原界面上下文；含合法选项】",
    stripJsonContract(originalPrompt),
    "",
    "【学生自然话原文】",
    roleplayRaw,
    "",
    "【输出 JSON schema】",
    indexerSchema(stage)
  ].join("\n");
}

function roleplayMaxTokens(stage) {
  if (stage === "D4") return 1800;
  if (stage === "R1") return 900;
  return 700;
}

function indexerMaxTokens(stage) {
  if (stage === "D4") return 1800;
  if (stage === "R1" || stage === "D3") return 900;
  return 500;
}

function createRoleplayFirstChatCompletion(baseChatCompletion, roleplayLogPath) {
  return async function roleplayFirstChatCompletion(messages, options = {}) {
    const originalPrompt = Array.isArray(messages) && messages.length === 1
      ? String(messages[0]?.content || "")
      : "";
    const stage = detectDecisionStage(originalPrompt);
    if (!stage) return baseChatCompletion(messages, options);

    const store = roleplayStore.getStore() || {};
    const roleplayPrompt = buildRoleplayPrompt(stage, originalPrompt);
    const roleplayStartedAt = new Date().toISOString();
    const roleplayRaw = String(await baseChatCompletion([
      { role: "user", content: roleplayPrompt }
    ], {
      ...options,
      role: "chat_service",
      temperature: TEMPERATURE_ROLEPLAY,
      max_tokens: roleplayMaxTokens(stage),
      maxRetries: 1
    })).trim();
    const roleplayEndedAt = new Date().toISOString();

    const indexPrompt = buildIndexerPrompt(stage, originalPrompt, roleplayRaw);
    const indexStartedAt = new Date().toISOString();
    const indexedRaw = String(await baseChatCompletion([
      { role: "user", content: indexPrompt }
    ], {
      ...options,
      role: "chat_service",
      temperature: TEMPERATURE_INDEXER,
      max_tokens: indexerMaxTokens(stage),
      maxRetries: 1
    })).trim();
    const indexEndedAt = new Date().toISOString();

    const record = {
      ts: new Date().toISOString(),
      chain_key: store.chainKey || "",
      persona_id: store.personaId || "",
      condition: store.condition || "",
      stage,
      roleplay_prompt_sha256: sha256(roleplayPrompt),
      roleplay_started_at: roleplayStartedAt,
      roleplay_ended_at: roleplayEndedAt,
      roleplay_raw: roleplayRaw,
      roleplay_raw_chars: roleplayRaw.length,
      index_prompt_sha256: sha256(indexPrompt),
      index_started_at: indexStartedAt,
      index_ended_at: indexEndedAt,
      indexed_raw: indexedRaw,
      indexed_raw_chars: indexedRaw.length
    };
    if (Array.isArray(store.roleplayCalls)) store.roleplayCalls.push(record);
    appendJsonl(roleplayLogPath, record);
    return indexedRaw;
  };
}

function percentile(values, pct) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const pos = (sorted.length - 1) * pct;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return lo === hi ? sorted[lo] : sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

function mean(values) {
  const valid = values.filter(Number.isFinite);
  if (!valid.length) return null;
  return valid.reduce((sum, value) => sum + value, 0) / valid.length;
}

function sd(values) {
  const valid = values.filter(Number.isFinite);
  if (valid.length < 2) return 0;
  const avg = mean(valid);
  return Math.sqrt(valid.reduce((sum, value) => sum + ((value - avg) ** 2), 0) / (valid.length - 1));
}

function round(value, digits = 0) {
  return value == null ? null : Number(value.toFixed(digits));
}

function rowMetrics(row) {
  const output = row.r2?.calculate?.output || {};
  const metrics = row.r2?.calculate?.metrics || {};
  const price = Number(row.r2?.d5?.parsed?.aligned_price ?? row.r2?.d5?.parsed?.price ?? output.P);
  const profit = Number(metrics.profit ?? output.profit);
  const cost = Number(metrics.cost ?? output.COGS);
  const cards = Array.isArray(row.r2?.d4?.parsed?.cards) ? row.r2.d4.parsed.cards.length : null;
  return {
    persona_id: row.persona_id,
    condition: row.condition,
    status: row.status,
    profit,
    loss: Number.isFinite(profit) ? profit < 0 : null,
    price,
    cost,
    cards,
    units: Number(metrics.Q ?? output.units),
    share: Number(output.share)
  };
}

function summarize(rows) {
  const ok = rows.filter((row) => row.status === "OK");
  const metrics = ok.map(rowMetrics);
  const prices = metrics.map((item) => item.price).filter(Number.isFinite);
  const profits = metrics.map((item) => item.profit).filter(Number.isFinite);
  const cards = metrics.map((item) => item.cards).filter(Number.isFinite);
  const losses = metrics.filter((item) => item.loss === true).length;
  return {
    chains_total: rows.length,
    chains_ok: ok.length,
    chains_failed: rows.length - ok.length,
    loss_count: losses,
    loss_rate_pct: ok.length ? round((losses / ok.length) * 100, 1) : null,
    price_min: round(percentile(prices, 0), 0),
    price_p25: round(percentile(prices, 0.25), 0),
    price_p50: round(percentile(prices, 0.5), 0),
    price_p75: round(percentile(prices, 0.75), 0),
    price_max: round(percentile(prices, 1), 0),
    price_sd: round(sd(prices), 0),
    profit_p50: round(percentile(profits, 0.5), 0),
    profit_sd: round(sd(profits), 0),
    cards_p50: round(percentile(cards, 0.5), 1),
    cards_sd: round(sd(cards), 2),
    metrics
  };
}

function loadBaselineMetrics(personaIds, condition) {
  const dir = path.join(ROOT, "runs_v4flash_0731", "random42_simple_interface", "chains");
  if (!fs.existsSync(dir)) return [];
  return personaIds.map((personaId) => {
    const file = path.join(dir, `${personaId}_${condition}1.json`);
    if (!fs.existsSync(file)) return null;
    const artifact = loadJson(file);
    return rowMetrics(artifact.row);
  }).filter(Boolean);
}

function summarizeMetrics(metrics) {
  const prices = metrics.map((item) => item.price).filter(Number.isFinite);
  const profits = metrics.map((item) => item.profit).filter(Number.isFinite);
  const cards = metrics.map((item) => item.cards).filter(Number.isFinite);
  const losses = metrics.filter((item) => item.loss === true).length;
  return {
    n: metrics.length,
    loss_count: losses,
    loss_rate_pct: metrics.length ? round((losses / metrics.length) * 100, 1) : null,
    price_p50: round(percentile(prices, 0.5), 0),
    price_sd: round(sd(prices), 0),
    profit_p50: round(percentile(profits, 0.5), 0),
    profit_sd: round(sd(profits), 0),
    cards_p50: round(percentile(cards, 0.5), 1),
    cards_sd: round(sd(cards), 2)
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  loadLocalEnv();
  const FullGame = require("./full_game_all_personas");
  const deepseek = require("../../server/llm/deepseekClient");
  if (!deepseek.hasAnyKey()) throw new Error("missing API key for v4flash pilot");

  const { default: pLimit } = await import("p-limit");
  const { extractTags } = require("../../server/llm/tagExtractor");
  const { scoreTagsToDimensions } = require("../../server/llm/dimensionScorer");
  const vpWordScorer = require("../../server/llm/vpWordScorer");
  const vpCoach = require("../../server/llm/vpCoach");
  const personaGenerator = require("../../server/llm/personaGenerator");

  fs.mkdirSync(args.outDir, { recursive: true });
  const chainsDir = path.join(args.outDir, "chains");
  fs.mkdirSync(chainsDir, { recursive: true });
  const roleplayLogPath = path.join(args.outDir, "roleplay_calls.jsonl");
  if (!fs.existsSync(roleplayLogPath)) fs.writeFileSync(roleplayLogPath, "", "utf8");

  const pool = loadJson(args.poolPath);
  if (!Array.isArray(pool)) throw new Error(`pool must be an array: ${args.poolPath}`);
  const materials = FullGame.loadMaterials();
  const baseByArchetype = new Map(materials.personas.map((persona) => [persona.id, persona]));
  const selectedPool = pool.slice(args.offset, args.offset + args.limit);
  const runtime = {
    chatCompletion: createRoleplayFirstChatCompletion(deepseek.chatCompletion, roleplayLogPath),
    extractTags,
    scoreTagsToDimensions,
    vpWordScorer,
    vpCoach,
    personaGenerator
  };

  const limit = pLimit(args.concurrency);
  const startedAt = new Date().toISOString();
  const rows = new Array(selectedPool.length);
  await Promise.all(selectedPool.map((record, index) => limit(async () => {
    const basePersona = baseByArchetype.get(record.archetype);
    if (!basePersona) throw new Error(`missing base archetype: ${record.archetype}`);
    const persona = buildSimplePersona(basePersona, record);
    const chainKey = `${record.persona_id}|${args.condition}|roleplay_first`;
    const store = {
      chainKey,
      personaId: record.persona_id,
      condition: args.condition,
      roleplayCalls: []
    };
    const row = await roleplayStore.run(store, () => FullGame.runPlaythrough(
      runtime,
      persona,
      materials,
      RUN_ID,
      {
        condition: args.condition,
        rep: 1,
        jinangDraw: record.jinang_draw,
        questionDefinition: args.condition === "Q",
        promptMode: "interface"
      }
    ));
    row.arm_id = "roleplay_first_pilot";
    row.persona_pool_record = record;
    row.roleplay_first = {
      enabled: true,
      stages: ["R1", "D3", "D4", "D5"],
      roleplay_temperature: TEMPERATURE_ROLEPLAY,
      indexer_temperature: TEMPERATURE_INDEXER,
      calls: store.roleplayCalls
    };
    rows[index] = row;
    writeJson(path.join(chainsDir, `${record.persona_id}_${args.condition}1.json`), {
      chain_key: chainKey,
      persona_id: record.persona_id,
      condition: args.condition,
      archetype: record.archetype,
      row
    });
    console.error(`[roleplay_first_pilot] ${index + 1}/${selectedPool.length} ${chainKey} ${row.status} price=${row.r2?.d5?.parsed?.aligned_price ?? ""} profit=${row.r2?.calculate?.output?.profit ?? ""} error=${row.error || ""}`);
  })));

  const finishedAt = new Date().toISOString();
  const personaIds = selectedPool.map((record) => record.persona_id);
  const baselineMetrics = loadBaselineMetrics(personaIds, args.condition);
  const summary = {
    arm_id: "roleplay_first_pilot",
    run_id: RUN_ID,
    started_at: startedAt,
    finished_at: finishedAt,
    condition: args.condition,
    pool_path: path.relative(ROOT, args.poolPath),
    limit: args.limit,
    offset: args.offset,
    concurrency: args.concurrency,
    roleplay_first: {
      stages: ["R1", "D3", "D4", "D5"],
      persona_output: "natural language",
      indexer_output: "JSON for existing validators",
      d4_format: "six functional areas separately",
      roleplay_temperature: TEMPERATURE_ROLEPLAY,
      indexer_temperature: TEMPERATURE_INDEXER
    },
    pilot_summary: summarize(rows),
    baseline_same_personas_simple_interface: summarizeMetrics(baselineMetrics)
  };
  writeJson(path.join(args.outDir, "summary.json"), summary);
  console.log(JSON.stringify(summary, null, 2));
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.stack || error.message || String(error));
    process.exitCode = 1;
  });
}
