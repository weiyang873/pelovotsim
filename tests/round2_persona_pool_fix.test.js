const test = require("node:test");
const assert = require("node:assert/strict");

const { __test } = require("../server/routes/round2Routes");

test("ToB persona consistency rejects consumer-style fallback personas", () => {
  const round1Context = {
    who_raw: "财富管理中心",
    gridLabel: "ToB·差异化·成人",
    isToB: true
  };

  const correctPersona = {
    name: "王总监",
    title: "财富管理中心总监",
    org_type: "区域股份制银行",
    org_scale: "12家分支行，理财经理团队80人",
    pressures: ["高净值客户等待时间长"],
    budget: "年度数字化预算120万",
    constraints: {
      who_raw: "财富管理中心",
      gridLabel: "ToB·差异化·成人"
    }
  };
  const driftedPersona = {
    name: "高女士",
    title: "品牌策划",
    family: "已婚未育",
    daily_scenes: ["下班后刷短视频", "周末去咖啡店办公"],
    spending: "对非必需消费谨慎"
  };

  assert.equal(__test.isPersonaConsistentWithRound1Context(correctPersona, round1Context), true);
  assert.equal(__test.isPersonaConsistentWithRound1Context(driftedPersona, round1Context), false);
});

test("ToC persona consistency rejects institution-side buyer personas", () => {
  const round1Context = {
    who_raw: "独居白领",
    gridLabel: "ToC·差异化·成人",
    isToB: false
  };

  const correctPersona = {
    name: "林小雨",
    title: "互联网产品经理",
    living_situation: "独居一居室",
    family: "单身",
    daily_scenes: ["晚上十点下班回家"],
    spending: "愿意为提升生活品质花钱",
    constraints: {
      who_raw: "独居白领",
      gridLabel: "ToC·差异化·成人"
    }
  };
  const driftedPersona = {
    name: "李总监",
    title: "采购总监",
    org_type: "连锁机构",
    pressures: ["审批慢"],
    budget: "项目预算50万"
  };

  assert.equal(__test.isPersonaConsistentWithRound1Context(correctPersona, round1Context), true);
  assert.equal(__test.isPersonaConsistentWithRound1Context(driftedPersona, round1Context), false);
});
