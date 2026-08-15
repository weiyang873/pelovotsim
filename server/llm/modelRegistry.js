"use strict";

const fs = require("node:fs");
const path = require("node:path");

const CONFIG_PATH = path.resolve(__dirname, "..", "..", "game_config_v0.1", "llm_models.json");
const EMBEDDING_ROLE = "embedding";

const loggedResponseModels = new Set();
const PROVIDER_DEFAULTS = {
  deepseek: {
    baseUrl: "https://api.deepseek.com",
    defaultModel: "deepseek-v4-flash"
  },
  qwen: {
    baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    defaultModel: "deepseek-v4-flash-0731"
  },
  openai_compatible: {
    baseUrl: "",
    defaultModel: ""
  }
};

function hasOwn(obj, key) {
  return Object.prototype.hasOwnProperty.call(obj, key);
}

function readConfigFile() {
  if (!fs.existsSync(CONFIG_PATH)) {
    throw new Error(`[modelRegistry] Missing LLM model config: ${CONFIG_PATH}`);
  }
  return JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
}

function requireNonEmptyString(value, fieldName) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`[modelRegistry] ${fieldName} must be a non-empty string in ${CONFIG_PATH}`);
  }
  return value.trim();
}

function validateConfig(rawConfig) {
  if (!rawConfig || typeof rawConfig !== "object" || Array.isArray(rawConfig)) {
    throw new Error(`[modelRegistry] Config must be a JSON object: ${CONFIG_PATH}`);
  }

  const provider = requireNonEmptyString(rawConfig.provider, "provider").toLowerCase();
  const baseUrl = requireNonEmptyString(rawConfig.base_url, "base_url");
  const defaultModel = requireNonEmptyString(rawConfig.default_model, "default_model");
  if (!rawConfig.roles || typeof rawConfig.roles !== "object" || Array.isArray(rawConfig.roles)) {
    throw new Error(`[modelRegistry] roles must be an object in ${CONFIG_PATH}`);
  }
  if (!hasOwn(rawConfig.roles, EMBEDDING_ROLE)) {
    throw new Error(`[modelRegistry] roles.${EMBEDDING_ROLE} must be registered in ${CONFIG_PATH}`);
  }

  try {
    new URL(baseUrl);
  } catch (error) {
    throw new Error(`[modelRegistry] base_url is not a valid URL in ${CONFIG_PATH}: ${error.message}`);
  }

  const roles = {};
  for (const [role, roleModel] of Object.entries(rawConfig.roles)) {
    requireNonEmptyString(role, "role name");
    if (roleModel !== null) {
      roles[role] = requireNonEmptyString(roleModel, `roles.${role}`);
    } else {
      roles[role] = null;
    }
  }
  if (roles[EMBEDDING_ROLE] === null) {
    throw new Error(`[modelRegistry] roles.${EMBEDDING_ROLE} must be set explicitly in ${CONFIG_PATH}`);
  }

  return {
    provider,
    baseUrl,
    defaultModel,
    roles
  };
}

const registry = validateConfig(readConfigFile());

function getProvider() {
  return String(process.env.LLM_PROVIDER || registry.provider || "deepseek").trim().toLowerCase();
}

function getProviderSpecificEnv(provider, suffix) {
  const normalized = String(provider || "").trim().toLowerCase();
  const key = String(suffix || "").trim();
  if (!key) return "";
  if (normalized === "qwen") {
    return String(process.env[`QWEN_${key}`] || process.env[`DASHSCOPE_${key}`] || "").trim();
  }
  if (normalized === "deepseek") {
    return String(process.env[`DEEPSEEK_${key}`] || "").trim();
  }
  return "";
}

function getConfiguredDefaultModel(provider) {
  const normalizedProvider = String(provider || getProvider()).trim().toLowerCase();
  const genericModel = String(process.env.LLM_DEFAULT_MODEL || process.env.LLM_MODEL || "").trim();
  if (genericModel) return genericModel;

  const providerModel = getProviderSpecificEnv(normalizedProvider, "MODEL");
  if (providerModel) return providerModel;

  if (normalizedProvider === registry.provider) return registry.defaultModel;
  const providerDefault = PROVIDER_DEFAULTS[normalizedProvider]?.defaultModel || "";
  return providerDefault || registry.defaultModel;
}

function getModel(role) {
  const normalizedRole = requireNonEmptyString(role, "role");
  if (!hasOwn(registry.roles, normalizedRole)) {
    throw new Error(`[modelRegistry] Unknown LLM role "${normalizedRole}" in getModel(role)`);
  }
  const rawOverride = process.env.LLM_MODEL_OVERRIDE;
  const modelOverride = rawOverride === undefined ? "" : String(rawOverride).trim();
  if (normalizedRole !== EMBEDDING_ROLE && modelOverride) {
    return modelOverride;
  }
  const roleModel = registry.roles[normalizedRole];
  if (roleModel === null) {
    return getConfiguredDefaultModel();
  }
  return roleModel;
}

function getBaseUrl() {
  const provider = getProvider();
  const genericBaseUrl = String(process.env.LLM_BASE_URL || "").trim();
  if (genericBaseUrl) return genericBaseUrl;

  const providerBaseUrl = getProviderSpecificEnv(provider, "BASE_URL");
  if (providerBaseUrl) return providerBaseUrl;

  if (provider === registry.provider) return registry.baseUrl;
  const providerDefault = PROVIDER_DEFAULTS[provider]?.baseUrl || "";
  return providerDefault || registry.baseUrl;
}

function logResolvedRoles() {
  for (const role of Object.keys(registry.roles)) {
    console.log(`[modelRegistry] ${role} -> ${getModel(role)}`);
  }
}

function logResolvedModel(role, responseModel) {
  const normalizedRole = requireNonEmptyString(role, "role");
  if (!hasOwn(registry.roles, normalizedRole)) {
    throw new Error(`[modelRegistry] Unknown LLM role "${normalizedRole}" in logResolvedModel(role, responseModel)`);
  }
  const resolved = String(responseModel ?? "").trim();
  if (!resolved || loggedResponseModels.has(normalizedRole)) return;
  loggedResponseModels.add(normalizedRole);
  console.log(`[modelRegistry] ${normalizedRole} response model -> ${resolved}`);
}

logResolvedRoles();

module.exports = {
  getProvider,
  getModel,
  getBaseUrl,
  logResolvedModel,
  __CONFIG_PATH: CONFIG_PATH
};
