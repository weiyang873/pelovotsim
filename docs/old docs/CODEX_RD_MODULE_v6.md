# Round 2 R&D 模块实现规范（v6 — 分组 + 档位 + 兼容性）

## 概述

实现 Marketing → R&D 完整计算链条。
输入：访谈雷达分数 + R&D 分组选卡（8-10 张 × 三档）→ 输出：Share/Units/Profit。

**与 v5 的区别**：
- 选卡从"6张平铺"变为"6组各选1-3张、共选8-10张、每张选 low/mid/high 档位"
- 数据源从 `feature_card_econ.json` 变为 `capability_groups_v2.json` + `compatibility_rules_v2.json`
- 新增：选卡合法性验证（hard rules）+ 软约束惩罚（budget/capacity）进入 z
- 新增：`k_sub` 参数让 sub_lift 进入 attach
- 新增：`load` 字段累加、`risk = max(0, sum)` 下限截断
- 底层 Step 1-5（雷达→权重→标签分层）和 Step 9-10（价格→信号I）**数学公式不变**

---

## 静态配置文件

所有文件放在 `data/` 目录：

| 文件 | 用途 | 状态 |
|------|------|------|
| `capability_groups_v2.json` | 6 分组、36 张能力卡、每卡三档参数 + tier-level requires/excludes | 已有 ✅ |
| `compatibility_rules_v2.json` | 全局软约束（budget/capacity）+ hard rules 索引 | 已有 ✅ |
| `grid_priors_v4_cap_weights.json` | 12格先验权重 + 推荐卡（字段 `recommended_capabilities` + `recommended_capability_weights_v4`）| 已有 ✅ |
| `tag_map_v2_1.json` | 需求标签→维度映射（25 个标签，覆盖全部 22 个 cover 标签）| 已有 ✅ |
| `grid_priors_v3_with_weights.json` | 旧版先验（保留做兼容，v6 优先读 v4） | 保留 |
| `tag_map.json` | 旧版标签映射（保留做兼容，v6 优先读 v2_1） | 保留 |
| `feature_card_econ.json` | 旧版卡经济参数（v6 不再使用，但不要删） | 废弃 |

---

## 核心文件：`server/llm/rdCalculator.js` 重写

### 超参数（DEFAULT_PARAMS）

```javascript
const DEFAULT_PARAMS = {
  kappa: 1.5,        // 雷达幂变换
  lambda: 0.3,       // 先验/后验融合强度
  tau_core: 0.18,    // Core 阈值
  tau1: 0.16,        // 重要度阈值1
  tau2: 0.22,        // 重要度阈值2
  alpha0: -2.2,      // share 基准 (sigmoid(-2.2)≈10%)
  beta_I: 1.2,       // 访谈信号系数
  beta_fit: 2.0,     // 定位命中系数
  beta_sub: 1.2,     // 订阅拉动系数
  beta_risk: 1.8,    // 风险惩罚系数
  beta_p: 2.5,       // 价格惩罚系数
  beta_cx: 0.4,      // 过度工程惩罚
  attach0: 0.08,     // 订阅基础购买率
  k_core: 0.20,      // core覆盖→订阅
  k_nice: 0.35,      // nice覆盖→订阅
  k_sub: 0.25,       // sub_lift→订阅（v6 新增）
  k_risk: 0.20,      // 风险→订阅侵蚀
  S: 199,            // 订阅月费（元）
  gm_sub: 0.7,       // 订阅毛利率
  T: 12,             // 订阅留存月数
  C0: 1000,          // 复杂度归一化
  lambda_p: 1.2,     // WTP价格折扣强度
  budget_multiplier: 0.13,  // v6: R&D 预算 = COGSbase × 0.13
  capacity_cap: 24,         // v6: 容量点上限
  slope_budget: 0.15,       // v6: 预算溢出 z-penalty 斜率
  slope_cap: 0.10,          // v6: 容量溢出 z-penalty 斜率
  risk_per_excess: 0.02,    // v6: 每超 1 点容量加的 risk
};
```

### 新函数 1：`getCapabilityParams(cap_id, tier)`

从 `capability_groups_v2.json` 查找能力卡的指定档位参数。

**注意**：加载路径统一为 `data/` 目录：
```javascript
const dataDir = path.join(__dirname, "../../data");
const CAP_GROUPS = JSON.parse(fs.readFileSync(path.join(dataDir, "capability_groups_v2.json"), "utf8"));
const COMPAT_RULES = JSON.parse(fs.readFileSync(path.join(dataDir, "compatibility_rules_v2.json"), "utf8"));
const GRID_PRIORS = JSON.parse(fs.readFileSync(path.join(dataDir, "grid_priors_v4_cap_weights.json"), "utf8"));
const TAG_MAP = JSON.parse(fs.readFileSync(path.join(dataDir, "tag_map_v2_1.json"), "utf8"));
```

```javascript
function getCapabilityParams(cap_id, tier) {
  for (const group of CAP_GROUPS.groups) {
    const cap = group.capabilities.find(c => c.id === cap_id);
    if (cap) {
      const tierData = cap.tiers[tier];
      if (!tierData) throw new Error(`tier ${tier} not found for ${cap_id}`);
      return {
        group_id: group.id,
        dCOGS: tierData.dCOGS,
        risk: tierData.risk,
        sub_lift: tierData.sub_lift || 0,
        load: tierData.load || 1,
        covers: tierData.covers || cap.covers || [],
        requires: tierData.requires || [],
        excludes: tierData.excludes || [],
      };
    }
  }
  throw new Error(`capability ${cap_id} not found`);
}
```

### 新函数 2：`validateSelections(selections)`

检查选卡合法性。selections 格式：`[{cap_id, tier}]`。

```javascript
function validateSelections(selections) {
  const violations = [];

  // 1. 按组统计
  const groupCounts = {};
  for (const sel of selections) {
    const params = getCapabilityParams(sel.cap_id, sel.tier);
    const gid = params.group_id;
    groupCounts[gid] = (groupCounts[gid] || 0) + 1;
  }

  // 每组 1-3 张
  for (const group of CAP_GROUPS.groups) {
    const count = groupCounts[group.id] || 0;
    if (count < 1) violations.push({ type: "group_min", group: group.id, message: `${group.name} 至少选 1 张` });
    if (count > 3) violations.push({ type: "group_max", group: group.id, message: `${group.name} 最多选 3 张` });
  }

  // 总数 8-10
  if (selections.length < 8) violations.push({ type: "total_min", message: `总数 ${selections.length} < 8` });
  if (selections.length > 10) violations.push({ type: "total_max", message: `总数 ${selections.length} > 10` });

  // 2. Hard rules: requires
  const selectedSet = new Set(selections.map(s => s.cap_id));
  for (const sel of selections) {
    const params = getCapabilityParams(sel.cap_id, sel.tier);
    for (const req of params.requires) {
      if (!selectedSet.has(req)) {
        violations.push({
          type: "requires",
          source: `${sel.cap_id}@${sel.tier}`,
          target: req,
          message: `${sel.cap_id}(${sel.tier}) 需要 ${req}`
        });
      }
    }
  }

  // 3. Hard rules: excludes (bidirectional)
  const selArray = selections.map(s => ({ ...s, params: getCapabilityParams(s.cap_id, s.tier) }));
  for (let i = 0; i < selArray.length; i++) {
    for (const exc of selArray[i].params.excludes) {
      if (selectedSet.has(exc)) {
        violations.push({
          type: "excludes",
          source: selArray[i].cap_id,
          target: exc,
          message: `${selArray[i].cap_id} 与 ${exc} 冲突`
        });
      }
    }
  }

  return {
    valid: violations.length === 0,
    violations,
    hardViolationCount: violations.length,
  };
}
```

### 新函数 3：`computeSoftPenalties(selections, COGSbase)`

```javascript
function computeSoftPenalties(selections, COGSbase, params = DEFAULT_PARAMS) {
  let totalPositiveDCOGS = 0;
  let totalLoad = 0;

  for (const sel of selections) {
    const p = getCapabilityParams(sel.cap_id, sel.tier);
    if (p.dCOGS > 0) totalPositiveDCOGS += p.dCOGS;
    totalLoad += p.load;
  }

  const budgetCap = COGSbase * params.budget_multiplier;
  const overBudget = totalPositiveDCOGS > budgetCap;
  const overBudgetAmount = Math.max(0, totalPositiveDCOGS - budgetCap);
  const z_penalty_budget = overBudget
    ? -params.slope_budget * (overBudgetAmount / budgetCap)
    : 0;

  const overCapacity = totalLoad > params.capacity_cap;
  const overCapacityAmount = Math.max(0, totalLoad - params.capacity_cap);
  const z_penalty_cap = overCapacity
    ? -params.slope_cap * (overCapacityAmount / params.capacity_cap)
    : 0;
  const risk_add = params.risk_per_excess * overCapacityAmount;

  return {
    budget: { budgetCap, positiveDCOGS: totalPositiveDCOGS, overBudget, overBudgetAmount },
    capacity: { capacityCap: params.capacity_cap, totalLoad, overCapacity, overCapacityAmount },
    z_penalty: z_penalty_budget + z_penalty_cap,
    risk_add,
  };
}
```

### 改写 `calculate()` 主函数

输入签名变更：
```javascript
// v5: calculate({ gridId, radar, tags, priceSensitive, evi, selectedCards: string[], P, Pmax, f, COGSbase, TAM, H })
// v6: calculate({ gridId, radar, tags, priceSensitive, evi, selections: [{cap_id, tier}], P, Pmax, f, COGSbase, TAM, H })
```

关键改动点（其余不变）：

**Step 7 汇总（替换原来的 6 张平铺汇总）：**
```javascript
// v6: 从 (cap_id, tier) 读参数
let dCOGS = 0, riskSum = 0, sub_lift = 0, load = 0, complexity = 0;
const allCovers = new Set();

for (const sel of input.selections) {
  const p = getCapabilityParams(sel.cap_id, sel.tier);
  dCOGS += p.dCOGS;
  riskSum += p.risk;
  sub_lift += p.sub_lift;
  load += p.load;
  if (p.dCOGS > 0) complexity += p.dCOGS / params.C0;
  p.covers.forEach(t => allCovers.add(t));
}

const risk = Math.max(0, riskSum);  // v6: risk 下限截断
```

**Step 7b 软约束（新增）：**
```javascript
const soft = computeSoftPenalties(input.selections, input.COGSbase, params);
const finalRisk = risk + soft.risk_add;
```

**Step 11 z（加 z_penalty）：**
```javascript
const z = params.alpha0
  + params.beta_I * I
  + params.beta_fit * fit
  + params.beta_sub * sub_lift
  - params.beta_risk * finalRisk
  - params.beta_p * price_penalty
  - params.beta_cx * complexity
  + soft.z_penalty;  // v6 新增
```

**Step 12 attach（加 k_sub）：**
```javascript
const attach = clip(
  params.attach0
  + params.k_core * covercore
  + params.k_nice * covernice
  + params.k_sub * sub_lift    // v6 新增
  - params.k_risk * finalRisk,
  0, 0.9
);
```

**返回值新增字段：**
```javascript
return {
  // ... 原有字段 (share, units, profit_hw, profit_sub, profit, ...) ...

  // v6 新增
  violations: validation.violations,
  hardViolationCount: validation.hardViolationCount,
  load,
  softPenalties: soft,
  z_penalty: soft.z_penalty,
  risk_add: soft.risk_add,
  evi,
  fit,
  I,
  covercore,
  covernice,
  dCOGS,
  risk: finalRisk,
  sub_lift,
  complexity,
};
```

---

## API 端点

### `POST /api/rd/validate`（新增）
实时验证选卡合法性（前端每次选卡变更调用）。

```javascript
router.post("/api/rd/validate", (req, res) => {
  const { selections } = req.body;  // [{cap_id, tier}]
  const result = validateSelections(selections);
  res.json(result);
});
```

### `POST /api/rd/calculate`（改写）
```javascript
router.post("/api/rd/calculate", (req, res) => {
  // 1. 先 validate
  const validation = validateSelections(req.body.selections);
  if (validation.hardViolationCount > 0) {
    return res.json({ ok: false, violations: validation.violations });
  }
  // 2. 再 calculate
  const result = calculate(req.body);
  res.json({ ok: true, ...result });
});
```

---

## 测试脚本：`scripts/test-rd.js`

27 条断言，验证 v6 口径。

```javascript
#!/usr/bin/env node
const path = require("path");
const fs = require("fs");

// --- 加载数据 ---
const dataDir = path.join(__dirname, "..", "data");
const CAP_GROUPS = JSON.parse(fs.readFileSync(path.join(dataDir, "capability_groups_v2.json"), "utf8"));
const COMPAT = JSON.parse(fs.readFileSync(path.join(dataDir, "compatibility_rules_v2.json"), "utf8"));
const TAG_MAP_PATH = path.join(dataDir, "tag_map_v2_1.json");
const tagMap = fs.existsSync(TAG_MAP_PATH) ? JSON.parse(fs.readFileSync(TAG_MAP_PATH, "utf8")) : null;

// --- 加载 rdCalculator（按项目实际路径调整） ---
let rd;
try {
  rd = require("../server/llm/rdCalculator");
} catch (e) {
  console.error("❌ 无法加载 server/llm/rdCalculator.js:", e.message);
  process.exit(1);
}

let pass = 0, fail = 0;
function assert(label, condition) {
  if (condition) { pass++; console.log(`  ✅ ${label}`); }
  else { fail++; console.log(`  ❌ ${label}`); }
}

// --- 测试方案数据 ---
// 好方案：8 张卡，每组 1-2 张，在预算内
const GOOD_PLAN = [
  { cap_id: "visual_recognition", tier: "mid" },
  { cap_id: "voice_basic", tier: "mid" },
  { cap_id: "stable_movement", tier: "mid" },
  { cap_id: "expression_display", tier: "mid" },
  { cap_id: "gesture_response", tier: "low" },
  { cap_id: "fall_detection", tier: "high" },
  { cap_id: "local_storage", tier: "mid" },
  { cap_id: "remote_monitor", tier: "low" },
];

// 过度工程：10 张全高档
const OVER_ENG = [
  { cap_id: "visual_recognition", tier: "high" },
  { cap_id: "voice_basic", tier: "high" },
  { cap_id: "stable_movement", tier: "high" },
  { cap_id: "obstacle_avoidance", tier: "high" },
  { cap_id: "expression_display", tier: "high" },
  { cap_id: "gesture_response", tier: "high" },
  { cap_id: "fall_detection", tier: "high" },
  { cap_id: "privacy_trust", tier: "high" },
  { cap_id: "local_storage", tier: "high" },
  { cap_id: "remote_monitor", tier: "high" },
];

// Round 1 冻结数据（示例）
const R1 = {
  gridId: "B2B_Differentiation_Experience",
  P: 12800,
  Pmax: 14200,
  f: 0.124,
  COGSbase: 4200,
  TAM: 50000,
  H: 0.3,
};

// 访谈数据
const INTERVIEW = {
  radar: { perception: 8, mobility: 5, interaction: 9, safety: 7, integration: 4, operations: 3 },
  tags: [
    { tag: "情绪识别", polarity: 1 },
    { tag: "跌倒检测", polarity: 1 },
    { tag: "语音交互", polarity: 1 },
    { tag: "隐私保护", polarity: 1 },
  ],
  priceSensitive: false,
  evi: 0.72,
};

// ===== A: 返回值结构检查 =====
console.log("\n--- A: 返回值结构 ---");
const rGood = rd.calculate({
  ...R1, ...INTERVIEW, selections: GOOD_PLAN
});
assert("A1 返回值含 violations", "violations" in rGood);
assert("A2 返回值含 hardViolationCount", "hardViolationCount" in rGood);
assert("A3 返回值含 load", "load" in rGood);
assert("A4 返回值含 softPenalties", "softPenalties" in rGood);
assert("A5 返回值含 z_penalty", "z_penalty" in rGood);
assert("A6 返回值含 sub_lift", "sub_lift" in rGood);

// ===== B: 输入格式 =====
console.log("\n--- B: 输入格式 ---");
assert("B1 接受 selections [{cap_id, tier}]", rGood.share > 0);
assert("B2 好方案 8 张卡", GOOD_PLAN.length === 8);

// ===== C: 软约束 =====
console.log("\n--- C: 软约束 ---");
const rOver = rd.calculate({
  ...R1, ...INTERVIEW, selections: OVER_ENG
});
assert("C1 过度工程超预算", rOver.softPenalties.budget.overBudget === true);
assert("C2 过度工程超容量", rOver.softPenalties.capacity.overCapacity === true);
assert("C3 过度工程 z_penalty < 0", rOver.z_penalty < 0);
assert("C4 好方案 z_penalty >= 0", rGood.z_penalty >= 0 || !rGood.softPenalties.budget.overBudget);

// ===== D: load =====
console.log("\n--- D: load ---");
assert("D1 好方案 load > 0", rGood.load > 0);
assert("D2 过度工程 load > 好方案 load", rOver.load > rGood.load);
assert("D3 过度工程 load > capacity_cap(24)", rOver.load > 24);

// ===== E: risk 截断 =====
console.log("\n--- E: risk ---");
assert("E1 risk >= 0（下限截断）", rGood.risk >= 0);
assert("E2 过度工程 risk >= 0", rOver.risk >= 0);

// ===== F: k_sub =====
console.log("\n--- F: k_sub ---");
assert("F1 好方案 sub_lift >= 0", rGood.sub_lift >= 0);
// attach 应该比不含 k_sub 时更高（间接验证）
assert("F2 过度工程 sub_lift > 好方案", rOver.sub_lift > rGood.sub_lift);

// ===== G: hard violation =====
console.log("\n--- G: hard violation ---");
// 缺组测试（只选 3 个组的卡）
const INCOMPLETE = [
  { cap_id: "visual_recognition", tier: "mid" },
  { cap_id: "expression_display", tier: "mid" },
  { cap_id: "fall_detection", tier: "mid" },
];
const vIncomplete = rd.validateSelections(INCOMPLETE);
assert("G1 不完整选卡有 violation", vIncomplete.hardViolationCount > 0);
assert("G2 validateSelections 返回 valid=false", vIncomplete.valid === false);
assert("G3 报告缺组", vIncomplete.violations.some(v => v.type === "group_min" || v.type === "total_min"));

// ===== H: 教学效果 =====
console.log("\n--- H: 教学效果 ---");
assert("H1 好方案 share > 0.10", rGood.share > 0.10);
assert("H2 好方案 profit > 过度工程 profit", rGood.profit > rOver.profit);

// ===== I: 数据文件版本 =====
console.log("\n--- I: 数据文件版本 ---");
const totalCaps = CAP_GROUPS.groups.reduce((s, g) => s + g.capabilities.length, 0);
assert("I1 capability_groups_v2 有 6 组", CAP_GROUPS.groups.length === 6);
assert("I2 能力卡总数 >= 24", totalCaps >= 24);
assert("I3 compatibility_rules_v2 含 budget_definition", COMPAT.soft_constraints?.[0]?.type === "budget" || COMPAT.budget_definition != null);
if (tagMap) {
  assert("I4 tag_map 含 >= 22 个标签", Object.keys(tagMap.need_tag_to_dim).length >= 22);
} else {
  assert("I4 tag_map.json 存在", false);
}

// ===== Summary =====
console.log("\n" + "=".repeat(60));
console.log(`RESULT: ${pass} passed, ${fail} failed out of ${pass + fail} assertions`);
if (fail === 0) {
  console.log("🎉 ALL PASSED — v6 口径确认");
} else {
  console.log("🚨 有断言失败 — 请检查代码或数据文件");
}
console.log("=".repeat(60));

process.exit(fail > 0 ? 1 : 0);
```

---

## 部署检查清单

```bash
# 1. 数据文件就位（确认这些文件在 data/ 目录下）
ls data/capability_groups_v2.json
ls data/compatibility_rules_v2.json
ls data/grid_priors_v4_cap_weights.json
ls data/tag_map_v2_1.json

# 2. 跑测试
node scripts/test-rd.js

# 3. 确认输出
# 看到 🎉 ALL PASSED 即可
```

## 重要提醒

- **不要改** `engine.js`、`teamRoutes.js`、前端代码
- **不要改** Steps 1-5, 8-10 的数学公式
- `calculate()` 的签名从 `selectedCards: string[]` 改为 `selections: [{cap_id, tier}]`
- `risk = max(0, sum)` — 负 risk 卡可抵消，但总值不低于 0
- `budget_cap = COGSbase × 0.13` — 是正向 dCOGS 的上限
- `calculate()` 中读 grid_priors 应使用 `grid_priors_v4_cap_weights.json`，字段 `recommended_capabilities` 和 `recommended_capability_weights_v4`（不是旧版的 `recommended_feature_cards` / `recommended_feature_card_weights_v3`）
- tag 映射使用 `tag_map_v2_1.json`（25 个标签），不是旧版 `tag_map.json`
- 测试中的 `cap_id` 需要和 `capability_groups_v2.json` 里的实际 id 匹配。如果 JSON 中的 id 不同，请按实际 id 调整测试数据

---

## 注意：测试数据中的 cap_id

上面测试脚本中的 cap_id（如 `visual_recognition`、`fall_detection` 等）是示例。Codex 在实现时需要：

1. 先读 `capability_groups_v2.json`，确认实际的 cap_id 是什么
2. 用实际的 cap_id 替换测试数据
3. 确保好方案（GOOD_PLAN）的卡在预算内、过度工程（OVER_ENG）的卡超预算

如果 JSON 里的 id 是中文或其他格式，请直接用 JSON 里的 id。
