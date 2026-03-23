"use strict";

const path = require("node:path");
const fs = require("node:fs");
const { ApiClient } = require("./sim/api_client");
const { SimLogger } = require("./sim/logger");
const { generateReport } = require("./sim/report");
const { runTeam } = require("./sim/team_runner");

function loadLocalEnvFile() {
  const envPath = path.join(process.cwd(), ".env");
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

function pLimit(concurrency) {
  const queue = [];
  let activeCount = 0;

  const next = () => {
    if (activeCount >= concurrency || queue.length === 0) return;
    activeCount += 1;
    const item = queue.shift();
    item.fn()
      .then(item.resolve, item.reject)
      .finally(() => {
        activeCount -= 1;
        next();
      });
  };

  return (fn) => new Promise((resolve, reject) => {
    queue.push({ fn, resolve, reject });
    next();
  });
}

async function main() {
  loadLocalEnvFile();
  const baseUrl = process.env.BASE_URL || "http://127.0.0.1:8787";
  const numTeams = Number(process.env.NUM_TEAMS || 10);
  const teamSize = Number(process.env.TEAM_SIZE || 6);
  const concurrency = Number(process.env.CONCURRENCY || 5);
  const logLevel = String(process.env.LOG_LEVEL || "normal").toLowerCase();
  const strictDeepSeek = String(process.env.STRICT_DEEPSEEK || "").trim() === "1";
  const startedAt = Date.now();
  const logger = new SimLogger();
  const timestampDir = new Date().toISOString().replace(/[:.]/g, "-");
  const logDir = path.join("data", "sim_logs", timestampDir);

  console.log(`\nEMBA-AI-SIM 全流程 AI 模拟测试`);
  console.log(`Teams: ${numTeams} x ${teamSize}, concurrency=${concurrency}`);
  console.log(`Base URL: ${baseUrl}\n`);
  if (strictDeepSeek && !process.env.DEEPSEEK_API_KEY) {
    console.error("STRICT_DEEPSEEK=1 but DEEPSEEK_API_KEY is missing");
    process.exit(1);
  }

  const healthApi = new ApiClient(baseUrl);
  try {
    await healthApi.health();
    console.log("服务器连通: OK\n");
  } catch (err) {
    console.error(`服务器不可达: ${err.message}`);
    process.exit(1);
  }

  const limit = pLimit(Math.max(1, concurrency));
  const results = await Promise.allSettled(
    Array.from({ length: numTeams }, (_, teamIndex) => limit(() => {
      const api = new ApiClient(baseUrl, { logger });
      return runTeam(teamIndex, teamSize, api, logger, console, { logLevel, strictDeepSeek });
    }))
  );

  let passed = 0;
  let failed = 0;
  for (let i = 0; i < results.length; i += 1) {
    const item = results[i];
    const ok = item.status === "fulfilled" && item.value?.status === "passed";
    if (ok) {
      passed += 1;
      continue;
    }
    failed += 1;
    if (item.status === "fulfilled") {
      const errors = (item.value.errors || []).map((err) => err.message).join("; ");
      console.error(`Team ${i + 1} failed: ${errors}`);
    } else {
      console.error(`Team ${i + 1} failed: ${item.reason?.message || item.reason}`);
    }
  }

  const elapsedSeconds = ((Date.now() - startedAt) / 1000).toFixed(1);
  console.log(`\nSummary: ✅ ${passed}  ❌ ${failed}  ⏱ ${elapsedSeconds}s`);

  logger.exportByTeam(path.join(logDir, "by_team"));
  logger.exportAll(path.join(logDir, "all_entries.json"));

  try {
    await fetch(`${baseUrl}/api/admin/flush-llm-logs`, { method: "POST" });
  } catch (err) {
    console.warn(`flush-llm-logs failed: ${err.message || err}`);
  }

  const reportPath = path.join(logDir, "report.json");
  generateReport(results, reportPath, {
    baseUrl,
    numTeams,
    teamSize,
    concurrency,
    logLevel,
    skipRound2: String(process.env.SKIP_ROUND2 || "") === "1",
    strictDeepSeek,
    logDir
  });
  console.log(`Report: ${reportPath}`);
  console.log(`Logs: ${logDir}`);

  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
