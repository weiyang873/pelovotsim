"use strict";

function formatError(err) {
  if (!err) return { message: "Unknown error" };
  return {
    message: String(err.message || err),
    status: Number.isFinite(Number(err.status)) ? Number(err.status) : null,
    step: err.step || null,
    code: err.code || null
  };
}

function createTeamResult(teamIndex, teamSize) {
  return {
    teamIndex,
    teamSize,
    teamId: "",
    status: "pending",
    steps: {},
    timing: {},
    errors: [],
    warnings: [],
    skips: [],
    meta: {}
  };
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function warn(result, message, extra = {}) {
  result.warnings.push({ message, ...extra });
}

function skip(result, step, reason, extra = {}) {
  result.steps[step] = {
    status: "skipped",
    reason,
    ...extra
  };
  result.skips.push({ step, reason, ...extra });
}

function fail(result, step, err) {
  const formatted = formatError(err);
  formatted.step = step;
  result.errors.push(formatted);
  result.steps[step] = {
    status: "failed",
    error: formatted.message,
    http_status: formatted.status
  };
}

async function runStep(result, step, fn) {
  const startedAt = Date.now();
  try {
    const value = await fn();
    const durationMs = Date.now() - startedAt;
    result.timing[step] = durationMs;
    if (!result.steps[step]) {
      result.steps[step] = { status: "passed" };
    } else if (!result.steps[step].status) {
      result.steps[step].status = "passed";
    }
    result.steps[step].duration_ms = durationMs;
    return value;
  } catch (err) {
    const durationMs = Date.now() - startedAt;
    result.timing[step] = durationMs;
    fail(result, step, err);
    result.steps[step].duration_ms = durationMs;
    throw err;
  }
}

function finishResult(result) {
  result.status = result.errors.length > 0 ? "failed" : "passed";
  return result;
}

module.exports = {
  assert,
  createTeamResult,
  finishResult,
  formatError,
  runStep,
  skip,
  warn
};
