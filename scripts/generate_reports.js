"use strict";

const fs = require("node:fs");
const path = require("node:path");

const {
  OUTPUT_REPORTS,
  SAMPLE_REPORT,
  TRANSCRIPT_DIR,
  compactText,
  countChineseChars,
  findLeakageTerms,
  getLeakageVocabulary,
  getGridRecords,
  readJsonIfExists,
  writeJson,
  runChat
} = require("./offline_report_utils");

function transcriptToText(turns) {
  return (Array.isArray(turns) ? turns : []).map((turn) => {
    const role = turn?.role === "researcher" ? "调研员" : "受访者";
    return `${role}：${compactText(turn?.text || "")}`;
  }).join("\n");
}

function buildReportPrompt(transcriptText, retryReason) {
  const bannedTerms = getLeakageVocabulary().join("、");
  const retryLines = [];
  if (retryReason === "length") {
    retryLines.push("上一次字数超标。这次必须明显压缩：只写 4 条核心发现、2 条行为与态度、1 句调研员备注，绝对不要超过 1500 字。");
  }
  if (retryReason === "leakage") {
    retryLines.push("上一次出现了产品/能力/功能/技术词。这次请彻底避免这些词。");
  }
  return [
    "你是一家专业用户研究机构的高级分析师。根据以下访谈记录，撰写一份客户调研报告。",
    "格式要求：",
    "1. 受访者概况：1-2 句背景",
    "2. 核心发现：固定 4 条，每条包含——",
    "   · 一句发现标题（不超过 14 字）",
    "   · 1 句受访者原话引述（用引号标注）",
    "   · 1 句你的观察（这句话背后的情境和行为模式）",
    "   · 一句箭头总结（→ 开头，点明这条发现对产品设计意味着什么，但不给具体方案）",
    "3. 行为与态度：固定 2 条，带引述",
    "4. 调研员备注：固定 1 句总结性观察",
    "硬约束：",
    "- 全文 900-1100 字为最佳目标",
    "- 绝对不要超过 1500 字",
    "- 不出现任何产品名、能力名、功能名、技术术语",
    `- 绝对不要出现这些禁词：${bannedTerms}`,
    "- 不给出任何产品建议或解决方案",
    "- 箭头总结只点明需求的结构性特征，不说“应该做XX”",
    "- 语言风格：专业调研报告，不是散文也不是小说",
    retryLines.join("\n"),
    "",
    "访谈记录：",
    transcriptText
  ].join("\n");
}

async function rewriteLeakage(personaId, reportText, leakageTerms) {
  const rewritten = compactText(await runChat([
    {
      role: "system",
      content: "你是用户研究报告改写助手。保持原有结构和意思，只把禁词改写成日常语言。输出纯文本，不要解释。"
    },
    {
      role: "user",
      content: [
        `下面这份报告出现了禁词：${leakageTerms.join("、")}`,
        "请在不改变报告结构和核心意思的前提下，把这些禁词全部改写成普通生活语言。",
        "例如：",
        "- 不要写“语音交互”，改成“开口说话就能得到回应”之类的生活表达",
        "- 不要写“自主移动”，改成“自己在空间里走动”之类的生活表达",
        "- 不要写“情感陪伴”，改成“有人作伴、有人回应”之类的生活表达",
        "- 不要出现任何产品名、能力名、功能名、技术术语",
        "- 保持篇幅紧凑，最好不要超过 1200 字，绝对不要超过 1500 字",
        "",
        "原报告：",
        reportText
      ].join("\n")
    }
  ], { temperature: 0.2, max_tokens: 1500 }));
  const leakage = findLeakageTerms(rewritten);
  return {
    report_text: rewritten,
    char_count: countChineseChars(rewritten),
    leakage
  };
}

async function generateReportText(personaId, transcriptText) {
  let retryReason = "";
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const reportText = compactText(await runChat([
      {
        role: "system",
        content: "你是高级用户研究分析师。输出纯文本报告，不要 markdown 代码块。"
      },
      {
        role: "user",
        content: buildReportPrompt(transcriptText, retryReason)
      }
    ], { temperature: 0.4, max_tokens: 1500 }));
    const leakage = findLeakageTerms(reportText);
    if (leakage.length) {
      const rewritten = await rewriteLeakage(personaId, reportText, leakage);
      if (!rewritten.leakage.length && rewritten.char_count <= 1500) {
        return {
          report_text: rewritten.report_text,
          char_count: rewritten.char_count,
          leakage_check_passed: true
        };
      }
      console.warn(`[reports] leakage regenerate ${personaId}: ${leakage.join(", ")}`);
      retryReason = "leakage";
      continue;
    }
    const charCount = countChineseChars(reportText);
    if (charCount > 1500) {
      console.warn(`[reports] length regenerate ${personaId}: ${charCount}`);
      retryReason = "length";
      continue;
    }
    return {
      report_text: reportText,
      char_count: charCount,
      leakage_check_passed: true
    };
  }
  throw new Error(`report generation failed after retries: ${personaId}`);
}

async function main() {
  const existing = readJsonIfExists(OUTPUT_REPORTS, { grids: [] });
  const existingMap = new Map((existing.grids || []).map((item) => [item.grid_id, item]));
  const next = { version: "v1", generated_at: new Date().toISOString(), grids: [] };

  for (const grid of getGridRecords()) {
    const current = existingMap.get(grid.grid_id);
    const reviewedMap = new Map(
      ((current && current.reports) || []).map((item) => [item.persona_id, item])
    );
    const gridEntry = {
      grid_id: grid.grid_id,
      reports: []
    };
    next.grids.push(gridEntry);
    const transcriptFiles = fs.readdirSync(TRANSCRIPT_DIR)
      .filter((name) => name.startsWith(`${grid.grid_id}_`) && name.endsWith(".json"))
      .sort();

    for (const fileName of transcriptFiles) {
      const transcript = JSON.parse(fs.readFileSync(path.join(TRANSCRIPT_DIR, fileName), "utf8"));
      const existingReport = reviewedMap.get(transcript.persona_id);
      if (existingReport && (existingReport.reviewed === true || existingReport.leakage_check_passed === true)) {
        gridEntry.reports.push(existingReport);
        console.log(`[reports] skip existing ${transcript.persona_id}`);
        continue;
      }
      const generated = await generateReportText(
        transcript.persona_id,
        transcriptToText(transcript.turns || [])
      );
      gridEntry.reports.push({
        persona_id: transcript.persona_id,
        report_text: generated.report_text,
        char_count: generated.char_count,
        leakage_check_passed: generated.leakage_check_passed,
        reviewed: false
      });
      writeJson(OUTPUT_REPORTS, next);
      console.log(`[reports] ${transcript.persona_id} -> ${generated.char_count}`);
    }
    writeJson(OUTPUT_REPORTS, next);
  }

  writeJson(OUTPUT_REPORTS, next);
  console.log(`[reports] wrote ${OUTPUT_REPORTS}`);
}

main().catch((error) => {
  console.error("[reports] failed:", error);
  process.exit(1);
});
