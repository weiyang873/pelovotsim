# Belief Formation Bench Summary

- runId: `belief_bench_v1_2026-07-13`
- generated: `2026-07-13T00:46:23.186Z`
- temperature: `0.45`
- requested cells: 1080
- completed successfully: 1027/1080 (95.1%)
- failed or extraction miss: 53
- persona reports sha256: `900da996382e5eb5e2104e4da6871ceab861418ba1f3258931fa4691de431623`
- structured profiles sha256: `ed9d3c9a243f7e10009fccf32c63b22925396c6e60b894c1c5f32c0a4000f5e7`

> MATERIAL CAVEAT：当前 persona_reports_v1.1 中，spec 预期的“超过300元”“心理上限两三千元”“两万以内直接批”均为 0 命中。实验严格使用实际生产报告，不补写这些句子。C1/C3 衡量的是现有行为证据文本下的表现。

## Decision Metrics

| Condition | Successful | Anchor rate [3800,4200] | Spearman vs WTPref | Premium - frugal | Premium higher grids |
|---|---:|---:|---:|---:|---:|
| C0_leaked | 180 | 1.7% | 0.928 | 918 | 100.0% |
| C0_clean | 180 | 0.0% | 0.928 | 666 | 66.7% |
| C1 | 180 | 0.0% | 0.812 | 2355 | 100.0% |
| C2_low | 180 | 0.0% | 0.928 | 483 | 66.7% |
| C2_high | 180 | 0.6% | 0.986 | 1002 | 83.3% |
| C3 | 127 | 0.8% | 0.058 | 339 | 20.0% |

## Distribution And Verdict

| Condition | Mean WTP | Median WTP | Verdict |
|---|---:|---:|---|
| C0_leaked | 3064 | 3500 | The leaked range changes the distribution, but does not recreate a 4000 point mass. |
| C0_clean | 4574 | 2500 | Baseline already reads grid-specific price context; 4000 collapse is not reproduced. |
| C1 | 4868 | 3000 | Evidence-first does not improve grid sensitivity over clean C0. |
| C2_low | 1027 | 1200 | Estimates follow the injected low anchor. |
| C2_high | 9763 | 11500 | Estimates follow the injected high anchor. |
| C3 | 1148 | 260 | Rejected under current reports: extraction and grid-sensitivity thresholds fail. |

- C2 anchor shift (high mean minus low mean): 8736 yuan.
- C3 extraction success: 127/180 (70.6%), below the >90% criterion.
- C0-C2 persona differences are present, but they are not cleanly monotonic across all grids; persona text affects level without overriding report/anchor evidence.

### ToC_Cost_Elder

| Condition | Mean WTP | Median WTP |
|---|---:|---:|
| C0_leaked | 382 | 300 |
| C0_clean | 235 | 200 |
| C1 | 243 | 200 |
| C2_low | 233 | 200 |
| C2_high | 543 | 500 |

C1 is effectively unchanged from clean C0 for the low-price elder grid, so forced quotation adds little once the actual report text is already supplied.

### C3 Extraction By Grid

| Grid | Success | Miss | Success rate |
|---|---:|---:|---:|
| ToC_Cost_Elder | 30 | 0 | 100.0% |
| ToC_Cost_Child | 3 | 27 | 10.0% |
| ToC_Differentiation_Adult | 27 | 3 | 90.0% |
| ToB_Cost_Adult | 30 | 0 | 100.0% |
| ToB_Differentiation_Elder | 30 | 0 | 100.0% |
| ToB_Differentiation_Child | 7 | 23 | 23.3% |

## Prompt Leak Audit

- slider bounds `2000 / 7000`: absent
- default price `4000`: absent
- `cost_ref`, `COGSbase`, or other cost numbers: absent
- previous card-selection prompt carried into call: no; subjective state creates a fresh two-message request
- numeric anchor leak: present in the output example, `estimated_wtp_range: [3000, 5000]`
- consequence: both `C0_leaked` and `C0_clean` are included; the bench therefore has 1,080 cells rather than the original 900-cell matrix

Full original prompt is in `belief_bench_prompt_audit.md`.

## C3 Extraction Misses

- ToC_Cost_Child / 二代接班人 / rep 1: anchors array is empty
- ToC_Cost_Child / 二代接班人 / rep 2: anchors array is empty
- ToC_Cost_Child / 二代接班人 / rep 3: anchors array is empty
- ToC_Cost_Child / 二代接班人 / rep 5: anchors array is empty
- ToC_Cost_Child / 二代接班人 / rep 4: anchors array is empty
- ToC_Cost_Child / 二代接班人 / rep 6: anchors array is empty
- ToC_Cost_Child / 二代接班人 / rep 7: anchors array is empty
- ToC_Cost_Child / 二代接班人 / rep 8: anchors array is empty
- ToC_Cost_Child / 二代接班人 / rep 10: anchors array is empty
- ToC_Cost_Child / 二代接班人 / rep 9: anchors array is empty
- ToC_Cost_Child / 草根老板 / rep 1: anchors array is empty
- ToC_Cost_Child / 草根老板 / rep 3: anchors array is empty
- ToC_Cost_Child / 草根老板 / rep 6: anchors array is empty
- ToC_Cost_Child / 草根老板 / rep 5: anchors array is empty
- ToC_Cost_Child / 草根老板 / rep 4: anchors array is empty
- ToC_Cost_Child / 草根老板 / rep 7: anchors array is empty
- ToC_Cost_Child / 草根老板 / rep 8: anchors array is empty
- ToC_Cost_Child / 草根老板 / rep 10: anchors array is empty
- ToC_Cost_Child / 职业经理人 / rep 1: anchors array is empty
- ToC_Cost_Child / 职业经理人 / rep 3: anchors array is empty
- ToC_Cost_Child / 职业经理人 / rep 2: anchors array is empty
- ToC_Cost_Child / 职业经理人 / rep 5: anchors array is empty
- ToC_Cost_Child / 职业经理人 / rep 6: anchors array is empty
- ToC_Cost_Child / 职业经理人 / rep 7: anchors array is empty
- ToC_Cost_Child / 职业经理人 / rep 8: anchors array is empty
- ToC_Cost_Child / 职业经理人 / rep 9: anchors array is empty
- ToC_Cost_Child / 职业经理人 / rep 10: anchors array is empty
- ToC_Differentiation_Adult / 二代接班人 / rep 4: anchors array is empty
- ToC_Differentiation_Adult / 草根老板 / rep 3: anchors array is empty
- ToC_Differentiation_Adult / 草根老板 / rep 8: anchors array is empty
- ToB_Differentiation_Child / 二代接班人 / rep 3: anchors array is empty
- ToB_Differentiation_Child / 二代接班人 / rep 1: anchors array is empty
- ToB_Differentiation_Child / 二代接班人 / rep 6: anchors array is empty
- ToB_Differentiation_Child / 二代接班人 / rep 5: anchors array is empty
- ToB_Differentiation_Child / 二代接班人 / rep 7: anchors array is empty
- ToB_Differentiation_Child / 二代接班人 / rep 4: anchors array is empty
- ToB_Differentiation_Child / 二代接班人 / rep 8: anchors array is empty
- ToB_Differentiation_Child / 二代接班人 / rep 9: anchors array is empty
- ToB_Differentiation_Child / 草根老板 / rep 1: anchors array is empty
- ToB_Differentiation_Child / 草根老板 / rep 2: anchors array is empty
- ToB_Differentiation_Child / 草根老板 / rep 3: anchors array is empty
- ToB_Differentiation_Child / 草根老板 / rep 5: anchors array is empty
- ToB_Differentiation_Child / 草根老板 / rep 4: anchors array is empty
- ToB_Differentiation_Child / 草根老板 / rep 7: anchors array is empty
- ToB_Differentiation_Child / 草根老板 / rep 8: anchors array is empty
- ToB_Differentiation_Child / 草根老板 / rep 9: anchors array is empty
- ToB_Differentiation_Child / 草根老板 / rep 10: anchors array is empty
- ToB_Differentiation_Child / 职业经理人 / rep 1: anchors array is empty
- ToB_Differentiation_Child / 职业经理人 / rep 3: anchors array is empty
- ToB_Differentiation_Child / 职业经理人 / rep 5: anchors array is empty
- ToB_Differentiation_Child / 职业经理人 / rep 6: anchors array is empty
- ToB_Differentiation_Child / 职业经理人 / rep 8: anchors array is empty
- ToB_Differentiation_Child / 职业经理人 / rep 10: anchors array is empty

## Other Failures

- None

## Prompt Template SHA256

- original_subjective_state: `c0168f14731b5f02bc8e8fed6f58598c76267eec9c51a44d5a266173606db29e`
- c0_leaked: `10da7f3679eb5d9987cb7497e3ceab7447fb1c233a79b03a34691fe0fc7ea986`
- c0_clean: `fee7905ce7f11affb530e0ca1ff5c88b8dd279ae36b1adc55d1e0f12a92c5f50`
- c1_extract: `16f3bdbdc12ff5514008b42857dff7bd05534897be4f8c576f7fd82d63c9c46b`
- c1_estimate: `ea3b7e3d328cd48200d23e1639969fbe7a3a03c93a2d627d2339e15a5c283f9e`
- c2_low: `6132ca961f6f79e5d2ee2e6a7085d5eeb91cf56285a42baf1bce04fc8d2efe5d`
- c2_high: `b67a1cd5c6008b19acd1f5f6d6ed88036c1cb864ae86042673af5f6304c33ecc`
- c3_extract: `1685cf1edf094d8104fa461b48adb662ae5af9a0add5c2247e06488a98464be9`
