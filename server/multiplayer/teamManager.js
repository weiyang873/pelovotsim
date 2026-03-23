const path = require("node:path");
const crypto = require("node:crypto");
const { dealJinang } = require("./jinangDealer");
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
      final_grid_id TEXT,
      final_architecture TEXT,
      final_architecture_source TEXT DEFAULT 'player_selected',
      final_channel1 TEXT,
      final_channel2 TEXT,
      final_channel1_share DOUBLE PRECISION,
      final_vp_text TEXT,
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
      final_wtp_multiplier DOUBLE PRECISION
    );

    CREATE TABLE IF NOT EXISTS team_members (
      id TEXT PRIMARY KEY,
      team_id TEXT REFERENCES teams(id),
      member_name TEXT,
      member_index INTEGER,
      jinang_market_id TEXT,
      jinang_tech_id TEXT,
      joined_at TIMESTAMPTZ
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

    ALTER TABLE teams ADD COLUMN IF NOT EXISTS final_sam DOUBLE PRECISION;
    ALTER TABLE teams ADD COLUMN IF NOT EXISTS final_wtp_adj DOUBLE PRECISION;
    ALTER TABLE teams ADD COLUMN IF NOT EXISTS final_wtp_ref DOUBLE PRECISION;
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
  `);
}

async function getTeamRow(teamId) {
  const rows = await runSql(`
    SELECT id, team_name, team_size, status, created_at,
      final_grid_id, final_architecture, final_architecture_source, final_channel1, final_channel2,
      final_channel1_share, final_vp_text, final_vp_scores, final_gm_max, final_target_gm,
      final_sam, final_wtp_adj, final_wtp_ref, final_vp_c, final_vp_g, final_vp_e_raw, final_vp_e_adj,
      final_rho_c, final_wtp_multiplier
    FROM teams
    WHERE id = ${sqlQuote(teamId)}
    LIMIT 1;
  `);
  return rows[0] || null;
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
      id, team_name, team_size, status, created_at,
      final_grid_id, final_architecture, final_architecture_source, final_channel1, final_channel2,
      final_channel1_share, final_vp_text, final_vp_scores, final_gm_max, final_target_gm,
      final_sam, final_wtp_adj, final_wtp_ref, final_vp_c, final_vp_g, final_vp_e_raw, final_vp_e_adj,
      final_rho_c, final_wtp_multiplier
    ) VALUES (
      ${sqlQuote(id)},
      ${sqlQuote(name)},
      ${size},
      'forming',
      ${sqlQuote(createdAt)},
      NULL, NULL, 'player_selected', NULL, NULL,
      NULL, NULL, NULL, NULL, NULL,
      NULL, NULL, NULL, NULL, NULL, NULL, NULL,
      NULL, NULL
    );
  `);

  // 建组即生成全部成员槽位，并立刻发牌（不等待其他人进入页面）。
  for (let i = 1; i <= size; i += 1) {
    const mid = crypto.randomUUID();
    await runSql(`
      INSERT INTO team_members (
        id, team_id, member_name, member_index, jinang_market_id, jinang_tech_id, joined_at
      ) VALUES (
        ${sqlQuote(mid)},
        ${sqlQuote(id)},
        ${sqlQuote(`成员${i}`)},
        ${i},
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
    SELECT id, team_id, member_name, member_index, jinang_market_id, jinang_tech_id, joined_at
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
    SELECT id, team_id, member_name, member_index, jinang_market_id, jinang_tech_id, joined_at
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
    SELECT id, team_id, member_name, member_index, jinang_market_id, jinang_tech_id, joined_at
    FROM team_members
    WHERE team_id = ${sqlQuote(tid)}
    ORDER BY member_index ASC;
  `);

  return { ...team, members };
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
  updateTeamStatus
};
