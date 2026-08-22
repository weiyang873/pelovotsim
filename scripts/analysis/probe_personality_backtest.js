"use strict";
// Personality back-test (paper T7a): an LLM judge reads ONLY a persona's biography (or ONLY the persona's
// spoken R1 lines) and rates the 8 fingerprint dims in [0,1]; compared with the assigned fingerprint
// by Pearson r and same-side-of-median agreement. Output: raw judge jsonl + summary csv.
// Usage: node scripts/analysis/probe_personality_backtest.js [--pool=...] [--speech-batches=dir1,dir2] [--out=dir]
const fs = require("node:fs"); const path = require("node:path");
const ROOT = path.join(__dirname, "..", "..");
const args = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, "").split("=")));
function loadEnv() { const p = path.join(ROOT, ".env"); if (!fs.existsSync(p)) return; for (const line of fs.readFileSync(p, "utf8").split(/\r?\n/)) { const t = line.trim(); if (!t || t.startsWith("#")) continue; const i = t.indexOf("="); if (i <= 0) continue; const k = t.slice(0, i).trim(); let v = t.slice(i + 1).trim(); if (/^["'].*["']$/.test(v)) v = v.slice(1, -1); if (!(k in process.env)) process.env[k] = v; } }
const DIMS = [["maximizing_satisficing", "Maximizing (vs satisficing)", "追求最优解、反复比较而不是够用就行"], ["need_for_cognition", "Need for cognition", "喜欢深入思考、享受复杂问题"], ["actively_open_minded_thinking", "Actively open-minded thinking", "主动寻找反证、愿意改变自己的看法"], ["risk_propensity_business", "Business risk propensity", "商业决策上敢冒风险"], ["ambiguity_tolerance", "Ambiguity tolerance", "能在信息不全、模糊的情况下行动而不焦虑"], ["regulatory_focus_promotion", "Promotion focus", "关注收益与成长（促进导向），而非规避损失"], ["consideration_future_consequences", "Consideration of future consequences", "看重长远后果胜过眼前"], ["action_orientation", "Action orientation", "倾向先做起来而不是等想清楚"]];
const WT = "/Users/weiyang/worktrees/emba-ai-sim-v01-claude";
const poolPath = path.resolve(ROOT, args.pool || "data/task_blind_persona_pipeline_v1/r1_pool42_20260812/persona_pool_task_blind_narrative_v1.json");
const batches = (args["speech-batches"] || [1, 2, 3, 4, 5].map((i) => `${WT}/runs_v4flash_0731/team_pilot/teamr1_cap24_rep${i}_20260815`).join(",")).split(",");
const outDir = path.resolve(ROOT, args.out || "runs_v4flash_0731/probes/personality_backtest_20260822"); fs.mkdirSync(outDir, { recursive: true });
const pool = JSON.parse(fs.readFileSync(poolPath, "utf8"));
const speech = new Map();
for (const b of batches) { if (!fs.existsSync(b)) continue; for (const d of fs.readdirSync(b)) { const p = path.join(b, d, "r1_transcript.json"); if (!fs.existsSync(p)) continue; for (const it of JSON.parse(fs.readFileSync(p, "utf8")).transcript || []) { if (!/^TBN/.test(it.speaker)) continue; if (!speech.has(it.speaker)) speech.set(it.speaker, []); speech.get(it.speaker).push(String(it.text).replace(/\s+/g, " ").trim()); } } }
function msgs(kind, text) {
  return [{ role: "system", content: "你是人格测评员。只根据给出的材料，对这个人在 8 个特质上的位置打分，0=极低，1=极高，0.5=一般人水平。材料没有直接信息时按你的最佳推断给分，不要全写 0.5。只输出可 JSON.parse 的 JSON。" },
    { role: "user", content: [kind === "bio" ? "【这个人的小传】" : "【这个人在一次小组讨论里说过的话（按时间顺序）】", text, "", "特质：", ...DIMS.map(([k, n, z]) => `- ${k}：${n}，${z}`), "", `只输出：{${DIMS.map(([k]) => `"${k}":0到1的小数`).join(",")}}`].join("\n") }];
}
function parse(raw) { const t = String(raw || "").replace(/^```(?:json)?/i, "").replace(/```$/, "").trim(); try { return JSON.parse(t); } catch { const m = t.match(/\{[\s\S]*\}/); return m ? JSON.parse(m[0]) : null; } }
async function mapLimit(items, limit, fn) { const out = new Array(items.length); let next = 0; await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => { while (next < items.length) { const i = next++; out[i] = await fn(items[i], i); } })); return out; }
const pearson = (x, y) => { const n = x.length, mx = x.reduce((a, b) => a + b, 0) / n, my = y.reduce((a, b) => a + b, 0) / n; let sxy = 0, sxx = 0, syy = 0; for (let i = 0; i < n; i++) { sxy += (x[i] - mx) * (y[i] - my); sxx += (x[i] - mx) ** 2; syy += (y[i] - my) ** 2; } return sxx && syy ? sxy / Math.sqrt(sxx * syy) : 0; };
const median = (v) => { const s = [...v].sort((a, b) => a - b); return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2; };
async function main() {
  loadEnv(); const { chatCompletion } = require("../../server/llm/deepseekClient");
  const rawPath = path.join(outDir, "judge_raw.jsonl"); fs.writeFileSync(rawPath, "");
  const jobs = []; for (const r of pool) { jobs.push({ id: r.persona_id, kind: "bio", text: r.biography }); const s = speech.get(r.persona_id) || []; if (s.length) jobs.push({ id: r.persona_id, kind: "speech", text: s.map((l) => `- ${l}`).join("\n"), n_lines: s.length }); }
  console.log(`personas ${pool.length}, jobs ${jobs.length}`);
  const res = await mapLimit(jobs, Number(args.concurrency || 6), async (j, i) => { let parsed = null, err = null; for (let a = 0; a < 3 && !parsed; a++) { try { const raw = await chatCompletion(msgs(j.kind, j.text), { role: "chat_service", temperature: 0.1, max_tokens: 400, timeoutMs: 120000, response_format: { type: "json_object" } }); parsed = parse(raw); if (parsed && DIMS.some(([k]) => typeof parsed[k] !== "number")) parsed = null; } catch (e) { err = String(e && e.message || e); } } const row = { persona_id: j.id, kind: j.kind, n_lines: j.n_lines, rating: parsed, error: parsed ? null : err }; fs.appendFileSync(rawPath, JSON.stringify(row) + "\n"); process.stderr.write(`[${i + 1}/${jobs.length}] ${j.id} ${j.kind} ${parsed ? "ok" : "FAIL"}\n`); return row; });
  const fp = new Map(pool.map((r) => [r.persona_id, r.behavioral_fingerprint]));
  const lines = ["trait,n_bio,r_biography,binary_agreement_biography,n_speech,r_speech,binary_agreement_speech"]; const means = { rb: [], ab: [], rs: [], as: [] };
  for (const [k, name] of DIMS) {
    const stat = (kind) => { const rows = res.filter((r) => r.kind === kind && r.rating); const x = rows.map((r) => fp.get(r.persona_id)[k]), y = rows.map((r) => r.rating[k]); const mx = median(x), my = median(y); const agree = rows.length ? x.filter((v, i) => (v > mx) === (y[i] > my)).length / rows.length : 0; return { n: rows.length, r: pearson(x, y), agree }; };
    const b = stat("bio"), s = stat("speech"); means.rb.push(b.r); means.ab.push(b.agree); means.rs.push(s.r); means.as.push(s.agree);
    lines.push(`${name},${b.n},${b.r.toFixed(2)},${b.agree.toFixed(2)},${s.n},${s.r.toFixed(2)},${s.agree.toFixed(2)}`);
  }
  const m = (v) => (v.reduce((a, b) => a + b, 0) / v.length).toFixed(2);
  lines.push(`Mean,,${m(means.rb)},${m(means.ab)},,${m(means.rs)},${m(means.as)}`);
  fs.writeFileSync(path.join(outDir, "summary.csv"), lines.join("\n") + "\n"); console.log(lines.join("\n"));
}
main().catch((e) => { console.error(e); process.exit(1); });
