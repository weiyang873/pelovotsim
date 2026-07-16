import http from "k6/http";
import { check, group, sleep } from "k6";
import { Counter, Rate, Trend } from "k6/metrics";

const apiErrors = new Counter("api_errors");
const interviewLatency = new Trend("interview_latency");
const concurrentLLMCalls = new Counter("concurrent_llm");
const llmQueueWait = new Trend("llm_queue_wait");
const deepseekTimeouts = new Counter("deepseek_timeouts");
const successRate = new Rate("success_rate");

const BASE_URL = __ENV.BASE_URL || "https://app.praxisengine.xyz";
const TEAMS = 10;
const MEMBERS_PER_TEAM = 6;
const INTERVIEW_ROUNDS = 5;
const JSON_HEADERS = { "Content-Type": "application/json" };

const ROUND1_SUBMISSIONS = [
  {
    gridId: "ToC_Differentiation_Adult",
    architecture: "Experience",
    who: "独居城市白领，25-35 岁，下班后经常一个人回家",
    pain: "忙完一天回家后情绪掉下来，家里太安静，孤独感会被放大",
    how: "让 LOVOT 在回家第一刻主动迎接并互动，帮助用户切换情绪状态"
  },
  {
    gridId: "ToC_Differentiation_Elder",
    architecture: "Experience",
    who: "独居老人，夜里经常起身，子女无法陪在身边",
    pain: "夜间跌倒风险和独处焦虑会同时出现",
    how: "通过夜间提醒和陪伴互动减轻老人和家属的担心"
  },
  {
    gridId: "ToB_Differentiation_Adult",
    architecture: "Hybrid",
    who: "企业前台和访客接待负责人",
    pain: "接待高峰期人手不足，访客等待和引导体验不稳定",
    how: "通过识别、欢迎互动和语音引导提升接待效率与体验"
  },
  {
    gridId: "ToC_Cost_Adult",
    architecture: "Function",
    who: "双职工家庭，家长白天上班时担心孩子独自在家",
    pain: "陪伴与提醒需求长期存在，但额外看护成本太高",
    how: "通过基础互动、提醒和远程联动补上陪伴空缺"
  },
  {
    gridId: "ToB_Differentiation_Elder",
    architecture: "Experience",
    who: "养老机构夜班运营负责人",
    pain: "夜班护工覆盖不足，既担心异常漏检，也担心老人情绪被忽视",
    how: "通过夜间陪伴和异常提醒提升夜班照护质量"
  },
  {
    gridId: "ToC_Differentiation_Child",
    architecture: "Hybrid",
    who: "有学龄儿童的双职工家庭",
    pain: "家长担心孩子独自在家时无聊、不安全、没人回应",
    how: "通过安全互动和远程联动降低家长看护焦虑"
  }
];

const ROUND1_DECISIONS = [
  {
    gridId: "ToC_Differentiation_Adult",
    architecture: "Experience",
    vpText: "WHO: 独居城市白领，25-35 岁，下班后回到家最容易感到情绪下坠。\nPAIN: 他们缺的不是功能堆叠，而是回家第一刻有人回应、有人接住自己。\nHOW: LOVOT 通过主动迎接、情感互动和轻量陪伴，帮助他们从工作状态平稳切回生活状态。"
  },
  {
    gridId: "ToC_Differentiation_Elder",
    architecture: "Experience",
    vpText: "WHO: 独居老人，夜间起身频繁，家属无法实时陪伴。\nPAIN: 他们既怕跌倒，也怕家里太安静没有回应，家属也长期担心。\nHOW: LOVOT 通过夜间提醒、陪伴互动和异常提示，让老人更安心，家属更放心。"
  },
  {
    gridId: "ToB_Differentiation_Adult",
    architecture: "Hybrid",
    vpText: "WHO: 企业前台和接待负责人，需要在高峰时段稳定接待访客。\nPAIN: 他们面临人手不足、引导混乱和等待体验不稳定的问题。\nHOW: LOVOT 通过欢迎互动、识别和语音引导，帮助团队提升访客体验并减轻前台负担。"
  },
  {
    gridId: "ToB_Differentiation_Elder",
    architecture: "Experience",
    vpText: "WHO: 养老机构夜班运营负责人，需要在有限人手下兼顾老人体验与安全。\nPAIN: 夜班照护压力大，既怕异常漏检，也怕老人情绪被忽视。\nHOW: LOVOT 通过夜间陪伴、提醒和异常提示，帮助机构提升夜班质量。"
  }
];

const ROUND1_CHAT_MESSAGES = [
  "我们锁定的是在关键生活场景里需要情绪被接住或被及时回应的人。",
  "他们的痛点不是功能清单，而是原有方案没有温度，也没有持续陪伴感。",
  "我们想强调 LOVOT 带来的不是单次提醒，而是稳定而自然的情感互动。"
];

const INTERVIEW_MESSAGES = [
  "能先和我讲讲你最近在这个场景里最头疼的一件事吗？",
  "这种情况通常发生在什么时候，频率高吗？",
  "如果有一个会陪伴和提醒的设备，你最希望它先帮你解决哪一步？",
  "你最担心这类设备做得不好的地方是什么？",
  "如果它真的能帮上忙，你会用什么标准判断它值不值得长期留下来？"
];

const MEMBER_SELECTIONS = [
  [
    { cap_id: "voice_basic", tier: "mid" },
    { cap_id: "persona_dialog", tier: "low" }
  ],
  [
    { cap_id: "perception_base", tier: "mid" },
    { cap_id: "emotion_recognition", tier: "low" }
  ],
  [
    { cap_id: "basic_avoidance", tier: "mid" },
    { cap_id: "follow_mode", tier: "low" }
  ],
  [
    { cap_id: "privacy_trust", tier: "mid" },
    { cap_id: "child_safety", tier: "low" }
  ],
  [
    { cap_id: "cloud_update", tier: "mid" },
    { cap_id: "api_iot", tier: "low" }
  ],
  [
    { cap_id: "self_diag", tier: "mid" },
    { cap_id: "remote_monitor", tier: "low" }
  ]
];

export const options = {
  scenarios: {
    round2_load: {
      executor: "per-vu-iterations",
      vus: TEAMS * MEMBERS_PER_TEAM,
      iterations: 1,
      maxDuration: "15m"
    }
  },
  thresholds: {
    http_req_failed: ["rate<0.05"],
    http_req_duration: ["p(95)<30000"],
    interview_latency: ["p(95)<60000"],
    deepseek_timeouts: ["count<5"],
    success_rate: ["rate>0.95"]
  }
};

function safeJson(res) {
  try {
    return JSON.parse(res.body || "{}");
  } catch (_) {
    return {};
  }
}

function jsonGet(url, params = {}) {
  return http.get(url, params);
}

function jsonPost(url, payload, params = {}) {
  return http.post(url, JSON.stringify(payload || {}), {
    headers: JSON_HEADERS,
    ...params
  });
}

function recordMetric(ok, res, options = {}) {
  successRate.add(ok);
  if (!ok) {
    apiErrors.add(1);
  }
  if (options.trend && res && res.timings) {
    options.trend.add(res.timings.duration);
  }
  if (options.timeoutMs && res && res.timings) {
    if (res.status === 0 || res.status === 429 || res.timings.duration > options.timeoutMs) {
      deepseekTimeouts.add(1);
    }
  }
}

function sleepJitter(baseSeconds, rangeSeconds = 0) {
  const delta = rangeSeconds > 0 ? Math.random() * rangeSeconds : 0;
  sleep(baseSeconds + delta);
}

function sortMembers(team) {
  return (Array.isArray(team?.members) ? team.members : [])
    .slice()
    .sort((a, b) => Number(a.member_index || 0) - Number(b.member_index || 0));
}

function waitUntil(fn, attempts, delaySeconds) {
  for (let i = 0; i < attempts; i += 1) {
    const value = fn();
    if (value) return value;
    sleep(delaySeconds);
  }
  return null;
}

function pad(value, width, alignRight = false) {
  const text = String(value);
  if (text.length >= width) return text.slice(0, width);
  const spaces = " ".repeat(width - text.length);
  return alignRight ? `${spaces}${text}` : `${text}${spaces}`;
}

function formatDuration(ms) {
  const value = Number(ms || 0);
  if (value >= 60000) return `${(value / 60000).toFixed(1)}m`;
  if (value >= 1000) return `${(value / 1000).toFixed(1)}s`;
  return `${Math.round(value)}ms`;
}

function formatRate(rate) {
  return `${(Number(rate || 0) * 100).toFixed(1)}%`;
}

function metricValues(data, name) {
  return data.metrics[name]?.values || {};
}

function buildSummary(title, detailRows, totals) {
  const lines = [];
  lines.push(title);
  lines.push("+------------------------------+----------+----------+----------+");
  lines.push("| Metric                       | Avg      | P95      | Max      |");
  lines.push("+------------------------------+----------+----------+----------+");
  detailRows.forEach((row) => {
    lines.push(
      `| ${pad(row.label, 28)} | ${pad(row.avg, 8, true)} | ${pad(row.p95, 8, true)} | ${pad(row.max, 8, true)} |`
    );
  });
  lines.push("+------------------------------+----------+----------+----------+");
  totals.forEach((row) => {
    lines.push(`| ${pad(row.label, 28)} | ${pad(row.value, 32, true)} |`);
  });
  lines.push("+------------------------------+---------------------------------+");
  return lines.join("\n");
}

function bootstrapTeams() {
  const runId = __ENV.RUN_ID || `${Date.now()}`;
  const teams = [];

  for (let teamIndex = 0; teamIndex < TEAMS; teamIndex += 1) {
    const createRes = jsonPost(`${BASE_URL}/api/team/create`, {
      teamName: `loadtest-r2-${runId}-team-${teamIndex + 1}`,
      teamSize: MEMBERS_PER_TEAM
    });
    const createBody = safeJson(createRes);
    if (createRes.status !== 200 || createBody.ok !== true || !createBody.team?.id) {
      throw new Error(`round2 bootstrap create failed: ${createRes.status} ${createRes.body}`);
    }

    const team = createBody.team;
    const sorted = sortMembers(team);
    const leader = sorted[0];
    if (!leader?.id) {
      throw new Error(`round2 bootstrap missing leader slot for team ${teamIndex + 1}`);
    }

    const members = [
      {
        memberId: leader.id,
        memberName: leader.member_name || `Leader-${teamIndex + 1}`,
        memberIndex: 0,
        isLeader: true
      }
    ];

    for (let memberIndex = 1; memberIndex < MEMBERS_PER_TEAM; memberIndex += 1) {
      const joinRes = jsonPost(`${BASE_URL}/api/team/${encodeURIComponent(team.id)}/join`, {
        memberName: `LT-R2-${teamIndex + 1}-${memberIndex + 1}`
      });
      const joinBody = safeJson(joinRes);
      if (joinRes.status !== 200 || joinBody.ok !== true || !joinBody.member?.id) {
        throw new Error(`round2 bootstrap join failed: ${joinRes.status} ${joinRes.body}`);
      }
      members.push({
        memberId: joinBody.member.id,
        memberName: joinBody.member.member_name || `LT-R2-${teamIndex + 1}-${memberIndex + 1}`,
        memberIndex,
        isLeader: false
      });
    }

    members.sort((a, b) => a.memberIndex - b.memberIndex);
    teams.push({
      teamIndex,
      teamId: team.id,
      teamName: team.team_name,
      leaderId: leader.id,
      members
    });
  }

  return { runId, teams };
}

function waitForRound1Phase(teamId, memberId, status) {
  return waitUntil(() => {
    const res = jsonGet(
      `${BASE_URL}/api/team/${encodeURIComponent(teamId)}/status?memberId=${encodeURIComponent(memberId)}`
    );
    const body = safeJson(res);
    if (res.status === 200 && body.ok === true && body.status === status) {
      return body;
    }
    return null;
  }, 45, 2);
}

function isRound2Open(statusBody) {
  const r2Status = String(statusBody?.r2_status || "").trim();
  return r2Status && r2Status !== "R2_NOT_STARTED";
}

function hasFinalGrid(phase4Body) {
  return Boolean(String(phase4Body?.team?.final_grid_id || phase4Body?.final_grid_id || "").trim());
}

function waitForRound1FrozenAndR2Open(teamId, memberId) {
  return waitUntil(() => {
    const statusRes = jsonGet(
      `${BASE_URL}/api/team/${encodeURIComponent(teamId)}/status?memberId=${encodeURIComponent(memberId)}`,
      { timeout: "10s" }
    );
    const statusBody = safeJson(statusRes);
    if (statusRes.status !== 200 || statusBody.ok !== true || !isRound2Open(statusBody)) {
      return null;
    }

    const phase4Res = jsonGet(
      `${BASE_URL}/api/team/${encodeURIComponent(teamId)}/phase4`,
      { timeout: "10s" }
    );
    const phase4Body = safeJson(phase4Res);
    if (phase4Res.status === 200 && phase4Body.ok === true && hasFinalGrid(phase4Body)) {
      return { status: statusBody, phase4: phase4Body };
    }
    return null;
  }, 60, 2);
}

function bootstrapRound1ForTeam(team) {
  const decision = ROUND1_DECISIONS[team.teamIndex % ROUND1_DECISIONS.length];
  let vpText = decision.vpText.trim();

  team.members.forEach((member) => {
    const personal = ROUND1_SUBMISSIONS[member.memberIndex % ROUND1_SUBMISSIONS.length];
    const res = jsonPost(
      `${BASE_URL}/api/team/${encodeURIComponent(team.teamId)}/phase1/${encodeURIComponent(member.memberId)}/submit`,
      {
        grid_id: personal.gridId,
        architecture: personal.architecture,
        who: personal.who,
        pain: personal.pain,
        how: personal.how
      }
    );
    const body = safeJson(res);
    if (res.status !== 200 || body.ok !== true) {
      throw new Error(`round1 bootstrap submit failed: ${res.status} ${res.body}`);
    }
  });

  if (!waitForRound1Phase(team.teamId, team.leaderId, "phase2")) {
    throw new Error(`round1 bootstrap did not reach phase2 for team ${team.teamId}`);
  }

  const draftRes = jsonPost(
    `${BASE_URL}/api/team/${encodeURIComponent(team.teamId)}/phase2/draft`,
    {
      memberId: team.leaderId,
      grid_id: decision.gridId,
      architecture: decision.architecture
    }
  );
  const draftBody = safeJson(draftRes);
  if (draftRes.status !== 200 || draftBody.ok !== true) {
    throw new Error(`round1 bootstrap phase2 draft failed: ${draftRes.status} ${draftRes.body}`);
  }

  ROUND1_CHAT_MESSAGES.forEach((message) => {
    const chatRes = jsonPost(
      `${BASE_URL}/api/team/${encodeURIComponent(team.teamId)}/phase3/chat`,
      {
        memberId: team.leaderId,
        message,
        grid_id: decision.gridId,
        architecture: decision.architecture
      },
      { timeout: "90s" }
    );
    const chatBody = safeJson(chatRes);
    if (chatRes.status !== 200 || chatBody.ok !== true) {
      throw new Error(`round1 bootstrap chat failed: ${chatRes.status} ${chatRes.body}`);
    }
    sleep(0.5);
  });

  const synthRes = jsonPost(
    `${BASE_URL}/api/team/${encodeURIComponent(team.teamId)}/phase3/synthesize-vp`,
    {
      memberId: team.leaderId,
      grid_id: decision.gridId,
      architecture: decision.architecture
    },
    { timeout: "90s" }
  );
  const synthBody = safeJson(synthRes);
  if (synthRes.status === 200 && synthBody.ok === true && String(synthBody.vp_text || "").trim()) {
    vpText = String(synthBody.vp_text || "").trim();
  }

  const extractRes = jsonPost(
    `${BASE_URL}/api/vp/extract-fields`,
    { vpText },
    { timeout: "60s" }
  );
  const extractBody = safeJson(extractRes);
  if (extractRes.status !== 200 || extractBody.ok !== true || !extractBody.fields) {
    throw new Error(`round1 bootstrap extract failed: ${extractRes.status} ${extractRes.body}`);
  }

  const confirmRes = jsonPost(
    `${BASE_URL}/api/vp/confirm-and-score`,
    {
      teamId: team.teamId,
      memberId: team.leaderId,
      vpText,
      gridId: decision.gridId,
      architecture: decision.architecture,
      confirmedFields: extractBody.fields
    },
    { timeout: "90s" }
  );
  const confirmBody = safeJson(confirmRes);
  if (confirmRes.status !== 200 || confirmBody.ok !== true) {
    throw new Error(`round1 bootstrap confirm failed: ${confirmRes.status} ${confirmRes.body}`);
  }

  const finalizeRes = jsonPost(
    `${BASE_URL}/api/team/${encodeURIComponent(team.teamId)}/phase3/finalize`,
    {
      memberId: team.leaderId,
      grid_id: decision.gridId,
      architecture: decision.architecture,
      vp_text: vpText,
      confirmed_fields: extractBody.fields,
      scores: confirmBody.scores || null
    },
    { timeout: "90s" }
  );
  const finalizeBody = safeJson(finalizeRes);
  if (finalizeRes.status !== 200 || finalizeBody.ok !== true) {
    throw new Error(`round1 bootstrap finalize failed: ${finalizeRes.status} ${finalizeRes.body}`);
  }

  const freezeRes = jsonPost(
    `${BASE_URL}/api/team/${encodeURIComponent(team.teamId)}/freeze`,
    { memberId: team.leaderId },
    { timeout: "30s" }
  );
  const freezeBody = safeJson(freezeRes);
  if (freezeRes.status !== 200 || freezeBody.ok !== true || !isRound2Open(freezeBody)) {
    throw new Error(`round1 bootstrap freeze did not open R2: ${freezeRes.status} ${freezeRes.body}`);
  }

  if (!waitForRound1FrozenAndR2Open(team.teamId, team.leaderId)) {
    throw new Error(`round1 bootstrap did not persist final_grid_id and open R2 for team ${team.teamId}`);
  }
}

function resolveVuContext(data) {
  const vuIndex = __VU - 1;
  const teamIndex = Math.floor(vuIndex / MEMBERS_PER_TEAM);
  const memberIndex = vuIndex % MEMBERS_PER_TEAM;
  const team = data.teams[teamIndex];
  const member = team.members[memberIndex];
  return {
    teamIndex,
    memberIndex,
    team,
    member,
    selections: MEMBER_SELECTIONS[memberIndex % MEMBER_SELECTIONS.length],
    isLeader: member.isLeader === true
  };
}

function waitForCardsSubmitted(teamId, memberId) {
  return waitUntil(() => {
    const res = jsonGet(
      `${BASE_URL}/api/round2/state?teamId=${encodeURIComponent(teamId)}&memberId=${encodeURIComponent(memberId)}`
    );
    const body = safeJson(res);
    if (res.status !== 200 || body.ok !== true || !Array.isArray(body.members)) return null;
    const allSubmitted = body.members.every((item) => item.card_status === "submitted");
    return allSubmitted ? body : null;
  }, 40, 2);
}

function waitForTeamResult(teamId) {
  return waitUntil(() => {
    const res = jsonGet(`${BASE_URL}/api/round2/team-result?teamId=${encodeURIComponent(teamId)}&session_id=default`);
    const body = safeJson(res);
    if (res.status === 200 && body.ok === true && body.result) {
      return body;
    }
    return null;
  }, 45, 2);
}

export function setup() {
  const data = bootstrapTeams();
  data.teams.forEach((team) => {
    bootstrapRound1ForTeam(team);
  });
  return data;
}

export default function (data) {
  const ctx = resolveVuContext(data);
  let recap = null;
  let sessionId = "";
  let mergeBody = null;
  let resultReady = null;

  group("Round2 Recap", () => {
    const res = jsonGet(`${BASE_URL}/api/round2/recap?teamId=${encodeURIComponent(ctx.team.teamId)}`);
    const body = safeJson(res);
    const ok = check(res, {
      "round2 recap 200": (r) => r.status === 200 && body.ok === true
    });
    recordMetric(ok, res);
    recap = body;
  });

  sleepJitter(0.5, 0.4);

  if (ctx.isLeader) {
    group("Assign Dimensions", () => {
      const res = jsonPost(`${BASE_URL}/api/round2/assign-dimensions`, {
        teamId: ctx.team.teamId,
        memberCount: MEMBERS_PER_TEAM
      });
      const body = safeJson(res);
      const ok = check(res, {
        "assign dimensions 200": (r) => r.status === 200 && body.ok === true
      });
      recordMetric(ok, res);
    });
    sleepJitter(0.8, 0.5);
  }

  group("Start Interview", () => {
    const res = jsonPost(
      `${BASE_URL}/api/round2/interview/start`,
      {
        teamId: ctx.team.teamId,
        memberId: ctx.member.memberId
      },
      { timeout: "60s" }
    );
    const body = safeJson(res);
    const ok = check(res, {
      "interview start 200": (r) => r.status === 200 && body.ok === true && Boolean(body.sessionId)
    });
    recordMetric(ok, res, { timeoutMs: 30000 });
    sessionId = String(body.sessionId || "");
  });

  group("Focus Group Interview", () => {
    for (let round = 0; round < INTERVIEW_ROUNDS; round += 1) {
      concurrentLLMCalls.add(1);
      const res = jsonPost(
        `${BASE_URL}/api/round2/interview/reply`,
        {
          sessionId,
          message: INTERVIEW_MESSAGES[round]
        },
        { timeout: "90s" }
      );
      const body = safeJson(res);
      const ok = check(res, {
        [`interview reply ${round + 1} 200`]: (r) => r.status === 200 && body.ok === true
      });
      recordMetric(ok, res, {
        trend: interviewLatency,
        timeoutMs: 60000
      });
      llmQueueWait.add(Number(res.timings?.waiting || 0));
      sleepJitter(1.6, 0.8);
    }
  });

  group("End Interview", () => {
    const res = jsonPost(
      `${BASE_URL}/api/round2/interview/end`,
      { sessionId },
      { timeout: "90s" }
    );
    const body = safeJson(res);
    const ok = check(res, {
      "interview end 200": (r) => r.status === 200 && body.ok === true && body.isComplete === true
    });
    recordMetric(ok, res, { timeoutMs: 60000 });
  });

  sleepJitter(0.8, 0.6);

  group("Submit Member Cards", () => {
    const res = jsonPost(`${BASE_URL}/api/round2/member-selection`, {
      teamId: ctx.team.teamId,
      memberId: ctx.member.memberId,
      selections: ctx.selections
    });
    const body = safeJson(res);
    const ok = check(res, {
      "member selection 200": (r) => r.status === 200 && body.ok === true
    });
    recordMetric(ok, res);
  });

  if (ctx.isLeader) {
    group("Merge And Submit Team", () => {
      const ready = waitForCardsSubmitted(ctx.team.teamId, ctx.member.memberId);
      check({ ready }, {
        "all members submitted cards": (value) => Boolean(value.ready)
      });
      if (!ready) {
        apiErrors.add(1);
        successRate.add(false);
        return;
      }

      const mergeRes = jsonPost(`${BASE_URL}/api/round2/merge`, {
        teamId: ctx.team.teamId,
        memberId: ctx.member.memberId,
        COGSbase: Number(recap?.COGSbase || 600)
      });
      mergeBody = safeJson(mergeRes);
      const mergeOk = check(mergeRes, {
        "merge 200": (r) => r.status === 200 && mergeBody.ok === true && Array.isArray(mergeBody.teamSelections)
      });
      recordMetric(mergeOk, mergeRes);

      const teamSelections = Array.isArray(mergeBody?.teamSelections) ? mergeBody.teamSelections : [];
      const price = Math.max(2000, Math.min(5000, Math.round(Number(recap?.P || recap?.WTP || 4000))));

      const draftRes = jsonPost(`${BASE_URL}/api/round2/team-draft`, {
        teamId: ctx.team.teamId,
        memberId: ctx.member.memberId,
        price,
        selections: teamSelections
      });
      const draftBody = safeJson(draftRes);
      const draftOk = check(draftRes, {
        "team draft 200": (r) => r.status === 200 && draftBody.ok === true
      });
      recordMetric(draftOk, draftRes);

      const submitRes = jsonPost(
        `${BASE_URL}/api/round2/team-submit`,
        {
          teamId: ctx.team.teamId,
          memberId: ctx.member.memberId,
          sessionId: "default",
          price,
          selections: teamSelections,
          mergedInterview: mergeBody?.mergedInterview || null,
          bestGrid: String(recap?.final_grid_id || "")
        },
        { timeout: "90s" }
      );
      const submitBody = safeJson(submitRes);
      const submitOk = check(submitRes, {
        "team submit 200": (r) => r.status === 200 && submitBody.ok === true && Boolean(submitBody.result)
      });
      recordMetric(submitOk, submitRes, { timeoutMs: 60000 });
    });
  }

  resultReady = waitForTeamResult(ctx.team.teamId);

  group("Get Team Result", () => {
    const res = jsonGet(`${BASE_URL}/api/round2/team-result?teamId=${encodeURIComponent(ctx.team.teamId)}&session_id=default`);
    const body = safeJson(res);
    const ok = check(res, {
      "team result 200": (r) => r.status === 200 && body.ok === true && Boolean(resultReady?.result || body.result)
    });
    recordMetric(ok, res);
  });
}

export function handleSummary(data) {
  const httpReq = metricValues(data, "http_req_duration");
  const interviewReq = metricValues(data, "interview_latency");
  const queueReq = metricValues(data, "llm_queue_wait");
  const totalReqs = metricValues(data, "http_reqs").count || 0;
  const success = metricValues(data, "success_rate").rate || 0;
  const timeouts = metricValues(data, "deepseek_timeouts").count || 0;
  const errors = metricValues(data, "api_errors").count || 0;
  const llmCalls = metricValues(data, "concurrent_llm").count || 0;

  const summary = buildSummary(
    "Round 2 Load Summary",
    [
      {
        label: "API latency",
        avg: formatDuration(httpReq.avg),
        p95: formatDuration(httpReq["p(95)"]),
        max: formatDuration(httpReq.max)
      },
      {
        label: "Interview latency",
        avg: formatDuration(interviewReq.avg),
        p95: formatDuration(interviewReq["p(95)"]),
        max: formatDuration(interviewReq.max)
      },
      {
        label: "Queue wait proxy",
        avg: formatDuration(queueReq.avg),
        p95: formatDuration(queueReq["p(95)"]),
        max: formatDuration(queueReq.max)
      }
    ],
    [
      { label: "Total requests", value: totalReqs },
      { label: "Success rate", value: formatRate(success) },
      { label: "DeepSeek timeouts", value: timeouts },
      { label: "API errors", value: errors },
      { label: "Interview LLM calls", value: llmCalls }
    ]
  );

  return {
    stdout: `${summary}\n`
  };
}
