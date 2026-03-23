const assert = require("node:assert/strict");

const {
  getRound2MarketInfo,
  loadMarketInfoConfig,
  normalizeMarketInfoKey
} = require("../server/multiplayer/marketInfo");

function run() {
  const config = loadMarketInfoConfig();
  const entries = Object.entries(config.market_info || {});

  assert.equal(entries.length, 12, `market info count=${entries.length}`);

  const marketSizeSum = entries.reduce((sum, [, item]) => sum + Number(item.market_size_yi || 0), 0);
  assert.equal(Math.abs(marketSizeSum - 246) <= 2, true, `market_size_yi sum=${marketSizeSum}`);

  for (const [key, item] of entries) {
    const hhi = Number(item.hhi);
    assert.equal(hhi >= 0.08 && hhi <= 0.25, true, `${key} hhi=${hhi}`);
  }

  assert.equal(normalizeMarketInfoKey("ToB_Differentiation_Elder"), "B2B_DIFF_ELDER");
  assert.equal(normalizeMarketInfoKey("ToC_COST_CHILD"), "B2C_COST_CHILD");
  assert.deepEqual(getRound2MarketInfo("ToC_Differentiation_Adult"), {
    market_size_yi: 16,
    hhi: 0.08,
    hhi_label: "高度分散"
  });

  console.log("round2_market_info.test.js: all tests passed");
}

run();
