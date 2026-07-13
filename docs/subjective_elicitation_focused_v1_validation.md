# Focused Subjective Elicitation Validation

- run: `sim_layered_structured_v1_2026-07-13T01-27-08-916Z`
- runner commit: `a2adaec20e3db81b6f6f8437e10c3b4fbb581966`
- mode: `layered_structured_v1`
- profitable teams: 8/12 (informational; not an acceptance criterion)

## Acceptance

| Check | Result | Verdict |
|---|---:|---|
| Strict teams / skipped steps | 12/12 / 0 | PASS |
| `swtp_value` in [3800,4200] | 1/72 = 1.39% | PASS (<15%) |
| Team-median SWTP vs `r1_wtp_ref` Spearman | 0.681 | PASS (>0.6) |
| `ToC_Cost_Elder` six-person median | 190 yuan | PASS (<2000) |
| Basis samples grounded in member prompt | 6/6 | PASS |
| Frozen WTP in pricing prompts | 12/12 | PASS |

All 72 student rows contain `swtp_basis`, finite `swtp_value`, and
`swtp_call_version=focused_v1`. The run manifest records both elicitation
template hashes.

## Team Medians

| Team | Grid | WTP ref | SWTP median |
|---:|---|---:|---:|
| 0 | ToB_Differentiation_Elder | 19,268 | 2,500 |
| 1 | ToB_Differentiation_Adult | 18,394 | 11,500 |
| 2 | ToB_Differentiation_Child | 18,732 | 6,500 |
| 3 | ToB_Cost_Elder | 15,964 | 3,000 |
| 4 | ToB_Cost_Adult | 15,445 | 5,000 |
| 5 | ToB_Cost_Child | 15,964 | 2,000 |
| 6 | ToC_Differentiation_Elder | 18,091 | 2,500 |
| 7 | ToC_Differentiation_Adult | 17,120 | 800 |
| 8 | ToC_Differentiation_Child | 17,496 | 2,000 |
| 9 | ToC_Cost_Elder | 11,714 | 190 |
| 10 | ToC_Cost_Adult | 10,663 | 74.5 |
| 11 | ToC_Cost_Child | 11,714 | 150 |

The only anchored student was team 2/member 5 at 4,000 yuan.

## Basis Audit

Each evidence fragment below was found in that member's actual
`R2.focused_swtp` prompt, not merely in the full report configuration.

| Team/member | Grid | Basis evidence | Prompt evidence found |
|---|---|---|---|
| 0/0 | ToB_Differentiation_Elder | Three night staff at 4,500 yuan each | `夜班现在排三个人`; `每人月薪四千五` |
| 2/0 | ToB_Differentiation_Child | Part-time assistant cost per semester | `兼职助教`; `每学期开支` |
| 6/1 | ToC_Differentiation_Elder | Paid over 2,000 yuan for a sensor night light | `花两千多`; `感应夜灯` |
| 8/2 | ToC_Differentiation_Child | Paid over 2,000 yuan for a learning device | `花两千多`; `学习机` |
| 9/4 | ToC_Cost_Elder | Hesitates above the stated amount and fixes taps personally | `超过这个数我就得犹豫`; `换水龙头` |
| 10/1 | ToC_Cost_Adult | Dog ownership comparison and a 30-yuan lamp | `养狗`; `台灯三十块` |

## Propagation

- Focused WTP calls: 72
- Qualitative subjective-state calls: 72
- Frozen WTP injected into qualitative calls: 72/72
- Frozen WTP injected into card-selection prompts: 72/72
- Frozen lead-writer WTP injected into team-pricing prompts: 12/12

## Residual Risk

The six requested samples are grounded. Some non-sampled basis strings still
add interpretive language such as a generic "high-end equipment price range"
that is not a direct report quote. This does not affect the current numerical
acceptance, but a future strict citation requirement should return a verbatim
`basis_quote` and validate it as a substring of the member's read reports.
