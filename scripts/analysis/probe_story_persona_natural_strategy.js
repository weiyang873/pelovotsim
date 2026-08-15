"use strict";

const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..", "..");
const DEFAULT_OUTPUT_ROOT = path.join(ROOT, "runs_v4flash_0731", "persona_story_probe");

function loadLocalEnv() {
  const envPath = path.join(ROOT, ".env");
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/u)) {
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
  const now = new Date().toISOString().replace(/[-:]/gu, "").replace(/\..+$/u, "Z");
  const args = {
    categories: ["A", "C", "G"],
    perCategory: 6,
    concurrency: 6,
    seed: "20260811-story-persona-natural-strategy",
    outputDir: path.join(DEFAULT_OUTPUT_ROOT, `story_persona_natural_strategy_${now}`)
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--categories") args.categories = String(argv[++index] || "").split(",").map((item) => item.trim()).filter(Boolean);
    else if (arg === "--per-category") args.perCategory = Number(argv[++index]);
    else if (arg === "--concurrency") args.concurrency = Number(argv[++index]);
    else if (arg === "--seed") args.seed = String(argv[++index] || "").trim();
    else if (arg === "--output-dir") args.outputDir = path.resolve(ROOT, String(argv[++index] || "").trim());
    else throw new Error(`unknown argument: ${arg}`);
  }
  if (!args.categories.length) throw new Error("--categories required");
  if (!Number.isInteger(args.perCategory) || args.perCategory < 1) throw new Error("--per-category must be a positive integer");
  if (!Number.isInteger(args.concurrency) || args.concurrency < 1) throw new Error("--concurrency must be a positive integer");
  if (!args.seed) throw new Error("--seed required");
  return args;
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function appendJsonl(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.appendFileSync(filePath, `${JSON.stringify(value)}\n`, "utf8");
}

function createSeededRandom(seedText) {
  let h = 2166136261;
  const text = String(seedText || "");
  for (let index = 0; index < text.length; index += 1) {
    h ^= text.charCodeAt(index);
    h = Math.imul(h, 16777619);
  }
  return function random() {
    h += 0x6D2B79F5;
    let t = h;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function withSeededMathRandom(random, fn) {
  const original = Math.random;
  Math.random = random;
  try {
    return fn();
  } finally {
    Math.random = original;
  }
}

function sampleAge(persona, random) {
  const ageMatch = String(persona.age || "").match(/(\d+)\D+(\d+)/u);
  const ageMin = ageMatch ? Number(ageMatch[1]) : 35;
  const ageMax = ageMatch ? Number(ageMatch[2]) : ageMin;
  return ageMin + Math.floor(random() * (ageMax - ageMin + 1));
}

function sampleGender(persona, random) {
  const maleWeight = Number(persona.genderDistribution?.male || 0.5);
  return random() < maleWeight ? "male" : "female";
}

function pickOne(text, random) {
  const options = String(text || "")
    .split(/[、,，/]/u)
    .map((item) => item.trim())
    .filter(Boolean);
  if (!options.length) return String(text || "").trim();
  return options[Math.floor(random() * options.length)];
}

function stripFence(text) {
  const trimmed = String(text || "").trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/iu);
  return fenced ? fenced[1].trim() : trimmed;
}

function parseJsonObject(raw) {
  const text = stripFence(raw);
  const jsonCandidate = (text.match(/\{[\s\S]*\}/u) || [])[0] || text;
  return JSON.parse(jsonCandidate.replace(/,\s*([}\]])/gu, "$1"));
}

function normalizeText(value) {
  return String(value || "").replace(/\s+\n/gu, "\n").trim();
}

function explicitStrategyTermHits(text) {
  const terms = ["成本领先", "差异化", "COST", "DIFF"];
  return terms.filter((term) => String(text || "").includes(term));
}

function broaderStrategyTermHits(text) {
  const terms = ["护城河", "红海", "用户心智", "PMF", "北极星指标"];
  return terms.filter((term) => String(text || "").includes(term));
}

function normalizeCode(value, raw) {
  const code = String(value || "").trim().toUpperCase();
  if (["COST", "DIFF", "MIXED", "AMBIGUOUS"].includes(code)) return code;
  const text = String(raw || "");
  const costHits = (text.match(/成本|性价比|低价|便宜|省钱|算账|规模|效率|回款|现金流/gu) || []).length;
  const diffHits = (text.match(/独特|体验|品牌|高端|品质|技术|功能|不一样|溢价|创新/gu) || []).length;
  if (costHits > 0 && diffHits > 0 && Math.abs(costHits - diffHits) <= 1) return "MIXED";
  if (costHits > diffHits) return "COST";
  if (diffHits > costHits) return "DIFF";
  return "AMBIGUOUS";
}

function buildSeedCards({ categories, perCategory, seed }) {
  const {
    PERSONAS,
    BACKUP_NAME_POOLS,
    sampleStudent
  } = require("../sim/persona_pool");
  const random = createSeededRandom(seed);
  const usedNames = new Set();
  const cards = [];

  for (const category of categories) {
    const persona = PERSONAS[category];
    if (!persona) throw new Error(`unknown category: ${category}`);
    for (let index = 0; index < perCategory; index += 1) {
      const age = sampleAge(persona, random);
      const gender = sampleGender(persona, random);
      const student = withSeededMathRandom(random, () => sampleStudent(category, age, gender));
      const pools = BACKUP_NAME_POOLS[category] || {};
      const candidates = [
        ...(pools[student.gender] || []),
        ...(pools.male || []),
        ...(pools.female || [])
      ];
      let name = candidates.find((candidate) => !usedNames.has(candidate));
      if (!name) name = `${student.gender === "male" ? "陈" : "林"}${category}${String(index + 1).padStart(2, "0")}`;
      usedNames.add(name);
      cards.push({
        persona_id: `${category}${String(index + 1).padStart(2, "0")}`,
        category,
        category_label: persona.label,
        name,
        gender: student.gender,
        age: student.age,
        education: student.education,
        overseas: student.overseas,
        role: pickOne(persona.role, random),
        industry: pickOne(persona.industry, random),
        career_source: persona.background
      });
    }
  }
  return cards;
}

function buildStoryMessages(card) {
  const genderLabel = card.gender === "male" ? "男" : "女";
  const overseas = card.overseas?.hasOverseas ? `${card.overseas.destination || ""}，${card.overseas.duration || ""}` : "无";
  return [
    {
      role: "system",
      content: [
        "你是现实主义小说的人物小传作者。",
        "你要把一个 EMBA 学员写成具体的人，有来路、有压力、有说话习惯、有商业伤疤。",
        "不要写成咨询报告，不要用课堂概念，不要把人物总结成任何商业框架标签。",
        "只写生活和职业里的具体事：钱从哪里来，哪里吃过亏，和谁有关系压力，什么事让他有面子或丢面子，最近为什么睡不好。"
      ].join("\n")
    },
    {
      role: "user",
      content: [
        "请根据下面的基本信息，写一段 450-650 字的人物小传。",
        "这些信息只是底稿，你要随机补出具体前史。不要提到任何类别代号。",
        "",
        `姓名：${card.name}`,
        `性别：${genderLabel}`,
        `年龄：${card.age}`,
        `学历：${card.education}`,
        `海外经历：${overseas}`,
        `当前身份：${card.role}`,
        `当前行业：${card.industry}`,
        `职业来路素材：${card.career_source}`,
        "",
        "写作要求：",
        "- 像小说人物小传，不要列表",
        "- 至少写一个赚到钱的经历和一个吃亏的经历",
        "- 写清楚他/她今天来上课时心里压着什么事",
        "- 写清楚他/她说话大概是什么质感",
        "- 不要输出 JSON"
      ].join("\n")
    }
  ];
}

function buildNaturalAnswerMessages(card) {
  const genderLabel = card.gender === "male" ? "男" : "女";
  const personaText = [
    `姓名：${card.name}`,
    `性别：${genderLabel}`,
    `年龄：${card.age}`,
    `学历：${card.education}`,
    `海外经历：${card.overseas?.hasOverseas ? `${card.overseas.destination || ""} ${card.overseas.duration || ""}`.trim() : "无"}`,
    `当前身份：${card.role}`,
    `当前行业：${card.industry}`,
    "",
    "人物小传：",
    card.story_text || ""
  ].join("\n");
  return [
    {
      role: "system",
      content: [
        "你正在扮演下面这个具体的人。",
        "不要引入任何课堂任务、宠物机器人、团队讨论、锦囊、价格、功能选择或具体产品情境。",
        "不要使用标准管理学二分法，也不要给自己贴商业框架标签。",
        "保持这个人的生活经验、压力和说话质感。"
      ].join("\n")
    },
    {
      role: "user",
      content: [
        personaText,
        "",
        "有人随口问你：在中国市场做生意，你觉得通常靠什么赢？你自己会先抓什么？",
        "请用这个人的口吻自然回答一小段。不要列选项，不要输出 JSON。"
      ].join("\n")
    }
  ];
}

function buildExtractMessages(card) {
  return [
    {
      role: "system",
      content: [
        "你是研究编码员。你的任务是事后阅读一段自然语言回答，把它编码成战略倾向。",
        "编码只反映原文含义，不要替作者优化观点。只输出 JSON。"
      ].join("\n")
    },
    {
      role: "user",
      content: [
        "编码规则：",
        "- COST：主要强调低成本、性价比、价格、规模、效率、回款、现金流、可复制、先活下来。",
        "- DIFF：主要强调独特价值、技术、品牌、体验、品质、服务、创新、别人做不到。",
        "- MIXED：两边都明确强调，而且没有明显主次。",
        "- AMBIGUOUS：无法判断。",
        "",
        `persona_id: ${card.persona_id}`,
        "自然回答：",
        card.natural_answer || "",
        "",
        "请输出 JSON：",
        "{",
        "  \"code\": \"COST 或 DIFF 或 MIXED 或 AMBIGUOUS\",",
        "  \"confidence\": 0 到 1 的数字,",
        "  \"evidence\": \"一句话说明原文依据\"",
        "}"
      ].join("\n")
    }
  ];
}

function summarize(cards) {
  const byCategory = {};
  for (const card of cards) {
    const key = `${card.category} ${card.category_label}`;
    if (!byCategory[key]) byCategory[key] = { total: 0, COST: 0, DIFF: 0, MIXED: 0, AMBIGUOUS: 0, ERROR: 0 };
    byCategory[key].total += 1;
    const code = card.extract_status === "ok" ? card.strategy_code : "ERROR";
    byCategory[key][code] = (byCategory[key][code] || 0) + 1;
  }
  return byCategory;
}

async function runStep({ card, step, messages, options, callsPath }) {
  const startedCallMs = Date.now();
  let raw = "";
  try {
    const { chatCompletion } = require("../../server/llm/deepseekClient");
    raw = await chatCompletion(messages, options);
    appendJsonl(callsPath, {
      ts: new Date().toISOString(),
      persona_id: card.persona_id,
      step,
      status: "ok",
      latency_ms: Date.now() - startedCallMs,
      raw
    });
    return { status: "ok", raw };
  } catch (error) {
    appendJsonl(callsPath, {
      ts: new Date().toISOString(),
      persona_id: card.persona_id,
      step,
      status: "error",
      latency_ms: Date.now() - startedCallMs,
      raw,
      error: String(error?.stack || error?.message || error)
    });
    return { status: "error", raw, error: String(error?.stack || error?.message || error) };
  }
}

async function main() {
  loadLocalEnv();
  const args = parseArgs(process.argv.slice(2));
  const { hasAnyKey } = require("../../server/llm/deepseekClient");
  const modelRegistry = require("../../server/llm/modelRegistry");
  if (!hasAnyKey()) throw new Error("missing LLM API key");

  const cards = buildSeedCards(args);
  fs.mkdirSync(args.outputDir, { recursive: true });
  const callsPath = path.join(args.outputDir, "calls.jsonl");
  if (fs.existsSync(callsPath)) fs.unlinkSync(callsPath);

  const { default: pLimit } = await import("p-limit");
  const limit = pLimit(args.concurrency);
  const startedAt = new Date().toISOString();
  const startedMs = Date.now();

  await Promise.all(cards.map((card) => limit(async () => {
    const result = await runStep({
      card,
      step: "story_text",
      messages: buildStoryMessages(card),
      options: { role: "chat_service", temperature: 1, max_tokens: 900, timeoutMs: 60000 },
      callsPath
    });
    card.story_status = result.status;
    card.story_text = normalizeText(result.raw);
    card.story_error = result.error || null;
    card.story_explicit_strategy_terms = explicitStrategyTermHits(card.story_text);
    card.story_broader_strategy_terms = broaderStrategyTermHits(card.story_text);
  })));

  await Promise.all(cards.map((card) => limit(async () => {
    if (card.story_status !== "ok") {
      card.answer_status = "error";
      card.answer_error = "story failed";
      return;
    }
    const result = await runStep({
      card,
      step: "natural_answer",
      messages: buildNaturalAnswerMessages(card),
      options: { role: "chat_service", temperature: 0.9, max_tokens: 420, timeoutMs: 60000 },
      callsPath
    });
    card.answer_status = result.status;
    card.natural_answer = normalizeText(result.raw);
    card.answer_error = result.error || null;
    card.answer_explicit_strategy_terms = explicitStrategyTermHits(card.natural_answer);
    card.answer_broader_strategy_terms = broaderStrategyTermHits(card.natural_answer);
  })));

  await Promise.all(cards.map((card) => limit(async () => {
    if (card.answer_status !== "ok") {
      card.extract_status = "error";
      card.strategy_code = "ERROR";
      card.extract_error = "answer failed";
      return;
    }
    const result = await runStep({
      card,
      step: "posthoc_extract",
      messages: buildExtractMessages(card),
      options: {
        role: "chat_service",
        temperature: 0,
        max_tokens: 260,
        timeoutMs: 60000,
        response_format: { type: "json_object" }
      },
      callsPath
    });
    card.extract_status = result.status;
    card.extract_raw = result.raw;
    card.extract_error = result.error || null;
    if (result.status === "ok") {
      try {
        const parsed = parseJsonObject(result.raw);
        card.strategy_code = normalizeCode(parsed.code, card.natural_answer);
        card.extract_confidence = Number.isFinite(Number(parsed.confidence)) ? Number(parsed.confidence) : null;
        card.extract_evidence = normalizeText(parsed.evidence);
      } catch (error) {
        card.strategy_code = normalizeCode("", card.natural_answer);
        card.extract_confidence = null;
        card.extract_evidence = "";
        card.extract_parse_error = String(error?.message || error);
      }
    } else {
      card.strategy_code = "ERROR";
    }
  })));

  cards.sort((a, b) => a.persona_id.localeCompare(b.persona_id));
  const summary = {
    probe: "story_persona_natural_strategy_posthoc_extract",
    seed: args.seed,
    started_at: startedAt,
    finished_at: new Date().toISOString(),
    wall_clock_ms: Date.now() - startedMs,
    provider: modelRegistry.getProvider(),
    model: modelRegistry.getModel("chat_service"),
    base_url_host: new URL(modelRegistry.getBaseUrl()).host,
    categories: args.categories,
    per_category: args.perCategory,
    total: cards.length,
    output_dir: path.relative(ROOT, args.outputDir),
    prompt_design: {
      story_prompt_exposes_category_label: false,
      story_prompt_exposes_expression_style: false,
      story_prompt_explicit_cost_diff_terms: false,
      decision_prompt_explicit_cost_diff_terms: false,
      posthoc_extract_explicit_cost_diff_terms: true
    },
    by_category: summarize(cards),
    story_term_hits: cards
      .filter((card) => card.story_explicit_strategy_terms.length || card.story_broader_strategy_terms.length)
      .map((card) => ({
        persona_id: card.persona_id,
        explicit: card.story_explicit_strategy_terms,
        broader: card.story_broader_strategy_terms
      })),
    answer_term_hits: cards
      .filter((card) => card.answer_explicit_strategy_terms.length || card.answer_broader_strategy_terms.length)
      .map((card) => ({
        persona_id: card.persona_id,
        explicit: card.answer_explicit_strategy_terms,
        broader: card.answer_broader_strategy_terms
      }))
  };

  writeJson(path.join(args.outputDir, "cards.json"), cards);
  writeJson(path.join(args.outputDir, "summary.json"), summary);
  console.log(JSON.stringify(summary, null, 2));
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.stack || error.message || String(error));
    process.exitCode = 1;
  });
}
