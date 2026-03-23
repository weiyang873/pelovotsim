# Round 2 R&D v7 迁移说明

本文档说明从 v6 到 v7 的计算口径迁移要点，覆盖后端公式变化、API 变化、前端对接点与兼容字段。

## 1. 口径变化（核心）

- v6 份额核心：`share = sigmoid(z)`
- v7 份额核心：`share = adoption(P) * S_competitive * R`
  - `adoption(P)`：价格采用率
  - `S_competitive`：非价格竞争力份额
  - `R`：可靠性折扣（可选扩展；默认可禁用）

- v6 超预算影响：通过 `z_penalty` 间接压份额
- v7 超预算影响：通过 `penalty` 直接扣总利润（不直接打死份额）

- v7 新增研发溢价：
  - `wtpPrime = WTP * (1 + gamma * V)`

- v7 新增 ROI：
  - `roi = profit / rdInvestment`（当 `rdInvestment=0` 时为 `null`）

## 2. 默认参数（v7 当前实现）

`server/llm/rdCalculator.js` 中 `DEFAULT_PARAMS` 关键项：

- `gamma: 0.15`
- `alpha0: -0.5`
- `omega_risk: 0.35`
- `omega_cost: 0.20`
- `beta_core: 2.0`
- `rho_budget: 0`
- `rho_cap: 0`

说明：
- `rho_budget=0, rho_cap=0` 时，`R=1`（默认不启用可靠性折扣）。
- 若要启用 R 折扣，可将上述 rho 参数调整为正值。

## 3. 函数变更

## 3.1 `computeValueScore(...)`

- v7 公式新增成本惩罚项（式30口径）：
  - `- omega_cost * (positiveDCOGS / COGSbase)`
- 新签名：
  - `computeValueScore(coverCore, coverNice, subLift, risk, positiveDCOGS, COGSbase, params)`

## 3.2 `computeCompetitiveShare(...)`

- 移除 evi 二次使用（式36口径）：
  - `Z = alpha0 + beta_core*coverCore + beta_nice*coverNice + beta_sub*subLift - beta_risk*risk - beta_cx*complexity`
- 新签名：
  - `computeCompetitiveShare(coverCore, coverNice, subLift, risk, complexity, params)`

## 3.3 `calculate(...)`

v7 主流程保持 Steps 1-7（访谈权重融合、覆盖率、选卡汇总）不变，后续替换为 v7 逻辑：

1. `V = computeValueScore(...)`
2. `wtpPrime = WTP * (1 + gamma * V)`
3. `adoption = computeAdoption(P, wtpPrime, e)`
4. `S_competitive = computeCompetitiveShare(...)`
5. `penalty/R = computePenaltyAndReliability(...)`
6. `share = adoption * S_competitive * R`
7. 利润分解与 ROI

## 4. API 变化

## 4.1 `POST /api/rd/calculate`

v7 对接建议必传字段：

- `P`（学生定价）
- `WTP`（Round 1 冻结）
- `e`（Round 1 冻结）

其余沿用：
- `gridId, f, COGSbase, TAM, H, Pmax, radar, tags, evi, selections`

## 4.2 新增 `POST /api/rd/preview-price`

用途：前端定价滑块实时预览（轻量，不跑完整链路）

请求字段：
- `P, WTP, e, V, COGSbase, dCOGS, f, TAM, H, Pmax, S_competitive, R`

返回字段：
- `adoption, share, units, unitProfit, profit, wtpPrime`

## 4.3 `GET /api/round2/recap` 补充字段

为前端定价滑块，recap 现已可返回：
- `WTP`
- `e`

## 5. 前端对接要点

在 `client/src/pages/Round2Flow.jsx`：

- 已支持定价滑块（Step 3 / Step 5）
- 滑块调用 `POST /api/rd/preview-price` 实时展示：
  - adoption / share / units / profit / WTP'
- `calculate` 请求已传 `P/WTP/e`
- Step 6 已展示三核心：
  - `ROI / 总利润 / 销量`

## 6. 兼容字段说明

为兼容旧 UI 与旧脚本，`calculate()` 仍保留部分 v6 字段：

- `covercore / covernice`
- `sub_lift`
- `softPenalties / z_penalty / risk_add`
- `profit_hw / profit_sub / COGS / unit_profit_hw / LTV_sub`

这些字段可逐步下线；当前保留用于平滑迁移。

## 7. 验证命令

```bash
node scripts/test-rd-v7.js
node scripts/test-rd.js
cd client && npm run build
```

预期：
- `test-rd-v7.js` 输出 `🎉 ALL PASSED — v7 口径确认`
- `test-rd.js` 继续通过（兼容校验）
- 前端构建成功
