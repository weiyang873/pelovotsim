const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildPersonaPrompt,
  normalizeRound1Persona
} = require("../server/llm/personaGenerator");

test("buildPersonaPrompt requires ToB personas to be decision makers", () => {
  const prompt = buildPersonaPrompt({
    gridLabel: "ToB·差异化·老人",
    who_raw: "夜间巡视压力大且人手紧张的养老院",
    architectureLabel: "混合型",
    isToB: true,
    previousPersonas: [{ name: "张院长", title: "运营副院长" }]
  });

  assert.match(prompt, /决策者或采购负责人/);
  assert.match(prompt, /不要生成终端使用者/);
  assert.match(prompt, /已生成的前序 persona：张院长，运营副院长/);
  assert.match(prompt, /预算范围和决策流程/);
});

test("buildPersonaPrompt keeps ToC persona as the target customer themselves", () => {
  const prompt = buildPersonaPrompt({
    gridLabel: "ToC·差异化·成人",
    who_raw: "独居白领",
    architectureLabel: "体验型",
    isToB: false,
    previousPersonas: [{ name: "林小雨", title: "互联网产品经理" }]
  });

  assert.match(prompt, /这是 ToC（个人消费者）市场/);
  assert.match(prompt, /访谈对象就是目标客户本人/);
  assert.match(prompt, /不要生成机构负责人或企业采购/);
  assert.match(prompt, /同类目标客户，但职业、生活状态、触发事件或消费习惯不同/);
  assert.doesNotMatch(prompt, /同类决策者但机构规模\/处境\/性格不同/);
});

test("normalizeRound1Persona maps ToB fields into interview-friendly shape", () => {
  const persona = normalizeRound1Persona({
    name: "李总监",
    age: 42,
    title: "采购总监",
    org_type: "连锁养老集团",
    org_scale: "3家分院，合计420张床位",
    pressures: ["夜班排班吃紧"],
    budget: "单项目预算80万",
    trigger: "集团要求今年把夜间事故率压下来",
    personality: "谨慎务实",
    background: "从运营经理升上来"
  }, {
    isToB: true
  });

  assert.equal(persona.occupation, "采购总监");
  assert.equal(persona.living_situation, "连锁养老集团，3家分院，合计420张床位");
  assert.deepEqual(persona.pressures, ["夜班排班吃紧"]);
  assert.equal(persona.trigger, "集团要求今年把夜间事故率压下来");
});
