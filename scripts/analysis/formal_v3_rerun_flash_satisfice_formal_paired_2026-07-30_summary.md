# formal_v3_rerun_flash_satisfice_formal_paired_2026-07-30 Summary

SYNTHETIC. Report only. Formal-global baseline first, then paired satisfice D4 + formal D5.

## Baseline Replay Gate

- Source: `formal_v3_rerun_flash_2026-07-29` / 42 OK rows.
- Stored formal result: 30/42 profitable, loss_rate=28.57%.
- Current-code replay rows: 42; exact profit/loss match=YES.
- Interpretation gate: chat rows are interpretable only against this formal/global 42-chain source, not against the fixed child-grid controls.

## Format Comparison

| arm | n | profitable | loss_rate | unique_configs | price_mean | price_sd | price_range | cards_mean | cards_range | profit_mean |
|---|---:|---:|---:|---:|---:|---:|---|---:|---|---:|
| formal grid source | 42 | 30 | 28.57% | 42 | 2736 | 881.8 | 1000-4900 | 8.69 | 6-11 | 9340582 |
| paired satisfice D4 + formal D5 | 42 | 28 | 33.33% | 42 | 2674 | 891 | 1000-4900 | 8.55 | 6-11 | 3799808 |

## Paired Flip Audit

- same profit: 24
- same loss: 8
- formal profit → chat loss: 6
- formal loss → chat profit: 4
- D4 attempts distribution: {"1":36,"2":5,"6":1}
- D5 attempts distribution: {"1":37,"2":5}

## Paired Rows

| chain | persona | cond | rep | base cards | chat cards | base price | chat price | base profit | chat profit | base loss | chat loss |
|---|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| A|Q|1 | 草根老板 | Q | 1 | 9 | 9 | 3000 | 1200 | -139604 | -1474390 | 1 | 1 |
| A|Q|2 | 草根老板 | Q | 2 | 10 | 10 | 1000 | 1200 | -4686200 | -4457918 | 1 | 1 |
| A|Q|3 | 草根老板 | Q | 3 | 10 | 10 | 1500 | 2900 | -1607122 | -1740408 | 1 | 1 |
| A|S|1 | 草根老板 | S | 1 | 7 | 9 | 2900 | 2900 | 1230120 | -304075 | 0 | 1 |
| A|S|2 | 草根老板 | S | 2 | 8 | 8 | 2900 | 1600 | 1744617 | 228433 | 0 | 0 |
| A|S|3 | 草根老板 | S | 3 | 9 | 10 | 2900 | 2900 | 9122023 | 2956169 | 0 | 0 |
| D|Q|1 | 二代接班人 | Q | 1 | 9 | 10 | 2900 | 3900 | 1076205 | 955975 | 0 | 0 |
| D|Q|2 | 二代接班人 | Q | 2 | 9 | 7 | 3000 | 3900 | -1665878 | 1513521 | 1 | 0 |
| D|Q|3 | 二代接班人 | Q | 3 | 8 | 8 | 3900 | 3800 | -3283320 | 7607125 | 1 | 0 |
| D|S|1 | 二代接班人 | S | 1 | 9 | 10 | 4900 | 4900 | 22044351 | 12092999 | 0 | 0 |
| D|S|2 | 二代接班人 | S | 2 | 10 | 8 | 3800 | 3900 | 10756811 | 3479133 | 0 | 0 |
| D|S|3 | 二代接班人 | S | 3 | 10 | 10 | 3200 | 3900 | 18978813 | 7328976 | 0 | 0 |
| E|Q|1 | 体制转型者 | Q | 1 | 8 | 8 | 3800 | 2800 | 13521399 | 5694482 | 0 | 0 |
| E|Q|2 | 体制转型者 | Q | 2 | 10 | 9 | 2800 | 2800 | 51926275 | 20292104 | 0 | 0 |
| E|Q|3 | 体制转型者 | Q | 3 | 11 | 11 | 2800 | 2900 | 1388838 | 3395245 | 0 | 0 |
| E|S|1 | 体制转型者 | S | 1 | 8 | 7 | 3800 | 2800 | 29423741 | 19957851 | 0 | 0 |
| E|S|2 | 体制转型者 | S | 2 | 7 | 6 | 2900 | 1500 | 12764057 | 2006600 | 0 | 0 |
| E|S|3 | 体制转型者 | S | 3 | 6 | 8 | 4800 | 4800 | 55109296 | 22527497 | 0 | 0 |
| B|Q|1 | 职业经理人 | Q | 1 | 10 | 10 | 2900 | 2000 | 27287884 | 5155054 | 0 | 0 |
| B|Q|2 | 职业经理人 | Q | 2 | 9 | 8 | 1000 | 1000 | -3163273 | -2514618 | 1 | 1 |
| B|Q|3 | 职业经理人 | Q | 3 | 9 | 8 | 2900 | 1900 | 787255 | -3197302 | 0 | 1 |
| B|S|1 | 职业经理人 | S | 1 | 8 | 9 | 1600 | 1900 | 159999 | 140808 | 0 | 0 |
| B|S|2 | 职业经理人 | S | 2 | 9 | 10 | 1800 | 1900 | 258494 | -377236 | 0 | 1 |
| B|S|3 | 职业经理人 | S | 3 | 10 | 8 | 2900 | 2900 | -4143648 | -1303293 | 1 | 1 |
| F|Q|1 | 销售铁军 | Q | 1 | 9 | 9 | 1200 | 1200 | -4261972 | -4261972 | 1 | 1 |
| F|Q|2 | 销售铁军 | Q | 2 | 10 | 9 | 2900 | 2900 | 4826421 | 2833571 | 0 | 0 |
| F|Q|3 | 销售铁军 | Q | 3 | 11 | 10 | 3900 | 2900 | 32630514 | -455471 | 0 | 1 |
| F|S|1 | 销售铁军 | S | 1 | 10 | 11 | 2500 | 2900 | -1823278 | 2379802 | 1 | 0 |
| F|S|2 | 销售铁军 | S | 2 | 10 | 9 | 2900 | 2900 | 2520654 | -2049311 | 0 | 1 |
| F|S|3 | 销售铁军 | S | 3 | 10 | 9 | 2900 | 2900 | 31831788 | 16137628 | 0 | 0 |
| C|Q|1 | 技术创业者 | Q | 1 | 7 | 6 | 2000 | 2000 | 1505149 | 1310187 | 0 | 0 |
| C|Q|2 | 技术创业者 | Q | 2 | 8 | 9 | 1500 | 2500 | -1686406 | -1167756 | 1 | 1 |
| C|Q|3 | 技术创业者 | Q | 3 | 7 | 7 | 2400 | 2400 | 37595451 | -214605 | 0 | 1 |
| C|S|1 | 技术创业者 | S | 1 | 7 | 8 | 2200 | 2900 | 1745810 | 882116 | 0 | 0 |
| C|S|2 | 技术创业者 | S | 2 | 8 | 8 | 2900 | 2900 | 18895984 | 24841415 | 0 | 0 |
| C|S|3 | 技术创业者 | S | 3 | 6 | 8 | 2800 | 2800 | 2464419 | 2261064 | 0 | 0 |
| G|Q|1 | 互联网PM转型 | Q | 1 | 10 | 7 | 1900 | 1900 | -83858 | -938720 | 1 | 1 |
| G|Q|2 | 互联网PM转型 | Q | 2 | 8 | 8 | 2800 | 2000 | 10208153 | 6016552 | 0 | 0 |
| G|Q|3 | 互联网PM转型 | Q | 3 | 6 | 8 | 1500 | 2800 | -1294037 | 4571023 | 1 | 0 |
| G|S|1 | 互联网PM转型 | S | 1 | 8 | 8 | 2900 | 2400 | 4759216 | 639509 | 0 | 0 |
| G|S|2 | 互联网PM转型 | S | 2 | 8 | 7 | 2900 | 2900 | 9830187 | 2569474 | 0 | 0 |
| G|S|3 | 互联网PM转型 | S | 3 | 9 | 7 | 2900 | 2900 | 3749122 | 4274702 | 0 | 0 |

## Failure Mechanism Audit

| arm | coverCore | coverNice | cover/card | COGS | dCOGS | NRE(wan) | fixedCost | Q/BEQ | P/WTP | actualGm | double_squeeze_n |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| formal grid source | 0.477 | 0.593 | 0.0556 | 1245 | 645 | 195.4 | 3454243 | 3.556 | 0.474 | 0.276 | 8 |
| paired satisfice D4 + formal D5 | 0.43 | 0.488 | 0.0509 | 1124 | 524 | 174.1 | 3240600 | 2.092 | 0.463 | 0.313 | 11 |

## Controls

- R1 outcome, Coach, D3 summary, D3 evidence signals, target grid, cards manifest, pricing range, compatibility validation, and settlement are inherited from the same formal source row.
- Manipulated factor: D4 satisfice-v1 concerns/default/evaluate/alternatives/final only; formal D5 retained.
- Quantity policy: min6.
- Invalid, missing, or compatibility-failing outputs get the configured repair budget (5 repairs for this run invocation).
- Settlement uses the same `FullGame.calculateR2` path.
