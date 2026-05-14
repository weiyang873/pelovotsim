# Fix Spec — R0: DeepSeek API Key Pool Restoration

**Date:** 2026-05-10
**Audience:** Codex (the implementing agent)
**Priority:** Independent of R5 (concurrency gate) — they are orthogonal: R0 picks **which key** each call uses; R5 limits **how many calls** are concurrent. Ship R0 first because it is a smaller, isolated change with immediate throughput benefit (1× → N× DeepSeek headroom). Both are needed for 60-student stability — do NOT skip R5 assuming R0 made it unnecessary. Once R0 is live, also raise R5's `LLM_CONCURRENCY` env var (see `.env.example` update below).
**Source:** Audit finding — `server/llm/deepseekClient.js` only reads `DEEPSEEK_API_KEY` (single key); `.env` has 8 keys configured (`DEEPSEEK_API_KEY_1` … `DEEPSEEK_API_KEY_8`) that are never read by production code.

This spec is self-contained — do not assume context outside this document. If a section is unclear, prefer the explicit instruction in this spec over inference from existing code.

## Summary of bug being fixed

| ID | One-line description | Severity |
|----|---------------------|----------|
| R0 | `deepseekClient.chatCompletion` only uses `process.env.DEEPSEEK_API_KEY`; the `DEEPSEEK_API_KEY_1..N` keys in `.env` are silently ignored. Production effective throughput is 1× DeepSeek free-tier RPM instead of N×. | Critical |

## Why this matters

`server/llm/deepseekClient.js:117` reads only `DEEPSEEK_API_KEY`. All 10+ production callers (interviewCoach, vpCoach, personaGenerator, vpWordScorer, requirementBuilder, tagExtractor, vpEmbeddingScorer, vpScorer, teacherDebrief, teamRoutes) go through this client. The other 7 keys in `.env` are dead weight.

A different file, `server/llm/chatService.js`, already implements correct key-pool rotation (`chatService.js:9-46`) — but `chatService.js` has zero production imports (`grep -rn 'require.*chatService' server/` returns no matches). It is dead code with valuable logic that was never re-integrated when callers migrated to `deepseekClient`.

This is a regression: chatService (older, fuller-featured) → deepseekClient (newer, simpler, lost the key pool).

## Visible symptoms

- Free-tier RPM saturation under burst load (60 students × ~3 LLM calls/student during phase transitions hits the per-key limit fast)
- `429` responses cascade into the existing single-key retry logic, which only knows how to wait, not to switch keys
- Triggers the silent-fail path in `interviewReply` (R7 in audit) more often than necessary

## Implementation order within this PR

1. Add key-pool collector + picker in `deepseekClient.js`
2. Modify `chatCompletion` to use the pool and switch keys on retry
3. Update `.env.example`
4. Move dead `chatService.js` to `_archive/` (per repo's deletion discipline)
5. Add tests

## Conventions used in this repo

- All `process.env` reads are at module-init time (top of file), cached in module-level constants
- Error logging uses `console.warn` for retries, `console.error` for terminal failures
- No new dependencies — the existing `deepseekClient.js` uses only Node built-ins (`https`, `http`, `URL`)

---

## Files to change

1. `server/llm/deepseekClient.js` — add `DEEPSEEK_KEY_POOL`, export `hasAnyKey()`, use the pool inline in `chatCompletion` (no separate `pickApiKey` helper — pool indexing is done in the retry loop directly)
2. `server.js` — replace two `process.env.DEEPSEEK_API_KEY` "is configured?" checks (lines 899 and 1842) with `hasAnyKey()`. Without this, deployments running pool-only configs (no unsuffixed `DEEPSEEK_API_KEY` env var) will incorrectly show DeepSeek as "not configured" and may disable LLM-powered UI features.
3. `.env.example` — document the new env var pattern, including a `LLM_CONCURRENCY` tuning note that scales with pool size
4. NEW: `server/llm/_archive/chatService.js` — move `server/llm/chatService.js` here (don't delete; preserve key-pool implementation as historical reference)
5. NEW: `tests/deepseek_key_pool.test.js` — verify pool behavior

## Code change to `server/llm/deepseekClient.js`

### Add at top of file, after existing constants (around line 7)

```js
// Collect all DEEPSEEK_API_KEY_N keys plus the unsuffixed DEEPSEEK_API_KEY.
// Deduplicates by value so accidentally pasting the same key into two slots
// doesn't double its weight in the pool.
const DEEPSEEK_KEY_POOL = (() => {
  const seen = new Set();
  const keys = [];

  // Auto-discover any DEEPSEEK_API_KEY_<digits> env vars, sorted for deterministic order.
  const suffixed = Object.keys(process.env)
    .filter((k) => /^DEEPSEEK_API_KEY_\d+$/.test(k))
    .sort((a, b) => {
      const na = parseInt(a.replace(/^DEEPSEEK_API_KEY_/, ""), 10);
      const nb = parseInt(b.replace(/^DEEPSEEK_API_KEY_/, ""), 10);
      return na - nb;
    });

  for (const envName of suffixed) {
    const value = String(process.env[envName] || "").trim();
    if (value && !seen.has(value)) {
      seen.add(value);
      keys.push(value);
    }
  }

  // Backward-compat: include the unsuffixed key if present and not already in pool.
  const fallback = String(process.env.DEEPSEEK_API_KEY || "").trim();
  if (fallback && !seen.has(fallback)) {
    seen.add(fallback);
    keys.push(fallback);
  }

  return keys;
})();

if (DEEPSEEK_KEY_POOL.length === 0) {
  console.warn("[DeepSeek] No API keys configured. Set DEEPSEEK_API_KEY or DEEPSEEK_API_KEY_1..N in .env");
} else {
  console.log(`[DeepSeek] Loaded ${DEEPSEEK_KEY_POOL.length} API key(s) into rotation pool`);
}

/**
 * Whether any DeepSeek API key is configured. Exported so callers
 * (e.g. server.js startup banners, "DeepSeek configured?" UI checks)
 * can ask without reading process.env directly — that env var is now
 * optional once DEEPSEEK_API_KEY_1..N is in use.
 */
function hasAnyKey() {
  return DEEPSEEK_KEY_POOL.length > 0;
}
```

Note: there is **no** separate `pickApiKey()` helper. Pool indexing is done inline inside `chatCompletion`'s retry loop (see next section). Earlier drafts of this spec defined a `pickApiKey(attempt)` helper, but it was unused — the inline approach is simpler and avoids a misleading dead helper.

### Modify `chatCompletion` (around line 116-150)

Change the existing structure:

**Before** (lines 117, 134):
```js
const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY;
// ...
if (!DEEPSEEK_API_KEY) throw new Error("DEEPSEEK_API_KEY not set");
// ...
return await performChatCompletionRequest(url, DEEPSEEK_API_KEY, body);
```

**After**:
```js
async function chatCompletion(messages, options = {}) {
  const DEEPSEEK_MODEL = process.env.DEEPSEEK_MODEL || "deepseek-chat";
  const DEEPSEEK_BASE_URL = process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com";

  if (DEEPSEEK_KEY_POOL.length === 0) {
    throw new Error("DEEPSEEK_API_KEY not set (and no DEEPSEEK_API_KEY_1..N found)");
  }

  const body = JSON.stringify({
    model: DEEPSEEK_MODEL,
    messages,
    temperature: options.temperature ?? 0.7,
    max_tokens: options.max_tokens ?? 800,
  });
  const url = new URL("/v1/chat/completions", DEEPSEEK_BASE_URL);
  const maxRetries = Number.isFinite(options.maxRetries) ? options.maxRetries : MAX_RETRIES;

  // Pick a random starting key for this call. Retries advance through the pool
  // from this starting point, guaranteeing each retry uses a different key
  // (until we wrap around the pool).
  const startKeyIndex = Math.floor(Math.random() * DEEPSEEK_KEY_POOL.length);

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    const keyIndex = (startKeyIndex + attempt) % DEEPSEEK_KEY_POOL.length;
    const apiKey = DEEPSEEK_KEY_POOL[keyIndex];

    try {
      return await performChatCompletionRequest(url, apiKey, body);
    } catch (error) {
      const retryable = isRetryableError(error);
      const canRetry = retryable && attempt < maxRetries;

      if (!canRetry) {
        if (attempt > 0) {
          console.error("[DeepSeek] Request failed after retry (last key idx", keyIndex + "):", error.message);
        }
        throw error;
      }

      const delay = RETRY_DELAY_MS * Math.pow(2, attempt) + Math.random() * 500;
      console.warn(
        `[DeepSeek] Retry ${attempt + 1}/${maxRetries} (key idx ${keyIndex} → ${(keyIndex + 1) % DEEPSEEK_KEY_POOL.length}) ` +
        `after ${Math.round(delay)}ms, reason:`,
        error.message
      );
      await sleep(delay);
    }
  }

  throw new Error("DeepSeek request exhausted retries");
}
```

### Do NOT change

- `performChatCompletionRequest` — its signature already takes `apiKey` as a parameter (line 31)
- `isRetryableError`, `sleep`, `MAX_RETRIES`, `RETRY_DELAY_MS` — unchanged

### Update `module.exports`

```js
// Before:
module.exports = { chatCompletion };

// After:
module.exports = { chatCompletion, hasAnyKey };
```

## Update `server.js` "is DeepSeek configured?" checks

Two places in `server.js` currently read `process.env.DEEPSEEK_API_KEY` to gate UI/feature exposure. After R0, a deployment that uses ONLY pool keys (`DEEPSEEK_API_KEY_1..N`, no unsuffixed key) will incorrectly show as "not configured" and may disable LLM-powered features.

**`server.js:899`** — change:
```js
const hasKey = Boolean(process.env.DEEPSEEK_API_KEY);
```
to:
```js
const hasKey = hasAnyKey();
```

**`server.js:1842`** — same idea:
```js
const configured = Boolean(process.env.DEEPSEEK_API_KEY);
```
to:
```js
const configured = hasAnyKey();
```

Codex: import `hasAnyKey` from `./server/llm/deepseekClient` at the top of `server.js`. If `deepseekClient` is already required there for any other purpose, extend the existing destructuring; do NOT double-import.

Verify with grep after the change:
```bash
grep -n "process.env.DEEPSEEK_API_KEY" server.js
# Expected: zero results.
# (Only deepseekClient.js itself should read DEEPSEEK_API_KEY env vars directly.)
```

If grep finds anything else, route it through `hasAnyKey()` too.

## `.env.example` update

Append (or replace existing DEEPSEEK section):

```
# DeepSeek API keys. The client randomly selects one per call and rotates through
# the pool on retries. With N keys, your effective rate-limit headroom is N× a single
# free-tier key (~60 RPM × N).
#
# You may use either pattern; both are supported and combined (deduplicated by value):
#   - DEEPSEEK_API_KEY_1, DEEPSEEK_API_KEY_2, ... DEEPSEEK_API_KEY_N (preferred for multi-key)
#   - DEEPSEEK_API_KEY (single key, backward-compatible)
#
DEEPSEEK_API_KEY_1=sk-xxxxxxxxxxxxxxxxxxxxxxxx
DEEPSEEK_API_KEY_2=sk-xxxxxxxxxxxxxxxxxxxxxxxx
# ...add as many as you have
# DEEPSEEK_API_KEY=sk-xxxxxxxxxxxxxxxxxxxxxxxx  # legacy / single-key mode

DEEPSEEK_MODEL=deepseek-chat
DEEPSEEK_BASE_URL=https://api.deepseek.com
DEEPSEEK_TIMEOUT_MS=60000

# When R5 (concurrency gate) is also live, scale LLM_CONCURRENCY with the pool size.
# Each DeepSeek free-tier key handles roughly 60 RPM. With N keys, a safe target is
# LLM_CONCURRENCY in the range N*5 to N*8. The R5 default of 10 assumes 1-2 keys.
# Examples:
#   1 key  → LLM_CONCURRENCY=10  (R5 default)
#   5 keys → LLM_CONCURRENCY=25-40
#   8 keys → LLM_CONCURRENCY=40-60
LLM_CONCURRENCY=10
```

## Move dead `chatService.js` to archive

```bash
mkdir -p server/llm/_archive
git mv server/llm/chatService.js server/llm/_archive/chatService.js
```

Add a note at the top of the archived file (in the same PR, after the move):

```js
// ARCHIVED 2026-05-10: This module was an earlier streaming-aware DeepSeek client
// with key-pool rotation. Production code migrated to deepseekClient.js (which lost
// the key-pool feature; restored in R0 fix on this date). This file is kept as a
// reference implementation for streaming SSE — not currently imported anywhere.
// Per AGENTS.md deletion discipline, may be deleted in a separate PR after 7 days
// of stable operation if no streaming use-case emerges.
```

Verify nothing imports it after the move (this should already be true):

```bash
grep -rn "require.*chatService\|from.*chatService" server/ engine.js server.js --include="*.js"
# Expected: zero results
```

## Tests

Create `tests/deepseek_key_pool.test.js`:

```js
const test = require("node:test");
const assert = require("node:assert/strict");

// IMPORTANT: deepseekClient.js builds DEEPSEEK_KEY_POOL at module load.
// To test different pool configs, set process.env BEFORE require, or use
// child_process to spawn a fresh node and inspect logs.
//
// Approach used here: monkey-patch performChatCompletionRequest to capture
// which key was used per call, then exercise chatCompletion with a known pool.

test("pool: keys 1..N picked up from env", async () => {
  // Set env before require, use require.cache flush
  process.env.DEEPSEEK_API_KEY_1 = "key-1";
  process.env.DEEPSEEK_API_KEY_2 = "key-2";
  process.env.DEEPSEEK_API_KEY_3 = "key-3";
  delete process.env.DEEPSEEK_API_KEY;

  const modulePath = require.resolve("../server/llm/deepseekClient");
  delete require.cache[modulePath];
  const client = require("../server/llm/deepseekClient");

  // Inspect via a single call's captured key — see helper below.
  // (If your test harness doesn't allow re-requiring, use child_process to
  //  spawn `node -e "console.log(require('./server/llm/deepseekClient').DEEPSEEK_KEY_POOL_SIZE)"`
  //  with the env set and assert the stdout. Codex: pick whichever fits the
  //  existing test infrastructure.)

  // Rough check: fire 30 calls with a stub, expect each key roughly evenly used.
  const keysUsed = [];
  // ... patch performChatCompletionRequest to record keys, call chatCompletion 30 times,
  //     assert keysUsed contains all 3 unique keys with roughly even distribution.
});

test("pool: backward compat with single DEEPSEEK_API_KEY", async () => {
  // Only DEEPSEEK_API_KEY set, no _1..N → pool of size 1, behavior unchanged.
});

test("retry: switches to next key in pool", async () => {
  // Pool of 3 keys. Stub performChatCompletionRequest:
  //   - First call (any key) throws a 429-shaped error
  //   - Second call succeeds
  // Assert: the second call's key !== the first call's key.
});

test("retry: with single key, retries reuse the same key", async () => {
  // Pool of 1. Stub first call → 429, second call → success.
  // Assert: both calls use the same key. (Pool of 1 is a degenerate case.)
});

test("empty pool: throws clear error", async () => {
  // Unset all DEEPSEEK_API_KEY* env vars before require.
  // Assert: chatCompletion throws "DEEPSEEK_API_KEY not set" without making any HTTP call.
});

test("dedup: same key value in two slots counted once", async () => {
  // DEEPSEEK_API_KEY_1=foo, DEEPSEEK_API_KEY_2=foo, DEEPSEEK_API_KEY=bar
  // Pool size should be 2 (foo, bar), not 3.
});
```

**Codex: pick the test scaffolding pattern that matches existing repo tests.** If `tests/round1_wtp_decimal.test.js` and friends use plain `node:test`, follow that. If a different pattern, follow that. The test ASSERTIONS (what to verify) are the contract; the SCAFFOLDING (how to mock) is at your discretion.

If module re-loading is too painful, an acceptable alternative is to export `DEEPSEEK_KEY_POOL` from `deepseekClient.js` for test-only inspection:

```js
// at bottom of deepseekClient.js
module.exports = {
  chatCompletion,
  // Exposed for tests; do not use in production code.
  __TEST_GET_POOL: () => [...DEEPSEEK_KEY_POOL]
};
```

If you take this route, document it as such. Don't expose it as a public API.

## Acceptance criteria

1. **Pool discovery**: With `DEEPSEEK_API_KEY_1` … `DEEPSEEK_API_KEY_8` plus `DEEPSEEK_API_KEY` set in `.env`, the startup log prints `[DeepSeek] Loaded 9 API key(s) into rotation pool` (or fewer if values are duplicated). Numeric-ordered loading (`_2` before `_10`) is implemented as an internal-consistency property of the IIFE but does NOT affect runtime behavior — every call randomizes its starting index. No test should pin behavior to load order.

2. **Backward compat**: With only `DEEPSEEK_API_KEY` set (no suffixed variants), the startup log prints `[DeepSeek] Loaded 1 API key(s) into rotation pool`. `chatCompletion` behaves identically to pre-R0.

3. **No keys**: With no `DEEPSEEK_API_KEY*` env vars set, startup logs a warning. The first `chatCompletion` call throws a clear error and does not attempt any HTTP request.

4. **Random selection**: Fire 100 `chatCompletion` calls (mock `performChatCompletionRequest` to succeed instantly) with a pool of 4 keys. Each key is used 25 ± 10 times (chi-squared sanity check; not a strict requirement, just within reason for randomness).

5. **Retry switches keys**: Fire one `chatCompletion` call. Stub the first request to throw a 429, the second to succeed. The keys passed to the two `performChatCompletionRequest` calls are DIFFERENT (assuming pool size ≥ 2).

6. **Retry log clarity**: Retry log lines show `key idx X → Y` so an operator reading logs sees exactly which keys were tried.

7. **Dedup**: Two env vars with the same value produce a pool of size 1, not 2.

8. **`chatService.js` archived**: After the move, `git ls-files server/llm/chatService.js` returns nothing; `git ls-files server/llm/_archive/chatService.js` returns the file. No production code's `require` resolves to the new path (the archive directory is not imported from anywhere).

9. **`hasAnyKey()` integration**: After the change, `grep -n "process.env.DEEPSEEK_API_KEY" server.js` returns zero results. Booting the server with ONLY `DEEPSEEK_API_KEY_1` set (no unsuffixed key) starts cleanly, the startup banner reports DeepSeek as configured, and any UI feature that previously hid behind `process.env.DEEPSEEK_API_KEY` is enabled. Booting with NO DeepSeek env vars at all logs the warning and any "configured?" check returns false.

10. **Existing tests pass**: All tests under `tests/` continue to pass. No behavior change for any caller.

## Caveats / out of scope

- **Per-key rate-limit tracking**: This spec does NOT track per-key 429 history (i.e., "key A was 429'd 5 minutes ago, deprioritize it"). Adding that is a future optimization; the random+offset selection is good enough for current scale.

- **Streaming chat**: The archived `chatService.js` had streaming support (SSE). This spec does not restore streaming to `deepseekClient`. If a streaming use case emerges, the archived file is the reference implementation.

- **Per-key concurrency limits**: R5 (separate spec) adds a global concurrency gate. With R0 + R5 combined, the gate is global (not per-key). Per-key gates are a nice-to-have but require routing the gate based on which key is selected; out of scope here.

- **Schema change**: None.

## Final checklist for Codex

- [ ] `DEEPSEEK_KEY_POOL` collector added at top of `deepseekClient.js` with auto-discovery + backward-compat
- [ ] Startup log line shows pool size (or warning if zero)
- [ ] `chatCompletion` rewritten to pick a random starting key per call, advance offset on retry
- [ ] No `pickApiKey()` helper function — pool indexing is inline in `chatCompletion`'s retry loop
- [ ] `hasAnyKey()` defined and exported from `deepseekClient.js`
- [ ] `module.exports = { chatCompletion, hasAnyKey }`
- [ ] `server.js:899` and `server.js:1842` use `hasAnyKey()` instead of `process.env.DEEPSEEK_API_KEY`
- [ ] `grep -n "process.env.DEEPSEEK_API_KEY" server.js` returns zero results
- [ ] Retry log shows `key idx X → Y` transition
- [ ] `.env.example` updated with `DEEPSEEK_API_KEY_N` pattern, legacy `DEEPSEEK_API_KEY`, AND `LLM_CONCURRENCY` tuning note that scales with pool size
- [ ] `server/llm/chatService.js` moved to `server/llm/_archive/chatService.js` via `git mv`
- [ ] Archived file has the ARCHIVED comment at top
- [ ] `tests/deepseek_key_pool.test.js` created covering the 6 scenarios above, plus a 7th: `hasAnyKey()` returns true with pool-only config (no unsuffixed key)
- [ ] `grep -rn "require.*chatService" server/` returns zero hits
- [ ] All existing tests still pass
- [ ] Manual smoke 1: set `DEEPSEEK_API_KEY_1=test1`, `DEEPSEEK_API_KEY_2=test2` (NO unsuffixed key), start server, confirm log says "Loaded 2 API key(s)" AND any "DeepSeek configured" UI/banner shows correctly
- [ ] Manual smoke 2: unset all `DEEPSEEK_API_KEY*` env vars, start server, confirm warning is logged and any "configured?" check reports false
