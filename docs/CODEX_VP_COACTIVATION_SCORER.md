# CODEX_VP_COACTIVATION_SCORER.md
## VP 概念空间评分 — 方向×深度（共激活）

### 概述

替换 vpConceptScorer.js 的评分逻辑。方向分和深度分都在同一个概念空间里算：
- **方向分**：VP 指纹跟 anchor 指纹的 cosine sim（方向对不对）
- **深度分**：VP 和 anchor 在概念空间里共同强激活了多少个概念（说了多少有效内容）
- **最终分**：方向 × 深度

整个链路除字段提取（1 次 LLM 调用）外全是确定性计算。

---

### 改动 1：vpConceptScorer.js — 新增 `directionAndDepth` 函数

替换现有的 `adjustedSim` 和 `fingerprintSpecificity`。

```javascript
/**
 * 计算 VP 字段指纹和 anchor 指纹之间的方向分和深度分
 * @param {number[]} vpFp - VP 字段的概念空间指纹（39 维）
 * @param {number[]} anchorFp - anchor 的概念空间指纹（39 维）
 * @param {number} threshold - 强激活阈值
 * @param {number} maxHits - 期望最大共激活概念数（归一化用）
 * @returns {{ direction: number, depth: number, coActivated: number, score: number }}
 */
function directionAndDepth(vpFp, anchorFp, threshold = 0.7, maxHits = 8) {
  // 方向：两个指纹的 cosine
  const direction = cosine(vpFp, anchorFp);

  // 深度：有多少个概念在 VP 和 anchor 里同时超过 threshold
  let coActivated = 0;
  for (let i = 0; i < vpFp.length; i++) {
    if (vpFp[i] > threshold && anchorFp[i] > threshold) {
      coActivated++;
    }
  }
  const depth = Math.min(1.0, coActivated / maxHits);

  return {
    direction,
    depth,
    coActivated,
    score: direction * depth
  };
}
```

---

### 改动 2：vpConceptScorer.js — 重写 C/G/E 计算

删除所有 `adjustedSim` / `fingerprintSpecificity` 调用，改用 `directionAndDepth`。

#### C 维度

```javascript
const who_dd = directionAndDepth(who_fp, cache.fingerprints[`market.${marketKey}.customer_group`]);
const pain_se_dd = directionAndDepth(pain_fp, cache.fingerprints[`market.${marketKey}.solution_expectations`]);

const C_raw = 0.55 * who_dd.score + 0.45 * pain_se_dd.score;
```

#### G 维度（weighted atomic pain match，用 directionAndDepth）

```javascript
const painAnchors = profiles.market[marketKey].pain_anchors;
const painMatches = painAnchors.map((anchor, i) => {
  const dd = directionAndDepth(pain_fp, cache.fingerprints[`market.${marketKey}.pain_anchor_${i}`]);
  return {
    text: anchor.text,
    direction: dd.direction,
    depth: dd.depth,
    coActivated: dd.coActivated,
    score: dd.score,
    weight: anchor.weight
  };
});

painMatches.sort((a, b) => (b.score * b.weight) - (a.score * a.weight));
const top2 = painMatches.slice(0, 2);
const G_pain = (top2[0].score * top2[0].weight + (top2[1]?.score * top2[1]?.weight || 0))
             / (top2[0].weight + (top2[1]?.weight || 0));

const pain_strat_dd = directionAndDepth(pain_fp, cache.fingerprints[`strategy.${strategyKey}.customer_traits`]);

const G_raw = 0.70 * G_pain + 0.30 * pain_strat_dd.score;
```

#### E 维度

```javascript
const how_market_dd = directionAndDepth(how_fp, cache.fingerprints[`market.${marketKey}.solution_expectations`]);
const how_strat_dd = directionAndDepth(how_fp, cache.fingerprints[`strategy.${strategyKey}.solution_expectations`]);
const how_arch_dd = directionAndDepth(how_fp, cache.fingerprints[`architecture.${archKey}.solution_expectations`]);

let alt_score = 0;
let alt_dd = null;
if (alt_fp) {
  alt_dd = directionAndDepth(alt_fp, cache.fingerprints[`market.${marketKey}.alternatives`]);
  alt_score = alt_dd.score;
}

const boundary_score = scoreBoundary(fields.boundary_raw, marketKey);

const E_raw = 0.30 * how_market_dd.score + 0.25 * how_strat_dd.score + 0.25 * how_arch_dd.score
            + 0.12 * alt_score + 0.08 * boundary_score;
```

---

### 改动 3：rawToScore 简化

```javascript
function rawToScore(raw) {
  // raw 是 direction × depth 的加权和，范围 0~1
  // 线性映射到 1.0~5.0
  const score = 1.0 + raw * 4.0;
  return Math.max(1.0, Math.min(5.0, Math.round(score * 10) / 10));
}
```

---

### 改动 4：details 输出扩展

在 `scoreVpByConcept` 的返回值 `details` 中，每个匹配项都输出 direction、depth、coActivated：

```javascript
details: {
  marketKey, strategyKey, archKey,
  who: { direction: who_dd.direction, depth: who_dd.depth, coActivated: who_dd.coActivated, score: who_dd.score },
  pain_se: { direction: pain_se_dd.direction, depth: pain_se_dd.depth, coActivated: pain_se_dd.coActivated, score: pain_se_dd.score },
  pain_top2: top2.map(t => ({
    text: t.text.slice(0, 30),
    direction: t.direction,
    depth: t.depth,
    coActivated: t.coActivated,
    score: t.score,
    weight: t.weight
  })),
  pain_strategy: { direction: pain_strat_dd.direction, depth: pain_strat_dd.depth, coActivated: pain_strat_dd.coActivated, score: pain_strat_dd.score },
  how_market: { direction: how_market_dd.direction, depth: how_market_dd.depth, coActivated: how_market_dd.coActivated, score: how_market_dd.score },
  how_strategy: { direction: how_strat_dd.direction, depth: how_strat_dd.depth, coActivated: how_strat_dd.coActivated, score: how_strat_dd.score },
  how_arch: { direction: how_arch_dd.direction, depth: how_arch_dd.depth, coActivated: how_arch_dd.coActivated, score: how_arch_dd.score },
  alt: alt_dd ? { direction: alt_dd.direction, depth: alt_dd.depth, coActivated: alt_dd.coActivated, score: alt_dd.score } : null,
  boundary_score,
  C_raw, G_raw, E_raw
}
```

---

### 改动 5：测试脚本 — 校准 + 诊断

修改 `scripts/test_vp_concept_scorer.js`：

#### 5a. 保留现有 6 条校准样本不变

#### 5b. 对每条校准样本，输出格式改为：

```
[差] grid=ToB_Cost_Elder arch=Hybrid
  VP: "养老院用。老人孤单，员工忙。机器人陪聊。"
  C=2.2  G=1.0  E=1.5  (C_raw=0.24  G_raw=0.00  E_raw=0.13)
  who:  dir=0.95  depth=0.25  coAct=2/39  score=0.24
  pain: dir=0.82  depth=0.00  coAct=0/39  score=0.00
  how:  dir=0.65  depth=0.13  coAct=1/39  score=0.08
  alt:  (未提供)
  boundary: 0.00
```

#### 5c. 在 6 条校准样本之后，加一段 threshold 扫描

用第一条差样本和第一条好样本（都是 ToB_Cost_Elder），对 threshold 从 0.5 到 0.9 每 0.05 扫一遍，打印 coActivated 数量，帮助确定最佳 threshold：

```javascript
const thresholds = [0.50, 0.55, 0.60, 0.65, 0.70, 0.75, 0.80, 0.85, 0.90];

console.log("\n====== Threshold Scan ======");
console.log("threshold | 差-who | 差-pain | 差-how | 好-who | 好-pain | 好-how");

for (const t of thresholds) {
  // 对差样本和好样本分别算各字段的 coActivated
  const bad_who = directionAndDepth(badSample.who_fp, anchor_who_fp, t);
  const bad_pain = directionAndDepth(badSample.pain_fp, anchor_pain_fp, t);
  const bad_how = directionAndDepth(badSample.how_fp, anchor_how_fp, t);
  const good_who = directionAndDepth(goodSample.who_fp, anchor_who_fp, t);
  const good_pain = directionAndDepth(goodSample.pain_fp, anchor_pain_fp, t);
  const good_how = directionAndDepth(goodSample.how_fp, anchor_how_fp, t);

  console.log(`   ${t.toFixed(2)}   |   ${bad_who.coActivated}   |   ${bad_pain.coActivated}   |   ${bad_how.coActivated}   |   ${good_who.coActivated}   |   ${good_pain.coActivated}   |   ${good_how.coActivated}`);
}
```

#### 5d. 同样对 maxHits 从 4 到 12 扫一遍，用 threshold=0.7 固定：

```javascript
const maxHitsRange = [4, 5, 6, 7, 8, 9, 10, 11, 12];

console.log("\n====== maxHits Scan (threshold=0.7) ======");
console.log("maxHits | 差-C | 差-G | 差-E | 中-C | 中-G | 中-E | 好-C | 好-G | 好-E");

for (const mh of maxHitsRange) {
  // 对差/中/好第一条各跑一遍，用 threshold=0.7 和当前 maxHits
  // 打印最终 C/G/E 分数
}
```

这样我能直接看到哪个 threshold × maxHits 组合让三档分开最清晰。

---

### 不要改的东西

- 概念列表 `vp_scoring_concepts.json` 不动
- 预计算脚本 `precompute_vp_concepts.js` 不动
- `vp_concept_cache.json` 不需要重新生成（指纹没变，只是比较方式变了）
- `extractVpFields` 不动
- `computeFingerprint` 不动
- `scoreBoundary` 不动
- `cosine` 函数不动

---

### 运行方式

```bash
source .env
node scripts/test_vp_concept_scorer.js
```

不需要重新 precompute，cache 已有。

---

### 验收标准

1. 6 条校准样本跑通
2. 差档平均 < 中档平均 < 好档平均（三档分开）
3. threshold scan 和 maxHits scan 有输出，能看到最佳参数
4. 同一条 VP 跑两次分数完全一样
