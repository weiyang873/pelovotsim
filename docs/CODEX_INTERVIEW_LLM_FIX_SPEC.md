# Fix Spec — Interview LLM Failures & Concurrency Races

**Date:** 2026-05-10 (R4/R5 added 2026-05-10)
**Audience:** Codex (the implementing agent)
**Source:** `CODE_AUDIT_REPORT.md` findings R2, R3, R4, R5, R7, R8

This spec is self-contained — do not assume context outside this document. Read all six sections before starting; the fixes interact (R7/R8 are in the same handler; R2/R3 share the same migration pattern; R5 should land before or with R7/R8 to avoid thundering-herd amplification when retries are exposed to users).

## Summary of bugs being fixed

Latent data-corruption and load-amplification bugs that surface under concurrency or LLM flakiness:

| ID | One-line description | Severity |
|----|---------------------|----------|
| R2 | `member_submissions` has no `UNIQUE(team_id, member_id)`; concurrent submit produces duplicate rows, inflating team submission count | Critical |
| R3 | `vp_iterations` has no `UNIQUE(team_id, iteration)`; concurrent VP coach appends produce duplicate iteration numbers | Critical |
| R4 | LLM caches (`tag_cache.json`, `score_cache.json`) are read-modify-written non-atomically; concurrent writes lose entries; a torn write resets the entire cache to `{}` | High |
| R5 | No global concurrency limit on `chatCompletion`; 60 students fan out 60-180 simultaneous DeepSeek calls, triggering 429 storms with thundering-herd retries | High |
| R7 | `interviewReply` swallows `chatCompletion` failures with `catch (_) {}` and persists a hardcoded Chinese fallback string into the conversation history as if it were a real persona reply | High |
| R8 | `extractInterviewResult` failure returns `null` but the session is still marked `is_complete = true` with default radar (5/5/5, evi=0.7) — silently scoring an unscored interview | High |

## Suggested implementation order

1. **R5** (concurrency gate) — ship first. Reduces DeepSeek pressure for every other fix and prevents users from seeing R7/R8's new "please retry" banners en masse the first time the system is under load.
2. **R2** (schema + handler) — independent, mechanical
3. **R3** (schema + handler) — same pattern as R2
4. **R8 + R7** (interview semantics) — same handler, single PR
5. **R4** (migrate caches to Postgres) — independent, lower urgency than R2/R3/R7/R8 because it's a cost/perf bug not a correctness bug, but ship before the next 60-student class

R7 and R8 share the same function (`interviewReply`); land them in one PR. R2, R3, R4, R5 can each be a separate PR.

## Conventions used in this repo

- DB layer: `runSql(text)` + `sqlQuote(value)` from `server/db/pgSql.js`. We are NOT migrating to parameterized queries in this PR — keep using `runSql`/`sqlQuote`.
- Schema is defined in two places that must be kept in sync:
  - `server/multiplayer/teamManager.js` (for `member_submissions`, `team_members`, `teams`, etc.) — runtime `ensureSchema()` runs at boot.
  - `scripts/migrations/init-postgres-schema.js` — one-shot init script for a fresh DB.
  - `server/multiplayer/vpIterationStore.js` has its own `ensureSchema()` (for `vp_iterations`).
- All `CREATE` statements in `ensureSchema()` use `IF NOT EXISTS` so boot is idempotent.
- HTTP responses go through `makeResponse(status, body)`. Errors are typically `{ ok: false, error: "..." }`.
- LLM calls go through `withLlmLogging({...}, () => chatCompletion(messages, opts))`.

---

# Fix R2 — `member_submissions` deduplication

## Goal

Concurrent `POST /api/team/:teamId/submitPhase1` requests with the same `(teamId, memberId)` MUST NOT produce duplicate rows. Both requests should return `ok: true` with the same `submission_id` (idempotent). `countTeamSubmissions(teamId)` MUST return one row per (team_id, member_id).

## Why

`server/routes/teamRoutes.js:752-789` does check-then-insert without a DB-level constraint. Two simultaneous requests can both pass `readSubmission(teamId, memberId)` (returns nothing), then both INSERT with different random `id`s (`cryptoRandomId()`). `member_submissions` ends up with two rows for one member. `countTeamSubmissions` returns 6 for a 5-person team, the team prematurely auto-advances to `phase2` (line 794), and the actual fifth member is silently locked out.

## Files to change

1. `server/multiplayer/teamManager.js` — `ensureSchema()` near line 64-74
2. `scripts/migrations/init-postgres-schema.js` — `member_submissions` block near line 184-194
3. `server/routes/teamRoutes.js` — `submitPhase1` near line 747-814
4. NEW: `scripts/migrations/dedup-member-submissions.js` — one-shot dedup before the unique index can be created on existing prod DB

## Schema change

Add this in BOTH `teamManager.js`'s `ensureSchema()` and `init-postgres-schema.js`, immediately after the `CREATE TABLE IF NOT EXISTS member_submissions (...)` block:

```sql
CREATE UNIQUE INDEX IF NOT EXISTS uq_member_submissions_team_member
  ON member_submissions (team_id, member_id);
```

Use `CREATE UNIQUE INDEX` rather than `ALTER TABLE ADD CONSTRAINT` because:
- `IF NOT EXISTS` is supported on `CREATE INDEX` (idempotent on every boot).
- The existing `id TEXT PRIMARY KEY` column stays untouched (no breaking change for code that joins on `id`).
- We can use it as the conflict target in `ON CONFLICT (team_id, member_id)`.

## Pre-existing duplicates

If the prod DB already has duplicate `(team_id, member_id)` rows, `CREATE UNIQUE INDEX` will fail with `23505`. To make boot self-healing:

In `teamManager.js`'s `ensureSchema()`, wrap the unique-index creation in a try/catch that, on `23505`, runs the dedup logic inline (keep the earliest-`submitted_at` row per `(team_id, member_id)`, delete the rest), then retries the index creation once:

```js
try {
  await runSql(`
    CREATE UNIQUE INDEX IF NOT EXISTS uq_member_submissions_team_member
      ON member_submissions (team_id, member_id);
  `);
} catch (err) {
  if (err.code === '23505' || /could not create unique index/i.test(err.message)) {
    console.warn("[ensureSchema] member_submissions has duplicate (team_id, member_id) rows; deduping");
    await runSql(`
      DELETE FROM member_submissions
      WHERE id NOT IN (
        SELECT MIN(id) FROM member_submissions
        WHERE team_id IS NOT NULL AND member_id IS NOT NULL
        GROUP BY team_id, member_id
      );
    `);
    // Note: we use MIN(id) which is lexicographic — IDs are roughly time-ordered
    // (`${Date.now().toString(36)}_${random}`) so MIN(id) ≈ earliest. If you want
    // strict earliest, use the dedup script in scripts/migrations/ instead.
    await runSql(`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_member_submissions_team_member
        ON member_submissions (team_id, member_id);
    `);
  } else {
    throw err;
  }
}
```

Also create `scripts/migrations/dedup-member-submissions.js` as a one-shot tool (Codex: model after `scripts/migrations/init-postgres-schema.js` for boilerplate). It should:
1. Connect using `server/db/pgSql.js`.
2. `SELECT team_id, member_id, COUNT(*) FROM member_submissions GROUP BY team_id, member_id HAVING COUNT(*) > 1` — log duplicates.
3. Per group, keep the row with the smallest `submitted_at`, delete the rest.
4. Print summary.
5. Exit 0.

## Handler change

Replace `submitPhase1` in `server/routes/teamRoutes.js:747-814`. Two changes:

**Change 1: Sequential re-submit returns idempotent success, not 400.** Currently re-submitting (after the first finished) returns `400 "already submitted"`. With the unique index, that error message is misleading (it's not actually a user error — it's a no-op). Make it return `200 ok=true, idempotent=true` with the existing submission's data. This also simplifies the race fix below.

**Change 2: INSERT uses `ON CONFLICT DO NOTHING RETURNING`; if INSERT was a no-op, re-read the winner row.**

```js
async function submitPhase1(teamId, memberId, body) {
  try {
    const team = await getTeam(teamId);
    if (!team) return makeResponse(404, { ok: false, error: "team not found" });
    await assertMemberInTeam(teamId, memberId);

    // Idempotent re-submit: if a submission already exists, return its data.
    const existing = await readSubmission(teamId, memberId);
    if (existing) {
      const submittedCount = await countTeamSubmissions(teamId);
      const teamSize = Number(team.team_size || 0);
      return makeResponse(200, {
        ok: true,
        idempotent: true,
        submission_id: existing.id,
        personal_gm_max: Number(existing.personal_gm_max),
        submitted_count: submittedCount,
        team_size: teamSize,
        team_status_updated_to_phase2: false,
        ...buildLeaderMeta(team, memberId)
      });
    }

    // Validate & compute (unchanged from current code)
    const payload = body || {};
    const gridId = String(payload.grid_id || "").trim();
    const architecture = String(payload.architecture || "").trim();
    const outline = String(payload.vp_outline || "").trim();
    const who = String(payload.who || outline || "").trim();
    const pain = String(payload.pain || outline || "").trim();
    const how = String(payload.how || outline || "").trim();
    const vpDraft = `WHO: ${who}\nPAIN: ${pain}\nHOW: ${how}`.trim();
    if (!gridId) return makeResponse(400, { ok: false, error: "grid_id required" });
    if (!architecture) return makeResponse(400, { ok: false, error: "architecture required" });
    if (!who || !pain || !how) return makeResponse(400, { ok: false, error: "who, pain, how required" });

    const calc = computePersonalGmMax({ gridId, architecture });

    const id = cryptoRandomId();
    const now = new Date().toISOString();

    // Race-safe INSERT. If a concurrent request won, ON CONFLICT DO NOTHING
    // makes this a no-op; we then re-read the winning row.
    const inserted = await runSql(`
      INSERT INTO member_submissions (
        id, member_id, team_id, grid_id, architecture, channel_pref, vp_draft, personal_gm_max, submitted_at
      ) VALUES (
        ${sqlQuote(id)},
        ${sqlQuote(memberId)},
        ${sqlQuote(teamId)},
        ${sqlQuote(gridId)},
        ${sqlQuote(normalizeArchitecture(architecture))},
        NULL,
        ${sqlQuote(vpDraft)},
        ${Number(calc.gmMax)},
        ${sqlQuote(now)}
      )
      ON CONFLICT (team_id, member_id) DO NOTHING
      RETURNING id, personal_gm_max;
    `);

    let actualId, actualGmMax;
    if (Array.isArray(inserted) && inserted.length > 0) {
      // We won the race.
      actualId = inserted[0].id;
      actualGmMax = Number(inserted[0].personal_gm_max);
    } else {
      // Lost the race — read the winner.
      const winner = await readSubmission(teamId, memberId);
      if (!winner) {
        // Should be impossible, but guard anyway.
        return makeResponse(500, { ok: false, error: "submission lost after conflict" });
      }
      actualId = winner.id;
      actualGmMax = Number(winner.personal_gm_max);
    }

    const submittedCount = await countTeamSubmissions(teamId);
    const teamSize = Number(team.team_size || 0);
    let statusUpdated = false;
    if (submittedCount >= teamSize && team.status !== "phase2") {
      await updateTeamStatus(teamId, "phase2");
      await assignRound1LeaderIfNeeded(teamId);
      statusUpdated = true;
    }

    const updatedTeam = statusUpdated ? await getTeam(teamId) : team;

    return makeResponse(200, {
      ok: true,
      submission_id: actualId,
      personal_gm_max: actualGmMax,
      submitted_count: submittedCount,
      team_size: teamSize,
      team_status_updated_to_phase2: statusUpdated,
      ...buildLeaderMeta(updatedTeam, memberId)
    });
  } catch (e) {
    return makeResponse(400, { ok: false, error: e.message });
  }
}
```

## Acceptance criteria

1. After boot on a fresh DB: `\d member_submissions` shows `uq_member_submissions_team_member` as a unique index.
2. Boot on a DB with pre-existing dups: dedup runs automatically, then index is created, no manual intervention.
3. Two simultaneous `POST /api/team/:teamId/submitPhase1` for the same `(teamId, memberId)` both return `200 ok=true`. DB has exactly one row. Both responses report the same `submission_id`.
4. Sequential re-submit returns `200 ok=true, idempotent=true` (NOT `400 already submitted`).
5. After a 5-person team has 5 distinct members submit (each once), `countTeamSubmissions` returns 5; `team.status` advances to `phase2` exactly once.
6. Existing tests under `tests/` and `tests/e2e/` still pass.

---

# Fix R3 — `vp_iterations` race

## Goal

Concurrent `appendIteration({ teamId, ... })` calls MUST produce a strict gap-free sequence per team. No two rows may share the same `(team_id, iteration)`.

## Why

`server/multiplayer/vpIterationStore.js:74-141` reads the latest iteration, computes `latest+1` in JavaScript, then INSERTs. Two concurrent calls both read iteration N, both compute N+1, both INSERT. The schema has only a non-unique index (`idx_vp_iterations_team_created`) so the DB accepts both. Downstream "find iteration N+1" queries become non-deterministic.

## Files to change

1. `server/multiplayer/vpIterationStore.js` — `ensureSchema()` and `appendIteration()`

## Schema change

In `vpIterationStore.js:10-37`'s `ensureSchema()`, after the existing `CREATE INDEX`, add:

```sql
CREATE UNIQUE INDEX IF NOT EXISTS uq_vp_iterations_team_iteration
  ON vp_iterations (team_id, iteration);
```

Same self-healing wrapper as R2 — if the unique-index creation fails on existing duplicates, dedup (keep earliest `created_at` per `(team_id, iteration)`) then retry. Likely no dups exist in practice (the race is rare), but be defensive:

```js
try {
  await runSql(`
    CREATE UNIQUE INDEX IF NOT EXISTS uq_vp_iterations_team_iteration
      ON vp_iterations (team_id, iteration);
  `);
} catch (err) {
  if (err.code === '23505' || /could not create unique index/i.test(err.message)) {
    console.warn("[vpIterationStore.ensureSchema] dedup vp_iterations");
    await runSql(`
      DELETE FROM vp_iterations
      WHERE id NOT IN (
        SELECT DISTINCT ON (team_id, iteration) id
        FROM vp_iterations
        ORDER BY team_id, iteration, created_at ASC
      );
    `);
    await runSql(`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_vp_iterations_team_iteration
        ON vp_iterations (team_id, iteration);
    `);
  } else {
    throw err;
  }
}
```

## Handler change

Replace `appendIteration` (`vpIterationStore.js:74-141`) with a retry loop that catches `23505` from PG, re-reads `latest`, and tries again.

Keep the existing idempotency short-circuit (lines 81-91) — if the previous iteration has the same `trigger`, `vpAfter`, and `scoreAfter`, return `latest` without inserting. This block already handles the legit retry case (user double-clicked "iterate" with no changes between).

```js
async function appendIteration(entry) {
  await ensureSchema();
  const teamId = String(entry?.teamId || "").trim();
  if (!teamId) throw new Error("teamId required");

  const MAX_ATTEMPTS = 5;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    const latest = await getLatestIteration(teamId);
    const vpAfter = String(entry?.vpAfter || "").trim();
    const nextScoreAfter = entry?.scoreAfter == null ? null : Number(entry.scoreAfter);

    // Existing idempotency short-circuit — keep as-is.
    if (
      latest &&
      latest.trigger === String(entry?.trigger || "").trim() &&
      String(latest.vpAfter || "").trim() === vpAfter &&
      (
        (latest.scoreAfter == null && nextScoreAfter == null) ||
        (Number.isFinite(latest.scoreAfter) && Number.isFinite(nextScoreAfter) && latest.scoreAfter === nextScoreAfter)
      )
    ) {
      return latest;
    }

    const row = {
      id: crypto.randomUUID(),
      teamId,
      sessionId: String(entry?.sessionId || "").trim() || null,
      memberId: String(entry?.memberId || "").trim() || null,
      iteration: Number((latest?.iteration || 0) + 1),
      trigger: String(entry?.trigger || "").trim() || "unknown",
      speakerName: String(entry?.speakerName || "").trim() || null,
      speakerPersona: String(entry?.speakerPersona || "").trim() || null,
      vpBefore: String(entry?.vpBefore || latest?.vpAfter || "").trim() || null,
      vpAfter: vpAfter || null,
      scoreBefore: entry?.scoreBefore == null ? latest?.scoreAfter ?? null : Number(entry.scoreBefore),
      scoreAfter: nextScoreAfter,
      scoreC: entry?.scoreC == null ? null : Number(entry.scoreC),
      scoreG: entry?.scoreG == null ? null : Number(entry.scoreG),
      scoreE: entry?.scoreE == null ? null : Number(entry.scoreE),
      sourceIteration: String(entry?.sourceIteration || "").trim() || null,
      usedBestIteration: entry?.usedBestIteration === true,
      createdAt: nowIso()
    };

    try {
      await runSql(`
        INSERT INTO vp_iterations (
          id, team_id, session_id, member_id, iteration, trigger, speaker_name, speaker_persona,
          vp_before, vp_after, score_before, score_after, score_c, score_g, score_e,
          source_iteration, used_best_iteration, created_at
        ) VALUES (
          ${sqlQuote(row.id)},
          ${sqlQuote(row.teamId)},
          ${sqlQuote(row.sessionId)},
          ${sqlQuote(row.memberId)},
          ${row.iteration},
          ${sqlQuote(row.trigger)},
          ${sqlQuote(row.speakerName)},
          ${sqlQuote(row.speakerPersona)},
          ${sqlQuote(row.vpBefore)},
          ${sqlQuote(row.vpAfter)},
          ${row.scoreBefore == null ? "NULL" : Number(row.scoreBefore)},
          ${row.scoreAfter == null ? "NULL" : Number(row.scoreAfter)},
          ${row.scoreC == null ? "NULL" : Number(row.scoreC)},
          ${row.scoreG == null ? "NULL" : Number(row.scoreG)},
          ${row.scoreE == null ? "NULL" : Number(row.scoreE)},
          ${sqlQuote(row.sourceIteration)},
          ${row.usedBestIteration ? "TRUE" : "FALSE"},
          ${sqlQuote(row.createdAt)}
        );
      `);
      return row;
    } catch (err) {
      if (err.code === '23505' && attempt < MAX_ATTEMPTS - 1) {
        // A concurrent appendIteration won iteration N+1; loop and try N+2.
        continue;
      }
      throw err;
    }
  }
  throw new Error(`appendIteration: exceeded ${MAX_ATTEMPTS} retries for team ${teamId}`);
}
```

## Acceptance criteria

1. After boot: `\d vp_iterations` shows `uq_vp_iterations_team_iteration` as a unique index.
2. Two simultaneous `appendIteration` calls produce iterations N+1 and N+2 respectively (NOT two rows of N+1). Both return their respective row objects.
3. Existing idempotency short-circuit still works: calling `appendIteration` twice with the same `trigger + vpAfter + scoreAfter` returns the existing latest row both times, without inserting.
4. Existing tests pass.

---

# Fix R8 — extractor failure must not silently mark complete

## Goal

When `extractInterviewResult` fails (LLM error, empty response, unparseable JSON), the interview session MUST NOT be marked `is_complete = true`. The conversation history should be preserved so the user can request a re-score without redoing the interview. The user-facing API must return an explicit "scoring failed, retry" signal.

## Why

`server/routes/round2Routes.js:1107-1145` catches all errors in `extractInterviewResult`, sets `extracted = null`, but still calls `mapEvidenceToResult({...extracted, ...})` which fills in default radar values (around 5/5/5) and `evi=0.7`. The caller at line 2881-2898 sets `is_complete = true` based purely on `round >= MAX_INTERVIEW_TURNS`, regardless of whether scoring actually succeeded. Result: failed scoring is silently committed as a complete session with bogus default scores.

## Files to change

1. `server/routes/round2Routes.js` — `extractInterviewResult` near line 1107-1145, `interviewReply` near line 2793-2920, plus a new exported function `rescoreInterview`
2. `server.js` — wire the new `rescoreInterview` route into `handleApi`. Find the existing `/api/round2/interview/reply` route and add `/api/round2/interview/rescore` next to it.
3. Frontend: `client/src/api/round2Api.js` and the round2 interview UI component (Codex: grep for callers of `interviewReply` in `client/src/` — likely `MultiplayerFlow.jsx` or `Round2Flow.jsx`).

## Design decisions

- **No schema change to `interview_sessions`.** We use `is_complete = false` together with `round_no === MAX_INTERVIEW_TURNS` and `result == null` as the predicate for "needs rescore". This is `needsRescore = (round_no >= MAX_INTERVIEW_TURNS && !is_complete)`.
- **Conversation history is preserved on scoring failure.** We save the session with the new history but `is_complete = false, result = null`. This lets the user retry scoring without losing the interview.
- **Error class** for distinguishing scoring failure from other errors. Define `InterviewScoringError` at the top of `round2Routes.js`.

## Code change

### Define error class (top of `round2Routes.js`, near other module-level constants)

```js
class InterviewScoringError extends Error {
  constructor(reason, cause) {
    super(`interview scoring failed: ${reason}`);
    this.name = 'InterviewScoringError';
    this.code = 'INTERVIEW_SCORING_FAILED';
    this.reason = reason;
    if (cause) this.cause = cause;
  }
}
```

### Replace `extractInterviewResult` (`round2Routes.js:1107-1145`)

Make it throw `InterviewScoringError` instead of returning a result with default radar:

```js
async function extractInterviewResult({ gridId, architecture, memberDims, history }) {
  const conversation = (history || [])
    .map((m) => `${m.role === "user" ? "学生" : m.speaker || "用户"}：${m.text || ""}`)
    .join("\n");

  let extracted;
  try {
    const messages = buildExtractInterviewMessages({ gridId, memberDims, conversation });
    const raw = await withLlmLogging({
      caller: "round2Routes.extractInterviewResult",
      teamId: null,
      memberId: null,
      messages
    }, () => chatCompletion(messages, { temperature: 0.2, max_tokens: 2500, maxRetries: 3 }));
    const txt = String(raw || "").replace(/```json|```/g, "").trim();
    if (!txt) {
      throw new InterviewScoringError('llm_empty');
    }
    const start = txt.indexOf("{");
    const end = txt.lastIndexOf("}");
    const jsonText = start >= 0 && end > start ? txt.slice(start, end + 1) : txt;
    let parsed;
    try {
      parsed = JSON.parse(jsonText);
    } catch (parseErr) {
      throw new InterviewScoringError('llm_unparseable', parseErr);
    }
    extracted = cleanExtractedPayload(parsed);
    if (!extracted || typeof extracted !== 'object') {
      throw new InterviewScoringError('llm_invalid_shape');
    }
  } catch (err) {
    if (err instanceof InterviewScoringError) throw err;
    console.error("[extractInterviewResult] LLM failed:", err.message, {
      gridId: String(gridId || ""),
      architecture: String(architecture || ""),
      memberDims: Array.isArray(memberDims) ? memberDims : []
    });
    throw new InterviewScoringError('llm_failed', err);
  }

  console.log("[Round2][TagExtract]", JSON.stringify({
    rawGridId: String(gridId || ""),
    architecture: String(architecture || ""),
    memberDims: Array.isArray(memberDims) ? memberDims : [],
    tags: normalizeExtractedTags(extracted?.tags, memberDims),
    missingDimensions: Array.isArray(extracted?.missing_dimensions) ? extracted.missing_dimensions : []
  }));

  return mapEvidenceToResult({ gridId, architecture, memberDims, extracted, history, conversation });
}
```

### Modify the scoring branch in `interviewReply` (`round2Routes.js:2880-2920`)

Replace the existing block:

```js
const history = [...historyBase, { role: "user", speaker: "学生", text: message }, { role: "assistant", speaker, text: reply }];
const isComplete = round >= MAX_INTERVIEW_TURNS;
const result = isComplete
  ? await extractInterviewResult({ ... })
  : null;

await saveInterviewSession({ ...session, history, round_no: round, is_complete: isComplete, result, updated_at: nowIso() });
```

with:

```js
const history = [
  ...historyBase,
  { role: "user", speaker: "学生", text: message },
  { role: "assistant", speaker, text: reply }
];
const reachedLimit = round >= MAX_INTERVIEW_TURNS;

let result = null;
let scoringError = null;
let isComplete = false;

if (reachedLimit) {
  try {
    result = await extractInterviewResult({
      gridId: String(recapData.final_grid_id || "ToB_Differentiation_Adult"),
      architecture: String(recapData.architecture || ""),
      memberDims: session.member_dims,
      history
    });
    isComplete = true;
  } catch (err) {
    if (err instanceof InterviewScoringError) {
      scoringError = err.reason;
      // Preserve history so the user can retry scoring without re-doing the interview.
      isComplete = false;
    } else {
      throw err;
    }
  }
}

await saveInterviewSession({
  ...session,
  history,
  round_no: round,
  is_complete: isComplete,
  result,
  updated_at: nowIso()
});

const syncResult = await syncMemberInterviewState(session.team_id, session.member_id);

const responseBody = {
  ok: !scoringError,
  reply,
  speaker,
  round,
  isComplete,
  canEnd: round >= MIN_TURNS_TO_END,
  reachedLimit,
  needsRescore: reachedLimit && !isComplete,
  scoringError: scoringError || undefined,
  progress: syncResult.progress,
  // ... preserve any other existing fields from the original return body ...
};
return makeResponse(scoringError ? 503 : 200, responseBody);
```

**Codex: read the existing return body at line 2902+ and preserve all of its fields. The only changes are: add `needsRescore`, add `scoringError`, and use 503 status when scoring fails.**

### New function: `rescoreInterview`

Add to `round2Routes.js` and to the module exports at the bottom of the file:

```js
async function rescoreInterview(body) {
  try {
    const sessionId = String(body?.sessionId || "").trim();
    if (!sessionId) return makeResponse(400, { ok: false, error: "sessionId required" });

    const session = await getInterviewSession(sessionId);
    if (!session) return makeResponse(404, { ok: false, error: "session not found" });

    if (session.is_complete) {
      return makeResponse(200, {
        ok: true,
        idempotent: true,
        isComplete: true,
        radar: session.result?.radar,
        tags: session.result?.tags,
        evi: session.result?.evi
      });
    }

    if (Number(session.round_no || 0) < MAX_INTERVIEW_TURNS) {
      return makeResponse(400, {
        ok: false,
        error: "interview not yet at final turn",
        round_no: session.round_no
      });
    }

    const recapRes = await recap({ teamId: session.team_id });
    const recapData = recapRes?.body?.ok ? recapRes.body : {};

    let result;
    try {
      result = await extractInterviewResult({
        gridId: String(recapData.final_grid_id || "ToB_Differentiation_Adult"),
        architecture: String(recapData.architecture || ""),
        memberDims: session.member_dims,
        history: session.history
      });
    } catch (err) {
      if (err instanceof InterviewScoringError) {
        return makeResponse(503, {
          ok: false,
          scoringError: err.reason,
          retry: true,
          message: "评分失败，请稍后重试"
        });
      }
      throw err;
    }

    await saveInterviewSession({
      ...session,
      is_complete: true,
      result,
      updated_at: nowIso()
    });

    await syncMemberInterviewState(session.team_id, session.member_id);

    return makeResponse(200, {
      ok: true,
      isComplete: true,
      radar: result?.radar,
      tags: result?.tags,
      evi: result?.evi
    });
  } catch (e) {
    return makeResponse(400, { ok: false, error: e.message });
  }
}

module.exports = {
  // ... existing exports ...
  rescoreInterview,
};
```

### Wire the route in `server.js`

Find the existing handler for `/api/round2/interview/reply` (search for `interview/reply` in `server.js`) and add a sibling route immediately below it:

```js
if (req.method === "POST" && url.pathname === "/api/round2/interview/rescore") {
  const body = await readBody(req);
  const out = await Round2Routes.rescoreInterview(body);
  return sendJson(res, out.status, out.body);
}
```

Match the exact dispatch style used for the sibling `/reply` route.

### Frontend changes

In `client/src/api/round2Api.js`, add a new function `rescoreInterview(sessionId)` that POSTs to `/api/round2/interview/rescore`. Mirror the shape of the existing `interviewReply` API client function.

In the interview UI component (Codex: find it via `grep -rn "interviewReply\|isComplete" client/src/`), handle the new response shape:

- If `response.ok === false && response.scoringError` (503 with scoringError set): show a retry banner "评分失败，请点击重试". On click, call `rescoreInterview(sessionId)`.
- If `response.needsRescore === true`: same retry UI.
- Existing `isComplete === true` flow: unchanged.

## Acceptance criteria

1. When `extractInterviewResult` throws `InterviewScoringError`, `interviewReply` returns 503 with `ok: false, needsRescore: true, scoringError: <reason>`. Session is saved with `is_complete: false, result: null` and full conversation history including the new student message and persona reply.
2. `POST /api/round2/interview/rescore` with a valid `sessionId` of a session where `round_no >= MAX_INTERVIEW_TURNS && !is_complete`:
   - On extractor success: marks session complete, returns radar/tags/evi.
   - On extractor failure: returns 503 with `scoringError`. Session unchanged.
3. `rescoreInterview` on an already-complete session: returns 200 with `idempotent: true` and existing result.
4. `rescoreInterview` on a session below `MAX_INTERVIEW_TURNS`: returns 400 with `"interview not yet at final turn"`.
5. Frontend shows retry banner instead of "interview complete" when `needsRescore` is true.
6. Existing tests pass (Codex: any test that asserts `isComplete=true` after `MAX_INTERVIEW_TURNS` regardless of LLM behavior must be updated to mock the LLM success).

---

# Fix R7 — interview reply must not silently substitute hardcoded fallback

## Goal

When the LLM call for the persona's reply fails (network, timeout, 429, empty response), `interviewReply` MUST surface the error to the user. It MUST NOT save a hardcoded fallback string into the conversation history. The session's `round_no`, `history`, and `is_complete` MUST remain unchanged on LLM failure.

## Why

`server/routes/round2Routes.js:2848-2857` initializes `reply` to a hardcoded Chinese sentence ("对我来说，平时相处起来别太折腾最重要..."), then attempts the LLM call inside `try { ... } catch (_) {}`. If the LLM call throws (or returns empty), the hardcoded string remains, gets pushed into `history` at line 2880, and is persisted at line 2891 as if the persona had actually said it. Subsequent turns operate on the poisoned history.

## Files to change

1. `server/routes/round2Routes.js` — `interviewReply` near line 2793-2920 (overlaps with R8 changes; do these in the same PR)
2. Frontend (same touchpoints as R8)

## Code change

In `interviewReply`, replace the LLM call block at line 2848-2857:

**Before:**
```js
let reply = "对我来说，平时相处起来别太折腾最重要。真遇到状况的时候也得靠谱，不然我很难长期接受。";
try {
  const out = await withLlmLogging({...}, () => chatCompletion(llmMessages, { temperature: 0.7, max_tokens: 300 }));
  if (String(out || "").trim()) reply = String(out).trim();
} catch (_) {}
```

**After:**
```js
let reply;
try {
  const out = await withLlmLogging({
    caller: "round2Routes.interviewReply",
    teamId: session?.team_id || session?.teamId || null,
    memberId: session?.member_id || session?.memberId || null,
    messages: llmMessages
  }, () => chatCompletion(llmMessages, { temperature: 0.7, max_tokens: 300 }));
  reply = String(out || "").trim();
  if (!reply) {
    throw new Error("llm returned empty reply");
  }
} catch (err) {
  console.error("[interviewReply] LLM call failed:", err.message, {
    sessionId: session?.id,
    teamId: session?.team_id,
    memberId: session?.member_id,
    round
  });
  return makeResponse(503, {
    ok: false,
    error: "llm_unavailable",
    retry: true,
    message: "网络繁忙，请稍后重试"
  });
}
```

The persona-leakage retry block (`round2Routes.js:2858-2877`) keeps its existing `try { ... } catch (_) {}` behavior — that's a best-effort refinement of an already-good reply, not the source of truth. If a leakage retry fails, we fall through to the existing generic-question fallback at line 2875-2877. That's fine.

The remainder of `interviewReply` (history append, scoring branch from R8, `saveInterviewSession`, return body) only runs when `reply` is set from a real LLM response.

## Acceptance criteria

1. Mock `chatCompletion` to throw on the primary call: `interviewReply` returns 503 with `{ ok: false, error: "llm_unavailable", retry: true }`. No row is written to `interview_sessions`. `round_no`, `history`, and `is_complete` of the existing session row are unchanged.
2. Mock `chatCompletion` to return empty string: same behavior as throw — 503, no DB write.
3. Mock `chatCompletion` to succeed: normal flow continues; reply is the LLM output (after persona-leakage and life-first sanitization).
4. Mock the persona-leakage retry call to throw, but the original reply is fine (no leakage): normal flow continues using the original reply.
5. Frontend: on 503 with `retry: true`, show a "请重试" banner; do NOT advance the conversation UI. On success, normal flow.
6. The hardcoded string `"对我来说，平时相处起来别太折腾最重要"` no longer appears anywhere in `round2Routes.js`. Grep should return zero hits.

## Frontend implication

Same retry UI as R8 (a banner + retry button). The actions diverge:
- R7 retry → re-POST the same student message to `/api/round2/interview/reply`
- R8 retry → POST to `/api/round2/interview/rescore` (no message; just sessionId)

Codex: in the UI, distinguish by checking which field is set in the error response: `error === "llm_unavailable"` → R7 retry; `scoringError` set or `needsRescore === true` → R8 retry.

---

# Tests

Add new tests under `tests/`:

## `tests/concurrency.test.js` (new)

```js
const test = require("node:test");
const assert = require("node:assert/strict");
// Codex: use the existing test scaffolding pattern from tests/round1_wtp_decimal.test.js etc.
// You may need a real PG instance (use pg_tmp or DATABASE_URL pointed at a test DB).

test("R2: concurrent submitPhase1 produces exactly one row", async () => {
  // 1. Create a team with one member.
  // 2. Fire 5 simultaneous submitPhase1 calls with the same memberId & valid body.
  //    Use Promise.all.
  // 3. Assert: all 5 responses have ok=true.
  // 4. Assert: SELECT COUNT(*) FROM member_submissions WHERE team_id=... AND member_id=... returns 1.
  // 5. Assert: all 5 responses report the same submission_id.
});

test("R3: concurrent appendIteration produces strict sequence", async () => {
  // 1. Create a team.
  // 2. Fire 5 simultaneous appendIteration calls with DIFFERENT vpAfter strings (so the
  //    idempotency short-circuit doesn't kick in).
  // 3. Assert: SELECT iteration FROM vp_iterations ORDER BY iteration returns 1,2,3,4,5
  //    with no duplicates.
});
```

## `tests/interview_failure_modes.test.js` (new)

```js
const test = require("node:test");
const assert = require("node:assert/strict");
// Codex: stub out chatCompletion via a module mock or a dependency-injection seam.
// Likely needs a small refactor to make chatCompletion injectable in interviewReply.
// Acceptable approach: monkey-patch require cache for "../llm/deepseekClient".

test("R7: chatCompletion throws → 503, no DB write", async () => {
  // 1. Create an interview session at round=3.
  // 2. Stub chatCompletion to reject.
  // 3. Call interviewReply.
  // 4. Assert: status === 503, body.error === "llm_unavailable".
  // 5. Assert: session row in DB is unchanged (round_no still 3, history same length).
});

test("R7: chatCompletion returns empty → 503, no DB write", async () => {
  // Same shape, with stub returning "" or "   ".
});

test("R8: extractor throws on final turn → session saved with is_complete=false, history preserved", async () => {
  // 1. Create session at round=9 (one before MAX).
  // 2. Stub chatCompletion to return a normal reply for the persona call,
  //    but throw for the extract call.
  // 3. Call interviewReply with a final message.
  // 4. Assert: status === 503, body.needsRescore === true.
  // 5. Assert: session.is_complete === false, session.round_no === 10,
  //    session.history.length grew by 2.
});

test("R8 rescore: succeeds when extractor recovers", async () => {
  // 1. Set up a session in needs-rescore state (round=10, is_complete=false).
  // 2. Stub chatCompletion (extract call) to succeed with a valid JSON.
  // 3. POST /api/round2/interview/rescore { sessionId }.
  // 4. Assert: status === 200, body.isComplete === true.
  // 5. Assert: session.is_complete === true, session.result has radar populated.
});

test("R8 rescore: idempotent on already-complete session", async () => {
  // 1. Set up a complete session.
  // 2. Call rescore.
  // 3. Assert: status === 200, body.idempotent === true. No state change.
});

test("R8 rescore: rejects premature rescore", async () => {
  // 1. Set up session at round=5, is_complete=false.
  // 2. Call rescore.
  // 3. Assert: status === 400.
});
```

# Fix R5 — global concurrency limit on `chatCompletion`

## Goal

At most N (default 10) `chatCompletion` calls in flight simultaneously per Node process. Excess calls queue. The public API of `chatCompletion(messages, options)` is unchanged — callers do not need to know the gate exists.

## Why

`server/llm/deepseekClient.js:116-153` issues each request directly. A grep across `server/` for `p-limit | semaphore | bottleneck` returns zero hits. With 60 students hitting a phase transition simultaneously, downstream paths fan out 60-180 concurrent HTTPS requests to DeepSeek (each phase3 submit triggers `vpScorer` + `tagExtractor` + `dimensionScorer`, three LLM calls per student).

DeepSeek rate-limits with 429s once RPM/TPM is exceeded. The existing retry policy (`MAX_RETRIES=1` with `RETRY_DELAY_MS=2000`-ish + jitter, `deepseekClient.js:6-7,146`) means all 100+ retries fire within a ~500ms window 2 seconds later — a textbook thundering herd. Outcomes:

- Routes that wrap `try { chatCompletion } catch (_) {}` (R7) silently substitute fake data.
- Routes that surface errors return 500 to dozens of students simultaneously.
- After R7/R8 are fixed, the same students see "请重试" banners simultaneously and all click retry within seconds — repeating the herd.

R5 must ship before or with R7/R8 to avoid the second-order failure of "we made errors visible, then made them more frequent."

## Files to change

1. `server/llm/deepseekClient.js` — wrap `chatCompletion` in an inline semaphore
2. `.env.example` — document `LLM_CONCURRENCY` and `LLM_MAX_RETRIES`

## Implementation

Two acceptable approaches; **prefer Option A** unless you have a reason not to.

### Option A (preferred): inline semaphore, no new dependency

Add at the top of `deepseekClient.js`, after the existing constants:

```js
const LLM_CONCURRENCY = Math.max(1, parseInt(process.env.LLM_CONCURRENCY || "10", 10));

const llmGate = (() => {
  let active = 0;
  const waiters = [];
  return async function gate(fn) {
    if (active >= LLM_CONCURRENCY) {
      await new Promise((resolve) => waiters.push(resolve));
    }
    active += 1;
    try {
      return await fn();
    } finally {
      active -= 1;
      const next = waiters.shift();
      if (next) next();
    }
  };
})();
```

Rename the existing public `chatCompletion` body to a private inner function, then have the public `chatCompletion` route through the gate:

```js
async function _chatCompletionInner(messages, options = {}) {
  // ... existing body of chatCompletion, unchanged ...
}

async function chatCompletion(messages, options = {}) {
  return llmGate(() => _chatCompletionInner(messages, options));
}

module.exports = { chatCompletion };
```

The semaphore deliberately wraps retries: if a 429 retry waits 2s+jitter, the slot stays held during the wait. This is correct — releasing the slot during backoff would let the retry rejoin the next batch's queue and re-trigger the herd.

### Option B: `p-limit` dependency

Three lines, but adds a dependency. Acceptable if Codex prefers a battle-tested package:

```js
const pLimit = require("p-limit");
const llmGate = pLimit(Math.max(1, parseInt(process.env.LLM_CONCURRENCY || "10", 10)));
```

If you go with B, also `npm install p-limit` and commit the lockfile change.

## Configurable retry policy (small bonus fix in the same file)

While editing `deepseekClient.js`, also expose `MAX_RETRIES` as configurable. Don't change the default.

```js
const MAX_RETRIES = Math.max(0, parseInt(process.env.LLM_MAX_RETRIES || "1", 10));
```

## .env.example update

Append:

```
# Max simultaneous in-flight DeepSeek requests per Node process. Default 10.
# Lower if you hit RPM limits, raise if DeepSeek is underutilized.
LLM_CONCURRENCY=10

# Number of retries for retryable errors (429, 5xx, network). Default 1.
LLM_MAX_RETRIES=1
```

## Caveats

- **Per-process limit.** If you run N Node processes (load balancer, PM2 cluster mode), the effective concurrency is N × `LLM_CONCURRENCY`. The current deployment is single-process per `DEPLOY_AUDIT_REPORT.md`, so this is fine. Note in the env var doc.
- **No queue depth cap.** The semaphore lets calls wait indefinitely; the per-request `REQUEST_TIMEOUT_MS=60000` already bounds individual call latency. Adding a queue cap would surface as silent timeouts and isn't worth the complexity here.
- **Default of 10 is conservative.** Once R5 is live and you have a feel for DeepSeek's actual RPM, you can tune via env var without code change.
- **Does not solve `recap()` holding a PG connection across an LLM call.** That's R6 (separate spec / future work). R5 reduces the frequency of "PG pool exhausted" errors but doesn't eliminate the underlying coupling.

## Acceptance criteria

1. With `LLM_CONCURRENCY=10`: fire 30 simultaneous `chatCompletion` calls (mock the underlying HTTPS call to count concurrent invocations and resolve after 100ms). At any instant, no more than 10 concurrent inner calls. All 30 eventually resolve successfully.
2. With `LLM_CONCURRENCY=1`: same test, sequential — never more than 1 concurrent inner call.
3. `chatCompletion`'s public signature, return type, and error semantics are unchanged. Callers do not need to be modified.
4. A retry inside `_chatCompletionInner` (e.g. mock a 429 followed by 200) holds the semaphore slot for the entire duration including the backoff sleep.
5. `LLM_MAX_RETRIES=0` disables retries; `LLM_MAX_RETRIES=3` allows up to 3 retries. Existing `options.maxRetries` per-call override still wins over the env-var default.
6. Existing tests pass.

---

# Fix R4 — migrate LLM caches from JSON files to Postgres

## Goal

Replace the file-based JSON caches in `tagExtractor.js` and `dimensionScorer.js` with a Postgres-backed key-value store. Concurrent writes must not lose entries; a process crash mid-write must not corrupt the cache.

## Why

Both files implement the same broken pattern (`server/llm/tagExtractor.js:11-24`, `server/llm/dimensionScorer.js:9-22`):

```js
const cache = readCache();        // read whole file
cache[key] = newValue;             // mutate in memory
writeCache(cache);                 // overwrite whole file
```

Two failure modes:

1. **Lost write on concurrent updates.** Reader A and Reader B both read the same snapshot. A adds entry `keyA`, writes the file. B (still holding the old snapshot) adds `keyB`, writes the file — A's entry is gone. With 60 concurrent students, this happens routinely.
2. **Whole-cache wipe on torn write.** `fs.writeFileSync` is not atomic (open + write + close internally). A process kill, OOM, or disk-full mid-write leaves a truncated JSON file. Next `readCache()` call: `JSON.parse` throws, the `catch (_)` returns `{}`, the next `writeCache` writes that empty object plus one new entry over the truncated file. **Thousands of cache entries lost silently**, only visible as a sudden cache-miss spike.

PG `INSERT ... ON CONFLICT DO UPDATE` gives atomic upsert at row granularity. No race window.

## Files to change

1. NEW: `server/db/kvCache.js` — `kvGet` / `kvSet` helpers
2. `server/multiplayer/teamManager.js` — add `llm_kv_cache` table to `ensureSchema()`
3. `scripts/migrations/init-postgres-schema.js` — same schema for fresh DB init
4. `server/llm/tagExtractor.js` — replace `readCache`/`writeCache` with `kvGet`/`kvSet`
5. `server/llm/dimensionScorer.js` — same
6. (Optional) NEW: `scripts/migrations/import-llm-caches-to-pg.js` — one-shot importer for existing JSON cache data

## Schema

One shared table for both caches; namespace by `cache_name`.

Add to `ensureSchema()` in `teamManager.js` AND to `scripts/migrations/init-postgres-schema.js`:

```sql
CREATE TABLE IF NOT EXISTS llm_kv_cache (
  cache_name TEXT NOT NULL,
  cache_key TEXT NOT NULL,
  cache_value JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (cache_name, cache_key)
);
CREATE INDEX IF NOT EXISTS idx_llm_kv_cache_updated
  ON llm_kv_cache (cache_name, updated_at DESC);
```

The composite PK provides the uniqueness constraint we need for `ON CONFLICT`.

## New helper module: `server/db/kvCache.js`

```js
const { runSql, sqlQuote } = require("./pgSql");

async function kvGet(cacheName, key) {
  const rows = await runSql(`
    SELECT cache_value
    FROM llm_kv_cache
    WHERE cache_name = ${sqlQuote(cacheName)}
      AND cache_key = ${sqlQuote(key)}
    LIMIT 1;
  `);
  if (!rows[0]) return null;
  // pg auto-parses JSONB columns to JS objects; if your runSql returns strings,
  // wrap with safeJsonParse here.
  return rows[0].cache_value;
}

async function kvSet(cacheName, key, value) {
  const json = JSON.stringify(value);
  await runSql(`
    INSERT INTO llm_kv_cache (cache_name, cache_key, cache_value, updated_at)
    VALUES (
      ${sqlQuote(cacheName)},
      ${sqlQuote(key)},
      ${sqlQuote(json)}::jsonb,
      NOW()
    )
    ON CONFLICT (cache_name, cache_key) DO UPDATE SET
      cache_value = EXCLUDED.cache_value,
      updated_at = NOW();
  `);
}

module.exports = { kvGet, kvSet };
```

Codex: verify whether `runSql` returns JSONB columns as parsed JS objects or as strings. If strings, parse in `kvGet`. The other modules in this repo handle JSONB inconsistently (some use `parseJsonColumn`); follow whatever pattern the closest existing call uses.

## Refactor `tagExtractor.js`

Top of file: remove `path`, `fs`, `CACHE_PATH`, `readCache`, `writeCache`. Replace with:

```js
const { kvGet, kvSet } = require("../db/kvCache");
const CACHE_NAME = "tag_extractor_v2";  // suffix is the prompt version
```

Recommendation: move the prompt version from inside the cache key into `CACHE_NAME`. Then bumping prompt version becomes a constant change with no key-collision risk. Update `cacheKey` to drop the `PROMPT_VERSION + ":"` prefix:

```js
// Before:
const cacheKey = crypto.createHash("md5").update(PROMPT_VERSION + ":" + normalized).digest("hex");

// After:
const cacheKey = crypto.createHash("md5").update(normalized).digest("hex");
```

Then in the cache-check and cache-write spots:

```js
// Replace:
// const cache = readCache();
// if (cache[cacheKey]) {
//   console.log("[TagExtractor] Level 1 缓存命中");
//   return cache[cacheKey];
// }

const cached = await kvGet(CACHE_NAME, cacheKey);
if (cached) {
  console.log("[TagExtractor] Level 1 缓存命中");
  return cached;
}

// ... LLM call unchanged ...

// Replace:
// cache[cacheKey] = tags;
// writeCache(cache);

await kvSet(CACHE_NAME, cacheKey, tags);
```

Remove the `PROMPT_VERSION` constant if it has no other callers (grep first).

## Refactor `dimensionScorer.js`

Same pattern. Use `CACHE_NAME = "dimension_scorer_v1"`. The `anchorVersion` is already part of the cache key and stays as-is (it's runtime-derived, not a constant — keeping it in the key is correct).

## Optional: import existing JSON caches

If the running prod DB has accumulated valuable warm cache (likely — each entry is a real LLM call's result), preserve it. Create `scripts/migrations/import-llm-caches-to-pg.js`:

```js
// Pseudocode — model after scripts/migrations/init-postgres-schema.js for boilerplate
const fs = require("fs");
const path = require("path");
const { kvSet } = require("../../server/db/kvCache");

async function main() {
  const tagPath = path.join(__dirname, "..", "..", "data", "tag_cache.json");
  if (fs.existsSync(tagPath)) {
    const data = JSON.parse(fs.readFileSync(tagPath, "utf8"));
    let count = 0;
    for (const [key, value] of Object.entries(data)) {
      await kvSet("tag_extractor_v2", key, value);
      count += 1;
    }
    console.log(`Imported ${count} entries from tag_cache.json`);
  }

  const scorePath = path.join(__dirname, "..", "..", "data", "score_cache.json");
  if (fs.existsSync(scorePath)) {
    const data = JSON.parse(fs.readFileSync(scorePath, "utf8"));
    let count = 0;
    for (const [key, value] of Object.entries(data)) {
      await kvSet("dimension_scorer_v1", key, value);
      count += 1;
    }
    console.log(`Imported ${count} entries from score_cache.json`);
  }
}

main().then(() => process.exit(0)).catch((err) => {
  console.error(err);
  process.exit(1);
});
```

Run once after the schema migration is live. Then delete `data/tag_cache.json` and `data/score_cache.json` from the runtime container (these files are gitignored under `data/`, so no repo change needed).

If the existing cache isn't valuable enough to migrate (purely perf, regenerable), skip the importer — just deploy and let the cache rebuild from LLM calls.

## Acceptance criteria

1. After deploy: `\d llm_kv_cache` shows the table with PK `(cache_name, cache_key)` and the `updated_at` index.
2. **Concurrency:** fire 10 simultaneous `extractTags(differentInputs)` calls. After all complete, `SELECT COUNT(*) FROM llm_kv_cache WHERE cache_name = 'tag_extractor_v2'` equals 10. No entry is lost.
3. **Idempotency / hit:** calling `extractTags` with identical input twice triggers exactly 1 LLM call (verify via `LLM_DEBUG=1` log or by mocking `chatCompletion`).
4. **Cross-cache isolation:** `kvSet("a", "k", 1)` and `kvSet("b", "k", 2)` produce two distinct rows; `kvGet("a", "k")` returns 1.
5. **Crash recovery:** kill the Node process during a write. Restart. `kvGet` reads still work and return previous values intact (PG transaction guarantees no torn writes).
6. After deploy + (optional) import: `data/tag_cache.json` and `data/score_cache.json` are no longer read or written. They can be deleted from the container without impact.
7. Existing tests pass.

## Caveats

- **Extra DB roundtrip on every cache lookup.** Routes already do 5-10 PG queries each; one more is negligible. If profiling later shows the cache lookup dominates, add an in-process LRU layer in front of `kvGet` in a separate PR — out of scope here.
- **Unbounded growth.** The table grows with unique LLM inputs. Add an ops note: every few months, run `DELETE FROM llm_kv_cache WHERE updated_at < NOW() - INTERVAL '90 days'`. No automation needed for this PR.
- **Connection during `kvSet`.** `kvSet` holds a PG connection briefly; under heavy load + max=20 pool, this is one more pool consumer. Combined with R5 limiting LLM concurrency to ~10, this is fine. Don't put `kvSet` on a hot loop without the gate.

---

# Out of scope for this spec

The following are mentioned in `CODE_AUDIT_REPORT.md` but are NOT in this spec — do not address them in this PR:

- The hardcoded `MAX_INTERVIEW_TURNS=10` etc. constants. Game tuning is separate.
- The `sqlQuote` → parameterized query migration. Schema fixes here use `sqlQuote` to match the existing codebase.
- The `interview_sessions` schema. We treat it as a JSONB-ish session record. No schema migration for `needs_rescore` — we infer it from `(round_no, is_complete, result)`.
- PG connection held across LLM calls in `interviewReply` / `recap()` (R6 in audit). Separate spec.
- `finalizePhase3` not being a single transaction (R1 in audit). Separate spec.
- In-process LRU layer in front of the PG-backed cache. Future optimization, not needed for correctness.

# Final checklist for Codex

**R5 — concurrency gate:**
- [ ] Inline semaphore added in `deepseekClient.js`, gates `chatCompletion`
- [ ] Public `chatCompletion` signature unchanged; inner renamed to `_chatCompletionInner`
- [ ] `LLM_CONCURRENCY` and `LLM_MAX_RETRIES` env vars documented in `.env.example`
- [ ] Test verifying ≤N concurrent calls under burst load

**R2 — `member_submissions` deduplication:**
- [ ] Schema added in both `teamManager.js` and `init-postgres-schema.js`, with self-healing dedup wrapper
- [ ] `scripts/migrations/dedup-member-submissions.js` created
- [ ] `submitPhase1` rewritten with idempotent re-submit and `ON CONFLICT DO NOTHING RETURNING`

**R3 — `vp_iterations` race:**
- [ ] Schema added in `vpIterationStore.js` with self-healing dedup wrapper
- [ ] `appendIteration` rewritten with retry-on-23505 loop

**R7 + R8 — interview semantics (one PR):**
- [ ] `InterviewScoringError` defined
- [ ] `extractInterviewResult` throws on failure instead of returning result-with-defaults
- [ ] `interviewReply` scoring branch handles `InterviewScoringError` and returns 503/needsRescore
- [ ] `interviewReply` LLM call no longer has hardcoded fallback string; throws to 503 on failure
- [ ] `rescoreInterview` function implemented and exported
- [ ] `/api/round2/interview/rescore` route wired in `server.js`
- [ ] Frontend `round2Api.js` exposes `rescoreInterview`
- [ ] Frontend interview UI handles 503 with retry banner for both R7 (re-send message) and R8 (call rescore)
- [ ] `grep "对我来说，平时相处起来别太折腾最重要" server/` returns nothing

**R4 — cache migration:**
- [ ] `llm_kv_cache` table added in both schema sites
- [ ] `server/db/kvCache.js` helper module created
- [ ] `tagExtractor.js` migrated to PG cache (no more `tag_cache.json`)
- [ ] `dimensionScorer.js` migrated to PG cache (no more `score_cache.json`)
- [ ] Optional `scripts/migrations/import-llm-caches-to-pg.js` created
- [ ] Test verifying concurrent `kvSet` writes don't lose entries

**Cross-cutting:**
- [ ] New tests in `tests/concurrency.test.js`, `tests/interview_failure_modes.test.js`, `tests/llm_concurrency.test.js`, `tests/llm_kv_cache.test.js`
- [ ] All existing tests still pass
