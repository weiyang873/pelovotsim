# CODEX_VP_SYNTHESIZE_AND_SCORE.md
## VP 合成 + 评分重构 + 测试脚本

### 背景

当前 VP Coach 和 Scorer 存在一个根本设计问题：Scorer 评的是整段对话历史，导致 Coach 的复述和组装被当成学生证据，分数失真。

新方案：Coach 对话和 VP 评分完全分离。Coach 在对话区做引导，学生点"合成VP"时单独调一次 LLM 把对话素材组装成一句 VP，Scorer 只评这句 VP，不看对话。

本 spec 只改后端逻辑和测试脚本，不碰前端。

---

## 改动 1：vpCoach.js 新增 `synthesizeVP()` 函数

### 功能

从 `session.messages` 对话历史中提取学生提供的素材，组装成一句完整的 VP 句子。

### 函数签名

```javascript
async function synthesizeVP(session) {
  // 返回 { vpText: "为...提供...解决...", raw: "LLM原始输出" }
}
```

### 实现

```javascript
async function synthesizeVP(session) {
  const { cellLabel, architectureLabel } = normalizeTeamContext(session?.strategy || {});
  const history = (Array.isArray(session?.messages) ? session.messages : [])
    .map(m => {
      const tag = m.role === "user" ? "学生" : "教练";
      return `${tag}：${m.content}`;
    })
    .join("\n\n");

  const messages = [
    {
      role: "system",
      content: `你是一个价值主张整理工具。你的唯一任务是从对话记录中提取学生讨论的素材，组装成一句完整的价值主张。

规则：
1. 只用对话中出现过的素材（学生说的 + 教练帮学生整理过且学生没有否定的内容）
2. 不要加你自己的想法或信息
3. 输出格式：一句话，用引号包裹。结构是："为[目标客户]，在[场景]下，解决[痛点]的问题，提供[产品/方案]——[为什么现有方案做不到]。[边界条件，如果有的话]"
4. 如果对话中某个要素（客户/场景/痛点/方案/替代对比/边界）还没讨论到，就在那个位置写"（待补充）"
5. 只输出这句话，不要输出任何解释、点评、评分`
    },
    {
      role: "user",
      content: `学生选定的市场：${cellLabel}
学生选定的架构：${architectureLabel}

对话记录：
${history}

请从以上对话中提取素材，组装成一句完整的价值主张。`
    }
  ];

  const raw = await withLlmLogging({
    caller: "vpCoach.synthesizeVP",
    teamId: session?.teamId || session?.team_id || null,
    memberId: null,
    messages
  }, () => chatCompletion(messages, { temperature: 0.3, max_tokens: 300 }));

  // 提取引号内的 VP 句子
  const quotedMatch = String(raw || "").match(/[""「]([^""」]{20,})[""」]/);
  const vpText = quotedMatch
    ? quotedMatch[1].trim()
    : String(raw || "").replace(/^[""\s]+|[""\s]+$/g, "").trim();

  return { vpText, raw: String(raw || "") };
}
```

### 导出

在 `module.exports` 中加入 `synthesizeVP`。

---

## 改动 2：vpScorer.js 新增 `scoreVpText()` 函数

### 功能

评分一句独立的 VP 句子（不是对话历史）。这是未来"查看评分"按钮调用的函数。

### 函数签名

```javascript
async function scoreVpText(vpText, cellLabel, architectureLabel) {
  // 返回 { features, scores, feedback, raw }
}
```

### 实现

新增一个 `buildExtractPromptForVP` 函数（与现有 `buildExtractPrompt` 并存，不删旧的）：

```javascript
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
- "为养老机构"只有一个限定 → has_clear_customer=1。"为面临护工成本上涨和夜间跌倒风险的养老机构"有两个交叉限定 → has_clear_customer=2

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
  2 = 说清了：功能 → 用户变化 → 为什么比替代好（三要素齐全）

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
```

然后 `scoreVpText` 复用现有的 `calculateScores`、`generateFeedback` 等函数：

```javascript
async function scoreVpText(vpText, cellLabel, architectureLabel) {
  if (!vpText || vpText.length < 10) {
    return { features: null, scores: null, feedback: "VP 文本过短，无法评分。", raw: null };
  }

  // Feature extraction
  const extractMessages = [
    { role: "system", content: "你是一个文本分析工具。你只能输出一个 JSON 对象。" },
    { role: "user", content: buildExtractPromptForVP(vpText, cellLabel, architectureLabel) }
  ];

  let features = null;
  let extractRaw = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    const raw = await withLlmLogging({
      caller: "vpScorer.scoreVpText.extract",
      teamId: null, memberId: null,
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

  // Feedback
  try {
    const feedbackResult = await generateFeedbackDetailed(scores, features, vpText);
    return {
      features, scores,
      feedback: feedbackResult.feedback,
      raw: { extractReply: extractRaw, feedbackReply: feedbackResult.raw }
    };
  } catch (_) {
    return {
      features, scores,
      feedback: buildFallbackFeedback(scores, features),
      raw: { extractReply: extractRaw, feedbackReply: null }
    };
  }
}
```

### 导出

在 `module.exports` 中加入 `scoreVpText` 和 `buildExtractPromptForVP`。保留旧的 `scoreVp` 不删（向后兼容）。

---

## 改动 3：测试脚本 `scripts/test_vp_coach_v2.js`

### 概要

新建测试脚本（不覆盖旧的），模拟完整的"聊 → 合成 → 评分 → 再聊 → 再合成 → 再评分 → 提交"流程。

### 测试流程（每个 scenario）

```
Phase 1: 对话 4 轮（persona ↔ Coach）
Phase 2: 调 synthesizeVP() → 得到 VP v1
Phase 3: 调 scoreVpText(VP v1) → 得到 scores v1
Phase 4: 对话 3 轮（persona 根据 feedback 继续补充）
Phase 5: 调 synthesizeVP() → 得到 VP v2
Phase 6: 调 scoreVpText(VP v2) → 得到 scores v2
Phase 7: 第 3 次 synthesizeVP() = 最终提交
```

### 自动检查

沿用 v1 的 Coach 行为检查，新增以下：

```javascript
// VP 合成检查
// CHECK: VP v1 不为空且长度 > 30 字
checks.vp_v1_not_empty = vpV1.vpText.length > 30;

// CHECK: VP v2 不为空且长度 > 30 字
checks.vp_v2_not_empty = vpV2.vpText.length > 30;

// CHECK: VP v1 和 v2 不完全相同（说明第二轮对话产生了更新）
checks.vp_improved = vpV1.vpText !== vpV2.vpText;

// CHECK: scores v2 的 C+G+E 总分 >= scores v1（聊了更多应该有改善或持平）
checks.scores_improved_or_stable =
  (scoresV2.C + scoresV2.G + scoresV2.E) >= (scoresV1.C + scoresV1.G + scoresV1.E) - 0.5;

// CHECK: 草根老板的 VP v1 分数不应该太高（毕竟只聊了 4 轮碎片）
if (persona.id === "lazy_boss") {
  checks.lazy_boss_v1_not_inflated = scoresV1.C <= 3.5 && scoresV1.G <= 3.5;
}

// CHECK: VP 句子里不包含"（待补充）"（说明素材足够组装完整 VP）
checks.vp_v2_complete = !vpV2.vpText.includes("待补充");

// CHECK: Scorer 评的是 VP 句子本身，不是对话历史
// 验证方式：features 中 has_boundary 的值应该和 VP 句子是否包含边界语句一致
const vpMentionsBoundary = /不管用|不适用|打折扣|除外|但.*时|局限/.test(vpV2.vpText);
checks.boundary_feature_matches_vp = vpMentionsBoundary === (features.has_boundary >= 1);
```

### txt 输出格式

每个 scenario 的 txt 包含 5 个区块：

```
[System Prompt] — Coach 的 system prompt
[对话记录]     — 逐轮对话（Phase 1 + Phase 4）
[VP v1]        — 第一次合成的 VP + 评分
[VP v2]        — 第二次合成的 VP + 评分
[最终 VP]      — 第三次合成（提交版）
[Checks]       — ✅/❌ 列表
```

### Scenario 和 Persona

复用 `test_vp_coach_personas.js` 的 4 个 persona 和 `test_vp_coach.js` 的 6 个 scenario。

### Persona 回复生成

Phase 4 的 persona 回复需要看到 scores v1 的 feedback，模拟学生看到评分后针对性补充：

```javascript
async function generatePersonaReplyWithFeedback(persona, coachMessage, history, scenario, scoreFeedback) {
  const recentHistory = history.slice(-6)
    .map(m => `${m.role === "user" ? "学生" : "教练"}：${m.content}`)
    .join("\n");

  const messages = [
    { role: "system", content: persona.systemPrompt },
    {
      role: "user",
      content: `你正在和 AI 策略顾问讨论你们团队的价值主张。

你们选的市场方向：${scenario.grid}
产品定位：${scenario.arch}型

你刚看了评分反馈，系统告诉你：
"${scoreFeedback}"

讨论的核心是三个方面：
1. 目标客户是谁——越具体越好
2. 痛点是什么——要描述具体场景和频率
3. LOVOT 怎么解决——要说清具体机制和因果链

最近对话：
${recentHistory}

教练刚说的：
「${coachMessage}」

根据评分反馈，尝试补充你之前没说到的信息。用你自然的方式回复。`
    }
  ];

  try {
    const reply = await chatCompletion(messages, { temperature: 0.9, max_tokens: 150 });
    return String(reply || "").trim() || "嗯，继续";
  } catch (err) {
    return "你说呢？";
  }
}
```

---

## 改动 4：Scorer feedback prompt 微调

`buildFeedbackPrompt` 中的"学生的对话历史摘要"改为"学生的价值主张"：

将：
```
学生的对话历史摘要：
${latestVpText}
```

改为：
```
学生的价值主张：
${latestVpText}
```

确保 feedback 是针对 VP 句子的点评，不是对话的总结。

---

## 验收标准

1. `node scripts/test_vp_coach_v2.js` 跑通 6 个场景不崩溃
2. 每个 scenario 的 txt 包含 5 个区块（system prompt / 对话 / VP v1 + 分数 / VP v2 + 分数 / 最终 VP / checks）
3. VP v1 和 VP v2 是不同的句子（说明第二轮对话有效果）
4. 草根老板的 VP v1 分数合理（C, G ≤ 3.5）
5. 体制转型者如果 VP 里全是政策套话没有具体画面，has_pain_specificity 不应该是 2
6. 终端打印汇总 + `report_*.json`

---

## 不要改的东西

- `vpCoach.js` 的 `chat()` 函数不动
- `vpCoach.js` 的 `buildStaticOpening()` 不动
- `vpScorer.js` 的旧函数 `scoreVp()`、`extractFeatures()` 保留不删（向后兼容）
- `vpScorer.js` 的 `SCORING_WEIGHTS`、`calculateScores`、`normalizeFeatures` 不动
- `test_vp_coach.js`（v1 测试脚本）保留不动
- `test_vp_coach_personas.js` 不动

---

## 运行方式

```bash
source .env
node scripts/test_vp_coach_v2.js
```

预计运行时间：6 场景 × 约 22 次 API 调用 = 约 130 次调用，15-20 分钟。

---

## 给 Codex 的命令

```
读 docs/CODEX_VP_SYNTHESIZE_AND_SCORE.md，按改动 1-4 实现。

实现完后：
1. source .env
2. 只跑第一个场景验证能跑通（SCENARIOS 里只保留 index 0）
3. 贴出来：
   - 终端完整输出
   - 生成的 txt 文件完整内容
4. 确认没问题后恢复全部 6 个场景，但不需要再跑
```
