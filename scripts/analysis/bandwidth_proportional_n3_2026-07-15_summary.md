# bandwidth_proportional_n3_2026-07-15 Summary

## Device Note

比例制 paired N=3：F 与 B 均在本 run 内新生成；F 不传 bandwidth hook，B 使用比例带宽层；同一 persona 的 3 个 rep 全部复用同一套 full_game v1 r0_jinang。

参数仍为试探值，未经真人 trace 校准；N=3 只报告均值/区间，不做显著性声明。

## Completion

- Latest rows: 42/42
- OK: 42/42
- Failed: none
- Rows total including failed attempts: 42

## 1. 盈利率与利润

| Condition | n | 盈利链 | 盈利率 | mean profit | min | max |
|---|---:|---:|---:|---:|---:|---:|
| F | 21 | 15/21 | 71.4% | 12696429 | -15302953 | 48762420 |
| B | 21 | 14/21 | 66.7% | 13100391 | -5502150 | 51803070 |

## 2. 格子稳定性矩阵

| Persona | F×3 格子/架构 | B×3 格子/架构 |
|---|---|---|
| 草根老板 | ToC_DIFF_CHILD/Experience；ToC_DIFF_CHILD/Experience；ToC_DIFF_ELDER/Experience | ToC_DIFF_CHILD/Experience；ToC_DIFF_CHILD/Experience；ToC_DIFF_CHILD/Experience |
| 二代接班人 | ToC_DIFF_ELDER/Experience；ToC_DIFF_ELDER/Experience；ToC_DIFF_ELDER/Experience | ToC_DIFF_ELDER/Experience；ToC_DIFF_CHILD/Experience；ToC_DIFF_ELDER/Experience |
| 体制转型者 | ToB_DIFF_ELDER/Hybrid；ToB_DIFF_ELDER/Hybrid；ToB_DIFF_ELDER/Hybrid | ToB_DIFF_ELDER/Hybrid；ToB_DIFF_ELDER/Hybrid；ToB_DIFF_ELDER/Hybrid |
| 职业经理人 | ToC_DIFF_CHILD/Experience；ToC_DIFF_CHILD/Experience；ToC_DIFF_ELDER/Experience | ToC_DIFF_CHILD/Experience；ToC_DIFF_CHILD/Experience；ToC_DIFF_CHILD/Experience |
| 销售铁军 | ToC_DIFF_CHILD/Experience；ToC_DIFF_CHILD/Hybrid；ToC_DIFF_ELDER/Experience | ToC_DIFF_CHILD/Experience；ToC_DIFF_CHILD/Experience；ToC_DIFF_CHILD/Experience |
| 技术创业者 | ToB_DIFF_ELDER/Hybrid；ToB_DIFF_ELDER/Hybrid；ToC_DIFF_ELDER/Experience | ToC_DIFF_ELDER/Experience；ToB_DIFF_ELDER/Hybrid；ToC_DIFF_ELDER/Experience |
| 互联网PM转型 | ToB_DIFF_ELDER/Hybrid；ToB_DIFF_ELDER/Hybrid；ToB_DIFF_ELDER/Hybrid | ToB_DIFF_ELDER/Hybrid；ToB_DIFF_ELDER/Hybrid；ToB_DIFF_ELDER/Hybrid |

## 3. Paired 明细

| Persona | rep | F 格子/架构 | B 格子/架构 | F 价格 | B 价格 | F profit | B profit | Δ(B-F) | F 选卡 | B 选卡 |
|---|---:|---|---|---:|---:|---:|---:|---:|---|---|
| 草根老板 | 1 | ToC_DIFF_CHILD/Experience | ToC_DIFF_CHILD/Experience | 1000 | 2900 | -7759566 | -2757512 | 5002054 | 8张 / low 5, mid 2, high 1 | 10张 / low 7, mid 3, high 0 |
| 草根老板 | 2 | ToC_DIFF_CHILD/Experience | ToC_DIFF_CHILD/Experience | 1900 | 1900 | 11912469 | -723512 | -12635981 | 7张 / low 4, mid 3, high 0 | 11张 / low 7, mid 3, high 1 |
| 草根老板 | 3 | ToC_DIFF_ELDER/Experience | ToC_DIFF_CHILD/Experience | 2900 | 2900 | 2946915 | 15048007 | 12101092 | 8张 / low 6, mid 2, high 0 | 9张 / low 5, mid 4, high 0 |
| 二代接班人 | 1 | ToC_DIFF_ELDER/Experience | ToC_DIFF_ELDER/Experience | 3800 | 4800 | 29489104 | 34882581 | 5393477 | 8张 / low 1, mid 4, high 3 | 10张 / low 1, mid 5, high 4 |
| 二代接班人 | 2 | ToC_DIFF_ELDER/Experience | ToC_DIFF_CHILD/Experience | 3000 | 4900 | -15302953 | 2415556 | 17718509 | 12张 / low 1, mid 6, high 5 | 11张 / low 1, mid 5, high 5 |
| 二代接班人 | 3 | ToC_DIFF_ELDER/Experience | ToC_DIFF_ELDER/Experience | 4200 | 5800 | 1497592 | 51803070 | 50305478 | 12张 / low 2, mid 8, high 2 | 10张 / low 1, mid 5, high 4 |
| 体制转型者 | 1 | ToB_DIFF_ELDER/Hybrid | ToB_DIFF_ELDER/Hybrid | 3500 | 3800 | 19779541 | 35370442 | 15590901 | 9张 / low 3, mid 6, high 0 | 7张 / low 0, mid 1, high 6 |
| 体制转型者 | 2 | ToB_DIFF_ELDER/Hybrid | ToB_DIFF_ELDER/Hybrid | 3000 | 4800 | 28125569 | 26624521 | -1501048 | 8张 / low 3, mid 5, high 0 | 9张 / low 1, mid 8, high 0 |
| 体制转型者 | 3 | ToB_DIFF_ELDER/Hybrid | ToB_DIFF_ELDER/Hybrid | 4800 | 4800 | 33170995 | 31488081 | -1682914 | 8张 / low 1, mid 7, high 0 | 9张 / low 3, mid 6, high 0 |
| 职业经理人 | 1 | ToC_DIFF_CHILD/Experience | ToC_DIFF_CHILD/Experience | 2900 | 3800 | -5734078 | 8082255 | 13816333 | 10张 / low 3, mid 3, high 4 | 12张 / low 6, mid 4, high 2 |
| 职业经理人 | 2 | ToC_DIFF_CHILD/Experience | ToC_DIFF_CHILD/Experience | 3900 | 4200 | -5472664 | -4024 | 5468640 | 10张 / low 2, mid 2, high 6 | 11张 / low 3, mid 7, high 1 |
| 职业经理人 | 3 | ToC_DIFF_ELDER/Experience | ToC_DIFF_CHILD/Experience | 2800 | 4900 | 4442056 | -2697509 | -7139565 | 9张 / low 2, mid 3, high 4 | 10张 / low 1, mid 5, high 4 |
| 销售铁军 | 1 | ToC_DIFF_CHILD/Experience | ToC_DIFF_CHILD/Experience | 4900 | 3900 | -3319175 | -5502150 | -2182975 | 11张 / low 2, mid 0, high 9 | 9张 / low 1, mid 3, high 5 |
| 销售铁军 | 2 | ToC_DIFF_CHILD/Hybrid | ToC_DIFF_CHILD/Experience | 2900 | 5800 | 4540722 | 3986695 | -554027 | 10张 / low 2, mid 5, high 3 | 10张 / low 3, mid 6, high 1 |
| 销售铁军 | 3 | ToC_DIFF_ELDER/Experience | ToC_DIFF_CHILD/Experience | 3500 | 3900 | 10323309 | -3786845 | -14110154 | 11张 / low 1, mid 4, high 6 | 10张 / low 2, mid 7, high 1 |
| 技术创业者 | 1 | ToB_DIFF_ELDER/Hybrid | ToC_DIFF_ELDER/Experience | 3800 | 2900 | 39768241 | 7025958 | -32742283 | 9张 / low 3, mid 4, high 2 | 8张 / low 3, mid 3, high 2 |
| 技术创业者 | 2 | ToB_DIFF_ELDER/Hybrid | ToB_DIFF_ELDER/Hybrid | 4800 | 3800 | 15877761 | 23911681 | 8033920 | 7张 / low 2, mid 3, high 2 | 8张 / low 1, mid 7, high 0 |
| 技术创业者 | 3 | ToC_DIFF_ELDER/Experience | ToC_DIFF_ELDER/Experience | 1900 | 2800 | -2305531 | 5273397 | 7578928 | 9张 / low 6, mid 2, high 1 | 9张 / low 4, mid 4, high 1 |
| 互联网PM转型 | 1 | ToB_DIFF_ELDER/Hybrid | ToB_DIFF_ELDER/Hybrid | 2800 | 4800 | 48762420 | 27856890 | -20905530 | 7张 / low 1, mid 3, high 3 | 8张 / low 0, mid 8, high 0 |
| 互联网PM转型 | 2 | ToB_DIFF_ELDER/Hybrid | ToB_DIFF_ELDER/Hybrid | 2900 | 4800 | 36207611 | -1152795 | -37360406 | 7张 / low 2, mid 5, high 0 | 8张 / low 8, mid 0, high 0 |
| 互联网PM转型 | 3 | ToB_DIFF_ELDER/Hybrid | ToB_DIFF_ELDER/Hybrid | 2800 | 2800 | 19674676 | 17963420 | -1711256 | 8张 / low 1, mid 5, high 2 | 9张 / low 1, mid 8, high 0 |

## 4. 可见比例均等性验证

| call | map_total | stack_len | B | ratio_visible |
|---|---:|---:|---:|---:|
| R1 | 50 | 0 | 20 | 40% |
| R1 | 25 | 0 | 10 | 40% |
| Coach_1 | 50 | 1 | 17 | 34% |
| Coach_1 | 25 | 1 | 8 | 32% |
| Coach_2 | 50 | 1 | 17 | 34% |
| Coach_2 | 25 | 1 | 8 | 32% |
| Coach_3 | 50 | 1 | 17 | 34% |
| Coach_3 | 25 | 1 | 8 | 32% |
| D3 | 50 | 2 | 14 | 28% |
| D3 | 25 | 2 | 7 | 28% |
| D4 | 50 | 3 | 11 | 22% |
| D4 | 25 | 3 | 5 | 20% |
| D5 | 50 | 4 | 8 | 16% |
| D5 | 25 | 4 | 4 | 16% |

## 5. 上轮复现表逐行重验

| 旧证据 | N=3 读数 | 明细 |
|---|---:|---|
| 草根 B 提价 | 1/3 | F=1000,1900,2900；B=2900,1900,2900 |
| 二代格子漂移 | 1/3 | F=ToC_DIFF_ELDER/Experience；ToC_DIFF_ELDER/Experience；ToC_DIFF_ELDER/Experience；B=ToC_DIFF_ELDER/Experience；ToC_DIFF_CHILD/Experience；ToC_DIFF_ELDER/Experience |
| 体制 B 改善 | 1/3 | Δ=15590901,-1501048,-1682914 |
| B 总利润 < F | 2/3 | rep1:F=120986487,B=104958464；rep2:F=75888515,B=55058122；rep3:F=69750012,B=115091621 |
| B 定价整体偏高 | 14/21 | 同 persona/rep paired 比较 |

## 6. rank=B+1 且任一 F 链引用过的事件

| Persona | rep | stage | map id | rank/B | ratio_visible |
|---|---:|---|---|---:|---:|
| 草根老板 | 1 | Coach_1 | map_caogen_42 | 18/17 | 34% |
| 草根老板 | 1 | D4 | map_caogen_43 | 12/11 | 22% |
| 草根老板 | 3 | Coach_3 | map_caogen_46 | 18/17 | 34% |
| 草根老板 | 3 | D4 | map_caogen_06 | 12/11 | 22% |
| 二代接班人 | 1 | Coach_3 | map_erdai_05 | 18/17 | 34% |
| 二代接班人 | 1 | D3 | map_erdai_05 | 15/14 | 28% |
| 二代接班人 | 2 | Coach_1 | map_erdai_31 | 18/17 | 34% |
| 二代接班人 | 2 | D4 | map_erdai_41 | 12/11 | 22% |
| 二代接班人 | 3 | D3 | map_erdai_42 | 15/14 | 28% |
| 体制转型者 | 1 | D3 | map_tizhi_10 | 8/7 | 28% |
| 体制转型者 | 1 | D4 | map_tizhi_10 | 6/5 | 20% |
| 体制转型者 | 2 | Coach_3 | map_tizhi_02 | 9/8 | 32% |
| 体制转型者 | 3 | Coach_3 | map_tizhi_02 | 9/8 | 32% |
| 体制转型者 | 3 | D3 | map_tizhi_02 | 8/7 | 28% |
| 职业经理人 | 1 | R1 | map_jingli_22 | 11/10 | 40% |
| 职业经理人 | 2 | R1 | map_jingli_22 | 11/10 | 40% |
| 职业经理人 | 2 | D3 | map_jingli_15 | 8/7 | 28% |
| 职业经理人 | 2 | D5 | map_jingli_02 | 5/4 | 16% |
| 职业经理人 | 3 | R1 | map_jingli_22 | 11/10 | 40% |
| 职业经理人 | 3 | Coach_3 | map_jingli_22 | 9/8 | 32% |
| 职业经理人 | 3 | D3 | map_jingli_15 | 8/7 | 28% |
| 职业经理人 | 3 | D5 | map_jingli_22 | 5/4 | 16% |
| 销售铁军 | 1 | R1 | map_xiaoshou_22 | 11/10 | 40% |
| 销售铁军 | 1 | Coach_1 | map_xiaoshou_14 | 9/8 | 32% |
| 销售铁军 | 1 | Coach_2 | map_xiaoshou_14 | 9/8 | 32% |
| 销售铁军 | 1 | D3 | map_xiaoshou_25 | 8/7 | 28% |
| 销售铁军 | 1 | D4 | map_xiaoshou_25 | 6/5 | 20% |
| 销售铁军 | 1 | D5 | map_xiaoshou_18 | 5/4 | 16% |
| 销售铁军 | 2 | R1 | map_xiaoshou_22 | 11/10 | 40% |
| 销售铁军 | 2 | Coach_1 | map_xiaoshou_21 | 9/8 | 32% |
| 销售铁军 | 2 | D3 | map_xiaoshou_21 | 8/7 | 28% |
| 销售铁军 | 2 | D4 | map_xiaoshou_25 | 6/5 | 20% |
| 销售铁军 | 2 | D5 | map_xiaoshou_05 | 5/4 | 16% |
| 销售铁军 | 3 | R1 | map_xiaoshou_22 | 11/10 | 40% |
| 销售铁军 | 3 | Coach_2 | map_xiaoshou_21 | 9/8 | 32% |
| 销售铁军 | 3 | D4 | map_xiaoshou_21 | 6/5 | 20% |
| 销售铁军 | 3 | D5 | map_xiaoshou_05 | 5/4 | 16% |
| 技术创业者 | 1 | R1 | map_jishu_24 | 11/10 | 40% |
| 技术创业者 | 2 | R1 | map_jishu_24 | 11/10 | 40% |
| 技术创业者 | 2 | D3 | map_jishu_02 | 8/7 | 28% |
| 技术创业者 | 2 | D4 | map_jishu_03 | 6/5 | 20% |
| 技术创业者 | 2 | D5 | map_jishu_02 | 5/4 | 16% |
| 技术创业者 | 3 | R1 | map_jishu_24 | 11/10 | 40% |
| 技术创业者 | 3 | D3 | map_jishu_14 | 8/7 | 28% |
| 互联网PM转型 | 1 | Coach_3 | map_pm_22 | 9/8 | 32% |
| 互联网PM转型 | 2 | D3 | map_pm_02 | 8/7 | 28% |
| 互联网PM转型 | 2 | D5 | map_pm_18 | 5/4 | 16% |
| 互联网PM转型 | 3 | Coach_1 | map_pm_18 | 9/8 | 32% |
| 互联网PM转型 | 3 | Coach_3 | map_pm_02 | 9/8 | 32% |

## 7. 局限

- N=3 仍小，只能读方向和区间。
- 锦囊只用单套抽取，未随机化。
- solo 装置，不含团队协商。
- 温度沿用当前 0.55 口径，跨轮不做温度对齐声明。
