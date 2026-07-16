"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { Pool } = require("pg");
const { ApiClient } = require("./api_client");
const { DEFAULT_PARAMS, GLOBAL_PARAMS, GRID_PARAMS, parseGridId } = require("../../server/llm/rdCalculator");

let deepseekClient = null;
let personaModules = null;

function getDeepSeekClient() {
  if (!deepseekClient) {
    deepseekClient = require("../../server/llm/deepseekClient");
  }
  return deepseekClient;
}

function getPersonaModules() {
  if (!personaModules) {
    const { PersonaStudent } = require("./persona_student");
    const { PERSONAS, sampleStudent } = require("./persona_pool");
    personaModules = { PersonaStudent, PERSONAS, sampleStudent };
  }
  return personaModules;
}

const BASE_URL = process.env.BASE_URL || "http://127.0.0.1:8787";
const ROOT = path.join(__dirname, "../..");
const LOG_ROOT = path.join(ROOT, "data/sim_logs/merged_v1");
const BENCHMARK_LOG_ROOT = path.join(ROOT, "data/sim_logs/decision_benchmark_v2");
const ROUND2_ENGINE_PARAMS_PATH = path.join(ROOT, "game_config_v0.1/round2_engine_params.json");
const ARCHITECTURES = ["Experience", "Hybrid", "Function"];
const SESSION_PREFIX = "sim_merged_v1_";
const MAX_LLM_RETRIES = 1;
const LLM_DELAY_MS = Number(process.env.MERGED_V1_LLM_DELAY_MS || 350);
const DEFAULT_PRICING_UI = {
  price_min: 1000,
  price_max: 6000,
  price_step: 100,
  default_price: 3500
};

const GRIDS = [
  "ToB_Differentiation_Elder",
  "ToB_Differentiation_Adult",
  "ToB_Differentiation_Child",
  "ToB_Cost_Elder",
  "ToB_Cost_Adult",
  "ToB_Cost_Child",
  "ToC_Differentiation_Elder",
  "ToC_Differentiation_Adult",
  "ToC_Differentiation_Child",
  "ToC_Cost_Elder",
  "ToC_Cost_Adult",
  "ToC_Cost_Child"
];

const CSV_COLUMNS = [
  "arm",
  "grid",
  "repeat",
  "sim_seed",
  "persona_id",
  "persona_label",
  "persona_name",
  "architecture",
  "team_id",
  "VP_C",
  "VP_G",
  "VP_E",
  "evi",
  "card_count",
  "low_count",
  "mid_count",
  "high_count",
  "tier_mean",
  "NRE_wan",
  "dCOGS",
  "price",
  "WTPref",
  "P_over_WTPref",
  "Q",
  "Meff",
  "Aw",
  "alpha",
  "X",
  "X_I",
  "X_fit",
  "X_sub",
  "X_risk",
  "X_complexity",
  "gamma_price_term",
  "z",
  "sigma_z",
  "BEQ",
  "BEQ_over_Meff",
  "profit",
  "matched_grid",
  "drifted",
  "llm_calls_failed",
  "json_retry_count",
  "validation_retry_count",
  "price_out_of_range",
  "selection_reason",
  "pricing_reason"
];

function loadLocalEnvFile() {
  const envPath = path.join(ROOT, ".env");
  if (!fs.existsSync(envPath)) return;
  const content = fs.readFileSync(envPath, "utf8");
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith("\"") && value.endsWith("\"")) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!Object.prototype.hasOwnProperty.call(process.env, key) || !String(process.env[key] || "").trim()) {
      process.env[key] = value;
    }
  }
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function csvValue(value) {
  if (value == null) return "";
  const text = typeof value === "object" ? JSON.stringify(value) : String(value);
  return /[,"\n]/.test(text) ? `"${text.replace(/"/g, "\"\"")}"` : text;
}

function writeCsv(filePath, columns, rows) {
  ensureDir(path.dirname(filePath));
  const lines = [columns.join(",")];
  for (const row of rows) {
    lines.push(columns.map((column) => csvValue(row[column])).join(","));
  }
  fs.writeFileSync(filePath, `${lines.join("\n")}\n`);
}

function loadPricingUiConfig() {
  let raw = {};
  try {
    raw = JSON.parse(fs.readFileSync(ROUND2_ENGINE_PARAMS_PATH, "utf8"));
  } catch (_) {
    raw = {};
  }
  const src = raw.pricing_ui && typeof raw.pricing_ui === "object" ? raw.pricing_ui : {};
  const min = Number(src.price_min ?? DEFAULT_PRICING_UI.price_min);
  const max = Number(src.price_max ?? DEFAULT_PRICING_UI.price_max);
  const step = Number(src.price_step ?? DEFAULT_PRICING_UI.price_step);
  const defaultPrice = Number(src.default_price ?? DEFAULT_PRICING_UI.default_price);
  if (!Number.isFinite(min) || !Number.isFinite(max) || !Number.isFinite(step) || !Number.isFinite(defaultPrice) || min <= 0 || max <= min || step <= 0) {
    throw new Error("round2 pricing_ui config invalid");
  }
  return {
    price_min: min,
    price_max: max,
    price_step: step,
    default_price: Math.max(min, Math.min(max, defaultPrice))
  };
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === "\"") {
        if (text[i + 1] === "\"") {
          field += "\"";
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === "\"") {
      inQuotes = true;
      continue;
    }
    if (ch === ",") {
      row.push(field);
      field = "";
      continue;
    }
    if (ch === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      continue;
    }
    if (ch !== "\r") field += ch;
  }
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  if (!rows.length) return [];
  const columns = rows[0];
  return rows.slice(1)
    .filter((item) => item.some((cell) => String(cell || "").trim()))
    .map((values) => {
      const out = {};
      columns.forEach((column, index) => {
        out[column] = values[index] ?? "";
      });
      return out;
    });
}

function safeNumber(value, fallback = null) {
  if (value == null || value === "") return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function round(value, digits = 2, fallback = "") {
  const n = safeNumber(value, null);
  if (n == null) return fallback;
  return Number(n.toFixed(digits));
}

function percentile(values, p) {
  const nums = values.map((value) => Number(value)).filter(Number.isFinite).sort((a, b) => a - b);
  if (!nums.length) return null;
  if (nums.length === 1) return nums[0];
  const rank = (p / 100) * (nums.length - 1);
  const lo = Math.floor(rank);
  const hi = Math.ceil(rank);
  if (lo === hi) return nums[lo];
  return nums[lo] + ((nums[hi] - nums[lo]) * (rank - lo));
}

function rankMap(items) {
  const sorted = [...items].sort((a, b) => b.value - a.value);
  const map = new Map();
  sorted.forEach((item, index) => map.set(item.grid, index + 1));
  return map;
}

function spearmanByGrid(currentItems, baselineItems) {
  const current = currentItems.filter((item) => Number.isFinite(Number(item.value)));
  const baseline = baselineItems.filter((item) => Number.isFinite(Number(item.value)));
  const common = current.map((item) => item.grid).filter((grid) => baseline.some((b) => b.grid === grid));
  if (common.length < 3) return null;
  const currentRanks = rankMap(current);
  const baselineRanks = rankMap(baseline);
  const n = common.length;
  const d2 = common.reduce((sum, grid) => {
    const d = Number(currentRanks.get(grid)) - Number(baselineRanks.get(grid));
    return sum + (d * d);
  }, 0);
  return 1 - ((6 * d2) / (n * ((n * n) - 1)));
}

function parseJsonObject(text) {
  const raw = String(text || "").replace(/```json|```/g, "").trim();
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  const candidate = start >= 0 && end > start ? raw.slice(start, end + 1) : raw;
  return JSON.parse(candidate);
}

function parseMaybeJson(value) {
  if (!value) return {};
  if (typeof value === "object") return value;
  if (typeof value !== "string") return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch (_) {
    return {};
  }
}

function parseGrid(gridId) {
  const raw = String(gridId || "");
  return {
    channel: /ToB|B2B/i.test(raw) ? "ToB" : "ToC",
    strategy: /Cost/i.test(raw) ? "成本领先" : "差异化",
    segment: /Elder/i.test(raw) ? "老人" : /Child/i.test(raw) ? "儿童" : "成人"
  };
}

function gridLabel(gridId) {
  const parsed = parseGrid(gridId);
  return `${parsed.channel} × ${parsed.strategy} × ${parsed.segment}`;
}

function canonicalGrid(gridId) {
  return String(gridId || "")
    .replace(/^B2B_/i, "ToB_")
    .replace(/^B2C_/i, "ToC_")
    .replace("_DIFF_", "_Differentiation_")
    .replace("_COST_", "_Cost_")
    .replace("_ADULT", "_Adult")
    .replace("_ELDER", "_Elder")
    .replace("_CHILD", "_Child");
}

function seededIndex(seedText, modulo) {
  let hash = 2166136261;
  for (const ch of String(seedText || "")) {
    hash ^= ch.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash >>> 0) % modulo;
}

function pickArchitecture(runId, gridId, repeatIndex = 0) {
  return ARCHITECTURES[seededIndex(`${runId}:${gridId}:${repeatIndex}`, ARCHITECTURES.length)];
}

function buildVpText(fields) {
  return [
    `WHO：${fields.who}`,
    `PAIN：${fields.pain}`,
    `HOW：${fields.how}`
  ].join("\n");
}

function toCardCatalog(cardsResponse) {
  const cards = [];
  for (const group of cardsResponse.groups || []) {
    for (const cap of group.capabilities || []) {
      cards.push({
        group_id: group.group_id,
        group_name: group.name,
        cap_id: cap.cap_id,
        name: cap.name,
        covers: cap.covers || [],
        nre: Number(cap.nre || 0),
        tiers: cap.tiers || {}
      });
    }
  }
  return cards;
}

function compactCardCatalog(cards) {
  return cards.map((card) => {
    const tiers = ["low", "mid", "high"].map((tier) => {
      const t = card.tiers?.[tier] || {};
      return `${tier}: dCOGS=${round(t.dCOGS, 1)}, NRE=${round(card.nre, 1)}万`;
    }).join("; ");
    return `- ${card.cap_id} | ${card.group_name} | ${card.name} | ${tiers} | covers=${(card.covers || []).join("/")}`;
  }).join("\n");
}

function validateSelectionShape(selection, validCardIds) {
  const errors = [];
  const seen = new Set();
  const items = Array.isArray(selection?.selections) ? selection.selections : [];
  for (const item of items) {
    const id = String(item?.cap_id || "").trim();
    const tier = String(item?.tier || "").trim();
    if (!validCardIds.has(id)) errors.push(`unknown cap_id: ${id}`);
    if (!["low", "mid", "high"].includes(tier)) errors.push(`invalid tier for ${id}: ${tier}`);
    if (seen.has(id)) errors.push(`duplicate cap_id: ${id}`);
    seen.add(id);
  }
  if (items.length < 8 || items.length > 10) errors.push(`selection count ${items.length}, expected 8-10`);
  if (!String(selection?.selection_reason || "").trim()) errors.push("missing selection_reason");
  if (!String(selection?.pricing_reason || "").trim()) errors.push("missing pricing_reason");
  const price = Number(selection?.price);
  if (!Number.isFinite(price) || price <= 0) errors.push(`invalid price: ${selection?.price}`);
  return errors;
}

function validateDecisionPrice(selection, pricingUi) {
  const price = Number(selection?.price);
  const min = Number(pricingUi.price_min);
  const max = Number(pricingUi.price_max);
  if (!Number.isFinite(price)) return [`invalid price: ${selection?.price}`];
  if (price < min || price > max) {
    return [`price ${price} out of slider range ${min}-${max}`];
  }
  return [];
}

function flattenReports(reports) {
  return reports.map((report, index) => {
    const title = String(report?.title || report?.persona_id || `P${index + 1}`);
    const text = String(report?.report_text || report?.summary_text || "");
    return `## P${index + 1}: ${title}\n${text}`;
  }).join("\n\n---\n\n");
}

function buildStudentSystemPrompt() {
  return [
    "你是一名认真参加 EMBA 教学模拟的学生。",
    "你不是完美专家，但会认真阅读材料、控制预算、解释取舍。",
    "所有输出必须是中文；需要 JSON 时只输出合法 JSON。"
  ].join("\n");
}

function buildDecisionTaskSystemText() {
  return [
    "你正在参加 EMBA 教学模拟的 R2 产品研发与定价决策。",
    "你不是完美专家，但会认真阅读材料、控制预算、解释取舍。",
    "所有输出必须是中文；需要 JSON 时只输出合法 JSON。"
  ].join("\n");
}

function buildDecisionSystemPrompt(personaContext) {
  const taskText = buildDecisionTaskSystemText();
  if (!personaContext?.systemPrompt) return taskText;
  return [
    personaContext.systemPrompt,
    "",
    taskText
  ].join("\n");
}

function pickPersonaId(gridId, repeatIndex) {
  const { PERSONAS } = getPersonaModules();
  const ids = Object.keys(PERSONAS);
  const key = `${gridId}:r${repeatIndex + 1}`;
  let hash = 0;
  for (const ch of key) hash = ((hash * 31) + ch.charCodeAt(0)) >>> 0;
  return ids[hash % ids.length] || ids[0];
}

function sampleAgeForPersona(persona) {
  const match = String(persona?.age || "").match(/(\d+)\D+(\d+)/);
  const min = match ? Number(match[1]) : 35;
  const max = match ? Number(match[2]) : min;
  return min + Math.floor(Math.random() * Math.max(1, max - min + 1));
}

function sampleGenderForPersona(persona) {
  const maleWeight = Number(persona?.genderDistribution?.male || 0.5);
  return Math.random() < maleWeight ? "male" : "female";
}

async function buildLayeredPersonaContext({ gridId, repeatIndex, teamIndex, memberIndex, rawDir }) {
  const { PersonaStudent, PERSONAS, sampleStudent } = getPersonaModules();
  const personaId = pickPersonaId(gridId, repeatIndex);
  const persona = PERSONAS[personaId];
  const age = sampleAgeForPersona(persona);
  const gender = sampleGenderForPersona(persona);
  const student = sampleStudent(personaId, age, gender);
  student.name = `${student.label || personaId}${repeatIndex + 1}${teamIndex + 1}`;
  const actor = new PersonaStudent({
    apiKey: process.env.DEEPSEEK_API_KEY || process.env.DEEPSEEK_API_KEY_1 || "",
    strictMode: true,
    student,
    teamIndex,
    memberIndex
  });
  await retryLayeredGeneration("generateSeedMemory", () => actor.generateSeedMemory());
  await retryLayeredGeneration("generateClassroomProfile", () => actor.generateClassroomProfile());
  const context = {
    persona_id: personaId,
    persona_label: student.label || "",
    persona_name: student.name || "",
    student,
    seed_memory: actor.seedMemory,
    classroom_profile: actor.classroomProfile,
    systemPrompt: actor.buildLayeredSystemPrompt()
  };
  fs.writeFileSync(path.join(rawDir, "layered_persona_context.json"), JSON.stringify(context, null, 2));
  return context;
}

async function retryLayeredGeneration(label, fn) {
  let lastError = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (attempt < 2) await sleep(500 + attempt * 500);
    }
  }
  throw new Error(`${label} failed after LLM retries: ${lastError?.message || lastError}`);
}

async function sleep(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

class StrictLlm {
  constructor(rawDir) {
    this.rawDir = rawDir;
    this.callsFailed = 0;
    this.jsonRetryCount = 0;
    this.calls = [];
    this.lastCallAt = 0;
  }

  async callJson(name, messages, options = {}) {
    let raw = "";
    let lastError = null;
    for (let attempt = 0; attempt <= 1; attempt += 1) {
      raw = await this.callText(attempt === 0 ? name : `${name}_json_retry`, attempt === 0 ? messages : [
        ...messages,
        {
          role: "user",
          content: [
            "上一次输出不是合法 JSON。请只输出修正后的合法 JSON，不要解释，不要 Markdown 代码块。",
            "必须正确转义字符串内部引号，不能遗漏结尾括号。",
            "",
            "上一次原输出：",
            raw
          ].join("\n")
        }
      ], attempt === 0 ? options : { ...options, temperature: 0.12, max_tokens: Math.max(Number(options.max_tokens || 1200), 1600) });
      try {
        return parseJsonObject(raw);
      } catch (err) {
        lastError = err;
        if (attempt === 0) this.jsonRetryCount += 1;
      }
    }
    throw lastError;
  }

  async callText(name, messages, options = {}) {
    const since = Date.now() - this.lastCallAt;
    if (since < LLM_DELAY_MS) await sleep(LLM_DELAY_MS - since);
    let lastError = null;
    for (let attempt = 0; attempt <= MAX_LLM_RETRIES; attempt += 1) {
      const startedAt = Date.now();
      try {
        const completion = await getDeepSeekClient().chatCompletion(messages, {
          temperature: options.temperature ?? 0.45,
          max_tokens: options.max_tokens ?? 1200,
          maxRetries: options.maxRetries ?? 1
        });
        this.lastCallAt = Date.now();
        const entry = {
          name,
          attempt,
          ok: true,
          duration_ms: Date.now() - startedAt,
          messages,
          completion
        };
        this.calls.push(entry);
        fs.writeFileSync(path.join(this.rawDir, `${String(this.calls.length).padStart(2, "0")}_${name}.json`), JSON.stringify(entry, null, 2));
        return completion;
      } catch (err) {
        lastError = err;
        this.callsFailed += 1;
        const entry = {
          name,
          attempt,
          ok: false,
          duration_ms: Date.now() - startedAt,
          messages,
          error: err.message || String(err)
        };
        this.calls.push(entry);
        fs.writeFileSync(path.join(this.rawDir, `${String(this.calls.length).padStart(2, "0")}_${name}_failed.json`), JSON.stringify(entry, null, 2));
      }
    }
    throw new Error(`LLM call failed: ${name}: ${lastError?.message || lastError}`);
  }
}

async function generateVpDraft(llm, gridId, architecture, simSeed) {
  const parsed = parseGrid(gridId);
  return llm.callJson("vp_draft", [
    { role: "system", content: buildStudentSystemPrompt() },
    { role: "user", content: [
      `本次模拟随机种子：${simSeed}`,
      `市场格子：${gridLabel(gridId)}`,
      `产品架构：${architecture}`,
      "",
      "请为 AI 宠物机器人的中国市场模拟写一个认真、具体的价值主张初稿。",
      "每个字段 50-100 个中文字，不能空泛，必须有具体触发场景和解决机制。",
      parsed.strategy === "差异化" ? "该格倾向体验/品质溢价，请体现差异化体验价值。" : "该格倾向成本/实用，请体现可规模化、够用、省心。",
      parsed.channel === "ToB" ? "这是机构/企业采购场景，WHO 要写采购/运营决策者。" : "这是个人/家庭消费场景，WHO 要写个人/家庭购买者。",
      "",
      "只输出 JSON：",
      "{\"who\":\"...\",\"pain\":\"...\",\"how\":\"...\"}"
    ].join("\n") }
  ], { max_tokens: 900, temperature: 0.42 });
}

async function reviseVp(llm, draft, feedback, gridId, architecture, simSeed) {
  return llm.callJson("vp_revision", [
    { role: "system", content: buildStudentSystemPrompt() },
    { role: "user", content: [
      `本次模拟随机种子：${simSeed}`,
      `市场格子：${gridLabel(gridId)}`,
      `产品架构：${architecture}`,
      "",
      "初稿：",
      `WHO：${draft.who}`,
      `PAIN：${draft.pain}`,
      `HOW：${draft.how}`,
      "",
      "系统反馈：",
      JSON.stringify(feedback || {}, null, 2),
      "",
      "请小幅修改 WHO/PAIN/HOW，保持原战略方向不变，但让表达更具体、更符合 Guide 要求。",
      "每个字段 50-100 个中文字。",
      "只输出 JSON：{\"who\":\"...\",\"pain\":\"...\",\"how\":\"...\"}"
    ].join("\n") }
  ], { max_tokens: 900, temperature: 0.38 });
}

async function chooseCardsAndPrice(llm, context) {
  const reportsText = flattenReports(context.reports);
  const pricingUi = context.pricingUi || DEFAULT_PRICING_UI;
  const prompt = [
    `市场格子：${gridLabel(context.gridId)}`,
    `本次模拟随机种子：${context.simSeed}`,
    `产品架构：${context.architecture}`,
    "",
    "三份客户调研报告全文：",
    reportsText,
    "",
    "能力卡清单（已经是 PRICE_SCALE=0.3 后的 dCOGS/NRE）：",
    compactCardCatalog(context.cards),
    "",
    "任务：",
    "1. 选择 8-10 张能力卡，每张给 low/mid/high 档位。",
    "2. 需要预算意识：解释 NRE 总额、单位 dCOGS 与可能销量/支付意愿之间的取舍。",
    `3. 定价必须遵守课堂 UI 滑块硬边界：最低 ¥${pricingUi.price_min}，最高 ¥${pricingUi.price_max}，步长 ¥${pricingUi.price_step}，默认停在 ¥${pricingUi.default_price}。`,
    "   这不是建议区间；低于最低值或高于最高值都会提交失败。请在滑块边界内自主决定价格。",
    "4. 不要为了高分全选高档；要像认真学生一样做取舍。",
    "",
    "只输出 JSON，格式：",
    "{",
    "  \"selections\": [{\"cap_id\":\"voice_basic\",\"tier\":\"mid\",\"reason\":\"为什么选\"}],",
    "  \"selection_reason\": \"总的选卡理由，80-160字\",",
    `  "price": ${pricingUi.default_price},`,
    "  \"pricing_reason\": \"定价理由，80-160字\"",
    "}"
  ].join("\n");
  return llm.callJson("card_price_decision", [
    { role: "system", content: buildDecisionSystemPrompt(context.personaContext) },
    { role: "user", content: prompt }
  ], { max_tokens: 2400, temperature: context.temperature ?? 0.35 });
}

async function chooseCardsAndPriceWithValidation(llm, context) {
  const validCardIds = new Set(context.cards.map((card) => card.cap_id));
  const pricingUi = context.pricingUi || DEFAULT_PRICING_UI;
  let validationRetryCount = 0;
  let decision = await chooseCardsAndPrice(llm, context);
  let errors = [
    ...validateSelectionShape(decision, validCardIds),
    ...validateDecisionPrice(decision, pricingUi)
  ];
  while (errors.length && validationRetryCount < 2) {
    validationRetryCount += 1;
    decision = await llm.callJson(`card_price_decision_validation_retry_${validationRetryCount}`, [
      { role: "system", content: buildDecisionSystemPrompt(context.personaContext) },
      { role: "user", content: [
        "上一次 JSON 不符合模拟约束，请只修正 JSON，不要解释。",
        `错误：${errors.join("; ")}`,
        "合法 cap_id 列表：",
        context.cards.map((card) => card.cap_id).join(", "),
        `价格硬边界：最低 ¥${pricingUi.price_min}，最高 ¥${pricingUi.price_max}，步长 ¥${pricingUi.price_step}，默认 ¥${pricingUi.default_price}。`,
        "price 必须落在硬边界内，不能由系统夹逼修正。",
        "原输出：",
        JSON.stringify(decision, null, 2),
        "",
        "要求：8-10 张、cap_id 必须来自列表、tier 只能 low/mid/high、price 必须在滑块边界内。"
      ].join("\n") }
    ], { max_tokens: 1800, temperature: 0.2 });
    errors = [
      ...validateSelectionShape(decision, validCardIds),
      ...validateDecisionPrice(decision, pricingUi)
    ];
  }
  if (errors.length) {
    throw new Error(`invalid LLM card/price decision after validation retries: ${errors.join("; ")}`);
  }
  return { decision, validationRetryCount };
}

async function queryOne(pool, sql, params = []) {
  const out = await pool.query(sql, params);
  return out.rows[0] || null;
}

async function readTeamMetrics(pool, teamId, sessionId) {
  const team = await queryOne(pool, `
    SELECT final_vp_c, final_vp_g, final_vp_e_raw, final_wtp_ref, final_wtp_adj, final_grid_id, final_architecture
    FROM teams
    WHERE id = $1
  `, [teamId]);
  const result = await queryOne(pool, `
    SELECT units, profit, profit_per_unit, best_grid, matched_grid, result_json
    FROM round2_results
    WHERE team_id = $1 AND session_id = $2
    ORDER BY computed_at DESC
    LIMIT 1
  `, [teamId, sessionId]);
  const radar = await queryOne(pool, `
    SELECT evi
    FROM fg_team_radar
    WHERE team_id = $1 AND session_id = $2
    LIMIT 1
  `, [teamId, sessionId]);
  return { team: team || {}, result: result || {}, radar: radar || {} };
}

function extractResultDetail(metrics, resultResponse) {
  const fromDb = parseMaybeJson(metrics?.result?.result_json);
  const fromApi = resultResponse?.result || {};
  return {
    ...fromApi,
    ...fromDb,
    detail: {
      ...(fromApi.detail || {}),
      ...(fromDb.detail || {})
    }
  };
}

async function configureSession(api, sessionId) {
  const code = String(process.env.ADMIN_CODE || process.env.TEACHER_CODE || "").trim();
  if (!code) throw new Error("ADMIN_CODE or TEACHER_CODE is required to configure session");
  return api.post("/api/teacher/session-config", {
    session_id: sessionId,
    config: {
      interview_mode: "summary",
      hold_before_r2: false,
      reveal_r1_results: true
    }
  }, {
    headers: { "x-teacher-code": code }
  }).catch(async () => {
    const res = await fetch(`${BASE_URL}/api/teacher/session-config`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-teacher-code": code },
      body: JSON.stringify({
        session_id: sessionId,
        config: { interview_mode: "summary", hold_before_r2: false, reveal_r1_results: true }
      })
    });
    const text = await res.text();
    const body = text ? JSON.parse(text) : {};
    if (!res.ok || body.ok === false) throw new Error(`session config failed: ${text}`);
    return body;
  });
}

function sigmoid(value) {
  return 1 / (1 + Math.exp(-Number(value || 0)));
}

function volumeDiagnostics(detail, gridId, price, matchedGrid) {
  const resultGrid = canonicalGrid(matchedGrid || gridId);
  let gridConfig = {};
  try {
    const parsed = parseGridId(resultGrid);
    gridConfig = GRID_PARAMS[`${parsed.channel}_${parsed.age}`] || {};
  } catch (_) {
    gridConfig = {};
  }
  const wtpRef = safeNumber(detail.WTPref_adjusted, safeNumber(detail.WTPref, null));
  const gammaEff = safeNumber(detail.gammaEff, safeNumber(detail.gamma, null));
  const xI = DEFAULT_PARAMS.wI * safeNumber(detail.I, 0);
  const xFit = DEFAULT_PARAMS.wfit * safeNumber(detail.fit, 0);
  const xSub = DEFAULT_PARAMS.wsub * safeNumber(detail.subLift, 0);
  const xRisk = DEFAULT_PARAMS.wrisk * safeNumber(detail.risk, 0);
  const xComplexity = DEFAULT_PARAMS.wcx * safeNumber(detail.complexity, 0);
  const x = safeNumber(detail.X, xI + xFit + xSub + xRisk + xComplexity);
  const gammaPriceTerm = wtpRef && gammaEff != null ? gammaEff * Number(price || 0) / wtpRef : null;
  const z = safeNumber(detail.z, gammaPriceTerm == null ? null : Number(GLOBAL_PARAMS.alpha || 0) + x - gammaPriceTerm);
  const sigmaZ = safeNumber(detail.adoption, z == null ? null : sigmoid(z));
  return {
    Meff: safeNumber(detail.Meff, null),
    Aw: safeNumber(gridConfig.Aw, null),
    alpha: safeNumber(GLOBAL_PARAMS.alpha, null),
    X: x,
    X_I: xI,
    X_fit: xFit,
    X_sub: xSub,
    X_risk: xRisk,
    X_complexity: xComplexity,
    gamma_price_term: gammaPriceTerm,
    z,
    sigma_z: sigmaZ
  };
}

function roundedVolumeDiagnostics(detail, gridId, price, matchedGrid) {
  const diag = volumeDiagnostics(detail, gridId, price, matchedGrid);
  return {
    Meff: round(diag.Meff, 2),
    Aw: round(diag.Aw, 4),
    alpha: round(diag.alpha, 4),
    X: round(diag.X, 4),
    X_I: round(diag.X_I, 4),
    X_fit: round(diag.X_fit, 4),
    X_sub: round(diag.X_sub, 4),
    X_risk: round(diag.X_risk, 4),
    X_complexity: round(diag.X_complexity, 4),
    gamma_price_term: round(diag.gamma_price_term, 4),
    z: round(diag.z, 4),
    sigma_z: round(diag.sigma_z, 6)
  };
}

function tierStats(selections) {
  const counts = { low: 0, mid: 0, high: 0 };
  const score = { low: 1, mid: 2, high: 3 };
  for (const item of selections || []) {
    const tier = String(item?.tier || "").toLowerCase();
    if (Object.prototype.hasOwnProperty.call(counts, tier)) counts[tier] += 1;
  }
  const total = counts.low + counts.mid + counts.high;
  const mean = total > 0
    ? ((counts.low * score.low) + (counts.mid * score.mid) + (counts.high * score.high)) / total
    : null;
  return {
    low_count: counts.low,
    mid_count: counts.mid,
    high_count: counts.high,
    tier_mean: mean == null ? "" : round(mean, 4)
  };
}

async function runGrid({ api, pool, parentRunId, runId, sessionId, gridId, index, repeatIndex, cards, runDir, arm = "simple" }) {
  const simSeed = `${runId}:${arm}:${gridId}:r${repeatIndex + 1}`;
  const gridDir = path.join(runDir, "raw_llm", arm, `r${repeatIndex + 1}_${String(index + 1).padStart(2, "0")}_${gridId}`);
  ensureDir(gridDir);
  const llm = new StrictLlm(gridDir);
  const architecture = pickArchitecture(parentRunId, gridId, repeatIndex);
  const teamName = `${arm}_v2_r${repeatIndex + 1}_${index + 1}_${gridId}_${Date.now()}`;
  const rowBase = { arm, grid: gridId, repeat: repeatIndex + 1, sim_seed: simSeed, architecture, llm_calls_failed: 0, json_retry_count: 0, validation_retry_count: 0 };
  const pricingUi = loadPricingUiConfig();
  let validationRetryCount = 0;

  try {
    const personaContext = arm === "layered"
      ? await buildLayeredPersonaContext({ gridId, repeatIndex, teamIndex: index, memberIndex: 0, rawDir: gridDir })
      : null;
    const teamRes = await api.createTeam(teamName, 1);
    const teamId = teamRes.team?.id;
    const memberId = teamRes.team?.members?.[0]?.id;
    if (!teamId || !memberId) throw new Error("createTeam response missing team/member id");

    const draft = await generateVpDraft(llm, gridId, architecture, simSeed);
    await api.submitPhase1(teamId, memberId, {
      grid_id: gridId,
      architecture,
      who: draft.who,
      pain: draft.pain,
      how: draft.how
    });

    const feedback = await api.post("/api/round1/vp-feedback", {
      team_id: teamId,
      member_id: memberId,
      grid_id: gridId,
      architecture,
      who: draft.who,
      pain: draft.pain,
      how: draft.how
    }, { timeoutMs: 90000 });

    const revised = await reviseVp(llm, draft, feedback.feedback || feedback, gridId, architecture, simSeed);
    await api.post("/api/round1/vp-submit", {
      team_id: teamId,
      member_id: memberId,
      grid_id: gridId,
      architecture,
      accepted_feedback: true,
      who: revised.who,
      pain: revised.pain,
      how: revised.how
    }, { timeoutMs: 90000 });

    const frozenScores = await queryOne(pool, `
      SELECT final_vp_c, final_vp_g, final_vp_e_raw
      FROM teams
      WHERE id = $1
    `, [teamId]);
    await api.finalizeVP(teamId, {
      memberId,
      grid_id: gridId,
      architecture,
      vp_text: buildVpText(revised),
      confirmed_fields: {
        who_raw: revised.who,
        pain_raw: revised.pain,
        how_raw: revised.how
      },
      scores: {
        coverage: Number(frozenScores?.final_vp_c || 3),
        generalizability: Number(frozenScores?.final_vp_g || 3),
        effectiveness: Number(frozenScores?.final_vp_e_raw || 3)
      }
    });
    await api.freezeTeam(teamId, { memberId });

    await api.post("/api/round2/assign-dimensions", {
      teamId,
      memberCount: 1,
      session_id: sessionId
    });

    const reports = [];
    for (let reportIndex = 0; reportIndex < 3; reportIndex += 1) {
      const reportRes = await api.get(`/api/round2/persona-report/${reportIndex}?${new URLSearchParams({
        teamId,
        memberId,
        session_id: sessionId
      }).toString()}`);
      reports.push(reportRes.report);
    }
    await api.post("/api/round2/complete-reading", { teamId, memberId, session_id: sessionId });

    const recap = await api.get(`/api/round2/recap?${new URLSearchParams({
      teamId,
      memberId,
      session_id: sessionId
    }).toString()}`);

    const decisionResult = await chooseCardsAndPriceWithValidation(llm, {
      gridId,
      architecture,
      simSeed,
      temperature: 0.3 + (repeatIndex * 0.18),
      reports,
      cards,
      recap,
      personaContext,
      pricingUi
    });
    const decision = decisionResult.decision;
    validationRetryCount = decisionResult.validationRetryCount;
    fs.writeFileSync(path.join(gridDir, "decision_compact.json"), JSON.stringify(decision, null, 2));

    const selections = decision.selections.map((item) => ({
      cap_id: String(item.cap_id),
      tier: String(item.tier)
    }));
    const tiers = tierStats(selections);
    await api.post("/api/round2/member-selection", {
      teamId,
      memberId,
      sessionId,
      selections
    });
    const merge = await api.post("/api/round2/merge", {
      teamId,
      memberId,
      sessionId,
      COGSbase: recap.COGSbase || 600
    });
    await api.post("/api/round2/team-draft", {
      teamId,
      memberId,
      price: Number(decision.price),
      selections: merge.teamSelections || selections
    });
    const submit = await api.post("/api/round2/team-submit", {
      teamId,
      memberId,
      sessionId,
      price: Number(decision.price),
      selections: merge.teamSelections || selections,
      mergedInterview: merge.mergedInterview,
      bestGrid: gridId
    }, { timeoutMs: 120000 });
    const teamResult = await api.get(`/api/round2/team-result?teamId=${encodeURIComponent(teamId)}&sessionId=${encodeURIComponent(sessionId)}`);
    const metrics = await readTeamMetrics(pool, teamId, sessionId);
    const detail = extractResultDetail(metrics, teamResult);
    const resultDetail = detail.detail || {};
    const matchedGrid = canonicalGrid(metrics.result.matched_grid || detail.matched_grid || detail.best_grid || "");
    const selectedGrid = canonicalGrid(gridId);
    const price = Number(decision.price);
    const wtpRef = safeNumber(resultDetail.WTPref_adjusted, safeNumber(resultDetail.WTPref, safeNumber(recap.Pmax, null)));
    const q = safeNumber(detail.units, safeNumber(metrics.result.units, null));
    const beq = safeNumber(detail.breakeven_q, safeNumber(resultDetail.breakeven_q, null));
    const meff = safeNumber(detail.Meff, safeNumber(resultDetail.Meff, null));
    const evi = safeNumber(metrics.radar.evi, safeNumber(merge?.mergedInterview?.evi, null));
    const volumeDiag = roundedVolumeDiagnostics(detail, gridId, price, matchedGrid);
    return {
      ...rowBase,
      persona_id: personaContext?.persona_id || "",
      persona_label: personaContext?.persona_label || "",
      persona_name: personaContext?.persona_name || "",
      team_id: teamId,
      VP_C: round(metrics.team.final_vp_c, 2),
      VP_G: round(metrics.team.final_vp_g, 2),
      VP_E: round(metrics.team.final_vp_e_raw, 2),
      evi: round(evi, 4),
      card_count: selections.length,
      ...tiers,
      NRE_wan: round(detail.nre_total_wan ?? detail.NRE ?? resultDetail.NRE ?? resultDetail.totalNREWan, 2),
      dCOGS: round(detail.dCOGS ?? resultDetail.dCOGS, 2),
      price,
      WTPref: round(wtpRef, 2),
      P_over_WTPref: wtpRef ? round(price / wtpRef, 4) : "",
      Q: round(q, 2),
      ...volumeDiag,
      BEQ: beq == null ? "" : beq,
      BEQ_over_Meff: beq != null && meff ? round(beq / meff, 4) : "",
      profit: round(safeNumber(metrics.result.profit, safeNumber(detail.profit, submit.result?.profit)), 2),
      matched_grid: matchedGrid,
      drifted: matchedGrid ? String(matchedGrid !== selectedGrid) : "",
      llm_calls_failed: llm.callsFailed,
      json_retry_count: llm.jsonRetryCount,
      validation_retry_count: validationRetryCount,
      price_out_of_range: String(price < pricingUi.price_min || price > pricingUi.price_max),
      selection_reason: String(decision.selection_reason || "").trim(),
      pricing_reason: String(decision.pricing_reason || "").trim(),
      selections,
      reports: reports.map((report) => ({
        persona_id: report?.persona_id,
        title: report?.title
      }))
    };
  } catch (err) {
    return {
      ...rowBase,
      team_id: "",
      llm_calls_failed: llm.callsFailed,
      json_retry_count: llm.jsonRetryCount,
      validation_retry_count: validationRetryCount,
      error: err.message || String(err)
    };
  }
}

async function rebuildRunFromDb(pool, runDir) {
  const summaryPath = path.join(runDir, "summary.json");
  if (!fs.existsSync(summaryPath)) {
    throw new Error(`summary.json not found: ${summaryPath}`);
  }
  const stored = JSON.parse(fs.readFileSync(summaryPath, "utf8"));
  const rows = [];
  for (const row of stored.rows || []) {
    if (!row.team_id || row.error) {
      rows.push(row);
      continue;
    }
    const metrics = await readTeamMetrics(pool, row.team_id, stored.sessionId);
    const detail = extractResultDetail(metrics, {});
    const resultDetail = detail.detail || {};
    const price = Number(row.price);
    const wtpRef = safeNumber(detail.WTPref_adjusted, safeNumber(detail.WTPref, safeNumber(row.WTPref, null)));
    const q = safeNumber(detail.units, safeNumber(metrics.result.units, null));
    const beq = safeNumber(detail.breakeven_q, null);
    const meff = safeNumber(detail.Meff, null);
    const matchedGrid = canonicalGrid(metrics.result.matched_grid || detail.matched_grid || detail.best_grid || "");
    const volumeDiag = roundedVolumeDiagnostics(detail, row.grid, price, matchedGrid);
    rows.push({
      ...row,
      VP_C: round(metrics.team.final_vp_c, 2),
      VP_G: round(metrics.team.final_vp_g, 2),
      VP_E: round(metrics.team.final_vp_e_raw, 2),
      evi: round(metrics.radar.evi, 4),
      NRE_wan: round(detail.nre_total_wan ?? detail.NRE ?? resultDetail.NRE ?? resultDetail.totalNREWan, 2),
      dCOGS: round(detail.dCOGS ?? resultDetail.dCOGS, 2),
      WTPref: round(wtpRef, 2),
      P_over_WTPref: wtpRef ? round(price / wtpRef, 4) : "",
      Q: round(q, 2),
      ...volumeDiag,
      BEQ: beq == null ? "" : beq,
      BEQ_over_Meff: beq != null && meff ? round(beq / meff, 4) : "",
      profit: round(safeNumber(metrics.result.profit, safeNumber(detail.profit, row.profit)), 2),
      matched_grid: matchedGrid,
      drifted: matchedGrid ? String(matchedGrid !== canonicalGrid(row.grid)) : row.drifted
    });
  }

  const baseline = findBaselineRows();
  const summary = buildSummary(rows, baseline);
  const csvPath = path.join(runDir, "summary.csv");
  writeCsv(csvPath, CSV_COLUMNS, rows);
  fs.writeFileSync(summaryPath, JSON.stringify({ ...stored, summary, rows }, null, 2));
  const md = summaryMarkdown(stored.runId, stored.sessionId, rows, summary, csvPath);
  fs.writeFileSync(path.join(runDir, "summary.md"), md);
  return md;
}

async function resumeFailedRun(runDir) {
  const summaryPath = path.join(runDir, "summary.json");
  if (!fs.existsSync(summaryPath)) {
    throw new Error(`summary.json not found: ${summaryPath}`);
  }
  const stored = JSON.parse(fs.readFileSync(summaryPath, "utf8"));
  const runId = stored.runId;
  const sessionId = stored.sessionId;
  const api = new ApiClient(BASE_URL, { retries: 1, timeoutMs: 120000 });
  const pool = new Pool({
    host: process.env.PGHOST || process.env.POSTGRES_HOST || "127.0.0.1",
    port: Number(process.env.PGPORT || process.env.POSTGRES_PORT || 5432),
    database: process.env.PGDATABASE || process.env.POSTGRES_DB || "emba_sim",
    user: process.env.PGUSER || process.env.POSTGRES_USER || process.env.USER,
    password: process.env.PGPASSWORD || process.env.POSTGRES_PASSWORD || undefined
  });
  try {
    await api.health();
    await configureSession(api, sessionId);
    const cards = toCardCatalog(await api.getRDCards());
    const rows = Array.isArray(stored.rows) ? stored.rows.slice() : [];
    for (let index = 0; index < rows.length; index += 1) {
      const row = rows[index];
      if (!row?.error) continue;
      const gridId = String(row.grid || "").trim();
      const gridIndex = GRIDS.findIndex((grid) => canonicalGrid(grid) === canonicalGrid(gridId));
      const repeatIndex = Math.max(0, Number(row.repeat || 1) - 1);
      if (gridIndex < 0) throw new Error(`cannot resume unknown grid: ${gridId}`);
      console.log(`[merged_v1] resume failed ${gridId} repeat ${repeatIndex + 1}`);
      rows[index] = await runGrid({ api, pool, runId, sessionId, gridId, index: gridIndex, repeatIndex, cards, runDir });
      fs.writeFileSync(path.join(runDir, "partial_rows.json"), JSON.stringify(rows, null, 2));
    }
    const baseline = findBaselineRows();
    const summary = buildSummary(rows, baseline);
    const csvPath = path.join(runDir, "summary.csv");
    writeCsv(csvPath, CSV_COLUMNS, rows);
    fs.writeFileSync(summaryPath, JSON.stringify({ ...stored, summary, rows }, null, 2));
    const md = summaryMarkdown(runId, sessionId, rows, summary, csvPath);
    fs.writeFileSync(path.join(runDir, "summary.md"), md);
    return md;
  } finally {
    await pool.end().catch(() => {});
  }
}

function findBaselineRows() {
  const roots = [
    path.join(ROOT, "data/persona_sim_logs"),
    path.join(ROOT, "data/sim_logs")
  ];
  const candidates = [];
  for (const root of roots) {
    if (!fs.existsSync(root)) continue;
    const stack = [root];
    while (stack.length) {
      const current = stack.pop();
      for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
        const full = path.join(current, entry.name);
        if (entry.isDirectory()) stack.push(full);
        else if (entry.name === "teams_summary.csv") candidates.push(full);
      }
    }
  }
  candidates.sort().reverse();
  for (const filePath of candidates) {
    const rows = parseCsv(fs.readFileSync(filePath, "utf8"));
    const byGrid = new Map();
    for (const row of rows) {
      const grid = canonicalGrid(row.grid || row.r1_grid);
      const profit = safeNumber(row.r2_profit);
      if (grid && Number.isFinite(profit)) byGrid.set(grid, profit);
    }
    if (byGrid.size >= 12) {
      return {
        filePath,
        items: Array.from(byGrid.entries()).map(([grid, value]) => ({ grid, value }))
      };
    }
  }
  return { filePath: "", items: [] };
}

function buildSummary(rows, baseline) {
  const completed = rows.filter((row) => !row.error);
  const profits = completed.map((row) => safeNumber(row.profit)).filter(Number.isFinite);
  const beqRatios = completed.map((row) => safeNumber(row.BEQ_over_Meff)).filter(Number.isFinite);
  const driftCount = completed.filter((row) => String(row.drifted).toLowerCase() === "true").length;
  const lossCount = completed.filter((row) => safeNumber(row.profit, 0) < 0).length;
  const currentItems = completed.map((row) => ({ grid: canonicalGrid(row.grid), value: safeNumber(row.profit, NaN) }));
  const spearman = baseline.items.length ? spearmanByGrid(currentItems, baseline.items) : null;
  const byGrid = {};
  for (const grid of GRIDS) {
    const gridRows = completed.filter((row) => canonicalGrid(row.grid) === canonicalGrid(grid));
    const values = gridRows
      .map((row) => safeNumber(row.profit))
      .filter(Number.isFinite);
    byGrid[grid] = {
      n: values.length,
      min: percentile(values, 0),
      median: percentile(values, 50),
      max: percentile(values, 100),
      profitable: gridRows.filter((row) => safeNumber(row.profit, 0) > 0).length,
      profitable_rate: gridRows.length ? gridRows.filter((row) => safeNumber(row.profit, 0) > 0).length / gridRows.length : null
    };
  }
  return {
    total: rows.length,
    completed: completed.length,
    failed: rows.length - completed.length,
    profit_min: percentile(profits, 0),
    profit_median: percentile(profits, 50),
    profit_max: percentile(profits, 100),
    profitable_count: completed.filter((row) => safeNumber(row.profit, 0) > 0).length,
    profitable_rate: completed.length ? completed.filter((row) => safeNumber(row.profit, 0) > 0).length / completed.length : null,
    loss_count: lossCount,
    price_wtp_histogram: buildHistogram(
      completed.map((row) => safeNumber(row.P_over_WTPref)).filter(Number.isFinite),
      [0, 0.4, 0.55, 0.7, 0.85, 1, 1.2, Infinity]
    ),
    tier_mean_min: percentile(completed.map((row) => safeNumber(row.tier_mean)).filter(Number.isFinite), 0),
    tier_mean_median: percentile(completed.map((row) => safeNumber(row.tier_mean)).filter(Number.isFinite), 50),
    tier_mean_max: percentile(completed.map((row) => safeNumber(row.tier_mean)).filter(Number.isFinite), 100),
    nre_min: percentile(completed.map((row) => safeNumber(row.NRE_wan)).filter(Number.isFinite), 0),
    nre_median: percentile(completed.map((row) => safeNumber(row.NRE_wan)).filter(Number.isFinite), 50),
    nre_max: percentile(completed.map((row) => safeNumber(row.NRE_wan)).filter(Number.isFinite), 100),
    beq_meff_min: percentile(beqRatios, 0),
    beq_meff_median: percentile(beqRatios, 50),
    beq_meff_max: percentile(beqRatios, 100),
    drift_count: driftCount,
    drift_rate: completed.length ? driftCount / completed.length : null,
    spearman_baseline: spearman,
    baseline_file: baseline.filePath || "",
    by_grid_profit: byGrid
  };
}

function buildHistogram(values, edges) {
  const buckets = [];
  for (let i = 0; i < edges.length - 1; i += 1) {
    const lo = edges[i];
    const hi = edges[i + 1];
    const label = hi === Infinity ? `>=${lo}` : `${lo}-${hi}`;
    buckets.push({
      bucket: label,
      min: lo,
      max: hi === Infinity ? null : hi,
      count: values.filter((value) => value >= lo && value < hi).length
    });
  }
  return buckets;
}

function markdownTable(rows) {
  const headers = ["grid", "rep", "VP C/G/E", "evi", "选卡数", "NRE", "dCOGS", "P", "WTPref", "P/WTP", "Q", "σ(z)", "BEQ", "利润", "matched_grid", "跑偏?"];
  const lines = [
    `| ${headers.join(" | ")} |`,
    `| ${headers.map(() => "---").join(" | ")} |`
  ];
  for (const row of rows) {
    lines.push([
      row.grid,
      row.repeat ?? "",
      row.error ? `ERR: ${row.error}` : `${row.VP_C}/${row.VP_G}/${row.VP_E}`,
      row.evi ?? "",
      row.card_count ?? "",
      row.NRE_wan ?? "",
      row.dCOGS ?? "",
      row.price ?? "",
      row.WTPref ?? "",
      row.P_over_WTPref ?? "",
      row.Q ?? "",
      row.sigma_z ?? "",
      row.BEQ ?? "",
      row.profit ?? "",
      row.matched_grid ?? "",
      row.drifted ?? ""
    ].map((cell) => String(cell ?? "").replace(/\|/g, "\\|")).join(" | "));
  }
  return lines.join("\n");
}

function gridProfitMarkdown(summary) {
  const lines = [
    "| grid | n | profitable | profit min | profit median | profit max |",
    "| --- | --- | --- | --- | --- | --- |"
  ];
  for (const grid of GRIDS) {
    const item = summary.by_grid_profit?.[grid] || {};
    lines.push([
      grid,
      item.n ?? 0,
      item.n ? `${item.profitable || 0}/${item.n} (${round((item.profitable_rate || 0) * 100, 1)}%)` : "0/0",
      round(item.min, 2),
      round(item.median, 2),
      round(item.max, 2)
    ].join(" | "));
  }
  return lines.join("\n");
}

function reasonsMarkdown(rows) {
  return rows.map((row) => [
    `### ${row.grid} / repeat ${row.repeat ?? ""}`,
    row.error ? `失败：${row.error}` : "",
    row.selections ? `选卡：${row.selections.map((item) => `${item.cap_id}:${item.tier}`).join(", ")}` : "",
    row.selection_reason ? `选卡理由：${row.selection_reason}` : "",
    row.pricing_reason ? `定价理由：${row.pricing_reason}` : ""
  ].filter(Boolean).join("\n")).join("\n\n");
}

function summaryMarkdown(runId, sessionId, rows, summary, csvPath) {
  return [
    `# merged_v1 simulation summary`,
    "",
    `- run_id: ${runId}`,
    `- session_id: ${sessionId}`,
    `- csv: ${csvPath}`,
    `- baseline: ${summary.baseline_file || "NA"}`,
    "",
    "## 摘要统计",
    "",
    `- 完成：${summary.completed}/${summary.total}，失败：${summary.failed}`,
    `- 盈利率：${summary.profitable_count || 0}/${summary.completed} = ${summary.profitable_rate == null ? "NA" : `${round(summary.profitable_rate * 100, 1)}%`}`,
    `- 利润分布：min=${round(summary.profit_min, 2)} / median=${round(summary.profit_median, 2)} / max=${round(summary.profit_max, 2)}；亏损 runs=${summary.loss_count}`,
    `- 定价 P/WTPref 直方图：${(summary.price_wtp_histogram || []).map((item) => `${item.bucket}:${item.count}`).join("，")}`,
    `- 选卡 tier_mean：min=${round(summary.tier_mean_min, 4)} / median=${round(summary.tier_mean_median, 4)} / max=${round(summary.tier_mean_max, 4)}；NRE(万)：min=${round(summary.nre_min, 2)} / median=${round(summary.nre_median, 2)} / max=${round(summary.nre_max, 2)}`,
    `- BEQ/Meff：min=${round(summary.beq_meff_min, 4)} / median=${round(summary.beq_meff_median, 4)} / max=${round(summary.beq_meff_max, 4)}`,
    `- 跑偏率：${summary.drift_count}/${summary.completed} = ${summary.drift_rate == null ? "NA" : `${round(summary.drift_rate * 100, 1)}%`}`,
    `- 与 baseline 利润排序 Spearman：${summary.spearman_baseline == null ? "NA" : round(summary.spearman_baseline, 4)}`,
    "",
    "## 12 格摘要表",
    "",
    markdownTable(rows),
    "",
    "## 每格 3 次利润分布",
    "",
    gridProfitMarkdown(summary),
    "",
    "## 每格选卡/定价理由",
    "",
    reasonsMarkdown(rows),
    ""
  ].join("\n");
}

function writeRunArtifacts({ runDir, runId, sessionId, repeatCount, rows, baseline, title = "merged_v1 simulation summary" }) {
  const summary = buildSummary(rows, baseline);
  const csvPath = path.join(runDir, "summary.csv");
  writeCsv(csvPath, CSV_COLUMNS, rows);
  fs.writeFileSync(path.join(runDir, "summary.json"), JSON.stringify({ runId, sessionId, repeatCount, summary, rows }, null, 2));
  const md = summaryMarkdown(runId, sessionId, rows, summary, csvPath).replace("# merged_v1 simulation summary", `# ${title}`);
  fs.writeFileSync(path.join(runDir, "summary.md"), md);
  return { summary, csvPath, md };
}

async function runArm({ arm, api, pool, parentRunDir, parentRunId, repeatCount }) {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const runId = `${parentRunId}_${arm}`;
  const sessionId = `sim_${arm}_v2_${timestamp}`;
  const runDir = path.join(parentRunDir, arm);
  ensureDir(runDir);
  ensureDir(path.join(runDir, "raw_llm", arm));
  await configureSession(api, sessionId);
  const cardsResponse = await api.getRDCards();
  const cards = toCardCatalog(cardsResponse);
  fs.writeFileSync(path.join(runDir, "cards_snapshot.json"), JSON.stringify(cardsResponse, null, 2));

  const rows = [];
  for (let repeatIndex = 0; repeatIndex < repeatCount; repeatIndex += 1) {
    for (let i = 0; i < GRIDS.length; i += 1) {
      const gridId = GRIDS[i];
      console.log(`[benchmark_v2:${arm}] r${repeatIndex + 1}/${repeatCount} ${i + 1}/${GRIDS.length} ${gridId}`);
      const row = await runGrid({ api, pool, parentRunId, runId, sessionId, gridId, index: i, repeatIndex, cards, runDir, arm });
      rows.push(row);
      fs.writeFileSync(path.join(runDir, "partial_rows.json"), JSON.stringify(rows, null, 2));
      if (row.error) {
        console.error(`[benchmark_v2:${arm}] r${repeatIndex + 1} ${gridId} failed: ${row.error}`);
      } else {
        console.log(`[benchmark_v2:${arm}] r${repeatIndex + 1} ${gridId} profit=${row.profit} price=${row.price} cards=${row.card_count}`);
      }
    }
  }

  const baseline = findBaselineRows();
  const artifacts = writeRunArtifacts({
    runDir,
    runId,
    sessionId,
    repeatCount,
    rows,
    baseline,
    title: `decision benchmark v2 - ${arm}`
  });
  return { arm, runId, sessionId, runDir, rows, ...artifacts };
}

function comparisonMarkdown(parentRunId, armResults) {
  const byArm = new Map(armResults.map((item) => [item.arm, item]));
  const lines = [
    "# decision benchmark v2 comparison",
    "",
    `- run_id: ${parentRunId}`,
    `- generated_at: ${new Date().toISOString()}`,
    "",
    "## Arm Summary",
    "",
    "| arm | completed | failed | profitable | profit min | profit median | profit max | tier median | NRE median | csv |",
    "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |"
  ];
  for (const result of armResults) {
    const s = result.summary || {};
    lines.push([
      result.arm,
      s.completed ?? 0,
      s.failed ?? 0,
      `${s.profitable_count || 0}/${s.completed || 0} (${s.profitable_rate == null ? "NA" : `${round(s.profitable_rate * 100, 1)}%`})`,
      round(s.profit_min, 2),
      round(s.profit_median, 2),
      round(s.profit_max, 2),
      round(s.tier_mean_median, 4),
      round(s.nre_median, 2),
      result.csvPath
    ].join(" | "));
  }
  lines.push("", "## Grid Profitability", "");
  lines.push("| grid | simple profitable | layered profitable | simple median | layered median |");
  lines.push("| --- | ---: | ---: | ---: | ---: |");
  for (const grid of GRIDS) {
    const simple = byArm.get("simple")?.summary?.by_grid_profit?.[grid] || {};
    const layered = byArm.get("layered")?.summary?.by_grid_profit?.[grid] || {};
    lines.push([
      grid,
      simple.n ? `${simple.profitable || 0}/${simple.n}` : "0/0",
      layered.n ? `${layered.profitable || 0}/${layered.n}` : "0/0",
      round(simple.median, 2),
      round(layered.median, 2)
    ].join(" | "));
  }
  lines.push("", "## P/WTPref Histogram", "");
  for (const result of armResults) {
    lines.push(`### ${result.arm}`);
    lines.push("| bucket | count |");
    lines.push("| --- | ---: |");
    for (const item of result.summary?.price_wtp_histogram || []) {
      lines.push(`| ${item.bucket} | ${item.count} |`);
    }
    lines.push("");
  }
  return `${lines.join("\n")}\n`;
}

async function runBenchmarkV2() {
  if (!getDeepSeekClient().hasAnyKey()) {
    throw new Error("DeepSeek key missing; strict benchmark requires DEEPSEEK_API_KEY or DEEPSEEK_API_KEY_1..N");
  }
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const parentRunId = process.env.RUN_ID || `benchmark_v2_${timestamp}`;
  const parentRunDir = path.join(BENCHMARK_LOG_ROOT, parentRunId);
  const repeatsArgIndex = process.argv.indexOf("--repeats");
  const repeatCount = Math.max(1, Number(repeatsArgIndex >= 0 ? process.argv[repeatsArgIndex + 1] : process.env.BENCHMARK_V2_REPEATS || 5) || 5);
  ensureDir(parentRunDir);

  const api = new ApiClient(BASE_URL, { retries: 1, timeoutMs: 120000 });
  const pool = new Pool({
    host: process.env.PGHOST || process.env.POSTGRES_HOST || "127.0.0.1",
    port: Number(process.env.PGPORT || process.env.POSTGRES_PORT || 5432),
    database: process.env.PGDATABASE || process.env.POSTGRES_DB || "emba_sim",
    user: process.env.PGUSER || process.env.POSTGRES_USER || process.env.USER,
    password: process.env.PGPASSWORD || process.env.POSTGRES_PASSWORD || undefined
  });
  try {
    await api.health();
    const armResults = [];
    for (const arm of ["simple", "layered"]) {
      armResults.push(await runArm({ arm, api, pool, parentRunDir, parentRunId, repeatCount }));
    }
    const md = comparisonMarkdown(parentRunId, armResults);
    fs.writeFileSync(path.join(parentRunDir, "comparison.md"), md);
    fs.writeFileSync(path.join(parentRunDir, "comparison.json"), JSON.stringify({
      runId: parentRunId,
      generated_at: new Date().toISOString(),
      arms: armResults.map((item) => ({
        arm: item.arm,
        runId: item.runId,
        sessionId: item.sessionId,
        runDir: item.runDir,
        csvPath: item.csvPath,
        summary: item.summary
      }))
    }, null, 2));
    console.log(md);
    if (armResults.some((item) => Number(item.summary?.failed || 0) > 0)) {
      process.exitCode = 1;
    }
  } finally {
    await pool.end().catch(() => {});
  }
}

async function main() {
  loadLocalEnvFile();
  if (process.argv.includes("--benchmark-v2")) {
    await runBenchmarkV2();
    return;
  }
  const rebuildArgIndex = process.argv.indexOf("--rebuild");
  if (rebuildArgIndex >= 0) {
    const runDir = process.argv[rebuildArgIndex + 1];
    if (!runDir) throw new Error("--rebuild requires run directory");
    const pool = new Pool({
      host: process.env.PGHOST || process.env.POSTGRES_HOST || "127.0.0.1",
      port: Number(process.env.PGPORT || process.env.POSTGRES_PORT || 5432),
      database: process.env.PGDATABASE || process.env.POSTGRES_DB || "emba_sim",
      user: process.env.PGUSER || process.env.POSTGRES_USER || process.env.USER,
      password: process.env.PGPASSWORD || process.env.POSTGRES_PASSWORD || undefined
    });
    try {
      const md = await rebuildRunFromDb(pool, path.resolve(runDir));
      console.log(md);
    } finally {
      await pool.end().catch(() => {});
    }
    return;
  }
  const resumeFailedArgIndex = process.argv.indexOf("--resume-failed");
  if (resumeFailedArgIndex >= 0) {
    const runDir = process.argv[resumeFailedArgIndex + 1];
    if (!runDir) throw new Error("--resume-failed requires run directory");
    const md = await resumeFailedRun(path.resolve(runDir));
    console.log(md);
    return;
  }

  if (!getDeepSeekClient().hasAnyKey()) {
    throw new Error("DeepSeek key missing; strict merged_v1 simulation requires DEEPSEEK_API_KEY or DEEPSEEK_API_KEY_1..N");
  }
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const runId = process.env.RUN_ID || timestamp;
  const sessionId = process.env.SESSION_ID || `${SESSION_PREFIX}${timestamp}`;
  const repeatsArgIndex = process.argv.indexOf("--repeats");
  const repeatCount = Math.max(1, Number(repeatsArgIndex >= 0 ? process.argv[repeatsArgIndex + 1] : process.env.MERGED_V1_REPEATS || 1) || 1);
  const runDir = path.join(LOG_ROOT, runId);
  ensureDir(runDir);
  ensureDir(path.join(runDir, "raw_llm"));

  const api = new ApiClient(BASE_URL, { retries: 1, timeoutMs: 120000 });
  const pool = new Pool({
    host: process.env.PGHOST || process.env.POSTGRES_HOST || "127.0.0.1",
    port: Number(process.env.PGPORT || process.env.POSTGRES_PORT || 5432),
    database: process.env.PGDATABASE || process.env.POSTGRES_DB || "emba_sim",
    user: process.env.PGUSER || process.env.POSTGRES_USER || process.env.USER,
    password: process.env.PGPASSWORD || process.env.POSTGRES_PASSWORD || undefined
  });

  try {
    await api.health();
    await configureSession(api, sessionId);
    const cardsResponse = await api.getRDCards();
    const cards = toCardCatalog(cardsResponse);
    fs.writeFileSync(path.join(runDir, "cards_snapshot.json"), JSON.stringify(cardsResponse, null, 2));

    const rows = [];
    for (let repeatIndex = 0; repeatIndex < repeatCount; repeatIndex += 1) {
      for (let i = 0; i < GRIDS.length; i += 1) {
        const gridId = GRIDS[i];
        console.log(`[merged_v1] r${repeatIndex + 1}/${repeatCount} ${i + 1}/${GRIDS.length} ${gridId}`);
        const row = await runGrid({ api, pool, runId, sessionId, gridId, index: i, repeatIndex, cards, runDir });
        rows.push(row);
        fs.writeFileSync(path.join(runDir, "partial_rows.json"), JSON.stringify(rows, null, 2));
        if (row.error) {
          console.error(`[merged_v1] r${repeatIndex + 1} ${gridId} failed: ${row.error}`);
        } else {
          console.log(`[merged_v1] r${repeatIndex + 1} ${gridId} profit=${row.profit} price=${row.price} cards=${row.card_count}`);
        }
      }
    }

    const baseline = findBaselineRows();
    const summary = buildSummary(rows, baseline);
    const csvPath = path.join(runDir, "summary.csv");
    writeCsv(csvPath, CSV_COLUMNS, rows);
    fs.writeFileSync(path.join(runDir, "summary.json"), JSON.stringify({ runId, sessionId, repeatCount, summary, rows }, null, 2));
    const md = summaryMarkdown(runId, sessionId, rows, summary, csvPath);
    fs.writeFileSync(path.join(runDir, "summary.md"), md);
    console.log(`\n${md}`);
    if (summary.failed > 0) {
      process.exitCode = 1;
    }
  } finally {
    await pool.end().catch(() => {});
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err.stack || err.message || err);
    process.exit(1);
  });
}

module.exports = {
  GRIDS,
  parseJsonObject,
  validateSelectionShape,
  buildSummary,
  spearmanByGrid
};
