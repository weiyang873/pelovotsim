# Structured Profiles v1 No Pricing Ablation Report

- input: scripts/sim/structured_profiles_v1.json
- output: scripts/sim/structured_profiles_v1_no_pricing.json
- profiles: 72/72
- removed fields: belief_policy, aspirations.acceptable_margin, aspirations.price_position, objectives_rank

## Forbidden Key Hits

| key | hits |
|---|---:|
| belief_policy | 0 |
| wtp_anchor_style | 0 |
| trust_in_reports | 0 |
| confidence_calibration | 0 |
| acceptable_margin | 0 |
| price_position | 0 |
| objectives_rank | 0 |

## Required Field Check

- PASS: all required retained fields are present.
