# Paper presentation plan (2026-08-19)

Storyline in one line: **an LLM participant pool reproduces a human online experiment only when asked conversationally, with dispersion recovered by format and susceptibility by one injected imperfection (Study 1) → biography-persona simulation of an EMBA strategy task reproduces human within-team dispersion and outcome distributions and passes/fails the right theory probes (Study 2) → the simulation replicates Eisenhardt (1989) only where discussion length is endogenous (Study 3).**

Numbering: tables T1…, figures F1… run continuously across studies. Human reference throughout = 16 complete-chain EMBA teams (BigQuery export), scale-free metrics only (price CV, rates, counts).

---

## Study 1 — Pilot: can LLM participants reproduce a human online experiment? (LLM lock-in, 6-arm nudge study)
Human: Prolific main FINAL, 485 completes (~80/arm), 6 arms (compliant / neutral / soft / hard / consent / substitution). Synthetic: same persona pool (AIW cards), deepseek-v4-flash-0731, three *devices*: simple card questionnaire → layered biography questionnaire → full chat. (v6 mechanism chain and the qwen replication are dropped; satisfice injection appears only in Fig 2.) Script `study1_lockin_devices.py`.

| # | Type | Title | Rows / columns | Message | Status |
|---|---|---|---|---|---|
| T1 | table | Decisions by device vs human | rows = human + 3 devices; cols = pending rate per arm (5), MAE vs human, # arms indistinguishable (z) | device ladder simple .295 → layered .292 → **full chat .090 (4/5 arms ns)** | done `data/tab_s1_devices.csv` |
| T2 | table | Within-arm dispersion by device (SD ratio synthetic/human) | rows as T1; cols = confidence SD (ratio), MDMT performance SD, MDMT moral SD, instrument (grid 0–7 vs verbal 1–6 ×1.4) | questionnaire devices 0.25–0.4×; chat + verbal anchors 0.66× (confidence), moral 0.71× — dispersion collapse is largely an instrument artefact, not a model property | done `data/tab_s1_dispersion.csv` |
| F2 | figure | Susceptibility: P(sent the substituted letter), human vs devices | 5 bars ± 95% CI: human .76 (n=80) · simple .08 · layered .25 · full chat .14 · full chat + satisfice **.73** | decisions/dispersion recover with the chat device, susceptibility does not; one injected imperfection (satisficing) closes it | done `figs/fig_s1_2_susceptibility.*` |

Takeaway: the *device* (how the LLM is asked) dominates the *persona* and the *base model*; a conversational device with verbal scales reproduces human decisions and dispersion ; susceptibility needs one injected human imperfection (satisficing). This sets Study 2's design choices: biography personas, natural-flow discussion, dispersion as the first check.

## Study 2 — Biography-persona simulation of the EMBA task: benchmark vs task-blind design lines
Design lines (5 rounds × 42 units each): benchmark team simple / layered, benchmark individual simple / layered, solo v2Q, team R1 (actor-isolated) + R2 B (story + screenplay). Human: 16 teams.

| # | Type | Title | Content | Message | Status |
|---|---|---|---|---|---|
| F1 | figure | Simulation pipeline | persona pool (IID fact card → biography) → R1 (per-member proposals, actor-isolated discussion) → R2 (private stage, screenplay, converge) → settlement; benchmark path alongside | what differs between benchmark and design lines: persona layer + who ends the discussion | done `fig1_pipeline.py` |
| T4 | appendix table | Simulation conditions (detail) | grouped individual/team × benchmark simple/layered/roleplay | detail behind F1; F1 is the main-text methods exhibit | done `data/tab_s2_design_lines.md` (appendix) |
| F2 | figure | Round-1 within-team dispersion (human vs lines) | 6 panels: distinct picks/member, strategy agreement, age-segment agreement, architecture agreement, team = majority, COST share | human 0.66/0.72/0.67/0.62/0.50/0.40 ≈ task-blind 0.76/0.72/0.62/0.56/0.42/0.34; benchmark strategy agreement 0.98 | done `fig3_r1_within_group.py` → rename F2 |
| F3 | figure | Round-2 outcomes (human vs lines) | 4 panels: price CV, loss rate, cards, COST share | roleplay team CV .28 / loss .63 / cards 12.4 / COST .30 vs human .24 / .62 / 13.6 / .25; benchmark ≈ 99% DIFF, 90% profitable | done `fig2_tab1_outcomes.py` → rename F3 |
| T5 | table | Frozen-line outcomes | 6 lines + human; price mean/CV, loss %, cards, COST %, CV ratio vs human | numbers behind F3 | done `data/tab1_frozen_lines.csv` |
| T7 | table | Persona validity probes | rows = probe; cols = design, N, result | personality back-test bio r .6–.76 vs speech ≈ .1; trait-only biography (category collapses, behaviour does not); v3 speech layer | done `data/tab_s2_persona_validity.md` |

---

## Study 3 — Eisenhardt (1989): fast decisions and real-time information
| # | Type | Title | Content | Message | Status |
|---|---|---|---|---|---|
| T9 | table | Real-time information use, review length, and performance | 3 samples: roleplay team frozen (201 team-rounds, 42 compositions, clustered), benchmark simple (210), benchmark layered (210); standardized β, cluster-robust SE | info→profit +.26/+.21/+.21 everywhere; info→length **−.13** in roleplay vs **+.12/+.04** in benchmark (the Eisenhardt contrast lives in this column; no figure — F4 dropped); length→profit negative everywhere. Designed-team row dropped (R2 artifacts not retained). | done `tab9_eisenhardt.py` → `data/tab9_eisenhardt.csv` |

No Table 4-style effect summary beyond T9.

## Discussion points (no table; from the counter-probes, FREEZE_LEDGER "Replication probes")
1. What the platform can and cannot study: phenomena that run through *information* (who knows what → who endorses whom) reproduce — same-side endorsement .82 vs .46, info main effect +.31 (p=.028); phenomena that run through *social identity or conformity* do not — no us-vs-them talk under any manipulation, coalitions along demographic lines at chance, sequential announcements follow the majority only .18. The agents are socially polite but psychologically independent. Eisenhardt (Study 3) replicating is consistent with this boundary: it is an information mechanism.
2. Generation-mechanism artefacts: the frozen team line's apparent herding (49% follow) comes from a single narrator writing all five members; with per-member generation it disappears (and losses drop 70%→27%). LLM team simulations can manufacture "social" phenomena that are artefacts of who writes the dialogue — counter-probes like these are a necessary check before interpreting any group-level pattern.
3. Diversity/conflict: only cost-side diversity effects (industry mix → more cards, more losses); divergence hurts via price level, coded conflict is unobservable (task conflict at ceiling, relationship conflict at floor) — the polite-agent property again.

---

## Order of remaining work
1. Study 1: premise-denial exclusion for chat MAE (.090 → ≈.103) — decide.
2. Study 2: F3b variance decomposition figure (optional); rename fig files to F2/F3 at typesetting.
3. Study 3 done. Remaining: fig file renumbering at typesetting; commit.
