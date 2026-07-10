// server/llm/rdCalculator.js
// Round 2 R&D 计算引擎（v2 — Logit + 分布 WTP + 动态成本）
// 无状态纯函数，输入->输出，不依赖 LLM 或 embedding

const fs = require("fs");
const path = require("path");
const embeddingService = require("./embeddingService");
const { scheduleStages } = require("../multiplayer/computationLog");

const dataDir = path.join(__dirname, "../../data");
const configDir = path.join(__dirname, "../../game_config_v0.1");
const COMPAT_RULES = JSON.parse(
  fs.readFileSync(path.join(dataDir, "compatibility_rules_v2.json"), "utf8")
);
const GRID_PRIORS = JSON.parse(
  fs.readFileSync(path.join(dataDir, "grid_priors_v4_cap_weights.json"), "utf8")
);
const TAG_MAP = JSON.parse(
  fs.readFileSync(path.join(dataDir, "tag_map_v2_1.json"), "utf8")
);
const ROUND2_ENGINE_PARAMS = (() => {
  const fp = path.join(configDir, "round2_engine_params.json");
  try {
    return JSON.parse(fs.readFileSync(fp, "utf8"));
  } catch (_) {
    return {};
  }
})();

function normalizePriceScale(value) {
  const scale = Number(value);
  return Number.isFinite(scale) && scale > 0 ? scale : 1;
}

const PRICE_SCALE = normalizePriceScale(
  ROUND2_ENGINE_PARAMS.PRICE_SCALE ?? ROUND2_ENGINE_PARAMS.global?.PRICE_SCALE
);

function scaleMoneyValue(value, scale = PRICE_SCALE) {
  const num = Number(value);
  if (!Number.isFinite(num)) return value;
  return Number((num * scale).toFixed(6));
}

function scaleGlobalMoneyParams(globalParams) {
  const next = { ...(globalParams || {}) };
  ["Panchor", "V", "F", "S_monthly"].forEach((key) => {
    if (next[key] != null) next[key] = scaleMoneyValue(next[key]);
  });
  delete next.PRICE_SCALE;
  return next;
}

function scaleDefaultMoneyParams(params) {
  const next = { ...(params || {}) };
  ["cost_ref"].forEach((key) => {
    if (next[key] != null) next[key] = scaleMoneyValue(next[key]);
  });
  return next;
}

function scaleCapabilityGroups(rawGroups) {
  const cloned = JSON.parse(JSON.stringify(rawGroups || { groups: [] }));
  (cloned.groups || []).forEach((group) => {
    (group.capabilities || []).forEach((cap) => {
      if (cap.nre != null) cap.nre = scaleMoneyValue(cap.nre);
      Object.values(cap.tiers || {}).forEach((tier) => {
        if (tier && tier.dCOGS != null) tier.dCOGS = scaleMoneyValue(tier.dCOGS);
      });
    });
  });
  return cloned;
}

const RAW_CAP_GROUPS = JSON.parse(
  fs.readFileSync(path.join(dataDir, "capability_groups_v2.json"), "utf8")
);
const CAP_GROUPS = scaleCapabilityGroups(RAW_CAP_GROUPS);

const DEFAULT_ENGINE_PARAMS = {
  global: {
    Panchor: 30000,
    Nsteps: 20,
    V: 2000,
    F: 5000000,
    S_monthly: 99,
    gm_sub: 0.7,
    T: 24,
    alpha: -7.5,
    mu: 1.8889
  },
  shape: {
    cv: { ELDER: 0.35, ADULT: 0.4, CHILD: 0.38 },
    sigma_log: { ELDER: 0.5, ADULT: 0.55, CHILD: 0.5 }
  },
  percentiles: {
    ELDER: 0.97,
    ADULT: 0.97,
    CHILD: 0.97
  },
  grids: {
    ToC_ELDER: { N_DIFF: 12000000, N_COST: 24000000, Aw: 0.16, friction: 0.7, f: 0.25 },
    ToC_ADULT: { N_DIFF: 18000000, N_COST: 36000000, Aw: 0.115, friction: 0.7, f: 0.25 },
    ToC_CHILD: { N_DIFF: 13000000, N_COST: 26000000, Aw: 0.17, friction: 0.7, f: 0.25 },
    ToB_ELDER: { N_DIFF: 8000000, N_COST: 16000000, Aw: 0.22, friction: 0.65, f: 0.15 },
    ToB_ADULT: { N_DIFF: 15000000, N_COST: 30000000, Aw: 0.12, friction: 0.5, f: 0.15 },
    ToB_CHILD: { N_DIFF: 10000000, N_COST: 20000000, Aw: 0.19, friction: 0.7, f: 0.15 }
  }
};

const GLOBAL_PARAMS = {
  ...scaleGlobalMoneyParams(DEFAULT_ENGINE_PARAMS.global),
  ...scaleGlobalMoneyParams((ROUND2_ENGINE_PARAMS && ROUND2_ENGINE_PARAMS.global) || {})
};
const SHAPE_PARAMS = {
  cv: {
    ...DEFAULT_ENGINE_PARAMS.shape.cv,
    ...((((ROUND2_ENGINE_PARAMS || {}).shape || {}).cv) || {})
  },
  sigma_log: {
    ...DEFAULT_ENGINE_PARAMS.shape.sigma_log,
    ...((((ROUND2_ENGINE_PARAMS || {}).shape || {}).sigma_log) || {})
  }
};
const PERCENTILES = {
  ...DEFAULT_ENGINE_PARAMS.percentiles,
  ...((ROUND2_ENGINE_PARAMS && ROUND2_ENGINE_PARAMS.percentiles) || {})
};
const GRID_PARAMS = {
  ...DEFAULT_ENGINE_PARAMS.grids,
  ...((ROUND2_ENGINE_PARAMS && ROUND2_ENGINE_PARAMS.grids) || {})
};
const GRID_PRIORS_V3 = (() => {
  const fp = path.join(dataDir, "grid_priors_v3_with_weights.json");
  try {
    return JSON.parse(fs.readFileSync(fp, "utf8"));
  } catch (_) {
    return { grids: [] };
  }
})();

const DEFAULT_PARAMS = scaleDefaultMoneyParams({
  kappa: 1.5,
  lambda: 0.3,
  tau_core: 0.18,
  tau1: 0.16,
  tau2: 0.22,

  tier_cover_low: 0.5,
  tier_cover_mid: 0.8,
  tier_cover_high: 1.0,

  omega_core: 0.45,
  omega_nice: 0.25,
  omega_sub: 0.2,
  omega_risk: 0.15,
  omega_cost: 0.2,
  cost_ref: 8000,

  // wtpPrime uplift coefficient
  gamma: 0.3,

  alpha0: -0.5,
  beta_core: 2.0,
  beta_nice: 1.0,
  beta_sub: 0.8,
  beta_risk: 1.5,
  beta_cx: 0.3,

  penalty_budget_coeff: 1.5,
  penalty_cap_coeff: 50,
  capacity_cap: 24,
  budget_pmax_ratio: 0.2,
  rho_budget: 0,
  rho_cap: 0,

  attach0: 0.08,
  theta_core: 0.2,
  theta_nice: 0.1,
  theta_sub: 0.25,
  theta_risk: 0.2,
  S: GLOBAL_PARAMS.S_monthly,
  gm_sub: GLOBAL_PARAMS.gm_sub,
  T: GLOBAL_PARAMS.T,

  // X = wI*I + wfit*fit + wsub*sub_lift + wrisk*risk + wcx*complexity
  wI: 5.4,
  wfit: 6.0,
  wsub: 0.5,
  wrisk: -1.0,
  wcx: -0.5,

  // keep v6 fields for validate/legacy compatibility
  C0: 1000,
  lambda_p: 1.2,
  budget_multiplier: 0.13,
  slope_budget: 0.15,
  slope_cap: 0.1,
  risk_per_excess: 0.02
});

const TIER_ORDER = { low: 1, mid: 2, high: 3 };
const NRE_TIER_MULT = { low: 0.6, mid: 1.0, high: 1.6 };
const DIMS = ["感知与理解", "运动与导航", "交互与表达", "安全与信任", "可扩展与连接", "可运营与可维护"];
const DIM_KEYS = ["perception", "mobility", "interaction", "safety_privacy", "integration", "operations"];
const DIM_KEY_TO_CN = Object.fromEntries(DIM_KEYS.map((key, index) => [key, DIMS[index]]));
const DIM_CN_TO_KEY = Object.fromEntries(DIMS.map((label, index) => [label, DIM_KEYS[index]]));
const MIN_CALC_TAG_COUNT = 6;
const DIM_FALLBACK_TAGS = {
  perception: ["场景感知", "个性化推荐", "情绪识别"],
  mobility: ["自主移动", "碰撞保护", "自动充电"],
  interaction: ["语音交互", "多轮对话", "情感陪伴"],
  safety_privacy: ["安全与信任", "隐私保护", "儿童安全"],
  integration: ["智能家居", "远程控制", "OTA更新"],
  operations: ["OTA更新", "自动充电", "便携版"]
};

let embeddingReadyPromise = null;

function ensureEmbeddingReady() {
  if (!embeddingReadyPromise) {
    embeddingReadyPromise = embeddingService.init().catch((err) => {
      embeddingReadyPromise = null;
      throw err;
    });
  }
  return embeddingReadyPromise;
}

function sigmoid(x) {
  return 1 / (1 + Math.exp(-x));
}

function clip(x, lo, hi) {
  return Math.max(lo, Math.min(hi, x));
}

function roundForLog(value, digits = 6) {
  const num = Number(value);
  if (!Number.isFinite(num)) return 0;
  return Number(num.toFixed(digits));
}

function cloneForLog(value, fallback = null) {
  try {
    return JSON.parse(JSON.stringify(value == null ? fallback : value));
  } catch (_) {
    return fallback;
  }
}

function getComputationContext(input) {
  const src = input && typeof input === "object" ? input : {};
  const teamId = String(src.teamId || src.team_id || "").trim();
  const sessionId = String(src.sessionId || src.session_id || "").trim();
  if (!teamId || !sessionId) return null;
  const memberId = String(src.memberId || src.member_id || "").trim();
  return {
    team_id: teamId,
    session_id: sessionId,
    member_id: memberId || null,
    source: String(src.source || "web").trim() || "web"
  };
}

function normalizeChannel(value) {
  const raw = String(value || "").trim().toUpperCase();
  if (!raw) return null;
  if (raw === "TOB" || raw === "B2B") return "ToB";
  if (raw === "TOC" || raw === "B2C") return "ToC";
  return null;
}

function normalizeStrategy(value) {
  const raw = String(value || "").trim().toUpperCase();
  if (!raw) return null;
  if (raw.includes("DIFF") || raw.includes("DIFFERENTIATION")) return "DIFF";
  if (raw.includes("COST")) return "COST";
  return null;
}

function normalizeAge(value) {
  const raw = String(value || "").trim().toUpperCase();
  if (!raw) return null;
  if (raw.includes("ELDER") || raw.includes("OLD") || raw.includes("SENIOR")) return "ELDER";
  if (raw.includes("CHILD") || raw.includes("KID")) return "CHILD";
  if (raw.includes("ADULT")) return "ADULT";
  return null;
}

function parseGridId(gridId) {
  const raw = String(gridId || "").trim();
  const parts = raw.split("_").filter(Boolean);
  if (parts.length < 3) throw new Error(`invalid gridId: ${gridId}`);
  const c0 = String(parts[0] || "").toUpperCase();
  const s0 = String(parts[1] || "").toUpperCase();
  const a0 = String(parts[2] || "").toUpperCase();

  const channel = normalizeChannel(c0) || "ToC";
  const strategy = normalizeStrategy(s0) || "COST";
  const age = normalizeAge(a0) || "ADULT";
  const ageExplicit = normalizeAge(a0) !== null;
  return { channel, strategy, age, ageExplicit };
}

function resolveWtpGrid(gridId, context = {}) {
  const base = parseGridId(gridId);
  if (base.ageExplicit) {
    return {
      gridId: `${base.channel}_${base.strategy}_${base.age}`,
      channel: base.channel,
      strategy: base.strategy,
      age: base.age,
      source: "gridId"
    };
  }

  const ctx = context && typeof context === "object" ? context : {};
  const round1GridId = String(
    ctx.round1GridId ||
    ctx.round1_grid_id ||
    ((ctx.round1Context || {}).gridId) ||
    ((ctx.round1Context || {}).grid_id) ||
    ""
  ).trim();
  if (round1GridId) {
    const parsedRound1 = parseGridId(round1GridId);
    if (!parsedRound1.ageExplicit) {
      throw new Error(`Round 1 gridId missing explicit age: ${round1GridId}`);
    }
    return {
      gridId: `${parsedRound1.channel}_${parsedRound1.strategy}_${parsedRound1.age}`,
      channel: parsedRound1.channel,
      strategy: parsedRound1.strategy,
      age: parsedRound1.age,
      source: "round1GridId"
    };
  }

  const round1Context = ctx.round1Context && typeof ctx.round1Context === "object"
    ? ctx.round1Context
    : {};
  const channel = normalizeChannel(
    round1Context.channel ||
    round1Context.customerType ||
    round1Context.customer_type
  ) || base.channel;
  const strategy = normalizeStrategy(round1Context.strategy) || base.strategy;
  const age = normalizeAge(
    round1Context.age ||
    round1Context.ageGroup ||
    round1Context.age_group ||
    ctx.round1Age ||
    ctx.round1_age ||
    ctx.age
  );
  if (age) {
    return {
      gridId: `${channel}_${strategy}_${age}`,
      channel,
      strategy,
      age,
      source: "round1Context"
    };
  }

  if (ctx.requireRound1Age) {
    throw new Error(`Round 2 WTP context missing Round 1 age for gridId: ${gridId}`);
  }

  return {
    gridId: `${base.channel}_${base.strategy}_${base.age}`,
    channel: base.channel,
    strategy: base.strategy,
    age: base.age,
    source: "fallback_gridId"
  };
}

function normalInverseCDF(p) {
  const a = [-3.969683028665376e+01, 2.209460984245205e+02,
    -2.759285104469687e+02, 1.383577518672690e+02,
    -3.066479806614716e+01, 2.506628277459239e+00];
  const b = [-5.447609879822406e+01, 1.615858368580409e+02,
    -1.556989798598866e+02, 6.680131188771972e+01,
    -1.328068155288572e+01];
  const c = [-7.784894002430293e-03, -3.223964580411365e-01,
    -2.400758277161838e+00, -2.549732539343734e+00,
    4.374664141464968e+00, 2.938163982698783e+00];
  const d = [7.784695709041462e-03, 3.224671290700398e-01,
    2.445134137142996e+00, 3.754408661907416e+00];

  const pLow = 0.02425;
  const pHigh = 1 - pLow;
  let q;
  let r;

  if (p < pLow) {
    q = Math.sqrt(-2 * Math.log(p));
    return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
      ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  if (p <= pHigh) {
    q = p - 0.5;
    r = q * q;
    return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q /
      (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
  }
  q = Math.sqrt(-2 * Math.log(1 - p));
  return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
    ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
}

function computeBucketMean(strategy, distParams) {
  const steps = Math.max(1, Number(GLOBAL_PARAMS.Nsteps || 20));
  let sum = 0;
  for (let k = 1; k <= steps; k += 1) {
    const p = Math.min(k / steps, 0.9999);
    const z = normalInverseCDF(p);
    let bucketPrice = 0;
    if (strategy === "DIFF") {
      bucketPrice = Number(distParams.mu || 0) + Number(distParams.sigma || 0) * z;
    } else {
      bucketPrice = Math.exp(Number(distParams.mu_log || 0) + Number(distParams.sigma_log || 0) * z);
    }
    sum += Math.max(bucketPrice, 0);
  }
  return sum / steps;
}

function computeGammaRaw(strategy, age) {
  if (strategy === "DIFF") {
    const cv = Number(SHAPE_PARAMS.cv[age]);
    if (!Number.isFinite(cv) || cv <= 0) throw new Error(`Unknown age for cv: ${age}`);
    return { gamma: 4 / (cv * Math.sqrt(2 * Math.PI)), shapeParamKey: "cv", shapeParamValue: cv };
  }
  const sigmaLog = Number(SHAPE_PARAMS.sigma_log[age]);
  if (!Number.isFinite(sigmaLog) || sigmaLog <= 0) throw new Error(`Unknown age for sigma_log: ${age}`);
  return { gamma: 4 / (sigmaLog * Math.sqrt(2 * Math.PI)), shapeParamKey: "sigma_log", shapeParamValue: sigmaLog };
}

function computeWTPParams(gridId, context = {}) {
  const resolved = resolveWtpGrid(gridId, context);
  const { channel, strategy, age } = resolved;
  const Panchor = Number(GLOBAL_PARAMS.Panchor || 30000);
  const ps = clip(Number(PERCENTILES[age] || 0.97), 1e-6, 1 - 1e-6);
  const z_ps = normalInverseCDF(ps);

  let WTPmean;
  let WTPmedian;
  let WTPref;
  let distParams;
  const gammaConfig = computeGammaRaw(strategy, age);

  if (strategy === "DIFF") {
    const cv = Number(SHAPE_PARAMS.cv[age] || 0.4);
    const mu = Panchor / (1 + cv * z_ps);
    const sigma = cv * mu;
    WTPmean = mu;
    WTPmedian = mu;
    distParams = { mu, sigma };
  } else {
    const sigma_log = Number(SHAPE_PARAMS.sigma_log[age] || 0.55);
    const mu_log = Math.log(Panchor) - sigma_log * z_ps;
    WTPmean = Math.exp(mu_log + (sigma_log * sigma_log) / 2);
    WTPmedian = Math.exp(mu_log);
    distParams = { mu_log, sigma_log };
  }

  if (channel === "ToB") {
    const WTPmeanB = computeBucketMean(strategy, distParams);
    WTPmean = WTPmeanB;
    WTPref = WTPmeanB;
  } else {
    WTPref = WTPmedian;
  }

  return {
    WTPmean,
    WTPmedian,
    WTPref,
    gamma: gammaConfig.gamma,
    channel,
    strategy,
    age,
    shapeParamKey: gammaConfig.shapeParamKey,
    shapeParamValue: gammaConfig.shapeParamValue,
    sourceGridId: resolved.gridId,
    source: resolved.source
  };
}

function compressWtpMult(rawMult) {
  const compressed = 0.75 + (0.4 * (Number(rawMult || 0) - 0.6)) / 0.6;
  return Math.max(0.7, Math.min(1.2, compressed));
}

function getChannelFee(gridId) {
  const { channel, age } = parseGridId(gridId);
  const key = `${channel}_${age}`;
  const cfg = GRID_PARAMS[key];
  if (!cfg) throw new Error(`grid params missing for ${key}`);
  return Number(cfg.f);
}

function calculateVolume(price, gridId, X, wtpParams, Vscore = 0) {
  const { channel, strategy, age } = parseGridId(gridId);
  const channelAge = `${channel}_${age}`;
  const gridConfig = GRID_PARAMS[channelAge];
  if (!gridConfig) throw new Error(`grid params missing for ${channelAge}`);

  const N = strategy === "DIFF" ? Number(gridConfig.N_DIFF) : Number(gridConfig.N_COST);
  const Meff = N * Number(gridConfig.Aw || 0) * Number(gridConfig.friction || 0);
  const alpha = Number(GLOBAL_PARAMS.alpha || -9.0);
  const gammaRaw = Number(wtpParams.gamma || 0);
  const mu = Number(GLOBAL_PARAMS.mu || 1.8889);
  const gammaEff = strategy === "DIFF"
    ? gammaRaw / (1 + mu * Math.max(0, Number(Vscore || 0)))
    : gammaRaw;
  const WTPref = Math.max(1, Number(wtpParams.WTPref || 1));
  const z = alpha + Number(X || 0) - gammaEff * (Number(price || 0) / WTPref);
  const shareRate = sigmoid(z);
  const Q = Meff * shareRate;

  return { Q, Meff, shareRate, z, gammaRaw, gammaEff };
}

function calculateCOGSbase(Q) {
  const V = Number(GLOBAL_PARAMS.V || 0);
  console.log("[rdCalculator] V =", V);
  return V;
}

function computeValueScore(coverCore, coverNice, subLift, risk, positiveDCOGS, cogsAnchor, params = DEFAULT_PARAMS) {
  const costRef = Number(params.cost_ref);
  if (!Number.isFinite(costRef) || costRef <= 0) {
    throw new Error("params.cost_ref is required for computeValueScore");
  }
  const costRatio = Number(positiveDCOGS || 0) / costRef;
  const raw = params.omega_core * coverCore +
    params.omega_nice * coverNice +
    params.omega_sub * subLift -
    params.omega_risk * risk -
    params.omega_cost * costRatio;
  return clip(raw, 0, 1);
}

function computeAdoption(P, wtpPrime, e, params = DEFAULT_PARAMS) {
  const denom = Math.max(1, Number(wtpPrime || 1));
  const ratio = Number(P || 0) / denom;
  const shaped = 1 / (1 + Math.exp(3 * (ratio - 1)));
  return Math.pow(shaped, Math.max(0.1, Number(e || 1)));
}

function computeCompetitiveShare(coverCore, coverNice, subLift, risk, complexity, params = DEFAULT_PARAMS) {
  const Z = params.alpha0 +
    params.beta_core * coverCore +
    params.beta_nice * coverNice +
    params.beta_sub * subLift -
    params.beta_risk * risk -
    params.beta_cx * complexity;
  return 1 / (1 + Math.exp(-Z));
}

function computePenaltyAndReliability(dCOGS, load, budgetBenchmark, params = DEFAULT_PARAMS) {
  const overBudget = Math.max(0, Number(dCOGS || 0) - Number(budgetBenchmark || 0));
  const overCap = Math.max(0, Number(load || 0) - Number(params.capacity_cap || 24));

  const penalty = Number(params.penalty_budget_coeff || 0) * overBudget +
    Number(params.penalty_cap_coeff || 0) * overCap;

  const R = Math.exp(
    -Number(params.rho_budget || 0) * overBudget / Math.max(Number(budgetBenchmark || 0), 1) -
    Number(params.rho_cap || 0) * overCap / Math.max(Number(params.capacity_cap || 24), 1)
  );

  return { penalty, R, overBudget, overCap };
}

function findCapability(capId) {
  for (const group of CAP_GROUPS.groups || []) {
    const cap = (group.capabilities || []).find((item) => getCapId(item) === capId);
    if (cap) {
      return cap;
    }
  }
  return null;
}

function resolveTierNreWan(capId, tier) {
  const cap = findCapability(capId);
  const baseNre = Number(cap?.nre || 0);
  const tierMult = Number(NRE_TIER_MULT[tier] || 1);
  return roundForLog(baseNre * tierMult, 6);
}

function calculateProfit(price, gridId, X, dCOGS, coverCore, coverNice, subLift, risk, wtpParams, penalty = 0, Vscore = 0, totalNREWan = 0) {
  const volume = calculateVolume(price, gridId, X, wtpParams, Vscore);
  const qRaw = Math.max(0, Number(volume.Q || 0));
  const qUnits = Math.round(qRaw);
  const f = getChannelFee(gridId);

  const COGSbaseRaw = calculateCOGSbase(qRaw);
  const COGSbase = Number.isFinite(COGSbaseRaw) ? COGSbaseRaw : Number.MAX_SAFE_INTEGER;
  const COGS = COGSbase + Number(dCOGS || 0);
  const FBase = Number(GLOBAL_PARAMS.F || 0);
  const FTotal = FBase + Number(totalNREWan || 0) * 10000;

  const netRevenuePerUnit = Number(price || 0) * (1 - f);
  const revenueNetRaw = qRaw * netRevenuePerUnit;
  const variableCostRaw = qRaw * COGS;
  const profitHWRaw = revenueNetRaw - variableCostRaw;

  const attach = clip(
    Number(DEFAULT_PARAMS.attach0 || 0) +
    Number(DEFAULT_PARAMS.theta_core || 0) * Number(coverCore || 0) +
    Number(DEFAULT_PARAMS.theta_nice || 0) * Number(coverNice || 0) +
    Number(DEFAULT_PARAMS.theta_sub || 0) * Number(subLift || 0) -
    Number(DEFAULT_PARAMS.theta_risk || 0) * Number(risk || 0),
    0,
    0.9
  );
  const LTV_sub = attach * Number(GLOBAL_PARAMS.S_monthly || 0) * Number(GLOBAL_PARAMS.gm_sub || 0) * Number(GLOBAL_PARAMS.T || 0);
  const profitSubRaw = qRaw * LTV_sub;
  const unitMargin = netRevenuePerUnit - COGS;
  const totalProfitRaw = profitHWRaw + profitSubRaw - Number(penalty || 0) - FTotal;
  const breakevenQ = unitMargin > 0 ? Math.ceil(FTotal / unitMargin) : null;

  return {
    Q: qUnits,
    Meff: volume.Meff,
    shareRate: volume.shareRate,
    z: volume.z,
    f,
    COGSbase,
    COGS,
    dCOGS: Number(dCOGS || 0),
    profitHW: profitHWRaw,
    attach,
    LTV_sub,
    profitSub: profitSubRaw,
    totalProfit: totalProfitRaw,
    revenueNet: revenueNetRaw,
    variableCost: variableCostRaw,
    F_base: FBase,
    F_total: FTotal,
    nre_total_wan: Number(totalNREWan || 0),
    f_total_wan: FTotal / 10000,
    unitMargin,
    breakeven_q: breakevenQ,
    price: Number(price || 0),
    WTPref: wtpParams.WTPref,
    gammaRaw: volume.gammaRaw,
    gammaEff: volume.gammaEff
  };
}

function normalizeMatchCardScores(cardScores) {
  const src = cardScores && typeof cardScores === "object" ? cardScores : {};
  return {
    perception: Number(src.perception ?? src["感知与理解"] ?? 0),
    mobility: Number(src.mobility ?? src.motion ?? src["运动与导航"] ?? 0),
    interaction: Number(src.interaction ?? src["交互与表达"] ?? 0),
    safety_privacy: Number(src.safety_privacy ?? src.safety ?? src["安全与信任"] ?? 0),
    integration: Number(src.integration ?? src.extend ?? src["可扩展与连接"] ?? 0),
    operations: Number(src.operations ?? src.ops ?? src["可运营与可维护"] ?? 0)
  };
}

function normalizeMatchWeights(weights) {
  const src = weights && typeof weights === "object" ? weights : {};
  const normalized = {};
  for (const key of DIM_KEYS) {
    normalized[key] = Number(src[key] ?? src[DIM_KEY_TO_CN[key]] ?? 0);
  }
  return normalized;
}

function computeProductMarketMatch(cardScores, gridPriors = GRID_PRIORS) {
  const allMatches = {};
  let bestGrid = null;
  let bestMatch = -Infinity;
  const normalizedScores = normalizeMatchCardScores(cardScores);

  const priors = Array.isArray(gridPriors?.grids) ? gridPriors.grids : [];
  for (const g of priors) {
    const gridId = g.id;
    if (!gridId) continue;
    const weights = normalizeMatchWeights(g.weights || g.radar_weight_prior || {});
    let match = 0;
    for (const key of DIM_KEYS) {
      match += Number(weights[key] || 0) * Number(normalizedScores[key] || 0);
    }
    allMatches[gridId] = roundForLog(match);
    if (match > bestMatch) {
      bestMatch = match;
      bestGrid = gridId;
    }
  }

  return {
    bestGrid,
    bestMatch: roundForLog(bestMatch),
    allMatches
  };
}

function validatePrecomputedWtpPriors() {
  const entries = Array.isArray(GRID_PRIORS_V3?.grids) ? GRID_PRIORS_V3.grids : [];
  for (const g of entries) {
    const id = String(g.id || "");
    const m = id.match(/^(B2C|B2B)_(Differentiation|Cost)_(Experience|Mixed|Function)$/i);
    if (!m) continue;
    const pre = g.v2_engine;
    if (!pre) continue;
    const channel = m[1].toUpperCase() === "B2C" ? "ToC" : "ToB";
    const strategy = m[2].toLowerCase().includes("differ") ? "DIFF" : "COST";
    const byAge = pre.by_age && typeof pre.by_age === "object" ? pre.by_age : { ADULT: pre };
    for (const age of Object.keys(byAge)) {
      try {
        const calc = computeWTPParams(`${channel}_${strategy}_${age}`);
        const expected = byAge[age] || {};
        const expectedWtp = Number(expected.WTPmean || 0) * PRICE_SCALE;
        const expectedGamma = Number(expected.gamma || 0);
        const deltaWtp = expectedWtp > 0 ? Math.abs(calc.WTPmean - expectedWtp) / expectedWtp : 0;
        const deltaGamma = expectedGamma > 0 ? Math.abs(calc.gamma - expectedGamma) / expectedGamma : 0;
        if (deltaWtp > 0.02 || deltaGamma > 0.02) {
          console.warn(`[rdCalculator] v2_engine mismatch: ${id}/${age}, WTPmean delta=${(deltaWtp * 100).toFixed(2)}%, gamma delta=${(deltaGamma * 100).toFixed(2)}%`);
        }
      } catch (_) {}
    }
  }
}

validatePrecomputedWtpPriors();

function getGridPrior(gridId) {
  const grid = (GRID_PRIORS.grids || []).find((g) => g.id === gridId);
  if (!grid) throw new Error(`找不到 grid: ${gridId}`);
  return grid;
}

function normalizeTagList(tags, limit = 8) {
  const result = [];
  const seen = new Set();
  for (const item of Array.isArray(tags) ? tags : []) {
    const tag = String((typeof item === "string" ? item : item?.tag) || "").trim();
    if (!tag || seen.has(tag) || !(TAG_MAP.need_tag_to_dim || {})[tag]) continue;
    seen.add(tag);
    result.push(tag);
    if (result.length >= limit) break;
  }
  return result;
}

function getGridPriorTags(gridId) {
  const grid = getGridPrior(gridId);
  return normalizeTagList([
    ...(grid.recommended_core_tags || []),
    ...(grid.recommended_nice_tags || [])
  ]);
}

function inferRadarFallbackTags(radarScores, currentTags = [], limit = 8) {
  const result = normalizeTagList(currentTags, limit);
  const seen = new Set(result);
  const sortedDims = DIM_KEYS
    .slice()
    .sort((a, b) => Number(radarScores?.[b] || 0) - Number(radarScores?.[a] || 0));
  for (const dimKey of sortedDims) {
    for (const tag of DIM_FALLBACK_TAGS[dimKey] || []) {
      if (result.length >= limit) return result;
      if (seen.has(tag)) continue;
      seen.add(tag);
      result.push(tag);
    }
  }
  return result;
}

function ensureSufficientTags(tags, gridId, radarScores) {
  const result = normalizeTagList(tags);
  if (result.length >= MIN_CALC_TAG_COUNT) return result;

  const seen = new Set(result);
  for (const tag of getGridPriorTags(gridId)) {
    if (result.length >= MIN_CALC_TAG_COUNT) break;
    if (seen.has(tag)) continue;
    seen.add(tag);
    result.push(tag);
  }

  if (result.length >= MIN_CALC_TAG_COUNT) return result;

  const radarFallback = inferRadarFallbackTags(radarScores, result);
  for (const tag of radarFallback) {
    if (result.length >= MIN_CALC_TAG_COUNT) break;
    if (seen.has(tag)) continue;
    seen.add(tag);
    result.push(tag);
  }

  return result.slice(0, 8);
}

async function getTagDim(tag) {
  const exact = (TAG_MAP.need_tag_to_dim || {})[tag];
  if (exact) return exact;

  if (!String(tag || "").trim()) return null;

  try {
    await ensureEmbeddingReady();
    const tagVec = await embeddingService.embed(tag);
    const dimensions = embeddingService.getDimensions();
    let bestMatch = { similarity: -Infinity, dimension: null };

    for (const dim of dimensions) {
      const similarity = embeddingService.maxCosineToDimension(tagVec, dim.key);
      if (similarity > bestMatch.similarity) {
        bestMatch = {
          similarity,
          dimension: DIM_KEY_TO_CN[dim.key] || null
        };
      }
    }

    if (bestMatch.dimension && bestMatch.similarity > 0.75) {
      return bestMatch.dimension;
    }
  } catch (_) {
    return null;
  }

  return null;
}

function normalizeSelections(input) {
  if (Array.isArray(input.selections)) return input.selections;
  if (Array.isArray(input.selectedCards)) {
    return input.selectedCards.map((cap_id) => ({ cap_id, tier: "mid" }));
  }
  return [];
}

function getGroupId(group) {
  return group.group_id || group.id;
}

function getCapId(cap) {
  return cap.cap_id || cap.id;
}

function getCapabilityParams(cap_id, tier) {
  for (const group of CAP_GROUPS.groups || []) {
    const caps = group.capabilities || [];
    const cap = caps.find((c) => getCapId(c) === cap_id);
    if (!cap) continue;

    const tierData = (cap.tiers || {})[tier];
    if (!tierData) throw new Error(`tier ${tier} not found for ${cap_id}`);

    return {
      group_id: getGroupId(group),
      dCOGS: Number(tierData.dCOGS || 0),
      nre: Number(cap.nre || 0),
      nre_tier: resolveTierNreWan(getCapId(cap), tier),
      nre_desc: String(cap.nre_desc || ""),
      risk: Number(tierData.risk || 0),
      sub_lift: Number(tierData.sub_lift || 0),
      load: Number(tierData.load || 1),
      covers: tierData.covers || cap.covers || [],
      requires: tierData.requires || [],
      excludes: tierData.excludes || [],
      cap_name: cap.name || cap_id
    };
  }
  throw new Error(`capability ${cap_id} not found`);
}

function validateSelections(selections) {
  const selList = Array.isArray(selections) ? selections : [];
  const violations = [];

  const validSelections = [];
  for (const sel of selList) {
    try {
      const params = getCapabilityParams(sel.cap_id, sel.tier);
      validSelections.push({ ...sel, params });
    } catch (err) {
      violations.push({
        type: "invalid_selection",
        source: `${sel?.cap_id || "unknown"}@${sel?.tier || "unknown"}`,
        message: err.message
      });
    }
  }

  const groupCounts = {};
  for (const sel of validSelections) {
    const gid = sel.params.group_id;
    groupCounts[gid] = (groupCounts[gid] || 0) + 1;
  }

  for (const group of CAP_GROUPS.groups || []) {
    const gid = getGroupId(group);
    const count = groupCounts[gid] || 0;
    const minSelect = Number(group.min_select || COMPAT_RULES.selection_constraints?.per_group_min || 1);
    if (count < minSelect) {
      violations.push({
        type: "group_min",
        group: gid,
        message: `${group.name} 至少选 ${minSelect} 张`
      });
    }
  }

  const totalMin = Number(COMPAT_RULES.selection_constraints?.total_min || 6);
  if (selList.length < totalMin) {
    violations.push({ type: "total_min", message: `总数 ${selList.length} < ${totalMin}` });
  }

  const selectedTierByCap = new Map();
  for (const sel of validSelections) {
    selectedTierByCap.set(sel.cap_id, sel.tier);
  }

  const pairDedup = new Set();

  for (const sel of validSelections) {
    for (const req of sel.params.requires || []) {
      if (typeof req === "string") {
        if (!selectedTierByCap.has(req)) {
          violations.push({
            type: "requires",
            source: `${sel.cap_id}@${sel.tier}`,
            target: req,
            message: `${sel.cap_id}(${sel.tier}) 需要 ${req}`
          });
        }
        continue;
      }

      if (req && req.type && req.type !== "hard") continue;
      const reqCap = req?.cap;
      if (!reqCap) continue;
      const minTier = req.min_tier || "low";
      const actualTier = selectedTierByCap.get(reqCap);
      const met = actualTier && TIER_ORDER[actualTier] >= TIER_ORDER[minTier];
      if (!met) {
        violations.push({
          type: "requires",
          source: `${sel.cap_id}@${sel.tier}`,
          target: reqCap,
          message: `${sel.cap_id}(${sel.tier}) 需要 ${reqCap}${minTier ? ` >= ${minTier}` : ""}`
        });
      }
    }

    for (const exc of sel.params.excludes || []) {
      if (typeof exc === "string") {
        if (selectedTierByCap.has(exc)) {
          const key = `${sel.cap_id}|${exc}`;
          if (!pairDedup.has(key)) {
            pairDedup.add(key);
            violations.push({
              type: "excludes",
              source: sel.cap_id,
              target: exc,
              message: `${sel.cap_id} 与 ${exc} 冲突`
            });
          }
        }
        continue;
      }

      if (exc && exc.type && exc.type !== "hard") continue;
      const excCap = exc?.cap;
      if (!excCap) continue;

      const targetTier = selectedTierByCap.get(excCap);
      if (!targetTier) continue;

      let conflict = false;
      if (exc.any_tier) {
        conflict = true;
      } else if (Array.isArray(exc.tier_in) && exc.tier_in.length > 0) {
        conflict = exc.tier_in.includes(targetTier);
      } else {
        conflict = true;
      }

      if (conflict) {
        const key = `${sel.cap_id}|${excCap}|${targetTier}`;
        if (!pairDedup.has(key)) {
          pairDedup.add(key);
          violations.push({
            type: "excludes",
            source: sel.cap_id,
            target: excCap,
            message: `${sel.cap_id} 与 ${excCap} 冲突`
          });
        }
      }
    }
  }

  return {
    valid: violations.length === 0,
    violations,
    hardViolationCount: violations.length
  };
}

function computeSoftPenalties(selections, COGSbase, params = DEFAULT_PARAMS) {
  const selList = Array.isArray(selections) ? selections : [];

  let totalPositiveDCOGS = 0;
  let totalLoad = 0;
  for (const sel of selList) {
    const p = getCapabilityParams(sel.cap_id, sel.tier);
    if (p.dCOGS > 0) totalPositiveDCOGS += p.dCOGS;
    totalLoad += p.load;
  }

  const budgetCap = Number(COGSbase || 0) * Number(params.budget_multiplier || 0);
  const overBudgetAmount = Math.max(0, totalPositiveDCOGS - budgetCap);
  const overBudget = overBudgetAmount > 0;
  const budgetDen = budgetCap > 0 ? budgetCap : 1;
  const z_penalty_budget = overBudget
    ? -Number(params.slope_budget || 0) * (overBudgetAmount / budgetDen)
    : 0;

  const capacityCap = Number(params.capacity_cap || 24);
  const overCapacityAmount = Math.max(0, totalLoad - capacityCap);
  const overCapacity = overCapacityAmount > 0;
  const capDen = capacityCap > 0 ? capacityCap : 1;
  const z_penalty_cap = overCapacity
    ? -Number(params.slope_cap || 0) * (overCapacityAmount / capDen)
    : 0;

  const risk_add = Number(params.risk_per_excess || 0) * overCapacityAmount;

  const details = [];
  if (overBudget) {
    details.push({
      rule: "S1_budget",
      positiveDCOGS: totalPositiveDCOGS,
      budgetCap,
      over: overBudgetAmount,
      z_penalty: z_penalty_budget
    });
  }
  if (overCapacity) {
    details.push({
      rule: "S2_capacity",
      totalLoad,
      capacityCap,
      over: overCapacityAmount,
      z_penalty: z_penalty_cap,
      risk_add
    });
  }

  return {
    budget: {
      budgetCap,
      positiveDCOGS: totalPositiveDCOGS,
      overBudget,
      overBudgetAmount
    },
    capacity: {
      capacityCap,
      totalLoad,
      overCapacity,
      overCapacityAmount
    },
    z_penalty: z_penalty_budget + z_penalty_cap,
    risk_add,
    details
  };
}

async function computeEvi({ tags, scores }) {
  let evi = 0.7;

  if (!tags || tags.length < 6) evi -= 0.1;
  if (!tags || tags.length < 3) evi -= 0.1;

  if (tags && scores) {
    const dimCount = {};
    const resolvedDims = await Promise.all((tags || []).map(async (t) => {
      const tag = typeof t === "string" ? t : t.tag;
      return getTagDim(tag);
    }));
    for (const dim of resolvedDims) {
      if (dim) dimCount[dim] = (dimCount[dim] || 0) + 1;
    }
    const totalTags = Object.values(dimCount).reduce((a, b) => a + b, 0);
    if (totalTags > 0) {
      const dimKeys = Object.keys(scores || {});
      const topDim = dimKeys.reduce((a, b) => (Number(scores[a] || 0) > Number(scores[b] || 0) ? a : b), dimKeys[0]);
      const dimKeyMap = {
        perception: "感知与理解",
        mobility: "运动与导航",
        interaction: "交互与表达",
        safety_privacy: "安全与信任",
        integration: "可扩展与连接",
        operations: "可运营与可维护"
      };
      const topDimCN = dimKeyMap[topDim];
      if (topDimCN && !dimCount[topDimCN]) evi -= 0.1;
    }
  }

  return clip(evi, 0.3, 0.9);
}

async function calculate(input, overrideParams = DEFAULT_PARAMS) {
  const params = { ...DEFAULT_PARAMS, ...(input.params || {}), ...(overrideParams || {}) };
  const computationContext = getComputationContext(input);
  const gridId = String(input.gridId || "").trim();
  const selections = normalizeSelections(input);
  const rawTags = Array.isArray(input.tags) ? input.tags : [];

  if (!gridId) throw new Error("gridId required");
  if (!Array.isArray(selections) || selections.length === 0) throw new Error("selections required");

  const radarInput = input.radarScores || input.radar || {};
  const radarScores = {
    perception: Number(radarInput.perception || 5),
    mobility: Number(radarInput.mobility != null ? radarInput.mobility : radarInput.motion != null ? radarInput.motion : 5),
    interaction: Number(radarInput.interaction || 5),
    safety_privacy: Number(radarInput.safety_privacy != null ? radarInput.safety_privacy : radarInput.safety != null ? radarInput.safety : 5),
    integration: Number(radarInput.integration != null ? radarInput.integration : radarInput.extend != null ? radarInput.extend : 5),
    operations: Number(radarInput.operations != null ? radarInput.operations : radarInput.ops != null ? radarInput.ops : 5)
  };
  const tags = ensureSufficientTags(rawTags, gridId, radarScores);

  const baseWtpParams = computeWTPParams(gridId, { ...input, requireRound1Age: true });
  const hasWtpRefOverride = input && input.WTPref_override != null && Number.isFinite(Number(input.WTPref_override));
  const baseWtpRef = hasWtpRefOverride
    ? Number(input.WTPref_override)
    : Number(baseWtpParams.WTPref || 0);
  const hasWtpMultiplier = input && input.wtp_multiplier != null;
  const rawWtpMult = hasWtpMultiplier ? Number(input.wtp_multiplier || 1) : 1;
  const compressedMult = hasWtpMultiplier ? compressWtpMult(rawWtpMult) : 1;
  const wtpParams = hasWtpMultiplier || hasWtpRefOverride
    ? {
        ...baseWtpParams,
        WTPmean: Number(baseWtpParams.WTPmean || 0) * compressedMult,
        WTPmedian: Number(baseWtpParams.WTPmedian || 0) * compressedMult,
        WTPref: baseWtpRef * compressedMult
      }
    : baseWtpParams;
  console.log("[rdCalculator] WTPref 来源:", {
    gridId,
    source: hasWtpRefOverride ? "input.WTPref_override" : `computeWTPParams(${baseWtpParams.sourceGridId})`,
    wtpSource: baseWtpParams.source,
    baseWTPref: baseWtpRef,
    rawWtpMult,
    compressedWtpMult: compressedMult,
    adjustedWTPref: Number(wtpParams.WTPref || 0)
  });
  const WTP = Number(input.WTP != null ? input.WTP : wtpParams.WTPmedian);
  const e = Number(input.e != null ? input.e : 1.2);
  const P = Number(input.P != null ? input.P : Math.round(wtpParams.WTPref * 0.85));
  const Pmax = Number(input.Pmax != null ? input.Pmax : wtpParams.WTPref);
  const cogsAnchor = Number(input.COGSbase != null ? input.COGSbase : GLOBAL_PARAMS.V);

  const validation = validateSelections(selections);
  const legacySoft = computeSoftPenalties(selections, cogsAnchor, params);

  // ===== Steps 1-6 (v6 pipeline retained) =====
  const sd = {};
  for (const key of DIM_KEYS) sd[key] = clip((Number(radarScores[key] || 5) || 5) / 10, 0, 1);

  const w_interview_raw = {};
  for (const key of DIM_KEYS) w_interview_raw[key] = Math.pow(sd[key], params.kappa);
  const w_interview_sum = Object.values(w_interview_raw).reduce((a, b) => a + b, 0);
  const w_interview = {};
  for (const key of DIM_KEYS) w_interview[key] = w_interview_sum > 0 ? w_interview_raw[key] / w_interview_sum : 1 / DIM_KEYS.length;

  const grid = getGridPrior(gridId);
  const w_grid_cn = grid.radar_weight_prior || {};
  const w_grid = {};
  for (const key of DIM_KEYS) w_grid[key] = Number(w_grid_cn[DIM_KEY_TO_CN[key]] || 1 / 6);

  await ensureEmbeddingReady().catch(() => null);
  const evi = typeof input.evi === "number" ? clip(input.evi, 0, 1) : await computeEvi({ tags, scores: radarScores });
  const w_star = {};
  for (const key of DIM_KEYS) {
    w_star[key] = (1 - params.lambda * evi) * w_grid[key] + params.lambda * evi * w_interview[key];
  }
  const weightFusionLog = {
    evi: roundForLog(evi),
    lambda: roundForLog(params.lambda),
    w_grid: cloneForLog(w_grid, {}),
    w_interview: cloneForLog(w_interview, {}),
    w_star: cloneForLog(w_star, {})
  };

  let sev = 0;
  for (const key of DIM_KEYS) sev += w_star[key] * sd[key];

  const tagList = tags.map((t) => (typeof t === "string" ? t : t.tag));
  const tagObjects = await Promise.all(tagList.map(async (tag) => {
    const dimCN = getTagDim(tag);
    const resolvedDimCN = await dimCN;
    const dimKey = resolvedDimCN ? DIM_CN_TO_KEY[resolvedDimCN] : null;
    const w = dimKey ? w_star[dimKey] : 0;
    const tier = w >= params.tau_core ? "core" : "nice";
    const imp = clip(1 + (w >= params.tau1 ? 1 : 0) + (w >= params.tau2 ? 1 : 0), 1, 3);
    return { tag, dimCN: resolvedDimCN, dimKey, w, tier, imp };
  }));
  let coreTags = tagObjects.filter((t) => t.tier === "core");
  let niceTags = tagObjects.filter((t) => t.tier === "nice");
  const distinctTagDims = new Set(tagObjects.map((item) => String(item.dimKey || item.dimCN || "").trim()).filter(Boolean));
  const minCoreDims = Math.min(2, distinctTagDims.size);
  const coreDims = new Set(coreTags.map((item) => String(item.dimKey || item.dimCN || "").trim()).filter(Boolean));
  if (coreDims.size < minCoreDims && tagObjects.length > 0) {
    const sortedTags = tagObjects
      .slice()
      .sort((a, b) => Number(b.w || 0) - Number(a.w || 0));
    const topDimensions = new Set(coreDims);
    sortedTags.forEach((item) => {
      if (topDimensions.size >= minCoreDims) return;
      const dim = String(item.dimKey || item.dimCN || "").trim();
      if (!dim) return;
      topDimensions.add(dim);
    });
    if (topDimensions.size >= minCoreDims) {
      tagObjects.forEach((item) => {
        const dim = String(item.dimKey || item.dimCN || "").trim();
        item.tier = topDimensions.has(dim) ? "core" : "nice";
      });
      coreTags = tagObjects.filter((t) => t.tier === "core");
      niceTags = tagObjects.filter((t) => t.tier === "nice");
      console.log("[tag_layering] core_tags coverage was narrow, forced top dims:", Array.from(topDimensions));
    }
  }
  const tagLayeringLog = {
    tags: tagObjects.map((item) => ({
      tag: item.tag,
      dimCN: item.dimCN,
      dimKey: item.dimKey,
      w: roundForLog(item.w),
      tier: item.tier,
      imp: item.imp
    })),
    core_tags: coreTags.map((item) => item.tag),
    nice_tags: niceTags.map((item) => item.tag),
    tau_core: roundForLog(params.tau_core),
    tau1: roundForLog(params.tau1),
    tau2: roundForLog(params.tau2)
  };

  // ===== Step 7: selection aggregation =====
  let dCOGS = 0;
  let totalNREWan = 0;
  let riskSum = 0;
  let subLift = 0;
  let load = 0;
  let positiveDCOGS = 0;
  const allCovers = new Map();
  const selectionDetails = [];
  for (const sel of selections) {
    const p = getCapabilityParams(sel.cap_id, sel.tier);
    const coverVal = Number(
      sel.tier === "low" ? params.tier_cover_low
        : sel.tier === "high" ? params.tier_cover_high
        : params.tier_cover_mid
    ) || 0.8;
    dCOGS += p.dCOGS;
    totalNREWan += p.nre_tier;
    riskSum += p.risk;
    subLift += p.sub_lift;
    load += p.load;
    positiveDCOGS += Math.max(0, p.dCOGS);
    (p.covers || []).forEach((t) => {
      allCovers.set(t, Math.max(Number(allCovers.get(t) || 0), coverVal));
    });
    selectionDetails.push({
      cap_id: sel.cap_id,
      tier: sel.tier,
      dCOGS: Number(p.dCOGS || 0),
      nre: Number(p.nre_tier || 0),
      risk: Number(p.risk || 0),
      sub_lift: Number(p.sub_lift || 0),
      load: Number(p.load || 0),
      covers: cloneForLog(p.covers || [], [])
    });
  }
  const risk = Math.max(0, riskSum);
  const complexity = cogsAnchor > 0 ? positiveDCOGS / cogsAnchor : 0;

  function isCovered(tag) {
    return Number(allCovers.get(tag) || 0);
  }

  const coverCoreDen = coreTags.reduce((acc, t) => acc + t.imp, 0);
  const coverCoreNum = coreTags.reduce((acc, t) => acc + t.imp * isCovered(t.tag), 0);
  const coverNiceDen = niceTags.reduce((acc, t) => acc + t.imp, 0);
  const coverNiceNum = niceTags.reduce((acc, t) => acc + t.imp * isCovered(t.tag), 0);
  const coverCore = coverCoreDen > 0 ? coverCoreNum / coverCoreDen : 0;
  const coverNice = coverNiceDen > 0 ? coverNiceNum / coverNiceDen : 0;
  const coveredTags = tagObjects
    .map((item) => ({ tag: item.tag, covered: roundForLog(isCovered(item.tag)) }))
    .filter((item) => item.covered > 0);
  console.log(
    "[coverCore] team:",
    computationContext?.team_id || null,
    "core_tags:",
    coreTags.map((item) => item.tag),
    "covered:",
    coveredTags
  );
  const cardSelectionLog = {
    selections: selectionDetails,
    total_dCOGS: Number(dCOGS || 0),
    total_NRE_wan: Number(totalNREWan || 0),
    total_risk: roundForLog(risk),
    total_subLift: roundForLog(subLift),
    total_load: roundForLog(load),
    budget_utilization: cogsAnchor > 0 ? roundForLog(positiveDCOGS / cogsAnchor) : 0
  };
  const coverageLog = {
    core_tags_total: coreTags.length,
    core_tags_covered: roundForLog(coreTags.reduce((acc, item) => acc + isCovered(item.tag), 0)),
    coverCore: roundForLog(coverCore),
    nice_tags_total: niceTags.length,
    nice_tags_covered: roundForLog(niceTags.reduce((acc, item) => acc + isCovered(item.tag), 0)),
    coverNice: roundForLog(coverNice),
    tag_breakdown: tagObjects.map((item) => ({
      tag: item.tag,
      tier: item.tier,
      covered: roundForLog(isCovered(item.tag))
    }))
  };

  // ===== v2 core =====
  const I = evi * (0.5 * sev + 0.35 * coverCore + 0.1 * coverNice);
  const fit = clip(0.7 * coverCore + 0.3 * coverNice, 0, 1);
  const X = params.wI * I + params.wfit * fit + params.wsub * subLift + params.wrisk * risk + params.wcx * complexity;
  const V = computeValueScore(coverCore, coverNice, subLift, risk, positiveDCOGS, cogsAnchor, params);
  const productScoresLog = {
    I: roundForLog(I),
    sev: roundForLog(sev),
    fit: roundForLog(fit),
    Vscore: roundForLog(V),
    X: roundForLog(X),
    wI: roundForLog(params.wI),
    wfit: roundForLog(params.wfit),
    wsub: roundForLog(params.wsub),
    wrisk: roundForLog(params.wrisk),
    wcx: roundForLog(params.wcx),
    sub_lift: roundForLog(subLift),
    risk: roundForLog(risk),
    complexity: roundForLog(complexity)
  };
  const wtpPrime = Number(wtpParams.WTPref || 0) * (1 + Number(params.gamma || 0) * V);
  const volume = calculateVolume(P, gridId, X, wtpParams, V);
  const adoption = volume.shareRate;
  const S_competitive = 1;
  const budgetBenchmark = Number(Pmax || 0) * Number(params.budget_pmax_ratio || 0);
  const { penalty, R, overBudget, overCap } = computePenaltyAndReliability(dCOGS, load, budgetBenchmark, params);
  const profitResult = calculateProfit(P, gridId, X, dCOGS, coverCore, coverNice, subLift, risk, wtpParams, penalty, V, totalNREWan);
  const share = volume.shareRate * R;
  const units = profitResult.Q;
  const COGS_final = profitResult.COGS;
  const unitProfitHW = P * (1 - profitResult.f) - COGS_final;
  const profitHW = profitResult.profitHW;
  const ltvSub = profitResult.LTV_sub;
  const profitSub = profitResult.profitSub;
  const profit = profitResult.totalProfit;
  const attach = profitResult.attach;
  const rdInvestment = units * Math.max(0, dCOGS);
  const roi = rdInvestment > 0 ? profit / rdInvestment : null;
  const actualGm = P > 0 ? 1 - profitResult.f - COGS_final / P : 0;
  const { channel, strategy, age } = parseGridId(gridId);
  const gridConfig = GRID_PARAMS[`${channel}_${age}`] || {};
  const marketSize = strategy === "DIFF"
    ? Number(gridConfig.N_DIFF || 0)
    : Number(gridConfig.N_COST || 0);
  const volumeLog = {
    gridId,
    round1_gridId: String(wtpParams.sourceGridId || ""),
    age: String(wtpParams.age || ""),
    strategy: String(wtpParams.strategy || ""),
    P: Number(P || 0),
    WTPref_adjusted: roundForLog(wtpParams.WTPref),
    compressed_mult: roundForLog(compressedMult),
    Meff: roundForLog(volume.Meff),
    N: marketSize,
    Aw: roundForLog(gridConfig.Aw || 0),
    friction: roundForLog(gridConfig.friction || 0),
    alpha: roundForLog(GLOBAL_PARAMS.alpha || 0),
    X: roundForLog(X),
    cv_or_sigma_log: roundForLog(wtpParams.shapeParamValue || 0),
    gamma_raw: roundForLog(volume.gammaRaw),
    gamma_eff: roundForLog(volume.gammaEff),
    mu: roundForLog(GLOBAL_PARAMS.mu || 0),
    Vscore: roundForLog(V),
    z: roundForLog(volume.z),
    sigmoid_z: roundForLog(volume.shareRate),
    Q: roundForLog(volume.Q),
    share: roundForLog(volume.shareRate)
  };
  const profitLog = {
    P: Number(P || 0),
    f: roundForLog(profitResult.f),
    V: roundForLog(profitResult.COGSbase),
    dCOGS: Number(dCOGS || 0),
    unit_cost: roundForLog(profitResult.COGS),
    net_revenue_per_unit: roundForLog(P * (1 - profitResult.f)),
    unit_margin: roundForLog(profitResult.unitMargin),
    F_base: roundForLog(profitResult.F_base),
    NRE_total: roundForLog(totalNREWan * 10000),
    F_total: roundForLog(profitResult.F_total),
    Q: roundForLog(profitResult.Q),
    profit_hw: roundForLog(profitResult.profitHW),
    attach: roundForLog(profitResult.attach),
    S: roundForLog(GLOBAL_PARAMS.S_monthly || 0),
    gm_sub: roundForLog(GLOBAL_PARAMS.gm_sub || 0),
    T: roundForLog(GLOBAL_PARAMS.T || 0),
    LTV_sub: roundForLog(profitResult.LTV_sub),
    profit_sub: roundForLog(profitResult.profitSub),
    total_profit: roundForLog(profitResult.totalProfit),
    BEQ: profitResult.breakeven_q,
    actual_gm: roundForLog(actualGm)
  };
  if (computationContext) {
    scheduleStages(computationContext, [
      { stage: "r2_weight_fusion", params: weightFusionLog },
      { stage: "r2_tag_layering", params: tagLayeringLog },
      { stage: "r2_card_selection", params: cardSelectionLog },
      { stage: "r2_coverage", params: coverageLog },
      { stage: "r2_product_scores", params: productScoresLog },
      { stage: "r2_volume", params: volumeLog },
      { stage: "r2_profit", params: profitLog }
    ]);
  }

  return {
    roi,
    profit: Math.round(profit),
    units,

    adoption,
    S_competitive,
    R,
    share,

    P,
    WTP,
    e,
    wtpPrime,
    WTPref: wtpParams.WTPref,
    rawWtpMult,
    compressedWtpMult: compressedMult,
    WTPref_adjusted: wtpParams.WTPref,
    gamma: volume.gammaEff,
    gammaRaw: volume.gammaRaw,
    gammaEff: volume.gammaEff,
    z: volume.z,
    Meff: volume.Meff,
    X,
    I,
    fit,
    actualGm,

    V,
    dCOGS,
    nre_total_wan: totalNREWan,
    f_total: Math.round(profitResult.F_total),
    f_total_wan: Number(profitResult.f_total_wan || 0),
    breakeven_q: profitResult.breakeven_q,
    unitMargin: Math.round(profitResult.unitMargin),
    revenueNet: Math.round(profitResult.revenueNet),
    variableCost: Math.round(profitResult.variableCost),
    fixedCost: Math.round(profitResult.F_total),
    fBase: Math.round(profitResult.F_base),
    positiveDCOGS,
    risk,
    subLift,
    load,
    complexity,
    coverCore,
    coverNice,

    penalty: Math.round(penalty),
    overBudget,
    overCap,
    budgetBenchmark,

    unitProfitHW,
    profitHW: Math.round(profitHW),
    profitSub: Math.round(profitSub),
    attach,
    ltvSub: Math.round(ltvSub),
    rdInvestment: Math.round(rdInvestment),

    violations: validation.violations,
    hardViolationCount: validation.hardViolationCount,

    evi,
    w_star,
    sev,
    tagBreakdown: tagObjects,
    COGSbase: Math.round(profitResult.COGSbase),
    COGS: Math.round(COGS_final)
  };
}

module.exports = {
  calculate,
  computeEvi,
  computeValueScore,
  computeAdoption,
  computeCompetitiveShare,
  computePenaltyAndReliability,
  calculateVolume,
  calculateCOGSbase,
  calculateProfit,
  computeWTPParams,
  compressWtpMult,
  computeBucketMean,
  parseGridId,
  normalInverseCDF,
  computeProductMarketMatch,
  validateSelections,
  computeSoftPenalties,
  findCapability,
  resolveTierNreWan,
  getCapabilityParams,
  getCapTierParams: getCapabilityParams,
  CAP_GROUPS,
  PRICE_SCALE,
  GLOBAL_PARAMS,
  SHAPE_PARAMS,
  PERCENTILES,
  GRID_PARAMS,
  DEFAULT_PARAMS,
  TIER_ORDER,
  NRE_TIER_MULT
};
