const test = require("node:test");
const assert = require("node:assert/strict");

const { fitFinalVpComment } = require("../server/routes/teamRoutes");

test("fitFinalVpComment backs off to sentence boundaries for long complete text", () => {
  const sentence = "这是一句用于测试的完整中文评语，包含优点、改进方向、下一轮提醒，并且应该完整收尾。";
  const out = fitFinalVpComment(sentence.repeat(8), 180, 350);

  assert.ok(out.length <= 350);
  assert.match(out, /[。！？]$/);
  assert.notEqual(out.length, 251);
});

test("fitFinalVpComment returns 251 characters unchanged when within max", () => {
  const out = fitFinalVpComment("测".repeat(250) + "。", 180, 350);
  assert.equal(out, "测".repeat(250) + "。");
});

test("fitFinalVpComment falls back to clipping when no sentence boundary exists", () => {
  const out = fitFinalVpComment("测".repeat(500), 180, 350);

  assert.equal(out.length, 351);
  assert.match(out, /。$/);
  assert.notEqual(out.length, 251);
});

test("fitFinalVpComment handles empty values", () => {
  assert.equal(fitFinalVpComment(""), "");
  assert.equal(fitFinalVpComment(null), "");
  assert.equal(fitFinalVpComment(undefined), "");
});

test("fitFinalVpComment returns exactly 350 characters unchanged", () => {
  const out = fitFinalVpComment("测".repeat(349) + "。", 180, 350);
  assert.equal(out, "测".repeat(349) + "。");
});
