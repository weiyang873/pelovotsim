"use strict";

const fs = require("fs");
const path = require("path");

const { chatCompletion } = require("../server/llm/deepseekClient");

const OUTPUT_DIR = path.join(__dirname, "..", "data", "vp_cot_test_logs");
const ITEM_IDS = ["C1", "C2", "C3", "G1", "G2", "G3", "G4", "E1", "E2", "E3"];
const GRID_LABELS = {
  ToB_Cost_Elder: "ToB · 成本领先 · 老年市场",
  ToB_Diff_Elder: "ToB · 差异化 · 老年市场",
  ToB_Cost_Adult: "ToB · 成本领先 · 成人市场",
  ToB_Diff_Adult: "ToB · 差异化 · 成人市场",
  ToB_Cost_Child: "ToB · 成本领先 · 儿童市场",
  ToB_Diff_Child: "ToB · 差异化 · 儿童市场",
  ToC_Cost_Elder: "ToC · 成本领先 · 老年市场",
  ToC_Diff_Elder: "ToC · 差异化 · 老年市场",
  ToC_Cost_Adult: "ToC · 成本领先 · 成人市场",
  ToC_Diff_Adult: "ToC · 差异化 · 成人市场",
  ToC_Cost_Child: "ToC · 成本领先 · 儿童市场",
  ToC_Diff_Child: "ToC · 差异化 · 儿童市场"
};

const SYSTEM_PROMPT = `你是一个严格的商业计划评审专家。你的任务是对一段价值主张（VP）的质量进行评分。

评分规则：
- 共 10 个评分项，每项 1-5 分（只能整数）
- 对每一项，你必须先写 1-2 句推理（为什么给这个分），然后给分
- 严格按照每项的评分标准判断，不要因为"写得流畅"就加分
- 如果某个字段为空或写了"未明确"，对应的 item 最高不超过 2 分

输出格式（严格 JSON，不要加 markdown 代码块）：
{
  "items": [
    {"id": "C1", "reasoning": "...", "score": 3},
    {"id": "C2", "reasoning": "...", "score": 4},
    {"id": "C3", "reasoning": "...", "score": 3},
    {"id": "G1", "reasoning": "...", "score": 4},
    {"id": "G2", "reasoning": "...", "score": 3},
    {"id": "G3", "reasoning": "...", "score": 2},
    {"id": "G4", "reasoning": "...", "score": 3},
    {"id": "E1", "reasoning": "...", "score": 3},
    {"id": "E2", "reasoning": "...", "score": 4},
    {"id": "E3", "reasoning": "...", "score": 3}
  ]
}`;

const CALIBRATION = [
  {
    label: "差_ToB老人",
    gridId: "ToB_Cost_Elder",
    who: "养老院",
    pain: "老人孤单，员工忙",
    how: "机器人陪聊",
    alternative: "",
    boundary: ""
  },
  {
    label: "中_ToB老人",
    gridId: "ToB_Cost_Elder",
    who: "护工短缺的民营养老院",
    pain: "护工不够，老人日常看护难以持续覆盖，尤其夜间无人值守",
    how: "具备基础看护提醒的陪伴机器人，部分替代重复性巡查工作",
    alternative: "传统依赖人力排班巡检",
    boundary: ""
  },
  {
    label: "好_ToB老人",
    gridId: "ToB_Cost_Elder",
    who: "面临护工成本上涨和夜间跌倒高风险的养老机构",
    pain: "护工成本上涨和夜间跌倒高风险；传统依赖人力巡检难以实时响应",
    how: "提供具备离床监测功能的机器人，通过替代部分人工巡检来优化人力配置",
    alternative: "传统依赖人力巡检，成本高且响应慢",
    boundary: "失智老人特殊照护单元需结合个性化护理"
  },
  {
    label: "差_ToC成人",
    gridId: "ToC_Diff_Adult",
    who: "年轻人",
    pain: "生活无聊",
    how: "一个好玩的机器人",
    alternative: "",
    boundary: ""
  },
  {
    label: "中_ToC成人",
    gridId: "ToC_Diff_Adult",
    who: "独居城市白领",
    pain: "下班回家后无人说话，想养宠物又没时间照顾",
    how: "通过能感知情绪的互动陪伴机器人，提供低维护成本的情感连接",
    alternative: "养宠物",
    boundary: ""
  },
  {
    label: "好_ToC成人",
    gridId: "ToC_Diff_Adult",
    who: "25-35岁独居租房的城市白领，尤其是刚搬到新城市社交圈未建立的人群",
    pain: "工作日晚间回到空房的孤独感；周末独处时间长但不想维护社交关系的矛盾；想养宠物但租房限制和出差频繁导致无法承担照顾责任",
    how: "通过能主动发起互动、记忆日常对话偏好的陪伴机器人，在不需要照顾负担的前提下提供可预期的情感回应，填补宠物和社交之间的空白",
    alternative: "养宠物（租房限制+出差）、社交App（维护成本高+被动）、智能音箱（无主动性无情感感知）",
    boundary: "重度社交需求者不适合（机器人无法替代深度人际关系）；长期独居超过3年的用户可能需要评估是否需要专业心理支持而非产品替代"
  },
  {
    label: "差_ToB儿童",
    gridId: "ToB_Diff_Child",
    who: "学校",
    pain: "小孩注意力不集中",
    how: "机器人帮忙教学",
    alternative: "",
    boundary: ""
  },
  {
    label: "中_ToB儿童",
    gridId: "ToB_Diff_Child",
    who: "课后托管机构",
    pain: "低龄儿童（4-8岁）在等待家长接送期间情绪不稳定，托管老师人手不足难以逐一安抚",
    how: "在托管教室部署互动陪伴机器人，通过游戏和故事吸引孩子注意力，减轻老师安抚压力",
    alternative: "播放动画片（被动、无互动）",
    boundary: ""
  },
  {
    label: "好_ToB儿童",
    gridId: "ToB_Diff_Child",
    who: "面临师资流动率高、个性化教学难以落地的中高端幼教机构（民办双语幼儿园、早教中心）",
    pain: "教师流动率高导致教学连续性断裂；每班20+幼儿但教师只能关注少数；家长对个性化反馈期望高但教师无力持续输出",
    how: "部署能记录每个孩子互动偏好和学习进度的陪伴机器人，作为教师的辅助观察者，在自由活动时段提供个性化互动并生成行为报告供教师和家长参考",
    alternative: "外聘助教（成本高且同样面临流动问题）、教学管理软件（只记录不互动）",
    boundary: "0-2岁婴幼儿不适用（认知发展阶段需要真人互动）；大班额公立园设备投入产出比低"
  },
  {
    label: "差_ToC老人",
    gridId: "ToC_Cost_Elder",
    who: "老年人",
    pain: "孤独",
    how: "便宜的陪伴机器人",
    alternative: "",
    boundary: ""
  },
  {
    label: "中_ToC老人",
    gridId: "ToC_Cost_Elder",
    who: "与子女分居的退休老人",
    pain: "日间独处时间长，子女忙于工作无法频繁陪伴，电话沟通越来越少",
    how: "价格亲民的语音陪聊机器人，能定时提醒吃药和播放新闻",
    alternative: "电视（无互动）、电话（依赖子女时间）",
    boundary: ""
  },
  {
    label: "好_ToC老人",
    gridId: "ToC_Cost_Elder",
    who: "60-75岁、子女在外地工作的城镇退休老人，尤其是配偶已故或长期卧病的独居者，子女是实际购买决策者",
    pain: "日间8-10小时独处无人交流；记忆力下降导致忘记吃药和关火；子女远程无法实时了解父母状态产生愧疚和焦虑",
    how: "以子女可承受的价格（<3000元）提供具备定时提醒（吃药/喝水/关火）、语音陪聊和异常报警（跌倒/长时间不动）的基础功能机器人，子女通过App远程查看父母的日常活跃度和健康提醒执行率",
    alternative: "智能手环（老人不愿戴、提醒功能弱）、钟点工上门（每月2000+且服务时间有限）、养老社区（搬迁成本高老人抗拒）",
    boundary: "认知严重退化（中重度失智）的老人无法与机器人有效互动，需专业护理；视力/听力严重受损者需配合辅助设备"
  }
];

function loadLocalEnvFile() {
  const envPath = path.join(__dirname, "..", ".env");
  if (!fs.existsSync(envPath)) return;

  const text = fs.readFileSync(envPath, "utf8");
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const eqIndex = trimmed.indexOf("=");
    if (eqIndex <= 0) continue;

    const key = trimmed.slice(0, eqIndex).trim();
    let value = trimmed.slice(eqIndex + 1).trim();
    if (
      (value.startsWith("\"") && value.endsWith("\"")) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    if (!(key in process.env)) {
      process.env[key] = value;
    }
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableError(err) {
  const message = String(err && err.message ? err.message : err || "");
  return /429|rate limit|too many requests|timeout|timed out|econnreset|socket hang up|temporarily unavailable/i.test(message);
}

async function withRetry(label, runner, options = {}) {
  const retries = Number.isFinite(options.retries) ? options.retries : 3;
  const delayMs = Number.isFinite(options.delayMs) ? options.delayMs : 2000;
  let lastError = null;

  for (let attempt = 1; attempt <= retries; attempt += 1) {
    try {
      return await runner();
    } catch (err) {
      lastError = err;
      if (!isRetryableError(err) || attempt === retries) {
        throw err;
      }
      console.warn(`  ${label} failed (${err.message}). Retry ${attempt}/${retries - 1} in ${delayMs}ms...`);
      await sleep(delayMs);
    }
  }

  throw lastError || new Error(`${label} failed`);
}

function formatTimestamp(date = new Date()) {
  const pad = (value) => String(value).padStart(2, "0");
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate())
  ].join("-") + "_" + [
    pad(date.getHours()),
    pad(date.getMinutes()),
    pad(date.getSeconds())
  ].join("");
}

function buildUserPrompt(input) {
  return `请评估以下价值主张：

【市场定位】${GRID_LABELS[input.gridId] || input.gridId}

【目标客户 WHO】${input.who || "（未填写）"}

【痛点 PAIN】${input.pain || "（未填写）"}

【解决方式 HOW】${input.how || "（未填写）"}

【现有替代方案】${input.alternative || "（未填写）"}

【边界条件】${input.boundary || "（未填写）"}

请按 10 个评分项逐条评分。每项先写推理，再给 1-5 分。

评分标准：

C1 客户可识别度：
1=无标签或"所有人" 2=有标签但极宽泛无限定 3=有1-2个限定条件 4=限定清晰且能看出为什么是核心客户 5=能区分核心vs次级客户或使用者vs付费者

C2 客户与格子一致性：
1=明显矛盾 2=大方向对但模糊 3=一致但客户描述笼统 4=一致且体现格子特征 5=一致且说明了为什么在此格子需求最强

C3 客户规模感：
1=看不出规模或极端个例 2=能猜到有一些人但太模糊 3=客户群显然存在有一定规模 4=规模感明确且暗示了数量来源 5=明确说明了规模来源或增长趋势

G1 痛点具体性：
1=只有情绪词无场景 2=有模糊场景缺画面 3=有具体场景 4=场景具体且高频 5=给出多个场景或解释了反复发生的原因

G2 痛点普遍性：
1=明显个别案例 2=可能有但不确定普遍 3=在该人群中合理普遍 4=高频普遍有结构性原因 5=普遍且有加剧趋势

G3 现有替代方案识别：
1=完全没提 2=隐约提到现状没分析不足 3=明确指出一个替代方案及主要不足 4=指出替代并解释不足的原因 5=对比多个替代或说明结构性失败原因

G4 跨情境稳定性：
1=依赖非常特殊条件 2=条件有特殊性换情境可能不成立 3=正常条件下成立 4=多种正常条件下都成立 5=明确论证了跨情境稳定性

E1 因果机制清晰度：
1=纯口号无机制 2=提到功能没解释如何作用于痛点 3=因果链基本成立 4=因果链清晰且对比替代 5=因果链+替代对比+机制可持续

E2 解法与痛点匹配度：
1=明显不匹配 2=有关联但不精准 3=基本匹配 4=精准匹配看出针对性设计 5=精准匹配+覆盖痛点多个层面

E3 边界条件意识：
1=完全没提 2=隐约有限制意识没说清 3=明确说了一个边界 4=边界合理具体且解释了原因 5=多个边界或说明突破路径`;
}

function parseJsonObject(text) {
  const raw = String(text || "").replace(/```json|```/gi, "").trim();
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  const candidate = start >= 0 && end > start ? raw.slice(start, end + 1) : raw;
  return JSON.parse(candidate);
}

async function callJson(messages, options = {}) {
  let completion = "";
  let lastError = null;
  const variants = [
    messages,
    messages.concat({
      role: "user",
      content: "刚才输出不是合法 JSON。请重新只输出完整、闭合、可解析的 JSON，不要解释，不要 markdown 代码块。"
    })
  ];

  for (const variant of variants) {
    try {
      completion = await withRetry("chatCompletion", () => chatCompletion(variant, options));
      return {
        raw: completion,
        parsed: parseJsonObject(completion)
      };
    } catch (err) {
      lastError = err;
    }
  }

  const detail = completion ? ` Raw head: ${completion.slice(0, 200)}` : "";
  throw new Error(`Failed to obtain valid JSON from DeepSeek: ${lastError ? lastError.message : "unknown error"}.${detail}`);
}

function normalizeItems(items) {
  const byId = new Map();
  for (const item of Array.isArray(items) ? items : []) {
    if (!item || typeof item !== "object") continue;
    byId.set(String(item.id || "").trim(), {
      id: String(item.id || "").trim(),
      reasoning: String(item.reasoning || "").trim(),
      score: Number(item.score)
    });
  }
  return ITEM_IDS.map((id) => byId.get(id)).filter(Boolean);
}

function validateItems(items) {
  const errors = [];
  if (!Array.isArray(items)) {
    return ["items is not an array"];
  }
  if (items.length !== ITEM_IDS.length) {
    errors.push(`expected ${ITEM_IDS.length} items, received ${items.length}`);
  }

  const ids = items.map((item) => item && item.id);
  for (let index = 0; index < ITEM_IDS.length; index += 1) {
    if (ids[index] !== ITEM_IDS[index]) {
      errors.push(`item order mismatch at ${index}: expected ${ITEM_IDS[index]}, received ${ids[index] || "missing"}`);
    }
  }

  for (const item of items) {
    if (!item.reasoning) {
      errors.push(`${item.id}: reasoning is empty`);
    }
    if (!Number.isInteger(item.score) || item.score < 1 || item.score > 5) {
      errors.push(`${item.id}: score must be integer 1-5, got ${item.score}`);
    }
  }
  return errors;
}

function calculateScores(items) {
  const cItems = items.filter((item) => item.id.startsWith("C"));
  const gItems = items.filter((item) => item.id.startsWith("G"));
  const eItems = items.filter((item) => item.id.startsWith("E"));
  const avg = (arr) => {
    const sum = arr.reduce((acc, item) => acc + item.score, 0);
    return Math.round((sum / arr.length) * 10) / 10;
  };

  const C = avg(cItems);
  const G = avg(gItems);
  const E = avg(eItems);
  const VPscore = Math.round(Math.sqrt(C * (G + E) / 2) * 10) / 10;

  return { C, G, E, VPscore };
}

function getTier(label) {
  return String(label || "").split("_")[0];
}

function parseGrid(gridId) {
  const raw = String(gridId || "");
  return {
    channel: raw.startsWith("ToB") ? "ToB" : raw.startsWith("ToC") ? "ToC" : "",
    strategy: raw.includes("_Cost_") ? "Cost" : raw.includes("_Diff_") ? "Diff" : "",
    audience: raw.endsWith("_Elder") ? "Elder" : raw.endsWith("_Adult") ? "Adult" : raw.endsWith("_Child") ? "Child" : ""
  };
}

function detectWhoSignals(who) {
  const text = String(who || "");
  return {
    tob: /(机构|养老院|养老机构|幼儿园|学校|医院|中心|企业|公司|托管机构|园|院)/.test(text),
    toc: /(个人|消费者|用户|年轻人|白领|老人|家长|子女|独居者|租房)/.test(text),
    elder: /(老人|养老|退休|护工|失智|老年)/.test(text),
    adult: /(白领|成人|年轻人|租房|社交圈)/.test(text),
    child: /(儿童|幼教|幼儿|孩子|小孩|托管|家长接送)/.test(text)
  };
}

function isGridMismatch(sample) {
  const grid = parseGrid(sample.gridId);
  const who = detectWhoSignals(sample.who);
  if (grid.channel === "ToB" && who.toc && !who.tob) return true;
  if (grid.channel === "ToC" && who.tob && !who.toc) return true;
  if (grid.audience === "Elder" && !who.elder && (who.adult || who.child)) return true;
  if (grid.audience === "Adult" && !who.adult && (who.elder || who.child)) return true;
  if (grid.audience === "Child" && !who.child && (who.elder || who.adult)) return true;
  return false;
}

function evaluateSample(sample, result) {
  const issues = [];
  const itemById = new Map(result.items.map((item) => [item.id, item]));

  if (!sample.alternative && itemById.get("G3") && itemById.get("G3").score > 2) {
    issues.push(`G3 should be <= 2 when alternative is empty, got ${itemById.get("G3").score}`);
  }
  if (!sample.boundary && itemById.get("E3") && itemById.get("E3").score > 2) {
    issues.push(`E3 should be <= 2 when boundary is empty, got ${itemById.get("E3").score}`);
  }
  if (isGridMismatch(sample) && itemById.get("C2") && itemById.get("C2").score > 2) {
    issues.push(`C2 should be <= 2 for grid mismatch, got ${itemById.get("C2").score}`);
  }

  return issues;
}

function formatScoreRow(label, scores) {
  return (
    String(label).padEnd(16) +
    scores.C.toFixed(1).padStart(5) +
    scores.G.toFixed(1).padStart(5) +
    scores.E.toFixed(1).padStart(5) +
    scores.VPscore.toFixed(1).padStart(6)
  );
}

function summarizeTiers(results) {
  const grouped = { "差": [], "中": [], "好": [] };
  for (const result of results) {
    grouped[getTier(result.sample.label)].push(result.scores.VPscore);
  }

  const average = (values) => {
    if (!values.length) return null;
    return Math.round((values.reduce((sum, value) => sum + value, 0) / values.length) * 10) / 10;
  };

  const bad = average(grouped["差"]);
  const mid = average(grouped["中"]);
  const good = average(grouped["好"]);

  return {
    bad,
    mid,
    good,
    separated: Number.isFinite(bad) && Number.isFinite(mid) && Number.isFinite(good) && bad < mid && mid < good
  };
}

function compareRuns(runA, runB) {
  const diffs = [];
  for (let index = 0; index < runA.length; index += 1) {
    const a = runA[index];
    const b = runB[index];
    const aScores = JSON.stringify(a.scores);
    const bScores = JSON.stringify(b.scores);
    if (aScores !== bScores) {
      diffs.push(`${a.sample.label}: dimension scores differ (${aScores} vs ${bScores})`);
    }

    const aItemScores = JSON.stringify(a.items.map((item) => ({ id: item.id, score: item.score })));
    const bItemScores = JSON.stringify(b.items.map((item) => ({ id: item.id, score: item.score })));
    if (aItemScores !== bItemScores) {
      diffs.push(`${a.sample.label}: item scores differ (${aItemScores} vs ${bItemScores})`);
    }
  }
  return diffs;
}

function printItemReasoning(items) {
  for (const item of items) {
    console.log(`  ${item.id}: ${item.score}/5 — ${item.reasoning}`);
  }
}

async function runCotScorer(sample) {
  const messages = [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: buildUserPrompt(sample) }
  ];
  const { raw, parsed } = await callJson(messages, { temperature: 0, max_tokens: 2000 });
  const normalizedItems = normalizeItems(parsed && parsed.items);
  const validationErrors = validateItems(normalizedItems);

  if (validationErrors.length) {
    throw new Error(`Invalid scorer response for ${sample.label}: ${validationErrors.join("; ")}`);
  }

  return {
    raw,
    items: normalizedItems,
    scores: calculateScores(normalizedItems)
  };
}

function ensureOutputDir() {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

function writeReport(payload) {
  ensureOutputDir();
  const filePath = path.join(OUTPUT_DIR, `report_${formatTimestamp(new Date())}.json`);
  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), "utf8");
  return filePath;
}

async function executeRun(runIndex) {
  const results = [];
  console.log(`\n--- Run ${runIndex} ---\n`);
  console.log("Label".padEnd(16) + "C".padStart(5) + "G".padStart(5) + "E".padStart(5) + "VP".padStart(6));
  console.log("-".repeat(37));

  for (const sample of CALIBRATION) {
    const result = await runCotScorer(sample);
    const issues = evaluateSample(sample, result);

    results.push({
      sample,
      items: result.items,
      scores: result.scores,
      raw: result.raw,
      issues
    });

    console.log(formatScoreRow(sample.label, result.scores));
    if (runIndex === 1) {
      printItemReasoning(result.items);
      if (issues.length) {
        for (const issue of issues) {
          console.log(`  [check] ${issue}`);
        }
      }
      console.log("");
    }

    await sleep(250);
  }

  return results;
}

function printAcceptanceSummary(run1, run2, tierSummary1, tierSummary2, diffs) {
  const itemCountOk = run1.length === 12 && run1.every((entry) => entry.items.length === 10) && run2.length === 12 && run2.every((entry) => entry.items.length === 10);
  const reasoningOk = run1.every((entry) => entry.items.every((item) => item.reasoning));
  const dimensionPrecisionOk = run1.every((entry) =>
    [entry.scores.C, entry.scores.G, entry.scores.E, entry.scores.VPscore].every((value) => Number.isInteger(value * 10))
  );
  const ruleIssues = run1.flatMap((entry) => entry.issues.map((issue) => `${entry.sample.label}: ${issue}`));

  console.log("\n====== 分档汇总 ======");
  console.log(`Run 1: 差=${tierSummary1.bad?.toFixed(1)} 中=${tierSummary1.mid?.toFixed(1)} 好=${tierSummary1.good?.toFixed(1)} separated=${tierSummary1.separated}`);
  console.log(`Run 2: 差=${tierSummary2.bad?.toFixed(1)} 中=${tierSummary2.mid?.toFixed(1)} 好=${tierSummary2.good?.toFixed(1)} separated=${tierSummary2.separated}`);

  console.log("\n====== 验收检查 ======");
  console.log(`1. 12 条样本 + 每条 10 item: ${itemCountOk ? "PASS" : "FAIL"}`);
  console.log(`2. 维度分精确到 0.1: ${dimensionPrecisionOk ? "PASS" : "FAIL"}`);
  console.log(`3. 差档 < 中档 < 好档: ${(tierSummary1.separated && tierSummary2.separated) ? "PASS" : "FAIL"}`);
  console.log(`4. 两遍分数完全一致: ${diffs.length === 0 ? "PASS" : "FAIL"}`);
  console.log(`5. reasoning 非空: ${reasoningOk ? "PASS" : "FAIL"}`);
  console.log(`6/7. 规则约束检查: ${ruleIssues.length === 0 ? "PASS" : "FAIL"}`);

  if (diffs.length) {
    console.log("\n分数不一致明细：");
    for (const diff of diffs) {
      console.log(`- ${diff}`);
    }
  }

  if (ruleIssues.length) {
    console.log("\n规则违例明细：");
    for (const issue of ruleIssues) {
      console.log(`- ${issue}`);
    }
  }

  console.log("\n8. 逐条推理打印: PASS（Run 1 已完整输出）");

  return itemCountOk && dimensionPrecisionOk && tierSummary1.separated && tierSummary2.separated && diffs.length === 0 && reasoningOk && ruleIssues.length === 0;
}

async function main() {
  loadLocalEnvFile();

  if (!process.env.DEEPSEEK_API_KEY) {
    throw new Error("DEEPSEEK_API_KEY not set. Run `source .env` or ensure the variable is exported.");
  }

  console.log("====== VP COT Scorer Test ======");

  const run1 = await executeRun(1);
  const run2 = await executeRun(2);
  const tierSummary1 = summarizeTiers(run1);
  const tierSummary2 = summarizeTiers(run2);
  const diffs = compareRuns(run1, run2);
  const passed = printAcceptanceSummary(run1, run2, tierSummary1, tierSummary2, diffs);

  const reportFile = writeReport({
    generatedAt: new Date().toISOString(),
    model: process.env.DEEPSEEK_MODEL || "deepseek-chat",
    runs: [
      { index: 1, results: run1, tierSummary: tierSummary1 },
      { index: 2, results: run2, tierSummary: tierSummary2 }
    ],
    diffs,
    passed
  });

  console.log(`\nReport: ${reportFile}`);

  if (!passed) {
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error("test_vp_cot_scorer failed:", err.message || err);
  process.exit(1);
});
