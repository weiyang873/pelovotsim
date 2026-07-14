"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { spawnSync } = require("node:child_process");

const Pilot = require("./chain_map_engine_pilot");
const Effort = require("./chain_map_search_effort");

const ROOT = path.join(__dirname, "..", "..");
const RUN_ID = "ai_generated_persona_maps_v2_2026-07-14";
const CONDITION = "M";
const DECISION_POINTS = ["D1", "D2", "D3", "D4"];
const TEMPERATURE = 0.75;
const CHAIN_TEMPERATURE = 0.45;
const MAX_JSON_REPAIRS = 2;
const MAX_LEAK_REGENERATIONS = 2;
const BLIND_SPOT_MIN_SIM = 0.55;
const PERSONA_IDS = ["E", "B", "F", "C", "G"];
const OLD_HARNESS_IDS = ["A", "B", "C", "D", "E"];
const PERSONA_PREFIXES = {
  E: "tizhi",
  B: "jingli",
  F: "xiaoshou",
  C: "jishu",
  G: "pm"
};
const PERSONA_POOL_PATH = path.join(ROOT, "scripts", "sim", "persona_pool.js");
const CAPABILITY_PATH = path.join(ROOT, "data", "capability_groups_v2.json");
const COMPATIBILITY_PATH = path.join(ROOT, "data", "compatibility_rules_v2.json");
const REPORTS_PATH = path.join(ROOT, "game_config_v0.1", "persona_reports_v1.1.json");
const V1_FAILURE_PATH = path.join(__dirname, "ai_generated_persona_maps_v1_2026-07-14_failure.json");
const FROZEN_MAP_PATHS = {
  "草根老板": path.join(__dirname, "cognitive_map_caogen_min.json"),
  "二代接班人": path.join(__dirname, "cognitive_map_erdai_min.json")
};

// Task-local deterministic sector rules, assembled from persona_pool.js industries/backgrounds
// and the repository's market documentation. Broad methods such as "数字化" are deliberately
// excluded because they are not market sectors.
const DOMAIN_RULES = [
  ["养老康养", /养老|康养|护理院|养老院|老年服务|日间照料/],
  ["医疗医药", /医院|医疗|医药|药企|药店|诊所|医疗器械|健康服务/],
  ["教育培训", /学校|教育|培训|教培|幼儿园|高校|课程服务/],
  ["金融保险", /银行|金融|保险|证券|基金|信贷|支付机构/],
  ["零售快消", /零售|门店|商超|快消|便利店|电商|消费品牌/],
  ["汽车出行", /汽车|车企|4S店|出行|交通|充电桩|新能源车/],
  ["地产建筑", /地产|楼盘|物业|建筑|工程公司|基建|施工/],
  ["能源环保", /能源|电力|光伏|风电|环保|污水|碳排/],
  ["农业食品", /农业|农场|种植|养殖|食品|餐饮|农产品/],
  ["物流贸易", /物流|仓储|货运|外贸|贸易|海关|航运/],
  ["文旅酒店", /旅游|景区|酒店|文旅|会展|航空公司/],
  ["媒体文化", /媒体|广告|影视|出版|直播|短视频|文化公司/],
  ["专业服务", /咨询|律所|会计师|审计|猎头|专业服务/],
  ["通信电子", /通信|运营商|电子|家电|手机|消费硬件/],
  ["制造工业", /工厂|制造|产线|车间|机床|零部件|工业设备|质检/],
  ["科技软件", /互联网|软件|SaaS|算法|人工智能|AI公司|科技公司|数据产品/],
  ["政务公共", /政府|机关|央企|国企|公共服务|政务/]
];

const FIXED_GAME_TERMS = [
  ["陪伴机器人", "v2_spec"],
  ["LOVOT", "v2_spec"],
  ["锦囊", "v2_spec"],
  ["12格选择器", "v2_spec"],
  ["ToC", "v2_spec"],
  ["ToB", "v2_spec"]
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
  const args = { runId: RUN_ID, concurrency: 3, summarizeOnly: false, summarizeFailure: false };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--run-id") args.runId = String(argv[++index] || "").trim();
    else if (argv[index] === "--concurrency") args.concurrency = Number(argv[++index]);
    else if (argv[index] === "--summarize-only") args.summarizeOnly = true;
    else if (argv[index] === "--summarize-failure") args.summarizeFailure = true;
    else throw new Error(`unknown argument: ${argv[index]}`);
  }
  if (!args.runId || !Number.isInteger(args.concurrency) || args.concurrency < 1) {
    throw new Error("invalid run id or concurrency");
  }
  return args;
}

function outputPaths(runId) {
  return {
    maps: path.join(__dirname, `${runId}_maps.json`),
    jsonl: path.join(__dirname, `${runId}.jsonl`),
    summary: path.join(__dirname, `${runId}_summary.md`),
    samples: path.join(__dirname, `${runId}_raw_samples.md`),
    meta: path.join(__dirname, `${runId}_meta.json`),
    failure: path.join(__dirname, `${runId}_failure.json`)
  };
}

function loadSeeds() {
  const { PERSONAS } = require("../sim/persona_pool");
  return PERSONA_IDS.map((id) => ({
    id,
    label: PERSONAS[id].label,
    desc: PERSONAS[id].desc,
    prefix: PERSONA_PREFIXES[id],
    comparisonBlindSpot: PERSONAS[id].blindSpots
  }));
}

function buildGameTermCatalog(materials) {
  const rows = FIXED_GAME_TERMS.map(([term, source]) => ({ term, source }));
  for (const group of materials.capabilityGroups.groups || []) {
    rows.push({ term: String(group.name || ""), source: "data/capability_groups_v2.json#group_name" });
    for (const capability of group.capabilities || []) {
      rows.push({ term: String(capability.cap_id || ""), source: "data/capability_groups_v2.json#cap_id" });
      rows.push({ term: String(capability.name || ""), source: "data/capability_groups_v2.json#capability_name" });
    }
  }
  const deduped = new Map();
  for (const row of rows) {
    const key = row.term.toLowerCase();
    if (row.term && !deduped.has(key)) deduped.set(key, row);
  }
  return Array.from(deduped.values());
}

function renderTermList(catalog) {
  return catalog.map((row) => row.term).join("、");
}

function renderDomainList() {
  return DOMAIN_RULES.map(([name]) => name).join("、");
}

function buildBatchPrompt(seeds) {
  return [
    "你是研究用认知地图生成器。只根据下面每个原型的标签和一句话描述，自主推导其人生经验、信条与核心判断盲区。不得使用其他 persona 字段。",
    "【最小种子；这是你能使用的全部人物输入】",
    JSON.stringify(seeds.map(({ label, desc }) => ({ label, desc })), null, 2),
    "五个原型必须在同一次输出中完成。",
    "【地图要求】每个原型严格输出20条经验+5条信条。经验排在前20条，每条18-55字，并至少包含一个具体数字、日期、金额或带量词的中文数字；信条排在后5条。",
    "20条经验必须都是这个人本人亲历、亲自参与或亲眼见证的商业管理事件，不要写成第三方人物案例集。",
    "输出一个可 JSON.parse 的对象，严格使用以下 schema，不要 Markdown，不要解释：",
    '{"personas":[{"label":"原型名","core_blind_spot":"一句话核心判断盲区","items":[{"id":"map_<指定前缀>_01","type":"经验|信条","content":"内容"}]}]}',
    "各原型 id 前缀必须严格如下：",
    seeds.map((seed) => `${seed.label}=map_${seed.prefix}_01...map_${seed.prefix}_25`).join("；")
  ].join("\n");
}

function buildPersonaRegenerationPrompt(seed, gameTerms, reasons, avoidLabels = []) {
  void gameTerms;
  void avoidLabels;
  return [
    "你是研究用认知地图生成器。只根据下面的标签和一句话描述，重新生成这一份完整认知地图。",
    "【最小种子】",
    JSON.stringify({ label: seed.label, desc: seed.desc }, null, 2),
    reasons.length ? `【上次自动校验失败】${reasons.join("；")}` : "",
    "严格输出20条经验+5条信条；经验在前、信条在后。20条经验必须都是这个人本人亲历、亲自参与或亲眼见证的事件，不要写成第三方人物案例集。每条经验18-55字，含具体数字/日期/金额或带量词中文数字。",
    `id 必须严格为 map_${seed.prefix}_01 至 map_${seed.prefix}_25。`,
    '只输出合法 JSON：{"label":"原型名","core_blind_spot":"一句话核心判断盲区","items":[{"id":"...","type":"经验|信条","content":"..."}]}'
  ].filter(Boolean).join("\n");
}

function buildNumericRepairPrompt(seed, candidate, failures, gameTerms) {
  void gameTerms;
  return [
    `只修复“${seed.label}”地图中以下缺少明确数字的经验，不要改其他条目，也不要改变人物的核心判断盲区。`,
    "待修复条目：",
    JSON.stringify(failures.map((item) => ({ id: item.id, content: item.content })), null, 2),
    "每条新内容18-55字，保留原事件含义和行业，补入可信的具体数字、日期、金额或带量词中文数字。",
    `上下文盲区（仅用于保持一致）：${candidate.core_blind_spot}`,
    '只输出合法 JSON：{"repairs":[{"id":"原id","content":"修复后的完整内容"}]}'
  ].join("\n");
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

function normalizeCandidate(raw, seed) {
  if (!raw || typeof raw !== "object") throw new Error(`${seed.label}: persona must be an object`);
  const label = requireText(raw.label, `${seed.label}.label`);
  if (label !== seed.label) throw new Error(`${seed.label}: label mismatch ${label}`);
  const coreBlindSpot = requireText(raw.core_blind_spot, `${seed.label}.core_blind_spot`);
  if (!Array.isArray(raw.items) || raw.items.length !== 25) {
    throw new Error(`${seed.label}: expected exactly 25 map items`);
  }
  const items = raw.items.map((item, index) => {
    const expectedId = `map_${seed.prefix}_${String(index + 1).padStart(2, "0")}`;
    const id = requireText(item?.id, `${seed.label}.items[${index}].id`);
    const type = requireText(item?.type, `${seed.label}.items[${index}].type`);
    const content = requireText(item?.content, `${seed.label}.items[${index}].content`);
    if (id !== expectedId) throw new Error(`${seed.label}: expected id ${expectedId}, got ${id}`);
    const expectedType = index < 20 ? "经验" : "信条";
    if (type !== expectedType) throw new Error(`${seed.label}: ${id} must be ${expectedType}`);
    return { id, type, content };
  });
  if (new Set(items.map((item) => item.content)).size !== items.length) {
    throw new Error(`${seed.label}: duplicate map content`);
  }
  return { label, desc: seed.desc, core_blind_spot: coreBlindSpot, items };
}

function hasConcreteNumber(text) {
  const value = String(text || "");
  if (/[0-9０-９]+(?:[.,，][0-9０-９]+)?/.test(value)) return true;
  return /(?:第)?[零〇一二两三四五六七八九十百千万亿]+(?:年|月|日|天|周|次|个|位|名|家|份|笔|单|元|块|万元|亿元|成|折|小时|分钟|岁|公里|吨|台|套|页|人|件|%)/.test(value);
}

function numericFailures(candidate) {
  return candidate.items.filter((item) => item.type === "经验" && !hasConcreteNumber(item.content));
}

function scanGameTerms(candidate, catalog) {
  const text = JSON.stringify({ core_blind_spot: candidate.core_blind_spot, items: candidate.items }).toLowerCase();
  return catalog.filter((row) => text.includes(row.term.toLowerCase()));
}

function auditDomains(candidate) {
  const experiences = candidate.items.filter((item) => item.type === "经验");
  const counts = Object.fromEntries(DOMAIN_RULES.map(([name]) => [name, 0]));
  const itemMatches = [];
  for (const item of experiences) {
    const primary = DOMAIN_RULES.find(([, pattern]) => pattern.test(item.content));
    const domains = primary ? [primary[0]] : [];
    domains.forEach((name) => { counts[name] += 1; });
    itemMatches.push({ id: item.id, domains });
  }
  const concentrationsAbove4 = Object.entries(counts)
    .filter(([, count]) => count > 4)
    .map(([domain, count]) => ({ domain, count, reference: 4 }));
  const maxDomain = Object.entries(counts)
    .reduce((best, [domain, count]) => count > best.count ? { domain, count } : best, { domain: "", count: 0 });
  return {
    counts,
    itemMatches,
    classifiedExperiences: itemMatches.filter((item) => item.domains.length > 0).length,
    unclassifiedExperiences: itemMatches.filter((item) => item.domains.length === 0).length,
    maxDomain,
    concentrationsAbove4,
    violations: concentrationsAbove4,
    advisoryOnly: true,
    valid: true
  };
}

function localAudit(candidate, catalog) {
  const numbers = numericFailures(candidate);
  const gameHits = scanGameTerms(candidate, catalog);
  const domains = auditDomains(candidate);
  const hardValid = numbers.length === 0 && gameHits.length === 0;
  return {
    valid: hardValid,
    hardValid,
    numberFailures: numbers.map((item) => ({ id: item.id, content: item.content })),
    gameTermHits: gameHits,
    domainAudit: domains
  };
}

async function callJsonWithRepairs(chatCompletion, prompt, validate, calls, kind, maxTokens = 8192) {
  let messages = [{ role: "user", content: prompt }];
  let raw = "";
  let lastError = null;
  for (let attempt = 0; attempt <= MAX_JSON_REPAIRS; attempt += 1) {
    try {
      raw = await chatCompletion(messages, { temperature: TEMPERATURE, max_tokens: maxTokens, maxRetries: 1 });
      const parsed = parseJsonObject(raw);
      const value = validate(parsed);
      calls.push({ kind, attempt: attempt + 1, prompt, raw_response: raw, status: "OK", error: "" });
      return value;
    } catch (error) {
      lastError = error;
      calls.push({ kind, attempt: attempt + 1, prompt, raw_response: raw, status: "FAIL", error: String(error.message || error) });
      if (attempt < MAX_JSON_REPAIRS) {
        messages = [
          { role: "user", content: prompt },
          { role: "assistant", content: raw || "(空输出)" },
          { role: "user", content: `自动校验失败：${error.message || error}。只修正 JSON 和失败字段，其他内容保持不变。` }
        ];
      }
    }
  }
  throw new Error(`${kind} failed after repairs: ${lastError?.message || lastError}`);
}

function validateBatch(parsed, seeds) {
  if (!Array.isArray(parsed.personas) || parsed.personas.length !== seeds.length) {
    throw new Error(`batch must contain exactly ${seeds.length} personas`);
  }
  const byLabel = new Map(parsed.personas.map((item) => [String(item?.label || "").trim(), item]));
  return seeds.map((seed) => normalizeCandidate(byLabel.get(seed.label), seed));
}

async function repairNumbers(chatCompletion, seed, candidate, failures, gameTerms, calls) {
  const prompt = buildNumericRepairPrompt(seed, candidate, failures, gameTerms);
  const repaired = await callJsonWithRepairs(chatCompletion, prompt, (parsed) => {
    if (!Array.isArray(parsed.repairs) || parsed.repairs.length !== failures.length) {
      throw new Error(`numeric repair expected ${failures.length} rows`);
    }
    const expected = new Set(failures.map((item) => item.id));
    const rows = parsed.repairs.map((item, index) => ({
      id: requireText(item?.id, `repairs[${index}].id`),
      content: requireText(item?.content, `repairs[${index}].content`)
    }));
    if (new Set(rows.map((item) => item.id)).size !== expected.size || rows.some((item) => !expected.has(item.id))) {
      throw new Error("numeric repair ids must exactly match failing ids");
    }
    if (rows.some((item) => !hasConcreteNumber(item.content))) throw new Error("numeric repair still lacks a concrete number");
    return rows;
  }, calls, `numeric_repair:${seed.label}`, 2500);
  const replacements = new Map(repaired.map((item) => [item.id, item.content]));
  return normalizeCandidate({
    ...candidate,
    items: candidate.items.map((item) => replacements.has(item.id) ? { ...item, content: replacements.get(item.id) } : item)
  }, seed);
}

async function regeneratePersona(chatCompletion, seed, gameTerms, reasons, avoidLabels, calls, kind) {
  const prompt = buildPersonaRegenerationPrompt(seed, gameTerms, reasons, avoidLabels);
  return callJsonWithRepairs(
    chatCompletion,
    prompt,
    (parsed) => normalizeCandidate(parsed, seed),
    calls,
    `${kind}:${seed.label}`,
    5000
  );
}

async function ensureLocalValidity(chatCompletion, seed, initial, gameTerms, calls, counters) {
  let candidate = initial;
  let leakRegenerations = calls.filter((call) => call.kind === `leak_regeneration:${seed.label}` && call.status === "OK").length;
  while (true) {
    let audit = localAudit(candidate, gameTerms);
    if (audit.numberFailures.length > 0) {
      candidate = await repairNumbers(chatCompletion, seed, candidate, audit.numberFailures, gameTerms, calls);
      counters.numericRepairs += 1;
      audit = localAudit(candidate, gameTerms);
    }
    if (audit.valid) return { candidate, audit };
    if (audit.gameTermHits.length === 0) {
      throw new Error(`${seed.label}: hard validation failed without a recoverable reason: ${JSON.stringify(audit)}`);
    }
    if (leakRegenerations >= MAX_LEAK_REGENERATIONS) {
      throw new Error(`${seed.label}: game-content leak persists after ${leakRegenerations} regenerations: ${JSON.stringify(audit.gameTermHits)}`);
    }
    candidate = await regeneratePersona(chatCompletion, seed, gameTerms, ["真实游戏内容泄露，需要完整重写"], [], calls, "leak_regeneration");
    leakRegenerations += 1;
    counters.leakRegenerations += 1;
  }
}

async function createSimilarityRuntime() {
  const scorer = require("../../server/llm/vpWordScorer");
  const embeddingService = require("../../server/llm/embeddingService");
  await embeddingService.init();
  async function compare(textA, textB) {
    const [vectorA, vectorB] = await Promise.all([
      embeddingService.embed(textA),
      embeddingService.embed(textB)
    ]);
    const result = await scorer.wordMatchScore(
      { words: [textA], vecs: [vectorA] },
      { words: [textB], vecs: [vectorB] },
      new Set(),
      BLIND_SPOT_MIN_SIM
    );
    const detail = result.matchDetails[0] || { bestSim: 0, qualified: false };
    return { similarity: detail.bestSim, conflict: Boolean(detail.qualified) };
  }
  return { compare };
}

async function allBlindSpotPairs(candidates, similarityRuntime) {
  const report = await buildBlindSpotSimilarityReport(candidates, similarityRuntime);
  return report.pairs;
}

async function buildBlindSpotSimilarityReport(entries, similarityRuntime) {
  const labels = entries.map((entry) => entry.label);
  const matrix = labels.map((label, index) => labels.map((innerLabel, innerIndex) => (
    index === innerIndex ? 1 : null
  )));
  const pairs = [];
  for (let left = 0; left < entries.length; left += 1) {
    for (let right = left + 1; right < entries.length; right += 1) {
      const compared = await similarityRuntime.compare(
        entries[left].core_blind_spot,
        entries[right].core_blind_spot
      );
      matrix[left][right] = compared.similarity;
      matrix[right][left] = compared.similarity;
      pairs.push({
        left: entries[left].label,
        right: entries[right].label,
        similarity: compared.similarity,
        conflict: compared.conflict
      });
    }
  }
  return {
    threshold: BLIND_SPOT_MIN_SIM,
    labels,
    matrix,
    pairs,
    aboveThresholdPairs: pairs.filter((pair) => pair.conflict),
    advisoryOnly: true
  };
}

function loadOldHarnessBlindSpots() {
  const { PERSONAS } = require("../sim/persona_pool");
  return OLD_HARNESS_IDS.map((id) => ({
    id,
    label: PERSONAS[id].label,
    core_blind_spot: PERSONAS[id].blindSpots
  }));
}

async function generateMaps(chatCompletion, seeds, materials, calls, resumedCandidates = null) {
  const gameTerms = buildGameTermCatalog(materials);
  const batchPrompt = buildBatchPrompt(seeds);
  let candidates = resumedCandidates || await callJsonWithRepairs(
      chatCompletion,
      batchPrompt,
      (parsed) => validateBatch(parsed, seeds),
      calls,
      "initial_batch",
      8192
    );
  const audits = {};
  const counters = {
    numericRepairs: calls.filter((call) => call.kind.startsWith("numeric_repair:") && call.status === "OK").length,
    leakRegenerations: calls.filter((call) => call.kind.startsWith("leak_regeneration:") && call.status === "OK").length
  };
  for (let index = 0; index < seeds.length; index += 1) {
    const local = await ensureLocalValidity(chatCompletion, seeds[index], candidates[index], gameTerms, calls, counters);
    candidates[index] = local.candidate;
    audits[seeds[index].label] = local.audit;
  }
  const similarityRuntime = await createSimilarityRuntime();
  const generatedBlindSpotSimilarity = await buildBlindSpotSimilarityReport(candidates, similarityRuntime);
  const oldHarnessBlindSpotSimilarity = await buildBlindSpotSimilarityReport(loadOldHarnessBlindSpots(), similarityRuntime);
  for (const candidate of candidates) {
    audits[candidate.label] = localAudit(candidate, gameTerms);
    if (!audits[candidate.label].valid) throw new Error(`${candidate.label}: final local audit failed`);
  }
  const expectedDirection = [];
  for (let index = 0; index < seeds.length; index += 1) {
    const compared = await similarityRuntime.compare(
      candidates[index].core_blind_spot,
      seeds[index].comparisonBlindSpot
    );
    expectedDirection.push({
      label: seeds[index].label,
      generated: candidates[index].core_blind_spot,
      harness_reference: seeds[index].comparisonBlindSpot,
      similarity: compared.similarity,
      meets_0_55: compared.conflict
    });
  }
  return {
    seeds: seeds.map(({ id, label, desc, prefix }) => ({ id, label, desc, prefix })),
    candidates,
    audits,
    blindSpotPairs: generatedBlindSpotSimilarity.pairs,
    generatedBlindSpotSimilarity,
    oldHarnessBlindSpotSimilarity,
    conflictRetries: Object.fromEntries(seeds.map((seed) => [seed.label, 0])),
    counters,
    expectedDirection,
    gameTerms,
    batchPrompt,
    comparisonNote: "No Claude draft map files were present in the workspace; persona_pool.js blindSpots were used post-generation as a descriptive direction reference only."
  };
}

async function runChainStep(chatCompletion, point, task, materials, stack) {
  const prompt = Pilot.buildPilotPrompt(point, task, materials, stack);
  let messages = [{ role: "user", content: prompt }];
  let raw = "";
  let lastError = null;
  for (let attempt = 0; attempt <= MAX_JSON_REPAIRS; attempt += 1) {
    try {
      raw = await chatCompletion(messages, {
        temperature: CHAIN_TEMPERATURE,
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
        attempts: attempt + 1,
        error: ""
      };
    } catch (error) {
      lastError = error;
      if (attempt < MAX_JSON_REPAIRS) {
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
    attempts: MAX_JSON_REPAIRS + 1,
    error: String(lastError?.message || lastError || "unknown error")
  };
}

function extractChainMetrics(row, materials) {
  const cumulativeSources = new Set();
  const steps = row.steps.map((step) => {
    const parsed = step.parsed;
    const validMapIds = new Set(materials.maps[row.persona].map((item) => item.id));
    Effort.collectMapSources(parsed, validMapIds).forEach((id) => cumulativeSources.add(id));
    const constraints = Effort.constraintOutputForStep(step.decision_point, parsed);
    const themes = Effort.themeNames(constraints);
    const cards = step.decision_point === "D4" ? parsed.cards : [];
    const dimensions = new Set(cards.map((card) => materials.groupByCapability.get(card.id)?.group_id).filter(Boolean));
    const tiers = cards.reduce((out, card) => {
      out[card.tier] = (out[card.tier] || 0) + 1;
      return out;
    }, { low: 0, mid: 0, high: 0 });
    return {
      decision_point: step.decision_point,
      map_reference_breadth: cumulativeSources.size,
      constraint_count: constraints.length,
      theme_names: themes,
      theme_breadth: themes.length,
      card_count: cards.length,
      card_dimension_count: dimensions.size,
      tier_counts: tiers
    };
  });
  return {
    steps,
    theme_trajectory_signature: JSON.stringify(steps.map((step) => step.theme_names))
  };
}

async function runValidationChain(chatCompletion, candidate, materials, runId) {
  const task = { archetype: candidate.label, condition: CONDITION, rep: 1 };
  const steps = [];
  const stack = [];
  for (const point of DECISION_POINTS) {
    const step = await runChainStep(chatCompletion, point, task, materials, stack);
    steps.push(step);
    if (step.status !== "OK") {
      return {
        run_id: runId,
        created_at: new Date().toISOString(),
        persona: candidate.label,
        condition: CONDITION,
        rep: 1,
        status: "FAIL",
        steps,
        metrics: null,
        decision_calls: steps.reduce((sum, item) => sum + item.attempts, 0),
        error: `${point}: ${step.error}`
      };
    }
    stack.push(step.stack_record);
  }
  const row = {
    run_id: runId,
    created_at: new Date().toISOString(),
    persona: candidate.label,
    condition: CONDITION,
    rep: 1,
    status: "OK",
    steps,
    final_stack: stack,
    metrics: null,
    decision_calls: steps.reduce((sum, item) => sum + item.attempts, 0),
    error: ""
  };
  row.metrics = extractChainMetrics(row, materials);
  return row;
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

function chainDifferentiation(rows) {
  const successful = rows.filter((row) => row.status === "OK");
  const signatures = successful.map((row) => ({ persona: row.persona, signature: row.metrics.theme_trajectory_signature }));
  const duplicatePairs = [];
  for (let left = 0; left < signatures.length; left += 1) {
    for (let right = left + 1; right < signatures.length; right += 1) {
      if (signatures[left].signature === signatures[right].signature) {
        duplicatePairs.push([signatures[left].persona, signatures[right].persona]);
      }
    }
  }
  return {
    successful: successful.length,
    uniqueThemeTrajectories: new Set(signatures.map((item) => item.signature)).size,
    duplicatePairs,
    allDistinct: successful.length === 5 && duplicatePairs.length === 0
  };
}

function gitText(args) {
  const result = spawnSync("git", args, { cwd: ROOT, encoding: "utf8" });
  return result.status === 0 ? result.stdout : "";
}

function writeJsonl(filePath, rows) {
  fs.writeFileSync(filePath, rows.map((row) => JSON.stringify(row)).join("\n") + "\n", "utf8");
}

function writeRawSamples(filePath, generation, calls, rows) {
  const lines = [
    "# AI Generated Persona Maps v1 Raw Samples",
    "",
    "## Map-generation calls",
    ""
  ];
  calls.forEach((call, index) => {
    lines.push(
      `### Generation call ${index + 1}: ${call.kind} / attempt ${call.attempt} / ${call.status}`,
      "",
      call.error ? `Error: ${call.error}` : "",
      "",
      "**Prompt**",
      "",
      "```text",
      call.prompt,
      "```",
      "",
      "**Raw response**",
      "",
      "```json",
      call.raw_response,
      "```",
      ""
    );
  });
  lines.push("## Final map audits", "", "```json", JSON.stringify({
    audits: generation.audits,
    blindSpotPairs: generation.blindSpotPairs,
    conflictRetries: generation.conflictRetries,
    expectedDirection: generation.expectedDirection
  }, null, 2), "```", "");
  for (const row of rows) {
    lines.push(`## Validation chain: ${row.persona}`, "", `Status: ${row.status}`, "");
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
    if (row.metrics) lines.push("### Post-processed metrics", "", "```json", JSON.stringify(row.metrics, null, 2), "```", "");
  }
  fs.writeFileSync(filePath, lines.filter((line) => line !== undefined).join("\n") + "\n", "utf8");
}

function writeSummary(filePath, generation, rows, meta) {
  const lines = [
    "# AI Generated Persona Maps v1 Summary",
    "",
    `- Run: \`${meta.runId}\``,
    `- Maps passed all automatic checks: ${meta.mapsPassed}/5`,
    `- D1-D4 validation chains completed: ${meta.completedChains}/5`,
    `- Initial generation was one five-persona batch call; later calls are recorded repairs/regenerations.`,
    `- Claude draft files were not found in the workspace. Existing persona_pool.js blindSpots were used only after generation as a descriptive direction reference.`,
    "",
    "## 1. Automatic Map Validation",
    "",
    "| Persona | Blind spot | Number failures | Game hits | Max sector count | Classified experiences | Local regen | Blind-spot regen |",
    "|---|---|---:|---:|---:|---:|---:|---:|"
  ];
  for (const candidate of generation.candidates) {
    const audit = generation.audits[candidate.label];
    const maxSector = Math.max(...Object.values(audit.domainAudit.counts));
    const localCalls = meta.regenerationByPersona[candidate.label]?.local || 0;
    const blindCalls = generation.conflictRetries[candidate.label] || 0;
    lines.push(`| ${candidate.label} | ${candidate.core_blind_spot} | ${audit.numberFailures.length} | ${audit.gameTermHits.length} | ${maxSector} | ${audit.domainAudit.classifiedExperiences}/20 | ${localCalls} | ${blindCalls} |`);
  }
  lines.push(
    "",
    `Blind-spot pair rule: the existing scorer's cosine match qualifies at minSim=${BLIND_SPOT_MIN_SIM}.`,
    "",
    "| Persona A | Persona B | Similarity | Conflict |",
    "|---|---|---:|---|"
  );
  for (const pair of generation.blindSpotPairs) {
    lines.push(`| ${pair.left} | ${pair.right} | ${pair.similarity.toFixed(2)} | ${pair.conflict ? "YES" : "no"} |`);
  }
  lines.push(
    "",
    "## 2. D1-D4 Theme and Selection Differentiation",
    "",
    "| Persona | D1 themes | D2 themes | D3 themes | D4 themes | Cards | Tier low/mid/high | Dimensions |",
    "|---|---|---|---|---|---:|---:|---:|"
  );
  for (const row of rows) {
    if (row.status !== "OK") {
      lines.push(`| ${row.persona} | FAIL | FAIL | FAIL | FAIL | - | - | - |`);
      continue;
    }
    const byPoint = Object.fromEntries(row.metrics.steps.map((step) => [step.decision_point, step]));
    const d4 = byPoint.D4;
    lines.push(`| ${row.persona} | ${byPoint.D1.theme_names.join("、") || "无"} | ${byPoint.D2.theme_names.join("、") || "无"} | ${byPoint.D3.theme_names.join("、") || "无"} | ${d4.theme_names.join("、") || "无"} | ${d4.card_count} | ${d4.tier_counts.low}/${d4.tier_counts.mid}/${d4.tier_counts.high} | ${d4.card_dimension_count} |`);
  }
  lines.push(
    "",
    `- Exact theme-trajectory signatures: ${meta.differentiation.uniqueThemeTrajectories}/5 unique.`,
    `- Duplicate theme trajectories: ${meta.differentiation.duplicatePairs.length ? meta.differentiation.duplicatePairs.map((pair) => pair.join(" vs ")).join("；") : "none"}.`,
    "",
    "## 3. Post-generation Direction Reference",
    "",
    "This comparison did not enter generation or validation. It is descriptive only and uses the old harness because no Claude draft files were available.",
    "",
    "| Persona | Generated blind spot | Existing harness direction | Similarity | >=0.55 |",
    "|---|---|---|---:|---|"
  );
  for (const row of generation.expectedDirection) {
    lines.push(`| ${row.label} | ${row.generated} | ${row.harness_reference} | ${row.similarity.toFixed(2)} | ${row.meets_0_55 ? "yes" : "no"} |`);
  }
  const observation = meta.differentiation.allDistinct
    ? "最小种子生成的五张地图在本轮 D1-D4 中形成了五条不同的主题轨迹；这是 N=1 的描述性通过，不构成稳定性或统计结论。"
    : "至少两张地图在本轮形成了相同主题轨迹；本轮尚未通过“彼此可辨”的直接检验。";
  lines.push("", "## 4. One-sentence Observation", "", `> ${observation}`, "");
  fs.writeFileSync(filePath, lines.join("\n") + "\n", "utf8");
}

function buildMeta(args, paths, generation, rows, calls) {
  const differentiation = chainDifferentiation(rows);
  const gitCommit = gitText(["rev-parse", "HEAD"]).trim();
  const commitObject = gitText(["cat-file", "commit", "HEAD"]);
  const gitStatus = gitText(["status", "--porcelain"]);
  const regenerationByPersona = Object.fromEntries(generation.candidates.map((candidate) => [candidate.label, {
    local: calls.filter((call) => call.kind === `local_regeneration:${candidate.label}` && call.status === "OK").length,
    blindSpot: generation.conflictRetries[candidate.label] || 0,
    numeric: calls.filter((call) => call.kind === `numeric_repair:${candidate.label}` && call.status === "OK").length
  }]));
  const invalidReferenceDetails = Pilot.auditReferences(rows, {
    ...Pilot.loadPilotMaterials(),
    maps: Object.fromEntries(generation.candidates.map((candidate) => [candidate.label, candidate.items]))
  });
  let priorFailure = null;
  if (fs.existsSync(paths.failure)) {
    const failure = JSON.parse(fs.readFileSync(paths.failure, "utf8"));
    priorFailure = {
      file: path.relative(ROOT, paths.failure),
      sha256: fileSha256(paths.failure),
      createdAt: failure.createdAt,
      stage: failure.stage,
      error: String(failure.error || "").split("\n")[0]
    };
  }
  return {
    runId: args.runId,
    createdAt: new Date().toISOString(),
    paths,
    gitCommit,
    gitCommitObjectSha256: commitObject ? sha256(commitObject) : null,
    gitStatusPorcelainSha256: sha256(gitStatus),
    script: { file: path.relative(ROOT, __filename), sha256: fileSha256(__filename) },
    inputs: {
      personaPool: { file: path.relative(ROOT, PERSONA_POOL_PATH), sha256: fileSha256(PERSONA_POOL_PATH) },
      personaReports: { file: path.relative(ROOT, REPORTS_PATH), sha256: fileSha256(REPORTS_PATH) },
      capabilityGroups: { file: path.relative(ROOT, CAPABILITY_PATH), sha256: fileSha256(CAPABILITY_PATH) },
      compatibilityRules: { file: path.relative(ROOT, COMPATIBILITY_PATH), sha256: fileSha256(COMPATIBILITY_PATH) },
      frozenMapsUnchanged: Object.fromEntries(Object.entries(FROZEN_MAP_PATHS).map(([label, file]) => [label, {
        file: path.relative(ROOT, file), sha256: fileSha256(file)
      }]))
    },
    generatedMaps: {
      file: path.relative(ROOT, paths.maps),
      sha256: fileSha256(paths.maps),
      personaSha256: Object.fromEntries(generation.candidates.map((candidate) => [
        candidate.label,
        sha256(JSON.stringify(candidate.items))
      ]))
    },
    condition: CONDITION,
    mapGeneration: {
      initialBatchCalls: calls.filter((call) => call.kind === "initial_batch").length,
      successfulInitialBatchCalls: calls.filter((call) => call.kind === "initial_batch" && call.status === "OK").length,
      totalGenerationCalls: calls.length,
      counters: generation.counters,
      regenerationByPersona,
      blindSpotMinSim: BLIND_SPOT_MIN_SIM,
      gameTermCatalogSha256: sha256(JSON.stringify(generation.gameTerms)),
      gameTermCatalog: generation.gameTerms,
      domainRulesSha256: sha256(DOMAIN_RULES.map(([name, pattern]) => [name, pattern.source]).join("\n")),
      domainRules: DOMAIN_RULES.map(([name, pattern]) => ({ name, pattern: pattern.source }))
    },
    mapsPassed: generation.candidates.filter((candidate) => generation.audits[candidate.label]?.valid).length,
    requestedChains: 5,
    completedChains: rows.filter((row) => row.status === "OK").length,
    failedChains: rows.filter((row) => row.status !== "OK").length,
    chainDecisionCalls: rows.reduce((sum, row) => sum + Number(row.decision_calls || 0), 0),
    invalidReferences: invalidReferenceDetails.length,
    invalidReferenceDetails,
    differentiation,
    comparisonNote: generation.comparisonNote,
    priorFailure
  };
}

function loadRunArtifacts(paths) {
  const maps = JSON.parse(fs.readFileSync(paths.maps, "utf8"));
  const rows = fs.readFileSync(paths.jsonl, "utf8").split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
  return { generation: maps.generation, calls: maps.calls, rows };
}

function restoreSuccessfulInitialBatch(filePath, seeds) {
  if (!fs.existsSync(filePath)) return null;
  const failure = JSON.parse(fs.readFileSync(filePath, "utf8"));
  const successfulBatch = (failure.calls || []).find((call) => call.kind === "initial_batch" && call.status === "OK");
  if (!successfulBatch) return null;
  return {
    candidates: validateBatch(parseJsonObject(successfulBatch.raw_response), seeds),
    call: {
      ...successfulBatch,
      restoredFrom: path.relative(ROOT, filePath)
    }
  };
}

function buildFailureReport(paths, seeds, materials) {
  if (!fs.existsSync(paths.failure)) throw new Error(`failure artifact not found: ${paths.failure}`);
  const failure = JSON.parse(fs.readFileSync(paths.failure, "utf8"));
  const calls = Array.isArray(failure.calls) ? failure.calls : [];
  const successfulBatch = [...calls].reverse().find((call) => call.kind === "initial_batch" && call.status === "OK");
  if (!successfulBatch) throw new Error("failure artifact has no successful initial batch to audit");
  const initial = validateBatch(parseJsonObject(successfulBatch.raw_response), seeds);
  const catalog = buildGameTermCatalog(materials);
  const finalCandidates = initial.map((candidate, index) => {
    const seed = seeds[index];
    const latest = [...calls].reverse().find((call) => (
      call.status === "OK" &&
      (call.kind === `local_regeneration:${seed.label}` || call.kind === `blind_spot_regeneration:${seed.label}`)
    ));
    return latest ? normalizeCandidate(parseJsonObject(latest.raw_response), seed) : candidate;
  });
  const blocker = seeds.find((seed) => String(failure.error || "").includes(`${seed.label}:`))?.label || "unknown";
  const blockerIndex = seeds.findIndex((seed) => seed.label === blocker);
  const personaStatus = Object.fromEntries(seeds.map((seed, index) => [seed.label,
    index < blockerIndex ? "PASSED_LOCAL_BEFORE_STOP" : (index === blockerIndex ? "BLOCKED" : "NOT_EVALUATED")
  ]));
  const audits = Object.fromEntries(finalCandidates.map((candidate) => [candidate.label, localAudit(candidate, catalog)]));
  const retryCounts = Object.fromEntries(seeds.map((seed) => [seed.label, {
    local: calls.filter((call) => call.kind === `local_regeneration:${seed.label}` && call.status === "OK").length,
    numeric: calls.filter((call) => call.kind === `numeric_repair:${seed.label}` && call.status === "OK").length,
    blindSpot: calls.filter((call) => call.kind === `blind_spot_regeneration:${seed.label}` && call.status === "OK").length
  }]));
  return { failure, calls, finalCandidates, blocker, personaStatus, audits, retryCounts, catalog };
}

function writeFailureRawSamples(filePath, report) {
  const lines = ["# AI Generated Persona Maps v1 Failure Raw Samples", ""];
  report.calls.forEach((call, index) => {
    lines.push(
      `## Call ${index + 1}: ${call.kind} / attempt ${call.attempt} / ${call.status}`,
      "",
      call.error ? `Error: ${call.error}` : "",
      "",
      "**Prompt**",
      "",
      "```text",
      call.prompt,
      "```",
      "",
      "**Raw response**",
      "",
      "```json",
      call.raw_response,
      "```",
      ""
    );
  });
  lines.push("## Stop record", "", "```json", JSON.stringify({
    blocker: report.blocker,
    personaStatus: report.personaStatus,
    retryCounts: report.retryCounts,
    audits: report.audits,
    error: report.failure.error
  }, null, 2), "```", "");
  fs.writeFileSync(filePath, lines.join("\n") + "\n", "utf8");
}

function writeFailureSummary(filePath, report, meta) {
  const lines = [
    "# AI Generated Persona Maps v1 — Stopped Failure Report",
    "",
    `- Run: \`${meta.runId}\``,
    "- Status: **FAIL (automatic stop; no map set released)**",
    `- Blocker: ${report.blocker}`,
    `- Successful initial five-persona batch output: yes, after ${meta.initialBatchAttempts} API/schema attempts.`,
    `- Local maps passing before stop: ${meta.localPassedBeforeStop}/5; blocked: 1; not evaluated: ${meta.notEvaluated}/5.`,
    "- Blind-spot embedding validation: not reached.",
    "- D1-D4 downstream validation: not run.",
    "",
    "## Per-persona stop state",
    "",
    "| Persona | State | Local regenerations | Numeric repairs | Game hits in latest candidate | Domain violations in latest candidate |",
    "|---|---|---:|---:|---|---|"
  ];
  for (const candidate of report.finalCandidates) {
    const audit = report.audits[candidate.label];
    const retries = report.retryCounts[candidate.label];
    lines.push(`| ${candidate.label} | ${report.personaStatus[candidate.label]} | ${retries.local} | ${retries.numeric} | ${audit.gameTermHits.map((item) => item.term).join("、") || "0"} | ${audit.domainAudit.violations.map((item) => `${item.domain}=${item.count}>4`).join("、") || "0"} |`);
  }
  const blockedAudit = report.audits[report.blocker];
  lines.push(
    "",
    "## Stop reason",
    "",
    `The latest ${report.blocker} candidate still hit game terms: ${blockedAudit.gameTermHits.map((item) => item.term).join("、") || "none"}.`,
    `Its sector violations were: ${blockedAudit.domainAudit.violations.map((item) => `${item.domain} ${item.count}/20`).join("；") || "none"}.`,
    "",
    `> 在最小输入和无人工逐条修订条件下，当前生成流程未能让五张地图全部越过机械质量门槛；按规格停机，不能据此运行或解释下游 persona 分化。`,
    ""
  );
  fs.writeFileSync(filePath, lines.join("\n") + "\n", "utf8");
}

function writeFailureMeta(args, paths, report) {
  const gitCommit = gitText(["rev-parse", "HEAD"]).trim();
  const commitObject = gitText(["cat-file", "commit", "HEAD"]);
  const gitStatus = gitText(["status", "--porcelain"]);
  const localPassedBeforeStop = Object.values(report.personaStatus).filter((status) => status === "PASSED_LOCAL_BEFORE_STOP").length;
  const notEvaluated = Object.values(report.personaStatus).filter((status) => status === "NOT_EVALUATED").length;
  const meta = {
    runId: args.runId,
    createdAt: new Date().toISOString(),
    status: "FAIL",
    stage: report.failure.stage,
    blocker: report.blocker,
    paths,
    gitCommit,
    gitCommitObjectSha256: commitObject ? sha256(commitObject) : null,
    gitStatusPorcelainSha256: sha256(gitStatus),
    script: { file: path.relative(ROOT, __filename), sha256: fileSha256(__filename) },
    failureArtifact: { file: path.relative(ROOT, paths.failure), sha256: fileSha256(paths.failure) },
    inputs: {
      personaPool: { file: path.relative(ROOT, PERSONA_POOL_PATH), sha256: fileSha256(PERSONA_POOL_PATH) },
      personaReports: { file: path.relative(ROOT, REPORTS_PATH), sha256: fileSha256(REPORTS_PATH) },
      capabilityGroups: { file: path.relative(ROOT, CAPABILITY_PATH), sha256: fileSha256(CAPABILITY_PATH) },
      compatibilityRules: { file: path.relative(ROOT, COMPATIBILITY_PATH), sha256: fileSha256(COMPATIBILITY_PATH) },
      frozenMapsUnchanged: Object.fromEntries(Object.entries(FROZEN_MAP_PATHS).map(([label, file]) => [label, {
        file: path.relative(ROOT, file), sha256: fileSha256(file)
      }]))
    },
    initialBatchAttempts: report.calls.filter((call) => call.kind === "initial_batch").length,
    successfulInitialBatchOutputs: report.calls.filter((call) => call.kind === "initial_batch" && call.status === "OK").length,
    localPassedBeforeStop,
    blockedMaps: 1,
    notEvaluated,
    releasedMaps: 0,
    blindSpotEmbeddingReached: false,
    downstreamChainsRun: 0,
    retryCounts: report.retryCounts,
    personaStatus: report.personaStatus,
    gameTermCatalogSha256: sha256(JSON.stringify(report.catalog)),
    domainRulesSha256: sha256(DOMAIN_RULES.map(([name, pattern]) => [name, pattern.source]).join("\n")),
    error: String(report.failure.error || "").split("\n")[0]
  };
  writeFailureRawSamples(paths.samples, report);
  writeFailureSummary(paths.summary, report, meta);
  fs.writeFileSync(paths.meta, JSON.stringify(meta, null, 2) + "\n", "utf8");
  return meta;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const paths = outputPaths(args.runId);
  loadLocalEnv();
  const seeds = loadSeeds();
  const materials = Pilot.loadPilotMaterials();
  if (args.summarizeFailure) {
    const report = buildFailureReport(paths, seeds, materials);
    const meta = writeFailureMeta(args, paths, report);
    console.log(JSON.stringify({ paths, meta }, null, 2));
    return;
  }
  let generation;
  let calls;
  let rows;
  if (args.summarizeOnly) {
    ({ generation, calls, rows } = loadRunArtifacts(paths));
  } else {
    const { chatCompletion, hasAnyKey } = require("../../server/llm/deepseekClient");
    if (!hasAnyKey()) throw new Error("DeepSeek API key is required");
    calls = [];
    let resumedCandidates = null;
    if (!fs.existsSync(paths.maps)) {
      const restored = restoreSuccessfulInitialBatch(paths.failure, seeds) ||
        restoreSuccessfulInitialBatch(V1_FAILURE_PATH, seeds);
      if (restored) {
        resumedCandidates = restored.candidates;
        calls = [restored.call];
        console.log(`[ai_generated_persona_maps] restored successful five-persona initial batch from ${restored.call.restoredFrom}`);
      }
    }
    try {
      generation = await generateMaps(chatCompletion, seeds, materials, calls, resumedCandidates);
    } catch (error) {
      fs.writeFileSync(paths.failure, JSON.stringify({
        runId: args.runId,
        createdAt: new Date().toISOString(),
        status: "FAIL",
        stage: "map_generation_or_validation",
        error: String(error.stack || error.message || error),
        calls
      }, null, 2) + "\n", "utf8");
      throw error;
    }
    fs.writeFileSync(paths.maps, JSON.stringify({ generation, calls }, null, 2) + "\n", "utf8");
    const validationMaterials = {
      ...materials,
      maps: {
        ...materials.maps,
        ...Object.fromEntries(generation.candidates.map((candidate) => [candidate.label, candidate.items]))
      }
    };
    rows = [];
    await runPool(generation.candidates, args.concurrency, async (candidate, index) => {
      const row = await runValidationChain(chatCompletion, candidate, validationMaterials, args.runId);
      rows.push(row);
      console.log(`[ai_generated_persona_maps] chain ${index + 1}/5 ${candidate.label} ${row.status} calls=${row.decision_calls}`);
    });
    rows.sort((left, right) => PERSONA_IDS.indexOf(seeds.find((seed) => seed.label === left.persona)?.id) - PERSONA_IDS.indexOf(seeds.find((seed) => seed.label === right.persona)?.id));
    writeJsonl(paths.jsonl, rows);
  }
  if (!fs.existsSync(paths.maps)) {
    fs.writeFileSync(paths.maps, JSON.stringify({ generation, calls }, null, 2) + "\n", "utf8");
  }
  const meta = buildMeta(args, paths, generation, rows, calls);
  writeRawSamples(paths.samples, generation, calls, rows);
  writeSummary(paths.summary, generation, rows, meta);
  fs.writeFileSync(paths.meta, JSON.stringify(meta, null, 2) + "\n", "utf8");
  console.log(JSON.stringify({ paths, meta }, null, 2));
}

module.exports = {
  RUN_ID,
  PERSONA_IDS,
  DOMAIN_RULES,
  FIXED_GAME_TERMS,
  BLIND_SPOT_MIN_SIM,
  outputPaths,
  loadSeeds,
  buildGameTermCatalog,
  buildBatchPrompt,
  normalizeCandidate,
  hasConcreteNumber,
  numericFailures,
  scanGameTerms,
  auditDomains,
  localAudit,
  chainDifferentiation
};

if (require.main === module) {
  main().catch((error) => {
    console.error(error.stack || error.message || String(error));
    process.exitCode = 1;
  });
}
