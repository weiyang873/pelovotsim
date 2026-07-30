# formal_v3_rerun_flash_dimension_d4_42_2026-07-30 Summary

SYNTHETIC. Report only. Formal-global baseline first, then paired six-dimension D4 42 + formal D5.

## Baseline Replay Gate

- Source: `formal_v3_rerun_flash_2026-07-29` / 42 OK rows.
- Stored formal result: 30/42 profitable, loss_rate=28.57%.
- Current-code replay rows: 42; exact profit/loss match=YES.
- Interpretation gate: chat rows are interpretable only against this formal/global 42-chain source, not against the fixed child-grid controls.

## Format Comparison

| arm | n | profitable | loss_rate | unique_configs | price_mean | price_sd | price_range | cards_mean | cards_range | profit_mean |
|---|---:|---:|---:|---:|---:|---:|---|---:|---|---:|
| formal grid source | 42 | 30 | 28.57% | 42 | 2736 | 881.8 | 1000-4900 | 8.69 | 6-11 | 9340582 |
| paired six-dimension D4 42 + formal D5 | 42 | 20 | 52.38% | 42 | 2826 | 1002.4 | 1000-4900 | 12.38 | 8-17 | 1730721 |

## Paired Flip Audit

- same profit: 17
- same loss: 9
- formal profit → chat loss: 13
- formal loss → chat profit: 3
- D4 attempts distribution: {"6":36,"7":5,"8":1}
- D5 attempts distribution: {"1":41,"2":1}

## Paired Rows

| chain | persona | cond | rep | base cards | chat cards | base price | chat price | base profit | chat profit | base loss | chat loss |
|---|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| A|Q|1 | 草根老板 | Q | 1 | 9 | 13 | 3000 | 1200 | -139604 | -5133653 | 1 | 1 |
| A|Q|2 | 草根老板 | Q | 2 | 10 | 10 | 1000 | 1500 | -4686200 | -2083097 | 1 | 1 |
| A|Q|3 | 草根老板 | Q | 3 | 10 | 9 | 1500 | 1600 | -1607122 | 238995 | 1 | 0 |
| A|S|1 | 草根老板 | S | 1 | 7 | 13 | 2900 | 2800 | 1230120 | -1580168 | 0 | 1 |
| A|S|2 | 草根老板 | S | 2 | 8 | 10 | 2900 | 3900 | 1744617 | 3231421 | 0 | 0 |
| A|S|3 | 草根老板 | S | 3 | 9 | 15 | 2900 | 1900 | 9122023 | -5850412 | 0 | 1 |
| D|Q|1 | 二代接班人 | Q | 1 | 9 | 15 | 2900 | 3900 | 1076205 | -591463 | 0 | 1 |
| D|Q|2 | 二代接班人 | Q | 2 | 9 | 10 | 3000 | 3900 | -1665878 | 6239410 | 1 | 0 |
| D|Q|3 | 二代接班人 | Q | 3 | 8 | 13 | 3900 | 3900 | -3283320 | -1747830 | 1 | 1 |
| D|S|1 | 二代接班人 | S | 1 | 9 | 17 | 4900 | 4900 | 22044351 | -2783961 | 0 | 1 |
| D|S|2 | 二代接班人 | S | 2 | 10 | 16 | 3800 | 3900 | 10756811 | -3469716 | 0 | 1 |
| D|S|3 | 二代接班人 | S | 3 | 10 | 16 | 3200 | 4900 | 18978813 | 2444989 | 0 | 0 |
| E|Q|1 | 体制转型者 | Q | 1 | 8 | 13 | 3800 | 2800 | 13521399 | 2777388 | 0 | 0 |
| E|Q|2 | 体制转型者 | Q | 2 | 10 | 12 | 2800 | 2800 | 51926275 | 11023928 | 0 | 0 |
| E|Q|3 | 体制转型者 | Q | 3 | 11 | 17 | 2800 | 2900 | 1388838 | -5242408 | 0 | 1 |
| E|S|1 | 体制转型者 | S | 1 | 8 | 13 | 3800 | 4800 | 29423741 | 20607483 | 0 | 0 |
| E|S|2 | 体制转型者 | S | 2 | 7 | 11 | 2900 | 2900 | 12764057 | 2461859 | 0 | 0 |
| E|S|3 | 体制转型者 | S | 3 | 6 | 12 | 4800 | 4800 | 55109296 | 33033686 | 0 | 0 |
| B|Q|1 | 职业经理人 | Q | 1 | 10 | 14 | 2900 | 1900 | 27287884 | -8098003 | 0 | 1 |
| B|Q|2 | 职业经理人 | Q | 2 | 9 | 13 | 1000 | 1000 | -3163273 | -7909184 | 1 | 1 |
| B|Q|3 | 职业经理人 | Q | 3 | 9 | 13 | 2900 | 2900 | 787255 | -2409354 | 0 | 1 |
| B|S|1 | 职业经理人 | S | 1 | 8 | 9 | 1600 | 2900 | 159999 | 3669616 | 0 | 0 |
| B|S|2 | 职业经理人 | S | 2 | 9 | 11 | 1800 | 1800 | 258494 | -827113 | 0 | 1 |
| B|S|3 | 职业经理人 | S | 3 | 10 | 15 | 2900 | 3800 | -4143648 | -2548139 | 1 | 1 |
| F|Q|1 | 销售铁军 | Q | 1 | 9 | 15 | 1200 | 1500 | -4261972 | -8363301 | 1 | 1 |
| F|Q|2 | 销售铁军 | Q | 2 | 10 | 11 | 2900 | 2900 | 4826421 | 4113049 | 0 | 0 |
| F|Q|3 | 销售铁军 | Q | 3 | 11 | 9 | 3900 | 2900 | 32630514 | 125376 | 0 | 0 |
| F|S|1 | 销售铁军 | S | 1 | 10 | 16 | 2500 | 2400 | -1823278 | -11547091 | 1 | 1 |
| F|S|2 | 销售铁军 | S | 2 | 10 | 15 | 2900 | 2900 | 2520654 | -6362276 | 0 | 1 |
| F|S|3 | 销售铁军 | S | 3 | 10 | 10 | 2900 | 2900 | 31831788 | 35847546 | 0 | 0 |
| C|Q|1 | 技术创业者 | Q | 1 | 7 | 10 | 2000 | 2000 | 1505149 | -945459 | 0 | 1 |
| C|Q|2 | 技术创业者 | Q | 2 | 8 | 10 | 1500 | 1500 | -1686406 | -2728782 | 1 | 1 |
| C|Q|3 | 技术创业者 | Q | 3 | 7 | 9 | 2400 | 2400 | 37595451 | 9918956 | 0 | 0 |
| C|S|1 | 技术创业者 | S | 1 | 7 | 12 | 2200 | 2900 | 1745810 | 242507 | 0 | 0 |
| C|S|2 | 技术创业者 | S | 2 | 8 | 12 | 2900 | 2900 | 18895984 | 4644265 | 0 | 0 |
| C|S|3 | 技术创业者 | S | 3 | 6 | 11 | 2800 | 2800 | 2464419 | -785790 | 0 | 1 |
| G|Q|1 | 互联网PM转型 | Q | 1 | 10 | 14 | 1900 | 2900 | -83858 | -377001 | 1 | 1 |
| G|Q|2 | 互联网PM转型 | Q | 2 | 8 | 10 | 2800 | 1500 | 10208153 | -467754 | 0 | 1 |
| G|Q|3 | 互联网PM转型 | Q | 3 | 6 | 8 | 1500 | 2000 | -1294037 | 4098802 | 1 | 0 |
| G|S|1 | 互联网PM转型 | S | 1 | 8 | 12 | 2900 | 2900 | 4759216 | 1917865 | 0 | 0 |
| G|S|2 | 互联网PM转型 | S | 2 | 8 | 14 | 2900 | 2900 | 9830187 | 1683458 | 0 | 0 |
| G|S|3 | 互联网PM转型 | S | 3 | 9 | 12 | 2900 | 2900 | 3749122 | 6221626 | 0 | 0 |

## Failure Mechanism Audit

| arm | coverCore | coverNice | cover/card | COGS | dCOGS | NRE(wan) | fixedCost | Q/BEQ | P/WTP | actualGm | double_squeeze_n |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| formal grid source | 0.477 | 0.593 | 0.0556 | 1245 | 645 | 195.4 | 3454243 | 3.556 | 0.474 | 0.276 | 8 |
| paired six-dimension D4 42 + formal D5 | 0.521 | 0.68 | 0.0427 | 1544 | 944 | 282.4 | 4323886 | 1.748 | 0.489 | 0.177 | 12 |

## Controls

- R1 outcome, Coach, D3 summary, D3 evidence signals, target grid, cards manifest, pricing range, compatibility validation, and settlement are inherited from the same formal source row.
- Manipulated factor: D4 split into six function-dimension selection calls; one dimension card group visible per call; D5 formal JSON unchanged; global compatibility repair only if merged six-round plan fails validation.
- Invalid, missing, or compatibility-failing outputs get the same repair budget as formal JSON (2 repairs).
- Settlement uses the same `FullGame.calculateR2` path.
