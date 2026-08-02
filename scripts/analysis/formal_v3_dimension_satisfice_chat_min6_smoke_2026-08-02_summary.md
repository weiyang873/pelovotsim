# formal_v3_dimension_satisfice_chat_min6_smoke_2026-08-02 Summary

SYNTHETIC. Report only. Formal-global baseline first, then six-dimension D4+satisfice min6 chat D4/D5 smoke.

## Baseline Replay Gate

- Source: `formal_v3_rerun_flash_2026-07-29` / 42 OK rows.
- Stored formal result: 30/42 profitable, loss_rate=28.57%.
- Current-code replay rows: 42; exact profit/loss match=YES.
- Interpretation gate: chat rows are interpretable only against this formal/global 42-chain source, not against the fixed child-grid controls.

## Format Comparison

| arm | n | profitable | loss_rate | unique_configs | price_mean | price_sd | price_range | cards_mean | cards_range | profit_mean |
|---|---:|---:|---:|---:|---:|---:|---|---:|---|---:|
| formal grid source | 42 | 30 | 28.57% | 42 | 2736 | 881.8 | 1000-4900 | 8.69 | 6-11 | 9340582 |
| six-dimension D4+satisfice min6 chat D4/D5 smoke | 7 | 3 | 57.14% | 7 | 2957 | 1264.7 | 1400-5400 | 10.71 | 7-13 | -1624292 |

## Paired Flip Audit

- same profit: 1
- same loss: 1
- formal profit → chat loss: 3
- formal loss → chat profit: 2
- D4 attempts distribution: {"10":4,"11":1,"12":2}
- D5 attempts distribution: {"1":7}

## Paired Rows

| chain | persona | cond | rep | base cards | chat cards | base price | chat price | base profit | chat profit | base loss | chat loss |
|---|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| A|Q|1 | 草根老板 | Q | 1 | 9 | 7 | 3000 | 2800 | -139604 | 1347842 | 1 | 0 |
| D|Q|1 | 二代接班人 | Q | 1 | 9 | 10 | 2900 | 3200 | 1076205 | -1514743 | 0 | 1 |
| E|Q|1 | 体制转型者 | Q | 1 | 8 | 12 | 3800 | 5400 | 13521399 | 5029336 | 0 | 0 |
| B|Q|1 | 职业经理人 | Q | 1 | 10 | 13 | 2900 | 2000 | 27287884 | -20898207 | 0 | 1 |
| F|Q|1 | 销售铁军 | Q | 1 | 9 | 9 | 1200 | 3900 | -4261972 | 17684624 | 1 | 0 |
| C|Q|1 | 技术创业者 | Q | 1 | 7 | 12 | 2000 | 2000 | 1505149 | -1342213 | 0 | 1 |
| G|Q|1 | 互联网PM转型 | Q | 1 | 10 | 12 | 1900 | 1400 | -83858 | -11676684 | 1 | 1 |

## Failure Mechanism Audit

| arm | coverCore | coverNice | cover/card | COGS | dCOGS | NRE(wan) | fixedCost | Q/BEQ | P/WTP | actualGm | double_squeeze_n |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| formal grid source | 0.477 | 0.593 | 0.0556 | 1245 | 645 | 195.4 | 3454243 | 3.556 | 0.474 | 0.276 | 8 |
| six-dimension D4+satisfice min6 chat D4/D5 smoke | 0.522 | 0.757 | 0.0486 | 1535 | 935 | 269.7 | 4197000 | 2.069 | 0.51 | 0.172 | 2 |

## Controls

- R1 outcome, Coach, D3 summary, D3 evidence signals, target grid, cards manifest, pricing range, compatibility validation, and settlement are inherited from the same formal source row.
- Manipulated factor: six-function D4 + satisficing min6 with natural-language D4 and chat D5.
- Quantity policy: min6.
- Invalid, missing, or compatibility-failing outputs get the configured repair budget (5 repairs for this run invocation).
- Settlement uses the same `FullGame.calculateR2` path.
