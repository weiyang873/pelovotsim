const { getTeam } = require("../multiplayer/teamManager");
const { mergeTeamSelections } = require("../multiplayer/rdTeamAdapter");
const {
  TEAM_STATUS_ORDER,
  ensureSchema,
  nowIso,
  clampStatus,
  statusIndex,
  logTeacherAction,
  updateTeamRound2Status,
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

async function sessionStatusApi() {
  try {
    await ensureSchema();
    const data = await getSessionStatusSummary();
    return makeResponse(200, { ok: true, ...data });
  } catch (e) {
    return makeResponse(500, { ok: false, error: e.message });
  }
}

async function openRound2Api() {
  try {
    await ensureSchema();
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
      details: { affected_team_ids: affected }
    });

    return makeResponse(200, {
      ok: true,
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
    const fallback = buildFallbackInterviewResult(session);
    if (session?.sessionId) {
      await completeInterviewSession(session.sessionId, session.result || fallback);
    }

    await updateMemberProgress(teamId, memberId, {
      interview_status: "completed",
      interview_rounds: Math.max(1, Number(session?.roundNo || 1)),
      current_step: "interview_done",
      forced_by_teacher: true,
      last_activity_at: nowIso()
    });

    const teamState = await getTeamRound2State(teamId);
    const allCompleted = (teamState?.members || []).every((member) => {
      if (member.id === memberId) return true;
      return member.interviewStatus === "completed";
    });
    if (allCompleted) {
      await updateTeamRound2Status(teamId, "R2_INDIVIDUAL_CARDS");
      await syncMembersToTeamStatus(teamId, "R2_INDIVIDUAL_CARDS");
    } else {
      await updateTeamRound2Status(teamId, "R2_INTERVIEWING");
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
    const count = Array.isArray(row?.selections) ? row.selections.length : 0;
    await updateMemberProgress(teamId, memberId, {
      card_status: "submitted",
      cards_selected: count,
      current_step: "waiting_merge",
      forced_by_teacher: true,
      last_activity_at: nowIso()
    });

    const teamState = await getTeamRound2State(teamId);
    const allSubmitted = (teamState?.members || []).every((member) => {
      if (member.id === memberId) return true;
      return member.cardStatus === "submitted";
    });
    await updateTeamRound2Status(teamId, allSubmitted ? "R2_TEAM_MERGE" : "R2_INDIVIDUAL_CARDS");

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
    const targetStatus = clampStatus(body?.target_status || body?.targetStatus);
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
    const resetTo = String(body?.reset_to || body?.resetTo || "").trim();
    if (!teamId || !memberId) return makeResponse(400, { ok: false, error: "team_id and member_id required" });
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
    const resetTo = clampStatus(body?.reset_to || body?.resetTo);
    const confirmed = body?.confirm === true;
    if (!teamId) return makeResponse(400, { ok: false, error: "team_id required" });
    if (!confirmed) return makeResponse(400, { ok: false, error: "reset-team requires confirm: true" });
    if (!["R2_REVIEW", "R2_INTERVIEWING", "R2_INDIVIDUAL_CARDS"].includes(resetTo)) {
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
      } else {
        await updateMemberProgress(teamId, member.id, {
          interview_status: "completed",
          interview_rounds: 1,
          card_status: "not_started",
          cards_selected: 0,
          current_step: "selecting_cards",
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

module.exports = {
  ensureSchema,
  sessionStatusApi,
  openRound2Api,
  forceEndInterviewApi,
  forceSubmitCardsApi,
  forceMergeApi,
  forceMergeAllApi,
  forceAdvanceApi,
  resetMemberApi,
  resetTeamApi
};
