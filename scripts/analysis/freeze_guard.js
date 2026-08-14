"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { execFileSync } = require("node:child_process");

const ROOT = path.join(__dirname, "..", "..");

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function sha256(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function resolveRoot(filePath) {
  return path.isAbsolute(filePath) ? filePath : path.join(ROOT, filePath);
}

function gitHead() {
  return execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim();
}

function gitIsAncestor(ancestor, descendant) {
  try {
    execFileSync("git", ["merge-base", "--is-ancestor", ancestor, descendant], { cwd: ROOT, stdio: "ignore" });
    return true;
  } catch (_error) {
    return false;
  }
}

function assertHashLocked(items, label, failures) {
  for (const item of items || []) {
    const filePath = resolveRoot(item.path);
    if (!fs.existsSync(filePath)) {
      failures.push(`${label} missing: ${item.path}`);
      continue;
    }
    const actual = sha256(filePath);
    if (actual !== item.sha256) {
      failures.push(`${label} hash mismatch: ${item.path} expected=${item.sha256} actual=${actual}`);
    }
  }
}

function assertForbiddenPatterns(items, failures) {
  for (const item of items || []) {
    const filePath = resolveRoot(item.path);
    if (!fs.existsSync(filePath)) {
      failures.push(`forbidden-pattern file missing: ${item.path}`);
      continue;
    }
    const text = fs.readFileSync(filePath, "utf8");
    for (const pattern of item.patterns || []) {
      const regex = new RegExp(pattern, "u");
      if (regex.test(text)) {
        failures.push(`forbidden pattern found in ${item.path}: ${pattern}`);
      }
    }
  }
}

function assertReplaySources(source, failures) {
  if (!source) return;
  const replayDirs = [];
  for (const batch of source.batches || []) {
    const batchPath = resolveRoot(batch);
    if (!fs.existsSync(batchPath)) {
      failures.push(`source batch missing: ${batch}`);
      continue;
    }
    for (const entry of fs.readdirSync(batchPath, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const dirPath = path.join(batchPath, entry.name);
      if (
        fs.existsSync(path.join(dirPath, "run_meta.json"))
        && fs.existsSync(path.join(dirPath, "r1_frozen.json"))
        && fs.existsSync(path.join(dirPath, "r1_transcript.json"))
      ) {
        replayDirs.push(path.relative(ROOT, dirPath));
      }
    }
  }
  replayDirs.sort();
  if (Number.isInteger(source.expected_replay_dirs) && replayDirs.length !== source.expected_replay_dirs) {
    failures.push(`source replay dir count mismatch: expected=${source.expected_replay_dirs} actual=${replayDirs.length}`);
  }
  const expectedByPath = new Map((source.r1_frozen_hashes || []).map((item) => [item.path, item.sha256]));
  for (const [relativePath, expectedHash] of expectedByPath.entries()) {
    const filePath = resolveRoot(relativePath);
    if (!fs.existsSync(filePath)) {
      failures.push(`source r1_frozen missing: ${relativePath}`);
      continue;
    }
    const actual = sha256(filePath);
    if (actual !== expectedHash) {
      failures.push(`source r1_frozen hash mismatch: ${relativePath} expected=${expectedHash} actual=${actual}`);
    }
  }
}

function main() {
  const args = process.argv.slice(2);
  const manifestIndex = args.indexOf("--manifest");
  if (manifestIndex < 0 || !args[manifestIndex + 1]) {
    throw new Error("usage: node scripts/analysis/freeze_guard.js --manifest freeze_manifests/<id>.json");
  }
  const manifestPath = resolveRoot(args[manifestIndex + 1]);
  const manifest = readJson(manifestPath);
  const failures = [];

  if (manifest.git?.head) {
    const actualHead = gitHead();
    const headPolicy = manifest.git.head_policy || "exact";
    if (
      headPolicy === "ancestor_ok_with_hashes"
      && actualHead !== manifest.git.head
      && !gitIsAncestor(manifest.git.head, actualHead)
    ) {
      failures.push(`git head ancestry mismatch: expected_ancestor=${manifest.git.head} actual=${actualHead}`);
    } else if (headPolicy !== "ancestor_ok_with_hashes" && actualHead !== manifest.git.head) {
      failures.push(`git head mismatch: expected=${manifest.git.head} actual=${actualHead}`);
    }
  }

  assertHashLocked(manifest.hashes?.code, "code", failures);
  assertHashLocked(manifest.hashes?.runner, "runner", failures);
  assertHashLocked(manifest.hashes?.data, "data", failures);
  assertHashLocked(manifest.hashes?.config, "config", failures);
  assertReplaySources(manifest.source, failures);
  assertForbiddenPatterns(manifest.forbidden_patterns, failures);

  const report = {
    manifest: path.relative(ROOT, manifestPath),
    version_id: manifest.version_id,
    scope: manifest.scope,
    design: manifest.design,
    created_at: manifest.created_at,
    git_head_policy: manifest.git?.head_policy || "exact",
    git_head_actual: gitHead(),
    status: failures.length ? "failed" : "ok",
    failures,
    runner_command: manifest.runner?.command || null
  };
  console.log(JSON.stringify(report, null, 2));
  if (failures.length) process.exitCode = 1;
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(error.stack || error.message || String(error));
    process.exitCode = 1;
  }
}
