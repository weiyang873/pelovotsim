const { getTeam, setTeamLeader } = require("../multiplayer/teamManager");
const { runSql, sqlQuote } = require("../db/pgSql");
const TeacherDebrief = require("./teacherDebrief");
const {
  normalizeSessionId,
  getSessionConfig,
  updateSessionConfig,
  clearSessionConfigCache
} = require("../multiplayer/sessionConfig");
const { ensureSchema: ensureVpIterationSchema } = require("../multiplayer/vpIterationStore");
const { mergeTeamSelections } = require("../multiplayer/rdTeamAdapter");
const {
  TEAM_STATUS_ORDER,
  ensureSchema,
  nowIso,
  clampStatus,
  statusIndex,
  logTeacherAction,
  updateTeamRound2Status,
  updateTeamRound2StatusFromInterviewCompletion,
  updateTeamRound2StatusFromCardSubmissions,
  updateMemberProgress,
  resetMemberFields,
  clearTeamRound2Artifacts,
  clearMemberRound2Artifacts,
  getTeamRound2State,
  getSessionStatusSummary,
  getLatestInterviewSession,
  completeInterviewSession,
  getMemberSelectionRow,
  getSubmittedSelections
} = require("../multiplayer/round2State");

function makeResponse(status, body) {
  return { status, body };
}

function buildFallbackInterviewResult(session) {
  const dims = Array.isArray(session?.memberDims) ? session.memberDims : [];
  const radar = {
    interaction: 5,
    perception: 5,
    motion: 5,
    safety: 5,
    extend: 5,
    ops: 5
  };
  dims.forEach((dim) => {
    if (dim === "interaction") radar.interaction = 6;
    if (dim === "perception") radar.perception = 6;
    if (dim === "motion") radar.motion = 6;
    if (dim === "safety") radar.safety = 6;
    if (dim === "extend") radar.extend = 6;
    if (dim === "ops") radar.ops = 6;
  });

  return {
    radar,
    tags: dims.slice(0, 4).map((dim) => ({ tag: dim, polarity: 1 })),
    evi: 0.6,
    confidence: {
      interaction: dims.includes("interaction") ? "high" : "low",
      perception: dims.includes("perception") ? "high" : "low",
      motion: dims.includes("motion") ? "high" : "low",
      safety: dims.includes("safety") ? "high" : "low",
      extend: dims.includes("extend") ? "high" : "low",
      ops: dims.includes("ops") ? "high" : "low"
    },
    forced: true
  };
}

async function assertTeam(teamId) {
  const team = await getTeam(teamId);
  if (!team) throw new Error("team not found");
  return team;
}

async function assertMember(teamId, memberId) {
  const team = await assertTeam(teamId);
  const member = (team.members || []).find((item) => item.id === memberId);
  if (!member) throw new Error("member not found in team");
  return { team, member };
}

async function syncMembersToTeamStatus(teamId, targetStatus, membersInput = null) {
  const teamState = membersInput ? { members: membersInput } : await getTeamRound2State(teamId);
  const members = Array.isArray(teamState?.members) ? teamState.members : [];
  const currentTime = nowIso();

  for (const member of members) {
    const patch = { last_activity_at: currentTime };

    if (targetStatus === "R2_REVIEW") {
      patch.current_step = "reviewing";
      patch.interview_status = "not_started";
      patch.interview_rounds = 0;
      patch.card_status = "not_started";
      patch.cards_selected = 0;
      patch.forced_by_teacher = false;
    } else if (targetStatus === "R2_INTERVIEWING") {
      patch.current_step = "interviewing";
      patch.card_status = "not_started";
      patch.cards_selected = 0;
      if (member.interviewStatus !== "completed") {
        patch.interview_status = "not_started";
        patch.interview_rounds = 0;
      }
    } else if (targetStatus === "R2_INDIVIDUAL_CARDS") {
      patch.current_step = member.cardStatus === "submitted" ? "waiting_merge" : "selecting_cards";
      patch.card_status = member.cardStatus === "submitted" ? "submitted" : "not_started";
      patch.cards_selected = member.cardStatus === "submitted" ? member.cardsSelected : 0;
      if (member.interviewStatus !== "completed") {
        patch.interview_status = "completed";
        patch.interview_rounds = Math.max(1, Number(member.interviewRounds || 0));
      }
    } else if (targetStatus === "R2_TEAM_MERGE" || targetStatus === "R2_TEAM_DISCUSSION") {
      patch.current_step = "in_discussion";
    } else if (targetStatus === "R2_SUBMITTED") {
      patch.current_step = "done";
    }

    await updateMemberProgress(teamId, member.id, patch);
  }
}

async function forceMergeTeam(teamId, source = "single") {
  const teamState = await getTeamRound2State(teamId);
  if (!teamState) throw new Error("team not found");

  const submittedSelections = await getSubmittedSelections(teamId);
  if (!submittedSelections.length) {
    throw new Error("当前没有任何已提交的个人选卡");
  }

  const merged = mergeTeamSelections(submittedSelections.map((item) => item.selections));
  if (!String(teamState.leaderMemberId || "").trim()) {
    const fallbackLeaderId = String(submittedSelections[0]?.member_id || teamState.members?.[0]?.id || "").trim();
    if (fallbackLeaderId) {
      await setTeamLeader(teamId, fallbackLeaderId);
    }
  }
  await updateTeamRound2Status(teamId, "R2_TEAM_DISCUSSION");
  await syncMembersToTeamStatus(teamId, "R2_TEAM_DISCUSSION", teamState.members);

  await logTeacherAction({
    action: source === "all" ? "force_merge_all_item" : "force_merge",
    teamId,
    details: {
      submittedMemberCount: submittedSelections.length,
      mergedCardCount: merged.selections.length,
      mergeViolations: merged.violations
    }
  });

  return {
    team_id: teamId,
    submitted_member_count: submittedSelections.length,
    merged_card_count: merged.selections.length,
    merge_violations: merged.violations
  };
}

function getAbsentMemberStep(teamStatus) {
  if (teamStatus === "R2_SUBMITTED") return "done";
  if (teamStatus === "R2_TEAM_DISCUSSION") return "in_discussion";
  if (teamStatus === "R2_TEAM_MERGE" || teamStatus === "R2_INDIVIDUAL_CARDS") return "waiting_merge";
  if (teamStatus === "R2_INTERVIEWING" || teamStatus === "R2_REVIEW") return "interview_done";
  return "done";
}

async function setLeaderApi(body) {
  try {
    const teamId = String(body?.team_id || body?.teamId || "").trim();
    const memberId = String(body?.member_id || body?.memberId || "").trim();
    if (!teamId || !memberId) return makeResponse(400, { ok: false, error: "team_id and member_id required" });

    const team = await assertTeam(teamId);
    const member = (team.members || []).find((item) => item.id === memberId);
    if (!member) return makeResponse(400, { ok: false, error: "member not found in team" });

    const updated = await setTeamLeader(teamId, memberId);
    await logTeacherAction({
      action: "set_leader",
      teamId,
      memberId,
      details: {
        leader_name: member.member_name || member.memberName || "",
        team_name: updated?.team_name || team.team_name || ""
      }
    });

    return makeResponse(200, {
      ok: true,
      team_id: teamId,
      leader_member_id: updated?.leader_member_id || memberId,
      leader_name: updated?.leader_name || member.member_name || ""
    });
  } catch (e) {
    return makeResponse(400, { ok: false, error: e.message });
  }
}

async function sessionStatusApi() {
  try {
    await TeacherDebrief.ensureSchema();
    const data = await getSessionStatusSummary();
    const sessionId = "default";
    const sessionConfig = await getSessionConfig(sessionId);
    return makeResponse(200, { ok: true, session_id: sessionId, session_config: sessionConfig, ...data });
  } catch (e) {
    return makeResponse(500, { ok: false, error: e.message });
  }
}

async function sessionConfigApi(query) {
  try {
    await TeacherDebrief.ensureSchema();
    const sessionId = normalizeSessionId(query?.session_id || query?.sessionId);
    const sessionConfig = await getSessionConfig(sessionId);
    return makeResponse(200, { ok: true, session_id: sessionId, session_config: sessionConfig });
  } catch (e) {
    return makeResponse(500, { ok: false, error: e.message });
  }
}

async function updateSessionConfigApi(body) {
  try {
    await TeacherDebrief.ensureSchema();
    const sessionId = normalizeSessionId(body?.session_id || body?.sessionId);
    const sessionConfig = await updateSessionConfig(sessionId, body?.config || {});
    await logTeacherAction({
      action: "update_session_config",
      details: {
        session_id: sessionId,
        config: sessionConfig
      }
    });
    return makeResponse(200, { ok: true, session_id: sessionId, session_config: sessionConfig });
  } catch (e) {
    return makeResponse(500, { ok: false, error: e.message });
  }
}

async function openRound2Api(body = {}) {
  try {
    await TeacherDebrief.ensureSchema();
    const sessionId = normalizeSessionId(body?.session_id || body?.sessionId);
    const sessionConfig = await getSessionConfig(sessionId);
    const snapshot = await getSessionStatusSummary();
    const affected = [];
    for (const team of snapshot.teams) {
      if (team.status !== "frozen") continue;
      if (team.r2.status !== "R2_NOT_STARTED") continue;
      await updateTeamRound2Status(team.id, "R2_REVIEW");
      await syncMembersToTeamStatus(team.id, "R2_REVIEW", team.members);
      affected.push(team.id);
    }

    await logTeacherAction({
      action: "open_round2",
      details: { session_id: sessionId, affected_team_ids: affected, session_config: sessionConfig }
    });

    return makeResponse(200, {
      ok: true,
      session_id: sessionId,
      session_config: sessionConfig,
      affected_count: affected.length,
      team_ids: affected
    });
  } catch (e) {
    return makeResponse(500, { ok: false, error: e.message });
  }
}

async function forceEndInterviewApi(body) {
  try {
    const teamId = String(body?.team_id || body?.teamId || "").trim();
    const memberId = String(body?.member_id || body?.memberId || "").trim();
    if (!teamId || !memberId) return makeResponse(400, { ok: false, error: "team_id and member_id required" });

    await assertMember(teamId, memberId);
    const session = await getLatestInterviewSession(teamId, memberId);
    if (!session?.sessionId) {
      const teamState = await getTeamRound2State(teamId);
      const member = (teamState?.members || []).find((item) => item.id === memberId);
      if (member?.interviewStatus === "completed") {
        return makeResponse(200, { ok: true, message: "该成员访谈已完成" });
      }
      return makeResponse(400, { ok: false, error: "该成员没有进行中的访谈" });
    }
    const fallback = buildFallbackInterviewResult(session);
    await completeInterviewSession(session.sessionId, session.result || fallback);

    await updateMemberProgress(teamId, memberId, {
      interview_status: "completed",
      interview_rounds: Math.max(1, Number(session?.roundNo || 1)),
      current_step: "interview_done",
      forced_by_teacher: true,
      last_activity_at: nowIso()
    });

    const statusResult = await updateTeamRound2StatusFromInterviewCompletion(teamId);
    if (statusResult.team_status === "R2_INDIVIDUAL_CARDS") {
      await syncMembersToTeamStatus(teamId, "R2_INDIVIDUAL_CARDS");
    }

    await logTeacherAction({
      action: "force_end_interview",
      teamId,
      memberId,
      details: { round_no: Number(session?.roundNo || 0) }
    });

    return makeResponse(200, {
      ok: true,
      team_id: teamId,
      member_id: memberId,
      interview_status: "completed"
    });
  } catch (e) {
    return makeResponse(400, { ok: false, error: e.message });
  }
}

async function forceSubmitCardsApi(body) {
  try {
    const teamId = String(body?.team_id || body?.teamId || "").trim();
    const memberId = String(body?.member_id || body?.memberId || "").trim();
    if (!teamId || !memberId) return makeResponse(400, { ok: false, error: "team_id and member_id required" });

    await assertMember(teamId, memberId);
    const row = await getMemberSelectionRow(teamId, memberId);
    const teamState = await getTeamRound2State(teamId);
    const targetMember = (teamState?.members || []).find((member) => member.id === memberId);
    if (targetMember?.cardStatus === "submitted") {
      return makeResponse(200, { ok: true, message: "该成员已提交选卡" });
    }
    const count = Array.isArray(row?.selections) ? row.selections.length : 0;
    await updateMemberProgress(teamId, memberId, {
      card_status: "submitted",
      cards_selected: count,
      current_step: "waiting_merge",
      forced_by_teacher: true,
      last_activity_at: nowIso()
    });

    const statusResult = await updateTeamRound2StatusFromCardSubmissions(teamId);
    if (statusResult.team_status === "R2_TEAM_MERGE") {
      try {
        await forceMergeTeam(teamId, "auto");
      } catch (err) {
        return makeResponse(400, { ok: false, error: err.message || "自动合并失败" });
      }
    }

    await logTeacherAction({
      action: "force_submit_cards",
      teamId,
      memberId,
      details: { cards_selected: count }
    });

    return makeResponse(200, {
      ok: true,
      team_id: teamId,
      member_id: memberId,
      cards_selected: count,
      card_status: "submitted"
    });
  } catch (e) {
    return makeResponse(400, { ok: false, error: e.message });
  }
}

async function markMemberAbsentApi(body) {
  try {
    const teamId = String(body?.teamId || body?.team_id || "").trim();
    const memberId = String(body?.memberId || body?.member_id || "").trim();
    if (!teamId || !memberId) {
      return makeResponse(400, { ok: false, error: "teamId/memberId required" });
    }

    const { team, member } = await assertMember(teamId, memberId);
    const teamStateBefore = await getTeamRound2State(teamId);
    const teamStatusBefore = teamStateBefore?.r2?.status || "R2_NOT_STARTED";
    const currentStep = getAbsentMemberStep(teamStatusBefore);

    await runSql(`
      UPDATE team_members
      SET interview_status = 'completed',
          card_status = 'submitted',
          current_step = ${sqlQuote(currentStep)},
          forced_by_teacher = TRUE,
          interview_rounds = GREATEST(COALESCE(interview_rounds, 0), 1),
          cards_selected = COALESCE(cards_selected, 0),
          last_activity_at = ${sqlQuote(nowIso())}
      WHERE id = ${sqlQuote(memberId)} AND team_id = ${sqlQuote(teamId)};
    `);

    const interviewStatusResult = await updateTeamRound2StatusFromInterviewCompletion(teamId);
    if (interviewStatusResult.team_status === "R2_INDIVIDUAL_CARDS" && (teamStatusBefore === "R2_REVIEW" || teamStatusBefore === "R2_INTERVIEWING")) {
      await syncMembersToTeamStatus(teamId, "R2_INDIVIDUAL_CARDS");
    }

    const cardStatusResult = await updateTeamRound2StatusFromCardSubmissions(teamId);
    if (cardStatusResult.team_status === "R2_TEAM_MERGE") {
      try {
        await forceMergeTeam(teamId, "auto");
      } catch (_) {
        // Keep the absence action successful even if there is nothing usable to merge yet.
      }
    }

    await logTeacherAction({
      action: "mark_member_absent",
      teamId,
      memberId,
      details: {
        member_name: member.member_name || member.memberName || "",
        team_name: team.team_name || ""
      }
    });

    return makeResponse(200, { ok: true });
  } catch (e) {
    return makeResponse(400, { ok: false, error: e.message });
  }
}

async function forceMergeApi(body) {
  try {
    const teamId = String(body?.team_id || body?.teamId || "").trim();
    if (!teamId) return makeResponse(400, { ok: false, error: "team_id required" });
    const result = await forceMergeTeam(teamId, "single");
    return makeResponse(200, { ok: true, ...result });
  } catch (e) {
    return makeResponse(400, { ok: false, error: e.message });
  }
}

async function forceMergeAllApi() {
  try {
    const snapshot = await getSessionStatusSummary();
    const affected = [];
    const failed = [];

    for (const team of snapshot.teams) {
      if (team.r2.status !== "R2_INDIVIDUAL_CARDS") continue;
      try {
        affected.push(await forceMergeTeam(team.id, "all"));
      } catch (err) {
        failed.push({ team_id: team.id, error: err.message });
      }
    }

    await logTeacherAction({
      action: "force_merge_all",
      details: {
        affected_team_ids: affected.map((item) => item.team_id),
        failed
      }
    });

    return makeResponse(200, {
      ok: true,
      affected_count: affected.length,
      teams: affected,
      failed
    });
  } catch (e) {
    return makeResponse(500, { ok: false, error: e.message });
  }
}

async function forceAdvanceApi(body) {
  try {
    const teamId = String(body?.team_id || body?.teamId || "").trim();
    const rawTarget = body?.target_status || body?.targetStatus || body?.target_step || body?.targetStep;
    let targetStatus = clampStatus(rawTarget);
    if (!targetStatus) {
      const step = String(rawTarget || "").trim().toLowerCase();
      if (step === "pricing") targetStatus = "R2_TEAM_DISCUSSION";
      if (step === "submitted") targetStatus = "R2_SUBMITTED";
    }
    if (!teamId) return makeResponse(400, { ok: false, error: "team_id required" });
    if (!TEAM_STATUS_ORDER.includes(targetStatus) || targetStatus === "R2_NOT_STARTED") {
      return makeResponse(400, { ok: false, error: "invalid target_status" });
    }

    const teamState = await getTeamRound2State(teamId);
    if (!teamState) return makeResponse(404, { ok: false, error: "team not found" });
    if (statusIndex(targetStatus) < statusIndex(teamState.r2.status)) {
      return makeResponse(400, { ok: false, error: "只能向前推进，不能回退" });
    }
    if (targetStatus === "R2_SUBMITTED" && teamState.r2.status !== "R2_SUBMITTED" && !teamState.submission) {
      return makeResponse(400, { ok: false, error: "没有团队提交结果，不能直接推进到已提交" });
    }

    await updateTeamRound2Status(teamId, targetStatus);
    await syncMembersToTeamStatus(teamId, targetStatus, teamState.members);

    await logTeacherAction({
      action: "force_advance",
      teamId,
      details: { from: teamState.r2.status, to: targetStatus }
    });

    return makeResponse(200, {
      ok: true,
      team_id: teamId,
      from_status: teamState.r2.status,
      target_status: targetStatus
    });
  } catch (e) {
    return makeResponse(400, { ok: false, error: e.message });
  }
}

async function resetMemberApi(body) {
  try {
    const teamId = String(body?.team_id || body?.teamId || "").trim();
    const memberId = String(body?.member_id || body?.memberId || "").trim();
    const rawReset = String(body?.reset_to || body?.resetTo || "").trim();
    const resetTo = rawReset === "interview" ? "interviewing" : rawReset === "cards" ? "selecting" : rawReset;
    const confirmed = body?.confirm === true;
    if (!teamId || !memberId) return makeResponse(400, { ok: false, error: "team_id and member_id required" });
    if (!confirmed) {
      return makeResponse(400, { ok: false, needConfirm: true, message: "此操作将清除该成员在该阶段之后的所有数据" });
    }
    if (resetTo !== "interviewing" && resetTo !== "selecting") {
      return makeResponse(400, { ok: false, error: "reset_to must be interviewing or selecting" });
    }

    await assertMember(teamId, memberId);
    await clearMemberRound2Artifacts(teamId, memberId, resetTo);

    if (resetTo === "interviewing") {
      await resetMemberFields(teamId, memberId, {
        current_step: "interviewing",
        last_activity_at: nowIso()
      });
      await updateTeamRound2Status(teamId, "R2_INTERVIEWING");
    } else {
      await updateMemberProgress(teamId, memberId, {
        card_status: "not_started",
        cards_selected: 0,
        current_step: "selecting_cards",
        forced_by_teacher: false,
        last_activity_at: nowIso()
      });
      await updateTeamRound2Status(teamId, "R2_INDIVIDUAL_CARDS");
    }

    await logTeacherAction({
      action: "reset_member",
      teamId,
      memberId,
      details: { reset_to: resetTo }
    });

    return makeResponse(200, {
      ok: true,
      team_id: teamId,
      member_id: memberId,
      reset_to: resetTo
    });
  } catch (e) {
    return makeResponse(400, { ok: false, error: e.message });
  }
}

async function resetTeamApi(body) {
  try {
    const teamId = String(body?.team_id || body?.teamId || "").trim();
    const rawReset = String(body?.reset_to || body?.resetTo || "").trim();
    const mappedReset = rawReset === "interview"
      ? "R2_INTERVIEWING"
      : rawReset === "cards"
        ? "R2_INDIVIDUAL_CARDS"
        : rawReset === "merge"
          ? "R2_TEAM_MERGE"
          : rawReset === "pricing"
            ? "R2_TEAM_DISCUSSION"
            : rawReset;
    const resetTo = clampStatus(mappedReset);
    const confirmed = body?.confirm === true;
    if (!teamId) return makeResponse(400, { ok: false, error: "team_id required" });
    if (!confirmed) return makeResponse(400, { ok: false, needConfirm: true, message: "此操作将清除该组在该阶段之后的所有数据" });
    if (!["R2_REVIEW", "R2_INTERVIEWING", "R2_INDIVIDUAL_CARDS", "R2_TEAM_MERGE", "R2_TEAM_DISCUSSION"].includes(resetTo)) {
      return makeResponse(400, { ok: false, error: "invalid reset_to" });
    }

    const team = await assertTeam(teamId);
    await clearTeamRound2Artifacts(teamId, resetTo);

    for (const member of team.members || []) {
      if (resetTo === "R2_REVIEW") {
        await resetMemberFields(teamId, member.id, {
          current_step: "reviewing",
          last_activity_at: nowIso()
        });
      } else if (resetTo === "R2_INTERVIEWING") {
        await resetMemberFields(teamId, member.id, {
          current_step: "interviewing",
          last_activity_at: nowIso()
        });
      } else if (resetTo === "R2_INDIVIDUAL_CARDS") {
        await updateMemberProgress(teamId, member.id, {
          interview_status: "completed",
          interview_rounds: 1,
          card_status: "not_started",
          cards_selected: 0,
          current_step: "selecting_cards",
          forced_by_teacher: false,
          last_activity_at: nowIso()
        });
      } else if (resetTo === "R2_TEAM_MERGE" || resetTo === "R2_TEAM_DISCUSSION") {
        const isSubmitted = member.cardStatus === "submitted";
        await updateMemberProgress(teamId, member.id, {
          interview_status: member.interviewStatus === "completed" ? "completed" : "completed",
          interview_rounds: Math.max(1, Number(member.interviewRounds || 1)),
          card_status: isSubmitted ? "submitted" : (member.cardsSelected > 0 ? "selecting" : "not_started"),
          cards_selected: Math.max(0, Number(member.cardsSelected || 0)),
          current_step: resetTo === "R2_TEAM_DISCUSSION"
            ? (isSubmitted ? "in_discussion" : "selecting_cards")
            : (isSubmitted ? "waiting_merge" : "selecting_cards"),
          forced_by_teacher: false,
          last_activity_at: nowIso()
        });
      }
    }

    await updateTeamRound2Status(teamId, resetTo);

    await logTeacherAction({
      action: "reset_team",
      teamId,
      details: { reset_to: resetTo }
    });

    return makeResponse(200, {
      ok: true,
      team_id: teamId,
      reset_to: resetTo
    });
  } catch (e) {
    return makeResponse(400, { ok: false, error: e.message });
  }
}

async function resetSessionApi(body) {
  try {
    const confirmed = body?.confirm === true;
    if (!confirmed) {
      return makeResponse(400, { ok: false, error: "reset-session requires confirm: true" });
    }

    await ensureSchema();
    await ensureVpIterationSchema();
    const teamRows = await runSql("SELECT COUNT(*)::int AS count FROM teams;");
    const memberRows = await runSql("SELECT COUNT(*)::int AS count FROM team_members;");
    const deletedTeams = Number(teamRows[0]?.count || 0);
    const deletedMembers = Number(memberRows[0]?.count || 0);

    // Current runtime tables that back the teacher console. "vp_iterations"/"action_log"
    // map to today's persisted tables: vp_sessions and teacher_actions.
    await runSql(`
      DELETE FROM debrief_cache;
      DELETE FROM teacher_actions;
      DELETE FROM computation_log;
      DELETE FROM vp_iterations;
      DELETE FROM marketing_sessions;
      DELETE FROM vp_sessions;
      DELETE FROM fg_team_radar;
      DELETE FROM round2_results;
      DELETE FROM round2_submissions;
      DELETE FROM round2_persona_choices;
      DELETE FROM round2_persona_reports;
      DELETE FROM round2_member_selections;
      DELETE FROM round2_interview_sessions;
      DELETE FROM round2_dimension_assignments;
      DELETE FROM session_config;
      DELETE FROM member_submissions;
      DELETE FROM jinang_settlements;
      DELETE FROM students;
      DELETE FROM team_members;
      DELETE FROM teams;
    `);
    clearSessionConfigCache();

    return makeResponse(200, {
      ok: true,
      deleted_teams: deletedTeams,
      deleted_members: deletedMembers
    });
  } catch (e) {
    return makeResponse(500, { ok: false, error: e.message });
  }
}

module.exports = {
  ensureSchema,
  sessionStatusApi,
  sessionConfigApi,
  updateSessionConfigApi,
  openRound2Api,
  setLeaderApi,
  forceEndInterviewApi,
  forceSubmitCardsApi,
  markMemberAbsentApi,
  forceMergeApi,
  forceMergeAllApi,
  forceAdvanceApi,
  resetMemberApi,
  resetTeamApi,
  resetSessionApi
};
