import http from "k6/http";
import { sleep } from "k6";
import { Counter, Rate, Trend } from "k6/metrics";

const BASE_URL = String(__ENV.BASE_URL || "https://app.praxisengine.xyz").replace(/\/+$/, "");
const JSON_HEADERS = { "Content-Type": "application/json" };
const REQUEST_TIMEOUT = __ENV.REQUEST_TIMEOUT || "15s";
const ROUND2_SESSION_ID = String(__ENV.ROUND2_SESSION_ID || "default").trim() || "default";
const TEAM_SIZE = 1;

const appReqFailed = new Rate("app_req_failed");
const appFailures = new Counter("app_failures");

const status0 = new Counter("status_0");
const status200 = new Counter("status_200");
const status201 = new Counter("status_201");
const status204 = new Counter("status_204");
const status301 = new Counter("status_301");
const status302 = new Counter("status_302");
const status304 = new Counter("status_304");
const status307 = new Counter("status_307");
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

const routeHome = new Trend("route_home");
const routeTeamCreate = new Trend("route_team_create");
const routeTeamJoin = new Trend("route_team_join");
const routeTeamDetail = new Trend("route_team_detail");
const routeTeamStatus = new Trend("route_team_status");
const routeRound2State = new Trend("route_round2_state");
const routeRound2Page = new Trend("route_round2_page");

const vuState = {
  teamId: "",
  memberId: "",
  teamName: "",
  memberName: "",
  homeAssetsLoaded: false,
  round2AssetsLoaded: false
};

const ROUTE_METRICS = [
  { label: "GET /", metric: "route_home" },
  { label: "POST /api/team/create", metric: "route_team_create" },
  { label: "POST /api/team/:id/join", metric: "route_team_join" },
  { label: "GET /api/team/:id", metric: "route_team_detail" },
  { label: "GET /api/team/:id/status", metric: "route_team_status" },
  { label: "GET /api/round2/state", metric: "route_round2_state" },
  { label: "GET /multiplayer/round2", metric: "route_round2_page" }
];

export const options = {
  scenarios: {
    class_bell_spike: {
      executor: "ramping-vus",
      startVUs: 0,
      stages: [
        { duration: "5s", target: 100 },
        { duration: "30s", target: 100 },
        { duration: "5s", target: 0 }
      ],
      gracefulRampDown: "10s"
    }
  },
  thresholds: {
    http_req_duration: ["p(95)<2000", "p(99)<5000"],
    http_req_failed: ["rate<0.05"],
    app_req_failed: ["rate<0.05"]
  },
  summaryTrendStats: ["avg", "min", "med", "max", "p(50)", "p(95)", "p(99)"]
};

export function setup() {
  return {
    runId: String(__ENV.RUN_ID || new Date().toISOString().replace(/\D/g, "").slice(0, 14))
  };
}

export default function (setupData) {
  // Why spike instead of slow ramp:
  // The classroom risk is "bell rings, everyone logs in within a few seconds".
  // A 60s crawl to 100 VUs smooths away first-wave lock contention and memoization races.
  // The 5s -> 100 VU spike is intentionally abrupt so we can expose cold-cache concurrency issues.
  //
  // Safe non-LLM surface only:
  // - GET / and same-origin static assets referenced by the HTML
  // - POST /api/team/create
  // - POST /api/team/:id/join
  // - GET /api/team/:id
  // - GET /api/team/:id/status?lite=1
  // - GET /api/round2/state
  // - GET /multiplayer/round2 and same-origin static assets referenced by the HTML
  //
  // Intentionally skipped to avoid DeepSeek spend or ambiguous LLM behavior:
  // - /api/interview/*
  // - /api/vp-coach/*
  // - /api/persona-generate
  // - any path containing chat / llm / coach / interview
  // - /api/round2/interview/* and /api/marketing/* even though they are product flows

  hitHomePage();

  if (!vuState.memberId) {
    const joined = bootstrapStudent(setupData);
    if (!joined) {
      sleep(1);
      return;
    }
  }

  refreshTeamState();
  touchRound2();
  sleep(1);
}

function bootstrapStudent(setupData) {
  const runId = String(setupData?.runId || "adhoc").trim() || "adhoc";
  const vuLabel = `vu${__VU}`;
  const suffix = `${runId}_${vuLabel}`;

  const teamName = `loadtest_${suffix}`;
  const memberName = `loadtest_student_${suffix}`;
  const createRes = trackedPost(
    `${BASE_URL}/api/team/create`,
    { teamName, teamSize: TEAM_SIZE },
    routeTeamCreate
  );
  const createBody = safeJson(createRes);
  const teamId = String(createBody?.team?.id || "").trim();
  const createOk = markJsonResult(createRes, createBody, Boolean(teamId));
  if (!createOk) return false;

  // We immediately claim the single placeholder member slot so later state calls can use a real memberId.
  const joinRes = trackedPost(
    `${BASE_URL}/api/team/${encodeURIComponent(teamId)}/join`,
    { memberName },
    routeTeamJoin
  );
  const joinBody = safeJson(joinRes);
  const memberId = String(
    joinBody?.member?.id ||
    findMemberId(joinBody?.team?.members, memberName) ||
    ""
  ).trim();
  const joinOk = markJsonResult(joinRes, joinBody, Boolean(memberId));
  if (!joinOk) return false;

  vuState.teamId = teamId;
  vuState.memberId = memberId;
  vuState.teamName = teamName;
  vuState.memberName = memberName;
  return true;
}

function refreshTeamState() {
  const teamId = vuState.teamId;
  const memberId = vuState.memberId;
  if (!teamId) return;

  const teamRes = trackedGet(
    `${BASE_URL}/api/team/${encodeURIComponent(teamId)}`,
    routeTeamDetail
  );
  const teamBody = safeJson(teamRes);
  markJsonResult(teamRes, teamBody);

  const pollCount = 2 + ((__VU + __ITER) % 2);
  for (let i = 0; i < pollCount; i += 1) {
    const statusUrl =
      `${BASE_URL}/api/team/${encodeURIComponent(teamId)}/status` +
      `?memberId=${encodeURIComponent(memberId)}&lite=1`;
    const statusRes = trackedGet(statusUrl, routeTeamStatus);
    const statusBody = safeJson(statusRes);
    markJsonResult(statusRes, statusBody);
  }
}

function touchRound2() {
  const teamId = vuState.teamId;
  const memberId = vuState.memberId;
  if (!teamId) return;

  const stateUrl =
    `${BASE_URL}/api/round2/state` +
    `?teamId=${encodeURIComponent(teamId)}&memberId=${encodeURIComponent(memberId)}`;
  const stateRes = trackedGet(stateUrl, routeRound2State);
  const stateBody = safeJson(stateRes);
  markJsonResult(stateRes, stateBody);

  const pageUrl =
    `${BASE_URL}/multiplayer/round2` +
    `?teamId=${encodeURIComponent(teamId)}` +
    `&memberId=${encodeURIComponent(memberId)}` +
    `&session_id=${encodeURIComponent(ROUND2_SESSION_ID)}`;
  const pageRes = trackedGet(pageUrl, routeRound2Page);
  const pageOk = markHttpOnlyResult(pageRes);
  if (pageOk && !vuState.round2AssetsLoaded) {
    fetchStaticAssets(pageRes.body || "");
    vuState.round2AssetsLoaded = true;
  }
}

function hitHomePage() {
  const homeRes = trackedGet(`${BASE_URL}/`, routeHome);
  const homeOk = markHttpOnlyResult(homeRes);
  if (homeOk && !vuState.homeAssetsLoaded) {
    fetchStaticAssets(homeRes.body || "");
    vuState.homeAssetsLoaded = true;
  }
}

function trackedGet(url, trend) {
  const res = http.get(url, {
    redirects: 4,
    timeout: REQUEST_TIMEOUT
  });
  trackResponse(res, trend);
  return res;
}

function trackedPost(url, payload, trend) {
  const res = http.post(url, JSON.stringify(payload || {}), {
    headers: JSON_HEADERS,
    redirects: 2,
    timeout: REQUEST_TIMEOUT
  });
  trackResponse(res, trend);
  return res;
}

function trackResponse(res, trend) {
  if (trend && res?.timings) {
    trend.add(Number(res.timings.duration || 0));
  }
  addStatusCounter(Number(res?.status || 0));
}

function markJsonResult(res, body, extraOk = true) {
  const ok = isHttpSuccess(res) && body && body.ok === true && extraOk === true;
  appReqFailed.add(!ok);
  if (!ok) appFailures.add(1);
  return ok;
}

function markHttpOnlyResult(res) {
  const ok = isHttpSuccess(res);
  appReqFailed.add(!ok);
  if (!ok) appFailures.add(1);
  return ok;
}

function isHttpSuccess(res) {
  const status = Number(res?.status || 0);
  return status >= 200 && status < 400;
}

function safeJson(res) {
  try {
    return JSON.parse(String(res?.body || "{}"));
  } catch (_) {
    return {};
  }
}

function findMemberId(members, memberName) {
  const list = Array.isArray(members) ? members : [];
  const target = String(memberName || "").trim();
  const found = list.find((item) => String(item?.member_name || "").trim() === target);
  return found?.id || "";
}

function addStatusCounter(status) {
  switch (status) {
    case 0:
      status0.add(1);
      break;
    case 200:
      status200.add(1);
      break;
    case 201:
      status201.add(1);
      break;
    case 204:
      status204.add(1);
      break;
    case 301:
      status301.add(1);
      break;
    case 302:
      status302.add(1);
      break;
    case 304:
      status304.add(1);
      break;
    case 307:
      status307.add(1);
      break;
    case 400:
      status400.add(1);
      break;
    case 401:
      status401.add(1);
      break;
    case 403:
      status403.add(1);
      break;
    case 404:
      status404.add(1);
      break;
    case 409:
      status409.add(1);
      break;
    case 429:
      status429.add(1);
      break;
    case 500:
      status500.add(1);
      break;
    case 502:
      status502.add(1);
      break;
    case 503:
      status503.add(1);
      break;
    case 504:
      status504.add(1);
      break;
    default:
      statusOther.add(1);
      break;
  }
}

function fetchStaticAssets(html) {
  const assetPaths = extractStaticAssetPaths(html);
  if (!assetPaths.length) return;

  const requests = assetPaths.map((path) => ({
    method: "GET",
    url: `${BASE_URL}${path}`,
    params: {
      redirects: 2,
      timeout: REQUEST_TIMEOUT
    }
  }));
  const responses = http.batch(requests);
  responses.forEach((res) => {
    trackResponse(res, null);
    markHttpOnlyResult(res);
  });
}

function extractStaticAssetPaths(html) {
  const text = String(html || "");
  const out = [];
  const seen = new Set();
  const re = /(?:src|href)=["'](\/[^"'?#]+\.(?:js|mjs|css|ico|png|jpg|jpeg|svg|webp|woff2?|ttf))(?:\?[^"']*)?["']/gi;

  let match;
  while ((match = re.exec(text)) !== null) {
    const path = String(match[1] || "").trim();
    if (!path || seen.has(path) || isForbiddenPath(path)) continue;
    seen.add(path);
    out.push(path);
    if (out.length >= 12) break;
  }
  return out;
}

function isForbiddenPath(path) {
  const lowered = String(path || "").toLowerCase();
  return (
    lowered.includes("chat") ||
    lowered.includes("llm") ||
    lowered.includes("coach") ||
    lowered.includes("interview") ||
    lowered.includes("persona-generate")
  );
}

function metricValue(data, metricName, key) {
  return Number(data?.metrics?.[metricName]?.values?.[key] || 0);
}

function metricCount(data, metricName) {
  return Number(data?.metrics?.[metricName]?.values?.count || 0);
}

function formatPercent(rate) {
  return `${(Number(rate || 0) * 100).toFixed(2)}%`;
}

function formatMs(value) {
  return `${Math.round(Number(value || 0))}ms`;
}

export function handleSummary(data) {
  const totalRequests = metricCount(data, "http_reqs");
  const httpFailedRate = metricValue(data, "http_req_failed", "rate");
  const appFailedRate = metricValue(data, "app_req_failed", "rate");
  const httpSuccessRate = 1 - httpFailedRate;

  const statusLines = [
    ["0", metricCount(data, "status_0")],
    ["200", metricCount(data, "status_200")],
    ["201", metricCount(data, "status_201")],
    ["204", metricCount(data, "status_204")],
    ["301", metricCount(data, "status_301")],
    ["302", metricCount(data, "status_302")],
    ["304", metricCount(data, "status_304")],
    ["307", metricCount(data, "status_307")],
    ["400", metricCount(data, "status_400")],
    ["401", metricCount(data, "status_401")],
    ["403", metricCount(data, "status_403")],
    ["404", metricCount(data, "status_404")],
    ["409", metricCount(data, "status_409")],
    ["429", metricCount(data, "status_429")],
    ["500", metricCount(data, "status_500")],
    ["502", metricCount(data, "status_502")],
    ["503", metricCount(data, "status_503")],
    ["504", metricCount(data, "status_504")],
    ["other", metricCount(data, "status_other")]
  ].filter(([, count]) => count > 0);

  const slowRoutes = ROUTE_METRICS
    .map((route) => ({
      label: route.label,
      avg: metricValue(data, route.metric, "avg"),
      p50: metricValue(data, route.metric, "p(50)"),
      p95: metricValue(data, route.metric, "p(95)"),
      p99: metricValue(data, route.metric, "p(99)"),
      max: metricValue(data, route.metric, "max")
    }))
    .filter((route) => route.max > 0)
    .sort((a, b) => b.p95 - a.p95)
    .slice(0, 5);

  const lines = [];
  lines.push("=== k6 Spike Summary ===");
  lines.push(`BASE_URL: ${BASE_URL}`);
  lines.push(`Total requests: ${totalRequests}`);
  lines.push(`HTTP success rate: ${formatPercent(httpSuccessRate)}`);
  lines.push(`HTTP error rate: ${formatPercent(httpFailedRate)}`);
  lines.push(`App-level error rate: ${formatPercent(appFailedRate)}`);
  lines.push(`App failures: ${metricCount(data, "app_failures")}`);
  lines.push(`http_req_duration p50: ${formatMs(metricValue(data, "http_req_duration", "p(50)"))}`);
  lines.push(`http_req_duration p95: ${formatMs(metricValue(data, "http_req_duration", "p(95)"))}`);
  lines.push(`http_req_duration p99: ${formatMs(metricValue(data, "http_req_duration", "p(99)"))}`);
  lines.push("");
  lines.push("Error distribution by status code:");
  if (statusLines.length === 0) {
    lines.push("- none");
  } else {
    statusLines.forEach(([status, count]) => {
      lines.push(`- ${status}: ${count}`);
    });
  }
  lines.push("");
  lines.push("Slowest 5 routes by p95:");
  if (!slowRoutes.length) {
    lines.push("- none");
  } else {
    slowRoutes.forEach((route) => {
      lines.push(
        `- ${route.label}: avg=${formatMs(route.avg)}, p50=${formatMs(route.p50)}, p95=${formatMs(route.p95)}, p99=${formatMs(route.p99)}, max=${formatMs(route.max)}`
      );
    });
  }

  return {
    stdout: `${lines.join("\n")}\n`
  };
}
