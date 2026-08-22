// deepseekClient.js - Clean slate v2
const http = require("http");
const https = require("https");
const { getProvider, getModel, getBaseUrl, getDisableThinking, logResolvedModel } = require("./modelRegistry");

const REQUEST_TIMEOUT_MS = parseInt(process.env.DEEPSEEK_TIMEOUT_MS || "60000", 10);
const MAX_RETRIES = Math.max(0, parseInt(process.env.LLM_MAX_RETRIES || "5", 10));
const RETRY_DELAY_MS = 2000;
const LLM_CONCURRENCY = Math.max(1, parseInt(process.env.LLM_CONCURRENCY || "10", 10));
const RETRYABLE_NETWORK_CODES = new Set(["ECONNRESET", "ETIMEDOUT", "ECONNREFUSED", "EPIPE"]);
const DEFAULT_CHAT_ROLE = "chat_service";

const PROVIDER_CONFIG = {
  deepseek: {
    label: "DeepSeek",
    keyNames: ["DEEPSEEK_API_KEY"],
    suffixedPrefixes: ["DEEPSEEK_API_KEY"],
    timeoutEnv: "DEEPSEEK_TIMEOUT_MS"
  },
  qwen: {
    label: "Qwen",
    keyNames: ["QWEN_API_KEY", "DASHSCOPE_API_KEY"],
    suffixedPrefixes: ["QWEN_API_KEY", "DASHSCOPE_API_KEY"],
    timeoutEnv: "QWEN_TIMEOUT_MS"
  },
  openai_compatible: {
    label: "OpenAI-compatible",
    keyNames: ["LLM_API_KEY", "OPENAI_API_KEY"],
    suffixedPrefixes: ["LLM_API_KEY", "OPENAI_API_KEY"],
    timeoutEnv: "LLM_TIMEOUT_MS"
  }
};

function getProviderConfig() {
  return PROVIDER_CONFIG[getProvider()] || {
    label: getProvider() || "LLM",
    keyNames: ["LLM_API_KEY"],
    suffixedPrefixes: ["LLM_API_KEY"],
    timeoutEnv: "LLM_TIMEOUT_MS"
  };
}

// Collect all provider-specific API_KEY_N keys plus unsuffixed keys.
// Deduplicates by value so accidentally pasting the same key into two slots
// doesn't double its weight in the pool.
function collectApiKeyPool() {
  const config = getProviderConfig();
  const seen = new Set();
  const keys = [];

  const suffixedPatterns = config.suffixedPrefixes.map((prefix) => ({
    prefix,
    pattern: new RegExp(`^${prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}_\\d+$`)
  }));

  const suffixed = Object.keys(process.env)
    .filter((key) => suffixedPatterns.some(({ pattern }) => pattern.test(key)))
    .sort((a, b) => {
      const aPrefix = suffixedPatterns.find(({ pattern }) => pattern.test(a))?.prefix || "";
      const bPrefix = suffixedPatterns.find(({ pattern }) => pattern.test(b))?.prefix || "";
      const aNum = parseInt(a.replace(new RegExp(`^${aPrefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}_`), ""), 10);
      const bNum = parseInt(b.replace(new RegExp(`^${bPrefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}_`), ""), 10);
      if (aPrefix !== bPrefix) return aPrefix.localeCompare(bPrefix);
      return aNum - bNum;
    });

  for (const envName of suffixed) {
    const value = String(process.env[envName] || "").trim();
    if (value && !seen.has(value)) {
      seen.add(value);
      keys.push(value);
    }
  }

  for (const keyName of config.keyNames) {
    const fallback = String(process.env[keyName] || "").trim();
    if (fallback && !seen.has(fallback)) {
      seen.add(fallback);
      keys.push(fallback);
    }
  }

  return keys;
}

const API_KEY_POOL = collectApiKeyPool();

if (API_KEY_POOL.length === 0) {
  const config = getProviderConfig();
  console.warn(`[${config.label}] No API keys configured. Set ${config.keyNames.join(" or ")} in .env`);
} else {
  console.log(`[${getProviderConfig().label}] Loaded ${API_KEY_POOL.length} API key(s) into rotation pool`);
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
  return /timeout|empty response/i.test(String(error?.message || ""));
}

/**
 * Whether any provider API key is configured. Exported so callers can
 * query readiness without reading environment variables directly.
 */
function hasAnyKey() {
  return API_KEY_POOL.length > 0;
}

function getConfiguredProviderLabel() {
  return getProviderConfig().label;
}

function getConfiguredKeyHint() {
  return getProviderConfig().keyNames.join(" or ");
}

function getRequestTimeoutMs(options = {}) {
  if (Number.isFinite(Number(options.timeoutMs))) {
    return Math.max(1, Number(options.timeoutMs));
  }
  const providerTimeoutEnv = getProviderConfig().timeoutEnv;
  const providerTimeout = providerTimeoutEnv ? Number(process.env[providerTimeoutEnv]) : NaN;
  if (Number.isFinite(providerTimeout) && providerTimeout > 0) return providerTimeout;
  const genericTimeout = Number(process.env.LLM_TIMEOUT_MS);
  if (Number.isFinite(genericTimeout) && genericTimeout > 0) return genericTimeout;
  return REQUEST_TIMEOUT_MS;
}

function buildChatCompletionsUrl(baseUrl) {
  const url = new URL(baseUrl);
  const pathname = url.pathname.replace(/\/+$/, "");
  if (/\/chat\/completions$/.test(pathname)) {
    url.pathname = pathname;
    return url;
  }
  if (/\/v1$/.test(pathname)) {
    url.pathname = `${pathname}/chat/completions`;
    return url;
  }
  url.pathname = `${pathname}/v1/chat/completions`;
  return url;
}

function boolEnv(name) {
  const raw = process.env[name];
  if (raw === undefined) return false;
  return /^(1|true|yes|on)$/i.test(String(raw).trim());
}

function isThinkingDisabled(options = {}) {
  if (Object.prototype.hasOwnProperty.call(options, "disableThinking")) {
    return options.disableThinking === true;
  }
  if (boolEnv("LLM_DISABLE_THINKING")) return true;
  const provider = getProvider();
  if (provider === "deepseek" && boolEnv("DEEPSEEK_DISABLE_THINKING")) return true;
  if (provider === "qwen") {
    if (boolEnv("QWEN_DISABLE_THINKING")) return true;
    const enableThinking = process.env.QWEN_ENABLE_THINKING;
    if (enableThinking !== undefined && /^(0|false|no|off)$/i.test(String(enableThinking).trim())) return true;
    return false;
  }
  return getDisableThinking();
}

function providerRequestExtras(options = {}) {
  const provider = getProvider();
  if (provider === "qwen") return { enable_thinking: false };
  if (!isThinkingDisabled(options)) return {};
  if (provider === "deepseek") return { thinking: { type: "disabled" } };
  return {};
}

function performChatCompletionRequest(url, apiKey, body, role, timeoutMs = REQUEST_TIMEOUT_MS) {
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
                  `${getConfiguredProviderLabel()} API error: HTTP ${statusCode}`
                ));
              }
              return finish(reject, new Error(`Failed to parse ${getConfiguredProviderLabel()} response: ${data.slice(0, 200)}`));
            }
          }

          if (statusCode >= 400) {
            return finish(reject, createHttpError(
              statusCode,
              parsed?.error?.message || `${getConfiguredProviderLabel()} API error: HTTP ${statusCode}`
            ));
          }

          if (parsed?.error) {
            return finish(reject, createRequestError(parsed.error.message || `${getConfiguredProviderLabel()} API error`, {
              statusCode,
            }));
          }

          const text = parsed?.choices?.[0]?.message?.content;
          if (!text) return finish(reject, new Error(`Empty response from ${getConfiguredProviderLabel()}`));
          logResolvedModel(role, parsed?.model);
          return finish(resolve, text.trim());
        });
      }
    );

    req.setTimeout(timeoutMs, () => {
      console.error(`[${getConfiguredProviderLabel()}] Request timeout after ${timeoutMs}ms`);
      const timeoutError = createRequestError(`${getConfiguredProviderLabel()} API request timeout`, { code: "ETIMEDOUT" });
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
  const role = String(options.role || DEFAULT_CHAT_ROLE).trim();
  const explicitModel = String(options.model || "").trim();
  const model = explicitModel || getModel(role);
  const baseUrl = getBaseUrl();

  if (API_KEY_POOL.length === 0) {
    throw new Error(`${getConfiguredKeyHint()} not set`);
  }

  const body = JSON.stringify({
    model,
    messages,
    temperature: options.temperature ?? 0.7,
    max_tokens: options.max_tokens ?? 800,
    ...providerRequestExtras(options),
    ...(options.response_format ? { response_format: options.response_format } : {}),
  });
  const url = buildChatCompletionsUrl(baseUrl);
  const maxRetries = Number.isFinite(options.maxRetries) ? options.maxRetries : MAX_RETRIES;
  const timeoutMs = getRequestTimeoutMs(options);
  const startKeyIndex = Math.floor(Math.random() * API_KEY_POOL.length);

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    const keyIndex = (startKeyIndex + attempt) % API_KEY_POOL.length;
    const apiKey = API_KEY_POOL[keyIndex];

    try {
      return await performChatCompletionRequest(url, apiKey, body, role, timeoutMs);
    } catch (error) {
      const retryable = isRetryableError(error);
      const canRetry = retryable && attempt < maxRetries;

      if (!canRetry) {
        if (attempt > 0) {
          console.error(`[${getConfiguredProviderLabel()}] Request failed after retry (last key idx ${keyIndex}):`, error.message);
        }
        throw error;
      }

      const delay = RETRY_DELAY_MS * Math.pow(2, attempt) + Math.random() * 500;
      console.warn(
        `[${getConfiguredProviderLabel()}] Retry ${attempt + 1}/${maxRetries} (key idx ${keyIndex} → ${(keyIndex + 1) % API_KEY_POOL.length}) ` +
        `after ${Math.round(delay)}ms, reason:`,
        error.message
      );
      await sleep(delay);
    }
  }

  throw new Error(`${getConfiguredProviderLabel()} request exhausted retries`);
}

async function chatCompletion(messages, options = {}) {
  return llmGate(() => _chatCompletionInner(messages, options));
}

module.exports = {
  chatCompletion,
  hasAnyKey,
  __TEST_GET_POOL: () => [...API_KEY_POOL],
  __TEST_BUILD_CHAT_URL: buildChatCompletionsUrl,
};
