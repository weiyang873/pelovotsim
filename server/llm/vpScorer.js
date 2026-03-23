const { chatCompletion } = require("./deepseekClient");
const { withLlmLogging } = require("./llm_logger");

const FEATURE_KEYS = [
  "has_clear_customer",
  "has_scenario",
  "scenario_is_recurring",
  "pain_has_specificity",
  "pain_has_structural_cause",
  "pain_not_extreme_trigger",
  "pain_transferable",
  "gain_not_niche",
  "has_mechanism",
  "has_alternative_comparison",
  "has_boundary",
  "architecture_consistent",
  "tob_customer_is_institution"
];

const SCORING_WEIGHTS = {
  C: {
    has_clear_customer: 0.45,
    has_scenario: 0.35,
    scenario_is_recurring: 0.35,
    pain_has_specificity: 0.45,
    pain_has_structural_cause: 0.40,
    architecture_penalty: -0.25,
    tob_wrong_customer: -0.40
  },
  G: {
    pain_not_extreme_trigger: 0.45,
    pain_transferable: 0.55,
    gain_not_niche: 0.55,
    pain_has_structural_cause: 0.45
  },
  E: {
    has_mechanism: 0.75,
    has_alternative_comparison: 0.75,
    has_boundary: 0.50,
    architecture_penalty: -0.25
  }
};

const BASE_SCORE = 1.0;

function parseJsonLoose(raw) {
  const text = String(raw || "").replace(/```json|```/gi, "").trim();
  try {
    return JSON.parse(text);
  } catch (_) {}

  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start >= 0 && end > start) {
    return JSON.parse(text.slice(start, end + 1));
  }
  throw new Error("json parse failed");
}

function normalizeLevel(value, fallback = 0) {
  if (value === null) return null;
  const n = Number(value);
  if (Number.isFinite(n)) {
    return Math.max(0, Math.min(2, Math.round(n)));
  }
  const text = String(value || "").trim().toLowerCase();
  if (text === "null") return null;
  return fallback;
}

function isToBCell(cellLabel) {
  const text = String(cellLabel || "").trim().toLowerCase();
  return /tob|b2b|企业|机构/.test(text);
}

function normalizeFeatures(parsed, cellLabel) {
  const source = parsed && typeof parsed === "object" ? parsed : {};
  const features = {};
  FEATURE_KEYS.forEach((key) => {
    if (key === "tob_customer_is_institution") {
      if (source[key] === null) {
        features[key] = null;
      } else if (source[key] === undefined && !isToBCell(cellLabel)) {
        features[key] = null;
      } else {
        features[key] = normalizeLevel(source[key], 0);
      }
      return;
    }
    features[key] = normalizeLevel(source[key], 0);
  });
  return features;
}

function clipScore(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.round(Math.max(1.0, Math.min(5.0, n)) * 10) / 10;
}

function readLevel(features, key) {
  const raw = features?.[key];
  if (raw == null) return 0;
  return Math.max(0, Math.min(2, Math.round(Number(raw) || 0)));
}

function calculateScores(features) {
  if (!features) return null;
  let C = BASE_SCORE;
  C += readLevel(features, "has_clear_customer") * SCORING_WEIGHTS.C.has_clear_customer;
  C += readLevel(features, "has_scenario") * SCORING_WEIGHTS.C.has_scenario;
  C += readLevel(features, "scenario_is_recurring") * SCORING_WEIGHTS.C.scenario_is_recurring;
  C += readLevel(features, "pain_has_specificity") * SCORING_WEIGHTS.C.pain_has_specificity;
  C += readLevel(features, "pain_has_structural_cause") * SCORING_WEIGHTS.C.pain_has_structural_cause;
  C += (2 - readLevel(features, "architecture_consistent")) * SCORING_WEIGHTS.C.architecture_penalty;
  if (features.tob_customer_is_institution != null) {
    C += (2 - readLevel(features, "tob_customer_is_institution")) * SCORING_WEIGHTS.C.tob_wrong_customer;
  }

  let G = BASE_SCORE;
  G += readLevel(features, "pain_not_extreme_trigger") * SCORING_WEIGHTS.G.pain_not_extreme_trigger;
  G += readLevel(features, "pain_transferable") * SCORING_WEIGHTS.G.pain_transferable;
  G += readLevel(features, "gain_not_niche") * SCORING_WEIGHTS.G.gain_not_niche;
  G += readLevel(features, "pain_has_structural_cause") * SCORING_WEIGHTS.G.pain_has_structural_cause;

  let E = BASE_SCORE;
  E += readLevel(features, "has_mechanism") * SCORING_WEIGHTS.E.has_mechanism;
  E += readLevel(features, "has_alternative_comparison") * SCORING_WEIGHTS.E.has_alternative_comparison;
  E += readLevel(features, "has_boundary") * SCORING_WEIGHTS.E.has_boundary;
  E += (2 - readLevel(features, "architecture_consistent")) * SCORING_WEIGHTS.E.architecture_penalty;

  return {
    C: clipScore(C),
    G: clipScore(G),
    E: clipScore(E)
  };
}

function buildExtractPrompt(conversation, cellLabel, architectureLabel) {
  return `你是一个文本分析工具。请根据以下完整的 VP Coach 对话记录，对 13 个特征逐一打分。对话中包含学生的发言和教练的反馈，请从学生表达的内容中寻找证据。

每个特征只有三个值：
- 0 = 完全没有提到
- 1 = 提到了但模糊、薄弱、不具体
- 2 = 清楚、具体、有说服力

只输出 JSON，不要任何其他文字。

重要规则：
- 你只能根据下面这份对话记录中学生自己说过的内容评分。
- 教练的引导性提问和建议不算学生的证据，只有学生明确表达或认可的内容才算。
- 如果教练帮学生整合了一句完整的价值主张，且学生没有否定，可以作为评分依据。
- 如果只有一句笼统表述，不能按高分处理。

完整 VP Coach 对话记录：
${conversation || "（暂无对话）"}

学生选定的市场：${cellLabel || "未提供"}
学生选定的架构：${architectureLabel || "未提供"}

13 个特征和判断标准如下：

{
  "has_clear_customer": 0,
  "has_scenario": 0,
  "scenario_is_recurring": 0,
  "pain_has_specificity": 0,
  "pain_has_structural_cause": 0,
  "pain_not_extreme_trigger": 0,
  "pain_transferable": 0,
  "gain_not_niche": 0,
  "has_mechanism": 0,
  "has_alternative_comparison": 0,
  "has_boundary": 0,
  "architecture_consistent": 0,
  "tob_customer_is_institution": 0
}

// 0 = 没提客户，或只说"用户""大家""所有人"
// 1 = 提了人群类型但只有 1 个限定（如"养老院""年轻人""企业""老人"）
// 2 = 人群有至少 2 个交叉限定条件（如"一线城市 50-150 床的民营养老院运营负责人"或"25-35 岁独居、月入 1.5 万以上的一线城市女性白领"）

// 0 = 没有描述任何使用场景
// 1 = 提了场景但只有 1 个要素，只有时间、只有地点或只有情境，缺少具体画面
// 2 = 场景有时间、地点、情境中的至少 2 个要素（如"每天晚上八点推开门家里黑灯没声音"）

// 0 = 没提频率，或场景明显是一次性的
// 1 = 暗示了可能重复但没有明确频率
// 2 = 明确是高频场景，且有频率词（如"每天""每次下班""每个工作日晚上"）

// 0 = 痛点只是抽象感受词（如"孤独""不方便""压力大"）
// 1 = 痛点有方向但没具体画面（如"老人孤独""回家没人陪""护工不够"）
// 2 = 痛点有具体画面和可量化后果（如"老人坐着发呆 3 小时，家属投诉要求退住"或"推开门只有冰箱嗡嗡声，连说句话的人都没有"）

// 0 = 痛点是个人选择或偶然因素导致的
// 1 = 暗示了结构性原因但没有展开论证
// 2 = 明确论证了痛点源于不可避免的生活结构或行业结构（如"双职工家庭结构决定了下班后必然有 2-3 小时的陪伴真空"）

// 0 = 痛点依赖极端或偶发事件
// 1 = 痛点日常存在但 VP 只是断言没有论证
// 2 = VP 明确解释了为什么这个痛点是日常性的（给出了结构性原因或频率证据）

// 0 = 痛点只对特定个体成立
// 1 = 痛点看起来普遍但 VP 没有论证迁移性，只是断言"很多人都有"
// 2 = VP 明确给出了至少 2 个不同的用户子群或场景来论证痛点的可迁移性

// 0 = 收益只有小众人群在意
// 1 = 收益看起来不小众但 VP 没有论证为什么多数人需要
// 2 = VP 明确论证了为什么目标人群中的多数人都会受益（有数据、类比或逻辑推理）

// 0 = 只有口号（如"AI陪伴""更智能""更温暖"）
// 1 = 提了产品功能但没说因果链（如"LOVOT 可以陪伴老人"只说了功能没说因此带来什么变化）
// 2 = 说清了具体产品功能 + 用户因此得到的变化 + 为什么比替代方案好（三个要素都要有）

// 0 = 完全没提替代方案
// 1 = 提到了"现有方案不好"但没指出具体是什么方案
// 2 = 指出了至少一种具体的替代方案并说明了差在哪

// 0 = 没有提到任何边界或局限
// 1 = 暗示了某种限制但不明确
// 2 = 明确说了什么时候不管用

// 0 = 价值主张的内容跟选定架构明显矛盾
// 1 = 大方向没有矛盾但重点不够突出
// 2 = 内容跟选定架构高度一致

// 仅当学生选的市场包含 ToB 时判断，否则填 null
// 0 = 客户明显写的是终端用户而不是机构
// 1 = 提到了机构但不清楚是谁决策
// 2 = 客户明确是机构且决策者可识别
// null = 学生选的不是 ToB 市场，此项不适用。但如果学生选的是 ToC 却写了明显的 ToB 场景，请填 0，并在 architecture_consistent 也相应扣分

再次提醒：只能根据这份对话记录里学生明确表达或认可的内容评分，记录里没写出来的内容一律不算证据。`;
}

async function extractFeaturesDetailed(conversation, cellLabel, architectureLabel) {
  const messages = [
    {
      role: "system",
      content: "你是一个文本分析工具。你只能输出一个 JSON 对象。"
    },
    {
      role: "user",
      content: buildExtractPrompt(conversation, cellLabel, architectureLabel)
    }
  ];

  let lastRaw = "";
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const raw = await withLlmLogging({
      caller: "vpScorer.extractFeatures",
      teamId: null,
      memberId: null,
      messages
    }, () => chatCompletion(messages, { temperature: 0, max_tokens: 400 }));
    lastRaw = raw;
    try {
      const parsed = parseJsonLoose(raw);
      return {
        features: normalizeFeatures(parsed, cellLabel),
        raw
      };
    } catch (_) {}
  }

  return { features: null, raw: lastRaw || null };
}

async function extractFeatures(conversation, cellLabel, architectureLabel) {
  const result = await extractFeaturesDetailed(conversation, cellLabel, architectureLabel);
  return result.features;
}

function summarizeLatestVpText(conversation) {
  const lines = String(conversation || "")
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);
  return lines.slice(-8).join("\n") || "（暂无有效摘要）";
}

function buildFeedbackPrompt(scores, features, latestVpText) {
  return `你是价值主张教练。以下是学生价值主张的评分结果，请为每个维度写一两句自然语言反馈，说明当前水平和怎么能更好。末尾指出最容易提分的方向。

评分结果：
C = ${scores.C}/5.0（目标客户与场景痛点）
G = ${scores.G}/5.0（可泛化度）
E = ${scores.E}/5.0（价值创造说服力）

抽取的特征：
${JSON.stringify(features, null, 2)}

学生的对话历史摘要：
${latestVpText}

要求：
- 用自然语言写，不用“好在/缺/补”模板
- 每个维度一两句话
- 末尾指出最容易提分的方向
- 不要自我否定分数的可靠性
- 不给 LOVOT 的具体写法示例
- 总字数不超过 250 字`;
}

function buildFallbackFeedback(scores, features) {
  const weakest = [
    ["C", scores?.C, readLevel(features, "has_clear_customer") < 1 || readLevel(features, "has_scenario") < 1 || readLevel(features, "pain_has_specificity") < 1],
    ["G", scores?.G, readLevel(features, "pain_transferable") < 1 || readLevel(features, "gain_not_niche") < 1],
    ["E", scores?.E, readLevel(features, "has_mechanism") < 1 || readLevel(features, "has_alternative_comparison") < 1 || readLevel(features, "has_boundary") < 1]
  ].sort((a, b) => Number(a[1] || 0) - Number(b[1] || 0))[0]?.[0] || "C";

  return [
    `C ${scores.C}/5.0：目标客户和场景已经有一定基础，但还需要把触发情境与痛点画面说得更具体，最好能看出这件事为何会反复发生。`,
    `G ${scores.G}/5.0：目前的表达还需要证明这不是个别人的特殊问题，而是同类用户会反复遇到、也愿意为之买单的普遍困扰。`,
    `E ${scores.E}/5.0：价值创造逻辑需要更清楚地说明产品如何起作用，并补上现有替代方案为什么不够好、什么时候不适用。`,
    `最容易提分的方向：先补 ${weakest} 维度里最缺的那一条关键证据。`
  ].join("\n");
}

async function generateFeedbackDetailed(scores, features, latestVpText) {
  const raw = await withLlmLogging({
    caller: "vpScorer.generateFeedback",
    teamId: null,
    memberId: null,
    messages: [
      {
        role: "system",
        content: "你是价值主张教练。只输出自然语言反馈，不要输出 JSON。"
      },
      {
        role: "user",
        content: buildFeedbackPrompt(scores, features, latestVpText)
      }
    ]
  }, () => chatCompletion(
    [
      {
        role: "system",
        content: "你是价值主张教练。只输出自然语言反馈，不要输出 JSON。"
      },
      {
        role: "user",
        content: buildFeedbackPrompt(scores, features, latestVpText)
      }
    ],
    { temperature: 0.4, max_tokens: 320 }
  ));

  return {
    feedback: String(raw || "").trim(),
    raw
  };
}

async function generateFeedback(scores, features, latestVpText) {
  const result = await generateFeedbackDetailed(scores, features, latestVpText);
  return result.feedback;
}

async function scoreVp(conversation, cellLabel, architectureLabel) {
  const extracted = await extractFeaturesDetailed(conversation, cellLabel, architectureLabel);
  if (!extracted.features) {
    return {
      features: null,
      scores: null,
      feedback: "",
      raw: {
        extractReply: extracted.raw,
        feedbackReply: null
      }
    };
  }

  const scores = calculateScores(extracted.features);
  const latestVpText = summarizeLatestVpText(conversation);

  try {
    const feedbackResult = await generateFeedbackDetailed(scores, extracted.features, latestVpText);
    return {
      features: extracted.features,
      scores,
      feedback: feedbackResult.feedback,
      raw: {
        extractReply: extracted.raw,
        feedbackReply: feedbackResult.raw
      }
    };
  } catch (_) {
    return {
      features: extracted.features,
      scores,
      feedback: buildFallbackFeedback(scores, extracted.features),
      raw: {
        extractReply: extracted.raw,
        feedbackReply: null
      }
    };
  }
}

module.exports = {
  SCORING_WEIGHTS,
  extractFeatures,
  calculateScores,
  generateFeedback,
  scoreVp
};
