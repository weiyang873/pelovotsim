# Reliability — ICC(1)=one-way random-effects; 'naive_*' columns reproduce the FREEZE_LEDGER 2026-08-16 computation (mean per-unit pstdev; var(unit means)/total var, which includes sigma_w^2/5 sampling noise).
# same unit (persona / composition) across 5 rounds: within-unit vs total SD, one-way ICC(1) variance share, agreement rates.
import csv,collections
from common_runs import *
LINES=[("Solo v2Q (same persona x5)",SOLO_V2Q),("Team R2 B (same composition x5)",TEAM_B),("Team R2 A",TEAM_A),("Benchmark team simple",BENCH_TEAM_S),("Benchmark individual simple",BENCH_INDIV_S)]
def icc(groups):  # one-way random effects ICC(1)
    ks=[len(g) for g in groups if len(g)>1]; groups=[g for g in groups if len(g)>1]
    N=sum(ks); k=len(groups); gm=st.mean(x for g in groups for x in g)
    msb=sum(len(g)*(st.mean(g)-gm)**2 for g in groups)/(k-1); msw=sum((x-st.mean(g))**2 for g in groups for x in g)/(N-k)
    k0=(N-sum(n*n for n in ks)/N)/(k-1); return (msb-msw)/(msb+(k0-1)*msw), msw**0.5
def agree(groups):  # mean pairwise agreement within unit
    v=[]
    for g in groups:
        if len(g)<2: continue
        pairs=[(a,b) for i,a in enumerate(g) for b in g[i+1:]]; v.append(sum(a==b for a,b in pairs)/len(pairs))
    return st.mean(v)
out=[]
for name,pats in LINES:
    R=rows(pats); by=collections.defaultdict(list)
    for r in R: by[r["unit"]].append(r)
    G=list(by.values()); pg=[[r["price"] for r in g] for g in G]; cg=[[r["cards"] for r in g] for g in G]
    ip,wp=icc(pg); ic,wc=icc(cg)
    allp=[r['price'] for r in R]; naive_within=st.mean(sd(g) for g in pg if len(g)>1); naive_share=st.variance([st.mean(g) for g in pg])/st.pvariance(allp)
    modal=st.mean(max(collections.Counter(r['strategy'] for r in g).values())/len(g) for g in G)
    out.append(dict(line=name,units=len(G),runs=len(R),price_within_sd=round(wp),price_total_sd=round(sd([r["price"] for r in R])),price_icc=round(ip,2),naive_within_sd_mean=round(naive_within),naive_share_varmeans=round(naive_share,2),strategy_modal_share=round(modal,2),
                    cards_within_sd=round(wc,1),cards_total_sd=round(sd([r["cards"] for r in R]),1),cards_icc=round(ic,2),
                    strategy_agreement=round(agree([[r["strategy"] for r in g] for g in G]),2),grid_agreement=round(agree([[r["grid"] for r in g] for g in G]),2),loss_agreement=round(agree([[r["loss"] for r in g] for g in G]),2)))
with open(f"{ROOT}/paper/data/tab_reliability_icc.csv","w",newline="") as f:
    w=csv.DictWriter(f,fieldnames=list(out[0].keys())); w.writeheader(); w.writerows(out)
for o in out: print(o)
