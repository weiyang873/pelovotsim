"use strict";
// Build the ISR GenAI-track submission package (copy only; never moves/edits sources).
// Layout mirrors the three source roots so paper scripts run inside the package after path rewrite:
//   <out>/evidence/main/...      = main repo paths (runs_v4flash_0731/..., exports/..., data/...)
//   <out>/evidence/worktree/...  = claude worktree paths
//   <out>/evidence/lockin/...    = ~/Dropbox/LLM lock-in paths (Study 1)
//   <out>/code/                  = git-tracked code for the frozen lines + generators + probes (no runs)
//   <out>/paper/                 = table/figure scripts with ROOT/WT/LK rewritten to the package, + data/, figs/
//   <out>/analysis/              = FREEZE_LEDGER, PERSONA_METHODS, DATA_MAP, SUBMISSION_INVENTORY, RESULT_PROVENANCE_MAP, eisenhardt OLS
//   <out>/SHA256SUMS.txt, MANIFEST.json, README.md
// Usage: node scripts/analysis/build_submission_package.js [--out=~/submission_isr_2026] [--verify=1]
const fs = require("node:fs"); const path = require("node:path"); const crypto = require("node:crypto"); const { execSync } = require("node:child_process");
const args = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, "").split("=")));
const HOME = process.env.HOME;
const MAIN = path.join(__dirname, "..", ".."), WT = `${HOME}/worktrees/emba-ai-sim-v01-claude`, LK = `${HOME}/Dropbox/LLM lock-in`;
const OUT = path.resolve((args.out || `${HOME}/submission_isr_2026`).replace(/^~/, HOME));
const ROOTS = { main: MAIN, worktree: WT, lockin: LK };

// ---- what goes in (role labels feed MANIFEST) ----
const EV = []; const add = (root, rel, role, note = "") => EV.push({ root, rel, role, note });
const teamPilot = (n) => `runs_v4flash_0731/team_pilot/${n}`, r2 = (n) => `runs_v4flash_0731/team_r2_replay/${n}`, ts = (n) => `data/synthetic/team_sim/${n}`;
for (let i = 1; i <= 5; i++) { add("worktree", teamPilot(`teamr1_cap24_rep${i}_20260815`), "frozen", "Team R1"); add("worktree", r2(`team_r2_story3_B_rep${i}_20260816`), "frozen", "Team R2 B"); add("worktree", r2(`team_r2_story3_A_rep${i}_20260816`), "control", "Team R2 A (no converge)"); add("worktree", teamPilot(`solo_r1_hidden_rep${i}_20260815`), "frozen", "Solo R1"); add("worktree", r2(`solo_r2_v2Q_rep${i}_20260816`), "frozen", "Solo R2 v2Q"); add("worktree", r2(`solo_r2_v2P_rep${i}_20260816`), "control", "Solo R2 v2P"); }
for (const n of ["teamr1_cap24_rep1_retry_20260815", "teamr1_cap24_rep3_retry_20260815", "solo_r1_hidden_rep1_retry_20260815", "solo_r1_hidden_rep2_retry_20260815", "solo_r1_hidden_rep3_retry_20260815", "solo_r1_hidden_rep4_retry_20260815", "solo_r1_hidden_rep5_retry_20260815"]) add("worktree", teamPilot(n), "frozen-retry");
add("main", teamPilot("random42_free_0731_interface_team5_simple_teamlayerednomap_deepseek_20260814"), "frozen", "Benchmark team simple r1 (+layered_nomap, not used)"); add("main", teamPilot("benchmark_team_rep1layered_20260817"), "frozen", "Benchmark team layered r1");
for (let i = 2; i <= 5; i++) add("main", teamPilot(`benchmark_team_rep${i}_20260816`), "frozen", "Benchmark team simple+layered");
for (let i = 1; i <= 5; i++) add("main", teamPilot(`benchmark_indiv_orch_rep${i}_20260816`), "frozen", "Benchmark individual simple+layered");
for (const n of ["ablation_bio_x_script_indiv_20260820", "solo_r1_attrlist_20260820", "solo_r1_cardonly_20260819", "solo_r1_fullrep6_20260819", "teamr1_v3_pool42_20260819", "solo_r1_traitonly_rep1_20260816", "faultline_design_r1_20260817", "faultline_design_r1_rep2_20260817", "faultline_design_r1_nonote_20260817", "faultline_design_r1_nonote_rep2_20260817", "faultline2x2_r1_20260817", "faultline_triad_r1_20260817", "faultline_sharedcard_r1_20260817", "fn_diversity_r1_20260817"]) add("worktree", teamPilot(n), "probe", "cited (ablation / faultline R1)");
for (const n of ["solo_r2_v2Q_attrlist_20260820", "solo_r2_v2Q_cardonly_20260819", "solo_r2_v2Q_fullrep6_20260819", "solo_r2_v2Q_traitonly_rep1_20260816"]) add("worktree", r2(n), "probe", "cited (ablation R2)");
for (const n of ["faultline2x2_r2B_rep1_20260816", "faultline2x2_r2B_rep2_20260816", "faultline_triad_r2B_rep1_20260817", "faultline_sharedcard_r2B_rep1_20260817", "fn_diversity_r2B_rep1_20260817", "team_r2_cascade_smoke_rep1_20260817", "team_r2_actorengine_smoke_rep1_20260817", "team_r2_voiceprobe_smoke_rep1_20260817"]) add("worktree", ts(n), "probe", "cited (Study 3 designed teams / mechanism probes)");
add("worktree", "runs_v4flash_0731/probes/transcript_conflict_coding", "probe-output"); add("main", "runs_v4flash_0731/probes/transcript_conflict_coding", "probe-output"); add("main", "runs_v4flash_0731/probes/trait_only_bio_ceibs_20260816", "probe-output"); add("main", "runs_v4flash_0731/probes/personality_backtest_20260822", "probe-output");
add("main", "exports/bq_real_teams_2026-07-12", "human", "EMBA class export (16 teams with complete records)");
for (const n of ["r1_pool42_20260812", "r1_pool42_v3_20260819", "trait_only_pool42_20260816", "attrlist_pool42_20260820", "card_only_pool42_20260819", "v2_faultline_pool541_20260816", "faultline_design_pool60_20260817", "faultline_shared_card_probe_20260817"]) for (const root of ["main", "worktree"]) if (fs.existsSync(path.join(ROOTS[root], "data/task_blind_persona_pipeline_v1", n))) add(root, `data/task_blind_persona_pipeline_v1/${n}`, "persona-pool");
// Study 1
add("lockin", "Data/study3_main/raw/main_full_export_FINAL_20260726.csv", "human", "Prolific main FINAL (485 after filter)");
add("lockin", "study3-app/modeH/out/sessions_explore_ds_dashscope", "frozen", "Study 1 grid device (74)"); add("lockin", "study3-app/modeH/out/sessions_explore_layered_dsq", "control", "Study 1 layered questionnaire (74)");
for (const n of ["sessions_fullchat_final_reprPlain", "sessions_fullchat_final_reprWarmSat", "sessions_fullchat_final_reprWarm", "sessions_fullchat_dsq", "sessions_fullchat_dsq_sat", "ledger_fullchat_dsq.jsonl", "ledger_fullchat_dsq_sat.jsonl", "ledger_fullchat_final_reprPlain.jsonl", "ledger_fullchat_final_reprWarmSat.jsonl", "ledger_fullchat_final_reprWarm.jsonl"]) add("lockin", `study3-app/modeHs/out_fullchat/${n}`, n.includes("final_repr") ? "frozen" : "control", "Study 1 full chat");
for (const n of ["runner_fullchat.mjs", "gen_repr_personas.mjs", "profiles_repr.json", "analyze_mdmt6.py"]) add("lockin", `study3-app/modeHs/${n}`, "code");
// code (this repo)
const CODE = ["server/synthetic/teamSim", "server/llm", "game_config_v0.1", "scripts/analysis/team_sim_presets.js", "scripts/analysis/run_frozen_r2_replay.js", "scripts/analysis/run_teamr1_cap24.js", "scripts/analysis/run_solo_roleplay.js", "scripts/analysis/run_benchmark_team_simple_layered.js", "scripts/analysis/generate_task_blind_persona_pool.js", "scripts/analysis/generate_task_blind_persona_pool_v2.js", "scripts/analysis/generate_task_blind_persona_pool_v2_design.js", "scripts/analysis/generate_task_blind_persona_pool_v3.js", "scripts/analysis/build_trait_only_pool.js", "scripts/analysis/probe_trait_only_biography.js", "scripts/analysis/build_faultline_shared_card_probe.js", "scripts/analysis/probe_transcript_conflict_coding.js", "scripts/analysis/probe_personality_backtest.js", "scripts/analysis/export_conversation_txt.js", "scripts/analysis/scratch_salvage_20260816", "scripts/analysis/build_submission_package.js", "package.json"];
const DOCS = ["docs/FREEZE_LEDGER.md", "docs/PERSONA_METHODS.md", "docs/DATA_MAP.md", "docs/SUBMISSION_INVENTORY.md", "docs/RESULT_PROVENANCE_MAP.md", "docs/analysis/eisenhardt_ols_20260817.md", "docs/CODEX_INFO_SET_ALIGNMENT.md"];

// ---- copy ----
const manifest = []; let nFiles = 0, nBytes = 0;
function cp(src, dst, entry) { if (!fs.existsSync(src)) { console.error("MISSING", src); manifest.push({ ...entry, missing: true }); return; } fs.mkdirSync(path.dirname(dst), { recursive: true }); fs.cpSync(src, dst, { recursive: true }); let files = 0, bytes = 0; (function walk(p) { const st = fs.statSync(p); if (st.isDirectory()) fs.readdirSync(p).forEach((c) => walk(path.join(p, c))); else { files++; bytes += st.size; } })(dst); nFiles += files; nBytes += bytes; manifest.push({ ...entry, files, mb: +(bytes / 1048576).toFixed(1) }); }
if (fs.existsSync(OUT)) { console.error(`refusing to overwrite existing ${OUT}; delete it first`); process.exit(1); }
for (const e of EV) cp(path.join(ROOTS[e.root], e.rel), path.join(OUT, "evidence", e.root, e.rel), { dest: `evidence/${e.root}/${e.rel}`, ...e });
for (const rel of CODE) cp(path.join(MAIN, rel), path.join(OUT, "code", rel), { dest: `code/${rel}`, root: "main", rel, role: "code" });
// probe module copies + runners live only in the worktree
const wtMods = fs.readdirSync(path.join(WT, "server/synthetic/teamSim")).filter((f) => /Faultline|Probe|SpeechQuote|VoiceProbe|Cascade/.test(f)); for (const f of wtMods) cp(path.join(WT, "server/synthetic/teamSim", f), path.join(OUT, "code/probes/server/synthetic/teamSim", f), { dest: `code/probes/server/synthetic/teamSim/${f}`, root: "worktree", rel: `server/synthetic/teamSim/${f}`, role: "code-probe" });
const wtRunners = fs.readdirSync(path.join(WT, "scripts/analysis")).filter((f) => /^run_teamr1_(faultline|voiceprobe|speechquote|sqnotes)/.test(f)); for (const f of wtRunners) cp(path.join(WT, "scripts/analysis", f), path.join(OUT, "code/probes/scripts/analysis", f), { dest: `code/probes/scripts/analysis/${f}`, root: "worktree", rel: `scripts/analysis/${f}`, role: "code-probe" });
cp(path.join(WT, "scripts/analysis/team_sim_presets.js"), path.join(OUT, "code/probes/scripts/analysis/team_sim_presets.js"), { dest: "code/probes/scripts/analysis/team_sim_presets.js", root: "worktree", rel: "scripts/analysis/team_sim_presets.js", role: "code-probe", note: "worktree presets incl. probe presets" });
for (const rel of DOCS) cp(path.join(MAIN, rel), path.join(OUT, "analysis", path.basename(rel)), { dest: `analysis/${path.basename(rel)}`, root: "main", rel, role: "doc" });
// paper: rewrite roots so scripts run inside the package
fs.mkdirSync(path.join(OUT, "paper"), { recursive: true });
for (const f of fs.readdirSync(path.join(MAIN, "paper"))) { const src = path.join(MAIN, "paper", f), dst = path.join(OUT, "paper", f); if (fs.statSync(src).isDirectory()) { fs.cpSync(src, dst, { recursive: true }); continue; } let t = fs.readFileSync(src, "utf8"); if (f.endsWith(".py")) t = t.replace(/"\/Users\/weiyang\/Dropbox\/Github_indiswyang\/try\/emba-ai-sim-v01"/g, JSON.stringify(`${OUT}/evidence/main`)).replace(/"\/Users\/weiyang\/worktrees\/emba-ai-sim-v01-claude"/g, JSON.stringify(`${OUT}/evidence/worktree`)).replace(/"\/Users\/weiyang\/Dropbox\/LLM lock-in"/g, JSON.stringify(`${OUT}/evidence/lockin`)).replace(/f"\{ROOT\}\/paper\//g, `f"${OUT}/paper/`); fs.writeFileSync(dst, t); }
fs.renameSync(path.join(OUT, "paper/data"), path.join(OUT, "paper/data_original")); fs.mkdirSync(path.join(OUT, "paper/data"));
// git provenance
const rev = (d) => { try { return execSync("git rev-parse HEAD", { cwd: d }).toString().trim(); } catch { return null; } };
const prov = { built_at: new Date().toISOString(), main_commit: rev(MAIN), worktree_commit: rev(WT), lockin_commit: rev(path.join(LK, "study3-app")), files: nFiles, mb: +(nBytes / 1048576).toFixed(1) };
fs.writeFileSync(path.join(OUT, "MANIFEST.json"), JSON.stringify({ provenance: prov, entries: manifest }, null, 1));
// sha256
const sums = []; (function walk(p) { for (const c of fs.readdirSync(p).sort()) { const q = path.join(p, c); if (fs.statSync(q).isDirectory()) walk(q); else if (c !== "SHA256SUMS.txt") sums.push(`${crypto.createHash("sha256").update(fs.readFileSync(q)).digest("hex")}  ${path.relative(OUT, q)}`); } })(OUT);
fs.writeFileSync(path.join(OUT, "SHA256SUMS.txt"), sums.join("\n") + "\n");
fs.writeFileSync(path.join(OUT, "README.md"), `# Submission package (built ${prov.built_at})

Sources: main repo @ ${prov.main_commit}, claude worktree @ ${prov.worktree_commit}, LLM lock-in study3-app @ ${prov.lockin_commit}. ${nFiles} files, ${prov.mb} MB. Integrity: \`shasum -a 256 -c SHA256SUMS.txt\`.

- evidence/{main,worktree,lockin}/… — run directories, persona pools, human data, in their original relative paths (roles in MANIFEST.json: frozen / control / probe / human / persona-pool / probe-output).
- code/ — frozen-line modules, presets, runners, persona generators, probes (code/probes = worktree module copies). Not runnable without a DeepSeek key; re-running does not reproduce LLM outputs (see run_meta.seed_reproducibility_note).
- paper/ — every table/figure script with source roots rewritten to this package; \`cd paper && python3 <script>.py\` regenerates paper/data/*.csv; paper/data_original = the committed outputs for comparison.
- paper/data_original/tab10_info_length.csv is an output of an earlier tab9 version; the reported form is tab10_info_length_econ.md (tab_econ_format.py).
- analysis/ — FREEZE_LEDGER, PERSONA_METHODS, DATA_MAP, SUBMISSION_INVENTORY, RESULT_PROVENANCE_MAP (result → script → data map), Eisenhardt OLS note.
`);
console.log(JSON.stringify(prov)); console.log("missing:", manifest.filter((m) => m.missing).map((m) => m.dest));
if (args.verify === "1") {
  const run = ["tab7b_buildup.py", "tab_reliability_icc.py", "tab_cascade.py", "tab_endorsement_dyads.py", "study1_final_config.py", "fig3_r1_within_group.py", "fig2_tab1_outcomes.py", "tab9_eisenhardt.py", "study1_lockin_devices.py"];
  for (const s of run) { try { execSync(`python3 ${s} > /dev/null 2>&1`, { cwd: path.join(OUT, "paper") }); console.log("ran", s); } catch (e) { console.log("FAILED", s); } }
  try { console.log(execSync(`diff -rq data_original data | grep -v "_econ.md\\|bench_pool_fields\\|original41" || true`, { cwd: path.join(OUT, "paper") }).toString() || "all regenerated csv identical"); } catch (e) { console.log(String(e.stdout)); }
}
