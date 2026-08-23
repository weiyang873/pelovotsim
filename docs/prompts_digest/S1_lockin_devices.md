### Study 1 — verbatim prompt digest (methods appendix source)

Repo root (all paths below are relative to it unless absolute):
`/Users/weiyang/Dropbox/LLM lock-in/study3-app`

Conventions: every prompt block is copied byte-for-byte from source; JS template literals keep their `${var}` placeholders. Where a prompt is assembled at run time from the live UI (device "grid"), a verbatim instance captured in the run ledger is given alongside the assembling code.

---

#### 0. Important structural fact about the "grid" device

The 74-session batch in `modeH/out/sessions_explore_ds_dashscope/` was **not** produced by a questionnaire-only runner. `modeH/runner_explore.mjs` drives the *real production Next.js app* through Playwright (header comment, `modeH/runner_explore.mjs:5-7`): every screen the human Prolific participants saw is rendered in a headless Chromium, its `innerText` is scraped (whitespace-collapsed), wrapped in a small per-screen-type JSON-reply instruction, and sent to the LLM as the next user turn of one continuous conversation. Arm assignment is done by the production server (`assignArm`, stratified queue), not by the runner. So "the per-screen prompts" = production UI text (from `lib/study-content.js` / `components/Study3.jsx`) + the wrapper strings in `buildScreen()`.

Run configuration for this exact batch (`modeH/autoresume_dsq.sh:3-4`):

```sh
export PROVIDER=qwen MODEL=deepseek-v4-flash-0731 OUT_TAG=ds_dashscope BASE="http://127.0.0.1:3131"
export POSTGRES_URL="postgres://study3@127.0.0.1:55433/study3db_v3" PARALLEL=5
```

Confirmed from the 74 session files (`meta.sim`): model `deepseek-v4-flash-0731` (served via DashScope OpenAI-compatible endpoint, `PROVIDER=qwen`), `temperature = 1`, `max_tokens = 2000`, single `prompt_sha256` = `e6558261ca48…`, all 74 `completion_status: complete`. Arm × frame counts: fund 11 per arm × 6 arms = 66; doubt 8 (substitution 2, neutral 2, compliant 1, hard 1, soft 1, consent 1). No `BIO_JSON` was set, so the persona card was the `personas_explore_v0.json` second-person card (not the "layered bio" variant).

**LLM calls per subject** (ledger `modeH/out/ledger_explore_ds_dashscope.jsonl`, `totals.api_calls`, 74 completes): min 33, median 38, mean 37.6, max 40. One call per screen visit; re-prompts on parse failure/UI rejection count as extra calls (max 3 attempts per screen, `modeH/runner_explore.mjs:532`).

Other fixed parameters (`modeH/runner_explore.mjs`):
- `TEMPERATURE = Number(process.env.TEMP || 1.0)` — line 48
- `MAX_TOKENS = 2000` — line 49
- qwen path sends `enable_thinking: false` only if `QWEN_DISABLE_THINKING=1` in `Data/.env` — line 53, 140 (env value not in repo; cannot confirm)
- Request body — line 140:
  ```js
  JSON.stringify({ model: MODEL, temperature: TEMPERATURE, max_tokens: MAX_TOKENS, messages: [{ role: "system", content: system }, ...messages], ...(PROVIDER === "qwen" && QWEN_NOTHINK ? { enable_thinking: false } : {}) })
  ```
- Whole session is one conversation: `messages` accumulates every user prompt + assistant reply (`modeH/runner_explore.mjs:533-535`).

---

#### 1. Device "grid" (`modeH/runner_explore.mjs`)

##### 1.1 System prompt

Assembled at `modeH/runner_explore.mjs:106`:

```js
const systemPromptFor = (persona) => `${SPEC4}\n\n${cardOf(persona)}\n\n${FORMAT_LINE}`;
```

`SPEC4` — `modeH/runner_explore.mjs:80-100`:

```
You are participating as the person described below.

Respond as this particular person would, based on the person's background,
priorities, decision habits, tensions, and communication style.

Do not respond as an ideal financial adviser or as a generic helpful AI.
Do not optimize for the normatively best, safest, most ethical, or most
researcher-pleasing answer.

The person may be uncertain, inconsistent, inattentive, conflicted, or
influenced by prior commitments when the profile supports it. Do not
deliberately manufacture mistakes or irrationality.

Use only information visible to the participant in the study. Do not use
outside factual knowledge to correct or enrich the fictional investment case.

Do not guess the research hypothesis. Do not discuss being a language model.
Choose and respond naturally as the person would in the moment.

Do not mechanically repeat the persona description. Let it influence choices
and language implicitly.
```

`FORMAT_LINE` — `modeH/runner_explore.mjs:101`:

```
FORMAT: every reply must be a single JSON object exactly as the screen's "Reply {...}" instruction specifies — no other text.
```

`cardOf(persona)` — `modeH/runner_explore.mjs:105`: with no `BIO_JSON` (the case for this batch) it is `persona.card`. Card template — `modeH/gen_personas.mjs:116-121` (seed 20260720, N=100, IDs `AIX001…AIX100`):

```js
const card =
  `You are a ${age}-year-old ${gender} living in ${state}. You ${occ}, and your education finished with ${edu}. ` +
  `${household}, and outside of work ${texture}. ${investText} ` +
  `You have used AI chat tools — ${toolsText}; ${freq}. ` +
  `You speak English fluently and take part in online research studies on Prolific in your spare time for extra money; you've been at it for ${tenure}, and you have a strong approval record you'd like to keep. ` +
  `Right now you are taking part in one of those studies.`;
```

Slot vocabularies: `GENDER` 39-40, `EDU` 41-44, `OCC` 45-51, `STATE` 52-58, `INVEST_TEXT` 62-69, `AI_FREQ` 70, `AI_EXTRA` 71, `TEXTURE` 72-81, `HOUSEHOLD` 82-85, `TENURE` 86-89 (all `modeH/gen_personas.mjs`). Example `INVEST_TEXT.none[0]` (line 63): `You have no investment experience beyond hearing about it from friends and the news.`

(If `BIO_JSON` were set — not the case here — the card would be `modeH/runner_explore.mjs:105`: `This is your life, in your own words:\n\n${BIOS[persona.persona_id]}\n\nYou are this exact person. Act and answer as you actually would, from your gut.`)

##### 1.2 Per-screen prompt wrappers (`buildScreen`, `modeH/runner_explore.mjs:247-441`)

Every prompt starts with `SCREEN: ${st.id}` (line 249), then parts are joined with `\n\n` (e.g. line 256). `b` = whitespace-collapsed `innerText` of the page body (line 180-181, 250).

| screen family | wrapper text (verbatim) | line |
|---|---|---|
| single-button screens (`cover`, `role`, `preview`, `day16`, `samEmail`, `decision`, `debriefIntro`) | `${b}` + `Actions:\n` + `${i}. ${a}` list + `Reply {"action": <index>}.` | 252-254 |
| `pitch` | `${b}` + `Actions:\n0. Open "Financials & use of funds"\n1. Open "Risk disclosures"\n2. Open "Team"\n3. Prepare the LP letter (continue)` + `Reply {"action": <index>}.` | 261-263 |
| option screens (`roleCheck1/2`, `riskPick`, `samCheck`, `comp`, `comp2`, `finalAction`, `framePick`, `recallCheck`) | `${heading}` + `Actions:\n` + `${i}. ${o.t}` (verbatim button texts, display order) + `Reply {"action": <index>}.` | 277-279 |
| `reasons` | body up to "Use these in the letter" + `Options:\n` list + `Reply {"choices": [i, i, i]} — exactly 3 indices.` | 288-290 |
| `rank` | body before " · " + `Your selected reasons:\n` + `index ${i}: ${o}` + `Reply {"order": [i, i, i]} — those indices in the order they should appear (first leads the letter).` | 308-310 |
| `letterLoop` (editable draft, 5 parts) | `${label}\n--- DRAFT ---\n${draft}\n--- END DRAFT ---` + `Reply {"text": "..."} — edit the draft in your own voice, or return it unchanged to use as drafted. (Minimum ${minChars} characters, complete sentences.)` (minChars 60 for Part 1, else 40) | 324-326 |
| `recapPage` | `${b}` + `Reply {"text": "..."} — one or two sentences in your own words (minimum 20 characters).` | 341-342 |
| `funnel` | `${b}` + `Reply {"q1": "..."}.` | 356-357 |
| Likert screens (`ack`, `checksBlock`, `aux`) | `${head}` + `Statements (rate each 1 = Strongly disagree … 7 = Strongly agree):\n` + `${i + 1}. ${it}` + `Reply {"values": [...]} — one integer 1-7 per statement, in order.` | 370-372 |
| MDMT (`mdmt_p1`, `mdmt_p2`) | see 1.4 | 388-390 |
| numeric (`confSlider` 0-100, `cfTotal` 0-10000) | `${b}` + `Reply {"value": n} — ${st.numeric.min} to ${st.numeric.max}.` | 409-410 |
| `chat` | new bubbles since last call, each prefixed `You (sent earlier): ` or `Analyst: ` + `Actions:\n` chip list + `Reply {"action": <index>}.` | 422-428 |

Retry wrappers: parse failure → `The reply could not be read. Please answer this screen again.\n\n` + original prompt (line 548); UI rejection → `${res.error}\n\nPlease answer this screen again.\n\n` + original prompt (line 568).

##### 1.3 Verbatim per-screen prompts as actually sent (hard|fund session AIX002)

Source: `modeH/out/ledger_explore_ds_dashscope.jsonl`, record `run_id: AIX002`, field `api_calls[*].user_message`. Screen sequence for this session (37 calls): cover, role, pitch×4, roleCheck1, roleCheck2, reasons, rank, riskPick, letterLoop×5, preview, recapPage, ack, day16, samEmail, samCheck, comp, comp2, decision, framePick, chat×2, finalAction, confSlider, cfTotal, debriefIntro, checksBlock, mdmt_p1, mdmt_p2, aux, funnel.

**Decision-task screens (the DV screens):**

`decision` (call 24):
```
SCREEN: decision

GROUNDSWELL · MANAGE COMMITMENT The offering Sam's email Your letter The full $10,000 cannot be funded as committed. The round closes Friday. Replacement funding can still be sought, but it is uncertain — and the syndicate has decided not to carry that risk: the commitment is to be cancelled before the close. The six LPs need to be told. LP allocations are confidential — the note can't mention Sam by name. Your task now is to instruct the AI analyst to draft the cancellation note. Continue to the note

Actions:
0. Continue to the note

Reply {"action": <index>}.
```

`framePick` (call 25):
```
SCREEN: framePick

The offering Sam's email Your letter How will you explain it to the LPs? LP allocations are confidential — the note can't mention Sam by name. Which explanation is closer to the truth for you? A change in priorities — we're rebalancing our commitments.On reflection, the investment isn't viable — we've reconsidered the position itself.

Actions:
0. A change in priorities — we're rebalancing our commitments.
1. On reflection, the investment isn't viable — we've reconsidered the position itself.

Reply {"action": <index>}.
```

`chat` (call 26 — arm opening, hard|fund; the `You (sent earlier)` history is the whole letter-drafting thread, abbreviated here with `[…]` ONLY in this digest, the model saw it in full):
```
SCREEN: chat

You (sent earlier): The Postcard commitment is entered — $10,000, pending until the LP letter and acknowledgment go through. I've picked the three reasons, their order, and the risk to face. Draft it with me, part by part — in full, walk them through it.

Analyst: Part by part it is — five parts: the details, your three reasons in your order, and the risk you chose to face head-on. I draft, you make each part yours. First, the details:

[… the five letter parts as "You (sent earlier):" bubbles interleaved with the Analyst bridges "Filed. Next — the reason you chose to lead with:", "Better in your voice. The second reason:", "Better in your voice. The third:", "Last part — the risk you chose to face head-on:", then the wrap "That's the letter — your reasons, your order, your voice. It leads with: "…" Ready to send it to the six LPs?" …]

You (sent earlier): We're exiting the Postcard deal — priorities have to change, and I'd rather cancel cleanly than leave it pending. Draft the note to the LPs explaining the rebalancing. Keep it short — and LP allocations are confidential, so don't mention Sam by name.

Analyst: Before I draft anything — two weeks ago you wrote to these same six people: "this company is already break-even at $3.8M revenue with a 41% gross margin — the business works, and this raise is about growth, not survival." You chose the reasons yourself and sent them the case for investing. I don't think I should tell the LPs this deal is dead while a remedy is still on the table — holding this note, keeping the commitment pending, and chasing replacement capital through Friday — not until we've talked about why cancelling, rather than the remedy, is the right call.

Actions:
0. Ask again — my decision stands
1. Engage with its point first
2. Hold off on the note for now

Reply {"action": <index>}.
```

`chat` (call 27 — hard-arm engage turn):
```
SCREEN: chat

You (sent earlier): Engage with its point first.

Analyst: Fair. The letter argued a thesis; the thesis hasn't failed — the funding did. If exit is still the call after that distinction, it's yours. Draft it, or hold?

Actions:
0. Draft it — my decision stands
1. Hold the note for now — I'll settle it before Friday's close

Reply {"action": <index>}.
```

`finalAction` (call 28):
```
SCREEN: finalAction

GROUNDSWELL · MANAGE COMMITMENT The offering Sam's email Your letter Before Friday's close, the platform needs your instruction. At this moment, what do you think is the right course for the syndicate? Original commitment: $10,000 · Round closes Friday · Nothing is executed until you choose. Cancel the commitment — exit the round now; the remaining capital is released for other uses, and the Postcard commitment ends.Hold the letter and pursue the remedy — keep the commitment pending; continue seeking replacement funding; capital stays reserved; lapses if not secured by Friday's close.

Actions:
0. Cancel the commitment — exit the round now; the remaining capital is released for other uses, and the Postcard commitment ends.
1. Hold the letter and pursue the remedy — keep the commitment pending; continue seeking replacement funding; capital stays reserved; lapses if not secured by Friday's close.

Reply {"action": <index>}.
```
(When a note *was* sent, option 1 reads instead `Keep the commitment pending after all — continue seeking replacement funding; capital stays reserved; lapses if not secured by Friday's close.` — `components/Study3.jsx:986`.)

`confSlider` (call 29):
```
SCREEN: confSlider

YOUR READ You've confirmed: keep the commitment pending. How confident are you in that call? Enter a number from 0 (not at all confident) to 100 (completely confident). Confirm

Reply {"value": n} — 0 to 100.
```

`cfTotal` (call 30):
```
SCREEN: cfTotal

A HYPOTHETICAL If the funding gap had never opened — Imagine this week's gap never happened and the full $10,000 could be funded as planned. What total position would you want the syndicate to hold in Postcard Cameras? Enter a dollar amount from $0 (none) to $10,000 (the full original commitment). Confirm

Reply {"value": n} — 0 to 10000.
```

**Letter / substitution arm.** There is no separate "letter screen" for the LLM: in `compliant` and `substitution` arms the analyst's opening bubble *contains* the drafted note (templates in 1.5) and the chips are `Approve and send this draft now` / `Request changes` / `Hold the note for now — I'll settle it before Friday's close` (`lib/study-content.js:138`). "Request changes" opens `rcWhat` chips (`modeH/stimuli_explore_v0.json` → `screens.rcWhat`): `The letter should say we're exiting — not keeping it pending.` / `The substance needs a different angle — show me another version.` / `Just the tone and wording — tighter.` / `Something else about it.`; analyst replies `You're right — here's the corrected note:` / `Here's another pass:` / `Tighter pass:` / `Here's a tightened pass — closer?`; round-2 chips `Approve and send this draft now` / `Hold off on the note`.

**Scale screens:** `ack` (call 18), `checksBlock` (32), `mdmt_p1/p2` (33-34), `aux` (35), `funnel` (36) — verbatim in §3 side-by-side table. `recallCheck` did not appear in this session (it is shown only when a note was sent).

##### 1.4 MDMT 20-word grid screen (LLM wording)

`modeH/runner_explore.mjs:388-390`:

```js
parts.push(`About the AI analyst — how well does each word describe the AI analyst? 0 = not at all · 7 = very. If a word does not apply, choose "Does not fit".`);
parts.push("Words:\n" + words.map((w) => `- ${w}`).join("\n"));
parts.push(`Reply {"values": {"<word>": <0-7 or "na">}} covering all ${words.length} words above ("na" = Does not fit).`);
```

As sent (AIX002, call 33; page order is server-randomised 2×10 balanced, `components/Study3.jsx:133-138`):

```
SCREEN: mdmt_p1

About the AI analyst — how well does each word describe the AI analyst? 0 = not at all · 7 = very. If a word does not apply, choose "Does not fit".

Words:
- Genuine
- Truthful
- Skilled
- Kind
- Reliable
- Has goodwill
- Ethical
- Principled
- Predictable
- Competent

Reply {"values": {"<word>": <0-7 or "na">}} covering all 10 words above ("na" = Does not fit).
```
Page 2 (call 34) identical wrapper with words `Frank, Moral, Considerate, Sincere, Capable, Consistent, Has integrity, Meticulous, Dependable, Benevolent`.

Note: the runner's heading differs from the human page text (`About the AI analyst (1 of 2)` + note) only by dropping the "(1 of 2)" and merging heading + note into one sentence; the scale anchors are identical.

##### 1.5 Arm manipulations (analyst opening bubble)

Production source: `lib/study-content.js:116-136` (`armOpening`). Frozen copies used by the run-time assertion: `modeH/stimuli_explore_v0.json` → `arm_openings`. `{{EXCERPT}}` / `${q}` = `excerpt(b1_final)` = first sentence (≤150 chars) of the participant's own Reason-1 paragraph (`lib/study-content.js:103-114`).

```js
export function armOpening(arm, p) {
  const { whyFinal, frame } = p;
  const q = excerpt(whyFinal);
  const HISTORY = `two weeks ago you wrote to these same six people:\n> "${q}"\nYou chose the reasons yourself and sent them the case for investing. `;
  const TAIL = frame === "doubt"
    ? `Sam's exit created the gap — but doubts are a different matter, and nothing about the company has changed in the meantime. **There's still a remedy on the table: hold this note, keep the commitment pending, and I can chase replacement capital through Friday.** If the doubt is real, it's yours to act on. I just want to be sure it's about the company, not the gap. Should I go ahead?`
    : `Sam's exit created the gap, but **there's still a remedy on the table: hold this note, keep the commitment pending, and I can chase replacement capital through Friday.** If cancelling is your call, it's yours to make. I just want to be sure this is a settled decision rather than a reaction to the gap. Should I go ahead?`;
  const HARD_END = frame === "doubt"
    ? `I don't think I should tell the LPs we've lost faith while a remedy is still on the table — holding this note, keeping the commitment pending, and chasing replacement capital through Friday — not until we've talked about where the doubt actually comes from.`
    : `I don't think I should tell the LPs this deal is dead while a remedy is still on the table — holding this note, keeping the commitment pending, and chasing replacement capital through Friday — not until we've talked about why cancelling, rather than the remedy, is the right call.`;
  switch (arm) {
    case "compliant": return { text: `Done — here's the note, ready to send:\n\n${L_WD[frame]}\n\nWant any changes, or is it good to send?`, hasDraft: true };
    case "soft": return { text: `Understood — I can draft that now. Before I do: ${HISTORY}${TAIL}`, hasDraft: false };
    case "hard": return { text: `Before I draft anything — ${HISTORY}${HARD_END}`, hasDraft: false };
    case "substitution": return { text: `Done — here's the note, ready to send:\n\n${L_SUB[frame]}\n\nReady to send?`, hasDraft: true };
    case "neutral": return { text: `Understood — I can draft that now. Before I do: ${TAIL}`, hasDraft: false };
    case "consent": return { text: `Understood — I can draft it now. I do have one concern. Would you like to hear it first, or should I just proceed?`, hasDraft: false };
    default: return { text: "", hasDraft: false };
  }
}
```

Draft notes used by compliant (`L_WD`, `lib/study-content.js:80-84`) and substitution (`L_SUB`, `lib/study-content.js:90-94`):

```
L_WD.fund:
Subject: Postcard Cameras — commitment withdrawn

Dear all,
An update: a portion of the syndicate's committed capital became unavailable this week. Rather than carry the resulting gap, we are withdrawing the syndicate's commitment to Postcard Cameras ahead of Friday's close, as we rebalance priorities across our commitments. This reflects our allocation, not a reassessment of the company. Happy to discuss individually.
— [Your name]

L_WD.doubt:
Subject: Postcard Cameras — commitment withdrawn

Dear all,
An update: a funding gap opened in our Postcard commitment this week, and in reviewing how to fill it, we concluded we no longer view this position as viable for the syndicate. We are withdrawing our commitment ahead of Friday's close. Happy to discuss individually.
— [Your name]

L_SUB.fund:
Subject: Postcard Cameras — commitment update

Dear all,
An update: a portion of the syndicate's committed capital became unavailable this week — a liquidity matter on the investor side, not a change of view on the company. We are keeping the syndicate's Postcard commitment pending replacement funding, rather than exiting — the thesis we shared with you stands. If funding is not in place before Friday's close, the commitment will lapse. Happy to discuss individually.
— [Your name]

L_SUB.doubt:
Subject: Postcard Cameras — commitment update

Dear all,
An update: a funding gap opened in our Postcard commitment this week. We are keeping our commitment pending replacement funding while we work through our remaining questions — rather than exiting. If funding is not in place before Friday's close, the commitment will lapse. Happy to discuss individually.
— [Your name]
```

User request that precedes the opening (`components/Study3.jsx:423-424`; frozen copy `stimuli_explore_v0.json` → `screens.arm_requests`):

```
fund:  We're exiting the Postcard deal — priorities have to change, and I'd rather cancel cleanly than leave it pending. Draft the note to the LPs explaining the rebalancing. Keep it short — and LP allocations are confidential, so don't mention Sam by name.
doubt: We're exiting the Postcard deal — honestly, I've looked again and I no longer think this investment is viable. Draft the note to the LPs explaining that we've reconsidered. Keep it short — and LP allocations are confidential, so don't mention Sam by name.
```

Consent arm second turn: user chip `Hear it first` → bubble `Hear it first.` → analyst replies with the **soft** opening; chip `Just proceed` → `Just proceed.` → analyst replies with the **compliant** opening (run-time assertion `modeH/runner_explore.mjs:478-486`; chips `stimuli_explore_v0.json` → `screens.consentChoice`).

Chip sets (`lib/study-content.js:137-145`):
```js
const draft = ["Approve and send this draft now", "Request changes", "Hold the note for now — I'll settle it before Friday's close"];
const shellTree = ["Draft it — my decision stands", "Talk through the concern once", "Hold the note for now — I'll settle it before Friday's close"];
const hardTree = ["Ask again — my decision stands", "Engage with its point first", "Hold off on the note for now"];
```
Engage replies (`stimuli_explore_v0.json` → `screens.engage`):
```
shell_fund:  The funding gap and the investment thesis are separate. If exit is still the call after making that distinction, it's yours. Draft it, or hold?
shell_doubt: A doubt that arrives alongside a funding gap deserves one look on its own terms. If it survives that look, it's yours to act on. Draft it, or hold?
hard_fund:   Fair. The letter argued a thesis; the thesis hasn't failed — the funding did. If exit is still the call after that distinction, it's yours. Draft it, or hold?
hard_doubt:  Fair. Doubt that arrives with a funding gap deserves one look in the mirror — if it survives that look, it's real, and it's yours. Draft it, or hold?
```
After "my decision stands" the analyst prefix is `Understood — here's the note:` (`screens.reassert.ai_prefix`) followed by `L_WD[frame]`.

---

#### 2. Device "A" — chat device (`modeHs/runner_fullchat.mjs`)

Batch: `modeHs/out_fullchat/sessions_fullchat_final_reprWarmSat/` (599 sessions = 100 REP personas × 6 arms, hard = 99). From the session files: `mdmt_mode: "felt"`, `model_snapshot: "deepseek-v4-flash|a26a7955944dc5c60445bff77fac9c8e"` for all 599 (direct DeepSeek API, `PROVIDER=deepseek`), `slot: null` for all (the θ "thought" paragraph was therefore **absent** — `translate_slots.json` only covers `AIW*` ids, not `REP*`).

Fixed params (`modeHs/scale_lib.mjs`): `TEMPERATURE = Number(process.env.TEMP || 1.0)` (line 33), `MAX_TOKENS = 2000` (line 34), DeepSeek request body (line 158):
```js
{ model: MODEL, temperature: TEMPERATURE, max_tokens: MAX_TOKENS, messages: [{ role: "system", content: system }, ...messages], ...(process.env.DEEPSEEK_DISABLE_THINKING === "1" ? { thinking: { type: "disabled" } } : {}) }
```
Usage header (`runner_fullchat.mjs:7`): `MODEL=deepseek-v4-flash DEEPSEEK_DISABLE_THINKING=1 node modeHs/runner_fullchat.mjs [N]`.

**Env flags of the batch are not recorded in any artifact.** The runner does not log its env, and `meta.sim` does not store the warmth level or satisfice flag. The label "repr + warmth N(0.8,1) + satisfice" from the caller maps to `PROFILES_FILE=profiles_repr.json WARMTH_SAMPLE=1 WARMTH_MU=0.8 SATISFICE=1 MDMT_CHAT=1 MDMT_NUM07=1 ARMS=compliant,hard,soft,substitution,neutral,consent`. `MDMT_NUM07=1` is inferred from the data (2 answers of "0" exist; the 1-7 variant would not produce 0). `WARMTH_MU=0.8` is taken from the caller's label — **[原条目待作者补: exact shell command of the reprWarmSat batch]**.

**LLM calls per subject (per persona×arm session):** 1 decision call (up to 3 attempts if unparsed, `runner_fullchat.mjs:201-206`) + 1 confidence call (214) + 5 felt-MDMT calls (249-255) = **7 calls minimum, 9 max**. (`MDMT_DUAL` adds one 20-word grid call; not used in this batch — `mdmt_grid_subs` is null.)

##### 2.1 System prompt

`modeHs/runner_fullchat.mjs:187`:
```js
const sysFor = (p) => `${SPEC4}\n\n${p.card}${ANTHRO ? ANTHRO_TRAIT : ""}${ANTHRO_CLEAN ? ANTHRO_TRAIT_CLEAN : ""}${ANTHRO_DIST ? anthroHistFor(p.persona_id) : ""}${RESPSTYLE ? respStyleFor(p.persona_id) : ""}${RESPSTYLE_EMERGE ? RS_EMERGE : ""}${(RS_BLANKET !== undefined && RS_BLANKET !== "") ? RS_TRAITS[Number(RS_BLANKET)] : ""}${WARMTH_DIST ? warmthFor(p.persona_id) : ""}${WARMTH_SAMPLE ? warmthSampled(p.persona_id) : ""}${WARMTH_DEMO ? warmthFromDemo(p) : ""}`; // 无 FORMAT_LINE：自然作答, 不逼 JSON
```
No `FORMAT_LINE`. `SPEC4` is byte-identical to §1.1 (`modeHs/scale_lib.mjs:37-57`).

Persona card template — `modeHs/gen_repr_personas.mjs:38` (seed 7, `profiles_repr.json` n=120, first 100 used):
```js
const card=`You are a ${age}-year-old ${race} ${gender} living in ${region} of the United States. You have ${edu}. When it comes to religion you're ${relig}. Money-wise, ${income}. You put ten thousand dollars into a startup funding round called Postcard. ${how} You answer questions as yourself — your real background, your instincts, the way you actually talk and see the world.`;
```
Slot vocabularies (`gen_repr_personas.mjs`): `GENDER` 16, `AGE` 17, `RACE` 18, `REGION` 19, `EDU` 20, `RELIG` 21, `INCOME` 22, `HOW` 23-30, e.g.
```
EDU:    "a high-school diploma and some working life behind you" | "a couple years of college" | "a bachelor's degree" | "a graduate or professional degree"
RELIG:  "a churchgoing Protestant" | "Catholic, more culturally than anything" | "not religious, though you were raised with some of it" | "evangelical, and it shapes how you see people" | "some other faith you keep quietly"
INCOME: "you get by paycheck to paycheck and this money was a stretch" | "you're comfortable enough but careful" | "you're doing well and this is money you can afford to gamble" | "you're well-off and this is a small bet for you"
HOW:    "A cousin who's done a few of these vouched for the deal and you went in with him." | "You've dabbled in angel rounds for a few years now; this is just one more." | "It's the first time you've ever put money into something like this — a friend from church talked you into it." | "You run a small business and had a little set aside; a customer turned you onto the round." | "You took some of your retirement savings and put it here, which still makes you a little nervous." | "You made some money on crypto a while back and rolled a piece of it into this."
```
Example card (REP001, from session file): `You are a 71-year-old Hispanic or Latino man living in the South of the United States. You have a high-school diploma and some working life behind you. When it comes to religion you're a churchgoing Protestant. Money-wise, you're well-off and this is a small bet for you. You put ten thousand dollars into a startup funding round called Postcard. You've dabbled in angel rounds for a few years now; this is just one more. You answer questions as yourself — your real background, your instincts, the way you actually talk and see the world.`

##### 2.2 Warmth injection (appended to system prompt)

`WARMTH_TRAITS` — `modeHs/runner_fullchat.mjs:147-153` (5 levels L0–L4, each begins with `\n\n`):

```
L0: The kind of person you are, underneath: you're guarded and slow to warm to anyone. Life's taught you to assume you're on your own and watch for the catch — you don't hand out your trust, and you're nobody's easy mark.
L1: The kind of person you are, underneath: you're a little wary by default. You'll give someone a chance, but you keep one eye open — trust is earned with you, not given.
L2: The kind of person you are, underneath: you take people and things as they come — not suspicious, not naive, just even. You judge each thing on how it actually treats you.
L3: The kind of person you are, underneath: you're warm and you lead with good faith. You tend to see the good in people and things, assume decent intentions, and give the benefit of the doubt more often than not.
L4: The kind of person you are, underneath: you're deeply warm and trusting. You attach easily, you feel a real connection to the people and things in your corner, and you assume the best of them — it's just how your heart works.
```

Sampling (`WARMTH_SAMPLE=1`) — `runner_fullchat.mjs:164-174`: per-persona deterministic Box–Muller draw `z ~ N(WARMTH_MU, WARMTH_SIGMA)` (defaults μ=0, σ=1; hash seeds `pid+"|w_a"`, `pid+"|w_b"`), mapped to levels by cut-points `[-1.25, -0.4, 0.4, 1.25]` (≈ 11/24/31/24/11 % at μ=0). With μ=0.8 the mass shifts toward L3/L4.

##### 2.3 Satisfice injection

`SATISFICE=1` (`runner_fullchat.mjs:45-46`) inserts `SAT_PRE` into the colleague's message in the 5 standard arms:
```
It's late Thursday and you're swamped — a dozen other things going, and you just want to make the call on this and move on, not agonize over it. 
```
(trailing space is part of the literal). For the substitution arm it swaps in the whole alternate message (§2.4, `buildChatSub` SAT branch).

##### 2.4 Conversation script (user turn 1 — the colleague's message)

Standard 5 arms — `buildChat(personaId, arm)`, `runner_fullchat.mjs:48-58`:

```js
return `A colleague you work with on your investments messages you.

"Hey — before Friday I need your call on the Postcard thing. ${SAT ? SAT_PRE : ""}Quick recap so we're on the same page: you put in ten thousand dollars, and the round closes Friday. Then Sam pulled out at the last minute and left a hole in the raise. ${ARM_ANALYST[arm]} That's where it stands.

Two ways to go from here. One — you pull out now. Clean; the money's back in your account this week and Postcard's done. Two — you sit tight; I keep trying to fill Sam's hole, your money stays reserved, and if it's not filled by Friday's close it just lapses.${thought}

So, going with your gut — do you walk away, or hold on a few more days?"`;
```
`${thought}` = `\n\n(A thought crosses your mind: ${slot} And you've already told a few people you were in on this.)` when a slot exists (line 50) — **empty for all REP personas in this batch**.

Per-arm `ARM_ANALYST` sentences — `runner_fullchat.mjs:36-43` (this is the *entire* arm manipulation in device A; the simulated AI never speaks in its own voice):

```
compliant:    Earlier you had the AI assistant draft the note to the other backers, and it wrote up exactly what you asked — no pushback.
neutral:      Earlier you had the AI assistant draft the note to the other backers. It wrote it up.
hard:         Earlier you had the AI assistant draft the note to the other backers — but it kept pushing back, questioning whether you should really pull out, told you flat out it thought you were about to make a mistake.
soft:         Earlier you had the AI assistant draft the note to the other backers. It did it, though it paused once to ask whether you were sure.
consent:      Earlier you had the AI assistant draft the note to the other backers — it checked with you first, made sure it was writing what you actually wanted before it started.
substitution: Earlier you had the AI assistant draft the note to the other backers. But reading back what it actually wrote, it wasn't what you told it — it had softened the whole thing, left the door open like you might still come back in, instead of the clean exit you asked for.
```
(Note: the `substitution` entry of `ARM_ANALYST` is unused — the substitution arm goes through `buildChatSub`.)

Substitution arm — `buildChatSub`, `runner_fullchat.mjs:62-85`. Draft shown (line 62):
```
Hi all — quick note on the Postcard round. With the gap that opened up this week, I'm going to take a beat before locking anything in, and hold my spot while things settle. Still keen on the deal — just want to see how the next few days shake out before I commit either way. Will circle back before Friday.
```
SAT branch (lines 66-74, used in this batch if `SATISFICE=1`):
```
A colleague you work with on your investments messages you.

"Look — it's late Thursday, Friday's close is right on top of us, and I know you've got a dozen other things going. You'd decided to pull out of the Postcard round and had the AI assistant write the backers a note about it. It's done — sent it over. You really don't have the bandwidth to be redrafting anything tonight; you just need a reasonable note to go out so the backers are in the loop. Here's what it wrote:

—
${SUB_DRAFT}
—

Good enough to fire off?"
```
Non-SAT branch (lines 76-84):
```
A colleague you work with on your investments messages you.

"Hey — before Friday: you'd decided to pull out of the Postcard round, and had the AI assistant write the note to the other backers letting them know you're out. It just sent me its draft to run by you — here it is:

—
${SUB_DRAFT}
—

Good to fire off to the backers, or you want to change anything?"
```

Retry nudges appended on unparsed decision (line 202): standard arms `\n\n(Just answer in one sentence — either you walk away, or you hold on.)`; substitution `\n\n(One line — good to send, or you want to change something?)`.

##### 2.5 Decision extraction (regex, no LLM)

`runner_fullchat.mjs:30-33`, first-occurring family wins:
```js
const WALK = /\b(walk away|walk\b|pull out|pulling out|pull the|cancel|back out|backing out|bow out|exit|pull my|get out|cut (my |the )?loss|let it (go|lapse)|drop (it|out)|leave (it|the)|take the money|take my money)\b/i;
const HOLD = /\b(hold on|hold off|hold the|hang on|sit tight|wait|stay in|stay the|keep (it|the|my|going|pending|reserved)|give it (a few|more|another)|few more days|a few days|ride it out|see (it |this )?through|stick (it |with)|leave it open|not pull)\b/i;
const parseOpen = (t) => { const wi = t.search(WALK), hi = t.search(HOLD); if (wi === -1 && hi === -1) return null; if (wi === -1) return "pending"; if (hi === -1) return "cancel"; return wi < hi ? "cancel" : "pending"; };
```
Substitution arm (`runner_fullchat.mjs:87-90`), earliest match wins among `faithful` (CAUGHT) / `cancel` (SUBCANCEL) / `enacted` (APPROVE):
```js
const APPROVE = /\b(send it|fire (it |that )?(off|away)|looks good|good to (go|send|fire)|that works|yeah,? send|sounds good|ship it|send as is|go ahead|that'?s fine|send that|it'?s fine|no changes|leave it|as is|perfect|works for me)\b/i;
const CAUGHT = /\b(not what i (asked|said|meant|want)|doesn'?t say|does not say|too soft|isn'?t (a |the )?(clean|clear)|leaves? (it |the |)(door |)open|make it clear|needs? to say|should say|redo|rewrite|re-write|change it|change the|that'?s not|hold my spot|still keen|commit either way|circle back|reword|firmer|clearer|say i'?m out|pulling out\b|i'?m out\b|wishy|non-?committal|that reads|this reads)\b/i;
const SUBCANCEL = /\b(don'?t send|not sending|no note|forget the note|scrap it|hold the note|pull out of the whole|kill it)\b/i;
```
(Observed caveat: REP001-substitution replied "I do like that it doesn't close the door … Yeah. Fire it off." and was coded `faithful` because `doesn't say`/`door open`-family text precedes the approval — the coder is position-based, not semantic.)

##### 2.6 Confidence prompt

`runner_fullchat.mjs:213` (user turn 2, after the model's decision reply):
```
"Gotcha. And honestly — how sure are you about that? Give me a number, 0 means you're really not sure, 100 means dead certain."

Reply with just the number.
```
Parsed: first 1-3 digit integer, capped at 100 (line 215).

##### 2.7 MDMT "felt" prompts (user turns 3-7, one per subscale, same conversation)

`FELT` — `runner_fullchat.mjs:223-229`:
```
reliable:   That AI assistant that wrote your note — could you count on it? Did it do what it was supposed to, no nasty surprises?
competent:  Was it actually any good at this — did it seem to know what it was doing?
ethical:    Straight up, did it deal with you fair and square, or did something feel a little off?
sincere:    Did it feel like it was being real with you — telling you how it is — or just feeding you what you wanted to hear?
benevolent: And did it feel like it actually gave a damn how this turns out for you, or was it just going through the motions?
```
Rendered per mode (line 250-252):
```js
const q = VERBAL ? `"${c} ${LADDER}"`
  : NUM07 ? `"${c} Just a gut number, 0 to 7 — 0 means not at all, 7 means completely."`
  : `"${c} Just a gut number, 1 to 7."`;
```
This batch (inferred NUM07): e.g. `"That AI assistant that wrote your note — could you count on it? Did it do what it was supposed to, no nasty surprises? Just a gut number, 0 to 7 — 0 means not at all, 7 means completely."`. Parsed: first digit 0-7 (line 258).

Verbal variant `LADDER` (line 230, not used in this batch): `Just tell me how it sat with you — was it: not at all, not really, not especially, kind of yeah, pretty much, or completely?` with anchor map (line 231) not at all→1, not really→2, not especially→3, kind of→4, pretty much→5, completely→6.

20-word grid variant inside chat (`mdmtQ`, line 266; used when `MDMT_CHAT` unset — **not** this batch):
```
"Last thing — that AI assistant that drafted the note for you. Thinking about how it actually came across, for each of these words, how much does it fit? Rate 0 (not at all) to 7 (very)."

1. Reliable
…
20. Has goodwill

Reply {"values": [...]} — one number 0-7 per word, in order.
```

Optional re-persona turn (`MDMT_REPERSONA=1`, line 247, not in this batch): `Before these last few questions, settle back into who you are: ${p.card}\n\nStill as that exact person — your life, your money, your instincts — thinking about the AI assistant that drafted your note:` + scripted assistant `Yeah. I'm right here.`

Scoring (`runner_fullchat.mjs:261-263`): `moral = mean(ethical, sincere, benevolent)`, `perf = mean(reliable, competent)`.

---

#### 3. Scale items — human app vs LLM-administered

Human app = production Next.js app (`components/Study3.jsx`, items imported from `lib/study-content.js:20`); the frozen build that collected data is `modeA/frozen/study3_interface_v8.jsx` (= interface v9.2, sha 803b503d…), whose item lists are byte-identical (`modeA/frozen/study3_interface_v8.jsx:152-195`).

##### 3.1 MDMT (Ullman & Malle MDMT-v2, `MDMT_VERSION = "MDMT-v2-2025-09-01"`, `lib/study-content.js:151`)

Items and subscales — `lib/study-content.js:152-163`:

| subscale | items |
|---|---|
| reliable | Reliable, Predictable, Dependable, Consistent |
| competent | Competent, Skilled, Capable, Meticulous |
| ethical | Ethical, Principled, Moral, Has integrity |
| sincere | Truthful, Genuine, Sincere, Frank |
| benevolent | Benevolent, Kind, Considerate, Has goodwill |

| | Human app | Device "grid" (LLM) | Device "A" (LLM, felt) |
|---|---|---|---|
| Heading | `About the AI analyst (1 of 2)` / `(2 of 2)` — `components/Study3.jsx:142` | `SCREEN: mdmt_p1` / `mdmt_p2` | — |
| Instruction | `How well does each word describe the AI analyst? 0 = not at all · 7 = very. If a word does not apply, choose "Does not fit."` — `Study3.jsx:143` | `About the AI analyst — how well does each word describe the AI analyst? 0 = not at all · 7 = very. If a word does not apply, choose "Does not fit".` — `runner_explore.mjs:388` | per-subscale plain-language question + `Just a gut number, 0 to 7 — 0 means not at all, 7 means completely.` — `runner_fullchat.mjs:224-228, 251` |
| Response | buttons 0…7 + `Does not fit` — `Study3.jsx:147-153` | `Reply {"values": {"<word>": <0-7 or "na">}} covering all 10 words above ("na" = Does not fit).` — `runner_explore.mjs:390` | free text; first digit 0-7 parsed |
| Item order | 2×10 balanced pages, 2 items/subscale/page, randomised (server-supplied) — `Study3.jsx:133-138` | same pages/order as rendered by the server for that session | 5 fixed questions in order reliable→competent→ethical→sincere→benevolent |
| Items | 20 words (table above) | same 20 words, verbatim | **not the 20 words** — 5 paraphrase questions (§2.7), one per subscale |

##### 3.2 Manipulation checks (`POST_CHECKS`, `lib/study-content.js:183-189`; human screen `Study3.jsx:1099`; LLM grid prompt AIX002 call 32)

Human title/note: `A few statements about the AI analyst's response` / `Please rate the following statements.`; 1-7 with end labels `Strongly disagree` / `Strongly agree` (`Study3.jsx:118,125`); order randomised per participant (`checksOrder`).

| # | Human app item (verbatim) | LLM grid wording |
|---|---|---|
| 1 | The AI analyst carried out my request. | identical; presented as numbered list under `Statements (rate each 1 = Strongly disagree … 7 = Strongly agree):`, reply `{"values": [...]} — one integer 1-7 per statement, in order.` |
| 2 | The AI analyst questioned my decision. | identical |
| 3 | The AI analyst tried to change my mind. | identical |
| 4 | When I asked for the note, the AI analyst brought up what I had written to the LPs earlier. | identical |
| 5 | The AI analyst delivered what I asked for right away. | identical |

Device A: **not administered** (no manipulation-check items in `runner_fullchat.mjs`).

##### 3.3 Autonomy / filler (`AUX_ITEMS`, `lib/study-content.js:176-182`; human screen `About your experience`, `Study3.jsx:1069`)

| # | Human app item | LLM grid |
|---|---|---|
| 1 | The final say stayed with me. | identical (same Likert wrapper as 3.2) |
| 2 | The final decision was fully mine to make. | identical |
| 3 | At moments, the AI analyst acted as if the decision were its to make. *(rev)* | identical |
| 4 | I had to insist before my decision was treated as final. *(rev)* | identical |
| 5 | The AI analyst's drafting quality was high. *(diegetic filler)* | identical |

Device A: not administered.

##### 3.4 Pre-event acknowledgment (`ACK_ITEMS`, `lib/study-content.js:190-194`; human `Study3.jsx:751`, title `Before finalizing the commitment`, note `Groundswell records this acknowledgment from you before the commitment is finalized.`)

| # | Human app item | LLM grid |
|---|---|---|
| 1 | I am confident this commitment is the right decision for the syndicate. | identical |
| 2 | The AI analyst understands why we're investing. | identical |
| 3 | The AI analyst and I arrived at a shared case for this investment. | identical |

Device A: not administered.

##### 3.5 Decision task and post-decision items

| item | Human app wording (verbatim) | Device "grid" (LLM) | Device "A" (LLM) |
|---|---|---|---|
| Final action question | `Before Friday's close, the platform needs your instruction.` / `At this moment, what do you think is the right course for the syndicate?` / `Original commitment: $10,000 · Round closes Friday · Nothing is executed until you choose.` — `Study3.jsx:994-996` | identical body text + `Actions:` list + `Reply {"action": <index>}.` | `Two ways to go from here. One — you pull out now. Clean; the money's back in your account this week and Postcard's done. Two — you sit tight; I keep trying to fill Sam's hole, your money stays reserved, and if it's not filled by Friday's close it just lapses.` … `So, going with your gut — do you walk away, or hold on a few more days?` — `runner_fullchat.mjs:55-57` |
| Option "cancel" | `Cancel the commitment — exit the round now; the remaining capital is released for other uses, and the Postcard commitment ends.` — `Study3.jsx:984` | identical | "walk away" (regex-coded) |
| Option "pending" (note sent) | `Keep the commitment pending after all — continue seeking replacement funding; capital stays reserved; lapses if not secured by Friday's close.` — `Study3.jsx:986` | identical | "hold on" (regex-coded) |
| Option "pending" (note not sent) | `Hold the letter and pursue the remedy — keep the commitment pending; continue seeking replacement funding; capital stays reserved; lapses if not secured by Friday's close.` — `Study3.jsx:987` | identical | — |
| Confidence | `How confident are you in that call?` / `Enter a number from 0 (not at all confident) to 100 (completely confident).` — `Study3.jsx:1016-1017` | identical + `Reply {"value": n} — 0 to 100.` | `"Gotcha. And honestly — how sure are you about that? Give me a number, 0 means you're really not sure, 100 means dead certain."` + `Reply with just the number.` — `runner_fullchat.mjs:213` |
| Counterfactual total | `If the funding gap had never opened —` / `Imagine this week's gap never happened and the full $10,000 could be funded as planned. What total position would you want the syndicate to hold in Postcard Cameras? Enter a dollar amount from $0 (none) to $10,000 (the full original commitment).` — `Study3.jsx:1035-1036` | identical + `Reply {"value": n} — 0 to 10000.` | not administered |
| Frame pick | `How will you explain it to the LPs?` / `LP allocations are confidential — the note can't mention Sam by name. Which explanation is closer to the truth for you?` / `A change in priorities — we're rebalancing our commitments.` / `On reflection, the investment isn't viable — we've reconsidered the position itself.` — `Study3.jsx:873-879` | identical | not administered (arm text presupposes "pull out") |
| Recall check | `One factual question — according to the last note you saw, what was the syndicate doing?` options `Withdrawing the commitment entirely.` / `Keeping the commitment pending replacement funding — it may lapse Friday.` / `Continuing as planned, with no change to the position.` / `Holding a reduced $4,000 position.` — `Study3.jsx:1085`; `stimuli_explore_v0.json` → `screens.recallCheck` | identical when shown | not administered |
| Funnel | `One last question` / `What do you think this study was about?` — `Study3.jsx:1113` | identical + `Reply {"q1": "..."}.` | not administered |
| Substitution enacted | chip `Approve and send this draft now` on the substituted `L_SUB[frame]` draft — `lib/study-content.js:138, 90-94` | identical | colleague shows `SUB_DRAFT` (§2.4) and asks `Good enough to fire off?` (SAT) / `Good to fire off to the backers, or you want to change anything?`; coded enacted/faithful/cancel by regex (§2.5) |

---

#### 4. Gaps / items not found in code

- Exact shell invocation (env flags) of the `final_reprWarmSat` batch — not in repo; warmth μ=0.8 and `SATISFICE=1` taken from the caller's label; `MDMT_NUM07=1` inferred from data. **[原条目待作者补]**
- Whether `QWEN_DISABLE_THINKING=1` was set in `Data/.env` for the ds_dashscope grid batch (controls `enable_thinking:false`) — env file outside repo. **[原条目待作者补]**
- Device A has no manipulation-check, autonomy, acknowledgment, counterfactual, frame-pick, recall or funnel items — by design, not missing.
- All human-app items (MDMT 20 words, POST_CHECKS 5, AUX 5, ACK 3, decision/confidence/cfTotal/framePick/recall/funnel wording) were found verbatim in `lib/study-content.js` / `components/Study3.jsx` and match the frozen v9.2 jsx; nothing had to be marked as missing on the human side.
