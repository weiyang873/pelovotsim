# CODEX_VP_EMBEDDING_SCORER.md
## VP Embedding 评分系统

### 概述

用 embedding 相似度替代 LLM 判断，实现确定性的 VP 评分。同一句 VP 永远得到同样的分数。

三层约束共同定义一个格子：
- **市场层**（6 个）：定义客户群、痛点空间、替代方案、解法期待
- **策略层**（2 个）：定义价值逻辑（差异化 vs 成本）
- **架构层**（3 个）：定义产品价值重心（体验 / 混合 / 功能）

学生选格子时确定三层组合（如 ToB·成本·老人·混合），评分时三层同时生效。

---

### 数据文件

#### `game_config_v0.1/vp_anchor_profiles.json`

从 `VP_SCORING_ANCHOR_PROFILES_V3.md` 转成 JSON，结构如下：

```json
{
  "market": {
    "ToB_Elder": {
      "customer_group": "服务老年人的机构。包括民营养老院...",
      "pain_anchors": [
        { "text": "护工短缺与成本刚性上涨——养老护理行业人力成本逐年增长...", "weight": 1.0 },
        { "text": "夜间安全监护缺口——夜间值班人力最薄弱...", "weight": 0.9 },
        { "text": "日常陪伴缺失——老人清醒时间大量空置...", "weight": 0.8 },
        { "text": "家属满意度压力——家属远程关注服务质量...", "weight": 0.7 },
        { "text": "政策合规与展示需求——政府推动智慧养老...", "weight": 0.6 },
        { "text": "老人情绪波动管理——傍晚黄昏综合征...", "weight": 0.5 }
      ],
      "alternatives": "增加护工人手——成本高且招不到人...",
      "solution_expectations": "替代或辅助人力是核心诉求..."
    },
    "ToB_Adult": { ... },
    "ToB_Child": { ... },
    "ToC_Elder": { ... },
    "ToC_Adult": { ... },
    "ToC_Child": { ... }
  },
  "strategy": {
    "Differentiation": {
      "customer_traits": "核心诉求是更好更独特别人没有...",
      "value_perception": "对比维度是体验效果品质不是价格...",
      "solution_expectations": "能说清跟现有方案比好在哪..."
    },
    "Cost": {
      "customer_traits": "核心诉求是用更低成本达到可接受效果...",
      "value_perception": "对比维度是成本...",
      "solution_expectations": "能算清账投入多少节省多少..."
    }
  },
  "architecture": {
    "Experience": {
      "customer_traits": "核心购买动机是情感满足和感受变化...",
      "value_perception": "温度和生命感是最重要的...",
      "solution_expectations": "能引发情感反应主动互动..."
    },
    "Hybrid": { ... },
    "Function": { ... }
  }
}
```

Codex 把 V3.md 的全部文本逐段填入此 JSON。`pain_anchors` 是数组，每条带 `text` 和 `weight`。其余字段是完整段落字符串。

#### `game_config_v0.1/vp_anchor_embeddings.json`

预计算的 embedding 缓存。由脚本 `scripts/precompute_vp_anchors.js` 生成（见 Section 5）。结构：

```json
{
  "market.ToB_Elder.customer_group": [0.012, -0.034, ...],
  "market.ToB_Elder.pain_anchor_0": [0.008, ...],
  "market.ToB_Elder.pain_anchor_1": [...],
  ...
  "market.ToB_Elder.alternatives": [...],
  "market.ToB_Elder.solution_expectations": [...],
  "strategy.Cost.customer_traits": [...],
  ...
}
```

---

### Section 1：VP 字段提取（LLM，实时）

#### 函数：`extractVpFields(vpText)`

一次 LLM 调用，从 VP 句子提取 5 个字段。

**Prompt（写死，不要改动）**：

```
你是一个文本切片工具。把下面这句价值主张拆成 5 个字段。

规则：
- 只从原文中切出相关片段，不要改写、润色、抽象化
- 保留原文的核心名词和动词
- 如果某个字段在原文中没有提到，填 "未明确"
- 不要补充原文里没有的信息
- 只输出 JSON

待拆分的价值主张：
"${vpText}"

输出格式：
{
  "who_raw": "目标客户是谁（原文切片）",
  "pain_raw": "痛点是什么（原文切片）",
  "how_raw": "怎么解决的（原文切片）",
  "alternative_raw": "跟什么替代方案比（原文切片）",
  "boundary_raw": "什么时候不管用（原文切片）"
}
```

**参数**：temperature=0, max_tokens=300

**返回**：5 个字段的原文切片。

---

### Section 2：Embedding 计算（实时）

对 5 个字段分别调 embedding API：

```javascript
const who_vec = await getEmbedding(fields.who_raw);
const pain_vec = await getEmbedding(fields.pain_raw);
const how_vec = await getEmbedding(fields.how_raw);
const alt_vec = fields.alternative_raw !== "未明确" ? await getEmbedding(fields.alternative_raw) : null;
const boundary_raw = fields.boundary_raw; // boundary 不做 embedding，走规则
```

`getEmbedding` 复用现有的 `embeddingService.js`。

---

### Section 3：相似度计算与 C/G/E 打分

#### 输入

学生选了格子后确定三层：

```javascript
const marketKey = "ToB_Elder";    // 从 grid_id 映射
const strategyKey = "Cost";       // 从 grid_id 映射
const archKey = "Hybrid";         // 从 architecture 映射
```

#### 3a. C 维度（人群覆盖面）

C 衡量：学生描述的 WHO 和 PAIN 是否落在这个市场的有效空间里。

```javascript
const sim_who = cosine(who_vec, anchors[`market.${marketKey}.customer_group`]);
const sim_pain_summary = cosine(pain_vec, anchors[`market.${marketKey}.solution_expectations`]);

const C_raw = 0.55 * sim_who + 0.45 * sim_pain_summary;
```

说明：C 更关注 WHO 的精准度，所以 who 权重略高。pain 在 C 里只看"有没有落在这个市场里"，不看频率排名（那是 G 的事）。

#### 3b. G 维度（痛点可泛化率）

G 衡量：学生描述的痛点在这个市场里是不是高频的、核心的。

**用 atomic anchor weighted match，不是整段 sim。**

```javascript
// 加载该市场的 pain anchors（已预计算 embedding）
const painAnchors = profiles.market[marketKey].pain_anchors; // [{text, weight}, ...]

// 逐条算 sim
const painMatches = painAnchors.map((anchor, i) => ({
  sim: cosine(pain_vec, anchors[`market.${marketKey}.pain_anchor_${i}`]),
  weight: anchor.weight
}));

// 取 top-2 weighted match
painMatches.sort((a, b) => (b.sim * b.weight) - (a.sim * a.weight));
const top2 = painMatches.slice(0, 2);
const G_pain = (top2[0].sim * top2[0].weight + (top2[1]?.sim * top2[1]?.weight || 0)) / 
               (top2[0].weight + (top2[1]?.weight || 0));

// 策略层匹配（痛点是否符合成本/差异化的客户心理）
const sim_pain_strategy = cosine(pain_vec, anchors[`strategy.${strategyKey}.customer_traits`]);

const G_raw = 0.7 * G_pain + 0.3 * sim_pain_strategy;
```

说明：G 的核心是 atomic pain match。命中排名第一的痛点（weight=1.0）比命中第五的（weight=0.5）得分高。策略层匹配占 30%，用来校正——成本策略的客户对"省钱"相关痛点更敏感。

#### 3c. E 维度（解法说服力）

E 衡量：学生描述的 HOW 是否符合这个市场 + 策略 + 架构的客户期待。

```javascript
// 三层解法期待匹配
const sim_how_market = cosine(how_vec, anchors[`market.${marketKey}.solution_expectations`]);
const sim_how_strategy = cosine(how_vec, anchors[`strategy.${strategyKey}.solution_expectations`]);
const sim_how_arch = cosine(how_vec, anchors[`architecture.${archKey}.solution_expectations`]);

// alternative 单独匹配
let sim_alt = 0;
if (alt_vec) {
  sim_alt = cosine(alt_vec, anchors[`market.${marketKey}.alternatives`]);
}

// boundary 规则项（不做 embedding）
const boundary_score = scoreBoundary(fields.boundary_raw, marketKey);

const E_raw = 0.30 * sim_how_market + 0.25 * sim_how_strategy + 0.25 * sim_how_arch 
            + 0.12 * sim_alt + 0.08 * boundary_score;
```

#### 3d. Boundary 规则函数

```javascript
function scoreBoundary(boundaryText, marketKey) {
  if (!boundaryText || boundaryText === "未明确") return 0.0;
  
  const text = String(boundaryText).trim();
  if (text.length < 4) return 0.0;
  
  // 检查是否跟产品能力或用户适配相关
  // 关键词列表（按市场可扩展）
  const relevantKeywords = {
    "ToB_Elder": ["失智", "认知障碍", "重症", "自理", "瘫痪", "临终", "夜间", "白天"],
    "ToB_Adult": ["隐私", "噪音", "空间", "人流", "高峰"],
    "ToB_Child": ["年龄", "婴儿", "特殊需求", "过敏", "恐惧", "空间"],
    "ToC_Elder": ["失智", "认知", "视力", "听力", "行动不便", "抗拒"],
    "ToC_Adult": ["出差", "长期不在", "多人", "空间", "抵触"],
    "ToC_Child": ["年龄", "婴幼儿", "过敏", "上瘾", "屏幕"]
  };
  
  const keywords = relevantKeywords[marketKey] || [];
  const isRelevant = keywords.some(kw => text.includes(kw));
  
  if (isRelevant) return 1.0;  // 写了且跟市场/产品相关
  return 0.5;                   // 写了但相关性不确定
}
```

---

### Section 4：Raw → 1~5 分映射

余弦相似度集中在 0.5~0.9 区间。用分段线性映射：

```javascript
function rawToScore(raw) {
  if (raw < 0.45) return 1.0;
  if (raw < 0.55) return 1.0 + (raw - 0.45) / (0.55 - 0.45) * 1.5;  // 1.0 → 2.5
  if (raw < 0.68) return 2.5 + (raw - 0.55) / (0.68 - 0.55) * 1.3;  // 2.5 → 3.8
  if (raw < 0.80) return 3.8 + (raw - 0.68) / (0.80 - 0.68) * 0.7;  // 3.8 → 4.5
  return Math.min(5.0, 4.5 + (raw - 0.80) / (0.95 - 0.80) * 0.5);   // 4.5 → 5.0
}
```

**注意**：这些阈值是初始值。Section 6 的校准脚本会用已知 VP 反推最优阈值。

最终输出：

```javascript
return {
  C: clipScore(rawToScore(C_raw)),
  G: clipScore(rawToScore(G_raw)),
  E: clipScore(rawToScore(E_raw)),
  details: {
    who_sim: sim_who,
    pain_summary_sim: sim_pain_summary,
    pain_top2: top2.map(t => ({ sim: t.sim, weight: t.weight })),
    pain_strategy_sim: sim_pain_strategy,
    how_market_sim: sim_how_market,
    how_strategy_sim: sim_how_strategy,
    how_arch_sim: sim_how_arch,
    alt_sim: sim_alt,
    boundary_score: boundary_score
  }
};
```

`details` 不给学生看，留给教师 dashboard。

---

### Section 5：预计算脚本 `scripts/precompute_vp_anchors.js`

部署时跑一次，把所有 anchor 文本转成 embedding 存 JSON。

```javascript
// 读 vp_anchor_profiles.json
// 对每段文本调 getEmbedding()
// 痛点空间逐条单独 embed
// 存到 vp_anchor_embeddings.json
```

运行方式：
```bash
source .env
node scripts/precompute_vp_anchors.js
```

输出：`game_config_v0.1/vp_anchor_embeddings.json`

---

### Section 6：校准脚本 `scripts/calibrate_vp_scorer.js`

用已知的 VP 样本（好的和差的）跑评分，输出 raw 分布，用于调整 Section 4 的阈值。

**输入**：手写 10 条 VP + 预期分数范围

```javascript
const CALIBRATION_SAMPLES = [
  {
    vp: "养老院用。老人孤单，员工忙。机器人陪聊，省人力。",
    grid: "ToB_Cost_Elder", arch: "Hybrid",
    expected: { C: [1.5, 2.5], G: [1.5, 2.5], E: [1.0, 2.0] }
  },
  {
    vp: "为傍晚时段老人多、员工少的养老院，提供能承担陪聊任务的LOVOT机器人，让员工能脱身去处理发药查房等工作，从而节省人力成本——比请人便宜。失智老人除外。",
    grid: "ToB_Cost_Elder", arch: "Hybrid",
    expected: { C: [3.0, 4.0], G: [2.5, 3.5], E: [3.0, 4.0] }
  },
  // ... 更多样本
];
```

跑完输出每条 VP 的 raw sim 值和最终分数，方便手动调阈值。

---

### Section 7：主评分函数 `vpEmbeddingScorer.js`

新建文件 `server/llm/vpEmbeddingScorer.js`：

```javascript
module.exports = {
  scoreVpByEmbedding,  // 主函数
  extractVpFields,      // LLM 字段提取
  loadAnchors,          // 加载预计算 embedding
  rawToScore,           // 映射函数（可校准）
  scoreBoundary         // 边界规则
};
```

**不要修改现有的 `vpScorer.js`。** 新系统和旧系统并存，通过路由层切换（后续前端 spec 里做）。

---

### Section 8：测试脚本 `scripts/test_vp_embedding_scorer.js`

复用 `test_vp_coach_v2.js` 的流程，但把 `scoreVpText` 替换为 `scoreVpByEmbedding`。

输出对比：每个 scenario 打印 LLM 评分和 Embedding 评分的对比。

```
[1/6] ToB成人混合-草根老板
  VP: "为傍晚时段老人多..."
  LLM Scorer:      C=3.9  G=3.5  E=3.4
  Embedding Scorer: C=3.2  G=2.8  E=3.1
  Details: who_sim=0.74 pain_top1={sim:0.81,w:1.0} ...
```

---

### 格子到 profile key 的映射

```javascript
const GRID_TO_PROFILE = {
  "ToB_Differentiation_Elder": { market: "ToB_Elder", strategy: "Differentiation" },
  "ToB_Cost_Elder":            { market: "ToB_Elder", strategy: "Cost" },
  "ToB_Differentiation_Adult": { market: "ToB_Adult", strategy: "Differentiation" },
  "ToB_Cost_Adult":            { market: "ToB_Adult", strategy: "Cost" },
  "ToB_Differentiation_Child": { market: "ToB_Child", strategy: "Differentiation" },
  "ToB_Cost_Child":            { market: "ToB_Child", strategy: "Cost" },
  "ToC_Differentiation_Elder": { market: "ToC_Elder", strategy: "Differentiation" },
  "ToC_Cost_Elder":            { market: "ToC_Elder", strategy: "Cost" },
  "ToC_Differentiation_Adult": { market: "ToC_Adult", strategy: "Differentiation" },
  "ToC_Cost_Adult":            { market: "ToC_Adult", strategy: "Cost" },
  "ToC_Differentiation_Child": { market: "ToC_Child", strategy: "Differentiation" },
  "ToC_Cost_Child":            { market: "ToC_Child", strategy: "Cost" }
};
```

架构从 `session.strategy.architecture` 直接取（Experience / Hybrid / Function）。

---

### 依赖

- `server/llm/embeddingService.js`（已有）——getEmbedding 函数
- `server/llm/deepseekClient.js`（已有）——chatCompletion 用于字段提取
- `game_config_v0.1/vp_anchor_profiles.json`（新建）
- `game_config_v0.1/vp_anchor_embeddings.json`（预计算生成）

---

### 验收标准

1. `scripts/precompute_vp_anchors.js` 能跑通，生成 `vp_anchor_embeddings.json`
2. `scripts/test_vp_embedding_scorer.js` 能跑通 6 个场景
3. 草根老板（碎片输入）的分数明显低于体制转型者（完整输入）
4. 同一句 VP 跑两次，分数完全一样（确定性）
5. txt 输出包含 details（各 sim 值）

---

### 不要改的东西

- `vpScorer.js` 不动——旧系统保留，新旧并存
- `vpCoach.js` 不动
- `embeddingService.js` 不动（只复用）
- `test_vp_coach_v2.js` 不动
- `vp_anchor_profiles.json` 不要自动生成——从 V3.md 手动转换

---

### 运行顺序

```bash
# 1. 预计算 anchor embedding
source .env
node scripts/precompute_vp_anchors.js

# 2. 跑测试
node scripts/test_vp_embedding_scorer.js
```
