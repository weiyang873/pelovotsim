# formal_v3_rerun_flash_dimension_d4_smoke_2026-07-30 Summary

SYNTHETIC. Report only. Formal-global baseline first, then paired six-dimension D4 + formal D5.

## Baseline Replay Gate

- Source: `formal_v3_rerun_flash_2026-07-29` / 42 OK rows.
- Stored formal result: 30/42 profitable, loss_rate=28.57%.
- Current-code replay rows: 42; exact profit/loss match=YES.
- Interpretation gate: chat rows are interpretable only against this formal/global 42-chain source, not against the fixed child-grid controls.

## Format Comparison

| arm | n | profitable | loss_rate | unique_configs | price_mean | price_sd | price_range | cards_mean | cards_range | profit_mean |
|---|---:|---:|---:|---:|---:|---:|---|---:|---|---:|
| formal grid source | 42 | 30 | 28.57% | 42 | 2736 | 881.8 | 1000-4900 | 8.69 | 6-11 | 9340582 |
| paired six-dimension D4 + formal D5 | 7 | 2 | 71.43% | 7 | 2600 | 1123.8 | 1200-3900 | 11.71 | 10-13 | -1674302 |

## Paired Flip Audit

- same profit: 2
- same loss: 3
- formal profit → chat loss: 2
- formal loss → chat profit: 0
- D4 attempts distribution: {"6":5,"7":1,"8":1}
- D5 attempts distribution: {"1":7}

## Paired Rows

| chain | persona | cond | rep | base cards | chat cards | base price | chat price | base profit | chat profit | base loss | chat loss |
|---|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| A|Q|1 | 草根老板 | Q | 1 | 9 | 10 | 3000 | 1500 | -139604 | -1247528 | 1 | 1 |
| D|Q|1 | 二代接班人 | Q | 1 | 9 | 13 | 2900 | 3900 | 1076205 | 3421416 | 0 | 0 |
| E|Q|1 | 体制转型者 | Q | 1 | 8 | 10 | 3800 | 3800 | 13521399 | 649900 | 0 | 0 |
| B|Q|1 | 职业经理人 | Q | 1 | 10 | 12 | 2900 | 1900 | 27287884 | -3672200 | 0 | 1 |
| F|Q|1 | 销售铁军 | Q | 1 | 9 | 13 | 1200 | 1200 | -4261972 | -7312880 | 1 | 1 |
| C|Q|1 | 技术创业者 | Q | 1 | 7 | 12 | 2000 | 2000 | 1505149 | -2374745 | 0 | 1 |
| G|Q|1 | 互联网PM转型 | Q | 1 | 10 | 12 | 1900 | 3900 | -83858 | -1184075 | 1 | 1 |

## Controls

- R1 outcome, Coach, D3 summary, D3 evidence signals, target grid, cards manifest, pricing range, compatibility validation, and settlement are inherited from the same formal source row.
- Manipulated factor: D4 split into six function-dimension selection calls; one dimension card group visible per call; D5 formal JSON unchanged; global compatibility repair only if merged six-round plan fails validation.
- Invalid, missing, or compatibility-failing outputs get the same repair budget as formal JSON (2 repairs).
- Settlement uses the same `FullGame.calculateR2` path.
