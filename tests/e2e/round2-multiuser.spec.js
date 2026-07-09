const { test, expect, chromium } = require("@playwright/test");
const { createConsoleMonitor } = require("./helpers/consoleMonitor");
const { createNetworkTracker } = require("./helpers/networkTracker");
const {
  STUDENT_SESSION_KEY,
  ROUND2_INTERVIEW_SCRIPT,
  completeInterviewCycle,
  resolveBaseUrl,
  runRound1Flow,
  setRangeValue
} = require("./helpers/flowHelpers");

const TEAM_SIZE = 6;
const ROUND1_GRID_TEST_ID = "grid-toc-diff-elder";
const ROUND1_ARCHITECTURE_TEST_ID = "arch-experience";
const ROUND1_TEAM_ARCHITECTURE_TEST_ID = "team-arch-experience";
const ROUND2_PRICE = 12000;
const HEARTBEAT_TIMEOUT_MS = 90000;
const ROUND1_PHASE_TIMEOUT_MS = 8 * 60 * 1000;
const ROUND2_PHASE_TIMEOUT_MS = 10 * 60 * 1000;
const ROUND1_COACH_MESSAGES = [
  "我们的目标用户是独居且子女异地的城市老人",
  "他们的痛点是日常孤独，且身体异常时家属难以及时发现"
];
const ROUND1_CONFIRMED_FIELD_FALLBACKS = {
  who_raw: "独居且子女异地的城市老人",
  pain_raw: "日常孤独，且身体异常时家属难以及时发现",
  how_raw: "通过自然语言交互、主动陪伴、健康提醒和远程通知，提供情感陪伴与异常预警"
};
let sharedBrowser = null;

async function launchSharedBrowser() {
  const preferredChannel = String(process.env.PLAYWRIGHT_CHROME_CHANNEL || "chrome").trim();
  if (preferredChannel) {
    try {
      return await chromium.launch({ channel: preferredChannel });
    } catch (error) {
      console.warn(`[E2E] failed to launch Chromium with channel=${preferredChannel}, falling back to bundled browser: ${error.message}`);
    }
  }
  return chromium.launch();
}

function createContextOptions() {
  return {
    baseURL: resolveBaseUrl(),
    ignoreHTTPSErrors: true
  };
}

function normalizeText(text) {
  return String(text || "").replace(/\s+/g, " ").trim();
}

function buildStoredSession(teamId, member) {
  return {
    teamId,
    memberId: member.id,
    studentName: member.name,
    entryMode: "trial"
  };
}

function extractNumericValue(text) {
  const match = String(text || "").match(/-?\d+(\.\d+)?/);
  return match ? Number(match[0]) : Number.NaN;
}

function extractMoneyValue(text) {
  return Number(String(text || "").replace(/[^\d.-]/g, ""));
}

function parsePersonaName(cardText) {
  const match = String(cardText || "").match(/访谈对象：([^\n]+)/);
  return match ? match[1].trim() : "";
}

function createPhaseWatchdog(timeoutMs) {
  let lastLabel = "init";
  let idleTimer = null;
  let phaseTimer = null;
  let activeReject = null;

  function clearTimers() {
    if (idleTimer) clearTimeout(idleTimer);
    if (phaseTimer) clearTimeout(phaseTimer);
    idleTimer = null;
    phaseTimer = null;
  }

  function armIdleTimer(label) {
    lastLabel = label;
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      if (activeReject) {
        activeReject(new Error(`No progress for ${timeoutMs}ms, last checkpoint: ${lastLabel}`));
      }
    }, timeoutMs);
  }

  return {
    bump(label) {
      console.log(`[E2E] heartbeat ${label}`);
      armIdleTimer(label);
    },
    async run(label, fn, timeoutOverrideMs = timeoutMs) {
      return new Promise((resolve, reject) => {
        const wrappedReject = (error) => {
          clearTimers();
          activeReject = null;
          reject(error);
        };
        activeReject = wrappedReject;
        armIdleTimer(label);
        phaseTimer = setTimeout(() => {
          wrappedReject(new Error(`Phase timeout after ${timeoutOverrideMs}ms, last checkpoint: ${lastLabel}`));
        }, timeoutOverrideMs);
        Promise.resolve()
          .then(() => fn())
          .then((result) => {
            clearTimers();
            activeReject = null;
            resolve(result);
          })
          .catch(wrappedReject);
      });
    }
  };
}

async function openRound2Context(browser, teamId, member) {
  const context = await browser.newContext(createContextOptions());
  await context.addInitScript(({ key, session }) => {
    window.localStorage.setItem(key, JSON.stringify(session));
  }, {
    key: STUDENT_SESSION_KEY,
    session: buildStoredSession(teamId, member)
  });
  const page = await context.newPage();
  await page.goto("/multiplayer");
  await expect(page.locator("[data-testid='r2-recap-container']")).toBeVisible({ timeout: 120000 });
  return { context, page, member };
}

async function enterRound2FromRecap(page) {
  if (await page.locator("[data-testid='r2-interview-container']").count()) {
    return;
  }
  await expect(page.locator("[data-testid='r2-recap-container']")).toBeVisible({ timeout: 120000 });
  await expect(page.locator("[data-testid='r2-recap-space-tier']")).not.toHaveText("", { timeout: 30000 });
  await expect(page.getByText("VP 综合评分").first()).toHaveCount(0);
  await page.getByRole("button", { name: "继续" }).click();
  await expect(page.locator("[data-testid='r2-interview-container']")).toBeVisible({ timeout: 120000 });
}

async function getActivePersonaCard(page) {
  const personaCard = page
    .locator("[data-testid='r2-interview-container'] div")
    .filter({ hasText: /TA 同意参加你们的产品调研/ })
    .first();
  await expect(personaCard).toBeVisible({ timeout: 30000 });
  return personaCard;
}

async function assertActivePersonaMeta(page, expectedAgeGroup = "ELDER") {
  const personaCard = await getActivePersonaCard(page);
  const cardText = await personaCard.innerText();
  const personaName = parsePersonaName(cardText);
  expect(personaName).not.toBe("");

  const ageMatch = String(cardText).match(/(\d+)岁/);
  expect(ageMatch, "persona card should include age").toBeTruthy();
  const ageValue = Number(ageMatch[1]);
  if (expectedAgeGroup === "ELDER") {
    expect(ageValue).toBeGreaterThanOrEqual(60);
  } else if (expectedAgeGroup === "ADULT") {
    expect(ageValue).toBeGreaterThanOrEqual(18);
    expect(ageValue).toBeLessThan(60);
  } else if (expectedAgeGroup === "CHILD") {
    expect(ageValue).toBeLessThan(18);
  }

  return {
    personaName,
    cardText
  };
}

async function completeInterviewWithAssertions(page, expectedAgeGroup = "ELDER", onProgress = null) {
  let currentPersonaName = "";

  return completeInterviewCycle(page, {
    script: ROUND2_INTERVIEW_SCRIPT,
    onProgress,
    beforeSend: async () => {
      const meta = await assertActivePersonaMeta(page, expectedAgeGroup);
      currentPersonaName = meta.personaName;
    },
    afterReply: async ({ beforePersonaCount }) => {
      const personaMessage = page.locator("[data-testid='r2-interview-persona-msg']").nth(beforePersonaCount);
      await expect(personaMessage).toBeVisible({ timeout: 30000 });
      const speaker = normalizeText(await personaMessage.locator("div").first().innerText());
      const replyText = normalizeText(await personaMessage.locator("div").nth(1).innerText());
      expect(speaker).toBe(currentPersonaName);
      expect(replyText).not.toContain("我现在负责");
      expect(replyText).not.toContain("所在机构是");
    }
  });
}

async function resolvePostInterviewState(page) {
  const cardSelection = page.locator("[data-testid='r2-card-selection-container']");
  const enterCardsButton = page.locator("button").filter({ hasText: /^继续$/ }).first();
  const nextInterviewButton = page.locator("button").filter({ hasText: /开始下一次访谈|再访谈一位/ }).first();
  const interviewInput = page.locator("[data-testid='r2-interview-input']");
  const endButton = page.locator("button").filter({ hasText: /结束本次访谈/ }).first();

  if (await cardSelection.isVisible().catch(() => false)) return "cards";
  if (await enterCardsButton.isVisible().catch(() => false)) return "enter-cards";
  if (await nextInterviewButton.isVisible().catch(() => false)) return "next-interview";
  if (await interviewInput.isEditable().catch(() => false)) return "interviewing";
  if (await endButton.isVisible().catch(() => false)) return "ending";
  return "waiting";
}

async function waitForActionablePostInterviewState(page, initialState = "waiting", timeout = 120000) {
  if (initialState && initialState !== "waiting" && initialState !== "ending") {
    return initialState;
  }
  await expect.poll(async () => {
    const state = await resolvePostInterviewState(page);
    if (state === "ending") return "waiting";
    return state;
  }, {
    timeout,
    intervals: [1000, 2000, 3000, 5000]
  }).not.toBe("waiting");
  return resolvePostInterviewState(page);
}

async function completeTwoInterviewsAndEnterCards(page, expectedAgeGroup = "ELDER", onProgress = null) {
  const firstInterview = await completeInterviewWithAssertions(page, expectedAgeGroup, (phase) => {
    if (onProgress) onProgress(`interview-1-${phase}`);
  });
  const firstPostState = await waitForActionablePostInterviewState(page, firstInterview?.postEndState);
  const cardSelection = page.locator("[data-testid='r2-card-selection-container']");
  const enterCardsButton = page.locator("button").filter({ hasText: /^继续$/ }).first();
  const nextInterviewButton = page.locator("button").filter({ hasText: /开始下一次访谈|再访谈一位/ }).first();

  if (firstPostState === "cards") {
    await expect(page.locator("[data-testid='r2-card-selection-container']")).toBeVisible({ timeout: 30000 });
    if (onProgress) onProgress("cards-visible");
    return;
  }
  if (firstPostState === "enter-cards") {
    await enterCardsButton.click();
    await expect(cardSelection).toBeVisible({ timeout: 30000 });
    if (onProgress) onProgress("cards-visible");
    return;
  }
  if (firstPostState === "next-interview") {
    await nextInterviewButton.click();
    if (onProgress) onProgress("interview-2-start-click");
  }

  const secondInterview = await completeInterviewWithAssertions(page, expectedAgeGroup, (phase) => {
    if (onProgress) onProgress(`interview-2-${phase}`);
  });
  const secondPostState = await waitForActionablePostInterviewState(page, secondInterview?.postEndState);
  if (secondPostState === "cards") {
    await expect(cardSelection).toBeVisible({ timeout: 30000 });
    if (onProgress) onProgress("cards-visible");
    return;
  }
  if (secondPostState === "enter-cards") {
    await enterCardsButton.click();
  }
  await expect(cardSelection).toBeVisible({ timeout: 30000 });
  if (onProgress) onProgress("cards-visible");
}

async function selectCardsAndSubmit(page, expectWaiting) {
  await expect(page.locator("[data-testid='r2-card-selection-container']")).toBeVisible({ timeout: 30000 });
  const groups = page.locator("[data-testid^='r2-dim-']");
  const groupCount = await groups.count();
  expect(groupCount).toBeGreaterThan(0);

  for (let index = 0; index < groupCount; index += 1) {
    const group = groups.nth(index);
    const card = group.locator("[data-testid^='r2-card-']").first();
    await expect(card).toBeVisible({ timeout: 30000 });
    const checkbox = card.locator("input[type='checkbox']");
    if (!(await checkbox.isChecked())) {
      await checkbox.click();
    }
    const testId = await card.getAttribute("data-testid");
    expect(testId).toBeTruthy();
    const cardId = String(testId).replace("r2-card-", "");
    await card.locator(`[data-testid='r2-tier-${cardId}-LOW']`).click();
  }

  const selectedText = await page.locator("[data-testid='r2-budget-display'] strong").innerText();
  expect(extractNumericValue(selectedText)).toBeGreaterThan(0);

  await page.getByRole("button", { name: /提交个人选卡/ }).click();
  if (expectWaiting) {
    await expect.poll(async () => {
      if (await page.locator("[data-testid='r2-merge-container']").isVisible().catch(() => false)) return "merge";
      if (await page.getByText("等待其他成员提交").isVisible().catch(() => false)) return "waiting";
      if (await page.locator("[data-testid='r2-card-selection-container']").isVisible().catch(() => false)) return "cards";
      return "pending";
    }, {
      timeout: 120000,
      intervals: [1000, 2000, 3000, 5000]
    }).not.toBe("pending");
    return;
  }
  await expect(page.locator("[data-testid='r2-merge-container']")).toBeVisible({ timeout: 120000 });
}

test.describe.serial("Round 1 + Round 2 multiuser UI E2E", () => {
  test.beforeAll(async () => {
    const { execSync } = require("node:child_process");

    try {
      execSync("pkill -f chrome-headless-shell", { stdio: "ignore" });
    } catch (_) {
      // Ignore when no stale headless shell process exists.
    }

    await new Promise((resolve) => setTimeout(resolve, 1000));
    sharedBrowser = await launchSharedBrowser();
  });

  test.afterAll(async () => {
    if (sharedBrowser) {
      await sharedBrowser.close();
      sharedBrowser = null;
    }
  });

  test("6 members complete the full UI chain", async ({ request }) => {
    test.setTimeout(60 * 60 * 1000);
    const watchdog = createPhaseWatchdog(HEARTBEAT_TIMEOUT_MS);

    const leaderContext = await sharedBrowser.newContext(createContextOptions());
    const leaderPage = await leaderContext.newPage();
    const leaderMonitor = createConsoleMonitor(leaderPage);
    const leaderTracker = createNetworkTracker(leaderPage);
    const stepResults = [];
    const sessions = [];

    try {
      const flowContext = await watchdog.run("round1-flow", () =>
        runRound1Flow({
          page: leaderPage,
          request,
          monitor: leaderMonitor,
          tracker: leaderTracker,
          stepResults,
          freezeAtEnd: true,
          teamSize: TEAM_SIZE,
          personalGridTestId: ROUND1_GRID_TEST_ID,
          architectureTestId: ROUND1_ARCHITECTURE_TEST_ID,
          teamArchitectureTestId: ROUND1_TEAM_ARCHITECTURE_TEST_ID,
          coachMessages: ROUND1_COACH_MESSAGES,
          confirmedFieldFallbacks: ROUND1_CONFIRMED_FIELD_FALLBACKS,
          onProgress: (label) => watchdog.bump(label)
        }),
      ROUND1_PHASE_TIMEOUT_MS);
      console.log("[E2E] Round 1 complete");
      watchdog.bump("round1-complete");

      expect(normalizeText(flowContext.round1SynthesizedVp)).not.toBe("");
      expect(flowContext.round1ScoreResponse?.status).toBe("confirmed");
      expect(String(flowContext.round1ScoreResponse?.feedback_text || "").trim()).not.toBe("");
      expect("scores" in (flowContext.round1ScoreResponse || {})).toBe(false);
      await expect(leaderPage.locator("[data-testid='r2-recap-container']")).toBeVisible({ timeout: 120000 });
      await expect(leaderPage.locator("[data-testid='r2-recap-space-tier']")).not.toHaveText("", { timeout: 30000 });
      await expect(leaderPage.getByText("VP 综合评分").first()).toHaveCount(0);

      const members = [...(flowContext.members || [])].sort((a, b) => a.index - b.index);
      expect(members).toHaveLength(TEAM_SIZE);

      sessions.push({
        context: leaderContext,
        page: leaderPage,
        member: members.find((member) => member.id === flowContext.memberId) || members[0]
      });

      for (const member of members) {
        if (member.id === sessions[0].member.id) continue;
        sessions.push(await watchdog.run(`open-round2-context-${member.index}`, () => openRound2Context(sharedBrowser, flowContext.teamId, member), 120000));
      }

      await watchdog.run("round2-enter-recap", () => Promise.all(sessions.map((session) => enterRound2FromRecap(session.page))), 180000);
      console.log("[E2E] All 6 contexts entered Round 2");
      watchdog.bump("round2-entered");

      await watchdog.run("round2-first-3-interviews", () => Promise.all(
        sessions.slice(0, 3).map((session) => completeTwoInterviewsAndEnterCards(
          session.page,
          "ELDER",
          (phase) => watchdog.bump(`round2-${session.member.name}-${phase}`)
        ))
      ), ROUND2_PHASE_TIMEOUT_MS);
      console.log("[E2E] First 3 members completed interviews");
      watchdog.bump("round2-first-3-interviews-complete");

      for (const session of sessions.slice(3)) {
        await expect(session.page.locator("[data-testid='r2-interview-container']")).toBeVisible({ timeout: 30000 });
        await expect(session.page.locator("[data-testid='r2-card-selection-container']")).toHaveCount(0);
      }

      await watchdog.run("round2-last-3-interviews", () => Promise.all(
        sessions.slice(3).map((session) => completeTwoInterviewsAndEnterCards(
          session.page,
          "ELDER",
          (phase) => watchdog.bump(`round2-${session.member.name}-${phase}`)
        ))
      ), ROUND2_PHASE_TIMEOUT_MS);
      console.log("[E2E] Last 3 members completed interviews");
      watchdog.bump("round2-last-3-interviews-complete");

      for (const session of sessions) {
        await expect(session.page.locator("[data-testid='r2-card-selection-container']")).toBeVisible({ timeout: 30000 });
      }

      await watchdog.run("round2-first-5-cards", () => Promise.all(sessions.slice(0, 5).map((session) => selectCardsAndSubmit(session.page, true))), 180000);
      console.log("[E2E] First 5 members submitted cards");
      watchdog.bump("round2-first-5-cards-complete");
      await watchdog.run("round2-last-card-submit", () => selectCardsAndSubmit(sessions[5].page, false), 180000);
      console.log("[E2E] All 6 members submitted cards");
      watchdog.bump("round2-all-cards-complete");

      await Promise.all(
        sessions.map((session) =>
          expect(session.page.locator("[data-testid='r2-merge-container']")).toBeVisible({ timeout: 120000 })
        )
      );

      const mergeText = await sessions[0].page.locator("[data-testid='r2-merge-container']").innerText();
      const mergedCardCounts = [...String(mergeText).matchAll(/已选卡数：(\d+) 张/g)].map((match) => Number(match[1]));
      expect(mergedCardCounts).toHaveLength(6);
      mergedCardCounts.forEach((count) => expect(count).toBeGreaterThan(0));
      expect((String(mergeText).match(/#[^\s#]+/g) || []).length).toBeGreaterThan(0);

      await watchdog.run("round2-enter-merge-discussion", () => sessions[0].page.getByRole("button", { name: /^继续$/ }).click(), 60000);
      console.log("[E2E] Leader entered merge discussion");
      await expect(sessions[0].page.locator("[data-testid='r2-price-input']")).toBeVisible({ timeout: 30000 });
      await setRangeValue(sessions[0].page, "[data-testid='r2-price-input']", ROUND2_PRICE);
      await sessions[0].page.getByRole("button", { name: /提交并查看结果/ }).click();
      await expect(sessions[0].page.locator("[data-testid='r2-final-submit']")).toBeVisible({ timeout: 30000 });
      await watchdog.run("round2-final-submit", () => sessions[0].page.locator("[data-testid='r2-final-submit']").click(), 60000);
      console.log("[E2E] Leader submitted Round 2 final decision");

      await expect(sessions[0].page.locator("[data-testid='r2-results-container']")).toBeVisible({ timeout: 120000 });
      const leaderProfitText = await sessions[0].page.locator("[data-testid='r2-profit-value']").innerText();
      const leaderProfitValue = extractMoneyValue(leaderProfitText);
      expect(Number.isNaN(leaderProfitValue)).toBeFalsy();
      expect(leaderProfitValue).not.toBe(0);

      await Promise.all(
        sessions.slice(1).map((session) =>
          expect(session.page.locator("[data-testid='r2-results-container']")).toBeVisible({ timeout: 120000 })
        )
      );
    } finally {
      leaderTracker.dispose();
      leaderMonitor.dispose();
      await Promise.all(
        sessions.map(async (session) => {
          await session.context.close();
        })
      );
    }
  });
});
