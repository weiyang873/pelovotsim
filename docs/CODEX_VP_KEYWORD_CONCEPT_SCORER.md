# CODEX_VP_KEYWORD_CONCEPT_SCORER.md
## VP 概念空间评分 — 关键词级映射

### 概述

替换 vpConceptScorer.js 的评分核心逻辑。不再对整个字段做一次 embedding，而是：

1. 把 VP 字段拆成关键词
2. 每个关键词单独 embed
3. 每个关键词找到它最近的 concept（从 39 个里选）
4. 数命中了几个不同的 concept，加总 sim 值
5. 跟 anchor 的命中 concept 集合做 overlap 比较

这样"养老院用"命中 2 个 concept，"面临护工成本上涨和夜间跌倒高风险的养老机构"命中 5 个 concept，分数天然不同。

---

### Section 1：关键词提取（规则，不走 LLM）

对 VP 字段的原文切片做简单分词。不需要 jieba 等分词库，用标点和停用词切分即可：

```javascript
/**
 * 把一段中文文本切成关键词片段
 * 规则：按标点、助词、连接词切分，过滤掉太短的片段
 */
function extractKeywords(text) {
  if (!text || text === "未明确") return [];
  
  // 按标点和常见连接词切分
  const segments = String(text)
    .split(/[，。、；：！？""''（）\-——\s]+/)
    .map(s => s.trim())
    .filter(s => s.length >= 2);  // 至少2个字
  
  // 进一步按助词切分长片段
  const keywords = [];
  for (const seg of segments) {
    // 按"的""和""与""以及""通过""从而""让""使""为""在"切分
    const parts = seg
      .split(/(?:的|和|与|以及|通过|从而|让|使得|为了|在于|还有|并且|同时|比如|例如)/)
      .map(p => p.trim())
      .filter(p => p.length >= 2);
    keywords.push(...(parts.length > 0 ? parts : [seg]));
  }
  
  // 去重
  return [...new Set(keywords)];
}
```

示例：
```
"养老院用。老人孤单，员工忙。" 
  → ["养老院用", "老人孤单", "员工忙"]

"面临护工成本上涨和夜间跌倒高风险的养老机构"
  → ["面临护工成本上涨", "夜间跌倒高风险", "养老机构"]

"为护工短缺的养老院，提供能陪聊的机器人，让员工能去忙别的事，比请人便宜。失智老人不行。"
  → ["护工短缺", "养老院", "提供能陪聊", "机器人", "员工能去忙别", "事", "比请人便宜", "失智老人不行"]
  → 过滤掉 length < 2 的 → ["护工短缺", "养老院", "提供能陪聊", "机器人", "员工能去忙别", "比请人便宜", "失智老人不行"]
```

---

### Section 2：关键词到概念的映射

每个关键词 embed 后，跟 39 个 concept_vec 算 cosine，取 top-1 作为该关键词"命中"的概念：

```javascript
/**
 * 对一组关键词，每个找到最近的 concept，返回命中的 concept 集合
 * @param {string[]} keywords - 关键词数组
 * @param {number[][]} conceptVecs - 39 个 concept 的 embedding 向量
 * @param {string[]} conceptNames - 39 个 concept 的文本
 * @returns {Map<number, {concept: string, bestSim: number, keyword: string}>}
 *   key = concept index，value = 最佳匹配信息
 *   同一个 concept 被多个 keyword 命中时，保留 sim 最高的那个
 */
async function mapKeywordsToConcepts(keywords, conceptVecs, conceptNames) {
  const hits = new Map();  // conceptIndex → { concept, bestSim, keyword }
  
  for (const kw of keywords) {
    const kwVec = await embed(kw);
    
    let bestIdx = -1;
    let bestSim = -1;
    for (let i = 0; i < conceptVecs.length; i++) {
      const sim = cosine(kwVec, conceptVecs[i]);
      if (sim > bestSim) {
        bestSim = sim;
        bestIdx = i;
      }
    }
    
    if (bestIdx >= 0) {
      const existing = hits.get(bestIdx);
      if (!existing || bestSim > existing.bestSim) {
        hits.set(bestIdx, {
          concept: conceptNames[bestIdx],
          bestSim,
          keyword: kw
        });
      }
    }
  }
  
  return hits;
}
```

---

### Section 3：Anchor 的概念命中集合（预计算）

对每个 anchor 文本做同样的操作：拆关键词 → 每个关键词找最近 concept → 得到命中集合。

**在 precompute 阶段执行**，存入 `vp_concept_cache.json`。

修改 `scripts/precompute_vp_concepts.js`，对每个 anchor 小节：

```javascript
// 对每个 anchor 文本
const anchorKeywords = extractKeywords(anchorText);
const anchorHits = await mapKeywordsToConcepts(anchorKeywords, conceptVecs, concepts);

// 存成可序列化的格式
// key: "market.ToB_Elder.customer_group_hits"
// value: [{ conceptIdx: 0, concept: "护工短缺与人力成本上涨", bestSim: 0.62, keyword: "护工短缺" }, ...]
fingerprints[`${anchorKey}_hits`] = [...anchorHits.entries()].map(([idx, hit]) => ({
  conceptIdx: idx,
  concept: hit.concept,
  bestSim: hit.bestSim,
  keyword: hit.keyword
}));
```

同时保留原来的整段指纹（`fingerprints[anchorKey]`），向后兼容。

---

### Section 4：评分核心函数

```javascript
/**
 * 计算 VP 字段跟 anchor 的概念匹配分
 * @param {Map<number, object>} vpHits - VP 关键词的概念命中集合
 * @param {Array<object>} anchorHits - anchor 的概念命中集合（从 cache 加载）
 * @returns {{ score: number, overlap: number, vpCount: number, anchorCount: number, details: object[] }}
 */
function keywordConceptScore(vpHits, anchorHits) {
  // anchor 命中的 concept index 集合
  const anchorSet = new Map();
  for (const hit of anchorHits) {
    anchorSet.set(hit.conceptIdx, hit);
  }
  
  // 计算 overlap：VP 和 anchor 共同命中的 concept
  let overlapSimSum = 0;  // 重合概念的 VP 侧 sim 加总
  let overlapCount = 0;
  const overlapDetails = [];
  
  for (const [conceptIdx, vpHit] of vpHits) {
    const anchorHit = anchorSet.get(conceptIdx);
    if (anchorHit) {
      overlapCount++;
      overlapSimSum += vpHit.bestSim;
      overlapDetails.push({
        concept: vpHit.concept,
        vpKeyword: vpHit.keyword,
        vpSim: vpHit.bestSim,
        anchorKeyword: anchorHit.keyword,
        anchorSim: anchorHit.bestSim
      });
    }
  }
  
  const anchorCount = anchorSet.size;
  const vpCount = vpHits.size;
  
  // 分数 = 重合概念数 / anchor 概念数 × 重合概念的平均 sim
  // 这样：命中越多 → 分子大；anchor 概念多的格子 → 分母大，天然归一化
  // 乘以平均 sim → 命中质量高分更高
  const coverage = anchorCount > 0 ? overlapCount / anchorCount : 0;
  const avgSim = overlapCount > 0 ? overlapSimSum / overlapCount : 0;
  const score = coverage * avgSim;
  
  return {
    score,
    overlap: overlapCount,
    vpCount,
    anchorCount,
    avgSim,
    coverage,
    details: overlapDetails
  };
}
```

**直觉**：
- "养老院用" → 3 个关键词 → 命中 2 个 concept → anchor 有 10 个 concept → coverage=0.2 × avgSim≈0.50 → score=0.10
- "护工短缺的养老院...比请人便宜" → 7 个关键词 → 命中 5 个 concept → coverage=0.5 × avgSim≈0.55 → score=0.28
- "面临护工成本上涨...失智老人需结合" → 12 个关键词 → 命中 8 个 concept → coverage=0.8 × avgSim≈0.58 → score=0.46

映射到 1-5 分：score × 5 + 1（cap 在 1~5）：
- 差：0.10 × 8 + 1 = 1.8
- 中：0.28 × 8 + 1 = 3.2
- 好：0.46 × 8 + 1 = 4.7

（乘数 8 是初始估计，跑校准数据后调整。）

---

### Section 5：C/G/E 计算

```javascript
async function scoreVpByConcept(vpText, gridId, architecture) {
  const c = loadCache();
  const { market: marketKey, strategy: strategyKey } = GRID_TO_PROFILE[gridId];
  const archKey = architecture;
  
  // Step 1: LLM 提取字段（不变）
  const fields = await extractVpFields(vpText);
  
  // Step 2: 每个字段拆关键词 → 映射到概念
  await init();
  
  const who_kw = extractKeywords(fields.who_raw);
  const pain_kw = extractKeywords(fields.pain_raw);
  const how_kw = extractKeywords(fields.how_raw);
  const alt_kw = fields.alternative_raw !== "未明确" ? extractKeywords(fields.alternative_raw) : [];
  
  const who_hits = await mapKeywordsToConcepts(who_kw, c.conceptVecs, c.concepts);
  const pain_hits = await mapKeywordsToConcepts(pain_kw, c.conceptVecs, c.concepts);
  const how_hits = await mapKeywordsToConcepts(how_kw, c.conceptVecs, c.concepts);
  const alt_hits = alt_kw.length > 0 
    ? await mapKeywordsToConcepts(alt_kw, c.conceptVecs, c.concepts) : new Map();
  
  // Step 3: 跟各层 anchor 的命中集合比较
  
  // C 维度
  const who_score = keywordConceptScore(who_hits, c.anchorHits[`market.${marketKey}.customer_group`]);
  const pain_se_score = keywordConceptScore(pain_hits, c.anchorHits[`market.${marketKey}.solution_expectations`]);
  const C_raw = 0.55 * who_score.score + 0.45 * pain_se_score.score;
  
  // G 维度：逐条 pain anchor 匹配
  const painAnchors = c.profiles.market[marketKey].pain_anchors;
  const painMatches = painAnchors.map((anchor, i) => {
    const matchResult = keywordConceptScore(pain_hits, c.anchorHits[`market.${marketKey}.pain_anchor_${i}`]);
    return {
      text: anchor.text,
      score: matchResult.score,
      overlap: matchResult.overlap,
      weight: anchor.weight
    };
  });
  painMatches.sort((a, b) => (b.score * b.weight) - (a.score * a.weight));
  const top2 = painMatches.slice(0, 2);
  const G_pain = (top2[0].score * top2[0].weight + (top2[1]?.score * top2[1]?.weight || 0))
               / (top2[0].weight + (top2[1]?.weight || 0));
  
  const pain_strat_score = keywordConceptScore(pain_hits, c.anchorHits[`strategy.${strategyKey}.customer_traits`]);
  const G_raw = 0.70 * G_pain + 0.30 * pain_strat_score.score;
  
  // E 维度
  const how_market_score = keywordConceptScore(how_hits, c.anchorHits[`market.${marketKey}.solution_expectations`]);
  const how_strat_score = keywordConceptScore(how_hits, c.anchorHits[`strategy.${strategyKey}.solution_expectations`]);
  const how_arch_score = keywordConceptScore(how_hits, c.anchorHits[`architecture.${archKey}.solution_expectations`]);
  const alt_market_score = alt_hits.size > 0
    ? keywordConceptScore(alt_hits, c.anchorHits[`market.${marketKey}.alternatives`])
    : { score: 0, overlap: 0 };
  const boundary_score = scoreBoundary(fields.boundary_raw, marketKey);
  
  const E_raw = 0.30 * how_market_score.score + 0.25 * how_strat_score.score + 0.25 * how_arch_score.score
              + 0.12 * alt_market_score.score + 0.08 * boundary_score;
  
  // Step 4: 映射到 1-5
  const MULTIPLIER = 8;  // 校准参数，跑完校准样本后调整
  function rawToScore(raw) {
    const s = 1.0 + raw * MULTIPLIER;
    return Math.max(1.0, Math.min(5.0, Math.round(s * 10) / 10));
  }
  
  return {
    scores: { C: rawToScore(C_raw), G: rawToScore(G_raw), E: rawToScore(E_raw) },
    fields,
    details: {
      marketKey, strategyKey, archKey,
      who: { keywords: who_kw, hits: who_hits.size, ...who_score },
      pain_se: { keywords: pain_kw, hits: pain_hits.size, ...pain_se_score },
      pain_top2: top2,
      pain_strategy: pain_strat_score,
      how_market: { keywords: how_kw, hits: how_hits.size, ...how_market_score },
      how_strategy: how_strat_score,
      how_arch: how_arch_score,
      alt: { keywords: alt_kw, hits: alt_hits.size, ...alt_market_score },
      boundary_score,
      C_raw, G_raw, E_raw,
      MULTIPLIER
    }
  };
}
```

---

### Section 6：precompute 脚本改动

`scripts/precompute_vp_concepts.js` 需要新增 anchor 的关键词命中集合计算。

在现有的指纹计算之后，加一段：

```javascript
// 计算每个 anchor 的关键词 → concept 命中集合
const anchorHits = {};

for (const [key, profile] of Object.entries(profiles.market)) {
  // customer_group
  const cg_kw = extractKeywords(profile.customer_group);
  anchorHits[`market.${key}.customer_group`] = await computeAnchorHits(cg_kw, conceptVecs, concepts);
  
  // 每条 pain_anchor
  for (let i = 0; i < profile.pain_anchors.length; i++) {
    const pa_kw = extractKeywords(profile.pain_anchors[i].text);
    anchorHits[`market.${key}.pain_anchor_${i}`] = await computeAnchorHits(pa_kw, conceptVecs, concepts);
  }
  
  // alternatives
  const alt_kw = extractKeywords(profile.alternatives);
  anchorHits[`market.${key}.alternatives`] = await computeAnchorHits(alt_kw, conceptVecs, concepts);
  
  // solution_expectations
  const se_kw = extractKeywords(profile.solution_expectations);
  anchorHits[`market.${key}.solution_expectations`] = await computeAnchorHits(se_kw, conceptVecs, concepts);
}

for (const [key, profile] of Object.entries(profiles.strategy)) {
  for (const field of ["customer_traits", "value_perception", "solution_expectations"]) {
    const kw = extractKeywords(profile[field]);
    anchorHits[`strategy.${key}.${field}`] = await computeAnchorHits(kw, conceptVecs, concepts);
  }
}

for (const [key, profile] of Object.entries(profiles.architecture)) {
  for (const field of ["customer_traits", "value_perception", "solution_expectations"]) {
    const kw = extractKeywords(profile[field]);
    anchorHits[`architecture.${key}.${field}`] = await computeAnchorHits(kw, conceptVecs, concepts);
  }
}

// computeAnchorHits 就是 mapKeywordsToConcepts 的序列化版本
async function computeAnchorHits(keywords, conceptVecs, concepts) {
  const hits = await mapKeywordsToConcepts(keywords, conceptVecs, concepts);
  return [...hits.entries()].map(([idx, hit]) => ({
    conceptIdx: idx,
    concept: hit.concept,
    bestSim: hit.bestSim,
    keyword: hit.keyword
  }));
}

// 保存到 cache
output.anchorHits = anchorHits;
```

---

### Section 7：测试脚本

修改 `scripts/test_vp_concept_scorer.js`：

#### 7a. 保留 6 条校准样本

#### 7b. 输出格式改为：

```
[差] grid=ToB_Cost_Elder arch=Hybrid
  VP: "养老院用。老人孤单，员工忙。机器人陪聊。"
  C=1.8  G=1.3  E=1.2  (C_raw=0.10  G_raw=0.04  E_raw=0.03)
  who: keywords=["养老院用","老人孤单","员工忙"] → 3个概念命中, anchor有10个, overlap=2, coverage=0.20, avgSim=0.50
    命中: "护工短缺"(kw="员工忙",sim=0.48) "老人陪伴缺失"(kw="老人孤单",sim=0.52)
  pain: keywords=["老人孤单","员工忙"] → 2个概念命中
  how: keywords=["机器人陪聊"] → 1个概念命中
  alt: (未提供)
  boundary: 0.00

[好] grid=ToB_Cost_Elder arch=Hybrid
  VP: "为面临护工成本上涨和夜间跌倒高风险的养老机构..."
  C=4.7  G=4.2  E=3.8  (C_raw=0.46  G_raw=0.40  E_raw=0.35)
  who: keywords=["面临护工成本上涨","夜间跌倒高风险","养老机构"] → 3个概念命中, anchor有10个, overlap=3, coverage=0.30, avgSim=0.58
    命中: "护工短缺"(kw="护工成本上涨",sim=0.62) "夜间安全"(kw="夜间跌倒",sim=0.60) "家属满意"(kw="高风险",sim=0.48)
  ...
```

#### 7c. 分档判断 + raw 分布 + MULTIPLIER 扫描

```javascript
// 分档判断
console.log(`Bucket averages: 差=${bad_avg} 中=${mid_avg} 好=${good_avg}`);
console.log(`Three-tier separated: ${bad_avg < mid_avg && mid_avg < good_avg ? "YES" : "NO"}`);

// Raw 分布
console.log(`Raw distribution: min=${min} max=${max} mean=${mean}`);

// MULTIPLIER 扫描：从 4 到 16 步长 2，看哪个值让三档的分数间距最大
const multipliers = [4, 6, 8, 10, 12, 14, 16];
console.log("\n====== MULTIPLIER Scan ======");
console.log("MULT | 差avg | 中avg | 好avg | 间距(好-差)");
for (const m of multipliers) {
  // 用当前 raw 值和不同 m 计算 score
  // 打印
}
```

---

### Section 8：extractKeywords 和 mapKeywordsToConcepts 放哪里

这两个函数放在 `vpConceptScorer.js` 里，作为内部函数。同时 export `extractKeywords` 给 precompute 脚本用：

```javascript
module.exports = {
  scoreVpByConcept,
  extractVpFields,
  extractKeywords,        // 新增
  mapKeywordsToConcepts,  // 新增
  keywordConceptScore,    // 新增
  computeFingerprint,     // 保留向后兼容
  rawToScore,
  scoreBoundary,
  loadCache
};
```

---

### 运行顺序

```bash
# 1. 重新预计算（因为要新增 anchorHits）
source .env
node scripts/precompute_vp_concepts.js

# 2. 跑校准
node scripts/test_vp_concept_scorer.js
```

**这次必须重新 precompute。**

---

### 验收标准

1. precompute 输出包含 anchorHits 数量（如 "Precomputed 39 concepts, 95 fingerprints, 95 anchorHits"）
2. 6 条校准样本跑通
3. 每条样本能看到关键词 → concept 的映射细节
4. 差 < 中 < 好（三档分开）
5. 同一条 VP 跑两次分数完全一样

---

### 不要改的东西

- `vp_scoring_concepts.json` 不动
- `extractVpFields` 不动
- `scoreBoundary` 不动
- `cosine` 函数不动
- `vpScorer.js` / `vpEmbeddingScorer.js` 不动
