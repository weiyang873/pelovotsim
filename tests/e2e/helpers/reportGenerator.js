const fs = require("node:fs");
const path = require("node:path");

function makeRunId(date = new Date()) {
  const iso = date.toISOString().replace(/[-:]/g, "").replace(/\..+/, "");
  return `e2e-${iso.slice(0, 8)}-${iso.slice(9, 15)}`;
}

function buildSummary(steps) {
  const safeSteps = Array.isArray(steps) ? steps : [];
  return safeSteps.reduce((acc, step) => {
    acc.totalSteps += 1;
    if (step.passed) acc.passed += 1;
    else acc.failed += 1;
    acc.totalConsoleErrors += (step.console?.errors || []).length;
    acc.totalReactKeyWarnings += (step.console?.reactKeyWarnings || []).length;
    acc.totalDuplicateRequests += (step.network?.duplicates || []).length;
    acc.totalCancelledRequests += (step.network?.cancelled || []).length;
    return acc;
  }, {
    totalSteps: 0,
    passed: 0,
    failed: 0,
    totalConsoleErrors: 0,
    totalReactKeyWarnings: 0,
    totalDuplicateRequests: 0,
    totalCancelledRequests: 0
  });
}

function generateReport({
  targetUrl,
  teamId = "",
  duration_ms = 0,
  steps = [],
  runId = makeRunId(),
  reportsDir = path.join(process.cwd(), "tests", "e2e", "reports")
}) {
  fs.mkdirSync(reportsDir, { recursive: true });
  const payload = {
    runId,
    timestamp: new Date().toISOString(),
    targetUrl,
    teamId,
    duration_ms,
    steps,
    summary: buildSummary(steps)
  };
  const filename = `e2e-report-${payload.timestamp.replace(/[:.]/g, "-")}.json`;
  const outputPath = path.join(reportsDir, filename);
  fs.writeFileSync(outputPath, JSON.stringify(payload, null, 2));
  return outputPath;
}

module.exports = {
  generateReport
};
