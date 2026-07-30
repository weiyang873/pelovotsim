# formal_v3_rerun_flash_satisfice_chat_paired_2026-07-29 Summary

SYNTHETIC. Report only. Formal-global baseline first, then paired satisfice D4 + chat D5.

## Baseline Replay Gate

- Source: `formal_v3_rerun_flash_2026-07-29` / 42 OK rows.
- Stored formal result: 30/42 profitable, loss_rate=28.57%.
- Current-code replay rows: 42; exact profit/loss match=YES.
- Interpretation gate: chat rows are interpretable only against this formal/global 42-chain source, not against the fixed child-grid controls.

## Format Comparison

| arm | n | profitable | loss_rate | unique_configs | price_mean | price_sd | price_range | cards_mean | cards_range | profit_mean |
|---|---:|---:|---:|---:|---:|---:|---|---:|---|---:|
| formal grid source | 42 | 30 | 28.57% | 42 | 2736 | 881.8 | 1000-4900 | 8.69 | 6-11 | 9340582 |
| paired satisfice D4 + chat D5 | 41 | 29 | 29.27% | 40 | 2800 | 1134 | 1000-5900 | 8.49 | 6-11 | 4111734 |

## Paired Flip Audit

- same profit: 25
- same loss: 7
- formal profit → chat loss: 5
- formal loss → chat profit: 4
- D4 attempts distribution: {"1":38,"2":3}
- D5 attempts distribution: {"1":41}

## Paired Rows

| chain | persona | cond | rep | base cards | chat cards | base price | chat price | base profit | chat profit | base loss | chat loss |
|---|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| A|Q|1 | 草根老板 | Q | 1 | 9 | 8 | 3000 | 2900 | -139604 | -896732 | 1 | 1 |
| A|Q|2 | 草根老板 | Q | 2 | 10 | 11 | 1000 | 1800 | -4686200 | 422790 | 1 | 0 |
| A|Q|3 | 草根老板 | Q | 3 | 10 | 10 | 1500 | 2600 | -1607122 | -1667376 | 1 | 1 |
| A|S|1 | 草根老板 | S | 1 | 7 | 6 | 2900 | 2800 | 1230120 | 3112620 | 0 | 0 |
| A|S|2 | 草根老板 | S | 2 | 8 | 8 | 2900 | 2000 | 1744617 | 5543946 | 0 | 0 |
| A|S|3 | 草根老板 | S | 3 | 9 | 9 | 2900 | 1500 | 9122023 | 836317 | 0 | 0 |
| D|Q|1 | 二代接班人 | Q | 1 | 9 | 11 | 2900 | 4300 | 1076205 | 1161090 | 0 | 0 |
| D|Q|2 | 二代接班人 | Q | 2 | 9 | 9 | 3000 | 3800 | -1665878 | 2585195 | 1 | 0 |
| D|Q|3 | 二代接班人 | Q | 3 | 8 | 7 | 3900 | 3800 | -3283320 | -1993258 | 1 | 1 |
| D|S|1 | 二代接班人 | S | 1 | 9 | 10 | 4900 | 3600 | 22044351 | 9148129 | 0 | 0 |
| D|S|2 | 二代接班人 | S | 2 | 10 | 9 | 3800 | 2600 | 10756811 | 8332911 | 0 | 0 |
| D|S|3 | 二代接班人 | S | 3 | 10 | 10 | 3200 | 4000 | 18978813 | 17396465 | 0 | 0 |
| E|Q|1 | 体制转型者 | Q | 1 | 8 | 8 | 3800 | 4800 | 13521399 | 5116913 | 0 | 0 |
| E|Q|2 | 体制转型者 | Q | 2 | 10 | 9 | 2800 | 3800 | 51926275 | 19772541 | 0 | 0 |
| E|Q|3 | 体制转型者 | Q | 3 | 11 | 10 | 2800 | 3000 | 1388838 | 7246201 | 0 | 0 |
| E|S|1 | 体制转型者 | S | 1 | 8 | 8 | 3800 | 4200 | 29423741 | 29302651 | 0 | 0 |
| E|S|2 | 体制转型者 | S | 2 | 7 | 7 | 2900 | 1800 | 12764057 | 1281066 | 0 | 0 |
| E|S|3 | 体制转型者 | S | 3 | 6 | 6 | 4800 | 4800 | 55109296 | 3679994 | 0 | 0 |
| B|Q|1 | 职业经理人 | Q | 1 | 10 | 9 | 2900 | 2000 | 27287884 | 2002994 | 0 | 0 |
| B|Q|2 | 职业经理人 | Q | 2 | 9 | 9 | 1000 | 1300 | -3163273 | 95484 | 1 | 0 |
| B|Q|3 | 职业经理人 | Q | 3 | 9 | 8 | 2900 | 1300 | 787255 | -3120755 | 0 | 1 |
| B|S|1 | 职业经理人 | S | 1 | 8 | 9 | 1600 | 1000 | 159999 | -2954139 | 0 | 1 |
| B|S|2 | 职业经理人 | S | 2 | 9 | 8 | 1800 | 1600 | 258494 | 246544 | 0 | 0 |
| B|S|3 | 职业经理人 | S | 3 | 10 | 10 | 2900 | 2000 | -4143648 | -4756969 | 1 | 1 |
| F|Q|1 | 销售铁军 | Q | 1 | 9 | 9 | 1200 | 1600 | -4261972 | -2477425 | 1 | 1 |
| F|Q|2 | 销售铁军 | Q | 2 | 10 | 9 | 2900 | 2900 | 4826421 | 15542330 | 0 | 0 |
| F|Q|3 | 销售铁军 | Q | 3 | 11 | 9 | 3900 | 2800 | 32630514 | -293322 | 0 | 1 |
| F|S|1 | 销售铁军 | S | 1 | 10 | 9 | 2500 | 3000 | -1823278 | 27835572 | 1 | 0 |
| F|S|2 | 销售铁军 | S | 2 | 10 | 10 | 2900 | 3600 | 2520654 | 14223278 | 0 | 0 |
| F|S|3 | 销售铁军 | S | 3 | 10 | 9 | 2900 | 3000 | 31831788 | 3214422 | 0 | 0 |
| C|Q|1 | 技术创业者 | Q | 1 | 7 | 7 | 2000 | 3500 | 1505149 | 1443704 | 0 | 0 |
| C|Q|2 | 技术创业者 | Q | 2 | 8 | 7 | 1500 | 1500 | -1686406 | -911575 | 1 | 1 |
| C|Q|3 | 技术创业者 | Q | 3 | 7 | 7 | 2400 | 5900 | 37595451 | 4683149 | 0 | 0 |
| C|S|1 | 技术创业者 | S | 1 | 7 | 9 | 2200 | 2000 | 1745810 | 2426450 | 0 | 0 |
| C|S|2 | 技术创业者 | S | 2 | 8 | 9 | 2900 | 3000 | 18895984 | 1989625 | 0 | 0 |
| C|S|3 | 技术创业者 | S | 3 | 6 | 8 | 2800 | 3300 | 2464419 | -130582 | 0 | 1 |
| G|Q|2 | 互联网PM转型 | Q | 2 | 8 | 8 | 2800 | 1500 | 10208153 | 270380 | 0 | 0 |
| G|Q|3 | 互联网PM转型 | Q | 3 | 6 | 7 | 1500 | 4000 | -1294037 | -1058591 | 1 | 1 |
| G|S|1 | 互联网PM转型 | S | 1 | 8 | 7 | 2900 | 2400 | 4759216 | 741220 | 0 | 0 |
| G|S|2 | 互联网PM转型 | S | 2 | 8 | 8 | 2900 | 1500 | 9830187 | -1829390 | 0 | 1 |
| G|S|3 | 互联网PM转型 | S | 3 | 9 | 7 | 2900 | 2000 | 3749122 | 1017208 | 0 | 0 |

## Controls

- R1 outcome, Coach, D3 summary, D3 evidence signals, target grid, cards manifest, pricing range, compatibility validation, and settlement are inherited from the same formal source row.
- Chat D4 is natural language but must end with a parseable `cap_id@tier` line; invalid/missing/compatibility-failing outputs get the same repair budget as formal JSON (2 repairs).
- Chat D5 is natural language and parsed by the final 1000-6000 number; settlement uses the same `FullGame.calculateR2` path.
