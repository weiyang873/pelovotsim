const BASE = process.env.BASE_URL || "http://127.0.0.1:8787";
const OUTPUT_DIR = process.env.OUTPUT_DIR || "artifacts/vp-e2e";

import fs from "node:fs";
import path from "node:path";

const CASES = [
  {
    id: "broad_vague",
    teamName: "vp_batch_broad_vague",
    gridId: "toc_diff_adult",
    architecture: "Experience",
    who: "年轻白领用户",
    pain: "下班后会感到孤独，希望有人陪伴，现有方式不够好",
    how: "LOVOT 用 AI 陪伴和互动让他们感觉更温暖"
  },
  {
    id: "specific_mid",
    teamName: "vp_batch_specific_mid",
    gridId: "toc_diff_adult",
    architecture: "Experience",
    who: "夜间值班的一线连锁酒店前台经理",
    pain: "夜间和入住高峰时，排队住客会越来越焦躁，前台要一边处理入住异常一边持续安抚情绪，主要靠员工硬撑",
    how: "LOVOT 在等待区主动互动和陪伴，先把住客情绪稳下来，让前台腾出注意力处理入住问题"
  },
  {
    id: "strong_complete",
    teamName: "vp_batch_strong_complete",
    gridId: "toc_diff_adult",
    architecture: "Experience",
    who: "夜间与高峰接待压力大的连锁酒店前台经理",
    pain: "夜间和入住高峰时，排队住客越来越焦躁，前台需要一边处理入住异常一边持续安抚情绪，现有做法只能靠员工硬撑，既容易失控也难以复制",
    how: "LOVOT 在等待区主动靠近、互动和情绪陪伴，先把住客从焦躁状态拉下来，让前台腾出注意力处理入住问题；但它不适合处理需要赔偿或复杂投诉的场景"
  }
];

async function request(pathname, options = {}) {
  const res = await fetch(`${BASE}${pathname}`, {
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options
  });
  const text = await res.text();
  let body = null;
  try {
    body = JSON.parse(text);
  } catch (_) {
    body = { raw: text };
  }
  return { status: res.status, body };
}

function ensure(condition, message) {
  if (!condition) throw new Error(message);
}

function scoreLine(scores) {
  if (!scores) return "n/a";
  return `C ${scores.coverage ?? "null"} | G ${scores.generalizability ?? "null"} | E ${scores.effectiveness ?? "null"}`;
}

function shorten(text, limit = 120) {
  const src = String(text || "").replace(/\s+/g, " ").trim();
  if (src.length <= limit) return src;
  return `${src.slice(0, limit - 1)}…`;
}

async function runCase(input) {
  const create = await request("/api/team/create", {
    method: "POST",
    body: JSON.stringify({ teamName: `${input.teamName}_${Date.now()}`, teamSize: 1 })
  });
  ensure(create.status === 200 && create.body?.ok, `create failed: HTTP ${create.status}`);
  const teamId = create.body.team.id;

  const chatMessage = `WHO：${input.who}\nPAIN：${input.pain}\nHOW：${input.how}`;

  const chat = await request(`/api/team/${teamId}/phase3/chat`, {
    method: "POST",
    body: JSON.stringify({
      grid_id: input.gridId,
      architecture: input.architecture,
      message: chatMessage
    })
  });
  ensure(chat.status === 200 && chat.body?.ok, `chat failed: HTTP ${chat.status}`);

  const score = await request(`/api/team/${teamId}/phase3/submit-vp`, {
    method: "POST",
    body: JSON.stringify({
      mode: "score",
      grid_id: input.gridId,
      architecture: input.architecture,
      who: input.who,
      pain: input.pain,
      how: input.how
    })
  });
  ensure(score.status === 200 && score.body?.ok, `score failed: HTTP ${score.status}`);

  const confirm = await request(`/api/team/${teamId}/phase3/submit-vp`, {
    method: "POST",
    body: JSON.stringify({
      mode: "confirm",
      grid_id: input.gridId,
      architecture: input.architecture,
      who: input.who,
      pain: input.pain,
      how: input.how
    })
  });
  ensure(confirm.status === 200 && confirm.body?.ok, `confirm failed: HTTP ${confirm.status}`);

  const finalize = await request(`/api/team/${teamId}/phase3/finalize`, {
    method: "POST",
    body: JSON.stringify({
      grid_id: input.gridId,
      architecture: input.architecture,
      vp_result: confirm.body?.vp_result || null,
      scores: confirm.body?.scores || null
    })
  });
  ensure(finalize.status === 200 && finalize.body?.ok, `finalize failed: HTTP ${finalize.status}`);

  const phase4 = await request(`/api/team/${teamId}/phase4`);
  ensure(phase4.status === 200 && phase4.body?.ok, `phase4 failed: HTTP ${phase4.status}`);

  const state = await request(`/api/team/${teamId}/phase3/state`);
  ensure(state.status === 200 && state.body?.ok, `phase3 state failed: HTTP ${state.status}`);

  return {
    id: input.id,
    teamId,
    scoreValid: Boolean(score.body?.score_valid),
    score: score.body?.scores || null,
    features: score.body?.features || null,
    scoreFeedback: score.body?.coach_reply || "",
    confirmVp: confirm.body?.vp_result || null,
    finalStatus: finalize.body?.status || null,
    wtpAdj: phase4.body?.r1_result?.WTPadj ?? null,
    eAdj: phase4.body?.r1_result?.Eadj ?? null,
    vpSummary: phase4.body?.vp_summary || null,
    coachHistory: state.body?.coach_history || []
  };
}

function buildTranscript(result) {
  const lines = [];
  lines.push(`CASE: ${result.id}`);
  lines.push(`TEAM_ID: ${result.teamId}`);
  lines.push(`SCORE_VALID: ${result.scoreValid}`);
  lines.push(`SCORES: ${scoreLine(result.score)}`);
  lines.push(`FINAL_STATUS: ${result.finalStatus}`);
  lines.push(`WTPADJ: ${result.wtpAdj}`);
  lines.push(`EADJ: ${result.eAdj}`);
  lines.push("");
  lines.push("FEATURES:");
  lines.push(JSON.stringify(result.features || {}, null, 2));
  lines.push("");
  lines.push("CONFIRM_VP:");
  lines.push(JSON.stringify(result.confirmVp || {}, null, 2));
  lines.push("");
  lines.push("PHASE4_VP_SUMMARY:");
  lines.push(JSON.stringify(result.vpSummary || {}, null, 2));
  lines.push("");
  lines.push("CONVERSATION:");
  for (const item of Array.isArray(result.coachHistory) ? result.coachHistory : []) {
    const role = item.role === "coach" ? "COACH" : "USER";
    lines.push(`[${role}] ${String(item.text || "").trim()}`);
    lines.push("");
  }
  return lines.join("\n").trim() + "\n";
}

async function main() {
  const health = await request("/api/health");
  ensure(health.status === 200 && health.body?.ok, `health failed: HTTP ${health.status}`);

  const results = [];
  for (const entry of CASES) {
    results.push(await runCase(entry));
  }

  fs.mkdirSync(path.resolve(OUTPUT_DIR), { recursive: true });
  for (const result of results) {
    const filePath = path.resolve(OUTPUT_DIR, `${result.id}.txt`);
    fs.writeFileSync(filePath, buildTranscript(result), "utf8");
    result.transcriptPath = filePath;
  }

  console.log(`BASE_URL=${BASE}`);
  for (const result of results) {
    console.log(`\n[${result.id}]`);
    console.log(`score_valid=${result.scoreValid}  ${scoreLine(result.score)}`);
    console.log(`final_status=${result.finalStatus}  WTPadj=${result.wtpAdj}  Eadj=${result.eAdj}`);
    console.log(`target_customer=${shorten(result.confirmVp?.target_customer || result.vpSummary?.who || "")}`);
    console.log(`feedback=${shorten(result.scoreFeedback, 180)}`);
    console.log(`transcript=${result.transcriptPath}`);
  }

  console.log("\nJSON_SUMMARY");
  console.log(JSON.stringify(results, null, 2));
}

main().catch((err) => {
  console.error(err.message || String(err));
  process.exit(1);
});
