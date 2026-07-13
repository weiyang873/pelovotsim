"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { spawnSync } = require("node:child_process");

const ROOT = path.join(__dirname, "..", "..");
const REPORTS_PATH = path.join(ROOT, "game_config_v0.1", "persona_reports_v1.1.json");
const MAP_PATHS = {
  "草根老板": path.join(__dirname, "cognitive_map_caogen_min.json"),
  "二代接班人": path.join(__dirname, "cognitive_map_erdai_min.json")
};
const REPORT_GRID = "B2B_Differentiation_Elder";
const RUN_ID = "map_bench_min_v1_2026-07-13";
const TEMPERATURE = 0.45;
const MAX_OUTPUT_REPAIRS = 2;
const CONDITIONS = ["M", "C"];
const ARCHETYPES = ["草根老板", "二代接班人"];
const THEME_RULES = [
  ["人力替代与ROI", /人力|护工|替代|回本|投入产出|ROI/i],
  ["可靠性与试用验证", /稳定|可靠|误报|试用|验证|退回/i],
  ["采购审批与风险", /审批|总部|采购流程|决策链|风险|谨慎/i],
  ["差异化与品质溢价", /差异|独特|品质|溢价|做工|材质|故事/i],
  ["隐私、尊严与排斥", /隐私|尊严|监控|排斥|侵入|佩戴/i],
  ["夜间安全与事故", /夜间|安全|跌倒|离床|事故|突发/i],
  ["情绪陪伴与互动", /情绪|陪伴|发呆|黄昏|互动|唱歌/i],
  ["现金流、价格与租赁", /现金|账期|价格|预算|租赁|付款/i],
  ["口碑、展示与合规", /口碑|家属|合规|补贴|展示|续住|声誉/i]
];

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

function fileSha256(filePath) {
  return sha256(fs.readFileSync(filePath));
}

function parseArgs(argv) {
  const args = { runId: RUN_ID, reps: 10, concurrency: 4, summarizeOnly: false };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--run-id") args.runId = String(argv[++index] || "").trim();
    else if (argv[index] === "--reps") args.reps = Number(argv[++index]);
    else if (argv[index] === "--concurrency") args.concurrency = Number(argv[++index]);
    else if (argv[index] === "--summarize-only") args.summarizeOnly = true;
    else throw new Error(`unknown argument: ${argv[index]}`);
  }
  if (!args.runId || !Number.isInteger(args.reps) || args.reps < 1 || !Number.isInteger(args.concurrency) || args.concurrency < 1) {
    throw new Error("invalid run id, reps, or concurrency");
  }
  return args;
}

function outputPaths(runId) {
  return {
    jsonl: path.join(__dirname, `${runId}.jsonl`),
    csv: path.join(__dirname, "map_bench_min_results.csv"),
    summary: path.join(__dirname, "map_bench_min_summary.md"),
    meta: path.join(__dirname, "map_bench_min_meta.json")
  };
}

function loadMaterials() {
  const reportConfig = JSON.parse(fs.readFileSync(REPORTS_PATH, "utf8"));
  const reportGrid = (reportConfig.grids || []).find((entry) => entry.grid_id === REPORT_GRID);
  if (!reportGrid || !Array.isArray(reportGrid.reports) || reportGrid.reports.length === 0) {
    throw new Error(`missing reports for ${REPORT_GRID}`);
  }
  const reportsText = reportGrid.reports.map((report, index) => [
    `### 报告 ${index + 1}：${report.persona_id}`,
    String(report.report_text || "").trim()
  ].join("\n")).join("\n\n");
  const maps = Object.fromEntries(ARCHETYPES.map((archetype) => {
    const items = JSON.parse(fs.readFileSync(MAP_PATHS[archetype], "utf8"));
    if (!Array.isArray(items) || items.length !== 50) throw new Error(`${archetype}: expected 50 map rows`);
    return [archetype, items];
  }));
  return { reportsText, reportCount: reportGrid.reports.length, maps };
}

function renderMap(items) {
  return items.map((item) => `- ${item.id}［${item.type}］${item.content}`).join("\n");
}

function buildPrompt(archetype, condition, materials) {
  const withMap = condition === "M";
  const parts = [
    `你是一位"${archetype}"型的企业管理者。`
  ];
  if (withMap) {
    parts.push("【你的人生经验】", renderMap(materials.maps[archetype]));
  }
  parts.push(
    "【局面】",
    materials.reportsText,
    "你要向养老院销售一款陪伴机器人，可定价范围 1000-6000 元。",
    "【任务】赚最多的钱。"
  );
  if (withMap) {
    parts.push(
      "第一步：这件事里真正卡脖子的是什么？最多三条，每条注明来自你哪条经历（引用 id）。",
      "第二步：给出定价和理由。",
      '输出 JSON：{"constraints": [{"text": "...", "source": "map_xx"}], "price": 数字, "reasoning": "..."}'
    );
  } else {
    parts.push(
      "第一步：这件事里真正卡脖子的是什么？最多三条。",
      "第二步：给出定价和理由。",
      '输出 JSON：{"constraints": [{"text": "..."}], "price": 数字, "reasoning": "..."}'
    );
  }
  parts.push("只输出可 JSON.parse 的 JSON，不要 Markdown，不要额外文字。");
  return parts.join("\n");
}

function parseJsonObject(raw) {
  const text = String(raw || "").replace(/```json|```/gi, "").trim();
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  return JSON.parse(start >= 0 && end > start ? text.slice(start, end + 1) : text);
}

function validateResponse(raw, archetype, condition, maps) {
  const parsed = parseJsonObject(raw);
  if (!Array.isArray(parsed.constraints)) throw new Error("constraints must be an array");
  const constraints = parsed.constraints.map((constraint) => ({
    text: String(constraint?.text || "").trim(),
    ...(condition === "M" ? { source: String(constraint?.source || "").trim() } : {})
  }));
  if (!Number.isFinite(Number(parsed.price))) throw new Error("price must be numeric");
  if (typeof parsed.reasoning !== "string") throw new Error("reasoning must be a string");
  if (condition === "M") {
    const validIds = new Set(maps[archetype].map((item) => item.id));
    const invalidSources = constraints.map((item) => item.source).filter((source) => !validIds.has(source));
    if (invalidSources.length > 0) throw new Error(`invalid map source id(s): ${invalidSources.join(", ")}`);
  }
  return {
    constraints,
    price: Number(parsed.price),
    reasoning: parsed.reasoning
  };
}

async function runCell(chatCompletion, task, materials, runId) {
  const prompt = buildPrompt(task.archetype, task.condition, materials);
  let messages = [{ role: "user", content: prompt }];
  let raw = "";
  let lastError = null;
  for (let attempt = 0; attempt <= MAX_OUTPUT_REPAIRS; attempt += 1) {
    try {
      raw = await chatCompletion(messages, {
        temperature: TEMPERATURE,
        max_tokens: 1200,
        maxRetries: 1
      });
      const parsed = validateResponse(raw, task.archetype, task.condition, materials.maps);
      return {
        run_id: runId,
        created_at: new Date().toISOString(),
        persona: task.archetype,
        condition: task.condition,
        rep: task.rep,
        status: "OK",
        constraints: parsed.constraints,
        price: parsed.price,
        reasoning: parsed.reasoning,
        raw_response: raw,
        attempts: attempt + 1,
        prompt_sha256: sha256(prompt),
        error: ""
      };
    } catch (error) {
      lastError = error;
      if (attempt < MAX_OUTPUT_REPAIRS) {
        messages = [
          { role: "user", content: prompt },
          { role: "assistant", content: raw || "(空输出)" },
          {
            role: "user",
            content: `上一次输出无法使用：${error.message || error}。请只修正为要求的合法 JSON；M 条件的 source 必须引用上方真实存在的地图 id。`
          }
        ];
      }
    }
  }
  return {
    run_id: runId,
    created_at: new Date().toISOString(),
    persona: task.archetype,
    condition: task.condition,
    rep: task.rep,
    status: "FAIL",
    constraints: [],
    price: null,
    reasoning: "",
    raw_response: raw,
    attempts: MAX_OUTPUT_REPAIRS + 1,
    prompt_sha256: sha256(prompt),
    error: String(lastError?.message || lastError || "unknown error")
  };
}

function cellKey(row) {
  return `${row.persona}|${row.condition}|${row.rep}`;
}

function loadJsonl(filePath) {
  if (!fs.existsSync(filePath)) return [];
  return fs.readFileSync(filePath, "utf8").split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
}

function appendJsonl(filePath, row) {
  fs.appendFileSync(filePath, `${JSON.stringify(row)}\n`, "utf8");
}

async function runPool(tasks, concurrency, worker) {
  let cursor = 0;
  async function lane() {
    while (true) {
      const index = cursor;
      cursor += 1;
      if (index >= tasks.length) return;
      await worker(tasks[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, tasks.length) }, () => lane()));
}

function csvEscape(value) {
  const text = value == null ? "" : (typeof value === "string" ? value : JSON.stringify(value));
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function writeCsv(filePath, rows) {
  const headers = ["persona", "condition", "rep", "status", "constraints", "price", "reasoning", "attempts", "error"];
  const lines = [headers.join(",")];
  for (const row of rows) lines.push(headers.map((header) => csvEscape(row[header])).join(","));
  fs.writeFileSync(filePath, `${lines.join("\n")}\n`, "utf8");
}

function groupRows(rows, archetype, condition) {
  return rows.filter((row) => row.persona === archetype && row.condition === condition && row.status === "OK");
}

function priceStats(rows) {
  const prices = rows.map((row) => Number(row.price)).filter(Number.isFinite);
  return {
    n: prices.length,
    mean: prices.length ? prices.reduce((sum, price) => sum + price, 0) / prices.length : null,
    min: prices.length ? Math.min(...prices) : null,
    max: prices.length ? Math.max(...prices) : null
  };
}

function themeFrequency(rows) {
  return THEME_RULES.map(([theme, pattern]) => ({
    theme,
    count: rows.filter((row) => pattern.test((row.constraints || []).map((item) => item.text).join(" "))).length
  })).filter((item) => item.count > 0).sort((a, b) => b.count - a.count || a.theme.localeCompare(b.theme, "zh-CN"));
}

function formatNumber(value) {
  return Number.isFinite(value) ? Number(value.toFixed(2)).toLocaleString("en-US") : "N/A";
}

function writeSummary(filePath, rows, meta) {
  const lines = [
    "# Cognitive Map Minimal Bench",
    "",
    `- Run: \`${meta.runId}\``,
    `- Git commit: \`${meta.gitCommit}\``,
    `- Completed: ${rows.filter((row) => row.status === "OK").length}/40`,
    `- Failed: ${rows.filter((row) => row.status !== "OK").length}/40`,
    "",
    "## Price Summary",
    "",
    "| Persona | Condition | N | Mean | Range |",
    "|---|---|---:|---:|---:|"
  ];
  for (const archetype of ARCHETYPES) {
    for (const condition of CONDITIONS) {
      const stats = priceStats(groupRows(rows, archetype, condition));
      lines.push(`| ${archetype} | ${condition} | ${stats.n} | ${formatNumber(stats.mean)} | ${formatNumber(stats.min)}-${formatNumber(stats.max)} |`);
    }
  }
  lines.push("", "## Constraint Themes", "");
  for (const archetype of ARCHETYPES) {
    for (const condition of CONDITIONS) {
      const frequencies = themeFrequency(groupRows(rows, archetype, condition));
      lines.push(`- **${archetype} / ${condition}**: ${frequencies.map((item) => `${item.theme} ${item.count}/10`).join("; ") || "none"}`);
    }
  }
  lines.push("", "## Decision", "", "> PENDING MANUAL REVIEW", "", "## Raw Samples", "");
  for (const archetype of ARCHETYPES) {
    for (const condition of CONDITIONS) {
      const sample = groupRows(rows, archetype, condition)[0];
      lines.push(`### ${archetype} / ${condition}`, "", "```json", sample?.raw_response || "NO SUCCESSFUL SAMPLE", "```", "");
    }
  }
  fs.writeFileSync(filePath, `${lines.join("\n")}\n`, "utf8");
}

function writeOutputs(paths, rows, args, materials) {
  const ordered = rows.slice().sort((a, b) => (
    ARCHETYPES.indexOf(a.persona) - ARCHETYPES.indexOf(b.persona) ||
    CONDITIONS.indexOf(a.condition) - CONDITIONS.indexOf(b.condition) ||
    Number(a.rep) - Number(b.rep)
  ));
  const gitCommit = spawnSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).stdout.trim();
  const meta = {
    runId: args.runId,
    createdAt: new Date().toISOString(),
    gitCommit,
    scriptSha256: fileSha256(__filename),
    personaReportsFile: path.relative(ROOT, REPORTS_PATH),
    personaReportsSha256: fileSha256(REPORTS_PATH),
    reportGrid: REPORT_GRID,
    reportCount: materials.reportCount,
    maps: Object.fromEntries(ARCHETYPES.map((archetype) => [archetype, {
      file: path.relative(ROOT, MAP_PATHS[archetype]),
      sha256: fileSha256(MAP_PATHS[archetype])
    }])),
    temperature: TEMPERATURE,
    requestedCells: ARCHETYPES.length * CONDITIONS.length * args.reps,
    completedCells: ordered.filter((row) => row.status === "OK").length,
    failedCells: ordered.filter((row) => row.status !== "OK").length,
    promptSha256: Object.fromEntries(ARCHETYPES.flatMap((archetype) => CONDITIONS.map((condition) => [
      `${archetype}_${condition}`,
      sha256(buildPrompt(archetype, condition, materials))
    ])))
  };
  writeCsv(paths.csv, ordered);
  writeSummary(paths.summary, ordered, meta);
  fs.writeFileSync(paths.meta, `${JSON.stringify(meta, null, 2)}\n`, "utf8");
  return meta;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const paths = outputPaths(args.runId);
  loadLocalEnv();
  const materials = loadMaterials();
  let rows = loadJsonl(paths.jsonl).filter((row) => row.run_id === args.runId);
  if (!args.summarizeOnly) {
    const { chatCompletion, hasAnyKey } = require("../../server/llm/deepseekClient");
    if (!hasAnyKey()) throw new Error("DeepSeek API key is required");
    const completed = new Set(rows.map(cellKey));
    const tasks = [];
    for (const archetype of ARCHETYPES) {
      for (const condition of CONDITIONS) {
        for (let rep = 1; rep <= args.reps; rep += 1) {
          const task = { archetype, condition, rep };
          if (!completed.has(cellKey({ persona: archetype, condition, rep }))) tasks.push(task);
        }
      }
    }
    console.log(`[map_bench_min] existing=${rows.length} remaining=${tasks.length} concurrency=${args.concurrency}`);
    await runPool(tasks, args.concurrency, async (task, index) => {
      const row = await runCell(chatCompletion, task, materials, args.runId);
      appendJsonl(paths.jsonl, row);
      console.log(`[map_bench_min] ${index + 1}/${tasks.length} ${cellKey(row)} ${row.status} attempts=${row.attempts}`);
    });
    rows = loadJsonl(paths.jsonl).filter((row) => row.run_id === args.runId);
  }
  const meta = writeOutputs(paths, rows, args, materials);
  console.log(JSON.stringify({ paths, meta }, null, 2));
}

main().catch((error) => {
  console.error(error.stack || error.message || String(error));
  process.exitCode = 1;
});
