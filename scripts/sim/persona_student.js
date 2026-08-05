"use strict";

const { chatCompletion, hasAnyKey } = require("../../server/llm/deepseekClient");
const { getModel } = require("../../server/llm/modelRegistry");
const { logLLMCall } = require("../../server/llm/llm_logger");
const {
  getMBTIDescription
} = require("./persona_pool");
const {
  getFallbackChatReply,
  getFallbackInterviewReply,
  getFallbackVP
} = require("./persona_fallbacks");

const DIM_LABELS = {
  interaction: "交互与表达",
  interaction_expression: "交互与表达",
  perception: "感知与理解",
  perception_understanding: "感知与理解",
  motion: "运动与导航",
  mobility_navigation: "运动与导航",
  safety: "安全与信任",
  safety_trust: "安全与信任",
  extend: "可扩展与连接",
  expand_connect: "可扩展与连接",
  ops: "可运营与可维护",
  ops_maintenance: "可运营与可维护"
};

const INTERVIEW_DIMENSION_GUIDANCE = [
  "你在做用户访谈，以下是 6 个可以探索的维度方向，不用每个都问到，",
  "跟着对话自然走就好：",
  "1. 感知与理解：能不能认出人、理解环境",
  "2. 运动与导航：移动、跟随、避障",
  "3. 交互与表达：语音、触摸、情感表达",
  "4. 安全与信任：隐私、儿童安全、紧急情况",
  "5. 可扩展与连接：智能家居、内容更新",
  "6. 可运营与可维护：维修、升级、长期使用成本",
  "",
  "前 2-3 轮自由探索用户最关心的方向，",
  "后面的轮次可以主动探索还没聊到的维度。"
].join("\n");

let lastDeepSeekAt = 0;

function parseGrid(gridId) {
  const raw = String(gridId || "").toUpperCase();
  return {
    channel: raw.includes("TOB") || raw.includes("B2B") ? "ToB" : "ToC",
    age: raw.includes("ELDER") ? "老人" : raw.includes("CHILD") ? "儿童" : "成人",
    strategy: raw.includes("COST") ? "成本" : "差异化"
  };
}

function gridDescription(gridChoice) {
  const gridId = String(gridChoice?.grid_id || "");
  const parsed = parseGrid(gridId);
  return `${parsed.channel} × ${parsed.strategy} × ${parsed.age}`;
}

function buildBaseSystemPrompt(student) {
  const genderLabel = student.gender === "male" ? "男" : "女";
  return `你是一位正在读 EMBA 的中国商业人士，正在参加 AI 宠物机器人的中国市场战略模拟课程。

## 你的个人信息
- 姓名：${student.name}
- 原型：${student.label}
- 性别：${genderLabel}
- 年龄：${student.age}岁
- 学历：${student.education}
- 海外经历：${student.overseas?.hasOverseas ? `${student.overseas.destination}（${student.overseas.duration}）` : "无"}
- 身份：${student.role}
- 行业经验：${student.background}
- 所在行业：${student.industry}

## 你的表达能力
${student.expressionModifier || "你的文字表达与行业经验相符，既有个人风格，也可能不够完美。"}

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
- 可以有盲区和不完美，你不是专家
- 全程中文`;
}

function getVPLengthConstraint(education) {
  const value = String(education || "").trim();
  if (["中专/高中", "高中"].includes(value)) {
    return `

输出约束（非常重要）：
- 用一句大白话说你想做什么生意，不要分段
- WHO/PAIN/HOW 每个字段不超过 20 个字
- 不要用任何商业术语或框架
- 写出来应该像跟朋友聊天，不像写报告
- 示例风格："就是给养老院卖个能陪老人说话的机器人"`;
  }

  if (value === "大专") {
    return `

输出约束（重要）：
- 每个字段用 1-2 句话说，总共不超过 80 字
- 不要用商业术语，用日常用语
- 你可以写"老人""小孩""白领"这种大类，不需要精确细分
- 不需要分析替代方案或边界条件`;
  }

  if (["本科（非985）", "本科（国内）"].includes(value)) {
    return `

输出约束：
- 每个字段 2-3 句话
- 可以有基本框架但不需要很精细
- 不需要引用数据或案例`;
  }

  return "";
}

function stripVPLengthConstraint(text) {
  return String(text || "").replace(/\n{0,2}输出约束(?:（[^）]*）)?：[\s\S]*$/u, "").trimEnd();
}

function extractPriceFromJsonCompletion(completion) {
  const text = String(completion || "").trim();
  if (!text) return null;
  const jsonText = (text.match(/\{[\s\S]*\}/) || [])[0] || text;
  try {
    const parsed = JSON.parse(jsonText);
    const price = Number(parsed?.price);
    return Number.isFinite(price) ? price : null;
  } catch (_) {
    const matched = text.match(/"price"\s*:\s*(\d{3,6})/) || text.match(/\d{3,6}/);
    return matched ? Number(matched[1] || matched[0]) : null;
  }
}

function isValidSliderPrice(price, min, max, step) {
  if (!Number.isFinite(price) || price < min || price > max) return false;
  const delta = Math.abs((price - min) % step);
  return delta < 1e-9 || Math.abs(delta - step) < 1e-9;
}

function seedMemoryToText(seed) {
  const memory = seed && typeof seed === "object" ? seed : {};
  return [
    String(memory.backstory || "").trim(),
    `做决策的习惯：${String(memory.decision_habit || "").trim()}`,
    `讨论风格：${String(memory.discussion_style || "").trim()}`,
    `自信区：${String(memory.confidence_zone || "").trim()}`,
    `盲区：${String(memory.blind_zone || "").trim()}`,
    `压力下的反应：${String(memory.under_pressure || "").trim()}`,
    `口头禅/说话习惯：${String(memory.pet_phrases || "").trim()}`
  ].filter(Boolean).join("\n");
}

function buildSeedMemoryPrompt(student) {
  const genderLabel = student.gender === "male" ? "男" : "女";
  const overseasText = student.overseas?.hasOverseas
    ? `${student.overseas.destination}（${student.overseas.duration}）`
    : "无";
  return `根据以下人物属性，生成一份行为底稿。这不是人物介绍，是用来预测这个人在商业讨论中会怎么表现的内部参考。

人物属性：
姓名：${student.name}，${genderLabel}，${student.age}岁
学历：${student.education}，海外经历：${overseasText}
行业：${student.industry}
身份：${student.role}
背景：${student.background}
性格：${student.mbti}
决策风格：${student.decisionStyle}
风险偏好：${student.riskPreference}
表达风格：${student.fullExpressionStyle}
盲区：${student.blindSpots}

输出 JSON，每个字段 1-2 句话：
{
  "backstory": "他是怎么走到今天的（2句话）",
  "decision_habit": "他做决策时的习惯——先看数据还是先凭直觉？遇到不确定的怎么办？",
  "discussion_style": "在一群人讨论时他通常怎么表现——先说还是先听？什么时候会突然来劲？",
  "confidence_zone": "他对什么领域的判断最有信心，几乎不会犹豫",
  "blind_zone": "他对什么完全不懂但可能不自知，或者知道不懂但会装懂/回避",
  "under_pressure": "时间紧或不确定的时候，他会怎么应对——简化问题？套用经验？还是干脆摆烂？",
  "pet_phrases": "他常挂嘴边的口头禅或说话习惯（1-2个例子）"
}

注意：
- backstory 要平实，不要写传奇故事或名场面，像在填履历表的备注栏
- pet_phrases 给 1-2 个真实口头禅就够，不要编金句
- 所有字段像在写内部评估备忘，不像在写人物专访

只输出合法 JSON。`;
}

function buildClassroomProfilePrompt(seedMemoryText) {
  return `下面是你即将上课的一个 EMBA 学生的背景资料：

${seedMemoryText}

写一份课堂行为预测，包含两部分。

第一部分：硬标签（直接选一个值）
{
  "abstraction_ability": "low/medium/high",
  "writing_precision": "low/medium/high",
  "coach_receptiveness": "low/medium/high",
  "effort_style": "认真打磨/先交差后面改/依赖队友/看心情",
  "team_role": "主导/质疑/跟随/调停"
}

第二部分：关键判断（每项抓最突出的一个特点）
{
  "why_here": "来读 EMBA 最核心的一个动机",
  "knowledge_ceiling": "在市场定位/产品战略/用户研究/定价这些领域，他卡在哪里",
  "response_to_AI_coach": "面对 AI 策略顾问的反馈，他最可能的反应"
}

只输出合法 JSON。抓重点，不要面面俱到。`;
}

function parseJsonObject(text) {
  const raw = String(text || "").replace(/```json|```/g, "").trim();
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  const candidate = start >= 0 && end > start ? raw.slice(start, end + 1) : raw;
  try {
    return JSON.parse(candidate);
  } catch (_) {
    return JSON.parse(candidate.replace(/[\u0000-\u001F]+/g, " "));
  }
}

async function requestJsonObjectWithRepair(messages, options = {}, parseLabel = "JSON") {
  let completion = String(await rateLimitedChat(messages, options) || "").trim();
  try {
    return { completion, data: parseJsonObject(completion), repairCount: 0 };
  } catch (firstErr) {
    const repairMessages = [
      ...messages,
      { role: "assistant", content: completion || "(空输出)" },
      {
        role: "user",
        content: [
          `上一次输出不是合法 ${parseLabel}，解析错误：${firstErr.message || String(firstErr)}`,
          "请只把同一内容修正为可 JSON.parse 的合法 JSON。",
          "不要新增解释，不要输出 Markdown 代码块。"
        ].join("\n")
      }
    ];
    completion = String(await rateLimitedChat(repairMessages, {
      ...options,
      temperature: 0.15,
      max_tokens: Math.max(Number(options.max_tokens || 0), 600)
    }) || "").trim();
    return { completion, data: parseJsonObject(completion), repairCount: 1, prompt: repairMessages };
  }
}

function flattenCardsPayload(cards) {
  const groups = Array.isArray(cards?.groups) ? cards.groups : [];
  const catalog = [];
  for (const group of groups) {
    for (const capability of group.capabilities || []) {
      catalog.push({
        cap_id: capability.cap_id,
        name: capability.name,
        dimension: group.name || group.group_id,
        dimensionId: group.group_id,
        covers: Array.isArray(capability.covers) ? capability.covers : [],
        tiers: {
          low: capability.tiers?.low
            ? {
                dCOGS: capability.tiers.low.dCOGS,
                risk: capability.tiers.low.risk,
                nre: capability.nre
              }
            : null,
          mid: capability.tiers?.mid
            ? {
                dCOGS: capability.tiers.mid.dCOGS,
                risk: capability.tiers.mid.risk,
                nre: capability.nre
              }
            : null,
          high: capability.tiers?.high
            ? {
                dCOGS: capability.tiers.high.dCOGS,
                risk: capability.tiers.high.risk,
                nre: capability.nre
              }
            : null
        }
      });
    }
  }
  return catalog;
}

function normalizeAssignedDims(assignedDims) {
  return (Array.isArray(assignedDims) ? assignedDims : [])
    .map((dim) => ({
      id: dim,
      label: DIM_LABELS[dim] || dim
    }));
}

function normalizeCardSelections(rawSelections, validCards) {
  const out = [];
  const seen = new Set();
  const list = Array.isArray(rawSelections) ? rawSelections : [];
  for (const item of list) {
    const capId = String(item?.cap_id || "").trim();
    const tier = String(item?.tier || "").trim().toLowerCase();
    if (!capId || seen.has(capId)) continue;
    const card = validCards.get(capId);
    if (!card) continue;
    if (!["low", "mid", "high"].includes(tier) || !card.tiers?.[tier]) continue;
    out.push({
      cap_id: capId,
      tier,
      reason: String(item?.reason || "").trim()
    });
    seen.add(capId);
  }
  return out;
}

async function rateLimitedChat(messages, options) {
  const maxAttempts = 3;
  let lastErr = null;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const now = Date.now();
    const waitMs = Math.max(0, 220 - (now - lastDeepSeekAt));
    const retryWaitMs = attempt === 0 ? 0 : 1500 * attempt;
    if (waitMs + retryWaitMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, waitMs + retryWaitMs));
    }
    try {
      const out = await chatCompletion(messages, options);
      lastDeepSeekAt = Date.now();
      return out;
    } catch (err) {
      lastErr = err;
      const message = String(err?.message || err || "");
      const transient = /ENOTFOUND|ECONNRESET|ETIMEDOUT|EAI_AGAIN|429|5\d\d/i.test(message);
      if (!transient || attempt === maxAttempts - 1) {
        throw err;
      }
    }
  }
  throw lastErr;
}

class PersonaStudent {
  constructor(options = {}) {
    this.apiKey = options.apiKey || (hasAnyKey() ? "__configured__" : "");
    this.strictMode = options.strictMode === true || String(process.env.STRICT_DEEPSEEK || "").trim() === "1";
    this.student = options.student || null;
    this.teamIndex = Number(options.teamIndex || 0);
    this.memberIndex = Number(options.memberIndex || 0);
    this.teamId = options.teamId || null;
    this.memberId = options.memberId || null;
    this.logger = options.logger || null;
    this.seedMemory = options.seedMemory || null;
    this.seedMemoryText = options.seedMemoryText || seedMemoryToText(options.seedMemory || {});
    this.classroomProfile = options.classroomProfile || null;
    this.classroomProfileText = options.classroomProfileText || (
      options.classroomProfile ? JSON.stringify(options.classroomProfile, null, 2) : ""
    );
  }

  get personaId() {
    return this.student?.personaId || this.student?.id || null;
  }

  get personaLabel() {
    return this.student?.label || null;
  }

  logStudentLLM(entry) {
    if (this.logger && typeof this.logger.logStudentLLM === "function") {
      this.logger.logStudentLLM({
        teamId: this.teamId,
        memberId: this.memberId,
        personaId: this.personaId,
        personaLabel: this.personaLabel,
        studentName: this.student?.name || null,
        ...entry
      });
    }
    logLLMCall({
      caller: entry.caller || "persona_student",
      teamId: this.teamId,
      memberId: this.memberId,
      personaId: this.personaId,
      personaLabel: this.personaLabel,
      messages: entry.prompt,
      completion: entry.completion,
      durationMs: entry.durationMs,
      error: entry.error || null,
      model: getModel("chat_service")
    });
  }

  buildLayeredSystemPrompt(options = {}) {
    let prompt = this.seedMemoryText || buildBaseSystemPrompt(this.student);
    if (this.classroomProfileText) {
      prompt += `\n\n## 课堂行为画像\n${this.classroomProfileText}`;
    }
    const includeVpLengthConstraint = options.includeVpLengthConstraint !== false;
    const lengthConstraint = includeVpLengthConstraint ? getVPLengthConstraint(this.student?.education) : "";
    if (lengthConstraint) {
      prompt += `\n${lengthConstraint}`;
    }
    return options.stripVpLengthConstraint === true ? stripVPLengthConstraint(prompt) : prompt;
  }

  async generateSeedMemory() {
    if (this.seedMemory && this.seedMemoryText) {
      return this.seedMemory;
    }
    const messages = [
      {
        role: "user",
        content: buildSeedMemoryPrompt(this.student)
      }
    ];
    const startedAt = Date.now();
    if (!this.apiKey) {
      const fallback = {
        backstory: `${this.student?.background || this.student?.role || ""}`.trim() || "有多年行业经验，靠实战一路走到现在。",
        decision_habit: `${this.student?.decisionStyle || "先凭经验判断，再看数据验证。"}`
          .trim(),
        discussion_style: `${this.student?.fullExpressionStyle || this.student?.expressionStyle || "讨论时会带着明显个人风格。"}`
          .trim(),
        confidence_zone: `${this.student?.industry || "自己熟悉的行业"}里的判断最有把握。`,
        blind_zone: `${this.student?.blindSpots || "对陌生领域容易忽略或回避。"}`
          .trim(),
        under_pressure: "时间紧时会回到自己最熟悉的经验套路。",
        pet_phrases: "先把关键点讲清楚。"
      };
      this.seedMemory = fallback;
      this.seedMemoryText = seedMemoryToText(fallback);
      this.logStudentLLM({
        caller: "persona_student.generateSeedMemory",
        step: "L0_seed_memory",
        prompt: messages,
        completion: fallback,
        durationMs: Date.now() - startedAt,
        usedFallback: true
      });
      return fallback;
    }

    try {
      const jsonResult = await requestJsonObjectWithRepair(messages, {
        temperature: 0.9,
        max_tokens: 400
      }, "seed memory JSON");
      const parsed = jsonResult.data;
      this.seedMemory = parsed;
      this.seedMemoryText = seedMemoryToText(parsed);
      this.logStudentLLM({
        caller: "persona_student.generateSeedMemory",
        step: "L0_seed_memory",
        prompt: jsonResult.prompt || messages,
        completion: parsed,
        durationMs: Date.now() - startedAt,
        jsonRepairCount: jsonResult.repairCount
      });
      return parsed;
    } catch (err) {
      if (this.strictMode) {
        throw new Error(`Persona seed memory failed: ${err.message || err}`);
      }
      const fallback = {
        backstory: `${this.student?.background || this.student?.role || ""}`.trim() || "有多年行业经验，靠实战一路走到现在。",
        decision_habit: `${this.student?.decisionStyle || "先凭经验判断，再看数据验证。"}`
          .trim(),
        discussion_style: `${this.student?.fullExpressionStyle || this.student?.expressionStyle || "讨论时会带着明显个人风格。"}`
          .trim(),
        confidence_zone: `${this.student?.industry || "自己熟悉的行业"}里的判断最有把握。`,
        blind_zone: `${this.student?.blindSpots || "对陌生领域容易忽略或回避。"}`
          .trim(),
        under_pressure: "时间紧时会回到自己最熟悉的经验套路。",
        pet_phrases: "先把关键点讲清楚。"
      };
      this.seedMemory = fallback;
      this.seedMemoryText = seedMemoryToText(fallback);
      this.logStudentLLM({
        caller: "persona_student.generateSeedMemory",
        step: "L0_seed_memory",
        prompt: messages,
        completion: fallback,
        durationMs: Date.now() - startedAt,
        usedFallback: true,
        error: String(err.message || err)
      });
      return fallback;
    }
  }

  async generateClassroomProfile() {
    if (this.classroomProfile && this.classroomProfileText) {
      return this.classroomProfile;
    }
    if (!this.seedMemoryText) {
      await this.generateSeedMemory();
    }
    const messages = [
      {
        role: "system",
        content: "你是中欧国际工商学院 Innovation and Internal Entrepreneurship 课程的教授。"
      },
      {
        role: "user",
        content: buildClassroomProfilePrompt(this.seedMemoryText)
      }
    ];
    const startedAt = Date.now();
    if (!this.apiKey) {
      const fallback = {
        abstraction_ability: "medium",
        writing_precision: "medium",
        coach_receptiveness: "medium",
        effort_style: "先交差后面改",
        team_role: "主导",
        why_here: "希望把现有经验系统化，并借课堂找到新的增长思路。",
        knowledge_ceiling: "在陌生领域的市场定位与用户研究容易停留在直觉层面。",
        response_to_AI_coach: "会先看建议是否实用，能落地就采纳，太虚就保留意见。"
      };
      this.classroomProfile = fallback;
      this.classroomProfileText = JSON.stringify(fallback, null, 2);
      this.logStudentLLM({
        caller: "persona_student.generateClassroomProfile",
        step: "L1_classroom_profile",
        prompt: messages,
        completion: fallback,
        durationMs: Date.now() - startedAt,
        usedFallback: true
      });
      return fallback;
    }

    try {
      const jsonResult = await requestJsonObjectWithRepair(messages, {
        temperature: 0.9,
        max_tokens: 400
      }, "classroom profile JSON");
      const parsed = jsonResult.data;
      this.classroomProfile = parsed;
      this.classroomProfileText = JSON.stringify(parsed, null, 2);
      this.logStudentLLM({
        caller: "persona_student.generateClassroomProfile",
        step: "L1_classroom_profile",
        prompt: jsonResult.prompt || messages,
        completion: parsed,
        durationMs: Date.now() - startedAt,
        jsonRepairCount: jsonResult.repairCount
      });
      return parsed;
    } catch (err) {
      if (this.strictMode) {
        throw new Error(`Persona classroom profile failed: ${err.message || err}`);
      }
      const fallback = {
        abstraction_ability: "medium",
        writing_precision: "medium",
        coach_receptiveness: "medium",
        effort_style: "先交差后面改",
        team_role: "主导",
        why_here: "希望把现有经验系统化，并借课堂找到新的增长思路。",
        knowledge_ceiling: "在陌生领域的市场定位与用户研究容易停留在直觉层面。",
        response_to_AI_coach: "会先看建议是否实用，能落地就采纳，太虚就保留意见。"
      };
      this.classroomProfile = fallback;
      this.classroomProfileText = JSON.stringify(fallback, null, 2);
      this.logStudentLLM({
        caller: "persona_student.generateClassroomProfile",
        step: "L1_classroom_profile",
        prompt: messages,
        completion: fallback,
        durationMs: Date.now() - startedAt,
        usedFallback: true,
        error: String(err.message || err)
      });
      return fallback;
    }
  }

  async generatePhase1Choice(gridChoice) {
    const choice = gridChoice || { grid_id: "ToC_Differentiation_Adult", architecture: "Experience" };
    const fallbackBase = getFallbackVP(this.personaId);
    const fallback = {
      grid_id: choice.grid_id,
      architecture: choice.architecture,
      who: fallbackBase.who,
      pain: fallbackBase.pain,
      how: fallbackBase.how
    };
    const messages = [
      { role: "system", content: this.buildLayeredSystemPrompt() },
      {
        role: "user",
        content: [
          "## 当前任务",
          `你选择了市场定位：${gridDescription(choice)}（${choice.grid_id}）`,
          `架构标签：${choice.architecture}`,
          "",
          "这是课堂上的第一轮快速练习，你只有 30 秒写下第一反应。",
          "",
          "你的思维起点取决于你的背景：",
          "- 如果你有渠道和销售经验，你会先想'这东西卖给谁、怎么卖'",
          "- 如果你有技术背景，你会先想'技术壁垒在哪、怎么实现'",
          "- 如果你有管理经验，你会先想'市场多大、竞争格局如何'",
          "- 如果你是运营出身，你会先想'落地场景是什么、谁来用'",
          "",
          "写法要求：",
          "- 用你平时说话的方式，不要用商业框架",
          "- 想到什么写什么，只写你最有把握的那个角度",
          "- 允许模糊、不完整、有偏见",
          "- 不需要 WHO/PAIN/HOW 都写到位，能写几个写几个",
          "",
          "WHO：你第一个想到的客户（一句话）",
          "PAIN：你觉得他们最大的问题（一句话）",
          "HOW：你觉得这款 AI 宠物机器人怎么帮他们（一句话）",
          "",
          `注意你的表达特点：${this.student.vpQuirks}`,
          getVPLengthConstraint(this.student?.education),
          "2-4 句话，只输出 JSON：{\"who\":\"...\",\"pain\":\"...\",\"how\":\"...\"}"
        ].filter(Boolean).join("\n")
      }
    ];
    const startedAt = Date.now();

    if (!this.apiKey) {
      if (this.strictMode) {
        throw new Error("STRICT_DEEPSEEK=1 but no LLM API key is configured");
      }
      this.logStudentLLM({
        caller: "persona_student.generatePhase1Choice",
        step: "R1.3_generate_phase1",
        prompt: messages,
        completion: JSON.stringify(fallback),
        durationMs: Date.now() - startedAt,
        usedFallback: true
      });
      return fallback;
    }

    try {
      const jsonResult = await requestJsonObjectWithRepair(messages, { temperature: 0.9, max_tokens: 320 }, "phase1 JSON");
      const data = jsonResult.data;
      const result = {
        grid_id: choice.grid_id,
        architecture: choice.architecture,
        who: String(data.who || fallback.who).trim(),
        pain: String(data.pain || fallback.pain).trim(),
        how: String(data.how || fallback.how).trim()
      };
      this.logStudentLLM({
        caller: "persona_student.generatePhase1Choice",
        step: "R1.3_generate_phase1",
        prompt: jsonResult.prompt || messages,
        completion: jsonResult.completion,
        durationMs: Date.now() - startedAt,
        usedFallback: false,
        jsonRepairCount: jsonResult.repairCount
      });
      return result;
    } catch (err) {
      if (this.strictMode) {
        throw new Error(`Persona phase1 generation failed: ${err.message || err}`);
      }
      this.logStudentLLM({
        caller: "persona_student.generatePhase1Choice",
        step: "R1.3_generate_phase1",
        prompt: messages,
        completion: JSON.stringify(fallback),
        durationMs: Date.now() - startedAt,
        usedFallback: true,
        error: String(err.message || err)
      });
      return fallback;
    }
  }

  async generateVPDraft(gridChoice) {
    const choice = gridChoice || { grid_id: "ToC_Differentiation_Adult", architecture: "Experience" };
    const fallbackBase = getFallbackVP(this.personaId);
    const structuredVpDraft = String(process.env.SIM_STRUCTURED_VP_DRAFT || "").trim() === "1";
    const fallbackText = structuredVpDraft
      ? `WHO：${fallbackBase.who}\nPAIN：${fallbackBase.pain}\nHOW：${fallbackBase.how}`
      : `${fallbackBase.who}。${fallbackBase.pain}。${fallbackBase.how}`;
    const userPrompt = structuredVpDraft
      ? `你们小组刚完成了战略定位的选择。你选了：${gridDescription(choice)}（${choice.grid_id}），架构：${choice.architecture}。

你刚看完 AI 宠物机器人的产品介绍视频：一个有温度、会撒娇、能认人、能主动靠近人的陪伴机器人，日本研发，现在要进中国市场。

现在进入小组讨论环节。界面上有一个空白文本框，让每个人先写下自己对这个方向的初步想法，作为讨论的起点。AI 策略顾问会在你们写完后加入讨论，帮你们完善。

这是课堂上的第一反应，不是写方案书，但当前系统需要按三行存档，方便后续打分。
- 保留你的判断口吻
- 可以有偏见和不完整
- 不要编数据
- 不要写系统架构
- 不要把产品改成别的东西，你写的必须还是 AI 宠物机器人这个陪伴机器人

只输出三行：
WHO：你第一个想到的客户
PAIN：你觉得他们最大的问题
HOW：你觉得这款 AI 宠物机器人怎么帮他们`
      : `你们小组刚完成了战略定位的选择。你选了：${gridDescription(choice)}（${choice.grid_id}），架构：${choice.architecture}。

你刚看完 AI 宠物机器人的产品介绍视频：一个有温度、会撒娇、能认人、能主动靠近人的陪伴机器人，日本研发，现在要进中国市场。

现在进入小组讨论环节。界面上有一个空白文本框，让每个人先写下自己对这个方向的初步想法，作为讨论的起点。AI 策略顾问会在你们写完后加入讨论，帮你们完善。

这是课堂上的第一反应，不是写方案书。
- 只写你最先想到的那个方向
- 可以模糊、可以不完整
- 不要编数据
- 不要写系统架构
- 不要把产品改成别的东西，你写的必须还是 AI 宠物机器人这个陪伴机器人

把你的想法直接打进去，1-4 句话。`;
    const messages = [
      {
        role: "system",
        content: this.buildLayeredSystemPrompt()
      },
      {
        role: "user",
        content: userPrompt
      }
    ];
    const startedAt = Date.now();

    if (!this.apiKey) {
      if (this.strictMode) {
        throw new Error("STRICT_DEEPSEEK=1 but no LLM API key is configured");
      }
      this.logStudentLLM({
        caller: "persona_student.generateVPDraft",
        step: "L2_vp_draft",
        prompt: messages,
        completion: fallbackText,
        durationMs: Date.now() - startedAt,
        usedFallback: true
      });
      return fallbackText;
    }

    try {
      const completion = await rateLimitedChat(messages, {
        temperature: 0.9,
        max_tokens: 200
      });
      const result = String(completion || "").trim() || fallbackText;
      this.logStudentLLM({
        caller: "persona_student.generateVPDraft",
        step: "L2_vp_draft",
        prompt: messages,
        completion: result,
        durationMs: Date.now() - startedAt
      });
      return result;
    } catch (err) {
      if (this.strictMode) {
        throw new Error(`Persona VP draft failed: ${err.message || err}`);
      }
      this.logStudentLLM({
        caller: "persona_student.generateVPDraft",
        step: "L2_vp_draft",
        prompt: messages,
        completion: fallbackText,
        durationMs: Date.now() - startedAt,
        usedFallback: true,
        error: String(err.message || err)
      });
      return fallbackText;
    }
  }

  async generateVPRevision({ currentVP, coachReply, speakerReply, conversationHistory }) {
    const currentText = String(currentVP || "").trim();
    const historyText = (Array.isArray(conversationHistory) ? conversationHistory : [])
      .slice(-6)
      .map((item) => `${item.role === "assistant" ? "教练" : "学生"}：${item.content}`)
      .join("\n");
    const fallback = currentText;
    const messages = [
      { role: "system", content: this.buildLayeredSystemPrompt() },
      {
        role: "user",
        content: [
          "你刚看完 AI 策略顾问给你们团队的反馈：",
          "",
          `「${String(coachReply || "").trim()}」`,
          "",
          "你的队友刚才也说了自己的想法：",
          "",
          `「${String(speakerReply || "").trim()}」`,
          "",
          historyText ? `最近对话：\n${historyText}` : "",
          "",
          "现在的 VP 草稿：",
          currentText || "（空）",
          "",
          "请修改后输出新的 VP 文本（自由文本，不需要 JSON 格式）。"
        ].filter(Boolean).join("\n")
      }
    ];
    const startedAt = Date.now();

    if (!this.apiKey) {
      if (this.strictMode) {
        throw new Error("STRICT_DEEPSEEK=1 but no LLM API key is configured");
      }
      this.logStudentLLM({
        caller: "persona_student.generateVPRevision",
        step: "R1.5_generate_vp_revision",
        prompt: messages,
        completion: fallback,
        durationMs: Date.now() - startedAt,
        usedFallback: true
      });
      return fallback;
    }

    try {
      const completion = await rateLimitedChat(messages, { temperature: 0.8, max_tokens: 280 });
      const result = String(completion || "").trim() || fallback;
      this.logStudentLLM({
        caller: "persona_student.generateVPRevision",
        step: "R1.5_generate_vp_revision",
        prompt: messages,
        completion: result,
        durationMs: Date.now() - startedAt,
        usedFallback: false
      });
      return result;
    } catch (err) {
      if (this.strictMode) {
        throw new Error(`Persona VP revision failed: ${err.message || err}`);
      }
      this.logStudentLLM({
        caller: "persona_student.generateVPRevision",
        step: "R1.5_generate_vp_revision",
        prompt: messages,
        completion: fallback,
        durationMs: Date.now() - startedAt,
        usedFallback: true,
        error: String(err.message || err)
      });
      return fallback;
    }
  }

  async generateVPChatReply(coachMessage, conversationHistory) {
    const historyText = (Array.isArray(conversationHistory) ? conversationHistory : [])
      .slice(-6)
      .map((item) => `${item.role === "assistant" ? "教练" : "学生"}：${item.content}`)
      .join("\n");
    const fallback = getFallbackChatReply(this.personaId, this.memberIndex + (conversationHistory || []).length);
    const messages = [
      { role: "system", content: this.buildLayeredSystemPrompt() },
      {
        role: "user",
        content: [
          "## 当前场景",
          "你在小组讨论中回应 AI 教练。",
          historyText ? `最近对话：\n${historyText}` : "",
          `教练刚说：${JSON.stringify(String(coachMessage || ""))}`,
          "",
          "用你自然的表达方式回复，1-3 句话。"
        ].filter(Boolean).join("\n\n")
      }
    ];
    const startedAt = Date.now();

    if (!this.apiKey) {
      if (this.strictMode) {
        throw new Error("STRICT_DEEPSEEK=1 but no LLM API key is configured");
      }
      this.logStudentLLM({
        caller: "persona_student.generateVPChatReply",
        step: "R1.5_generate_vp_reply",
        prompt: messages,
        completion: fallback,
        durationMs: Date.now() - startedAt,
        usedFallback: true
      });
      return fallback;
    }

    try {
      const completion = String(await rateLimitedChat(messages, { temperature: 0.9, max_tokens: 180 }) || "").trim() || fallback;
      this.logStudentLLM({
        caller: "persona_student.generateVPChatReply",
        step: "R1.5_generate_vp_reply",
        prompt: messages,
        completion,
        durationMs: Date.now() - startedAt,
        usedFallback: false
      });
      return completion;
    } catch (err) {
      if (this.strictMode) {
        throw new Error(`Persona VP chat failed: ${err.message || err}`);
      }
      this.logStudentLLM({
        caller: "persona_student.generateVPChatReply",
        step: "R1.5_generate_vp_reply",
        prompt: messages,
        completion: fallback,
        durationMs: Date.now() - startedAt,
        usedFallback: true,
        error: String(err.message || err)
      });
      return fallback;
    }
  }

  async generateInterviewReply(personaMessage, conversationHistory, assignedDims) {
    const turn = (Array.isArray(conversationHistory) ? conversationHistory : []).filter((item) => item.role === "user").length;
    const assignedDimsDesc = (Array.isArray(assignedDims) ? assignedDims : [])
      .map((dim) => DIM_LABELS[dim] || dim)
      .join("、");
    const fallback = getFallbackInterviewReply(this.personaId, turn);
    const messages = [
      { role: "system", content: this.buildLayeredSystemPrompt() },
      {
        role: "user",
        content: [
          "## 当前场景",
          "你在对 AI 宠物机器人的潜在用户进行焦点访谈。",
          `你的访谈风格：${this.student.interviewStyleFull || this.student.interviewStyle}`,
          `你负责的产品维度：${assignedDimsDesc || "综合探索"}`,
          `当前轮次：第 ${turn + 1} 轮`,
          "",
          INTERVIEW_DIMENSION_GUIDANCE,
          `用户刚说：${JSON.stringify(String(personaMessage || ""))}`,
          "",
          "用你自然的访谈风格追问，1-2 句话。"
        ].join("\n")
      }
    ];
    const startedAt = Date.now();

    if (!this.apiKey) {
      if (this.strictMode) {
        throw new Error("STRICT_DEEPSEEK=1 but no LLM API key is configured");
      }
      this.logStudentLLM({
        caller: "persona_student.generateInterviewReply",
        step: "R2.1_generate_interview_reply",
        prompt: messages,
        completion: fallback,
        durationMs: Date.now() - startedAt,
        usedFallback: true
      });
      return fallback;
    }

    try {
      const completion = String(await rateLimitedChat(messages, { temperature: 0.9, max_tokens: 180 }) || "").trim() || fallback;
      this.logStudentLLM({
        caller: "persona_student.generateInterviewReply",
        step: "R2.1_generate_interview_reply",
        prompt: messages,
        completion,
        durationMs: Date.now() - startedAt,
        usedFallback: false
      });
      return completion;
    } catch (err) {
      if (this.strictMode) {
        throw new Error(`Persona interview generation failed: ${err.message || err}`);
      }
      this.logStudentLLM({
        caller: "persona_student.generateInterviewReply",
        step: "R2.1_generate_interview_reply",
        prompt: messages,
        completion: fallback,
        durationMs: Date.now() - startedAt,
        usedFallback: true,
        error: String(err.message || err)
      });
      return fallback;
    }
  }

  async generatePriceChoice(priceContext = {}) {
    const base = Number(priceContext.defaultPrice || priceContext.basePrice || priceContext.P || priceContext.Pmax || 4000);
    const min = Number(priceContext.min || Math.max(2000, Math.round(base * 0.7)));
    const max = Number(priceContext.max || Math.max(min, Math.round(base * 1.15)));
    const step = Number(priceContext.step || 100);
    const totalCOGS = Number(priceContext.totalCOGS || priceContext.COGSbase || 600);
    const baseVariableCost = Number(priceContext.baseVariableCost || priceContext.COGSbase || 600);
    const dCOGSTotal = Number(priceContext.dCOGSTotal || Math.max(0, totalCOGS - baseVariableCost));
    const fbaseWan = Number(priceContext.fbaseWan || 0);
    const nreTotalWan = Number(priceContext.nreTotalWan || 0);
    const upfrontInvestmentWan = Number(priceContext.upfrontInvestmentWan || (fbaseWan + nreTotalWan));
    const channelFee = Number(priceContext.channelFee || 0);
    const channelNetRate = Math.round((1 - channelFee / 100) * 100);
    const demandSummary = String(priceContext.demandSummary || "").trim() ||
      "- 未记录到明确的消费能力或价格态度原话；请只根据已获得的客户痛点、采购语境和成本信息定价。";
    const fallbackFactor = {
      A: 1.02,
      B: 0.95,
      C: 0.9,
      D: 1,
      E: 0.82,
      F: 1.04,
      G: 0.88
    }[this.personaId] || 0.92;
    const fallback = Math.max(min, Math.min(max, Math.round(base * fallbackFactor)));
    const messages = [
      { role: "system", content: this.buildLayeredSystemPrompt({ includeVpLengthConstraint: false, stripVpLengthConstraint: true }) },
      {
        role: "user",
        content: [
          "## 当前场景",
          "你需要为你们的 AI 宠物机器人定价。",
          `你的定价倾向：${this.student.pricingBias}`,
          "",
          "已知信息：",
          "成本侧：",
          `- 你的产品单台可变成本约 ¥${Math.round(totalCOGS)}（基础硬件 ¥${Math.round(baseVariableCost)} + 能力卡增量 dCOGS ¥${Math.round(dCOGSTotal)}）`,
          `- 前期投入约 ${Math.round(upfrontInvestmentWan)} 万元（基础固定投入 Fbase ${Math.round(fbaseWan)} 万元 + 研发 NRE ${Math.round(nreTotalWan)} 万元）`,
          `- 渠道抽成：${channelFee}%（实际到手 = 定价 × ${channelNetRate}%）`,
          "",
          "需求侧：客户谈到的消费能力/价格态度线索",
          demandSummary,
          "",
          `定价区间：¥${min} - ¥${max}`,
          `滑块步长：¥${step}`,
          "这个区间是课堂 UI 的硬边界，不是建议。低于最低值或高于最高值都会提交失败。",
          "不要输出低于区间或高于区间的价格，也不要把区间端点当作建议价。",
          "",
          "请输出 JSON，不要输出多余文字。字段要求：",
          "- price：区间内且符合步长的整数价格",
          "- reason：一句话说明你的定价依据"
        ].join("\n")
      }
    ];
    const startedAt = Date.now();

    if (!this.apiKey) {
      if (this.strictMode) {
        throw new Error("STRICT_DEEPSEEK=1 but no LLM API key is configured");
      }
      this.logStudentLLM({
        caller: "persona_student.generatePriceChoice",
        step: "R2.7_generate_price",
        prompt: messages,
        completion: String(fallback),
        durationMs: Date.now() - startedAt,
        usedFallback: true
      });
      return fallback;
    }

    try {
      let currentMessages = messages;
      let completion = "";
      let price = null;
      for (let attempt = 0; attempt < 3; attempt += 1) {
        completion = String(await rateLimitedChat(currentMessages, { temperature: attempt === 0 ? 0.4 : 0.2, max_tokens: 160 }) || "").trim();
        price = extractPriceFromJsonCompletion(completion);
        if (isValidSliderPrice(price, min, max, step)) {
          this.logStudentLLM({
            caller: "persona_student.generatePriceChoice",
            step: "R2.7_generate_price",
            prompt: currentMessages,
            completion,
            durationMs: Date.now() - startedAt,
            usedFallback: false,
            retryCount: attempt
          });
          return price;
        }
        currentMessages = [
          ...messages,
          { role: "assistant", content: completion || "(空输出)" },
          {
            role: "user",
            content: [
              `你刚才输出的 price 不在课堂滑块区间 ¥${min} - ¥${max} 内，或不符合 ¥${step} 步长。`,
              `请重新输出一个 ${min} 到 ${max} 之间、符合 ¥${step} 步长的整数价格。`,
              "仍然只输出 JSON，不要输出多余文字。字段要求：",
              "- price：区间内且符合步长的整数价格",
              "- reason：一句话说明你的定价依据"
            ].join("\n")
          }
        ];
      }
      this.logStudentLLM({
        caller: "persona_student.generatePriceChoice",
        step: "R2.7_generate_price",
        prompt: messages,
        completion,
        durationMs: Date.now() - startedAt,
        usedFallback: false,
        outOfRange: true
      });
      if (this.strictMode) {
        throw new Error(`Persona price out of range after retries: ${price}`);
      }
      return fallback;
    } catch (err) {
      if (this.strictMode) {
        throw new Error(`Persona price generation failed: ${err.message || err}`);
      }
      this.logStudentLLM({
        caller: "persona_student.generatePriceChoice",
        step: "R2.7_generate_price",
        prompt: messages,
        completion: String(fallback),
        durationMs: Date.now() - startedAt,
        usedFallback: true,
        error: String(err.message || err)
      });
      return fallback;
    }
  }

  async generateCardSelection(selectionContext = {}) {
    const cards = selectionContext.cards || {};
    const interviewSummary = String(selectionContext.interviewSummary || "").trim() || "暂无结构化摘要，请根据访谈证据做保守判断。";
    const assignedDims = normalizeAssignedDims(selectionContext.assignedDims);
    const budgetCap = Number(selectionContext.budgetCap || 0);
    const validationIssues = Array.isArray(selectionContext.validationIssues) ? selectionContext.validationIssues : [];
    const previousSelections = Array.isArray(selectionContext.previousSelections) ? selectionContext.previousSelections : [];
    const fallback = normalizeCardSelections(
      selectionContext.fallbackSelections || [],
      new Map(flattenCardsPayload(cards).map((card) => [card.cap_id, card]))
    );
    const cardCatalog = flattenCardsPayload(cards);
    const validCards = new Map(cardCatalog.map((card) => [card.cap_id, card]));
    const messages = [
      { role: "system", content: this.buildLayeredSystemPrompt() },
      {
        role: "user",
        content: [
          "## 当前任务",
          "你正在为 AI 宠物机器人选择研发能力卡。",
          "",
          "## 你的访谈发现",
          interviewSummary,
          "",
          validationIssues.length > 0 ? [
            "## 你上次的选卡组合有以下问题",
            validationIssues.map((item) => `- ${String(item?.message || item || "").trim()}`).filter(Boolean).join("\n"),
            "",
            "请修正后重新选卡，优先消除这些依赖或冲突问题。"
          ].join("\n") : "",
          previousSelections.length > 0 ? [
            "## 你上次提交的选卡",
            JSON.stringify(previousSelections, null, 2)
          ].join("\n") : "",
          "",
          "## 你负责的维度",
          assignedDims.length > 0
            ? assignedDims.map((dim) => `- ${dim.label}（${dim.id}）`).join("\n")
            : "- 综合判断",
          "",
          "## 预算约束",
          `- 总 dCOGS 预算上限约 ¥${Math.max(0, Math.round(budgetCap || 0))}`,
          "- 每张卡有 dCOGS（增加硬件成本）和 NRE（研发固定成本）",
          "",
          "## 可选卡列表",
          JSON.stringify(cardCatalog, null, 2),
          "",
          "请选择 6-10 张卡，只输出可 JSON.parse 的 JSON：",
          "{",
          '  "selections": [',
          '    { "cap_id": "xxx", "tier": "mid", "reason": "一句话理由" }',
          "  ]",
          "}",
          "",
          "选卡原则：",
          "- 优先选跟访谈发现相关的卡",
          "- 你负责的维度必须选卡",
          "- 必须满足卡之间的依赖关系，不能选出有硬性 requires/excludes 冲突的组合",
          "- 不要超预算",
          "- tier 选择反映你的风险偏好"
        ].filter(Boolean).join("\n")
      }
    ];
    const startedAt = Date.now();

    if (!this.apiKey) {
      if (this.strictMode) {
        throw new Error("STRICT_DEEPSEEK=1 but no LLM API key is configured");
      }
      this.logStudentLLM({
        caller: "persona_student.generateCardSelection",
        step: "R2.4_generate_card_selection",
        prompt: messages,
        completion: JSON.stringify({ selections: fallback }),
        durationMs: Date.now() - startedAt,
        usedFallback: true
      });
      return fallback;
    }

    try {
      const completion = await rateLimitedChat(messages, {
        model: "deepseek-chat",
        temperature: 0.7,
        max_tokens: 1500
      });
      const data = parseJsonObject(completion);
      const parsed = normalizeCardSelections(data?.selections, validCards);
      if (!parsed.length) {
        throw new Error("LLM returned no valid card selections");
      }
      this.logStudentLLM({
        caller: "persona_student.generateCardSelection",
        step: "R2.4_generate_card_selection",
        prompt: messages,
        completion,
        durationMs: Date.now() - startedAt,
        usedFallback: false
      });
      return parsed;
    } catch (err) {
      if (this.strictMode) {
        throw new Error(`Persona card selection failed: ${err.message || err}`);
      }
      this.logStudentLLM({
        caller: "persona_student.generateCardSelection",
        step: "R2.4_generate_card_selection",
        prompt: messages,
        completion: JSON.stringify({ selections: fallback }),
        durationMs: Date.now() - startedAt,
        usedFallback: true,
        error: String(err.message || err)
      });
      return fallback;
    }
  }
}

module.exports = {
  PersonaStudent,
  buildBaseSystemPrompt
};
