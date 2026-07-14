const test = require("node:test");
const assert = require("node:assert/strict");

const Engine = require("../engine");
const TeamRoutes = require("../server/routes/teamRoutes");
const Round2Routes = require("../server/routes/round2Routes");
const {
  PRICE_SCALE,
  MONEY_SCALE_CONTRACT,
  scaleStoredMoney,
  addStoredRound1MoneyViews
} = require("../server/multiplayer/moneyScale");
const {
  PRICE_SCALE: ROUND2_PRICE_SCALE,
  computeWTPParams
} = require("../server/llm/rdCalculator");

function approx(actual, expected, tolerance = 1e-6) {
  return Math.abs(Number(actual) - Number(expected)) <= tolerance;
}

test("money scale contract reads the same 0.3 config as round2", () => {
  assert.equal(PRICE_SCALE, 0.3);
  assert.equal(ROUND2_PRICE_SCALE, PRICE_SCALE);
  assert.match(MONEY_SCALE_CONTRACT, /@0\.3$/);
  assert.equal(scaleStoredMoney(null), null);
  assert.equal(scaleStoredMoney(""), null);
  assert.equal(scaleStoredMoney(0), 0);
});

test("round1 remains raw in storage and exposes an explicit scaled view", () => {
  const raw = Engine.computeRound1V2("ToC_DIFF_ELDER", "Experience", { C: 3, G: 3, E: 3 }, 0);
  const stored = {
    final_sam: raw.SAM_billion,
    final_wtp_ref: raw.WTPref,
    final_wtp_adj: raw.WTPadj
  };
  const view = addStoredRound1MoneyViews(stored);

  assert.equal(view.final_sam, raw.SAM_billion);
  assert.equal(view.final_wtp_ref, raw.WTPref);
  assert.equal(view.final_wtp_adj, raw.WTPadj);
  assert.equal(view.final_sam_raw, raw.SAM_billion);
  assert.equal(view.final_sam_scaled, scaleStoredMoney(raw.SAM_billion));
  assert.equal(view.final_wtp_ref_scaled, scaleStoredMoney(raw.WTPref));
  assert.equal(view.final_wtp_adj_scaled, scaleStoredMoney(raw.WTPadj));
});

test("student round1 serializer adds scaled money without mutating raw results", () => {
  const raw = Engine.computeRound1V2("ToC_DIFF_ELDER", "Experience", { C: 3, G: 3, E: 3 }, 0);
  const student = TeamRoutes.sanitizeStudentR1Result(raw);

  assert.equal(student.WTPadj, raw.WTPadj);
  assert.equal(student.WTPadj_scaled, scaleStoredMoney(raw.WTPadj));
  assert.equal(student.WTPref_scaled, scaleStoredMoney(raw.WTPref));
  assert.equal(student.SAM_billion_scaled, scaleStoredMoney(raw.SAM_billion));
  assert.equal(student.money_scale, PRICE_SCALE);
  assert.equal(raw.WTPadj_scaled, undefined);
});

test("round1 display scale and round2 WTP use one monetary coordinate", () => {
  const raw = Engine.computeRound1V2("ToC_DIFF_ELDER", "Experience", { C: 3, G: 3, E: 3 }, 0);
  const round2Wtp = computeWTPParams("ToC_DIFF_ELDER");
  const displayWtp = Round2Routes.__test.scaleStudentFacingMoneyValue(raw.WTPmean);

  assert.equal(displayWtp, scaleStoredMoney(raw.WTPmean));
  assert.equal(approx(round2Wtp.WTPmean, displayWtp, 1), true);
});

test("student recap contract exposes scaled defaults and explicit raw audit fields", () => {
  const recap = Round2Routes.__test.buildStudentRound1MoneyView({
    round1Sam: 347,
    round1WtpAdj: 14654,
    matchedGridSam: 339,
    matchedGridWtpRef: 19268,
    matchedGridWtpMean: 19268
  });

  assert.equal(recap.round1_sam, 104.1);
  assert.equal(recap.round1_sam_raw, 347);
  assert.equal(recap.round1_wtp_adj, 4396.2);
  assert.equal(recap.round1_wtp_adj_scaled, 4396.2);
  assert.equal(recap.round1_wtp_adj_raw, 14654);
  assert.equal(recap.matched_grid_sam, 101.7);
  assert.equal(recap.matched_grid_wtp_ref, 5780.4);
  assert.equal(recap.matched_grid_wtp_ref_raw, 19268);
});
