import http from "k6/http";
import { check, group, sleep } from "k6";
import { Counter, Rate, Trend } from "k6/metrics";

const apiErrors = new Counter("api_errors");
const vpCoachLatency = new Trend("vp_coach_latency");
const extractFieldsLatency = new Trend("extract_fields_latency");
const dbWriteLatency = new Trend("db_write_latency");
const deepseekTimeouts = new Counter("deepseek_timeouts");
const successRate = new Rate("success_rate");

const BASE_URL = __ENV.BASE_URL || "https://app.praxisengine.xyz";
const TEAMS = 10;
const MEMBERS_PER_TEAM = 6;
const VP_COACH_ROUNDS = 3;
const JSON_HEADERS = { "Content-Type": "application/json" };

const PERSONAL_SUBMISSIONS = [
  {
    gridId: "ToC_Differentiation_Adult",
    architecture: "Experience",
    who: "独居城市白领，25-35 岁，下班后经常一个人回家",
    pain: "忙完一天回家后情绪掉下来，家里安静得让人更容易感到孤独",
    how: "让 LOVOT 在回家第一时间主动迎接、互动和陪伴，缓冲下班后的情绪落差",
    vpDraft: "独居城市白领在下班回家后感到孤独，通过 LOVOT 的主动迎接获得陪伴感。"
  },
  {
    gridId: "ToC_Differentiation_Elder",
    architecture: "Experience",
    who: "独居老人，夜间行动不便，子女不在身边",
    pain: "夜里起身时容易跌倒，也担心家里太安静没人回应",
    how: "通过夜间提醒、陪伴和异常提醒，让老人更安心，家属也更放心",
    vpDraft: "独居老人在夜间行动不便时，通过 LOVOT 的提醒与陪伴降低跌倒焦虑。"
  },
  {
    gridId: "ToB_Differentiation_Adult",
    architecture: "Hybrid",
    who: "企业前台和访客接待负责人",
    pain: "高峰期接待压力大，访客等待和引导体验不稳定",
    how: "通过识别来访者、语音引导和互动欢迎提升接待效率与体验",
    vpDraft: "企业前台在接待高峰期人手不足时，通过 LOVOT 的接待引导提升访客体验。"
  },
  {
    gridId: "ToC_Cost_Adult",
    architecture: "Function",
    who: "有孩子的年轻双职工家庭",
    pain: "家长白天上班时担心孩子放学后独自在家太无聊，也怕看护不到位",
    how: "用基础互动、提醒和远程联动功能降低家庭陪伴与看护成本",
    vpDraft: "双职工家庭在孩子独处时，通过 LOVOT 的互动提醒降低陪伴与看护压力。"
  },
  {
    gridId: "ToB_Differentiation_Elder",
    architecture: "Experience",
    who: "养老院夜班运营负责人",
    pain: "夜班护工覆盖不足，老人在夜里需要陪伴和异常提醒",
    how: "通过夜间巡检提示和情感互动减轻护工压力并提升老人体验",
    vpDraft: "养老机构夜班人手紧张时，通过 LOVOT 的夜间提醒与陪伴减轻照护压力。"
  },
  {
    gridId: "ToC_Differentiation_Child",
    architecture: "Hybrid",
    who: "有学龄儿童的双职工家庭",
    pain: "家长担心孩子独自在家时既无聊又缺少情绪陪伴",
    how: "通过安全互动、远程连接和情绪陪伴帮助家长缓解看护焦虑",
    vpDraft: "双职工家庭在孩子独处时，通过 LOVOT 的安全互动和远程联动缓解看护焦虑。"
  }
];

const TEAM_DECISIONS = [
  {
    gridId: "ToC_Differentiation_Adult",
    architecture: "Experience",
    vpText: "WHO: 独居城市白领，25-35 岁，下班后回到安静公寓时最容易感到空落落。\nPAIN: 他们在一天高压工作后回家，最难受的是没有人回应和情绪很难切换回来。\nHOW: LOVOT 通过主动迎接、情感互动和轻量陪伴，让他们在回家第一刻重新感到被接住。 "
  },
  {
    gridId: "ToC_Differentiation_Elder",
    architecture: "Experience",
    vpText: "WHO: 独居老人，夜间起身频繁，子女无法实时陪在身边。\nPAIN: 他们怕夜里跌倒、怕没有回应，也怕子女长期担心。\nHOW: LOVOT 通过夜间提醒、情感陪伴和异常提醒，让老人更安心，也减少家属焦虑。 "
  },
  {
    gridId: "ToB_Differentiation_Adult",
    architecture: "Hybrid",
    vpText: "WHO: 企业前台和接待负责人，在访客高峰时段需要稳定接待体验。\nPAIN: 他们常常面临人手不足、引导混乱和访客等待时间过长的问题。\nHOW: LOVOT 通过欢迎互动、语音引导和基础识别，提升到访体验并减轻前台负荷。 "
  },
  {
    gridId: "ToC_Cost_Adult",
    architecture: "Function",
    vpText: "WHO: 双职工家庭，家长白天上班时担心孩子独自在家。\nPAIN: 他们最怕孩子无聊、分心或临时状况没人提醒，但也无法承担更高看护成本。\nHOW: LOVOT 通过基础互动、提醒和远程联动，在可控成本下补上家庭陪伴空缺。 "
  },
  {
    gridId: "ToB_Differentiation_Elder",
    architecture: "Experience",
    vpText: "WHO: 养老机构夜班运营负责人，需要在有限人手下兼顾老人体验与安全。\nPAIN: 夜间巡视频繁、护工压力大，既怕异常漏检，也怕老人情绪被忽视。\nHOW: LOVOT 通过夜间提醒、陪伴互动和异常提示，帮助机构提升夜班质量。 "
  }
];

const VP_CHAT_MESSAGES = [
  "我们锁定的核心用户是在城市独居、下班后最容易感到空落落的人群。",
  "他们不是缺一个功能，而是缺回家那一刻有人回应、有人接住情绪。",
  "我们想强调 LOVOT 通过主动迎接和持续互动，创造一种现有智能音箱做不到的陪伴感。"
];

export const options = {
  scenarios: {
    round1_load: {
      executor: "per-vu-iterations",
      vus: TEAMS * MEMBERS_PER_TEAM,
      iterations: 1,
      maxDuration: "10m"
    }
  },
  thresholds: {
    http_req_failed: ["rate<0.05"],
    http_req_duration: ["p(95)<30000"],
    vp_coach_latency: ["p(95)<60000"],
    extract_fields_latency: ["p(95)<30000"],
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
  if (options.write === true && res && res.timings) {
    dbWriteLatency.add(res.timings.duration);
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

function buildSummary(title, data, detailRows, totals) {
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
    lines.push(
      `| ${pad(row.label, 28)} | ${pad(row.value, 32, true)} |`
    );
  });
  lines.push("+------------------------------+---------------------------------+");
  return lines.join("\n");
}

function waitUntil(fn, attempts, delaySeconds) {
  for (let i = 0; i < attempts; i += 1) {
    const value = fn();
    if (value) return value;
    sleep(delaySeconds);
  }
  return null;
}

function bootstrapTeams() {
  const runId = __ENV.RUN_ID || `${Date.now()}`;
  const teams = [];

  for (let teamIndex = 0; teamIndex < TEAMS; teamIndex += 1) {
    const createRes = jsonPost(`${BASE_URL}/api/team/create`, {
      teamName: `loadtest-r1-${runId}-team-${teamIndex + 1}`,
      teamSize: MEMBERS_PER_TEAM
    });
    const createBody = safeJson(createRes);
    if (createRes.status !== 200 || createBody.ok !== true || !createBody.team?.id) {
      throw new Error(`team bootstrap failed at create: ${createRes.status} ${createRes.body}`);
    }

    const team = createBody.team;
    const sorted = sortMembers(team);
    const leader = sorted[0];
    if (!leader?.id) {
      throw new Error(`team bootstrap missing leader slot for team ${teamIndex + 1}`);
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
        memberName: `LT-R1-${teamIndex + 1}-${memberIndex + 1}`
      });
      const joinBody = safeJson(joinRes);
      if (joinRes.status !== 200 || joinBody.ok !== true || !joinBody.member?.id) {
        throw new Error(`team bootstrap failed at join: ${joinRes.status} ${joinRes.body}`);
      }
      members.push({
        memberId: joinBody.member.id,
        memberName: joinBody.member.member_name || `LT-R1-${teamIndex + 1}-${memberIndex + 1}`,
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

function resolveVuContext(data) {
  const vuIndex = __VU - 1;
  const teamIndex = Math.floor(vuIndex / MEMBERS_PER_TEAM);
  const memberIndex = vuIndex % MEMBERS_PER_TEAM;
  const team = data.teams[teamIndex];
  const member = team.members[memberIndex];
  const personal = PERSONAL_SUBMISSIONS[memberIndex % PERSONAL_SUBMISSIONS.length];
  const decision = TEAM_DECISIONS[teamIndex % TEAM_DECISIONS.length];
  return {
    vuId: __VU,
    teamIndex,
    memberIndex,
    team,
    member,
    personal,
    decision,
    isLeader: member.isLeader === true
  };
}

function waitForPhase2(teamId, memberId) {
  return waitUntil(() => {
    const res = jsonGet(
      `${BASE_URL}/api/team/${encodeURIComponent(teamId)}/status?memberId=${encodeURIComponent(memberId)}`
    );
    const body = safeJson(res);
    if (res.status === 200 && body.ok === true && (body.status === "phase2" || body.all_submitted === true)) {
      return body;
    }
    return null;
  }, 30, 2);
}

function waitForPhase4(teamId, memberId) {
  return waitUntil(() => {
    const res = jsonGet(
      `${BASE_URL}/api/team/${encodeURIComponent(teamId)}/status?memberId=${encodeURIComponent(memberId)}`
    );
    const body = safeJson(res);
    if (res.status === 200 && body.ok === true && body.status === "phase4") {
      return body;
    }
    return null;
  }, 45, 2);
}

function fetchPhase4(teamId) {
  return jsonGet(`${BASE_URL}/api/team/${encodeURIComponent(teamId)}/phase4`);
}

function sleepFinalizeScatter(teamIndex) {
  if (TEAMS <= 1) return;
  sleep((Number(teamIndex || 0) * 5) / TEAMS);
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

    const phase4Res = fetchPhase4(teamId);
    const phase4Body = safeJson(phase4Res);
    if (phase4Res.status === 200 && phase4Body.ok === true && hasFinalGrid(phase4Body)) {
      return { status: statusBody, phase4: phase4Body };
    }
    return null;
  }, 60, 2);
}

export function setup() {
  return bootstrapTeams();
}

export default function (data) {
  const ctx = resolveVuContext(data);
  let synthesizedVpText = ctx.decision.vpText.trim();
  let confirmedFields = null;
  let confirmedScores = null;

  group("Get Jinang", () => {
    const res = jsonGet(
      `${BASE_URL}/api/team/${encodeURIComponent(ctx.team.teamId)}/member/${encodeURIComponent(ctx.member.memberId)}/jinang`
    );
    const body = safeJson(res);
    const ok = check(res, {
      "jinang 200": (r) => r.status === 200 && body.ok === true
    });
    recordMetric(ok, res);
  });

  sleepJitter(0.5, 0.5);

  group("Submit Personal Strategy", () => {
    const res = jsonPost(
      `${BASE_URL}/api/team/${encodeURIComponent(ctx.team.teamId)}/phase1/${encodeURIComponent(ctx.member.memberId)}/submit`,
      {
        grid_id: ctx.personal.gridId,
        architecture: ctx.personal.architecture,
        who: ctx.personal.who,
        pain: ctx.personal.pain,
        how: ctx.personal.how
      }
    );
    const body = safeJson(res);
    const ok = check(res, {
      "phase1 submit 200": (r) => r.status === 200 && body.ok === true
    });
    recordMetric(ok, res, { write: true });
  });

  sleepJitter(0.8, 0.6);

  if (ctx.isLeader) {
    group("Wait For Team Phase2", () => {
      const ready = waitForPhase2(ctx.team.teamId, ctx.member.memberId);
      check({ ready }, {
        "team reached phase2": (value) => Boolean(value.ready)
      });
      if (!ready) {
        apiErrors.add(1);
        successRate.add(false);
      }
    });

    group("Save Phase2 Draft", () => {
      const res = jsonPost(
        `${BASE_URL}/api/team/${encodeURIComponent(ctx.team.teamId)}/phase2/draft`,
        {
          memberId: ctx.member.memberId,
          grid_id: ctx.decision.gridId,
          architecture: ctx.decision.architecture
        }
      );
      const body = safeJson(res);
      const ok = check(res, {
        "phase2 draft 200": (r) => r.status === 200 && body.ok === true
      });
      recordMetric(ok, res, { write: true });
    });

    sleepJitter(1.0, 0.8);

    group("VP Coach Chat", () => {
      for (let index = 0; index < VP_COACH_ROUNDS; index += 1) {
        const res = jsonPost(
          `${BASE_URL}/api/team/${encodeURIComponent(ctx.team.teamId)}/phase3/chat`,
          {
            memberId: ctx.member.memberId,
            message: VP_CHAT_MESSAGES[index],
            grid_id: ctx.decision.gridId,
            architecture: ctx.decision.architecture
          },
          { timeout: "90s" }
        );
        const body = safeJson(res);
        const ok = check(res, {
          [`vp coach ${index + 1} 200`]: (r) => r.status === 200 && body.ok === true
        });
        recordMetric(ok, res, {
          trend: vpCoachLatency,
          timeoutMs: 60000
        });
        sleepJitter(1.8, 0.8);
      }
    });

    group("Synthesize VP", () => {
      const res = jsonPost(
        `${BASE_URL}/api/team/${encodeURIComponent(ctx.team.teamId)}/phase3/synthesize-vp`,
        {
          memberId: ctx.member.memberId,
          grid_id: ctx.decision.gridId,
          architecture: ctx.decision.architecture
        },
        { timeout: "90s" }
      );
      const body = safeJson(res);
      const ok = check(res, {
        "synthesize vp 200": (r) => r.status === 200 && body.ok === true
      });
      recordMetric(ok, res, { timeoutMs: 60000 });
      if (ok && String(body.vp_text || "").trim()) {
        synthesizedVpText = String(body.vp_text || "").trim();
      }
    });

    sleepJitter(1.0, 0.5);

    group("Confirm VP", () => {
      const extractRes = jsonPost(
        `${BASE_URL}/api/vp/extract-fields`,
        { vpText: synthesizedVpText },
        { timeout: "60s" }
      );
      const extractBody = safeJson(extractRes);
      const extractOk = check(extractRes, {
        "extract fields 200": (r) => r.status === 200 && extractBody.ok === true
      });
      recordMetric(extractOk, extractRes, {
        trend: extractFieldsLatency,
        timeoutMs: 30000
      });
      confirmedFields = extractBody.fields || null;

      const confirmRes = jsonPost(
        `${BASE_URL}/api/vp/confirm-and-score`,
        {
          teamId: ctx.team.teamId,
          memberId: ctx.member.memberId,
          vpText: synthesizedVpText,
          gridId: ctx.decision.gridId,
          architecture: ctx.decision.architecture,
          confirmedFields
        },
        { timeout: "90s" }
      );
      const confirmBody = safeJson(confirmRes);
      const confirmOk = check(confirmRes, {
        "confirm score 200": (r) => r.status === 200 && confirmBody.ok === true
      });
      recordMetric(confirmOk, confirmRes, {
        write: true,
        timeoutMs: 60000
      });
      confirmedScores = confirmBody.scores || null;

      sleepFinalizeScatter(ctx.teamIndex);
      const finalizeRes = jsonPost(
        `${BASE_URL}/api/team/${encodeURIComponent(ctx.team.teamId)}/phase3/finalize`,
        {
          memberId: ctx.member.memberId,
          grid_id: ctx.decision.gridId,
          architecture: ctx.decision.architecture,
          vp_text: synthesizedVpText,
          confirmed_fields: confirmedFields,
          scores: confirmedScores
        },
        { timeout: "90s" }
      );
      const finalizeBody = safeJson(finalizeRes);
      const finalizeOk = check(finalizeRes, {
        "finalize 200": (r) => r.status === 200 && finalizeBody.ok === true
      });
      recordMetric(finalizeOk, finalizeRes, { write: true });

      if (finalizeOk) {
        const freezeRes = jsonPost(
          `${BASE_URL}/api/team/${encodeURIComponent(ctx.team.teamId)}/freeze`,
          { memberId: ctx.member.memberId },
          { timeout: "30s" }
        );
        const freezeBody = safeJson(freezeRes);
        const freezeOk = check(freezeRes, {
          "freeze opens r2": (r) => r.status === 200 && freezeBody.ok === true && isRound2Open(freezeBody)
        });
        recordMetric(freezeOk, freezeRes, { write: true });
      }
    });
  }

  const readyForR2 = waitForRound1FrozenAndR2Open(ctx.team.teamId, ctx.member.memberId);
  check({ readyForR2 }, {
    "final_grid_id persisted and r2 opened": (value) => Boolean(value.readyForR2)
  });
  if (!readyForR2) {
    apiErrors.add(1);
    successRate.add(false);
    return;
  }

  group("Get Results", () => {
    const res = fetchPhase4(ctx.team.teamId);
    const body = safeJson(res);
    const ok = check(res, {
      "phase4 200": (r) => r.status === 200 && body.ok === true && hasFinalGrid(body)
    });
    recordMetric(ok, res);
  });
}

export function handleSummary(data) {
  const httpReq = metricValues(data, "http_req_duration");
  const vpReq = metricValues(data, "vp_coach_latency");
  const extractReq = metricValues(data, "extract_fields_latency");
  const totalReqs = metricValues(data, "http_reqs").count || 0;
  const success = metricValues(data, "success_rate").rate || 0;
  const timeouts = metricValues(data, "deepseek_timeouts").count || 0;
  const errors = metricValues(data, "api_errors").count || 0;

  const summary = buildSummary(
    "Round 1 Load Summary",
    data,
    [
      {
        label: "API latency",
        avg: formatDuration(httpReq.avg),
        p95: formatDuration(httpReq["p(95)"]),
        max: formatDuration(httpReq.max)
      },
      {
        label: "VP coach latency",
        avg: formatDuration(vpReq.avg),
        p95: formatDuration(vpReq["p(95)"]),
        max: formatDuration(vpReq.max)
      },
      {
        label: "Extract fields latency",
        avg: formatDuration(extractReq.avg),
        p95: formatDuration(extractReq["p(95)"]),
        max: formatDuration(extractReq.max)
      }
    ],
    [
      { label: "Total requests", value: totalReqs },
      { label: "Success rate", value: formatRate(success) },
      { label: "DeepSeek timeouts", value: timeouts },
      { label: "API errors", value: errors }
    ]
  );

  return {
    stdout: `${summary}\n`
  };
}
