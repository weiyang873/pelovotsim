"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { spawnSync } = require("node:child_process");

const FullGame = require("./full_game_all_personas");
const { BandwidthLayer, DEFAULT_PARAMS } = require("./bandwidth_layer");
const { assertInfoSet } = require("./info_set_assert");

const ROOT = path.join(__dirname, "..", "..");
const RUN_ID = "bandwidth_layer_paired_v2r_2026-07-14";
const SPEC_PATH = path.join(ROOT, "docs", "CODEX_BANDWIDTH_LAYER_PILOT.md");
const INFO_SET_SPEC_PATH = path.join(ROOT, "docs", "CODEX_INFO_SET_ALIGNMENT.md");
const V1_JSONL_PATH = path.join(__dirname, "full_game_all_personas_v1_2026-07-14.jsonl");
const PERSONA_IDS = ["A", "D", "E", "B", "F", "C", "G"];
const CONDITIONS = ["F", "B"];

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

function loadLocalEnv() {
  const candidates = [
    process.env.CODEX_ENV_PATH,
    path.join(ROOT, ".env")
  ].filter(Boolean);
  for (const envPath of candidates) {
    if (!fs.existsSync(envPath)) continue;
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
    return envPath;
  }
  return "";
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
    meta: path.join(__dirname, `${runId}_meta.json`),
    audit: path.join(__dirname, `${runId}_audit.json`)
  };
}

function appendJsonl(filePath, row) {
  fs.appendFileSync(filePath, `${JSON.stringify(row)}\n`, "utf8");
}

function loadJsonl(filePath) {
  if (!fs.existsSync(filePath)) return [];
  return fs.readFileSync(filePath, "utf8").split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
}

function chainKey(row) {
  return `${row.persona_id}|${row.condition}|${row.rep || 1}`;
}

function latestRows(rows) {
  const latest = new Map();
  for (const row of rows) latest.set(chainKey(row), row);
  const ordered = [];
  for (const personaId of PERSONA_IDS) {
    for (const condition of CONDITIONS) {
      const row = latest.get(`${personaId}|${condition}|1`);
      if (row) ordered.push(row);
    }
  }
  return ordered;
}

function latestRowMap(rows) {
  const map = new Map();
  for (const row of rows) map.set(chainKey(row), row);
  return map;
}

function loadJinangDrawsFromV1() {
  const latest = new Map();
  for (const row of loadJsonl(V1_JSONL_PATH)) {
    latest.set(`${row.persona_id}|${row.condition}|${row.rep || 1}`, row);
  }
  const draws = new Map();
  for (const row of latest.values()) {
    if (row.status === "OK" && row.r0_jinang?.market?.id && row.r0_jinang?.tech?.id) {
      draws.set(row.persona_id, row.r0_jinang);
    }
  }
  return draws;
}

async function runPool(tasks, concurrency, worker) {
  let cursor = 0;
  async function lane() {
    while (cursor < tasks.length) {
      const index = cursor;
      cursor += 1;
      if (index >= tasks.length) return;
      await worker(tasks[index], index);
    }
  }
  return Promise.all(Array.from({ length: Math.min(concurrency, tasks.length) }, () => lane()));
}

function fmt(value, digits = 0) {
  const num = Number(value);
  if (!Number.isFinite(num)) return "";
  return digits === 0 ? String(Math.round(num)) : String(Math.round(num * (10 ** digits)) / (10 ** digits));
}

function cardsByTier(cards) {
  const counts = { low: 0, mid: 0, high: 0 };
  for (const card of cards || []) counts[card.tier] = (counts[card.tier] || 0) + 1;
  return counts;
}

function cardDigest(row) {
  const cards = row?.r2?.d4?.parsed?.cards || [];
  const tiers = cardsByTier(cards);
  return `${cards.length}张 / low ${tiers.low || 0}, mid ${tiers.mid || 0}, high ${tiers.high || 0}`;
}

function collectSources(row, stage) {
  const sources = new Set();
  if (stage === "R1") {
    const r1 = row.r1_choice?.parsed || {};
    (r1.map_sources || []).forEach((item) => sources.add(item));
    (r1.updated_constraints || []).forEach((item) => sources.add(item.source));
  } else if (stage === "D3") {
    (row.r2?.d3?.parsed?.updated_constraints || []).forEach((item) => sources.add(item.source));
  } else if (stage === "D4") {
    const d4 = row.r2?.d4?.parsed || {};
    if (d4.cost_stance?.source) sources.add(d4.cost_stance.source);
    (d4.updated_constraints || []).forEach((item) => sources.add(item.source));
  } else if (stage === "D5") {
    const source = row.r2?.d5?.parsed?.basis?.source;
    if (source) sources.add(source);
  }
  return Array.from(sources).filter((item) => /^map_/.test(item));
}

function stepDigest(row, stage) {
  if (stage === "R1") {
    const r1 = row.r1_choice?.parsed || {};
    return `${r1.grid_id}|${r1.architecture}|${r1.vp_draft?.who}|${r1.vp_draft?.pain}|${r1.vp_draft?.how}`;
  }
  if (stage === "D3") {
    const d3 = row.r2?.d3?.parsed || {};
    return `${(d3.key_evidence || []).join("|")}|${d3.market_judgment}`;
  }
  if (stage === "D4") {
    return (row.r2?.d4?.parsed?.cards || []).map((card) => `${card.id}@${card.tier}`).sort().join(",");
  }
  if (stage === "D5") return String(row.r2?.d5?.parsed?.aligned_price || row.r2?.d5?.parsed?.price || "");
  return "";
}

function directEvidenceRows(rows) {
  const byKey = new Map(rows.map((row) => [`${row.persona_id}|${row.condition}`, row]));
  const lines = [];
  for (const personaId of PERSONA_IDS) {
    const f = byKey.get(`${personaId}|F`);
    const b = byKey.get(`${personaId}|B`);
    const label = b?.persona_label || f?.persona_label || personaId;
    if (!f || !b || f.status !== "OK" || b.status !== "OK") {
      lines.push(`| ${label} | - | - | pair incomplete | - | - |`);
      continue;
    }
    for (const stage of ["R1", "D3", "D4", "D5"]) {
      const audit = (b.bandwidth_audit?.calls || []).find((call) => call.stage === stage);
      if (!audit) continue;
      const omittedById = new Map((audit.map_items || []).filter((item) => !item.selected).map((item) => [item.id, item]));
      const fSources = collectSources(f, stage);
      const omittedSources = fSources.filter((source) => omittedById.has(source));
      const differs = stepDigest(f, stage) !== stepDigest(b, stage);
      if (!omittedSources.length && !(differs && audit.stack_summary?.applied)) continue;
      const omittedText = omittedSources.map((source) => {
        const item = omittedById.get(source);
        return `${source}(rank ${item?.rank || ""}, ${item?.omitted_reason || "omitted"})`;
      }).join("；") || "无 F 显式 map id 被挡";
      const stackText = audit.stack_summary?.applied
        ? `摘要 ${audit.stack_summary.before.length}→${audit.stack_summary.after.length}`
        : "全文";
      lines.push(`| ${label} | ${stage} | ${audit.B}/${audit.map_total} | ${omittedText} | ${differs ? "是" : "否"} | ${stackText} |`);
    }
  }
  if (!lines.length) lines.push("| （无） | - | - | 未发现强证据 | - | - |");
  return lines;
}

function collectAssertRecords(rows) {
  const records = [];
  for (const row of latestRows(rows).filter((item) => item.status === "OK")) {
    const prompts = {
      R1: row.r1_choice?.prompt,
      D3: row.r2?.d3?.prompt,
      D4: row.r2?.d4?.prompt,
      D5: row.r2?.d5?.prompt
    };
    for (const [stage, prompt] of Object.entries(prompts)) {
      const record = {
        persona_id: row.persona_id,
        persona_label: row.persona_label,
        condition: row.condition,
        stage,
        prompt_sha256: row[stage === "R1" ? "r1_choice" : "r2"] ? sha256(String(prompt || "")) : "",
        checked_at: new Date().toISOString(),
        status: "PASS"
      };
      try {
        assertInfoSet(prompt, stage);
      } catch (error) {
        record.status = "FAIL";
        record.error = error.message || String(error);
      }
      records.push(record);
    }
  }
  const failed = records.filter((record) => record.status !== "PASS");
  if (failed.length) throw new Error(`assertInfoSet failed: ${JSON.stringify(failed.slice(0, 3))}`);
  return records;
}

function writeSummary(paths, rows) {
  const latest = latestRows(rows);
  const ok = latest.filter((row) => row.status === "OK");
  const byKey = new Map(latest.map((row) => [`${row.persona_id}|${row.condition}`, row]));
  const lines = [
    `# ${path.basename(paths.summary, "_summary.md")} Summary`,
    "",
    "## Device Note",
    "",
    "Paired v2r：F 与 B 均在本 run 内用当前已提交 `full_game_all_personas.js` 重新生成；F 不传 bandwidth hook，B 只增加 bandwidth layer；同一 persona 的 F/B 共用同一 r0_jinang。",
    "",
    "参数仍为试探值，未经真人 trace 校准；本结果只用于机制验证，不是保真度声明。",
    "",
    "## Completion",
    "",
    `- Latest rows: ${latest.length}/14`,
    `- OK: ${ok.length}/14`,
    `- Failed: ${latest.filter((row) => row.status !== "OK").map((row) => `${row.persona_label}/${row.condition}: ${row.error}`).join("；") || "none"}`,
    "",
    "## 1. Paired trajectory",
    "",
    "| Persona | F 格子/架构 | B 格子/架构 | F 选卡 | B 选卡 | F 价格 | B 价格 | F profit | B profit | Δ(B-F) |",
    "|---|---|---|---|---|---:|---:|---:|---:|---:|",
    ...PERSONA_IDS.map((personaId) => {
      const f = byKey.get(`${personaId}|F`);
      const b = byKey.get(`${personaId}|B`);
      const label = b?.persona_label || f?.persona_label || personaId;
      const fR1 = f?.r1_choice?.parsed || {};
      const bR1 = b?.r1_choice?.parsed || {};
      const fPrice = f?.r2?.d5?.parsed?.aligned_price || f?.r2?.d5?.parsed?.price;
      const bPrice = b?.r2?.d5?.parsed?.aligned_price || b?.r2?.d5?.parsed?.price;
      const fProfit = Number(f?.r2?.calculate?.metrics?.profit || 0);
      const bProfit = Number(b?.r2?.calculate?.metrics?.profit || 0);
      return `| ${label} | ${fR1.grid_id || ""}/${fR1.architecture || ""} | ${bR1.grid_id || ""}/${bR1.architecture || ""} | ${cardDigest(f)} | ${cardDigest(b)} | ${fmt(fPrice)} | ${fmt(bPrice)} | ${fmt(fProfit)} | ${fmt(bProfit)} | ${fmt(bProfit - fProfit)} |`;
    }),
    "",
    "## 2. 调用失败直接证据候选",
    "",
    "| Persona | Stage | B/map_total | F 引用但 B 被挡地图 | B vs F 决策不同 | 栈处理 |",
    "|---|---|---:|---|---|---|",
    ...directEvidenceRows(ok),
    "",
    "## 3. B audit completeness",
    "",
    "| Persona | B calls audited | stages | B sequence | timestamp sequence | stack summary stages |",
    "|---|---:|---|---|---|---|",
    ...ok.filter((row) => row.condition === "B").map((row) => {
      const calls = row.bandwidth_audit?.calls || [];
      return `| ${row.persona_label} | ${calls.length} | ${calls.map((call) => call.call_id || call.stage).join(", ")} | ${calls.map((call) => call.B).join("→")} | ${calls.map((call) => call.audit_created_at || "").join("→")} | ${calls.filter((call) => call.stack_summary?.applied).map((call) => call.call_id || call.stage).join(", ") || "none"} |`;
    }),
    "",
    "## 4. AssertInfoSet",
    "",
    "R1/D3/D4/D5 prompts for all OK F/B rows are re-checked at output time; pass records are in meta.assert_info_set_records.",
    ""
  ];
  fs.writeFileSync(paths.summary, lines.join("\n"), "utf8");
}

function writeSamples(paths, rows) {
  const lines = [`# ${path.basename(paths.samples, "_raw_samples.md")} Raw Samples`, ""];
  for (const row of latestRows(rows)) {
    lines.push(`## ${row.persona_label} / ${row.condition} (${row.status})`, "");
    if (row.error) lines.push(`Error: ${row.error}`, "");
    lines.push("### R0 Jinang", "", "```json", JSON.stringify(row.r0_jinang || null, null, 2), "```", "");
    lines.push("### R1", "", "#### Prompt", "", row.r1_choice?.prompt || "", "", "#### Raw", "", row.r1_choice?.raw_response || "", "", "#### Parsed", "", "```json", JSON.stringify(row.r1_choice?.parsed || null, null, 2), "```", "");
    lines.push("### Coach", "");
    for (const turn of row.coach?.turns || []) lines.push(`- ${turn.role}: ${turn.content}`);
    lines.push("", "### D3", "", "#### Prompt", "", row.r2?.d3?.prompt || "", "", "#### Raw", "", row.r2?.d3?.raw_response || "", "", "#### Parsed", "", "```json", JSON.stringify(row.r2?.d3?.parsed || null, null, 2), "```", "");
    lines.push("### D4", "", "#### Prompt", "", row.r2?.d4?.prompt || "", "", "#### Raw", "", row.r2?.d4?.raw_response || "", "", "#### Parsed", "", "```json", JSON.stringify(row.r2?.d4?.parsed || null, null, 2), "```", "");
    lines.push("### D5", "", "#### Prompt", "", row.r2?.d5?.prompt || "", "", "#### Raw", "", row.r2?.d5?.raw_response || "", "", "#### Parsed", "", "```json", JSON.stringify(row.r2?.d5?.parsed || null, null, 2), "```", "");
    lines.push("### Calculate", "", "```json", JSON.stringify(row.r2?.calculate || null, null, 2), "```", "");
    if (row.condition === "B") lines.push("### Bandwidth Audit", "", "```json", JSON.stringify(row.bandwidth_audit || null, null, 2), "```", "");
  }
  fs.writeFileSync(paths.samples, lines.join("\n"), "utf8");
}

function writeAudit(paths, rows) {
  const latest = latestRows(rows);
  const audit = {
    run_id: path.basename(paths.audit, "_audit.json"),
    generated_at: new Date().toISOString(),
    note: "B rows only; F rows have no bandwidth filtering.",
    personas: latest.filter((row) => row.condition === "B").map((row) => ({
      persona_id: row.persona_id,
      persona_label: row.persona_label,
      status: row.status,
      r0_jinang: row.r0_jinang,
      calls: row.bandwidth_audit?.calls || []
    }))
  };
  fs.writeFileSync(paths.audit, JSON.stringify(audit, null, 2), "utf8");
}

function writeMeta(paths, rows, args, materials, extra) {
  const configFiles = [
    SPEC_PATH,
    INFO_SET_SPEC_PATH,
    __filename,
    path.join(__dirname, "bandwidth_layer.js"),
    path.join(__dirname, "full_game_all_personas.js"),
    path.join(__dirname, "info_set_assert.js"),
    V1_JSONL_PATH
  ].filter((filePath) => fs.existsSync(filePath));
  const latest = latestRows(rows);
  const meta = {
    run_id: args.runId,
    generated_at: new Date().toISOString(),
    git_head: gitHead(),
    rows_total: rows.filter((row) => row.run_id === args.runId).length,
    latest_rows: latest.length,
    ok_rows: latest.filter((row) => row.status === "OK").length,
    matrix: "7 persona × {F fresh unlimited, B fresh bandwidth} × 1 paired",
    paired_design: {
      f_condition: "fresh FullGame.runPlaythrough without bandwidthLayer",
      b_condition: "fresh FullGame.runPlaythrough with BandwidthLayer",
      shared_r0_jinang: "F/B for each persona use the same draw, loaded from full_game_all_personas_v1_2026-07-14.jsonl when available.",
      old_v2_policy: "full_game_all_personas_v2_2026-07-14 is not used as F baseline in this run."
    },
    bandwidth_params: DEFAULT_PARAMS,
    llm_config: extra.llmConfig,
    assert_info_set_records: extra.assertRecords,
    persona_map_sha256: Object.fromEntries(
      materials.personas
        .filter((persona) => PERSONA_IDS.includes(persona.id))
        .map((persona) => [persona.label, persona.map_sha256])
    ),
    config_sha256: Object.fromEntries(configFiles.map((filePath) => [path.relative(ROOT, filePath), fileSha256(filePath)])),
    output_sha256: {
      jsonl: fs.existsSync(paths.jsonl) ? fileSha256(paths.jsonl) : null,
      summary: fs.existsSync(paths.summary) ? fileSha256(paths.summary) : null,
      raw_samples: fs.existsSync(paths.samples) ? fileSha256(paths.samples) : null,
      audit: fs.existsSync(paths.audit) ? fileSha256(paths.audit) : null
    }
  };
  fs.writeFileSync(paths.meta, JSON.stringify(meta, null, 2), "utf8");
  return meta;
}

function writeOutputs(paths, rows, args, materials, llmConfig) {
  const runRows = rows.filter((row) => row.run_id === args.runId);
  const assertRecords = collectAssertRecords(runRows);
  writeSummary(paths, runRows);
  writeSamples(paths, runRows);
  writeAudit(paths, runRows);
  return writeMeta(paths, runRows, args, materials, { assertRecords, llmConfig });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const paths = outputPaths(args.runId);
  const envPath = loadLocalEnv();
  const materials = FullGame.loadMaterials();
  const personas = materials.personas.filter((persona) => PERSONA_IDS.includes(persona.id));
  let rows = loadJsonl(paths.jsonl).filter((row) => row.run_id === args.runId);

  const deepseek = require("../../server/llm/deepseekClient");
  const llmConfig = {
    env_path_loaded: envPath ? path.relative(ROOT, envPath) : "",
    provider: "deepseek",
    model: process.env.DEEPSEEK_MODEL || "deepseek-chat",
    base_url: process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com",
    key_count: deepseek.__TEST_GET_POOL ? deepseek.__TEST_GET_POOL().length : null,
    llm_concurrency: Number(process.env.LLM_CONCURRENCY || 10),
    deepseek_timeout_ms: Number(process.env.DEEPSEEK_TIMEOUT_MS || 60000),
    llm_max_retries_env: Number(process.env.LLM_MAX_RETRIES || 1),
    decision_json: { temperature: 0.55, max_tokens: 1600, max_repairs: 2, max_retries_per_attempt: 1 },
    coach: { vpCoach_temperature: 0.55, persona_reply_temperature: 0.75, persona_reply_max_tokens: 500 },
    run_concurrency: args.concurrency
  };

  if (!args.summarizeOnly) {
    const { chatCompletion, hasAnyKey } = deepseek;
    const { extractTags } = require("../../server/llm/tagExtractor");
    const { scoreTagsToDimensions } = require("../../server/llm/dimensionScorer");
    const vpWordScorer = require("../../server/llm/vpWordScorer");
    const vpCoach = require("../../server/llm/vpCoach");
    const personaGenerator = require("../../server/llm/personaGenerator");
    const embeddingService = require("../../server/llm/embeddingService");
    if (!hasAnyKey()) throw new Error("DeepSeek API key is required");
    await embeddingService.init();
    const runtime = { chatCompletion, extractTags, scoreTagsToDimensions, vpWordScorer, vpCoach, personaGenerator };
    const bandwidthLayer = new BandwidthLayer({ embeddingService, params: DEFAULT_PARAMS });
    const draws = loadJinangDrawsFromV1();
    const completed = latestRowMap(rows);
    const tasks = personas.filter((persona) => {
      const fDone = completed.get(`${persona.id}|F|1`)?.status === "OK";
      const bDone = completed.get(`${persona.id}|B|1`)?.status === "OK";
      return !fDone || !bDone;
    });
    console.log(`[bandwidth_layer_paired_v2r] existing=${rows.length} remaining_personas=${tasks.length} concurrency=${args.concurrency} reused_jinang=${draws.size}`);
    await runPool(tasks, args.concurrency, async (persona, index) => {
      let latest = latestRowMap(loadJsonl(paths.jsonl).filter((row) => row.run_id === args.runId));
      let fRow = latest.get(`${persona.id}|F|1`);
      const draw = fRow?.status === "OK" && fRow.r0_jinang ? fRow.r0_jinang : (draws.get(persona.id) || FullGame.drawJinang(materials.jinangConfig));

      if (fRow?.status !== "OK") {
        const startedAt = new Date().toISOString();
        fRow = await FullGame.runPlaythrough(runtime, persona, materials, args.runId, {
          condition: "F",
          rep: 1,
          jinangDraw: draw
        });
        fRow.paired_run = { pair_id: `${persona.id}|1`, condition: "F", started_at: startedAt, ended_at: new Date().toISOString() };
        fRow.bandwidth_audit = { condition: "F", note: "No bandwidth filtering; full map and full stack." };
        appendJsonl(paths.jsonl, fRow);
        console.log(`[bandwidth_layer_paired_v2r] ${index + 1}/${tasks.length} ${persona.label} F ${fRow.status} error=${fRow.error || ""}`);
      }

      latest = latestRowMap(loadJsonl(paths.jsonl).filter((row) => row.run_id === args.runId));
      const bExisting = latest.get(`${persona.id}|B|1`);
      if (fRow.status === "OK" && bExisting?.status !== "OK") {
        const startedAt = new Date().toISOString();
        const bRow = await FullGame.runPlaythrough(runtime, persona, materials, args.runId, {
          condition: "B",
          rep: 1,
          jinangDraw: fRow.r0_jinang,
          bandwidthLayer
        });
        bRow.paired_run = { pair_id: `${persona.id}|1`, condition: "B", paired_f_row_sha256: sha256(JSON.stringify(fRow)), started_at: startedAt, ended_at: new Date().toISOString() };
        appendJsonl(paths.jsonl, bRow);
        console.log(`[bandwidth_layer_paired_v2r] ${index + 1}/${tasks.length} ${persona.label} B ${bRow.status} error=${bRow.error || ""}`);
      }
    });
    rows = loadJsonl(paths.jsonl).filter((row) => row.run_id === args.runId);
  }

  const meta = writeOutputs(paths, rows, args, materials, llmConfig);
  console.log(JSON.stringify({ paths, meta }, null, 2));
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.stack || error.message || String(error));
    process.exitCode = 1;
  });
}
