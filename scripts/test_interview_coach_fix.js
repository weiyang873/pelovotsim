#!/usr/bin/env node
// scripts/test_interview_coach_fix.js
// 直接调用 conductInterview，用短问题连续怼 persona，验证修复效果
// 用法: node scripts/test_interview_coach_fix.js

const { conductInterview, buildPersonaSystemPrompt } = require("../server/llm/interviewCoach");

const TEST_PERSONA_TOB = {
  name: "王总监",
  age: 48,
  title: "运营总监",
  occupation: "运营总监",
  org_type: "集团化养老机构",
  org_scale: "3家分院，共360张床位，护工团队45人",
  living_situation: "集团化养老机构，3家分院，共360张床位",
  personality: "务实，关注ROI，对新技术持谨慎态度但愿意试点",
  daily_routine: "每天巡视各分院，处理运营问题，跟集团汇报",
  tech_comfort: "对新技术持务实态度，关注投入产出比",
  interview_style: "务实直接，关注具体效果和数据",
  background: "护理专业出身，在养老行业干了15年",
  pressures: [
    "集团要求今年整体运营成本降低5%",
    "护工流失率高，最近三个月走了5人",
    "夜间巡检记录不完整，上个月被卫健委查了"
  ],
  budget: "年度设备采购预算80万，超过30万需集团审批",
  trigger: "上个月3号院失智区一位老人夜间跌倒未及时发现，家属投诉到了集团",
  desires: ["希望降低运营成本", "提高护理效率"],
  pains: ["护工流失率高招不到人", "夜间值班覆盖不了所有楼层", "审批流程太长"],
  hidden_pain: "上个月跌倒事件差点上新闻，集团领导点名批评",
  contradictions: ["想引入新技术但怕老人不接受", "预算有限但问题紧迫"]
};

const SHORT_QUESTIONS = [
  "能解决吗",
  "为什么",
  "具体说说",
  "嗯",
  "然后呢",
  "机器人行吗",
  "成本呢",
];

const GUIDE_PATTERNS = ["你可以先问我", "你可以问问我", "你先问我", "建议你问", "你应该问"];

async function runTest() {
  console.log("🧪 Interview Coach 修复验证测试\n");
  console.log("=".repeat(60));

  const session = {
    persona: TEST_PERSONA_TOB,
    vpCanvas: {},
    strategy: { cell_label: "ToB_Differentiation_Elder" },
    messages: [],
    teamId: "test-team",
    memberId: "test-member",
  };

  let passed = 0;
  let failed = 0;
  const replies = [];

  for (let i = 0; i < SHORT_QUESTIONS.length; i++) {
    const question = SHORT_QUESTIONS[i];
    console.log(`\n--- 第 ${i + 1} 轮 ---`);
    console.log(`学生: ${question}`);

    try {
      const result = await conductInterview(session, question);
      const reply = result.reply;
      console.log(`王总监: ${reply}`);
      replies.push(reply);

      // 检查 1: 不包含引导性语句
      const hasGuide = GUIDE_PATTERNS.some((p) => reply.includes(p));
      if (hasGuide) {
        console.log("  ❌ FAIL: 包含引导性语句（'你可以先问我...'）");
        failed++;
      } else {
        console.log("  ✅ PASS: 无引导性语句");
        passed++;
      }

      // 检查 2: 不与上一轮完全重复
      if (i > 0 && reply === replies[i - 1]) {
        console.log("  ❌ FAIL: 与上一轮回复完全重复");
        failed++;
      } else if (i > 0) {
        console.log("  ✅ PASS: 回复不重复");
        passed++;
      }

      // 检查 3: 回复长度 > 10 字（不是纯反问/拒答）
      if (reply.length < 10) {
        console.log(`  ⚠️  WARN: 回复过短（${reply.length}字）`);
      }

      // 更新 session messages
      session.messages.push({ role: "user", content: question });
      session.messages.push({ role: "assistant", content: reply });

    } catch (err) {
      console.log(`  ❌ ERROR: ${err.message}`);
      failed++;
    }
  }

  console.log("\n" + "=".repeat(60));
  console.log(`\n📊 结果: ✅ ${passed}  ❌ ${failed}`);

  // 额外检查: persona 是否泄露了压力/预算原文
  const allReplies = replies.join(" ");
  const leakedFields = [];
  if (allReplies.includes("集团要求今年整体运营成本降低5%")) leakedFields.push("pressures原文");
  if (allReplies.includes("年度设备采购预算80万")) leakedFields.push("budget原文");
  if (allReplies.includes("上个月3号院失智区")) leakedFields.push("trigger原文");

  if (leakedFields.length > 0) {
    console.log(`\n⚠️  人设字段疑似泄露: ${leakedFields.join(", ")}`);
    console.log("   （少量自然提及可以接受，逐字复述才算泄露）");
  } else {
    console.log("\n✅ 无人设字段逐字泄露");
  }

  if (failed === 0) {
    console.log("\n🎉 全部通过！访谈修复有效。");
    process.exit(0);
  } else {
    console.log(`\n⚠️  有 ${failed} 项未通过，请检查。`);
    process.exit(1);
  }
}

runTest().catch((err) => {
  console.error("测试脚本出错:", err);
  process.exit(1);
});
