"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const ROOT = path.join(__dirname, "..", "..");
const DEFAULT_SOURCE_DIR = path.join(ROOT, "runs_v4flash_0731", "roleplay_first_pilot_42S", "chains");
const DEFAULT_OUT_DIR = path.join(ROOT, "runs_v4flash_0731", "d4_persona_d5_pricing_action_persona_42S");
const RUN_ID = "v4flash_0731_d4_persona_d5_pricing_action_persona_42S";
const ARM_ID = "d4_persona_d5_pricing_action_persona_42S";
const D4_MODE_PLAIN = "persona";
const D4_MODE_PERCEPTION_SATISFICE = "perception-satisficing";
const D4_MODE_ROLEPLAY_UPTAKE = "roleplay-uptake";
const TEMPERATURE_PERSONA = 1.0;
const TEMPERATURE_INDEXER = 0;
const MAX_INDEXER_ATTEMPTS = 3;
const TIER_CN_TO_ENGINE = { "低": "low", "中": "mid", "高": "high", low: "low", mid: "mid", high: "high" };

const FullGame = require("./full_game_all_personas");
const RD = require("../../server/llm/rdCalculator");
const {
  parseD4JsonPlan,
  parseDimensionD4Plan
} = require("./formal_v3_chat_format_paired");

function parseArgs(argv) {
  const args = {
    sourceDir: DEFAULT_SOURCE_DIR,
    outDir: DEFAULT_OUT_DIR,
    limit: 42,
    concurrency: 6,
    overwrite: false,
    d4Mode: D4_MODE_PLAIN
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--source-dir") args.sourceDir = path.resolve(ROOT, String(argv[++index] || "").trim());
    else if (arg === "--out-dir") args.outDir = path.resolve(ROOT, String(argv[++index] || "").trim());
    else if (arg === "--limit") args.limit = Number(argv[++index]);
    else if (arg === "--concurrency") args.concurrency = Number(argv[++index]);
    else if (arg === "--d4-mode") args.d4Mode = String(argv[++index] || "").trim();
    else if (arg === "--overwrite") args.overwrite = true;
    else throw new Error(`unknown argument: ${arg}`);
  }
  if (!Number.isInteger(args.limit) || args.limit < 1) throw new Error("--limit must be a positive integer");
  if (!Number.isInteger(args.concurrency) || args.concurrency < 1) throw new Error("--concurrency must be a positive integer");
  if (![D4_MODE_PLAIN, D4_MODE_PERCEPTION_SATISFICE, D4_MODE_ROLEPLAY_UPTAKE].includes(args.d4Mode)) {
    throw new Error(`--d4-mode must be ${D4_MODE_PLAIN}, ${D4_MODE_PERCEPTION_SATISFICE}, or ${D4_MODE_ROLEPLAY_UPTAKE}`);
  }
  return args;
}

function armIdForMode(d4Mode) {
  if (d4Mode === D4_MODE_ROLEPLAY_UPTAKE) {
    return "d4_roleplay_uptake_d5_pricing_action_persona_42S";
  }
  return d4Mode === D4_MODE_PERCEPTION_SATISFICE
    ? "d4_perception_satisficing_d5_pricing_action_persona_42S"
    : ARM_ID;
}

function runIdForMode(d4Mode) {
  if (d4Mode === D4_MODE_ROLEPLAY_UPTAKE) {
    return "v4flash_0731_d4_roleplay_uptake_d5_pricing_action_persona_42S";
  }
  return d4Mode === D4_MODE_PERCEPTION_SATISFICE
    ? "v4flash_0731_d4_perception_satisficing_d5_pricing_action_persona_42S"
    : RUN_ID;
}

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
  return crypto.createHash("sha256").update(String(value || "")).digest("hex");
}

function hashInt(parts, modulo) {
  const hex = sha256(parts.filter((part) => part !== undefined && part !== null).join("|")).slice(0, 12);
  return Number.parseInt(hex, 16) % modulo;
}

function stableChoice(parts, choices) {
  return choices[hashInt(parts, choices.length)];
}

function perceptionProfileFor(sourceRow) {
  const surface = sourceRow.persona_pool_record?.surface || {};
  const seed = sourceRow.persona_pool_record?.seed || sourceRow.run_id || "d4-perception-satisficing";
  const key = [seed, sourceRow.persona_id, sourceRow.condition, sourceRow.rep || 1, surface.mbti || ""];
  const attentionBreadth = stableChoice([...key, "attention"], ["narrow", "medium", "wide"]);
  const detailPatience = stableChoice([...key, "patience"], ["low", "medium", "high"]);
  const technicalComprehension = stableChoice([...key, "technical"], ["low", "medium", "high"]);
  const costSensitivity = stableChoice([...key, "cost"], ["low", "medium", "high"]);
  const riskSensitivity = stableChoice([...key, "risk"], ["low", "medium", "high"]);
  const confidenceStyle = stableChoice([...key, "confidence"], ["hesitant", "intuitive", "careful", "overconfident"]);
  const attentionBudgetByBreadth = { narrow: 2, medium: 3, wide: 4 };
  const stopRuleByPatience = {
    low: "看到 1-2 张大致够用的卡后就倾向停，不会把本格所有卡逐项比较完。",
    medium: "会比较几张明显相关的卡；如果已经满足最低标准，就不继续穷举。",
    high: "愿意多看一点，但仍按真人界面操作，不做全局最优搜索。"
  };
  return {
    seed,
    attention_breadth: attentionBreadth,
    attention_budget_cards_per_dimension: attentionBudgetByBreadth[attentionBreadth],
    detail_patience: detailPatience,
    technical_comprehension: technicalComprehension,
    cost_sensitivity: costSensitivity,
    risk_sensitivity: riskSensitivity,
    confidence_style: confidenceStyle,
    cue_preference: stableChoice([...key, "cue"], [
      "customer_need_language",
      "familiar_business_terms",
      "visible_unit_cost",
      "risk_and_trust_words",
      "broad_function_coverage"
    ]),
    satisficing_stop_rule: stopRuleByPatience[detailPatience]
  };
}

function renderPerceptionProfile(profile) {
  return [
    `attention_breadth=${profile.attention_breadth}`,
    `attention_budget_cards_per_dimension≈${profile.attention_budget_cards_per_dimension}`,
    `technical_comprehension=${profile.technical_comprehension}`,
    `cost_sensitivity=${profile.cost_sensitivity}`,
    `risk_sensitivity=${profile.risk_sensitivity}`,
    `detail_patience=${profile.detail_patience}`,
    `confidence_style=${profile.confidence_style}`,
    `cue_preference=${profile.cue_preference}`,
    `satisficing_stop_rule=${profile.satisficing_stop_rule}`
  ].join("\n");
}

function loadJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
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

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function truncate(text, max = 240) {
  const clean = String(text || "").replace(/\s+/g, " ").trim();
  return clean.length > max ? `${clean.slice(0, max)}...` : clean;
}

function mean(values) {
  const nums = values.map(Number).filter(Number.isFinite);
  return nums.length ? nums.reduce((sum, value) => sum + value, 0) / nums.length : null;
}

function sd(values) {
  const nums = values.map(Number).filter(Number.isFinite);
  if (nums.length < 2) return 0;
  const avg = mean(nums);
  return Math.sqrt(nums.reduce((sum, value) => sum + (value - avg) ** 2, 0) / (nums.length - 1));
}

function percentile(values, pct) {
  const sorted = values.map(Number).filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const index = Math.floor((sorted.length - 1) * pct);
  return sorted[index];
}

function priceOf(row) {
  return Number(row?.r2?.d5?.parsed?.aligned_price ?? row?.r2?.d5?.parsed?.price);
}

function profitOf(row) {
  return Number(row?.r2?.calculate?.metrics?.profit ?? row?.r2?.calculate?.output?.profit);
}

function cardsOf(row) {
  return row?.r2?.d4?.parsed?.cards || [];
}

function rowMetrics(row) {
  const output = row.r2?.calculate?.output || {};
  return {
    persona_id: row.persona_id,
    condition: row.condition,
    status: row.status,
    profit: Math.round(profitOf(row)),
    loss: profitOf(row) < 0,
    price: priceOf(row),
    cost: Number(row.r2?.calculate?.metrics?.cost ?? output.COGS ?? 0),
    cards: cardsOf(row).length,
    units: Math.round(Number(output.units ?? row.r2?.calculate?.metrics?.Q ?? 0)),
    share: Number(output.share || 0),
    pricing_action: row.r2?.d5?.parsed?.strategy_tier_chat?.pricing_action || "",
    tier: row.r2?.d5?.parsed?.strategy_tier_chat?.tier || "",
    d4_attempts: Number(row.r2?.d4?.attempts || 0),
    d5_attempts: Number(row.r2?.d5?.attempts || 0),
    d4_global_repair: Boolean(row.r2?.d4_persona_dimension?.global_repair)
  };
}

function summarize(rows) {
  const ok = rows.filter((row) => row?.status === "OK");
  const prices = ok.map(priceOf).filter(Number.isFinite);
  const profits = ok.map(profitOf).filter(Number.isFinite);
  const cardCounts = ok.map((row) => cardsOf(row).length).filter(Number.isFinite);
  const priceFreq = {};
  for (const price of prices) priceFreq[String(price)] = (priceFreq[String(price)] || 0) + 1;
  const metrics = ok.map(rowMetrics);
  return {
    chains_total: rows.length,
    chains_ok: ok.length,
    chains_failed: rows.filter((row) => row?.status !== "OK").length,
    loss_count: ok.filter((row) => profitOf(row) < 0).length,
    loss_rate_pct: ok.length ? Number((ok.filter((row) => profitOf(row) < 0).length / ok.length * 100).toFixed(1)) : null,
    price_min: prices.length ? Math.min(...prices) : null,
    price_p25: percentile(prices, 0.25),
    price_p50: percentile(prices, 0.5),
    price_p75: percentile(prices, 0.75),
    price_max: prices.length ? Math.max(...prices) : null,
    price_sd: Math.round(sd(prices)),
    profit_p50: percentile(profits, 0.5) == null ? null : Math.round(percentile(profits, 0.5)),
    profit_sd: Math.round(sd(profits)),
    cards_p50: percentile(cardCounts, 0.5),
    cards_sd: Number(sd(cardCounts).toFixed(2)),
    d4_global_repair_count: ok.filter((row) => row.r2?.d4_persona_dimension?.global_repair).length,
    price_frequency: Object.fromEntries(Object.entries(priceFreq).sort((a, b) => Number(a[0]) - Number(b[0]))),
    metrics
  };
}

function renderCardsByGroup(cards, materials) {
  const grouped = new Map();
  for (const card of cards || []) {
    const group = materials.groupByCapability.get(card.id || card.cap_id || card.card_id);
    const groupName = group?.name || group?.group_id || "未知维度";
    if (!grouped.has(groupName)) grouped.set(groupName, []);
    grouped.get(groupName).push(`${card.id || card.cap_id || card.card_id}@${card.tier}`);
  }
  return Array.from(grouped.entries()).map(([name, values]) => `${name}=${values.join(",")}`).join("；");
}

function d4ContextPrefix(sourcePrompt) {
  const text = String(sourcePrompt || "");
  const markers = ["【六个功能区能力卡】", "【能力卡池；学生可见信息】", "【输出契约】", "输出 JSON："];
  let cut = -1;
  for (const marker of markers) {
    const idx = text.indexOf(marker);
    if (idx >= 0 && (cut < 0 || idx < cut)) cut = idx;
  }
  return (cut >= 0 ? text.slice(0, cut) : text).trim();
}

function d4QuestionBlock(sourcePrompt) {
  const text = String(sourcePrompt || "");
  const questionAt = text.indexOf("【你刚刚提出的问题】");
  if (questionAt < 0) return "";
  const outputAt = text.indexOf("【输出契约】", questionAt);
  return text.slice(questionAt, outputAt >= 0 ? outputAt : undefined).trim();
}

function renderDimensionGroup(group) {
  return JSON.stringify({
    dimension: group.name || group.group_id,
    group_id: group.group_id,
    cards: (group.capabilities || []).map((cap) => ({
      cap_id: cap.cap_id,
      name: cap.name || cap.cap_id,
      covers: cap.covers || [],
      dependencies: cap.dependencies || [],
      conflicts: cap.conflicts || [],
      nre: cap.nre,
      tiers: Object.fromEntries(Object.entries(cap.tiers || {}).map(([tier, tierInfo]) => [tier, {
        dCOGS: tierInfo.dCOGS,
        risk: tierInfo.risk,
        sub_lift: tierInfo.sub_lift,
        load: tierInfo.load
      }]))
    }))
  }, null, 2);
}

function buildD4PersonaPrompt(sourceRow, group, selectedSoFar, materials) {
  return [
    d4ContextPrefix(sourceRow.r2?.d4?.prompt || ""),
    "",
    "【输出方式变更：D4 六格 persona 逐格口述，不填 JSON】",
    "请继续用上面这位课堂参与者的第一人称口吻和表达风格回答。",
    "你现在就在能力卡界面上，只看当前这个功能区。",
    `当前功能区：${group.name || group.group_id}`,
    "针对这个客户和你前面提交过的内容，说说这一格哪些能力要点、各用什么档位。",
    "如果这一格不是核心需求，也至少保留 1 张最低必要卡；不要从其他功能区选卡。",
    "可以犹豫、改口、删掉某张卡，但最后要落到本格最终点击结果。",
    "",
    "【本格可选能力卡】",
    renderDimensionGroup(group),
    "",
    "【已经选过的其他功能区】",
    selectedSoFar.length ? renderCardsByGroup(selectedSoFar, materials) : "尚未选择其他功能区。",
    "",
    "【兼容提示】依赖/冲突只使用本格卡片字段；六格结束后会做全局兼容校验。",
    d4QuestionBlock(sourceRow.r2?.d4?.prompt || ""),
    "",
    "不要输出 JSON，不要 Markdown 表格。",
    "最后单独写一行：",
    "本格最终选卡：cap_id@tier、cap_id@tier、..."
  ].filter(Boolean).join("\n");
}

function buildD4PerceptionScanPrompt(sourceRow, group, selectedSoFar, materials, perceptionProfile) {
  return [
    d4ContextPrefix(sourceRow.r2?.d4?.prompt || ""),
    "",
    "【输出方式变更：D4 六格 perception + satisficing，不填 JSON】",
    "请继续用上面这位课堂参与者的第一人称口吻和表达风格回答。",
    "你现在就在能力卡界面上，只看当前这个功能区。界面信息完整可见，但你作为真人不会等质量读懂每张卡。",
    "",
    "【你的本轮读屏/理解倾向；这是行为模拟，不是隐藏信息】",
    renderPerceptionProfile(perceptionProfile),
    "",
    `当前功能区：${group.name || group.group_id}`,
    "",
    "【本格可选能力卡】",
    renderDimensionGroup(group),
    "",
    "【已经选过的其他功能区】",
    selectedSoFar.length ? renderCardsByGroup(selectedSoFar, materials) : "尚未选择其他功能区。",
    "",
    "请先像真实参与者一样扫这一格：",
    "1. 说你第一眼注意到哪几张卡或哪些词。",
    "2. 说哪些技术词、依赖/冲突、成本或风险你没太细看/没完全懂。",
    "3. 说你觉得这一格最低要满足到什么程度就算够用。",
    "先不要提交最终选卡；不要输出 JSON，不要 Markdown 表格。"
  ].filter(Boolean).join("\n");
}

function buildD4PerceptionChoicePrompt(sourceRow, group) {
  return [
    "现在基于你刚才实际扫到、看懂、在意的东西做本格最终点击。",
    "保持这个 persona 的第一人称口吻；可以犹豫，但不要切换成研究助理或优化器。",
    "按 satisficing 做：达到你刚才说的最低够用标准后就停止加卡，不要为了全面而全面。",
    "如果这一格不是核心需求，也至少保留 1 张最低必要卡；不要从其他功能区选卡。",
    "如果你没完全看懂某张卡，可以凭界面直觉选低档/不选；如果风险或成本让你犹豫，也可以降档。",
    d4QuestionBlock(sourceRow.r2?.d4?.prompt || ""),
    "",
    "最后单独写一行：",
    "本格最终选卡：cap_id@tier、cap_id@tier、...",
    `当前功能区仍然是：${group.name || group.group_id}`,
    "不要输出 JSON，不要 Markdown 表格。"
  ].filter(Boolean).join("\n");
}

function buildD4RoleplayUptakePrompt(sourceRow, group, selectedSoFar, materials) {
  return [
    d4ContextPrefix(sourceRow.r2?.d4?.prompt || ""),
    "",
    "【输出方式变更：D4 persona 自然读界面，不填 JSON】",
    "请继续用上面这位课堂参与者的第一人称口吻和表达风格回答。",
    "你现在就在能力卡界面上，只看当前这个功能区。",
    "",
    "不要把自己当研究助理，也不要假装自己会把每张卡、每个依赖、每个成本数字都等质量读完。",
    "像真实课堂参与者一样：按你的背景经验、表达习惯、耐心、技术熟悉度和成本直觉，自然地抓重点、漏掉细节、误会一些术语，或者觉得够用了就停。",
    "不要自述 attention_breadth、technical_comprehension 这类标签；这些只应该体现在你的说话和点击里。",
    "",
    `当前功能区：${group.name || group.group_id}`,
    "",
    "【本格可选能力卡】",
    renderDimensionGroup(group),
    "",
    "【已经选过的其他功能区】",
    selectedSoFar.length ? renderCardsByGroup(selectedSoFar, materials) : "尚未选择其他功能区。",
    "",
    "请先自然说几句：这一格你第一眼抓住了什么、哪里没细看或不确定、为什么觉得这些选择已经够用。",
    "然后提交本格最终点击。可以犹豫、改口、删掉某张卡；不要从其他功能区选卡。",
    "如果这一格不是核心需求，也至少保留 1 张最低必要卡。",
    d4QuestionBlock(sourceRow.r2?.d4?.prompt || ""),
    "",
    "最后单独写一行：",
    "本格最终选卡：cap_id@tier、cap_id@tier、...",
    "不要输出 JSON，不要 Markdown 表格。"
  ].filter(Boolean).join("\n");
}

function buildD4IndexerPrompt(sourceRow, group, roleplayRaw) {
  return [
    "你是事后编码员，只把课堂参与者的自然话翻译成这个功能区的结构化选卡。",
    "不要替他优化，不要补商业分析；如果有犹豫或改口，只记录最后明确提交的卡。",
    "只能使用本格可选能力卡里的真实 cap_id；tier 只能是 low/mid/high。",
    "只输出可 JSON.parse 的 JSON，不要 Markdown，不要额外文字。",
    "",
    "【原界面上下文】",
    d4ContextPrefix(sourceRow.r2?.d4?.prompt || ""),
    "",
    `【当前功能区】${group.name || group.group_id}`,
    renderDimensionGroup(group),
    "",
    "【参与者自然话原文】",
    roleplayRaw,
    "",
    "【输出 JSON】",
    "{\"dimension\":\"<当前功能区>\",\"cards\":[{\"id\":\"<真实cap_id>\",\"tier\":\"low|mid|high\"}],\"reason\":\"一句话保留原话取舍\",\"cost_note\":\"一句话成本直觉\"}"
  ].join("\n");
}

function parseJsonObject(raw) {
  const parsed = JSON.parse(String(raw || "").trim());
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("response is not a JSON object");
  return parsed;
}

function stripJsonFences(text) {
  const trimmed = String(text || "").trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```\s*$/i);
  if (fenced) return { text: fenced[1].trim(), applied: true };
  const replaced = trimmed.replace(/```(?:json)?/gi, "").replace(/```/g, "").trim();
  return { text: replaced, applied: replaced !== trimmed };
}

function removeTrailingCommas(text) {
  return String(text || "").replace(/,\s*([}\]])/g, "$1");
}

function firstJsonObjectBlock(text) {
  const source = String(text || "");
  for (let start = source.indexOf("{"); start >= 0; start = source.indexOf("{", start + 1)) {
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let index = start; index < source.length; index += 1) {
      const char = source[index];
      if (inString) {
        if (escaped) escaped = false;
        else if (char === "\\") escaped = true;
        else if (char === "\"") inString = false;
        continue;
      }
      if (char === "\"") inString = true;
      else if (char === "{") depth += 1;
      else if (char === "}") {
        depth -= 1;
        if (depth === 0) return source.slice(start, index + 1);
      }
    }
  }
  return "";
}

function salvageJsonText(raw) {
  const steps = [];
  const fenced = stripJsonFences(raw);
  let text = fenced.text;
  if (fenced.applied) steps.push("strip_fences");
  const block = firstJsonObjectBlock(text);
  if (block && block.trim() !== text.trim()) {
    text = block.trim();
    steps.push("extract_json_block");
  }
  try {
    parseJsonObject(text);
    return { text, steps };
  } catch (_) {
    const withoutTrailingCommas = removeTrailingCommas(text).trim();
    if (withoutTrailingCommas !== text.trim()) {
      try {
        parseJsonObject(withoutTrailingCommas);
        return { text: withoutTrailingCommas, steps: [...steps, "strip_trailing_commas"] };
      } catch (_) {
        return null;
      }
    }
  }
  return null;
}

async function loggedChat(chatCompletion, callsPath, meta, messages, options) {
  const startedAt = new Date().toISOString();
  const startedMs = Date.now();
  const promptText = messages.map((message) => `${message.role}:${message.content}`).join("\n\n");
  try {
    const raw = String(await chatCompletion(messages, {
      role: "chat_service",
      temperature: options.temperature,
      max_tokens: options.max_tokens,
      maxRetries: 1,
      disableThinking: true
    })).trim();
    appendJsonl(callsPath, {
      ts: new Date().toISOString(),
      ...meta,
      status: "ok",
      http_code: 200,
      latency_ms: Date.now() - startedMs,
      prompt_chars: Array.from(promptText).length,
      output_chars: Array.from(raw).length,
      prompt_sha256: sha256(promptText),
      raw_sha256: sha256(raw),
      error: ""
    });
    return {
      status: "OK",
      raw,
      started_at: startedAt,
      ended_at: new Date().toISOString(),
      latency_ms: Date.now() - startedMs,
      prompt_sha256: sha256(promptText),
      raw_sha256: sha256(raw)
    };
  } catch (error) {
    appendJsonl(callsPath, {
      ts: new Date().toISOString(),
      ...meta,
      status: "error",
      http_code: Number(error?.statusCode || error?.status || 0) || null,
      latency_ms: Date.now() - startedMs,
      prompt_chars: Array.from(promptText).length,
      output_chars: 0,
      prompt_sha256: sha256(promptText),
      raw_sha256: "",
      error: String(error?.message || error)
    });
    throw error;
  }
}

async function callIndexerWithRepair(chatCompletion, callsPath, meta, prompt, parser, maxTokens) {
  let messages = [{ role: "user", content: prompt }];
  const attemptLog = [];
  let lastError = null;
  for (let attempt = 1; attempt <= MAX_INDEXER_ATTEMPTS; attempt += 1) {
    let raw = "";
    try {
      const call = await loggedChat(chatCompletion, callsPath, { ...meta, attempt }, messages, {
        temperature: TEMPERATURE_INDEXER,
        max_tokens: maxTokens
      });
      raw = call.raw;
      let parseText = raw;
      let salvage = null;
      try {
        parser(parseText);
      } catch (directError) {
        const salvaged = salvageJsonText(raw);
        if (!salvaged) throw directError;
        parseText = salvaged.text;
        salvage = salvaged;
      }
      const parsed = parser(parseText);
      attemptLog.push({
        attempt,
        raw_response: raw,
        raw_sha256: sha256(raw),
        raw_chars: Array.from(raw).length,
        status: "ok",
        validator_error: "",
        salvage: Boolean(salvage),
        salvage_steps: salvage?.steps || []
      });
      return {
        stage: meta.stage,
        prompt,
        prompt_sha256: sha256(prompt),
        raw_response: raw,
        parsed,
        attempts: attempt,
        status: "OK",
        error: "",
        salvage: Boolean(salvage),
        salvage_steps: salvage?.steps || [],
        attempt_log: attemptLog
      };
    } catch (error) {
      lastError = error;
      attemptLog.push({
        attempt,
        raw_response: raw,
        raw_sha256: raw ? sha256(raw) : "",
        raw_chars: Array.from(raw || "").length,
        status: "error",
        validator_error: String(error?.message || error),
        salvage: false,
        salvage_steps: []
      });
      if (attempt < MAX_INDEXER_ATTEMPTS) {
        messages = [
          { role: "user", content: prompt },
          { role: "assistant", content: raw || "(空输出)" },
          { role: "user", content: `上一次翻译无法通过校验：${String(error?.message || error)}。请只修正为合法 JSON，不要改变参与者的核心选择。` }
        ];
      }
    }
  }
  throw new Error(`indexer failed after ${MAX_INDEXER_ATTEMPTS} attempts: ${String(lastError?.message || lastError)}`);
}

function buildDimensionGlobalRepairPrompt(sourceRow, dimensionCalls, combineError, materials) {
  const selected = dimensionCalls.flatMap((call) => call.parsed.cards || []);
  return [
    "你是事后编码员。下面六格 persona 口述已经完成，现在只做结构化记录的最小合法性修复。",
    "不要重新做需求判断；优先保留原选择。只有在依赖/冲突/重复/缺维度导致无法结算时，才最小幅度补卡、删卡或调档。",
    "",
    "【界面上下文】",
    d4ContextPrefix(sourceRow.r2?.d4?.prompt || ""),
    "",
    "【六格已翻译结果】",
    renderCardsByGroup(selected, materials),
    "",
    "【六格自然话】",
    dimensionCalls.map((call) => `## ${call.parsed.dimension || call.parsed.group_id}\n${call.roleplay_raw}`).join("\n\n"),
    "",
    "【合并校验错误】",
    String(combineError?.message || combineError),
    "",
    "【输出 JSON】",
    "{\"cards\":[{\"id\":\"<真实cap_id>\",\"tier\":\"low|mid|high\"}],\"cost_stance\":{\"text\":\"一句选卡取舍备注\",\"source\":\"承前:D3\"},\"updated_constraints\":[{\"text\":\"下一步要记住的一条界面备注\",\"source\":\"承前:D3\"}]}",
    "只输出可 JSON.parse 的 JSON，不要 Markdown，不要额外文字。"
  ].join("\n");
}

function combineDimensionPlans(dimensionCalls, materials) {
  return parseD4JsonPlan(JSON.stringify({
    cards: dimensionCalls.flatMap((call) => call.parsed.cards || []),
    cost_stance: {
      text: `六个功能区逐格口述后形成的选卡取舍：${dimensionCalls.map((call) => `${call.parsed.dimension || call.parsed.group_id}：${call.parsed.cost_note || call.parsed.reason}`).join("；")}`,
      source: "承前:D3"
    },
    updated_constraints: dimensionCalls.map((call) => ({
      text: `${call.parsed.dimension || call.parsed.group_id}：${call.parsed.reason || "按本格口述选择"}`,
      source: "承前:D3"
    })).slice(0, 5)
  }), materials);
}

async function runD4PersonaDimensions(chatCompletion, callsPath, sourceRow, materials, options = {}) {
  const dimensionCalls = [];
  let selectedSoFar = [];
  const chainKey = `${sourceRow.persona_id}_${sourceRow.condition}${sourceRow.rep || 1}`;
  const d4Mode = options.d4Mode || D4_MODE_PLAIN;
  const perceptionProfile = d4Mode === D4_MODE_PERCEPTION_SATISFICE ? perceptionProfileFor(sourceRow) : null;
  for (const group of materials.capabilityGroups.groups || []) {
    let personaPrompt = buildD4PersonaPrompt(sourceRow, group, selectedSoFar, materials);
    let roleplayRaw = "";
    let roleplayMeta = {};
    if (d4Mode === D4_MODE_ROLEPLAY_UPTAKE) {
      personaPrompt = buildD4RoleplayUptakePrompt(sourceRow, group, selectedSoFar, materials);
      const personaCall = await loggedChat(chatCompletion, callsPath, {
        persona_id: sourceRow.persona_id,
        chain_key: chainKey,
        step_type: "d4_roleplay_uptake",
        stage: `D4_roleplay_uptake_${group.group_id}`,
        dimension: group.group_id,
        attempt: 1
      }, [{ role: "user", content: personaPrompt }], {
        temperature: TEMPERATURE_PERSONA,
        max_tokens: 1200
      });
      roleplayRaw = personaCall.raw;
      roleplayMeta = {
        roleplay_call_count: 1,
        uptake_mode: "implicit_persona_roleplay"
      };
    } else if (d4Mode === D4_MODE_PERCEPTION_SATISFICE) {
      const scanPrompt = buildD4PerceptionScanPrompt(sourceRow, group, selectedSoFar, materials, perceptionProfile);
      const scanCall = await loggedChat(chatCompletion, callsPath, {
        persona_id: sourceRow.persona_id,
        chain_key: chainKey,
        step_type: "d4_perception_scan",
        stage: `D4_scan_${group.group_id}`,
        dimension: group.group_id,
        attempt: 1
      }, [{ role: "user", content: scanPrompt }], {
        temperature: TEMPERATURE_PERSONA,
        max_tokens: 900
      });
      const choicePrompt = buildD4PerceptionChoicePrompt(sourceRow, group);
      const choiceMessages = [
        { role: "user", content: scanPrompt },
        { role: "assistant", content: scanCall.raw },
        { role: "user", content: choicePrompt }
      ];
      const choiceCall = await loggedChat(chatCompletion, callsPath, {
        persona_id: sourceRow.persona_id,
        chain_key: chainKey,
        step_type: "d4_satisficing_choice",
        stage: `D4_choice_${group.group_id}`,
        dimension: group.group_id,
        attempt: 1
      }, choiceMessages, {
        temperature: TEMPERATURE_PERSONA,
        max_tokens: 1000
      });
      personaPrompt = [scanPrompt, choicePrompt].join("\n\n===== D4 SATISFICING CHOICE =====\n\n");
      roleplayRaw = [
        "【扫视/理解】",
        scanCall.raw,
        "",
        "【本格最终点击】",
        choiceCall.raw
      ].join("\n");
      roleplayMeta = {
        scan_prompt: scanPrompt,
        scan_prompt_sha256: sha256(scanPrompt),
        scan_raw: scanCall.raw,
        scan_raw_sha256: sha256(scanCall.raw),
        scan_raw_chars: Array.from(scanCall.raw).length,
        choice_prompt: choicePrompt,
        choice_prompt_sha256: sha256(choicePrompt),
        choice_raw: choiceCall.raw,
        choice_raw_sha256: sha256(choiceCall.raw),
        choice_raw_chars: Array.from(choiceCall.raw).length,
        roleplay_call_count: 2,
        perception_profile: perceptionProfile
      };
    } else {
      const personaCall = await loggedChat(chatCompletion, callsPath, {
        persona_id: sourceRow.persona_id,
        chain_key: chainKey,
        step_type: "d4_persona",
        stage: `D4_persona_${group.group_id}`,
        dimension: group.group_id,
        attempt: 1
      }, [{ role: "user", content: personaPrompt }], {
        temperature: TEMPERATURE_PERSONA,
        max_tokens: 1400
      });
      roleplayRaw = personaCall.raw;
      roleplayMeta = {
        roleplay_call_count: 1
      };
    }
    const indexerPrompt = buildD4IndexerPrompt(sourceRow, group, roleplayRaw);
    const indexerCall = await callIndexerWithRepair(
      chatCompletion,
      callsPath,
      {
        persona_id: sourceRow.persona_id,
        chain_key: chainKey,
        step_type: "d4_indexer",
        stage: `D4_indexer_${group.group_id}`,
        dimension: group.group_id
      },
      indexerPrompt,
      (raw) => parseDimensionD4Plan(raw, group, materials),
      1200
    );
    const combinedCall = {
      ...indexerCall,
      roleplay_prompt: personaPrompt,
      roleplay_prompt_sha256: sha256(personaPrompt),
      roleplay_raw: roleplayRaw,
      roleplay_raw_sha256: sha256(roleplayRaw),
      roleplay_raw_chars: Array.from(roleplayRaw).length,
      ...roleplayMeta,
      group_id: group.group_id
    };
    dimensionCalls.push(combinedCall);
    selectedSoFar = selectedSoFar.concat(indexerCall.parsed.cards);
  }

  let globalRepair = null;
  let parsed = null;
  try {
    parsed = combineDimensionPlans(dimensionCalls, materials);
  } catch (error) {
    const repairPrompt = buildDimensionGlobalRepairPrompt(sourceRow, dimensionCalls, error, materials);
    globalRepair = await callIndexerWithRepair(
      chatCompletion,
      callsPath,
      {
        persona_id: sourceRow.persona_id,
        chain_key: chainKey,
        step_type: "d4_global_repair",
        stage: "D4_global_repair",
        dimension: "all"
      },
      repairPrompt,
      (raw) => parseD4JsonPlan(raw, materials),
      3000
    );
    parsed = globalRepair.parsed;
  }

  const allCalls = [...dimensionCalls, globalRepair].filter(Boolean);
  return {
    prompt: allCalls.map((call) => call.prompt).filter(Boolean).join("\n\n===== NEXT D4 TRANSLATION STEP =====\n\n"),
    prompt_sha256: sha256(allCalls.map((call) => call.prompt_sha256).filter(Boolean).join("|")),
    raw_response: allCalls.map((call) => call.roleplay_raw || call.raw_response).filter(Boolean).join("\n\n===== NEXT D4 PERSONA RAW / REPAIR =====\n\n"),
    parsed,
    attempts: allCalls.reduce((sum, call) => sum + Number(call.attempts || 0), 0)
      + dimensionCalls.reduce((sum, call) => sum + Number(call.roleplay_call_count || 1), 0),
    status: "OK",
    error: "",
    dimension_detail: {
      d4_mode: d4Mode,
      perception_profile: perceptionProfile,
      dimension_rounds: dimensionCalls,
      global_repair: globalRepair,
      global_repair_used: Boolean(globalRepair)
    }
  };
}

function toGridPriorId(gridId) {
  const raw = String(gridId || "");
  const customerType = raw.includes("ToB") ? "B2B" : "B2C";
  const strategy = raw.includes("_COST_") ? "Cost" : "Differentiation";
  const ageRaw = raw.endsWith("_CHILD") ? "Child" : raw.endsWith("_ELDER") ? "Elder" : "Adult";
  return `${customerType}_${strategy}_${ageRaw}`;
}

function selectedCardCostSummary(cards, r1Outcome) {
  let dCOGS = 0;
  let nreWan = 0;
  const selected = [];
  for (const card of cards || []) {
    const params = RD.getCapabilityParams(card.id, card.tier) || {};
    const unitCost = Number(params.dCOGS || 0);
    const nre = Number(params.nre_tier || params.nre || 0);
    dCOGS += unitCost;
    nreWan += nre;
    selected.push(`${card.id}@${card.tier}(+¥${unitCost}/台,研发${nre}万)`);
  }
  const baseUnitCost = Number(RD.GLOBAL_PARAMS.V || 0);
  const fixedBaseWan = Number(RD.GLOBAL_PARAMS.F || 0) / 10000;
  const parsedGrid = RD.parseGridId(toGridPriorId(r1Outcome.grid_id));
  const channelFee = Number(RD.GRID_PARAMS?.[`${parsedGrid.channel}_${parsedGrid.age}`]?.f || 0);
  return {
    selected,
    card_count: selected.length,
    dCOGS: Math.round(dCOGS),
    nre_wan: Number(nreWan.toFixed(2)),
    base_unit_cost: Math.round(baseUnitCost),
    unit_cost_total: Math.round(baseUnitCost + dCOGS),
    fixed_base_wan: Number(fixedBaseWan.toFixed(2)),
    fixed_total_wan: Number((fixedBaseWan + nreWan).toFixed(2)),
    channel_fee_pct: Math.round(channelFee * 100)
  };
}

function renderD5PricingContext(r1Outcome, d4Parsed) {
  const summary = selectedCardCostSummary(d4Parsed.cards || [], r1Outcome);
  return [
    `已选能力卡：${summary.selected.join("、") || "无"}`,
    `已选 ${summary.card_count} 张；dCOGS 小计 +¥${summary.dCOGS}/台；单台总变动成本约 ¥${summary.unit_cost_total}/台（基础 ¥${summary.base_unit_cost} + dCOGS）。`,
    `固定成本约 ${summary.fixed_total_wan} 万（基础 ${summary.fixed_base_wan} 万 + NRE ${summary.nre_wan} 万）。`,
    `当前渠道抽成约 ${summary.channel_fee_pct}%。`
  ].join("\n");
}

function stripD5JsonContract(prompt) {
  const lines = String(prompt || "").split(/\r?\n/);
  const kept = [];
  const stopMarkers = [
    "basis 和 reasoning",
    "source 可用",
    "输出 JSON",
    "只输出可 JSON.parse"
  ];
  for (const line of lines) {
    if (stopMarkers.some((marker) => line.includes(marker))) break;
    kept.push(line);
  }
  return kept.join("\n").trim();
}

function buildUpdatedD5Context(sourceRow, d4Parsed, materials) {
  const d4Record = `D4：选卡${d4Parsed.cards.length}张[${renderCardsByGroup(d4Parsed.cards, materials)}]；选卡备注=${truncate(d4Parsed.cost_stance?.text, 260)}；界面备注=${(d4Parsed.updated_constraints || []).map((item) => item.text).join("；")}`;
  let prompt = String(sourceRow.r2?.d5?.prompt || "");
  prompt = prompt.replace(/D4：选卡.*?\n/u, `${d4Record}\n`);
  prompt = prompt.replace(/定价参考框架：\n[\s\S]*?【定价须知】/u, `定价参考框架：\n${renderD5PricingContext(sourceRow.r1_settlement, d4Parsed)}\n【定价须知】`);
  return stripD5JsonContract(prompt);
}

function findLastLabeledLine(raw, regexp) {
  const lines = String(raw || "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const match = lines[index].match(regexp);
    if (match) return match[1].trim();
  }
  return "";
}

function findLastMatch(raw, regexp) {
  let value = "";
  for (const match of String(raw || "").matchAll(regexp)) {
    value = String(match[1] || "").trim();
  }
  return value;
}

function parseTierLabel(raw) {
  const explicit = findLastLabeledLine(raw, /^相对档位\s*[：:]\s*(中高|中低|高|中|低)\s*$/u)
    || findLastMatch(raw, /相对档位\s*[：:]\s*(中高|中低|高|中|低)/gu);
  if (explicit === "高" || explicit === "中高") return "high";
  if (explicit === "低" || explicit === "中低") return "low";
  if (explicit === "中") return "mid";
  return "";
}

function parsePricingActionLabel(raw) {
  const explicit = findLastLabeledLine(raw, /^定价动作\s*[：:]\s*(压低售价抢量|抬高售价守毛利)\s*$/u)
    || findLastMatch(raw, /定价动作\s*[：:]\s*(压低售价抢量|抬高售价守毛利)/gu);
  if (explicit === "压低售价抢量") return "lower_price_for_volume";
  if (explicit === "抬高售价守毛利") return "higher_price_for_margin";
  return "";
}

function parsePrice(raw) {
  const text = String(raw || "");
  const finalMatches = [...text.matchAll(/(?:最终价格|最终定价)\s*[：:]?\s*(\d{2,5})\s*元?/gu)].map((match) => Number(match[1]));
  let price = finalMatches.length ? finalMatches[finalMatches.length - 1] : null;
  if (price === null) {
    const fallback = [...text.matchAll(/(?<!\d)([1-6]\d{3})(?!\d)/gu)]
      .map((match) => Number(match[1]))
      .filter((num) => num >= 1000 && num <= 6000);
    price = fallback.length ? fallback[fallback.length - 1] : null;
  }
  if (!Number.isFinite(price)) throw new Error("no valid slider price found");
  if (price < 1000 || price > 6000) throw new Error("final price outside slider bounds");
  return {
    price,
    aligned_price: Math.max(1000, Math.min(6000, Math.round(price / 100) * 100)),
    basis: { text: truncate(text, 600), source: "承前:D4" },
    reasoning: truncate(text, 1200)
  };
}

function buildPricingActionPrompts(sourceRow, d4Parsed, materials) {
  const context = buildUpdatedD5Context(sourceRow, d4Parsed, materials);
  const styleReminder = "请继续用上面这位课堂参与者的第一人称口吻和表达风格回答。";
  const first = [
    context,
    "",
    "【输出方式变更：分步定价 chat，不填 JSON】",
    styleReminder,
    "现在你就在产品售价滑块前做最后定价。请先判断自己此刻更像哪种定价动作。",
    "A：压低售价抢量。意思是用相对更低的售价换更多用户愿意买，不追求单台高毛利。",
    "B：抬高售价守毛利。意思是接受销量可能少一些，用相对更高售价覆盖能力成本和渠道抽成，保护单台毛利。",
    "只能在 A 和 B 里选一个；如果心里有摇摆，也要先选你此刻会采用的动作。",
    "不要给具体价格。",
    "最后单独写一行：定价动作：压低售价抢量 或 定价动作：抬高售价守毛利",
    "不要输出 JSON，不要 Markdown 表格。"
  ].join("\n");
  const second = [
    styleReminder,
    "第二问：承接你刚才选择的定价动作，在界面的产品售价滑块上，你会把它放在相对高档、中档、还是低档？",
    "如果你刚才选的是压低售价抢量，低档或中档更符合这个动作；如果你刚才选的是抬高售价守毛利，中档或高档更符合这个动作。",
    "高/中/低只是滑块相对位置，不给固定数值段，也不代表建议价或锚点。",
    "仍然不要给具体价格。",
    "最后单独写一行：相对档位：高 或 相对档位：中 或 相对档位：低",
    "不要输出 JSON，不要 Markdown 表格。"
  ].join("\n");
  const third = [
    styleReminder,
    "第三问：现在请在这个相对档位里提交一个最终价格。",
    "界面真实可提交边界仍是 1000 到 6000；这是控件边界，不代表建议价、合理价、市场价或锚定价格。",
    "不要使用固定步长，也不要把上下限或中点当默认答案。",
    "像真实参与者一样说一句你为什么最后落在这个数字。",
    "最后单独写一行：最终价格：<一个整数>元",
    "不要输出 JSON，不要 Markdown 表格。"
  ].join("\n");
  return { first, second, third };
}

async function runPricingActionPersonaD5(chatCompletion, callsPath, sourceRow, d4Parsed, materials) {
  const chainKey = `${sourceRow.persona_id}_${sourceRow.condition}${sourceRow.rep || 1}`;
  const prompts = buildPricingActionPrompts(sourceRow, d4Parsed, materials);
  const messages = [{ role: "user", content: prompts.first }];
  const actionCall = await loggedChat(chatCompletion, callsPath, {
    persona_id: sourceRow.persona_id,
    chain_key: chainKey,
    step_type: "d5_pricing_action",
    stage: "D5_pricing_action",
    attempt: 1
  }, messages, { temperature: TEMPERATURE_PERSONA, max_tokens: 700 });
  messages.push({ role: "assistant", content: actionCall.raw });
  messages.push({ role: "user", content: prompts.second });
  const tierCall = await loggedChat(chatCompletion, callsPath, {
    persona_id: sourceRow.persona_id,
    chain_key: chainKey,
    step_type: "d5_price_tier",
    stage: "D5_price_tier",
    attempt: 1
  }, messages, { temperature: TEMPERATURE_PERSONA, max_tokens: 700 });
  messages.push({ role: "assistant", content: tierCall.raw });
  messages.push({ role: "user", content: prompts.third });
  const priceCall = await loggedChat(chatCompletion, callsPath, {
    persona_id: sourceRow.persona_id,
    chain_key: chainKey,
    step_type: "d5_final_price",
    stage: "D5_final_price",
    attempt: 1
  }, messages, { temperature: TEMPERATURE_PERSONA, max_tokens: 900 });
  const parsed = parsePrice(priceCall.raw);
  parsed.strategy_tier_chat = {
    pricing_action: parsePricingActionLabel(actionCall.raw),
    tier: parseTierLabel(tierCall.raw),
    strategy_raw: actionCall.raw,
    tier_raw: tierCall.raw
  };
  const rawResponse = [
    "【定价动作】",
    actionCall.raw,
    "",
    "【相对档位】",
    tierCall.raw,
    "",
    "【最终价格】",
    priceCall.raw
  ].join("\n");
  return {
    stage: "D5_pricing_action_persona",
    prompt: prompts.first,
    prompt_sha256: sha256([prompts.first, prompts.second, prompts.third].join("\n---\n")),
    raw_response: rawResponse,
    parsed,
    attempts: 3,
    status: "OK",
    error: "",
    chat_messages: [
      { role: "user", content: prompts.first },
      { role: "assistant", content: actionCall.raw },
      { role: "user", content: prompts.second },
      { role: "assistant", content: tierCall.raw },
      { role: "user", content: prompts.third },
      { role: "assistant", content: priceCall.raw }
    ]
  };
}

function updateFinalStack(sourceRow, d4Parsed, d5Parsed, materials) {
  const stack = Array.isArray(sourceRow.final_stack) ? clone(sourceRow.final_stack) : [];
  const filtered = stack.filter((item) => !["D4", "D5"].includes(item.point));
  filtered.push({
    point: "D4",
    summary: `选卡${d4Parsed.cards.length}张[${renderCardsByGroup(d4Parsed.cards, materials)}]；选卡备注=${d4Parsed.cost_stance?.text || ""}；界面备注=${(d4Parsed.updated_constraints || []).map((item) => item.text).join("；")}`
  });
  filtered.push({
    point: "D5",
    summary: `定价=${d5Parsed.aligned_price}；动作=${d5Parsed.strategy_tier_chat?.pricing_action || ""}；档位=${d5Parsed.strategy_tier_chat?.tier || ""}；理由=${d5Parsed.reasoning || ""}`
  });
  return filtered;
}

async function runRow({ sourceArtifact, sourceFilePath, fileName, index, chatCompletion, materials, callsPath, chainsDir, d4Mode, armId, runId }) {
  const sourceRow = sourceArtifact.row || sourceArtifact;
  const row = clone(sourceRow);
  row.run_id = runId;
  row.arm_id = armId;
  row.status = "RUNNING";
  row.error = "";
  row.source_chain_file = path.relative(ROOT, sourceFilePath);
  row.d4_persona_d5_pricing_action = {
    source_run_id: sourceRow.run_id,
    source_arm_id: sourceRow.arm_id || "",
    d4: d4Mode === D4_MODE_PERCEPTION_SATISFICE
      ? "six functional areas; persona perception scan + satisficing choice per area; deterministic indexer JSON"
      : d4Mode === D4_MODE_ROLEPLAY_UPTAKE
        ? "six functional areas; implicit persona uptake roleplay per area; deterministic indexer JSON"
        : "six functional areas; persona first-person raw answer then deterministic indexer JSON",
    d4_mode: d4Mode,
    d5: "pricing-action-persona three-turn chat",
    temperature_persona: TEMPERATURE_PERSONA,
    temperature_indexer: TEMPERATURE_INDEXER
  };
  try {
    const d4Result = await runD4PersonaDimensions(chatCompletion, callsPath, sourceRow, materials, { d4Mode });
    row.r2.d4 = {
      prompt: d4Result.prompt,
      prompt_sha256: d4Result.prompt_sha256,
      raw_response: d4Result.raw_response,
      parsed: d4Result.parsed,
      attempts: d4Result.attempts,
      status: "OK",
      error: ""
    };
    row.r2.d4_persona_dimension = d4Result.dimension_detail;
    const d5Call = await runPricingActionPersonaD5(chatCompletion, callsPath, sourceRow, d4Result.parsed, materials);
    row.r2.d5 = d5Call;
    row.r2.calculate = await FullGame.calculateR2(row, materials);
    row.final_stack = updateFinalStack(sourceRow, d4Result.parsed, d5Call.parsed, materials);
    row.status = "OK";
  } catch (error) {
    row.status = "FAIL";
    row.error = String(error?.stack || error?.message || error);
  }
  writeJson(path.join(chainsDir, fileName), {
    chain_key: `${row.persona_id}_${row.condition}${row.rep || 1}`,
    persona_id: row.persona_id,
    condition: row.condition,
    archetype: sourceArtifact.archetype || row.persona_pool_record?.archetype || "",
    source_chain_file: path.relative(ROOT, sourceFilePath),
    row
  });
  console.error(`[${armId}] ${index + 1} ${row.persona_id} ${row.status} cards=${cardsOf(row).length || ""} action=${row.r2?.d5?.parsed?.strategy_tier_chat?.pricing_action || ""} tier=${row.r2?.d5?.parsed?.strategy_tier_chat?.tier || ""} price=${priceOf(row) || ""} profit=${Number.isFinite(profitOf(row)) ? Math.round(profitOf(row)) : ""} error=${row.error ? String(row.error).split("\n")[0] : ""}`);
  return row;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const armId = armIdForMode(args.d4Mode);
  const runId = runIdForMode(args.d4Mode);
  loadLocalEnv();
  const deepseek = require("../../server/llm/deepseekClient");
  if (!deepseek.hasAnyKey()) throw new Error("missing API key for D4 persona + D5 pricing-action-persona pilot");
  if (!fs.existsSync(args.sourceDir)) throw new Error(`missing source dir: ${args.sourceDir}`);
  if (fs.existsSync(args.outDir) && !args.overwrite) {
    throw new Error(`output dir already exists; pass --overwrite to replace files: ${args.outDir}`);
  }
  fs.mkdirSync(args.outDir, { recursive: true });
  const chainsDir = path.join(args.outDir, "chains");
  fs.mkdirSync(chainsDir, { recursive: true });
  const callsPath = path.join(args.outDir, "calls.jsonl");
  fs.writeFileSync(callsPath, "", "utf8");

  const materials = FullGame.loadMaterials();
  const files = fs.readdirSync(args.sourceDir)
    .filter((name) => /_S1\.json$/u.test(name))
    .sort()
    .slice(0, args.limit);
  if (!files.length) throw new Error(`no S chain files in ${args.sourceDir}`);

  const { default: pLimit } = await import("p-limit");
  const limit = pLimit(args.concurrency);
  const startedAt = new Date().toISOString();
  const startedMs = Date.now();
  const rows = new Array(files.length);
  const sourceRows = new Array(files.length);

  await Promise.all(files.map((fileName, index) => limit(async () => {
    const sourceFilePath = path.join(args.sourceDir, fileName);
    const sourceArtifact = loadJson(sourceFilePath);
    sourceRows[index] = sourceArtifact.row || sourceArtifact;
    rows[index] = await runRow({
      sourceArtifact,
      sourceFilePath,
      fileName,
      index,
      chatCompletion: deepseek.chatCompletion,
      materials,
      callsPath,
      chainsDir,
      d4Mode: args.d4Mode,
      armId,
      runId
    });
  })));

  const finishedAt = new Date().toISOString();
  const summary = {
    arm_id: armId,
    run_id: runId,
    started_at: startedAt,
    finished_at: finishedAt,
    wall_clock_ms: Date.now() - startedMs,
    source_dir: path.relative(ROOT, args.sourceDir),
    limit: args.limit,
    concurrency: args.concurrency,
    provider: "qwen-ai-platform",
    model: "deepseek-v4-flash-0731",
    enable_thinking: false,
    d4_manipulation: {
      output_form: args.d4Mode === D4_MODE_PERCEPTION_SATISFICE
        ? "six functional areas; persona perception scan then satisficing choice per area; indexer translates each area to JSON; global repair only if compatibility fails"
        : args.d4Mode === D4_MODE_ROLEPLAY_UPTAKE
          ? "six functional areas; implicit persona uptake roleplay per area; no explicit perception variables; indexer translates each area to JSON; global repair only if compatibility fails"
          : "six functional areas; persona first-person natural answer per area; indexer translates each area to JSON; global repair only if compatibility fails",
      d4_mode: args.d4Mode,
      temperature_persona: TEMPERATURE_PERSONA,
      temperature_indexer: TEMPERATURE_INDEXER
    },
    d5_manipulation: {
      output_form: "pricing-action-persona three-turn chat; explicit persona voice/style reminder on each turn",
      prompt_numeric_policy: "no artificial price bands or step size; only existing interface slider boundary 1000-6000 is stated"
    },
    pilot_summary: summarize(rows),
    source_roleplay_first_same_rows: summarize(sourceRows)
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
