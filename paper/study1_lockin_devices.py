# Study 1 (pilot): LLM lock-in — can synthetic participants reproduce human decisions, dispersion and susceptibility?
# Human = Prolific main FINAL (485 completes, ~80/arm, 6 arms). Synthetic = same persona pool through four "devices":
#   simple card questionnaire (modeH explore) / layered biography questionnaire (Park-style bio) / v6 mechanism chain / full chat
#   (+ full chat with satisfice injection); two base models (deepseek-v4-flash-0731 via dashscope, qwen-plus).
# Outputs: paper/data/tab_s1_devices.csv (T1: pending rate per arm, MAE, substitution enacted)
#          paper/data/tab_s1_dispersion.csv (T2: within-arm SD ratio AI/human: confidence, MDMT performance, MDMT moral)
#          F2: substitution enacted by device, incl. satisfice injection.
import json,glob,csv,math,statistics as st,collections,os
LK="/Users/weiyang/Dropbox/LLM lock-in"; APP=f"{LK}/study3-app"; ROOT="/Users/weiyang/Dropbox/Github_indiswyang/try/emba-ai-sim-v01"
ARMS=["compliant","neutral","soft","hard","consent"]
def fl(x):
    try: return float(x)
    except: return None
# ---------- human ----------
H=[h for h in csv.DictReader(open(f"{LK}/Data/study3_main/raw/main_full_export_FINAL_20260726.csv")) if h["arm"] and h["final_action"]]
cols=[k for k in H[0] if k.startswith("mdmt_raw_")]
PERF=["reliable","predictable","dependable","consistent","competent","skilled","capable","meticulous"]
MOR=["ethical","principled","moral","has_integrity","truthful","genuine","sincere","frank","benevolent","kind","considerate","has_goodwill"]
def hsub(h,keys):
    v=[fl(h[c]) for c in cols if any(c=="mdmt_raw_"+k for k in keys)]; v=[x for x in v if x is not None]; return st.mean(v) if v else None
Hr=[dict(arm=h["arm"],pending=1 if h["final_action"]=="pending" else 0,enacted=(h["letter_sent"]=="1" and h["faithful_letter_sent"]!="1") if h["arm"]=="substitution" else None,conf=fl(h["confidence"]),perf=hsub(h,PERF),moral=hsub(h,MOR)) for h in H]
# ---------- synthetic loaders ----------
WORD2DIM={"Reliable":"reliable","Predictable":"reliable","Dependable":"reliable","Consistent":"reliable","Competent":"competent","Skilled":"competent","Capable":"competent","Meticulous":"competent","Ethical":"ethical","Principled":"ethical","Moral":"ethical","Has integrity":"ethical","Truthful":"sincere","Genuine":"sincere","Sincere":"sincere","Frank":"sincere","Benevolent":"benevolent","Kind":"benevolent","Considerate":"benevolent","Has goodwill":"benevolent"}
def grid_mdmt(events):
    for e in events or []:
        if e.get("action")=="mdmt":
            v=e["payload"].get("values");
            if isinstance(v,str):
                try: v=json.loads(v.replace("'",'"'))
                except: return None,None
            perf=[fl(x) for w,x in v.items() if WORD2DIM.get(w) in ("reliable","competent") and fl(x) is not None]; mor=[fl(x) for w,x in v.items() if WORD2DIM.get(w) in ("ethical","sincere","benevolent") and fl(x) is not None]
            return (st.mean(perf) if perf else None,st.mean(mor) if mor else None)
    return None,None
def load(d):
    rows=[]
    for f in glob.glob(f"{d}/*.json"):
        s=json.load(open(f)); m=s.get("meta",s); sim=m.get("sim",{})
        if m.get("finalAction") is None: continue
        en=m.get("enacted")
        if en is None and m.get("letterSent") is not None: en=bool(m.get("letterSent")) and not bool(m.get("faithfulLetterSent"))
        if sim.get("mdmt_mode")=="verbal":  # 1-6 verbal anchors -> rescale to human 0-7 range (x 7/5)
            perf=sim.get("mdmt_perf"); mor=sim.get("mdmt_moral"); scale=1.4
        else:
            perf,mor=grid_mdmt(s.get("events")); scale=1.0
        rows.append(dict(arm=m["arm"],pending=1 if m["finalAction"]=="pending" else 0,enacted=en if m["arm"]=="substitution" else None,conf=m.get("confVal"),perf=perf,moral=mor,scale=scale))
    return rows
DEV=[("Simple card questionnaire","deepseek-v4-flash-0731",f"{APP}/modeH/out/sessions_explore_ds_dashscope"),
     ("Layered biography questionnaire","deepseek-v4-flash-0731",f"{APP}/modeH/out/sessions_explore_layered_dsq"),
     ("Full chat","deepseek-v4-flash-0731",f"{APP}/modeHs/out_fullchat/sessions_fullchat_dsq")]
def rate(rows,a): v=[r["pending"] for r in rows if r["arm"]==a]; return st.mean(v) if v else None
def n_arm(rows,a): return sum(1 for r in rows if r["arm"]==a)
def enact(rows): v=[1 if r["enacted"] else 0 for r in rows if r["arm"]=="substitution" and r["enacted"] is not None]; return (st.mean(v),len(v)) if v else (None,0)
def ci(p,n):
    if p is None or n==0: return ""
    se=math.sqrt(p*(1-p)/n); return f"[{max(0,p-1.96*se):.2f},{min(1,p+1.96*se):.2f}]"
def z(p1,n1,p2,n2):
    p=(p1*n1+p2*n2)/(n1+n2); se=math.sqrt(p*(1-p)*(1/n1+1/n2)); return (p1-p2)/se if se else float("nan")
def pooled_sd(rows,key):
    num=den=0
    for a in ARMS+["substitution"]:
        v=[r[key]*(r.get("scale",1) if key!="conf" else 1) for r in rows if r["arm"]==a and r[key] is not None]
        if len(v)>1: num+=(len(v)-1)*st.variance(v); den+=len(v)-1
    return math.sqrt(num/den) if den else None
hp={a:rate(Hr,a) for a in ARMS}; hn={a:n_arm(Hr,a) for a in ARMS}; he,hen=enact(Hr)
# ---------- T1 ----------
t1=[]
row=dict(device="Human (Prolific, main FINAL)",model="",n=len(Hr)); row.update({a:f"{hp[a]:.2f}" for a in ARMS}); row.update(MAE5="",arms_indistinguishable="",sub_enacted=f"{he:.2f} {ci(he,hen)}",n_sub=hen); t1.append(row)
for name,model,d in DEV:
    R=load(d); p={a:rate(R,a) for a in ARMS}
    mae=st.mean(abs(p[a]-hp[a]) for a in ARMS)
    ind=sum(1 for a in ARMS if abs(z(p[a],n_arm(R,a),hp[a],hn[a]))<1.96)
    en,ne=enact(R)
    row=dict(device=name,model=model,n=len(R)); row.update({a:f"{p[a]:.2f}" for a in ARMS}); row.update(MAE5=f"{mae:.3f}",arms_indistinguishable=f"{ind}/5",sub_enacted=(f"{en:.2f} {ci(en,ne)}" if en is not None else ""),n_sub=ne); t1.append(row)
    row["_R"]=R
with open(f"{ROOT}/paper/data/tab_s1_devices.csv","w",newline="") as f:
    keys=[k for k in t1[0] if k not in ("_R","sub_enacted","n_sub")]; w=csv.DictWriter(f,fieldnames=keys,extrasaction="ignore"); w.writeheader(); w.writerows(t1)
# ---------- T2 dispersion ----------
hc,hpf,hm=pooled_sd(Hr,"conf"),pooled_sd(Hr,"perf"),pooled_sd(Hr,"moral")
t2=[dict(device="Human",model="",n=len(Hr),conf_sd=f"{hc:.1f}",conf_ratio="1.00",perf_sd=f"{hpf:.2f}",perf_ratio="1.00",moral_sd=f"{hm:.2f}",moral_ratio="1.00",mdmt_instrument="20-word grid 0-7")]
for row in t1[1:]:
    R=row["_R"]; c,pf,mo=pooled_sd(R,"conf"),pooled_sd(R,"perf"),pooled_sd(R,"moral")
    inst="verbal anchors 1-6 (×1.4)" if any(r["scale"]==1.4 for r in R) else "20-word grid 0-7"
    t2.append(dict(device=row["device"],model=row["model"],n=len(R),conf_sd=f"{c:.1f}" if c else "",conf_ratio=f"{c/hc:.2f}" if c else "",perf_sd=f"{pf:.2f}" if pf else "",perf_ratio=f"{pf/hpf:.2f}" if pf else "",moral_sd=f"{mo:.2f}" if mo else "",moral_ratio=f"{mo/hm:.2f}" if mo else "",mdmt_instrument=inst))
with open(f"{ROOT}/paper/data/tab_s1_dispersion.csv","w",newline="") as f:
    w=csv.DictWriter(f,fieldnames=list(t2[0].keys())); w.writeheader(); w.writerows(t2)
# ---------- print ----------
def show(rows,keys):
    print(" | ".join(keys));
    for r in rows: print(" | ".join(str(r.get(k,"")) for k in keys))
print("T1 — decisions (pending rate by arm), fit to human, susceptibility (substitution enacted)")
show(t1,["device","model","n"]+ARMS+["MAE5","arms_indistinguishable"])
print("\nT2 — within-arm dispersion (SD ratio synthetic/human)")
show(t2,["device","model","n","conf_sd","conf_ratio","perf_sd","perf_ratio","moral_sd","moral_ratio","mdmt_instrument"])

# ---------- Fig 2 (Study 1): susceptibility — substitution enacted, human vs devices (+ satisfice injection) ----------
import matplotlib; matplotlib.use("Agg"); import matplotlib.pyplot as plt
SAT=load(f"{APP}/modeHs/out_fullchat/sessions_fullchat_dsq_sat"); es,ns=enact(SAT)
bars=[("Human\n(n=80)",he,hen,"#444444")]+[(r["device"].replace(" questionnaire","\nquestionnaire").replace("Full chat","Full chat")+f"\n(n={r['n_sub']})",enact(r["_R"])[0],r["n_sub"],"#2166ac") for r in t1[1:]]+[(f"Full chat\n+ satisfice\n(n={ns})",es,ns,"#b2182b")]
fig,ax=plt.subplots(figsize=(6.5,3.6))
x=range(len(bars)); y=[b[1] for b in bars]; err=[1.96*math.sqrt(b[1]*(1-b[1])/b[2]) for b in bars]
ax.bar(x,y,yerr=err,capsize=3,color=[b[3] for b in bars]); ax.set_xticks(list(x)); ax.set_xticklabels([b[0] for b in bars],fontsize=8)
ax.axhline(he,ls=":",c="#444444",lw=0.8); ax.set_ylim(0,1); ax.set_ylabel("P(sent the substituted letter)",fontsize=9)
for i,b in enumerate(bars): ax.text(i,b[1]+err[i]+0.02,f"{b[1]:.2f}",ha="center",fontsize=8)
ax.set_title("Susceptibility to a substituted letter (substitution arm): human vs synthetic devices",fontsize=9)
fig.tight_layout(); fig.savefig(f"{ROOT}/paper/figs/fig_s1_2_susceptibility.png",dpi=200); fig.savefig(f"{ROOT}/paper/figs/fig_s1_2_susceptibility.pdf")
with open(f"{ROOT}/paper/data/fig_s1_2_susceptibility.csv","w",newline="") as f:
    w=csv.writer(f); w.writerow(["condition","enacted","n","ci95_lo","ci95_hi"])
    for b,e in zip(bars,err): w.writerow([b[0].replace("\n"," "),round(b[1],3),b[2],round(max(0,b[1]-e),3),round(min(1,b[1]+e),3)])
print("\nFig 2 (susceptibility):",[(b[0].replace("\n"," "),round(b[1],2),b[2]) for b in bars])
