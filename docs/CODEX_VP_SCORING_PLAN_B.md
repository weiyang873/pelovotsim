# CODEX_VP_SCORING_PLAN_B.md — VP 评分方案 B：LLM 抽取 + 规则打分

## 概述

将 VP 评分从"LLM 直接输出分数"改为"LLM 抽取结构化特征 → 后端规则计算 C/G/E 分数"。

**改动文件**：
- 新建 `server/llm/vpScorer.js` — 抽取 prompt + 规则打分引擎
- 修改 `server/routes/teamRoutes.js` — 评分流程调用新模块
- 修改 `server/llm/vpCoach.js` — score 模式不再让 LLM 输出分数

**不动的文件**：前端、数据库 schema、Round 2 引擎

---

## 1. 新建 `server/llm/vpScorer.js`

### 1.1 LLM 抽取：从对话历史中提取结构化特征

调用 DeepSeek，让它只做抽取，不做评分。输入是整段对话历史 + 学生选的格子和架构。输出是一个 JSON，包含 10 个字段，每个对应一条评分判据。

**抽取 prompt**：

```
你是一个文本分析工具。请从以下价值主张对话中，提取以下 10 个特征。只输出 JSON，不要任何其他文字。

对话内容：
{conversation}

学生选定的市场：{cellLabel}
学生选定的架构：{architectureLabel}

请判断以下每个特征，输出 JSON：

{
  "has_clear_customer": true/false,
  // 是否有明确的目标客户（不是"所有人""用户"这种泛称）

  "has_scenario": true/false,
  // 是否描述了一个具体的使用场景（有时间、地点、情境）

  "scenario_is_recurring": true/false,
  // 该场景是否是反复发生的（每天/每周），而不是偶发事件

  "pain_has_specificity": true/false,
  // 痛点是否有具体画面（不是"孤独""不方便"这种抽象词）

  "pain_has_structural_cause": true/false,
  // 痛点是否有结构性原因（生活结构/行业结构决定的，不是个人选择）

  "pain_not_extreme_trigger": true/false,
  // 痛点是否不依赖单一极端触发事件（不是"出了事故才需要"）

  "pain_transferable": true/false,
  // 痛点和收益是否能迁移到同类用户（不是只对特定个体成立）

  "gain_not_niche": true/false,
  // 收益是否不仅对少数高敏感用户成立

  "has_mechanism": true/false,
  // 价值创造是否说清了产品的具体机制（不是"AI陪伴""更智能"这种口号）

  "has_alternative_comparison": true/false,
  // 是否提到了替代方案并说明了为什么现有方案不够好

  "has_boundary": true/false,
  // 是否说明了产品的边界（什么时候不管用）

  "architecture_consistent": true/false,
  // 价值主张的内容是否与学生选定的架构一致
  // 体验型应强调情绪/陪伴/互动感，不应主要列功能
  // 功能型应强调实用/效率/任务完成，不应主要讲情感
  // 混合型两者都有但应有主次

  "tob_customer_is_institution": true/false/null
  // 仅 ToB 市场需要判断：客户是否写的是机构而非终端用户
  // ToC 市场填 null
}
```

**调用参数**：`temperature: 0`，`max_tokens: 300`

**解析**：从回复中提取 JSON，所有字段 normalize 为 boolean（null 保留为 null）。如果解析失败，重试一次。两次都失败则返回 null，走 fallback。

### 1.2 规则打分引擎

从抽取的特征计算 C/G/E 分数。每条判据贡献一个增量，累加后 clip 到 1.0-5.0。

```javascript
function calculateScores(features) {
  if (!features) return null;

  // === C（目标客户与场景痛点）===
  // 基础分 1.0，每条判据通过加分
  let C = 1.0;
  if (features.has_clear_customer)       C += 0.8;  // C2: 可识别购买单元
  if (features.has_scenario)             C += 0.6;  // 有场景
  if (features.scenario_is_recurring)    C += 0.6;  // C1+C3: 高频且非偶发
  if (features.pain_has_specificity)     C += 0.8;  // C4: 痛点有画面感
  if (features.pain_has_structural_cause) C += 0.7; // 结构性原因（到5.0的关键）
  // 架构不一致扣分
  if (features.architecture_consistent === false) C -= 0.5;
  // ToB 客户写成终端用户扣分
  if (features.tob_customer_is_institution === false) C -= 0.8;

  // === G（可泛化度）===
  let G = 1.0;
  if (features.pain_not_extreme_trigger) G += 1.0;  // G1: 不依赖极端触发
  if (features.pain_transferable)        G += 1.0;  // G2: 可迁移
  if (features.gain_not_niche)           G += 1.0;  // G3: 非少数人
  if (features.pain_has_structural_cause) G += 0.5; // 结构性原因加持

  // === E（价值创造说服力）===
  let E = 1.0;
  if (features.has_mechanism)            E += 1.2;  // E1: 机制清楚
  if (features.has_alternative_comparison) E += 1.2; // E2: 替代对比
  if (features.has_boundary)             E += 0.8;  // E3: 有边界
  // 架构不一致扣 E
  if (features.architecture_consistent === false) E -= 0.5;

  // Clip to 1.0-5.0, 精确到 0.1
  C = Math.round(Math.max(1.0, Math.min(5.0, C)) * 10) / 10;
  G = Math.round(Math.max(1.0, Math.min(5.0, G)) * 10) / 10;
  E = Math.round(Math.max(1.0, Math.min(5.0, E)) * 10) / 10;

  return { C, G, E };
}
```

### 1.3 反馈生成

分数由规则算出后，还需要一段自然语言反馈给学生看。这部分仍然由 LLM 生成，但不让它给分数——只让它基于已算出的分数写反馈。

```
你是价值主张教练。以下是学生价值主张的评分结果，请为每个维度写一两句自然语言反馈，说明当前水平和怎么能更好。末尾指出最容易提分的方向。

评分结果：
C = {C}/5.0（目标客户与场景痛点）
G = {G}/5.0（可泛化度）
E = {E}/5.0（价值创造说服力）

抽取的特征：
{features_json}

学生的对话历史摘要：
{latest_vp_text}

要求：
- 用自然语言写，不用"好在/缺/补"模板
- 每个维度一两句话
- 末尾指出最容易提分的方向
- 不要自我否定分数的可靠性
- 不给 LOVOT 的具体写法示例
- 总字数不超过 250 字
```

### 1.4 模块导出

```javascript
module.exports = {
  extractFeatures,    // LLM 抽取结构化特征
  calculateScores,    // 规则计算 C/G/E
  generateFeedback,   // LLM 生成反馈文本
  scoreVp             // 一站式：抽取 → 打分 → 反馈
};
```

**`scoreVp(conversation, cellLabel, architectureLabel)` 返回**：

```javascript
{
  features: { has_clear_customer: true, ... },  // 抽取的特征
  scores: { C: 4.2, G: 3.8, E: 3.5 },          // 规则算出的分数
  feedback: "C 4.2——...",                        // LLM 生成的反馈
  raw: { extractReply, feedbackReply }           // 原始 LLM 回复（调试用）
}
```

---

## 2. 修改 `server/routes/teamRoutes.js`

### 2.1 评分流程改造

在 `submitPhase3Vp` 函数中，`mode === "score"` 时的流程从：

```
旧：拼消息 → vpCoach.chat(mode:"score") → LLM 输出分数 → 正则提取
```

改为：

```
新：vpCoach.chat(mode:"chat") 获取 Coach 最新对话回复
  → vpScorer.scoreVp(对话历史, cellLabel, architectureLabel)
  → 返回 { scores, feedback, features }
  → 把 feedback 作为评分回复展示给学生
```

具体改动：

```javascript
const { scoreVp } = require("../llm/vpScorer");

// 在 submitPhase3Vp 里，mode === "score" 时：

// 1. 先用 coach 正常回复（不带评分指令）
const coachOut = await chat(session, userMessage, { mode: "chat" });

// 2. 调用新的评分模块
const conversation = session.messages.map(m => `${m.role}: ${m.content}`).join("\n");
const scoringResult = await scoreVp(conversation, cellLabel, architectureLabel);

// 3. 组合回复
if (scoringResult && scoringResult.scores) {
  scoreValid = true;
  scores = {
    coverage: scoringResult.scores.C,
    generalizability: scoringResult.scores.G,
    effectiveness: scoringResult.scores.E
  };
  // 评分反馈替换 coach 回复
  replyText = scoringResult.feedback;
} else {
  // 抽取失败时 fallback 到 coach 回复
  scoreValid = false;
  replyText = coachOut.replyText;
}
```

### 2.2 confirm 模式

`mode === "confirm"` 时，同样先调 `scoreVp` 获取最终分数，然后让 vpCoach 以 confirm 模式生成 `<vp_result>` JSON，但把 scores 替换为规则算出的分数。

### 2.3 删除旧的兜底逻辑

- 删除 `buildScoreRetryGuide()` — 不再需要"暂时没法稳定评分"的提示
- 删除 `estimatePmfScoreFromText()` — 不再需要文本长度估算
- `parseScoresFromText()` 保留但不再是主评分来源，只作为 confirm 模式的 fallback

---

## 3. 修改 `server/llm/vpCoach.js`

### 3.1 score 模式的注入消息

不再让 LLM 输出 C/G/E 分数。`mode === "score"` 时的注入消息改为：

```javascript
// 删除原来的 score 模式注入消息
// score 模式现在由 vpScorer 处理，coach 只做普通对话
```

实际上 `mode === "score"` 在 coach 这边变成 `mode === "chat"`——coach 不知道学生点了评分，评分完全由 `vpScorer` 独立处理。

### 3.2 confirm 模式

confirm 模式保留，但注入消息里不再要求 LLM 给分数：

```javascript
messages.push({
  role: "user",
  content: "请输出最终确认版本。先输出最终版的一句话价值主张，然后输出 <vp_result> JSON。JSON 字段为 target_customer/scenario_pain/value_creation/boundary。scores 字段不需要你填，系统会自动填入。"
});
```

### 3.3 prompt 中删除评分标准

V8b prompt 中的"## 评分"整个板块可以精简——Coach 不再负责打分，只负责引导对话和收敛。评分标准移到 `vpScorer.js` 的注释里作为文档。

prompt 中保留一句话即可："学生可以随时点击'查看评分'按钮查看当前分数。评分由系统独立计算，你不需要输出分数。"

---

## 4. 规则打分的校准参数

以下权重可以通过配置文件调整，不硬编码：

```javascript
const SCORING_WEIGHTS = {
  C: {
    has_clear_customer:        0.8,
    has_scenario:              0.6,
    scenario_is_recurring:     0.6,
    pain_has_specificity:      0.8,
    pain_has_structural_cause: 0.7,
    architecture_penalty:     -0.5,
    tob_wrong_customer:       -0.8
  },
  G: {
    pain_not_extreme_trigger:  1.0,
    pain_transferable:         1.0,
    gain_not_niche:            1.0,
    pain_has_structural_cause: 0.5
  },
  E: {
    has_mechanism:              1.2,
    has_alternative_comparison: 1.2,
    has_boundary:               0.8,
    architecture_penalty:      -0.5
  }
};
```

这样可以后续根据测试结果微调，不需要改代码。

---

## 5. 分数分布预期

以权重设计，分数分布大致为：

| 学生表现 | C | G | E |
|---------|---|---|---|
| 只写了"给XX提供陪伴机器人" | 1.8 | 1.0 | 1.0 |
| 有客户有场景但很泛 | 2.4-3.0 | 2.0-3.0 | 1.0-2.2 |
| 场景具体+痛点有画面 | 3.4-4.0 | 3.0-3.5 | 2.2-3.4 |
| 全部到位+替代对比+边界 | 4.0-4.5 | 3.5-4.5 | 3.4-4.2 |
| 有结构性原因+全部到位 | 4.5-5.0 | 4.0-5.0 | 3.4-4.2 |

满分 5.0 几乎不可能——需要所有判据都通过且有结构性原因。这符合教学设计。

---

## 6. Fallback 策略

如果 LLM 抽取失败（JSON 解析失败、两次重试都失败）：
- `scoreValid = false`
- 不显示分数
- Coach 回复正常的对话内容
- 前端提示"评分暂时不可用，请继续修改后重试"

不伪造分数，不用文本长度估算。

---

## 7. 检查清单

- [ ] 新建 `server/llm/vpScorer.js`，包含 `extractFeatures`、`calculateScores`、`generateFeedback`、`scoreVp`
- [ ] 抽取 prompt 只让 LLM 输出 JSON，不输出分数
- [ ] 规则打分权重可配置（`SCORING_WEIGHTS` 对象）
- [ ] 反馈生成 prompt 只写反馈文字，不给分数，不给 LOVOT 写法示例
- [ ] `teamRoutes.js` 的 `submitPhase3Vp` 评分流程改用 `vpScorer.scoreVp`
- [ ] 删除 `buildScoreRetryGuide()` 和 `estimatePmfScoreFromText()`
- [ ] `vpCoach.js` 的 score 模式不再注入"输出 C/G/E 评分"指令
- [ ] `vpCoach.js` 的 confirm 模式不再要求 LLM 填 scores 字段
- [ ] VP Coach prompt 删除评分标准板块，加一句"评分由系统独立计算"
- [ ] fallback：抽取失败时 scoreValid=false，不伪造分数
- [ ] 前端不需要改动——分数仍然通过 `scores.coverage/generalizability/effectiveness` 字段返回
