const fs = require("node:fs");
const path = require("node:path");
const { expect } = require("@playwright/test");
const { assertStable, countDOMMutations } = require("./stabilityChecker");

const ROUND1_TEAM_NAME = "Playwright E2E Team";
const ROUND1_VP_DRAFT = "独居城市白领 在下班回家后感到孤独和情绪低落 通过LOVOT的主动迎接和情感交互获得陪伴感";
const JINANG_FLIP_LABEL = "点击翻开";
const JINANG_FLIP_ANIMATION_MS = 350;
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

function resolveBaseUrl() {
  return process.env.TEST_URL || "https://app.praxisengine.xyz";
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
    monitor.reset();
    tracker.reset();
    const startedAt = Date.now();
    try {
      const extra = await fn();
      pushStepResult(stepResults, name, startedAt, true, monitor, tracker, extra);
      return extra;
    } catch (error) {
      pushStepResult(stepResults, name, startedAt, false, monitor, tracker, {}, error);
      throw error;
    }
  };
}

async function bootstrapSinglePlayerTeam(page, tracker) {
  await page.goto("/multiplayer?entry=1");
  await page.waitForLoadState("domcontentloaded");

  tracker.startCapture();
  const created = await page.evaluate(async ({ teamName }) => {
    const response = await fetch("/api/team/create", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ teamName, teamSize: 1 })
    });
    const data = await response.json();
    if (!data.ok) {
      throw new Error(data.error || "team create failed");
    }
    const teamId = data.team?.id || "";
    const memberId = data.member_links?.[0]?.member_id || "";
    localStorage.setItem("emba_student_session_v1", JSON.stringify({
      teamId,
      memberId,
      entryMode: "trial"
    }));
    return {
      teamId,
      memberId
    };
  }, { teamName: `${ROUND1_TEAM_NAME} ${Date.now()}` });
  await tracker.waitForSettled(600);

  // MultiplayerFlow resolves trial mode from localStorage; URL only needs the target step.
  await page.goto("/multiplayer?step=1");
  await expect(page.locator("[data-testid='jinang-market-card']").getByText(JINANG_FLIP_LABEL, { exact: true })).toBeVisible({ timeout: 30000 });
  await expect(page.locator("[data-testid='jinang-tech-card']").getByText(JINANG_FLIP_LABEL, { exact: true })).toBeVisible({ timeout: 30000 });
  return created;
}

async function revealJinangCard(page, selector) {
  const card = page.locator(selector);
  const flipPrompt = card.getByText(JINANG_FLIP_LABEL, { exact: true });

  await expect(flipPrompt).toBeVisible({ timeout: 30000 });
  await card.click();
  await expect(flipPrompt).toBeHidden({ timeout: 10000 });
  await page.waitForTimeout(JINANG_FLIP_ANIMATION_MS);
  await expect(card).toBeVisible({ timeout: 10000 });
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

async function completeInterviewCycle(page) {
  const startButton = page.getByRole("button", { name: /开始第一场访谈|开始下一次访谈/ });
  await expect(startButton).toBeVisible({ timeout: 90000 });
  await startButton.click();
  await expect(page.locator("[data-testid='r2-interview-persona-msg']")).toBeVisible({ timeout: 90000 });

  for (const message of ROUND2_INTERVIEW_SCRIPT) {
    await page.locator("[data-testid='r2-interview-input']").fill(message);
    await page.locator("[data-testid='r2-interview-send-btn']").click();
    await expect(page.getByText(message, { exact: true })).toBeVisible({ timeout: 10000 });
    await page.locator("[data-testid='r2-interview-persona-msg']").last().waitFor({ state: "visible", timeout: 90000 });
  }

  const endButton = page.getByRole("button", { name: /结束本次访谈/ });
  await expect(endButton).toBeVisible({ timeout: 10000 });
  await endButton.click();
}

async function runRound1Flow({ page, request, monitor, tracker, stepResults, freezeAtEnd = false }) {
  const runStep = createStepRunner({ page, monitor, tracker, stepResults });
  const context = {};

  await runStep("Step 1: 建组", async () => {
    const team = await bootstrapSinglePlayerTeam(page, tracker);
    context.teamId = team.teamId;
    context.memberId = team.memberId;
    expect(findApiCalls(tracker, "/api/team/create")).toHaveLength(1);
    tracker.assertNoCancelled();
    tracker.assertAllSucceeded();
    monitor.assertClean("Step 1: 建组");
    return team;
  });

  await runStep("Step 2: 翻锦囊", async () => {
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
    monitor.assertClean("Step 2: 翻锦囊");
    return {};
  });

  await runStep("Step 3: 选格子 + 架构 + VP 草稿", async () => {
    await page.locator("[data-testid='grid-toc-diff-adult']").click();
    await page.locator("[data-testid='arch-experience']").click();
    await page.locator("[data-testid='vp-draft-input']").fill(ROUND1_VP_DRAFT);
    tracker.reset();
    tracker.startCapture();
    await page.locator("[data-testid='round1-personal-submit-btn']").click();
    await tracker.waitForSettled(1000);
    expect(findApiCalls(tracker, "/phase1/")).toHaveLength(1);
    tracker.assertNoCancelled();
    tracker.assertAllSucceeded();
    await expect(page.locator("[data-testid='r1-distribution-container']")).toBeVisible();
    monitor.assertClean("Step 3: 选格子 + 架构 + VP 草稿");
    return {};
  });

  await runStep("Step 4: 战略分布图", async () => {
    await page.locator("[data-testid='grid-toc-diff-adult']").last().click();
    await page.locator("[data-testid='team-arch-experience']").click();
    await page.locator("[data-testid='round1-distribution-continue-btn']").click();
    await expect(page.locator("[data-testid='coach-messages']")).toBeVisible();
    monitor.assertClean("Step 4: 战略分布图");
    return {};
  });

  await runStep("Step 5: VP Coach 对话", async () => {
    await expect(page.locator("[data-testid='coach-messages']")).toBeVisible({ timeout: 60000 });
    await expect(page.locator("[data-testid='coach-message-coach']").first()).toBeVisible({ timeout: 60000 });
    await expect(page.locator("[data-testid='coach-message-input']")).toBeEditable({ timeout: 10000 });
    await assertStable(page, "[data-testid='coach-messages']", { duration: 1500, checkInterval: 200 });

    for (const message of ROUND1_COACH_MESSAGES) {
      const beforeCount = await page.locator("[data-testid='coach-message-coach']").count();
      await page.locator("[data-testid='coach-message-input']").fill(message);
      await page.locator("[data-testid='coach-send-btn']").click();
      await expect(page.getByText(message, { exact: true })).toBeVisible({ timeout: 10000 });
      await expect(async () => {
        const count = await page.locator("[data-testid='coach-message-coach']").count();
        expect(count).toBeGreaterThan(beforeCount);
      }).toPass({ timeout: 60000 });
      await expect(page.getByText(message, { exact: true })).toBeVisible();
    }

    const vpTextarea = page.locator("[data-testid='round1-vp-textarea']");
    const currentVp = await vpTextarea.inputValue();
    if (String(currentVp || "").trim().length < 10) {
      await vpTextarea.fill(ROUND1_VP_DRAFT);
    }

    tracker.reset();
    tracker.startCapture();
    await page.locator("[data-testid='vp-submit-btn']").click();
    await expect(page.locator("[data-testid='vp-confirm-fields']")).toBeVisible({ timeout: 60000 });
    await tracker.waitForSettled(3000);
    tracker.assertCallCount("extract-fields", 1);
    tracker.assertNoCancelled();
    tracker.assertAllSucceeded();
    await assertStable(page, "[data-testid='vp-confirm-fields']", { duration: 3000, checkInterval: 250 });
    const mutations = await countDOMMutations(page, "[data-testid='vp-confirm-fields']", { duration: 3000, checkInterval: 200 });
    expect(mutations).toBeLessThan(10);
    monitor.assertClean("Step 5: VP Coach 对话");

    tracker.reset();
    tracker.startCapture();
    await page.locator("[data-testid='vp-confirm-btn']").click();
    await expect(page.locator("[data-testid='r1-results-container']")).toBeVisible({ timeout: 60000 });
    await tracker.waitForSettled(1000);
    tracker.assertNoCancelled();
    tracker.assertAllSucceeded();
    return { domMutations: mutations };
  });

  await runStep("Step 6: 结果页展示", async () => {
    const results = page.locator("[data-testid='r1-results-container']");
    await expect(results).toBeVisible();
    await expect(results.getByText(/Margin Headroom|毛利空间|支付意愿|VP 综合评分/)).toBeVisible();
    await assertStable(page, "[data-testid='r1-results-container']", { duration: 1500, checkInterval: 200 });
    tracker.reset();
    tracker.startCapture();
    await page.waitForTimeout(5000);
    const apiCalls = findApiCalls(tracker, "/api/");
    expect(apiCalls.every((call) => call.url.includes("/api/team/") && call.url.includes("/status"))).toBeTruthy();
    monitor.assertClean("Step 6: 结果页展示");
    return {};
  });

  if (freezeAtEnd) {
    await runStep("Step R2-0: 推进到 Round 2", async () => {
      tracker.startCapture();
      await page.locator("[data-testid='r1-freeze-btn']").click();
      await expect(page.locator("[data-testid='r2-recap-container']")).toBeVisible({ timeout: 60000 });
      await tracker.waitForSettled(1000);
      expect(findApiCalls(tracker, "/freeze")).toHaveLength(1);
      tracker.assertNoCancelled();
      tracker.assertAllSucceeded();
      monitor.assertClean("Step R2-0: 推进到 Round 2");
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
    tracker.assertAllSucceeded();
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
  ROUND1_VP_DRAFT,
  ROUND2_INTERVIEW_SCRIPT,
  resolveBaseUrl,
  createStepRunner,
  runRound1Flow,
  runRound2Flow,
  saveExportArtifacts
};
