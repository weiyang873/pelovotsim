"use strict";

const path = require("node:path");

const {
  GUIDE,
  TRANSCRIPT_DIR,
  DAILY_LANGUAGE_TOPICS,
  compactText,
  parseJsonLoose,
  findLeakageTerms,
  getGridRecords,
  getTopAndBottomDimensions,
  extractQuestionList,
  assessDimensionCoverage,
  readJsonIfExists,
  writeJson,
  runChat
} = require("./offline_report_utils");

const BRIEFS_PATH = path.join(__dirname, "..", "game_config_v0.1", "persona_briefs_v1.json");

function buildTranscriptPrompt(grid, personaRow) {
  const brief = personaRow.brief || {};
  const sourcePersona = personaRow.source_persona || {};
  const weightBands = getTopAndBottomDimensions(grid);
  const highTopics = weightBands.high.map((item) => DAILY_LANGUAGE_TOPICS[item.dim]).filter(Boolean);
  const lowTopics = weightBands.low.map((item) => DAILY_LANGUAGE_TOPICS[item.dim]).filter(Boolean);
  const questions = extractQuestionList();

  return [
    "你要模拟一次完整的深度用户访谈，并输出严格 JSON。",
    "你同时要扮演两个人：专业调研员（researcher）和受访者（respondent）。",
    "调研员必须按给定提纲的顺序推进问题，可以在 2-3 个地方自然追问，但不能跳题、不能给建议、不能使用产品术语或技术词。",
    "受访者必须严格基于画像背景回答，不编造明显超出画像范围的经历。",
    "输出格式只能是 JSON：",
    "{\"turns\":[{\"role\":\"researcher\",\"question_id\":\"Q1\",\"text\":\"...\"},{\"role\":\"respondent\",\"question_id\":\"Q1\",\"text\":\"...\"}]}",
    "总共输出 12-15 个 researcher 回合，respondent 与之交替对应。",
    "respondent 的回答要有具体故事、情绪和情境，不要用产品名、能力名、功能名、技术术语。",
    "",
    `格子：${grid.gridLabel} / ${grid.grid_id}`,
    `市场对象：${grid.whoRaw}`,
    `风格约束：${grid.briefInstruction}`,
    `persona_id：${personaRow.persona_id}`,
    `姓名：${brief.name}`,
    `年龄：${brief.age}`,
    `城市：${brief.city}`,
    `身份：${brief.identity}`,
    `家庭：${brief.family}`,
    `经济：${brief.economic}`,
    `居住：${brief.residence}`,
    `技术接受度：${brief.tech_acceptance}`,
    `性格：${compactText(sourcePersona.personality || "")}`,
    `典型一天：${compactText(sourcePersona.daily_routine || "")}`,
    `表面需求：${(sourcePersona.desires || []).join("；")}`,
    `核心痛点：${(sourcePersona.pains || []).join("；")}`,
    `最深层痛点：${compactText(sourcePersona.hidden_pain || "")}`,
    `矛盾点：${(sourcePersona.contradictions || []).join("；")}`,
    "",
    `你对这些生活话题经历很多、会讲得更细：${highTopics.join("；") || "无"}`,
    `你对这些话题不太在意、容易回答得短：${lowTopics.join("；") || "无"}`,
    "",
    "访谈提纲：",
    JSON.stringify({
      opening: GUIDE.opening,
      questions,
      closing: GUIDE.closing,
      hard_rules: GUIDE.interview_config?.hard_rules || []
    }, null, 2)
  ].join("\n");
}

async function generateTranscript(grid, personaRow) {
  const prompt = buildTranscriptPrompt(grid, personaRow);
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const raw = await runChat([
      {
        role: "system",
        content: "你是专业调研机构的访谈模拟器。请只输出合法 JSON，不要 markdown，不要解释，不要在 JSON 外多写任何字符。"
      },
      {
        role: "user",
        content: `${prompt}\n\n提醒：必须是可被 JSON.parse 直接解析的合法 JSON。`
      }
    ], { temperature: 0.7, max_tokens: 2600 });
    let parsed = null;
    try {
      parsed = parseJsonLoose(raw);
    } catch (error) {
      console.warn(`[interviews] parse regenerate ${personaRow.persona_id}: ${error.message}`);
      continue;
    }
    const turns = Array.isArray(parsed.turns) ? parsed.turns : [];
    const respondentTurns = turns
      .filter((turn) => turn && turn.role === "respondent")
      .map((turn) => compactText(turn.text))
      .join("\n");
    const leakage = findLeakageTerms(respondentTurns);
    if (leakage.length) {
      console.warn(`[interviews] leakage regenerate ${personaRow.persona_id}: ${leakage.join(", ")}`);
      continue;
    }
    return { turns, leakage_matches: [] };
  }
  throw new Error(`transcript generation failed leakage gate: ${personaRow.persona_id}`);
}

async function main() {
  const briefs = readJsonIfExists(BRIEFS_PATH, { grids: [] });
  const briefsMap = new Map((briefs.grids || []).map((item) => [item.grid_id, item]));
  const grids = getGridRecords();

  for (const grid of grids) {
    const row = briefsMap.get(grid.grid_id);
    if (!row) throw new Error(`missing brief for ${grid.grid_id}`);
    for (const personaRow of row.personas || []) {
      const filePath = path.join(TRANSCRIPT_DIR, `${grid.grid_id}_${personaRow.persona_id}.json`);
      if (require("node:fs").existsSync(filePath)) {
        console.log(`[interviews] skip existing ${path.basename(filePath)}`);
        continue;
      }
      const transcript = await generateTranscript(grid, personaRow);
      const coverage = assessDimensionCoverage(transcript.turns);
      writeJson(filePath, {
        persona_id: personaRow.persona_id,
        grid_id: grid.grid_id,
        turns: transcript.turns,
        coverage,
        generated_at: new Date().toISOString()
      });
      console.log(
        `[interviews] ${personaRow.persona_id} coverage ${coverage.coveredCount}/${coverage.totalDimensions}`
      );
    }
  }
}

main().catch((error) => {
  console.error("[interviews] failed:", error);
  process.exit(1);
});
