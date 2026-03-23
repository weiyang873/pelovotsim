#!/usr/bin/env node
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { runSql, sqlQuote } = require("../../server/db/pgSql");

const ROOT = path.join(__dirname, "..", "..");
const SQLITE_DB = path.join(ROOT, "sim.db");

function readSqliteRows(sql) {
  const out = spawnSync("sqlite3", ["-json", SQLITE_DB, sql], { encoding: "utf8" });
  if (out.status !== 0) {
    throw new Error((out.stderr || "sqlite3 read failed").trim());
  }
  const text = String(out.stdout || "").trim();
  return text ? JSON.parse(text) : [];
}

async function insertRows(table, rows) {
  if (!rows.length) return;
  for (const row of rows) {
    const cols = Object.keys(row);
    const values = cols.map((k) => sqlQuote(row[k]));
    await runSql(`INSERT INTO ${table} (${cols.join(",")}) VALUES (${values.join(",")}) ON CONFLICT DO NOTHING`);
  }
}

function parseVp(vpText) {
  const txt = String(vpText || "");
  const who = (txt.match(/WHO:\s*([^\n]+)/i) || [null, ""])[1].trim();
  const pain = (txt.match(/PAIN:\s*([^\n]+)/i) || [null, ""])[1].trim();
  const how = (txt.match(/HOW:\s*([^\n]+)/i) || [null, ""])[1].trim();
  return { who, pain, how };
}

function toJsonOrNull(v) {
  if (v === null || v === undefined || v === "") return "NULL";
  return `${sqlQuote(String(v))}::jsonb`;
}

async function migrateLegacyTables() {
  const legacyTables = [
    "team_members",
    "member_submissions",
    "jinang_settlements",
    "round2_dimension_assignments",
    "round2_member_selections",
    "round2_interview_sessions",
    "team_runs",
    "iteration_events",
    "llm_wizard_outputs",
    "llm_call_metrics"
  ];

  for (const table of legacyTables) {
    const rows = readSqliteRows(`SELECT * FROM ${table};`);
    await insertRows(table, rows);
    console.log(`migrated legacy ${table}: ${rows.length}`);
  }
}

async function migrateCanonicalSchema() {
  await runSql(`
    INSERT INTO games (game_id, created_at, status, config_version)
    VALUES ('legacy_import_game', NOW(), 'imported', 'legacy-sqlite')
    ON CONFLICT (game_id) DO NOTHING;
  `);

  const oldTeams = readSqliteRows("SELECT * FROM teams;");
  for (const t of oldTeams) {
    await runSql(`
      INSERT INTO teams (
        id, team_id, game_id, member_count, grid_id, architecture_tag, created_at,
        team_name, team_size, status,
        final_grid_id, final_architecture, final_architecture_source,
        final_channel1, final_channel2, final_channel1_share,
        final_vp_text, final_vp_scores, final_gm_max, final_target_gm
      )
      VALUES (
        ${sqlQuote(t.id)},
        ${sqlQuote(t.id)},
        'legacy_import_game',
        ${Number(t.team_size || 0)},
        ${sqlQuote(t.final_grid_id)},
        ${sqlQuote(t.final_architecture)},
        ${sqlQuote(t.created_at || new Date().toISOString())}::timestamptz,
        ${sqlQuote(t.team_name)},
        ${Number(t.team_size || 0)},
        ${sqlQuote(t.status)},
        ${sqlQuote(t.final_grid_id)},
        ${sqlQuote(t.final_architecture)},
        ${sqlQuote(t.final_architecture_source || "player_selected")},
        ${sqlQuote(t.final_channel1)},
        ${sqlQuote(t.final_channel2)},
        ${t.final_channel1_share == null ? "NULL" : Number(t.final_channel1_share)},
        ${sqlQuote(t.final_vp_text)},
        ${sqlQuote(t.final_vp_scores)},
        ${t.final_gm_max == null ? "NULL" : Number(t.final_gm_max)},
        ${t.final_target_gm == null ? "NULL" : Number(t.final_target_gm)}
      )
      ON CONFLICT (id) DO UPDATE SET
        id = EXCLUDED.id,
        team_id = EXCLUDED.team_id,
        game_id = EXCLUDED.game_id,
        member_count = EXCLUDED.member_count,
        grid_id = EXCLUDED.grid_id,
        architecture_tag = EXCLUDED.architecture_tag,
        created_at = EXCLUDED.created_at,
        team_name = EXCLUDED.team_name,
        team_size = EXCLUDED.team_size,
        status = EXCLUDED.status,
        final_grid_id = EXCLUDED.final_grid_id,
        final_architecture = EXCLUDED.final_architecture,
        final_architecture_source = EXCLUDED.final_architecture_source,
        final_channel1 = EXCLUDED.final_channel1,
        final_channel2 = EXCLUDED.final_channel2,
        final_channel1_share = EXCLUDED.final_channel1_share,
        final_vp_text = EXCLUDED.final_vp_text,
        final_vp_scores = EXCLUDED.final_vp_scores,
        final_gm_max = EXCLUDED.final_gm_max,
        final_target_gm = EXCLUDED.final_target_gm;
    `);

    const vp = parseVp(t.final_vp_text);
    let scores = {};
    try { scores = JSON.parse(t.final_vp_scores || "{}"); } catch (_) { scores = {}; }

    await runSql(`
      INSERT INTO round1_team (
        team_id, vp_text_who, vp_text_pain, vp_text_how, vp_coach_history,
        c_score, g_score, e_score, e_adj, sam, wtp_adj, rho_c,
        final_grid, final_arch
      )
      VALUES (
        ${sqlQuote(t.id)},
        ${sqlQuote(vp.who)},
        ${sqlQuote(vp.pain)},
        ${sqlQuote(vp.how)},
        NULL,
        ${Number(scores.C || 0)},
        ${Number(scores.G || 0)},
        ${Number(scores.E || 0)},
        NULL,
        NULL,
        NULL,
        NULL,
        ${sqlQuote(t.final_grid_id)},
        ${sqlQuote(t.final_architecture)}
      )
      ON CONFLICT (team_id) DO UPDATE SET
        vp_text_who = EXCLUDED.vp_text_who,
        vp_text_pain = EXCLUDED.vp_text_pain,
        vp_text_how = EXCLUDED.vp_text_how,
        c_score = EXCLUDED.c_score,
        g_score = EXCLUDED.g_score,
        e_score = EXCLUDED.e_score,
        final_grid = EXCLUDED.final_grid,
        final_arch = EXCLUDED.final_arch;
    `);
  }

  const oldMembers = readSqliteRows("SELECT * FROM team_members;");
  for (const m of oldMembers) {
    await runSql(`
      INSERT INTO members (member_id, team_id, jinang_market_card, jinang_tech_card)
      VALUES (
        ${sqlQuote(m.id)},
        ${sqlQuote(m.team_id)},
        ${sqlQuote(m.jinang_market_id)},
        ${sqlQuote(m.jinang_tech_id)}
      )
      ON CONFLICT (member_id) DO UPDATE SET
        team_id = EXCLUDED.team_id,
        jinang_market_card = EXCLUDED.jinang_market_card,
        jinang_tech_card = EXCLUDED.jinang_tech_card;
    `);
  }

  const oldSubmissions = readSqliteRows("SELECT * FROM member_submissions;");
  for (const s of oldSubmissions) {
    await runSql(`
      INSERT INTO round1_individual (member_id, chosen_grid, chosen_arch, vp_draft)
      VALUES (
        ${sqlQuote(s.member_id)},
        ${sqlQuote(s.grid_id)},
        ${sqlQuote(s.architecture)},
        ${sqlQuote(s.vp_draft)}
      )
      ON CONFLICT (member_id) DO UPDATE SET
        chosen_grid = EXCLUDED.chosen_grid,
        chosen_arch = EXCLUDED.chosen_arch,
        vp_draft = EXCLUDED.vp_draft;
    `);
  }

  const oldRound2Sessions = readSqliteRows("SELECT * FROM round2_interview_sessions;");
  const oldSelections = readSqliteRows("SELECT * FROM round2_member_selections;");

  const sessionByTeam = new Map();
  for (const r of oldRound2Sessions) {
    const tid = String(r.team_id || "");
    if (!tid) continue;
    const arr = sessionByTeam.get(tid) || [];
    arr.push(r.history_json ? JSON.parse(r.history_json) : []);
    sessionByTeam.set(tid, arr);
  }

  const selByTeam = new Map();
  for (const r of oldSelections) {
    const tid = String(r.team_id || "");
    if (!tid) continue;
    const obj = selByTeam.get(tid) || {};
    obj[r.member_id] = r.selections_json ? JSON.parse(r.selections_json) : [];
    selByTeam.set(tid, obj);
  }

  for (const team of oldTeams) {
    const tid = String(team.id || "");
    const history = sessionByTeam.get(tid) || [];
    const selections = selByTeam.get(tid) || {};
    await runSql(`
      INSERT INTO round2_team (
        team_id, interview_history, radar_scores, selected_cards
      ) VALUES (
        ${sqlQuote(tid)},
        ${toJsonOrNull(JSON.stringify(history))},
        NULL,
        ${toJsonOrNull(JSON.stringify(selections))}
      )
      ON CONFLICT (team_id) DO UPDATE SET
        interview_history = EXCLUDED.interview_history,
        selected_cards = EXCLUDED.selected_cards;
    `);
  }

  await runSql(`
    INSERT INTO global_config (version, params)
    VALUES (
      'legacy-import',
      '{"source":"sqlite","notes":"initial import"}'::jsonb
    )
    ON CONFLICT (version) DO NOTHING;
  `);

  console.log("migrated canonical schema tables");
}

async function main() {
  console.log("initializing postgres schema...");
  const { main: initSchema } = require("./init-postgres-schema");
  await initSchema();
  console.log("migrating legacy-compatible tables...");
  await migrateLegacyTables();
  console.log("migrating canonical tables...");
  await migrateCanonicalSchema();
  console.log("done");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
