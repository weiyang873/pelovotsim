# Table 1 (frozen lines, five-round intervals) + Fig 2 (outcome distributions vs human).
import csv,json,glob,os,sys,math,statistics as st,collections
import matplotlib; matplotlib.use("Agg"); import matplotlib.pyplot as plt
csv.field_size_limit(sys.maxsize)
ROOT="/Users/weiyang/Dropbox/Github_indiswyang/try/emba-ai-sim-v01"; WT="/Users/weiyang/worktrees/emba-ai-sim-v01-claude"
def load(pattern):
    rows=[]
    for d in glob.glob(pattern):
        p=os.path.join(d,"settlement.json")
        if not os.path.exists(p): continue
        s=json.load(open(p)); pr=s.get("r2_price"); pr=pr.get("price") if isinstance(pr,dict) else pr
        if not isinstance(pr,(int,float)): continue
        rows.append(dict(price=pr,cards=len(s.get("r2_cards") or []),loss=1 if s.get("profitable") is False else 0,cost=1 if (s.get("r1") or {}).get("strategy")=="COST" else 0,profit=s.get("profit"),cover=(s.get("r2") or {}).get("coverCore")))
    return rows
LINES=[
 ("Benchmark team · simple",[f"{ROOT}/runs_v4flash_0731/team_pilot/random42_free_0731_interface_team5_simple_teamlayerednomap_deepseek_20260814/SYN-*-simple-*"]+[f"{ROOT}/runs_v4flash_0731/team_pilot/benchmark_team_rep{i}_20260816/SYN-*-simple-*" for i in range(2,6)]),
 ("Benchmark team · layered",[f"{ROOT}/runs_v4flash_0731/team_pilot/benchmark_team_rep1layered_20260817/SYN-*-layered-*"]+[f"{ROOT}/runs_v4flash_0731/team_pilot/benchmark_team_rep{i}_20260816/SYN-*-layered-*" for i in range(2,6)]),
 ("Benchmark individual · simple",[f"{ROOT}/runs_v4flash_0731/team_pilot/benchmark_indiv_orch_rep{i}_20260816/SYN-*-simple-*" for i in range(1,6)]),
 ("Benchmark individual · layered",[f"{ROOT}/runs_v4flash_0731/team_pilot/benchmark_indiv_orch_rep{i}_20260816/SYN-*-layered-*" for i in range(1,6)]),
 ("Roleplay solo (v2Q)",[f"{WT}/runs_v4flash_0731/team_r2_replay/solo_r2_v2Q_rep{i}_20260816/*" for i in range(1,6)]),
 ("Roleplay team (R2 B)",[f"{WT}/runs_v4flash_0731/team_r2_replay/team_r2_story3_B_rep{i}_20260816/*" for i in range(1,6)]),
]
# human 16 teams
hum=[]
sub=list(csv.DictReader(open(f"{ROOT}/exports/bq_real_teams_2026-07-12/csv/round2_submissions.csv",encoding="utf-8-sig")))
res={r["team_id"]:r for r in csv.DictReader(open(f"{ROOT}/exports/bq_real_teams_2026-07-12/csv/round2_results.csv",encoding="utf-8-sig"))}
print("round2_submissions cols:",list(sub[0].keys())[:12]); print("round2_results cols:",list(next(iter(res.values())).keys())[:12])
byteam={}
for r in sub:
    if r["price"]: byteam[r["team_id"]]=r
for tid,r in byteam.items():
    rr=res.get(tid); 
    if not rr: continue
    hum.append(dict(price=1000+(float(r["price"])-5000)/3,price_raw=float(r["price"]),cards=int(float(r["card_count"] or 0)),loss=1 if float(rr["profit"])<0 else 0,profit=float(rr["profit"]),cost=1 if "Cost" in (r.get("best_grid") or "") else 0))
print("human teams",len(hum),"prices (mapped)",sorted(round(h["price"]) for h in hum))
def iv(vals): m=st.mean(vals); sd=st.stdev(vals) if len(vals)>1 else 0; return m,sd
tab=[]; dist={}
for name,pats in LINES:
    rounds=[load(p) for p in pats]; rounds=[r for r in rounds if len(r)>=30]
    sds=[st.pstdev([x["price"] for x in r]) for r in rounds]; means=[st.mean(x["price"] for x in r) for r in rounds]; cards=[st.mean(x["cards"] for x in r) for r in rounds]; loss=[st.mean(x["loss"] for x in r) for r in rounds]; cost=[st.mean(x["cost"] for x in r) for r in rounds]; cover=[st.mean(x["cover"] for x in r if x["cover"] is not None) for r in rounds if any(x["cover"] is not None for x in r)]
    cvs=[st.pstdev([x["price"] for x in r])/st.mean(x["price"] for x in r) for r in rounds]
    tab.append(dict(line=name,rounds=len(rounds),n_per_round=round(st.mean(len(r) for r in rounds)),sd=iv(sds),cv=iv(cvs),mean=iv(means),cards=iv(cards),loss=iv(loss),cost=iv(cost),cover=iv(cover) if cover else (float("nan"),0)))
    dist[name]=[x["price"] for r in rounds for x in r]
dist["Human (16 teams)"]=[h["price"] for h in hum]
hsd=st.pstdev(dist["Human (16 teams)"]); hcv=hsd/st.mean(dist["Human (16 teams)"]); hloss=st.mean(h["loss"] for h in hum); hcards=st.mean(h["cards"] for h in hum); hcost=st.mean(h["cost"] for h in hum)
ORDER_T5=["Benchmark individual · simple","Benchmark individual · layered","Benchmark team · simple","Benchmark team · layered","Roleplay solo (v2Q)","Roleplay team (R2 B)"]
NAME_T5={"Benchmark individual · simple":"Benchmark · individual · simple","Benchmark individual · layered":"Benchmark · individual · layered","Benchmark team · simple":"Benchmark · team · simple","Benchmark team · layered":"Benchmark · team · layered","Roleplay solo (v2Q)":"Roleplay · individual","Roleplay team (R2 B)":"Roleplay · team"}
f2=lambda m,sd,d=2: f"{m:.{d}f} ({sd:.{d}f})"
# transposed: metrics as rows, conditions as columns, human last
cols=[NAME_T5[o] for o in ORDER_T5]+["Human (16 teams, price mapped)"]
def vals(key,d):
    out=[f2(*[t for t in tab if t["line"]==o][0][key],d) for o in ORDER_T5]
    return out
import csv as _csv
with open(f"{ROOT}/paper/data/tab1_frozen_lines.csv","w",newline="") as f:
    w=_csv.writer(f); w.writerow(["metric"]+cols)
    w.writerow(["Price mean"]+vals("mean",0)+[f"{st.mean(dist['Human (16 teams)']):.0f}"])
    w.writerow(["Price CV"]+vals("cv",2)+[f"{hcv:.2f}"])
    w.writerow(["Loss rate"]+vals("loss",2)+[f"{hloss:.2f}"])
    w.writerow(["Cards chosen"]+vals("cards",1)+[f"{hcards:.1f}"])
    w.writerow(["Cost-leadership share"]+vals("cost",2)+[f"{hcost:.2f}"])
# F3: scale-free comparison (human classes ran an older price/cost scale): price CV, loss rate, cards, COST share
order=["Roleplay team (R2 B)","Roleplay solo (v2Q)","Benchmark team · layered","Benchmark team · simple","Benchmark individual · layered","Benchmark individual · simple"]
short=["Human\n(16 teams)","Roleplay\nteam","Roleplay\nindividual","Bench.\nteam L","Bench.\nteam S","Bench.\nindiv. L","Bench.\nindiv. S"]
cols=["#c8433b","#2b5d8a","#7fa7cc","#a8a8a8","#c4c4c4","#d8d8d8","#e8e8e8"]
def series(k,hval): return [hval]+[[t for t in tab if t["line"]==o][0][k][0] for o in order], [0]+[[t for t in tab if t["line"]==o][0][k][1] for o in order]
panels=[("cv","Price dispersion (CV = SD / mean)",hcv,(0,0.4)),("loss","Share of teams making a loss",hloss,(0,1.0)),("cards","Number of capability cards chosen",hcards,(8,16)),("cost","Share choosing cost leadership",hcost,(0,0.6))]
fig,axes=plt.subplots(1,4,figsize=(13.5,3.8))
for ax,(k,title,hv,(ymin,ymax)) in zip(axes,panels):
    vals,errs=series(k,hv); ax.bar(range(7),vals,yerr=errs,color=cols,capsize=2,ecolor="#555555"); ax.axhline(hv,ls="--",c="#c8433b",lw=0.9,zorder=0)
    ax.set_xticks(range(7)); ax.set_xticklabels(short,fontsize=7); ax.set_title(title,fontsize=9); ax.set_ylim(ymin,ymax)
    for i,v in enumerate(vals): ax.text(i,v+errs[i]+(ymax-ymin)*0.02,f"{v:.2f}" if ymax<=1 else f"{v:.1f}",ha="center",fontsize=7)
    ax.spines["top"].set_visible(False); ax.spines["right"].set_visible(False); ax.yaxis.grid(True,color="#eeeeee",lw=0.6); ax.set_axisbelow(True)
fig.suptitle("Round 2: do final decisions look like human teams' decisions? (simulation: mean ± SD across 5 runs of 42 units; human: 16 teams)",fontsize=10)
fig.tight_layout(); fig.savefig(f"{ROOT}/paper/figs/fig2_outcomes.png",dpi=200); fig.savefig(f"{ROOT}/paper/figs/fig2_outcomes.pdf"); print("fig saved")
