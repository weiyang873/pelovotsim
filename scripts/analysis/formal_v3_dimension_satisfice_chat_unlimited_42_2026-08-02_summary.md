# formal_v3_dimension_satisfice_chat_unlimited_42_2026-08-02 Summary

SYNTHETIC. Report only. Formal-global baseline first, then six-dimension D4+satisfice unlimited chat D4/D5.

## Baseline Replay Gate

- Source: `formal_v3_rerun_flash_2026-07-29` / 42 OK rows.
- Stored formal result: 30/42 profitable, loss_rate=28.57%.
- Current-code replay rows: 42; exact profit/loss match=YES.
- Interpretation gate: chat rows are interpretable only against this formal/global 42-chain source, not against the fixed child-grid controls.

## Format Comparison

| arm | n | profitable | loss_rate | unique_configs | price_mean | price_sd | price_range | cards_mean | cards_range | profit_mean |
|---|---:|---:|---:|---:|---:|---:|---|---:|---|---:|
| formal grid source | 42 | 30 | 28.57% | 42 | 2736 | 881.8 | 1000-4900 | 8.69 | 6-11 | 9340582 |
| six-dimension D4+satisfice unlimited chat D4/D5 | 42 | 20 | 52.38% | 42 | 3579 | 1081.1 | 1100-6000 | 13.86 | 7-21 | -316289 |

## Paired Flip Audit

- same profit: 12
- same loss: 4
- formal profit → chat loss: 18
- formal loss → chat profit: 8
- D4 attempts distribution: {"10":28,"11":10,"12":3,"13":1}
- D5 attempts distribution: {"1":42}

## Paired Rows

| chain | persona | cond | rep | base cards | chat cards | base price | chat price | base profit | chat profit | base loss | chat loss |
|---|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| A|Q|1 | 草根老板 | Q | 1 | 9 | 13 | 3000 | 3400 | -139604 | 4162331 | 1 | 0 |
| A|Q|2 | 草根老板 | Q | 2 | 10 | 13 | 1000 | 2200 | -4686200 | 5337950 | 1 | 0 |
| A|Q|3 | 草根老板 | Q | 3 | 10 | 11 | 1500 | 4200 | -1607122 | 24432570 | 1 | 0 |
| A|S|1 | 草根老板 | S | 1 | 7 | 17 | 2900 | 3800 | 1230120 | -2649194 | 0 | 1 |
| A|S|2 | 草根老板 | S | 2 | 8 | 12 | 2900 | 2600 | 1744617 | 5226390 | 0 | 0 |
| A|S|3 | 草根老板 | S | 3 | 9 | 13 | 2900 | 4000 | 9122023 | 10775281 | 0 | 0 |
| D|Q|1 | 二代接班人 | Q | 1 | 9 | 18 | 2900 | 3200 | 1076205 | -9321544 | 0 | 1 |
| D|Q|2 | 二代接班人 | Q | 2 | 9 | 14 | 3000 | 3000 | -1665878 | 9442082 | 1 | 0 |
| D|Q|3 | 二代接班人 | Q | 3 | 8 | 13 | 3900 | 4000 | -3283320 | 3934332 | 1 | 0 |
| D|S|1 | 二代接班人 | S | 1 | 9 | 21 | 4900 | 3200 | 22044351 | -18031929 | 0 | 1 |
| D|S|2 | 二代接班人 | S | 2 | 10 | 19 | 3800 | 4600 | 10756811 | -6668876 | 0 | 1 |
| D|S|3 | 二代接班人 | S | 3 | 10 | 19 | 3200 | 4200 | 18978813 | -4190662 | 0 | 1 |
| E|Q|1 | 体制转型者 | Q | 1 | 8 | 11 | 3800 | 4800 | 13521399 | 4309182 | 0 | 0 |
| E|Q|2 | 体制转型者 | Q | 2 | 10 | 17 | 2800 | 4600 | 51926275 | -30463 | 0 | 1 |
| E|Q|3 | 体制转型者 | Q | 3 | 11 | 16 | 2800 | 4600 | 1388838 | -4462924 | 0 | 1 |
| E|S|1 | 体制转型者 | S | 1 | 8 | 14 | 3800 | 4700 | 29423741 | 1531350 | 0 | 0 |
| E|S|2 | 体制转型者 | S | 2 | 7 | 15 | 2900 | 3400 | 12764057 | -944103 | 0 | 1 |
| E|S|3 | 体制转型者 | S | 3 | 6 | 11 | 4800 | 5000 | 55109296 | 15855527 | 0 | 0 |
| B|Q|1 | 职业经理人 | Q | 1 | 10 | 11 | 2900 | 4000 | 27287884 | 1703614 | 0 | 0 |
| B|Q|2 | 职业经理人 | Q | 2 | 9 | 11 | 1000 | 2800 | -3163273 | 4207169 | 1 | 0 |
| B|Q|3 | 职业经理人 | Q | 3 | 9 | 15 | 2900 | 2400 | 787255 | -8798048 | 0 | 1 |
| B|S|1 | 职业经理人 | S | 1 | 8 | 14 | 1600 | 3900 | 159999 | -1944247 | 0 | 1 |
| B|S|2 | 职业经理人 | S | 2 | 9 | 14 | 1800 | 2900 | 258494 | 756121 | 0 | 0 |
| B|S|3 | 职业经理人 | S | 3 | 10 | 18 | 2900 | 4000 | -4143648 | -5864893 | 1 | 1 |
| F|Q|1 | 销售铁军 | Q | 1 | 9 | 17 | 1200 | 1100 | -4261972 | -22342748 | 1 | 1 |
| F|Q|2 | 销售铁军 | Q | 2 | 10 | 17 | 2900 | 4000 | 4826421 | -4414463 | 0 | 1 |
| F|Q|3 | 销售铁军 | Q | 3 | 11 | 14 | 3900 | 4800 | 32630514 | -1370915 | 0 | 1 |
| F|S|1 | 销售铁军 | S | 1 | 10 | 20 | 2500 | 3200 | -1823278 | -20984763 | 1 | 1 |
| F|S|2 | 销售铁军 | S | 2 | 10 | 17 | 2900 | 5200 | 2520654 | -7637639 | 0 | 1 |
| F|S|3 | 销售铁军 | S | 3 | 10 | 14 | 2900 | 4800 | 31831788 | 15915340 | 0 | 0 |
| C|Q|1 | 技术创业者 | Q | 1 | 7 | 9 | 2000 | 3000 | 1505149 | 3077658 | 0 | 0 |
| C|Q|2 | 技术创业者 | Q | 2 | 8 | 12 | 1500 | 2800 | -1686406 | 19302 | 1 | 0 |
| C|Q|3 | 技术创业者 | Q | 3 | 7 | 10 | 2400 | 6000 | 37595451 | 251466 | 0 | 0 |
| C|S|1 | 技术创业者 | S | 1 | 7 | 15 | 2200 | 3600 | 1745810 | -2504653 | 0 | 1 |
| C|S|2 | 技术创业者 | S | 2 | 8 | 17 | 2900 | 3600 | 18895984 | -1173927 | 0 | 1 |
| C|S|3 | 技术创业者 | S | 3 | 6 | 11 | 2800 | 4000 | 2464419 | 1141332 | 0 | 0 |
| G|Q|1 | 互联网PM转型 | Q | 1 | 10 | 7 | 1900 | 1100 | -83858 | -2881106 | 1 | 1 |
| G|Q|2 | 互联网PM转型 | Q | 2 | 8 | 9 | 2800 | 3900 | 10208153 | 10068667 | 0 | 0 |
| G|Q|3 | 互联网PM转型 | Q | 3 | 6 | 8 | 1500 | 2000 | -1294037 | 16863359 | 1 | 0 |
| G|S|1 | 互联网PM转型 | S | 1 | 8 | 8 | 2900 | 2000 | 4759216 | -996020 | 0 | 1 |
| G|S|2 | 互联网PM转型 | S | 2 | 8 | 15 | 2900 | 3900 | 9830187 | -5539586 | 0 | 1 |
| G|S|3 | 互联网PM转型 | S | 3 | 9 | 12 | 2900 | 1800 | 3749122 | -19542451 | 0 | 1 |

## Failure Mechanism Audit

| arm | coverCore | coverNice | cover/card | COGS | dCOGS | NRE(wan) | fixedCost | Q/BEQ | P/WTP | actualGm | double_squeeze_n |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| formal grid source | 0.477 | 0.593 | 0.0556 | 1245 | 645 | 195.4 | 3454243 | 3.556 | 0.474 | 0.276 | 8 |
| six-dimension D4+satisfice unlimited chat D4/D5 | 0.625 | 0.77 | 0.0462 | 1938 | 1338 | 399 | 5490086 | 1.636 | 0.619 | 0.184 | 4 |

## Controls

- R1 outcome, Coach, D3 summary, D3 evidence signals, target grid, cards manifest, pricing range, compatibility validation, and settlement are inherited from the same formal source row.
- Manipulated factor: six-function D4 + satisficing unlimited with natural-language D4 and chat D5.
- Quantity policy: unlimited.
- Invalid, missing, or compatibility-failing outputs get the configured repair budget (5 repairs for this run invocation).
- Settlement uses the same `FullGame.calculateR2` path.
