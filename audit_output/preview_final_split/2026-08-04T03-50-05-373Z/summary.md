# Preview/Final Split Audit

Generated: 2026-08-04T03:50:08.597Z


## 来源判定方法

- 审计范围：扫描 `data/persona_sim_logs/**/teams_summary.csv`，每一行作为一个 team-run 行；同目录下若有 `all_entries.json`、`computation_log.json`、`report.json` 则只读关联。
- preview profit：优先取 `all_entries.json` 中同 team 的 `R2.7_calculate_preview.responseBody.profit`；其次取 `report.json teams[].meta.round2.preview_profit`；再次取 `computation_log.json grouped_logs.r2_profit[0].params.total_profit`。
- final profit：优先取 `all_entries.json` 中同 team 的 `R2.7_submit_final.responseBody.result.profit`；其次取 `computation_log.json grouped_logs.r2_profit[last].params.total_profit`；最后取 `teams_summary.csv r2_profit`。
- coverCore / coverNice / V 来源：把 `teams_summary.csv` 导出值分别与 preview 侧和 final 侧可观测值比较；只在“等于 preview 且不等于 final”时判 `preview`，只在“等于 final 且不等于 preview”时判 `final`；缺字段、两侧相等、或均不等时判 `无法判定`。
- 输入一致性 diff：优先用 API request/response；缺 API 时用 `computation_log grouped_logs` 的 first/last 记录代理。字段为 tags、radar、evi、WTP、grid；任一字段不同则 `input_consistency=DIFF`，全一致才 `CONSISTENT`，缺证据则 `UNKNOWN`。
- affected 判定：同一行存在 preview/final profit 差异，或输入 diff，或导出的 coverCore/coverNice/V 明确来自 preview，即 `affected`。证据不足不猜测，标为 `unknown_insufficient_logs`。


## Overall Summary

- Detail CSV: `audit_output/preview_final_split/2026-08-04T03-50-05-373Z/preview_final_detail.csv`
- Batch CSV: `audit_output/preview_final_split/2026-08-04T03-50-05-373Z/batch_summary.csv`
- Task 2 raw grep: `audit_output/preview_final_split/2026-08-04T03-50-05-373Z/task2_grep_raw.txt`
- Total team-run rows: 920
- Affected rows: 799
- Unknown rows: 90
- Input CONSISTENT rows: 31
- Input DIFF rows: 799
- Profit diff min / median / max: -43574628 / 0 / 19943628
- coverCore exported from preview: 240
- coverNice exported from preview: 191
- V exported from preview: 0

## Anchor Check

- Found anchor run `2026-08-04T02-50-55-732Z`: preview_profit=12215065, final_profit=-1387764, diff=-13602829.
- coverCore source=preview; coverNice source=preview; V source=final.

## Task 2 Classification

- scripts/analysis: 无引用（见 task2_grep_raw.txt 的 scripts_analysis，exit=1 表示 rg 无匹配）
- server/synthetic/teamSim: 无引用（目标关键词无匹配）
- mini-engine candidates: 无引用（rg exit=1）
- team_runner chain: 有引用且入导出，scripts/sim/team_runner.js 调 calculateRD/submitFinal，scripts/sim/decision_tracker.js recordFinalResult，scripts/sim/data_export.js 输出 teams_summary.csv。

## Batch Group Summary

See `batch_summary.csv` for all 128 batch groups. Top groups by affected_rows:

| run_id | total | affected | unknown | input_diff | coverCore_preview | coverNice_preview | profit_diff_min | profit_diff_median | profit_diff_max |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| sim_harness_enforced_v1_2026-07-12T12-17-49-445Z | 12 | 12 | 0 | 12 | 1 | 1 | -43574628 | -43574628 | -43574628 |
| sim_layered_newflow_2026-07-10T23-54-52-761Z | 12 | 12 | 0 | 12 | 1 | 4 | 0 | 0 | 0 |
| sim_layered_newflow_2026-07-12T13-00-04-209Z | 12 | 12 | 0 | 12 | 1 | 1 | -33476804 | -33476804 | -33476804 |
| sim_layered_newflow_6f2edb0_2026-07-12T13-23-05-494Z | 12 | 12 | 0 | 12 | 3 | 3 | 0 | 0 | 0 |
| sim_layered_newflow_summary_clean_6f2edb0_2026-07-12T14-21-45-940Z | 12 | 12 | 0 | 12 | 2 | 2 | 0 | 0 | 0 |
| sim_layered_newflow_summary_v2_2026-07-12T15-46-55-439Z | 12 | 12 | 0 | 12 | 2 | 4 | 10877512 | 10877512 | 10877512 |
| sim_layered_newflow_summary_v2_2026-07-12T16-09-47-548Z | 12 | 12 | 0 | 12 | 1 | 2 | 7305109 | 7305109 | 7305109 |
| sim_layered_newflow_summary_v2_2026-07-12T16-26-57-327Z | 12 | 12 | 0 | 12 | 1 | 1 | 19943628 | 19943628 | 19943628 |
| sim_layered_newflow_summary_v2_2026-07-13T00-24-16-109Z | 12 | 12 | 0 | 12 | 1 | 1 | 15213238 | 15213238 | 15213238 |
| sim_layered_structured_v1_2026-07-12T10-34-56-510Z | 12 | 12 | 0 | 12 | 1 | 4 | -13415974 | -13415974 | -13415974 |
| sim_layered_structured_v1_2026-07-12T10-49-47-429Z | 12 | 12 | 0 | 12 | 1 | 1 | -24862127 | -24862127 | -24862127 |
| sim_layered_structured_v1_2026-07-13T01-27-08-916Z | 12 | 12 | 0 | 12 | 1 | 1 | 11449055 | 11449055 | 11449055 |
| sim_layered_structured_vp_v1_2026-07-13T03-39-15-273Z | 12 | 12 | 0 | 12 | 2 | 2 | 16475303 | 16475303 | 16475303 |
| sim_replay_april_2026-07-10T15-24-17-651Z | 12 | 12 | 0 | 12 | 2 | 1 | 0 | 0 | 0 |
| sim_replay_april_2026-07-10T15-40-34-248Z | 12 | 12 | 0 | 12 | 1 | 2 | 0 | 0 | 0 |
| sim_replay_april_2026-07-10T15-55-17-370Z | 12 | 12 | 0 | 12 | 1 | 1 | 0 | 0 | 0 |
| sim_replay_april_2026-07-10T16-17-07-732Z | 12 | 12 | 0 | 12 | 2 | 1 | 0 | 0 | 0 |
| sim_simple_persona_v1_2026-07-12T11-17-30-309Z | 12 | 12 | 0 | 12 | 1 | 2 | -33969673 | -33969673 | -33969673 |
| sim_structured_no_pricing_v1_2026-07-12T12-36-46-679Z | 12 | 12 | 0 | 12 | 1 | 3 | -2412661 | -2412661 | -2412661 |
| 2026-03-19T05-13-03-216Z | 10 | 10 | 0 | 10 | 0 | 0 | 0 | 0 | 0 |
| 2026-03-19T06-17-43-288Z | 10 | 10 | 0 | 10 | 0 | 0 | 0 | 0 | 0 |
| 2026-03-19T07-19-34-070Z | 10 | 10 | 0 | 10 | 7 | 1 | 0 | 0 | 0 |
| 2026-03-19T08-17-09-088Z | 10 | 10 | 0 | 10 | 9 | 7 | 0 | 0 | 0 |
| 2026-03-19T08-42-54-220Z | 10 | 10 | 0 | 10 | 8 | 1 | 0 | 0 | 0 |
| 2026-03-19T12-25-03-149Z | 10 | 10 | 0 | 10 | 5 | 7 | 0 | 0 | 0 |
| 2026-03-19T14-50-28-204Z | 10 | 10 | 0 | 10 | 5 | 7 | 0 | 0 | 0 |
| 2026-03-19T17-02-38-468Z | 10 | 10 | 0 | 10 | 7 | 2 | 0 | 0 | 0 |
| 2026-03-20T02-32-05-223Z | 10 | 10 | 0 | 10 | 9 | 2 | 0 | 0 | 0 |
| 2026-03-20T02-40-29-029Z | 10 | 10 | 0 | 10 | 7 | 2 | 0 | 0 | 0 |
| 2026-03-20T02-48-58-826Z | 10 | 10 | 0 | 10 | 8 | 10 | 0 | 0 | 0 |

## Notes

- Rows without API/computation evidence are deliberately marked unknown rather than assigned to preview/final.
- Some old CSV formats lack explicit team_id/team_index; those rows are matched by report/computation order when available.
