const fs = require("node:fs");
const path = require("node:path");
const { expect } = require("@playwright/test");
const { assertStable, countDOMMutations } = require("./stabilityChecker");

const STUDENT_SESSION_KEY = "emba_student_session_v1";
const ROUND1_TEAM_NAME = "Playwright E2E Team";
const ROUND1_VP_DRAFT = "独居城市白领 在下班回家后感到孤独和情绪低落 通过LOVOT的主动迎接和情感交互获得陪伴感";
const JINANG_FLIP_LABEL = "点击翻开";
const JINANG_FLIP_ANIMATION_MS = 350;
const ROUND2_REPLY_TIMEOUT_MS = Number(process.env.E2E_ROUND2_REPLY_TIMEOUT_MS || 150000);
const TEAM_POLL_IGNORE_URLS = ["/status", "/phase3/state", "/round2/state", "/round2/interview/session", "/round2/team-merge"];
const ROUND1_COACH_MESSAGES = [
  "我们的目标用户是独居城市白领",
  "痛点是下班后的孤独感"
];
const ROUND2_INTERVIEW_SCRIPT = [
  "我觉得老人最担心的是跌倒后没人发现，需要自动报警功能",
  "充电要方便，最好能自动回充电座，老人不会操作复杂的东西",
  "如果能自动提醒吃药和联系家属，会更安心",
  "设备最好不要太复杂，语音就能操作",
  "老人会担心误报，所以提醒要准确"
];

function normalizeText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function resolveBaseUrl() {
  return process.env.BASE_URL || process.env.TEST_URL || "http://localhost:8787";
}

function pushStepResult(stepResults, name, startedAt, passed, monitor, tracker, extra = {}, error = null) {
  const consoleReport = monitor.getReport();
  const calls = tracker.getCalls();
  stepResults.push({
    name,
    duration_ms: Date.now() - startedAt,
    console: {
      errors: consoleReport.errors,
      warnings: consoleReport.warnings,
      reactKeyWarnings: consoleReport.reactKeyWarnings,
      stateAfterUnmount: consoleReport.stateAfterUnmount
    },
    network: {
      requests: calls.map((call) => ({
        url: call.url,
        method: call.method,
        status: call.status,
        duration_ms: call.duration_ms,
        cancelled: call.cancelled
      })),
      duplicates: consoleReport.duplicateApiFetches,
      cancelled: calls.filter((call) => call.cancelled).map((call) => call.url)
    },
    stability: {
      domMutations: Number(extra.domMutations || 0),
      flicker: Boolean(extra.flicker)
    },
    passed,
    error: error ? String(error.message || error) : null
  });
}

function createStepRunner({ page, monitor, tracker, stepResults }) {
  return async function runStep(name, fn) {
    console.log(`[E2E] START ${name}`);
    monitor.reset();
    tracker.reset();
    const startedAt = Date.now();
    try {
      const extra = await fn();
      pushStepResult(stepResults, name, startedAt, true, monitor, tracker, extra);
      console.log(`[E2E] PASS ${name}`);
      return extra;
    } catch (error) {
      pushStepResult(stepResults, name, startedAt, false, monitor, tracker, {}, error);
      console.log(`[E2E] FAIL ${name}: ${error.message || error}`);
      throw error;
    }
  };
}

function logProgress(onProgress, label) {
  if (typeof onProgress === "function") {
    onProgress(label);
  }
}

async function bootstrapSinglePlayerTeam(page, tracker, options = {}) {
  const teamSize = Math.max(1, Number(options.teamSize || 1));
  const teamName = String(options.teamName || `${ROUND1_TEAM_NAME} ${Date.now()}`).trim();
  await page.goto("/multiplayer?entry=1");
  await page.waitForLoadState("domcontentloaded");

  tracker.startCapture();
  const created = await page.evaluate(async ({ nextTeamName, nextTeamSize }) => {
    const response = await fetch("/api/team/create", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ teamName: nextTeamName, teamSize: nextTeamSize })
    });
    const data = await response.json();
    if (!data.ok) {
      throw new Error(data.error || "team create failed");
    }
    const teamId = data.team?.id || "";
    const memberId = data.member_links?.[0]?.member_id || "";
    const members = Array.isArray(data.member_links) ? data.member_links.map((member, index) => ({
      id: String(member.member_id || "").trim(),
      name: String(member.member_name || `成员${index + 1}`).trim(),
      index: Number(member.member_index || index + 1)
    })) : [];
    localStorage.setItem("emba_student_session_v1", JSON.stringify({
      teamId,
      memberId,
      entryMode: "trial"
    }));
    return {
      teamId,
      memberId,
      members
    };
  }, {
    nextTeamName: teamName,
    nextTeamSize: teamSize
  });
  await tracker.waitForSettled(600);

  // MultiplayerFlow resolves trial mode from localStorage; URL only needs the target step.
  await page.goto("/multiplayer?step=1");
  await expect(page.locator("[data-testid='jinang-market-card']").getByText(JINANG_FLIP_LABEL, { exact: true })).toBeVisible({ timeout: 30000 });
  await expect(page.locator("[data-testid='jinang-tech-card']").getByText(JINANG_FLIP_LABEL, { exact: true })).toBeVisible({ timeout: 30000 });
  return created;
}

async function bootstrapTrialTeamViaUi(page, { teamName = "", teamSize = 6 } = {}) {
  await page.goto("/multiplayer");
  await page.waitForLoadState("domcontentloaded");
  await page.getByTestId("entry-trial-btn").click();
  await expect(page.getByTestId(`team-size-${teamSize}`)).toBeVisible({ timeout: 30000 });
  await page.locator("input").first().fill(teamName || `${ROUND1_TEAM_NAME} ${Date.now()}`);
  await page.getByTestId(`team-size-${teamSize}`).click();

  const createResponsePromise = page.waitForResponse((response) =>
    response.url().includes("/api/team/create") && response.request().method() === "POST"
  );
  await page.getByTestId("team-create-btn").click();
  const createResponse = await createResponsePromise;
  expect(createResponse.status()).toBe(200);
  const createData = await createResponse.json();
  expect(createData?.ok).toBeTruthy();
  await expect(page.locator("[data-testid='jinang-market-card']")).toBeVisible({ timeout: 30000 });

  const members = Array.isArray(createData?.member_links) ? createData.member_links : [];
  expect(members).toHaveLength(teamSize);

  return {
    teamId: String(createData?.team?.id || "").trim(),
    memberId: String(members[0]?.member_id || "").trim(),
    members: members.map((member, index) => ({
      id: String(member.member_id || "").trim(),
      name: String(member.member_name || `成员${index + 1}`).trim(),
      index: Number(member.member_index || index + 1)
    }))
  };
}

async function writeStudentSession(page, session) {
  await page.evaluate(({ key, nextSession }) => {
    window.localStorage.setItem(key, JSON.stringify(nextSession));
  }, {
    key: STUDENT_SESSION_KEY,
    nextSession: session
  });
}

async function openRound1ForMember(page, { teamId, memberId, studentName = "", entryMode = "trial", step = 1 }) {
  await page.goto("/multiplayer");
  await page.waitForLoadState("domcontentloaded");
  await writeStudentSession(page, { teamId, memberId, entryMode, studentName });
  await page.goto(`/multiplayer?memberId=${encodeURIComponent(memberId)}&step=${step}`);
  await page.waitForLoadState("domcontentloaded");
}

async function submitRound1PersonalChoice(page, {
  teamId,
  memberId,
  memberName,
  gridTestId,
  architectureTestId,
  vpDraft
}) {
  await openRound1ForMember(page, { teamId, memberId, studentName: memberName, step: 1 });
  if (memberName) {
    await expect(page.getByText(memberName, { exact: true }).first()).toBeVisible({ timeout: 30000 });
  }
  await expect(page.locator("[data-testid='jinang-market-card']")).toBeVisible({ timeout: 30000 });
  console.log(`[E2E] R1 member submit start: ${memberName || memberId}`);
  await revealJinangCard(page, "[data-testid='jinang-market-card']");
  await revealJinangCard(page, "[data-testid='jinang-tech-card']");
  const continueButton = page.locator("[data-testid='jinang-continue-btn']");
  await expect(continueButton).toBeEnabled({ timeout: 15000 });
  console.log(`[E2E] R1 jinang ready: ${memberName || memberId}`);
  await continueButton.click();
  await expect(page.locator(`[data-testid='${gridTestId}']`)).toBeVisible({ timeout: 30000 });
  await page.locator(`[data-testid='${gridTestId}']`).click();
  await page.locator(`[data-testid='${architectureTestId}']`).click();
  await page.locator("[data-testid='vp-draft-input']").fill(vpDraft);
  await page.locator("[data-testid='round1-personal-submit-btn']").click();
  await expect
    .poll(async () => {
      if (await page.locator("[data-testid='r1-distribution-container']").count()) return "distribution";
      const submitButton = page.locator("[data-testid='round1-personal-submit-btn']").first();
      if (await submitButton.count()) {
        const text = await submitButton.innerText().catch(() => "");
        if (text.includes("已提交")) return "submitted";
      }
      return "pending";
    }, {
      timeout: 60000,
      intervals: [500, 1000, 2000]
    })
    .not.toBe("pending");
}

async function revealJinangCard(page, selector) {
  const card = page.locator(selector);
  const flipPrompt = card.getByText(JINANG_FLIP_LABEL, { exact: true });
  const continueButton = page.locator("[data-testid='jinang-continue-btn']");

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    if (!(await flipPrompt.isVisible().catch(() => false))) {
      break;
    }
    console.log(`[E2E] Flip ${selector} attempt ${attempt}`);
    await expect(flipPrompt).toBeVisible({ timeout: 30000 });
    await card.click();
    await page.waitForTimeout(JINANG_FLIP_ANIMATION_MS);
    if (!(await flipPrompt.isVisible().catch(() => false))) {
      break;
    }
  }
  await expect(flipPrompt).toBeHidden({ timeout: 10000 });
  await expect(card).toBeVisible({ timeout: 10000 });
  await continueButton.waitFor({ state: "visible", timeout: 10000 }).catch(() => {});
}

async function clickAll(locator) {
  const count = await locator.count();
  for (let index = 0; index < count; index += 1) {
    await locator.nth(index).click();
  }
}

async function setRangeValue(page, selector, value) {
  await page.locator(selector).evaluate((node, nextValue) => {
    node.value = String(nextValue);
    node.dispatchEvent(new Event("input", { bubbles: true }));
    node.dispatchEvent(new Event("change", { bubbles: true }));
  }, value);
}

function findApiCalls(tracker, pattern) {
  return tracker.getCalls().filter((call) => call.url.includes(pattern));
}

async function completeInterviewCycle(page, options = {}) {
  const script = Array.isArray(options.script) && options.script.length
    ? options.script
    : ROUND2_INTERVIEW_SCRIPT;
  const followUpPrompts = Array.isArray(options.followUpPrompts) && options.followUpPrompts.length
    ? options.followUpPrompts
    : [
        "能具体讲讲最近一次遇到这个问题的情境吗？",
        "这个问题发生时，最让你困扰的细节是什么？",
        "如果只能优先改进一件事，你最希望是什么？",
        "现有替代方案最让你不满意的地方是什么？",
        "还有什么顾虑是我们刚才没聊到的？"
      ];
  const onProgress = typeof options.onProgress === "function" ? options.onProgress : null;
  const startButton = page.getByRole("button", { name: /开始第一场访谈|开始下一次访谈/ });
  const endButton = page.getByRole("button", { name: /结束本次访谈/ });
  const cardSelection = page.locator("[data-testid='r2-card-selection-container']");
  const nextInterviewButton = page.locator("button").filter({ hasText: /开始下一次访谈|再访谈一位/ }).first();
  const enterCardsButton = page.locator("button").filter({ hasText: /进入个人选卡/ }).first();
  const interviewInput = page.locator("[data-testid='r2-interview-input']");
  const personaMessages = page.locator("[data-testid='r2-interview-persona-msg']");
  const resolvePostInterviewState = async () => {
    if (await cardSelection.isVisible().catch(() => false)) return "cards";
    if (await enterCardsButton.isVisible().catch(() => false)) return "enter-cards";
    if (await nextInterviewButton.isVisible().catch(() => false)) return "next-interview";
    if (await interviewInput.isEditable().catch(() => false)) return "interviewing";
    if (await endButton.isVisible().catch(() => false)) return "ending";
    return "waiting";
  };

  const waitForInterviewComposer = async (timeoutMs) => {
    try {
      await expect(interviewInput).toBeEditable({ timeout: timeoutMs });
      return true;
    } catch (error) {
      return false;
    }
  };

  const readLastPersonaMessage = async () => {
    const count = await personaMessages.count();
    if (!count) return "";
    return normalizeText(await personaMessages.nth(count - 1).innerText().catch(() => ""));
  };

  if (!(await waitForInterviewComposer(30000))) {
    if (await startButton.isVisible().catch(() => false)) {
      if (onProgress) onProgress("start-click");
      await startButton.click();
    }
  }
  await expect(interviewInput).toBeVisible({ timeout: 90000 });
  await expect(interviewInput).toBeEditable({ timeout: 90000 });
  await expect(page.locator("[data-testid='r2-interview-send-btn']")).toBeDisabled({ timeout: 10000 }).catch(() => {});
  await expect(
    page.locator("[data-testid='r2-interview-container']").getByText(/TA 同意参加你们的产品调研/).first()
  ).toBeVisible({ timeout: 90000 });
  if (onProgress) onProgress("ready");

  const sendInterviewMessage = async (message, phaseLabel, meta = {}) => {
    const beforePersonaCount = await personaMessages.count();
    const beforeLastPersonaMessage = await readLastPersonaMessage();
    const beforeUserCount = await page.locator("[data-testid='r2-interview-user-msg']").count();
    if (typeof options.beforeSend === "function") {
      await options.beforeSend({ page, message, beforePersonaCount, beforeUserCount, ...meta });
    }
    await page.locator("[data-testid='r2-interview-input']").fill(message);
    if (onProgress) onProgress(`${phaseLabel}-send`);
    await page.locator("[data-testid='r2-interview-send-btn']").click();
    await expect(page.locator("[data-testid='r2-interview-user-msg']")).toHaveCount(beforeUserCount + 1, { timeout: 10000 });
    await expect.poll(async () => {
      const count = await personaMessages.count();
      if (count > beforePersonaCount) return true;
      const latestMessage = await readLastPersonaMessage();
      return Boolean(latestMessage) && latestMessage !== beforeLastPersonaMessage;
    }, {
      timeout: ROUND2_REPLY_TIMEOUT_MS,
      intervals: [500, 1000, 2000, 5000]
    }).toBeTruthy();
    if (onProgress) onProgress(`${phaseLabel}-reply`);
    if (typeof options.afterReply === "function") {
      await options.afterReply({ page, message, beforePersonaCount, beforeUserCount, ...meta });
    }
  };

  for (let index = 0; index < script.length; index += 1) {
    const message = script[index];
    await sendInterviewMessage(message, `turn-${index + 1}`, { index });
  }

  if (options.autoEnd === false) {
    return;
  }
  let extraTurn = 0;
  while (
    !(await endButton.isVisible().catch(() => false)) &&
    !(await cardSelection.isVisible().catch(() => false)) &&
    extraTurn < followUpPrompts.length
  ) {
    extraTurn += 1;
    await sendInterviewMessage(followUpPrompts[extraTurn - 1], `followup-${extraTurn}`, { index: script.length + extraTurn - 1 });
  }
  if (await cardSelection.isVisible().catch(() => false)) {
    if (onProgress) onProgress("auto-finished");
    return { postEndState: "cards" };
  }
  await expect(endButton).toBeVisible({ timeout: 10000 });
  await endButton.click();
  if (onProgress) onProgress("end");
  await expect.poll(resolvePostInterviewState, {
    timeout: 120000,
    intervals: [1000, 2000, 3000, 5000]
  }).not.toBe("waiting");
  const postEndState = await resolvePostInterviewState();
  if (typeof options.afterEnd === "function") {
    await options.afterEnd({ page });
  }
  return { postEndState };
}

async function runRound1Flow({
  page,
  request,
  monitor,
  tracker,
  stepResults,
  freezeAtEnd = false,
  createViaUi = false,
  teamSize = 1,
  personalGridTestId = "grid-toc-diff-adult",
  teamGridTestId = "",
  architectureTestId = "arch-experience",
  teamArchitectureTestId = "team-arch-experience",
  vpDraft = ROUND1_VP_DRAFT,
  coachMessages = ROUND1_COACH_MESSAGES,
  confirmedFieldFallbacks = null,
  onProgress = null
}) {
  const runStep = createStepRunner({ page, monitor, tracker, stepResults });
  const context = {};
  const finalTeamGridTestId = teamGridTestId || personalGridTestId;
  const strictMonitoring = !createViaUi && teamSize === 1;

  await runStep("Step 1: 建组", async () => {
    logProgress(onProgress, "round1-step1-bootstrap");
    const team = createViaUi
      ? await bootstrapTrialTeamViaUi(page, { teamName: `${ROUND1_TEAM_NAME} ${Date.now()}`, teamSize })
      : await bootstrapSinglePlayerTeam(page, tracker, { teamSize });
    context.teamId = team.teamId;
    context.memberId = team.memberId;
    context.members = Array.isArray(team.members) ? team.members : [{
      id: team.memberId,
      name: "成员1",
      index: 1
    }];
    if (strictMonitoring) {
      expect(findApiCalls(tracker, "/api/team/create")).toHaveLength(1);
      tracker.assertNoCancelled({ ignoreUrls: TEAM_POLL_IGNORE_URLS });
      tracker.assertAllSucceeded({ ignoreUrls: TEAM_POLL_IGNORE_URLS });
      monitor.assertClean("Step 1: 建组");
    }
    return team;
  });

  await runStep("Step 2: 翻锦囊", async () => {
    logProgress(onProgress, "round1-step2-jinang");
    const marketSelector = "[data-testid='jinang-market-card']";
    const techSelector = "[data-testid='jinang-tech-card']";
    await revealJinangCard(page, marketSelector);
    await revealJinangCard(page, techSelector);
    await expect(page.locator(marketSelector)).toBeVisible();
    await expect(page.locator(techSelector)).toBeVisible();
    await assertStable(page, marketSelector, { duration: 1200, checkInterval: 200 });
    await assertStable(page, techSelector, { duration: 1200, checkInterval: 200 });
    await page.locator("[data-testid='jinang-continue-btn']").click();
    await expect(page.locator("[data-testid='grid-toc-diff-adult']")).toBeVisible();
    if (strictMonitoring) {
      monitor.assertClean("Step 2: 翻锦囊");
    }
    return {};
  });

  await runStep("Step 3: 选格子 + 架构 + VP 草稿", async () => {
    logProgress(onProgress, "round1-step3-start");
    if (teamSize > 1) {
      for (const member of context.members) {
        logProgress(onProgress, `round1-step3-member-${member.index}`);
        await submitRound1PersonalChoice(page, {
          teamId: context.teamId,
          memberId: member.id,
          memberName: member.name,
          gridTestId: personalGridTestId,
          architectureTestId,
          vpDraft: `${vpDraft} ${member.name}`.trim()
        });
      }
      await expect.poll(async () => {
        logProgress(onProgress, "round1-step3-wait-phase2");
        const response = await request.get(`${resolveBaseUrl()}/api/team/${encodeURIComponent(context.teamId)}/status?memberId=${encodeURIComponent(context.memberId)}`);
        const data = await response.json();
        return String(data?.status || "");
      }, {
        timeout: 30000,
        intervals: [500, 1000, 2000]
      }).toBe("phase2");
      await openRound1ForMember(page, { teamId: context.teamId, memberId: context.memberId, step: 3 });
    } else {
      await page.locator(`[data-testid='${personalGridTestId}']`).click();
      await page.locator(`[data-testid='${architectureTestId}']`).click();
      await page.locator("[data-testid='vp-draft-input']").fill(vpDraft);
      tracker.reset();
      tracker.startCapture();
      await page.locator("[data-testid='round1-personal-submit-btn']").click();
      await tracker.waitForSettled(1000);
      if (strictMonitoring) {
        expect(findApiCalls(tracker, "/phase1/")).toHaveLength(1);
        tracker.assertNoCancelled({ ignoreUrls: TEAM_POLL_IGNORE_URLS });
        tracker.assertAllSucceeded({ ignoreUrls: TEAM_POLL_IGNORE_URLS });
      }
    }
    await expect(page.locator("[data-testid='r1-distribution-container']")).toBeVisible();
    if (strictMonitoring) {
      monitor.assertClean("Step 3: 选格子 + 架构 + VP 草稿");
    }
    return {};
  });

  await runStep("Step 4: 战略分布图", async () => {
    logProgress(onProgress, "round1-step4-distribution");
    await page.locator(`[data-testid='${finalTeamGridTestId}']`).last().click();
    await page.locator(`[data-testid='${teamArchitectureTestId}']`).click();
    await page.locator("[data-testid='round1-distribution-continue-btn']").click();
    await expect(page.locator("[data-testid='coach-messages']")).toBeVisible();
    if (strictMonitoring) {
      monitor.assertClean("Step 4: 战略分布图");
    }
    return {};
  });

  await runStep("Step 5: VP Coach 对话", async () => {
    logProgress(onProgress, "round1-step5-coach-start");
    const coachMessageItems = page.locator("[data-testid='coach-message-coach']");
    const userMessages = page.locator("[data-testid='coach-message-user']");
    const coachInput = page.locator("[data-testid='coach-message-input']");
    await expect(page.locator("[data-testid='coach-messages']")).toBeVisible({ timeout: 60000 });
    await expect(coachInput).toBeEditable({ timeout: 60000 });
    await assertStable(page, "[data-testid='coach-messages']", { duration: 1500, checkInterval: 200 });

    for (let index = 0; index < coachMessages.length; index += 1) {
      const message = coachMessages[index];
      console.log(`[E2E] Coach turn ${index + 1}/${coachMessages.length}: send`);
      logProgress(onProgress, `round1-step5-coach-turn-${index + 1}-send`);
      const beforeCoachCount = await coachMessageItems.count();
      const beforeUserCount = await userMessages.count();
      await coachInput.fill(message);
      await page.locator("[data-testid='coach-send-btn']").click();
      await expect.poll(async () => userMessages.count(), {
        timeout: 15000,
        intervals: [500, 1000, 2000]
      }).toBeGreaterThan(beforeUserCount);
      await expect(async () => {
        const count = await coachMessageItems.count();
        expect(count).toBeGreaterThan(beforeCoachCount);
      }).toPass({ timeout: 60000 });
      console.log(`[E2E] Coach turn ${index + 1}/${coachMessages.length}: reply`);
      logProgress(onProgress, `round1-step5-coach-turn-${index + 1}-reply`);
    }

    const vpTextarea = page.locator("[data-testid='round1-vp-textarea']");
    const synthesizeButton = page.locator("[data-testid='vp-synthesize-btn']");
    await expect(synthesizeButton).toBeVisible({ timeout: 30000 });
    console.log("[E2E] VP synthesize: click");
    logProgress(onProgress, "round1-step5-vp-synthesize-click");
    await synthesizeButton.click();
    await expect.poll(async () => String(await vpTextarea.inputValue()).trim().length, {
      timeout: 90000,
      intervals: [1000, 2000, 3000]
    }).toBeGreaterThan(0);
    console.log("[E2E] VP synthesize: ready");
    logProgress(onProgress, "round1-step5-vp-synthesize-ready");
    context.round1SynthesizedVp = await vpTextarea.inputValue();

    tracker.reset();
    tracker.startCapture();
    console.log("[E2E] VP submit: click");
    logProgress(onProgress, "round1-step5-vp-submit-click");
    await page.locator("[data-testid='vp-submit-btn']").click();
    await expect(page.locator("[data-testid='vp-confirm-fields']")).toBeVisible({ timeout: 60000 });
    console.log("[E2E] VP submit: confirm fields visible");
    logProgress(onProgress, "round1-step5-vp-confirm-fields");
    const requiredFieldFallbacks = {
      who_raw: "",
      pain_raw: "",
      how_raw: "",
      ...(confirmedFieldFallbacks || {})
    };
    for (const [fieldKey, fallbackValue] of Object.entries(requiredFieldFallbacks)) {
      const field = page.locator(`[data-testid='vp-confirm-${fieldKey}']`);
      if (!(await field.count())) continue;
      const currentValue = String(await field.inputValue().catch(() => "")).trim();
      if (!currentValue && String(fallbackValue || "").trim()) {
        await field.fill(String(fallbackValue).trim());
      }
    }
    await expect(page.locator("[data-testid='vp-confirm-who_raw']")).not.toHaveValue("", { timeout: 10000 });
    await expect(page.locator("[data-testid='vp-confirm-pain_raw']")).not.toHaveValue("", { timeout: 10000 });
    await expect(page.locator("[data-testid='vp-confirm-how_raw']")).not.toHaveValue("", { timeout: 10000 });
    await tracker.waitForSettled(1500, {
      timeoutMs: 15000,
      ignoreUrls: ["/status", "/phase3/state"]
    });
    if (strictMonitoring) {
      tracker.assertCallCount("extract-fields", 1);
      tracker.assertNoCancelled({ ignoreUrls: TEAM_POLL_IGNORE_URLS });
      tracker.assertAllSucceeded({ ignoreUrls: TEAM_POLL_IGNORE_URLS });
    }
    await assertStable(page, "[data-testid='vp-confirm-fields']", { duration: 3000, checkInterval: 250 });
    const mutations = await countDOMMutations(page, "[data-testid='vp-confirm-fields']", { duration: 3000, checkInterval: 200 });
    expect(mutations).toBeLessThan(10);
    if (strictMonitoring) {
      monitor.assertClean("Step 5: VP Coach 对话");
    }

    tracker.reset();
    tracker.startCapture();
    const confirmScoreResponsePromise = page.waitForResponse((response) =>
      response.url().includes("/api/vp/confirm-and-score") && response.request().method() === "POST"
    );
    console.log("[E2E] VP confirm score: click");
    logProgress(onProgress, "round1-step5-vp-confirm-score-click");
    await page.locator("[data-testid='vp-confirm-btn']").click();
    await expect(page.locator("[data-testid='r1-results-container']")).toBeVisible({ timeout: 60000 });
    console.log("[E2E] VP confirm score: results visible");
    logProgress(onProgress, "round1-step5-vp-results-visible");
    const confirmScoreResponse = await confirmScoreResponsePromise;
    expect(confirmScoreResponse.status()).toBe(200);
    context.round1ScoreResponse = await confirmScoreResponse.json();
    await tracker.waitForSettled(1000);
    if (strictMonitoring) {
      tracker.assertNoCancelled();
      tracker.assertAllSucceeded({ ignoreUrls: TEAM_POLL_IGNORE_URLS });
    }
    return { domMutations: mutations };
  });

  await runStep("Step 6: 结果页展示", async () => {
    logProgress(onProgress, "round1-step6-results");
    const results = page.locator("[data-testid='r1-results-container']");
    await expect(results).toBeVisible();
    await expect(results.getByText("VP 综合评分").first()).toBeVisible();
    await assertStable(page, "[data-testid='r1-results-container']", { duration: 1500, checkInterval: 200 });
    tracker.reset();
    tracker.startCapture();
    await page.waitForTimeout(5000);
    const apiCalls = findApiCalls(tracker, "/api/");
    expect(apiCalls.every((call) => call.url.includes("/api/team/") && call.url.includes("/status"))).toBeTruthy();
    if (strictMonitoring) {
      monitor.assertClean("Step 6: 结果页展示");
    }
    return {};
  });

  if (freezeAtEnd) {
    await runStep("Step R2-0: 推进到 Round 2", async () => {
      logProgress(onProgress, "round1-step-r20-freeze");
      tracker.startCapture();
      await page.locator("[data-testid='r1-freeze-btn']").click();
      await expect(page.locator("[data-testid='r2-recap-container']")).toBeVisible({ timeout: 60000 });
      await tracker.waitForSettled(1000);
      if (strictMonitoring) {
        expect(findApiCalls(tracker, "/freeze")).toHaveLength(1);
        tracker.assertNoCancelled({ ignoreUrls: TEAM_POLL_IGNORE_URLS });
        tracker.assertAllSucceeded({ ignoreUrls: TEAM_POLL_IGNORE_URLS });
        monitor.assertClean("Step R2-0: 推进到 Round 2");
      }
      return {};
    });
  }

  return context;
}

async function runRound2Flow({ page, request, monitor, tracker, stepResults, context }) {
  const runStep = createStepRunner({ page, monitor, tracker, stepResults });

  await runStep("Step R2-1: R1 回顾页", async () => {
    const recap = page.locator("[data-testid='r2-recap-container']");
    await expect(recap).toBeVisible();
    await expect(page.locator("[data-testid='r2-recap-vpscore']")).toBeVisible();
    const recapData = await request.get(`${resolveBaseUrl()}/api/round2/recap?teamId=${encodeURIComponent(context.teamId)}`);
    expect(recapData.status()).toBe(200);
    const recapJson = await recapData.json();
    expect(Number(recapJson.vp_score || 0)).toBeGreaterThan(0);
    expect(String(recapJson.market_space_tier || "")).not.toBe("");
    context.round2Recap = recapJson;
    await page.getByRole("button", { name: "进入第二轮 →" }).click();
    await expect(page.locator("[data-testid='r2-interview-container']")).toBeVisible();
    monitor.assertClean("Step R2-1: R1 回顾页");
    return {};
  });

  await runStep("Step R2-2: 维度分配", async () => {
    const stateRes = await request.get(`${resolveBaseUrl()}/api/round2/state?teamId=${encodeURIComponent(context.teamId)}&memberId=${encodeURIComponent(context.memberId)}`);
    expect(stateRes.status()).toBe(200);
    const stateJson = await stateRes.json();
    expect(Array.isArray(stateJson.member?.dims)).toBeTruthy();
    expect(stateJson.member.dims.length).toBeGreaterThanOrEqual(2);
    monitor.assertClean("Step R2-2: 维度分配");
    return {};
  });

  await runStep("Step R2-3: Focus Group 访谈", async () => {
    tracker.startCapture();
    await completeInterviewCycle(page);
    await tracker.waitForSettled(1000);
    expect(findApiCalls(tracker, "/api/round2/interview/start").length).toBeGreaterThanOrEqual(1);
    expect(findApiCalls(tracker, "/api/round2/interview/reply").length).toBeGreaterThanOrEqual(ROUND2_INTERVIEW_SCRIPT.length);
    await expect(page.getByRole("button", { name: /开始下一次访谈|进入个人选卡/ })).toBeVisible({ timeout: 90000 });
    await page.getByRole("button", { name: /开始下一次访谈/ }).click();
    await completeInterviewCycle(page);
    await expect(page.getByRole("button", { name: /进入个人选卡/ })).toBeVisible({ timeout: 90000 });
    await page.getByRole("button", { name: /进入个人选卡/ }).click();
    await expect(page.locator("[data-testid='r2-card-selection-container']")).toBeVisible();
    tracker.assertNoCancelled();
    monitor.assertClean("Step R2-3: Focus Group 访谈");
    return {};
  });

  await runStep("Step R2-4: 个人选卡", async () => {
    await expect(page.locator("[data-testid='r2-card-selection-container']")).toBeVisible();
    const dims = ["interaction", "perception", "motion", "safety", "extend", "ops"];
    for (const dim of dims) {
      const checkbox = page.locator(`[data-testid='r2-dim-${dim}'] input[type='checkbox']`).first();
      if (await checkbox.count()) {
        await checkbox.click();
      }
    }
    tracker.reset();
    tracker.startCapture();
    await page.getByRole("button", { name: /提交个人选卡/ }).click();
    await tracker.waitForSettled(1000);
    expect(findApiCalls(tracker, "/api/round2/member-selection").length).toBeGreaterThanOrEqual(1);
    await expect(page.locator("[data-testid='r2-merge-container']")).toBeVisible({ timeout: 30000 });
    tracker.assertNoCancelled();
    tracker.assertAllSucceeded({ ignoreUrls: TEAM_POLL_IGNORE_URLS });
    monitor.assertClean("Step R2-4: 个人选卡");
    return {};
  });

  await runStep("Step R2-5: 团队合并与讨论", async () => {
    await expect(page.locator("[data-testid='r2-merge-container']")).toBeVisible();
    await page.getByRole("button", { name: /进入集体讨论/ }).click();
    await expect(page.locator("[data-testid='r2-price-input']")).toBeVisible();
    const targetPrice = Math.max(5000, Math.min(20000, Math.round(Number(context.round2Recap?.Pmax || 12000) * 0.7 / 100) * 100));
    await setRangeValue(page, "[data-testid='r2-price-input']", targetPrice);
    await page.getByRole("button", { name: /确认产品方案与定价/ }).click();
    await expect(page.locator("[data-testid='r2-final-submit']")).toBeVisible();

    tracker.reset();
    tracker.startCapture();
    await page.locator("[data-testid='r2-final-submit']").click();
    await expect(page.locator("[data-testid='r2-results-container']")).toBeVisible({ timeout: 90000 });
    await tracker.waitForSettled(1000);
    expect(findApiCalls(tracker, "/api/round2/team-submit").length).toBeGreaterThanOrEqual(1);
    tracker.assertNoCancelled();
    tracker.assertAllSucceeded({ ignoreUrls: TEAM_POLL_IGNORE_URLS });
    monitor.assertClean("Step R2-5: 团队合并与讨论");
    return {};
  });

  await runStep("Step R2-6: 最终结果", async () => {
    const results = page.locator("[data-testid='r2-results-container']");
    await expect(results).toBeVisible();
    await expect(page.locator("[data-testid='r2-profit-value']")).toBeVisible();
    await assertStable(page, "[data-testid='r2-results-container']", { duration: 1500, checkInterval: 200 });
    const mutations = await countDOMMutations(page, "[data-testid='r2-results-container']", { duration: 3000, checkInterval: 200 });
    expect(mutations).toBeLessThan(10);

    const teamResultRes = await request.get(`${resolveBaseUrl()}/api/round2/team-result?teamId=${encodeURIComponent(context.teamId)}&session_id=default`);
    expect(teamResultRes.status()).toBe(200);
    const teamResultJson = await teamResultRes.json();
    expect(Number(teamResultJson.result?.profit ?? teamResultJson.result?.result?.profit ?? 0)).not.toBeNaN();
    tracker.reset();
    tracker.startCapture();
    await page.waitForTimeout(5000);
    const apiCalls = findApiCalls(tracker, "/api/");
    expect(apiCalls.every((call) => call.url.includes("/api/round2/state"))).toBeTruthy();
    monitor.assertClean("Step R2-6: 最终结果");
    return { domMutations: mutations };
  });
}

async function saveExportArtifacts(request, teamId) {
  const reportsDir = path.join(process.cwd(), "tests", "e2e", "reports");
  fs.mkdirSync(reportsDir, { recursive: true });
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const jsonRes = await request.get(`${resolveBaseUrl()}/api/test/export/${encodeURIComponent(teamId)}?format=json`, {
    headers: { "X-Test-Export": "true" }
  });
  expect(jsonRes.status()).toBe(200);
  const jsonData = await jsonRes.json();
  const jsonPath = path.join(reportsDir, `session-full-${teamId}-${ts}.json`);
  fs.writeFileSync(jsonPath, JSON.stringify(jsonData, null, 2));

  const zipRes = await request.get(`${resolveBaseUrl()}/api/test/export/${encodeURIComponent(teamId)}?format=csv`, {
    headers: { "X-Test-Export": "true" }
  });
  expect(zipRes.status()).toBe(200);
  const zipPath = path.join(reportsDir, `session-full-${teamId}-${ts}.zip`);
  fs.writeFileSync(zipPath, await zipRes.body());

  return { jsonData, jsonPath, zipPath };
}

module.exports = {
  STUDENT_SESSION_KEY,
  ROUND1_VP_DRAFT,
  ROUND2_INTERVIEW_SCRIPT,
  revealJinangCard,
  setRangeValue,
  completeInterviewCycle,
  writeStudentSession,
  resolveBaseUrl,
  createStepRunner,
  runRound1Flow,
  runRound2Flow,
  saveExportArtifacts
};
