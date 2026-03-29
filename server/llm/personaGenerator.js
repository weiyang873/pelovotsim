// personaGenerator.js - 基于 VP Canvas 和策略参数生成客户 Persona
const { chatCompletion } = require("./deepseekClient");
const { withLlmLogging } = require("./llm_logger");

let personaCallCount = 0;

function parseJsonLoose(raw) {
  const t = String(raw || "").replace(/```json|```/g, "").trim();
  try {
    return JSON.parse(t);
  } catch (_) {}
  const l = t.indexOf("{");
  const r = t.lastIndexOf("}");
  if (l >= 0 && r > l) {
    return JSON.parse(t.slice(l, r + 1));
  }
  throw new Error("json parse failed");
}

/**
 * 第一层：从 VP Canvas 提取语义约束
 */
async function extractVpConstraints(vpCanvas, strategy) {
  const canvasText = formatCanvas(vpCanvas);

  const messages = [
    {
      role: "system",
      content: "你是一个需求分析助手。请从学生的 Value Proposition Canvas 中提取目标客户的约束条件，输出严格的 JSON，不要有任何其他文字。"
    },
    {
      role: "user",
      content: `以下是学生的 VP Canvas：\n${canvasText}\n\n策略参数：\n- 客户类型：${strategy.market}\n- 年龄段标签：${strategy.segment}\n- 竞争策略：${strategy.competitive}\n- 产品架构：${strategy.architecture}\n\n请提取目标客户约束，输出以下 JSON 格式：\n{\n  "age_range": [最小年龄, 最大年龄],\n  "living_situations": ["可能的居住情况列表"],\n  "key_pains": ["从VP中提取的核心痛点，最多4条"],\n  "key_jobs": ["从VP中提取的核心任务，最多3条"],\n  "context_clues": ["其他重要线索，如职业/家庭状况等"]\n}\n\n年龄范围判断参考：\n- "儿童"→ [3, 12]，"青少年"→ [13, 18]\n- "成人/年轻人"→ [22, 40]，"中年"→ [35, 55]\n- "初老/初级老年"→ [55, 70]，"老年/老人"→ [65, 85]\n- 如学生有更具体描述（如"35岁白领"），以学生描述为准`
    }
  ];

  const raw = await withLlmLogging({
    caller: "personaGenerator.extractConstraints",
    teamId: strategy?.teamId || strategy?.team_id || strategy?.teamKey || null,
    memberId: null,
    messages
  }, () => chatCompletion(messages, { temperature: 0.2, max_tokens: 400 }));

  try {
    return parseJsonLoose(raw);
  } catch (_) {
    return buildFallbackConstraints(strategy);
  }
}

function buildFallbackConstraints(strategy) {
  const seg = String(strategy.segment || "").toLowerCase();
  let age_range = [25, 50];
  if (seg.includes("儿童")) age_range = [3, 12];
  else if (seg.includes("初老")) age_range = [55, 70];
  else if (seg.includes("老")) age_range = [65, 85];
  else if (seg.includes("成人")) age_range = [22, 45];

  return {
    age_range,
    living_situations: ["独居", "与家人同住"],
    key_pains: ["需要陪伴", "生活有压力"],
    key_jobs: ["希望生活更便利"],
    context_clues: []
  };
}

function logPersonaCall(source, strategy) {
  const safeStrategy = strategy && typeof strategy === "object" ? strategy : {};
  const previousPersonas = Array.isArray(safeStrategy.previousPersonas) ? safeStrategy.previousPersonas : [];
  console.log("[personaGenerator]", source, {
    teamId: safeStrategy.teamId || safeStrategy.team_id || safeStrategy.teamKey || null,
    who_raw: String(safeStrategy.who_raw || "").trim() || null,
    gridLabel: String(safeStrategy.gridLabel || "").trim() || null,
    isToB: safeStrategy.isToB === true,
    previousPersonasCount: previousPersonas.length,
    previousPersonas: previousPersonas.map((item) => ({
      name: String(item?.name || "").trim() || null,
      title: String(item?.title || item?.occupation || "").trim() || null
    }))
  });
}

function buildPersonaPrompt(context) {
  const safeContext = context && typeof context === "object" ? context : {};
  const gridLabel = String(safeContext.gridLabel || "").trim();
  const whoRaw = String(safeContext.who_raw || "").trim();
  const architectureLabel = String(safeContext.architectureLabel || "").trim();
  const isToB = safeContext.isToB === true;
  const previousPersonas = Array.isArray(safeContext.previousPersonas) ? safeContext.previousPersonas : [];
  const previousSummary = previousPersonas.map((p) => `${p.name || "未命名"}，${p.title || p.occupation || "访谈对象"}`).join("；");
  const previousLine = previousPersonas.length
    ? (isToB
        ? `\n已生成的前序 persona：${previousSummary}\n请生成一个不同的变体——同类决策者但机构规模/处境/性格不同。\n`
        : `\n已生成的前序 persona：${previousSummary}\n请生成一个不同的变体——同类目标客户，但职业、生活状态、触发事件或消费习惯不同。\n`)
    : "\n";

  if (isToB) {
    return `你需要为一个商业模拟游戏生成一个用户访谈对象画像。

学生在 Round 1 定义的目标客户是："${whoRaw}"
市场定位：${gridLabel}
产品方向：${architectureLabel}

这是 ToB（企业/机构）市场。访谈对象必须是这类机构的**决策者或采购负责人**，不是终端使用者。${previousLine}
生成一个具体的机构负责人画像，包含：
- 姓名（中文，姓 + 职位称呼，如"张院长""李总监"）
- 年龄（35-55岁）
- 职位和角色（必须是有采购决策权或影响力的人）
- 所在机构的类型和规模（具体数字：床位数/员工数/门店数等）
- 当前面临的 2-3 个运营压力（必须跟 who_raw 里描述的处境一致）
- 采购预算范围和决策流程（谁审批、流程多长）
- 一个让这个人愿意认真聊的具体触发事件（最近发生的事）

不要生成终端使用者（老人、孩子、普通员工）。
不要生成泛泛的描述，要有具体数字和细节。

输出为 JSON 格式：
{
  "name": "张院长",
  "age": 48,
  "title": "运营副院长",
  "org_type": "民营养老院",
  "org_scale": "120张床位，护工团队15人",
  "pressures": ["护工流失率高，最近三个月走了3人", "夜间只有2人值班覆盖不了所有楼层", "去年发生一次夜间跌倒未及时发现的事故"],
  "budget": "年度设备采购预算50万，超过20万需集团审批",
  "trigger": "上个月卫健委检查指出夜间巡检记录不完整，限期整改",
  "personality": "务实，关注ROI，对新技术持谨慎态度但愿意试点",
  "background": "护理专业出身，在这家养老院干了8年，从护士长升到副院长"
}`;
  }

  return `你需要为一个商业模拟游戏生成一个用户访谈对象画像。

学生在 Round 1 定义的目标客户是："${whoRaw}"
市场定位：${gridLabel}
产品方向：${architectureLabel}

这是 ToC（个人消费者）市场。访谈对象就是目标客户本人。${previousLine}
生成一个具体的个人画像，包含：
- 姓名（中文，随机但合理）
- 年龄（必须跟 who_raw 描述的人群一致）
- 职业和工作状态
- 家庭结构和居住状态
- 日常生活中跟产品相关的 2-3 个具体场景
- 消费习惯和价格敏感度
- 一个让这个人愿意认真聊的具体触发事件

不要生成机构负责人或企业采购。
不要生成泛泛的描述，要有具体细节。

输出为 JSON 格式：
{
  "name": "林小雨",
  "age": 28,
  "title": "互联网公司产品经理",
  "living_situation": "一线城市独居，租住一居室",
  "family": "单身，父母在老家",
  "daily_scenes": ["每天加班到9点，回家只有冰箱声", "周末宅家刷手机，偶尔跟朋友聚餐", "养过猫但出差多送人了"],
  "spending": "月入2万，愿意为提升生活品质花钱，但对超过5000的非必需品会犹豫",
  "trigger": "上周生病发烧一个人在家躺了两天，没人知道",
  "personality": "外向但社交疲惫，想要陪伴但不想维护关系",
  "background": "985本科毕业4年，换过两份工作，目前这份比较稳定但加班多"
}`;
}

function normalizeRound1Persona(persona, context) {
  const raw = persona && typeof persona === "object" ? persona : {};
  const safeContext = context && typeof context === "object" ? context : {};
  const isToB = safeContext.isToB === true;
  const name = String(raw.name || "访谈对象").trim();
  const age = Number.isFinite(Number(raw.age)) ? Number(raw.age) : null;

  if (isToB) {
    const title = String(raw.title || raw.occupation || "机构负责人").trim();
    const orgType = String(raw.org_type || "机构").trim();
    const orgScale = String(raw.org_scale || "规模待补充").trim();
    const pressures = Array.isArray(raw.pressures) ? raw.pressures.filter(Boolean).map(String) : [];
    const personality = String(raw.personality || "").trim();
    const background = String(raw.background || "").trim();
    const budget = String(raw.budget || "").trim();
    const trigger = String(raw.trigger || "").trim();
    return {
      id: String(raw.id || `${name}_${title}_${orgType}` || "persona").trim().replace(/\s+/g, "_"),
      name,
      age: age || 45,
      title,
      occupation: title,
      org_type: orgType,
      org_scale: orgScale,
      living_situation: `${orgType}，${orgScale}`,
      pressures,
      budget,
      trigger,
      personality,
      background,
      desc: [title, orgType, personality].filter(Boolean).join("，")
    };
  }

  const title = String(raw.title || raw.occupation || "个人消费者").trim();
  const living = String(raw.living_situation || "").trim();
  const family = String(raw.family || "").trim();
  const dailyScenes = Array.isArray(raw.daily_scenes) ? raw.daily_scenes.filter(Boolean).map(String) : [];
  const spending = String(raw.spending || "").trim();
  const personality = String(raw.personality || "").trim();
  const background = String(raw.background || "").trim();
  const trigger = String(raw.trigger || "").trim();
  return {
    id: String(raw.id || `${name}_${title}_${age || ""}` || "persona").trim().replace(/\s+/g, "_"),
    name,
    age: age || 30,
    title,
    occupation: title,
    living_situation: living,
    family,
    daily_scenes: dailyScenes,
    spending,
    trigger,
    personality,
    background,
    desc: [title, family || living, personality].filter(Boolean).join("，")
  };
}

/**
 * 第二层：在约束范围内随机生成具体 Persona
 */
async function generatePersona(vpCanvas, strategy) {
  logPersonaCall("generatePersona:entry", strategy);
  const round1Who = String(strategy?.who_raw || "").trim();
  const round1GridLabel = String(strategy?.gridLabel || "").trim();
  personaCallCount += 1;
  console.log(`[persona] 第${personaCallCount}个, who_raw:`, round1Who || null, "grid:", round1GridLabel || null);
  if (round1Who && round1GridLabel) {
    const prompt = buildPersonaPrompt(strategy);
    const messages = [
      {
        role: "system",
        content: "你是一个用户研究专家，擅长创建真实可信的用户画像。请输出严格的 JSON，不要有任何其他文字。"
      },
      {
        role: "user",
        content: prompt
      }
    ];

    const raw = await withLlmLogging({
      caller: "personaGenerator.generate",
      teamId: strategy?.teamId || strategy?.team_id || strategy?.teamKey || null,
      memberId: null,
      messages
    }, () => chatCompletion(messages, { temperature: 0.7, max_tokens: 700 }));

    try {
      const persona = normalizeRound1Persona(parseJsonLoose(raw), strategy);
      persona.constraints = { who_raw: round1Who, gridLabel: round1GridLabel };
      return persona;
    } catch (_) {
      throw new Error("Persona 生成失败，请重试");
    }
  }

  console.log("[personaGenerator] generatePersona:fallback_without_round1_context", {
    teamId: strategy?.teamId || strategy?.team_id || strategy?.teamKey || null,
    who_raw: round1Who || null,
    gridLabel: round1GridLabel || null,
    isToB: strategy?.isToB === true,
    previousPersonasCount: Array.isArray(strategy?.previousPersonas) ? strategy.previousPersonas.length : 0
  });

  const constraints = await extractVpConstraints(vpCanvas, strategy);

  const ageMin = Number(constraints.age_range?.[0] ?? 25);
  const ageMax = Number(constraints.age_range?.[1] ?? 50);
  const age = Math.floor(Math.random() * (ageMax - ageMin + 1)) + ageMin;

  const messages = [
    {
      role: "system",
      content: "你是一个用户研究专家，擅长创建真实可信的用户画像。请输出严格的 JSON，不要有任何其他文字。"
    },
    {
      role: "user",
      content: `请基于以下约束，生成一个用于客户访谈模拟的真实 Persona。\n\n约束条件：\n- 年龄：${age}岁\n- 客户类型：${strategy.market}\n- 居住情况候选：${(constraints.living_situations || []).join("/")}\n- 核心痛点（至少要体现其中1-2个）：${(constraints.key_pains || []).join("、")}\n- 核心任务：${(constraints.key_jobs || []).join("、")}\n- 其他线索：${(constraints.context_clues || []).join("、")}\n\n输出以下 JSON 格式：\n{\n  "name": "真实中文姓名",\n  "age": ${age},\n  "occupation": "职业",\n  "living_situation": "居住情况",\n  "personality": "性格描述（2句话）",\n  "daily_routine": "典型的一天（2-3句话）",\n  "pains": ["具体痛点1", "具体痛点2", "具体痛点3"],\n  "hidden_pain": "最深层的痛点，访谈中不会主动说，需要学生追问才能挖出",\n  "desires": ["表面需求1", "表面需求2", "表面需求3"],\n  "tech_comfort": "对科技产品的态度（一句话）",\n  "contradictions": ["矛盾点1（比如：想要简单，又想要功能多）", "矛盾点2"],\n  "interview_style": "访谈时的沟通风格（比如：话很多但容易跑题/沉默寡言需要追问）"\n}`
    }
  ];

  const raw = await withLlmLogging({
    caller: "personaGenerator.generate",
    teamId: strategy?.teamId || strategy?.team_id || strategy?.teamKey || null,
    memberId: null,
    messages
  }, () => chatCompletion(messages, { temperature: 0.9, max_tokens: 600 }));

  try {
    const persona = parseJsonLoose(raw);
    persona.constraints = constraints;
    return persona;
  } catch (_) {
    throw new Error("Persona 生成失败，请重试");
  }
}

function formatPersonaCard(persona) {
  return `**${persona.name}，${persona.age}岁**\n${persona.occupation} | ${persona.living_situation}\n\n${persona.personality}\n\n典型的一天：${persona.daily_routine}\n\n科技态度：${persona.tech_comfort}`;
}

function formatCanvas(canvas) {
  if (!canvas) return "（未提供）";
  if (typeof canvas === "string") return canvas;
  return [
    `Customer Jobs：${canvas.customerJobs || ""}`,
    `Pains：${canvas.pains || ""}`,
    `Gains：${canvas.gains || ""}`,
    `Products & Services：${canvas.products || ""}`,
    `Pain Relievers：${canvas.painRelievers || ""}`,
    `Gain Creators：${canvas.gainCreators || ""}`
  ].join("\n");
}

module.exports = {
  generatePersona,
  formatPersonaCard,
  buildPersonaPrompt,
  normalizeRound1Persona
};
