"use strict";

const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..", "..");
const DEFAULT_POOL_PATH = path.join(ROOT, "data", "persona_pool_random42_interface_v1", "persona_pool_v2.json");
const DEFAULT_OUTPUT_ROOT = path.join(ROOT, "runs_v4flash_0731", "persona_strategy_probe");

function loadLocalEnv() {
  const envPath = path.join(ROOT, ".env");
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/u)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const splitAt = trimmed.indexOf("=");
    if (splitAt <= 0) continue;
    const key = trimmed.slice(0, splitAt).trim();
    let value = trimmed.slice(splitAt + 1).trim();
    if ((value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!Object.prototype.hasOwnProperty.call(process.env, key)) process.env[key] = value;
  }
}

function parseArgs(argv) {
  const now = new Date().toISOString().replace(/[-:]/gu, "").replace(/\..+$/u, "Z");
  const args = {
    poolPath: DEFAULT_POOL_PATH,
    outputDir: path.join(DEFAULT_OUTPUT_ROOT, `china_strategy_preference_${now}`),
    limit: 42,
    concurrency: 10,
    seed: "20260811-persona-strategy-preference-probe"
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--pool-path") args.poolPath = path.resolve(ROOT, String(argv[++index] || "").trim());
    else if (arg === "--output-dir") args.outputDir = path.resolve(ROOT, String(argv[++index] || "").trim());
    else if (arg === "--limit") args.limit = Number(argv[++index]);
    else if (arg === "--concurrency") args.concurrency = Number(argv[++index]);
    else if (arg === "--seed") args.seed = String(argv[++index] || "").trim();
    else throw new Error(`unknown argument: ${arg}`);
  }
  if (!Number.isInteger(args.limit) || args.limit < 1) throw new Error("--limit must be a positive integer");
  if (!Number.isInteger(args.concurrency) || args.concurrency < 1) throw new Error("--concurrency must be a positive integer");
  if (!args.seed) throw new Error("--seed required");
  return args;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function appendJsonl(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.appendFileSync(filePath, `${JSON.stringify(value)}\n`, "utf8");
}

function stripFence(text) {
  const trimmed = String(text || "").trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/iu);
  return fenced ? fenced[1].trim() : trimmed;
}

function parseJsonObject(raw) {
  const text = stripFence(raw);
  const jsonCandidate = (text.match(/\{[\s\S]*\}/u) || [])[0] || text;
  return JSON.parse(jsonCandidate.replace(/,\s*([}\]])/gu, "$1"));
}

function inferChoice(raw) {
  const text = String(raw || "");
  const costHits = (text.match(/成本领先|性价比|低成本|控成本|规模|效率|便宜|价格敏感/gu) || []).length;
  const diffHits = (text.match(/差异化|独特|体验|品牌|功能|高端|溢价|不一样/gu) || []).length;
  if (costHits > diffHits) return "COST";
  if (diffHits > costHits) return "DIFF";
  return "AMBIGUOUS";
}

function normalizeChoice(value, raw) {
  const choice = String(value || "").trim().toUpperCase();
  if (["COST", "DIFF"].includes(choice)) return choice;
  if (/成本/u.test(choice)) return "COST";
  if (/差异/u.test(choice)) return "DIFF";
  return inferChoice(raw);
}

function buildPersonaText(record) {
  const surface = record.surface || {};
  const overseas = surface.overseas || {};
  return [
    `姓名：${surface.name || record.persona_id}`,
    `原型：${record.archetype_label || record.archetype || ""}`,
    `性别：${surface.gender === "male" ? "男" : surface.gender === "female" ? "女" : surface.gender || ""}`,
    `年龄：${surface.age || ""}`,
    `学历：${surface.edu || surface.education || ""}`,
    `海外经历：${overseas.hasOverseas ? `${overseas.destination || ""} ${overseas.duration || ""}`.trim() : "无"}`,
    `MBTI：${surface.mbti || ""}`,
    `表达方式：${surface.expression_style || surface.expressionStyle || ""}`
  ].filter((line) => !line.endsWith("：")).join("\n");
}

function buildMessages(record) {
  return [
    {
      role: "system",
      content: [
        "你正在扮演一个已经落盘的人设。",
        "只根据下面的人设本身回答，不要引入任何课堂任务、宠物机器人、R1/R2、团队讨论、锦囊、价格、功能选择或具体产品情境。",
        "保持这个人的说话风格。"
      ].join("\n")
    },
    {
      role: "user",
      content: [
        "人设如下：",
        buildPersonaText(record),
        "",
        "问题：不考虑任何具体任务 context，只说你自己在中国市场做商业判断时的默认战略偏好：你更偏向“成本领先”还是“差异化”？必须二选一。",
        "",
        "请输出一个 JSON 对象：",
        "{",
        "  \"choice\": \"COST 或 DIFF\",",
        "  \"confidence\": 0 到 1 的数字,",
        "  \"one_sentence\": \"用这个人的口吻说一句为什么\"",
        "}"
      ].join("\n")
    }
  ];
}

function summarize(rows) {
  const counts = { COST: 0, DIFF: 0, AMBIGUOUS: 0, ERROR: 0 };
  const byArchetype = {};
  for (const row of rows) {
    const choice = row.status === "ok" ? row.choice : "ERROR";
    counts[choice] = (counts[choice] || 0) + 1;
    const key = `${row.archetype || ""} ${row.archetype_label || ""}`.trim() || "UNKNOWN";
    if (!byArchetype[key]) byArchetype[key] = { total: 0, COST: 0, DIFF: 0, AMBIGUOUS: 0, ERROR: 0 };
    byArchetype[key].total += 1;
    byArchetype[key][choice] = (byArchetype[key][choice] || 0) + 1;
  }
  return { total: rows.length, counts, by_archetype: byArchetype };
}

async function main() {
  loadLocalEnv();
  const args = parseArgs(process.argv.slice(2));
  if (!fs.existsSync(args.poolPath)) throw new Error(`missing pool path: ${args.poolPath}`);

  const { chatCompletion, hasAnyKey } = require("../../server/llm/deepseekClient");
  const modelRegistry = require("../../server/llm/modelRegistry");
  if (!hasAnyKey()) throw new Error("missing LLM API key");

  const pool = readJson(args.poolPath);
  if (!Array.isArray(pool) || pool.length === 0) throw new Error(`pool must be a non-empty array: ${args.poolPath}`);
  const records = pool.slice(0, args.limit);
  const callsPath = path.join(args.outputDir, "calls.jsonl");
  const rows = [];
  const startedAt = new Date().toISOString();
  const startedMs = Date.now();

  fs.mkdirSync(args.outputDir, { recursive: true });
  if (fs.existsSync(callsPath)) fs.unlinkSync(callsPath);

  const { default: pLimit } = await import("p-limit");
  const limit = pLimit(args.concurrency);
  await Promise.all(records.map((record, index) => limit(async () => {
    const startedCallMs = Date.now();
    const rowBase = {
      ts: new Date().toISOString(),
      index: index + 1,
      persona_id: record.persona_id,
      archetype: record.archetype,
      archetype_label: record.archetype_label,
      name: record.surface?.name || ""
    };
    try {
      const raw = await chatCompletion(buildMessages(record), {
        role: "chat_service",
        temperature: 0.7,
        max_tokens: 260,
        timeoutMs: 60000,
        response_format: { type: "json_object" }
      });
      let parsed = null;
      let choice = "AMBIGUOUS";
      try {
        parsed = parseJsonObject(raw);
        choice = normalizeChoice(parsed.choice, raw);
      } catch (parseError) {
        choice = inferChoice(raw);
        parsed = { parse_error: String(parseError?.message || parseError) };
      }
      const row = {
        ...rowBase,
        status: "ok",
        choice,
        confidence: Number.isFinite(Number(parsed?.confidence)) ? Number(parsed.confidence) : null,
        one_sentence: String(parsed?.one_sentence || "").trim(),
        latency_ms: Date.now() - startedCallMs,
        raw
      };
      rows.push(row);
      appendJsonl(callsPath, row);
    } catch (error) {
      const row = {
        ...rowBase,
        status: "error",
        choice: "ERROR",
        confidence: null,
        one_sentence: "",
        latency_ms: Date.now() - startedCallMs,
        error: String(error?.stack || error?.message || error)
      };
      rows.push(row);
      appendJsonl(callsPath, row);
    }
  })));

  rows.sort((a, b) => a.index - b.index);
  const summary = {
    probe: "persona_strategy_preference_china_no_task_context",
    seed: args.seed,
    started_at: startedAt,
    finished_at: new Date().toISOString(),
    wall_clock_ms: Date.now() - startedMs,
    provider: modelRegistry.getProvider(),
    model: modelRegistry.getModel("chat_service"),
    base_url_host: new URL(modelRegistry.getBaseUrl()).host,
    pool_path: path.relative(ROOT, args.poolPath),
    output_dir: path.relative(ROOT, args.outputDir),
    prompt_guardrail: "persona only; no task context, robot, R1/R2, team discussion, jinang, price, feature selection, or product scenario",
    ...summarize(rows)
  };

  writeJson(path.join(args.outputDir, "rows.json"), rows);
  writeJson(path.join(args.outputDir, "summary.json"), summary);
  console.log(JSON.stringify(summary, null, 2));
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.stack || error.message || String(error));
    process.exitCode = 1;
  });
}
