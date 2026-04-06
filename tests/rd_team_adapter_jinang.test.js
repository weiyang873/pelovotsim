const test = require("node:test");
const assert = require("node:assert/strict");

const { applyTechJinnang } = require("../server/multiplayer/rdTeamAdapter");

test("tech jinang falls back to risk-based dCOGS savings when no explicit dCOGS discount exists", () => {
  const adjusted = applyTechJinnang([
    { cap_id: "voice_basic", tier: "mid" }
  ], {
    match_strength: 0.8667,
    effect_applied: {
      match_strength: 0.8667,
      r2_risk_reduction_for_group: {
        interaction_expression: 0.216675
      }
    }
  });

  assert.equal(adjusted.length, 1);
  assert.ok(adjusted[0].dCOGS_base > adjusted[0].dCOGS_eff);
  assert.equal(adjusted[0].dCOGS_base - adjusted[0].dCOGS_eff > 0, true);
  assert.ok(adjusted[0].risk_base >= adjusted[0].risk_eff);
});

test("explicit dCOGS card discounts still take precedence over risk fallback", () => {
  const adjusted = applyTechJinnang([
    { cap_id: "touch_hug", tier: "mid" }
  ], {
    match_strength: 0.8,
    effect_applied: {
      match_strength: 0.8,
      r2_dCOGS_discount_for_cards: {
        touch_hug_interaction: 0.28
      },
      r2_risk_reduction_for_group: {
        interaction_expression: 0.12
      }
    }
  });

  assert.equal(adjusted.length, 1);
  assert.ok(Math.abs(adjusted[0].tech_applied.discount - 0.224) < 1e-9);
  assert.ok(Math.abs(adjusted[0].dCOGS_eff - adjusted[0].dCOGS_base * (1 - 0.224)) < 1e-9);
});
