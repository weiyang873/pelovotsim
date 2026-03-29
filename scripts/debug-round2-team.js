const { runSql, shutdown, sqlQuote } = require("../server/db/pgSql");

async function main() {
  const teamId = String(process.argv[2] || "").trim();
  if (!teamId) {
    throw new Error("Usage: node scripts/debug-round2-team.js <teamId>");
  }

  const queries = [
    [
      "TEAM",
      `
        SELECT id, team_name, final_grid_id, final_architecture, created_at
        FROM teams
        WHERE id = ${sqlQuote(teamId)};
      `
    ],
    [
      "MEMBERS",
      `
        SELECT id, team_id, member_name, member_index, joined_at,
               interview_status, interview_rounds,
               card_status, cards_selected, current_step
        FROM team_members
        WHERE team_id = ${sqlQuote(teamId)}
        ORDER BY member_index ASC;
      `
    ],
    [
      "ASSIGNMENTS",
      `
        SELECT assignments_json, updated_at
        FROM round2_dimension_assignments
        WHERE team_id = ${sqlQuote(teamId)};
      `
    ],
    [
      "SESSIONS",
      `
        SELECT session_id, member_id, round_no, is_complete, updated_at, result_json
        FROM round2_interview_sessions
        WHERE team_id = ${sqlQuote(teamId)}
        ORDER BY updated_at DESC;
      `
    ],
    [
      "SELECTIONS",
      `
        SELECT member_id, selections_json, updated_at
        FROM round2_member_selections
        WHERE team_id = ${sqlQuote(teamId)}
        ORDER BY updated_at DESC;
      `
    ],
    [
      "SUBMISSIONS",
      `
        SELECT team_id, session_id, price, card_count, selections_json, cards_json, dcogs, risk_total
        FROM round2_submissions
        WHERE team_id = ${sqlQuote(teamId)};
      `
    ],
    [
      "RADAR",
      `
        SELECT team_id, session_id, radar_json, tags_json, evi, updated_at
        FROM fg_team_radar
        WHERE team_id = ${sqlQuote(teamId)};
      `
    ],
    [
      "RESULTS",
      `
        SELECT team_id, session_id, units, profit, profit_per_unit, vscore, best_grid, result_json, computed_at
        FROM round2_results
        WHERE team_id = ${sqlQuote(teamId)};
      `
    ]
  ];

  for (const [label, sql] of queries) {
    const rows = await runSql(sql);
    console.log(`--- ${label} ---`);
    console.log(JSON.stringify(rows, null, 2));
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    try {
      await shutdown();
    } catch (_) {}
  });
