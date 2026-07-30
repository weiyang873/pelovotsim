# formal_v3_dimension_satisfice_unlimited_42_2026-07-30 Summary

SYNTHETIC. Report only. Formal-global baseline first, then six-dimension D4+satisfice unlimited + formal D5.

## Baseline Replay Gate

- Source: `formal_v3_rerun_flash_2026-07-29` / 42 OK rows.
- Stored formal result: 30/42 profitable, loss_rate=28.57%.
- Current-code replay rows: 42; exact profit/loss match=YES.
- Interpretation gate: chat rows are interpretable only against this formal/global 42-chain source, not against the fixed child-grid controls.

## Format Comparison

| arm | n | profitable | loss_rate | unique_configs | price_mean | price_sd | price_range | cards_mean | cards_range | profit_mean |
|---|---:|---:|---:|---:|---:|---:|---|---:|---|---:|
| formal grid source | 42 | 30 | 28.57% | 42 | 2736 | 881.8 | 1000-4900 | 8.69 | 6-11 | 9340582 |
| six-dimension D4+satisfice unlimited + formal D5 | 42 | 10 | 76.19% | 42 | 2855 | 1058.1 | 1000-5800 | 13.38 | 9-18 | -3607612 |

## Paired Flip Audit

- same profit: 7
- same loss: 9
- formal profit → chat loss: 23
- formal loss → chat profit: 3
- D4 attempts distribution: {"10":17,"11":12,"12":12,"13":1}
- D5 attempts distribution: {"1":37,"2":5}

## Paired Rows

| chain | persona | cond | rep | base cards | chat cards | base price | chat price | base profit | chat profit | base loss | chat loss |
|---|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| A|Q|1 | 草根老板 | Q | 1 | 9 | 11 | 3000 | 1800 | -139604 | -753814 | 1 | 1 |
| A|Q|2 | 草根老板 | Q | 2 | 10 | 12 | 1000 | 3900 | -4686200 | 148347 | 1 | 0 |
| A|Q|3 | 草根老板 | Q | 3 | 10 | 12 | 1500 | 1900 | -1607122 | -1393364 | 1 | 1 |
| A|S|1 | 草根老板 | S | 1 | 7 | 13 | 2900 | 2800 | 1230120 | -1917477 | 0 | 1 |
| A|S|2 | 草根老板 | S | 2 | 8 | 9 | 2900 | 1000 | 1744617 | -4987184 | 0 | 1 |
| A|S|3 | 草根老板 | S | 3 | 9 | 12 | 2900 | 2900 | 9122023 | 817781 | 0 | 0 |
| D|Q|1 | 二代接班人 | Q | 1 | 9 | 14 | 2900 | 3500 | 1076205 | 4843288 | 0 | 0 |
| D|Q|2 | 二代接班人 | Q | 2 | 9 | 11 | 3000 | 3900 | -1665878 | 563208 | 1 | 0 |
| D|Q|3 | 二代接班人 | Q | 3 | 8 | 16 | 3900 | 3900 | -3283320 | -1778565 | 1 | 1 |
| D|S|1 | 二代接班人 | S | 1 | 9 | 17 | 4900 | 2900 | 22044351 | -13727026 | 0 | 1 |
| D|S|2 | 二代接班人 | S | 2 | 10 | 17 | 3800 | 3600 | 10756811 | -6029644 | 0 | 1 |
| D|S|3 | 二代接班人 | S | 3 | 10 | 17 | 3200 | 4200 | 18978813 | -6339986 | 0 | 1 |
| E|Q|1 | 体制转型者 | Q | 1 | 8 | 13 | 3800 | 2800 | 13521399 | -3198358 | 0 | 1 |
| E|Q|2 | 体制转型者 | Q | 2 | 10 | 15 | 2800 | 2800 | 51926275 | -2735658 | 0 | 1 |
| E|Q|3 | 体制转型者 | Q | 3 | 11 | 17 | 2800 | 2900 | 1388838 | -6859291 | 0 | 1 |
| E|S|1 | 体制转型者 | S | 1 | 8 | 14 | 3800 | 4800 | 29423741 | 6477437 | 0 | 0 |
| E|S|2 | 体制转型者 | S | 2 | 7 | 12 | 2900 | 2000 | 12764057 | -3446554 | 0 | 1 |
| E|S|3 | 体制转型者 | S | 3 | 6 | 14 | 4800 | 5800 | 55109296 | 6933855 | 0 | 0 |
| B|Q|1 | 职业经理人 | Q | 1 | 10 | 15 | 2900 | 1900 | 27287884 | -8904007 | 0 | 1 |
| B|Q|2 | 职业经理人 | Q | 2 | 9 | 13 | 1000 | 1000 | -3163273 | -8082326 | 1 | 1 |
| B|Q|3 | 职业经理人 | Q | 3 | 9 | 16 | 2900 | 1900 | 787255 | -13038103 | 0 | 1 |
| B|S|1 | 职业经理人 | S | 1 | 8 | 12 | 1600 | 1600 | 159999 | -3089360 | 0 | 1 |
| B|S|2 | 职业经理人 | S | 2 | 9 | 14 | 1800 | 1900 | 258494 | -9616188 | 0 | 1 |
| B|S|3 | 职业经理人 | S | 3 | 10 | 18 | 2900 | 2900 | -4143648 | -9739511 | 1 | 1 |
| F|Q|1 | 销售铁军 | Q | 1 | 9 | 12 | 1200 | 3300 | -4261972 | 328013 | 1 | 0 |
| F|Q|2 | 销售铁军 | Q | 2 | 10 | 18 | 2900 | 2900 | 4826421 | -8199769 | 0 | 1 |
| F|Q|3 | 销售铁军 | Q | 3 | 11 | 12 | 3900 | 2900 | 32630514 | -3310256 | 0 | 1 |
| F|S|1 | 销售铁军 | S | 1 | 10 | 16 | 2500 | 2900 | -1823278 | -5226878 | 1 | 1 |
| F|S|2 | 销售铁军 | S | 2 | 10 | 15 | 2900 | 2900 | 2520654 | -12011037 | 0 | 1 |
| F|S|3 | 销售铁军 | S | 3 | 10 | 17 | 2900 | 2800 | 31831788 | -12782811 | 0 | 1 |
| C|Q|1 | 技术创业者 | Q | 1 | 7 | 11 | 2000 | 2000 | 1505149 | -2238473 | 0 | 1 |
| C|Q|2 | 技术创业者 | Q | 2 | 8 | 12 | 1500 | 5000 | -1686406 | -2002310 | 1 | 1 |
| C|Q|3 | 技术创业者 | Q | 3 | 7 | 9 | 2400 | 5000 | 37595451 | 4845400 | 0 | 0 |
| C|S|1 | 技术创业者 | S | 1 | 7 | 13 | 2200 | 2900 | 1745810 | -2896360 | 0 | 1 |
| C|S|2 | 技术创业者 | S | 2 | 8 | 13 | 2900 | 2900 | 18895984 | 6141744 | 0 | 0 |
| C|S|3 | 技术创业者 | S | 3 | 6 | 13 | 2800 | 2800 | 2464419 | -2293057 | 0 | 1 |
| G|Q|1 | 互联网PM转型 | Q | 1 | 10 | 12 | 1900 | 2000 | -83858 | -1703386 | 1 | 1 |
| G|Q|2 | 互联网PM转型 | Q | 2 | 8 | 11 | 2800 | 2800 | 10208153 | 2785673 | 0 | 0 |
| G|Q|3 | 互联网PM转型 | Q | 3 | 6 | 9 | 1500 | 1500 | -1294037 | -221444 | 1 | 1 |
| G|S|1 | 互联网PM转型 | S | 1 | 8 | 12 | 2900 | 1900 | 4759216 | -3852420 | 0 | 1 |
| G|S|2 | 互联网PM转型 | S | 2 | 8 | 14 | 2900 | 1900 | 9830187 | -22074390 | 0 | 1 |
| G|S|3 | 互联网PM转型 | S | 3 | 9 | 9 | 2900 | 2900 | 3749122 | -955445 | 0 | 1 |

## Failure Mechanism Audit

| arm | coverCore | coverNice | cover/card | COGS | dCOGS | NRE(wan) | fixedCost | Q/BEQ | P/WTP | actualGm | double_squeeze_n |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| formal grid source | 0.477 | 0.593 | 0.0556 | 1245 | 645 | 195.4 | 3454243 | 3.556 | 0.474 | 0.276 | 8 |
| six-dimension D4+satisfice unlimited + formal D5 | 0.534 | 0.677 | 0.0399 | 1696 | 1096 | 330.8 | 4808457 | 0.808 | 0.493 | 0.117 | 16 |

## Controls

- R1 outcome, Coach, D3 summary, D3 evidence signals, target grid, cards manifest, pricing range, compatibility validation, and settlement are inherited from the same formal source row.
- Manipulated factor: D4 six function-dimension calls plus satisficing concern/evaluation/alternative/final; quantity prompt=unlimited; D5 formal JSON unchanged.
- Quantity policy: unlimited.
- Invalid, missing, or compatibility-failing outputs get the configured repair budget (2 repairs for this run invocation).
- Settlement uses the same `FullGame.calculateR2` path.
