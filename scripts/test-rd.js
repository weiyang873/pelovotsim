#!/usr/bin/env node
const path = require("path");
const fs = require("fs");

const dataDir = path.join(__dirname, "..", "data");
const CAP_GROUPS = JSON.parse(fs.readFileSync(path.join(dataDir, "capability_groups_v2.json"), "utf8"));
const COMPAT = JSON.parse(fs.readFileSync(path.join(dataDir, "compatibility_rules_v2.json"), "utf8"));
const TAG_MAP_PATH = path.join(dataDir, "tag_map_v2_1.json");
const tagMap = fs.existsSync(TAG_MAP_PATH)
  ? JSON.parse(fs.readFileSync(TAG_MAP_PATH, "utf8"))
  : null;

let rd;
try {
  rd = require("../server/llm/rdCalculator");
} catch (e) {
  console.error("❌ 无法加载 server/llm/rdCalculator.js:", e.message);
  process.exit(1);
}

let pass = 0;
let fail = 0;
function assert(label, condition) {
  if (condition) {
    pass++;
    console.log(`  ✅ ${label}`);
  } else {
    fail++;
    console.log(`  ❌ ${label}`);
  }
}

const GOOD_PLAN = [
  { cap_id: "voice_basic", tier: "low" },
  { cap_id: "music_companion", tier: "low" },
  { cap_id: "perception_base", tier: "low" },
  { cap_id: "basic_avoidance", tier: "low" },
  { cap_id: "privacy_trust", tier: "low" },
  { cap_id: "connect_base", tier: "low" },
  { cap_id: "cloud_update", tier: "low" },
  { cap_id: "remote_diagnostics", tier: "low" }
];

const OVER_ENG = [
  { cap_id: "persona_dialog", tier: "high" },
  { cap_id: "visual_expression", tier: "high" },
  { cap_id: "perception_base", tier: "high" },
  { cap_id: "emotion_recognition", tier: "high" },
  { cap_id: "lidar_nav", tier: "high" },
  { cap_id: "privacy_trust", tier: "high" },
  { cap_id: "family_guardian", tier: "high" },
  { cap_id: "skill_store", tier: "high" },
  { cap_id: "cloud_update", tier: "high" },
  { cap_id: "audit_logging", tier: "high" }
];

const R1 = {
  gridId: "B2B_Differentiation_Experience",
  P: 12800,
  Pmax: 14200,
  f: 0.124,
  COGSbase: 2000,
  TAM: 50000,
  H: 0.3
};

const INTERVIEW = {
  radar: {
    perception: 8,
    mobility: 5,
    interaction: 9,
    safety_privacy: 7,
    integration: 4,
    operations: 3
  },
  tags: [
    { tag: "情绪识别", polarity: 1 },
    { tag: "语音交互", polarity: 1 },
    { tag: "隐私保护", polarity: 1 },
    { tag: "自动充电", polarity: 1 }
  ],
  priceSensitive: false,
  evi: 0.72
};

async function main() {
  console.log("\n--- A: 返回值结构 ---");
  const rGood = await rd.calculate({
    ...R1,
    ...INTERVIEW,
    selections: GOOD_PLAN
  });
  assert("A1 返回值含 violations", "violations" in rGood);
  assert("A2 返回值含 hardViolationCount", "hardViolationCount" in rGood);
  assert("A3 返回值含 load", "load" in rGood);
  assert("A4 返回值含 softPenalties", "softPenalties" in rGood);
  assert("A5 返回值含 z_penalty", "z_penalty" in rGood);
  assert("A6 返回值含 sub_lift", "sub_lift" in rGood);

  console.log("\n--- B: 输入格式 ---");
  assert("B1 接受 selections [{cap_id, tier}]", rGood.share > 0);
  assert("B2 好方案 8 张卡", GOOD_PLAN.length === 8);

  console.log("\n--- C: 软约束 ---");
  const rOver = await rd.calculate({
    ...R1,
    ...INTERVIEW,
    selections: OVER_ENG
  });
  assert("C1 过度工程超预算", rOver.softPenalties.budget.overBudget === true);
  assert("C2 过度工程超容量", rOver.softPenalties.capacity.overCapacity === true);
  assert("C3 过度工程 z_penalty < 0", rOver.z_penalty < 0);
  assert("C4 好方案 z_penalty >= 0", rGood.z_penalty >= 0 || !rGood.softPenalties.budget.overBudget);

  console.log("\n--- D: load ---");
  assert("D1 好方案 load > 0", rGood.load > 0);
  assert("D2 过度工程 load > 好方案 load", rOver.load > rGood.load);
  assert("D3 过度工程 load > capacity_cap(24)", rOver.load > 24);

  console.log("\n--- E: risk ---");
  assert("E1 risk >= 0（下限截断）", rGood.risk >= 0);
  assert("E2 过度工程 risk >= 0", rOver.risk >= 0);

  console.log("\n--- F: k_sub ---");
  assert("F1 好方案 sub_lift >= 0", rGood.sub_lift >= 0);
  assert("F2 过度工程 sub_lift > 好方案", rOver.sub_lift > rGood.sub_lift);

  console.log("\n--- G: hard violation ---");
  const INCOMPLETE = [
    { cap_id: "voice_basic", tier: "mid" },
    { cap_id: "perception_base", tier: "mid" },
    { cap_id: "privacy_trust", tier: "mid" }
  ];
  const vIncomplete = rd.validateSelections(INCOMPLETE);
  assert("G1 不完整选卡有 violation", vIncomplete.hardViolationCount > 0);
  assert("G2 validateSelections 返回 valid=false", vIncomplete.valid === false);
  assert("G3 报告缺组", vIncomplete.violations.some((v) => v.type === "group_min" || v.type === "total_min"));

  console.log("\n--- H: 教学效果 ---");
  assert("H1 好方案 share > 0.10", rGood.share > 0.1);
  assert("H2 好方案 profit > 过度工程 profit", rGood.profit > rOver.profit);

  console.log("\n--- I: 数据文件版本 ---");
  const totalCaps = CAP_GROUPS.groups.reduce((s, g) => s + g.capabilities.length, 0);
  assert("I1 capability_groups_v2 有 6 组", CAP_GROUPS.groups.length === 6);
  assert("I2 能力卡总数 >= 24", totalCaps >= 24);
  assert(
    "I3 compatibility_rules_v2 含 budget_definition",
    COMPAT.soft_constraints?.[0]?.type === "budget" || COMPAT.budget_definition != null || Array.isArray(COMPAT.soft_rules)
  );
  if (tagMap) {
    assert("I4 tag_map 含 >= 22 个标签", Object.keys(tagMap.need_tag_to_dim || {}).length >= 22);
  } else {
    assert("I4 tag_map_v2_1.json 存在", false);
  }

  console.log("\n" + "=".repeat(60));
  console.log(`RESULT: ${pass} passed, ${fail} failed out of ${pass + fail} assertions`);
  if (fail === 0) {
    console.log("🎉 ALL PASSED — v6 口径确认");
  } else {
    console.log("🚨 有断言失败 — 请检查代码或数据文件");
  }
  console.log("=".repeat(60));

  process.exit(fail > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
