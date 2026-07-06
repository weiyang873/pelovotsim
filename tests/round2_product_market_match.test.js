const assert = require("node:assert/strict");

const { computeProductMarketMatch } = require("../server/llm/rdCalculator");
const v4Priors = require("../data/grid_priors_v4_cap_weights.json");

function main() {
  const v4Fixture = computeProductMarketMatch({
    interaction: 9,
    perception: 1,
    mobility: 1,
    safety_privacy: 1,
    integration: 1,
    operations: 1
  }, v4Priors);

  assert.equal(v4Fixture.bestGrid, "B2C_Differentiation_Elder");
  assert.equal(v4Fixture.allMatches.B2C_Differentiation_Elder, 3.742857);
  assert.equal(v4Fixture.allMatches.B2B_Differentiation_Elder, 2.828571);

  const legacyFixture = computeProductMarketMatch({
    interaction: 9,
    perception: 6,
    mobility: 2,
    safety_privacy: 1,
    integration: 1,
    operations: 1
  }, {
    grids: [
      {
        id: "Grid_A",
        weights: {
          interaction: 0.5,
          perception: 0.5,
          mobility: 0,
          safety_privacy: 0,
          integration: 0,
          operations: 0
        }
      },
      {
        id: "Grid_B",
        weights: {
          interaction: 0.1,
          perception: 0.1,
          mobility: 0.8,
          safety_privacy: 0,
          integration: 0,
          operations: 0
        }
      }
    ]
  });

  assert.equal(legacyFixture.bestGrid, "Grid_A");
  assert.equal(legacyFixture.bestMatch, 7.5);
  assert.equal(legacyFixture.allMatches.Grid_B, 3.1);

  console.log("round2_product_market_match.test.js passed");
}

main();
