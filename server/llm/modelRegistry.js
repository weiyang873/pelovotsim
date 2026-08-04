"use strict";

const fs = require("node:fs");
const path = require("node:path");

const CONFIG_PATH = path.resolve(__dirname, "..", "..", "game_config_v0.1", "llm_models.json");
const EMBEDDING_ROLE = "embedding";

const loggedResponseModels = new Set();

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

  const provider = requireNonEmptyString(rawConfig.provider, "provider");
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

  const rawOverride = process.env.LLM_MODEL_OVERRIDE;
  const modelOverride = rawOverride === undefined ? "" : String(rawOverride).trim();

  return {
    provider,
    baseUrl,
    defaultModel,
    roles,
    modelOverride
  };
}

const registry = validateConfig(readConfigFile());

function getModel(role) {
  const normalizedRole = requireNonEmptyString(role, "role");
  if (!hasOwn(registry.roles, normalizedRole)) {
    throw new Error(`[modelRegistry] Unknown LLM role "${normalizedRole}" in getModel(role)`);
  }
  if (normalizedRole !== EMBEDDING_ROLE && registry.modelOverride) {
    return registry.modelOverride;
  }
  const roleModel = registry.roles[normalizedRole];
  if (roleModel === null) {
    return registry.defaultModel;
  }
  return roleModel;
}

function getBaseUrl() {
  return registry.baseUrl;
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
  getModel,
  getBaseUrl,
  logResolvedModel,
  __CONFIG_PATH: CONFIG_PATH
};
