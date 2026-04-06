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
    has_clear_customer: 0.40,
    has_scenario: 0.30,
    scenario_is_recurring: 0.30,
    pain_has_specificity: 0.40,
    pain_has_structural_cause: 0.35,
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
    has_mechanism: 0.65,
    has_alternative_comparison: 0.65,
    has_boundary: 0.40,
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
  return `你是一个严格的文本分析工具。请根据以下 VP Coach 对话记录，对 13 个特征逐一打分。

## 最重要的规则（必须遵守）

对话记录中有两种角色：
- 【学生原话】：这是学生自己说的内容。只有这部分才算证据。
- 【教练说的】：这是 AI 教练的引导和总结。教练说的任何内容都不算学生的证据。

没有例外。即使教练帮学生整合了一句完整的价值主张，且学生说了"对""可以""没问题"，你也不能把教练写的内容算作学生的证据。学生的"对"只能证明学生同意了，不能证明学生自己能说出那些内容。评分必须基于学生自己主动表达的粒度。

举例：学生只说了"高端诊所"四个字，教练后来总结为"依赖满意度评分和复购率的高端诊所"，学生说"对"。此时 has_clear_customer = 1，不是 2。

## 每个特征只有三个值
- 0 = 学生完全没有提到相关内容
- 1 = 学生提到了但模糊、薄弱、只有一个要素
- 2 = 学生说得清楚、具体、有至少两个交叉要素或有画面感

只输出 JSON，不要任何其他文字。

## 完整对话记录
${conversation || "（暂无对话）"}

## 学生选定的市场：${cellLabel || "未提供"}
## 学生选定的架构：${architectureLabel || "未提供"}

## 13 个特征的评分标准

has_clear_customer:
  0 = 学生没说客户是谁，或只说"用户""大家""所有人"
  1 = 学生说了一个人群类型但只有 1 个限定（如只说"养老院"或"年轻人"或"企业"）
  2 = 学生给了至少 2 个交叉限定（如"一线城市的民营养老院"或"25-35岁独居白领"）

has_scenario:
  0 = 学生没有描述任何使用场景
  1 = 学生提了场景但只有 1 个要素（只有地点，或只有时间，或只有情境）
  2 = 学生描述的场景有时间+地点+情境中的至少 2 个

scenario_is_recurring:
  0 = 学生没提频率，或场景明显是一次性的
  1 = 学生暗示了可能重复但没有明确频率
  2 = 学生明确说了是高频场景（有"每天""每次""经常"等频率词）

pain_has_specificity:
  0 = 学生的痛点只是抽象词（"孤独""不方便""压力大"）
  1 = 学生的痛点有方向但没具体画面（"老人孤独""回家没人陪"）
  2 = 学生给了有画面感的痛点描述（"老人坐着发呆 3 小时""推开门只有冰箱嗡嗡声"）

pain_has_structural_cause:
  0 = 学生没有解释痛点为什么存在
  1 = 学生暗示了原因但没展开
  2 = 学生明确说了痛点的结构性原因（如"双职工结构决定了陪伴真空"）

pain_not_extreme_trigger:
  0 = 学生描述的痛点依赖极端或偶发事件
  1 = 学生的痛点日常存在但只是断言没论证
  2 = 学生解释了为什么这个痛点是日常性的

pain_transferable:
  0 = 学生的痛点只对特定个体成立
  1 = 学生说"很多人都有"但没有论证
  2 = 学生给了至少 2 个不同的用户子群或场景来论证迁移性

gain_not_niche:
  0 = 学生描述的收益只有小众人群在意
  1 = 收益看起来不小众但学生没论证
  2 = 学生论证了为什么多数目标用户都会受益

has_mechanism:
  0 = 学生只有口号（"AI陪伴""更智能""交互卖萌"）
  1 = 学生提了产品功能但没说因果链
  2 = 学生说清了：具体功能 → 用户因此得到的变化 → 为什么比替代方案好（三要素都要有）

has_alternative_comparison:
  0 = 学生完全没提替代方案
  1 = 学生提到了"现有方案不好"但没说具体是什么
  2 = 学生指出了至少一种具体替代方案并说明了差在哪

has_boundary:
  0 = 学生没有提到任何边界或局限
  1 = 学生暗示了某种限制但不明确
  2 = 学生明确说了什么情况下不管用

architecture_consistent:
  0 = 学生描述的价值主张跟选定架构明显矛盾
  1 = 大方向没矛盾但重点不够突出
  2 = 内容跟选定架构高度一致

tob_customer_is_institution:
  仅当市场包含 ToB 时判断，否则填 null
  0 = 学生的客户明显是终端用户而不是机构
  1 = 学生提到了机构但不清楚谁决策
  2 = 学生明确说了客户是机构且决策者可识别
  null = 不是 ToB 市场

输出格式（只输出这个 JSON，不要其他任何文字）：
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
}`;
}

function buildExtractPromptForVP(vpText, cellLabel, architectureLabel) {
  return `你是一个严格的文本分析工具。请对以下这句价值主张进行 13 个特征的评分。

## 待评分的价值主张
"${vpText}"

## 学生选定的市场：${cellLabel || "未提供"}
## 学生选定的架构：${architectureLabel || "未提供"}

## 评分规则

每个特征只有三个值：
- 0 = 这句话里完全没有涉及该方面
- 1 = 提到了但模糊、笼统、只有一个要素
- 2 = 说得清楚、具体、有至少两个交叉要素或有画面感

注意：
- 只评这句话本身包含的信息，不要推测或脑补
- 政策性套话（"赋能""优化""提升"）如果没有具体画面或因果链，不能打 2
- "为养老机构"只有一个限定 -> has_clear_customer=1。"为面临护工成本上涨和夜间跌倒风险的养老机构"有两个交叉限定 -> has_clear_customer=2

## 13 个特征

has_clear_customer:
  0 = 没有说客户是谁，或只说"用户""大家"
  1 = 说了客户类型但只有 1 个限定（如只说"养老院"或"年轻人"）
  2 = 有至少 2 个交叉限定（如"面临护工成本上涨的民营养老院"）

has_scenario:
  0 = 没有描述使用场景
  1 = 提了场景但只有 1 个要素
  2 = 场景有时间+地点+情境中的至少 2 个

scenario_is_recurring:
  0 = 没提频率，或场景明显是一次性的
  1 = 暗示可能重复但没有明确频率
  2 = 明确是高频场景（有"每天""每次"等频率词，或场景本身是日常性的如"夜间巡房"）

pain_has_specificity:
  0 = 痛点只是抽象词（"孤独""不方便""压力大"）
  1 = 痛点有方向但没具体画面（"老人孤独""人手不够"）
  2 = 有具体画面或可量化后果（"老人半夜离床跌倒""员工巡房时被老人聊天打断无法完成工作"）

pain_has_structural_cause:
  0 = 没有解释痛点为什么存在
  1 = 暗示了原因但没展开
  2 = 明确说了结构性原因（如"护工成本刚性上涨""双职工结构"）

pain_not_extreme_trigger:
  0 = 痛点依赖极端或偶发事件
  1 = 痛点日常存在但只是断言
  2 = 痛点是日常性的且有解释

pain_transferable:
  0 = 痛点只对特定个体成立
  1 = 看起来普遍但没论证
  2 = 给了至少 2 个子群或场景来论证迁移性

gain_not_niche:
  0 = 收益只有小众人群在意
  1 = 收益不小众但没论证
  2 = 论证了为什么多数目标用户都会受益

has_mechanism:
  0 = 只有口号（"AI陪伴""更智能"）
  1 = 提了功能但没说因果链
  2 = 说清了：功能 -> 用户变化 -> 为什么比替代好（三要素齐全）

has_alternative_comparison:
  0 = 没提替代方案
  1 = 提到"现有方案不好"但没说具体是什么
  2 = 指出了具体替代方案并说明差在哪

has_boundary:
  0 = 没有提到边界
  1 = 暗示了限制但不明确
  2 = 明确说了什么情况下不管用

architecture_consistent:
  0 = VP 内容跟选定架构明显矛盾
  1 = 大方向没矛盾但重点不突出
  2 = 内容跟选定架构高度一致

tob_customer_is_institution:
  仅当市场包含 ToB 时判断，否则填 null
  0 = 客户明显是终端用户不是机构
  1 = 提到机构但不清楚谁决策
  2 = 客户明确是机构且决策者可识别
  null = 不是 ToB 市场

只输出 JSON，不要其他任何文字：
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
}`;
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

function buildFeedbackPrompt(scores, features, latestVpText, cellLabel) {
  return `你是 EMBA 商业模拟的评分系统。学生已提交锁定了最终版价值主张，你需要写一段评语。

## 学生选择的市场
${cellLabel || "未提供"}

## 学生的价值主张
"${latestVpText}"

## 评分结果（不要在评语中出现这些维度名称或数值）
C=${scores.C}  G=${scores.G}  E=${scores.E}

## 评语规则
- 全程用"你们"称呼学生
- 从最大的失分点讲起，不要先说优点
- 不要逐条检查要素是否存在（禁止出现"已经写出""也已交代""对应关系成立"这类打勾式表述）
- 不要引用VP原文超过8个字；要概括而不是复述
- 不要提C/G/E名称或数值
- 不要给改进建议（VP已锁定）
- 写成一整段，150-200字
- 语气：直接、专业、有判断。说"客户太宽"而不是"客户描述偏宽"，说"因果链没打通"而不是"对应关系有待加强"

## 示例

### 示例1（C偏低）
你们当前锁定的是ToB·差异·老人市场。最大的问题在客户——"高端私立养老院"听起来具体，但其实什么类型的机构都能套进去，没有说清是连锁还是单体、床位规模多大、谁来拍板采购。客户越模糊，后面的痛点和解法再好也缺一个锚点。痛点本身方向对了，老人退住风险确实是机构的核心焦虑，解法也给出了机制——用主动互动替代被动看护，因果链是通的。替代方案和边界条件都有，框架完整。拉分的就是客户这一项：收窄到一种具体的机构类型，整个VP的可信度会上一个台阶。

### 示例2（各项均衡高分）
你们这版VP结构扎实。客户锁定了200床以上的民营连锁养老机构的运营总监，一读就知道要打谁、谁签字。痛点指向夜间巡检的人力刚性成本，这是行业公认的结构性难题，不是个别机构的特殊情况。解法用离床监测替代部分人工巡检，从功能到效果到财务价值一层层递进，跟痛点咬得很紧。替代方案对比和边界条件都到位。唯一可以更锐利的是痛点可以再加一层数据——比如夜间巡检占总人力成本的比例——但这不影响整体判断。

### 示例3（G和E都低）
你们选的是ToC·差异·成人市场。目前最大的短板是痛点和解法都太空——"现代人压力大需要陪伴"是一个普遍情绪，不是一个可以建产品的痛点，因为它没有指向任何具体场景：什么时候需要陪伴？在哪？替代什么？解法说"提供情感陪伴"，但没有说机器人具体做什么动作、怎么触发、效果怎么衡量，跟痛点之间缺少因果链。客户写了"25-35岁独居白领"，这一项反而是相对清晰的。

现在写评语：`;
}

function buildFallbackFeedback(scores, features) {
  const parts = [];
  const C = scores?.C || 1;
  const G = scores?.G || 1;
  const E = scores?.E || 1;

  const dims = [
    { name: "客户", score: C, desc: getCFallback(features) },
    { name: "痛点", score: G, desc: getGFallback(features) },
    { name: "解法", score: E, desc: getEFallback(features) }
  ].sort((a, b) => a.score - b.score);

  for (const dim of dims) {
    parts.push(dim.desc);
  }
  return parts.join("");
}

function getCFallback(features) {
  if (readLevel(features, "has_clear_customer") < 1) return "你们的客户没有写清楚是谁。";
  if (readLevel(features, "has_clear_customer") < 2) return "你们的客户有方向但限定不够，还不够具体。";
  return "你们的客户描述清晰。";
}

function getGFallback(features) {
  if (readLevel(features, "pain_transferable") < 1) return "你们的痛点只对个别人成立，普遍性不足。";
  if (readLevel(features, "pain_has_structural_cause") < 1) return "你们的痛点缺少结构性原因，说服力有限。";
  return "你们的痛点有普遍性。";
}

function getEFallback(features) {
  if (readLevel(features, "has_mechanism") < 1) return "你们的解法只有口号，没有说清机制。";
  if (readLevel(features, "has_alternative_comparison") < 1) return "你们缺少替代方案对比。";
  return "你们的解法机制清晰。";
}

async function generateFeedbackDetailed(scores, features, latestVpText, cellLabel) {
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
        content: buildFeedbackPrompt(scores, features, latestVpText, cellLabel)
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
        content: buildFeedbackPrompt(scores, features, latestVpText, cellLabel)
      }
    ],
    { temperature: 0.4, max_tokens: 320 }
  ));

  return {
    feedback: String(raw || "").replace(/\s*\n+\s*/g, " ").trim(),
    raw
  };
}

async function generateFeedback(scores, features, latestVpText, cellLabel) {
  const result = await generateFeedbackDetailed(scores, features, latestVpText, cellLabel);
  return result.feedback;
}

async function scoreVpText(vpText, cellLabel, architectureLabel) {
  if (!vpText || vpText.length < 10) {
    return { features: null, scores: null, feedback: "VP 文本过短，无法评分。", raw: null };
  }

  const extractMessages = [
    { role: "system", content: "你是一个文本分析工具。你只能输出一个 JSON 对象。" },
    { role: "user", content: buildExtractPromptForVP(vpText, cellLabel, architectureLabel) }
  ];

  let features = null;
  let extractRaw = null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const raw = await withLlmLogging({
      caller: "vpScorer.scoreVpText.extract",
      teamId: null,
      memberId: null,
      messages: extractMessages
    }, () => chatCompletion(extractMessages, { temperature: 0, max_tokens: 400 }));
    extractRaw = raw;
    try {
      const parsed = parseJsonLoose(raw);
      features = normalizeFeatures(parsed, cellLabel);
      break;
    } catch (_) {}
  }

  if (!features) {
    return { features: null, scores: null, feedback: "特征提取失败。", raw: { extractReply: extractRaw } };
  }

  const scores = calculateScores(features);

  try {
    const feedbackResult = await generateFeedbackDetailed(scores, features, vpText, cellLabel);
    return {
      features,
      scores,
      feedback: feedbackResult.feedback,
      raw: { extractReply: extractRaw, feedbackReply: feedbackResult.raw }
    };
  } catch (_) {
    return {
      features,
      scores,
      feedback: buildFallbackFeedback(scores, features),
      raw: { extractReply: extractRaw, feedbackReply: null }
    };
  }
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
    const feedbackResult = await generateFeedbackDetailed(scores, extracted.features, latestVpText, cellLabel);
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
  buildExtractPromptForVP,
  generateFeedback,
  scoreVpText,
  scoreVp
};
