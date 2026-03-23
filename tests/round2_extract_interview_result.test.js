const assert = require("node:assert/strict");
const { __test } = require("../server/routes/round2Routes");

function testPromptSchemaHasNoNumericAnchors() {
  const messages = __test.buildExtractInterviewMessages({
    gridId: "ToC_Differentiation_Adult",
    memberDims: ["motion", "extend", "ops"],
    conversation: [
      "学生：下班回家最烦什么？",
      "用户：最烦摸黑开灯、开空调，还得自己烧水。"
    ].join("\n")
  });
  const systemPrompt = String(messages[0]?.content || "");
  const userPrompt = String(messages[1]?.content || "");

  assert.ok(systemPrompt.includes("不要给 6 个维度直接打分"));
  assert.ok(userPrompt.includes("\"brief\": \"\""));
  assert.equal(userPrompt.includes("\"dim_scores\""), false);
  assert.equal(userPrompt.includes("\"evi\""), false);
  assert.equal(/6\.5|6\.2|7\.1|0\.72|0\.85/.test(userPrompt), false);
}

function testPayloadCleanerRemovesReplacementChars() {
  const cleaned = __test.cleanExtractedPayload({
    dimension_evidence: {
      perception: {
        evidence: [
          {
            quote: "主���满足",
            reason: "环���状态"
          }
        ],
        needs: ["被看���"],
        scenarios: ["回家���刻"],
        pain_points: ["安静���黑"]
      }
    }
  });

  const serialized = JSON.stringify(cleaned);
  assert.equal(serialized.includes("�"), false);
  assert.ok(serialized.includes("主满足"));
}

function testFocusedDimsFallbackToWeakEvidence() {
  const history = [
    { role: "user", text: "您回家后最烦什么？" },
    { role: "assistant", speaker: "用户", text: "最烦的是灯没关、空调没关，还得自己烧水。" },
    { role: "user", text: "还有别的吗？" },
    { role: "assistant", speaker: "用户", text: "上周感冒半夜想喝水，还得自己摸黑去厨房倒。" },
    { role: "user", text: "这种时候最希望什么？" },
    { role: "assistant", speaker: "用户", text: "希望有人能帮我递水，别让我再起身折腾。" }
  ];
  const conversation = history
    .map((item) => `${item.role === "user" ? "学生" : item.speaker || "用户"}：${item.text}`)
    .join("\n");

  const result = __test.mapEvidenceToResult({
    gridId: "ToC_Differentiation_Adult",
    memberDims: ["motion", "extend", "ops"],
    extracted: {
      dimension_evidence: {
        motion: { mentioned: false, evidence: [], needs: [], scenarios: [], pain_points: [] },
        extend: { mentioned: false, evidence: [], needs: [], scenarios: [], pain_points: [] },
        ops: { mentioned: false, evidence: [], needs: [], scenarios: [], pain_points: [] }
      },
      other_dimensions: {},
      tags: ["家务负担", "环境控制"],
      interview_quality: {
        specificity: "high",
        consistency: "medium",
        actionability: "medium"
      }
    },
    history,
    conversation
  });

  assert.ok(result.evi > 0.3);
  assert.equal(result.confidence.motion === "medium" || result.confidence.motion === "high", true);
  assert.equal(result.confidence.extend === "medium" || result.confidence.extend === "high", true);
  assert.equal(result.confidence.ops === "medium" || result.confidence.ops === "high", true);
  assert.equal(
    ["motion", "extend", "ops"].filter((dim) => result.confidence[dim] !== "low").length >= 2,
    true
  );
}

function main() {
  testPromptSchemaHasNoNumericAnchors();
  testPayloadCleanerRemovesReplacementChars();
  testFocusedDimsFallbackToWeakEvidence();
  console.log("round2_extract_interview_result.test.js: all tests passed");
}

main();
