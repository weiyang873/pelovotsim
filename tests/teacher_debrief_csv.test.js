const assert = require("node:assert/strict");
const { __test } = require("../server/routes/teacherDebrief");

const teams = [
  {
    name: "第1组",
    r1: {
      grid: "B2B_Differentiation_Elder",
      arch: "体验●",
      vp: "为养老机构提供\"安全守护\"",
      C: 4,
      G: 4,
      E: 5,
      Eadj: 5,
      sam: 101.7,
      wtpAdj: 6358.2
    },
    r2: {
      price: 4350,
      dCOGS: 654,
      cardCount: 9,
      riskTotal: 0.32,
      vscore: 0.31,
      units: 687,
      profit: 552600,
      profitPerUnit: 804.3,
      bestGrid: "B2B_Differentiation_Elder"
    }
  }
];

const csv = __test.generateCsv(teams);
assert.ok(csv.includes("\"组名\",\"格子\",\"架构\""));
assert.ok(csv.includes("第1组"));
assert.ok(csv.includes("\"为养老机构提供\"\"安全守护\"\"\""));

const metrics = __test.computeCsvMetrics(teams[0]);
assert.equal(Math.round(metrics.gm), 56);
assert.equal(Math.round(metrics.roi), 123);
assert.equal(metrics.consistent, "是");

const r1Money = __test.buildTeacherR1MoneyFields({
  final_sam: 339,
  final_wtp_adj: 21194
});
assert.equal(r1Money.samRaw, 339);
assert.equal(r1Money.sam, 101.7);
assert.equal(r1Money.wtpAdjRaw, 21194);
assert.equal(r1Money.wtpAdj, 6358.2);
assert.match(r1Money.moneyScaleContract, /@0\.3$/);

const promptTeam = __test.compactTeamReviewPromptData({
  id: "team-1",
  r1: r1Money,
  r2: { price: 4350 }
});
assert.equal(Object.hasOwn(promptTeam.r1, "samRaw"), false);
assert.equal(Object.hasOwn(promptTeam.r1, "wtpAdjRaw"), false);
assert.equal(promptTeam.r1.wtpAdj, 6358.2);
assert.match(__test.PROMPT_CACHE_VERSION, /money_scale_0_3$/);
