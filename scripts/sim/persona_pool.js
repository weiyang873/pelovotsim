"use strict";

const { chatCompletion } = require("../../server/llm/deepseekClient");

const PERSONAS = {
  A: {
    id: "A",
    label: "草根老板",
    desc: "制造业/贸易起家的民营企业家",
    age: "45-55",
    education: "大专或本科",
    role: "创始人/董事长",
    background: "从工厂车间或档口白手起家，吃到了中国制造和外贸的时代红利，企业年营收几千万到几个亿",
    industry: "制造业、外贸、建材、农产品加工",
    decisionStyle: "快速拍板、凭直觉和经验、不喜欢过度分析",
    riskPreference: "高，看准了就干，错了再调",
    expressionStyle: "直接、接地气、用大白话说复杂的事、喜欢打比方",
    blindSpots: "VP 写得接地气但缺结构，容易从自身经验出发而非用户视角",
    interviewStyle: "像跟客户聊天，问题很直接，不太追问感受类问题",
    pricingBias: "敢定高价，好东西就该卖贵",
    vpQuirks: "可能写出朴素但模糊的价值主张，HOW 倾向从渠道而非产品功能切入",
    genderDistribution: { male: 0.85, female: 0.15 },
    mbtiDistribution: { ESTP: 0.4, ENTJ: 0.35, ESTJ: 0.25 },
    genderModifiers: {
      female: {
        expressionTweak: "比男性同行更注重关系维护，表达直接但不粗犷，会用我们、咱们拉近距离",
        interviewTweak: "访谈时更有亲和力，但同样结果导向"
      }
    }
  },
  B: {
    id: "B",
    label: "职业经理人",
    desc: "外企或大型民企的职业高管",
    age: "35-45",
    education: "本科或MBA",
    role: "VP/总监/事业部总经理",
    background: "在大型企业一路升上来，管过几百人团队，擅长体系化思考",
    industry: "消费品、金融、地产、汽车",
    decisionStyle: "数据驱动、喜欢框架和模型、决策前要看数据支撑",
    riskPreference: "中等，风险可控的情况下可以激进",
    expressionStyle: "结构化、有逻辑层次、喜欢第一第二第三、PPT 思维",
    blindSpots: "VP 框架漂亮但可能脱离一线用户真实场景，过度依赖二手数据",
    interviewStyle: "像做用户调研，提前想好问题清单，追问有条理但不够灵活",
    pricingBias: "算得很细，倾向找最优价格点",
    vpQuirks: "WHO 写得精准但 PAIN 过于理性化，缺少情感洞察",
    genderDistribution: { male: 0.6, female: 0.4 },
    mbtiDistribution: { ISTJ: 0.3, ESTJ: 0.3, ENTJ: 0.25, INTJ: 0.15 },
    genderModifiers: {
      female: {
        expressionTweak: "同样结构化但更注重团队共识，会主动询问大家怎么看",
        interviewTweak: "访谈时更善于捕捉情感线索，会追问那时候你的感受是什么"
      }
    }
  },
  C: {
    id: "C",
    label: "技术创业者",
    desc: "理工科博士或技术背景创业者",
    age: "35-45",
    education: "硕士或博士",
    role: "创始人/CTO/技术合伙人",
    background: "从实验室或大厂技术岗出来创业，做硬件、AI、医疗器械或机器人，技术很强但商业化还在摸索",
    industry: "科技、AI、医疗设备、机器人、新能源",
    decisionStyle: "追求技术最优解、第一性原理思考、有时过度工程化",
    riskPreference: "对技术风险不怕，对市场风险敏感",
    expressionStyle: "偶尔夹杂英文术语、喜欢类比技术概念、精确但有时太技术化",
    blindSpots: "关注产品胜过商业模式，容易忽略成本和用户优先级",
    interviewStyle: "深挖技术相关需求，可能忽略情感维度",
    pricingBias: "倾向低估定价重要性，产品好自然有人买",
    vpQuirks: "HOW 极其详细，但 WHO 和 PAIN 可能太窄",
    genderDistribution: { male: 0.8, female: 0.2 },
    mbtiDistribution: { INTJ: 0.4, INTP: 0.35, ENTJ: 0.25 },
    genderModifiers: {
      female: {
        expressionTweak: "同样技术导向但表达更平衡，会主动补充用户视角，不那么技术至上",
        interviewTweak: "访谈时能兼顾技术问题和使用体验"
      }
    }
  },
  D: {
    id: "D",
    label: "二代接班人",
    desc: "家族企业第二代",
    age: "30-38",
    education: "本科或海外硕士",
    role: "副总/事业部负责人/董事",
    background: "家族企业准接班人，想推动转型但受制于老一代",
    industry: "家族制造、地产、农业、连锁零售",
    decisionStyle: "有国际视野但对一线运营理解浅，想法大但落地能力弱",
    riskPreference: "想激进但会被家族保守文化拉住",
    expressionStyle: "流利但偶尔空洞、喜欢引用国外案例、中英文混杂",
    blindSpots: "容易写成愿景式表述，缺少对中国本土用户的深入理解",
    interviewStyle: "问开放性大问题，不太追问细节",
    pricingBias: "对价格没直觉，倾向参考海外定价",
    vpQuirks: "可能写出打造中国版某产品这种对标式表述",
    genderDistribution: { male: 0.55, female: 0.45 },
    mbtiDistribution: { ENFP: 0.35, ENTP: 0.3, ESFP: 0.2, INFP: 0.15 },
    genderModifiers: {
      female: {
        expressionTweak: "可能更有人文关怀，对企业社会责任类话题更敏感",
        interviewTweak: "访谈时更善于建立共情，但同样缺少追问深度"
      }
    }
  },
  E: {
    id: "E",
    label: "体制转型者",
    desc: "国企/政府背景出来的管理者",
    age: "40-55",
    education: "本科（国内985）",
    role: "从国企中层出来创业，或在民企做高管",
    background: "在央企、国企或政府机关干了十几年，出来后做基建、环保、医疗、教育相关业务，人脉是核心资产",
    industry: "基建、能源、环保、医疗、教育",
    decisionStyle: "谨慎、讲流程和合规、重视政策风向、决策慢但执行力强",
    riskPreference: "低，先看看政策怎么说",
    expressionStyle: "公文腔，统筹、落实、抓手、形成合力，严谨但缺少用户语言",
    blindSpots: "VP 容易写成政策文件风格，宏观正确但不够具体",
    interviewStyle: "像调研座谈会，提问宏观，不习惯追问个人感受",
    pricingBias: "保守定价，怕太贵老百姓接受不了",
    vpQuirks: "容易写出统筹资源、构建模式这种抽象表述",
    genderDistribution: { male: 0.8, female: 0.2 },
    mbtiDistribution: { ISTJ: 0.45, ISFJ: 0.3, ESTJ: 0.25 },
    genderModifiers: {
      female: {
        expressionTweak: "同样有体制语言习惯但更温和，会用建议、考虑而不是必须、要求",
        interviewTweak: "访谈时稍有更多共情，但整体仍偏宏观视角"
      }
    }
  },
  F: {
    id: "F",
    label: "销售铁军",
    desc: "从一线销售干到高管的实战派",
    age: "35-50",
    education: "大专到本科",
    role: "销售VP/区域总/自己开经销公司",
    background: "从保险、医药、快消、教培的一线销售做起，带过大团队，极度客户导向",
    industry: "保险、医药、快消、教培、汽车经销",
    decisionStyle: "客户导向、关注转化率和复购、用销售漏斗思维看一切",
    riskPreference: "中高，敢投就有回报，关键是投对渠道",
    expressionStyle: "有感染力、善于讲故事和用案例、语言有画面感但逻辑有时跳跃",
    blindSpots: "产品设计思维弱，容易把问题都归结为渠道和话术",
    interviewStyle: "像客户拜访，问得尖锐，善于捕捉购买信号",
    pricingBias: "很敢定高价，但对渠道能不能接受很敏感",
    vpQuirks: "WHO 写得非常具体，HOW 容易写成销售话术而非产品机制",
    genderDistribution: { male: 0.7, female: 0.3 },
    mbtiDistribution: { ESTP: 0.4, ESFP: 0.3, ENFJ: 0.3 },
    genderModifiers: {
      female: {
        expressionTweak: "同样有销售感染力但更细腻，会用情感故事打动人，善于描绘用户使用场景",
        interviewTweak: "访谈时更善于让对方放下防备，能挖到更深层需求"
      }
    }
  },
  G: {
    id: "G",
    label: "互联网PM转型",
    desc: "大厂产品经理出身，转型创业或进传统行业",
    age: "30-40",
    education: "本科或硕士",
    role: "产品VP/创业者/传统企业数字化负责人",
    background: "在大厂做了 5-8 年产品经理，带过千万 DAU 产品，出来创业或被传统企业挖去做数字化",
    industry: "互联网、SaaS、新零售、智能硬件",
    decisionStyle: "方法论驱动、A/B 测试思维、喜欢用数据验证假设",
    riskPreference: "中等，小步快跑、快速迭代",
    expressionStyle: "会用赋能、用户心智、北极星指标、PMF、MVP 这类术语，流畅但可能过度抽象",
    blindSpots: "容易脱离非互联网用户的真实语境，把所有用户都想成年轻互联网用户",
    interviewStyle: "会套用户旅程、JTBD、5 Whys 等方法论，但对方不一定听得懂",
    pricingBias: "习惯互联网免费或低价获客思维，可能低估硬件定价空间",
    vpQuirks: "擅长写框架感强的表达，但具体人群和场景容易虚",
    genderDistribution: { male: 0.55, female: 0.45 },
    mbtiDistribution: { ENTP: 0.35, ENTJ: 0.3, INTP: 0.2, INFJ: 0.15 },
    genderModifiers: {
      female: {
        expressionTweak: "同样使用互联网术语但更注重用户情感维度，会主动补充用户感受类洞察",
        interviewTweak: "访谈时方法论之外更善于读懂言外之意"
      }
    }
  }
};

const MBTI_BEHAVIOR_MODIFIERS = {
  E: "你在小组讨论中倾向主动发言、提出观点，不怕表达不同意见。",
  I: "你在小组讨论中倾向先听别人说，等想清楚再发言，但观点往往更深入。",
  S: "你关注具体的事实和细节，喜欢用实际案例说话，不太信空洞的理论。",
  N: "你喜欢看大局和趋势，善于联想和类比，有时会忽略执行细节。",
  T: "你做决策偏逻辑分析，写 VP 时注重因果关系和数据支撑，访谈时关注功能和效率。",
  F: "你做决策时会考虑人的感受，写 VP 时自然关注用户情感痛点，访谈时善于共情。",
  J: "你喜欢尽快达成结论、做好计划，讨论时倾向推动收敛，不喜欢开放式发散太久。",
  P: "你喜欢保持开放、多探索可能性，讨论时可能提出意外角度，但有时拖延决策。"
};

const BACKUP_NAME_POOLS = {
  A: {
    male: ["王建国", "李德胜", "张福根", "陈有财", "刘大力", "赵铁柱", "马长贵", "孙富强"],
    female: ["王桂兰", "李秀英", "张玉华", "陈翠花"]
  },
  B: {
    male: ["周明远", "吴晨曦", "黄嘉伟", "杨博文", "林思远", "陈志鹏"],
    female: ["陈雅琳", "刘若萱", "张晓薇", "王静怡", "李思涵", "赵芷若"]
  },
  C: {
    male: ["张博宇", "刘一鸣", "陈思源", "王朝阳", "赵鹏飞", "李维克"],
    female: ["林晓研", "何思琪", "吴静怡", "陈芯蕊"]
  },
  D: {
    male: ["何天宇", "沈子杰", "林浩然", "郑凯文", "周锐"],
    female: ["黄思齐", "沈若曦", "何悦然", "林子涵", "郑雨桐"]
  },
  E: {
    male: ["马长河", "孙国栋", "郝建明", "钱卫东", "周志远", "李同方"],
    female: ["王慧芳", "刘淑贤"]
  },
  F: {
    male: ["杨彪", "孙虎", "刘磊", "张鑫", "陈龙", "王超"],
    female: ["李娜", "赵薇薇", "张丽丽"]
  },
  G: {
    male: ["苏阳", "韩晨", "方舟", "许楠", "高翔", "秦鹏"],
    female: ["高悦", "秦岚", "陆瑶", "白若溪", "宋清然"]
  }
};

const EDUCATION_DISTRIBUTION = {
  A: {
    "中专/高中": 0.25,
    "大专": 0.40,
    "本科（非985）": 0.35
  },
  B: {
    "本科（985）": 0.30,
    "MBA（国内）": 0.40,
    "MBA（海外）": 0.30
  },
  C: {
    "本科（985）": 0.10,
    "硕士（国内）": 0.25,
    "硕士（海归）": 0.30,
    "博士（海归）": 0.35
  },
  D: {
    "本科（国内）": 0.10,
    "本科（海外）": 0.50,
    "硕士（海外）": 0.40
  },
  E: {
    "大专": 0.20,
    "本科（985）": 0.50,
    "本科（非985）": 0.30
  },
  F: {
    "高中": 0.15,
    "大专": 0.40,
    "本科（非985）": 0.45
  },
  G: {
    "本科（985）": 0.35,
    "硕士（国内）": 0.35,
    "硕士（海归）": 0.30
  }
};

const TEAM_ANCHOR_GRIDS = [
  { grid_id: "ToC_Differentiation_Adult", architecture: "Experience" },
  { grid_id: "ToB_Differentiation_Elder", architecture: "Experience" },
  { grid_id: "ToC_Cost_Child", architecture: "Hybrid" },
  { grid_id: "ToB_Cost_Elder", architecture: "Function" },
  { grid_id: "ToC_Differentiation_Child", architecture: "Experience" },
  { grid_id: "ToB_Differentiation_Adult", architecture: "Hybrid" },
  { grid_id: "ToC_Cost_Adult", architecture: "Function" },
  { grid_id: "ToC_Differentiation_Elder", architecture: "Experience" },
  { grid_id: "ToB_Cost_Child", architecture: "Hybrid" },
  { grid_id: "ToB_Cost_Adult", architecture: "Function" }
];

const PERSONA_GRID_CHOICES = {
  A: { grid_id: "ToB_Differentiation_Adult", architecture: "Function" },
  B: { grid_id: "ToC_Differentiation_Adult", architecture: "Experience" },
  C: { grid_id: "ToC_Differentiation_Adult", architecture: "Experience" },
  D: { grid_id: "ToC_Differentiation_Adult", architecture: "Experience" },
  E: { grid_id: "ToB_Differentiation_Elder", architecture: "Experience" },
  F: { grid_id: "ToC_Cost_Child", architecture: "Hybrid" },
  G: { grid_id: "ToC_Differentiation_Adult", architecture: "Experience" }
};

function createSeededRandom(seedText) {
  let h = 2166136261;
  const text = String(seedText || "");
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
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

function pickRandom(list) {
  const items = Array.isArray(list) ? list : [];
  if (items.length === 0) return null;
  return items[Math.floor(Math.random() * items.length)];
}

function weightedSample(distribution, random) {
  const entries = Object.entries(distribution || {});
  if (entries.length === 0) return "";
  const total = entries.reduce((sum, [, prob]) => sum + Number(prob || 0), 0);
  let r = (typeof random === "function" ? random() : Math.random()) * total;
  for (const [value, prob] of entries) {
    r -= Number(prob || 0);
    if (r <= 0) return value;
  }
  return entries[entries.length - 1][0];
}

function adjustEducationByAge(personaId, education, age) {
  if (["A", "F"].includes(personaId) && age >= 50) {
    if (education.includes("本科") && Math.random() < 0.3) {
      return "大专";
    }
  }

  if (age < 35 && ["中专/高中", "高中", "大专"].includes(education)) {
    if (Math.random() < 0.5) return "本科（非985）";
  }

  return education;
}

function adjustEducationByGender(personaId, education, gender, age) {
  if (gender === "female" && age >= 45 && ["A", "E"].includes(personaId)) {
    if (education.includes("本科") && Math.random() < 0.25) {
      return personaId === "A" ? "大专" : "本科（非985）";
    }
  }
  return education;
}

function deriveOverseasExperience(personaId, education) {
  if (education.includes("海归") || education.includes("海外")) {
    const destinations = {
      C: ["美国（MIT/Stanford/CMU）", "美国（UC系）", "日本（东大/东工大）"],
      D: ["英国（LSE/UCL）", "英国（曼大/利兹）", "澳洲（墨大/悉大）"],
      B: ["美国（Wharton/Kellogg）", "欧洲（INSEAD/LBS）", "香港（HKU/HKUST）"],
      G: ["美国（CS硕士）", "新加坡（NUS）", "香港（科大）"]
    };
    const pool = destinations[personaId] || ["海外"];
    return {
      hasOverseas: true,
      destination: pickRandom(pool),
      duration: education.includes("博士") ? "4-6年" : "1-3年"
    };
  }

  if (["中专/高中", "高中", "大专"].includes(education)) {
    return { hasOverseas: false, destination: null, duration: null };
  }

  if (Math.random() < 0.15) {
    return {
      hasOverseas: true,
      destination: "短期交换/考察",
      duration: "3-6个月"
    };
  }

  return { hasOverseas: false, destination: null, duration: null };
}

function deriveExpressionModifier(education) {
  const modifiers = {
    "中专/高中": "你的文字表达偏口语化，不太会用商业术语，写东西像说话一样直白，可能有语病或不通顺的地方。",
    "高中": "你的文字表达偏口语化，不太会用商业术语，写东西像说话一样直白。",
    "大专": "你的文字表达基本通顺但缺少结构感，不太会分层次写东西，倾向一段话说完所有想法。",
    "本科（非985）": "你的文字表达通顺，能写出基本的商业文案，但缺少框架感和专业术语。",
    "本科（985）": "你的文字表达清晰有逻辑，会用基本的商业框架，但不会过度包装。",
    "本科（国内）": "你的文字表达通顺，有基本逻辑，但不太会用商业术语。",
    "本科（海外）": "你的文字表达流利，偶尔中英文混杂，喜欢引用国外的案例和概念。",
    "硕士（国内）": "你的文字表达结构化，会用专业术语，逻辑层次清晰。",
    "硕士（海外）": "你的文字表达很结构化，偶尔中英文混杂，喜欢用海外案例和成熟框架来组织观点。",
    "硕士（海归）": "你的文字表达很结构化，习惯中英文混杂，会用框架和模型来组织思路，引用海外案例。",
    "博士（海归）": "你的文字表达非常精确和结构化，倾向用学术语言和第一性原理思考，可能过度严谨而缺少商业直觉。",
    "MBA（国内）": "你非常擅长写商业文案，WHO/PAIN/HOW 这种框架对你来说很自然，表达结构化且有说服力。",
    "MBA（海外）": "你是最会写商业文案的类型，框架感极强，中英文切换自如，但可能过度包装，内容空洞但格式完美。"
  };
  return modifiers[education] || "";
}

function parseJsonArray(text) {
  const raw = String(text || "").replace(/```json|```/g, "").trim();
  const start = raw.indexOf("[");
  const end = raw.lastIndexOf("]");
  const candidate = start >= 0 && end > start ? raw.slice(start, end + 1) : raw;
  return JSON.parse(candidate);
}

function buildFallbackNames(members) {
  const used = new Set();
  return members.map((member, index) => {
    const pools = BACKUP_NAME_POOLS[member.personaId] || {};
    const list = [...(pools[member.gender] || []), ...(pools.male || [])];
    let picked = null;
    for (const candidate of list) {
      if (!used.has(candidate)) {
        picked = candidate;
        break;
      }
    }
    if (!picked) {
      picked = `${member.gender === "male" ? "陈" : "林"}${member.personaId}${index + 1}`;
    }
    used.add(picked);
    return picked;
  });
}

async function generateNames(members) {
  const fallback = buildFallbackNames(members);
  if (!process.env.DEEPSEEK_API_KEY) {
    return fallback;
  }

  const prompt = [
    `请为以下 ${members.length} 个人物各取一个中文姓名（姓+名，2-3个字）。`,
    "",
    ...members.flatMap((member, index) => ([
      `人物 ${index + 1}：`,
      `- 背景：${member.label}，${member.background}`,
      `- 性别：${member.gender === "male" ? "男" : "女"}`,
      `- 年龄：${member.age}岁`,
      `- 学历：${member.education}`,
      ""
    ])),
    "取名规则：",
    "- 符合这个年龄段、学历背景和中国社会阶层的起名习惯",
    "- 50岁以上低学历男性：偏朴实（建国、德胜、福根、大力）",
    "- 50岁以上低学历女性：偏传统（桂兰、秀英、翠花）",
    "- 30-40岁海归/高学历：偏现代（天宇、若曦、博文、思涵）",
    "- 体制背景：偏正式（建明、志远、国栋）",
    "- 销售背景：偏响亮（彪、虎、龙、超）",
    `- ${members.length} 个名字不能重复`,
    "- 不要用明星或名人的名字",
    `- 只输出 JSON 数组：["姓名1", "姓名2", ...]`
  ].join("\n");

  try {
    const completion = await chatCompletion([
      { role: "system", content: "你擅长为中国商业人物命名，只输出 JSON 数组。" },
      { role: "user", content: prompt }
    ], {
      temperature: 0.7,
      max_tokens: 600
    });
    const parsed = parseJsonArray(completion);
    if (!Array.isArray(parsed) || parsed.length !== members.length) {
      return fallback;
    }
    const deduped = new Set();
    return parsed.map((name, index) => {
      const clean = String(name || "").trim();
      if (!clean || deduped.has(clean)) {
        return fallback[index];
      }
      deduped.add(clean);
      return clean;
    });
  } catch (_) {
    return fallback;
  }
}

function getMBTIDescription(mbtiType) {
  const type = String(mbtiType || "").toUpperCase();
  return [type[0], type[1], type[2], type[3]]
    .map((key) => MBTI_BEHAVIOR_MODIFIERS[key] || "")
    .filter(Boolean)
    .join("\n");
}

function buildFullExpressionStyle(persona, gender, mbti) {
  let style = String(persona.expressionStyle || "");
  if (gender === "female" && persona.genderModifiers?.female?.expressionTweak) {
    style += `。${persona.genderModifiers.female.expressionTweak}`;
  }
  style += `\n\n你的思维特征（MBTI: ${mbti}）：\n${getMBTIDescription(mbti)}`;
  return style;
}

function sampleAge(persona) {
  const ageMatch = String(persona.age || "").match(/(\d+)\D+(\d+)/);
  const ageMin = ageMatch ? Number(ageMatch[1]) : 35;
  const ageMax = ageMatch ? Number(ageMatch[2]) : ageMin;
  return ageMin + Math.floor(Math.random() * (ageMax - ageMin + 1));
}

function sampleGender(persona) {
  const maleWeight = Number(persona.genderDistribution?.male || 0.5);
  return Math.random() < maleWeight ? "male" : "female";
}

function sampleStudent(personaId, age, gender) {
  const persona = PERSONAS[personaId];
  if (!persona) {
    throw new Error(`Unknown persona id: ${personaId}`);
  }
  let education = weightedSample(EDUCATION_DISTRIBUTION[personaId]);
  education = adjustEducationByAge(personaId, education, age);
  education = adjustEducationByGender(personaId, education, gender, age);
  const overseas = deriveOverseasExperience(personaId, education, age);
  const expressionModifier = deriveExpressionModifier(education);
  const mbti = weightedSample(persona.mbtiDistribution);
  const interviewTweak = gender === "female" ? persona.genderModifiers?.female?.interviewTweak || "" : "";

  return {
    ...persona,
    personaId,
    gender,
    mbti,
    age,
    education,
    overseas,
    expressionModifier,
    fullExpressionStyle: buildFullExpressionStyle(persona, gender, mbti),
    interviewStyleFull: interviewTweak ? `${persona.interviewStyle}。${interviewTweak}` : persona.interviewStyle
  };
}

function randomizeTeams(numTeams = 10, teamSize = 6) {
  const teams = Array.from({ length: numTeams }, () => []);
  const personaIds = Object.keys(PERSONAS);
  const globalCounts = Object.fromEntries(personaIds.map((id) => [id, 0]));
  const minCount = 3;

  const pickTeamForPersona = (personaId) => {
    const eligible = teams
      .map((team, teamIndex) => ({
        teamIndex,
        team,
        samePersonaCount: team.filter((id) => id === personaId).length
      }))
      .filter((item) => item.team.length < teamSize && item.samePersonaCount < 2)
      .sort((a, b) => a.team.length - b.team.length);
    if (eligible.length === 0) {
      throw new Error(`Failed to place persona ${personaId} into a team`);
    }
    const shortestSize = eligible[0].team.length;
    const shortest = eligible.filter((item) => item.team.length === shortestSize);
    return pickRandom(shortest)?.teamIndex ?? eligible[0].teamIndex;
  };

  for (const personaId of personaIds) {
    for (let i = 0; i < minCount; i += 1) {
      const teamIndex = pickTeamForPersona(personaId);
      teams[teamIndex].push(personaId);
      globalCounts[personaId] += 1;
    }
  }

  for (let teamIndex = 0; teamIndex < teams.length; teamIndex += 1) {
    while (teams[teamIndex].length < teamSize) {
      const eligible = personaIds.filter((personaId) => teams[teamIndex].filter((id) => id === personaId).length < 2);
      const maxCount = Math.max(...eligible.map((personaId) => globalCounts[personaId]));
      const weighted = eligible.map((personaId) => [
        personaId,
        1 + Math.max(0, maxCount - globalCounts[personaId]) + Math.max(0, minCount - globalCounts[personaId]) * 4
      ]);
      const chosen = weightedSample(Object.fromEntries(weighted));
      teams[teamIndex].push(chosen);
      globalCounts[chosen] += 1;
    }
  }

  return teams;
}

async function initializeAllStudents(numTeams = 10, teamSize = 6) {
  const teams = randomizeTeams(numTeams, teamSize);
  const allStudents = teams.map((composition) =>
    composition.map((personaId) => {
      const persona = PERSONAS[personaId];
      const age = sampleAge(persona);
      const gender = sampleGender(persona);
      return sampleStudent(personaId, age, gender);
    })
  );

  await Promise.all(allStudents.map(async (team) => {
    const names = await generateNames(team);
    team.forEach((student, index) => {
      student.name = names[index] || buildFallbackNames(team)[index];
    });
  }));

  return allStudents;
}

function deriveGridFromPersona(student) {
  const personaId = student?.personaId || student?.id;
  return PERSONA_GRID_CHOICES[personaId] || PERSONA_GRID_CHOICES.B;
}

function getStudentGridChoice(teamIndex, memberIndex, student) {
  const anchor = TEAM_ANCHOR_GRIDS[Math.abs(Number(teamIndex) || 0) % TEAM_ANCHOR_GRIDS.length];
  if (memberIndex < 4) return anchor;
  return deriveGridFromPersona(student);
}

module.exports = {
  PERSONAS,
  BACKUP_NAME_POOLS,
  EDUCATION_DISTRIBUTION,
  TEAM_ANCHOR_GRIDS,
  PERSONA_GRID_CHOICES,
  MBTI_BEHAVIOR_MODIFIERS,
  adjustEducationByAge,
  adjustEducationByGender,
  buildFullExpressionStyle,
  deriveGridFromPersona,
  deriveExpressionModifier,
  deriveOverseasExperience,
  generateNames,
  getMBTIDescription,
  getStudentGridChoice,
  initializeAllStudents,
  randomizeTeams,
  sampleStudent,
  weightedSample
};
