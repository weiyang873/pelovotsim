"use strict";

const fs = require("fs");
const path = require("path");
const os = require("os");
const crypto = require("crypto");

const MODEL = "Xenova/paraphrase-multilingual-MiniLM-L12-v2";
const MODEL_PARTS = MODEL.split("/");
const CACHE_NAME = `models--${MODEL.replace(/[\\/]/g, "--")}`;
const DEFAULT_ONNX_SHA256 = "66fc00f5f29afcaff34092e1bdd20008ca3918265a82fb9695a551e510cc4ebc";

function adaptFlatLocalModelPath() {
  const localRoot = process.env.HF_LOCAL_MODEL_PATH;
  if (!localRoot) return;

  const flatOnnx = path.join(localRoot, "onnx", "model_quantized.onnx");
  const nestedOnnx = path.join(localRoot, ...MODEL_PARTS, "onnx", "model_quantized.onnx");
  if (!fs.existsSync(flatOnnx) || fs.existsSync(nestedOnnx)) return;

  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "embedding-anchor-"));
  const nestedParent = path.join(tmpRoot, MODEL_PARTS[0]);
  fs.mkdirSync(nestedParent, { recursive: true });
  fs.symlinkSync(localRoot, path.join(nestedParent, MODEL_PARTS[1]), "dir");
  process.env.ANCHOR_TEST_ORIGINAL_HF_LOCAL_MODEL_PATH = localRoot;
  process.env.HF_LOCAL_MODEL_PATH = tmpRoot;
}

adaptFlatLocalModelPath();

const embeddingService = require("../server/llm/embeddingService");
const { prepareVpForWordScoring, scorePreparedVpByWord } = require("../server/llm/vpWordScorer");

const CALIBRATION = [
  { grid: "ToB_Cost_Elder", arch: "Hybrid", vp: "养老院用。老人孤单，员工忙。机器人陪聊。", expected: "差" },
  { grid: "ToC_Diff_Adult", arch: "Experience", vp: "年轻人买，好玩。", expected: "差" },
  { grid: "ToB_Cost_Elder", arch: "Hybrid", vp: "为护工短缺的养老院，提供能陪聊的机器人，让员工能去忙别的事，比请人便宜。失智老人不行。", expected: "中" },
  { grid: "ToC_Diff_Adult", arch: "Experience", vp: "为独居白领，下班回家冷清，提供能主动蹭腿的陪伴机器人，比智能音箱有温度。长期出差不适用。", expected: "中" },
  { grid: "ToB_Cost_Elder", arch: "Hybrid", vp: "为面临护工成本上涨和夜间跌倒高风险的养老机构，提供具备离床监测功能的机器人，通过替代部分人工巡检来优化人力配置并实现风险主动预防——传统依赖人力巡检难以实时响应且成本刚性上涨。失智老人特殊照护单元需结合个性化护理。", expected: "好" },
  { grid: "ToC_Diff_Adult", arch: "Experience", vp: "为25-35岁一线城市独居、每天加班到9点回家只有冰箱声的单身白领，提供一台回家时主动蹭腿发出声音的陪伴机器人，获得不需要维护关系的即时情感连接——智能音箱只能被动问候，养猫狗要喂要遛出差要寄养。长期出差超两周效果打折。", expected: "好" },
  { grid: "ToB_Diff_Child", arch: "Experience", vp: "幼儿园放个机器人，小孩喜欢。", expected: "差" },
  { grid: "ToB_Diff_Child", arch: "Experience", vp: "为每年9月新入园哭闹严重的幼儿园，提供能用光效和声音吸引孩子注意力的陪伴机器人，减轻老师安抚压力。比传统玩具更持久。", expected: "中" },
  { grid: "ToB_Diff_Child", arch: "Experience", vp: "为师幼比严重不足、每年9月新生入园哭闹导致老师疲于安抚的民办幼儿园，提供能通过光效互动和非指令性陪伴持续吸引3-5岁幼儿注意力的机器人，让老师从一对一安抚中解放出来专注集体教学——目前只能靠增加临时老师或家长陪园，成本高且不可持续。自闭症等特殊需求儿童需专业干预。", expected: "好" },
  { grid: "ToC_Cost_Elder", arch: "Function", vp: "老人用，便宜。", expected: "差" },
  { grid: "ToC_Cost_Elder", arch: "Function", vp: "为独居老人的子女，提供能让老人不孤单的机器人，比请保姆便宜。老人不愿意用的话没办法。", expected: "中" },
  { grid: "ToC_Cost_Elder", arch: "Function", vp: "为在外地工作、无法经常回家探望独居父母的子女，提供一台能主动陪父母聊天并在异常情况下通知子女的机器人，缓解子女的远程愧疚感同时降低请钟点工陪护的费用——目前只能靠定期打电话但父母报喜不报忧，请保姆月费高且陪伴质量取决于个人。视力听力严重退化的老人使用受限。", expected: "好" }
];

function sha256File(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function existingPath(candidates) {
  return candidates.find((candidate) => candidate && fs.existsSync(candidate));
}

function onnxCandidates() {
  const localRoot = process.env.HF_LOCAL_MODEL_PATH || "";
  const cacheDir = process.env.HF_CACHE_DIR || path.join(os.homedir(), ".cache", "huggingface");
  const revision = embeddingService.getModelRevision();
  const candidates = [];

  if (process.env.ANCHOR_TEST_ONNX_PATH) {
    candidates.push(process.env.ANCHOR_TEST_ONNX_PATH);
  }
  if (localRoot) {
    candidates.push(
      path.join(localRoot, ...MODEL_PARTS, "onnx", "model_quantized.onnx"),
      path.join(localRoot, "onnx", "model_quantized.onnx")
    );
  }

  candidates.push(
    path.join(cacheDir, ...MODEL_PARTS, revision, "onnx", "model_quantized.onnx"),
    path.join(cacheDir, ...MODEL_PARTS, "onnx", "model_quantized.onnx"),
    path.join(cacheDir, "hub", CACHE_NAME, "snapshots", revision, ...MODEL_PARTS, "onnx", "model_quantized.onnx"),
    path.join(cacheDir, "hub", CACHE_NAME, "snapshots", revision, "onnx", "model_quantized.onnx"),
    path.join(cacheDir, "hub", CACHE_NAME, "snapshots", "main", ...MODEL_PARTS, "onnx", "model_quantized.onnx"),
    path.join(cacheDir, "hub", CACHE_NAME, "snapshots", "main", "onnx", "model_quantized.onnx")
  );

  return [...new Set(candidates)];
}

function verifyOnnxSha256() {
  const candidates = onnxCandidates();
  const onnxPath = existingPath(candidates);
  if (!onnxPath) {
    throw new Error(`onnx/model_quantized.onnx not found; checked ${candidates.join(", ")}`);
  }

  const actual = sha256File(onnxPath);
  const expected = String(process.env.ANCHOR_TEST_EXPECTED_ONNX_SHA256 || DEFAULT_ONNX_SHA256).trim();
  console.log(`[AnchorTest] onnx_sha256=${actual}  ${onnxPath}`);
  if (actual !== expected) {
    throw new Error(`onnx sha256 mismatch: expected ${expected}, got ${actual}`);
  }
  return { onnxPath, actual };
}

function summarizeBuckets(results) {
  const grouped = { "差": [], "中": [], "好": [] };
  for (const item of results) {
    grouped[item.expected].push(item.scores.VPscore);
  }
  return Object.fromEntries(Object.entries(grouped).map(([key, values]) => {
    const avg = values.reduce((sum, value) => sum + value, 0) / values.length;
    return [key, Number(avg.toFixed(3))];
  }));
}

function scoreText(value) {
  return Number(value).toFixed(1);
}

function printScoreTable(results) {
  console.log("| Sample | Expected | C | G | E | VPscore |");
  console.log("| --- | --- | ---: | ---: | ---: | ---: |");
  for (const item of results) {
    const scores = item.scores;
    console.log(`| ${item.sample} | ${item.expected} | ${scoreText(scores.C)} | ${scoreText(scores.G)} | ${scoreText(scores.E)} | ${scoreText(scores.VPscore)} |`);
  }

  const buckets = summarizeBuckets(results);
  console.log("");
  console.log("| Bucket | VPscore average |");
  console.log("| --- | ---: |");
  for (const key of ["差", "中", "好"]) {
    console.log(`| ${key} | ${buckets[key].toFixed(3)} |`);
  }
}

async function main() {
  console.log("[AnchorTest] model=Xenova/paraphrase-multilingual-MiniLM-L12-v2");
  if (process.env.ANCHOR_TEST_ORIGINAL_HF_LOCAL_MODEL_PATH) {
    console.log(`[AnchorTest] original_HF_LOCAL_MODEL_PATH=${process.env.ANCHOR_TEST_ORIGINAL_HF_LOCAL_MODEL_PATH}`);
  }
  console.log(`[AnchorTest] HF_LOCAL_MODEL_PATH=${process.env.HF_LOCAL_MODEL_PATH || "(unset)"}`);
  console.log(`[AnchorTest] HF_CACHE_DIR=${process.env.HF_CACHE_DIR || "(default)"}`);
  console.log(`[AnchorTest] pinned_revision=${embeddingService.getModelRevision()}`);

  await embeddingService.init();
  verifyOnnxSha256();

  const results = [];
  for (let i = 0; i < CALIBRATION.length; i += 1) {
    const sample = CALIBRATION[i];
    const prepared = await prepareVpForWordScoring(sample.vp);
    const result = await scorePreparedVpByWord(prepared, sample.grid, sample.arch);
    results.push({
      sample: i + 1,
      expected: sample.expected,
      scores: result.scores
    });
  }

  printScoreTable(results);
}

main().catch((err) => {
  console.error("[AnchorTest][ERROR]", err?.stack || err?.message || err);
  process.exitCode = 1;
});
