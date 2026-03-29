"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { ApiClient } = require("./sim/api_client");
const { DataExporter } = require("./sim/data_export");
const { SimLogger } = require("./sim/logger");
const { initializeAllStudents } = require("./sim/persona_pool");
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

function buildRoster(allStudents) {
  return allStudents.map((team, teamIndex) => ({
    teamIndex,
    members: team.map((student) => ({
      name: student.name,
      persona: student.label,
      personaId: student.personaId,
      gender: student.gender,
      mbti: student.mbti,
      age: student.age,
      education: student.education,
      overseas: student.overseas,
      expressionModifier: student.expressionModifier,
      role: student.role,
      industry: student.industry
    }))
  }));
}

function jsonKeys(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  return Object.keys(value);
}

async function fetchTeacherResource(baseUrl, adminCode, resourcePath) {
  const res = await fetch(`${baseUrl}${resourcePath}`, {
    headers: {
      "x-teacher-code": adminCode
    }
  });
  const contentType = String(res.headers.get("content-type") || "").toLowerCase();
  const text = await res.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch (_) {
    body = null;
  }
  return {
    status: res.status,
    ok: res.ok && (!body || body.ok !== false),
    contentType,
    text,
    body
  };
}

async function captureTeacherArtifacts(baseUrl, logDir) {
  const adminCode = String(process.env.ADMIN_CODE || "").trim();
  if (!adminCode) {
    return {
      enabled: false,
      error: "ADMIN_CODE not configured"
    };
  }

  try {
    const sessionStatus = await fetchTeacherResource(baseUrl, adminCode, "/api/teacher/session-status");
    const debriefData = await fetchTeacherResource(baseUrl, adminCode, "/api/teacher/debrief-data?session_id=default");
    const exportCsv = await fetchTeacherResource(baseUrl, adminCode, "/api/teacher/export-csv?session_id=default");

    const sessionStatusPath = path.join(logDir, "teacher_session_status.json");
    const debriefDataPath = path.join(logDir, "teacher_debrief_data.json");
    const exportCsvPath = path.join(logDir, "teacher_export.csv");
    const summaryPath = path.join(logDir, "teacher_capture_summary.json");

    fs.writeFileSync(
      sessionStatusPath,
      JSON.stringify(sessionStatus.body || {
        ok: sessionStatus.ok,
        status: sessionStatus.status,
        raw: sessionStatus.text
      }, null, 2)
    );
    fs.writeFileSync(
      debriefDataPath,
      JSON.stringify(debriefData.body || {
        ok: debriefData.ok,
        status: debriefData.status,
        raw: debriefData.text
      }, null, 2)
    );
    fs.writeFileSync(exportCsvPath, exportCsv.text || "");

    const summary = {
      enabled: true,
      session_status: {
        status: sessionStatus.status,
        ok: sessionStatus.ok,
        keys: jsonKeys(sessionStatus.body),
        meta: sessionStatus.body?.meta || null,
        team_count: Array.isArray(sessionStatus.body?.teams) ? sessionStatus.body.teams.length : null,
        file: sessionStatusPath
      },
      debrief_data: {
        status: debriefData.status,
        ok: debriefData.ok,
        keys: jsonKeys(debriefData.body),
        team_count: Array.isArray(debriefData.body?.teams) ? debriefData.body.teams.length : null,
        file: debriefDataPath
      },
      export_csv: {
        status: exportCsv.status,
        ok: exportCsv.ok,
        bytes: Buffer.byteLength(exportCsv.text || "", "utf8"),
        line_count: (exportCsv.text || "").split(/\r?\n/).filter((line) => line.length > 0).length,
        file: exportCsvPath
      }
    };

    fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2));
    return summary;
  } catch (err) {
    return {
      enabled: true,
      error: err.message || String(err)
    };
  }
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
  const allStudents = await initializeAllStudents();
  const timestampDir = new Date().toISOString().replace(/[:.]/g, "-");
  const logDir = path.join("data", "persona_sim_logs", timestampDir);

  console.log("\n🎭 EMBA-AI-SIM Persona 拟真模拟测试");
  console.log(`   预生成学生池：${allStudents.length} 队 × ${allStudents[0]?.length || 0} 人`);
  console.log(`   实际执行：${numTeams} 队 × ${teamSize} 人，concurrency=${concurrency}\n`);
  console.log("📋 学生分配概况（60 人）：");
  allStudents.forEach((team, teamIndex) => {
    const summary = team
      .map((student) => `${student.name}(${student.label}/${student.gender === "male" ? "M" : "F"}/${student.mbti}/${student.education})`)
      .join(" | ");
    console.log(`   队${teamIndex}: ${summary}`);
  });
  console.log("");

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
      const teamStudents = (allStudents[teamIndex] || []).slice(0, teamSize);
      return runTeam(teamIndex, teamSize, api, logger, console, {
        logLevel,
        strictDeepSeek,
        students: teamStudents
      });
    }))
  );

  const elapsedSeconds = ((Date.now() - startedAt) / 1000).toFixed(1);
  const passed = results.filter((item) => item.status === "fulfilled" && item.value?.status === "passed").length;
  const failed = results.length - passed;
  console.log(`Summary: ✅ ${passed}  ❌ ${failed}  ⏱ ${elapsedSeconds}s`);

  fs.mkdirSync(logDir, { recursive: true });
  logger.exportByTeam(path.join(logDir, "by_team"));
  logger.exportAll(path.join(logDir, "all_entries.json"));

  const rosterPath = path.join(logDir, "student_roster.json");
  fs.writeFileSync(rosterPath, JSON.stringify(buildRoster(allStudents), null, 2));

  try {
    await fetch(`${baseUrl}/api/admin/flush-llm-logs`, { method: "POST" });
  } catch (_) {}

  const trackers = results
    .filter((item) => item.status === "fulfilled" && item.value?.tracker)
    .map((item) => item.value.tracker);
  const exporter = new DataExporter(timestampDir, logDir, logger);
  const exportSummary = await exporter.exportAll(trackers);
  const computationChains = {};
  await Promise.all(trackers.map(async (tracker) => {
    const teamId = String(tracker?.teamId || "").trim();
    if (!teamId) return;
    try {
      computationChains[teamId] = await healthApi.getComputationChain(teamId);
    } catch (err) {
      computationChains[teamId] = {
        ok: false,
        team_id: teamId,
        error: err.message || String(err)
      };
    }
  }));
  fs.writeFileSync(
    path.join(logDir, "computation_log.json"),
    JSON.stringify(computationChains, null, 2)
  );

  const teacherSummary = await captureTeacherArtifacts(baseUrl, logDir);
  const reportPath = path.join(logDir, "report.json");
  generateReport(results, reportPath, {
    baseUrl,
    numTeams,
    teamSize,
    concurrency,
    logLevel,
    strictDeepSeek,
    rosterPath,
    logDir,
    exportSummary,
    teacher: teacherSummary
  });

  console.log(`\n📊 输出目录: ${logDir}/`);
  console.log("   student_roster.json   60 人人设清单");
  console.log("   students_summary.csv  学生汇总导出");
  console.log("   teams_summary.csv     团队汇总导出");
  console.log("   vp_iterations.csv     VP 迭代导出");
  console.log("   interview_log.csv     访谈逐轮对话导出");
  console.log("   vp_chat_log.csv       VP Coach 对话导出");
  console.log("   jinang_effects.csv    锦囊效果导出");
  console.log("   computation_log.json  每队完整 computation chain");
  console.log("   teacher_session_status.json 教师端状态快照");
  console.log("   teacher_debrief_data.json   教师端复盘数据");
  console.log("   teacher_export.csv          教师端 CSV 导出");
  console.log("   teacher_capture_summary.json 教师端抓取摘要");
  console.log("   by_team/              每队日志");
  console.log("   report.json           测试报告");
  console.log(`   PG export             students=${exportSummary.studentsRows}, teams=${exportSummary.teamRows}, vp=${exportSummary.vpRows}, interview=${exportSummary.interviewRows}, vp_chat=${exportSummary.vpChatRows}, jinang=${exportSummary.jinangRows}`);

  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
