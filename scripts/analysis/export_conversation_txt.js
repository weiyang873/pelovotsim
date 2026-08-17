"use strict";
// Export a team run (R1 + R2) as a plain-text conversation log, one file per team:
//   ===== R1 · 选格 =====
//   [许思远（组长）] 台词…
// Usage: node scripts/analysis/export_conversation_txt.js --dir=<team dir> [--pool=<pool json>] [--out=<file>] [--keep-stage=1]
const fs = require("node:fs");
const path = require("node:path");
const ROOT = path.join(__dirname, "..", "..");
const args = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, "").split("=")));
const dir = path.resolve(ROOT, args.dir);
const meta = JSON.parse(fs.readFileSync(path.join(dir, "run_meta.json"), "utf8"));
const poolPath = path.resolve(ROOT, args.pool || meta.profile_pool_source || "data/task_blind_persona_pipeline_v1/r1_pool42_20260812/persona_pool_task_blind_narrative_v1.json");
const pool = JSON.parse(fs.readFileSync(poolPath, "utf8"));
const rec = new Map(pool.map((r) => [r.persona_id, r]));
const keepStage = /^(1|true)$/.test(String(args["keep-stage"] || ""));
const name = (id) => { const r = rec.get(id); if (!r) return id; const s = r.surface || {}; const c = String(r.frozen_facts?.career_context || ""); const ind = (c.match(/所在行业为([^，,。；;]+)/) || [])[1] || s.industry || ""; return `${s.name || id}${id === meta.leader_id ? "（组长）" : ""}`; };
const clean = (t) => keepStage ? t : String(t).replace(/（(?![^）]*(点|拖|填|输入|按|选|勾|提交|鼠标|键盘|滑块|按钮|删|敲了一遍|重新敲))[^）]*）\s*/g, "").replace(/\s+/g, " ").trim();
const out = [];
out.push(`# ${meta.batch || ""} · ${meta.seed || ""}`);
out.push(`# 成员：${meta.profile_ids.map((id) => { const r = rec.get(id); const s = r?.surface || {}; const c = String(r?.frozen_facts?.career_context || ""); const ind = (c.match(/所在行业为([^，,。；;]+)/) || [])[1] || s.industry || ""; const fn = (c.match(/主要职能是([^，,。；;]+)/) || [])[1] || ""; return `${name(id)} ${s.gender === "male" ? "男" : "女"}${s.age || "?"} ${ind}/${fn}`; }).join("；")}`);
const r1p = path.join(dir, "r1_transcript.json");
if (fs.existsSync(r1p)) {
  const r1 = JSON.parse(fs.readFileSync(r1p, "utf8"));
  let phase = null;
  for (const it of r1.transcript || []) {
    if (it.phase !== phase) { phase = it.phase; out.push(""); out.push(`===== R1 · ${phase === "vp" ? "价值主张" : "选市场格/定位"} =====`); }
    if (["screen", "narrator", "moderator"].includes(it.speaker)) { if (it.speaker !== "narrator" || !/没人接着往下说/.test(it.text)) out.push(`〔${it.speaker === "screen" ? "屏幕" : it.speaker === "narrator" ? "旁白" : "系统"}〕${clean(it.text).slice(0, 200)}`); continue; }
    out.push(`[${name(it.speaker)}] ${clean(it.text)}`);
  }
  const fr = path.join(dir, "r1_frozen.json"); if (fs.existsSync(fr)) { const f = JSON.parse(fs.readFileSync(fr, "utf8")); out.push(`→ R1 结果：${f.grid_id} / ${f.architecture}；WHO=${f.vp_summary?.who || ""}；PAIN=${f.vp_summary?.pain || ""}；HOW=${f.vp_summary?.how || ""}`); }
}
const r2p = path.join(dir, "r2_transcript.json");
if (fs.existsSync(r2p)) {
  const r2 = JSON.parse(fs.readFileSync(r2p, "utf8"));
  const LABEL = { prototype: "R2 · 客户调研页", individual_cards: "R2 · 个人选卡合并", price_action: "R2 · 定价动作", price_tier: "R2 · 档位", price: "R2 · 最终价格" };
  for (const dp of r2.transcript || []) {
    const label = LABEL[dp.decision_point] || (dp.decision_point.startsWith("cards_") ? `R2 · 能力卡复核 · ${dp.decision_point.replace("cards_", "")}` : dp.decision_point);
    const items = (dp.transcript || []).filter((it) => !["screen", "moderator", "narrator"].includes(it.speaker));
    if (!items.length) continue;
    out.push(""); out.push(`===== ${label} =====`);
    for (const it of items) out.push(`[${name(it.speaker)}] ${clean(it.text)}`);
  }
  const sp = path.join(dir, "settlement.json"); if (fs.existsSync(sp)) { const s = JSON.parse(fs.readFileSync(sp, "utf8")); const pr = typeof s.r2_price === "object" ? s.r2_price?.price : s.r2_price; out.push(""); out.push(`→ R2 结果：价格 ${pr}，卡 ${(s.r2_cards || []).length} 张，利润 ${Math.round(Number(s.profit) / 1e4)} 万，${s.profitable === false ? "亏损" : "盈利"}`); }
}
const outPath = path.resolve(ROOT, args.out || path.join(dir, "conversation.txt"));
fs.writeFileSync(outPath, out.join("\n"));
console.log(outPath);
