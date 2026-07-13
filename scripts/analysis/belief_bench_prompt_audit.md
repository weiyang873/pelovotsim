# Belief Bench Prompt Leak Audit

## Verdict

The subjective-state request leaks a numeric anchor through its JSON example: `[3000, 5000]`. It does not contain the slider bounds, default price, or cost inputs, and it does not reuse the previous card-selection conversation. The bench therefore includes leaked and clean C0 variants.

## Original Prompt

System message: the rendered persona text (`structured`, `simple`, or layered depending on mode).

User message, verbatim template from stashed `team_runner.js`:

```text
## 当前任务：形成选卡前的主观状态
请只根据你的身份/persona信息和你已读报告内容，形成后续选卡与定价会使用的中间判断。

## 你实际读过的报告原文
{buildReportsInput(context.readReports)}

只输出可 JSON.parse 的 JSON：
{
  "estimated_wtp_range": [3000, 5000],
  "top_needs": ["需求1", "需求2"],
  "primary_goal": "一句话说明本轮最重要目标",
  "min_acceptable_coverage": "high|medium|low",
  "planned_stop_rule": "一句话说明你准备如何停止搜索"
}
```

Call options:

```json
{
  "temperature": 0.45,
  "max_tokens": 700
}
```

## Checks

| Check | Result |
|---|---|
| Slider `2000 / 7000` | absent |
| Default `4000` | absent |
| `cost_ref`, `COGSbase`, cost figures | absent |
| Previous card-selection prompt in messages | absent; this call builds a new message array |
| Numeric output example | **present: `[3000, 5000]`** |

## Material Consistency

Production report file: `game_config_v0.1/persona_reports_v1.1.json`

- `超过300元`: 0 hits
- `心理上限两三千元`: 0 hits
- `两万以内直接批`: 0 hits

The expected evidence sentences in the bench specification are not present in the actual v1.1 file. They are not injected or reconstructed.

## Prompt Hashes

- original_subjective_state: `c0168f14731b5f02bc8e8fed6f58598c76267eec9c51a44d5a266173606db29e`
- c0_leaked: `10da7f3679eb5d9987cb7497e3ceab7447fb1c233a79b03a34691fe0fc7ea986`
- c0_clean: `fee7905ce7f11affb530e0ca1ff5c88b8dd279ae36b1adc55d1e0f12a92c5f50`
- c1_extract: `16f3bdbdc12ff5514008b42857dff7bd05534897be4f8c576f7fd82d63c9c46b`
- c1_estimate: `ea3b7e3d328cd48200d23e1639969fbe7a3a03c93a2d627d2339e15a5c283f9e`
- c2_low: `6132ca961f6f79e5d2ee2e6a7085d5eeb91cf56285a42baf1bce04fc8d2efe5d`
- c2_high: `b67a1cd5c6008b19acd1f5f6d6ed88036c1cb864ae86042673af5f6304c33ecc`
- c3_extract: `1685cf1edf094d8104fa461b48adb662ae5af9a0add5c2247e06488a98464be9`
