"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { spawnSync } = require("node:child_process");

const Pilot = require("./chain_map_engine_pilot");

const ROOT = path.join(__dirname, "..", "..");
const RUN_ID = "chain_map_search_effort_v1_2026-07-14";
const REFERENCE_RUN_ID = "chain_map_engine_pilot_v5_2026-07-14";
const REFERENCE_JSONL = path.join(__dirname, `${REFERENCE_RUN_ID}.jsonl`);
const CONDITION = "M";
const REPS = 3;
const TEMPERATURE = 0.45;
const MAX_OUTPUT_REPAIRS = 2;
const ARCHETYPES = ["草根老板", "二代接班人"];
const DECISION_POINTS = ["D1", "D2", "D3", "D4", "D5"];
const CAPABILITY_PATH = path.join(ROOT, "data", "capability_groups_v2.json");
const COMPATIBILITY_PATH = path.join(ROOT, "data", "compatibility_rules_v2.json");
const REPORTS_PATH = path.join(ROOT, "game_config_v0.1", "persona_reports_v1.1.json");
const MAP_PATHS = {
  "草根老板": path.join(__dirname, "cognitive_map_caogen_min.json"),
  "二代接班人": path.join(__dirname, "cognitive_map_erdai_min.json")
};
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
  const args = { runId: RUN_ID, concurrency: 3, summarizeOnly: false };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--run-id") args.runId = String(argv[++index] || "").trim();
    else if (argv[index] === "--concurrency") args.concurrency = Number(argv[++index]);
    else if (argv[index] === "--summarize-only") args.summarizeOnly = true;
    else throw new Error(`unknown argument: ${argv[index]}`);
  }
  if (!args.runId || !Number.isInteger(args.concurrency) || args.concurrency < 1) {
    throw new Error("invalid run id or concurrency");
  }
  return args;
}

function outputPaths(runId) {
  return {
    jsonl: path.join(__dirname, `${runId}.jsonl`),
    summary: path.join(__dirname, `${runId}_summary.md`),
    samples: path.join(__dirname, `${runId}_raw_samples.md`),
    meta: path.join(__dirname, `${runId}_meta.json`)
  };
}

function loadJsonl(filePath) {
  if (!fs.existsSync(filePath)) return [];
  return fs.readFileSync(filePath, "utf8").split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
}

function appendJsonl(filePath, row) {
  fs.appendFileSync(filePath, `${JSON.stringify(row)}\n`, "utf8");
}

function chainKey(row) {
  return `${row.persona}|${row.condition}|${row.rep}`;
}

function latestRows(rows, reps = REPS) {
  const latest = new Map();
  for (const row of rows) latest.set(chainKey(row), row);
  return ARCHETYPES.flatMap((persona) => Array.from({ length: reps }, (_, index) => (
    latest.get(`${persona}|${CONDITION}|${index + 1}`)
  ))).filter(Boolean);
}

function getStep(row, point) {
  return (row.steps || []).find((step) => step.decision_point === point);
}

function constraintOutputForStep(point, parsed) {
  if (point === "D1") return Array.isArray(parsed?.constraints) ? parsed.constraints : [];
  if (Array.isArray(parsed?.updated_constraints)) return parsed.updated_constraints;
  return [];
}

function themeNames(texts) {
  const joined = texts.map((item) => String(item?.text || item || "")).join(" ");
  return THEME_RULES.filter(([, pattern]) => pattern.test(joined)).map(([name]) => name);
}

function collectMapSources(value, validMapIds) {
  const found = new Set();
  function visit(current) {
    if (Array.isArray(current)) {
      current.forEach(visit);
      return;
    }
    if (!current || typeof current !== "object") return;
    for (const [key, child] of Object.entries(current)) {
      if (key === "source" && typeof child === "string" && validMapIds.has(child)) found.add(child);
      else visit(child);
    }
  }
  visit(value);
  return Array.from(found).sort();
}

function reasoningTextForStep(point, parsed) {
  if (point === "D3") return { field: "market_judgment", text: String(parsed?.market_judgment || "") };
  if (point === "D4") return { field: "cost_stance.text", text: String(parsed?.cost_stance?.text || "") };
  if (point === "D5") return { field: "reasoning", text: String(parsed?.reasoning || "") };
  return { field: "none", text: "" };
}

function countCharacters(text) {
  return Array.from(String(text || "")).length;
}

function cardBreadth(parsed, materials) {
  const cards = Array.isArray(parsed?.cards) ? parsed.cards : [];
  const dimensions = new Set(cards.map((card) => materials.groupByCapability.get(card.id)?.group_id).filter(Boolean));
  return {
    count: cards.length,
    dimension_count: dimensions.size,
    dimensions: Array.from(dimensions).sort()
  };
}

function extractEffortMetrics(row, materials) {
  const validMapIds = new Set(materials.maps[row.persona].map((item) => item.id));
  const cumulativeMapIds = new Set();
  let activeConstraints = [];
  const steps = [];
  for (const point of DECISION_POINTS) {
    const step = getStep(row, point);
    if (!step?.parsed) throw new Error(`${chainKey(row)} missing parsed ${point}`);
    const stepMapIds = collectMapSources(step.parsed, validMapIds);
    stepMapIds.forEach((id) => cumulativeMapIds.add(id));
    const stepConstraintOutput = constraintOutputForStep(point, step.parsed);
    if (stepConstraintOutput.length > 0) activeConstraints = stepConstraintOutput;
    const themes = themeNames(stepConstraintOutput);
    const cards = point === "D4" ? cardBreadth(step.parsed, materials) : { count: 0, dimension_count: 0, dimensions: [] };
    const reasoning = reasoningTextForStep(point, step.parsed);
    steps.push({
      decision_point: point,
      map_reference_breadth: cumulativeMapIds.size,
      cumulative_map_reference_ids: Array.from(cumulativeMapIds).sort(),
      step_map_reference_ids: stepMapIds,
      constraint_stack_complexity: activeConstraints.length,
      step_constraint_output_count: stepConstraintOutput.length,
      theme_breadth: themes.length,
      theme_names: themes,
      card_count: cards.count,
      card_dimension_count: cards.dimension_count,
      card_dimensions: cards.dimensions,
      reasoning_text_field: reasoning.field,
      reasoning_text_length: countCharacters(reasoning.text)
    });
  }
  return {
    schema_version: "search_effort_v1",
    rules: {
      map_reference_breadth: "unique valid map source ids, cumulative through the current step",
      constraint_stack_complexity: "current constraint output count; D5 carries D4 because D5 has no constraint field",
      theme_breadth: "distinct THEME_RULES hit by this step's constraint output; D5 is zero because it emits no new constraints",
      card_breadth: "D4 card count and distinct real capability groups; zero outside D4",
      reasoning_text_length: "Unicode code-point length for D3 market_judgment, D4 cost_stance.text, D5 reasoning; zero elsewhere"
    },
    steps
  };
}

function assertCompleteEffort(row) {
  const effortSteps = row.effort?.steps;
  if (!Array.isArray(effortSteps) || effortSteps.length !== DECISION_POINTS.length) {
    throw new Error(`${chainKey(row)} effort must contain five steps`);
  }
  for (const [index, point] of DECISION_POINTS.entries()) {
    const item = effortSteps[index];
    if (item.decision_point !== point) throw new Error(`${chainKey(row)} effort step mismatch at ${point}`);
    for (const key of [
      "map_reference_breadth",
      "constraint_stack_complexity",
      "theme_breadth",
      "card_count",
      "card_dimension_count",
      "reasoning_text_length"
    ]) {
      if (!Number.isFinite(Number(item[key]))) throw new Error(`${chainKey(row)} ${point} missing ${key}`);
    }
  }
}

async function runStep(chatCompletion, point, task, materials, stack) {
  const prompt = Pilot.buildPilotPrompt(point, task, materials, stack);
  let messages = [{ role: "user", content: prompt }];
  let raw = "";
  let lastError = null;
  for (let attempt = 0; attempt <= MAX_OUTPUT_REPAIRS; attempt += 1) {
    try {
      raw = await chatCompletion(messages, {
        temperature: TEMPERATURE,
        max_tokens: point === "D4" ? 3500 : 1400,
        maxRetries: 1
      });
      const parsed = Pilot.validatePilotResponse(point, raw, task, materials);
      const stackRecord = Pilot.makePilotStackRecord(point, parsed, materials);
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
        condition: CONDITION,
        rep: task.rep,
        status: "FAIL",
        steps,
        final_stack: stack,
        effort: null,
        decision_calls: steps.reduce((sum, item) => sum + item.attempts, 0),
        error: `${point}: ${step.error}`
      };
    }
    stack = step.stack_after;
  }
  const row = {
    run_id: runId,
    created_at: new Date().toISOString(),
    persona: task.archetype,
    condition: CONDITION,
    rep: task.rep,
    status: "OK",
    steps,
    final_stack: stack,
    effort: null,
    decision_calls: steps.reduce((sum, item) => sum + item.attempts, 0),
    error: ""
  };
  try {
    row.effort = extractEffortMetrics(row, materials);
    assertCompleteEffort(row);
    return row;
  } catch (error) {
    return { ...row, status: "FAIL", error: `effort_post_process: ${error.message || error}` };
  }
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

function loadReferenceRows(materials) {
  const rows = loadJsonl(REFERENCE_JSONL).filter((row) => row.status === "OK");
  const latest = new Map();
  for (const row of rows) latest.set(row.persona, row);
  return ARCHETYPES.map((persona) => {
    const source = latest.get(persona);
    if (!source) throw new Error(`missing v5 reference row for ${persona}`);
    const row = {
      ...source,
      source_run_id: REFERENCE_RUN_ID,
      dataset: "v5即时参照",
      effort: extractEffortMetrics(source, materials)
    };
    assertCompleteEffort(row);
    return row;
  });
}

function metricAt(row, point) {
  return row.effort.steps.find((item) => item.decision_point === point);
}

function vectorFor(rows, persona, point, key) {
  return rows
    .filter((row) => row.persona === persona && row.status === "OK")
    .sort((a, b) => Number(a.rep) - Number(b.rep))
    .map((row) => Number(metricAt(row, point)?.[key] || 0));
}

function compareVectors(grass, heir) {
  const length = Math.min(grass.length, heir.length);
  let heirHigher = 0;
  let grassHigher = 0;
  let equal = 0;
  for (let index = 0; index < length; index += 1) {
    if (heir[index] > grass[index]) heirHigher += 1;
    else if (heir[index] < grass[index]) grassHigher += 1;
    else equal += 1;
  }
  return { heirHigher, grassHigher, equal, pairs: length };
}

function buildDecision(rows) {
  const cardGrass = vectorFor(rows, "草根老板", "D4", "card_count");
  const cardHeir = vectorFor(rows, "二代接班人", "D4", "card_count");
  const cardComparison = compareVectors(cardGrass, cardHeir);
  const nonD4Points = ["D1", "D2", "D3", "D5"];
  const mainKeys = ["map_reference_breadth", "constraint_stack_complexity", "theme_breadth"];
  let heirHigher = 0;
  let grassHigher = 0;
  let equal = 0;
  for (const point of nonD4Points) {
    for (const key of mainKeys) {
      const comparison = compareVectors(
        vectorFor(rows, "草根老板", point, key),
        vectorFor(rows, "二代接班人", point, key)
      );
      heirHigher += comparison.heirHigher;
      grassHigher += comparison.grassHigher;
      equal += comparison.equal;
    }
  }
  const themePoints = ["D1", "D2", "D3", "D4"];
  const constraintPoints = ["D1", "D2", "D3", "D4"];
  const combineComparisons = (points, key) => points.reduce((total, point) => {
    const comparison = compareVectors(
      vectorFor(rows, "草根老板", point, key),
      vectorFor(rows, "二代接班人", point, key)
    );
    total.heirHigher += comparison.heirHigher;
    total.grassHigher += comparison.grassHigher;
    total.equal += comparison.equal;
    total.pairs += comparison.pairs;
    return total;
  }, { heirHigher: 0, grassHigher: 0, equal: 0, pairs: 0 });
  const themeComparison = combineComparisons(themePoints, "theme_breadth");
  const constraintComparison = combineComparisons(constraintPoints, "constraint_stack_complexity");
  let observation;
  if (cardComparison.heirHigher >= 2 && themeComparison.heirHigher >= 8) {
    observation = "effort 分化不只集中在 D4：二代在 D1-D4 的语义主题广度和 D4 选卡广度上呈稳定更广方向；但约束条数没有同步增加，因此支持的是“语义/选择广度”这条全链倾向，不支持“所有 effort 代理都更高”。";
  } else if (cardComparison.heirHigher >= 2 && themeComparison.heirHigher <= themeComparison.grassHigher) {
    observation = "二代更广的选卡在多数重复中出现，但 D1-D4 主题广度没有同步呈现更广方向；本轮 effort 分化主要集中在 D4。";
  } else {
    observation = "选卡广度与 D1-D4 主题广度呈混合方向，本轮不足以把 effort 分化归为稳定的全链属性或单一步骤效应。";
  }
  return {
    cardComparison,
    nonD4Comparison: { heirHigher, grassHigher, equal, pairs: heirHigher + grassHigher + equal },
    themeComparison,
    constraintComparison,
    observation
  };
}

function formatVector(values) {
  return values.length ? values.join(" / ") : "N/A";
}

function writeSummary(filePath, rows, referenceRows, meta) {
  const successful = rows.filter((row) => row.status === "OK");
  const decision = buildDecision(successful);
  const allRows = [
    ...referenceRows.map((row) => ({ ...row, dataset: "v5即时参照" })),
    ...rows.map((row) => ({ ...row, dataset: "search-effort N=3" }))
  ];
  const lines = [
    "# Chain Map Search Effort v1 Summary",
    "",
    `- Run: \`${meta.runId}\``,
    `- Completed: ${meta.completedChains}/${meta.requestedChains}; failed: ${meta.failedChains}`,
    "- Condition: M only; N=3 per persona for the new run.",
    "- All comparisons are descriptive; no inferential or paper-citable claim is made.",
    "- Reasoning length is a weak proxy only: verbosity is not equivalent to search effort.",
    "- D2/D3 have no `source` field in the reused schema, so cumulative map-reference breadth cannot increase at those steps; this is an observability limit, not evidence of no map influence.",
    "- `updated_constraints` is treated as the current constraint-stack snapshot. D5 emits no constraint field, so its stack complexity carries D4 and its new theme breadth is zero.",
    "",
    "## Immediate Reference + New Run (Same Metrics)",
    "",
    "| Dataset | Persona | Rep | Step | Cumulative map ids | Constraint stack | Step theme breadth | Cards | Dimensions | Reasoning chars |",
    "|---|---|---:|---|---:|---:|---:|---:|---:|---:|"
  ];
  for (const row of allRows) {
    for (const point of DECISION_POINTS) {
      const metric = metricAt(row, point);
      lines.push(`| ${row.dataset} | ${row.persona} | ${row.rep} | ${point} | ${metric.map_reference_breadth} | ${metric.constraint_stack_complexity} | ${metric.theme_breadth} | ${metric.card_count} | ${metric.card_dimension_count} | ${metric.reasoning_text_length} |`);
    }
  }

  lines.push(
    "",
    "## N=3 Paired Descriptive Comparison",
    "",
    "Each vector is rep 1 / rep 2 / rep 3. `Heir higher` is a count out of three matched repetitions.",
    "",
    "| Step | Metric | Grassroots | Heir | Heir higher |",
    "|---|---|---|---|---:|"
  );
  const mainMetrics = [
    ["map_reference_breadth", "累计地图引用广度"],
    ["constraint_stack_complexity", "约束栈复杂度"],
    ["theme_breadth", "主题广度"]
  ];
  for (const point of DECISION_POINTS) {
    for (const [key, label] of mainMetrics) {
      const grass = vectorFor(successful, "草根老板", point, key);
      const heir = vectorFor(successful, "二代接班人", point, key);
      const comparison = compareVectors(grass, heir);
      lines.push(`| ${point} | ${label} | ${formatVector(grass)} | ${formatVector(heir)} | ${comparison.heirHigher}/3 |`);
    }
  }

  const grassCards = vectorFor(successful, "草根老板", "D4", "card_count");
  const heirCards = vectorFor(successful, "二代接班人", "D4", "card_count");
  const grassDims = vectorFor(successful, "草根老板", "D4", "card_dimension_count");
  const heirDims = vectorFor(successful, "二代接班人", "D4", "card_dimension_count");
  lines.push(
    "",
    "## D4 Selection Breadth",
    "",
    "| Metric | Grassroots | Heir | Heir higher |",
    "|---|---|---|---:|",
    `| Cards | ${formatVector(grassCards)} | ${formatVector(heirCards)} | ${compareVectors(grassCards, heirCards).heirHigher}/3 |`,
    `| Dimensions | ${formatVector(grassDims)} | ${formatVector(heirDims)} | ${compareVectors(grassDims, heirDims).heirHigher}/3 |`,
    "",
    "## Reasoning Length (Weak Reference Only)",
    "",
    "| Step | Grassroots chars | Heir chars |",
    "|---|---|---|"
  );
  for (const point of ["D3", "D4", "D5"]) {
    lines.push(`| ${point} | ${formatVector(vectorFor(successful, "草根老板", point, "reasoning_text_length"))} | ${formatVector(vectorFor(successful, "二代接班人", point, "reasoning_text_length"))} |`);
  }

  lines.push(
    "",
    "## Descriptive Decision",
    "",
    `- D4 card breadth: heir higher ${decision.cardComparison.heirHigher}/${decision.cardComparison.pairs}; grass higher ${decision.cardComparison.grassHigher}/${decision.cardComparison.pairs}; equal ${decision.cardComparison.equal}/${decision.cardComparison.pairs}.`,
    `- D1-D4 theme breadth (D5 excluded because it has no new-constraint field): heir higher ${decision.themeComparison.heirHigher}/${decision.themeComparison.pairs}; grass higher ${decision.themeComparison.grassHigher}/${decision.themeComparison.pairs}; equal ${decision.themeComparison.equal}/${decision.themeComparison.pairs}.`,
    `- D1-D4 constraint-stack count: heir higher ${decision.constraintComparison.heirHigher}/${decision.constraintComparison.pairs}; grass higher ${decision.constraintComparison.grassHigher}/${decision.constraintComparison.pairs}; equal ${decision.constraintComparison.equal}/${decision.constraintComparison.pairs}.`,
    `- Non-D4 main metrics (map breadth, constraint complexity, theme breadth across D1/D2/D3/D5): heir higher ${decision.nonD4Comparison.heirHigher}/${decision.nonD4Comparison.pairs}; grass higher ${decision.nonD4Comparison.grassHigher}/${decision.nonD4Comparison.pairs}; equal ${decision.nonD4Comparison.equal}/${decision.nonD4Comparison.pairs}.`,
    "",
    `> ${decision.observation}`,
    "",
    `Full prompts, raw responses, parsed decisions, and per-step effort records are in \`${path.basename(meta.paths.samples)}\`.`
  );
  fs.writeFileSync(filePath, `${lines.join("\n")}\n`, "utf8");
}

function writeRawSamples(filePath, rows, referenceRows) {
  const lines = [
    "# Chain Map Search Effort v1 Raw Samples",
    "",
    "## v5 Immediate Reference Effort Records",
    "",
    "```json",
    JSON.stringify(referenceRows.map((row) => ({
      persona: row.persona,
      rep: row.rep,
      source_run_id: row.source_run_id,
      effort: row.effort
    })), null, 2),
    "```",
    ""
  ];
  for (const row of rows) {
    lines.push(`## ${row.persona} / M / rep ${row.rep}`, "", `Status: ${row.status}`, "");
    if (row.error) lines.push(`Error: ${row.error}`, "");
    for (const step of row.steps || []) {
      lines.push(
        `### ${step.decision_point}`,
        "",
        "**Prompt**",
        "",
        "```text",
        step.prompt,
        "```",
        "",
        "**Raw response**",
        "",
        "```json",
        step.raw_response,
        "```",
        "",
        "**Validated parsed value**",
        "",
        "```json",
        JSON.stringify(step.parsed, null, 2),
        "```",
        ""
      );
    }
    if (row.effort) {
      lines.push("### Effort Post-processing", "", "```json", JSON.stringify(row.effort, null, 2), "```", "");
    }
  }
  fs.writeFileSync(filePath, `${lines.join("\n")}\n`, "utf8");
}

function auditReferences(rows, materials) {
  return Pilot.auditReferences(rows, materials);
}

function gitText(args) {
  const result = spawnSync("git", args, { cwd: ROOT, encoding: "utf8" });
  return result.status === 0 ? result.stdout : "";
}

function writeOutputs(paths, rows, referenceRows, args, materials) {
  const ordered = latestRows(rows);
  const invalidReferences = auditReferences(ordered, materials);
  const gitCommit = gitText(["rev-parse", "HEAD"]).trim();
  const commitObject = gitText(["cat-file", "commit", "HEAD"]);
  const gitStatus = gitText(["status", "--porcelain"]);
  let priorMeta = null;
  if (fs.existsSync(paths.meta)) {
    try {
      priorMeta = JSON.parse(fs.readFileSync(paths.meta, "utf8"));
    } catch (_error) {
      priorMeta = null;
    }
  }
  const currentScriptSha256 = fileSha256(__filename);
  const meta = {
    runId: args.runId,
    createdAt: new Date().toISOString(),
    paths,
    gitCommit,
    gitCommitObjectSha256: commitObject ? sha256(commitObject) : null,
    gitStatusPorcelainSha256: sha256(gitStatus),
    script: {
      file: path.relative(ROOT, __filename),
      sha256: currentScriptSha256,
      executionSha256: priorMeta?.script?.executionSha256 || priorMeta?.script?.sha256 || currentScriptSha256
    },
    reference: {
      runId: REFERENCE_RUN_ID,
      file: path.relative(ROOT, REFERENCE_JSONL),
      sha256: fileSha256(REFERENCE_JSONL),
      chains: referenceRows.length
    },
    inputs: {
      personaReports: { file: path.relative(ROOT, REPORTS_PATH), sha256: fileSha256(REPORTS_PATH) },
      capabilityGroups: { file: path.relative(ROOT, CAPABILITY_PATH), sha256: fileSha256(CAPABILITY_PATH) },
      compatibilityRules: { file: path.relative(ROOT, COMPATIBILITY_PATH), sha256: fileSha256(COMPATIBILITY_PATH) },
      maps: Object.fromEntries(ARCHETYPES.map((persona) => [persona, {
        file: path.relative(ROOT, MAP_PATHS[persona]),
        sha256: fileSha256(MAP_PATHS[persona])
      }]))
    },
    condition: CONDITION,
    reps: REPS,
    temperature: TEMPERATURE,
    requestedChains: ARCHETYPES.length * REPS,
    completedChains: ordered.filter((row) => row.status === "OK").length,
    failedChains: ordered.filter((row) => row.status !== "OK").length,
    decisionCalls: ordered.reduce((sum, row) => sum + Number(row.decision_calls || 0), 0),
    invalidReferences: invalidReferences.length,
    invalidReferenceDetails: invalidReferences,
    effortRules: ordered.find((row) => row.effort)?.effort?.rules || null,
    decision: buildDecision(ordered.filter((row) => row.status === "OK"))
  };
  writeRawSamples(paths.samples, ordered, referenceRows);
  writeSummary(paths.summary, ordered, referenceRows, meta);
  fs.writeFileSync(paths.meta, `${JSON.stringify(meta, null, 2)}\n`, "utf8");
  return meta;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const paths = outputPaths(args.runId);
  loadLocalEnv();
  const materials = Pilot.loadPilotMaterials();
  const referenceRows = loadReferenceRows(materials);
  let rows = loadJsonl(paths.jsonl).filter((row) => row.run_id === args.runId);
  if (!args.summarizeOnly) {
    const { chatCompletion, hasAnyKey } = require("../../server/llm/deepseekClient");
    if (!hasAnyKey()) throw new Error("DeepSeek API key is required");
    const completed = new Set(latestRows(rows).filter((row) => row.status === "OK").map(chainKey));
    const tasks = ARCHETYPES.flatMap((archetype) => Array.from({ length: REPS }, (_, index) => ({
      archetype,
      condition: CONDITION,
      rep: index + 1
    }))).filter((task) => !completed.has(`${task.archetype}|${task.condition}|${task.rep}`));
    console.log(`[chain_map_search_effort] reference=${referenceRows.length} existing=${rows.length} remaining=${tasks.length} concurrency=${args.concurrency}`);
    await runPool(tasks, args.concurrency, async (task, index) => {
      const row = await runChain(chatCompletion, task, materials, args.runId);
      appendJsonl(paths.jsonl, row);
      console.log(`[chain_map_search_effort] ${index + 1}/${tasks.length} ${chainKey(row)} ${row.status} calls=${row.decision_calls}`);
    });
    rows = loadJsonl(paths.jsonl).filter((row) => row.run_id === args.runId);
  }
  const meta = writeOutputs(paths, rows, referenceRows, args, materials);
  console.log(JSON.stringify({ paths, meta }, null, 2));
}

module.exports = {
  ARCHETYPES,
  CONDITION,
  REPS,
  DECISION_POINTS,
  THEME_RULES,
  constraintOutputForStep,
  collectMapSources,
  themeNames,
  cardBreadth,
  extractEffortMetrics,
  assertCompleteEffort,
  loadReferenceRows,
  buildDecision
};

if (require.main === module) {
  main().catch((error) => {
    console.error(error.stack || error.message || String(error));
    process.exitCode = 1;
  });
}
