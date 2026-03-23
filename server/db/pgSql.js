const { Pool } = require("pg");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || undefined,
  host: process.env.PGHOST || undefined,
  port: process.env.PGPORT ? Number(process.env.PGPORT) : undefined,
  user: process.env.PGUSER || undefined,
  password: process.env.PGPASSWORD || undefined,
  database: process.env.PGDATABASE || undefined,
  ssl: String(process.env.PGSSL || "").toLowerCase() === "true"
    ? { rejectUnauthorized: false }
    : undefined,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000
});

function sqlQuote(value) {
  if (value === null || value === undefined) return "NULL";
  return `'${String(value).replace(/'/g, "''")}'`;
}

function splitSqlStatements(sql) {
  const src = String(sql || "");
  const out = [];
  let cur = "";
  let inSingle = false;
  let inDouble = false;
  for (let i = 0; i < src.length; i += 1) {
    const ch = src[i];
    const prev = i > 0 ? src[i - 1] : "";
    if (ch === "'" && !inDouble && prev !== "\\") inSingle = !inSingle;
    if (ch === '"' && !inSingle && prev !== "\\") inDouble = !inDouble;
    if (ch === ";" && !inSingle && !inDouble) {
      if (cur.trim()) out.push(cur.trim());
      cur = "";
    } else {
      cur += ch;
    }
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

async function runSql(sql) {
  const statements = splitSqlStatements(sql);
  let lastRows = [];
  const client = await pool.connect();
  try {
    for (const stmt of statements) {
      const result = await client.query(stmt);
      if (result.rows && result.rows.length > 0) {
        lastRows = result.rows;
      } else if (/^\s*(SELECT|WITH|SHOW)/i.test(stmt)) {
        lastRows = result.rows || [];
      }
    }
  } finally {
    client.release();
  }
  return lastRows;
}

async function shutdown() {
  await pool.end();
}

module.exports = {
  runSql,
  sqlQuote,
  pool,
  shutdown
};
