const assert = require("node:assert/strict");

const { DecisionTracker } = require("../scripts/sim/decision_tracker");

function testUseBestIterationAsFinal() {
  const tracker = new DecisionTracker(0, 4);

  tracker.pushVpIteration({
    iteration: 0,
    trigger: "baseline_score",
    vp_text: "baseline",
    scores: { C: 2, G: 2, E: 2 }
  });
  tracker.pushVpIteration({
    iteration: 1,
    trigger: "coach_round_1",
    vp_text: "best version",
    scores: { C: 4, G: 4, E: 4 }
  });
  tracker.pushVpIteration({
    iteration: 4,
    trigger: "confirm_submit",
    vp_text: "best version",
    scores: { C: 4, G: 4, E: 4 },
    used_best_iteration: true,
    best_iteration: "coach_round_1",
    best_score: 64
  });
  tracker.setVpBestSelection(true, "coach_round_1", 64);

  assert.equal(tracker.team.vp_best_score, 64);
  assert.equal(tracker.team.vp_best_iteration, "coach_round_1");
  assert.equal(tracker.team.vp_final_score, 64);
  assert.equal(tracker.team.vp_used_best, true);

  tracker.recordPhase4({
    r1_result: {},
    wtp_breakdown: {},
    vp_scores: { C: 1, G: 1, E: 1 },
    vp_summary: { who: "x" },
    team: { final_vp_text: "server confirm version" }
  });

  const last = tracker.team.vpIterations[tracker.team.vpIterations.length - 1];
  assert.equal(last.vp_text, "best version");
  assert.deepEqual(last.scores, { C: 4, G: 4, E: 4 });
  assert.equal(tracker.team.vp_final_score, 64);
}

function testConfirmWinsTieForBestIteration() {
  const tracker = new DecisionTracker(0, 4);

  tracker.pushVpIteration({
    iteration: 0,
    trigger: "baseline_score",
    vp_text: "baseline",
    scores: { C: 2, G: 2, E: 2 }
  });
  tracker.pushVpIteration({
    iteration: 1,
    trigger: "coach_round_1",
    vp_text: "coach",
    scores: { C: 4, G: 4, E: 4 }
  });
  tracker.pushVpIteration({
    iteration: 4,
    trigger: "confirm_submit",
    vp_text: "confirm",
    scores: { C: 4, G: 4, E: 4 }
  });

  assert.equal(tracker.team.vp_best_score, 64);
  assert.equal(tracker.team.vp_best_iteration, "confirm_submit");
}

function run() {
  testUseBestIterationAsFinal();
  testConfirmWinsTieForBestIteration();
  console.log("decision_tracker_vp_best.test.js: all tests passed");
}

run();
