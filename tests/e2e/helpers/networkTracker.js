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

  async function waitForSettled(ms) {
    if (!captureStartedAt) {
      startCapture();
    }
    while (true) {
      const idleFor = Date.now() - lastActivityAt;
      if (idleFor >= ms) return;
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

  function assertNoCancelled() {
    const cancelled = getCalls().filter((call) => call.cancelled);
    if (cancelled.length) {
      throw new Error(
        `Cancelled requests detected: ${cancelled.map((call) => call.url).join(", ")}`
      );
    }
  }

  function assertAllSucceeded() {
    const failed = getCalls().filter((call) => call.status == null || call.status < 200 || call.status >= 300);
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
