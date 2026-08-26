# Robustness of "information use -> shorter D4 review" to the ratio construction.
# The paper's measure info = (numbers+cost words) PER LINE has the DV (n_lines) in its denominator; a skeptic
# can call the negative beta mechanical. Total info has the opposite mechanical problem (more lines -> more total).
# Clean measures: fixed early windows whose denominator is independent of total length:
#   e2/e3/e5 = mean info per line over the FIRST k member lines; ehalf = first half of lines.
# Output: paper/data/tab_robust_info_ratio.csv
import math,statistics as st,csv
src=open("tab9_eisenhardt.py").read(); exec(src.split("res={}")[0])
def rows_with_windows(pats,tag):
    out=[]
    for pat in pats:
        for d in glob.glob(pat):
            r=row(d)
            if not r: continue
            ids=json.load(open(os.path.join(d,"run_meta.json"))).get("profile_ids") or []
            L=d4_lines(d,set(ids)); per=[len(NUM.findall(t))+len(COST.findall(t)) for t in L]
            for k in (2,3,5): r[f"e{k}"]=st.mean(per[:k])
            r["ehalf"]=st.mean(per[:max(1,len(per)//2)]); r["info_tot"]=sum(per); r["tag_d"]=1 if tag=="designed" else 0; out.append(r)
    return out
RP=rows_with_windows([f"{WT}/runs_v4flash_0731/team_r2_replay/team_r2_story3_B_rep{i}_20260816/*" for i in range(1,6)],"frozen")
DS=rows_with_windows([f"{WT}/data/synthetic/team_sim/{b}/*" for b in ["faultline2x2_r2B_rep1_20260816","faultline2x2_r2B_rep2_20260816","faultline_sharedcard_r2B_rep1_20260817","faultline_triad_r2B_rep1_20260817","fn_diversity_r2B_rep1_20260817"]],"designed")
BS=rows_with_windows([f"{ROOT}/runs_v4flash_0731/team_pilot/random42_free_0731_interface_team5_simple_teamlayerednomap_deepseek_20260814/SYN-*-simple-*"]+[f"{ROOT}/runs_v4flash_0731/team_pilot/benchmark_team_rep{i}_20260816/SYN-*-simple-*" for i in range(2,6)],"bs")
BL=rows_with_windows([f"{ROOT}/runs_v4flash_0731/team_pilot/benchmark_team_rep1layered_20260817/SYN-*-layered-*"]+[f"{ROOT}/runs_v4flash_0731/team_pilot/benchmark_team_rep{i}_20260816/SYN-*-layered-*" for i in range(2,6)],"bl")
def reg(rows,xk,dv,extra=None):
    ks=[xk,"ind_blau","fin"]+([extra] if extra else [])
    rows=[r for r in rows if all(r.get(k) is not None for k in ks+[dv])]
    Y=z([r[dv] for r in rows]); cols=[z([r[k] for r in rows]) for k in ks]
    X=[[1]+[c[i] for c in cols] for i in range(len(rows))]
    beta,se,n,G=ols_cluster(Y,X,[r["comp"] for r in rows])
    p=2*(1-0.5*(1+math.erf(abs(beta[1]/se[1])/math.sqrt(2))))
    return beta[1],p,n
out=[]
for name,R,extra in [("Roleplay frozen (201)",RP,None),("Replication designed (231)",DS,None),("Roleplay pooled (432)",RP+DS,"tag_d"),("Benchmark simple (210)",BS,None),("Benchmark layered (210)",BL,None)]:
    for dv in ["n_lines","profit"]:
        rowd=dict(sample=name,dv=dv)
        for xk in ["info","info_tot","e2","e3","e5","ehalf"]:
            b,p,n=reg(R,xk,dv,extra); rowd[xk]=f"{b:+.3f} (p={p:.3f})"
        out.append(rowd)
with open(f"{ROOT}/paper/data/tab_robust_info_ratio.csv","w",newline="") as f:
    w=csv.DictWriter(f,fieldnames=list(out[0].keys())); w.writeheader(); w.writerows(out)
for o in out: print(o)
