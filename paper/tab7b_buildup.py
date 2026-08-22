# T7b — build-up from benchmark to full design (individual line), + fact-card-only / traits-only variants.
# Dispersion = price SD: "pooled" = SD over all runs of the line; "per-round" = mean of per-batch SDs (single-round batches: one value).
import csv,collections
from common_runs import *
STEPS=[
 ("0. Benchmark (attribute list, fixed script)",BENCH_INDIV_S),
 ("1. Biography, fixed script",[f"{WT}/runs_v4flash_0731/team_pilot/ablation_bio_x_script_indiv_20260820/*"]),
 ("2. Attribute list, roleplay",[f"{WT}/runs_v4flash_0731/team_r2_replay/solo_r2_v2Q_attrlist_20260820/*"]),
 ("3. Biography, roleplay (full design)",SOLO_V2Q),
 ("4. Full design, teams of 5",TEAM_B),
 ("3a. Fact card only (traits removed)",[f"{WT}/runs_v4flash_0731/team_r2_replay/solo_r2_v2Q_cardonly_20260819/*"]),
 ("3b. Traits only (fact card removed)",[f"{WT}/runs_v4flash_0731/team_r2_replay/solo_r2_v2Q_traitonly_rep1_20260816/*"]),
]
out=[]
for name,pats in STEPS:
    R=rows(pats); by=collections.defaultdict(list)
    for r in R: by[r["dir"].split("/")[-2]].append(r["price"])
    prices=[r["price"] for r in R]
    out.append(dict(step=name,n_runs=len(R),n_batches=len(by),price_mean=round(st.mean(prices)),price_sd_pooled=round(sd(prices)),price_sd_per_round=round(st.mean(sd(v) for v in by.values())),
                    cv=round(sd(prices)/st.mean(prices),2),loss_rate=round(st.mean(r["loss"] for r in R),2),cost_share=round(st.mean(r["cost"] for r in R),2),
                    cards=round(st.mean(r["cards"] for r in R),1),market_cells=len(set(r["grid"] for r in R if r["grid"]))))
with open(f"{ROOT}/paper/data/tab7b_buildup.csv","w",newline="") as f:
    w=csv.DictWriter(f,fieldnames=list(out[0].keys())); w.writeheader(); w.writerows(out)
for o in out: print(o)
