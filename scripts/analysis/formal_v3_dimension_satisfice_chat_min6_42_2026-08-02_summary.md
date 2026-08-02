# formal_v3_dimension_satisfice_chat_min6_42_2026-08-02 Summary

SYNTHETIC. Report only. Formal-global baseline first, then six-dimension D4+satisfice min6 chat D4/D5.

## Baseline Replay Gate

- Source: `formal_v3_rerun_flash_2026-07-29` / 42 OK rows.
- Stored formal result: 30/42 profitable, loss_rate=28.57%.
- Current-code replay rows: 42; exact profit/loss match=YES.
- Interpretation gate: chat rows are interpretable only against this formal/global 42-chain source, not against the fixed child-grid controls.

## Format Comparison

| arm | n | profitable | loss_rate | unique_configs | price_mean | price_sd | price_range | cards_mean | cards_range | profit_mean |
|---|---:|---:|---:|---:|---:|---:|---|---:|---|---:|
| formal grid source | 42 | 30 | 28.57% | 42 | 2736 | 881.8 | 1000-4900 | 8.69 | 6-11 | 9340582 |
| six-dimension D4+satisfice min6 chat D4/D5 | 42 | 26 | 38.1% | 42 | 3545 | 1055.4 | 1000-5200 | 11.83 | 7-18 | 4350307 |

## Paired Flip Audit

- same profit: 19
- same loss: 5
- formal profit → chat loss: 11
- formal loss → chat profit: 7
- D4 attempts distribution: {"10":22,"11":8,"12":9,"13":2,"14":1}
- D5 attempts distribution: {"1":41,"2":1}

## Paired Rows

| chain | persona | cond | rep | base cards | chat cards | base price | chat price | base profit | chat profit | base loss | chat loss |
|---|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| A|Q|1 | 草根老板 | Q | 1 | 9 | 8 | 3000 | 2600 | -139604 | 505164 | 1 | 0 |
| A|Q|2 | 草根老板 | Q | 2 | 10 | 9 | 1000 | 2800 | -4686200 | -384388 | 1 | 1 |
| A|Q|3 | 草根老板 | Q | 3 | 10 | 12 | 1500 | 4300 | -1607122 | 1007544 | 1 | 0 |
| A|S|1 | 草根老板 | S | 1 | 7 | 9 | 2900 | 4800 | 1230120 | 870235 | 0 | 0 |
| A|S|2 | 草根老板 | S | 2 | 8 | 11 | 2900 | 2000 | 1744617 | 4838842 | 0 | 0 |
| A|S|3 | 草根老板 | S | 3 | 9 | 8 | 2900 | 2300 | 9122023 | 4434444 | 0 | 0 |
| D|Q|1 | 二代接班人 | Q | 1 | 9 | 16 | 2900 | 4800 | 1076205 | -2683776 | 0 | 1 |
| D|Q|2 | 二代接班人 | Q | 2 | 9 | 10 | 3000 | 3900 | -1665878 | 6454125 | 1 | 0 |
| D|Q|3 | 二代接班人 | Q | 3 | 8 | 14 | 3900 | 4800 | -3283320 | -853636 | 1 | 1 |
| D|S|1 | 二代接班人 | S | 1 | 9 | 14 | 4900 | 4200 | 22044351 | -4709096 | 0 | 1 |
| D|S|2 | 二代接班人 | S | 2 | 10 | 16 | 3800 | 3300 | 10756811 | 2356718 | 0 | 0 |
| D|S|3 | 二代接班人 | S | 3 | 10 | 16 | 3200 | 5200 | 18978813 | 289952 | 0 | 0 |
| E|Q|1 | 体制转型者 | Q | 1 | 8 | 10 | 3800 | 4800 | 13521399 | -127703 | 0 | 1 |
| E|Q|2 | 体制转型者 | Q | 2 | 10 | 13 | 2800 | 4800 | 51926275 | 7777944 | 0 | 0 |
| E|Q|3 | 体制转型者 | Q | 3 | 11 | 18 | 2800 | 3900 | 1388838 | -1612957 | 0 | 1 |
| E|S|1 | 体制转型者 | S | 1 | 8 | 13 | 3800 | 4800 | 29423741 | 27878732 | 0 | 0 |
| E|S|2 | 体制转型者 | S | 2 | 7 | 14 | 2900 | 4400 | 12764057 | 4302427 | 0 | 0 |
| E|S|3 | 体制转型者 | S | 3 | 6 | 8 | 4800 | 4800 | 55109296 | 27920672 | 0 | 0 |
| B|Q|1 | 职业经理人 | Q | 1 | 10 | 10 | 2900 | 2700 | 27287884 | 571706 | 0 | 0 |
| B|Q|2 | 职业经理人 | Q | 2 | 9 | 9 | 1000 | 1000 | -3163273 | -6556630 | 1 | 1 |
| B|Q|3 | 职业经理人 | Q | 3 | 9 | 18 | 2900 | 4000 | 787255 | -3171848 | 0 | 1 |
| B|S|1 | 职业经理人 | S | 1 | 8 | 13 | 1600 | 2400 | 159999 | 928231 | 0 | 0 |
| B|S|2 | 职业经理人 | S | 2 | 9 | 15 | 1800 | 3300 | 258494 | -3132932 | 0 | 1 |
| B|S|3 | 职业经理人 | S | 3 | 10 | 18 | 2900 | 2400 | -4143648 | -10663145 | 1 | 1 |
| F|Q|1 | 销售铁军 | Q | 1 | 9 | 9 | 1200 | 3300 | -4261972 | 1223207 | 1 | 0 |
| F|Q|2 | 销售铁军 | Q | 2 | 10 | 9 | 2900 | 2800 | 4826421 | 7159843 | 0 | 0 |
| F|Q|3 | 销售铁军 | Q | 3 | 11 | 9 | 3900 | 2900 | 32630514 | 4484458 | 0 | 0 |
| F|S|1 | 销售铁军 | S | 1 | 10 | 13 | 2500 | 4000 | -1823278 | -854184 | 1 | 1 |
| F|S|2 | 销售铁军 | S | 2 | 10 | 14 | 2900 | 5200 | 2520654 | -1507553 | 0 | 1 |
| F|S|3 | 销售铁军 | S | 3 | 10 | 9 | 2900 | 3600 | 31831788 | 25951521 | 0 | 0 |
| C|Q|1 | 技术创业者 | Q | 1 | 7 | 8 | 2000 | 3000 | 1505149 | 2312343 | 0 | 0 |
| C|Q|2 | 技术创业者 | Q | 2 | 8 | 10 | 1500 | 3800 | -1686406 | 3156073 | 1 | 0 |
| C|Q|3 | 技术创业者 | Q | 3 | 7 | 8 | 2400 | 3900 | 37595451 | 11144199 | 0 | 0 |
| C|S|1 | 技术创业者 | S | 1 | 7 | 14 | 2200 | 5000 | 1745810 | -2169782 | 0 | 1 |
| C|S|2 | 技术创业者 | S | 2 | 8 | 16 | 2900 | 3200 | 18895984 | 11466769 | 0 | 0 |
| C|S|3 | 技术创业者 | S | 3 | 6 | 15 | 2800 | 4800 | 2464419 | 1030708 | 0 | 0 |
| G|Q|1 | 互联网PM转型 | Q | 1 | 10 | 8 | 1900 | 2000 | -83858 | 8598459 | 1 | 0 |
| G|Q|2 | 互联网PM转型 | Q | 2 | 8 | 7 | 2800 | 2800 | 10208153 | 48584631 | 0 | 0 |
| G|Q|3 | 互联网PM转型 | Q | 3 | 6 | 11 | 1500 | 3000 | -1294037 | 7788758 | 1 | 0 |
| G|S|1 | 互联网PM转型 | S | 1 | 8 | 10 | 2900 | 2000 | 4759216 | -166551 | 0 | 1 |
| G|S|2 | 互联网PM转型 | S | 2 | 8 | 12 | 2900 | 2700 | 9830187 | -1495785 | 0 | 1 |
| G|S|3 | 互联网PM转型 | S | 3 | 9 | 13 | 2900 | 2600 | 3749122 | -234838 | 0 | 1 |

## Failure Mechanism Audit

| arm | coverCore | coverNice | cover/card | COGS | dCOGS | NRE(wan) | fixedCost | Q/BEQ | P/WTP | actualGm | double_squeeze_n |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| formal grid source | 0.477 | 0.593 | 0.0556 | 1245 | 645 | 195.4 | 3454243 | 3.556 | 0.474 | 0.276 | 8 |
| six-dimension D4+satisfice min6 chat D4/D5 | 0.55 | 0.75 | 0.0479 | 1635 | 1035 | 313.9 | 4638757 | 2.177 | 0.613 | 0.282 | 6 |

## Controls

- R1 outcome, Coach, D3 summary, D3 evidence signals, target grid, cards manifest, pricing range, compatibility validation, and settlement are inherited from the same formal source row.
- Manipulated factor: six-function D4 + satisficing min6 with natural-language D4 and chat D5.
- Quantity policy: min6.
- Invalid, missing, or compatibility-failing outputs get the configured repair budget (5 repairs for this run invocation).
- Settlement uses the same `FullGame.calculateR2` path.
