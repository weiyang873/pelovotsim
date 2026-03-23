(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    const api = factory(require("node:fs"), require("node:path"));
    module.exports = api;

    if (require.main === module) {
      const p = require("node:path");
      const configDir = p.join(process.cwd(), "game_config_v0.1");
      api.loadConfig(configDir);

      const t1 = api.computeR1WTP("ToC_DIFF_ELDER");
      console.assert(Math.abs(t1.WTPmean - 18091) / 18091 < 0.02, "ToC_DIFF_ELDER WTPmean");
      console.assert(t1.SAM_billion >= 330 && t1.SAM_billion <= 365, "ToC_DIFF_ELDER SAM");

      const t2 = api.computeR1WTP("ToC_COST_ADULT");
      console.assert(Math.abs(t2.WTPmean - 12404) / 12404 < 0.02, "ToC_COST_ADULT WTPmean");

      const t3 = api.computeR1WTP("ToB_DIFF_ELDER");
      console.assert(t3.WTPref > t3.WTPmedian, "ToB bucket mean > median");

      const r1 = api.computeRound1V2("ToC_DIFF_ADULT", "Experience", { C: 4, G: 3, E: 4 }, 0.7);
      console.assert(r1.Eadj === 4.7, "E=4 + 1.0*0.7 = 4.7");
      console.assert(r1.rho_C === 0.70, "C=4 -> rho=0.70");
      console.assert(r1.lambda_G === 0.90, "G=3.0 -> lambda=0.90");
      console.assert(r1.lambda_E === 1.07, "Eadj=4.7 -> lambda=1.07");
      console.assert(Math.abs(r1.wtp_multiplier - 0.963) < 0.001, "0.90 * 1.07 = 0.963");
      const r2 = api.computeRound1V2("ToC_DIFF_ADULT", "Experience", { C: 3.2, G: 3.8, E: 2.5 }, 0.5);
      console.assert(r2.Eadj === 3.0, "E=2.5 + 1.0*0.5 = 3.0");
      console.assert(r2.lambda_G === 0.98, "G=3.8 -> lambda=0.98");
      console.assert(r2.lambda_E === 0.90, "Eadj=3.0 -> lambda=0.90");
      console.assert(Math.abs(r2.wtp_multiplier - 0.882) < 0.001, "0.98 * 0.90 = 0.882");
      console.assert(r1.SAM_billion > 300, "SAM > 300 亿");
      console.assert(r1.WTPadj > 0, "WTPadj positive");

      console.log("[Round1 v2] All assertions passed.");
      console.log(JSON.stringify(r1, null, 2));
    }
  } else {
    root.Engine = factory(null, null);
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function (fs, path) {
  const VALUE_KEYS = ["emotion", "intelligence", "privacy", "fun", "value_for_money", "function"];

  // ── Round 1 v2：SAM–WTP 框架参数 ──
  const R1_GLOBAL = {
    Panchor: 30000,
    Nsteps: 20,
    delta: 1.0
  };

  const R1_SHAPE = {
    cv: { ELDER: 0.35, ADULT: 0.40, CHILD: 0.38 },
    sigma_log: { ELDER: 0.50, ADULT: 0.55, CHILD: 0.50 }
  };

  const R1_PERCENTILE = { ELDER: 0.97, ADULT: 0.97, CHILD: 0.97 };

  const R1_GRID = {
    ToC_ELDER: { N_DIFF: 1200, N_COST: 2400, Aw: 0.160 },
    ToC_ADULT: { N_DIFF: 1800, N_COST: 3600, Aw: 0.115 },
    ToC_CHILD: { N_DIFF: 1300, N_COST: 2600, Aw: 0.170 },
    ToB_ELDER: { N_DIFF: 800, N_COST: 1600, Aw: 0.220 },
    ToB_ADULT: { N_DIFF: 1500, N_COST: 3000, Aw: 0.120 },
    ToB_CHILD: { N_DIFF: 1000, N_COST: 2000, Aw: 0.190 }
  };

  const RHO_MAP = { 1: 0.10, 2: 0.30, 3: 0.50, 4: 0.70, 5: 0.90 };
  const LAMBDA_MAP = { 1: 0.70, 2: 0.80, 3: 0.90, 4: 1.00, 5: 1.10 };

  const CELL_ALIAS = {
    B2C_DIFF_EXP: "B2C|差异化|体验",
    B2C_DIFF_HYB: "B2C|差异化|混合",
    B2C_DIFF_FUNC: "B2C|差异化|功能",
    B2C_COST_EXP: "B2C|成本领先|体验",
    B2C_COST_HYB: "B2C|成本领先|混合",
    B2C_COST_FUNC: "B2C|成本领先|功能",
    B2B_DIFF_EXP: "B2B|差异化|体验",
    B2B_DIFF_HYB: "B2B|差异化|混合",
    B2B_DIFF_FUNC: "B2B|差异化|功能",
    B2B_COST_EXP: "B2B|成本领先|体验",
    B2B_COST_HYB: "B2B|成本领先|混合",
    B2B_COST_FUNC: "B2B|成本领先|功能"
  };

  function clip(x, min, max) {
    return Math.max(min, Math.min(max, x));
  }

  function roundToTenth(x, fallback) {
    const n = Number(x);
    if (!Number.isFinite(n)) return fallback;
    return Math.round(n * 10) / 10;
  }

  function lambdaForScore(score) {
    const s = clip(roundToTenth(score, 3.0), 1, 5);
    return Number((0.70 + (s - 1) * 0.10).toFixed(2));
  }

  function resolveCellId(cellId) {
    return CELL_ALIAS[cellId] || cellId;
  }

  function customerTypeOf(cellId) {
    const raw = cellId || "";
    const resolved = resolveCellId(raw);
    if (raw.startsWith("B2C") || resolved.startsWith("B2C")) return "B2C";
    if (raw.startsWith("B2B") || resolved.startsWith("B2B")) return "B2B";
    throw new Error(`cannot infer customer type from cell_id: ${cellId}`);
  }

  function uniformVector() {
    const out = {};
    const v = 1 / VALUE_KEYS.length;
    VALUE_KEYS.forEach((k) => {
      out[k] = v;
    });
    return out;
  }

  function normalizeNonnegativeVector(vec) {
    const pos = {};
    VALUE_KEYS.forEach((k) => {
      pos[k] = Math.max(0, Number(vec?.[k] ?? 0));
    });
    const sum = VALUE_KEYS.reduce((acc, k) => acc + pos[k], 0);
    if (sum <= 0) return uniformVector();

    const out = {};
    VALUE_KEYS.forEach((k) => {
      out[k] = pos[k] / sum;
    });
    return out;
  }

  function normalizeAbsVector(vec) {
    const abs = {};
    VALUE_KEYS.forEach((k) => {
      abs[k] = Math.abs(Number(vec?.[k] ?? 0));
    });
    const sum = VALUE_KEYS.reduce((acc, k) => acc + abs[k], 0);
    if (sum <= 0) return uniformVector();

    const out = {};
    VALUE_KEYS.forEach((k) => {
      out[k] = abs[k] / sum;
    });
    return out;
  }

  function aggregateValueVector(cards) {
    const raw = {};
    VALUE_KEYS.forEach((k) => {
      raw[k] = 0;
    });
    cards.forEach((card) => {
      VALUE_KEYS.forEach((k) => {
        raw[k] += Number(card.value_vector?.[k] ?? 0);
      });
    });
    return raw;
  }

  function cardIndex(config) {
    const m = {};
    (config.feature_cards.cards || []).forEach((c) => {
      m[c.id] = c;
    });
    return m;
  }

  function getMacroByCell(config, cellIdInput) {
    const cellId = resolveCellId(cellIdInput);
    const candidates = [
      `cell_macro_${cellIdInput}`,
      `cell_macro_${cellId}`,
      cellIdInput,
      cellId
    ];
    for (const key of candidates) {
      if (config.market_knowledge[key]) return config.market_knowledge[key];
    }
    throw new Error(`market_knowledge not found for cell_id: ${cellIdInput}`);
  }

  function normalizeCustomerType(value) {
    const raw = String(value || "").trim().toUpperCase();
    if (raw === "TOC" || raw === "B2C") return "ToC";
    if (raw === "TOB" || raw === "B2B") return "ToB";
    throw new Error(`invalid customer_type: ${value}`);
  }

  function normalizeStrategy(value) {
    const raw = String(value || "").trim().toUpperCase();
    if (raw === "DIFF" || raw === "DIFFERENTIATION") return "DIFF";
    if (raw === "COST") return "COST";
    throw new Error(`invalid strategy: ${value}`);
  }

  function normalizeAgeGroup(value) {
    const raw = String(value || "").trim().toUpperCase();
    if (raw === "ELDER" || raw === "ADULT" || raw === "CHILD") return raw;
    throw new Error(`invalid age_group: ${value}`);
  }

  function normalizeArchTag(value) {
    const raw = String(value || "").trim().toUpperCase();
    if (raw === "EXPERIENCE" || raw === "EXP") return "Experience";
    if (raw === "HYBRID" || raw === "HYB") return "Hybrid";
    if (raw === "FUNCTION" || raw === "FUNC") return "Function";
    throw new Error(`invalid arch_tag: ${value}`);
  }

  function safeNumber(value, name) {
    const n = Number(value);
    if (!Number.isFinite(n)) throw new Error(`invalid number: ${name}`);
    return n;
  }

  function normalInverseCDF(p) {
    const pp = Number(p);
    if (!(pp > 0 && pp < 1)) {
      throw new Error(`p must be in (0,1), got ${p}`);
    }

    const a = [
      -3.969683028665376e+01,
      2.209460984245205e+02,
      -2.759285104469687e+02,
      1.38357751867269e+02,
      -3.066479806614716e+01,
      2.506628277459239e+00
    ];
    const b = [
      -5.447609879822406e+01,
      1.615858368580409e+02,
      -1.556989798598866e+02,
      6.680131188771972e+01,
      -1.328068155288572e+01
    ];
    const c = [
      -7.784894002430293e-03,
      -3.223964580411365e-01,
      -2.400758277161838e+00,
      -2.549732539343734e+00,
      4.374664141464968e+00,
      2.938163982698783e+00
    ];
    const d = [
      7.784695709041462e-03,
      3.224671290700398e-01,
      2.445134137142996e+00,
      3.754408661907416e+00
    ];

    const plow = 0.02425;
    const phigh = 1 - plow;

    let q;
    let r;
    if (pp < plow) {
      q = Math.sqrt(-2 * Math.log(pp));
      return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
        ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
    }

    if (pp > phigh) {
      q = Math.sqrt(-2 * Math.log(1 - pp));
      return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
        ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
    }

    q = pp - 0.5;
    r = q * q;
    return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q /
      (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
  }

  function parseR1GridId(gridId) {
    const raw = String(gridId || "").trim();
    const parts = raw.split("_");
    if (parts.length < 3) throw new Error("invalid grid_id: " + raw);

    const c = parts[0].toUpperCase();
    const channel = c === "TOB" || c === "B2B" ? "ToB" : "ToC";

    const s = parts[1].toUpperCase();
    const strategy = s.includes("COST") ? "COST" : "DIFF";

    const a = parts[2].toUpperCase();
    let age = "ADULT";
    if (a.includes("ELDER") || a.includes("OLD") || a.includes("SENIOR")) age = "ELDER";
    if (a.includes("CHILD") || a.includes("KID")) age = "CHILD";

    return { channel, strategy, age };
  }

  function computeBucketMean(strategy, age, mu, sigmaOrSigmaLog) {
    const N = R1_GLOBAL.Nsteps;
    let sum = 0;
    for (let k = 1; k <= N; k += 1) {
      const p = Math.min(k / N, 0.9999);
      const z = normalInverseCDF(p);
      let bucketPrice;
      if (strategy === "DIFF") {
        bucketPrice = mu + sigmaOrSigmaLog * z;
      } else {
        bucketPrice = Math.exp(mu + sigmaOrSigmaLog * z);
      }
      sum += Math.max(bucketPrice, 0);
    }
    return sum / N;
  }

  function computeR1WTP(gridId) {
    const { channel, strategy, age } = parseR1GridId(gridId);
    const channelAge = channel + "_" + age;
    const grid = R1_GRID[channelAge];
    if (!grid) throw new Error("grid config not found: " + channelAge);

    const Panchor = R1_GLOBAL.Panchor;
    const ps = R1_PERCENTILE[age];
    const zPs = normalInverseCDF(ps);

    let WTPmean;
    let WTPmedian;
    let mu;
    let sigmaOrSigmaLog;

    if (strategy === "DIFF") {
      const cv = R1_SHAPE.cv[age];
      mu = Panchor / (1 + cv * zPs);
      sigmaOrSigmaLog = cv * mu;
      WTPmean = mu;
      WTPmedian = mu;
    } else {
      const sigmaLog = R1_SHAPE.sigma_log[age];
      const muLog = Math.log(Panchor) - sigmaLog * zPs;
      mu = muLog;
      sigmaOrSigmaLog = sigmaLog;
      WTPmean = Math.exp(muLog + sigmaLog * sigmaLog / 2);
      WTPmedian = Math.exp(muLog);
    }

    let WTPref;
    let WTPmeanFinal = WTPmean;
    if (channel === "ToB") {
      const bucketMean = computeBucketMean(strategy, age, mu, sigmaOrSigmaLog);
      WTPmeanFinal = bucketMean;
      WTPref = bucketMean;
    } else {
      WTPref = WTPmedian;
    }

    const N = strategy === "DIFF" ? grid.N_DIFF : grid.N_COST;
    const SAMbillion = N * grid.Aw * WTPmeanFinal / 10000;

    return {
      WTPmean: WTPmeanFinal,
      WTPmedian,
      WTPref,
      SAM_billion: Math.round(SAMbillion),
      channel,
      strategy,
      age,
      mu,
      sigma_or_sigmaLog: sigmaOrSigmaLog
    };
  }

  function computeRound1V2(gridId, archTag, vpScores, jinangMatchStrength) {
    const wtp = computeR1WTP(gridId);

    const C = clip(roundToTenth(vpScores?.C, 3.0), 1, 5);
    const G = clip(roundToTenth(vpScores?.G, 3.0), 1, 5);
    const ERaw = clip(roundToTenth(vpScores?.E, 3.0), 1, 5);

    const m = clip(Number(jinangMatchStrength || 0), 0, 1);
    const delta = R1_GLOBAL.delta;
    const Eadj = clip(roundToTenth(ERaw + delta * m, ERaw), 1, 5);

    const rhoC = RHO_MAP[Math.round(C)];
    const lambdaG = lambdaForScore(G);
    const lambdaE = lambdaForScore(Eadj);
    const WTPadj = wtp.WTPref * lambdaG * lambdaE;

    return {
      grid_id: gridId,
      channel: wtp.channel,
      strategy: wtp.strategy,
      age: wtp.age,
      arch_tag: archTag,
      SAM_billion: wtp.SAM_billion,
      WTPmean: Math.round(wtp.WTPmean),
      WTPmedian: Math.round(wtp.WTPmedian),
      WTPref: Math.round(wtp.WTPref),
      WTPadj: Math.round(WTPadj),
      C,
      G,
      E_raw: ERaw,
      Eadj,
      rho_C: rhoC,
      lambda_G: lambdaG,
      lambda_E: lambdaE,
      wtp_multiplier: lambdaG * lambdaE,
      jinang_match_strength: m,
      jinang_E_boost: Eadj - ERaw
    };
  }

  function computeRound1(teamState) {
    const round1 = teamState?.round1 || {};
    const gridId = round1.cell_id || teamState?.cell_id || "";
    const archTag = normalizeArchTag(round1.arch_tag || "Experience");
    const vpScores = round1.vp_scores || { C: 3, G: 3, E: 3 };
    const jinangMs = Number(round1.jinang_market_match_strength || 0);
    return computeRound1V2(gridId, archTag, vpScores, jinangMs);
  }

  function evaluateRound1(teamState) {
    return computeRound1(teamState);
  }

  function getChoiceCount(config) {
    if (Number.isFinite(Number(config?.choice_rules?.feature_cards_choose))) return Number(config.choice_rules.feature_cards_choose);
    if (Number.isFinite(Number(config?.lovot_baseline?.choice_rules?.feature_cards_choose))) return Number(config.lovot_baseline.choice_rules.feature_cards_choose);
    return 6;
  }

  function parseRound2Channels(round2) {
    const channels = Array.isArray(round2.channels) ? round2.channels : [];
    if (channels.length === 0) throw new Error("round2.channels is required (1 or 2 channels)");
    if (channels.length > 2) throw new Error("round2.channels cannot exceed 2");
    return channels;
  }

  function getCardSubscriptionLift(card) {
    if (card.subscription_lift) {
      return {
        penetration: Number(card.subscription_lift.penetration ?? 0),
        retention: Number(card.subscription_lift.retention ?? 0)
      };
    }
    return {
      penetration: Number(card.pen_lift ?? 0),
      retention: Number(card.ret_lift ?? 0)
    };
  }

  function getSubscriptionBaseline(macro) {
    const s = macro.subscription_baseline || {};
    return {
      penetration_base: Number(s.penetration_base ?? s.p0 ?? 0),
      retention_base: Number(s.retention_base ?? s.r0 ?? 0.85),
      arpu_tier: s.arpu_tier || {}
    };
  }

  function simulateRound2(teamState, config) {
    const cellIdInput = teamState?.cell_id || teamState?.cell_macro_x || teamState?.round1?.cell_id;
    if (!cellIdInput) throw new Error("cell_id is required for Round2");
    if (!teamState?.round2?.selected_cards) throw new Error("round2.selected_cards is required");

    const macro = getMacroByCell(config, cellIdInput);
    const selectedIds = teamState.round2.selected_cards;
    const chooseCount = getChoiceCount(config);
    if (selectedIds.length !== chooseCount) {
      throw new Error(`selected_cards must be exactly ${chooseCount}`);
    }

    const cardsById = cardIndex(config);
    const selectedCards = selectedIds.map((id) => {
      const card = cardsById[id];
      if (!card) throw new Error(`feature card not found: ${id}`);
      return card;
    });

    const channels = parseRound2Channels(teamState.round2);
    const allowed = Array.isArray(macro.channel_options) ? macro.channel_options : Object.keys(macro.channel_fee_rate || {});
    channels.forEach((c) => {
      if (!allowed.includes(c)) throw new Error(`channel not allowed in this cell: ${c}`);
    });

    const pricing = config.pricing_rules;
    const demand = config.demand_model;
    const subModel = config.subscription_model;

    const complianceTier = String(teamState.round2.compliance_tier || "LOW").toUpperCase();
    const subPriceTier = String(teamState.round2.sub_price_tier || "MID").toUpperCase();
    const contentTier = String(teamState.round2.content_tier || "LOW").toUpperCase();

    const baseline = Number(config.lovot_baseline?.baseline_bom);
    if (!Number.isFinite(baseline)) throw new Error("lovot_baseline.baseline_bom is required");
    const bomTotal = baseline + selectedCards.reduce((acc, c) => acc + Number(c.bom_delta || 0), 0);
    const riskLevel = selectedCards.reduce((acc, c) => Math.max(acc, Number(c.risk_level || 0)), 0);

    let channelFee;
    if (channels.length === 1) {
      channelFee = Number(macro.channel_fee_rate?.[channels[0]]);
      if (!Number.isFinite(channelFee)) throw new Error(`channel fee not found for ${channels[0]}`);
    } else {
      const f0 = Number(macro.channel_fee_rate?.[channels[0]]);
      const f1 = Number(macro.channel_fee_rate?.[channels[1]]);
      if (!Number.isFinite(f0) || !Number.isFinite(f1)) {
        throw new Error(`channel fee not found for channels: ${channels.join(",")}`);
      }
      channelFee = 0.6 * f0 + 0.4 * f1;
    }

    const yieldBuffer = Number(pricing.yield_buffer);
    const targetGm = Number(teamState?.round2?.target_gm ?? teamState?.round1?.target_gm ?? 0.45);
    const cogsUnit = bomTotal * (1 + yieldBuffer);
    const denominator = 1 - targetGm - channelFee;
    if (denominator <= 0) throw new Error("invalid denominator: 1 - target_gm - channel_fee <= 0");
    const price = cogsUnit / denominator;

    const wtp = Number(macro.wtp_median_price);
    const elasticity = Number(macro.price_elasticity);
    const tam = Number(macro.tam);
    const a = Number(demand.adoption_function?.params?.a);

    const r = price / wtp;
    const adoptionBase = 1 / (1 + Math.exp(a * (r - 1)));
    const adoption = adoptionBase ** elasticity;

    const v2Raw = aggregateValueVector(selectedCards);
    const v2 = normalizeNonnegativeVector(v2Raw);
    const v1 = normalizeAbsVector(teamState?.round1?.value_weights || {});
    const alignment = 1 - 0.5 * VALUE_KEYS.reduce((acc, k) => acc + Math.abs(v1[k] - v2[k]), 0);
    const fit = clip(alignment, 0, 1);

    const fitLambda = Number(demand.fit_lambda);
    const units = tam * adoption * (1 + fitLambda * (fit - 0.5));

    const hwRevenue = units * price;
    const hwProfit = hwRevenue * (1 - channelFee) - units * cogsUnit;

    const subBase = getSubscriptionBaseline(macro);
    const arpu = Number(subBase.arpu_tier[subPriceTier]);
    if (!Number.isFinite(arpu)) throw new Error(`invalid sub_price_tier: ${subPriceTier}`);

    const months = Number(subModel.horizon_months ?? 24);
    const contentCost = Number((subModel.content_invest_cost || {})[contentTier]);

    const penLiftContent = Number((subModel.penetration_lifts_by_content || {})[contentTier]);
    const retLiftContent = Number((subModel.retention_lifts_by_content || {})[contentTier]);

    const comp = (subModel.compliance_effect || {})[complianceTier];
    if (!comp) throw new Error(`invalid compliance_tier: ${complianceTier}`);
    const penLiftComp = Number(comp.penetration ?? 0);
    const retLiftComp = Number(comp.retention ?? 0);

    const riskPenalty = (subModel.risk_penalty_by_risk_level || {})[String(riskLevel)] || {};
    const riskPen = Number(riskPenalty.penetration ?? 0);
    const riskRet = Number(riskPenalty.retention ?? 0);

    const cardPenLift = selectedCards.reduce((acc, c) => acc + getCardSubscriptionLift(c).penetration, 0);
    const cardRetLift = selectedCards.reduce((acc, c) => acc + getCardSubscriptionLift(c).retention, 0);

    const penetration = clip(subBase.penetration_base + penLiftContent + penLiftComp + cardPenLift + riskPen, 0, 0.8);
    const retention = clip(subBase.retention_base + retLiftContent + retLiftComp + cardRetLift + riskRet, 0.5, 0.98);

    const subs = units * penetration;
    const geom = (1 - retention ** months) / (1 - retention);
    const subRevenue24m = subs * arpu * geom;
    const subProfit24m = subRevenue24m - contentCost;

    const totalProfit = hwProfit + subProfit24m;
    const riskFlag = riskLevel >= 2 && complianceTier === "LOW" ? "HIGH_RISK" : "OK";

    return {
      cell_id: resolveCellId(cellIdInput),
      selected_cards: [...selectedIds],
      bom_total: bomTotal,
      risk_level: riskLevel,
      channel_fee: channelFee,
      cogs_unit: cogsUnit,
      price,
      price_ratio: r,
      adoption,
      fit,
      units,
      hw_revenue: hwRevenue,
      hw_profit: hwProfit,
      sub_penetration: penetration,
      sub_retention: retention,
      arpu,
      sub_revenue_24m: subRevenue24m,
      sub_profit_24m: subProfit24m,
      total_profit: totalProfit,
      risk_flag: riskFlag,
      target_gm_used: targetGm
    };
  }

  function simulate(teamState, config) {
    return simulateRound2(teamState, config);
  }

  function scoreRound1(teamState, config) {
    return computeRound1(teamState, config);
  }

  function loadConfig(configDir) {
    if (!fs || !path) {
      throw new Error("loadConfig(configDir) is only available in Node.js runtime");
    }

    const read = (name, optional) => {
      const p = path.join(configDir, name);
      if (optional && !fs.existsSync(p)) return null;
      return JSON.parse(fs.readFileSync(p, "utf8"));
    };

    return {
      lovot_baseline: read("lovot_baseline.json"),
      market_knowledge: read("market_knowledge.json"),
      round1_market_knowledge: read("round1_market_knowledge.json", true),
      feature_cards: read("feature_cards.json"),
      pricing_rules: read("pricing_rules.json"),
      demand_model: read("demand_model.json"),
      subscription_model: read("subscription_model.json"),
      scoring: read("scoring.json", true),
      round1_gm_model: read("round1_gm_model.json", true)
    };
  }

  return {
    VALUE_KEYS,
    clip,
    loadConfig,
    computeRound1V2,
    computeR1WTP,
    computeRound1,
    scoreRound1,
    evaluateRound1,
    simulate,
    simulateRound2
  };
});
