const assert = require("node:assert/strict");

const { runSql, sqlQuote } = require("../server/db/pgSql");
const TeamRoutes = require("../server/routes/teamRoutes");
const Round2 = require("../server/routes/round2Routes");
const SessionConfig = require("../server/multiplayer/sessionConfig");
const { computeProductMarketMatch } = require("../server/llm/rdCalculator");
const v4Priors = require("../data/grid_priors_v4_cap_weights.json");

const TEAM_SIZE = 1;
const SESSION_ID = "default";
const VP_TEXT = [
  "WHO: 独居白领",
  "PAIN: 下班回家后很孤独，想要有人陪着说说话",
  "HOW: 通过稳定陪伴、主动互动和情绪回应缓解独处时的低落",
  "BOUNDARY: 不适用于需要专业心理干预的危机人群"
].join("\n");
const FINALIZE_BODY = {
  grid_id: "B2C_Differentiation_Adult",
  architecture: "Experience",
  vp_text: VP_TEXT,
  confirmed_fields: {
    who: "独居白领",
    pain: "下班回家后很孤独，想要有人陪着说说话",
    how: "通过稳定陪伴、主动互动和情绪回应缓解独处时的低落",
    boundary: "不适用于需要专业心理干预的危机人群"
  },
  scores: {
    coverage: 4.2,
    generalizability: 4.3,
    effectiveness: 4.1
  }
};
const FINAL_SELECTIONS = [
  { cap_id: "voice_basic", tier: "high" },
  { cap_id: "persona_dialog", tier: "high" },
  { cap_id: "perception_base", tier: "low" },
  { cap_id: "basic_avoidance", tier: "low" },
  { cap_id: "privacy_trust", tier: "low" },
  { cap_id: "cloud_update", tier: "low" },
  { cap_id: "self_diag", tier: "low" }
];
const SPOOFED_GRID = "B2B_Cost_Child";

function buildCardScoresForFixture(selections) {
  const dimByCap = {
    voice_basic: "interaction",
    persona_dialog: "interaction",
    perception_base: "perception",
    basic_avoidance: "motion",
    privacy_trust: "safety",
    cloud_update: "extend",
    self_diag: "ops"
  };
  const tierStep = { low: 1, mid: 2, high: 3 };
  const totals = {
    interaction: 0,
    perception: 0,
    motion: 0,
    safety: 0,
    extend: 0,
    ops: 0
  };
  for (const item of selections) {
    totals[dimByCap[item.cap_id]] += tierStep[item.tier];
  }
  return {
    interaction: Math.min(9, 4 + totals.interaction),
    perception: Math.min(9, 4 + totals.perception),
    motion: Math.min(9, 4 + totals.motion),
    safety: Math.min(9, 4 + totals.safety),
    extend: Math.min(9, 4 + totals.extend),
    ops: Math.min(9, 4 + totals.ops)
  };
}

function toMatchScores(cardScores) {
  return {
    interaction: Number(cardScores.interaction || 0),
    perception: Number(cardScores.perception || 0),
    mobility: Number(cardScores.motion || 0),
    safety_privacy: Number(cardScores.safety || 0),
    integration: Number(cardScores.extend || 0),
    operations: Number(cardScores.ops || 0)
  };
}

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

async function main() {
  const expectedCardScores = buildCardScoresForFixture(FINAL_SELECTIONS);
  const expectedMatch = computeProductMarketMatch(toMatchScores(expectedCardScores), v4Priors);
  const configBefore = await SessionConfig.getSessionConfig(SESSION_ID);
  const hadConfigRow = await runSql(`
    SELECT COUNT(*)::int AS c
    FROM session_config
    WHERE session_id = ${sqlQuote(SESSION_ID)};
  `).then((rows) => Number(rows[0]?.c || 0) > 0).catch(() => false);

  let teamId = "";
  let memberId = "";
  const originalWarn = console.warn;
  const warnLines = [];
  console.warn = (...args) => {
    warnLines.push(args.map((item) => String(item)).join(" "));
  };

  try {
    const createRes = await TeamRoutes.createTeamApi({
      teamName: `recap5_${Date.now()}`,
      teamSize: TEAM_SIZE
    });
    assert.equal(createRes.status, 200);
    teamId = createRes.body.team.id;
    memberId = createRes.body.team.members[0].id;

    const phase1Res = await TeamRoutes.submitPhase1(teamId, memberId, {
      grid_id: "B2C_Differentiation_Adult",
      architecture: "Experience",
      who: "独居白领",
      pain: "下班回家后很孤独，想要有人陪着说说话",
      how: "通过稳定陪伴、主动互动和情绪回应缓解独处时的低落"
    });
    assert.equal(phase1Res.status, 200);

    const finalizeRes = await TeamRoutes.finalizePhase3(teamId, {
      ...FINALIZE_BODY,
      member_id: memberId
    });
    assert.equal(finalizeRes.status, 200);
    assert.equal(finalizeRes.body.ok, true);

    const finalRows = await runSql(`
      SELECT final_grid_id, final_sam, final_wtp_adj, final_wtp_ref
      FROM teams
      WHERE id = ${sqlQuote(teamId)}
      LIMIT 1;
    `);
    assert.equal(finalRows.length, 1);
    assert.equal(finalRows[0].final_grid_id, "B2C_Differentiation_Adult");
    assert(Number(finalRows[0].final_sam) > 0, "final_sam should be written by the natural R1 flow");
    assert(Number(finalRows[0].final_wtp_adj) > 0, "final_wtp_adj should be written by the natural R1 flow");
    assert(Number(finalRows[0].final_wtp_ref) > 0, "final_wtp_ref should be written by the natural R1 flow");

    await SessionConfig.updateSessionConfig(SESSION_ID, {
      reveal_r1_results: false,
      hold_before_r2: false,
      interview_mode: "summary"
    });

    const freezeRes = await TeamRoutes.freezeTeam(teamId, { member_id: memberId });
    assert.equal(freezeRes.status, 200);
    assert.equal(freezeRes.body.r2_status, "R2_INTERVIEWING");

    const assignRes = await Round2.assignDimensionsApi({
      teamId,
      session_id: SESSION_ID,
      memberCount: TEAM_SIZE
    });
    assert.equal(assignRes.status, 200);
    assert(Array.isArray(assignRes.body.available_reports), "summary mode should return available reports");
    assert(Number.isInteger(Number(assignRes.body.default_report_index)), "summary mode should return default report index");

    const readReportRes = await Round2.personaReportByIndexApi(
      { reportIndex: assignRes.body.default_report_index },
      {
        teamId,
        memberId,
        session_id: SESSION_ID
      }
    );
    assert.equal(readReportRes.status, 200);
    assert.equal(readReportRes.body.report.report_index, assignRes.body.default_report_index);
    assert.equal("covered_keywords" in readReportRes.body.report, false);
    assert.equal("uncovered_keywords" in readReportRes.body.report, false);

    const readingStatusRes = await Round2.teamReadingStatusApi({
      teamId,
      memberId,
      session_id: SESSION_ID
    });
    assert.equal(readingStatusRes.status, 200);
    assert.equal(readingStatusRes.body.team_viewed_count, 1);
    assert.deepEqual(readingStatusRes.body.my_viewed, readingStatusRes.body.my_viewed_personas);
    assert(Array.isArray(readingStatusRes.body.members), "reading status should include per-member details");
    assert.equal("coverage_ratio" in readingStatusRes.body, false);

    const completeReadingRes = await Round2.completeSummaryReadingApi({
      teamId,
      memberId,
      session_id: SESSION_ID
    });
    assert.equal(completeReadingRes.status, 200);
    assert.equal(completeReadingRes.body.my_reading_status, "completed");

    const selectRes = await Round2.selectPersonaArchetypeApi({
      teamId,
      memberId,
      session_id: SESSION_ID
    });
    assert.equal(selectRes.status, 200);
    assert.equal("evi" in selectRes.body.choice, false);
    assert.equal("tags" in selectRes.body.choice, false);
    assert.equal("radar" in selectRes.body.choice, false);
    assert.equal("coverage_ratio" in selectRes.body.choice, false);

    const frozenChoice = await Round2.__test.readPersonaChoice(teamId, SESSION_ID);
    assert.ok(frozenChoice);
    assert.equal(Array.isArray(frozenChoice.reports_viewed), true);
    assert.equal(frozenChoice.reports_viewed.length, 1);
    assert(Number(frozenChoice.coverage_ratio) > 0, "coverage ratio should be frozen after reading");
    assert.equal(Number(frozenChoice.evi) > 0, true);

    const alternativeReport = (assignRes.body.available_reports || []).find((item) => {
      return Number(item?.report_index) !== Number(assignRes.body.default_report_index);
    });
    if (alternativeReport) {
      const lateReadRes = await Round2.personaReportByIndexApi(
        { reportIndex: alternativeReport.report_index },
        {
          teamId,
          memberId,
          session_id: SESSION_ID
        }
      );
      assert.equal(lateReadRes.status, 200);
      const frozenChoiceAfterLateRead = await Round2.__test.readPersonaChoice(teamId, SESSION_ID);
      assert.equal(frozenChoiceAfterLateRead.coverage_ratio, frozenChoice.coverage_ratio);
      assert.equal(frozenChoiceAfterLateRead.evi, frozenChoice.evi);
      assert.deepEqual(frozenChoiceAfterLateRead.reports_viewed, frozenChoice.reports_viewed);
    }

    const memberSelectionRes = await Round2.saveMemberSelectionApi({
      teamId,
      memberId,
      selections: FINAL_SELECTIONS
    });
    assert.equal(memberSelectionRes.status, 200);

    const mergeRes = await Round2.mergeApi({
      teamId,
      memberId,
      COGSbase: 600
    });
    assert.equal(mergeRes.status, 200);
    assert.equal("evi" in mergeRes.body.mergedInterview, false);
    assert.equal("tags" in mergeRes.body.mergedInterview, false);
    assert.equal("radar" in mergeRes.body.mergedInterview, false);
    assert.equal("sourceByDim" in mergeRes.body.mergedInterview, false);
    assert.equal("scoreSource" in mergeRes.body.mergedInterview, false);
    assert.equal("insightsByDim" in mergeRes.body.mergedInterview, false);
    assert.equal("lowConfidenceDims" in mergeRes.body.mergedInterview, false);
    assert.equal("dimensionEvidence" in mergeRes.body.mergedInterview, false);

    const draftRes = await Round2.saveTeamDraftApi({
      teamId,
      memberId,
      price: 4000,
      selections: FINAL_SELECTIONS
    });
    assert.equal(draftRes.status, 200);

    const submitRes = await Round2.teamSubmitApi({
      team_id: teamId,
      member_id: memberId,
      session_id: SESSION_ID,
      price: 4000,
      selections: FINAL_SELECTIONS,
      best_grid: SPOOFED_GRID,
      evi: 0.01,
      mergedInterview: {
        ...mergeRes.body.mergedInterview,
        evi: 0.02
      }
    });
    assert.equal(submitRes.status, 200);
    assert.equal(submitRes.body.result.best_grid, expectedMatch.bestGrid);
    assert.deepEqual(submitRes.body.result.result.card_scores, expectedCardScores);
    assert.equal(Boolean(submitRes.body.radar?.radar), false);
    assert(warnLines.some((line) => line.includes("client best_grid ignored")), "spoofed best_grid should be logged and ignored");
    assert(warnLines.some((line) => line.includes("EVIOverrideIgnored")), "spoofed summary evi should be logged and ignored");

    const resultRows = await runSql(`
      SELECT r.best_grid, r.matched_grid, r.match_score_json, r.result_json, radar.evi
      FROM round2_results r
      LEFT JOIN fg_team_radar radar
        ON radar.team_id = r.team_id AND radar.session_id = r.session_id
      WHERE r.team_id = ${sqlQuote(teamId)} AND r.session_id = ${sqlQuote(SESSION_ID)}
      LIMIT 1;
    `);
    assert.equal(resultRows.length, 1);
    assert.equal(resultRows[0].best_grid, expectedMatch.bestGrid);
    assert.equal(resultRows[0].matched_grid, expectedMatch.bestGrid);
    assert.equal(Number(resultRows[0].evi), Number(frozenChoice.evi));
    const storedResult = JSON.parse(resultRows[0].result_json || "{}");
    assert.equal(Number(storedResult.evi), Number(frozenChoice.evi));
    const matchScores = JSON.parse(resultRows[0].match_score_json || "{}");
    assert.equal(matchScores[expectedMatch.bestGrid], expectedMatch.allMatches[expectedMatch.bestGrid]);

    const recapRes = await Round2.recap({ teamId });
    assert.equal(recapRes.status, 200);
    assert.equal(recapRes.body.ok, true);
    assert.equal(recapRes.body.matched_grid, expectedMatch.bestGrid);
    assert(Number(recapRes.body.round1_sam) > 0, "round1_sam should be present in recap");
    assert(Number(recapRes.body.round1_wtp_adj) > 0, "round1_wtp_adj should be present in recap");
    assert(Number(recapRes.body.matched_grid_sam) > 0, "matched_grid_sam should be present in recap");
    assert(Number(recapRes.body.matched_grid_wtp_ref) > 0, "matched_grid_wtp_ref should be present in recap");
    const recapJson = JSON.stringify(recapRes.body);
    assert.equal(/target_gm_band|target_gm_tier|target_gm_label/.test(recapJson), false);

    console.log("round2_recap_rework_5.integration.test.js passed");
  } finally {
    console.warn = originalWarn;
    if (teamId) {
      await cleanupTeam(teamId);
    }
    if (hadConfigRow) {
      await SessionConfig.updateSessionConfig(SESSION_ID, configBefore);
    } else {
      await runSql(`DELETE FROM session_config WHERE session_id = ${sqlQuote(SESSION_ID)};`).catch(() => {});
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
