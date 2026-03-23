# Round 2 前端 UI 规格文档 v11

> 本文档从 `round2_full_v11.jsx` 提取，是 `Round2Flow.jsx` 的权威实现规格。
> Codex 实现时以本文档为准，不参考 v8 或更早版本。

---

## 总体结构

- **步骤总数**：8 步（Step 0–7）
- **步骤标签**：`["R1回顾", "维度分配", "焦点访谈", "个人选卡", "需求校准", "团队合并", "集体讨论", "最终结果"]`
- **顶部进度条**：圆形步骤点 + 连接线，当前步骤高亮绿色（`#1a5c3a`），已完成步骤填色，未完成灰色
- **页面宽度**：`maxWidth: 1060px`，居中，`padding: 14px 12px`
- **字体**：`'Noto Sans SC', -apple-system, sans-serif`
- **背景色**：`#fafaf8`

---

## 全局常量（从后端 API 读取，替换 hardcode）

| 常量 | 来源 | 说明 |
|------|------|------|
| `DIMS` | 固定配置 | 6 个维度，含 id/label/icon/color |
| `CC`（卡牌数据） | `GET /api/rd/cards` | 替换 hardcode 的 CC 对象 |
| `ASGN`（维度分配） | `POST /api/round2/assign-dimensions` | 替换 hardcode 的 ASGN |
| `R1`（Round1冻结） | `GET /api/round2/recap?teamId=...` | gm/P/COGSbase/WTP/e/Pmax/f |
| `BUD`（预算基准） | 前端计算：`Math.round(Pmax × 0.20)` | **不是** COGSbase × 0.13 |
| `AI_RADAR` | `POST /api/round2/interview/auto` 返回 | 访谈后 AI 捕捉的维度权重 |
| `OTHER`（其他成员选卡） | `POST /api/round2/merge` 返回 | Step 5 合并时注入 |
| `RDR`（雷达基准分） | recap 数据或 assign-dimensions 返回 | 每维度显示在卡片组标题右侧 |

**6个维度固定配置：**
```javascript
const DIMS = [
  {id:"interaction", l:"交互与表达",      icon:"💬", c:"#D97706"},
  {id:"perception",  l:"感知与理解",      icon:"👁",  c:"#7C3AED"},
  {id:"motion",      l:"运动与导航",      icon:"🦿", c:"#0891B2"},
  {id:"safety",      l:"安全与信任",      icon:"🛡",  c:"#DC2626"},
  {id:"extend",      l:"可扩展与连接",    icon:"🔌", c:"#059669"},
  {id:"ops",         l:"可运营与可维护",  icon:"🔧", c:"#4F46E5"},
];
```

---

## 指标栏组件 `renderMetrics(tot, violations)`

显示在 Step 3/5/6 顶部，**每次选卡变化实时更新**。

### 布局
三个并排卡片（flex wrap）：

**卡片1：预算状态**（flex: 1 1 220px）
- 超预算时：红色背景 `#FEF2F2`，标题「⚠ 超预算」红色
- 未超预算：绿色背景 `#F0FDF4`，标题「✓ 预算内」绿色
- 右侧显示：`净增量 +{tot.cost}` + 小字「系统建议上限 {BUD}（基于定位与价格空间）」
- 进度条：`tot.cost / BUD × 100%`，超预算红色，正常绿色

**卡片2：系统负载**（flex: 1 1 120px）
- 显示：`系统负载 {tot.ld}/{CAPMAX}`（CAPMAX=24）
- 进度条：`tot.ld / CAPMAX × 100%`，超载红色
- 背景：超载时 `#FEF2F2`，正常 `#F9FAFB`

**卡片3：选卡计数 + 依赖状态**（flex: 0 0 auto）
- 显示：`已选 {tot.cnt}`
- 有依赖问题时：`⚠ {n} 个依赖问题`（红色）
- 无问题时：`✓ 依赖正常`（绿色）

---

## 卡片组件 `renderCard(card, dim, sels, showCross, viols)`

每张能力卡的渲染规格：

### 卡片容器
- border: 有违规 → `2px solid #EF4444`；已选且降本卡 → `2px solid #2FAB6E`；已选 → `2px solid {dim.c}`；未选 → `1.5px solid #e5e7eb`
- background: 有违规 → `#FFF5F5`；降本卡 → `#fafff8`；默认 → `#fff`
- border-radius: 10px，padding: 10px 12px

### 右上角标签（absolute 定位）
- 降本卡（`card.cd`）：绿底「降本」标签，top:4 right:6
- 降险卡（`card.rd`）：蓝底「降险」标签，top:4 right:6
- 锦囊标签（`JIN[card.id]`）：黄底，在降本/降险标签下方

### 违规提示横幅（有违规时显示在卡片内顶部）
- 红色背景框，每条违规一行
- 图标：conflict=「⚡」，upgrade=「⬆」，missing=「➕」
- 显示 `v.fix`（修复建议）

### 卡片主体
- 复选框 + 卡片名称（13px bold）+ 标签（9px 灰色）
- 数值行：净增量（颜色：负数绿、大于200红、其他黑）+ 风险等级（色块）+ 负载值
- 三档按钮：`基础(+xx)` / `标准(+xx)` / `旗舰(+xx)`
  - 激活状态：有色边框 + 浅色背景
  - 未选卡时：opacity 0.4，不可点击

### 依赖提示
- **跨维度依赖**（`showCross=true` 时显示，蓝色背景框）：「→ 需要 {卡名}≥{档} [其他成员负责]」
- **同维度依赖**（实时满足状态）：满足绿色 ✓，不满足红色 !!

---

## 维度分组组件 `renderDimGroup(dimId, sels, showCross, viols)`

### 分组标题栏
- 背景：有违规 → `#FEF2F2`；正常 → `{dim.c}12`（12% 透明度）
- 底边：有违规 → `3px solid #EF4444`；正常 → `3px solid {dim.c}`
- 左侧：`{⚠} {icon} {label}`（有违规时加⚠前缀，红色）
- 右侧：`雷达{RDR[dimId]} | 已选 {已选数} 张`

### 卡片网格
- `grid-template-columns: repeat(auto-fill, minmax(280px, 1fr))`
- gap: 6px，padding: 8px
- 背景白色，带维度色边框

---

## Step 0：R1 回顾

数据来源：`GET /api/round2/recap?teamId={teamId}`

### 布局（从上到下）

**1. 定位横幅**（深绿渐变背景 `linear-gradient(135deg,#065f46,#14532d)`，白字）
- 小标签：「最终定位 (final_grid_id + architecture)」
- 大标题：如「ToB · 差异化 · 老人 · 体验型」（20px bold）
- VP 摘要文字（11px）

**2. Margin Headroom 卡片**（绿色浅背景）
- 大字显示范围：如「55%–65%」+ 档位标签「宽裕」
- 说明文字

**3. Market Space 卡片**（蓝色浅背景）
- 大字：「S（小）/ M（中）/ L（大）」+ 进入难度

**4. VP 战略评估卡片**（灰色背景）
- 左侧：WHO / PAIN / HOW / 架构 / Coach评价
- 右侧：C/G/E 三个进度条（1–5格，绿色填充）
- 底部：「可占容量份额：大/中/小 ｜ 溢价能力：强/中/弱」

**5. 锦囊激活卡片**（绿色背景）
- 标题：「✅ 锦囊激活（{n}/{total} 张命中）」
- 每张锦囊一行：名称 + 契合度 + （Round 2 生效）标注
- 底部：渠道结构

**6. R2 关键参数**（4列网格）
- target_gm / Pmax / COGSbase / 渠道费率

**7. 预算提示**（黄色背景）
- 「Round 2 预算上限 = {BUD}元（Pmax × 0.20）。技术锦囊将降低对应卡 dCOGS xx%」

**8. 冻结横幅**（深色背景）
- 「Round 1 完成 · target_gm 已冻结」
- 按钮：「进入 Round 2 →」→ setStep(1)

---

## Step 1：维度分配

数据来源：`POST /api/round2/assign-dimensions`（或从 recap 获取）

### 布局
- 标题：「维度分配」
- 成员列表（4行，每行可点击选择当前身份）：
  - 成员头像圆点（颜色 `MC[i]`）+ 姓名 + 负责维度标签 + 配对成员名
  - 选中状态：有色边框 + 浅色背景
- 按钮：「以 {MN[am]} 身份进入」→ setStep(2)

**成员颜色**：`["#E8634A","#3B82C4","#2FAB6E","#D4A03C"]`
**维度分配规则**：每人负责2个维度，由后端 assign-dimensions 决定

---

## Step 2：焦点访谈

数据来源：`POST /api/round2/interview/auto`

### 布局
- 标题：「焦点小组访谈」
- 访谈对话列表（模拟用户对话，带发言人姓名和颜色）
- 底部成功提示：「访谈完成。请各自完成个人选卡，全组提交后进行需求校准。」
- 按钮：「开始个人选卡」→ setStep(3)

---

## Step 3：个人选卡

数据来源：本地 state（`sel`），提交时调用 `POST /api/round2/member-selection` + `POST /api/rd/calculate` + `POST /api/rd/preview-price`

### 布局
**顶部固定区域**（两个卡片）：
1. 标题卡：「个人选卡（{MN[am]}）」+ 小字「仅显示当前成员负责维度」
2. 指标栏：`renderMetrics(tot, vl)`

**卡片区域**：只显示当前成员负责的维度（`myA.dims`），每个维度调用 `renderDimGroup(dimId, sel, true)`（showCross=true）

**定价滑块**（卡片区域下方）：
- 标题：「定价模拟」
- 显示当前价格：`P = {price}（范围 {WTP×0.5} – {Pmax}）`
- `<input type="range">` 滑块
- 实时预览行：`WTP' {wtpPrime} | adoption {adoption}% | share {share}% | units {units} | profit {profit}`
- 每次滑动调用 `POST /api/rd/preview-price`

**提交按钮**：「提交，等待队友」→ 调用 member-selection API → setStep(4)

---

## Step 4：需求重要性校准

数据来源：AI_RADAR 来自 interview/auto 返回；userRadar 为本地 state

### 两个子状态

**未提交状态**：
- 说明文字：「全组访谈已汇总。小组共同评估每个维度对目标用户的重要性（1–10分）...」
- 6个维度滑块（每个维度一组）：
  - 标题行：`{icon} {label}` + 当前分值（右对齐）
  - `<input type="range" min=1 max=10>`（accent-color 用维度色）
  - 底部标注：「不重要」←→「非常重要」
- 按钮：「提交判断，查看对比」→ setRadarSubmitted(true)

**已提交状态**：
- 说明文字：「下图对比了你们的主观判断（橙色实线）与 AI 从全组访谈中自动捕捉的需求信号（蓝色虚线）。偏差较大的维度，在团队合并时值得重新权衡。」
- 雷达图（见下方规格）
- 偏差列表（差值 ≥2 的维度，最多显示3条）
- 按钮：「明白了，进入团队合并 →」→ setStep(5)

### 雷达图规格
- SVG 300×300，6边形
- 4层网格线（25%/50%/75%/100%），最外层稍粗
- 6条轴线 + 维度标签（icon + label前4字）
- 蓝色虚线：AI 捕捉（`#3B82C4`，strokeDasharray="5,3"）
- 橙色实线：学生判断（`#E8634A`，strokeWidth=2.5）
- 图例在图下方
- 偏差提示框（黄色背景）：列出偏差≥2的维度，标注「AI认为更重要」或「你们高估」

---

## Step 5：团队合并

数据来源：`POST /api/round2/merge`（返回其他成员选卡，合并进 teamSel）

### 布局
- 标题：「团队合并 - 预算影响」
- 指标栏：`renderMetrics(tTot, tVl)`（使用合并后的 teamSel）
- 依赖问题列表（有问题时显示红色卡片，每条问题一行，含图标+说明+修复建议+类型标签）
- 各维度已选卡汇总（按维度分组，紧凑行格式）：
  - 每行：成员头像 + 卡名 + 档位标签 + 净增量
  - 头像颜色区分是哪位成员的卡
- 按钮：「进入集体讨论」（红色背景）→ setStep(6)

---

## Step 6：集体讨论

数据来源：本地 teamSel state，实时调用 validate + calculate

### 布局
- 顶部卡片：标题「集体讨论」+ 指标栏 `renderMetrics(tTot, tVl)`
- 所有6个维度的卡片组（showCross=false，传入 tVl 做违规高亮）
- 底部按钮（状态联动）：
  - 有依赖问题：「修复 {n} 个依赖」（灰色，disabled 效果）
  - 卡数不足：「还需 {8-cnt} 张」（灰色）
  - 全部满足：「确认提交」（深绿色 `#1a5c3a`）
  - 点击确认 → 调用 reflection API → setStep(7)

---

## Step 7：最终结果

数据来源：calculate API 最终结果 + reflection API

### 布局
**5列指标网格**：
- 渗透率（绿色）/ 销量（蓝色）/ 硬件利润（紫色）/ 订阅LTV（橙色）/ 总利润（深绿）
- 每格：小标签 + 大数字

**完成横幅**（深色背景）：
- 「Round 2 Complete」
- 「AI reflection report generating...」（生成中状态）

---

## 关键交互规则

### 卡片选择逻辑
- 点击复选框：toggle 选中/取消
- 取消选中：清除该卡的选择，tier 重置
- 选中默认 tier：`mid`（标准档）
- 点击档位按钮：仅在已选中时有效，更新 tier

### 个人选卡 vs 集体讨论的区别
| 属性 | 个人选卡 (Step 3) | 集体讨论 (Step 6) |
|------|-----------------|-----------------|
| 显示维度 | 仅当前成员负责的 | 全部 6 个 |
| 操作对象 | `sel` state | `teamSel` state |
| 跨维度依赖 | 显示但不强制 | 必须修复才能提交 |
| 指标来源 | `tot` / `vl` | `tTot` / `tVl` |

### teamSel 合并逻辑
```javascript
// Step 5 之后，teamSel = 当前成员选卡 + 其他成员选卡（不覆盖当前成员）
const teamSel = { ...sel, ...otherMembersCards };
// otherMembersCards 来自 /api/round2/merge 返回
```

### 预算基准计算
```javascript
const BUD = Math.round(Pmax * 0.20);  // 正确
// 不是 COGSbase * 0.13（v8旧版，已废弃）
```

---

## 依赖问题显示规则

三种类型对应不同图标和颜色标签：

| 类型 | 图标 | 标签文字 | 标签背景色 |
|------|------|---------|----------|
| conflict（互斥） | ⚡ | 互斥冲突 | 黄色 `#FEF3C7` |
| upgrade（需升级） | ⬆ | 需升级 | 蓝色 `#DBEAFE` |
| missing（缺少依赖） | ➕ | 缺少依赖 | 灰色 `#F3F4F6` |

跨维度依赖（`dep.x=true`）在个人选卡阶段只提示不强制；在集体讨论阶段强制修复。

---

## 主按钮样式（BS）

```javascript
{
  marginTop: 10,
  width: "100%",
  padding: "10px",
  borderRadius: 10,
  background: "#1a5c3a",
  color: "#fff",
  border: "none",
  fontSize: 14,
  fontWeight: 700,
  cursor: "pointer"
}
```
