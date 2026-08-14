"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const ROOT = path.join(__dirname, "..", "..");
const DEFAULT_OUTPUT_DIR = path.join(ROOT, "data", "career_general_profile_pool_v2");

const INDUSTRIES = [
  "医疗服务", "消费品", "智能制造", "教育培训", "跨境贸易", "企业软件",
  "连锁零售", "新能源设备", "养老服务", "汽车后市场", "食品供应链", "工业自动化",
  "物业服务", "金融科技", "文旅运营", "建筑工程", "物流仓配", "商业地产"
];

const FUNCTIONS = [
  "销售与渠道", "市场与品牌", "运营与供应链", "产品与业务", "技术与研发",
  "财务与投资", "战略与业务发展", "客户服务与交付", "组织与人力资源", "工程与制造",
  "综合经营管理"
];

const ROLE_CONTEXTS_BY_FUNCTION = {
  "销售与渠道": ["销售与渠道负责人", "首席商业官", "全国销售负责人", "渠道事业部负责人"],
  "市场与品牌": ["市场与品牌负责人", "首席市场官", "品牌事业部负责人", "增长负责人"],
  "运营与供应链": ["运营负责人", "首席运营官", "供应链负责人", "运营中心负责人"],
  "产品与业务": ["产品与业务负责人", "首席产品官", "业务线负责人", "产品事业部负责人"],
  "技术与研发": ["技术与研发负责人", "首席技术官", "研发中心负责人", "总工程师"],
  "财务与投资": ["财务负责人", "首席财务官", "投资负责人", "并购后整合负责人"],
  "战略与业务发展": ["战略与业务发展负责人", "集团战略负责人", "投资并购负责人", "新业务发展负责人"],
  "客户服务与交付": ["客户服务与交付负责人", "大客户交付负责人", "交付中心负责人", "客户成功负责人"],
  "组织与人力资源": ["组织与人力资源负责人", "首席人力资源官", "组织发展负责人", "人力资源副总裁"],
  "工程与制造": ["工程与制造负责人", "生产运营负责人", "制造基地总经理", "总工程师"],
  "综合经营管理": ["创始人兼总经理", "事业部总经理", "区域公司负责人", "集团副总裁", "民营企业合伙人"]
};

const INDUSTRY_FUNCTION_PRIORS = {
  "医疗服务": ["客户服务与交付", "运营与供应链", "产品与业务", "市场与品牌", "财务与投资", "组织与人力资源", "战略与业务发展"],
  "消费品": ["销售与渠道", "市场与品牌", "运营与供应链", "产品与业务", "财务与投资", "战略与业务发展", "工程与制造"],
  "智能制造": ["工程与制造", "技术与研发", "运营与供应链", "销售与渠道", "产品与业务", "财务与投资", "战略与业务发展"],
  "教育培训": ["产品与业务", "市场与品牌", "销售与渠道", "客户服务与交付", "运营与供应链", "组织与人力资源", "财务与投资"],
  "跨境贸易": ["销售与渠道", "运营与供应链", "客户服务与交付", "财务与投资", "市场与品牌", "战略与业务发展"],
  "企业软件": ["技术与研发", "产品与业务", "销售与渠道", "客户服务与交付", "市场与品牌", "战略与业务发展", "财务与投资"],
  "连锁零售": ["运营与供应链", "销售与渠道", "市场与品牌", "产品与业务", "财务与投资", "组织与人力资源", "战略与业务发展"],
  "新能源设备": ["工程与制造", "技术与研发", "销售与渠道", "运营与供应链", "财务与投资", "战略与业务发展", "产品与业务"],
  "养老服务": ["客户服务与交付", "运营与供应链", "产品与业务", "市场与品牌", "组织与人力资源", "财务与投资", "战略与业务发展"],
  "汽车后市场": ["销售与渠道", "运营与供应链", "产品与业务", "客户服务与交付", "市场与品牌", "财务与投资", "技术与研发"],
  "食品供应链": ["运营与供应链", "销售与渠道", "工程与制造", "财务与投资", "客户服务与交付", "产品与业务", "战略与业务发展"],
  "工业自动化": ["技术与研发", "工程与制造", "销售与渠道", "产品与业务", "运营与供应链", "财务与投资", "客户服务与交付"],
  "物业服务": ["运营与供应链", "客户服务与交付", "销售与渠道", "组织与人力资源", "财务与投资", "产品与业务", "战略与业务发展"],
  "金融科技": ["技术与研发", "产品与业务", "财务与投资", "销售与渠道", "客户服务与交付", "运营与供应链", "战略与业务发展"],
  "文旅运营": ["运营与供应链", "市场与品牌", "销售与渠道", "客户服务与交付", "产品与业务", "财务与投资", "战略与业务发展"],
  "建筑工程": ["工程与制造", "运营与供应链", "销售与渠道", "财务与投资", "战略与业务发展", "客户服务与交付", "组织与人力资源"],
  "物流仓配": ["运营与供应链", "技术与研发", "销售与渠道", "客户服务与交付", "产品与业务", "财务与投资", "工程与制造"],
  "商业地产": ["财务与投资", "运营与供应链", "销售与渠道", "市场与品牌", "工程与制造", "客户服务与交付", "战略与业务发展"]
};

const INDUSTRY_ADJACENCY = {
  "医疗服务": ["养老服务"],
  "养老服务": ["医疗服务", "物业服务"],
  "消费品": ["连锁零售", "食品供应链", "跨境贸易"],
  "连锁零售": ["消费品", "食品供应链", "物业服务"],
  "食品供应链": ["消费品", "连锁零售", "物流仓配"],
  "跨境贸易": ["消费品", "物流仓配"],
  "智能制造": ["工业自动化", "新能源设备", "汽车后市场"],
  "工业自动化": ["智能制造", "新能源设备", "企业软件"],
  "新能源设备": ["智能制造", "工业自动化"],
  "汽车后市场": ["智能制造", "物流仓配"],
  "企业软件": ["金融科技", "工业自动化"],
  "金融科技": ["企业软件"],
  "教育培训": ["企业软件"],
  "物业服务": ["商业地产", "养老服务", "连锁零售"],
  "商业地产": ["物业服务", "建筑工程", "文旅运营"],
  "建筑工程": ["商业地产", "物业服务"],
  "文旅运营": ["商业地产", "连锁零售"],
  "物流仓配": ["食品供应链", "跨境贸易", "汽车后市场"]
};

const FUNCTION_ADJACENCY = {
  "销售与渠道": ["市场与品牌", "客户服务与交付", "战略与业务发展"],
  "市场与品牌": ["销售与渠道", "产品与业务", "战略与业务发展"],
  "运营与供应链": ["客户服务与交付", "工程与制造", "产品与业务"],
  "产品与业务": ["技术与研发", "市场与品牌", "客户服务与交付", "运营与供应链"],
  "技术与研发": ["产品与业务", "工程与制造"],
  "财务与投资": ["战略与业务发展"],
  "战略与业务发展": ["财务与投资", "销售与渠道", "市场与品牌"],
  "客户服务与交付": ["运营与供应链", "销售与渠道", "产品与业务"],
  "组织与人力资源": [],
  "工程与制造": ["技术与研发", "运营与供应链"],
  "综合经营管理": []
};

const EDUCATION_BANDS = [
  { label: "大专", graduationAge: 21 },
  { label: "本科（非985）", graduationAge: 22 },
  { label: "本科（985/211）", graduationAge: 22 },
  { label: "硕士（国内）", graduationAge: 25 },
  { label: "硕士（海外）", graduationAge: 24 },
  { label: "博士", graduationAge: 29 }
];

const REGIONS = [
  "长三角", "珠三角", "京津冀", "成渝", "山东", "福建", "河南", "湖北", "湖南", "陕西"
];

const REGION_INDUSTRY_PRIORS = {
  "长三角": ["企业软件", "金融科技", "医疗服务", "消费品", "智能制造", "连锁零售", "商业地产"],
  "珠三角": ["智能制造", "跨境贸易", "消费品", "工业自动化", "新能源设备", "物流仓配", "连锁零售"],
  "京津冀": ["医疗服务", "教育培训", "企业软件", "金融科技", "建筑工程", "商业地产", "物业服务"],
  "成渝": ["汽车后市场", "智能制造", "新能源设备", "文旅运营", "物流仓配", "连锁零售", "医疗服务"],
  "山东": ["智能制造", "食品供应链", "工业自动化", "建筑工程", "物流仓配", "消费品", "新能源设备"],
  "福建": ["跨境贸易", "消费品", "食品供应链", "文旅运营", "连锁零售", "物业服务", "建筑工程"],
  "河南": ["食品供应链", "物流仓配", "建筑工程", "医疗服务", "教育培训", "连锁零售", "物业服务"],
  "湖北": ["智能制造", "医疗服务", "教育培训", "汽车后市场", "工业自动化", "物流仓配", "建筑工程"],
  "湖南": ["智能制造", "消费品", "文旅运营", "建筑工程", "医疗服务", "食品供应链", "连锁零售"],
  "陕西": ["工业自动化", "新能源设备", "建筑工程", "教育培训", "文旅运营", "智能制造", "医疗服务"]
};

const SURNAMES = [
  "陈", "林", "张", "王", "李", "周", "吴", "郑", "徐", "刘", "黄", "许", "郭", "孙", "何", "高", "罗", "谢", "梁", "宋"
];

const GIVEN_NAMES = {
  male: ["志远", "建平", "明轩", "嘉诚", "文涛", "立新", "启航", "弘毅", "俊峰", "承宇", "致远", "伟民", "世杰", "博文", "少华", "振华", "宏斌", "景明", "海川", "凯文"],
  female: ["慧敏", "静雯", "雅琴", "晓岚", "嘉宁", "文清", "丽君", "思远", "若琳", "海燕", "欣怡", "佩珊", "雨晴", "婉宁", "丹青", "秀梅", "佳慧", "敏仪", "雪莹", "清华"]
};

const TASK_CONTEXT_TERMS = [
  "ToB", "ToC", "COST", "DIFF", "成本领先", "差异化", "体验型", "混合型", "功能型",
  "AI宠物", "AI 宠物", "Round 1", "R1", "课堂讨论", "本次任务", "这个游戏"
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
    count: 6,
    seed: "20260812-career-general-profile-v2",
    outputDir: DEFAULT_OUTPUT_DIR,
    concurrency: 3
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

function pickOther(list, excluded, rng) {
  const candidates = list.filter((value) => value !== excluded);
  return pick(candidates, rng);
}

function weightedPick(items, rng) {
  const total = items.reduce((sum, item) => sum + item.weight, 0);
  let draw = rng() * total;
  for (const item of items) {
    draw -= item.weight;
    if (draw <= 0) return item.value;
  }
  return items[items.length - 1].value;
}

function sampleTrait(rng, index, offset = 0) {
  const anchors = [0.1, 0.26, 0.42, 0.58, 0.74, 0.9];
  const anchor = anchors[(index + offset) % anchors.length];
  return Math.max(0.04, Math.min(0.96, Number((anchor + (rng() - 0.5) * 0.14).toFixed(2))));
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

function levelIndex(value) {
  if (value < 0.2) return 0;
  if (value < 0.4) return 1;
  if (value < 0.6) return 2;
  if (value < 0.8) return 3;
  return 4;
}

function behaviorDirective(key, value) {
  const templates = {
    maximizing_satisficing: [
      "有一个能过线的方案便愿意停手，不会为了最优解持续扩展选项。",
      "通常先看少数熟悉方案，达到基本要求后就倾向结束比较。",
      "会比较几条主要路径，但搜索深度随事情重要性而变化。",
      "会主动扩大备选范围，担心过早停手漏掉更好的可能。",
      "很难接受只是够用，会持续搜索、反复比较并提高自己的停手门槛。"
    ],
    need_for_cognition: [
      "抗拒长时间分析，偏好用经验捷径和可信人的判断减轻认知负担。",
      "只在必要处下功夫，信息一复杂就会先抓最直观的判断线索。",
      "既能分析也会凭经验，投入多少思考取决于责任和兴趣。",
      "愿意拆解复杂问题，常追问机制、数据口径和因果关系。",
      "把深度思考本身当成乐趣，会自发建框架、查细节并检验逻辑。"
    ],
    actively_open_minded_thinking: [
      "形成看法后很少主动找反证，异议容易被理解成不懂现场。",
      "会听不同意见，但主要用来修补原方案而非改变基本判断。",
      "是否更新取决于反对者的可信度和证据是否贴近实际。",
      "会主动问自己可能错在哪里，遇到扎实反证时能明显调整。",
      "习惯邀请最强反对意见，并愿意推翻自己已经投入很多的判断。"
    ],
    risk_propensity_business: [
      "强烈厌恶经营波动，宁可放弃上行空间也要降低失控概率。",
      "愿意承担有限风险，但必须保留退出通道和可承受的最坏结果。",
      "风险取向随资源余量和熟悉程度变化，不固定冒进或保守。",
      "能够接受较大结果波动，只要机会值得且责任边界清楚。",
      "对高波动机会有明显吸引力，容易把可控损失视为换取跃迁的代价。"
    ],
    ambiguity_tolerance: [
      "信息不完整会显著不安，倾向等待规则、责任和结果范围更清楚。",
      "面对模糊问题会先缩小范围，用熟悉标准把不确定性压下来。",
      "可以在部分未知下推进，但需要几个关键支点保持可解释性。",
      "能在信息缺口中行动，并通过试探和反馈逐步形成判断。",
      "对开放、无标准答案的问题感到兴奋，愿意边行动边定义问题。"
    ],
    regulatory_focus_promotion: [
      "主要以避免损失、履行责任和不出差错来判断自己是否做对。",
      "更在意守住已有成果和保护相关人的安全感。",
      "既看增长机会也看失误代价，两种目标会随压力切换。",
      "主要被进步、增长和证明潜力驱动，能容忍为机会暴露一点风险。",
      "强烈追求跃迁和突破，容易把没有前进体验为一种失败。"
    ],
    consideration_future_consequences: [
      "当前结果和即时压力权重极高，远期收益很难抵消眼前成本。",
      "会考虑后续影响，但只要近期压力足够大就会明显折现未来。",
      "短期兑现与长期积累大体并重，常寻找能兼顾两者的路径。",
      "愿意牺牲部分近期结果来换取能力、关系或组织基础。",
      "习惯按多年尺度衡量选择，容易低估当前人的耐心和现金压力。"
    ],
    action_orientation: [
      "决定后仍容易反刍和迟滞，受挫后恢复启动需要外部推动。",
      "可以启动熟悉事项，但遇到阻力会反复回看决定并放慢执行。",
      "执行状态受团队响应和个人精力影响，顺时推进、逆时停顿。",
      "拍板后会迅速拆任务推进，失败后通常能把注意力拉回下一步。",
      "有很强的启动和恢复能力，越有阻力越容易进入持续行动状态。"
    ]
  };
  return templates[key][levelIndex(value)];
}

function buildBehaviorDirectives(fingerprint) {
  return Object.fromEntries(
    Object.entries(fingerprint).map(([key, value]) => [key, behaviorDirective(key, value)])
  );
}

function childLifeStage(age) {
  if (age <= 2) return "婴幼儿";
  if (age <= 6) return "学龄前";
  if (age <= 12) return "小学阶段";
  if (age <= 18) return "中学阶段";
  if (age <= 24) return "大学或初入职场";
  return "已成年独立生活";
}

function buildFamilyLifeSeed(age, gender, currentRegion, rng) {
  const partnershipStatus = weightedPick([
    { value: "已婚或长期伴侣关系稳定", weight: 72 },
    { value: "离异，目前单身", weight: 12 },
    { value: "未婚，目前单身", weight: 10 },
    { value: "再婚家庭", weight: 6 }
  ], rng);
  const childCount = weightedPick([
    { value: 0, weight: 18 },
    { value: 1, weight: 57 },
    { value: 2, weight: 25 }
  ], rng);
  const firstChildAge = childCount > 0
    ? Math.max(1, age - (25 + Math.floor(rng() * 11)))
    : null;
  const children = [];
  for (let index = 0; index < childCount; index += 1) {
    const childAge = Math.max(1, firstChildAge - index * (2 + Math.floor(rng() * 5)));
    const childGender = rng() < 0.5 ? "女儿" : "儿子";
    const independent = childAge >= 23;
    children.push({
      relation: childGender,
      age: childAge,
      life_stage: childLifeStage(childAge),
      living_arrangement: independent && rng() < 0.72 ? "在外地或独立居住" : "同住或经常回家",
      everyday_contact: childAge <= 12
        ? pick(["平日主要参与接送和作业陪伴", "工作日参与有限，周末投入较多", "主要由伴侣或长辈照料，自己在关键事务上参与"], rng)
        : childAge <= 18
          ? pick(["会过问学习和升学，但沟通并不总顺畅", "日常交流不多，遇到重要选择会深度参与", "保持频繁交流，也会因边界问题发生争执"], rng)
          : pick(["每周联系，重要决定会交换意见", "联系不算频繁，但遇到事情会立刻介入", "关系亲近，仍会讨论工作和生活选择"], rng)
    });
  }

  const elderRelationCandidates = partnershipStatus.includes("单身")
    ? ["父亲", "母亲"]
    : gender === "male" ? ["父亲", "母亲", "岳父", "岳母"] : ["父亲", "母亲", "公公", "婆婆"];
  const elderRelation = pick(elderRelationCandidates, rng);
  const elderAge = age + 24 + Math.floor(rng() * 10);
  const elderLiving = rng() < (elderAge < 72 ? 0.92 : elderAge < 82 ? 0.76 : 0.55);
  const elderProximity = elderLiving
    ? weightedPick([
        { value: "同住", weight: 10 },
        { value: "住在同一小区或车程半小时内", weight: 27 },
        { value: "同城但不同住", weight: 28 },
        { value: "异地居住", weight: 35 }
      ], rng)
    : "已去世";
  const elderHealth = !elderLiving
    ? "生前有过一段需要家人参与的照护经历"
    : elderAge < 68
      ? pick(["身体基本健康，生活独立", "有慢性病但能独立生活"], rng)
      : elderAge < 78
        ? pick(["有慢性病，需要定期复诊", "行动尚可，但家人开始关注安全和用药", "身体基本健康，仍能独立生活"], rng)
        : pick(["行动变慢，需要家人协助就医和安排生活", "有慢性病，需要定期复诊和用药管理", "生活基本独立，但家人担心突发状况"], rng);
  const elderInvolvement = !elderLiving
    ? "曾参与就医或照护安排，这段经历仍留有具体记忆"
    : elderProximity === "同住"
      ? "日常直接参与吃药、就医或生活安排"
      : elderProximity.includes("半小时") || elderProximity.includes("同城")
        ? pick(["每周见面，并承担部分就医和事务安排", "平时保持联系，需要时到场处理", "由兄弟姐妹分担，自己负责关键决定"], rng)
        : pick(["主要靠电话和视频联系，遇到就医会协调返乡", "照护多由其他家人承担，自己负责费用和重大决定", "联系频繁，但因异地无法参与多数日常事务"], rng);
  const minorChildren = children.filter((child) => child.age < 18).length;
  const householdSnapshot = [
    partnershipStatus,
    childCount === 0 ? "没有子女" : `${childCount}个子女，其中${minorChildren}个未成年`,
    elderLiving ? `主要牵挂的老人是${elderRelation}，${elderProximity}` : `${elderRelation}已去世`
  ].join("；");
  return {
    partnership_status: partnershipStatus,
    children,
    elder_generation: {
      relation: elderRelation,
      age: elderAge,
      living: elderLiving,
      proximity: elderProximity,
      health_and_independence: elderHealth,
      personal_involvement: elderInvolvement
    },
    household_snapshot: householdSnapshot,
    current_region: currentRegion
  };
}

function buildDemographicSeed(index, rng) {
  const referenceYear = 2026;
  const gender = rng() < 0.58 ? "male" : "female";
  const name = `${SURNAMES[index % SURNAMES.length]}${GIVEN_NAMES[gender][(index * 7 + Math.floor(index / SURNAMES.length)) % GIVEN_NAMES[gender].length]}`;
  const education = pick(EDUCATION_BANDS, rng);
  const minimumAge = Math.max(34, education.graduationAge + 10);
  const age = minimumAge + Math.floor(rng() * (57 - minimumAge));
  const hasOverseas = /海外/u.test(education.label) || rng() < 0.2;
  const homeRegion = pick(REGIONS, rng);
  const mobilityProbability = Math.min(0.62, 0.26 + Math.max(0, age - 34) * 0.009 + (hasOverseas ? 0.08 : 0));
  const currentRegion = rng() < mobilityProbability ? pickOther(REGIONS, homeRegion, rng) : homeRegion;
  const firstIndustry = pick(REGION_INDUSTRY_PRIORS[homeRegion], rng);
  const firstFunction = pick(INDUSTRY_FUNCTION_PRIORS[firstIndustry], rng);
  const careerYears = Math.max(7, age - education.graduationAge);
  const adjacentFunctions = (FUNCTION_ADJACENCY[firstFunction] || [])
    .filter((value) => INDUSTRY_FUNCTION_PRIORS[firstIndustry].includes(value));
  const transferableAdjacentIndustries = (INDUSTRY_ADJACENCY[firstIndustry] || [])
    .filter((industry) => INDUSTRY_FUNCTION_PRIORS[industry].includes(firstFunction));
  const canExpandFunction = adjacentFunctions.length > 0 && careerYears >= 12;
  const canMoveIndustry = transferableAdjacentIndustries.length > 0 && careerYears >= 14;
  const canEnterGeneralManagement = careerYears >= 18;
  const trajectoryType = weightedPick([
    { value: "stable_specialist", weight: 48 },
    { value: "function_expansion", weight: canExpandFunction ? 27 : 0 },
    { value: "adjacent_industry_move", weight: canMoveIndustry ? 15 : 0 },
    { value: "general_management", weight: canEnterGeneralManagement ? 10 : 0 }
  ].filter((item) => item.weight > 0), rng);

  let currentIndustry = firstIndustry;
  let currentFunction = firstFunction;
  let maxIndustryChanges = 0;
  let maxFunctionChanges = 0;
  if (trajectoryType === "function_expansion") {
    currentFunction = pick(adjacentFunctions, rng);
    maxFunctionChanges = 1;
  } else if (trajectoryType === "adjacent_industry_move") {
    currentIndustry = pick(transferableAdjacentIndustries, rng);
    currentFunction = firstFunction;
    maxIndustryChanges = 1;
    maxFunctionChanges = 0;
  } else if (trajectoryType === "general_management") {
    currentFunction = "综合经营管理";
    maxFunctionChanges = 1;
  }

  const stageMin = careerYears <= 11 ? 3 : careerYears <= 19 ? 4 : 5;
  const stageMax = careerYears <= 11 ? 4 : careerYears <= 19 ? 5 : 6;
  const maxEmployerChanges = careerYears <= 11 ? 1 : careerYears <= 19 ? 2 : 3;
  return {
    name,
    gender,
    age,
    reference_year: referenceYear,
    birth_year: referenceYear - age,
    education: education.label,
    estimated_career_start_age: education.graduationAge,
    estimated_career_start_year: referenceYear - age + education.graduationAge,
    estimated_career_years: careerYears,
    overseas: hasOverseas
      ? pick(["英国/欧洲短期项目", "美国一年制硕士", "新加坡/香港项目", "海外业务派驻", "短期交换/考察"], rng)
      : "无",
    home_region: homeRegion,
    current_region: currentRegion,
    first_industry_hint: firstIndustry,
    current_industry_hint: currentIndustry,
    first_function_hint: firstFunction,
    current_function_hint: currentFunction,
    current_role_hint: pick(ROLE_CONTEXTS_BY_FUNCTION[currentFunction], rng),
    management_scope_hint: pick([
      "管理 40-80 人团队",
      "管理 100-300 人团队",
      "负责 3-8 亿年营收业务",
      "负责多城市/多门店运营",
      "负责新业务孵化和老业务改造",
      "直接背销售、利润和现金流指标"
    ], rng),
    family_life_seed: buildFamilyLifeSeed(age, gender, currentRegion, rng),
    career_trajectory: {
      type: trajectoryType,
      core_industry: firstIndustry,
      core_function: firstFunction,
      allowed_industries: currentIndustry === firstIndustry ? [firstIndustry] : [firstIndustry, currentIndustry],
      allowed_functions: currentFunction === firstFunction ? [firstFunction] : [firstFunction, currentFunction],
      stage_count_min: stageMin,
      stage_count_max: stageMax,
      max_employer_changes: maxEmployerChanges,
      max_function_changes: maxFunctionChanges,
      max_industry_changes: maxIndustryChanges,
      allow_entrepreneurship_or_family_business: careerYears >= 16 && rng() < 0.22
    },
    qualification_gate: "职业责任、组织规模和经营经历必须足以合理申请中欧或同级高管项目"
  };
}

function stripFence(text) {
  const trimmed = String(text || "").trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/iu);
  return fenced ? fenced[1].trim() : trimmed;
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
  const jsonCandidate = start >= 0 && end > start ? text.slice(start, end) : text;
  return JSON.parse(jsonCandidate.replace(/,\s*([}\]])/gu, "$1"));
}

function normalizeText(value) {
  return String(value || "").replace(/\s+\n/gu, "\n").trim();
}

function taskContextHits(value) {
  const text = typeof value === "string" ? value : JSON.stringify(value || {});
  return TASK_CONTEXT_TERMS.filter((term) => text.includes(term));
}

function buildCareerMessages(card) {
  const demographic = card.demographic_seed;
  const genderLabel = demographic.gender === "male" ? "男" : "女";
  return [
    {
      role: "system",
      content: [
        "你是熟悉中国企业管理者职业路径的人物传记作者。",
        "这一步只写经历：先建立可信、细致、有时间连续性的教育和职业史，再概括当前身份。",
        "不要写人格分析、心理测评、行为 trait、课堂状态或任何特定任务中的选择。",
        "职业史必须有一条清楚的主线。行业连续性和职能能力积累优先，不要为了显得丰富而频繁换行业或换职能。",
        "职业阶段可以由同一组织内晋升、责任扩大、业务单元变化、关键项目、组织并购或一次合理跳槽划分；复杂性主要来自责任和经历变深，不来自履历乱跳。",
        "每次变化都要有原因、代价和能力积累；职位、团队规模、营收责任不能无缘无故跳跃。",
        "每次实质性职能变化必须写出过渡桥梁：此前可迁移的能力，以及培训、项目、导师、证书、副职、兼岗或逐级承担责任中的至少一种；禁止从非技术岗位突然变成技术高管等无铺垫跃迁。",
        "不要使用真实知名企业或真实人物姓名。"
      ].join("\n")
    },
    {
      role: "user",
      content: [
        "请先根据 demographic seed 写这个人的完整职业经历。这里的初始值是硬约束，不是弱提示。",
        "",
        "【人口与职业起点】",
        `姓名：${demographic.name}`,
        `性别：${genderLabel}`,
        `当前年龄：${demographic.age}`,
        `基准年份：${demographic.reference_year}`,
        `出生年份：${demographic.birth_year}`,
        `教育：${demographic.education}`,
        `海外经历：${demographic.overseas}`,
        `成长地域：${demographic.home_region}`,
        `当前地域：${demographic.current_region}`,
        `第一段职业所在行业：${demographic.first_industry_hint}`,
        `第一段职业职能：${demographic.first_function_hint}`,
        `当前主要行业：${demographic.current_industry_hint}`,
        `当前主要职能：${demographic.current_function_hint}`,
        `当前职位目标：${demographic.current_role_hint}`,
        `当前责任规模：${demographic.management_scope_hint}`,
        `职业年限约：${demographic.estimated_career_years} 年`,
        `职业起始年龄和年份：${demographic.estimated_career_start_age} 岁 / ${demographic.estimated_career_start_year} 年`,
        demographic.qualification_gate,
        "",
        "【家庭生活事实；也是硬约束，但不能反过来改变职业主线】",
        JSON.stringify(demographic.family_life_seed),
        "家庭部分只写普通生活史和本人真实参与过的事情。不要把有子女或照护老人直接解释成任何产品、市场或商业偏好。",
        "",
        "【职业主线，必须严格遵守】",
        `主线类型：${demographic.career_trajectory.type}。`,
        `核心行业：${demographic.career_trajectory.core_industry}；整条履历只允许出现：${demographic.career_trajectory.allowed_industries.join("、")}。`,
        `核心职能：${demographic.career_trajectory.core_function}；整条履历只允许出现：${demographic.career_trajectory.allowed_functions.join("、")}。`,
        `职业阶段 ${demographic.career_trajectory.stage_count_min}-${demographic.career_trajectory.stage_count_max} 段。`,
        `雇主/组织变化最多 ${demographic.career_trajectory.max_employer_changes} 次；其余阶段必须是同一组织内晋升、责任扩大或重大项目变化。`,
        `实质性职能变化最多 ${demographic.career_trajectory.max_function_changes} 次。`,
        `行业变化最多 ${demographic.career_trajectory.max_industry_changes} 次。`,
        `可否包含创业、家族企业或合伙经历：${demographic.career_trajectory.allow_entrepreneurship_or_family_business ? "可以，但只能作为主线上的一次自然变化" : "不要加入"}。`,
        "不能为了凑阶段而引入新的行业、职能、证书或戏剧性失败。职业史读完后，应当能用一句话概括此人的长期专业身份。",
        `第一段必须从 ${demographic.estimated_career_start_age} 岁 / ${demographic.estimated_career_start_year} 年开始；最后一段必须在 ${demographic.age} 岁 / ${demographic.reference_year} 年结束。`,
        `最后一段的 industry 必须是“${demographic.current_industry_hint}”，function 必须是“${demographic.current_function_hint}”，title 必须原样包含“${demographic.current_role_hint}”；current_position 与最后一段必须一致。`,
        "相邻阶段的 end_age/start_age 和 end_year/start_year 必须无缝衔接，不得重叠、倒退或留下空档。",
        "",
        "只输出 JSON 对象：",
        "{",
        `  \"name\": \"${demographic.name}\",`,
        "  \"demographic_realization\": {\"gender\":\"male|female\",\"age\":45,\"highest_education\":\"必须与 seed 的教育完全一致\",\"education_detail\":\"专业、学校类型、毕业节点\",\"regional_background\":\"成长地域、迁移路径及其影响\",\"overseas_detail\":\"无则写无\"},",
        "  \"career_history\": [",
        "    {\"stage\":1,\"start_age\":22,\"end_age\":26,\"start_year\":2000,\"end_year\":2004,\"region\":\"...\",\"industry\":\"使用规范行业名称\",\"organization\":\"虚构组织名称或清晰代称\",\"company_type\":\"公司性质、规模和发展阶段\",\"function\":\"使用规范职能名称\",\"title\":\"...\",\"transition_bridge\":\"第一段写教育/实习如何进入该岗；后续段写上一段哪些能力、项目、培训、导师、证书、副职或兼岗使本次转型可信\",\"responsibilities\":\"具体负责什么、接触谁、背什么指标\",\"major_events\":\"这一段发生过什么\",\"skills_and_contacts_gained\":\"积累的能力、行业知识和关系\",\"reason_for_move\":\"为什么离开或转岗，付出了什么代价；当前阶段写为何继续留任\"}",
        "  ],",
        "  \"current_position\": {\"role\":\"...\",\"industry\":\"...\",\"primary_function\":\"...\",\"company_context\":\"所有制、规模、发展阶段和业务结构\",\"management_scope\":\"团队、地域、收入、利润或项目责任\",\"customers_and_stakeholders\":\"日常主要面对谁、谁付钱、谁使用、谁影响决策\",\"operating_metrics\":\"他最熟悉和最常背的经营指标\"},",
        "  \"family_life\": {\"household_rhythm\":\"工作与家庭日常如何交错\",\"concrete_experiences\":\"只写与 seed 一致的子女相处、代际关系、就医照护或距离感等具体经历\",\"family_experience_narrative\":\"250-450字生活叙事，不做市场偏好分析\"},",
        "  \"career_narrative\": \"600-900字连贯人物经历，重点写行业和职能如何变化，不做人格分析\",",
        "  \"why_executive_program_qualified\": \"为什么此人的责任和经历够资格参加高管项目\"",
        "}"
      ].join("\n")
    }
  ];
}

function buildGeneralProfileMessages(card, career) {
  return [
    {
      role: "system",
      content: [
        "你是行为研究取向的人物 profiling 作者。",
        "请以已经确定的职业史为行业/职能事实基础，把给定的行为指令写成一个 general profile。",
        "行为和心理特点必须显性、具体、可观察；要说明他通常如何看信息、比较、停手、听异议、承受风险、面对模糊、编码成败、权衡远近、启动和恢复。",
        "职业经历决定他熟悉什么、关注什么、用什么行业语言；行为指令是独立给定的 latent predisposition。不要声称职业史证明或导致了某项行为指令，也不要为建立因果而补写职业史中不存在的事件。",
        "允许人物内部有矛盾，不能写成八条互不相干的心理测评释义。",
        "不要加入任何产品、市场选择、商业战略选项、游戏、课堂或当前决策情景。",
        "不要给人物贴原型、人格类型或 MBTI 标签，也不要展示任何数值。"
      ].join("\n")
    },
    {
      role: "user",
      content: [
        "【已冻结职业史；不得补写其中没有发生过的事件】",
        JSON.stringify(career),
        "",
        "【行为指令；必须全部体现在人物中，但不要照抄原句或写维度名】",
        ...Object.values(card.behavioral_directives).map((line, index) => `${index + 1}. ${line}`),
        "",
        "只输出 JSON 对象：",
        "{",
        "  \"general_profile\": {",
        "    \"professional_identity\": \"行业与职能经历形成的基本观察视角，80-140字\",",
        "    \"core_motives\": \"长期驱动力、想证明什么、最不愿失去什么，80-140字\",",
        "    \"self_concept_and_status\": \"如何理解自己的能力、身份和他人评价，60-120字\",",
        "    \"information_search_and_stopping\": \"搜索范围、比较方式、aspiration threshold 和停手规则，80-140字\",",
        "    \"cognitive_effort\": \"愿意投入多少思考、会分析到什么程度、何时使用经验捷径，60-120字\",",
        "    \"belief_updating\": \"如何寻找反证、听取异议、保护或更新原判断，60-120字\",",
        "    \"risk_posture\": \"如何理解结果波动、损失和机会，60-120字\",",
        "    \"ambiguity_response\": \"信息不足、规则不明时的情绪和行动模式，60-120字\",",
        "    \"goal_regulation\": \"更受进步获得还是责任避损驱动，以及压力下如何变化，60-120字\",",
        "    \"time_orientation\": \"短期与长期结果如何加权，60-120字\",",
        "    \"action_and_recovery\": \"决定后如何启动、坚持、受挫和恢复，60-120字\",",
        "    \"interpersonal_and_power_style\": \"在同级、下属、老板和外部伙伴面前通常如何互动，80-140字\",",
        "    \"communication_style\": \"语言节奏、常用论证方式、话多话少、被挑战时的变化，60-120字\",",
        "    \"stress_pattern\": \"压力升高时哪些特征会放大或反转，60-120字\",",
        "    \"internal_contradictions\": \"至少两组真实的人格张力，不要用优缺点套话，80-140字\",",
        "    \"blind_spots\": \"稳定盲区及其职业来源，60-120字\",",
        "    \"profile_narrative\": \"500-800字连贯 general profiling；行业和 function lens 要贯穿其中，不加具体任务情景\"",
        "  }",
        "}"
      ].join("\n")
    }
  ];
}

function normalizeCareer(card, parsed) {
  const demographic = parsed.demographic_realization || {};
  const current = parsed.current_position || {};
  const history = Array.isArray(parsed.career_history) ? parsed.career_history : [];
  const normalizedHistory = history.map((stage, index) => ({
    stage: index + 1,
    start_age: Number(stage.start_age),
    end_age: Number(stage.end_age),
    start_year: Number(stage.start_year),
    end_year: Number(stage.end_year),
    region: normalizeText(stage.region),
    industry: normalizeText(stage.industry),
    organization: normalizeText(stage.organization),
    company_type: normalizeText(stage.company_type),
    function: normalizeText(stage.function),
    title: normalizeText(stage.title),
    transition_bridge: normalizeText(stage.transition_bridge),
    responsibilities: normalizeText(stage.responsibilities),
    major_events: normalizeText(stage.major_events),
    skills_and_contacts_gained: normalizeText(stage.skills_and_contacts_gained),
    reason_for_move: normalizeText(stage.reason_for_move)
  }));
  const requiredStageFields = [
    "region", "industry", "organization", "company_type", "function", "title", "transition_bridge",
    "responsibilities", "major_events", "skills_and_contacts_gained", "reason_for_move"
  ];
  for (const stage of normalizedHistory) {
    const missing = requiredStageFields.filter((field) => !stage[field]);
    if (missing.length > 0) throw new Error(`career stage ${stage.stage} missing fields: ${missing.join(", ")}`);
  }
  if (normalizedHistory.length < card.demographic_seed.career_trajectory.stage_count_min) {
    throw new Error(`career_history has ${normalizedHistory.length} stages; expected at least ${card.demographic_seed.career_trajectory.stage_count_min}`);
  }
  if (normalizedHistory.length > card.demographic_seed.career_trajectory.stage_count_max) {
    throw new Error(`career_history has ${normalizedHistory.length} stages; expected at most ${card.demographic_seed.career_trajectory.stage_count_max}`);
  }
  const seed = card.demographic_seed;
  for (let index = 0; index < normalizedHistory.length; index += 1) {
    const stage = normalizedHistory[index];
    const expectedStartAge = index === 0 ? seed.estimated_career_start_age : normalizedHistory[index - 1].end_age;
    if (stage.start_age !== expectedStartAge) {
      throw new Error(`career stage ${index + 1} starts at age ${stage.start_age}; expected ${expectedStartAge}`);
    }
    if (!Number.isInteger(stage.end_age) || stage.end_age <= stage.start_age) {
      throw new Error(`career stage ${index + 1} has invalid end_age ${stage.end_age}`);
    }
    if (stage.start_year !== seed.birth_year + stage.start_age || stage.end_year !== seed.birth_year + stage.end_age) {
      throw new Error(`career stage ${index + 1} year/age mismatch`);
    }
  }
  const firstStage = normalizedHistory[0];
  const lastStage = normalizedHistory[normalizedHistory.length - 1];
  if (lastStage.end_age !== seed.age || lastStage.end_year !== seed.reference_year) {
    throw new Error(`career history ends at age/year ${lastStage.end_age}/${lastStage.end_year}; expected ${seed.age}/${seed.reference_year}`);
  }
  if (firstStage.industry !== seed.first_industry_hint || firstStage.function !== seed.first_function_hint) {
    throw new Error(`first career stage does not match seeded industry/function: ${firstStage.industry}/${firstStage.function}`);
  }
  if (lastStage.industry !== seed.current_industry_hint || lastStage.function !== seed.current_function_hint) {
    throw new Error(`last career stage does not match current seeded industry/function: ${lastStage.industry}/${lastStage.function}`);
  }
  const transitionCount = (key) => normalizedHistory.slice(1)
    .filter((stage, index) => stage[key] !== normalizedHistory[index][key]).length;
  if (transitionCount("organization") > seed.career_trajectory.max_employer_changes) {
    throw new Error("career history has too many employer/organization changes");
  }
  if (transitionCount("function") > seed.career_trajectory.max_function_changes) {
    throw new Error("career history has too many function changes");
  }
  if (transitionCount("industry") > seed.career_trajectory.max_industry_changes) {
    throw new Error("career history has too many industry changes");
  }
  if (normalizedHistory.some((stage) => !seed.career_trajectory.allowed_industries.includes(stage.industry))) {
    throw new Error("career history contains an industry outside the frozen trajectory");
  }
  if (normalizedHistory.some((stage) => !seed.career_trajectory.allowed_functions.includes(stage.function))) {
    throw new Error("career history contains a function outside the frozen trajectory");
  }
  if (!lastStage.title.includes(seed.current_role_hint)) {
    throw new Error(`last title ${lastStage.title} does not realize seeded role ${seed.current_role_hint}`);
  }
  const generatedFamily = parsed.family_life || {};
  const familyExperienceNarrative = normalizeText(generatedFamily.family_experience_narrative);
  if (!familyExperienceNarrative) throw new Error("family_life.family_experience_narrative is required");
  return {
    name: seed.name,
    demographic_realization: {
      gender: seed.gender,
      age: seed.age,
      highest_education: seed.education,
      education_detail: normalizeText(demographic.education_detail),
      regional_background: normalizeText(demographic.regional_background),
      overseas_detail: normalizeText(demographic.overseas_detail)
    },
    career_history: normalizedHistory,
    current_position: {
      role: seed.current_role_hint,
      industry: seed.current_industry_hint,
      primary_function: seed.current_function_hint,
      company_context: normalizeText(current.company_context),
      management_scope: normalizeText(current.management_scope),
      customers_and_stakeholders: normalizeText(current.customers_and_stakeholders),
      operating_metrics: normalizeText(current.operating_metrics)
    },
    family_life: {
      ...seed.family_life_seed,
      household_rhythm: normalizeText(generatedFamily.household_rhythm),
      concrete_experiences: normalizeText(generatedFamily.concrete_experiences),
      family_experience_narrative: familyExperienceNarrative
    },
    career_narrative: normalizeText(parsed.career_narrative),
    why_executive_program_qualified: normalizeText(parsed.why_executive_program_qualified)
  };
}

function normalizeProfile(parsed) {
  const profile = parsed.general_profile || {};
  const fields = [
    "professional_identity", "core_motives", "self_concept_and_status",
    "information_search_and_stopping", "cognitive_effort", "belief_updating", "risk_posture",
    "ambiguity_response", "goal_regulation", "time_orientation", "action_and_recovery",
    "interpersonal_and_power_style", "communication_style", "stress_pattern",
    "internal_contradictions", "blind_spots", "profile_narrative"
  ];
  const normalized = Object.fromEntries(fields.map((key) => [key, normalizeText(profile[key])]));
  const missing = fields.filter((key) => !normalized[key]);
  if (missing.length > 0) throw new Error(`general_profile missing fields: ${missing.join(", ")}`);
  return {
    general_profile: normalized
  };
}

async function main() {
  loadLocalEnv();
  const args = parseArgs(process.argv.slice(2));
  const { chatCompletion, hasAnyKey } = require("../../server/llm/deepseekClient");
  const modelRegistry = require("../../server/llm/modelRegistry");
  if (!hasAnyKey()) throw new Error("missing LLM API key");

  const rng = createSeededRandom(args.seed);
  const cards = Array.from({ length: args.count }, (_, index) => {
    const behavioralFingerprint = buildFingerprint(index, rng);
    return {
      persona_id: `CGP${String(index + 1).padStart(2, "0")}`,
      seed: `${args.seed}:${index + 1}`,
      behavioral_fingerprint: behavioralFingerprint,
      behavioral_directives: buildBehaviorDirectives(behavioralFingerprint),
      demographic_seed: buildDemographicSeed(index, rng)
    };
  });

  fs.mkdirSync(args.outputDir, { recursive: true });
  const callsPath = path.join(args.outputDir, "generation_calls.jsonl");
  if (fs.existsSync(callsPath)) fs.unlinkSync(callsPath);

  const records = [];
  const errors = [];
  const { default: pLimit } = await import("p-limit");
  const limit = pLimit(args.concurrency);
  const startedAt = new Date().toISOString();
  const startedMs = Date.now();

  async function callStage(card, stage, attempt, messages, maxTokens) {
    const startedCallMs = Date.now();
    let raw = "";
    try {
      raw = await chatCompletion(messages, {
        role: "chat_service",
        temperature: stage === "career_history" ? 0.92 : 0.72,
        max_tokens: maxTokens,
        timeoutMs: 90000,
        response_format: { type: "json_object" }
      });
      const parsed = parseJsonObject(raw);
      appendJsonl(callsPath, {
        ts: new Date().toISOString(),
        persona_id: card.persona_id,
        stage,
        attempt,
        status: "ok",
        latency_ms: Date.now() - startedCallMs,
        raw
      });
      return parsed;
    } catch (error) {
      appendJsonl(callsPath, {
        ts: new Date().toISOString(),
        persona_id: card.persona_id,
        stage,
        attempt,
        status: "error",
        latency_ms: Date.now() - startedCallMs,
        error: String(error?.stack || error?.message || error),
        raw
      });
      throw error;
    }
  }

  await Promise.all(cards.map((card) => limit(async () => {
    try {
      let career;
      let careerValidationError = "";
      for (let attempt = 1; attempt <= 3 && !career; attempt += 1) {
        const messages = buildCareerMessages(card);
        if (careerValidationError) {
          messages[1].content += `\n\n上一次输出未通过确定性校验：${careerValidationError}\n请重新完整生成，特别核对年龄、年份、行业、职能、转岗次数，以及最后一段与当前岗位完全一致。`;
        }
        const careerRaw = await callStage(card, "career_history", attempt, messages, 4200);
        try {
          career = normalizeCareer(card, careerRaw);
        } catch (error) {
          careerValidationError = String(error?.message || error);
          appendJsonl(callsPath, {
            ts: new Date().toISOString(),
            persona_id: card.persona_id,
            stage: "career_history_validation",
            attempt,
            status: "invalid",
            error: careerValidationError
          });
          if (attempt === 3) throw error;
        }
      }

      let profile;
      let profileValidationError = "";
      for (let attempt = 1; attempt <= 3 && !profile; attempt += 1) {
        const messages = buildGeneralProfileMessages(card, career);
        if (profileValidationError) {
          messages[1].content += `\n\n上一次输出未通过确定性校验：${profileValidationError}\n请重新完整生成，不得补写职业史中不存在的事件。`;
        }
        const profileRaw = await callStage(card, "general_profile", attempt, messages, 4200);
        try {
          profile = normalizeProfile(profileRaw);
        } catch (error) {
          profileValidationError = String(error?.message || error);
          appendJsonl(callsPath, {
            ts: new Date().toISOString(),
            persona_id: card.persona_id,
            stage: "general_profile_validation",
            attempt,
            status: "invalid",
            error: profileValidationError
          });
          if (attempt === 3) throw error;
        }
      }
      const record = {
        schema: "career_general_profile_v2",
        persona_id: card.persona_id,
        seed: card.seed,
        demographic_seed: card.demographic_seed,
        behavioral_fingerprint: card.behavioral_fingerprint,
        behavioral_directives: card.behavioral_directives,
        ...career,
        ...profile,
        task_context_term_hits: taskContextHits({ career, profile }),
        synthetic: true
      };
      records.push(record);
    } catch (error) {
      errors.push({
        persona_id: card.persona_id,
        error: String(error?.stack || error?.message || error)
      });
    }
  })));

  records.sort((a, b) => a.persona_id.localeCompare(b.persona_id));
  const poolPath = path.join(args.outputDir, "persona_pool_career_general_profile_v2.json");
  writeJson(poolPath, records);
  const manifest = {
    schema: "career_general_profile_pool_manifest_v2",
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
    generation_order: ["demographic_and_family_seed_to_career_and_life_history", "career_history_plus_behavioral_directives_to_general_profile"],
    task_context_policy: "general profiling only; no simulation, product, classroom, market-choice, architecture-choice, or strategy-choice context",
    task_context_term_hits: records
      .filter((record) => record.task_context_term_hits.length > 0)
      .map((record) => ({ persona_id: record.persona_id, terms: record.task_context_term_hits })),
    script_path: "scripts/analysis/generate_career_general_profile_pool.js",
    script_sha256: crypto.createHash("sha256").update(fs.readFileSync(__filename)).digest("hex"),
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

module.exports = {
  buildBehaviorDirectives,
  buildCareerMessages,
  buildDemographicSeed,
  buildFamilyLifeSeed,
  buildFingerprint,
  buildGeneralProfileMessages,
  normalizeCareer,
  normalizeProfile
};
