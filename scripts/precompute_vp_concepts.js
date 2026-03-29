"use strict";

const fs = require("fs");
const path = require("path");

const embeddingService = require("../server/llm/embeddingService");
const profiles = require("../game_config_v0.1/vp_anchor_profiles.json");
const concepts = require("../game_config_v0.1/vp_scoring_concepts.json").concepts;
const { extractKeywords, mapKeywordsToConcepts } = require("../server/llm/vpConceptScorer");

const OUTPUT_PATH = path.join(__dirname, "..", "game_config_v0.1", "vp_concept_cache.json");

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

async function computeAnchorHits(keywords, conceptVecs, conceptNames) {
  const results = await mapKeywordsToConcepts(keywords, conceptVecs, conceptNames);
  return results.map(([, hit]) => ({
    conceptIdx: hit.conceptIdx,
    concept: hit.concept,
    bestSim: hit.bestSim,
    keyword: hit.keyword
  }));
}

async function main() {
  await embeddingService.init();

  const conceptVecs = [];
  for (const concept of concepts) {
    conceptVecs.push(await embeddingService.embed(concept));
  }

  const fingerprints = {};
  const anchorHits = {};

  for (const [key, profile] of Object.entries(profiles.market)) {
    const customerVec = await embeddingService.embed(profile.customer_group);
    fingerprints[`market.${key}.customer_group`] = conceptVecs.map((conceptVec) => cosine(customerVec, conceptVec));
    anchorHits[`market.${key}.customer_group`] = await computeAnchorHits(
      extractKeywords(profile.customer_group),
      conceptVecs,
      concepts
    );

    for (let index = 0; index < profile.pain_anchors.length; index += 1) {
      const anchorVec = await embeddingService.embed(profile.pain_anchors[index].text);
      fingerprints[`market.${key}.pain_anchor_${index}`] = conceptVecs.map((conceptVec) => cosine(anchorVec, conceptVec));
      fingerprints[`market.${key}.pain_anchor_${index}_weight`] = profile.pain_anchors[index].weight;
      anchorHits[`market.${key}.pain_anchor_${index}`] = await computeAnchorHits(
        extractKeywords(profile.pain_anchors[index].text),
        conceptVecs,
        concepts
      );
    }

    const altVec = await embeddingService.embed(profile.alternatives);
    fingerprints[`market.${key}.alternatives`] = conceptVecs.map((conceptVec) => cosine(altVec, conceptVec));
    anchorHits[`market.${key}.alternatives`] = await computeAnchorHits(
      extractKeywords(profile.alternatives),
      conceptVecs,
      concepts
    );

    const solutionVec = await embeddingService.embed(profile.solution_expectations);
    fingerprints[`market.${key}.solution_expectations`] = conceptVecs.map((conceptVec) => cosine(solutionVec, conceptVec));
    anchorHits[`market.${key}.solution_expectations`] = await computeAnchorHits(
      extractKeywords(profile.solution_expectations),
      conceptVecs,
      concepts
    );
  }

  for (const [key, profile] of Object.entries(profiles.strategy)) {
    for (const field of ["customer_traits", "value_perception", "solution_expectations"]) {
      const vec = await embeddingService.embed(profile[field]);
      fingerprints[`strategy.${key}.${field}`] = conceptVecs.map((conceptVec) => cosine(vec, conceptVec));
      anchorHits[`strategy.${key}.${field}`] = await computeAnchorHits(
        extractKeywords(profile[field]),
        conceptVecs,
        concepts
      );
    }
  }

  for (const [key, profile] of Object.entries(profiles.architecture)) {
    for (const field of ["customer_traits", "value_perception", "solution_expectations"]) {
      const vec = await embeddingService.embed(profile[field]);
      fingerprints[`architecture.${key}.${field}`] = conceptVecs.map((conceptVec) => cosine(vec, conceptVec));
      anchorHits[`architecture.${key}.${field}`] = await computeAnchorHits(
        extractKeywords(profile[field]),
        conceptVecs,
        concepts
      );
    }
  }

  fs.writeFileSync(OUTPUT_PATH, JSON.stringify({
    concepts,
    conceptVecs,
    fingerprints,
    anchorHits,
    profiles
  }, null, 2), "utf8");

  console.log(`Precomputed ${concepts.length} concepts, ${Object.keys(fingerprints).length} fingerprints, ${Object.keys(anchorHits).length} anchorHits.`);
  console.log(`Saved: ${OUTPUT_PATH}`);
}

main().catch((err) => {
  console.error("precompute_vp_concepts failed:", err);
  process.exit(1);
});
