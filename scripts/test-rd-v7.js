#!/usr/bin/env node
const rd = require("../server/llm/rdCalculator");

let pass = 0;
let fail = 0;
function assert(label, cond) {
  if (cond) {
    pass++;
    console.log(`  ✅ ${label}`);
  } else {
    fail++;
    console.log(`  ❌ ${label}`);
  }
}

const R1 = {
  gridId: "B2C_Cost_Experience",
  WTP: 5500,
  e: 1.2,
  f: 0.12,
  COGSbase: 2090,
  TAM: 80000,
  H: 0.3,
  Pmax: 6800
};

const INTERVIEW = {
  radar: { perception: 7, motion: 6, interaction: 8, safety: 8, extend: 5.5, ops: 6.5 },
  tags: [
    { tag: "自然陪伴", polarity: 1 },
    { tag: "安全预警", polarity: 1 },
    { tag: "稳定可靠", polarity: 1 }
  ],
  evi: 0.8
};

const GOOD_PLAN = [
  { cap_id: "voice_basic", tier: "mid" },
  { cap_id: "music_companion", tier: "mid" },
  { cap_id: "perception_base", tier: "mid" },
  { cap_id: "scene_triggers", tier: "mid" },
  { cap_id: "basic_avoidance", tier: "mid" },
  { cap_id: "privacy_trust", tier: "mid" },
  { cap_id: "connect_base", tier: "mid" },
  { cap_id: "cloud_update", tier: "mid" }
];

const OVER_ENG = [
  { cap_id: "voice_basic", tier: "high" },
  { cap_id: "touch_hug", tier: "high" },
  { cap_id: "music_companion", tier: "high" },
  { cap_id: "visual_expression", tier: "high" },
  { cap_id: "scene_triggers", tier: "high" },
  { cap_id: "basic_avoidance", tier: "high" },
  { cap_id: "privacy_trust", tier: "high" },
  { cap_id: "connect_base", tier: "high" },
  { cap_id: "qa_system", tier: "high" },
  { cap_id: "sla_support", tier: "high" }
];

async function main() {
  console.log("\n--- A: v7 返回值结构 ---");
  const rGood = await rd.calculate({ ...R1, ...INTERVIEW, selections: GOOD_PLAN, P: 5000 });
  assert("A1 返回 roi", "roi" in rGood);
  assert("A2 返回 adoption", "adoption" in rGood);
  assert("A3 返回 S_competitive", "S_competitive" in rGood);
  assert("A4 返回 R", "R" in rGood);
  assert("A5 返回 V", "V" in rGood);
  assert("A6 返回 wtpPrime", "wtpPrime" in rGood);
  assert("A7 返回 penalty", "penalty" in rGood);
  assert("A8 返回 rdInvestment", "rdInvestment" in rGood);

  console.log("\n--- B: 份额 = A × S × R ---");
  const expectedShare = rGood.adoption * rGood.S_competitive * rGood.R;
  assert("B1 share ≈ A×S×R", Math.abs(rGood.share - expectedShare) < 0.001);
  assert("B2 adoption ∈ (0,1)", rGood.adoption > 0 && rGood.adoption < 1);
  assert("B3 S_competitive ∈ (0,1)", rGood.S_competitive > 0 && rGood.S_competitive < 1);

  console.log("\n--- C: 定价影响采用率 ---");
  const rHighP = await rd.calculate({ ...R1, ...INTERVIEW, selections: GOOD_PLAN, P: 6500 });
  const rLowP = await rd.calculate({ ...R1, ...INTERVIEW, selections: GOOD_PLAN, P: 3500 });
  assert("C1 高价 adoption < 低价 adoption", rHighP.adoption < rLowP.adoption);
  assert("C2 高价每台利润 > 低价每台利润", rHighP.unitProfitHW > rLowP.unitProfitHW);
  const sByFormula = rd.computeCompetitiveShare(
    rGood.coverCore,
    rGood.coverNice,
    rGood.subLift,
    rGood.risk,
    rGood.complexity
  );
  assert("C3 evi 不直接进入 Z（S_competitive 仅由覆盖/风险/复杂度决定）", Math.abs(sByFormula - rGood.S_competitive) < 0.001);

  console.log("\n--- D: 研发溢价 WTP' ---");
  assert("D1 wtpPrime >= WTP", rGood.wtpPrime >= R1.WTP);
  assert("D2 wtpPrime <= WTP × 1.30", rGood.wtpPrime <= R1.WTP * 1.3);
  assert("D3 V ∈ [0,1]", rGood.V >= 0 && rGood.V <= 1);
  const vNoCostPenalty = rd.computeValueScore(0.8, 0.6, 0.4, 0.2, 0, 2000);
  const vWithCostPenalty = rd.computeValueScore(0.8, 0.6, 0.4, 0.2, 1200, 2000);
  assert("D4 V 含成本惩罚：高 dCOGS 时 V 更低", vWithCostPenalty < vNoCostPenalty);

  console.log("\n--- E: Penalty ---");
  const rOver = await rd.calculate({ ...R1, ...INTERVIEW, selections: OVER_ENG, P: 5000 });
  assert("E1 过度工程 penalty > 0", rOver.penalty > 0);
  assert("E2 好方案 penalty = 0", rGood.penalty === 0);
  assert("E3 过度工程 S_competitive > 0.10", rOver.S_competitive > 0.1);

  console.log("\n--- F: ROI ---");
  assert("F1 好方案 ROI > 0", rGood.roi > 0);
  assert("F2 好方案 ROI > 过度工程 ROI", rGood.roi > (rOver.roi || 0));

  console.log("\n" + "=".repeat(60));
  console.log(`RESULT: ${pass} passed, ${fail} failed`);
  if (fail === 0) console.log("🎉 ALL PASSED — v7 口径确认");
  else console.log("🚨 有断言失败");
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
