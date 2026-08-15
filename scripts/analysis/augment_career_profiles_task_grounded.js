"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..", "..");
const DEFAULT_INPUT = path.join(
  ROOT,
  "data",
  "career_general_profile_pool_v2",
  "family_r1_42_complete_20260812",
  "persona_pool_career_general_profile_v2.json"
);
const DEFAULT_OUTPUT_DIR = path.join(ROOT, "data", "career_general_profile_pool_v2", "task_grounded_pilot_v1");
const FORBIDDEN_OUTPUT_TERMS = [
  "ToB", "ToC", "COST", "DIFF", "成本领先", "差异化", "体验型", "混合型", "功能型",
  "AI宠物", "AI 宠物", "目标市场", "市场格", "grid_id", "Round 1", "R1", "本次任务",
  "应该选择", "建议选择", "更适合选择"
];

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
  const args = {
    input: DEFAULT_INPUT,
    outputDir: DEFAULT_OUTPUT_DIR,
    personaIds: [],
    limit: 12,
    concurrency: 4,
    seed: "20260812-task-grounded-r1-v1",
    recoverCalls: ""
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--input") args.input = path.resolve(ROOT, String(argv[++index] || "").trim());
    else if (arg === "--output-dir") args.outputDir = path.resolve(ROOT, String(argv[++index] || "").trim());
    else if (arg === "--persona-ids") {
      args.personaIds = String(argv[++index] || "").split(",").map((item) => item.trim()).filter(Boolean);
    } else if (arg === "--limit") args.limit = Number(argv[++index]);
    else if (arg === "--concurrency") args.concurrency = Number(argv[++index]);
    else if (arg === "--seed") args.seed = String(argv[++index] || "").trim();
    else if (arg === "--recover-calls") args.recoverCalls = path.resolve(ROOT, String(argv[++index] || "").trim());
    else throw new Error(`unknown argument: ${arg}`);
  }
  if (!fs.existsSync(args.input)) throw new Error(`missing input pool: ${args.input}`);
  if (!Number.isInteger(args.limit) || args.limit < 1) throw new Error("--limit must be a positive integer");
  if (!Number.isInteger(args.concurrency) || args.concurrency < 1) throw new Error("--concurrency must be a positive integer");
  if (!args.seed) throw new Error("--seed required");
  if (args.recoverCalls && !fs.existsSync(args.recoverCalls)) {
    throw new Error(`missing recovery calls: ${args.recoverCalls}`);
  }
  return args;
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function appendJsonl(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.appendFileSync(filePath, `${JSON.stringify(value)}\n`, "utf8");
}

function sha256(value) {
  const bytes = Buffer.isBuffer(value) ? value : Buffer.from(String(value));
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

function stripFence(raw) {
  return String(raw || "")
    .trim()
    .replace(/^```(?:json)?\s*/iu, "")
    .replace(/\s*```$/u, "")
    .trim();
}

function parseJsonObject(raw) {
  const text = stripFence(raw);
  const start = text.indexOf("{");
  let end = -1;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index >= 0 && index < text.length; index += 1) {
    const char = text[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === "\"") inString = false;
      continue;
    }
    if (char === "\"") inString = true;
    else if (char === "{") depth += 1;
    else if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        end = index + 1;
        break;
      }
    }
  }
  const candidate = start >= 0 && end > start ? text.slice(start, end) : text;
  return JSON.parse(candidate.replace(/,\s*([}\]])/gu, "$1"));
}

function profileContext(record) {
  return {
    persona_id: record.persona_id,
    name: record.name,
    demographic_realization: record.demographic_realization,
    career_history: record.career_history,
    current_position: record.current_position,
    family_life: record.family_life,
    behavioral_fingerprint: record.behavioral_fingerprint,
    behavioral_directives: record.behavioral_directives,
    general_profile: record.general_profile
  };
}

function buildMessages(record, seed) {
  return [
    {
      role: "system",
      content: [
        "你是人物连续性编辑。你要给一位已有完整职业与家庭史的中国高管项目学员补写一段生活记忆。",
        "这不是心理测评解释，也不是商业建议。只写此人过去真实发生过的消费、采购、照护和使用经历，让读者以后能从经历理解其临场判断。",
        "必须保持原人物的年龄、家庭、行业、职能、收入与权责规模连贯，不得另造冲突身份。",
        "不要把行为 trait 翻译成管理学标签，也不要替人物归纳一个稳定战略偏好。"
      ].join("\n")
    },
    {
      role: "user",
      content: [
        `生成种子标签：${seed}:${record.persona_id}`,
        "",
        "【原人物档案】",
        JSON.stringify(profileContext(record)),
        "",
        "【写作时内部要覆盖的任务相关判断来源；这些标题和术语不得出现在成文中】",
        "1. 谁实际使用、谁掏钱、谁参与决定：个人和家庭购买经验，以及工作中的客户、采购、审批或交付经验。",
        "2. 对孩子、成年人、老人的接触深浅：只沿用原家庭和职业事实，写本人真正参与过的照护、陪伴、教育、服务或产品使用。",
        "3. 对情绪陪伴、设计感、实际用途、可靠性和省事程度的真实反应：来自买过、退过、闲置过或反复使用过的东西。",
        "4. 对便宜普及、批量采用、独特价值、专业服务和溢价的看法：来自过去交易结果，不写抽象原则。",
        "5. 价格参照：写出若干相邻品类中实际见过或付过的金额，可以包括家庭耐用品、智能设备、订阅服务、照护服务或工作采购；金额必须符合人物收入、行业和年代，彼此不要整齐。",
        "",
        "不要机械地五项各写一句。选择最符合这个人的两到四段具体往事，串成一段有时间、对象、物品或服务、金额、犹豫和结果的生活叙事。",
        "不同人的参照系应来自各自履历：有人熟悉家庭账，有人熟悉企业采购，有人只懂自己行业；不要让所有人都成为理性比价者，也不要为了制造差异而平均分配立场。",
        "允许同一个人矛盾，例如工作上严控采购、给家人买东西却愿意为省心多付；也允许买贵后后悔、买便宜后闲置、因熟人推荐跳过比较。",
        "不得出现产品任务、课堂、市场选择、战略选项、按钮、答案、建议或结论。不得出现 ToB、ToC、COST、DIFF、成本领先、差异化、体验型、混合型、功能型、AI宠物、目标市场、市场格、grid_id、Round 1、R1。",
        "不要写品牌名。不要写成用户画像、条目、测评报告或决策规则。不要使用‘因此他会选择’之类预告未来答案的话。",
        "",
        "只输出 JSON：",
        "{\"life_history_narrative\":\"450-700字的连贯人物生活记忆\"}"
      ].join("\n")
    }
  ];
}

function normalizeExperience(parsed) {
  const narrativeParts = parsed && typeof parsed === "object"
    ? Object.values(parsed).filter((value) => typeof value === "string")
    : [];
  const narrative = narrativeParts.join("\n\n").replace(/\s+/gu, " ").trim();
  if (narrative.length < 300) throw new Error(`life_history_narrative too short: ${narrative.length}`);
  const forbiddenHits = FORBIDDEN_OUTPUT_TERMS.filter((term) => narrative.includes(term));
  if (forbiddenHits.length > 0) throw new Error(`forbidden output terms: ${forbiddenHits.join(", ")}`);
  const arabicAmount = /\d[\d,，]*(?:\.\d+)?\s*(?:元|块|万)/u;
  const chineseAmount = /[零〇一二两三四五六七八九十百千万几]+(?:多|余)?\s*(?:元|块)/u;
  if (!arabicAmount.test(narrative) && !chineseAmount.test(narrative)) {
    throw new Error("life_history_narrative must contain at least one concrete monetary memory");
  }
  return narrative;
}

function recoverExperiences(callsPath, selectedSet) {
  const recovered = new Map();
  if (!callsPath) return recovered;
  const rows = fs.readFileSync(callsPath, "utf8")
    .split(/\r?\n/u)
    .filter(Boolean)
    .map((line) => JSON.parse(line));
  for (const row of rows) {
    if (recovered.has(row.persona_id) || !selectedSet.has(row.persona_id) || !row.raw) continue;
    try {
      const narrative = normalizeExperience(parseJsonObject(row.raw));
      recovered.set(row.persona_id, {
        seed: "",
        source_attempt: Number(row.attempt) || null,
        source_status: row.status || "",
        generation_method: "task_decisions_to_nonprescriptive_life_history",
        life_history_narrative: narrative
      });
    } catch (_error) {
      // Try the next saved attempt for this persona.
    }
  }
  return recovered;
}

async function main() {
  loadLocalEnv();
  const args = parseArgs(process.argv.slice(2));
  const { chatCompletion, hasAnyKey } = require("../../server/llm/deepseekClient");
  const modelRegistry = require("../../server/llm/modelRegistry");
  if (!hasAnyKey()) throw new Error("missing LLM API key");

  const sourceBytes = fs.readFileSync(args.input);
  const records = JSON.parse(sourceBytes.toString("utf8"));
  if (!Array.isArray(records) || records.length < 1) throw new Error("input pool must be a non-empty JSON array");
  const selectedIds = args.personaIds.length > 0
    ? args.personaIds
    : records.slice(0, args.limit).map((record) => record.persona_id);
  const selectedSet = new Set(selectedIds);
  const foundIds = new Set(records.filter((record) => selectedSet.has(record.persona_id)).map((record) => record.persona_id));
  const missingIds = selectedIds.filter((id) => !foundIds.has(id));
  if (missingIds.length > 0) throw new Error(`persona ids missing from pool: ${missingIds.join(", ")}`);

  fs.mkdirSync(args.outputDir, { recursive: true });
  const callsPath = path.join(args.outputDir, "augmentation_calls.jsonl");
  if (fs.existsSync(callsPath)) fs.unlinkSync(callsPath);
  const errors = [];
  const augmented = recoverExperiences(args.recoverCalls, selectedSet);
  for (const [personaId, experience] of augmented) {
    experience.seed = `${args.seed}:${personaId}`;
    appendJsonl(callsPath, {
      ts: new Date().toISOString(),
      persona_id: personaId,
      attempt: experience.source_attempt,
      status: "recovered",
      recovery_source: path.relative(ROOT, args.recoverCalls)
    });
  }
  const { default: pLimit } = await import("p-limit");
  const limit = pLimit(args.concurrency);
  const startedAt = new Date().toISOString();
  const startedMs = Date.now();

  await Promise.all(records.filter((record) => selectedSet.has(record.persona_id) && !augmented.has(record.persona_id)).map((record) => limit(async () => {
    let validationError = "";
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      const messages = buildMessages(record, args.seed);
      if (validationError) {
        messages[1].content += `\n\n上一次未通过确定性检查：${validationError}\n重写全文，不要解释检查信息。`;
      }
      const callStartedMs = Date.now();
      let raw = "";
      try {
        raw = await chatCompletion(messages, {
          role: "chat_service",
          temperature: 0.85,
          max_tokens: 1500,
          timeoutMs: 90000,
          response_format: { type: "json_object" }
        });
        const narrative = normalizeExperience(parseJsonObject(raw));
        augmented.set(record.persona_id, {
          seed: `${args.seed}:${record.persona_id}`,
          generation_method: "task_decisions_to_nonprescriptive_life_history",
          life_history_narrative: narrative
        });
        appendJsonl(callsPath, {
          ts: new Date().toISOString(),
          persona_id: record.persona_id,
          attempt,
          status: "ok",
          latency_ms: Date.now() - callStartedMs,
          raw
        });
        return;
      } catch (error) {
        validationError = String(error?.message || error);
        appendJsonl(callsPath, {
          ts: new Date().toISOString(),
          persona_id: record.persona_id,
          attempt,
          status: "error",
          latency_ms: Date.now() - callStartedMs,
          error: validationError,
          raw
        });
      }
    }
    errors.push({ persona_id: record.persona_id, error: validationError });
  })));

  if (errors.length > 0) {
    writeJson(path.join(args.outputDir, "augmentation_errors.json"), errors);
    throw new Error(`failed to augment ${errors.length} personas; see augmentation_errors.json`);
  }
  const outputRecords = records.map((record) => augmented.has(record.persona_id)
    ? { ...record, task_grounded_experience_v1: augmented.get(record.persona_id) }
    : record);
  const poolPath = path.join(args.outputDir, "persona_pool_career_general_profile_task_grounded_v1.json");
  writeJson(poolPath, outputRecords);
  writeJson(path.join(args.outputDir, "pool_manifest.json"), {
    schema: "career_general_profile_task_grounded_manifest_v1",
    seed: args.seed,
    generated_at: new Date().toISOString(),
    started_at: startedAt,
    wall_clock_ms: Date.now() - startedMs,
    provider: modelRegistry.getProvider(),
    model: modelRegistry.getModel("chat_service"),
    base_url_host: new URL(modelRegistry.getBaseUrl()).host,
    source_pool_path: path.relative(ROOT, args.input),
    source_pool_sha256: sha256(sourceBytes),
    output_pool_path: path.relative(ROOT, poolPath),
    output_pool_sha256: sha256(fs.readFileSync(poolPath)),
    selected_persona_ids: selectedIds,
    records_total: outputRecords.length,
    records_augmented: augmented.size,
    records_recovered_from_calls: Array.from(augmented.values()).filter((item) => item.source_attempt).length,
    recovery_calls_path: args.recoverCalls ? path.relative(ROOT, args.recoverCalls) : null,
    decision_basis: [
      "payer_user_and_purchase_route",
      "child_adult_elder_lived_contact",
      "emotional_experience_and_practical_utility",
      "scale_affordability_and_distinct_value",
      "adjacent_category_price_anchors"
    ],
    prompt_policy: "task decisions guide biography generation, but output contains only lived episodes and no target product, option labels, recommendation, or answer",
    script_path: path.relative(ROOT, __filename),
    script_sha256: sha256(fs.readFileSync(__filename))
  });
  console.log(JSON.stringify({
    pool_path: path.relative(ROOT, poolPath),
    records_total: outputRecords.length,
    records_augmented: augmented.size,
    selected_persona_ids: selectedIds
  }, null, 2));
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.stack || error.message || String(error));
    process.exitCode = 1;
  });
}
