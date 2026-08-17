"use strict";
// Faultline probe at the BIOGRAPHY level ("强制小传"): subgroup members share fact-card material, not labels.
// For each fixed triad (A,B,C from the 541-pool, mutually unlike), build added members D≈A, E≈B under four
// conditions by copying parts of A's/B's fact card + fingerprint onto an independent base card X, then let the
// SAME biography writer (v2 generator prompt) write a fresh biography with a new name:
//   control : X unchanged (independent card)
//   surface : copy A's age/gender + age_and_life_stage sentence (Harrison surface); everything else X's
//   deep    : copy A's fingerprint (-> 8 directives) + judgment facts (consumption, price references, quality
//             tradeoffs, economic pressure, customer exposure, tech familiarity, social influence, communication);
//             X's age/gender/education/career/household kept
//   both    : copy A's whole card (facts + fingerprint); only the name is new
// Output: a task_blind_narrative_v1 pool (core persons + generated members) and a fixed-teams file.
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const ROOT = path.join(__dirname, "..", "..");
const GEN = path.join(ROOT, "scripts/analysis/generate_task_blind_persona_pool_v2.js");
const POOL541 = path.join(ROOT, "data/task_blind_persona_pipeline_v1/v2_faultline_pool541_20260816/persona_pool_task_blind_narrative_v1.json");

function gen() {
  let src = fs.readFileSync(GEN, "utf8");
  src += "\nmodule.exports.__probe = { loadLocalEnv, traitDirectives, biographyMessages, normalizeBiography, SURNAMES, GIVEN_NAMES };";
  const m = new Module(GEN, module); m.filename = GEN; m.paths = Module._nodeModulePaths(path.dirname(GEN)); m._compile(src, GEN);
  return m.exports.__probe;
}
const DEEP_FACTS = ["personal_consumption_habits", "price_reference_history", "quality_convenience_tradeoffs", "economic_resources_and_pressure", "customer_and_user_exposure", "product_and_technology_familiarity", "social_influence_on_choices", "communication_and_participation"];
const SURF_FACTS = ["age_and_life_stage"];

async function mapLimit(items, limit, fn) { const out = new Array(items.length); let next = 0; await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => { while (next < items.length) { const i = next++; out[i] = await fn(items[i], i); } })); return out; }

async function main() {
  const G = gen(); G.loadLocalEnv();
  const { chatCompletion } = require("../../server/llm/deepseekClient");
  const args = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, "").split("=")));
  const NT = Number(args.triads || 10); const outDir = path.join(ROOT, args.out || "data/task_blind_persona_pipeline_v1/faultline_shared_card_probe_20260817");
  fs.mkdirSync(outDir, { recursive: true });
  const P = JSON.parse(fs.readFileSync(POOL541, "utf8"));
  const med = (k) => { const v = P.map((r) => r.behavioral_fingerprint[k]).sort((a, b) => a - b); return v[Math.floor(v.length / 2)]; };
  const MR = med("risk_propensity_business"), MP = med("regulatory_focus_promotion"), MA = med("actively_open_minded_thinking");
  const surfPat = (r) => `${r.surface.age <= 42 ? "Y" : r.surface.age >= 48 ? "O" : "M"}${r.surface.gender === "male" ? 1 : 0}`;
  const deepPat = (r) => `${r.behavioral_fingerprint.risk_propensity_business > MR ? 1 : 0}${r.behavioral_fingerprint.regulatory_focus_promotion > MP ? 1 : 0}${r.behavioral_fingerprint.actively_open_minded_thinking > MA ? 1 : 0}`;
  const ind = (r) => r.surface.industry; const nm = (r) => r.surface.name;
  let seed = Number(args.seed || 41); const rnd = () => { seed = (seed * 48271) % 2147483647; return seed / 2147483647; };
  const shuffle = (a) => [...a].sort(() => rnd() - 0.5);
  const unlike = (x, y) => surfPat(x) !== surfPat(y) && deepPat(x) !== deepPat(y);
  const used = new Set();
  const triads = [];
  let guard = 0;
  while (triads.length < NT && guard++ < 2000) {
    const cand = shuffle(P.filter((r) => !used.has(r.persona_id))).slice(0, 150);
    let core = null;
    for (let i = 0; i < cand.length && !core; i++) for (let j = i + 1; j < cand.length && !core; j++) { if (!unlike(cand[i], cand[j]) || ind(cand[i]) === ind(cand[j]) || nm(cand[i]) === nm(cand[j])) continue; for (let k = j + 1; k < cand.length; k++) { const t = [cand[i], cand[j], cand[k]]; if (!unlike(t[0], t[2]) || !unlike(t[1], t[2])) continue; if (new Set(t.map(ind)).size < 3 || new Set(t.map(nm)).size < 3) continue; core = t; break; } }
    if (!core) break;
    // bases: 8 independent persons unlike all core (2 per condition), distinct industries/names within team
    const bases = []; const pool = shuffle(P.filter((r) => !used.has(r.persona_id) && !core.includes(r) && core.every((c) => unlike(r, c))));
    for (const r of pool) { if (bases.length >= 8) break; if (bases.some((b) => ind(b) === ind(r) || nm(b) === nm(r))) continue; if (core.some((c) => ind(c) === ind(r) || nm(c) === nm(r))) continue; bases.push(r); }
    if (bases.length < 8) continue;
    core.forEach((c) => used.add(c.persona_id)); bases.forEach((b) => used.add(b.persona_id));
    const iso = triads.length % 3; const idx = [0, 1, 2].filter((i) => i !== iso); const [A, B] = [core[idx[0]], core[idx[1]]];
    triads.push({ core, iso, A, B, bases });
  }
  console.log(`triads: ${triads.length}`);
  // build cards
  const usedNames = new Set(P.map(nm));
  const newName = (gender) => { for (let k = 0; k < 500; k++) { const n = G.SURNAMES[Math.floor(rnd() * G.SURNAMES.length)] + G.GIVEN_NAMES[gender][Math.floor(rnd() * G.GIVEN_NAMES[gender].length)]; if (!usedNames.has(n)) { usedNames.add(n); return n; } } throw new Error("names exhausted"); };
  const cards = [];
  triads.forEach((tr, ti) => {
    const conds = { control: [tr.bases[0], tr.bases[1]], surface: [tr.bases[2], tr.bases[3]], deep: [tr.bases[4], tr.bases[5]], both: [tr.bases[6], tr.bases[7]] };
    for (const [cond, [X1, X2]] of Object.entries(conds)) {
      [[X1, tr.A, "D"], [X2, tr.B, "E"]].forEach(([X, T, role]) => {
        const facts = { ...X.frozen_facts }; let fp = { ...X.behavioral_fingerprint }; const surface = { ...X.surface };
        if (cond === "surface" || cond === "both") { surface.age = T.surface.age; surface.gender = T.surface.gender; for (const k of SURF_FACTS) facts[k] = T.frozen_facts[k]; }
        if (cond === "deep" || cond === "both") { fp = { ...T.behavioral_fingerprint }; for (const k of DEEP_FACTS) if (T.frozen_facts[k]) facts[k] = T.frozen_facts[k]; }
        if (cond === "both") { for (const k of Object.keys(T.frozen_facts)) facts[k] = T.frozen_facts[k]; Object.assign(surface, T.surface); }
        const name = newName(surface.gender);
        cards.push({ persona_id: `FL${String(ti + 1).padStart(2, "0")}_${cond}_${role}`, triad: ti + 1, cond, role, target_id: T.persona_id, base_id: X.persona_id, name, surface: { ...surface, name, expression_style: "见人物小传", mbti: "" }, behavioral_fingerprint: fp, behavioral_directives: G.traitDirectives(fp), frozen_facts: facts });
      });
    }
  });
  console.log(`cards to write: ${cards.length}`);
  const callsPath = path.join(outDir, "biography_calls.jsonl"); fs.writeFileSync(callsPath, "");
  const generated = await mapLimit(cards, Number(args.concurrency || 6), async (card, i) => {
    let lastError = ""; let biography = null;
    for (let attempt = 1; attempt <= 8 && !biography; attempt += 1) {
      const messages = G.biographyMessages(card);
      if (lastError) messages[1].content += `\n\n上一稿未通过机械检查：${lastError}。请重写全文，不要解释检查。`;
      try { const raw = await chatCompletion(messages, { role: "chat_service", temperature: 0.9, max_tokens: 3000, timeoutMs: 90000, response_format: { type: "json_object" } }); fs.appendFileSync(callsPath, JSON.stringify({ persona_id: card.persona_id, attempt, ok: true }) + "\n"); biography = G.normalizeBiography(raw, card); } catch (e) { lastError = String(e && e.message || e).slice(0, 120); fs.appendFileSync(callsPath, JSON.stringify({ persona_id: card.persona_id, attempt, error: lastError }) + "\n"); }
    }
    process.stderr.write(`[${i + 1}/${cards.length}] ${card.persona_id} ${biography ? "ok" : "FAIL"}\n`);
    return biography ? { schema: "task_blind_narrative_v1", persona_id: card.persona_id, seed: `shared-card:${card.persona_id}`, surface: card.surface, behavioral_fingerprint: card.behavioral_fingerprint, frozen_facts: card.frozen_facts, biography, generation_provenance: { source: "faultline_shared_card_probe", cond: card.cond, role: card.role, target_id: card.target_id, base_id: card.base_id, task_text_seen_by_biography_writer: false }, synthetic: true } : null;
  });
  const okGen = generated.filter(Boolean); const okIds = new Set(okGen.map((r) => r.persona_id));
  // pool = all core persons + generated
  const coreRecs = triads.flatMap((tr) => tr.core);
  const pool = [...coreRecs, ...okGen];
  fs.writeFileSync(path.join(outDir, "persona_pool_task_blind_narrative_v1.json"), JSON.stringify(pool, null, 1));
  // teams
  const teams = {}; let k = 0;
  triads.forEach((tr, ti) => { for (const cond of ["control", "surface", "deep", "both"]) { const dId = `FL${String(ti + 1).padStart(2, "0")}_${cond}_D`, eId = `FL${String(ti + 1).padStart(2, "0")}_${cond}_E`; if (!okIds.has(dId) || !okIds.has(eId)) continue; k++; const ids = [...tr.core.map((c) => c.persona_id), dId, eId]; const leader = ids[Math.floor(rnd() * 5)]; teams[String(k).padStart(2, "0")] = { cell: cond, triad: ti + 1, core: tr.core.map((c) => c.persona_id), isolate: tr.core[tr.iso].persona_id, matched: [tr.A.persona_id, tr.B.persona_id], added: [dId, eId], profile_ids: ids, leader_id: leader }; } });
  fs.writeFileSync(path.join(outDir, "faultline_shared_card_teams.json"), JSON.stringify({ pool: path.relative(ROOT, path.join(outDir, "persona_pool_task_blind_narrative_v1.json")), design: "shared-fact-card faultline probe (control/surface/deep/both), isolate rotates", teams }, null, 1));
  console.log(JSON.stringify({ outDir: path.relative(ROOT, outDir), generated: okGen.length, of: cards.length, teams: Object.keys(teams).length }));
}
main().catch((e) => { console.error(e); process.exit(1); });
