# CODEX_VP_KEYWORD_SCORER_NODEDUP.md
## VP 关键词评分 — 去掉去重，改用累加

### 背景

当前 `keywordConceptScore` 对同一个 concept 只计一次命中（去重）。但学生从多个角度提到同一个概念时，信息密度更高，应该累加。

本 spec 只改评分逻辑，其他不动。

---

### 改动 1：vpConceptScorer.js — 重写 `keywordConceptScore`

删除现有的 `keywordConceptScore` 函数，替换为：

```javascript
/**
 * 不去重的关键词概念匹配分
 * VP 的每个关键词如果映射到了 anchor 也命中的 concept，就累加 sim
 * 分数 = VP 命中 sim 加总 / anchor 自身 sim 加总
 */
function keywordConceptScore(vpHits, anchorHits) {
  // vpHits: 从 mapKeywordsToConcepts 返回的结果
  //   注意：这里需要的是不去重的版本（每个关键词都保留）
  // anchorHits: 预计算的 anchor 命中列表（也不去重）

  // anchor 命中的 concept index 集合（用于快速查找）
  const anchorConceptSet = new Set(anchorHits.map(h => h.conceptIdx));

  // anchor 自身 sim 加总（分母）
  const anchorSimSum = anchorHits.reduce((sum, h) => sum + h.bestSim, 0);
  if (anchorSimSum === 0) return { score: 0, vpHitCount: 0, vpMatchCount: 0, anchorHitCount: anchorHits.length, details: [] };

  // VP 每个关键词的命中（不去重）
  let vpMatchSimSum = 0;
  let vpMatchCount = 0;
  const matchDetails = [];

  for (const [keyword, hit] of vpHits) {
    // hit = { conceptIdx, concept, bestSim, keyword }
    if (anchorConceptSet.has(hit.conceptIdx)) {
      vpMatchSimSum += hit.bestSim;
      vpMatchCount++;
      matchDetails.push({
        keyword: hit.keyword,
        concept: hit.concept,
        sim: hit.bestSim,
        matched: true
      });
    } else {
      matchDetails.push({
        keyword: hit.keyword,
        concept: hit.concept,
        sim: hit.bestSim,
        matched: false
      });
    }
  }

  return {
    score: vpMatchSimSum / anchorSimSum,
    vpHitCount: vpHits.size || vpHits.length,
    vpMatchCount,
    anchorHitCount: anchorHits.length,
    anchorSimSum,
    vpMatchSimSum,
    details: matchDetails
  };
}
```

---

### 改动 2：`mapKeywordsToConcepts` 改为不去重

现有版本返回 `Map<conceptIdx, hit>`，同一个 concept 只保留 sim 最高的关键词。

改为返回一个**数组**，每个关键词都保留：

```javascript
/**
 * 每个关键词找到最近的 concept，全部返回（不去重）
 * @returns {Array<[string, {conceptIdx, concept, bestSim, keyword}]>}
 *   返回数组而非 Map，同一个 concept 可以出现多次
 */
async function mapKeywordsToConcepts(keywords, conceptVecs, conceptNames) {
  const results = [];

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
      results.push([kw, {
        conceptIdx: bestIdx,
        concept: conceptNames[bestIdx],
        bestSim,
        keyword: kw
      }]);
    }
  }

  return results;
}
```

**注意**：`keywordConceptScore` 里遍历 `vpHits` 的方式从 `for (const [conceptIdx, hit] of vpHits)` 改为 `for (const [keyword, hit] of vpHits)`，因为返回类型从 Map 变成了数组。

---

### 改动 3：precompute 脚本同步改动

`precompute_vp_concepts.js` 里的 `computeAnchorHits` 也改为不去重：

```javascript
async function computeAnchorHits(keywords, conceptVecs, concepts) {
  const results = await mapKeywordsToConcepts(keywords, conceptVecs, concepts);
  return results.map(([kw, hit]) => ({
    conceptIdx: hit.conceptIdx,
    concept: hit.concept,
    bestSim: hit.bestSim,
    keyword: hit.keyword
  }));
}
```

---

### 改动 4：rawToScore 映射调整

不去重后 score 可以超过 1.0（VP 关键词比 anchor 多时）。调整映射：

```javascript
function rawToScore(raw) {
  // 不去重后 raw 范围大约 0~2.0
  // 用 MULTIPLIER=2.5 映射到 1~5
  const s = 1.0 + raw * MULTIPLIER;
  return Math.max(1.0, Math.min(5.0, Math.round(s * 10) / 10));
}
```

MULTIPLIER 初始值改为 **2.5**（从 8 降下来，因为 raw 范围变大了）。

MULTIPLIER scan 范围改为 **1.5 到 4.0 步长 0.5**。

---

### 改动 5：测试脚本输出格式

每条校准样本的输出加上不去重的细节：

```
[差] grid=ToB_Cost_Elder arch=Hybrid
  VP: "养老院用。老人孤单，员工忙。机器人陪聊。"
  C=1.7  G=1.3  E=1.2  (C_raw=0.29  G_raw=0.12  E_raw=0.08)
  who: 4 keywords → 4 concept hits → 2 matched anchor (of 7 anchor hits)
    "养老院用"   → 护工短缺(sim=0.46) ✓
    "老人孤单"   → 独居孤独(sim=0.50) ✗
    "员工忙"     → 护工短缺(sim=0.48) ✓
    "机器人陪聊" → 情感体验(sim=0.46) ✗
    vpMatchSimSum=0.94  anchorSimSum=3.24  score=0.29
```

---

### 运行顺序

```bash
# 必须重新 precompute（anchor hits 格式变了）
source .env
node scripts/precompute_vp_concepts.js

# 跑校准
node scripts/test_vp_concept_scorer.js
```

---

### 验收标准

1. 6 条样本跑通
2. 差 < 中 < 好（三档分开）
3. 每条样本能看到每个关键词的 concept 映射和 ✓/✗ 标记
4. MULTIPLIER scan 输出

---

### 不要改的东西

- `vp_scoring_concepts.json` 不动
- `extractVpFields` 不动
- `extractKeywords` 不动
- `scoreBoundary` 不动
- `cosine` 函数不动
- C/G/E 的权重结构不动（0.55/0.45, 0.70/0.30, 0.30/0.25/0.25/0.12/0.08）
