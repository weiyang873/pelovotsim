"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const ROOT = path.join(__dirname, "..", "..");
const DEFAULT_SOURCE_DIR = path.join(ROOT, "runs_v4flash_0731", "roleplay_first_pilot_42S", "chains");
const DEFAULT_OUT_DIR = path.join(ROOT, "runs_v4flash_0731", "d5_price_range_chat_on_roleplay42S");
const TEMPERATURE = 1.0;

function parseArgs(argv) {
  const args = {
    sourceDir: DEFAULT_SOURCE_DIR,
    outDir: DEFAULT_OUT_DIR,
    limit: 42,
    concurrency: 6,
    mode: "range",
    overwrite: false
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--source-dir") args.sourceDir = path.resolve(ROOT, String(argv[++index] || "").trim());
    else if (arg === "--out-dir") args.outDir = path.resolve(ROOT, String(argv[++index] || "").trim());
    else if (arg === "--limit") args.limit = Number(argv[++index]);
    else if (arg === "--concurrency") args.concurrency = Number(argv[++index]);
    else if (arg === "--mode") args.mode = String(argv[++index] || "").trim();
    else if (arg === "--overwrite") args.overwrite = true;
    else throw new Error(`unknown argument: ${arg}`);
  }
  if (!Number.isInteger(args.limit) || args.limit < 1) throw new Error("--limit must be a positive integer");
  if (!Number.isInteger(args.concurrency) || args.concurrency < 1) throw new Error("--concurrency must be a positive integer");
  if (!["range", "strategy-tier", "pricing-action", "pricing-action-persona"].includes(args.mode)) {
    throw new Error("--mode must be range, strategy-tier, pricing-action, or pricing-action-persona");
  }
  return args;
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

function sha256(value) {
  return crypto.createHash("sha256").update(String(value || "")).digest("hex");
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function truncate(text, max) {
  const value = String(text || "");
  return value.length > max ? `${value.slice(0, max - 1)}...` : value;
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

function buildD5PriceRangeChatPrompt(sourceRow) {
  const originalPrompt = String(sourceRow.r2?.d5?.prompt || "");
  return [
    stripD5JsonContract(originalPrompt),
    "",
    "【输出方式变更：价格区间 chat，不填 JSON】",
    "现在你就在产品售价滑块前做最后定价。请像真实课堂参与者一样，把你在滑块前的犹豫说出来。",
    "界面真实可提交边界仍是 1000 到 6000；这是控件边界，不代表建议价、合理价、市场价或锚定价格。",
    "不要使用固定步长，也不要把上下限或中点当默认答案。",
    "先说你自己会在哪个价格范围里犹豫；这个范围由你根据界面信息、已选能力、成本压力、渠道抽成、用户接受度和前面提交内容自己判断。",
    "再说如果往低一点调，你担心什么；如果往高一点调，你担心什么。",
    "最后单独写一行：最终价格：<一个整数>元",
    "不要输出 JSON，不要 Markdown 表格。"
  ].join("\n");
}

function parsePriceRange(raw) {
  const text = String(raw || "");
  const finalMatches = [...text.matchAll(/(?:最终价格|最终定价)\s*[：:]?\s*(\d{3,5})\s*元?/gu)].map((match) => Number(match[1]));
  const finalPrice = finalMatches.length ? finalMatches[finalMatches.length - 1] : null;
  if (!Number.isFinite(finalPrice) || finalPrice < 1000 || finalPrice > 6000) {
    throw new Error("no valid final price within slider bounds");
  }
  const beforeFinal = text.split(/最终价格|最终定价/u)[0] || text;
  const rangeMatches = [...beforeFinal.matchAll(/(\d{3,5})\s*(?:-|–|—|到|至|~|～)\s*(\d{3,5})\s*元?/gu)]
    .map((match) => [Number(match[1]), Number(match[2])])
    .filter(([lo, hi]) => Number.isFinite(lo) && Number.isFinite(hi) && lo >= 1000 && hi <= 6000 && lo <= hi);
  const range = rangeMatches.length ? rangeMatches[rangeMatches.length - 1] : null;
  return {
    price: finalPrice,
    aligned_price: Math.max(1000, Math.min(6000, Math.round(finalPrice / 100) * 100)),
    basis: {
      text: truncate(text.replace(/\s+/g, " ").trim(), 600),
      source: "承前:D4"
    },
    reasoning: truncate(text, 1200),
    price_range_chat: range
      ? { low: range[0], high: range[1] }
      : { low: null, high: null }
  };
}

async function callWithParse(chatCompletion, prompt) {
  let lastError = "";
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const startedAt = Date.now();
    try {
      const raw = String(await chatCompletion([
        { role: "user", content: prompt }
      ], {
        role: "chat_service",
        temperature: TEMPERATURE,
        max_tokens: 1200,
        maxRetries: 1
      })).trim();
      const parsed = parsePriceRange(raw);
      return {
        status: "OK",
        attempts: attempt,
        latency_ms: Date.now() - startedAt,
        prompt,
        prompt_sha256: sha256(prompt),
        raw_response: raw,
        parsed
      };
    } catch (error) {
      lastError = String(error?.message || error);
      if (attempt === 3) break;
    }
  }
  return {
    status: "FAIL",
    attempts: 3,
    latency_ms: null,
    prompt,
    prompt_sha256: sha256(prompt),
    raw_response: "",
    parsed: null,
    error: lastError
  };
}

function parseStrategyLabel(raw) {
  const explicit = findLastLabeledLine(raw, /^价位策略\s*[：:]\s*(差异化|成本领先)\s*$/u);
  if (explicit === "成本领先") return "cost_leadership";
  if (explicit === "差异化") return "differentiation";
  const text = String(raw || "");
  if (/成本领先/u.test(text)) return "cost_leadership";
  if (/差异化/u.test(text)) return "differentiation";
  if (/折中|平衡/u.test(text)) return "hybrid_or_ambiguous";
  return "";
}

function findLastLabeledLine(raw, regexp) {
  const lines = String(raw || "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const match = lines[index].match(regexp);
    if (match) return match[1].trim();
  }
  return "";
}

function parseTierLabel(raw) {
  const explicit = findLastLabeledLine(raw, /^相对档位\s*[：:]\s*(中高|中低|高|中|低)\s*$/u);
  if (explicit === "高" || explicit === "中高") return "high";
  if (explicit === "低" || explicit === "中低") return "low";
  if (explicit === "中") return "mid";
  const text = String(raw || "");
  if (/高档|高位|偏高|高价|相对档位\s*[：:]\s*高/u.test(text)) return "high";
  if (/低档|低位|偏低|低价|相对档位\s*[：:]\s*低/u.test(text)) return "low";
  if (/中档|中位|适中|中等|相对档位\s*[：:]\s*中/u.test(text)) return "mid";
  return "";
}

function parsePricingActionLabel(raw) {
  const explicit = findLastLabeledLine(raw, /^定价动作\s*[：:]\s*(压低售价抢量|抬高售价守毛利)\s*$/u);
  if (explicit === "压低售价抢量") return "lower_price_for_volume";
  if (explicit === "抬高售价守毛利") return "higher_price_for_margin";
  const text = String(raw || "");
  if (/定价动作\s*[：:]\s*压低售价抢量/u.test(text)) return "lower_price_for_volume";
  if (/定价动作\s*[：:]\s*抬高售价守毛利/u.test(text)) return "higher_price_for_margin";
  if (/(?:我选|选择|选)\s*A/u.test(text)) return "lower_price_for_volume";
  if (/(?:我选|选择|选)\s*B/u.test(text)) return "higher_price_for_margin";
  if (/压低售价抢量|抢量|低价换量/u.test(text)) return "lower_price_for_volume";
  if (/抬高售价守毛利|守毛利|保护毛利|高价守毛利/u.test(text)) return "higher_price_for_margin";
  return "";
}

function buildStrategyTierPrompts(sourceRow) {
  const context = stripD5JsonContract(String(sourceRow.r2?.d5?.prompt || ""));
  const first = [
    context,
    "",
    "【输出方式变更：分步定价 chat，不填 JSON】",
    "现在你就在产品售价滑块前做最后定价。请像真实课堂参与者一样，先判断价位策略。",
    "第一问：这个 AI 宠物/机器人当前应该采用差异化价位策略，还是成本领先价位策略？",
    "只能在“差异化”和“成本领先”里选一个；如果心里有摇摆，也要先选你此刻会采用的那个。",
    "不要给具体价格。",
    "最后单独写一行：价位策略：差异化 或 价位策略：成本领先",
    "不要输出 JSON，不要 Markdown 表格。"
  ].join("\n");
  const second = [
    "第二问：承接你刚才选择的价位策略，在界面的产品售价滑块上，你会把它放在相对高档、中档、还是低档？",
    "高/中/低只是滑块相对位置，不给固定数值段，也不代表建议价或锚点。",
    "仍然不要给具体价格。",
    "最后单独写一行：相对档位：高 或 相对档位：中 或 相对档位：低",
    "不要输出 JSON，不要 Markdown 表格。"
  ].join("\n");
  const third = [
    "第三问：现在请在这个相对档位里提交一个最终价格。",
    "界面真实可提交边界仍是 1000 到 6000；这是控件边界，不代表建议价、合理价、市场价或锚定价格。",
    "不要使用固定步长，也不要把上下限或中点当默认答案。",
    "像真实参与者一样说一句你为什么最后落在这个数字。",
    "最后单独写一行：最终价格：<一个整数>元",
    "不要输出 JSON，不要 Markdown 表格。"
  ].join("\n");
  return { first, second, third };
}

function buildPricingActionPrompts(sourceRow, options = {}) {
  const context = stripD5JsonContract(String(sourceRow.r2?.d5?.prompt || ""));
  const styleReminder = options.personaStyleReminder
    ? "请继续用上面这位课堂参与者的第一人称口吻和表达风格回答。"
    : "";
  const first = [
    context,
    "",
    "【输出方式变更：分步定价 chat，不填 JSON】",
    styleReminder,
    "现在你就在产品售价滑块前做最后定价。请像真实课堂参与者一样，先判断自己此刻更像哪种定价动作。",
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

async function callThreeTurnPricingChat(chatCompletion, sourceRow, mode) {
  const isPricingAction = mode === "pricing-action" || mode === "pricing-action-persona";
  const prompts = isPricingAction
    ? buildPricingActionPrompts(sourceRow, { personaStyleReminder: mode === "pricing-action-persona" })
    : buildStrategyTierPrompts(sourceRow);
  let lastError = "";
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const startedAt = Date.now();
    const messages = [{ role: "user", content: prompts.first }];
    try {
      const strategyRaw = String(await chatCompletion(messages, {
        role: "chat_service",
        temperature: TEMPERATURE,
        max_tokens: 700,
        maxRetries: 1
      })).trim();
      messages.push({ role: "assistant", content: strategyRaw });
      messages.push({ role: "user", content: prompts.second });
      const tierRaw = String(await chatCompletion(messages, {
        role: "chat_service",
        temperature: TEMPERATURE,
        max_tokens: 700,
        maxRetries: 1
      })).trim();
      messages.push({ role: "assistant", content: tierRaw });
      messages.push({ role: "user", content: prompts.third });
      const priceRaw = String(await chatCompletion(messages, {
        role: "chat_service",
        temperature: TEMPERATURE,
        max_tokens: 900,
        maxRetries: 1
      })).trim();
      const combinedRaw = [
        "【价位策略】",
        strategyRaw,
        "",
        "【相对档位】",
        tierRaw,
        "",
        "【最终价格】",
        priceRaw
      ].join("\n");
      const parsed = parsePriceRange(priceRaw);
      parsed.strategy_tier_chat = {
        strategy: isPricingAction ? "" : parseStrategyLabel(strategyRaw),
        pricing_action: isPricingAction ? parsePricingActionLabel(strategyRaw) : "",
        tier: parseTierLabel(tierRaw),
        strategy_raw: strategyRaw,
        tier_raw: tierRaw
      };
      return {
        status: "OK",
        attempts: attempt,
        latency_ms: Date.now() - startedAt,
        prompt: prompts.first,
        prompt_sha256: sha256([prompts.first, prompts.second, prompts.third].join("\n---\n")),
        raw_response: combinedRaw,
        parsed,
        chat_messages: [
          { role: "user", content: prompts.first },
          { role: "assistant", content: strategyRaw },
          { role: "user", content: prompts.second },
          { role: "assistant", content: tierRaw },
          { role: "user", content: prompts.third },
          { role: "assistant", content: priceRaw }
        ]
      };
    } catch (error) {
      lastError = String(error?.message || error);
      if (attempt === 3) break;
    }
  }
  return {
    status: "FAIL",
    attempts: 3,
    latency_ms: null,
    prompt: prompts.first,
    prompt_sha256: sha256([prompts.first, prompts.second, prompts.third].join("\n---\n")),
    raw_response: "",
    parsed: null,
    error: lastError,
    chat_messages: []
  };
}

function percentile(values, pct) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const pos = (sorted.length - 1) * pct;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return lo === hi ? sorted[lo] : sorted[lo] + ((sorted[hi] - sorted[lo]) * (pos - lo));
}

function mean(values) {
  const valid = values.filter(Number.isFinite);
  return valid.length ? valid.reduce((sum, value) => sum + value, 0) / valid.length : null;
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
    share: Number(output.share),
    range_low: row.r2?.d5?.parsed?.price_range_chat?.low ?? null,
    range_high: row.r2?.d5?.parsed?.price_range_chat?.high ?? null,
    strategy: row.r2?.d5?.parsed?.strategy_tier_chat?.strategy ?? "",
    pricing_action: row.r2?.d5?.parsed?.strategy_tier_chat?.pricing_action ?? "",
    tier: row.r2?.d5?.parsed?.strategy_tier_chat?.tier ?? ""
  };
}

function summarize(rows) {
  const ok = rows.filter((row) => row.status === "OK");
  const metrics = ok.map(rowMetrics);
  const prices = metrics.map((item) => item.price).filter(Number.isFinite);
  const profits = metrics.map((item) => item.profit).filter(Number.isFinite);
  const cards = metrics.map((item) => item.cards).filter(Number.isFinite);
  const losses = metrics.filter((item) => item.loss === true).length;
  const priceFreq = {};
  for (const price of prices) priceFreq[String(price)] = (priceFreq[String(price)] || 0) + 1;
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
    price_frequency: Object.fromEntries(Object.entries(priceFreq).sort((a, b) => Number(a[0]) - Number(b[0]))),
    metrics
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  loadLocalEnv();
  const FullGame = require("./full_game_all_personas");
  const deepseek = require("../../server/llm/deepseekClient");
  if (!deepseek.hasAnyKey()) throw new Error("missing API key for d5 price range chat pilot");
  const armId = args.mode === "strategy-tier"
    ? "d5_strategy_tier_chat_on_roleplay42S"
    : args.mode === "pricing-action-persona"
      ? "d5_pricing_action_persona_chat_on_roleplay42S"
    : args.mode === "pricing-action"
      ? "d5_pricing_action_chat_on_roleplay42S"
    : "d5_price_range_chat_on_roleplay42S";
  const runId = args.mode === "strategy-tier"
    ? "v4flash_0731_d5_strategy_tier_chat_on_roleplay42S"
    : args.mode === "pricing-action-persona"
      ? "v4flash_0731_d5_pricing_action_persona_chat_on_roleplay42S"
    : args.mode === "pricing-action"
      ? "v4flash_0731_d5_pricing_action_chat_on_roleplay42S"
    : "v4flash_0731_d5_price_range_chat_on_roleplay42S";

  const { default: pLimit } = await import("p-limit");
  if (!fs.existsSync(args.sourceDir)) throw new Error(`missing source dir: ${args.sourceDir}`);
  if (fs.existsSync(args.outDir) && !args.overwrite) {
    throw new Error(`output dir already exists; pass --overwrite to replace files: ${args.outDir}`);
  }
  fs.mkdirSync(args.outDir, { recursive: true });
  const chainsDir = path.join(args.outDir, "chains");
  fs.mkdirSync(chainsDir, { recursive: true });
  const callsPath = path.join(args.outDir, "d5_calls.jsonl");
  fs.writeFileSync(callsPath, "", "utf8");

  const materials = FullGame.loadMaterials();
  const files = fs.readdirSync(args.sourceDir)
    .filter((name) => /_S1\.json$/u.test(name))
    .sort()
    .slice(0, args.limit);
  if (!files.length) throw new Error(`no S chain files in ${args.sourceDir}`);

  const startedAt = new Date().toISOString();
  const rows = new Array(files.length);
  const sourceMetrics = [];
  const limit = pLimit(args.concurrency);
  await Promise.all(files.map((fileName, index) => limit(async () => {
    const sourceArtifact = loadJson(path.join(args.sourceDir, fileName));
    const sourceRow = sourceArtifact.row || sourceArtifact;
    sourceMetrics[index] = rowMetrics(sourceRow);
    const row = clone(sourceRow);
    row.run_id = runId;
    row.arm_id = armId;
    row.status = "RUNNING";
    row.d5_price_range_chat = {
      source_run_id: sourceRow.run_id,
      source_arm_id: sourceRow.arm_id || "",
      source_chain_file: path.relative(ROOT, path.join(args.sourceDir, fileName)),
      mode: args.mode,
      temperature: TEMPERATURE
    };
    const prompt = buildD5PriceRangeChatPrompt(sourceRow);
    const d5Call = args.mode === "strategy-tier"
      ? await callThreeTurnPricingChat(deepseek.chatCompletion, sourceRow, args.mode)
      : args.mode === "pricing-action" || args.mode === "pricing-action-persona"
        ? await callThreeTurnPricingChat(deepseek.chatCompletion, sourceRow, args.mode)
      : await callWithParse(deepseek.chatCompletion, prompt);
    appendJsonl(callsPath, {
      ts: new Date().toISOString(),
      persona_id: row.persona_id,
      source_file: fileName,
      mode: args.mode,
      status: d5Call.status,
      attempts: d5Call.attempts,
      latency_ms: d5Call.latency_ms,
      price: d5Call.parsed?.aligned_price ?? null,
      range_low: d5Call.parsed?.price_range_chat?.low ?? null,
      range_high: d5Call.parsed?.price_range_chat?.high ?? null,
      strategy: d5Call.parsed?.strategy_tier_chat?.strategy ?? "",
      pricing_action: d5Call.parsed?.strategy_tier_chat?.pricing_action ?? "",
      tier: d5Call.parsed?.strategy_tier_chat?.tier ?? "",
      error: d5Call.error || ""
    });
    row.r2.d5 = d5Call;
    if (d5Call.status !== "OK") {
      row.status = "FAIL";
      row.error = `D5 price range chat failed: ${d5Call.error}`;
    } else {
      row.r2.calculate = await FullGame.calculateR2(row, materials);
      row.status = "OK";
      row.error = "";
    }
    rows[index] = row;
    writeJson(path.join(chainsDir, fileName), {
      chain_key: `${row.persona_id}_${row.condition}1`,
      persona_id: row.persona_id,
      condition: row.condition,
      archetype: sourceArtifact.archetype || row.persona_pool_record?.archetype || "",
      source_chain_file: path.relative(ROOT, path.join(args.sourceDir, fileName)),
      row
    });
    console.error(`[${armId}] ${index + 1}/${files.length} ${row.persona_id} ${row.status} strategy=${row.r2?.d5?.parsed?.strategy_tier_chat?.strategy ?? ""} action=${row.r2?.d5?.parsed?.strategy_tier_chat?.pricing_action ?? ""} tier=${row.r2?.d5?.parsed?.strategy_tier_chat?.tier ?? ""} price=${row.r2?.d5?.parsed?.aligned_price ?? ""} profit=${row.r2?.calculate?.output?.profit ?? ""} error=${row.error || ""}`);
  })));

  const finishedAt = new Date().toISOString();
  const summary = {
    arm_id: armId,
    run_id: runId,
    started_at: startedAt,
    finished_at: finishedAt,
    source_dir: path.relative(ROOT, args.sourceDir),
    limit: args.limit,
    concurrency: args.concurrency,
    mode: args.mode,
    temperature: TEMPERATURE,
    d5_manipulation: {
      scope: "D5 only; R1/D3/D4/source evidence kept from roleplay_first_pilot_42S",
      output_form: args.mode === "strategy-tier"
        ? "three-turn chat: pricing strategy -> relative high/mid/low tier -> final price line"
        : args.mode === "pricing-action-persona"
          ? "three-turn chat: lower-price-for-volume vs higher-price-for-margin -> relative high/mid/low tier -> final price line; explicit persona voice/style reminder on each turn"
        : args.mode === "pricing-action"
          ? "three-turn chat: lower-price-for-volume vs higher-price-for-margin -> relative high/mid/low tier -> final price line"
        : "natural price-range chat, then final price line",
      prompt_numeric_policy: "no artificial price bands or step size; only existing interface slider boundary 1000-6000 is stated"
    },
    pilot_summary: summarize(rows),
    source_roleplay_first_same_rows: summarize(sourceMetrics.map((metric, index) => ({
      status: metric.status,
      persona_id: metric.persona_id,
      condition: metric.condition,
      r2: {
        d4: { parsed: { cards: Array(Number(metric.cards || 0)).fill({ id: "x", tier: "low" }) } },
        d5: { parsed: { aligned_price: metric.price, price: metric.price } },
        calculate: { output: { profit: metric.profit, share: metric.share, units: metric.units }, metrics: { profit: metric.profit, cost: metric.cost, Q: metric.units } }
      }
    })))
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
