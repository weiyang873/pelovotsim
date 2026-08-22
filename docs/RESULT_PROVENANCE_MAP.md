# Result → code/data provenance map (silicon_subjects_report.docx, 2026-08-21)

Scope check for every number in the report. ✅ = script + data both located; ⚠️ = data located, table script missing (recompute needed); ❌ = missing.
Paths: `M` = main repo `~/Dropbox/Github_indiswyang/try/emba-ai-sim-v01`; `W` = `~/worktrees/emba-ai-sim-v01-claude`; `LK` = `~/Dropbox/LLM lock-in` (separate git repo at `LK/study3-app`, last commit a52b022 2026-08-06).

## Study 1 · Lock-in (LK)

| Report item | Data | Code | Status |
|---|---|---|---|
| Human 485 (all tables) | `LK/Data/study3_main/raw/main_full_export_FINAL_20260726.csv` (759 rows → 485 with arm & final_action) | filter in `M/paper/study1_lockin_devices.py` | ✅ |
| Grid (Jul) row, n=74 (compl .00 … MAE5 .295, enacted .08) | `LK/study3-app/modeH/out/sessions_explore_ds_dashscope/` (74, tracked) | `M/paper/study1_lockin_devices.py` ("Simple card questionnaire" row = identical numbers) | ✅ |
| Repr-pool · plain, n=595 | `LK/study3-app/modeHs/out_fullchat/sessions_fullchat_final_reprPlain/` + `ledger_fullchat_final_reprPlain.jsonl` — **untracked in git** | runner `modeHs/runner_fullchat.mjs` — **uncommitted diff (+123/−8)**; personas `modeHs/gen_repr_personas.mjs` → `profiles_repr.json` (both untracked) | ⚠️ data present; table script not found |
| A · Repr+warm+satisfice, n=599 (MAE5 .138, enacted .64, MDMT μ / SD ratio, 0–7 distribution) | `…/sessions_fullchat_final_reprWarmSat/` (599, untracked) | same runner; **no script found that produces the docx tables** (`analyze_mdmt6.py` reads the older `sessions_fullchat_mdmt6` 210-batch; `sd_dashboard.py` reads `out_progressive`; `paper/study1_lockin_devices.py` tabulates a different device set: dsq 600 / layered 74) | ⚠️ |
| Snapshot a26a7955 (Aug) | string not present in the final_repr* ledgers (only in `out_progressive`); `fp_8b330d02d0` is in `out/ledger_scale_v1.jsonl` | — | ⚠️ model snapshot of the final runs must be read from session JSON `meta` |
| Methodology claims (.83× zero-injection, single warmth .74×, blanket .86→.56×) | intermediate configs `out_fullchat/sessions_fullchat_mdmt6*` (210 each: repr, reprWarm, warmS, anthro*, resp*, sat, both…) | `analyze_mdmt6.py` (untracked) | ⚠️ one-config script; no sweep script |

Fix: point `study1_lockin_devices.py` `DEV` at `sessions_fullchat_final_reprPlain` / `…_reprWarmSat` (its loader already handles verbal-anchor MDMT); add the per-subscale μ/SD-ratio and 0–7 histogram; then commit runner + profiles + sessions in `LK/study3-app` (84 untracked files there today).

## Study 2 · EMBA teams (M + W)

| Report item | Data | Code | Status |
|---|---|---|---|
| Designs / F1 | — | `M/paper/fig1_pipeline.py` | ✅ |
| Human 16 teams (R1 + R2) | `M/exports/bq_real_teams_2026-07-12/csv/{member_submissions,round1_team_drafts,round2_submissions,round2_results}.csv` — **git-ignored** (`.gitignore:16 exports/`) | price mapping 5000–20000 → 1000–6000 in `fig2_tab1_outcomes.py` | ✅ (must be copied into the package by hand) |
| R1 within-team dispersion table | roleplay `W/runs_v4flash_0731/team_pilot/teamr1_cap24_rep*_20260815`; benchmark `M/runs_v4flash_0731/team_pilot/benchmark_team_rep[2-5]_20260816` (note: 4 rounds, rep1 not used) | `M/paper/fig3_r1_within_group.py` → `paper/data/fig3_r1_within_group.csv` | ✅ |
| R2 final decisions (T5) | benchmark: `M/…/random42_free_0731_interface_team5_simple_teamlayerednomap_deepseek_20260814` (simple rep1) + `benchmark_team_rep2-5_20260816` + `benchmark_team_rep1layered_20260817` + `benchmark_indiv_orch_rep1-5_20260816`; roleplay: `W/runs_v4flash_0731/team_r2_replay/solo_r2_v2Q_rep1-5_20260816`, `team_r2_story3_B_rep1-5_20260816` | `M/paper/fig2_tab1_outcomes.py` → `paper/data/tab1_frozen_lines.csv` | ✅ |
| Manipulation check T7a (41 personas, r / agreement) | original `M/paper/data/tab_s2_backtest.csv` (script lost); re-run 2026-08-22 → `M/runs_v4flash_0731/probes/personality_backtest_20260822/{judge_raw.jsonl,summary.csv}` (42 personas: bio mean r .60 / agree .72; speech r .02 / .49 — matches the lost run) | `M/scripts/analysis/probe_personality_backtest.js` | ✅ |
| Build-up T7b step 0 | frozen benchmark indiv simple (above) | `fig2_tab1_outcomes.py` loader | ✅ |
| step 1 biography + fixed script | `W/runs_v4flash_0731/team_pilot/ablation_bio_x_script_indiv_20260820` (42, arm simple, team_size 1, code 138261c5) | frozen replay runner | ✅ |
| step 2 attribute list + roleplay | `W/runs_v4flash_0731/team_r2_replay/solo_r2_v2Q_attrlist_20260820` (41) + R1 `solo_r1_attrlist_20260820` (42); pool `W/data/task_blind_persona_pipeline_v1/attrlist_pool42_20260820` (untracked; has `render_example.json`) | **pool generator script not found** | ⚠️ |
| step 3 / step 4 | frozen solo v2Q / team B | — | ✅ |
| fact-card-only SD 844 | `W/…/solo_r2_v2Q_cardonly_20260819` (40) + `solo_r1_cardonly_20260819`; pool `card_only_pool42_20260819` (untracked; `prompt_example.json`, `calls.json` kept) | generator script not found | ⚠️ |
| traits-only SD 838 | `W/…/solo_r2_v2Q_traitonly_rep1_20260816`; pool `M/data/task_blind_persona_pipeline_v1/trait_only_pool42_20260816` | `M/scripts/analysis/probe_trait_only_biography.js`, `build_trait_only_pool.js` | ✅ |
| T7b table itself (SD / loss / cost share / cells) | above | **no script** (numbers only in `paper/CONFIRMED_TABLES.md`) | ⚠️ trivial recompute |
| Reliability ≈30% (ICC table) | frozen 5×42 batches | **no script** (`docs/FREEZE_LEDGER.md` Reliability section) | ⚠️ |
| Shared evidence endorsement .82 vs .46, p=.048 | `W/data/synthetic/team_sim/` designed 2×2 R1 batches (60 teams × 2 rounds), pool `faultline_design_pool60_20260817` | per-dyad endorsement script **not saved** | ❌ |
| Faultline null (coalitions at chance, no us-vs-them) | `W/data/synthetic/team_sim/faultline2x2_r2B_rep1/rep2_20260816`, `faultline_sharedcard_r2B_rep1_20260817`, `faultline_triad_r2B_rep1_20260817`; conflict coding `runs_v4flash_0731/probes/transcript_conflict_coding/` | `M/scripts/analysis/probe_transcript_conflict_coding.js`; salvaged `M/scripts/analysis/scratch_salvage_20260816/faultline_{2x2_analyze,2x2_harrison,triad}.js` | ✅ (salvaged from /tmp today) |
| Cascade 0.18 follow / frozen-B 49% | cascade probe batch (`team_r2_cascade_probe_v1`, 11 teams, W) + frozen B | module `W/…/teamR2CascadeProbeSim.js`; **analysis script not saved** | ⚠️ |
| Personality in speech r≈.1 (.48) | same re-run (speech columns) | same script | ✅ |

## Study 3 · Eisenhardt (M + W)

| Report item | Data | Code | Status |
|---|---|---|---|
| Performance OLS (1)–(6), info→length (1)–(8), cross-design −0.22 | frozen B rep1-5 (201 rows); designed 231 = `faultline2x2_r2B_rep1_20260816` (158) + `rep2` (87) + `faultline_sharedcard_r2B_rep1_20260817` (34) + `faultline_triad_r2B_rep1_20260817` (39) + `fn_diversity_r2B_rep1_20260817` (23), all under `W/data/synthetic/team_sim/`; benchmark simple/layered 5×42 (M) | `M/paper/tab9_eisenhardt.py` → `paper/data/tab9_eisenhardt.csv`, `tab10_info_length.csv`; `tab_econ_format.py` → `*_econ.md`; earlier `docs/analysis/eisenhardt_ols_20260817.md` | ✅ |
| benchmark composition controls | benchmark pool fields dumped to `/tmp/bench_pool_fields.json` — copied today to `M/paper/data/bench_pool_fields.json`; **script still reads `/tmp`** | — | ⚠️ change path |

## Packaging hazards found
1. `M/paper/` (all figure/table scripts + data) is **untracked**; `M/exports/` (human data) is git-ignored; `W` pools for attrlist/card_only/v3 are untracked.
2. `LK/study3-app`: final repr runs, runner diff, repr persona generator all uncommitted.
3. Five results rest on scripts that were never saved (T7a back-test, endorsement p=.048, ICC, cascade, T7b table). All are cheap to rebuild from the data above; the back-test needs ~82 LLM calls.
