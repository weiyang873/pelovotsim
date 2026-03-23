// deepseekClient.js - Clean slate v2
const http = require("http");
const https = require("https");

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

  return new Promise((resolve, reject) => {
    const url = new URL("/v1/chat/completions", DEEPSEEK_BASE_URL);
    const transport = url.protocol === "http:" ? http : https;
    const req = transport.request(
      {
        hostname: url.hostname,
        port: url.port || undefined,
        path: url.pathname,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${DEEPSEEK_API_KEY}`,
          "Content-Length": Buffer.byteLength(body),
        },
      },
      (res) => {
        let data = "";
        res.on("data", (chunk) => { data += chunk; });
        res.on("end", () => {
          try {
            const parsed = JSON.parse(data);
            if (parsed.error) return reject(new Error(parsed.error.message || "DeepSeek API error"));
            const text = parsed.choices?.[0]?.message?.content;
            if (!text) return reject(new Error("Empty response from DeepSeek"));
            resolve(text.trim());
          } catch (e) {
            reject(new Error(`Failed to parse DeepSeek response: ${data.slice(0, 200)}`));
          }
        });
      }
    );
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

module.exports = { chatCompletion };
