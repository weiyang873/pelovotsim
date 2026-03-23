/**
 * verify_pg_migration.js
 * 验证 PostgreSQL 迁移完整性：表存在 / 列齐全 / 类型正确 / 读写正常
 *
 * 用法：node scripts/verify_pg_migration.js
 * 需要：DATABASE_URL 或 PGHOST/PGPORT/PGUSER/PGPASSWORD/PGDATABASE
 */

const { Pool } = require("pg");

const EXPECTED_TABLES = [
  "teams", "team_members", "member_submissions", "jinang_settlements",
  "round2_dimension_assignments", "round2_member_selections", "round2_interview_sessions",
  "vp_sessions", "marketing_sessions",
  "team_runs", "iteration_events", "llm_wizard_outputs", "llm_call_metrics",
];

const EXPECTED_COLUMNS = {
  teams: [
    "id","team_name","team_size","status","created_at",
    "final_grid_id","final_architecture","final_architecture_source",
    "final_channel1","final_channel2","final_channel1_share",
    "final_vp_text","final_vp_scores","final_gm_max","final_target_gm",
  ],
  team_members: ["id","team_id","member_name","member_index","jinang_market_id","jinang_tech_id","joined_at"],
  member_submissions: ["id","member_id","team_id","grid_id","architecture","channel_pref","vp_draft","personal_gm_max","submitted_at"],
  jinang_settlements: ["id","team_id","member_id","jinang_id","jinang_type","matched","match_reason","effect_applied"],
  round2_interview_sessions: ["session_id","team_id","member_id","member_dims_json","personas_json","history_json","result_json","round_no","is_complete","created_at","updated_at"],
  vp_sessions: ["session_id","team_key","strategy","messages","vp_canvas","pmf_score","status","created_at","updated_at"],
};

const TYPE_CHECKS = [
  { table: "teams", column: "created_at", want: "timestamp with time zone" },
  { table: "teams", column: "final_gm_max", want: "double precision" },
  { table: "teams", column: "final_channel1_share", want: "double precision" },
  { table: "team_members", column: "joined_at", want: "timestamp with time zone" },
  { table: "member_submissions", column: "personal_gm_max", want: "double precision" },
  { table: "jinang_settlements", column: "matched", want: "boolean" },
  { table: "round2_interview_sessions", column: "is_complete", want: "boolean" },
  { table: "round2_interview_sessions", column: "created_at", want: "timestamp with time zone" },
];

async function main() {
  const pool = new Pool();
  let passed = 0, failed = 0;
  const fail = (m) => { console.log(`  ❌ ${m}`); failed++; };
  const pass = (m) => { console.log(`  ✅ ${m}`); passed++; };

  // 1. 连接
  console.log("\n[1] 连接测试");
  try {
    const r = await pool.query("SELECT NOW() AS now");
    pass(`连接成功 ${r.rows[0].now}`);
  } catch (e) {
    fail(`连接失败: ${e.message}`);
    await pool.end(); process.exit(1);
  }

  // 2. 表存在
  console.log("\n[2] 表存在性");
  for (const t of EXPECTED_TABLES) {
    const r = await pool.query(`SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name=$1`, [t]);
    r.rows.length ? pass(t) : fail(`${t} 不存在`);
  }

  // 3. 列检查
  console.log("\n[3] 列存在性");
  for (const [table, cols] of Object.entries(EXPECTED_COLUMNS)) {
    const r = await pool.query(`SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name=$1`, [table]);
    const existing = new Set(r.rows.map(x => x.column_name));
    if (!existing.size) { fail(`${table}: 无列`); continue; }
    const missing = cols.filter(c => !existing.has(c));
    missing.length ? fail(`${table}: 缺 ${missing.join(",")}`) : pass(`${table}: ${cols.length} 列全在`);
  }

  // 4. 类型检查
  console.log("\n[4] 类型检查（SQLite→PG 关键列）");
  for (const { table, column, want } of TYPE_CHECKS) {
    const r = await pool.query(`SELECT data_type FROM information_schema.columns WHERE table_schema='public' AND table_name=$1 AND column_name=$2`, [table, column]);
    const actual = r.rows[0]?.data_type;
    if (!actual) fail(`${table}.${column} 不存在`);
    else if (actual === want) pass(`${table}.${column} = ${actual}`);
    else fail(`${table}.${column}: 期望 ${want}, 实际 ${actual}`);
  }

  // 5. 遗留类型扫描
  console.log("\n[5] SQLite 遗留类型扫描");
  const legacy = await pool.query(
    `SELECT table_name, column_name, data_type FROM information_schema.columns
     WHERE table_schema='public' AND LOWER(data_type) = ANY($1)`, [["datetime","real"]]
  );
  legacy.rows.length === 0
    ? pass("无 DATETIME/REAL 遗留")
    : legacy.rows.forEach(r => fail(`${r.table_name}.${r.column_name} = ${r.data_type}`));

  // 6. 读写测试
  console.log("\n[6] 读写测试");
  const tid = `__verify_${Date.now()}__`;
  try {
    await pool.query(`INSERT INTO teams (id,team_name,team_size,status,created_at) VALUES($1,'test',1,'forming',NOW())`, [tid]);
    const r = await pool.query(`SELECT status FROM teams WHERE id=$1`, [tid]);
    r.rows[0]?.status === "forming" ? pass("INSERT+SELECT") : fail("SELECT 结果异常");
    await pool.query(`DELETE FROM teams WHERE id=$1`, [tid]);
  } catch (e) { fail(`读写: ${e.message}`); }

  // 7. BOOLEAN 测试
  console.log("\n[7] BOOLEAN 测试");
  const bid = `__bool_${Date.now()}__`;
  try {
    await pool.query(`INSERT INTO jinang_settlements (id,team_id,member_id,jinang_id,jinang_type,matched) VALUES($1,'t','m','j','market',TRUE)`, [bid]);
    const r = await pool.query(`SELECT matched FROM jinang_settlements WHERE id=$1`, [bid]);
    r.rows[0]?.matched === true ? pass("BOOLEAN TRUE 正常") : fail(`读回 ${r.rows[0]?.matched}`);
    await pool.query(`DELETE FROM jinang_settlements WHERE id=$1`, [bid]);
  } catch (e) { fail(`BOOLEAN: ${e.message}`); }

  // 8. UPSERT 测试
  console.log("\n[8] UPSERT 测试");
  const uid = `__upsert_${Date.now()}__`;
  try {
    const upsertSql = `INSERT INTO round2_dimension_assignments (team_id,assignments_json,updated_at)
      VALUES($1,$2,NOW()) ON CONFLICT(team_id) DO UPDATE SET assignments_json=EXCLUDED.assignments_json, updated_at=EXCLUDED.updated_at`;
    await pool.query(upsertSql, [uid, "[]"]);
    await pool.query(upsertSql, [uid, "[1,2,3]"]);
    const r = await pool.query(`SELECT assignments_json FROM round2_dimension_assignments WHERE team_id=$1`, [uid]);
    r.rows[0]?.assignments_json === "[1,2,3]" ? pass("UPSERT 正常") : fail(`结果: ${r.rows[0]?.assignments_json}`);
    await pool.query(`DELETE FROM round2_dimension_assignments WHERE team_id=$1`, [uid]);
  } catch (e) { fail(`UPSERT: ${e.message}`); }

  // 汇总
  console.log(`\n${"=".repeat(50)}`);
  console.log(`  通过: ${passed}   失败: ${failed}`);
  console.log(`${"=".repeat(50)}\n`);
  await pool.end();
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(e => { console.error(e); process.exit(1); });
