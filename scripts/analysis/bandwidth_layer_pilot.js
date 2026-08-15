"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { spawnSync } = require("node:child_process");

const FullGame = require("./full_game_all_personas");
const { BandwidthLayer, DEFAULT_PARAMS } = require("./bandwidth_layer");
const { assertInfoSet } = require("./info_set_assert");

const ROOT = path.join(__dirname, "..", "..");
const RUN_ID = "bandwidth_layer_pilot_v1_2026-07-14";
const SPEC_PATH = path.join(ROOT, "docs", "CODEX_BANDWIDTH_LAYER_PILOT.md");
const INFO_SET_SPEC_PATH = path.join(ROOT, "docs", "CODEX_INFO_SET_ALIGNMENT.md");
const FULL_GAME_V2_RUN_ID = "full_game_all_personas_v2_2026-07-14";
const FULL_GAME_V2_JSONL = path.join(__dirname, `${FULL_GAME_V2_RUN_ID}.jsonl`);
const FULL_GAME_V2_META = path.join(__dirname, `${FULL_GAME_V2_RUN_ID}_meta.json`);
const DEFAULT_PERSONA_IDS = ["A", "D"];
const ALL_PERSONA_IDS = ["A", "D", "E", "B", "F", "C", "G"];
const ALL_RUN_ID = "bandwidth_layer_all_personas_v1_2026-07-14";
let PERSONA_IDS = DEFAULT_PERSONA_IDS.slice();
const CONDITIONS = ["B", "F"];

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

function parseArgs(argv) {
  const args = { runId: RUN_ID, concurrency: 1, summarizeOnly: false, allPersonas: false, runIdProvided: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--run-id") {
      args.runId = String(argv[++index] || "").trim();
      args.runIdProvided = true;
    }
    else if (arg === "--concurrency") args.concurrency = Number(argv[++index]);
    else if (arg === "--summarize-only") args.summarizeOnly = true;
    else if (arg === "--all-personas") args.allPersonas = true;
    else throw new Error(`unknown argument: ${arg}`);
  }
  if (args.allPersonas && !args.runIdProvided) args.runId = ALL_RUN_ID;
  args.personaIds = args.allPersonas ? ALL_PERSONA_IDS.slice() : DEFAULT_PERSONA_IDS.slice();
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
  return PERSONA_IDS.flatMap((personaId) => CONDITIONS.map((condition) => latest.get(`${personaId}|${condition}|1`))).filter(Boolean);
}

function latestRowsFromFile(filePath, runId) {
  const rows = loadJsonl(filePath).filter((row) => row.run_id === runId);
  const latest = new Map();
  for (const row of rows) latest.set(`${row.persona_id}|${row.condition}|${row.rep || 1}`, row);
  return Array.from(latest.values());
}

function loadFullGameV2Rows() {
  if (!fs.existsSync(FULL_GAME_V2_JSONL)) {
    throw new Error(`missing full_game v2 jsonl: ${path.relative(ROOT, FULL_GAME_V2_JSONL)}`);
  }
  const byPersona = new Map();
  for (const row of latestRowsFromFile(FULL_GAME_V2_JSONL, FULL_GAME_V2_RUN_ID)) {
    if (row.status === "OK" && PERSONA_IDS.includes(row.persona_id)) byPersona.set(row.persona_id, row);
  }
  for (const personaId of PERSONA_IDS) {
    if (!byPersona.has(personaId)) throw new Error(`full_game v2 latest OK missing persona ${personaId}`);
  }
  return byPersona;
}

function cloneAsF(row, runId) {
  const cloned = JSON.parse(JSON.stringify(row));
  cloned.run_id = runId;
  cloned.created_at = new Date().toISOString();
  cloned.condition = "F";
  cloned.map_condition = "F";
  cloned.rep = 1;
  cloned.reused_from = {
    run_id: row.run_id,
    condition: row.condition,
    source_jsonl: path.relative(ROOT, FULL_GAME_V2_JSONL),
    row_sha256: sha256(JSON.stringify(row)),
    reason: "F condition is full_game v2 unlimited-bandwidth apparatus with the same information set and reused jinang draw."
  };
  cloned.bandwidth_audit = {
    condition: "F",
    note: "No bandwidth filtering; full map and full stack as in full_game v2."
  };
  return cloned;
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

function fmt(value, digits = 2) {
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
  if (!row) return "";
  const cards = row.r2?.d4?.parsed?.cards || [];
  const tiers = cardsByTier(cards);
  return `${cards.length}张 / low ${tiers.low || 0}, mid ${tiers.mid || 0}, high ${tiers.high || 0}`;
}

function trajectoryRows(rows) {
  const byPersonaCondition = new Map(rows.map((row) => [`${row.persona_id}|${row.condition}`, row]));
  return PERSONA_IDS.map((personaId) => {
    const b = byPersonaCondition.get(`${personaId}|B`);
    const f = byPersonaCondition.get(`${personaId}|F`);
    const label = b?.persona_label || f?.persona_label || personaId;
    const bR1 = b?.r1_choice?.parsed || {};
    const fR1 = f?.r1_choice?.parsed || {};
    const bD5 = b?.r2?.d5?.parsed || {};
    const fD5 = f?.r2?.d5?.parsed || {};
    return `| ${label} | ${fR1.grid_label || ""} / ${fR1.architecture || ""} | ${bR1.grid_label || ""} / ${bR1.architecture || ""} | ${cardDigest(f)} | ${cardDigest(b)} | ${fmt(fD5.aligned_price, 0)} | ${fmt(bD5.aligned_price, 0)} |`;
  });
}

function economicsRows(rows) {
  const byPersonaCondition = new Map(rows.map((row) => [`${row.persona_id}|${row.condition}`, row]));
  return PERSONA_IDS.map((personaId) => {
    const b = byPersonaCondition.get(`${personaId}|B`);
    const f = byPersonaCondition.get(`${personaId}|F`);
    const label = b?.persona_label || f?.persona_label || personaId;
    const bm = b?.r2?.calculate?.metrics || {};
    const fm = f?.r2?.calculate?.metrics || {};
    return `| ${label} | ${fmt(fm.Q, 0)} | ${fmt(bm.Q, 0)} | ${fmt(fm.profit, 0)} | ${fmt(bm.profit, 0)} | ${fmt(Number(bm.profit || 0) - Number(fm.profit || 0), 0)} |`;
  });
}

function collectStepSources(row, stage) {
  const out = new Set();
  if (stage === "R1") {
    const parsed = row.r1_choice?.parsed || {};
    (parsed.map_sources || []).forEach((item) => out.add(item));
    (parsed.updated_constraints || []).forEach((item) => out.add(item.source));
  } else if (stage === "D3") {
    const parsed = row.r2?.d3?.parsed || {};
    (parsed.updated_constraints || []).forEach((item) => out.add(item.source));
  } else if (stage === "D4") {
    const parsed = row.r2?.d4?.parsed || {};
    if (parsed.cost_stance?.source) out.add(parsed.cost_stance.source);
    (parsed.updated_constraints || []).forEach((item) => out.add(item.source));
  } else if (stage === "D5") {
    const parsed = row.r2?.d5?.parsed || {};
    if (parsed.basis?.source) out.add(parsed.basis.source);
  }
  return Array.from(out).filter((source) => /^map_/.test(source));
}

function stepDigest(row, stage) {
  if (!row) return "";
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
  if (stage === "D5") return String(row.r2?.d5?.parsed?.aligned_price || "");
  return "";
}

function directionNote(personaId, b, f) {
  const bPrice = Number(b?.r2?.d5?.parsed?.aligned_price || 0);
  const fPrice = Number(f?.r2?.d5?.parsed?.aligned_price || 0);
  const bTiers = cardsByTier(b?.r2?.d4?.parsed?.cards || []);
  const fTiers = cardsByTier(f?.r2?.d4?.parsed?.cards || []);
  if (personaId === "A") {
    if (bPrice <= fPrice || (bTiers.high || 0) < (fTiers.high || 0)) {
      return "偏保守/低价/少高配，方向符合草根现金与试单隧道";
    }
    return "方向待判读";
  }
  if (personaId === "D") {
    if (bPrice >= fPrice || (bTiers.high || 0) >= (fTiers.high || 0)) {
      return "偏高价/高配/品质背书，方向符合二代品质执念";
    }
    return "方向待判读";
  }
  return "待判读";
}

function directEvidenceRows(rows) {
  const byPersonaCondition = new Map(rows.map((row) => [`${row.persona_id}|${row.condition}`, row]));
  const lines = [];
  for (const personaId of PERSONA_IDS) {
    const b = byPersonaCondition.get(`${personaId}|B`);
    const f = byPersonaCondition.get(`${personaId}|F`);
    const label = b?.persona_label || f?.persona_label || personaId;
    for (const stage of ["R1", "D3", "D4", "D5"]) {
      const audit = (b?.bandwidth_audit?.calls || []).find((call) => call.stage === stage);
      if (!audit) continue;
      const omittedById = new Map((audit.map_items || []).filter((item) => !item.selected).map((item) => [item.id, item]));
      const fSources = collectStepSources(f, stage);
      const omittedSources = fSources.filter((source) => omittedById.has(source));
      const differs = stepDigest(b, stage) !== stepDigest(f, stage);
      if (omittedSources.length || (differs && audit.stack_summary?.applied)) {
        const omittedText = omittedSources.map((source) => {
          const item = omittedById.get(source);
          return `${source}(${item?.omitted_reason || "omitted"}, rank ${item?.rank || ""})`;
        }).join("；") || "无 F 显式引用地图被挡";
        const stackNote = audit.stack_summary?.applied
          ? `栈摘要 ${audit.stack_summary.before.length}条→${audit.stack_summary.after.length}条，每条≤${DEFAULT_PARAMS.stack_summary_max_chars}字`
          : "未摘要";
        lines.push(`| ${label} | ${stage} | ${audit.B}/${audit.map_total} | ${omittedText} | ${differs ? "是" : "否"} | ${stackNote} | ${directionNote(personaId, b, f)} |`);
      }
    }
  }
  if (!lines.length) lines.push("| （无） | - | - | 未发现 F 显式引用而 B 预算挡掉且决策不同的强证据 | - | - | - |");
  return lines;
}

function metaLeakText(row) {
  const texts = [
    row.r1_choice?.raw_response,
    ...((row.coach?.turns || []).filter((turn) => turn.role === "user").map((turn) => turn.content)),
    row.r2?.d3?.raw_response,
    row.r2?.d4?.raw_response,
    row.r2?.d5?.raw_response
  ].join("\n");
  const hits = texts.match(/我可能遗漏|可能遗漏|没看到|看不全|信息不足|无法判断|不确定/g) || [];
  return Array.from(new Set(hits));
}

function metaLeakRows(rows) {
  return rows.filter((row) => row.condition === "B").map((row) => {
    const hits = metaLeakText(row);
    return `| ${row.persona_label} | ${hits.length ? hits.join("、") : "未发现"} |`;
  });
}

function interpretationRows(rows) {
  const byPersonaCondition = new Map(rows.map((row) => [`${row.persona_id}|${row.condition}`, row]));
  return PERSONA_IDS.map((personaId) => {
    const b = byPersonaCondition.get(`${personaId}|B`);
    const f = byPersonaCondition.get(`${personaId}|F`);
    const label = b?.persona_label || f?.persona_label || personaId;
    const delta = Number(b?.r2?.calculate?.metrics?.profit || 0) - Number(f?.r2?.calculate?.metrics?.profit || 0);
    const bGrid = b?.r1_choice?.parsed?.grid_label || "";
    const fGrid = f?.r1_choice?.parsed?.grid_label || "";
    const bPrice = Number(b?.r2?.d5?.parsed?.aligned_price || 0);
    const fPrice = Number(f?.r2?.d5?.parsed?.aligned_price || 0);
    let reading = "待判读";
    if (personaId === "A") {
      reading = delta > 0
        ? "带宽层确实改变调用路径，但本次不是“变差”：从低价试单转向更高价/中配，反而修复了 F 链低价亏损。"
        : "带宽层导致更保守或更低效路径，方向更接近草根现金/试单隧道。";
    } else if (personaId === "D") {
      reading = delta < 0
        ? "带宽层造成显著经济退化；主要不是高价锚，而是老人陪伴/品质背书锚被挡后，R1 直接转向儿童格子，属于市场锚调用失败。"
        : "带宽层改变路径但未造成经济退化；方向需结合审计逐条看。";
    }
    return `| ${label} | ${fGrid} → ${bGrid} | ${fmt(fPrice, 0)} → ${fmt(bPrice, 0)} | ${fmt(delta, 0)} | ${reading} |`;
  });
}

function writeSummary(paths, rows) {
  const latest = latestRows(rows);
  const ok = latest.filter((row) => row.status === "OK");
  const expectedRows = PERSONA_IDS.length * CONDITIONS.length;
  const lines = [
    `# ${path.basename(paths.summary, "_summary.md")} Summary`,
    "",
    "## Device Note",
    "",
    "本轮是 bandwidth layer 首跑：F 条件复用 full_game v2 latest OK 行；B 条件在同一 full_game v2 信息集上只做减法（地图 top-B 与 D4/D5 栈摘要），所有 B 条件 R1/D3/D4/D5 prompt 继续经过 assertInfoSet。",
    "",
    "参数为试探值，未经真人 trace 校准；本结果只用于机制验证，不是保真度声明。",
    "",
    "## Completion",
    "",
    `- Latest rows: ${latest.length}/${expectedRows}`,
    `- OK: ${ok.length}/${expectedRows}`,
    `- B OK: ${ok.filter((row) => row.condition === "B").length}/${PERSONA_IDS.length}`,
    `- F reused OK: ${ok.filter((row) => row.condition === "F" && row.reused_from).length}/${PERSONA_IDS.length}`,
    `- Failed: ${latest.filter((row) => row.status !== "OK").map((row) => `${row.persona_label}/${row.condition}: ${row.error}`).join("；") || "none"}`,
    "",
    "## 1. 调用失败直接证据候选",
    "",
    "| Persona | Stage | B/map_total | F 同步决策引用但 B 被挡地图 | B vs F 决策不同 | 栈处理 | 方向判读 |",
    "|---|---|---:|---|---|---|---|",
    ...directEvidenceRows(ok),
    "",
    "## 2. 决策轨迹对照",
    "",
    "| Persona | F 格子/架构 | B 格子/架构 | F 选卡 | B 选卡 | F 价格 | B 价格 |",
    "|---|---|---|---|---|---:|---:|",
    ...trajectoryRows(ok),
    "",
    "## 3. 经济后果",
    "",
    "| Persona | F Q | B Q | F profit | B profit | B-F profit Δ |",
    "|---|---:|---:|---:|---:|---:|",
    ...economicsRows(ok),
    "",
    "## 4. 元认知泄漏检查",
    "",
    "| Persona | B 链理由文本命中 |",
    "|---|---|",
    ...metaLeakRows(ok),
    "",
    "## 5. 审计完整性",
    "",
    "| Persona | B calls audited | stages | min/max B | stack summary stages |",
    "|---|---:|---|---|---|",
    ...ok.filter((row) => row.condition === "B").map((row) => {
      const calls = row.bandwidth_audit?.calls || [];
      const budgets = calls.map((call) => Number(call.B)).filter(Number.isFinite);
      const summaryStages = calls.filter((call) => call.stack_summary?.applied).map((call) => call.call_id || call.stage);
      return `| ${row.persona_label} | ${calls.length} | ${calls.map((call) => call.call_id || call.stage).join(", ")} | ${Math.min(...budgets)}/${Math.max(...budgets)} | ${summaryStages.join(", ") || "none"} |`;
    }),
    "",
    "## 6. 初步方向读数",
    "",
    "| Persona | F→B 格子 | F→B 价格 | B-F profit Δ | 读数 |",
    "|---|---|---:|---:|---|",
    ...interpretationRows(ok),
    "",
    "## One-sentence Observation",
    "",
    "看 B/F 决策差异是否能在审计中追到“信息在库里、但未进入当次 prompt”的具体地图/栈片段；若能追到，就是 overload 机制的首个代码化证据点。",
    ""
  ];
  fs.writeFileSync(paths.summary, lines.join("\n"), "utf8");
}

function writeSamples(paths, rows) {
  const latest = latestRows(rows);
  const lines = [`# ${RUN_ID} Raw Samples`, ""];
  for (const row of latest) {
    lines.push(`## ${row.persona_label} / ${row.condition} (${row.status})`, "");
    if (row.reused_from) lines.push("### Reused From", "", "```json", JSON.stringify(row.reused_from, null, 2), "```", "");
    if (row.error) lines.push(`Error: ${row.error}`, "");
    lines.push("### R1", "", "#### Prompt", "", row.r1_choice?.prompt || "", "", "#### Raw", "", row.r1_choice?.raw_response || "", "", "#### Parsed", "", "```json", JSON.stringify(row.r1_choice?.parsed || null, null, 2), "```", "");
    lines.push("### Coach", "");
    for (const turn of row.coach?.turns || []) lines.push(`- ${turn.role}: ${turn.content}`);
    lines.push("", "### D3", "", "#### Prompt", "", row.r2?.d3?.prompt || "", "", "#### Raw", "", row.r2?.d3?.raw_response || "", "", "#### Parsed", "", "```json", JSON.stringify(row.r2?.d3?.parsed || null, null, 2), "```", "");
    lines.push("### D4", "", "#### Prompt", "", row.r2?.d4?.prompt || "", "", "#### Raw", "", row.r2?.d4?.raw_response || "", "", "#### Parsed", "", "```json", JSON.stringify(row.r2?.d4?.parsed || null, null, 2), "```", "");
    lines.push("### D5", "", "#### Prompt", "", row.r2?.d5?.prompt || "", "", "#### Raw", "", row.r2?.d5?.raw_response || "", "", "#### Parsed", "", "```json", JSON.stringify(row.r2?.d5?.parsed || null, null, 2), "```", "");
    lines.push("### Calculate", "", "```json", JSON.stringify(row.r2?.calculate || null, null, 2), "```", "");
    if (row.condition === "B") {
      lines.push("### Bandwidth Audit", "", "```json", JSON.stringify(row.bandwidth_audit || null, null, 2), "```", "");
    }
  }
  fs.writeFileSync(paths.samples, lines.join("\n"), "utf8");
}

function writeAudit(paths, rows) {
  const latest = latestRows(rows).filter((row) => row.condition === "B");
  const audit = latest.map((row) => ({
    persona_id: row.persona_id,
    persona_label: row.persona_label,
    status: row.status,
    calls: row.bandwidth_audit?.calls || []
  }));
  fs.writeFileSync(paths.audit, JSON.stringify(audit, null, 2), "utf8");
}

function writeMeta(paths, rows, args, materials) {
  const configFiles = [
    SPEC_PATH,
    INFO_SET_SPEC_PATH,
    __filename,
    path.join(__dirname, "bandwidth_layer.js"),
    path.join(__dirname, "full_game_all_personas.js"),
    path.join(__dirname, "info_set_assert.js"),
    FULL_GAME_V2_JSONL,
    FULL_GAME_V2_META
  ].filter((filePath) => fs.existsSync(filePath));
  const latest = latestRows(rows);
  const meta = {
    run_id: args.runId,
    generated_at: new Date().toISOString(),
    git_head: gitHead(),
    rows_total: rows.filter((row) => row.run_id === args.runId).length,
    latest_rows: latest.length,
    ok_rows: latest.filter((row) => row.status === "OK").length,
    matrix: `${PERSONA_IDS.length} persona × {B bandwidth, F full_game_v2_reused} × 1`,
    bandwidth_params: DEFAULT_PARAMS,
    f_condition_reuse: {
      source_run_id: FULL_GAME_V2_RUN_ID,
      source_jsonl: path.relative(ROOT, FULL_GAME_V2_JSONL),
      apparatus_consistency: "F reuses full_game v2 latest OK rows: same info-set aligned prompts, same run device, same jinang draw; bandwidth hook is absent in F."
    },
    b_condition: {
      prompt_info_set_assertion: "R1/D3/D4/D5 prompts are asserted by full_game_all_personas.js assertInfoSet before LLM calls.",
      bandwidth_only_subtracts: true,
      audit_path: path.relative(ROOT, paths.audit)
    },
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

function writeOutputs(paths, rows, args, materials) {
  const runRows = rows.filter((row) => row.run_id === args.runId);
  writeSummary(paths, runRows);
  writeSamples(paths, runRows);
  writeAudit(paths, runRows);
  return writeMeta(paths, runRows, args, materials);
}

function assertLatestBPrompts(rows) {
  const latest = latestRows(rows);
  for (const row of latest.filter((item) => item.condition === "B" && item.status === "OK")) {
    assertInfoSet(row.r1_choice.prompt, "R1");
    assertInfoSet(row.r2.d3.prompt, "D3");
    assertInfoSet(row.r2.d4.prompt, "D4");
    assertInfoSet(row.r2.d5.prompt, "D5");
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  PERSONA_IDS = args.personaIds.slice();
  const paths = outputPaths(args.runId);
  loadLocalEnv();
  const materials = FullGame.loadMaterials();
  const personas = materials.personas.filter((persona) => PERSONA_IDS.includes(persona.id));
  const fullGameRows = loadFullGameV2Rows();
  let rows = loadJsonl(paths.jsonl).filter((row) => row.run_id === args.runId);

  const completed = new Set(latestRows(rows).filter((row) => row.status === "OK").map(chainKey));
  for (const persona of personas) {
    if (!completed.has(`${persona.id}|F|1`)) {
      appendJsonl(paths.jsonl, cloneAsF(fullGameRows.get(persona.id), args.runId));
    }
  }
  rows = loadJsonl(paths.jsonl).filter((row) => row.run_id === args.runId);

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
    const bandwidthLayer = new BandwidthLayer({ embeddingService, params: DEFAULT_PARAMS });
    const currentCompleted = new Set(latestRows(rows).filter((row) => row.status === "OK").map(chainKey));
    const tasks = personas.filter((persona) => !currentCompleted.has(`${persona.id}|B|1`));
    console.log(`[bandwidth_layer_pilot] existing=${rows.length} remaining_B=${tasks.length} concurrency=${args.concurrency}`);
    await runPool(tasks, args.concurrency, async (persona, index) => {
      const fRow = fullGameRows.get(persona.id);
      const row = await FullGame.runPlaythrough(runtime, persona, materials, args.runId, {
        condition: "B",
        rep: 1,
        jinangDraw: fRow.r0_jinang,
        bandwidthLayer
      });
      appendJsonl(paths.jsonl, row);
      console.log(`[bandwidth_layer_pilot] ${index + 1}/${tasks.length} ${row.persona_label} ${row.condition} ${row.status} calls=${JSON.stringify(row.calls)} error=${row.error || ""}`);
    });
    rows = loadJsonl(paths.jsonl).filter((row) => row.run_id === args.runId);
  }

  assertLatestBPrompts(rows);
  const meta = writeOutputs(paths, rows, args, materials);
  console.log(JSON.stringify({ paths, meta }, null, 2));
}

module.exports = {
  RUN_ID,
  PERSONA_IDS,
  CONDITIONS,
  loadFullGameV2Rows,
  cloneAsF,
  directEvidenceRows,
  writeOutputs
};

if (require.main === module) {
  main().catch((error) => {
    console.error(error.stack || error.message || String(error));
    process.exitCode = 1;
  });
}
