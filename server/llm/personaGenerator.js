// personaGenerator.js - 基于 VP Canvas 和策略参数生成客户 Persona
const { chatCompletion } = require("./deepseekClient");
const { withLlmLogging } = require("./llm_logger");

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

/**
 * 第二层：在约束范围内随机生成具体 Persona
 */
async function generatePersona(vpCanvas, strategy) {
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

module.exports = { generatePersona, formatPersonaCard };
