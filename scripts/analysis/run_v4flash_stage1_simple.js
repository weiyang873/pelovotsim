#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const http = require("node:http");
const https = require("node:https");
const path = require("node:path");
const crypto = require("node:crypto");
const { AsyncLocalStorage } = require("node:async_hooks");
const { execFileSync } = require("node:child_process");

const ROOT = path.resolve(__dirname, "../..");
const RUN_ROOT = path.join(ROOT, "runs_v4flash_0731");
const ARM_ID = String(process.env.V4FLASH_ARM_ID || "simple").trim();
const RUN_ID = String(process.env.V4FLASH_RUN_ID || `v4flash_0731_${ARM_ID}`).trim();
const PERSONA_INJECTION_MODE = String(process.env.V4FLASH_PERSONA_MODE || ARM_ID).trim();
const PROMPT_MODE = String(process.env.V4FLASH_PROMPT_MODE || (ARM_ID === "simple" ? "interface" : "formal")).trim();
const LOG_PREFIX = ARM_ID === "simple" ? "stage1_simple" : `stage4_${ARM_ID}`;
const ARM_DIR = path.join(RUN_ROOT, ARM_ID);
const CHAINS_DIR = path.join(ARM_DIR, "chains");
const FAILED_DIR = path.join(RUN_ROOT, "failed", ARM_ID);
const CALLS_PATH = path.join(ARM_DIR, "calls.jsonl");
const SUMMARY_PATH = path.join(ARM_DIR, "arm_summary.json");
const REGIME_PATH = path.join(RUN_ROOT, "regime.json");
const DEFAULT_POOL_DIR = path.join(ROOT, "data", "persona_pool_v2");
const POOL_DIR = path.resolve(ROOT, String(process.env.V4FLASH_POOL_DIR || DEFAULT_POOL_DIR).trim());
const POOL_PATH = path.resolve(ROOT, String(process.env.V4FLASH_POOL_PATH || path.join(POOL_DIR, "persona_pool_v2.json")).trim());
const POOL_MANIFEST_PATH = path.resolve(ROOT, String(process.env.V4FLASH_POOL_MANIFEST_PATH || path.join(POOL_DIR, "pool_manifest.json")).trim());
const CLIENT_RENDER_MANIFEST_PATH = path.join(ROOT, "client", "render_manifest.json");

const EXPECTED_MODEL = "deepseek-v4-flash-0731";
const PROVIDER = "qwen-ai-platform";
const TEMPERATURE = 0.55;
const MAX_REPAIRS = 2;
const MAX_TRANSPORT_RETRIES = 3;
const RETRY_DELAYS_MS = [1000, 2000, 4000];
const REQUEST_TIMEOUT_MS = 120000;
const CONDITIONS = ["Q", "S"];
const REP = 1;
const LAYERED_GENERATION_SEED = 20260806;
const REGISTERED_Q_INSTRUCTION = "在做这个决策之前，以你的经验和直觉，你觉得此刻必须先搞清楚的问题是什么？只写问题本身，不要回答它。";
const BASE_REQUIRED_STAGES = [
  "R1",
  "persona_reply_1",
  "coach_reply_1",
  "persona_reply_2",
  "coach_reply_2",
  "persona_reply_3",
  "coach_reply_3",
  "VP_synthesis",
  "synthesis_feedback",
  "VP_field_extraction",
  "persona_generation",
  "D3",
  "tag_extractor",
  "D4",
  "D5"
];
const REQUIRED_STAGES_BY_CONDITION = {
  Q: ["D_q", ...BASE_REQUIRED_STAGES],
  S: BASE_REQUIRED_STAGES
};

const chainContext = new AsyncLocalStorage();
const outstandingCalls = new Set();

let configuredModel = "";
let configuredBaseUrl = "";
let configuredApiKeys = [];
let chatUrl = null;
let callsPath = CALLS_PATH;
let llmLimit = null;
let callSequence = 0;
let responseModel = "";

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

function parseArgs(argv) {
  const args = { concurrency: 1, limit: 0 };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--concurrency") {
      args.concurrency = Number(argv[++index]);
    } else if (arg === "--limit") {
      args.limit = Number(argv[++index]);
    } else {
      throw new Error(`unknown argument: ${arg}`);
    }
  }
  if (!Number.isInteger(args.concurrency) || args.concurrency < 1) {
    throw new Error("--concurrency must be a positive integer");
  }
  if (!Number.isInteger(args.limit) || args.limit < 0) {
    throw new Error("--limit must be a non-negative integer");
  }
  return args;
}

function requireNonEmptyEnv(name) {
  const value = String(process.env[name] || "").trim();
  if (!value) throw new Error(`missing required env: ${name}`);
  return value;
}

function configuredKeyPool() {
  const seen = new Set();
  const keys = [];
  const suffixed = Object.keys(process.env)
    .filter((key) => /^(QWEN_API_KEY|DASHSCOPE_API_KEY)_\d+$/.test(key))
    .sort((a, b) => {
      const prefixA = a.replace(/_\d+$/, "");
      const prefixB = b.replace(/_\d+$/, "");
      if (prefixA !== prefixB) return prefixA.localeCompare(prefixB);
      return Number(a.match(/_(\d+)$/)?.[1] || 0) - Number(b.match(/_(\d+)$/)?.[1] || 0);
    });
  for (const envName of suffixed) {
    const value = String(process.env[envName] || "").trim();
    if (value && !seen.has(value)) {
      seen.add(value);
      keys.push({ envName, value });
    }
  }
  for (const envName of ["QWEN_API_KEY", "DASHSCOPE_API_KEY"]) {
    const value = String(process.env[envName] || "").trim();
    if (value && !seen.has(value)) {
      seen.add(value);
      keys.push({ envName, value });
    }
  }
  if (!keys.length) throw new Error("missing required env: QWEN_API_KEY or DASHSCOPE_API_KEY");
  return keys;
}

function readConfig() {
  const provider = requireNonEmptyEnv("LLM_PROVIDER").toLowerCase();
  if (provider !== "qwen") throw new Error(`LLM_PROVIDER must be qwen, got ${provider}`);
  const model = requireNonEmptyEnv("QWEN_MODEL");
  if (model !== EXPECTED_MODEL) throw new Error(`QWEN_MODEL must be ${EXPECTED_MODEL}, got ${model}`);
  const baseUrl = String(process.env.QWEN_BASE_URL || process.env.DASHSCOPE_BASE_URL || process.env.LLM_BASE_URL || "").trim();
  if (!baseUrl) throw new Error("missing required env: QWEN_BASE_URL or DASHSCOPE_BASE_URL or LLM_BASE_URL");
  const disableThinking = String(process.env.QWEN_DISABLE_THINKING || "").trim();
  const enableThinking = String(process.env.QWEN_ENABLE_THINKING || "").trim();
  if (!(disableThinking === "1" || /^(0|false|no|off)$/i.test(enableThinking))) {
    throw new Error("thinking must be explicitly disabled via QWEN_DISABLE_THINKING=1 or QWEN_ENABLE_THINKING=false");
  }
  return { model, baseUrl, apiKeys: configuredKeyPool() };
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

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function fileSha256(filePath) {
  return sha256(fs.readFileSync(filePath));
}

function git(args) {
  try {
    return execFileSync("git", args, { cwd: ROOT, encoding: "utf8" }).trim();
  } catch (_) {
    return "";
  }
}

function loadJson(filePath) {
  if (!fs.existsSync(filePath)) throw new Error(`required file missing: ${path.relative(ROOT, filePath)}`);
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJsonAtomic(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  fs.renameSync(tmp, filePath);
}

function assertRenderManifestLoaded(materials) {
  if (!materials.renderManifest && fs.existsSync(CLIENT_RENDER_MANIFEST_PATH)) {
    materials.renderManifest = loadJson(CLIENT_RENDER_MANIFEST_PATH);
  }
  if (!materials.renderManifest || typeof materials.renderManifest !== "object" || !Object.keys(materials.renderManifest).length) {
    throw new Error(`required infoSetManifest failed to load from ${CLIENT_RENDER_MANIFEST_PATH}`);
  }
  if (!materials.renderManifest.manifest_version) {
    throw new Error(`required infoSetManifest missing manifest_version at ${CLIENT_RENDER_MANIFEST_PATH}`);
  }
  return materials.renderManifest;
}

function appendJsonl(filePath, row) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.appendFileSync(filePath, `${JSON.stringify(row)}\n`, "utf8");
}

function readJsonl(filePath) {
  if (!fs.existsSync(filePath)) return [];
  return fs.readFileSync(filePath, "utf8")
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line));
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
      req.destroy(Object.assign(new Error(`request timeout after ${timeoutMs}ms`), {
        code: "ETIMEDOUT",
        latencyMs: Date.now() - startedAt
      }));
    });
    req.on("error", (error) => {
      reject(Object.assign(error, {
        statusCode: Number(error?.statusCode || 0),
        latencyMs: Date.now() - startedAt
      }));
    });
    req.write(body);
    req.end();
  });
}

function responseContent(parsed) {
  const content = parsed?.choices?.[0]?.message?.content;
  return typeof content === "string" ? content : "";
}

function completionTokens(parsed) {
  const value = Number(parsed?.usage?.completion_tokens);
  return Number.isFinite(value) ? value : null;
}

function classifyStage(messages, options = {}) {
  const context = chainContext.getStore();
  const counters = context?.counters || {};
  const role = String(options.role || "chat_service").trim();
  const joined = (Array.isArray(messages) ? messages : [])
    .map((message) => String(message?.content || ""))
    .join("\n");

  if (role === "vp_coach") {
    if (joined.includes("价值主张整理工具")) return "VP_synthesis";
    if (joined.includes("学生合成的价值主张")) return "synthesis_feedback";
    counters.coach = Number(counters.coach || 0) + 1;
    return `coach_reply_${counters.coach}`;
  }
  if (role === "persona_generator") return "persona_generation";
  if (role === "tag_extractor") return "tag_extractor";
  if (role === "vp_embedding_scorer") return "VP_field_extraction";
  if (role === "vp_word_scorer") return "VP_scorer_feedback";

  if (joined.includes("【问题定义】") || joined.includes('输出 JSON：{"question"')) return "D_q";
  if (joined.includes("做出 R1 的第一个战略选择") || joined.includes("填好 R1 JSON") || joined.includes("【界面：选择你的战略定位】")) return "R1";
  if (joined.includes("用第一人称回复")) {
    counters.personaReply = Number(counters.personaReply || 0) + 1;
    return `persona_reply_${counters.personaReply}`;
  }
  if (joined.includes("【界面操作】你正在根据反馈修改价值主张草稿")) {
    counters.personaReply = Number(counters.personaReply || 0) + 1;
    return `persona_reply_${counters.personaReply}`;
  }
  if (joined.includes("从 summary 中最多提取三条") || joined.includes("【界面：客户调研报告】")) return "D3";
  if (joined.includes("依据 R1-R2 栈选择能力卡") || joined.includes("填好能力卡 JSON") || joined.includes("【界面：个人选卡】")) return "D4";
  if (joined.includes("依据既有栈做最终定价") || joined.includes("填好定价 JSON") || joined.includes("【界面：定价决策】")) return "D5";
  return role;
}

function currentCallBase(stage, retryCount) {
  const context = chainContext.getStore() || {};
  return {
    ts: new Date().toISOString(),
    persona_id: context.personaId || "unknown",
    condition: context.condition || "",
    rep: Number(context.rep || REP),
    chain_key: context.chainKey || "",
    step: Number(context.step || 0),
    stage,
    retry_count: retryCount
  };
}

function logCall(record) {
  appendJsonl(callsPath, record);
}

function isRetryableStatus(statusCode) {
  return statusCode === 429 || statusCode >= 500;
}

function isRetryableError(error) {
  const statusCode = Number(error?.statusCode || 0);
  if (isRetryableStatus(statusCode)) return true;
  return /timeout|ECONNRESET|ETIMEDOUT|EAI_AGAIN|ECONNREFUSED|EPIPE/i.test(String(error?.code || error?.message || ""));
}

async function auditedChatCompletionInner(messages, options = {}) {
  const context = chainContext.getStore();
  if (context) {
    context.step = Number(context.step || 0) + 1;
  }
  const stage = classifyStage(messages, options);
  const callId = ++callSequence;
  const timeoutMs = Number.isFinite(Number(options.timeoutMs)) ? Number(options.timeoutMs) : REQUEST_TIMEOUT_MS;
  const keyIndex = callId % configuredApiKeys.length;
  const apiKey = configuredApiKeys[keyIndex];
  const requestBody = {
    model: configuredModel,
    messages,
    temperature: TEMPERATURE,
    max_tokens: options.max_tokens ?? 1600,
    enable_thinking: false,
    ...(options.response_format ? { response_format: options.response_format } : {})
  };

  for (let retryCount = 0; retryCount <= MAX_TRANSPORT_RETRIES; retryCount += 1) {
    const attemptStartedAt = Date.now();
    const body = JSON.stringify(requestBody);
    try {
      const response = await requestJson(chatUrl, apiKey.value, body, timeoutMs);
      const base = currentCallBase(stage, retryCount);
      const httpCode = Number(response.statusCode || 0);
      const model = String(response.parsed?.model || "");
      if (model && !responseModel) responseModel = model;

      if (httpCode === 429) {
        logCall({
          ...base,
          http_code: httpCode,
          status: "rate_limited",
          latency_ms: response.latencyMs ?? (Date.now() - attemptStartedAt),
          completion_tokens: null,
          output_chars: 0,
          model,
          retryable: retryCount < MAX_TRANSPORT_RETRIES
        });
        if (retryCount < MAX_TRANSPORT_RETRIES) {
          await sleep(RETRY_DELAYS_MS[retryCount]);
          continue;
        }
        const error = new Error("rate limited");
        error.statusCode = httpCode;
        error.alreadyLogged = true;
        throw error;
      }

      if (httpCode >= 400 || response.parsed?.error) {
        const message = response.parsed?.error?.message || `HTTP ${httpCode}`;
        logCall({
          ...base,
          http_code: httpCode,
          status: "error",
          latency_ms: response.latencyMs ?? (Date.now() - attemptStartedAt),
          completion_tokens: null,
          output_chars: 0,
          model,
          retryable: isRetryableStatus(httpCode) && retryCount < MAX_TRANSPORT_RETRIES,
          error: message
        });
        if (isRetryableStatus(httpCode) && retryCount < MAX_TRANSPORT_RETRIES) {
          await sleep(RETRY_DELAYS_MS[retryCount]);
          continue;
        }
        const error = new Error(message);
        error.statusCode = httpCode;
        error.alreadyLogged = true;
        throw error;
      }

      const output = responseContent(response.parsed).trim();
      if (!output) {
        logCall({
          ...base,
          http_code: httpCode,
          status: "empty",
          latency_ms: response.latencyMs ?? (Date.now() - attemptStartedAt),
          completion_tokens: completionTokens(response.parsed),
          output_chars: 0,
          model,
          retryable: retryCount < MAX_TRANSPORT_RETRIES
        });
        if (retryCount < MAX_TRANSPORT_RETRIES) {
          await sleep(RETRY_DELAYS_MS[retryCount]);
          continue;
        }
        const error = new Error("empty response content");
        error.statusCode = httpCode;
        error.alreadyLogged = true;
        throw error;
      }

      logCall({
        ...base,
        http_code: httpCode,
        status: "ok",
        latency_ms: response.latencyMs ?? (Date.now() - attemptStartedAt),
        completion_tokens: completionTokens(response.parsed),
        output_chars: countChars(output),
        model,
        retryable: false,
        prompt_sha256: sha256(body)
      });
      return output;
    } catch (error) {
      if (error?.alreadyLogged) throw error;
      if (!isRetryableError(error) || retryCount >= MAX_TRANSPORT_RETRIES) {
        logCall({
          ...currentCallBase(stage, retryCount),
          http_code: Number(error?.statusCode || 0),
          status: Number(error?.statusCode || 0) === 429 ? "rate_limited" : "error",
          latency_ms: Number(error?.latencyMs || 0) || (Date.now() - attemptStartedAt),
          completion_tokens: null,
          output_chars: 0,
          model: "",
          retryable: false,
          error: String(error?.message || error)
        });
        throw error;
      }
      logCall({
        ...currentCallBase(stage, retryCount),
        http_code: Number(error?.statusCode || 0),
        status: Number(error?.statusCode || 0) === 429 ? "rate_limited" : "error",
        latency_ms: Number(error?.latencyMs || 0) || (Date.now() - attemptStartedAt),
        completion_tokens: null,
        output_chars: 0,
        model: "",
        retryable: true,
        error: String(error?.message || error)
      });
      await sleep(RETRY_DELAYS_MS[retryCount]);
    }
  }

  throw new Error("unreachable LLM retry state");
}

function auditedChatCompletion(messages, options = {}) {
  const task = llmLimit(() => auditedChatCompletionInner(messages, options));
  outstandingCalls.add(task);
  task.finally(() => outstandingCalls.delete(task));
  return task;
}

async function waitForOutstandingCalls() {
  while (outstandingCalls.size) {
    await Promise.allSettled(Array.from(outstandingCalls));
  }
}

function installModulePatches() {
  process.env.LLM_LOG = "0";
  process.env.LLM_MODEL_OVERRIDE = configuredModel;
  process.env.QWEN_MODEL = configuredModel;
  process.env.QWEN_DISABLE_THINKING = "1";

  const deepseekPath = require.resolve("../../server/llm/deepseekClient");
  require.cache[deepseekPath] = {
    id: deepseekPath,
    filename: deepseekPath,
    loaded: true,
    exports: {
      chatCompletion: auditedChatCompletion,
      hasAnyKey: () => true,
      __TEST_GET_POOL: () => configuredApiKeys.map((item) => item.value),
      __TEST_BUILD_CHAT_URL: buildChatCompletionsUrl
    }
  };

  const loggerPath = require.resolve("../../server/llm/llm_logger");
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

  const kvPath = require.resolve("../../server/db/kvCache");
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
    "../../server/llm/tagExtractor",
    "../../server/llm/personaGenerator",
    "../../server/llm/vpWordScorer",
    "../../server/llm/vpEmbeddingScorer",
    "../../server/llm/vpCoach"
  ].forEach((modulePath) => {
    delete require.cache[require.resolve(modulePath)];
  });
}

function deterministicJinangDraw(materials, pairIndex) {
  const market = Array.isArray(materials.jinangConfig?.market) ? materials.jinangConfig.market : [];
  const tech = Array.isArray(materials.jinangConfig?.tech) ? materials.jinangConfig.tech : [];
  if (!market.length || !tech.length) throw new Error("jinang config must contain market and tech cards");
  return {
    market: market[pairIndex % market.length],
    tech: tech[Math.floor(pairIndex / market.length) % tech.length],
    method: "deterministic_pair_index_from_persona_pool_v2; same draw for Q/S pair"
  };
}

function jinangDrawForTask(materials, record, pairIndex) {
  const draw = record?.jinang_draw;
  if (draw?.market && draw?.tech) {
    return {
      ...draw,
      method: draw.method || "seeded_random_pair_draw_from_pool_record; same draw for Q/S pair"
    };
  }
  return deterministicJinangDraw(materials, pairIndex);
}

function questionDefinitionContextProvider(FullGame, materials) {
  const cardRows = typeof FullGame.publicCardRows === "function"
    ? FullGame.publicCardRows(materials)
    : [];
  return ({ stage }) => stage === "D4" ? [
    "【D4 学生可见卡池补充】",
    "以下字段为能力卡选择时学生可见字段；不注入内部成本、风险或结算公式。",
    JSON.stringify(cardRows, null, 2)
  ].join("\n") : "";
}

function surfaceSentence(record) {
  const surface = record.surface || {};
  const gender = surface.gender === "female" ? "女" : "男";
  const overseas = surface.overseas?.hasOverseas
    ? `${surface.overseas.destination}，${surface.overseas.duration}`
    : "无海外经历";
  return [
    `染色身份：${surface.name}，${gender}，${surface.age}岁`,
    `学历${surface.edu}`,
    `海外经历${overseas}`,
    `MBTI ${surface.mbti}`,
    `表达风格：${surface.expression_style}`
  ].join("；");
}

function seededPick(items, seedText) {
  const list = Array.isArray(items) ? items : [];
  if (!list.length) return "";
  const digest = crypto.createHash("sha256").update(String(seedText)).digest("hex");
  const index = parseInt(digest.slice(0, 8), 16) % list.length;
  return list[index];
}

function genderTweak(profile, gender, key) {
  if (gender !== "female") return "";
  return String(profile?.genderModifiers?.female?.[key] || "").trim();
}

function educationBand(education) {
  const value = String(education || "");
  if (/博士|MBA|海归硕士|海外硕士|985|211/.test(value)) return "high";
  if (/本科|硕士/.test(value)) return "medium";
  if (/高中|中专|大专/.test(value)) return "low";
  return "medium";
}

function sanitizeLayeredPromptText(text) {
  return String(text || "")
    .replace(/[0-9０-９]+\s*[-~—–]\s*[0-9０-９]+\s*(?:年|个月|岁|万元|万|亿|DAU|页|个|家|轮|次|条|%)/gi, "若干")
    .replace(/[0-9０-９]+\s*(?:年|个月|岁|万元|万|亿|DAU|页|个|家|轮|次|条|%)/gi, "若干")
    .replace(/[0-9０-９]+/g, "若干");
}

function buildLayeredStudent(basePersona, poolRecord) {
  const { deriveExpressionModifier } = require("../sim/persona_pool");
  const profile = basePersona.profile || {};
  const surface = poolRecord.surface || {};
  const expressionStyle = String(surface.expression_style || profile.expressionStyle || "");
  const interviewTweak = genderTweak(profile, surface.gender, "interviewTweak");
  return {
    ...profile,
    id: poolRecord.persona_id,
    personaId: poolRecord.persona_id,
    label: basePersona.label,
    name: String(surface.name || poolRecord.persona_id),
    gender: surface.gender || "male",
    age: Number(surface.age || 0) || "",
    education: String(surface.edu || profile.education || ""),
    overseas: surface.overseas || { hasOverseas: false, destination: "", duration: "" },
    mbti: String(surface.mbti || ""),
    expressionStyle,
    expressionModifier: deriveExpressionModifier(surface.edu || profile.education || ""),
    fullExpressionStyle: expressionStyle,
    role: String(profile.role || ""),
    background: String(profile.background || basePersona.desc || ""),
    industry: String(profile.industry || ""),
    decisionStyle: String(profile.decisionStyle || ""),
    riskPreference: String(profile.riskPreference || ""),
    blindSpots: String(profile.blindSpots || basePersona.core_blind_spot || ""),
    interviewStyle: String(profile.interviewStyle || ""),
    interviewStyleFull: [String(profile.interviewStyle || ""), interviewTweak].filter(Boolean).join("。"),
    pricingBias: String(profile.pricingBias || ""),
    vpQuirks: String(profile.vpQuirks || "")
  };
}

function buildLayeredSeedMemory(student, poolRecord) {
  const baseSeed = `${LAYERED_GENERATION_SEED}:L0:${poolRecord.persona_id}`;
  return {
    backstory: `${student.background || student.role || "有多年行业经验"}；现在以${student.role || "企业管理者"}身份来读 EMBA，希望把自己的经验迁移到 AI 宠物机器人这类新业务。`,
    decision_habit: `${student.decisionStyle || "先凭经验判断，再看数据验证。"}遇到不确定时，会先回到自己熟悉的行业和组织经验里找类比。`,
    discussion_style: `${student.fullExpressionStyle || student.expressionStyle || "讨论时会带着明显个人风格。"}课堂讨论中${seededPick(["会先抛观点再补理由", "会先听一轮再抓关键点回应", "会把问题拉回落地和资源约束", "会用自己熟悉的案例解释判断"], `${baseSeed}:discussion`)}。`,
    confidence_zone: `${student.industry || "自己熟悉的行业"}、渠道打法、组织资源和真实客户场景里的判断最有把握。`,
    blind_zone: `${student.blindSpots || "对陌生领域容易忽略或回避。"}在 AI 机器人、能力卡组合和用户研究细节上容易带入既有经验。`,
    under_pressure: seededPick([
      "时间紧时会先做一个能讲得通的选择，再把细节留到后面修。",
      "时间紧时会把问题简化成资源、客户和回款三件事。",
      "时间紧时会优先选择自己能解释清楚、能管得住风险的方案。",
      "时间紧时会抓一个最像既有业务的路径，避免过度发散。"
    ], `${baseSeed}:pressure`),
    pet_phrases: seededPick([
      "先把这个事落到具体人群上。",
      "不能光听着高级，要能卖得出去。",
      "这个逻辑要闭环。",
      "我先按自己的经验判断。"
    ], `${baseSeed}:phrase`)
  };
}

function buildLayeredClassroomProfile(student, seedMemory, poolRecord) {
  const baseSeed = `${LAYERED_GENERATION_SEED}:L1:${poolRecord.persona_id}`;
  const band = educationBand(student.education);
  const abstractionAbility = band === "high" ? "high" : band === "low" ? "low" : "medium";
  const writingPrecision = band === "low" ? "low" : seededPick(["medium", "high"], `${baseSeed}:writing`);
  return {
    abstraction_ability: abstractionAbility,
    writing_precision: writingPrecision,
    coach_receptiveness: seededPick(["medium", "medium", "high", "low"], `${baseSeed}:coach`),
    effort_style: seededPick(["认真打磨", "先交差后面改", "先交差后面改", "依赖队友"], `${baseSeed}:effort`),
    team_role: seededPick(["主导", "质疑", "跟随", "调停"], `${baseSeed}:role`),
    why_here: `希望把${student.industry || "既有行业"}经验系统化，并借课堂判断 AI 宠物机器人是否能形成新增长点。`,
    knowledge_ceiling: seedMemory.blind_zone || "在陌生领域的市场定位与用户研究容易停留在直觉层面。",
    response_to_AI_coach: seededPick([
      "会先看建议是否实用，能落地就采纳，太虚就保留意见。",
      "会接受能帮他收敛目标用户和能力配置的反馈，但会抵触纯框架化表达。",
      "会把 AI Coach 当成提醒清单，最终仍按自己的行业经验拍板。",
      "会认真吸收结构化建议，但会要求它解释清楚为什么能赚钱。"
    ], `${baseSeed}:ai_coach`)
  };
}

function buildSimplePersona(basePersona, poolRecord) {
  return {
    ...basePersona,
    id: poolRecord.persona_id,
    label: basePersona.label,
    desc: `${basePersona.desc}\n【你的人生经验】\n${surfaceSentence(poolRecord)}`,
    profile: {
      ...(basePersona.profile || {}),
      surface: poolRecord.surface,
      synthetic: true
    },
    archetype: poolRecord.archetype,
    surface: poolRecord.surface,
    synthetic: true,
    persona_pool_record: poolRecord
  };
}

function buildLayeredPersona(basePersona, poolRecord) {
  const { PersonaStudent } = require("../sim/persona_student");
  const student = buildLayeredStudent(basePersona, poolRecord);
  const seedMemory = buildLayeredSeedMemory(student, poolRecord);
  const classroomProfile = buildLayeredClassroomProfile(student, seedMemory, poolRecord);
  const actor = new PersonaStudent({
    student,
    seedMemory,
    classroomProfile
  });
  const systemPrompt = sanitizeLayeredPromptText(actor.buildLayeredSystemPrompt({ includeVpLengthConstraint: false }));
  const layered = {
    seed: LAYERED_GENERATION_SEED,
    l0_seed: `${LAYERED_GENERATION_SEED}:L0:${poolRecord.persona_id}`,
    l1_seed: `${LAYERED_GENERATION_SEED}:L1:${poolRecord.persona_id}`,
    generator_module: "scripts/sim/persona_student.js",
    generator_entrypoint: "PersonaStudent.buildLayeredSystemPrompt",
    generation_method: "deterministic_seeded_L0_L1_from_frozen_persona_pool_surface",
    student,
    seed_memory: seedMemory,
    classroom_profile: classroomProfile,
    system_prompt_sha256: sha256(systemPrompt)
  };
  return {
    ...basePersona,
    id: poolRecord.persona_id,
    label: basePersona.label,
    desc: [
      basePersona.desc,
      "【你的人生经验】",
      surfaceSentence(poolRecord),
      "【你的做事习惯】",
      systemPrompt
    ].join("\n"),
    profile: {
      ...(basePersona.profile || {}),
      surface: poolRecord.surface,
      synthetic: true,
      layered
    },
    archetype: poolRecord.archetype,
    surface: poolRecord.surface,
    synthetic: true,
    persona_pool_record: poolRecord,
    layered_system_prompt: systemPrompt,
    layered_seed_memory: seedMemory,
    layered_classroom_profile: classroomProfile
  };
}

function buildPersonaForArm(basePersona, poolRecord) {
  if (PERSONA_INJECTION_MODE === "layered") return buildLayeredPersona(basePersona, poolRecord);
  if (PERSONA_INJECTION_MODE === "simple") return buildSimplePersona(basePersona, poolRecord);
  throw new Error(`unsupported persona injection mode: ${PERSONA_INJECTION_MODE}`);
}

function taskKey(task) {
  return `${task.persona.persona_id}|${task.condition}|${task.rep}`;
}

function chainFilename(task) {
  return `${task.persona.persona_id}_${task.condition}${task.rep}.json`;
}

function buildTasks(poolRecords, materials) {
  const baseByArchetype = new Map(materials.personas.map((persona) => [persona.id, persona]));
  return poolRecords.flatMap((record, pairIndex) => {
    const base = baseByArchetype.get(record.archetype);
    if (!base) throw new Error(`missing base archetype materials for ${record.archetype}`);
    const persona = buildPersonaForArm(base, record);
    return CONDITIONS.map((condition) => ({
      persona: record,
      fullGamePersona: persona,
      condition,
      rep: REP,
      pairIndex
    }));
  });
}

function existingChainKeys() {
  if (!fs.existsSync(CHAINS_DIR)) return new Set();
  const keys = new Set();
  for (const file of fs.readdirSync(CHAINS_DIR)) {
    if (!file.endsWith(".json")) continue;
    try {
      const artifact = JSON.parse(fs.readFileSync(path.join(CHAINS_DIR, file), "utf8"));
      if (artifact?.chain_key) keys.add(artifact.chain_key);
    } catch (_) {}
  }
  return keys;
}

function createRegime(poolManifest, startedAt) {
  return {
    model: EXPECTED_MODEL,
    provider: PROVIDER,
    enable_thinking: false,
    temperature: TEMPERATURE,
    max_repairs: MAX_REPAIRS,
    quantity_policy: "min6",
    persona_pool: {
      seed: String(poolManifest.seed),
      script_git_hash: String(poolManifest.script_git_hash || ""),
      repo_git_hash: String(poolManifest.repo_git_hash || ""),
      pool_path: path.relative(ROOT, POOL_PATH),
      manifest_path: path.relative(ROOT, POOL_MANIFEST_PATH),
      manifest_sha256: fileSha256(POOL_MANIFEST_PATH),
      pool_sha256: fileSha256(POOL_PATH)
    },
    info_set_manifest: fs.existsSync(CLIENT_RENDER_MANIFEST_PATH)
      ? {
        path: path.relative(ROOT, CLIENT_RENDER_MANIFEST_PATH),
        sha256: fileSha256(CLIENT_RENDER_MANIFEST_PATH)
      }
      : null,
    layered_generation_seed: LAYERED_GENERATION_SEED,
    layered_generation: {
      seed: LAYERED_GENERATION_SEED,
      l0_seed_namespace: `${LAYERED_GENERATION_SEED}:L0:<persona_id>`,
      l1_seed_namespace: `${LAYERED_GENERATION_SEED}:L1:<persona_id>`,
      generator_module: "scripts/sim/persona_student.js",
      generator_entrypoint: "PersonaStudent.buildLayeredSystemPrompt",
      generation_method: "deterministic_seeded_L0_L1_from_frozen_persona_pool_surface"
    },
    started_at: startedAt
  };
}

function ensureRegime(poolManifest, startedAt) {
  fs.mkdirSync(RUN_ROOT, { recursive: true });
  if (fs.existsSync(REGIME_PATH)) {
    const regime = loadJson(REGIME_PATH);
    let changed = false;
    if (regime.layered_generation_seed !== LAYERED_GENERATION_SEED) {
      regime.layered_generation_seed = LAYERED_GENERATION_SEED;
      changed = true;
    }
    if (!regime.layered_generation) {
      regime.layered_generation = {
        seed: LAYERED_GENERATION_SEED,
        l0_seed_namespace: `${LAYERED_GENERATION_SEED}:L0:<persona_id>`,
        l1_seed_namespace: `${LAYERED_GENERATION_SEED}:L1:<persona_id>`,
        generator_module: "scripts/sim/persona_student.js",
        generator_entrypoint: "PersonaStudent.buildLayeredSystemPrompt",
        generation_method: "deterministic_seeded_L0_L1_from_frozen_persona_pool_surface"
      };
      changed = true;
    }
    if (changed) writeJsonAtomic(REGIME_PATH, regime);
    return regime;
  }
  const regime = createRegime(poolManifest, startedAt);
  writeJsonAtomic(REGIME_PATH, regime);
  return regime;
}

function regimeFingerprint(regime) {
  return sha256(JSON.stringify(regime));
}

function repairCountsFromRow(row) {
  return {
    D_q: (row.question_definition?.calls || [])
      .reduce((sum, call) => sum + Math.max(0, Number(call?.attempts || 0) - 1), 0),
    R1: Math.max(0, Number(row.r1_choice?.attempts || 0) - 1),
    D3: Math.max(0, Number(row.r2?.d3?.attempts || 0) - 1),
    D4: Math.max(0, Number(row.r2?.d4?.attempts || 0) - 1),
    D5: Math.max(0, Number(row.r2?.d5?.attempts || 0) - 1)
  };
}

function jsonDecisionCalls(row) {
  return [
    ...(row.question_definition?.calls || []),
    row.r1_choice,
    row.r2?.d3,
    row.r2?.d4,
    row.r2?.d5
  ].filter(Boolean);
}

function salvageCountFromRow(row) {
  return jsonDecisionCalls(row).filter((call) => call.salvage === true).length;
}

function repairDiffsFromRow(row) {
  return jsonDecisionCalls(row).flatMap((call) => Array.isArray(call.repair_diffs) ? call.repair_diffs : []);
}

function salvageByStageFromRow(row) {
  const counts = {};
  for (const call of jsonDecisionCalls(row)) {
    if (!call.salvage) continue;
    const logStage = call.attempt_log?.find((entry) => entry.validator_status === "ok")?.stage || call.stage || "unknown";
    counts[logStage] = Number(counts[logStage] || 0) + 1;
  }
  return counts;
}

function buildChainArtifact({ task, row, regime, attempt, startedAt, finishedAt }) {
  const repairs = repairCountsFromRow(row);
  const repairDiffs = repairDiffsFromRow(row);
  return {
    archetype: task.persona.archetype,
    persona_id: task.persona.persona_id,
    condition: task.condition,
    rep: task.rep,
    arm_id: ARM_ID,
    regime_fingerprint: regimeFingerprint(regime),
    synthetic: true,
    chain_key: taskKey(task),
    chain_attempt: attempt,
    started_at: startedAt,
    finished_at: finishedAt,
    persona_pool_record: task.persona,
    persona_injection_mode: PERSONA_INJECTION_MODE,
    layered_generation: task.fullGamePersona.profile?.layered || null,
    source_runner: {
      module: "scripts/analysis/full_game_all_personas.js",
      function: "runPlaythrough",
      prompt_mode: PROMPT_MODE,
      persona_injection: PERSONA_INJECTION_MODE === "layered"
        ? "frozen persona_pool_v2 surface rendered through scripts/sim/persona_student.js::PersonaStudent.buildLayeredSystemPrompt; map_items and core_blind_spot retained at archetype level"
        : PROMPT_MODE === "interface"
          ? "surface fields woven into persona.desc; cognitive map disabled for prompt/validator; interface-visible fields only"
          : "surface fields woven into persona.desc; map_items and core_blind_spot retained at archetype level"
    },
    stage1_notes: {
      q_s_condition_note: PROMPT_MODE === "interface"
        ? "Q keeps f912715 questionDefinition as a UI self-question step; R1/D3/D4/D5 use interface-faithful prompt frames."
        : "Q uses f912715 questionDefinition semantics; S uses the standard full_game prompt frames.",
      deterministic_salvage: "callJson runs deterministic salvage before LLM repair and records every validator-failed raw attempt."
    },
    salvage: salvageCountFromRow(row) > 0,
    salvage_count: salvageCountFromRow(row),
    salvage_by_stage: salvageByStageFromRow(row),
    repairs_by_stage: repairs,
    repair_diffs: repairDiffs,
    row
  };
}

async function runOneTask({ task, FullGame, runtime, materials, regime, attempt }) {
  const chainKeyValue = taskKey(task);
  const startedAt = new Date().toISOString();
  const context = {
    personaId: task.persona.persona_id,
    condition: task.condition,
    rep: task.rep,
    chainKey: chainKeyValue,
    step: 0,
    counters: {}
  };
  const draw = jinangDrawForTask(materials, task.persona, task.pairIndex);
  const row = await chainContext.run(context, () => FullGame.runPlaythrough(
    runtime,
    task.fullGamePersona,
    materials,
    RUN_ID,
    {
      condition: task.condition,
      rep: task.rep,
      jinangDraw: draw,
      questionDefinition: task.condition === "Q",
      questionDefinitionInstruction: REGISTERED_Q_INSTRUCTION,
      questionDefinitionContextProvider: questionDefinitionContextProvider(FullGame, materials),
      infoSetManifest: materials.renderManifest,
      promptMode: PROMPT_MODE
    }
  ));
  row.arm_id = ARM_ID;
  row.synthetic = true;
  row.persona_pool_record = task.persona;
  row.source_chain_key = chainKeyValue;
  row.paired_run = {
    pair_id: task.persona.persona_id,
    condition: task.condition,
    rep: task.rep,
    started_at: startedAt,
    ended_at: new Date().toISOString()
  };
  row.regime_fingerprint = regimeFingerprint(regime);
  row.formal_contract = {
    arm_id: ARM_ID,
    persona_injection_mode: PERSONA_INJECTION_MODE,
    prompt_mode: PROMPT_MODE,
    q_s_semantics_source: "f912715 scripts/analysis/formal_round_v3.js:419-426",
    question_definition_enabled: task.condition === "Q",
    q_instruction_sha256: sha256(REGISTERED_Q_INSTRUCTION),
    info_set_manifest_version: materials.renderManifest?.manifest_version || null,
    same_persona_jinang_sha256: sha256(JSON.stringify(draw)),
    layered_system_prompt_sha256: task.fullGamePersona.profile?.layered?.system_prompt_sha256 || null,
    layered_l0_seed: task.fullGamePersona.profile?.layered?.l0_seed || null,
    layered_l1_seed: task.fullGamePersona.profile?.layered?.l1_seed || null
  };

  const artifact = buildChainArtifact({
    task,
    row,
    regime,
    attempt,
    startedAt,
    finishedAt: new Date().toISOString()
  });

  if (row.status === "OK") {
    writeJsonAtomic(path.join(CHAINS_DIR, chainFilename(task)), artifact);
  } else {
    const failedName = `${task.persona.persona_id}_${task.condition}${task.rep}_attempt${attempt}.json`;
    writeJsonAtomic(path.join(FAILED_DIR, failedName), artifact);
  }
  return artifact;
}

function percentile(values, pct) {
  const sorted = values.filter((value) => Number.isFinite(Number(value))).map(Number).sort((a, b) => a - b);
  if (!sorted.length) return 0;
  const index = Math.ceil((pct / 100) * sorted.length) - 1;
  return sorted[Math.max(0, Math.min(sorted.length - 1, index))];
}

function listChainArtifacts() {
  if (!fs.existsSync(CHAINS_DIR)) return [];
  return fs.readdirSync(CHAINS_DIR)
    .filter((file) => file.endsWith(".json"))
    .sort()
    .map((file) => loadJson(path.join(CHAINS_DIR, file)));
}

function stagesByChain(calls) {
  const byChain = new Map();
  for (const call of calls) {
    if (!call.chain_key || call.status !== "ok") continue;
    if (!byChain.has(call.chain_key)) byChain.set(call.chain_key, new Set());
    byChain.get(call.chain_key).add(call.stage);
  }
  return byChain;
}

function requiredStagesForCondition(condition) {
  return REQUIRED_STAGES_BY_CONDITION[condition] || BASE_REQUIRED_STAGES;
}

function buildSummary({ concurrency, startedAt, finishedAt, expectedChains, finalFailedKeys }) {
  const calls = readJsonl(CALLS_PATH);
  const artifacts = listChainArtifacts();
  const okArtifacts = artifacts.filter((artifact) => artifact.row?.status === "OK");
  const repairTotals = { D_q: 0, R1: 0, D3: 0, D4: 0, D5: 0 };
  const salvageTotals = {};
  let salvageCount = 0;
  let repairDecisionDiffCount = 0;
  for (const artifact of okArtifacts) {
    const repairs = artifact.repairs_by_stage || {};
    for (const stage of Object.keys(repairTotals)) {
      repairTotals[stage] += Number(repairs[stage] || 0);
    }
    salvageCount += Number(artifact.salvage_count || 0);
    for (const [stage, count] of Object.entries(artifact.salvage_by_stage || {})) {
      salvageTotals[stage] = Number(salvageTotals[stage] || 0) + Number(count || 0);
    }
    repairDecisionDiffCount += Array.isArray(artifact.repair_diffs) ? artifact.repair_diffs.length : 0;
  }

  const stageSets = stagesByChain(calls);
  const halfChains = okArtifacts.map((artifact) => {
    const stages = stageSets.get(artifact.chain_key) || new Set();
    const required = requiredStagesForCondition(artifact.condition);
    const missing = required.filter((stage) => !stages.has(stage));
    return missing.length ? { chain_key: artifact.chain_key, missing_stages: missing } : null;
  }).filter(Boolean);

  const latencyValues = calls.map((call) => Number(call.latency_ms)).filter(Number.isFinite);
  const summary = {
    arm_id: ARM_ID,
    chains_ok: okArtifacts.length,
    chains_failed: finalFailedKeys.length,
    chains_expected: expectedChains,
    calls_total: calls.length,
    count_429: calls.filter((call) => call.status === "rate_limited" || Number(call.http_code) === 429).length,
    count_empty: calls.filter((call) => call.status === "empty").length,
    count_retry_other: calls.filter((call) => call.retryable === true && call.status === "error" && Number(call.http_code) !== 429).length,
    salvage_count: salvageCount,
    salvage_by_stage: salvageTotals,
    repairs_by_stage: repairTotals,
    repair_decision_diff_count: repairDecisionDiffCount,
    latency_p50_ms: percentile(latencyValues, 50),
    latency_p95_ms: percentile(latencyValues, 95),
    wall_clock_ms: new Date(finishedAt).getTime() - new Date(startedAt).getTime(),
    started_at: startedAt,
    finished_at: finishedAt,
    concurrency,
    model: EXPECTED_MODEL,
    response_model: responseModel,
    provider: PROVIDER,
    enable_thinking: false,
    temperature: TEMPERATURE,
    persona_injection_mode: PERSONA_INJECTION_MODE,
    prompt_mode: PROMPT_MODE,
    layered_generation_seed: PERSONA_INJECTION_MODE === "layered" ? LAYERED_GENERATION_SEED : null,
    required_stages: REQUIRED_STAGES_BY_CONDITION,
    required_stage_counts: {
      Q: REQUIRED_STAGES_BY_CONDITION.Q.length,
      S: REQUIRED_STAGES_BY_CONDITION.S.length
    },
    half_chain_count: halfChains.length,
    half_chains: halfChains,
    final_failed_chain_keys: finalFailedKeys,
    notes: {
      source_runner: "scripts/analysis/full_game_all_personas.js::runPlaythrough reused",
      persona_injection: PERSONA_INJECTION_MODE === "layered"
        ? "frozen persona_pool_v2 surface rendered through PersonaStudent.buildLayeredSystemPrompt"
        : PROMPT_MODE === "interface"
          ? "surface fields woven into persona.desc; cognitive map disabled for prompt/validator; interface-visible fields only"
          : "surface fields woven into persona.desc",
      deterministic_salvage: "callJson strips fences, extracts the first JSON object block, then tolerates trailing commas before using LLM repair",
      q_s_condition: PROMPT_MODE === "interface"
        ? "Q keeps f912715 D_q as a UI self-question step before R1/D4/D5; both Q and S use interface-faithful R1/D3/D4/D5 frames"
        : "Q uses f912715 questionDefinition semantics with D_q before R1/D4/D5; S uses standard prompt frames",
      failed_retry_policy: "failed chains are rerun once from scratch after the first pass"
    }
  };
  writeJsonAtomic(SUMMARY_PATH, summary);
  return summary;
}

async function runTasks(tasks, options) {
  const { default: pLimit } = await import("p-limit");
  const limit = pLimit(options.concurrency);
  const results = new Array(tasks.length);
  await Promise.all(tasks.map((task, index) => limit(async () => {
    const artifact = await runOneTask({ ...options, task });
    results[index] = artifact;
    const status = artifact.row?.status || "UNKNOWN";
    console.error(`[${LOG_PREFIX}] ${index + 1}/${tasks.length} ${artifact.chain_key} ${status} calls=${JSON.stringify(artifact.row?.calls || {})} error=${artifact.row?.error || ""}`);
  })));
  return results;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  loadLocalEnv();
  const config = readConfig();
  configuredModel = config.model;
  configuredBaseUrl = config.baseUrl;
  configuredApiKeys = config.apiKeys;
  chatUrl = buildChatCompletionsUrl(configuredBaseUrl);

  const { default: pLimit } = await import("p-limit");
  llmLimit = pLimit(args.concurrency);

  fs.mkdirSync(CHAINS_DIR, { recursive: true });
  fs.mkdirSync(FAILED_DIR, { recursive: true });
  if (!fs.existsSync(CALLS_PATH)) fs.writeFileSync(CALLS_PATH, "", "utf8");

  const startedAt = fs.existsSync(SUMMARY_PATH)
    ? (loadJson(SUMMARY_PATH).started_at || new Date().toISOString())
    : new Date().toISOString();
  const pool = loadJson(POOL_PATH);
  const poolManifest = loadJson(POOL_MANIFEST_PATH);
  const regime = ensureRegime(poolManifest, startedAt);

  installModulePatches();
  const FullGame = require("./full_game_all_personas");
  const { extractTags } = require("../../server/llm/tagExtractor");
  const { scoreTagsToDimensions } = require("../../server/llm/dimensionScorer");
  const vpWordScorer = require("../../server/llm/vpWordScorer");
  const originalExtractVpFields = vpWordScorer.extractVpFields;
  vpWordScorer.extractVpFields = (...extractArgs) => {
    const promise = originalExtractVpFields(...extractArgs);
    if (promise && typeof promise.catch === "function") {
      promise.catch((error) => {
        console.error(`[${LOG_PREFIX}] async VP_field_extraction failed: ${error?.message || error}`);
      });
    }
    return promise;
  };
  const vpCoach = require("../../server/llm/vpCoach");
  const personaGenerator = require("../../server/llm/personaGenerator");
  const materials = FullGame.loadMaterials();
  assertRenderManifestLoaded(materials);
  const runtime = {
    chatCompletion: auditedChatCompletion,
    extractTags,
    scoreTagsToDimensions,
    vpWordScorer,
    vpCoach,
    personaGenerator
  };

  if (!Array.isArray(pool) || pool.length !== 42) {
    throw new Error(`persona pool must contain 42 records, got ${Array.isArray(pool) ? pool.length : "not-array"}`);
  }

  const allTasks = buildTasks(pool, materials).slice(0, args.limit || undefined);
  const completed = existingChainKeys();
  const firstPassTasks = allTasks.filter((task) => !completed.has(taskKey(task)));
  console.error(`[${LOG_PREFIX}] arm=${ARM_ID} persona_mode=${PERSONA_INJECTION_MODE} prompt_mode=${PROMPT_MODE} expected=${allTasks.length} completed=${completed.size} remaining=${firstPassTasks.length} concurrency=${args.concurrency}`);

  const firstPass = await runTasks(firstPassTasks, {
    FullGame,
    runtime,
    materials,
    regime,
    concurrency: args.concurrency,
    attempt: 1
  });

  await waitForOutstandingCalls();

  const failedFirstPass = firstPass
    .filter((artifact) => artifact?.row?.status !== "OK")
    .map((artifact) => allTasks.find((task) => taskKey(task) === artifact.chain_key))
    .filter(Boolean);

  let failedSecondPass = [];
  if (failedFirstPass.length) {
    console.error(`[${LOG_PREFIX}] retrying failed chains once: ${failedFirstPass.map(taskKey).join(", ")}`);
    const retryResults = await runTasks(failedFirstPass, {
      FullGame,
      runtime,
      materials,
      regime,
      concurrency: args.concurrency,
      attempt: 2
    });
    await waitForOutstandingCalls();
    failedSecondPass = retryResults
      .filter((artifact) => artifact?.row?.status !== "OK")
      .map((artifact) => artifact.chain_key);
  }

  await waitForOutstandingCalls();
  const finishedAt = new Date().toISOString();
  const summary = buildSummary({
    concurrency: args.concurrency,
    startedAt,
    finishedAt,
    expectedChains: allTasks.length,
    finalFailedKeys: failedSecondPass
  });

  console.log(JSON.stringify(summary, null, 2));
  if (summary.chains_ok !== allTasks.length || summary.chains_failed !== 0 || summary.half_chain_count !== 0) {
    process.exitCode = 1;
  }
}

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
