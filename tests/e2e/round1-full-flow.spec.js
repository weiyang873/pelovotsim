const { test } = require("@playwright/test");
const { createConsoleMonitor } = require("./helpers/consoleMonitor");
const { createNetworkTracker } = require("./helpers/networkTracker");
const { generateReport } = require("./helpers/reportGenerator");
const { resolveBaseUrl, runRound1Flow } = require("./helpers/flowHelpers");

test.describe.serial("Round 1 Full Flow E2E", () => {
  let context;
  let page;
  let monitor;
  let tracker;
  let stepResults = [];
  let suiteStartedAt = 0;
  let teamId = "";

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
      teamId,
      duration_ms: Date.now() - suiteStartedAt,
      steps: stepResults
    });
    tracker?.dispose();
    monitor?.dispose();
    await context?.close();
  });

  test("Round 1 steps 1-6", async ({ request }) => {
    const result = await runRound1Flow({
      page,
      request,
      monitor,
      tracker,
      stepResults
    });
    teamId = result.teamId;
  });
});
