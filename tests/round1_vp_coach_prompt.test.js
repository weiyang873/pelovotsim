const test = require("node:test");
const assert = require("node:assert/strict");

test("round1_vp opening text is fixed and excludes fittext/gmmax", async () => {
  const prompts = await import("../server/llm/prompts.js");
  const text = String(prompts.ROUND1_VP_OPENING_TEXT || "");
  assert.ok(text.includes("价值主张（Value Proposition）指的是：你向某一类目标客户承诺并交付的“核心价值”"));
  assert.ok(text.includes("一个可直接拿来写的模板（1–2 句）"));
  assert.equal(/fittext|Pmax|GMmax|target_gm/i.test(text), false);
});

test("chat router prompt is VP-only and contains <=100 constraint", async () => {
  const prompts = await import("../server/llm/prompts.js");
  const p = String(prompts.CHAT_ROUTER_SYSTEM_PROMPT || "");
  assert.ok(p.includes("只做VP文本辅导"));
  assert.ok(p.includes("VP最终文本必须<=100字"));
  assert.ok(p.includes("不做打分/fittext/Pmax/GMmax"));
});

test("buildChatRouterUserPrompt includes context/state/message", async () => {
  const prompts = await import("../server/llm/prompts.js");
  const txt = prompts.buildChatRouterUserPrompt({
    context_text: "ctx",
    decision_state: { 客户类型: "ToC" },
    phase: "CONTEXT",
    context_final: "",
    solution_final: "",
    vp_final: "",
    draft: "草稿",
    last_options: { CONTEXT: ["a", "b"] },
    recent_messages: [{ role: "user", content: "hello" }],
    user_message: "给参考"
  });
  assert.ok(txt.includes("context_text:"));
  assert.ok(txt.includes("decision_state:"));
  assert.ok(txt.includes("phase: CONTEXT"));
  assert.ok(txt.includes("user_message:"));
});
