# structured_profiles_v1 variance report

- source_run: `sim_layered_newflow_2026-07-10T23-54-52-761Z`
- profiles: 72
- compiler_prompt_sha256: `6a82a7b70563e665971c81daa7e124590e95ef04da24aa6ed4f2666ee9ec35f5`
- validation: valid: 72/72
- sensitive scan scope: decision payload only; required metadata such as `source_run` contains dates by design.
- cap_id hits: 0
- 4+ digit hits: 0

## 1. 字段分布表

| field | value counts | max share | flag |
| --- | --- | ---: | --- |
| `attention.customer_visible_value` | high=45; medium=5; low=22 | 62.5% |  |
| `attention.technical_dependencies` | high=14; medium=23; low=35 | 48.6% |  |
| `attention.cost_structure` | high=20; medium=30; low=22 | 41.7% |  |
| `attention.brand_signal` | high=12; medium=35; low=25 | 48.6% |  |
| `attention.constraint_checking` | high=34; medium=6; low=32 | 47.2% |  |
| `belief_policy.wtp_anchor_style` | report_numbers=35; premium_analogy=14; budget_analogy=0; gut_feel=23 | 48.6% |  |
| `belief_policy.trust_in_reports` | high=37; medium=14; low=21 | 51.4% |  |
| `belief_policy.confidence_calibration` | overconfident=70; calibrated=2; underconfident=0 | 97.2% | **RED: >80% single value** |
| `aspirations.minimum_core_coverage` | high=25; medium=32; low=15 | 44.4% |  |
| `aspirations.acceptable_margin` | high=41; medium=27; low=4 | 56.9% |  |
| `aspirations.nre_tolerance` | high=25; medium=11; low=36 | 50.0% |  |
| `aspirations.price_position` | premium=33; mid=32; budget=7 | 45.8% |  |
| `search_policy.breadth` | narrow=53; wide=19 | 73.6% |  |
| `search_policy.stop_rule` | first_satisfying=60; compare_few=5; exhaustive=7 | 83.3% | **RED: >80% single value** |
| `risk_policy.market_uncertainty_tolerance` | high=36; medium=7; low=29 | 50.0% |  |
| `risk_policy.technical_uncertainty_tolerance` | high=19; medium=11; low=42 | 58.3% |  |
| `constraint_policy.dependency_check_depth` | full=34; partial=6; minimal=32 | 47.2% |  |
| `constraint_policy.assumes_teammate_checked` | high=26; low=46 | 63.9% |  |
| `search_policy.revise_if_below_aspiration` | true=54; false=18 | 75.0% |  |

## 2. 原型模态表

| field | 草根老板 | 二代接班人 | 互联网PM转型 | 技术创业者 | 体制转型者 | 销售铁军 | 职业经理人 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `attention.customer_visible_value` | high | high | high | low | low | high | high |
| `attention.technical_dependencies` | low | low | medium | high | medium | low | medium |
| `attention.cost_structure` | high | low | medium | low | medium | medium | high |
| `attention.brand_signal` | low | high | medium | low | medium | medium | medium |
| `attention.constraint_checking` | low | low | low | high | high | low | high |
| `belief_policy.wtp_anchor_style` | gut_feel | premium_analogy | report_numbers | gut_feel | report_numbers | gut_feel | report_numbers |
| `belief_policy.trust_in_reports` | low | medium | high | high | high | low | high |
| `belief_policy.confidence_calibration` | overconfident | overconfident | overconfident | overconfident | overconfident | overconfident | overconfident |
| `aspirations.minimum_core_coverage` | medium | low | high | low | medium | high | medium |
| `aspirations.acceptable_margin` | high | high | high | high | medium | medium | high |
| `aspirations.nre_tolerance` | high | high | medium | high | low | low | low |
| `aspirations.price_position` | budget | premium | mid | premium | mid | mid | premium |
| `search_policy.breadth` | narrow | wide | wide | narrow | narrow | narrow | narrow |
| `search_policy.stop_rule` | first_satisfying | first_satisfying | first_satisfying | exhaustive | first_satisfying | first_satisfying | first_satisfying |
| `risk_policy.market_uncertainty_tolerance` | high | high | high | low | low | high | low |
| `risk_policy.technical_uncertainty_tolerance` | low | low | medium | high | low | low | low |
| `constraint_policy.dependency_check_depth` | minimal | minimal | minimal | full | full | minimal | full |
| `constraint_policy.assumes_teammate_checked` | low | high | low | low | low | low | low |
| `search_policy.revise_if_below_aspiration` | true | true | true | true | false | true | true |

## 3. 自动标红

- **RED** belief_policy.confidence_calibration: 70/72
- **RED** search_policy.stop_rule: 60/72

## 4. 原型分化检查

- `aspirations.nre_tolerance`: 通过（high, medium, low）。
- `aspirations.price_position`: 通过（budget, premium, mid）。
- `constraint_policy.dependency_check_depth`: 通过（minimal, full）。
- `attention.cost_structure`: 通过（high, low, medium）。
- 四个重点字段均存在原型模态分化。
