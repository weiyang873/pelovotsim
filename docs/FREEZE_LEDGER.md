# FREEZE_LEDGER — four frozen lines (2026-08-16)

All numbers are five-round intervals (mean ± SD across rounds; each round = 42 units) unless noted. Pool for all roleplay lines: `data/task_blind_persona_pipeline_v1/r1_pool42_20260812/persona_pool_task_blind_narrative_v1.json` (sha256 3e79d106…). Model: deepseek-v4-flash. Jinang hidden from synthetic prompts in all roleplay lines.

| Line | Preset / config | Code | Evidence | Key intervals |
|---|---|---|---|---|
| Benchmark team (simple / layered) | `random42_simple_layered_team5_v1` | frozen earlier | `runs_v4flash_0731/team_pilot/random42_free_0731_interface_team5_simple_teamlayerednomap_deepseek_20260814` | loss 5% / 24% (n=42 each); free_0731 pool |
| Benchmark solo (simple / layered) | `random42_simple_layered_individual_v1` | frozen earlier | `runs_v4flash_0731/simple`, `runs_v4flash_0731/layered` (chains) | loss 32% / 51%, SD 1427 / 1395 (pre-alignment, open-book); interface-aligned variants: loss 74% / 57%, SD 641 / 570 |
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
