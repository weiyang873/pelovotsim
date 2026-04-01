const { test, expect } = require("@playwright/test");
const { createConsoleMonitor } = require("./helpers/consoleMonitor");
const { createNetworkTracker } = require("./helpers/networkTracker");
const { generateReport } = require("./helpers/reportGenerator");
const { resolveBaseUrl, runRound1Flow, runRound2Flow, saveExportArtifacts } = require("./helpers/flowHelpers");

test.describe.serial("Full Simulation: Round 1 + Round 2", () => {
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

  test("Round 1 + Round 2 complete flow", async ({ request }) => {
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

  test("Round transition: R1 data frozen correctly", async ({ request }) => {
    const res = await request.get(`${resolveBaseUrl()}/api/test/export/${encodeURIComponent(flowContext.teamId)}?format=json`, {
      headers: { "X-Test-Export": "true" }
    });
    expect(res.status()).toBe(200);
    const data = await res.json();
    expect(data.scoring.vpScore).toBeGreaterThan(0);
    expect(Number(data.results.target_gm || 0)).toBeGreaterThan(0);
  });

  test("Final: Cross-round data integrity", async ({ request }) => {
    const { jsonData } = await saveExportArtifacts(request, flowContext.teamId);
    expect(jsonData.team.teamId).toBe(flowContext.teamId);
    expect(jsonData.members.length).toBeGreaterThan(0);
    expect(jsonData.vpCoach.messages.length).toBeGreaterThanOrEqual(2);
    expect(jsonData.scoring.vpScore).toBeGreaterThan(0);
    expect(jsonData.results.marginHeadroom).toBeTruthy();
    expect(jsonData.round2).toBeTruthy();
    expect(jsonData.round2.interview.sessions.length).toBeGreaterThan(0);
    expect(jsonData.round2.selections.length).toBeGreaterThan(0);
    expect(Number.isNaN(Number(jsonData.round2.calculations.profit))).toBeFalsy();
    expect(Number(jsonData.round2.calculations.share || 0)).toBeGreaterThanOrEqual(0);
  });
});
