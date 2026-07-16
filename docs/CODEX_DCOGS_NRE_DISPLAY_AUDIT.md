# dCOGS / NRE 展示口径核对

版本：2026-07-16

本报告只核对现有前端展示口径，不修改 dCOGS/NRE 展示逻辑。

## 选卡页口径

位置：`client/src/pages/Round2Flow.jsx`

- `renderDimGroup(dimId, sel, false, "individual")`：个人选卡页传入 `showCost=false`。
- `renderCard(..., showCost=false)` 下，每张卡每个 tier 显示：
  - `单位成本：轻/中/较重/重/降本`
  - `研发投入：轻/中/较重/重`
  - `card.nreDesc` 交付/投入描述文字
  - `td.d` tier 交付描述文字
- 选卡页不显示精确 dCOGS 数字，也不显示精确 NRE 万元数。

档位规则：

- dCOGS：`<0=降本`，`abs<300=轻`，`abs<500=中`，`abs<750=较重`，其余为 `重`。
- NRE：`<60=轻`，`<120=中`，`<180=较重`，其余为 `重`。

## 合并页 / 团队页口径

位置：`client/src/pages/Round2Flow.jsx`

- `renderDimGroup(dim.id, teamSel, true, "team")`：团队页传入 `showCost=true`。
- `renderCard(..., showCost=true)` 下，每张卡每个 tier 显示精确：
  - `{formatSignedCurrency(td.cost)}/台`
  - `NRE {td.nre}万`
- 合并页还显示：
  - dCOGS 合计：`formatSignedCurrency(teamCalc.cost)`
  - NRE 合计：`teamCalc.nreWan}万`
  - 单台总变动成本：`V + dCOGS`
  - 分维度汇总：`formatSignedCurrency(dimCost) / NRE {dimNre}万`
  - 已合并能力卡 chip：`卡名 · tier · 精确 dCOGS/台 · 精确 NRE 万`

## 对照结论

当前两页口径是不一致但有明确分层的：

- 选卡页：定性成本感知，不给精确价格，学生只能看到轻/中/较重/重和交付描述。
- 合并页：成本结构第一次揭示，给精确 dCOGS、NRE、汇总和单台总变动成本。

需要 WY 拍板的问题：

1. 是否继续保持“选卡页模糊、合并页精确”的信息递进？
2. 如果要统一，两种方向分别是：
   - 选卡页也显示精确 dCOGS/NRE；
   - 合并页也只显示档位，精确数字延后到定价或结果页。
3. 若保留现状，建议在合并页标题或提示中明确“成本结构第一次揭示”，避免学生误以为选卡页漏信息。
