"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const Module = require("node:module");
const { spawnSync } = require("node:child_process");

const ROOT = path.join(__dirname, "..", "..");
const SOURCE_RUN_ID = process.env.FORMAL_CHAT_SOURCE_RUN_ID || "formal_v3_2026-07-16";
const RUN_ID = process.env.FORMAL_CHAT_RUN_ID || "formal_v3_chat_format_paired_2026-07-29";
const SOURCE_JSONL = path.join(__dirname, `${SOURCE_RUN_ID}.jsonl`);
const SOURCE_SUMMARY = path.join(__dirname, `${SOURCE_RUN_ID}_summary.md`);
const LLM_MODEL = process.env.FORMAL_CHAT_MODEL || "deepseek-v4-flash";
const ARM_LABEL = process.env.FORMAL_CHAT_ARM_LABEL || "paired chat D4/D5";
const MANIPULATED_FACTOR = process.env.FORMAL_CHAT_MANIPULATED_FACTOR || "D4/D5 response format only";
const TEMPERATURE = Number(process.env.FORMAL_CHAT_TEMPERATURE || "0.55");
const MAX_REPAIRS = Math.max(0, parseInt(process.env.FORMAL_CHAT_MAX_REPAIRS || "2", 10));
const MAX_ATTEMPTS = MAX_REPAIRS + 1;
const TIMEOUT_MS = Math.max(1, parseInt(process.env.FORMAL_CHAT_TIMEOUT_MS || "120000", 10));
const PERSONA_ORDER = ["A", "D", "E", "B", "F", "C", "G"];
const CONDITIONS = ["Q", "S"];
const REPS = [1, 2, 3];
const TIER_CN_TO_ENGINE = { "低": "low", "中": "mid", "高": "high", low: "low", mid: "mid", high: "high" };

function outputPaths(runId = RUN_ID) {
  return {
    jsonl: path.join(__dirname, `${runId}.jsonl`),
    auditJsonl: path.join(__dirname, `${runId}_call_audit.jsonl`),
    failuresJsonl: path.join(__dirname, `${runId}_failures.jsonl`),
    rowMetricsCsv: path.join(__dirname, `${runId}_row_metrics.csv`),
    replayCsv: path.join(__dirname, `${runId}_formal_replay.csv`),
    summary: path.join(__dirname, `${runId}_summary.md`),
    meta: path.join(__dirname, `${runId}_meta.json`)
  };
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function fileSha256(filePath) {
  return sha256(fs.readFileSync(filePath));
}

function git(args) {
  const result = spawnSync("git", args, { cwd: ROOT, encoding: "utf8" });
  return result.status === 0 ? result.stdout.trim() : "";
}

function loadJsonl(filePath) {
  if (!fs.existsSync(filePath)) return [];
  const text = fs.readFileSync(filePath, "utf8").trim();
  return text ? text.split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line)) : [];
}

function appendJsonl(filePath, row) {
  fs.appendFileSync(filePath, `${JSON.stringify(row)}\n`, "utf8");
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function csvCell(value) {
  const text = String(value == null ? "" : typeof value === "object" ? JSON.stringify(value) : value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, "\"\"")}"` : text;
}

function writeCsv(filePath, rows, columns) {
  fs.writeFileSync(filePath, `${[columns.join(","), ...rows.map((row) => columns.map((column) => csvCell(row[column])).join(","))].join("\n")}\n`, "utf8");
}

function round(value, digits = 6) {
  const num = Number(value);
  if (!Number.isFinite(num)) return null;
  const scale = 10 ** digits;
  return Math.round(num * scale) / scale;
}

function mean(values) {
  const nums = values.map(Number).filter(Number.isFinite);
  return nums.length ? nums.reduce((sum, value) => sum + value, 0) / nums.length : null;
}

function sd(values) {
  const nums = values.map(Number).filter(Number.isFinite);
  const avg = mean(nums);
  return nums.length && avg != null ? Math.sqrt(nums.reduce((sum, value) => sum + (value - avg) ** 2, 0) / nums.length) : null;
}

function pct(value) {
  const num = Number(value || 0);
  return `${round(num * 100, 2)}%`;
}

function parseArgs(argv) {
  const args = { mode: "replay", runId: RUN_ID, limit: 42, chainKey: "", summarizeOnly: false, force: false, onePerPersona: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--mode") args.mode = String(argv[++index] || "").trim();
    else if (arg === "--run-id") args.runId = String(argv[++index] || "").trim();
    else if (arg === "--limit") args.limit = Number(argv[++index]);
    else if (arg === "--chain-key") args.chainKey = String(argv[++index] || "").trim();
    else if (arg === "--summarize-only") args.summarizeOnly = true;
    else if (arg === "--force") args.force = true;
    else if (arg === "--one-per-persona") args.onePerPersona = true;
    else throw new Error(`unknown argument: ${arg}`);
  }
  if (!new Set(["replay", "chat", "satisfice", "dimension", "summarize"]).has(args.mode)) throw new Error(`invalid mode: ${args.mode}`);
  if (!Number.isInteger(args.limit) || args.limit < 1 || args.limit > 42) throw new Error("limit must be 1..42");
  return args;
}

function ensureModuleResolution() {
  const commonDir = git(["rev-parse", "--git-common-dir"]);
  const candidate = commonDir ? path.join(path.dirname(path.resolve(ROOT, commonDir)), "node_modules") : "";
  const current = String(process.env.NODE_PATH || "").split(path.delimiter).filter(Boolean);
  const next = [...new Set([...current, candidate].filter((item) => item && fs.existsSync(item)))];
  process.env.NODE_PATH = next.join(path.delimiter);
  Module._initPaths();
  if (!process.env.HF_DISABLE_REMOTE) process.env.HF_DISABLE_REMOTE = "1";
}

function loadLocalEnv() {
  const candidates = [
    String(process.env.CODEX_ENV_PATH || "").trim(),
    path.join(ROOT, ".env"),
    "/Users/weiyang/Dropbox/Github_indiswyang/try/emba-ai-sim-v01/.env"
  ].filter(Boolean);
  const loaded = [];
  let envPath = "";
  for (const candidate of candidates) {
    if (!fs.existsSync(candidate)) continue;
    envPath = candidate;
    for (const line of fs.readFileSync(candidate, "utf8").split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const splitAt = trimmed.indexOf("=");
      if (splitAt <= 0) continue;
      const key = trimmed.slice(0, splitAt).trim();
      let value = trimmed.slice(splitAt + 1).trim();
      if ((value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
      if (!Object.prototype.hasOwnProperty.call(process.env, key)) {
        process.env[key] = value;
        loaded.push(key);
      }
    }
    break;
  }
  process.env.DEEPSEEK_MODEL = LLM_MODEL;
  return {
    path: envPath ? path.relative(ROOT, envPath) : "",
    loaded_keys: loaded.sort(),
    key_count: Object.keys(process.env).filter((key) => /^DEEPSEEK_API_KEY(_\d+)?$/.test(key) && String(process.env[key] || "").trim()).length
  };
}

function chainKey(row) {
  return `${row.persona_id}|${row.condition}|${Number(row.rep || 1)}`;
}

function orderedSourceRows() {
  const latest = new Map();
  for (const row of loadJsonl(SOURCE_JSONL).filter((item) => item.run_id === SOURCE_RUN_ID && item.status === "OK")) {
    latest.set(chainKey(row), row);
  }
  const rows = [];
  for (const personaId of PERSONA_ORDER) {
    for (const condition of CONDITIONS) {
      for (const rep of REPS) {
        const row = latest.get(`${personaId}|${condition}|${rep}`);
        if (!row) throw new Error(`missing source row ${personaId}|${condition}|${rep}`);
        rows.push(row);
      }
    }
  }
  return rows;
}

function profitOf(row) {
  return Number(row?.r2?.calculate?.metrics?.profit ?? row?.r2?.calculate?.output?.profit ?? row?.chat_engine?.metrics?.profit);
}

function priceOf(row) {
  return Number(row?.r2?.d5?.parsed?.aligned_price ?? row?.r2?.d5?.parsed?.price);
}

function cardsOf(row) {
  return row?.r2?.d4?.parsed?.cards || [];
}

function calcOutputOf(row) {
  return row?.r2?.calculate?.output || {};
}

function numOrNull(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function mechanismSnapshot(row) {
  const output = calcOutputOf(row);
  const cardCount = cardsOf(row).length;
  const coverCore = numOrNull(output.coverCore);
  const q = numOrNull(output.units);
  const breakeven = numOrNull(output.breakeven_q);
  const wtp = numOrNull(output.WTP);
  const price = priceOf(row);
  return {
    coverCore,
    coverNice: numOrNull(output.coverNice),
    coverage_efficiency: coverCore != null && cardCount ? coverCore / cardCount : null,
    Vscore: numOrNull(output.V),
    COGS: numOrNull(output.COGS),
    dCOGS: numOrNull(output.dCOGS),
    nre_total_wan: numOrNull(output.nre_total_wan),
    fixedCost: numOrNull(output.fixedCost),
    Q: q,
    breakeven_q: breakeven,
    q_to_breakeven: q != null && breakeven ? q / breakeven : null,
    actualGm: numOrNull(output.actualGm),
    price_wtp_ratio: Number.isFinite(price) && wtp ? price / wtp : null,
    WTP: wtp,
    unitMargin: numOrNull(output.unitMargin),
    double_squeeze: profitOf(row) < 0 && coverCore != null && coverCore < 0.6 && q != null && breakeven != null && q < breakeven ? 1 : 0
  };
}

function signatureOf(row) {
  return cardsOf(row).map((card) => `${card.id || card.card_id || card.cap_id}@${card.tier}`).sort().join("|");
}

function stats(rows) {
  const ok = rows.filter((row) => row.status === "OK");
  const prices = ok.map(priceOf).filter(Number.isFinite);
  const profits = ok.map(profitOf).filter(Number.isFinite);
  const counts = ok.map((row) => cardsOf(row).length).filter(Number.isFinite);
  return {
    n: ok.length,
    profitable: ok.filter((row) => profitOf(row) >= 0).length,
    losses: ok.filter((row) => profitOf(row) < 0).length,
    loss_rate: ok.length ? ok.filter((row) => profitOf(row) < 0).length / ok.length : null,
    profit_mean: mean(profits),
    price_mean: mean(prices),
    price_sd: sd(prices),
    price_min: prices.length ? Math.min(...prices) : null,
    price_max: prices.length ? Math.max(...prices) : null,
    cards_mean: mean(counts),
    cards_min: counts.length ? Math.min(...counts) : null,
    cards_max: counts.length ? Math.max(...counts) : null,
    unique_configs: new Set(ok.map(signatureOf)).size
  };
}

function mechanismStats(rows) {
  const ok = rows.filter((row) => row.status === "OK");
  const snapshots = ok.map(mechanismSnapshot);
  const value = (key) => snapshots.map((item) => item[key]).filter(Number.isFinite);
  return {
    coverCore: mean(value("coverCore")),
    coverNice: mean(value("coverNice")),
    coverage_efficiency: mean(value("coverage_efficiency")),
    COGS: mean(value("COGS")),
    dCOGS: mean(value("dCOGS")),
    nre_total_wan: mean(value("nre_total_wan")),
    fixedCost: mean(value("fixedCost")),
    q_to_breakeven: mean(value("q_to_breakeven")),
    price_wtp_ratio: mean(value("price_wtp_ratio")),
    actualGm: mean(value("actualGm")),
    double_squeeze: ok.length ? ok.filter((row) => mechanismSnapshot(row).double_squeeze).length : 0
  };
}

function sourceBaselineSnapshot(sourceRow) {
  return {
    price: priceOf(sourceRow),
    profit: profitOf(sourceRow),
    cards: cardsOf(sourceRow).length,
    signature: signatureOf(sourceRow),
    mechanism: mechanismSnapshot(sourceRow)
  };
}

function cardCatalog(materials) {
  const out = [];
  for (const group of materials.capabilityGroups.groups || []) {
    for (const cap of group.capabilities || []) {
      out.push({
        id: cap.cap_id,
        name: cap.name || cap.cap_id,
        group_id: group.group_id,
        group_name: group.name || group.group_id,
        tiers: new Set(Object.keys(cap.tiers || {}))
      });
    }
  }
  return out;
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

function truncate(text, max = 240) {
  const clean = String(text || "").replace(/\s+/g, " ").trim();
  return clean.length > max ? `${clean.slice(0, max)}...` : clean;
}

function stripD4JsonContract(prompt) {
  const markers = ["cost_stance.source 必须", "输出 JSON："];
  let cut = -1;
  for (const marker of markers) {
    const idx = prompt.indexOf(marker);
    if (idx >= 0 && (cut < 0 || idx < cut)) cut = idx;
  }
  const prefix = (cut >= 0 ? prompt.slice(0, cut) : prompt)
    .replace(/【输出契约】围绕你自己的问题，填好能力卡 JSON：/g, "【任务边界】围绕你自己的问题，做出能力卡选择：")
    .trim();
  return [
    prefix,
    "",
    "【输出方式变更：自然对话，不填 JSON】",
    "请像跟合伙人讨论一样说出你的最终能力卡选择、成本立场和新增约束。",
    "硬性约束仍完全相同：每张卡必须是真实 cap_id；tier 只能是 low/mid/high；每个维度至少 1 张；总数至少 6 张；兼容性必须合法。",
    "为了事后核对，请在回答最后单独写一行：",
    "最终选卡：cap_id@tier、cap_id@tier、...",
    "不要输出 JSON，不要 Markdown 表格。"
  ].join("\n");
}

function d4BasePrompt(prompt) {
  const markers = ["【输出契约】", "cost_stance.source 必须", "输出 JSON："];
  let cut = -1;
  for (const marker of markers) {
    const idx = String(prompt || "").indexOf(marker);
    if (idx >= 0 && (cut < 0 || idx < cut)) cut = idx;
  }
  return (cut >= 0 ? String(prompt || "").slice(0, cut) : String(prompt || "")).trim();
}

function d4ContextWithoutFullCards(prompt) {
  const text = String(prompt || "");
  const dimIdx = text.indexOf("\"dimension\"");
  if (dimIdx < 0) return d4BasePrompt(text);
  const cardPoolStart = text.lastIndexOf("[", dimIdx);
  if (cardPoolStart < 0) return d4BasePrompt(text);
  return text.slice(0, cardPoolStart).trim();
}

function d4QuestionBlock(prompt) {
  const text = String(prompt || "");
  const questionAt = text.indexOf("【你刚刚提出的问题】");
  if (questionAt < 0) return "";
  const outputAt = text.indexOf("【输出契约】", questionAt);
  return text.slice(questionAt, outputAt >= 0 ? outputAt : undefined).trim();
}

function renderDimensionGroup(group) {
  return JSON.stringify({
    dimension: group.name || group.group_id,
    group_id: group.group_id,
    dimension_description: group.description || group.dimension_description || "",
    cards: (group.capabilities || []).map((cap) => ({
      cap_id: cap.cap_id,
      name: cap.name || cap.cap_id,
      covers: cap.covers || [],
      dependencies: cap.dependencies || [],
      conflicts: cap.conflicts || [],
      nre: cap.nre,
      nre_desc: cap.nre_desc || "",
      tiers: Object.fromEntries(Object.entries(cap.tiers || {}).map(([tier, tierInfo]) => [tier, {
        dCOGS: tierInfo.dCOGS,
        risk: tierInfo.risk,
        sub_lift: tierInfo.sub_lift,
        load: tierInfo.load
      }]))
    }))
  }, null, 2);
}

function renderAlreadySelected(cards, materials) {
  if (!cards.length) return "尚未选择其他维度。";
  return renderCardsByGroup(cards, materials);
}

function buildDimensionD4Prompt(sourcePrompt, group, selectedSoFar, materials) {
  return [
    d4ContextWithoutFullCards(sourcePrompt),
    "",
    "【本轮只看一个功能维度】",
    `当前功能维度：${group.name || group.group_id}`,
    "请只判断这个维度：针对这个客户，这个维度里哪些功能是需要的？各需要什么档次？",
    "如果这个维度不是核心需求，也必须至少选 1 张最低必要卡，以满足完整方案的维度覆盖。",
    "不要从其他维度选卡；其他维度会在后续单独判断。",
    "",
    "【本维度可选能力卡】",
    renderDimensionGroup(group),
    "",
    "【已经选过的其他维度】",
    renderAlreadySelected(selectedSoFar, materials),
    "",
    "【兼容提示；来自 render manifest】依赖/冲突只使用本轮卡池中列出的 dependencies/conflicts 字段；最终会把六个维度合并后做全局兼容性校验。",
    "",
    d4QuestionBlock(sourcePrompt),
    "",
    "【输出契约】",
    "只输出本维度的选择。每张卡必须同时选择真实 cap_id 和 low/mid/high tier。",
    "输出 JSON：{\"dimension\":\"<当前功能维度>\",\"cards\":[{\"id\":\"<真实cap_id>\",\"tier\":\"low|mid|high\"}],\"reason\":\"为什么这个客户需要这些功能和档次\",\"cost_note\":\"你对本维度成本的直觉判断\"}",
    "只输出可 JSON.parse 的 JSON，不要 Markdown，不要额外文字。"
  ].filter(Boolean).join("\n");
}

function parseDimensionD4Plan(raw, group, materials) {
  const parsed = parseJsonObject(raw);
  const groupCatalog = new Map((group.capabilities || []).map((cap) => [cap.cap_id, cap]));
  const rawCards = Array.isArray(parsed.cards) ? parsed.cards : [];
  if (rawCards.length < 1) throw new Error(`dimension ${group.group_id} must contain at least one card`);
  const cards = rawCards.map((item) => ({
    id: String(item.id || item.card_id || item.cap_id || "").trim(),
    tier: TIER_CN_TO_ENGINE[String(item.tier || "").trim().toLowerCase()] || TIER_CN_TO_ENGINE[String(item.tier || "").trim()] || String(item.tier || "").trim()
  }));
  const ids = new Set();
  for (const card of cards) {
    const cap = groupCatalog.get(card.id);
    if (!cap) throw new Error(`card ${card.id} is not in dimension ${group.group_id}`);
    if (!cap.tiers || !cap.tiers[card.tier]) throw new Error(`invalid tier for ${card.id}: ${card.tier}`);
    if (ids.has(card.id)) throw new Error(`duplicate cap_id in dimension ${group.group_id}: ${card.id}`);
    ids.add(card.id);
  }
  return {
    dimension: String(parsed.dimension || group.name || group.group_id).trim(),
    group_id: group.group_id,
    cards,
    reason: truncate(parsed.reason || "", 600),
    cost_note: truncate(parsed.cost_note || "", 300)
  };
}

function combineDimensionPlans(dimensionCalls, materials) {
  const cards = dimensionCalls.flatMap((call) => call.parsed.cards);
  const ids = new Set();
  for (const card of cards) {
    if (ids.has(card.id)) throw new Error(`duplicate cap_id across dimensions: ${card.id}`);
    ids.add(card.id);
  }
  return parseD4JsonPlan(JSON.stringify({
    cards,
    cost_stance: {
      text: `六个功能维度逐区选择后形成的成本立场：${dimensionCalls.map((call) => `${call.parsed.dimension || call.parsed.group_id}：${call.parsed.cost_note || call.parsed.reason}`).join("；")}`,
      source: "承前:D3"
    },
    updated_constraints: dimensionCalls.map((call) => ({
      text: `${call.parsed.dimension || call.parsed.group_id}：${call.parsed.reason || "按本维度局部需求选择"}`,
      source: "承前:D3"
    }))
  }), materials);
}

function renderCompactCatalog(materials) {
  return (materials.capabilityGroups.groups || []).map((group) => [
    `${group.name || group.group_id} (${group.group_id})`,
    ...(group.capabilities || []).map((cap) => `- ${cap.cap_id}: ${cap.name || cap.cap_id}; tiers=${Object.keys(cap.tiers || {}).join("/")}; dependencies=${JSON.stringify(cap.dependencies || [])}; conflicts=${JSON.stringify(cap.conflicts || [])}`)
  ].join("\n")).join("\n\n");
}

function buildDimensionGlobalRepairPrompt(sourcePrompt, dimensionCalls, combineError, materials) {
  const cards = dimensionCalls.flatMap((call) => call.parsed.cards);
  return [
    d4ContextWithoutFullCards(sourcePrompt),
    "",
    "【六轮局部功能判断结果】",
    renderCardsByGroup(cards, materials),
    "",
    "【六轮理由】",
    dimensionCalls.map((call) => `${call.parsed.dimension || call.parsed.group_id}：${call.parsed.reason || ""}；成本直觉=${call.parsed.cost_note || ""}`).join("\n"),
    "",
    "【全局兼容性校验未通过】",
    String(combineError?.message || combineError),
    "",
    "【可用 cap_id 摘要】",
    renderCompactCatalog(materials),
    "",
    d4QuestionBlock(sourcePrompt),
    "",
    "【D4 合法性修复】",
    "六轮局部判断已经完成。现在只做最小幅度的合法性修复，不重新发明需求判断。",
    "优先通过升级依赖卡或补充必要卡来修复；每个维度至少 1 张、总数至少 6 张；兼容性必须合法。",
    "cost_stance.source 必须引用真实地图 id 或承前:R1/承前:D3。",
    '输出 JSON：{"cards":[{"id":"<真实cap_id>","tier":"low|mid|high"}],"cost_stance":{"text":"<成本立场>","source":"map_xx或承前:D3"},"updated_constraints":[{"text":"<约束>","source":"map_xx或承前:D3"}]}',
    "只输出可 JSON.parse 的 JSON，不要 Markdown，不要额外文字。"
  ].filter(Boolean).join("\n");
}

function buildD5ChatPrompt(sourceRow, d4Parsed, d4Raw, materials) {
  let prompt = String(sourceRow.r2?.d5?.prompt || "");
  const d4Record = `D4：选卡${d4Parsed.cards.length}张[${renderCardsByGroup(d4Parsed.cards, materials)}]；成本立场=${truncate(d4Parsed.cost_stance.text, 260)}；约束=${d4Parsed.updated_constraints.map((item) => item.text).join("；")}`;
  prompt = prompt.replace(/D4：选卡.*?\n/, `${d4Record}\n`);
  const outputContractAt = prompt.indexOf("【输出契约】");
  const taskAt = prompt.indexOf("【任务】");
  const cut = outputContractAt >= 0 ? outputContractAt : taskAt;
  const prefix = (cut >= 0 ? prompt.slice(0, cut) : prompt).trim();
  return [
    prefix,
    "",
    "【输出方式变更：自然对话，不填 JSON】",
    "现在请像真实决策者一样，用自己的话定最终价格。目标仍然是赚最多的钱；价格范围仍然是 1000-6000 元，步进 100 元。",
    "先说你为什么这么定，再在最后单独写一句：最终价格：X元。",
    "不要输出 JSON，不要 Markdown 表格。",
    "",
    "【你刚才自然语言选卡的原文，供你承接】",
    truncate(d4Raw, 1200)
  ].join("\n");
}

function buildD5FormalPrompt(sourceRow, d4Parsed, materials) {
  let prompt = String(sourceRow.r2?.d5?.prompt || "");
  const d4Record = `D4：选卡${d4Parsed.cards.length}张[${renderCardsByGroup(d4Parsed.cards, materials)}]；成本立场=${truncate(d4Parsed.cost_stance.text, 260)}；约束=${d4Parsed.updated_constraints.map((item) => item.text).join("；")}`;
  return prompt.replace(/D4：选卡.*?\n/, `${d4Record}\n`);
}

function parseCardsFromChat(raw, materials) {
  const catalog = cardCatalog(materials);
  const text = String(raw || "");
  const markerMatch = text.match(/最终选卡[：:]\s*([\s\S]*)/u);
  const parseText = markerMatch ? markerMatch[1] : text;
  const selected = new Map();
  const missingTiers = [];
  for (const card of catalog) {
    const escaped = card.id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const regex = new RegExp(`${escaped}\\s*(?:@|＠|:|：|=|＝|\\s+)?\\s*(low|mid|high|低|中|高)?`, "igu");
    for (const match of parseText.matchAll(regex)) {
      const tierRaw = String(match[1] || "").trim();
      if (!tierRaw) {
        missingTiers.push(card.id);
        continue;
      }
      const tier = TIER_CN_TO_ENGINE[tierRaw.toLowerCase()] || TIER_CN_TO_ENGINE[tierRaw];
      if (!tier || !card.tiers.has(tier)) throw new Error(`invalid tier for ${card.id}: ${tierRaw}`);
      if (!selected.has(card.id)) selected.set(card.id, { id: card.id, tier });
    }
  }
  if (missingTiers.length) throw new Error(`missing tier for cap_id(s): ${Array.from(new Set(missingTiers)).join(",")}`);
  const cards = [...selected.values()];
  if (cards.length < 6) throw new Error(`cards must contain at least six rows, got ${cards.length}`);
  const RD = require("../../server/llm/rdCalculator");
  const validation = RD.validateSelections(cards.map((card) => ({ cap_id: card.id, tier: card.tier })));
  if (!validation.valid || validation.hardViolationCount !== 0) {
    const details = (validation.violations || []).map((item) => item.message || JSON.stringify(item)).join("; ");
    throw new Error(`compatibility validation failed: ${details || "unknown violation"}`);
  }
  return {
    cards,
    cost_stance: { text: truncate(text, 600), source: "承前:D3" },
    updated_constraints: [{ text: "自然语言 chat D4 输出；解析后进入同一 rdCalculator 结算。", source: "承前:D3" }],
    compatibility: validation
  };
}

function parsePriceFromChat(raw) {
  const text = String(raw || "");
  const explicit = [...text.matchAll(/(?:最终价格|最终定价)\s*[：:]?\s*(\d{2,5})\s*元/g)].map((match) => Number(match[1]));
  let price = explicit.length ? explicit[explicit.length - 1] : null;
  if (price !== null && (price < 1000 || price > 6000)) {
    throw new Error(`final price out of 1000-6000 range: ${price}`);
  }
  if (price === null) {
    const matches = [...text.matchAll(/(?<!\d)([1-6]\d{3})(?!\d)/g)]
      .map((match) => Number(match[1]))
      .filter((num) => num >= 1000 && num <= 6000);
    if (!matches.length) throw new Error("no 1000-6000 price found");
    price = matches[matches.length - 1];
  }
  return {
    price,
    aligned_price: Math.max(1000, Math.min(6000, Math.round(price / 100) * 100)),
    basis: { text: truncate(text, 600), source: "承前:D4" },
    reasoning: truncate(text, 1200)
  };
}

function parseD5Json(raw) {
  const parsed = parseJsonObject(raw);
  const price = Number(parsed.aligned_price ?? parsed.price);
  if (!Number.isFinite(price)) throw new Error("D5 JSON price is not numeric");
  if (price < 1000 || price > 6000) throw new Error(`D5 JSON price out of 1000-6000 range: ${price}`);
  return {
    ...parsed,
    price,
    aligned_price: Math.max(1000, Math.min(6000, Math.round(price / 100) * 100)),
    basis: parsed.basis || { text: truncate(parsed.reasoning || parsed.reason || parsed.one_line || raw, 600), source: "承前:D4" },
    reasoning: parsed.reasoning || parsed.reason || parsed.one_line || truncate(raw, 1200)
  };
}

function parseJsonObject(raw) {
  const text = String(raw || "").trim();
  try {
    return JSON.parse(text);
  } catch (_) {
    const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fenced) return JSON.parse(fenced[1].trim());
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start >= 0 && end > start) return JSON.parse(text.slice(start, end + 1));
    throw new Error("response is not a JSON object");
  }
}

function parseD4JsonPlan(raw, materials) {
  const parsed = parseJsonObject(raw);
  const rawCards = Array.isArray(parsed.cards) ? parsed.cards : [];
  const cards = rawCards.map((item) => ({
    id: String(item.id || item.card_id || item.cap_id || "").trim(),
    tier: TIER_CN_TO_ENGINE[String(item.tier || "").trim().toLowerCase()] || TIER_CN_TO_ENGINE[String(item.tier || "").trim()] || String(item.tier || "").trim()
  }));
  const catalog = new Map(cardCatalog(materials).map((card) => [card.id, card]));
  if (cards.length < 6) throw new Error(`cards must contain at least six rows, got ${cards.length}`);
  for (const card of cards) {
    const meta = catalog.get(card.id);
    if (!meta) throw new Error(`unknown cap_id: ${card.id}`);
    if (!meta.tiers.has(card.tier)) throw new Error(`invalid tier for ${card.id}: ${card.tier}`);
  }
  const ids = new Set();
  for (const card of cards) {
    if (ids.has(card.id)) throw new Error(`duplicate cap_id: ${card.id}`);
    ids.add(card.id);
  }
  const RD = require("../../server/llm/rdCalculator");
  const validation = RD.validateSelections(cards.map((card) => ({ cap_id: card.id, tier: card.tier })));
  if (!validation.valid || validation.hardViolationCount !== 0) {
    const details = (validation.violations || []).map((item) => item.message || JSON.stringify(item)).join("; ");
    throw new Error(`compatibility validation failed: ${details || "unknown violation"}`);
  }
  return {
    cards,
    cost_stance: {
      text: truncate(parsed.cost_stance?.text || parsed.cost_stance_text || "", 600),
      source: String(parsed.cost_stance?.source || parsed.source || "承前:D3").trim()
    },
    updated_constraints: (Array.isArray(parsed.updated_constraints) ? parsed.updated_constraints : []).map((item) => ({
      text: truncate(item.text || item.constraint || "", 240),
      source: String(item.source || "承前:D3").trim()
    })).filter((item) => item.text),
    compatibility: validation
  };
}

function parseConcernList(raw) {
  const parsed = parseJsonObject(raw);
  const concerns = (Array.isArray(parsed.concerns) ? parsed.concerns : parsed.aspirations || [])
    .map((item) => String(item || "").trim())
    .filter(Boolean)
    .slice(0, 3);
  if (concerns.length < 1) throw new Error("concerns must contain at least one item");
  return { concerns };
}

function parseSatisfaction(raw) {
  const parsed = parseJsonObject(raw);
  return {
    satisfaction: (Array.isArray(parsed.satisfaction) ? parsed.satisfaction : []).map((item) => ({
      item: String(item.item || "").trim(),
      verdict: String(item.verdict || "").trim(),
      reason: String(item.reason || "").trim()
    })),
    overall: String(parsed.overall || "").trim()
  };
}

function renderD4Plan(plan, materials, options = {}) {
  const includeCostStance = options.includeCostStance !== false;
  const grouped = new Map();
  for (const card of plan.cards || []) {
    const group = materials.groupByCapability.get(card.id || card.card_id || card.cap_id);
    const groupName = group?.name || group?.group_id || "未知维度";
    if (!grouped.has(groupName)) grouped.set(groupName, []);
    grouped.get(groupName).push(`${card.id || card.card_id || card.cap_id}@${card.tier}`);
  }
  const lines = [
    `选卡${(plan.cards || []).length}张：${Array.from(grouped.entries()).map(([name, values]) => `${name}=${values.join(",")}`).join("；")}`
  ];
  if (includeCostStance) lines.push(`成本立场：${plan.cost_stance?.text || ""}`);
  lines.push(`约束：${(plan.updated_constraints || []).map((item) => item.text).join("；")}`);
  return lines.join("\n");
}

function buildD4ConcernsPrompt(base) {
  return [
    base,
    "【Satisfice Step 1】在选能力卡之前，先列出你最在意的 2-3 条顾虑。顾虑应承接你的地图、累计栈和 D3 证据。",
    '只输出 JSON：{"concerns":["顾虑1","顾虑2"]}',
    "只输出可 JSON.parse 的 JSON，不要 Markdown，不要额外文字。"
  ].join("\n");
}

function buildD4DefaultPlanPrompt(base, concerns) {
  return [
    base,
    "【你刚才列出的顾虑】",
    concerns.map((item, index) => `${index + 1}. ${item}`).join("\n"),
    "【Satisfice Step 2】先给出一个凭直觉快速想到的能力卡方案。",
    "每张卡必须同时选择真实 cap_id 和 low/mid/high tier；每个维度至少 1 张、总数至少 6 张。具体张数、卡片和 tier 都由你决定。",
    "cost_stance.source 必须引用真实地图 id 或承前:R1/承前:D3。",
    '输出 JSON：{"cards":[{"id":"<真实cap_id>","tier":"low|mid|high"}],"cost_stance":{"text":"<成本立场>","source":"map_xx或承前:D3"},"updated_constraints":[{"text":"<约束>","source":"map_xx或承前:D3"}]}',
    "只输出可 JSON.parse 的 JSON，不要 Markdown，不要额外文字。"
  ].join("\n");
}

function buildD4EvaluatePrompt(base, concerns, defaultPlan, materials) {
  return [
    base,
    "【你刚才列出的顾虑】",
    concerns.map((item, index) => `${index + 1}. ${item}`).join("\n"),
    "【直觉方案】",
    renderD4Plan(defaultPlan, materials, { includeCostStance: false }),
    "【Satisfice Step 3】逐项评估这个直觉方案是否满足顾虑。只评估，不要改方案。",
    '只输出 JSON：{"satisfaction":[{"item":"顾虑1","verdict":"满足|部分满足|不满足","reason":"..."}],"overall":"满足|部分满足|不满足"}',
    "只输出可 JSON.parse 的 JSON，不要 Markdown，不要额外文字。"
  ].join("\n");
}

function buildD4AlternativesPrompt(base, concerns, defaultPlan, evaluation, materials) {
  return [
    base,
    "【顾虑】",
    concerns.map((item, index) => `${index + 1}. ${item}`).join("\n"),
    "【直觉方案】",
    renderD4Plan(defaultPlan, materials, { includeCostStance: false }),
    "【评估】",
    JSON.stringify(evaluation, null, 2),
    "【Satisfice Step 4】如果有不满足或部分满足的地方，列出 1-3 个替代选卡方案；如果没有更好的方案，输出空数组。",
    "每个替代方案仍必须满足：每张卡真实 cap_id+tier；每个维度至少 1 张、总数至少 6 张。",
    '只输出 JSON：{"alternatives":[{"cards":[{"id":"<真实cap_id>","tier":"low|mid|high"}],"cost_stance":{"text":"<成本立场>","source":"map_xx或承前:D3"},"updated_constraints":[{"text":"<约束>","source":"map_xx或承前:D3"}],"reason":"为什么想到这个替代"}]}',
    "只输出可 JSON.parse 的 JSON，不要 Markdown，不要额外文字。"
  ].join("\n");
}

function parseAlternatives(raw, materials) {
  const parsed = parseJsonObject(raw);
  const alternatives = (Array.isArray(parsed.alternatives) ? parsed.alternatives : []).slice(0, 3).map((item, index) => ({
    reason: String(item.reason || "").trim(),
    plan: parseD4JsonPlan(JSON.stringify({
      cards: item.cards,
      cost_stance: item.cost_stance || { text: item.cost_stance_text || `替代方案${index + 1}的成本立场`, source: item.source || "承前:D3" },
      updated_constraints: item.updated_constraints || [{ text: item.reason || `替代方案${index + 1}承接顾虑修补`, source: "承前:D3" }]
    }), materials)
  }));
  return { alternatives };
}

function buildD4FinalFromSatisficePrompt(base, concerns, defaultPlan, evaluation, alternatives, materials) {
  return [
    base,
    "【顾虑】",
    concerns.map((item, index) => `${index + 1}. ${item}`).join("\n"),
    "【直觉方案】",
    renderD4Plan(defaultPlan, materials, { includeCostStance: false }),
    "【直觉方案评估】",
    JSON.stringify(evaluation, null, 2),
    "【替代方案】",
    alternatives.length ? alternatives.map((item, index) => `方案${index + 1}\n${renderD4Plan(item.plan, materials, { includeCostStance: false })}\n理由：${item.reason || ""}`).join("\n\n") : "没有更好的替代方案。",
    "【Satisfice Step 5】看着上述顾虑、直觉方案、评估和替代方案，自由做最终能力卡选择。",
    "每张卡必须同时选择真实 cap_id 和 low/mid/high tier；每个维度至少 1 张、总数至少 6 张。具体张数、卡片和 tier 都由你决定。",
    "cost_stance.source 必须引用真实地图 id 或承前:R1/承前:D3。",
    '输出 JSON：{"cards":[{"id":"<真实cap_id>","tier":"low|mid|high"}],"cost_stance":{"text":"<成本立场>","source":"map_xx或承前:D3"},"updated_constraints":[{"text":"<约束>","source":"map_xx或承前:D3"}]}',
    "只输出可 JSON.parse 的 JSON，不要 Markdown，不要额外文字。"
  ].join("\n");
}

async function callWithRepair({ client, prompt, parser, paths, chain, stage, maxTokens }) {
  let messages = [{ role: "user", content: prompt }];
  let raw = "";
  let lastError = null;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    const promptText = messages.map((message) => `${message.role}:${message.content}`).join("\n\n");
    const startedAt = new Date().toISOString();
    try {
      raw = await client.chatCompletion(messages, {
        model: LLM_MODEL,
        temperature: TEMPERATURE,
        max_tokens: maxTokens,
        timeoutMs: TIMEOUT_MS,
        thinking: { type: "disabled" },
        maxRetries: 1
      });
      const parsed = parser(raw);
      appendJsonl(paths.auditJsonl, {
        run_id: RUN_ID,
        chain_key: chain,
        stage,
        attempt,
        status: "OK",
        started_at: startedAt,
        ended_at: new Date().toISOString(),
        model: LLM_MODEL,
        temperature: TEMPERATURE,
        thinking: "disabled",
        prompt_sha256: sha256(promptText),
        prompt_chars: Array.from(promptText).length,
        raw_response_sha256: sha256(raw),
        raw_response_chars: Array.from(raw).length
      });
      return { prompt, prompt_sha256: sha256(prompt), raw_response: raw, parsed, attempts: attempt, status: "OK", error: "" };
    } catch (error) {
      lastError = error;
      appendJsonl(paths.auditJsonl, {
        run_id: RUN_ID,
        chain_key: chain,
        stage,
        attempt,
        status: "ERROR",
        started_at: startedAt,
        ended_at: new Date().toISOString(),
        model: LLM_MODEL,
        temperature: TEMPERATURE,
        thinking: "disabled",
        prompt_sha256: sha256(promptText),
        prompt_chars: Array.from(promptText).length,
        error: String(error?.message || error)
      });
      if (attempt < MAX_ATTEMPTS) {
        messages = [
          { role: "user", content: prompt },
          { role: "assistant", content: raw || "(空输出)" },
          { role: "user", content: `上一次输出无法用于实验：${error.message || error}。请只修正为可解析、满足硬性约束的回答，不要改变核心决策。` }
        ];
      }
    }
  }
  throw lastError;
}

async function recalculateFormalRows(rows, FullGame, materials) {
  const out = [];
  for (const row of rows) {
    const replayRow = JSON.parse(JSON.stringify(row));
    replayRow.r2.calculate = await FullGame.calculateR2(replayRow, materials);
    out.push({
      chain_key: chainKey(row),
      persona_id: row.persona_id,
      persona_label: row.persona_label,
      condition: row.condition,
      rep: row.rep,
      stored_price: priceOf(row),
      replay_price: priceOf(replayRow),
      stored_profit: profitOf(row),
      replay_profit: profitOf(replayRow),
      stored_loss: profitOf(row) < 0 ? 1 : 0,
      replay_loss: profitOf(replayRow) < 0 ? 1 : 0,
      stored_cards: cardsOf(row).length,
      replay_cards: cardsOf(replayRow).length,
      profit_delta: Math.round(profitOf(replayRow) - profitOf(row))
    });
  }
  return out;
}

function existingChatRows(paths) {
  const latest = new Map();
  for (const row of loadJsonl(paths.jsonl).filter((item) => item.run_id === RUN_ID)) latest.set(row.source_chain_key || row.chain_key, row);
  return latest;
}

function compactChatJsonl(paths) {
  const latest = [...existingChatRows(paths).values()];
  if (!latest.length) return latest;
  fs.writeFileSync(paths.jsonl, `${latest.map((row) => JSON.stringify(row)).join("\n")}\n`, "utf8");
  return latest;
}

function writeCurrentFailures(paths, rows) {
  const failures = rows.filter((row) => row.status !== "OK");
  if (failures.length) {
    fs.writeFileSync(paths.failuresJsonl, `${failures.map((row) => JSON.stringify(row)).join("\n")}\n`, "utf8");
  } else if (fs.existsSync(paths.failuresJsonl)) {
    fs.unlinkSync(paths.failuresJsonl);
  }
}

async function runChatRow({ sourceRow, FullGame, materials, client, paths, force = false }) {
  const sourceChainKey = chainKey(sourceRow);
  const existing = existingChatRows(paths).get(sourceChainKey);
  if (!force && existing?.status === "OK") return existing;
  const row = JSON.parse(JSON.stringify(sourceRow));
  row.run_id = RUN_ID;
  row.source_run_id = SOURCE_RUN_ID;
  row.source_chain_key = sourceChainKey;
  row.status = "RUNNING";
  row.created_at = new Date().toISOString();
  row.format_arm = "chat_D4_D5_only";
  row.source_baseline = sourceBaselineSnapshot(sourceRow);
  try {
    const d4Prompt = stripD4JsonContract(sourceRow.r2.d4.prompt);
    const d4Call = await callWithRepair({
      client,
      prompt: d4Prompt,
      parser: (raw) => parseCardsFromChat(raw, materials),
      paths,
      chain: sourceChainKey,
      stage: "chat_D4",
      maxTokens: 5000
    });
    row.r2.d4 = d4Call;
    const d5Prompt = buildD5ChatPrompt(sourceRow, d4Call.parsed, d4Call.raw_response, materials);
    const d5Call = await callWithRepair({
      client,
      prompt: d5Prompt,
      parser: parsePriceFromChat,
      paths,
      chain: sourceChainKey,
      stage: "chat_D5",
      maxTokens: 2500
    });
    row.r2.d5 = d5Call;
    row.r2.calculate = await FullGame.calculateR2(row, materials);
    row.status = "OK";
    row.chat_delta = {
      price: priceOf(row) - priceOf(sourceRow),
      profit: Math.round(profitOf(row) - profitOf(sourceRow)),
      cards: cardsOf(row).length - cardsOf(sourceRow).length,
      baseline_loss: profitOf(sourceRow) < 0,
      chat_loss: profitOf(row) < 0
    };
    appendJsonl(paths.jsonl, row);
    return row;
  } catch (error) {
    row.status = "FAIL";
    row.error = String(error?.stack || error?.message || error);
    appendJsonl(paths.failuresJsonl, row);
    appendJsonl(paths.jsonl, row);
    return row;
  }
}

async function runSatisficeRow({ sourceRow, FullGame, materials, client, paths, force = false }) {
  const sourceChainKey = chainKey(sourceRow);
  const existing = existingChatRows(paths).get(sourceChainKey);
  if (!force && existing?.status === "OK") return existing;
  const row = JSON.parse(JSON.stringify(sourceRow));
  row.run_id = RUN_ID;
  row.source_run_id = SOURCE_RUN_ID;
  row.source_chain_key = sourceChainKey;
  row.status = "RUNNING";
  row.created_at = new Date().toISOString();
  row.format_arm = "satisfice_D4_plus_chat_D5";
  row.source_baseline = sourceBaselineSnapshot(sourceRow);
  try {
    const base = d4BasePrompt(sourceRow.r2.d4.prompt);
    const concernsCall = await callWithRepair({
      client,
      prompt: buildD4ConcernsPrompt(base),
      parser: parseConcernList,
      paths,
      chain: sourceChainKey,
      stage: "satisfice_D4_concerns",
      maxTokens: 1200
    });
    const defaultCall = await callWithRepair({
      client,
      prompt: buildD4DefaultPlanPrompt(base, concernsCall.parsed.concerns),
      parser: (raw) => parseD4JsonPlan(raw, materials),
      paths,
      chain: sourceChainKey,
      stage: "satisfice_D4_default",
      maxTokens: 3500
    });
    const evaluateCall = await callWithRepair({
      client,
      prompt: buildD4EvaluatePrompt(base, concernsCall.parsed.concerns, defaultCall.parsed, materials),
      parser: parseSatisfaction,
      paths,
      chain: sourceChainKey,
      stage: "satisfice_D4_evaluate",
      maxTokens: 1600
    });
    const alternativesCall = await callWithRepair({
      client,
      prompt: buildD4AlternativesPrompt(base, concernsCall.parsed.concerns, defaultCall.parsed, evaluateCall.parsed, materials),
      parser: (raw) => parseAlternatives(raw, materials),
      paths,
      chain: sourceChainKey,
      stage: "satisfice_D4_alternatives",
      maxTokens: 5000
    });
    const finalCall = await callWithRepair({
      client,
      prompt: buildD4FinalFromSatisficePrompt(base, concernsCall.parsed.concerns, defaultCall.parsed, evaluateCall.parsed, alternativesCall.parsed.alternatives, materials),
      parser: (raw) => parseD4JsonPlan(raw, materials),
      paths,
      chain: sourceChainKey,
      stage: "satisfice_D4_final",
      maxTokens: 3500
    });
    row.r2.d4 = finalCall;
    row.r2.d4_satisfice = {
      concerns: concernsCall,
      default_plan: defaultCall,
      evaluation: evaluateCall,
      alternatives: alternativesCall,
      final: finalCall
    };
    const d5Prompt = buildD5ChatPrompt(sourceRow, finalCall.parsed, finalCall.raw_response, materials);
    const d5Call = await callWithRepair({
      client,
      prompt: d5Prompt,
      parser: parsePriceFromChat,
      paths,
      chain: sourceChainKey,
      stage: "satisfice_chat_D5",
      maxTokens: 2500
    });
    row.r2.d5 = d5Call;
    row.r2.calculate = await FullGame.calculateR2(row, materials);
    row.status = "OK";
    row.chat_delta = {
      price: priceOf(row) - priceOf(sourceRow),
      profit: Math.round(profitOf(row) - profitOf(sourceRow)),
      cards: cardsOf(row).length - cardsOf(sourceRow).length,
      baseline_loss: profitOf(sourceRow) < 0,
      chat_loss: profitOf(row) < 0
    };
    appendJsonl(paths.jsonl, row);
    return row;
  } catch (error) {
    row.status = "FAIL";
    row.error = String(error?.stack || error?.message || error);
    appendJsonl(paths.failuresJsonl, row);
    appendJsonl(paths.jsonl, row);
    return row;
  }
}

async function runDimensionRow({ sourceRow, FullGame, materials, client, paths, force = false }) {
  const sourceChainKey = chainKey(sourceRow);
  const existing = existingChatRows(paths).get(sourceChainKey);
  if (!force && existing?.status === "OK") return existing;
  const row = JSON.parse(JSON.stringify(sourceRow));
  row.run_id = RUN_ID;
  row.source_run_id = SOURCE_RUN_ID;
  row.source_chain_key = sourceChainKey;
  row.status = "RUNNING";
  row.created_at = new Date().toISOString();
  row.format_arm = "six_dimension_D4_formal_D5";
  row.source_baseline = sourceBaselineSnapshot(sourceRow);
  try {
    const dimensionCalls = [];
    let selectedSoFar = [];
    for (const group of materials.capabilityGroups.groups || []) {
      const prompt = buildDimensionD4Prompt(sourceRow.r2.d4.prompt, group, selectedSoFar, materials);
      const call = await callWithRepair({
        client,
        prompt,
        parser: (raw) => parseDimensionD4Plan(raw, group, materials),
        paths,
        chain: sourceChainKey,
        stage: `dimension_D4_${group.group_id}`,
        maxTokens: 1800
      });
      dimensionCalls.push(call);
      selectedSoFar = selectedSoFar.concat(call.parsed.cards);
    }
    let repairCall = null;
    let finalParsed = null;
    try {
      finalParsed = combineDimensionPlans(dimensionCalls, materials);
    } catch (combineError) {
      repairCall = await callWithRepair({
        client,
        prompt: buildDimensionGlobalRepairPrompt(sourceRow.r2.d4.prompt, dimensionCalls, combineError, materials),
        parser: (raw) => parseD4JsonPlan(raw, materials),
        paths,
        chain: sourceChainKey,
        stage: "dimension_D4_global_repair",
        maxTokens: 3500
      });
      finalParsed = repairCall.parsed;
    }
    row.r2.d4 = {
      prompt: [...dimensionCalls.map((call) => call.prompt), repairCall?.prompt].filter(Boolean).join("\n\n===== NEXT DIMENSION / REPAIR =====\n\n"),
      prompt_sha256: sha256([...dimensionCalls.map((call) => call.prompt_sha256), repairCall?.prompt_sha256].filter(Boolean).join("|")),
      raw_response: [...dimensionCalls.map((call) => call.raw_response), repairCall?.raw_response].filter(Boolean).join("\n\n===== NEXT DIMENSION / REPAIR =====\n\n"),
      parsed: finalParsed,
      attempts: dimensionCalls.reduce((sum, call) => sum + Number(call.attempts || 0), 0) + Number(repairCall?.attempts || 0),
      status: "OK",
      error: ""
    };
    row.r2.d4_dimension_rounds = dimensionCalls;
    if (repairCall) row.r2.d4_global_repair = repairCall;
    const d5Prompt = buildD5FormalPrompt(sourceRow, finalParsed, materials);
    const d5Call = await callWithRepair({
      client,
      prompt: d5Prompt,
      parser: parseD5Json,
      paths,
      chain: sourceChainKey,
      stage: "dimension_formal_D5",
      maxTokens: 2500
    });
    row.r2.d5 = d5Call;
    row.r2.calculate = await FullGame.calculateR2(row, materials);
    row.status = "OK";
    row.chat_delta = {
      price: priceOf(row) - priceOf(sourceRow),
      profit: Math.round(profitOf(row) - profitOf(sourceRow)),
      cards: cardsOf(row).length - cardsOf(sourceRow).length,
      baseline_loss: profitOf(sourceRow) < 0,
      chat_loss: profitOf(row) < 0
    };
    appendJsonl(paths.jsonl, row);
    return row;
  } catch (error) {
    row.status = "FAIL";
    row.error = String(error?.stack || error?.message || error);
    appendJsonl(paths.failuresJsonl, row);
    appendJsonl(paths.jsonl, row);
    return row;
  }
}

function buildRowMetrics(rows) {
  return rows.filter((row) => row.status === "OK").map((row) => {
    const baselineMech = row.source_baseline?.mechanism || {};
    const chatMech = mechanismSnapshot(row);
    return {
      source_chain_key: row.source_chain_key || chainKey(row),
      persona_id: row.persona_id,
      persona_label: row.persona_label,
      condition: row.condition,
      rep: row.rep,
      baseline_cards: row.source_baseline?.cards,
      chat_cards: cardsOf(row).length,
      baseline_price: row.source_baseline?.price,
      chat_price: priceOf(row),
      baseline_profit: row.source_baseline?.profit,
      chat_profit: profitOf(row),
      baseline_loss: row.source_baseline?.profit < 0 ? 1 : 0,
      chat_loss: profitOf(row) < 0 ? 1 : 0,
      price_delta: priceOf(row) - Number(row.source_baseline?.price),
      profit_delta: Math.round(profitOf(row) - Number(row.source_baseline?.profit)),
      card_delta: cardsOf(row).length - Number(row.source_baseline?.cards),
      baseline_coverCore: baselineMech.coverCore,
      chat_coverCore: chatMech.coverCore,
      baseline_coverNice: baselineMech.coverNice,
      chat_coverNice: chatMech.coverNice,
      baseline_coverage_efficiency: baselineMech.coverage_efficiency,
      chat_coverage_efficiency: chatMech.coverage_efficiency,
      baseline_COGS: baselineMech.COGS,
      chat_COGS: chatMech.COGS,
      baseline_dCOGS: baselineMech.dCOGS,
      chat_dCOGS: chatMech.dCOGS,
      baseline_nre_total_wan: baselineMech.nre_total_wan,
      chat_nre_total_wan: chatMech.nre_total_wan,
      baseline_fixedCost: baselineMech.fixedCost,
      chat_fixedCost: chatMech.fixedCost,
      baseline_q_to_breakeven: baselineMech.q_to_breakeven,
      chat_q_to_breakeven: chatMech.q_to_breakeven,
      baseline_price_wtp_ratio: baselineMech.price_wtp_ratio,
      chat_price_wtp_ratio: chatMech.price_wtp_ratio,
      baseline_double_squeeze: baselineMech.double_squeeze,
      chat_double_squeeze: chatMech.double_squeeze,
      d4_attempts: row.r2?.d4?.attempts,
      d5_attempts: row.r2?.d5?.attempts
    };
  });
}

function buildSummary({ sourceRows, replayRows, chatRows }) {
  const sourceStats = stats(sourceRows);
  const chatStats = stats(chatRows);
  const sourceMech = mechanismStats(sourceRows);
  const chatMech = mechanismStats(chatRows);
  const replayMatches = replayRows.length ? replayRows.every((row) => row.profit_delta === 0 && row.stored_loss === row.replay_loss) : false;
  const paired = chatRows.filter((row) => row.status === "OK");
  const flips = paired.reduce((acc, row) => {
    const baselineProfitable = Number(row.source_baseline?.profit) >= 0;
    const chatProfitable = profitOf(row) >= 0;
    if (baselineProfitable && chatProfitable) acc.same_profit += 1;
    else if (!baselineProfitable && !chatProfitable) acc.same_loss += 1;
    else if (baselineProfitable && !chatProfitable) acc.profit_to_loss += 1;
    else acc.loss_to_profit += 1;
    return acc;
  }, { same_profit: 0, same_loss: 0, profit_to_loss: 0, loss_to_profit: 0 });
  const attempts = paired.reduce((acc, row) => {
    const d4 = Number(row.r2?.d4?.attempts || 0);
    const d5 = Number(row.r2?.d5?.attempts || 0);
    acc.d4[d4] = (acc.d4[d4] || 0) + 1;
    acc.d5[d5] = (acc.d5[d5] || 0) + 1;
    return acc;
  }, { d4: {}, d5: {} });
  const lines = [];
  lines.push(`# ${RUN_ID} Summary`, "");
  lines.push(`SYNTHETIC. Report only. Formal-global baseline first, then ${ARM_LABEL}.`, "");
  lines.push("## Baseline Replay Gate", "");
  lines.push(`- Source: \`${SOURCE_RUN_ID}\` / ${sourceRows.length} OK rows.`);
  lines.push(`- Stored formal result: ${sourceStats.profitable}/${sourceStats.n} profitable, loss_rate=${pct(sourceStats.loss_rate)}.`);
  lines.push(`- Current-code replay rows: ${replayRows.length}; exact profit/loss match=${replayMatches ? "YES" : "NO"}.`);
  lines.push("- Interpretation gate: chat rows are interpretable only against this formal/global 42-chain source, not against the fixed child-grid controls.");
  lines.push("", "## Format Comparison", "");
  lines.push("| arm | n | profitable | loss_rate | unique_configs | price_mean | price_sd | price_range | cards_mean | cards_range | profit_mean |");
  lines.push("|---|---:|---:|---:|---:|---:|---:|---|---:|---|---:|");
  lines.push(`| formal grid source | ${sourceStats.n} | ${sourceStats.profitable} | ${pct(sourceStats.loss_rate)} | ${sourceStats.unique_configs} | ${round(sourceStats.price_mean, 0)} | ${round(sourceStats.price_sd, 1)} | ${sourceStats.price_min}-${sourceStats.price_max} | ${round(sourceStats.cards_mean, 2)} | ${sourceStats.cards_min}-${sourceStats.cards_max} | ${round(sourceStats.profit_mean, 0)} |`);
  if (paired.length) {
    lines.push(`| ${ARM_LABEL} | ${chatStats.n} | ${chatStats.profitable} | ${pct(chatStats.loss_rate)} | ${chatStats.unique_configs} | ${round(chatStats.price_mean, 0)} | ${round(chatStats.price_sd, 1)} | ${chatStats.price_min}-${chatStats.price_max} | ${round(chatStats.cards_mean, 2)} | ${chatStats.cards_min}-${chatStats.cards_max} | ${round(chatStats.profit_mean, 0)} |`);
  } else {
    lines.push(`| ${ARM_LABEL} | 0 | - | - | - | - | - | - | - | - | - |`);
  }
  lines.push("", "## Paired Flip Audit", "");
  lines.push(`- same profit: ${flips.same_profit}`);
  lines.push(`- same loss: ${flips.same_loss}`);
  lines.push(`- formal profit → chat loss: ${flips.profit_to_loss}`);
  lines.push(`- formal loss → chat profit: ${flips.loss_to_profit}`);
  lines.push(`- D4 attempts distribution: ${JSON.stringify(attempts.d4)}`);
  lines.push(`- D5 attempts distribution: ${JSON.stringify(attempts.d5)}`);
  lines.push("", "## Paired Rows", "");
  lines.push("| chain | persona | cond | rep | base cards | chat cards | base price | chat price | base profit | chat profit | base loss | chat loss |");
  lines.push("|---|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|");
  for (const row of paired) {
    lines.push(`| ${row.source_chain_key} | ${row.persona_label} | ${row.condition} | ${row.rep} | ${row.source_baseline.cards} | ${cardsOf(row).length} | ${row.source_baseline.price} | ${priceOf(row)} | ${Math.round(row.source_baseline.profit)} | ${Math.round(profitOf(row))} | ${row.source_baseline.profit < 0 ? 1 : 0} | ${profitOf(row) < 0 ? 1 : 0} |`);
  }
  lines.push("", "## Failure Mechanism Audit", "");
  lines.push("| arm | coverCore | coverNice | cover/card | COGS | dCOGS | NRE(wan) | fixedCost | Q/BEQ | P/WTP | actualGm | double_squeeze_n |");
  lines.push("|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|");
  lines.push(`| formal grid source | ${round(sourceMech.coverCore, 3)} | ${round(sourceMech.coverNice, 3)} | ${round(sourceMech.coverage_efficiency, 4)} | ${round(sourceMech.COGS, 0)} | ${round(sourceMech.dCOGS, 0)} | ${round(sourceMech.nre_total_wan, 1)} | ${round(sourceMech.fixedCost, 0)} | ${round(sourceMech.q_to_breakeven, 3)} | ${round(sourceMech.price_wtp_ratio, 3)} | ${round(sourceMech.actualGm, 3)} | ${sourceMech.double_squeeze} |`);
  if (paired.length) {
    lines.push(`| ${ARM_LABEL} | ${round(chatMech.coverCore, 3)} | ${round(chatMech.coverNice, 3)} | ${round(chatMech.coverage_efficiency, 4)} | ${round(chatMech.COGS, 0)} | ${round(chatMech.dCOGS, 0)} | ${round(chatMech.nre_total_wan, 1)} | ${round(chatMech.fixedCost, 0)} | ${round(chatMech.q_to_breakeven, 3)} | ${round(chatMech.price_wtp_ratio, 3)} | ${round(chatMech.actualGm, 3)} | ${chatMech.double_squeeze} |`);
  }
  lines.push("", "## Controls", "");
  lines.push("- R1 outcome, Coach, D3 summary, D3 evidence signals, target grid, cards manifest, pricing range, compatibility validation, and settlement are inherited from the same formal source row.");
  lines.push(`- Manipulated factor: ${MANIPULATED_FACTOR}.`);
  lines.push("- Invalid, missing, or compatibility-failing outputs get the same repair budget as formal JSON (2 repairs).");
  lines.push("- Settlement uses the same `FullGame.calculateR2` path.");
  lines.push("");
  return lines.join("\n");
}

function writeMeta(paths, args, envInfo, sourceRows, replayRows, chatRows) {
  const existing = Object.values(paths).filter((filePath) => fs.existsSync(filePath));
  writeJson(paths.meta, {
    run_id: args.runId,
    generated_at: new Date().toISOString(),
    git_head: git(["rev-parse", "HEAD"]),
    source_run_id: SOURCE_RUN_ID,
    design: {
      baseline_family: "formal/global",
      paired_unit: "persona_id × Q/S condition × rep",
      manipulated_factor: MANIPULATED_FACTOR,
      arm_label: ARM_LABEL,
      not_compared_to: "single_mechanism_paired fixed child-grid Arm A"
    },
    llm_config: {
      provider: "deepseek",
      model: LLM_MODEL,
      temperature: TEMPERATURE,
      thinking: "disabled",
      timeout_ms: TIMEOUT_MS,
      max_repairs: MAX_REPAIRS,
      env_path_loaded: envInfo?.path || "",
      key_count: envInfo?.key_count || 0
    },
    counts: {
      source_rows: sourceRows.length,
      replay_rows: replayRows.length,
      chat_rows: chatRows.filter((row) => row.status === "OK").length,
      chat_failures: chatRows.filter((row) => row.status !== "OK").length
    },
    config_sha256: {
      runner: fileSha256(__filename),
      source_jsonl: fileSha256(SOURCE_JSONL),
      source_summary: fs.existsSync(SOURCE_SUMMARY) ? fileSha256(SOURCE_SUMMARY) : null,
      deepseekClient: fileSha256(path.join(ROOT, "server", "llm", "deepseekClient.js")),
      full_game_all_personas: fileSha256(path.join(__dirname, "full_game_all_personas.js")),
      rdCalculator: fileSha256(path.join(ROOT, "server", "llm", "rdCalculator.js"))
    },
    output_sha256: Object.fromEntries(existing.map((filePath) => [path.relative(ROOT, filePath), fileSha256(filePath)]))
  });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  ensureModuleResolution();
  const envInfo = args.mode === "replay" ? null : loadLocalEnv();
  const FullGame = require("./full_game_all_personas");
  const materials = FullGame.loadMaterials();
  const sourceRows = orderedSourceRows();
  const paths = outputPaths(args.runId);
  const replayRows = await recalculateFormalRows(sourceRows, FullGame, materials);
  writeCsv(paths.replayCsv, replayRows, Object.keys(replayRows[0] || {
    chain_key: "", persona_id: "", persona_label: "", condition: "", rep: "", stored_price: "", replay_price: "", stored_profit: "", replay_profit: "", stored_loss: "", replay_loss: "", stored_cards: "", replay_cards: "", profit_delta: ""
  }));

  if ((args.mode === "chat" || args.mode === "satisfice" || args.mode === "dimension") && !args.summarizeOnly) {
    const client = require("../../server/llm/deepseekClient");
    if (!client.hasAnyKey()) throw new Error("DeepSeek key unavailable");
    const existing = existingChatRows(paths);
    const targetPool = args.onePerPersona
      ? PERSONA_ORDER.map((personaId) => sourceRows.find((row) => row.persona_id === personaId && row.condition === "Q" && Number(row.rep) === 1)).filter(Boolean)
      : sourceRows;
    const targets = targetPool
      .filter((row) => !args.chainKey || chainKey(row) === args.chainKey)
      .slice(0, args.limit)
      .filter((row) => args.force || existing.get(chainKey(row))?.status !== "OK");
    for (const sourceRow of targets) {
      const row = args.mode === "satisfice"
        ? await runSatisficeRow({ sourceRow, FullGame, materials, client, paths, force: args.force })
        : args.mode === "dimension"
          ? await runDimensionRow({ sourceRow, FullGame, materials, client, paths, force: args.force })
          : await runChatRow({ sourceRow, FullGame, materials, client, paths, force: args.force });
      console.log(`[${args.runId}] ${row.source_chain_key} ${row.status} base_profit=${Math.round(row.source_baseline?.profit ?? profitOf(sourceRow))} chat_profit=${Number.isFinite(profitOf(row)) ? Math.round(profitOf(row)) : "NA"} error=${row.error ? String(row.error).split("\n")[0] : ""}`);
    }
  }

  const chatRows = compactChatJsonl(paths).filter((row) => row.run_id === args.runId);
  writeCurrentFailures(paths, chatRows);
  const rowMetrics = buildRowMetrics(chatRows);
  writeCsv(paths.rowMetricsCsv, rowMetrics, Object.keys(rowMetrics[0] || {
    source_chain_key: "", persona_id: "", persona_label: "", condition: "", rep: "", baseline_cards: "", chat_cards: "", baseline_price: "", chat_price: "", baseline_profit: "", chat_profit: "", baseline_loss: "", chat_loss: "", price_delta: "", profit_delta: "", card_delta: "", d4_attempts: "", d5_attempts: ""
  }));
  fs.writeFileSync(paths.summary, buildSummary({ sourceRows, replayRows, chatRows }), "utf8");
  writeMeta(paths, args, envInfo, sourceRows, replayRows, chatRows);
  console.log(JSON.stringify({ run_id: args.runId, mode: args.mode, source_rows: sourceRows.length, chat_rows: chatRows.filter((row) => row.status === "OK").length, summary: paths.summary }, null, 2));
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.stack || error.message || String(error));
    process.exit(1);
  });
}
