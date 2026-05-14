// tagExtractor.js - LLM 标签提取 + Level 1 缓存
const crypto = require("crypto");
const { chatCompletion } = require("./deepseekClient");
const { withLlmLogging } = require("./llm_logger");
const { kvGet, kvSet } = require("../db/kvCache");

const CACHE_NAME = "tag_extractor_v2";

function normalizeText(text) {
  return String(text || "").trim().replace(/\s+/g, " ").replace(/[“”]/g, '"');
}

async function extractTags(messages) {
  // 完整对话，区分角色
  const conversationText = messages
    .map(m => `${m.role === "user" ? "【学生提问】" : "【客户回答】"}：${m.content}`)
    .join("\n");

  if (!conversationText.trim()) {
    throw new Error("没有对话内容可供分析");
  }

  const normalized = normalizeText(conversationText);
  const cacheKey = crypto.createHash("md5").update(normalized).digest("hex");

  // 查 Level 1 缓存
  const cached = await kvGet(CACHE_NAME, cacheKey);
  if (cached) {
    console.log("[TagExtractor] Level 1 缓存命中");
    return cached;
  }

  // 调用 LLM 提取带极性的标签
  const llmMessages = [
    {
      role: "system",
      content: `你是需求分析专家。从客户访谈对话中提取需求标签并判断极性。

理解规则：
- 【学生提问】代表提问方向，不代表客户需求
- 【客户回答】代表客户的真实态度
- 结合上下文判断：学生问"需要语音吗"，客户答"需要" → 语音交互 positive
- 结合上下文判断：学生问"需要语音吗"，客户答"不需要" → 语音交互 negative
- 客户主动提到的需求直接判断极性

输出规则：
1. 只输出 JSON 数组，不要任何其他文字
2. 每个标签是对象：{"tag": "名词短语", "polarity": "positive"或"negative"}
3. tag 必须是名词短语，≤6个汉字
4. 必须输出 8-12 个标签
5. polarity：positive = 客户想要，negative = 客户明确不想要
6. 禁止动词短语、形容词、长句

示例输出：
[
  {"tag": "情感陪伴", "polarity": "positive"},
  {"tag": "语音交互", "polarity": "negative"},
  {"tag": "安全监护", "polarity": "positive"}
]`
    },
    {
      role: "user",
      content: `请从以下访谈对话中提取需求标签：\n\n${conversationText}`
    }
  ];

  const raw = await withLlmLogging({
    caller: "tagExtractor.extract",
    teamId: null,
    memberId: null,
    messages: llmMessages
  }, () => chatCompletion(llmMessages, { temperature: 0, max_tokens: 300 }));

  let tags;
  try {
    const cleaned = raw.replace(/```json|```/g, "").trim();
    tags = JSON.parse(cleaned);
    if (!Array.isArray(tags) || tags.length < 8 || tags.length > 12) {
      throw new Error(`标签数量不对: ${tags.length}`);
    }
    tags.forEach(t => {
      if (!t.tag || !t.polarity || !["positive", "negative"].includes(t.polarity)) {
        throw new Error(`标签格式错误: ${JSON.stringify(t)}`);
      }
    });
  } catch (e) {
    throw new Error(`标签提取失败: ${e.message}，原始输出: ${raw.slice(0, 100)}`);
  }

  // 写入 Level 1 缓存
  await kvSet(CACHE_NAME, cacheKey, tags);

  return tags;
}

module.exports = { extractTags };
