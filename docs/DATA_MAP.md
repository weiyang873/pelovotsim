# DATA_MAP — 运行产物在哪台"机器"（2026-08-20）

两个工作区，同一个仓库的两个分支：
- **主仓** `/Users/weiyang/Dropbox/Github_indiswyang/try/emba-ai-sim-v01`（分支 lovot-v4flash-nothink-baseline）— Codex 用
- **worktree** `/Users/weiyang/worktrees/emba-ai-sim-v01-claude`（分支 fingerprint-behavior-fix）— Claude 用；**所有 roleplay/faultline/探针的 runs 都在这里，且大多未 commit**（体积原因）。找不到数据先来这儿。

## 主仓里的（benchmark 线 + 早期）
- `runs_v4flash_0731/team_pilot/benchmark_team_rep2-5_20260816`、`benchmark_team_rep1layered_20260817`、`random42_free_0731_interface_team5_simple_teamlayerednomap_deepseek_20260814` — benchmark team 5×42
- `runs_v4flash_0731/team_pilot/benchmark_indiv_orch_rep1-5_20260816` — benchmark individual（orchestrator team-size 1）5×42
- `runs_v4flash_0731/probes/` — trait-only 小传探针、rep1 冲突编码
- 各池：`data/task_blind_persona_pipeline_v1/*`（冻结 42 人池、v2 各批、541 合并池、设计池、组队名单）——已 commit，两边同内容

## worktree 里的（冻结 roleplay 四线 + 全部探针）
R1（`runs_v4flash_0731/team_pilot/`）：
- 冻结 team R1：`teamr1_cap24_rep1-5_20260815`（+ `_retry`）
- 冻结 solo R1：`solo_r1_hidden_rep1-5_20260815`（+ `_retry`）
- faultline：`faultline2x2_r1_20260817`（+retry）、`faultline_design_r1{,_rep2,_nonote,_nonote_rep2}_20260817`、`faultline_triad_r1_20260817`、`faultline_sharedcard_r1_20260817`、`fn_diversity_r1_20260817`、`faultline_harrison_r1_20260817`（已中止，空）
- 语言探针：`teamr1_voiceprobe_20260817`、`teamr1_speechquote{,_v2,_v3}_20260817`、`mini_v3_team01{,_tags}_20260817`

R2（`runs_v4flash_0731/team_r2_replay/` 放 summary；**逐队产物在 `data/synthetic/team_sim/<batch>/`**，run_frozen_r2_replay.js 跑的批次两处都要看）：
- 冻结 team R2：`team_r2_story3_B_rep1-5_20260816`、A 对照 `team_r2_story3_A_rep1-5_20260816`
- 冻结 solo R2：`solo_r2_v2Q_rep1-5_20260816`、`solo_r2_v2P_rep1-5_20260816`
- faultline R2：`faultline2x2_r2B_rep1/rep2_20260816`、`faultline_triad_r2B_rep1_20260817`、`faultline_sharedcard_r2B_rep1_20260817`、`fn_diversity_r2B_rep1_20260817`（这些在 `data/synthetic/team_sim/`）
- 机制探针：`team_r2_voiceprobe_smoke_rep1_20260817`、`team_r2_cascade_smoke_rep1_20260817`、`team_r2_actorengine_smoke_rep1_20260817`
- 8/15 的 probe12 系列（doctrine/narrator/screenplay3d5/…）

编码/分析产物：worktree `runs_v4flash_0731/probes/transcript_conflict_coding/*.jsonl`；回归表 `docs/analysis/eisenhardt_ols_20260817.md`（两边都有）。

## 约定
- 跑冻结线用 `scripts/analysis/run_frozen_r2_replay.js --preset <name>`；presets 在 `scripts/analysis/team_sim_presets.js`（worktree 版多几个 experiment preset，已 commit 在 fingerprint-behavior-fix 分支）。
- runs 不进 git；要引用数字一律走 `docs/FREEZE_LEDGER.md` 的区间和路径。
- 需要把某批搬到主仓时用 cp，不要 mv（两边脚本都按各自根目录解析相对路径）。
