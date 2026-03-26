# CODEX_VP_SQUARED_COSINE_SCORER.md
## VP 概念空间评分 — 平方余弦

### 概述

替换 vpConceptScorer.js 的评分核心函数。用平方 cosine 加总替代所有之前的 directionAndDepth / coActivation / adjustedSim 逻辑。

一个函数搞定方向和深度。平方天然压低底噪、放大信号。不需要 threshold、topK、maxHits 任何校准参数。

---

### 改动 1：vpConceptScorer.js — 新增 `conceptScore` 函数

删除 `directionAndDepth`、`fingerprintSpecificity`、`adjustedSim`（如果还存在的话）。替换为：

```javascript
/**
 * 平方余弦概念匹配分
 * VP 指纹和 anchor 指纹逐位平方相乘再求和，除以 anchor 自身的四次方和，开根号
 * 平方压低底噪（0.3→0.09），放大信号（0.5→0.25），天然拉开差距
 */
function conceptScore(vpFp, anchorFp) {
  let dot = 0;
  let norm = 0;
  for (let i = 0; i < vpFp.length; i++) {
    dot += (vpFp[i] ** 2) * (anchorFp[i] ** 2);
    norm += anchorFp[i] ** 4;
  }
  return norm > 0 ? Math.sqrt(dot / norm) : 0;
}
```

---

### 改动 2：重写 C/G/E 计算

所有之前用 `directionAndDepth` / `adjustedSim` / `fingerprintSim` 的地方，全部替换为 `conceptScore`。

#### C 维度

```javascript
const sim_who = conceptScore(who_fp, cache.fingerprints[`market.${marketKey}.customer_group`]);
const sim_pain_se = conceptScore(pain_fp, cache.fingerprints[`market.${marketKey}.solution_expectations`]);

const C_raw = 0.55 * sim_who + 0.45 * sim_pain_se;
```

#### G 维度

```javascript
const painAnchors = profiles.market[marketKey].pain_anchors;
const painMatches = painAnchors.map((anchor, i) => ({
  text: anchor.text,
  sim: conceptScore(pain_fp, cache.fingerprints[`market.${marketKey}.pain_anchor_${i}`]),
  weight: anchor.weight
}));

painMatches.sort((a, b) => (b.sim * b.weight) - (a.sim * a.weight));
const top2 = painMatches.slice(0, 2);
const G_pain = (top2[0].sim * top2[0].weight + (top2[1]?.sim * top2[1]?.weight || 0))
             / (top2[0].weight + (top2[1]?.weight || 0));

const pain_strat_sim = conceptScore(pain_fp, cache.fingerprints[`strategy.${strategyKey}.customer_traits`]);

const G_raw = 0.70 * G_pain + 0.30 * pain_strat_sim;
```

#### E 维度

```javascript
const how_market_sim = conceptScore(how_fp, cache.fingerprints[`market.${marketKey}.solution_expectations`]);
const how_strat_sim = conceptScore(how_fp, cache.fingerprints[`strategy.${strategyKey}.solution_expectations`]);
const how_arch_sim = conceptScore(how_fp, cache.fingerprints[`architecture.${archKey}.solution_expectations`]);

let alt_sim = 0;
if (alt_fp) {
  alt_sim = conceptScore(alt_fp, cache.fingerprints[`market.${marketKey}.alternatives`]);
}

const boundary_score = scoreBoundary(fields.boundary_raw, marketKey);

const E_raw = 0.30 * how_market_sim + 0.25 * how_strat_sim + 0.25 * how_arch_sim
            + 0.12 * alt_sim + 0.08 * boundary_score;
```

---

### 改动 3：rawToScore 映射

```javascript
function rawToScore(raw) {
  const score = 1.0 + raw * 4.0;
  return Math.max(1.0, Math.min(5.0, Math.round(score * 10) / 10));
}
```

跟之前一样。如果校准发现 raw 分布不在 0~1，再调。

---

### 改动 4：details 输出

```javascript
details: {
  marketKey, strategyKey, archKey,
  who_sim,
  pain_se_sim: sim_pain_se,
  pain_top2: top2.map(t => ({
    text: t.text.slice(0, 30),
    sim: t.sim,
    weight: t.weight
  })),
  pain_strategy_sim: pain_strat_sim,
  how_market_sim,
  how_strategy_sim: how_strat_sim,
  how_arch_sim,
  alt_sim,
  boundary_score,
  C_raw, G_raw, E_raw
}
```

---

### 改动 5：测试脚本

修改 `scripts/test_vp_concept_scorer.js`：

#### 5a. 删除 threshold scan 和 maxHits scan（不再需要）

#### 5b. 保留 6 条校准样本，输出格式改为：

```
[差] grid=ToB_Cost_Elder arch=Hybrid
  VP: "养老院用。老人孤单，员工忙。机器人陪聊。"
  C=1.6  G=1.2  E=1.4  (C_raw=0.15  G_raw=0.05  E_raw=0.10)
  who_sim=0.18  pain_se=0.12
  pain_top2: sim=0.08 w=1.0, sim=0.06 w=0.9
  pain_strat=0.05
  how: market=0.12 strategy=0.09 arch=0.11
  alt=0.00 boundary=0.00
```

#### 5c. 分档判断

```javascript
const bad_avg = (bad1_C + bad1_G + bad1_E + bad2_C + bad2_G + bad2_E) / 6;
const mid_avg = (mid1_C + mid1_G + mid1_E + mid2_C + mid2_G + mid2_E) / 6;
const good_avg = (good1_C + good1_G + good1_E + good2_C + good2_G + good2_E) / 6;

console.log(`Bucket averages: 差=${bad_avg.toFixed(2)}  中=${mid_avg.toFixed(2)}  好=${good_avg.toFixed(2)}`);
console.log(`Three-tier separated: ${bad_avg < mid_avg && mid_avg < good_avg ? "YES" : "NO"}`);
```

#### 5d. 新增：raw 值分布诊断

在 6 条样本跑完后，打印所有 raw 值的 min/max/mean，帮助判断映射函数是否需要调整：

```javascript
const allRaws = results.flatMap(r => [r.C_raw, r.G_raw, r.E_raw]);
console.log(`\nRaw distribution: min=${Math.min(...allRaws).toFixed(3)} max=${Math.max(...allRaws).toFixed(3)} mean=${(allRaws.reduce((a,b)=>a+b,0)/allRaws.length).toFixed(3)}`);
```

---

### 不要改的东西

- 概念列表 `vp_scoring_concepts.json` 不动
- 预计算 `vp_concept_cache.json` 不需要重新生成
- `precompute_vp_concepts.js` 不动
- `extractVpFields` 不动
- `computeFingerprint` 不动
- `cosine` 函数不动（`conceptScore` 是新函数，不替换 `cosine`）
- `scoreBoundary` 不动
- `vpScorer.js` / `vpEmbeddingScorer.js` 不动

---

### 运行方式

```bash
source .env
node scripts/test_vp_concept_scorer.js
```

不需要重新 precompute。
