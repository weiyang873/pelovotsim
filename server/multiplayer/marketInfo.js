const fs = require("node:fs");
const path = require("node:path");

const CONFIG_PATH = path.join(__dirname, "..", "..", "game_config_v0.1", "round2_market_info.json");

let cachedConfig = null;

function getHHILabel(hhi) {
  const value = Number(hhi);
  if (!Number.isFinite(value)) return "";
  if (value >= 0.25) return "偏高";
  if (value >= 0.18) return "适中偏高";
  if (value >= 0.13) return "适中";
  if (value >= 0.10) return "适中偏低";
  if (value >= 0.08) return "分散";
  return "高度分散";
}

function loadMarketInfoConfig() {
  if (cachedConfig) return cachedConfig;
  try {
    cachedConfig = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
  } catch (_) {
    cachedConfig = { market_info: {} };
  }
  return cachedConfig;
}

function normalizeMarketInfoKey(gridId) {
  const raw = String(gridId || "").trim();
  if (!raw) return "";

  const parts = raw.split("_").filter(Boolean);
  if (parts.length < 3) return "";

  const customerRaw = String(parts[0] || "").toUpperCase();
  const strategyRaw = String(parts[1] || "").toUpperCase();
  const upperParts = parts.map((part) => String(part || "").toUpperCase());

  const customer = customerRaw === "TOB" || customerRaw === "B2B"
    ? "B2B"
    : customerRaw === "TOC" || customerRaw === "B2C"
      ? "B2C"
      : "";
  const strategy = strategyRaw.includes("COST")
    ? "COST"
    : strategyRaw.includes("DIFF") || strategyRaw.includes("DIFFERENTIATION")
      ? "DIFF"
      : "";

  let age = "";
  if (upperParts.some((part) => part.includes("ELDER"))) age = "ELDER";
  else if (upperParts.some((part) => part.includes("CHILD"))) age = "CHILD";
  else if (upperParts.some((part) => part.includes("ADULT"))) age = "ADULT";

  if (!customer || !strategy || !age) return "";
  return `${customer}_${strategy}_${age}`;
}

function getRound2MarketInfo(gridId) {
  const config = loadMarketInfoConfig();
  const table = config.market_info || {};
  const raw = String(gridId || "").trim();
  const key = table[raw] ? raw : normalizeMarketInfoKey(raw);
  const info = table[key];

  if (!info) {
    return {
      market_size_yi: null,
      hhi: null,
      hhi_label: ""
    };
  }

  const marketSize = Number(info.market_size_yi);
  const hhi = Number(info.hhi);
  return {
    market_size_yi: Number.isFinite(marketSize) ? marketSize : null,
    hhi: Number.isFinite(hhi) ? hhi : null,
    hhi_label: String(info.hhi_label || getHHILabel(hhi))
  };
}

module.exports = {
  getHHILabel,
  loadMarketInfoConfig,
  normalizeMarketInfoKey,
  getRound2MarketInfo
};
