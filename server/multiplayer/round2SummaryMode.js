const fs = require("node:fs");
const path = require("node:path");

const CAP_GROUPS = require("../../data/capability_groups_v2.json");
const TAG_MAP = require("../../data/tag_map_v2_1.json");

const ROOT = path.join(__dirname, "..", "..");
const DEFAULT_ARCHETYPES_PATH = path.join(ROOT, "game_config_v0.1", "persona_archetypes_v1.json");
const SUMMARY_FLOW_VERSION = "merged_v1";
const DIM_KEYS = ["interaction", "perception", "motion", "safety", "extend", "ops"];
const SUMMARY_TARGET_CHAR_MAX = 1200;
const SUMMARY_HARD_CHAR_MAX = 1500;
const DEFAULT_INTERVIEW_QUALITY = {
  specificity: "high",
  consistency: "high",
  actionability: "medium"
};
const DEFAULT_SYNTHETIC_HISTORY = [
  { role: "user", speaker: "学生", text: "能先讲讲你最近的生活状态和最常遇到的麻烦吗？" },
  { role: "assistant", speaker: "客户", text: "最近很多事情都得自己扛，最怕的就是关键时刻没有人帮一把。" },
  { role: "user", speaker: "学生", text: "有没有一些特别具体、发生频率比较高的场景？" },
  { role: "assistant", speaker: "客户", text: "有，而且往往都是在我最忙、最累或最分身乏术的时候发生。" },
  { role: "user", speaker: "学生", text: "如果这个问题一直不改善，会给你带来什么影响？" },
  { role: "assistant", speaker: "客户", text: "会让我更焦虑，也会让家里人担心，久了就会影响每天的节奏和心情。" }
];

let archetypesPathOverride = null;

function setArchetypesPathOverrideForTests(nextPath) {
  archetypesPathOverride = nextPath || null;
}

function getArchetypesPath() {
  return archetypesPathOverride || DEFAULT_ARCHETYPES_PATH;
}

function escapeRegex(text) {
  return String(text || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function readJsonFile(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function normalizeArchetypeSeed(seed) {
  const src = seed && typeof seed === "object" ? seed : {};
  return {
    summary_title: String(src.summary_title || "").trim(),
    person: String(src.person || "").trim(),
    routine: String(src.routine || "").trim(),
    scenes: Array.isArray(src.scenes) ? src.scenes.map((item) => String(item || "").trim()).filter(Boolean) : [],
    pain_points: Array.isArray(src.pain_points) ? src.pain_points.map((item) => String(item || "").trim()).filter(Boolean) : [],
    habits: Array.isArray(src.habits) ? src.habits.map((item) => String(item || "").trim()).filter(Boolean) : [],
    emotions: Array.isArray(src.emotions) ? src.emotions.map((item) => String(item || "").trim()).filter(Boolean) : [],
    confirmation_note: String(src.confirmation_note || "").trim()
  };
}

function loadPersonaArchetypes() {
  const raw = readJsonFile(getArchetypesPath());
  const archetypes = Array.isArray(raw?.archetypes) ? raw.archetypes : [];
  return {
    version: String(raw?.version || "v1").trim() || "v1",
    archetypes: archetypes.map((item) => ({
      ...item,
      id: String(item?.id || "").trim(),
      label: String(item?.label || item?.id || "").trim(),
      narrative_seed: normalizeArchetypeSeed(item?.narrative_seed),
      interview_quality: item?.interview_quality && typeof item.interview_quality === "object"
        ? item.interview_quality
        : { ...DEFAULT_INTERVIEW_QUALITY }
    })).filter((item) => item.id)
  };
}

function getLeakageVocabulary() {
  const tags = Object.keys(TAG_MAP.need_tag_to_dim || {});
  const capabilities = [];
  (CAP_GROUPS.groups || []).forEach((group) => {
    (group.capabilities || []).forEach((cap) => {
      const name = String(cap?.name || "").trim();
      if (name) capabilities.push(name);
    });
  });
  return Array.from(new Set([...tags, ...capabilities])).sort((a, b) => b.length - a.length);
}

function findLeakageTerms(summaryText, vocabulary = getLeakageVocabulary()) {
  const text = String(summaryText || "").trim();
  if (!text) return [];
  return vocabulary.filter((term) => {
    const escaped = escapeRegex(term);
    return new RegExp(escaped, "iu").test(text);
  });
}

function countSummaryChars(summaryText) {
  return String(summaryText || "").replace(/\s+/g, "").length;
}

function isSummaryLengthAcceptable(summaryText) {
  const charCount = countSummaryChars(summaryText);
  return charCount > 0 && charCount <= SUMMARY_HARD_CHAR_MAX;
}

function buildPersonaSummaryPrompt({ archetype, teamName, recapData, attempt = 0, retryReason = "" }) {
  const seed = normalizeArchetypeSeed(archetype?.narrative_seed);
  const scenes = seed.scenes.map((item) => `- ${item}`).join("\n") || "- 暂无";
  const painPoints = seed.pain_points.map((item) => `- ${item}`).join("\n") || "- 暂无";
  const habits = seed.habits.map((item) => `- ${item}`).join("\n") || "- 暂无";
  const emotions = seed.emotions.map((item) => `- ${item}`).join("\n") || "- 暂无";
  const gridLabel = String(recapData?.final_grid_id || "").trim() || "未命名格子";
  const vpSummary = String(recapData?.vp_summary?.who || recapData?.vp_summary || "").trim() || "围绕真实生活场景做取舍";
  const retryLines = [];

  if (attempt > 0) {
    retryLines.push("上一次输出未通过校验，请严格重写，不要沿用上一次的表述。");
  }
  if (retryReason === "length") {
    retryLines.push(`这一次请把正文尽量控制在 ${SUMMARY_TARGET_CHAR_MAX} 个中文字符以内，绝对不要超过 ${SUMMARY_HARD_CHAR_MAX} 个中文字符。`);
  } else if (retryReason === "leakage") {
    retryLines.push("这一次继续严格避免任何能力名、功能名、解决方案、卡片名、标签词、产品词、品牌词。");
  }

  return [
    "你是 EMBA 教学模拟中的客户研究报告撰写者。",
    `请用中文写一份客户调研报告，正文目标控制在 ${SUMMARY_TARGET_CHAR_MAX} 个中文字符以内，硬性上限是 ${SUMMARY_HARD_CHAR_MAX} 个中文字符（可自然分段，但不要标题、不要分点、不要 markdown）。`,
    "报告必须只写人物情境、生活节奏、痛点、情绪、行为习惯与具体场景。",
    "绝对禁止出现任何能力名、功能名、解决方案、卡片名、标签词、产品词、品牌词。",
    "例如可以写“半夜起身时总担心自己站不稳”，但不能写任何功能或能力建议。",
    retryLines.join("\n"),
    "",
    `团队：${String(teamName || "当前团队").trim() || "当前团队"}`,
    `Round 1 上下文：${gridLabel}`,
    `价值主张线索：${vpSummary}`,
    `原型：${String(archetype?.label || archetype?.id || "").trim()}`,
    `人物设定：${seed.person || "待补充"}`,
    `生活节奏：${seed.routine || "待补充"}`,
    "关键场景：",
    scenes,
    "主要痛点：",
    painPoints,
    "行为习惯：",
    habits,
    "情绪张力：",
    emotions,
    `备注：${seed.confirmation_note || "待确认"}`
  ].join("\n");
}

function buildFallbackPersonaSummary({ archetype, recapData }) {
  const seed = normalizeArchetypeSeed(archetype?.narrative_seed);
  const sceneSentence = seed.scenes.length
    ? `最常出现的场景包括${seed.scenes.join("、")}。`
    : "目前最典型的使用场景仍待课堂确认。";
  const painSentence = seed.pain_points.length
    ? `这些场景里反复冒出来的困扰是${seed.pain_points.join("、")}。`
    : "目前最关键的痛点仍待课堂确认。";
  const habitsSentence = seed.habits.length
    ? `他/她已经形成的应对习惯包括${seed.habits.join("、")}，所以任何新东西都必须贴着这些习惯进入。`
    : "他/她的日常习惯仍待课堂确认。";
  const emotionSentence = seed.emotions.length
    ? `这些事情背后的情绪往往是${seed.emotions.join("、")}，并不总会直接说出口。`
    : "背后的情绪张力仍待课堂确认。";
  const recapSentence = String(recapData?.final_grid_id || "").trim()
    ? `放在当前团队的 Round 1 背景里，这份材料更像是一段真实生活的切片，而不是一个已经说清需求的产品 brief。`
    : "这份材料更像是一段真实生活的切片，而不是一个已经说清需求的产品 brief。";

  return [
    `${seed.summary_title || archetype?.label || archetype?.id || "客户调研报告"}`,
    `${seed.person || "人物背景待确认"}。${seed.routine || "日常节奏待确认"}。`,
    sceneSentence,
    painSentence,
    habitsSentence,
    emotionSentence,
    recapSentence,
    "这名客户并不会主动把自己的困难整理成产品语言，更可能是在聊天时零散提到那些最费神、最怕出问题、最不想麻烦别人的时刻。"
  ].join("");
}

function normalizeEvidenceBlock(block) {
  const src = block && typeof block === "object" ? block : {};
  return {
    mentioned: Boolean(src.mentioned),
    strength: String(src.strength || "").trim().toLowerCase() || "weak",
    evidence: Array.isArray(src.evidence) ? src.evidence.map((item) => ({
      quote: String(item?.quote || "").trim(),
      reason: String(item?.reason || "").trim()
    })) : [],
    needs: Array.isArray(src.needs) ? src.needs.map((item) => String(item || "").trim()).filter(Boolean) : [],
    scenarios: Array.isArray(src.scenarios) ? src.scenarios.map((item) => String(item || "").trim()).filter(Boolean) : [],
    pain_points: Array.isArray(src.pain_points) ? src.pain_points.map((item) => String(item || "").trim()).filter(Boolean) : []
  };
}

function normalizeArchetypeForScoring(archetype) {
  const dimensionEvidence = {};
  DIM_KEYS.forEach((dim) => {
    dimensionEvidence[dim] = normalizeEvidenceBlock(archetype?.dimension_evidence?.[dim]);
  });
  const focusedDimensions = DIM_KEYS.filter((dim) => dimensionEvidence[dim].mentioned);
  const otherDimensions = {};
  DIM_KEYS.forEach((dim) => {
    if (!dimensionEvidence[dim].mentioned) {
      otherDimensions[dim] = {
        mentioned: false,
        brief: ""
      };
    }
  });
  return {
    focused_dimensions: focusedDimensions,
    dimension_evidence: Object.fromEntries(
      focusedDimensions.map((dim) => [dim, dimensionEvidence[dim]])
    ),
    other_dimensions: otherDimensions,
    tags: Array.isArray(archetype?.tags)
      ? archetype.tags.filter((tag) => {
          const text = String(tag || "").trim();
          return text && !/^TODO\(WY\)/i.test(text);
        })
      : [],
    interview_quality: archetype?.interview_quality && typeof archetype.interview_quality === "object"
      ? archetype.interview_quality
      : { ...DEFAULT_INTERVIEW_QUALITY },
    missing_dimensions: DIM_KEYS.filter((dim) => !dimensionEvidence[dim].mentioned)
  };
}

function parseConfiguredEvi(archetype) {
  const value = archetype?.evi;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function buildSyntheticHistory(archetype) {
  const seed = normalizeArchetypeSeed(archetype?.narrative_seed);
  const prompt = seed.scenes[0] || seed.pain_points[0] || "能讲讲最近最让你费神的一件事吗？";
  const reply = seed.person || seed.routine || "最近的确有些事一直压在心里。";
  const history = DEFAULT_SYNTHETIC_HISTORY.slice();
  history[0] = { ...history[0], text: `能先讲讲 ${prompt} 吗？` };
  history[1] = { ...history[1], text: reply };
  return history;
}

function buildSummaryModeRadarResult({ archetype, gridId, architecture, mapEvidenceToResult }) {
  const extracted = normalizeArchetypeForScoring(archetype);
  const result = mapEvidenceToResult({
    gridId,
    architecture,
    memberDims: DIM_KEYS,
    extracted,
    history: buildSyntheticHistory(archetype),
    conversation: JSON.stringify(extracted.dimension_evidence)
  });
  const configuredEvi = parseConfiguredEvi(archetype);
  if (configuredEvi != null) {
    result.evi = configuredEvi;
    if (result.eviMeta) {
      result.eviMeta.raw_evi = configuredEvi;
      result.eviMeta.final_evi = configuredEvi;
    }
  }
  if (Array.isArray(extracted.tags) && extracted.tags.length) {
    result.tags = extracted.tags.map((tag) => ({
      tag,
      polarity: 1,
      source: "persona_archetype"
    }));
    if (result.eviMeta) {
      result.eviMeta.tag_count = result.tags.length;
    }
  }
  return result;
}

async function generatePersonaReports({
  archetypes,
  existingReports = [],
  teamName,
  recapData,
  renderSummary,
  onFallback,
  now = () => new Date().toISOString(),
  flowVersion = SUMMARY_FLOW_VERSION
}) {
  const existingMap = new Map(
    (Array.isArray(existingReports) ? existingReports : []).map((item) => [String(item?.archetype_id || item?.archetypeId || "").trim(), item])
  );
  const rows = [];

  for (const archetype of Array.isArray(archetypes) ? archetypes : []) {
    const archetypeId = String(archetype?.id || "").trim();
    if (!archetypeId) continue;
    if (existingMap.has(archetypeId)) {
      rows.push(existingMap.get(archetypeId));
      continue;
    }

    let summaryText = "";
    let generatedVia = "llm";
    let leakageMatches = [];
    let hadRenderError = false;
    let lastErrorMessage = "";
    let retryReason = "";
    let lastCharCount = 0;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        summaryText = String(await renderSummary({
          archetype,
          prompt: buildPersonaSummaryPrompt({ archetype, teamName, recapData, attempt, retryReason }),
          attempt
        }) || "").trim();
      } catch (error) {
        hadRenderError = true;
        lastErrorMessage = String(error?.message || "").trim();
        summaryText = "";
        retryReason = "call_failed";
      }
      if (!summaryText) continue;
      leakageMatches = findLeakageTerms(summaryText);
      if (leakageMatches.length) {
        retryReason = "leakage";
        summaryText = "";
        continue;
      }
      lastCharCount = countSummaryChars(summaryText);
      if (lastCharCount > SUMMARY_HARD_CHAR_MAX) {
        retryReason = "length";
        summaryText = "";
        continue;
      }
      retryReason = "";
      break;
    }

    if (!summaryText) {
      summaryText = buildFallbackPersonaSummary({ archetype, recapData });
      generatedVia = "template";
      if (typeof onFallback === "function") {
        onFallback({
          archetypeId,
          hadRenderError,
          lastErrorMessage,
          leakageMatches,
          lastCharCount,
          retryReason
        });
      }
      leakageMatches = [];
    }

    rows.push({
      archetype_id: archetypeId,
      summary_text: summaryText,
      flow_version: flowVersion,
      generated_at: now(),
      generated_via: generatedVia,
      leakage_matches: leakageMatches
    });
  }

  return rows;
}

module.exports = {
  DIM_KEYS,
  SUMMARY_FLOW_VERSION,
  DEFAULT_INTERVIEW_QUALITY,
  setArchetypesPathOverrideForTests,
  loadPersonaArchetypes,
  getLeakageVocabulary,
  findLeakageTerms,
  countSummaryChars,
  isSummaryLengthAcceptable,
  buildPersonaSummaryPrompt,
  buildFallbackPersonaSummary,
  normalizeArchetypeForScoring,
  buildSyntheticHistory,
  buildSummaryModeRadarResult,
  generatePersonaReports
};
