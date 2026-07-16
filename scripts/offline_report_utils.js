"use strict";

const fs = require("node:fs");
const path = require("node:path");

process.loadEnvFile(path.join(__dirname, "..", ".env"));

const { chatCompletion } = require("../server/llm/deepseekClient");
const priors = require("../data/grid_priors_v4_cap_weights.json");
const tagMap = require("../data/tag_map_v2_1.json");
const capabilityGroups = require("../data/capability_groups_v2.json");
const guide = require(path.join(
  process.env.INTERVIEW_GUIDE_PATH ||
  "/Users/weiyang/Dropbox/My Mac (Weis-MacBook-Air.local)/Downloads/interview_guide_v1.json"
));
const sampleReport = fs.readFileSync(
  process.env.INTERVIEW_REPORT_SAMPLE_PATH ||
  "/Users/weiyang/Dropbox/My Mac (Weis-MacBook-Air.local)/Downloads/sample_ToC_Diff_Elder_P1.md",
  "utf8"
);

const ROOT = path.join(__dirname, "..");
const OUTPUT_BRIEFS = path.join(ROOT, "game_config_v0.1", "persona_briefs_v1.json");
const OUTPUT_REPORTS = path.join(ROOT, "game_config_v0.1", "persona_reports_v1.2.json");
const OUTPUT_EVIDENCE = path.join(ROOT, "game_config_v0.1", "grid_dimension_evidence_v1.json");
const TRANSCRIPT_DIR = path.join(ROOT, "data", "interview_transcripts");

const DIMENSION_LABELS = {
  "交互与表达": "interaction",
  "感知与理解": "perception",
  "运动与导航": "motion",
  "安全与信任": "safety",
  "可扩展与连接": "extend",
  "可运营与可维护": "ops"
};

const DAILY_LANGUAGE_TOPICS = {
  interaction: "有人回应你、陪你说话、听懂你的表达、让你不那么冷清",
  perception: "有人看出你的状态变化、懂你的情绪、知道你当下发生了什么",
  motion: "在空间里走动、跟着人移动、夜里起身、别挡路别碰倒东西",
  safety: "摔倒受伤、误操作、隐私边界、被监控的不适、让人踏实",
  extend: "和手机、家里其他设备、家人远程联系或机构系统连起来",
  ops: "坏了谁修、会不会吃灰、售后麻烦不麻烦、能不能一直稳定用"
};

const GRID_CONTEXT = {
  B2C_Differentiation_Elder: {
    market: "ToC",
    focus: "Elder",
    strategy: "Differentiation",
    gridLabel: "ToC·差异化·老人",
    whoRaw: "重视体面、陪伴感和生活体验的城镇老年个人消费者",
    architectureLabel: "体验型",
    briefInstruction: "受访者必须是老年个人消费者本人，强调尊严、情绪感受和具体生活情境。"
  },
  B2C_Cost_Elder: {
    market: "ToC",
    focus: "Elder",
    strategy: "Cost",
    gridLabel: "ToC·成本·老人",
    whoRaw: "注重实用、省钱和省心的城镇老年个人消费者",
    architectureLabel: "功能型",
    briefInstruction: "受访者必须是老年个人消费者本人，强调预算、耐用和不折腾。"
  },
  B2C_Differentiation_Adult: {
    market: "ToC",
    focus: "Adult",
    strategy: "Differentiation",
    gridLabel: "ToC·差异化·成人",
    whoRaw: "追求情绪体验、个性化和生活质感的都市独居成人",
    architectureLabel: "体验型",
    briefInstruction: "受访者必须是成人个人消费者本人，强调体验、陪伴感和个性表达。"
  },
  B2C_Cost_Adult: {
    market: "ToC",
    focus: "Adult",
    strategy: "Cost",
    gridLabel: "ToC·成本·成人",
    whoRaw: "预算克制、看重实用耐用和省心的普通职场成人",
    architectureLabel: "功能型",
    briefInstruction: "受访者必须是成人个人消费者本人，强调性价比、稳定和维护成本。"
  },
  B2C_Differentiation_Child: {
    market: "ToC",
    focus: "Child",
    strategy: "Differentiation",
    gridLabel: "ToC·差异化·儿童",
    whoRaw: "重视成长体验、陪伴和教育氛围的儿童家庭决策者",
    architectureLabel: "体验型",
    briefInstruction: "受访者必须是儿童家庭的购买决策者，强调陪伴、成长和家庭氛围。"
  },
  B2C_Cost_Child: {
    market: "ToC",
    focus: "Child",
    strategy: "Cost",
    gridLabel: "ToC·成本·儿童",
    whoRaw: "看重安全、省心和性价比的双职工儿童家庭决策者",
    architectureLabel: "功能型",
    briefInstruction: "受访者必须是儿童家庭的购买决策者，强调安全、实用和省心。"
  },
  B2B_Differentiation_Elder: {
    market: "ToB",
    focus: "Elder",
    strategy: "Differentiation",
    gridLabel: "ToB·差异化·老人",
    whoRaw: "重视服务体验和机构口碑的养老服务机构决策者",
    architectureLabel: "体验型",
    briefInstruction: "受访者必须是养老机构的决策者或采购负责人，不是老人住户。"
  },
  B2B_Cost_Elder: {
    market: "ToB",
    focus: "Elder",
    strategy: "Cost",
    gridLabel: "ToB·成本·老人",
    whoRaw: "人手紧张、强调效率与风险控制的养老服务机构决策者",
    architectureLabel: "功能型",
    briefInstruction: "受访者必须是养老机构的决策者或采购负责人，强调效率、风险和维护成本。"
  },
  B2B_Differentiation_Adult: {
    market: "ToB",
    focus: "Adult",
    strategy: "Differentiation",
    gridLabel: "ToB·差异化·成人",
    whoRaw: "重视员工或客户体验、愿意用体验拉开差异的成人场景机构决策者",
    architectureLabel: "体验型",
    briefInstruction: "受访者必须是企业、酒店、办公空间等机构的决策者或采购负责人。"
  },
  B2B_Cost_Adult: {
    market: "ToB",
    focus: "Adult",
    strategy: "Cost",
    gridLabel: "ToB·成本·成人",
    whoRaw: "强调降本增效、稳定和维护成本的成人场景机构决策者",
    architectureLabel: "功能型",
    briefInstruction: "受访者必须是企业、酒店、连锁门店等机构的决策者或采购负责人。"
  },
  B2B_Differentiation_Child: {
    market: "ToB",
    focus: "Child",
    strategy: "Differentiation",
    gridLabel: "ToB·差异化·儿童",
    whoRaw: "重视教学体验、口碑和家长感受的儿童教育托育机构决策者",
    architectureLabel: "体验型",
    briefInstruction: "受访者必须是幼儿园、托育机构等的决策者或采购负责人，不是家长。"
  },
  B2B_Cost_Child: {
    market: "ToB",
    focus: "Child",
    strategy: "Cost",
    gridLabel: "ToB·成本·儿童",
    whoRaw: "师资紧张、看重安全和性价比的儿童机构运营决策者",
    architectureLabel: "功能型",
    briefInstruction: "受访者必须是幼儿园、托育机构等的决策者或采购负责人，强调安全、运营和成本。"
  }
};

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function readJsonIfExists(filePath, fallback) {
  if (!fs.existsSync(filePath)) return fallback;
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJson(filePath, value) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function compactText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function countChineseChars(value) {
  return String(value || "").replace(/\s+/g, "").length;
}

function parseJsonLoose(raw) {
  const text = String(raw || "").replace(/```json|```/g, "").trim();
  try {
    return JSON.parse(text);
  } catch (_) {}
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start >= 0 && end > start) {
    return JSON.parse(text.slice(start, end + 1));
  }
  throw new Error("json parse failed");
}

function getLeakageVocabulary() {
  const tags = Object.keys(tagMap.need_tag_to_dim || {});
  const capabilities = [];
  (capabilityGroups.groups || []).forEach((group) => {
    (group.capabilities || []).forEach((capability) => {
      const name = compactText(capability?.name || "");
      if (name) capabilities.push(name);
    });
  });
  return Array.from(new Set([...tags, ...capabilities])).sort((a, b) => b.length - a.length);
}

function findLeakageTerms(text, vocabulary = getLeakageVocabulary()) {
  const body = compactText(text);
  if (!body) return [];
  return vocabulary.filter((term) => new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "iu").test(body));
}

function getGridRecords() {
  return priors.grids.map((grid) => ({
    grid_id: grid.id,
    ...GRID_CONTEXT[grid.id],
    radar_weight_prior: grid.radar_weight_prior,
    recommended_core_tags: Array.isArray(grid.recommended_core_tags) ? grid.recommended_core_tags : [],
    recommended_nice_tags: Array.isArray(grid.recommended_nice_tags) ? grid.recommended_nice_tags : []
  }));
}

function getTopAndBottomDimensions(grid) {
  const entries = Object.entries(grid.radar_weight_prior || {}).map(([label, strength]) => ({
    label,
    dim: DIMENSION_LABELS[label],
    strength: Number(strength || 0)
  })).filter((item) => item.dim);
  entries.sort((a, b) => b.strength - a.strength);
  return {
    high: entries.slice(0, 3),
    low: entries.slice(-2)
  };
}

function buildPersonaId(gridId, index) {
  const [channelRaw, strategyRaw, focusRaw] = String(gridId || "").split("_");
  const channel = channelRaw === "B2C" ? "ToC" : "ToB";
  const strategy = /Differentiation/i.test(strategyRaw) ? "Diff" : "Cost";
  return `${channel}_${strategy}_${focusRaw}_P${index}`;
}

function extractQuestionList() {
  return Array.isArray(guide.questions) ? guide.questions : [];
}

function assessDimensionCoverage(turns) {
  const textByQuestionId = new Map();
  let currentQuestionId = "";
  for (const turn of Array.isArray(turns) ? turns : []) {
    const role = String(turn?.role || "").trim();
    const questionId = compactText(turn?.question_id || turn?.questionId || "");
    if (role === "researcher" && questionId) {
      currentQuestionId = questionId;
      if (!textByQuestionId.has(questionId)) textByQuestionId.set(questionId, "");
    } else if (role === "respondent" && currentQuestionId) {
      const prev = textByQuestionId.get(currentQuestionId) || "";
      textByQuestionId.set(currentQuestionId, `${prev}\n${compactText(turn?.text || "")}`.trim());
    }
  }

  const coverageMap = {};
  const definition = guide.dimension_coverage_check || {};
  for (const [dimLabel, questionIds] of Object.entries(definition)) {
    const hit = (Array.isArray(questionIds) ? questionIds : []).some((questionId) => {
      const text = compactText(textByQuestionId.get(questionId) || "");
      return text.length >= 20;
    });
    coverageMap[dimLabel] = hit;
  }
  const coveredCount = Object.values(coverageMap).filter(Boolean).length;
  return {
    coverageMap,
    coveredCount,
    totalDimensions: Object.keys(definition).length
  };
}

async function runChat(messages, options = {}) {
  return chatCompletion(messages, {
    temperature: options.temperature ?? 0.7,
    max_tokens: options.max_tokens ?? 1400,
    maxRetries: options.maxRetries ?? 2
  });
}

module.exports = {
  ROOT,
  OUTPUT_BRIEFS,
  OUTPUT_REPORTS,
  OUTPUT_EVIDENCE,
  TRANSCRIPT_DIR,
  GUIDE: guide,
  SAMPLE_REPORT: sampleReport,
  DIMENSION_LABELS,
  DAILY_LANGUAGE_TOPICS,
  GRID_CONTEXT,
  ensureDir,
  readJsonIfExists,
  writeJson,
  compactText,
  countChineseChars,
  parseJsonLoose,
  getLeakageVocabulary,
  findLeakageTerms,
  getGridRecords,
  getTopAndBottomDimensions,
  buildPersonaId,
  extractQuestionList,
  assessDimensionCoverage,
  runChat
};
