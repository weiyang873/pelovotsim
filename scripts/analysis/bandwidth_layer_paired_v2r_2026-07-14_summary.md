# bandwidth_layer_paired_v2r_2026-07-14 Summary

## Device Note

Paired v2r：F 与 B 均在本 run 内用当前已提交 `full_game_all_personas.js` 重新生成；F 不传 bandwidth hook，B 只增加 bandwidth layer；同一 persona 的 F/B 共用同一 r0_jinang。

参数仍为试探值，未经真人 trace 校准；本结果只用于机制验证，不是保真度声明。

## Completion

- Latest rows: 14/14
- OK: 14/14
- Failed: none

## 1. Paired trajectory

| Persona | F 格子/架构 | B 格子/架构 | F 选卡 | B 选卡 | F 价格 | B 价格 | F profit | B profit | Δ(B-F) |
|---|---|---|---|---|---:|---:|---:|---:|---:|
| 草根老板 | ToC_DIFF_CHILD/Experience | ToC_DIFF_CHILD/Hybrid | 7张 / low 6, mid 1, high 0 | 7张 / low 2, mid 5, high 0 | 1500 | 2900 | -1768045 | 152379 | 1920424 |
| 二代接班人 | ToC_DIFF_ELDER/Experience | ToC_DIFF_CHILD/Experience | 10张 / low 1, mid 8, high 1 | 10张 / low 1, mid 3, high 6 | 3900 | 4800 | 31478878 | -6175292 | -37654170 |
| 体制转型者 | ToB_DIFF_ELDER/Hybrid | ToB_DIFF_ELDER/Hybrid | 7张 / low 2, mid 5, high 0 | 8张 / low 0, mid 8, high 0 | 2800 | 3800 | 32352241 | 37389557 | 5037316 |
| 职业经理人 | ToC_DIFF_ELDER/Experience | ToC_DIFF_CHILD/Experience | 10张 / low 2, mid 5, high 3 | 9张 / low 2, mid 2, high 5 | 3900 | 4200 | 54187507 | -5618823 | -59806330 |
| 销售铁军 | ToC_DIFF_ELDER/Experience | ToC_DIFF_CHILD/Experience | 10张 / low 2, mid 4, high 4 | 10张 / low 2, mid 5, high 3 | 4900 | 4800 | 62375724 | 21446435 | -40929289 |
| 技术创业者 | ToB_DIFF_ELDER/Hybrid | ToB_DIFF_ELDER/Hybrid | 8张 / low 4, mid 3, high 1 | 8张 / low 3, mid 5, high 0 | 2800 | 4800 | 17708616 | 19729560 | 2020944 |
| 互联网PM转型 | ToB_DIFF_ELDER/Hybrid | ToB_DIFF_ELDER/Hybrid | 8张 / low 3, mid 5, high 0 | 9张 / low 4, mid 5, high 0 | 2800 | 2800 | 17087682 | 6963451 | -10124231 |

## 2. 调用失败直接证据候选

| Persona | Stage | B/map_total | F 引用但 B 被挡地图 | B vs F 决策不同 | 栈处理 |
|---|---|---:|---|---|---|
| 草根老板 | R1 | 20/50 | map_caogen_07(rank 48, 预算外)；map_caogen_44(rank 32, 预算外)；map_caogen_13(rank 27, 预算外) | 是 | 全文 |
| 草根老板 | D3 | 14/50 | map_caogen_17(rank 46, 预算外)；map_caogen_40(rank 20, 预算外)；map_caogen_13(rank 47, 预算外)；map_caogen_44(rank 21, 预算外) | 是 | 全文 |
| 草根老板 | D4 | 11/50 | 无 F 显式 map id 被挡 | 是 | 摘要 3→3 |
| 草根老板 | D5 | 8/50 | 无 F 显式 map id 被挡 | 是 | 摘要 4→4 |
| 二代接班人 | R1 | 20/50 | map_erdai_04(rank 49, 预算外)；map_erdai_19(rank 46, 预算外)；map_erdai_23(rank 39, 预算外)；map_erdai_41(rank 40, 预算外)；map_erdai_44(rank 26, 预算外)；map_erdai_31(rank 43, 预算外)；map_erdai_32(rank 48, 预算外)；map_erdai_29(rank 32, 预算外)；map_erdai_20(rank 35, 预算外) | 是 | 全文 |
| 二代接班人 | D3 | 14/50 | map_erdai_41(rank 23, 预算外) | 是 | 全文 |
| 二代接班人 | D4 | 11/50 | map_erdai_31(rank 34, 预算外) | 是 | 摘要 3→3 |
| 二代接班人 | D5 | 8/50 | 无 F 显式 map id 被挡 | 是 | 摘要 4→4 |
| 体制转型者 | R1 | 20/25 | map_tizhi_01(rank 23, 预算外)；map_tizhi_07(rank 24, 预算外) | 是 | 全文 |
| 体制转型者 | D4 | 11/25 | 无 F 显式 map id 被挡 | 是 | 摘要 3→3 |
| 体制转型者 | D5 | 8/25 | 无 F 显式 map id 被挡 | 是 | 摘要 4→4 |
| 职业经理人 | D4 | 11/25 | map_jingli_01(rank 17, 预算外)；map_jingli_03(rank 19, 预算外) | 是 | 摘要 3→3 |
| 职业经理人 | D5 | 8/25 | map_jingli_15(rank 10, 预算外) | 是 | 摘要 4→4 |
| 销售铁军 | R1 | 20/25 | map_xiaoshou_14(rank 25, 预算外)；map_xiaoshou_21(rank 24, 预算外) | 是 | 全文 |
| 销售铁军 | D4 | 11/25 | 无 F 显式 map id 被挡 | 是 | 摘要 3→3 |
| 销售铁军 | D5 | 8/25 | 无 F 显式 map id 被挡 | 是 | 摘要 4→4 |
| 技术创业者 | R1 | 20/25 | map_jishu_10(rank 24, 预算外) | 是 | 全文 |
| 技术创业者 | D4 | 11/25 | 无 F 显式 map id 被挡 | 是 | 摘要 3→3 |
| 技术创业者 | D5 | 8/25 | 无 F 显式 map id 被挡 | 是 | 摘要 4→4 |
| 互联网PM转型 | R1 | 20/25 | map_pm_24(rank 24, 预算外) | 是 | 全文 |
| 互联网PM转型 | D3 | 14/25 | map_pm_22(rank 25, 预算外) | 是 | 全文 |
| 互联网PM转型 | D4 | 11/25 | 无 F 显式 map id 被挡 | 是 | 摘要 3→3 |

## 3. B audit completeness

| Persona | B calls audited | stages | B sequence | timestamp sequence | stack summary stages |
|---|---:|---|---|---|---|
| 草根老板 | 7 | R1, Coach_1, Coach_2, Coach_3, D3, D4, D5 | 20→17→17→17→14→11→8 | 2026-07-14T16:55:22.985Z→2026-07-14T16:55:27.831Z→2026-07-14T16:55:34.859Z→2026-07-14T16:55:40.748Z→2026-07-14T16:55:58.405Z→2026-07-14T16:56:07.561Z→2026-07-14T16:56:15.254Z | D4, D5 |
| 二代接班人 | 7 | R1, Coach_1, Coach_2, Coach_3, D3, D4, D5 | 20→17→17→17→14→11→8 | 2026-07-14T16:55:27.001Z→2026-07-14T16:55:31.910Z→2026-07-14T16:55:39.504Z→2026-07-14T16:55:47.114Z→2026-07-14T16:56:05.460Z→2026-07-14T16:56:17.280Z→2026-07-14T16:56:28.134Z | D4, D5 |
| 体制转型者 | 7 | R1, Coach_1, Coach_2, Coach_3, D3, D4, D5 | 20→17→17→17→14→11→8 | 2026-07-14T16:57:12.916Z→2026-07-14T16:57:17.687Z→2026-07-14T16:57:24.066Z→2026-07-14T16:57:32.887Z→2026-07-14T16:57:49.126Z→2026-07-14T16:57:56.266Z→2026-07-14T16:58:02.940Z | D4, D5 |
| 职业经理人 | 7 | R1, Coach_1, Coach_2, Coach_3, D3, D4, D5 | 20→17→17→17→14→11→8 | 2026-07-14T16:57:38.011Z→2026-07-14T16:57:43.187Z→2026-07-14T16:57:50.099Z→2026-07-14T16:57:57.151Z→2026-07-14T16:58:14.736Z→2026-07-14T16:58:21.648Z→2026-07-14T16:58:27.777Z | D4, D5 |
| 销售铁军 | 7 | R1, Coach_1, Coach_2, Coach_3, D3, D4, D5 | 20→17→17→17→14→11→8 | 2026-07-14T16:59:09.677Z→2026-07-14T16:59:15.014Z→2026-07-14T16:59:23.604Z→2026-07-14T16:59:33.790Z→2026-07-14T16:59:51.164Z→2026-07-14T17:00:01.381Z→2026-07-14T17:00:08.542Z | D4, D5 |
| 技术创业者 | 7 | R1, Coach_1, Coach_2, Coach_3, D3, D4, D5 | 20→17→17→17→14→11→8 | 2026-07-14T16:59:31.367Z→2026-07-14T16:59:36.373Z→2026-07-14T16:59:42.754Z→2026-07-14T16:59:49.759Z→2026-07-14T17:00:08.488Z→2026-07-14T17:00:15.846Z→2026-07-14T17:00:22.804Z | D4, D5 |
| 互联网PM转型 | 7 | R1, Coach_1, Coach_2, Coach_3, D3, D4, D5 | 20→17→17→17→14→11→8 | 2026-07-14T17:07:20.785Z→2026-07-14T17:07:25.204Z→2026-07-14T17:07:33.927Z→2026-07-14T17:07:41.863Z→2026-07-14T17:07:56.856Z→2026-07-14T17:08:07.266Z→2026-07-14T17:08:10.947Z | D4, D5 |

## 4. AssertInfoSet

R1/D3/D4/D5 prompts for all OK F/B rows are re-checked at output time; pass records are in meta.assert_info_set_records.
