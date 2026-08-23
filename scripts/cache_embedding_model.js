const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { pipeline, env } = require("@xenova/transformers");
const { getModel } = require("../server/llm/modelRegistry");

const DEFAULT_REVISION = "2c4055b12046f11709e9df2c122e59ffbdc2f900";
const DEFAULT_ONNX_SHA256 = "66fc00f5f29afcaff34092e1bdd20008ca3918265a82fb9695a551e510cc4ebc";
const DEFAULT_TOKENIZER_SHA256 = "b60b6b43406a48bf3638526314f3d232d97058bc93472ff2de930d43686fa441";
const cacheDir = process.env.HF_CACHE_DIR || path.join(process.cwd(), ".cache", "huggingface");
const revision = String(process.env.HF_EMBEDDING_MODEL_REVISION || DEFAULT_REVISION).trim();
const expectedFingerprints = [
  {
    file: "onnx/model_quantized.onnx",
    sha256: String(process.env.HF_EMBEDDING_EXPECTED_ONNX_SHA256 || DEFAULT_ONNX_SHA256).trim()
  },
  {
    file: "tokenizer.json",
    sha256: String(process.env.HF_EMBEDDING_EXPECTED_TOKENIZER_SHA256 || DEFAULT_TOKENIZER_SHA256).trim()
  }
];

function readEmbeddingModel() {
  return getModel("embedding");
}

function sha256File(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function cachedFileCandidates(model, relativeFile) {
  const modelParts = model.split(/[\\/]/).filter(Boolean);
  const cacheName = `models--${model.replace(/[\\/]/g, "--")}`;
  const fileParts = relativeFile.split(/[\\/]/).filter(Boolean);

  return [
    path.join(cacheDir, ...modelParts, revision, ...fileParts),
    path.join(cacheDir, ...modelParts, ...fileParts),
    path.join(cacheDir, "hub", cacheName, "snapshots", revision, ...modelParts, ...fileParts),
    path.join(cacheDir, "hub", cacheName, "snapshots", revision, ...fileParts)
  ];
}

function resolveCachedFile(model, relativeFile) {
  const candidates = cachedFileCandidates(model, relativeFile);
  const found = candidates.find((candidate) => fs.existsSync(candidate));
  if (!found) {
    throw new Error(`Cached embedding file not found: ${relativeFile}; checked ${candidates.join(", ")}`);
  }
  return found;
}

function verifyFingerprints(model) {
  for (const item of expectedFingerprints) {
    if (!/^[0-9a-f]{64}$/i.test(item.sha256)) {
      throw new Error(`Invalid expected sha256 for ${item.file}: ${item.sha256}`);
    }
    const filePath = resolveCachedFile(model, item.file);
    const actual = sha256File(filePath);
    if (actual !== item.sha256) {
      throw new Error(`Embedding fingerprint mismatch for ${item.file}: expected ${item.sha256}, got ${actual}`);
    }
    console.log(`[cacheEmbeddingModel] sha256 ok ${actual}  ${item.file}`);
  }
}

async function main() {
  if (!/^[0-9a-f]{40}$/i.test(revision)) {
    throw new Error(`HF_EMBEDDING_MODEL_REVISION must be a 40-char commit hash, got ${revision}`);
  }

  const model = readEmbeddingModel();
  env.cacheDir = cacheDir;
  env.localModelPath = cacheDir;
  env.allowLocalModels = true;
  env.allowRemoteModels = true;

  console.log(`[cacheEmbeddingModel] model=${model}`);
  console.log(`[cacheEmbeddingModel] revision=${revision}`);
  console.log(`[cacheEmbeddingModel] cacheDir=${cacheDir}`);
  console.log("[cacheEmbeddingModel] downloading pinned snapshot");

  const extractor = await pipeline("feature-extraction", model, { revision });
  await extractor("warm cache", { pooling: "mean", normalize: true });
  verifyFingerprints(model);

  console.log("[cacheEmbeddingModel] done");
}

main().catch((err) => {
  console.error("[cacheEmbeddingModel][ERROR]", err?.stack || err?.message || err);
  process.exitCode = 1;
});
