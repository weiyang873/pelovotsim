// deepseekClient.js - Clean slate v2
const http = require("http");
const https = require("https");

const REQUEST_TIMEOUT_MS = parseInt(process.env.DEEPSEEK_TIMEOUT_MS || "60000", 10);
const MAX_RETRIES = Math.max(0, parseInt(process.env.LLM_MAX_RETRIES || "1", 10));
const RETRY_DELAY_MS = 2000;
const LLM_CONCURRENCY = Math.max(1, parseInt(process.env.LLM_CONCURRENCY || "10", 10));
const RETRYABLE_NETWORK_CODES = new Set(["ECONNRESET", "ETIMEDOUT", "ECONNREFUSED", "EPIPE"]);
// Collect all DEEPSEEK_API_KEY_N keys plus the unsuffixed DEEPSEEK_API_KEY.
// Deduplicates by value so accidentally pasting the same key into two slots
// doesn't double its weight in the pool.
const DEEPSEEK_KEY_POOL = (() => {
  const seen = new Set();
  const keys = [];

  const suffixed = Object.keys(process.env)
    .filter((key) => /^DEEPSEEK_API_KEY_\d+$/.test(key))
    .sort((a, b) => {
      const aNum = parseInt(a.replace(/^DEEPSEEK_API_KEY_/, ""), 10);
      const bNum = parseInt(b.replace(/^DEEPSEEK_API_KEY_/, ""), 10);
      return aNum - bNum;
    });

  for (const envName of suffixed) {
    const value = String(process.env[envName] || "").trim();
    if (value && !seen.has(value)) {
      seen.add(value);
      keys.push(value);
    }
  }

  const fallback = String(process.env.DEEPSEEK_API_KEY || "").trim();
  if (fallback && !seen.has(fallback)) {
    seen.add(fallback);
    keys.push(fallback);
  }

  return keys;
})();

if (DEEPSEEK_KEY_POOL.length === 0) {
  console.warn("[DeepSeek] No API keys configured. Set DEEPSEEK_API_KEY or DEEPSEEK_API_KEY_1..N in .env");
} else {
  console.log(`[DeepSeek] Loaded ${DEEPSEEK_KEY_POOL.length} API key(s) into rotation pool`);
}

const llmGate = (() => {
  let active = 0;
  const waiters = [];

  return async function gate(fn) {
    if (active >= LLM_CONCURRENCY) {
      await new Promise((resolve) => waiters.push(resolve));
    }
    active += 1;
    try {
      return await fn();
    } finally {
      active -= 1;
      const next = waiters.shift();
      if (next) next();
    }
  };
})();

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function createRequestError(message, extra = {}) {
  const error = new Error(message);
  Object.assign(error, extra);
  return error;
}

function createHttpError(statusCode, message) {
  return createRequestError(message, { statusCode });
}

function isRetryableError(error) {
  const statusCode = Number(error?.statusCode || error?.status || 0);
  if (statusCode === 429 || statusCode >= 500) return true;
  if (RETRYABLE_NETWORK_CODES.has(String(error?.code || "").toUpperCase())) return true;
  return /timeout/i.test(String(error?.message || ""));
}

/**
 * Whether any DeepSeek API key is configured. Exported so callers can
 * query readiness without reading environment variables directly.
 */
function hasAnyKey() {
  return DEEPSEEK_KEY_POOL.length > 0;
}

function performChatCompletionRequest(url, apiKey, body) {
  const transport = url.protocol === "http:" ? http : https;

  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (handler, value) => {
      if (settled) return;
      settled = true;
      handler(value);
    };

    const req = transport.request(
      {
        hostname: url.hostname,
        port: url.port || undefined,
        path: `${url.pathname}${url.search || ""}`,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
          "Content-Length": Buffer.byteLength(body),
        },
      },
      (res) => {
        let data = "";
        res.on("data", (chunk) => { data += chunk; });
        res.on("end", () => {
          const statusCode = Number(res.statusCode || 0);
          let parsed = null;

          if (data) {
            try {
              parsed = JSON.parse(data);
            } catch (_) {
              if (statusCode >= 400) {
                return finish(reject, createHttpError(
                  statusCode,
                  `DeepSeek API error: HTTP ${statusCode}`
                ));
              }
              return finish(reject, new Error(`Failed to parse DeepSeek response: ${data.slice(0, 200)}`));
            }
          }

          if (statusCode >= 400) {
            return finish(reject, createHttpError(
              statusCode,
              parsed?.error?.message || `DeepSeek API error: HTTP ${statusCode}`
            ));
          }

          if (parsed?.error) {
            return finish(reject, createRequestError(parsed.error.message || "DeepSeek API error", {
              statusCode,
            }));
          }

          const text = parsed?.choices?.[0]?.message?.content;
          if (!text) return finish(reject, new Error("Empty response from DeepSeek"));
          return finish(resolve, text.trim());
        });
      }
    );

    req.setTimeout(REQUEST_TIMEOUT_MS, () => {
      console.error(`[DeepSeek] Request timeout after ${REQUEST_TIMEOUT_MS}ms`);
      const timeoutError = createRequestError("DeepSeek API request timeout", { code: "ETIMEDOUT" });
      req.destroy(timeoutError);
    });

    req.on("error", (error) => {
      finish(reject, error);
    });

    req.write(body);
    req.end();
  });
}

/**
 * 调用 DeepSeek Chat API
 * @param {Array} messages - [{role, content}, ...]
 * @param {Object} options - { temperature, max_tokens }
 * @returns {Promise<string>} - 模型回复文本
 */
async function _chatCompletionInner(messages, options = {}) {
  const DEEPSEEK_MODEL = process.env.DEEPSEEK_MODEL || "deepseek-chat";
  const DEEPSEEK_BASE_URL = process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com";

  if (DEEPSEEK_KEY_POOL.length === 0) {
    throw new Error("DEEPSEEK_API_KEY not set (and no DEEPSEEK_API_KEY_1..N found)");
  }

  const body = JSON.stringify({
    model: DEEPSEEK_MODEL,
    messages,
    temperature: options.temperature ?? 0.7,
    max_tokens: options.max_tokens ?? 800,
  });
  const url = new URL("/v1/chat/completions", DEEPSEEK_BASE_URL);
  const maxRetries = Number.isFinite(options.maxRetries) ? options.maxRetries : MAX_RETRIES;
  const startKeyIndex = Math.floor(Math.random() * DEEPSEEK_KEY_POOL.length);

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    const keyIndex = (startKeyIndex + attempt) % DEEPSEEK_KEY_POOL.length;
    const apiKey = DEEPSEEK_KEY_POOL[keyIndex];

    try {
      return await performChatCompletionRequest(url, apiKey, body);
    } catch (error) {
      const retryable = isRetryableError(error);
      const canRetry = retryable && attempt < maxRetries;

      if (!canRetry) {
        if (attempt > 0) {
          console.error(`[DeepSeek] Request failed after retry (last key idx ${keyIndex}):`, error.message);
        }
        throw error;
      }

      const delay = RETRY_DELAY_MS * Math.pow(2, attempt) + Math.random() * 500;
      console.warn(
        `[DeepSeek] Retry ${attempt + 1}/${maxRetries} (key idx ${keyIndex} → ${(keyIndex + 1) % DEEPSEEK_KEY_POOL.length}) ` +
        `after ${Math.round(delay)}ms, reason:`,
        error.message
      );
      await sleep(delay);
    }
  }

  throw new Error("DeepSeek request exhausted retries");
}

async function chatCompletion(messages, options = {}) {
  return llmGate(() => _chatCompletionInner(messages, options));
}

module.exports = {
  chatCompletion,
  hasAnyKey,
  __TEST_GET_POOL: () => [...DEEPSEEK_KEY_POOL],
};
