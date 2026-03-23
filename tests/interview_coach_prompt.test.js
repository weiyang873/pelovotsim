const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildPersonaSystemPrompt,
  buildPriceAttitude
} = require("../server/llm/interviewCoach");

const PERSONA = {
  name: "张敏",
  age: 35,
  occupation: "品牌经理",
  living_situation: "和伴侣住在上海",
  personality: "理性但有点挑剔",
  daily_routine: "平时工作忙，回家比较晚",
  tech_comfort: "愿意尝试新科技",
  interview_style: "先说表面感受，被追问后会展开",
  desires: ["轻松一点", "生活更有秩序"],
  pains: ["下班后很累", "家里没人回应"],
  hidden_pain: "回家那一刻会有很强的空落感",
  contradictions: ["想要高品质，但不想折腾"]
};

test("persona prompt adds no-price rule and diff price attitude", () => {
  const prompt = buildPersonaSystemPrompt(PERSONA, null, { grid_id: "toc_diff_adult" });
  assert.match(prompt, /9\. 你不会说出任何具体价格、价格区间或数字/);
  assert.match(prompt, /## 价格态度/);
  assert.match(prompt, /你对价格不是特别敏感/);
  assert.match(prompt, /愿意为品质买单/);
  assert.match(prompt, /你不会说出任何具体数字/);
});

test("cost grid prompt emphasizes value-for-money without concrete numbers", () => {
  const prompt = buildPersonaSystemPrompt(PERSONA, null, { cell_label: "ToC·成本·成人" });
  assert.match(prompt, /你比较在意性价比/);
  assert.match(prompt, /够用就好/);
  assert.match(prompt, /你不会说出任何具体数字/);
});

test("tob price attitude overrides diff cost detection", () => {
  const priceAttitude = buildPriceAttitude({ cell_label: "ToB·差异·老人" });
  assert.match(priceAttitude, /你是从机构采购的角度考虑的/);
  assert.match(priceAttitude, /投入产出比和长期运营成本/);
  assert.doesNotMatch(priceAttitude, /愿意为品质买单/);
  assert.doesNotMatch(priceAttitude, /性价比/);
});

test("unknown grid uses neutral non-numeric price attitude", () => {
  const priceAttitude = buildPriceAttitude({});
  assert.match(priceAttitude, /没有明确的价格预期/);
  assert.match(priceAttitude, /不会说出任何具体价格或价格区间/);
});
