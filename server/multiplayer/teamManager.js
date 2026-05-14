const path = require("node:path");
const crypto = require("node:crypto");
const { dealJinang } = require("./jinangDealer");
const { ensureSchema: ensureComputationLogSchema } = require("./computationLog");
const { ensureSchema: ensureVpIterationSchema } = require("./vpIterationStore");
const { runSql, sqlQuote } = require("../db/pgSql");

const ROOT = path.join(__dirname, "..", "..");
const TEAM_STATUSES = new Set(["forming", "phase1", "phase2", "phase3", "phase4", "frozen"]);

function nowIso() {
  return new Date().toISOString();
}

async function ensureSchema() {
  await runSql(`
    CREATE TABLE IF NOT EXISTS teams (
      id TEXT PRIMARY KEY,
      team_name TEXT,
      team_size INTEGER,
      status TEXT,
      created_at TIMESTAMPTZ,
      leader_member_id TEXT,
      final_grid_id TEXT,
      final_architecture TEXT,
      final_architecture_source TEXT DEFAULT 'player_selected',
      final_channel1 TEXT,
      final_channel2 TEXT,
      final_channel1_share DOUBLE PRECISION,
      final_vp_text TEXT,
      final_vp_summary JSONB,
      final_vp_scores TEXT,
      final_gm_max DOUBLE PRECISION,
      final_target_gm DOUBLE PRECISION,
      final_sam DOUBLE PRECISION,
      final_wtp_adj DOUBLE PRECISION,
      final_wtp_ref DOUBLE PRECISION,
      final_vp_c DOUBLE PRECISION,
      final_vp_g DOUBLE PRECISION,
      final_vp_e_raw DOUBLE PRECISION,
      final_vp_e_adj DOUBLE PRECISION,
      final_rho_c DOUBLE PRECISION,
      final_wtp_multiplier DOUBLE PRECISION,
      final_wtp_vp_effect DOUBLE PRECISION,
      final_jinang_wtp_bonus DOUBLE PRECISION
    );

    CREATE TABLE IF NOT EXISTS team_members (
      id TEXT PRIMARY KEY,
      team_id TEXT REFERENCES teams(id),
      member_name TEXT,
      member_index INTEGER,
      is_leader BOOLEAN DEFAULT FALSE,
      jinang_market_id TEXT,
      jinang_tech_id TEXT,
      joined_at TIMESTAMPTZ,
      vp_text TEXT,
      vp_confirmed_fields JSONB,
      vp_scores JSONB,
      vp_confirmed_at TIMESTAMPTZ,
      vp_feedback TEXT
    );

    CREATE TABLE IF NOT EXISTS member_submissions (
      id TEXT PRIMARY KEY,
      member_id TEXT,
      team_id TEXT,
      grid_id TEXT,
      architecture TEXT,
      channel_pref TEXT,
      vp_draft TEXT,
      personal_gm_max DOUBLE PRECISION,
      submitted_at TIMESTAMPTZ
    );

    CREATE TABLE IF NOT EXISTS jinang_settlements (
      id TEXT PRIMARY KEY,
      team_id TEXT,
      member_id TEXT,
      jinang_id TEXT,
      jinang_type TEXT,
      matched BOOLEAN,
      match_reason TEXT,
      effect_applied TEXT
    );

    CREATE TABLE IF NOT EXISTS round1_team_drafts (
      team_id TEXT PRIMARY KEY,
      grid_id TEXT,
      architecture TEXT,
      vp_text TEXT,
      updated_by TEXT,
      updated_at TIMESTAMPTZ
    );

    CREATE TABLE IF NOT EXISTS llm_kv_cache (
      cache_name TEXT NOT NULL,
      cache_key TEXT NOT NULL,
      cache_value JSONB NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (cache_name, cache_key)
    );

    CREATE TABLE IF NOT EXISTS students (
      student_id TEXT PRIMARY KEY,
      student_name TEXT NOT NULL,
      group_label TEXT NOT NULL,
      team_id TEXT,
      member_id TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_students_team ON students(team_id);
    CREATE INDEX IF NOT EXISTS idx_students_group ON students(group_label);
    CREATE INDEX IF NOT EXISTS idx_llm_kv_cache_updated
      ON llm_kv_cache (cache_name, updated_at DESC);

    ALTER TABLE teams ADD COLUMN IF NOT EXISTS final_sam DOUBLE PRECISION;
    ALTER TABLE teams ADD COLUMN IF NOT EXISTS final_wtp_adj DOUBLE PRECISION;
    ALTER TABLE teams ADD COLUMN IF NOT EXISTS final_wtp_ref DOUBLE PRECISION;
    ALTER TABLE teams ADD COLUMN IF NOT EXISTS final_vp_summary JSONB;
    ALTER TABLE teams ADD COLUMN IF NOT EXISTS final_vp_c DOUBLE PRECISION;
    ALTER TABLE teams ADD COLUMN IF NOT EXISTS final_vp_g DOUBLE PRECISION;
    ALTER TABLE teams ADD COLUMN IF NOT EXISTS final_vp_e_raw DOUBLE PRECISION;
    ALTER TABLE teams ADD COLUMN IF NOT EXISTS final_vp_e_adj DOUBLE PRECISION;
    ALTER TABLE teams ALTER COLUMN final_vp_c TYPE DOUBLE PRECISION USING final_vp_c::DOUBLE PRECISION;
    ALTER TABLE teams ALTER COLUMN final_vp_g TYPE DOUBLE PRECISION USING final_vp_g::DOUBLE PRECISION;
    ALTER TABLE teams ALTER COLUMN final_vp_e_raw TYPE DOUBLE PRECISION USING final_vp_e_raw::DOUBLE PRECISION;
    ALTER TABLE teams ALTER COLUMN final_vp_e_adj TYPE DOUBLE PRECISION USING final_vp_e_adj::DOUBLE PRECISION;
    ALTER TABLE teams ADD COLUMN IF NOT EXISTS final_rho_c DOUBLE PRECISION;
    ALTER TABLE teams ADD COLUMN IF NOT EXISTS final_wtp_multiplier DOUBLE PRECISION;
    ALTER TABLE teams ADD COLUMN IF NOT EXISTS final_wtp_vp_effect DOUBLE PRECISION;
    ALTER TABLE teams ADD COLUMN IF NOT EXISTS final_jinang_wtp_bonus DOUBLE PRECISION;
    ALTER TABLE teams ADD COLUMN IF NOT EXISTS lovot_image TEXT;
    ALTER TABLE teams ADD COLUMN IF NOT EXISTS lovot_image_mime TEXT DEFAULT 'image/png';
    ALTER TABLE teams ADD COLUMN IF NOT EXISTS leader_member_id TEXT;
    ALTER TABLE team_members ADD COLUMN IF NOT EXISTS is_leader BOOLEAN DEFAULT FALSE;
    ALTER TABLE team_members ADD COLUMN IF NOT EXISTS vp_text TEXT;
    ALTER TABLE team_members ADD COLUMN IF NOT EXISTS vp_confirmed_fields JSONB;
    ALTER TABLE team_members ADD COLUMN IF NOT EXISTS vp_scores JSONB;
    ALTER TABLE team_members ADD COLUMN IF NOT EXISTS vp_confirmed_at TIMESTAMPTZ;
    ALTER TABLE team_members ADD COLUMN IF NOT EXISTS vp_feedback TEXT;
  `);
  try {
    await runSql(`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_member_submissions_team_member
        ON member_submissions (team_id, member_id);
    `);
  } catch (err) {
    if (err.code === "23505" || /could not create unique index/i.test(String(err.message || ""))) {
      console.warn("[ensureSchema] member_submissions has duplicate (team_id, member_id) rows; deduping");
      await runSql(`
        DELETE FROM member_submissions
        WHERE id NOT IN (
          SELECT MIN(id) FROM member_submissions
          WHERE team_id IS NOT NULL AND member_id IS NOT NULL
          GROUP BY team_id, member_id
        );
      `);
      await runSql(`
        CREATE UNIQUE INDEX IF NOT EXISTS uq_member_submissions_team_member
          ON member_submissions (team_id, member_id);
      `);
    } else {
      throw err;
    }
  }
  await ensureComputationLogSchema();
  await ensureVpIterationSchema();
}

function parseJsonColumn(value) {
  if (!value) return null;
  if (typeof value === "object") return value;
  try {
    return JSON.parse(String(value));
  } catch (_) {
    return null;
  }
}

async function getTeamRow(teamId) {
  const rows = await runSql(`
    SELECT t.id, t.team_name, t.team_size, t.status, t.created_at,
      t.leader_member_id,
      leader.member_name AS leader_name,
      t.final_grid_id, t.final_architecture, t.final_architecture_source, t.final_channel1, t.final_channel2,
      t.final_channel1_share, t.final_vp_text, t.final_vp_summary, t.final_vp_scores, t.final_gm_max, t.final_target_gm,
      t.final_sam, t.final_wtp_adj, t.final_wtp_ref, t.final_vp_c, t.final_vp_g, t.final_vp_e_raw, t.final_vp_e_adj,
      t.final_rho_c, t.final_wtp_multiplier, t.final_wtp_vp_effect, t.final_jinang_wtp_bonus
    FROM teams t
    LEFT JOIN team_members leader ON leader.id = t.leader_member_id
    WHERE t.id = ${sqlQuote(teamId)}
    LIMIT 1;
  `);
  const row = rows[0];
  if (!row) return null;
  return {
    ...row,
    final_vp_summary: parseJsonColumn(row.final_vp_summary)
  };
}

async function createTeam(teamName, teamSize) {
  await ensureSchema();
  const name = String(teamName || "").trim();
  const size = Number(teamSize);

  if (!name) throw new Error("teamName required");
  if (!Number.isInteger(size) || size < 1 || size > 6) {
    throw new Error("teamSize must be an integer between 1 and 6");
  }

  const id = crypto.randomUUID();
  const createdAt = nowIso();

  await runSql(`
    INSERT INTO teams (
      id, team_name, team_size, status, created_at, leader_member_id,
      final_grid_id, final_architecture, final_architecture_source, final_channel1, final_channel2,
      final_channel1_share, final_vp_text, final_vp_summary, final_vp_scores, final_gm_max, final_target_gm,
      final_sam, final_wtp_adj, final_wtp_ref, final_vp_c, final_vp_g, final_vp_e_raw, final_vp_e_adj,
      final_rho_c, final_wtp_multiplier
    ) VALUES (
      ${sqlQuote(id)},
      ${sqlQuote(name)},
      ${size},
      'forming',
      ${sqlQuote(createdAt)},
      NULL,
      NULL, NULL, 'player_selected', NULL, NULL,
      NULL, NULL, NULL, NULL, NULL, NULL,
      NULL, NULL, NULL, NULL, NULL, NULL, NULL,
      NULL, NULL
    );
  `);

  // 建组即生成全部成员槽位，并立刻发牌（不等待其他人进入页面）。
  for (let i = 1; i <= size; i += 1) {
    const mid = crypto.randomUUID();
    await runSql(`
      INSERT INTO team_members (
        id, team_id, member_name, member_index, is_leader, jinang_market_id, jinang_tech_id, joined_at
      ) VALUES (
        ${sqlQuote(mid)},
        ${sqlQuote(id)},
        ${sqlQuote(`成员${i}`)},
        ${i},
        FALSE,
        NULL,
        NULL,
        ${sqlQuote(createdAt)}
      );
    `);
  }

  await dealJinang(id);

  return getTeamRow(id);
}

async function joinTeam(teamId, memberName) {
  await ensureSchema();
  const tid = String(teamId || "").trim();
  const name = String(memberName || "").trim();

  if (!tid) throw new Error("teamId required");
  if (!name) throw new Error("memberName required");

  const team = await getTeamRow(tid);
  if (!team) throw new Error(`team not found: ${tid}`);

  const existingMembers = await runSql(`
    SELECT id, team_id, member_name, member_index, is_leader, jinang_market_id, jinang_tech_id, joined_at
    FROM team_members
    WHERE team_id = ${sqlQuote(tid)}
    ORDER BY member_index ASC;
  `);

  const duplicateName = existingMembers.find((m) => String(m.member_name || "") === name);
  if (duplicateName) throw new Error("memberName already exists in this team");

  // 认领一个未认领槽位（默认名：成员1/成员2/...）
  const unclaimed = existingMembers.find((m) => /^成员\d+$/.test(String(m.member_name || "")));
  if (!unclaimed) {
    throw new Error("team is full");
  }

  await runSql(`
    UPDATE team_members
    SET member_name = ${sqlQuote(name)}
    WHERE id = ${sqlQuote(unclaimed.id)};
  `);

  const rows = await runSql(`
    SELECT id, team_id, member_name, member_index, is_leader, jinang_market_id, jinang_tech_id, joined_at
    FROM team_members
    WHERE id = ${sqlQuote(unclaimed.id)}
    LIMIT 1;
  `);
  return rows[0];
}

async function getTeam(teamId) {
  await ensureSchema();
  const tid = String(teamId || "").trim();
  if (!tid) throw new Error("teamId required");

  const team = await getTeamRow(tid);
  if (!team) return null;

  const members = await runSql(`
    SELECT id, team_id, member_name, member_index, is_leader, jinang_market_id, jinang_tech_id, joined_at
    FROM team_members
    WHERE team_id = ${sqlQuote(tid)}
    ORDER BY member_index ASC;
  `);

  return { ...team, members };
}

async function setTeamLeader(teamId, memberId) {
  await ensureSchema();
  const tid = String(teamId || "").trim();
  const mid = String(memberId || "").trim();
  if (!tid) throw new Error("teamId required");
  if (!mid) throw new Error("memberId required");

  const memberRows = await runSql(`
    SELECT id
    FROM team_members
    WHERE team_id = ${sqlQuote(tid)} AND id = ${sqlQuote(mid)}
    LIMIT 1;
  `);
  if (!memberRows[0]) throw new Error("member not found in team");

  await runSql(`
    UPDATE teams
    SET leader_member_id = ${sqlQuote(mid)}
    WHERE id = ${sqlQuote(tid)};
  `);

  await runSql(`
    UPDATE team_members
    SET is_leader = CASE WHEN id = ${sqlQuote(mid)} THEN TRUE ELSE FALSE END
    WHERE team_id = ${sqlQuote(tid)};
  `);

  return getTeam(tid);
}

async function updateTeamStatus(teamId, newStatus) {
  await ensureSchema();
  const tid = String(teamId || "").trim();
  const status = String(newStatus || "").trim();

  if (!tid) throw new Error("teamId required");
  if (!TEAM_STATUSES.has(status)) throw new Error(`invalid status: ${status}`);

  const team = await getTeamRow(tid);
  if (!team) throw new Error(`team not found: ${tid}`);

  await runSql(`
    UPDATE teams
    SET status = ${sqlQuote(status)}
    WHERE id = ${sqlQuote(tid)};
  `);

  return getTeamRow(tid);
}

module.exports = {
  ensureSchema,
  createTeam,
  joinTeam,
  getTeam,
  setTeamLeader,
  updateTeamStatus
};
