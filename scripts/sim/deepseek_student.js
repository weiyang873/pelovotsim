"use strict";

const { chatCompletion } = require("../../server/llm/deepseekClient");

const TEAM_STRATEGIES = [
  { grid_id: "ToC_Differentiation_Adult", architecture: "Experience", desc: "ToC × 差异化 × 成人" },
  { grid_id: "ToB_Differentiation_Elder", architecture: "Experience", desc: "ToB × 差异化 × 老人" },
  { grid_id: "ToC_Cost_Child", architecture: "Hybrid", desc: "ToC × 成本 × 儿童" },
  { grid_id: "ToB_Cost_Elder", architecture: "Function", desc: "ToB × 成本 × 老人" },
  { grid_id: "ToC_Differentiation_Child", architecture: "Experience", desc: "ToC × 差异化 × 儿童" },
  { grid_id: "ToB_Differentiation_Adult", architecture: "Hybrid", desc: "ToB × 差异化 × 成人" },
  { grid_id: "ToC_Cost_Adult", architecture: "Function", desc: "ToC × 成本 × 成人" },
  { grid_id: "ToC_Differentiation_Elder", architecture: "Experience", desc: "ToC × 差异化 × 老人" },
  { grid_id: "ToB_Cost_Child", architecture: "Hybrid", desc: "ToB × 成本 × 儿童" },
  { grid_id: "ToB_Cost_Adult", architecture: "Function", desc: "ToB × 成本 × 成人" }
];

const DIM_LABELS = {
  interaction: "交互与表达",
  perception: "感知与理解",
  motion: "运动与导航",
  safety: "安全与信任",
  extend: "可扩展与连接",
  ops: "可运营与可维护"
};

const FALLBACK_CHAT_REPLIES = [
  "我认同这个方向，但 WHO 还可以再收窄一点，否则后面验证会比较散。",
  "痛点最好落到具体情境，比如回家、夜间独处或者照护交接时刻。",
  "HOW 里可以把主动陪伴和可持续使用这两个机制讲得更清楚。"
];

let lastDeepSeekAt = 0;

function strategyForTeam(teamIndex) {
  return TEAM_STRATEGIES[Math.abs(Number(teamIndex) || 0) % TEAM_STRATEGIES.length];
}

function parseGrid(gridId) {
  const raw = String(gridId || "").toUpperCase();
  return {
    channel: raw.includes("TOB") || raw.includes("B2B") ? "ToB" : "ToC",
    age: raw.includes("ELDER") ? "elder" : raw.includes("CHILD") ? "child" : "adult",
    strategy: raw.includes("COST") ? "cost" : "diff"
  };
}

function buildFallbackPhase1(gridId, architecture) {
  const parsed = parseGrid(gridId);
  const isToB = parsed.channel === "ToB";
  const isDiff = parsed.strategy === "diff";

  if (parsed.age === "elder") {
    return {
      grid_id: gridId,
      architecture,
      who: isToB
        ? "高端养老机构的院长与运营负责人，核心使用者是需要稳定陪伴和异常提醒的老人"
        : "一二线城市愿意为父母购买陪伴型机器人的中高收入子女家庭",
      pain: isToB
        ? "老人独处和护工忙碌交替出现时，机构很难持续提供有温度又能及时发现异常的陪伴服务"
        : "家属担心老人独自在家时情绪低落或发生小意外，但又不希望引入复杂难用的设备",
      how: isDiff
        ? "LOVOT 通过主动靠近、情绪互动和异常提醒，把情感陪伴与轻量守护放进同一个产品体验里"
        : "LOVOT 用更克制的功能组合提供基础陪伴、状态提醒和低学习成本体验，降低机构或家庭导入门槛"
    };
  }

  if (parsed.age === "child") {
    return {
      grid_id: gridId,
      architecture,
      who: isToB
        ? "素质教育机构和儿童成长中心的运营负责人，希望提升陪伴感和课堂互动质量"
        : "双职工家庭中 6-10 岁孩子的家长，希望孩子放学后有人陪伴和互动",
      pain: isToB
        ? "机构希望提升孩子到店后的参与感，但老师人力有限，很难持续制造高质量互动"
        : "孩子独处时容易无聊、分心或情绪波动，家长又不希望额外增加复杂照护负担",
      how: isDiff
        ? "LOVOT 通过自然互动、情绪回应和轻任务陪伴，让孩子在关键时段保持投入和安全感"
        : "LOVOT 以可控成本提供基础互动、简单陪伴和可复制体验，帮助家庭或机构先跑通场景"
    };
  }

  return {
    grid_id: gridId,
    architecture,
    who: isToB
      ? "酒店、公寓和服务型空间的运营负责人，希望提升空间温度和客户体验"
      : "一二线城市独居或小家庭的 25-40 岁白领，希望下班回家后有稳定陪伴",
    pain: isToB
      ? "服务空间想提升差异化体验，但真人服务成本高、稳定性也难控制"
      : "用户下班回家后情绪放松需求强，但养宠、请人或购买复杂设备的维护成本都偏高",
    how: isDiff
      ? "LOVOT 通过主动迎接、情绪识别和低负担互动，让陪伴感成为一个持续可感知的体验"
      : "LOVOT 用更聚焦的功能组合提供基础陪伴和低维护体验，让购买与使用门槛都更低"
  };
}

function buildInterviewFallback(turn, dims) {
  const labels = (Array.isArray(dims) ? dims : []).map((dim) => DIM_LABELS[dim] || dim).join("、");
  const list = [
    `先不聊功能，想先了解一下您在日常生活里最在意哪些时刻会觉得不方便，尤其和${labels || "使用体验"}有关。`,
    `刚才那个场景里，您最不能接受的问题是什么？如果只能先解决一件事，您会优先选哪一件？`,
    `如果是 LOVOT 这样的陪伴机器人介入，您会希望它在哪些地方帮到您，又有哪些边界是不能越过的？`,
    `从长期使用看，您更在意它稳定、省心，还是互动更丰富？为什么？`,
    `如果最后要为这个方案买单，什么表现会让您觉得值这个价，什么情况会让您直接放弃？`
  ];
  return list[Math.min(turn, list.length - 1)];
}

async function rateLimitedChat(messages, options) {
  const now = Date.now();
  const waitMs = Math.max(0, 220 - (now - lastDeepSeekAt));
  if (waitMs > 0) {
    await new Promise((resolve) => setTimeout(resolve, waitMs));
  }
  const text = await chatCompletion(messages, options);
  lastDeepSeekAt = Date.now();
  return text;
}

function parseJsonObject(text) {
  const raw = String(text || "").replace(/```json|```/g, "").trim();
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  const candidate = start >= 0 && end > start ? raw.slice(start, end + 1) : raw;
  return JSON.parse(candidate);
}

class DeepSeekStudent {
  constructor(options = {}) {
    this.apiKey = options.apiKey || process.env.DEEPSEEK_API_KEY || "";
    this.strictMode = options.strictMode === true || String(process.env.STRICT_DEEPSEEK || "").trim() === "1";
    this.logger = options.logger || null;
    this.teamId = options.teamId || null;
    this.memberId = options.memberId || null;
    this.personaId = options.personaId || null;
    this.personaLabel = options.personaLabel || null;
    this.teamIndex = Number(options.teamProfile?.teamIndex ?? options.teamIndex ?? 0);
    this.memberIndex = Number(options.teamProfile?.memberIndex ?? options.memberIndex ?? 0);
    this.memberName = String(options.teamProfile?.memberName || options.memberName || `成员${this.memberIndex + 1}`);
    this.primaryStrategy = options.teamStrategy || strategyForTeam(this.teamIndex);
  }

  logStudentLLM(entry) {
    if (!this.logger || typeof this.logger.logStudentLLM !== "function") return;
    this.logger.logStudentLLM({
      teamId: this.teamId,
      memberId: this.memberId,
      personaId: this.personaId,
      personaLabel: this.personaLabel,
      ...entry
    });
  }

  getStrategyVariant() {
    if (this.memberIndex <= 2) return this.primaryStrategy;
    if (this.memberIndex === 3) return this.primaryStrategy;
    return strategyForTeam(this.teamIndex + this.memberIndex);
  }

  async generatePhase1Choice(gridChoice = null) {
    const strategy = gridChoice || this.getStrategyVariant();
    const fallback = buildFallbackPhase1(strategy.grid_id, strategy.architecture);
    const messages = [
      { role: "system", content: "你是商学院 EMBA 学生，只输出 JSON。" },
      { role: "user", content: [
        "你是一个 EMBA 学生，正在参加 LOVOT 陪伴机器人的中国市场战略模拟。",
        "",
        `你选择了市场定位：${strategy.desc}`,
        `架构标签：${strategy.architecture}`,
        "",
        "请用中文写出你的初始 VP 草稿，包含三个部分：",
        "- WHO：目标客户是谁？",
        "- PAIN：他们面临什么痛点？",
        "- HOW：LOVOT 怎么解决这个痛点？",
        "",
        "要求：",
        "- 像一个有商业经验的 EMBA 学生的思考方式",
        "- 可以有盲区，这是初稿",
        "- 2-4 句话",
        "- 只输出 JSON，格式：{\"who\":\"...\",\"pain\":\"...\",\"how\":\"...\"}"
      ].join("\n") }
    ];
    const startedAt = Date.now();
    if (!this.apiKey) {
      if (this.strictMode) {
        throw new Error("STRICT_DEEPSEEK=1 but DEEPSEEK_API_KEY is missing");
      }
      this.logStudentLLM({
        step: "R1.3_generate_phase1",
        prompt: messages,
        completion: JSON.stringify(fallback),
        tokens: null,
        durationMs: Date.now() - startedAt,
        usedFallback: true
      });
      return fallback;
    }

    try {
      const completion = await rateLimitedChat(messages, { temperature: 0.8, max_tokens: 200 });
      const data = parseJsonObject(completion);
      const result = {
        grid_id: strategy.grid_id,
        architecture: strategy.architecture,
        who: String(data.who || fallback.who).trim(),
        pain: String(data.pain || fallback.pain).trim(),
        how: String(data.how || fallback.how).trim()
      };
      this.logStudentLLM({
        step: "R1.3_generate_phase1",
        prompt: messages,
        completion,
        tokens: null,
        durationMs: Date.now() - startedAt,
        usedFallback: false
      });
      return result;
    } catch (err) {
      if (this.strictMode) {
        throw new Error(`DeepSeek phase1 generation failed: ${err.message || err}`);
      }
      this.logStudentLLM({
        step: "R1.3_generate_phase1",
        prompt: messages,
        completion: JSON.stringify(fallback),
        tokens: null,
        durationMs: Date.now() - startedAt,
        usedFallback: true
      });
      return fallback;
    }
  }

  async generateVPChatReply(coachMessage, conversationHistory) {
    const strategy = this.primaryStrategy;
    const historyText = (Array.isArray(conversationHistory) ? conversationHistory : [])
      .slice(-6)
      .map((item) => `${item.role === "assistant" ? "教练" : "学生"}：${item.content}`)
      .join("\n");
    const prompt = [
      "你是 EMBA 学生，正在和 AI 教练讨论团队的 VP 方案。",
      `团队市场定位：${strategy.desc}`,
      historyText ? `对话历史：\n${historyText}` : "",
      `教练刚说：${JSON.stringify(String(coachMessage || ""))}`,
      "",
      "请用中文回复教练，推进 VP 讨论。",
      "1-3 句话，自然口语化，不要太正式。"
    ].filter(Boolean).join("\n\n");
    const messages = [
      { role: "system", content: "你是 EMBA 学生，用自然中文回复。" },
      { role: "user", content: prompt }
    ];
    const startedAt = Date.now();
    if (!this.apiKey) {
      if (this.strictMode) {
        throw new Error("STRICT_DEEPSEEK=1 but DEEPSEEK_API_KEY is missing");
      }
      const completion = FALLBACK_CHAT_REPLIES[(this.memberIndex + conversationHistory.length) % FALLBACK_CHAT_REPLIES.length];
      this.logStudentLLM({
        step: "R1.5_generate_vp_reply",
        prompt: messages,
        completion,
        tokens: null,
        durationMs: Date.now() - startedAt,
        usedFallback: true
      });
      return completion;
    }
    try {
      const out = await rateLimitedChat(messages, { temperature: 0.8, max_tokens: 200 });
      const completion = String(out || "").trim() || FALLBACK_CHAT_REPLIES[0];
      this.logStudentLLM({
        step: "R1.5_generate_vp_reply",
        prompt: messages,
        completion,
        tokens: null,
        durationMs: Date.now() - startedAt,
        usedFallback: false
      });
      return completion;
    } catch (err) {
      if (this.strictMode) {
        throw new Error(`DeepSeek VP chat failed: ${err.message || err}`);
      }
      const completion = FALLBACK_CHAT_REPLIES[(this.memberIndex + conversationHistory.length) % FALLBACK_CHAT_REPLIES.length];
      this.logStudentLLM({
        step: "R1.5_generate_vp_reply",
        prompt: messages,
        completion,
        tokens: null,
        durationMs: Date.now() - startedAt,
        usedFallback: true
      });
      return completion;
    }
  }

  async generateInterviewReply(personaMessage, conversationHistory, assignedDims) {
    const turn = (Array.isArray(conversationHistory) ? conversationHistory : []).filter((item) => item.role === "user").length;
    const dimText = (Array.isArray(assignedDims) ? assignedDims : [])
      .map((dim) => DIM_LABELS[dim] || dim)
      .join("、");
    const prompt = [
      "你是 EMBA 学生，正在对 LOVOT 的潜在用户做焦点访谈。",
      `你负责的产品维度：${dimText || "综合探索"}`,
      `用户刚说：${JSON.stringify(String(personaMessage || ""))}`,
      "",
      "请用中文继续追问。",
      "前两轮优先聊真实生活场景；第三轮开始可以自然带入 LOVOT 或陪伴机器人。",
      "1-2 句话。"
    ].join("\n");
    const messages = [
      { role: "system", content: "你是 EMBA 学生，用真实访谈口吻提问。" },
      { role: "user", content: prompt }
    ];
    const startedAt = Date.now();
    if (!this.apiKey) {
      if (this.strictMode) {
        throw new Error("STRICT_DEEPSEEK=1 but DEEPSEEK_API_KEY is missing");
      }
      const completion = buildInterviewFallback(turn, assignedDims);
      this.logStudentLLM({
        step: "R2.1_generate_interview_reply",
        prompt: messages,
        completion,
        tokens: null,
        durationMs: Date.now() - startedAt,
        usedFallback: true
      });
      return completion;
    }
    try {
      const out = await rateLimitedChat(messages, { temperature: 0.8, max_tokens: 200 });
      const completion = String(out || "").trim() || buildInterviewFallback(turn, assignedDims);
      this.logStudentLLM({
        step: "R2.1_generate_interview_reply",
        prompt: messages,
        completion,
        tokens: null,
        durationMs: Date.now() - startedAt,
        usedFallback: false
      });
      return completion;
    } catch (err) {
      if (this.strictMode) {
        throw new Error(`DeepSeek interview generation failed: ${err.message || err}`);
      }
      const completion = buildInterviewFallback(turn, assignedDims);
      this.logStudentLLM({
        step: "R2.1_generate_interview_reply",
        prompt: messages,
        completion,
        tokens: null,
        durationMs: Date.now() - startedAt,
        usedFallback: true
      });
      return completion;
    }
  }

  async generatePriceChoice(priceContext = {}) {
    const base = Number(priceContext.basePrice || priceContext.P || priceContext.Pmax || 12000);
    const strategy = this.primaryStrategy;
    const isDiff = parseGrid(strategy.grid_id).strategy === "diff";
    const factor = isDiff ? 0.96 : 0.89;
    const offset = ((this.teamIndex % 3) - 1) * 0.02;
    const price = Math.max(5000, Math.round(base * (factor + offset)));
    this.logStudentLLM({
      step: "R2.7_generate_price",
      prompt: [{ role: "system", content: "deterministic_price_rule" }, { role: "user", content: priceContext }],
      completion: String(price),
      tokens: null,
      durationMs: 0,
      usedFallback: true
    });
    return price;
  }
}

module.exports = {
  DeepSeekStudent,
  TEAM_STRATEGIES
};
