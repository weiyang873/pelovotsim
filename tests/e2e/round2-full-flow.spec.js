const { test, expect } = require("@playwright/test");
const { createConsoleMonitor } = require("./helpers/consoleMonitor");
const { createNetworkTracker } = require("./helpers/networkTracker");
const { generateReport } = require("./helpers/reportGenerator");
const { resolveBaseUrl, runRound1Flow, runRound2Flow } = require("./helpers/flowHelpers");

const ROUND1_CONFIRMED_FIELD_FALLBACKS = {
  who_raw: "独居城市白领",
  pain_raw: "下班回家后感到孤独和情绪低落",
  how_raw: "通过主动迎接、情感交互和情绪陪伴，缓解独居人群回家后的孤独感"
};

test.describe.serial("Round 2 Full Flow E2E", () => {
  test.describe.configure({ timeout: 20 * 60 * 1000 });
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
      freezeAtEnd: true,
      confirmedFieldFallbacks: ROUND1_CONFIRMED_FIELD_FALLBACKS
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
