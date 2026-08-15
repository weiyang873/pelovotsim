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
    seed: "20260811-story-persona-variation",
    outputDir: path.join(DEFAULT_OUTPUT_ROOT, `story_persona_variation_${now}`)
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

function forbiddenStrategyTerms(text) {
  const terms = ["成本领先", "差异化", "护城河", "红海", "用户心智", "PMF", "北极星指标"];
  return terms.filter((term) => String(text || "").includes(term));
}

function inferChoice(raw) {
  const text = String(raw || "");
  const costHits = (text.match(/成本领先|性价比|低成本|控成本|规模|效率|便宜|价格敏感|省钱|算账/gu) || []).length;
  const diffHits = (text.match(/差异化|独特|体验|品牌|功能|高端|溢价|不一样|品质/gu) || []).length;
  if (costHits > diffHits) return "COST";
  if (diffHits > costHits) return "DIFF";
  return "AMBIGUOUS";
}

function normalizeChoice(value, raw) {
  const choice = String(value || "").trim().toUpperCase();
  if (["COST", "DIFF"].includes(choice)) return choice;
  if (/成本/u.test(choice)) return "COST";
  if (/差异/u.test(choice)) return "DIFF";
  return inferChoice(raw);
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
        category_desc: persona.desc,
        name,
        gender: student.gender,
        age: student.age,
        education: student.education,
        overseas: student.overseas,
        mbti: student.mbti,
        role: pickOne(persona.role, random),
        industry: pickOne(persona.industry, random),
        base_background: persona.background,
        base_expression_style: persona.expressionStyle,
        expression_modifier: student.expressionModifier,
        full_expression_style: student.fullExpressionStyle
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
        "你是严肃现实主义小说的人物小传作者。",
        "目标是把一个 EMBA 学员写成具体的人，而不是类别标签。",
        "不要写成咨询报告，不要写成用户画像，不要写成 MBTI 解释。",
        "禁止出现这些词：成本领先、差异化、护城河、红海、用户心智、PMF、北极星指标。",
        "可以写具体经历里的算账、吃亏、面子、回款、客户、渠道、员工、家里压力，但不要替人物总结战略标签。"
      ].join("\n")
    },
    {
      role: "user",
      content: [
        "请根据下面的 category 和 demographic，随机生成一个人物小传。",
        "category 只用于帮助你设定生活质感，成文里不要直接写 category 名称。",
        "",
        `category: ${card.category} ${card.category_label}，${card.category_desc}`,
        `姓名：${card.name}`,
        `性别：${genderLabel}`,
        `年龄：${card.age}`,
        `学历：${card.education}`,
        `海外经历：${overseas}`,
        `当前身份：${card.role}`,
        `当前行业：${card.industry}`,
        `背景来源：${card.base_background}`,
        `表达底色：${card.base_expression_style}`,
        `文字能力：${card.expression_modifier}`,
        "",
        "请只输出 JSON 对象：",
        "{",
        "  \"life_sketch\": \"220-320字人物小传，像小说人物小传\",",
        "  \"classroom_state\": \"80-140字，今天来上课时这个人的状态\",",
        "  \"inner_contradiction\": \"一句话写这个人的内部矛盾\",",
        "  \"speaking_texture\": \"一句话写他说话像什么\"",
        "}"
      ].join("\n")
    }
  ];
}

function buildPreferenceMessages(card) {
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
    card.story?.life_sketch || "",
    "",
    "今天状态：",
    card.story?.classroom_state || "",
    "",
    "内部矛盾：",
    card.story?.inner_contradiction || "",
    "",
    "说话质感：",
    card.story?.speaking_texture || ""
  ].join("\n");
  return [
    {
      role: "system",
      content: [
        "你正在扮演下面这个具体的人。",
        "不要引入任何课堂任务、宠物机器人、R1/R2、团队讨论、锦囊、价格、功能选择或具体产品情境。",
        "保持这个人的生活经验和说话质感。"
      ].join("\n")
    },
    {
      role: "user",
      content: [
        personaText,
        "",
        "问题：不考虑任何具体任务 context，只说你自己在中国市场做商业判断时的默认战略偏好：你更偏向“成本领先”还是“差异化”？必须二选一。",
        "",
        "请输出一个 JSON 对象：",
        "{",
        "  \"choice\": \"COST 或 DIFF\",",
        "  \"confidence\": 0 到 1 的数字,",
        "  \"one_sentence\": \"用这个人的口吻说一句为什么\"",
        "}"
      ].join("\n")
    }
  ];
}

function summarize(cards) {
  const byCategory = {};
  for (const card of cards) {
    const key = `${card.category} ${card.category_label}`;
    if (!byCategory[key]) byCategory[key] = { total: 0, COST: 0, DIFF: 0, AMBIGUOUS: 0, ERROR: 0 };
    byCategory[key].total += 1;
    const choice = card.preference_status === "ok" ? card.preference_choice : "ERROR";
    byCategory[key][choice] = (byCategory[key][choice] || 0) + 1;
  }
  return byCategory;
}

async function main() {
  loadLocalEnv();
  const args = parseArgs(process.argv.slice(2));
  const { chatCompletion, hasAnyKey } = require("../../server/llm/deepseekClient");
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
    const startedCallMs = Date.now();
    let raw = "";
    try {
      raw = await chatCompletion(buildStoryMessages(card), {
        role: "chat_service",
        temperature: 1,
        max_tokens: 720,
        timeoutMs: 60000,
        response_format: { type: "json_object" }
      });
      const parsed = parseJsonObject(raw);
      card.story_status = "ok";
      card.story = {
        life_sketch: normalizeText(parsed.life_sketch),
        classroom_state: normalizeText(parsed.classroom_state),
        inner_contradiction: normalizeText(parsed.inner_contradiction),
        speaking_texture: normalizeText(parsed.speaking_texture)
      };
      card.story_forbidden_terms = forbiddenStrategyTerms(Object.values(card.story).join("\n"));
      appendJsonl(callsPath, {
        ts: new Date().toISOString(),
        persona_id: card.persona_id,
        step: "story",
        status: "ok",
        latency_ms: Date.now() - startedCallMs,
        raw
      });
    } catch (error) {
      card.story_status = "error";
      card.story_error = String(error?.stack || error?.message || error);
      appendJsonl(callsPath, {
        ts: new Date().toISOString(),
        persona_id: card.persona_id,
        step: "story",
        status: "error",
        latency_ms: Date.now() - startedCallMs,
        raw,
        error: card.story_error
      });
    }
  })));

  await Promise.all(cards.map((card) => limit(async () => {
    if (card.story_status !== "ok") {
      card.preference_status = "error";
      card.preference_choice = "ERROR";
      card.preference_error = "story generation failed";
      return;
    }
    const startedCallMs = Date.now();
    try {
      const raw = await chatCompletion(buildPreferenceMessages(card), {
        role: "chat_service",
        temperature: 0.7,
        max_tokens: 260,
        timeoutMs: 60000,
        response_format: { type: "json_object" }
      });
      let parsed = null;
      try {
        parsed = parseJsonObject(raw);
      } catch (parseError) {
        parsed = { parse_error: String(parseError?.message || parseError) };
      }
      card.preference_status = "ok";
      card.preference_choice = normalizeChoice(parsed.choice, raw);
      card.preference_confidence = Number.isFinite(Number(parsed.confidence)) ? Number(parsed.confidence) : null;
      card.preference_one_sentence = normalizeText(parsed.one_sentence);
      card.preference_raw = raw;
      appendJsonl(callsPath, {
        ts: new Date().toISOString(),
        persona_id: card.persona_id,
        step: "preference",
        status: "ok",
        choice: card.preference_choice,
        latency_ms: Date.now() - startedCallMs,
        raw
      });
    } catch (error) {
      card.preference_status = "error";
      card.preference_choice = "ERROR";
      card.preference_error = String(error?.stack || error?.message || error);
      appendJsonl(callsPath, {
        ts: new Date().toISOString(),
        persona_id: card.persona_id,
        step: "preference",
        status: "error",
        latency_ms: Date.now() - startedCallMs,
        error: card.preference_error
      });
    }
  })));

  cards.sort((a, b) => a.persona_id.localeCompare(b.persona_id));
  const summary = {
    probe: "story_persona_variation_then_strategy_preference",
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
    biography_guardrail: "category used only to generate prose; no direct strategy labels in biography prompt",
    preference_guardrail: "biography + demographic only; no task context",
    by_category: summarize(cards),
    story_forbidden_term_hits: cards
      .filter((card) => Array.isArray(card.story_forbidden_terms) && card.story_forbidden_terms.length > 0)
      .map((card) => ({
        persona_id: card.persona_id,
        terms: card.story_forbidden_terms
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
