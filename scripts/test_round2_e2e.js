"use strict";

/**
 * Round 1 + Round 2 multiplayer end-to-end test
 *
 * Usage:
 *   1. node server.js
 *   2. node scripts/test_round2_e2e.js
 *
 * Optional env:
 *   BASE_URL=http://127.0.0.1:8787
 */

const BASE = process.env.BASE_URL || "http://127.0.0.1:8787";
const TEAM_SIZE = 4;
const ROUND1_GRID_ID = "ToB_Differentiation_Elder";
const ROUND1_ARCHITECTURE = "Experience";
const FINAL_PRICE = 14999;
const MARKETING_MEMBER_COUNT = 3;

const ROUND1_DRAFT = {
  who: "高端养老机构的院长与采购负责人，核心使用者是需要陪伴和异常提醒的高龄老人。",
  pain: "老人独处时缺乏稳定陪伴，出现情绪波动或异常状况时，机构无法做到持续主动发现与及时响应。",
  how: "LOVOT 通过自然陪伴、状态感知和异常提醒，在不显著增加护工负担的前提下提升老人安全感与机构服务质量。"
};

const MARKETING_QUESTIONS = [
  "这类老人最容易感到不舒服或者焦虑的时刻是什么时候？",
  "如果让你决定是否采购这款机器人，你最在意它必须做到什么？",
  "你能接受它在哪些方面做得简单一些，但绝对不能出问题？"
];

const MEMBER_SELECTIONS = [
  [
    { cap_id: "voice_basic", tier: "mid" },
    { cap_id: "privacy_trust", tier: "mid" }
  ],
  [
    { cap_id: "perception_base", tier: "mid" },
    { cap_id: "family_guardian", tier: "mid" }
  ],
  [
    { cap_id: "basic_avoidance", tier: "mid" },
    { cap_id: "connect_base", tier: "mid" }
  ],
  [
    { cap_id: "cloud_update", tier: "mid" },
    { cap_id: "remote_diagnostics", tier: "low" }
  ]
];

function fail(message) {
  throw new Error(message);
}

function check(condition, message) {
  if (!condition) fail(message);
}

function parseJson(text, label) {
  try {
    return JSON.parse(text);
  } catch (err) {
    fail(`${label} 返回的不是合法 JSON: ${err.message}`);
  }
}

async function request(method, pathname, body, label) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60000);

  try {
    const res = await fetch(`${BASE}${pathname}`, {
      method,
      headers: body ? { "Content-Type": "application/json" } : {},
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal
    });
    const text = await res.text();
    const data = parseJson(text || "{}", label);
    check(res.status === 200, `${label} HTTP ${res.status}`);
    check(data && typeof data === "object", `${label} 返回体不是 JSON object`);
    return data;
  } catch (err) {
    if (err.name === "AbortError") {
      fail(`${label} 超时`);
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

function get(pathname, label) {
  return request("GET", pathname, null, label);
}

function post(pathname, body, label) {
  return request("POST", pathname, body, label);
}

function parseVpSummary(vpText) {
  const read = (key) => {
    const match = String(vpText || "").match(new RegExp(`${key}\\s*[：:]\\s*([^\\n]+)`));
    return match ? match[1].trim() : "";
  };

  return {
    who: read("WHO"),
    pain: read("PAIN"),
    how: read("HOW")
  };
}

function buildMarketingStrategy(round1Context) {
  const gridId = String(round1Context?.grid_id || "");
  const architecture = String(round1Context?.architecture || "");
  const parts = gridId.split("_");
  const customerRaw = String(parts[0] || "").toUpperCase();
  const strategyRaw = String(parts[1] || "").toUpperCase();
  const segmentRaw = String(parts[2] || "").toUpperCase();

  const market = customerRaw === "TOB" || customerRaw === "B2B" ? "ToB" : "ToC";
  const competitive = strategyRaw.includes("COST") ? "成本领先" : "差异化";
  const segment = segmentRaw.includes("CHILD") ? "儿童" : segmentRaw.includes("ELDER") ? "老人" : "成人";
  const arch = architecture.toLowerCase() === "hybrid"
    ? "混合"
    : architecture.toLowerCase() === "function"
      ? "功能"
      : "体验";

  return {
    market,
    competitive,
    segment,
    architecture: arch,
    grid_id: gridId
  };
}

function buildMarketingCanvas(round1Context) {
  const summary = round1Context?.vp_summary || parseVpSummary(round1Context?.vp_text || "");
  const who = String(summary?.who || "").trim() || ROUND1_DRAFT.who;
  const pain = String(summary?.pain || "").trim() || ROUND1_DRAFT.pain;
  const how = String(summary?.how || "").trim() || ROUND1_DRAFT.how;

  return {
    customerJobs: who,
    pains: pain,
    gains: how,
    products: "LOVOT 陪伴型机器人",
    painRelievers: how,
    gainCreators: how
  };
}

async function createRound1CompletedTeam() {
  const teamName = `round2_e2e_${Date.now()}`;

  const createRes = await post("/api/team/create", { teamName, teamSize: TEAM_SIZE }, "Round1 建组");
  check(createRes.ok === true, "Round1 建组返回 ok=false");

  const teamId = createRes.team?.id;
  const members = Array.isArray(createRes.team?.members) ? createRes.team.members : [];
  check(teamId, "Round1 建组缺少 teamId");
  check(members.length === TEAM_SIZE, `Round1 team members=${members.length}，期望 ${TEAM_SIZE}`);

  for (let i = 0; i < members.length; i += 1) {
    const memberId = members[i]?.id;
    check(memberId, `Round1 成员 ${i + 1} 缺少 id`);

    const submitRes = await post(
      `/api/team/${encodeURIComponent(teamId)}/phase1/${encodeURIComponent(memberId)}/submit`,
      {
        grid_id: ROUND1_GRID_ID,
        architecture: ROUND1_ARCHITECTURE,
        who: ROUND1_DRAFT.who,
        pain: ROUND1_DRAFT.pain,
        how: ROUND1_DRAFT.how
      },
      `Round1 成员 ${i + 1} 提交`
    );
    check(submitRes.ok === true, `Round1 成员 ${i + 1} 提交返回 ok=false`);
  }

  const finalizeRes = await post(
    `/api/team/${encodeURIComponent(teamId)}/phase3/finalize`,
    {
      grid_id: ROUND1_GRID_ID,
      architecture: ROUND1_ARCHITECTURE,
      scores: {
        coverage: 4.2,
        generalizability: 3.9,
        effectiveness: 4.3
      },
      vp_result: {
        who: ROUND1_DRAFT.who,
        pain: ROUND1_DRAFT.pain,
        how: ROUND1_DRAFT.how,
        boundary: "聚焦养老机构场景，不覆盖医疗级诊断"
      }
    },
    "Round1 finalize"
  );
  check(finalizeRes.ok === true, "Round1 finalize 返回 ok=false");
  check(finalizeRes.status === "phase4", `Round1 finalize status=${finalizeRes.status}，期望 phase4`);

  const freezeRes = await post(`/api/team/${encodeURIComponent(teamId)}/freeze`, {}, "Round1 freeze");
  check(freezeRes.ok === true, "Round1 freeze 返回 ok=false");
  check(freezeRes.status === "frozen", `Round1 freeze status=${freezeRes.status}，期望 frozen`);

  return { teamId, members };
}

async function main() {
  await get("/api/health", "健康检查");

  const { teamId, members } = await createRound1CompletedTeam();

  console.log("[1/8] GET /api/round2/state");
  const state = await get(
    `/api/round2/state?teamId=${encodeURIComponent(teamId)}&memberId=${encodeURIComponent(members[0].id)}`,
    "Round2 state"
  );
  check(state.ok === true, "/api/round2/state 返回 ok=false");
  check(state.round1_context && typeof state.round1_context === "object", "state 缺少 round1_context");
  check(String(state.round1_context.grid_id || "").length > 0, "state.round1_context.grid_id 为空");
  check(String(state.round1_context.architecture || "").length > 0, "state.round1_context.architecture 为空");
  check(String(state.round1_context.vp_text || "").length > 0, "state.round1_context.vp_text 为空");
  check(Array.isArray(state.member?.dims) && state.member.dims.length > 0, "state.member.dims 为空");

  const strategy = buildMarketingStrategy(state.round1_context);
  const vpCanvas = buildMarketingCanvas(state.round1_context);

  console.log("[2/8] POST /api/marketing/start");
  const marketingMembers = members.slice(0, MARKETING_MEMBER_COUNT);
  const sessions = [];
  for (let i = 0; i < marketingMembers.length; i += 1) {
    const member = marketingMembers[i];
    const startRes = await post(
      "/api/marketing/start",
      {
        teamKey: teamId,
        memberId: member.id,
        strategy,
        vpCanvas
      },
      `Marketing start ${i + 1}`
    );
    check(startRes.ok === true, `Marketing start ${i + 1} 返回 ok=false`);
    check(String(startRes.sessionId || "").length > 0, `Marketing start ${i + 1} 缺少 sessionId`);
    check(String(startRes.persona || "").trim().length > 0, `Marketing start ${i + 1} persona 为空`);
    sessions.push({ memberId: member.id, sessionId: startRes.sessionId });
  }

  console.log("[3/8] POST /api/marketing/interview");
  for (let i = 0; i < sessions.length; i += 1) {
    for (let round = 0; round < MARKETING_QUESTIONS.length; round += 1) {
      const interviewRes = await post(
        "/api/marketing/interview",
        {
          sessionId: sessions[i].sessionId,
          message: MARKETING_QUESTIONS[round]
        },
        `Marketing interview member ${i + 1} round ${round + 1}`
      );
      check(interviewRes.ok === true, `Marketing interview member ${i + 1} round ${round + 1} 返回 ok=false`);
      check(String(interviewRes.reply || "").trim().length > 0, `Marketing interview member ${i + 1} round ${round + 1} reply 为空`);
    }
  }

  console.log("[4/8] POST /api/marketing/end-interview");
  for (let i = 0; i < sessions.length; i += 1) {
    const endRes = await post(
      "/api/marketing/end-interview",
      { sessionId: sessions[i].sessionId },
      `Marketing end-interview ${i + 1}`
    );
    check(endRes.ok === true, `Marketing end-interview ${i + 1} 返回 ok=false`);
    check(String(endRes.summary || "").trim().length > 0, `Marketing end-interview ${i + 1} summary 为空`);
    check(endRes.scores && typeof endRes.scores === "object", `Marketing end-interview ${i + 1} 缺少 scores`);
  }

  console.log("[5/8] GET /api/marketing/team-summary");
  const teamSummary = await get(
    `/api/marketing/team-summary?teamKey=${encodeURIComponent(teamId)}`,
    "Marketing team-summary"
  );
  check(teamSummary.ok === true, "Marketing team-summary 返回 ok=false");
  check(teamSummary.ready === true, "Marketing team-summary ready 不是 true");
  check(teamSummary.mergedScores && typeof teamSummary.mergedScores === "object", "Marketing team-summary 缺少 mergedScores");
  check(Array.isArray(teamSummary.summaries) && teamSummary.summaries.length === MARKETING_MEMBER_COUNT, "Marketing team-summary summaries 数量异常");

  console.log("[6/8] POST /api/round2/individual-submit");
  for (let i = 0; i < members.length; i += 1) {
    const selectionRes = await post(
      "/api/round2/individual-submit",
      {
        teamId,
        memberId: members[i].id,
        selections: MEMBER_SELECTIONS[i]
      },
      `Round2 individual-submit ${i + 1}`
    );
    check(selectionRes.ok === true, `Round2 individual-submit ${i + 1} 返回 ok=false`);
    check(Number(selectionRes.count) === MEMBER_SELECTIONS[i].length, `Round2 individual-submit ${i + 1} count=${selectionRes.count}，期望 ${MEMBER_SELECTIONS[i].length}`);
  }

  console.log("[7/8] GET /api/round2/team-merge");
  const teamMerge = await get(
    `/api/round2/team-merge?teamId=${encodeURIComponent(teamId)}`,
    "Round2 team-merge"
  );
  check(teamMerge.ok === true, "Round2 team-merge 返回 ok=false");
  check(Array.isArray(teamMerge.teamSelections), "Round2 team-merge 缺少 teamSelections");
  check(Number(teamMerge.card_count) >= 8 && Number(teamMerge.card_count) <= 10, `合并后卡数=${teamMerge.card_count}，期望 8-10`);
  check(Number.isFinite(Number(teamMerge.total_cost)), `合并后 total_cost 非数字: ${teamMerge.total_cost}`);

  console.log("[8/8] POST /api/round2/team-submit");
  check(FINAL_PRICE >= 5000 && FINAL_PRICE <= 20000, `测试定价=${FINAL_PRICE}，超出 5000-20000`);
  const teamSubmit = await post(
    "/api/round2/team-submit",
    {
      teamId,
      price: FINAL_PRICE,
      selections: teamMerge.teamSelections,
      radar: teamSummary.mergedScores,
      evi: 0.7,
      bestGrid: state.round1_context.grid_id
    },
    "Round2 team-submit"
  );
  check(teamSubmit.ok === true, "Round2 team-submit 返回 ok=false");
  check(teamSubmit.result && typeof teamSubmit.result === "object", "Round2 team-submit 缺少 result");

  console.log("✅ Round 1 + Round 2 全链路通过");
}

main().catch((err) => {
  console.error(`❌ ${err.message}`);
  process.exit(1);
});
