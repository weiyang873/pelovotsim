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

const REVIEW_DUMP = path.join(ROOT, "data", "review_exports", "persona_reports_v1.1_review.md");

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

const SOFT_MAX_CHARS = 1250;

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
    .replace(/([。！？”」])\s*→/g, "$1\n→")
    .replace(/\s*(\n1\.\s)/g, "$1")
    .replace(/\s*(\n2\.\s)/g, "$1")
    .trim();
}

function fallbackArrowLine(grid) {
  if (grid.market === "ToB") {
    if (grid.strategy === "Differentiation") return "→ 这说明机构不仅看重问题被解决，还看重体验差异是否能转化为服务口碑与运营优势。";
    return "→ 这说明机构更在意可验证的效率改善、稳定落地和投入产出比。";
  }
  if (grid.strategy === "Differentiation") {
    return "→ 这说明用户期待的不是勉强能用，而是更贴合自己生活节奏与感受的体验。";
  }
  return "→ 这说明用户真正看重的是省心、稳定和花出去的钱值不值。";
}

function fallbackRemarkLine(grid) {
  if (grid.market === "ToB") {
    if (grid.strategy === "Differentiation") return "这是一位会把体验差异转化为服务口碑、组织认可和采购正当性的机构决策者。";
    return "这是一位高度务实、以审批门槛和投入产出比为核心判断标准的机构决策者。";
  }
  if (grid.strategy === "Differentiation") {
    return "这是一个愿意为更贴合自己生活体验的差异化价值付费、但前提是不能破坏边界感的个人用户。";
  }
  return "这是一个价格敏感、强调稳定省心、会反复衡量花出去的钱是否值得的个人用户。";
}

function ensureFindingArrows(text, grid) {
  const raw = String(text || "");
  const matches = Array.from(raw.matchAll(/\*\*发现[一二三四]：[^\n]*[\s\S]*?(?=\n\*\*发现[一二三四]：|\n▎行为与态度|$)/g));
  if (!matches.length) return text;
  let cursor = 0;
  let output = "";
  for (const match of matches) {
    const section = match[0];
    const start = match.index || 0;
    output += raw.slice(cursor, start);
    if (section.includes("→")) {
      output += section;
    } else {
      output += `${section.trimEnd()}\n${fallbackArrowLine(grid)}\n`;
    }
    cursor = start + section.length;
  }
  output += raw.slice(cursor);
  return cleanReportText(output);
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
        ensureFindingArrows(text, grid)
      ),
      grid
    )
  );
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

function buildPatchPrompt({ baseReport, grid, marketUnitZh, personaIdentity, formatIssue, leakageTerms, lengthIssue }) {
  const issueLines = [];
  if (formatIssue) issueLines.push(`这次必须修正这些格式问题：${formatIssue}`);
  if (Array.isArray(leakageTerms) && leakageTerms.length) {
    issueLines.push(`上一次仍出现禁词：${leakageTerms.join("、")}。这次必须彻底避开。`);
  }
  if (lengthIssue === "too_long") {
    issueLines.push("字数偏长。请压缩到 800-1200 字目标区间，保留原情境骨架。");
  } else if (lengthIssue === "too_short") {
    issueLines.push("字数偏短。请稍微充实观察句与行为态度，但不要发明新情节。");
  }

  return [
    "你是用户研究总监。现在只对一份既有报告做后处理重写，不是重做访谈。",
    "你的目标有两个：",
    "1. 在保留原报告情境骨架和主要引述的前提下，强化该报告与其格子属性的差异化。",
    "2. 把报告统一成指定格式。",
    "",
    "只允许重点改动这些位置：",
    "- 行为与态度段",
    "- 调研员备注段",
    "- 核心发现里涉及消费决策、支付意愿、功能期待的措辞",
    "",
    "尽量保留原引述和原情境，不要凭空发明新的事件，不要把个人消费者改成机构以外的人，反之亦然。",
    "如果原报告已经和格子很契合，就做最小必要修改。",
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
    "→ 1 句结构性总结。",
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
    "- 全文目标 800-1200 字，绝对不要超过 1500 字。",
    "- 核心发现标题统一加粗，且必须是“发现一/二/三/四”。",
    "- 箭头总结统一用“→”开头。",
    "- 只输出最终报告纯文本，不要解释，不要附注。",
    "- 不出现产品名、能力名、功能名、技术术语。",
    issueLines.join("\n"),
    "",
    "待修报告全文：",
    baseReport
  ].join("\n");
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
  const arrowCount = (text.match(/→/g) || []).length;
  if (arrowCount < 4) issues.push("箭头总结少于 4 条");
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
    console.warn(`[patch_reports] ${personaId} compressed to ${charCount}`);
    workingText = compressed;
    if (charCount <= SOFT_MAX_CHARS) return workingText;
  }
  return workingText;
}

async function repairFormatting(personaId, reportText, marketUnitZh, personaIdentity, formatIssue) {
  const repaired = normalizeReportFormatting(await runChat([
    {
      role: "system",
      content: "你是严格的中文排版编辑。只修格式与结构缺口，不重写情节。若某条发现缺少箭头总结，可补一条简洁的结构性总结；若缺少调研员备注，可补一段简洁备注。输出纯文本。"
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
        "每条发现都要有一条以“→”开头的总结。",
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
  console.warn(`[patch_reports] ${personaId} formatting repaired`);
  return repaired;
}

async function patchReport(personaId, originalReport, grid, marketUnitZh, personaIdentity) {
  let formatIssue = "";
  let lengthIssue = "";
  let leakageTerms = [];
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
          formatIssue,
          leakageTerms,
          lengthIssue
        })
      }
    ], {
      temperature: lengthIssue === "too_long" ? 0.25 : 0.4,
      max_tokens: lengthIssue === "too_long" ? 950 : 1300
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

    if (leakage.length) {
      leakageTerms = leakage;
      formatIssue = "";
      lengthIssue = "";
      workingText = candidateText;
      console.warn(`[patch_reports] ${personaId} leakage retry: ${leakage.join(", ")}`);
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
      if (!repairedFormatErrors.length && !repairedLeakage.length && repairedCharCount <= SOFT_MAX_CHARS && repairedCharCount >= 800) {
        return {
          report_text: repairedText,
          char_count: repairedCharCount,
          leakage_check_passed: true
        };
      }
      formatIssue = joinedIssue;
      leakageTerms = repairedLeakage;
      lengthIssue = repairedCharCount > SOFT_MAX_CHARS ? "too_long" : repairedCharCount < 800 ? "too_short" : "";
      workingText = repairedText;
      console.warn(`[patch_reports] ${personaId} format retry: ${joinedIssue}`);
      continue;
    }
    if (charCount > SOFT_MAX_CHARS) {
      lengthIssue = "too_long";
      formatIssue = "";
      leakageTerms = [];
      workingText = candidateText;
      console.warn(`[patch_reports] ${personaId} length retry too long: ${charCount}`);
      continue;
    }
    if (charCount < 800) {
      lengthIssue = "too_short";
      formatIssue = "";
      leakageTerms = [];
      workingText = cleanedText;
      console.warn(`[patch_reports] ${personaId} length retry too short: ${charCount}`);
      continue;
    }
      return {
      report_text: candidateText,
      char_count: charCount,
      leakage_check_passed: true
    };
  }

  throw new Error(`postprocess failed after retries`);
}

function buildReviewDump(reportDoc, gridMap) {
  const lines = ["# 36 Persona Reports Review Dump", ""];
  for (const gridEntry of reportDoc.grids || []) {
    const grid = gridMap.get(gridEntry.grid_id);
    const marketUnitZh = buildMarketUnitZh(grid);
    lines.push(`## ${gridEntry.grid_id} · ${marketUnitZh}`);
    lines.push("");
    for (const report of gridEntry.reports || []) {
      lines.push(`### ${report.persona_id} [${report.change_level || "未标注"} | ${report.char_count}]`);
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

  for (const gridEntry of next.grids || []) {
    const grid = gridMap.get(gridEntry.grid_id);
    if (!grid) throw new Error(`missing grid config: ${gridEntry.grid_id}`);

    for (let index = 0; index < (gridEntry.reports || []).length; index += 1) {
      const report = gridEntry.reports[index];
      if (reportFilter && report.persona_id !== reportFilter && gridEntry.grid_id !== reportFilter) {
        continue;
      }
      if (!reportFilter && report.change_level && report.leakage_check_passed) {
        continue;
      }
      const persona = briefsMap.get(report.persona_id);
      const marketUnitZh = buildMarketUnitZh(grid);
      const personaIdentity = buildPersonaIdentity(persona);
      const patched = await patchReport(
        report.persona_id,
        report.report_text,
        grid,
        marketUnitZh,
        personaIdentity
      );
      const changeLevel = classifyChangeLevel(report.report_text, patched.report_text);
      gridEntry.reports[index] = {
        ...report,
        report_text: patched.report_text,
        char_count: patched.char_count,
        leakage_check_passed: patched.leakage_check_passed,
        reviewed: false,
        change_level: changeLevel
      };
      writeJson(OUTPUT_REPORTS, next);
      console.log(`[patch_reports] ${report.persona_id} -> ${patched.char_count} (${changeLevel})`);
    }
  }

  writeJson(OUTPUT_REPORTS, next);
  buildReviewDump(next, gridMap);
  console.log(`[patch_reports] wrote ${OUTPUT_REPORTS}`);
  console.log(`[patch_reports] review dump ${REVIEW_DUMP}`);
}

main().catch((error) => {
  console.error("[patch_reports] failed:", error);
  process.exit(1);
});
