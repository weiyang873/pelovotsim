const ROUND2_ENGINE_PARAMS = require("../../game_config_v0.1/round2_engine_params.json");

function normalizePriceScale(value) {
  const scale = Number(value);
  return Number.isFinite(scale) && scale > 0 ? scale : 1;
}

const PRICE_SCALE = normalizePriceScale(
  ROUND2_ENGINE_PARAMS.PRICE_SCALE ?? ROUND2_ENGINE_PARAMS.global?.PRICE_SCALE
);
const MONEY_SCALE_CONTRACT = `raw-db-scaled-api-v1@${PRICE_SCALE}`;

// teams.final_* stays on the historical raw scale. Scale only at API/log/export
// boundaries so existing rows cannot be multiplied by 0.3 twice.
function scaleStoredMoney(value, options = {}) {
  if (value == null || value === "") return null;
  const num = Number(value);
  if (!Number.isFinite(num)) return null;
  if (options.positiveOnly === true && num <= 0) return null;
  return Number((num * PRICE_SCALE).toFixed(6));
}

function addScaledMoneyFields(source, fieldNames) {
  if (!source || typeof source !== "object") return source;
  const next = { ...source };
  (fieldNames || []).forEach((key) => {
    const scaled = scaleStoredMoney(next[key]);
    if (scaled != null) next[`${key}_scaled`] = scaled;
  });
  next.money_scale = PRICE_SCALE;
  next.money_scale_contract = MONEY_SCALE_CONTRACT;
  return next;
}

function addStoredRound1MoneyViews(team) {
  if (!team || typeof team !== "object") return team;
  return {
    ...team,
    final_sam_raw: team.final_sam ?? null,
    final_sam_scaled: scaleStoredMoney(team.final_sam),
    final_wtp_ref_raw: team.final_wtp_ref ?? null,
    final_wtp_ref_scaled: scaleStoredMoney(team.final_wtp_ref),
    final_wtp_adj_raw: team.final_wtp_adj ?? null,
    final_wtp_adj_scaled: scaleStoredMoney(team.final_wtp_adj),
    money_scale: PRICE_SCALE,
    money_scale_contract: MONEY_SCALE_CONTRACT
  };
}

module.exports = {
  PRICE_SCALE,
  MONEY_SCALE_CONTRACT,
  scaleStoredMoney,
  addScaledMoneyFields,
  addStoredRound1MoneyViews
};
