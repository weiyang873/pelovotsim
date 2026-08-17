"use strict";
// Build a task_blind_narrative_v1-schema pool from the trait-only biography probe so the frozen
// solo lines (R1 screenplay + R2 v2Q) can run on it unchanged. The 8 frozen_facts keys the loader
// requires are EXTRACTED from each invented biography by one LLM call (facts implied by the text;
// "小传未提及" when absent) — never a template default. Marked schema-compatible but provenance
// = trait_only_probe so nobody mistakes it for the frozen pool.
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const ROOT = path.join(__dirname, "..", "..");
const GEN = path.join(ROOT, "scripts/analysis/generate_task_blind_persona_pool.js");
const FACT_KEYS = ["career_context", "product_and_technology_familiarity", "quality_convenience_tradeoffs", "economic_resources_and_pressure", "communication_and_participation", "price_reference_history", "personal_consumption_habits", "household_structure"];

function gen() {
  let src = fs.readFileSync(GEN, "utf8");
  src += "\nmodule.exports.__probe = { loadLocalEnv, parseJsonObject };";
  const m = new Module(GEN, module); m.filename = GEN; m.paths = Module._nodeModulePaths(path.dirname(GEN)); m._compile(src, GEN);
  return m.exports.__probe;
}
async function mapLimit(items, limit, fn) {
  const out = new Array(items.length); let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => { while (next < items.length) { const i = next++; out[i] = await fn(items[i], i); } }));
  return out;
}
async function main() {
  const { loadLocalEnv, parseJsonObject } = gen(); loadLocalEnv();
  const { chatCompletion } = require("../../server/llm/deepseekClient");
  const args = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, "").split("=")));
  const src = args.src || "runs_v4flash_0731/probes/trait_only_bio_ceibs_20260816/trait_only_biographies.jsonl";
  const outDir = path.join(ROOT, args.out || "data/task_blind_persona_pipeline_v1/trait_only_pool42_20260816");
  fs.mkdirSync(outDir, { recursive: true });
  const rows = fs.readFileSync(path.join(ROOT, src), "utf8").split(/\n/).filter(Boolean).map((l) => JSON.parse(l)).filter((r) => r.biography);
  const records = await mapLimit(rows, 6, async (r, i) => {
    let facts = null; let err = null;
    for (let a = 0; a < 3 && !facts; a += 1) {
      try {
        const raw = await chatCompletion([
          { role: "system", content: "你从一篇人物小传中抽取事实。每一项用一句中文陈述小传里明确写到或直接可推出的内容；小传没有提到的项写“小传未提及”。不要添加小传没有的信息，不要评价。只输出可 JSON.parse 的 JSON。" },
          { role: "user", content: `【小传】\n${r.biography}\n\n只输出：{${FACT_KEYS.map((k) => `"${k}":""`).join(",")}}\n字段含义：career_context=公司环境、当前岗位、行业、主要职能；product_and_technology_familiarity=对硬件/软件/智能设备的熟悉深浅；quality_convenience_tradeoffs=买贵或买便宜后满意/后悔的具体经历；economic_resources_and_pressure=家庭现金流与可支配余量；communication_and_participation=话多话少、表达节奏、课堂参与状态；price_reference_history=实际付过或见过的具体金额；personal_consumption_habits=比价/冲动/委托/复购等习惯；household_structure=伴侣、子女、父母及同住情况。` }
        ], { role: "chat_service", temperature: 0.2, max_tokens: 1200, timeoutMs: 90000, response_format: { type: "json_object" } });
        const p = parseJsonObject(raw);
        if (p && FACT_KEYS.every((k) => String(p[k] || "").trim())) facts = Object.fromEntries(FACT_KEYS.map((k) => [k, String(p[k]).trim()]));
      } catch (e) { err = String(e && e.message || e); }
    }
    if (!facts) throw new Error(`fact extraction failed for ${r.persona_id}: ${err}`);
    const s = r.surface || {};
    process.stderr.write(`[${i + 1}/${rows.length}] ${r.persona_id} ok\n`);
    return {
      schema: "task_blind_narrative_v1",
      persona_id: r.persona_id,
      seed: `trait-only-probe:${r.persona_id}`,
      surface: { gender: s.gender === "female" ? "female" : "male", age: Number(s.age) || null, edu: String(s.edu || ""), region: String(s.region || ""), name: String(s.name || r.persona_id), overseas: { hasOverseas: false, destination: "", duration: "" }, mbti: "", expression_style: "见人物小传" },
      behavioral_fingerprint: r.fingerprint,
      frozen_facts: facts,
      biography: r.biography,
      generation_provenance: { source: "trait_only_probe", biography_source: src, invented_surface: s, facts_extracted_from_biography: true, task_text_seen_by_biography_writer: false },
      synthetic: true
    };
  });
  const poolPath = path.join(outDir, "persona_pool_trait_only_v1.json");
  fs.writeFileSync(poolPath, JSON.stringify(records, null, 2));
  fs.writeFileSync(path.join(outDir, "pool_manifest.json"), JSON.stringify({ schema: "trait_only_pool_manifest_v1", generated_at: new Date().toISOString(), count: records.length, source: src, note: "Probe pool: 8-dim fingerprints identical to r1_pool42_20260812; biography written from traits + 'CEIBS EMBA' only; frozen_facts extracted post hoc from the biography. NOT a frozen line." }, null, 2));
  console.log(JSON.stringify({ poolPath: path.relative(ROOT, poolPath), n: records.length }));
}
main().catch((e) => { console.error(e); process.exit(1); });
