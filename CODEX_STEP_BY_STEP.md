# Round 1（强合并）最终规格：一步到位改法（给 Codex 用）

## 目标交互（只保留两步 + 生成VP + evaluator）
- Step 1：输入框【场景+痛点（一句话）】按钮：【给些提示】、【确定此版本】
  - 点击【给些提示】：后端返回提示卡 JSON（含2-3条备选答案 suggested_answers，可点击填入输入框）
  - 点击【确定此版本】：校验通过后锁定 context_final，进入 Step 2
- Step 2：输入框【解决方式（一句话）】按钮：【给些提示】、【确定此版本】
  - 点击【给些提示】：必须引用 Step 1 的 context_final，返回提示卡 JSON（含2-3条备选答案）
  - 点击【确定此版本】：锁定 solution_final
- Step 3：按钮【生成价值主张】：后端生成 vp_final（可先输出 one-liner），展示并允许编辑
- Step 4：按钮【评估与改进】：调用 evaluator，返回 coherence+分项改进+下一轮问题

## 你需要替换/新增的文件（由用户已准备）
- server/llm/prompts.js  ← 用 prompts_round1_v1.js 覆盖
- server/llm/dimension-explainer.js ← 维度解释字典（已存在）
- server/llm/schemas/vp_hint_response.schema.json ← 新增（可选校验）

## 接口要求（建议）
- POST /api/round1/vp/hint
  - 输入：{ step: 1|2, decision_state, context_final? }
  - 输出：提示卡 JSON（严格符合 vp_hint_response.schema.json）
  - deepseek messages：
    system = HINT_SYSTEM_PROMPT
    user = buildHintUserPrompt(...)
- POST /api/round1/vp/generate
  - 输入：{ decision_state, context_final, solution_final }
  - 输出：{ vp_one_liner, drivers, proof_2weeks, channel_roles }（可简化）
- POST /api/round1/vp/evaluate
  - 输入：{ decision_state, context_final, solution_final, vp_final }
  - 输出：严格 JSON（按 prompts.js 中的 schema 约束）

## 前端要点
- “给些提示”弹出卡片：渲染 one_liner/how_to_answer/common_pitfalls/suggested_answers/one_choice_question
- suggested_answers 点击后将 text 填入输入框（用户可编辑）
- 输入校验（强制）：
  - >= 12个中文字符
  - 不能包含：不知道/不清楚/随便/NA/无/机器人（单独出现）
- Step 2 的提示生成必须带 context_final（递进）
- LLM_DEBUG=1 时显示 prompt 预览（system/user 截断）方便调试
