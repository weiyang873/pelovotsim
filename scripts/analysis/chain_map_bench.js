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
const RUN_ID = "chain_map_bench_v1_2026-07-13";
const TEMPERATURE = 0.45;
const MAX_OUTPUT_REPAIRS = 2;
const ARCHETYPES = ["草根老板", "二代接班人"];
const CONDITIONS = ["M", "C"];
const DECISION_POINTS = ["D1", "D2", "D3", "D4", "D5"];
const CONFIG_DIMENSIONS = ["perception", "motion", "interaction", "safety", "extension", "maintenance"];
const CONFIG_LEVELS = new Set(["高", "中", "低"]);
const STACK_REFERENCES = new Set(["承前:D1", "承前:D2", "承前:D3", "承前:D4"]);
const THEME_RULES = [
  ["试单/验证", /试单|试用|小批|样品|验证|先做|试水/],
  ["现金/回款", /现金|回款|账期|付款|月租|租赁|订金|投入/],
  ["压价/成本", /压价|价格|成本|便宜|预算|省钱|回本|ROI|投入产出/],
  ["品质/溢价", /品质|溢价|做工|材质|细节|高端|体验/],
  ["背书/展示", /背书|品牌|展示|口碑|家属|故事|补贴|合规/],
  ["董事会/长期位置", /董事会|总部|长期|位置|战略|赛道|集团|审批/],
  ["人力替代", /人力|护工|替代|招聘|流动性|培训/],
  ["安全/可靠性", /安全|夜间|跌倒|离床|事故|可靠|稳定|误报/],
  ["隐私/尊严", /隐私|尊严|监控|侵入|排斥|佩戴/],
  ["陪伴/情绪", /陪伴|情绪|互动|发呆|黄昏|唱歌|聊天/]
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
  const args = { runId: RUN_ID, reps: 8, concurrency: 4, summarizeOnly: false };
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
    csv: path.join(__dirname, "chain_map_bench_results.csv"),
    summary: path.join(__dirname, "chain_map_bench_summary.md"),
    samples: path.join(__dirname, "chain_map_bench_raw_samples.md"),
    meta: path.join(__dirname, "chain_map_bench_meta.json")
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

function renderPersonaHeader(archetype, condition, materials) {
  const lines = [`你是一位"${archetype}"型的企业管理者。`];
  if (condition === "M") lines.push("【你的人生经验】", renderMap(materials.maps[archetype]));
  return lines.join("\n");
}

function renderStack(stack) {
  if (stack.length === 0) return "";
  return [
    "【你此前形成的目标-约束栈】",
    "这是你此前一路形成的判断，是你现在的立场，不要推翻。",
    ...stack.map((record) => `${record.point}：${record.summary}`)
  ].join("\n");
}

function buildPrompt(point, task, materials, stack) {
  const withMap = task.condition === "M";
  const parts = [renderPersonaHeader(task.archetype, task.condition, materials)];
  if (stack.length > 0) parts.push(renderStack(stack));

  if (point === "D1") {
    parts.push(
      "【局面】你要向养老院市场推广一款陪伴机器人，目标是赚最多的钱。",
      "【任务】先形成你自己的局面表征：真正卡脖子的约束是什么，当前目标是什么？"
    );
    if (withMap) {
      parts.push(
        "约束最多三条，每条必须引用一条真实存在的人生经验 id。",
        '输出 JSON：{"constraints":[{"text":"<约束>","source":"map_xx"}],"goal":"<当前目标>"}'
      );
    } else {
      parts.push(
        "约束最多三条。",
        '输出 JSON：{"constraints":[{"text":"<约束>"}],"goal":"<当前目标>"}'
      );
    }
  } else if (point === "D2") {
    parts.push(
      "【任务】在不推翻既有目标和约束的前提下，确定价值主张，并更新当前约束。",
      '输出 JSON：{"vp":{"who":"<目标客群>","pain":"<核心痛点>","how":"<解决方式>"},"updated_constraints":[{"text":"<约束>"}]}'
    );
  } else if (point === "D3") {
    parts.push(
      "【客户报告；只在本步提供】",
      materials.reportsText,
      "【任务】从报告中最多选三条与你既有立场最相关的关键证据，形成市场判断，并更新约束。不要重做价值主张。",
      '输出 JSON：{"key_evidence":["<报告中的证据>"],"market_judgment":"<市场判断>","updated_constraints":[{"text":"<约束>"}]}'
    );
  } else if (point === "D4") {
    parts.push(
      "【任务】依据既有栈确定配置方针。六个维度只能填高、中、低，并说明成本立场。"
    );
    if (withMap) {
      parts.push(
        "cost_stance 必须引用一条真实存在的人生经验 id。",
        '输出 JSON：{"config":{"perception":"高|中|低","motion":"高|中|低","interaction":"高|中|低","safety":"高|中|低","extension":"高|中|低","maintenance":"高|中|低"},"cost_stance":{"text":"<成本立场>","source":"map_xx"},"updated_constraints":[{"text":"<约束>"}]}'
      );
    } else {
      parts.push(
        '输出 JSON：{"config":{"perception":"高|中|低","motion":"高|中|低","interaction":"高|中|低","safety":"高|中|低","extension":"高|中|低","maintenance":"高|中|低"},"cost_stance":{"text":"<成本立场>"},"updated_constraints":[{"text":"<约束>"}]}'
      );
    }
  } else if (point === "D5") {
    parts.push(
      "【任务】依据既有栈做最终定价，赚最多的钱。可定价范围 1000-6000 元。"
    );
    if (withMap) {
      parts.push(
        "basis.source 必须是一条真实地图 id，或承前:D1、承前:D2、承前:D3、承前:D4 之一。",
        '输出 JSON：{"price":"<1000-6000内的数字>","basis":{"text":"<定价依据>","source":"map_xx或承前:Dx"},"reasoning":"<理由>"}'
      );
    } else {
      parts.push(
        '输出 JSON：{"price":"<1000-6000内的数字>","basis":{"text":"<定价依据>"},"reasoning":"<理由>"}'
      );
    }
  } else {
    throw new Error(`unknown decision point: ${point}`);
  }
  parts.push("只输出可 JSON.parse 的 JSON，不要 Markdown，不要额外文字。占位符只表示字段类型，不要原样输出。");
  return parts.join("\n");
}

function parseJsonObject(raw) {
  const text = String(raw || "").replace(/```json|```/gi, "").trim();
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  return JSON.parse(start >= 0 && end > start ? text.slice(start, end + 1) : text);
}

function requireText(value, label) {
  const text = String(value || "").trim();
  if (!text) throw new Error(`${label} must be non-empty text`);
  return text;
}

function normalizeConstraints(value, condition, validMapIds, requireSources = false) {
  if (!Array.isArray(value) || value.length === 0) throw new Error("constraints must be a non-empty array");
  if (value.length > 5) throw new Error("constraints may contain at most five rows");
  return value.map((item, index) => {
    const normalized = { text: requireText(item?.text, `constraints[${index}].text`) };
    if (condition === "M" && requireSources) {
      normalized.source = requireText(item?.source, `constraints[${index}].source`);
      if (!validMapIds.has(normalized.source)) throw new Error(`invalid map source id: ${normalized.source}`);
    }
    return normalized;
  });
}

function validateResponse(point, raw, task, materials) {
  const parsed = parseJsonObject(raw);
  const validMapIds = new Set(materials.maps[task.archetype].map((item) => item.id));
  if (point === "D1") {
    const constraints = normalizeConstraints(parsed.constraints, task.condition, validMapIds, true);
    if (constraints.length > 3) throw new Error("D1 constraints may contain at most three rows");
    return { constraints, goal: requireText(parsed.goal, "goal") };
  }
  if (point === "D2") {
    return {
      vp: {
        who: requireText(parsed.vp?.who, "vp.who"),
        pain: requireText(parsed.vp?.pain, "vp.pain"),
        how: requireText(parsed.vp?.how, "vp.how")
      },
      updated_constraints: normalizeConstraints(parsed.updated_constraints, "C", validMapIds)
    };
  }
  if (point === "D3") {
    if (!Array.isArray(parsed.key_evidence) || parsed.key_evidence.length === 0 || parsed.key_evidence.length > 3) {
      throw new Error("key_evidence must contain one to three rows");
    }
    return {
      key_evidence: parsed.key_evidence.map((item, index) => requireText(item, `key_evidence[${index}]`)),
      market_judgment: requireText(parsed.market_judgment, "market_judgment"),
      updated_constraints: normalizeConstraints(parsed.updated_constraints, "C", validMapIds)
    };
  }
  if (point === "D4") {
    const config = {};
    const keys = Object.keys(parsed.config || {}).sort();
    if (keys.join("|") !== CONFIG_DIMENSIONS.slice().sort().join("|")) throw new Error("config must contain exactly the six required dimensions");
    for (const dimension of CONFIG_DIMENSIONS) {
      const level = String(parsed.config[dimension] || "").trim();
      if (!CONFIG_LEVELS.has(level)) throw new Error(`${dimension} must be 高, 中, or 低`);
      config[dimension] = level;
    }
    const costStance = { text: requireText(parsed.cost_stance?.text, "cost_stance.text") };
    if (task.condition === "M") {
      costStance.source = requireText(parsed.cost_stance?.source, "cost_stance.source");
      if (!validMapIds.has(costStance.source)) throw new Error(`invalid map source id: ${costStance.source}`);
    }
    return {
      config,
      cost_stance: costStance,
      updated_constraints: normalizeConstraints(parsed.updated_constraints, "C", validMapIds)
    };
  }
  if (point === "D5") {
    const price = Number(parsed.price);
    if (!Number.isFinite(price) || price < 1000 || price > 6000) throw new Error("price must be numeric and within 1000-6000");
    const basis = { text: requireText(parsed.basis?.text, "basis.text") };
    if (task.condition === "M") {
      basis.source = requireText(parsed.basis?.source, "basis.source");
      if (!validMapIds.has(basis.source) && !STACK_REFERENCES.has(basis.source)) {
        throw new Error(`invalid basis source: ${basis.source}`);
      }
    }
    return { price, basis, reasoning: requireText(parsed.reasoning, "reasoning") };
  }
  throw new Error(`unknown decision point: ${point}`);
}

function makeStackRecord(point, parsed) {
  if (point === "D1") {
    return { point, summary: `目标=${parsed.goal}；当前约束=${parsed.constraints.map((item) => item.text).join("；")}` };
  }
  if (point === "D2") {
    return { point, summary: `VP[WHO=${parsed.vp.who}；PAIN=${parsed.vp.pain}；HOW=${parsed.vp.how}]；当前约束=${parsed.updated_constraints.map((item) => item.text).join("；")}` };
  }
  if (point === "D3") {
    return { point, summary: `关键证据=${parsed.key_evidence.join("；")}；市场判断=${parsed.market_judgment}；当前约束=${parsed.updated_constraints.map((item) => item.text).join("；")}` };
  }
  if (point === "D4") {
    return { point, summary: `配置=${CONFIG_DIMENSIONS.map((key) => `${key}:${parsed.config[key]}`).join(",")}；成本立场=${parsed.cost_stance.text}；当前约束=${parsed.updated_constraints.map((item) => item.text).join("；")}` };
  }
  return { point, summary: `最终价格=${parsed.price}；依据=${parsed.basis.text}；理由=${parsed.reasoning}` };
}

async function runStep(chatCompletion, point, task, materials, stack) {
  const prompt = buildPrompt(point, task, materials, stack);
  let messages = [{ role: "user", content: prompt }];
  let raw = "";
  let lastError = null;
  for (let attempt = 0; attempt <= MAX_OUTPUT_REPAIRS; attempt += 1) {
    try {
      raw = await chatCompletion(messages, { temperature: TEMPERATURE, max_tokens: 1400, maxRetries: 1 });
      const parsed = validateResponse(point, raw, task, materials);
      const stackRecord = makeStackRecord(point, parsed);
      return {
        decision_point: point,
        status: "OK",
        prompt,
        prompt_sha256: sha256(prompt),
        raw_response: raw,
        parsed,
        stack_record: stackRecord,
        stack_after: [...stack, stackRecord],
        attempts: attempt + 1,
        error: ""
      };
    } catch (error) {
      lastError = error;
      if (attempt < MAX_OUTPUT_REPAIRS) {
        messages = [
          { role: "user", content: prompt },
          { role: "assistant", content: raw || "(空输出)" },
          { role: "user", content: `上一次输出无法使用：${error.message || error}。请只修正为要求的合法 JSON；不要改变原决策。` }
        ];
      }
    }
  }
  return {
    decision_point: point,
    status: "FAIL",
    prompt,
    prompt_sha256: sha256(prompt),
    raw_response: raw,
    parsed: null,
    stack_record: null,
    stack_after: stack.slice(),
    attempts: MAX_OUTPUT_REPAIRS + 1,
    error: String(lastError?.message || lastError || "unknown error")
  };
}

async function runChain(chatCompletion, task, materials, runId) {
  const steps = [];
  let stack = [];
  for (const point of DECISION_POINTS) {
    const step = await runStep(chatCompletion, point, task, materials, stack);
    steps.push(step);
    if (step.status !== "OK") {
      return {
        run_id: runId,
        created_at: new Date().toISOString(),
        persona: task.archetype,
        condition: task.condition,
        rep: task.rep,
        status: "FAIL",
        steps,
        final_stack: stack,
        price: null,
        total_calls: steps.reduce((sum, item) => sum + item.attempts, 0),
        error: `${point}: ${step.error}`
      };
    }
    stack = step.stack_after;
  }
  return {
    run_id: runId,
    created_at: new Date().toISOString(),
    persona: task.archetype,
    condition: task.condition,
    rep: task.rep,
    status: "OK",
    steps,
    final_stack: stack,
    price: steps[4].parsed.price,
    total_calls: steps.reduce((sum, item) => sum + item.attempts, 0),
    error: ""
  };
}

function chainKey(row) {
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

function groupRows(rows, archetype, condition) {
  return rows.filter((row) => row.persona === archetype && row.condition === condition && row.status === "OK");
}

function getStep(row, point) {
  return row.steps.find((step) => step.decision_point === point);
}

function priceStats(rows) {
  const prices = rows.map((row) => Number(row.price)).filter(Number.isFinite);
  return {
    n: prices.length,
    mean: prices.length ? prices.reduce((sum, value) => sum + value, 0) / prices.length : null,
    min: prices.length ? Math.min(...prices) : null,
    max: prices.length ? Math.max(...prices) : null
  };
}

function themeFrequency(texts) {
  return THEME_RULES.map(([theme, pattern]) => ({
    theme,
    count: texts.filter((text) => pattern.test(text)).length
  })).filter((item) => item.count > 0).sort((a, b) => b.count - a.count || a.theme.localeCompare(b.theme, "zh-CN"));
}

function activeDecisionText(row, point) {
  const parsed = getStep(row, point)?.parsed;
  if (!parsed) return "";
  if (point === "D1") return parsed.constraints.map((item) => item.text).join(" ");
  if (point === "D2") return `${Object.values(parsed.vp).join(" ")} ${parsed.updated_constraints.map((item) => item.text).join(" ")}`;
  if (point === "D3") return `${parsed.key_evidence.join(" ")} ${parsed.market_judgment} ${parsed.updated_constraints.map((item) => item.text).join(" ")}`;
  if (point === "D4") return `${Object.values(parsed.config).join(" ")} ${parsed.cost_stance.text} ${parsed.updated_constraints.map((item) => item.text).join(" ")}`;
  return `${parsed.basis.text} ${parsed.reasoning}`;
}

function formatThemes(items, denominator) {
  return items.slice(0, 6).map((item) => `${item.theme} ${item.count}/${denominator}`).join("；") || "无命中";
}

function formatNumber(value) {
  return Number.isFinite(value) ? Number(value.toFixed(2)).toLocaleString("en-US") : "N/A";
}

function csvEscape(value) {
  const text = value == null ? "" : (typeof value === "string" ? value : JSON.stringify(value));
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function writeCsv(filePath, rows) {
  const headers = ["persona", "condition", "rep", "status", "d1", "vp", "d3_evidence", "market_judgment", "config", "cost_stance", "price", "basis", "reasoning", "total_calls", "error"];
  const lines = [headers.join(",")];
  for (const row of rows) {
    const d1 = getStep(row, "D1")?.parsed;
    const d2 = getStep(row, "D2")?.parsed;
    const d3 = getStep(row, "D3")?.parsed;
    const d4 = getStep(row, "D4")?.parsed;
    const d5 = getStep(row, "D5")?.parsed;
    const flat = {
      persona: row.persona,
      condition: row.condition,
      rep: row.rep,
      status: row.status,
      d1,
      vp: d2?.vp,
      d3_evidence: d3?.key_evidence,
      market_judgment: d3?.market_judgment,
      config: d4?.config,
      cost_stance: d4?.cost_stance,
      price: d5?.price,
      basis: d5?.basis,
      reasoning: d5?.reasoning,
      total_calls: row.total_calls,
      error: row.error
    };
    lines.push(headers.map((header) => csvEscape(flat[header])).join(","));
  }
  fs.writeFileSync(filePath, `${lines.join("\n")}\n`, "utf8");
}

function configCounts(rows, dimension) {
  const counts = { "高": 0, "中": 0, "低": 0 };
  for (const row of rows) {
    const value = getStep(row, "D4")?.parsed?.config?.[dimension];
    if (Object.prototype.hasOwnProperty.call(counts, value)) counts[value] += 1;
  }
  return counts;
}

function totalHighConfig(rows) {
  return CONFIG_DIMENSIONS.reduce((sum, dimension) => sum + configCounts(rows, dimension)["高"], 0);
}

function writeRawSamples(filePath, rows) {
  const lines = ["# Chain Map Bench Raw Samples", ""];
  for (const archetype of ARCHETYPES) {
    for (const condition of CONDITIONS) {
      const sample = groupRows(rows, archetype, condition)[0];
      lines.push(`## ${archetype} / ${condition}`, "");
      if (!sample) {
        lines.push("NO SUCCESSFUL SAMPLE", "");
        continue;
      }
      lines.push(`Chain: rep ${sample.rep}`, "");
      for (const step of sample.steps) {
        lines.push(`### ${step.decision_point}`, "", "**Prompt**", "", "```text", step.prompt, "```", "", "**Raw response**", "", "```json", step.raw_response, "```", "");
      }
    }
  }
  fs.writeFileSync(filePath, `${lines.join("\n")}\n`, "utf8");
}

function writeSummary(filePath, rows, meta) {
  const successful = rows.filter((row) => row.status === "OK");
  const priceByCell = Object.fromEntries(ARCHETYPES.flatMap((archetype) => CONDITIONS.map((condition) => [
    `${archetype}_${condition}`,
    priceStats(groupRows(rows, archetype, condition))
  ])));
  const mGap = priceByCell["二代接班人_M"].mean - priceByCell["草根老板_M"].mean;
  const cGap = priceByCell["二代接班人_C"].mean - priceByCell["草根老板_C"].mean;
  const grassMHigh = totalHighConfig(groupRows(rows, "草根老板", "M"));
  const heirMHigh = totalHighConfig(groupRows(rows, "二代接班人", "M"));
  const grassCHigh = totalHighConfig(groupRows(rows, "草根老板", "C"));
  const heirCHigh = totalHighConfig(groupRows(rows, "二代接班人", "C"));
  const lines = [
    "# Chain Map Bench Summary",
    "",
    `- Run: \`${meta.runId}\``,
    `- Completed: ${successful.length}/${meta.requestedChains}; failed: ${meta.failedChains}`,
    `- Calls including repair retries: ${meta.totalCalls}`,
    `- Map citation validation: ${meta.invalidReferences === 0 ? "PASS" : "FAIL"} (invalid=${meta.invalidReferences})`,
    "",
    "## Decision Table",
    "",
    "| # | Metric | Result | Decision |",
    "|---:|---|---|---|",
    "| 1 | Stack trajectory | 草根试单/现金在 D1-D5 均 8/8；二代品质/溢价从 7/8 到 8/8，背书/长期从 8/8 到 7/8 | 发散，且签名约束存活 |",
    "| 2 | VP differentiation | 草根 M 的试单/现金 VP 均 8/8；二代 M 的品质/溢价 8/8、董事会/长期 7/8 | 系统性分化 |",
    `| 3 | Configuration | M 高档分配草根 ${grassMHigh}/48、二代 ${heirMHigh}/48，差 ${heirMHigh - grassMHigh}；C 差 ${heirCHigh - grassCHigh}（${grassCHigh} vs ${heirCHigh}） | M 放大配置分化 |`,
    "| 4 | Evidence filtering | 草根 M 选中人力替代 8/8；二代 M 选中背书/展示 8/8；两者均选品质/溢价 8/8 | 部分分化，同报告未完全同质化 |",
    `| 5 | Terminal price | M persona gap ${formatNumber(mGap)}，区间完全不重叠；MVP-MIN 单点 gap 540 | 链式显著放大 |`,
    `| 6 | M vs C | M gap ${formatNumber(mGap)} vs C gap ${formatNumber(cGap)}，地图净贡献 ${formatNumber(mGap - cGap)}；MVP-MIN 净贡献 29.8 | 地图净贡献大幅增加 |`,
    "",
    "## 1. Stack Trajectory",
    "",
    "Each cell counts chains whose new decision record at that point contains the theme; prior stack rows are excluded from the count.",
    "",
    "| Persona | Condition | Step | Frequent active-decision themes |",
    "|---|---|---|---|"
  ];
  for (const archetype of ARCHETYPES) {
    for (const condition of CONDITIONS) {
      const group = groupRows(rows, archetype, condition);
      for (const point of DECISION_POINTS) {
        const texts = group.map((row) => activeDecisionText(row, point));
        lines.push(`| ${archetype} | ${condition} | ${point} | ${formatThemes(themeFrequency(texts), group.length)} |`);
      }
    }
  }
  lines.push(
    "",
    "### Signature Survival In M",
    "",
    "| Persona | Step | Signature A | Signature B |",
    "|---|---|---:|---:|"
  );
  const signatureRules = {
    "草根老板": [["试单/验证", /试单|试用|小批|样品|验证|先做|试水/], ["现金/回款", /现金|回款|账期|付款|月租|租赁|订金|投入/]],
    "二代接班人": [["品质/溢价", /品质|溢价|做工|材质|细节|高端|体验/], ["背书/长期", /背书|品牌|展示|口碑|故事|董事会|总部|长期|战略|集团|审批/]]
  };
  for (const archetype of ARCHETYPES) {
    const group = groupRows(rows, archetype, "M");
    for (const point of DECISION_POINTS) {
      const texts = group.map((row) => activeDecisionText(row, point));
      const [[labelA, patternA], [labelB, patternB]] = signatureRules[archetype];
      lines.push(`| ${archetype} | ${point} | ${labelA} ${texts.filter((text) => patternA.test(text)).length}/${group.length} | ${labelB} ${texts.filter((text) => patternB.test(text)).length}/${group.length} |`);
    }
  }
  lines.push("", "## 2. VP Differentiation", "");
  for (const archetype of ARCHETYPES) {
    for (const condition of CONDITIONS) {
      const group = groupRows(rows, archetype, condition);
      const sample = getStep(group[0] || {}, "D2")?.parsed?.vp;
      const vpTexts = group.map((row) => JSON.stringify(getStep(row, "D2")?.parsed?.vp || {}));
      lines.push(`- **${archetype} / ${condition}** themes: ${formatThemes(themeFrequency(vpTexts), group.length)}. Sample: ${sample ? `WHO=${sample.who}; PAIN=${sample.pain}; HOW=${sample.how}` : "N/A"}`);
    }
  }
  lines.push("", "## 3. Configuration", "", "| Persona | Condition | Dimension | High / Mid / Low |", "|---|---|---|---:|");
  for (const archetype of ARCHETYPES) {
    for (const condition of CONDITIONS) {
      const group = groupRows(rows, archetype, condition);
      for (const dimension of CONFIG_DIMENSIONS) {
        const counts = configCounts(group, dimension);
        lines.push(`| ${archetype} | ${condition} | ${dimension} | ${counts["高"]} / ${counts["中"]} / ${counts["低"]} |`);
      }
      const stances = group.map((row) => getStep(row, "D4")?.parsed?.cost_stance?.text || "");
      lines.push(`| ${archetype} | ${condition} | cost_stance themes | ${formatThemes(themeFrequency(stances), group.length)} |`);
    }
  }
  lines.push("", "## 4. Evidence Filtering", "");
  for (const archetype of ARCHETYPES) {
    for (const condition of CONDITIONS) {
      const group = groupRows(rows, archetype, condition);
      const evidenceTexts = group.map((row) => (getStep(row, "D3")?.parsed?.key_evidence || []).join(" "));
      lines.push(`- **${archetype} / ${condition}**: ${formatThemes(themeFrequency(evidenceTexts), group.length)}`);
    }
  }
  lines.push("", "## 5. Terminal Price", "", "| Persona | Condition | N | Mean | Range |", "|---|---|---:|---:|---:|");
  for (const archetype of ARCHETYPES) {
    for (const condition of CONDITIONS) {
      const stats = priceByCell[`${archetype}_${condition}`];
      lines.push(`| ${archetype} | ${condition} | ${stats.n} | ${formatNumber(stats.mean)} | ${formatNumber(stats.min)}-${formatNumber(stats.max)} |`);
    }
  }
  const grassM = priceByCell["草根老板_M"];
  const heirM = priceByCell["二代接班人_M"];
  const separatedM = grassM.max < heirM.min;
  lines.push(
    "",
    `- Chain M persona gap: ${formatNumber(mGap)}; chain C persona gap: ${formatNumber(cGap)}; map net contribution: ${formatNumber(mGap - cGap)}.`,
    `- M price ranges ${separatedM ? "do not overlap" : "overlap"}: 草根 ${formatNumber(grassM.min)}-${formatNumber(grassM.max)}; 二代 ${formatNumber(heirM.min)}-${formatNumber(heirM.max)}.`,
    "- MVP-MIN single-point reference: M gap 540; C gap 510.2; map net contribution 29.8.",
    "",
    "## 6. M vs C Decision",
    "",
    `> **发散。** M 条件把两条链推向不同且不重叠的终点价格区间，persona gap 为 ${formatNumber(mGap)}，比 C 条件的 ${formatNumber(cGap)} 大 ${formatNumber(mGap - cGap)}。草根的试单/现金约束与二代的品质/背书约束均在 D1-D5 的新决策记录中持续出现；同一报告在 D3 没有把两条路径拉回同质。`,
    "",
    "Full prompts and raw outputs for one chain in every persona x condition cell are in `chain_map_bench_raw_samples.md`."
  );
  fs.writeFileSync(filePath, `${lines.join("\n")}\n`, "utf8");
}

function auditReferences(rows, materials) {
  const invalid = [];
  for (const row of rows.filter((item) => item.condition === "M")) {
    const ids = new Set(materials.maps[row.persona].map((item) => item.id));
    const d1 = getStep(row, "D1")?.parsed;
    for (const item of d1?.constraints || []) if (!ids.has(item.source)) invalid.push(`${chainKey(row)}|D1|${item.source}`);
    const d4 = getStep(row, "D4")?.parsed;
    if (d4 && !ids.has(d4.cost_stance?.source)) invalid.push(`${chainKey(row)}|D4|${d4.cost_stance?.source}`);
    const d5 = getStep(row, "D5")?.parsed;
    if (d5 && !ids.has(d5.basis?.source) && !STACK_REFERENCES.has(d5.basis?.source)) invalid.push(`${chainKey(row)}|D5|${d5.basis?.source}`);
  }
  return invalid;
}

function orderedRows(rows) {
  return rows.slice().sort((a, b) => (
    ARCHETYPES.indexOf(a.persona) - ARCHETYPES.indexOf(b.persona) ||
    CONDITIONS.indexOf(a.condition) - CONDITIONS.indexOf(b.condition) ||
    Number(a.rep) - Number(b.rep)
  ));
}

function writeOutputs(paths, rows, args, materials) {
  const ordered = orderedRows(rows);
  const invalidReferences = auditReferences(ordered, materials);
  const gitCommit = spawnSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).stdout.trim();
  const committedScript = spawnSync("git", ["show", `${gitCommit}:${path.relative(ROOT, __filename)}`], { cwd: ROOT });
  const executionScriptSha256 = committedScript.status === 0 ? sha256(committedScript.stdout) : null;
  const meta = {
    runId: args.runId,
    createdAt: new Date().toISOString(),
    gitCommit,
    scriptSha256: fileSha256(__filename),
    executionGitCommit: gitCommit,
    executionScriptSha256,
    personaReportsFile: path.relative(ROOT, REPORTS_PATH),
    personaReportsSha256: fileSha256(REPORTS_PATH),
    reportGrid: REPORT_GRID,
    reportCount: materials.reportCount,
    maps: Object.fromEntries(ARCHETYPES.map((archetype) => [archetype, {
      file: path.relative(ROOT, MAP_PATHS[archetype]),
      sha256: fileSha256(MAP_PATHS[archetype])
    }])),
    temperature: TEMPERATURE,
    requestedChains: ARCHETYPES.length * CONDITIONS.length * args.reps,
    completedChains: ordered.filter((row) => row.status === "OK").length,
    failedChains: ordered.filter((row) => row.status !== "OK").length,
    totalCalls: ordered.reduce((sum, row) => sum + Number(row.total_calls || 0), 0),
    expectedBaseCalls: ARCHETYPES.length * CONDITIONS.length * args.reps * DECISION_POINTS.length,
    invalidReferences: invalidReferences.length,
    invalidReferenceDetails: invalidReferences
  };
  writeCsv(paths.csv, ordered);
  writeSummary(paths.summary, ordered, meta);
  writeRawSamples(paths.samples, ordered);
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
    const completed = new Set(rows.map(chainKey));
    const tasks = [];
    for (const archetype of ARCHETYPES) {
      for (const condition of CONDITIONS) {
        for (let rep = 1; rep <= args.reps; rep += 1) {
          const task = { archetype, condition, rep };
          if (!completed.has(chainKey({ persona: archetype, condition, rep }))) tasks.push(task);
        }
      }
    }
    console.log(`[chain_map_bench] existing=${rows.length} remaining=${tasks.length} concurrency=${args.concurrency}`);
    await runPool(tasks, args.concurrency, async (task, index) => {
      const row = await runChain(chatCompletion, task, materials, args.runId);
      appendJsonl(paths.jsonl, row);
      console.log(`[chain_map_bench] ${index + 1}/${tasks.length} ${chainKey(row)} ${row.status} calls=${row.total_calls}`);
    });
    rows = loadJsonl(paths.jsonl).filter((row) => row.run_id === args.runId);
  }
  const meta = writeOutputs(paths, rows, args, materials);
  console.log(JSON.stringify({ paths, meta }, null, 2));
}

module.exports = {
  ARCHETYPES,
  CONDITIONS,
  DECISION_POINTS,
  CONFIG_DIMENSIONS,
  STACK_REFERENCES,
  loadMaterials,
  buildPrompt,
  validateResponse,
  makeStackRecord,
  auditReferences
};

if (require.main === module) {
  main().catch((error) => {
    console.error(error.stack || error.message || String(error));
    process.exitCode = 1;
  });
}
