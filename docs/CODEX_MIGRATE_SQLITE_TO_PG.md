# CODEX 任务：SQLite → PostgreSQL 完整迁移

## 背景

EMBA-AI-SIM 项目正在从 SQLite 迁移到 PostgreSQL。前一轮已完成初步迁移：所有 5 个数据库调用文件已改为 import `server/db/pgSql.js`。但当前 `pgSql.js` 实现有严重性能问题，且存在 SQLite 遗留语法、类型不规范、文件存储未迁移等问题。

本任务要求一次性完成所有剩余迁移工作。

---

## 任务总览（按顺序执行）

| # | 任务 | 涉及文件 | 优先级 |
|---|------|---------|--------|
| 1 | 重写 pgSql.js：spawnSync → 进程内连接池 | `server/db/pgSql.js` | 关键 |
| 2 | 删除 PRAGMA 残留 | `server/multiplayer/teamManager.js` | 高 |
| 3 | 修正 schema 类型 | `teamManager.js`, `round2Routes.js` | 高 |
| 4 | 修正布尔值处理 | `round2Routes.js`, `jinangSettler.js` | 高 |
| 5 | 迁移 VP sessions 到 PG | `server/llm/sessions.js` | 中 |
| 6 | 迁移 marketing sessions 到 PG | `server/llm/marketingSessions.js` | 中 |
| 7 | 添加初始化入口 | `server/` 启动文件 | 中 |
| 8 | 编写验证脚本 | 新文件 `scripts/verify_pg_migration.js` | 中 |

---

## 任务 1：重写 `server/db/pgSql.js`

### 问题

当前实现每执行一条 SQL 都通过 `spawnSync` 启动一个新 Node 子进程，在子进程中创建 `pg.Pool` → 查询 → 销毁。60 个学生同时操作时，一个 `createTeam` 调用涉及约 10+ 条 SQL，意味着 10+ 次进程创建。这在课堂并发场景下会导致严重性能问题。

### 要求

将 `pgSql.js` 改为进程内 `pg.Pool` 单例模式。**但注意**：现有所有调用方（`teamManager.js`, `teamRoutes.js`, `round2Routes.js`, `jinangDealer.js`, `jinangSettler.js`）都以**同步方式**调用 `runSql()`。全量改成 async 涉及改动面太大，因此保持 `runSql` 同步接口不变，但内部改用连接池。

### 实现方案

用 `pg-native`（libpq 的同步绑定）或用 `child_process.execFileSync` + 单次 `psql` 调用（比每次 spawn 一个完整 Node 进程轻量得多）。

**推荐方案**：使用 `pg` 包的连接池，但将 `runSql` 改为异步接口，同时一次性把所有调用方改为 async/await。这是更干净的方案。

具体做法：

```js
// server/db/pgSql.js — 新版本

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
  connectionTimeoutMillis: 5000,
});

function sqlQuote(value) {
  if (value === null || value === undefined) return "NULL";
  return `'${String(value).replace(/'/g, "''")}'`;
}

/**
 * 执行一条或多条 SQL 语句（用分号分隔）。
 * 返回最后一条 SELECT 的 rows 数组，非 SELECT 返回 []。
 * 现在是 async 函数。
 */
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

// splitSqlStatements 函数保持不变（从现有代码复制）

async function shutdown() {
  await pool.end();
}

module.exports = { runSql, sqlQuote, pool, shutdown };
```

### 调用方改造规则

所有使用 `runSql()` 的地方需要加 `await`，其所在函数需要加 `async`。涉及文件：

**`server/multiplayer/teamManager.js`**：
- `ensureSchema()` → `async ensureSchema()`
- `getTeamRow()` → `async getTeamRow()`
- `createTeam()` → `async createTeam()`
- `joinTeam()` → `async joinTeam()`
- `getTeam()` → `async getTeam()`
- `updateTeamStatus()` → `async updateTeamStatus()`
- 所有 `runSql(...)` 前加 `await`

**`server/multiplayer/jinangDealer.js`**：
- `dealJinang()` → `async dealJinang()`
- `getMemberJinang()` → `async getMemberJinang()`
- 所有 `runSql(...)` 前加 `await`

**`server/multiplayer/jinangSettler.js`**：
- `settleAllJinang()` → `async settleAllJinang()`
- 内部 `settleCard()` → `async settleCard()`
- `members.forEach((m) => { settleCard(...) })` 改为 `for (const m of members) { await settleCard(...) }`
- 所有 `runSql(...)` 前加 `await`

**`server/routes/teamRoutes.js`**：
- 所有路由 handler 函数加 `async`（大多数可能已经是 async）
- 所有 `runSql(...)` 前加 `await`
- 注意：文件内有辅助函数调用 `runSql`（如 `computeMarketSpaceTier` 周围），确保链路上都是 async

**`server/routes/round2Routes.js`**：
- `ensureSchema()` → `async ensureSchema()`
- `saveAssignments()` → `async saveAssignments()`
- `getAssignments()` → `async getAssignments()`
- `saveMemberSelections()` → `async saveMemberSelections()`
- `getMemberSelections()` → `async getMemberSelections()`
- `saveInterviewSession()` → `async saveInterviewSession()`
- `getInterviewSession()` → `async getInterviewSession()`
- `getLatestInterviewByMember()` → `async getLatestInterviewByMember()`
- 所有路由 handler 函数和其中的 `runSql(...)` 前加 `await`

### 重要约束

- `module.exports` 导出的接口名保持 `{ runSql, sqlQuote }` 不变，只是 `runSql` 变成返回 Promise
- 删除旧的 `spawnSync` 实现、`rewritePragma` 函数、`executeWithPg` 函数、`isSelectLike` 函数
- `splitSqlStatements` 保留
- 新增 `pool` 和 `shutdown` 导出

---

## 任务 2：删除 PRAGMA 残留

### 文件：`server/multiplayer/teamManager.js`

删除整个 `ensureTeamsColumns()` 函数（第 80-86 行）：

```js
// 删除这整个函数
function ensureTeamsColumns() {
  const cols = runSql(`PRAGMA table_info(teams);`);
  const names = new Set((Array.isArray(cols) ? cols : []).map((c) => String(c.name || "")));
  if (!names.has("final_architecture_source")) {
    runSql(`ALTER TABLE teams ADD COLUMN final_architecture_source TEXT DEFAULT 'player_selected';`);
  }
}
```

原因：`final_architecture_source` 列已经在 `ensureSchema()` 的 `CREATE TABLE` 中定义了，不需要运行时检查。

同时删除所有对 `ensureTeamsColumns()` 的调用。当前有 3 处调用，在 `createTeam()`、`getTeam()`、`updateTeamStatus()` 中：

```js
// 删除这些行（出现在 createTeam, getTeam, updateTeamStatus 中）
ensureTeamsColumns();
```

---

## 任务 3：修正 Schema 类型

### 文件：`server/multiplayer/teamManager.js` 的 `ensureSchema()` 函数

将 `CREATE TABLE` 语句中的类型改为 PG 规范类型：

```sql
-- 原来
CREATE TABLE IF NOT EXISTS teams (
  id TEXT PRIMARY KEY,
  team_name TEXT,
  team_size INTEGER,
  status TEXT,
  created_at DATETIME,              -- 改
  final_grid_id TEXT,
  final_architecture TEXT,
  final_architecture_source TEXT DEFAULT 'player_selected',
  final_channel1 TEXT,
  final_channel2 TEXT,
  final_channel1_share REAL,        -- 改
  final_vp_text TEXT,
  final_vp_scores TEXT,
  final_gm_max REAL,                -- 改
  final_target_gm REAL              -- 改
);

CREATE TABLE IF NOT EXISTS team_members (
  id TEXT PRIMARY KEY,
  team_id TEXT,
  member_name TEXT,
  member_index INTEGER,
  jinang_market_id TEXT,
  jinang_tech_id TEXT,
  joined_at DATETIME                -- 改
);

CREATE TABLE IF NOT EXISTS member_submissions (
  id TEXT PRIMARY KEY,
  member_id TEXT,
  team_id TEXT,
  grid_id TEXT,
  architecture TEXT,
  channel_pref TEXT,
  vp_draft TEXT,
  personal_gm_max REAL,             -- 改
  submitted_at DATETIME             -- 改
);

CREATE TABLE IF NOT EXISTS jinang_settlements (
  id TEXT PRIMARY KEY,
  team_id TEXT,
  member_id TEXT,
  jinang_id TEXT,
  jinang_type TEXT,
  matched BOOLEAN,                   -- PG 原生 BOOLEAN，保持
  match_reason TEXT,
  effect_applied TEXT
);
```

改为：

```sql
CREATE TABLE IF NOT EXISTS teams (
  id TEXT PRIMARY KEY,
  team_name TEXT,
  team_size INTEGER,
  status TEXT,
  created_at TIMESTAMPTZ,
  final_grid_id TEXT,
  final_architecture TEXT,
  final_architecture_source TEXT DEFAULT 'player_selected',
  final_channel1 TEXT,
  final_channel2 TEXT,
  final_channel1_share DOUBLE PRECISION,
  final_vp_text TEXT,
  final_vp_scores TEXT,
  final_gm_max DOUBLE PRECISION,
  final_target_gm DOUBLE PRECISION
);

CREATE TABLE IF NOT EXISTS team_members (
  id TEXT PRIMARY KEY,
  team_id TEXT REFERENCES teams(id),
  member_name TEXT,
  member_index INTEGER,
  jinang_market_id TEXT,
  jinang_tech_id TEXT,
  joined_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS member_submissions (
  id TEXT PRIMARY KEY,
  member_id TEXT,
  team_id TEXT,
  grid_id TEXT,
  architecture TEXT,
  channel_pref TEXT,
  vp_draft TEXT,
  personal_gm_max DOUBLE PRECISION,
  submitted_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS jinang_settlements (
  id TEXT PRIMARY KEY,
  team_id TEXT,
  member_id TEXT,
  jinang_id TEXT,
  jinang_type TEXT,
  matched BOOLEAN,
  match_reason TEXT,
  effect_applied TEXT
);
```

### 文件：`server/routes/round2Routes.js` 的 `ensureSchema()` 函数

```sql
-- 原来
CREATE TABLE IF NOT EXISTS round2_interview_sessions (
  session_id TEXT PRIMARY KEY,
  team_id TEXT NOT NULL,
  member_id TEXT NOT NULL,
  member_dims_json TEXT NOT NULL,
  personas_json TEXT NOT NULL,
  history_json TEXT NOT NULL,
  result_json TEXT,
  round_no INTEGER NOT NULL,
  is_complete INTEGER NOT NULL,       -- 改
  created_at TEXT NOT NULL,           -- 改
  updated_at TEXT NOT NULL            -- 改
);
```

改为：

```sql
CREATE TABLE IF NOT EXISTS round2_interview_sessions (
  session_id TEXT PRIMARY KEY,
  team_id TEXT NOT NULL,
  member_id TEXT NOT NULL,
  member_dims_json TEXT NOT NULL,
  personas_json TEXT NOT NULL,
  history_json TEXT NOT NULL,
  result_json TEXT,
  round_no INTEGER NOT NULL,
  is_complete BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL
);
```

`round2_dimension_assignments` 和 `round2_member_selections` 表的 `updated_at TEXT` 也改为 `updated_at TIMESTAMPTZ`。

---

## 任务 4：修正布尔值处理

### 文件：`server/routes/round2Routes.js`

**4a. `saveInterviewSession()` 函数（约第 470 行）**

```js
// 原来
${row.is_complete ? 1 : 0},
```

改为：

```js
${row.is_complete ? "TRUE" : "FALSE"},
```

**4b. `getInterviewSession()` 函数（约第 505 行）**

```js
// 原来
is_complete: Number(row.is_complete || 0) === 1,
```

改为：

```js
is_complete: row.is_complete === true || row.is_complete === "t",
```

说明：PG 的 `pg` 驱动返回 BOOLEAN 列时会自动转为 JS `true/false`，但为安全起见兼容两种形式。

**4c. `getLatestInterviewByMember()` 函数（约第 516 行）**

```sql
-- 原来
WHERE team_id = ${sqlQuote(teamId)} AND is_complete = 1
```

改为：

```sql
WHERE team_id = ${sqlQuote(teamId)} AND is_complete = TRUE
```

**4d. `ON CONFLICT ... DO UPDATE SET` 中的 `is_complete`（约第 478 行）**

```sql
-- 原来
is_complete = excluded.is_complete,
```

这个不需要改，`excluded.is_complete` 引用的是 VALUES 中插入的值，PG 会正确处理。

### 文件：`server/multiplayer/jinangSettler.js`

**第 234 行：**

```js
// 原来
${matched ? 1 : 0},
```

改为：

```js
${matched ? "TRUE" : "FALSE"},
```

---

## 任务 5：迁移 VP Sessions 到 PostgreSQL

### 文件：`server/llm/sessions.js`

当前使用 `data/vp_sessions.json` 文件存储所有 VP Coach 对话。改为 PostgreSQL 表存储。

**新建表**（在 `ensureSchema` 中添加或在 `sessions.js` 自带初始化）：

```sql
CREATE TABLE IF NOT EXISTS vp_sessions (
  session_id TEXT PRIMARY KEY,
  team_key TEXT NOT NULL,
  strategy JSONB DEFAULT '{}',
  messages JSONB DEFAULT '[]',
  vp_canvas TEXT,
  pmf_score DOUBLE PRECISION,
  status TEXT DEFAULT 'chatting',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_vp_sessions_team_key ON vp_sessions(team_key);
```

**重写 `sessions.js`**：

```js
// server/llm/sessions.js — PG 版
const crypto = require("node:crypto");
const { runSql, sqlQuote } = require("../db/pgSql");

let _initialized = false;
async function ensureTable() {
  if (_initialized) return;
  await runSql(`
    CREATE TABLE IF NOT EXISTS vp_sessions (
      session_id TEXT PRIMARY KEY,
      team_key TEXT NOT NULL,
      strategy JSONB DEFAULT '{}',
      messages JSONB DEFAULT '[]',
      vp_canvas TEXT,
      pmf_score DOUBLE PRECISION,
      status TEXT DEFAULT 'chatting',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_vp_sessions_team_key ON vp_sessions(team_key);
  `);
  _initialized = true;
}

async function createVpSession(teamKey, strategy) {
  await ensureTable();
  const sessionId = crypto.randomUUID();
  const now = new Date().toISOString();
  await runSql(`
    INSERT INTO vp_sessions (session_id, team_key, strategy, messages, vp_canvas, pmf_score, status, created_at, updated_at)
    VALUES (
      ${sqlQuote(sessionId)},
      ${sqlQuote(teamKey)},
      ${sqlQuote(JSON.stringify(strategy || {}))},
      '[]',
      NULL, NULL,
      'chatting',
      ${sqlQuote(now)},
      ${sqlQuote(now)}
    );
  `);
  return sessionId;
}

async function appendMessage(sessionId, role, content) {
  await ensureTable();
  const now = new Date().toISOString();
  // 用 PG 的 jsonb 拼接追加消息
  await runSql(`
    UPDATE vp_sessions
    SET messages = messages || ${sqlQuote(JSON.stringify([{ role, content, timestamp: now }]))}::jsonb,
        updated_at = ${sqlQuote(now)}
    WHERE session_id = ${sqlQuote(sessionId)};
  `);
}

async function getSession(sessionId) {
  await ensureTable();
  const rows = await runSql(`
    SELECT * FROM vp_sessions WHERE session_id = ${sqlQuote(sessionId)} LIMIT 1;
  `);
  if (!rows[0]) return null;
  const r = rows[0];
  return {
    sessionId: r.session_id,
    teamKey: r.team_key,
    strategy: typeof r.strategy === "string" ? JSON.parse(r.strategy) : r.strategy,
    messages: typeof r.messages === "string" ? JSON.parse(r.messages) : r.messages,
    vpCanvas: r.vp_canvas,
    pmfScore: r.pmf_score,
    status: r.status,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

async function updateSession(sessionId, patch) {
  await ensureTable();
  const now = new Date().toISOString();
  const sets = [`updated_at = ${sqlQuote(now)}`];
  if (patch.vpCanvas !== undefined) sets.push(`vp_canvas = ${sqlQuote(patch.vpCanvas)}`);
  if (patch.pmfScore !== undefined) sets.push(`pmf_score = ${patch.pmfScore === null ? "NULL" : Number(patch.pmfScore)}`);
  if (patch.status !== undefined) sets.push(`status = ${sqlQuote(patch.status)}`);
  if (patch.messages !== undefined) sets.push(`messages = ${sqlQuote(JSON.stringify(patch.messages))}::jsonb`);
  if (patch.strategy !== undefined) sets.push(`strategy = ${sqlQuote(JSON.stringify(patch.strategy))}::jsonb`);
  await runSql(`UPDATE vp_sessions SET ${sets.join(", ")} WHERE session_id = ${sqlQuote(sessionId)};`);
  return getSession(sessionId);
}

async function getTeamSessions(teamKey) {
  await ensureTable();
  const rows = await runSql(`
    SELECT * FROM vp_sessions WHERE team_key = ${sqlQuote(teamKey)} ORDER BY created_at ASC;
  `);
  return rows.map((r) => ({
    sessionId: r.session_id,
    teamKey: r.team_key,
    strategy: typeof r.strategy === "string" ? JSON.parse(r.strategy) : r.strategy,
    messages: typeof r.messages === "string" ? JSON.parse(r.messages) : r.messages,
    vpCanvas: r.vp_canvas,
    pmfScore: r.pmf_score,
    status: r.status,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }));
}

module.exports = {
  createVpSession,
  appendMessage,
  getSession,
  updateSession,
  getTeamSessions,
};
```

### 调用方改造

**`server/routes/vpChat.js`** 中所有调用 sessions 函数的地方都要加 `await`：

```js
// 原来
const sessionId = createVpSession(teamKey, strategy);
// 改为
const sessionId = await createVpSession(teamKey, strategy);

// 原来
appendMessage(sessionId, "user", userMsg);
// 改为
await appendMessage(sessionId, "user", userMsg);

// 原来
const session = getSession(sessionId);
// 改为
const session = await getSession(sessionId);

// 原来
updateSession(sessionId, { ... });
// 改为
await updateSession(sessionId, { ... });
```

确保 `vpChat.js` 中的 handler 函数都是 `async`。

---

## 任务 6：迁移 Marketing Sessions 到 PostgreSQL

### 文件：`server/llm/marketingSessions.js`

与任务 5 模式完全相同。

**新建表**：

```sql
CREATE TABLE IF NOT EXISTS marketing_sessions (
  session_id TEXT PRIMARY KEY,
  team_key TEXT,
  persona JSONB,
  messages JSONB DEFAULT '[]',
  tags JSONB DEFAULT '[]',
  dimensions JSONB DEFAULT '{}',
  status TEXT DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_marketing_sessions_team_key ON marketing_sessions(team_key);
```

重写方式同任务 5——读当前 `marketingSessions.js` 的 `readStore/writeStore` 模式，将每个函数改为 async + 数据库操作。

### 调用方改造

**`server/routes/marketing.js`** 中所有调用 marketingSessions 函数的地方加 `await`，handler 函数确保 `async`。

---

## 任务 7：添加初始化入口

在服务器启动文件（通常是 `server/index.js` 或 `server/app.js` 或项目根的 `index.js`）中：

1. 在服务启动前调用所有 `ensureSchema()` 函数以建表
2. 在进程退出时调用 `shutdown()` 关闭连接池

```js
const { shutdown } = require("./server/db/pgSql");
const { ensureSchema: ensureTeamSchema } = require("./server/multiplayer/teamManager");
// ... 其他 ensureSchema

async function startServer() {
  // 建表
  await ensureTeamSchema();
  // ... 启动 express
}

process.on("SIGINT", async () => {
  await shutdown();
  process.exit(0);
});

process.on("SIGTERM", async () => {
  await shutdown();
  process.exit(0);
});
```

注意：`teamManager.js` 需要导出 `ensureSchema`（目前没有导出，需要添加到 `module.exports`）。

---

## 任务 8：编写验证脚本

### 新文件：`scripts/verify_pg_migration.js`

```js
/**
 * 验证 PG 迁移完整性
 * 运行方式：node scripts/verify_pg_migration.js
 * 需要设置环境变量：DATABASE_URL 或 PGHOST/PGPORT/PGUSER/PGPASSWORD/PGDATABASE
 */

const { Pool } = require("pg");

const EXPECTED_TABLES = [
  "teams",
  "team_members",
  "member_submissions",
  "jinang_settlements",
  "round2_dimension_assignments",
  "round2_member_selections",
  "round2_interview_sessions",
  "vp_sessions",
  "marketing_sessions",
];

const EXPECTED_COLUMNS = {
  teams: [
    "id", "team_name", "team_size", "status", "created_at",
    "final_grid_id", "final_architecture", "final_architecture_source",
    "final_channel1", "final_channel2", "final_channel1_share",
    "final_vp_text", "final_vp_scores", "final_gm_max", "final_target_gm"
  ],
  team_members: [
    "id", "team_id", "member_name", "member_index",
    "jinang_market_id", "jinang_tech_id", "joined_at"
  ],
  round2_interview_sessions: [
    "session_id", "team_id", "member_id", "member_dims_json",
    "personas_json", "history_json", "result_json",
    "round_no", "is_complete", "created_at", "updated_at"
  ],
  vp_sessions: [
    "session_id", "team_key", "strategy", "messages",
    "vp_canvas", "pmf_score", "status", "created_at", "updated_at"
  ],
};

// 检查关键列不是 SQLite 遗留类型
const TYPE_CHECKS = [
  { table: "teams", column: "created_at", expected_type: "timestamp with time zone" },
  { table: "teams", column: "final_gm_max", expected_type: "double precision" },
  { table: "round2_interview_sessions", column: "is_complete", expected_type: "boolean" },
  { table: "vp_sessions", column: "strategy", expected_type: "jsonb" },
];

async function main() {
  const pool = new Pool();
  let passed = 0;
  let failed = 0;

  // 1. 检查表是否存在
  for (const table of EXPECTED_TABLES) {
    const res = await pool.query(
      `SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = 'public' AND table_name = $1`,
      [table]
    );
    if (Number(res.rows[0].count) === 1) {
      console.log(`✅ 表 ${table} 存在`);
      passed++;
    } else {
      console.log(`❌ 表 ${table} 不存在`);
      failed++;
    }
  }

  // 2. 检查关键列是否存在
  for (const [table, cols] of Object.entries(EXPECTED_COLUMNS)) {
    const res = await pool.query(
      `SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1`,
      [table]
    );
    const existing = new Set(res.rows.map((r) => r.column_name));
    for (const col of cols) {
      if (existing.has(col)) {
        passed++;
      } else {
        console.log(`❌ 表 ${table} 缺少列 ${col}`);
        failed++;
      }
    }
  }

  // 3. 检查类型是否正确（非 SQLite 遗留）
  for (const { table, column, expected_type } of TYPE_CHECKS) {
    const res = await pool.query(
      `SELECT data_type FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1 AND column_name = $2`,
      [table, column]
    );
    const actual = res.rows[0]?.data_type;
    if (actual === expected_type) {
      console.log(`✅ ${table}.${column} 类型正确: ${actual}`);
      passed++;
    } else {
      console.log(`❌ ${table}.${column} 类型错误: 期望 ${expected_type}, 实际 ${actual || "不存在"}`);
      failed++;
    }
  }

  // 4. 检查没有 SQLite 残留
  const sqliteCheck = await pool.query(
    `SELECT table_name, column_name, data_type FROM information_schema.columns
     WHERE table_schema = 'public' AND data_type IN ('datetime', 'real')
     ORDER BY table_name, column_name`
  );
  if (sqliteCheck.rows.length === 0) {
    console.log("✅ 无 SQLite 遗留类型（DATETIME/REAL）");
    passed++;
  } else {
    for (const r of sqliteCheck.rows) {
      console.log(`❌ SQLite 遗留类型: ${r.table_name}.${r.column_name} = ${r.data_type}`);
      failed++;
    }
  }

  // 5. 基本读写测试
  try {
    await pool.query(`INSERT INTO teams (id, team_name, team_size, status, created_at) VALUES ('__test__', 'test', 1, 'forming', NOW())`);
    const r = await pool.query(`SELECT * FROM teams WHERE id = '__test__'`);
    if (r.rows.length === 1) {
      console.log("✅ 基本读写正常");
      passed++;
    }
    await pool.query(`DELETE FROM teams WHERE id = '__test__'`);
  } catch (e) {
    console.log(`❌ 基本读写失败: ${e.message}`);
    failed++;
  }

  console.log(`\n===== 结果: ${passed} 通过, ${failed} 失败 =====`);
  await pool.end();
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
```

---

## 全局注意事项

### 不要修改的文件

以下文件不涉及数据库，**不要改动**：

- `server/llm/rdCalculator.js` — 纯计算引擎
- `server/llm/vpCoach.js` — 纯 LLM prompt 构建
- `server/llm/deepseekClient.js` — API 客户端
- `server/llm/interviewCoach.js` — 纯 LLM 逻辑
- `server/llm/personaGenerator.js` — 纯 LLM 逻辑
- `server/llm/requirementBuilder.js` — 纯 LLM 逻辑
- `server/llm/embeddingService.js` — 本地嵌入
- `server/llm/tagExtractor.js` — LLM + 本地缓存（缓存迁移可选，本次不做）
- `server/llm/dimensionScorer.js` — LLM + 本地缓存（同上）
- `server/multiplayer/rdTeamAdapter.js` — 纯计算逻辑，无 DB 调用
- `server/routes/rd.js` — 无 DB 调用
- `client/` 目录 — 前端不涉及

### npm 依赖

在 `package.json` 中：
- 添加 `"pg": "^8.13.0"`
- 移除 `better-sqlite3` 或 `sqlite3`（如果存在的话）

### 环境变量

部署时需要设置：

```env
PGHOST=<新加坡服务器地址>
PGPORT=5432
PGUSER=emba_sim
PGPASSWORD=<密码>
PGDATABASE=emba_sim
# 或者用 DATABASE_URL 一行搞定：
# DATABASE_URL=postgresql://emba_sim:<密码>@<地址>:5432/emba_sim
```

### ON CONFLICT 语法

`round2Routes.js` 中使用的 `ON CONFLICT ... DO UPDATE SET ... = excluded....` 语法在 PG 中是原生支持的（这是 PG 9.5+ 的 UPSERT 语法），无需修改。

### 测试顺序

1. 先设置好 PG 数据库和环境变量
2. 运行 `node scripts/verify_pg_migration.js` 确认表结构
3. 手动创建一个 team 测试完整流程
4. 检查 VP Coach 对话是否正常保存
