# July team_runner corrected preview/final split

Generated: 2026-08-04T04:25:20.362Z

## Files

- Detail: `july_team_runner_corrected_detail.csv`
- Batch summary: `july_team_runner_corrected_batch_summary.csv`

## Rule

- Official outcome uses `submit_final` / final result.
- Preview columns are retained only as diagnostics.
- Missing final coverCore/coverNice are deterministically recomputed from final submit tags + selections via `rdCalculator.calculate`; recomputed coverage is used only for explanation metrics, not to replace official profit.
- Original logs and exports were not modified.
- During deterministic recompute, `rdCalculator` attempted its normal asynchronous computation-log DB insert; the sandbox blocked local PostgreSQL with `EPERM`. This did not modify audited log files and did not affect the generated CSV values.

## Counts

- July team_runner rows: 269
- Official profit known: 236
- Profit rows needing preview/final correction: 154
- Profit sign changed by correction: 52
- Rows with final coverCore/coverNice available after log/recompute: 236
- Rows whose exported coverCore or coverNice was preview-mixed: 147

## Top corrected batches

| run_id | total | loss_rate | profit_corrections | sign_changed | coverage_available | coverCore_mixed | coverNice_mixed |
|---|---:|---:|---:|---:|---:|---:|---:|
| sim_harness_enforced_v1_2026-07-12T12-17-49-445Z | 12 | 0.8333333333333334 | 12 | 5 | 12 | 12 | 8 |
| sim_layered_newflow_2026-07-12T13-00-04-209Z | 12 | 0.8333333333333334 | 12 | 6 | 12 | 12 | 9 |
| sim_layered_newflow_summary_v2_2026-07-12T16-09-47-548Z | 12 | 0.25 | 12 | 3 | 12 | 9 | 7 |
| sim_layered_newflow_summary_v2_2026-07-12T16-26-57-327Z | 12 | 0.25 | 12 | 4 | 12 | 9 | 8 |
| sim_layered_newflow_summary_v2_2026-07-13T00-24-16-109Z | 12 | 0.3333333333333333 | 12 | 2 | 12 | 9 | 8 |
| sim_layered_structured_v1_2026-07-12T10-34-56-510Z | 12 | 0.75 | 12 | 7 | 12 | 12 | 9 |
| sim_layered_structured_v1_2026-07-12T10-49-47-429Z | 12 | 0.8333333333333334 | 12 | 7 | 12 | 12 | 9 |
| sim_layered_structured_v1_2026-07-13T01-27-08-916Z | 12 | 0.3333333333333333 | 12 | 2 | 12 | 8 | 8 |
| sim_layered_structured_vp_v1_2026-07-13T03-39-15-273Z | 12 | 0.4166666666666667 | 12 | 1 | 12 | 9 | 8 |
| sim_simple_persona_v1_2026-07-12T11-17-30-309Z | 12 | 0.8333333333333334 | 12 | 6 | 12 | 11 | 9 |
| sim_structured_no_pricing_v1_2026-07-12T12-36-46-679Z | 12 | 0.8333333333333334 | 12 | 6 | 12 | 12 | 8 |
| sim_layered_newflow_summary_v2_2026-07-12T15-46-55-439Z | 12 | 0.2727272727272727 | 11 | 3 | 11 | 8 | 7 |
| 2026-07-10T14-18-06-070Z | 10 | 0.8 | 10 | 0 | 10 | 0 | 0 |
| 2026-07-10T14-12-29-442Z | 1 | 1 | 1 | 0 | 1 | 0 | 0 |
| 2026-07-10T13-48-47-053Z | 1 |  | 0 | 0 | 0 | 0 | 0 |
| 2026-07-10T13-51-09-838Z | 1 |  | 0 | 0 | 0 | 0 | 0 |
| 2026-07-10T14-01-14-238Z | 1 |  | 0 | 0 | 0 | 0 | 0 |
| 2026-07-10T14-03-51-980Z | 1 |  | 0 | 0 | 0 | 0 | 0 |
| 2026-07-10T14-06-34-575Z | 1 |  | 0 | 0 | 0 | 0 | 0 |
| 2026-07-10T14-08-50-515Z | 1 |  | 0 | 0 | 0 | 0 | 0 |
| sim_layered_newflow_2026-07-10T23-54-52-761Z | 12 | 0.25 | 0 | 0 | 12 | 0 | 0 |
| sim_layered_newflow_6f2edb0_2026-07-12T13-23-05-494Z | 12 | 0.3333333333333333 | 0 | 0 | 12 | 5 | 2 |
| sim_layered_newflow_summary_clean_6f2edb0_2026-07-12T14-21-45-940Z | 12 | 0.4166666666666667 | 0 | 0 | 12 | 5 | 2 |
| sim_replay_april_2026-07-10T15-11-32-513Z | 12 |  | 0 | 0 | 0 | 0 | 0 |
| sim_replay_april_2026-07-10T15-16-37-697Z | 12 | 0.6666666666666666 | 0 | 0 | 3 | 0 | 0 |
| sim_replay_april_2026-07-10T15-24-17-651Z | 12 | 0.9090909090909091 | 0 | 0 | 11 | 0 | 0 |
| sim_replay_april_2026-07-10T15-40-34-248Z | 12 | 0.75 | 0 | 0 | 8 | 0 | 0 |
| sim_replay_april_2026-07-10T15-55-17-370Z | 12 | 0.6666666666666666 | 0 | 0 | 12 | 0 | 0 |
| sim_replay_april_2026-07-10T16-17-07-732Z | 12 | 0.9166666666666666 | 0 | 0 | 12 | 2 | 0 |
