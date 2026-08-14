"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const ROOT = path.join(__dirname, "..", "..");
const DEFAULT_OUTPUT_DIR = path.join(ROOT, "data", "behavioral_narrative_pool_v1");

const FORBIDDEN_STRATEGY_TERMS = [
  "成本领先",
  "差异化",
  "护城河",
  "红海",
  "用户心智",
  "PMF",
  "北极星指标"
];

const INDUSTRIES = [
  "医疗服务", "消费品", "智能制造", "教育培训", "跨境贸易", "企业软件",
  "连锁零售", "新能源设备", "养老服务", "汽车后市场", "食品供应链", "工业自动化",
  "物业服务", "金融科技", "文旅运营", "建筑工程", "物流仓配", "商业地产"
];

const ROLE_CONTEXTS = [
  "创始人兼总经理",
  "事业部总经理",
  "区域公司负责人",
  "集团副总裁",
  "销售与渠道负责人",
  "运营负责人",
  "产品与业务负责人",
  "家族企业二代接班人",
  "并购后整合负责人",
  "民营企业合伙人"
];

const EDUCATION_BANDS = [
  "大专",
  "本科（非985）",
  "本科（985/211）",
  "MBA（国内）",
  "MBA（海外）",
  "硕士（国内）",
  "硕士（海外）",
  "博士"
];

const REGIONS = [
  "长三角", "珠三角", "京津冀", "成渝", "山东", "福建", "河南", "湖北", "湖南", "陕西"
];

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
  const args = {
    count: 30,
    seed: "20260811-behavioral-narrative-v1",
    outputDir: DEFAULT_OUTPUT_DIR,
    concurrency: 6
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--count") args.count = Number(argv[++index]);
    else if (arg === "--seed") args.seed = String(argv[++index] || "").trim();
    else if (arg === "--output-dir") args.outputDir = path.resolve(ROOT, String(argv[++index] || "").trim());
    else if (arg === "--concurrency") args.concurrency = Number(argv[++index]);
    else throw new Error(`unknown argument: ${arg}`);
  }
  if (!Number.isInteger(args.count) || args.count < 1) throw new Error("--count must be a positive integer");
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

function pick(list, rng) {
  return list[Math.floor(rng() * list.length)];
}

function sampleTrait(rng, index, offset = 0) {
  const anchors = [0.12, 0.28, 0.44, 0.56, 0.72, 0.88];
  const anchor = anchors[(index + offset) % anchors.length];
  return Math.max(0.04, Math.min(0.96, Number((anchor + (rng() - 0.5) * 0.18).toFixed(2))));
}

function traitLevel(value, low, high) {
  if (value <= low) return "low";
  if (value >= high) return "high";
  return "mid";
}

function buildFingerprint(index, rng) {
  return {
    maximizing_satisficing: sampleTrait(rng, index, 0),
    need_for_cognition: sampleTrait(rng, index, 2),
    actively_open_minded_thinking: sampleTrait(rng, index, 4),
    risk_propensity_business: sampleTrait(rng, index, 1),
    ambiguity_tolerance: sampleTrait(rng, index, 3),
    regulatory_focus_promotion: sampleTrait(rng, index, 5),
    consideration_future_consequences: sampleTrait(rng, index, 2 + Math.floor(index / 3)),
    action_orientation: sampleTrait(rng, index, 4 + Math.floor(index / 2))
  };
}

function buildDemographicSeed(index, rng) {
  const gender = rng() < 0.58 ? "male" : "female";
  const age = 33 + Math.floor(rng() * 24);
  const edu = pick(EDUCATION_BANDS, rng);
  const hasOverseas = /海外/u.test(edu) || rng() < 0.18;
  const overseas = hasOverseas
    ? pick(["英国/欧洲短期项目", "美国一年制硕士", "新加坡/香港项目", "海外业务派驻", "短期交换/考察"], rng)
    : "无";
  return {
    gender,
    age,
    education: edu,
    overseas,
    region: pick(REGIONS, rng),
    industry_hint: pick(INDUSTRIES, rng),
    role_hint: pick(ROLE_CONTEXTS, rng),
    management_scope_hint: pick([
      "管理 40-80 人团队",
      "管理 100-300 人团队",
      "负责 3-8 亿年营收业务",
      "负责多城市/多门店运营",
      "负责新业务孵化和老业务改造",
      "直接背销售、利润和现金流指标"
    ], rng),
    qualification_gate: "必须是能合理申请中欧/同级高管项目的企业经营者或高级管理者"
  };
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

function forbiddenHits(value) {
  const text = typeof value === "string" ? value : JSON.stringify(value || {});
  return FORBIDDEN_STRATEGY_TERMS.filter((term) => text.includes(term));
}

function traitPromptLines(fingerprint) {
  const f = fingerprint;
  return [
    `Maximizing-Satisficing = ${f.maximizing_satisficing} (${traitLevel(f.maximizing_satisficing, 0.33, 0.67)}): 搜索范围和停手阈值`,
    `Need for Cognition = ${f.need_for_cognition} (${traitLevel(f.need_for_cognition, 0.33, 0.67)}): 愿意投入多少认知努力`,
    `Actively Open-Minded Thinking = ${f.actively_open_minded_thinking} (${traitLevel(f.actively_open_minded_thinking, 0.33, 0.67)}): 是否主动找反证、更新原判断`,
    `Business Risk Propensity = ${f.risk_propensity_business} (${traitLevel(f.risk_propensity_business, 0.33, 0.67)}): 对经营结果波动的接受程度`,
    `Ambiguity Tolerance = ${f.ambiguity_tolerance} (${traitLevel(f.ambiguity_tolerance, 0.33, 0.67)}): 信息不全时能否行动`,
    `Regulatory Focus Promotion = ${f.regulatory_focus_promotion} (${traitLevel(f.regulatory_focus_promotion, 0.33, 0.67)}): 越高越把增长/进取编码为成功，越低越把安全/责任/避免损失编码为成功`,
    `Consideration of Future Consequences = ${f.consideration_future_consequences} (${traitLevel(f.consideration_future_consequences, 0.33, 0.67)}): 短期结果与长期结果的权重`,
    `Action Orientation = ${f.action_orientation} (${traitLevel(f.action_orientation, 0.33, 0.67)}): 决策后启动、坚持、从挫折中恢复的能力`
  ];
}

function buildGenerationMessages(card) {
  const genderLabel = card.demographic_seed.gender === "male" ? "男" : "女";
  return [
    {
      role: "system",
      content: [
        "你是严肃现实主义人物小传作者，任务是从 latent behavioral representation 反推一个合理的人。",
        "先让这个人 qualify 上中欧或同级高管项目，再用行为特点反推其职业路径、成功失败、资源条件、课堂状态。",
        "不要从社会 prototype 开始；禁止使用“草根老板、技术创业者、互联网PM、职业经理人、销售铁军、二代接班人、体制转型者”等原型标签。",
        `小传和人物字段中禁止出现这些战略词：${FORBIDDEN_STRATEGY_TERMS.join("、")}。`,
        "不要直接写 trait 名称或分数；要用具体事件把行为特点演出来。",
        "不要写咨询报告，不要写用户画像，不要写心理测评解释。"
      ].join("\n")
    },
    {
      role: "user",
      content: [
        "请根据下面的行为指纹，反推出一个现实中合理的中国高管项目学员。",
        "",
        "【行为指纹】",
        ...traitPromptLines(card.behavioral_fingerprint),
        "",
        "【demographic seed，只是弱约束】",
        `性别：${genderLabel}`,
        `年龄：${card.demographic_seed.age}`,
        `学历：${card.demographic_seed.education}`,
        `海外经历：${card.demographic_seed.overseas}`,
        `区域：${card.demographic_seed.region}`,
        `行业提示：${card.demographic_seed.industry_hint}`,
        `身份提示：${card.demographic_seed.role_hint}`,
        `管理规模提示：${card.demographic_seed.management_scope_hint}`,
        card.demographic_seed.qualification_gate,
        "",
        "请只输出 JSON 对象：",
        "{",
        "  \"name\": \"中文姓名\",",
        "  \"surface\": {\"gender\":\"male|female\", \"age\": 40, \"edu\":\"...\", \"overseas\":{\"hasOverseas\":true, \"destination\":\"...\", \"duration\":\"...\"}, \"expression_style\":\"一句自然说话风格，不含战略词\"},",
        "  \"structural_profile\": {\"current_role\":\"...\", \"industry\":\"...\", \"company_context\":\"...\", \"management_scope\":\"...\", \"why_ceibs_qualified\":\"...\"},",
        "  \"narrative_profile\": {",
        "    \"life_sketch\":\"180-260字人物小传，必须有具体职业路径和管理责任\",",
        "    \"success_episode\":\"40-80字，一次成功经历，能解释他现在相信什么\",",
        "    \"failure_episode\":\"40-80字，一次失败或吃亏经历，能解释他的警惕/执念\",",
        "    \"money_pressure\":\"当前钱、回款、预算、家庭或团队压力之一，具体但不夸张\",",
        "    \"face_pressure\":\"他最怕别人怎么看他\",",
        "    \"classroom_state\":\"今天来上课时的状态，80-140字\",",
        "    \"decision_habit\":\"30-60字，用经历写他如何搜索、比较、停手\",",
        "    \"updating_style\":\"30-60字，用经历写他如何听反对意见和更新想法\",",
        "    \"uncertainty_style\":\"30-60字，用经历写他如何处理风险和信息不足\",",
        "    \"time_horizon\":\"30-60字，用经历写他偏眼前还是偏长远\",",
        "    \"action_style\":\"30-60字，用经历写他拍板后如何执行或卡住\",",
        "    \"speaking_texture\":\"一句话写他说话像什么\",",
        "    \"blind_spot\":\"一句话写他的盲区\"",
        "  },",
        "  \"trait_evidence\": {\"M\":\"事件证据\", \"NFC\":\"事件证据\", \"AOT\":\"事件证据\", \"RP\":\"事件证据\", \"AT\":\"事件证据\", \"RF\":\"事件证据\", \"CFC\":\"事件证据\", \"AO\":\"事件证据\"}",
        "}"
      ].join("\n")
    }
  ];
}

function normalizeRecord(card, parsed) {
  const surface = parsed.surface || {};
  const narrative = parsed.narrative_profile || {};
  const structural = parsed.structural_profile || {};
  const name = normalizeText(parsed.name || surface.name || `学员${card.persona_id}`);
  const gender = surface.gender === "female" ? "female" : "male";
  return {
    schema: "behavioral_narrative_v1",
    persona_id: card.persona_id,
    seed: card.seed,
    behavioral_fingerprint: card.behavioral_fingerprint,
    demographic_seed: card.demographic_seed,
    surface: {
      name,
      gender,
      age: Number(surface.age || card.demographic_seed.age),
      edu: normalizeText(surface.edu || card.demographic_seed.education),
      overseas: {
        hasOverseas: Boolean(surface.overseas?.hasOverseas) || card.demographic_seed.overseas !== "无",
        destination: normalizeText(surface.overseas?.destination || (card.demographic_seed.overseas === "无" ? "" : card.demographic_seed.overseas)),
        duration: normalizeText(surface.overseas?.duration || "")
      },
      mbti: "",
      expression_style: normalizeText(surface.expression_style || narrative.speaking_texture || "说话自然，有自己的节奏。")
    },
    structural_profile: {
      current_role: normalizeText(structural.current_role),
      industry: normalizeText(structural.industry),
      company_context: normalizeText(structural.company_context),
      management_scope: normalizeText(structural.management_scope),
      why_ceibs_qualified: normalizeText(structural.why_ceibs_qualified)
    },
    narrative_profile: Object.fromEntries(Object.entries({
      life_sketch: narrative.life_sketch,
      success_episode: narrative.success_episode,
      failure_episode: narrative.failure_episode,
      money_pressure: narrative.money_pressure,
      face_pressure: narrative.face_pressure,
      classroom_state: narrative.classroom_state,
      decision_habit: narrative.decision_habit,
      updating_style: narrative.updating_style,
      uncertainty_style: narrative.uncertainty_style,
      time_horizon: narrative.time_horizon,
      action_style: narrative.action_style,
      speaking_texture: narrative.speaking_texture,
      blind_spot: narrative.blind_spot
    }).map(([key, value]) => [key, normalizeText(value)])),
    trait_evidence: parsed.trait_evidence || {},
    forbidden_strategy_term_hits: forbiddenHits(parsed),
    synthetic: true
  };
}

async function main() {
  loadLocalEnv();
  const args = parseArgs(process.argv.slice(2));
  const { chatCompletion, hasAnyKey } = require("../../server/llm/deepseekClient");
  const modelRegistry = require("../../server/llm/modelRegistry");
  if (!hasAnyKey()) throw new Error("missing LLM API key");

  const rng = createSeededRandom(args.seed);
  const cards = Array.from({ length: args.count }, (_, index) => ({
    persona_id: `BN${String(index + 1).padStart(2, "0")}`,
    seed: `${args.seed}:${index + 1}`,
    behavioral_fingerprint: buildFingerprint(index, rng),
    demographic_seed: buildDemographicSeed(index, rng)
  }));

  fs.mkdirSync(args.outputDir, { recursive: true });
  const callsPath = path.join(args.outputDir, "generation_calls.jsonl");
  if (fs.existsSync(callsPath)) fs.unlinkSync(callsPath);

  const records = [];
  const errors = [];
  const { default: pLimit } = await import("p-limit");
  const limit = pLimit(args.concurrency);
  const startedAt = new Date().toISOString();
  const startedMs = Date.now();

  await Promise.all(cards.map((card) => limit(async () => {
    const startedCallMs = Date.now();
    let raw = "";
    try {
      raw = await chatCompletion(buildGenerationMessages(card), {
        role: "chat_service",
        temperature: 0.95,
        max_tokens: 2600,
        timeoutMs: 60000,
        response_format: { type: "json_object" }
      });
      const parsed = parseJsonObject(raw);
      const record = normalizeRecord(card, parsed);
      records.push(record);
      appendJsonl(callsPath, {
        ts: new Date().toISOString(),
        persona_id: card.persona_id,
        status: "ok",
        latency_ms: Date.now() - startedCallMs,
        forbidden_strategy_term_hits: record.forbidden_strategy_term_hits,
        raw
      });
    } catch (error) {
      const row = {
        persona_id: card.persona_id,
        status: "error",
        latency_ms: Date.now() - startedCallMs,
        error: String(error?.stack || error?.message || error),
        raw
      };
      errors.push(row);
      appendJsonl(callsPath, { ts: new Date().toISOString(), ...row });
    }
  })));

  records.sort((a, b) => a.persona_id.localeCompare(b.persona_id));
  const poolPath = path.join(args.outputDir, "persona_pool_behavioral_narrative_v1.json");
  writeJson(poolPath, records);
  const manifest = {
    schema: "behavioral_narrative_pool_manifest_v1",
    seed: args.seed,
    generated_at: new Date().toISOString(),
    started_at: startedAt,
    wall_clock_ms: Date.now() - startedMs,
    provider: modelRegistry.getProvider(),
    model: modelRegistry.getModel("chat_service"),
    base_url_host: new URL(modelRegistry.getBaseUrl()).host,
    count_requested: args.count,
    count_generated: records.length,
    errors,
    script_path: "scripts/analysis/generate_behavioral_narrative_pool.js",
    script_sha256: crypto.createHash("sha256").update(fs.readFileSync(__filename)).digest("hex"),
    no_prototype_policy: "records are generated from behavioral_fingerprint + demographic seed; no A-G archetype labels are used",
    forbidden_strategy_terms: FORBIDDEN_STRATEGY_TERMS,
    forbidden_strategy_term_hits: records
      .filter((record) => record.forbidden_strategy_term_hits.length > 0)
      .map((record) => ({
        persona_id: record.persona_id,
        terms: record.forbidden_strategy_term_hits
      })),
    pool_path: path.relative(ROOT, poolPath)
  };
  writeJson(path.join(args.outputDir, "pool_manifest.json"), manifest);
  console.log(JSON.stringify(manifest, null, 2));
  if (errors.length > 0) process.exitCode = 1;
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.stack || error.message || String(error));
    process.exitCode = 1;
  });
}
