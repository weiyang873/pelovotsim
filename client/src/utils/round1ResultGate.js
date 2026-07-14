export function isRound1FinalizedStatus(status) {
  return ["phase4", "frozen"].includes(String(status || "").toLowerCase());
}

export function hasCompleteRound1Results(results) {
  return Boolean(
    results?.ok === true &&
    String(results?.team?.final_grid_id || "").trim() &&
    String(results?.team?.final_architecture || "").trim() &&
    String(results?.team?.final_vp_text || "").trim()
  );
}

export function gateRequestedRound1Step(requestedStep, statusStep, status) {
  const requested = Number(requestedStep);
  if (requested === 5 && !isRound1FinalizedStatus(status)) {
    return Math.max(0, Math.min(4, Number(statusStep) || 0));
  }
  return Math.max(0, Math.min(5, Number.isFinite(requested) ? requested : 0));
}
