# formal_v3_dimension_satisfice_quantity_robustness_2026-07-30

SYNTHETIC. Report only. Same formal source 42 chains; same six-function D4 + satisficing runner; only quantity wording differs: `min6` vs `unlimited`.

## Arm Summary

| arm | n | loss_rate | profitable | unique_configs | price_mean | price_sd | price_range | cards_mean | cards_range | profit_mean | coverCore | cover/card | COGS | NRE(wan) | Q/BEQ | P/WTP | double_squeeze |
|---|---:|---:|---:|---:|---:|---:|---|---:|---|---:|---:|---:|---:|---:|---:|---:|---:|
| formal baseline | 42 | 28.57% | 30 | 42 | 2736 | 881.8 | 1000-4900 | 8.69 | 6-11 | 9340582 | 0.477 | 0.0556 | 1245 | 195.4 | 3.556 | 0.474 | 8 |
| six-dimension D4 only | 42 | 52.38% | 20 | 42 | 2826 | 1002.4 | 1000-4900 | 12.38 | 8-17 | 1730721 | 0.521 | 0.0427 | 1544 | 282.4 | 1.748 | 0.489 | 12 |
| six-dimension D4+satisfice min6 | 42 | 61.9% | 16 | 41 | 2662 | 902.6 | 1000-4800 | 13.6 | 8-21 | 723997 | 0.538 | 0.0411 | 1626 | 318.6 | 2.066 | 0.46 | 9 |
| six-dimension D4+satisfice unlimited | 42 | 76.19% | 10 | 42 | 2855 | 1058.1 | 1000-5800 | 13.38 | 9-18 | -3607612 | 0.534 | 0.0399 | 1696 | 330.8 | 0.808 | 0.493 | 16 |

## Min6 vs Unlimited Paired Flip

- same profit: 5
- same loss: 21
- min6 loss -> unlimited profit: 5
- min6 profit -> unlimited loss: 11

## Persona Breakdown

| persona | n | min6 loss_rate | unlimited loss_rate | min6 cards | unlimited cards | min6 price_sd | unlimited price_sd | min6 profit_mean | unlimited profit_mean |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 草根老板 | 6 | 100% | 66.67% | 14.33 | 11.5 | 240.9 | 933.5 | -5397155 | -1347618 |
| 二代接班人 | 6 | 50% | 66.67% | 15.83 | 15.33 | 682.3 | 411 | 3030134 | -3744787 |
| 体制转型者 | 6 | 66.67% | 66.67% | 13.67 | 14.17 | 743.1 | 1327.2 | 6524416 | -471428 |
| 职业经理人 | 6 | 83.33% | 100% | 16.33 | 14.67 | 701.6 | 561.7 | -7025346 | -8744916 |
| 销售铁军 | 6 | 16.67% | 83.33% | 11.5 | 15 | 186.3 | 160.7 | 1645713 | -6867123 |
| 技术创业者 | 6 | 50% | 66.67% | 10.67 | 11.83 | 520.9 | 1149.9 | 5944684 | 259491 |
| 互联网PM转型 | 6 | 66.67% | 83.33% | 12.83 | 11.17 | 758.1 | 508.8 | 345532 | -4336902 |

## Readout

- Baseline latest-42 gate: loss_rate=28.57%, cards_mean=8.69, Q/BEQ=3.556. Six-dimension D4 alone raises loss_rate to 52.38%.
- Adding D4+satisfice keeps the result high-loss under both quantity prompts: min6 loss_rate=61.9%, unlimited loss_rate=76.19%.
- Unlimited selects slightly fewer cards on average than min6 in this run (13.38 vs 13.6) but has worse loss_rate (76.19% vs 61.9%), lower Q/BEQ (0.808 vs 2.066), and higher double-squeeze count (16 vs 9).
- The effect is heterogeneous: unlimited repairs 5 min6 losses but creates 11 new losses from min6 profits.
- Interpretation: the robust high-loss result is not just an explicit upper-bound artifact. The deeper mechanism is six local function-area decisions plus a satisficing repair loop increasing fixed cost and lowering coverage efficiency; quantity wording modulates which subjects cross the loss boundary.

## Files

- Min6 run: `formal_v3_dimension_satisfice_min6_42_2026-07-30.*`
- Unlimited run: `formal_v3_dimension_satisfice_unlimited_42_2026-07-30.*`
- Comparison CSV: `formal_v3_dimension_satisfice_quantity_robustness_2026-07-30_comparison.csv`
- Persona CSV: `formal_v3_dimension_satisfice_quantity_robustness_2026-07-30_persona.csv`
