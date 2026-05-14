const crypto = require("node:crypto");
const { runSql, sqlQuote } = require("../db/pgSql");

let initialized = false;

function nowIso() {
  return new Date().toISOString();
}

async function ensureSchema() {
  if (initialized) return;
  await runSql(`
    CREATE TABLE IF NOT EXISTS vp_iterations (
      id TEXT PRIMARY KEY,
      team_id TEXT NOT NULL,
      session_id TEXT,
      member_id TEXT,
      iteration INTEGER NOT NULL,
      trigger TEXT NOT NULL,
      speaker_name TEXT,
      speaker_persona TEXT,
      vp_before TEXT,
      vp_after TEXT,
      score_before DOUBLE PRECISION,
      score_after DOUBLE PRECISION,
      score_c DOUBLE PRECISION,
      score_g DOUBLE PRECISION,
      score_e DOUBLE PRECISION,
      source_iteration TEXT,
      used_best_iteration BOOLEAN DEFAULT FALSE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_vp_iterations_team_created
      ON vp_iterations(team_id, iteration, created_at);
  `);
  try {
    await runSql(`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_vp_iterations_team_iteration
        ON vp_iterations (team_id, iteration);
    `);
  } catch (err) {
    if (err.code === "23505" || /could not create unique index/i.test(String(err.message || ""))) {
      console.warn("[vpIterationStore.ensureSchema] dedup vp_iterations");
      await runSql(`
        DELETE FROM vp_iterations
        WHERE id NOT IN (
          SELECT DISTINCT ON (team_id, iteration) id
          FROM vp_iterations
          ORDER BY team_id, iteration, created_at ASC
        );
      `);
      await runSql(`
        CREATE UNIQUE INDEX IF NOT EXISTS uq_vp_iterations_team_iteration
          ON vp_iterations (team_id, iteration);
      `);
    } else {
      throw err;
    }
  }
  initialized = true;
}

function mapRow(row) {
  return {
    id: row.id,
    teamId: row.team_id,
    sessionId: row.session_id,
    memberId: row.member_id,
    iteration: Number(row.iteration || 0),
    trigger: row.trigger,
    speakerName: row.speaker_name || "",
    speakerPersona: row.speaker_persona || "",
    vpBefore: row.vp_before || "",
    vpAfter: row.vp_after || "",
    scoreBefore: row.score_before == null ? null : Number(row.score_before),
    scoreAfter: row.score_after == null ? null : Number(row.score_after),
    scoreC: row.score_c == null ? null : Number(row.score_c),
    scoreG: row.score_g == null ? null : Number(row.score_g),
    scoreE: row.score_e == null ? null : Number(row.score_e),
    sourceIteration: row.source_iteration || null,
    usedBestIteration: row.used_best_iteration === true,
    createdAt: row.created_at
  };
}

async function getLatestIteration(teamId) {
  await ensureSchema();
  const rows = await runSql(`
    SELECT *
    FROM vp_iterations
    WHERE team_id = ${sqlQuote(String(teamId || "").trim())}
    ORDER BY iteration DESC, created_at DESC
    LIMIT 1;
  `);
  return rows[0] ? mapRow(rows[0]) : null;
}

async function appendIteration(entry) {
  await ensureSchema();
  const teamId = String(entry?.teamId || "").trim();
  if (!teamId) throw new Error("teamId required");
  const MAX_ATTEMPTS = 5;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    const latest = await getLatestIteration(teamId);
    const vpAfter = String(entry?.vpAfter || "").trim();
    const nextScoreAfter = entry?.scoreAfter == null ? null : Number(entry.scoreAfter);
    if (
      latest &&
      latest.trigger === String(entry?.trigger || "").trim() &&
      String(latest.vpAfter || "").trim() === vpAfter &&
      (
        (latest.scoreAfter == null && nextScoreAfter == null) ||
        (Number.isFinite(latest.scoreAfter) && Number.isFinite(nextScoreAfter) && latest.scoreAfter === nextScoreAfter)
      )
    ) {
      return latest;
    }

    const row = {
      id: crypto.randomUUID(),
      teamId,
      sessionId: String(entry?.sessionId || "").trim() || null,
      memberId: String(entry?.memberId || "").trim() || null,
      iteration: Number((latest?.iteration || 0) + 1),
      trigger: String(entry?.trigger || "").trim() || "unknown",
      speakerName: String(entry?.speakerName || "").trim() || null,
      speakerPersona: String(entry?.speakerPersona || "").trim() || null,
      vpBefore: String(entry?.vpBefore || latest?.vpAfter || "").trim() || null,
      vpAfter: vpAfter || null,
      scoreBefore: entry?.scoreBefore == null ? latest?.scoreAfter ?? null : Number(entry.scoreBefore),
      scoreAfter: nextScoreAfter,
      scoreC: entry?.scoreC == null ? null : Number(entry.scoreC),
      scoreG: entry?.scoreG == null ? null : Number(entry.scoreG),
      scoreE: entry?.scoreE == null ? null : Number(entry.scoreE),
      sourceIteration: String(entry?.sourceIteration || "").trim() || null,
      usedBestIteration: entry?.usedBestIteration === true,
      createdAt: nowIso()
    };

    try {
      await runSql(`
        INSERT INTO vp_iterations (
          id, team_id, session_id, member_id, iteration, trigger, speaker_name, speaker_persona,
          vp_before, vp_after, score_before, score_after, score_c, score_g, score_e,
          source_iteration, used_best_iteration, created_at
        ) VALUES (
          ${sqlQuote(row.id)},
          ${sqlQuote(row.teamId)},
          ${sqlQuote(row.sessionId)},
          ${sqlQuote(row.memberId)},
          ${row.iteration},
          ${sqlQuote(row.trigger)},
          ${sqlQuote(row.speakerName)},
          ${sqlQuote(row.speakerPersona)},
          ${sqlQuote(row.vpBefore)},
          ${sqlQuote(row.vpAfter)},
          ${row.scoreBefore == null ? "NULL" : Number(row.scoreBefore)},
          ${row.scoreAfter == null ? "NULL" : Number(row.scoreAfter)},
          ${row.scoreC == null ? "NULL" : Number(row.scoreC)},
          ${row.scoreG == null ? "NULL" : Number(row.scoreG)},
          ${row.scoreE == null ? "NULL" : Number(row.scoreE)},
          ${sqlQuote(row.sourceIteration)},
          ${row.usedBestIteration ? "TRUE" : "FALSE"},
          ${sqlQuote(row.createdAt)}
        );
      `);
      return row;
    } catch (err) {
      if (err.code === "23505" && attempt < MAX_ATTEMPTS - 1) {
        continue;
      }
      throw err;
    }
  }

  throw new Error(`appendIteration: exceeded ${MAX_ATTEMPTS} retries for team ${teamId}`);
}

async function listTeamIterations(teamId) {
  await ensureSchema();
  const rows = await runSql(`
    SELECT *
    FROM vp_iterations
    WHERE team_id = ${sqlQuote(String(teamId || "").trim())}
    ORDER BY iteration ASC, created_at ASC;
  `);
  return rows.map(mapRow);
}

module.exports = {
  ensureSchema,
  getLatestIteration,
  appendIteration,
  listTeamIterations
};
