"use strict";

const fs = require("fs");
const path = require("path");

const embeddingService = require("./embeddingService");
const { extractVpFields, scoreBoundary } = require("./vpEmbeddingScorer");

const PROFILES_PATH = path.join(__dirname, "..", "..", "game_config_v0.1", "vp_anchor_profiles.json");
const CACHE_PATH = path.join(__dirname, "..", "..", "game_config_v0.1", "vp_concept_cache.json");
const DEFAULT_MULTIPLIER = 2.5;

const GRID_TO_PROFILE = {
  "ToB_Differentiation_Elder": { market: "ToB_Elder", strategy: "Differentiation" },
  "ToB_Cost_Elder": { market: "ToB_Elder", strategy: "Cost" },
  "ToB_Differentiation_Adult": { market: "ToB_Adult", strategy: "Differentiation" },
  "ToB_Cost_Adult": { market: "ToB_Adult", strategy: "Cost" },
  "ToB_Differentiation_Child": { market: "ToB_Child", strategy: "Differentiation" },
  "ToB_Cost_Child": { market: "ToB_Child", strategy: "Cost" },
  "ToC_Differentiation_Elder": { market: "ToC_Elder", strategy: "Differentiation" },
  "ToC_Cost_Elder": { market: "ToC_Elder", strategy: "Cost" },
  "ToC_Differentiation_Adult": { market: "ToC_Adult", strategy: "Differentiation" },
  "ToC_Cost_Adult": { market: "ToC_Adult", strategy: "Cost" },
  "ToC_Differentiation_Child": { market: "ToC_Child", strategy: "Differentiation" },
  "ToC_Cost_Child": { market: "ToC_Child", strategy: "Cost" }
};

let cachedProfiles = null;
let cachedConceptCache = null;

function cosine(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || !a.length || a.length !== b.length) {
    return 0;
  }

  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

function normalizeArchitectureKey(architecture) {
  const text = String(architecture || "").trim();
  if (text === "Experience" || text === "体验" || text === "体验型") return "Experience";
  if (text === "Hybrid" || text === "混合" || text === "混合型") return "Hybrid";
  if (text === "Function" || text === "功能" || text === "功能型") return "Function";
  return text || "Hybrid";
}

function normalizeGridId(gridId) {
  const text = String(gridId || "").trim();
  if (GRID_TO_PROFILE[text]) return text;

  if (text.includes("·")) {
    const channel = /ToB/i.test(text) ? "ToB" : "ToC";
    const strategy = /差异/.test(text) ? "Differentiation" : "Cost";
    const age = /老人/.test(text) ? "Elder" : (/儿童/.test(text) ? "Child" : "Adult");
    return `${channel}_${strategy}_${age}`;
  }

  const normalized = text
    .replace(/_Diff_/i, "_Differentiation_")
    .replace(/_Diff$/i, "_Differentiation")
    .replace(/^To([BC])_Diff_/i, "To$1_Differentiation_");
  if (GRID_TO_PROFILE[normalized]) return normalized;

  return text;
}

function loadProfiles() {
  if (!cachedProfiles) {
    cachedProfiles = JSON.parse(fs.readFileSync(PROFILES_PATH, "utf8"));
  }
  return cachedProfiles;
}

function loadCache() {
  if (!cachedConceptCache) {
    cachedConceptCache = JSON.parse(fs.readFileSync(CACHE_PATH, "utf8"));
  }
  return cachedConceptCache;
}

function rawToScore(raw, multiplier = DEFAULT_MULTIPLIER) {
  const score = 1.0 + Number(raw) * multiplier;
  return Math.max(1.0, Math.min(5.0, Math.round(score * 10) / 10));
}

async function computeFingerprint(text, conceptVecs) {
  const clean = String(text || "").trim();
  if (!clean || clean === "未明确") {
    return conceptVecs.map(() => 0);
  }
  await embeddingService.init();
  const textVec = await embeddingService.embed(clean);
  return conceptVecs.map((conceptVec) => cosine(textVec, conceptVec));
}

function extractKeywords(text) {
  if (!text || text === "未明确") return [];

  const segments = String(text)
    .split(/[，。、；：！？""''（）\-——\s]+/)
    .map((segment) => segment.trim())
    .filter((segment) => segment.length >= 2);

  const keywords = [];
  for (const segment of segments) {
    const parts = segment
      .split(/(?:的|和|与|以及|通过|从而|让|使得|为了|在于|还有|并且|同时|比如|例如)/)
      .map((part) => part.trim())
      .filter((part) => part.length >= 2);
    keywords.push(...(parts.length > 0 ? parts : [segment]));
  }

  return [...new Set(keywords)];
}

async function mapKeywordsToConcepts(keywords, conceptVecs, conceptNames) {
  const results = [];
  await embeddingService.init();

  for (const keyword of keywords) {
    const keywordVec = await embeddingService.embed(keyword);
    let bestIdx = -1;
    let bestSim = -1;
    for (let index = 0; index < conceptVecs.length; index += 1) {
      const sim = cosine(keywordVec, conceptVecs[index]);
      if (sim > bestSim) {
        bestSim = sim;
        bestIdx = index;
      }
    }

    if (bestIdx >= 0) {
      results.push([keyword, {
        conceptIdx: bestIdx,
        concept: conceptNames[bestIdx],
        bestSim,
        keyword
      }]);
    }
  }

  return results;
}

function keywordConceptScore(vpHits, anchorHits) {
  const anchorConceptSet = new Set((anchorHits || []).map((hit) => hit.conceptIdx));
  const anchorSimSum = (anchorHits || []).reduce((sum, hit) => sum + hit.bestSim, 0);
  if (anchorSimSum === 0) {
    return {
      score: 0,
      vpHitCount: Array.isArray(vpHits) ? vpHits.length : 0,
      vpMatchCount: 0,
      anchorHitCount: (anchorHits || []).length,
      anchorSimSum: 0,
      vpMatchSimSum: 0,
      details: []
    };
  }

  let vpMatchSimSum = 0;
  let vpMatchCount = 0;
  const matchDetails = [];

  for (const [keyword, hit] of vpHits) {
    const matched = anchorConceptSet.has(hit.conceptIdx);
    if (matched) {
      vpMatchSimSum += hit.bestSim;
      vpMatchCount += 1;
    }
    matchDetails.push({
      keyword: hit.keyword || keyword,
      concept: hit.concept,
      sim: hit.bestSim,
      matched
    });
  }

  return {
    score: vpMatchSimSum / anchorSimSum,
    vpHitCount: Array.isArray(vpHits) ? vpHits.length : 0,
    vpMatchCount,
    anchorHitCount: (anchorHits || []).length,
    anchorSimSum,
    vpMatchSimSum,
    details: matchDetails
  };
}

function buildFeedback(scores, details) {
  return [
    `C=${scores.C}，who=${details.who.score.toFixed(3)}，pain_se=${details.pain_se.score.toFixed(3)}。`,
    `G=${scores.G}，top2=${details.pain_top2.map((item) => `${item.score.toFixed(3)}*${item.weight}`).join(", ")}，strategy=${details.pain_strategy.score.toFixed(3)}。`,
    `E=${scores.E}，how=${details.how_market.score.toFixed(3)}/${details.how_strategy.score.toFixed(3)}/${details.how_arch.score.toFixed(3)}，alt=${details.alt.score.toFixed(3)}，boundary=${details.boundary_score.toFixed(3)}。`
  ].join("\n");
}

async function prepareVpForConceptScoring(vpText) {
  if (!vpText || String(vpText).trim().length < 3) {
    return null;
  }

  const cache = loadCache();
  const fields = await extractVpFields(vpText);

  const whoKeywords = extractKeywords(fields.who_raw);
  const painKeywords = extractKeywords(fields.pain_raw);
  const howKeywords = extractKeywords(fields.how_raw);
  const altKeywords = fields.alternative_raw !== "未明确" ? extractKeywords(fields.alternative_raw) : [];

  const whoHits = await mapKeywordsToConcepts(whoKeywords, cache.conceptVecs, cache.concepts);
  const painHits = await mapKeywordsToConcepts(painKeywords, cache.conceptVecs, cache.concepts);
  const howHits = await mapKeywordsToConcepts(howKeywords, cache.conceptVecs, cache.concepts);
  const altHits = altKeywords.length > 0
    ? await mapKeywordsToConcepts(altKeywords, cache.conceptVecs, cache.concepts)
    : [];

  return {
    vpText,
    fields,
    who_keywords: whoKeywords,
    pain_keywords: painKeywords,
    how_keywords: howKeywords,
    alt_keywords: altKeywords,
    who_hits: whoHits,
    pain_hits: painHits,
    how_hits: howHits,
    alt_hits: altHits
  };
}

function scorePreparedVpByConcept(prepared, gridId, architecture, options = {}) {
  if (!prepared) {
    return {
      scores: null,
      fields: null,
      details: null,
      feedback: "VP 文本过短，无法评分。"
    };
  }

  const multiplier = Number.isFinite(options.multiplier) ? options.multiplier : DEFAULT_MULTIPLIER;
  const normalizedGridId = normalizeGridId(gridId);
  const gridProfile = GRID_TO_PROFILE[normalizedGridId];
  if (!gridProfile) {
    throw new Error(`Unknown grid id: ${gridId}`);
  }

  const cache = loadCache();
  const marketKey = gridProfile.market;
  const strategyKey = gridProfile.strategy;
  const archKey = normalizeArchitectureKey(architecture);
  const fields = prepared.fields;

  const whoScore = keywordConceptScore(prepared.who_hits, cache.anchorHits[`market.${marketKey}.customer_group`] || []);
  const painSeScore = keywordConceptScore(prepared.pain_hits, cache.anchorHits[`market.${marketKey}.solution_expectations`] || []);
  const cRaw = 0.55 * whoScore.score + 0.45 * painSeScore.score;

  const painAnchors = cache.profiles.market[marketKey].pain_anchors;
  const painMatches = painAnchors.map((anchor, index) => {
    const matchResult = keywordConceptScore(prepared.pain_hits, cache.anchorHits[`market.${marketKey}.pain_anchor_${index}`] || []);
    return {
      text: anchor.text,
      score: matchResult.score,
      overlap: matchResult.overlap,
      avgSim: matchResult.avgSim,
      coverage: matchResult.coverage,
      details: matchResult.details,
      weight: anchor.weight
    };
  });
  painMatches.sort((a, b) => (b.score * b.weight) - (a.score * a.weight));
  const top2 = painMatches.slice(0, 2);
  const gPain = (
    top2[0].score * top2[0].weight +
    ((top2[1] && top2[1].score * top2[1].weight) || 0)
  ) / (
    top2[0].weight +
    ((top2[1] && top2[1].weight) || 0)
  );
  const painStrategyScore = keywordConceptScore(prepared.pain_hits, cache.anchorHits[`strategy.${strategyKey}.customer_traits`] || []);
  const gRaw = 0.70 * gPain + 0.30 * painStrategyScore.score;

  const howMarketScore = keywordConceptScore(prepared.how_hits, cache.anchorHits[`market.${marketKey}.solution_expectations`] || []);
  const howStrategyScore = keywordConceptScore(prepared.how_hits, cache.anchorHits[`strategy.${strategyKey}.solution_expectations`] || []);
  const howArchScore = keywordConceptScore(prepared.how_hits, cache.anchorHits[`architecture.${archKey}.solution_expectations`] || []);
  const altMarketScore = prepared.alt_hits.length > 0
    ? keywordConceptScore(prepared.alt_hits, cache.anchorHits[`market.${marketKey}.alternatives`] || [])
    : { score: 0, vpHitCount: 0, vpMatchCount: 0, anchorHitCount: 0, anchorSimSum: 0, vpMatchSimSum: 0, details: [] };
  const boundaryScore = scoreBoundary(fields.boundary_raw, marketKey);
  const eRaw = 0.30 * howMarketScore.score + 0.25 * howStrategyScore.score + 0.25 * howArchScore.score +
    0.12 * altMarketScore.score + 0.08 * boundaryScore;

  const scores = {
    C: rawToScore(cRaw, multiplier),
    G: rawToScore(gRaw, multiplier),
    E: rawToScore(eRaw, multiplier)
  };

  const details = {
    marketKey,
    strategyKey,
    archKey,
    who: {
      keywords: prepared.who_keywords,
      hits: prepared.who_hits.length,
      ...whoScore
    },
    pain_se: {
      keywords: prepared.pain_keywords,
      hits: prepared.pain_hits.length,
      ...painSeScore
    },
    pain_top2: top2.map((item) => ({
      text: item.text.slice(0, 30),
      score: item.score,
      overlap: item.overlap,
      avgSim: item.avgSim,
      coverage: item.coverage,
      weight: item.weight,
      details: item.details
    })),
    pain_strategy: painStrategyScore,
    how_market: {
      keywords: prepared.how_keywords,
      hits: prepared.how_hits.length,
      ...howMarketScore
    },
    how_strategy: howStrategyScore,
    how_arch: howArchScore,
    alt: {
      keywords: prepared.alt_keywords,
      hits: prepared.alt_hits.length,
      ...altMarketScore
    },
    boundary_score: boundaryScore,
    C_raw: cRaw,
    G_raw: gRaw,
    E_raw: eRaw,
    MULTIPLIER: multiplier
  };

  return {
    scores,
    fields,
    details,
    feedback: buildFeedback(scores, details)
  };
}

async function scoreVpByConcept(vpText, gridId, architecture, options = {}) {
  const prepared = await prepareVpForConceptScoring(vpText);
  return scorePreparedVpByConcept(prepared, gridId, architecture, options);
}

module.exports = {
  scoreVpByConcept,
  scorePreparedVpByConcept,
  prepareVpForConceptScoring,
  extractVpFields,
  extractKeywords,
  mapKeywordsToConcepts,
  keywordConceptScore,
  computeFingerprint,
  rawToScore,
  scoreBoundary,
  loadCache,
  loadProfiles,
  normalizeGridId,
  normalizeArchitectureKey,
  GRID_TO_PROFILE
};
