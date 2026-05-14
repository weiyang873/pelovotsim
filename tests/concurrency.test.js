const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

function loadLocalEnvFile() {
  const envPath = path.join(__dirname, "..", ".env");
  if (!fs.existsSync(envPath)) return;
  const content = fs.readFileSync(envPath, "utf8");
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith("\"") && value.endsWith("\"")) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!Object.prototype.hasOwnProperty.call(process.env, key)) {
      process.env[key] = value;
    }
  }
}

loadLocalEnvFile();

const { runSql, sqlQuote } = require("../server/db/pgSql");
const TeamManager = require("../server/multiplayer/teamManager");
const { appendIteration, listTeamIterations } = require("../server/multiplayer/vpIterationStore");
const TeamRoutes = require("../server/routes/teamRoutes");

function uniqueName(prefix) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

async function createTestTeam(size = 1) {
  await TeamManager.ensureSchema();
  const team = await TeamManager.createTeam(uniqueName("codex_team"), size);
  return TeamManager.getTeam(team.id);
}

test("R2: concurrent submitPhase1 produces exactly one row", { concurrency: false }, async () => {
  const team = await createTestTeam(1);
  const memberId = team.members[0].id;
  const payload = {
    grid_id: "ToC_Differentiation_Adult",
    architecture: "Experience",
    who: "独居白领",
    pain: "下班回家后很孤独",
    how: "通过陪伴互动缓解独处时的情绪低落"
  };

  const results = await Promise.all(
    Array.from({ length: 5 }, () => TeamRoutes.submitPhase1(team.id, memberId, payload))
  );

  assert.equal(results.every((item) => item.status === 200 && item.body?.ok === true), true);
  const submissionIds = new Set(results.map((item) => item.body.submission_id));
  assert.equal(submissionIds.size, 1);

  const rows = await runSql(`
    SELECT COUNT(*)::int AS c
    FROM member_submissions
    WHERE team_id = ${sqlQuote(team.id)}
      AND member_id = ${sqlQuote(memberId)};
  `);
  assert.equal(Number(rows[0]?.c || 0), 1);
});

test("R3: concurrent appendIteration produces strict sequence", { concurrency: false }, async () => {
  const team = await createTestTeam(1);

  await Promise.all(
    Array.from({ length: 5 }, (_, index) => appendIteration({
      teamId: team.id,
      trigger: `manual-${index}`,
      vpAfter: `vp-after-${index}`,
      scoreAfter: 3 + index * 0.1
    }))
  );

  const rows = await listTeamIterations(team.id);
  assert.deepEqual(rows.map((row) => row.iteration), [1, 2, 3, 4, 5]);
  assert.equal(new Set(rows.map((row) => row.iteration)).size, 5);
});
