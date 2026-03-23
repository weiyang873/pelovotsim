// dimensionScorer.js - 维度评分 + Level 2 缓存
const crypto = require("crypto");
const path = require("path");
const fs = require("fs");
const embeddingService = require("./embeddingService");

const CACHE_PATH = path.join(__dirname, "..", "..", "data", "score_cache.json");

function readCache() {
  try {
    if (!fs.existsSync(CACHE_PATH)) return {};
    return JSON.parse(fs.readFileSync(CACHE_PATH, "utf8"));
  } catch (_) {
    return {};
  }
}

function writeCache(cache) {
  const dir = path.dirname(CACHE_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(CACHE_PATH, JSON.stringify(cache, null, 2), "utf8");
}

async function scoreTagsToDimensions(tags) {
  const anchorVersion = embeddingService.getAnchorVersion();
  const safeTags = Array.isArray(tags) ? tags : [];
  const sortedKey = [...safeTags]
    .sort((a, b) => String(a?.tag || "").localeCompare(String(b?.tag || "")))
    .map((t) => `${String(t?.tag || "")}:${String(t?.polarity || "")}`)
    .join("|");
  const cacheKey = crypto.createHash("md5").update(sortedKey + anchorVersion).digest("hex");

  const cache = readCache();
  if (cache[cacheKey]) {
    console.log("[DimensionScorer] Level 2 缓存命中");
    return cache[cacheKey];
  }

  const scores = await embeddingService.scoreTagsWithPolarity(safeTags);
  const result = {
    scores,
    tags,
    anchorVersion,
    computedAt: new Date().toISOString()
  };

  cache[cacheKey] = result;
  writeCache(cache);
  return result;
}

module.exports = { scoreTagsToDimensions };
