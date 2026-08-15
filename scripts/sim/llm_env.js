"use strict";

function getLlmProvider() {
  return String(process.env.LLM_PROVIDER || "deepseek").trim().toLowerCase();
}

function hasAnyEnv(patterns) {
  return Object.entries(process.env).some(([key, value]) =>
    patterns.some((pattern) => pattern.test(key)) && String(value || "").trim()
  );
}

function hasConfiguredLlmKey() {
  const provider = getLlmProvider();
  if (provider === "qwen") {
    return hasAnyEnv([/^QWEN_API_KEY(?:_\d+)?$/, /^DASHSCOPE_API_KEY(?:_\d+)?$/]);
  }
  if (provider === "deepseek") {
    return hasAnyEnv([/^DEEPSEEK_API_KEY(?:_\d+)?$/]);
  }
  return hasAnyEnv([/^LLM_API_KEY(?:_\d+)?$/, /^OPENAI_API_KEY(?:_\d+)?$/]);
}

function getMissingKeyMessage() {
  const provider = getLlmProvider();
  if (provider === "qwen") {
    return "LLM_PROVIDER=qwen but QWEN_API_KEY or DASHSCOPE_API_KEY is missing";
  }
  if (provider === "deepseek") {
    return "LLM_PROVIDER=deepseek but DEEPSEEK_API_KEY is missing";
  }
  return `LLM_PROVIDER=${provider} but LLM_API_KEY or OPENAI_API_KEY is missing`;
}

function configureBatchLlmDefaults() {
  const provider = getLlmProvider();
  if (process.env.LLM_DISABLE_THINKING === undefined) {
    process.env.LLM_DISABLE_THINKING = "1";
  }
  if (provider === "deepseek" && process.env.DEEPSEEK_DISABLE_THINKING === undefined) {
    process.env.DEEPSEEK_DISABLE_THINKING = "1";
  }
  if (
    provider === "qwen" &&
    process.env.QWEN_DISABLE_THINKING === undefined &&
    process.env.QWEN_ENABLE_THINKING === undefined
  ) {
    process.env.QWEN_DISABLE_THINKING = "1";
  }

  if (process.env.LLM_MODEL_OVERRIDE !== undefined) return;
  if (process.env.LLM_MODEL) {
    process.env.LLM_MODEL_OVERRIDE = process.env.LLM_MODEL;
  } else if (provider === "deepseek") {
    process.env.LLM_MODEL_OVERRIDE = process.env.DEEPSEEK_MODEL || "deepseek-v4-flash";
  } else if (provider === "qwen") {
    process.env.LLM_MODEL_OVERRIDE = process.env.QWEN_MODEL || process.env.DASHSCOPE_MODEL || "deepseek-v4-flash-0731";
  } else if (process.env.OPENAI_MODEL) {
    process.env.LLM_MODEL_OVERRIDE = process.env.OPENAI_MODEL;
  }
}

module.exports = {
  configureBatchLlmDefaults,
  getLlmProvider,
  getMissingKeyMessage,
  hasConfiguredLlmKey
};
