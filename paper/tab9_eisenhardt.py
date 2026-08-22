# T9 + F4 (Study 3): Eisenhardt (1989) — real-time information use, review length, and performance.
# Row = one team-round. Info use = numbers + cost-vocabulary per member line in the R2 card-review discussion;
# review length = member lines in that discussion. DVs: profit (z within sample), loss (0/1).
# Samples: frozen roleplay team B (5x42, clustered by composition), designed teams (single round, 2x2+triads+shared-card+fn-div),
#          benchmark team simple / layered (5x42, clustered by composition).
import json,glob,os,re,math,statistics as st,collections
import matplotlib; matplotlib.use("Agg"); import matplotlib.pyplot as plt
ROOT="/Users/weiyang/Dropbox/Github_indiswyang/try/emba-ai-sim-v01"; WT="/Users/weiyang/worktrees/emba-ai-sim-v01-claude"
NUM=re.compile(r"\d+")
COST=re.compile(r"成本|价格|定价|毛利|利润|亏|COGS|预算|费用|花|钱|元|万")
def d4_lines(d,members):
    p=os.path.join(d,"r2_transcript.json")
    if not os.path.exists(p): return None
    out=[]
    for dp in json.load(open(p)).get("transcript",[]):
        if not str(dp.get("decision_point","")).startswith("cards_"): continue
        for it in dp.get("transcript",[]):
            if it.get("speaker") in members: out.append(str(it.get("text","")))
    return out
POOLCACHE={}
def pool_lookup(pool_path):
    if pool_path not in POOLCACHE:
        recs={}
        for base in (WT,ROOT):
            p=os.path.join(base,pool_path)
            if os.path.exists(p):
                for r in json.load(open(p)):
                    ff=r.get("frozen_facts")
                    if ff:
                        c=str(ff.get("career_context",""))
                        ind=(re.search(r"所在行业为([^，,。；;]+)",c) or [None,None])[1]
                        fn=(re.search(r"主要职能是([^，,。；;]+)",c) or [None,None])[1]
                        fin=1 if re.search(r"财务|金融|投资|会计",c) else 0
                    else:  # benchmark interface pool: fields resolved via the module dump
                        import json as _j
                        BF=_j.load(open(f"{ROOT}/paper/data/bench_pool_fields.json"))
                        v=BF.get(r.get("persona_id"))
                        ind,fn,fin=(v if v else (None,None,0))
                    recs[r.get("persona_id")]=(ind,fn,fin)
                break
        POOLCACHE[pool_path]=recs
    return POOLCACHE[pool_path]
def blau(vals):
    vals=[v for v in vals if v]; 
    if not vals: return None
    c=collections.Counter(vals); n=len(vals); return 1-sum((k/n)**2 for k in c.values())
def row(d):
    try:
        s=json.load(open(os.path.join(d,"settlement.json"))); m=json.load(open(os.path.join(d,"run_meta.json")))
    except Exception: return None
    pr=s.get("r2_price"); pr=pr.get("price") if isinstance(pr,dict) else pr
    if not isinstance(pr,(int,float)): return None
    ids=m.get("profile_ids") or []
    L=d4_lines(d,set(ids))
    if not L: return None
    rec=pool_lookup(m.get("profile_pool_source") or "")
    trip=[rec.get(i) for i in ids if rec.get(i)]
    rev=(s.get("r2") or {}).get("revenueNet")
    return dict(comp="|".join(sorted(ids)),n_lines=len(L),
        info=st.mean(len(NUM.findall(t))+len(COST.findall(t)) for t in L),
        nums=st.mean(len(NUM.findall(t)) for t in L),
        ind_blau=blau([x[0] for x in trip]) if trip else None,
        fn_blau=blau([x[1] for x in trip]) if trip else None,
        fin=sum(x[2] for x in trip) if trip else None,
        profit=float(s.get("profit") or 0),loss=1 if s.get("profitable") is False else 0,
        logrev=math.log(max(1.0,float(rev))) if rev is not None else None)
def collect(pats):
    rows=[]
    for pat in pats:
        for d in glob.glob(pat):
            r=row(d)
            if r: rows.append(r)
    return rows
def z(v): m=st.mean(v); sd=st.pstdev(v); return [(x-m)/sd if sd else 0 for x in v]
def ols_cluster(y,X,cl):
    # y list, X list of lists (with 1s constant prepended inside), cluster labels
    import itertools
    n=len(y); k=len(X[0])
    # X'X and X'y
    XtX=[[sum(X[i][a]*X[i][b] for i in range(n)) for b in range(k)] for a in range(k)]
    Xty=[sum(X[i][a]*y[i] for i in range(n)) for a in range(k)]
    # invert
    import copy
    A=copy.deepcopy(XtX); I=[[1.0 if a==b else 0.0 for b in range(k)] for a in range(k)]
    for c in range(k):
        piv=A[c][c]
        for j in range(k): A[c][j]/=piv; I[c][j]/=piv
        for r2 in range(k):
            if r2==c: continue
            f=A[r2][c]
            for j in range(k): A[r2][j]-=f*A[c][j]; I[r2][j]-=f*I[c][j]
    beta=[sum(I[a][b]*Xty[b] for b in range(k)) for a in range(k)]
    resid=[y[i]-sum(X[i][a]*beta[a] for a in range(k)) for i in range(n)]
    groups=collections.defaultdict(list)
    for i,c in enumerate(cl): groups[c].append(i)
    meat=[[0.0]*k for _ in range(k)]
    for idx in groups.values():
        g=[sum(X[i][a]*resid[i] for i in idx) for a in range(k)]
        for a in range(k):
            for b in range(k): meat[a][b]+=g[a]*g[b]
    V=[[sum(I[a][p]*meat[p][q]*I[q][b] for p in range(k) for q in range(k)) for b in range(k)] for a in range(k)]
    G=len(groups); dfc=G/(G-1)*(n-1)/(n-k)
    se=[math.sqrt(V[a][a]*dfc) for a in range(k)]
    return beta,se,n,G
SAMPLES=[
 ("Roleplay team (frozen, 5 rounds)",[f"{WT}/runs_v4flash_0731/team_r2_replay/team_r2_story3_B_rep{i}_20260816/*" for i in range(1,6)]),
 ("Designed teams (single round)",[f"{WT}/data/synthetic/team_sim/faultline2x2_r2B_rep1_20260816/*",f"{WT}/data/synthetic/team_sim/faultline2x2_r2B_rep2_20260816/*",f"{WT}/data/synthetic/team_sim/faultline_sharedcard_r2B_rep1_20260817/*",f"{WT}/data/synthetic/team_sim/faultline_triad_r2B_rep1_20260817/*",f"{WT}/data/synthetic/team_sim/fn_diversity_r2B_rep1_20260817/*"]),
 ("Benchmark team simple (5 rounds)",[f"{ROOT}/runs_v4flash_0731/team_pilot/random42_free_0731_interface_team5_simple_teamlayerednomap_deepseek_20260814/SYN-*-simple-*"]+[f"{ROOT}/runs_v4flash_0731/team_pilot/benchmark_team_rep{i}_20260816/SYN-*-simple-*" for i in range(2,6)]),
 ("Benchmark team layered (5 rounds)",[f"{ROOT}/runs_v4flash_0731/team_pilot/benchmark_team_rep1layered_20260817/SYN-*-layered-*"]+[f"{ROOT}/runs_v4flash_0731/team_pilot/benchmark_team_rep{i}_20260816/SYN-*-layered-*" for i in range(2,6)]),
]
res={}
def z2(v): m=st.mean(v); sd=st.pstdev(v); return [(x-m)/sd if sd else 0 for x in v]
def p2s(b,se):
    from math import erf,sqrt
    zv=abs(b/se); p=2*(1-0.5*(1+erf(zv/sqrt(2))))
    return f"{b:+.2f}"+(f" ({p:.2f})" if p<.10 else "")
import csv
OUT=[]
for name,pats in SAMPLES:
    R=[r for r in collect(pats) if r["ind_blau"] is not None]
    if len(R)<20: print(name,"only",len(R),"rows with pool match"); continue
    cl=[r["comp"] for r in R]
    keys=["n_lines","nums","ind_blau","fn_blau","fin"]
    if "Benchmark" in name: keys=["n_lines","nums","ind_blau","fin"]  # ind Blau == fn Blau in the archetype pool (collinear)
    Xv=[z2([r[k] for r in R]) for k in keys]
    for dvlab,dv in [("Profit","profit"),("Loss","loss"),("log revenue","logrev")]:
        yv=[r[dv] for r in R]
        if any(v is None for v in yv): continue
        y=z2(yv) if dv!="loss" else yv
        K=len(Xv)
        X=[[1.0]+[Xv[j][i] for j in range(K)] for i in range(len(R))]
        b,se,n,G=ols_cluster(y,X,cl)
        cells=[p2s(b[j+1],se[j+1]) for j in range(K)]
        if K==4: cells=cells[:3]+["(=industry)"]+cells[3:]
        OUT.append([dvlab,name,len(R),G]+cells)
        print(f"{dvlab:12s} {name:34s} n={len(R):3d} G={G:3d} "+" ".join(cells))
with open(f"{ROOT}/paper/data/tab9_eisenhardt.csv","w",newline="") as f:
    w=csv.writer(f); w.writerow(["DV","D4 lines","numbers per line","industry Blau","function Blau","finance members"])
    for r in OUT:
        if r[1]=="Designed teams (single round)": w.writerow([r[0]]+r[4:])
    w.writerow([])
    w.writerow(["Robustness: frozen roleplay line (201 team-rounds, 42 compositions, cluster-robust)"])
    for r in OUT:
        if r[1].startswith("Roleplay"): w.writerow([r[0]]+r[4:])
print("\nStandardized OLS, all five predictors in one regression, cluster-robust SE by composition; cells show beta, with (p) when p<.10.")
