const http = require("node:http");
const net = require("node:net");
const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { test, expect, request: playwrightRequest } = require("@playwright/test");

function loadLocalEnvFile() {
  const envPath = path.resolve(__dirname, "..", "..", ".env");
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

const db = require("../../server/db/pgSql");

const LOW_QUALITY_INTERVIEW = [
  "嗯",
  "机器人好不好",
  "多少钱",
  "还行吧",
  "就那样"
];

const MEDIUM_QUALITY_INTERVIEW = [
  "需要能够接物联网吗",
  "数字化的巡检呢",
  "那你的压力在哪里",
  "安全问题怎么解决",
  "希望什么样的机器人"
];

const LEAK_MARKERS = ["所在机构是", "我现在负责", "比起先谈产品", "决策压力说清楚"];
const DEFAULT_SELECTIONS = [
  { cap_id: "persona_dialog", tier: "low" },
  { cap_id: "adaptive_learning", tier: "low" },
  { cap_id: "api_iot", tier: "low" },
  { cap_id: "cloud_update", tier: "low" }
];

async function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close((error) => {
        if (error) reject(error);
        else resolve(port);
      });
    });
  });
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
    });
    req.on("end", () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch (error) {
        reject(error);
      }
    });
    req.on("error", reject);
  });
}

async function startMockLlmServer() {
  const server = http.createServer(async (req, res) => {
    if (req.method !== "POST" || req.url !== "/v1/chat/completions") {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: { message: "not found" } }));
      return;
    }

    const body = await readJson(req);
    const messages = Array.isArray(body.messages) ? body.messages : [];
    const systemText = String(messages[0]?.content || "");
    const lastUser = [...messages].reverse().find((item) => item?.role === "user");
    const lastUserText = String(lastUser?.content || "");

    let content = "平时最在意的是别太折腾，真有状况的时候也要稳得住。";
    if (systemText.includes("访谈证据提取助手")) {
      const conversationText = String(messages[messages.length - 1]?.content || "");
      const isLowQuality = LOW_QUALITY_INTERVIEW.every((line) => conversationText.includes(line));
      const isMediumQuality = MEDIUM_QUALITY_INTERVIEW.every((line) => conversationText.includes(line));
      if (isLowQuality) {
        content = JSON.stringify({
          focused_dimensions: ["safety", "ops"],
          dimension_evidence: {
            safety: { mentioned: false, strength: "weak", evidence: [], needs: [], scenarios: [], pain_points: [] },
            ops: { mentioned: false, strength: "weak", evidence: [], needs: [], scenarios: [], pain_points: [] }
          },
          other_dimensions: {},
          tags: ["儿童安全"],
          interview_quality: {
            specificity: "low",
            consistency: "medium",
            actionability: "low"
          },
          missing_dimensions: ["interaction", "perception", "motion", "extend"]
        });
      } else if (isMediumQuality) {
        content = JSON.stringify({
          focused_dimensions: ["extend", "ops"],
          dimension_evidence: {
            extend: {
              mentioned: true,
              strength: "strong",
              evidence: [{ quote: "需要能够接物联网", reason: "说明需要设备连接能力" }],
              needs: ["设备联动"],
              scenarios: ["数字化巡检"],
              pain_points: ["系统之间不互通"]
            },
            ops: {
              mentioned: true,
              strength: "weak",
              evidence: [{ quote: "数字化的巡检呢", reason: "说明关心运营维护效率" }],
              needs: ["降低维护负担"],
              scenarios: ["日常巡检"],
              pain_points: ["人工巡检效率低"]
            }
          },
          other_dimensions: {},
          tags: ["自动充电", "语音交互"],
          interview_quality: {
            specificity: "medium",
            consistency: "high",
            actionability: "medium"
          },
          missing_dimensions: ["interaction", "perception", "motion", "safety"]
        });
      } else {
        content = JSON.stringify({
          focused_dimensions: ["interaction", "safety"],
          dimension_evidence: {},
          other_dimensions: {},
          tags: [],
          interview_quality: {
            specificity: "low",
            consistency: "low",
            actionability: "low"
          },
          missing_dimensions: ["interaction", "perception", "motion", "safety", "extend", "ops"]
        });
      }
    } else if (lastUserText.includes("请用自然对话回答，不要介绍自己的背景信息")) {
      content = "我更在意实际使用时会不会添麻烦，出了状况能不能及时顶上。";
    } else {
      content = "我现在负责机构采购，所在机构是连锁养老机构。比起先谈产品，我更愿意先把真实场景和决策压力说清楚。";
    }

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
      choices: [
        {
          message: {
            content
          }
        }
      ]
    }));
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  return {
    server,
    baseUrl: `http://127.0.0.1:${port}`
  };
}

async function waitForHealth(baseUrl, timeoutMs = 30000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(`${baseUrl}/api/health`);
      if (response.ok) return;
    } catch (_) {}
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`server health check timed out after ${timeoutMs}ms`);
}

async function startAppServer(mockBaseUrl) {
  const port = await getFreePort();
  const cwd = path.resolve(__dirname, "..", "..");
  const child = spawn(process.execPath, ["server.js"], {
    cwd,
    env: {
      ...process.env,
      NODE_ENV: "test",
      PORT: String(port),
      HOST: "127.0.0.1",
      DEEPSEEK_API_KEY: "test-key",
      DEEPSEEK_BASE_URL: mockBaseUrl,
      DEEPSEEK_TIMEOUT_MS: "2000",
      LLM_LOG: "0"
    },
    stdio: ["ignore", "pipe", "pipe"]
  });

  let stderr = "";
  child.stderr.on("data", (chunk) => {
    stderr += String(chunk || "");
  });

  child.on("exit", (code) => {
    if (code !== 0) {
      console.error(`[adversarial-inputs] app server exited with code ${code}\n${stderr}`);
    }
  });

  const baseUrl = `http://127.0.0.1:${port}`;
  await waitForHealth(baseUrl);
  return {
    child,
    baseUrl
  };
}

async function stopChild(child) {
  if (!child || child.killed) return;
  child.kill("SIGTERM");
  await new Promise((resolve) => {
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      resolve();
    }, 5000);
    child.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

async function postJson(api, pathName, payload) {
  const response = await api.post(pathName, { data: payload });
  const body = await response.json();
  expect(response.ok(), `${pathName} failed: ${JSON.stringify(body)}`).toBeTruthy();
  return body;
}

async function getJson(api, pathName) {
  const response = await api.get(pathName);
  const body = await response.json();
  expect(response.ok(), `${pathName} failed: ${JSON.stringify(body)}`).toBeTruthy();
  return body;
}

async function bootstrapRound2Team(api) {
  const seeded = await getJson(api, "/api/test/skip-to-r2");
  return {
    teamId: String(seeded.team_id || "").trim(),
    memberId: String(seeded.member_id || "").trim()
  };
}

async function runInterview(api, { teamId, memberId, script }) {
  const started = await postJson(api, "/api/round2/interview/start", { teamId, memberId });
  const sessionId = String(started.sessionId || "").trim();
  expect(sessionId).not.toBe("");

  const replies = [];
  for (const message of script) {
    const body = await postJson(api, "/api/round2/interview/reply", { sessionId, message });
    replies.push(String(body.reply || ""));
  }

  const ended = await postJson(api, "/api/round2/interview/end", { sessionId });
  return {
    sessionId,
    replies,
    end: ended
  };
}

async function submitTeamSolution(api, { teamId, memberId, recap, selections }) {
  await postJson(api, "/api/round2/member-selection", {
    teamId,
    memberId,
    selections
  });
  const merged = await postJson(api, "/api/round2/merge", {
    teamId,
    memberId
  });
  const price = Math.max(6000, Math.min(Number(recap.Pmax || 12000), 9800));
  const submitted = await postJson(api, "/api/round2/team-submit", {
    teamId,
    memberId,
    price,
    selections,
    mergedInterview: {
      radar: merged.mergedInterview.radar,
      tags: merged.mergedInterview.tags,
      evi: merged.mergedInterview.evi
    },
    bestGrid: recap.final_grid_id
  });
  const result = await getJson(api, `/api/round2/team-result?teamId=${encodeURIComponent(teamId)}&sessionId=default`);
  return {
    merged,
    submitted,
    result
  };
}

async function waitForLogs(teamId, sessionId = "default", timeoutMs = 10000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const rows = await db.runSql(`
      SELECT stage, params
      FROM computation_log
      WHERE team_id = '${String(teamId).replace(/'/g, "''")}'
        AND session_id = '${String(sessionId).replace(/'/g, "''")}'
        AND stage IN ('r2_tag_layering', 'r2_coverage', 'r2_product_scores', 'r2_profit')
      ORDER BY id DESC;
    `);
    const byStage = {};
    rows.forEach((row) => {
      if (!byStage[row.stage]) {
        byStage[row.stage] = row.params || {};
      }
    });
    if (byStage.r2_tag_layering && byStage.r2_coverage && byStage.r2_product_scores && byStage.r2_profit) {
      return byStage;
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`timed out waiting for computation_log rows for team ${teamId}`);
}

async function runFullFlow(api, script) {
  const { teamId, memberId } = await bootstrapRound2Team(api);
  const recap = await getJson(api, `/api/round2/recap?teamId=${encodeURIComponent(teamId)}`);
  const interview = await runInterview(api, { teamId, memberId, script });
  const finalResult = await submitTeamSolution(api, {
    teamId,
    memberId,
    recap,
    selections: DEFAULT_SELECTIONS
  });
  const logs = await waitForLogs(teamId);
  return {
    teamId,
    memberId,
    recap,
    interview,
    finalResult,
    logs
  };
}

test.describe.serial("Adversarial Round 2 Inputs", () => {
  let mockLlm;
  let appServer;
  let api;

  test.beforeAll(async () => {
    mockLlm = await startMockLlmServer();
    appServer = await startAppServer(mockLlm.baseUrl);
    api = await playwrightRequest.newContext({
      baseURL: appServer.baseUrl,
      extraHTTPHeaders: {
        "Content-Type": "application/json"
      }
    });
  });

  test.afterAll(async () => {
    await api?.dispose();
    await stopChild(appServer?.child);
    await new Promise((resolve) => mockLlm?.server?.close(resolve));
    await db.shutdown().catch(() => {});
  });

  test("低质量访谈输入不导致计算链路崩溃", async () => {
    const flow = await runFullFlow(api, LOW_QUALITY_INTERVIEW);
    const endTags = Array.isArray(flow.interview.end.tags) ? flow.interview.end.tags : [];
    const storedResult = flow.finalResult.result.result || {};
    const finalResult = storedResult.result || {};
    const tagLayering = flow.logs.r2_tag_layering || {};
    const coverage = flow.logs.r2_coverage || {};
    const productScores = flow.logs.r2_product_scores || {};
    const profitLog = flow.logs.r2_profit || {};

    expect(endTags.length).toBeGreaterThanOrEqual(3);
    expect(Array.isArray(tagLayering.tags) ? tagLayering.tags.length : 0).toBeGreaterThanOrEqual(3);
    expect(Number(coverage.coverCore || finalResult.coverCore || 0)).toBeGreaterThan(0);
    expect(Number.isFinite(Number(profitLog.total_profit || finalResult.profit || 0))).toBeTruthy();
    expect(Number(productScores.Vscore || finalResult.V || 0)).toBeGreaterThan(0);
    expect(Number.isNaN(Number(finalResult.profit))).toBeFalsy();
  });

  test("persona 泄露时不暴露 system prompt", async () => {
    const flow = await runFullFlow(api, LOW_QUALITY_INTERVIEW);
    const replies = flow.interview.replies;

    expect(replies.length).toBe(LOW_QUALITY_INTERVIEW.length);
    replies.forEach((reply) => {
      LEAK_MARKERS.forEach((marker) => {
        expect(String(reply || "")).not.toContain(marker);
      });
    });
  });

  test("tag 提取不足时格子先验兜底", async () => {
    const flow = await runFullFlow(api, MEDIUM_QUALITY_INTERVIEW);
    const endTags = Array.isArray(flow.interview.end.tags) ? flow.interview.end.tags : [];
    const tagSources = endTags.map((item) => item?.source || "");
    const tagLayering = flow.logs.r2_tag_layering || {};

    expect(endTags.length).toBeGreaterThanOrEqual(3);
    expect(tagSources).toContain("grid_prior");
    expect(endTags.some((item) => item?.tag === "儿童安全")).toBeFalsy();
    expect(Array.isArray(tagLayering.tags) ? tagLayering.tags.length : 0).toBeGreaterThanOrEqual(3);
  });
});
