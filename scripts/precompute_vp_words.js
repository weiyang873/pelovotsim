"use strict";

const fs = require("fs");
const path = require("path");

const embeddingService = require("../server/llm/embeddingService");
const { tokenize } = require("../server/llm/vpWordScorer");

const profiles = require("../game_config_v0.1/vp_anchor_profiles.json");

async function embedWords(text) {
  const words = tokenize(text);
  const vecs = [];
  for (const word of words) {
    vecs.push(await embeddingService.embed(word));
  }
  return { words, vecs };
}

async function main() {
  await embeddingService.init();
  const wordData = {};
  const sentenceVecs = {};

  for (const [key, profile] of Object.entries(profiles.market)) {
    wordData[`market.${key}.customer_group`] = await embedWords(profile.customer_group);
    sentenceVecs[`market.${key}.customer_group`] = await embeddingService.embed(profile.customer_group);

    for (let i = 0; i < profile.pain_anchors.length; i += 1) {
      wordData[`market.${key}.pain_anchor_${i}`] = await embedWords(profile.pain_anchors[i].text);
      sentenceVecs[`market.${key}.pain_anchor_${i}`] = await embeddingService.embed(profile.pain_anchors[i].text);
    }

    wordData[`market.${key}.alternatives`] = await embedWords(profile.alternatives);
    sentenceVecs[`market.${key}.alternatives`] = await embeddingService.embed(profile.alternatives);
    wordData[`market.${key}.solution_expectations`] = await embedWords(profile.solution_expectations);
    sentenceVecs[`market.${key}.solution_expectations`] = await embeddingService.embed(profile.solution_expectations);

    const allText = [
      profile.customer_group,
      ...profile.pain_anchors.map((item) => item.text),
      profile.alternatives,
      profile.solution_expectations
    ].join("。");
    wordData[`market.${key}.all`] = await embedWords(allText);
    sentenceVecs[`market.${key}.all`] = await embeddingService.embed(allText);
  }

  for (const [key, profile] of Object.entries(profiles.strategy)) {
    const allText = [
      profile.customer_traits,
      profile.value_perception,
      profile.solution_expectations
    ].join("。");
    wordData[`strategy.${key}.all`] = await embedWords(allText);
    sentenceVecs[`strategy.${key}.all`] = await embeddingService.embed(allText);
    for (const field of ["customer_traits", "value_perception", "solution_expectations"]) {
      wordData[`strategy.${key}.${field}`] = await embedWords(profile[field]);
      sentenceVecs[`strategy.${key}.${field}`] = await embeddingService.embed(profile[field]);
    }
  }

  for (const [key, profile] of Object.entries(profiles.architecture)) {
    const allText = [
      profile.customer_traits,
      profile.value_perception,
      profile.solution_expectations
    ].join("。");
    wordData[`architecture.${key}.all`] = await embedWords(allText);
    sentenceVecs[`architecture.${key}.all`] = await embeddingService.embed(allText);
    for (const field of ["customer_traits", "value_perception", "solution_expectations"]) {
      wordData[`architecture.${key}.${field}`] = await embedWords(profile[field]);
      sentenceVecs[`architecture.${key}.${field}`] = await embeddingService.embed(profile[field]);
    }
  }

  let totalWords = 0;
  for (const value of Object.values(wordData)) {
    totalWords += value.words.length;
  }

  const output = {
    profiles,
    wordData,
    sentenceVecs
  };
  const outPath = path.join(__dirname, "..", "game_config_v0.1", "vp_word_cache.json");
  fs.writeFileSync(outPath, JSON.stringify(output), "utf8");
  console.log(`Precomputed ${Object.keys(wordData).length} word sets, ${totalWords} total word embeddings.`);
  console.log(`Saved: ${outPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
