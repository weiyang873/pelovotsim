"use strict";

const fs = require("node:fs");
const path = require("node:path");

function ensureDir(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function isPassed(result) {
  return result && result.status === "passed" && Array.isArray(result.errors) && result.errors.length === 0;
}

function generateReport(results, filePath, meta = {}) {
  const normalized = results.map((item, index) => {
    if (item && item.status === "fulfilled") {
      return item.value;
    }
    return {
      teamIndex: index,
      status: "failed",
      teamId: "",
      steps: {},
      timing: {},
      warnings: [],
      skips: [],
      errors: [{ message: String(item?.reason?.message || item?.reason || "Unknown failure") }]
    };
  });

  const report = {
    timestamp: new Date().toISOString(),
    summary: {
      total: normalized.length,
      passed: normalized.filter((item) => isPassed(item)).length,
      failed: normalized.filter((item) => !isPassed(item)).length,
      skipped_steps: normalized.reduce((sum, item) => sum + (Array.isArray(item.skips) ? item.skips.length : 0), 0)
    },
    meta: {
      ...meta
    },
    teams: normalized
  };

  ensureDir(filePath);
  fs.writeFileSync(filePath, JSON.stringify(report, null, 2));
  return report;
}

module.exports = {
  generateReport
};
