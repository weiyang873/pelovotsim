# Fig 3: Round-1 within-team variance — human (16 complete-chain teams) vs task-blind team R1 vs benchmark team.
import csv,json,glob,os,sys,math,statistics as st,collections
import matplotlib; matplotlib.use("Agg"); import matplotlib.pyplot as plt
csv.field_size_limit(sys.maxsize)
ROOT="/Users/weiyang/Dropbox/Github_indiswyang/try/emba-ai-sim-v01"; WT="/Users/weiyang/worktrees/emba-ai-sim-v01-claude"
def ent(v): c=collections.Counter(v); n=len(v); return -sum(x/n*math.log(x/n,2) for x in c.values())
def metrics(grids,archs,final):
    ch=[g.split("_")[0] for g in grids]; stg=[g.split("_")[1] for g in grids]; ag=[g.split("_")[2] for g in grids]
    maj=collections.Counter(grids).most_common(1)[0]; agree=lambda v: collections.Counter(v).most_common(1)[0][1]/len(v)
    return dict(distinct=len(set(grids)),distinct_norm=len(set(grids))/len(grids),H=ent(grids),unan=1 if len(set(grids))==1 else 0,channel=agree(ch),strategy=agree(stg),age=agree(ag),arch=agree(archs) if archs else None,final_maj=1 if final==maj[0] else 0,cost=sum(1 for g in grids if "COST" in g)/len(grids),n=len(grids))
rows=collections.defaultdict(list)
# human
sub=list(csv.DictReader(open(f"{ROOT}/exports/bq_real_teams_2026-07-12/csv/member_submissions.csv",encoding="utf-8-sig")))
draft={r["team_id"]:r for r in csv.DictReader(open(f"{ROOT}/exports/bq_real_teams_2026-07-12/csv/round1_team_drafts.csv",encoding="utf-8-sig"))}
norm=lambda g: g.replace("CostLeadership","COST").replace("Differentiation","DIFF")
by=collections.defaultdict(list)
for r in sub:
    if r["grid_id"]: by[r["team_id"]].append(r)
for tid,rs in by.items():
    grids=[norm(r["grid_id"]) for r in rs]
    if len(grids)<3: continue
    rows["Human"].append(metrics(grids,[r["architecture"] for r in rs if r["architecture"]],norm(draft.get(tid,{}).get("grid_id",""))))
def sim(pattern,label):
    for d in glob.glob(pattern):
        p=os.path.join(d,"r1_transcript.json")
        if not os.path.exists(p): continue
        props=[x.get("parsed") or {} for x in json.load(open(p)).get("proposals",[])]
        grids=[x.get("grid_id") for x in props if x.get("grid_id")]
        if len(grids)<4: continue
        fr=json.load(open(os.path.join(d,"r1_frozen.json"))) if os.path.exists(os.path.join(d,"r1_frozen.json")) else {}
        rows[label].append(metrics(grids,[x.get("architecture") for x in props if x.get("architecture")],fr.get("grid_id")))
sim(f"{WT}/runs_v4flash_0731/team_pilot/teamr1_cap24_rep*_20260815/*","Roleplay team")
sim(f"{ROOT}/runs_v4flash_0731/team_pilot/benchmark_team_rep[2-5]_20260816/SYN-*-layered-*","Benchmark layered")
sim(f"{ROOT}/runs_v4flash_0731/team_pilot/benchmark_team_rep[2-5]_20260816/SYN-*-simple-*","Benchmark simple")
labels=list(rows.keys())
M=lambda L,k: st.mean(r[k] for r in rows[L] if r[k] is not None)
SE=lambda L,k: (st.pstdev([r[k] for r in rows[L] if r[k] is not None])/math.sqrt(len([r for r in rows[L] if r[k] is not None])))
metrics_plot=[("distinct_norm","Distinct proposals per member"),("strategy","Share agreeing on strategy (cost vs diff.)"),("final_maj","Team decision = individual majority"),("cost","Share choosing cost leadership")]
metrics_all=metrics_plot+[("age","age-segment agreement"),("arch","architecture agreement")]
with open(f"{ROOT}/paper/data/fig3_r1_within_group.csv","w",newline="") as f:
    w=csv.writer(f); w.writerow(["line","n_teams","members_per_team"]+[m for m,_ in metrics_all]+["distinct","H_bits","unanimous"])
    for L in labels: w.writerow([L,len(rows[L]),round(M(L,"n"),2)]+[round(M(L,k),3) for k,_ in metrics_all]+[round(M(L,"distinct"),2),round(M(L,"H"),2),round(M(L,"unan"),2)])
fig,axes=plt.subplots(1,4,figsize=(13.5,3.6)); colors=["#c8433b","#2b5d8a","#b8b8b8","#dcdcdc"]
for ax,(k,title) in zip(axes.flat,metrics_plot):
    vals=[M(L,k) for L in labels]; errs=[SE(L,k) for L in labels]
    ax.bar(range(len(labels)),vals,yerr=errs,color=colors[:len(labels)],capsize=3); ax.axhline(vals[0],ls="--",c="#c8433b",lw=0.9,zorder=0); ax.set_xticks(range(len(labels))); ax.set_xticklabels(["Human\n(16 teams)","Roleplay\nteam","Bench.\nlayered","Bench.\nsimple"],fontsize=8); ax.set_title(title,fontsize=9); ax.set_ylim(0,1.05 if k!="distinct_norm" else 1.0)
    for i,v in enumerate(vals): ax.text(i,v+0.02,f"{v:.2f}",ha="center",fontsize=7)
    ax.spines["top"].set_visible(False); ax.spines["right"].set_visible(False); ax.yaxis.grid(True,color="#eeeeee",lw=0.6); ax.set_axisbelow(True)
fig.suptitle("Round 1: how dispersed are individual proposals within a team? (mean ± SE across teams)",fontsize=10); fig.tight_layout()
fig.savefig(f"{ROOT}/paper/figs/fig3_r1_within_group.png",dpi=200); fig.savefig(f"{ROOT}/paper/figs/fig3_r1_within_group.pdf")
print(open(f"{ROOT}/paper/data/fig3_r1_within_group.csv").read())
