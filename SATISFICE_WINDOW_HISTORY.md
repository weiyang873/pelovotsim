# satisfice_window 历史取值清单

Repo root: `/Users/weiyang/Dropbox/Github_indiswyang/try/emba-ai-sim-v01`

## 结论

未找到字面字段 `satisfice_window` / `satisficing_window`。既往 Chain Satisfice / D4+satisfice 系列实际落盘和实现里使用的是 `quantity_policy`，可视作当前唯一可追溯的 satisficing 窗口/数量口径参数。

历史出现过的取值集合：`min6`、`unlimited`。

若 PI 要的是数值型 window，当前仓库和给定 spec 可追溯材料中没有历史数值取值；不得自行发明。

## 取值：`min6`

含义：最终方案每个维度至少 1 张、总数至少 6 张；维度内提示要求核心维度可多选、非核心维度选最低必要卡即可，避免因“可能有一点用”继续加卡。

出处：

- `/Users/weiyang/Dropbox/Github_indiswyang/try/emba-ai-sim-v01/scripts/analysis/formal_v3_chat_format_paired.js:23`：`FORMAL_CHAT_QUANTITY_POLICY` 默认值为 `min6`。
- `/Users/weiyang/Dropbox/Github_indiswyang/try/emba-ai-sim-v01/scripts/analysis/formal_v3_chat_format_paired.js:440-450`：`min6` 的维度/全局提示文案定义。
- `/Users/weiyang/Dropbox/Github_indiswyang/try/emba-ai-sim-v01/scripts/analysis/formal_v3_dimension_satisfice_min6_42_2026-07-30_meta.json:9-11`：formal 42, six-dimension D4+satisfice, `quantity_policy: "min6"`。
- `/Users/weiyang/Dropbox/Github_indiswyang/try/emba-ai-sim-v01/scripts/analysis/formal_v3_rerun_flash_satisfice_formal_paired_2026-07-30_meta.json:9-11`：paired satisfice D4 + formal D5, `quantity_policy: "min6"`。
- `/Users/weiyang/Dropbox/Github_indiswyang/try/emba-ai-sim-v01/scripts/analysis/formal_v3_dimension_satisfice_chat_min6_smoke_2026-08-02_meta.json:9-11`：chat D4/D5 smoke, `quantity_policy: "min6"`。
- `/Users/weiyang/Dropbox/Github_indiswyang/try/emba-ai-sim-v01/scripts/analysis/formal_v3_dimension_satisfice_chat_min6_42_2026-08-02_meta.json:9-11`：chat D4/D5 full 42, `quantity_policy: "min6"`。
- `/Users/weiyang/Dropbox/Github_indiswyang/try/emba-ai-sim-v01/runs_archive/qwen_plus_deprecated/formal_v3_qwen_no_anchor_dimension_satisfice_min6_42_2026-08-05_meta.json:9-11`：qwen-plus/qwen-no-anchor 旧输出，`quantity_policy: "min6"`。
- `/Users/weiyang/Dropbox/Github_indiswyang/try/emba-ai-sim-v01/runs_archive/qwen_plus_deprecated/formal_v3_qwen_no_anchor_dimension_satisfice_chat_min6_42_2026-08-05.jsonl:1`：被停止的 qwen-plus/qwen-no-anchor partial chat-satisfice 输出，日志条目含 `format_arm: "six_dimension_satisfice_chat_D4_chat_D5_min6"` 与 `quantity_policy: "min6"`。
- `/Users/weiyang/Dropbox/Github_indiswyang/try/emba-ai-sim-v01/scripts/analysis/formal_v3_dimension_satisfice_quantity_robustness_2026-07-30_summary.md:3`、`:11`、`:43`：robustness 汇总将 `min6` 与 `unlimited` 作为唯一对照的 quantity wording。

## 取值：`unlimited`

含义：最终方案每个维度至少 1 张、总数不设上限；凡是客户明确需要且能解释价值的能力都可以保留，不要求压到 6 张或 8-10 张。

出处：

- `/Users/weiyang/Dropbox/Github_indiswyang/try/emba-ai-sim-v01/scripts/analysis/formal_v3_chat_format_paired.js:426-438`：`unlimited` 的维度/全局提示文案定义。
- `/Users/weiyang/Dropbox/Github_indiswyang/try/emba-ai-sim-v01/scripts/analysis/formal_v3_dimension_satisfice_unlimited_42_2026-07-30_meta.json:9-11`：formal 42, six-dimension D4+satisfice, `quantity_policy: "unlimited"`。
- `/Users/weiyang/Dropbox/Github_indiswyang/try/emba-ai-sim-v01/scripts/analysis/formal_v3_dimension_satisfice_chat_unlimited_42_2026-08-02_meta.json:9-11`：chat D4/D5 full 42, `quantity_policy: "unlimited"`。
- `/Users/weiyang/Dropbox/Github_indiswyang/try/emba-ai-sim-v01/runs_archive/qwen_plus_deprecated/formal_v3_qwen_no_anchor_dimension_satisfice_unlimited_42_2026-08-05_meta.json:9-11`：qwen-plus/qwen-no-anchor 旧输出，`quantity_policy: "unlimited"`。
- `/Users/weiyang/Dropbox/Github_indiswyang/try/emba-ai-sim-v01/scripts/analysis/formal_v3_dimension_satisfice_quantity_robustness_2026-07-30_summary.md:3`、`:12`、`:44`：robustness 汇总将 `unlimited` 与 `min6` 作为唯一对照的 quantity wording。

## 相关但未给出窗口取值的材料

- `/Users/weiyang/Dropbox/My Mac (Weis-MacBook-Air.local)/Downloads/CODEX_PROGRESSIVE_ON_FORMAL.md:60-72`：定义 `+satisfice-v1` 为“列顾虑 -> 直觉方案 -> 评估 -> 替代 -> 最终选择”，但没有记录任何 `satisfice_window` 或数量窗口参数。
- `/Users/weiyang/Dropbox/Github_indiswyang/try/emba-ai-sim-v01/scripts/analysis/formal_v3_rerun_flash_satisfice_chat_paired_2026-07-29_meta.json:9-10`：早期 paired satisfice D4 + chat D5 仅记录 manipulated factor / arm label，没有 `quantity_policy` 字段。
- `/Users/weiyang/Dropbox/Github_indiswyang/try/emba-ai-sim-v01/scripts/validate_team_sim_gates.js:226-243`：Gate2 是 team sim checkpoint/selection/settlement 校验结构，不含 satisfice window 参数。

## 待 PI 裁决

1. 若 `satisfice_window` 在 persona pool v2 中应映射为现有 `quantity_policy`，候选集合只能是 `["min6", "unlimited"]`。
2. 若 `satisfice_window` 期望为数值或其他分布，本仓库历史没有可用取值，需要 PI 明确新定义；否则不得抽样。
