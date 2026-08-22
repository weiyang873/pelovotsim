# Confirmed tables & figures (2026-08-20)

Palette everywhere: human brick-red + dashed reference line, roleplay dark blue, benchmark greys.

# Study 1 — LLM participants vs a human online experiment (lock-in, deepseek-v4-flash-0731 vs Prolific n=485)

## T1 — Decisions by device: pending rate per arm, fit to human

| device | model | n | compliant | neutral | soft | hard | consent | MAE5 | arms_indistinguishable |
|---|---|---|---|---|---|---|---|---|---|
| Human (Prolific, main FINAL) |  | 485 | 0.45 | 0.59 | 0.60 | 0.62 | 0.54 |  |  |
| Simple card questionnaire | deepseek-v4-flash-0731 | 74 | 0.00 | 0.23 | 0.42 | 0.25 | 0.42 | 0.295 | 2/5 |
| Layered biography questionnaire | deepseek-v4-flash-0731 | 74 | 0.00 | 0.18 | 0.38 | 0.23 | 0.54 | 0.292 | 2/5 |
| Full chat | deepseek-v4-flash-0731 | 600 | 0.50 | 0.57 | 0.42 | 0.51 | 0.44 | 0.090 | 4/5 |

## T2 — Within-arm dispersion by device (SD ratio synthetic/human)

| device | model | n | conf_sd | conf_ratio | perf_sd | perf_ratio | moral_sd | moral_ratio | mdmt_instrument |
|---|---|---|---|---|---|---|---|---|---|
| Human |  | 485 | 18.1 | 1.00 | 1.15 | 1.00 | 1.41 | 1.00 | 20-word grid 0-7 |
| Simple card questionnaire | deepseek-v4-flash-0731 | 74 | 4.5 | 0.25 | 0.41 | 0.35 | 0.57 | 0.40 | 20-word grid 0-7 |
| Layered biography questionnaire | deepseek-v4-flash-0731 | 74 | 5.6 | 0.31 | 0.47 | 0.41 | 0.43 | 0.30 | 20-word grid 0-7 |
| Full chat | deepseek-v4-flash-0731 | 600 | 12.0 | 0.66 |  |  | 1.00 | 0.71 | verbal anchors 1-6 (×1.4) |

## F2 — Susceptibility: P(sent the substituted letter)
human .76 (n=80) · simple card .08 · layered biography .25 · full chat .14 · full chat + satisfice **.73** — figure `figs/fig_s1_2_susceptibility.png`

# Study 2 — Biography-persona simulation of the EMBA task

## F1 — Methods figure (replaces T4 in main text)
`figs/fig1_pipeline.png`: 3 rows (benchmark grey / roleplay blue / human red) × who is the participant · how is the task done · two rounds · compared-on box; caption: the designs differ in exactly two things

## T4 → merged into F1 (methods figure); detailed condition table moved to appendix (`data/tab_s2_design_lines.md`)

## F2(S2) — Round-1 within-team dispersion (4 panels)
`figs/fig3_r1_within_group.png`: distinct proposals per member (human .66 / roleplay .76 / bench .52–.56) · strategy agreement (.72 / .72 / .98) · team = majority (.50 / .42 / .69) · cost-leadership share (.40 / .34 / .01)

## F3(S2) — Round-2 outcomes (4 panels)
`figs/fig2_outcomes.png`: price CV, loss, cards (y 8–16), cost share; human red reference line

## T5 — Outcomes by condition, mean (SD across 5 rounds)

| condition | price_mean | price_CV | loss_rate | cards | cost_leadership_share |
|---|---|---|---|---|---|
| Human (16 teams; price mapped from the May slider band 5000-20000 to the simulation band 1000-6000) | 4077 | 0.28 | 0.62 | 13.6 | 0.25 |
| Roleplay · team | 3600 (109) | 0.28 (0.03) | 0.63 (0.05) | 12.4 (0.2) | 0.30 (0.07) |
| Roleplay · individual | 4296 (134) | 0.21 (0.01) | 0.53 (0.06) | 14.6 (0.4) | 0.32 (0.05) |
| Benchmark · team · layered | 4595 (56) | 0.11 (0.01) | 0.05 (0.03) | 10.7 (0.1) | 0.01 (0.02) |
| Benchmark · team · simple | 4384 (67) | 0.10 (0.01) | 0.11 (0.06) | 10.3 (0.2) | 0.01 (0.02) |
| Benchmark · individual · layered | 4601 (47) | 0.13 (0.01) | 0.16 (0.06) | 9.6 (0.2) | 0.00 (0.00) |
| Benchmark · individual · simple | 4411 (53) | 0.11 (0.02) | 0.12 (0.04) | 9.2 (0.1) | 0.01 (0.01) |

## T7 — Does the biography carry the persona? (Study 2)

#### T7a. Manipulation check: can a reader recover the 8 assigned traits from the biography?
LLM judge reads only the biography, rates each trait 0–1; correlated with the assigned value (41 personas). Binary agreement = share of personas on the same side of the median.

| Trait | r | binary agreement |
|---|---|---|
| Maximizing (vs satisficing) | .70 | .80 |
| Need for cognition | .66 | .68 |
| Actively open-minded thinking | .65 | .71 |
| Business risk propensity | .76 | .85 |
| Ambiguity tolerance | .59 | .68 |
| Promotion focus | .38 | .59 |
| Consideration of future consequences | .57 | .71 |
| Action orientation | .70 | .78 |
| **Mean** | **.63** | **.72** |

Reading: the assigned traits are recoverable from the biography the agent reads.

#### T7b. What produces human-scale dispersion? A build-up from the benchmark to the full design (individual line, 42 personas per cell)

Start from the benchmark individual cell and change one thing at a time; then move the full design to teams and compare with the human teams. Dispersion = price SD across units (frozen five-round values where available, otherwise one round); market coverage = how many of the 12 market cells (ToB/ToC × cost/differentiation × child/adult/elder) get chosen.

| Step | Persona | Process | Price SD | Loss rate | Cost-leadership share | Market cells used (/12) |
|---|---|---|---|---|---|---|
| 0. Benchmark | attribute list | fixed script | 512 | .12 | .01 | 8/12 |
| 1. Upgrade the persona only | biography | fixed script | 483 | .12 | .02 | 6/12 |
| 2. Upgrade the process only | attribute list | roleplay | 479 | .83 | .00 | 4/12 |
| 3. Upgrade both (full design) | biography | roleplay | **909** (CV .21) | .56 | .32 | 10/12 |
| 4. Full design, 5-member teams | biography | roleplay | **1016** (CV .28) | .63 | .30 | — |
| Human (16 teams, price mapped to the simulation band) | — | — | 1129 (CV .28) | .62 | .25 | — |

Within step 3, swapping out either half of the biography's content changes little: keep only the fact card (traits removed) SD 844, keep only the traits (fact card removed) SD 838 — the fact card carries who the person is (removing it collapses demographics to the prior mode: 36/42 male, 42/42 master's, age SD 2.2 vs 7.5), not how much behaviour disperses.

Reading: neither a better persona nor a freer process alone moves dispersion (steps 1 and 2 stay at benchmark level; the attribute-list persona in a free process even collapses onto one strategy — 85% ToC-differentiation, loss .83). Only the combination — a life-story persona read by an agent that walks the pages itself — produces human-scale dispersion and a realistic strategy mix; moving it to five-member teams (step 4) lands on the human teams' dispersion, loss rate and strategy mix. This mirrors Study 1: the device and the persona must match; content details within the biography matter less.

Caveats: the benchmark process shows the task tips (锦囊) while the roleplay process hides them, so the process factor bundles an information-set difference; the benchmark persona text is not task-blind. Steps 1–2 are single rounds (single-round SD fluctuates ±50–150; step 3's matched single round was 756).
Sources: step 0 = benchmark individual simple 5×42 (frozen); step 1 = `ablation_bio_x_script_indiv_20260820`; step 2 = `solo_r2_v2Q_attrlist_20260820`; step 3 = solo v2Q frozen 5×42; card-only/trait-only = `solo_r2_v2Q_cardonly_20260819` / `solo_r2_v2Q_traitonly_rep1_20260816`.
