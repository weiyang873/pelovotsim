"use strict";

const { scoreVpByEmbedding } = require("../server/llm/vpEmbeddingScorer");

const CALIBRATION_SAMPLES = [
  {
    label: "S1 极简低分 ToB老人成本",
    vp: "养老院用。老人孤单，员工忙。机器人陪聊，省人力。",
    grid: "ToB·成本·老人",
    arch: "Hybrid",
    expected: { C: [1.5, 2.5], G: [1.5, 2.5], E: [1.0, 2.0] }
  },
  {
    label: "S2 中高分 ToB老人成本",
    vp: "为傍晚时段老人多、员工少的养老院，提供能承担陪聊任务的LOVOT机器人，让员工能脱身去处理发药查房等工作，从而节省人力成本——比请人便宜。失智老人除外。",
    grid: "ToB·成本·老人",
    arch: "Hybrid",
    expected: { C: [3.0, 4.0], G: [2.5, 3.5], E: [3.0, 4.0] }
  },
  {
    label: "S3 中高分 ToB成人差异",
    vp: "为护工短缺的养老院（针对能自理的老人），提供能主动互动陪伴的机器人，减少老人因孤独引发的呼叫和情绪问题，从而降低护工工作负荷、提升照护效率——这比被动播放的电视更能满足老人的情感互动需求。",
    grid: "ToB·差异·成人",
    arch: "Hybrid",
    expected: { C: [3.0, 4.0], G: [2.5, 4.0], E: [3.0, 4.5] }
  },
  {
    label: "S4 高分 ToC儿童体验",
    vp: "为初次分床、夜里容易哭闹的3到6岁孩子家庭，提供会主动靠近、发光并用语音安抚的陪伴机器人，帮助孩子更快安静入睡、减少家长反复抱哄——这比故事机只有播放内容、不能互动更有效；但对一岁以下婴儿不适用。",
    grid: "ToC·差异·儿童",
    arch: "Experience",
    expected: { C: [3.5, 4.5], G: [3.0, 4.5], E: [3.5, 4.5] }
  },
  {
    label: "S5 政策套话偏空 ToB老人功能",
    vp: "为响应银发经济与智慧养老政策的养老机构，提供智能陪伴与安全监测一体化方案，赋能机构降本增效、提升服务质量——优于传统人工管理模式。",
    grid: "ToB·成本·老人",
    arch: "Function",
    expected: { C: [2.0, 3.5], G: [1.5, 3.0], E: [2.0, 3.5] }
  },
  {
    label: "S6 中分 ToC成人功能",
    vp: "为独居上班族，提供能在下班回家后主动问候、提醒吃药和记录异常作息的家庭机器人，帮助他们少忘事、减少一个人生活的混乱——比手机提醒更容易被执行；但长期出差时价值会下降。",
    grid: "ToC·成本·成人",
    arch: "Function",
    expected: { C: [2.5, 4.0], G: [2.0, 3.5], E: [3.0, 4.5] }
  }
];

async function main() {
  for (const sample of CALIBRATION_SAMPLES) {
    const result = await scoreVpByEmbedding(sample.vp, sample.grid, sample.arch);
    console.log(`[${sample.label}] C=${result.scores.C} G=${result.scores.G} E=${result.scores.E}`);
  }
}

main().catch((err) => {
  console.error("calibrate_vp_scorer failed:", err);
  process.exit(1);
});
