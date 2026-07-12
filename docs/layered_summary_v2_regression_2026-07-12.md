# Layered Summary v2 Regression

- accepted run: `sim_layered_newflow_summary_v2_2026-07-12T16-26-57-327Z`
- mode: `layered_newflow_summary`
- roster source: `sim_layered_newflow_2026-07-10T23-54-52-761Z`
- strict teams: 12/12
- skipped steps: 0
- final tags equal evidence v2: 12/12
- evidence sha256: `8d7460af9528cfce9e0e349c0106ff54b1dffe0aceabdb2af45d6b47f883dd42`
- reports sha256: `900da996382e5eb5e2104e4da6871ceab861418ba1f3258931fa4691de431623`

## Outcome

| Metric | v1 dirty run | v2 preflight | v2 formal run |
|---|---:|---:|---:|
| Profitable teams | 2/12 | 8/12 | 9/12 |
| Preview profitable teams | 8/12 | N/A | 7/12 |
| coverNice = 0 | 9/12 | 2/12 | 2/12 |
| coverNice median | 0 | 0.50 | 0.50 |
| coverCore median | 0.414 | 0.596 | 0.458 |
| vscore median | 0.0447 | 0.2525 | 0.2244 |

- Final total profit: `182,666,176`
- Mean price: `3,650`
- Price range: `1,000-5,000`
- Tier counts (low/mid/high): `85/35/0`
- coverCore min/median/max: `0.267 / 0.458 / 0.800`
- coverNice min/median/max: `0 / 0.500 / 0.800`
- vscore min/median/max: `0.0390 / 0.2244 / 0.3540`

## Warnings

Strict-mode red warnings were emitted for:

- Team 10, `ToC_Cost_Adult`, coverNice `0`
- Team 11, `ToC_Cost_Child`, coverNice `0`

This improves the v1 same-card recalculation from 9 zero-coverNice teams to 2. Both remaining tags sets are valid and coverable; the selected cards did not cover their nice layer.

## Preview vs Final

- Preview profitable: 7/12
- Final profitable: 9/12
- Profitable-team count gap: 2 teams, down from the v1 dirty run gap of 6 teams
- Preview total profit: `89,370,854`
- Final total profit: `182,666,176`
- Signed final-minus-preview profit: `+93,295,322`
- Absolute per-team profit gap: `151,317,388`

The profitable-team count gap narrowed, but the absolute profit gap did not. In this run final frequently exceeded preview after applying report-grounded v2 tags. Preview behavior was intentionally left unchanged per the experiment boundary.

## Acceptance

- `grid_dimension_evidence_v2.json`: 12 grids
- invalid tags: 0
- uncoverable tags: 0
- declared synonym multi-mapping exceptions: 1 (`唱歌`)
- content gaps remain visible for `B2B_Differentiation_Adult` and `B2C_Differentiation_Elder`
- missing-grid fail-loudly test: passed
- summary backend tests: 15/15 passed
- deployment: not performed
