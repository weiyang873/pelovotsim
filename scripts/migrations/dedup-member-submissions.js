#!/usr/bin/env node
const { runSql, sqlQuote, shutdown } = require("../../server/db/pgSql");

async function main() {
  const duplicates = await runSql(`
    SELECT team_id, member_id, COUNT(*)::int AS duplicate_count
    FROM member_submissions
    GROUP BY team_id, member_id
    HAVING COUNT(*) > 1
    ORDER BY team_id, member_id;
  `);

  if (!duplicates.length) {
    console.log("No duplicate member_submissions rows found.");
    return;
  }

  let deletedTotal = 0;
  console.log(`Found ${duplicates.length} duplicate (team_id, member_id) group(s).`);

  for (const row of duplicates) {
    const teamId = String(row.team_id || "");
    const memberId = String(row.member_id || "");
    const rows = await runSql(`
      SELECT id, submitted_at
      FROM member_submissions
      WHERE team_id = ${sqlQuote(teamId)}
        AND member_id = ${sqlQuote(memberId)}
      ORDER BY submitted_at ASC NULLS LAST, id ASC;
    `);
    if (rows.length <= 1) continue;
    const keepId = rows[0].id;
    const dropIds = rows.slice(1).map((item) => item.id);
    deletedTotal += dropIds.length;
    console.log(`Keeping ${keepId} for team=${teamId} member=${memberId}; deleting ${dropIds.length} duplicate(s).`);
    await runSql(`
      DELETE FROM member_submissions
      WHERE team_id = ${sqlQuote(teamId)}
        AND member_id = ${sqlQuote(memberId)}
        AND id <> ${sqlQuote(keepId)};
    `);
  }

  console.log(`Dedup complete. Deleted ${deletedTotal} row(s).`);
}

main()
  .then(async () => {
    await shutdown();
    process.exit(0);
  })
  .catch(async (err) => {
    console.error(err);
    await shutdown().catch(() => {});
    process.exit(1);
  });
