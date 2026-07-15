"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { spawnSync } = require("node:child_process");

const FullGame = require("./full_game_all_personas");
const { BandwidthLayer, DEFAULT_PARAMS } = require("./bandwidth_layer");
const { assertInfoSet } = require("./info_set_assert");

const ROOT = path.join(__dirname, "..", "..");
const RUN_ID = "bandwidth_proportional_n3_2026-07-15";
const SPEC_PATH = path.join(ROOT, "docs", "CODEX_BANDWIDTH_PROPORTIONAL_N3.md");
const INFO_SET_SPEC_PATH = path.join(ROOT, "docs", "CODEX_INFO_SET_ALIGNMENT.md");
const V1_JSONL_PATH = path.join(__dirname, "full_game_all_personas_v1_2026-07-14.jsonl");
const PERSONA_IDS = ["A", "D", "E", "B", "F", "C", "G"];
const CONDITIONS = ["F", "B"];
const REPS = [1, 2, 3];

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
  const args = { runId: RUN_ID, concurrency: 1, summarizeOnly: false, maxChainAttempts: 3 };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--run-id") args.runId = String(argv[++index] || "").trim();
    else if (arg === "--concurrency") args.concurrency = Number(argv[++index]);
    else if (arg === "--max-chain-attempts") args.maxChainAttempts = Number(argv[++index]);
    else if (arg === "--summarize-only") args.summarizeOnly = true;
    else throw new Error(`unknown argument: ${arg}`);
  }
  if (!args.runId || !Number.isInteger(args.concurrency) || args.concurrency < 1) {
    throw new Error("invalid run id or concurrency");
  }
  if (!Number.isInteger(args.maxChainAttempts) || args.maxChainAttempts < 1) {
    throw new Error("invalid max chain attempts");
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

function latestRowMap(rows) {
  const map = new Map();
  for (const row of rows) map.set(chainKey(row), row);
  return map;
}

function latestRows(rows) {
  const latest = latestRowMap(rows);
  const ordered = [];
  for (const personaId of PERSONA_IDS) {
    for (const rep of REPS) {
      for (const condition of CONDITIONS) {
        const row = latest.get(`${personaId}|${condition}|${rep}`);
        if (row) ordered.push(row);
      }
    }
  }
  return ordered;
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

function mean(values) {
  const nums = values.map(Number).filter(Number.isFinite);
  if (!nums.length) return NaN;
  return nums.reduce((sum, value) => sum + value, 0) / nums.length;
}

function minMax(values) {
  const nums = values.map(Number).filter(Number.isFinite);
  if (!nums.length) return { min: NaN, max: NaN };
  return { min: Math.min(...nums), max: Math.max(...nums) };
}

function getPrice(row) {
  return Number(row?.r2?.d5?.parsed?.aligned_price ?? row?.r2?.d5?.parsed?.price);
}

function getProfit(row) {
  return Number(row?.r2?.calculate?.metrics?.profit);
}

function getGridArch(row) {
  const r1 = row?.r1_choice?.parsed || {};
  return `${r1.grid_id || ""}/${r1.architecture || ""}`;
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
  if (stage === "D5") return String(getPrice(row) || "");
  return "";
}

function conditionRows(rows, condition) {
  return rows.filter((row) => row.status === "OK" && row.condition === condition);
}

function profitSummaryLine(rows, condition) {
  const subset = conditionRows(rows, condition);
  const profits = subset.map(getProfit);
  const range = minMax(profits);
  const profitable = profits.filter((value) => value > 0).length;
  return `| ${condition} | ${subset.length} | ${profitable}/${subset.length} | ${fmt((profitable / Math.max(1, subset.length)) * 100, 1)}% | ${fmt(mean(profits))} | ${fmt(range.min)} | ${fmt(range.max)} |`;
}

function gridMatrixLines(rows) {
  const latest = latestRowMap(rows);
  return PERSONA_IDS.map((personaId) => {
    const label = latest.get(`${personaId}|F|1`)?.persona_label || latest.get(`${personaId}|B|1`)?.persona_label || personaId;
    const f = REPS.map((rep) => getGridArch(latest.get(`${personaId}|F|${rep}`))).join("；");
    const b = REPS.map((rep) => getGridArch(latest.get(`${personaId}|B|${rep}`))).join("；");
    return `| ${label} | ${f} | ${b} |`;
  });
}

function pairLines(rows) {
  const latest = latestRowMap(rows);
  const lines = [];
  for (const personaId of PERSONA_IDS) {
    for (const rep of REPS) {
      const f = latest.get(`${personaId}|F|${rep}`);
      const b = latest.get(`${personaId}|B|${rep}`);
      const label = b?.persona_label || f?.persona_label || personaId;
      lines.push(`| ${label} | ${rep} | ${getGridArch(f)} | ${getGridArch(b)} | ${fmt(getPrice(f))} | ${fmt(getPrice(b))} | ${fmt(getProfit(f))} | ${fmt(getProfit(b))} | ${fmt(getProfit(b) - getProfit(f))} | ${cardDigest(f)} | ${cardDigest(b)} |`);
    }
  }
  return lines;
}

function visibleRatioLines(rows) {
  const latest = conditionRows(rows, "B");
  const groups = new Map();
  for (const row of latest) {
    for (const call of row.bandwidth_audit?.calls || []) {
      const key = `${call.call_id || call.stage}|${call.map_total}`;
      if (!groups.has(key)) {
        groups.set(key, {
          call_id: call.call_id || call.stage,
          map_total: call.map_total,
          B_values: new Set(),
          ratio_values: new Set(),
          stack_lens: new Set()
        });
      }
      const group = groups.get(key);
      group.B_values.add(call.B);
      group.ratio_values.add(call.ratio_visible);
      group.stack_lens.add(call.stack_len);
    }
  }
  return Array.from(groups.values())
    .sort((left, right) => {
      const order = ["R1", "Coach_1", "Coach_2", "Coach_3", "D3", "D4", "D5"];
      const stageDiff = order.indexOf(left.call_id) - order.indexOf(right.call_id);
      if (stageDiff) return stageDiff;
      return Number(right.map_total) - Number(left.map_total);
    })
    .map((group) => `| ${group.call_id} | ${group.map_total} | ${Array.from(group.stack_lens).sort((a, b) => a - b).join(",")} | ${Array.from(group.B_values).sort((a, b) => a - b).join(",")} | ${Array.from(group.ratio_values).sort((a, b) => a - b).map((value) => fmt(Number(value) * 100, 1)).join(",")}% |`);
}

function claimRetestLines(rows) {
  const latest = latestRowMap(rows);
  const caogen = REPS.map((rep) => [latest.get(`A|F|${rep}`), latest.get(`A|B|${rep}`)]).filter(([f, b]) => f && b);
  const erdai = REPS.map((rep) => [latest.get(`D|F|${rep}`), latest.get(`D|B|${rep}`)]).filter(([f, b]) => f && b);
  const tizhi = REPS.map((rep) => [latest.get(`E|F|${rep}`), latest.get(`E|B|${rep}`)]).filter(([f, b]) => f && b);
  const allPairs = [];
  for (const personaId of PERSONA_IDS) {
    for (const rep of REPS) {
      const f = latest.get(`${personaId}|F|${rep}`);
      const b = latest.get(`${personaId}|B|${rep}`);
      if (f && b) allPairs.push([f, b]);
    }
  }
  const totalByRep = REPS.map((rep) => {
    const fSum = PERSONA_IDS.reduce((sum, personaId) => sum + getProfit(latest.get(`${personaId}|F|${rep}`)), 0);
    const bSum = PERSONA_IDS.reduce((sum, personaId) => sum + getProfit(latest.get(`${personaId}|B|${rep}`)), 0);
    return { rep, fSum, bSum };
  });
  const lines = [];
  lines.push(`| 草根 B 提价 | ${caogen.filter(([f, b]) => getPrice(b) > getPrice(f)).length}/${caogen.length} | F=${caogen.map(([f]) => fmt(getPrice(f))).join(",")}；B=${caogen.map(([, b]) => fmt(getPrice(b))).join(",")} |`);
  lines.push(`| 二代格子漂移 | ${erdai.filter(([f, b]) => getGridArch(b) !== getGridArch(f)).length}/${erdai.length} | F=${erdai.map(([f]) => getGridArch(f)).join("；")}；B=${erdai.map(([, b]) => getGridArch(b)).join("；")} |`);
  lines.push(`| 体制 B 改善 | ${tizhi.filter(([f, b]) => getProfit(b) > getProfit(f)).length}/${tizhi.length} | Δ=${tizhi.map(([f, b]) => fmt(getProfit(b) - getProfit(f))).join(",")} |`);
  lines.push(`| B 总利润 < F | ${totalByRep.filter((item) => item.bSum < item.fSum).length}/${totalByRep.length} | ${totalByRep.map((item) => `rep${item.rep}:F=${fmt(item.fSum)},B=${fmt(item.bSum)}`).join("；")} |`);
  lines.push(`| B 定价整体偏高 | ${allPairs.filter(([f, b]) => getPrice(b) > getPrice(f)).length}/${allPairs.length} | 同 persona/rep paired 比较 |`);
  return lines;
}

function rankBoundaryEventLines(rows) {
  const ok = rows.filter((row) => row.status === "OK");
  const fSourcesByPersona = new Map();
  for (const row of ok.filter((item) => item.condition === "F")) {
    if (!fSourcesByPersona.has(row.persona_id)) fSourcesByPersona.set(row.persona_id, new Set());
    const set = fSourcesByPersona.get(row.persona_id);
    for (const stage of ["R1", "D3", "D4", "D5"]) {
      collectSources(row, stage).forEach((source) => set.add(source));
    }
  }
  const events = [];
  for (const row of ok.filter((item) => item.condition === "B")) {
    const sourceSet = fSourcesByPersona.get(row.persona_id) || new Set();
    for (const call of row.bandwidth_audit?.calls || []) {
      for (const item of call.map_items || []) {
        if (!item.selected && item.rank === call.B + 1 && sourceSet.has(item.id)) {
          events.push({
            persona_label: row.persona_label,
            rep: row.rep,
            stage: call.call_id || call.stage,
            id: item.id,
            rank: item.rank,
            B: call.B,
            map_total: call.map_total,
            ratio_visible: call.ratio_visible
          });
        }
      }
    }
  }
  if (!events.length) return ["| （无） | - | - | - | - | - |"];
  return events.map((event) => `| ${event.persona_label} | ${event.rep} | ${event.stage} | ${event.id} | ${event.rank}/${event.B} | ${fmt(Number(event.ratio_visible) * 100, 1)}% |`);
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
        rep: row.rep,
        stage,
        prompt_sha256: sha256(String(prompt || "")),
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

function collectRetryRecords(rows) {
  const byKey = new Map();
  for (const row of rows) {
    if (!byKey.has(chainKey(row))) byKey.set(chainKey(row), []);
    byKey.get(chainKey(row)).push(row);
  }
  const records = [];
  for (const [key, attempts] of byKey.entries()) {
    if (attempts.length > 1) {
      records.push({
        type: "chain_retry",
        key,
        attempts: attempts.length,
        input_hashes: attempts.map((row) => row.retry_input_sha256 || row.paired_run?.input_sha256 || ""),
        row_sha256: attempts.map((row) => sha256(JSON.stringify(row))),
        statuses: attempts.map((row) => row.status)
      });
    }
  }
  for (const row of latestRows(rows)) {
    for (const [stage, call] of Object.entries({
      R1: row.r1_choice,
      D3: row.r2?.d3,
      D4: row.r2?.d4,
      D5: row.r2?.d5
    })) {
      if (Number(call?.attempts || 0) > 1) {
        records.push({
          type: "json_repair",
          key: chainKey(row),
          stage,
          attempts: call.attempts,
          prompt_sha256: call.prompt_sha256 || sha256(String(call.prompt || ""))
        });
      }
    }
  }
  return records;
}

function writeSummary(paths, rows) {
  const latest = latestRows(rows);
  const ok = latest.filter((row) => row.status === "OK");
  const failed = latest.filter((row) => row.status !== "OK");
  const lines = [
    `# ${path.basename(paths.summary, "_summary.md")} Summary`,
    "",
    "## Device Note",
    "",
    "比例制 paired N=3：F 与 B 均在本 run 内新生成；F 不传 bandwidth hook，B 使用比例带宽层；同一 persona 的 3 个 rep 全部复用同一套 full_game v1 r0_jinang。",
    "",
    "参数仍为试探值，未经真人 trace 校准；N=3 只报告均值/区间，不做显著性声明。",
    "",
    "## Completion",
    "",
    `- Latest rows: ${latest.length}/42`,
    `- OK: ${ok.length}/42`,
    `- Failed: ${failed.map((row) => `${row.persona_label}/rep${row.rep}/${row.condition}: ${row.error}`).join("；") || "none"}`,
    `- Rows total including failed attempts: ${rows.length}`,
    "",
    "## 1. 盈利率与利润",
    "",
    "| Condition | n | 盈利链 | 盈利率 | mean profit | min | max |",
    "|---|---:|---:|---:|---:|---:|---:|",
    profitSummaryLine(ok, "F"),
    profitSummaryLine(ok, "B"),
    "",
    "## 2. 格子稳定性矩阵",
    "",
    "| Persona | F×3 格子/架构 | B×3 格子/架构 |",
    "|---|---|---|",
    ...gridMatrixLines(ok),
    "",
    "## 3. Paired 明细",
    "",
    "| Persona | rep | F 格子/架构 | B 格子/架构 | F 价格 | B 价格 | F profit | B profit | Δ(B-F) | F 选卡 | B 选卡 |",
    "|---|---:|---|---|---:|---:|---:|---:|---:|---|---|",
    ...pairLines(ok),
    "",
    "## 4. 可见比例均等性验证",
    "",
    "| call | map_total | stack_len | B | ratio_visible |",
    "|---|---:|---:|---:|---:|",
    ...visibleRatioLines(ok),
    "",
    "## 5. 上轮复现表逐行重验",
    "",
    "| 旧证据 | N=3 读数 | 明细 |",
    "|---|---:|---|",
    ...claimRetestLines(ok),
    "",
    "## 6. rank=B+1 且任一 F 链引用过的事件",
    "",
    "| Persona | rep | stage | map id | rank/B | ratio_visible |",
    "|---|---:|---|---|---:|---:|",
    ...rankBoundaryEventLines(ok),
    "",
    "## 7. 局限",
    "",
    "- N=3 仍小，只能读方向和区间。",
    "- 锦囊只用单套抽取，未随机化。",
    "- solo 装置，不含团队协商。",
    "- 温度沿用当前 0.55 口径，跨轮不做温度对齐声明。",
    ""
  ];
  fs.writeFileSync(paths.summary, lines.join("\n"), "utf8");
}

function writeSamples(paths, rows) {
  const lines = [`# ${path.basename(paths.samples, "_raw_samples.md")} Raw Samples`, ""];
  for (const row of latestRows(rows)) {
    lines.push(`## ${row.persona_label} / rep${row.rep} / ${row.condition} (${row.status})`, "");
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
      rep: row.rep,
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
    matrix: "7 persona × {F fresh unlimited, B proportional bandwidth} × 3 paired reps",
    paired_design: {
      f_condition: "fresh FullGame.runPlaythrough without bandwidthLayer",
      b_condition: "fresh FullGame.runPlaythrough with proportional BandwidthLayer",
      shared_r0_jinang: "All reps for the same persona use the same draw loaded from full_game_all_personas_v1_2026-07-14.jsonl when available.",
      rep_policy: "Each persona's 3 reps run serially; persona-level concurrency is controlled by --concurrency."
    },
    bandwidth_params: DEFAULT_PARAMS,
    llm_config: extra.llmConfig,
    rep_records: latest.map((row) => ({
      persona_id: row.persona_id,
      persona_label: row.persona_label,
      condition: row.condition,
      rep: row.rep,
      status: row.status,
      r0_jinang_market: row.r0_jinang?.market?.id || "",
      r0_jinang_tech: row.r0_jinang?.tech?.id || ""
    })),
    retry_records: extra.retryRecords,
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
  const retryRecords = collectRetryRecords(runRows);
  writeSummary(paths, runRows);
  writeSamples(paths, runRows);
  writeAudit(paths, runRows);
  return writeMeta(paths, runRows, args, materials, { assertRecords, retryRecords, llmConfig });
}

function inputHash(persona, condition, rep, draw) {
  return sha256(JSON.stringify({
    persona_id: persona.id,
    map_sha256: persona.map_sha256,
    condition,
    rep,
    r0_jinang: draw,
    bandwidth_params: condition === "B" ? DEFAULT_PARAMS : null
  }));
}

async function runChainUntilOk({ runtime, persona, materials, paths, args, condition, rep, draw, bandwidthLayer, fRow }) {
  let rows = loadJsonl(paths.jsonl).filter((row) => row.run_id === args.runId);
  let latest = latestRowMap(rows).get(`${persona.id}|${condition}|${rep}`);
  let attempts = rows.filter((row) => row.persona_id === persona.id && row.condition === condition && Number(row.rep || 1) === rep).length;
  const inputSha = inputHash(persona, condition, rep, draw);
  while (latest?.status !== "OK" && attempts < args.maxChainAttempts) {
    attempts += 1;
    const startedAt = new Date().toISOString();
    const options = {
      condition,
      rep,
      jinangDraw: draw
    };
    if (condition === "B") options.bandwidthLayer = bandwidthLayer;
    const row = await FullGame.runPlaythrough(runtime, persona, materials, args.runId, options);
    row.chain_attempt = attempts;
    row.retry_input_sha256 = inputSha;
    row.paired_run = {
      pair_id: `${persona.id}|${rep}`,
      condition,
      rep,
      input_sha256: inputSha,
      started_at: startedAt,
      ended_at: new Date().toISOString()
    };
    if (condition === "F") {
      row.bandwidth_audit = { condition: "F", note: "No bandwidth filtering; full map and full stack." };
    } else if (fRow) {
      row.paired_run.paired_f_row_sha256 = sha256(JSON.stringify(fRow));
    }
    appendJsonl(paths.jsonl, row);
    latest = row;
    console.log(`[bandwidth_proportional_n3] ${persona.label} rep${rep} ${condition} attempt=${attempts} ${row.status} error=${row.error || ""}`);
  }
  return latest;
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
    run_concurrency: args.concurrency,
    max_chain_attempts: args.maxChainAttempts
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
    const seedDraws = loadJinangDrawsFromV1();
    const fallbackDraws = new Map(personas.map((persona) => [persona.id, FullGame.drawJinang(materials.jinangConfig)]));
    const latest = latestRowMap(rows);
    const tasks = personas.filter((persona) => REPS.some((rep) => {
      const fDone = latest.get(`${persona.id}|F|${rep}`)?.status === "OK";
      const bDone = latest.get(`${persona.id}|B|${rep}`)?.status === "OK";
      return !fDone || !bDone;
    }));
    console.log(`[bandwidth_proportional_n3] existing=${rows.length} remaining_personas=${tasks.length} concurrency=${args.concurrency} reused_jinang=${seedDraws.size}`);
    await runPool(tasks, args.concurrency, async (persona, index) => {
      const draw = seedDraws.get(persona.id) || fallbackDraws.get(persona.id);
      for (const rep of REPS) {
        let fRow = latestRowMap(loadJsonl(paths.jsonl).filter((row) => row.run_id === args.runId)).get(`${persona.id}|F|${rep}`);
        if (fRow?.status !== "OK") {
          fRow = await runChainUntilOk({ runtime, persona, materials, paths, args, condition: "F", rep, draw, bandwidthLayer });
        }
        if (fRow?.status === "OK") {
          let bRow = latestRowMap(loadJsonl(paths.jsonl).filter((row) => row.run_id === args.runId)).get(`${persona.id}|B|${rep}`);
          if (bRow?.status !== "OK") {
            bRow = await runChainUntilOk({ runtime, persona, materials, paths, args, condition: "B", rep, draw: fRow.r0_jinang, bandwidthLayer, fRow });
          }
        }
      }
      console.log(`[bandwidth_proportional_n3] persona_done ${index + 1}/${tasks.length} ${persona.label}`);
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
