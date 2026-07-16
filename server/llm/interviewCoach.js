// interviewCoach.js - 访谈对话逻辑
const { chatCompletion } = require("./deepseekClient");
const { withLlmLogging } = require("./llm_logger");

const LLM_TIMEOUT_MS = 60000;

const MAX_TURNS = 10;
const MIN_TURNS_TO_END = 5;

function parseJsonLoose(raw) {
  const t = String(raw || "").replace(/```json|```/g, "").trim();
  try {
    return JSON.parse(t);
  } catch (_) {}
  const l = t.indexOf("{");
  const r = t.lastIndexOf("}");
  if (l >= 0 && r > l) return JSON.parse(t.slice(l, r + 1));
  throw new Error("json parse failed");
}

function buildPriceAttitude(strategy) {
  const cellLabel = String(
    strategy?.cell_label || strategy?.cellLabel || strategy?.grid_id || strategy?.gridId || ""
  ).toLowerCase();
  const isToB = /tob|b2b|企业|机构/.test(cellLabel);
  const isDiff = /diff|差异/.test(cellLabel);
  const isCost = /cost|成本/.test(cellLabel);

  if (isToB) {
    return `## 价格态度
你是从机构采购的角度考虑的。你关心的是投入产出比和长期运营成本，不是单价本身。你会问"这个能给我们带来什么效果""用了之后能省多少人力"，而不是讨论具体多少钱一台。你不会说出任何具体数字或预算金额。`;
  }
  if (isDiff) {
    return `## 价格态度
你对价格不是特别敏感。如果一个产品真的能解决你的问题，你愿意为品质买单，不会因为贵一点就放弃。但你也不是不看价格，你会判断"值不值"，而不是"贵不贵"。你不会说出任何具体数字。`;
  }
  if (isCost) {
    return `## 价格态度
你比较在意性价比。花钱会想想值不值，不会冲动消费。你倾向于选择"够用就好"的方案，不愿意为花哨的功能多花钱。但你也不是只看便宜，如果确实能省事省心，你也不是完全不愿意花钱。你不会说出任何具体数字。`;
  }
  return `## 价格态度
你对这类产品没有明确的价格预期。你不会说出任何具体价格或价格区间，因为你确实没想过具体多少钱合适，得看产品具体能做什么再说。`;
}

function buildPersonaSystemPrompt(persona, vpCanvas, strategy) {
  const priceAttitude = buildPriceAttitude(strategy);
  return `你正在扮演一个真实的人，参加一场产品调研访谈。你的角色信息如下：\n\n姓名：${persona.name}，${persona.age}岁\n职业：${persona.occupation}\n居住：${persona.living_situation}\n性格：${persona.personality}\n典型一天：${persona.daily_routine}\n科技态度：${persona.tech_comfort}\n访谈风格：${persona.interview_style}\n\n## 你内心知道的事情（但你不会主动全盘托出）\n- 日常困扰：${(persona.desires || []).join("、")}\n- 真正头疼的事：${(persona.pains || []).join("、")}\n- 最不愿提的事：${persona.hidden_pain}\n- 你自己也纠结的事：${(persona.contradictions || []).join("、")}\n\n【重要】以上内容是你作为这个人的内心世界，不是你要念出来的台词。你在对话中自然地、逐步地流露这些信息，而不是一次性列举或复述原文。\n\n## 扮演规则\n1. 你不知道自己想要什么产品，只知道自己的生活和感受\n2. 被问"你想要什么功能"时，要用生活语言回答，不用产品语言\n3. 会说矛盾的话，比如又想简单又想要很多功能\n4. 不会主动说出所有痛点，需要学生追问\n5. 回答要简短自然（3-5句话），像真实对话\n6. 不要暴露你是 AI，完全入戏\n7. 如果学生问得很表面，你就给表面答案；问得深入，你才深入回答\n8. 你是被邀请来聊天的，不是来咨询产品的。你不会主动问"这个产品能做什么"，除非学生先介绍了产品并邀请你评价。你的默认状态是：聊自己的生活。\n9. 你不会说出任何具体价格、价格区间或数字。如果学生问你"愿意花多少钱""预算是多少""能接受什么价位"，你只表达价格态度，绝不给出数字。如果学生反复追问具体数字，你就说"我真没想过具体多少钱"或"这个得看它能帮我解决什么问题再说"。\n10. 你是一个真实的受访者，不是 AI 助手。你不会主动分享信息。\n11. 如果对方的问题比较短或模糊，你先给一个简短的回答（基于你的真实经历），然后自然地补充一个相关细节或反问一个具体问题，把对话带下去。只有当输入完全无意义（比如一个字、一个数字）时，才表现出困惑。\n12. 不要一次性把所有痛点全说出来，但可以在回答中自然地透露一两个跟话题相关的细节，引出更深的对话。\n13. 问得越具体你答得越详细，问得越泛你答得越简短——但即使问得泛，你也要给出一个真实的回答，而不是拒绝回答。\n14. 绝对不要复述你的人设信息。不要说"我是XX职业""我住在XX""我的运营压力是XX"这种读人设卡片的话。你是这个人，不是在介绍这个人。如果你不知道怎么回答学生的问题，就表现出困惑或转移话题，比如"这个我没太想过""你说的是什么意思？"\n15. 你永远不要说"你可以先问我……""你应该问……""建议你问问……"这类引导对方提问的话。你是受访者，不是访谈主持人。如果你觉得对方问得不够深入，就在回答中自然地抛出一个细节，让对方自己决定是否追问。\n\n${priceAttitude}\n\n## 关于访谈背景\n有人邀请你参加一个产品调研，说是关于"智能家居"或"家用机器人"方面的，你答应了但具体是什么产品你也不太清楚。你来了就是聊聊，没什么预设期待。`;
}

function isPersonaLeakage(reply, persona) {
  const text = String(reply || "");
  const markers = [
    persona?.org_type,
    persona?.org_scale,
    persona?.budget,
    "比起先谈产品",
    "我更愿意先把真实场景",
    "决策压力说清楚",
    "所在机构是",
    "我现在负责",
    "你可以先问我",
    "你可以问问我",
    "你先问我",
    "建议你问",
    "你应该问"
  ].filter((marker) => marker && String(marker).length >= 4);
  const fieldLeaks = markers.filter((marker) => text.includes(marker)).length;
  const guidePatterns = ["你可以先问我", "你可以问问我", "你先问我", "建议你问", "你应该问"];
  const guideLeaks = guidePatterns.filter((p) => text.includes(p)).length;
  return fieldLeaks >= 2 || guideLeaks >= 1;
}

async function assessInfoCompleteness(messages, persona, session) {
  const conversation = messages
    .map((m) => `${m.role === "user" ? "学生" : "客户"}：${m.content}`)
    .join("\n");

  const checkMessages = [
    {
      role: "system",
      content: "你是一个访谈质量评估专家。请评估访谈信息收集完整度，输出严格 JSON，不要其他文字。"
    },
    {
      role: "user",
      content: `以下是访谈对话记录：\n${conversation}\n\nPersona 的关键信息点：\n- 表面需求：${(persona.desires || []).join("、")}\n- 核心痛点：${(persona.pains || []).join("、")}\n- 隐藏痛点：${persona.hidden_pain}\n\n请评估：\n{\n  "complete": true/false,\n  "coverage": 0-100的整数（信息覆盖率）,\n  "uncovered": ["还没挖到的重要信息点"],\n  "reason": "一句话说明是否完整"\n}`
    }
  ];

  try {
    const raw = await withLlmLogging({
      caller: "interviewCoach.assess",
      teamId: session?.teamId || session?.team_id || session?.teamKey || null,
      memberId: session?.memberId || session?.member_id || null,
      messages: checkMessages
    }, () => chatCompletion(checkMessages, { temperature: 0.1, max_tokens: 300, timeoutMs: LLM_TIMEOUT_MS }));
    return parseJsonLoose(raw);
  } catch (_) {
    return { complete: false, coverage: 50, uncovered: [], reason: "评估失败" };
  }
}

async function conductInterview(session, userMessage) {
  const persona = session.persona;
  const systemPrompt = buildPersonaSystemPrompt(persona, session.vpCanvas, session.strategy);

  const turnCount = session.messages.filter((m) => m.role === "user").length + 1;

  const messages = [
    { role: "system", content: systemPrompt },
    ...session.messages.map((m) => ({ role: m.role, content: m.content })),
    { role: "user", content: userMessage }
  ];

  if (turnCount >= 8) {
    messages[0].content += "\n\n【注意】这是访谈的最后几轮，你可以适当透露更多信息，帮助访谈收尾。";
  }

  let reply = await withLlmLogging({
    caller: "interviewCoach.conduct",
    teamId: session?.teamId || session?.team_id || session?.teamKey || null,
    memberId: session?.memberId || session?.member_id || null,
    messages
  }, () => chatCompletion(messages, { temperature: 0.8, max_tokens: 300, timeoutMs: LLM_TIMEOUT_MS }));

  for (let retry = 0; retry < 2 && isPersonaLeakage(reply, persona); retry++) {
    console.warn(`[interviewCoach] persona leakage detected, retry ${retry + 1}`);
    messages.push({ role: "assistant", content: reply });
    messages.push({ role: "user", content: "请用自然对话的方式回答，不要介绍自己的背景信息。" });
    reply = await withLlmLogging({
      caller: "interviewCoach.conduct",
      teamId: session?.teamId || session?.team_id || session?.teamKey || null,
      memberId: session?.memberId || session?.member_id || null,
      messages
    }, () => chatCompletion(messages, { temperature: 0.9, max_tokens: 300, timeoutMs: LLM_TIMEOUT_MS }));
  }

  if (isPersonaLeakage(reply, persona)) {
    reply = "（想了想）这个问题……你能说得更具体一点吗？";
  }

  let assessment = null;
  let canEnd = false;

  if (turnCount % 2 === 0 || turnCount >= MAX_TURNS) {
    const updatedMessages = [...session.messages, { role: "user", content: userMessage }, { role: "assistant", content: reply }];
    assessment = await assessInfoCompleteness(updatedMessages, persona, session);
  }

  return {
    reply,
    turnCount,
    canEnd: turnCount >= MIN_TURNS_TO_END,
    assessment,
    reachedLimit: turnCount >= MAX_TURNS
  };
}

module.exports = { conductInterview, MAX_TURNS, MIN_TURNS_TO_END, buildPersonaSystemPrompt, buildPriceAttitude };
