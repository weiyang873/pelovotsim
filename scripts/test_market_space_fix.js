#!/usr/bin/env node
/**
 * test_market_space_fix.js
 * 
 * 独立测试：不需要启动服务器，不需要数据库。
 * 直接加载 market_space_params.json (旧/新) + 模拟 computeMarketSpaceTier
 * 
 * 用法：
 *   node test_market_space_fix.js
 * 
 * 前置：把新旧两个文件都放在同目录下
 *   - market_space_params.json        (旧版)
 *   - market_space_params_v2.json     (新版)
 * 或者修改下面的路径
 */

const fs = require("fs");
const path = require("path");

// ============ 从 teamRoutes.js 提取的纯函数 (原样) ============

function normalizedElasticityTier(e) {
  if (e < 1) return "High";   // 注意：低弹性 = "High" tier (不敏感→利基)
  if (e <= 1.4) return "Med";
  return "Low";                // 高弹性 = "Low" tier (敏感→大众)
}

function normalizedCrowdingTier(c) {
  const raw = String(c || "").toUpperCase();
  if (raw.startsWith("LOW")) return "Low";
  if (raw.startsWith("MED")) return "Med";
  return "High";
}

function normalizedReachTier(reachRate) {
  const r = Number(reachRate || 0.6);
  if (r < 0.4) return "Low";
  if (r < 0.7) return "Med";
  return "High";
}

function computeMarketSpaceTier(params, { gridId, crowding, tamMultiplier, reachRate }) {
  reachRate = reachRate ?? 0.6;
  const baseSize = Number(params.base_size?.[gridId] || 1);
  const eTier = normalizedElasticityTier(Number(params.elasticity_hint?.[gridId] || 1.2));
  const crowdingTier = normalizedCrowdingTier(crowding);
  const reachTier = normalizedReachTier(reachRate);

  const g = Number(params.g_e_tier?.[eTier] || 1);
  const h = Number(params.h_crowding?.[crowdingTier] || 1);
  const m = Number(params.m_reach?.[reachTier] || 1);
  const score = baseSize * g * h * m * Number(tamMultiplier || 1);

  let tier = "M";
  if (score < Number(params.thresholds?.S_to_M || 0.95)) tier = "S";
  if (score >= Number(params.thresholds?.M_to_L || 1.15)) tier = "L";

  const difficultyTier = crowdingTier === "High" ? "高" : (crowdingTier === "Med" ? "中" : "低");
  return {
    tier,
    difficulty_tier: difficultyTier,
    score,
    factors: { baseSize, g, h, m, eTier, crowdingTier, reachTier }
  };
}

// ============ 从 engine.js 提取的 GM 计算 (简化版) ============

function computeGmMax({ WTP, e, crowding, archTag, customerType, strategy, ageGroup }) {
  // 默认参数 (和 engine.js defaultRound1Params 一致)
  const A_min = 0.2, sigmoid_a = 5.0, beta_arch = 0.2, GM_cap = 0.65;
  const fee_direct = 0.10, fee_ecom = 0.16;
  const COGS_base = customerType === "ToC" ? 2200 : 3500;
  const m_age = { ELDER: 1.1, ADULT: 1.0, CHILD: 0.95 };
  const m_arch = { Experience: 1.05, Hybrid: 1.0, Function: 0.95 };

  // Fit_arch lookup
  const Fit_age = {
    Experience: { ELDER: 0.9, ADULT: 0.8, CHILD: 0.7 },
    Hybrid:     { ELDER: 0.8, ADULT: 0.8, CHILD: 0.8 },
    Function:   { ELDER: 0.75, ADULT: 0.8, CHILD: 0.85 }
  };
  const Fit_str = {
    Experience: { DIFF: 0.9, COST: 0.6 },
    Hybrid:     { DIFF: 0.8, COST: 0.75 },
    Function:   { DIFF: 0.7, COST: 0.9 }
  };
  const Fit_cust = {
    Experience: { ToC: 0.9, ToB: 0.7 },
    Hybrid:     { ToC: 0.8, ToB: 0.8 },
    Function:   { ToC: 0.7, ToB: 0.9 }
  };

  // Channel: assume Direct 60% + Ecom 40% (typical)
  const f = 0.6 * fee_direct + 0.4 * fee_ecom;

  // Fit_arch
  const fit = 0.45 * (Fit_age[archTag]?.[ageGroup] || 0.8)
            + 0.35 * (Fit_str[archTag]?.[strategy] || 0.8)
            + 0.20 * (Fit_cust[archTag]?.[customerType] || 0.8);

  // P_max
  const s = Math.pow(A_min, 1 / e);
  const r_max = 1 + (1 / sigmoid_a) * Math.log((1 - s) / s);
  const P_max_base = r_max * WTP;
  const P_max = P_max_base * (1 + beta_arch * (fit - 0.5));

  // COGS
  const COGS = COGS_base * (m_age[ageGroup] || 1) * (m_arch[archTag] || 1);

  // GM
  const GM_raw = 1 - f - COGS / P_max;
  const GM_max = Math.min(GM_cap, GM_raw);

  return { GM_max, P_max, COGS, f, fit };
}

// ============ 12 格测试数据 ============

// 注意：grid_priors 的 key = B2B/B2C × Differentiation/Cost × Elder/Adult/Child
// 这也是 final_grid_id 的格式
const GRIDS = [
  // gridId (= final_grid_id format), WTP, e, crowding, archTag, customerType, strategy, ageGroup
  { gridId: "B2B_Differentiation_Elder", WTP: 14000, e: 0.8,  crowding: "LOW",  archTag: "Experience",  customerType: "ToB", strategy: "DIFF", ageGroup: "ELDER" },
  { gridId: "B2B_Differentiation_Adult", WTP: 12000, e: 0.9,  crowding: "LOW",  archTag: "Hybrid",     customerType: "ToB", strategy: "DIFF", ageGroup: "ADULT" },
  { gridId: "B2B_Differentiation_Child", WTP: 10000, e: 1.0,  crowding: "MED",  archTag: "Function",   customerType: "ToB", strategy: "DIFF", ageGroup: "CHILD" },
  { gridId: "B2B_Cost_Elder",            WTP: 9000,  e: 1.0,  crowding: "MED",  archTag: "Experience",  customerType: "ToB", strategy: "COST", ageGroup: "ELDER" },
  { gridId: "B2B_Cost_Adult",            WTP: 7500,  e: 1.1,  crowding: "MED",  archTag: "Hybrid",     customerType: "ToB", strategy: "COST", ageGroup: "ADULT" },
  { gridId: "B2B_Cost_Child",            WTP: 6500,  e: 1.2,  crowding: "MED",  archTag: "Function",   customerType: "ToB", strategy: "COST", ageGroup: "CHILD" },
  { gridId: "B2C_Differentiation_Elder", WTP: 9500,  e: 1.1,  crowding: "LOW",  archTag: "Experience",  customerType: "ToC", strategy: "DIFF", ageGroup: "ELDER" },
  { gridId: "B2C_Differentiation_Adult", WTP: 8000,  e: 1.2,  crowding: "MED",  archTag: "Hybrid",     customerType: "ToC", strategy: "DIFF", ageGroup: "ADULT" },
  { gridId: "B2C_Differentiation_Child", WTP: 7000,  e: 1.3,  crowding: "MED",  archTag: "Function",   customerType: "ToC", strategy: "DIFF", ageGroup: "CHILD" },
  { gridId: "B2C_Cost_Elder",            WTP: 5500,  e: 1.4,  crowding: "MED",  archTag: "Experience",  customerType: "ToC", strategy: "COST", ageGroup: "ELDER" },
  { gridId: "B2C_Cost_Adult",            WTP: 4500,  e: 1.6,  crowding: "HIGH", archTag: "Hybrid",     customerType: "ToC", strategy: "COST", ageGroup: "ADULT" },
  { gridId: "B2C_Cost_Child",            WTP: 4000,  e: 1.8,  crowding: "HIGH", archTag: "Function",   customerType: "ToC", strategy: "COST", ageGroup: "CHILD" },
];

// ============ 加载参数文件 ============

function loadJSON(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (e) {
    return null;
  }
}

// 尝试多个可能的路径
function findFile(name) {
  const candidates = [
    path.join(process.cwd(), name),
    path.join(process.cwd(), "game_config_v0.1", name),
    path.join(__dirname, name),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return loadJSON(p);
  }
  return null;
}

const oldParams = findFile("market_space_params.json");
const newParams = findFile("market_space_params_v2.json");

if (!oldParams && !newParams) {
  console.error("❌ 找不到 market_space_params.json 或 market_space_params_v2.json");
  console.error("   请把文件放在当前目录或 game_config_v0.1/ 下");
  process.exit(1);
}

// ============ 跑测试 ============

function pad(s, n) { return String(s).padEnd(n); }
function rpad(s, n) { return String(s).padStart(n); }

function runTest(label, params) {
  if (!params) { console.log(`\n⏭  ${label}: 文件未找到，跳过\n`); return null; }

  console.log(`\n${"=".repeat(90)}`);
  console.log(`  ${label}`);
  console.log(`${"=".repeat(90)}`);
  console.log(`  ${pad("Grid", 37)} ${rpad("GM%", 5)} ${rpad("base", 5)} ${rpad("score", 6)} ${rpad("Space", 5)} ${rpad("Diff", 4)}  Check`);
  console.log(`  ${"-".repeat(84)}`);

  let pass = 0, fail = 0, warn = 0;
  const results = [];

  for (const g of GRIDS) {
    const gm = computeGmMax(g);
    const space = computeMarketSpaceTier(params, {
      gridId: g.gridId,
      crowding: g.crowding,
      tamMultiplier: 1,
      reachRate: 0.6
    });

    const gmPct = (gm.GM_max * 100).toFixed(0);
    const baseUsed = space.factors.baseSize;
    const keyHit = baseUsed !== 1; // Did it actually find the key?

    // Trade-off validation
    let status = "✓";
    if (gm.GM_max > 0.50 && space.tier === "L") { status = "❌ HIGH GM + L"; fail++; }
    else if (gm.GM_max < 0.20 && space.tier === "S") { status = "❌ LOW GM + S"; fail++; }
    else if (gm.GM_max > 0.50 && space.tier === "S") { status = "✓✓ perfect hedge"; pass++; }
    else if (gm.GM_max < 0.20 && space.tier === "L") { status = "✓✓ perfect hedge"; pass++; }
    else { pass++; }

    if (!keyHit) { status += " ⚠key miss→fallback=1"; warn++; }

    console.log(`  ${pad(g.gridId, 37)} ${rpad(gmPct + "%", 5)} ${rpad(baseUsed.toFixed(2), 5)} ${rpad(space.score.toFixed(3), 6)} ${rpad(space.tier, 5)} ${rpad(space.difficulty_tier, 4)}  ${status}`);

    results.push({ gridId: g.gridId, gm: gm.GM_max, space: space.tier, score: space.score, keyHit });
  }

  // Distribution
  const dist = { S: 0, M: 0, L: 0 };
  results.forEach(r => dist[r.space]++);
  const keyMisses = results.filter(r => !r.keyHit).length;

  console.log();
  console.log(`  Distribution: S=${dist.S}  M=${dist.M}  L=${dist.L}`);
  console.log(`  Key misses (fallback to 1): ${keyMisses}/12`);
  console.log(`  Trade-off: ${pass} pass, ${fail} fail, ${warn} key warnings`);

  return { pass, fail, warn, keyMisses, dist };
}

// ============ 执行 ============

console.log("╔══════════════════════════════════════════════════════════════╗");
console.log("║  Market Space Tier 对冲测试                                 ║");
console.log("║  验证：高GM格子→小规模(S)，低GM格子→大规模(L)              ║");
console.log("╚══════════════════════════════════════════════════════════════╝");

const r1 = runTest("旧版 market_space_params.json", oldParams);
const r2 = runTest("新版 market_space_params_v2.json", newParams);

// ============ 总结 ============

console.log("\n" + "═".repeat(90));
console.log("  SUMMARY");
console.log("═".repeat(90));

if (r1) {
  const ok1 = r1.fail === 0 && r1.keyMisses === 0;
  console.log(`  旧版: ${ok1 ? "✅ PASS" : "❌ FAIL"} — ${r1.fail} trade-off violations, ${r1.keyMisses} key misses`);
  if (r1.keyMisses > 0) {
    console.log(`         ⚠ ${r1.keyMisses}/12 个 gridId 在 base_size 里找不到 → fallback=1`);
    console.log(`         原因：旧版 grid_priors key 与当前代码 gridId 不一致`);
  }
}

if (r2) {
  const ok2 = r2.fail === 0 && r2.keyMisses === 0;
  console.log(`  新版: ${ok2 ? "✅ PASS" : "❌ FAIL"} — ${r2.fail} trade-off violations, ${r2.keyMisses} key misses`);
  if (ok2) {
    console.log(`         所有 key 命中 ✓  |  GM↔Space 对冲成立 ✓  |  S/M/L 分布: ${r2.dist.S}/${r2.dist.M}/${r2.dist.L}`);
  }
}

const allPass = r2 && r2.fail === 0 && r2.keyMisses === 0;
console.log();
console.log(allPass ? "🎉 新版通过，可以替换 game_config_v0.1/market_space_params.json" : "🚨 仍有问题，请检查");
console.log();

process.exit(allPass ? 0 : 1);
