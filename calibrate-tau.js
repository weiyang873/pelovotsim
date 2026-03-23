// calibrate-tau.js - 自动校准 tau 和 cap 值
// 运行方式：node calibrate-tau.js

const fs = require("fs");
const path = require("path");

const ANCHOR_PATH = path.join(__dirname, "data", "round2_dim_anchors_v1.json");
const SCORE_CACHE_PATH = path.join(__dirname, "data", "score_cache.json");

// 直接 require embeddingService（不走 HTTP，直接调用）
const embeddingService = require("./server/llm/embeddingService");

// ============ 测试标签组（模拟不同访谈结果）============

const TEST_CASES = [
  {
    label: "老人-情感陪伴为主",
    tags: [
      { tag: "情感陪伴", polarity: "positive" },
      { tag: "日常聊天", polarity: "positive" },
      { tag: "语音对话", polarity: "positive" },
      { tag: "紧急通知", polarity: "positive" },
      { tag: "简单操作", polarity: "positive" },
      { tag: "健康监测", polarity: "negative" },
      { tag: "智能家居", polarity: "negative" },
      { tag: "手机连接", polarity: "negative" }
    ]
  },
  {
    label: "年轻父母-安全监护为主",
    tags: [
      { tag: "儿童安全", polarity: "positive" },
      { tag: "跌倒检测", polarity: "positive" },
      { tag: "紧急报警", polarity: "positive" },
      { tag: "远程监控", polarity: "positive" },
      { tag: "家长控制", polarity: "positive" },
      { tag: "情感陪伴", polarity: "negative" },
      { tag: "自主移动", polarity: "negative" },
      { tag: "娱乐互动", polarity: "negative" }
    ]
  },
  {
    label: "科技爱好者-扩展连接为主",
    tags: [
      { tag: "智能家居", polarity: "positive" },
      { tag: "App控制", polarity: "positive" },
      { tag: "远程操控", polarity: "positive" },
      { tag: "开放接口", polarity: "positive" },
      { tag: "OTA升级", polarity: "positive" },
      { tag: "情感陪伴", polarity: "negative" },
      { tag: "简单操作", polarity: "negative" },
      { tag: "娱乐功能", polarity: "negative" }
    ]
  }
];

// ============ 核心校准逻辑 ============

/**
 * 用给定 tau/cap 计算所有测试用例的分数
 */
async function computeScores(tau, cap) {
  const anchorConfig = JSON.parse(fs.readFileSync(ANCHOR_PATH, "utf8"));
  const dims = anchorConfig.dimensions;

  const results = [];

  for (const tc of TEST_CASES) {
    const tagVecs = await Promise.all(tc.tags.map((t) => embeddingService.embed(t.tag)));
    const raw = {};

    for (const dim of dims) {
      raw[dim.key] = 0;
      for (let i = 0; i < tc.tags.length; i++) {
        const s = embeddingService.maxCosineToDimension(tagVecs[i], dim.key);
        const g = Math.max(0, s - tau);
        raw[dim.key] += tc.tags[i].polarity === "positive" ? g : -g;
      }
    }

    const rawValues = Object.values(raw);
    const minRaw = Math.min(...rawValues);
    const maxRaw = Math.max(...rawValues);
    const scores = {};

    if (!Number.isFinite(minRaw) || !Number.isFinite(maxRaw) || maxRaw === minRaw) {
      for (const dim of dims) {
        scores[dim.key] = 1;
      }
    } else {
      for (const dim of dims) {
        const normalized = (raw[dim.key] - minRaw) / (maxRaw - minRaw);
        scores[dim.key] = Math.round(1 + normalized * 9);
      }
    }

    results.push({ label: tc.label, scores, raw });
  }

  return results;
}

/**
 * 评估一组 tau/cap 的质量
 * 返回分数：18个分数（3用例*6维度）的总方差，越大越好
 * 硬约束：全部18个分数必须都在 [4, 10]，否则该组合无效
 */
function evaluate(results) {
  const allScores = [];
  for (const r of results) {
    for (const v of Object.values(r.scores)) {
      allScores.push(Number(v || 0));
    }
  }

  if (!allScores.length) return -Infinity;
  if (allScores.some((x) => x < 4 || x > 10)) return -Infinity;
  const mean = allScores.reduce((a, b) => a + b, 0) / allScores.length;
  const variance =
    allScores.reduce((sum, x) => sum + (x - mean) * (x - mean), 0) / allScores.length;
  return variance;
}

// ============ 主函数 ============

async function main() {
  console.log("初始化 EmbeddingService...");
  await embeddingService.init();
  console.log("初始化完成\n");

  // 清空分数缓存避免干扰
  if (fs.existsSync(SCORE_CACHE_PATH)) {
    fs.writeFileSync(SCORE_CACHE_PATH, "{}", "utf8");
  }

  // 网格搜索 tau 和 cap
  // tau: 0.05~0.70，步长0.01（66个）
  // cap: 0.3~1.5，步长0.1（13个）
  const fixedTau = process.env.FIXED_TAU != null ? Number(process.env.FIXED_TAU) : null;
  const fixedCap = process.env.FIXED_CAP != null ? Number(process.env.FIXED_CAP) : null;
  const tauValues =
    fixedTau != null
      ? [Number(fixedTau.toFixed(2))]
      : Array.from({ length: 66 }, (_, i) => Number((0.05 + i * 0.01).toFixed(2)));
  const capValues =
    fixedCap != null
      ? [Number(fixedCap.toFixed(1))]
      : Array.from({ length: 13 }, (_, i) => Number((0.3 + i * 0.1).toFixed(1)));

  let bestScore = -Infinity;
  let bestTau = 0;
  let bestCap = 0;
  let bestResults = null;

  console.log("开始网格搜索 tau × cap...\n");

  for (const tau of tauValues) {
    for (const cap of capValues) {
      const results = await computeScores(tau, cap);
      const score = evaluate(results);
      const dist = results.flatMap((r) => Object.values(r.scores).map((v) => Number(v || 0)));
      const mean = dist.reduce((a, b) => a + b, 0) / dist.length;
      console.log(
        `[combo] tau=${tau.toFixed(2)} cap=${cap.toFixed(1)} mean=${mean.toFixed(4)} variance=${
          Number.isFinite(score) ? score.toFixed(4) : "NA"
        } scores=[${dist.join(",")}]`
      );

      if (Number.isFinite(score) && score > bestScore) {
        bestScore = score;
        bestTau = tau;
        bestCap = cap;
        bestResults = results;
      }
    }
    process.stdout.write(`tau=${tau} 完成\n`);
  }

  if (!bestResults && tauValues.length && capValues.length) {
    bestTau = tauValues[0];
    bestCap = capValues[0];
    bestResults = await computeScores(bestTau, bestCap);
    console.log("\n[warn] 未找到满足约束的参数组合，回退展示首个参数组合结果。");
  }

  // 打印最优结果
  console.log("\n" + "=".repeat(50));
  console.log(`最优参数：tau=${bestTau}, cap=${bestCap}, variance=${bestScore.toFixed(4)}`);
  console.log("=".repeat(50));

  console.log("\n各测试用例分数分布：");
  for (const result of bestResults) {
    console.log(`\n  [${result.label}]`);
    Object.entries(result.scores).forEach(([key, val]) => {
      const filled = Math.min(10, Math.max(0, Number(val || 0)));
      const bar = "★".repeat(filled) + "☆".repeat(10 - filled);
      console.log(`    ${key.padEnd(15)} ${bar} (${val}/10)`);
    });
  }

  // 打印前5名参数组合
  console.log("\n\n建议：把以下参数更新到 round2_dim_anchors_v1.json：");
  console.log(`  "tau": ${bestTau}`);
  console.log(`  "cap": ${bestCap}`);

  // 自动写入 anchor 文件
  const anchorConfig = JSON.parse(fs.readFileSync(ANCHOR_PATH, "utf8"));
  const oldTau = anchorConfig.tau;
  const oldCap = anchorConfig.cap;

  anchorConfig.tau = bestTau;
  anchorConfig.cap = bestCap;
  anchorConfig.anchor_version = `anchors_v1_calibrated_${Date.now()}`;

  fs.writeFileSync(ANCHOR_PATH, JSON.stringify(anchorConfig, null, 2), "utf8");
  console.log("\n✓ 已自动更新 round2_dim_anchors_v1.json");
  console.log(`  tau: ${oldTau} → ${bestTau}`);
  console.log(`  cap: ${oldCap} → ${bestCap}`);
  console.log("  anchor_version 已更新（旧缓存自动失效）");
}

main().catch(console.error);
