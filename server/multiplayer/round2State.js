const { runSql, sqlQuote } = require("../db/pgSql");
const {
  clearTeamStateCache,
  readThroughTeamStateCache,
  refreshTeamStateCache
} = require("../cache/teamStateCache");

const TEAM_STATUS_ORDER = [
  "R2_NOT_STARTED",
  "R2_REVIEW",
  "R2_INTERVIEWING",
  "R2_INDIVIDUAL_CARDS",
  "R2_TEAM_MERGE",
  "R2_TEAM_DISCUSSION",
  "R2_SUBMITTED"
];

const TEAM_STATUS_LABELS = {
  R2_NOT_STARTED: "未开始",
  R2_REVIEW: "第一轮回顾",
  R2_INTERVIEWING: "用户访谈中",
  R2_INDIVIDUAL_CARDS: "个人选卡中",
  R2_TEAM_MERGE: "团队合并中",
  R2_TEAM_DISCUSSION: "团队讨论中",
  R2_SUBMITTED: "已提交"
};

const MEMBER_STEP_LABELS = {
  idle: "未开始",
  reviewing: "回顾中",
  interviewing: "访谈中",
  interview_done: "访谈完成",
  selecting_cards: "选卡中",
  waiting_merge: "等待合并",
  in_discussion: "团队讨论中",
  done: "已完成"
};
let __round2StateSchemaPromise = null;

function nowIso() {
  return new Date().toISOString();
}

function safeJsonParse(text, fallback) {
  if (text == null || text === "") return fallback;
  if (typeof text === "object") return text;
  try {
    return JSON.parse(text);
  } catch (_) {
    return fallback;
  }
}

function quoteList(values) {
  const list = Array.isArray(values) ? values.filter(Boolean) : [];
  if (!list.length) return null;
  return list.map((value) => sqlQuote(value)).join(", ");
}

function clampStatus(status) {
  const raw = String(status || "").trim().toUpperCase();
  return TEAM_STATUS_ORDER.includes(raw) ? raw : "R2_NOT_STARTED";
}

function statusIndex(status) {
  return TEAM_STATUS_ORDER.indexOf(clampStatus(status));
}

function maxStatus(a, b) {
  return statusIndex(a) >= statusIndex(b) ? clampStatus(a) : clampStatus(b);
}

function toNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function toBool(value) {
  return value === true || value === "t" || value === "true" || value === 1 || value === "1";
}

function diffMinutes(fromIso) {
  if (!fromIso) return 0;
  const from = new Date(fromIso).getTime();
  if (!Number.isFinite(from)) return 0;
  return Math.max(0, Math.floor((Date.now() - from) / 60000));
}

function formatGridLabel(gridId) {
  const raw = String(gridId || "").trim();
  if (!raw) return "";
  const parts = raw.split("_");
  const channelMap = { B2B: "ToB", TOB: "ToB", B2C: "ToC", TOC: "ToC" };
  const strategyMap = { DIFFERENTIATION: "差异化", DIFF: "差异化", COST: "成本" };
  const focusMap = {
    ELDER: "老人",
    ADULT: "成人",
    CHILD: "儿童",
    EXPERIENCE: "体验",
    HYBRID: "混合",
    MIXED: "混合",
    FUNCTION: "功能"
  };
  return [
    channelMap[String(parts[0] || "").toUpperCase()] || parts[0] || "",
    strategyMap[String(parts[1] || "").toUpperCase()] || parts[1] || "",
    focusMap[String(parts[2] || "").toUpperCase()] || parts[2] || ""
  ].filter(Boolean).join("·");
}

function formatArchitectureLabel(arch) {
  const raw = String(arch || "").trim().toLowerCase();
  if (raw === "experience") return "体验●";
  if (raw === "hybrid") return "混合▲";
  if (raw === "function") return "功能■";
  return String(arch || "");
}

async function ensureSchema() {
  if (__round2StateSchemaPromise) return __round2StateSchemaPromise;
  __round2StateSchemaPromise = (async () => {
    await runSql(`
      ALTER TABLE teams ADD COLUMN IF NOT EXISTS r2_status TEXT DEFAULT 'R2_NOT_STARTED';
      ALTER TABLE teams ADD COLUMN IF NOT EXISTS r2_status_entered_at TIMESTAMPTZ;
      UPDATE teams
      SET r2_status = COALESCE(r2_status, 'R2_NOT_STARTED'),
          r2_status_entered_at = COALESCE(r2_status_entered_at, created_at, NOW())
      WHERE r2_status IS NULL OR r2_status_entered_at IS NULL;

      ALTER TABLE team_members ADD COLUMN IF NOT EXISTS interview_status TEXT DEFAULT 'not_started';
      ALTER TABLE team_members ADD COLUMN IF NOT EXISTS interview_rounds INTEGER DEFAULT 0;
      ALTER TABLE team_members ADD COLUMN IF NOT EXISTS card_status TEXT DEFAULT 'not_started';
      ALTER TABLE team_members ADD COLUMN IF NOT EXISTS cards_selected INTEGER DEFAULT 0;
      ALTER TABLE team_members ADD COLUMN IF NOT EXISTS reading_status TEXT DEFAULT 'not_started';
      ALTER TABLE team_members ADD COLUMN IF NOT EXISTS current_step TEXT DEFAULT 'idle';
      ALTER TABLE team_members ADD COLUMN IF NOT EXISTS last_activity_at TIMESTAMPTZ;
      ALTER TABLE team_members ADD COLUMN IF NOT EXISTS forced_by_teacher BOOLEAN DEFAULT FALSE;

      UPDATE team_members
      SET interview_status = COALESCE(interview_status, 'not_started'),
          interview_rounds = COALESCE(interview_rounds, 0),
          card_status = COALESCE(card_status, 'not_started'),
          cards_selected = COALESCE(cards_selected, 0),
          reading_status = COALESCE(reading_status, 'not_started'),
          current_step = COALESCE(current_step, 'idle'),
          forced_by_teacher = COALESCE(forced_by_teacher, FALSE),
          last_activity_at = COALESCE(last_activity_at, joined_at, NOW())
      WHERE interview_status IS NULL
        OR interview_rounds IS NULL
        OR card_status IS NULL
        OR cards_selected IS NULL
        OR reading_status IS NULL
        OR current_step IS NULL
        OR forced_by_teacher IS NULL
        OR last_activity_at IS NULL;

      CREATE TABLE IF NOT EXISTS teacher_actions (
        id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        action TEXT NOT NULL,
        team_id TEXT,
        member_id TEXT,
        details TEXT,
        performed_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_teacher_actions_team_time
        ON teacher_actions(team_id, performed_at DESC);
    `);
  })();
  try {
    await __round2StateSchemaPromise;
  } catch (err) {
    __round2StateSchemaPromise = null;
    throw err;
  }
  return __round2StateSchemaPromise;
}

async function logTeacherAction({ action, teamId = null, memberId = null, details = null }) {
  await ensureSchema();
  console.log(`[TEACHER] ${String(action || "").trim()}: team=${teamId || "-"} member=${memberId || "-"} at ${nowIso()}`);
  await runSql(`
    INSERT INTO teacher_actions (action, team_id, member_id, details)
    VALUES (
      ${sqlQuote(String(action || "").trim())},
      ${sqlQuote(teamId || null)},
      ${sqlQuote(memberId || null)},
      ${sqlQuote(details ? JSON.stringify(details) : null)}
    );
  `);
}

async function updateTeamRound2Status(teamId, status, enteredAt = nowIso()) {
  await ensureSchema();
  const nextStatus = clampStatus(status);
  await runSql(`
    UPDATE teams
    SET r2_status = ${sqlQuote(nextStatus)},
        r2_status_entered_at = ${sqlQuote(enteredAt)}
    WHERE id = ${sqlQuote(teamId)};
  `);
  await refreshCachedTeamRound2State(teamId);
}

async function updateMemberProgress(teamId, memberId, patch = {}) {
  await ensureSchema();
  const allowed = {
    interview_status: (value) => sqlQuote(value),
    interview_rounds: (value) => `${Math.max(0, Math.floor(toNumber(value, 0)))}`,
    card_status: (value) => sqlQuote(value),
    cards_selected: (value) => `${Math.max(0, Math.floor(toNumber(value, 0)))}`,
    reading_status: (value) => sqlQuote(value),
    current_step: (value) => sqlQuote(value),
    last_activity_at: (value) => sqlQuote(value),
    forced_by_teacher: (value) => (value ? "TRUE" : "FALSE")
  };

  const assignments = Object.entries(patch)
    .filter(([key, value]) => Object.prototype.hasOwnProperty.call(allowed, key) && value !== undefined)
    .map(([key, value]) => `${key} = ${allowed[key](value)}`);

  if (!assignments.length) return;

  await runSql(`
    UPDATE team_members
    SET ${assignments.join(", ")}
    WHERE team_id = ${sqlQuote(teamId)} AND id = ${sqlQuote(memberId)};
  `);
  await refreshCachedTeamRound2State(teamId);
}

async function resetMemberFields(teamId, memberId, patch = {}) {
  await updateMemberProgress(teamId, memberId, {
    interview_status: "not_started",
    interview_rounds: 0,
    card_status: "not_started",
    cards_selected: 0,
    reading_status: "not_started",
    current_step: "idle",
    forced_by_teacher: false,
    last_activity_at: nowIso(),
    ...patch
  });
}

async function clearTeamRound2Artifacts(teamId, mode) {
  await ensureSchema();
  const target = String(mode || "").trim();

  if (target === "R2_REVIEW") {
    await runSql(`
      DELETE FROM round2_dimension_assignments WHERE team_id = ${sqlQuote(teamId)};
      DELETE FROM round2_interview_sessions WHERE team_id = ${sqlQuote(teamId)};
      DELETE FROM round2_member_selections WHERE team_id = ${sqlQuote(teamId)};
      DELETE FROM round2_team_drafts WHERE team_id = ${sqlQuote(teamId)};
      DELETE FROM round2_persona_views WHERE team_id = ${sqlQuote(teamId)};
      DELETE FROM round2_persona_choices WHERE team_id = ${sqlQuote(teamId)};
      DELETE FROM round2_persona_reports WHERE team_id = ${sqlQuote(teamId)};
      DELETE FROM round2_submissions WHERE team_id = ${sqlQuote(teamId)};
      DELETE FROM fg_team_radar WHERE team_id = ${sqlQuote(teamId)};
      DELETE FROM round2_results WHERE team_id = ${sqlQuote(teamId)};
    `);
    return;
  }

  if (target === "R2_INTERVIEWING") {
    await runSql(`
      DELETE FROM round2_interview_sessions WHERE team_id = ${sqlQuote(teamId)};
      DELETE FROM round2_member_selections WHERE team_id = ${sqlQuote(teamId)};
      DELETE FROM round2_team_drafts WHERE team_id = ${sqlQuote(teamId)};
      DELETE FROM round2_persona_views WHERE team_id = ${sqlQuote(teamId)};
      DELETE FROM round2_persona_choices WHERE team_id = ${sqlQuote(teamId)};
      DELETE FROM round2_submissions WHERE team_id = ${sqlQuote(teamId)};
      DELETE FROM fg_team_radar WHERE team_id = ${sqlQuote(teamId)};
      DELETE FROM round2_results WHERE team_id = ${sqlQuote(teamId)};
    `);
    return;
  }

  if (target === "R2_INDIVIDUAL_CARDS") {
    await runSql(`
      DELETE FROM round2_member_selections WHERE team_id = ${sqlQuote(teamId)};
      DELETE FROM round2_team_drafts WHERE team_id = ${sqlQuote(teamId)};
      DELETE FROM round2_persona_views WHERE team_id = ${sqlQuote(teamId)};
      DELETE FROM round2_persona_choices WHERE team_id = ${sqlQuote(teamId)};
      DELETE FROM round2_submissions WHERE team_id = ${sqlQuote(teamId)};
      DELETE FROM fg_team_radar WHERE team_id = ${sqlQuote(teamId)};
      DELETE FROM round2_results WHERE team_id = ${sqlQuote(teamId)};
    `);
    return;
  }

  if (target === "R2_TEAM_MERGE") {
    await runSql(`
      DELETE FROM round2_team_drafts WHERE team_id = ${sqlQuote(teamId)};
      DELETE FROM round2_persona_views WHERE team_id = ${sqlQuote(teamId)};
      DELETE FROM round2_persona_choices WHERE team_id = ${sqlQuote(teamId)};
      DELETE FROM round2_submissions WHERE team_id = ${sqlQuote(teamId)};
      DELETE FROM fg_team_radar WHERE team_id = ${sqlQuote(teamId)};
      DELETE FROM round2_results WHERE team_id = ${sqlQuote(teamId)};
    `);
    return;
  }

  if (target === "R2_TEAM_DISCUSSION") {
    await runSql(`
      UPDATE round2_team_drafts
      SET price = NULL, updated_at = ${sqlQuote(nowIso())}
      WHERE team_id = ${sqlQuote(teamId)};
      DELETE FROM round2_persona_views WHERE team_id = ${sqlQuote(teamId)};
      DELETE FROM round2_persona_choices WHERE team_id = ${sqlQuote(teamId)};
      DELETE FROM round2_submissions WHERE team_id = ${sqlQuote(teamId)};
      DELETE FROM round2_results WHERE team_id = ${sqlQuote(teamId)};
    `);
  }
}

async function clearMemberRound2Artifacts(teamId, memberId, resetTo) {
  await ensureSchema();
  const target = String(resetTo || "").trim();

  if (target === "interviewing") {
    await runSql(`
      DELETE FROM round2_interview_sessions
      WHERE team_id = ${sqlQuote(teamId)} AND member_id = ${sqlQuote(memberId)};

      DELETE FROM round2_member_selections
      WHERE team_id = ${sqlQuote(teamId)} AND member_id = ${sqlQuote(memberId)};

      DELETE FROM round2_team_drafts WHERE team_id = ${sqlQuote(teamId)};
      DELETE FROM round2_persona_views WHERE team_id = ${sqlQuote(teamId)};
      DELETE FROM round2_persona_choices WHERE team_id = ${sqlQuote(teamId)};
      DELETE FROM round2_submissions WHERE team_id = ${sqlQuote(teamId)};
      DELETE FROM fg_team_radar WHERE team_id = ${sqlQuote(teamId)};
      DELETE FROM round2_results WHERE team_id = ${sqlQuote(teamId)};
    `);
    return;
  }

  if (target === "selecting") {
    await runSql(`
      DELETE FROM round2_member_selections
      WHERE team_id = ${sqlQuote(teamId)} AND member_id = ${sqlQuote(memberId)};

      DELETE FROM round2_team_drafts WHERE team_id = ${sqlQuote(teamId)};
      DELETE FROM round2_persona_views WHERE team_id = ${sqlQuote(teamId)};
      DELETE FROM round2_persona_choices WHERE team_id = ${sqlQuote(teamId)};
      DELETE FROM round2_submissions WHERE team_id = ${sqlQuote(teamId)};
      DELETE FROM fg_team_radar WHERE team_id = ${sqlQuote(teamId)};
      DELETE FROM round2_results WHERE team_id = ${sqlQuote(teamId)};
    `);
  }
}

function deriveMemberCardStatus(memberRow, selectionRow) {
  console.log(`[round2State] deriveMemberCardStatus input=${JSON.stringify({ memberRow, selectionRow })}`);
  const stored = String(memberRow.cardStatusStored || memberRow.card_status || "").trim();
  if (stored === "submitted" || stored === "selecting" || stored === "not_started") {
    if (stored === "submitted") return "submitted";
    if (stored === "selecting") return "selecting";
  }
  const count = Array.isArray(selectionRow?.selections) ? selectionRow.selections.length : 0;
  if (count > 0) return "selecting";
  return "not_started";
}

function deriveInterviewStatus(memberRow, interviewRow, interviewStats = null) {
  console.log(`[round2State] deriveInterviewStatus input=${JSON.stringify({ memberRow, interviewRow, interviewStats })}`);
  const stored = String(memberRow.interviewStatusStored || memberRow.interview_status || "").trim();
  const completedCount = Math.max(0, toNumber(interviewStats?.completedCount, 0));
  const activeCount = Math.max(0, toNumber(interviewStats?.activeCount, 0));
  if (completedCount >= 2) return "completed";
  if (activeCount > 0 || completedCount > 0) return "in_progress";
  if (stored === "completed" || stored === "in_progress") return stored;
  if (interviewRow?.isComplete || interviewRow?.is_complete) return "in_progress";
  if (interviewRow) return "in_progress";
  return "not_started";
}

function deriveCurrentStep(teamStatus, memberRow, interviewStatus, cardStatus) {
  console.log(`[round2State] deriveCurrentStep input=${JSON.stringify({ teamStatus, memberRow, interviewStatus, cardStatus })}`);
  const stored = String(memberRow.currentStepStored || memberRow.current_step || "").trim();
  if (stored) return stored;

  if (teamStatus === "R2_SUBMITTED") return "done";
  if (teamStatus === "R2_TEAM_DISCUSSION") return "in_discussion";
  if (teamStatus === "R2_TEAM_MERGE") return "waiting_merge";
  if (cardStatus === "submitted") return "waiting_merge";
  if (cardStatus === "selecting") return "selecting_cards";
  if (interviewStatus === "completed") return "interview_done";
  if (interviewStatus === "in_progress") return "interviewing";
  if (teamStatus === "R2_REVIEW") return "reviewing";
  return "idle";
}

function deriveTeamStatus(teamRow, members, teamSubmission) {
  console.log(`[round2State] deriveTeamStatus input=${JSON.stringify({ teamRow, members, teamSubmission })}`);
  const stored = clampStatus(teamRow.r2Status || teamRow.r2_status);
  let derived = (teamRow.teamStatus || teamRow.status) === "frozen" ? stored : "R2_NOT_STARTED";
  const allCardsSubmitted = members.length > 0 && members.every((member) => member.cardStatus === "submitted");

  if (teamSubmission) {
    derived = maxStatus(derived, "R2_SUBMITTED");
  } else if (members.some((member) => member.currentStep === "in_discussion" || member.currentStep === "done")) {
    derived = maxStatus(derived, "R2_TEAM_DISCUSSION");
  } else if (allCardsSubmitted) {
    derived = maxStatus(derived, "R2_TEAM_MERGE");
  } else if (members.some((member) => member.cardStatus === "submitted")) {
    derived = maxStatus(derived, "R2_INDIVIDUAL_CARDS");
  } else if (members.some((member) => member.cardStatus === "selecting")) {
    derived = maxStatus(derived, "R2_INDIVIDUAL_CARDS");
  } else if (members.some((member) => member.interviewStatus === "completed" || member.interviewStatus === "in_progress")) {
    derived = maxStatus(derived, "R2_INTERVIEWING");
  }

  return derived;
}

function deriveTeamEnteredAt(teamRow, members, teamSubmission, effectiveStatus) {
  console.log(`[round2State] deriveTeamEnteredAt input=${JSON.stringify({ teamRow, members, teamSubmission, effectiveStatus })}`);
  const storedStatus = clampStatus(teamRow.r2Status || teamRow.r2_status);
  const storedEnteredAt = teamRow.r2StatusEnteredAt || teamRow.r2_status_entered_at || null;
  if (storedStatus === effectiveStatus && storedEnteredAt) {
    return storedEnteredAt;
  }
  if (effectiveStatus === "R2_SUBMITTED") {
    return teamSubmission?.submittedAt || teamSubmission?.submitted_at || storedEnteredAt || null;
  }

  const lastMemberAt = members
    .map((member) => member.lastActivityAt)
    .filter(Boolean)
    .sort()
    .slice(-1)[0];

  return lastMemberAt || storedEnteredAt || teamRow.createdAt || teamRow.created_at || null;
}

async function loadRound2State(teamIds = null) {
  await ensureSchema();

  const whereSql = teamIds && teamIds.length
    ? `WHERE t.id IN (${quoteList(teamIds)})`
    : "";
  const rows = await runSql(`
    SELECT
      t.id,
      t.team_name,
      t.team_size,
      t.status,
      t.created_at,
      t.final_grid_id,
      t.final_architecture,
      (COALESCE(t.lovot_image, '') <> '') AS has_lovot_image,
      t.r2_status,
      t.r2_status_entered_at,
      t.leader_member_id,
      leader.member_name AS leader_name,
      tm.id AS member_id,
      tm.member_name,
      tm.member_index,
      tm.interview_status,
      tm.interview_rounds,
      tm.card_status,
      tm.cards_selected,
      tm.reading_status,
      tm.current_step,
      tm.last_activity_at,
      tm.forced_by_teacher
    FROM teams t
    LEFT JOIN team_members leader ON leader.id = t.leader_member_id
    LEFT JOIN team_members tm ON tm.team_id = t.id
    ${whereSql}
    ORDER BY t.created_at ASC, tm.member_index ASC;
  `);

  const teamMap = new Map();
  const allTeamIds = [];
  rows.forEach((row) => {
    if (!teamMap.has(row.id)) {
      teamMap.set(row.id, {
        id: row.id,
        name: row.team_name,
        memberCount: toNumber(row.team_size, 0),
        createdAt: row.created_at,
        teamStatus: row.status,
        finalGridId: row.final_grid_id,
        finalArchitecture: row.final_architecture,
        hasLovotImage: toBool(row.has_lovot_image),
        r2Status: row.r2_status,
        r2StatusEnteredAt: row.r2_status_entered_at,
        leaderMemberId: row.leader_member_id,
        leaderName: row.leader_name,
        members: []
      });
      allTeamIds.push(row.id);
    }
    if (row.member_id) {
      teamMap.get(row.id).members.push({
        id: row.member_id,
        name: row.member_name,
        memberIndex: toNumber(row.member_index, 0),
        interviewStatusStored: row.interview_status,
        interviewRoundsStored: toNumber(row.interview_rounds, 0),
        cardStatusStored: row.card_status,
        cardsSelectedStored: toNumber(row.cards_selected, 0),
        readingStatusStored: row.reading_status,
        currentStepStored: row.current_step,
        lastActivityStored: row.last_activity_at,
        forcedByTeacher: toBool(row.forced_by_teacher)
      });
    }
  });

  if (!allTeamIds.length) return [];

  const inSql = quoteList(allTeamIds);
  const assignmentRows = await runSql(`
    SELECT team_id, assignments_json
    FROM round2_dimension_assignments
    WHERE team_id IN (${inSql});
  `);
  const selectionRows = await runSql(`
    SELECT team_id, member_id, selections_json, updated_at
    FROM round2_member_selections
    WHERE team_id IN (${inSql});
  `);
  const interviewRows = await runSql(`
    SELECT DISTINCT ON (team_id, member_id)
      session_id,
      team_id,
      member_id,
      round_no,
      is_complete,
      result_json,
      updated_at
    FROM round2_interview_sessions
    WHERE team_id IN (${inSql})
    ORDER BY team_id, member_id, updated_at DESC;
  `);
  const interviewSummaryRows = await runSql(`
    SELECT
      team_id,
      member_id,
      COUNT(*) FILTER (WHERE is_complete = TRUE) AS completed_count,
      COUNT(*) FILTER (WHERE COALESCE(is_complete, FALSE) = FALSE) AS active_count,
      MAX(round_no) AS latest_round,
      MAX(updated_at) AS updated_at
    FROM round2_interview_sessions
    WHERE team_id IN (${inSql})
    GROUP BY team_id, member_id;
  `);
  const submissionRows = await runSql(`
    SELECT DISTINCT ON (team_id)
      team_id,
      session_id,
      submitted_at,
      selections_json
    FROM round2_submissions
    WHERE team_id IN (${inSql})
    ORDER BY team_id, submitted_at DESC;
  `);

  const assignmentMap = new Map();
  assignmentRows.forEach((row) => {
    const parsed = safeJsonParse(row.assignments_json, []);
    const memberMap = new Map();
    (Array.isArray(parsed) ? parsed : []).forEach((item) => {
      memberMap.set(String(item.memberId || ""), Array.isArray(item.dims) ? item.dims : []);
    });
    assignmentMap.set(row.team_id, memberMap);
  });

  const selectionMap = new Map();
  selectionRows.forEach((row) => {
    selectionMap.set(
      `${row.team_id}::${row.member_id}`,
      {
        updated_at: row.updated_at,
        selections: safeJsonParse(row.selections_json, [])
      }
    );
  });

  const interviewMap = new Map();
  interviewRows.forEach((row) => {
    interviewMap.set(
      `${row.team_id}::${row.member_id}`,
      {
        sessionId: row.session_id,
        roundNo: toNumber(row.round_no, 0),
        is_complete: toBool(row.is_complete),
        result: safeJsonParse(row.result_json, null),
        updated_at: row.updated_at
      }
    );
  });
  const interviewSummaryMap = new Map();
  interviewSummaryRows.forEach((row) => {
    interviewSummaryMap.set(
      `${row.team_id}::${row.member_id}`,
      {
        completedCount: toNumber(row.completed_count, 0),
        activeCount: toNumber(row.active_count, 0),
        latestRound: toNumber(row.latest_round, 0),
        updated_at: row.updated_at
      }
    );
  });

  const submissionMap = new Map();
  submissionRows.forEach((row) => {
    submissionMap.set(row.team_id, {
      sessionId: row.session_id,
      submitted_at: row.submitted_at,
      selections: safeJsonParse(row.selections_json, [])
    });
  });

  return allTeamIds.map((teamId) => {
    const team = teamMap.get(teamId);
    const memberAssignments = assignmentMap.get(teamId) || new Map();
    const teamSubmission = submissionMap.get(teamId) || null;

    const members = team.members.map((member) => {
      const selection = selectionMap.get(`${teamId}::${member.id}`) || null;
      const interview = interviewMap.get(`${teamId}::${member.id}`) || null;
      const interviewStats = interviewSummaryMap.get(`${teamId}::${member.id}`) || null;
      const interviewStatus = deriveInterviewStatus(member, interview, interviewStats);
      const cardsSelected = Math.max(
        member.cardsSelectedStored,
        Array.isArray(selection?.selections) ? selection.selections.length : 0
      );
      const cardStatus = deriveMemberCardStatus(member, selection);
      const currentStep = deriveCurrentStep(
        clampStatus(team.r2Status),
        member,
        interviewStatus,
        cardStatus
      );
      const lastActivityAt = member.lastActivityStored || selection?.updated_at || interviewStats?.updated_at || interview?.updated_at || null;

      return {
        id: member.id,
        name: member.name,
        memberIndex: member.memberIndex,
        dims: memberAssignments.get(member.id) || [],
        interviewStatus,
        interviewRounds: Math.max(member.interviewRoundsStored, toNumber(interviewStats?.latestRound, 0), toNumber(interview?.roundNo, 0)),
        completedInterviews: Math.max(0, toNumber(interviewStats?.completedCount, 0)),
        readingStatus: String(member.readingStatusStored || "not_started").trim() || "not_started",
        cardStatus,
        cardsSelected,
        currentStep,
        currentStepLabel: MEMBER_STEP_LABELS[currentStep] || currentStep,
        forcedByTeacher: member.forcedByTeacher,
        lastActivityAt,
        lastActivityMinutes: diffMinutes(lastActivityAt),
        interviewResultReady: Boolean(interview?.result),
        selectionUpdatedAt: selection?.updated_at || null
      };
    });

    const effectiveStatus = deriveTeamStatus(team, members, teamSubmission);
    const enteredAt = deriveTeamEnteredAt(team, members, teamSubmission, effectiveStatus);

    return {
      id: team.id,
      name: team.name,
      memberCount: members.length || team.memberCount,
      status: team.teamStatus,
      leaderMemberId: team.leaderMemberId || null,
      leaderName: team.leaderName || "",
      finalGridId: team.finalGridId,
      finalArchitecture: team.finalArchitecture,
      hasLovotImage: Boolean(team.hasLovotImage),
      has_lovot_image: Boolean(team.hasLovotImage),
      r1: {
        grid: team.finalGridId || "",
        gridLabel: formatGridLabel(team.finalGridId),
        arch: formatArchitectureLabel(team.finalArchitecture),
        status: team.teamStatus === "frozen" ? "frozen" : team.teamStatus
      },
      r2: {
        status: effectiveStatus,
        statusLabel: TEAM_STATUS_LABELS[effectiveStatus] || effectiveStatus,
        storedStatus: clampStatus(team.r2Status),
        enteredAt,
        durationMinutes: diffMinutes(enteredAt),
        sessionSubmittedAt: teamSubmission?.submitted_at || null
      },
      submission: teamSubmission,
      members
    };
  });
}

async function getTeamRound2State(teamId) {
  const tid = String(teamId || "").trim();
  if (!tid) return null;
  return readThroughTeamStateCache(tid, async () => {
    const list = await loadRound2State([tid]);
    return list[0] || null;
  });
}

async function refreshCachedTeamRound2State(teamId) {
  const tid = String(teamId || "").trim();
  if (!tid) return null;
  try {
    return await refreshTeamStateCache(tid, async () => {
      const list = await loadRound2State([tid]);
      return list[0] || null;
    });
  } catch (err) {
    clearTeamStateCache(tid);
    console.warn("[teamStateCache] refresh failed; cache cleared", {
      team_id: tid,
      error: err?.message || String(err)
    });
    return null;
  }
}

async function getSessionStatusSummary() {
  const teams = await loadRound2State();
  return {
    meta: {
      totalStudents: teams.reduce((sum, team) => sum + (team.members?.length || 0), 0),
      totalTeams: teams.length,
      r1Frozen: teams.filter((team) => team.status === "frozen").length,
      r2Submitted: teams.filter((team) => team.r2.status === "R2_SUBMITTED").length
    },
    teams
  };
}

async function getLatestInterviewSession(teamId, memberId) {
  await ensureSchema();
  const rows = await runSql(`
    SELECT session_id, team_id, member_id, round_no, is_complete, result_json, history_json, member_dims_json, personas_json, created_at, updated_at
    FROM round2_interview_sessions
    WHERE team_id = ${sqlQuote(teamId)} AND member_id = ${sqlQuote(memberId)}
    ORDER BY updated_at DESC
    LIMIT 1;
  `);
  const row = rows[0];
  if (!row) return null;
  return {
    sessionId: row.session_id,
    teamId: row.team_id,
    memberId: row.member_id,
    roundNo: toNumber(row.round_no, 0),
    isComplete: toBool(row.is_complete),
    result: safeJsonParse(row.result_json, null),
    history: safeJsonParse(row.history_json, []),
    memberDims: safeJsonParse(row.member_dims_json, []),
    personas: safeJsonParse(row.personas_json, []),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

async function completeInterviewSession(sessionId, result = null) {
  await ensureSchema();
  await runSql(`
    UPDATE round2_interview_sessions
    SET is_complete = TRUE,
        result_json = ${sqlQuote(result ? JSON.stringify(result) : null)},
        updated_at = ${sqlQuote(nowIso())}
    WHERE session_id = ${sqlQuote(sessionId)};
  `);
  const rows = await runSql(`
    SELECT team_id
    FROM round2_interview_sessions
    WHERE session_id = ${sqlQuote(sessionId)}
    LIMIT 1;
  `);
  if (rows[0]?.team_id) {
    await refreshCachedTeamRound2State(rows[0].team_id);
  }
}

async function getMemberSelectionRow(teamId, memberId) {
  await ensureSchema();
  const rows = await runSql(`
    SELECT team_id, member_id, selections_json, updated_at
    FROM round2_member_selections
    WHERE team_id = ${sqlQuote(teamId)} AND member_id = ${sqlQuote(memberId)}
    LIMIT 1;
  `);
  const row = rows[0];
  if (!row) return null;
  return {
    teamId: row.team_id,
    memberId: row.member_id,
    selections: safeJsonParse(row.selections_json, []),
    updatedAt: row.updated_at
  };
}

async function getSubmittedSelections(teamId) {
  const teamState = await getTeamRound2State(teamId);
  if (!teamState) return [];

  const out = [];
  for (const member of teamState.members) {
    if (member.cardStatus !== "submitted") continue;
    const row = await getMemberSelectionRow(teamId, member.id);
    if (!row || !Array.isArray(row.selections) || !row.selections.length) continue;
    out.push({
      memberId: member.id,
      memberName: member.name,
      selections: row.selections
    });
  }
  return out;
}

module.exports = {
  TEAM_STATUS_ORDER,
  TEAM_STATUS_LABELS,
  MEMBER_STEP_LABELS,
  ensureSchema,
  nowIso,
  clampStatus,
  statusIndex,
  formatGridLabel,
  formatArchitectureLabel,
  logTeacherAction,
  updateTeamRound2Status,
  updateMemberProgress,
  resetMemberFields,
  clearTeamRound2Artifacts,
  clearMemberRound2Artifacts,
  loadRound2State,
  getTeamRound2State,
  refreshCachedTeamRound2State,
  getSessionStatusSummary,
  getLatestInterviewSession,
  completeInterviewSession,
  getMemberSelectionRow,
  getSubmittedSelections,
  deriveCurrentStep,
  deriveTeamStatus
};
