const test = require("node:test");
const assert = require("node:assert/strict");

const Round2 = require("../server/routes/round2Routes");
const SummaryMode = require("../server/multiplayer/round2SummaryMode");

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
      return "这是一段只描述真实生活节奏和情绪起伏的客户叙事，没有出现任何能力名或解决方案词。";
    },
    now: () => "2026-07-06T12:00:00.000Z"
  });

  assert.equal(renderCount, 1);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].summary_text, "already-there");
  assert.equal(rows[1].generated_via, "llm");
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
  const rows = await SummaryMode.generatePersonaReports({
    archetypes,
    teamName: "第1组",
    recapData: { final_grid_id: "B2C_Differentiation_Elder" },
    renderSummary: async () => {
      attemptCount += 1;
      return "她总说自己最需要情绪识别，这样家里人才能放心。";
    },
    now: () => "2026-07-06T12:00:00.000Z"
  });

  assert.equal(attemptCount, 3);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].generated_via, "template");
  assert.match(rows[0].summary_text, /模板降级版/);
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
  assert.deepEqual(viaSummaryMode.tags, direct.tags);
  assert.equal(viaSummaryMode.evi, direct.evi);
});
