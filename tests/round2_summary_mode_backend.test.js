const test = require("node:test");
const assert = require("node:assert/strict");

const TAG_MAP = require("../data/tag_map_v2_1.json");
const Round2 = require("../server/routes/round2Routes");
const SummaryMode = require("../server/multiplayer/round2SummaryMode");
const TeamRoutes = require("../server/routes/teamRoutes");

function makeLengthSafeNarrative() {
  return "她下班回家后总会先站在玄关里听几秒屋里的安静，确认没有任何熟悉的动静后，才慢慢把包放下、开灯、开电视。电视并不是为了看，而是为了让屋里有一点人声，像是有人在旁边陪着。她会给自己倒一杯温水，坐在沙发上刷手机，来回切换几个应用，却说不清自己到底看进去了什么。工作日里她在公司总是反应快、情绪稳，开会时能连续接住很多人的问题，也习惯把场面圆回来，可一回到家，整个人像突然泄了气。周末如果没有人约，她常常一整天不说话，直到晚上嗓子都有点发哑。她并不愿意承认自己在难受，只会说最近有点累，或者说睡得不好。其实真正让她撑不住的不是某一件大事，而是那种持续很久、又说不出口的空落感。她需要的不是热闹，而是一个能在她情绪往下掉的时候，给她一点回应、让她觉得自己没有被世界彻底晾在一边的存在。".repeat(2);
}

function makeSoftOverTargetNarrative() {
  return makeLengthSafeNarrative().repeat(2);
}

function makeHardOverLimitNarrative() {
  return makeLengthSafeNarrative().repeat(3);
}

test("generatePersonaReports is idempotent for existing archetype rows", async () => {
  const archetypes = [
    {
      id: "elder_care",
      label: "独居长者照护",
      narrative_seed: {
        summary_title: "A",
        person: "P",
        routine: "R",
        scenes: ["S1"],
        pain_points: ["P1"],
        habits: ["H1"],
        emotions: ["E1"],
        confirmation_note: "待确认"
      }
    },
    {
      id: "adult_companion",
      label: "都市成人陪伴",
      narrative_seed: {
        summary_title: "B",
        person: "P",
        routine: "R",
        scenes: ["S1"],
        pain_points: ["P1"],
        habits: ["H1"],
        emotions: ["E1"],
        confirmation_note: "待确认"
      }
    }
  ];
  const existingReports = [{
    archetype_id: "elder_care",
    summary_text: "already-there",
    flow_version: "merged_v1",
    generated_at: "2026-07-06T00:00:00.000Z"
  }];
  let renderCount = 0;

  const rows = await SummaryMode.generatePersonaReports({
    archetypes,
    existingReports,
    teamName: "第1组",
    recapData: { final_grid_id: "B2C_Differentiation_Elder" },
    renderSummary: async () => {
      renderCount += 1;
      return makeLengthSafeNarrative();
    },
    now: () => "2026-07-06T12:00:00.000Z"
  });

  assert.equal(renderCount, 1);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].summary_text, "already-there");
  assert.equal(rows[1].generated_via, "llm");
  assert.equal(SummaryMode.isSummaryLengthAcceptable(rows[1].summary_text), true);
});

test("generatePersonaReports retries leakage and falls back to template when needed", async () => {
  const archetypes = [{
    id: "elder_care",
    label: "独居长者照护",
    narrative_seed: {
      summary_title: "独居长者调研报告",
      person: "72 岁独居长者",
      routine: "晚上尤其安静",
      scenes: ["半夜起身去卫生间"],
      pain_points: ["担心自己摔倒以后没人知道"],
      habits: ["习惯自己扛过去"],
      emotions: ["怕拖累家人"],
      confirmation_note: "待确认"
    }
  }];

  let attemptCount = 0;
  const fallbackEvents = [];
  const rows = await SummaryMode.generatePersonaReports({
    archetypes,
    teamName: "第1组",
    recapData: { final_grid_id: "B2C_Differentiation_Elder" },
    renderSummary: async () => {
      attemptCount += 1;
      return "她总说自己最需要情绪识别，这样家里人才能放心。";
    },
    onFallback: (event) => {
      fallbackEvents.push(event);
    },
    now: () => "2026-07-06T12:00:00.000Z"
  });

  assert.equal(attemptCount, 3);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].generated_via, "template");
  assert.equal(fallbackEvents.length, 1);
  assert.equal(fallbackEvents[0].archetypeId, "elder_care");
  assert.deepEqual(fallbackEvents[0].leakageMatches, ["情绪识别"]);
  assert.doesNotMatch(rows[0].summary_text, /模板降级版|隐藏参数|补充或校准隐藏参数/);
});

test("generatePersonaReports accepts summaries above target when they stay under hard cap", async () => {
  const archetypes = [{
    id: "adult_companion",
    label: "都市成人陪伴",
    narrative_seed: {
      summary_title: "都市成人陪伴调研报告",
      person: "31 岁独居白领",
      routine: "白天上班节奏快，回家后落差很大",
      scenes: ["深夜回家后打开电视听人声"],
      pain_points: ["周末经常整天不说话"],
      habits: ["会反复刷手机让屋里保持亮着"],
      emotions: ["空落", "不想麻烦别人"],
      confirmation_note: "待确认"
    }
  }];

  let attemptCount = 0;
  const rows = await SummaryMode.generatePersonaReports({
    archetypes,
    teamName: "第1组",
    recapData: { final_grid_id: "B2C_Differentiation_Adult" },
    renderSummary: async () => {
      attemptCount += 1;
      return makeSoftOverTargetNarrative();
    },
    now: () => "2026-07-06T12:00:00.000Z"
  });

  assert.equal(attemptCount, 1);
  assert.equal(rows[0].generated_via, "llm");
  assert.equal(SummaryMode.isSummaryLengthAcceptable(rows[0].summary_text), true);
  assert(SummaryMode.countSummaryChars(rows[0].summary_text) > 1200);
});

test("generatePersonaReports retries only when summary exceeds hard cap", async () => {
  const archetypes = [{
    id: "adult_companion",
    label: "都市成人陪伴",
    narrative_seed: {
      summary_title: "都市成人陪伴调研报告",
      person: "31 岁独居白领",
      routine: "白天上班节奏快，回家后落差很大",
      scenes: ["深夜回家后打开电视听人声"],
      pain_points: ["周末经常整天不说话"],
      habits: ["会反复刷手机让屋里保持亮着"],
      emotions: ["空落", "不想麻烦别人"],
      confirmation_note: "待确认"
    }
  }];

  let attemptCount = 0;
  const rows = await SummaryMode.generatePersonaReports({
    archetypes,
    teamName: "第1组",
    recapData: { final_grid_id: "B2C_Differentiation_Adult" },
    renderSummary: async () => {
      attemptCount += 1;
      if (attemptCount === 1) {
        return makeHardOverLimitNarrative();
      }
      return makeLengthSafeNarrative();
    },
    now: () => "2026-07-06T12:00:00.000Z"
  });

  assert.equal(attemptCount, 2);
  assert.equal(rows[0].generated_via, "llm");
  assert.equal(SummaryMode.isSummaryLengthAcceptable(rows[0].summary_text), true);
});

test("summary-mode archetype injection matches direct mapEvidenceToResult path", () => {
  const { archetypes } = SummaryMode.loadPersonaArchetypes();
  const archetype = archetypes.find((item) => item.id === "elder_care");
  assert.ok(archetype);

  const gridId = "B2C_Differentiation_Elder";
  const architecture = "Experience";
  const extracted = SummaryMode.normalizeArchetypeForScoring(archetype);
  const history = SummaryMode.buildSyntheticHistory(archetype);
  const direct = Round2.__test.mapEvidenceToResult({
    gridId,
    architecture,
    memberDims: SummaryMode.DIM_KEYS,
    extracted,
    history,
    conversation: JSON.stringify(extracted.dimension_evidence)
  });
  const viaSummaryMode = SummaryMode.buildSummaryModeRadarResult({
    archetype,
    gridId,
    architecture,
    mapEvidenceToResult: Round2.__test.mapEvidenceToResult
  });

  assert.deepEqual(viaSummaryMode.radar, direct.radar);
  assert.equal(viaSummaryMode.evi, 0.7);
  assert.equal(direct.evi > viaSummaryMode.evi, true);
  assert.deepEqual(
    viaSummaryMode.tags,
    archetype.tags.map((tag) => ({
      tag,
      polarity: 1,
      source: "persona_archetype"
    }))
  );
  assert.equal(direct.tags.some((item) => item.source === "grid_prior"), true);
});

test("summary-mode archetype tags stay inside whitelist and new tags trigger leakage blocking", () => {
  const whitelist = new Set(Object.keys(TAG_MAP.need_tag_to_dim || {}));
  const { archetypes } = SummaryMode.loadPersonaArchetypes();
  const elderCare = archetypes.find((item) => item.id === "elder_care");
  const adultCompanion = archetypes.find((item) => item.id === "adult_companion");

  assert.ok(elderCare);
  assert.ok(adultCompanion);
  assert.deepEqual(elderCare.tags, ["安全与信任", "情感陪伴", "远程关怀", "省心可靠"]);
  assert.deepEqual(adultCompanion.tags, ["情感陪伴", "个性化推荐", "隐私保护", "内容生态"]);
  assert.equal(elderCare.tags.every((tag) => whitelist.has(tag)), true);
  assert.equal(adultCompanion.tags.every((tag) => whitelist.has(tag)), true);
  assert.deepEqual(SummaryMode.findLeakageTerms("她最在意远程关怀这件事。"), ["远程关怀"]);
});

test("static summary report selection is deterministic per team and strips keyword coverage from student payload", () => {
  const pickedA = Round2.__test.selectStaticPersonaReport({
    teamId: "team_static_demo",
    gridId: "B2C_Differentiation_Elder"
  });
  const pickedB = Round2.__test.selectStaticPersonaReport({
    teamId: "team_static_demo",
    gridId: "B2C_Differentiation_Elder"
  });

  assert.equal(pickedA.persona_id, pickedB.persona_id);
  assert.ok(pickedA.report_text.includes("客户调研报告"));
  assert.ok(Array.isArray(pickedA.covered_keywords));
  assert.ok(Array.isArray(pickedA.uncovered_keywords));

  const studentPayload = Round2.__test.sanitizeStudentPersonaReport(pickedA);
  assert.equal("covered_keywords" in studentPayload, false);
  assert.equal("uncovered_keywords" in studentPayload, false);
  assert.equal(studentPayload.persona_id, pickedA.persona_id);
});

test("static summary evidence injection uses config evi and student choice sanitizer hides keyword subsets", () => {
  const evidenceRow = Round2.__test.getGridDimensionEvidenceRow("B2C_Differentiation_Elder");
  assert.ok(evidenceRow);

  const fullKeywords = Round2.__test.getGridKeywordsFull("B2C_Differentiation_Elder");
  const report = Round2.__test.getStaticPersonaReportByIndex("B2C_Differentiation_Elder", 0);
  const expectedCoverageRatio = report.covered_keywords.length / fullKeywords.length;
  const expectedEvi = Round2.__test.computeDynamicSummaryEvi(expectedCoverageRatio);

  const result = Round2.__test.buildStaticSummaryModeRadarResult({
    gridId: "B2C_Differentiation_Elder",
    architecture: "Experience",
    evidenceRow,
    mapEvidenceToResultFn: Round2.__test.mapEvidenceToResult,
    eviOverride: expectedEvi
  });

  assert.equal(evidenceRow.evi, null);
  assert.equal(result.evi, expectedEvi);
  assert.equal(result.eviMeta.raw_evi, expectedEvi);
  assert.equal(result.eviMeta.final_evi, expectedEvi);
  assert.equal(Array.isArray(result.tags), true);
  assert.equal(result.tags.length > 0, true);

  const studentChoice = Round2.__test.sanitizeStudentPersonaChoice({
    session_id: "default",
    team_id: "team_static_demo",
    grid_id: "B2C_Differentiation_Elder",
    persona_id: "ToC_Diff_Elder_P1",
    radar: result.radar,
    tags: result.tags,
    evi: result.evi,
    summary_text: "客户调研报告正文",
    flow_version: "merged_v1",
    covered_keywords: ["A"],
    uncovered_keywords: ["B"]
  });
  assert.equal("evi" in studentChoice, false);
  assert.equal("tags" in studentChoice, false);
  assert.equal("covered_keywords" in studentChoice, false);
  assert.equal("uncovered_keywords" in studentChoice, false);
  assert.equal(studentChoice.persona_id, "ToC_Diff_Elder_P1");
});

test("summary-mode dynamic coverage ratio uses viewed report union and student merged interview strips evi", () => {
  const gridId = "B2C_Differentiation_Elder";
  const fullKeywords = Round2.__test.getGridKeywordsFull(gridId);
  const reportA = Round2.__test.getStaticPersonaReportByIndex(gridId, 0);
  const reportB = Round2.__test.getStaticPersonaReportByIndex(gridId, 1);
  assert.ok(fullKeywords.length > 0);
  assert.ok(reportA);
  assert.ok(reportB);

  const viewedPersonaIds = [reportA.persona_id, reportB.persona_id];
  const union = new Set([...(reportA.covered_keywords || []), ...(reportB.covered_keywords || [])]);
  const expectedCoverageRatio = union.size / fullKeywords.length;
  const actualCoverageRatio = Round2.__test.computeCoverageRatioForViewedReports(gridId, viewedPersonaIds);
  assert.equal(actualCoverageRatio, expectedCoverageRatio);
  assert.equal(Round2.__test.computeDynamicSummaryEvi(0), 0);
  assert.equal(Round2.__test.computeDynamicSummaryEvi(1), 0.85);

  const mergedInterview = Round2.__test.buildMergedInterviewFromPersonaChoice({
    persona_id: reportA.persona_id,
    radar: { interaction: 7 },
    tags: [{ tag: "情感陪伴", polarity: 1 }],
    evi: Round2.__test.computeDynamicSummaryEvi(actualCoverageRatio),
    summary_text: reportA.report_text,
    flow_version: "merged_v1"
  });
  const studentMerged = Round2.__test.sanitizeStudentMergedInterview(mergedInterview, { stripEvi: true, stripTags: true });
  assert.equal("evi" in studentMerged, false);
  assert.equal("tags" in studentMerged, false);
});

test("team reading status payload includes per-member reading details without exposing coverage ratio", () => {
  const payload = Round2.__test.buildStudentReadingStatusPayload({
    allViewed: ["P1", "P3"],
    myViewed: ["P1"],
    totalReports: 3,
    memberId: "m1",
    members: [
      { member_id: "m1", name: "成员1", reading_status: "completed", viewed: ["P1"] },
      { member_id: "m2", name: "成员2", reading_status: "not_started", viewed: ["P1", "P3"] }
    ]
  });

  assert.equal(payload.total_reports, 3);
  assert.equal(payload.team_viewed_count, 2);
  assert.deepEqual(payload.team_viewed_personas, ["P1", "P3"]);
  assert.deepEqual(payload.my_viewed, ["P1"]);
  assert.equal(payload.my_reading_status, "completed");
  assert.equal(payload.all_completed, false);
  assert.equal(payload.members.length, 2);
  assert.deepEqual(payload.members[1].viewed, ["P1", "P3"]);
  assert.equal("coverage_ratio" in payload, false);
});

test("sanitizeStudentTeamResult strips evi and WTP-family internals from result and radar", () => {
  const sanitizedResult = Round2.__test.sanitizeStudentTeamResult({
    flow_version: "merged_v1",
    units: 1200,
    profit: 345678,
    profit_per_unit: 288,
    matched_grid: "B2C_Differentiation_Adult",
    market_size_yi: 123,
    hhi: 0.31,
    hhi_label: "中等集中",
    match_score_json: { hidden: 1 },
    result: {
      units: 1200,
      profit: 345678,
      P: 12800,
      revenueNet: 888888,
      variableCost: 222222,
      fixedCost: 333333,
      breakeven_q: 456,
      unitMargin: 789,
      dCOGS: 321,
      risk: 0.2,
      nre_total_wan: 18,
      evi: 0.85,
      WTP: 15000,
      WTPref: 14000,
      WTPref_adjusted: 14500,
      wtpPrime: 1.2,
      rawWtpMult: 1.1,
      compressedWtpMult: 1.05,
      result: {
        profit: 345678,
        V: 4.2,
        coverCore: 0.8,
        WTP: 15000
      }
    }
  });
  const serialized = JSON.stringify(sanitizedResult);
  assert.equal(serialized.includes("\"evi\""), false);
  assert.equal(serialized.includes("WTPref_adjusted"), false);
  assert.equal(serialized.includes("rawWtpMult"), false);
  assert.equal(serialized.includes("compressedWtpMult"), false);
  assert.equal(serialized.includes("\"WTP\""), false);
  assert.equal(sanitizedResult.price, 12800);
  assert.equal(sanitizedResult.result.price, 12800);
  assert.equal(sanitizedResult.result.result.coverCore, 0.8);

  const sanitizedRadar = Round2.__test.sanitizeStudentStoredRadar({
    radar: { interaction: 7, perception: 6, motion: 5, safety: 4, extend: 3, ops: 2 },
    tags: [{ tag: "情感陪伴", polarity: 1 }],
    evi: 0.7,
    updated_at: "2026-07-09T00:00:00.000Z"
  });
  assert.equal("evi" in sanitizedRadar, false);
  assert.deepEqual(sanitizedRadar.radar, { interaction: 7, perception: 6, motion: 5, safety: 4, extend: 3, ops: 2 });
});

test("hideDeferredRound1Fields strips WTPmedian before reveal while preserving safe summaries", () => {
  const hidden = TeamRoutes.hideDeferredRound1Fields({
    ok: true,
    team: { id: "team_demo", status: "phase4" },
    r1_result: {
      C: 4.1,
      G: 4.2,
      E: 4.3,
      VPscore: 4.2,
      WTPmedian: 15500,
      WTPref: 16000
    },
    vp_score: 4.2,
    vp_scores: { C: 4.1, G: 4.2, E: 4.3 },
    vp_feedback: "ok",
    vp_summary: { who: "A", pain: "B", how: "C", boundary: "D" }
  });
  const serialized = JSON.stringify(hidden);
  assert.equal(serialized.includes("WTPmedian"), false);
  assert.equal(serialized.includes("WTPref"), false);
  assert.equal(serialized.includes("VPscore"), false);
  assert.equal(serialized.includes("\"vp_score\""), false);
  assert.equal(serialized.includes("\"vp_scores\""), false);
  assert.equal(hidden.vp_feedback, "ok");
  assert.equal(hidden.team.status, "phase4");
});

test("sanitizeStudentVpConfirmationResponse keeps feedback text but strips numeric vp outputs", () => {
  const sanitized = TeamRoutes.sanitizeStudentVpConfirmationResponse({
    ok: true,
    feedback: "评语保留",
    confirmedAt: "2026-07-09T00:00:00.000Z",
    fields: {
      who_raw: "独居白领",
      pain_raw: "下班后长期孤独",
      how_raw: "通过主动陪伴降低情绪落差",
      alternative_raw: "短视频和聊天软件",
      boundary_raw: "不替代心理治疗"
    },
    session_id: "session_demo",
    scores: { C: 4.2, G: 4.1, E: 4.0, VPscore: 4.1 },
    wtp: { percentChange: 8 },
    vp_result: {
      target_customer: "独居白领",
      scenario_pain: "下班后长期孤独",
      value_creation: "通过主动陪伴降低情绪落差",
      boundary: "不替代心理治疗",
      scores: {
        C: { score: 4.2, feedback: "" },
        G: { score: 4.1, feedback: "" },
        E: { score: 4.0, feedback: "" }
      }
    }
  });
  assert.equal(sanitized.feedback, "评语保留");
  assert.equal("scores" in sanitized, false);
  assert.equal("wtp" in sanitized, false);
  assert.equal("scores" in sanitized.vp_result, false);
  assert.equal(sanitized.session_id, "session_demo");
});
