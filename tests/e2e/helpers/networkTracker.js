function createNetworkTracker(page) {
  const calls = [];
  const requestToCall = new Map();
  let captureStartedAt = 0;
  let lastActivityAt = 0;

  const touch = () => {
    lastActivityAt = Date.now();
  };

  const onRequest = (request) => {
    const call = {
      url: request.url(),
      method: request.method(),
      status: null,
      cancelled: false,
      timestamp: Date.now(),
      duration_ms: null
    };
    requestToCall.set(request, call);
    calls.push(call);
    touch();
  };

  const onResponse = (response) => {
    const request = response.request();
    const call = requestToCall.get(request);
    if (!call) return;
    call.status = response.status();
    call.duration_ms = Date.now() - call.timestamp;
    touch();
  };

  const onRequestFailed = (request) => {
    const call = requestToCall.get(request);
    if (!call) return;
    const errorText = String(request.failure()?.errorText || "");
    call.cancelled = errorText.includes("net::ERR_ABORTED");
    call.failure = errorText || null;
    call.duration_ms = Date.now() - call.timestamp;
    touch();
  };

  page.on("request", onRequest);
  page.on("response", onResponse);
  page.on("requestfailed", onRequestFailed);

  function startCapture() {
    captureStartedAt = Date.now();
    lastActivityAt = captureStartedAt;
  }

  function reset() {
    calls.length = 0;
    requestToCall.clear();
    captureStartedAt = 0;
    lastActivityAt = 0;
  }

  function isIgnoredUrl(url, ignoreUrls) {
    return ignoreUrls.some((pattern) => {
      if (!pattern) return false;
      if (pattern instanceof RegExp) return pattern.test(url);
      return String(url || "").includes(String(pattern));
    });
  }

  function getLastRelevantActivity(ignoreUrls) {
    return getCalls().reduce((latest, call) => {
      if (isIgnoredUrl(call.url, ignoreUrls)) {
        return latest;
      }
      const completedAt = call.duration_ms == null
        ? call.timestamp
        : call.timestamp + Math.max(0, Number(call.duration_ms || 0));
      return Math.max(latest, completedAt);
    }, captureStartedAt || Date.now());
  }

  async function waitForSettled(ms, options = {}) {
    if (!captureStartedAt) {
      startCapture();
    }
    const ignoreUrls = Array.isArray(options.ignoreUrls) ? options.ignoreUrls : [];
    const timeoutMs = Math.max(ms, Number(options.timeoutMs || Math.max(ms * 4, 10000)));
    const startedAt = Date.now();
    while (true) {
      const lastRelevantActivityAt = ignoreUrls.length
        ? getLastRelevantActivity(ignoreUrls)
        : lastActivityAt;
      const idleFor = Date.now() - lastRelevantActivityAt;
      if (idleFor >= ms) return;
      if (Date.now() - startedAt >= timeoutMs) {
        const recentCalls = getCalls()
          .filter((call) => !isIgnoredUrl(call.url, ignoreUrls))
          .slice(-5)
          .map((call) => `${call.method} ${call.url} -> ${call.status}`)
          .join(", ");
        throw new Error(
          `Network did not settle within ${timeoutMs}ms` +
          (recentCalls ? `; recent calls: ${recentCalls}` : "")
        );
      }
      await page.waitForTimeout(Math.min(100, ms - idleFor));
    }
  }

  function getCalls() {
    return calls
      .filter((call) => !captureStartedAt || call.timestamp >= captureStartedAt)
      .map((call) => ({ ...call }));
  }

  function assertCallCount(urlPattern, expected) {
    const matched = getCalls().filter((call) => call.url.includes(urlPattern));
    if (matched.length !== expected) {
      throw new Error(
        `Expected ${expected} calls for "${urlPattern}", received ${matched.length}`
      );
    }
  }

  function assertNoCancelled(options = {}) {
    const ignoreUrls = Array.isArray(options.ignoreUrls) ? options.ignoreUrls : [];
    const cancelled = getCalls().filter((call) => !isIgnoredUrl(call.url, ignoreUrls) && call.cancelled);
    if (cancelled.length) {
      throw new Error(
        `Cancelled requests detected: ${cancelled.map((call) => call.url).join(", ")}`
      );
    }
  }

  function assertAllSucceeded(options = {}) {
    const ignoreUrls = Array.isArray(options.ignoreUrls) ? options.ignoreUrls : [];
    const failed = getCalls().filter((call) => {
      if (isIgnoredUrl(call.url, ignoreUrls)) {
        return false;
      }
      return call.status == null || call.status < 200 || call.status >= 300;
    });
    if (failed.length) {
      throw new Error(
        `Non-2xx requests detected: ${failed.map((call) => `${call.method} ${call.url} -> ${call.status}`).join(", ")}`
      );
    }
  }

  function dispose() {
    page.off("request", onRequest);
    page.off("response", onResponse);
    page.off("requestfailed", onRequestFailed);
  }

  return {
    startCapture,
    waitForSettled,
    getCalls,
    reset,
    assertCallCount,
    assertNoCancelled,
    assertAllSucceeded,
    dispose
  };
}

module.exports = {
  createNetworkTracker
};
