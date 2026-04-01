import http from "k6/http";
import { check, group, sleep } from "k6";
import { Counter, Rate, Trend } from "k6/metrics";

const apiErrors = new Counter("api_errors");
const vpCoachLatency = new Trend("vp_coach_latency");
const extractFieldsLatency = new Trend("extract_fields_latency");
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
    pain: "忙完一天回家后情绪掉下来，安静环境会放大孤独感",
    how: "通过主动迎接和情感互动帮助用户把情绪从工作模式切回生活模式"
  },
  {
    gridId: "ToC_Differentiation_Elder",
    architecture: "Experience",
    who: "独居老人，夜里经常起身，子女不在身边",
    pain: "夜间行动和独处焦虑会同时出现",
    how: "通过夜间提醒和陪伴互动降低老人和家属的担心"
  },
  {
    gridId: "ToB_Differentiation_Adult",
    architecture: "Hybrid",
    who: "企业前台和接待负责人",
    pain: "接待高峰期人手不足，访客等待和引导体验不稳定",
    how: "通过欢迎互动和语音引导提升接待效率与到访体验"
  },
  {
    gridId: "ToC_Cost_Adult",
    architecture: "Function",
    who: "双职工家庭，家长白天上班时担心孩子独自在家",
    pain: "陪伴和提醒需求长期存在，但高成本看护不可持续",
    how: "通过基础互动、提醒和远程联动补齐日常陪伴"
  },
  {
    gridId: "ToB_Differentiation_Elder",
    architecture: "Experience",
    who: "养老机构夜班运营负责人",
    pain: "夜班人手不足，异常提醒和老人情绪兼顾都很难",
    how: "通过夜间陪伴和异常提示提升夜班照护质量"
  },
  {
    gridId: "ToC_Differentiation_Child",
    architecture: "Hybrid",
    who: "有学龄儿童的双职工家庭",
    pain: "孩子独自在家时无聊、不安全、没人回应",
    how: "通过安全互动和远程联动降低家长看护焦虑"
  }
];

const TEAM_DECISIONS = [
  {
    gridId: "ToC_Differentiation_Adult",
    architecture: "Experience",
    vpText: "WHO: 独居城市白领，25-35 岁，下班后回家最容易感到空落落。\nPAIN: 他们在一天高压工作后回到家，没有人回应，情绪很难切换回来。\nHOW: LOVOT 通过主动迎接、情感互动和轻量陪伴，让用户在回家第一刻感到被接住。"
  },
  {
    gridId: "ToC_Differentiation_Elder",
    architecture: "Experience",
    vpText: "WHO: 独居老人，夜间起身频繁，家属无法实时陪伴。\nPAIN: 他们既怕跌倒，也怕夜里太安静没有回应，家属也长期担心。\nHOW: LOVOT 通过夜间提醒、陪伴互动和异常提示，让老人更安心，家属更放心。"
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

const VP_CHAT_MESSAGES = [
  "我们锁定的是在关键生活场景里需要情绪被接住或被及时回应的人。",
  "他们的痛点不是功能越多越好，而是原有方案没有温度，也没有持续陪伴感。",
  "我们想强调 LOVOT 带来的不是单次提醒，而是稳定自然的情感互动。"
];

export const options = {
  scenarios: {
    ramp_up: {
      executor: "ramping-vus",
      startVUs: 0,
      gracefulRampDown: "0s",
      stages: [
        { duration: "1m", target: 10 },
        { duration: "2m", target: 30 },
        { duration: "2m", target: 60 },
        { duration: "3m", target: 60 },
        { duration: "1m", target: 0 }
      ]
    }
  },
  thresholds: {
    http_req_failed: ["rate<0.10"],
    http_req_duration: ["p(95)<30000"],
    vp_coach_latency: ["p(95)<60000"],
    extract_fields_latency: ["p(95)<30000"],
    deepseek_timeouts: ["count<10"],
    success_rate: ["rate>0.90"]
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

function metricValues(data, name) {
  return data.metrics[name]?.values || {};
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
      teamName: `loadtest-progressive-${runId}-team-${teamIndex + 1}`,
      teamSize: MEMBERS_PER_TEAM
    });
    const createBody = safeJson(createRes);
    if (createRes.status !== 200 || createBody.ok !== true || !createBody.team?.id) {
      throw new Error(`progressive bootstrap create failed: ${createRes.status} ${createRes.body}`);
    }

    const team = createBody.team;
    const sorted = sortMembers(team);
    const leader = sorted[0];
    if (!leader?.id) {
      throw new Error(`progressive bootstrap missing leader slot for team ${teamIndex + 1}`);
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
        memberName: `LT-P-${teamIndex + 1}-${memberIndex + 1}`
      });
      const joinBody = safeJson(joinRes);
      if (joinRes.status !== 200 || joinBody.ok !== true || !joinBody.member?.id) {
        throw new Error(`progressive bootstrap join failed: ${joinRes.status} ${joinRes.body}`);
      }
      members.push({
        memberId: joinBody.member.id,
        memberName: joinBody.member.member_name || `LT-P-${teamIndex + 1}-${memberIndex + 1}`,
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
  return {
    teamIndex,
    memberIndex,
    team,
    member,
    personal: PERSONAL_SUBMISSIONS[memberIndex % PERSONAL_SUBMISSIONS.length],
    decision: TEAM_DECISIONS[teamIndex % TEAM_DECISIONS.length],
    isLeader: member.isLeader === true
  };
}

function waitForStatus(teamId, memberId, status) {
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
    recordMetric(ok, res);
  });

  sleepJitter(0.7, 0.5);

  if (ctx.isLeader) {
    group("Wait For Phase2", () => {
      const ready = waitForStatus(ctx.team.teamId, ctx.member.memberId, "phase2");
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
      recordMetric(ok, res);
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
        sleepJitter(1.5, 0.8);
      }
    });

    group("Synthesize And Confirm", () => {
      const synthRes = jsonPost(
        `${BASE_URL}/api/team/${encodeURIComponent(ctx.team.teamId)}/phase3/synthesize-vp`,
        {
          memberId: ctx.member.memberId,
          grid_id: ctx.decision.gridId,
          architecture: ctx.decision.architecture
        },
        { timeout: "90s" }
      );
      const synthBody = safeJson(synthRes);
      const synthOk = check(synthRes, {
        "synthesize vp 200": (r) => r.status === 200 && synthBody.ok === true
      });
      recordMetric(synthOk, synthRes, { timeoutMs: 60000 });
      if (synthOk && String(synthBody.vp_text || "").trim()) {
        synthesizedVpText = String(synthBody.vp_text || "").trim();
      }

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
      recordMetric(confirmOk, confirmRes, { timeoutMs: 60000 });
      confirmedScores = confirmBody.scores || null;

      const finalizeRes = jsonPost(
        `${BASE_URL}/api/team/${encodeURIComponent(ctx.team.teamId)}/phase3/finalize`,
        {
          memberId: ctx.member.memberId,
          grid_id: ctx.decision.gridId,
          architecture: ctx.decision.architecture,
          vp_text: synthesizedVpText,
          confirmed_fields: confirmedFields,
          scores: confirmedScores
        }
      );
      const finalizeBody = safeJson(finalizeRes);
      const finalizeOk = check(finalizeRes, {
        "finalize 200": (r) => r.status === 200 && finalizeBody.ok === true
      });
      recordMetric(finalizeOk, finalizeRes);
    });
  }

  const phase4Ready = waitForStatus(ctx.team.teamId, ctx.member.memberId, "phase4");

  group("Get Results", () => {
    const res = jsonGet(`${BASE_URL}/api/team/${encodeURIComponent(ctx.team.teamId)}/phase4`);
    const body = safeJson(res);
    const ok = check(res, {
      "phase4 200": (r) => r.status === 200 && body.ok === true && Boolean(phase4Ready)
    });
    recordMetric(ok, res);
  });

  sleep(600);
}

export function handleSummary(data) {
  const httpReq = metricValues(data, "http_req_duration");
  const vpReq = metricValues(data, "vp_coach_latency");
  const extractReq = metricValues(data, "extract_fields_latency");
  const totalReqs = metricValues(data, "http_reqs").count || 0;
  const success = metricValues(data, "success_rate").rate || 0;
  const timeouts = metricValues(data, "deepseek_timeouts").count || 0;
  const errors = metricValues(data, "api_errors").count || 0;
  const maxVus = metricValues(data, "vus_max").value || metricValues(data, "vus_max").max || 0;

  const summary = buildSummary(
    "Progressive Load Summary",
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
      { label: "API errors", value: errors },
      { label: "Peak active VUs", value: maxVus }
    ]
  );

  return {
    stdout: `${summary}\n`
  };
}
