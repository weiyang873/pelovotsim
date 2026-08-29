const test = require("node:test");
const assert = require("node:assert/strict");

test("buildVpRecapSentence strips terminal punctuation before composing recap", async () => {
  const { buildVpRecapSentence } = await import("../client/src/utils/vpRecap.js");

  const out = buildVpRecapSentence({
    who: "在一线城市独居老人的子女，平时工作忙。",
    pain: "父母一个人在家，晚上起夜容易摔倒。",
    how: "提供一台能陪聊并在异常时提醒子女的机器人。",
    boundary: "失智老人不适用。"
  });

  assert.ok(!/。。/.test(out));
  assert.ok(!/。的场景下/.test(out));
  assert.ok(!/[，、]。/.test(out));
});
