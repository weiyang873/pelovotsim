# Round 1 System Model Spec (Aligned to Combined Doc)

本文档用于对齐 `Round1_System_Document_Combined.pdf` 的实现口径。  
约定：若旧版本与 Combined Doc 冲突，以 Combined Doc 为准。

---

## 1) Round 1 输入定义（保持原 GMmax 口径）

1. 定位格子
   - `customer_type`: `ToB | ToC`
   - `strategy`: `DIFF | COST`
   - `age_group`: `ELDER | ADULT | CHILD`

2. 架构标签
   - `arch_tag`: `Experience | Hybrid | Function`

3. 渠道三选二 + 比例
   - 两个渠道，来自 `{Direct, Distributor, Ecommerce}`
   - 比例和为 1.0

4. VP 文本评分系数
   - `fit_text ∈ {0.95, 1.00, 1.05}`，缺省 `1.00`

---

## 2) GMmax 核心模型（保持原公式）

### 2.1 采用率反推价格上限（Pmax）

- 需求函数：
  - `Adoption(P) = [1 / (1 + exp(sigmoid_a * (r - 1)))] ^ e`
  - `r = P / WTP`
- 令 `Adoption(P_max_base) = A_min`，闭式反解：
  1. `s = A_min^(1/e)`
  2. `r_max = 1 + (1/sigmoid_a) * ln((1 - s)/s)`
  3. `P_max_base = r_max * WTP`

### 2.2 架构修正

- `Fit_arch = w_age*fit_age + w_str*fit_str + w_cust*fit_cust`
- `P_max = P_max_base * (1 + beta_arch * (Fit_arch - 0.5))`

### 2.3 成本代理

- `COGS_proxy = COGS_base(customer_type) * m_age(age_group) * m_arch(arch_tag)`

### 2.4 GMmax

- `GM_raw = 1 - f - COGS_proxy / P_max`
- `GM_max = min(GM_cap, GM_raw)`
- `GM_final = (GM_max > 0) ? min(GM_cap, GM_max * fit_text) : GM_max`

---

## 3) 结构性亏损诊断（保持原口径）

- `P_breakeven = COGS_proxy / (1 - f)`
- `Gap = P_breakeven - P_max`
- 若 `GM_max < 0`（或 `Gap > 0`）：
  - 判定为结构性亏损风险
  - 对学生展示“结构性亏损风险”提示，不展示复杂中间数

---

## 4) Market Space Tier（新增）

### 4.1 SpaceScore 公式

- `SpaceScore = BaseSize(s) × g(e_tier) × h(crowding) × m(reach)`
  - `s`: 12 格定位
  - `e_tier`: 价格弹性档位
  - `crowding`: 竞争拥挤度档位
  - `reach`: 渠道触达档位

### 4.2 参数（默认值）

- `g(e_tier)`
  - `Low -> 0.9`
  - `Med -> 1.0`
  - `High -> 1.1`
- `h(crowding)`
  - `Low -> 0.9`
  - `Med -> 1.0`
  - `High -> 1.1`
- `m(reach)`
  - `reach < 0.4 -> 0.95`
  - `0.4 <= reach < 0.7 -> 1.0`
  - `reach >= 0.7 -> 1.05`
- `BaseSize(s)`
  - 按 12 格配置（在 `game_config_v0.1/market_space_params.json`）

### 4.3 档位映射

- 将 `SpaceScore` 映射为：
  - `S`（小）
  - `M`（中）
  - `L`（大）

并同时给出 `DifficultyTier`（进入难度）：
- 低 / 中 / 高（由 crowding 档位决定）

---

## 5) VP 三指标评分框架（新增）

### 5.1 三指标

- `C`（Coverage）
- `G`（Generalizability）
- `E`（Effectiveness）
- 分数范围：`1~5`

### 5.2 硬约束

- 三项评分必须全部存在，且在 `1..5`
- 若评分缺失，默认按最低可用档处理，并提示“评分信息不完整”

### 5.3 分值到份额映射（按 Combined Doc）

- `1 -> 0.1`
- `2 -> 0.3`
- `3 -> 0.5`
- `4 -> 0.7`
- `5 -> 0.9`

即：
- `C_share = map(C)`
- `G_share = map(G)`
- `E_share = map(E)`

### 5.4 份额公式

- `Svol = C_share × G_share × φ(E_share)`
- `Swtp = C_share × G_share × ψ(E_share)`

实现中 `φ/ψ` 使用配置化函数（默认可线性）：
- `φ(E) = 0.6 + 0.4E`
- `ψ(E) = 0.7 + 0.3E`

### 5.5 前端展示口径

- 保留 `C/G/E` 分数（1-5）
- 不显示 `Svol/Swtp` 精确百分比
- 仅显示定性：
  - 可占容量份额：大/中/小
  - 溢价能力：强/中/弱

---

## 6) 参数总表（更新）

### 6.1 GMmax 参数

- `A_min`, `sigmoid_a`
- `beta_arch`
- `GM_cap`
- `fee_direct`, `fee_distributor`, `fee_ecommerce`
- `COGS_base_ToC`, `COGS_base_ToB`
- `m_age`, `m_arch`
- `Fit_age`, `Fit_strategy`, `Fit_customer`
- `w_age`, `w_str`, `w_cust`

### 6.2 Market Space 参数

- `BaseSize(s)`（12 格）
- `g(e_tier)`、`h(crowding)`、`m(reach)`
- `S/M/L` 阈值

### 6.3 VP 参数

- `score_map = {1:0.1,2:0.3,3:0.5,4:0.7,5:0.9}`
- `φ(E)`、`ψ(E)`（可配置）

---

## 7) 结果页输出结构（建议）

1. Margin Headroom（利润空间）
   - 档位：宽裕/中等/紧张/危险
   - `GM_max < 0` 时显示结构性亏损提示

2. Market Space Tier（市场空间）
   - 规模：S/M/L
   - 进入难度：低/中/高
   - 显示“利润空间 vs 市场规模”的对冲说明

3. VP 战略评估
   - `C/G/E` 三项分数
   - 可占容量份额（大/中/小）
   - 溢价能力（强/中/弱）

4. 锦囊契合度总结 + 冻结按钮

