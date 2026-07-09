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

async function bootstrapRound2Team(request, interviewMode) {
  const baseUrl = resolveBaseUrl();
  const skipRes = await request.get(`${baseUrl}/api/test/skip-to-r2`);
  expect(skipRes.status()).toBe(200);
  const skipJson = await skipRes.json();
  expect(skipJson.ok).toBeTruthy();

  const adminCode = readAdminCode();
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
      memberCount: 1,
      session_id: "default"
    }
  });
  expect(assignRes.status()).toBe(200);
  const assignJson = await assignRes.json();
  expect(assignJson.ok).toBeTruthy();

  return {
    teamId: skipJson.team_id,
    memberId: skipJson.member_id,
    round2Url: `${baseUrl}/multiplayer/round2?teamId=${encodeURIComponent(skipJson.team_id)}&memberId=${encodeURIComponent(skipJson.member_id)}&session_id=default`
  };
}

test.describe.serial("Round 2 summary/live gating", () => {
  test("summary mode keeps card selection unlocked after reading report", async ({ page, request }) => {
    const ctx = await bootstrapRound2Team(request, "summary");
    await page.goto(ctx.round2Url);
    await expect(page.locator("[data-testid='r2-recap-container']")).toBeVisible({ timeout: 30000 });
    await page.getByRole("button", { name: "进入第二轮 →" }).click();
    await expect(page.locator("[data-testid='r2-interview-container']")).toBeVisible({ timeout: 30000 });
    const continueButton = page.getByRole("button", { name: "继续，进入个人选卡 →" });
    await expect(continueButton).toBeVisible({ timeout: 30000 });
    await continueButton.click();
    await expect(page.locator("[data-testid='r2-card-selection-container']")).toBeVisible({ timeout: 30000 });
    await page.waitForTimeout(4000);
    await expect(page.locator("[data-testid='r2-card-selection-container']")).toBeVisible({ timeout: 10000 });
  });

  test("live mode still stays in interview stage before interview completion", async ({ page, request }) => {
    const ctx = await bootstrapRound2Team(request, "live");
    await page.goto(ctx.round2Url);
    await expect(page.locator("[data-testid='r2-interview-container']")).toBeVisible({ timeout: 30000 });
    await expect(page.getByRole("button", { name: /开始第一场访谈/ })).toBeVisible({ timeout: 30000 });
    await page.waitForTimeout(4000);
    await expect(page.locator("[data-testid='r2-interview-container']")).toBeVisible({ timeout: 10000 });
    await expect(page.locator("[data-testid='r2-card-selection-container']")).toHaveCount(0);
  });
});
