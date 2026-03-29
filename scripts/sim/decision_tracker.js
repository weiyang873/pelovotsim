"use strict";

function safeNumber(value, fallback = null) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function cloneJson(value, fallback = null) {
  if (value == null) return fallback;
  try {
    return JSON.parse(JSON.stringify(value));
  } catch (_) {
    return fallback;
  }
}

function extractScores(scores) {
  if (!scores || typeof scores !== "object") return null;
  const source = scores.coverage != null
    ? { C: scores.coverage, G: scores.generalizability, E: scores.effectiveness }
    : scores;
  const C = safeNumber(source.C);
  const G = safeNumber(source.G);
  const E = safeNumber(source.E);
  if (C == null && G == null && E == null) return null;
  return { C, G, E };
}

function scoreProduct(scores) {
  const s = extractScores(scores);
  if (!s || s.C == null || s.G == null || s.E == null) return null;
  const avgGE = (s.G + s.E) / 2;
  return Math.min(5, Math.round(Math.sqrt(s.C * avgGE) * 10) / 10);
}

class DecisionTracker {
  constructor(teamIndex, teamSize) {
    this.teamId = null;
    this.teamIndex = Number(teamIndex || 0);
    this.teamSize = Number(teamSize || 0);
    this.members = {};
    this.vpBestLocked = false;
    this.team = {
      finalGrid: null,
      finalArch: null,
      vpIterations: [],
      vpChatLogs: [],
      r1_wtp_ref: null,
      r1_wtp_adj: null,
      r1_wtp_mult_compressed: null,
      r1_sam_billion: null,
      r1_rho_c: null,
      r1_wtp_multiplier: null,
      target_gm: null,
      market_space_tier: null,
      vp_score_c: null,
      vp_score_g: null,
      vp_score_e: null,
      vp_who_specificity: null,
      vp_pain_has_trigger: null,
      vp_how_has_mechanism: null,
      vp_coach_turns_total: 0,
      vp_total_iterations: 0,
      vp_initial_score: null,
      vp_final_score: null,
      vp_best_score: null,
      vp_best_iteration: null,
      vp_used_best: false,
      vp_improvement: null,
      r2_teamSelections: [],
      r2_team_card_count: 0,
      r2_total_dCOGS: null,
      r2_total_NRE: null,
      r2_budget_utilization: null,
      r2_high_tier_count: 0,
      r2_violation_count: 0,
      r2_finalPrice: null,
      r2_price_vs_wtp: null,
      r2_coverCore: null,
      r2_coverNice: null,
      r2_share: null,
      r2_units: null,
      r2_revenue: null,
      r2_finalCalcResult: null,
      r2_gross_margin: null,
      r2_profit_hw: null,
      r2_profit_sub: null,
      r2_profit: null,
      r2_is_profitable: null,
      jinang_tech_discount_total: 0
    };
  }

  setTeamId(teamId) {
    this.teamId = teamId || null;
  }

  initMember(memberId, memberIndex, student) {
    const s = student || {};
    this.members[memberId] = {
      memberId,
      memberIndex,
      persona: s.personaId || s.id || null,
      personaLabel: s.label || null,
      name: s.name || null,
      gender: s.gender || null,
      mbti: s.mbti || null,
      age: safeNumber(s.age),
      education: s.education || null,
      hasOverseas: s.overseas?.hasOverseas === true,
      role: s.role || null,
      industry: s.industry || null,
      seed_memory_json: null,
      classroom_profile_json: null,
      jinang_market: null,
      jinang_tech: null,
      r1_grid_id: null,
      r1_architecture: null,
      r1_who: null,
      r1_pain: null,
      r1_how: null,
      r1_personal_wtp_adj: null,
      jinang_market_match: null,
      jinang_tech_match: null,
      r2_assigned_dims: [],
      r2_interview_turns: 0,
      r2_interview_summary: null,
      r2_radar_scores: null,
      r2_evi: null,
      r2_evidence_count: null,
      r2_strong_dim_count: null,
      r2_missing_dim_count: null,
      interview_persona_id: null,
      interview_persona_name: null,
      interviewLog: [],
      r2_personal_selections: [],
      r2_high_tier_count: 0,
      jinang_tech_applied: []
    };
  }

  getMember(memberId) {
    return this.members[memberId] || null;
  }

  recordJinang(memberId, jinang) {
    const member = this.getMember(memberId);
    if (!member) return;
    member.jinang_market = cloneJson(jinang?.market, null);
    member.jinang_tech = cloneJson(jinang?.tech, null);
  }

  recordPhase1Choice(memberId, choice, response) {
    const member = this.getMember(memberId);
    if (!member) return;
    member.r1_grid_id = choice?.grid_id || null;
    member.r1_architecture = choice?.architecture || null;
    member.r1_who = choice?.who || null;
    member.r1_pain = choice?.pain || null;
    member.r1_how = choice?.how || null;
    member.r1_personal_wtp_adj = safeNumber(response?.personal_gm_max);
  }

  recordVpScoreFeatures(features, apiScores) {
    this.team.vp_score_c = safeNumber(apiScores?.coverage ?? apiScores?.C);
    this.team.vp_score_g = safeNumber(apiScores?.generalizability ?? apiScores?.G);
    this.team.vp_score_e = safeNumber(apiScores?.effectiveness ?? apiScores?.E);
    this.team.vp_who_specificity = safeNumber(features?.has_clear_customer, null);
    this.team.vp_pain_has_trigger = safeNumber(features?.has_scenario, null);
    this.team.vp_how_has_mechanism = safeNumber(features?.has_mechanism, null);
  }

  pushVpIteration(entry) {
    const item = {
      iteration: safeNumber(entry?.iteration, this.team.vpIterations.length),
      timestamp: entry?.timestamp || new Date().toISOString(),
      trigger: entry?.trigger || "unknown",
      speaker: cloneJson(entry?.speaker, null),
      vp_text: cloneJson(entry?.vp_text, null),
      scores: extractScores(entry?.scores),
      coach_reply: entry?.coach_reply || null,
      speaker_reply: entry?.speaker_reply || null,
      changes: cloneJson(entry?.changes, null),
      used_best_iteration: entry?.used_best_iteration === true,
      best_iteration: entry?.best_iteration || null,
      best_score: safeNumber(entry?.best_score)
    };
    this.team.vpIterations.push(item);
    this.refreshVpStats();
  }

  getBestVpIteration() {
    let best = null;
    for (const item of this.team.vpIterations) {
      const product = scoreProduct(item?.scores);
      if (product == null) continue;
      if (!best || product >= best.score) {
        best = {
          iteration: safeNumber(item?.iteration),
          trigger: item?.trigger || null,
          score: product,
          vp_text: item?.vp_text || "",
          scores: extractScores(item?.scores)
        };
      }
    }
    return best;
  }

  setVpBestSelection(usedBest, bestIteration = null, bestScore = null) {
    this.vpBestLocked = true;
    this.team.vp_used_best = usedBest === true;
    this.team.vp_best_iteration = bestIteration || this.team.vp_best_iteration;
    this.team.vp_best_score = safeNumber(bestScore, this.team.vp_best_score);
    this.refreshVpStats();
  }

  pushVpChatLog(entry) {
    const item = {
      round_number: safeNumber(entry?.round_number),
      coach_message: String(entry?.coach_message || "").trim() || null,
      speaker_persona: entry?.speaker_persona || null,
      speaker_name: entry?.speaker_name || null,
      speaker_reply: String(entry?.speaker_reply || "").trim() || null,
      lead_writer_persona: entry?.lead_writer_persona || null,
      lead_writer_name: entry?.lead_writer_name || null,
      vp_before: String(entry?.vp_before || "").trim() || null,
      vp_after: String(entry?.vp_after || "").trim() || null,
      score_product_before: safeNumber(entry?.score_product_before),
      score_product_after: safeNumber(entry?.score_product_after),
      score_C: safeNumber(entry?.score_C),
      score_G: safeNumber(entry?.score_G),
      score_E: safeNumber(entry?.score_E)
    };
    this.team.vpChatLogs.push(item);
  }

  refreshVpStats() {
    this.team.vp_total_iterations = this.team.vpIterations.length;
    const initial = this.team.vpIterations.length > 0 ? scoreProduct(this.team.vpIterations[0].scores) : null;
    const finalIteration = this.team.vpIterations.length > 0
      ? this.team.vpIterations[this.team.vpIterations.length - 1]
      : null;
    const finalScore = finalIteration ? scoreProduct(finalIteration.scores) : null;
    const best = this.getBestVpIteration();
    this.team.vp_initial_score = initial;
    if (!this.vpBestLocked) {
      this.team.vp_best_score = best?.score ?? null;
      this.team.vp_best_iteration = best?.trigger ?? null;
    }
    this.team.vp_final_score = finalScore ?? this.team.vp_final_score;
    if (this.team.vp_initial_score && this.team.vp_final_score) {
      this.team.vp_improvement = Number((((this.team.vp_final_score - this.team.vp_initial_score) / this.team.vp_initial_score) * 100).toFixed(2));
    }
  }

  recordPhase4(data) {
    const result = data?.r1_result || {};
    const breakdown = data?.wtp_breakdown || {};
    const scores = data?.vp_scores || {};
    const summary = data?.vp_summary || {};
    this.team.finalGrid = data?.team?.final_grid_id || this.team.finalGrid;
    this.team.finalArch = data?.team?.final_architecture || this.team.finalArch;
    this.team.r1_wtp_ref = safeNumber(result.WTPref);
    this.team.r1_wtp_adj = safeNumber(result.WTPadj);
    this.team.r1_wtp_mult_compressed = safeNumber(result.wtp_mult_compressed);
    this.team.r1_sam_billion = safeNumber(result.SAM_billion);
    this.team.r1_rho_c = safeNumber(result.rho_C);
    this.team.r1_wtp_multiplier = safeNumber(result.wtp_multiplier);
    this.team.target_gm = safeNumber(result.WTPadj);
    this.team.market_space_tier = breakdown?.market_jinang_match_strength != null
      ? String(breakdown.market_jinang_match_strength)
      : this.team.market_space_tier;
    if (!this.team.vp_used_best) {
      this.team.vp_score_c = safeNumber(scores.C, this.team.vp_score_c);
      this.team.vp_score_g = safeNumber(scores.G, this.team.vp_score_g);
      this.team.vp_score_e = safeNumber(scores.E, this.team.vp_score_e);
    }

    if (summary && this.team.vpIterations.length > 0) {
      const last = this.team.vpIterations[this.team.vpIterations.length - 1];
      const finalText = data?.team?.final_vp_text || "";
      if (!this.team.vp_used_best && String(finalText || "").trim()) {
        last.vp_text = String(finalText).trim();
      }
      if (!this.team.vp_used_best) {
        last.scores = { C: this.team.vp_score_c, G: this.team.vp_score_g, E: this.team.vp_score_e };
      }
      this.refreshVpStats();
    }

    const settlements = Array.isArray(data?.settle?.settlements) ? data.settle.settlements : [];
    for (const settlement of settlements) {
      const member = this.getMember(settlement.member_id);
      if (!member) continue;
      if (settlement.jinang_type === "market") {
        member.jinang_market_match = safeNumber(settlement.match_strength);
      }
      if (settlement.jinang_type === "tech") {
        member.jinang_tech_match = safeNumber(settlement.match_strength);
        member.jinang_tech_effect = cloneJson(settlement.effect_applied, null);
      }
    }
  }

  recordAssignments(assignments) {
    for (const assignment of assignments || []) {
      const member = this.getMember(assignment.memberId);
      if (!member) continue;
      member.r2_assigned_dims = Array.isArray(assignment.dims) ? [...assignment.dims] : [];
    }
  }

  recordInterview(memberId, history, endData, meta = {}) {
    const member = this.getMember(memberId);
    if (!member) return;
    const radar = endData?.radar || {};
    const dims = Array.isArray(member.r2_assigned_dims) ? member.r2_assigned_dims : [];
    const readRadar = (dim) => safeNumber(
      radar[dim]
      ?? radar[dim === "motion" ? "mobility" : dim]
      ?? radar[dim === "safety" ? "safety_privacy" : dim]
      ?? radar[dim === "extend" ? "integration" : dim]
      ?? radar[dim === "ops" ? "operations" : dim]
    );
    const strongCount = dims.filter((dim) => (readRadar(dim) || 0) >= 7).length;
    const missingCount = dims.filter((dim) => (readRadar(dim) || 0) < 5.5).length;

    member.r2_interview_turns = (Array.isArray(history) ? history : []).filter((item) => item.role === "user").length;
    member.r2_interview_summary = Array.isArray(endData?.tags)
      ? endData.tags.map((item) => typeof item === "string" ? item : item?.tag).filter(Boolean).join(" | ")
      : null;
    member.interview_persona_id = String(meta?.interview_persona_id || meta?.persona_id || "").trim() || null;
    member.interview_persona_name = String(meta?.interview_persona_name || meta?.persona_name || "").trim() || null;
    member.interviewLog = (Array.isArray(history) ? history : []).map((item, index) => ({
      turn_number: Math.floor(index / 2) + 1,
      role: item?.role === "user" ? "student" : "interviewee",
      message_text: String(item?.content || "").trim(),
      interview_persona_id: member.interview_persona_id,
      interview_persona_name: member.interview_persona_name
    })).filter((item) => item.message_text);
    member.r2_radar_scores = {
      perception: readRadar("perception"),
      motion: readRadar("motion"),
      interaction: readRadar("interaction"),
      safety: readRadar("safety"),
      extend: readRadar("extend"),
      ops: readRadar("ops")
    };
    member.r2_evi = safeNumber(endData?.evi);
    member.r2_evidence_count = Array.isArray(endData?.tags) ? endData.tags.length : 0;
    member.r2_strong_dim_count = strongCount;
    member.r2_missing_dim_count = missingCount;
  }

  recordPersonalSelections(memberId, selections) {
    const member = this.getMember(memberId);
    if (!member) return;
    member.r2_personal_selections = cloneJson(selections, []);
    member.r2_high_tier_count = (selections || []).filter((item) => item?.tier === "high").length;
  }

  recordMerge(mergeData, budgetBenchmark) {
    const selections = Array.isArray(mergeData?.teamSelections) ? mergeData.teamSelections : [];
    this.team.r2_teamSelections = cloneJson(selections, []);
    this.team.r2_team_card_count = selections.length;
    this.team.r2_high_tier_count = selections.filter((item) => item?.tier === "high").length;
    this.team.r2_violation_count =
      (Array.isArray(mergeData?.mergeViolations) ? mergeData.mergeViolations.length : 0) +
      (Array.isArray(mergeData?.violations) ? mergeData.violations.length : 0) +
      safeNumber(mergeData?.hardViolationCount, 0);
    if (budgetBenchmark != null && this.team.r2_total_dCOGS != null) {
      this.team.r2_budget_utilization = Number((this.team.r2_total_dCOGS / Math.max(1, budgetBenchmark)).toFixed(4));
    }
  }

  recordPrice(price, priceVsWtp) {
    this.team.r2_finalPrice = safeNumber(price);
    this.team.r2_price_vs_wtp = safeNumber(priceVsWtp);
  }

  recordFinalResult(previewData, teamResultData) {
    const source = teamResultData?.result?.result || teamResultData?.result || previewData || {};
    this.team.r2_total_dCOGS = safeNumber(source.dCOGS, this.team.r2_total_dCOGS);
    this.team.r2_total_NRE = safeNumber(source.nre_total_wan, this.team.r2_total_NRE);
    if (source.budgetBenchmark != null && source.dCOGS != null) {
      this.team.r2_budget_utilization = Number((Number(source.dCOGS) / Math.max(1, Number(source.budgetBenchmark))).toFixed(4));
    }
    this.team.r2_coverCore = safeNumber(source.coverCore ?? previewData?.coverCore, this.team.r2_coverCore);
    this.team.r2_coverNice = safeNumber(source.coverNice ?? previewData?.coverNice, this.team.r2_coverNice);
    this.team.r2_share = safeNumber(source.share ?? teamResultData?.result?.share);
    this.team.r2_units = safeNumber(source.units ?? teamResultData?.result?.units);
    this.team.r2_revenue = safeNumber(source.revenueNet);
    this.team.r2_gross_margin = safeNumber(source.actualGm);
    this.team.r2_profit_hw = safeNumber(source.profitHW);
    this.team.r2_profit_sub = safeNumber(source.profitSub);
    this.team.r2_profit = safeNumber(source.profit ?? teamResultData?.result?.profit);
    this.team.r2_is_profitable = this.team.r2_profit != null ? this.team.r2_profit > 0 : null;
    this.team.r2_finalCalcResult = cloneJson(teamResultData?.result?.result || previewData, null);
  }
}

module.exports = {
  DecisionTracker,
  scoreProduct
};
