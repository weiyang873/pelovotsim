# CODEX_VP_COACH_FIX_V6.md
## VP Coach + Scorer 修复（三个根因）

### 背景

用 `scripts/test_vp_coach.js` 跑了 6 个场景的自动化测试，53/65 checks 通过，12 个失败。Codex 诊断后归为 5 个根因：

1. **开场白不稳定**：LLM 有时跳过扫地机器人例子（4/6 场景失败）
2. **Coach 堆问题 — prompt 层**：`fourthTask` 模板诊断句叠加追问
3. **Coach 堆问题 — 代码层**：`ensurePersonalExperienceQuestion()` 后处理强行追加一句"你们身边有没有人…"，跟 Coach 已有的问题叠加
4. **Scorer 虚高 — 教练代写当证据**：extraction prompt 允许"教练整合 VP + 学生没否定 = 学生证据"，导致草根老板被打到 C=5 G=5
5. **Scorer 虚高 — 权重天花板太满**：E 只有 3 项特征，全打 2 就正好 5.0，top-end 区分度为零

另外测试脚本的 `no_lovot_option_lists` 检测逻辑有误报（把通用分析里包含"幼儿园"的 bullet 误判为 LOVOT 场景菜单）。

本 spec 一次性修复全部 5 个根因 + 测试脚本误报。改完后用同样的测试脚本 `node scripts/test_vp_coach.js` 再跑一遍对比。

---

## 修复 1：静态开场白（改 vpCoach.js）

### 问题
`buildSystemPrompt` 里写了"第一轮用扫地机器人举例"，但 DeepSeek 经常跳过或缩写。

### 修改方案
`vpCoach.js` 新增一个导出函数 `buildStaticOpening(strategy)`，返回静态开场白字符串。`chat()` 函数在 `chatTurnIndex === 1`（即 session.messages 中没有 assistant 消息）时，**不调用 DeepSeek**，直接返回静态文本。

### 具体改动

#### 1a. 新增 `buildStaticOpening` 函数

在 `vpCoach.js` 中，`buildSystemPrompt` 函数之后，添加：

```javascript
function buildStaticOpening(strategy) {
  const { cellLabel, architectureLabel, jinangSummary, marketJinang, techJinang } = normalizeTeamContext(strategy);

  // 架构定位描述
  const archDesc = {
    "体验型": "主打情感体验价值",
    "混合型": "既要有功能价值，也要有情感体验",
    "功能型": "主打功能实用价值"
  }[architectureLabel] || "";

  // 锦囊提及
  const jinangLines = [];
  if (marketJinang.length > 0) jinangLines.push(`市场能力：${marketJinang.join("、")}`);
  if (techJinang.length > 0) jinangLines.push(`技术能力：${techJinang.join("、")}`);
  const jinangMention = jinangLines.length > 0
    ? `\n\n我注意到你们团队具备${jinangLines.join("，")}的能力，后面可以想想怎么把这些优势用进去。`
    : "";

  // ToB 提醒
  const tobReminder = /ToB|tob|B2B/i.test(cellLabel)
    ? "\n\n提醒一下：你们选的是 ToB 市场，所以买单的客户是企业或机构，不是终端消费者个人。写价值主张时要围绕机构的需求和痛点来写。"
    : "";

  return `你们选的方向是${cellLabel}，产品定位${architectureLabel}${archDesc ? "——" + archDesc : ""}。

在开始之前，先看个例子。扫地机器人的价值主张不是"它能自动扫地"——那是功能描述。好的价值主张是这样的：

"为每天要维持家里整洁但没时间打扫的双职工家庭，提供一台能自主清扫的家用机器人，让他们不在家时地板也能保持干净——而不用请保洁或挤周末时间自己扫。"

这句话做到了三件事：说清了客户是谁和他们的处境；说清了痛点卡在哪；说清了产品带来什么变化、为什么现有方案做不到。${jinangMention}${tobReminder}

请团队讨论 2-3 分钟，写第一版——LOVOT 为什么样的${/ToB|tob|B2B/i.test(cellLabel) ? "企业客户" : "客户"}、在什么场景下、解决了什么问题、为什么现有方案做不到。写好发给我。`;
}
```

#### 1b. 修改 `chat()` 函数，第一轮返回静态开场白

在 `chat()` 函数中，找到 `const systemPrompt = buildSystemPrompt(...)` 那行之前，加入拦截逻辑：

```javascript
  // === 静态开场白：第一轮不调 LLM ===
  const existingAssistantMsgs = (Array.isArray(session?.messages) ? session.messages : [])
    .filter(m => m && m.role === "assistant");
  
  if (mode === "chat" && existingAssistantMsgs.length === 0) {
    const staticOpening = buildStaticOpening(session?.strategy || {});
    return {
      replyText: staticOpening,
      vpResult: null,
      vpResultRaw: null,
      scorePreview: null,
      scoreValid: false,
      scoringRounds: 0
    };
  }
```

这段代码放在 `const requestedMode = ...` 那一行之后、`const systemPrompt = buildSystemPrompt(...)` 之前。

#### 1c. 修改 buildSystemPrompt，删除开场指令

在 `buildSystemPrompt` 中，删除以下段落（约 5 行）：

```
第一轮，用扫地机器人举例说明什么是好的价值主张：

"扫地机器人的价值主张不是'它能自动扫地'——那是功能描述。好的价值主张是这样的：为每天要维持家里整洁但没时间打扫的双职工家庭，提供一台能自主清扫的家用机器人，让他们不在家时地板也能保持干净——而不用请保洁或挤周末时间自己扫。这句话做到了三件事：说清了客户和处境，说清了痛点，说清了产品带来的变化和替代方案的不足。"

然后请学生讨论 2-3 分钟写第一版。
```

替换为：

```
第一轮开场白已由系统自动生成（包含扫地机器人举例和团队锦囊提示），你不需要重复。学生的第一条消息会是他们对方向的初步想法或问题。直接进入点评或引导。
```

#### 1d. 导出 buildStaticOpening

在 `module.exports` 中加入 `buildStaticOpening`：

```javascript
module.exports = {
  chat,
  startWithCanvas,
  buildSystemPrompt,
  buildStaticOpening,  // ← 新增
  parseVpResult,
  parseVpScore,
  parseScoresFromText,
  normalizeScore,
  compactText
};
```

---

## 修复 2：Coach 不堆问题（改 vpCoach.js 的 buildSystemPrompt）

### 问题
prompt 里写了"每轮只推一个方向"，但 DeepSeek 不遵守，尤其是 `fourthTask` 的模板诊断句 + Coach 的追问经常凑成 2-3 个问题。

### 修改方案

#### 2a. 删除 fourthTask 的固定模板句

在 `buildSystemPrompt` 中，找到 `const fourthTask = chatTurnIndex >= 2 ? ...` 这段代码。

**删除整个 fourthTask 变量定义**（从 `const fourthTask = chatTurnIndex >= 2 ?` 到对应的 `: "";`）。

**同时删除** prompt 模板字符串中引用 `${fourthTask}` 的地方。

#### 2b. 删除 ensurePersonalExperienceQuestion 后处理

在 `chat()` 函数中，找到以下代码块并**删除**：

```javascript
    if ((chatTurnIndex === 2 || chatTurnIndex === 3) && !hasRecentAssistantPersonalExperiencePrompt(session?.messages)) {
      replyText = ensurePersonalExperienceQuestion(replyText);
    }
```

这段代码在 Coach 回复后面硬拼一句"你们身边有没有人会是这个产品的真实用户？"。当 Coach 自己已经问了 1-2 个问题时，追加这句就变成 3 个问题。

删除后，personal experience 问题改为**只在 prompt 中保留提示**（`shouldAskPersonalExperience` 那段 prompt 不动），让 LLM 自己决定什么时候自然地插入，而不是代码层硬拼。

同时，`buildSystemPrompt` 中 `shouldAskPersonalExperience` 的措辞改为更柔和的建议（不是必须执行）：

找到：
```
- 这一轮请自然地插入一个需要个人经验才能回答的问题，例如：'你们身边有没有人会是这个产品的真实用户？' 或 '如果你自己是客户，你愿意花多少钱？'。只问一次，语气像讨论中的追问。
```

替换为：
```
- 如果自然合适，可以插入一个需要个人经验的问题（如'你们身边有没有人会是这个产品的真实用户？'），但不要在已经有其他追问的回复里追加。宁可下一轮再问。
```

#### 2c. 在 prompt 末尾加硬约束

在 `buildSystemPrompt` 返回的模板字符串最后（`</vp_result>` 之后），追加：

```

## 硬性格式约束（必须遵守）
1. 你的每条回复里，最多只能包含**一个问号**。如果你要追问，只能问一个问题。
2. 不要在回复末尾贴固定格式的诊断标签。如果你觉得哪里薄弱，自然地融进你的点评里，不要用"当前最需要补强的是：……"这种模板。
3. 回复不超过 150 字（帮学生整合 VP 句子时除外）。
```

---

## 修复 3：Scorer 评分虚高（改 vpScorer.js）

### 问题
Scorer 的 extraction prompt 把 Coach 的增强复述当成了学生的证据。Coach 说"你们的客户是依赖满意度的高端诊所"，学生从来没说过这么完整的话，但 Scorer 认为"学生认可了"就打了高分。

### 修改方案：对话格式标注 + extraction prompt 加强

#### 3a. 修改 `scoreVp` 的调用方式（改调用方，不改函数签名）

`scoreVp(conversation, cellLabel, architectureLabel)` 的 `conversation` 参数，调用方（`teamRoutes.js` 或其他路由文件）在拼接时，必须用以下格式：

```javascript
const conversation = session.messages
  .map(m => {
    const tag = m.role === "user" ? "【学生原话】" : "【教练说的】";
    return `${tag}\n${m.content}`;
  })
  .join("\n\n");
```

**注意：如果 `scoreVp` 的调用方不止一处，全部统一改成这个格式。** 搜索项目中所有 `scoreVp(` 调用，确认 conversation 参数的拼接方式。

同时，`test_vp_coach.js` 测试脚本中也要同步修改（搜索 `scoreVp` 调用处）：

```javascript
const conversation = session.messages
  .map(m => {
    const tag = m.role === "user" ? "【学生原话】" : "【教练说的】";
    return `${tag}\n${m.content}`;
  })
  .join("\n\n");
```

#### 3b. 重写 extraction prompt（改 vpScorer.js 的 `buildExtractPrompt`）

将 `buildExtractPrompt` 函数的**整个函数体**替换为以下内容。不要修改函数签名。

```javascript
function buildExtractPrompt(conversation, cellLabel, architectureLabel) {
  return `你是一个严格的文本分析工具。请根据以下 VP Coach 对话记录，对 13 个特征逐一打分。

## 最重要的规则（必须遵守）

对话记录中有两种角色：
- 【学生原话】：这是学生自己说的内容。**只有这部分才算证据。**
- 【教练说的】：这是 AI 教练的引导和总结。**教练说的任何内容都不算学生的证据。**

**没有例外。** 即使教练帮学生整合了一句完整的价值主张，且学生说了"对""可以""没问题"，你也**不能**把教练写的内容算作学生的证据。学生的"对"只能证明学生同意了，不能证明学生自己能说出那些内容。评分必须基于学生自己主动表达的粒度。

举例：学生只说了"高端诊所"四个字，教练后来总结为"依赖满意度评分和复购率的高端诊所"，学生说"对"。此时 has_clear_customer = 1（学生只给了一个限定"高端"），**不是** 2。

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
```

---

## 修复 4：E 维度权重天花板太满（改 vpScorer.js）

### 问题
E 只有 3 项特征（`has_mechanism`、`has_alternative_comparison`、`has_boundary`），权重分别是 0.75、0.75、0.50。BASE_SCORE = 1.0，三项全打 2 时 E = 1.0 + 1.5 + 1.5 + 1.0 = 5.0，正好顶满。这意味着任何"还不错"的 VP 都很容易拿 5.0，top-end 没有区分度。

### 修改方案

将 E 的三项权重各降 15%，让满分需要更高的证据门槛：

在 `SCORING_WEIGHTS` 对象中，将 E 部分从：

```javascript
  E: {
    has_mechanism: 0.75,
    has_alternative_comparison: 0.75,
    has_boundary: 0.50,
    architecture_penalty: -0.25
  }
```

改为：

```javascript
  E: {
    has_mechanism: 0.65,
    has_alternative_comparison: 0.65,
    has_boundary: 0.40,
    architecture_penalty: -0.25
  }
```

同时对 C 做同样的调整（C 也容易顶满，因为有 5 项正权重）。将 C 部分从：

```javascript
  C: {
    has_clear_customer: 0.45,
    has_scenario: 0.35,
    scenario_is_recurring: 0.35,
    pain_has_specificity: 0.45,
    pain_has_structural_cause: 0.40,
    architecture_penalty: -0.25,
    tob_wrong_customer: -0.40
  }
```

改为：

```javascript
  C: {
    has_clear_customer: 0.40,
    has_scenario: 0.30,
    scenario_is_recurring: 0.30,
    pain_has_specificity: 0.40,
    pain_has_structural_cause: 0.35,
    architecture_penalty: -0.25,
    tob_wrong_customer: -0.40
  }
```

调整后的满分上限（假设所有特征 = 2，无惩罚）：
- C_max = 1.0 + 0.80 + 0.60 + 0.60 + 0.80 + 0.70 = 4.5
- G_max = 1.0 + 0.90 + 1.10 + 1.10 + 0.90 = 5.0（G 不改，本身就较难拿高分）
- E_max = 1.0 + 1.30 + 1.30 + 0.80 = 4.4

这意味着 C 和 E 要拿到 4.5+ 需要所有特征都是 2 且无惩罚，更有区分度。

---

## 修复 5：测试脚本误报修复（改 test_vp_coach.js）

### 问题
`no_lovot_option_lists` 的检测逻辑只要看到两个包含"幼儿园/养老/医院..."的 bullet 就判定失败，但实际触发的是通用分析内容（如"1. 算账…幼儿园… / 2. 对比…幼儿园…"），不是 LOVOT 场景选择菜单。

### 修改方案

在 `runChecks` 函数中，找到 `checks.no_lovot_option_lists` 的检测逻辑，增加额外条件：bullet 内容必须是不同的场景/行业关键词，而不是同一个关键词出现在不同 bullet 中。

将现有的检测逻辑替换为：

```javascript
  checks.no_lovot_option_lists = !coachAfterFirst.some(text => {
    // 检测：是否在同一条回复中列了 3+ 个不同行业/场景的 bullet
    const bullets = text.match(/[-•]\s*.{4,}|^\d[.、）]\s*.{4,}/gm) || [];
    const sceneKeywords = ["诊所", "养老", "幼儿园", "酒店", "银行", "科技公司", "学校", "医院", "商场", "健身房", "月子中心"];
    const matchedScenes = new Set();
    bullets.forEach(b => {
      sceneKeywords.forEach(kw => {
        if (b.includes(kw)) matchedScenes.add(kw);
      });
    });
    // 只有当列出了 3 个以上不同的行业/场景关键词时才算是在列选项
    return matchedScenes.size >= 3;
  });
```

---

## 验收方式

改完后执行：

```bash
source .env
node scripts/test_vp_coach.js
```

### 对比指标（与修复前的 baseline 对比）

| 检查项 | 修复前 | 修复后目标 |
|--------|--------|-----------|
| `opening_has_vacuum_example` | 4/6 失败 | **全部通过**（静态文本，100% 确定） |
| `single_question_per_turn` | 3/6 失败 | **至少 5/6 通过**（删 fourthTask + 删 ensurePersonalExperienceQuestion + 硬约束） |
| `scores_not_all_high` | 3/6 失败 | **全部通过**（Scorer 角色分离 + 权重降天花板） |
| `lazy_boss_scores_reasonable` | 1/1 失败 | **通过**（extraction 只看学生原话，不认可教练代写） |
| `no_lovot_option_lists` | 1/6 失败 | **通过**（检测逻辑修复，需 3+ 不同行业关键词才判定） |
| 总 pass 率 | 53/65 (81.5%) | **≥60/65 (92%)** |

### 完成后提交

1. 终端完整输出（含每个场景的 Scores 和 Checks）
2. `data/vp_coach_test_logs/conversations/` 下 6 个 txt 文件
3. `data/vp_coach_test_logs/report_*.json`

---

## 不要改的东西

- `test_vp_coach_personas.js` 不要动
- `test_vp_coach.js` 中除 conversation 格式和 `no_lovot_option_lists` 检测逻辑外，其余不要动
- `vpScorer.js` 的 `normalizeFeatures`、`clipScore`、`readLevel`、`calculateScores`（函数逻辑不动，只改 `SCORING_WEIGHTS` 的数值）
- `vpCoach.js` 的 `normalizeTeamContext`、`parseVpResult`、`ensureJinangMention` 不要动
- `deepseekClient.js` 不要动
