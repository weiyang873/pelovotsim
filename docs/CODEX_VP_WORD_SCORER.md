# CODEX_VP_WORD_SCORER.md
## VP 词级直接匹配评分系统

### 概述

去掉概念空间中间层。直接用词对词的 embedding 匹配：
- 预计算：每个 anchor 文本 → jieba 分词 → 每个词 embed → 存一组向量
- 实时：VP 字段 → jieba 分词 → 每个词 embed → 跟 anchor 词向量逐个算 sim → 取最高 → 超过阈值的加总 → 除以 anchor 词数 × 5

没有概念层、没有 threshold scan、没有 MULTIPLIER。一个公式搞定。

---

### 前置：安装依赖

```bash
npm install nodejieba
```

---

### Section 1：新建 `server/llm/vpWordScorer.js`

这是全新文件，不修改任何现有 scorer。

#### 1a. 分词函数

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
  "同时", "并且", "还有", "不仅", "而且", "虽然", "然而"
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

#### 1b. 核心评分函数

```javascript
const { init, embed } = require("./embeddingService");

/**
 * 计算 VP 字段跟 anchor 的词级匹配分
 * @param {string} vpFieldText - VP 字段的原文（如 who_raw）
 * @param {object} anchorWordData - 预计算的 anchor 词向量 { words: string[], vecs: number[][] }
 * @param {number} minSim - sim 低于此值的不计入（默认 0.45）
 * @returns {object} { score, vpWords, matchDetails, simSum, anchorWordCount }
 */
async function wordMatchScore(vpFieldText, anchorWordData, minSim = 0.45) {
  const vpWords = tokenize(vpFieldText);
  const anchorWords = anchorWordData.words;
  const anchorVecs = anchorWordData.vecs;
  const anchorWordCount = anchorWords.length;

  if (vpWords.length === 0 || anchorWordCount === 0) {
    return {
      score: 0,
      vpWords,
      matchDetails: [],
      simSum: 0,
      anchorWordCount,
      qualifiedCount: 0
    };
  }

  let simSum = 0;
  let qualifiedCount = 0;
  const matchDetails = [];

  for (const vpWord of vpWords) {
    const vpVec = await embed(vpWord);

    let bestSim = -1;
    let bestAnchorWord = "";
    for (let j = 0; j < anchorVecs.length; j++) {
      const sim = cosine(vpVec, anchorVecs[j]);
      if (sim > bestSim) {
        bestSim = sim;
        bestAnchorWord = anchorWords[j];
      }
    }

    const qualified = bestSim >= minSim;
    if (qualified) {
      simSum += bestSim;
      qualifiedCount++;
    }

    matchDetails.push({
      vpWord,
      bestAnchorWord,
      bestSim: Math.round(bestSim * 100) / 100,
      qualified
    });
  }

  // 核心公式：合格词的 sim 加总 / anchor 词数 × 5，cap 在 0~5
  const rawScore = anchorWordCount > 0 ? (simSum / anchorWordCount) * 5 : 0;
  const score = Math.max(1.0, Math.min(5.0, Math.round(rawScore * 10) / 10));

  return {
    score,
    rawScore,
    vpWords,
    matchDetails,
    simSum: Math.round(simSum * 100) / 100,
    anchorWordCount,
    qualifiedCount,
    totalVpWords: vpWords.length
  };
}
```

#### 1c. Cosine 函数

```javascript
function cosine(a, b) {
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}
```

#### 1d. 主评分函数

```javascript
async function scoreVpByWord(vpText, gridId, architecture) {
  await init();
  const cache = loadCache();
  const { market: marketKey, strategy: strategyKey } = GRID_TO_PROFILE[gridId];
  const archKey = architecture;

  // Step 1: LLM 提取字段
  const fields = await extractVpFields(vpText);

  // Step 2: 各字段跟对应 anchor 做词级匹配
  
  // C 维度：who 跟市场全文匹配，pain 跟市场全文匹配
  const who_match = await wordMatchScore(
    fields.who_raw,
    cache.wordData[`market.${marketKey}.all`]
  );
  const pain_match = await wordMatchScore(
    fields.pain_raw,
    cache.wordData[`market.${marketKey}.all`]
  );
  const C = Math.max(1.0, Math.min(5.0,
    Math.round((0.55 * who_match.rawScore + 0.45 * pain_match.rawScore) * 10) / 10
  ));

  // G 维度：pain 跟逐条 pain_anchor 匹配（取 top2 weighted）+ 策略层匹配
  const painAnchors = cache.profiles.market[marketKey].pain_anchors;
  const painMatches = [];
  for (let i = 0; i < painAnchors.length; i++) {
    const pm = await wordMatchScore(
      fields.pain_raw,
      cache.wordData[`market.${marketKey}.pain_anchor_${i}`]
    );
    painMatches.push({
      text: painAnchors[i].text.slice(0, 30),
      rawScore: pm.rawScore,
      weight: painAnchors[i].weight,
      details: pm
    });
  }
  painMatches.sort((a, b) => (b.rawScore * b.weight) - (a.rawScore * a.weight));
  const top2 = painMatches.slice(0, 2);
  const G_pain_raw = (top2[0].rawScore * top2[0].weight + (top2[1]?.rawScore * top2[1]?.weight || 0))
                   / (top2[0].weight + (top2[1]?.weight || 0));

  const pain_strat = await wordMatchScore(
    fields.pain_raw,
    cache.wordData[`strategy.${strategyKey}.all`]
  );
  const G_raw = 0.70 * G_pain_raw + 0.30 * pain_strat.rawScore;
  const G = Math.max(1.0, Math.min(5.0, Math.round(G_raw * 10) / 10));

  // E 维度：how 跟三层匹配 + alt + boundary
  const how_market = await wordMatchScore(
    fields.how_raw,
    cache.wordData[`market.${marketKey}.all`]
  );
  const how_strat = await wordMatchScore(
    fields.how_raw,
    cache.wordData[`strategy.${strategyKey}.all`]
  );
  const how_arch = await wordMatchScore(
    fields.how_raw,
    cache.wordData[`architecture.${archKey}.all`]
  );

  let alt_match = { rawScore: 0, matchDetails: [] };
  if (fields.alternative_raw && fields.alternative_raw !== "未明确") {
    alt_match = await wordMatchScore(
      fields.alternative_raw,
      cache.wordData[`market.${marketKey}.all`]
    );
  }

  const boundary_score = scoreBoundary(fields.boundary_raw, marketKey);

  const E_raw = 0.30 * how_market.rawScore + 0.25 * how_strat.rawScore + 0.25 * how_arch.rawScore
              + 0.12 * alt_match.rawScore + 0.08 * (boundary_score * 5);
  const E = Math.max(1.0, Math.min(5.0, Math.round(E_raw * 10) / 10));

  return {
    scores: { C, G, E },
    fields,
    details: {
      marketKey, strategyKey, archKey,
      who: who_match,
      pain: pain_match,
      pain_top2: top2,
      pain_strategy: pain_strat,
      how_market,
      how_strategy: how_strat,
      how_arch,
      alt: alt_match,
      boundary_score
    }
  };
}
```

#### 1e. 辅助函数

`extractVpFields` 从 `vpConceptScorer.js` 复制过来（同样的 LLM 字段提取）。

`scoreBoundary` 同样复制过来（规则判定，不变）。

`GRID_TO_PROFILE` 同样复制过来。

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

#### 1f. 导出

```javascript
module.exports = {
  scoreVpByWord,
  tokenize,
  wordMatchScore,
  extractVpFields,
  scoreBoundary,
  loadCache
};
```

---

### Section 2：预计算脚本 `scripts/precompute_vp_words.js`

新建文件。对 11 个画像的每个小节做分词 + embed，生成词向量缓存。

```javascript
const fs = require("fs");
const path = require("path");
const { init, embed } = require("../server/llm/embeddingService");
const { tokenize } = require("../server/llm/vpWordScorer");

const profiles = require("../game_config_v0.1/vp_anchor_profiles.json");

async function embedWords(text) {
  const words = tokenize(text);
  const vecs = [];
  for (const w of words) {
    vecs.push(await embed(w));
  }
  return { words, vecs };
}

async function main() {
  await init();
  const wordData = {};

  // 市场层
  for (const [key, profile] of Object.entries(profiles.market)) {
    // 各小节单独
    wordData[`market.${key}.customer_group`] = await embedWords(profile.customer_group);

    for (let i = 0; i < profile.pain_anchors.length; i++) {
      wordData[`market.${key}.pain_anchor_${i}`] = await embedWords(profile.pain_anchors[i].text);
    }

    wordData[`market.${key}.alternatives`] = await embedWords(profile.alternatives);
    wordData[`market.${key}.solution_expectations`] = await embedWords(profile.solution_expectations);

    // 市场全文合并（customer_group + 所有pain_anchors + alternatives + solution_expectations）
    const allText = [
      profile.customer_group,
      ...profile.pain_anchors.map(p => p.text),
      profile.alternatives,
      profile.solution_expectations
    ].join("。");
    wordData[`market.${key}.all`] = await embedWords(allText);
  }

  // 策略层
  for (const [key, profile] of Object.entries(profiles.strategy)) {
    const allText = [
      profile.customer_traits,
      profile.value_perception,
      profile.solution_expectations
    ].join("。");
    wordData[`strategy.${key}.all`] = await embedWords(allText);

    // 各小节单独（备用）
    for (const field of ["customer_traits", "value_perception", "solution_expectations"]) {
      wordData[`strategy.${key}.${field}`] = await embedWords(profile[field]);
    }
  }

  // 架构层
  for (const [key, profile] of Object.entries(profiles.architecture)) {
    const allText = [
      profile.customer_traits,
      profile.value_perception,
      profile.solution_expectations
    ].join("。");
    wordData[`architecture.${key}.all`] = await embedWords(allText);

    for (const field of ["customer_traits", "value_perception", "solution_expectations"]) {
      wordData[`architecture.${key}.${field}`] = await embedWords(profile[field]);
    }
  }

  // 统计
  let totalWords = 0;
  for (const v of Object.values(wordData)) {
    totalWords += v.words.length;
  }

  // 保存
  const output = {
    profiles,  // 原始 profile 也存进去，方便 scorer 读取
    wordData   // { key: { words: string[], vecs: number[][] } }
  };
  const outPath = path.join(__dirname, "../game_config_v0.1/vp_word_cache.json");
  fs.writeFileSync(outPath, JSON.stringify(output));
  console.log(`Precomputed ${Object.keys(wordData).length} word sets, ${totalWords} total word embeddings.`);
  console.log(`Saved: ${outPath}`);
}

main().catch(err => { console.error(err); process.exit(1); });
```

---

### Section 3：vpWordScorer.js 的 loadCache

```javascript
let _cache = null;
function loadCache() {
  if (_cache) return _cache;
  _cache = JSON.parse(fs.readFileSync(
    path.join(__dirname, "../../game_config_v0.1/vp_word_cache.json"), "utf8"
  ));
  return _cache;
}
```

---

### Section 4：测试脚本 `scripts/test_vp_word_scorer.js`

新建文件。

#### 4a. 6 条校准样本（同之前）

```javascript
const CALIBRATION = [
  { grid: "ToB_Cost_Elder", arch: "Hybrid",
    vp: "养老院用。老人孤单，员工忙。机器人陪聊。",
    expected: "差" },
  { grid: "ToC_Diff_Adult", arch: "Experience",
    vp: "年轻人买，好玩。",
    expected: "差" },
  { grid: "ToB_Cost_Elder", arch: "Hybrid",
    vp: "为护工短缺的养老院，提供能陪聊的机器人，让员工能去忙别的事，比请人便宜。失智老人不行。",
    expected: "中" },
  { grid: "ToC_Diff_Adult", arch: "Experience",
    vp: "为独居白领，下班回家冷清，提供能主动蹭腿的陪伴机器人，比智能音箱有温度。长期出差不适用。",
    expected: "中" },
  { grid: "ToB_Cost_Elder", arch: "Hybrid",
    vp: "为面临护工成本上涨和夜间跌倒高风险的养老机构，提供具备离床监测功能的机器人，通过替代部分人工巡检来优化人力配置并实现风险主动预防——传统依赖人力巡检难以实时响应且成本刚性上涨。失智老人特殊照护单元需结合个性化护理。",
    expected: "好" },
  { grid: "ToC_Diff_Adult", arch: "Experience",
    vp: "为25-35岁一线城市独居、每天加班到9点回家只有冰箱声的单身白领，提供一台回家时主动蹭腿发出声音的陪伴机器人，获得不需要维护关系的即时情感连接——智能音箱只能被动问候，养猫狗要喂要遛出差要寄养。长期出差超两周效果打折。",
    expected: "好" }
];
```

#### 4b. 输出格式

每条样本打印：

```
[差] grid=ToB_Cost_Elder arch=Hybrid
  VP: "养老院用。老人孤单，员工忙。机器人陪聊。"
  C=1.2  G=1.0  E=1.0
  who: 6 words → 2 qualified (minSim=0.45)
    "养老院" → "养老院"(0.95) ✓
    "老人"   → "老年人"(0.88) ✓
    "孤单"   → "老年人"(0.42) ✗
    "员工"   → "运营"(0.45) ✓
    "机器人" → "服务"(0.35) ✗
    "陪聊"   → "照料"(0.40) ✗
    simSum=2.28  anchorWords=15  rawScore=0.76
```

#### 4c. 分档判断 + minSim scan

```javascript
// 分档
console.log(`Bucket averages: 差=${bad} 中=${mid} 好=${good}`);
console.log(`Three-tier separated: ${bad < mid && mid < good ? "YES" : "NO"}`);

// minSim scan: 从 0.3 到 0.7 步长 0.05
const minSims = [0.30, 0.35, 0.40, 0.45, 0.50, 0.55, 0.60, 0.65, 0.70];
console.log("\n====== minSim Scan ======");
console.log("minSim | 差avg | 中avg | 好avg | separated?");
for (const ms of minSims) {
  // 对 6 条样本用不同 minSim 重算
  // 不需要重新 embed，只需要在已有的 matchDetails 上重新过滤
}
```

#### 4d. 确定性验证

```javascript
// 跑第一条样本两次，确认分数完全一样
const r1 = await scoreVpByWord(CALIBRATION[0].vp, CALIBRATION[0].grid, CALIBRATION[0].arch);
const r2 = await scoreVpByWord(CALIBRATION[0].vp, CALIBRATION[0].grid, CALIBRATION[0].arch);
console.log(`Deterministic: C ${r1.scores.C === r2.scores.C} G ${r1.scores.G === r2.scores.G} E ${r1.scores.E === r2.scores.E}`);
```

---

### Section 5：运行顺序

```bash
npm install nodejieba  # 如果还没装
source .env
node scripts/precompute_vp_words.js
node scripts/test_vp_word_scorer.js
```

---

### 验收标准

1. precompute 跑通，打印 word set 数量和 total word embeddings
2. 6 条校准样本跑通
3. 每条能看到每个 VP 词跟哪个 anchor 词匹配、sim 多少、是否 qualified
4. 差 < 中 < 好（三档分开）
5. 同一条 VP 跑两次分数完全一样
6. minSim scan 有输出

---

### 不要改的东西

- `vpScorer.js` 不动
- `vpConceptScorer.js` 不动
- `vpEmbeddingScorer.js` 不动
- `vpCoach.js` 不动
- `embeddingService.js` 不动（只复用 init/embed）
- `vp_anchor_profiles.json` 不动
- 所有现有测试脚本不动
