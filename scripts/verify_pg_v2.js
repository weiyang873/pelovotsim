/**
 * verify_pg_v2.js
 * 验证 PostgreSQL schema 适配 v2 SAM-WTP 框架
 *
 * 用法：
 *   export PGHOST=127.0.0.1 PGPORT=5432 PGUSER=weiyang PGDATABASE=emba_sim
 *   node scripts/verify_pg_v2.js
 */

const { Pool } = require("pg");

const EXPECTED_TABLES = [
  "teams", "team_members", "member_submissions", "jinang_settlements",
  "round2_dimension_assignments", "round2_member_selections", "round2_interview_sessions",
  "vp_sessions", "marketing_sessions",
  "team_runs", "iteration_events", "llm_wizard_outputs", "llm_call_metrics",
];

// v2 新增列
const V2_NEW_COLUMNS = {
  teams: [
    "final_sam", "final_wtp_adj", "final_wtp_ref",
    "final_vp_c", "final_vp_g", "final_vp_e_raw", "final_vp_e_adj",
    "final_rho_c", "final_wtp_multiplier",
  ],
};

// 基础必须列
const REQUIRED_COLUMNS = {
  teams: ["id", "team_name", "team_size", "status", "created_at",
    "final_grid_id", "final_architecture", "final_architecture_source",
    "final_vp_text", "final_vp_scores"],
  team_members: ["id", "team_id", "member_name", "member_index", "jinang_market_id", "jinang_tech_id"],
  member_submissions: ["id", "member_id", "team_id", "grid_id", "architecture", "vp_draft"],
  jinang_settlements: ["id", "team_id", "member_id", "jinang_id", "jinang_type", "matched", "match_reason", "effect_applied"],
};

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

  // 3. 基础列
  console.log("\n[3] 基础列存在性");
  for (const [table, cols] of Object.entries(REQUIRED_COLUMNS)) {
    const r = await pool.query(`SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name=$1`, [table]);
    const existing = new Set(r.rows.map(x => x.column_name));
    const missing = cols.filter(c => !existing.has(c));
    missing.length ? fail(`${table}: 缺 ${missing.join(",")}`) : pass(`${table}: 基础列齐全`);
  }

  // 4. v2 新增列
  console.log("\n[4] v2 新增列检查（SAM-WTP 框架）");
  for (const [table, cols] of Object.entries(V2_NEW_COLUMNS)) {
    const r = await pool.query(`SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name=$1`, [table]);
    const existing = new Set(r.rows.map(x => x.column_name));
    for (const col of cols) {
      existing.has(col) ? pass(`${table}.${col}`) : fail(`${table}.${col} 不存在`);
    }
  }

  // 5. v2 新增列类型检查
  console.log("\n[5] v2 列类型检查");
  const typeChecks = [
    { table: "teams", column: "final_sam", want: "double precision" },
    { table: "teams", column: "final_wtp_adj", want: "double precision" },
    { table: "teams", column: "final_wtp_ref", want: "double precision" },
    { table: "teams", column: "final_vp_c", want: "integer" },
    { table: "teams", column: "final_vp_e_adj", want: "integer" },
    { table: "teams", column: "final_rho_c", want: "double precision" },
    { table: "teams", column: "final_wtp_multiplier", want: "double precision" },
  ];
  for (const { table, column, want } of typeChecks) {
    const r = await pool.query(
      `SELECT data_type FROM information_schema.columns WHERE table_schema='public' AND table_name=$1 AND column_name=$2`,
      [table, column]
    );
    const actual = r.rows[0]?.data_type;
    if (!actual) fail(`${table}.${column} 不存在`);
    else if (actual === want) pass(`${table}.${column} = ${actual}`);
    else fail(`${table}.${column}: 期望 ${want}, 实际 ${actual}`);
  }

  // 6. 读写测试（v2 列）
  console.log("\n[6] v2 列读写测试");
  const tid = `__v2_test_${Date.now()}__`;
  try {
    await pool.query(
      `INSERT INTO teams (id, team_name, team_size, status, created_at,
        final_grid_id, final_architecture, final_sam, final_wtp_adj, final_wtp_ref,
        final_vp_c, final_vp_g, final_vp_e_raw, final_vp_e_adj, final_rho_c, final_wtp_multiplier)
       VALUES ($1, 'v2_test', 2, 'phase4', NOW(),
        'ToC_DIFF_ADULT', 'Experience', 354, 16949, 17120,
        4, 3, 4, 5, 0.70, 0.99)`,
      [tid]
    );
    const r = await pool.query(`SELECT final_sam, final_wtp_adj, final_vp_c, final_vp_e_adj, final_rho_c FROM teams WHERE id=$1`, [tid]);
    const row = r.rows[0];
    if (row &&
        Math.abs(row.final_sam - 354) < 1 &&
        Math.abs(row.final_wtp_adj - 16949) < 1 &&
        row.final_vp_c === 4 &&
        row.final_vp_e_adj === 5 &&
        Math.abs(row.final_rho_c - 0.70) < 0.01) {
      pass("v2 列读写正常");
    } else {
      fail(`v2 列读回异常: ${JSON.stringify(row)}`);
    }
    await pool.query(`DELETE FROM teams WHERE id=$1`, [tid]);
  } catch (e) {
    fail(`v2 读写: ${e.message}`);
    try { await pool.query(`DELETE FROM teams WHERE id=$1`, [tid]); } catch (_) {}
  }

  // 汇总
  console.log(`\n${"=".repeat(50)}`);
  console.log(`  通过: ${passed}   失败: ${failed}`);
  console.log(`${"=".repeat(50)}\n`);
  await pool.end();
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(e => { console.error(e); process.exit(1); });
