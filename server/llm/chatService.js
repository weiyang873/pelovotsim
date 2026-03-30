// chatService.js - streaming chat completion

const DEEPSEEK_BASE_URL = process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com";
const DEEPSEEK_MODEL = process.env.DEEPSEEK_MODEL || "deepseek-chat";
const DEEPSEEK_TIMEOUT_MS = parseInt(process.env.DEEPSEEK_TIMEOUT_MS || "60000", 10);
const RETRY_DELAYS_MS = [1000, 3000, 9000];
const RETRYABLE_STATUS_CODES = new Set([429, 500, 502, 503]);
const RETRYABLE_ERROR_CODES = new Set(["ETIMEDOUT", "ECONNRESET"]);
const DEEPSEEK_KEY_POOL = collectDeepSeekApiKeys();

function collectDeepSeekApiKeys() {
  const seen = new Set();
  const keys = [];

  for (let i = 1; i <= 5; i += 1) {
    addKey(process.env[`DEEPSEEK_API_KEY_${i}`], seen, keys);
  }
  addKey(process.env.DEEPSEEK_API_KEY, seen, keys);

  return keys;
}

function addKey(value, seen, keys) {
  const key = String(value || "").trim();
  if (!key || seen.has(key)) return;
  seen.add(key);
  keys.push(key);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function createRequestError(message, extra = {}) {
  const error = new Error(message);
  Object.assign(error, extra);
  return error;
}

function pickKeyOrder() {
  if (DEEPSEEK_KEY_POOL.length === 0) return [];
  const startIndex = Math.floor(Math.random() * DEEPSEEK_KEY_POOL.length);
  const ordered = [];
  for (let offset = 0; offset < DEEPSEEK_KEY_POOL.length; offset += 1) {
    ordered.push(DEEPSEEK_KEY_POOL[(startIndex + offset) % DEEPSEEK_KEY_POOL.length]);
  }
  return ordered;
}

function normalizeErrorCode(error) {
  return String(error?.code || error?.cause?.code || "").toUpperCase();
}

function normalizeStatusCode(error) {
  return Number(error?.statusCode || error?.status || error?.cause?.statusCode || 0);
}

function isRetryableError(error) {
  return (
    RETRYABLE_STATUS_CODES.has(normalizeStatusCode(error)) ||
    RETRYABLE_ERROR_CODES.has(normalizeErrorCode(error))
  );
}

function extractErrorMessage(text, statusCode) {
  if (!text) return `DeepSeek API error: ${statusCode}`;

  try {
    const parsed = JSON.parse(text);
    return parsed?.error?.message || `DeepSeek API error: ${statusCode}`;
  } catch (_) {
    return `DeepSeek API error: ${statusCode} ${text}`;
  }
}

function extractChunkText(parsed) {
  const delta = parsed?.choices?.[0]?.delta;
  const content = delta?.content;

  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((item) => (typeof item?.text === "string" ? item.text : ""))
      .join("");
  }

  if (typeof parsed?.content_block?.text === "string") return parsed.content_block.text;
  return "";
}

async function streamWithKey(messages, onChunk, apiKey) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), DEEPSEEK_TIMEOUT_MS);

  try {
    const response = await fetch(new URL("/v1/chat/completions", DEEPSEEK_BASE_URL), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: DEEPSEEK_MODEL,
        max_tokens: 2000,
        stream: true,
        messages
      }),
      signal: controller.signal
    });

    if (!response.ok || !response.body) {
      const text = await response.text().catch(() => "");
      throw createRequestError(extractErrorMessage(text, response.status), {
        statusCode: response.status
      });
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder("utf-8");
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        const data = line.slice(6).trim();
        if (!data || data === "[DONE]") continue;

        try {
          const parsed = JSON.parse(data);
          const text = extractChunkText(parsed);
          if (text) onChunk(text);
        } catch (_) {}
      }
    }
  } catch (error) {
    if (error?.name === "AbortError") {
      throw createRequestError("DeepSeek API request timeout", { code: "ETIMEDOUT" });
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

async function streamChatCompletion(messages, onChunk) {
  if (DEEPSEEK_KEY_POOL.length === 0) {
    throw new Error("No DeepSeek API key configured");
  }

  const orderedKeys = pickKeyOrder();
  let lastError = null;

  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt += 1) {
    const apiKey = orderedKeys[attempt % orderedKeys.length];

    try {
      await streamWithKey(messages, onChunk, apiKey);
      return;
    } catch (error) {
      lastError = error;
      const canRetry = attempt < RETRY_DELAYS_MS.length && isRetryableError(error);
      if (!canRetry) break;
      await sleep(RETRY_DELAYS_MS[attempt]);
    }
  }

  throw lastError || new Error("DeepSeek request exhausted retries");
}

module.exports = { streamChatCompletion };
