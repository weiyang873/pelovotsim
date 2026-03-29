"use strict";

const { runSql, sqlQuote } = require("../db/pgSql");

const CHAIN_STAGE_ORDER = [
  "r1_wtp_params",
  "r1_sam",
  "r1_vp_score",
  "r1_wtp_adj",
  "r2_interview_extract",
  "r2_evi",
  "r2_weight_fusion",
  "r2_tag_layering",
  "r2_card_selection",
  "r2_coverage",
  "r2_product_scores",
  "r2_volume",
  "r2_profit"
];

const CHAIN_STAGE_ALIASES = {
  r1_vp_score: ["r1_vp_score_final", "r1_vp_score"],
  r1_wtp_adj: ["r1_wtp_adj_final", "r1_wtp_adj"]
};

let schemaReadyPromise = null;

function cloneJson(value, fallback = {}) {
  try {
    return JSON.parse(JSON.stringify(value == null ? fallback : value));
  } catch (_) {
    return fallback;
  }
}

function nowIso() {
  return new Date().toISOString();
}

function normalizeContext(context) {
  const src = context && typeof context === "object" ? context : {};
  return {
    session_id: String(src.session_id || src.sessionId || "").trim(),
    team_id: String(src.team_id || src.teamId || "").trim(),
    member_id: src.member_id || src.memberId ? String(src.member_id || src.memberId).trim() : null,
    source: String(src.source || "web").trim() || "web",
    timestamp: src.timestamp ? String(src.timestamp).trim() : ""
  };
}

function normalizeEntry(entry) {
  const src = entry && typeof entry === "object" ? entry : {};
  const context = normalizeContext(src);
  const stage = String(src.stage || "").trim();
  if (!context.session_id || !context.team_id || !stage) return null;
  return {
    session_id: context.session_id,
    team_id: context.team_id,
    member_id: context.member_id || null,
    timestamp: context.timestamp || nowIso(),
    stage,
    params: cloneJson(src.params, {}),
    source: context.source
  };
}

function buildEntry(context, stage, params) {
  return normalizeEntry({
    ...normalizeContext(context),
    stage,
    params
  });
}

async function ensureSchema() {
  if (!schemaReadyPromise) {
    schemaReadyPromise = runSql(`
      CREATE TABLE IF NOT EXISTS computation_log (
        id SERIAL PRIMARY KEY,
        session_id TEXT NOT NULL,
        team_id TEXT NOT NULL,
        member_id TEXT,
        timestamp TIMESTAMPTZ DEFAULT NOW(),
        stage TEXT NOT NULL,
        params JSONB NOT NULL,
        source TEXT DEFAULT 'web'
      );

      CREATE INDEX IF NOT EXISTS idx_comp_log_team ON computation_log(team_id);
      CREATE INDEX IF NOT EXISTS idx_comp_log_stage ON computation_log(stage);
    `).catch((err) => {
      schemaReadyPromise = null;
      throw err;
    });
  }
  await schemaReadyPromise;
}

async function insertEntries(entries) {
  const list = (Array.isArray(entries) ? entries : [])
    .map((entry) => normalizeEntry(entry))
    .filter(Boolean);
  if (list.length === 0) return 0;

  await ensureSchema();
  const values = list.map((entry) => `(
    ${sqlQuote(entry.session_id)},
    ${sqlQuote(entry.team_id)},
    ${entry.member_id ? sqlQuote(entry.member_id) : "NULL"},
    ${sqlQuote(entry.timestamp)},
    ${sqlQuote(entry.stage)},
    ${sqlQuote(JSON.stringify(entry.params || {}))}::jsonb,
    ${sqlQuote(entry.source || "web")}
  )`).join(",\n");

  await runSql(`
    INSERT INTO computation_log (
      session_id, team_id, member_id, timestamp, stage, params, source
    ) VALUES ${values};
  `);
  return list.length;
}

function scheduleEntries(entries) {
  const list = (Array.isArray(entries) ? entries : [])
    .map((entry) => normalizeEntry(entry))
    .filter(Boolean);
  if (list.length === 0) return 0;
  setImmediate(() => {
    insertEntries(list).catch((err) => {
      console.warn("[computation_log] insert failed:", err.message || err);
    });
  });
  return list.length;
}

function scheduleStage(context, stage, params) {
  const entry = buildEntry(context, stage, params);
  if (!entry) return 0;
  return scheduleEntries([entry]);
}

function scheduleStages(context, stages) {
  const entries = (Array.isArray(stages) ? stages : [])
    .map((item) => buildEntry(context, item?.stage, item?.params))
    .filter(Boolean);
  return scheduleEntries(entries);
}

async function createLogs(body) {
  const payload = body && typeof body === "object" ? body : {};
  const entries = Array.isArray(payload.entries) ? payload.entries : [payload];
  const count = await insertEntries(entries);
  return { ok: true, inserted: count };
}

async function listLogs(teamId, stage = "") {
  const tid = String(teamId || "").trim();
  const stageFilter = String(stage || "").trim();
  if (!tid) throw new Error("team_id required");
  await ensureSchema();
  const where = [
    `team_id = ${sqlQuote(tid)}`
  ];
  if (stageFilter) {
    where.push(`stage = ${sqlQuote(stageFilter)}`);
  }
  const rows = await runSql(`
    SELECT id, session_id, team_id, member_id, timestamp, stage, params, source
    FROM computation_log
    WHERE ${where.join(" AND ")}
    ORDER BY timestamp ASC, id ASC;
  `);
  return rows.map((row) => ({
    id: Number(row.id),
    session_id: row.session_id,
    team_id: row.team_id,
    member_id: row.member_id || null,
    timestamp: row.timestamp instanceof Date ? row.timestamp.toISOString() : String(row.timestamp || ""),
    stage: row.stage,
    params: row.params && typeof row.params === "object" ? row.params : cloneJson(row.params, {}),
    source: row.source || "web"
  }));
}

function buildChainFromLogs(teamId, logs) {
  const grouped = {};
  const sessions = {};
  for (const log of logs) {
    if (!grouped[log.stage]) grouped[log.stage] = [];
    grouped[log.stage].push(log);
    if (!sessions[log.session_id]) sessions[log.session_id] = [];
    sessions[log.session_id].push(log);
  }

  const latest = {};
  for (const stage of CHAIN_STAGE_ORDER) {
    const aliases = CHAIN_STAGE_ALIASES[stage] || [stage];
    let picked = null;
    for (const alias of aliases) {
      const items = grouped[alias] || [];
      if (items.length === 0) continue;
      const preferredFinal = items.filter((item) => item?.params?.is_final === true);
      const candidateList = preferredFinal.length > 0 ? preferredFinal : items;
      picked = candidateList[candidateList.length - 1];
      if (picked) break;
    }
    if (picked) latest[stage] = picked;
  }

  return {
    ok: true,
    team_id: teamId,
    stage_order: CHAIN_STAGE_ORDER.slice(),
    counts: Object.fromEntries(
      Object.keys(grouped)
        .sort()
        .map((stage) => [stage, grouped[stage].length])
    ),
    latest_chain: latest,
    grouped_logs: grouped,
    sessions
  };
}

async function getChain(teamId) {
  const tid = String(teamId || "").trim();
  if (!tid) throw new Error("team_id required");
  const logs = await listLogs(tid);
  return buildChainFromLogs(tid, logs);
}

module.exports = {
  CHAIN_STAGE_ORDER,
  ensureSchema,
  insertEntries,
  scheduleEntries,
  scheduleStage,
  scheduleStages,
  createLogs,
  listLogs,
  getChain
};
