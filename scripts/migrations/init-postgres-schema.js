#!/usr/bin/env node
const { runSql } = require("../../server/db/pgSql");

async function main() {
  await runSql(`
    CREATE TABLE IF NOT EXISTS games (
      game_id TEXT PRIMARY KEY,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      status TEXT NOT NULL,
      config_version TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS teams (
      id TEXT PRIMARY KEY,
      team_id TEXT UNIQUE,
      game_id TEXT REFERENCES games(game_id) ON DELETE SET NULL,
      member_count INTEGER,
      grid_id TEXT,
      architecture_tag TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      team_name TEXT,
      team_size INTEGER,
      status TEXT,
      final_grid_id TEXT,
      final_architecture TEXT,
      final_architecture_source TEXT DEFAULT 'player_selected',
      final_channel1 TEXT,
      final_channel2 TEXT,
      final_channel1_share DOUBLE PRECISION,
      final_vp_text TEXT,
      final_vp_scores TEXT,
      final_gm_max DOUBLE PRECISION,
      final_target_gm DOUBLE PRECISION
    );

    ALTER TABLE teams ADD COLUMN IF NOT EXISTS id TEXT;
    ALTER TABLE teams ADD COLUMN IF NOT EXISTS team_id TEXT;
    ALTER TABLE teams ADD COLUMN IF NOT EXISTS game_id TEXT;
    ALTER TABLE teams ADD COLUMN IF NOT EXISTS member_count INTEGER;
    ALTER TABLE teams ADD COLUMN IF NOT EXISTS grid_id TEXT;
    ALTER TABLE teams ADD COLUMN IF NOT EXISTS architecture_tag TEXT;
    ALTER TABLE teams ADD COLUMN IF NOT EXISTS team_name TEXT;
    ALTER TABLE teams ADD COLUMN IF NOT EXISTS team_size INTEGER;
    ALTER TABLE teams ADD COLUMN IF NOT EXISTS status TEXT;
    ALTER TABLE teams ADD COLUMN IF NOT EXISTS final_grid_id TEXT;
    ALTER TABLE teams ADD COLUMN IF NOT EXISTS final_architecture TEXT;
    ALTER TABLE teams ADD COLUMN IF NOT EXISTS final_architecture_source TEXT DEFAULT 'player_selected';
    ALTER TABLE teams ADD COLUMN IF NOT EXISTS final_channel1 TEXT;
    ALTER TABLE teams ADD COLUMN IF NOT EXISTS final_channel2 TEXT;
    ALTER TABLE teams ADD COLUMN IF NOT EXISTS final_channel1_share DOUBLE PRECISION;
    ALTER TABLE teams ADD COLUMN IF NOT EXISTS final_vp_text TEXT;
    ALTER TABLE teams ADD COLUMN IF NOT EXISTS final_vp_scores TEXT;
    ALTER TABLE teams ADD COLUMN IF NOT EXISTS final_gm_max DOUBLE PRECISION;
    ALTER TABLE teams ADD COLUMN IF NOT EXISTS final_target_gm DOUBLE PRECISION;

    CREATE UNIQUE INDEX IF NOT EXISTS idx_teams_team_id_unique ON teams(team_id);

    CREATE TABLE IF NOT EXISTS members (
      member_id TEXT PRIMARY KEY,
      team_id TEXT NOT NULL REFERENCES teams(team_id) ON DELETE CASCADE,
      jinang_market_card TEXT,
      jinang_tech_card TEXT
    );

    CREATE TABLE IF NOT EXISTS round1_individual (
      member_id TEXT PRIMARY KEY REFERENCES members(member_id) ON DELETE CASCADE,
      chosen_grid TEXT,
      chosen_arch TEXT,
      vp_draft TEXT
    );

    CREATE TABLE IF NOT EXISTS round1_team (
      team_id TEXT PRIMARY KEY REFERENCES teams(team_id) ON DELETE CASCADE,
      vp_text_who TEXT,
      vp_text_pain TEXT,
      vp_text_how TEXT,
      vp_coach_history JSONB,
      c_score DOUBLE PRECISION,
      g_score DOUBLE PRECISION,
      e_score DOUBLE PRECISION,
      e_adj DOUBLE PRECISION,
      sam DOUBLE PRECISION,
      wtp_adj DOUBLE PRECISION,
      rho_c DOUBLE PRECISION,
      final_grid TEXT,
      final_arch TEXT
    );

    CREATE TABLE IF NOT EXISTS round2_team (
      team_id TEXT PRIMARY KEY REFERENCES teams(team_id) ON DELETE CASCADE,
      interview_history JSONB,
      evi DOUBLE PRECISION,
      sev DOUBLE PRECISION,
      radar_scores JSONB,
      selected_cards JSONB,
      student_price DOUBLE PRECISION,
      q INTEGER,
      cogsbase DOUBLE PRECISION,
      cogs_total DOUBLE PRECISION,
      profit_hw DOUBLE PRECISION,
      profit_sub DOUBLE PRECISION,
      profit_total DOUBLE PRECISION,
      share DOUBLE PRECISION,
      gamma_eff DOUBLE PRECISION,
      vscore DOUBLE PRECISION,
      attach DOUBLE PRECISION,
      match_grid TEXT
    );

    CREATE TABLE IF NOT EXISTS global_config (
      version TEXT PRIMARY KEY,
      params JSONB NOT NULL
    );

    CREATE TABLE IF NOT EXISTS team_runs (
      id TEXT PRIMARY KEY,
      team_id TEXT NOT NULL,
      team_name TEXT NOT NULL,
      created_at TEXT NOT NULL,
      run_date TEXT,
      run_time TEXT,
      setup_json TEXT NOT NULL,
      round1_json TEXT NOT NULL,
      round2_json TEXT NOT NULL,
      history_json TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS iteration_events (
      id TEXT PRIMARY KEY,
      team_id TEXT NOT NULL,
      team_name TEXT NOT NULL,
      iteration_no INTEGER NOT NULL,
      changes_json TEXT NOT NULL,
      delta_profit DOUBLE PRECISION NOT NULL,
      round2_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      run_date TEXT,
      run_time TEXT
    );

    CREATE TABLE IF NOT EXISTS llm_wizard_outputs (
      id TEXT PRIMARY KEY,
      team_key TEXT NOT NULL,
      step TEXT NOT NULL,
      cache_key TEXT NOT NULL,
      decision_state_json TEXT NOT NULL,
      step_input_json TEXT NOT NULL,
      output_json TEXT NOT NULL,
      model TEXT NOT NULL,
      cached INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      run_date TEXT,
      run_time TEXT
    );

    CREATE TABLE IF NOT EXISTS llm_call_metrics (
      id TEXT PRIMARY KEY,
      team_key TEXT NOT NULL,
      step TEXT NOT NULL,
      cache_key TEXT NOT NULL,
      model TEXT NOT NULL,
      latency_ms INTEGER NOT NULL,
      prompt_tokens INTEGER NOT NULL,
      completion_tokens INTEGER NOT NULL,
      total_tokens INTEGER NOT NULL,
      cached INTEGER NOT NULL,
      success INTEGER NOT NULL,
      error_text TEXT,
      created_at TEXT NOT NULL,
      run_date TEXT,
      run_time TEXT
    );

    CREATE TABLE IF NOT EXISTS team_members (
      id TEXT PRIMARY KEY,
      team_id TEXT,
      member_name TEXT,
      member_index INTEGER,
      jinang_market_id TEXT,
      jinang_tech_id TEXT,
      joined_at TEXT
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
      submitted_at TEXT
    );

    CREATE UNIQUE INDEX IF NOT EXISTS uq_member_submissions_team_member
      ON member_submissions (team_id, member_id);

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

    CREATE TABLE IF NOT EXISTS round2_dimension_assignments (
      team_id TEXT PRIMARY KEY,
      assignments_json TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS round2_member_selections (
      team_id TEXT NOT NULL,
      member_id TEXT NOT NULL,
      selections_json TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (team_id, member_id)
    );

    CREATE TABLE IF NOT EXISTS round2_interview_sessions (
      session_id TEXT PRIMARY KEY,
      team_id TEXT NOT NULL,
      member_id TEXT NOT NULL,
      member_dims_json TEXT NOT NULL,
      personas_json TEXT NOT NULL,
      history_json TEXT NOT NULL,
      result_json TEXT,
      round_no INTEGER NOT NULL,
      is_complete INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS llm_kv_cache (
      cache_name TEXT NOT NULL,
      cache_key TEXT NOT NULL,
      cache_value JSONB NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (cache_name, cache_key)
    );

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

    CREATE INDEX IF NOT EXISTS idx_team_runs_team ON team_runs(team_id);
    CREATE INDEX IF NOT EXISTS idx_team_runs_created ON team_runs(created_at);
    CREATE INDEX IF NOT EXISTS idx_iter_team ON iteration_events(team_id);
    CREATE INDEX IF NOT EXISTS idx_iter_created ON iteration_events(created_at);
    CREATE INDEX IF NOT EXISTS idx_llm_outputs_team_step ON llm_wizard_outputs(team_key, step);
    CREATE INDEX IF NOT EXISTS idx_llm_outputs_cache ON llm_wizard_outputs(cache_key);
    CREATE INDEX IF NOT EXISTS idx_llm_metrics_team_step ON llm_call_metrics(team_key, step);
    CREATE INDEX IF NOT EXISTS idx_llm_metrics_created ON llm_call_metrics(created_at);
    CREATE INDEX IF NOT EXISTS idx_comp_log_team ON computation_log(team_id);
    CREATE INDEX IF NOT EXISTS idx_comp_log_stage ON computation_log(stage);
    CREATE INDEX IF NOT EXISTS idx_llm_kv_cache_updated
      ON llm_kv_cache (cache_name, updated_at DESC);
  `);

  console.log("PostgreSQL schema initialized");
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = { main };
