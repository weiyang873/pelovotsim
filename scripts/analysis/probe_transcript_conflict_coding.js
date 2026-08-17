"use strict";
// Probe: LLM-code team transcripts (R1 actor-isolated public lines + R2 D4/D5 lines) for
// task conflict, relationship conflict, subgroup talk, coalitions, concessions. One call per
// team-round; output jsonl. Used to test faultline -> conflict in the frozen team R2 B data.
const fs = require("node:fs");
const path = require("node:path");
const ROOT = path.join(__dirname, "..", "..");
const POOL = path.join(ROOT, "data/task_blind_persona_pipeline_v1/r1_pool42_20260812/persona_pool_task_blind_narrative_v1.json");

function loadEnv() { const p = path.join(ROOT, ".env"); if (!fs.existsSync(p)) return; for (const line of fs.readFileSync(p, "utf8").split(/\r?\n/)) { const t = line.trim(); if (!t || t.startsWith("#")) continue; const i = t.indexOf("="); if (i <= 0) continue; const k = t.slice(0, i).trim(); let v = t.slice(i + 1).trim(); if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1); if (!(k in process.env)) process.env[k] = v; } }
function parseJson(raw) { const t = String(raw || "").replace(/^```(?:json)?/i, "").replace(/```$/, "").trim(); try { return JSON.parse(t); } catch { const m = t.match(/\{[\s\S]*\}/); return m ? JSON.parse(m[0]) : null; } }

function memberLines(dir, names) {
  const out = [];
  const r1 = JSON.parse(fs.readFileSync(path.join(dir, "r1_transcript.json"), "utf8"));
  for (const it of r1.transcript || []) if (names.has(it.speaker)) out.push(`[R1/${it.phase === "vp" ? "VP" : "选格"}] ${names.get(it.speaker)}：${String(it.text || "").replace(/\s+/g, " ").trim()}`);
  const r2 = JSON.parse(fs.readFileSync(path.join(dir, "r2_transcript.json"), "utf8"));
  for (const dp of r2.transcript || []) {
    const label = String(dp.decision_point || "");
    const tag = label.startsWith("cards_") ? "R2/选卡" : label.startsWith("price") ? "R2/定价" : null;
    if (!tag) continue;
    for (const it of dp.transcript || []) if (names.has(it.speaker)) out.push(`[${tag}] ${names.get(it.speaker)}：${String(it.text || "").replace(/\s+/g, " ").trim()}`);
  }
  return out;
}

function messages(lines, roster) {
  return [
    { role: "system", content: [
      "你是小组过程编码员。下面是一个五人小组两轮课堂讨论里成员说过的话（按时间顺序，已去掉屏幕/旁白）。请只根据这些话编码，不要推测没说出口的东西。",
      "定义：任务冲突=对方案/数字/取舍本身的分歧（Jehn 任务冲突）；关系冲突=针对人的不满、贬低、讽刺、不耐烦、翻旧账；让步=明确改口或接受别人的立场；子群话语=把成员按年龄/背景/职能/经历分成\"你们…/我们这些…\"的说法；联盟=讨论中稳定站在一起、互相接话支持的成员集合。",
      "只输出可 JSON.parse 的 JSON。"
    ].join("\n") },
    { role: "user", content: [
      `成员名单：${roster}`,
      "", "【发言】", ...lines, "",
      "只输出：{\"task_conflict\":1-5整数,\"relationship_conflict\":1-5整数,\"n_disagree\":明确反对/质疑别人立场的句数,\"n_concede\":让步句数,\"n_dismissive\":贬低或不耐烦的句数,\"subgroup_talk\":0或1,\"subgroup_examples\":[最多2条原句],\"coalitions\":[[成员名,...],...],\"dominant\":[主导讨论的成员名],\"silenced\":[几乎不说话或被无视的成员名],\"conflict_topic\":\"一句话说主要分歧点\"}"
    ].join("\n") }
  ];
}

async function mapLimit(items, limit, fn) { const out = new Array(items.length); let next = 0; await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => { while (next < items.length) { const i = next++; out[i] = await fn(items[i], i); } })); return out; }

async function main() {
  loadEnv();
  const { chatCompletion } = require("../../server/llm/deepseekClient");
  const args = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, "").split("=")));
  const batchDir = path.resolve(ROOT, args.batch || "/Users/weiyang/worktrees/emba-ai-sim-v01-claude/runs_v4flash_0731/team_r2_replay/team_r2_story3_B_rep1_20260816");
  const outPath = path.resolve(ROOT, args.out || `runs_v4flash_0731/probes/transcript_conflict_coding/${path.basename(batchDir)}.jsonl`);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  const pool = JSON.parse(fs.readFileSync(path.resolve(ROOT, args.pool || POOL), "utf8"));
  const nameOf = new Map(pool.map((r) => [r.persona_id, r.surface.name]));
  const batchDirs = String(args.batch || batchDir).split(",").map((b) => path.resolve(ROOT, b));
  const dirs = batchDirs.flatMap((bd) => fs.readdirSync(bd).map((d) => path.join(bd, d))).filter((d) => ["run_meta.json", "r1_transcript.json", "r2_transcript.json"].every((f) => fs.existsSync(path.join(d, f)))).slice(0, Number(args.limit || 999));
  fs.writeFileSync(outPath, "");
  await mapLimit(dirs, Number(args.concurrency || 6), async (dir, i) => {
    const meta = JSON.parse(fs.readFileSync(path.join(dir, "run_meta.json"), "utf8"));
    const names = new Map(meta.profile_ids.map((id) => [id, nameOf.get(id) || id]));
    const lines = memberLines(dir, names);
    const roster = meta.profile_ids.map((id) => `${names.get(id)}${id === meta.leader_id ? "（组长/操作网页的人）" : ""}`).join("、");
    let parsed = null, err = null;
    for (let a = 0; a < 3 && !parsed; a += 1) {
      try { const raw = await chatCompletion(messages(lines, roster), { role: "chat_service", temperature: 0.1, max_tokens: 1200, timeoutMs: 120000, response_format: { type: "json_object" } }); parsed = parseJson(raw); if (parsed && !("task_conflict" in parsed)) parsed = null; } catch (e) { err = String(e && e.message || e); }
    }
    const row = { seed: meta.seed, dir: path.basename(dir), leader_id: meta.leader_id, profile_ids: meta.profile_ids, n_lines: lines.length, chars: lines.join("\n").length, coding: parsed, error: parsed ? null : err };
    fs.appendFileSync(outPath, JSON.stringify(row) + "\n");
    process.stderr.write(`[${i + 1}/${dirs.length}] ${meta.seed.split(":").pop()} lines=${lines.length} ${parsed ? "ok" : "FAIL"}\n`);
  });
  console.log(JSON.stringify({ outPath: path.relative(ROOT, outPath), n: dirs.length }));
}
main().catch((e) => { console.error(e); process.exit(1); });
