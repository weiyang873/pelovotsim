// test-rd.js - R&D 模块计算测试（v6）
// 运行方式：node test-rd.js

const { calculate, validateSelections } = require("./server/llm/rdCalculator");

// 共用输入：ToC 差异化体验定位，老人陪伴场景
const baseInput = {
  gridId: "B2C_Differentiation_Experience",
  P: 12800,
  Pmax: 15000,
  f: 0.15,
  COGSbase: 6000,
  TAMunits: 500000,
  H: 0.05,
  radarScores: {
    perception: 7,
    mobility: 3,
    interaction: 10,
    safety_privacy: 5,
    integration: 1,
    operations: 3
  },
  tags: [
    { tag: "情感陪伴", polarity: "positive" },
    { tag: "语音交互", polarity: "positive" },
    { tag: "个性化推荐", polarity: "positive" },
    { tag: "家庭版", polarity: "positive" },
    { tag: "自动充电", polarity: "positive" },
    { tag: "情绪识别", polarity: "negative" }
  ],
  priceSensitive: false
};

// 方案1：好方案（10张，体验导向，预算内）
console.log("=== 好方案（体验导向）===");
const r1 = calculate({
  ...baseInput,
  selections: [
    { cap_id: "voice_basic", tier: "mid" },
    { cap_id: "persona_dialog", tier: "mid" },
    { cap_id: "touch_hug", tier: "mid" },
    { cap_id: "perception_base", tier: "mid" },
    { cap_id: "emotion_recognition", tier: "low" },
    { cap_id: "basic_avoidance", tier: "low" },
    { cap_id: "privacy_trust", tier: "mid" },
    { cap_id: "content_compliance", tier: "low" },
    { cap_id: "mobile_app", tier: "mid" },
    { cap_id: "cloud_update", tier: "mid" }
  ]
});
printResult(r1);

// 方案2：过度工程（10张，全 high）
console.log("\n=== 过度工程 ===");
const r2 = calculate({
  ...baseInput,
  selections: [
    { cap_id: "persona_dialog", tier: "high" },
    { cap_id: "visual_expression", tier: "high" },
    { cap_id: "perception_base", tier: "high" },
    { cap_id: "emotion_recognition", tier: "high" },
    { cap_id: "adaptive_learning", tier: "high" },
    { cap_id: "lidar_nav", tier: "high" },
    { cap_id: "privacy_trust", tier: "high" },
    { cap_id: "family_guardian", tier: "high" },
    { cap_id: "home_iot", tier: "high" },
    { cap_id: "cloud_update", tier: "high" }
  ]
});
printResult(r2);

// 方案3：降本（8张，最小化成本）
console.log("\n=== 降本导向 ===");
const r3 = calculate({
  ...baseInput,
  selections: [
    { cap_id: "voice_basic", tier: "low" },
    { cap_id: "no_screen_costdown", tier: "mid" },
    { cap_id: "perception_base", tier: "low" },
    { cap_id: "no_lidar_costdown", tier: "mid" },
    { cap_id: "basic_avoidance", tier: "low" },
    { cap_id: "privacy_trust", tier: "low" },
    { cap_id: "connect_base", tier: "low" },
    { cap_id: "cost_engineering", tier: "mid" }
  ]
});
printResult(r3);

// 方案4：验证 hard violation
console.log("\n=== Hard violation 测试 ===");
const v = validateSelections([
  { cap_id: "emotion_recognition", tier: "high" },
  { cap_id: "perception_base", tier: "low" },
  { cap_id: "privacy_trust", tier: "low" }
]);
console.log(`  violations: ${v.length}`);
v.forEach((vi) => console.log(`  - ${vi.message}`));

function printResult(r) {
  console.log(`  violations=${r.hardViolationCount} evi=${r.evi.toFixed(2)} fit=${r.fit.toFixed(3)} I=${r.I.toFixed(3)}`);
  console.log(`  covercore=${r.covercore.toFixed(2)} covernice=${r.covernice.toFixed(2)}`);
  console.log(`  dCOGS=${r.dCOGS} risk=${r.risk.toFixed(2)} load=${r.load}/${r.softPenalties.capacity.capacityCap}`);
  console.log(
    `  budget: ${r.softPenalties.budget.positiveDCOGS}/${r.softPenalties.budget.budgetCap} (${r.softPenalties.budget.overBudget ? "⚠ OVER" : "✓ OK"})`
  );
  console.log(`  z_penalty=${r.z_penalty.toFixed(2)} z=${r.z.toFixed(3)} share=${(r.share * 100).toFixed(1)}%`);
  console.log(`  units=${r.units.toLocaleString()} profit=¥${r.profit.toLocaleString()}`);
  console.log(`  (hw=¥${r.profit_hw.toLocaleString()} sub=¥${r.profit_sub.toLocaleString()} attach=${(r.attach * 100).toFixed(0)}%)`);
  if (r.softPenalties.details.length > 0) {
    console.log("  soft penalties:");
    r.softPenalties.details.forEach((d) => console.log(`    - ${d.rule}: ${JSON.stringify(d)}`));
  }
}
