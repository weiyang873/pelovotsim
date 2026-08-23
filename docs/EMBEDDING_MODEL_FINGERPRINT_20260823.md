# Embedding Model Fingerprint 2026-08-23

## Source

- Evidence date: 2026-08-23
- Evidence source: production container `pelovotsim-app-1`
- Model: `Xenova/paraphrase-multilingual-MiniLM-L12-v2`
- Pinned revision used for image build: `2c4055b12046f11709e9df2c122e59ffbdc2f900`
- Purpose: weight anchor for the `vpWordScorer` 12-sample calibration scale.

## Fingerprints

```text
b60b6b43406a48bf3638526314f3d232d97058bc93472ff2de930d43686fa441  tokenizer.json
05b570bff786faa5c4604152aa16f19f77ed6dfc31e47dd0f3dd987078693ac7  config.json
66fc00f5f29afcaff34092e1bdd20008ca3918265a82fb9695a551e510cc4ebc  onnx/model_quantized.onnx
3f5961b9ac86288cccdb97f32fb848d6187c78e1603958c53f3ea1f296b7d8a2  tokenizer_config.json
```

## Anchor Decision

A/B 判定实验结论：A、B 两份权重的 12 样本分数完全一致，行为等价。本仓库钉 B 份生产副本作为权重锚；构建期以 `onnx/model_quantized.onnx` 和 `tokenizer.json` 的 sha256 校验为准。

## Calibration Baseline

| Sample | Expected | C | G | E | VPscore |
| --- | --- | ---: | ---: | ---: | ---: |
| 1 | 差 | 2.4 | 2.5 | 1.0 | 2.0 |
| 2 | 差 | 1.0 | 1.0 | 1.0 | 1.0 |
| 3 | 中 | 3.8 | 3.1 | 3.3 | 3.5 |
| 4 | 中 | 3.2 | 3.0 | 2.8 | 3.0 |
| 5 | 好 | 3.2 | 5.0 | 5.0 | 4.0 |
| 6 | 好 | 4.1 | 3.7 | 4.6 | 4.1 |
| 7 | 差 | 1.0 | 1.0 | 1.0 | 1.0 |
| 8 | 中 | 2.4 | 3.5 | 3.5 | 2.9 |
| 9 | 好 | 3.1 | 3.9 | 5.0 | 3.7 |
| 10 | 差 | 2.4 | 1.0 | 1.0 | 1.5 |
| 11 | 中 | 3.8 | 2.6 | 3.1 | 3.3 |
| 12 | 好 | 5.0 | 5.0 | 4.3 | 4.8 |

Bucket averages:

| Bucket | VPscore average |
| --- | ---: |
| 差 | 1.375 |
| 中 | 3.175 |
| 好 | 4.150 |
