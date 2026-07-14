# Chain Map Engine Pilot v5 Summary

- Run: `chain_map_engine_pilot_v5_2026-07-14`
- Completed: 2/2; failed: 0
- Aggregation: dimensionScorer.scoreTagsToDimensions -> embeddingService.scoreTagsWithPolarity
- VP scores are report-only and do not enter `rdCalculator.calculate()`.
- N=1 per persona; all comparisons below are descriptive and are not statistical or paper-citable.

## Chain Results

| Persona | Cards | Price | EVI | Vscore | dCOGS | Risk | Q | Profit | VP C/G/E/VPscore |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---|
| 草根老板 | 8 | 2,800 | 0.7 | 0.18 | 372 | 0.51 | 3,066 | 1,859,913 | 3.9/4.5/4.3/4.1 |
| 二代接班人 | 15 | 5,000 | 0.7 | 0.25 | 1,263 | 1.3 | 2,471 | 606,303 | 3.2/4.6/4.9/3.9 |

## 草根老板

- Evidence fingerprint: 人力替代类=未命中；背书/展示类=未命中
- Cards: 8; compatibility=PASS
- Price: raw 2,800 → aligned 2,800
- EVI: 0.7; Vscore: 0.18; profit: 1,859,913; Q: 3,066

### Selected Cards

| Dimension | Card | Tier |
|---|---|---|
| 交互与表达 | voice_basic | low |
| 交互与表达 | music_companion | low |
| 交互与表达 | touch_hug | low |
| 感知与理解 | perception_base | low |
| 运动与导航 | basic_avoidance | low |
| 安全与信任 | privacy_trust | low |
| 可扩展与连接 | cloud_update | low |
| 可运营与可维护 | self_diag | low |

### D3 Tags and Exact Map

| Tag | Polarity | Exact mapped dimension |
|---|---|---|
| 安全监护 | positive | 未命中 exact tag map；dimensionScorer 仍按 anchor 相似度计分 |
| 情绪管理 | positive | 未命中 exact tag map；dimensionScorer 仍按 anchor 相似度计分 |
| 非穿戴设备 | positive | 未命中 exact tag map；dimensionScorer 仍按 anchor 相似度计分 |
| 无侵入感 | positive | 未命中 exact tag map；dimensionScorer 仍按 anchor 相似度计分 |
| 开机即用 | positive | 未命中 exact tag map；dimensionScorer 仍按 anchor 相似度计分 |
| 差异化体验 | positive | 未命中 exact tag map；dimensionScorer 仍按 anchor 相似度计分 |
| 家属满意度 | positive | 未命中 exact tag map；dimensionScorer 仍按 anchor 相似度计分 |
| 试用验证 | positive | 未命中 exact tag map；dimensionScorer 仍按 anchor 相似度计分 |
| 品质感 | positive | 未命中 exact tag map；dimensionScorer 仍按 anchor 相似度计分 |
| 小批量试销 | positive | 未命中 exact tag map；dimensionScorer 仍按 anchor 相似度计分 |

- Exact tag-map coverage: 0/10.
- Engine effective coverage tags: 情绪识别、安全与信任、场景感知、语音交互、隐私保护、远程控制.
- Grid/radar fallback used inside calculate: YES. D3-derived radar and EVI still enter calculate, but unmapped raw tags do not directly enter core/nice coverage.

### Radar / Dimension Scores

| Dimension key | Score |
|---|---:|
| perception | 5 |
| mobility | 1 |
| interaction | 10 |
| safety_privacy | 7 |
| integration | 1 |
| operations | 7 |

### VP (Report Only; Not an Engine Input)

- C=3.9, G=4.5, E=4.3, VPscore=4.1.

## 二代接班人

- Evidence fingerprint: 人力替代类=命中；背书/展示类=命中
- Cards: 15; compatibility=PASS
- Price: raw 4,999 → aligned 5,000
- EVI: 0.7; Vscore: 0.25; profit: 606,303; Q: 2,471

### Selected Cards

| Dimension | Card | Tier |
|---|---|---|
| 交互与表达 | voice_basic | mid |
| 交互与表达 | persona_dialog | low |
| 交互与表达 | touch_hug | mid |
| 交互与表达 | music_companion | mid |
| 交互与表达 | visual_expression | low |
| 交互与表达 | expressive_style_pack | mid |
| 感知与理解 | perception_base | low |
| 感知与理解 | emotion_recognition | low |
| 感知与理解 | adaptive_learning | low |
| 感知与理解 | memory_album | low |
| 运动与导航 | basic_avoidance | mid |
| 安全与信任 | privacy_trust | mid |
| 可扩展与连接 | cloud_update | mid |
| 可运营与可维护 | self_diag | low |
| 可运营与可维护 | remote_monitor | low |

### D3 Tags and Exact Map

| Tag | Polarity | Exact mapped dimension |
|---|---|---|
| 运营效率 | positive | 未命中 exact tag map；dimensionScorer 仍按 anchor 相似度计分 |
| 人力替代 | positive | 未命中 exact tag map；dimensionScorer 仍按 anchor 相似度计分 |
| 品质感 | positive | 未命中 exact tag map；dimensionScorer 仍按 anchor 相似度计分 |
| 差异化体验 | positive | 未命中 exact tag map；dimensionScorer 仍按 anchor 相似度计分 |
| 投入产出比 | positive | 未命中 exact tag map；dimensionScorer 仍按 anchor 相似度计分 |
| 降低不确定性 | positive | 未命中 exact tag map；dimensionScorer 仍按 anchor 相似度计分 |
| 试用验证 | positive | 未命中 exact tag map；dimensionScorer 仍按 anchor 相似度计分 |
| 材质做工 | positive | 未命中 exact tag map；dimensionScorer 仍按 anchor 相似度计分 |
| 管理杠杆 | positive | 未命中 exact tag map；dimensionScorer 仍按 anchor 相似度计分 |
| 采购谨慎 | negative | 未命中 exact tag map；dimensionScorer 仍按 anchor 相似度计分 |

- Exact tag-map coverage: 0/10.
- Engine effective coverage tags: 情绪识别、安全与信任、场景感知、语音交互、隐私保护、远程控制.
- Grid/radar fallback used inside calculate: YES. D3-derived radar and EVI still enter calculate, but unmapped raw tags do not directly enter core/nice coverage.

### Radar / Dimension Scores

| Dimension key | Score |
|---|---:|
| perception | 7 |
| mobility | 5 |
| interaction | 7 |
| safety_privacy | 4 |
| integration | 1 |
| operations | 10 |

### VP (Report Only; Not an Engine Input)

- C=3.2, G=4.6, E=4.9, VPscore=3.9.

## One-Sentence Observation

> 本次两条单链中，二代定价高于草根，与抽象链价格方向一致；EVI 为草根 0.7 / 二代 0.7，Vscore 为 0.18 / 0.25，profit 为 1,859,913 / 606,303。这只是描述性观察。

Full prompts, raw responses, tag extraction, EVI inputs, VP report, and calculate I/O are in `chain_map_engine_pilot_v5_2026-07-14_raw_samples.md`.
