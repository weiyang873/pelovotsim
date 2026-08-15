# bandwidth_layer_pilot_v1_2026-07-14 Summary

## Device Note

本轮是 bandwidth layer 首跑：F 条件复用 full_game v2 latest OK 行；B 条件在同一 full_game v2 信息集上只做减法（地图 top-B 与 D4/D5 栈摘要），所有 B 条件 R1/D3/D4/D5 prompt 继续经过 assertInfoSet。

参数为试探值，未经真人 trace 校准；本结果只用于机制验证，不是保真度声明。

## Completion

- Latest rows: 4/4
- OK: 4/4
- B OK: 2/2
- F reused OK: 2/2
- Failed: none

## 1. 调用失败直接证据候选

| Persona | Stage | B/map_total | F 同步决策引用但 B 被挡地图 | B vs F 决策不同 | 栈处理 | 方向判读 |
|---|---|---:|---|---|---|---|
| 草根老板 | R1 | 20/50 | map_caogen_01(预算外, rank 47)；map_caogen_44(预算外, rank 32)；map_caogen_46(预算外, rank 34) | 是 | 未摘要 | 方向待判读 |
| 草根老板 | D3 | 14/50 | map_caogen_16(预算外, rank 29)；map_caogen_45(预算外, rank 23) | 是 | 未摘要 | 方向待判读 |
| 草根老板 | D4 | 11/50 | map_caogen_32(预算外, rank 38) | 是 | 栈摘要 3条→3条，每条≤50字 | 方向待判读 |
| 草根老板 | D5 | 8/50 | 无 F 显式引用地图被挡 | 是 | 栈摘要 4条→4条，每条≤50字 | 方向待判读 |
| 二代接班人 | R1 | 20/50 | map_erdai_04(预算外, rank 49)；map_erdai_19(预算外, rank 46)；map_erdai_44(预算外, rank 26)；map_erdai_31(预算外, rank 43)；map_erdai_32(预算外, rank 48) | 是 | 未摘要 | 方向待判读 |
| 二代接班人 | D3 | 14/50 | map_erdai_44(预算外, rank 19)；map_erdai_05(预算外, rank 15) | 是 | 未摘要 | 方向待判读 |
| 二代接班人 | D4 | 11/50 | 无 F 显式引用地图被挡 | 是 | 栈摘要 3条→3条，每条≤50字 | 方向待判读 |
| 二代接班人 | D5 | 8/50 | 无 F 显式引用地图被挡 | 是 | 栈摘要 4条→4条，每条≤50字 | 方向待判读 |

## 2. 决策轨迹对照

| Persona | F 格子/架构 | B 格子/架构 | F 选卡 | B 选卡 | F 价格 | B 价格 |
|---|---|---|---|---|---:|---:|
| 草根老板 | ToC / 儿童 / 差异化 / Hybrid | ToC / 儿童 / 差异化 / Experience | 8张 / low 6, mid 2, high 0 | 9张 / low 4, mid 5, high 0 | 1000 | 2900 |
| 二代接班人 | ToC / 老人 / 差异化 / Experience | ToC / 儿童 / 差异化 / Experience | 9张 / low 1, mid 3, high 5 | 10张 / low 1, mid 6, high 3 | 5900 | 4800 |

## 3. 经济后果

| Persona | F Q | B Q | F profit | B profit | B-F profit Δ |
|---|---:|---:|---:|---:|---:|
| 草根老板 | 26354 | 9791 | -9512623 | 4415335 | 13927958 |
| 二代接班人 | 30229 | 5763 | 66272768 | 3074514 | -63198254 |

## 4. 元认知泄漏检查

| Persona | B 链理由文本命中 |
|---|---|
| 草根老板 | 未发现 |
| 二代接班人 | 未发现 |

## 5. 审计完整性

| Persona | B calls audited | stages | min/max B | stack summary stages |
|---|---:|---|---|---|
| 草根老板 | 7 | R1, Coach_1, Coach_2, Coach_3, D3, D4, D5 | 8/20 | D4, D5 |
| 二代接班人 | 7 | R1, Coach_1, Coach_2, Coach_3, D3, D4, D5 | 8/20 | D4, D5 |

## 6. 初步方向读数

| Persona | F→B 格子 | F→B 价格 | B-F profit Δ | 读数 |
|---|---|---:|---:|---|
| 草根老板 | ToC / 儿童 / 差异化 → ToC / 儿童 / 差异化 | 1000 → 2900 | 13927958 | 带宽层确实改变调用路径，但本次不是“变差”：从低价试单转向更高价/中配，反而修复了 F 链低价亏损。 |
| 二代接班人 | ToC / 老人 / 差异化 → ToC / 儿童 / 差异化 | 5900 → 4800 | -63198254 | 带宽层造成显著经济退化；主要不是高价锚，而是老人陪伴/品质背书锚被挡后，R1 直接转向儿童格子，属于市场锚调用失败。 |

## One-sentence Observation

看 B/F 决策差异是否能在审计中追到“信息在库里、但未进入当次 prompt”的具体地图/栈片段；若能追到，就是 overload 机制的首个代码化证据点。
