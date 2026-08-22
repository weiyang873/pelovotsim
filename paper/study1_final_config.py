# Study 1 report tables (silicon_subjects_report.docx): Grid (Jul) vs Repr-pool plain vs A (repr + warmth + satisfice) vs human 485.
# Decision layer (pending rate per arm, MAE5, substitution enacted), MDMT subscale means, SD ratio vs human, 0-7 distribution.
import json,glob,csv,math,statistics as st,collections
LK="/Users/weiyang/Dropbox/LLM lock-in"; APP=f"{LK}/study3-app"; ROOT="/Users/weiyang/Dropbox/Github_indiswyang/try/emba-ai-sim-v01"
ARMS=["compliant","neutral","soft","hard","consent"]; SUBS=["reliable","competent","ethical","sincere","benevolent"]
WORDS={"reliable":["reliable","predictable","dependable","consistent"],"competent":["competent","skilled","capable","meticulous"],"ethical":["ethical","principled","moral","has_integrity"],"sincere":["truthful","genuine","sincere","frank"],"benevolent":["benevolent","kind","considerate","has_goodwill"]}
def fl(x):
    try: return float(x)
    except: return None
def mean(v): v=[x for x in v if x is not None]; return st.mean(v) if v else None
# human
H=[]
for h in csv.DictReader(open(f"{LK}/Data/study3_main/raw/main_full_export_FINAL_20260726.csv")):
    if not (h["arm"] and h["final_action"]): continue
    subs={k:mean(fl(h.get("mdmt_raw_"+w)) for w in ws) for k,ws in WORDS.items()}
    H.append(dict(arm=h["arm"],pending=1 if h["final_action"]=="pending" else 0,enacted=(h["letter_sent"]=="1" and h["faithful_letter_sent"]!="1") if h["arm"]=="substitution" else None,conf=fl(h["confidence"]),subs=subs))
def load_grid(d):
    rows=[]
    for f in glob.glob(f"{d}/*.json"):
        s=json.load(open(f)); m=s.get("meta",s)
        if m.get("finalAction") is None: continue
        subs={k:None for k in SUBS}
        for e in s.get("events",[]):
            if e.get("action")=="mdmt":
                v=e["payload"].get("values"); dim={o["word"]:o["dimension"] for grp in e["payload"].get("order",[]) for o in grp}
                if isinstance(v,str):
                    try: v=json.loads(v.replace("'",'"'))
                    except: v=None
                if isinstance(v,dict):
                    acc=collections.defaultdict(list)
                    for w,x in v.items():
                        if dim.get(w) and fl(x) is not None: acc[dim[w]].append(fl(x))
                    subs={k:(st.mean(acc[k]) if acc[k] else None) for k in SUBS}
        en=m.get("enacted")
        if en is None and m.get("letterSent") is not None: en=str(m.get("letterSent"))=="True" and str(m.get("faithfulLetterSent"))!="True"
        rows.append(dict(arm=m["arm"],pending=1 if m["finalAction"]=="pending" else 0,enacted=en if m["arm"]=="substitution" else None,conf=fl(m.get("confVal")),subs=subs))
    return rows
def load_chat(d):
    rows=[]; snaps=collections.Counter()
    for f in glob.glob(f"{d}/*.json"):
        m=json.load(open(f))["meta"]; sim=m.get("sim",{}); snaps[sim.get("model_snapshot")]+=1
        if m.get("finalAction") is None: continue
        subs={k:fl((sim.get("mdmt_subs") or {}).get(k)) for k in SUBS}
        rows.append(dict(arm=m["arm"],pending=1 if m["finalAction"]=="pending" else 0,enacted=m.get("enacted") if m["arm"]=="substitution" else None,conf=fl(m.get("confVal")),subs=subs))
    return rows,snaps
DEV=[("Grid (Jul)",load_grid(f"{APP}/modeH/out/sessions_explore_ds_dashscope"),None)]
for name,d in [("Repr-pool plain",f"{APP}/modeHs/out_fullchat/sessions_fullchat_final_reprPlain"),("A: Repr+warm+satisfice",f"{APP}/modeHs/out_fullchat/sessions_fullchat_final_reprWarmSat")]:
    r,snaps=load_chat(d); DEV.append((name,r,dict(snaps)))
rate=lambda R,a: mean([r["pending"] for r in R if r["arm"]==a])
enact=lambda R: mean([1 if r["enacted"] else 0 for r in R if r["arm"]=="substitution" and r["enacted"] is not None])
hp={a:rate(H,a) for a in ARMS}
T1=[dict(device="Human",n=len(H),**{a:round(hp[a],2) for a in ARMS},MAE5="",enacted=round(enact(H),2))]
for name,R,snaps in DEV:
    p={a:rate(R,a) for a in ARMS}; T1.append(dict(device=name,n=len(R),**{a:round(p[a],2) for a in ARMS},MAE5=round(st.mean(abs(p[a]-hp[a]) for a in ARMS),3),enacted=round(enact(R),2) if enact(R) is not None else ""))
    print(name,"snapshots",snaps)
def sub_mean(R,k): return mean([r["subs"][k] for r in R])
def sub_sd(R,k): v=[r["subs"][k] for r in R if r["subs"][k] is not None]; return st.pstdev(v) if len(v)>1 else None
T2=[];T3=[]
for k in SUBS+["confidence"]:
    g=(lambda R: mean([r["conf"] for r in R])) if k=="confidence" else (lambda R,k=k: sub_mean(R,k))
    s=(lambda R: st.pstdev([r["conf"] for r in R if r["conf"] is not None])) if k=="confidence" else (lambda R,k=k: sub_sd(R,k))
    hm,hs=g(H),s(H); row=dict(subscale=k,human_mean=round(hm,2)); row2=dict(subscale=k)
    for name,R,_ in DEV: row[name+" mean"]=round(g(R),2); row2[name+" SD ratio"]=round(s(R)/hs,2)
    T2.append(row); T3.append(row2)
for name,R,_ in DEV: T3.append({}) if False else None
# overall 5-dim SD ratio
ov={name:round(st.mean(sub_sd(R,k)/sub_sd(H,k) for k in SUBS),2) for name,R,_ in DEV}; T3.append(dict(subscale="Overall (5 dims)",**{n+" SD ratio":v for n,v in ov.items()}))
# 0-7 distribution
T4=[]
for k in SUBS:
    for name,R in [("Human",H)]+[(n,R) for n,R,_ in DEV]:
        v=[round(r["subs"][k]) for r in R if r["subs"][k] is not None]; c=collections.Counter(v); T4.append(dict(subscale=k,device=name,n=len(v),**{f"p{i}":round(c[i]/len(v),2) for i in range(8)}))
for fn,T in [("tab_s1_final_decisions.csv",T1),("tab_s1_final_mdmt_means.csv",T2),("tab_s1_final_mdmt_sdratio.csv",T3),("tab_s1_final_mdmt_dist.csv",T4)]:
    with open(f"{ROOT}/paper/data/{fn}","w",newline="") as f:
        keys=[]; [keys.append(k) for t in T for k in t if k not in keys]; w=csv.DictWriter(f,fieldnames=keys); w.writeheader(); w.writerows(T)
    print("\n##",fn); [print(t) for t in T]
