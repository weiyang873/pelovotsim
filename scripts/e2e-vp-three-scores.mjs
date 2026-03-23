import fs from "node:fs";
import path from "node:path";

const BASE = process.env.BASE_URL || "http://127.0.0.1:8787";
const OUTPUT_DIR = process.env.OUTPUT_DIR || "artifacts/vp-three-scores";
const CASE_FILTER = String(process.env.CASE_FILTER || "").trim();

const CASES = [
  {
    id: "broad_vague",
    teamName: "vp_three_scores_broad_vague",
    gridId: "toc_diff_adult",
    architecture: "Experience",
    rounds: [
      {
        who: "年轻白领用户",
        pain: "下班后会感到孤独，希望有人陪伴，现有方式不够好",
        how: "LOVOT 用 AI 陪伴和互动让他们感觉更温暖"
      },
      {
        who: "刚搬到新城市、独自租房的年轻白领",
        pain: "每个工作日晚上回到出租屋时，家里很安静，和朋友聊天也很难及时得到回应，手机和短视频只能打发时间，没法缓解回家那一刻的空落感",
        how: "LOVOT 会主动靠近、互动和迎接，让他们下班回家时不再直接掉进安静和空房间里，而是先被接住"
      },
      {
        who: "刚搬到新城市、独自租房的年轻白领",
        pain: "每个工作日晚上回到出租屋时，家里黑灯安静、没有任何回应。朋友各有节奏，聊天回复不稳定，刷手机只能分散注意力，接不住那种持续重复的空落感",
        how: "LOVOT 会在他们开门回家时主动靠近、发出回应并持续互动，把最难受的回家片刻变成有人在等的状态；它能补上日常陪伴，但不能替代真正的人际关系和深度情感支持"
      }
    ]
  },
  {
    id: "specific_mid",
    teamName: "vp_three_scores_specific_mid",
    gridId: "toc_diff_adult",
    architecture: "Experience",
    rounds: [
      {
        who: "深夜刚落地、独自办理入住的商务住客",
        pain: "排队等入住时会越来越烦躁，前台处理得慢，等候体验很差",
        how: "LOVOT 在等待的时候陪着他们，让他们心情好一点"
      },
      {
        who: "深夜航班落地后独自入住连锁酒店的商务住客",
        pain: "每次深夜排队办理入住时，他们都已经很疲惫，前台一旦遇到证件、房态或发票问题就会卡住，等待区没有任何稳定情绪的办法，刷手机也只会让人更烦",
        how: "LOVOT 会在等待区主动靠近、互动和陪伴，把注意力从漫长等待里拉出来，让住客在最疲惫的时候先缓下来"
      },
      {
        who: "深夜航班落地后独自入住连锁酒店的商务住客",
        pain: "每次深夜排队办理入住时，他们都已经很疲惫，前台只要遇到证件、房态或发票异常，队伍就会停住。等待区通常只能靠手机、电视或员工口头安抚，但这些方式都没有持续互动，很难把情绪真正稳住",
        how: "LOVOT 会在等待区主动靠近、持续互动和情绪陪伴，把住客从烦躁里先拉下来，让等待不再只是被动消耗；但它不适合处理需要赔偿、升级房型或复杂投诉的场景"
      }
    ]
  },
  {
    id: "strong_complete",
    teamName: "vp_three_scores_strong_complete",
    gridId: "toc_diff_adult",
    architecture: "Experience",
    rounds: [
      {
        who: "深夜刚落地、独自入住的高频商务住客",
        pain: "长途出差后排队入住会让人很烦躁，如果前台卡在异常处理上，等待体验会更差",
        how: "LOVOT 在等待区主动互动，让住客别一直盯着队伍和时间"
      },
      {
        who: "深夜刚落地、独自入住连锁酒店的高频商务住客",
        pain: "每次深夜入住高峰，他们都已经很疲惫，前台只要卡在证件、房态或发票异常上，等待时间就会被放大。现有做法通常只是让住客自己刷手机、看电视或被动等候，情绪会继续往下掉",
        how: "LOVOT 会在等待区主动靠近、互动和情绪陪伴，把最难熬的等待片刻从单纯消耗变成有人回应的过程，让住客先从烦躁里缓下来"
      },
      {
        who: "深夜刚落地、独自入住连锁酒店的高频商务住客",
        pain: "这类住客每次深夜入住高峰都已经处在疲惫和时间焦虑里，前台只要卡在证件、房态或发票异常上，队伍就会停住。酒店通常只能靠住客自己刷手机、看电视或员工口头安抚，但这些方式缺少持续互动，无法稳定地接住情绪",
        how: "LOVOT 会在等待区主动靠近、持续互动和情绪陪伴，把住客从烦躁和失控边缘先拉下来，让等待过程变成有人在回应而不是单纯消耗；它能补足日常等待体验，但不适合处理赔偿、房型争议或复杂投诉"
      }
    ]
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

function fmt(value) {
  return value == null ? "" : String(value);
}

function scoreTuple(scores) {
  if (!scores) return "n/a";
  return `C ${scores.coverage} | G ${scores.generalizability} | E ${scores.effectiveness}`;
}

function buildTranscript(result) {
  const lines = [];
  lines.push(`CASE: ${result.id}`);
  lines.push(`TEAM_ID: ${result.teamId}`);
  result.rounds.forEach((round, idx) => {
    lines.push(`ROUND_${idx + 1}_WHO: ${round.who}`);
    lines.push(`ROUND_${idx + 1}_PAIN: ${round.pain}`);
    lines.push(`ROUND_${idx + 1}_HOW: ${round.how}`);
    lines.push(`ROUND_${idx + 1}_SCORE: ${scoreTuple(round.score.scores)}`);
    lines.push(`ROUND_${idx + 1}_SCORE_VALID: ${round.score.scoreValid}`);
    lines.push(`ROUND_${idx + 1}_SCORE_FEEDBACK: ${round.score.coachReply}`);
    lines.push("");
  });
  lines.push("CONVERSATION:");
  for (const item of result.coachHistory) {
    const role = item.role === "coach" ? "COACH" : "USER";
    lines.push(`[${role}] ${String(item.text || "").trim()}`);
    lines.push("");
  }
  return lines.join("\n").trim() + "\n";
}

function csvEscape(value) {
  const text = String(value ?? "");
  if (!/[",\n]/.test(text)) return text;
  return `"${text.replace(/"/g, "\"\"")}"`;
}

function buildCsv(results) {
  const header = [
    "case_id",
    "team_id",
    "round1_C", "round1_G", "round1_E",
    "round2_C", "round2_G", "round2_E",
    "round3_C", "round3_G", "round3_E",
    "round1_valid",
    "round2_valid",
    "round3_valid",
    "transcript_path"
  ];
  const rows = results.map((result) => {
    const s1 = result.rounds[0]?.score?.scores || {};
    const s2 = result.rounds[1]?.score?.scores || {};
    const s3 = result.rounds[2]?.score?.scores || {};
    return [
      result.id,
      result.teamId,
      fmt(s1.coverage), fmt(s1.generalizability), fmt(s1.effectiveness),
      fmt(s2.coverage), fmt(s2.generalizability), fmt(s2.effectiveness),
      fmt(s3.coverage), fmt(s3.generalizability), fmt(s3.effectiveness),
      String(Boolean(result.rounds[0]?.score?.scoreValid)),
      String(Boolean(result.rounds[1]?.score?.scoreValid)),
      String(Boolean(result.rounds[2]?.score?.scoreValid)),
      result.transcriptPath
    ].map(csvEscape).join(",");
  });
  return [header.join(","), ...rows].join("\n") + "\n";
}

async function runCase(input) {
  const create = await request("/api/team/create", {
    method: "POST",
    body: JSON.stringify({ teamName: `${input.teamName}_${Date.now()}`, teamSize: 1 })
  });
  ensure(create.status === 200 && create.body?.ok, `create failed: HTTP ${create.status}`);
  const teamId = create.body.team.id;

  const rounds = [];
  for (let i = 0; i < input.rounds.length; i += 1) {
    const draft = input.rounds[i];
    const payload = {
      grid_id: input.gridId,
      architecture: input.architecture,
      who: draft.who,
      pain: draft.pain,
      how: draft.how
    };

    const chat = await request(`/api/team/${teamId}/phase3/chat`, {
      method: "POST",
      body: JSON.stringify({
        ...payload,
        message: `这是我第${i + 1}版的价值主张，请继续帮我收敛。\nWHO：${draft.who}\nPAIN：${draft.pain}\nHOW：${draft.how}`
      })
    });
    ensure(chat.status === 200 && chat.body?.ok, `chat round ${i + 1} failed: HTTP ${chat.status}`);

    const score = await request(`/api/team/${teamId}/phase3/submit-vp`, {
      method: "POST",
      body: JSON.stringify({ mode: "score", ...payload })
    });
    ensure(score.status === 200 && score.body?.ok, `score round ${i + 1} failed: HTTP ${score.status}`);

    rounds.push({
      ...draft,
      chatReply: String(chat.body?.coach_reply || "").replace(/\s+/g, " ").trim(),
      score: {
        scoreValid: Boolean(score.body?.score_valid),
        scores: score.body?.scores || null,
        coachReply: String(score.body?.coach_reply || "").replace(/\s+/g, " ").trim()
      }
    });
  }

  const state = await request(`/api/team/${teamId}/phase3/state`);
  ensure(state.status === 200 && state.body?.ok, `phase3 state failed: HTTP ${state.status}`);

  return {
    id: input.id,
    teamId,
    rounds,
    coachHistory: Array.isArray(state.body?.coach_history) ? state.body.coach_history : []
  };
}

async function main() {
  const health = await request("/api/health");
  ensure(health.status === 200 && health.body?.ok, `health failed: HTTP ${health.status}`);

  fs.mkdirSync(path.resolve(OUTPUT_DIR), { recursive: true });

  const selectedCases = CASE_FILTER
    ? CASES.filter((entry) => entry.id === CASE_FILTER)
    : CASES;
  ensure(selectedCases.length > 0, `no cases matched CASE_FILTER=${CASE_FILTER}`);

  const results = [];
  for (const entry of selectedCases) {
    const result = await runCase(entry);
    const transcriptPath = path.resolve(OUTPUT_DIR, `${result.id}.txt`);
    fs.writeFileSync(transcriptPath, buildTranscript(result), "utf8");
    result.transcriptPath = transcriptPath;
    results.push(result);
  }

  const csvPath = path.resolve(OUTPUT_DIR, "results.csv");
  fs.writeFileSync(csvPath, buildCsv(results), "utf8");

  console.log(`BASE_URL=${BASE}`);
  console.log(`CSV=${csvPath}`);
  for (const result of results) {
    console.log(`\n[${result.id}]`);
    result.rounds.forEach((round, idx) => {
      console.log(`round${idx + 1}=${scoreTuple(round.score.scores)} valid=${round.score.scoreValid}`);
    });
    console.log(`transcript=${result.transcriptPath}`);
  }

  console.log("\nJSON_SUMMARY");
  console.log(JSON.stringify({ csvPath, results }, null, 2));
}

main().catch((err) => {
  console.error(err.message || String(err));
  process.exit(1);
});
