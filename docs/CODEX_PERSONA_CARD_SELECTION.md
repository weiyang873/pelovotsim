# CODEX_PERSONA_CARD_SELECTION.md — Persona 驱动选卡 + coverCore 导出修复

## 1. Persona 驱动选卡

在 `scripts/sim/persona_student.js` 新增 `generateCardSelection` 方法，替代 `team_runner.js` 中现有的算法选卡。

### 做法

把可选卡列表（`GET /api/rd/cards` 返回的 `capability_groups_v2.json`）+ 该成员的访谈摘要 + 预算约束 + 成员负责的维度，发给 DeepSeek。system prompt 注入完整 persona 背景（复用 `buildBaseSystemPrompt`）。让 LLM 以该原型风格选卡。

Fallback：DeepSeek 失败时用现有算法选卡。

### Prompt 模板

```text
你是一位读 EMBA 的中国商业人士，正在为 LOVOT 机器人选择研发能力卡。

{persona 背景，复用 buildBaseSystemPrompt}

## 你的访谈发现
{interview_summary}

## 你负责的维度
{assigned_dims}

## 预算约束
- 总 dCOGS 预算上限约 ¥{budget_cap}
- 每张卡有 dCOGS（增加硬件成本）和 NRE（研发固定成本）

## 可选卡列表
{cards_json，每张卡包含 cap_id, name, dimension, tiers: {low/mid/high 各自的 dCOGS, risk, nre}}

请选择 6-10 张卡，输出 JSON：
{
  "selections": [
    { "cap_id": "xxx", "tier": "mid", "reason": "一句话理由" }
  ]
}

选卡原则（用你自己的判断）：
- 优先选跟访谈发现相关的卡
- 你负责的维度必须选卡
- 不要超预算
- tier 选择反映你的风险偏好
```

### LLM 调用参数

- model: `deepseek-chat`
- temperature: 0.7
- max_tokens: 1500
- 输出必须是可 JSON.parse 的

### team_runner.js 改动

- `r2_member_selections` 步骤改为调用 `persona_student.generateCardSelection()`
- 传入参数：`{ cards, interviewSummary, assignedDims, budgetCap }`
- 把选卡理由（`reason`）也存到 tracker 的 `r2_personal_selections` 里

---

## 2. 修 coverCore/coverNice 导出缺失

### 问题

上次 10 队满载的 `teams_summary.csv` 中 `coverCore` 和 `coverNice` 列是空的。

### 修法

在 `team_runner.js` 的 `r2_calculate_preview` 或 `r2_submit_final` 步骤中，从 calculate 返回值取 coverCore 和 coverNice，存入 tracker：

```javascript
tracker.team.r2_coverCore = calcResult.coverCore;
tracker.team.r2_coverNice = calcResult.coverNice;
```

在 `data_export.js` 中确保 `sim_teams` 表和 `teams_summary.csv` 输出这两列。

---

## 3. 验证

改完后：

1. `source .env && node server.js &`
2. `sleep 3`
3. `NUM_TEAMS=2 TEAM_SIZE=3 node scripts/persona_sim_test.js`
4. 贴出来：
   - 2 队每个成员的选卡结果（`selections` + `reason`），从日志或 tracker 中取
   - `teams_summary.csv` 的 `coverCore, coverNice, r2_profit` 列（确认非空）
   - 不同原型的选卡风格差异（比如技术创业者是不是选了更多高档卡）
5. `kill` 服务器

---

## 4. 不要动的东西

- `server/llm/rdCalculator.js`（不改引擎）
- `server/routes/round2Routes.js`（不改后端）
- 现有的 prompt 约束（方向 A）和 embedding fallback 保留
- 算法选卡作为 fallback 保留，不删除
