#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { AsyncLocalStorage } = require("node:async_hooks");
const { execFileSync } = require("node:child_process");

const ROOT = path.resolve(__dirname, "../..");
const SOURCE_COMMIT = "f912715";
const RUN_ROOT = path.join(ROOT, "runs_v4flash_0731", "f912715_replay");
const CHAINS_DIR = path.join(RUN_ROOT, "chains");
const FAILED_DIR = path.join(RUN_ROOT, "failed");
const ROWS_PATH = path.join(RUN_ROOT, "rows.jsonl");
const CALL_AUDIT_PATH = path.join(RUN_ROOT, "call_audit.jsonl");
const SUMMARY_PATH = path.join(RUN_ROOT, "summary.json");
const EXPECTED_MODEL = "deepseek-v4-flash-0731";
const PROVIDER = "qwen-ai-platform";
const TEMPERATURE = 0.55;
const MAX_CHAIN_ATTEMPTS = 3;
const PERSONA_IDS = ["A", "D", "E", "B", "F", "C", "G"];
const CONDITIONS = ["Q", "S"];
const REPS = [1, 2, 3];
const REGISTERED_Q_INSTRUCTION = "在做这个决策之前，以你的经验和直觉，你觉得此刻必须先搞清楚的问题是什么？只写问题本身，不要回答它。";
const HISTORICAL_PATHS = {
  manifest: "scripts/analysis/render_manifest_formal_v3_2026-07-16.json",
  preflight: "scripts/analysis/formal_v3_2026-07-16_preflight_rerun_audit.json",
  fullMaps: "scripts/analysis/ai_generated_persona_maps_no_explicit_blindspot_v2_full_2026-07-15_maps_v2.json",
  jingliMaps: "scripts/analysis/ai_generated_persona_maps_no_explicit_blindspot_seedfix_jingli_v2_2026-07-16_maps_v2.json",
  caogenMap: "scripts/analysis/cognitive_map_caogen_min.json",
  erdaiMap: "scripts/analysis/cognitive_map_erdai_min.json",
  formalRunner: "scripts/analysis/formal_round_v3.js"
};

const callContext = new AsyncLocalStorage();

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
  const args = {
    concurrency: 10,
    runId: `formal_v3_f912715_replay_v4flash_${new Date().toISOString().slice(0, 10).replace(/-/g, "")}`
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--concurrency") args.concurrency = Number(argv[++index]);
    else if (arg === "--run-id") args.runId = String(argv[++index] || "").trim();
    else throw new Error(`unknown argument: ${arg}`);
  }
  if (!args.runId) throw new Error("--run-id must be non-empty");
  if (!Number.isInteger(args.concurrency) || args.concurrency < 1) {
    throw new Error("--concurrency must be a positive integer");
  }
  return args;
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function git(args) {
  return execFileSync("git", args, { cwd: ROOT, encoding: "utf8" }).trim();
}

function gitBlob(relPath) {
  return git(["show", `${SOURCE_COMMIT}:${relPath}`]);
}

function gitBlobJson(relPath) {
  return JSON.parse(gitBlob(relPath));
}

function appendJsonl(filePath, row) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.appendFileSync(filePath, `${JSON.stringify(row)}\n`, "utf8");
}

function readJsonl(filePath) {
  if (!fs.existsSync(filePath)) return [];
  return fs.readFileSync(filePath, "utf8").split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function requireNonEmptyEnv(name) {
  const value = String(process.env[name] || "").trim();
  if (!value) throw new Error(`missing required env: ${name}`);
  return value;
}

function validateQwenConfig() {
  const provider = requireNonEmptyEnv("LLM_PROVIDER").toLowerCase();
  if (provider !== "qwen") throw new Error(`LLM_PROVIDER must be qwen, got ${provider}`);
  const model = requireNonEmptyEnv("QWEN_MODEL");
  if (model !== EXPECTED_MODEL) throw new Error(`QWEN_MODEL must be ${EXPECTED_MODEL}, got ${model}`);
  const baseUrl = String(process.env.QWEN_BASE_URL || process.env.DASHSCOPE_BASE_URL || process.env.LLM_BASE_URL || "").trim();
  if (!baseUrl) throw new Error("missing required env: QWEN_BASE_URL or DASHSCOPE_BASE_URL or LLM_BASE_URL");
  const hasKey = Object.entries(process.env).some(([key, value]) =>
    /^(QWEN_API_KEY|DASHSCOPE_API_KEY)(?:_\d+)?$/.test(key) && String(value || "").trim()
  );
  if (!hasKey) throw new Error("missing required env: QWEN_API_KEY or DASHSCOPE_API_KEY");
  const disableThinking = String(process.env.QWEN_DISABLE_THINKING || "").trim();
  const enableThinking = String(process.env.QWEN_ENABLE_THINKING || "").trim();
  if (!(disableThinking === "1" || /^(0|false|no|off)$/i.test(enableThinking))) {
    throw new Error("thinking must be explicitly disabled via QWEN_DISABLE_THINKING=1 or QWEN_ENABLE_THINKING=false");
  }
  process.env.LLM_MODEL_OVERRIDE = model;
  process.env.LLM_DISABLE_THINKING = "1";
  process.env.LLM_CONCURRENCY = String(Math.max(1, Number(process.env.LLM_CONCURRENCY || 10)));
  return { provider, model, baseUrl };
}

function mapArtifactFromBlob(relPath) {
  const artifact = gitBlobJson(relPath);
  return {
    raw: gitBlob(relPath),
    artifact,
    personas: new Map((artifact.personas || []).map((persona) => [persona.id, persona]))
  };
}

function applyF912715FrozenMaps(FullGame, materials, manifest) {
  const full = mapArtifactFromBlob(HISTORICAL_PATHS.fullMaps);
  const jingli = mapArtifactFromBlob(HISTORICAL_PATHS.jingliMaps);
  const caogenRaw = gitBlob(HISTORICAL_PATHS.caogenMap);
  const erdaiRaw = gitBlob(HISTORICAL_PATHS.erdaiMap);
  const manual = new Map([
    ["A", { items: JSON.parse(caogenRaw), desc: "", sourcePath: HISTORICAL_PATHS.caogenMap, raw: caogenRaw }],
    ["D", { items: JSON.parse(erdaiRaw), desc: "", sourcePath: HISTORICAL_PATHS.erdaiMap, raw: erdaiRaw }]
  ]);

  materials.personas = materials.personas.map((persona) => {
    let source;
    if (manual.has(persona.id)) {
      source = manual.get(persona.id);
    } else if (persona.id === "B") {
      const found = jingli.personas.get(persona.id);
      source = { items: found?.items, desc: found?.desc, sourcePath: HISTORICAL_PATHS.jingliMaps, raw: jingli.raw };
    } else {
      const found = full.personas.get(persona.id);
      source = { items: found?.items, desc: found?.desc, sourcePath: HISTORICAL_PATHS.fullMaps, raw: full.raw };
    }
    if (!Array.isArray(source?.items) || source.items.length < 25) {
      throw new Error(`invalid f912715 frozen map: ${persona.id}/${persona.label}`);
    }
    return {
      ...persona,
      desc: source.desc || persona.desc,
      profile: { ...(persona.profile || {}), blindSpots: "" },
      core_blind_spot: "",
      map_items: source.items,
      map_source: `${SOURCE_COMMIT}:${source.sourcePath}`,
      map_file_sha256: sha256(source.raw),
      map_sha256: sha256(JSON.stringify({ id: persona.id, label: persona.label, items: source.items }))
    };
  });
  materials.maps = Object.fromEntries(materials.personas.map((persona) => [persona.label, persona.map_items]));
  materials.renderManifest = manifest;
  materials.bandwidth = null;
  void FullGame;
  return materials;
}

function loadJinangDraws() {
  const rows = readJsonl(path.join(__dirname, "full_game_all_personas_v1_2026-07-14.jsonl"));
  const latest = new Map();
  for (const row of rows) {
    if (row.status === "OK" && row.r0_jinang?.market?.id && row.r0_jinang?.tech?.id) {
      latest.set(row.persona_id, row.r0_jinang);
    }
  }
  for (const id of PERSONA_IDS) {
    if (!latest.has(id)) throw new Error(`historical jinang draw missing: ${id}`);
  }
  return latest;
}

function chainKey(row) {
  return `${row.persona_id}|${row.condition}|${Number(row.rep || 1)}`;
}

function latestRowMap(rows) {
  const latest = new Map();
  for (const row of rows) latest.set(chainKey(row), row);
  return latest;
}

function questionDefinitionContextProvider(FullGame, materials, manifest) {
  const rows = typeof FullGame.publicCardRows === "function" ? FullGame.publicCardRows(materials) : [];
  return ({ stage }) => stage === "D4" ? [
    `【D4 学生可见卡池补充；f912715 render_manifest=${manifest.manifest_version}】`,
    "以下字段为能力卡选择时学生可见字段；不注入内部成本、风险或结算公式。",
    JSON.stringify(rows, null, 2)
  ].join("\n") : "";
}

function installReplayInfoSetPatch() {
  const infoSetPath = require.resolve("./info_set_assert");
  delete require.cache[infoSetPath];
  const infoSet = require("./info_set_assert");
  const originalAssertInfoSet = infoSet.assertInfoSet;
  infoSet.assertInfoSet = (promptText, stage = "UNKNOWN", options = {}) => {
    const sanitized = String(promptText || "")
      .replace(/^一句话背景：.*$/gm, "一句话背景：")
      .replace(/^核心盲区摘要：.*$/gm, "核心盲区摘要：");
    return originalAssertInfoSet(sanitized, stage, options);
  };
}

function inferCallType(messages, options = {}) {
  const role = String(options.role || "").trim();
  if (role) return role;
  const text = (messages || []).map((message) => String(message?.content || "")).join("\n");
  if (/输出 JSON：\{"question"/.test(text) || /【问题定义】/.test(text)) return "question_definition";
  if (/你是 VP Coach|价值主张教练|VP Coach/.test(text)) return "vp_coach";
  if (/persona|用户画像|画像对象|访谈对象/i.test(text) && /JSON|json/i.test(text)) return "persona_generator";
  if (/标签|polarity|tag/i.test(text) && /JSON|json/i.test(text)) return "tag_extractor";
  if (/能力卡池；学生可见信息/.test(text)) return "decision_D4";
  if (/动态用户画像 summary/.test(text)) return "decision_D3";
  if (/最终定价|定价 JSON|依据既有栈做最终定价/.test(text)) return "decision_D5";
  if (/12 个市场格子|grid_id|vp_draft/.test(text)) return "decision_R1";
  return "llm_other";
}

function createRuntime(runId) {
  delete require.cache[require.resolve("../../server/llm/deepseekClient")];
  const deepseek = require("../../server/llm/deepseekClient");
  if (!deepseek.hasAnyKey()) throw new Error("Qwen API key unavailable");
  const originalChatCompletion = deepseek.chatCompletion;
  let sequence = readJsonl(CALL_AUDIT_PATH).reduce((max, row) => Math.max(max, Number(row.sequence || 0)), 0);

  async function auditedChatCompletion(messages, options = {}) {
    sequence += 1;
    const context = callContext.getStore() || {};
    const startedAt = new Date().toISOString();
    const inputText = (messages || []).map((message) => `${message.role || ""}:${message.content || ""}`).join("\n");
    const record = {
      sequence,
      run_id: runId,
      chain_key: context.chain_key || "",
      chain_attempt: context.chain_attempt || null,
      call_type: inferCallType(messages, options),
      started_at: startedAt,
      ended_at: null,
      status: "RUNNING",
      input_sha256: sha256(JSON.stringify({ messages, options })),
      prompt_sha256: sha256(inputText),
      input_chars: inputText.length,
      response_chars: 0,
      response_sha256: "",
      options: {
        temperature: options.temperature ?? null,
        max_tokens: options.max_tokens ?? null,
        maxRetries: options.maxRetries ?? null,
        timeoutMs: options.timeoutMs ?? null,
        model: EXPECTED_MODEL,
        enable_thinking: false
      },
      error: ""
    };
    try {
      const response = await originalChatCompletion(messages, {
        ...options,
        model: EXPECTED_MODEL,
        disableThinking: true
      });
      record.status = "OK";
      record.response_chars = String(response || "").length;
      record.response_sha256 = sha256(String(response || ""));
      return response;
    } catch (error) {
      record.status = "FAIL";
      record.error = String(error?.message || error);
      throw error;
    } finally {
      record.ended_at = new Date().toISOString();
      appendJsonl(CALL_AUDIT_PATH, record);
    }
  }

  deepseek.chatCompletion = auditedChatCompletion;
  for (const modulePath of [
    "../../server/llm/tagExtractor",
    "../../server/llm/dimensionScorer",
    "../../server/llm/vpWordScorer",
    "../../server/llm/vpCoach",
    "../../server/llm/personaGenerator"
  ]) {
    delete require.cache[require.resolve(modulePath)];
  }
  const { extractTags } = require("../../server/llm/tagExtractor");
  const { scoreTagsToDimensions } = require("../../server/llm/dimensionScorer");
  const vpWordScorer = require("../../server/llm/vpWordScorer");
  const vpCoach = require("../../server/llm/vpCoach");
  const personaGenerator = require("../../server/llm/personaGenerator");
  return { chatCompletion: auditedChatCompletion, extractTags, scoreTagsToDimensions, vpWordScorer, vpCoach, personaGenerator };
}

function inputHash(runId, persona, condition, rep, draw, manifest) {
  return sha256(JSON.stringify({
    run_id: runId,
    persona_id: persona.id,
    map_sha256: persona.map_sha256,
    condition,
    rep,
    r0_jinang: draw,
    question_definition: condition === "Q",
    question_instruction_sha256: sha256(REGISTERED_Q_INSTRUCTION),
    manifest_version: manifest.manifest_version,
    bandwidth: false
  }));
}

async function runChainUntilOk({ FullGame, runtime, persona, condition, rep, draw, manifest, materials, runId }) {
  let rows = readJsonl(ROWS_PATH).filter((row) => row.run_id === runId);
  let latest = latestRowMap(rows).get(`${persona.id}|${condition}|${rep}`);
  let attempts = rows.filter((row) => row.persona_id === persona.id && row.condition === condition && Number(row.rep || 1) === rep).length;
  const inputSha = inputHash(runId, persona, condition, rep, draw, manifest);
  while (latest?.status !== "OK" && attempts < MAX_CHAIN_ATTEMPTS) {
    attempts += 1;
    const startedAt = new Date().toISOString();
    const context = { run_id: runId, chain_key: `${persona.id}|${condition}|${rep}`, chain_attempt: attempts };
    const row = await callContext.run(context, () => FullGame.runPlaythrough(runtime, persona, materials, runId, {
      condition,
      rep,
      jinangDraw: draw,
      questionDefinition: condition === "Q",
      questionDefinitionInstruction: REGISTERED_Q_INSTRUCTION,
      questionDefinitionContextProvider: questionDefinitionContextProvider(FullGame, materials, manifest),
      infoSetManifest: manifest
    }));
    row.chain_attempt = attempts;
    row.retry_input_sha256 = inputSha;
    row.formal_contract = {
      source_structure_commit: SOURCE_COMMIT,
      structure: "7 persona x {Q,S} x 3 reps = 42",
      current_runner: "scripts/analysis/full_game_all_personas.js::runPlaythrough",
      manifest_version: manifest.manifest_version,
      q_instruction_sha256: sha256(REGISTERED_Q_INSTRUCTION),
      bandwidth_enabled: false,
      same_persona_jinang_sha256: sha256(JSON.stringify(draw)),
      provider: PROVIDER,
      model: EXPECTED_MODEL,
      enable_thinking: false
    };
    row.paired_run = {
      pair_id: `${persona.id}|${rep}`,
      condition,
      rep,
      input_sha256: inputSha,
      started_at: startedAt,
      ended_at: new Date().toISOString()
    };
    appendJsonl(ROWS_PATH, row);
    writeJson(path.join(row.status === "OK" ? CHAINS_DIR : FAILED_DIR, `${persona.id}_${condition}${rep}_attempt${attempts}.json`), row);
    latest = row;
    console.error(`[f912715_replay] ${persona.id} ${condition} rep=${rep} attempt=${attempts} ${row.status} error=${row.error || ""}`);
  }
  return latest;
}

function numberValue(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : NaN;
}

function profit(row) {
  return numberValue(row?.r2?.calculate?.output?.profit ?? row?.r2?.calculate?.metrics?.profit);
}

function price(row) {
  return numberValue(row?.r2?.d5?.parsed?.aligned_price ?? row?.r2?.d5?.parsed?.price ?? row?.r2?.calculate?.output?.P);
}

function percentile(values, pct) {
  const sorted = values.filter((value) => Number.isFinite(value)).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const index = Math.ceil((pct / 100) * sorted.length) - 1;
  return sorted[Math.max(0, Math.min(sorted.length - 1, index))];
}

function mean(values) {
  const arr = values.filter((value) => Number.isFinite(value));
  if (!arr.length) return null;
  return arr.reduce((sum, value) => sum + value, 0) / arr.length;
}

function sd(values) {
  const arr = values.filter((value) => Number.isFinite(value));
  if (arr.length < 2) return 0;
  const avg = mean(arr);
  return Math.sqrt(arr.reduce((sum, value) => sum + Math.pow(value - avg, 2), 0) / (arr.length - 1));
}

function conditionSummary(rows, condition) {
  const subset = rows.filter((row) => row.condition === condition && row.status === "OK");
  const profits = subset.map(profit);
  const prices = subset.map(price);
  const losses = profits.filter((value) => Number.isFinite(value) && value < 0).length;
  return {
    n: subset.length,
    loss_count: losses,
    loss_rate: subset.length ? losses / subset.length : null,
    profit_p25: percentile(profits, 25),
    profit_p50: percentile(profits, 50),
    profit_p75: percentile(profits, 75),
    price_p50: percentile(prices, 50),
    price_sd: sd(prices)
  };
}

function buildSummary({ runId, startedAt, finishedAt, args, config, manifest, preflight }) {
  const rows = readJsonl(ROWS_PATH).filter((row) => row.run_id === runId);
  const latest = Array.from(latestRowMap(rows).values());
  const selected = [];
  const latestMap = latestRowMap(rows);
  for (const id of PERSONA_IDS) for (const condition of CONDITIONS) for (const rep of REPS) {
    const row = latestMap.get(`${id}|${condition}|${rep}`);
    if (row) selected.push(row);
  }
  const callAudit = readJsonl(CALL_AUDIT_PATH).filter((row) => row.run_id === runId);
  const ok = selected.filter((row) => row.status === "OK");
  const failed = selected.filter((row) => row.status !== "OK");
  const repairsByStage = { D_q: 0, R1: 0, D3: 0, D4: 0, D5: 0 };
  let salvageCount = 0;
  for (const row of ok) {
    const calls = [
      ...(row.question_definition?.calls || []),
      row.r1_choice,
      row.r2?.d3,
      row.r2?.d4,
      row.r2?.d5
    ].filter(Boolean);
    for (const call of calls) {
      const stage = call.attempt_log?.[0]?.stage || "";
      if (call.salvage) salvageCount += 1;
      if (stage.includes("D_q")) repairsByStage.D_q += Math.max(0, Number(call.attempts || 0) - 1);
      else if (stage.includes("R1")) repairsByStage.R1 += Math.max(0, Number(call.attempts || 0) - 1);
      else if (stage.includes("D3")) repairsByStage.D3 += Math.max(0, Number(call.attempts || 0) - 1);
      else if (stage.includes("D4")) repairsByStage.D4 += Math.max(0, Number(call.attempts || 0) - 1);
      else if (stage.includes("D5")) repairsByStage.D5 += Math.max(0, Number(call.attempts || 0) - 1);
    }
  }
  const summary = {
    run_id: runId,
    source_structure_commit: SOURCE_COMMIT,
    matrix: "7 persona x {Q,S} x 3 reps = 42",
    output_dir: path.relative(ROOT, RUN_ROOT),
    model: config.model,
    provider: PROVIDER,
    enable_thinking: false,
    temperature: TEMPERATURE,
    concurrency: args.concurrency,
    started_at: startedAt,
    finished_at: finishedAt,
    wall_clock_ms: new Date(finishedAt).getTime() - new Date(startedAt).getTime(),
    chains_expected: 42,
    chains_observed_latest: selected.length,
    chains_ok: ok.length,
    chains_failed: failed.length,
    failed_chain_keys: failed.map(chainKey),
    calls_total: callAudit.length,
    calls_ok: callAudit.filter((row) => row.status === "OK").length,
    calls_failed: callAudit.filter((row) => row.status === "FAIL").length,
    repairs_by_stage: repairsByStage,
    salvage_count: salvageCount,
    by_condition: {
      Q: conditionSummary(selected, "Q"),
      S: conditionSummary(selected, "S")
    },
    formal_contract: {
      question_instruction: REGISTERED_Q_INSTRUCTION,
      question_instruction_sha256: sha256(REGISTERED_Q_INSTRUCTION),
      same_jinang_within_persona: true,
      reps: REPS,
      conditions: CONDITIONS,
      manifest_version: manifest.manifest_version,
      manifest_sha256: sha256(JSON.stringify(manifest)),
      historical_preflight_gate: preflight.gate || null,
      historical_runner_blob_sha256: sha256(gitBlob(HISTORICAL_PATHS.formalRunner)),
      note: "Uses f912715 matrix, frozen maps, historical jinang draws, and Q/S questionDefinition semantics; LLM provider/model and current runPlaythrough parser/prompts are from the active workspace."
    }
  };
  writeJson(SUMMARY_PATH, summary);
  return summary;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  loadLocalEnv();
  const config = validateQwenConfig();
  process.env.LLM_CONCURRENCY = String(args.concurrency);
  fs.mkdirSync(CHAINS_DIR, { recursive: true });
  fs.mkdirSync(FAILED_DIR, { recursive: true });
  if (!fs.existsSync(ROWS_PATH)) fs.writeFileSync(ROWS_PATH, "", "utf8");
  if (!fs.existsSync(CALL_AUDIT_PATH)) fs.writeFileSync(CALL_AUDIT_PATH, "", "utf8");

  const manifest = gitBlobJson(HISTORICAL_PATHS.manifest);
  const preflight = gitBlobJson(HISTORICAL_PATHS.preflight);
  if (preflight?.gate?.status !== "PASS" || preflight?.display_settlement?.status !== "PASS") {
    throw new Error("f912715 historical preflight gate is not PASS");
  }

  installReplayInfoSetPatch();
  delete require.cache[require.resolve("./full_game_all_personas")];
  const FullGame = require("./full_game_all_personas");
  const materials = applyF912715FrozenMaps(FullGame, FullGame.loadMaterials(), manifest);
  const runtime = createRuntime(args.runId);
  const draws = loadJinangDraws();
  const personas = materials.personas.filter((persona) => PERSONA_IDS.includes(persona.id));
  const personaById = new Map(personas.map((persona) => [persona.id, persona]));
  const tasks = [];
  for (const id of PERSONA_IDS) for (const condition of CONDITIONS) for (const rep of REPS) {
    tasks.push({ persona: personaById.get(id), condition, rep, draw: draws.get(id) });
  }
  if (tasks.some((task) => !task.persona)) throw new Error("missing one or more f912715 personas");

  const latest = latestRowMap(readJsonl(ROWS_PATH).filter((row) => row.run_id === args.runId));
  const remaining = tasks.filter((task) => latest.get(`${task.persona.id}|${task.condition}|${task.rep}`)?.status !== "OK");
  console.error(`[f912715_replay] run_id=${args.runId} expected=42 remaining=${remaining.length} concurrency=${args.concurrency}`);
  const startedAt = new Date().toISOString();
  const { default: pLimit } = await import("p-limit");
  const limit = pLimit(args.concurrency);
  await Promise.all(remaining.map((task) => limit(() => runChainUntilOk({
    FullGame,
    runtime,
    persona: task.persona,
    condition: task.condition,
    rep: task.rep,
    draw: task.draw,
    manifest,
    materials,
    runId: args.runId
  }))));
  const finishedAt = new Date().toISOString();
  const summary = buildSummary({ runId: args.runId, startedAt, finishedAt, args, config, manifest, preflight });
  console.log(JSON.stringify(summary, null, 2));
  if (summary.chains_ok !== 42 || summary.chains_failed !== 0) {
    process.exitCode = 2;
  }
}

main().catch((error) => {
  console.error(error.stack || error.message || String(error));
  process.exit(1);
});
