"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { spawnSync } = require("node:child_process");

const FullGame = require("./full_game_all_personas");

const ROOT = path.join(__dirname, "..", "..");
const RUN_ID = "harness_defect_pilot_v1_2026-07-14";
const SPEC_PATH = path.join(ROOT, "docs", "CODEX_HARNESS_DEFECT_PILOT.md");
const FULL_GAME_SCRIPT_PATH = path.join(__dirname, "full_game_all_personas.js");
const PERSONA_IDS = ["A", "D"];
const CONDITIONS = ["N", "D"];
const DEFECT_ANCHOR_MULTIPLIER = 1.4;
const LONG_TERM_VALUE_KEYWORDS = [
  "品牌",
  "口碑",
  "长期",
  "复购",
  "忠诚",
  "生态",
  "生命周期价值",
  "溢价意愿",
  "溢价",
  "续费",
  "转介绍",
  "推荐",
  "分享",
  "社群",
  "达人",
  "种草",
  "内容",
  "留存",
  "粘性",
  "信任",
  "成长记录",
  "数据沉淀",
  "家庭记忆",
  "陪伴习惯",
  "品牌认知",
  "用户资产"
];
const META_LEAK_PATTERN = /(截断|删除|被删|过滤|信息缺失|数字不准|可能不准|虚高|真实值|干预|缺陷|prompt|提示词|系统.*改)/i;

function loadLocalEnv() {
  const envPath = path.join(ROOT, ".env");
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const splitAt = trimmed.indexOf("=");
    if (splitAt <= 0) continue;
    const key = trimmed.slice(0, splitAt).trim();
    let value = trimmed.slice(splitAt + 1).trim();
    if ((value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!Object.prototype.hasOwnProperty.call(process.env, key)) process.env[key] = value;
  }
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function fileSha256(filePath) {
  return sha256(fs.readFileSync(filePath));
}

function gitHead() {
  const result = spawnSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" });
  return result.status === 0 ? result.stdout.trim() : null;
}

function parseArgs(argv) {
  const args = { runId: RUN_ID, concurrency: 1, summarizeOnly: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--run-id") args.runId = String(argv[++index] || "").trim();
    else if (arg === "--concurrency") args.concurrency = Number(argv[++index]);
    else if (arg === "--summarize-only") args.summarizeOnly = true;
    else throw new Error(`unknown argument: ${arg}`);
  }
  if (!args.runId || !Number.isInteger(args.concurrency) || args.concurrency < 1) {
    throw new Error("invalid run id or concurrency");
  }
  return args;
}

function outputPaths(runId) {
  return {
    jsonl: path.join(__dirname, `${runId}.jsonl`),
    summary: path.join(__dirname, `${runId}_summary.md`),
    samples: path.join(__dirname, `${runId}_raw_samples.md`),
    meta: path.join(__dirname, `${runId}_meta.json`)
  };
}

function loadJsonl(filePath) {
  if (!fs.existsSync(filePath)) return [];
  return fs.readFileSync(filePath, "utf8").split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
}

function appendJsonl(filePath, row) {
  fs.appendFileSync(filePath, `${JSON.stringify(row)}\n`, "utf8");
}

function chainKey(row) {
  return `${row.persona_id}|${row.condition}|${row.rep}`;
}

function latestRows(rows) {
  const latest = new Map();
  for (const row of rows) latest.set(chainKey(row), row);
  return PERSONA_IDS.flatMap((id) => CONDITIONS.map((condition) => latest.get(`${id}|${condition}|1`))).filter(Boolean);
}

async function runPool(tasks, concurrency, worker) {
  let cursor = 0;
  async function lane() {
    while (true) {
      const index = cursor;
      cursor += 1;
      if (index >= tasks.length) return;
      await worker(tasks[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, tasks.length) }, () => lane()));
}

function splitSummarySentences(text) {
  const rows = [];
  for (const line of String(text || "").split(/\n/)) {
    const trimmedLine = line.trim();
    if (!trimmedLine) continue;
    const parts = trimmedLine.split(/(?<=[。！？；;])/).map((part) => part.trim()).filter(Boolean);
    if (parts.length) rows.push(...parts);
    else rows.push(trimmedLine);
  }
  return rows;
}

function filterLongTermValueSummary(summaryText) {
  const sentences = splitSummarySentences(summaryText);
  const deleted = [];
  const kept = [];
  for (const sentence of sentences) {
    const matched = LONG_TERM_VALUE_KEYWORDS.filter((keyword) => sentence.includes(keyword));
    if (matched.length) {
      deleted.push({ text: sentence, matched_keywords: matched });
    } else {
      kept.push(sentence);
    }
  }
  const filtered = kept.join("\n");
  return {
    summaryText: filtered,
    audit: {
      defect_type: "D3_summary_long_term_value_truncation",
      keywords: LONG_TERM_VALUE_KEYWORDS,
      original_sha256: sha256(summaryText),
      filtered_sha256: sha256(filtered),
      original_sentence_count: sentences.length,
      kept_sentence_count: kept.length,
      deleted_count: deleted.length,
      deleted_sentences: deleted
    }
  };
}

function biasD5WtpAnchor(r1Outcome) {
  const trueWtp = Number(r1Outcome.WTPadj_scaled || 0);
  const biased = Math.round(trueWtp * DEFECT_ANCHOR_MULTIPLIER);
  const cloned = {
    ...r1Outcome,
    WTPadj_scaled: biased,
    WTPadj_scaled_true_hidden_from_prompt: trueWtp,
    WTPadj_scaled_bias_multiplier: DEFECT_ANCHOR_MULTIPLIER
  };
  return {
    r1Outcome: cloned,
    audit: {
      defect_type: "D5_WTPadj_scaled_anchor_bias",
      multiplier: DEFECT_ANCHOR_MULTIPLIER,
      true_WTPadj_scaled: trueWtp,
      biased_WTPadj_scaled_prompt: biased,
      delta: biased - trueWtp,
      settlement_uses_true_WTPadj_scaled: true
    }
  };
}

function buildDefectOptions(persona, condition, draw) {
  const base = {
    condition,
    rep: 1,
    jinangDraw: draw
  };
  if (condition !== "D") return base;
  if (persona.id === "A") {
    return {
      ...base,
      defect: {
        route: "B",
        type: "D3_summary_long_term_value_truncation",
        rationale: "草根老板现金/试单隧道，看不见长期价值信号"
      },
      beforeD3Summary: ({ summaryText }) => filterLongTermValueSummary(summaryText)
    };
  }
  if (persona.id === "D") {
    return {
      ...base,
      defect: {
        route: "B",
        type: "D5_WTPadj_scaled_anchor_bias",
        rationale: "二代接班人品质/背书执念，系统性高估客户支付意愿",
        multiplier: DEFECT_ANCHOR_MULTIPLIER
      },
      beforeD5Prompt: ({ r1Outcome }) => biasD5WtpAnchor(r1Outcome)
    };
  }
  return base;
}

function sharedDrawsFromRows(rows, materials) {
  const draws = new Map();
  for (const row of rows) {
    if (row.r0_jinang?.market?.id && row.r0_jinang?.tech?.id) draws.set(row.persona_id, row.r0_jinang);
  }
  for (const persona of materials.personas.filter((item) => PERSONA_IDS.includes(item.id))) {
    if (!draws.has(persona.id)) draws.set(persona.id, FullGame.drawJinang(materials.jinangConfig));
  }
  return draws;
}

function fmt(value, digits = 2) {
  const num = Number(value);
  if (!Number.isFinite(num)) return "";
  return digits === 0 ? String(Math.round(num)) : String(Math.round(num * (10 ** digits)) / (10 ** digits));
}

function rowsByPersonaCondition(rows) {
  const latest = latestRows(rows);
  const map = new Map();
  for (const row of latest) map.set(`${row.persona_id}|${row.condition}`, row);
  return map;
}

function rowTextForLeak(row) {
  return [
    row.r1_choice?.raw_response,
    row.coach?.turns?.map((item) => item.content).join("\n"),
    row.r2?.d3?.raw_response,
    row.r2?.d4?.raw_response,
    row.r2?.d5?.raw_response
  ].filter(Boolean).join("\n");
}

function anchorMention(row) {
  const audit = row.defect_audit?.d5_prompt;
  if (!audit) return { mentions_biased_anchor: false, mention_pattern: "" };
  const biased = Number(audit.biased_WTPadj_scaled_prompt || 0);
  const rounded = String(Math.round(biased));
  const text = `${row.r2?.d5?.raw_response || ""}\n${row.r2?.d5?.parsed?.target_gm_usage || ""}\n${row.r2?.d5?.parsed?.reasoning || ""}`;
  const loose = rounded.replace(/(\d)(?=(\d{3})+$)/g, "$1,");
  return {
    mentions_biased_anchor: text.includes(rounded) || text.includes(loose),
    mention_pattern: `${rounded}/${loose}`
  };
}

function defectComparisonRows(rows) {
  const map = rowsByPersonaCondition(rows);
  return PERSONA_IDS.map((id) => {
    const n = map.get(`${id}|N`);
    const d = map.get(`${id}|D`);
    const nCards = n?.r2?.d4?.parsed?.cards?.length;
    const dCards = d?.r2?.d4?.parsed?.cards?.length;
    const nPrice = n?.r2?.d5?.parsed?.aligned_price;
    const dPrice = d?.r2?.d5?.parsed?.aligned_price;
    const nProfit = n?.r2?.calculate?.metrics?.profit;
    const dProfit = d?.r2?.calculate?.metrics?.profit;
    const nQ = n?.r2?.calculate?.metrics?.Q;
    const dQ = d?.r2?.calculate?.metrics?.Q;
    return `| ${n?.persona_label || d?.persona_label || id} | ${fmt(nCards, 0)} → ${fmt(dCards, 0)} | ${fmt(nPrice, 0)} → ${fmt(dPrice, 0)} | ${fmt(nQ, 0)} → ${fmt(dQ, 0)} | ${fmt(nProfit, 0)} → ${fmt(dProfit, 0)} | ${fmt(Number(dProfit) - Number(nProfit), 0)} |`;
  });
}

function economicsRows(rows) {
  return latestRows(rows).map((row) => {
    const m = row.r2?.calculate?.metrics || {};
    const r1 = row.r1_settlement || {};
    return `| ${row.persona_label} | ${row.condition} | ${row.r1_choice?.parsed?.grid_label || ""} | ${row.r1_choice?.parsed?.architecture || ""} | ${fmt(r1.WTPadj_scaled, 0)} | ${fmt(row.r2?.d5?.parsed?.aligned_price, 0)} | ${(row.r2?.d4?.parsed?.cards || []).length} | ${fmt(m.Q, 0)} | ${fmt(m.Vscore)} | ${fmt(m.dCOGS, 0)} | ${fmt(m.profit, 0)} | ${row.r2?.calculate?.tag_flow?.fallback_used ? "是" : "否"} |`;
  });
}

function compatibilityRows(rows) {
  return latestRows(rows).map((row) => {
    const compat = row.r2?.d4?.parsed?.compatibility || {};
    return `| ${row.persona_label} | ${row.condition} | ${row.status} | ${compat.valid ? "OK" : "FAIL"} | ${compat.hardViolationCount ?? ""} | ${(compat.violations || []).length} |`;
  });
}

function metaLeakRows(rows) {
  return latestRows(rows).map((row) => {
    const text = rowTextForLeak(row);
    const leak = META_LEAK_PATTERN.test(text);
    const match = text.match(META_LEAK_PATTERN)?.[0] || "";
    return `| ${row.persona_label} | ${row.condition} | ${leak ? "是" : "否"} | ${match} |`;
  });
}

function d3ThemeText(row) {
  const d3 = row.r2?.d3?.parsed || {};
  return (d3.evidence_themes || []).join("、") || (d3.key_evidence || []).join("；");
}

function writeSummary(paths, rows) {
  const latest = latestRows(rows);
  const okRows = latest.filter((row) => row.status === "OK");
  const map = rowsByPersonaCondition(rows);
  const grassD = map.get("A|D");
  const grassN = map.get("A|N");
  const heirD = map.get("D|D");
  const heirN = map.get("D|N");
  const grassDeleted = grassD?.defect_audit?.d3_summary?.deleted_sentences || [];
  const heirAnchor = heirD ? anchorMention(heirD) : { mentions_biased_anchor: false, mention_pattern: "" };
  const anchorAudit = heirD?.defect_audit?.d5_prompt || {};
  const observation = (() => {
    if (okRows.length < 4) return "链路未全部完成，暂不判定机制方向。";
    const grassProfitDelta = Number(grassD?.r2?.calculate?.metrics?.profit || 0) - Number(grassN?.r2?.calculate?.metrics?.profit || 0);
    const heirProfitDelta = Number(heirD?.r2?.calculate?.metrics?.profit || 0) - Number(heirN?.r2?.calculate?.metrics?.profit || 0);
    return `草根 D 相对 N profit ${grassProfitDelta >= 0 ? "增加" : "下降"} ${fmt(Math.abs(grassProfitDelta), 0)}；二代 D 相对 N profit ${heirProfitDelta >= 0 ? "增加" : "下降"} ${fmt(Math.abs(heirProfitDelta), 0)}。本轮只判断计算性缺陷是否被用掉，不做校准声明。`;
  })();
  const lines = [
    `# ${RUN_ID} Summary`,
    "",
    "## Device Note",
    "",
    "本轮是 B 路线首跑：harness 层注入计算性执行缺陷。缺陷参数为试探值，未经真人 trace 校准；结果是机制验证，不是保真度或真人盈利率复现声明。流程复用 `full_game_all_personas.js`，仅 D 条件在指定环节改操作数。",
    "",
    "## Completion",
    "",
    `- Latest rows: ${latest.length}/4`,
    `- OK: ${okRows.length}/4`,
    `- Failed: ${latest.filter((row) => row.status !== "OK").map((row) => `${row.persona_label}/${row.condition}: ${row.error}`).join("；") || "none"}`,
    "",
    "## Shared Jinang Draws",
    "",
    "| Persona | market jinang | tech jinang |",
    "|---|---|---|",
    ...PERSONA_IDS.map((id) => {
      const row = latest.find((item) => item.persona_id === id);
      return `| ${row?.persona_label || id} | ${row?.r0_jinang?.market?.name || ""} | ${row?.r0_jinang?.tech?.name || ""} |`;
    }),
    "",
    "## 1. 缺陷是否被用掉",
    "",
    "### 草根老板：D3 视野截断",
    "",
    `- 删除句子数：${grassDeleted.length}`,
    `- N链 D3主题：${d3ThemeText(grassN)}`,
    `- D链 D3主题：${d3ThemeText(grassD)}`,
    "",
    "| # | deleted sentence | matched keywords |",
    "|---:|---|---|",
    ...grassDeleted.map((item, index) => `| ${index + 1} | ${String(item.text || "").replace(/\|/g, "｜")} | ${(item.matched_keywords || []).join("、")} |`),
    "",
    "### 二代接班人：D5 WTP 锚偏置",
    "",
    "| true WTPadj_scaled | biased WTP shown in D5 prompt | multiplier | N price | D price | D mentions biased anchor | mention pattern |",
    "|---:|---:|---:|---:|---:|---|---|",
    `| ${fmt(anchorAudit.true_WTPadj_scaled, 0)} | ${fmt(anchorAudit.biased_WTPadj_scaled_prompt, 0)} | ${fmt(anchorAudit.multiplier)} | ${fmt(heirN?.r2?.d5?.parsed?.aligned_price, 0)} | ${fmt(heirD?.r2?.d5?.parsed?.aligned_price, 0)} | ${heirAnchor.mentions_biased_anchor ? "是" : "否"} | ${heirAnchor.mention_pattern} |`,
    "",
    "## 2. D/N 扭曲方向与经济后果",
    "",
    "| Persona | cards N→D | price N→D | Q N→D | profit N→D | Δprofit(D-N) |",
    "|---|---:|---:|---:|---:|---:|",
    ...defectComparisonRows(rows),
    "",
    "## 3. 4 条链经济结果",
    "",
    "| Persona | Cond | 格子 | 架构 | true WTPadj_scaled | price | cards | Q | Vscore | dCOGS | profit | evi fallback |",
    "|---|---|---|---|---:|---:|---:|---:|---:|---:|---:|---|",
    ...economicsRows(rows),
    "",
    "## 4. D4 兼容性与数值校验",
    "",
    "| Persona | Cond | status | D4 compatibility | hard violations | total violations |",
    "|---|---|---|---|---:|---:|",
    ...compatibilityRows(rows),
    "",
    "## 5. 语言层元认知泄漏检查",
    "",
    "| Persona | Cond | leak? | first matched term |",
    "|---|---|---|---|",
    ...metaLeakRows(rows),
    "",
    "## One-sentence Observation",
    "",
    observation,
    ""
  ];
  fs.writeFileSync(paths.summary, lines.join("\n"), "utf8");
}

function writeSamples(paths, rows) {
  const lines = [`# ${RUN_ID} Raw Samples`, ""];
  for (const row of latestRows(rows)) {
    lines.push(`## ${row.persona_label} / ${row.condition} (${row.status})`, "");
    if (row.error) lines.push(`Error: ${row.error}`, "");
    lines.push("### Defect", "", "```json", JSON.stringify({ defect: row.defect, defect_audit: row.defect_audit }, null, 2), "```", "");
    lines.push("### R0 Jinang", "", "```json", JSON.stringify(row.r0_jinang, null, 2), "```", "");
    lines.push("### R1", "", "#### Prompt", "", row.r1_choice?.prompt || "", "", "#### Raw", "", row.r1_choice?.raw_response || "", "", "#### Parsed", "", "```json", JSON.stringify(row.r1_choice?.parsed || null, null, 2), "```", "");
    lines.push("### Coach", "");
    for (const turn of row.coach?.turns || []) lines.push(`- ${turn.role}: ${turn.content}`);
    lines.push("", "#### Synthesis", "", "```json", JSON.stringify(row.coach?.synthesis || null, null, 2), "```", "");
    lines.push("### Dynamic Summary", "", row.r2?.dynamic_summary?.summary_text || "", "");
    if (row.r2?.dynamic_summary?.original_summary_text) {
      lines.push("#### Original Summary Before Defect", "", row.r2.dynamic_summary.original_summary_text, "");
    }
    lines.push("### D3", "", "#### Prompt", "", row.r2?.d3?.prompt || "", "", "#### Raw", "", row.r2?.d3?.raw_response || "", "", "#### Parsed", "", "```json", JSON.stringify(row.r2?.d3?.parsed || null, null, 2), "```", "");
    lines.push("### D4", "", "#### Prompt", "", row.r2?.d4?.prompt || "", "", "#### Raw", "", row.r2?.d4?.raw_response || "", "", "#### Parsed", "", "```json", JSON.stringify(row.r2?.d4?.parsed || null, null, 2), "```", "");
    lines.push("### D5", "", "#### Prompt", "", row.r2?.d5?.prompt || "", "", "#### Raw", "", row.r2?.d5?.raw_response || "", "", "#### Parsed", "", "```json", JSON.stringify(row.r2?.d5?.parsed || null, null, 2), "```", "");
    lines.push("### Calculate", "", "```json", JSON.stringify(row.r2?.calculate || null, null, 2), "```", "");
  }
  fs.writeFileSync(paths.samples, lines.join("\n"), "utf8");
}

function writeMeta(paths, rows, args, materials) {
  const latest = latestRows(rows);
  const configFiles = [
    SPEC_PATH,
    FULL_GAME_SCRIPT_PATH,
    path.join(__dirname, "ai_generated_persona_maps_v2_2026-07-14_maps.json"),
    path.join(__dirname, "cognitive_map_caogen_min.json"),
    path.join(__dirname, "cognitive_map_erdai_min.json"),
    path.join(ROOT, "data", "capability_groups_v2.json"),
    path.join(ROOT, "data", "compatibility_rules_v2.json"),
    path.join(ROOT, "data", "tag_map_v2_1.json"),
    path.join(ROOT, "data", "grid_priors_v4_cap_weights.json"),
    path.join(ROOT, "game_config_v0.1", "jinang_cards_v2.json")
  ].filter((filePath) => fs.existsSync(filePath));
  const sharedDraws = {};
  for (const id of PERSONA_IDS) {
    const row = latest.find((item) => item.persona_id === id);
    if (row?.r0_jinang) sharedDraws[id] = {
      persona: row.persona_label,
      market: { id: row.r0_jinang.market?.id, name: row.r0_jinang.market?.name },
      tech: { id: row.r0_jinang.tech?.id, name: row.r0_jinang.tech?.name }
    };
  }
  const meta = {
    run_id: args.runId,
    generated_at: new Date().toISOString(),
    git_head: gitHead(),
    script_sha256: fileSha256(__filename),
    full_game_script_sha256: fileSha256(FULL_GAME_SCRIPT_PATH),
    rows_total: rows.filter((row) => row.run_id === args.runId).length,
    latest_rows: latest.length,
    ok_rows: latest.filter((row) => row.status === "OK").length,
    defect_parameters: {
      grass_d3_long_term_value_keywords: LONG_TERM_VALUE_KEYWORDS,
      heir_d5_wtp_anchor_multiplier: DEFECT_ANCHOR_MULTIPLIER,
      meta_leak_pattern: String(META_LEAK_PATTERN)
    },
    shared_jinang_draws: sharedDraws,
    map_sha256: Object.fromEntries(materials.personas.filter((persona) => PERSONA_IDS.includes(persona.id)).map((persona) => [persona.label, persona.map_sha256])),
    config_sha256: Object.fromEntries(configFiles.map((filePath) => [path.relative(ROOT, filePath), fileSha256(filePath)])),
    note: "Defect parameters are exploratory first-pass values, not calibrated against human traces. This run is a mechanism check, not fidelity/statistical claim."
  };
  fs.writeFileSync(paths.meta, JSON.stringify(meta, null, 2), "utf8");
  return meta;
}

function writeOutputs(paths, rows, args, materials) {
  const runRows = rows.filter((row) => row.run_id === args.runId);
  writeSummary(paths, runRows);
  writeSamples(paths, runRows);
  return writeMeta(paths, runRows, args, materials);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const paths = outputPaths(args.runId);
  loadLocalEnv();
  const materials = FullGame.loadMaterials();
  const pilotPersonas = materials.personas.filter((persona) => PERSONA_IDS.includes(persona.id));
  let rows = loadJsonl(paths.jsonl).filter((row) => row.run_id === args.runId);

  if (!args.summarizeOnly) {
    const { chatCompletion, hasAnyKey } = require("../../server/llm/deepseekClient");
    const { extractTags } = require("../../server/llm/tagExtractor");
    const { scoreTagsToDimensions } = require("../../server/llm/dimensionScorer");
    const vpWordScorer = require("../../server/llm/vpWordScorer");
    const vpCoach = require("../../server/llm/vpCoach");
    const personaGenerator = require("../../server/llm/personaGenerator");
    const embeddingService = require("../../server/llm/embeddingService");
    if (!hasAnyKey()) throw new Error("DeepSeek API key is required");
    await embeddingService.init();
    const runtime = { chatCompletion, extractTags, scoreTagsToDimensions, vpWordScorer, vpCoach, personaGenerator };
    const completed = new Set(latestRows(rows).filter((row) => row.status === "OK").map(chainKey));
    const sharedDraws = sharedDrawsFromRows(rows, materials);
    const tasks = pilotPersonas.flatMap((persona) => CONDITIONS.map((condition) => ({ persona, condition })))
      .filter((task) => !completed.has(`${task.persona.id}|${task.condition}|1`));
    console.log(`[harness_defect_pilot] existing=${rows.length} remaining=${tasks.length} concurrency=${args.concurrency}`);
    await runPool(tasks, args.concurrency, async (task, index) => {
      const options = buildDefectOptions(task.persona, task.condition, sharedDraws.get(task.persona.id));
      const row = await FullGame.runPlaythrough(runtime, task.persona, materials, args.runId, options);
      appendJsonl(paths.jsonl, row);
      console.log(`[harness_defect_pilot] ${index + 1}/${tasks.length} ${row.persona_label}/${row.condition} ${row.status} error=${row.error || ""}`);
    });
    rows = loadJsonl(paths.jsonl).filter((row) => row.run_id === args.runId);
  }
  const meta = writeOutputs(paths, rows, args, materials);
  console.log(JSON.stringify({ paths, meta }, null, 2));
}

module.exports = {
  RUN_ID,
  PERSONA_IDS,
  CONDITIONS,
  LONG_TERM_VALUE_KEYWORDS,
  DEFECT_ANCHOR_MULTIPLIER,
  filterLongTermValueSummary,
  biasD5WtpAnchor,
  anchorMention
};

if (require.main === module) {
  main().catch((error) => {
    console.error(error.stack || error.message || String(error));
    process.exitCode = 1;
  });
}
