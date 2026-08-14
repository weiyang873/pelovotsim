#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const http = require("node:http");
const https = require("node:https");
const path = require("node:path");
const { AsyncLocalStorage } = require("node:async_hooks");

const ROOT = path.resolve(__dirname, "..");
const OUTPUT_DIR = path.join(ROOT, "smoke_output", "v4flash_0731");
const CALLS_PATH = path.join(OUTPUT_DIR, "calls.jsonl");
const SUMMARY_PATH = path.join(OUTPUT_DIR, "summary.json");
const EXPECTED_MODEL = "deepseek-v4-flash-0731";
const PROVIDER = "qwen-ai-platform";
const TEMPERATURE = 0.55;
const MAX_RETRIES = 3;
const RETRY_DELAYS_MS = [1000, 2000, 4000];
const REQUEST_TIMEOUT_MS = 120000;
const RUN_ID = "smoke_v4flash_0731";

const chainContext = new AsyncLocalStorage();
let cachedRunner = null;

function loadLocalEnv() {
  const envPath = path.join(ROOT, ".env");
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const splitAt = trimmed.indexOf("=");
    if (splitAt <= 0) continue;
    const key = trimmed.slice(0, splitAt).trim();
    let value = trimmed.slice(splitAt + 1).trim();
    if ((value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!Object.prototype.hasOwnProperty.call(process.env, key)) process.env[key] = value;
  }
}

function requireNonEmptyEnv(name) {
  const value = String(process.env[name] || "").trim();
  if (!value) throw new Error(`missing required env: ${name}`);
  return value;
}

function firstConfiguredKey() {
  const direct = [
    ["QWEN_API_KEY", process.env.QWEN_API_KEY],
    ["DASHSCOPE_API_KEY", process.env.DASHSCOPE_API_KEY]
  ].find(([, value]) => String(value || "").trim());
  if (direct) return { envName: direct[0], value: String(direct[1]).trim() };

  const suffixed = Object.keys(process.env)
    .filter((key) => /^(QWEN_API_KEY|DASHSCOPE_API_KEY)_\d+$/.test(key))
    .sort((a, b) => {
      const prefixA = a.replace(/_\d+$/, "");
      const prefixB = b.replace(/_\d+$/, "");
      if (prefixA !== prefixB) return prefixA.localeCompare(prefixB);
      return Number(a.match(/_(\d+)$/)?.[1] || 0) - Number(b.match(/_(\d+)$/)?.[1] || 0);
    })
    .find((key) => String(process.env[key] || "").trim());
  if (suffixed) return { envName: suffixed, value: String(process.env[suffixed]).trim() };
  throw new Error("missing required env: QWEN_API_KEY or DASHSCOPE_API_KEY");
}

function readSmokeConfig() {
  const provider = requireNonEmptyEnv("LLM_PROVIDER");
  if (provider.toLowerCase() !== "qwen") {
    throw new Error(`LLM_PROVIDER must be qwen for this smoke test, got ${provider}`);
  }
  const model = requireNonEmptyEnv("QWEN_MODEL");
  if (model !== EXPECTED_MODEL) {
    throw new Error(`QWEN_MODEL must be ${EXPECTED_MODEL}, got ${model}`);
  }
  const baseUrl = String(process.env.QWEN_BASE_URL || process.env.DASHSCOPE_BASE_URL || process.env.LLM_BASE_URL || "").trim();
  if (!baseUrl) throw new Error("missing required env: QWEN_BASE_URL or DASHSCOPE_BASE_URL or LLM_BASE_URL");
  const apiKey = firstConfiguredKey();
  return { provider, model, baseUrl, apiKey };
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

function ensureOutputDir({ resetCalls = false } = {}) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  if (resetCalls) fs.writeFileSync(CALLS_PATH, "");
}

function appendJsonl(filePath, row) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.appendFileSync(filePath, `${JSON.stringify(row)}\n`);
}

function countChars(text) {
  return Array.from(String(text || "")).length;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function requestJson(url, apiKey, body, timeoutMs) {
  const transport = url.protocol === "http:" ? http : https;
  return new Promise((resolve, reject) => {
    const startedAt = Date.now();
    const req = transport.request({
      hostname: url.hostname,
      port: url.port || undefined,
      path: `${url.pathname}${url.search || ""}`,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
        "Content-Length": Buffer.byteLength(body)
      }
    }, (res) => {
      let raw = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => { raw += chunk; });
      res.on("end", () => {
        let parsed = null;
        try {
          parsed = raw ? JSON.parse(raw) : null;
        } catch (error) {
          return reject(Object.assign(new Error(`invalid JSON response: ${error.message}`), {
            statusCode: Number(res.statusCode || 0),
            latencyMs: Date.now() - startedAt,
            raw
          }));
        }
        resolve({
          statusCode: Number(res.statusCode || 0),
          latencyMs: Date.now() - startedAt,
          parsed,
          raw
        });
      });
    });
    req.setTimeout(timeoutMs, () => {
      req.destroy(Object.assign(new Error(`request timeout after ${timeoutMs}ms`), { code: "ETIMEDOUT" }));
    });
    req.on("error", (error) => {
      reject(Object.assign(error, { statusCode: 0, latencyMs: Date.now() - startedAt }));
    });
    req.write(body);
    req.end();
  });
}

function usageCompletionTokens(parsed) {
  const value = Number(parsed?.usage?.completion_tokens);
  if (!Number.isFinite(value)) throw new Error("missing usage.completion_tokens in response");
  return value;
}

function responseContent(parsed) {
  // DashScope OpenAI-compatible responses use the same content location as the
  // existing DeepSeek-compatible client: choices[0].message.content.
  const content = parsed?.choices?.[0]?.message?.content;
  return typeof content === "string" ? content : "";
}

function createSmokeMonitor(config, { callsPath = CALLS_PATH } = {}) {
  const url = buildChatCompletionsUrl(config.baseUrl);
  const calls = [];

  async function chatCompletion(messages, options = {}) {
    const context = chainContext.getStore() || { personaId: "unknown", step: 0 };
    context.step = Number(context.step || 0) + 1;
    const step = context.step;
    const personaId = context.personaId || "unknown";
    const startedAt = Date.now();
    let retryCount = 0;
    let rateLimitedAttempts = 0;
    let emptyAttempts = 0;
    let lastHttpCode = 0;
    let lastError = null;

    while (retryCount <= MAX_RETRIES) {
      const body = JSON.stringify({
        model: config.model,
        messages,
        temperature: TEMPERATURE,
        max_tokens: options.max_tokens ?? 1600,
        enable_thinking: false,
        ...(options.response_format ? { response_format: options.response_format } : {})
      });

      try {
        const response = await requestJson(url, config.apiKey.value, body, Number(options.timeoutMs || REQUEST_TIMEOUT_MS));
        lastHttpCode = response.statusCode;
        if (response.statusCode === 429) {
          rateLimitedAttempts += 1;
          lastError = new Error("rate limited");
          if (retryCount < MAX_RETRIES) {
            await sleep(RETRY_DELAYS_MS[retryCount]);
            retryCount += 1;
            continue;
          }
          return finishCall("rate_limited", personaId, step, startedAt, lastHttpCode, retryCount, {
            completionTokens: null,
            output: "",
            model: String(response.parsed?.model || ""),
            rateLimitedAttempts,
            emptyAttempts,
            error: lastError
          });
        }

        if (response.statusCode >= 400) {
          const message = response.parsed?.error?.message || `HTTP ${response.statusCode}`;
          return finishCall("error", personaId, step, startedAt, lastHttpCode, retryCount, {
            completionTokens: null,
            output: "",
            model: String(response.parsed?.model || ""),
            rateLimitedAttempts,
            emptyAttempts,
            error: new Error(message)
          });
        }

        if (response.parsed?.error) {
          return finishCall("error", personaId, step, startedAt, lastHttpCode, retryCount, {
            completionTokens: null,
            output: "",
            model: String(response.parsed?.model || ""),
            rateLimitedAttempts,
            emptyAttempts,
            error: new Error(response.parsed.error.message || "API error")
          });
        }

        const output = responseContent(response.parsed).trim();
        if (!output) {
          emptyAttempts += 1;
          lastError = new Error("empty response content");
          if (retryCount < MAX_RETRIES) {
            await sleep(RETRY_DELAYS_MS[retryCount]);
            retryCount += 1;
            continue;
          }
          return finishCall("empty", personaId, step, startedAt, lastHttpCode, retryCount, {
            completionTokens: null,
            output: "",
            model: String(response.parsed?.model || ""),
            rateLimitedAttempts,
            emptyAttempts,
            error: lastError
          });
        }

        const completionTokens = usageCompletionTokens(response.parsed);
        const outputText = finishCall("ok", personaId, step, startedAt, lastHttpCode, retryCount, {
          completionTokens,
          output,
          model: String(response.parsed?.model || ""),
          rateLimitedAttempts,
          emptyAttempts,
          error: null
        });
        const latestCall = calls[calls.length - 1];
        if (
          context.enforceThinkingGuard &&
          Number(latestCall.completion_tokens) > Number(latestCall.output_chars) * 2
        ) {
          const error = new Error(
            `thinking guard failed for ${latestCall.persona_id} step ${latestCall.step}: ` +
            `completion_tokens=${latestCall.completion_tokens}, output_chars=${latestCall.output_chars}`
          );
          error.code = "THINKING_GUARD";
          error.call = latestCall;
          throw error;
        }
        return outputText;
      } catch (error) {
        if (error?.code === "THINKING_GUARD") throw error;
        lastError = error;
        lastHttpCode = Number(error?.statusCode || 0);
        return finishCall("error", personaId, step, startedAt, lastHttpCode, retryCount, {
          completionTokens: null,
          output: "",
          model: "",
          rateLimitedAttempts,
          emptyAttempts,
          error
        });
      }
    }

    throw lastError || new Error("unreachable smoke retry state");
  }

  function finishCall(status, personaId, step, startedAt, httpCode, retryCount, detail) {
    const outputChars = countChars(detail.output);
    const completionTokens = detail.completionTokens;
    const record = {
      ts: new Date().toISOString(),
      persona_id: personaId,
      step,
      http_code: httpCode,
      status,
      latency_ms: Date.now() - startedAt,
      completion_tokens: completionTokens,
      output_chars: outputChars,
      retry_count: retryCount
    };
    appendJsonl(callsPath, record);
    calls.push({
      ...record,
      model: detail.model,
      rate_limited_attempts: detail.rateLimitedAttempts,
      empty_attempts: detail.emptyAttempts
    });
    if (status === "ok") return detail.output;
    const error = detail.error || new Error(`LLM call ${status}`);
    error.status = status;
    error.statusCode = httpCode;
    throw error;
  }

  return { chatCompletion, calls };
}

function installSmokeModulePatches(monitor) {
  process.env.LLM_LOG = "0";

  const deepseekPath = require.resolve("../server/llm/deepseekClient");
  require.cache[deepseekPath] = {
    id: deepseekPath,
    filename: deepseekPath,
    loaded: true,
    exports: {
      chatCompletion: monitor.chatCompletion,
      hasAnyKey: () => true
    }
  };

  const loggerPath = require.resolve("../server/llm/llm_logger");
  require.cache[loggerPath] = {
    id: loggerPath,
    filename: loggerPath,
    loaded: true,
    exports: {
      withLlmLogging: async (_meta, runner) => runner(),
      logLLMCall: () => {},
      flushAll: () => {}
    }
  };

  const kvPath = require.resolve("../server/db/kvCache");
  const kvMemory = new Map();
  require.cache[kvPath] = {
    id: kvPath,
    filename: kvPath,
    loaded: true,
    exports: {
      kvGet: async (cacheName, key) => kvMemory.get(`${cacheName}:${key}`) || null,
      kvSet: async (cacheName, key, value) => {
        kvMemory.set(`${cacheName}:${key}`, value);
      }
    }
  };

  [
    "../server/llm/tagExtractor",
    "../server/llm/personaGenerator",
    "../server/llm/vpWordScorer",
    "../server/llm/vpCoach"
  ].forEach((modulePath) => {
    delete require.cache[require.resolve(modulePath)];
  });
}

function loadRunner(monitor) {
  if (cachedRunner) return cachedRunner;
  installSmokeModulePatches(monitor);
  const FullGame = require("./analysis/full_game_all_personas");
  const { extractTags } = require("../server/llm/tagExtractor");
  const { scoreTagsToDimensions } = require("../server/llm/dimensionScorer");
  const vpWordScorer = require("../server/llm/vpWordScorer");
  const vpCoach = require("../server/llm/vpCoach");
  const personaGenerator = require("../server/llm/personaGenerator");
  cachedRunner = {
    FullGame,
    runtime: { chatCompletion: monitor.chatCompletion, extractTags, scoreTagsToDimensions, vpWordScorer, vpCoach, personaGenerator }
  };
  return cachedRunner;
}

function deterministicJinangDraw(materials, index) {
  const market = Array.isArray(materials.jinangConfig?.market) ? materials.jinangConfig.market : [];
  const tech = Array.isArray(materials.jinangConfig?.tech) ? materials.jinangConfig.tech : [];
  if (!market.length || !tech.length) throw new Error("jinang config must contain market and tech cards");
  return {
    market: market[index % market.length],
    tech: tech[Math.floor(index / market.length) % tech.length]
  };
}

function selectSmokePersonas(materials, total = 20) {
  const personas = Array.isArray(materials.personas) ? materials.personas : [];
  if (!personas.length) throw new Error("no personas found in full-game materials");
  return Array.from({ length: total }, (_unused, index) => {
    const persona = personas[index % personas.length];
    const rep = Math.floor(index / personas.length) + 1;
    return {
      persona,
      smokePersonaId: `${persona.id}#${rep}`,
      rep,
      index
    };
  });
}

function assertThinkingRatio(calls) {
  const bad = calls.find((call) =>
    call.status === "ok" &&
    Number.isFinite(Number(call.completion_tokens)) &&
    Number(call.completion_tokens) > Number(call.output_chars) * 2
  );
  if (bad) {
    const error = new Error(
      `thinking guard failed for ${bad.persona_id} step ${bad.step}: ` +
      `completion_tokens=${bad.completion_tokens}, output_chars=${bad.output_chars}`
    );
    error.code = "THINKING_GUARD";
    error.call = bad;
    throw error;
  }
}

async function runSmokePersona(task, options = {}) {
  const monitor = options.monitor;
  const { FullGame, runtime } = loadRunner(monitor);
  const materials = options.materials || FullGame.loadMaterials();
  const startedAt = Date.now();
  const context = { personaId: task.smokePersonaId, step: 0, enforceThinkingGuard: options.enforceThinkingGuard === true };
  const beforeCallCount = monitor.calls.length;
  const row = await chainContext.run(context, () => FullGame.runPlaythrough(runtime, task.persona, materials, RUN_ID, {
    condition: FullGame.CONDITION,
    rep: task.rep,
    jinangDraw: deterministicJinangDraw(materials, task.index)
  }));
  const personaCalls = monitor.calls.slice(beforeCallCount).filter((call) => call.persona_id === task.smokePersonaId);
  if (options.enforceThinkingGuard) assertThinkingRatio(personaCalls);
  return {
    row,
    persona_id: task.smokePersonaId,
    chain_steps: personaCalls.length,
    total_latency_ms: Date.now() - startedAt,
    calls: personaCalls
  };
}

function singleStdout(result) {
  const calls = result.calls.filter((call) => call.status === "ok");
  const model = calls.find((call) => call.model)?.model || "";
  return {
    model,
    persona_id: result.persona_id,
    chain_steps: result.chain_steps,
    total_latency_ms: result.total_latency_ms,
    per_call_completion_tokens: calls.map((call) => call.completion_tokens),
    per_call_output_chars: calls.map((call) => call.output_chars)
  };
}

async function main() {
  loadLocalEnv();
  ensureOutputDir({ resetCalls: true });
  const config = readSmokeConfig();
  const monitor = createSmokeMonitor(config);
  const { FullGame } = loadRunner(monitor);
  const materials = FullGame.loadMaterials();
  const task = selectSmokePersonas(materials, 1)[0];
  const result = await runSmokePersona(task, { monitor, materials });
  if (result.row.status !== "OK") {
    throw new Error(`persona ${result.persona_id} failed: ${result.row.error}`);
  }
  process.stdout.write(`${JSON.stringify(singleStdout(result), null, 2)}\n`);
}

module.exports = {
  CALLS_PATH,
  EXPECTED_MODEL,
  OUTPUT_DIR,
  PROVIDER,
  SUMMARY_PATH,
  TEMPERATURE,
  assertThinkingRatio,
  createSmokeMonitor,
  ensureOutputDir,
  loadLocalEnv,
  readSmokeConfig,
  runSmokePersona,
  selectSmokePersonas,
  singleStdout
};

if (require.main === module) {
  const originalLog = console.log;
  console.log = (...args) => console.error(...args);
  main().catch((error) => {
    console.error(error.stack || error.message || String(error));
    process.exitCode = 1;
  }).finally(() => {
    console.log = originalLog;
  });
}
