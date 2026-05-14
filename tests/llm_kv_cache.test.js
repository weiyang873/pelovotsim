const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

function loadLocalEnvFile() {
  const envPath = path.join(__dirname, "..", ".env");
  if (!fs.existsSync(envPath)) return;
  const content = fs.readFileSync(envPath, "utf8");
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith("\"") && value.endsWith("\"")) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!Object.prototype.hasOwnProperty.call(process.env, key)) {
      process.env[key] = value;
    }
  }
}

loadLocalEnvFile();

const TeamManager = require("../server/multiplayer/teamManager");
const { kvGet, kvSet } = require("../server/db/kvCache");
const { runSql, sqlQuote } = require("../server/db/pgSql");

function uniquePrefix(prefix) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

test("kv cache stores concurrent writes without losing entries", { concurrency: false }, async () => {
  await TeamManager.ensureSchema();
  const cacheName = uniquePrefix("kv_concurrent");
  const entries = Array.from({ length: 10 }, (_, index) => ({
    key: `key_${index}`,
    value: { index, label: `value-${index}` }
  }));

  await Promise.all(entries.map((entry) => kvSet(cacheName, entry.key, entry.value)));

  const rows = await runSql(`
    SELECT COUNT(*)::int AS c
    FROM llm_kv_cache
    WHERE cache_name = ${sqlQuote(cacheName)};
  `);
  assert.equal(Number(rows[0]?.c || 0), 10);

  const sample = await kvGet(cacheName, entries[3].key);
  assert.deepEqual(sample, entries[3].value);
});

test("kv cache keeps namespaces isolated", { concurrency: false }, async () => {
  await TeamManager.ensureSchema();
  const key = uniquePrefix("shared_key");
  await kvSet("namespace_a", key, { value: 1 });
  await kvSet("namespace_b", key, { value: 2 });

  assert.deepEqual(await kvGet("namespace_a", key), { value: 1 });
  assert.deepEqual(await kvGet("namespace_b", key), { value: 2 });
});
