"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { spawnSync } = require("node:child_process");

const FullGame = require("./full_game_all_personas");
const { assertInfoSet } = require("./info_set_assert");
const { THEME_RULES } = require("./chain_map_search_effort");

const ROOT = path.join(__dirname, "..", "..");
const RUN_ID = "question_definition_pilot_v1_2026-07-15";
const SPEC_PATH = path.join(ROOT, "docs", "CODEX_QUESTION_DEFINITION_PILOT.md");
const INFO_SET_SPEC_PATH = path.join(ROOT, "docs", "CODEX_INFO_SET_ALIGNMENT.md");
const V1_JSONL_PATH = path.join(__dirname, "full_game_all_personas_v1_2026-07-14.jsonl");
const PERSONA_IDS = ["A", "D", "E", "B", "F", "C", "G"];
const CONDITIONS = ["S", "Q"];

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
  const candidates = [process.env.CODEX_ENV_PATH, path.join(ROOT, ".env")].filter(Boolean);
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
  if (!args.runId || !Number.isInteger(args.concurrency) || args.concurrency < 1) throw new Error("invalid run id or concurrency");
  if (!Number.isInteger(args.maxChainAttempts) || args.maxChainAttempts < 1) throw new Error("invalid max chain attempts");
  return args;
}

function outputPaths(runId) {
  return {
    jsonl: path.join(__dirname, `${runId}.jsonl`),
    summary: path.join(__dirname, `${runId}_summary.md`),
    samples: path.join(__dirname, `${runId}_raw_samples.md`),
    meta: path.join(__dirname, `${runId}_meta.json`),
    audit: path.join(__dirname, `${runId}_audit.json`),
    questions: path.join(__dirname, `${runId}_question_list.md`)
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
    for (const condition of CONDITIONS) {
      const row = latest.get(`${personaId}|${condition}|1`);
      if (row) ordered.push(row);
    }
  }
  return ordered;
}

function loadJinangDrawsFromV1() {
  const latest = new Map();
  for (const row of loadJsonl(V1_JSONL_PATH)) latest.set(`${row.persona_id}|${row.condition}|${row.rep || 1}`, row);
  const draws = new Map();
  for (const row of latest.values()) {
    if (row.status === "OK" && row.r0_jinang?.market?.id && row.r0_jinang?.tech?.id) draws.set(row.persona_id, row.r0_jinang);
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

function trunc(text, max = 120) {
  const raw = String(text || "").replace(/\s+/g, " ").trim();
  return raw.length <= max ? raw : `${raw.slice(0, Math.max(0, max - 1))}…`;
}

function price(row) {
  return Number(row?.r2?.d5?.parsed?.aligned_price ?? row?.r2?.d5?.parsed?.price);
}

function profit(row) {
  return Number(row?.r2?.calculate?.metrics?.profit);
}

function gridArch(row) {
  const r1 = row?.r1_choice?.parsed || {};
  return `${r1.grid_id || ""}/${r1.architecture || ""}`;
}

function cards(row) {
  return (row?.r2?.d4?.parsed?.cards || []).map((card) => `${card.id}@${card.tier}`).join(", ");
}

function questionCalls(row) {
  return row?.question_definition?.calls || [];
}

function questionAt(row, stage) {
  return questionCalls(row).find((call) => call.stage === stage)?.parsed?.question || "";
}

function themeNames(text) {
  const raw = String(text || "");
  return THEME_RULES.filter(([, pattern]) => pattern.test(raw)).map(([name]) => name);
}

function questionMapTrace(row, stage) {
  const question = questionAt(row, stage);
  const haystack = `${question}\n${row.persona_label}\n${row.r1_choice?.parsed?.choice_reason || ""}`;
  const themes = themeNames(haystack);
  const mapSources = new Set();
  if (stage === "R1") {
    (row.r1_choice?.parsed?.map_sources || []).forEach((source) => mapSources.add(source));
    (row.r1_choice?.parsed?.updated_constraints || []).forEach((item) => mapSources.add(item.source));
  } else if (stage === "D4") {
    const d4 = row.r2?.d4?.parsed || {};
    if (d4.cost_stance?.source) mapSources.add(d4.cost_stance.source);
    (d4.updated_constraints || []).forEach((item) => mapSources.add(item.source));
  } else if (stage === "D5") {
    if (row.r2?.d5?.parsed?.basis?.source) mapSources.add(row.r2.d5.parsed.basis.source);
  }
  return {
    themes,
    map_sources: Array.from(mapSources).filter((source) => /^map_/.test(source))
  };
}

function wrongDirectionCandidate(question) {
  return !/用户|客户|顾客|孩子|儿童|老人|家长|父母|子女|需求|痛点|支付|付费|价格|愿意|买|市场/i.test(String(question || ""));
}

function decisionExcerpt(row, stage) {
  if (stage === "R1") return row.r1_choice?.parsed?.choice_reason || "";
  if (stage === "D4") return row.r2?.d4?.parsed?.cost_stance?.text || "";
  if (stage === "D5") return row.r2?.d5?.parsed?.reasoning || "";
  return "";
}

function qRows(rows) {
  return latestRows(rows).filter((row) => row.status === "OK" && row.condition === "Q");
}

function sRowFor(rows, personaId) {
  return latestRowMap(rows).get(`${personaId}|S|1`);
}

function buildQuestionList(paths, rows) {
  const lines = [
    `# ${path.basename(paths.questions, "_question_list.md")} Question List`,
    "",
    "Claude 预览原文未在仓库中找到；本清单只列 DeepSeek + 真实链正式跑出的 Q 条件问题。",
    "",
    "| Persona | Stage | Question | Themes | Map trace |",
    "|---|---|---|---|---|"
  ];
  for (const row of qRows(rows)) {
    for (const stage of ["R1", "D4", "D5"]) {
      const trace = questionMapTrace(row, stage);
      lines.push(`| ${row.persona_label} | ${stage} | ${questionAt(row, stage).replace(/\|/g, "｜")} | ${trace.themes.join(", ") || "-"} | ${trace.map_sources.join(", ") || "-"} |`);
    }
  }
  fs.writeFileSync(paths.questions, lines.join("\n"), "utf8");
}

function blindAttributionLines(rows) {
  const out = [];
  for (const row of qRows(rows)) {
    const q = questionAt(row, "D5");
    const trace = questionMapTrace(row, "D5");
    out.push(`| ${row.persona_label} | ${q.replace(/\|/g, "｜")} | ${trace.themes.join(", ") || "-"} | ${trace.map_sources.join(", ") || "-"} |`);
  }
  return out;
}

function wrongDirectionLines(rows) {
  const lines = [];
  for (const row of qRows(rows)) {
    for (const stage of ["R1", "D4", "D5"]) {
      const q = questionAt(row, stage);
      if (!wrongDirectionCandidate(q)) continue;
      lines.push(`| ${row.persona_label} | ${stage} | ${q.replace(/\|/g, "｜")} | ${trunc(decisionExcerpt(row, stage), 140).replace(/\|/g, "｜")} |`);
    }
  }
  return lines.length ? lines : ["| （无） | - | - | - |"];
}

function linkageLines(rows) {
  return qRows(rows).flatMap((row) => ["R1", "D4", "D5"].map((stage) => {
    const q = questionAt(row, stage);
    const excerpt = decisionExcerpt(row, stage);
    const trace = questionMapTrace(row, stage);
    return `| ${row.persona_label} | ${stage} | ${trunc(q, 80).replace(/\|/g, "｜")} | ${trunc(excerpt, 120).replace(/\|/g, "｜")} | ${trace.themes.join(", ") || "-"} |`;
  }));
}

function diffLines(rows) {
  const latest = latestRowMap(rows);
  return PERSONA_IDS.map((personaId) => {
    const s = latest.get(`${personaId}|S|1`);
    const q = latest.get(`${personaId}|Q|1`);
    const label = q?.persona_label || s?.persona_label || personaId;
    return `| ${label} | ${gridArch(s)} | ${gridArch(q)} | ${fmt(price(s))} | ${fmt(price(q))} | ${fmt(profit(s))} | ${fmt(profit(q))} | ${trunc(cards(s), 70)} | ${trunc(cards(q), 70)} |`;
  });
}

function writeSummary(paths, rows) {
  const latest = latestRows(rows);
  const ok = latest.filter((row) => row.status === "OK");
  const failed = latest.filter((row) => row.status !== "OK");
  const qCount = qRows(rows).reduce((sum, row) => sum + questionCalls(row).length, 0);
  const lines = [
    `# ${path.basename(paths.summary, "_summary.md")} Summary`,
    "",
    "## Device Note",
    "",
    "Q/S paired：S 为 full_game v2 标准框架；Q 在 R1/D4/D5 前插入 D_q，并用 persona 自己提出的问题替换标准任务框架。带宽层关闭。",
    "",
    "本轮 N=1；利润照记但不作利润量级判断。",
    "",
    "## Completion",
    "",
    `- Latest rows: ${latest.length}/14`,
    `- OK: ${ok.length}/14`,
    `- Q questions: ${qCount}/21`,
    `- Failed: ${failed.map((row) => `${row.persona_label}/${row.condition}: ${row.error}`).join("；") || "none"}`,
    "",
    "## 1. 21 个 Q 问题",
    "",
    "完整清单见 question_list.md。Claude 预览 7 个问题原文未在仓库中找到，未做逐条并排。",
    "",
    "## 2. D5 盲归属工作表",
    "",
    "| Persona | D5 question | Themes | Map trace |",
    "|---|---|---|---|",
    ...blindAttributionLines(rows),
    "",
    "## 3. 错向问题候选",
    "",
    "| Persona | Stage | Question | 下游决策摘录 |",
    "|---|---|---|---|",
    ...wrongDirectionLines(rows),
    "",
    "## 4. 问题→决策联动摘录",
    "",
    "| Persona | Stage | Question | Q 决策理由/立场摘录 | Themes |",
    "|---|---|---|---|---|",
    ...linkageLines(rows),
    "",
    "## 5. Q vs S 决策差异（利润只记录，不判量级）",
    "",
    "| Persona | S 格子/架构 | Q 格子/架构 | S 价格 | Q 价格 | S profit | Q profit | S cards | Q cards |",
    "|---|---|---|---:|---:|---:|---:|---|---|",
    ...diffLines(rows),
    "",
    "## 6. 局限",
    "",
    "- N=1，只看问题文本与决策联动的定性证据。",
    "- 利润噪音已知很大，本轮不判利润量级。",
    "- Claude 预览原文未提供，无法做逐条并排；只能标注基座差异。",
    "- D3/Coach 未插入 D_q。",
    ""
  ];
  fs.writeFileSync(paths.summary, lines.join("\n"), "utf8");
}

function writeSamples(paths, rows) {
  const lines = [`# ${path.basename(paths.samples, "_raw_samples.md")} Raw Samples`, ""];
  for (const row of latestRows(rows)) {
    lines.push(`## ${row.persona_label} / ${row.condition} (${row.status})`, "");
    if (row.error) lines.push(`Error: ${row.error}`, "");
    if (row.question_definition?.calls?.length) {
      lines.push("### Question Definition Calls", "", "```json", JSON.stringify(row.question_definition.calls, null, 2), "```", "");
    }
    lines.push("### R0 Jinang", "", "```json", JSON.stringify(row.r0_jinang || null, null, 2), "```", "");
    lines.push("### R1", "", "#### Prompt", "", row.r1_choice?.prompt || "", "", "#### Raw", "", row.r1_choice?.raw_response || "", "", "#### Parsed", "", "```json", JSON.stringify(row.r1_choice?.parsed || null, null, 2), "```", "");
    lines.push("### Coach", "");
    for (const turn of row.coach?.turns || []) lines.push(`- ${turn.role}: ${turn.content}`);
    lines.push("", "### D3", "", "#### Prompt", "", row.r2?.d3?.prompt || "", "", "#### Raw", "", row.r2?.d3?.raw_response || "", "", "#### Parsed", "", "```json", JSON.stringify(row.r2?.d3?.parsed || null, null, 2), "```", "");
    lines.push("### D4", "", "#### Prompt", "", row.r2?.d4?.prompt || "", "", "#### Raw", "", row.r2?.d4?.raw_response || "", "", "#### Parsed", "", "```json", JSON.stringify(row.r2?.d4?.parsed || null, null, 2), "```", "");
    lines.push("### D5", "", "#### Prompt", "", row.r2?.d5?.prompt || "", "", "#### Raw", "", row.r2?.d5?.raw_response || "", "", "#### Parsed", "", "```json", JSON.stringify(row.r2?.d5?.parsed || null, null, 2), "```", "");
    lines.push("### Calculate", "", "```json", JSON.stringify(row.r2?.calculate || null, null, 2), "```", "");
  }
  fs.writeFileSync(paths.samples, lines.join("\n"), "utf8");
}

function writeAudit(paths, rows) {
  const audit = {
    run_id: path.basename(paths.audit, "_audit.json"),
    generated_at: new Date().toISOString(),
    question_definition_calls: qRows(rows).map((row) => ({
      persona_id: row.persona_id,
      persona_label: row.persona_label,
      condition: row.condition,
      status: row.status,
      r0_jinang: row.r0_jinang,
      calls: questionCalls(row)
    }))
  };
  fs.writeFileSync(paths.audit, JSON.stringify(audit, null, 2), "utf8");
}

function collectAssertRecords(rows) {
  const records = [];
  for (const row of latestRows(rows).filter((item) => item.status === "OK")) {
    for (const call of questionCalls(row)) {
      const record = {
        persona_id: row.persona_id,
        persona_label: row.persona_label,
        condition: row.condition,
        stage: `Dq_${call.stage}`,
        prompt_sha256: call.prompt_sha256 || sha256(String(call.prompt || "")),
        checked_at: new Date().toISOString(),
        status: "PASS"
      };
      try {
        assertInfoSet(call.prompt, call.stage);
      } catch (error) {
        record.status = "FAIL";
        record.error = error.message || String(error);
      }
      records.push(record);
    }
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
    for (const call of questionCalls(row)) {
      if (Number(call.attempts || 0) > 1) records.push({ type: "json_repair", key: chainKey(row), stage: `Dq_${call.stage}`, attempts: call.attempts, prompt_sha256: call.prompt_sha256 });
    }
    for (const [stage, call] of Object.entries({ R1: row.r1_choice, D3: row.r2?.d3, D4: row.r2?.d4, D5: row.r2?.d5 })) {
      if (Number(call?.attempts || 0) > 1) records.push({ type: "json_repair", key: chainKey(row), stage, attempts: call.attempts, prompt_sha256: call.prompt_sha256 || sha256(String(call.prompt || "")) });
    }
  }
  return records;
}

function writeMeta(paths, rows, args, materials, extra) {
  const configFiles = [
    SPEC_PATH,
    INFO_SET_SPEC_PATH,
    __filename,
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
    matrix: "7 persona × {S standard, Q question-definition} × 1",
    question_definition: {
      enabled_condition: "Q",
      stages: ["R1", "D4", "D5"],
      prompt_template_sha256: sha256([
        String(FullGame.buildQuestionDefinitionPrompt || ""),
        String(FullGame.neutralQuestionDescription || "")
      ].join("\n"))
    },
    llm_config: extra.llmConfig,
    rep_records: latest.map((row) => ({
      persona_id: row.persona_id,
      persona_label: row.persona_label,
      condition: row.condition,
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
      audit: fs.existsSync(paths.audit) ? fileSha256(paths.audit) : null,
      question_list: fs.existsSync(paths.questions) ? fileSha256(paths.questions) : null
    }
  };
  fs.writeFileSync(paths.meta, JSON.stringify(meta, null, 2), "utf8");
  return meta;
}

function writeOutputs(paths, rows, args, materials, llmConfig) {
  const runRows = rows.filter((row) => row.run_id === args.runId);
  const assertRecords = collectAssertRecords(runRows);
  const retryRecords = collectRetryRecords(runRows);
  buildQuestionList(paths, runRows);
  writeSummary(paths, runRows);
  writeSamples(paths, runRows);
  writeAudit(paths, runRows);
  return writeMeta(paths, runRows, args, materials, { assertRecords, retryRecords, llmConfig });
}

function inputHash(persona, condition, draw) {
  return sha256(JSON.stringify({
    persona_id: persona.id,
    map_sha256: persona.map_sha256,
    condition,
    r0_jinang: draw,
    question_definition: condition === "Q"
  }));
}

async function runChainUntilOk({ runtime, persona, materials, paths, args, condition, draw }) {
  let rows = loadJsonl(paths.jsonl).filter((row) => row.run_id === args.runId);
  let latest = latestRowMap(rows).get(`${persona.id}|${condition}|1`);
  let attempts = rows.filter((row) => row.persona_id === persona.id && row.condition === condition && Number(row.rep || 1) === 1).length;
  const inputSha = inputHash(persona, condition, draw);
  while (latest?.status !== "OK" && attempts < args.maxChainAttempts) {
    attempts += 1;
    const startedAt = new Date().toISOString();
    const options = { condition, rep: 1, jinangDraw: draw };
    if (condition === "Q") options.questionDefinition = true;
    const row = await FullGame.runPlaythrough(runtime, persona, materials, args.runId, options);
    row.chain_attempt = attempts;
    row.retry_input_sha256 = inputSha;
    row.paired_run = {
      pair_id: `${persona.id}|1`,
      condition,
      input_sha256: inputSha,
      started_at: startedAt,
      ended_at: new Date().toISOString()
    };
    appendJsonl(paths.jsonl, row);
    latest = row;
    console.log(`[question_definition_pilot] ${persona.label} ${condition} attempt=${attempts} ${row.status} error=${row.error || ""}`);
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
    question_definition: { temperature: 0.55, max_tokens: 500, max_repairs: 2, max_retries_per_attempt: 1 },
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
    const seedDraws = loadJinangDrawsFromV1();
    const fallbackDraws = new Map(personas.map((persona) => [persona.id, FullGame.drawJinang(materials.jinangConfig)]));
    const latest = latestRowMap(rows);
    const tasks = personas.filter((persona) => CONDITIONS.some((condition) => latest.get(`${persona.id}|${condition}|1`)?.status !== "OK"));
    console.log(`[question_definition_pilot] existing=${rows.length} remaining_personas=${tasks.length} concurrency=${args.concurrency} reused_jinang=${seedDraws.size}`);
    await runPool(tasks, args.concurrency, async (persona, index) => {
      const draw = seedDraws.get(persona.id) || fallbackDraws.get(persona.id);
      let sRow = latestRowMap(loadJsonl(paths.jsonl).filter((row) => row.run_id === args.runId)).get(`${persona.id}|S|1`);
      if (sRow?.status !== "OK") sRow = await runChainUntilOk({ runtime, persona, materials, paths, args, condition: "S", draw });
      if (sRow?.status === "OK") {
        let qRow = latestRowMap(loadJsonl(paths.jsonl).filter((row) => row.run_id === args.runId)).get(`${persona.id}|Q|1`);
        if (qRow?.status !== "OK") qRow = await runChainUntilOk({ runtime, persona, materials, paths, args, condition: "Q", draw: sRow.r0_jinang });
      }
      console.log(`[question_definition_pilot] persona_done ${index + 1}/${tasks.length} ${persona.label}`);
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
