const test = require("node:test");
const assert = require("node:assert/strict");

const RdRoutes = require("../server/routes/rd");
const {
  buildCapabilityGroupsForDisplay,
  getCapabilityParams,
  NRE_TIER_MULT,
  resolveTierNreWan
} = require("../server/llm/rdCalculator");

const TIERS = ["low", "mid", "high"];

function flattenDisplayCards(cardGroups) {
  const rows = [];
  for (const group of cardGroups.groups || []) {
    for (const cap of group.capabilities || []) {
      for (const tier of TIERS) {
        rows.push({
          cap_id: cap.cap_id,
          tier,
          dCOGS: Number(cap.tiers?.[tier]?.dCOGS || 0),
          nre: Number(cap.tiers?.[tier]?.nre || 0),
          nre_desc: String(cap.nre_desc || "")
        });
      }
    }
  }
  return rows;
}

function approx(actual, expected, tolerance = 1e-9) {
  return Math.abs(Number(actual) - Number(expected)) <= tolerance;
}

test("R2 card display dCOGS/NRE exactly match settlement params for all 69 tiers", async () => {
  const response = await RdRoutes.cards();
  assert.equal(response.status, 200);
  assert.equal(response.body.ok, true);

  const rows = flattenDisplayCards(response.body);
  let dcogsMatched = 0;
  let nreMatched = 0;

  for (const row of rows) {
    const settlement = getCapabilityParams(row.cap_id, row.tier);
    if (approx(row.dCOGS, settlement.dCOGS)) dcogsMatched += 1;
    if (approx(row.nre, settlement.nre_tier)) nreMatched += 1;
  }

  assert.equal(rows.length, 69);
  assert.equal(dcogsMatched, 69);
  assert.equal(nreMatched, 69);
});

test("R2 card display NRE follows the same tier multiplier source as settlement", () => {
  const customMultipliers = { ...NRE_TIER_MULT, high: 1.8 };
  const groups = buildCapabilityGroupsForDisplay(customMultipliers);
  const voice = (groups.groups || [])
    .flatMap((group) => group.capabilities || [])
    .find((cap) => cap.cap_id === "voice_basic");

  assert.ok(voice);
  assert.equal(voice.tiers.high.nre, resolveTierNreWan("voice_basic", "high", customMultipliers));
  assert.notEqual(voice.tiers.high.nre, resolveTierNreWan("voice_basic", "high"));
});

test("R2 NRE work descriptions do not contain hard-coded wan amounts", async () => {
  const response = await RdRoutes.cards();
  const rows = flattenDisplayCards(response.body);
  const leaked = rows.filter((row) => /\d+(?:\.\d+)?万/.test(row.nre_desc));
  assert.deepEqual(leaked, []);
});
