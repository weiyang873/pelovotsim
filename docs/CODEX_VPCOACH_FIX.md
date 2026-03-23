# CODEX_VPCOACH_FIX.md

## 修复 vpCoach.js 两个问题

### Bug 1：回复被截断

**问题**：第 185 行 `replyText = limitLength(replyText, 150)` 把所有回复硬截到 150 字符，导致开场白和评分反馈都不完整。

**修复**：删除这行。回复长度由 LLM 的 system prompt 控制（"不超过 150 字"），不需要代码硬截。同时删除 stuck reply 中的 `limitLength` 调用（第 159 行）。

```diff
- replyText = limitLength(replyText, 150);
```

```diff
- const stuckReply = limitLength(compactText(buildStuckReply(userMessage)), 150);
+ const stuckReply = compactText(buildStuckReply(userMessage));
```

### Bug 2：评分时机

**问题**：当前 prompt 要求收到学生第一版 VP 后就给 C/G/E 评分。改为：对话过程中只做定性反馈（指出哪里好、哪里需要改进），不给分数。分数只在最终提交时才出现。

**修复**：修改 system prompt 中的对话流程部分。

将阶段二改为：

```
### 阶段二：诊断反馈（不评分）

收到第一版后，指出最弱的 1-2 个方面，用自然语言说明问题在哪。
- 不给 C/G/E 数字评分
- 说"你的 WHO 还不够具体，只说了年轻人但没有可识别特征"，而不是"C=2/5"
- 提出 1 个具体问题引导改进
```

将阶段三改为：

```
### 阶段三：迭代改进（第 2-3 轮，仍不评分）

每轮：
1. 收到学生修改后的内容
2. 用自然语言说明改进了什么、还差什么
3. 如果还有短板，提出 1 个问题
4. 如果三个要素都足够清晰具体，告知可以提交

最多 3 轮迭代。第 3 轮后无论质量如何，引导提交。
```

阶段四（最终提交）保持不变——只在这时才输出 C/G/E 评分和 `<vp_result>` JSON。

同时，`countScoringRounds` 函数的逻辑也要调整——既然对话中不再出现 "/5"，改为计算用户消息轮数：

```javascript
function countUserRounds(messages) {
  const list = Array.isArray(messages) ? messages : [];
  return list.filter(m => m && m.role === 'user').length;
}
```

第 152 行的判断改为：
```javascript
const userRounds = countUserRounds(history);
const forceSubmitGuide = userRounds >= 4; // 学生发了4条消息后，引导提交
```

### Bug 3（附带修复）：compactText 破坏格式

`compactText` 把所有换行压成空格，导致 Coach 回复的结构被破坏。改为保留单个换行：

```javascript
function compactText(text) {
  return String(text || "")
    .replace(/\r/g, "")
    .replace(/\n{3,}/g, "\n\n")  // 只压缩连续3+换行
    .trim();
}
```

---

## Checklist

- [ ] 删除 `limitLength(replyText, 150)` 硬截
- [ ] 删除 stuck reply 的 `limitLength`
- [ ] System prompt 阶段二、三改为不评分（只做定性反馈）
- [ ] 阶段四（最终提交）才输出 C/G/E 评分 + `<vp_result>` JSON
- [ ] `countScoringRounds` 改为 `countUserRounds`，基于用户消息轮数判断
- [ ] `compactText` 保留单换行
- [ ] 测试：发送 3 条消息，确认没有出现 "/5" 或数字评分
- [ ] 测试：点提交后，确认出现 C/G/E 评分和 `<vp_result>` JSON
