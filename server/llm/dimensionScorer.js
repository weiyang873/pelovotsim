// dimensionScorer.js - 维度评分 + Level 2 缓存
const crypto = require("crypto");
const embeddingService = require("./embeddingService");
const { kvGet, kvSet } = require("../db/kvCache");

const CACHE_NAME = "dimension_scorer_v1";

async function scoreTagsToDimensions(tags) {
  const anchorVersion = embeddingService.getAnchorVersion();
  const safeTags = Array.isArray(tags) ? tags : [];
  const sortedKey = [...safeTags]
    .sort((a, b) => String(a?.tag || "").localeCompare(String(b?.tag || "")))
    .map((t) => `${String(t?.tag || "")}:${String(t?.polarity || "")}`)
    .join("|");
  const cacheKey = crypto.createHash("md5").update(sortedKey + anchorVersion).digest("hex");

  const cached = await kvGet(CACHE_NAME, cacheKey);
  if (cached) {
    console.log("[DimensionScorer] Level 2 缓存命中");
    return cached;
  }

  const scores = await embeddingService.scoreTagsWithPolarity(safeTags);
  const result = {
    scores,
    tags,
    anchorVersion,
    computedAt: new Date().toISOString()
  };

  await kvSet(CACHE_NAME, cacheKey, result);
  return result;
}

module.exports = { scoreTagsToDimensions };
