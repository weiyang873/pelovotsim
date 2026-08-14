"use strict";

const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..", "..");
const ROUND2_ENGINE_PARAMS_PATH = path.join(ROOT, "game_config_v0.1", "round2_engine_params.json");

const DEFAULT_ROUND2_PRICING_CONTEXT = {
  price_min: 2000,
  price_max: 6000,
  price_step: 1,
  default_price: 3500
};

function clampNumber(value, min, max) {
  const num = Number(value);
  if (!Number.isFinite(num)) return min;
  return Math.max(min, Math.min(max, num));
}

function loadRound2PricingContextConfig(configPath = ROUND2_ENGINE_PARAMS_PATH) {
  let raw = {};
  try {
    raw = JSON.parse(fs.readFileSync(configPath, "utf8"));
  } catch (_) {
    raw = {};
  }
  const src = raw.pricing_ui && typeof raw.pricing_ui === "object"
    ? raw.pricing_ui
    : {};
  const min = Number(src.price_min ?? DEFAULT_ROUND2_PRICING_CONTEXT.price_min);
  const max = Number(src.price_max ?? DEFAULT_ROUND2_PRICING_CONTEXT.price_max);
  const step = Number(src.price_step ?? DEFAULT_ROUND2_PRICING_CONTEXT.price_step);
  const defaultPrice = Number(src.default_price ?? DEFAULT_ROUND2_PRICING_CONTEXT.default_price);
  if (!Number.isFinite(min) || !Number.isFinite(max) || !Number.isFinite(step) || !Number.isFinite(defaultPrice) || min <= 0 || max <= min || step <= 0) {
    throw new Error("round2 pricing_ui config invalid");
  }
  return {
    price_min: min,
    price_max: max,
    price_step: step,
    default_price: clampNumber(defaultPrice, min, max)
  };
}

function validateRound2Price(price, pricing = loadRound2PricingContextConfig()) {
  if (!pricing || !Number.isFinite(Number(pricing.price_min)) || !Number.isFinite(Number(pricing.price_max)) || !Number.isFinite(Number(pricing.price_step)) || Number(pricing.price_step) <= 0) {
    return {
      ok: false,
      pricing,
      error: "price_context_invalid",
      message: "round2 pricing_ui 配置无效"
    };
  }
  const num = Number(price);
  if (!Number.isFinite(num) || num <= 0) {
    return {
      ok: false,
      pricing,
      error: "invalid_price",
      message: "请输入有效的产品售价"
    };
  }
  if (num < pricing.price_min || num > pricing.price_max) {
    return {
      ok: false,
      pricing,
      error: "price_out_of_range",
      message: `产品售价需在 ¥${pricing.price_min.toLocaleString()} 到 ¥${pricing.price_max.toLocaleString()} 之间`
    };
  }
  return { ok: true, pricing };
}

module.exports = {
  DEFAULT_ROUND2_PRICING_CONTEXT,
  ROUND2_ENGINE_PARAMS_PATH,
  loadRound2PricingContextConfig,
  validateRound2Price
};
