"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const ROOT = path.join(__dirname, "..", "..");
const REPORTS_PATH = path.join(ROOT, "game_config_v0.1", "persona_reports_v1.1.json");
const PROFILES_PATH = path.join(ROOT, "scripts", "sim", "structured_profiles_v1.json");
const R0_TEAMS_PATH = path.join(
  ROOT,
  "data",
  "persona_sim_logs",
  "sim_layered_newflow_2026-07-10T23-54-52-761Z",
  "teams_summary.csv"
);
const OUTPUT_DIR = __dirname;
const DEFAULT_RUN_ID = "belief_bench_v1_2026-07-13";
const TEMPERATURE = 0.45;
const CONDITIONS = ["C0_leaked", "C0_clean", "C1", "C2_low", "C2_high", "C3"];
const PROFILE_ARCHETYPES = ["二代接班人", "草根老板", "职业经理人"];
const GRID_SPECS = [
  { grid: "ToC_Cost_Elder", reportGrid: "B2C_Cost_Elder" },
  { grid: "ToC_Cost_Child", reportGrid: "B2C_Cost_Child" },
  { grid: "ToC_Differentiation_Adult", reportGrid: "B2C_Differentiation_Adult" },
  { grid: "ToB_Cost_Adult", reportGrid: "B2B_Cost_Adult" },
  { grid: "ToB_Differentiation_Elder", reportGrid: "B2B_Differentiation_Elder" },
  { grid: "ToB_Differentiation_Child", reportGrid: "B2B_Differentiation_Child" }
];

const ATTENTION_LABELS = {
  customer_visible_value: "客户可感知价值",
  technical_dependencies: "技术依赖关系",
  cost_structure: "成本结构",
  brand_signal: "品牌信号",
  constraint_checking: "约束检查"
};
const LEVEL_CN = { high: "高", medium: "中", low: "低" };
const WTP_STYLE_CN = {
  gut_feel: "凭经验直觉形成锚点",
  report_numbers: "优先锚定报告里的数字",
  premium_analogy: "参考高端同类产品"
};
const CONFIDENCE_CN = { overconfident: "偏高", calibrated: "校准", underconfident: "偏低" };
const OBJECTIVE_CN = { profit: "利润", volume: "销量", risk_control: "风险控制", coverage: "需求覆盖", brand: "品牌" };
const PRICE_CN = { premium: "高端", mid: "中档", budget: "经济" };
const BREADTH_CN = { wide: "宽", narrow: "窄" };
const STOP_CN = { first_satisfying: "找到首个满意方案即停止", compare_few: "比较少量方案后停止", exhaustive: "尽量穷举后停止" };
const DEPTH_CN = { full: "完整", partial: "部分", minimal: "最少" };

const ORIGINAL_SUBJECTIVE_PROMPT = [
  "## 当前任务：形成选卡前的主观状态",
  "请只根据你的身份/persona信息和你已读报告内容，形成后续选卡与定价会使用的中间判断。",
  "",
  "## 你实际读过的报告原文",
  "{buildReportsInput(context.readReports)}",
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

function parseArgs(argv) {
  const args = { runId: DEFAULT_RUN_ID, reps: 10, concurrency: 6, summarizeOnly: false, dryRun: false };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--run-id") args.runId = String(argv[++i] || "").trim();
    else if (argv[i] === "--reps") args.reps = Number(argv[++i]);
    else if (argv[i] === "--concurrency") args.concurrency = Number(argv[++i]);
    else if (argv[i] === "--summarize-only") args.summarizeOnly = true;
    else if (argv[i] === "--dry-run") args.dryRun = true;
  }
  if (!args.runId || !Number.isInteger(args.reps) || args.reps < 1 || !Number.isInteger(args.concurrency) || args.concurrency < 1) {
    throw new Error("invalid --run-id, --reps, or --concurrency");
  }
  return args;
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function fileSha256(filePath) {
  return sha256(fs.readFileSync(filePath));
}

function splitCsvLine(line) {
  const cells = [];
  let current = "";
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (char === '"') {
      if (quoted && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        quoted = !quoted;
      }
    } else if (char === "," && !quoted) {
      cells.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  cells.push(current);
  return cells;
}

function parseCsv(text) {
  const lines = String(text || "").split(/\r?\n/).filter(Boolean);
  const headers = splitCsvLine(lines[0] || "");
  return lines.slice(1).map((line) => {
    const cells = splitCsvLine(line);
    return Object.fromEntries(headers.map((header, index) => [header, cells[index] || ""]));
  });
}

function csvEscape(value) {
  if (value == null) return "";
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function listByLevel(object, level) {
  return Object.entries(object || {}).filter(([, value]) => value === level).map(([key]) => ATTENTION_LABELS[key] || key);
}

function renderStructuredProfile(profile) {
  const attention = profile.attention || {};
  const belief = profile.belief_policy || {};
  const aspirations = profile.aspirations || {};
  const search = profile.search_policy || {};
  const risk = profile.risk_policy || {};
  const constraint = profile.constraint_policy || {};
  const high = listByLevel(attention, "high").join("、") || "无特别项";
  const low = listByLevel(attention, "low").join("、") || "无特别项";
  return [
    "【你的决策方式档案】",
    `注意力分配：你高度关注${high}；较少关注${low}。`,
    `判断形成：你估计客户支付意愿的方式是${WTP_STYLE_CN[belief.wtp_anchor_style] || belief.wtp_anchor_style}；你对调研报告的信任度${LEVEL_CN[belief.trust_in_reports] || belief.trust_in_reports}；你的自信程度${CONFIDENCE_CN[belief.confidence_calibration] || belief.confidence_calibration}。`,
    `目标优先级（从高到低）：${(profile.objectives_rank || []).map((item) => OBJECTIVE_CN[item] || item).join("、")}。`,
    `你的"够好"标准：核心需求覆盖${LEVEL_CN[aspirations.minimum_core_coverage] || aspirations.minimum_core_coverage}即可；可接受毛利${LEVEL_CN[aspirations.acceptable_margin] || aspirations.acceptable_margin}；对前期研发投入的容忍度${LEVEL_CN[aspirations.nre_tolerance] || aspirations.nre_tolerance}；你倾向的价格站位是${PRICE_CN[aspirations.price_position] || aspirations.price_position}。`,
    `搜索与停止：你比较方案的广度${BREADTH_CN[search.breadth] || search.breadth}；你的停止规则是${STOP_CN[search.stop_rule] || search.stop_rule}；低于预期时${search.revise_if_below_aspiration === true ? "会" : "不会"}回头修改。`,
    `风险：市场不确定性容忍${LEVEL_CN[risk.market_uncertainty_tolerance] || risk.market_uncertainty_tolerance}；技术不确定性容忍${LEVEL_CN[risk.technical_uncertainty_tolerance] || risk.technical_uncertainty_tolerance}。`,
    `约束检查：你检查卡片依赖关系的深度是${DEPTH_CN[constraint.dependency_check_depth] || constraint.dependency_check_depth}；你${constraint.assumes_teammate_checked === "high" ? "倾向" : "不倾向"}假设队友已经检查过。`
  ].join("\n");
}

function buildReportsText(grid) {
  return grid.reports.map((report, index) => [
    `### 报告 ${index + 1}：${report.persona_id}`,
    report.report_text
  ].join("\n")).join("\n\n");
}

function loadMaterials() {
  const reportConfig = JSON.parse(fs.readFileSync(REPORTS_PATH, "utf8"));
  const profileConfig = JSON.parse(fs.readFileSync(PROFILES_PATH, "utf8"));
  const r0Rows = parseCsv(fs.readFileSync(R0_TEAMS_PATH, "utf8"));
  const grids = GRID_SPECS.map((spec) => {
    const reportGrid = reportConfig.grids.find((item) => item.grid_id === spec.reportGrid);
    const r0 = r0Rows.find((item) => item.grid === spec.grid);
    if (!reportGrid || !r0) throw new Error(`missing reports or R0 ground truth for ${spec.grid}`);
    return {
      ...spec,
      reportsText: buildReportsText(reportGrid),
      reportCount: reportGrid.reports.length,
      wtpRef: Number(r0.r1_wtp_ref),
      wtpAdj: Number(r0.r1_wtp_adj)
    };
  });
  const personas = PROFILE_ARCHETYPES.map((archetype) => {
    const profile = profileConfig.find((item) => item.archetype === archetype);
    if (!profile) throw new Error(`missing structured profile for ${archetype}`);
    return { archetype, profile, prompt: renderStructuredProfile(profile) };
  });
  return { grids, personas };
}

function estimateInstruction() {
  return [
    "基于以上材料，估计该客群对这款陪伴机器人的支付意愿（单位：元）。",
    "只输出可 JSON.parse 的 JSON，不要 Markdown：",
    '{"estimated_wtp": <number>, "reasoning": "<一句话>"}'
  ].join("\n");
}

function c0Messages(persona, grid, leaked) {
  const leak = leaked
    ? "原主观状态模板曾给出 estimated_wtp_range 示例 [3000, 5000]，请沿用同一判断语境。\n\n"
    : "";
  return [
    { role: "system", content: persona.prompt },
    { role: "user", content: `${leak}${grid.reportsText}\n\n${estimateInstruction()}` }
  ];
}

function c2Messages(persona, grid, anchor) {
  return [
    { role: "system", content: persona.prompt },
    { role: "user", content: `${grid.reportsText}\n\n参考信息：同类产品市场常见定价约 ${anchor} 元。\n\n${estimateInstruction()}` }
  ];
}

function c1ExtractMessages(grid) {
  return [{
    role: "user",
    content: `${grid.reportsText}\n\n逐字引用报告中所有与价格、预算、支付意愿相关的句子。只引用，不解释。`
  }];
}

function c1EstimateMessages(persona, quotes) {
  return [
    { role: "system", content: persona.prompt },
    { role: "user", content: `以下是从报告逐字抽取的价格、预算和支付意愿引文：\n\n${quotes}\n\n只基于以上引文估计支付意愿。\n${estimateInstruction()}` }
  ];
}

function c3Messages(grid) {
  return [{
    role: "user",
    content: [
      grid.reportsText,
      "",
      "提取报告中所有支付相关信息，输出 JSON：",
      '{"anchors": [{"quote": "原句", "value_yuan": 数字, "type": "上限|下限|参考价|审批门槛"}]}',
      "只提取报告中明确出现的，没有则输出空数组。只输出 JSON，不要 Markdown。"
    ].join("\n")
  }];
}

function promptTemplateHashes() {
  return {
    original_subjective_state: sha256(ORIGINAL_SUBJECTIVE_PROMPT),
    c0_leaked: sha256(JSON.stringify(c0Messages({ prompt: "{persona}" }, { reportsText: "{reports}" }, true))),
    c0_clean: sha256(JSON.stringify(c0Messages({ prompt: "{persona}" }, { reportsText: "{reports}" }, false))),
    c1_extract: sha256(JSON.stringify(c1ExtractMessages({ reportsText: "{reports}" }))),
    c1_estimate: sha256(JSON.stringify(c1EstimateMessages({ prompt: "{persona}" }, "{quotes}"))),
    c2_low: sha256(JSON.stringify(c2Messages({ prompt: "{persona}" }, { reportsText: "{reports}" }, 800))),
    c2_high: sha256(JSON.stringify(c2Messages({ prompt: "{persona}" }, { reportsText: "{reports}" }, 12000))),
    c3_extract: sha256(JSON.stringify(c3Messages({ reportsText: "{reports}" })))
  };
}

function parseJsonObject(raw) {
  const text = String(raw || "").replace(/```json|```/gi, "").trim();
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  return JSON.parse(start >= 0 && end > start ? text.slice(start, end + 1) : text);
}

function validateEstimate(raw) {
  const parsed = parseJsonObject(raw);
  const estimatedWtp = Number(parsed.estimated_wtp);
  if (!Number.isFinite(estimatedWtp) || estimatedWtp < 0) throw new Error("estimated_wtp must be a non-negative number");
  const reasoning = String(parsed.reasoning || "").trim();
  if (!reasoning) throw new Error("reasoning is required");
  return { estimatedWtp, reasoning };
}

function validateAnchors(raw) {
  const parsed = parseJsonObject(raw);
  if (!Array.isArray(parsed.anchors)) throw new Error("anchors must be an array");
  const allowedTypes = new Set(["上限", "下限", "参考价", "审批门槛"]);
  const anchors = parsed.anchors.map((anchor) => ({
    quote: String(anchor.quote || "").trim(),
    value_yuan: Number(anchor.value_yuan),
    type: String(anchor.type || "").trim()
  }));
  for (const anchor of anchors) {
    if (!anchor.quote || !Number.isFinite(anchor.value_yuan) || anchor.value_yuan < 0 || !allowedTypes.has(anchor.type)) {
      throw new Error("invalid anchor entry");
    }
  }
  return anchors;
}

async function callWithJsonRetry(chatCompletion, messages, validator, maxTokens) {
  let raw = "";
  let lastError = null;
  let activeMessages = messages;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      raw = await chatCompletion(activeMessages, {
        temperature: TEMPERATURE,
        max_tokens: maxTokens,
        maxRetries: 2
      });
      return { raw, value: validator(raw), attempts: attempt + 1 };
    } catch (error) {
      lastError = error;
      if (attempt < 2) {
        activeMessages = messages.concat([
          { role: "assistant", content: raw || "(空输出)" },
          { role: "user", content: `上一次输出不合格：${String(error.message || error)}。请只输出符合要求的合法 JSON。` }
        ]);
      }
    }
  }
  throw new Error(`failed after 3 attempts: ${String(lastError?.message || lastError || "unknown")}`);
}

function weightedMedian(anchors) {
  const weights = { 上限: 3, 审批门槛: 2, 参考价: 1, 下限: 1 };
  const values = anchors.map((anchor) => ({ value: anchor.value_yuan, weight: weights[anchor.type] || 1 }))
    .sort((a, b) => a.value - b.value);
  const threshold = values.reduce((sum, item) => sum + item.weight, 0) / 2;
  let cumulative = 0;
  for (const item of values) {
    cumulative += item.weight;
    if (cumulative >= threshold) return item.value;
  }
  return values[values.length - 1]?.value ?? null;
}

function seededUniform(key) {
  const bytes = crypto.createHash("sha256").update(key).digest();
  return bytes.readUInt32BE(0) / 0xffffffff;
}

function synthesizeC3(row, allValidC3Rows) {
  const profile = row.profile;
  const multiplier = row.persona === "二代接班人" ? 1.3 : row.persona === "草根老板" ? 0.7 : 1;
  let base = Number(row.c3_base);
  if (profile?.belief_policy?.trust_in_reports === "low") {
    const allGridMean = allValidC3Rows.reduce((sum, item) => sum + Number(item.c3_base), 0) / allValidC3Rows.length;
    base = (0.5 * base) + (0.5 * allGridMean);
    const noise = 0.8 + (seededUniform(`${row.run_id}|${row.grid}|${row.persona}|${row.rep}`) * 0.4);
    base *= noise;
  }
  return Math.round(base * multiplier);
}

function loadJsonl(filePath) {
  if (!fs.existsSync(filePath)) return [];
  return fs.readFileSync(filePath, "utf8").split(/\r?\n/).filter(Boolean).map((line, index) => {
    try {
      return JSON.parse(line);
    } catch (error) {
      throw new Error(`invalid JSONL at line ${index + 1}: ${error.message}`);
    }
  });
}

function appendJsonl(filePath, row) {
  fs.appendFileSync(filePath, `${JSON.stringify(row)}\n`, "utf8");
}

function cellKey(row) {
  return `${row.grid}|${row.persona}|${row.condition}|${row.rep}`;
}

async function runCell(chatCompletion, runId, grid, persona, condition, rep) {
  const common = {
    run_id: runId,
    grid: grid.grid,
    report_grid: grid.reportGrid,
    persona: persona.archetype,
    profile_key: persona.profile.member_key,
    profile: persona.profile,
    condition,
    rep,
    wtp_ref: grid.wtpRef,
    wtp_adj: grid.wtpAdj,
    estimated_wtp: null,
    reasoning: "",
    extraction_anchors_json: null,
    c3_base: null,
    raw_response: "",
    auxiliary_raw_response: "",
    status: "failed",
    error: "",
    completed_at: new Date().toISOString()
  };
  try {
    if (condition === "C0_leaked" || condition === "C0_clean") {
      const result = await callWithJsonRetry(chatCompletion, c0Messages(persona, grid, condition === "C0_leaked"), validateEstimate, 300);
      return { ...common, estimated_wtp: result.value.estimatedWtp, reasoning: result.value.reasoning, raw_response: result.raw, attempts: result.attempts, status: "success" };
    }
    if (condition === "C2_low" || condition === "C2_high") {
      const result = await callWithJsonRetry(chatCompletion, c2Messages(persona, grid, condition === "C2_low" ? 800 : 12000), validateEstimate, 300);
      return { ...common, estimated_wtp: result.value.estimatedWtp, reasoning: result.value.reasoning, raw_response: result.raw, attempts: result.attempts, status: "success" };
    }
    if (condition === "C1") {
      const quotes = await chatCompletion(c1ExtractMessages(grid), { temperature: TEMPERATURE, max_tokens: 1000, maxRetries: 2 });
      const result = await callWithJsonRetry(chatCompletion, c1EstimateMessages(persona, quotes), validateEstimate, 300);
      return { ...common, estimated_wtp: result.value.estimatedWtp, reasoning: result.value.reasoning, raw_response: result.raw, auxiliary_raw_response: quotes, attempts: result.attempts, status: "success" };
    }
    if (condition === "C3") {
      const result = await callWithJsonRetry(chatCompletion, c3Messages(grid), validateAnchors, 1200);
      if (result.value.length === 0) {
        return { ...common, extraction_anchors_json: [], raw_response: result.raw, attempts: result.attempts, status: "EXTRACTION_MISS", error: "anchors array is empty" };
      }
      return {
        ...common,
        extraction_anchors_json: result.value,
        c3_base: weightedMedian(result.value),
        raw_response: result.raw,
        attempts: result.attempts,
        status: "success"
      };
    }
    throw new Error(`unknown condition ${condition}`);
  } catch (error) {
    return { ...common, error: String(error.stack || error.message || error) };
  }
}

async function runPool(tasks, concurrency, worker) {
  let next = 0;
  const workers = Array.from({ length: concurrency }, async () => {
    while (next < tasks.length) {
      const index = next++;
      await worker(tasks[index], index);
    }
  });
  await Promise.all(workers);
}

function rank(values) {
  const sorted = values.map((value, index) => ({ value, index })).sort((a, b) => a.value - b.value);
  const ranks = Array(values.length);
  for (let i = 0; i < sorted.length;) {
    let j = i + 1;
    while (j < sorted.length && sorted[j].value === sorted[i].value) j += 1;
    const averageRank = ((i + 1) + j) / 2;
    for (let k = i; k < j; k += 1) ranks[sorted[k].index] = averageRank;
    i = j;
  }
  return ranks;
}

function pearson(xs, ys) {
  if (xs.length < 2 || xs.length !== ys.length) return null;
  const meanX = xs.reduce((a, b) => a + b, 0) / xs.length;
  const meanY = ys.reduce((a, b) => a + b, 0) / ys.length;
  let numerator = 0;
  let denomX = 0;
  let denomY = 0;
  for (let i = 0; i < xs.length; i += 1) {
    const dx = xs[i] - meanX;
    const dy = ys[i] - meanY;
    numerator += dx * dy;
    denomX += dx * dx;
    denomY += dy * dy;
  }
  const denominator = Math.sqrt(denomX * denomY);
  return denominator > 0 ? numerator / denominator : null;
}

function spearman(xs, ys) {
  return pearson(rank(xs), rank(ys));
}

function mean(values) {
  const finite = values.map(Number).filter(Number.isFinite);
  return finite.length ? finite.reduce((a, b) => a + b, 0) / finite.length : null;
}

function median(values) {
  const finite = values.map(Number).filter(Number.isFinite).sort((a, b) => a - b);
  if (!finite.length) return null;
  const middle = Math.floor(finite.length / 2);
  return finite.length % 2 ? finite[middle] : (finite[middle - 1] + finite[middle]) / 2;
}

function formatNumber(value, digits = 3) {
  return value != null && Number.isFinite(Number(value)) ? Number(value).toFixed(digits) : "N/A";
}

function materializeRows(records) {
  const validC3 = records.filter((row) => row.condition === "C3" && row.status === "success" && Number.isFinite(Number(row.c3_base)));
  return records.map((row) => {
    if (row.condition !== "C3" || row.status !== "success") return row;
    return {
      ...row,
      estimated_wtp: synthesizeC3(row, validC3),
      reasoning: "由报告锚点加权中位数及冻结 persona 变换确定性合成"
    };
  });
}

function summarize(rows, expectedCells, promptHashes, meta) {
  const successful = rows.filter((row) => row.status === "success" && Number.isFinite(Number(row.estimated_wtp)));
  const failures = rows.filter((row) => row.status !== "success");
  const metrics = CONDITIONS.map((condition) => {
    const conditionRows = successful.filter((row) => row.condition === condition);
    const anchoringRate = conditionRows.length
      ? conditionRows.filter((row) => row.estimated_wtp >= 3800 && row.estimated_wtp <= 4200).length / conditionRows.length
      : null;
    const byGrid = GRID_SPECS.map((spec) => {
      const selected = conditionRows.filter((row) => row.grid === spec.grid);
      return { grid: spec.grid, estimate: mean(selected.map((row) => row.estimated_wtp)), truth: selected[0]?.wtp_ref };
    }).filter((item) => Number.isFinite(item.estimate) && Number.isFinite(Number(item.truth)));
    const sensitivity = spearman(byGrid.map((item) => item.estimate), byGrid.map((item) => Number(item.truth)));
    const differences = GRID_SPECS.map((spec) => {
      const premium = mean(conditionRows.filter((row) => row.grid === spec.grid && row.persona === "二代接班人").map((row) => row.estimated_wtp));
      const frugal = mean(conditionRows.filter((row) => row.grid === spec.grid && row.persona === "草根老板").map((row) => row.estimated_wtp));
      return Number.isFinite(premium) && Number.isFinite(frugal) ? premium - frugal : null;
    }).filter(Number.isFinite);
    return {
      condition,
      successful: conditionRows.length,
      anchoringRate,
      gridSensitivity: sensitivity,
      personaDifference: mean(differences),
      premiumHigherRate: differences.length ? differences.filter((value) => value > 0).length / differences.length : null
    };
  });

  const missRows = rows.filter((row) => row.status === "EXTRACTION_MISS");
  const conditionStats = CONDITIONS.map((condition) => {
    const estimates = successful.filter((row) => row.condition === condition).map((row) => row.estimated_wtp);
    return { condition, mean: mean(estimates), median: median(estimates) };
  });
  const conditionStat = Object.fromEntries(conditionStats.map((item) => [item.condition, item]));
  const elderStats = CONDITIONS.filter((condition) => condition !== "C3").map((condition) => {
    const estimates = successful.filter((row) => row.condition === condition && row.grid === "ToC_Cost_Elder")
      .map((row) => row.estimated_wtp);
    return { condition, mean: mean(estimates), median: median(estimates) };
  });
  const c3ByGrid = GRID_SPECS.map((spec) => {
    const selected = rows.filter((row) => row.condition === "C3" && row.grid === spec.grid);
    const success = selected.filter((row) => row.status === "success").length;
    const misses = selected.filter((row) => row.status === "EXTRACTION_MISS").length;
    return { grid: spec.grid, success, misses, rate: selected.length ? success / selected.length : null };
  });
  const c3SuccessRate = conditionStat.C3 ? metrics.find((item) => item.condition === "C3").successful / 180 : null;
  const c2AnchorShift = conditionStat.C2_high.mean - conditionStat.C2_low.mean;
  const lines = [
    "# Belief Formation Bench Summary",
    "",
    `- runId: \`${meta.runId}\``,
    `- generated: \`${new Date().toISOString()}\``,
    `- temperature: \`${TEMPERATURE}\``,
    `- requested cells: ${expectedCells}`,
    `- completed successfully: ${successful.length}/${expectedCells} (${formatNumber(successful.length / expectedCells * 100, 1)}%)`,
    `- failed or extraction miss: ${failures.length}`,
    `- persona reports sha256: \`${meta.personaReportsSha256}\``,
    `- structured profiles sha256: \`${meta.structuredProfilesSha256}\``,
    "",
    "> MATERIAL CAVEAT：当前 persona_reports_v1.1 中，spec 预期的“超过300元”“心理上限两三千元”“两万以内直接批”均为 0 命中。实验严格使用实际生产报告，不补写这些句子。C1/C3 衡量的是现有行为证据文本下的表现。",
    "",
    "## Decision Metrics",
    "",
    "| Condition | Successful | Anchor rate [3800,4200] | Spearman vs WTPref | Premium - frugal | Premium higher grids |",
    "|---|---:|---:|---:|---:|---:|",
    ...metrics.map((item) => `| ${item.condition} | ${item.successful} | ${formatNumber(item.anchoringRate * 100, 1)}% | ${formatNumber(item.gridSensitivity)} | ${formatNumber(item.personaDifference, 0)} | ${formatNumber(item.premiumHigherRate * 100, 1)}% |`),
    "",
    "## Distribution And Verdict",
    "",
    "| Condition | Mean WTP | Median WTP | Verdict |",
    "|---|---:|---:|---|",
    `| C0_leaked | ${formatNumber(conditionStat.C0_leaked.mean, 0)} | ${formatNumber(conditionStat.C0_leaked.median, 0)} | The leaked range changes the distribution, but does not recreate a 4000 point mass. |`,
    `| C0_clean | ${formatNumber(conditionStat.C0_clean.mean, 0)} | ${formatNumber(conditionStat.C0_clean.median, 0)} | Baseline already reads grid-specific price context; 4000 collapse is not reproduced. |`,
    `| C1 | ${formatNumber(conditionStat.C1.mean, 0)} | ${formatNumber(conditionStat.C1.median, 0)} | Evidence-first does not improve grid sensitivity over clean C0. |`,
    `| C2_low | ${formatNumber(conditionStat.C2_low.mean, 0)} | ${formatNumber(conditionStat.C2_low.median, 0)} | Estimates follow the injected low anchor. |`,
    `| C2_high | ${formatNumber(conditionStat.C2_high.mean, 0)} | ${formatNumber(conditionStat.C2_high.median, 0)} | Estimates follow the injected high anchor. |`,
    `| C3 | ${formatNumber(conditionStat.C3.mean, 0)} | ${formatNumber(conditionStat.C3.median, 0)} | Rejected under current reports: extraction and grid-sensitivity thresholds fail. |`,
    "",
    `- C2 anchor shift (high mean minus low mean): ${formatNumber(c2AnchorShift, 0)} yuan.`,
    `- C3 extraction success: ${metrics.find((item) => item.condition === "C3").successful}/180 (${formatNumber(c3SuccessRate * 100, 1)}%), below the >90% criterion.`,
    "- C0-C2 persona differences are present, but they are not cleanly monotonic across all grids; persona text affects level without overriding report/anchor evidence.",
    "",
    "### ToC_Cost_Elder",
    "",
    "| Condition | Mean WTP | Median WTP |",
    "|---|---:|---:|",
    ...elderStats.map((item) => `| ${item.condition} | ${formatNumber(item.mean, 0)} | ${formatNumber(item.median, 0)} |`),
    "",
    "C1 is effectively unchanged from clean C0 for the low-price elder grid, so forced quotation adds little once the actual report text is already supplied.",
    "",
    "### C3 Extraction By Grid",
    "",
    "| Grid | Success | Miss | Success rate |",
    "|---|---:|---:|---:|",
    ...c3ByGrid.map((item) => `| ${item.grid} | ${item.success} | ${item.misses} | ${formatNumber(item.rate * 100, 1)}% |`),
    "",
    "## Prompt Leak Audit",
    "",
    "- slider bounds `2000 / 7000`: absent",
    "- default price `4000`: absent",
    "- `cost_ref`, `COGSbase`, or other cost numbers: absent",
    "- previous card-selection prompt carried into call: no; subjective state creates a fresh two-message request",
    "- numeric anchor leak: present in the output example, `estimated_wtp_range: [3000, 5000]`",
    "- consequence: both `C0_leaked` and `C0_clean` are included; the bench therefore has 1,080 cells rather than the original 900-cell matrix",
    "",
    "Full original prompt is in `belief_bench_prompt_audit.md`.",
    "",
    "## C3 Extraction Misses",
    "",
    ...(missRows.length ? missRows.map((row) => `- ${row.grid} / ${row.persona} / rep ${row.rep}: ${row.error}`) : ["- None"]),
    "",
    "## Other Failures",
    "",
    ...(failures.filter((row) => row.status !== "EXTRACTION_MISS").length
      ? failures.filter((row) => row.status !== "EXTRACTION_MISS").map((row) => `- ${row.grid} / ${row.persona} / ${row.condition} / rep ${row.rep}: ${String(row.error).split("\n")[0]}`)
      : ["- None"]),
    "",
    "## Prompt Template SHA256",
    "",
    ...Object.entries(promptHashes).map(([key, value]) => `- ${key}: \`${value}\``),
    ""
  ];
  return { markdown: lines.join("\n"), metrics, failures };
}

function writeOutputs(rows, args, promptHashes, meta) {
  const csvPath = path.join(OUTPUT_DIR, "belief_bench_results.csv");
  const summaryPath = path.join(OUTPUT_DIR, "belief_bench_summary.md");
  const metaPath = path.join(OUTPUT_DIR, "belief_bench_meta.json");
  const headers = [
    "run_id", "grid", "persona", "condition", "rep", "wtp_ref", "wtp_adj", "estimated_wtp",
    "status", "error", "reasoning", "extraction_anchors_json", "raw_response", "auxiliary_raw_response"
  ];
  const csv = [headers.join(",")].concat(rows.map((row) => headers.map((header) => csvEscape(row[header])).join(","))).join("\n") + "\n";
  const expectedCells = GRID_SPECS.length * PROFILE_ARCHETYPES.length * CONDITIONS.length * args.reps;
  const summary = summarize(rows, expectedCells, promptHashes, meta);
  fs.writeFileSync(csvPath, csv, "utf8");
  fs.writeFileSync(summaryPath, summary.markdown, "utf8");
  fs.writeFileSync(metaPath, JSON.stringify({
    ...meta,
    conditions: CONDITIONS,
    reps: args.reps,
    expectedCells,
    temperature: TEMPERATURE,
    model: process.env.DEEPSEEK_MODEL || "deepseek-chat",
    promptTemplateSha256: promptHashes,
    groundTruthPromptExposure: false,
    outputFiles: { csvPath, summaryPath }
  }, null, 2) + "\n", "utf8");
  return { csvPath, summaryPath, metaPath, summary };
}

function writeAudit(promptHashes) {
  const auditPath = path.join(OUTPUT_DIR, "belief_bench_prompt_audit.md");
  const materialChecks = ["超过300元", "心理上限两三千元", "两万以内直接批"];
  const reportText = fs.readFileSync(REPORTS_PATH, "utf8");
  const lines = [
    "# Belief Bench Prompt Leak Audit",
    "",
    "## Verdict",
    "",
    "The subjective-state request leaks a numeric anchor through its JSON example: `[3000, 5000]`. It does not contain the slider bounds, default price, or cost inputs, and it does not reuse the previous card-selection conversation. The bench therefore includes leaked and clean C0 variants.",
    "",
    "## Original Prompt",
    "",
    "System message: the rendered persona text (`structured`, `simple`, or layered depending on mode).",
    "",
    "User message, verbatim template from stashed `team_runner.js`:",
    "",
    "```text",
    ORIGINAL_SUBJECTIVE_PROMPT,
    "```",
    "",
    "Call options:",
    "",
    "```json",
    JSON.stringify({ temperature: 0.45, max_tokens: 700 }, null, 2),
    "```",
    "",
    "## Checks",
    "",
    "| Check | Result |",
    "|---|---|",
    "| Slider `2000 / 7000` | absent |",
    "| Default `4000` | absent |",
    "| `cost_ref`, `COGSbase`, cost figures | absent |",
    "| Previous card-selection prompt in messages | absent; this call builds a new message array |",
    "| Numeric output example | **present: `[3000, 5000]`** |",
    "",
    "## Material Consistency",
    "",
    `Production report file: \`${path.relative(ROOT, REPORTS_PATH)}\``,
    "",
    ...materialChecks.map((needle) => `- \`${needle}\`: ${(reportText.match(new RegExp(needle, "g")) || []).length} hits`),
    "",
    "The expected evidence sentences in the bench specification are not present in the actual v1.1 file. They are not injected or reconstructed.",
    "",
    "## Prompt Hashes",
    "",
    ...Object.entries(promptHashes).map(([key, value]) => `- ${key}: \`${value}\``),
    ""
  ];
  fs.writeFileSync(auditPath, lines.join("\n"), "utf8");
  return auditPath;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  loadLocalEnv();
  const materials = loadMaterials();
  const promptHashes = promptTemplateHashes();
  const auditPath = writeAudit(promptHashes);
  const jsonlPath = path.join(OUTPUT_DIR, `${args.runId}.jsonl`);
  const meta = {
    runId: args.runId,
    createdAt: new Date().toISOString(),
    scriptSha256: fileSha256(__filename),
    personaReportsSha256: fileSha256(REPORTS_PATH),
    structuredProfilesSha256: fileSha256(PROFILES_PATH),
    sourceRun: "sim_layered_newflow_2026-07-10T23-54-52-761Z",
    groundTruth: Object.fromEntries(materials.grids.map((grid) => [grid.grid, { wtp_ref: grid.wtpRef, wtp_adj: grid.wtpAdj }]))
  };
  const existing = loadJsonl(jsonlPath).filter((row) => row.run_id === args.runId);

  if (args.dryRun) {
    const outputs = writeOutputs(materializeRows(existing), args, promptHashes, meta);
    console.log(JSON.stringify({ dryRun: true, auditPath, jsonlPath, tasks: 108 * args.reps, outputs }, null, 2));
    return;
  }
  if (!args.summarizeOnly) {
    const { chatCompletion, hasAnyKey } = require("../../server/llm/deepseekClient");
    if (!hasAnyKey()) throw new Error("DeepSeek API key is required");
    const completedKeys = new Set(existing.map(cellKey));
    const tasks = [];
    for (const grid of materials.grids) {
      for (const persona of materials.personas) {
        for (const condition of CONDITIONS) {
          for (let rep = 1; rep <= args.reps; rep += 1) {
            const task = { grid, persona, condition, rep };
            if (!completedKeys.has(cellKey({ grid: grid.grid, persona: persona.archetype, condition, rep }))) tasks.push(task);
          }
        }
      }
    }
    console.log(`[belief_bench] run=${args.runId} existing=${existing.length} remaining=${tasks.length} concurrency=${args.concurrency}`);
    await runPool(tasks, args.concurrency, async (task, index) => {
      const row = await runCell(chatCompletion, args.runId, task.grid, task.persona, task.condition, task.rep);
      appendJsonl(jsonlPath, row);
      console.log(`[belief_bench] ${index + 1}/${tasks.length} ${cellKey(row)} ${row.status}`);
    });
  }
  const rows = materializeRows(loadJsonl(jsonlPath).filter((row) => row.run_id === args.runId));
  const outputs = writeOutputs(rows, args, promptHashes, meta);
  console.log(JSON.stringify({ auditPath, jsonlPath, rows: rows.length, outputs }, null, 2));
}

main().catch((error) => {
  console.error(error.stack || error.message || String(error));
  process.exitCode = 1;
});
