// vpCoach.js - VP Coach logic v5b
const { chatCompletion } = require("./deepseekClient");
const { withLlmLogging } = require("./llm_logger");

function normalizeTeamContext(strategy) {
  const s = strategy && typeof strategy === "object" ? strategy : {};
  const cellLabel = String(
    s.cell_label || s.cellLabel || s.grid_label || s.gridLabel || s.grid_id || s.gridId || "未提供"
  ).trim() || "未提供";

  const architectureRaw = String(s.architecture_label || s.architectureLabel || s.architecture || "").trim();
  const architectureMap = {
    Experience: "体验型",
    Hybrid: "混合型",
    Function: "功能型"
  };
  const architectureLabel = architectureMap[architectureRaw] || architectureRaw || "未提供";

  const jinangRaw = s.jinang || s.jinang_summary || s.jinangSummary || "";
  const normalizeList = (value) => {
    if (!Array.isArray(value)) return [];
    return value
      .map((x) => {
        if (typeof x === "string") return x.trim();
        if (x && typeof x === "object") return String(x.title || x.name || x.label || x.id || "").trim();
        return "";
      })
      .filter(Boolean);
  };
  let marketJinang = normalizeList(jinangRaw.market || s.jinang_market_list || s.jinangMarketList);
  let techJinang = normalizeList(jinangRaw.tech || s.jinang_tech_list || s.jinangTechList);
  if ((!marketJinang.length && !techJinang.length)) {
    const summaryList = normalizeList(jinangRaw);
    if (summaryList.length > 0) {
      marketJinang = summaryList;
    }
  }
  const jinangSummary = [
    marketJinang.length ? `市场能力：${marketJinang.join("、")}` : "",
    techJinang.length ? `技术能力：${techJinang.join("、")}` : ""
  ].filter(Boolean).join("；") || "暂无";

  const sizeNum = Number(s.team_size || s.teamSize || 0);
  const teamSize = Number.isFinite(sizeNum) && sizeNum > 0 ? String(Math.round(sizeNum)) : "未提供";

  return { cellLabel, architectureLabel, jinangSummary, teamSize, marketJinang, techJinang };
}

function countScoringRounds(messages) {
  const list = Array.isArray(messages) ? messages : [];
  return list.filter((m) => {
    if (!m || m.role !== "assistant") return false;
    const content = String(m.content || "");
    return /\d\.\d\/5\.0/.test(content);
  }).length;
}

function buildSystemPrompt(strategy, runtime = {}) {
  const { cellLabel, architectureLabel, jinangSummary, teamSize, marketJinang, techJinang } = normalizeTeamContext(strategy);
  const chatTurnIndex = Number(runtime.chatTurnIndex || 0);
  const shouldMentionJinang = chatTurnIndex === 1;
  const shouldAskPersonalExperience = chatTurnIndex === 2 || chatTurnIndex === 3;

  return `你是 LOVOT 产品创新战略模拟的价值主张教练。语气平实、客观，像一个见过很多案例的顾问在帮学生想清楚。

## 背景

学生已经选定了市场方向，不需要你帮他们重新选：
- 目标市场：${cellLabel}
- 产品定位：${architectureLabel}
- 团队锦囊能力：${jinangSummary}
- 团队人数：${teamSize} 人

这个团队的成员拿到了以下能力锦囊：
- 市场能力：${marketJinang.length ? marketJinang.join("、") : "暂无"}
- 技术能力：${techJinang.length ? techJinang.join("、") : "暂无"}

学生可以随时点击"查看评分"查看当前分数。评分由系统独立计算，你不需要输出任何分数。

## 你要做的事

帮学生写出一句完整的价值主张，说清楚：LOVOT 为什么样的客户、在什么场景下、创造了什么价值、为什么现有方案做不到。

第一轮，用扫地机器人举例说明什么是好的价值主张：

"扫地机器人的价值主张不是'它能自动扫地'——那是功能描述。好的价值主张是这样的：为每天要维持家里整洁但没时间打扫的双职工家庭，提供一台能自主清扫的家用机器人，让他们不在家时地板也能保持干净——而不用请保洁或挤周末时间自己扫。这句话做到了三件事：说清了客户和处境，说清了痛点，说清了产品带来的变化和替代方案的不足。"

然后请学生讨论 2-3 分钟写第一版。

收到学生的每一版后，你做三件事：

第一，检查有没有跑偏。学生写的内容必须跟他们选的定位一致。如果选了体验型却在列功能清单，或者选了功能型却在讲情感故事，直接平实地指出来。如果是 ToB 市场但学生把客户写成终端用户而不是机构，也要指出来。

第二，帮学生把想法发展得更具体。如果目标客户太泛，问他们在这个市场里最先打谁。如果痛点停在"孤独""不方便"这种抽象词，问他们能不能描述一个具体场景。如果价值创造在列功能，问他们客户用了之后生活/运营有什么不同。如果没有提到替代方案，问他们客户现在怎么解决这个问题、那些方案差在哪。每轮只推一个方向，不要同时问多个问题。如果学生卡住或主动要求给方向，可以给 2-3 个方向示例帮他们打开思路，但不要用 LOVOT 的具体写法做示例。

第三，帮学生整理和收敛。这是你最重要的工作之一——学生的写作能力有限，他们在对话中说出的零散想法需要你帮他们组织成一句完整的价值主张。具体规则：
- 当学生的素材差不多了（目标客户、场景痛点、价值创造基本清楚），你就主动帮他们收成一句话。不要等学生要求。
- 每次学生补充了新的素材或修改了方向，你都要重新帮他们整理一版新的完整句子。不是只整理一次——每次有更新都要重写。
- 整理时只用学生自己说过的素材，不加你自己的想法。
- 整理完之后直接点评这句话——哪里到位了、哪里还可以更好，指出一个具体的可以提升的方向。
- 如果学生主动说"你帮我写个草稿"或"帮我整理一下"，立刻帮他们写，不要拒绝。
- 检查有没有边界（什么时候不管用），如果没有就提醒学生想想。

轮次附加要求：
${shouldMentionJinang ? "- 这是第一轮反馈。请自然地提到 1-2 张锦囊，问团队有没有考虑怎么发挥这些能力。例如：'我注意到你们团队有人具备区域经销网络的能力——你们的方案里有考虑怎么利用这个优势吗？'" : "- 如果当前方案明显和团队锦囊能力矛盾，请点出来。"}
${shouldAskPersonalExperience ? "- 这一轮请自然地插入一个需要个人经验才能回答的问题，例如：'你们身边有没有人会是这个产品的真实用户？' 或 '如果你自己是客户，你愿意花多少钱？'。只问一次，语气像讨论中的追问。" : ""}

全程不要在发散阶段给 LOVOT 场景的具体写法做示例。不要引导学生量化具体数字。不要说"太棒了""非常好"这种空话。评分模式以外不要输出 C/G/E 分数或任何评分。每轮回复不超过 150 字（收敛整合除外）。

## 最终提交

学生确认提交时，输出最终版的一句话价值主张，然后输出 JSON（放在 <vp_result> 标签内）：

<vp_result>
{
  "target_customer": "目标客户（学生原话整理）",
  "scenario_pain": "场景痛点（学生原话整理）",
  "value_creation": "价值创造（学生原话整理）",
  "boundary": "边界条件（学生原话整理，没提则写'未明确'）"
}
</vp_result>`;
}

function parseVpResult(text) {
  const match = String(text || "").match(/<vp_result>([\s\S]*?)<\/vp_result>/i);
  if (!match) return null;
  try {
    return JSON.parse(match[1].trim());
  } catch (e) {
    console.error("VP result JSON parse failed", e);
    return null;
  }
}

function extractVpResultRaw(text) {
  const match = String(text || "").match(/<vp_result>[\s\S]*?<\/vp_result>/i);
  return match ? match[0].trim() : null;
}

function stripVpResultTag(text) {
  return String(text || "")
    .replace(/<vp_result>[\s\S]*?<\/vp_result>/ig, "")
    .replace(/<vp_result>[\s\S]*$/ig, "")
    .trim();
}

function normalizeScore(v, fallback = null) {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(1.0, Math.min(5.0, Math.round(n * 10) / 10));
}

function parseVpScore() {
  return null;
}

function parseScoresFromText() {
  return null;
}

function compactText(text) {
  return String(text || "")
    .replace(/\r/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function hasAnyMention(text, items) {
  const src = String(text || "");
  return (Array.isArray(items) ? items : []).some((item) => {
    const key = String(item || "").trim();
    return key && src.includes(key);
  });
}

function ensureJinangMention(text, marketJinang, techJinang) {
  const reply = compactText(text);
  const market = (Array.isArray(marketJinang) ? marketJinang : []).filter(Boolean);
  const tech = (Array.isArray(techJinang) ? techJinang : []).filter(Boolean);
  if (hasAnyMention(reply, market) || hasAnyMention(reply, tech) || /锦囊|能力/.test(reply)) {
    return reply;
  }

  const picked = [];
  if (market[0]) picked.push(`我注意到你们团队有人具备“${market[0]}”这张市场锦囊`);
  if (tech[0]) picked.push(`也有人具备“${tech[0]}”这张技术锦囊`);
  if (picked.length === 0) return reply;

  return compactText(`${picked.join("，")}。你们这一版里有考虑怎么把这个优势用进去吗？\n\n${reply}`);
}

function ensurePersonalExperienceQuestion(text) {
  const reply = compactText(text);
  if (/[？?]/.test(reply) && /你们身边|你见过|你自己|真实用户|愿意花多少钱/.test(reply)) {
    return reply;
  }
  return compactText(`${reply}\n\n顺便追问一句：你们身边有没有人会是这个产品的真实用户？`);
}

function hasRecentAssistantPersonalExperiencePrompt(messages) {
  const list = Array.isArray(messages) ? messages : [];
  for (let i = list.length - 1; i >= 0; i -= 1) {
    const item = list[i];
    if (!item || item.role !== "assistant") continue;
    const content = String(item.content || "").trim();
    if (!content) continue;
    return /身边|真实用户/.test(content);
  }
  return false;
}

async function chat(session, userMessage, options = {}) {
  const requestedMode = options.mode || (options.isSubmit ? "score" : "chat");
  const mode = requestedMode === "score" ? "chat" : requestedMode;
  const scoringRounds = countScoringRounds(Array.isArray(session?.messages) ? session.messages : []);
  const forceSubmitGuide = Boolean(options.forceSubmitGuide);
  const finalRoundHint = forceSubmitGuide ? "，本轮后只能确认提交" : "";
  const chatTurnIndex = mode === "chat"
    ? (Array.isArray(session?.messages) ? session.messages.filter((item) => item && item.role === "assistant").length : 0) + 1
    : 0;
  const strategyContext = normalizeTeamContext(session?.strategy || {});

  const systemPrompt = buildSystemPrompt(session?.strategy || {}, { finalRoundHint, chatTurnIndex });
  const messages = [
    { role: "system", content: systemPrompt },
    ...((Array.isArray(session?.messages) ? session.messages : []).map((m) => ({ role: m.role, content: m.content }))),
    { role: "user", content: String(userMessage || "") }
  ];

  if (mode === "confirm") {
    messages.push({
      role: "user",
      content: "请输出最终确认版本。先输出最终版的一句话价值主张，然后输出 <vp_result> JSON。JSON 字段为 target_customer/scenario_pain/value_creation/boundary。scores 字段不需要你填，系统会自动填入。"
    });
  }

  const temperature = options.temperature !== undefined ? options.temperature : 0.6;
  const maxTokens = mode === "confirm" ? 800 : 500;
  const rawReply = await withLlmLogging({
    caller: "vpCoach.chat",
    teamId: session?.teamId || session?.team_id || session?.teamKey || null,
    memberId: session?.memberId || session?.member_id || null,
    messages
  }, () => chatCompletion(messages, { temperature, max_tokens: maxTokens }));
  const vpResult = parseVpResult(rawReply);
  const vpResultRaw = extractVpResultRaw(rawReply);
  let replyText = compactText(stripVpResultTag(rawReply));
  let scorePreview = null;
  let scoreValid = false;

  if (mode === "confirm" && !replyText) {
    replyText = "已确认提交，最终结果如下。";
  }

  if (mode === "chat") {
    replyText = replyText
      .replace(/(?:^|\n).*?(?:\d\.\d\s*\/\s*5(?:\.0)?|\b[CGE]\s*[:：=]?\s*[1-5](?:\.\d)?\b).*(?=\n|$)/gi, "")
      .replace(/(?:^|\n)\*{0,2}评分[:：]?\*{0,2}(?=\n|$)/gi, "")
      .replace(/(?:^|\n).*继续修改，或者确认提交.*(?=\n|$)/gi, "")
      .replace(/(?:^|\n).*本轮后请确认提交。*(?=\n|$)/gi, "")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
    if (chatTurnIndex === 1) {
      replyText = ensureJinangMention(replyText, strategyContext.marketJinang, strategyContext.techJinang);
    }
    if ((chatTurnIndex === 2 || chatTurnIndex === 3) && !hasRecentAssistantPersonalExperiencePrompt(session?.messages)) {
      replyText = ensurePersonalExperienceQuestion(replyText);
    }
    scorePreview = null;
    scoreValid = false;
  }

  replyText = replyText
    .replace(/[\uFFFD\uFFFE\uFFFF]/g, "")
    .replace(/\uD800[\uDC00-\uDFFF]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, "")
    .trim();

  return {
    replyText,
    vpResult,
    vpResultRaw,
    scorePreview,
    scoreValid,
    scoringRounds
  };
}

async function startWithCanvas(session, vpCanvas) {
  const canvasText = formatCanvas(vpCanvas);
  const firstMessage = `以下是我们团队的 Value Proposition Canvas 初稿：\n\n${canvasText}\n\n请帮我们点评。`;
  return chat(session, firstMessage, { mode: "chat" });
}

function formatCanvas(canvas) {
  if (!canvas) return "（未提供）";
  if (typeof canvas === "string") return canvas;

  return [
    "【客户档案】",
    `Customer Jobs：${canvas.customerJobs || ""}`,
    `Pains：${canvas.pains || ""}`,
    `Gains：${canvas.gains || ""}`,
    "",
    "【价值地图】",
    `Products & Services：${canvas.products || ""}`,
    `Pain Relievers：${canvas.painRelievers || ""}`,
    `Gain Creators：${canvas.gainCreators || ""}`
  ].join("\n");
}

module.exports = {
  chat,
  startWithCanvas,
  buildSystemPrompt,
  parseVpResult,
  parseVpScore,
  parseScoresFromText,
  normalizeScore,
  compactText
};
