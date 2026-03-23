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
  "marketing_sessions"
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
  ]
};

// 检查关键列不是 SQLite 遗留类型
const TYPE_CHECKS = [
  { table: "teams", column: "created_at", expected_type: "timestamp with time zone" },
  { table: "teams", column: "final_gm_max", expected_type: "double precision" },
  { table: "round2_interview_sessions", column: "is_complete", expected_type: "boolean" },
  { table: "vp_sessions", column: "strategy", expected_type: "jsonb" }
];

async function main() {
  const pool = new Pool();
  let passed = 0;
  let failed = 0;

  // 1. 检查表是否存在
  for (const table of EXPECTED_TABLES) {
    const res = await pool.query(
      "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = 'public' AND table_name = $1",
      [table]
    );
    if (Number(res.rows[0].count) === 1) {
      console.log(`✅ 表 ${table} 存在`);
      passed += 1;
    } else {
      console.log(`❌ 表 ${table} 不存在`);
      failed += 1;
    }
  }

  // 2. 检查关键列是否存在
  for (const [table, cols] of Object.entries(EXPECTED_COLUMNS)) {
    const res = await pool.query(
      "SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1",
      [table]
    );
    const existing = new Set(res.rows.map((r) => r.column_name));
    for (const col of cols) {
      if (existing.has(col)) {
        passed += 1;
      } else {
        console.log(`❌ 表 ${table} 缺少列 ${col}`);
        failed += 1;
      }
    }
  }

  // 3. 检查类型是否正确（非 SQLite 遗留）
  for (const { table, column, expected_type: expectedType } of TYPE_CHECKS) {
    const res = await pool.query(
      "SELECT data_type FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1 AND column_name = $2",
      [table, column]
    );
    const actual = res.rows[0]?.data_type;
    if (actual === expectedType) {
      console.log(`✅ ${table}.${column} 类型正确: ${actual}`);
      passed += 1;
    } else {
      console.log(`❌ ${table}.${column} 类型错误: 期望 ${expectedType}, 实际 ${actual || "不存在"}`);
      failed += 1;
    }
  }

  // 4. 检查没有 SQLite 残留
  const sqliteCheck = await pool.query(
    "SELECT table_name, column_name, data_type FROM information_schema.columns " +
    "WHERE table_schema = 'public' AND data_type IN ('datetime', 'real') " +
    "ORDER BY table_name, column_name"
  );
  if (sqliteCheck.rows.length === 0) {
    console.log("✅ 无 SQLite 遗留类型（DATETIME/REAL）");
    passed += 1;
  } else {
    for (const r of sqliteCheck.rows) {
      console.log(`❌ SQLite 遗留类型: ${r.table_name}.${r.column_name} = ${r.data_type}`);
      failed += 1;
    }
  }

  // 5. 基本读写测试
  try {
    await pool.query("INSERT INTO teams (id, team_name, team_size, status, created_at) VALUES ('__test__', 'test', 1, 'forming', NOW())");
    const r = await pool.query("SELECT * FROM teams WHERE id = '__test__'");
    if (r.rows.length === 1) {
      console.log("✅ 基本读写正常");
      passed += 1;
    }
    await pool.query("DELETE FROM teams WHERE id = '__test__'");
  } catch (e) {
    console.log(`❌ 基本读写失败: ${e.message}`);
    failed += 1;
  }

  console.log(`\n===== 结果: ${passed} 通过, ${failed} 失败 =====`);
  await pool.end();
  process.exit(failed > 0 ? 1 : 0);
}

if (require.main === module) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}

module.exports = { main };
