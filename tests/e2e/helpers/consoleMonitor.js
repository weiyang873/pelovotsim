const { expect } = require("@playwright/test");

function normalizeText(value) {
  return String(value || "").trim();
}

function shouldIgnoreDuplicateFetch(entry) {
  const method = String(entry?.method || "").toUpperCase();
  const url = String(entry?.url || "");
  if (method !== "GET") return false;
  return /\/api\/team\/[^/]+\/(?:status|phase3\/state)(?:\?|$)/.test(url)
    || /\/api\/round2\/(?:state|interview\/session|team-merge)(?:\?|$)/.test(url);
}

function findDuplicateFetches(fetchLog, windowMs = 500) {
  const duplicates = [];
  const sorted = [...fetchLog]
    .filter((item) => item && item.url && !shouldIgnoreDuplicateFetch(item))
    .sort((a, b) => a.timestamp - b.timestamp);

  for (let i = 0; i < sorted.length; i += 1) {
    for (let j = i + 1; j < sorted.length; j += 1) {
      const delta = sorted[j].timestamp - sorted[i].timestamp;
      if (delta > windowMs) break;
      if (sorted[i].url === sorted[j].url) {
        duplicates.push(`${sorted[i].url} (${delta}ms)`);
      }
    }
  }

  return Array.from(new Set(duplicates));
}

function createConsoleMonitor(page) {
  const state = {
    warnings: [],
    errors: [],
    reactKeyWarnings: [],
    stateAfterUnmount: [],
    fetchLog: []
  };

  const onConsole = (msg) => {
    const type = msg.type();
    const text = normalizeText(msg.text());
    if (!text) return;

    if (type === "warning" || type === "warn") {
      state.warnings.push(text);
      if (text.includes("Each child in a list") || /\bkey\b/i.test(text)) {
        state.reactKeyWarnings.push(text);
      }
      return;
    }

    if (type === "error") {
      state.errors.push(text);
      if (
        text.includes("Can't perform a React state update") ||
        text.toLowerCase().includes("unmounted")
      ) {
        state.stateAfterUnmount.push(text);
      }
    }
  };

  const onRequest = (request) => {
    state.fetchLog.push({
      method: request.method(),
      url: request.url(),
      timestamp: Date.now()
    });
  };

  page.on("console", onConsole);
  page.on("request", onRequest);

  function reset() {
    state.warnings = [];
    state.errors = [];
    state.reactKeyWarnings = [];
    state.stateAfterUnmount = [];
    state.fetchLog = [];
  }

  function getReport() {
    return {
      warnings: [...state.warnings],
      errors: [...state.errors],
      reactKeyWarnings: [...state.reactKeyWarnings],
      stateAfterUnmount: [...state.stateAfterUnmount],
      duplicateApiFetches: findDuplicateFetches(state.fetchLog)
    };
  }

  function assertClean(stepName) {
    const report = getReport();
    if (report.reactKeyWarnings.length) {
      throw new Error(
        `${stepName}: React key warning\n${report.reactKeyWarnings.join("\n")}`
      );
    }
    if (report.stateAfterUnmount.length) {
      throw new Error(
        `${stepName}: state update after unmount\n${report.stateAfterUnmount.join("\n")}`
      );
    }
    if (report.duplicateApiFetches.length) {
      throw new Error(
        `${stepName}: duplicate API call\n${report.duplicateApiFetches.join("\n")}`
      );
    }
    expect(report.errors, `${stepName}: console errors`).toEqual([]);
  }

  function dispose() {
    page.off("console", onConsole);
    page.off("request", onRequest);
  }

  return {
    getReport,
    reset,
    assertClean,
    dispose
  };
}

module.exports = {
  createConsoleMonitor
};
