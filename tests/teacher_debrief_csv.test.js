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
      sam: 339,
      wtpAdj: 21194
    },
    r2: {
      price: 14500,
      dCOGS: 2180,
      cardCount: 9,
      riskTotal: 0.32,
      vscore: 0.31,
      units: 687,
      profit: 1842000,
      profitPerUnit: 2681,
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
