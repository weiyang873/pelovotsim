const assert = require("node:assert/strict");

const { runSql, shutdown, sqlQuote } = require("../server/db/pgSql");
const TeamRoutes = require("../server/routes/teamRoutes");

async function cleanup(teamId) {
  const dependentTables = [
    "computation_log",
    "vp_iterations",
    "vp_sessions",
    "round1_team_drafts",
    "jinang_settlements",
    "member_submissions",
    "team_members"
  ];
  for (const table of dependentTables) {
    const column = table === "vp_sessions" ? "team_key" : "team_id";
    await runSql(`DELETE FROM ${table} WHERE ${column} = ${sqlQuote(teamId)};`).catch(() => {});
  }
  await runSql(`DELETE FROM teams WHERE id = ${sqlQuote(teamId)};`).catch(() => {});
}

async function main() {
  let teamId = "";
  try {
    const created = await TeamRoutes.createTeamApi({
      teamName: `round1_atomic_${Date.now()}`,
      teamSize: 1
    });
    assert.equal(created.status, 200);
    teamId = created.body.team.id;
    const memberId = created.body.team.members[0].id;

    const phase1 = await TeamRoutes.submitPhase1(teamId, memberId, {
      grid_id: "ToC_Differentiation_Elder",
      architecture: "Experience",
      who: "独居城市老人",
      pain: "日常缺少陪伴和安全守护",
      how: "机器人主动互动并在异常时通知家属"
    });
    assert.equal(phase1.status, 200);

    const submitted = await TeamRoutes.submitAndFinalizeRound1Vp({
      team_id: teamId,
      member_id: memberId,
      grid_id: "ToC_Differentiation_Elder",
      architecture: "Experience",
      accepted_feedback: true,
      who: "独居的城市老年人，子女不在身边，白天长期独自在家",
      pain: "一个人在家时缺少交流，身体异常时也无法及时通知家属",
      how: "机器人主动陪聊、按时提醒，并在检测到异常时立即通知家属"
    });
    assert.equal(submitted.status, 200);
    assert.equal(submitted.body.ok, true);
    assert.equal(submitted.body.finalized, true);
    assert.equal(submitted.body.result_ready, true);
    assert.equal(submitted.body.team_status, "phase4");
    assert.equal("scores" in submitted.body, false);
    assert.equal("vp_score" in submitted.body, false);

    const rows = await runSql(`
      SELECT status, final_grid_id, final_architecture, final_vp_text,
             final_vp_scores, final_sam, final_wtp_ref, final_wtp_adj
      FROM teams
      WHERE id = ${sqlQuote(teamId)}
      LIMIT 1;
    `);
    assert.equal(rows[0].status, "phase4");
    assert.equal(rows[0].final_grid_id, "ToC_Differentiation_Elder");
    assert.equal(rows[0].final_architecture, "Experience");
    assert.match(rows[0].final_vp_text, /独居的城市老年人/);
    assert(Number(rows[0].final_sam) > 0);
    assert(Number(rows[0].final_wtp_ref) > 0);
    assert(Number(rows[0].final_wtp_adj) > 0);

    const memberRows = await runSql(`
      SELECT vp_scores
      FROM team_members
      WHERE id = ${sqlQuote(memberId)}
      LIMIT 1;
    `);
    const teamScores = typeof rows[0].final_vp_scores === "string"
      ? JSON.parse(rows[0].final_vp_scores)
      : rows[0].final_vp_scores;
    const memberScores = typeof memberRows[0].vp_scores === "string"
      ? JSON.parse(memberRows[0].vp_scores)
      : memberRows[0].vp_scores;
    assert.equal(teamScores.C, memberScores.C);
    assert.equal(teamScores.G, memberScores.G);
    assert.equal(teamScores.E, memberScores.E);

    const phase4 = await TeamRoutes.phase4Data(teamId);
    assert.equal(phase4.status, 200);
    assert.equal(phase4.body.ok, true);
    assert.equal(phase4.body.team.final_vp_text, rows[0].final_vp_text);
  } finally {
    if (teamId) await cleanup(teamId);
    await shutdown();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
