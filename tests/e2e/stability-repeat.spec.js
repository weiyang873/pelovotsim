const { test, expect } = require("@playwright/test");
const { createConsoleMonitor } = require("./helpers/consoleMonitor");
const { createNetworkTracker } = require("./helpers/networkTracker");
const { runRound1Flow, runRound2Flow, saveExportArtifacts } = require("./helpers/flowHelpers");

for (let index = 1; index <= 3; index += 1) {
  test(`Stability run ${index}/3: Full R1+R2 flow`, async ({ browser, request }) => {
    const context = await browser.newContext({ ignoreHTTPSErrors: true });
    const page = await context.newPage();
    const monitor = createConsoleMonitor(page);
    const tracker = createNetworkTracker(page);
    const stepResults = [];

    try {
      const flowContext = await runRound1Flow({
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
      const { jsonData } = await saveExportArtifacts(request, flowContext.teamId);
      expect(jsonData.scoring.vpScore).toBeGreaterThan(0);
      expect(Number(jsonData.results.target_gm || 0)).toBeGreaterThan(0);
      expect(Number.isNaN(Number(jsonData.round2?.calculations?.profit))).toBeFalsy();
    } finally {
      tracker.dispose();
      monitor.dispose();
      await context.close();
    }
  });
}
