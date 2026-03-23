"use strict";

/**
 * Round 1 multiplayer end-to-end test
 *
 * Usage:
 *   1. node server.js
 *   2. node scripts/test_round1_e2e.js
 *
 * Optional env:
 *   BASE_URL=http://127.0.0.1:8787
 */

const BASE = process.env.BASE_URL || "http://127.0.0.1:8787";
const TEAM_SIZE = 4;
const GRID_ID = "ToB_CostLeadership_Elder";
const ARCHITECTURE = "Hybrid";

function fail(message) {
  throw new Error(message);
}

function check(condition, message) {
  if (!condition) fail(message);
}

async function get(pathname) {
  const res = await fetch(`${BASE}${pathname}`);
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

async function post(pathname, body) {
  const res = await fetch(`${BASE}${pathname}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body || {})
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

function computePct(result) {
  const breakdown = result?.wtp_breakdown || {};
  if (Number.isFinite(Number(breakdown.final_pct))) return Number(breakdown.final_pct);
  const adj = Number(result?.r1_result?.WTPadj || 0);
  const ref = Number(result?.r1_result?.WTPref || 0);
  if (!Number.isFinite(adj) || !Number.isFinite(ref) || ref <= 0) return 0;
  return Math.round(((adj / ref) - 1) * 100);
}

async function refreshBasic(teamId, expected = {}) {
  const teamRes = await get(`/api/team/${encodeURIComponent(teamId)}`);
  check(teamRes.status === 200 && teamRes.data.ok, `刷新 team 失败: HTTP ${teamRes.status}`);
  check(teamRes.data.team?.id === teamId, "刷新后 teamId 不匹配");

  const statusRes = await get(`/api/team/${encodeURIComponent(teamId)}/status`);
  check(statusRes.status === 200 && statusRes.data.ok, `刷新 status 失败: HTTP ${statusRes.status}`);

  if (expected.teamStatus) {
    check(teamRes.data.team?.status === expected.teamStatus, `team.status=${teamRes.data.team?.status}，期望 ${expected.teamStatus}`);
    check(statusRes.data.status === expected.teamStatus, `status.status=${statusRes.data.status}，期望 ${expected.teamStatus}`);
  }
  if (expected.finalGridId) {
    check(teamRes.data.team?.final_grid_id === expected.finalGridId, `final_grid_id=${teamRes.data.team?.final_grid_id}，期望 ${expected.finalGridId}`);
  }
  if (expected.finalArchitecture) {
    check(teamRes.data.team?.final_architecture === expected.finalArchitecture, `final_architecture=${teamRes.data.team?.final_architecture}，期望 ${expected.finalArchitecture}`);
  }

  return { team: teamRes.data, status: statusRes.data };
}

async function refreshSubmissions(teamId, expectedCount) {
  const res = await get(`/api/team/${encodeURIComponent(teamId)}/submissions`);
  check(res.status === 200 && res.data.ok, `刷新 submissions 失败: HTTP ${res.status}`);
  const submissions = Array.isArray(res.data.submissions) ? res.data.submissions : [];
  if (expectedCount != null) {
    const actual = submissions.filter((s) => Boolean(s?.submitted)).length;
    check(actual === expectedCount, `已提交人数=${actual}，期望 ${expectedCount}`);
  }
  return submissions;
}

async function refreshPhase3(teamId, expected = {}) {
  const res = await get(`/api/team/${encodeURIComponent(teamId)}/phase3/state`);
  check(res.status === 200 && res.data.ok, `刷新 phase3 state 失败: HTTP ${res.status}`);

  const scoreState = res.data.score_state || {};
  if (expected.hasSession) check(Boolean(res.data.session_id), "phase3 session_id 缺失");
  if (expected.status) check(res.data.status === expected.status, `phase3 status=${res.data.status}，期望 ${expected.status}`);
  if (expected.minHistory != null) {
    const actual = Array.isArray(res.data.coach_history) ? res.data.coach_history.length : 0;
    check(actual >= expected.minHistory, `coach_history 长度=${actual}，期望至少 ${expected.minHistory}`);
  }
  if (expected.gridId) {
    check(res.data.strategy?.grid_id === expected.gridId, `phase3 strategy.grid_id=${res.data.strategy?.grid_id}，期望 ${expected.gridId}`);
  }
  if (expected.architecture) {
    check(res.data.strategy?.architecture === expected.architecture, `phase3 strategy.architecture=${res.data.strategy?.architecture}，期望 ${expected.architecture}`);
  }
  if (expected.hasScorePreview != null) {
    check(Boolean(scoreState.has_score_preview) === expected.hasScorePreview, `has_score_preview=${scoreState.has_score_preview}，期望 ${expected.hasScorePreview}`);
  }
  if (expected.scoreValid != null) {
    check(Boolean(scoreState.score_valid) === expected.scoreValid, `score_valid=${scoreState.score_valid}，期望 ${expected.scoreValid}`);
  }

  return res.data;
}

async function main() {
  const teamName = `round1_e2e_${Date.now()}`;
  const sharedDraft = {
    who: "高端养老院的院长与采购负责人（决策者），核心使用者是有基本行动能力但存在独处认知风险的老人。",
    pain: "老人夜间独处时一旦滑倒或情绪激动，现有护工巡检和固定呼叫按钮无法做到24小时主动发现与及时响应，院方又不想持续增加人力成本。",
    how: "LOVOT通过移动跟随、行为规律学习和情绪互动，在不增加额外人力与隐私负担的前提下，提供24小时个性化陪伴与主动风险预警。"
  };
  const coachTurns = [
    "WHO先定：卖给高端养老院的院长和采购负责人，核心使用者是有基本行动能力但存在独处认知风险的老人。",
    "PAIN：老人夜间独处时一旦滑倒或情绪激动，现有护工巡检和固定呼叫按钮无法做到24小时主动发现与及时响应，院方又不想持续增加人力成本。",
    "HOW：LOVOT通过移动跟随、行为规律学习和情绪互动，在不增加额外人力与隐私负担的前提下，提供24小时个性化陪伴、主动风险预警与更及时的看护响应。"
  ];

  const health = await get("/api/health");
  check(health.status === 200 && health.data.ok, `/api/health 失败: HTTP ${health.status}`);

  const createRes = await post("/api/team/create", { teamName, teamSize: TEAM_SIZE });
  check(createRes.status === 200 && createRes.data.ok, `建组失败: HTTP ${createRes.status}`);
  const teamId = createRes.data.team?.id;
  const members = Array.isArray(createRes.data.team?.members) ? createRes.data.team.members : [];
  check(teamId, "createTeam 未返回 teamId");
  check(members.length === TEAM_SIZE, `team members=${members.length}，期望 ${TEAM_SIZE}`);

  await refreshBasic(teamId, { teamStatus: "forming" });
  await refreshSubmissions(teamId, 0);

  for (let i = 0; i < members.length; i += 1) {
    const memberId = members[i]?.id;
    check(memberId, `成员 ${i + 1} 缺少 id`);

    const jinangRes = await get(`/api/team/${encodeURIComponent(teamId)}/member/${encodeURIComponent(memberId)}/jinang`);
    check(jinangRes.status === 200 && jinangRes.data.ok, `成员 ${i + 1} 获取锦囊失败`);
    check(jinangRes.data.jinang?.market?.id, `成员 ${i + 1} market 锦囊缺失`);
    check(jinangRes.data.jinang?.tech?.id, `成员 ${i + 1} tech 锦囊缺失`);

    const submitRes = await post(
      `/api/team/${encodeURIComponent(teamId)}/phase1/${encodeURIComponent(memberId)}/submit`,
      {
        grid_id: GRID_ID,
        architecture: ARCHITECTURE,
        who: sharedDraft.who,
        pain: sharedDraft.pain,
        how: sharedDraft.how
      }
    );
    check(submitRes.status === 200 && submitRes.data.ok, `成员 ${i + 1} Phase1 提交失败: HTTP ${submitRes.status}`);
    await refreshBasic(teamId, { teamStatus: i === TEAM_SIZE - 1 ? "phase2" : "forming" });
    await refreshSubmissions(teamId, i + 1);
  }

  const phase3Status = await refreshBasic(teamId, { teamStatus: "phase2" });
  check(phase3Status.status.all_submitted === true, `all_submitted=${phase3Status.status.all_submitted}，期望 true`);

  for (let i = 0; i < coachTurns.length; i += 1) {
    const chatRes = await post(`/api/team/${encodeURIComponent(teamId)}/phase3/chat`, {
      message: coachTurns[i],
      grid_id: GRID_ID,
      architecture: ARCHITECTURE
    });
    check(chatRes.status === 200 && chatRes.data.ok, `第 ${i + 1} 轮 coach chat 失败: HTTP ${chatRes.status}`);
    check(String(chatRes.data.coach_reply || "").trim().length > 0, `第 ${i + 1} 轮 coach_reply 为空`);

    await refreshPhase3(teamId, {
      hasSession: true,
      status: "chatting",
      gridId: GRID_ID,
      architecture: ARCHITECTURE,
      minHistory: (i + 1) * 2,
      hasScorePreview: false,
      scoreValid: false
    });
  }

  const scoreRes = await post(`/api/team/${encodeURIComponent(teamId)}/phase3/submit-vp`, {
    mode: "score",
    grid_id: GRID_ID,
    architecture: ARCHITECTURE
  });
  check(scoreRes.status === 200 && scoreRes.data.ok, `mode=score 失败: HTTP ${scoreRes.status}`);
  check(scoreRes.data.score_valid === true, `mode=score 未返回 scoreValid=true，实际 ${scoreRes.data.score_valid}`);
  check(scoreRes.data.scores?.coverage != null, "mode=score 缺少 coverage");
  check(scoreRes.data.scores?.generalizability != null, "mode=score 缺少 generalizability");
  check(scoreRes.data.scores?.effectiveness != null, "mode=score 缺少 effectiveness");

  const phase3AfterScore = await refreshPhase3(teamId, {
    hasSession: true,
    gridId: GRID_ID,
    architecture: ARCHITECTURE,
    hasScorePreview: true,
    scoreValid: true
  });
  check(phase3AfterScore.score_state?.score_valid === true, `刷新后 score_valid=${phase3AfterScore.score_state?.score_valid}`);

  const confirmRes = await post(`/api/team/${encodeURIComponent(teamId)}/phase3/submit-vp`, {
    mode: "confirm",
    grid_id: GRID_ID,
    architecture: ARCHITECTURE
  });
  check(confirmRes.status === 200 && confirmRes.data.ok, `mode=confirm 失败: HTTP ${confirmRes.status}`);
  check(confirmRes.data.vp_result && typeof confirmRes.data.vp_result === "object", "mode=confirm 未返回 vpResult");
  check(confirmRes.data.vp_result?.scores, "mode=confirm 返回的 vpResult 缺少 scores");

  const phase3AfterConfirm = await refreshPhase3(teamId, {
    hasSession: true,
    gridId: GRID_ID,
    architecture: ARCHITECTURE,
    hasScorePreview: true
  });

  const finalizeRes = await post(`/api/team/${encodeURIComponent(teamId)}/phase3/finalize`, {
    grid_id: GRID_ID,
    architecture: ARCHITECTURE,
    scores: confirmRes.data.scores || null,
    conversation_history: phase3AfterConfirm.coach_history || [],
    vp_result: confirmRes.data.vp_result || null,
    vp_result_raw: confirmRes.data.vp_result_raw || null
  });
  check(finalizeRes.status === 200 && finalizeRes.data.ok, `phase3 finalize 失败: HTTP ${finalizeRes.status}`);
  check(finalizeRes.data.status === "phase4", `finalize status=${finalizeRes.data.status}，期望 phase4`);
  check(finalizeRes.data.r1_result, "finalize 未返回 r1_result");

  await refreshBasic(teamId, {
    teamStatus: "phase4",
    finalGridId: GRID_ID,
    finalArchitecture: ARCHITECTURE
  });

  const resultRes = await get(`/api/team/${encodeURIComponent(teamId)}/phase4`);
  check(resultRes.status === 200 && resultRes.data.ok, `phase4 结果失败: HTTP ${resultRes.status}`);
  check(resultRes.data.r1_result, "phase4 缺少 r1_result");
  const wtpPct = computePct(resultRes.data);
  check(wtpPct !== 0, `WTP 变化为 0%，期望非 0（当前 ${wtpPct}%）`);

  console.log("✅");
}

main().catch((err) => {
  console.error(`❌ ${err.message}`);
  process.exit(1);
});
