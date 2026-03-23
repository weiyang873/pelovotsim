/**
 * smoke_test_round1.js
 * 通过 HTTP API 模拟 Round 1 核心流程，验证 PG 迁移后端到端可用
 *
 * 用法：
 *   1. 先启动服务器: node server.js
 *   2. 另一个终端: node scripts/smoke_test_round1.js
 *
 * 可选环境变量：
 *   BASE_URL=http://127.0.0.1:8787  (默认)
 *   TEAM_SIZE=2                       (默认 2 人)
 *   SKIP_LLM=1                        (默认跳过需要 DeepSeek 的步骤)
 */

const BASE = process.env.BASE_URL || "http://127.0.0.1:8787";
const TEAM_SIZE = Number(process.env.TEAM_SIZE || 2);
const SKIP_LLM = process.env.SKIP_LLM !== "0";

let passed = 0, failed = 0, skipped = 0;

function log(icon, msg) { console.log(`  ${icon} ${msg}`); }

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
    log("\u2705", name);
  } catch (e) {
    failed++;
    log("\u274C", `${name}: ${e.message}`);
  }
}

function skip(name, reason) {
  skipped++;
  log("\u23ED\uFE0F ", `${name} (\u8DF3\u8FC7: ${reason})`);
}

function assert(cond, msg) { if (!cond) throw new Error(msg); }

async function main() {
  console.log(`\n\uD83D\uDD27 Round 1 \u5192\u70DF\u6D4B\u8BD5`);
  console.log(`   \u670D\u52A1\u5668: ${BASE}`);
  console.log(`   \u7EC4\u5927\u5C0F: ${TEAM_SIZE}`);
  console.log(`   \u8DF3\u8FC7LLM: ${SKIP_LLM}\n`);

  let teamId, members;

  // 0. Health
  await step("0. /api/health", async () => {
    const { status, data } = await get("/api/health");
    assert(status === 200 && data.ok, `HTTP ${status}`);
  });

  // 1. 建组
  await step("1. POST /api/team/create", async () => {
    const { status, data } = await post("/api/team/create", {
      teamName: `smoke_${Date.now()}`, teamSize: TEAM_SIZE,
    });
    assert(status === 200 && data.ok, `${status} ${JSON.stringify(data).slice(0,200)}`);
    assert(data.team?.id, "missing team.id");
    assert(data.team.members.length === TEAM_SIZE, `members=${data.team.members.length}`);
    teamId = data.team.id;
    members = data.team.members;
    console.log(`        teamId=${teamId}`);
  });

  if (!teamId) { console.log("\n\u5EFA\u7EC4\u5931\u8D25\uFF0C\u9000\u51FA\n"); process.exit(1); }

  // 2. 获取团队
  await step("2. GET /api/team/:id", async () => {
    const { status, data } = await get(`/api/team/${teamId}`);
    assert(status === 200 && data.ok, `${status}`);
    assert(data.team?.status === "forming", `status=${data.team?.status}`);
  });

  // 3. 获取锦囊
  await step("3. GET /api/team/:id/member/:mid/jinang", async () => {
    const { data } = await get(`/api/team/${teamId}/member/${members[0].id}/jinang`);
    assert(data.ok && data.jinang?.market?.id, "missing market jinang");
    assert(data.jinang?.tech?.id, "missing tech jinang");
    console.log(`        market=${data.jinang.market.id} tech=${data.jinang.tech.id}`);
  });

  // 4. 每人提交 Phase1
  const gridChoices = [
    { grid_id: "B2C_Differentiation_Adult", architecture: "Experience" },
    { grid_id: "B2C_Differentiation_Adult", architecture: "Hybrid" },
    { grid_id: "B2B_Cost_Elder", architecture: "Function" },
    { grid_id: "B2C_Cost_Child", architecture: "Experience" },
    { grid_id: "B2B_Differentiation_Adult", architecture: "Hybrid" },
    { grid_id: "B2C_Differentiation_Elder", architecture: "Function" },
  ];
  for (let i = 0; i < members.length; i++) {
    const m = members[i];
    const c = gridChoices[i % gridChoices.length];
    await step(`4-${i+1}. Phase1 submit member ${i+1}`, async () => {
      const { status, data } = await post(`/api/team/${teamId}/phase1/${m.id}/submit`, {
        grid_id: c.grid_id, architecture: c.architecture,
        who: "\u72EC\u5C45\u5E74\u8F7B\u767D\u9886 25-35\u5C81",
        pain: "\u4E0B\u73ED\u56DE\u5BB6\u611F\u5230\u5B64\u72EC",
        how: "LOVOT \u901A\u8FC7\u4E3B\u52A8\u9760\u8FD1\u548C\u60C5\u7EEA\u8BC6\u522B\u63D0\u4F9B\u966A\u4F34",
      });
      assert(status === 200 && data.ok, `${status} ${data.error || ""}`);
      assert(typeof data.personal_gm_max === "number", "missing gm_max");
      console.log(`        gm_max=${data.personal_gm_max.toFixed(3)} submitted=${data.submitted_count}/${TEAM_SIZE}`);
    });
  }

  // 5. 状态检查
  await step("5. GET /api/team/:id/status -> all_submitted", async () => {
    const { data } = await get(`/api/team/${teamId}/status`);
    assert(data.ok && data.all_submitted === true, `all_submitted=${data.all_submitted}`);
    console.log(`        status=${data.status} phase=${data.phase}`);
  });

  // 6. 提交汇总
  await step("6. GET /api/team/:id/submissions", async () => {
    const { data } = await get(`/api/team/${teamId}/submissions`);
    assert(data.ok && data.submissions?.length === TEAM_SIZE, `len=${data.submissions?.length}`);
  });

  // 7-11. VP Phase3 (LLM 依赖)
  if (SKIP_LLM) {
    skip("7. Phase3 submit-vp", "DeepSeek API");
    skip("8. Phase3 chat", "DeepSeek API");
    skip("9. Phase3 finalize", "DeepSeek API");
    skip("10. Phase4 result", "depends on finalize");
    skip("11. freeze target_gm", "depends on finalize");
  } else {
    await step("7. POST /api/team/:id/phase3/submit-vp", async () => {
      const { status, data } = await post(`/api/team/${teamId}/phase3/submit-vp`, {
        round: 1,
        grid_id: "B2C_Differentiation_Adult", architecture: "Experience",
        channel_pref: { channel1: "DIRECT", channel2: "ECOMMERCE", share1: 60 },
        who: "25-35\u5C81\u72EC\u5C45\u767D\u9886",
        pain: "\u4E0B\u73ED\u56DE\u5BB6\u5B64\u72EC\uFF0C\u7F3A\u5C11\u60C5\u611F\u966A\u4F34",
        how: "LOVOT \u901A\u8FC7\u60C5\u7EEA\u8BC6\u522B\u63D0\u4F9B\u6E29\u6696\u966A\u4F34",
      });
      assert(status === 200 && data.ok, `${status} ${data.error || ""}`);
    });

    await step("8. POST /api/team/:id/phase3/chat", async () => {
      const { status, data } = await post(`/api/team/${teamId}/phase3/chat`, {
        message: "\u6211\u60F3\u7784\u51C6\u4E00\u7EBF\u57CE\u5E02\u72EC\u5C45\u767D\u9886",
      });
      assert(status === 200 && data.ok, `${status} ${data.error || ""}`);
    });

    await step("9. POST /api/team/:id/phase3/finalize", async () => {
      const { status, data } = await post(`/api/team/${teamId}/phase3/finalize`, {
        confirmed_grid_id: "B2C_Differentiation_Adult",
        confirmed_architecture: "Experience",
        channel_pref: { channel1: "DIRECT", channel2: "ECOMMERCE", share1: 60 },
      });
      assert(status === 200 && data.ok, `${status} ${data.error || ""}`);
    });

    await step("10. GET /api/team/:id/phase4", async () => {
      const { status, data } = await get(`/api/team/${teamId}/phase4`);
      assert(status === 200 && data.ok, `${status}`);
    });

    await step("11. POST /api/team/:id/freeze", async () => {
      const { status, data } = await post(`/api/team/${teamId}/freeze`, { target_gm: 0.35 });
      assert(status === 200 && data.ok, `${status} ${data.error || ""}`);
    });
  }

  // 12. VP Session (测试 sessions.js PG 迁移)
  await step("12. POST /api/vp/session (sessions.js PG)", async () => {
    const { status, data } = await post("/api/vp/session", {
      teamKey: teamId,
      strategy: { market: "ToC", competitive: "DIFF", segment: "ADULT", architecture: "Experience" },
    });
    assert(status === 200 && data.ok && data.sessionId, `${status} ${JSON.stringify(data)}`);
    console.log(`        sessionId=${data.sessionId}`);
  });

  // 13. DB Status
  await step("13. GET /api/db-status", async () => {
    const { data } = await get("/api/db-status");
    assert(data.ok, JSON.stringify(data));
    console.log(`        runs=${data.runCount} iters=${data.iterCount}`);
  });

  // 14. 防重复
  await step("14. \u91CD\u590D\u63D0\u4EA4\u62D2\u7EDD", async () => {
    const { status } = await post(`/api/team/${teamId}/phase1/${members[0].id}/submit`, {
      grid_id: "B2C_Differentiation_Adult", architecture: "Experience",
      who: "x", pain: "x", how: "x",
    });
    assert(status === 400, `\u671F\u671B 400\uFF0C\u5B9E\u9645 ${status}`);
  });

  // 15. 404
  await step("15. \u4E0D\u5B58\u5728\u7684 team -> 404", async () => {
    const { status } = await get("/api/team/nonexistent_12345");
    assert(status === 404, `\u671F\u671B 404\uFF0C\u5B9E\u9645 ${status}`);
  });

  // 清理
  console.log("\n\uD83E\uDDF9 \u6E05\u7406\u6D4B\u8BD5\u6570\u636E...");
  try {
    const { Pool } = require("pg");
    const pool = new Pool();
    await pool.query(`DELETE FROM member_submissions WHERE team_id=$1`, [teamId]);
    await pool.query(`DELETE FROM jinang_settlements WHERE team_id=$1`, [teamId]);
    await pool.query(`DELETE FROM team_members WHERE team_id=$1`, [teamId]);
    await pool.query(`DELETE FROM vp_sessions WHERE team_key=$1`, [teamId]);
    await pool.query(`DELETE FROM teams WHERE id=$1`, [teamId]);
    await pool.end();
    console.log("  \u2705 \u5DF2\u6E05\u7406");
  } catch (e) {
    console.log(`  \u26A0\uFE0F  \u81EA\u52A8\u6E05\u7406\u5931\u8D25\uFF08teamId=${teamId}\uFF09: ${e.message}`);
  }

  // 汇总
  console.log(`\n${"=".repeat(50)}`);
  console.log(`  \u2705 \u901A\u8FC7: ${passed}   \u274C \u5931\u8D25: ${failed}   \u23ED\uFE0F  \u8DF3\u8FC7: ${skipped}`);
  console.log(`${"=".repeat(50)}\n`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(e => { console.error(e); process.exit(1); });
