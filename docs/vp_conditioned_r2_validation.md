# VP-Conditioned R2 Validation

Date: 2026-07-13

## Runs

- Baseline (focused, no VP): `sim_layered_structured_v1_2026-07-13T01-27-08-916Z`
- VP-conditioned: `sim_layered_structured_vp_v1_2026-07-13T03-39-15-273Z`
- Implementation commit: `d5fae53a8986f0588613f5a455cff5ed8ff63e44`
- Mode: `layered_structured_vp_v1`
- VP template SHA-256: `5222461e025d2161042f03c8f42bff421720be1723e67938eadd9ac42096bc36`

The new mode uses the same roster, 12 grids, structured profiles, focused elicitation, engine, card pool, tags, and merge path as the baseline. The only experimental change is injection of the frozen R1 WHO/PAIN/HOW commitment into focused WTP, qualitative subjective state, card selection, and team pricing.

## Process Acceptance

| Check | Result | Verdict |
|---|---:|---|
| Strict teams | 12/12 passed | PASS |
| Failed teams / skipped steps | 0 / 0 | PASS |
| `swtp_*` complete | 72/72 | PASS |
| VP in focused / qualitative prompts | 72/72 / 72/72 | PASS |
| VP in card / price prompts | 72/72 / 12/12 | PASS |
| Frozen WTP in card / price prompts | 72/72 / 12/12 | PASS |
| R2 decision-call fallbacks | 0/228 | PASS |
| Anchor rate `[3800,4200]` | 1/72 (1.39%) | PASS, target <15% |
| Team SWTP median vs WTPref Spearman | 0.565 | PASS, target >0.4 |
| ToC Cost Elder team SWTP median | 575 yuan | PASS, remains <2000 |

Prompt audit sampled teams 2, 7, and 11. Each team had the VP block in all 6 focused calls, all 6 qualitative calls, all 6 card-selection calls, and its pricing call. The run contained transient R1 HTTP/DeepSeek retries, but all R2 calls relevant to this experiment completed without fallback.

## Twelve-Grid Comparison

| # | Grid | SWTP median: no VP | SWTP median: VP | Price: no VP | Price: VP | High: no VP | High: VP | coverCore: no VP | coverCore: VP |
|---:|---|---:|---:|---:|---:|---:|---:|---:|---:|
| 1 | ToB Differentiation Elder | 2,500 | 6,750 | 4,000 | 4,000 | 0 | 0 | 0.600 | 0.700 |
| 2 | ToB Differentiation Adult | 11,500 | 65,000 | 4,000 | 4,000 | 1 | 0 | 0.267 | 0.267 |
| 3 | ToB Differentiation Child | 6,500 | 12,500 | 6,000 | 6,000 | 2 | 1 | 0.800 | 0.900 |
| 4 | ToB Cost Elder | 3,000 | 15,000 | 5,000 | 4,000 | 0 | 0 | 0.500 | 0.700 |
| 5 | ToB Cost Adult | 5,000 | 9,000 | 5,000 | 5,000 | 0 | 0 | 0.300 | 0.480 |
| 6 | ToB Cost Child | 2,000 | 4,000 | 1,000 | 4,000 | 0 | 0 | 0.489 | 0.489 |
| 7 | ToC Differentiation Elder | 2,500 | 2,500 | 2,500 | 4,000 | 0 | 0 | 0.617 | 0.617 |
| 8 | ToC Differentiation Adult | 800 | 849.5 | 2,000 | 2,000 | 0 | 0 | 0.754 | 0.492 |
| 9 | ToC Differentiation Child | 2,000 | 2,499.5 | 1,500 | 2,500 | 1 | 0 | 0.509 | 0.509 |
| 10 | ToC Cost Elder | 190 | 575 | 2,000 | 1,000 | 0 | 1 | 0.400 | 0.400 |
| 11 | ToC Cost Adult | 74.5 | 1,650 | 4,000 | 2,800 | 0 | 0 | 0.313 | 0.063 |
| 12 | ToC Cost Child | 150 | 400 | 1,000 | 4,000 | 0 | 0 | 0.333 | 0.417 |

## Strategic Direction

Each row below pairs Differentiation and Cost teams with the same channel and age. Values are `Differentiation - Cost`.

| Pair | SWTP gap: no VP | SWTP gap: VP | Price gap: no VP | Price gap: VP | High gap: no VP | High gap: VP |
|---|---:|---:|---:|---:|---:|---:|
| ToB Elder | -500 | -8,250 | -1,000 | 0 | 0 | 0 |
| ToB Adult | 6,500 | 56,000 | -1,000 | -1,000 | 1 | 0 |
| ToB Child | 4,500 | 8,500 | 5,000 | 2,000 | 2 | 1 |
| ToC Elder | 2,310 | 1,925 | 500 | 3,000 | 0 | -1 |
| ToC Adult | 725.5 | -800.5 | -2,000 | -800 | 0 | 0 |
| ToC Child | 1,850 | 2,099.5 | 500 | -1,500 | 1 | 0 |
| Six-pair aggregate | 2,564.25 | 9,912.33 | 333.33 | 283.33 | 0.67 | 0 |

- SWTP: aggregate Diff-Cost separation increased by 7,348 yuan, but only 4/6 VP pairs point in the expected direction versus 5/6 without VP. The aggregate is dominated by the 65,000-yuan median for ToB Differentiation Adult.
- Price: the Diff-Cost gap did not widen; it decreased from 333 to 283 yuan.
- Tier: the Diff-Cost high-tier gap fell from 0.67 to 0. VP conditioning did not create the expected tier differentiation.

## Economic Results

| Metric | No VP | VP-conditioned | Change |
|---|---:|---:|---:|
| Profitable teams | 8/12 | 7/12 | -1 team |
| Total profit | 110,421,629 | 285,031,637 | +174,610,008 |
| Mean price | 3,166.67 | 3,608.33 | +441.66 |
| Total high-tier cards | 4 | 2 | -2 |
| Mean coverCore | 0.490 | 0.503 | +0.013 |
| Mean coverNice | 0.488 | 0.445 | -0.043 |
| Mean vscore | 0.247 | 0.243 | -0.004 |

All six ToB teams were profitable under VP conditioning, while only one of six ToC teams was profitable. The larger total profit is concentrated in a few teams, especially ToC Differentiation Elder (101.7m), and should not be read as a general profitability improvement.

## Basis Samples

The following three raw `swtp_basis` values were sampled from the prompt-audit teams. Their cited evidence phrases were found in the reports actually included in each member's focused prompt.

**Team 2, ToB Differentiation Adult, 林若曦, SWTP 35,000**

> 高端私立诊所院长愿为品质感与长期回报付溢价，强调‘用得久比便宜重要’，且预算弹性大，需向上汇报ROI故事，类比高端酒店或诊所的差异化体验方案，支付意愿较高

**Team 7, ToC Differentiation Elder, 陈思敏, SWTP 2,500**

> 综合三份报告，客户均愿为消除孤独与恐惧、提供有生命感陪伴的差异化体验支付溢价，参考报告1中2000元感应夜灯及报告2中‘好东西值得花钱’的态度，定价应高于2000元以匹配高端定位。

**Team 11, ToC Cost Adult, 陈泽宇, SWTP 600**

> 用户对标养狗每月花费（粮食、洗澡、兽医等）及保洁每周200元，认为三个月保洁费用可接受，且强调'够好且便宜'，故支付意愿约600元。

## Decision

VP conditioning passed all process-integrity checks and preserved the focused elicitation fix. It changed belief formation materially, but the effect is not a stable strategic-direction effect: SWTP became more dispersed and sometimes inflated, while price and tier choices did not inherit the increased Diff-Cost separation. The mechanism hypothesis is therefore **partially supported at the belief layer and not supported at the downstream price/tier layer** in this run.
