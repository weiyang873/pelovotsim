const test = require("node:test");
const assert = require("node:assert/strict");

const { runSql, sqlQuote, shutdown } = require("../server/db/pgSql");
const TeamRoutes = require("../server/routes/teamRoutes");
const Round2Routes = require("../server/routes/round2Routes");
const SessionConfig = require("../server/multiplayer/sessionConfig");
const {
  updateTeamRound2Status,
  getTeamRound2State
} = require("../server/multiplayer/round2State");

const originalConsoleLog = console.log;
const ROUNDS = 50;
const TEAM_SIZE = 3;
const R2_SELECTIONS = [
  { cap_id: "voice_basic", tier: "low" },
  { cap_id: "perception_base", tier: "low" },
  { cap_id: "privacy_trust", tier: "low" }
];

async function cleanupTeam(teamId) {
  const tables = [
    "round2_results",
    "round2_submissions",
    "fg_team_radar",
    "round2_persona_views",
    "round2_persona_choices",
    "round2_persona_reports",
    "round2_team_drafts",
    "round2_member_selections",
    "round2_interview_sessions",
    "round2_dimension_assignments",
    "round1_team_drafts",
    "member_submissions",
    "jinang_settlements",
    "students",
    "team_members",
    "teams"
  ];
  for (const table of tables) {
    const column = table === "teams" ? "id" : "team_id";
    await runSql(`DELETE FROM ${table} WHERE ${column} = ${sqlQuote(teamId)};`).catch(() => {});
  }
}

async function createThreeMemberTeam(prefix) {
  const res = await TeamRoutes.createTeamApi({
    teamName: `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    teamSize: TEAM_SIZE
  });
  assert.equal(res.status, 200, res.body?.error || "createTeamApi failed");
  const teamId = res.body.team.id;
  const members = res.body.team.members || [];
  assert.equal(members.length, TEAM_SIZE);
  return { teamId, members };
}

test.before(() => {
  console.log = (...args) => {
    const first = String(args[0] || "");
    if (first.startsWith("[round2State]")) return;
    originalConsoleLog(...args);
  };
});

test("R2 member card submissions atomically advance to team merge under 3-way concurrency", async () => {
  const sessionId = `atomic_r2_${Date.now()}`;
  await SessionConfig.updateSessionConfig(sessionId, { interview_mode: "live" });
  const teamIds = [];
  try {
    for (let i = 0; i < ROUNDS; i += 1) {
      const { teamId, members } = await createThreeMemberTeam("atomic_r2");
      teamIds.push(teamId);
      await updateTeamRound2Status(teamId, "R2_INDIVIDUAL_CARDS");

      const responses = await Promise.all(members.map((member) => {
        return Round2Routes.saveMemberSelectionApi({
          teamId,
          memberId: member.id,
          sessionId,
          selections: R2_SELECTIONS
        });
      }));

      responses.forEach((res) => {
        assert.equal(res.status, 200, res.body?.error || "saveMemberSelectionApi failed");
      });
      const state = await getTeamRound2State(teamId);
      assert.equal(state?.r2?.status, "R2_TEAM_MERGE", `round ${i + 1} left team in ${state?.r2?.status}`);
    }
  } finally {
    for (const teamId of teamIds) {
      await cleanupTeam(teamId);
    }
  }
});

test("R1 phase1 submissions atomically advance to phase2 under 3-way concurrency", async () => {
  const teamIds = [];
  try {
    for (let i = 0; i < ROUNDS; i += 1) {
      const { teamId, members } = await createThreeMemberTeam("atomic_r1");
      teamIds.push(teamId);

      const responses = await Promise.all(members.map((member, index) => {
        return TeamRoutes.submitPhase1(teamId, member.id, {
          grid_id: "B2C_Differentiation_Adult",
          architecture: "Experience",
          who: `并发成员${index + 1}`,
          pain: "下班回家后很孤独，想要有人陪着说说话",
          how: "通过稳定陪伴、主动互动和情绪回应缓解独处时的低落"
        });
      }));

      responses.forEach((res) => {
        assert.equal(res.status, 200, res.body?.error || "submitPhase1 failed");
      });
      const team = await TeamRoutes.getTeamApi(teamId);
      assert.equal(team.status, 200);
      assert.equal(team.body.team.status, "phase2", `round ${i + 1} left team in ${team.body.team.status}`);
    }
  } finally {
    for (const teamId of teamIds) {
      await cleanupTeam(teamId);
    }
  }
});

test("normal serial submit paths still advance only at the last member", async () => {
  const sessionId = `serial_status_${Date.now()}`;
  await SessionConfig.updateSessionConfig(sessionId, { interview_mode: "live" });
  const teamIds = [];
  try {
    const r2 = await createThreeMemberTeam("serial_r2");
    teamIds.push(r2.teamId);
    await updateTeamRound2Status(r2.teamId, "R2_INDIVIDUAL_CARDS");
    for (let i = 0; i < r2.members.length; i += 1) {
      const res = await Round2Routes.saveMemberSelectionApi({
        teamId: r2.teamId,
        memberId: r2.members[i].id,
        sessionId,
        selections: R2_SELECTIONS
      });
      assert.equal(res.status, 200, res.body?.error || "saveMemberSelectionApi failed");
      const state = await getTeamRound2State(r2.teamId);
      assert.equal(
        state?.r2?.status,
        i === r2.members.length - 1 ? "R2_TEAM_MERGE" : "R2_INDIVIDUAL_CARDS"
      );
    }

    const r1 = await createThreeMemberTeam("serial_r1");
    teamIds.push(r1.teamId);
    for (let i = 0; i < r1.members.length; i += 1) {
      const res = await TeamRoutes.submitPhase1(r1.teamId, r1.members[i].id, {
        grid_id: "B2C_Differentiation_Adult",
        architecture: "Experience",
        who: `串行成员${i + 1}`,
        pain: "下班回家后很孤独，想要有人陪着说说话",
        how: "通过稳定陪伴、主动互动和情绪回应缓解独处时的低落"
      });
      assert.equal(res.status, 200, res.body?.error || "submitPhase1 failed");
      const team = await TeamRoutes.getTeamApi(r1.teamId);
      assert.equal(team.status, 200);
      assert.equal(team.body.team.status, i === r1.members.length - 1 ? "phase2" : "forming");
    }
  } finally {
    for (const teamId of teamIds) {
      await cleanupTeam(teamId);
    }
  }
});

test.after(async () => {
  console.log = originalConsoleLog;
  await shutdown();
});
