import http from "k6/http";
import { check, group, sleep } from "k6";
import exec from "k6/execution";
import { Counter, Rate, Trend } from "k6/metrics";

const BASE_URL = __ENV.BASE_URL || "http://127.0.0.1:8787";
const RUN_ID = __ENV.RUN_ID || `k6_local_${Date.now()}`;
const TEAMS = 10;
const MEMBERS_PER_TEAM = 6;
const JSON_HEADERS = { "Content-Type": "application/json" };
const SESSION_ID = "default";

const stage1CreateJoinTrend = new Trend("stage1_create_join_ms");
const stage1VerifyTrend = new Trend("stage1_verify_ms");
const stage2StrategyTrend = new Trend("stage2_strategy_ms");
const stage2VerifyTrend = new Trend("stage2_verify_ms");
const stage3Feedback = new Trend("stage3_vp_feedback_ms");
const stage3Confirm = new Trend("stage3_vp_confirm_ms");
const stage3FinalizeTrend = new Trend("stage3_finalize_freeze_ms");
const stage4Reports = new Trend("stage4_reports_ms");
const stage4ReadingStatus = new Trend("stage4_reading_status_ms");
const stage4Freeze = new Trend("stage4_freeze_reports_ms");
const stage5Cards = new Trend("stage5_cards_ms");
const stage5Draft = new Trend("stage5_draft_ms");
const stage6Submit = new Trend("stage6_submit_ms");
const pollState = new Trend("poll_state_ms");

const apiErrors = new Counter("api_errors");
const stageErrors = new Counter("stage_errors");
const deepseekRequests = new Counter("deepseek_request_attempts");
const resultRows = new Counter("team_results_ready");
const eviProxyOk = new Counter("evi_proxy_full_coverage");
const successRate = new Rate("success_rate");
const statePollSuccess = new Rate("state_poll_success");

export const options = {
  scenarios: {
    background_state_poll: {
      executor: "constant-vus",
      vus: 60,
      duration: "6m20s",
      exec: "backgroundStatePoll",
      gracefulStop: "0s"
    },
    stage1_create_join: {
      executor: "per-vu-iterations",
      vus: 60,
      iterations: 1,
      startTime: "0s",
      maxDuration: "25s",
      exec: "stage1CreateJoin"
    },
    stage1_verify: {
      executor: "per-vu-iterations",
      vus: 10,
      iterations: 1,
      startTime: "12s",
      maxDuration: "20s",
      exec: "stage1VerifyTeams"
    },
    stage2_strategy: {
      executor: "per-vu-iterations",
      vus: 60,
      iterations: 1,
      startTime: "18s",
      maxDuration: "30s",
      exec: "stage2SubmitStrategy"
    },
    stage2_verify: {
      executor: "per-vu-iterations",
      vus: 10,
      iterations: 1,
      startTime: "28s",
      maxDuration: "30s",
      exec: "stage2VerifyPhase2"
    },
    stage3_vp: {
      executor: "per-vu-iterations",
      vus: 60,
      iterations: 1,
      startTime: "35s",
      maxDuration: "4m",
      exec: "stage3VpFeedbackAndConfirm"
    },
    stage3_finalize_freeze: {
      executor: "per-vu-iterations",
      vus: 10,
      iterations: 1,
      startTime: "4m20s",
      maxDuration: "45s",
      exec: "stage3FinalizeAndFreeze"
    },
    stage4_assign: {
      executor: "per-vu-iterations",
      vus: 10,
      iterations: 1,
      startTime: "4m32s",
      maxDuration: "30s",
      exec: "stage4AssignDimensions"
    },
    stage4_reports: {
      executor: "per-vu-iterations",
      vus: 60,
      iterations: 1,
      startTime: "4m40s",
      maxDuration: "45s",
      exec: "stage4ReadReports"
    },
    stage4_freeze_reports: {
      executor: "per-vu-iterations",
      vus: 10,
      iterations: 1,
      startTime: "5m00s",
      maxDuration: "30s",
      exec: "stage4FreezeReports"
    },
    stage5_cards: {
      executor: "per-vu-iterations",
      vus: 60,
      iterations: 1,
      startTime: "5m12s",
      maxDuration: "35s",
      exec: "stage5SubmitCards"
    },
    stage5_draft: {
      executor: "per-vu-iterations",
      vus: 10,
      iterations: 1,
      startTime: "5m32s",
      maxDuration: "45s",
      exec: "stage5LeaderDraft"
    },
    stage6_submit: {
      executor: "shared-iterations",
      vus: 1,
      iterations: 1,
      startTime: "5m55s",
      maxDuration: "60s",
      exec: "stage6SerialSubmit"
    }
  },
  thresholds: {
    http_req_failed: ["rate<0.02"],
    stage1_create_join_ms: ["p(95)<3000"],
    stage2_strategy_ms: ["p(95)<3000"],
    stage3_vp_feedback_ms: ["p(95)<30000"],
    stage3_vp_confirm_ms: ["p(95)<30000"],
    stage4_reports_ms: ["p(95)<500"],
    stage4_reading_status_ms: ["p(95)<500"],
    stage5_cards_ms: ["p(95)<3000"],
    stage6_submit_ms: ["p(95)<10000"],
    success_rate: ["rate>0.98"],
    state_poll_success: ["rate>0.98"]
  },
  summaryTrendStats: ["avg", "min", "med", "p(50)", "p(95)", "p(99)", "max", "count"]
};

const DECISIONS = [
  ["ToC_Differentiation_Adult", "Experience", "独居城市白领", "下班回家后家里太安静，情绪很难被接住", "通过主动迎接、情感互动和轻量陪伴帮助用户切回生活状态"],
  ["ToC_Differentiation_Elder", "Experience", "独居老人", "夜间起身和长期独处让老人和子女都不安心", "通过夜间提醒、陪伴互动和异常提示降低照护焦虑"],
  ["ToC_Differentiation_Child", "Hybrid", "双职工家庭的学龄儿童", "家长担心孩子独自在家时无聊、不安全、没人回应", "通过安全互动、教育陪伴和远程联动减轻家长分身乏术"],
  ["ToC_Cost_Adult", "Function", "价格敏感的独居上班族", "希望有陪伴但不愿为复杂功能支付太高溢价", "用稳定基础互动和省心运维提供够用的陪伴"],
  ["ToB_Differentiation_Elder", "Experience", "养老机构夜班运营负责人", "夜班人手有限，既怕异常漏检，也怕老人情绪被忽视", "通过陪伴、提醒和家属沟通提升夜班服务质量"],
  ["ToB_Cost_Child", "Function", "托育机构运营负责人", "老师排班紧，家长投诉和安全巡查都需要更省心", "用可靠提醒、基础互动和低运维成本提升管理效率"],
  ["ToB_Differentiation_Adult", "Hybrid", "企业接待运营负责人", "高峰接待时等待体验不稳定，服务温度和效率难兼顾", "通过欢迎互动、识别和引导提升访客体验"],
  ["ToB_Cost_Elder", "Function", "社区养老服务站负责人", "预算审批严格，人力替代要能算清投入产出", "用稳定提醒、基础巡查和低维护成本减少运营压力"],
  ["ToC_Cost_Child", "Function", "精打细算的双职工家长", "孩子陪伴需求真实存在，但家长会先算每月值不值", "用够用、稳定、不折腾的陪伴和提醒降低看护空缺"],
  ["ToB_Differentiation_Child", "Hybrid", "高端儿童成长中心负责人", "家长期待有温度的教育陪伴和可感知的安全体验", "通过互动陪伴、课程联动和透明反馈提升机构差异化"]
];

const MEMBER_SELECTIONS = [
  [{ cap_id: "voice_basic", tier: "high" }, { cap_id: "persona_dialog", tier: "mid" }],
  [{ cap_id: "perception_base", tier: "high" }, { cap_id: "emotion_recognition", tier: "mid" }],
  [{ cap_id: "basic_avoidance", tier: "mid" }, { cap_id: "follow_mode", tier: "low" }],
  [{ cap_id: "privacy_trust", tier: "mid" }, { cap_id: "child_safety", tier: "low" }],
  [{ cap_id: "cloud_update", tier: "mid" }, { cap_id: "api_iot", tier: "low" }],
  [{ cap_id: "self_diag", tier: "mid" }, { cap_id: "remote_monitor", tier: "low" }]
];

function safeJson(res) {
  try {
    return JSON.parse(res.body || "{}");
  } catch (_) {
    return {};
  }
}

function jsonPost(url, payload, params = {}) {
  return http.post(url, JSON.stringify(payload || {}), {
    headers: JSON_HEADERS,
    timeout: params.timeout || "30s",
    tags: params.tags || {},
  });
}

function jsonGet(url, params = {}) {
  return http.get(url, {
    timeout: params.timeout || "30s",
    tags: params.tags || {},
  });
}

function encode(value) {
  return encodeURIComponent(String(value || ""));
}

function decisionForTeam(teamIndex) {
  const row = DECISIONS[teamIndex % DECISIONS.length];
  return {
    gridId: row[0],
    architecture: row[1],
    who: row[2],
    pain: row[3],
    how: row[4],
    vpText: `WHO: ${row[2]}\nPAIN: ${row[3]}\nHOW: ${row[4]}\nBOUNDARY: 不适用于需要专业医疗或监护责任转移的场景`,
    fields: {
      who_raw: row[2],
      pain_raw: row[3],
      how_raw: row[4],
      alternative_raw: "人工陪伴、智能音箱或人工排班",
      boundary_raw: "不适用于需要专业医疗或监护责任转移的场景"
    }
  };
}

function record(ok, res, trend) {
  successRate.add(Boolean(ok));
  if (trend && res?.timings) trend.add(res.timings.duration);
  if (!ok) {
    apiErrors.add(1);
    stageErrors.add(1);
  }
  return ok;
}

function teamCtx(data, teamIndex) {
  return data.teams[teamIndex % data.teams.length];
}

function indexedCtx(data, rawIndex) {
  const vuIndex = Number(rawIndex || 0);
  const teamIndex = Math.floor(vuIndex / MEMBERS_PER_TEAM) % TEAMS;
  const memberIndex = vuIndex % MEMBERS_PER_TEAM;
  const team = teamCtx(data, teamIndex);
  return {
    team,
    teamIndex,
    memberIndex,
    member: team.members[memberIndex],
    decision: decisionForTeam(teamIndex),
    isLeaderSlot: memberIndex === 0
  };
}

function scenarioCtx(data) {
  return indexedCtx(data, exec.scenario.iterationInTest);
}

function pollCtx(data) {
  return indexedCtx(data, exec.vu.idInTest - 1);
}

function teamByIteration(data) {
  const teamIndex = Number(exec.scenario.iterationInTest || 0) % data.teams.length;
  return {
    team: teamCtx(data, teamIndex),
    teamIndex,
    decision: decisionForTeam(teamIndex)
  };
}

function resolveLeaderId(team) {
  const res = jsonGet(`${BASE_URL}/api/team/${encode(team.teamId)}`, {
    timeout: "10s",
    tags: { phase: "resolve_leader" }
  });
  const body = safeJson(res);
  return String(body.team?.leader_member_id || team.leaderId || "").trim();
}

function waitUntil(fn, attempts, delaySeconds) {
  for (let i = 0; i < attempts; i += 1) {
    const out = fn();
    if (out) return out;
    sleep(delaySeconds);
  }
  return null;
}

function createFixtureTeams() {
  const teams = [];
  for (let teamIndex = 0; teamIndex < TEAMS; teamIndex += 1) {
    const res = jsonPost(`${BASE_URL}/api/team/create`, {
      teamName: `${RUN_ID}_team_${teamIndex + 1}`,
      teamSize: MEMBERS_PER_TEAM
    }, { timeout: "20s" });
    const body = safeJson(res);
    if (res.status !== 200 || body.ok !== true || !body.team?.id) {
      throw new Error(`setup create team failed: ${res.status} ${res.body}`);
    }
    const members = (body.team.members || [])
      .slice()
      .sort((a, b) => Number(a.member_index || 0) - Number(b.member_index || 0))
      .map((member, index) => ({
        memberId: member.id,
        memberIndex: index,
        memberName: member.member_name || `成员${index + 1}`,
      }));
    teams.push({
      teamId: body.team.id,
      teamName: body.team.team_name,
      leaderId: members[0].memberId,
      members
    });
  }
  return teams;
}

export function setup() {
  return {
    runId: RUN_ID,
    baseUrl: BASE_URL,
    teams: createFixtureTeams()
  };
}

export function backgroundStatePoll(data) {
  const ctx = pollCtx(data);
  const res = jsonGet(
    `${BASE_URL}/api/round2/state?teamId=${encode(ctx.team.teamId)}&memberId=${encode(ctx.member.memberId)}&session_id=${SESSION_ID}&lite=1`,
    { timeout: "5s", tags: { phase: "background_poll" } }
  );
  const body = safeJson(res);
  const ok = res.status === 200 && body.ok === true;
  statePollSuccess.add(ok);
  if (res?.timings) pollState.add(res.timings.duration);
  if (!ok) apiErrors.add(1);
  sleep(3);
}

export function stage1CreateJoin(data) {
  const ctx = scenarioCtx(data);
  group("stage1 create/join spike", () => {
    if (ctx.isLeaderSlot) {
      const res = jsonPost(`${BASE_URL}/api/team/create`, {
        teamName: `${RUN_ID}_create_spike_${ctx.teamIndex + 1}`,
        teamSize: MEMBERS_PER_TEAM
      }, { timeout: "10s", tags: { phase: "stage1_create" } });
      const body = safeJson(res);
      record(check(res, {
        "stage1 leader create 200": (r) => r.status === 200 && body.ok === true && Boolean(body.team?.id)
      }), res, stage1CreateJoinTrend);
      return;
    }

    const res = jsonPost(`${BASE_URL}/api/team/${encode(ctx.team.teamId)}/join`, {
      memberName: `${RUN_ID}_T${ctx.teamIndex + 1}_M${ctx.memberIndex + 1}`
    }, { timeout: "10s", tags: { phase: "stage1_join" } });
    const body = safeJson(res);
    record(check(res, {
      "stage1 join 200": (r) => r.status === 200 && body.ok === true && Boolean(body.member?.id),
      "stage1 join no 500": (r) => r.status < 500
    }), res, stage1CreateJoinTrend);
  });
}

export function stage1VerifyTeams(data) {
  const { team, teamIndex } = teamByIteration(data);
  const res = jsonGet(`${BASE_URL}/api/team/${encode(team.teamId)}`, { timeout: "10s", tags: { phase: "stage1_verify" } });
  const body = safeJson(res);
  const names = (body.team?.members || []).map((member) => String(member.member_name || ""));
  const claimed = names.filter((name) => name.startsWith(`${RUN_ID}_T${teamIndex + 1}_`));
  const defaultSlots = names.filter((name) => /^成员\d+$/.test(name));
  record(check(res, {
    "stage1 verify team 200": (r) => r.status === 200 && body.ok === true,
    "stage1 no double-claim symptom": () => claimed.length === 5 && defaultSlots.length === 1 && new Set(claimed).size === 5
  }), res, stage1VerifyTrend);
}

export function stage2SubmitStrategy(data) {
  const ctx = scenarioCtx(data);
  const d = ctx.decision;
  const res = jsonPost(`${BASE_URL}/api/team/${encode(ctx.team.teamId)}/phase1/${encode(ctx.member.memberId)}/submit`, {
    grid_id: d.gridId,
    architecture: d.architecture,
    who: d.who,
    pain: d.pain,
    how: d.how
  }, { timeout: "10s", tags: { phase: "stage2_strategy" } });
  const body = safeJson(res);
  record(check(res, {
    "stage2 strategy 200": (r) => r.status === 200 && body.ok === true,
    "stage2 strategy no 500": (r) => r.status < 500
  }), res, stage2StrategyTrend);
}

export function stage2VerifyPhase2(data) {
  const { team } = teamByIteration(data);
  const res = jsonGet(`${BASE_URL}/api/team/${encode(team.teamId)}/status?memberId=${encode(team.leaderId)}`, {
    timeout: "10s",
    tags: { phase: "stage2_verify" }
  });
  const body = safeJson(res);
  record(check(res, {
    "stage2 team reached phase2": (r) => r.status === 200 && body.ok === true && body.status === "phase2",
    "stage2 leader assigned": () => Boolean(body.leader_member_id || body.leader?.member_id || body.leaderMemberId)
  }), res, stage2VerifyTrend);
}

export function stage3VpFeedbackAndConfirm(data) {
  const ctx = scenarioCtx(data);
  const d = ctx.decision;
  const scores = { C: 4.1, G: 4.0, E: 4.2, Eadj: 4.2, VPscore: 4.1 };
  const leaderId = resolveLeaderId(ctx.team);

  deepseekRequests.add(1);
  const feedbackRes = jsonPost(`${BASE_URL}/api/vp/generate-feedback`, {
    teamId: ctx.team.teamId,
    memberId: ctx.member.memberId,
    vpText: d.vpText,
    gridLabel: d.gridId,
    archLabel: d.architecture,
    confirmedFields: d.fields,
    scores
  }, { timeout: "90s", tags: { phase: "stage3_feedback" } });
  const feedbackBody = safeJson(feedbackRes);
  record(check(feedbackRes, {
    "stage3 feedback 200": (r) => r.status === 200 && feedbackBody.ok === true && Boolean(feedbackBody.feedback)
  }), feedbackRes, stage3Feedback);

  // confirm-and-score is leader-gated in production. To stress the endpoint with
  // 60 concurrent confirm submissions, every VU uses the actual team leader id.
  deepseekRequests.add(1);
  const confirmRes = jsonPost(`${BASE_URL}/api/vp/confirm-and-score`, {
    teamId: ctx.team.teamId,
    memberId: leaderId,
    vpText: d.vpText,
    gridId: d.gridId,
    grid_id: d.gridId,
    architecture: d.architecture,
    confirmedFields: d.fields
  }, { timeout: "90s", tags: { phase: "stage3_confirm" } });
  const confirmBody = safeJson(confirmRes);
  record(check(confirmRes, {
    "stage3 confirm 200": (r) => r.status === 200 && (confirmBody.ok === true || confirmBody.status === "confirmed"),
    "stage3 confirm has feedback": () => Boolean(confirmBody.feedback || confirmBody.feedback_text)
  }), confirmRes, stage3Confirm);
}

export function stage3FinalizeAndFreeze(data) {
  const { team, teamIndex, decision: d } = teamByIteration(data);
  const leaderId = resolveLeaderId(team);

  const draftRes = jsonPost(`${BASE_URL}/api/team/${encode(team.teamId)}/phase2/draft`, {
    memberId: leaderId,
    grid_id: d.gridId,
    architecture: d.architecture
  }, { timeout: "10s", tags: { phase: "stage3_finalize" } });
  const draftBody = safeJson(draftRes);
  const draftOk = draftRes.status === 200 && draftBody.ok === true;

  const finalizeRes = jsonPost(`${BASE_URL}/api/team/${encode(team.teamId)}/phase3/finalize`, {
    memberId: leaderId,
    grid_id: d.gridId,
    architecture: d.architecture,
    vp_text: d.vpText,
    confirmed_fields: d.fields
  }, { timeout: "30s", tags: { phase: "stage3_finalize" } });
  const finalizeBody = safeJson(finalizeRes);

  const freezeRes = jsonPost(`${BASE_URL}/api/team/${encode(team.teamId)}/freeze`, {
    memberId: leaderId
  }, { timeout: "15s", tags: { phase: "stage3_freeze" } });
  const freezeBody = safeJson(freezeRes);

  record(check(finalizeRes, {
    [`stage3 team ${teamIndex + 1} draft ok`]: () => draftOk,
    "stage3 finalize 200": (r) => r.status === 200 && finalizeBody.ok === true,
    "stage3 freeze 200": () => freezeRes.status === 200 && freezeBody.ok === true
  }), finalizeRes, stage3FinalizeTrend);
  if (freezeRes?.timings) stage3FinalizeTrend.add(freezeRes.timings.duration);
}

export function stage4AssignDimensions(data) {
  const { team } = teamByIteration(data);
  const res = jsonPost(`${BASE_URL}/api/round2/assign-dimensions`, {
    teamId: team.teamId,
    sessionId: SESSION_ID,
    memberCount: MEMBERS_PER_TEAM
  }, { timeout: "15s", tags: { phase: "stage4_assign" } });
  const body = safeJson(res);
  record(check(res, {
    "stage4 assign 200": (r) => r.status === 200 && body.ok === true && Array.isArray(body.available_reports)
  }), res, stage4Reports);
}

export function stage4ReadReports(data) {
  const ctx = scenarioCtx(data);
  const catalogRes = jsonGet(`${BASE_URL}/api/round2/persona-reports?teamId=${encode(ctx.team.teamId)}&memberId=${encode(ctx.member.memberId)}&session_id=${SESSION_ID}`, {
    timeout: "10s",
    tags: { phase: "stage4_reports" }
  });
  const catalogBody = safeJson(catalogRes);
  record(check(catalogRes, {
    "stage4 catalog 200": (r) => r.status === 200 && catalogBody.ok === true
  }), catalogRes, stage4Reports);

  for (let reportIndex = 0; reportIndex < 3; reportIndex += 1) {
    const res = jsonGet(`${BASE_URL}/api/round2/persona-report/${reportIndex}?teamId=${encode(ctx.team.teamId)}&memberId=${encode(ctx.member.memberId)}&session_id=${SESSION_ID}`, {
      timeout: "10s",
      tags: { phase: "stage4_reports" }
    });
    const body = safeJson(res);
    record(check(res, {
      "stage4 report 200": (r) => r.status === 200 && body.ok === true && Boolean(body.report?.report_text)
    }), res, stage4Reports);
  }

  const statusRes = jsonGet(`${BASE_URL}/api/round2/team-reading-status?teamId=${encode(ctx.team.teamId)}&memberId=${encode(ctx.member.memberId)}&session_id=${SESSION_ID}`, {
    timeout: "10s",
    tags: { phase: "stage4_reading_status" }
  });
  const statusBody = safeJson(statusRes);
  record(check(statusRes, {
    "stage4 reading status 200": (r) => r.status === 200 && statusBody.ok === true,
    "stage4 my viewed 3": () => Number(statusBody.my_viewed?.length || statusBody.my_viewed_personas?.length || 0) === 3
  }), statusRes, stage4ReadingStatus);

  const completeRes = jsonPost(`${BASE_URL}/api/round2/complete-reading`, {
    teamId: ctx.team.teamId,
    memberId: ctx.member.memberId,
    sessionId: SESSION_ID
  }, { timeout: "10s", tags: { phase: "stage4_complete_reading" } });
  const completeBody = safeJson(completeRes);
  record(check(completeRes, {
    "stage4 complete reading 200": (r) => r.status === 200 && completeBody.ok === true
  }), completeRes, stage4ReadingStatus);
}

export function stage4FreezeReports(data) {
  const { team } = teamByIteration(data);
  const leaderId = resolveLeaderId(team);
  const statusRes = jsonGet(`${BASE_URL}/api/round2/team-reading-status?teamId=${encode(team.teamId)}&memberId=${encode(leaderId)}&session_id=${SESSION_ID}`, {
    timeout: "10s",
    tags: { phase: "stage4_freeze_reports" }
  });
  const statusBody = safeJson(statusRes);
  if (Number(statusBody.team_viewed_count || 0) === 3) eviProxyOk.add(1);

  const selectRes = jsonPost(`${BASE_URL}/api/round2/persona-select`, {
    teamId: team.teamId,
    memberId: leaderId,
    sessionId: SESSION_ID
  }, { timeout: "15s", tags: { phase: "stage4_freeze_reports" } });
  const selectBody = safeJson(selectRes);
  record(check(selectRes, {
    "stage4 team coverage 3/3": () => Number(statusBody.team_viewed_count || 0) === 3,
    "stage4 persona select 200": (r) => r.status === 200 && selectBody.ok === true
  }), selectRes, stage4Freeze);
}

export function stage5SubmitCards(data) {
  const ctx = scenarioCtx(data);
  const selections = MEMBER_SELECTIONS[ctx.memberIndex % MEMBER_SELECTIONS.length];
  const res = jsonPost(`${BASE_URL}/api/round2/member-selection`, {
    teamId: ctx.team.teamId,
    memberId: ctx.member.memberId,
    selections
  }, { timeout: "15s", tags: { phase: "stage5_cards" } });
  const body = safeJson(res);
  record(check(res, {
    "stage5 cards 200": (r) => r.status === 200 && body.ok === true
  }), res, stage5Cards);
}

function waitForAllCards(team) {
  const leaderId = resolveLeaderId(team);
  return waitUntil(() => {
    const res = jsonGet(`${BASE_URL}/api/round2/state?teamId=${encode(team.teamId)}&memberId=${encode(leaderId)}&session_id=${SESSION_ID}`, {
      timeout: "10s",
      tags: { phase: "stage5_wait_cards" }
    });
    const body = safeJson(res);
    if (res.status === 200 && body.ok === true && Array.isArray(body.members) && body.members.every((member) => member.card_status === "submitted")) {
      return body;
    }
    return null;
  }, 12, 2);
}

export function stage5LeaderDraft(data) {
  const { team } = teamByIteration(data);
  const leaderId = resolveLeaderId(team);
  const ready = waitForAllCards(team);
  const mergeRes = jsonPost(`${BASE_URL}/api/round2/merge`, {
    teamId: team.teamId,
    memberId: leaderId,
    COGSbase: 600
  }, { timeout: "20s", tags: { phase: "stage5_draft" } });
  const mergeBody = safeJson(mergeRes);
  const selections = Array.isArray(mergeBody.teamSelections) ? mergeBody.teamSelections : [];
  const draftRes = jsonPost(`${BASE_URL}/api/round2/team-draft`, {
    teamId: team.teamId,
    memberId: leaderId,
    price: 3500,
    selections
  }, { timeout: "15s", tags: { phase: "stage5_draft" } });
  const draftBody = safeJson(draftRes);
  record(check(draftRes, {
    "stage5 all cards ready": () => Boolean(ready),
    "stage5 merge 200": () => mergeRes.status === 200 && mergeBody.ok === true,
    "stage5 team draft 200": (r) => r.status === 200 && draftBody.ok === true
  }), draftRes, stage5Draft);
}

export function stage6SerialSubmit(data) {
  for (let i = 0; i < data.teams.length; i += 1) {
    const team = data.teams[i];
    const leaderId = resolveLeaderId(team);
    const mergeRes = jsonPost(`${BASE_URL}/api/round2/merge`, {
      teamId: team.teamId,
      memberId: leaderId,
      COGSbase: 600
    }, { timeout: "20s", tags: { phase: "stage6_submit" } });
    const mergeBody = safeJson(mergeRes);
    const selections = Array.isArray(mergeBody.teamSelections) ? mergeBody.teamSelections : [];
    const submitRes = jsonPost(`${BASE_URL}/api/round2/team-submit`, {
      teamId: team.teamId,
      memberId: leaderId,
      sessionId: SESSION_ID,
      price: 3500,
      selections,
      mergedInterview: mergeBody.mergedInterview || null,
      bestGrid: mergeBody.bestGrid || ""
    }, { timeout: "30s", tags: { phase: "stage6_submit" } });
    const submitBody = safeJson(submitRes);
    record(check(submitRes, {
      "stage6 merge 200": () => mergeRes.status === 200 && mergeBody.ok === true,
      "stage6 submit 200": (r) => r.status === 200 && submitBody.ok === true
    }), submitRes, stage6Submit);

    const resultRes = jsonGet(`${BASE_URL}/api/round2/team-result?teamId=${encode(team.teamId)}&session_id=${SESSION_ID}`, {
      timeout: "15s",
      tags: { phase: "stage6_result" }
    });
    const resultBody = safeJson(resultRes);
    if (resultRes.status === 200 && resultBody.ok === true && resultBody.result) resultRows.add(1);
    record(check(resultRes, {
      "stage6 result 200": (r) => r.status === 200 && resultBody.ok === true && Boolean(resultBody.result)
    }), resultRes, stage6Submit);
  }
}

function values(data, name) {
  return data.metrics[name]?.values || {};
}

function fmtMs(value) {
  const n = Number(value || 0);
  if (n >= 1000) return `${(n / 1000).toFixed(2)}s`;
  return `${Math.round(n)}ms`;
}

function fmtRate(value) {
  return `${(Number(value || 0) * 100).toFixed(1)}%`;
}

function row(data, label, metric, thresholdP95 = null) {
  const v = values(data, metric);
  const p95 = Number(v["p(95)"] || 0);
  const flag = thresholdP95 != null && p95 > thresholdP95 ? " **超阈值**" : "";
  return `| ${label} | ${fmtMs(v["p(50)"] || v.med)} | ${fmtMs(p95)}${flag} | ${fmtMs(v["p(99)"])} | ${fmtMs(v.max)} | ${Number(v.count || 0)} |`;
}

export function handleSummary(data) {
  const success = values(data, "success_rate").rate || 0;
  const pollSuccess = values(data, "state_poll_success").rate || 0;
  const errors = values(data, "api_errors").count || 0;
  const deepseek = values(data, "deepseek_request_attempts").count || 0;
  const readyRows = values(data, "team_results_ready").count || 0;
  const eviProxy = values(data, "evi_proxy_full_coverage").count || 0;

  const lines = [];
  lines.push(`# merged_v1 spike local report`);
  lines.push("");
  lines.push(`- run_id: \`${RUN_ID}\``);
  lines.push(`- base_url: \`${BASE_URL}\``);
  lines.push(`- shape: ${TEAMS} teams x ${MEMBERS_PER_TEAM} members = ${TEAMS * MEMBERS_PER_TEAM} VU`);
  lines.push(`- DeepSeek request attempts expected by script: ${deepseek}`);
  lines.push(`- overall success_rate: ${fmtRate(success)}`);
  lines.push(`- background poll success_rate: ${fmtRate(pollSuccess)}`);
  lines.push(`- api_errors: ${errors}`);
  lines.push(`- result rows observed via API: ${readyRows}/10`);
  lines.push(`- EVI proxy full report coverage before freeze: ${eviProxy}/10`);
  lines.push("");
  lines.push("| Phase | p50 | p95 | p99 | max | count |");
  lines.push("|---|---:|---:|---:|---:|---:|");
  lines.push(row(data, "1 建队/加入", "stage1_create_join_ms", 3000));
  lines.push(row(data, "1 校验无双认领症状", "stage1_verify_ms"));
  lines.push(row(data, "2 R1 战略提交", "stage2_strategy_ms", 3000));
  lines.push(row(data, "2 phase2 校验", "stage2_verify_ms"));
  lines.push(row(data, "3 VP generate-feedback", "stage3_vp_feedback_ms", 30000));
  lines.push(row(data, "3 VP confirm-and-score", "stage3_vp_confirm_ms", 30000));
  lines.push(row(data, "3 finalize + freeze", "stage3_finalize_freeze_ms"));
  lines.push(row(data, "4 报告下发/切换", "stage4_reports_ms", 500));
  lines.push(row(data, "4 阅读状态轮询", "stage4_reading_status_ms", 500));
  lines.push(row(data, "4 报告冻结", "stage4_freeze_reports_ms"));
  lines.push(row(data, "5 选卡提交", "stage5_cards_ms", 3000));
  lines.push(row(data, "5 merge + draft", "stage5_draft_ms"));
  lines.push(row(data, "6 serial submit/result", "stage6_submit_ms", 10000));
  lines.push(row(data, "背景 team-state 轮询", "poll_state_ms"));
  lines.push("");
  lines.push("> 注意：当前 HTTP 响应不暴露 teamStateCache hit/miss，k6 内只能报告轮询延迟。缓存命中率、PG 查询数、DeepSeek retry 需要结合服务端日志或 DB 侧计数补查。");
  lines.push("");

  return { stdout: `${lines.join("\n")}\n` };
}
