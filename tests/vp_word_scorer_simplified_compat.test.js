const test = require("node:test");
const assert = require("node:assert/strict");

const { scoreVpByWord } = require("../server/llm/vpWordScorer");

const FIXTURES = [
  {
    name: "adult companion differentiation",
    gridId: "ToC_Differentiation_Adult",
    architecture: "Experience",
    summaryFields: {
      who_raw: "一二线城市独居上班族，下班回到家后情绪空落但又不想继续高强度社交。",
      pain_raw: "他们在高压工作后最需要的是被回应和被接住，现有社交软件常常带来更多信息负担，宠物又需要长期照料。",
      how_raw: "LOVOT通过主动迎接、情绪化互动和轻量陪伴，在回家第一刻给用户一个低负担的情感回应。",
      alternative_raw: "社交软件、短视频、养宠物",
      boundary_raw: "不替代真实亲密关系，也不适合完全拒绝情感互动的人"
    },
    studentFields: {
      who_raw: "独居城市白领，二十五到三十五岁，下班后回到安静公寓时最容易感到情绪低落。",
      pain_raw: "他们在高压工作结束后缺少即时回应，现有社交软件只会增加信息负担，无法缓解回家第一刻的空落。",
      how_raw: "LOVOT通过主动迎接、轻量陪伴和情绪化互动，让用户进门时立刻获得被回应的感觉，并降低独处压力。",
      alternative_raw: "社交软件和养宠物",
      boundary_raw: "不替代真实人际关系"
    }
  },
  {
    name: "elder care cost",
    gridId: "ToC_Cost_Elder",
    architecture: "Hybrid",
    summaryFields: {
      who_raw: "和子女分开居住的独居老人，日常愿意尝试简单设备，但害怕复杂设置和高维护成本。",
      pain_raw: "老人担心跌倒、忘记吃药和夜间无人回应，子女也因为不能实时陪伴而长期焦虑。",
      how_raw: "LOVOT通过语音提醒、异常提示和基础陪伴，降低老人学习门槛，同时让子女远程获得安心。",
      alternative_raw: "智能音箱、电话关怀、钟点工",
      boundary_raw: "不承担医疗诊断和专业护理"
    },
    studentFields: {
      who_raw: "独居老人，夜间起身频繁，子女无法实时陪在身边。",
      pain_raw: "他们怕夜里跌倒、怕没有回应，也怕子女长期担心，但复杂设备又学不会。",
      how_raw: "LOVOT通过夜间提醒、情感陪伴和异常提醒，让老人更安心，也减少家属焦虑。",
      alternative_raw: "智能音箱和电话关怀",
      boundary_raw: "不做医疗诊断"
    }
  },
  {
    name: "institution adult function",
    gridId: "ToB_Cost_Adult",
    architecture: "Function",
    summaryFields: {
      who_raw: "企业前台和行政接待负责人，需要在访客高峰时段保持稳定接待体验，同时控制人力成本。",
      pain_raw: "前台人手不足时容易出现等待、引导混乱和服务不一致，额外增员又需要预算审批。",
      how_raw: "LOVOT通过标准化欢迎、语音引导和基础识别，分担重复接待任务，提升运营效率。",
      alternative_raw: "增加前台人员、电子指引屏、临时外包",
      boundary_raw: "不处理复杂投诉和高权限业务"
    },
    studentFields: {
      who_raw: "企业前台和接待负责人，在访客高峰时段需要稳定接待体验。",
      pain_raw: "他们常常面临人手不足、引导混乱和访客等待时间过长的问题，增加人力又要审批。",
      how_raw: "LOVOT通过欢迎互动、语音引导和基础识别，提升到访体验并减轻前台负荷。",
      alternative_raw: "增加前台或电子屏",
      boundary_raw: "不处理复杂投诉"
    }
  }
];

function maxScoreDiff(left, right) {
  return Math.max(...["C", "G", "E", "VPscore"].map((key) => (
    Math.abs(Number(left?.scores?.[key] || 0) - Number(right?.scores?.[key] || 0))
  )));
}

test("simplified WHO/PAIN/HOW fields stay compatible with vpWordScorer summary inputs", async () => {
  for (const fixture of FIXTURES) {
    const summaryScore = await scoreVpByWord(fixture.summaryFields, fixture.gridId, fixture.architecture);
    const studentScore = await scoreVpByWord(fixture.studentFields, fixture.gridId, fixture.architecture);
    const diff = maxScoreDiff(summaryScore, studentScore);
    assert.ok(diff < 0.5, `${fixture.name} max diff ${diff} should be < 0.5`);
  }
});
