"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { Pool } = require("pg");
const CAP_GROUPS = require("../../data/capability_groups_v2.json");
const { applyTechJinnang } = require("../../server/multiplayer/rdTeamAdapter");
const { scoreProduct } = require("./decision_tracker");
const { writeRunManifest } = require("./run_manifest");

const CAPABILITY_MAP = new Map();
for (const group of CAP_GROUPS.groups || []) {
  for (const capability of group.capabilities || []) {
    CAPABILITY_MAP.set(capability.cap_id, {
      cap_id: capability.cap_id,
      cap_name: capability.name,
      dimension: group.group_id
    });
  }
}

const STUDENT_CSV_COLUMNS = [
  "run_id", "team_index", "member_index", "name", "persona", "gender", "mbti", "age", "education", "has_overseas", "industry",
  "seed_memory_json", "classroom_profile_json",
  "subjective_state_json", "swtp_basis", "swtp_value", "swtp_call_version", "structured_profile_key", "simple_prompt_template",
  "harness_reports_shown", "harness_reports_total", "harness_anchor_mode", "harness_price_hints_count",
  "harness_selection_rounds", "harness_triggered_revision", "harness_validate_depth",
  "harness_violations_detected", "harness_violations_actual", "harness_card_order",
  "jinang_market", "jinang_tech", "jinang_market_match", "jinang_tech_match",
  "r1_grid", "r1_arch", "r1_personal_wtp_adj",
  "r1_who", "r1_pain", "r1_how",
  "r2_dims", "r2_interview_turns",
  "r2_evi", "r2_evidence_count", "r2_strong_dim_count", "r2_missing_dim_count",
  "r2_radar_perception", "r2_radar_motion", "r2_radar_interaction", "r2_radar_safety", "r2_radar_extension", "r2_radar_maintenance",
  "r2_cards_selected", "r2_high_tier_count", "r2_jinang_dCOGS_saved"
];

const TEAM_CSV_COLUMNS = [
  "run_id", "team_index", "grid", "arch",
  "r1_wtp_ref", "r1_sam_billion", "r1_rho_c", "r1_wtp_multiplier", "r1_wtp_mult_compressed",
  "r1_wtp_adj", "market_space",
  "vp_C", "vp_G", "vp_E",
  "vp_who_specificity", "vp_pain_has_trigger", "vp_how_has_mechanism", "vp_coach_turns_total",
  "vp_iterations", "vp_initial_score", "vp_final_score", "vp_best_score", "vp_best_iteration", "vp_used_best", "vp_improvement_pct",
  "r2_cards", "r2_dCOGS", "r2_NRE", "r2_budget_utilization", "r2_high_tier_count", "r2_violation_count",
  "r2_price", "r2_price_vs_wtp", "coverCore", "coverNice", "r2_vscore", "r2_gross_margin",
  "r2_share", "r2_units", "r2_profit_hw", "r2_profit_sub", "r2_profit", "r2_is_profitable",
  "jinang_dCOGS_saved_total", "total_llm_calls", "total_tokens"
];

const VP_CSV_COLUMNS = [
  "run_id", "team_index", "iteration", "trigger", "speaker_persona", "speaker_name",
  "vp_text",
  "vp_who", "vp_pain", "vp_how",
  "score_C", "score_G", "score_E", "score_product",
  "who_changed", "pain_changed", "how_changed", "coach_reply", "speaker_reply"
];

const INTERVIEW_LOG_COLUMNS = [
  "run_id", "team_index", "member_index", "member_name", "member_persona",
  "interview_persona_id", "interview_persona_name",
  "turn_number", "role", "message_text"
];

const VP_CHAT_LOG_COLUMNS = [
  "run_id", "team_index", "round_number",
  "coach_message",
  "speaker_persona", "speaker_name", "speaker_reply",
  "lead_writer_persona", "lead_writer_name",
  "vp_before", "vp_after",
  "score_product_before", "score_product_after",
  "score_C", "score_G", "score_E"
];

const JINANG_CSV_COLUMNS = [
  "run_id", "team_index", "member_name", "persona", "jinang_tech_name", "match_strength",
  "cap_id", "cap_name", "dimension", "tier",
  "original_dCOGS", "discounted_dCOGS", "saving", "original_risk", "discounted_risk", "risk_saving"
];

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function csvValue(value) {
  if (value == null) return "";
  const text = typeof value === "object" ? JSON.stringify(value) : String(value);
  if (/[,"\n]/.test(text)) {
    return `"${text.replace(/"/g, "\"\"")}"`;
  }
  return text;
}

function writeCsv(filePath, columns, rows) {
  ensureDir(path.dirname(filePath));
  const lines = [columns.join(",")];
  for (const row of rows) {
    lines.push(columns.map((column) => csvValue(row[column])).join(","));
  }
  fs.writeFileSync(filePath, `${lines.join("\n")}\n`);
}

function sumTokens(entries) {
  return (entries || []).reduce((sum, entry) => {
    const total = Number(entry?.tokens?.total_tokens || entry?.tokens?.totalTokens || 0);
    return sum + (Number.isFinite(total) ? total : 0);
  }, 0);
}

function flattenStudentRow(runId, tracker, member, jinangSaving) {
  return {
    run_id: runId,
    team_index: tracker.teamIndex,
    member_index: member.memberIndex,
    name: member.name,
    persona: member.personaLabel,
    gender: member.gender,
    mbti: member.mbti,
    age: member.age,
    education: member.education,
    has_overseas: member.hasOverseas,
    industry: member.industry,
    seed_memory_json: member.seed_memory_json ? JSON.stringify(member.seed_memory_json) : "",
    classroom_profile_json: member.classroom_profile_json ? JSON.stringify(member.classroom_profile_json) : "",
    subjective_state_json: member.subjective_state_json ? JSON.stringify(member.subjective_state_json) : "",
    swtp_basis: member.swtp_basis || "",
    swtp_value: member.swtp_value,
    swtp_call_version: member.swtp_call_version || "",
    structured_profile_key: member.structured_profile_key || "",
    simple_prompt_template: member.simple_prompt_template || "",
    harness_reports_shown: member.harness_reports_shown,
    harness_reports_total: member.harness_reports_total,
    harness_anchor_mode: member.harness_anchor_mode,
    harness_price_hints_count: member.harness_price_hints_count,
    harness_selection_rounds: member.harness_selection_rounds,
    harness_triggered_revision: member.harness_triggered_revision,
    harness_validate_depth: member.harness_validate_depth,
    harness_violations_detected: member.harness_violations_detected,
    harness_violations_actual: member.harness_violations_actual,
    harness_card_order: member.harness_card_order,
    jinang_market: member.jinang_market?.name || member.jinang_market?.id || "",
    jinang_tech: member.jinang_tech?.name || member.jinang_tech?.id || "",
    jinang_market_match: member.jinang_market_match,
    jinang_tech_match: member.jinang_tech_match,
    r1_grid: member.r1_grid_id,
    r1_arch: member.r1_architecture,
    r1_personal_wtp_adj: member.r1_personal_wtp_adj,
    r1_who: member.r1_who,
    r1_pain: member.r1_pain,
    r1_how: member.r1_how,
    r2_dims: JSON.stringify(member.r2_assigned_dims || []),
    r2_interview_turns: member.r2_interview_turns,
    r2_evi: member.r2_evi,
    r2_evidence_count: member.r2_evidence_count,
    r2_strong_dim_count: member.r2_strong_dim_count,
    r2_missing_dim_count: member.r2_missing_dim_count,
    r2_radar_perception: member.r2_radar_scores?.perception,
    r2_radar_motion: member.r2_radar_scores?.motion,
    r2_radar_interaction: member.r2_radar_scores?.interaction,
    r2_radar_safety: member.r2_radar_scores?.safety,
    r2_radar_extension: member.r2_radar_scores?.extend,
    r2_radar_maintenance: member.r2_radar_scores?.ops,
    r2_cards_selected: (member.r2_personal_selections || []).length,
    r2_high_tier_count: member.r2_high_tier_count,
    r2_jinang_dCOGS_saved: jinangSaving
  };
}

function extractVpField(vpText, key) {
  const text = String(vpText || "");
  const match = text.match(new RegExp(`${key}\\s*[：:]\\s*([^\\n]+)`));
  return match ? match[1].trim() : "";
}

class DataExporter {
  constructor(runId, outDir, logger, options = {}) {
    this.runId = runId;
    this.outDir = outDir;
    this.logger = logger || null;
    this.options = options;
    this.pool = new Pool();
  }

  async query(sql, params = []) {
    return this.pool.query(sql, params);
  }

  async createTables() {
    await this.query(`
      CREATE TABLE IF NOT EXISTS sim_students (
        id SERIAL PRIMARY KEY,
        run_id TEXT NOT NULL,
        team_id TEXT NOT NULL,
        team_index INTEGER NOT NULL,
        member_id TEXT NOT NULL,
        member_index INTEGER NOT NULL,
        name TEXT,
        persona_id CHAR(1),
        persona_label TEXT,
        gender TEXT,
        mbti CHAR(4),
        age INTEGER,
        education TEXT,
        has_overseas BOOLEAN,
        role TEXT,
        industry TEXT,
        seed_memory_json TEXT,
        classroom_profile_json TEXT,
        subjective_state_json TEXT,
        swtp_basis TEXT,
        swtp_value REAL,
        swtp_call_version TEXT,
        structured_profile_key TEXT,
        simple_prompt_template TEXT,
        harness_reports_shown INTEGER,
        harness_reports_total INTEGER,
        harness_anchor_mode TEXT,
        harness_price_hints_count INTEGER,
        harness_selection_rounds INTEGER,
        harness_triggered_revision BOOLEAN,
        harness_validate_depth TEXT,
        harness_violations_detected INTEGER,
        harness_violations_actual INTEGER,
        harness_card_order TEXT,
        jinang_market_id TEXT,
        jinang_market_name TEXT,
        jinang_tech_id TEXT,
        jinang_tech_name TEXT,
        r1_grid_id TEXT,
        r1_architecture TEXT,
        r1_who TEXT,
        r1_pain TEXT,
        r1_how TEXT,
        r1_personal_wtp_adj REAL,
        jinang_market_match REAL,
        jinang_tech_match REAL,
        r2_assigned_dims TEXT,
        r2_interview_turns INTEGER,
        r2_interview_summary TEXT,
        r2_radar_scores TEXT,
        r2_evi REAL,
        r2_evidence_count INTEGER,
        r2_strong_dim_count INTEGER,
        r2_missing_dim_count INTEGER,
        r2_personal_selections TEXT,
        r2_high_tier_count INTEGER,
        r2_jinang_tech_applied TEXT,
        created_at TIMESTAMP DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS sim_teams (
        id SERIAL PRIMARY KEY,
        run_id TEXT NOT NULL,
        team_id TEXT NOT NULL,
        team_index INTEGER NOT NULL,
        final_grid_id TEXT,
        final_architecture TEXT,
        r1_wtp_ref REAL,
        r1_sam_billion REAL,
        r1_rho_c REAL,
        r1_wtp_multiplier REAL,
        r1_wtp_mult_compressed REAL,
        r1_wtp_adj REAL,
        target_gm REAL,
        market_space_tier TEXT,
        vp_score_c REAL,
        vp_score_g REAL,
        vp_score_e REAL,
        vp_who_specificity INTEGER,
        vp_pain_has_trigger INTEGER,
        vp_how_has_mechanism INTEGER,
        vp_coach_turns_total INTEGER,
        vp_total_iterations INTEGER,
        vp_initial_score REAL,
        vp_final_score REAL,
        vp_best_score REAL,
        vp_best_iteration TEXT,
        vp_used_best BOOLEAN,
        vp_improvement REAL,
        r2_team_card_count INTEGER,
        r2_total_dCOGS REAL,
        r2_total_NRE REAL,
        r2_budget_utilization REAL,
        r2_high_tier_count INTEGER,
        r2_violation_count INTEGER,
        r2_price REAL,
        r2_price_vs_wtp REAL,
        r2_cover_core REAL,
        r2_cover_nice REAL,
        r2_share REAL,
        r2_units REAL,
        r2_revenue REAL,
        r2_gross_margin REAL,
        r2_profit_hw REAL,
        r2_profit_sub REAL,
        r2_profit REAL,
        r2_is_profitable BOOLEAN,
        jinang_tech_discount_total REAL,
        total_llm_calls INTEGER,
        total_tokens INTEGER,
        total_duration_ms INTEGER,
        created_at TIMESTAMP DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS sim_vp_iterations (
        id SERIAL PRIMARY KEY,
        run_id TEXT NOT NULL,
        team_id TEXT NOT NULL,
        team_index INTEGER NOT NULL,
        iteration INTEGER NOT NULL,
        trigger TEXT NOT NULL,
        speaker_member_id TEXT,
        speaker_persona CHAR(1),
        speaker_name TEXT,
        vp_text TEXT,
        vp_who TEXT,
        vp_pain TEXT,
        vp_how TEXT,
        score_c REAL,
        score_g REAL,
        score_e REAL,
        score_product REAL,
        who_changed BOOLEAN,
        pain_changed BOOLEAN,
        how_changed BOOLEAN,
        coach_reply TEXT,
        speaker_reply TEXT,
        created_at TIMESTAMP DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS sim_interview_log (
        id SERIAL PRIMARY KEY,
        run_id TEXT NOT NULL,
        team_id TEXT NOT NULL,
        team_index INTEGER NOT NULL,
        member_id TEXT NOT NULL,
        member_index INTEGER NOT NULL,
        member_name TEXT,
        member_persona TEXT,
        interview_persona_id TEXT,
        interview_persona_name TEXT,
        turn_number INTEGER NOT NULL,
        role TEXT NOT NULL,
        message_text TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS sim_vp_chat_log (
        id SERIAL PRIMARY KEY,
        run_id TEXT NOT NULL,
        team_id TEXT NOT NULL,
        team_index INTEGER NOT NULL,
        round_number INTEGER NOT NULL,
        coach_message TEXT,
        speaker_persona TEXT,
        speaker_name TEXT,
        speaker_reply TEXT,
        lead_writer_persona TEXT,
        lead_writer_name TEXT,
        vp_before TEXT,
        vp_after TEXT,
        score_product_before REAL,
        score_product_after REAL,
        score_c REAL,
        score_g REAL,
        score_e REAL,
        created_at TIMESTAMP DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS sim_jinang_effects (
        id SERIAL PRIMARY KEY,
        run_id TEXT NOT NULL,
        team_id TEXT NOT NULL,
        member_id TEXT NOT NULL,
        persona_id CHAR(1),
        jinang_tech_id TEXT,
        jinang_tech_name TEXT,
        jinang_match_strength REAL,
        cap_id TEXT,
        cap_name TEXT,
        dimension TEXT,
        tier TEXT,
        original_dCOGS REAL,
        discounted_dCOGS REAL,
        dCOGS_saving REAL,
        original_risk REAL,
        discounted_risk REAL,
        risk_saving REAL,
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);
    await this.query("ALTER TABLE sim_students ADD COLUMN IF NOT EXISTS has_overseas BOOLEAN");
    await this.query("ALTER TABLE sim_students ADD COLUMN IF NOT EXISTS r1_personal_wtp_adj REAL");
    await this.query("ALTER TABLE sim_students ADD COLUMN IF NOT EXISTS seed_memory_json TEXT");
    await this.query("ALTER TABLE sim_students ADD COLUMN IF NOT EXISTS classroom_profile_json TEXT");
    await this.query("ALTER TABLE sim_students ADD COLUMN IF NOT EXISTS subjective_state_json TEXT");
    await this.query("ALTER TABLE sim_students ADD COLUMN IF NOT EXISTS swtp_basis TEXT");
    await this.query("ALTER TABLE sim_students ADD COLUMN IF NOT EXISTS swtp_value REAL");
    await this.query("ALTER TABLE sim_students ADD COLUMN IF NOT EXISTS swtp_call_version TEXT");
    await this.query("ALTER TABLE sim_students ADD COLUMN IF NOT EXISTS structured_profile_key TEXT");
    await this.query("ALTER TABLE sim_students ADD COLUMN IF NOT EXISTS simple_prompt_template TEXT");
    await this.query("ALTER TABLE sim_students ADD COLUMN IF NOT EXISTS harness_reports_shown INTEGER");
    await this.query("ALTER TABLE sim_students ADD COLUMN IF NOT EXISTS harness_reports_total INTEGER");
    await this.query("ALTER TABLE sim_students ADD COLUMN IF NOT EXISTS harness_anchor_mode TEXT");
    await this.query("ALTER TABLE sim_students ADD COLUMN IF NOT EXISTS harness_price_hints_count INTEGER");
    await this.query("ALTER TABLE sim_students ADD COLUMN IF NOT EXISTS harness_selection_rounds INTEGER");
    await this.query("ALTER TABLE sim_students ADD COLUMN IF NOT EXISTS harness_triggered_revision BOOLEAN");
    await this.query("ALTER TABLE sim_students ADD COLUMN IF NOT EXISTS harness_validate_depth TEXT");
    await this.query("ALTER TABLE sim_students ADD COLUMN IF NOT EXISTS harness_violations_detected INTEGER");
    await this.query("ALTER TABLE sim_students ADD COLUMN IF NOT EXISTS harness_violations_actual INTEGER");
    await this.query("ALTER TABLE sim_students ADD COLUMN IF NOT EXISTS harness_card_order TEXT");
    await this.query("ALTER TABLE sim_teams ADD COLUMN IF NOT EXISTS r1_wtp_mult_compressed REAL");
    await this.query("ALTER TABLE sim_teams ADD COLUMN IF NOT EXISTS r1_wtp_adj REAL");
    await this.query("ALTER TABLE sim_teams ADD COLUMN IF NOT EXISTS vp_best_score REAL");
    await this.query("ALTER TABLE sim_teams ADD COLUMN IF NOT EXISTS vp_best_iteration TEXT");
    await this.query("ALTER TABLE sim_teams ALTER COLUMN vp_best_iteration TYPE TEXT USING vp_best_iteration::TEXT");
    await this.query("ALTER TABLE sim_teams ADD COLUMN IF NOT EXISTS vp_used_best BOOLEAN");
    await this.query("ALTER TABLE sim_teams ADD COLUMN IF NOT EXISTS r2_cover_core REAL");
    await this.query("ALTER TABLE sim_teams ADD COLUMN IF NOT EXISTS r2_cover_nice REAL");
    await this.query("ALTER TABLE sim_vp_iterations ADD COLUMN IF NOT EXISTS vp_text TEXT");
    await this.query("ALTER TABLE sim_vp_iterations ADD COLUMN IF NOT EXISTS speaker_reply TEXT");
  }

  async clearRun() {
    await this.query("DELETE FROM sim_jinang_effects WHERE run_id = $1", [this.runId]);
    await this.query("DELETE FROM sim_vp_chat_log WHERE run_id = $1", [this.runId]);
    await this.query("DELETE FROM sim_interview_log WHERE run_id = $1", [this.runId]);
    await this.query("DELETE FROM sim_vp_iterations WHERE run_id = $1", [this.runId]);
    await this.query("DELETE FROM sim_students WHERE run_id = $1", [this.runId]);
    await this.query("DELETE FROM sim_teams WHERE run_id = $1", [this.runId]);
  }

  loggerEntriesForTeam(teamId) {
    if (!this.logger || !Array.isArray(this.logger.entries)) return [];
    return this.logger.entries.filter((entry) => entry.teamId === teamId);
  }

  async loadTechSettlements(teamIds) {
    if (!teamIds.length) return new Map();
    const { rows } = await this.query(
      "SELECT team_id, member_id, jinang_id, matched, effect_applied FROM jinang_settlements WHERE team_id = ANY($1::text[]) AND jinang_type = 'tech'",
      [teamIds]
    );
    const map = new Map();
    for (const row of rows) {
      map.set(`${row.team_id}:${row.member_id}`, row);
    }
    return map;
  }

  buildJinangEffectRows(trackers, settlementMap) {
    const rows = [];
    for (const tracker of trackers) {
      for (const member of Object.values(tracker.members)) {
        const settlement = settlementMap.get(`${tracker.teamId}:${member.memberId}`);
        if (!settlement || !settlement.matched) continue;
        let effectApplied = {};
        try {
          effectApplied = typeof settlement.effect_applied === "object"
            ? settlement.effect_applied
            : JSON.parse(settlement.effect_applied || "{}");
        } catch (_) {
          effectApplied = {};
        }
        const techPayload = {
          effect_applied: effectApplied,
          match_strength: effectApplied.match_strength || member.jinang_tech_match || 0
        };
        const adjusted = applyTechJinnang(member.r2_personal_selections || [], techPayload);
        for (const item of adjusted) {
          const saving = Number(item.dCOGS_base || 0) - Number(item.dCOGS_eff || 0);
          const riskSaving = Number(item.risk_base || 0) - Number(item.risk_eff || 0);
          if (saving <= 0 && riskSaving <= 0) continue;
          const meta = CAPABILITY_MAP.get(item.cap_id) || {};
          rows.push({
            run_id: this.runId,
            team_id: tracker.teamId,
            member_id: member.memberId,
            persona_id: member.persona,
            jinang_tech_id: member.jinang_tech?.id || settlement.jinang_id || null,
            jinang_tech_name: member.jinang_tech?.name || null,
            jinang_match_strength: member.jinang_tech_match,
            cap_id: item.cap_id,
            cap_name: meta.cap_name || item.cap_id,
            dimension: meta.dimension || null,
            tier: item.tier,
            original_dCOGS: Number(item.dCOGS_base || 0),
            discounted_dCOGS: Number(item.dCOGS_eff || 0),
            dCOGS_saving: saving,
            original_risk: Number(item.risk_base || 0),
            discounted_risk: Number(item.risk_eff || 0),
            risk_saving: riskSaving
          });
        }
      }
    }
    return rows;
  }

  async insertStudents(trackers, jinangRows) {
    const savingByMember = new Map();
    for (const row of jinangRows) {
      const key = `${row.team_id}:${row.member_id}`;
      savingByMember.set(key, (savingByMember.get(key) || 0) + Number(row.dCOGS_saving || 0));
    }

    const csvRows = [];
    for (const tracker of trackers) {
      for (const member of Object.values(tracker.members)) {
        await this.query(`
          INSERT INTO sim_students (
            run_id, team_id, team_index, member_id, member_index, name, persona_id, persona_label, gender, mbti, age,
            education, has_overseas, role, industry, seed_memory_json, classroom_profile_json, subjective_state_json, swtp_basis, swtp_value, swtp_call_version, structured_profile_key, simple_prompt_template,
            harness_reports_shown, harness_reports_total, harness_anchor_mode, harness_price_hints_count, harness_selection_rounds,
            harness_triggered_revision, harness_validate_depth, harness_violations_detected, harness_violations_actual, harness_card_order,
            jinang_market_id, jinang_market_name, jinang_tech_id, jinang_tech_name,
            r1_grid_id, r1_architecture, r1_who, r1_pain, r1_how, r1_personal_wtp_adj, jinang_market_match, jinang_tech_match,
            r2_assigned_dims, r2_interview_turns, r2_interview_summary, r2_radar_scores, r2_evi, r2_evidence_count,
            r2_strong_dim_count, r2_missing_dim_count, r2_personal_selections, r2_high_tier_count, r2_jinang_tech_applied
          ) VALUES (
            $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,
            $12,$13,$14,$15,$16,$17,$18,$19,$20,$21,
            $22,$23,$24,$25,$26,$27,$28,$29,$30,$31,
            $32,$33,$34,$35,$36,$37,$38,$39,$40,$41,
            $42,$43,$44,$45,$46,$47,$48,$49,$50,$51,
            $52,$53,$54,$55,$56
          )
        `, [
          this.runId, tracker.teamId, tracker.teamIndex, member.memberId, member.memberIndex, member.name, member.persona,
          member.personaLabel, member.gender, member.mbti, member.age, member.education, member.hasOverseas, member.role, member.industry,
          member.seed_memory_json ? JSON.stringify(member.seed_memory_json) : null,
          member.classroom_profile_json ? JSON.stringify(member.classroom_profile_json) : null,
          member.subjective_state_json ? JSON.stringify(member.subjective_state_json) : null,
          member.swtp_basis || null,
          member.swtp_value,
          member.swtp_call_version || null,
          member.structured_profile_key || null,
          member.simple_prompt_template || null,
          member.harness_reports_shown, member.harness_reports_total, member.harness_anchor_mode || null,
          member.harness_price_hints_count, member.harness_selection_rounds, member.harness_triggered_revision,
          member.harness_validate_depth || null, member.harness_violations_detected, member.harness_violations_actual,
          member.harness_card_order || null,
          member.jinang_market?.id || null, member.jinang_market?.name || null, member.jinang_tech?.id || null, member.jinang_tech?.name || null,
          member.r1_grid_id, member.r1_architecture, member.r1_who, member.r1_pain, member.r1_how, member.r1_personal_wtp_adj,
          member.jinang_market_match, member.jinang_tech_match, JSON.stringify(member.r2_assigned_dims || []), member.r2_interview_turns,
          member.r2_interview_summary, JSON.stringify(member.r2_radar_scores || {}), member.r2_evi, member.r2_evidence_count,
          member.r2_strong_dim_count, member.r2_missing_dim_count, JSON.stringify(member.r2_personal_selections || []),
          member.r2_high_tier_count, JSON.stringify(member.jinang_tech_applied || [])
        ]);
        csvRows.push(flattenStudentRow(this.runId, tracker, member, Number(savingByMember.get(`${tracker.teamId}:${member.memberId}`) || 0).toFixed(2)));
      }
    }
    writeCsv(path.join(this.outDir, "students_summary.csv"), STUDENT_CSV_COLUMNS, csvRows);
    return csvRows;
  }

  async insertTeams(trackers, jinangRows) {
    const savingByTeam = new Map();
    for (const row of jinangRows) {
      savingByTeam.set(row.team_id, (savingByTeam.get(row.team_id) || 0) + Number(row.dCOGS_saving || 0));
    }
    const csvRows = [];
    for (const tracker of trackers) {
      const r1WtpMultCompressed = tracker.team.r1_wtp_mult_compressed;
      const r1WtpAdj = tracker.team.r1_wtp_adj;
      const llmEntries = this.loggerEntriesForTeam(tracker.teamId).filter((entry) => entry.type === "student_llm");
      const totalDuration = llmEntries.reduce((sum, entry) => sum + Number(entry.durationMs || 0), 0);
      const totalTokens = sumTokens(llmEntries);
      const row = {
        run_id: this.runId,
        team_id: tracker.teamId,
        team_index: tracker.teamIndex,
        final_grid_id: tracker.team.finalGrid,
        final_architecture: tracker.team.finalArch,
        r1_wtp_ref: tracker.team.r1_wtp_ref,
        r1_sam_billion: tracker.team.r1_sam_billion,
        r1_rho_c: tracker.team.r1_rho_c,
        r1_wtp_multiplier: tracker.team.r1_wtp_multiplier,
        r1_wtp_mult_compressed: r1WtpMultCompressed,
        r1_wtp_adj: r1WtpAdj,
        target_gm: tracker.team.target_gm,
        market_space_tier: tracker.team.market_space_tier,
        vp_score_c: tracker.team.vp_score_c,
        vp_score_g: tracker.team.vp_score_g,
        vp_score_e: tracker.team.vp_score_e,
        vp_who_specificity: tracker.team.vp_who_specificity,
        vp_pain_has_trigger: tracker.team.vp_pain_has_trigger,
        vp_how_has_mechanism: tracker.team.vp_how_has_mechanism,
        vp_coach_turns_total: tracker.team.vp_coach_turns_total,
        vp_total_iterations: tracker.team.vp_total_iterations,
        vp_initial_score: tracker.team.vp_initial_score,
        vp_final_score: tracker.team.vp_final_score,
        vp_best_score: tracker.team.vp_best_score,
        vp_best_iteration: tracker.team.vp_best_iteration,
        vp_used_best: tracker.team.vp_used_best === true,
        vp_improvement: tracker.team.vp_improvement,
        r2_team_card_count: tracker.team.r2_team_card_count,
        r2_total_dCOGS: tracker.team.r2_total_dCOGS,
        r2_total_NRE: tracker.team.r2_total_NRE,
        r2_budget_utilization: tracker.team.r2_budget_utilization,
        r2_high_tier_count: tracker.team.r2_high_tier_count,
        r2_violation_count: tracker.team.r2_violation_count,
        r2_price: tracker.team.r2_finalPrice,
        r2_price_vs_wtp: tracker.team.r2_price_vs_wtp,
        r2_cover_core: tracker.team.r2_coverCore,
        r2_cover_nice: tracker.team.r2_coverNice,
        r2_share: tracker.team.r2_share,
        r2_units: tracker.team.r2_units,
        r2_revenue: tracker.team.r2_revenue,
        r2_gross_margin: tracker.team.r2_gross_margin,
        r2_profit_hw: tracker.team.r2_profit_hw,
        r2_profit_sub: tracker.team.r2_profit_sub,
        r2_profit: tracker.team.r2_profit,
        r2_is_profitable: tracker.team.r2_is_profitable,
        jinang_tech_discount_total: Number(savingByTeam.get(tracker.teamId) || 0),
        total_llm_calls: llmEntries.length,
        total_tokens: totalTokens,
        total_duration_ms: totalDuration
      };

      await this.query(`
        INSERT INTO sim_teams (
          run_id, team_id, team_index, final_grid_id, final_architecture, r1_wtp_ref, r1_sam_billion, r1_rho_c,
          r1_wtp_multiplier, r1_wtp_mult_compressed, r1_wtp_adj, target_gm, market_space_tier, vp_score_c, vp_score_g, vp_score_e,
          vp_who_specificity, vp_pain_has_trigger, vp_how_has_mechanism, vp_coach_turns_total, vp_total_iterations,
          vp_initial_score, vp_final_score, vp_best_score, vp_best_iteration, vp_used_best, vp_improvement, r2_team_card_count, r2_total_dCOGS, r2_total_NRE,
          r2_budget_utilization, r2_high_tier_count, r2_violation_count, r2_price, r2_price_vs_wtp, r2_cover_core,
          r2_cover_nice, r2_share, r2_units, r2_revenue, r2_gross_margin, r2_profit_hw, r2_profit_sub, r2_profit,
          r2_is_profitable, jinang_tech_discount_total, total_llm_calls, total_tokens, total_duration_ms
        ) VALUES (
          $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,
          $27,$28,$29,$30,$31,$32,$33,$34,$35,$36,$37,$38,$39,$40,$41,$42,$43,$44,$45,$46,$47,$48,$49
        )
      `, [
        row.run_id, row.team_id, row.team_index, row.final_grid_id, row.final_architecture, row.r1_wtp_ref, row.r1_sam_billion,
        row.r1_rho_c, row.r1_wtp_multiplier, row.r1_wtp_mult_compressed, row.r1_wtp_adj, row.target_gm, row.market_space_tier,
        row.vp_score_c, row.vp_score_g, row.vp_score_e, row.vp_who_specificity, row.vp_pain_has_trigger,
        row.vp_how_has_mechanism, row.vp_coach_turns_total, row.vp_total_iterations, row.vp_initial_score, row.vp_final_score,
        row.vp_best_score, row.vp_best_iteration, row.vp_used_best, row.vp_improvement, row.r2_team_card_count,
        row.r2_total_dCOGS, row.r2_total_NRE, row.r2_budget_utilization, row.r2_high_tier_count, row.r2_violation_count,
        row.r2_price, row.r2_price_vs_wtp, row.r2_cover_core, row.r2_cover_nice, row.r2_share, row.r2_units,
        row.r2_revenue, row.r2_gross_margin, row.r2_profit_hw, row.r2_profit_sub, row.r2_profit, row.r2_is_profitable,
        row.jinang_tech_discount_total, row.total_llm_calls, row.total_tokens, row.total_duration_ms
      ]);

      csvRows.push({
        run_id: this.runId,
        team_index: tracker.teamIndex,
        grid: tracker.team.finalGrid,
        arch: tracker.team.finalArch,
        r1_wtp_ref: tracker.team.r1_wtp_ref,
        r1_sam_billion: tracker.team.r1_sam_billion,
        r1_rho_c: tracker.team.r1_rho_c,
        r1_wtp_multiplier: tracker.team.r1_wtp_multiplier,
        r1_wtp_mult_compressed: r1WtpMultCompressed,
        r1_wtp_adj: r1WtpAdj,
        market_space: tracker.team.market_space_tier,
        vp_C: tracker.team.vp_score_c,
        vp_G: tracker.team.vp_score_g,
        vp_E: tracker.team.vp_score_e,
        vp_who_specificity: tracker.team.vp_who_specificity,
        vp_pain_has_trigger: tracker.team.vp_pain_has_trigger,
        vp_how_has_mechanism: tracker.team.vp_how_has_mechanism,
        vp_coach_turns_total: tracker.team.vp_coach_turns_total,
        vp_iterations: tracker.team.vp_total_iterations,
        vp_initial_score: tracker.team.vp_initial_score,
        vp_final_score: tracker.team.vp_final_score,
        vp_best_score: tracker.team.vp_best_score,
        vp_best_iteration: tracker.team.vp_best_iteration,
        vp_used_best: tracker.team.vp_used_best === true,
        vp_improvement_pct: tracker.team.vp_improvement,
        r2_cards: tracker.team.r2_team_card_count,
        r2_dCOGS: tracker.team.r2_total_dCOGS,
        r2_NRE: tracker.team.r2_total_NRE,
        r2_budget_utilization: tracker.team.r2_budget_utilization,
        r2_high_tier_count: tracker.team.r2_high_tier_count,
        r2_violation_count: tracker.team.r2_violation_count,
        r2_price: tracker.team.r2_finalPrice,
        r2_price_vs_wtp: tracker.team.r2_price_vs_wtp,
        coverCore: tracker.team.r2_coverCore,
        coverNice: tracker.team.r2_coverNice,
        r2_vscore: tracker.team.r2_vscore,
        r2_gross_margin: tracker.team.r2_gross_margin,
        r2_share: tracker.team.r2_share,
        r2_units: tracker.team.r2_units,
        r2_profit_hw: tracker.team.r2_profit_hw,
        r2_profit_sub: tracker.team.r2_profit_sub,
        r2_profit: tracker.team.r2_profit,
        r2_is_profitable: tracker.team.r2_is_profitable,
        jinang_dCOGS_saved_total: Number(savingByTeam.get(tracker.teamId) || 0).toFixed(2),
        total_llm_calls: llmEntries.length,
        total_tokens: totalTokens
      });
    }
    writeCsv(path.join(this.outDir, "teams_summary.csv"), TEAM_CSV_COLUMNS, csvRows);
    return csvRows;
  }

  async insertVpIterations(trackers) {
    const csvRows = [];
    for (const tracker of trackers) {
      for (const iteration of tracker.team.vpIterations) {
        const scores = iteration.scores || {};
        const product = scoreProduct(scores);
        await this.query(`
          INSERT INTO sim_vp_iterations (
            run_id, team_id, team_index, iteration, trigger, speaker_member_id, speaker_persona, speaker_name,
            vp_text, vp_who, vp_pain, vp_how, score_c, score_g, score_e, score_product, who_changed, pain_changed, how_changed, coach_reply, speaker_reply
          ) VALUES (
            $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21
          )
        `, [
          this.runId, tracker.teamId, tracker.teamIndex, iteration.iteration, iteration.trigger,
          iteration.speaker?.memberId || null, iteration.speaker?.persona || null, iteration.speaker?.name || null,
          iteration.vp_text || null,
          extractVpField(iteration.vp_text, "WHO") || null,
          extractVpField(iteration.vp_text, "PAIN") || null,
          extractVpField(iteration.vp_text, "HOW") || null,
          scores.C, scores.G, scores.E, product, iteration.changes?.who_changed ?? null,
          iteration.changes?.pain_changed ?? null, iteration.changes?.how_changed ?? null, iteration.coach_reply, iteration.speaker_reply
        ]);
        csvRows.push({
          run_id: this.runId,
          team_index: tracker.teamIndex,
          iteration: iteration.iteration,
          trigger: iteration.trigger,
          speaker_persona: iteration.speaker?.persona || "",
          speaker_name: iteration.speaker?.name || "",
          vp_text: iteration.vp_text || "",
          vp_who: extractVpField(iteration.vp_text, "WHO"),
          vp_pain: extractVpField(iteration.vp_text, "PAIN"),
          vp_how: extractVpField(iteration.vp_text, "HOW"),
          score_C: scores.C,
          score_G: scores.G,
          score_E: scores.E,
          score_product: product,
          who_changed: iteration.changes?.who_changed ?? "",
          pain_changed: iteration.changes?.pain_changed ?? "",
          how_changed: iteration.changes?.how_changed ?? "",
          coach_reply: iteration.coach_reply || "",
          speaker_reply: iteration.speaker_reply || ""
        });
      }
    }
    writeCsv(path.join(this.outDir, "vp_iterations.csv"), VP_CSV_COLUMNS, csvRows);
    return csvRows;
  }

  async insertInterviewLogs(trackers) {
    const csvRows = [];
    for (const tracker of trackers) {
      for (const member of Object.values(tracker.members || {})) {
        for (const entry of member.interviewLog || []) {
          await this.query(`
            INSERT INTO sim_interview_log (
              run_id, team_id, team_index, member_id, member_index, member_name, member_persona,
              interview_persona_id, interview_persona_name, turn_number, role, message_text
            ) VALUES (
              $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12
            )
          `, [
            this.runId, tracker.teamId, tracker.teamIndex, member.memberId, member.memberIndex, member.name, member.personaLabel,
            entry.interview_persona_id || member.interview_persona_id || null,
            entry.interview_persona_name || member.interview_persona_name || null,
            entry.turn_number, entry.role, entry.message_text
          ]);
          csvRows.push({
            run_id: this.runId,
            team_index: tracker.teamIndex,
            member_index: member.memberIndex,
            member_name: member.name || "",
            member_persona: member.personaLabel || "",
            interview_persona_id: entry.interview_persona_id || member.interview_persona_id || "",
            interview_persona_name: entry.interview_persona_name || member.interview_persona_name || "",
            turn_number: entry.turn_number,
            role: entry.role,
            message_text: entry.message_text
          });
        }
      }
    }
    writeCsv(path.join(this.outDir, "interview_log.csv"), INTERVIEW_LOG_COLUMNS, csvRows);
    return csvRows;
  }

  async insertVpChatLogs(trackers) {
    const csvRows = [];
    for (const tracker of trackers) {
      for (const entry of tracker.team.vpChatLogs || []) {
        await this.query(`
          INSERT INTO sim_vp_chat_log (
            run_id, team_id, team_index, round_number, coach_message, speaker_persona, speaker_name, speaker_reply,
            lead_writer_persona, lead_writer_name, vp_before, vp_after, score_product_before, score_product_after,
            score_c, score_g, score_e
          ) VALUES (
            $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17
          )
        `, [
          this.runId, tracker.teamId, tracker.teamIndex, entry.round_number, entry.coach_message, entry.speaker_persona,
          entry.speaker_name, entry.speaker_reply, entry.lead_writer_persona, entry.lead_writer_name, entry.vp_before,
          entry.vp_after, entry.score_product_before, entry.score_product_after, entry.score_C, entry.score_G, entry.score_E
        ]);
        csvRows.push({
          run_id: this.runId,
          team_index: tracker.teamIndex,
          round_number: entry.round_number,
          coach_message: entry.coach_message || "",
          speaker_persona: entry.speaker_persona || "",
          speaker_name: entry.speaker_name || "",
          speaker_reply: entry.speaker_reply || "",
          lead_writer_persona: entry.lead_writer_persona || "",
          lead_writer_name: entry.lead_writer_name || "",
          vp_before: entry.vp_before || "",
          vp_after: entry.vp_after || "",
          score_product_before: entry.score_product_before,
          score_product_after: entry.score_product_after,
          score_C: entry.score_C,
          score_G: entry.score_G,
          score_E: entry.score_E
        });
      }
    }
    writeCsv(path.join(this.outDir, "vp_chat_log.csv"), VP_CHAT_LOG_COLUMNS, csvRows);
    return csvRows;
  }

  async insertJinangEffects(jinangRows, trackers) {
    const nameMap = new Map();
    const personaMap = new Map();
    for (const tracker of trackers) {
      for (const member of Object.values(tracker.members)) {
        nameMap.set(`${tracker.teamId}:${member.memberId}`, member.name);
        personaMap.set(`${tracker.teamId}:${member.memberId}`, member.personaLabel);
      }
    }
    for (const row of jinangRows) {
      await this.query(`
        INSERT INTO sim_jinang_effects (
          run_id, team_id, member_id, persona_id, jinang_tech_id, jinang_tech_name, jinang_match_strength,
          cap_id, cap_name, dimension, tier, original_dCOGS, discounted_dCOGS, dCOGS_saving, original_risk, discounted_risk, risk_saving
        ) VALUES (
          $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17
        )
      `, [
        row.run_id, row.team_id, row.member_id, row.persona_id, row.jinang_tech_id, row.jinang_tech_name, row.jinang_match_strength,
        row.cap_id, row.cap_name, row.dimension, row.tier, row.original_dCOGS, row.discounted_dCOGS, row.dCOGS_saving,
        row.original_risk, row.discounted_risk, row.risk_saving
      ]);
    }

    const csvRows = jinangRows.map((row) => ({
      run_id: row.run_id,
      team_index: trackers.find((tracker) => tracker.teamId === row.team_id)?.teamIndex ?? "",
      member_name: nameMap.get(`${row.team_id}:${row.member_id}`) || row.member_id,
      persona: personaMap.get(`${row.team_id}:${row.member_id}`) || row.persona_id,
      jinang_tech_name: row.jinang_tech_name,
      match_strength: row.jinang_match_strength,
      cap_id: row.cap_id,
      cap_name: row.cap_name,
      dimension: row.dimension,
      tier: row.tier,
      original_dCOGS: row.original_dCOGS,
      discounted_dCOGS: row.discounted_dCOGS,
      saving: row.dCOGS_saving,
      original_risk: row.original_risk,
      discounted_risk: row.discounted_risk,
      risk_saving: row.risk_saving
    }));
    writeCsv(path.join(this.outDir, "jinang_effects.csv"), JINANG_CSV_COLUMNS, csvRows);
    return csvRows;
  }

  async exportAll(trackers) {
    const effectiveTrackers = (trackers || []).filter(Boolean);
    ensureDir(this.outDir);
    await this.createTables();
    await this.clearRun();
    const settlementMap = await this.loadTechSettlements(effectiveTrackers.map((tracker) => tracker.teamId).filter(Boolean));
    const jinangRows = this.buildJinangEffectRows(effectiveTrackers, settlementMap);
    const studentsRows = await this.insertStudents(effectiveTrackers, jinangRows);
    const teamRows = await this.insertTeams(effectiveTrackers, jinangRows);
    const vpRows = await this.insertVpIterations(effectiveTrackers);
    const interviewRows = await this.insertInterviewLogs(effectiveTrackers);
    const vpChatRows = await this.insertVpChatLogs(effectiveTrackers);
    const jinangCsvRows = await this.insertJinangEffects(jinangRows, effectiveTrackers);
    await this.pool.end();
    const manifest = writeRunManifest({
      runId: this.runId,
      outDir: this.outDir,
      trackers: effectiveTrackers,
      context: this.options
    });
    return {
      studentsRows: studentsRows.length,
      teamRows: teamRows.length,
      vpRows: vpRows.length,
      interviewRows: interviewRows.length,
      vpChatRows: vpChatRows.length,
      jinangRows: jinangCsvRows.length,
      manifestPath: manifest.path
    };
  }
}

module.exports = {
  DataExporter
};
