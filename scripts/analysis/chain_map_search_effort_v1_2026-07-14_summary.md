# Chain Map Search Effort v1 Summary

- Run: `chain_map_search_effort_v1_2026-07-14`
- Completed: 6/6; failed: 0
- Condition: M only; N=3 per persona for the new run.
- All comparisons are descriptive; no inferential or paper-citable claim is made.
- Reasoning length is a weak proxy only: verbosity is not equivalent to search effort.
- D2/D3 have no `source` field in the reused schema, so cumulative map-reference breadth cannot increase at those steps; this is an observability limit, not evidence of no map influence.
- `updated_constraints` is treated as the current constraint-stack snapshot. D5 emits no constraint field, so its stack complexity carries D4 and its new theme breadth is zero.

## Immediate Reference + New Run (Same Metrics)

| Dataset | Persona | Rep | Step | Cumulative map ids | Constraint stack | Step theme breadth | Cards | Dimensions | Reasoning chars |
|---|---|---:|---|---:|---:|---:|---:|---:|---:|
| v5即时参照 | 草根老板 | 1 | D1 | 3 | 3 | 3 | 0 | 0 | 0 |
| v5即时参照 | 草根老板 | 1 | D2 | 3 | 4 | 3 | 0 | 0 | 0 |
| v5即时参照 | 草根老板 | 1 | D3 | 3 | 3 | 4 | 0 | 0 | 139 |
| v5即时参照 | 草根老板 | 1 | D4 | 3 | 5 | 4 | 8 | 6 | 38 |
| v5即时参照 | 草根老板 | 1 | D5 | 3 | 5 | 0 | 0 | 0 | 159 |
| v5即时参照 | 二代接班人 | 1 | D1 | 3 | 3 | 3 | 0 | 0 | 0 |
| v5即时参照 | 二代接班人 | 1 | D2 | 3 | 4 | 5 | 0 | 0 | 0 |
| v5即时参照 | 二代接班人 | 1 | D3 | 3 | 1 | 6 | 0 | 0 | 66 |
| v5即时参照 | 二代接班人 | 1 | D4 | 4 | 5 | 6 | 15 | 6 | 43 |
| v5即时参照 | 二代接班人 | 1 | D5 | 5 | 5 | 0 | 0 | 0 | 232 |
| search-effort N=3 | 草根老板 | 1 | D1 | 3 | 3 | 2 | 0 | 0 | 0 |
| search-effort N=3 | 草根老板 | 1 | D2 | 3 | 4 | 2 | 0 | 0 | 0 |
| search-effort N=3 | 草根老板 | 1 | D3 | 3 | 3 | 4 | 0 | 0 | 128 |
| search-effort N=3 | 草根老板 | 1 | D4 | 3 | 5 | 5 | 8 | 6 | 106 |
| search-effort N=3 | 草根老板 | 1 | D5 | 3 | 5 | 0 | 0 | 0 | 165 |
| search-effort N=3 | 草根老板 | 2 | D1 | 3 | 3 | 2 | 0 | 0 | 0 |
| search-effort N=3 | 草根老板 | 2 | D2 | 3 | 4 | 3 | 0 | 0 | 0 |
| search-effort N=3 | 草根老板 | 2 | D3 | 3 | 5 | 4 | 0 | 0 | 86 |
| search-effort N=3 | 草根老板 | 2 | D4 | 3 | 5 | 3 | 8 | 6 | 36 |
| search-effort N=3 | 草根老板 | 2 | D5 | 4 | 5 | 0 | 0 | 0 | 298 |
| search-effort N=3 | 草根老板 | 3 | D1 | 3 | 3 | 2 | 0 | 0 | 0 |
| search-effort N=3 | 草根老板 | 3 | D2 | 3 | 5 | 2 | 0 | 0 | 0 |
| search-effort N=3 | 草根老板 | 3 | D3 | 3 | 5 | 2 | 0 | 0 | 114 |
| search-effort N=3 | 草根老板 | 3 | D4 | 3 | 5 | 2 | 7 | 6 | 50 |
| search-effort N=3 | 草根老板 | 3 | D5 | 3 | 5 | 0 | 0 | 0 | 252 |
| search-effort N=3 | 二代接班人 | 1 | D1 | 3 | 3 | 2 | 0 | 0 | 0 |
| search-effort N=3 | 二代接班人 | 1 | D2 | 3 | 4 | 5 | 0 | 0 | 0 |
| search-effort N=3 | 二代接班人 | 1 | D3 | 3 | 3 | 7 | 0 | 0 | 116 |
| search-effort N=3 | 二代接班人 | 1 | D4 | 4 | 3 | 7 | 10 | 6 | 48 |
| search-effort N=3 | 二代接班人 | 1 | D5 | 5 | 3 | 0 | 0 | 0 | 241 |
| search-effort N=3 | 二代接班人 | 2 | D1 | 3 | 3 | 4 | 0 | 0 | 0 |
| search-effort N=3 | 二代接班人 | 2 | D2 | 3 | 4 | 5 | 0 | 0 | 0 |
| search-effort N=3 | 二代接班人 | 2 | D3 | 3 | 3 | 8 | 0 | 0 | 101 |
| search-effort N=3 | 二代接班人 | 2 | D4 | 4 | 5 | 8 | 10 | 6 | 72 |
| search-effort N=3 | 二代接班人 | 2 | D5 | 5 | 5 | 0 | 0 | 0 | 162 |
| search-effort N=3 | 二代接班人 | 3 | D1 | 3 | 3 | 3 | 0 | 0 | 0 |
| search-effort N=3 | 二代接班人 | 3 | D2 | 3 | 4 | 4 | 0 | 0 | 0 |
| search-effort N=3 | 二代接班人 | 3 | D3 | 3 | 3 | 5 | 0 | 0 | 99 |
| search-effort N=3 | 二代接班人 | 3 | D4 | 4 | 3 | 6 | 11 | 6 | 91 |
| search-effort N=3 | 二代接班人 | 3 | D5 | 4 | 3 | 0 | 0 | 0 | 125 |

## N=3 Paired Descriptive Comparison

Each vector is rep 1 / rep 2 / rep 3. `Heir higher` is a count out of three matched repetitions.

| Step | Metric | Grassroots | Heir | Heir higher |
|---|---|---|---|---:|
| D1 | 累计地图引用广度 | 3 / 3 / 3 | 3 / 3 / 3 | 0/3 |
| D1 | 约束栈复杂度 | 3 / 3 / 3 | 3 / 3 / 3 | 0/3 |
| D1 | 主题广度 | 2 / 2 / 2 | 2 / 4 / 3 | 2/3 |
| D2 | 累计地图引用广度 | 3 / 3 / 3 | 3 / 3 / 3 | 0/3 |
| D2 | 约束栈复杂度 | 4 / 4 / 5 | 4 / 4 / 4 | 0/3 |
| D2 | 主题广度 | 2 / 3 / 2 | 5 / 5 / 4 | 3/3 |
| D3 | 累计地图引用广度 | 3 / 3 / 3 | 3 / 3 / 3 | 0/3 |
| D3 | 约束栈复杂度 | 3 / 5 / 5 | 3 / 3 / 3 | 0/3 |
| D3 | 主题广度 | 4 / 4 / 2 | 7 / 8 / 5 | 3/3 |
| D4 | 累计地图引用广度 | 3 / 3 / 3 | 4 / 4 / 4 | 3/3 |
| D4 | 约束栈复杂度 | 5 / 5 / 5 | 3 / 5 / 3 | 0/3 |
| D4 | 主题广度 | 5 / 3 / 2 | 7 / 8 / 6 | 3/3 |
| D5 | 累计地图引用广度 | 3 / 4 / 3 | 5 / 5 / 4 | 3/3 |
| D5 | 约束栈复杂度 | 5 / 5 / 5 | 3 / 5 / 3 | 0/3 |
| D5 | 主题广度 | 0 / 0 / 0 | 0 / 0 / 0 | 0/3 |

## D4 Selection Breadth

| Metric | Grassroots | Heir | Heir higher |
|---|---|---|---:|
| Cards | 8 / 8 / 7 | 10 / 10 / 11 | 3/3 |
| Dimensions | 6 / 6 / 6 | 6 / 6 / 6 | 0/3 |

## Reasoning Length (Weak Reference Only)

| Step | Grassroots chars | Heir chars |
|---|---|---|
| D3 | 128 / 86 / 114 | 116 / 101 / 99 |
| D4 | 106 / 36 / 50 | 48 / 72 / 91 |
| D5 | 165 / 298 / 252 | 241 / 162 / 125 |

## Descriptive Decision

- D4 card breadth: heir higher 3/3; grass higher 0/3; equal 0/3.
- D1-D4 theme breadth (D5 excluded because it has no new-constraint field): heir higher 11/12; grass higher 0/12; equal 1/12.
- D1-D4 constraint-stack count: heir higher 0/12; grass higher 5/12; equal 7/12.
- Non-D4 main metrics (map breadth, constraint complexity, theme breadth across D1/D2/D3/D5): heir higher 11/36; grass higher 5/36; equal 20/36.

> effort 分化不只集中在 D4：二代在 D1-D4 的语义主题广度和 D4 选卡广度上呈稳定更广方向；但约束条数没有同步增加，因此支持的是“语义/选择广度”这条全链倾向，不支持“所有 effort 代理都更高”。

Full prompts, raw responses, parsed decisions, and per-step effort records are in `chain_map_search_effort_v1_2026-07-14_raw_samples.md`.
