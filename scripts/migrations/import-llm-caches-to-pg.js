#!/usr/bin/env node
const fs = require("fs");
const path = require("path");
const { kvSet } = require("../../server/db/kvCache");
const { shutdown } = require("../../server/db/pgSql");

const ROOT = path.join(__dirname, "..", "..");
const TAG_CACHE_PATH = path.join(ROOT, "data", "tag_cache.json");
const SCORE_CACHE_PATH = path.join(ROOT, "data", "score_cache.json");

async function importJsonFile(cacheName, filePath) {
  if (!fs.existsSync(filePath)) {
    console.log(`Skip ${cacheName}: file not found at ${filePath}`);
    return 0;
  }
  const raw = fs.readFileSync(filePath, "utf8");
  const data = JSON.parse(raw);
  let count = 0;
  for (const [key, value] of Object.entries(data || {})) {
    await kvSet(cacheName, key, value);
    count += 1;
  }
  console.log(`Imported ${count} entries into ${cacheName}`);
  return count;
}

async function main() {
  await importJsonFile("tag_extractor_v2", TAG_CACHE_PATH);
  await importJsonFile("dimension_scorer_v1", SCORE_CACHE_PATH);
}

main()
  .then(async () => {
    await shutdown();
    process.exit(0);
  })
  .catch(async (err) => {
    console.error(err);
    await shutdown().catch(() => {});
    process.exit(1);
  });
