# Original Subjective Prompt Isolation

- runId: `subjective_prompt_isolation_v1_2026-07-13`
- cells: 120/120
- successful: 120/120 (100.0%)
- midpoint anchor rate [3800,4200]: 84/120 (70.0%)
- exact example range [3000,5000]: 82/120 (68.3%)
- ranges containing 4000: 106/120 (88.3%)
- midpoint mean/median: 3670.4 / 4000.0
- failures: 0
- verdict: **PROMPT_FORMAT_CAUSAL_CANDIDATE: anchor rate is at least 70%; the full multi-field example is sufficient to recreate collapse without pipeline context.**

## Per Grid

| Grid | Success | Anchor rate | Exact example | Contains 4000 | Mean midpoint |
|---|---:|---:|---:|---:|---:|
| B2B_Differentiation_Elder | 10/10 | 30.0% | 30.0% | 100.0% | 4350 |
| B2B_Differentiation_Adult | 10/10 | 0.0% | 0.0% | 100.0% | 4675 |
| B2B_Differentiation_Child | 10/10 | 80.0% | 70.0% | 100.0% | 4050 |
| B2B_Cost_Elder | 10/10 | 100.0% | 100.0% | 100.0% | 4000 |
| B2B_Cost_Adult | 10/10 | 100.0% | 100.0% | 100.0% | 4000 |
| B2B_Cost_Child | 10/10 | 100.0% | 100.0% | 100.0% | 4000 |
| B2C_Differentiation_Elder | 10/10 | 100.0% | 100.0% | 100.0% | 4000 |
| B2C_Differentiation_Adult | 10/10 | 100.0% | 100.0% | 100.0% | 4000 |
| B2C_Differentiation_Child | 10/10 | 70.0% | 60.0% | 100.0% | 4075 |
| B2C_Cost_Elder | 10/10 | 80.0% | 80.0% | 80.0% | 3270 |
| B2C_Cost_Adult | 10/10 | 60.0% | 60.0% | 60.0% | 2590 |
| B2C_Cost_Child | 10/10 | 20.0% | 20.0% | 20.0% | 1035 |

## Isolation Boundary

- One user message only; no system persona message.
- No prior report-reading, selection, pricing, cost, card, validation, or conversation messages.
- All three production v1.1 reports for the grid are inserted through the same `buildReportsInput` format used by the sim.
- The original five-field JSON example and wording are unchanged.
- Midpoint is a deterministic post-processing score and is never sent to the model.

## Failures

- None
