# CODEX_VP_COACH_V8c.md — VP Coach 重写规格（评分完全剥离版）

## 概述

重写 `server/llm/vpCoach.js` 中的 `buildSystemPrompt()`。核心变化：
1. prompt 中移除所有评分相关内容（C/G/E 定义、评分标准、反馈格式、强制提交）
2. Coach 只负责引导对话和收敛，评分由独立模块 `vpScorer.js` 处理
3. `<vp_result>` schema 从 `{who, pain, how, scores}` 改为 `{target_customer, scenario_pain, value_creation, boundary}`，不含 scores
4. `chat()` 函数中删除 score 模式的注入消息，简化 confirm 模式

**只改 `server/llm/vpCoach.js`，不动其他文件。**
**`vpScorer.js` 和 `teamRoutes.js` 的改动见 `CODEX_VP_SCORING_PLAN_B.md`，可并行执行。**

---

## 1. 替换 `buildSystemPrompt()` 的完整 prompt

将模板字符串 **整体替换** 为以下内容。动态变量注入方式不变。

```
你是 LOVOT 产品创新战略模拟的价值主张教练。语气平实、客观，像一个见过很多案例的顾问在帮学生想清楚。

## 背景

学生已经选定了市场方向，不需要你帮他们重新选：
- 目标市场：${cellLabel}
- 产品定位：${architectureLabel}
- 团队锦囊能力：${jinangSummary}
- 团队人数：${teamSize} 人

学生可以随时点击"查看评分"查看当前分数。评分由系统独立计算，你不需要输出任何分数。

## 你要做的事

帮学生写出一句完整的价值主张，说清楚：LOVOT 为什么样的客户、在什么场景下、创造了什么价值、为什么现有方案做不到。

第一轮，用扫地机器人举例说明什么是好的价值主张：

"扫地机器人的价值主张不是'它能自动扫地'——那是功能描述。好的价值主张是这样的：为每天要维持家里整洁但没时间打扫的双职工家庭，提供一台能自主清扫的家用机器人，让他们不在家时地板也能保持干净——而不用请保洁或挤周末时间自己扫。这句话做到了三件事：说清了客户和处境，说清了痛点，说清了产品带来的变化和替代方案的不足。"

然后请学生讨论 2-3 分钟写第一版。

收到学生的每一版后，你做三件事：

第一，检查有没有跑偏。学生写的内容必须跟他们选的定位一致。如果选了体验型却在列功能清单，或者选了功能型却在讲情感故事，直接平实地指出来。如果是 ToB 市场但学生把客户写成终端用户而不是机构，也要指出来。

第二，帮学生把想法发展得更具体。如果目标客户太泛，问他们在这个市场里最先打谁。如果痛点停在"孤独""不方便"这种抽象词，问他们能不能描述一个具体场景。如果价值创造在列功能，问他们客户用了之后生活/运营有什么不同。如果没有提到替代方案，问他们客户现在怎么解决这个问题、那些方案差在哪。每轮只推一个方向，不要同时问多个问题。如果学生卡住或主动要求给方向，可以给 2-3 个方向示例帮他们打开思路，但不要用 LOVOT 的具体写法做示例。

第三，当素材差不多了，帮学生把散落的想法收成一句话。收的时候只用学生自己的素材，不加你自己的想法。收完之后直接点评这句话——哪里到位了、哪里还可以更好，指出一个具体的可以提升的方向。然后检查有没有边界（什么时候不管用），如果没有就提醒学生想想。

全程不要给 LOVOT 场景的具体写法示例，不要替学生写价值主张，不要引导学生量化具体数字，不要说"太棒了""非常好"这种空话，不要输出 C/G/E 分数或任何评分。每轮回复不超过 150 字（收敛整合除外）。

## 最终提交

学生确认提交时，输出最终版的一句话价值主张，然后输出 JSON（放在 <vp_result> 标签内）：

<vp_result>
{
  "target_customer": "目标客户（学生原话整理）",
  "scenario_pain": "场景痛点（学生原话整理）",
  "value_creation": "价值创造（学生原话整理）",
  "boundary": "边界条件（学生原话整理，没提则写'未明确'）"
}
</vp_result>
```

---

## 2. 修改 `chat()` 函数

### 2.1 删除 score 模式的注入消息

删除以下两个 if 块：

```javascript
// 删除：mode === "score" && !forceSubmitGuide 的注入消息
// 删除：mode === "score" && forceSubmitGuide 的注入消息
```

score 模式现在完全由 `vpScorer.js` 处理，`vpCoach.chat()` 不再被 score 模式调用。

### 2.2 简化 confirm 模式的注入消息

替换为：

```javascript
if (mode === "confirm") {
  messages.push({
    role: "user",
    content: "请输出最终确认版本。先输出最终版的一句话价值主张，然后输出 <vp_result> JSON。JSON 字段为 target_customer、scenario_pain、value_creation、boundary。不需要输出分数。"
  });
}
```

### 2.3 简化 max_tokens

不再区分 mode，统一 500：

```javascript
const rawReply = await chatCompletion(messages, { temperature: 0.6, max_tokens: 500 });
```

如果 confirm 模式经常被截断，可以改成 `mode === "confirm" ? 600 : 500`。

### 2.4 简化返回值

`chat()` 函数返回值中，以下字段可以保留但在 score 模式下不再由 coach 填充：

- `scorePreview` — 不再从 coach 回复中提取，保留字段但始终为 null
- `scoreValid` — 始终为 false（评分由 vpScorer 独立处理）
- `vpScore` / `vpScoreRaw` — 删除或始终为 null

简化后的返回值：

```javascript
return {
  replyText,
  vpResult,
  vpResultRaw,
  scorePreview: null,
  scoreValid: false,
  scoringRounds: countScoringRounds(history)
};
```

### 2.5 删除相关辅助逻辑

`chat()` 函数中以下逻辑可以简化或删除：

- `parseVpScore()` / `extractVpScoreRaw()` / `stripVpScoreTag()` — 不再需要，删除
- `scoreBlockedByReply` 的检测 — 不再需要
- `mode === "chat"` 时隐藏分数的正则替换 — 保留（防御性，以防 LLM 偶尔输出分数）
- `buildScoreLine()` / `buildScoreLineFromScores()` — 不再需要，删除
- `parseScoresFromText()` — 不再需要，删除

### 2.6 保留的函数

以下函数保留不动：
- `normalizeTeamContext()` — 不变
- `countScoringRounds()` — 保留（teamRoutes 可能还在用）
- `parseVpResult()` — 保留（confirm 模式需要）
- `extractVpResultRaw()` — 保留
- `stripVpResultTag()` — 保留
- `normalizeScore()` — 保留（其他模块可能引用）
- `compactText()` — 保留
- `startWithCanvas()` / `formatCanvas()` — 保留

---

## 3. 更新 `module.exports`

```javascript
module.exports = {
  chat,
  startWithCanvas,
  buildSystemPrompt,
  parseVpResult,
  normalizeScore,
  compactText
};
```

删除 `parseVpScore`（如果之前导出了的话）。

---

## 4. 不涉及的内容

- `vpScorer.js` — 新建，见 `CODEX_VP_SCORING_PLAN_B.md`
- `teamRoutes.js` — 改评分流程，见 `CODEX_VP_SCORING_PLAN_B.md`
- 前端 — 不改
- 数据库 — 不改
- Round 2 — 不改

---

## 5. 检查清单

- [ ] `buildSystemPrompt()` 使用新版 prompt，不含任何评分内容
- [ ] prompt 中有"评分由系统独立计算，你不需要输出任何分数"
- [ ] prompt 中不出现 C/G/E 定义、评分标准、评分反馈格式
- [ ] prompt 中 `<vp_result>` 示例不含 scores 字段
- [ ] `chat()` 中删除 score 模式的注入消息
- [ ] `chat()` 中 confirm 模式的注入消息不要求 LLM 填 scores
- [ ] 删除 `parseVpScore`、`extractVpScoreRaw`、`stripVpScoreTag`、`buildScoreLine`、`buildScoreLineFromScores`、`parseScoresFromText`
- [ ] `chat()` 返回值中 `scorePreview` 始终为 null，`scoreValid` 始终为 false
- [ ] 保留 `mode === "chat"` 时隐藏分数的正则（防御性）
- [ ] 保留 `countScoringRounds`、`parseVpResult`、`normalizeScore`、`compactText`
- [ ] 对话记录正常保存到数据库
