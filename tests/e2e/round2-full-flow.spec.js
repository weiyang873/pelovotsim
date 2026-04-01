const { test, expect } = require("@playwright/test");
const { createConsoleMonitor } = require("./helpers/consoleMonitor");
const { createNetworkTracker } = require("./helpers/networkTracker");
const { generateReport } = require("./helpers/reportGenerator");
const { resolveBaseUrl, runRound1Flow, runRound2Flow } = require("./helpers/flowHelpers");

test.describe.serial("Round 2 Full Flow E2E", () => {
  let context;
  let page;
  let monitor;
  let tracker;
  let stepResults = [];
  let suiteStartedAt = 0;
  let flowContext = null;

  test.beforeAll(async ({ browser }) => {
    suiteStartedAt = Date.now();
    context = await browser.newContext({ ignoreHTTPSErrors: true });
    page = await context.newPage();
    monitor = createConsoleMonitor(page);
    tracker = createNetworkTracker(page);
  });

  test.afterAll(async () => {
    generateReport({
      targetUrl: resolveBaseUrl(),
      teamId: flowContext?.teamId || "",
      duration_ms: Date.now() - suiteStartedAt,
      steps: stepResults
    });
    tracker?.dispose();
    monitor?.dispose();
    await context?.close();
  });

  test("Round 1 -> Round 2 full path", async ({ request }) => {
    flowContext = await runRound1Flow({
      page,
      request,
      monitor,
      tracker,
      stepResults,
      freezeAtEnd: true
    });
    await runRound2Flow({
      page,
      request,
      monitor,
      tracker,
      stepResults,
      context: flowContext
    });
  });

  test.fixme("AI 反思报告 UI", async () => {
    expect(true).toBe(false);
  });
});
