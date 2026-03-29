"use strict";

const fs = require("fs");
const path = require("path");

const { chatCompletion } = require("../server/llm/deepseekClient");
const vpCoach = require("../server/llm/vpCoach");
const vpScorer = require("../server/llm/vpScorer");
const { PERSONAS } = require("./test_vp_coach_personas");

const SCENARIOS = [
  {
    grid: "ToB·差异·成人",
    arch: "混合",
    archEn: "Hybrid",
    persona: "lazy_boss",
    desc: "ToB成人混合-草根老板（灾难复现场景）",
    jinang: { market: ["内容营销"], tech: ["云端运营"] }
  },
  {
    grid: "ToC·差异·儿童",
    arch: "体验",
    archEn: "Experience",
    persona: "mba_pm",
    desc: "ToC儿童体验-互联网PM",
    jinang: { market: ["场景调研"], tech: ["视觉光效"] }
  },
  {
    grid: "ToB·成本·老人",
    arch: "功能",
    archEn: "Function",
    persona: "govt_转型",
    desc: "ToB老人功能-体制转型者",
    jinang: { market: ["政府关系"], tech: ["安全监测"] }
  },
  {
    grid: "ToC·差异·成人",
    arch: "体验",
    archEn: "Experience",
    persona: "sales_dog",
    desc: "ToC成人体验-销售铁军",
    jinang: { market: ["电商运营"], tech: ["情感计算"] }
  },
  {
    grid: "ToB·差异·儿童",
    arch: "混合",
    archEn: "Hybrid",
    persona: "lazy_boss",
    desc: "ToB儿童混合-草根老板（好对话复现）",
    jinang: { market: ["场景调研"], tech: ["视觉光效"] }
  },
  {
    grid: "ToC·成本·成人",
    arch: "功能",
    archEn: "Function",
    persona: "mba_pm",
    desc: "ToC成人功能-互联网PM",
    jinang: { market: ["渠道分销"], tech: ["语音交互"] }
  }
];

const ACTIVE_SCENARIOS = SCENARIOS;

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
  return path.join(
    convDir,
    `scenario_${index}_${gridToFileTag(scenario.grid)}_${scenario.persona}.txt`
  );
}

function findPersona(personaId) {
  return PERSONAS.find((item) => item.id === personaId) || null;
}

async function callCoach(session, userMessage, options = {}) {
  return withRetry("vpCoach.chat", () => vpCoach.chat(session, userMessage, options));
}

async function callSynthesize(session) {
  return withRetry("vpCoach.synthesizeVP", () => vpCoach.synthesizeVP(session));
}

async function callScoreVpText(vpText, grid, arch) {
  return withRetry("vpScorer.scoreVpText", () => vpScorer.scoreVpText(vpText, grid, arch));
}

async function generatePersonaReply(persona, coachMessage, history, scenario) {
  const recentHistory = history
    .slice(-6)
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

async function generatePersonaReplyWithFeedback(persona, coachMessage, history, scenario, scoreFeedback) {
  const recentHistory = history
    .slice(-6)
    .map((message) => `${message.role === "user" ? "学生" : "教练"}：${message.content}`)
    .join("\n");

  const messages = [
    { role: "system", content: persona.systemPrompt },
    {
      role: "user",
      content: `你正在和 AI 策略顾问讨论你们团队的价值主张。

你们选的市场方向：${scenario.grid}
产品定位：${scenario.arch}型

你刚看了评分反馈，系统告诉你：
"${scoreFeedback}"

讨论的核心是三个方面：
1. 目标客户是谁——越具体越好
2. 痛点是什么——要描述具体场景和频率
3. LOVOT 怎么解决——要说清具体机制和因果链

最近对话：
${recentHistory || "（暂无）"}

教练刚说的：
「${coachMessage || "继续"}」

根据评分反馈，尝试补充你之前没说到的信息。用你自然的方式回复。`
    }
  ];

  try {
    const reply = await withRetry("persona feedback reply", () => chatCompletion(messages, {
      temperature: 0.9,
      max_tokens: 150
    }));
    return String(reply || "").trim() || "嗯，继续";
  } catch (_) {
    return "你说呢？";
  }
}

function findBulletLines(text) {
  return String(text || "")
    .split(/\n+/)
    .map((line) => line.trim())
    .filter((line) => /^([-•*]|\d+[.、）])\s+/.test(line));
}

function runCoachChecks(result) {
  const checks = {};
  const firstCoach = result.turns[0] && result.turns[0].content ? result.turns[0].content : "";
  const allCoachTurns = result.turns.filter((turn) => turn.role === "coach").map((turn) => turn.content);

  checks.opening_has_vacuum_example = /扫地机器人/.test(firstCoach);

  const jinangKeywords = []
    .concat(result.jinang && Array.isArray(result.jinang.market) ? result.jinang.market : [])
    .concat(result.jinang && Array.isArray(result.jinang.tech) ? result.jinang.tech : []);
  checks.opening_mentions_jinang = /锦囊|能力/.test(firstCoach) || jinangKeywords.some((keyword) => firstCoach.includes(keyword));

  const coachAfterFirst = allCoachTurns.slice(1);
  checks.no_lovot_option_lists = !coachAfterFirst.some((text) => {
    const bullets = text.match(/[-•]\s*.{4,}|^\d[.、）]\s*.{4,}/gm) || [];
    const sceneKeywords = ["诊所", "养老", "幼儿园", "酒店", "银行", "科技公司", "学校", "医院", "商场", "健身房", "月子中心"];
    const matchedScenes = new Set();
    bullets.forEach((bullet) => {
      sceneKeywords.forEach((keyword) => {
        if (bullet.includes(keyword)) matchedScenes.add(keyword);
      });
    });
    return matchedScenes.size >= 3;
  });

  const vpPatterns = allCoachTurns.map((text, index) => {
    const hasQuotedVp = /["“][^"”]{30,}["”]/.test(text);
    const hasVpStructure = /为.{4,}(提供|解决|缓解|降低)/.test(text);
    return { turn: index, hasVp: hasQuotedVp || hasVpStructure };
  });
  const firstVPTurn = vpPatterns.findIndex((item) => item.hasVp);
  checks.coach_synthesizes_vp = firstVPTurn >= 0;
  checks.coach_synthesizes_vp_within_5 = firstVPTurn >= 0 && firstVPTurn <= 5;

  if (String(result.grid || "").includes("ToB")) {
    checks.tob_institution_reminder = allCoachTurns.some((text) =>
      /机构|企业.{0,4}客户|不是.{0,4}(终端|消费者|个人)|买单的是/.test(text)
    );
  } else {
    checks.tob_institution_reminder = null;
  }

  const multiQuestionTurns = coachAfterFirst.filter((text) => {
    const questions = (text.match(/[？?]/g) || []).length;
    return questions > 2;
  });
  checks.single_question_per_turn = multiQuestionTurns.length <= 1;

  return checks;
}

function runChecks(result, persona) {
  const checks = runCoachChecks(result);
  const vpV1Text = String(result.vpV1 && result.vpV1.vpText ? result.vpV1.vpText : "");
  const vpV2Text = String(result.vpV2 && result.vpV2.vpText ? result.vpV2.vpText : "");
  const scoresV1 = result.scoreV1 && result.scoreV1.scores ? result.scoreV1.scores : { C: 0, G: 0, E: 0 };
  const scoresV2 = result.scoreV2 && result.scoreV2.scores ? result.scoreV2.scores : { C: 0, G: 0, E: 0 };
  const featuresV2 = result.scoreV2 && result.scoreV2.features ? result.scoreV2.features : null;

  checks.vp_v1_not_empty = vpV1Text.length > 30;
  checks.vp_v2_not_empty = vpV2Text.length > 30;
  checks.vp_improved = vpV1Text !== vpV2Text;
  checks.scores_improved_or_stable =
    (scoresV2.C + scoresV2.G + scoresV2.E) >= (scoresV1.C + scoresV1.G + scoresV1.E) - 0.5;

  if (persona.id === "lazy_boss") {
    checks.lazy_boss_v1_not_inflated = scoresV1.C <= 3.5 && scoresV1.G <= 3.5;
  }

  checks.vp_v2_complete = !vpV2Text.includes("待补充");
  const vpMentionsBoundary = /不管用|不适用|打折扣|除外|但.*时|局限/.test(vpV2Text);
  checks.boundary_feature_matches_vp = Boolean(featuresV2) && (vpMentionsBoundary === (featuresV2.has_boundary >= 1));

  return checks;
}

function summarizeCheckCounts(checks) {
  const entries = Object.entries(checks || {}).filter(([, value]) => value !== null);
  const passed = entries.filter(([, value]) => (typeof value === "boolean" ? value : true));
  const failed = entries.filter(([, value]) => typeof value === "boolean" && !value);
  return { passed, failed };
}

function formatTurns(turns) {
  return turns
    .map((turn) => `[${turn.role === "coach" ? "AI策略顾问" : "Team"}]\n${turn.content}`)
    .join("\n\n---\n\n");
}

function formatCheckLines(checks) {
  return Object.entries(checks || {})
    .filter(([, value]) => value !== null)
    .map(([key, value]) => `${typeof value === "boolean" ? (value ? "PASS" : "FAIL") : "INFO"} ${key}${typeof value === "boolean" ? "" : ` = ${JSON.stringify(value)}`}`)
    .join("\n");
}

function writeScenarioLog(convDir, index, scenario, result) {
  const convFile = conversationFilePath(convDir, index, scenario);
  const systemPromptText = [
    "【静态开场白】",
    result.staticOpening || "（无）",
    "",
    "【动态 System Prompt】",
    result.systemPrompt || "（无）"
  ].join("\n");

  const vpV1Text = [
    `VP Text: ${result.vpV1 && result.vpV1.vpText ? result.vpV1.vpText : ""}`,
    `Synthesize Raw: ${JSON.stringify(result.vpV1 && result.vpV1.raw ? result.vpV1.raw : "", null, 2)}`,
    `Scores: ${JSON.stringify(result.scoreV1 && result.scoreV1.scores ? result.scoreV1.scores : null, null, 2)}`,
    `Features: ${JSON.stringify(result.scoreV1 && result.scoreV1.features ? result.scoreV1.features : null, null, 2)}`,
    `Feedback:\n${result.scoreV1 && result.scoreV1.feedback ? result.scoreV1.feedback : ""}`,
    `Raw: ${JSON.stringify(result.scoreV1 && result.scoreV1.raw ? result.scoreV1.raw : null, null, 2)}`
  ].join("\n\n");

  const vpV2Text = [
    `VP Text: ${result.vpV2 && result.vpV2.vpText ? result.vpV2.vpText : ""}`,
    `Synthesize Raw: ${JSON.stringify(result.vpV2 && result.vpV2.raw ? result.vpV2.raw : "", null, 2)}`,
    `Scores: ${JSON.stringify(result.scoreV2 && result.scoreV2.scores ? result.scoreV2.scores : null, null, 2)}`,
    `Features: ${JSON.stringify(result.scoreV2 && result.scoreV2.features ? result.scoreV2.features : null, null, 2)}`,
    `Feedback:\n${result.scoreV2 && result.scoreV2.feedback ? result.scoreV2.feedback : ""}`,
    `Raw: ${JSON.stringify(result.scoreV2 && result.scoreV2.raw ? result.scoreV2.raw : null, null, 2)}`
  ].join("\n\n");

  const finalVpText = [
    `VP Text: ${result.finalVp && result.finalVp.vpText ? result.finalVp.vpText : ""}`,
    `Synthesize Raw: ${JSON.stringify(result.finalVp && result.finalVp.raw ? result.finalVp.raw : "", null, 2)}`
  ].join("\n\n");

  fs.writeFileSync(
    convFile,
    `场景：${scenario.desc}
格子：${scenario.grid}
架构：${scenario.arch}
Persona：${result.persona}

${"=".repeat(50)}

[System Prompt]
${systemPromptText}

${"=".repeat(50)}

[对话记录]
${formatTurns(result.turns || [])}

${"=".repeat(50)}

[VP v1]
${vpV1Text}

${"=".repeat(50)}

[VP v2]
${vpV2Text}

${"=".repeat(50)}

[最终 VP]
${finalVpText}

${"=".repeat(50)}

[Checks]
${formatCheckLines(result.checks || {})}`,
    "utf8"
  );
}

async function runScenario(scenario) {
  const persona = findPersona(scenario.persona);
  if (!persona) {
    throw new Error(`Persona not found: ${scenario.persona}`);
  }

  const session = {
    messages: [],
    strategy: {
      cellLabel: scenario.grid,
      architectureLabel: scenario.arch,
      architecture: scenario.archEn,
      jinang: {
        market: scenario.jinang.market,
        tech: scenario.jinang.tech
      },
      team_size: 1
    }
  };

  const result = {
    scenario: scenario.desc,
    grid: scenario.grid,
    arch: scenario.arch,
    persona: persona.label,
    personaId: persona.id,
    jinang: scenario.jinang,
    systemPrompt: vpCoach.buildSystemPrompt(session.strategy, { chatTurnIndex: 2 }),
    staticOpening: vpCoach.buildStaticOpening(session.strategy),
    turns: [],
    vpV1: null,
    vpV2: null,
    finalVp: null,
    scoreV1: null,
    scoreV2: null,
    checks: {},
    error: null
  };

  const turn1 = await callCoach(session, "开始", { mode: "chat" });
  session.messages.push({ role: "user", content: "开始" });
  session.messages.push({ role: "assistant", content: turn1.replyText });
  result.turns.push({ role: "coach", content: turn1.replyText });

  for (let i = 0; i < 4; i += 1) {
    const lastCoachMsg = session.messages.filter((message) => message.role === "assistant").slice(-1)[0]?.content || "";
    const studentReply = await generatePersonaReply(persona, lastCoachMsg, session.messages, scenario);
    const coachResult = await callCoach(session, studentReply, { mode: "chat" });

    session.messages.push({ role: "user", content: studentReply });
    session.messages.push({ role: "assistant", content: coachResult.replyText });
    result.turns.push({ role: "student", content: studentReply });
    result.turns.push({ role: "coach", content: coachResult.replyText });
  }

  result.vpV1 = await callSynthesize(session);
  result.scoreV1 = await callScoreVpText(result.vpV1.vpText, scenario.grid, scenario.arch);

  for (let i = 0; i < 3; i += 1) {
    const lastCoachMsg = session.messages.filter((message) => message.role === "assistant").slice(-1)[0]?.content || "";
    const studentReply = await generatePersonaReplyWithFeedback(
      persona,
      lastCoachMsg,
      session.messages,
      scenario,
      result.scoreV1.feedback
    );
    const coachResult = await callCoach(session, studentReply, { mode: "chat" });

    session.messages.push({ role: "user", content: studentReply });
    session.messages.push({ role: "assistant", content: coachResult.replyText });
    result.turns.push({ role: "student", content: studentReply });
    result.turns.push({ role: "coach", content: coachResult.replyText });
  }

  result.vpV2 = await callSynthesize(session);
  result.scoreV2 = await callScoreVpText(result.vpV2.vpText, scenario.grid, scenario.arch);
  result.finalVp = await callSynthesize(session);
  result.checks = runChecks(result, persona);

  return result;
}

async function main() {
  loadLocalEnvFile();

  if (!process.env.DEEPSEEK_API_KEY) {
    throw new Error("DEEPSEEK_API_KEY not set");
  }

  const outputDir = path.join(__dirname, "..", "data", "vp_coach_test_logs_v2");
  const convDir = path.join(outputDir, "conversations");
  fs.mkdirSync(convDir, { recursive: true });

  const timestamp = formatTimestamp(new Date());
  const results = [];

  console.log("\n====== VP Coach V2 Test ======");
  console.log(`${ACTIVE_SCENARIOS.length} scenarios`);
  console.log("Flow: chat -> synthesize -> score -> chat -> synthesize -> score -> submit\n");

  for (let index = 0; index < ACTIVE_SCENARIOS.length; index += 1) {
    const scenario = ACTIVE_SCENARIOS[index];
    console.log(`[${index + 1}/${ACTIVE_SCENARIOS.length}] ${scenario.desc}`);

    try {
      const result = await runScenario(scenario);
      results.push(result);
      writeScenarioLog(convDir, index, scenario, result);

      const counts = summarizeCheckCounts(result.checks);
      const v1 = result.scoreV1 && result.scoreV1.scores ? result.scoreV1.scores : {};
      const v2 = result.scoreV2 && result.scoreV2.scores ? result.scoreV2.scores : {};

      console.log(`  VP v1: ${result.vpV1.vpText}`);
      console.log(`  Scores v1: C=${v1.C || "?"} G=${v1.G || "?"} E=${v1.E || "?"}`);
      console.log(`  VP v2: ${result.vpV2.vpText}`);
      console.log(`  Scores v2: C=${v2.C || "?"} G=${v2.G || "?"} E=${v2.E || "?"}`);
      console.log(`  Final VP: ${result.finalVp.vpText}`);
      console.log(`  Checks: ${counts.passed.length} passed, ${counts.failed.length} failed`);
      if (counts.failed.length > 0) {
        counts.failed.forEach(([key]) => console.log(`    FAIL ${key}`));
      }
      console.log();
    } catch (err) {
      console.error(`  SCENARIO FAILED: ${err.message}\n`);
      const failedResult = {
        scenario: scenario.desc,
        grid: scenario.grid,
        arch: scenario.arch,
        persona: scenario.persona,
        turns: [],
        checks: {},
        error: err.message
      };
      results.push(failedResult);
      writeScenarioLog(convDir, index, scenario, failedResult);
    }
  }

  const report = {
    timestamp,
    totalScenarios: ACTIVE_SCENARIOS.length,
    results,
    summary: {
      totalChecks: 0,
      totalPassed: 0,
      totalFailed: 0,
      failedChecks: []
    }
  };

  for (const result of results) {
    for (const [key, value] of Object.entries(result.checks || {})) {
      if (value === null || typeof value !== "boolean") continue;
      report.summary.totalChecks += 1;
      if (value) {
        report.summary.totalPassed += 1;
      } else {
        report.summary.totalFailed += 1;
        report.summary.failedChecks.push({ scenario: result.scenario, check: key });
      }
    }
  }

  const reportFile = path.join(outputDir, `report_${timestamp}.json`);
  fs.writeFileSync(reportFile, JSON.stringify(report, null, 2), "utf8");

  console.log("=".repeat(50));
  console.log(`SUMMARY: ${report.summary.totalPassed}/${report.summary.totalChecks} checks passed`);
  if (report.summary.totalFailed > 0) {
    console.log("\nFailed checks:");
    report.summary.failedChecks.forEach((item) => console.log(`  FAIL [${item.scenario}] ${item.check}`));
  }
  console.log(`\nReport: ${reportFile}`);
  console.log(`Conversations: ${convDir}/`);
}

main().catch((err) => {
  console.error("Test runner crashed:", err);
  process.exit(1);
});
