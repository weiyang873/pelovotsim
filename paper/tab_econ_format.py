# T9 & T10 in economics reporting format (coef with stars, SE beneath, N/clusters/R2 rows).
exec(open("tab9_eisenhardt.py").read().split("res={}")[0])
from math import erf,sqrt
def z2(v): m=st.mean(v); sd=st.pstdev(v); return [(x-m)/sd if sd else 0 for x in v]
def stars(b,se):
    z=abs(b/se); p=2*(1-0.5*(1+erf(z/sqrt(2))))
    return "***" if p<.01 else "**" if p<.05 else "*" if p<.10 else ""
def r2(y,X,beta):
    yh=[sum(X[i][a]*beta[a] for a in range(len(beta))) for i in range(len(y))]
    my=st.mean(y); ssr=sum((y[i]-yh[i])**2 for i in range(len(y))); sst=sum((v-my)**2 for v in y)
    return 1-ssr/sst if sst else float("nan")
def fit(y,cols,cl):
    X=[[1.0]+[c[i] for c in cols] for i in range(len(y))]
    b,se,n,G=ols_cluster(y,X,cl); return b,se,r2(y,X,b),n,G
def load_sample(name,pats,need_pool=True):
    R=collect(pats)
    if need_pool: R=[r for r in R if r["ind_blau"] is not None]
    return R
S={n:load_sample(n,p) for n,p in SAMPLES}
RPN="Roleplay team (frozen, 5 rounds)"; DSN="Designed teams (single round)"; BSN="Benchmark team simple (5 rounds)"; BLN="Benchmark team layered (5 rounds)"
# ---------------- T9 ----------------
PRED=[("D4 discussion length","n_lines"),("Numbers per line","nums"),("Industry diversity (Blau)","ind_blau"),("Function diversity (Blau)","fn_blau"),("Finance members","fin")]
def col(sample,dv,keys):
    R=S[sample]; cl=[r["comp"] for r in R]
    y=z2([r[dv] for r in R]) if dv!="loss" else [r["loss"] for r in R]
    cols=[z2([r[k] for r in R]) for k in keys]
    b,se,rr,n,G=fit(y,cols,cl)
    cells={}
    for j,k in enumerate(keys): cells[k]=(f"{b[j+1]:+.2f}{stars(b[j+1],se[j+1])}",f"({se[j+1]:.2f})")
    return cells,n,G,rr
keys5=[k for _,k in PRED]
COLS=[("(1) Profit",DSN,"profit",keys5),("(2) Loss",DSN,"loss",keys5),("(3) log revenue",DSN,"logrev",keys5),
      ("(4) Profit",RPN,"profit",keys5),("(5) Loss",RPN,"loss",keys5),("(6) log revenue",RPN,"logrev",keys5)]
out=[c[0] for c in COLS]; res=[col(s,d,k) for _,s,d,k in COLS]
L=["# T9 — Real-time information use and performance (economics format)","",
"|  | "+" | ".join(out)+" |","|---|"+"---|"*len(out)]
for lab,k in PRED:
    L.append("| "+lab+" | "+" | ".join(r[0][k][0] for r in res)+" |")
    L.append("|  | "+" | ".join(r[0][k][1] for r in res)+" |")
L.append("| N (team-rounds) | "+" | ".join(str(r[1]) for r in res)+" |")
L.append("| Clusters | "+" | ".join(str(r[2]) for r in res)+" |")
L.append("| R² | "+" | ".join(f"{r[3]:.2f}" for r in res)+" |")
L+=["","Columns (1)–(3): independent replication sample, 231 designed team compositions, single round. Columns (4)–(6): frozen roleplay line, 201 team-rounds of 42 compositions, SE clustered by composition. Standardized OLS coefficients; cluster-robust SE in parentheses; *p<.10 **p<.05 ***p<.01."]
open("data/tab9_eisenhardt_econ.md","w").write("\n".join(L))
# ---------------- T10 ----------------
def col10(sample,ctrl):
    R=S[sample]; cl=[r["comp"] for r in R]
    y=z2([r["n_lines"] for r in R]); info=z2([r["info"] for r in R])
    keys=[] if not ctrl else (["ind_blau","fin"] if "Benchmark" in sample else ["ind_blau","fn_blau","fin"])
    cols=[info]+[z2([r[k] for r in R]) for k in keys]
    b,se,rr,n,G=fit(y,cols,cl)
    return (f"{b[1]:+.2f}{stars(b[1],se[1])}",f"({se[1]:.2f})",ctrl,n,G,rr,st.mean(r['n_lines'] for r in R),st.pstdev([r['n_lines'] for r in R]))
C10=[("(1)",RPN,False),("(2)",RPN,True),("(3)",DSN,False),("(4)",DSN,True),("(5)",BSN,False),("(6)",BSN,True),("(7)",BLN,False),("(8)",BLN,True)]
r10=[col10(s,c) for _,s,c in C10]
hdr=["(1)","(2)","(3)","(4)","(5)","(6)","(7)","(8)"]
L=["# T10 — Do informed teams deliberate for less long? DV: card-review discussion length (economics format)","",
"| | Roleplay (frozen) | | Replication (designed) | | Benchmark simple | | Benchmark layered | |","|---|---|---|---|---|---|---|---|---|",
"|  | "+" | ".join(hdr)+" |",
"| Information use per line | "+" | ".join(r[0] for r in r10)+" |",
"|  | "+" | ".join(r[1] for r in r10)+" |",
"| Composition controls | "+" | ".join("Yes" if r[2] else "No" for r in r10)+" |",
"| N (team-rounds) | "+" | ".join(str(r[3]) for r in r10)+" |",
"| Clusters | "+" | ".join(str(r[4]) for r in r10)+" |",
"| R² | "+" | ".join(f"{r[5]:.2f}" for r in r10)+" |",
"| DV mean (SD) | "+" | ".join(f"{r[6]:.1f} ({r[7]:.1f})" for r in r10)+" |"]
rp=col10(RPN,True); bs=col10(BSN,True)
b1=float(rp[0].rstrip("*")); s1=float(rp[1].strip("()")); b2=float(bs[0].rstrip("*")); s2=float(bs[1].strip("()"))
d=b1-b2; sd_=sqrt(s1*s1+s2*s2); p=2*(1-0.5*(1+erf(abs(d/sd_)/sqrt(2))))
L+=["",f"Cross-design difference (roleplay − benchmark simple, with controls): {d:+.2f} (SE {sd_:.2f}), p = {p:.3f}.",
"Standardized OLS; SE clustered by composition (designed sample: 231 independent compositions). Composition controls: industry Blau, function Blau (collinear with industry in the benchmark archetype pool, hence omitted there), number of finance-background members. Discussion length is set by the agents in the roleplay designs (DV SD 7–8 lines) and by the program in the benchmark (SD 2.6–3.5). *p<.10 **p<.05 ***p<.01."]
open("data/tab10_info_length_econ.md","w").write("\n".join(L))
print(open("data/tab9_eisenhardt_econ.md").read()); print(); print(open("data/tab10_info_length_econ.md").read())
