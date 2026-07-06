const { runSql, sqlQuote } = require("../db/pgSql");

const DEFAULT_SESSION_CONFIG = {
  reveal_r1_results: false,
  hold_before_r2: false,
  interview_mode: "summary"
};

async function ensureSessionConfigSchema() {
  await runSql(`
    CREATE TABLE IF NOT EXISTS session_config (
      session_id TEXT PRIMARY KEY,
      config JSONB NOT NULL DEFAULT '{}'::jsonb,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
}

function normalizeSessionId(value) {
  const raw = String(value || "").trim();
  return raw || "default";
}

function normalizeSessionConfig(input) {
  const src = input && typeof input === "object" ? input : {};
  return {
    reveal_r1_results: src.reveal_r1_results === true,
    hold_before_r2: src.hold_before_r2 === true,
    interview_mode: String(src.interview_mode || DEFAULT_SESSION_CONFIG.interview_mode).trim().toLowerCase() === "live"
      ? "live"
      : "summary"
  };
}

async function getSessionConfig(sessionId = "default") {
  await ensureSessionConfigSchema();
  const normalizedSessionId = normalizeSessionId(sessionId);
  const rows = await runSql(`
    SELECT config
    FROM session_config
    WHERE session_id = ${sqlQuote(normalizedSessionId)}
    LIMIT 1;
  `);
  const raw = rows[0]?.config && typeof rows[0].config === "object"
    ? rows[0].config
    : (() => {
        try {
          return JSON.parse(rows[0]?.config || "{}");
        } catch (_) {
          return {};
        }
      })();
  return normalizeSessionConfig({
    ...DEFAULT_SESSION_CONFIG,
    ...(raw || {})
  });
}

async function updateSessionConfig(sessionId = "default", patch = {}) {
  await ensureSessionConfigSchema();
  const normalizedSessionId = normalizeSessionId(sessionId);
  const current = await getSessionConfig(normalizedSessionId);
  const next = normalizeSessionConfig({
    ...current,
    ...(patch || {})
  });
  await runSql(`
    INSERT INTO session_config (session_id, config, updated_at)
    VALUES (
      ${sqlQuote(normalizedSessionId)},
      ${sqlQuote(JSON.stringify(next))}::jsonb,
      NOW()
    )
    ON CONFLICT (session_id) DO UPDATE SET
      config = EXCLUDED.config,
      updated_at = EXCLUDED.updated_at;
  `);
  return next;
}

module.exports = {
  DEFAULT_SESSION_CONFIG,
  ensureSessionConfigSchema,
  normalizeSessionId,
  normalizeSessionConfig,
  getSessionConfig,
  updateSessionConfig
};
