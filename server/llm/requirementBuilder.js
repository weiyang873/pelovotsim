// requirementBuilder.js - 需求清单生成
const { chatCompletion } = require("./deepseekClient");
const { withLlmLogging } = require("./llm_logger");

function parseJsonLoose(raw) {
  const t = String(raw || "").replace(/```json|```/g, "").trim();
  try {
    return JSON.parse(t);
  } catch (_) {}
  const lObj = t.indexOf("{");
  const rObj = t.lastIndexOf("}");
  if (lObj >= 0 && rObj > lObj) {
    return JSON.parse(t.slice(lObj, rObj + 1));
  }
  throw new Error("json parse failed");
}

function normalizeRequirementRow(row, idx) {
  const id = `R${String(idx + 1).padStart(3, "0")}`;
  const categories = new Set(["功能需求", "情感需求", "体验需求", "安全需求"]);
  const priorities = new Set(["must_have", "nice_to_have", "low_priority"]);
  return {
    id,
    title: String(row?.title || `需求${idx + 1}`).slice(0, 12),
    description: String(row?.description || row?.text || "需要更明确的产品能力与交付方式"),
    source_quote: String(row?.source_quote || row?.quote || "访谈提炼"),
    category: categories.has(String(row?.category || "")) ? String(row.category) : "功能需求",
    benchmark_priority: priorities.has(String(row?.benchmark_priority || "")) ? String(row.benchmark_priority) : "nice_to_have",
    benchmark_reason: String(row?.benchmark_reason || "来自访谈中的高频诉求，建议优先验证")
  };
}

function coerceRequirementsPayload(parsed) {
  if (Array.isArray(parsed)) {
    const rows = parsed
      .slice(0, 12)
      .map((x, i) => normalizeRequirementRow(typeof x === "string" ? { title: x.slice(0, 12), description: x } : x, i));
    return {
      requirements: rows,
      summary: "根据访谈内容自动整理了初版需求清单。",
      hidden_insight: "用户表面表达与真实担忧存在偏差，需要通过试点继续验证。"
    };
  }

  const rows = Array.isArray(parsed?.requirements)
    ? parsed.requirements
    : Array.isArray(parsed?.items)
      ? parsed.items
      : [];
  const normalizedRows = rows.slice(0, 12).map((r, i) => normalizeRequirementRow(r, i));
  if (normalizedRows.length >= 3) {
    return {
      requirements: normalizedRows,
      summary: String(parsed?.summary || "已提炼出核心需求，并标注了优先级。"),
      hidden_insight: String(parsed?.hidden_insight || "关键阻力通常来自上手成本和持续使用理由不足。")
    };
  }
  throw new Error("需求清单生成失败：模型输出不可解析");
}

function rebalancePriorities(rows) {
  const out = [...rows];
  for (let i = 0; i < out.length; i += 1) {
    if (i < 3) out[i].benchmark_priority = "must_have";
    else if (i < 8) out[i].benchmark_priority = "nice_to_have";
    else out[i].benchmark_priority = "low_priority";
  }
  return out;
}

async function generateRequirements(session) {
  const conversation = (session.messages || [])
    .slice(-24)
    .map((m) => `${m.role === "user" ? "学生(Marketing)" : `客户(${session.persona?.name || "客户"})`}：${m.content}`)
    .join("\n");

  const messages = [
    {
      role: "system",
      content: "你是一位产品经理，擅长从客户访谈中提炼需求。请输出严格的 JSON，不要有任何其他文字。"
    },
    {
      role: "user",
      content: `以下是客户访谈记录：\n${conversation}\n\n客户背景：${session.persona?.name || ""}，${session.persona?.age || ""}岁，${session.persona?.occupation || ""}\n\n产品背景：LOVOT 陪伴型机器人\n策略方向：${session.strategy?.market || ""} | ${session.strategy?.competitive || ""} | ${session.strategy?.segment || ""} | ${session.strategy?.architecture || ""}\n\n请从访谈中提炼需求，输出以下格式：\n{\n  "requirements": [\n    {\n      "id": "R001",\n      "title": "需求标题（5字以内）",\n      "description": "具体描述（1-2句话）",\n      "source_quote": "访谈中客户的原话（直接引用）",\n      "category": "功能需求/情感需求/体验需求/安全需求",\n      "benchmark_priority": "must_have/nice_to_have/low_priority",\n      "benchmark_reason": "推荐这个优先级的原因（1句话）"\n    }\n  ],\n  "summary": "需求总结（100字以内，指出最核心的洞察）",\n  "hidden_insight": "访谈中发现的意外洞察（学生可能没注意到的）"\n}\n\n要求：\n- 至少提炼6个需求，最多12个\n- benchmark_priority 的分配：must_have 3个，nice_to_have 4-6个，其余 low_priority\n- 需求要具体可执行，不要泛泛而谈`
    }
  ];

  try {
    const raw = await withLlmLogging({
      caller: "requirementBuilder.generateRequirements",
      teamId: session?.teamId || session?.team_id || session?.teamKey || null,
      memberId: session?.memberId || session?.member_id || null,
      messages
    }, () => chatCompletion(messages, { temperature: 0.35, max_tokens: 1200 }));
    const parsed = parseJsonLoose(raw);
    const coerced = coerceRequirementsPayload(parsed);
    const balanced = rebalancePriorities(coerced.requirements || []);
    return {
      requirements: balanced,
      summary: coerced.summary,
      hidden_insight: coerced.hidden_insight
    };
  } catch (firstErr) {
    try {
      const retryMessages = [
        ...messages,
        {
          role: "user",
          content: "上一轮输出不可解析。请只输出一个JSON对象，包含 requirements/summary/hidden_insight 三个字段。"
        }
      ];
      const raw2 = await withLlmLogging({
        caller: "requirementBuilder.generateRequirements.retry",
        teamId: session?.teamId || session?.team_id || session?.teamKey || null,
        memberId: session?.memberId || session?.member_id || null,
        messages: retryMessages
      }, () => chatCompletion(retryMessages, { temperature: 0.2, max_tokens: 1200 }));
      const parsed2 = parseJsonLoose(raw2);
      const coerced2 = coerceRequirementsPayload(parsed2);
      const balanced2 = rebalancePriorities(coerced2.requirements || []);
      return {
        requirements: balanced2,
        summary: coerced2.summary,
        hidden_insight: coerced2.hidden_insight
      };
    } catch (_) {
      throw new Error(`AI 服务暂时不可用，请重试（${firstErr.message || "unknown"}）`);
    }
  }
}

/**
 * 基于访谈对话历史，生成 3-5 句话的文字摘要
 */
async function generateInterviewSummary(messages, persona) {
  const p = persona || {};
  const conversation = (Array.isArray(messages) ? messages : [])
    .map((m) => `${m.role === "user" ? "产品经理" : (p.name || "用户")}：${m.content}`)
    .join("\n");

  const summaryMessages = [
    {
      role: "system",
      content: `你是一个产品需求分析专家。请基于以下访谈对话，生成一段简洁的摘要（3-5句话），包括：
1. 用户最在意什么（核心需求）
2. 用户最大的顾虑或排斥点是什么
3. 有什么出乎意料或值得注意的发现

要求：
- 用第三人称描述用户（如"该用户..."或直接用名字）
- 只输出摘要文字，不要标题、编号或其他格式
- 语言简洁直接，每句话都要有具体信息`
    },
    {
      role: "user",
      content: `访谈对象：${p.name || "未知"}，${p.age || "未知"}岁，${p.occupation || "未知"}

对话记录：
${conversation}`
    }
  ];

  try {
    const raw = await withLlmLogging({
      caller: "requirementBuilder.summary",
      teamId: null,
      memberId: null,
      messages: summaryMessages
    }, () => chatCompletion(summaryMessages, { temperature: 0.3, max_tokens: 300 }));
    return String(raw || "").trim();
  } catch (e) {
    console.error("[generateInterviewSummary error]", e);
    return "访谈摘要生成失败，请查看对话记录。";
  }
}

function buildRequirementSpec(requirements, mustHaves, niceToHaves, strategy, persona) {
  const mustHaveItems = (requirements || []).filter((r) => mustHaves.includes(r.id));
  const niceToHaveItems = (requirements || []).filter((r) => niceToHaves.includes(r.id));

  return {
    version: "1.0",
    createdAt: new Date().toISOString(),
    strategy,
    persona: {
      name: persona?.name,
      age: persona?.age,
      occupation: persona?.occupation
    },
    mustHaves: mustHaveItems,
    niceToHaves: niceToHaveItems,
    summary: `Must Have: ${mustHaveItems.map((r) => r.title).join("、")}；\nNice to Have: ${niceToHaveItems.map((r) => r.title).join("、")}`
  };
}

module.exports = { generateRequirements, buildRequirementSpec, generateInterviewSummary };
