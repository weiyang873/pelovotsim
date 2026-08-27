const fs = require("node:fs");
const path = require("node:path");
const { test, expect } = require("@playwright/test");

function resolveBaseUrl() {
  return process.env.BASE_URL || process.env.TEST_URL || "http://localhost:8787";
}

function readAdminCode() {
  if (process.env.ADMIN_CODE) return String(process.env.ADMIN_CODE).trim();
  const envPath = path.join(process.cwd(), ".env");
  if (!fs.existsSync(envPath)) {
    throw new Error("ADMIN_CODE not configured for e2e");
  }
  const content = fs.readFileSync(envPath, "utf8");
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (key !== "ADMIN_CODE") continue;
    if (
      (value.startsWith("\"") && value.endsWith("\""))
      || (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    return value.trim();
  }
  throw new Error("ADMIN_CODE not found in .env");
}

async function bootstrapRound2Team(request, interviewMode, options = {}) {
  const baseUrl = resolveBaseUrl();
  const teamSize = Math.max(1, Number(options.teamSize || 1));
  const adminCode = readAdminCode();
  const skipRes = await request.get(`${baseUrl}/api/test/skip-to-r2?teamSize=${encodeURIComponent(String(teamSize))}`, {
    headers: {
      "x-teacher-code": adminCode
    }
  });
  expect(skipRes.status()).toBe(200);
  const skipJson = await skipRes.json();
  expect(skipJson.ok).toBeTruthy();

  const configRes = await request.post(`${baseUrl}/api/teacher/session-config`, {
    headers: {
      "Content-Type": "application/json",
      "x-teacher-code": adminCode
    },
    data: {
      session_id: "default",
      config: {
        interview_mode: interviewMode,
        hold_before_r2: false
      }
    }
  });
  expect(configRes.status()).toBe(200);
  const configJson = await configRes.json();
  expect(configJson.ok).toBeTruthy();

  const assignRes = await request.post(`${baseUrl}/api/round2/assign-dimensions`, {
    headers: { "Content-Type": "application/json" },
    data: {
      teamId: skipJson.team_id,
      memberCount: teamSize,
      session_id: "default"
    }
  });
  expect(assignRes.status()).toBe(200);
  const assignJson = await assignRes.json();
  expect(assignJson.ok).toBeTruthy();

  return {
    teamId: skipJson.team_id,
    memberId: skipJson.member_id,
    members: Array.isArray(skipJson.member_links) ? skipJson.member_links : [],
    round2Url: `${baseUrl}/multiplayer/round2?teamId=${encodeURIComponent(skipJson.team_id)}&memberId=${encodeURIComponent(skipJson.member_id)}&session_id=default`
  };
}

async function clickRound2RecapContinue(page) {
  const interview = page.locator("[data-testid='r2-interview-container']");
  try {
    await expect(interview).toBeVisible({ timeout: 30000 });
    return;
  } catch (_err) {
    // Older flows may still pause on the Round 2 recap screen first.
  }
  const recap = page.locator("[data-testid='r2-recap-container']");
  await expect(recap).toBeVisible({ timeout: 30000 });
  await recap.evaluate((root) => {
    const button = Array.from(root.querySelectorAll("button"))
      .find((item) => String(item.textContent || "").trim() === "继续");
    if (!button) throw new Error("Round 2 recap continue button not found");
    button.click();
  });
}

async function selectEnabledCardCheckboxes(root, targetCount) {
  const checkboxes = root.locator("input[type='checkbox']");
  let selectedCount = 0;
  for (let index = 0; index < await checkboxes.count(); index += 1) {
    if (selectedCount >= targetCount) break;
    const checkbox = checkboxes.nth(index);
    if (await checkbox.isDisabled().catch(() => true)) continue;
    if (await checkbox.isChecked().catch(() => false)) continue;
    await checkbox.click();
    selectedCount += 1;
  }
  expect(selectedCount).toBe(targetCount);
}

async function completeSummaryReading(page) {
  await clickRound2RecapContinue(page);
  await expect(page.locator("[data-testid='r2-interview-container']")).toBeVisible({ timeout: 30000 });
  await expect(page.getByText("你已阅读 1/3 份")).toBeVisible({ timeout: 30000 });
  await page.getByRole("button", { name: "完成阅读，等待团队" }).click();
  await expect(page.locator("[data-testid='r2-card-selection-container']")).toBeVisible({ timeout: 30000 });
}

test.describe.serial("Round 2 summary/live gating", () => {
  test("summary mode defaults to first report and one-member team enters cards after personal reading", async ({ page, request }) => {
    const ctx = await bootstrapRound2Team(request, "summary");
    await page.goto(ctx.round2Url);
    await clickRound2RecapContinue(page);
    await expect(page.locator("[data-testid='r2-interview-container']")).toBeVisible({ timeout: 30000 });
    await expect(page.getByText("你已阅读 1/3 份")).toBeVisible({ timeout: 30000 });
    await expect(page.locator("[data-testid='r2-interview-container'] strong").first()).toBeVisible({ timeout: 30000 });
    await expect(page.getByText(/交互与表达：|感知与理解：|运动与导航：|安全与信任：|可扩展与连接：|可运营与可维护：/)).toHaveCount(0);
    const completeReadingButton = page.getByRole("button", { name: "完成阅读，等待团队" });
    await expect(completeReadingButton).toBeVisible({ timeout: 30000 });
    await completeReadingButton.click();
    await expect(page.locator("[data-testid='r2-card-selection-container']")).toBeVisible({ timeout: 30000 });
    await expect(page.getByText("团队调研汇总").first()).toHaveCount(0);
    await expect(page.getByText(/交互与表达：|感知与理解：|运动与导航：|安全与信任：|可扩展与连接：|可运营与可维护：/)).toHaveCount(0);
    await page.waitForTimeout(4000);
    await expect(page.locator("[data-testid='r2-card-selection-container']")).toBeVisible({ timeout: 10000 });
  });

  test("summary mode shows team reading matrix for two members", async ({ browser, request }) => {
    const ctx = await bootstrapRound2Team(request, "summary", { teamSize: 2 });
    const [memberA, memberB] = ctx.members;
    expect(memberA?.member_id).toBeTruthy();
    expect(memberB?.member_id).toBeTruthy();

    const contextA = await browser.newContext();
    const contextB = await browser.newContext();
    const pageA = await contextA.newPage();
    const pageB = await contextB.newPage();
    try {
      await pageA.goto(`${resolveBaseUrl()}/multiplayer/round2?teamId=${encodeURIComponent(ctx.teamId)}&memberId=${encodeURIComponent(memberA.member_id)}&session_id=default`);
      await pageB.goto(`${resolveBaseUrl()}/multiplayer/round2?teamId=${encodeURIComponent(ctx.teamId)}&memberId=${encodeURIComponent(memberB.member_id)}&session_id=default`);
      await clickRound2RecapContinue(pageA);
      await clickRound2RecapContinue(pageB);
      await expect(pageA.getByText("你已阅读 1/3 份")).toBeVisible({ timeout: 30000 });
      await expect(pageB.getByText("你已阅读 1/3 份")).toBeVisible({ timeout: 30000 });

      await pageB.getByRole("button", { name: "查看另一位受访者" }).click();
      await expect(pageB.getByText("你已阅读 2/3 份")).toBeVisible({ timeout: 30000 });

      await pageA.getByRole("button", { name: "完成阅读，等待团队" }).click();
      await expect(pageA.getByText("团队调研汇总").first()).toBeVisible({ timeout: 30000 });

      await pageB.getByRole("button", { name: "完成阅读，等待团队" }).click();
      await expect(pageA.getByText("团队共覆盖 2/3 位受访者")).toBeVisible({ timeout: 30000 });
      await expect(pageA.getByRole("row", { name: /成员1 · 已完成/ })).toBeVisible({ timeout: 30000 });
      await expect(pageA.getByRole("row", { name: /成员2 · 已完成/ })).toBeVisible({ timeout: 30000 });
      await expect(pageA.getByRole("button", { name: /查看 .+/ }).first()).toBeVisible({ timeout: 30000 });

      await pageA.getByRole("button", { name: "继续，进入个人选卡" }).click();
      await expect(pageA.locator("[data-testid='r2-card-selection-container']")).toBeVisible({ timeout: 30000 });
    } finally {
      await contextA.close();
      await contextB.close();
    }
  });

  test("live mode still stays in interview stage before interview completion", async ({ page, request }) => {
    const ctx = await bootstrapRound2Team(request, "live");
    await page.goto(ctx.round2Url);
    await expect(page.locator("[data-testid='r2-interview-container']")).toBeVisible({ timeout: 30000 });
    await expect(page.getByText("深度用户访谈")).toBeVisible({ timeout: 30000 });
    await page.waitForTimeout(4000);
    await expect(page.locator("[data-testid='r2-interview-container']")).toBeVisible({ timeout: 10000 });
    await expect(page.locator("[data-testid='r2-card-selection-container']")).toHaveCount(0);
  });

  test("merge continue is disabled until the team has at least six cards", async ({ page, request }) => {
    const ctx = await bootstrapRound2Team(request, "summary");
    await page.goto(ctx.round2Url);
    await completeSummaryReading(page);

    await selectEnabledCardCheckboxes(page.locator("[data-testid='r2-card-selection-container']"), 5);
    await page.getByRole("button", { name: /提交个人选卡/ }).click();
    await expect(page.locator("[data-testid='r2-merge-container']")).toBeVisible({ timeout: 30000 });

    const mergeContinueBtn = page.locator("[data-testid='r2-merge-continue-btn']");
    await expect(mergeContinueBtn).toBeDisabled();
    await expect(mergeContinueBtn).toHaveText(/还需选 1 张能力卡/);

    await selectEnabledCardCheckboxes(page.locator("[data-testid='r2-merge-card-gate']"), 1);
    await expect(mergeContinueBtn).toBeEnabled();
    await expect(mergeContinueBtn).toHaveText(/^继续$/);
  });
});
