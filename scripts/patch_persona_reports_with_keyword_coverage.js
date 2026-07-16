"use strict";

const fs = require("node:fs");
const path = require("node:path");

const {
  GRID_CONTEXT,
  OUTPUT_BRIEFS,
  OUTPUT_REPORTS,
  ROOT,
  compactText,
  countChineseChars,
  findLeakageTerms,
  getGridRecords,
  readJsonIfExists,
  runChat,
  writeJson
} = require("./offline_report_utils");

const VP_PROFILES = require("../game_config_v0.1/vp_anchor_profiles.json");

const REVIEW_DUMP = path.join(ROOT, "data", "review_exports", "persona_reports_v1.1_review.md");
const KEYWORD_AUDIT_DUMP = path.join(ROOT, "data", "review_exports", "persona_keyword_coverage_review.md");

const SOFT_MAX_CHARS = 1200;
const HARD_MAX_CHARS = 1500;
const GENERIC_KEYWORD_STOPWORDS = new Set([
  "更好",
  "体验",
  "效果",
  "成本",
  "价值",
  "需求",
  "场景",
  "机构",
  "个人",
  "用户",
  "受访者",
  "值得",
  "独特",
  "品质",
  "方案",
  "问题",
  "服务",
  "价格敏感",
  "成本敏感",
  "付溢价",
  "溢价",
  "更独特",
  "追求品质",
  "效果可感知",
  "独特性付溢价",
  "愿意为差异化付溢价"
]);

const STRATEGY_PROMPTS = {
  Differentiation: [
    "受访者是品质/体验导向的消费者或采购者。",
    "痛点描述侧重“体验不够好”“不够懂我”“没有温度”。",
    "消费态度强调“好东西值得花钱”“用得久比便宜重要”。",
    "对功能的期待更高：不只是“别添乱”，而是“能主动懂我”。",
    "支付意愿锚点更高：个人两三千可接受，机构十几万可接受。",
    "调研员备注点明：这是一个愿意为差异化体验付溢价的用户。"
  ].join("\n"),
  Cost: [
    "受访者是价格/实用导向的消费者或采购者。",
    "痛点描述侧重“太贵了”“花了钱不好用”“性价比不高”。",
    "消费态度强调“够用就行”“超过某个金额就要犹豫”“先算账”。",
    "对功能的期待更低：核心是“稳定、不折腾、不添乱”。",
    "支付意愿锚点更低：个人三五百犹豫，机构两三万要审批。",
    "调研员备注点明：这是一个极度务实的价格敏感型用户。"
  ].join("\n")
};

const MARKET_PROMPTS = {
  ToB: [
    "受访者是机构采购决策者，不是个人消费者。",
    "核心发现至少 2 条围绕机构运营痛点：人力成本、排班、培训效率、家属投诉、合规风险等。",
    "消费态度段使用机构语言：“采购审批”“人力替代”“投入产出比”“一台设备能省一个人力”“总部审批流程”“试用期”。",
    "行为与态度段体现管理者视角，而非个人生活消费视角。",
    "支付意愿使用机构口径：万元级，与人力成本对标。",
    "调研员备注使用“运营效率”“管理杠杆”等机构关键词。"
  ].join("\n"),
  ToC: [
    "受访者是个人/家庭消费者。",
    "核心发现围绕个人/家庭生活场景：独处、育儿、照护老人、家庭关系。",
    "消费态度段使用个人语言：“自己花钱”“跟家人商量”“值不值”。",
    "行为与态度段体现个人决策而非团队决策。"
  ].join("\n")
};

const FOCUS_PROMPTS = {
  Elder: [
    "受访者或其服务对象是老年人。",
    "保持安全/运维的高权重，同时让年龄特征更鲜明：技术恐惧、学习门槛、身体限制、子女远程关系、尊严与被监控的矛盾。"
  ].join("\n"),
  Adult: [
    "受访者或其服务对象是成年人（上班族/管理者）。",
    "突出工作压力、效率诉求、独居孤独、信息过载。",
    "差异化格强调品质/个性化和被理解感；成本格强调极度务实、省心、别折腾。"
  ].join("\n"),
  Child: [
    "受访者或其服务对象涉及儿童。",
    "突出孩子安全、教育陪伴、家长分身乏术，以及对儿童隐私的额外敏感。"
  ].join("\n")
};

const STRATEGY_ZH = {
  Differentiation: "差异化",
  Cost: "成本导向"
};

const MARKET_ZH = {
  ToB: "机构市场",
  ToC: "家庭消费"
};

const FOCUS_ZH = {
  Elder: "老人场景",
  Adult: "成人场景",
  Child: "儿童场景"
};

function cleanReportText(text) {
  return String(text || "")
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function normalizeReportFormatting(text) {
  return cleanReportText(text)
    .replace(/(━━━━━━━━━━━━━━━━━━━━)\s*客户调研报告/g, "$1\n客户调研报告")
    .replace(/客户调研报告\s*([^\n]+)\s*━━━━━━━━━━━━━━━━━━━━/, "客户调研报告\n$1\n━━━━━━━━━━━━━━━━━━━━")
    .replace(/\s*(▎受访者概况|▎核心发现|▎行为与态度|▎调研员备注)/g, "\n\n$1")
    .replace(/\s*(\*\*发现[一二三四]：)/g, "\n\n$1")
    .replace(/\s*(\n1\.\s)/g, "$1")
    .replace(/\s*(\n2\.\s)/g, "$1")
    .trim();
}

function sliceChars(text, limit) {
  return Array.from(String(text || "")).slice(0, limit).join("");
}

function trimLineToLimit(line, limit) {
  const text = String(line || "").trim();
  if (countChineseChars(text) <= limit) return text;
  let clipped = sliceChars(text, limit).replace(/[，、；：,;:]+$/u, "");
  if (!/[。！？]$/u.test(clipped)) clipped += "。";
  return clipped;
}

function fallbackRemarkLine(grid) {
  if (grid.market === "ToB") {
    if (grid.strategy === "Differentiation") return "性格标签：机构视角、品质敏感、谨慎、重视展示感。";
    return "性格标签：机构视角、务实、价格敏感、重视可量化。";
  }
  if (grid.strategy === "Differentiation") {
    return "性格标签：体验敏感、边界感强、谨慎、重视独特性。";
  }
  return "性格标签：务实、价格敏感、低维护偏好、重视确定性。";
}

function stripFindingArrows(text) {
  return cleanReportText(
    String(text || "")
      .split("\n")
      .filter((line) => !/^\s*→/.test(line))
      .join("\n")
  );
}

function ensureBehaviorNumbering(text) {
  const body = String(text || "");
  const match = body.match(/(▎行为与态度\s*\n)([\s\S]*?)(\n▎调研员备注|$)/);
  if (!match) return body;
  const sectionBody = match[2].trim();
  if (/^1\.\s/m.test(sectionBody) && /^2\.\s/m.test(sectionBody)) return body;
  const lines = sectionBody.split("\n").map((line) => line.trim()).filter(Boolean);
  if (!lines.length) return body;
  const numbered = lines.map((line, index) => `${index + 1}. ${line.replace(/^[0-9]+[.)]\s*/, "")}`).join("\n");
  return body.replace(match[0], `${match[1]}${numbered}${match[3]}`);
}

function ensureRemarkSection(text, grid) {
  const body = String(text || "");
  if (body.includes("▎调研员备注")) return body;
  return `${body.trim()}\n\n▎调研员备注\n${fallbackRemarkLine(grid)}`;
}

function applyLocalFormatFallbacks(text, grid) {
  return normalizeReportFormatting(
    ensureRemarkSection(
      ensureBehaviorNumbering(
        stripFindingArrows(text)
      ),
      grid
    )
  );
}

function hardTrimReportStructure(text) {
  const lines = normalizeReportFormatting(text).split("\n");
  let section = "";
  const next = lines.map((line) => {
    const raw = String(line || "");
    const trimmed = raw.trim();
    if (!trimmed) return raw;
    if (trimmed.startsWith("━━━━━━━━━━━━━━━━━━━━") || trimmed === "客户调研报告") return trimmed;
    if (trimmed.startsWith("▎")) {
      section = trimmed;
      return trimmed;
    }
    if (trimmed.startsWith("**发现")) return trimmed;
    if (section === "▎受访者概况") return trimLineToLimit(trimmed, 68);
    if (section === "▎核心发现") return trimLineToLimit(trimmed, 88);
    if (section === "▎行为与态度" && /^\d+\.\s/.test(trimmed)) return trimLineToLimit(trimmed, 76);
    if (section === "▎调研员备注") return trimLineToLimit(trimmed, 68);
    return trimLineToLimit(trimmed, 80);
  });
  return cleanReportText(next.join("\n"));
}

function getPersonaMap() {
  const briefs = readJsonIfExists(OUTPUT_BRIEFS, { grids: [] });
  const map = new Map();
  for (const grid of briefs.grids || []) {
    for (const persona of grid.personas || []) {
      map.set(persona.persona_id, persona);
    }
  }
  return map;
}

function buildMarketUnitZh(grid) {
  return `${MARKET_ZH[grid.market]}·${STRATEGY_ZH[grid.strategy]}·${FOCUS_ZH[grid.focus]}`;
}

function buildPersonaIdentity(persona) {
  const source = persona?.source_persona || {};
  const brief = persona?.brief || {};
  if (source.occupation) return compactText(source.occupation);
  if (source.title) return compactText(source.title);
  if (brief.identity) return compactText(brief.identity);
  if (source.org_type) return compactText(source.org_type);
  return compactText(persona?.persona_id || "受访者");
}

function validateFormatting(reportText, marketUnitZh, personaIdentity) {
  const text = String(reportText || "");
  const issues = [];
  const header = [
    "━━━━━━━━━━━━━━━━━━━━",
    "客户调研报告",
    `${marketUnitZh} · ${personaIdentity}`,
    "━━━━━━━━━━━━━━━━━━━━"
  ].join("\n");
  if (!text.startsWith(header)) issues.push("头部三行和分隔线不符合要求");
  if (!text.includes("▎受访者概况")) issues.push("缺少“▎受访者概况”");
  if (!text.includes("▎核心发现")) issues.push("缺少“▎核心发现”");
  if (!text.includes("▎行为与态度")) issues.push("缺少“▎行为与态度”");
  if (!text.includes("▎调研员备注")) issues.push("缺少“▎调研员备注”");
  ["一", "二", "三", "四"].forEach((num) => {
    if (!text.includes(`**发现${num}：`)) issues.push(`缺少“发现${num}”标题格式`);
  });
  if (!/\n1\.\s/.test(text) || !/\n2\.\s/.test(text)) issues.push("行为与态度未统一成 1./2. 编号");
  return issues;
}

function normalizeForDiff(text) {
  return compactText(String(text || ""))
    .replace(/━━━━━━━━━━━━━━━━━━━━/g, "")
    .replace(/客户调研报告/g, "")
    .replace(/▎受访者概况|▎核心发现|▎行为与态度|▎调研员备注/g, "")
    .replace(/\*\*/g, "")
    .replace(/发现[一二三四]：/g, "")
    .replace(/\n1\.\s|\n2\.\s/g, "")
    .replace(/→/g, "")
    .replace(/[·：:\-\s]/g, "")
    .trim();
}

function levenshtein(a, b) {
  const m = a.length;
  const n = b.length;
  if (!m) return n;
  if (!n) return m;
  const prev = new Array(n + 1);
  const curr = new Array(n + 1);
  for (let j = 0; j <= n; j += 1) prev[j] = j;
  for (let i = 1; i <= m; i += 1) {
    curr[0] = i;
    for (let j = 1; j <= n; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(
        prev[j] + 1,
        curr[j - 1] + 1,
        prev[j - 1] + cost
      );
    }
    for (let j = 0; j <= n; j += 1) prev[j] = curr[j];
  }
  return prev[n];
}

function classifyChangeLevel(originalText, nextText) {
  const a = normalizeForDiff(originalText);
  const b = normalizeForDiff(nextText);
  if (a === b) return "未改";
  const base = Math.max(a.length, b.length, 1);
  const ratio = levenshtein(a, b) / base;
  if (ratio < 0.12) return "微调";
  return "大改";
}

function hashString(input) {
  let hash = 2166136261;
  const text = String(input || "");
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function createPrng(seedInput) {
  let state = hashString(seedInput) || 1;
  return function rand() {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function shuffleDeterministic(items, seedInput) {
  const rand = createPrng(seedInput);
  const next = items.slice();
  for (let i = next.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rand() * (i + 1));
    const tmp = next[i];
    next[i] = next[j];
    next[j] = tmp;
  }
  return next;
}

function normalizeKeyword(keyword) {
  return String(keyword || "")
    .replace(/[“”"'`·•\-—_:：;；,.，。！？、（）()【】\[\]]/g, "")
    .replace(/\s+/g, "")
    .trim();
}

function isKeywordLike(keyword) {
  const text = normalizeKeyword(keyword);
  if (!text) return false;
  if (text.length < 2 || text.length > 10) return false;
  if (/[0-9]/.test(text)) return false;
  if (GENERIC_KEYWORD_STOPWORDS.has(text)) return false;
  if (/^[的了和与及并或但让把被因对向在有是用更很太不别可再都就还一个一些这种那个这样那样]$/.test(text)) return false;
  return true;
}

function uniqueKeywords(list) {
  const seen = new Set();
  const next = [];
  for (const item of Array.isArray(list) ? list : []) {
    const text = normalizeKeyword(item);
    if (!isKeywordLike(text)) continue;
    if (seen.has(text)) continue;
    seen.add(text);
    next.push(text);
  }
  return next;
}

function parseKeywordListLoose(raw) {
  const text = String(raw || "").replace(/```json|```/gi, "").trim();
  if (!text) return [];
  try {
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed)) return uniqueKeywords(parsed);
    if (parsed && typeof parsed === "object") return uniqueKeywords(parsed.keywords || parsed.items || []);
  } catch (_) {}

  const arrayMatch = text.match(/\[[\s\S]*\]/);
  if (arrayMatch) {
    try {
      return uniqueKeywords(JSON.parse(arrayMatch[0]));
    } catch (_) {}
  }

  const lines = text
    .split("\n")
    .map((line) => line.replace(/^[\s\-*•\d.、]+/, "").trim())
    .filter(Boolean);
  const items = [];
  for (const line of lines) {
    const chunks = line
      .split(/[、，,；;|/]/)
      .map((item) => item.trim())
      .filter(Boolean);
    items.push(...(chunks.length > 1 ? chunks : [line]));
  }
  return uniqueKeywords(items);
}

function getVpProfileKeys(grid) {
  const channel = grid.market === "ToB" ? "ToB" : "ToC";
  const focus = grid.focus;
  const strategy = grid.strategy;
  return {
    marketKey: `${channel}_${focus}`,
    strategyKey: strategy
  };
}

function buildGridKeywordAtomPrompt(grid, marketProfile, strategyProfile) {
  const painAnchors = (marketProfile.pain_anchors || []).map((item, index) => `${index + 1}. ${item.text}`).join("\n");
  return [
    "你是一个中文概念拆分助手。请把下面这个格子的 market core + strategy overlay 拆成“原子化关键词池”。",
    "",
    "输出规则：",
    "- 只根据给定原文拆分，不发明新概念。",
    "- 每个关键词都要是独立概念单元，优先 3-8 个字；如果像“院长”“丧偶”这种 2 个字但语义完整，也允许保留。",
    "- 必须拆开：用户身份、痛点、替代方案、使用顾虑、购买心智、决策约束、期望。",
    "- 句子级内容要拆成多个短语级单元，例如“独居老人、丧偶、退休社交萎缩”应拆成三个词。",
    "- 不要整句，不要长解释，不要编号，不要重复，不要同义反复。",
    "- 不要输出泛词，如“需求”“场景”“体验”“成本”这种离开上下文就空的词；要保留有语义边界的短语。",
    "- 关键词池要尽量覆盖 market core 和 strategy overlay 的全部有效信息。",
    "- 只输出 JSON：{\"keywords\":[...]}",
    "",
    `格子：${grid.gridLabel}`,
    `市场：${grid.market}`,
    `策略：${grid.strategy}`,
    `人群：${grid.focus}`,
    "",
    "[market core] customer_group",
    marketProfile.customer_group,
    "",
    "[market core] pain_anchors",
    painAnchors,
    "",
    "[market core] alternatives",
    marketProfile.alternatives,
    "",
    "[market core] solution_expectations",
    marketProfile.solution_expectations,
    "",
    "[strategy overlay] customer_traits",
    strategyProfile.customer_traits,
    "",
    "[strategy overlay] value_perception",
    strategyProfile.value_perception,
    "",
    "[strategy overlay] solution_expectations",
    strategyProfile.solution_expectations
  ].join("\n");
}

async function atomizeGridKeywords(grid) {
  const { marketKey, strategyKey } = getVpProfileKeys(grid);
  const marketProfile = VP_PROFILES.market[marketKey];
  const strategyProfile = VP_PROFILES.strategy[strategyKey];
  if (!marketProfile || !strategyProfile) {
    throw new Error(`missing vp profile for ${grid.grid_id}`);
  }
  let lastError = null;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      const raw = await runChat([
        {
          role: "system",
          content: "你是中文概念拆分助手。只输出合法 JSON。"
        },
        {
          role: "user",
          content: buildGridKeywordAtomPrompt(grid, marketProfile, strategyProfile)
        }
      ], {
        temperature: 0,
        max_tokens: 1600,
        maxRetries: 1
      });
      const keywords = parseKeywordListLoose(raw);
      if (keywords.length >= 18) {
        return keywords;
      }
      lastError = new Error(`too few keywords: ${keywords.length}`);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error(`failed to atomize keywords for ${grid.grid_id}`);
}

function buildCoveragePlan(gridId, personaIds, fullKeywords) {
  const keywords = uniqueKeywords(fullKeywords);
  const sortedPersonas = personaIds.slice().sort((a, b) => {
    const aNum = Number((a.match(/P(\d+)/) || [])[1] || 0);
    const bNum = Number((b.match(/P(\d+)/) || [])[1] || 0);
    return aNum - bNum;
  });
  if (sortedPersonas.length !== 3) {
    throw new Error(`expected 3 personas for ${gridId}, got ${sortedPersonas.length}`);
  }
  const shuffled = shuffleDeterministic(keywords, `${gridId}:keyword-pool`);
  const base = Math.floor(shuffled.length / 3);
  const remainder = shuffled.length % 3;
  const sizes = [base, base, base];
  for (let i = 0; i < remainder; i += 1) sizes[i] += 1;

  const groupA = shuffled.slice(0, sizes[0]);
  const groupB = shuffled.slice(sizes[0], sizes[0] + sizes[1]);
  const groupC = shuffled.slice(sizes[0] + sizes[1]);
  const targetSize = Math.round(shuffled.length * 0.7);

  const personaPlans = {};
  const baseCovered = {
    [sortedPersonas[0]]: groupA.concat(groupC),
    [sortedPersonas[1]]: groupA.concat(groupB),
    [sortedPersonas[2]]: groupB.concat(groupC)
  };
  const missingGroup = {
    [sortedPersonas[0]]: groupB,
    [sortedPersonas[1]]: groupC,
    [sortedPersonas[2]]: groupA
  };

  sortedPersonas.forEach((personaId) => {
    const baseList = uniqueKeywords(baseCovered[personaId]);
    const missing = shuffleDeterministic(missingGroup[personaId], `${gridId}:${personaId}:supplement`);
    const needed = Math.max(0, targetSize - baseList.length);
    const supplement = missing.slice(0, needed);
    const covered = uniqueKeywords(baseList.concat(supplement));
    const uncovered = keywords.filter((item) => !covered.includes(item));
    personaPlans[personaId] = {
      covered,
      uncovered
    };
  });

  const union = new Set();
  sortedPersonas.forEach((personaId) => {
    personaPlans[personaId].covered.forEach((item) => union.add(item));
  });

  const intersections = [
    [sortedPersonas[0], sortedPersonas[1]],
    [sortedPersonas[0], sortedPersonas[2]],
    [sortedPersonas[1], sortedPersonas[2]]
  ].map(([left, right]) => {
    const leftSet = new Set(personaPlans[left].covered);
    const value = personaPlans[right].covered.filter((item) => leftSet.has(item)).length;
    return { pair: `${left}/${right}`, count: value };
  });

  return {
    fullKeywords: keywords,
    targetSize,
    groups: {
      A: groupA,
      B: groupB,
      C: groupC
    },
    personas: personaPlans,
    validation: {
      total: keywords.length,
      unionCount: union.size,
      intersections
    }
  };
}

function alignCoverageForPersona(coverage, fullKeywords, personaIdentity) {
  const identity = normalizeKeyword(personaIdentity);
  const identityKeyword = fullKeywords.find((item) => item === identity);
  if (!identityKeyword) return coverage;
  if (coverage.covered.includes(identityKeyword)) return coverage;
  const nextCovered = coverage.covered.slice();
  const swapOut = nextCovered.find((item) => item !== identityKeyword);
  if (swapOut) {
    const index = nextCovered.indexOf(swapOut);
    nextCovered[index] = identityKeyword;
  } else {
    nextCovered.push(identityKeyword);
  }
  const covered = uniqueKeywords(nextCovered).slice(0, coverage.covered.length);
  if (!covered.includes(identityKeyword)) {
    covered[covered.length - 1] = identityKeyword;
  }
  const uncovered = fullKeywords.filter((item) => !covered.includes(item));
  return { covered, uncovered };
}

function extractBodyText(text) {
  const markerIndex = String(text || "").indexOf("▎受访者概况");
  if (markerIndex >= 0) return String(text || "").slice(markerIndex);
  return String(text || "");
}

function stripLinesContainingKeywords(text, keywords) {
  const lines = String(text || "").split("\n");
  return lines.filter((line, index) => {
    if (index < 4) return true;
    return !keywords.some((keyword) => line.includes(keyword));
  }).join("\n");
}

function findKeywordMentions(text, keywords) {
  const body = compactText(extractBodyText(text));
  const hits = [];
  for (const keyword of Array.isArray(keywords) ? keywords : []) {
    const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (new RegExp(escaped, "u").test(body)) hits.push(keyword);
  }
  return hits;
}

function buildPatchPrompt({
  baseReport,
  grid,
  marketUnitZh,
  personaIdentity,
  coveredKeywords,
  uncoveredKeywords,
  formatIssue,
  leakageTerms,
  uncoveredMentions,
  lengthIssue
}) {
  const issueLines = [];
  if (formatIssue) issueLines.push(`这次必须修正这些格式问题：${formatIssue}`);
  if (Array.isArray(leakageTerms) && leakageTerms.length) {
    issueLines.push(`上一次仍出现禁词：${leakageTerms.join("、")}。这次必须彻底避开。`);
  }
  if (Array.isArray(uncoveredMentions) && uncoveredMentions.length) {
    issueLines.push(`上一次正文还残留这些不该出现的话题词：${uncoveredMentions.join("、")}。这次必须移除对应话题。`);
  }
  if (lengthIssue === "too_long") {
    issueLines.push("字数偏长。请压缩到 800-1200 字目标区间，保留原情境骨架。");
  } else if (lengthIssue === "too_short") {
    issueLines.push("字数偏短。请稍微充实观察句与行为态度，但不要发明新情节。");
  }

  return [
    "你是用户研究总监。现在只对一份既有报告做后处理重写，不是重做访谈。",
    "本轮有两层约束同时生效：",
    "1. 保留上一轮已经拉开的格子属性差异化语气。",
    "2. 报告内容只允许覆盖该 persona 被分配到的 covered 关键词；uncovered 关键词对应的话题、场景、痛点和替代方案都要从正文里消失，像“这位 persona 没聊到”。",
    "",
    "只允许重点改动这些位置：",
    "- 行为与态度段",
    "- 调研员备注段",
    "- 核心发现里涉及消费决策、功能期待、替代方案、场景重心的措辞",
    "",
    "尽量保留原引述和原情境骨架；如果某句引述主要落在 uncovered 话题上，可以删掉或改成更贴近 covered 话题的原意表达。",
    "不要凭空发明新事件，不要把 ToB 改成个人消费者，也不要把 ToC 改成机构。",
    "如果原报告已经和 covered 话题很契合，就做最小必要修改。",
    "",
    "格子属性：",
    `- 市场类型：${grid.market}`,
    `- 策略类型：${grid.strategy}`,
    `- 人群类型：${grid.focus}`,
    `- 市场单元中文名：${marketUnitZh}`,
    `- persona 简要身份：${personaIdentity}`,
    "",
    "差异化约束：",
    STRATEGY_PROMPTS[grid.strategy],
    "",
    MARKET_PROMPTS[grid.market],
    "",
    FOCUS_PROMPTS[grid.focus],
    "",
    "关键词覆盖约束：",
    `- 允许覆盖的 covered 关键词：${coveredKeywords.join("、")}`,
    `- 必须完全移除的 uncovered 关键词：${uncoveredKeywords.join("、")}`,
    "- 不要把这些关键词原样列成清单；请把 covered 关键词转成自然的生活/运营场景、顾虑、行为和判断语言。",
    "- uncovered 关键词对应的话题、场景、痛点、替代方案、期望都不要再出现。",
    "- 如果 covered / uncovered 出现冲突，以 uncovered 禁止为最高优先级。",
    "",
    "格式必须严格统一为：",
    "━━━━━━━━━━━━━━━━━━━━",
    "客户调研报告",
    `${marketUnitZh} · ${personaIdentity}`,
    "━━━━━━━━━━━━━━━━━━━━",
    "",
    "▎受访者概况",
    "1 段。",
    "",
    "▎核心发现",
    "**发现一：标题**",
    "“保留或微调后的原话引述”",
    "1-2 句观察。",
    "",
    "继续写 **发现二 / 发现三 / 发现四**，格式完全一致。",
    "",
    "▎行为与态度",
    "1. ...",
    "2. ...",
    "",
    "▎调研员备注",
    "1 段。",
    "",
    "硬约束：",
    `- 全文目标 800-1200 字，绝对不要超过 ${HARD_MAX_CHARS} 字。`,
    "- 核心发现标题统一加粗，且必须是“发现一/二/三/四”。",
    "- 只输出最终报告纯文本，不要解释，不要附注。",
    "- 不出现产品名、能力名、功能名、技术术语。",
    issueLines.join("\n"),
    "",
    "待修报告全文：",
    baseReport
  ].join("\n");
}

async function compressReport(personaId, reportText, grid) {
  let workingText = reportText;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const compressed = applyLocalFormatFallbacks(await runChat([
      {
        role: "system",
        content: "你是严格的中文压缩编辑。你的任务只有删减，不是重写。保留原有结构、引述、格子语气和判断方向，只删除重复表述与冗余修饰。输出纯文本。"
      },
      {
        role: "user",
        content: [
          "请把下面这份客户调研报告压缩到 850-1100 字，绝对不要超过 1200 字。",
          "硬约束：",
          "- 保留原有头部格式、分节标题、4 条核心发现、2 条行为与态度、1 段调研员备注。",
          "- 尽量保留原引述。",
          "- 不新增任何情节、观点或新例子。",
          "- 受访者概况控制在 60 字内。",
          "- 每条核心发现控制在 125-150 字内。",
          "- 每条行为与态度控制在 60-75 字内。",
          "- 调研员备注控制在 65 字内。",
          "- 如果超长，优先删掉重复修饰词、重复观察和次要补充句。",
          "",
          "待压缩报告：",
          workingText
        ].join("\n")
      }
    ], {
      temperature: 0.15,
      max_tokens: attempt === 0 ? 860 : 760
    }), grid);
    const charCount = countChineseChars(compressed);
    console.warn(`[keyword_patch] ${personaId} compressed to ${charCount}`);
    workingText = compressed;
    if (charCount <= SOFT_MAX_CHARS) return workingText;
  }
  const hardTrimmed = hardTrimReportStructure(workingText);
  console.warn(`[keyword_patch] ${personaId} hard trimmed to ${countChineseChars(hardTrimmed)}`);
  return hardTrimmed;
}

async function repairFormatting(personaId, reportText, marketUnitZh, personaIdentity, formatIssue) {
  const repaired = normalizeReportFormatting(await runChat([
    {
      role: "system",
      content: "你是严格的中文排版编辑。只修格式与结构缺口，不重写情节。若某条发现缺少事实观察，只修补事实表达；若缺少调研员备注，可补一段性格标签级备注。输出纯文本。"
    },
    {
      role: "user",
      content: [
        "请只修复下面这份报告的格式问题，尽量不改已有句子。",
        `当前格式问题：${formatIssue}`,
        "必须满足：",
        "━━━━━━━━━━━━━━━━━━━━",
        "客户调研报告",
        `${marketUnitZh} · ${personaIdentity}`,
        "━━━━━━━━━━━━━━━━━━━━",
        "",
        "▎受访者概况",
        "▎核心发现",
        "**发现一/二/三/四：标题**",
        "▎行为与态度",
        "1. ...",
        "2. ...",
        "▎调研员备注",
        "",
        "待修报告：",
        reportText
      ].join("\n")
    }
  ], { temperature: 0.2, max_tokens: 1200 }));
  console.warn(`[keyword_patch] ${personaId} formatting repaired`);
  return repaired;
}

async function patchReport(personaId, originalReport, grid, marketUnitZh, personaIdentity, coveragePlan) {
  let formatIssue = "";
  let lengthIssue = "";
  let leakageTerms = [];
  let uncoveredMentions = [];
  let workingText = originalReport;

  for (let attempt = 0; attempt < 6; attempt += 1) {
    const reportText = await runChat([
      {
        role: "system",
        content: "你是严谨的中文用户研究报告编辑。输出纯文本，不要代码块，不要解释。"
      },
      {
        role: "user",
        content: buildPatchPrompt({
          baseReport: workingText,
          grid,
          marketUnitZh,
          personaIdentity,
          coveredKeywords: coveragePlan.covered,
          uncoveredKeywords: coveragePlan.uncovered,
          formatIssue,
          leakageTerms,
          uncoveredMentions,
          lengthIssue
        })
      }
    ], {
      temperature: lengthIssue === "too_long" ? 0.25 : 0.35,
      max_tokens: lengthIssue === "too_long" ? 950 : 1350
    });
    const cleanedText = applyLocalFormatFallbacks(reportText, grid);

    let candidateText = cleanedText;
    let charCount = countChineseChars(candidateText);
    if (charCount > SOFT_MAX_CHARS) {
      candidateText = await compressReport(personaId, candidateText, grid);
      charCount = countChineseChars(candidateText);
    }

    const formatErrors = validateFormatting(candidateText, marketUnitZh, personaIdentity);
    const leakage = findLeakageTerms(candidateText);
    const uncovered = findKeywordMentions(candidateText, coveragePlan.uncovered);

    if (leakage.length) {
      const strippedText = applyLocalFormatFallbacks(stripLinesContainingKeywords(candidateText, leakage), grid);
      const strippedCharCount = countChineseChars(strippedText);
      const strippedFormatErrors = validateFormatting(strippedText, marketUnitZh, personaIdentity);
      const strippedLeakage = findLeakageTerms(strippedText);
      const strippedUncovered = findKeywordMentions(strippedText, coveragePlan.uncovered);
      if (!strippedFormatErrors.length && !strippedLeakage.length && !strippedUncovered.length && strippedCharCount >= 800 && strippedCharCount <= SOFT_MAX_CHARS) {
        return {
          report_text: strippedText,
          char_count: strippedCharCount,
          leakage_check_passed: true
        };
      }
      leakageTerms = leakage;
      formatIssue = "";
      lengthIssue = "";
      uncoveredMentions = [];
      workingText = strippedText;
      console.warn(`[keyword_patch] ${personaId} leakage retry: ${leakage.join(", ")}`);
      continue;
    }
    if (uncovered.length) {
      const strippedText = applyLocalFormatFallbacks(stripLinesContainingKeywords(candidateText, uncovered), grid);
      const strippedCharCount = countChineseChars(strippedText);
      const strippedFormatErrors = validateFormatting(strippedText, marketUnitZh, personaIdentity);
      const strippedLeakage = findLeakageTerms(strippedText);
      const strippedUncovered = findKeywordMentions(strippedText, coveragePlan.uncovered);
      if (!strippedFormatErrors.length && !strippedLeakage.length && !strippedUncovered.length && strippedCharCount >= 800 && strippedCharCount <= SOFT_MAX_CHARS) {
        return {
          report_text: strippedText,
          char_count: strippedCharCount,
          leakage_check_passed: true
        };
      }
      uncoveredMentions = uncovered;
      formatIssue = "";
      lengthIssue = "";
      leakageTerms = [];
      workingText = strippedText;
      console.warn(`[keyword_patch] ${personaId} uncovered retry: ${uncovered.join(", ")}`);
      continue;
    }
    if (formatErrors.length) {
      const joinedIssue = formatErrors.join("；");
      const repairedText = applyLocalFormatFallbacks(await repairFormatting(
        personaId,
        candidateText,
        marketUnitZh,
        personaIdentity,
        joinedIssue
      ), grid);
      const repairedCharCount = countChineseChars(repairedText);
      const repairedFormatErrors = validateFormatting(repairedText, marketUnitZh, personaIdentity);
      const repairedLeakage = findLeakageTerms(repairedText);
      const repairedUncovered = findKeywordMentions(repairedText, coveragePlan.uncovered);
      if (!repairedFormatErrors.length && !repairedLeakage.length && !repairedUncovered.length && repairedCharCount <= SOFT_MAX_CHARS && repairedCharCount >= 800) {
        return {
          report_text: repairedText,
          char_count: repairedCharCount,
          leakage_check_passed: true
        };
      }
      formatIssue = joinedIssue;
      leakageTerms = repairedLeakage;
      uncoveredMentions = repairedUncovered;
      lengthIssue = repairedCharCount > SOFT_MAX_CHARS ? "too_long" : repairedCharCount < 800 ? "too_short" : "";
      workingText = repairedText;
      console.warn(`[keyword_patch] ${personaId} format retry: ${joinedIssue}`);
      continue;
    }
    if (charCount > SOFT_MAX_CHARS) {
      lengthIssue = "too_long";
      formatIssue = "";
      leakageTerms = [];
      uncoveredMentions = [];
      workingText = candidateText;
      console.warn(`[keyword_patch] ${personaId} length retry too long: ${charCount}`);
      continue;
    }
    if (charCount > HARD_MAX_CHARS) {
      lengthIssue = "too_long";
      workingText = candidateText;
      console.warn(`[keyword_patch] ${personaId} hard max retry: ${charCount}`);
      continue;
    }
    if (charCount < 800) {
      lengthIssue = "too_short";
      formatIssue = "";
      leakageTerms = [];
      uncoveredMentions = [];
      workingText = cleanedText;
      console.warn(`[keyword_patch] ${personaId} length retry too short: ${charCount}`);
      continue;
    }
    return {
      report_text: candidateText,
      char_count: charCount,
      leakage_check_passed: true
    };
  }

  throw new Error("keyword-aware postprocess failed after retries");
}

function buildKeywordAuditDump(gridPlans, reportDoc) {
  const lines = ["# Persona Keyword Coverage Audit", ""];
  for (const gridEntry of reportDoc.grids || []) {
    const plan = gridPlans.get(gridEntry.grid_id);
    if (!plan) continue;
    lines.push(`## ${gridEntry.grid_id}`);
    lines.push("");
    lines.push(`- 原子化关键词总数 N = ${plan.fullKeywords.length}`);
    lines.push(`- 目标覆盖数 = ${plan.targetSize}`);
    lines.push(`- 三人并集覆盖 = ${plan.validation.unionCount}/${plan.validation.total}`);
    lines.push(`- 两两交集 = ${plan.validation.intersections.map((item) => `${item.pair}:${item.count}`).join(" | ")}`);
    lines.push("");
    lines.push("### 完整词表");
    lines.push(plan.fullKeywords.join("、"));
    lines.push("");
    for (const report of (gridEntry.reports || []).slice().sort((a, b) => a.persona_id.localeCompare(b.persona_id))) {
      const reportCovered = Array.isArray(report.covered_keywords) ? report.covered_keywords : (plan.personas[report.persona_id]?.covered || []);
      const reportUncovered = Array.isArray(report.uncovered_keywords) ? report.uncovered_keywords : (plan.personas[report.persona_id]?.uncovered || []);
      lines.push(`### ${report.persona_id}`);
      lines.push("");
      lines.push(`- covered (${reportCovered.length})：${reportCovered.join("、")}`);
      lines.push(`- uncovered (${reportUncovered.length})：${reportUncovered.join("、")}`);
      lines.push("");
    }
  }
  fs.mkdirSync(path.dirname(KEYWORD_AUDIT_DUMP), { recursive: true });
  fs.writeFileSync(KEYWORD_AUDIT_DUMP, `${lines.join("\n")}\n`, "utf8");
}

function buildReviewDump(reportDoc, gridMap) {
  const lines = ["# 36 Persona Reports Review Dump", ""];
  for (const gridEntry of reportDoc.grids || []) {
    const grid = gridMap.get(gridEntry.grid_id);
    const marketUnitZh = buildMarketUnitZh(grid);
    lines.push(`## ${gridEntry.grid_id} · ${marketUnitZh}`);
    lines.push("");
    for (const report of reportDoc.grids.find((item) => item.grid_id === gridEntry.grid_id).reports || []) {
      lines.push(`### ${report.persona_id} [${report.change_level || "未标注"} | ${report.char_count}]`);
      lines.push("");
      lines.push(`covered_keywords: ${report.covered_keywords.join("、")}`);
      lines.push("");
      lines.push(`uncovered_keywords: ${report.uncovered_keywords.join("、")}`);
      lines.push("");
      lines.push(report.report_text);
      lines.push("");
    }
  }
  fs.mkdirSync(path.dirname(REVIEW_DUMP), { recursive: true });
  fs.writeFileSync(REVIEW_DUMP, `${lines.join("\n")}\n`, "utf8");
}

async function main() {
  const briefsMap = getPersonaMap();
  const source = readJsonIfExists(OUTPUT_REPORTS, { grids: [] });
  const gridMap = new Map(getGridRecords().map((grid) => [grid.grid_id, grid]));
  const reportFilter = compactText(process.env.REPORT_FILTER || "");
  const next = JSON.parse(JSON.stringify(source));
  next.generated_at = new Date().toISOString();

  const gridPlans = new Map();
  for (const gridEntry of next.grids || []) {
    const grid = gridMap.get(gridEntry.grid_id);
    if (!grid) throw new Error(`missing grid config: ${gridEntry.grid_id}`);
    const personaIds = (gridEntry.reports || []).map((report) => report.persona_id);
    const fullKeywords = await atomizeGridKeywords(grid);
    const plan = buildCoveragePlan(gridEntry.grid_id, personaIds, fullKeywords);
    gridPlans.set(gridEntry.grid_id, plan);
  }

  for (const gridEntry of next.grids || []) {
    const grid = gridMap.get(gridEntry.grid_id);
    const plan = gridPlans.get(gridEntry.grid_id);
    if (!grid || !plan) throw new Error(`missing grid coverage plan: ${gridEntry.grid_id}`);

    for (let index = 0; index < (gridEntry.reports || []).length; index += 1) {
      const report = gridEntry.reports[index];
      const persona = briefsMap.get(report.persona_id);
      const personaIdentity = buildPersonaIdentity(persona);
      const coverage = alignCoverageForPersona(plan.personas[report.persona_id], plan.fullKeywords, personaIdentity);
      gridEntry.reports[index] = {
        ...report,
        grid_keywords_full: plan.fullKeywords,
        covered_keywords: coverage.covered,
        uncovered_keywords: coverage.uncovered
      };
    }

    for (let index = 0; index < (gridEntry.reports || []).length; index += 1) {
      const report = gridEntry.reports[index];
      if (reportFilter && report.persona_id !== reportFilter && gridEntry.grid_id !== reportFilter) {
        continue;
      }
      const persona = briefsMap.get(report.persona_id);
      const marketUnitZh = buildMarketUnitZh(grid);
      const personaIdentity = buildPersonaIdentity(persona);
      const coverage = alignCoverageForPersona(plan.personas[report.persona_id], plan.fullKeywords, personaIdentity);
      if (!coverage) throw new Error(`missing persona coverage: ${report.persona_id}`);
      const patched = await patchReport(
        report.persona_id,
        report.report_text,
        grid,
        marketUnitZh,
        personaIdentity,
        coverage
      );
      const changeLevel = classifyChangeLevel(report.report_text, patched.report_text);
      gridEntry.reports[index] = {
        ...report,
        report_text: patched.report_text,
        char_count: patched.char_count,
        leakage_check_passed: patched.leakage_check_passed,
        reviewed: false,
        change_level: changeLevel,
        grid_keywords_full: plan.fullKeywords,
        covered_keywords: coverage.covered,
        uncovered_keywords: coverage.uncovered
      };
      writeJson(OUTPUT_REPORTS, next);
      console.log(`[keyword_patch] ${report.persona_id} -> ${patched.char_count} (${changeLevel})`);
    }
  }

  writeJson(OUTPUT_REPORTS, next);
  buildKeywordAuditDump(gridPlans, next);
  buildReviewDump(next, gridMap);
  console.log(`[keyword_patch] wrote ${OUTPUT_REPORTS}`);
  console.log(`[keyword_patch] keyword audit ${KEYWORD_AUDIT_DUMP}`);
  console.log(`[keyword_patch] review dump ${REVIEW_DUMP}`);
}

main().catch((error) => {
  console.error("[keyword_patch] failed:", error);
  process.exit(1);
});
