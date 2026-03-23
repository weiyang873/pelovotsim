# CODEX_PERSONA_SIM_TEST.md — Persona 驱动的 AI 拟真模拟测试

> **与 `CODEX_AI_SIMULATION_TEST.md` 的关系**：那个是基础流程测试（验证 API 通路和并发安全）。本 spec 是独立的第二套测试，目的不同：用高度拟真的 AI 学生测试系统对多样化输入的处理质量。
>
> **目标**：60 个 AI 学生各有独立人设（原型 × 性别 × MBTI × 姓名），走完 R1+R2 全流程，验证：
> 1. VP Coach 能合理应对不同表达风格的学生
> 2. VP 评分系统对不同质量的输入能产生有区分度的分数
> 3. 访谈教练能应对不同提问风格
> 4. 经济模型对不同策略组合都能输出合理结果
> 5. 全量日志可追溯每个学生的完整决策链
>
> **运行方式**：`node scripts/persona_sim_test.js`
>
> **前置条件**：`CODEX_AI_SIMULATION_TEST.md` 中的基础设施已实现（`api_client.js`、`team_runner.js`、`logger.js` 等），本 spec 复用这些模块，只替换学生生成器。

---

## 0. 文件结构

```
scripts/
  persona_sim_test.js             ← 主入口
  sim/
    api_client.js                 ← 复用基础测试的 API 客户端
    logger.js                     ← 复用基础测试的日志系统
    team_runner.js                ← 复用基础测试的流程编排（微调：接受 persona 参数）
    assertions.js                 ← 复用
    report.js                     ← 增强：输出 persona 维度的分析
    persona_student.js            ← 【新建】替代 deepseek_student.js，persona 驱动
    persona_pool.js               ← 【新建】7 原型定义 + 60 人抽样 + MBTI/性别/姓名
    persona_fallbacks.js          ← 【新建】7 × 性别 × MBTI 的 fallback 数据
    decision_tracker.js           ← 【新建】锦囊 + VP 迭代 + 选卡 + 定价的结构化追踪
    data_export.js                ← 【新建】CSV 汇总表 + PostgreSQL 明细写入
```

---

## 1. 七大学生原型 + 性别 + MBTI（`persona_pool.js`）

### 1.1 设计原则

- **MBTI 与原型强关联**：每个原型配 2-3 个高概率 MBTI 类型，抽取时按概率分布随机选
- **性别与原型关联**：反映真实 EMBA 课堂的性别比例（整体约 75% 男性）
- **性别影响表达但不影响能力**：prompt 中性别只体现在称呼、语气细微差异，不改变决策逻辑
- **MBTI 影响思维路径**：T 型偏逻辑分析，F 型偏用户共情；J 型偏结构化，P 型偏发散

### 1.2 原型定义

```javascript
const PERSONAS = {

  A: {
    id: 'A',
    label: '草根老板',
    desc: '制造业/贸易起家的民营企业家',
    age: '45-55',
    education: '大专或本科',
    role: '创始人/董事长',
    background: '从工厂车间或档口白手起家，吃到了中国制造和外贸的时代红利，企业年营收几千万到几个亿',
    industry: '制造业、外贸、建材、农产品加工',

    // 决策与表达
    decisionStyle: '快速拍板、凭直觉和经验、不喜欢过度分析',
    riskPreference: '高——"看准了就干，错了再调"',
    expressionStyle: '直接、接地气、用大白话说复杂的事、喜欢打比方、偶尔带粗话',

    // 模拟行为
    blindSpots: 'VP 写得接地气但缺结构，容易从自身经验出发而非用户视角',
    interviewStyle: '像跟客户聊天，问题很直接（"你愿不愿意花这个钱？"），不追问感受类问题',
    pricingBias: '敢定高价，"好东西就该卖贵"',
    vpQuirks: '可能写"让老人不孤单"这种朴素但模糊的表述，HOW 倾向从渠道而非产品功能切入',
    gridPreference: { leaning: 'B2B', reason: '习惯 to B 生意，觉得 to C 太累' },

    // 性别分布（概率）
    genderDistribution: { male: 0.85, female: 0.15 },

    // MBTI 分布（概率，每个原型 2-3 个高频类型）
    mbtiDistribution: {
      'ESTP': 0.40,  // 企业家型：行动导向、务实、冒险
      'ENTJ': 0.35,  // 指挥官型：强势、目标驱动、决断
      'ESTJ': 0.25,  // 总经理型：执行力强、注重效率
    },

    // 性别对表达的微调
    genderModifiers: {
      female: {
        expressionTweak: '比男性同行更注重关系维护，表达直接但不粗犷，会用"我们""咱们"拉近距离',
        interviewTweak: '访谈时更有亲和力，但同样结果导向',
      },
    },
  },

  B: {
    id: 'B',
    label: '职业经理人',
    desc: '外企或大型民企的职业高管',
    age: '35-45',
    education: '本科或MBA',
    role: 'VP/总监/事业部总经理',
    background: '在宝洁、联合利华、平安、华为等大企业一路升上来，管过几百人团队，擅长体系化思考',
    industry: '消费品、金融、地产、汽车',

    decisionStyle: '数据驱动、喜欢框架和模型、决策前要看数据支撑',
    riskPreference: '中等——"风险可控的情况下可以激进"',
    expressionStyle: '结构化、有逻辑层次、喜欢"第一第二第三"、PPT 思维',

    blindSpots: 'VP 框架漂亮但可能脱离一线用户真实场景，过度依赖二手数据',
    interviewStyle: '像做用户调研，提前想好问题清单，追问有条理但不够灵活',
    pricingBias: '算得很细，倾向找"最优价格点"',
    vpQuirks: 'WHO 写得精准但 PAIN 过于理性化，缺少情感洞察',
    gridPreference: { leaning: 'B2C_Differentiation', reason: '习惯品牌差异化打法' },

    genderDistribution: { male: 0.60, female: 0.40 },

    mbtiDistribution: {
      'ISTJ': 0.30,  // 检查员型：严谨、注重细节、按流程办事
      'ESTJ': 0.30,  // 总经理型：组织能力强、目标导向
      'ENTJ': 0.25,  // 指挥官型：战略思维、领导力
      'INTJ': 0.15,  // 建筑师型：独立思考、系统化
    },

    genderModifiers: {
      female: {
        expressionTweak: '同样结构化但更注重团队共识，会主动询问"大家怎么看"',
        interviewTweak: '访谈时更善于捕捉情感线索，会追问"那时候你的感受是什么"',
      },
    },
  },

  C: {
    id: 'C',
    label: '技术创业者',
    desc: '理工科博士或海归技术背景创业者',
    age: '35-45',
    education: '硕士或博士，可能有海外留学经历（美国/欧洲/日本）',
    role: '创始人/CTO/技术合伙人',
    background: '从实验室或大厂技术岗出来创业，做硬件/AI/医疗器械/机器人，技术很强但商业化还在摸索',
    industry: '科技、AI、医疗设备、机器人、新能源',

    decisionStyle: '追求技术最优解、第一性原理思考、有时过度工程化',
    riskPreference: '对技术风险不怕，对市场风险敏感',
    expressionStyle: '偶尔夹杂英文术语、喜欢类比技术概念、精确但有时太技术化',

    blindSpots: '关注产品胜过商业模式，选卡倾向堆高档追求"技术领先"，忽略成本和用户优先级',
    interviewStyle: '深挖技术相关需求（"你对延迟容忍度是多少？"），可能忽略情感维度',
    pricingBias: '倾向低估定价重要性，"产品好自然有人买"',
    vpQuirks: 'HOW 极其详细（列具体技术方案），WHO 和 PAIN 太窄',
    gridPreference: { leaning: 'Differentiation_Experience', reason: '本能追求技术差异化' },

    genderDistribution: { male: 0.80, female: 0.20 },

    mbtiDistribution: {
      'INTJ': 0.40,  // 建筑师型：战略性、独立、追求完美系统
      'INTP': 0.35,  // 逻辑学家型：分析型、好奇、追求理解本质
      'ENTJ': 0.25,  // 指挥官型：有远见、决断（偏创业者型）
    },

    genderModifiers: {
      female: {
        expressionTweak: '同样技术导向但表达更平衡，会主动补充用户视角，不那么"技术至上"',
        interviewTweak: '访谈时能兼顾技术问题和使用体验',
      },
    },
  },

  D: {
    id: 'D',
    label: '二代接班人',
    desc: '家族企业第二代',
    age: '30-38',
    education: '本科或海外硕士（英国/澳洲居多）',
    role: '副总/事业部负责人/董事',
    background: '家族企业（制造/地产/农业）准接班人，海外读书回来进家族企业，想推动转型但受制于老一代',
    industry: '家族制造、地产、农业、连锁零售',

    decisionStyle: '有国际视野但对一线运营理解浅，想法大但落地能力弱',
    riskPreference: '想激进但被家族保守文化拉住',
    expressionStyle: '流利但偶尔空洞、喜欢引用国外案例、中英文混杂',

    blindSpots: 'VP 容易写成"对标日本/欧洲市场"的愿景式表述，缺少对中国本土用户的深入理解',
    interviewStyle: '问开放性大问题（"您理想中的智能生活是什么样的？"），不太追问细节',
    pricingBias: '对价格没直觉，倾向参考海外定价',
    vpQuirks: '可能写出"打造中国版XX"这种对标式表述',
    gridPreference: { leaning: 'B2C_Differentiation', reason: '想做品牌，觉得代工没意思' },

    genderDistribution: { male: 0.55, female: 0.45 },

    mbtiDistribution: {
      'ENFP': 0.35,  // 竞选者型：热情、有创意、追求可能性
      'ENTP': 0.30,  // 辩论家型：喜欢新想法、善于联想
      'ESFP': 0.20,  // 表演者型：社交能力强、活在当下
      'INFP': 0.15,  // 调停者型：理想主义、追求意义
    },

    genderModifiers: {
      female: {
        expressionTweak: '可能更有人文关怀，对"企业社会责任"类话题更敏感',
        interviewTweak: '访谈时更善于建立共情，但同样缺少追问深度',
      },
    },
  },

  E: {
    id: 'E',
    label: '体制转型者',
    desc: '国企/政府背景出来的管理者',
    age: '40-55',
    education: '本科（国内985）',
    role: '从国企中层出来创业，或在民企做高管',
    background: '在央企/国企/政府机关干了十几年，出来后做基建、环保、医疗、教育相关业务，人脉是核心资产',
    industry: '基建、能源、环保、医疗、教育',

    decisionStyle: '谨慎、讲流程和合规、重视政策风向、决策慢但执行力强',
    riskPreference: '低——"先看看政策怎么说"',
    expressionStyle: '公文腔："统筹""落实""抓手""形成合力""长效机制"，严谨但缺少用户语言',

    blindSpots: 'VP 写成政策文件风格，PAIN 表述成"社会问题"而非个体痛点，HOW 写"整合资源"这种无法验证的说法',
    interviewStyle: '像调研座谈会，提问宏观（"您对养老服务业的看法？"），不习惯追问个人感受',
    pricingBias: '保守定价，怕"太贵老百姓接受不了"',
    vpQuirks: '典型输出："统筹社区养老资源，以LOVOT为抓手，构建智慧养老服务新模式"',
    gridPreference: { leaning: 'B2B_Elder', reason: '看到政策风口，觉得养老是大趋势' },

    genderDistribution: { male: 0.80, female: 0.20 },

    mbtiDistribution: {
      'ISTJ': 0.45,  // 检查员型：严谨、守规矩、注重细节
      'ISFJ': 0.30,  // 守护者型：尽责、稳重、注重和谐
      'ESTJ': 0.25,  // 总经理型：执行力强、讲纪律
    },

    genderModifiers: {
      female: {
        expressionTweak: '同样有体制语言习惯但可能更温和，会用"建议""考虑"而非"必须""要求"',
        interviewTweak: '访谈时稍有更多共情，但整体仍偏宏观视角',
      },
    },
  },

  F: {
    id: 'F',
    label: '销售铁军',
    desc: '从一线销售干到高管的实战派',
    age: '35-50',
    education: '大专到本科',
    role: '销售VP/区域总/自己开经销公司',
    background: '从保险、医药、快消、教培的一线销售做起，带过大团队，极度客户导向',
    industry: '保险、医药、快消、教培、汽车经销',

    decisionStyle: '客户导向、关注转化率和复购、用销售漏斗思维看一切',
    riskPreference: '中高——"敢投就有回报，关键是投对渠道"',
    expressionStyle: '有感染力、善于讲故事和用案例、语言有画面感但逻辑有时跳跃',

    blindSpots: '产品设计思维弱，容易把所有问题归结为"渠道没选对"或"话术不行"',
    interviewStyle: '像客户拜访，问得尖锐（"你会推荐给朋友吗？不会的话为什么？"），善于捕捉购买信号',
    pricingBias: '很敢定高价，但敏感于"渠道能不能接受"',
    vpQuirks: 'WHO 写得非常具体（会描述购买场景），HOW 容易写成销售话术而非产品机制',
    gridPreference: { leaning: 'B2C_Cost', reason: '觉得走量才是王道' },

    genderDistribution: { male: 0.70, female: 0.30 },

    mbtiDistribution: {
      'ESTP': 0.40,  // 企业家型：行动派、善于谈判、活在当下
      'ESFP': 0.30,  // 表演者型：社交达人、有感染力、即兴能力强
      'ENFJ': 0.30,  // 主人公型：善于激励他人、关注人际关系
    },

    genderModifiers: {
      female: {
        expressionTweak: '同样有销售感染力但更细腻，会用情感故事打动人，善于描绘用户使用场景',
        interviewTweak: '访谈时更善于让对方放下防备，能挖到更深层的需求',
      },
    },
  },

  G: {
    id: 'G',
    label: '互联网PM转型',
    desc: '大厂产品经理出身，转型创业或进传统行业',
    age: '30-40',
    education: '本科或硕士，可能有海外经历',
    role: '产品VP/创业者/传统企业数字化负责人',
    background: '在BAT/字节/美团/拼多多做了5-8年产品经理，带过千万DAU产品，出来创业或被传统企业挖去做数字化',
    industry: '互联网、SaaS、新零售、智能硬件',

    decisionStyle: '方法论驱动、A/B测试思维、喜欢用数据验证假设',
    riskPreference: '中等——"小步快跑、快速迭代"',
    expressionStyle: '互联网黑话："赋能""用户心智""北极星指标""PMF""打通链路""MVP""闭环"，流畅但可能过度抽象',

    blindSpots: 'VP 框架漂亮但容易脱离非互联网用户的真实语境，把所有用户都想象成年轻互联网用户',
    interviewStyle: '套方法论（用户旅程、JTBD、5 Whys），问得专业但对方可能听不懂',
    pricingBias: '习惯互联网免费/低价获客思维，可能低估硬件定价空间',
    vpQuirks: '典型输出："切入空巢老人的情感陪伴场景，以LOVOT为超级触点，打通从情感连接到健康监测的用户价值闭环，建立长期LTV"',
    gridPreference: { leaning: 'B2C_Differentiation', reason: '觉得差异化才有壁垒' },

    genderDistribution: { male: 0.55, female: 0.45 },

    mbtiDistribution: {
      'ENTP': 0.35,  // 辩论家型：创新、善于联想、喜欢挑战
      'ENTJ': 0.30,  // 指挥官型：战略思维、目标驱动
      'INTP': 0.20,  // 逻辑学家型：分析型、追求本质
      'INFJ': 0.15,  // 提倡者型：有洞察力、追求使命感（用户共情型PM）
    },

    genderModifiers: {
      female: {
        expressionTweak: '同样使用互联网术语但更注重用户情感维度，会主动补充"用户感受"类洞察',
        interviewTweak: '访谈时方法论之外更善于读懂言外之意',
      },
    },
  },
};
```

### 1.3 MBTI 对行为的影响规则

MBTI 不单独驱动行为，而是在原型基础上做**微调叠加**。在 prompt 中追加一段 MBTI 行为描述：

```javascript
const MBTI_BEHAVIOR_MODIFIERS = {
  // ─── E/I 维度：影响讨论中的主动性 ───
  'E': '你在小组讨论中倾向主动发言、提出观点，不怕表达不同意见。',
  'I': '你在小组讨论中倾向先听别人说，等想清楚再发言，但观点往往更深入。',

  // ─── S/N 维度：影响信息处理方式 ───
  'S': '你关注具体的事实和细节，喜欢用实际案例说话，不太信空洞的理论。',
  'N': '你喜欢看大局和趋势，善于联想和类比，有时会忽略执行细节。',

  // ─── T/F 维度：影响 VP 写作和访谈风格 ───
  'T': '你做决策偏逻辑分析，写 VP 时注重因果关系和数据支撑，访谈时关注功能和效率。',
  'F': '你做决策时会考虑人的感受，写 VP 时自然关注用户情感痛点，访谈时善于共情。',

  // ─── J/P 维度：影响决策速度和结构化程度 ───
  'J': '你喜欢尽快达成结论、做好计划，讨论时倾向推动收敛，不喜欢开放式发散太久。',
  'P': '你喜欢保持开放、多探索可能性，讨论时可能提出意外角度，但有时拖延决策。',
};

// 组合成完整描述
function getMBTIDescription(mbtiType) {
  return [
    MBTI_BEHAVIOR_MODIFIERS[mbtiType[0]],  // E/I
    MBTI_BEHAVIOR_MODIFIERS[mbtiType[1]],  // S/N
    MBTI_BEHAVIOR_MODIFIERS[mbtiType[2]],  // T/F
    MBTI_BEHAVIOR_MODIFIERS[mbtiType[3]],  // J/P
  ].join('\n');
}
```

### 1.4 姓名池（按原型 × 性别）

```javascript
const PERSONA_NAMES = {
  A: {
    male:   ['王建国', '李德胜', '张福根', '陈有财', '刘大力', '赵铁柱', '马长贵', '孙富强'],
    female: ['王桂兰', '李秀英', '张玉华', '陈翠花'],
  },
  B: {
    male:   ['周明远', '吴晨曦', '黄嘉伟', '杨博文', '林思远', '陈志鹏'],
    female: ['陈雅琳', '刘若萱', '张晓薇', '王静怡', '李思涵', '赵芷若'],
  },
  C: {
    male:   ['张博宇', '刘一鸣', '陈思源', '王朝阳', '赵鹏飞', '李维克'],
    female: ['林晓研', '何思琪', '吴静怡', '陈芯蕊'],
  },
  D: {
    male:   ['何天宇', '沈子杰', '林浩然', '郑凯文', '周锐'],
    female: ['黄思齐', '沈若曦', '何悦然', '林子涵', '郑雨桐'],
  },
  E: {
    male:   ['马长河', '孙国栋', '郝建明', '钱卫东', '周志远', '李同方'],
    female: ['王慧芳', '刘淑贤'],
  },
  F: {
    male:   ['杨彪', '孙虎', '刘磊', '张鑫', '陈龙', '王超'],
    female: ['李娜', '赵薇薇', '张丽丽'],
  },
  G: {
    male:   ['苏阳', '韩晨', '方舟', '许楠', '高翔', '秦鹏'],
    female: ['高悦', '秦岚', '陆瑶', '白若溪', '宋清然'],
  },
};
```

### 1.5 抽样函数：生成一个完整学生人设

```javascript
function sampleStudent(personaId, index) {
  const persona = PERSONAS[personaId];

  // 1. 抽性别
  const gender = Math.random() < persona.genderDistribution.male ? 'male' : 'female';

  // 2. 抽 MBTI（按概率分布）
  const mbti = weightedSample(persona.mbtiDistribution);

  // 3. 抽姓名
  const namePool = PERSONA_NAMES[personaId][gender];
  const name = namePool[index % namePool.length];

  // 4. 抽年龄（在原型范围内随机）
  const [ageMin, ageMax] = persona.age.split('-').map(Number);
  const age = ageMin + Math.floor(Math.random() * (ageMax - ageMin + 1));

  return {
    ...persona,
    gender,
    mbti,
    name,
    age,
    // 组合后的完整表达风格描述
    fullExpressionStyle: buildFullExpressionStyle(persona, gender, mbti),
  };
}

function buildFullExpressionStyle(persona, gender, mbti) {
  let style = persona.expressionStyle;
  if (gender === 'female' && persona.genderModifiers?.female) {
    style += '。' + persona.genderModifiers.female.expressionTweak;
  }
  style += '\n\n你的思维特征（MBTI: ' + mbti + '）：\n' + getMBTIDescription(mbti);
  return style;
}

function weightedSample(distribution) {
  const entries = Object.entries(distribution);
  const total = entries.reduce((s, [, p]) => s + p, 0);
  let r = Math.random() * total;
  for (const [type, prob] of entries) {
    r -= prob;
    if (r <= 0) return type;
  }
  return entries[entries.length - 1][0];
}
```

---

## 2. 团队组队（60 人分配）

### 2.1 10 队原型分配

```javascript
const TEAM_COMPOSITIONS = [
  ['A', 'B', 'C', 'E', 'F', 'G'],  // 队 0: 全类型覆盖
  ['A', 'B', 'D', 'E', 'F', 'G'],  // 队 1: 二代替换技术
  ['A', 'C', 'D', 'F', 'G', 'B'],  // 队 2: 技术+二代+草根
  ['B', 'C', 'E', 'F', 'G', 'A'],  // 队 3: 职业经理人主导
  ['A', 'A', 'C', 'E', 'F', 'G'],  // 队 4: 两个草根老板（真实常见）
  ['B', 'B', 'C', 'D', 'F', 'G'],  // 队 5: 两个职业经理人
  ['A', 'C', 'C', 'E', 'F', 'B'],  // 队 6: 两个技术背景
  ['A', 'D', 'E', 'F', 'F', 'G'],  // 队 7: 两个销售铁军
  ['A', 'B', 'C', 'D', 'E', 'F'],  // 队 8: 无互联网PM
  ['B', 'C', 'D', 'E', 'G', 'G'],  // 队 9: 两个互联网PM
];
```

### 2.2 初始化 60 个学生

```javascript
function initializeAllStudents() {
  const allStudents = []; // 60 人
  for (let t = 0; t < 10; t++) {
    const comp = TEAM_COMPOSITIONS[t];
    const teamStudents = comp.map((personaId, m) =>
      sampleStudent(personaId, t * 6 + m)
    );
    allStudents.push(teamStudents);
  }
  return allStudents; // allStudents[teamIndex][memberIndex]
}
```

### 2.3 格子选择逻辑

```javascript
// 每队有一个锚点格子
const TEAM_ANCHOR_GRIDS = [
  { grid: 'B2C_Differentiation_Adult',   arch: 'Experience' },
  { grid: 'B2B_Differentiation_Elder',   arch: 'Experience' },
  { grid: 'B2C_Cost_Child',              arch: 'Hybrid'     },
  { grid: 'B2B_Cost_Elder',              arch: 'Function'   },
  { grid: 'B2C_Differentiation_Child',   arch: 'Experience' },
  { grid: 'B2B_Differentiation_Adult',   arch: 'Hybrid'     },
  { grid: 'B2C_Cost_Adult',              arch: 'Function'   },
  { grid: 'B2C_Differentiation_Elder',   arch: 'Experience' },
  { grid: 'B2B_Cost_Child',              arch: 'Hybrid'     },
  { grid: 'B2B_Cost_Adult',              arch: 'Function'   },
];

function getStudentGridChoice(teamIndex, memberIndex, student) {
  const anchor = TEAM_ANCHOR_GRIDS[teamIndex];
  // 前 4 人跟随锚点
  if (memberIndex < 4) return anchor;
  // 后 1-2 人按原型偏好选不同格子（制造分歧）
  return deriveGridFromPersona(student);
}
```

---

## 3. Persona Student（`persona_student.js`）

### 3.1 构造函数

```javascript
class PersonaStudent {
  constructor({ apiKey, student, teamIndex, memberIndex, logger }) {
    this.apiKey = apiKey;
    this.student = student;     // sampleStudent() 的返回值（含原型+性别+MBTI+姓名+年龄）
    this.teamIndex = teamIndex;
    this.memberIndex = memberIndex;
    this.logger = logger;
  }
}
```

### 3.2 System Prompt 构建

所有步骤共享一个基础 system prompt，注入完整人设：

```javascript
function buildBaseSystemPrompt(student) {
  const genderLabel = student.gender === 'male' ? '男' : '女';
  return `你是一位正在读 EMBA 的中国商业人士，正在参加 LOVOT 陪伴机器人的中国市场战略模拟课程。

## 你的个人信息
- 姓名：${student.name}
- 性别：${genderLabel}
- 年龄：${student.age}岁
- 学历：${student.education}
- 身份：${student.role}
- 行业经验：${student.background}
- 所在行业：${student.industry}

## 你的性格特征（MBTI: ${student.mbti}）
${getMBTIDescription(student.mbti)}

## 你的思维和表达方式
- 决策风格：${student.decisionStyle}
- 风险偏好：${student.riskPreference}
- 表达风格：${student.fullExpressionStyle}
- 你的典型盲区：${student.blindSpots}

## 重要规则
- 用你自己的语言风格说话，不要模仿教科书
- 基于你的真实行业经验思考
- 可以有盲区和不完美——你不是专家
- 全程中文`;
}
```

### 3.3 各步骤 Prompt

**Phase1 个人选择**：
```javascript
async generatePhase1Choice(gridChoice) {
  const systemPrompt = buildBaseSystemPrompt(this.student) + `

## 当前任务
你选择了市场定位：${gridDesc}（${channelType} × ${strategyType} × ${ageSegment}）
架构标签：${gridChoice.arch}

请写出你的初始 VP 草稿：
- WHO：目标客户是谁？
- PAIN：他们面临什么痛点？（要有具体触发情境）
- HOW：LOVOT 怎么解决？（要有具体机制）

注意你的表达特点：${this.student.vpQuirks}

2-4 句话，只输出 JSON：{"who":"...","pain":"...","how":"..."}`;

  // ... DeepSeek 调用 + 日志记录 ...
}
```

**VP Coach 对话**：
```javascript
async generateVPChatReply(coachMessage, conversationHistory) {
  const systemPrompt = buildBaseSystemPrompt(this.student) + `

## 当前场景
你在小组讨论中回应 AI 教练。

当前 VP 草稿：WHO=${who}, PAIN=${pain}, HOW=${how}
教练刚说："${coachMessage}"

用你自然的表达方式回复，1-3 句话。`;

  // ... DeepSeek 调用 + 日志记录 ...
}
```

**Round 2 访谈**：
```javascript
async generateInterviewReply(personaMessage, conversationHistory, assignedDims) {
  const systemPrompt = buildBaseSystemPrompt(this.student) + `

## 当前场景
你在对 LOVOT 潜在用户进行焦点访谈。

你的访谈风格：${this.student.interviewStyle}
你负责的产品维度：${assignedDimsDesc}
用户刚说："${personaMessage}"

用你自然的访谈风格追问，1-2 句话。`;

  // ... DeepSeek 调用 + 日志记录 ...
}
```

**定价决策**：
```javascript
async generatePriceChoice(priceRange, costInfo) {
  const systemPrompt = buildBaseSystemPrompt(this.student) + `

## 当前场景
你需要为 LOVOT 定价。

你的定价倾向：${this.student.pricingBias}

可售价格区间：¥${priceRange.min} - ¥${priceRange.max}
硬件成本：¥${costInfo.totalCOGS}
渠道费率：${costInfo.channelFee}%

直接输出一个价格数字（整数），不要解释。`;

  // ... DeepSeek 调用 + 日志记录 ...
}
```

---

## 4. Fallback 数据（`persona_fallbacks.js`）

按原型提供 fallback，性别和 MBTI 不影响 fallback 内容（fallback 只在 API 挂了时用，不需要那么精细）：

```javascript
const FALLBACK_VP = {
  A: {
    who: '小区里70岁以上的独居老头老太太，子女在外地打工的那种',
    pain: '白天还好，晚上一个人看电视到睡着，摔了都没人知道',
    how: 'LOVOT 就跟养了个不用喂的小宠物似的，会主动过来蹭你，晚上能帮你看着点',
  },
  B: {
    who: '一线城市25-35岁独居白领，月收入15K+，有情感陪伴需求但时间精力有限',
    pain: '工作日晚归后的孤独感，周末独处时缺少互动对象，养宠物的时间和精力成本过高',
    how: 'LOVOT通过主动靠近和情绪识别提供低维护成本的情感陪伴，填补宠物和社交之间的需求空白',
  },
  C: {
    who: '对AI和机器人有认知的科技从业者家庭，核心是3-8岁小孩的陪伴需求',
    pain: '双职工家庭儿童独处时间长，现有教育机器人交互太生硬，无法产生emotional attachment',
    how: 'LOVOT的多模态感知系统能实现类宠物级别的自然交互，培养儿童的同理心和情感能力',
  },
  D: {
    who: '高端养老社区的入住老人及其子女（实际付费决策者）',
    pain: '子女对父母独居的愧疚感和安全焦虑，参考日本养老机构已有成功案例',
    how: '对标日本LOVOT在养老场景的应用，结合中国高端养老社区的服务体系',
  },
  E: {
    who: '社区居家养老服务中心覆盖的60岁以上老年群体',
    pain: '当前社区养老服务人力不足、覆盖有限，难以形成对独居老人的常态化关怀机制',
    how: 'LOVOT作为智慧养老服务的重要抓手，统筹家庭端和社区端资源，构建居家养老新模式',
  },
  F: {
    who: '有6岁以下小孩的中产家庭，妈妈是主要决策人，逛商场时能被实物打动的那种',
    pain: '妈妈们又要上班又要带娃，晚上小孩缠着要陪玩，大人精力真不够用',
    how: 'LOVOT是最好的"第二陪玩伙伴"，小孩跟它玩半小时妈妈就能歇口气',
  },
  G: {
    who: '一二线城市25-35岁独居年轻人，高频使用智能家居，对AI产品接受度高',
    pain: '情感陪伴的"最后一公里"——语音助手太工具化，宠物维护成本高，社交太消耗能量',
    how: '以LOVOT为超级触点，切入独居场景的情感陪伴需求，通过情绪感知建立用户心智，延展到健康监测等高LTV场景',
  },
};

const FALLBACK_CHAT_REPLIES = {
  A: [
    '教练你说得对，但我觉得关键还是渠道，养老院院长点头了后面就好办',
    '这个人群太窄了吧？我做生意这么多年，窄了就没量',
    '行，那就先聚焦这个人群试试看，不行再调',
  ],
  B: [
    '同意教练的观点，WHO部分还需要用年龄×收入×家庭结构三个维度交叉细分',
    '数据上看这个痛点确实存在，但我们需要验证频次',
    '我来整理讨论要点：第一WHO聚焦独居白领，第二PAIN锁定日常孤独感',
  ],
  C: [
    '从技术角度看，LOVOT的多模态感知确实是核心差异化，但我们需要量化latency指标',
    '我觉得HOW部分还不够specific，需要明确是哪几个sensor在起作用',
    '同意缩小人群，但如果WHO太窄的话addressable market会很小',
  ],
  D: [
    '我在英国读书时见过类似的产品，那边的养老机构很欢迎这种companion robot',
    '可以参考日本市场的定价策略，他们的用户画像跟我们类似',
    '我觉得品牌故事很重要，要让用户觉得这不只是个机器人',
  ],
  E: [
    '这个方向跟国家养老政策的大方向是一致的，建议我们把政策利好也纳入考虑',
    '需要注意合规性问题，特别是如果涉及健康数据采集',
    '建议统筹考虑与社区养老服务中心的合作模式',
  ],
  F: [
    '关键是第一次见面能不能打动客户，要想好线下体验怎么做',
    '这个价格能不能让渠道商有足够的利润空间？他们不赚钱就不推',
    '我觉得先找几个种子客户做试点，拿到真实反馈再扩大',
  ],
  G: [
    '我觉得我们可以用JTBD框架重新梳理一下——用户hire这个产品要完成什么job？',
    '赋能这个词可能太虚了，教练说得对，要回到具体场景，找到PMF',
    '建议先定义MVP——最小可行的价值主张是什么，后面再迭代',
  ],
};

const FALLBACK_INTERVIEW_REPLIES = {
  A: [
    '您愿不愿意花一万多块买这么个东西？不愿意的话多少钱行？',
    '您平时跟子女联系多吗？他们会帮您买这种高科技产品吗？',
  ],
  B: [
    '您刚才提到的场景，大概一周会出现几次？是固定时间还是不定期？',
    '在您的日常生活中，哪些时刻最需要有人陪伴？能具体描述一下吗？',
  ],
  C: [
    '您对这种产品的响应速度有什么期望？比如您叫它，多快过来算可以接受？',
    '如果它能识别您的情绪状态，您觉得需要多准确才有用？',
  ],
  D: [
    '您理想中的智能陪伴是什么样的？可以描述一下画面吗？',
    '如果对比您在海外看到的类似产品，您觉得中国市场有什么不同的需求？',
  ],
  E: [
    '从社区养老服务的角度看，您觉得这类产品能在哪些环节发挥作用？',
    '如果要在社区层面推广，您觉得主要的障碍是什么？',
  ],
  F: [
    '如果您朋友问您这个东西值不值得买，您会怎么跟他说？',
    '第一次看到这个产品的时候，什么让您印象最深？',
  ],
  G: [
    '如果把您一天的生活画成timeline，LOVOT可能出现在哪些touchpoint？',
    '您现在用什么替代方案来满足这个需求？痛点在哪里？',
  ],
};
```

---

## 5. 主入口（`persona_sim_test.js`）

```javascript
const { SimLogger } = require('./sim/logger');
const { ApiClient } = require('./sim/api_client');
const { runTeam } = require('./sim/team_runner');
const { initializeAllStudents, TEAM_COMPOSITIONS } = require('./sim/persona_pool');
const { generateReport } = require('./sim/report');

async function main() {
  const BASE = process.env.BASE_URL || 'http://127.0.0.1:8787';
  const NUM_TEAMS = Number(process.env.NUM_TEAMS || 10);
  const TEAM_SIZE = Number(process.env.TEAM_SIZE || 6);
  const CONCURRENCY = Number(process.env.CONCURRENCY || 5);

  console.log('\n🎭 EMBA-AI-SIM Persona 拟真模拟测试');
  console.log(`   ${NUM_TEAMS} 队 × ${TEAM_SIZE} 人，7 种原型 × 性别 × MBTI\n`);

  const logger = new SimLogger();
  const allStudents = initializeAllStudents();

  // 打印生成的 60 人概况
  console.log('📋 学生分配概况：');
  for (let t = 0; t < NUM_TEAMS; t++) {
    const team = allStudents[t];
    const summary = team.map(s => `${s.name}(${s.label[0]}/${s.gender[0]}/${s.mbti})`).join(' | ');
    console.log(`   队${t}: ${summary}`);
  }
  console.log('');

  // ... 复用基础测试的并发逻辑 ...
  // 但 runTeam 时传入 allStudents[teamIndex] 作为 persona 参数

  const limit = pLimit(CONCURRENCY);
  const results = await Promise.allSettled(
    Array.from({ length: NUM_TEAMS }, (_, i) =>
      limit(() => {
        const teamApi = new ApiClient(BASE, { logger, teamId: null });
        return runTeam(i, TEAM_SIZE, teamApi, logger, console, {
          students: allStudents[i],  // ★ 传入预生成的学生人设
        });
      })
    )
  );

  // 导出日志
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const outDir = `data/persona_sim_logs/${ts}`;
  logger.exportByTeam(`${outDir}/by_team`);
  logger.exportAll(`${outDir}/all_entries.json`);

  // 导出 60 人人设清单（方便对照日志看）
  fs.writeFileSync(`${outDir}/student_roster.json`, JSON.stringify(
    allStudents.map((team, t) => ({
      teamIndex: t,
      members: team.map(s => ({
        name: s.name, persona: s.label, gender: s.gender,
        mbti: s.mbti, age: s.age, education: s.education,
        role: s.role, industry: s.industry,
      })),
    })),
    null, 2
  ));

  // 通知服务器刷盘
  try {
    await fetch(`${BASE}/api/admin/flush-llm-logs`, { method: 'POST' });
  } catch (e) {}

  generateReport(results, `${outDir}/report.json`);

  console.log(`\n📊 输出目录: ${outDir}/`);
  console.log(`   student_roster.json   60 人人设清单`);
  console.log(`   by_team/              每队日志`);
  console.log(`   report.json           测试报告`);
}

main().catch(e => { console.error(e); process.exit(1); });
```

---

## 6. team_runner 适配

`team_runner.js` 的 `runTeam` 函数增加一个可选参数 `options.students`：

```javascript
async function runTeam(teamIndex, teamSize, api, logger, console, options = {}) {
  const students = options.students; // PersonaStudent[] 或 null

  // 如果传了 students，用 PersonaStudent；否则 fallback 到基础测试的 DeepSeekStudent
  function getStudent(memberIndex) {
    if (students && students[memberIndex]) {
      return new PersonaStudent({
        apiKey: process.env.DEEPSEEK_API_KEY,
        student: students[memberIndex],
        teamIndex,
        memberIndex,
        logger,
      });
    }
    // fallback 到基础模式
    return new DeepSeekStudent({ teamIndex, memberIndex, logger });
  }

  // ... 其余流程不变，只是创建 student 对象时调 getStudent(i) ...
}
```

---

## 7. 决策追踪器（`decision_tracker.js`）

每队一个 tracker 实例，全流程累积结构化决策数据。这不是日志（日志记原始 API 调用），而是**业务语义层的追踪**。

### 7.1 数据结构

```javascript
class DecisionTracker {
  constructor(teamId, teamIndex) {
    this.teamId = teamId;
    this.teamIndex = teamIndex;
    this.members = {};  // memberId → MemberTracker
    this.team = {
      finalGrid: null,
      finalArch: null,
      vpIterations: [],        // VP 迭代历史

      // R1 经济模型中间值
      r1_wtp_ref: null,             // 该格子的 WTP 中位价
      r1_sam_billion: null,         // SAM（亿元）
      r1_rho_c: null,               // 覆盖率
      r1_wtp_multiplier: null,      // VP 质量对 WTP 的调整倍数

      // R1 VP 诊断（从 scorer feature extraction 提取）
      vp_who_specificity: null,     // 0/1/2（has_clear_customer）
      vp_pain_has_trigger: null,    // 0/1/2（has_scenario）
      vp_how_has_mechanism: null,   // 0/1/2（has_mechanism）
      vp_coach_turns_total: null,   // VP Coach 总对话轮次

      // R2 团队选卡
      r2_teamSelections: null,
      r2_total_dCOGS: null,         // 选卡增加的总硬件成本
      r2_total_NRE: null,           // 研发固定成本
      r2_budget_utilization: null,  // 实际 dCOGS / budget_cap
      r2_high_tier_count: null,     // 高档卡数量
      r2_violation_count: null,     // 提交前触发硬约束违规次数

      // R2 定价
      r2_finalPrice: null,
      r2_price_vs_wtp: null,        // 定价 / WTP_ref（>1 激进，<0.7 保守）

      // R2 最终结果
      r2_finalCalcResult: null,
      r2_gross_margin: null,        // 最终毛利率
      r2_profit_hw: null,           // 硬件利润
      r2_profit_sub: null,          // 订阅利润
      r2_is_profitable: null,       // BOOLEAN
    };
  }

  initMember(memberId, memberIndex, student) {
    this.members[memberId] = {
      memberId,
      memberIndex,
      // 人设
      persona: student.id,
      personaLabel: student.label,
      name: student.name,
      gender: student.gender,
      mbti: student.mbti,
      age: student.age,
      education: student.education,
      role: student.role,
      industry: student.industry,

      // R1 锦囊
      jinang_market: null,       // { card_id, name, desc }
      jinang_tech: null,         // { card_id, name, desc }

      // R1 个人选择
      r1_grid_id: null,
      r1_architecture: null,
      r1_who: null,
      r1_pain: null,
      r1_how: null,
      r1_personal_gm_max: null,

      // 锦囊匹配
      jinang_market_match: null,  // match_strength 0-1
      jinang_tech_match: null,

      // R2 访谈
      r2_assigned_dims: [],
      r2_interview_turns: 0,
      r2_interview_summary: null,
      r2_radar_scores: null,     // { perception, motion, interaction, safety, extension, maintenance }

      // R2 访谈质量中间值
      r2_evi: null,                   // 访谈证据强度（规则计算）
      r2_evidence_count: null,        // 证据条数
      r2_strong_dim_count: null,      // 被标记 strong 的维度数（0-2）
      r2_missing_dim_count: null,     // 访谈完全没覆盖的维度数

      // R2 个人选卡
      r2_personal_selections: [],  // [{ cap_id, tier, dim }]
      r2_high_tier_count: null,    // 该成员选了几张高档卡

      // R2 锦囊应用效果
      jinang_tech_applied: [],   // [{ cap_id, original_dCOGS, discounted_dCOGS, original_risk, discounted_risk }]
    };
  }
}
```

### 7.2 锦囊追踪——完整链路

在 `team_runner.js` 中每个步骤收集数据：

```javascript
// R1.2 获取锦囊后
tracker.members[m.id].jinang_market = data.jinang.market;  // { card_id, name, desc }
tracker.members[m.id].jinang_tech = data.jinang.tech;

// R1.3 提交 Phase1 后（从 response 中提取）
tracker.members[m.id].r1_grid_id = choice.grid_id;
tracker.members[m.id].r1_architecture = choice.architecture;
tracker.members[m.id].r1_who = choice.who;
tracker.members[m.id].r1_pain = choice.pain;
tracker.members[m.id].r1_how = choice.how;
tracker.members[m.id].r1_personal_gm_max = data.personal_gm_max;

// R1.7 Phase4 结果中提取锦囊匹配度
// （如果 API 返回 match_strength，直接取；如果不返回，记 null，后续从 DB 补查）
tracker.members[m.id].jinang_market_match = phase4.jinang_market_match || null;
tracker.members[m.id].jinang_tech_match = phase4.jinang_tech_match || null;

// R2.4 个人选卡后
tracker.members[m.id].r2_personal_selections = selections;

// R2.5 团队合并时，检查哪些卡受到了技术锦囊折扣
// （从 validate/calculate response 中提取 jinang 应用效果）
if (calcResult.jinang_effects) {
  tracker.members[m.id].jinang_tech_applied = calcResult.jinang_effects;
}
```

### 7.3 VP 迭代追踪

VP Coach 阶段是多轮对话 + 可能多次评分。记录每次 VP 状态变化：

```javascript
// tracker.team.vpIterations 数组，每个元素代表一个 VP 状态快照
// 记录时机：初次提交 + 每轮 Coach 对话后（如果 VP 有修改）+ finalize 时

tracker.team.vpIterations.push({
  iteration: 0,                    // 第几次迭代（0 = 初次提交）
  timestamp: new Date().toISOString(),
  trigger: 'initial_submit',       // 'initial_submit' | 'coach_round_1' | 'coach_round_2' | 'coach_round_3' | 'finalize'
  speaker: {
    memberId: memberId,
    persona: 'A',
    personaLabel: '草根老板',
    name: '王建国',
  },
  vp_text: {
    who: '...',
    pain: '...',
    how: '...',
  },
  // 如果该轮有评分（不是每轮都有，只在 submit-vp 和 finalize 时）
  scores: {
    C: 3, G: 2, E: 4,
  } || null,
  // Coach 的回复
  coach_reply: '...',
  // 与上一次的变化标记
  changes: {
    who_changed: false,
    pain_changed: true,
    how_changed: true,
  } || null,
});
```

**在 team_runner 中收集**：

```javascript
// R1.5 VP Coach 对话
async function r1_vpCoachDialog(api, teamId, members, teamIndex, tracker) {
  // 初次提交 VP
  const vpInput = await speakers[0].generatePhase1Choice(gridChoice);
  const { data: vpData } = await api.submitVP(teamId, { ... });

  tracker.team.vpIterations.push({
    iteration: 0,
    trigger: 'initial_submit',
    speaker: { memberId: members[0].id, persona: composition[0], ... },
    vp_text: { who: vpInput.who, pain: vpInput.pain, how: vpInput.how },
    scores: vpData.vp_scores || null,  // 初次评分（如果 API 返回）
    coach_reply: vpData.reply,
    changes: null,
  });

  // 每轮对话
  let prevVP = { who: vpInput.who, pain: vpInput.pain, how: vpInput.how };
  for (let round = 0; round < 3; round++) {
    const reply = await speakers[round].generateVPChatReply(coachMessage, history);
    const { data: chatData } = await api.chatVP(teamId, reply);

    // 检测学生回复中是否修改了 VP（从 chatData 中提取，或从回复文本推断）
    const updatedVP = chatData.updated_vp || prevVP;  // 如果 API 返回更新后的 VP

    tracker.team.vpIterations.push({
      iteration: round + 1,
      trigger: `coach_round_${round + 1}`,
      speaker: { memberId: members[speakerOrder[round]].id, persona: composition[speakerOrder[round]], ... },
      vp_text: updatedVP,
      scores: chatData.vp_scores || null,
      coach_reply: chatData.reply,
      changes: {
        who_changed: updatedVP.who !== prevVP.who,
        pain_changed: updatedVP.pain !== prevVP.pain,
        how_changed: updatedVP.how !== prevVP.how,
      },
    });
    prevVP = updatedVP;
  }

  // Finalize 时
  const { data: finalData } = await api.finalizeVP(teamId);
  tracker.team.vpIterations.push({
    iteration: 4,
    trigger: 'finalize',
    speaker: null,
    vp_text: finalData.final_vp || prevVP,
    scores: finalData.vp_scores || null,
    coach_reply: null,
    changes: null,
  });
}
```

---

## 8. 数据输出：CSV 汇总 + PostgreSQL 明细（`data_export.js`）

### 8.1 PostgreSQL 明细表（4 张表）

测试跑完后，将 tracker 数据写入 PG，方便复杂查询和交叉分析。

**表 1：`sim_students`（60 行，一人一行）**

```sql
CREATE TABLE IF NOT EXISTS sim_students (
  id            SERIAL PRIMARY KEY,
  run_id        TEXT NOT NULL,           -- 本次测试的唯一 ID（时间戳）
  team_id       TEXT NOT NULL,           -- 实际 team_id
  team_index    INTEGER NOT NULL,        -- 0-9
  member_id     TEXT NOT NULL,
  member_index  INTEGER NOT NULL,        -- 0-5
  -- 人设
  name          TEXT,
  persona_id    CHAR(1),                 -- A-G
  persona_label TEXT,                    -- '草根老板' 等
  gender        TEXT,                    -- 'male'/'female'
  mbti          CHAR(4),                 -- 'ESTP' 等
  age           INTEGER,
  education     TEXT,
  role          TEXT,
  industry      TEXT,
  -- R1 锦囊
  jinang_market_id    TEXT,
  jinang_market_name  TEXT,
  jinang_tech_id      TEXT,
  jinang_tech_name    TEXT,
  -- R1 个人选择
  r1_grid_id          TEXT,
  r1_architecture     TEXT,
  r1_who              TEXT,
  r1_pain             TEXT,
  r1_how              TEXT,
  r1_personal_gm_max  REAL,
  -- 锦囊匹配
  jinang_market_match REAL,              -- 0-1
  jinang_tech_match   REAL,              -- 0-1
  -- R2 访谈
  r2_assigned_dims    TEXT,              -- JSON: ["interaction","safety"]
  r2_interview_turns  INTEGER,
  r2_interview_summary TEXT,
  r2_radar_scores     TEXT,              -- JSON: {perception:3.2, ...}
  -- R2 访谈质量中间值
  r2_evi              REAL,              -- 访谈证据强度（规则计算，0-0.85）
  r2_evidence_count   INTEGER,           -- 证据条数
  r2_strong_dim_count INTEGER,           -- 被标记 strong 的维度数（0-2）
  r2_missing_dim_count INTEGER,          -- 访谈完全没覆盖的维度数
  -- R2 选卡
  r2_personal_selections TEXT,           -- JSON: [{cap_id, tier, dim}]
  r2_high_tier_count  INTEGER,           -- 该成员选了几张高档卡
  r2_jinang_tech_applied TEXT,           -- JSON: [{cap_id, original_dCOGS, discounted}]
  created_at    TIMESTAMP DEFAULT NOW()
);
```

**表 2：`sim_teams`（10 行，一队一行）**

```sql
CREATE TABLE IF NOT EXISTS sim_teams (
  id            SERIAL PRIMARY KEY,
  run_id        TEXT NOT NULL,
  team_id       TEXT NOT NULL,
  team_index    INTEGER NOT NULL,
  -- R1 团队决策
  final_grid_id     TEXT,
  final_architecture TEXT,
  -- R1 经济模型中间值
  r1_wtp_ref         REAL,              -- 该格子 WTP 中位价
  r1_sam_billion     REAL,              -- SAM（亿元）
  r1_rho_c           REAL,              -- 覆盖率
  r1_wtp_multiplier  REAL,              -- VP 质量对 WTP 的调整倍数
  -- R1 结果
  gm_max            REAL,
  target_gm         REAL,
  market_space_tier  TEXT,
  vp_score_c        INTEGER,
  vp_score_g        INTEGER,
  vp_score_e        INTEGER,
  -- R1 VP 诊断（从 scorer feature extraction 提取）
  vp_who_specificity  INTEGER,          -- 0/1/2（has_clear_customer）
  vp_pain_has_trigger INTEGER,          -- 0/1/2（has_scenario）
  vp_how_has_mechanism INTEGER,         -- 0/1/2（has_mechanism）
  vp_coach_turns_total INTEGER,         -- VP Coach 总对话轮次
  -- VP 迭代
  vp_total_iterations INTEGER,           -- VP 迭代次数
  vp_initial_score   REAL,               -- 初次 C×G×E 乘积
  vp_final_score     REAL,               -- 最终 C×G×E 乘积
  vp_improvement     REAL,               -- (final - initial) / initial
  -- R2 选卡
  r2_team_card_count INTEGER,
  r2_total_dCOGS     REAL,
  r2_total_NRE       REAL,
  r2_budget_utilization REAL,            -- 实际 dCOGS / budget_cap（0-1+）
  r2_high_tier_count INTEGER,            -- 团队高档卡总数
  r2_violation_count INTEGER,            -- 提交前硬约束违规触发次数
  -- R2 定价
  r2_price           REAL,
  r2_price_vs_wtp    REAL,               -- 定价 / WTP_ref（>1 激进，<0.7 保守）
  -- R2 最终结果
  r2_share           REAL,
  r2_units           REAL,
  r2_revenue         REAL,
  r2_gross_margin    REAL,               -- 最终毛利率
  r2_profit_hw       REAL,               -- 硬件利润
  r2_profit_sub      REAL,               -- 订阅利润
  r2_profit          REAL,               -- 总利润
  r2_is_profitable   BOOLEAN,            -- 最终有没有赚钱
  -- 锦囊汇总
  jinang_tech_discount_total REAL,       -- 团队技术锦囊节省的总 dCOGS
  -- 元数据
  total_llm_calls    INTEGER,
  total_tokens       INTEGER,
  total_duration_ms  INTEGER,
  created_at    TIMESTAMP DEFAULT NOW()
);
```

**表 3：`sim_vp_iterations`（每队 4-5 行，记录 VP 每次迭代）**

```sql
CREATE TABLE IF NOT EXISTS sim_vp_iterations (
  id            SERIAL PRIMARY KEY,
  run_id        TEXT NOT NULL,
  team_id       TEXT NOT NULL,
  team_index    INTEGER NOT NULL,
  iteration     INTEGER NOT NULL,         -- 0=初始, 1-3=coach轮次, 4=finalize
  trigger       TEXT NOT NULL,            -- 'initial_submit', 'coach_round_1', 'finalize'
  speaker_member_id TEXT,
  speaker_persona   CHAR(1),
  speaker_name      TEXT,
  -- VP 内容
  vp_who        TEXT,
  vp_pain       TEXT,
  vp_how        TEXT,
  -- 评分（如果该轮有）
  score_c       INTEGER,
  score_g       INTEGER,
  score_e       INTEGER,
  score_product REAL,                     -- C×G×E 的比例乘积
  -- 变化
  who_changed   BOOLEAN,
  pain_changed  BOOLEAN,
  how_changed   BOOLEAN,
  -- Coach
  coach_reply   TEXT,
  created_at    TIMESTAMP DEFAULT NOW()
);
```

**表 4：`sim_jinang_effects`（每个受锦囊影响的卡一行）**

```sql
CREATE TABLE IF NOT EXISTS sim_jinang_effects (
  id              SERIAL PRIMARY KEY,
  run_id          TEXT NOT NULL,
  team_id         TEXT NOT NULL,
  member_id       TEXT NOT NULL,
  persona_id      CHAR(1),
  jinang_tech_id  TEXT,                    -- 技术锦囊 card_id
  jinang_tech_name TEXT,
  jinang_match_strength REAL,              -- 0-1
  -- 受影响的 R&D 能力卡
  cap_id          TEXT,
  cap_name        TEXT,
  dimension       TEXT,                    -- 'interaction', 'safety' 等
  tier            TEXT,                    -- 'low'/'mid'/'high'
  -- 折扣效果
  original_dCOGS  REAL,
  discounted_dCOGS REAL,
  dCOGS_saving    REAL,                    -- original - discounted
  original_risk   REAL,
  discounted_risk REAL,
  risk_saving     REAL,
  created_at      TIMESTAMP DEFAULT NOW()
);
```

### 8.2 CSV 汇总表（4 张）

CSV 用于快速浏览和做图表，是 PG 表的扁平化版本。

**CSV 1：`students_summary.csv`（60 行）**

```
run_id, team_index, member_index, name, persona, gender, mbti, age, education, industry,
jinang_market, jinang_tech, jinang_market_match, jinang_tech_match,
r1_grid, r1_arch, r1_gm_max,
r1_who, r1_pain, r1_how,
r2_dims, r2_interview_turns,
r2_evi, r2_evidence_count, r2_strong_dim_count, r2_missing_dim_count,
r2_radar_perception, r2_radar_motion, r2_radar_interaction, r2_radar_safety, r2_radar_extension, r2_radar_maintenance,
r2_cards_selected, r2_high_tier_count, r2_jinang_dCOGS_saved
```

**CSV 2：`teams_summary.csv`（10 行）**

```
run_id, team_index, grid, arch,
r1_wtp_ref, r1_sam_billion, r1_rho_c, r1_wtp_multiplier,
gm_max, market_space,
vp_C, vp_G, vp_E,
vp_who_specificity, vp_pain_has_trigger, vp_how_has_mechanism, vp_coach_turns_total,
vp_iterations, vp_initial_score, vp_final_score, vp_improvement_pct,
r2_cards, r2_dCOGS, r2_NRE, r2_budget_utilization, r2_high_tier_count, r2_violation_count,
r2_price, r2_price_vs_wtp, r2_gross_margin,
r2_share, r2_units, r2_profit_hw, r2_profit_sub, r2_profit, r2_is_profitable,
jinang_dCOGS_saved_total, total_llm_calls, total_tokens
```

**CSV 3：`vp_iterations.csv`（~50 行）**

```
run_id, team_index, iteration, trigger, speaker_persona, speaker_name,
vp_who, vp_pain, vp_how,
score_C, score_G, score_E, score_product,
who_changed, pain_changed, how_changed
```

**CSV 4：`jinang_effects.csv`**

```
run_id, team_index, member_name, persona, jinang_tech_name, match_strength,
cap_id, cap_name, dimension, tier,
original_dCOGS, discounted_dCOGS, saving, original_risk, discounted_risk, risk_saving
```

### 8.3 导出实现

```javascript
// data_export.js

const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

class DataExporter {
  constructor(runId, outDir) {
    this.runId = runId;
    this.outDir = outDir;
    this.pool = new Pool();  // 用环境变量配置
  }

  /**
   * 写入 PG + 生成 CSV
   * @param trackers - DecisionTracker[] (10 个，每队一个)
   * @param allStudents - 60 人的人设
   */
  async exportAll(trackers, allStudents) {
    fs.mkdirSync(this.outDir, { recursive: true });

    // 1. 建表（IF NOT EXISTS）
    await this.createTables();

    // 2. 写 sim_students（60 行）
    const studentsRows = [];
    for (const tracker of trackers) {
      for (const [memberId, m] of Object.entries(tracker.members)) {
        const row = {
          run_id: this.runId,
          team_id: tracker.teamId,
          team_index: tracker.teamIndex,
          ...m,  // 所有字段
        };
        await this.insertStudent(row);
        studentsRows.push(row);
      }
    }
    this.writeCsv('students_summary.csv', studentsRows, STUDENT_CSV_COLUMNS);

    // 3. 写 sim_teams（10 行）
    const teamRows = [];
    for (const tracker of trackers) {
      const row = this.buildTeamRow(tracker);
      await this.insertTeam(row);
      teamRows.push(row);
    }
    this.writeCsv('teams_summary.csv', teamRows, TEAM_CSV_COLUMNS);

    // 4. 写 sim_vp_iterations
    const vpRows = [];
    for (const tracker of trackers) {
      for (const iter of tracker.team.vpIterations) {
        const row = { run_id: this.runId, team_id: tracker.teamId, team_index: tracker.teamIndex, ...iter };
        await this.insertVPIteration(row);
        vpRows.push(row);
      }
    }
    this.writeCsv('vp_iterations.csv', vpRows, VP_CSV_COLUMNS);

    // 5. 写 sim_jinang_effects
    const jinangRows = [];
    for (const tracker of trackers) {
      for (const [memberId, m] of Object.entries(tracker.members)) {
        for (const effect of (m.jinang_tech_applied || [])) {
          const row = {
            run_id: this.runId,
            team_id: tracker.teamId,
            member_id: memberId,
            persona_id: m.persona,
            jinang_tech_id: m.jinang_tech?.card_id,
            jinang_tech_name: m.jinang_tech?.name,
            jinang_match_strength: m.jinang_tech_match,
            ...effect,
            dCOGS_saving: (effect.original_dCOGS || 0) - (effect.discounted_dCOGS || 0),
            risk_saving: (effect.original_risk || 0) - (effect.discounted_risk || 0),
          };
          await this.insertJinangEffect(row);
          jinangRows.push(row);
        }
      }
    }
    this.writeCsv('jinang_effects.csv', jinangRows, JINANG_CSV_COLUMNS);

    await this.pool.end();
    return { studentsRows: studentsRows.length, teamRows: teamRows.length, vpRows: vpRows.length, jinangRows: jinangRows.length };
  }

  writeCsv(filename, rows, columns) {
    if (rows.length === 0) {
      fs.writeFileSync(path.join(this.outDir, filename), columns.join(',') + '\n');
      return;
    }
    const header = columns.join(',');
    const lines = rows.map(r =>
      columns.map(col => {
        const val = r[col];
        if (val === null || val === undefined) return '';
        if (typeof val === 'object') return `"${JSON.stringify(val).replace(/"/g, '""')}"`;
        if (typeof val === 'string' && (val.includes(',') || val.includes('"') || val.includes('\n')))
          return `"${val.replace(/"/g, '""')}"`;
        return val;
      }).join(',')
    );
    fs.writeFileSync(path.join(this.outDir, filename), [header, ...lines].join('\n') + '\n');
  }

  // insertStudent, insertTeam, insertVPIteration, insertJinangEffect
  // 都是标准的 INSERT INTO ... VALUES (...) ON CONFLICT DO NOTHING
  // Codex 实现时按上面的 CREATE TABLE 字段顺序对应即可
}
```

### 8.4 在主入口中调用

```javascript
// persona_sim_test.js 末尾
const { DataExporter } = require('./sim/data_export');

// ... 测试跑完后 ...

const exporter = new DataExporter(runId, outDir);
const exportResult = await exporter.exportAll(trackers, allStudents);

console.log(`\n💾 数据导出完成:`);
console.log(`   PostgreSQL: sim_students(${exportResult.studentsRows}), sim_teams(${exportResult.teamRows}), sim_vp_iterations(${exportResult.vpRows}), sim_jinang_effects(${exportResult.jinangRows})`);
console.log(`   CSV: ${outDir}/students_summary.csv, teams_summary.csv, vp_iterations.csv, jinang_effects.csv`);
```

---

## 9. 额外验证（persona 测试特有）

### 9.1 VP 质量区分度检查

测试结束后，从 `sim_teams` 表查询：

```sql
-- 各原型的初始 VP 得分 vs 最终 VP 得分
SELECT s.persona_label,
       AVG(t.vp_initial_score) as avg_initial,
       AVG(t.vp_final_score) as avg_final,
       AVG(t.vp_improvement) as avg_improvement
FROM sim_teams t
JOIN sim_students s ON t.team_id = s.team_id AND s.member_index = 0
WHERE t.run_id = '{runId}'
GROUP BY s.persona_label;
```

预期：B（职业经理人）平均分 > E（体制转型者），如果差异不明显说明 VP 评分系统区分度不够。

### 9.2 锦囊影响力分析

```sql
-- 技术锦囊匹配度 vs 实际节省的 dCOGS
SELECT persona_label, jinang_tech_name, jinang_match_strength,
       SUM(dCOGS_saving) as total_dCOGS_saved,
       COUNT(*) as cards_affected
FROM sim_jinang_effects j
JOIN sim_students s ON j.member_id = s.member_id AND j.run_id = s.run_id
WHERE j.run_id = '{runId}'
GROUP BY persona_label, jinang_tech_name, jinang_match_strength;
```

### 9.3 VP 迭代效率分析

```sql
-- 哪种原型发言后 VP 改进最大
SELECT speaker_persona, COUNT(*) as total_turns,
       SUM(CASE WHEN who_changed THEN 1 ELSE 0 END) as who_changes,
       SUM(CASE WHEN pain_changed THEN 1 ELSE 0 END) as pain_changes,
       SUM(CASE WHEN how_changed THEN 1 ELSE 0 END) as how_changes
FROM sim_vp_iterations
WHERE run_id = '{runId}' AND speaker_persona IS NOT NULL
GROUP BY speaker_persona;
```

### 9.4 访谈质量按原型分析（新增）

```sql
-- 哪种原型访谈做得最好（evi 最高、证据最多）
SELECT s.persona_label,
       AVG(s.r2_evi) as avg_evi,
       AVG(s.r2_evidence_count) as avg_evidence,
       AVG(s.r2_strong_dim_count) as avg_strong_dims,
       AVG(s.r2_missing_dim_count) as avg_missing_dims,
       AVG(s.r2_interview_turns) as avg_turns
FROM sim_students s
WHERE s.run_id = '{runId}' AND s.r2_evi IS NOT NULL
GROUP BY s.persona_label
ORDER BY avg_evi DESC;
```

预期：F（销售铁军）和 C（技术创业者）evi 偏高，D（二代）和 E（体制）偏低。

### 9.5 VP 诊断按原型分析（新增）

```sql
-- 哪种原型的 VP 最容易缺哪个要素
SELECT s.persona_label,
       AVG(t.vp_who_specificity) as avg_who,
       AVG(t.vp_pain_has_trigger) as avg_pain_trigger,
       AVG(t.vp_how_has_mechanism) as avg_how_mechanism
FROM sim_teams t
JOIN sim_students s ON t.team_id = s.team_id AND s.member_index = 0
WHERE t.run_id = '{runId}'
GROUP BY s.persona_label;
```

预期：C（技术创业者）的 how_mechanism 最高但 who_specificity 最低；E（体制）三项都低。

### 9.6 选卡激进度 vs 利润（新增）

```sql
-- 堆高档卡 vs 最终利润的关系
SELECT t.team_index, t.r2_high_tier_count, t.r2_budget_utilization,
       t.r2_gross_margin, t.r2_profit, t.r2_is_profitable
FROM sim_teams t
WHERE t.run_id = '{runId}'
ORDER BY t.r2_high_tier_count DESC;
```

### 9.7 定价策略 vs 结果（新增）

```sql
-- 定价激进度 vs 销量和利润
SELECT t.team_index, t.r2_price, t.r2_price_vs_wtp,
       t.r2_units, t.r2_share, t.r2_gross_margin, t.r2_profit,
       t.r2_is_profitable
FROM sim_teams t
WHERE t.run_id = '{runId}'
ORDER BY t.r2_price_vs_wtp DESC;
```

### 9.8 定价差异检查

```sql
-- 各原型的最终定价对比（从 team 表取，按队内主要原型分类）
SELECT s.persona_label, AVG(t.r2_price) as avg_price, 
       MIN(t.r2_price) as min_price, MAX(t.r2_price) as max_price
FROM sim_teams t
JOIN sim_students s ON t.team_id = s.team_id AND s.member_index = 0
WHERE t.run_id = '{runId}'
GROUP BY s.persona_label;
```

### 9.9 访谈风格差异检查

```javascript
function analyzeInterviewStyleByPersona(logs) {
  // 从日志中提取每个学生的访谈提问
  // 预期：
  // C（技术创业者）的提问中技术术语出现频率更高
  // F（销售铁军）的提问中"买""推荐""价格"出现频率更高
  // E（体制转型者）的提问中"政策""服务""社区"出现频率更高
}
```

---

## 10. 输出文件结构

```
data/persona_sim_logs/
  2026-03-18T15-00-00/
    student_roster.json        ← 60 人完整人设
    report.json                ← pass/fail + persona 维度分析
    all_entries.json           ← 全量 API + LLM 日志
    by_team/
      team_xxx.json            ← 每队日志
    students_summary.csv       ← 60 人汇总（人设 + 锦囊 + 选择 + 匹配度）
    teams_summary.csv          ← 10 队汇总（VP评分 + 经济结果 + 锦囊效果）
    vp_iterations.csv          ← VP 迭代历史（~50 行）
    jinang_effects.csv         ← 锦囊对选卡的折扣效果

PostgreSQL:
    sim_students               ← 60 行明细
    sim_teams                  ← 10 行明细
    sim_vp_iterations          ← ~50 行 VP 迭代
    sim_jinang_effects         ← 锦囊折扣明细
```

---

## 11. 运行方式

```bash
# 快速验证（3 队）
NUM_TEAMS=3 TEAM_SIZE=6 node scripts/persona_sim_test.js

# 满载（10 队 × 6 人 = 60 个 AI 学生）
NUM_TEAMS=10 TEAM_SIZE=6 node scripts/persona_sim_test.js

# 低并发（避免 DeepSeek 限流）
CONCURRENCY=2 NUM_TEAMS=10 node scripts/persona_sim_test.js
```

---

## 12. 不要动的东西

- `server/` 下所有文件
- 基础测试（`CODEX_AI_SIMULATION_TEST.md`）的文件
- `game_config_v0.1/` 下所有 JSON
- 前端代码
- 现有数据库 schema（只新建 4 张 `sim_*` 表，不改已有表）

## 13. 验证标准

- 60 个 AI 学生的人设清单（`student_roster.json`）中：7 个原型全覆盖、男女比例约 3:1、MBTI 分布合理
- 全流程 10 队跑通无报错
- 日志中每条记录带 `personaId` 和 `personaLabel`
- 不同原型的 VP 文本风格有明显差异（人工抽检 2-3 队）
- VP Coach 对 3 轮不同原型发言者的回复都合理
- 定价分布：草根老板和销售铁军的定价中位数 > 体制转型者和互联网PM
- **锦囊追踪**：`students_summary.csv` 中每人有 `jinang_market` 和 `jinang_tech` 非空，`jinang_match` 在 [0,1] 区间
- **VP 迭代**：`vp_iterations.csv` 中每队有 4-5 行，`iteration` 从 0 递增，至少一行 `scores` 非空
- **VP 诊断**：`teams_summary.csv` 中 `vp_who_specificity`、`vp_pain_has_trigger`、`vp_how_has_mechanism` 非空且在 [0,2] 区间
- **访谈质量**：`students_summary.csv` 中 `r2_evi` 值应分散（标准差 > 0.05），不应所有人都是同一个值；`r2_evidence_count` 和 `r2_strong_dim_count` 非空
- **选卡中间值**：`teams_summary.csv` 中 `r2_budget_utilization` 在 [0, 1.5] 区间；`r2_high_tier_count` 为非负整数
- **定价中间值**：`teams_summary.csv` 中 `r2_price_vs_wtp` 非空；`r2_gross_margin` 在 [-0.5, 0.8] 区间（允许亏损）
- **最终结果**：`teams_summary.csv` 中 `r2_is_profitable` 有 true 也有 false（不应全部盈利或全部亏损）
- **数据导出**：4 张 CSV 文件均可用 Excel 打开、无乱码；4 张 PG 表均有数据、`run_id` 一致
- **SQL 验证**：section 9 中的 9 个查询都能跑通并返回合理结果
