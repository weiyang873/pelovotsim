"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const ROOT = path.join(__dirname, "..", "..");
const DEFAULT_SOURCE_ROOTS = [
  path.join(ROOT, "runs_v4flash_0731", "team_pilot", "team_ui_parity_42x2_official_ds_20260807"),
  path.join(ROOT, "runs_v4flash_0731", "team_pilot", "team_ui_parity_42x2_official_ds_20260807_retry_simple40")
];
const DEFAULT_OUT_DIR = path.join(ROOT, "runs_v4flash_0731", "team_d5_pricing_action_persona_from_ui_parity_42x2_official_ds_20260808");
const DEFAULT_POOL_PATH = path.join(ROOT, "data", "persona_pool_random42_interface_v1", "persona_pool_v2.json");
const TEMPERATURE = 1.0;
const LAYERED_NOMAP_GENERATION_SEED = 20260806;

loadLocalEnv();

const RD = require("../../server/llm/rdCalculator");
const { PERSONAS } = require("../sim/persona_pool");
const {
  loadRound2PricingContextConfig,
  validateRound2Price
} = require("../../server/multiplayer/pricingContext");

function parseArgs(argv) {
  const args = {
    sourceRoots: DEFAULT_SOURCE_ROOTS.slice(),
    outDir: DEFAULT_OUT_DIR,
    poolPath: DEFAULT_POOL_PATH,
    arms: ["simple", "layered"],
    limitPerArm: 42,
    concurrency: 3,
    overwrite: false
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--source-root") args.sourceRoots.push(path.resolve(ROOT, String(argv[++index] || "").trim()));
    else if (arg === "--source-roots") args.sourceRoots = String(argv[++index] || "").split(",").map((item) => path.resolve(ROOT, item.trim())).filter(Boolean);
    else if (arg === "--out-dir") args.outDir = path.resolve(ROOT, String(argv[++index] || "").trim());
    else if (arg === "--pool-path") args.poolPath = path.resolve(ROOT, String(argv[++index] || "").trim());
    else if (arg === "--arms") args.arms = String(argv[++index] || "").split(",").map((item) => item.trim()).filter(Boolean);
    else if (arg === "--limit-per-arm") args.limitPerArm = Number(argv[++index]);
    else if (arg === "--concurrency") args.concurrency = Number(argv[++index]);
    else if (arg === "--overwrite") args.overwrite = true;
    else throw new Error(`unknown argument: ${arg}`);
  }
  if (!args.arms.length || args.arms.some((arm) => !["simple", "layered", "layered_nomap", "team_layered_nomap"].includes(arm))) {
    throw new Error("--arms must contain simple, layered, layered_nomap, and/or team_layered_nomap");
  }
  if (!Number.isInteger(args.limitPerArm) || args.limitPerArm < 1) throw new Error("--limit-per-arm must be a positive integer");
  if (!Number.isInteger(args.concurrency) || args.concurrency < 1) throw new Error("--concurrency must be a positive integer");
  return args;
}

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
    if ((value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!Object.prototype.hasOwnProperty.call(process.env, key)) process.env[key] = value;
  }
}

function loadJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  fs.renameSync(tmp, filePath);
}

function appendJsonl(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.appendFileSync(filePath, `${JSON.stringify(value)}\n`, "utf8");
}

function sha256(value) {
  return crypto.createHash("sha256").update(String(value || "")).digest("hex");
}

function cleanText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function truncate(value, max = 800) {
  const text = cleanText(value);
  return text.length > max ? `${text.slice(0, max)}...` : text;
}

function splitExpressionStyle(style) {
  const text = String(style || "");
  const marker = "\n\n你的思维特征";
  const markerIndex = text.indexOf(marker);
  if (markerIndex < 0) return { display: text.trim(), behavior: "" };
  return {
    display: text.slice(0, markerIndex).trim(),
    behavior: text.slice(markerIndex).trim()
  };
}

function seededPick(items, seedText) {
  const list = Array.isArray(items) ? items : [];
  if (!list.length) return "";
  const digest = crypto.createHash("sha256").update(String(seedText)).digest("hex");
  const index = parseInt(digest.slice(0, 8), 16) % list.length;
  return list[index];
}

function educationBand(education) {
  const value = String(education || "");
  if (/博士|MBA|海归硕士|海外硕士|985|211/u.test(value)) return "high";
  if (/本科|硕士/u.test(value)) return "medium";
  if (/高中|中专|大专/u.test(value)) return "low";
  return "medium";
}

function seedMemoryToText(seed) {
  const memory = seed && typeof seed === "object" ? seed : {};
  return [
    String(memory.backstory || "").trim(),
    `做决策的习惯：${String(memory.decision_habit || "").trim()}`,
    `讨论风格：${String(memory.discussion_style || "").trim()}`,
    `自信区：${String(memory.confidence_zone || "").trim()}`,
    `盲区：${String(memory.blind_zone || "").trim()}`,
    `压力下的反应：${String(memory.under_pressure || "").trim()}`,
    `口头禅/说话习惯：${String(memory.pet_phrases || "").trim()}`
  ].filter(Boolean).join("\n");
}

function buildLayeredSeedMemory(profile) {
  const baseSeed = `${LAYERED_NOMAP_GENERATION_SEED}:team:L0:${profile.persona_id}`;
  return {
    backstory: `${profile.background || profile.role || "有多年行业经验"}；现在以${profile.role || "企业管理者"}身份来读 EMBA，希望把自己的经验迁移到 AI 宠物机器人这类新业务。`,
    decision_habit: `${profile.decisionStyle || "先凭经验判断，再看数据验证。"}遇到不确定时，会先回到自己熟悉的行业和组织经验里找类比。`,
    discussion_style: `${profile.surface?.expression_style || profile.expressionStyle || "讨论时会带着明显个人风格。"}课堂讨论中${seededPick(["会先抛观点再补理由", "会先听一轮再抓关键点回应", "会把问题拉回落地和资源约束", "会用自己熟悉的案例解释判断"], `${baseSeed}:discussion`)}。`,
    confidence_zone: `${profile.industry || "自己熟悉的行业"}、渠道打法、组织资源和真实客户场景里的判断最有把握。`,
    blind_zone: `${profile.blindSpots || "对陌生领域容易忽略或回避。"}在 AI 机器人、能力卡组合和用户研究细节上容易带入既有经验。`,
    under_pressure: seededPick([
      "时间紧时会先做一个能讲得通的选择，再把细节留到后面修。",
      "时间紧时会把问题简化成资源、客户和回款三件事。",
      "时间紧时会优先选择自己能解释清楚、能管得住风险的方案。",
      "时间紧时会抓一个最像既有业务的路径，避免过度发散。"
    ], `${baseSeed}:pressure`),
    pet_phrases: seededPick([
      "先把这个事落到具体人群上。",
      "不能光听着高级，要能卖得出去。",
      "这个逻辑要闭环。",
      "我先按自己的经验判断。"
    ], `${baseSeed}:phrase`)
  };
}

function buildLayeredClassroomProfile(profile, seedMemory) {
  const baseSeed = `${LAYERED_NOMAP_GENERATION_SEED}:team:L1:${profile.persona_id}`;
  const band = educationBand(profile.surface?.edu || profile.education);
  return {
    abstraction_ability: band === "high" ? "high" : band === "low" ? "low" : "medium",
    writing_precision: band === "low" ? "low" : seededPick(["medium", "high"], `${baseSeed}:writing`),
    coach_receptiveness: seededPick(["medium", "medium", "high", "low"], `${baseSeed}:coach`),
    effort_style: seededPick(["认真打磨", "先交差后面改", "先交差后面改", "依赖队友"], `${baseSeed}:effort`),
    team_role: seededPick(["主导", "质疑", "跟随", "调停"], `${baseSeed}:role`),
    why_here: `希望把${profile.industry || "既有行业"}经验系统化，并借课堂判断 AI 宠物机器人是否能形成新增长点。`,
    knowledge_ceiling: seedMemory.blind_zone || "在陌生领域的市场定位与用户研究容易停留在直觉层面。",
    response_to_AI_coach: seededPick([
      "会先看建议是否实用，能落地就采纳，太虚就保留意见。",
      "会接受能帮他收敛目标用户和能力配置的反馈，但会抵触纯框架化表达。",
      "会把 AI Coach 当成提醒清单，最终仍按自己的行业经验拍板。",
      "会认真吸收结构化建议，但会要求它解释清楚为什么能赚钱。"
    ], `${baseSeed}:ai_coach`)
  };
}

function enrichProfileRecord(record) {
  const base = PERSONAS[record.archetype] || {};
  const profile = {
    ...record,
    persona_id: record.persona_id,
    archetype_label: record.archetype_label || base.label || record.archetype || "",
    role: base.role || "",
    background: base.background || record.archetype_label || "",
    industry: base.industry || "",
    decisionStyle: base.decisionStyle || "",
    riskPreference: base.riskPreference || "",
    expressionStyle: record.surface?.expression_style || base.expressionStyle || "",
    blindSpots: base.blindSpots || "",
    pricingBias: base.pricingBias || ""
  };
  const seedMemory = buildLayeredSeedMemory(profile);
  const classroomProfile = buildLayeredClassroomProfile(profile, seedMemory);
  return {
    ...profile,
    seedMemory,
    classroomProfile,
    layeredSystemPrompt: [
      seedMemoryToText(seedMemory),
      "",
      "## 课堂行为画像",
      JSON.stringify(classroomProfile, null, 2)
    ].join("\n")
  };
}

function isLayeredNoMapArm(arm) {
  return arm === "layered_nomap" || arm === "team_layered_nomap";
}

function formatPersona(record, isLeader, arm) {
  const surface = record.surface || {};
  const expression = splitExpressionStyle(surface.expression_style || "");
  const gender = surface.gender === "female" ? "女" : surface.gender === "male" ? "男" : "未知";
  const overseas = surface.overseas?.hasOverseas
    ? `${surface.overseas.destination}，${surface.overseas.duration}`
    : "无";
  if (isLayeredNoMapArm(arm)) {
    return [
      "你现在就是下面这位 EMBA 课堂参与者。发言时必须用 TA 的第一人称口吻、表达节奏、词汇习惯和犹豫方式；不要统一成顾问报告腔，不要像研究助理，也不要替别人总结。",
      `姓名：${surface.name || record.persona_id}`,
      `persona_id：${record.persona_id}`,
      `原型：${record.archetype_label || record.archetype || ""}`,
      `性别：${gender}`,
      surface.age ? `年龄：${surface.age}岁` : "",
      surface.edu ? `学历：${surface.edu}` : "",
      `海外经历：${overseas}`,
      surface.mbti ? `MBTI：${surface.mbti}` : "",
      `表达风格：${expression.display || "自然、口语化"}`,
      expression.behavior ? expression.behavior : "",
      "",
      "【Layered persona system prompt（no-map）】",
      record.layeredSystemPrompt,
      "",
      `角色：${record.role}`,
      `行业经验：${record.industry}`,
      `背景：${record.background}`,
      `决策风格：${record.decisionStyle}`,
      `风险偏好：${record.riskPreference}`,
      `盲区：${record.blindSpots}`,
      `定价倾向：${record.pricingBias}`,
      isLeader ? "你是组长，最后要代表全队提交；但说话仍然必须像你本人。" : "你是普通组员，只说你自己愿意在小组里公开说出口的话。",
      "不要引用认知地图；本 arm 不注入 map_xx 记忆。"
    ].filter(Boolean).join("\n");
  }
  return [
    "你现在就是下面这位 EMBA 课堂参与者。发言时必须用 TA 的第一人称口吻、表达节奏、词汇习惯和犹豫方式；不要统一成顾问报告腔，不要像研究助理，也不要替别人总结。",
    `姓名：${surface.name || record.persona_id}`,
    `persona_id：${record.persona_id}`,
    `原型：${record.archetype_label || record.archetype || ""}`,
    `性别：${gender}`,
    surface.age ? `年龄：${surface.age}岁` : "",
    surface.edu ? `学历：${surface.edu}` : "",
    `海外经历：${overseas}`,
    surface.mbti ? `MBTI：${surface.mbti}` : "",
    `表达风格：${expression.display || "自然、口语化"}`,
    expression.behavior ? expression.behavior : "",
    isLeader ? "你是组长，最后要代表全队提交；但说话仍然必须像你本人。" : "你是普通组员，只说你自己愿意在小组里公开说出口的话。",
    arm === "layered"
      ? "这次是 layered 组：你的原型、经历和表达风格都可以影响判断。"
      : "这次是 simple 组：保持真实课堂参与者的直觉表达，不要展开隐含人格分析。"
  ].filter(Boolean).join("\n");
}

function loadProfileMap(poolPath) {
  const records = loadJson(poolPath);
  if (!Array.isArray(records) || !records.length) throw new Error(`persona pool must be a non-empty array: ${poolPath}`);
  return new Map(records.map((record) => {
    const enriched = enrichProfileRecord(record);
    return [enriched.persona_id, enriched];
  }));
}

function formatYuan(value) {
  const num = Number(value);
  return Number.isFinite(num) ? `¥${Math.round(num).toLocaleString("zh-CN")}` : "NA";
}

function formatWan(value) {
  const num = Number(value);
  return Number.isFinite(num) ? `${Number(num.toFixed(1))}万` : "NA";
}

function selectedCardsCostSummary(cards) {
  const rows = [];
  let dCOGS = 0;
  let nre = 0;
  for (const card of cards || []) {
    const params = RD.getCapabilityParams(card.cap_id, card.tier);
    dCOGS += Number(params.dCOGS || 0);
    nre += Number(params.nre_tier ?? params.nre ?? 0);
    rows.push(`${card.cap_id}@${card.tier}（${params.cap_name || card.cap_id}，${formatYuan(params.dCOGS)}/台，研发${formatWan(params.nre_tier ?? params.nre)}）`);
  }
  return {
    rows,
    dCOGS,
    nre,
    baseCost: Number(RD.GLOBAL_PARAMS.V || 0),
    unitCost: Number(RD.GLOBAL_PARAMS.V || 0) + dCOGS
  };
}

function buildPricingUiPanel(source, pricing) {
  const settlement = source.settlement;
  const r1 = settlement.r1_frozen || settlement.r1 || {};
  const cards = settlement.r2_cards || [];
  const summary = selectedCardsCostSummary(cards);
  const rdInput = settlement.r2_rd_input || {};
  return [
    "【界面：产品售价】",
    `已冻结市场：${r1.grid_label || r1.grid_id || ""}；架构：${r1.architecture || ""}`,
    `WHO：${r1.vp_summary?.who || ""}`,
    `PAIN：${r1.vp_summary?.pain || ""}`,
    `HOW：${r1.vp_summary?.how || ""}`,
    `已选能力卡：${summary.rows.join("、") || "无"}`,
    `基础成本：${formatYuan(summary.baseCost)}；能力增量成本：${formatYuan(summary.dCOGS)}；单台成本显示：${formatYuan(summary.unitCost)}；研发投入显示：${formatWan(summary.nre)}`,
    `界面显示的价格滑块范围：${formatYuan(pricing.price_min)} 到 ${formatYuan(pricing.price_max)}；步长不作为决策提示。`,
    "请只按这个界面能看到的信息、前面团队已确定的市场和选卡来定价；不要使用界面外的隐藏公式。"
  ].join("\n");
}

function findLastLabeledLine(raw, regexp) {
  const lines = String(raw || "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const match = lines[index].match(regexp);
    if (match) return match[1].trim();
  }
  return "";
}

function parsePricingActionLabel(raw) {
  const explicit = findLastLabeledLine(raw, /^定价动作\s*[：:]\s*(压低售价抢量|抬高售价守毛利)\s*$/u);
  if (explicit === "压低售价抢量") return "lower_price_for_volume";
  if (explicit === "抬高售价守毛利") return "higher_price_for_margin";
  const text = String(raw || "");
  if (/(?:我选|选择|选)\s*A/u.test(text) || /压低售价抢量|抢量|低价换量/u.test(text)) return "lower_price_for_volume";
  if (/(?:我选|选择|选)\s*B/u.test(text) || /抬高售价守毛利|守毛利|保护毛利|高价守毛利/u.test(text)) return "higher_price_for_margin";
  return "";
}

function parseTierLabel(raw) {
  const explicit = findLastLabeledLine(raw, /^相对档位\s*[：:]\s*(中高|中低|高|中|低)\s*$/u);
  if (explicit === "高" || explicit === "中高") return "high";
  if (explicit === "低" || explicit === "中低") return "low";
  if (explicit === "中") return "mid";
  const text = String(raw || "");
  if (/高档|高位|偏高|高价/u.test(text)) return "high";
  if (/低档|低位|偏低|低价/u.test(text)) return "low";
  if (/中档|中位|适中|中等/u.test(text)) return "mid";
  return "";
}

function parsePriceToken(token) {
  const normalized = String(token || "").replace(/,/g, "").trim();
  const value = Number(normalized);
  return Number.isFinite(value) ? value : null;
}

function extractPriceCandidates(raw) {
  const text = String(raw || "");
  const labeled = [...text.matchAll(/(?:最终价格|最终定价|提交价格|价格)\s*[：:]?\s*[¥￥]?\s*([1-9][0-9,]{2,7})\s*(?:元|块|RMB)?/gu)]
    .map((match) => parsePriceToken(match[1]))
    .filter(Number.isFinite);
  if (labeled.length) return labeled;
  return [...text.matchAll(/[¥￥]?\s*([1-9][0-9,]{2,7})\s*(?:元|块|RMB)/gu)]
    .map((match) => parsePriceToken(match[1]))
    .filter(Number.isFinite);
}

function parseFinalPrice(raw, pricing) {
  const matches = extractPriceCandidates(raw);
  const price = matches.length ? matches[matches.length - 1] : null;
  const check = validateRound2Price(price, pricing);
  if (!check.ok) throw new Error(`${check.error}: ${price}`);
  return Math.round(price);
}

function pricingOpinionSummary(opinions) {
  return opinions.map((opinion) => [
    `${opinion.member_id}（${opinion.member_name}${opinion.is_leader ? "，组长" : ""}）`,
    `动作=${opinion.pricing_action || "NA"}；档位=${opinion.tier || "NA"}；价格=${formatYuan(opinion.price)}`,
    `原话摘要：${truncate(opinion.raw_response, 420)}`
  ].join("\n")).join("\n\n");
}

async function callText(chatCompletion, messages, maxTokens = 900) {
  return String(await chatCompletion(messages, {
    role: "chat_service",
    temperature: TEMPERATURE,
    max_tokens: maxTokens,
    timeoutMs: 90000,
    maxRetries: 2,
    disableThinking: true
  })).trim();
}

async function runMemberPricingOpinion({ chatCompletion, profile, isLeader, arm, pricingPanel, pricing }) {
  const system = formatPersona(profile, isLeader, arm);
  const messages = [
    { role: "system", content: system },
    {
      role: "user",
      content: [
        pricingPanel,
        "",
        "【D5 第一步：定价动作】",
        "现在你站在产品售价滑块前。先按你自己的说话方式判断：",
        "A：压低售价抢量。意思是用相对更低的售价换更多用户愿意买，不追求单台高毛利。",
        "B：抬高售价守毛利。意思是接受销量可能少一些，用相对更高售价覆盖能力成本和渠道抽成，保护单台毛利。",
        "只能在 A 和 B 里选一个；如果心里摇摆，也要说出此刻会怎么选。",
        "最后单独写一行：定价动作：压低售价抢量 或 定价动作：抬高售价守毛利",
        "不要输出 JSON，不要 Markdown 表格。"
      ].join("\n")
    }
  ];
  const actionRaw = await callText(chatCompletion, messages, 700);
  messages.push({ role: "assistant", content: actionRaw });
  messages.push({
    role: "user",
    content: [
      "【D5 第二步：相对档位】",
      "继续用你自己的说话方式。承接刚才的动作，你会把价格放在相对高档、中档、还是低档？",
      "如果你刚才选压低售价抢量，低档或中档更符合这个动作；如果你选抬高售价守毛利，中档或高档更符合这个动作。",
      "高/中/低只是滑块相对位置，不给固定数值段，也不代表建议价或锚点。",
      "最后单独写一行：相对档位：高 或 相对档位：中 或 相对档位：低",
      "不要输出 JSON，不要 Markdown 表格。"
    ].join("\n")
  });
  const tierRaw = await callText(chatCompletion, messages, 700);
  messages.push({ role: "assistant", content: tierRaw });
  messages.push({
    role: "user",
    content: [
      "【D5 第三步：最终价格】",
      `继续用你自己的说话方式。现在请在界面滑块 ${pricing.price_min}-${pricing.price_max} 里提交一个最终价格。`,
      "不要使用固定步长，也不要把上下限或中点当默认答案。",
      "像真实参与者一样说一句你为什么最后落在这个数字。",
      "最后单独写一行：最终价格：<一个整数>元",
      "不要输出 JSON，不要 Markdown 表格。"
    ].join("\n")
  });
  let priceRaw = "";
  let price = null;
  let lastPriceError = "";
  for (let attempt = 0; attempt < 3; attempt += 1) {
    priceRaw = await callText(chatCompletion, messages, 900);
    try {
      price = parseFinalPrice(priceRaw, pricing);
      break;
    } catch (error) {
      lastPriceError = String(error?.message || error);
      messages.push({ role: "assistant", content: priceRaw });
      messages.push({
        role: "user",
        content: [
          `刚才的最终价格无法被界面识别，原因：${lastPriceError}`,
          `请不要改变你的定价想法，只把最终价格补成 ${pricing.price_min}-${pricing.price_max} 范围内的阿拉伯数字。`,
          "最后单独写一行：最终价格：<一个整数>元"
        ].join("\n")
      });
    }
  }
  if (!Number.isFinite(price)) throw new Error(`member_price_parse_failure: ${lastPriceError}`);
  const combined = [
    "【定价动作】",
    actionRaw,
    "",
    "【相对档位】",
    tierRaw,
    "",
    "【最终价格】",
    priceRaw
  ].join("\n");
  return {
    member_id: profile.persona_id,
    member_name: profile.surface?.name || profile.persona_id,
    is_leader: Boolean(isLeader),
    pricing_action: parsePricingActionLabel(actionRaw),
    tier: parseTierLabel(tierRaw),
    price,
    action_raw: actionRaw,
    tier_raw: tierRaw,
    price_raw: priceRaw,
    raw_response: combined,
    messages
  };
}

async function runMemberReaction({ chatCompletion, profile, isLeader, arm, pricingPanel, opinions }) {
  const messages = [
    { role: "system", content: formatPersona(profile, isLeader, arm) },
    {
      role: "user",
      content: [
        pricingPanel,
        "",
        "【成员独立定价结果】",
        pricingOpinionSummary(opinions),
        "",
        "现在进入小组定价讨论。请只用你自己的口吻发言 2-4 句：你会坚持自己的价格、被谁说服，还是折中？",
        "不要重新写咨询报告，不要从头算账，只回应成员已经说出的顾虑。"
      ].join("\n")
    }
  ];
  return {
    member_id: profile.persona_id,
    member_name: profile.surface?.name || profile.persona_id,
    is_leader: Boolean(isLeader),
    text: await callText(chatCompletion, messages, 700)
  };
}

async function runLeaderFinal({ chatCompletion, leaderProfile, arm, pricingPanel, pricing, opinions, reactions }) {
  let messages = [
    { role: "system", content: formatPersona(leaderProfile, true, arm) },
    {
      role: "user",
      content: [
        pricingPanel,
        "",
        "【成员独立定价结果】",
        pricingOpinionSummary(opinions),
        "",
        "【小组讨论发言】",
        reactions.map((item) => `${item.member_id}（${item.member_name}）：${item.text}`).join("\n"),
        "",
        "你是组长。请仍然用你自己的口吻代表全队收敛，不要变成报告腔。",
        "必须给出明确最终选择，并在最后三行分别写：",
        "定价动作：压低售价抢量 或 定价动作：抬高售价守毛利",
        "相对档位：高 或 相对档位：中 或 相对档位：低",
        "最终价格：<一个整数>元",
        "不要输出 JSON，不要 Markdown 表格。"
      ].join("\n")
    }
  ];
  let lastRaw = "";
  let lastError = "";
  for (let attempt = 0; attempt < 3; attempt += 1) {
    lastRaw = await callText(chatCompletion, messages, 1000);
    try {
      return {
        raw: lastRaw,
        pricing_action: parsePricingActionLabel(lastRaw),
        tier: parseTierLabel(lastRaw),
        price: parseFinalPrice(lastRaw, pricing)
      };
    } catch (error) {
      lastError = String(error?.message || error);
      messages = [
        { role: "system", content: formatPersona(leaderProfile, true, arm) },
        {
          role: "user",
          content: [
            `你上一次组长最终提交无法被界面识别，原因：${lastError}`,
            `不要改变全队刚才的定价想法，只修正最后三行，让价格是 ${pricing.price_min}-${pricing.price_max} 范围内的阿拉伯数字。`,
            "上一次提交：",
            lastRaw,
            "",
            "最后三行必须是：",
            "定价动作：压低售价抢量 或 定价动作：抬高售价守毛利",
            "相对档位：高 或 相对档位：中 或 相对档位：低",
            "最终价格：<一个整数>元"
          ].join("\n")
        }
      ];
    }
  }
  throw new Error(`leader_price_parse_failure: ${lastError}`);
}

function percentile(values, pct) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const pos = (sorted.length - 1) * pct;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return lo === hi ? sorted[lo] : sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

function mean(values) {
  const nums = values.filter(Number.isFinite);
  return nums.length ? nums.reduce((sum, value) => sum + value, 0) / nums.length : null;
}

function sd(values) {
  const nums = values.filter(Number.isFinite);
  if (nums.length < 2) return 0;
  const avg = mean(nums);
  return Math.sqrt(nums.reduce((sum, value) => sum + (value - avg) ** 2, 0) / (nums.length - 1));
}

function round(value, digits = 0) {
  return value == null ? null : Number(value.toFixed(digits));
}

function rowMetrics(row) {
  const output = row.settlement?.output || row.settlement || {};
  const profit = Number(row.profit);
  return {
    arm: row.arm,
    team_id: row.team_id,
    source_team_id: row.source_team_id,
    grid_id: row.grid_id,
    architecture: row.architecture,
    VPscore: row.VPscore,
    price: row.price,
    source_price: row.source_price,
    card_count: row.card_count,
    profit,
    loss: Number.isFinite(profit) ? profit < 0 : null,
    units: Number(output.units ?? output.Q ?? row.rd_input?.Q),
    share: Number(output.share),
    pricing_action: row.pricing_action,
    tier: row.tier,
    member_price_min: Math.min(...row.member_opinions.map((item) => item.price).filter(Number.isFinite)),
    member_price_max: Math.max(...row.member_opinions.map((item) => item.price).filter(Number.isFinite))
  };
}

function summarize(rows) {
  const ok = rows.filter((row) => row.status === "OK");
  const metrics = ok.map(rowMetrics);
  const byArm = {};
  for (const arm of [...new Set(rows.map((row) => row.arm))].sort()) {
    const armRows = ok.filter((row) => row.arm === arm);
    const armMetrics = armRows.map(rowMetrics);
    const prices = armMetrics.map((item) => item.price).filter(Number.isFinite);
    const profits = armMetrics.map((item) => item.profit).filter(Number.isFinite);
    const cards = armMetrics.map((item) => item.card_count).filter(Number.isFinite);
    const losses = armMetrics.filter((item) => item.loss).length;
    byArm[arm] = {
      chains_total: rows.filter((row) => row.arm === arm).length,
      chains_ok: armRows.length,
      chains_failed: rows.filter((row) => row.arm === arm && row.status !== "OK").length,
      loss_count: losses,
      loss_rate_pct: armRows.length ? round(losses / armRows.length * 100, 1) : null,
      price_min: round(percentile(prices, 0), 0),
      price_p25: round(percentile(prices, 0.25), 0),
      price_p50: round(percentile(prices, 0.5), 0),
      price_p75: round(percentile(prices, 0.75), 0),
      price_max: round(percentile(prices, 1), 0),
      price_sd: round(sd(prices), 0),
      profit_p50: round(percentile(profits, 0.5), 0),
      profit_sd: round(sd(profits), 0),
      cards_p50: round(percentile(cards, 0.5), 1)
    };
  }
  return {
    chains_total: rows.length,
    chains_ok: ok.length,
    chains_failed: rows.length - ok.length,
    by_arm: byArm,
    metrics
  };
}

function discoverSources(sourceRoots, arms, limitPerArm) {
  const byKey = new Map();
  for (const root of sourceRoots) {
    if (!fs.existsSync(root)) continue;
    for (const name of fs.readdirSync(root)) {
      const dir = path.join(root, name);
      const metaPath = path.join(dir, "run_meta.json");
      const settlementPath = path.join(dir, "settlement.json");
      if (!fs.existsSync(metaPath) || !fs.existsSync(settlementPath)) continue;
      const meta = loadJson(metaPath);
      if (!arms.includes(meta.arm)) continue;
      const key = `${meta.arm}:${meta.seed}`;
      byKey.set(key, { dir, meta, settlementPath });
    }
  }
  const grouped = {};
  for (const source of byKey.values()) {
    if (!grouped[source.meta.arm]) grouped[source.meta.arm] = [];
    grouped[source.meta.arm].push(source);
  }
  const selected = [];
  for (const arm of arms) {
    const items = (grouped[arm] || []).sort((a, b) => String(a.meta.seed).localeCompare(String(b.meta.seed)));
    selected.push(...items.slice(0, limitPerArm));
  }
  return selected;
}

async function runOneSource({ source, profiles, pricing, chatCompletion, outDir, callsPath }) {
  const meta = source.meta;
  const settlement = loadJson(source.settlementPath);
  const sourceEnvelope = { meta, settlement };
  const memberProfiles = (meta.profile_ids || []).map((id) => {
    const profile = profiles.get(id);
    if (!profile) throw new Error(`missing persona profile: ${id}`);
    return profile;
  });
  const leaderIndex = memberProfiles.findIndex((profile) => profile.persona_id === meta.leader_id);
  if (leaderIndex < 0) throw new Error(`leader_id not found in profile_ids: ${meta.leader_id}`);
  const pricingPanel = buildPricingUiPanel(sourceEnvelope, pricing);
  const startedAt = Date.now();
  const opinions = [];
  for (let index = 0; index < memberProfiles.length; index += 1) {
    opinions.push(await runMemberPricingOpinion({
      chatCompletion,
      profile: memberProfiles[index],
      isLeader: index === leaderIndex,
      arm: meta.arm,
      pricingPanel,
      pricing
    }));
  }
  const reactions = [];
  for (let index = 0; index < memberProfiles.length; index += 1) {
    reactions.push(await runMemberReaction({
      chatCompletion,
      profile: memberProfiles[index],
      isLeader: index === leaderIndex,
      arm: meta.arm,
      pricingPanel,
      opinions
    }));
  }
  const final = await runLeaderFinal({
    chatCompletion,
    leaderProfile: memberProfiles[leaderIndex],
    arm: meta.arm,
    pricingPanel,
    pricing,
    opinions,
    reactions
  });
  const rdInput = {
    ...(settlement.r2_rd_input || {}),
    P: final.price
  };
  const recalculated = await RD.calculate(rdInput);
  const teamKey = `${meta.arm}_${String(meta.seed).split(":").pop().padStart(2, "0")}`;
  const outPath = path.join(outDir, "teams", `${teamKey}.json`);
  const row = {
    status: "OK",
    arm: meta.arm,
    team_id: teamKey,
    source_team_id: meta.team_id,
    source_dir: path.relative(ROOT, source.dir),
    seed: meta.seed,
    profile_ids: meta.profile_ids,
    leader_id: meta.leader_id,
    grid_id: settlement.r1_frozen?.grid_id || settlement.r1?.grid_id || "",
    architecture: settlement.r1_frozen?.architecture || settlement.r1?.architecture || "",
    VPscore: settlement.r1_frozen?.VPscore ?? settlement.r1?.VPscore ?? null,
    source_price: settlement.r2_price,
    price: final.price,
    pricing_action: final.pricing_action,
    tier: final.tier,
    card_count: Array.isArray(settlement.r2_cards) ? settlement.r2_cards.length : null,
    profit: recalculated.profit,
    settlement: recalculated,
    rd_input: rdInput,
    member_opinions: opinions.map((item) => ({
      member_id: item.member_id,
      member_name: item.member_name,
      is_leader: item.is_leader,
      pricing_action: item.pricing_action,
      tier: item.tier,
      price: item.price,
      action_raw: item.action_raw,
      tier_raw: item.tier_raw,
      price_raw: item.price_raw
    })),
    discussion_reactions: reactions,
    leader_final: final,
    pricing_panel_sha256: sha256(pricingPanel),
    latency_ms: Date.now() - startedAt
  };
  writeJson(outPath, row);
  appendJsonl(callsPath, {
    ts: new Date().toISOString(),
    arm: meta.arm,
    team_id: teamKey,
    source_team_id: meta.team_id,
    status: "OK",
    price: final.price,
    source_price: settlement.r2_price,
    profit: recalculated.profit,
    latency_ms: row.latency_ms,
    member_prices: opinions.map((item) => item.price),
    pricing_action: final.pricing_action,
    tier: final.tier
  });
  return row;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  loadLocalEnv();
  const modelRegistry = require("../../server/llm/modelRegistry");
  const deepseek = require("../../server/llm/deepseekClient");
  if (!deepseek.hasAnyKey()) throw new Error("missing LLM API key for team D5 pricing-action-persona pilot");
  if (fs.existsSync(args.outDir) && !args.overwrite) {
    throw new Error(`output dir already exists; pass --overwrite to replace files: ${args.outDir}`);
  }
  fs.mkdirSync(args.outDir, { recursive: true });
  fs.mkdirSync(path.join(args.outDir, "teams"), { recursive: true });
  const callsPath = path.join(args.outDir, "team_d5_calls.jsonl");
  fs.writeFileSync(callsPath, "", "utf8");

  const pricing = loadRound2PricingContextConfig();
  const profiles = loadProfileMap(args.poolPath);
  const sources = discoverSources(args.sourceRoots, args.arms, args.limitPerArm);
  if (!sources.length) throw new Error("no source team settlement files found");
  for (const arm of args.arms) {
    const count = sources.filter((source) => source.meta.arm === arm).length;
    if (count < args.limitPerArm) throw new Error(`only found ${count} source teams for arm=${arm}, need ${args.limitPerArm}`);
  }

  const { default: pLimit } = await import("p-limit");
  const limit = pLimit(args.concurrency);
  const startedAt = new Date().toISOString();
  const rows = new Array(sources.length);
  await Promise.all(sources.map((source, index) => limit(async () => {
    console.error(`[team-d5-pricing-action-persona] start ${index + 1}/${sources.length} ${source.meta.arm} ${source.meta.seed}`);
    try {
      rows[index] = await runOneSource({
        source,
        profiles,
        pricing,
        chatCompletion: deepseek.chatCompletion,
        outDir: args.outDir,
        callsPath
      });
      console.error(`[team-d5-pricing-action-persona] done ${source.meta.arm} ${source.meta.seed} price=${rows[index].price} profit=${Math.round(rows[index].profit)}`);
    } catch (error) {
      const row = {
        status: "FAIL",
        arm: source.meta.arm,
        seed: source.meta.seed,
        source_team_id: source.meta.team_id,
        source_dir: path.relative(ROOT, source.dir),
        error: String(error?.stack || error?.message || error)
      };
      rows[index] = row;
      appendJsonl(callsPath, {
        ts: new Date().toISOString(),
        arm: row.arm,
        source_team_id: row.source_team_id,
        status: "FAIL",
        error: row.error
      });
      console.error(`[team-d5-pricing-action-persona] failed ${source.meta.arm} ${source.meta.seed}: ${String(error?.message || error)}`);
    }
  })));

  const summary = {
    arm_id: "team_d5_pricing_action_persona",
    run_id: path.basename(args.outDir),
    started_at: startedAt,
    finished_at: new Date().toISOString(),
    provider: modelRegistry.getProvider(),
    model: modelRegistry.getModel("chat_service"),
    base_url_host: new URL(modelRegistry.getBaseUrl()).host,
    disable_thinking: true,
    source_roots: args.sourceRoots.map((item) => path.relative(ROOT, item)),
    pool_path: path.relative(ROOT, args.poolPath),
    limit_per_arm: args.limitPerArm,
    concurrency: args.concurrency,
    temperature: TEMPERATURE,
    pricing_context: pricing,
    d5_manipulation: {
      scope: "D5 only; reuses existing team UI-parity R1, selected cards, R2 signals, and rd_input; only final price is replaced before RD.calculate.",
      output_form: "member-level three-turn pricing-action-persona chat -> one persona-style reaction per member -> leader persona-style final price",
      persona_style_injection: "full random42 surface expression_style and MBTI behavior are injected into every member pricing/reaction call and leader final call",
      layered_nomap_generation: args.arms.some(isLayeredNoMapArm)
        ? {
            seed: LAYERED_NOMAP_GENERATION_SEED,
            l0_l1_source: "deterministic builder in scripts/analysis/team_d5_pricing_action_persona_pilot.js",
            map_policy: "no cognitive map injected"
          }
        : null
    },
    pilot_summary: summarize(rows),
    failures: rows.filter((row) => row.status !== "OK")
  };
  writeJson(path.join(args.outDir, "summary.json"), summary);
  console.log(JSON.stringify(summary, null, 2));
  if (summary.failures.length) process.exitCode = 1;
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.stack || error.message || String(error));
    process.exitCode = 1;
  });
}
