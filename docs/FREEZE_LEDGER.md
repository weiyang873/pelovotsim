# FREEZE_LEDGER — four frozen lines (2026-08-16)

All numbers are five-round intervals (mean ± SD across rounds; each round = 42 units) unless noted. Loss = total profit < 0 (`settlement.profit`); `profitHW` is never negative in benchmark rounds. Pool for all roleplay lines: `data/task_blind_persona_pipeline_v1/r1_pool42_20260812/persona_pool_task_blind_narrative_v1.json` (sha256 3e79d106…). Model: deepseek-v4-flash. Jinang hidden from synthetic prompts in all roleplay lines.

| Line | Preset / config | Code | Evidence | Key intervals |
|---|---|---|---|---|
| Benchmark team (simple / layered) | `random42_simple_layered_team5_v1` (orchestrator, team_size 5, free_0731 interface pool, jinang visible) | frozen 08-14; module `benchmarkTeamSim.js` | 5 rounds: simple = `team_pilot/random42_free_0731_interface_team5_simple_teamlayerednomap_deepseek_20260814` + `benchmark_team_rep2-5_20260816`; layered (arm `layered`) = `benchmark_team_rep1layered_20260817` + `benchmark_team_rep2-5_20260816`. The 08-14 batch's `team_layered_nomap` arm is a different arm (deterministic L0/L1) and is not pooled. | simple: SD 424 ± 33, mean 4384 ± 67, cards 10, loss 11 ± 6%; layered: SD 486 ± 62, mean 4595 ± 56, cards 11, loss 5 ± 3%; COST ≈ 1%; paired (same seed) simple − layered price −211 ± 90, loss +6 ± 5 pts |
| Benchmark individual (simple / layered) | same team preset run on the orchestrator with `--team-size 1` (08-16); supersedes the 08-14 `single_ui_parity`/full_game individual line (different pipeline: SD 383 / 373, loss 62% / 50% — kept as reference only) | frozen earlier | `runs_v4flash_0731/team_pilot/benchmark_indiv_orch_rep1-5_20260816` (5 × 42 × 2 arms) | simple: SD 504 ± 82, mean 4411 ± 53, cards 9, loss 12 ± 4%; layered: SD 613 ± 67, mean 4601 ± 47, cards 10, loss 16 ± 6%; COST ≈ 0–1%; paired simple − layered price −190 ± 40, loss −4 ± 9 pts |
| Solo roleplay R1 | frozen 8/12 (screenplay single) | `frozen/code-0812-solo-evidence` | `solo_r1_hidden_rep1-5_20260815` | COST share 31.9 ± 4.8% |
| **Solo roleplay R2 v2Q** (frozen) | `solo_r2_v2q_perdim_reading_v1` — pricing-action D5; individual pick one dimension group per call; reading habit from biography | `frozen/solo-v2Q-20260816` (feee5124), module `soloRoleplayV2Sim.js` | `solo_r2_v2Q_rep1-5_20260816` | SD 912 ± 49, mean 4296 ± 134, cards 14.6 ± 0.4, coverCore 0.74, loss 53 ± 6%, COST 3470 / DIFF 4683 |
| Solo roleplay R2 v1 (reference, downgraded 08-16) | one-call pick, 8/12 code snapshot | `frozen/code-0812-solo-evidence` | `solo_r2_rep1-5_20260815` | SD 877 ± 64, mean 4294 ± 77, cards 10.1, loss 17.7 ± 4.1% |
| Team R1 | `team_r1_taskblind_actor_isolated_v1` (actor_isolated, cap24, live timeout submission) | `frozen/r1-actor-fix-20260814` lineage | `teamr1_cap24_rep1-5_20260815` (+retry) | success 99%, COST share 28.3 ± 6.1% |
| **Team R2 B** (frozen) | `team_r2_story3_converge_v1` — replay from frozen team R1; story D4 (reading habits from biography, no lean scaffolds) + six-segment screenplay review; D5 = three D4-style screenplay scenes (action → tier → slider), each member first commits privately (action/tier/price), pricing view read from biography, R1 public + private memory in every call, room converges to one member's position | `frozen/team-r2-story3-B-20260816` (bd935abd), module `teamR2StoryScreenplaySim.js` | `team_r2_story3_B_rep1-5_20260816` | SD 1029 ± 113, mean 3600 ± 109, cards 12.0, coverCore 0.67, loss 63 ± 5%, team price = a member's private price 88 ± 4%, success 38–41/42 |
| Team R2 A (control) | same as B without the converge rule (`TEAM_SIM_D5_CONVERGE` unset) | same | `team_r2_story3_A_rep1-5_20260816` | SD 661 ± 21, mean 3305 ± 107, loss 52 ± 6%, team price = a member's private price 68 ± 5% |

Human reference (WY): team price SD ≈ 1000, loss > 50%; 8/10 old-pool evidence (narrator arm, interface pool): SD 902, mean 3240, cards 11.3, coverCore 0.62, loss 45–65%; same machine + old pool rerun 2026-08-15 (Codex): SD 656, loss 60%.

## Environment (frozen values)
- Team R2 B: `TEAM_SIM_HIDE_JINANG=1 TEAM_SIM_D5_IDEOLOGY=1 TEAM_SIM_D5_PRIVATE_STAGE=1 TEAM_SIM_D5_CONVERGE=1`, arm `team_room_story_d4_screenplay3_d5_v1`, concurrency 3, sources `teamr1_cap24_rep{i}` (+ `_retry`).
- Solo v2Q: `TEAM_SIM_HIDE_JINANG=1 TEAM_SIM_D4_PER_DIM=1 TEAM_SIM_D4_READING=1`, arm `team_room_roleplay_ui`, sources `solo_r1_hidden_rep{i}` (+ `_retry`).
- Runner: `node scripts/analysis/run_frozen_r2_replay.js --preset <name> --rep <i> [--control <name>]`.

## Design decisions recorded with the freeze
1. Persona injection = biography + two lines (same as R1 actor_isolated); no derived labels, no numeric traits, no ledgers. Behaviour differences come from the biography through procedure (private staged commitment), not from stated stances.
2. Information-set alignment §1.5 (presentation structure): what real students never see on one screen is not concatenated (research tags vs card covers; dimension groups asked one at a time).
3. D5 room dynamics: convergence to one member's position (assumption; A/B recorded). Testable against human process data — fraction of team prices coinciding with a member's initial position (sim: 88%).
4. Known gap (finding, not bug): task-blind biography generation compresses promotion/risk on money matters (consumption fact cards independent of dims); individual private staged prices still disperse (SD ≈ 960) — the room, not the pool, was the bottleneck.

## Provenance discipline
Every prompt-layer change was verified by dumping the composed prompt from artifacts before launching; probes run one process per directory; `kill -9` + `ps` before relaunch; module snapshots are byte copies of orchestrator.js at the tagged commit.

## Reliability (test–retest across the five rounds, same unit / same composition, temperature 0.55 everywhere)

| Line | price within-unit SD / total SD | person (composition) variance share | cards within / total | R1 strategy agreement | grid agreement | loss agreement |
|---|---|---|---|---|---|---|
| Solo v2Q (same persona, same seed × 5) | 710 / 919 | 0.27 | 1.7 / 2.2 | 0.82 | 0.57 | 0.68 |
| Team R2 B (same composition × 5) | 789 / 1027 | 0.31 | 1.4 / 1.7 | 0.76 | 0.48 | 0.74 |
| Team R2 A | 488 / 662 | 0.35 | 1.3 / 1.6 | 0.77 | 0.48 | 0.72 |
| Benchmark team simple | 310 / 425 | 0.36 | 0.9 / 1.3 | 0.98 | 0.72 | 0.90 |
| Benchmark individual simple | 414 / 512 | 0.26 | 1.0 / 1.2 | 0.99 | 0.78 | 0.90 |

Reading: the person/composition share of price variance is ≈0.3 in every line (same temperature, same pipeline); trait-based lines scale between- and within-unit dispersion by the same factor (absolute within-unit SD ≈700 vs ≈300 in benchmark, because the roleplay chain has many more open-ended sampling steps: per-dimension picks, private stage, three screenplay scenes). A persona's price is therefore a distribution (SD ≈ 700), not a point; all between-arm comparisons rest on five-round means. Benchmark "agreement" is high mainly because it has little variance to disagree about (≈99% DIFF, ≈90% profitable). No human test–retest reference exists for this task.

## Replication probes & mechanism audit (2026-08-16/17; none of this changes the frozen lines)

All numbers below are observational unless marked "designed". Team R2 B = frozen mechanism (single-writer D4/D5 screenplay). Artifacts live in the claude worktree (`~/worktrees/emba-ai-sim-v01-claude`) under `runs_v4flash_0731/team_pilot/`, `runs_v4flash_0731/team_r2_replay/`, `data/synthetic/team_sim/`, `runs_v4flash_0731/probes/`; presets `team_r2_faultline_2x2_v1`, `team_r2_faultline_harrison_v1` (aborted), `team_r2_faultline_triad_probe_v1`, `team_r2_faultline_shared_card_v1`, `team_r2_fn_diversity_v1`, `team_r2_voice_probe_v1`, `team_r2_cascade_probe_v1`, `team_r2_actor_engine_probe_v1`; modules `teamR1FaultlineSim.js` (fixed teams), `teamR1FaultlineNotesSim.js` (+private notes), `teamR1SpeechQuoteSim.js`/`teamR1SpeechQuoteNotesSim.js` (v3 voice), `teamR2FaultlineSim.js` (fixed-team replay + actor-id fix), `teamR2VoiceProbeSim.js`, `teamR2CascadeProbeSim.js`; pools `v2_faultline_pool541_20260816` (541, generator v2), `faultline_design_pool60_20260817` (68 designed, v3-rewritten `persona_pool_merged_v3.json`), `faultline_shared_card_probe_20260817`, `speech_style_probe_v2_20260817`; exporter `scripts/analysis/export_conversation_txt.js`.

### 1. Eisenhardt (1989) — replicated in R2 card review (the cleanest positive)
Real-time information use (numbers/cost words per line in the D4 review) → shorter review, fewer cards, higher profit, lower loss; review length itself → worse. Holds in frozen B (201 rows, clustered by composition), 231 designed teams (single round), actor-engine 11 teams (direction), benchmark layered (the "good" half; length is fixed there). OLS with diversity controls: D4 length β −0.14…−0.18, info use +0.19…+0.21 (profit), −0.23…−0.30 (loss); diversity terms ≈0. R1 speed unrelated to performance (no data on that page). Alternatives considered in R1 → less loss but slower; leader adoption of own private price → profit (+0.45 composition-level, ns row-level).

### 2. Faultline (Lau & Murnighan; Thatcher/Bezrukova) — null on subgroup formation, positive on informational affinity
- Observational 42 comps: surface Fau → profit −0.21 (ns), deep Fau → loss −0.23 (ns); no relation to conflict measures.
- Designed 2×2 age×education (146 teams, R2 B): aligned → more COST/higher profit via strategy choice; process measures flat; coalitions along the line at chance (0.51–0.54).
- Fixed-triad probes: label twins (35) and shared-fact-card twins (31): private prices no closer than strangers (D–A gap 1127/1302 vs ~1000); designed pairs in same coalition 0.06–0.45 vs baseline 0.31.
- Designed 2×2 aligned/crosscut × private-info binding (60 R1 teams × 2 rounds, industry×function×age lines, Fau 1.00 vs 0.49; gender/education/traits checked for accidental alignment): info binding → same-side endorsement per dyad 0.82 vs cross 0.46 (aligned+info; p=.048 within cell), main effect of info +0.31 (p=.028); alignment increment +0.20 (p=.43); no subgroup talk by identity, coalitions not along the line, forced-submission gradient not replicated across rounds. Reading: shared task-relevant evidence creates informational affinity (mutual enhancement / informational faultline); social-category identification does not form. Salience levers tried (visible roster, speaker tags, private info, v3 voices) did not produce we/they talk (n=1–15).

### 3. Information cascade / herding — not reproduced with independent agents
Sequential per-member D5 announcements (11 teams): public = private 95%; when private disagrees with prior majority, follow 3/17 (0.18); leader keeps own 91%. The herding-like pattern in frozen B (77% keep, 49% follow) is a single-writer artifact.

### 4. Hidden profile — direction only, confounded
Shared picks (both assignees) retained 97% vs unique 84% (frozen B); mention rate ~100% for both; "shared" confounds quality; a proper test needs designed information distribution.

### 5. Team composition & conflict (frozen B, 42 comps × 5; row-level clustered)
Industry diversity → more cards / loss (β +0.17 / +0.24, p<.05), not via less elaboration but via more cards added in review; function diversity → fewer cards (−0.21), more forced submissions (+0.17), profit ns (designed contrast homogeneous vs diverse, 19 teams: null on cards/loss/profit; diverse teams talk cost more). Position divergence (private price SD) → log revenue −0.40 at composition level (row-level −0.14 ns), mediated by higher final price (dispersed teams also want higher prices; level and spread co-move). Coded task conflict saturated (≈4/5), relationship conflict floor (≈1); neither predicts performance. Diversity → log revenue: none.

### 6. Reliability, personality, and dialogue realism
Test–retest ICC ≈ 0.3 in every line (see Reliability section); persona price = distribution (SD ≈ 700), same magnitude as human GSS two-week retest inconsistency (Park et al. 2024) — analogy, not benchmark. Personality back-test: biography → 8 dims r 0.6–0.76 (0.73 binary agreement); speech → r ≈ 0.1 (0.48, chance): traits reach decisions, not language. Fixes that work (v3 direction, PERSONA_METHODS §6): speech style as an IID fact-card category + ≥3 quoted lines in the biography + quotes as actor samples; deterministic stripping of stage directions; per-beat response rules. Actor-engine R2 (per-member calls, 11 teams) yields more natural back-and-forth but different outcomes (cards 10.5 vs 12.7, loss 27% vs 70%) — the single-writer mechanism produces human-like aggregates (loss rate, herding) that per-agent generation does not: narrator mode ≈ human group outcomes, agent mode ≈ rational individuals. Flow audit: R1 speech is agent-decided (entrance judgement) on a random polling skeleton; D3 is beat-scheduled; D4/D5 are writer-narrated.
