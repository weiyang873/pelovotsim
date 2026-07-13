"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const TeamRunner = require("../scripts/sim/team_runner");

const {
  buildFocusedWtpMessages,
  buildQualitativeSubjectiveMessages,
  frozenWtpStatement,
  validateFocusedWtp,
  validateQualitativeSubjectiveState
} = TeamRunner.__test;

test("focused WTP prompt has no copyable numeric example", () => {
  const messages = buildFocusedWtpMessages({
    structuredProfileText: "{PERSONA}",
    reportsText: "{REPORTS}"
  });
  const prompt = messages.map((message) => message.content).join("\n");
  assert.match(prompt, /<数字>/);
  assert.doesNotMatch(prompt, /3000|4000|5000|estimated_wtp_range/);
});

test("qualitative prompt freezes focused WTP and uses placeholder-only schema values", () => {
  const messages = buildQualitativeSubjectiveMessages({
    structuredProfileText: "{PERSONA}",
    reportsText: "{REPORTS}",
    estimatedWtp: 1234
  });
  const prompt = messages.map((message) => message.content).join("\n");
  assert.match(prompt, /支付意愿约为 1234 元/);
  assert.match(prompt, /"<需求>"/);
  assert.match(prompt, /"<目标>"/);
  assert.match(prompt, /"<覆盖等级>"/);
  assert.match(prompt, /"<停止规则>"/);
  assert.doesNotMatch(prompt, /需求1|一句话说明本轮最重要目标|estimated_wtp_range/);
});

test("focused and qualitative validators produce the frozen subjective shape", () => {
  assert.deepEqual(validateFocusedWtp({ basis: "报告提到预算谨慎", estimated_wtp: 1800 }), {
    ok: true,
    value: { basis: "报告提到预算谨慎", estimated_wtp: 1800 }
  });
  assert.equal(validateFocusedWtp({ basis: "", estimated_wtp: 1800 }).ok, false);
  assert.equal(validateFocusedWtp({ basis: "证据", estimated_wtp: "x" }).ok, false);

  const qualitative = validateQualitativeSubjectiveState({
    top_needs: ["稳定", "省心"],
    primary_goal: "覆盖核心需求",
    min_acceptable_coverage: "medium",
    planned_stop_rule: "比较三种方案后停止"
  });
  assert.equal(qualitative.ok, true);
  assert.deepEqual(qualitative.value.top_needs, ["稳定", "省心"]);
});

test("downstream frozen WTP statement is explicit and metadata hashes both calls", () => {
  assert.equal(frozenWtpStatement({ swtp_value: 1800 }), "你此前判断该客群支付意愿约为 1800 元。这是已冻结事实，不要重新估计。");
  const metadata = TeamRunner.getSubjectiveElicitationMetadata();
  assert.equal(metadata.version, "focused_v1");
  assert.match(metadata.template_sha256.focused_wtp, /^[a-f0-9]{64}$/);
  assert.match(metadata.template_sha256.qualitative, /^[a-f0-9]{64}$/);
});
