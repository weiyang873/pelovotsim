# formal_v3_dimension_satisfice_min6_42_2026-07-30 Summary

SYNTHETIC. Report only. Formal-global baseline first, then six-dimension D4+satisfice min6 + formal D5.

## Baseline Replay Gate

- Source: `formal_v3_rerun_flash_2026-07-29` / 42 OK rows.
- Stored formal result: 30/42 profitable, loss_rate=28.57%.
- Current-code replay rows: 42; exact profit/loss match=YES.
- Interpretation gate: chat rows are interpretable only against this formal/global 42-chain source, not against the fixed child-grid controls.

## Format Comparison

| arm | n | profitable | loss_rate | unique_configs | price_mean | price_sd | price_range | cards_mean | cards_range | profit_mean |
|---|---:|---:|---:|---:|---:|---:|---|---:|---|---:|
| formal grid source | 42 | 30 | 28.57% | 42 | 2736 | 881.8 | 1000-4900 | 8.69 | 6-11 | 9340582 |
| six-dimension D4+satisfice min6 + formal D5 | 42 | 16 | 61.9% | 41 | 2662 | 902.6 | 1000-4800 | 13.6 | 8-21 | 723997 |

## Paired Flip Audit

- same profit: 12
- same loss: 8
- formal profit → chat loss: 18
- formal loss → chat profit: 4
- D4 attempts distribution: {"10":24,"11":7,"12":8,"13":1,"14":2}
- D5 attempts distribution: {"1":39,"2":3}

## Paired Rows

| chain | persona | cond | rep | base cards | chat cards | base price | chat price | base profit | chat profit | base loss | chat loss |
|---|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| A|Q|1 | 草根老板 | Q | 1 | 9 | 14 | 3000 | 1200 | -139604 | -5554366 | 1 | 1 |
| A|Q|2 | 草根老板 | Q | 2 | 10 | 16 | 1000 | 1500 | -4686200 | -6861265 | 1 | 1 |
| A|Q|3 | 草根老板 | Q | 3 | 10 | 11 | 1500 | 1500 | -1607122 | -8897340 | 1 | 1 |
| A|S|1 | 草根老板 | S | 1 | 7 | 15 | 2900 | 1800 | 1230120 | -4633490 | 0 | 1 |
| A|S|2 | 草根老板 | S | 2 | 8 | 14 | 2900 | 1800 | 1744617 | -2506204 | 0 | 1 |
| A|S|3 | 草根老板 | S | 3 | 9 | 16 | 2900 | 1900 | 9122023 | -3930268 | 0 | 1 |
| D|Q|1 | 二代接班人 | Q | 1 | 9 | 18 | 2900 | 2900 | 1076205 | -10052045 | 0 | 1 |
| D|Q|2 | 二代接班人 | Q | 2 | 9 | 10 | 3000 | 3900 | -1665878 | 2010294 | 1 | 0 |
| D|Q|3 | 二代接班人 | Q | 3 | 8 | 16 | 3900 | 2900 | -3283320 | -5366031 | 1 | 1 |
| D|S|1 | 二代接班人 | S | 1 | 9 | 12 | 4900 | 4200 | 22044351 | 35510498 | 0 | 0 |
| D|S|2 | 二代接班人 | S | 2 | 10 | 18 | 3800 | 3900 | 10756811 | 1639968 | 0 | 0 |
| D|S|3 | 二代接班人 | S | 3 | 10 | 21 | 3200 | 4800 | 18978813 | -5561879 | 0 | 1 |
| E|Q|1 | 体制转型者 | Q | 1 | 8 | 12 | 3800 | 2800 | 13521399 | -2624959 | 0 | 1 |
| E|Q|2 | 体制转型者 | Q | 2 | 10 | 12 | 2800 | 2800 | 51926275 | 925129 | 0 | 0 |
| E|Q|3 | 体制转型者 | Q | 3 | 11 | 18 | 2800 | 2900 | 1388838 | -4830453 | 0 | 1 |
| E|S|1 | 体制转型者 | S | 1 | 8 | 19 | 3800 | 3800 | 29423741 | -1020147 | 0 | 1 |
| E|S|2 | 体制转型者 | S | 2 | 7 | 12 | 2900 | 2900 | 12764057 | -702336 | 0 | 1 |
| E|S|3 | 体制转型者 | S | 3 | 6 | 9 | 4800 | 4800 | 55109296 | 47399262 | 0 | 0 |
| B|Q|1 | 职业经理人 | Q | 1 | 10 | 17 | 2900 | 1900 | 27287884 | -13073949 | 0 | 1 |
| B|Q|2 | 职业经理人 | Q | 2 | 9 | 14 | 1000 | 1000 | -3163273 | -8701038 | 1 | 1 |
| B|Q|3 | 职业经理人 | Q | 3 | 9 | 16 | 2900 | 1900 | 787255 | -12059926 | 0 | 1 |
| B|S|1 | 职业经理人 | S | 1 | 8 | 14 | 1600 | 2800 | 159999 | 4547156 | 0 | 0 |
| B|S|2 | 职业经理人 | S | 2 | 9 | 18 | 1800 | 2900 | 258494 | -3984073 | 0 | 1 |
| B|S|3 | 职业经理人 | S | 3 | 10 | 19 | 2900 | 2900 | -4143648 | -8880244 | 1 | 1 |
| F|Q|1 | 销售铁军 | Q | 1 | 9 | 13 | 1200 | 3400 | -4261972 | 1954418 | 1 | 0 |
| F|Q|2 | 销售铁军 | Q | 2 | 10 | 9 | 2900 | 2900 | 4826421 | 7532264 | 0 | 0 |
| F|Q|3 | 销售铁军 | Q | 3 | 11 | 9 | 3900 | 2900 | 32630514 | 2069533 | 0 | 0 |
| F|S|1 | 销售铁军 | S | 1 | 10 | 12 | 2500 | 2900 | -1823278 | 3723808 | 1 | 0 |
| F|S|2 | 销售铁军 | S | 2 | 10 | 17 | 2900 | 2900 | 2520654 | -11555733 | 0 | 1 |
| F|S|3 | 销售铁军 | S | 3 | 10 | 9 | 2900 | 2900 | 31831788 | 6149986 | 0 | 0 |
| C|Q|1 | 技术创业者 | Q | 1 | 7 | 12 | 2000 | 2000 | 1505149 | -2938013 | 0 | 1 |
| C|Q|2 | 技术创业者 | Q | 2 | 8 | 14 | 1500 | 1500 | -1686406 | -5143684 | 1 | 1 |
| C|Q|3 | 技术创业者 | Q | 3 | 7 | 10 | 2400 | 2400 | 37595451 | 750600 | 0 | 0 |
| C|S|1 | 技术创业者 | S | 1 | 7 | 10 | 2200 | 2900 | 1745810 | 6585808 | 0 | 0 |
| C|S|2 | 技术创业者 | S | 2 | 8 | 8 | 2900 | 2800 | 18895984 | 36718582 | 0 | 0 |
| C|S|3 | 技术创业者 | S | 3 | 6 | 10 | 2800 | 2900 | 2464419 | -305190 | 0 | 1 |
| G|Q|1 | 互联网PM转型 | Q | 1 | 10 | 12 | 1900 | 1000 | -83858 | -6508108 | 1 | 1 |
| G|Q|2 | 互联网PM转型 | Q | 2 | 8 | 14 | 2800 | 1500 | 10208153 | -4395236 | 0 | 1 |
| G|Q|3 | 互联网PM转型 | Q | 3 | 6 | 9 | 1500 | 2500 | -1294037 | 10496497 | 1 | 0 |
| G|S|1 | 互联网PM转型 | S | 1 | 8 | 15 | 2900 | 2900 | 4759216 | -2768071 | 0 | 1 |
| G|S|2 | 互联网PM转型 | S | 2 | 8 | 16 | 2900 | 2900 | 9830187 | -824298 | 0 | 1 |
| G|S|3 | 互联网PM转型 | S | 3 | 9 | 11 | 2900 | 2900 | 3749122 | 6072410 | 0 | 0 |

## Failure Mechanism Audit

| arm | coverCore | coverNice | cover/card | COGS | dCOGS | NRE(wan) | fixedCost | Q/BEQ | P/WTP | actualGm | double_squeeze_n |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| formal grid source | 0.477 | 0.593 | 0.0556 | 1245 | 645 | 195.4 | 3454243 | 3.556 | 0.474 | 0.276 | 8 |
| six-dimension D4+satisfice min6 + formal D5 | 0.538 | 0.708 | 0.0411 | 1626 | 1026 | 318.6 | 4685757 | 2.066 | 0.46 | 0.104 | 9 |

## Controls

- R1 outcome, Coach, D3 summary, D3 evidence signals, target grid, cards manifest, pricing range, compatibility validation, and settlement are inherited from the same formal source row.
- Manipulated factor: D4 six function-dimension calls plus satisficing concern/evaluation/alternative/final; quantity prompt=min6; D5 formal JSON unchanged.
- Quantity policy: min6.
- Invalid, missing, or compatibility-failing outputs get the configured repair budget (5 repairs for this run invocation).
- Settlement uses the same `FullGame.calculateR2` path.
