const { runSql, sqlQuote } = require("../db/pgSql");

let __marketingSessionsSchemaPromise = null;

async function ensureTable() {
  if (__marketingSessionsSchemaPromise) return __marketingSessionsSchemaPromise;
  __marketingSessionsSchemaPromise = (async () => {
    await runSql(`
      CREATE TABLE IF NOT EXISTS marketing_sessions (
        session_id TEXT PRIMARY KEY,
        team_key TEXT,
        strategy JSONB,
        vp_canvas JSONB,
        persona JSONB,
        messages JSONB DEFAULT '[]'::jsonb,
        tags JSONB DEFAULT '[]'::jsonb,
        dimensions JSONB DEFAULT '{}'::jsonb,
        status TEXT DEFAULT 'active',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_marketing_sessions_team_key ON marketing_sessions(team_key);
    `);
  })();
  try {
    await __marketingSessionsSchemaPromise;
  } catch (err) {
    __marketingSessionsSchemaPromise = null;
    throw err;
  }
  return __marketingSessionsSchemaPromise;
}

function parseMaybeJson(value, fallback) {
  if (value === null || value === undefined) return fallback;
  if (typeof value === "string") {
    try {
      return JSON.parse(value);
    } catch (_) {
      return fallback;
    }
  }
  return value;
}

function mapSession(row) {
  const dimensions = parseMaybeJson(row.dimensions, {}) || {};
  const inferredMemberId = String(row.session_id || "").split("_")[1] || null;
  return {
    sessionId: row.session_id,
    teamKey: row.team_key,
    memberId: dimensions.memberId || inferredMemberId,
    strategy: parseMaybeJson(row.strategy, {}),
    vpCanvas: parseMaybeJson(row.vp_canvas, null),
    persona: parseMaybeJson(row.persona, null),
    messages: parseMaybeJson(row.messages, []),
    requirements: dimensions.requirements || null,
    requirementSpec: dimensions.requirementSpec || null,
    tags: parseMaybeJson(row.tags, []),
    dimensionScores: dimensions.scores || null,
    anchorVersion: dimensions.anchorVersion || null,
    summary: dimensions.summary || null,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

async function createMarketingSession(teamKey, memberId, strategy, vpCanvas, persona) {
  // Backward compatibility with old signature:
  // createMarketingSession(teamKey, strategy, vpCanvas, persona)
  if (persona === undefined && memberId && typeof memberId === "object") {
    persona = vpCanvas;
    vpCanvas = strategy;
    strategy = memberId;
    memberId = "member-1";
  }

  const normalizedMemberId = String(memberId || "member-1").trim() || "member-1";
  const normalizedTeamKey = String(teamKey || "").trim();

  await ensureTable();
  const sessionId = `${normalizedTeamKey}_${normalizedMemberId}_${Date.now()}`;
  const now = new Date().toISOString();
  await runSql(`
    INSERT INTO marketing_sessions (
      session_id, team_key, strategy, vp_canvas, persona, messages, tags, dimensions, status, created_at, updated_at
    ) VALUES (
      ${sqlQuote(sessionId)},
      ${sqlQuote(normalizedTeamKey)},
      ${sqlQuote(JSON.stringify(strategy || {}))}::jsonb,
      ${sqlQuote(JSON.stringify(vpCanvas || null))}::jsonb,
      ${sqlQuote(JSON.stringify(persona || null))}::jsonb,
      '[]'::jsonb,
      '[]'::jsonb,
      ${sqlQuote(JSON.stringify({ memberId: normalizedMemberId, summary: null }))}::jsonb,
      'interviewing',
      ${sqlQuote(now)},
      ${sqlQuote(now)}
    );
  `);
  return sessionId;
}

async function appendMessage(sessionId, role, content, meta = {}) {
  await ensureTable();
  const now = new Date().toISOString();
  await runSql(`
    UPDATE marketing_sessions
    SET messages = COALESCE(messages, '[]'::jsonb) || ${sqlQuote(JSON.stringify([{ role, content, meta, timestamp: now }]))}::jsonb,
        updated_at = ${sqlQuote(now)}
    WHERE session_id = ${sqlQuote(sessionId)};
  `);
}

async function getSession(sessionId) {
  await ensureTable();
  const rows = await runSql(`
    SELECT * FROM marketing_sessions WHERE session_id = ${sqlQuote(sessionId)} LIMIT 1;
  `);
  if (!rows[0]) return null;
  return mapSession(rows[0]);
}

async function updateSession(sessionId, patch) {
  await ensureTable();
  const now = new Date().toISOString();
  const sets = [`updated_at = ${sqlQuote(now)}`];
  if (patch.status !== undefined) sets.push(`status = ${sqlQuote(patch.status)}`);
  if (patch.strategy !== undefined) sets.push(`strategy = ${sqlQuote(JSON.stringify(patch.strategy))}::jsonb`);
  if (patch.vpCanvas !== undefined) sets.push(`vp_canvas = ${sqlQuote(JSON.stringify(patch.vpCanvas))}::jsonb`);
  if (patch.persona !== undefined) sets.push(`persona = ${sqlQuote(JSON.stringify(patch.persona))}::jsonb`);
  if (patch.messages !== undefined) sets.push(`messages = ${sqlQuote(JSON.stringify(patch.messages))}::jsonb`);
  if (patch.tags !== undefined) sets.push(`tags = ${sqlQuote(JSON.stringify(patch.tags))}::jsonb`);

  const dimensionPatch = {};
  if (patch.dimensionScores !== undefined) dimensionPatch.scores = patch.dimensionScores;
  if (patch.anchorVersion !== undefined) dimensionPatch.anchorVersion = patch.anchorVersion;
  if (patch.requirements !== undefined) dimensionPatch.requirements = patch.requirements;
  if (patch.requirementSpec !== undefined) dimensionPatch.requirementSpec = patch.requirementSpec;
  if (patch.memberId !== undefined) dimensionPatch.memberId = patch.memberId;
  if (patch.summary !== undefined) dimensionPatch.summary = patch.summary;
  if (Object.keys(dimensionPatch).length > 0) {
    sets.push(`dimensions = COALESCE(dimensions, '{}'::jsonb) || ${sqlQuote(JSON.stringify(dimensionPatch))}::jsonb`);
  }

  await runSql(`
    UPDATE marketing_sessions SET ${sets.join(", ")} WHERE session_id = ${sqlQuote(sessionId)};
  `);
  return getSession(sessionId);
}

async function getTeamSessions(teamKey) {
  await ensureTable();
  const rows = await runSql(`
    SELECT * FROM marketing_sessions WHERE team_key = ${sqlQuote(teamKey)} ORDER BY created_at ASC;
  `);
  return rows.map(mapSession);
}

async function getCompletedSessions(teamKey) {
  const all = await getTeamSessions(teamKey);
  return all.filter((s) => s.status === "completed");
}

module.exports = {
  ensureSchema: ensureTable,
  createMarketingSession,
  appendMessage,
  getSession,
  updateSession,
  getTeamSessions,
  getCompletedSessions
};
