// v2_design (2026-08-17, faultline design matrix): identical to v2 except that industry × function × age band are
// FIXED per persona from a design matrix given via --design-file (JSON array of {cell, industry_set, function_set, age_range});
// persona i takes design[i]. Everything else (gender, education, family, consumption, traits) stays IID.
"use strict";
// v2 (2026-08-16, faultline pool): same firewall/schema/writer prompt as v1. Changes are all in the
// FACT SAMPLER: (1) education split into first-degree tier (985/211 | 普通本科 | 大专) x postgraduate
// (无 | 国内硕士 | 海外硕士), overseas destination/years/first job after return sampled and written into
// the fact card, surface.overseas filled from the card (v1 hard-coded false); (2) industry list widened
// with new-economy entries, still sampled uniformly; surface.industry_type (传统/新兴) is a POST-HOC
// classification for analysis only and is never written into facts; (3) age unchanged.
// Output schema stays task_blind_narrative_v1 so all frozen consumers load it unchanged.

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..", "..");
const DEFAULT_OUTPUT_DIR = path.join(ROOT, "data", "task_blind_persona_pipeline_v1", "v2_faultline_pilot12_20260816");

const FIELD_CATALOG = [
  { id: "age_and_life_stage", label: "年龄与人生阶段", description: "年龄及当前人生阶段，不包含任务相关年龄偏好", requires: [] },
  { id: "gender", label: "性别", description: "性别及其在个人经历中的普通社会背景", requires: [] },
  { id: "education_and_learning", label: "教育与学习经历", description: "教育程度、专业训练、学习路径", requires: ["age_and_life_stage"] },
  { id: "region_and_mobility", label: "地域与迁移经历", description: "成长地、工作地、城乡或跨区域迁移", requires: ["age_and_life_stage"] },
  { id: "career_context", label: "行业、职能与当前岗位", description: "行业、主要职能、公司环境、当前职位", requires: ["age_and_life_stage", "education_and_learning"] },
  { id: "career_trajectory", label: "职业路径", description: "进入行业、岗位变化、关键转折及经验积累", requires: ["career_context"] },
  { id: "managerial_scope", label: "管理与责任范围", description: "团队、区域、项目或经营责任", requires: ["career_context"] },
  { id: "customer_and_user_exposure", label: "客户与实际使用者接触", description: "工作中接触谁付钱、谁使用、谁影响决策的经验", requires: ["career_context"] },
  { id: "procurement_and_budget_exposure", label: "采购与预算经验", description: "本人是否选供应商、管预算、审批采购或承担交付后果", requires: ["career_context", "managerial_scope"] },
  { id: "product_and_technology_familiarity", label: "产品与技术熟悉度", description: "日常接触硬件、软件、智能设备或服务系统的深浅", requires: ["education_and_learning", "career_context"] },
  { id: "household_structure", label: "家庭结构", description: "伴侣、子女、父母及同住或异地情况", requires: ["age_and_life_stage"] },
  { id: "intergenerational_contact", label: "不同代际的实际接触", description: "与儿童、同龄成人和老年人的实际接触频率与深度；允许没有接触", requires: ["household_structure"] },
  { id: "caregiving_and_dependents", label: "照护与被依赖经历", description: "本人是否实际承担过照护、教育或紧急决策；允许没有", requires: ["household_structure", "intergenerational_contact"] },
  { id: "economic_resources_and_pressure", label: "经济余量与现实压力", description: "家庭现金流、债务、收入稳定性和可支配空间，不直接推导选择", requires: ["career_context", "household_structure"] },
  { id: "personal_consumption_habits", label: "个人消费习惯", description: "搜索、比价、冲动、延迟购买、委托他人或复购等实际习惯", requires: ["economic_resources_and_pressure"] },
  { id: "price_reference_history", label: "既有价格参照", description: "在普通耐用品、设备、服务或订阅中实际付过或见过的金额", requires: ["personal_consumption_habits"] },
  { id: "quality_convenience_tradeoffs", label: "质量、便利与花费取舍经历", description: "买贵或买便宜后满意、后悔、闲置或长期使用的具体经历", requires: ["personal_consumption_habits", "price_reference_history"] },
  { id: "social_influence_on_choices", label: "他人如何影响选择", description: "家人、同事、熟人、专业人士、评价或品牌口碑的影响", requires: ["personal_consumption_habits"] },
  { id: "current_life_pressure", label: "当前生活与工作状态", description: "近期时间压力、家庭事件、工作节点和精力状态", requires: ["career_context", "household_structure"] },
  { id: "communication_and_participation", label: "表达与参与习惯", description: "话多话少、表达节奏、争论方式和在小组中的参与状态", requires: [] }
];

const TASK_TEXT = [
  "Round 1 个人选择界面：",
  "用户要在消费者/企业、儿童/成人/老人、差异化/成本领先组成的 12 个市场格中选择一个。",
  "页面说明：差异化靠独特体验或功能赢得用户，可以定更高价格，但目标人群更窄；成本领先靠性价比和规模赢得用户，价格敏感但人群基数更大。",
  "用户还要选择产品定位方向：体验型、混合型或功能型。",
  "产品是一款 AI 宠物机器人。最后可填写 WHO、PAIN、HOW 的一句话价值主张。",
  "这是个人初选，之后才进入小组讨论。"
].join("\n");

const FORBIDDEN_BIOGRAPHY_TERMS = [
  "ToB", "ToC", "COST", "DIFF", "成本领先", "差异化", "体验型", "混合型", "功能型",
  "AI宠物", "AI 宠物", "机器人", "目标市场", "市场格", "grid_id", "Round 1", "R1",
  "本次任务", "这个任务", "课堂选择", "商业战略", "战略偏好", "应该选择", "建议选择"
];

const TRAIT_LABEL_TERMS = [
  "Maximizing", "Satisficing", "Need for Cognition", "Open-Minded", "Risk Propensity",
  "Ambiguity Tolerance", "Regulatory Focus", "Future Consequences", "Action Orientation",
  "最大化倾向", "满意化倾向", "认知需求", "开放性思维", "风险倾向", "模糊容忍",
  "调节焦点", "未来后果考量", "行动导向"
];

const INDUSTRIES_BY_TYPE = {
  "传统": ["医疗服务", "消费品", "教育培训", "跨境贸易", "连锁零售", "养老服务", "汽车后市场", "食品供应链", "物业服务", "文旅运营", "建筑工程", "物流仓配", "商业地产", "餐饮连锁", "纺织服装"],
  "新兴": ["智能制造", "企业软件", "新能源设备", "工业自动化", "金融科技", "医疗器械与数字医疗", "跨境电商", "半导体设备", "人工智能应用", "新能源汽车零部件"]
};
const INDUSTRIES = [...INDUSTRIES_BY_TYPE["传统"], ...INDUSTRIES_BY_TYPE["新兴"]];
const FIRST_DEGREE_TIERS = [["985/211 本科", 0.3], ["普通本科", 0.45], ["大专", 0.25]];
const POSTGRAD_OPTIONS = [["无", 0.37], ["国内硕士", 0.3], ["海外硕士", 0.33]];
const OVERSEAS_DESTINATIONS = ["美国", "英国", "澳大利亚", "新加坡", "加拿大", "法国", "德国", "香港"];
const OVERSEAS_MASTER_FIELDS = ["商科", "金融", "工程", "计算机", "供应链管理", "公共管理", "市场营销", "教育"];
function weightedPick(items, rng) {
  const total = items.reduce((sum, [, weight]) => sum + weight, 0);
  let roll = rng() * total;
  for (const [value, weight] of items) { roll -= weight; if (roll <= 0) return value; }
  return items[items.length - 1][0];
}
function educationFacts(age, rng) {
  const firstTier = weightedPick(FIRST_DEGREE_TIERS, rng);
  const postgrad = weightedPick(POSTGRAD_OPTIONS, rng);
  const overseas = postgrad === "海外硕士"
    ? { hasOverseas: true, destination: pick(OVERSEAS_DESTINATIONS, rng), duration: `${integer(1, 2, rng)}年`, field: pick(OVERSEAS_MASTER_FIELDS, rng), ageAt: integer(24, Math.min(34, age - 6), rng), firstJobBack: pick(["外资企业中国区", "咨询公司", "民营企业", "自己创业", "国有企业"], rng) }
    : { hasOverseas: false, destination: "", duration: "" };
  const label = postgrad === "无" ? firstTier : `${firstTier}，${postgrad}`;
  return { firstTier, postgrad, overseas, label };
}

const FUNCTIONS = [
  "销售与渠道", "市场与品牌", "运营与供应链", "产品与业务", "技术与研发",
  "财务与投资", "战略与业务发展", "客户服务与交付", "组织与人力资源", "工程与制造", "综合经营管理"
];

const ROLES_BY_FUNCTION = {
  "销售与渠道": ["区域销售负责人", "全国渠道负责人", "商业负责人"],
  "市场与品牌": ["市场负责人", "品牌负责人", "增长负责人"],
  "运营与供应链": ["运营负责人", "供应链负责人", "运营中心负责人"],
  "产品与业务": ["产品负责人", "业务线负责人", "产品事业部负责人"],
  "技术与研发": ["研发负责人", "技术负责人", "总工程师"],
  "财务与投资": ["财务负责人", "投资负责人", "区域财务总经理"],
  "战略与业务发展": ["战略负责人", "新业务发展负责人", "投资并购负责人"],
  "客户服务与交付": ["交付负责人", "客户成功负责人", "服务运营负责人"],
  "组织与人力资源": ["人力资源负责人", "组织发展负责人", "人力资源副总裁"],
  "工程与制造": ["制造基地负责人", "生产运营负责人", "工程负责人"],
  "综合经营管理": ["事业部总经理", "区域公司负责人", "创始人兼总经理"]
};

const REGIONS = ["上海", "北京", "深圳", "广州", "杭州", "苏州", "南京", "成都", "武汉", "西安", "青岛", "厦门", "长沙", "郑州"];

const COMPANY_CONTEXTS = ["民营成长型企业", "大型民营集团", "国有控股企业", "外资企业中国区", "创业公司", "区域龙头企业"];
const SURNAMES = ["陈", "林", "张", "王", "李", "周", "吴", "郑", "徐", "刘", "黄", "许", "郭", "孙", "何", "高", "罗", "谢", "梁", "宋"];
const GIVEN_NAMES = {
  male: ["志远", "建平", "明轩", "嘉诚", "文涛", "立新", "启航", "弘毅", "俊峰", "承宇"],
  female: ["慧敏", "静雯", "雅琴", "晓岚", "嘉宁", "文清", "丽君", "思远", "若琳", "海燕"]
};

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
    mode: "all",
    outputDir: DEFAULT_OUTPUT_DIR,
    schemaPath: "",
    count: 12,
    concurrency: 4,
    seed: "20260812-task-blind-persona-v1"
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--mode") args.mode = String(argv[++index] || "").trim();
    else if (arg === "--output-dir") args.outputDir = path.resolve(ROOT, String(argv[++index] || "").trim());
    else if (arg === "--schema-path") args.schemaPath = path.resolve(ROOT, String(argv[++index] || "").trim());
    else if (arg === "--count") args.count = Number(argv[++index]);
    else if (arg === "--concurrency") args.concurrency = Number(argv[++index]);
    else if (arg === "--seed") args.seed = String(argv[++index] || "").trim();
    else if (arg === "--design-file") args.designFile = path.resolve(ROOT, String(argv[++index] || "").trim());
    else throw new Error(`unknown argument: ${arg}`);
  }
  if (!["infer", "generate", "all"].includes(args.mode)) throw new Error("--mode must be infer, generate, or all");
  if (!Number.isInteger(args.count) || args.count < 1) throw new Error("--count must be a positive integer");
  if (!Number.isInteger(args.concurrency) || args.concurrency < 1) throw new Error("--concurrency must be a positive integer");
  if (!args.seed) throw new Error("--seed required");
  if (args.mode === "generate" && !args.schemaPath) throw new Error("--schema-path required in generate mode");
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

function sha256(value) {
  return crypto.createHash("sha256").update(Buffer.isBuffer(value) ? value : Buffer.from(String(value))).digest("hex");
}

function stripFence(raw) {
  return String(raw || "").trim().replace(/^```(?:json)?\s*/iu, "").replace(/\s*```$/u, "").trim();
}

function parseJsonObject(raw) {
  const text = stripFence(raw);
  const start = text.indexOf("{");
  let end = -1;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index >= 0 && index < text.length; index += 1) {
    const char = text[index];
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
      if (depth === 0) {
        end = index + 1;
        break;
      }
    }
  }
  const candidate = start >= 0 && end > start ? text.slice(start, end) : text;
  return JSON.parse(candidate.replace(/,\s*([}\]])/gu, "$1"));
}

function createSeededRandom(seedText) {
  let h = 2166136261;
  for (const char of String(seedText || "")) {
    h ^= char.charCodeAt(0);
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

function pick(items, rng) {
  return items[Math.floor(rng() * items.length)];
}

function integer(min, max, rng) {
  return min + Math.floor(rng() * (max - min + 1));
}

function chance(probability, rng) {
  return rng() < probability;
}

function fieldById(id) {
  return FIELD_CATALOG.find((field) => field.id === id);
}

function expandDependencies(selectedIds) {
  const expanded = new Set(selectedIds);
  let changed = true;
  while (changed) {
    changed = false;
    for (const id of Array.from(expanded)) {
      const field = fieldById(id);
      if (!field) continue;
      for (const dependency of field.requires) {
        if (!expanded.has(dependency)) {
          expanded.add(dependency);
          changed = true;
        }
      }
    }
  }
  return FIELD_CATALOG.map((field) => field.id).filter((id) => expanded.has(id));
}

function inferSchemaMessages() {
  return [
    {
      role: "system",
      content: [
        "你是行为模拟研究中的测量设计人员。你的职责只是判断：为了模拟人在一个任务中的自然差异，事前需要知道人物哪些一般背景信息。",
        "你不能设计人物、不能设定任何字段取值、不能预测选项、不能追求均匀分布，也不能提出任务专属 persona 类型。",
        "八个行为 trait 已经固定存在，不要再次选择心理 trait。只能从给定的一般人物字段目录中选择。",
        "选择标准：只有当同一行为 trait 下，该背景字段的不同现实取值仍可能改变理解、注意、经验联想或行动时才选择。",
        "少而够用。不要因为任务里出现了某一类用户，就要求每个人都具备与该类用户的经历。允许字段值为没有、很少或不熟悉。",
        "只输出可 JSON.parse 的 JSON。"
      ].join("\n")
    },
    {
      role: "user",
      content: [
        "【任务界面与行为】",
        TASK_TEXT,
        "",
        "【可选的一般人物字段目录】",
        ...FIELD_CATALOG.map((field) => `- ${field.id}: ${field.label}。${field.description}`),
        "",
        "选择 6-12 个直接必要字段。不要选择只为让人物更丰满但与行为差异无关的字段。",
        "输出 schema：",
        "{\"selected_fields\":[{\"field_id\":\"目录中的 id\",\"relevance_reason\":\"为什么不同取值可能改变行为，不得预测方向\",\"relevant_stages\":[\"market\",\"strategy\",\"architecture\",\"value_proposition\"]}],\"omitted_but_tempting\":[{\"field_id\":\"目录中的 id\",\"reason\":\"为什么不需要\"}]}"
      ].join("\n")
    }
  ];
}

function normalizeInferredSchema(parsed) {
  const rows = Array.isArray(parsed?.selected_fields) ? parsed.selected_fields : [];
  const seen = new Set();
  const selected = [];
  for (const row of rows) {
    const id = String(row?.field_id || "").trim();
    if (!fieldById(id)) throw new Error(`schema returned unknown field: ${id}`);
    if (seen.has(id)) continue;
    seen.add(id);
    selected.push({
      field_id: id,
      relevance_reason: String(row.relevance_reason || "").trim(),
      relevant_stages: Array.isArray(row.relevant_stages) ? row.relevant_stages.map(String) : []
    });
  }
  if (selected.length < 6 || selected.length > 12) {
    throw new Error(`schema selected ${selected.length} fields; expected 6-12`);
  }
  const expandedIds = expandDependencies(selected.map((row) => row.field_id));
  return {
    schema: "task_background_schema_v1",
    task_id: "r1_personal_market_strategy_architecture_vp",
    task_text_sha256: sha256(TASK_TEXT),
    trait_dimensions_always_present: [
      "maximizing_satisficing", "need_for_cognition", "actively_open_minded_thinking", "risk_propensity_business",
      "ambiguity_tolerance", "regulatory_focus_promotion", "consideration_future_consequences", "action_orientation"
    ],
    selected_fields: selected,
    expanded_field_ids: expandedIds,
    dependency_added_field_ids: expandedIds.filter((id) => !seen.has(id)),
    omitted_but_tempting: Array.isArray(parsed?.omitted_but_tempting) ? parsed.omitted_but_tempting : [],
    field_catalog_sha256: sha256(JSON.stringify(FIELD_CATALOG))
  };
}

async function inferSchema({ chatCompletion, modelRegistry, outputDir }) {
  const messages = inferSchemaMessages();
  const startedMs = Date.now();
  const raw = await chatCompletion(messages, {
    role: "chat_service",
    temperature: 0.1,
    max_tokens: 1800,
    timeoutMs: 90000,
    response_format: { type: "json_object" }
  });
  const schema = normalizeInferredSchema(parseJsonObject(raw));
  const schemaPath = path.join(outputDir, "background_schema.json");
  writeJson(schemaPath, {
    ...schema,
    inferred_at: new Date().toISOString(),
    provider: modelRegistry.getProvider(),
    model: modelRegistry.getModel("chat_service"),
    inference_latency_ms: Date.now() - startedMs
  });
  writeJson(path.join(outputDir, "schema_inference_audit.json"), {
    task_text: TASK_TEXT,
    task_text_sha256: sha256(TASK_TEXT),
    field_catalog: FIELD_CATALOG,
    messages,
    raw
  });
  return schemaPath;
}

function sampleFingerprint(rng) {
  const draw = () => Number((0.05 + rng() * 0.9).toFixed(2));
  return {
    maximizing_satisficing: draw(),
    need_for_cognition: draw(),
    actively_open_minded_thinking: draw(),
    risk_propensity_business: draw(),
    ambiguity_tolerance: draw(),
    regulatory_focus_promotion: draw(),
    consideration_future_consequences: draw(),
    action_orientation: draw()
  };
}

function traitBand(value) {
  if (value < 0.2) return 0;
  if (value < 0.4) return 1;
  if (value < 0.6) return 2;
  if (value < 0.8) return 3;
  return 4;
}

function traitDirectives(fingerprint) {
  const templates = {
    maximizing_satisficing: [
      "只要遇到一个能过自己底线的方案就容易停下来，不太愿意继续翻找。",
      "通常先看少数几个顺眼的方案，达到基本要求后便倾向收手。",
      "会比较几种选择，但搜索范围随时间和兴趣改变。",
      "常担心还有更合适的选项，会主动扩大搜索并反复比较。",
      "很难接受只是够用，倾向把可见选择查得很全，停手也较晚。"
    ],
    need_for_cognition: [
      "碰到复杂问题容易嫌费脑，偏好凭熟悉印象快速处理。",
      "愿意想一点，但若很快能形成说得通的判断就不再深挖。",
      "重要问题会认真分析，普通问题更多依赖经验。",
      "喜欢追问原因、比较机制，通常愿意投入较多思考。",
      "面对复杂问题会自发拆解、验证和反复推演，即使没有人要求。"
    ],
    actively_open_minded_thinking: [
      "形成第一判断后不太主动找反例，容易把反对意见当成干扰。",
      "会听不同意见，但更容易保留原先看法。",
      "证据清楚时能够调整，是否寻找反证取决于事情重要性。",
      "会主动问自己可能错在哪里，并认真处理可信的反对意见。",
      "习惯邀请最强反方；新证据充分时，即使难堪也会明显更新判断。"
    ],
    risk_propensity_business: [
      "对结果波动非常警惕，宁可放慢也希望避免明显失败。",
      "偏好风险边界清楚的路径，面对较大波动会退回保守方案。",
      "是否冒险取决于熟悉度、资源余量和退出机会。",
      "只要潜在收益足够，会接受较明显的结果波动和试错。",
      "容易被高上行机会吸引，愿意承担别人觉得过大的经营不确定性。"
    ],
    ambiguity_tolerance: [
      "信息缺口会让其明显停滞，倾向等规则和概率更清楚再行动。",
      "能容忍少量未知，但关键环节不清楚时会反复确认。",
      "会边做边补信息，同时为未知部分保留调整余地。",
      "在信息不全时也能形成临时判断，并通过行动获取反馈。",
      "对模糊状态适应很快，愿意先进入情境再逐步定义问题。"
    ],
    regulatory_focus_promotion: [
      "首先想到责任、失误和可能失去什么，目标通常编码成守住底线。",
      "安全和避免后悔更有驱动力，但机会很清楚时也会向前。",
      "进取与防守随情境切换，没有固定一边。",
      "更容易被成长、成就和向上机会激活，停滞会令其不安。",
      "强烈用突破和获得来理解成功，压力下仍倾向寻找向上的动作。"
    ],
    consideration_future_consequences: [
      "眼前结果权重很高，远期收益很难抵消当前麻烦。",
      "偏向先解决近期问题，长期影响通常排在后面。",
      "会在短期兑现与长期积累之间寻找折中。",
      "愿意为未来结果承担近期成本，不轻易透支长期关系或能力。",
      "会持续追踪多年后的后果，必要时牺牲明显的眼前收益。"
    ],
    action_orientation: [
      "拍板后也容易反复回想，受挫时恢复慢，启动常需要外力。",
      "决定后能启动，但遇到阻力容易停下来重新考虑。",
      "通常能推进，恢复速度取决于事情是否熟悉和是否有人支持。",
      "决定后会很快转入行动，受挫后能调整并继续。",
      "行动启动和恢复都很强，阻力反而容易激发持续推进。"
    ]
  };
  return Object.fromEntries(Object.entries(fingerprint).map(([key, value]) => [key, templates[key][traitBand(value)]]));
}

function householdFacts(age, rng) {
  const partnership = chance(age > 40 ? 0.82 : 0.66, rng) ? "有稳定伴侣" : pick(["单身", "离异，目前单身"], rng);
  const childCount = age < 37 ? pick([0, 0, 1], rng) : age < 47 ? pick([0, 1, 1, 2], rng) : pick([0, 1, 1, 2], rng);
  const childAges = Array.from({ length: childCount }, (_, index) => {
    const maxAge = Math.max(2, Math.min(30, age - 24 - index * 2));
    return integer(Math.max(1, maxAge - 8), maxAge, rng);
  });
  const elderLiving = chance(age > 52 ? 0.7 : 0.88, rng);
  const elderAge = elderLiving ? Math.min(92, age + integer(22, 34, rng)) : null;
  const elderProximity = elderLiving ? pick(["同住", "同城不同住", "异地，每年见几次", "车程半小时内"], rng) : "主要老人已经去世";
  return { partnership, child_count: childCount, child_ages: childAges, elder_living: elderLiving, elder_age: elderAge, elder_proximity: elderProximity };
}

function careerFacts(age, education, rng, design = null) {
  const industry = design ? pick(design.industry_set, rng) : pick(INDUSTRIES, rng);
  const industryType = INDUSTRIES_BY_TYPE["新兴"].includes(industry) ? "新兴" : "传统"; // post-hoc classification only; not a sampling factor, never written into facts
  const primaryFunction = design ? pick(design.function_set, rng) : pick(FUNCTIONS, rng);
  const currentRole = pick(ROLES_BY_FUNCTION[primaryFunction], rng);
  const companyContext = pick(COMPANY_CONTEXTS, rng);
  const careerStartAge = education.includes("硕士") ? integer(23, 25, rng) : education.includes("大专") ? 21 : 22;
  const careerYears = Math.max(10, age - careerStartAge);
  return { industry, industry_type: industryType, primary_function: primaryFunction, current_role: currentRole, company_context: companyContext, career_start_age: careerStartAge, career_years: careerYears };
}

function managementScope(career, rng) {
  const team = integer(12, career.current_role.includes("总经理") ? 260 : 95, rng);
  const responsibility = pick([
    `直接或间接管理约 ${team} 人，负责一个区域的收入和交付`,
    `带领约 ${team} 人团队，负责多个关键项目及年度预算`,
    `管理约 ${team} 人，承担业务增长、质量和人员稳定责任`,
    `协调约 ${team} 人的跨职能团队，对进度、成本和客户结果负责`
  ], rng);
  return responsibility;
}

function customerExposure(career, rng) {
  const b2bIndustries = new Set(["智能制造", "企业软件", "新能源设备", "工业自动化", "建筑工程", "物流仓配"]);
  const consumerIndustries = new Set(["消费品", "教育培训", "连锁零售", "汽车后市场", "文旅运营"]);
  if (b2bIndustries.has(career.industry)) {
    return pick(["长期面对企业采购、业务负责人和一线使用部门，见过付款者与使用者意见不一致。", "主要服务机构客户，熟悉招采、试用、验收和续约链条。"], rng);
  }
  if (consumerIndustries.has(career.industry)) {
    return pick(["长期接触个人消费者和渠道反馈，也见过实际使用者与付款家人意见不同。", "熟悉门店或线上消费者决策，常听一线人员转述退换、闲置和复购原因。"], rng);
  }
  return pick(["工作中同时接触机构客户与个人服务对象，对付款、使用和影响决策的角色有混合经验。", "平时更多通过合作机构接触最终使用者，对两端信息都有经验但并不完整。"], rng);
}

function procurementExposure(career, rng) {
  const strong = ["运营与供应链", "财务与投资", "工程与制造", "技术与研发", "综合经营管理"].includes(career.primary_function);
  return strong
    ? pick(["本人经常参与供应商比较和预算审批，也承担过买便宜后返工、买贵却闲置的后果。", "对关键采购有拍板权，习惯把采购价、使用成本、稳定性和执行难度一起看。"], rng)
    : pick(["偶尔参与采购评审，但通常由财务或运营最终拍板；本人更关注使用和客户反馈。", "有部门预算经验，熟悉小额工具采购，对大型采购只提供业务意见。"], rng);
}

function technologyFamiliarity(career, rng) {
  const technical = ["技术与研发", "产品与业务", "工程与制造"].includes(career.primary_function);
  return technical
    ? pick(["工作中经常接触软件系统、传感器或自动化设备，能判断基本功能，但不是所有消费技术都熟。", "对软硬件集成和系统可靠性较熟，愿意自己试用新设备。"], rng)
    : pick(["日常办公软件熟练，智能设备主要靠同事或家人推荐，对技术参数耐心有限。", "会使用常见数字工具，但面对陌生硬件更关注是否容易上手和有没有售后。", "对新设备兴趣一般，能不换就不换，必要时会请熟人帮忙挑。"], rng);
}

function economicFacts(career, household, rng) {
  const pressures = [
    "家庭现金流总体稳定，但仍有房贷和子女教育支出，不会把所有消费都视为小钱。",
    "收入较稳定，可支配空间尚可；工作忙，常愿意用钱换时间，但对长期固定支出谨慎。",
    "近两年承担家庭住房或老人医疗支出，金额较大时会明显犹豫。",
    "没有迫切债务压力，但长期职业不确定性使其保留较高储蓄。",
    "家庭财务由伴侣更多管理，本人对日常价格并不总敏感，看到大额账单才会认真比较。"
  ];
  return `${pick(pressures, rng)} 当前岗位为${career.current_role}；家庭状态为${household.partnership}。`;
}

function consumptionHabit(rng) {
  return pick([
    "日常小额购买很快，耐用品会看几轮评价；一旦熟人给出可信建议，常提前停止搜索。",
    "习惯先定一个可接受预算，再从两三款里选；不总买最低价，也很少追最新款。",
    "工作太忙时会让伴侣或同事代选，自己只确认几个底线，买后不爱退换。",
    "容易被新功能打动，但也有买回家闲置的经历；事后会自嘲，下次仍未必改。",
    "对自己较节省，对家人或团队用品更愿意多付；是否比价取决于当时有没有时间。",
    "很爱比较参数和评价，有时为了几百元来回犹豫，最后也可能因为省事选较贵的。"
  ], rng);
}

function priceHistory(rng) {
  const episodes = [
    () => `换过一台 ${integer(28, 86, rng) * 100} 元的手机，原先在更便宜和更省心之间犹豫。`,
    () => `家里买过一件 ${integer(18, 75, rng) * 100} 元的耐用品，使用了${integer(2, 9, rng)}年。`,
    () => `为家人付过每月 ${integer(12, 58, rng) * 100} 元的教育、照护或康复服务。`,
    () => `部门采购过约 ${integer(8, 85, rng)} 万元的软件、设备或服务，实际使用评价并不完全一致。`,
    () => `订阅过每年 ${integer(3, 24, rng) * 100} 元的服务，后来因使用频率不足取消或降档。`,
    () => `买过一件 ${integer(3, 16, rng) * 100} 元的小型智能设备，有时常用，有时很快闲置。`
  ];
  const first = Math.floor(rng() * episodes.length);
  let second = Math.floor(rng() * episodes.length);
  if (second === first) second = (second + 1) % episodes.length;
  return `${episodes[first]()} ${episodes[second]()}`;
}

function qualityTradeoff(rng) {
  return pick([
    "曾经为省钱买过一件使用麻烦的东西，后来又重新购买；此后在高频用品上更看重省心。",
    "曾经为所谓高级功能多付钱，结果大部分功能没有用到；后来会先问实际使用者。",
    "有一件价格不高的东西意外用了很多年，使其不再简单把贵和可靠画等号。",
    "曾因时间紧直接选了熟悉供应商，结果稳定但价格偏高；本人并不确定当时是否最划算。",
    "给自己买东西常将就，涉及家人安全或团队交付时却容易接受额外花费。",
    "会为设计、手感或服务多付，但若使用频率低，事后又会明显后悔。"
  ], rng);
}

function intergenerationalFacts(household, rng) {
  const child = household.child_count > 0
    ? `与${household.child_count}个子女有真实日常接触，年龄为${household.child_ages.join("、")}岁。`
    : pick(["没有子女，与儿童接触很少。", "没有子女，偶尔在亲友聚会接触孩子，但不熟悉日常照料。"], rng);
  const elder = household.elder_living
    ? `有一位约${household.elder_age}岁的长辈，${household.elder_proximity}。`
    : "主要长辈已经去世，近年没有持续照护老人。";
  return `${child} ${elder}`;
}

function caregivingFacts(household, rng) {
  const possibilities = ["本人承担日常安排和关键决定", "主要由伴侣或兄弟姐妹照料，本人只在紧急时参与", "家庭成员总体独立，目前没有持续照护责任"];
  if (!household.elder_living && household.child_count === 0) return possibilities[2];
  return pick(possibilities, rng);
}

function socialInfluence(rng) {
  return pick([
    "对熟人实际用过的反馈信任很高，常胜过广告和陌生评价。",
    "家里大件通常与伴侣共同决定，工作用品更听实际使用者。",
    "专业人士的意见会明显改变其判断，但不喜欢被销售人员催促。",
    "同事使用什么会形成参照，不过本人不愿承认自己在跟随。",
    "习惯自己做决定，除非家人明确反对，否则很少重新比较。"
  ], rng);
}

function currentPressure(career, household, rng) {
  return pick([
    `最近正赶一个跨部门项目，睡眠不足，容易先抓自己熟悉的${career.primary_function}问题。`,
    `工作进入年度预算与复盘期，时间紧，但仍希望在同学面前显得准备充分。`,
    household.elder_living ? "最近刚处理过一次长辈复诊或家庭安排，这件事偶尔会占据注意力。" : "近期家庭较平稳，主要注意力在工作晋升和团队问题上。",
    household.child_count > 0 ? "最近正为子女的一项学习或生活安排分心，来上课前还在回消息。" : "最近频繁出差，课堂上精力一般，可能不愿逐项读完。"
  ], rng);
}

function communicationTexture(rng) {
  return pick([
    "说话短，先报结论，别人追问才补理由；不太使用完整书面句。",
    "喜欢用自己的行业例子绕着讲，有时说着说着才回到问题。",
    "表达有条理但略像汇报，被挑战时会停一下再改口。",
    "话多、反应快，容易接别人的话，也可能把讨论带偏。",
    "课堂上通常先听，不确定时只说半句；真正熟悉的地方会突然讲得很细。",
    "语气直接，常用数字或具体事情，不爱讲抽象框架。"
  ], rng);
}

function buildFactCard(index, seed, schema) {
  const rng = createSeededRandom(`${seed}:facts:${index + 1}`);
  const personaId = `TBN${String(index + 1).padStart(2, "0")}`;
  const design = DESIGN ? DESIGN[index % DESIGN.length] : null;
  const age = design ? integer(design.age_range[0], design.age_range[1], rng) : integer(34, 58, rng);
  const gender = chance(0.42, rng) ? "female" : "male";
  const eduFacts = educationFacts(age, rng);
  const education = eduFacts.label;
  const region = pick(REGIONS, rng);
  const origin = pick(REGIONS.filter((item) => item !== region), rng);
  const career = careerFacts(age, education, rng, design);
  const household = householdFacts(age, rng);
  const fingerprint = sampleFingerprint(createSeededRandom(`${seed}:traits:${index + 1}`));
  const allFacts = {
    age_and_life_stage: `${age}岁，处在职业责任已经较重、个人生活结构相对稳定但仍可能变化的阶段。`,
    gender: gender === "female" ? "女" : "男",
    education_and_learning: eduFacts.overseas.hasOverseas
      ? `第一学历${eduFacts.firstTier}；${eduFacts.overseas.ageAt}岁左右去${eduFacts.overseas.destination}读了${eduFacts.overseas.duration}${eduFacts.overseas.field}硕士，回国后第一份工作在${eduFacts.overseas.firstJobBack}；专业训练与${career.primary_function}相关或在职业中逐步补齐。`
      : `第一学历${eduFacts.firstTier}${eduFacts.postgrad === "国内硕士" ? "，之后在国内读了硕士" : "，没有再读学位"}；专业训练与${career.primary_function}相关或在职业中逐步补齐。`,
    region_and_mobility: `成长于${origin}，目前在${region}工作生活，中间至少有一次因工作迁移。`,
    career_context: `${career.company_context}的${career.current_role}，所在行业为${career.industry}，主要职能是${career.primary_function}。`,
    career_trajectory: `${career.career_start_age}岁左右进入职场，已有约${career.career_years}年经验；从专业或一线岗位逐步承担项目、团队和经营责任，职业变化必须围绕${career.industry}或相邻行业、${career.primary_function}或相邻职能展开。`,
    managerial_scope: managementScope(career, rng),
    customer_and_user_exposure: customerExposure(career, rng),
    procurement_and_budget_exposure: procurementExposure(career, rng),
    product_and_technology_familiarity: technologyFamiliarity(career, rng),
    household_structure: `${household.partnership}；子女数${household.child_count}${household.child_count ? `，年龄${household.child_ages.join("、")}岁` : ""}；${household.elder_living ? `有约${household.elder_age}岁长辈，${household.elder_proximity}` : household.elder_proximity}。`,
    intergenerational_contact: intergenerationalFacts(household, rng),
    caregiving_and_dependents: caregivingFacts(household, rng),
    economic_resources_and_pressure: economicFacts(career, household, rng),
    personal_consumption_habits: consumptionHabit(rng),
    price_reference_history: priceHistory(rng),
    quality_convenience_tradeoffs: qualityTradeoff(rng),
    social_influence_on_choices: socialInfluence(rng),
    current_life_pressure: currentPressure(career, household, rng),
    communication_and_participation: communicationTexture(rng)
  };
  const selectedFacts = Object.fromEntries(schema.expanded_field_ids.map((id) => [id, allFacts[id]]));
  return {
    persona_id: personaId,
    seed: `${seed}:${index + 1}`,
    name: `${pick(SURNAMES, rng)}${pick(GIVEN_NAMES[gender], rng)}`,
    surface: { gender, age, edu: education, edu_first_tier: eduFacts.firstTier, postgrad: eduFacts.postgrad, overseas: eduFacts.overseas, region, industry: career.industry, industry_type: career.industry_type, design_cell: design ? design.cell : null },
    behavioral_fingerprint: fingerprint,
    behavioral_directives: traitDirectives(fingerprint),
    frozen_facts: selectedFacts,
    sampling_provenance: {
      task_text_seen: false,
      schema_relevance_reasons_seen: false,
      selected_field_ids: schema.expanded_field_ids,
      sampler: "deterministic_general_population_priors_v2_faultline"
    }
  };
}

function biographyMessages(card) {
  return [
    {
      role: "system",
      content: [
        "你是严肃现实主义人物小传作者。请把一张已经冻结的人物事实卡写成一个连贯、具体、像真实中国高管项目学员的人。",
        "你不知道这个人以后会参加什么研究、看什么界面或做什么任务，也不要猜测。",
        "事实卡中的内容和八条行为表现都是硬约束，但不要逐字段复述，不要写成用户画像、心理测评、咨询报告或优缺点清单。",
        "先让职业与生活经历有时间连续性，再用具体的小事、成功、吃亏、家庭分工、花钱或工作习惯自然表现行为。",
        "同一个人可以矛盾。不要替人物总结稳定的商业立场，不要预告未来会选择什么。",
        "不得出现任何 trait 名称、分数或高低标签。只输出可 JSON.parse 的 JSON。"
      ].join("\n")
    },
    {
      role: "user",
      content: [
        `姓名：${card.name}`,
        "",
        "【冻结事实；不得更改】",
        ...Object.entries(card.frozen_facts).map(([id, value]) => `${id}: ${value}`),
        "",
        "【八条行为表现；只能通过故事、动作和语言表现，不能解释成标签】",
        ...Object.values(card.behavioral_directives).map((value) => `- ${value}`),
        "",
        "写一篇 900-1300 字的第三人称人物小传。必须包括连贯职业主线、当前生活结构、两到四件能留下行为痕迹的具体往事、自然的说话和课堂参与状态。",
        "只写这个人的一般人生，不出现任何未来任务、产品方案、市场选项或推荐答案。",
        "只输出：{\"biography\":\"完整连续的小传正文\"}"
      ].join("\n")
    }
  ];
}

function normalizeBiography(raw, card) {
  const parsed = parseJsonObject(raw);
  const biography = String(parsed?.biography || "").replace(/\s+/gu, " ").trim();
  if (biography.length < 650) throw new Error(`biography too short: ${biography.length}`);
  if (biography.length > 1800) throw new Error(`biography too long: ${biography.length}`);
  if (!biography.includes(card.name)) throw new Error("biography does not contain frozen name");
  const forbiddenHits = FORBIDDEN_BIOGRAPHY_TERMS.filter((term) => biography.includes(term));
  if (forbiddenHits.length > 0) throw new Error(`task leakage: ${forbiddenHits.join(", ")}`);
  const traitLabelHits = TRAIT_LABEL_TERMS.filter((term) => biography.includes(term));
  if (traitLabelHits.length > 0) throw new Error(`trait label leakage: ${traitLabelHits.join(", ")}`);
  return biography;
}

async function generatePool({ args, schemaPath, chatCompletion, modelRegistry }) {
  const schemaBytes = fs.readFileSync(schemaPath);
  const schema = JSON.parse(schemaBytes.toString("utf8"));
  if (schema.schema !== "task_background_schema_v1") throw new Error(`unexpected schema: ${schema.schema}`);
  const cards = Array.from({ length: args.count }, (_, index) => buildFactCard(index, args.seed, schema));
  const factsPath = path.join(args.outputDir, "frozen_fact_cards.json");
  writeJson(factsPath, cards);
  const callsPath = path.join(args.outputDir, "biography_calls.jsonl");
  if (fs.existsSync(callsPath)) fs.unlinkSync(callsPath);
  const records = [];
  const errors = [];
  const { default: pLimit } = await import("p-limit");
  const limit = pLimit(args.concurrency);
  const startedAt = new Date().toISOString();
  const startedMs = Date.now();

  await Promise.all(cards.map((card) => limit(async () => {
    let lastError = "";
    for (let attempt = 1; attempt <= 8; attempt += 1) {
      const messages = biographyMessages(card);
      if (lastError) messages[1].content += `\n\n上一稿未通过机械检查：${lastError}。请重写全文，不要解释检查。`;
      const callStartedMs = Date.now();
      let raw = "";
      try {
        raw = await chatCompletion(messages, {
          role: "chat_service",
          temperature: 0.9,
          max_tokens: 3000,
          timeoutMs: 90000,
          response_format: { type: "json_object" }
        });
        const biography = normalizeBiography(raw, card);
        records.push({
          schema: "task_blind_narrative_v1",
          persona_id: card.persona_id,
          seed: card.seed,
          surface: { ...card.surface, name: card.name, mbti: "", expression_style: "见人物小传" },
          behavioral_fingerprint: card.behavioral_fingerprint,
          frozen_facts: card.frozen_facts,
          biography,
          generation_provenance: {
            task_text_seen_by_biography_writer: false,
            task_schema_reasons_seen_by_biography_writer: false,
            biography_input_sha256: sha256(messages[1].content),
            background_schema_sha256: sha256(schemaBytes),
            fact_card_seed: card.seed
          },
          synthetic: true
        });
        appendJsonl(callsPath, { ts: new Date().toISOString(), persona_id: card.persona_id, attempt, status: "ok", latency_ms: Date.now() - callStartedMs, raw });
        return;
      } catch (error) {
        lastError = String(error?.message || error);
        appendJsonl(callsPath, { ts: new Date().toISOString(), persona_id: card.persona_id, attempt, status: "error", latency_ms: Date.now() - callStartedMs, error: lastError, raw });
      }
    }
    errors.push({ persona_id: card.persona_id, error: lastError });
  })));

  records.sort((left, right) => left.persona_id.localeCompare(right.persona_id));
  const poolPath = path.join(args.outputDir, "persona_pool_task_blind_narrative_v1.json");
  writeJson(poolPath, records);
  writeJson(path.join(args.outputDir, "pool_manifest.json"), {
    schema: "task_blind_narrative_pool_manifest_v1",
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
    background_schema_path: path.relative(ROOT, schemaPath),
    background_schema_sha256: sha256(schemaBytes),
    frozen_fact_cards_path: path.relative(ROOT, factsPath),
    frozen_fact_cards_sha256: sha256(fs.readFileSync(factsPath)),
    pool_path: path.relative(ROOT, poolPath),
    pool_sha256: sha256(fs.readFileSync(poolPath)),
    information_firewall: {
      task_analyzer_sees: ["task_text", "generic_field_catalog", "trait_dimension_names_only"],
      fact_sampler_sees: ["expanded_field_ids", "general_population_priors", "seed"],
      biography_writer_sees: ["frozen_fact_values", "natural_language_trait_directives", "name"],
      biography_writer_does_not_see: ["task_text", "task_id", "task_options", "schema_relevance_reasons", "trait_numbers"]
    },
    forbidden_biography_terms: FORBIDDEN_BIOGRAPHY_TERMS,
    forbidden_biography_term_hits: records.flatMap((record) => FORBIDDEN_BIOGRAPHY_TERMS.filter((term) => record.biography.includes(term)).map((term) => ({ persona_id: record.persona_id, term }))),
    script_path: path.relative(ROOT, __filename),
    script_sha256: sha256(fs.readFileSync(__filename))
  });
  if (errors.length > 0) throw new Error(`failed to generate ${errors.length} biographies`);
  return poolPath;
}

let DESIGN = null;
async function main() {
  loadLocalEnv();
  const args = parseArgs(process.argv.slice(2));
  if (args.designFile) DESIGN = JSON.parse(fs.readFileSync(args.designFile, "utf8"));
  const { chatCompletion, hasAnyKey } = require("../../server/llm/deepseekClient");
  const modelRegistry = require("../../server/llm/modelRegistry");
  if (!hasAnyKey()) throw new Error("missing LLM API key");
  fs.mkdirSync(args.outputDir, { recursive: true });

  let schemaPath = args.schemaPath;
  if (args.mode === "infer" || args.mode === "all") {
    schemaPath = await inferSchema({ chatCompletion, modelRegistry, outputDir: args.outputDir });
    console.log(JSON.stringify({ schema_path: path.relative(ROOT, schemaPath) }, null, 2));
  }
  if (args.mode === "generate" || args.mode === "all") {
    const poolPath = await generatePool({ args, schemaPath, chatCompletion, modelRegistry });
    console.log(JSON.stringify({ pool_path: path.relative(ROOT, poolPath), count: args.count }, null, 2));
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.stack || error.message || String(error));
    process.exitCode = 1;
  });
}
