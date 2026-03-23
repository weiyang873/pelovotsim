"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { Pool } = require("pg");
const { ApiClient } = require("./sim/api_client");
const { DataExporter } = require("./sim/data_export");
const { SimLogger } = require("./sim/logger");
const { initializeAllStudents } = require("./sim/persona_pool");
const { generateReport } = require("./sim/report");
const { runTeam } = require("./sim/team_runner");

const BUSINESS_TABLE_DELETES = [
  ["round2_results", "team_id"],
  ["fg_team_radar", "team_id"],
  ["round2_submissions", "team_id"],
  ["round2_member_selections", "team_id"],
  ["round2_interview_sessions", "team_id"],
  ["round2_dimension_assignments", "team_id"],
  ["jinang_settlements", "team_id"],
  ["member_submissions", "team_id"],
  ["team_members", "team_id"],
  ["students", "team_id"],
  ["teacher_actions", "team_id"],
  ["team_runs", "team_id"],
  ["iteration_events", "team_id"],
  ["vp_sessions", "team_key"],
  ["marketing_sessions", "team_key"],
  ["llm_wizard_outputs", "team_key"],
  ["llm_call_metrics", "team_key"],
  ["teams", "id"],
  ["teams", "team_id"]
];

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

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
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

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function csvValue(value) {
  if (value == null) return "";
  const text = typeof value === "object" ? JSON.stringify(value) : String(value);
  if (/[,"\n]/.test(text)) {
    return `"${text.replace(/"/g, "\"\"")}"`;
  }
  return text;
}

function writeCsv(filePath, columns, rows) {
  ensureDir(path.dirname(filePath));
  const lines = [columns.join(",")];
  for (const row of rows) {
    lines.push(columns.map((column) => csvValue(row[column])).join(","));
  }
  fs.writeFileSync(filePath, `${lines.join("\n")}\n`);
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === "\"") {
        if (text[i + 1] === "\"") {
          field += "\"";
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }

    if (ch === "\"") {
      inQuotes = true;
      continue;
    }

    if (ch === ",") {
      row.push(field);
      field = "";
      continue;
    }

    if (ch === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      continue;
    }

    if (ch === "\r") {
      continue;
    }

    field += ch;
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  const filtered = rows.filter((item) => item.length > 1 || item[0] !== "");
  if (filtered.length === 0) return { columns: [], rows: [] };
  const columns = filtered[0];
  const objects = filtered.slice(1).map((values) => {
    const obj = {};
    columns.forEach((column, index) => {
      obj[column] = values[index] ?? "";
    });
    return obj;
  });
  return { columns, rows: objects };
}

function readCsvFile(filePath) {
  return parseCsv(fs.readFileSync(filePath, "utf8"));
}

function safeNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function mean(values) {
  if (!values.length) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function stddev(values) {
  if (!values.length) return null;
  const avg = mean(values);
  const variance = values.reduce((sum, value) => sum + ((value - avg) ** 2), 0) / values.length;
  return Math.sqrt(variance);
}

function percentile(values, p) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  if (sorted.length === 1) return sorted[0];
  const rank = (p / 100) * (sorted.length - 1);
  const lower = Math.floor(rank);
  const upper = Math.ceil(rank);
  if (lower === upper) return sorted[lower];
  const weight = rank - lower;
  return sorted[lower] + ((sorted[upper] - sorted[lower]) * weight);
}

function summarizeRound(teamRows) {
  const profits = teamRows
    .map((row) => safeNumber(row.r2_profit))
    .filter((value) => value != null);
  const profitable = teamRows.filter((row) => String(row.r2_is_profitable).toLowerCase() === "true").length;
  const loss = teamRows.filter((row) => String(row.r2_is_profitable).toLowerCase() === "false").length;
  return {
    profitable,
    loss,
    missingProfit: teamRows.length - profitable - loss,
    profitMin: profits.length ? Math.min(...profits) : null,
    profitMax: profits.length ? Math.max(...profits) : null
  };
}

function summarizeAggregate(teamRows) {
  const profitable = teamRows.filter((row) => String(row.r2_is_profitable).toLowerCase() === "true").length;
  const loss = teamRows.filter((row) => String(row.r2_is_profitable).toLowerCase() === "false").length;
  const profits = teamRows.map((row) => safeNumber(row.r2_profit)).filter((value) => value != null);
  const cValues = teamRows.map((row) => safeNumber(row.vp_C)).filter((value) => value != null);
  const gValues = teamRows.map((row) => safeNumber(row.vp_G)).filter((value) => value != null);
  const eValues = teamRows.map((row) => safeNumber(row.vp_E)).filter((value) => value != null);

  const profitByGrid = new Map();
  for (const row of teamRows) {
    const grid = String(row.grid || "");
    const profit = safeNumber(row.r2_profit);
    if (!grid || profit == null) continue;
    const current = profitByGrid.get(grid) || [];
    current.push(profit);
    profitByGrid.set(grid, current);
  }

  const coverCoreDistribution = new Map();
  for (const row of teamRows) {
    const key = row.coverCore === "" ? "missing" : String(row.coverCore);
    coverCoreDistribution.set(key, (coverCoreDistribution.get(key) || 0) + 1);
  }

  return {
    totalTeams: teamRows.length,
    profitableTeams: profitable,
    lossTeams: loss,
    missingProfitTeams: teamRows.length - profitable - loss,
    vpStats: {
      C: { min: Math.min(...cValues), max: Math.max(...cValues), mean: mean(cValues), stddev: stddev(cValues) },
      G: { min: Math.min(...gValues), max: Math.max(...gValues), mean: mean(gValues), stddev: stddev(gValues) },
      E: { min: Math.min(...eValues), max: Math.max(...eValues), mean: mean(eValues), stddev: stddev(eValues) }
    },
    profitPercentiles: {
      P10: percentile(profits, 10),
      P25: percentile(profits, 25),
      P50: percentile(profits, 50),
      P75: percentile(profits, 75),
      P90: percentile(profits, 90)
    },
    avgProfitByGrid: Object.fromEntries(
      Array.from(profitByGrid.entries())
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([grid, values]) => [grid, mean(values)])
    ),
    coverCoreDistribution: Object.fromEntries(
      Array.from(coverCoreDistribution.entries()).sort((a, b) => a[0].localeCompare(b[0]))
    )
  };
}

async function fetchColumnMap(pool) {
  const { rows } = await pool.query(`
    SELECT table_name, column_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
  `);
  const map = new Map();
  for (const row of rows) {
    const key = row.table_name;
    if (!map.has(key)) map.set(key, new Set());
    map.get(key).add(row.column_name);
  }
  return map;
}

async function cleanupBusinessTables(pool, teamIds) {
  if (!teamIds.length) return { deletedTables: 0 };
  const columnMap = await fetchColumnMap(pool);
  let deletedTables = 0;
  for (const [tableName, columnName] of BUSINESS_TABLE_DELETES) {
    const columns = columnMap.get(tableName);
    if (!columns || !columns.has(columnName)) continue;
    await pool.query(`DELETE FROM ${tableName} WHERE ${columnName} = ANY($1::text[])`, [teamIds]);
    deletedTables += 1;
  }
  return { deletedTables };
}

async function runSingleRound(options) {
  const {
    roundIndex,
    rounds,
    baseUrl,
    numTeams,
    teamSize,
    concurrency,
    logLevel,
    strictDeepSeek,
    batchRootDir
  } = options;

  const startedAt = Date.now();
  const logger = new SimLogger();
  const allStudents = await initializeAllStudents();
  if (numTeams > allStudents.length) {
    throw new Error(`NUM_TEAMS=${numTeams} exceeds generated pool size=${allStudents.length}`);
  }

  const runId = new Date().toISOString().replace(/[:.]/g, "-");
  const logDir = path.join("data", "persona_sim_logs", runId);
  const roster = buildRoster(allStudents);

  console.log(`\n=== Round ${roundIndex + 1}/${rounds} | run_id=${runId} ===`);

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
  console.log(`Round ${roundIndex + 1} summary: ✅ ${passed}  ❌ ${failed}  ⏱ ${elapsedSeconds}s`);

  ensureDir(logDir);
  logger.exportByTeam(path.join(logDir, "by_team"));
  logger.exportAll(path.join(logDir, "all_entries.json"));

  const rosterPath = path.join(logDir, "student_roster.json");
  fs.writeFileSync(rosterPath, JSON.stringify(roster, null, 2));

  try {
    await fetch(`${baseUrl}/api/admin/flush-llm-logs`, { method: "POST" });
  } catch (_) {}

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
    roundIndex: roundIndex + 1,
    batchRootDir
  });

  const trackers = results
    .filter((item) => item.status === "fulfilled" && item.value?.tracker?.teamId)
    .map((item) => item.value.tracker);

  const exporter = new DataExporter(runId, logDir, logger);
  const exportSummary = await exporter.exportAll(trackers);

  const teamCsv = readCsvFile(path.join(logDir, "teams_summary.csv"));
  const studentCsv = readCsvFile(path.join(logDir, "students_summary.csv"));
  const roundSummary = summarizeRound(teamCsv.rows);

  const cleanupPool = new Pool();
  const cleanupResult = await cleanupBusinessTables(
    cleanupPool,
    trackers.map((tracker) => tracker.teamId).filter(Boolean)
  );
  await cleanupPool.end();

  console.log(
    `Round ${roundIndex + 1} profits: 盈利=${roundSummary.profitable} 亏损=${roundSummary.loss} 缺失=${roundSummary.missingProfit}`
    + ` 区间=[${roundSummary.profitMin ?? "n/a"}, ${roundSummary.profitMax ?? "n/a"}]`
  );
  console.log(
    `Round ${roundIndex + 1} export: teams=${exportSummary.teamRows} students=${exportSummary.studentsRows}`
    + ` vp=${exportSummary.vpRows} jinang=${exportSummary.jinangRows} cleanup_tables=${cleanupResult.deletedTables}`
  );

  return {
    runId,
    logDir,
    passed,
    failed,
    exportSummary,
    roundSummary,
    teamRows: teamCsv.rows,
    teamColumns: teamCsv.columns,
    studentRows: studentCsv.rows,
    studentColumns: studentCsv.columns
  };
}

async function main() {
  loadLocalEnvFile();

  const baseUrl = process.env.BASE_URL || "http://127.0.0.1:8787";
  const rounds = Number(process.env.BATCH_ROUNDS || 10);
  const numTeams = Number(process.env.NUM_TEAMS || 10);
  const teamSize = Number(process.env.TEAM_SIZE || 6);
  const concurrency = Number(process.env.CONCURRENCY || 5);
  const logLevel = String(process.env.LOG_LEVEL || "normal").toLowerCase();
  const strictDeepSeek = String(process.env.STRICT_DEEPSEEK || "").trim() === "1";
  const sleepMs = Number(process.env.BATCH_SLEEP_MS || 10000);
  const batchRunId = `batch_${new Date().toISOString().replace(/[:.]/g, "-")}`;
  const batchRootDir = path.join("data", "persona_sim_logs", batchRunId);

  console.log("\n🎭 EMBA-AI-SIM Batch Persona 测试");
  console.log(`   rounds=${rounds} teams=${numTeams} teamSize=${teamSize} concurrency=${concurrency}`);
  console.log(`   sleep_between_rounds=${sleepMs}ms`);
  console.log(`   batch_output=${batchRootDir}\n`);

  if (strictDeepSeek && !process.env.DEEPSEEK_API_KEY) {
    throw new Error("STRICT_DEEPSEEK=1 but DEEPSEEK_API_KEY is missing");
  }

  const healthApi = new ApiClient(baseUrl);
  await healthApi.health();
  console.log("服务器连通: OK");

  const roundResults = [];
  for (let roundIndex = 0; roundIndex < rounds; roundIndex += 1) {
    const result = await runSingleRound({
      roundIndex,
      rounds,
      baseUrl,
      numTeams,
      teamSize,
      concurrency,
      logLevel,
      strictDeepSeek,
      batchRootDir
    });
    roundResults.push(result);
    if (roundIndex < rounds - 1) {
      console.log(`Sleeping ${sleepMs}ms before next round...`);
      await delay(sleepMs);
    }
  }

  ensureDir(batchRootDir);
  const allTeamRows = roundResults.flatMap((item) => item.teamRows);
  const allStudentRows = roundResults.flatMap((item) => item.studentRows);
  const teamColumns = roundResults.find((item) => item.teamColumns.length > 0)?.teamColumns || [];
  const studentColumns = roundResults.find((item) => item.studentColumns.length > 0)?.studentColumns || [];
  const allTeamsPath = path.join(batchRootDir, "all_teams_100.csv");
  const allStudentsPath = path.join(batchRootDir, "all_students_600.csv");

  writeCsv(allTeamsPath, teamColumns, allTeamRows);
  writeCsv(allStudentsPath, studentColumns, allStudentRows);

  const aggregate = summarizeAggregate(allTeamRows);
  const summaryPayload = {
    batchRunId,
    rounds,
    numTeams,
    teamSize,
    generatedAt: new Date().toISOString(),
    roundRuns: roundResults.map((item) => ({
      runId: item.runId,
      logDir: item.logDir,
      passed: item.passed,
      failed: item.failed,
      summary: item.roundSummary
    })),
    aggregate,
    output: {
      allTeamsPath,
      allStudentsPath
    }
  };

  fs.writeFileSync(
    path.join(batchRootDir, "batch_summary.json"),
    JSON.stringify(summaryPayload, null, 2)
  );

  console.log("\n=== Batch Summary ===");
  console.log(`总盈利/亏损队数: ${aggregate.profitableTeams}/${aggregate.lossTeams}`);
  if (aggregate.missingProfitTeams > 0) {
    console.log(`缺失利润结果队数: ${aggregate.missingProfitTeams}`);
  }
  console.log(`C stats: min=${aggregate.vpStats.C.min} max=${aggregate.vpStats.C.max} mean=${aggregate.vpStats.C.mean?.toFixed(4)} stddev=${aggregate.vpStats.C.stddev?.toFixed(4)}`);
  console.log(`G stats: min=${aggregate.vpStats.G.min} max=${aggregate.vpStats.G.max} mean=${aggregate.vpStats.G.mean?.toFixed(4)} stddev=${aggregate.vpStats.G.stddev?.toFixed(4)}`);
  console.log(`E stats: min=${aggregate.vpStats.E.min} max=${aggregate.vpStats.E.max} mean=${aggregate.vpStats.E.mean?.toFixed(4)} stddev=${aggregate.vpStats.E.stddev?.toFixed(4)}`);
  console.log(
    `利润 percentiles: P10=${aggregate.profitPercentiles.P10} P25=${aggregate.profitPercentiles.P25}`
    + ` P50=${aggregate.profitPercentiles.P50} P75=${aggregate.profitPercentiles.P75} P90=${aggregate.profitPercentiles.P90}`
  );
  console.log("按 grid 分组平均利润:");
  for (const [grid, avgProfit] of Object.entries(aggregate.avgProfitByGrid)) {
    console.log(`  ${grid}: ${avgProfit}`);
  }
  console.log("coverCore 分布:");
  for (const [coverCore, count] of Object.entries(aggregate.coverCoreDistribution)) {
    console.log(`  ${coverCore}: ${count}`);
  }
  console.log(`\n合并输出: ${allTeamsPath}`);
  console.log(`合并输出: ${allStudentsPath}`);
  console.log(`摘要输出: ${path.join(batchRootDir, "batch_summary.json")}`);

  process.exit(aggregate.lossTeams > 0 || aggregate.missingProfitTeams > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
