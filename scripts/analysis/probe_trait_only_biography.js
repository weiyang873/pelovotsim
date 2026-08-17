"use strict";
// Probe: given ONLY the 8-dim fingerprint (as the same 5-band natural-language directives the
// task-blind pipeline uses), let the model invent everything else (name, demographics, career,
// family) and write the biography. Measures dispersion of the emergent demographics and of the
// biography text, versus the frozen task-blind pool (where demographics come from IID fact cards).
// Does not touch the pool. Output: runs_v4flash_0731/probes/<batch>/...
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");

const ROOT = path.join(__dirname, "..", "..");
const POOL = path.join(ROOT, "data/task_blind_persona_pipeline_v1/r1_pool42_20260812/persona_pool_task_blind_narrative_v1.json");
const GEN = path.join(ROOT, "scripts/analysis/generate_task_blind_persona_pool.js");

function loadGeneratorInternals() {
  let src = fs.readFileSync(GEN, "utf8");
  src += "\nmodule.exports.__probe = { traitDirectives, loadLocalEnv, parseJsonObject };";
  const m = new Module(GEN, module);
  m.filename = GEN;
  m.paths = Module._nodeModulePaths(path.dirname(GEN));
  m._compile(src, GEN);
  return m.exports.__probe;
}

function messagesFor(directives) {
  return [
    {
      role: "system",
      content: [
        "你是严肃现实主义人物小传作者。关于这个人，你只知道两件事：TA 正在中欧国际工商学院读 EMBA；以及下面八条行为表现。其它一切——姓名、性别、年龄、学历、成长地与现居地、行业、职能与当前岗位、公司环境、家庭结构、经济状况、消费与花钱习惯、说话和课堂参与状态——都由你自己编出来，写成一个连贯、具体、像真人的人。",
        "你不知道这个人以后会参加什么研究、看什么界面或做什么任务，也不要猜测。",
        "八条行为表现是硬约束，但不要逐条复述，不要写成用户画像、心理测评、咨询报告或优缺点清单。",
        "先让职业与生活经历有时间连续性，再用具体的小事、成功、吃亏、家庭分工、花钱或工作习惯自然表现行为。",
        "同一个人可以矛盾。不要替人物总结稳定的商业立场，不要预告未来会选择什么。",
        "不得出现任何 trait 名称、分数或高低标签。只输出可 JSON.parse 的 JSON。"
      ].join("\n")
    },
    {
      role: "user",
      content: [
        "【八条行为表现；只能通过故事、动作和语言表现，不能解释成标签】",
        ...directives.map((value) => `- ${value}`),
        "",
        "写一篇 900-1300 字的第三人称人物小传。必须包括连贯职业主线、当前生活结构、两到四件能留下行为痕迹的具体往事、自然的说话和课堂参与状态。",
        "只写这个人的一般人生，不出现任何未来任务、产品方案、市场选项或推荐答案。",
        "只输出：{\"biography\":\"完整连续的小传正文\",\"surface\":{\"name\":\"\",\"gender\":\"male|female\",\"age\":0,\"edu\":\"\",\"region\":\"现居城市\",\"industry\":\"\",\"primary_function\":\"\",\"current_role\":\"\",\"company_context\":\"\",\"is_founder\":true|false,\"household\":\"一句话\"}}"
      ].join("\n")
    }
  ];
}

async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  }));
  return out;
}

async function main() {
  const { traitDirectives, loadLocalEnv, parseJsonObject } = loadGeneratorInternals();
  loadLocalEnv();
  const { chatCompletion } = require("../../server/llm/deepseekClient");
  const args = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, "").split("=")));
  const batch = args.batch || "trait_only_bio_20260816";
  const limit = Number(args.limit || 42);
  const concurrency = Number(args.concurrency || 6);
  const outDir = path.join(ROOT, "runs_v4flash_0731", "probes", batch);
  fs.mkdirSync(outDir, { recursive: true });
  const pool = JSON.parse(fs.readFileSync(POOL, "utf8"));
  const list = (Array.isArray(pool) ? pool : pool.personas || pool.profiles).slice(0, limit);
  const outPath = path.join(outDir, "trait_only_biographies.jsonl");
  fs.writeFileSync(outPath, "");
  const results = await mapLimit(list, concurrency, async (rec, i) => {
    const directives = Object.values(traitDirectives(rec.behavioral_fingerprint));
    let raw = null; let parsed = null; let error = null;
    for (let attempt = 0; attempt < 3 && !parsed; attempt += 1) {
      try {
        raw = await chatCompletion(messagesFor(directives), { role: "chat_service", temperature: 0.9, max_tokens: 3000, timeoutMs: 120000, response_format: { type: "json_object" } });
        parsed = parseJsonObject(raw);
        if (!parsed?.biography || !parsed?.surface) parsed = null;
      } catch (e) { error = String(e && e.message || e); }
    }
    const row = { persona_id: rec.persona_id, fingerprint: rec.behavioral_fingerprint, directives, surface: parsed?.surface || null, biography: parsed?.biography || null, error: parsed ? null : error, pool_surface: rec.surface, pool_frozen_facts: rec.frozen_facts };
    fs.appendFileSync(outPath, JSON.stringify(row) + "\n");
    process.stderr.write(`[${i + 1}/${list.length}] ${rec.persona_id} ${parsed ? "ok" : "FAIL"}\n`);
    return row;
  });
  const ok = results.filter((r) => r.biography).length;
  fs.writeFileSync(path.join(outDir, "meta.json"), JSON.stringify({ batch, generated_at: new Date().toISOString(), n: results.length, ok, pool: path.relative(ROOT, POOL), model_role: "chat_service", temperature: 0.9, note: "trait-only biography probe; demographics invented by model" }, null, 2));
  console.log(JSON.stringify({ outDir: path.relative(ROOT, outDir), n: results.length, ok }));
}

main().catch((e) => { console.error(e); process.exit(1); });
