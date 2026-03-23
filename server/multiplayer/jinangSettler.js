const path = require("node:path");
const { runSql, sqlQuote } = require("../db/pgSql");

const { loadJinangConfig } = require("./jinangDealer");

const ROOT = path.join(__dirname, "..", "..");

function parseGridId(gridId) {
  const raw = String(gridId || "").trim();
  const parts = raw.split("_");
  if (parts.length < 3) {
    return { customer_type: "ToC", strategy: "DIFF", age: "ADULT" };
  }
  const c = String(parts[0] || "").toLowerCase();
  const s = String(parts[1] || "").toLowerCase();
  const a = String(parts[2] || "").toLowerCase();
  const customer_type = c === "tob" || c === "b2b" ? "ToB" : "ToC";
  const strategy = s.includes("cost") ? "COST" : "DIFF";
  let age = "ADULT";
  if (a.includes("child")) age = "CHILD";
  if (a.includes("elder")) age = "ELDER";
  return { customer_type, strategy, age };
}

function toFixedSafe(n, d) {
  return Number(Number(n || 0).toFixed(d));
}

function mean(values) {
  const arr = values.filter((v) => Number.isFinite(v));
  if (!arr.length) return 0;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function clamp01(v) {
  return Math.max(0, Math.min(1, Number(v || 0)));
}

function strengthLabel(matchStrength) {
  if (matchStrength > 0.7) return "高度契合";
  if (matchStrength >= 0.5) return "部分契合";
  return "契合度有限";
}

function scaleEffectNumbers(value, strength) {
  if (Array.isArray(value)) {
    return value.map((v) => scaleEffectNumbers(v, strength));
  }
  if (value && typeof value === "object") {
    const out = {};
    Object.keys(value).forEach((k) => {
      out[k] = scaleEffectNumbers(value[k], strength);
    });
    return out;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return toFixedSafe(value * strength, 6);
  }
  return value;
}

function buildSelectedR2Groups(decision) {
  if (decision.architecture === "Experience") {
    return ["interaction_expression", "perception_understanding", "scalable_connectable"];
  }
  if (decision.architecture === "Function") {
    return ["motion_navigation", "safety_trust", "ops_maintenance"];
  }
  return [
    "interaction_expression",
    "perception_understanding",
    "motion_navigation",
    "safety_trust",
    "scalable_connectable",
    "ops_maintenance"
  ];
}

function makeFinalDecision(team) {
  const parsed = parseGridId(team.final_grid_id);
  return {
    customer_type: parsed.customer_type,
    strategy: parsed.strategy,
    age: parsed.age,
    architecture: String(team.final_architecture || "").trim() || "Experience"
  };
}

function scoreMarketCard(card, decision) {
  const weights = card?.affinity_weights || {};
  const dims = [];

  const c = Number(weights.customer_type?.[decision.customer_type]);
  if (Number.isFinite(c)) dims.push(c);

  const s = Number(weights.strategy?.[decision.strategy]);
  if (Number.isFinite(s)) dims.push(s);

  const a = Number(weights.age?.[decision.age]);
  if (Number.isFinite(a)) dims.push(a);

  return clamp01(mean(dims));
}

function scoreTechCard(card, decision) {
  const weights = card?.affinity_weights || {};
  const dims = [];

  const arch = Number(weights.architecture?.[decision.architecture]);
  if (Number.isFinite(arch)) dims.push(arch);

  const s = Number(weights.strategy?.[decision.strategy]);
  if (Number.isFinite(s)) dims.push(s);

  const selectedGroups = buildSelectedR2Groups(decision);
  const groupWeights = selectedGroups
    .map((g) => Number(weights.r2_groups?.[g]))
    .filter((v) => Number.isFinite(v));
  if (groupWeights.length > 0) {
    dims.push(Math.max(...groupWeights));
  }

  return clamp01(mean(dims));
}

async function settleAllJinang(teamId) {
  const tid = String(teamId || "").trim();
  if (!tid) throw new Error("teamId required");

  const teamRows = await runSql(`
    SELECT id, final_grid_id, final_architecture
    FROM teams
    WHERE id = ${sqlQuote(tid)}
    LIMIT 1;
  `);
  const team = teamRows[0];
  if (!team) throw new Error(`team not found: ${tid}`);
  if (!team.final_grid_id || !team.final_architecture) {
    throw new Error("team final decision incomplete");
  }

  const members = await runSql(`
    SELECT id, member_name, jinang_market_id, jinang_tech_id
    FROM team_members
    WHERE team_id = ${sqlQuote(tid)}
    ORDER BY member_index ASC;
  `);

  const cfg = loadJinangConfig();
  const marketMap = Object.fromEntries((cfg.market || []).map((c) => [c.id, c]));
  const techMap = Object.fromEntries((cfg.tech || []).map((c) => [c.id, c]));
  const decision = makeFinalDecision(team);

  await runSql(`DELETE FROM jinang_settlements WHERE team_id = ${sqlQuote(tid)};`);

  const settlements = [];

  async function settleCard(member, card, jinangType) {
    if (!card) return;

    const rawStrength = jinangType === "market"
      ? scoreMarketCard(card, decision)
      : scoreTechCard(card, decision);

    const matchStrength = clamp01(rawStrength);
    const matched = matchStrength >= 0.5;
    const effectScaled = matched
      ? scaleEffectNumbers(card.effect_at_full_match || {}, matchStrength)
      : {};

    const effectApplied = jinangType === "market"
      ? {
          apply_to: "round1",
          match_strength: toFixedSafe(matchStrength, 4),
          E_boost_eligible: matched
        }
      : (matched
        ? {
            ...effectScaled,
            apply_to: "round2_only",
            match_strength: toFixedSafe(matchStrength, 4)
          }
        : {
            apply_to: "round2_only",
            match_strength: toFixedSafe(matchStrength, 4)
          });

    const reason = `${strengthLabel(matchStrength)}（契合度 ${toFixedSafe(matchStrength, 2)}）`;

    await runSql(`
      INSERT INTO jinang_settlements (
        id, team_id, member_id, jinang_id, jinang_type, matched, match_reason, effect_applied
      ) VALUES (
        ${sqlQuote(`${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`)},
        ${sqlQuote(tid)},
        ${sqlQuote(member.id)},
        ${sqlQuote(card.id)},
        ${sqlQuote(jinangType)},
        ${matched ? "TRUE" : "FALSE"},
        ${sqlQuote(reason)},
        ${sqlQuote(JSON.stringify(effectApplied))}
      );
    `);

    settlements.push({
      member_id: member.id,
      member_name: member.member_name,
      jinang_id: card.id,
      jinang_type: jinangType,
      name: card.name,
      matched,
      match_strength: toFixedSafe(matchStrength, 4),
      match_reason: reason,
      effect_applied: effectApplied
    });
  }

  for (const m of members) {
    await settleCard(m, marketMap[m.jinang_market_id], "market");
    await settleCard(m, techMap[m.jinang_tech_id], "tech");
  }

  return {
    team_id: tid,
    final_decision: decision,
    settlements
  };
}

module.exports = {
  settleAllJinang
};
