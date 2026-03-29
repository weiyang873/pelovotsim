/**
 * smoke_test_v2.js
 * Round 1 v2 (SAM-WTP) 端到端冒烟测试
 *
 * 用法：
 *   1. node server.js
 *   2. export PGHOST=127.0.0.1 PGPORT=5432 PGUSER=weiyang PGDATABASE=emba_sim
 *      node scripts/smoke_test_v2.js
 *
 * 环境变量：
 *   BASE_URL=http://127.0.0.1:8787  (默认)
 *   TEAM_SIZE=2                       (默认)
 *   SKIP_LLM=1                        (默认跳过 DeepSeek 依赖步骤)
 */

const BASE = process.env.BASE_URL || "http://127.0.0.1:8787";
const TEAM_SIZE = Number(process.env.TEAM_SIZE || 2);
const SKIP_LLM = process.env.SKIP_LLM !== "0";

let passed = 0, failed = 0, skipped = 0;

async function post(path, body) {
  const r = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: r.status, data: await r.json() };
}

async function get(path) {
  const r = await fetch(`${BASE}${path}`);
  return { status: r.status, data: await r.json() };
}

async function step(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`  \u2705 ${name}`);
  } catch (e) {
    failed++;
    console.log(`  \u274C ${name}: ${e.message}`);
  }
}

function skip(name, reason) {
  skipped++;
  console.log(`  \u23ED\uFE0F  ${name} (${reason})`);
}

function assert(cond, msg) { if (!cond) throw new Error(msg); }

async function main() {
  console.log(`\n\uD83D\uDD27 Round 1 v2 (SAM-WTP) \u5192\u70DF\u6D4B\u8BD5`);
  console.log(`   \u670D\u52A1\u5668: ${BASE}`);
  console.log(`   \u7EC4\u5927\u5C0F: ${TEAM_SIZE}`);
  console.log(`   \u8DF3\u8FC7LLM: ${SKIP_LLM}\n`);

  let teamId, members;

  // ── 0. Health ──
  await step("0. /api/health", async () => {
    const { status, data } = await get("/api/health");
    assert(status === 200 && data.ok, `HTTP ${status}`);
  });

  // ── 1. 建组 ──
  await step("1. POST /api/team/create", async () => {
    const { status, data } = await post("/api/team/create", {
      teamName: `v2_smoke_${Date.now()}`, teamSize: TEAM_SIZE,
    });
    assert(status === 200 && data.ok, `${status} ${JSON.stringify(data).slice(0, 200)}`);
    assert(data.team?.id, "missing team.id");
    assert(data.team.members.length === TEAM_SIZE, `members=${data.team.members.length}`);
    teamId = data.team.id;
    members = data.team.members;
    console.log(`        teamId=${teamId}`);
  });

  if (!teamId) { console.log("\n建组失败，退出\n"); process.exit(1); }

  // ── 2. 获取团队 ──
  await step("2. GET /api/team/:id", async () => {
    const { data } = await get(`/api/team/${teamId}`);
    assert(data.ok && data.team?.status === "forming", `status=${data.team?.status}`);
  });

  // ── 3. 获取锦囊 ──
  await step("3. GET jinang", async () => {
    const { data } = await get(`/api/team/${teamId}/member/${members[0].id}/jinang`);
    assert(data.ok && data.jinang?.market?.id, "missing market jinang");
    assert(data.jinang?.tech?.id, "missing tech jinang");
    console.log(`        market=${data.jinang.market.id} tech=${data.jinang.tech.id}`);
  });

  // ── 4. 提交 Phase1（不含渠道，v2 只要格子+架构+VP） ──
  const gridChoices = [
    { grid_id: "B2C_Differentiation_Adult", architecture: "Experience" },
    { grid_id: "B2C_Differentiation_Adult", architecture: "Hybrid" },
  ];
  for (let i = 0; i < members.length; i++) {
    const m = members[i];
    const c = gridChoices[i % gridChoices.length];
    await step(`4-${i + 1}. Phase1 submit member ${i + 1}`, async () => {
      const { status, data } = await post(`/api/team/${teamId}/phase1/${m.id}/submit`, {
        grid_id: c.grid_id,
        architecture: c.architecture,
        who: "25-35岁独居年轻白领",
        pain: "下班回家感到孤独缺少情感陪伴",
        how: "LOVOT通过主动靠近和情绪识别提供温暖陪伴",
      });
      assert(status === 200 && data.ok, `${status} ${data.error || ""}`);
      console.log(`        submitted=${data.submitted_count}/${TEAM_SIZE}`);
    });
  }

  // ── 5. 状态检查 ──
  await step("5. GET status -> all_submitted", async () => {
    const { data } = await get(`/api/team/${teamId}/status`);
    assert(data.ok && data.all_submitted === true, `all_submitted=${data.all_submitted}`);
    console.log(`        status=${data.status} phase=${data.phase}`);
  });

  // ── 6. 提交汇总 ──
  await step("6. GET submissions", async () => {
    const { data } = await get(`/api/team/${teamId}/submissions`);
    assert(data.ok && data.submissions?.length === TEAM_SIZE, `len=${data.submissions?.length}`);
  });

  // ── 7-9. VP Coach + Finalize（LLM 依赖） ──
  if (SKIP_LLM) {
    skip("7. Phase3 submit-vp", "DeepSeek API");
    skip("8. Phase3 chat", "DeepSeek API");
    skip("9. Phase3 finalize", "DeepSeek API");
    skip("10. Phase4 result (v2 fields)", "depends on finalize");
    skip("11. Freeze (no target_gm)", "depends on finalize");
  } else {
    await step("7. POST phase3/submit-vp", async () => {
      const { status, data } = await post(`/api/team/${teamId}/phase3/submit-vp`, {
        round: 1,
        grid_id: "B2C_Differentiation_Adult",
        architecture: "Experience",
        // 注意：v2 不再传 channel_pref
        who: "25-35岁独居年轻白领",
        pain: "下班回家孤独缺少情感陪伴互动",
        how: "LOVOT通过情绪识别提供温暖陪伴",
      });
      assert(status === 200 && data.ok, `${status} ${data.error || ""}`);
    });

    await step("8. POST phase3/chat", async () => {
      const { status, data } = await post(`/api/team/${teamId}/phase3/chat`, {
        message: "我想瞄准一线城市独居白领",
      });
      assert(status === 200 && data.ok, `${status} ${data.error || ""}`);
    });

    await step("9. POST phase3/finalize (v2: no channel_pref)", async () => {
      const { status, data } = await post(`/api/team/${teamId}/phase3/finalize`, {
        grid_id: "B2C_Differentiation_Adult",
        architecture: "Experience",
        // v2: 不传 channel_pref
        scores: { coverage: 4, generalizability: 3, effectiveness: 4 },
      });
      assert(status === 200 && data.ok, `${status} ${data.error || ""}`);

      // v2 核心验证：返回 r1_result
      const r1 = data.r1_result;
      if (r1) {
        console.log(`        SAM=${r1.SAM_billion}亿 WTPadj=¥${r1.WTPadj} rho_C=${r1.rho_C}`);
        assert(r1.SAM_billion > 0, "SAM_billion should be > 0");
        assert(r1.WTPadj > 0, "WTPadj should be > 0");
        assert(r1.WTPref > 0, "WTPref should be > 0");
        assert(r1.rho_C >= 0.1 && r1.rho_C <= 0.9, `rho_C=${r1.rho_C} out of range`);
        assert(r1.C >= 1 && r1.C <= 5, `C=${r1.C} out of range`);
        assert(r1.Eadj === r1.E_raw, `Eadj=${r1.Eadj} should equal E_raw=${r1.E_raw}`);
      }
    });

    // ── 10. Phase4 结果（v2 字段验证） ──
    await step("10. GET phase4 (v2 fields)", async () => {
      const { status, data } = await get(`/api/team/${teamId}/phase4`);
      assert(status === 200 && data.ok, `${status}`);

      // v2 核心字段
      const r1 = data.r1_result;
      assert(r1, "missing r1_result");
      assert(r1.SAM_billion > 0, `SAM_billion=${r1.SAM_billion}`);
      assert(r1.WTPadj > 0, `WTPadj=${r1.WTPadj}`);
      assert(r1.WTPref > 0, `WTPref=${r1.WTPref}`);
      assert(r1.rho_C > 0, `rho_C=${r1.rho_C}`);
      assert(r1.wtp_multiplier > 0, `wtp_multiplier=${r1.wtp_multiplier}`);

      // v2 不应有 v1 字段
      assert(!data.margin_headroom, "v1 margin_headroom should not exist");
      assert(!data.market_space, "v1 market_space should not exist");
      assert(!data.gm, "v1 gm should not exist");

      // 锦囊结算仍在
      assert(data.settle, "missing settle");

      // VP 摘要
      assert(data.vp_summary, "missing vp_summary");

      console.log(`        SAM=${r1.SAM_billion}亿 WTPadj=¥${r1.WTPadj}`);
      console.log(`        C=${r1.C} G=${r1.G} E_raw=${r1.E_raw} Eadj=${r1.Eadj}`);
      console.log(`        rho_C=${r1.rho_C} wtp_multiplier=${r1.wtp_multiplier}`);
    });

    // ── 11. Freeze（v2: 不传 target_gm） ──
    await step("11. POST freeze (v2: no target_gm)", async () => {
      const { status, data } = await post(`/api/team/${teamId}/freeze`, {});
      assert(status === 200 && data.ok, `${status} ${data.error || ""}`);
      assert(data.status === "frozen", `status=${data.status}`);
    });
  }

  // ── 12. VP Session 创建 ──
  await step("12. POST /api/vp/session", async () => {
    const { status, data } = await post("/api/vp/session", {
      teamKey: teamId,
      strategy: { market: "ToC", competitive: "DIFF", segment: "ADULT", architecture: "Experience" },
    });
    assert(status === 200 && data.ok && data.sessionId, `${status}`);
  });

  // ── 13. DB Status ──
  await step("13. GET /api/db-status", async () => {
    const { data } = await get("/api/db-status");
    assert(data.ok, JSON.stringify(data));
  });

  // ── 14. 防重复 ──
  await step("14. 重复提交拒绝", async () => {
    const { status } = await post(`/api/team/${teamId}/phase1/${members[0].id}/submit`, {
      grid_id: "B2C_Differentiation_Adult", architecture: "Experience",
      who: "x", pain: "x", how: "x",
    });
    assert(status === 400, `期望 400，实际 ${status}`);
  });

  // ── 15. 404 ──
  await step("15. 不存在的 team -> 404", async () => {
    const { status } = await get("/api/team/nonexistent_12345");
    assert(status === 404, `期望 404，实际 ${status}`);
  });

  // ── 16. engine.js 直接验证（如果可以 require） ──
  await step("16. engine.js v2 WTP 计算验证", async () => {
    try {
      const Engine = require("../engine");
      const t1 = Engine.computeR1WTP("ToC_DIFF_ELDER");
      assert(Math.abs(t1.WTPmean - 18091) / 18091 < 0.03, `ToC_DIFF_ELDER WTPmean=${t1.WTPmean}`);
      assert(t1.SAM_billion >= 320 && t1.SAM_billion <= 380, `SAM=${t1.SAM_billion}`);

      const t2 = Engine.computeR1WTP("ToC_COST_ADULT");
      assert(Math.abs(t2.WTPmean - 12404) / 12404 < 0.03, `ToC_COST_ADULT WTPmean=${t2.WTPmean}`);

      const r1 = Engine.computeRound1V2("ToC_DIFF_ADULT", "Experience", { C: 4, G: 3, E: 4 }, 0.7);
      assert(r1.Eadj === 5, `Eadj=${r1.Eadj}, expected 5`);
      assert(r1.rho_C === 0.70, `rho_C=${r1.rho_C}`);
      assert(Math.abs(r1.wtp_multiplier - 0.99) < 0.02, `wtp_multiplier=${r1.wtp_multiplier}`);

      console.log(`        WTP_ELDER=${t1.WTPmean} SAM=${t1.SAM_billion}亿`);
      console.log(`        Eadj=${r1.Eadj} rho_C=${r1.rho_C} multiplier=${r1.wtp_multiplier}`);
    } catch (e) {
      if (e.code === "MODULE_NOT_FOUND") {
        console.log(`        (engine.js not found at ../engine, skipping)`);
        skipped++;
        passed--; // undo the pass from step()
      } else {
        throw e;
      }
    }
  });

  // ── 清理 ──
  console.log("\n\uD83E\uDDF9 清理测试数据...");
  try {
    const { Pool } = require("pg");
    const pool = new Pool();
    await pool.query(`DELETE FROM member_submissions WHERE team_id=$1`, [teamId]);
    await pool.query(`DELETE FROM jinang_settlements WHERE team_id=$1`, [teamId]);
    await pool.query(`DELETE FROM team_members WHERE team_id=$1`, [teamId]);
    await pool.query(`DELETE FROM vp_sessions WHERE team_key=$1`, [teamId]);
    await pool.query(`DELETE FROM teams WHERE id=$1`, [teamId]);
    await pool.end();
    console.log("  \u2705 已清理");
  } catch (e) {
    console.log(`  \u26A0\uFE0F  清理失败（teamId=${teamId}）: ${e.message}`);
  }

  // ── 汇总 ──
  console.log(`\n${"=".repeat(50)}`);
  console.log(`  \u2705 通过: ${passed}   \u274C 失败: ${failed}   \u23ED\uFE0F  跳过: ${skipped}`);
  console.log(`${"=".repeat(50)}\n`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(e => { console.error(e); process.exit(1); });
