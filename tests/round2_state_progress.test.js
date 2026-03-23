const test = require("node:test");
const assert = require("node:assert/strict");

const {
  deriveCurrentStep,
  deriveTeamStatus
} = require("../server/multiplayer/round2State");

test("team merge defaults members to waiting_merge instead of in_discussion", () => {
  const currentStep = deriveCurrentStep("R2_TEAM_MERGE", { current_step: "" }, "completed", "submitted");
  assert.equal(currentStep, "waiting_merge");
});

test("team merge status is preserved when members are only waiting_merge", () => {
  const teamStatus = deriveTeamStatus(
    { status: "frozen", r2_status: "R2_TEAM_MERGE" },
    [
      { currentStep: "waiting_merge", cardStatus: "submitted", interviewStatus: "completed" },
      { currentStep: "waiting_merge", cardStatus: "submitted", interviewStatus: "completed" }
    ],
    null
  );

  assert.equal(teamStatus, "R2_TEAM_MERGE");
});

test("team discussion only starts once a member is actually in_discussion", () => {
  const teamStatus = deriveTeamStatus(
    { status: "frozen", r2_status: "R2_TEAM_MERGE" },
    [
      { currentStep: "in_discussion", cardStatus: "submitted", interviewStatus: "completed" },
      { currentStep: "waiting_merge", cardStatus: "submitted", interviewStatus: "completed" }
    ],
    null
  );

  assert.equal(teamStatus, "R2_TEAM_DISCUSSION");
});
