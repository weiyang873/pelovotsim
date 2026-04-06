"use strict";

const fs = require("node:fs");
const path = require("node:path");

function loadLocalEnvFile() {
  const envPath = path.join(__dirname, "..", ".env");
  if (!fs.existsSync(envPath)) return;
  const content = fs.readFileSync(envPath, "utf8");
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith("\"") && value.endsWith("\"")) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!Object.prototype.hasOwnProperty.call(process.env, key)) {
      process.env[key] = value;
    }
  }
}

loadLocalEnvFile();

const BASE_URL = process.env.BASE_URL || process.env.TEST_URL || "http://127.0.0.1:8787";
const TRANSPORT_MODE = String(process.env.ROUND2_TEST_TRANSPORT || "direct").trim().toLowerCase();
const ARCHITECTURE = process.env.ROUND2_TEST_ARCH || "Experience";
const HTTP_TIMEOUT_MS = Number(process.env.ROUND2_TEST_TIMEOUT_MS || 60000);
const SKIP_LLM_IN_DIRECT = String(process.env.ROUND2_TEST_SKIP_LLM || "1").trim() !== "0";
const LOW_QUALITY_INTERVIEW = ["嗯", "懂情绪吗", "能开灯吗", "起身麻烦", "还行吧"];
const ALL_GRID_IDS = [
  "ToB_Differentiation_Elder",
  "ToB_Differentiation_Adult",
  "ToB_Differentiation_Child",
  "ToB_Cost_Elder",
  "ToB_Cost_Adult",
  "ToB_Cost_Child",
  "ToC_Differentiation_Elder",
  "ToC_Differentiation_Adult",
  "ToC_Differentiation_Child",
  "ToC_Cost_Elder",
  "ToC_Cost_Adult",
  "ToC_Cost_Child"
];
const GRID_IDS = (() => {
  const raw = String(process.env.ROUND2_TEST_GRIDS || "").trim();
  if (raw) {
    return raw.split(",").map((item) => item.trim()).filter(Boolean);
  }
  const limit = Number(process.env.ROUND2_TEST_LIMIT || 0);
  if (Number.isFinite(limit) && limit > 0) {
    return ALL_GRID_IDS.slice(0, limit);
  }
  return ALL_GRID_IDS;
})();
const DEFAULT_SELECTIONS = [
  { cap_id: "persona_dialog", tier: "low" },
  { cap_id: "perception_base", tier: "low" },
  { cap_id: "basic_avoidance", tier: "low" },
  { cap_id: "privacy_trust", tier: "low" },
  { cap_id: "api_iot", tier: "low" },
  { cap_id: "cloud_update", tier: "low" }
];

function scriptLog(message) {
  process.stdout.write(`${message}\n`);
}

function scriptError(message) {
  process.stderr.write(`${message}\n`);
}

function inferAgeGroup(gridId) {
  const raw = String(gridId || "").toLowerCase();
  if (raw.includes("elder")) return "elder";
  if (raw.includes("child")) return "child";
  return "adult";
}

function hasIncompatibleTag(gridId, tags) {
  const age = inferAgeGroup(gridId);
  const values = (Array.isArray(tags) ? tags : []).map((item) => String(item?.tag || item || ""));
  if (age === "elder") {
    return values.some((tag) => /儿童|幼儿|早教|亲子/.test(tag));
  }
  if (age === "child") {
    return values.some((tag) => /养老|退休|失智|老人监护|长者/.test(tag));
  }
  return false;
}

function toFinite(value, fallback = null) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function pad(value, width) {
  const text = String(value == null ? "" : value);
  return text.length >= width ? text : `${text}${" ".repeat(width - text.length)}`;
}

function unwrapBody(response, label) {
  if (!response || typeof response !== "object") {
    throw new Error(`${label} returned empty response`);
  }
  const status = Number(response.status || 0);
  const body = response.body && typeof response.body === "object" ? response.body : response;
  if (status && status >= 400) {
    throw new Error(`${label} failed: HTTP ${status} ${body.error || ""}`.trim());
  }
  if (body.ok === false) {
    throw new Error(`${label} failed: ${body.error || "ok=false"}`);
  }
  return body;
}

async function runQuietly(enabled, fn) {
  if (!enabled) return fn();
  const originalLog = console.log;
  const originalWarn = console.warn;
  console.log = () => {};
  console.warn = () => {};
  try {
    return await fn();
  } finally {
    console.log = originalLog;
    console.warn = originalWarn;
  }
}

async function fetchJson(method, pathname, body) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), HTTP_TIMEOUT_MS);
  try {
    const response = await fetch(`${BASE_URL}${pathname}`, {
      method,
      headers: body == null ? {} : { "Content-Type": "application/json" },
      body: body == null ? undefined : JSON.stringify(body),
      signal: controller.signal
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data?.ok === false) {
      throw new Error(`${method} ${pathname} failed: ${response.status} ${JSON.stringify(data)}`);
    }
    return data;
  } finally {
    clearTimeout(timer);
  }
}

async function detectHttpAvailability() {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 1200);
    try {
      const response = await fetch(`${BASE_URL}/api/health`, { signal: controller.signal });
      return response.ok;
    } finally {
      clearTimeout(timer);
    }
  } catch (_) {
    return false;
  }
}

async function createDirectTransport() {
  if (SKIP_LLM_IN_DIRECT) {
    delete process.env.DEEPSEEK_API_KEY;
  }

  const TeamRoutes = require("../server/routes/teamRoutes");
  const Round2 = require("../server/routes/round2Routes");
  const { shutdown } = require("../server/db/pgSql");

  return {
    mode: "direct",
    close: shutdown,
    async get(pathname) {
      return runQuietly(true, async () => {
        const url = new URL(pathname, "http://local.test");
        if (url.pathname === "/api/health") {
          return { ok: true };
        }
        if (url.pathname === "/api/round2/recap") {
          return unwrapBody(await Round2.recap({
            teamId: url.searchParams.get("teamId") || url.searchParams.get("team_id") || ""
          }), pathname);
        }
        if (url.pathname === "/api/round2/state") {
          return unwrapBody(await Round2.teamStatusApi({
            teamId: url.searchParams.get("teamId") || url.searchParams.get("team_id") || "",
            memberId: url.searchParams.get("memberId") || url.searchParams.get("member_id") || ""
          }), pathname);
        }
        if (url.pathname === "/api/round2/team-result") {
          return unwrapBody(await Round2.teamResultApi({
            teamId: url.searchParams.get("teamId") || url.searchParams.get("team_id") || "",
            sessionId: url.searchParams.get("sessionId") || url.searchParams.get("session_id") || ""
          }), pathname);
        }
        throw new Error(`unsupported GET route in direct mode: ${pathname}`);
      });
    },
    async post(pathname, body) {
      return runQuietly(true, async () => {
        if (pathname === "/api/team/create") {
          return unwrapBody(await TeamRoutes.createTeamApi(body), pathname);
        }

        const phase1Match = pathname.match(/^\/api\/team\/([^/]+)\/phase1\/([^/]+)\/submit$/);
        if (phase1Match) {
          return unwrapBody(await TeamRoutes.submitPhase1(
            decodeURIComponent(phase1Match[1]),
            decodeURIComponent(phase1Match[2]),
            body
          ), pathname);
        }

        const finalizeMatch = pathname.match(/^\/api\/team\/([^/]+)\/phase3\/finalize$/);
        if (finalizeMatch) {
          return unwrapBody(await TeamRoutes.finalizePhase3(
            decodeURIComponent(finalizeMatch[1]),
            body
          ), pathname);
        }

        const freezeMatch = pathname.match(/^\/api\/team\/([^/]+)\/freeze$/);
        if (freezeMatch) {
          return unwrapBody(await TeamRoutes.freezeTeam(
            decodeURIComponent(freezeMatch[1]),
            body
          ), pathname);
        }

        if (pathname === "/api/round2/interview/start") {
          return unwrapBody(await Round2.interviewStart(body), pathname);
        }
        if (pathname === "/api/round2/interview/reply") {
          return unwrapBody(await Round2.interviewReply(body), pathname);
        }
        if (pathname === "/api/round2/interview/end") {
          return unwrapBody(await Round2.interviewEnd(body), pathname);
        }
        if (pathname === "/api/round2/member-selection") {
          return unwrapBody(await Round2.saveMemberSelectionApi(body), pathname);
        }
        if (pathname === "/api/round2/merge") {
          return unwrapBody(await Round2.mergeApi(body), pathname);
        }
        if (pathname === "/api/round2/team-submit") {
          return unwrapBody(await Round2.teamSubmitApi(body), pathname);
        }
        throw new Error(`unsupported POST route in direct mode: ${pathname}`);
      });
    }
  };
}

async function createTransport() {
  if (TRANSPORT_MODE === "http") {
    return {
      mode: "http",
      close: async () => {},
      get: (pathname) => fetchJson("GET", pathname),
      post: (pathname, body) => fetchJson("POST", pathname, body)
    };
  }

  if (TRANSPORT_MODE === "direct") {
    return createDirectTransport();
  }

  if (await detectHttpAvailability()) {
    return {
      mode: "http",
      close: async () => {},
      get: (pathname) => fetchJson("GET", pathname),
      post: (pathname, body) => fetchJson("POST", pathname, body)
    };
  }

  return createDirectTransport();
}

async function seedRound1(transport, gridId, architecture) {
  const created = await transport.post("/api/team/create", {
    teamName: `tag-quality-${gridId}-${Date.now()}`,
    teamSize: 1
  });
  const teamId = String(created?.team?.id || "").trim();
  const memberId = String(created?.member_links?.[0]?.member_id || created?.team?.members?.[0]?.id || "").trim();
  if (!teamId || !memberId) {
    throw new Error(`team bootstrap failed for ${gridId}`);
  }

  await transport.post(`/api/team/${encodeURIComponent(teamId)}/phase1/${encodeURIComponent(memberId)}/submit`, {
    grid_id: gridId,
    architecture,
    who: "测试客户",
    pain: "低质量访谈时仍要稳定完成标签回填与 Round 2 计算",
    how: "先用基础功能组合验证链路完整性"
  });

  await transport.post(`/api/team/${encodeURIComponent(teamId)}/phase3/finalize`, {
    memberId,
    grid_id: gridId,
    architecture,
    vp_text: [
      "WHO：测试客户",
      "PAIN：低质量访谈时仍要稳定完成标签回填与 Round 2 计算",
      "HOW：先用基础功能组合验证链路完整性",
      "BOUNDARY：不追求复杂功能"
    ].join("\n"),
    vp_result: {
      who: "测试客户",
      pain: "低质量访谈时仍要稳定完成标签回填与 Round 2 计算",
      how: "先用基础功能组合验证链路完整性",
      boundary: "不追求复杂功能"
    },
    scores: {
      coverage: 3.5,
      generalizability: 3.5,
      effectiveness: 3.5
    }
  });

  await transport.post(`/api/team/${encodeURIComponent(teamId)}/freeze`, {
    memberId
  });

  return { teamId, memberId };
}

async function runInterview(transport, teamId, memberId) {
  const started = await transport.post("/api/round2/interview/start", { teamId, memberId });
  const sessionId = String(started.sessionId || "").trim();
  if (!sessionId) {
    throw new Error(`missing interview session for ${teamId}`);
  }

  for (const message of LOW_QUALITY_INTERVIEW) {
    await transport.post("/api/round2/interview/reply", { sessionId, message });
  }

  return transport.post("/api/round2/interview/end", { sessionId });
}

function pickPrice(recap) {
  const pmax = Number(recap?.Pmax || 0);
  const wtp = Number(recap?.WTP || 0);
  const candidates = [
    pmax > 0 ? Math.round(pmax * 0.65) : 0,
    wtp > 0 ? Math.round(wtp * 0.6) : 0,
    8999
  ].filter((value) => Number.isFinite(value) && value > 0);
  const price = Math.min(...candidates);
  return Math.max(2999, price || 8999);
}

function extractCalcPayload(teamResult) {
  const snapshot = teamResult?.result || {};
  return {
    top: snapshot,
    calc: snapshot?.result || {}
  };
}

async function runRound2Calculation(transport, teamId, memberId) {
  const state = await transport.get(
    `/api/round2/state?teamId=${encodeURIComponent(teamId)}&memberId=${encodeURIComponent(memberId)}`
  );
  const recap = await transport.get(`/api/round2/recap?teamId=${encodeURIComponent(teamId)}`);
  const interviewEnd = await runInterview(transport, teamId, memberId);

  await transport.post("/api/round2/member-selection", {
    teamId,
    memberId,
    selections: DEFAULT_SELECTIONS
  });
  const merged = await transport.post("/api/round2/merge", { teamId, memberId });
  await transport.post("/api/round2/team-submit", {
    teamId,
    memberId,
    price: pickPrice(recap),
    selections: DEFAULT_SELECTIONS,
    mergedInterview: {
      radar: merged?.mergedInterview?.radar || {},
      tags: merged?.mergedInterview?.tags || [],
      evi: merged?.mergedInterview?.evi || 0.7
    },
    bestGrid: recap.final_grid_id
  });
  const teamResult = await transport.get(
    `/api/round2/team-result?teamId=${encodeURIComponent(teamId)}&sessionId=default`
  );

  return {
    state,
    recap,
    interviewEnd,
    merged,
    teamResult
  };
}

function summarizeRow(gridId, payload, transportMode) {
  const tags = Array.isArray(payload?.interviewEnd?.tags) ? payload.interviewEnd.tags : [];
  const priorFillCount = tags.filter((item) => item?.source === "grid_prior").length;
  const incompatible = hasIncompatibleTag(gridId, tags);
  const calcPayload = extractCalcPayload(payload?.teamResult);
  const coverCore = toFinite(calcPayload.calc.coverCore, 0);
  const vscore = toFinite(calcPayload.top.vscore, toFinite(calcPayload.calc.Vscore, toFinite(calcPayload.calc.V, 0)));
  const profit = toFinite(calcPayload.top.profit, toFinite(calcPayload.calc.profit, Number.NaN));
  const ok = (
    tags.length >= 3 &&
    priorFillCount > 0 &&
    !incompatible &&
    coverCore > 0 &&
    vscore > 0 &&
    Number.isFinite(profit)
  );

  return {
    gridId,
    dims: Array.isArray(payload?.state?.member?.dims) ? payload.state.member.dims.join(",") : "",
    tagCount: tags.length,
    priorFillCount,
    incompatible,
    coverCore,
    vscore,
    profit,
    transportMode,
    tags: tags.map((item) => item?.tag || item).join(","),
    ok
  };
}

function printTable(rows) {
  const header = [
    pad("grid", 28),
    pad("tags", 4),
    pad("prior", 5),
    pad("conflict", 8),
    pad("coverCore", 10),
    pad("Vscore", 8),
    pad("profit", 12),
    pad("mode", 6),
    "status"
  ].join(" | ");
  scriptLog(header);
  scriptLog("-".repeat(header.length));
  rows.forEach((row) => {
    scriptLog([
      pad(row.gridId, 28),
      pad(row.tagCount, 4),
      pad(row.priorFillCount, 5),
      pad(row.incompatible ? "YES" : "NO", 8),
      pad(row.coverCore.toFixed(3), 10),
      pad(row.vscore.toFixed(3), 8),
      pad(Number.isFinite(row.profit) ? Math.round(row.profit) : "NaN", 12),
      pad(row.transportMode, 6),
      row.ok ? "PASS" : "FAIL"
    ].join(" | "));
  });
}

async function main() {
  const transport = await createTransport();
  const rows = [];

  try {
    await transport.get("/api/health");

    for (const gridId of GRID_IDS) {
      scriptLog(`Running ${gridId}...`);
      try {
        const seed = await seedRound1(transport, gridId, ARCHITECTURE);
        const payload = await runRound2Calculation(transport, seed.teamId, seed.memberId);
        rows.push(summarizeRow(gridId, payload, transport.mode));
      } catch (error) {
        rows.push({
          gridId,
          dims: "",
          tagCount: 0,
          priorFillCount: 0,
          incompatible: false,
          coverCore: 0,
          vscore: 0,
          profit: Number.NaN,
          transportMode: transport.mode,
          tags: "",
          ok: false,
          error: error.message || String(error)
        });
      }
    }

    printTable(rows);

    const failed = rows.filter((row) => !row.ok);
    if (failed.length > 0) {
      scriptError("\nFailed grids:");
      failed.forEach((row) => {
        scriptError(`- ${row.gridId}: ${row.error || row.tags || "validation failed"}`);
      });
      process.exitCode = 1;
      return;
    }

    scriptLog(`\nAll ${rows.length} grids passed.`);
  } finally {
    await transport.close();
  }
}

main().catch((error) => {
  scriptError(String(error?.stack || error));
  process.exit(1);
});
