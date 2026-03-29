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
      const retryable = isRetryableError(err);
      if (!retryable || attempt === retries) {
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

async function callScorer(conversation, grid, arch) {
  return withRetry("vpScorer.scoreVp", () => vpScorer.scoreVp(conversation, grid, arch));
}

async function generatePersonaReply(persona, coachMessage, history, scenario) {
  const recentHistory = history
    .slice(-6)
    .map((message) => `${message.role === "user" ? "学生" : "教练"}：${message.content}`)
    .join("\n");

  const messages = [
    {
      role: "system",
      content: persona.systemPrompt
    },
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
  } catch (err) {
    console.error(`  Persona reply failed: ${err.message}`);
    return "你说呢？";
  }
}

function findBulletLines(text) {
  return String(text || "")
    .split(/\n+/)
    .map((line) => line.trim())
    .filter((line) => /^([-•*]|\d+[.、）])\s+/.test(line));
}

function runChecks(result) {
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

  if (result.scores) {
    const C = Number(result.scores.C);
    const G = Number(result.scores.G);
    const E = Number(result.scores.E);

    checks.scores_not_all_high = !(C > 4.0 && G > 4.0 && E > 4.0);

    if (String(result.persona || "").includes("草根老板")) {
      checks.lazy_boss_scores_reasonable = C <= 3.5 && G <= 3.5;
    }

    checks.c_gte_g_typical = true;
    checks.score_spread = { C, G, E };
  }

  if (result.features) {
    const featureValues = Object.values(result.features);
    const allZero = featureValues.every((value) => value === 0 || value === null);
    const nonNullValues = featureValues.filter((value) => value !== null);
    const allTwo = nonNullValues.length > 0 && nonNullValues.every((value) => value === 2);
    checks.features_not_all_zero = !allZero;
    checks.features_not_all_two = !allTwo;
  }

  return checks;
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
    checks: {},
    scores: null,
    features: null,
    feedback: "",
    scorerRaw: null,
    error: null
  };

  const turn1 = await callCoach(session, "开始", { mode: "chat" });
  session.messages.push({ role: "user", content: "开始" });
  session.messages.push({ role: "assistant", content: turn1.replyText });
  result.turns.push({ role: "coach", content: turn1.replyText });

  for (let i = 0; i < 8; i += 1) {
    const lastCoachMsg = session.messages
      .filter((message) => message.role === "assistant")
      .slice(-1)[0]?.content || "";

    const studentReply = await generatePersonaReply(persona, lastCoachMsg, session.messages, scenario);
    const coachResult = await callCoach(session, studentReply, { mode: "chat" });

    session.messages.push({ role: "user", content: studentReply });
    session.messages.push({ role: "assistant", content: coachResult.replyText });

    result.turns.push({ role: "student", content: studentReply });
    result.turns.push({ role: "coach", content: coachResult.replyText });

    if ((/提交|确认/.test(studentReply) || /提交|确认/.test(coachResult.replyText)) && i >= 4) {
      break;
    }
  }

  const conversation = session.messages
    .map((message) => {
      const tag = message.role === "user" ? "【学生原话】" : "【教练说的】";
      return `${tag}\n${message.content}`;
    })
    .join("\n\n");

  const scoreResult = await callScorer(conversation, scenario.grid, scenario.arch);
  result.scores = scoreResult.scores;
  result.features = scoreResult.features;
  result.feedback = scoreResult.feedback;
  result.scorerRaw = scoreResult.raw || null;
  result.checks = runChecks(result);

  return result;
}

function summarizeCheckCounts(checks) {
  const entries = Object.entries(checks || {}).filter(([, value]) => value !== null);
  const passed = entries.filter(([, value]) => (typeof value === "boolean" ? value : true));
  const failed = entries.filter(([, value]) => typeof value === "boolean" && !value);
  return { passed, failed };
}

function writeScenarioLog(convDir, index, scenario, result) {
  const convFile = conversationFilePath(convDir, index, scenario);
  const turns = Array.isArray(result && result.turns) ? result.turns : [];
  const dialogueText = turns.length > 0
    ? turns
      .map((turn) => `[${turn.role === "coach" ? "AI策略顾问" : "Team"}]\n${turn.content}`)
      .join("\n\n---\n\n")
    : `SCENARIO FAILED\n${result && result.error ? result.error : "No conversation captured."}`;
  const systemPromptText = result && (result.staticOpening || result.systemPrompt)
    ? [
      "【静态开场白】",
      result.staticOpening || "（无）",
      "",
      "【动态 System Prompt】",
      result.systemPrompt || "（无）"
    ].join("\n")
    : "（无 system prompt 记录）";
  const scorerDetailsText = result && result.scores
    ? [
      `Scores: ${JSON.stringify(result.scores, null, 2)}`,
      `Features JSON: ${JSON.stringify(result.features || null, null, 2)}`,
      `Checks: ${JSON.stringify(result.checks || {}, null, 2)}`,
      `Feedback:\n${result.feedback || ""}`,
      `Scorer Raw:\n${JSON.stringify(result.scorerRaw || null, null, 2)}`
    ].join("\n\n")
    : `Error: ${result && result.error ? result.error : "No scorer output."}`;

  fs.writeFileSync(
    convFile,
    `场景：${scenario.desc}\n格子：${scenario.grid}\n架构：${scenario.arch}\nPersona：${result && result.persona ? result.persona : scenario.persona}\n\n${"=".repeat(50)}\n\n[System Prompt]\n${systemPromptText}\n\n${"=".repeat(50)}\n\n[对话记录]\n${dialogueText}\n\n${"=".repeat(50)}\n\n[Scorer 评分详情]\n${scorerDetailsText}`,
    "utf8"
  );
}

async function main() {
  loadLocalEnvFile();

  if (!process.env.DEEPSEEK_API_KEY) {
    throw new Error("DEEPSEEK_API_KEY not set");
  }

  const outputDir = path.join(__dirname, "..", "data", "vp_coach_test_logs");
  const convDir = path.join(outputDir, "conversations");
  fs.mkdirSync(convDir, { recursive: true });

  const timestamp = formatTimestamp(new Date());
  const results = [];

  console.log("\n====== VP Coach Test ======");
  console.log(`${SCENARIOS.length} scenarios x ~8 turns each`);
  console.log(`Estimated time: ${SCENARIOS.length * 2} minutes\n`);

  for (let index = 0; index < SCENARIOS.length; index += 1) {
    const scenario = SCENARIOS[index];
    console.log(`[${index + 1}/${SCENARIOS.length}] ${scenario.desc}`);

    try {
      const result = await runScenario(scenario);
      results.push(result);
      writeScenarioLog(convDir, index, scenario, result);

      const counts = summarizeCheckCounts(result.checks);
      const scores = result.scores || {};

      console.log(`  Scores: C=${scores.C || "?"} G=${scores.G || "?"} E=${scores.E || "?"}`);
      console.log(`  Checks: ${counts.passed.length} passed, ${counts.failed.length} failed`);
      if (counts.failed.length > 0) {
        counts.failed.forEach(([key]) => {
          console.log(`    FAIL ${key}`);
        });
      }
      console.log();
    } catch (err) {
      console.error(`  SCENARIO FAILED: ${err.message}\n`);
      const failedResult = {
        scenario: scenario.desc,
        grid: scenario.grid,
        arch: scenario.arch,
        persona: scenario.persona,
        error: err.message,
        checks: {}
      };
      results.push(failedResult);
      writeScenarioLog(convDir, index, scenario, failedResult);
    }
  }

  const report = {
    timestamp,
    totalScenarios: SCENARIOS.length,
    results,
    summary: {
      totalChecks: 0,
      totalPassed: 0,
      totalFailed: 0,
      failedChecks: []
    }
  };

  for (const result of results) {
    if (!result.checks) continue;
    for (const [key, value] of Object.entries(result.checks)) {
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
    report.summary.failedChecks.forEach((item) => {
      console.log(`  FAIL [${item.scenario}] ${item.check}`);
    });
  }
  console.log(`\nReport: ${reportFile}`);
  console.log(`Conversations: ${convDir}/`);
}

main().catch((err) => {
  console.error("Test runner crashed:", err);
  process.exit(1);
});
