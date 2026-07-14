import assert from "node:assert/strict";
import test from "node:test";

import {
  gateRequestedRound1Step,
  hasCompleteRound1Results,
  isRound1FinalizedStatus
} from "../client/src/utils/round1ResultGate.js";

test("step=5 is rejected until the server reports a finalized Round 1", () => {
  assert.equal(gateRequestedRound1Step(5, 4, "phase3"), 4);
  assert.equal(gateRequestedRound1Step(5, 3, "phase2"), 3);
  assert.equal(gateRequestedRound1Step(5, 0, "forming"), 0);
  assert.equal(gateRequestedRound1Step(5, 5, "phase4"), 5);
  assert.equal(gateRequestedRound1Step(5, 5, "frozen"), 5);
});

test("Round 1 result page requires status and all final decision fields", () => {
  const complete = {
    ok: true,
    team: {
      final_grid_id: "ToC_Differentiation_Elder",
      final_architecture: "Experience",
      final_vp_text: "WHO：独居老人\nPAIN：缺少陪伴\nHOW：主动互动"
    }
  };
  assert.equal(isRound1FinalizedStatus("phase3"), false);
  assert.equal(isRound1FinalizedStatus("phase4"), true);
  assert.equal(hasCompleteRound1Results(complete), true);
  assert.equal(hasCompleteRound1Results({ ...complete, ok: false }), false);
  assert.equal(hasCompleteRound1Results({ ...complete, team: { ...complete.team, final_vp_text: "" } }), false);
});
