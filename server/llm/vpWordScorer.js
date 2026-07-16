"use strict";

const fs = require("fs");
const path = require("path");
const nodejieba = require("nodejieba");

const { extractVpFields, scoreBoundary } = require("./vpEmbeddingScorer");
const { chatCompletion } = require("./deepseekClient");
const { withLlmLogging } = require("./llm_logger");
const embeddingService = require("./embeddingService");

const LLM_TIMEOUT_MS = 60000;

const CACHE_PATH = path.join(__dirname, "..", "..", "game_config_v0.1", "vp_word_cache.json");

const VP_SCORE_EXPONENTS = {
  C: 2.0,
  G: 1.5,
  E: 1.5
};

const STOP_WORDS = new Set([
  "提供", "通过", "从而", "能够", "可以", "进行", "实现",
  "一个", "一台", "一种", "这个", "那个", "什么", "怎么",
  "因为", "所以", "但是", "而且", "以及", "或者", "如果",
  "就是", "已经", "这样", "那样", "比较", "非常", "特别",
  "主要", "目前", "当前", "其中", "之间", "方面", "情况",
  "不是", "没有", "不能", "而是", "这些", "那些", "自己",
  "他们", "我们", "你们", "它们", "需要", "使得", "为了",
  "同时", "并且", "还有", "不仅", "而且", "虽然", "然而"
]);

const EMPTY_PLACEHOLDERS = new Set([
  "",
  "未明确",
  "待补充",
  "(待补充)",
  "（待补充）",
  "无",
  "暂无",
  "N/A",
  "n/a",
  "未填写"
]);

const GRID_TO_PROFILE = {
  "ToB_Differentiation_Elder": { market: "ToB_Elder", strategy: "Differentiation" },
  "ToB_Cost_Elder": { market: "ToB_Elder", strategy: "Cost" },
  "ToB_Differentiation_Adult": { market: "ToB_Adult", strategy: "Differentiation" },
  "ToB_Cost_Adult": { market: "ToB_Adult", strategy: "Cost" },
  "ToB_Differentiation_Child": { market: "ToB_Child", strategy: "Differentiation" },
  "ToB_Cost_Child": { market: "ToB_Child", strategy: "Cost" },
  "ToC_Differentiation_Elder": { market: "ToC_Elder", strategy: "Differentiation" },
  "ToC_Cost_Elder": { market: "ToC_Elder", strategy: "Cost" },
  "ToC_Differentiation_Adult": { market: "ToC_Adult", strategy: "Differentiation" },
  "ToC_Cost_Adult": { market: "ToC_Adult", strategy: "Cost" },
  "ToC_Differentiation_Child": { market: "ToC_Child", strategy: "Differentiation" },
  "ToC_Cost_Child": { market: "ToC_Child", strategy: "Cost" }
};

let cache = null;

function compactParagraph(text) {
  return String(text || "")
    .replace(/\r/g, "")
    .replace(/\s*\n+\s*/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function isMeaningfulFieldValue(value) {
  const text = String(value || "").trim();
  return !EMPTY_PLACEHOLDERS.has(text);
}

function countChars(text) {
  return Array.from(String(text || "")).length;
}

function isAcceptableFeedback(text) {
  const content = String(text || "").replace(/\s+/g, " ").trim();
  const len = countChars(content);
  if (len < 180 || len > 350) return false;
  if (/客户覆盖面|人群覆盖面|痛点典型性|解法说服力|综合评分|C\s*[：:()]|G\s*[：:()]|E\s*[：:()]/i.test(content)) return false;
  if (/\d(\.\d)?\s*\/\s*5/.test(content)) return false;
  return true;
}

function sliceChars(text, limit) {
  return Array.from(String(text || "")).slice(0, limit).join("");
}

function quoteSnippet(text, fallback = "这部分内容") {
  const content = compactParagraph(text);
  if (!content || content === "未提及") return fallback;
  return `“${sliceChars(content, 20)}${countChars(content) > 20 ? "..." : ""}”`;
}

function sanitizeGeneratedFeedback(text) {
  return compactParagraph(text)
    .replace(/客户覆盖面/g, "客户界定")
    .replace(/人群覆盖面/g, "目标客户界定")
    .replace(/痛点典型性/g, "痛点把握")
    .replace(/解法说服力/g, "解法说明")
    .replace(/综合评分/g, "整体完成度")
    .replace(/\d(?:\.\d+)?\s*\/\s*5/g, "")
    .replace(/\b[CGE]\b\s*[：:()]?/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function fitFeedbackLength(text, min = 180, max = 350) {
  const raw = String(text || "").replace(/\r/g, "").trim();
  const normalized = raw.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n");
  const plain = normalized.replace(/\s+/g, " ").trim();
  if (!plain) return plain;
  if (countChars(plain) <= max && countChars(plain) >= min) return normalized;

  const sentences = plain.match(/[^。！？]*[。！？]?/g) || [];
  const parts = sentences.map((sentence) => sentence.trim()).filter(Boolean);
  const lastPart = parts[parts.length - 1] || "";
  if (parts.length >= 2 && lastPart) {
    let withEnding = "";
    for (let i = 0; i < parts.length - 1; i += 1) {
      const part = parts[i];
      const candidate = withEnding + part;
      const needsEnding = !candidate.includes(lastPart);
      const combined = needsEnding ? candidate + lastPart : candidate;
      if (countChars(combined) > max) break;
      withEnding = candidate;
    }
    const finalWithEnding = withEnding.includes(lastPart) ? withEnding : withEnding + lastPart;
    if (countChars(finalWithEnding) >= min && countChars(finalWithEnding) <= max) {
      return finalWithEnding;
    }
  }

  let fitted = "";
  for (const sentence of sentences) {
    const part = sentence.trim();
    if (!part) continue;
    if (countChars(fitted + part) > max) break;
    fitted += part;
  }

  if (countChars(fitted) >= min) {
    return fitted;
  }

  const clipped = sliceChars(plain, max);
  return /[。！？]$/.test(clipped) ? clipped : `${clipped}。`;
}

function buildFallbackVpFeedback({ vpText, confirmedFields, scores }) {
  const fields = confirmedFields && typeof confirmedFields === "object" ? confirmedFields : {};
  const scoreSet = scores && typeof scores === "object" ? scores : {};
  const who = fields.who_raw || "";
  const pain = fields.pain_raw || "";
  const how = fields.how_raw || "";
  const alt = fields.alternative_raw || "";
  const boundary = fields.boundary_raw || "";
  const gridLabel = fields._gridLabel || "";
  const customerNeedsNarrower = Number(scoreSet.C || 0) > 0 && Number(scoreSet.C || 0) < 3.5;
  const solutionNeedsDetail = Number(scoreSet.Eadj ?? scoreSet.E ?? 0) > 0 && Number(scoreSet.Eadj ?? scoreSet.E ?? 0) < 4;
  const strengths = [];
  const weaknesses = [];

  if (pain && how) {
    strengths.push(`痛点和解法之间的对应关系是成立的，${quoteSnippet(pain, quoteSnippet(vpText))}与${quoteSnippet(how, "当前解法")}之间有明确因果链。`);
  }
  if (alt) {
    strengths.push("替代方案对比已经写出，现有做法的短板交代得比较清楚。");
  }
  if (boundary) {
    strengths.push("边界条件也已交代，方案适用范围不是无限外推。");
  }
  if (customerNeedsNarrower) {
    const isToB = /ToB/i.test(gridLabel);
    if (isToB) {
      weaknesses.push(`客户描述偏宽，${quoteSnippet(who, "目标客户")}还不足以说明具体机构类型、规模或采购决策者，可信度会被压低。`);
    } else {
      weaknesses.push(`客户描述偏宽，${quoteSnippet(who, "目标客户")}还不足以说明年龄段、生活形态或使用场景，可信度会被压低。`);
    }
  }
  if (solutionNeedsDetail) {
    weaknesses.push("解法描述还不够扎实，关键动作没有落到可理解的执行层，因果链会显得偏虚。好的写法需要把动作词、触发场景和结果变化说完整。");
  }
  if (!alt) {
    weaknesses.push("替代方案对比缺失，现有流程为什么不够好没有被明确写出来。");
  }
  if (!boundary) {
    weaknesses.push("边界条件缺失，什么情况下不适用没有交代。");
  }
  if (!strengths.length) {
    strengths.push("这版 VP 的基本结构已经成形，目标客户、痛点和解法三部分都出现了。");
  }
  if (!weaknesses.length) {
    weaknesses.push("主要问题不在结构缺口，而在客户定义和场景力度仍有进一步压实空间。");
  }

  const mismatchLine = gridLabel ? `你们当前锁定的是${gridLabel}，最终评语按这个格子对应的客户画像来判断。` : "";
  const direction = customerNeedsNarrower
    ? "最关键的改进方向，是把客户再收窄一层，写出谁在什么场景下做决定。"
    : "最关键的改进方向，是把解法写成动作和因果链，而不是停留在结果承诺。";
  return fitFeedbackLength(`${mismatchLine}\n\n${strengths.join("")}\n\n${weaknesses.join("")}${direction}`);
}

async function generateVpFeedback({ vpText, confirmedFields, scores, details = null, gridLabel, archLabel, teamId = null, memberId = null, timeoutMs = null }) {
  const fields = confirmedFields && typeof confirmedFields === "object" ? confirmedFields : {};
  const scoreSet = scores && typeof scores === "object" ? scores : {};
  function buildDiagnosisSummary(detailSet) {
    if (!detailSet) return "";
    const lines = [];

    const cMatch = detailSet.C_match || {};
    const whoCov = detailSet.who_coverage ?? -1;
    if (whoCov >= 0) lines.push(`客户词与目标市场锚词的语义覆盖度: ${Math.round(whoCov * 100)}%`);
    if (cMatch.qualifiedCount !== undefined) lines.push(`客户描述中命中目标市场的关键词数: ${cMatch.qualifiedCount}`);
    if (Array.isArray(cMatch.matchDetails)) {
      const matched = cMatch.matchDetails
        .filter((d) => Number(d?.sim || 0) >= 0.55)
        .map((d) => `"${d.vpWord}"→"${d.anchorWord}"(${Math.round(Number(d.sim || 0) * 100)}%)`);
      const unmatched = cMatch.matchDetails
        .filter((d) => Number(d?.sim || 0) < 0.55)
        .map((d) => `"${d.vpWord}"`);
      if (matched.length) lines.push(`命中的客户词: ${matched.join("、")}`);
      if (unmatched.length) lines.push(`未命中的客户词: ${unmatched.join("、")}`);
    }

    const gMatch = detailSet.G_match || {};
    if (gMatch.qualifiedCount !== undefined) lines.push(`痛点词命中目标市场锚词数: ${gMatch.qualifiedCount}`);

    const eMatch = detailSet.E_match || {};
    if (eMatch.qualifiedCount !== undefined) lines.push(`解法词回应痛点词的命中数: ${eMatch.qualifiedCount}`);
    if (detailSet.alt_bonus !== undefined) lines.push(`替代方案加分: ${detailSet.alt_bonus > 0 ? `有（+${detailSet.alt_bonus}）` : "无（未提及替代方案）"}`);
    if (detailSet.bnd_bonus !== undefined) lines.push(`边界条件加分: ${detailSet.bnd_bonus > 0 ? `有（+${detailSet.bnd_bonus}）` : "无（未提及边界条件）"}`);

    return lines.length ? `\n评分引擎诊断（请基于这些证据写评语，不要自行编造证据）：\n${lines.join("\n")}` : "";
  }

  const diagnosisSummary = buildDiagnosisSummary(details);
  const prompt = `你是 EMBA 商业模拟的评分系统。学生已提交锁定了最终版价值主张，你需要写一段评语。

学生选择的市场：${gridLabel}
学生选择的架构：${archLabel}

学生确认的切片：
- 目标客户：${fields.who_raw}
- 痛点：${fields.pain_raw}
- 解决方式：${fields.how_raw}
- 替代方案对比：${fields.alternative_raw || "未提及"}
- 边界条件：${fields.boundary_raw || "未提及"}

评分结果（不要在评语中提及这些维度名称和数值）：
- 客户覆盖面：${scoreSet.C}/5
- 痛点典型性：${scoreSet.G}/5
- 解法说服力：${scoreSet.E}/5
- 综合评分：${scoreSet.VPscore}/5
${diagnosisSummary}

写评语的规则：

1. 全程用"你们"称呼学生
2. 语气像资深商业顾问在董事会复盘——专业、直接、陈述事实
3. 不要表扬、不要鼓励、不要说"做得好""写得不错"
4. 优点用陈述句，1-2 句带过
5. 低分项（低于 3.5 分的维度）必须展开讲：指出具体缺了什么、为什么这样写不行、好的写法长什么样
6. 如果有评分引擎诊断数据，用它来支撑你的判断，不要自行编造匹配细节
7. 最后一句给出最关键的改进方向（即使VP已锁定，也有教学价值），不要用"下一步"这种指示口吻
8. 不要提C/G/E维度名称或数值
9. 不要用列表，写成连贯的段落，可以分段
10. 200-300字

结构：
- 第一句点明格子
- 高分项（≥3.5）用 1-2 句陈述带过
- 低分项（<3.5）展开讲：缺什么、为什么不行、好的写法长什么样
- 最后一句给改进方向

示例1（ToB 场景，C 低分，仅供参考风格）：

你们当前锁定的是ToB·差异化·老人市场，最终评语按这个格子对应的客户画像来判断。

痛点抓到了真问题。"夜间跌倒发现延迟导致事故责任和家属投诉"是养老机构运营中高频、高后果的结构性痛点。解法跟痛点之间有清晰的因果链，替代方案对比也写出了现有做法的短板。

失分集中在客户描述。"养老机构"四个字太泛，什么规模、公立还是民营、谁拍板采购都没有落下来。系统没有从你们的客户描述中识别出足够明确的机构类型或采购角色，所以客户界定会显得发虚。写得越具体，VP 的可信度越高。如果把客户收窄到"100-300床位的民营护理型养老院的运营院长"，判断基础会明显不同。最关键的改进方向，是把客户定义压到可识别的组织类型和决策角色。

示例2（ToC 场景，E 低分，仅供参考风格）：

你们当前锁定的是ToC·差异化·成人市场，最终评语按这个格子对应的客户画像来判断。

客户锁得清晰。"25-35岁独居租房的年轻白领"直接指向了一个可识别、可触达的人群。痛点也成立，想养宠物但嫌喂养清洁太麻烦，这是城市独居群体里反复出现的结构性矛盾。

失分集中在解法。你们写的是"提供无负担陪伴、满足即时情感需求"，但这是一个承诺，不是一个机制。机器人通过什么具体交互方式产生陪伴感，是主动迎接、跟随移动，还是情绪识别后回应，都没有写出来。"无负担"相对宠物到底省掉了哪些动作，也没有落成可理解的因果句。最关键的改进方向，是把解法从结果承诺改成动作机制和场景因果。`;

  const messages = [{ role: "user", content: prompt }];

  try {
    const raw = await withLlmLogging({
      caller: "vpWordScorer.generateVpFeedback",
      teamId,
      memberId,
      messages
    }, () => chatCompletion(messages, {
      temperature: 0.3,
      max_tokens: 500,
      timeoutMs: Number.isFinite(Number(timeoutMs)) ? Number(timeoutMs) : LLM_TIMEOUT_MS
    }));
    const cleaned = String(raw || "")
      .replace(/\r/g, "")
      .replace(/^[\-\d\.\s]+/, "")
      .split(/\n{2,}/)
      .map((part) => sanitizeGeneratedFeedback(part))
      .filter(Boolean)
      .join("\n\n")
      .trim();
    const fitted = fitFeedbackLength(cleaned);
    if (isAcceptableFeedback(fitted)) return fitted;
    return buildFallbackVpFeedback({
      vpText,
      confirmedFields: { ...fields, _gridLabel: gridLabel },
      scores
    });
  } catch (err) {
    console.warn("[vpWordScorer.generateVpFeedback] LLM call failed; using fallback feedback:", err?.message || err);
    return buildFallbackVpFeedback({
      vpText,
      confirmedFields: { ...fields, _gridLabel: gridLabel },
      scores
    });
  }
}

function cosine(a, b) {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

function tokenize(text) {
  if (!text || text === "未明确") return [];
  return nodejieba.cut(String(text))
    .map((word) => word.trim())
    .filter((word) => word.length >= 2)
    .filter((word) => !STOP_WORDS.has(word))
    .filter((word) => !/^[\d\s，。、；：！？""''（）【】\-——…·]+$/.test(word));
}

function normalizeGridId(gridId) {
  const text = String(gridId || "").trim();
  if (GRID_TO_PROFILE[text]) return text;
  if (text.includes("·")) {
    const channel = /ToB/i.test(text) ? "ToB" : "ToC";
    const strategy = /差异/.test(text) ? "Differentiation" : "Cost";
    const age = /老人/.test(text) ? "Elder" : (/儿童/.test(text) ? "Child" : "Adult");
    return `${channel}_${strategy}_${age}`;
  }
  const normalized = text
    .replace(/CostLeadership/g, "Cost")
    .replace(/_Diff_/i, "_Differentiation_")
    .replace(/_Diff$/i, "_Differentiation")
    .replace(/^To([BC])_Diff_/i, "To$1_Differentiation_");
  return GRID_TO_PROFILE[normalized] ? normalized : text;
}

function normalizeArchitectureKey(architecture) {
  const text = String(architecture || "").trim();
  if (text === "Experience" || text === "体验" || text === "体验型") return "Experience";
  if (text === "Hybrid" || text === "混合" || text === "混合型") return "Hybrid";
  if (text === "Function" || text === "功能" || text === "功能型") return "Function";
  return text || "Hybrid";
}

function loadCache() {
  if (cache) return cache;
  cache = JSON.parse(fs.readFileSync(CACHE_PATH, "utf8"));
  return cache;
}

async function prepareWordVectors(text) {
  const words = tokenize(text);
  const vecs = [];
  await embeddingService.init();
  for (const word of words) {
    vecs.push(await embeddingService.embed(word));
  }
  return { words, vecs };
}

async function sentenceSim(text, anchorKey) {
  const currentCache = loadCache();
  const anchorVec = currentCache.sentenceVecs ? currentCache.sentenceVecs[anchorKey] : null;
  if (!text || text === "未明确" || !anchorVec) {
    return 0;
  }
  await embeddingService.init();
  const textVec = await embeddingService.embed(String(text));
  return cosine(textVec, anchorVec);
}

function scoreWithExp(simSum, exp) {
  const raw = exp * Math.log(simSum + 1) + 1;
  return Math.max(1.0, Math.min(5.0, Math.round(raw * 10) / 10));
}

async function wordMatchScore(vpFieldTextOrPrepared, anchorWordData, excludeIndices = new Set(), minSim = 0.55) {
  const prepared = typeof vpFieldTextOrPrepared === "string"
    ? await prepareWordVectors(vpFieldTextOrPrepared)
    : (vpFieldTextOrPrepared || { words: [], vecs: [] });
  const vpWords = prepared.words || [];
  const vpVecs = prepared.vecs || [];
  const anchorWords = anchorWordData && anchorWordData.words ? anchorWordData.words : [];
  const anchorVecs = anchorWordData && anchorWordData.vecs ? anchorWordData.vecs : [];
  const anchorWordCount = anchorWords.length;

  if (vpWords.length === 0 || anchorWordCount === 0) {
    return {
      score: 0,
      rawScore: 0,
      vpWords,
      matchDetails: [],
      simSum: 0,
      anchorWordCount,
      qualifiedCount: 0,
      totalVpWords: vpWords.length,
      matchedAnchorIndices: new Set()
    };
  }

  let simSum = 0;
  let qualifiedCount = 0;
  const matchDetails = [];
  const matchedAnchorIndices = new Set();

  for (let index = 0; index < vpWords.length; index += 1) {
    const vpWord = vpWords[index];
    const vpVec = vpVecs[index];

    let bestSim = -1;
    let bestAnchorWord = "";
    let bestAnchorIdx = -1;
    for (let j = 0; j < anchorVecs.length; j += 1) {
      if (excludeIndices.has(j)) continue;
      const sim = cosine(vpVec, anchorVecs[j]);
      if (sim > bestSim) {
        bestSim = sim;
        bestAnchorWord = anchorWords[j];
        bestAnchorIdx = j;
      }
    }

    const qualified = bestSim >= minSim;
    if (qualified) {
      simSum += bestSim;
      qualifiedCount += 1;
      if (bestAnchorIdx >= 0) matchedAnchorIndices.add(bestAnchorIdx);
    }

    matchDetails.push({
      vpWord,
      bestAnchorWord,
      bestSim: Math.round(bestSim * 100) / 100,
      qualified,
      bestAnchorIdx
    });
  }

  const hitRate = vpWords.length > 0 ? qualifiedCount / vpWords.length : 0;
  const rawScore = hitRate * 4 + 1;
  const score = Math.max(1.0, Math.min(5.0, Math.round(rawScore * 10) / 10));

  return {
    score,
    rawScore,
    vpWords,
    matchDetails,
    simSum: Math.round(simSum * 100) / 100,
    anchorWordCount,
    qualifiedCount,
    totalVpWords: vpWords.length,
    matchedAnchorIndices
  };
}

async function prepareVpForWordScoring(vpText) {
  const fields = await extractVpFields(vpText);
  return prepareConfirmedFieldsForWordScoring(fields, vpText);
}

async function prepareConfirmedFieldsForWordScoring(fields, vpText = "") {
  const whoPrepared = await prepareWordVectors(fields.who_raw);
  const painPrepared = await prepareWordVectors(fields.pain_raw);
  const howPrepared = await prepareWordVectors(fields.how_raw);
  const altPrepared = await prepareWordVectors(fields.alternative_raw);
  return {
    vpText,
    fields,
    whoPrepared,
    painPrepared,
    howPrepared,
    altPrepared
  };
}

function scorePreparedVpByWord(prepared, gridId, architecture, options = {}) {
  const minSim = Number.isFinite(options.minSim) ? options.minSim : 0.55;
  const currentCache = loadCache();
  const normalizedGridId = normalizeGridId(gridId);
  const profile = GRID_TO_PROFILE[normalizedGridId];
  if (!profile) {
    throw new Error(`Unknown grid id: ${gridId}`);
  }
  const marketKey = profile.market;
  const strategyKey = profile.strategy;
  const archKey = normalizeArchitectureKey(architecture);
  const anchorData = currentCache.wordData[`market.${marketKey}.customer_group`];

  return Promise.resolve().then(async () => {
    const whoCoverage = await sentenceSim(prepared.fields.who_raw, `market.${marketKey}.customer_group`);
    const CMatch = await wordMatchScore(prepared.whoPrepared, anchorData, new Set(), minSim);
    const CHitCount = CMatch.qualifiedCount;
    let C;
    if (whoCoverage < 0.2) {
      C = 1.0;
    } else {
      C = Math.min(5.0, Math.round((Math.log(Math.pow(CMatch.simSum + 1, VP_SCORE_EXPONENTS.C)) + 1) * 10) / 10);
    }

    const GMatch = await wordMatchScore(prepared.painPrepared, anchorData, CMatch.matchedAnchorIndices, minSim);
    const GSimSum = GMatch.simSum;
    const G = Math.min(5.0, Math.round((Math.log(Math.pow(GSimSum + 1, VP_SCORE_EXPONENTS.G)) + 1) * 10) / 10);

    const painWordData = {
      words: prepared.painPrepared.words,
      vecs: prepared.painPrepared.vecs
    };
    const EMatch = await wordMatchScore(prepared.howPrepared, painWordData, new Set(), minSim);
    const ESimSum = EMatch.simSum;
    let altBonus = 0;
    if (isMeaningfulFieldValue(prepared.fields.alternative_raw)) {
      const altWords = tokenize(prepared.fields.alternative_raw);
      if (altWords.length > 0) altBonus = 0.3;
    }
    let bndBonus = 0;
    if (isMeaningfulFieldValue(prepared.fields.boundary_raw)) {
      const bndWords = tokenize(prepared.fields.boundary_raw);
      if (bndWords.length > 0) bndBonus = 0.2;
    }
    const ERaw = Math.log(Math.pow(ESimSum + 1, VP_SCORE_EXPONENTS.E)) + 1 + altBonus + bndBonus;
    const E = Math.min(5.0, Math.round(ERaw * 10) / 10);
    const avgGE = (G + E) / 2;
    const VPscore = Math.min(5.0, Math.round(Math.sqrt(C * avgGE) * 10) / 10);

    return {
      scores: { C, G, E, VPscore },
      fields: prepared.fields,
      details: {
        marketKey,
        strategyKey,
        archKey,
        minSim,
        who_coverage: Math.round(whoCoverage * 100) / 100,
        who_hitCount: CHitCount,
        C_match: {
          simSum: CMatch.simSum,
          qualifiedCount: CMatch.qualifiedCount,
          matchDetails: CMatch.matchDetails,
          matchedAnchorIndices: CMatch.matchedAnchorIndices
        },
        g_match: GMatch,
        e_match: EMatch,
        G_match: {
          simSum: GSimSum,
          qualifiedCount: GMatch.qualifiedCount,
          excludedCount: CMatch.matchedAnchorIndices.size,
          matchDetails: GMatch.matchDetails
        },
        E_match: {
          simSum: ESimSum,
          qualifiedCount: EMatch.qualifiedCount,
          matchDetails: EMatch.matchDetails
        },
        alt_bonus: altBonus,
        bnd_bonus: bndBonus,
        C_raw: C,
        G_raw: GSimSum,
        E_raw: ESimSum,
        VPscore
      }
    };
  });
}

async function scoreVpByWord(confirmedFields, gridId, architecture, options = {}) {
  await embeddingService.init();
  const prepared = (confirmedFields && typeof confirmedFields === "object" && confirmedFields.who_raw)
    ? await prepareConfirmedFieldsForWordScoring(confirmedFields, "")
    : await prepareVpForWordScoring(confirmedFields);
  return scorePreparedVpByWord(prepared, gridId, architecture, options);
}

module.exports = {
  scoreVpByWord,
  generateVpFeedback,
  sanitizeGeneratedFeedback,
  buildFallbackVpFeedback,
  tokenize,
  wordMatchScore,
  extractVpFields,
  scoreBoundary,
  loadCache,
  prepareVpForWordScoring,
  prepareConfirmedFieldsForWordScoring,
  scorePreparedVpByWord,
  sentenceSim,
  scoreWithExp
};
