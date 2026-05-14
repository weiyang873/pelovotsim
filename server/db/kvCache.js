const { runSql, sqlQuote } = require("./pgSql");

function parseCacheValue(value) {
  if (value == null) return null;
  if (typeof value === "object") return value;
  try {
    return JSON.parse(String(value));
  } catch (_) {
    return null;
  }
}

async function kvGet(cacheName, key) {
  const rows = await runSql(`
    SELECT cache_value
    FROM llm_kv_cache
    WHERE cache_name = ${sqlQuote(cacheName)}
      AND cache_key = ${sqlQuote(key)}
    LIMIT 1;
  `);
  if (!rows[0]) return null;
  return parseCacheValue(rows[0].cache_value);
}

async function kvSet(cacheName, key, value) {
  await runSql(`
    INSERT INTO llm_kv_cache (cache_name, cache_key, cache_value, updated_at)
    VALUES (
      ${sqlQuote(cacheName)},
      ${sqlQuote(key)},
      ${sqlQuote(JSON.stringify(value))}::jsonb,
      NOW()
    )
    ON CONFLICT (cache_name, cache_key) DO UPDATE SET
      cache_value = EXCLUDED.cache_value,
      updated_at = NOW();
  `);
}

module.exports = {
  kvGet,
  kvSet
};
