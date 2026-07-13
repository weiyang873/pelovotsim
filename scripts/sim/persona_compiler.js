"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const ROOT = path.join(__dirname, "..", "..");
const SOURCE_RUN = "sim_layered_newflow_2026-07-10T23-54-52-761Z";
const DEFAULT_INPUT = path.join(ROOT, "data", "persona_sim_logs", SOURCE_RUN, "students_summary.csv");
const DEFAULT_OUTPUT = path.join(__dirname, "structured_profiles_v1.json");
const DEFAULT_REPORT = path.join(__dirname, "structured_profiles_v1_variance_report.md");
const CAPABILITY_FILE = path.join(ROOT, "data", "capability_groups_v2.json");
const TEMPERATURE = 0.9;
const MAX_JSON_REPAIRS = 2;

const PROMPT_TEMPLATE = `你是一个研究用 persona compiler。你的任务是把一个 EMBA 学员 persona 的叙事材料，编译成固定枚举的结构化决策前提。

纪律：
1. 只能根据输入 persona 文本推断，每个字段值都必须能追溯到输入中的一句话或标签。
2. 不要输出任何具体卡片名、cap_id、价格数字、WTP 数字、游戏公式或游戏参数。
3. 只输出一个合法 JSON 对象，不要 Markdown，不要解释。
4. 所有枚举值必须严格使用 schema 中给定的英文值。
5. objectives_rank 必须是 ["profit","volume","brand","coverage","risk_control"] 的 5 元素全排列。

输入字段：
- 原型：{{persona}}
- 性别：{{gender}}
- MBTI：{{mbti}}
- 年龄：{{age}}
- 学历：{{education}}
- 海外经历：{{has_overseas}}
- 行业：{{industry}}
- seed_memory_json：{{seed_memory_json}}
- classroom_profile_json：{{classroom_profile_json}}

输出 schema：
{
  "attention": {
    "customer_visible_value": "high|medium|low",
    "technical_dependencies": "high|medium|low",
    "cost_structure": "high|medium|low",
    "brand_signal": "high|medium|low",
    "constraint_checking": "high|medium|low"
  },
  "belief_policy": {
    "wtp_anchor_style": "report_numbers|premium_analogy|budget_analogy|gut_feel",
    "trust_in_reports": "high|medium|low",
    "confidence_calibration": "overconfident|calibrated|underconfident"
  },
  "objectives_rank": ["profit","volume","brand","coverage","risk_control"],
  "aspirations": {
    "minimum_core_coverage": "high|medium|low",
    "acceptable_margin": "high|medium|low",
    "nre_tolerance": "high|medium|low",
    "price_position": "premium|mid|budget"
  },
  "search_policy": {
    "breadth": "narrow|wide",
    "stop_rule": "first_satisfying|compare_few|exhaustive",
    "revise_if_below_aspiration": true
  },
  "risk_policy": {
    "market_uncertainty_tolerance": "high|medium|low",
    "technical_uncertainty_tolerance": "high|medium|low"
  },
  "constraint_policy": {
    "dependency_check_depth": "full|partial|minimal",
    "assumes_teammate_checked": "high|low"
  }
}`;

const ENUMS = {
  "attention.customer_visible_value": ["high", "medium", "low"],
  "attention.technical_dependencies": ["high", "medium", "low"],
  "attention.cost_structure": ["high", "medium", "low"],
  "attention.brand_signal": ["high", "medium", "low"],
  "attention.constraint_checking": ["high", "medium", "low"],
  "belief_policy.wtp_anchor_style": ["report_numbers", "premium_analogy", "budget_analogy", "gut_feel"],
  "belief_policy.trust_in_reports": ["high", "medium", "low"],
  "belief_policy.confidence_calibration": ["overconfident", "calibrated", "underconfident"],
  "aspirations.minimum_core_coverage": ["high", "medium", "low"],
  "aspirations.acceptable_margin": ["high", "medium", "low"],
  "aspirations.nre_tolerance": ["high", "medium", "low"],
  "aspirations.price_position": ["premium", "mid", "budget"],
  "search_policy.breadth": ["narrow", "wide"],
  "search_policy.stop_rule": ["first_satisfying", "compare_few", "exhaustive"],
  "risk_policy.market_uncertainty_tolerance": ["high", "medium", "low"],
  "risk_policy.technical_uncertainty_tolerance": ["high", "medium", "low"],
  "constraint_policy.dependency_check_depth": ["full", "partial", "minimal"],
  "constraint_policy.assumes_teammate_checked": ["high", "low"]
};

const OBJECTIVES = ["profit", "volume", "brand", "coverage", "risk_control"];
const MODAL_DIFF_FIELDS = [
  "aspirations.nre_tolerance",
  "aspirations.price_position",
  "constraint_policy.dependency_check_depth",
  "attention.cost_structure"
];
const ALLOWED_INPUT_COLUMNS = [
  "run_id",
  "team_index",
  "member_index",
  "persona",
  "gender",
  "mbti",
  "age",
  "education",
  "has_overseas",
  "industry",
  "seed_memory_json",
  "classroom_profile_json"
];

function loadLocalEnvFile() {
  const envPath = path.join(ROOT, ".env");
  if (!fs.existsSync(envPath)) return;
  const content = fs.readFileSync(envPath, "utf8");
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if ((value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!Object.prototype.hasOwnProperty.call(process.env, key)) {
      process.env[key] = value;
    }
  }
}

function sha256(text) {
  return crypto.createHash("sha256").update(String(text || ""), "utf8").digest("hex");
}

function readCsv(filePath) {
  const text = fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, "");
  const rows = [];
  let row = [];
  let cell = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    const next = text[i + 1];
    if (inQuotes) {
      if (ch === "\"" && next === "\"") {
        cell += "\"";
        i += 1;
      } else if (ch === "\"") {
        inQuotes = false;
      } else {
        cell += ch;
      }
      continue;
    }
    if (ch === "\"") {
      inQuotes = true;
    } else if (ch === ",") {
      row.push(cell);
      cell = "";
    } else if (ch === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else if (ch !== "\r") {
      cell += ch;
    }
  }
  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }
  const headers = rows.shift() || [];
  return rows.filter((item) => item.length > 1 || item[0]).map((values) => {
    const out = {};
    headers.forEach((header, index) => {
      out[header] = values[index] || "";
    });
    return out;
  });
}

function parseJsonCell(value, label, memberKey) {
  try {
    return JSON.parse(String(value || ""));
  } catch (err) {
    throw new Error(`${memberKey}: failed to parse ${label}: ${err.message || err}`);
  }
}

function loadRoster(inputPath) {
  const rows = readCsv(inputPath);
  if (rows.length !== 72) {
    throw new Error(`Expected 72 input rows, got ${rows.length}`);
  }
  return rows.map((row) => {
    const teamIndex = Number(row.team_index);
    const memberIndex = Number(row.member_index);
    const memberKey = `t${teamIndex}_m${memberIndex}`;
    const filtered = {};
    for (const column of ALLOWED_INPUT_COLUMNS) {
      filtered[column] = row[column] || "";
    }
    const seedMemory = parseJsonCell(filtered.seed_memory_json, "seed_memory_json", memberKey);
    const classroomProfile = parseJsonCell(filtered.classroom_profile_json, "classroom_profile_json", memberKey);
    return {
      memberKey,
      teamIndex,
      memberIndex,
      filtered,
      seedMemory,
      classroomProfile,
      sourceHash: sha256(`${filtered.seed_memory_json}\n${filtered.classroom_profile_json}`)
    };
  }).sort((a, b) => (a.teamIndex - b.teamIndex) || (a.memberIndex - b.memberIndex));
}

function renderPrompt(member) {
  const values = {
    persona: member.filtered.persona,
    gender: member.filtered.gender,
    mbti: member.filtered.mbti,
    age: member.filtered.age,
    education: member.filtered.education,
    has_overseas: member.filtered.has_overseas,
    industry: member.filtered.industry,
    seed_memory_json: JSON.stringify(member.seedMemory, null, 2),
    classroom_profile_json: JSON.stringify(member.classroomProfile, null, 2)
  };
  return PROMPT_TEMPLATE.replace(/\{\{([a-z_]+)\}\}/g, (_, key) => values[key] || "");
}

function parseJsonObject(text) {
  const raw = String(text || "").replace(/```json|```/g, "").trim();
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  const candidate = start >= 0 && end > start ? raw.slice(start, end + 1) : raw;
  return JSON.parse(candidate);
}

function getPath(obj, dotted) {
  return dotted.split(".").reduce((cur, key) => (cur && typeof cur === "object" ? cur[key] : undefined), obj);
}

function setPath(obj, dotted, value) {
  const parts = dotted.split(".");
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i += 1) {
    cur = cur[parts[i]];
  }
  cur[parts[parts.length - 1]] = value;
}

function validateCoreProfile(profile, memberKey) {
  const errors = [];
  for (const [field, allowed] of Object.entries(ENUMS)) {
    const value = getPath(profile, field);
    if (!allowed.includes(value)) {
      errors.push(`${field}=${JSON.stringify(value)} not in ${allowed.join("|")}`);
    }
  }
  const rank = profile.objectives_rank;
  if (!Array.isArray(rank) || rank.length !== OBJECTIVES.length) {
    errors.push("objectives_rank must have 5 elements");
  } else {
    const seen = new Set(rank);
    for (const item of OBJECTIVES) {
      if (!seen.has(item)) errors.push(`objectives_rank missing ${item}`);
    }
    for (const item of rank) {
      if (!OBJECTIVES.includes(item)) errors.push(`objectives_rank invalid ${item}`);
    }
    if (seen.size !== rank.length) errors.push("objectives_rank contains duplicates");
  }
  if (typeof profile.search_policy?.revise_if_below_aspiration !== "boolean") {
    errors.push("search_policy.revise_if_below_aspiration must be boolean");
  }
  if (errors.length) {
    throw new Error(`${memberKey}: invalid profile: ${errors.join("; ")}`);
  }
}

function normalizeProfile(raw, member) {
  const profile = {
    member_key: member.memberKey,
    source_run: SOURCE_RUN,
    archetype: member.filtered.persona,
    attention: {
      customer_visible_value: raw.attention?.customer_visible_value,
      technical_dependencies: raw.attention?.technical_dependencies,
      cost_structure: raw.attention?.cost_structure,
      brand_signal: raw.attention?.brand_signal,
      constraint_checking: raw.attention?.constraint_checking
    },
    belief_policy: {
      wtp_anchor_style: raw.belief_policy?.wtp_anchor_style,
      trust_in_reports: raw.belief_policy?.trust_in_reports,
      confidence_calibration: raw.belief_policy?.confidence_calibration
    },
    objectives_rank: Array.isArray(raw.objectives_rank) ? raw.objectives_rank.slice() : raw.objectives_rank,
    aspirations: {
      minimum_core_coverage: raw.aspirations?.minimum_core_coverage,
      acceptable_margin: raw.aspirations?.acceptable_margin,
      nre_tolerance: raw.aspirations?.nre_tolerance,
      price_position: raw.aspirations?.price_position
    },
    search_policy: {
      breadth: raw.search_policy?.breadth,
      stop_rule: raw.search_policy?.stop_rule,
      revise_if_below_aspiration: raw.search_policy?.revise_if_below_aspiration
    },
    risk_policy: {
      market_uncertainty_tolerance: raw.risk_policy?.market_uncertainty_tolerance,
      technical_uncertainty_tolerance: raw.risk_policy?.technical_uncertainty_tolerance
    },
    constraint_policy: {
      dependency_check_depth: raw.constraint_policy?.dependency_check_depth,
      assumes_teammate_checked: raw.constraint_policy?.assumes_teammate_checked
    },
    source_sha256: member.sourceHash,
    compiler_prompt_sha256: sha256(PROMPT_TEMPLATE)
  };
  validateCoreProfile(profile, member.memberKey);
  return profile;
}

function hasAnyDeepSeekKey() {
  return Object.keys(process.env).some((key) => {
    return (key === "DEEPSEEK_API_KEY" || /^DEEPSEEK_API_KEY_\d+$/.test(key)) && String(process.env[key] || "").trim();
  });
}

async function compileOne(member, chatCompletion) {
  const baseMessages = [
    {
      role: "user",
      content: renderPrompt(member)
    }
  ];
  let messages = baseMessages;
  let completion = "";
  let lastErr = null;
  for (let attempt = 0; attempt <= MAX_JSON_REPAIRS; attempt += 1) {
    completion = String(await chatCompletion(messages, {
      temperature: TEMPERATURE,
      max_tokens: 900,
      maxRetries: 1
    }) || "").trim();
    try {
      return normalizeProfile(parseJsonObject(completion), member);
    } catch (err) {
      lastErr = err;
      if (attempt >= MAX_JSON_REPAIRS) break;
      messages = [
        ...baseMessages,
        { role: "assistant", content: completion || "(空输出)" },
        {
          role: "user",
          content: [
            `上一次输出无法通过严格 JSON/schema 校验：${err.message || err}`,
            "请只修正为同一 persona 的合法 JSON 对象。",
            "不要解释，不要 Markdown，不要新增 schema 外字段。"
          ].join("\n")
        }
      ];
    }
  }
  throw new Error(`${member.memberKey}: JSON/schema failed after ${MAX_JSON_REPAIRS} repair(s): ${lastErr?.message || lastErr}`);
}

async function compileProfiles(roster, outputPath) {
  loadLocalEnvFile();
  if (!hasAnyDeepSeekKey()) {
    throw new Error("DeepSeek API key missing. Set DEEPSEEK_API_KEY or DEEPSEEK_API_KEY_1..N; strict compiler will not fallback.");
  }
  const { chatCompletion } = require("../../server/llm/deepseekClient");
  const profiles = [];
  for (const member of roster) {
    process.stdout.write(`[persona_compiler] compiling ${member.memberKey} ${member.filtered.persona}\n`);
    profiles.push(await compileOne(member, chatCompletion));
  }
  fs.writeFileSync(outputPath, `${JSON.stringify(profiles, null, 2)}\n`);
  return profiles;
}

function validateProfiles(profiles) {
  if (!Array.isArray(profiles)) {
    throw new Error("structured profile file must be a JSON array");
  }
  if (profiles.length !== 72) {
    throw new Error(`Expected 72 profiles, got ${profiles.length}`);
  }
  const keys = new Set(profiles.map((item) => item.member_key));
  const missing = [];
  for (let t = 0; t < 12; t += 1) {
    for (let m = 0; m < 6; m += 1) {
      const key = `t${t}_m${m}`;
      if (!keys.has(key)) missing.push(key);
    }
  }
  if (missing.length) {
    throw new Error(`Missing member_key(s): ${missing.join(", ")}`);
  }
  for (const profile of profiles) {
    validateCoreProfile(profile, profile.member_key || "(unknown)");
  }
}

function profileDecisionClone(profile) {
  return {
    archetype: profile.archetype,
    attention: profile.attention,
    belief_policy: profile.belief_policy,
    objectives_rank: profile.objectives_rank,
    aspirations: profile.aspirations,
    search_policy: profile.search_policy,
    risk_policy: profile.risk_policy,
    constraint_policy: profile.constraint_policy
  };
}

function loadCapabilityIds() {
  const parsed = JSON.parse(fs.readFileSync(CAPABILITY_FILE, "utf8"));
  return (parsed.groups || []).flatMap((group) => (
    (group.capabilities || []).map((capability) => String(capability.cap_id || "").trim()).filter(Boolean)
  ));
}

function scanSensitiveContent(profiles) {
  const decisionText = JSON.stringify(profiles.map(profileDecisionClone), null, 2);
  const capHits = [];
  for (const capId of loadCapabilityIds()) {
    if (capId && decisionText.includes(capId)) {
      capHits.push(capId);
    }
  }
  const longNumberHits = decisionText.match(/\d{4,}/g) || [];
  return {
    capHits,
    longNumberHits: Array.from(new Set(longNumberHits))
  };
}

function makeCountMap(values, allowed) {
  const out = {};
  for (const value of allowed) out[value] = 0;
  for (const value of values) {
    out[value] = (out[value] || 0) + 1;
  }
  return out;
}

function mode(values) {
  const counts = new Map();
  for (const value of values) {
    counts.set(value, (counts.get(value) || 0) + 1);
  }
  let best = "";
  let bestCount = -1;
  for (const [value, count] of counts.entries()) {
    if (count > bestCount || (count === bestCount && String(value).localeCompare(String(best), "zh-Hans-CN") < 0)) {
      best = value;
      bestCount = count;
    }
  }
  return best;
}

function archetypes(profiles) {
  return Array.from(new Set(profiles.map((profile) => profile.archetype))).sort((a, b) => a.localeCompare(b, "zh-Hans-CN"));
}

function buildVarianceReport(profiles, outputPath, validationSummary, sensitiveScan) {
  const lines = [];
  lines.push("# structured_profiles_v1 variance report");
  lines.push("");
  lines.push(`- source_run: \`${SOURCE_RUN}\``);
  lines.push(`- profiles: ${profiles.length}`);
  lines.push(`- compiler_prompt_sha256: \`${sha256(PROMPT_TEMPLATE)}\``);
  lines.push(`- validation: valid: ${validationSummary.valid}/${validationSummary.total}`);
  lines.push(`- sensitive scan scope: decision payload only; required metadata such as \`source_run\` contains dates by design.`);
  lines.push(`- cap_id hits: ${sensitiveScan.capHits.length ? sensitiveScan.capHits.join(", ") : "0"}`);
  lines.push(`- 4+ digit hits: ${sensitiveScan.longNumberHits.length ? sensitiveScan.longNumberHits.join(", ") : "0"}`);
  lines.push("");

  lines.push("## 1. 字段分布表");
  lines.push("");
  lines.push("| field | value counts | max share | flag |");
  lines.push("| --- | --- | ---: | --- |");
  const distributionFlags = [];
  for (const [field, allowed] of Object.entries(ENUMS)) {
    const counts = makeCountMap(profiles.map((profile) => getPath(profile, field)), allowed);
    const maxCount = Math.max(...Object.values(counts));
    const maxShare = maxCount / profiles.length;
    const flag = maxShare > 0.8 ? "**RED: >80% single value**" : "";
    if (flag) distributionFlags.push(`${field}: ${maxCount}/72`);
    lines.push(`| \`${field}\` | ${allowed.map((value) => `${value}=${counts[value] || 0}`).join("; ")} | ${(maxShare * 100).toFixed(1)}% | ${flag} |`);
  }
  const reviseCounts = makeCountMap(
    profiles.map((profile) => String(profile.search_policy.revise_if_below_aspiration)),
    ["true", "false"]
  );
  const reviseMax = Math.max(...Object.values(reviseCounts));
  const reviseFlag = reviseMax / profiles.length > 0.8 ? "**RED: >80% single value**" : "";
  if (reviseFlag) distributionFlags.push(`search_policy.revise_if_below_aspiration: ${reviseMax}/72`);
  lines.push(`| \`search_policy.revise_if_below_aspiration\` | true=${reviseCounts.true || 0}; false=${reviseCounts.false || 0} | ${((reviseMax / profiles.length) * 100).toFixed(1)}% | ${reviseFlag} |`);
  lines.push("");

  lines.push("## 2. 原型模态表");
  lines.push("");
  const archetypeList = archetypes(profiles);
  lines.push(`| field | ${archetypeList.join(" | ")} |`);
  lines.push(`| --- | ${archetypeList.map(() => "---").join(" | ")} |`);
  const modalByField = {};
  for (const field of [...Object.keys(ENUMS), "search_policy.revise_if_below_aspiration"]) {
    modalByField[field] = {};
    const row = [`\`${field}\``];
    for (const archetype of archetypeList) {
      const values = profiles
        .filter((profile) => profile.archetype === archetype)
        .map((profile) => field === "search_policy.revise_if_below_aspiration"
          ? String(profile.search_policy.revise_if_below_aspiration)
          : getPath(profile, field));
      const value = mode(values);
      modalByField[field][archetype] = value;
      row.push(value);
    }
    lines.push(`| ${row.join(" | ")} |`);
  }
  lines.push("");

  lines.push("## 3. 自动标红");
  lines.push("");
  if (distributionFlags.length) {
    for (const item of distributionFlags) lines.push(`- **RED** ${item}`);
  } else {
    lines.push("- 无字段出现单一取值占比 > 80%。");
  }
  lines.push("");

  lines.push("## 4. 原型分化检查");
  lines.push("");
  let diffFlagCount = 0;
  for (const field of MODAL_DIFF_FIELDS) {
    const values = archetypeList.map((archetype) => modalByField[field]?.[archetype]);
    const unique = new Set(values);
    if (unique.size === 1) {
      diffFlagCount += 1;
      lines.push(`- **RED** \`${field}\`: 7 个原型模态值完全相同（${values[0]}）。`);
    } else {
      lines.push(`- \`${field}\`: 通过（${Array.from(unique).join(", ")}）。`);
    }
  }
  if (diffFlagCount === 0) {
    lines.push("- 四个重点字段均存在原型模态分化。");
  }
  lines.push("");

  fs.writeFileSync(outputPath, `${lines.join("\n")}\n`);
}

function readProfiles(outputPath) {
  return JSON.parse(fs.readFileSync(outputPath, "utf8"));
}

function parseArgs(argv) {
  const args = {
    input: DEFAULT_INPUT,
    output: DEFAULT_OUTPUT,
    report: DEFAULT_REPORT,
    force: false,
    validateOnly: false
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--force") args.force = true;
    else if (arg === "--validate-only") args.validateOnly = true;
    else if (arg === "--input") {
      args.input = path.resolve(argv[i + 1]);
      i += 1;
    } else if (arg === "--output") {
      args.output = path.resolve(argv[i + 1]);
      i += 1;
    } else if (arg === "--report") {
      args.report = path.resolve(argv[i + 1]);
      i += 1;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const roster = loadRoster(args.input);
  const outputExists = fs.existsSync(args.output);
  let profiles;
  if (args.validateOnly || (outputExists && !args.force)) {
    if (!outputExists) {
      throw new Error(`Cannot validate; output file does not exist: ${args.output}`);
    }
    profiles = readProfiles(args.output);
  } else {
    profiles = await compileProfiles(roster, args.output);
  }

  validateProfiles(profiles);
  const sensitiveScan = scanSensitiveContent(profiles);
  buildVarianceReport(profiles, args.report, { valid: profiles.length, total: 72 }, sensitiveScan);
  process.stdout.write(`valid: ${profiles.length}/72\n`);
  process.stdout.write(`member_key coverage: t0_m0..t11_m5 OK\n`);
  process.stdout.write(`cap_id hits in decision payload: ${sensitiveScan.capHits.length}\n`);
  process.stdout.write(`4+ digit hits in decision payload: ${sensitiveScan.longNumberHits.length}\n`);
  process.stdout.write(`wrote ${args.output}\n`);
  process.stdout.write(`wrote ${args.report}\n`);
}

if (require.main === module) {
  main().catch((err) => {
    console.error(`[persona_compiler] ${err.stack || err.message || err}`);
    process.exit(1);
  });
}

module.exports = {
  PROMPT_TEMPLATE,
  loadRoster,
  validateProfiles,
  scanSensitiveContent,
  buildVarianceReport
};
