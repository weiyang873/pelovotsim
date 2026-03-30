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
  r2_status TEXT DEFAULT 'R2_NOT_STARTED',
  r2_status_entered_at TIMESTAMPTZ,
  session_id TEXT DEFAULT 'default'
);

CREATE TABLE IF NOT EXISTS team_members (
  id TEXT PRIMARY KEY,
  team_id TEXT REFERENCES teams(id),
  member_name TEXT,
  member_index INTEGER,
  jinang_market_id TEXT,
  jinang_tech_id TEXT,
  joined_at TIMESTAMPTZ,
  vp_text TEXT,
  vp_confirmed_fields JSONB,
  vp_scores JSONB,
  vp_confirmed_at TIMESTAMPTZ,
  interview_status TEXT DEFAULT 'not_started',
  interview_rounds INTEGER DEFAULT 0,
  card_status TEXT DEFAULT 'not_started',
  cards_selected INTEGER DEFAULT 0,
  current_step TEXT DEFAULT 'idle',
  last_activity_at TIMESTAMPTZ,
  forced_by_teacher BOOLEAN DEFAULT FALSE
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

CREATE TABLE IF NOT EXISTS students (
  student_id TEXT PRIMARY KEY,
  student_name TEXT NOT NULL,
  group_label TEXT NOT NULL,
  team_id TEXT,
  member_id TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS computation_log (
  id BIGSERIAL PRIMARY KEY,
  session_id TEXT NOT NULL,
  team_id TEXT NOT NULL,
  member_id TEXT,
  timestamp TIMESTAMPTZ DEFAULT NOW(),
  stage TEXT NOT NULL,
  params JSONB NOT NULL,
  source TEXT DEFAULT 'web'
);

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

CREATE TABLE IF NOT EXISTS round2_dimension_assignments (
  team_id TEXT PRIMARY KEY,
  assignments_json TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS round2_member_selections (
  team_id TEXT NOT NULL,
  member_id TEXT NOT NULL,
  selections_json TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
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
  is_complete BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS round2_submissions (
  team_id TEXT NOT NULL,
  session_id TEXT NOT NULL DEFAULT 'default',
  price DOUBLE PRECISION NOT NULL,
  selections_json TEXT NOT NULL,
  cards_json TEXT NOT NULL,
  card_count INTEGER NOT NULL DEFAULT 0,
  dcogs DOUBLE PRECISION,
  risk_total DOUBLE PRECISION,
  best_grid TEXT,
  submitted_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (team_id, session_id)
);

CREATE TABLE IF NOT EXISTS fg_team_radar (
  team_id TEXT NOT NULL,
  session_id TEXT NOT NULL DEFAULT 'default',
  radar_json TEXT NOT NULL,
  tags_json TEXT NOT NULL,
  evi DOUBLE PRECISION,
  updated_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (team_id, session_id)
);

CREATE TABLE IF NOT EXISTS round2_results (
  team_id TEXT NOT NULL,
  session_id TEXT NOT NULL DEFAULT 'default',
  units INTEGER,
  profit DOUBLE PRECISION,
  profit_per_unit DOUBLE PRECISION,
  vscore DOUBLE PRECISION,
  best_grid TEXT,
  result_json TEXT NOT NULL,
  computed_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (team_id, session_id)
);

CREATE TABLE IF NOT EXISTS round2_team_drafts (
  team_id TEXT PRIMARY KEY,
  price DOUBLE PRECISION,
  selections_json TEXT NOT NULL,
  updated_by TEXT,
  updated_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS teacher_actions (
  id BIGSERIAL PRIMARY KEY,
  action TEXT NOT NULL,
  team_id TEXT,
  member_id TEXT,
  details TEXT,
  performed_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS team_runs (
  id TEXT PRIMARY KEY,
  team_id TEXT NOT NULL,
  team_name TEXT NOT NULL,
  created_at TEXT NOT NULL,
  run_date TEXT NOT NULL,
  run_time TEXT NOT NULL,
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
  run_date TEXT NOT NULL,
  run_time TEXT NOT NULL
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
  cached BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TEXT NOT NULL,
  run_date TEXT NOT NULL,
  run_time TEXT NOT NULL
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
  cached BOOLEAN NOT NULL DEFAULT FALSE,
  success BOOLEAN NOT NULL DEFAULT FALSE,
  error_text TEXT,
  created_at TEXT NOT NULL,
  run_date TEXT NOT NULL,
  run_time TEXT NOT NULL
);

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

CREATE TABLE IF NOT EXISTS debrief_cache (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  round INTEGER NOT NULL,
  type TEXT NOT NULL,
  content TEXT NOT NULL,
  generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_students_team ON students(team_id);
CREATE INDEX IF NOT EXISTS idx_students_group ON students(group_label);
CREATE INDEX IF NOT EXISTS idx_comp_log_team ON computation_log(team_id);
CREATE INDEX IF NOT EXISTS idx_comp_log_stage ON computation_log(stage);
CREATE INDEX IF NOT EXISTS idx_vp_iterations_team_created ON vp_iterations(team_id, iteration, created_at);
CREATE INDEX IF NOT EXISTS idx_teacher_actions_team_time ON teacher_actions(team_id, performed_at DESC);
CREATE INDEX IF NOT EXISTS idx_team_runs_team ON team_runs(team_id);
CREATE INDEX IF NOT EXISTS idx_team_runs_created ON team_runs(created_at);
CREATE INDEX IF NOT EXISTS idx_iter_team ON iteration_events(team_id);
CREATE INDEX IF NOT EXISTS idx_iter_created ON iteration_events(created_at);
CREATE INDEX IF NOT EXISTS idx_llm_outputs_team_step ON llm_wizard_outputs(team_key, step);
CREATE INDEX IF NOT EXISTS idx_llm_outputs_cache ON llm_wizard_outputs(cache_key);
CREATE INDEX IF NOT EXISTS idx_llm_metrics_team_step ON llm_call_metrics(team_key, step);
CREATE INDEX IF NOT EXISTS idx_llm_metrics_created ON llm_call_metrics(created_at);
CREATE INDEX IF NOT EXISTS idx_vp_sessions_team_key ON vp_sessions(team_key);
CREATE INDEX IF NOT EXISTS idx_marketing_sessions_team_key ON marketing_sessions(team_key);
CREATE INDEX IF NOT EXISTS idx_debrief_cache_lookup ON debrief_cache(session_id, round, type);
