const test = require("node:test");
const assert = require("node:assert/strict");

const FULL = {
  who: "在一线城市独居老人的子女，平时工作忙。",
  pain: "父母一个人在家，晚上起夜容易摔倒。",
  how: "提供一台能陪聊并在异常时提醒子女的机器人。",
  boundary: "失智老人不适用。"
};

test("不出现重复标点或黏连（原有回归守卫）", async () => {
  const { buildVpRecapSentence } = await import("../client/src/utils/vpRecap.js");
  const out = buildVpRecapSentence(FULL);

  assert.ok(!/。。/.test(out));
  assert.ok(!/。的场景下/.test(out));
  assert.ok(!/[，、]。/.test(out));
});

test("四段都带标签且用 ｜ 分隔", async () => {
  const { buildVpRecapSentence } = await import("../client/src/utils/vpRecap.js");
  const out = buildVpRecapSentence(FULL);

  assert.ok(out.startsWith("目标客户："));
  for (const label of ["核心痛点：", "解决方式：", "适用边界："]) {
    assert.ok(out.includes(label), `缺少 ${label}`);
  }
  assert.equal(out.split("｜").length, 4);
});

test("不再出现旧模板的措辞", async () => {
  const { buildVpRecapSentence } = await import("../client/src/utils/vpRecap.js");
  const out = buildVpRecapSentence(FULL);

  assert.ok(!/。。/.test(out));
  assert.ok(!/。的场景下/.test(out));
  assert.ok(!out.includes("这款 AI 宠物机器人"));
  assert.ok(!out.includes("创造更好的结果"));
  assert.ok(!out.includes("的场景下"));
});

test("boundary 缺失或为占位值时只输出三段", async () => {
  const { buildVpRecapSentence } = await import("../client/src/utils/vpRecap.js");

  for (const boundary of [undefined, "", "未明确", "无"]) {
    const out = buildVpRecapSentence({ ...FULL, boundary });
    assert.equal(out.split("｜").length, 3, `boundary=${JSON.stringify(boundary)}`);
    assert.ok(!out.includes("适用边界"));
  }
});

test("核心字段缺失时回落到 fallbackText", async () => {
  const { buildVpRecapSentence } = await import("../client/src/utils/vpRecap.js");

  assert.equal(buildVpRecapSentence({ who: "只有这个" }, "原始 VP 文本"), "原始 VP 文本");
  assert.equal(buildVpRecapSentence({}, ""), "未生成最终价值主张。");
});

test("学生写短语（不带句号）时同样正常", async () => {
  const { buildVpRecapSentence } = await import("../client/src/utils/vpRecap.js");
  const out = buildVpRecapSentence({ who: "独居老人子女", pain: "夜间摔倒风险", how: "陪聊加异常提醒" });

  assert.equal(out, "目标客户：独居老人子女｜核心痛点：夜间摔倒风险｜解决方式：陪聊加异常提醒");
});
