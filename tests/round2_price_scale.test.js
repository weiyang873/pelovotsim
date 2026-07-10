const test = require("node:test");
const assert = require("node:assert/strict");

const {
  PRICE_SCALE,
  GLOBAL_PARAMS,
  GRID_PARAMS,
  computeWTPParams,
  calculateProfit,
  getCapabilityParams,
  resolveTierNreWan
} = require("../server/llm/rdCalculator");

function approx(actual, expected, tolerance = 1e-9) {
  return Math.abs(Number(actual) - Number(expected)) <= tolerance;
}

function grossMargin(price, channelFee, cogsBase, dCOGS) {
  return (price * (1 - channelFee) - cogsBase - dCOGS) / price;
}

function manualBeq(price, channelFee, cogsBase, dCOGS, fTotal) {
  const unitMargin = price * (1 - channelFee) - cogsBase - dCOGS;
  return unitMargin > 0 ? Math.ceil(fTotal / unitMargin) : null;
}

function round2SamValue(gridId) {
  const wtp = computeWTPParams(gridId);
  const channelAgeKey = `${wtp.channel}_${wtp.age}`;
  const grid = GRID_PARAMS[channelAgeKey];
  const marketSize = wtp.strategy === "DIFF" ? Number(grid.N_DIFF || 0) : Number(grid.N_COST || 0);
  return marketSize * Number(grid.Aw || 0) * Number(wtp.WTPmean || 0) / 10000;
}

test("round2 PRICE_SCALE is loaded and applied to WTP anchor", () => {
  assert.equal(PRICE_SCALE, 0.3);
  assert.equal(GLOBAL_PARAMS.Panchor, 9000);
  assert.equal(GLOBAL_PARAMS.V, 600);
  assert.equal(GLOBAL_PARAMS.F, 1500000);
  assert.equal(GLOBAL_PARAMS.S_monthly, 29.7);

  const wtp = computeWTPParams("ToC_DIFF_ELDER");
  assert.equal(wtp.WTPref >= 3600 && wtp.WTPref <= 5700, true, `WTPref=${wtp.WTPref}`);
});

test("round2 PRICE_SCALE preserves gross margin and BEQ ratios", () => {
  const card = getCapabilityParams("voice_basic", "mid");
  const priceScaled = 4000;
  const priceUnscaled = priceScaled / PRICE_SCALE;
  const f = 0.25;
  const cogsScaled = GLOBAL_PARAMS.V;
  const cogsUnscaled = cogsScaled / PRICE_SCALE;
  const dcogsScaled = card.dCOGS;
  const dcogsUnscaled = dcogsScaled / PRICE_SCALE;
  const nreScaledWan = resolveTierNreWan("voice_basic", "mid");
  const nreUnscaledWan = nreScaledWan / PRICE_SCALE;
  const fTotalScaled = GLOBAL_PARAMS.F + nreScaledWan * 10000;
  const fTotalUnscaled = (GLOBAL_PARAMS.F / PRICE_SCALE) + nreUnscaledWan * 10000;

  const gmScaled = grossMargin(priceScaled, f, cogsScaled, dcogsScaled);
  const gmUnscaled = grossMargin(priceUnscaled, f, cogsUnscaled, dcogsUnscaled);
  assert.equal(approx(gmScaled, gmUnscaled), true, `gmScaled=${gmScaled}, gmUnscaled=${gmUnscaled}`);

  const beqScaled = manualBeq(priceScaled, f, cogsScaled, dcogsScaled, fTotalScaled);
  const beqUnscaled = manualBeq(priceUnscaled, f, cogsUnscaled, dcogsUnscaled, fTotalUnscaled);
  assert.equal(Math.abs(beqScaled - beqUnscaled) <= 1, true, `beqScaled=${beqScaled}, beqUnscaled=${beqUnscaled}`);

  const profit = calculateProfit(priceScaled, "ToC_DIFF_ELDER", 5, dcogsScaled, 0.8, 0.5, 0.03, 0.08, computeWTPParams("ToC_DIFF_ELDER"), 0, 0, nreScaledWan);
  assert.equal(profit.breakeven_q, beqScaled);
});

test("round2 PRICE_SCALE preserves 12-grid SAM relative ordering", () => {
  const gridIds = [
    "ToC_DIFF_ELDER",
    "ToC_DIFF_ADULT",
    "ToC_DIFF_CHILD",
    "ToC_COST_ELDER",
    "ToC_COST_ADULT",
    "ToC_COST_CHILD",
    "ToB_DIFF_ELDER",
    "ToB_DIFF_ADULT",
    "ToB_DIFF_CHILD",
    "ToB_COST_ELDER",
    "ToB_COST_ADULT",
    "ToB_COST_CHILD"
  ];

  const currentOrder = gridIds
    .map((id) => ({ id, sam: round2SamValue(id) }))
    .sort((a, b) => b.sam - a.sam)
    .map((item) => item.id);
  const unscaledOrder = gridIds
    .map((id) => ({ id, sam: round2SamValue(id) / PRICE_SCALE }))
    .sort((a, b) => b.sam - a.sam)
    .map((item) => item.id);

  assert.deepEqual(currentOrder, unscaledOrder);
});
