const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const https = require("node:https");
const { EventEmitter } = require("node:events");

const CLIENT_MODULE_PATH = require.resolve("../server/llm/deepseekClient");
const DEEPSEEK_ENV_PATTERNS = [
  /^LLM_PROVIDER$/,
  /^LLM_BASE_URL$/,
  /^LLM_MODEL$/,
  /^LLM_MODEL_OVERRIDE$/,
  /^LLM_DEFAULT_MODEL$/,
  /^LLM_DISABLE_THINKING$/,
  /^DEEPSEEK_API_KEY(?:_\d+)?$/,
  /^DEEPSEEK_BASE_URL$/,
  /^DEEPSEEK_MODEL$/,
  /^DEEPSEEK_TIMEOUT_MS$/,
  /^DEEPSEEK_DISABLE_THINKING$/,
  /^QWEN_API_KEY(?:_\d+)?$/,
  /^QWEN_BASE_URL$/,
  /^QWEN_MODEL$/,
  /^QWEN_TIMEOUT_MS$/,
  /^QWEN_DISABLE_THINKING$/,
  /^QWEN_ENABLE_THINKING$/,
  /^DASHSCOPE_API_KEY(?:_\d+)?$/,
  /^DASHSCOPE_BASE_URL$/,
  /^DASHSCOPE_MODEL$/,
];

function matchesManagedEnvKey(key) {
  return DEEPSEEK_ENV_PATTERNS.some((pattern) => pattern.test(key));
}

function snapshotManagedEnv() {
  const snapshot = new Map();
  for (const [key, value] of Object.entries(process.env)) {
    if (matchesManagedEnvKey(key)) {
      snapshot.set(key, value);
    }
  }
  return snapshot;
}

function restoreManagedEnv(snapshot) {
  for (const key of Object.keys(process.env)) {
    if (matchesManagedEnvKey(key)) {
      delete process.env[key];
    }
  }
  for (const [key, value] of snapshot.entries()) {
    process.env[key] = value;
  }
}

function withMockedConsole() {
  const originalLog = console.log;
  const originalWarn = console.warn;
  const originalError = console.error;
  const logs = [];
  const warns = [];
  const errors = [];

  console.log = (...args) => {
    logs.push(args.map((arg) => String(arg)).join(" "));
  };
  console.warn = (...args) => {
    warns.push(args.map((arg) => String(arg)).join(" "));
  };
  console.error = (...args) => {
    errors.push(args.map((arg) => String(arg)).join(" "));
  };

  return {
    logs,
    warns,
    errors,
    restore() {
      console.log = originalLog;
      console.warn = originalWarn;
      console.error = originalError;
    }
  };
}

function loadFreshClient(envOverrides = {}) {
  const envSnapshot = snapshotManagedEnv();
  const originalCache = require.cache[CLIENT_MODULE_PATH];
  const consoleMock = withMockedConsole();

  restoreManagedEnv(new Map());
  for (const [key, value] of Object.entries(envOverrides)) {
    if (value == null) continue;
    process.env[key] = String(value);
  }

  delete require.cache[CLIENT_MODULE_PATH];
  const client = require("../server/llm/deepseekClient");

  return {
    client,
    logs: consoleMock.logs,
    warns: consoleMock.warns,
    errors: consoleMock.errors,
    restore() {
      delete require.cache[CLIENT_MODULE_PATH];
      if (originalCache) {
        require.cache[CLIENT_MODULE_PATH] = originalCache;
      }
      restoreManagedEnv(envSnapshot);
      consoleMock.restore();
    }
  };
}

function withMockedTransport(handler, fn) {
  const originalHttpRequest = http.request;
  const originalHttpsRequest = https.request;

  function patchedRequest(options, callback) {
    const listeners = new Map();
    let timeoutHandler = null;
    let requestBody = "";

    const request = {
      setTimeout(_ms, handlerFn) {
        timeoutHandler = handlerFn;
      },
      on(event, handlerFn) {
        listeners.set(event, handlerFn);
        return request;
      },
      write(chunk) {
        requestBody += String(chunk);
      },
      end() {
        Promise.resolve()
          .then(() => handler({ options, body: requestBody, timeoutHandler }))
          .then((result) => {
            if (result?.error) {
              const errorHandler = listeners.get("error");
              if (errorHandler) errorHandler(result.error);
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
            const errorHandler = listeners.get("error");
            if (errorHandler) errorHandler(error);
          });
      },
      destroy(error) {
        const errorHandler = listeners.get("error");
        if (errorHandler) errorHandler(error);
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

function withImmediateSleep(fn) {
  const originalSetTimeout = global.setTimeout;
  global.setTimeout = (callback, _delay, ...args) => originalSetTimeout(callback, 0, ...args);
  return Promise.resolve()
    .then(fn)
    .finally(() => {
      global.setTimeout = originalSetTimeout;
    });
}

function withFixedRandom(value, fn) {
  const originalRandom = Math.random;
  Math.random = () => value;
  return Promise.resolve()
    .then(fn)
    .finally(() => {
      Math.random = originalRandom;
    });
}

function withRandomSequence(values, fn) {
  const originalRandom = Math.random;
  let index = 0;
  Math.random = () => {
    const value = values[index % values.length];
    index += 1;
    return value;
  };
  return Promise.resolve()
    .then(fn)
    .finally(() => {
      Math.random = originalRandom;
    });
}

function authHeaderToKey(header) {
  return String(header || "").replace(/^Bearer\s+/, "");
}

test("pool: keys 1..N picked up from env", { concurrency: false }, async () => {
  const loaded = loadFreshClient({
    DEEPSEEK_API_KEY_1: "key-1",
    DEEPSEEK_API_KEY_2: "key-2",
    DEEPSEEK_API_KEY_3: "key-3",
  });

  try {
    assert.deepEqual(loaded.client.__TEST_GET_POOL(), ["key-1", "key-2", "key-3"]);
    assert.equal(loaded.client.hasAnyKey(), true);
    assert.match(loaded.logs.join("\n"), /Loaded 3 API key\(s\) into rotation pool/);
  } finally {
    loaded.restore();
  }
});

test("pool: backward compat with single DEEPSEEK_API_KEY", { concurrency: false }, async () => {
  const loaded = loadFreshClient({
    DEEPSEEK_API_KEY: "solo-key",
  });

  try {
    assert.deepEqual(loaded.client.__TEST_GET_POOL(), ["solo-key"]);
    assert.equal(loaded.client.hasAnyKey(), true);
    assert.match(loaded.logs.join("\n"), /Loaded 1 API key\(s\) into rotation pool/);
  } finally {
    loaded.restore();
  }
});

test("random selection: 4-key pool distributes usage across calls", { concurrency: false }, async () => {
  const seenKeys = [];

  await withMockedTransport(({ options }) => {
    seenKeys.push(authHeaderToKey(options.headers.Authorization));
    return {
      statusCode: 200,
      body: {
      choices: [{ message: { content: "ok" } }]
      }
    };
  }, async () => {
    const loaded = loadFreshClient({
      DEEPSEEK_API_KEY_1: "key-1",
      DEEPSEEK_API_KEY_2: "key-2",
      DEEPSEEK_API_KEY_3: "key-3",
      DEEPSEEK_API_KEY_4: "key-4",
      DEEPSEEK_BASE_URL: "http://deepseek.test",
    });

    try {
      await withRandomSequence([0, 0.25, 0.5, 0.75], async () => {
        for (let i = 0; i < 100; i += 1) {
          await loaded.client.chatCompletion([{ role: "user", content: `hello-${i}` }], { maxRetries: 0 });
        }
      });
    } finally {
      loaded.restore();
    }
  });

  assert.equal(seenKeys.length, 100);
  const counts = seenKeys.reduce((acc, key) => {
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
  for (const key of ["key-1", "key-2", "key-3", "key-4"]) {
    assert.ok((counts[key] || 0) >= 15, `${key} should be selected often enough`);
    assert.ok((counts[key] || 0) <= 35, `${key} should not dominate random selection`);
  }
});

test("retry: switches to next key in pool", { concurrency: false }, async () => {
  const seenKeys = [];
  let requestCount = 0;

  await withMockedTransport(({ options }) => {
    requestCount += 1;
    seenKeys.push(authHeaderToKey(options.headers.Authorization));

    if (requestCount === 1) {
      return {
        statusCode: 429,
        body: { error: { message: "rate limit" } }
      };
    }

    return {
      statusCode: 200,
      body: {
      choices: [{ message: { content: "ok" } }]
      }
    };
  }, async () => {
    const loaded = loadFreshClient({
      DEEPSEEK_API_KEY_1: "key-1",
      DEEPSEEK_API_KEY_2: "key-2",
      DEEPSEEK_API_KEY_3: "key-3",
      DEEPSEEK_BASE_URL: "http://deepseek.test",
    });

    try {
      await withFixedRandom(0, () => withImmediateSleep(() => loaded.client.chatCompletion(
        [{ role: "user", content: "hello" }],
        { maxRetries: 1 }
      )));
      assert.equal(requestCount, 2);
      assert.notEqual(seenKeys[0], seenKeys[1]);
      assert.match(loaded.warns.join("\n"), /key idx 0 → 1/);
    } finally {
      loaded.restore();
    }
  });
});

test("retry: with single key, retries reuse the same key", { concurrency: false }, async () => {
  const seenKeys = [];
  let requestCount = 0;

  await withMockedTransport(({ options }) => {
    requestCount += 1;
    seenKeys.push(authHeaderToKey(options.headers.Authorization));

    if (requestCount === 1) {
      return {
        statusCode: 429,
        body: { error: { message: "rate limit" } }
      };
    }

    return {
      statusCode: 200,
      body: {
      choices: [{ message: { content: "ok" } }]
      }
    };
  }, async () => {
    const loaded = loadFreshClient({
      DEEPSEEK_API_KEY: "solo-key",
      DEEPSEEK_BASE_URL: "http://deepseek.test",
    });

    try {
      await withFixedRandom(0, () => withImmediateSleep(() => loaded.client.chatCompletion(
        [{ role: "user", content: "hello" }],
        { maxRetries: 1 }
      )));
      assert.equal(requestCount, 2);
      assert.equal(seenKeys[0], "solo-key");
      assert.equal(seenKeys[1], "solo-key");
      assert.match(loaded.warns.join("\n"), /key idx 0 → 0/);
    } finally {
      loaded.restore();
    }
  });
});

test("empty pool: throws clear error without making an HTTP call", { concurrency: false }, async () => {
  let requestCount = 0;

  await withMockedTransport(() => {
    requestCount += 1;
    return {
      statusCode: 200,
      body: {
      choices: [{ message: { content: "unexpected" } }]
      }
    };
  }, async () => {
    const loaded = loadFreshClient({
      DEEPSEEK_BASE_URL: "http://deepseek.test",
    });

    try {
      await assert.rejects(
        loaded.client.chatCompletion([{ role: "user", content: "hello" }]),
        /DEEPSEEK_API_KEY not set/
      );
      assert.equal(requestCount, 0);
      assert.match(loaded.warns.join("\n"), /No API keys configured/);
      assert.equal(loaded.client.hasAnyKey(), false);
    } finally {
      loaded.restore();
    }
  });
});

test("dedup: same key value in two slots counted once", { concurrency: false }, async () => {
  const loaded = loadFreshClient({
    DEEPSEEK_API_KEY_1: "dup-key",
    DEEPSEEK_API_KEY_2: "dup-key",
    DEEPSEEK_API_KEY: "fallback-key",
  });

  try {
    assert.deepEqual(loaded.client.__TEST_GET_POOL(), ["dup-key", "fallback-key"]);
    assert.match(loaded.logs.join("\n"), /Loaded 2 API key\(s\) into rotation pool/);
  } finally {
    loaded.restore();
  }
});

test("hasAnyKey: returns true with pool-only config", { concurrency: false }, async () => {
  const loaded = loadFreshClient({
    DEEPSEEK_API_KEY_1: "pool-only-key",
  });

  try {
    assert.equal(loaded.client.hasAnyKey(), true);
    assert.deepEqual(loaded.client.__TEST_GET_POOL(), ["pool-only-key"]);
  } finally {
    loaded.restore();
  }
});

test("qwen provider: uses Qwen key, compatible URL, and disables thinking", { concurrency: false }, async () => {
  const seen = [];
  const qwenModel = "deepseek-v4-flash-0731";

  await withMockedTransport(({ options, body }) => {
    seen.push({ options, body: JSON.parse(body) });
    return {
      statusCode: 200,
      body: {
        model: qwenModel,
        choices: [{ message: { content: "ok" } }]
      }
    };
  }, async () => {
    const loaded = loadFreshClient({
      LLM_PROVIDER: "qwen",
      QWEN_API_KEY: "qwen-key",
      QWEN_BASE_URL: "https://dashscope.aliyuncs.com/compatible-mode/v1",
      QWEN_MODEL: qwenModel,
    });

    try {
      assert.deepEqual(loaded.client.__TEST_GET_POOL(), ["qwen-key"]);
      assert.equal(loaded.client.hasAnyKey(), true);
      const out = await loaded.client.chatCompletion([{ role: "user", content: "hello" }], { maxRetries: 0 });
      assert.equal(out, "ok");
    } finally {
      loaded.restore();
    }
  });

  assert.equal(seen.length, 1);
  assert.equal(authHeaderToKey(seen[0].options.headers.Authorization), "qwen-key");
  assert.equal(seen[0].options.hostname, "dashscope.aliyuncs.com");
  assert.equal(seen[0].options.path, "/compatible-mode/v1/chat/completions");
  assert.equal(seen[0].body.model, qwenModel);
  assert.equal(seen[0].body.enable_thinking, false);
  assert.equal(Object.prototype.hasOwnProperty.call(seen[0].body, "thinking"), false);
});

test("chatCompletion: explicit model option overrides configured model", { concurrency: false }, async () => {
  const seen = [];
  const configuredModel = "deepseek-v4-flash-0324";
  const explicitModel = "deepseek-v4-flash-0731";

  await withMockedTransport(({ options, body }) => {
    seen.push({ options, body: JSON.parse(body) });
    return {
      statusCode: 200,
      body: {
        model: explicitModel,
        choices: [{ message: { content: "ok" } }]
      }
    };
  }, async () => {
    const loaded = loadFreshClient({
      LLM_PROVIDER: "qwen",
      QWEN_API_KEY: "qwen-key",
      QWEN_MODEL: configuredModel,
      QWEN_DISABLE_THINKING: "1",
    });

    try {
      const out = await loaded.client.chatCompletion(
        [{ role: "user", content: "hello" }],
        { model: explicitModel, maxRetries: 0 }
      );
      assert.equal(out, "ok");
    } finally {
      loaded.restore();
    }
  });

  assert.equal(seen.length, 1);
  assert.equal(seen[0].body.model, explicitModel);
});
