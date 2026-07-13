"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const ROOT = path.join(__dirname, "..", "..");
const REPORTS_PATH = path.join(ROOT, "game_config_v0.1", "persona_reports_v1.1.json");
const RUN_ID = "subjective_prompt_isolation_v1_2026-07-13";
const JSONL_PATH = path.join(__dirname, `${RUN_ID}.jsonl`);
const CSV_PATH = path.join(__dirname, "subjective_prompt_isolation_results.csv");
const SUMMARY_PATH = path.join(__dirname, "subjective_prompt_isolation_summary.md");
const META_PATH = path.join(__dirname, "subjective_prompt_isolation_meta.json");
const REPS = 10;
const CONCURRENCY = 6;
const TEMPERATURE = 0.45;

function loadLocalEnv() {
  const envPath = path.join(ROOT, ".env");
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const splitAt = trimmed.indexOf("=");
    if (splitAt <= 0) continue;
    const key = trimmed.slice(0, splitAt).trim();
    let value = trimmed.slice(splitAt + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!Object.prototype.hasOwnProperty.call(process.env, key)) process.env[key] = value;
  }
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function reportTitle(report, index) {
  return String(report.persona_name || report.persona_id || report.title || `P${index + 1}`).trim();
}

function buildReportsInput(reports) {
  return reports.map((report, index) => [
    `### 已读报告 ${index + 1}：${reportTitle(report, index)}`,
    String(report.report_text || report.text || report.summary_text || "").trim()
  ].join("\n")).join("\n\n");
}

function buildOriginalPrompt(reports) {
  return [
    "## 当前任务：形成选卡前的主观状态",
    "请只根据你的身份/persona信息和你已读报告内容，形成后续选卡与定价会使用的中间判断。",
    "",
    "## 你实际读过的报告原文",
    buildReportsInput(reports),
    "",
    "只输出可 JSON.parse 的 JSON：",
    "{",
    '  "estimated_wtp_range": [3000, 5000],',
    '  "top_needs": ["需求1", "需求2"],',
    '  "primary_goal": "一句话说明本轮最重要目标",',
    '  "min_acceptable_coverage": "high|medium|low",',
    '  "planned_stop_rule": "一句话说明你准备如何停止搜索"',
    "}"
  ].join("\n");
}

function parseJsonObject(raw) {
  const text = String(raw || "").replace(/```json|```/gi, "").trim();
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  return JSON.parse(start >= 0 && end > start ? text.slice(start, end + 1) : text);
}

function validateSubjectiveState(raw) {
  const data = parseJsonObject(raw);
  const range = Array.isArray(data.estimated_wtp_range) ? data.estimated_wtp_range.map(Number) : [];
  if (range.length !== 2 || !range.every(Number.isFinite) || range[0] > range[1]) {
    throw new Error("estimated_wtp_range must be [low, high] finite numbers");
  }
  const topNeeds = Array.isArray(data.top_needs)
    ? data.top_needs.map((item) => String(item || "").trim()).filter(Boolean)
    : [];
  if (!topNeeds.length) throw new Error("top_needs must be non-empty");
  const coverage = String(data.min_acceptable_coverage || "").trim();
  if (!["high", "medium", "low"].includes(coverage)) throw new Error("min_acceptable_coverage invalid");
  const primaryGoal = String(data.primary_goal || "").trim();
  const stopRule = String(data.planned_stop_rule || "").trim();
  if (!primaryGoal || !stopRule) throw new Error("primary_goal and planned_stop_rule are required");
  return {
    range,
    midpoint: (range[0] + range[1]) / 2,
    topNeeds,
    primaryGoal,
    coverage,
    stopRule
  };
}

async function callWithRetry(chatCompletion, prompt) {
  const baseMessages = [{ role: "user", content: prompt }];
  let messages = baseMessages;
  let raw = "";
  let lastError = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      raw = await chatCompletion(messages, {
        temperature: TEMPERATURE,
        max_tokens: 700,
        maxRetries: 2
      });
      return { raw, parsed: validateSubjectiveState(raw), attempts: attempt + 1 };
    } catch (error) {
      lastError = error;
      messages = baseMessages.concat([
        { role: "assistant", content: raw || "(空输出)" },
        { role: "user", content: `上一次输出无法通过校验：${String(error.message || error)}\n请只输出同一决策的合法 JSON，不要 Markdown，不要解释。` }
      ]);
    }
  }
  throw new Error(`failed after 3 attempts: ${String(lastError?.message || lastError || "unknown")}`);
}

function cellKey(row) {
  return `${row.grid}|${row.rep}`;
}

function loadRows() {
  if (!fs.existsSync(JSONL_PATH)) return [];
  return fs.readFileSync(JSONL_PATH, "utf8").split(/\r?\n/).filter(Boolean).map(JSON.parse);
}

function csvEscape(value) {
  if (value == null) return "";
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

async function runPool(tasks, worker) {
  let next = 0;
  await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
    while (next < tasks.length) {
      const index = next++;
      await worker(tasks[index], index);
    }
  }));
}

function mean(values) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  if (!sorted.length) return null;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function pct(numerator, denominator) {
  return denominator ? `${(numerator / denominator * 100).toFixed(1)}%` : "N/A";
}

function writeOutputs(rows, reportConfig, promptTemplateSha) {
  const headers = [
    "run_id", "grid", "rep", "range_low", "range_high", "midpoint", "anchored_midpoint",
    "exact_example_range", "contains_4000", "status", "error", "attempts", "raw_response"
  ];
  const csvRows = rows.map((row) => ({
    ...row,
    anchored_midpoint: row.status === "success" ? row.midpoint >= 3800 && row.midpoint <= 4200 : null,
    exact_example_range: row.status === "success" ? row.range_low === 3000 && row.range_high === 5000 : null,
    contains_4000: row.status === "success" ? row.range_low <= 4000 && row.range_high >= 4000 : null
  }));
  fs.writeFileSync(CSV_PATH, [headers.join(",")].concat(csvRows.map((row) => headers.map((key) => csvEscape(row[key])).join(","))).join("\n") + "\n");

  const successful = csvRows.filter((row) => row.status === "success");
  const failures = csvRows.filter((row) => row.status !== "success");
  const byGrid = reportConfig.grids.map((grid) => {
    const selected = successful.filter((row) => row.grid === grid.grid_id);
    return {
      grid: grid.grid_id,
      success: selected.length,
      anchorRate: selected.filter((row) => row.anchored_midpoint).length / Math.max(1, selected.length),
      exactRate: selected.filter((row) => row.exact_example_range).length / Math.max(1, selected.length),
      containsRate: selected.filter((row) => row.contains_4000).length / Math.max(1, selected.length),
      meanMidpoint: mean(selected.map((row) => row.midpoint))
    };
  });
  const anchored = successful.filter((row) => row.anchored_midpoint).length;
  const exact = successful.filter((row) => row.exact_example_range).length;
  const contains = successful.filter((row) => row.contains_4000).length;
  const anchorRate = successful.length ? anchored / successful.length : null;
  const verdict = anchorRate >= 0.7
    ? "PROMPT_FORMAT_CAUSAL_CANDIDATE: anchor rate is at least 70%; the full multi-field example is sufficient to recreate collapse without pipeline context."
    : "PIPELINE_CONTEXT_CANDIDATE: anchor rate remains below 70%; the full multi-field example alone does not recreate collapse."
  const summary = [
    "# Original Subjective Prompt Isolation",
    "",
    `- runId: \`${RUN_ID}\``,
    `- cells: ${rows.length}/120`,
    `- successful: ${successful.length}/120 (${pct(successful.length, 120)})`,
    `- midpoint anchor rate [3800,4200]: ${anchored}/${successful.length} (${pct(anchored, successful.length)})`,
    `- exact example range [3000,5000]: ${exact}/${successful.length} (${pct(exact, successful.length)})`,
    `- ranges containing 4000: ${contains}/${successful.length} (${pct(contains, successful.length)})`,
    `- midpoint mean/median: ${mean(successful.map((row) => row.midpoint))?.toFixed(1) || "N/A"} / ${median(successful.map((row) => row.midpoint))?.toFixed(1) || "N/A"}`,
    `- failures: ${failures.length}`,
    `- verdict: **${verdict}**`,
    "",
    "## Per Grid",
    "",
    "| Grid | Success | Anchor rate | Exact example | Contains 4000 | Mean midpoint |",
    "|---|---:|---:|---:|---:|---:|",
    ...byGrid.map((item) => `| ${item.grid} | ${item.success}/10 | ${pct(item.anchorRate, 1)} | ${pct(item.exactRate, 1)} | ${pct(item.containsRate, 1)} | ${item.meanMidpoint.toFixed(0)} |`),
    "",
    "## Isolation Boundary",
    "",
    "- One user message only; no system persona message.",
    "- No prior report-reading, selection, pricing, cost, card, validation, or conversation messages.",
    "- All three production v1.1 reports for the grid are inserted through the same `buildReportsInput` format used by the sim.",
    "- The original five-field JSON example and wording are unchanged.",
    "- Midpoint is a deterministic post-processing score and is never sent to the model.",
    "",
    "## Failures",
    "",
    ...(failures.length ? failures.map((row) => `- ${row.grid} rep ${row.rep}: ${row.error}`) : ["- None"]),
    ""
  ].join("\n");
  fs.writeFileSync(SUMMARY_PATH, summary);
  fs.writeFileSync(META_PATH, JSON.stringify({
    runId: RUN_ID,
    generatedAt: new Date().toISOString(),
    cells: rows.length,
    successful: successful.length,
    anchorRate,
    exactExampleRate: successful.length ? exact / successful.length : null,
    contains4000Rate: successful.length ? contains / successful.length : null,
    verdict,
    temperature: TEMPERATURE,
    maxTokens: 700,
    promptTemplateSha256: promptTemplateSha,
    personaReportsSha256: sha256(fs.readFileSync(REPORTS_PATH)),
    externalContextMessages: 0,
    systemPersonaIncluded: false
  }, null, 2) + "\n");
  return { successful: successful.length, anchorRate, verdict };
}

async function main() {
  loadLocalEnv();
  const reportConfig = JSON.parse(fs.readFileSync(REPORTS_PATH, "utf8"));
  if (reportConfig.grids.length !== 12) throw new Error(`expected 12 grids, got ${reportConfig.grids.length}`);
  const templatePrompt = buildOriginalPrompt([{ persona_id: "{persona_id}", report_text: "{report_text}" }]);
  const promptTemplateSha = sha256(templatePrompt);
  const existing = loadRows();
  const completed = new Set(existing.map(cellKey));
  const tasks = [];
  for (const grid of reportConfig.grids) {
    for (let rep = 1; rep <= REPS; rep += 1) {
      if (!completed.has(`${grid.grid_id}|${rep}`)) tasks.push({ grid, rep });
    }
  }
  const { chatCompletion, hasAnyKey } = require("../../server/llm/deepseekClient");
  if (!hasAnyKey()) throw new Error("DeepSeek API key is required");
  console.log(`[subjective_prompt_isolation] existing=${existing.length} remaining=${tasks.length}`);
  await runPool(tasks, async ({ grid, rep }, index) => {
    const common = { run_id: RUN_ID, grid: grid.grid_id, rep, status: "failed", error: "", raw_response: "" };
    let row;
    try {
      const result = await callWithRetry(chatCompletion, buildOriginalPrompt(grid.reports));
      row = {
        ...common,
        range_low: result.parsed.range[0],
        range_high: result.parsed.range[1],
        midpoint: result.parsed.midpoint,
        status: "success",
        attempts: result.attempts,
        raw_response: result.raw
      };
    } catch (error) {
      row = { ...common, error: String(error.stack || error.message || error) };
    }
    fs.appendFileSync(JSONL_PATH, `${JSON.stringify(row)}\n`);
    console.log(`[subjective_prompt_isolation] ${index + 1}/${tasks.length} ${cellKey(row)} ${row.status}`);
  });
  const rows = loadRows();
  console.log(JSON.stringify(writeOutputs(rows, reportConfig, promptTemplateSha), null, 2));
}

main().catch((error) => {
  console.error(error.stack || error.message || String(error));
  process.exitCode = 1;
});
