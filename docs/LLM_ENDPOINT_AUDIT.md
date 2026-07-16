# LLM Endpoint Audit

Version: 2026-07-16

This table is the production governance list for DeepSeek calls. When adding a new production endpoint or moving an analysis/simulation caller into a production request path, update this document in the same PR/commit.

## Scope

- In scope: server-side production HTTP endpoints and helpers that can run from those endpoints.
- Out of scope: `scripts/sim/*`, `scripts/analysis/*`, one-off batch tools, documentation snippets, and archived modules under `server/llm/_archive/*`.
- Timeout contract: production request-path DeepSeek calls must pass an explicit 60s `timeoutMs` unless the endpoint has been deliberately made asynchronous and documents its polling/result contract.

## Production endpoint table

| Endpoint / caller | LLM purpose | Implementation | Current timeout | Request-response path | Decision |
| --- | --- | --- | --- | --- | --- |
| `GET /api/llm/health` | Minimal DeepSeek health probe | `server.js` `handleLlmHealth` | 60s via `LLM_HEALTH_TIMEOUT_MS` | Sync | Production path covered. |
| `POST /api/vp/chat` | Legacy VP coach chat; optional confirm scoring | `server/llm/vpCoach.js`, `server/llm/vpScorer.js` | 60s via helper `LLM_TIMEOUT_MS` | Sync | Legacy route retained; timeout covered, no redesign. |
| `POST /api/team/:id/phase3/chat` | Team VP coach chat | `server/llm/vpCoach.js` | 60s via helper `LLM_TIMEOUT_MS` | Sync | Production path covered. |
| `POST /api/team/:id/phase3/synthesize-vp` | VP synthesis and synthesis feedback | `server/llm/vpCoach.js` | 60s via helper `LLM_TIMEOUT_MS` | Sync | Production path covered. |
| `POST /api/vp/extract-fields` | Extract VP fields from student text | `server/llm/vpEmbeddingScorer.js` | 60s via helper `LLM_TIMEOUT_MS` | Sync | Production path covered. |
| `POST /api/round1/vp-feedback` | Draft VP feedback before submission | `server/routes/teamRoutes.js` `generateDraftVpFeedback` | 60s via `VP_LLM_TIMEOUT_MS` | Sync | Production path covered. |
| `POST /api/round1/vp-submit` | Submit VP and score confirmed VP | `server/routes/teamRoutes.js`, VP scoring helpers | 60s via `VP_LLM_TIMEOUT_MS` / helper `LLM_TIMEOUT_MS` | Sync | Production path covered. |
| `POST /api/vp/confirm-and-score` | Confirm VP and score text | `server/routes/teamRoutes.js`, VP scoring helpers | 60s via `VP_LLM_TIMEOUT_MS` / helper `LLM_TIMEOUT_MS` | Sync | Production path covered. |
| `POST /api/team/:id/phase3/confirm-vp` | Team VP confirmation scoring | `server/routes/teamRoutes.js`, VP scoring helpers | 60s via `VP_LLM_TIMEOUT_MS` / helper `LLM_TIMEOUT_MS` | Sync | Production path covered. |
| Phase 4 / Round 1 finalize feedback job | Final VP feedback for Phase 4 display | `server/routes/teamRoutes.js` `schedulePhase4VpFeedbackGeneration` | 60s via `VP_LLM_TIMEOUT_MS` | Async background job | Critical finalize path no longer waits on LLM; UI reads pending/final feedback fields. |
| `POST /api/vp/generate-feedback` | Generate VP written feedback | `server/llm/vpWordScorer.js` | 60s default via helper `LLM_TIMEOUT_MS`, explicit override supported | Sync | Production path covered. |
| `POST /api/marketing/start` | Generate a live-mode interview persona | `server/routes/marketing.js` -> `server/llm/personaGenerator.js` | 60s via helper `LLM_TIMEOUT_MS` | Sync | Production/live path covered. |
| `POST /api/marketing/interview` | Live-mode interview reply, leakage retry, and completeness assessment | `server/routes/marketing.js` -> `server/llm/interviewCoach.js` | 60s per DeepSeek call via `INTERVIEW_LLM_TIMEOUT_MS` | Sync | Production/live path covered; this is the interviewCoach chain audited in this pass. |
| `POST /api/marketing/end-interview` | Extract tags and generate interview summary | `server/routes/marketing.js`, `server/llm/tagExtractor.js`, `server/llm/requirementBuilder.js` | 60s via helper `LLM_TIMEOUT_MS` | Sync | Production/live path covered. |
| `POST /api/round2/interview/start` | Generate missing R2 persona variant when needed | `server/routes/round2Routes.js` -> `server/llm/personaGenerator.js` | 60s via helper `LLM_TIMEOUT_MS` | Conditional sync | Production path covered. |
| `POST /api/round2/interview/reply` | R2 persona reply and leakage retry | `server/routes/round2Routes.js` | 60s per DeepSeek call via `ROUND2_LLM_TIMEOUT_MS` | Sync | Production path covered. |
| `POST /api/round2/interview/auto` | Auto-run R2 interview and extract result | `server/routes/round2Routes.js` `extractInterviewResult` | 60s per DeepSeek call via `ROUND2_LLM_TIMEOUT_MS` | Sync | Production path covered. |
| `POST /api/round2/interview/rescore` | Re-extract/rescore R2 interview result | `server/routes/round2Routes.js` `extractInterviewResult` | 60s per DeepSeek call via `ROUND2_LLM_TIMEOUT_MS` | Sync | Production path covered. |
| `POST /api/round2/interview/end` | End R2 interview and extract result | `server/routes/round2Routes.js` `extractInterviewResult` | 60s per DeepSeek call via `ROUND2_LLM_TIMEOUT_MS` | Sync | Production path covered. |
| `POST /api/round2/reflection` | Generate R2 reflection text | `server/routes/round2Routes.js` `reflectionApi` | 60s via `ROUND2_LLM_TIMEOUT_MS` | Sync with fallback | Production path covered; non-fatal fallback retained. |
| `POST /api/teacher/generate-debrief` | Teacher global debrief | `server/routes/teacherDebrief.js` | 60s via `DEBRIEF_LLM_TIMEOUT_MS` | Sync, cached result | Production teacher path covered. |
| `POST /api/teacher/generate-team-review` | Teacher per-team review | `server/routes/teacherDebrief.js` | 60s via `DEBRIEF_LLM_TIMEOUT_MS` | Sync | Production teacher path covered. |
| `Round2.ensurePersonaReportsForTeam` / `renderPersonaSummaryWithLlm` | Generate persona report summaries when invoked by R2 helpers | `server/routes/round2Routes.js` | 60s via `ROUND2_LLM_TIMEOUT_MS` | Sync if called | Production helper covered; no separate public endpoint. |

## Explicit non-production / legacy decisions

| Area | Decision |
| --- | --- |
| `scripts/sim/*` | Simulation harnesses are not managed by the production endpoint timeout table. If a simulation caller is promoted into a production endpoint, add it above and give it the 60s/async decision explicitly. |
| `scripts/analysis/*` | Analysis and research scripts are not production request paths. Not changed by this audit. |
| `server/llm/_archive/*` | Archived legacy module. Not touched unless restored into runtime. |
| Documentation snippets | Examples in docs are not runtime call sites. Keep them readable, but do not use them as the source of production timeout truth. |
| Disabled Round 1 legacy endpoints (`/api/llm/round1/*`, `/api/round1/chat`, `/api/round1/vp/*`) | These return `410` and do not call DeepSeek. Legacy disabled path; no timeout action needed. |

## Notes for future changes

1. Prefer asynchronous handling for non-critical long-form LLM output that is displayed after a phase transition.
2. Keep phase/state progression independent of LLM completion when the LLM output is evaluative prose rather than game-state data.
3. If an endpoint must synchronously return LLM content, pass an explicit 60s `timeoutMs` and document why it remains synchronous in this table.
