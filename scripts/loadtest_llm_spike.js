import http from "k6/http";
import { sleep } from "k6";
import { Counter, Rate, Trend } from "k6/metrics";

const BASE_URL = String(__ENV.BASE_URL || "https://app.praxisengine.xyz").replace(/\/+$/, "");
const JSON_HEADERS = { "Content-Type": "application/json" };
const REQUEST_TIMEOUT = __ENV.REQUEST_TIMEOUT || "25s";
const MOCK_LATENCY_MS_MEAN = Number(__ENV.MOCK_LATENCY_MS_MEAN || 1500);
const MAX_INTERVIEWS_PER_TEAM = 3;
const INTERVIEW_MESSAGES = [
  "你最近在这个场景里最难受的一次，具体发生在什么时候？",
  "当时最让你别扭的不是哪件事本身，而是什么感受？",
  "如果家里真的有个会回应你的设备，你最希望它先接住哪一刻？",
  "你会担心这类设备把什么事情做砸，或者让你更烦吗？",
  "要是它真的能帮上忙，你会怎么判断它值得留下来？"
];

const ROUND1_DECISIONS = [
  {
    gridId: "ToC_Differentiation_Adult",
    architecture: "Experience",
    who: "独居城市白领，回家第一刻最容易感到空落",
    pain: "忙完一天回到家时缺少回应，孤独感会被瞬间放大",
    how: "让 LOVOT 在回家时主动迎接、互动和陪伴，帮用户把情绪接住"
  },
  {
    gridId: "ToB_Differentiation_Elder",
    architecture: "Hybrid",
    who: "养老机构夜班运营负责人",
    pain: "夜班照护人手总不够，老人情绪安抚和安全巡检经常撞车",
    how: "让 LOVOT 在夜班场景里补足陪伴反馈和异常提醒，减轻夜班压力"
  },
  {
    gridId: "ToC_Differentiation_Child",
    architecture: "Experience",
    who: "双职工家庭里经常独处的学龄儿童家长",
    pain: "家长担心孩子放学后无聊又没人及时回应",
    how: "让 LOVOT 在放学后的家庭场景里承担陪伴互动和轻提醒"
  },
  {
    gridId: "ToB_Differentiation_Adult",
    architecture: "Function",
    who: "高峰时段接待压力大的连锁酒店前台负责人",
    pain: "排队住客情绪越来越躁，前台需要一边处理异常一边安抚体验",
    how: "让 LOVOT 在等待区先接住住客情绪，给前台腾出处理异常的注意力"
  }
];

const appReqFailed = new Rate("app_req_failed");
const appFailures = new Counter("app_failures");
const llmQueueWaitMs = new Trend("llm_queue_wait_ms");
const llmPathLatency = new Trend("llm_path_latency");
const routeBootstrapCreate = new Trend("route_bootstrap_create");
const routeBootstrapJoin = new Trend("route_bootstrap_join");
const routeBootstrapPhase1 = new Trend("route_bootstrap_phase1");
const routeBootstrapCoach = new Trend("route_bootstrap_phase3_chat");
const routeBootstrapSynthesize = new Trend("route_bootstrap_phase3_synthesize");
const routeBootstrapFinalize = new Trend("route_bootstrap_phase3_finalize");
const routeBootstrapFreeze = new Trend("route_bootstrap_freeze");
const routeInterviewStart = new Trend("route_interview_start");
const routeInterviewReply = new Trend("route_interview_reply");
const routeInterviewEnd = new Trend("route_interview_end");
const routeInterviewRescore = new Trend("route_interview_rescore");

const status0 = new Counter("status_0");
const status200 = new Counter("status_200");
const status201 = new Counter("status_201");
const status204 = new Counter("status_204");
const status400 = new Counter("status_400");
const status401 = new Counter("status_401");
const status403 = new Counter("status_403");
const status404 = new Counter("status_404");
const status409 = new Counter("status_409");
const status429 = new Counter("status_429");
const status500 = new Counter("status_500");
const status502 = new Counter("status_502");
const status503 = new Counter("status_503");
const status504 = new Counter("status_504");
const statusOther = new Counter("status_other");

const ROUTE_METRICS = [
  { label: "POST /api/team/create", metric: "route_bootstrap_create" },
  { label: "POST /api/team/:id/join", metric: "route_bootstrap_join" },
  { label: "POST /api/team/:id/phase1/:memberId/submit", metric: "route_bootstrap_phase1" },
  { label: "POST /api/team/:id/phase3/chat", metric: "route_bootstrap_phase3_chat" },
  { label: "POST /api/team/:id/phase3/synthesize-vp", metric: "route_bootstrap_phase3_synthesize" },
  { label: "POST /api/team/:id/phase3/finalize", metric: "route_bootstrap_phase3_finalize" },
  { label: "POST /api/team/:id/freeze", metric: "route_bootstrap_freeze" },
  { label: "POST /api/round2/interview/start", metric: "route_interview_start" },
  { label: "POST /api/round2/interview/reply", metric: "route_interview_reply" },
  { label: "POST /api/round2/interview/end", metric: "route_interview_end" },
  { label: "POST /api/round2/interview/rescore", metric: "route_interview_rescore" }
];

const vuState = {
  teamId: "",
  memberId: "",
  teamName: "",
  memberName: "",
  leaderId: "",
  interviewsOnTeam: 0,
  bootstrapped: false,
  decision: null
};

export const options = {
  scenarios: {
    llm_class_bell_spike: {
      executor: "ramping-vus",
      startVUs: 0,
      stages: [
        { duration: "5s", target: 100 },
        { duration: "60s", target: 100 },
        { duration: "5s", target: 0 }
      ],
      gracefulRampDown: "15s"
    }
  },
  thresholds: {
    http_req_duration: ["p(95)<8000", "p(99)<15000"],
    http_req_failed: ["rate<0.05"],
    app_req_failed: ["rate<0.05"]
  },
  summaryTrendStats: ["avg", "med", "p(50)", "p(95)", "p(99)", "max"]
};

export function setup() {
  return {
    runId: String(__ENV.RUN_ID || new Date().toISOString().replace(/\D/g, "").slice(0, 14))
  };
}

export default function (setupData) {
  if (!vuState.bootstrapped || vuState.interviewsOnTeam >= MAX_INTERVIEWS_PER_TEAM) {
    resetVuTeamState();
    const ok = bootstrapVu(setupData);
    if (!ok) {
      sleep(1);
      return;
    }
  }

  const started = startInterviewCycle();
  if (!started.sessionId) {
    resetVuTeamState();
    sleep(1);
    return;
  }

  const completed = runInterviewConversation(started.sessionId);
  if (completed) {
    vuState.interviewsOnTeam += 1;
  }
  sleep(2);
}

function resetVuTeamState() {
  vuState.teamId = "";
  vuState.memberId = "";
  vuState.teamName = "";
  vuState.memberName = "";
  vuState.leaderId = "";
  vuState.interviewsOnTeam = 0;
  vuState.bootstrapped = false;
  vuState.decision = null;
}

function bootstrapVu(setupData) {
  const runId = String(setupData?.runId || "adhoc").trim() || "adhoc";
  const suffix = `${runId}_vu${__VU}_iter${__ITER}`;
  const decision = ROUND1_DECISIONS[(__VU + __ITER) % ROUND1_DECISIONS.length];
  const teamName = `loadtest_llm_${suffix}`;
  const memberName = `loadtest_llm_member_${suffix}`;

  const createRes = trackedPost(
    `${BASE_URL}/api/team/create`,
    { teamName, teamSize: 1 },
    routeBootstrapCreate,
    false
  );
  const createBody = safeJson(createRes);
  const teamId = String(createBody?.team?.id || "").trim();
  if (!markJsonResult(createRes, createBody, Boolean(teamId))) return false;

  const joinRes = trackedPost(
    `${BASE_URL}/api/team/${encodeURIComponent(teamId)}/join`,
    { memberName },
    routeBootstrapJoin,
    false
  );
  const joinBody = safeJson(joinRes);
  const memberId = String(
    joinBody?.member?.id ||
    joinBody?.team?.members?.[0]?.id ||
    ""
  ).trim();
  if (!markJsonResult(joinRes, joinBody, Boolean(memberId))) return false;

  const phase1Res = trackedPost(
    `${BASE_URL}/api/team/${encodeURIComponent(teamId)}/phase1/${encodeURIComponent(memberId)}/submit`,
    {
      grid_id: decision.gridId,
      architecture: decision.architecture,
      who: decision.who,
      pain: decision.pain,
      how: decision.how
    },
    routeBootstrapPhase1,
    false
  );
  const phase1Body = safeJson(phase1Res);
  if (!markJsonResult(phase1Res, phase1Body)) return false;

  const phase2Ready = waitForTeamStatus(teamId, memberId, "phase2", 8, 0.25);
  if (!phase2Ready) {
    appReqFailed.add(true);
    appFailures.add(1);
    return false;
  }

  const coachSeedRes = trackedPost(
    `${BASE_URL}/api/team/${encodeURIComponent(teamId)}/phase3/chat`,
    {
      memberId,
      grid_id: decision.gridId,
      architecture: decision.architecture,
      message: `WHO：${decision.who}\nPAIN：${decision.pain}\nHOW：${decision.how}`
    },
    routeBootstrapCoach,
    false
  );
  const coachSeedBody = safeJson(coachSeedRes);
  if (!markJsonResult(coachSeedRes, coachSeedBody)) return false;

  sleep(0.1);

  const coachRes = trackedPost(
    `${BASE_URL}/api/team/${encodeURIComponent(teamId)}/phase3/chat`,
    {
      memberId,
      grid_id: decision.gridId,
      architecture: decision.architecture,
      message: "现在请帮我们把最痛的场景压缩成一句更清楚的话。"
    },
    routeBootstrapCoach,
    true
  );
  const coachBody = safeJson(coachRes);
  if (!markJsonResult(coachRes, coachBody)) return false;

  const synthRes = trackedPost(
    `${BASE_URL}/api/team/${encodeURIComponent(teamId)}/phase3/synthesize-vp`,
    {
      memberId,
      grid_id: decision.gridId,
      architecture: decision.architecture
    },
    routeBootstrapSynthesize,
    true
  );
  const synthBody = safeJson(synthRes);
  const vpText = String(synthBody?.vp_text || "").trim() || [
    `WHO：${decision.who}`,
    `PAIN：${decision.pain}`,
    `HOW：${decision.how}`
  ].join("\n");
  if (!markJsonResult(synthRes, synthBody)) return false;

  const finalizeRes = trackedPost(
    `${BASE_URL}/api/team/${encodeURIComponent(teamId)}/phase3/finalize`,
    {
      memberId,
      grid_id: decision.gridId,
      architecture: decision.architecture,
      vp_text: vpText
    },
    routeBootstrapFinalize,
    true
  );
  const finalizeBody = safeJson(finalizeRes);
  if (!markJsonResult(finalizeRes, finalizeBody)) return false;

  const freezeRes = trackedPost(
    `${BASE_URL}/api/team/${encodeURIComponent(teamId)}/freeze`,
    { memberId },
    routeBootstrapFreeze,
    false
  );
  const freezeBody = safeJson(freezeRes);
  if (!markJsonResult(freezeRes, freezeBody)) return false;

  vuState.teamId = teamId;
  vuState.memberId = memberId;
  vuState.teamName = teamName;
  vuState.memberName = memberName;
  vuState.leaderId = memberId;
  vuState.interviewsOnTeam = 0;
  vuState.bootstrapped = true;
  vuState.decision = decision;
  return true;
}

function startInterviewCycle() {
  const res = trackedPost(
    `${BASE_URL}/api/round2/interview/start`,
    {
      teamId: vuState.teamId,
      memberId: vuState.memberId
    },
    routeInterviewStart,
    true
  );
  const body = safeJson(res);
  const sessionId = String(body?.sessionId || "").trim();
  markJsonResult(res, body, body?.ok === true && (Boolean(sessionId) || body?.progress?.completedCount >= MAX_INTERVIEWS_PER_TEAM));
  return { res, body, sessionId };
}

function runInterviewConversation(sessionId) {
  let needsRescore = false;

  for (let i = 0; i < INTERVIEW_MESSAGES.length; i += 1) {
    const res = trackedPost(
      `${BASE_URL}/api/round2/interview/reply`,
      {
        sessionId,
        message: INTERVIEW_MESSAGES[i]
      },
      routeInterviewReply,
      true
    );
    const body = safeJson(res);
    const ok = body?.ok === true || body?.needsRescore === true;
    markJsonResult(res, body, ok);
    if (!ok) return false;
    if (body?.needsRescore === true || body?.scoringError) {
      needsRescore = true;
    }
    sleep(1);
  }

  const endRes = trackedPost(
    `${BASE_URL}/api/round2/interview/end`,
    { sessionId },
    routeInterviewEnd,
    true
  );
  const endBody = safeJson(endRes);
  const endOk = endBody?.ok === true && endBody?.isComplete === true;
  markJsonResult(endRes, endBody, endOk || endBody?.retry === true);
  if (endOk) return true;

  if (needsRescore || endBody?.retry === true || endBody?.scoringError) {
    const rescoreRes = trackedPost(
      `${BASE_URL}/api/round2/interview/rescore`,
      { sessionId },
      routeInterviewRescore,
      true
    );
    const rescoreBody = safeJson(rescoreRes);
    const rescoreOk = rescoreBody?.ok === true && rescoreBody?.isComplete === true;
    markJsonResult(rescoreRes, rescoreBody, rescoreOk);
    return rescoreOk;
  }

  return false;
}

function waitForTeamStatus(teamId, memberId, expected, attempts, sleepSeconds) {
  for (let i = 0; i < attempts; i += 1) {
    const res = trackedGet(
      `${BASE_URL}/api/team/${encodeURIComponent(teamId)}/status?memberId=${encodeURIComponent(memberId)}`,
      null,
      false
    );
    const body = safeJson(res);
    if (body?.ok === true && body?.status === expected) return body;
    sleep(sleepSeconds);
  }
  appReqFailed.add(true);
  appFailures.add(1);
  return null;
}

function trackedGet(url, trend, isLlmPath) {
  const res = http.get(url, {
    redirects: 2,
    timeout: REQUEST_TIMEOUT
  });
  trackResponse(res, trend, isLlmPath);
  return res;
}

function trackedPost(url, payload, trend, isLlmPath) {
  const res = http.post(url, JSON.stringify(payload || {}), {
    headers: JSON_HEADERS,
    redirects: 2,
    timeout: REQUEST_TIMEOUT
  });
  trackResponse(res, trend, isLlmPath);
  return res;
}

function trackResponse(res, trend, isLlmPath) {
  if (trend && res?.timings) {
    trend.add(Number(res.timings.duration || 0));
  }
  if (isLlmPath && res?.timings) {
    const duration = Number(res.timings.duration || 0);
    llmPathLatency.add(duration);
    llmQueueWaitMs.add(Math.max(0, duration - MOCK_LATENCY_MS_MEAN));
  }
  addStatusCounter(Number(res?.status || 0));
}

function markJsonResult(res, body, extraOk = true) {
  const ok = isHttpSuccess(res) && body && body.ok === true && extraOk === true;
  appReqFailed.add(!ok);
  if (!ok) appFailures.add(1);
  return ok;
}

function isHttpSuccess(res) {
  const status = Number(res?.status || 0);
  return status >= 200 && status < 300;
}

function safeJson(res) {
  try {
    return JSON.parse(res?.body || "{}");
  } catch (_) {
    return {};
  }
}

function addStatusCounter(status) {
  if (status === 0) return status0.add(1);
  if (status === 200) return status200.add(1);
  if (status === 201) return status201.add(1);
  if (status === 204) return status204.add(1);
  if (status === 400) return status400.add(1);
  if (status === 401) return status401.add(1);
  if (status === 403) return status403.add(1);
  if (status === 404) return status404.add(1);
  if (status === 409) return status409.add(1);
  if (status === 429) return status429.add(1);
  if (status === 500) return status500.add(1);
  if (status === 502) return status502.add(1);
  if (status === 503) return status503.add(1);
  if (status === 504) return status504.add(1);
  return statusOther.add(1);
}

function metricValues(data, name) {
  return data.metrics[name]?.values || {};
}

function counterCount(data, name) {
  return data.metrics[name]?.values?.count || 0;
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
  return `${(Number(rate || 0) * 100).toFixed(2)}%`;
}

function buildMetricRows(data) {
  return ROUTE_METRICS.map((item) => {
    const values = metricValues(data, item.metric);
    return {
      label: item.label,
      avg: values.avg || 0,
      p50: values["p(50)"] || values.med || 0,
      p95: values["p(95)"] || 0,
      p99: values["p(99)"] || 0,
      max: values.max || 0
    };
  }).filter((row) => row.max > 0);
}

export function handleSummary(data) {
  const httpReq = metricValues(data, "http_req_duration");
  const llmReq = metricValues(data, "llm_path_latency");
  const queueReq = metricValues(data, "llm_queue_wait_ms");
  const failedRate = metricValues(data, "app_req_failed").rate || 0;
  const totalFailures = counterCount(data, "app_failures");
  const totalRequests = metricValues(data, "http_reqs").count || 0;
  const routeRows = buildMetricRows(data);
  const slowest = routeRows.slice().sort((a, b) => b.p95 - a.p95).slice(0, 5);

  const statusRows = [
    ["200", counterCount(data, "status_200")],
    ["201", counterCount(data, "status_201")],
    ["204", counterCount(data, "status_204")],
    ["400", counterCount(data, "status_400")],
    ["401", counterCount(data, "status_401")],
    ["403", counterCount(data, "status_403")],
    ["404", counterCount(data, "status_404")],
    ["409", counterCount(data, "status_409")],
    ["429", counterCount(data, "status_429")],
    ["500", counterCount(data, "status_500")],
    ["502", counterCount(data, "status_502")],
    ["503", counterCount(data, "status_503")],
    ["504", counterCount(data, "status_504")],
    ["0", counterCount(data, "status_0")],
    ["other", counterCount(data, "status_other")]
  ].filter(([, count]) => count > 0);

  const lines = [];
  lines.push("LLM Spike Summary");
  lines.push("+---------------------------+----------+----------+----------+");
  lines.push("| Metric                    | P50      | P95      | P99      |");
  lines.push("+---------------------------+----------+----------+----------+");
  lines.push(`| ${pad("HTTP req duration", 25)} | ${pad(formatDuration(httpReq["p(50)"] || httpReq.med), 8, true)} | ${pad(formatDuration(httpReq["p(95)"]), 8, true)} | ${pad(formatDuration(httpReq["p(99)"]), 8, true)} |`);
  lines.push(`| ${pad("LLM path duration", 25)} | ${pad(formatDuration(llmReq["p(50)"] || llmReq.med), 8, true)} | ${pad(formatDuration(llmReq["p(95)"]), 8, true)} | ${pad(formatDuration(llmReq["p(99)"]), 8, true)} |`);
  lines.push(`| ${pad("Queue wait proxy", 25)} | ${pad(formatDuration(queueReq["p(50)"] || queueReq.med), 8, true)} | ${pad(formatDuration(queueReq["p(95)"]), 8, true)} | ${pad(formatDuration(queueReq["p(99)"]), 8, true)} |`);
  lines.push("+---------------------------+----------+----------+----------+");
  lines.push(`Requests=${totalRequests}  ErrorRate=${formatRate(failedRate)}  AppFailures=${totalFailures}`);
  lines.push("");

  lines.push("Status Codes");
  statusRows.forEach(([status, count]) => {
    lines.push(`- ${status}: ${count}`);
  });
  lines.push("");

  lines.push("Slowest Routes Top 5 (by p95)");
  slowest.forEach((row) => {
    lines.push(`- ${row.label} | p50=${formatDuration(row.p50)} p95=${formatDuration(row.p95)} p99=${formatDuration(row.p99)}`);
  });

  return {
    stdout: `${lines.join("\n")}\n`
  };
}
