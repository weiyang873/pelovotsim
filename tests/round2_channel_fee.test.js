const test = require("node:test");
const assert = require("node:assert/strict");

const { __test } = require("../server/routes/round2Routes");

test("round2 recap channel fee is 25% for ToC grids", () => {
  assert.equal(__test.getRound2ChannelFeeByGrid("toc_cost_adult"), 0.25);
  assert.equal(__test.getRound2ChannelFeeByGrid("b2c_diff_child"), 0.25);
});

test("round2 recap channel fee is 15% for ToB grids", () => {
  assert.equal(__test.getRound2ChannelFeeByGrid("tob_diff_elder"), 0.15);
  assert.equal(__test.getRound2ChannelFeeByGrid("b2b_cost_adult"), 0.15);
});
