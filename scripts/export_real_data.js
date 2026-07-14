"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { Pool } = require("pg");
const {
  PRICE_SCALE,
  MONEY_SCALE_CONTRACT,
  scaleStoredMoney
} = require("../server/multiplayer/moneyScale");

const REQUIRED_ENV_KEYS = ["PGHOST", "PGPORT", "PGUSER", "PGPASSWORD", "PGDATABASE"];

const STUDENT_SUMMARY_COLUMNS = [
  "team_index",
  "team_label",
  "team_id",
  "team_name",
  "team_status",
  "team_r2_status",
  "member_index",
  "member_id",
  "member_name",
  "is_leader",
  "forced_by_teacher",
  "current_step",
  "interview_status",
  "interview_rounds",
  "card_status",
  "latest_interview_session_id",
  "latest_interview_round_no",
  "latest_interview_complete",
  "latest_interview_persona",
  "latest_interview_turns",
  "latest_selection_count",
  "latest_submission_session_id",
  "team_submitted_price",
  "team_submitted_dcogs",
  "team_submitted_risk_total",
  "team_submitted_card_count",
  "team_submitted_best_grid",
  "final_grid_id",
  "final_architecture"
];

const TEAM_SUMMARY_COLUMNS = [
  "team_index",
  "team_label",
  "team_id",
  "team_name",
  "team_size",
  "member_count",
  "leader_member_id",
  "status",
  "r2_status",
  "final_grid_id",
  "final_architecture",
  "money_scale",
  "money_scale_contract",
  "final_sam",
  "final_sam_raw",
  "final_sam_scaled",
  "final_wtp_ref",
  "final_wtp_ref_raw",
  "final_wtp_ref_scaled",
  "final_wtp_adj",
  "final_wtp_adj_raw",
  "final_wtp_adj_scaled",
  "members_forced_absent",
  "members_interview_completed",
  "members_cards_submitted",
  "interview_session_count",
  "interview_completed_count",
  "selection_member_count",
  "total_selected_cards",
  "latest_submission_session_id",
  "latest_submission_price",
  "latest_submission_dcogs",
  "latest_submission_risk_total",
  "latest_submission_card_count",
  "latest_submission_best_grid",
  "computation_log_count",
  "last_computation_stage",
  "created_at"
];

function loadLocalEnvFile() {
  const envPath = path.join(process.cwd(), ".env");
  if (!fs.existsSync(envPath)) return;
  const content = fs.readFileSync(envPath, "utf8");
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith("\"") && value.endsWith("\"")) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!Object.prototype.hasOwnProperty.call(process.env, key)) {
      process.env[key] = value;
    }
  }
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function writeJson(filePath, payload) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`);
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

function parseJson(value, fallback) {
  if (value == null || value === "") return fallback;
  if (typeof value === "object") return value;
  try {
    return JSON.parse(value);
  } catch (_) {
    return fallback;
  }
}

function toNumber(value, fallback = null) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function toBool(value) {
  if (value === true || value === false) return value;
  if (value === "t" || value === "true" || value === 1 || value === "1") return true;
  if (value === "f" || value === "false" || value === 0 || value === "0") return false;
  return false;
}

function normalizeTimestamp(value) {
  if (!value) return "";
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) return String(value);
  return date.toISOString();
}

function safeFileName(value) {
  const text = String(value || "").trim();
  return (text || "unknown").replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_").slice(0, 120);
}

function countInterviewTurns(history) {
  return normalizeArray(history).filter((item) => String(item?.role || "") === "user").length;
}

function normalizeArray(value) {
  return Array.isArray(value) ? value : [];
}

function formatTimestampDir(date = new Date()) {
  return date.toISOString().replace(/[:.]/g, "-");
}

function resolveTeamLabel(index) {
  return `第${index + 1}组`;
}

function getPersonaName(personas, session) {
  const list = normalizeArray(personas);
  const first = list[0] || {};
  return String(first.name || first.persona_name || first.id || session?.persona_name || "访谈对象").trim();
}

function getMessageText(message) {
  return String(message?.text || message?.content || "").trim();
}

function getMessageSpeaker(message, personaName) {
  if (message?.speaker) return String(message.speaker).trim();
  if (String(message?.role || "") === "user") return "学生";
  return personaName || "访谈对象";
}

function buildInterviewText(teamLabel, memberName, personaName, session) {
  const history = normalizeArray(parseJson(session.history_json, []));
  const lines = [
    `${teamLabel} - ${memberName} - 访谈 ${personaName}`,
    `session_id: ${session.session_id || ""}`,
    `轮次: ${toNumber(session.round_no, 0)}, 完成: ${toBool(session.is_complete)}`,
    "=========="
  ];
  for (const item of history) {
    const text = getMessageText(item);
    if (!text) continue;
    lines.push(`[${getMessageSpeaker(item, personaName)}] ${text}`);
  }
  return `${lines.join("\n")}\n`;
}

function getRequiredEnvError() {
  const missing = REQUIRED_ENV_KEYS.filter((key) => !String(process.env[key] || "").trim());
  if (!missing.length) return null;
  return new Error(`Missing required env: ${missing.join(", ")}`);
}

function sumSelectionCount(rows) {
  return rows.reduce((sum, row) => {
    const selections = normalizeArray(parseJson(row.selections_json, []));
    return sum + selections.length;
  }, 0);
}

async function queryAll(pool) {
  const [
    teamsRes,
    membersRes,
    submissionsRes,
    interviewsRes,
    selectionsRes,
    logRes
  ] = await Promise.all([
    pool.query("SELECT * FROM teams ORDER BY created_at ASC NULLS LAST, id ASC"),
    pool.query("SELECT * FROM team_members ORDER BY team_id ASC, member_index ASC NULLS LAST, joined_at ASC NULLS LAST, id ASC"),
    pool.query("SELECT * FROM round2_submissions ORDER BY submitted_at ASC NULLS LAST, team_id ASC"),
    pool.query("SELECT * FROM round2_interview_sessions ORDER BY team_id ASC, created_at ASC NULLS LAST, updated_at ASC NULLS LAST, session_id ASC"),
    pool.query("SELECT * FROM round2_member_selections ORDER BY team_id ASC, updated_at ASC NULLS LAST, member_id ASC"),
    pool.query("SELECT * FROM computation_log ORDER BY timestamp ASC NULLS LAST, id ASC")
  ]);

  return {
    teams: teamsRes.rows,
    members: membersRes.rows,
    submissions: submissionsRes.rows,
    interviews: interviewsRes.rows,
    selections: selectionsRes.rows,
    logs: logRes.rows
  };
}

function buildMaps(data) {
  const teamIndexById = new Map();
  const teamById = new Map();
  data.teams.forEach((team, index) => {
    teamIndexById.set(team.id, index);
    teamById.set(team.id, team);
  });

  const membersByTeam = new Map();
  const memberById = new Map();
  for (const member of data.members) {
    if (!membersByTeam.has(member.team_id)) membersByTeam.set(member.team_id, []);
    membersByTeam.get(member.team_id).push(member);
    memberById.set(member.id, member);
  }

  const submissionsByTeam = new Map();
  for (const row of data.submissions) {
    if (!submissionsByTeam.has(row.team_id)) submissionsByTeam.set(row.team_id, []);
    submissionsByTeam.get(row.team_id).push(row);
  }

  const interviewsByTeam = new Map();
  const interviewsByMember = new Map();
  for (const row of data.interviews) {
    if (!interviewsByTeam.has(row.team_id)) interviewsByTeam.set(row.team_id, []);
    interviewsByTeam.get(row.team_id).push(row);
    if (!interviewsByMember.has(row.member_id)) interviewsByMember.set(row.member_id, []);
    interviewsByMember.get(row.member_id).push(row);
  }

  const selectionsByTeam = new Map();
  const selectionsByMember = new Map();
  for (const row of data.selections) {
    if (!selectionsByTeam.has(row.team_id)) selectionsByTeam.set(row.team_id, []);
    selectionsByTeam.get(row.team_id).push(row);
    if (!selectionsByMember.has(row.member_id)) selectionsByMember.set(row.member_id, []);
    selectionsByMember.get(row.member_id).push(row);
  }

  const logsByTeam = new Map();
  for (const row of data.logs) {
    const teamId = row.team_id || "";
    if (!logsByTeam.has(teamId)) logsByTeam.set(teamId, []);
    logsByTeam.get(teamId).push(row);
  }

  return {
    teamIndexById,
    teamById,
    memberById,
    membersByTeam,
    submissionsByTeam,
    interviewsByTeam,
    interviewsByMember,
    selectionsByTeam,
    selectionsByMember,
    logsByTeam
  };
}

function buildStudentRoster(data, maps) {
  return data.teams.map((team) => {
    const teamIndex = maps.teamIndexById.get(team.id) || 0;
    const teamLabel = resolveTeamLabel(teamIndex);
    const members = (maps.membersByTeam.get(team.id) || []).map((member) => ({
      member_id: member.id,
      member_index: member.member_index,
      name: member.member_name,
      is_leader: String(team.leader_member_id || "") === String(member.id || ""),
      forced_by_teacher: toBool(member.forced_by_teacher),
      current_step: member.current_step || "",
      interview_status: member.interview_status || "",
      card_status: member.card_status || "",
      jinang_market_id: member.jinang_market_id || "",
      jinang_tech_id: member.jinang_tech_id || ""
    }));

    return {
      team_index: teamIndex,
      team_label: teamLabel,
      team_id: team.id,
      team_name: team.team_name || "",
      target_grid: team.final_grid_id || "",
      target_arch: team.final_architecture || "",
      status: team.status || "",
      r2_status: team.r2_status || "",
      members
    };
  });
}

function buildStudentsSummaryRows(data, maps) {
  return data.members.map((member) => {
    const team = maps.teamById.get(member.team_id) || {};
    const teamIndex = maps.teamIndexById.get(member.team_id) || 0;
    const teamLabel = resolveTeamLabel(teamIndex);
    const memberSessions = maps.interviewsByMember.get(member.id) || [];
    const latestSession = memberSessions[memberSessions.length - 1] || null;
    const latestSessionPersonas = parseJson(latestSession?.personas_json, []);
    const latestSelectionRow = (maps.selectionsByMember.get(member.id) || []).slice(-1)[0] || null;
    const latestSelections = normalizeArray(parseJson(latestSelectionRow?.selections_json, []));
    const latestSubmission = (maps.submissionsByTeam.get(member.team_id) || []).slice(-1)[0] || null;

    return {
      team_index: teamIndex,
      team_label: teamLabel,
      team_id: member.team_id,
      team_name: team.team_name || "",
      team_status: team.status || "",
      team_r2_status: team.r2_status || "",
      member_index: member.member_index,
      member_id: member.id,
      member_name: member.member_name || "",
      is_leader: String(team.leader_member_id || "") === String(member.id || ""),
      forced_by_teacher: toBool(member.forced_by_teacher),
      current_step: member.current_step || "",
      interview_status: member.interview_status || "",
      interview_rounds: member.interview_rounds || "",
      card_status: member.card_status || "",
      latest_interview_session_id: latestSession?.session_id || "",
      latest_interview_round_no: toNumber(latestSession?.round_no, ""),
      latest_interview_complete: latestSession ? toBool(latestSession.is_complete) : "",
      latest_interview_persona: latestSession ? getPersonaName(latestSessionPersonas, latestSession) : "",
      latest_interview_turns: latestSession ? countInterviewTurns(parseJson(latestSession.history_json, [])) : "",
      latest_selection_count: latestSelections.length,
      latest_submission_session_id: latestSubmission?.session_id || "",
      team_submitted_price: toNumber(latestSubmission?.price, ""),
      team_submitted_dcogs: toNumber(latestSubmission?.dcogs, ""),
      team_submitted_risk_total: toNumber(latestSubmission?.risk_total, ""),
      team_submitted_card_count: toNumber(latestSubmission?.card_count, ""),
      team_submitted_best_grid: latestSubmission?.best_grid || "",
      final_grid_id: team.final_grid_id || "",
      final_architecture: team.final_architecture || ""
    };
  });
}

function buildTeamsSummaryRows(data, maps) {
  return data.teams.map((team) => {
    const teamIndex = maps.teamIndexById.get(team.id) || 0;
    const teamLabel = resolveTeamLabel(teamIndex);
    const members = maps.membersByTeam.get(team.id) || [];
    const interviews = maps.interviewsByTeam.get(team.id) || [];
    const selections = maps.selectionsByTeam.get(team.id) || [];
    const latestSubmission = (maps.submissionsByTeam.get(team.id) || []).slice(-1)[0] || null;
    const logs = maps.logsByTeam.get(team.id) || [];
    const lastLog = logs[logs.length - 1] || null;

    return {
      team_index: teamIndex,
      team_label: teamLabel,
      team_id: team.id,
      team_name: team.team_name || "",
      team_size: toNumber(team.team_size, ""),
      member_count: members.length,
      leader_member_id: team.leader_member_id || "",
      status: team.status || "",
      r2_status: team.r2_status || "",
      final_grid_id: team.final_grid_id || "",
      final_architecture: team.final_architecture || "",
      money_scale: PRICE_SCALE,
      money_scale_contract: MONEY_SCALE_CONTRACT,
      final_sam: toNumber(team.final_sam, ""),
      final_sam_raw: toNumber(team.final_sam, ""),
      final_sam_scaled: scaleStoredMoney(team.final_sam) ?? "",
      final_wtp_ref: toNumber(team.final_wtp_ref, ""),
      final_wtp_ref_raw: toNumber(team.final_wtp_ref, ""),
      final_wtp_ref_scaled: scaleStoredMoney(team.final_wtp_ref) ?? "",
      final_wtp_adj: toNumber(team.final_wtp_adj, ""),
      final_wtp_adj_raw: toNumber(team.final_wtp_adj, ""),
      final_wtp_adj_scaled: scaleStoredMoney(team.final_wtp_adj) ?? "",
      members_forced_absent: members.filter((member) => toBool(member.forced_by_teacher)).length,
      members_interview_completed: members.filter((member) => String(member.interview_status || "") === "completed").length,
      members_cards_submitted: members.filter((member) => String(member.card_status || "") === "submitted").length,
      interview_session_count: interviews.length,
      interview_completed_count: interviews.filter((row) => toBool(row.is_complete)).length,
      selection_member_count: selections.length,
      total_selected_cards: sumSelectionCount(selections),
      latest_submission_session_id: latestSubmission?.session_id || "",
      latest_submission_price: toNumber(latestSubmission?.price, ""),
      latest_submission_dcogs: toNumber(latestSubmission?.dcogs, ""),
      latest_submission_risk_total: toNumber(latestSubmission?.risk_total, ""),
      latest_submission_card_count: toNumber(latestSubmission?.card_count, ""),
      latest_submission_best_grid: latestSubmission?.best_grid || "",
      computation_log_count: logs.length,
      last_computation_stage: lastLog?.stage || "",
      created_at: normalizeTimestamp(team.created_at)
    };
  });
}

function buildStageBreakdown(logs) {
  const counts = new Map();
  for (const row of logs) {
    const key = String(row.stage || "unknown");
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return Object.fromEntries(Array.from(counts.entries()).sort((a, b) => a[0].localeCompare(b[0])));
}

function buildStatusBreakdown(rows, fieldName) {
  const counts = new Map();
  for (const row of rows) {
    const key = String(row[fieldName] || "");
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return Object.fromEntries(Array.from(counts.entries()).sort((a, b) => a[0].localeCompare(b[0])));
}

function buildReport(data, maps, outputDir) {
  const teamRows = buildTeamsSummaryRows(data, maps);
  const studentRows = buildStudentsSummaryRows(data, maps);
  return {
    generated_at: new Date().toISOString(),
    output_dir: outputDir,
    database: {
      host: process.env.PGHOST,
      port: process.env.PGPORT,
      database: process.env.PGDATABASE,
      user: process.env.PGUSER
    },
    counts: {
      teams: data.teams.length,
      team_members: data.members.length,
      round2_submissions: data.submissions.length,
      round2_interview_sessions: data.interviews.length,
      round2_member_selections: data.selections.length,
      computation_log_entries: data.logs.length
    },
    team_status_breakdown: buildStatusBreakdown(data.teams, "status"),
    team_r2_status_breakdown: buildStatusBreakdown(data.teams, "r2_status"),
    interview_status_breakdown: buildStatusBreakdown(data.members, "interview_status"),
    card_status_breakdown: buildStatusBreakdown(data.members, "card_status"),
    computation_stage_breakdown: buildStageBreakdown(data.logs),
    summary: {
      teams_with_submission: teamRows.filter((row) => row.latest_submission_session_id).length,
      teams_with_interviews: teamRows.filter((row) => Number(row.interview_session_count || 0) > 0).length,
      teams_with_logs: teamRows.filter((row) => Number(row.computation_log_count || 0) > 0).length,
      forced_absent_members: studentRows.filter((row) => row.forced_by_teacher === true).length
    }
  };
}

function writeByTeamExports(data, maps, byTeamDir) {
  ensureDir(byTeamDir);

  for (const team of data.teams) {
    const teamIndex = maps.teamIndexById.get(team.id) || 0;
    const teamLabel = resolveTeamLabel(teamIndex);
    const teamDir = path.join(byTeamDir, teamLabel);
    ensureDir(teamDir);

    const selections = maps.selectionsByTeam.get(team.id) || [];
    const latestSubmission = (maps.submissionsByTeam.get(team.id) || []).slice(-1)[0] || null;
    writeJson(path.join(teamDir, "selections.json"), {
      team_id: team.id,
      team_name: team.team_name || "",
      team_label: teamLabel,
      latest_submission: latestSubmission || null,
      member_selections: selections.map((row) => ({
        member_id: row.member_id,
        updated_at: normalizeTimestamp(row.updated_at),
        selections: normalizeArray(parseJson(row.selections_json, []))
      }))
    });

    const sessions = maps.interviewsByTeam.get(team.id) || [];
    for (const session of sessions) {
      const member = maps.memberById.get(session.member_id) || {};
      const personas = parseJson(session.personas_json, []);
      const personaName = getPersonaName(personas, session);
      const memberName = String(member.member_name || session.member_id || "成员").trim();
      const fileName = `${safeFileName(memberName)}_${safeFileName(personaName)}_${safeFileName(session.session_id)}.txt`;
      fs.writeFileSync(
        path.join(teamDir, fileName),
        buildInterviewText(teamLabel, memberName, personaName, session)
      );
    }
  }
}

async function main() {
  loadLocalEnvFile();
  const envError = getRequiredEnvError();
  if (envError) {
    throw envError;
  }

  const exportRoot = path.join(os.homedir(), "pelovotsim_exports", formatTimestampDir());
  const pool = new Pool();

  try {
    const data = await queryAll(pool);
    const maps = buildMaps(data);

    ensureDir(exportRoot);
    writeJson(path.join(exportRoot, "all_entries.json"), data.logs);
    writeByTeamExports(data, maps, path.join(exportRoot, "by_team"));
    writeJson(path.join(exportRoot, "student_roster.json"), buildStudentRoster(data, maps));
    writeCsv(path.join(exportRoot, "students_summary.csv"), STUDENT_SUMMARY_COLUMNS, buildStudentsSummaryRows(data, maps));
    writeCsv(path.join(exportRoot, "teams_summary.csv"), TEAM_SUMMARY_COLUMNS, buildTeamsSummaryRows(data, maps));
    writeJson(path.join(exportRoot, "report.json"), buildReport(data, maps, exportRoot));

    console.log(`导出完成: ${exportRoot}`);
    console.log("文件:");
    console.log("  all_entries.json");
    console.log("  by_team/");
    console.log("  report.json");
    console.log("  student_roster.json");
    console.log("  students_summary.csv");
    console.log("  teams_summary.csv");
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
