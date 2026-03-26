# CODEX_VP_WORD_SCORER_FINAL.md
## VP 词级评分系统 — 最终版

### 概述

VP 评分用词级 embedding 匹配，三个维度：

- **C（人群覆盖面）**：who vs anchor customer_group — 客户描述多具体
- **G（痛点典型性）**：pain vs anchor customer_group **去掉 C 已命中的词** — 痛点是不是这类客户的典型状态
- **E（解法说服力）**：how vs pain — VP 内部匹配，解法能不能解决痛点

C 和 G 用同一个 anchor（customer_group），C 先匹配，G 用剩余的 anchor 词。
E 不用 anchor，纯看 VP 内部一致性。

**VPscore = sqrt(C × avg(G, E)), cap 5**

整条链路除字段提取外全是确定性计算。字段提取由学生手动确认后锁定。

---

### Section 1：字段提取与学生确认

#### 1a. LLM 预填（一次调用）

学生提交 VP 后，系统调一次 LLM 把 VP 拆成 5 个字段，预填到 5 个可编辑文本框。

复用现有 `extractVpFields(vpText)` 函数，prompt 不变。

#### 1b. 学生确认界面

```
┌─────────────────────────────────────────────┐
│ 你的价值主张：                                │
│ "为面临护工成本上涨和夜间跌倒高风险的养老      │
│  机构，提供具备离床监测功能的机器人..."         │
├─────────────────────────────────────────────┤
│ 系统已帮你拆分如下，请确认或修改：              │
│                                              │
│ 目标客户：[面临护工成本上涨和夜间跌倒高风险的养老机构]│
│ 痛点：    [护工成本上涨；夜间跌倒高风险；传统人力巡检难以实时响应]│
│ 解决方式：[提供离床监测机器人，替代人工巡检优化人力配置]│
│ 替代方案：[传统依赖人力巡检                    ]│
│ 边界条件：[失智老人需结合个性化护理              ]│
│                                              │
│              [确认提交并评分]                   │
└─────────────────────────────────────────────┘
```

#### 1c. 确认后锁定

学生点"确认提交"后，5 个字段锁定存入数据库。后续评分全部基于锁定的字段，不再调 LLM。

```javascript
// 存入数据库
const confirmedFields = {
  who_raw: "面临护工成本上涨和夜间跌倒高风险的养老机构",
  pain_raw: "护工成本上涨；夜间跌倒高风险；传统人力巡检难以实时响应",
  how_raw: "提供离床监测机器人，替代人工巡检优化人力配置",
  alternative_raw: "传统依赖人力巡检",
  boundary_raw: "失智老人需结合个性化护理",
  confirmed_at: new Date().toISOString()
};
```

---

### Section 2：分词

复用现有 `tokenize()` 函数（jieba + 停用词过滤）。

```javascript
const nodejieba = require("nodejieba");

const STOP_WORDS = new Set([
  "提供", "通过", "从而", "能够", "可以", "进行", "实现",
  "一个", "一台", "一种", "这个", "那个", "什么", "怎么",
  "因为", "所以", "但是", "而且", "以及", "或者", "如果",
  "就是", "已经", "这样", "那样", "比较", "非常", "特别",
  "主要", "目前", "当前", "其中", "之间", "方面", "情况",
  "不是", "没有", "不能", "而是", "这些", "那些", "自己",
  "他们", "我们", "你们", "它们", "需要", "使得", "为了",
  "同时", "并且", "还有", "不仅", "虽然", "然而"
]);

function tokenize(text) {
  if (!text || text === "未明确") return [];
  return nodejieba.cut(text)
    .map(w => w.trim())
    .filter(w => w.length >= 2)
    .filter(w => !STOP_WORDS.has(w))
    .filter(w => !/^[\d\s，。、；：！？""''（）【】\-——…·]+$/.test(w));
}
```

---

### Section 3：词级匹配核心函数

```javascript
/**
 * VP 字段的词跟 anchor 词做匹配
 * 每个 VP 词跟 anchor 所有词算 sim，取 max
 * sim >= minSim 的算命中，累加 simSum
 *
 * @param {string} vpFieldText - VP 字段原文
 * @param {object} anchorWordData - { words: string[], vecs: number[][] }
 * @param {Set<number>} excludeIndices - 要排除的 anchor 词索引（用于 G 去掉 C 已命中的词）
 * @param {number} minSim - 命中阈值，默认 0.45
 * @returns {object}
 */
async function wordMatchScore(vpFieldText, anchorWordData, excludeIndices = new Set(), minSim = 0.45) {
  const vpWords = tokenize(vpFieldText);
  const anchorWords = anchorWordData.words;
  const anchorVecs = anchorWordData.vecs;

  if (vpWords.length === 0 || anchorWords.length === 0) {
    return { simSum: 0, qualifiedCount: 0, vpWords, matchDetails: [], matchedAnchorIndices: new Set() };
  }

  let simSum = 0;
  let qualifiedCount = 0;
  const matchDetails = [];
  const matchedAnchorIndices = new Set();

  for (const vpWord of vpWords) {
    const vpVec = await embed(vpWord);

    let bestSim = -1;
    let bestAnchorWord = "";
    let bestAnchorIdx = -1;

    for (let j = 0; j < anchorVecs.length; j++) {
      if (excludeIndices.has(j)) continue;  // 跳过已被 C 命中的词
      const sim = cosine(vpVec, anchorVecs[j]);
      if (sim > bestSim) {
        bestSim = sim;
        bestAnchorWord = anchorWords[j];
        bestAnchorIdx = j;
      }
    }

    const qualified = bestSim >= minSim;
    if (qualified) {
      simSum += bestSim;
      qualifiedCount++;
      matchedAnchorIndices.add(bestAnchorIdx);
    }

    matchDetails.push({
      vpWord,
      bestAnchorWord,
      bestSim: Math.round(bestSim * 100) / 100,
      qualified
    });
  }

  return { simSum, qualifiedCount, vpWords, matchDetails, matchedAnchorIndices };
}
```

---

### Section 4：C/G/E 计算

```javascript
async function scoreVpByWord(confirmedFields, gridId, architecture) {
  await init();
  const cache = loadCache();
  const { market: marketKey } = GRID_TO_PROFILE[gridId];

  const anchorData = cache.wordData[`market.${marketKey}.customer_group`];

  // ===== C =====
  // 覆盖度门槛
  const who_coverage = await sentenceSim(confirmedFields.who_raw, `market.${marketKey}.customer_group`);

  // 词级匹配
  const C_match = await wordMatchScore(confirmedFields.who_raw, anchorData);
  const C_simSum = C_match.simSum;
  const C_matchedIndices = C_match.matchedAnchorIndices;  // C 命中了哪些 anchor 词

  let C;
  if (who_coverage < 0.2) {
    C = 1.0;  // 方向完全不对
  } else {
    C = Math.min(5.0, Math.round((Math.log(Math.pow(C_simSum + 1, 2)) + 1) * 10) / 10);
  }

  // ===== G =====
  // pain vs 同一个 anchor，但去掉 C 已命中的词
  const G_match = await wordMatchScore(confirmedFields.pain_raw, anchorData, C_matchedIndices);
  const G_simSum = G_match.simSum;

  const G = Math.min(5.0, Math.round((Math.log(Math.pow(G_simSum + 1, 2)) + 1) * 10) / 10);

  // ===== E =====
  // how vs pain — VP 内部匹配，不用 anchor
  // 先把 pain 的词做成 anchorWordData 格式
  const painWords = tokenize(confirmedFields.pain_raw);
  const painVecs = [];
  for (const w of painWords) {
    painVecs.push(await embed(w));
  }
  const painWordData = { words: painWords, vecs: painVecs };

  const E_match = await wordMatchScore(confirmedFields.how_raw, painWordData);
  const E_simSum = E_match.simSum;

  // alt 和 boundary 加分
  let alt_bonus = 0;
  if (confirmedFields.alternative_raw && confirmedFields.alternative_raw !== "未明确") {
    const altWords = tokenize(confirmedFields.alternative_raw);
    if (altWords.length > 0) alt_bonus = 0.3;
  }
  let bnd_bonus = 0;
  if (confirmedFields.boundary_raw && confirmedFields.boundary_raw !== "未明确") {
    const bndWords = tokenize(confirmedFields.boundary_raw);
    if (bndWords.length > 0) bnd_bonus = 0.2;
  }

  const E_raw = Math.log(Math.pow(E_simSum + 1, 2)) + 1 + alt_bonus + bnd_bonus;
  const E = Math.min(5.0, Math.round(E_raw * 10) / 10);

  // ===== VPscore =====
  const avgGE = (G + E) / 2;
  const VPscore = Math.min(5.0, Math.round(Math.sqrt(C * avgGE) * 10) / 10);

  return {
    scores: { C, G, E, VPscore },
    confirmedFields,
    details: {
      marketKey,
      who_coverage,
      C_match: {
        simSum: C_simSum,
        qualifiedCount: C_match.qualifiedCount,
        matchDetails: C_match.matchDetails
      },
      G_match: {
        simSum: G_simSum,
        qualifiedCount: G_match.qualifiedCount,
        excludedCount: C_matchedIndices.size,
        matchDetails: G_match.matchDetails
      },
      E_match: {
        simSum: E_simSum,
        qualifiedCount: E_match.qualifiedCount,
        matchDetails: E_match.matchDetails
      },
      alt_bonus,
      bnd_bonus
    }
  };
}
```

---

### Section 5：分数公式汇总

```
C：
  if sentenceSim(who, anchor) < 0.2 → C = 1.0
  else → C = ln((C_simSum + 1)²) + 1, cap 5

G：
  G = ln((G_simSum + 1)²) + 1, cap 5
  （G 用 C 同一个 anchor，去掉 C 已命中的词）

E：
  E = ln((E_simSum + 1)²) + 1 + alt_bonus(0.3) + bnd_bonus(0.2), cap 5
  （E 用 VP 内部匹配：how vs pain）

VPscore = sqrt(C × avg(G, E)), cap 5
```

---

### Section 6：预计算脚本

复用现有的 `scripts/precompute_vp_words.js`。

需要确保以下数据已预计算：

```
cache.wordData[`market.${marketKey}.customer_group`]  → { words: [], vecs: [] }
cache.sentenceVecs[`market.${marketKey}.customer_group`]  → embedding 向量
```

**不需要** pain_anchors、alternatives、solution_expectations 的词级数据了（G 用 customer_group 去重，E 用 VP 内部）。

但保留它们不删——以后教师 dashboard 可能用到。

---

### Section 7：测试脚本 `scripts/test_vp_word_scorer.js`

#### 7a. 6 条校准样本不变

#### 7b. 输出格式

```
[好] grid=ToB_Cost_Elder arch=Hybrid
  VP: "为面临护工成本上涨...失智老人需结合个性化护理。"
  
  fields:
    who: "面临护工成本上涨和夜间跌倒高风险的养老机构"
    pain: "护工成本上涨；夜间跌倒高风险；传统人力巡检难以实时响应"
    how: "提供离床监测机器人，替代人工巡检优化人力配置"
    alt: "传统依赖人力巡检"
    boundary: "失智老人需结合个性化护理"
  
  C: who_coverage=0.57(PASS) simSum=8.12
    "面临" → "面临"(0.95) ✓
    "护工" → "护工"(1.00) ✓
    "成本" → "成本"(1.00) ✓
    "上涨" → "上涨"(1.00) ✓
    "夜间" → "夜间"(1.00) ✓
    "跌倒" → "事故"(0.62) ✓
    "高风险" → "压力"(0.55) ✓
    "养老" → "养老"(1.00) ✓
    "机构" → "机构"(1.00) ✓
  C = 5.0
  
  G: (去掉C命中的9个anchor词) simSum=5.57
    "护工" → "护理院"(0.72) ✓
    "成本" → "预算"(0.65) ✓
    "上涨" → "紧张"(0.48) ✓
    "夜间" → "值班"(0.72) ✓
    "跌倒" → "赔偿"(0.60) ✓
    ...
  G = 4.8
  
  E: (how vs pain 内部匹配) simSum=9.96
    "离床" → "夜间"(0.52) ✓
    "监测" → "巡检"(0.55) ✓
    "替代" → "依赖"(0.58) ✓
    "人工" → "人力"(0.85) ✓
    "巡检" → "巡检"(1.00) ✓
    ...
  E = 5.0 (含 alt_bonus=0.3 bnd_bonus=0.2)
  
  VPscore = sqrt(5.0 × avg(4.8, 5.0)) = sqrt(5.0 × 4.9) = 4.9
```

#### 7c. 分档判断

```javascript
console.log(`Bucket averages: 差=${bad} 中=${mid} 好=${good}`);
console.log(`Three-tier separated: ${bad < mid && mid < good ? "YES" : "NO"}`);
```

#### 7d. 确定性验证

```javascript
const r1 = await scoreVpByWord(fields, grid, arch);
const r2 = await scoreVpByWord(fields, grid, arch);
console.log(`Deterministic: ${JSON.stringify(r1.scores) === JSON.stringify(r2.scores)}`);
```

---

### Section 8：格子映射

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

注：strategy 和 architecture 不参与评分（Coach 管方向），只用 market。

---

### Section 9：依赖

- `server/llm/embeddingService.js`（已有，复用 init/embed）
- `nodejieba`（已安装）
- `game_config_v0.1/vp_anchor_profiles.json`（已有，V4 customer_group）
- `game_config_v0.1/vp_word_cache.json`（已有预计算）

---

### Section 10：不要改的东西

- `vpScorer.js` 不动
- `vpConceptScorer.js` 不动
- `vpEmbeddingScorer.js` 不动（extractVpFields 还在里面，预填时调用）
- `vpCoach.js` 不动
- `embeddingService.js` 不动
- `vp_anchor_profiles.json` 的 pain_anchors / alternatives / solution_expectations / 策略 / 架构部分不动
- 所有现有测试脚本不动

---

### 运行顺序

```bash
# 不需要重新 precompute（customer_group 词数据已在上一轮预计算好）
source .env
node scripts/test_vp_word_scorer.js
```

---

### 验收标准

1. 6 条校准样本跑通
2. 每条样本能看到 C/G/E 的词级匹配细节
3. G 的输出里显示排除了多少个 C 已命中的 anchor 词
4. 差 < 中 < 好（三档分开）
5. 同一组 fields 跑两次分数完全一样
6. E 不使用任何 anchor（纯 VP 内部匹配）
