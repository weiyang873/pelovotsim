# LLM Provider Switch

The production LLM client remains backward-compatible with DeepSeek, and can now
use Qwen/DashScope through OpenAI-compatible chat completions without changing
runner code.

## DeepSeek Default

```env
LLM_PROVIDER=deepseek
DEEPSEEK_API_KEY_1=sk-...
DEEPSEEK_MODEL=deepseek-v4-flash
LLM_DISABLE_THINKING=1
DEEPSEEK_DISABLE_THINKING=1
```

## Qwen / DashScope

```env
LLM_PROVIDER=qwen
QWEN_API_KEY=sk-...
QWEN_MODEL=deepseek-v4-flash-0731
QWEN_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1
LLM_DISABLE_THINKING=1
QWEN_DISABLE_THINKING=1
```

`DASHSCOPE_API_KEY`, `DASHSCOPE_API_KEY_1..N`, and `DASHSCOPE_MODEL` are also
accepted aliases. Multiple Qwen keys rotate the same way as DeepSeek keys.

## Generic Overrides

```env
LLM_MODEL_OVERRIDE=deepseek-v4-flash-0731
LLM_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1
LLM_CONCURRENCY=10
LLM_MAX_RETRIES=1
```

`LLM_MODEL_OVERRIDE` forces all non-embedding roles to one model. Leave it unset
if you want provider-specific defaults.
