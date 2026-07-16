"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const ROOT = path.join(__dirname, "..", "..");
const LOCAL_EVIDENCE_PATH = path.join(ROOT, "game_config_v0.1", "grid_dimension_evidence_v2.json");
const LOCAL_REPORTS_PATH = path.join(ROOT, "game_config_v0.1", "persona_reports_v1.3.json");

function sha256File(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function gitCommit(cwd) {
  const result = spawnSync("git", ["rev-parse", "HEAD"], { cwd, encoding: "utf8" });
  return result.status === 0 ? String(result.stdout || "").trim() : "";
}

function gitDirty(cwd) {
  const result = spawnSync("git", ["status", "--porcelain"], { cwd, encoding: "utf8" });
  return result.status === 0 && String(result.stdout || "").trim().length > 0;
}

function distribution(values) {
  const sorted = values.filter((value) => value != null && value !== "")
    .map(Number)
    .filter(Number.isFinite)
    .sort((a, b) => a - b);
  if (!sorted.length) return { min: null, median: null, max: null };
  const middle = Math.floor(sorted.length / 2);
  const median = sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
  return {
    min: sorted[0],
    median,
    max: sorted[sorted.length - 1]
  };
}

function localSummarySources() {
  return {
    tags_source: {
      file: path.basename(LOCAL_EVIDENCE_PATH),
      sha256: sha256File(LOCAL_EVIDENCE_PATH)
    },
    persona_reports: {
      file: path.basename(LOCAL_REPORTS_PATH),
      sha256: sha256File(LOCAL_REPORTS_PATH)
    }
  };
}

function writeRunManifest({ runId, outDir, trackers, context = {} }) {
  const teams = (trackers || []).filter(Boolean).map((tracker) => ({
    ...(tracker.team || {}),
    teamIndex: tracker.teamIndex
  }));
  const serverHealth = context.serverHealth || {};
  const sources = serverHealth.summary_sources || localSummarySources();
  const zeroNiceTeams = teams.filter((team) => team.r2_coverNice != null && Number(team.r2_coverNice) === 0).map((team) => ({
    team_index: team.teamIndex,
    grid: team.finalGrid || "",
    coverNice: Number(team.r2_coverNice)
  }));
  if (context.strict === true) {
    for (const warning of zeroNiceTeams) {
      console.warn(`\u001b[31mWARNING coverNice=0 team=${warning.team_index} grid=${warning.grid}\u001b[0m`);
    }
  }
  const previewFinalProfitGaps = teams.map((team) => {
    if (team.r2_previewProfit == null || team.r2_profit == null) return null;
    const preview = Number(team.r2_previewProfit);
    const final = Number(team.r2_profit);
    return Number.isFinite(preview) && Number.isFinite(final) ? final - preview : null;
  }).filter(Number.isFinite);
  const manifest = {
    run_id: runId,
    mode: String(context.mode || "").trim(),
    strict: context.strict === true,
    generated_at: new Date().toISOString(),
    teams_total: teams.length,
    teams_with_final_result: teams.filter((team) => team.r2_profit != null).length,
    tags_source_version: `${sources.tags_source?.file || ""}@sha256:${sources.tags_source?.sha256 || ""}`,
    persona_reports_sha256: sources.persona_reports?.sha256 || "",
    source_files: sources,
    server_commit: String(serverHealth.server_commit || context.serverCommit || "").trim(),
    server_worktree_dirty: serverHealth.server_worktree_dirty === true,
    runner_commit: String(context.runnerCommit || gitCommit(ROOT)).trim(),
    runner_worktree_dirty: gitDirty(ROOT),
    distributions: {
      coverCore: distribution(teams.map((team) => team.r2_coverCore)),
      coverNice: distribution(teams.map((team) => team.r2_coverNice)),
      vscore: distribution(teams.map((team) => team.r2_vscore))
    },
    preview_final_gap: {
      profit_signed_total: previewFinalProfitGaps.reduce((sum, value) => sum + value, 0),
      profit_absolute_total: previewFinalProfitGaps.reduce((sum, value) => sum + Math.abs(value), 0),
      teams_compared: previewFinalProfitGaps.length
    },
    warnings: {
      coverNice_zero_count: zeroNiceTeams.length,
      coverNice_zero_teams: zeroNiceTeams
    }
  };
  const filePath = path.join(outDir, "run_meta.json");
  fs.writeFileSync(filePath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  return { path: filePath, manifest };
}

module.exports = {
  distribution,
  writeRunManifest
};
