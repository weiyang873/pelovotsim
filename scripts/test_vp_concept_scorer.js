"use strict";

const fs = require("fs");
const path = require("path");

const { chatCompletion } = require("../server/llm/deepseekClient");
const embeddingService = require("../server/llm/embeddingService");
const vpCoach = require("../server/llm/vpCoach");
const {
  scoreVpByConcept,
  scorePreparedVpByConcept,
  prepareVpForConceptScoring,
  rawToScore
} = require("../server/llm/vpConceptScorer");
const { PERSONAS } = require("./test_vp_coach_personas");

const CALIBRATION = [
  { grid: "ToB_Cost_Elder", arch: "Hybrid", vp: "养老院用。老人孤单，员工忙。机器人陪聊。", expected: "差" },
  { grid: "ToC_Diff_Adult", arch: "Experience", vp: "年轻人买，好玩。", expected: "差" },
  { grid: "ToB_Cost_Elder", arch: "Hybrid", vp: "为护工短缺的养老院，提供能陪聊的机器人，让员工能去忙别的事，比请人便宜。失智老人不行。", expected: "中" },
  { grid: "ToC_Diff_Adult", arch: "Experience", vp: "为独居白领，下班回家冷清，提供能主动蹭腿的陪伴机器人，比智能音箱有温度。长期出差不适用。", expected: "中" },
  { grid: "ToB_Cost_Elder", arch: "Hybrid", vp: "为面临护工成本上涨和夜间跌倒高风险的养老机构，提供具备离床监测功能的机器人，通过替代部分人工巡检来优化人力配置并实现风险主动预防——传统依赖人力巡检难以实时响应且成本刚性上涨。失智老人特殊照护单元需结合个性化护理。", expected: "好" },
  { grid: "ToC_Diff_Adult", arch: "Experience", vp: "为25-35岁一线城市独居、每天加班到9点回家只有冰箱声的单身白领，提供一台回家时主动蹭腿发出声音的陪伴机器人，获得不需要维护关系的即时情感连接——智能音箱只能被动问候，养猫狗要喂要遛出差要寄养。长期出差超两周效果打折。", expected: "好" }
];

const SCENARIO_0 = {
  grid: "ToB·差异·成人",
  arch: "混合",
  archEn: "Hybrid",
  persona: "lazy_boss",
  desc: "ToB成人混合-草根老板（灾难复现场景）",
  jinang: { market: ["内容营销"], tech: ["云端运营"] }
};

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

function averageScore(scores) {
  return Number((((scores.C || 0) + (scores.G || 0) + (scores.E || 0)) / 3).toFixed(3));
}

function summarizeBuckets(calibrationResults) {
  const grouped = { "差": [], "中": [], "好": [] };
  for (const item of calibrationResults) {
    grouped[item.expected].push(averageScore(item.result.scores));
  }

  const summary = {};
  for (const [label, values] of Object.entries(grouped)) {
    const avg = values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
    summary[label] = Number(avg.toFixed(3));
  }
  summary.separated = summary["差"] < summary["中"] && summary["中"] < summary["好"];
  return summary;
}

function summarizeRawDistribution(calibrationResults) {
  const allRaws = calibrationResults.flatMap((item) => [
    item.result.details.C_raw,
    item.result.details.G_raw,
    item.result.details.E_raw
  ]);
  const min = Math.min(...allRaws);
  const max = Math.max(...allRaws);
  const mean = allRaws.reduce((sum, value) => sum + value, 0) / allRaws.length;
  return {
    min: Number(min.toFixed(3)),
    max: Number(max.toFixed(3)),
    mean: Number(mean.toFixed(3))
  };
}

function renderHitDetails(details) {
  if (!details || details.length === 0) return "    命中: （无）";
  return details.map((item) => (
    `    "${item.keyword}" → ${item.concept}(sim=${item.sim.toFixed(2)}) ${item.matched ? "✓" : "✗"}`
  )).join("\n");
}

function printMatchBlock(label, block) {
  console.log(`  ${label}: ${block.keywords.length} keywords → ${block.vpHitCount} concept hits → ${block.vpMatchCount} matched anchor (of ${block.anchorHitCount} anchor hits)`);
  console.log(renderHitDetails(block.details));
  console.log(`    vpMatchSimSum=${block.vpMatchSimSum.toFixed(2)}  anchorSimSum=${block.anchorSimSum.toFixed(2)}  score=${block.score.toFixed(2)}`);
}

function printMultiplierScan(calibrationResults) {
  const multipliers = [1.5, 2.0, 2.5, 3.0, 3.5, 4.0];
  console.log("\n====== MULTIPLIER Scan ======");
  console.log("MULT | 差avg | 中avg | 好avg | 间距(好-差)");
  for (const multiplier of multipliers) {
    const grouped = { "差": [], "中": [], "好": [] };
    for (const item of calibrationResults) {
      const rescored = scorePreparedVpByConcept(item.prepared, item.sample.grid, item.sample.arch, { multiplier });
      grouped[item.expected].push(averageScore(rescored.scores));
    }
    const badAvg = grouped["差"].reduce((sum, value) => sum + value, 0) / grouped["差"].length;
    const midAvg = grouped["中"].reduce((sum, value) => sum + value, 0) / grouped["中"].length;
    const goodAvg = grouped["好"].reduce((sum, value) => sum + value, 0) / grouped["好"].length;
    console.log(` ${multiplier.toFixed(1)} | ${badAvg.toFixed(2)} | ${midAvg.toFixed(2)} | ${goodAvg.toFixed(2)} | ${(goodAvg - badAvg).toFixed(2)}`);
  }
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
    const reply = await withRetry("persona reply", () => chatCompletion(messages, {
      temperature: 0.9,
      max_tokens: 150
    }));
    return String(reply || "").trim() || "嗯，继续";
  } catch (_) {
    return "你说呢？";
  }
}

function findPersona(personaId) {
  return PERSONAS.find((item) => item.id === personaId) || null;
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

async function runScenarioZero() {
  const persona = findPersona(SCENARIO_0.persona);
  const session = {
    messages: [],
    strategy: {
      cellLabel: SCENARIO_0.grid,
      architectureLabel: SCENARIO_0.arch,
      architecture: SCENARIO_0.archEn,
      jinang: SCENARIO_0.jinang,
      team_size: 1
    }
  };

  const opening = await withRetry("vpCoach.chat", () => vpCoach.chat(session, "开始", { mode: "chat" }));
  session.messages.push({ role: "user", content: "开始" });
  session.messages.push({ role: "assistant", content: opening.replyText });

  for (let index = 0; index < 4; index += 1) {
    const lastCoachMsg = session.messages.filter((message) => message.role === "assistant").slice(-1)[0]?.content || "";
    const studentReply = await generatePersonaReply(persona, lastCoachMsg, session.messages, SCENARIO_0);
    const coachReply = await withRetry("vpCoach.chat", () => vpCoach.chat(session, studentReply, { mode: "chat" }));
    session.messages.push({ role: "user", content: studentReply });
    session.messages.push({ role: "assistant", content: coachReply.replyText });
  }

  const vp = await withRetry("vpCoach.synthesizeVP", () => vpCoach.synthesizeVP(session));
  const score = await withRetry("vpConceptScorer.scoreVpByConcept", () => scoreVpByConcept(vp.vpText, SCENARIO_0.grid, SCENARIO_0.archEn));

  return {
    persona: persona.label,
    staticOpening: vpCoach.buildStaticOpening(session.strategy),
    systemPrompt: vpCoach.buildSystemPrompt(session.strategy, { chatTurnIndex: 2 }),
    turns: session.messages,
    vp,
    score
  };
}

function formatConversation(messages) {
  return messages.map((message) => `[${message.role === "assistant" ? "AI策略顾问" : "Team"}]\n${message.content}`).join("\n\n---\n\n");
}

async function main() {
  loadLocalEnvFile();
  await embeddingService.init();

  console.log("====== VP Concept Scorer Calibration ======\n");

  const calibrationResults = [];
  for (const sample of CALIBRATION) {
    const prepared = await withRetry("vpConceptScorer.prepareVpForConceptScoring", () => prepareVpForConceptScoring(sample.vp));
    const result = scorePreparedVpByConcept(prepared, sample.grid, sample.arch);
    calibrationResults.push({ expected: sample.expected, sample, prepared, result });

    console.log(`[${sample.expected}] grid=${sample.grid} arch=${sample.arch}`);
    console.log(`  VP: "${sample.vp}"`);
    console.log(`  C=${result.scores.C}  G=${result.scores.G}  E=${result.scores.E}  (C_raw=${result.details.C_raw.toFixed(2)}  G_raw=${result.details.G_raw.toFixed(2)}  E_raw=${result.details.E_raw.toFixed(2)})`);
    printMatchBlock("who", result.details.who);
    printMatchBlock("pain", result.details.pain_se);
    printMatchBlock("how", result.details.how_market);
    if (result.details.alt.hits > 0) {
      printMatchBlock("alt", result.details.alt);
    } else {
      console.log("  alt: (未提供)");
    }
    console.log(`  boundary: ${result.details.boundary_score.toFixed(2)}`);
    console.log();
  }

  const bucketSummary = summarizeBuckets(calibrationResults);
  const rawSummary = summarizeRawDistribution(calibrationResults);
  console.log(`Bucket averages: 差=${bucketSummary["差"]} 中=${bucketSummary["中"]} 好=${bucketSummary["好"]}`);
  console.log(`Three-tier separated: ${bucketSummary.separated ? "YES" : "NO"}`);
  console.log(`Raw distribution: min=${rawSummary.min.toFixed(3)} max=${rawSummary.max.toFixed(3)} mean=${rawSummary.mean.toFixed(3)}`);
  printMultiplierScan(calibrationResults);
  console.log();

  console.log("====== Scenario 0 ======\n");
  const scenarioResult = await runScenarioZero();
  console.log(`Scenario VP: "${scenarioResult.vp.vpText}"`);
  console.log(`Scenario Score: C=${scenarioResult.score.scores.C}  G=${scenarioResult.score.scores.G}  E=${scenarioResult.score.scores.E}`);

  const outputDir = path.join(__dirname, "..", "data", "vp_concept_test_logs");
  const convDir = path.join(outputDir, "conversations");
  fs.mkdirSync(convDir, { recursive: true });

  const timestamp = formatTimestamp(new Date());
  const report = {
    timestamp,
    calibration: calibrationResults.map((item) => ({
      expected: item.expected,
      sample: item.sample,
      result: item.result
    })),
    bucketSummary,
    rawSummary,
    scenario0: scenarioResult
  };

  const reportPath = path.join(outputDir, `report_${timestamp}.json`);
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), "utf8");

  const convPath = path.join(convDir, "scenario_0_ToB_Diff_Adult_lazy_boss.txt");
  fs.writeFileSync(
    convPath,
    `场景：${SCENARIO_0.desc}
Persona：${scenarioResult.persona}

==================================================

[System Prompt]
【静态开场白】
${scenarioResult.staticOpening}

【动态 System Prompt】
${scenarioResult.systemPrompt}

==================================================

[对话记录]
${formatConversation(scenarioResult.turns)}

==================================================

[VP]
${scenarioResult.vp.vpText}

==================================================

[Concept Scorer]
Scores: ${JSON.stringify(scenarioResult.score.scores, null, 2)}
Details: ${JSON.stringify(scenarioResult.score.details, null, 2)}
Fields: ${JSON.stringify(scenarioResult.score.fields, null, 2)}
Feedback:
${scenarioResult.score.feedback}
`,
    "utf8"
  );

  console.log(`Report: ${reportPath}`);
  console.log(`Scenario log: ${convPath}`);
}

main().catch((err) => {
  console.error("test_vp_concept_scorer failed:", err);
  process.exit(1);
});
