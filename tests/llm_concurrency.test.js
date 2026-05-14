const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const https = require("node:https");
const { EventEmitter } = require("node:events");

const CLIENT_MODULE_PATH = require.resolve("../server/llm/deepseekClient");
const MANAGED_ENV = [
  /^DEEPSEEK_API_KEY(?:_\d+)?$/,
  /^DEEPSEEK_BASE_URL$/,
  /^DEEPSEEK_MODEL$/,
  /^DEEPSEEK_TIMEOUT_MS$/,
  /^LLM_CONCURRENCY$/,
  /^LLM_MAX_RETRIES$/,
];

function isManagedEnv(key) {
  return MANAGED_ENV.some((pattern) => pattern.test(key));
}

function snapshotEnv() {
  const out = new Map();
  for (const [key, value] of Object.entries(process.env)) {
    if (isManagedEnv(key)) out.set(key, value);
  }
  return out;
}

function restoreEnv(snapshot) {
  for (const key of Object.keys(process.env)) {
    if (isManagedEnv(key)) delete process.env[key];
  }
  for (const [key, value] of snapshot.entries()) {
    process.env[key] = value;
  }
}

function silenceConsole() {
  const originalLog = console.log;
  const originalWarn = console.warn;
  const originalError = console.error;
  console.log = () => {};
  console.warn = () => {};
  console.error = () => {};
  return () => {
    console.log = originalLog;
    console.warn = originalWarn;
    console.error = originalError;
  };
}

function loadFreshClient(envOverrides = {}) {
  const snapshot = snapshotEnv();
  const originalCache = require.cache[CLIENT_MODULE_PATH];
  const restoreConsole = silenceConsole();

  restoreEnv(new Map());
  for (const [key, value] of Object.entries(envOverrides)) {
    process.env[key] = String(value);
  }

  delete require.cache[CLIENT_MODULE_PATH];
  const client = require("../server/llm/deepseekClient");

  return {
    client,
    restore() {
      delete require.cache[CLIENT_MODULE_PATH];
      if (originalCache) require.cache[CLIENT_MODULE_PATH] = originalCache;
      restoreEnv(snapshot);
      restoreConsole();
    }
  };
}

function withMockedTransport(handler, fn) {
  const originalHttpRequest = http.request;
  const originalHttpsRequest = https.request;

  function patchedRequest(options, callback) {
    const listeners = new Map();
    let body = "";

    const request = {
      setTimeout(_ms, _handler) {},
      on(event, handlerFn) {
        listeners.set(event, handlerFn);
        return request;
      },
      write(chunk) {
        body += String(chunk);
      },
      end() {
        Promise.resolve()
          .then(() => handler({ options, body }))
          .then((result) => {
            if (result?.error) {
              const onError = listeners.get("error");
              if (onError) onError(result.error);
              return;
            }
            const response = new EventEmitter();
            response.statusCode = Number(result?.statusCode || 200);
            callback(response);
            if (result?.body != null) {
              response.emit("data", typeof result.body === "string" ? result.body : JSON.stringify(result.body));
            }
            response.emit("end");
          })
          .catch((error) => {
            const onError = listeners.get("error");
            if (onError) onError(error);
          });
      },
      destroy(error) {
        const onError = listeners.get("error");
        if (onError) onError(error);
      }
    };

    return request;
  }

  http.request = patchedRequest;
  https.request = patchedRequest;

  return Promise.resolve()
    .then(fn)
    .finally(() => {
      http.request = originalHttpRequest;
      https.request = originalHttpsRequest;
    });
}

function withFastTimers(fn) {
  const originalSetTimeout = global.setTimeout;
  global.setTimeout = (callback, _delay, ...args) => originalSetTimeout(callback, 5, ...args);
  return Promise.resolve()
    .then(fn)
    .finally(() => {
      global.setTimeout = originalSetTimeout;
    });
}

function parseBody(body) {
  return JSON.parse(String(body || "{}"));
}

test("LLM concurrency gate caps burst load at configured limit", { concurrency: false }, async () => {
  let active = 0;
  let maxActive = 0;

  await withMockedTransport(async () => {
    active += 1;
    maxActive = Math.max(maxActive, active);
    await new Promise((resolve) => setTimeout(resolve, 20));
    active -= 1;
    return {
      statusCode: 200,
      body: { choices: [{ message: { content: "ok" } }] }
    };
  }, async () => {
    const loaded = loadFreshClient({
      DEEPSEEK_API_KEY: "test-key",
      DEEPSEEK_BASE_URL: "http://deepseek.test",
      LLM_CONCURRENCY: "10",
      LLM_MAX_RETRIES: "0"
    });
    try {
      await Promise.all(
        Array.from({ length: 30 }, (_, index) => loaded.client.chatCompletion([
          { role: "user", content: `burst-${index}` }
        ]))
      );
    } finally {
      loaded.restore();
    }
  });

  assert.ok(maxActive <= 10, `expected max concurrent requests <= 10, got ${maxActive}`);
});

test("LLM concurrency gate can force sequential execution", { concurrency: false }, async () => {
  let active = 0;
  let maxActive = 0;

  await withMockedTransport(async () => {
    active += 1;
    maxActive = Math.max(maxActive, active);
    await new Promise((resolve) => setTimeout(resolve, 10));
    active -= 1;
    return {
      statusCode: 200,
      body: { choices: [{ message: { content: "ok" } }] }
    };
  }, async () => {
    const loaded = loadFreshClient({
      DEEPSEEK_API_KEY: "test-key",
      DEEPSEEK_BASE_URL: "http://deepseek.test",
      LLM_CONCURRENCY: "1",
      LLM_MAX_RETRIES: "0"
    });
    try {
      await Promise.all(
        Array.from({ length: 6 }, (_, index) => loaded.client.chatCompletion([
          { role: "user", content: `serial-${index}` }
        ]))
      );
    } finally {
      loaded.restore();
    }
  });

  assert.equal(maxActive, 1);
});

test("LLM_MAX_RETRIES env config is respected while per-call override still wins", { concurrency: false }, async () => {
  let requestCount = 0;
  await withMockedTransport(() => {
    requestCount += 1;
    return {
      statusCode: 429,
      body: { error: { message: "rate limit" } }
    };
  }, async () => {
    const loaded = loadFreshClient({
      DEEPSEEK_API_KEY: "test-key",
      DEEPSEEK_BASE_URL: "http://deepseek.test",
      LLM_CONCURRENCY: "1",
      LLM_MAX_RETRIES: "0"
    });
    try {
      await assert.rejects(
        loaded.client.chatCompletion([{ role: "user", content: "no-retry" }]),
        /rate limit/
      );
      assert.equal(requestCount, 1);
      await assert.rejects(
        loaded.client.chatCompletion([{ role: "user", content: "override" }], { maxRetries: 2 }),
        /rate limit/
      );
      assert.equal(requestCount, 4);
    } finally {
      loaded.restore();
    }
  });
});

test("retry backoff keeps the semaphore slot until the call finishes", { concurrency: false }, async () => {
  const order = [];
  const attempts = new Map();

  await withMockedTransport(({ body }) => {
    const message = String(parseBody(body)?.messages?.[0]?.content || "");
    const attempt = (attempts.get(message) || 0) + 1;
    attempts.set(message, attempt);
    order.push(`${message}:${attempt}`);

    if (message === "A" && attempt === 1) {
      return {
        statusCode: 429,
        body: { error: { message: "rate limit" } }
      };
    }
    return {
      statusCode: 200,
      body: { choices: [{ message: { content: `${message}-ok` } }] }
    };
  }, async () => {
    const loaded = loadFreshClient({
      DEEPSEEK_API_KEY: "test-key",
      DEEPSEEK_BASE_URL: "http://deepseek.test",
      LLM_CONCURRENCY: "1",
      LLM_MAX_RETRIES: "1"
    });
    try {
      await withFastTimers(() => Promise.all([
        loaded.client.chatCompletion([{ role: "user", content: "A" }]),
        loaded.client.chatCompletion([{ role: "user", content: "B" }])
      ]));
    } finally {
      loaded.restore();
    }
  });

  assert.deepEqual(order, ["A:1", "A:2", "B:1"]);
});
