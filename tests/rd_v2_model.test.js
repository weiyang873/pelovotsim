const assert = require("node:assert/strict");

const {
  calculate,
  computeWTPParams,
  compressWtpMult,
  calculateVolume,
  calculateCOGSbase,
  calculateProfit,
  resolveTierNreWan,
  NRE_TIER_MULT
} = require("../server/llm/rdCalculator");

function approxRel(actual, expected, relTol) {
  return Math.abs(actual - expected) / expected <= relTol;
}

function testWtpParams() {
  const p1 = computeWTPParams("ToC_DIFF_ELDER");
  assert.equal(approxRel(p1.WTPmean, 18091, 0.02), true, `ToC_DIFF_ELDER WTPmean=${p1.WTPmean}`);
  assert.equal(Math.abs(p1.gamma - 4.56) < 0.05, true, `ToC_DIFF_ELDER gamma=${p1.gamma}`);

  const p2 = computeWTPParams("ToC_COST_ADULT");
  assert.equal(approxRel(p2.WTPmean, 12404, 0.02), true, `ToC_COST_ADULT WTPmean=${p2.WTPmean}`);
  assert.equal(Math.abs(p2.gamma - 2.9) < 0.05, true, `ToC_COST_ADULT gamma=${p2.gamma}`);

  const p3 = computeWTPParams("ToB_DIFF_ELDER");
  assert.equal(approxRel(p3.WTPref, 19268, 0.02), true, `ToB_DIFF_ELDER WTPref=${p3.WTPref}`);
}

function testVolumeBehavior() {
  const wtp = computeWTPParams("ToC_DIFF_ELDER");

  const result = calculateVolume(wtp.WTPref, "ToC_DIFF_ELDER", 0, wtp);
  assert.equal(result.shareRate < 0.001, true, `shareRate@X0=${result.shareRate}`);

  const result2 = calculateVolume(wtp.WTPref, "ToC_DIFF_ELDER", 5, wtp);
  assert.equal(result2.shareRate > 0.00001 && result2.shareRate < 0.01, true, `shareRate@X5=${result2.shareRate}`);
}

function testDiffGammaTransform() {
  const wtpDiff = computeWTPParams("ToC_DIFF_ADULT");
  const lowV = calculateVolume(wtpDiff.WTPref, "ToC_DIFF_ADULT", 5, wtpDiff, 0);
  const highV = calculateVolume(wtpDiff.WTPref, "ToC_DIFF_ADULT", 5, wtpDiff, 0.33);
  assert.equal(highV.gammaEff < lowV.gammaEff, true, `diff gammaEff highV=${highV.gammaEff}, lowV=${lowV.gammaEff}`);

  const wtpCost = computeWTPParams("ToC_COST_ADULT");
  const costLow = calculateVolume(wtpCost.WTPref, "ToC_COST_ADULT", 5, wtpCost, 0);
  const costHigh = calculateVolume(wtpCost.WTPref, "ToC_COST_ADULT", 5, wtpCost, 0.33);
  assert.equal(Math.abs(costHigh.gammaEff - costLow.gammaEff) < 1e-9, true, `cost gammaEff low=${costLow.gammaEff}, high=${costHigh.gammaEff}`);
}

function testCostStructure() {
  assert.equal(calculateCOGSbase(10000), 2000, `COGS@10000=${calculateCOGSbase(10000)}`);
  assert.equal(calculateCOGSbase(1000), 2000, `COGS@1000=${calculateCOGSbase(1000)}`);
}

function testNreStructure() {
  assert.deepEqual(NRE_TIER_MULT, { low: 0.6, mid: 1.0, high: 1.6 });
  assert.equal(resolveTierNreWan("voice_basic", "low"), 59);
  assert.equal(resolveTierNreWan("voice_basic", "mid"), 98);
  assert.equal(resolveTierNreWan("voice_basic", "high"), 157);
  assert.equal(resolveTierNreWan("lidar_nav", "mid"), 184);
}

function testProfitDirection() {
  const wtp = computeWTPParams("ToC_DIFF_ELDER");
  const profitGood = calculateProfit(15000, "ToC_DIFF_ELDER", 5.0, 800, 0.8, 0.5, 0.3, 0.2, wtp, 0, 0, 120);
  const profitBad = calculateProfit(15000, "ToC_DIFF_ELDER", 1.0, 800, 0.3, 0.1, 0.1, 0.5, wtp, 0, 0, 120);
  assert.equal(profitGood.totalProfit > profitBad.totalProfit, true, `good=${profitGood.totalProfit}, bad=${profitBad.totalProfit}`);
  assert.equal(profitGood.F_total, 6200000);
  assert.equal(profitGood.breakeven_q > 0, true, `beq=${profitGood.breakeven_q}`);
}

function testCompressWtpMult() {
  assert.equal(compressWtpMult(0.6), 0.75);
  assert.equal(Math.abs(compressWtpMult(1.0) - 1.0166666666666666) < 1e-9, true, `mult@1.0=${compressWtpMult(1.0)}`);
  assert.equal(compressWtpMult(1.2), 1.15);
}

async function testCalculateWtpMultiplier() {
  const gridId = "B2C_Differentiation_Experience";
  const payload = {
    gridId,
    selections: [{ cap_id: "voice_basic", tier: "mid" }],
    radarScores: {
      perception: 6,
      mobility: 5,
      interaction: 7,
      safety_privacy: 6,
      integration: 5,
      operations: 5
    },
    tags: [{ tag: "语音交互", polarity: 1 }],
    evi: 0.7,
    P: 12000,
    Pmax: 15000,
    WTP: 14000,
    e: 1.2,
    COGSbase: 2000,
    TAM: 50000,
    H: 0.3
  };
  const baseline = await calculate(payload);
  const adjusted = await calculate({ ...payload, wtp_multiplier: 1.2 });

  assert.equal(baseline.rawWtpMult, 1);
  assert.equal(baseline.compressedWtpMult, 1);
  assert.equal(baseline.WTPref_adjusted, baseline.WTPref);
  assert.equal(Math.abs(adjusted.compressedWtpMult - 1.15) < 1e-9, true, `compressed=${adjusted.compressedWtpMult}`);
  assert.equal(Math.abs(adjusted.WTPref_adjusted - (computeWTPParams(gridId).WTPref * 1.15)) < 1e-6, true, `adjusted WTPref=${adjusted.WTPref_adjusted}`);
  assert.equal(adjusted.WTPref > baseline.WTPref, true, `adjusted=${adjusted.WTPref}, baseline=${baseline.WTPref}`);
}

async function run() {
  testWtpParams();
  testVolumeBehavior();
  testDiffGammaTransform();
  testCostStructure();
  testNreStructure();
  testProfitDirection();
  testCompressWtpMult();
  await testCalculateWtpMultiplier();
  console.log("rd_v2_model.test.js: all tests passed");
}

run().catch((err) => {
  console.error(err.stack || err.message || String(err));
  process.exit(1);
});
