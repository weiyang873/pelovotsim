"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { spawnSync } = require("node:child_process");

const Bench = require("./chain_map_bench");
const RD = require("../../server/llm/rdCalculator");

const ROOT = path.join(__dirname, "..", "..");
const RUN_ID = "chain_map_engine_pilot_v5_2026-07-14";
const REPORT_GRID = "B2B_Differentiation_Elder";
const VP_GRID = "ToB_Differentiation_Elder";
const ROUND1_GRID = "ToB_Differentiation_Elder";
const CONDITION = "M";
const TEMPERATURE = 0.45;
const MAX_OUTPUT_REPAIRS = 2;
const ARCHETYPES = ["草根老板", "二代接班人"];
const DECISION_POINTS = ["D1", "D2", "D3", "D4", "D5"];
const RADAR_KEYS = ["perception", "mobility", "interaction", "safety_privacy", "integration", "operations"];
const CAPABILITY_PATH = path.join(ROOT, "data", "capability_groups_v2.json");
const COMPATIBILITY_PATH = path.join(ROOT, "data", "compatibility_rules_v2.json");
const TAG_MAP_PATH = path.join(ROOT, "data", "tag_map_v2_1.json");
const DIMENSION_ANCHOR_PATH = path.join(ROOT, "data", "round2_dim_anchors_v1.json");
const REPORTS_PATH = path.join(ROOT, "game_config_v0.1", "persona_reports_v1.1.json");
const MAP_PATHS = {
  "草根老板": path.join(__dirname, "cognitive_map_caogen_min.json"),
  "二代接班人": path.join(__dirname, "cognitive_map_erdai_min.json")
};

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
  const args = { runId: RUN_ID, concurrency: 2, summarizeOnly: false };
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

function loadPilotMaterials() {
  const base = Bench.loadMaterials();
  const capabilityGroups = JSON.parse(fs.readFileSync(CAPABILITY_PATH, "utf8"));
  const compatibilityRules = JSON.parse(fs.readFileSync(COMPATIBILITY_PATH, "utf8"));
  const tagMap = JSON.parse(fs.readFileSync(TAG_MAP_PATH, "utf8"));
  const dimensionAnchors = JSON.parse(fs.readFileSync(DIMENSION_ANCHOR_PATH, "utf8"));
  const capabilityIndex = new Map();
  const groupByCapability = new Map();
  for (const group of capabilityGroups.groups || []) {
    for (const capability of group.capabilities || []) {
      capabilityIndex.set(capability.cap_id, capability);
      groupByCapability.set(capability.cap_id, {
        group_id: group.group_id,
        name: group.name
      });
    }
  }
  if ((capabilityGroups.groups || []).length !== 6 || capabilityIndex.size !== 23) {
    throw new Error(`unexpected capability pool shape: groups=${(capabilityGroups.groups || []).length}, cards=${capabilityIndex.size}`);
  }
  return {
    ...base,
    capabilityGroups,
    compatibilityRules,
    tagMap,
    dimensionAnchors,
    capabilityIndex,
    groupByCapability
  };
}

function renderMap(items) {
  return items.map((item) => `- ${item.id}［${item.type}］${item.content}`).join("\n");
}

function renderStack(stack) {
  if (stack.length === 0) return "";
  return [
    "【你此前形成的目标-约束栈】",
    "这是你此前一路形成的判断，是你现在的立场，不要推翻。",
    ...stack.map((record) => `${record.point}：${record.summary}`)
  ].join("\n");
}

function buildD4Prompt(task, materials, stack) {
  return [
    `你是一位"${task.archetype}"型的企业管理者。`,
    "【你的人生经验】",
    renderMap(materials.maps[task.archetype]),
    renderStack(stack),
    "【真实能力卡池；全量，字段原样保留】",
    JSON.stringify(materials.capabilityGroups, null, 2),
    "【真实兼容性规则；全量】",
    JSON.stringify(materials.compatibilityRules, null, 2),
    "【任务】依据既有目标、约束、价值主张和市场判断，做出真实能力卡选择。",
    "每张卡必须同时选择真实 id 和 low/mid/high tier。每个维度至少选 1 张，总数至少 6 张，不设人为上限，并且必须通过全部真实兼容性规则。具体张数、卡片和 tier 都由你决定。",
    "cost_stance.source 必须引用一条真实存在的人生经验 id。",
    '输出 JSON：{"cards":[{"id":"<真实卡id>","tier":"low|mid|high"}],"cost_stance":{"text":"<成本立场>","source":"map_xx"},"updated_constraints":[{"text":"<约束>"}]}',
    "只输出可 JSON.parse 的 JSON，不要 Markdown，不要额外文字。占位符只表示字段类型，不要原样输出。"
  ].filter(Boolean).join("\n");
}

function buildPilotPrompt(point, task, materials, stack) {
  if (point === "D4") return buildD4Prompt(task, materials, stack);
  return Bench.buildPrompt(point, task, materials, stack);
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

function normalizeUpdatedConstraints(value) {
  if (!Array.isArray(value) || value.length === 0) throw new Error("updated_constraints must be a non-empty array");
  if (value.length > 5) throw new Error("updated_constraints may contain at most five rows");
  return value.map((item, index) => ({
    text: requireText(item?.text, `updated_constraints[${index}].text`)
  }));
}

function toEngineSelections(cards) {
  return cards.map((card) => ({ cap_id: card.id, tier: card.tier }));
}

function validateD4Response(raw, task, materials) {
  const parsed = parseJsonObject(raw);
  if (!Array.isArray(parsed.cards) || parsed.cards.length < 6) {
    throw new Error("cards must contain at least six rows");
  }
  const cards = parsed.cards.map((item, index) => {
    const id = requireText(item?.id, `cards[${index}].id`);
    const tier = requireText(item?.tier, `cards[${index}].tier`).toLowerCase();
    const capability = materials.capabilityIndex.get(id);
    if (!capability) throw new Error(`unknown card id: ${id}`);
    if (!Object.prototype.hasOwnProperty.call(capability.tiers || {}, tier)) {
      throw new Error(`invalid tier for ${id}: ${tier}`);
    }
    return { id, tier };
  });
  const validation = RD.validateSelections(toEngineSelections(cards));
  if (!validation.valid || validation.hardViolationCount !== 0) {
    const details = (validation.violations || []).map((item) => item.message || JSON.stringify(item)).join("; ");
    throw new Error(`compatibility validation failed: ${details || "unknown violation"}`);
  }
  const validMapIds = new Set(materials.maps[task.archetype].map((item) => item.id));
  const costStance = {
    text: requireText(parsed.cost_stance?.text, "cost_stance.text"),
    source: requireText(parsed.cost_stance?.source, "cost_stance.source")
  };
  if (!validMapIds.has(costStance.source)) throw new Error(`invalid map source id: ${costStance.source}`);
  return {
    cards,
    cost_stance: costStance,
    updated_constraints: normalizeUpdatedConstraints(parsed.updated_constraints),
    compatibility: validation
  };
}

function validatePilotResponse(point, raw, task, materials) {
  if (point === "D4") return validateD4Response(raw, task, materials);
  return Bench.validateResponse(point, raw, task, materials);
}

function summarizeCards(cards, materials) {
  const grouped = new Map();
  for (const card of cards) {
    const group = materials.groupByCapability.get(card.id);
    const key = group?.name || group?.group_id || "未知维度";
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(`${card.id}@${card.tier}`);
  }
  return Array.from(grouped.entries()).map(([group, values]) => `${group}=${values.join(",")}`).join("；");
}

function makePilotStackRecord(point, parsed, materials) {
  if (point !== "D4") return Bench.makeStackRecord(point, parsed);
  return {
    point,
    summary: `选卡共${parsed.cards.length}张[${summarizeCards(parsed.cards, materials)}]；成本立场=${parsed.cost_stance.text}；当前约束=${parsed.updated_constraints.map((item) => item.text).join("；")}`
  };
}

async function runStep(chatCompletion, point, task, materials, stack) {
  const prompt = buildPilotPrompt(point, task, materials, stack);
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
      const parsed = validatePilotResponse(point, raw, task, materials);
      const stackRecord = makePilotStackRecord(point, parsed, materials);
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

function getStep(row, point) {
  return row.steps.find((step) => step.decision_point === point);
}

function buildTagExtractorMessages(d3) {
  const lines = [
    "D3 已筛选的关键证据：",
    ...(d3.key_evidence || []).map((item, index) => `${index + 1}. ${item}`),
    `D3 市场判断：${d3.market_judgment}`
  ];
  return [{ role: "assistant", content: lines.join("\n") }];
}

function assertRadarScores(scores) {
  const normalized = {};
  for (const key of RADAR_KEYS) {
    const value = Number(scores?.[key]);
    if (!Number.isFinite(value) || value < 1 || value > 10) {
      throw new Error(`invalid dimension score ${key}: ${scores?.[key]}`);
    }
    normalized[key] = value;
  }
  return normalized;
}

function alignPrice(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) throw new Error(`invalid price: ${value}`);
  return Math.max(1000, Math.min(6000, Math.round(numeric / 100) * 100));
}

function buildVpFields(vp) {
  return {
    who_raw: requireText(vp?.who, "vp.who"),
    pain_raw: requireText(vp?.pain, "vp.pain"),
    how_raw: requireText(vp?.how, "vp.how"),
    alternative_raw: "",
    boundary_raw: "",
    _gridLabel: VP_GRID
  };
}

function assertFiniteMetrics(result, labels) {
  for (const label of labels) {
    const value = Number(result?.[label]);
    if (!Number.isFinite(value)) throw new Error(`non-finite metric ${label}: ${result?.[label]}`);
  }
}

async function postProcessChain(row, materials, runtime) {
  const d2 = getStep(row, "D2")?.parsed;
  const d3 = getStep(row, "D3")?.parsed;
  const d4 = getStep(row, "D4")?.parsed;
  const d5 = getStep(row, "D5")?.parsed;
  if (!d2 || !d3 || !d4 || !d5) throw new Error("missing parsed decision step for post-processing");

  const tagExtractorMessages = buildTagExtractorMessages(d3);
  const tags = await runtime.extractTags(tagExtractorMessages);
  if (!Array.isArray(tags) || tags.length < 8 || tags.length > 12) {
    throw new Error(`tagExtractor returned invalid tag count: ${Array.isArray(tags) ? tags.length : "not-array"}`);
  }

  const dimensionResult = await runtime.scoreTagsToDimensions(tags);
  const dimensionScores = assertRadarScores(dimensionResult.scores);
  const evi = Number(await RD.computeEvi({ tags, scores: dimensionScores }));
  if (!Number.isFinite(evi)) throw new Error(`non-finite evi: ${evi}`);

  const vpFields = buildVpFields(d2.vp);
  const vpResult = await runtime.scoreVpByWord(vpFields, VP_GRID, "Hybrid");
  assertFiniteMetrics(vpResult.scores, ["C", "G", "E", "VPscore"]);

  const price = alignPrice(d5.price);
  const selections = toEngineSelections(d4.cards);
  const compatibility = RD.validateSelections(selections);
  if (!compatibility.valid || compatibility.hardViolationCount !== 0) {
    throw new Error(`post-process compatibility failure: ${JSON.stringify(compatibility.violations || [])}`);
  }
  const wtp = RD.computeWTPParams(REPORT_GRID);
  const calculateInput = {
    gridId: REPORT_GRID,
    round1GridId: ROUND1_GRID,
    round1Context: { gridId: ROUND1_GRID },
    selections,
    radar: dimensionScores,
    tags,
    evi,
    P: price,
    Pmax: wtp.WTPref,
    WTP: wtp.WTPmedian,
    e: 1.2,
    COGSbase: RD.GLOBAL_PARAMS.V
  };
  const calculateOutput = await RD.calculate(calculateInput);
  assertFiniteMetrics(calculateOutput, ["V", "dCOGS", "risk", "P", "profit", "units", "evi"]);

  const tagDimensionMap = tags.map((item) => ({
    tag: item.tag,
    polarity: item.polarity,
    exact_dimension: materials.tagMap.need_tag_to_dim?.[item.tag] || null
  }));
  const exactMappedCount = tagDimensionMap.filter((item) => item.exact_dimension).length;
  const engineEffectiveTags = (calculateOutput.tagBreakdown || []).map((item) => ({
    tag: item.tag,
    dimension: item.dimCN || null,
    tier: item.tier || null,
    weight: Number(item.w || 0)
  }));
  return {
    tag_extraction: {
      input_messages: tagExtractorMessages,
      output_tags: tags,
      exact_tag_map: tagDimensionMap,
      exact_mapped_count: exactMappedCount,
      unmapped_count: tags.length - exactMappedCount
    },
    dimension_aggregation: {
      method: "dimensionScorer.scoreTagsToDimensions -> embeddingService.scoreTagsWithPolarity",
      aggregation: "polarity-weighted anchor similarity, linearly normalized to 1-10",
      anchor_version: dimensionResult.anchorVersion,
      scores: dimensionScores
    },
    evi: {
      method: "rdCalculator.computeEvi",
      input: { tags, scores: dimensionScores },
      value: evi
    },
    vp_report_only: {
      enters_calculate: false,
      input: { fields: vpFields, gridId: VP_GRID, architecture: "Hybrid" },
      output: vpResult
    },
    price_alignment: {
      raw: d5.price,
      aligned: price,
      rule: "round to nearest 100, clamp to [1000,6000]"
    },
    compatibility,
    calculate: {
      input: calculateInput,
      output: calculateOutput,
      tag_flow: {
        extracted_tags: tags.map((item) => item.tag),
        exact_mapped_count: exactMappedCount,
        effective_tags: engineEffectiveTags,
        fallback_used: exactMappedCount < Math.min(tags.length, 6),
        note: "rdCalculator.normalizeTagList keeps only exact tag_map_v2_1 matches, then ensureSufficientTags fills missing tags from the grid prior/radar fallback. Radar and EVI still use the extracted-tag dimension scores."
      }
    }
  };
}

async function runChain(chatCompletion, task, materials, runId, runtime) {
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
        rep: 1,
        status: "FAIL",
        steps,
        final_stack: stack,
        post_process: null,
        decision_calls: steps.reduce((sum, item) => sum + item.attempts, 0),
        tag_extractor_invocations: 0,
        error: `${point}: ${step.error}`
      };
    }
    stack = step.stack_after;
  }

  const base = {
    run_id: runId,
    created_at: new Date().toISOString(),
    persona: task.archetype,
    condition: CONDITION,
    rep: 1,
    steps,
    final_stack: stack,
    decision_calls: steps.reduce((sum, item) => sum + item.attempts, 0),
    tag_extractor_invocations: 1
  };
  try {
    const postProcess = await postProcessChain(base, materials, runtime);
    return { ...base, status: "OK", post_process: postProcess, error: "" };
  } catch (error) {
    return {
      ...base,
      status: "FAIL",
      post_process: null,
      error: `post_process: ${error.message || error}`
    };
  }
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

function latestRows(rows) {
  const latest = new Map();
  for (const row of rows) latest.set(chainKey(row), row);
  return ARCHETYPES.map((persona) => latest.get(`${persona}|${CONDITION}|1`)).filter(Boolean);
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

function auditReferences(rows, materials) {
  const invalid = [];
  for (const row of rows) {
    const ids = new Set(materials.maps[row.persona].map((item) => item.id));
    const d1 = getStep(row, "D1")?.parsed;
    for (const item of d1?.constraints || []) {
      if (!ids.has(item.source)) invalid.push(`${chainKey(row)}|D1|${item.source}`);
    }
    const d4 = getStep(row, "D4")?.parsed;
    if (d4 && !ids.has(d4.cost_stance?.source)) invalid.push(`${chainKey(row)}|D4|${d4.cost_stance?.source}`);
    const d5 = getStep(row, "D5")?.parsed;
    if (d5 && !ids.has(d5.basis?.source) && !Bench.STACK_REFERENCES.has(d5.basis?.source)) {
      invalid.push(`${chainKey(row)}|D5|${d5.basis?.source}`);
    }
  }
  return invalid;
}

function formatNumber(value, digits = 2) {
  const number = Number(value);
  return Number.isFinite(number) ? Number(number.toFixed(digits)).toLocaleString("en-US") : "N/A";
}

function evidenceFingerprint(row) {
  const d3 = getStep(row, "D3")?.parsed;
  const text = `${(d3?.key_evidence || []).join(" ")} ${d3?.market_judgment || ""}`;
  return {
    labor_substitution: /人力|护工|夜班|替代|招聘|流动性|培训/.test(text),
    endorsement_display: /背书|展示|品牌|口碑|故事|总部|董事会|补贴|合规/.test(text)
  };
}

function writeSummary(filePath, rows, meta, materials) {
  const lines = [
    "# Chain Map Engine Pilot v5 Summary",
    "",
    `- Run: \`${meta.runId}\``,
    `- Completed: ${meta.completedChains}/${meta.requestedChains}; failed: ${meta.failedChains}`,
    `- Aggregation: ${meta.dimensionAggregation.method}`,
    `- VP scores are report-only and do not enter \`rdCalculator.calculate()\`.`,
    "- N=1 per persona; all comparisons below are descriptive and are not statistical or paper-citable.",
    "",
    "## Chain Results",
    "",
    "| Persona | Cards | Price | EVI | Vscore | dCOGS | Risk | Q | Profit | VP C/G/E/VPscore |",
    "|---|---:|---:|---:|---:|---:|---:|---:|---:|---|"
  ];
  for (const row of rows) {
    const post = row.post_process;
    const out = post?.calculate?.output;
    const vp = post?.vp_report_only?.output?.scores;
    lines.push(`| ${row.persona} | ${getStep(row, "D4")?.parsed?.cards?.length ?? "N/A"} | ${formatNumber(post?.price_alignment?.aligned, 0)} | ${formatNumber(post?.evi?.value)} | ${formatNumber(out?.V)} | ${formatNumber(out?.dCOGS, 0)} | ${formatNumber(out?.risk)} | ${formatNumber(out?.units, 0)} | ${formatNumber(out?.profit, 0)} | ${formatNumber(vp?.C)}/${formatNumber(vp?.G)}/${formatNumber(vp?.E)}/${formatNumber(vp?.VPscore)} |`);
  }

  for (const row of rows) {
    lines.push("", `## ${row.persona}`, "");
    if (row.status !== "OK") {
      lines.push(`- Status: FAIL — ${row.error}`, "");
      continue;
    }
    const cards = getStep(row, "D4").parsed.cards;
    const post = row.post_process;
    const fingerprint = evidenceFingerprint(row);
    lines.push(
      `- Evidence fingerprint: 人力替代类=${fingerprint.labor_substitution ? "命中" : "未命中"}；背书/展示类=${fingerprint.endorsement_display ? "命中" : "未命中"}`,
      `- Cards: ${cards.length}; compatibility=${post.compatibility.valid ? "PASS" : "FAIL"}`,
      `- Price: raw ${formatNumber(post.price_alignment.raw, 0)} → aligned ${formatNumber(post.price_alignment.aligned, 0)}`,
      `- EVI: ${formatNumber(post.evi.value)}; Vscore: ${formatNumber(post.calculate.output.V)}; profit: ${formatNumber(post.calculate.output.profit, 0)}; Q: ${formatNumber(post.calculate.output.units, 0)}`,
      "",
      "### Selected Cards",
      "",
      "| Dimension | Card | Tier |",
      "|---|---|---|"
    );
    for (const card of cards) {
      const group = materials.groupByCapability.get(card.id);
      lines.push(`| ${group?.name || "N/A"} | ${card.id} | ${card.tier} |`);
    }
    lines.push("", "### D3 Tags and Exact Map", "", "| Tag | Polarity | Exact mapped dimension |", "|---|---|---|");
    for (const tag of post.tag_extraction.exact_tag_map) {
      lines.push(`| ${tag.tag} | ${tag.polarity} | ${tag.exact_dimension || "未命中 exact tag map；dimensionScorer 仍按 anchor 相似度计分"} |`);
    }
    const exactMappedCount = Number.isFinite(Number(post.tag_extraction.exact_mapped_count))
      ? Number(post.tag_extraction.exact_mapped_count)
      : post.tag_extraction.exact_tag_map.filter((item) => item.exact_dimension).length;
    const effectiveTags = Array.isArray(post.calculate.tag_flow?.effective_tags)
      ? post.calculate.tag_flow.effective_tags
      : (post.calculate.output.tagBreakdown || []).map((item) => ({
        tag: item.tag,
        dimension: item.dimCN || null,
        tier: item.tier || null,
        weight: Number(item.w || 0)
      }));
    const fallbackUsed = typeof post.calculate.tag_flow?.fallback_used === "boolean"
      ? post.calculate.tag_flow.fallback_used
      : exactMappedCount < Math.min(post.tag_extraction.output_tags.length, 6);
    lines.push(
      "",
      `- Exact tag-map coverage: ${exactMappedCount}/${post.tag_extraction.output_tags.length}.`,
      `- Engine effective coverage tags: ${effectiveTags.map((item) => item.tag).join("、") || "无"}.`,
      `- Grid/radar fallback used inside calculate: ${fallbackUsed ? "YES" : "NO"}. D3-derived radar and EVI still enter calculate, but unmapped raw tags do not directly enter core/nice coverage.`
    );
    lines.push("", "### Radar / Dimension Scores", "", "| Dimension key | Score |", "|---|---:|");
    for (const key of RADAR_KEYS) lines.push(`| ${key} | ${formatNumber(post.dimension_aggregation.scores[key])} |`);
    const vp = post.vp_report_only.output.scores;
    lines.push(
      "",
      "### VP (Report Only; Not an Engine Input)",
      "",
      `- C=${formatNumber(vp.C)}, G=${formatNumber(vp.G)}, E=${formatNumber(vp.E)}, VPscore=${formatNumber(vp.VPscore)}.`
    );
  }

  const grass = rows.find((row) => row.persona === "草根老板" && row.status === "OK");
  const heir = rows.find((row) => row.persona === "二代接班人" && row.status === "OK");
  lines.push("", "## One-Sentence Observation", "");
  if (grass && heir) {
    const grassOut = grass.post_process.calculate.output;
    const heirOut = heir.post_process.calculate.output;
    const priceDirection = heir.post_process.price_alignment.aligned > grass.post_process.price_alignment.aligned
      ? "二代定价高于草根，与抽象链价格方向一致"
      : (heir.post_process.price_alignment.aligned < grass.post_process.price_alignment.aligned
        ? "二代定价低于草根，与抽象链价格方向相反"
        : "两者定价相同，抽象链价格分化被磨平");
    lines.push(`> 本次两条单链中，${priceDirection}；EVI 为草根 ${formatNumber(grass.post_process.evi.value)} / 二代 ${formatNumber(heir.post_process.evi.value)}，Vscore 为 ${formatNumber(grassOut.V)} / ${formatNumber(heirOut.V)}，profit 为 ${formatNumber(grassOut.profit, 0)} / ${formatNumber(heirOut.profit, 0)}。这只是描述性观察。`);
  } else {
    lines.push("> 2/2 链未全部完成，无法给出双链方向观察。");
  }
  lines.push("", `Full prompts, raw responses, tag extraction, EVI inputs, VP report, and calculate I/O are in \`${path.basename(meta.paths.samples)}\`.`);
  fs.writeFileSync(filePath, `${lines.join("\n")}\n`, "utf8");
}

function writeRawSamples(filePath, rows) {
  const lines = ["# Chain Map Engine Pilot v5 Raw Samples", ""];
  for (const row of rows) {
    lines.push(`## ${row.persona} / ${row.condition}`, "", `Status: ${row.status}`, "");
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
    if (row.post_process) {
      lines.push(
        "### Post-processing and Real Engine Settlement",
        "",
        "```json",
        JSON.stringify(row.post_process, null, 2),
        "```",
        ""
      );
    }
  }
  fs.writeFileSync(filePath, `${lines.join("\n")}\n`, "utf8");
}

function gitText(args) {
  const result = spawnSync("git", args, { cwd: ROOT, encoding: "utf8" });
  return result.status === 0 ? result.stdout : "";
}

function writeOutputs(paths, rows, args, materials) {
  const ordered = latestRows(rows);
  const invalidReferences = auditReferences(ordered, materials);
  const gitCommit = gitText(["rev-parse", "HEAD"]).trim();
  const commitObject = gitText(["cat-file", "commit", "HEAD"]);
  const gitStatus = gitText(["status", "--porcelain"]);
  let previousMeta = null;
  if (fs.existsSync(paths.meta)) {
    try {
      previousMeta = JSON.parse(fs.readFileSync(paths.meta, "utf8"));
    } catch (_) {
      previousMeta = null;
    }
  }
  const currentScriptSha256 = fileSha256(__filename);
  const executionScriptSha256 = previousMeta?.executionScriptSha256 || previousMeta?.script?.sha256 || currentScriptSha256;
  const meta = {
    runId: args.runId,
    createdAt: new Date().toISOString(),
    paths,
    gitCommit,
    gitCommitObjectSha256: commitObject ? sha256(commitObject) : null,
    gitStatusPorcelainSha256: sha256(gitStatus),
    script: {
      file: path.relative(ROOT, __filename),
      sha256: currentScriptSha256
    },
    executionScriptSha256,
    executionGitCommit: previousMeta?.executionGitCommit || previousMeta?.gitCommit || gitCommit,
    inputs: {
      personaReports: { file: path.relative(ROOT, REPORTS_PATH), sha256: fileSha256(REPORTS_PATH) },
      capabilityGroups: { file: path.relative(ROOT, CAPABILITY_PATH), sha256: fileSha256(CAPABILITY_PATH) },
      compatibilityRules: { file: path.relative(ROOT, COMPATIBILITY_PATH), sha256: fileSha256(COMPATIBILITY_PATH) },
      tagMap: { file: path.relative(ROOT, TAG_MAP_PATH), sha256: fileSha256(TAG_MAP_PATH) },
      dimensionAnchors: { file: path.relative(ROOT, DIMENSION_ANCHOR_PATH), sha256: fileSha256(DIMENSION_ANCHOR_PATH) },
      maps: Object.fromEntries(ARCHETYPES.map((archetype) => [archetype, {
        file: path.relative(ROOT, MAP_PATHS[archetype]),
        sha256: fileSha256(MAP_PATHS[archetype])
      }]))
    },
    reportGrid: REPORT_GRID,
    vpGrid: VP_GRID,
    condition: CONDITION,
    reps: 1,
    temperature: TEMPERATURE,
    dimensionAggregation: {
      method: "dimensionScorer.scoreTagsToDimensions -> embeddingService.scoreTagsWithPolarity",
      formulaSource: "server/llm/embeddingService.js:165-215",
      note: "Repository reality differs from the proposed direct tag-count aggregation: the existing tagExtractor pipeline uses deterministic polarity-weighted anchor similarity and 1-10 linear normalization. These scores are the radar input and computeEvi scores.",
      anchorVersion: materials.dimensionAnchors.anchor_version
    },
    engineTagFlow: {
      normalizeSource: "server/llm/rdCalculator.js:743-803",
      note: "calculate keeps exact tag_map_v2_1 matches and fills fewer than six effective tags from the grid prior/radar fallback. Per-chain exact coverage and effective tags are recorded in JSONL/raw samples/summary."
    },
    vpScoreEntersCalculate: false,
    requestedChains: ARCHETYPES.length,
    completedChains: ordered.filter((row) => row.status === "OK").length,
    failedChains: ordered.filter((row) => row.status !== "OK").length,
    decisionCalls: ordered.reduce((sum, row) => sum + Number(row.decision_calls || 0), 0),
    tagExtractorInvocations: ordered.reduce((sum, row) => sum + Number(row.tag_extractor_invocations || 0), 0),
    invalidReferences: invalidReferences.length,
    invalidReferenceDetails: invalidReferences
  };
  writeRawSamples(paths.samples, ordered);
  writeSummary(paths.summary, ordered, meta, materials);
  fs.writeFileSync(paths.meta, `${JSON.stringify(meta, null, 2)}\n`, "utf8");
  return meta;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const paths = outputPaths(args.runId);
  loadLocalEnv();
  const materials = loadPilotMaterials();
  let rows = loadJsonl(paths.jsonl).filter((row) => row.run_id === args.runId);
  if (!args.summarizeOnly) {
    const { chatCompletion, hasAnyKey } = require("../../server/llm/deepseekClient");
    const { extractTags } = require("../../server/llm/tagExtractor");
    const { scoreTagsToDimensions } = require("../../server/llm/dimensionScorer");
    const { scoreVpByWord } = require("../../server/llm/vpWordScorer");
    const embeddingService = require("../../server/llm/embeddingService");
    if (!hasAnyKey()) throw new Error("DeepSeek API key is required");
    await embeddingService.init();
    const runtime = { extractTags, scoreTagsToDimensions, scoreVpByWord };
    const completed = new Set(latestRows(rows).filter((row) => row.status === "OK").map(chainKey));
    const tasks = ARCHETYPES
      .map((archetype) => ({ archetype, condition: CONDITION, rep: 1 }))
      .filter((task) => !completed.has(`${task.archetype}|${task.condition}|${task.rep}`));
    console.log(`[chain_map_engine_pilot] existing=${rows.length} remaining=${tasks.length} concurrency=${args.concurrency}`);
    await runPool(tasks, args.concurrency, async (task, index) => {
      const row = await runChain(chatCompletion, task, materials, args.runId, runtime);
      appendJsonl(paths.jsonl, row);
      console.log(`[chain_map_engine_pilot] ${index + 1}/${tasks.length} ${chainKey(row)} ${row.status} decision_calls=${row.decision_calls}`);
    });
    rows = loadJsonl(paths.jsonl).filter((row) => row.run_id === args.runId);
  }
  const meta = writeOutputs(paths, rows, args, materials);
  console.log(JSON.stringify({ paths, meta }, null, 2));
}

module.exports = {
  ARCHETYPES,
  CONDITION,
  DECISION_POINTS,
  RADAR_KEYS,
  loadPilotMaterials,
  buildPilotPrompt,
  validatePilotResponse,
  makePilotStackRecord,
  buildTagExtractorMessages,
  toEngineSelections,
  alignPrice,
  auditReferences
};

if (require.main === module) {
  main().catch((error) => {
    console.error(error.stack || error.message || String(error));
    process.exitCode = 1;
  });
}
