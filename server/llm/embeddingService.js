// embeddingService.js - 本地 embedding 服务，服务器启动时初始化
const { pipeline, env } = require("@xenova/transformers");
const path = require("path");
const fs = require("fs");
const { getModel } = require("./modelRegistry");

const ANCHOR_PATH = path.join(__dirname, "..", "..", "data", "round2_dim_anchors_v1.json");
const EMBEDDING_MODEL = getModel("embedding");
const EMBEDDING_CACHE_DIR_NAME = `models--${EMBEDDING_MODEL.replace(/[\\/]/g, "--")}`;
const CACHE_DIR = process.env.HF_CACHE_DIR || path.join(process.env.HOME || "", ".cache", "huggingface");
const LOCAL_MODEL_ROOT = process.env.HF_LOCAL_MODEL_PATH || path.join(
  process.env.HOME || "",
  ".cache",
  "huggingface",
  "hub",
  EMBEDDING_CACHE_DIR_NAME,
  "snapshots",
  "main"
);

let embedder = null;
let anchorVectors = {};
let anchorConfig = null;
let initPromise = null;

function configureTransformersEnv() {
  env.cacheDir = CACHE_DIR;
  env.localModelPath = LOCAL_MODEL_ROOT;
  env.allowLocalModels = true;
  if (process.env.HF_DISABLE_REMOTE === "1") {
    env.allowRemoteModels = false;
  }
  console.log(`[EmbeddingService] env.cacheDir=${env.cacheDir}`);
  console.log(`[EmbeddingService] env.localModelPath=${env.localModelPath}`);
}

function hasLocalModelFiles(rootDir) {
  if (!rootDir) return false;
  const modelPathParts = EMBEDDING_MODEL.split(/[\\/]/).filter(Boolean);
  const candidates = [
    path.join(rootDir, ...modelPathParts),
    rootDir
  ];
  return candidates.some((dir) => (
    fs.existsSync(path.join(dir, "config.json")) &&
    fs.existsSync(path.join(dir, "tokenizer.json")) &&
    (
      fs.existsSync(path.join(dir, "onnx", "model.onnx")) ||
      fs.existsSync(path.join(dir, "onnx", "model_quantized.onnx"))
    )
  ));
}

async function init() {
  if (embedder && anchorConfig) return;
  if (initPromise) return initPromise;

  initPromise = (async () => {
    configureTransformersEnv();
    console.log(`[EmbeddingService] 加载模型 ${EMBEDDING_MODEL}...`);
    if (hasLocalModelFiles(LOCAL_MODEL_ROOT)) {
      try {
        embedder = await pipeline("feature-extraction", EMBEDDING_MODEL, {
          local_files_only: true
        });
        console.log("[EmbeddingService] 本地模型加载完成（localModelPath + model id）");
      } catch (localErr) {
        console.warn("[EmbeddingService] 本地缓存加载失败，回退在线加载:", localErr.message || localErr);
      }
    } else {
      console.warn("[EmbeddingService] 本地模型文件不完整，回退在线加载。");
    }
    if (!embedder) {
      embedder = await pipeline("feature-extraction", EMBEDDING_MODEL);
      console.log("[EmbeddingService] 在线模型加载完成");
    }

    if (!fs.existsSync(ANCHOR_PATH)) {
      throw new Error(`anchor 文件不存在: ${ANCHOR_PATH}`);
    }

    anchorConfig = JSON.parse(fs.readFileSync(ANCHOR_PATH, "utf8"));
    anchorVectors = {};

    console.log("[EmbeddingService] 预计算 anchor 向量...");
    for (const dim of anchorConfig.dimensions || []) {
      const anchors = (anchorConfig.anchors && anchorConfig.anchors[dim.key]) || [];
      anchorVectors[dim.key] = await Promise.all(anchors.map((text) => embed(text)));
    }
    console.log("[EmbeddingService] anchor 向量预计算完成");
  })();

  try {
    await initPromise;
  } finally {
    initPromise = null;
  }
}

async function embed(text) {
  if (!embedder) throw new Error("EmbeddingService not initialized");
  const output = await embedder(String(text || ""), { pooling: "mean", normalize: true });
  return Array.from(output.data || []);
}

function cosine(a, b) {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

function maxCosineToDimension(tagVec, dimensionKey) {
  const anchors = anchorVectors[dimensionKey];
  if (!anchors || !anchors.length) return 0;
  return Math.max(...anchors.map((av) => cosine(tagVec, av)));
}

function linearMapRawToScores(raw, dims) {
  const rawValues = Object.values(raw);
  const minRaw = Math.min(...rawValues);
  const maxRaw = Math.max(...rawValues);
  const scores = {};

  if (!Number.isFinite(minRaw) || !Number.isFinite(maxRaw) || maxRaw === minRaw) {
    for (const dim of dims) {
      scores[dim.key] = 1;
    }
    return scores;
  }

  for (const dim of dims) {
    const normalized = (raw[dim.key] - minRaw) / (maxRaw - minRaw);
    scores[dim.key] = Math.round(1 + normalized * 9);
  }

  return scores;
}

async function scoreTags(tags) {
  if (!embedder) throw new Error("EmbeddingService not initialized");
  if (!anchorConfig) throw new Error("anchor config not loaded");

  const tau = Number(anchorConfig.tau ?? 0.3);
  const dims = Array.isArray(anchorConfig.dimensions) ? anchorConfig.dimensions : [];

  const cleanTags = (Array.isArray(tags) ? tags : []).map((t) => String(t || "").trim()).filter(Boolean);
  const tagVecs = await Promise.all(cleanTags.map((t) => embed(t)));

  const raw = {};
  for (const dim of dims) {
    raw[dim.key] = 0;
    for (const tagVec of tagVecs) {
      const s = maxCosineToDimension(tagVec, dim.key);
      const g = Math.max(0, s - tau);
      raw[dim.key] += g;
    }
  }

  return linearMapRawToScores(raw, dims);
}

async function scoreTagsWithPolarity(tags) {
  if (!embedder) throw new Error("EmbeddingService not initialized");
  if (!anchorConfig) throw new Error("anchor config not loaded");

  const tau = Number(anchorConfig.tau ?? 0.3);
  const dims = Array.isArray(anchorConfig.dimensions) ? anchorConfig.dimensions : [];

  const cleanTags = (Array.isArray(tags) ? tags : [])
    .map((t) => ({
      tag: String(t?.tag || "").trim(),
      polarity: t?.polarity === "negative" ? "negative" : "positive"
    }))
    .filter((t) => t.tag);

  const tagVecs = await Promise.all(cleanTags.map((t) => embed(t.tag)));

  const raw = {};
  const sMatrix = {};
  for (const dim of dims) {
    raw[dim.key] = 0;
    sMatrix[dim.key] = [];
    for (let i = 0; i < cleanTags.length; i += 1) {
      const s = maxCosineToDimension(tagVecs[i], dim.key);
      const g = Math.max(0, s - tau);
      sMatrix[dim.key].push({
        tag: cleanTags[i].tag,
        polarity: cleanTags[i].polarity,
        s
      });
      if (cleanTags[i].polarity === "positive") {
        raw[dim.key] += g;
      } else {
        raw[dim.key] -= g;
      }
    }
  }

  for (const dim of dims) {
    console.log(`[EmbeddingService][s(tag,d)] dim=${dim.key}`);
    for (const row of sMatrix[dim.key]) {
      console.log(
        `  tag=${row.tag} polarity=${row.polarity} s=${Number(row.s).toFixed(6)}`
      );
    }
  }

  for (const dim of dims) {
    console.log(`[EmbeddingService][raw] dim=${dim.key} raw=${Number(raw[dim.key]).toFixed(6)}`);
  }

  return linearMapRawToScores(raw, dims);
}

function getAnchorVersion() {
  return anchorConfig?.anchor_version || "unknown";
}

function getDimensions() {
  return Array.isArray(anchorConfig?.dimensions) ? anchorConfig.dimensions : [];
}

module.exports = {
  init,
  embed,
  scoreTags,
  scoreTagsWithPolarity,
  maxCosineToDimension,
  getAnchorVersion,
  getDimensions
};
