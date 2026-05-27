const crypto = require("node:crypto");
const { runSql, sqlQuote } = require("../db/pgSql");

let __sessionsSchemaPromise = null;

async function ensureTable() {
  if (__sessionsSchemaPromise) return __sessionsSchemaPromise;
  __sessionsSchemaPromise = (async () => {
    await runSql(`
      CREATE TABLE IF NOT EXISTS vp_sessions (
        session_id TEXT PRIMARY KEY,
        team_key TEXT NOT NULL,
        strategy JSONB DEFAULT '{}'::jsonb,
        messages JSONB DEFAULT '[]'::jsonb,
        vp_canvas TEXT,
        pmf_score JSONB,
        status TEXT DEFAULT 'chatting',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_vp_sessions_team_key ON vp_sessions(team_key);
    `);
  })();
  try {
    await __sessionsSchemaPromise;
  } catch (err) {
    __sessionsSchemaPromise = null;
    throw err;
  }
  return __sessionsSchemaPromise;
}

async function createVpSession(teamKey, strategy) {
  await ensureTable();
  const sessionId = crypto.randomUUID();
  const now = new Date().toISOString();
  await runSql(`
    INSERT INTO vp_sessions (
      session_id, team_key, strategy, messages, vp_canvas, pmf_score, status, created_at, updated_at
    ) VALUES (
      ${sqlQuote(sessionId)},
      ${sqlQuote(teamKey)},
      ${sqlQuote(JSON.stringify(strategy || {}))}::jsonb,
      '[]'::jsonb,
      NULL, NULL,
      'chatting',
      ${sqlQuote(now)},
      ${sqlQuote(now)}
    );
  `);
  return sessionId;
}

async function appendMessage(sessionId, role, content) {
  await ensureTable();
  const now = new Date().toISOString();
  await runSql(`
    UPDATE vp_sessions
    SET messages = COALESCE(messages, '[]'::jsonb) || ${sqlQuote(JSON.stringify([{ role, content, timestamp: now }]))}::jsonb,
        updated_at = ${sqlQuote(now)}
    WHERE session_id = ${sqlQuote(sessionId)};
  `);
}

function mapSessionRow(row) {
  const parseMaybe = (v, fallback) => {
    if (v === null || v === undefined) return fallback;
    if (typeof v === "string") {
      try {
        return JSON.parse(v);
      } catch (_) {
        return fallback;
      }
    }
    return v;
  };
  return {
    sessionId: row.session_id,
    teamKey: row.team_key,
    strategy: parseMaybe(row.strategy, {}),
    messages: parseMaybe(row.messages, []),
    vpCanvas: row.vp_canvas,
    pmfScore: parseMaybe(row.pmf_score, null),
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

async function getSession(sessionId) {
  await ensureTable();
  const rows = await runSql(`
    SELECT * FROM vp_sessions WHERE session_id = ${sqlQuote(sessionId)} LIMIT 1;
  `);
  if (!rows[0]) return null;
  return mapSessionRow(rows[0]);
}

async function updateSession(sessionId, patch) {
  await ensureTable();
  const now = new Date().toISOString();
  const sets = [`updated_at = ${sqlQuote(now)}`];
  if (patch.vpCanvas !== undefined) sets.push(`vp_canvas = ${sqlQuote(patch.vpCanvas)}`);
  if (patch.pmfScore !== undefined) {
    sets.push(`pmf_score = ${patch.pmfScore === null ? "NULL" : `${sqlQuote(JSON.stringify(patch.pmfScore))}::jsonb`}`);
  }
  if (patch.status !== undefined) sets.push(`status = ${sqlQuote(patch.status)}`);
  if (patch.messages !== undefined) sets.push(`messages = ${sqlQuote(JSON.stringify(patch.messages))}::jsonb`);
  if (patch.strategy !== undefined) sets.push(`strategy = ${sqlQuote(JSON.stringify(patch.strategy))}::jsonb`);
  await runSql(`UPDATE vp_sessions SET ${sets.join(", ")} WHERE session_id = ${sqlQuote(sessionId)};`);
  return getSession(sessionId);
}

async function getTeamSessions(teamKey) {
  await ensureTable();
  const rows = await runSql(`
    SELECT * FROM vp_sessions WHERE team_key = ${sqlQuote(teamKey)} ORDER BY created_at ASC;
  `);
  return rows.map(mapSessionRow);
}

module.exports = {
  ensureSchema: ensureTable,
  createVpSession,
  appendMessage,
  getSession,
  updateSession,
  getTeamSessions
};
