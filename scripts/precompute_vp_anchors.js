"use strict";

const fs = require("fs");
const path = require("path");

const embeddingService = require("../server/llm/embeddingService");

const PROFILES_PATH = path.join(__dirname, "..", "game_config_v0.1", "vp_anchor_profiles.json");
const OUTPUT_PATH = path.join(__dirname, "..", "game_config_v0.1", "vp_anchor_embeddings.json");

async function main() {
  const profiles = JSON.parse(fs.readFileSync(PROFILES_PATH, "utf8"));
  await embeddingService.init();

  const embeddings = {};

  for (const [marketKey, market] of Object.entries(profiles.market || {})) {
    embeddings[`market.${marketKey}.customer_group`] = await embeddingService.embed(market.customer_group);
    for (let i = 0; i < (market.pain_anchors || []).length; i += 1) {
      embeddings[`market.${marketKey}.pain_anchor_${i}`] = await embeddingService.embed(market.pain_anchors[i].text);
    }
    embeddings[`market.${marketKey}.alternatives`] = await embeddingService.embed(market.alternatives);
    embeddings[`market.${marketKey}.solution_expectations`] = await embeddingService.embed(market.solution_expectations);
  }

  for (const [strategyKey, strategy] of Object.entries(profiles.strategy || {})) {
    embeddings[`strategy.${strategyKey}.customer_traits`] = await embeddingService.embed(strategy.customer_traits);
    embeddings[`strategy.${strategyKey}.value_perception`] = await embeddingService.embed(strategy.value_perception);
    embeddings[`strategy.${strategyKey}.solution_expectations`] = await embeddingService.embed(strategy.solution_expectations);
  }

  for (const [archKey, arch] of Object.entries(profiles.architecture || {})) {
    embeddings[`architecture.${archKey}.customer_traits`] = await embeddingService.embed(arch.customer_traits);
    embeddings[`architecture.${archKey}.value_perception`] = await embeddingService.embed(arch.value_perception);
    embeddings[`architecture.${archKey}.solution_expectations`] = await embeddingService.embed(arch.solution_expectations);
  }

  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(embeddings, null, 2), "utf8");
  console.log(`Precomputed ${Object.keys(embeddings).length} anchor embeddings.`);
  console.log(`Saved: ${OUTPUT_PATH}`);
}

main().catch((err) => {
  console.error("precompute_vp_anchors failed:", err);
  process.exit(1);
});
