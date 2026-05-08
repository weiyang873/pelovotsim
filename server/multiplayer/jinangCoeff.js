"use strict";

/**
 * Single source of truth for market jinang WTP bonus calculation.
 *
 * Used by:
 * - server/routes/teamRoutes.js
 * - server/multiplayer/jinangSettler.js
 *
 * These paths must stay aligned so VP coach previews match settled DB values.
 *
 * Calibration history:
 *   - 2026-04-16: reduced from 0.05 to 0.02
 */

const JINANG_WTP_COEFFICIENT = 0.02;

function clamp01(v) {
  return Math.max(0, Math.min(1, Number(v || 0)));
}

function toFixedSafe(n, d) {
  return Number(Number(n || 0).toFixed(d));
}

function computeJinangWtpBonus(matchStrength) {
  return toFixedSafe(clamp01(matchStrength) * JINANG_WTP_COEFFICIENT, 4);
}

module.exports = {
  JINANG_WTP_COEFFICIENT,
  computeJinangWtpBonus,
  clamp01,
  toFixedSafe
};
