// deepseekClient.js - Clean slate v2
const http = require("http");
const https = require("https");

const REQUEST_TIMEOUT_MS = parseInt(process.env.DEEPSEEK_TIMEOUT_MS || "60000", 10);
const MAX_RETRIES = 1;
const RETRY_DELAY_MS = 2000;
const RETRYABLE_NETWORK_CODES = new Set(["ECONNRESET", "ETIMEDOUT", "ECONNREFUSED", "EPIPE"]);

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
async function chatCompletion(messages, options = {}) {
  const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY;
  const DEEPSEEK_MODEL = process.env.DEEPSEEK_MODEL || "deepseek-chat";
  const DEEPSEEK_BASE_URL = process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com";

  if (!DEEPSEEK_API_KEY) throw new Error("DEEPSEEK_API_KEY not set");

  const body = JSON.stringify({
    model: DEEPSEEK_MODEL,
    messages,
    temperature: options.temperature ?? 0.7,
    max_tokens: options.max_tokens ?? 800,
  });
  const url = new URL("/v1/chat/completions", DEEPSEEK_BASE_URL);
  const maxRetries = Number.isFinite(options.maxRetries) ? options.maxRetries : MAX_RETRIES;

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    try {
      return await performChatCompletionRequest(url, DEEPSEEK_API_KEY, body);
    } catch (error) {
      const retryable = isRetryableError(error);
      const canRetry = retryable && attempt < maxRetries;

      if (!canRetry) {
        if (attempt > 0) {
          console.error("[DeepSeek] Request failed after retry:", error.message);
        }
        throw error;
      }

      const delay = RETRY_DELAY_MS * Math.pow(2, attempt) + Math.random() * 500;
      console.warn(`[DeepSeek] Retry ${attempt + 1}/${maxRetries} after ${Math.round(delay)}ms, reason:`, error.message);
      await sleep(delay);
    }
  }

  throw new Error("DeepSeek request exhausted retries");
}

module.exports = { chatCompletion };
