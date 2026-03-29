"use strict";

const fs = require("fs");
const path = require("path");

const { chatCompletion } = require("../server/llm/deepseekClient");
const vpCoach = require("../server/llm/vpCoach");
const vpScorer = require("../server/llm/vpScorer");
const { scoreVpByEmbedding } = require("../server/llm/vpEmbeddingScorer");
const { PERSONAS } = require("./test_vp_coach_personas");

const SCENARIOS = [
  {
    grid: "ToB·差异·成人",
    arch: "混合",
    archEn: "Hybrid",
    persona: "lazy_boss",
    desc: "ToB成人混合-草根老板（灾难复现场景）",
    jinang: { market: ["内容营销"], tech: ["云端运营"] }
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
    if ((value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
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
      if (!isRetryableError(err) || attempt === retries) throw err;
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

function gridToFileTag(grid) {
  return String(grid || "")
    .replace(/ToB/g, "ToB")
    .replace(/ToC/g, "ToC")
    .replace(/差异/g, "Diff")
    .replace(/成本/g, "Cost")
    .replace(/成人/g, "Adult")
    .replace(/儿童/g, "Child")
    .replace(/老人/g, "Elder")
    .replace(/[·]/g, "_")
    .replace(/[^\w-]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "");
}

function conversationFilePath(convDir, index, scenario) {
  return path.join(convDir, `scenario_${index}_${gridToFileTag(scenario.grid)}_${scenario.persona}.txt`);
}

function findPersona(personaId) {
  return PERSONAS.find((item) => item.id === personaId) || null;
}

async function generatePersonaReply(persona, coachMessage, history, scenario) {
  const recentHistory = history.slice(-6)
    .map((message) => `${message.role === "user" ? "学生" : "教练"}：${message.content}`)
    .join("\n");

  const messages = [
    { role: "system", content: persona.systemPrompt },
    {
      role: "user",
      content: `你正在和 AI 策略顾问讨论你们团队的价值主张。

你们选的市场方向：${scenario.grid}
产品定位：${scenario.arch}型

最近对话：
${recentHistory || "（暂无）"}

教练刚说的：
「${coachMessage || "开始"}」

用你自然的方式回复。`
    }
  ];

  try {
    const reply = await withRetry("persona reply", () => chatCompletion(messages, { temperature: 0.9, max_tokens: 150 }));
    return String(reply || "").trim() || "嗯，继续";
  } catch (_) {
    return "你说呢？";
  }
}

async function runScenario(scenario) {
  const persona = findPersona(scenario.persona);
  const session = {
    messages: [],
    strategy: {
      cellLabel: scenario.grid,
      architectureLabel: scenario.arch,
      architecture: scenario.archEn,
      jinang: scenario.jinang,
      team_size: 1
    }
  };

  const result = {
    scenario: scenario.desc,
    persona: persona.label,
    systemPrompt: vpCoach.buildSystemPrompt(session.strategy, { chatTurnIndex: 2 }),
    staticOpening: vpCoach.buildStaticOpening(session.strategy),
    turns: [],
    vp: null,
    llmScore: null,
    embeddingScore: null
  };

  const opening = await withRetry("vpCoach.chat", () => vpCoach.chat(session, "开始", { mode: "chat" }));
  session.messages.push({ role: "user", content: "开始" });
  session.messages.push({ role: "assistant", content: opening.replyText });
  result.turns.push({ role: "coach", content: opening.replyText });

  for (let i = 0; i < 4; i += 1) {
    const lastCoachMsg = session.messages.filter((message) => message.role === "assistant").slice(-1)[0]?.content || "";
    const studentReply = await generatePersonaReply(persona, lastCoachMsg, session.messages, scenario);
    const coachResult = await withRetry("vpCoach.chat", () => vpCoach.chat(session, studentReply, { mode: "chat" }));
    session.messages.push({ role: "user", content: studentReply });
    session.messages.push({ role: "assistant", content: coachResult.replyText });
    result.turns.push({ role: "student", content: studentReply });
    result.turns.push({ role: "coach", content: coachResult.replyText });
  }

  result.vp = await withRetry("vpCoach.synthesizeVP", () => vpCoach.synthesizeVP(session));
  result.llmScore = await withRetry("vpScorer.scoreVpText", () => vpScorer.scoreVpText(result.vp.vpText, scenario.grid, scenario.arch));
  result.embeddingScore = await withRetry("vpEmbeddingScorer.scoreVpByEmbedding", () => scoreVpByEmbedding(result.vp.vpText, scenario.grid, scenario.archEn));
  return result;
}

function formatTurns(turns) {
  return turns.map((turn) => `[${turn.role === "coach" ? "AI策略顾问" : "Team"}]\n${turn.content}`).join("\n\n---\n\n");
}

function writeScenarioLog(convDir, index, scenario, result) {
  const filePath = conversationFilePath(convDir, index, scenario);
  fs.writeFileSync(
    filePath,
    `场景：${scenario.desc}
Persona：${result.persona}

==================================================

[System Prompt]
【静态开场白】
${result.staticOpening}

【动态 System Prompt】
${result.systemPrompt}

==================================================

[对话记录]
${formatTurns(result.turns)}

==================================================

[VP]
${result.vp.vpText}

==================================================

[LLM Scorer]
Scores: ${JSON.stringify(result.llmScore.scores, null, 2)}
Features: ${JSON.stringify(result.llmScore.features, null, 2)}
Feedback:
${result.llmScore.feedback}

==================================================

[Embedding Scorer]
Scores: ${JSON.stringify(result.embeddingScore.scores, null, 2)}
Details: ${JSON.stringify(result.embeddingScore.details, null, 2)}
Fields: ${JSON.stringify(result.embeddingScore.fields, null, 2)}
Feedback:
${result.embeddingScore.feedback}`,
    "utf8"
  );
}

async function main() {
  loadLocalEnvFile();
  const outputDir = path.join(__dirname, "..", "data", "vp_embedding_test_logs");
  const convDir = path.join(outputDir, "conversations");
  fs.mkdirSync(convDir, { recursive: true });

  const timestamp = formatTimestamp(new Date());
  const results = [];

  console.log("\n====== VP Embedding Scorer Test ======");
  console.log(`${SCENARIOS.length} scenarios\n`);

  for (let index = 0; index < SCENARIOS.length; index += 1) {
    const scenario = SCENARIOS[index];
    console.log(`[${index + 1}/${SCENARIOS.length}] ${scenario.desc}`);
    const result = await runScenario(scenario);
    results.push(result);
    writeScenarioLog(convDir, index, scenario, result);
    console.log(`  VP: "${result.vp.vpText}"`);
    console.log(`  LLM Scorer:      C=${result.llmScore.scores.C}  G=${result.llmScore.scores.G}  E=${result.llmScore.scores.E}`);
    console.log(`  Embedding Scorer: C=${result.embeddingScore.scores.C}  G=${result.embeddingScore.scores.G}  E=${result.embeddingScore.scores.E}`);
    console.log(`  Details: who_sim=${result.embeddingScore.details.who_sim.toFixed(2)} pain_top1={sim:${result.embeddingScore.details.pain_top2[0].sim.toFixed(2)},w:${result.embeddingScore.details.pain_top2[0].weight}} ...\n`);
  }

  const reportFile = path.join(outputDir, `report_${timestamp}.json`);
  fs.writeFileSync(reportFile, JSON.stringify({ timestamp, results }, null, 2), "utf8");
  console.log(`Report: ${reportFile}`);
  console.log(`Conversations: ${convDir}/`);
}

main().catch((err) => {
  console.error("test_vp_embedding_scorer failed:", err);
  process.exit(1);
});
