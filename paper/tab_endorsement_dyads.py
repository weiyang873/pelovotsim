# Designed 2x2 (aligned/crosscut x private-info note) R1 teams. Two per-dyad measures over the four note-holding members (isolate excluded):
#  proposal_same_side : X's and Y's independent round-1 proposals fall on the same age segment (ELDER vs ADULT/CHILD) — the axis the
#                       private evidence points to (elder-care institutions vs young consumers);
#  spoken_endorse     : Y's substantive line names X next to an agreement marker (rare; kept for completeness).
# Same-side dyad = X and Y hold the same kind of private note. Reports rates by cell x info, permutation p within cell.
import json,glob,os,re,csv,random,collections,statistics as st
from common_runs import ROOT,WT
D=f"{WT}/data/task_blind_persona_pipeline_v1/faultline_design_pool60_20260817/"
T=json.load(open(D+"faultline_design_teams.json"))["teams"]; NOTES=json.load(open(D+"private_notes.json"))
POOL={r["persona_id"]:r for r in json.load(open(D+"persona_pool_merged.json"))}
side={pid:("elder" if "养老" in txt else "consumer") for pid,txt in NOTES.items()}
AGREE=re.compile(r"同意|赞成|说得对|说的对|有道理|支持|我也(这么|觉得|认为|倾向)|附议|没错|对的|补充一下|接着.{0,4}说|在理|认同")
BATCHES={"info":["faultline_design_r1_20260817","faultline_design_r1_rep2_20260817"],"noinfo":["faultline_design_r1_nonote_20260817","faultline_design_r1_nonote_rep2_20260817"]}
rows=[]
for info,bs in BATCHES.items():
    for b in bs:
        for d in sorted(glob.glob(f"{WT}/runs_v4flash_0731/team_pilot/{b}/*/r1_transcript.json")):
            m=json.load(open(os.path.dirname(d)+"/run_meta.json")); ids=m["profile_ids"]
            team=next((t for t in T.values() if t["profile_ids"]==ids),None)
            if not team: continue
            names={pid:POOL[pid]["surface"]["name"] for pid in ids}
            members=[pid for pid in ids if pid!=team["isolate"]]
            end=collections.defaultdict(int); tj=json.load(open(d)); prop={}
            for p in tj.get("proposals",[]):
                pid=p.get("persona_id") or p.get("member_id") or (re.search(r"姓名代号：(\w+)",str(p.get("prompt",""))) or [None,None])[1]
                g=(p.get("parsed") or {}).get("grid_id") or ""
                if pid and g: prop[pid]="ELDER" if "ELDER" in g else "YOUNG"
            for it in tj["transcript"]:
                y=it.get("speaker")
                if y not in names or it.get("participation")=="silent": continue
                txt=re.sub(r"（[^）]*）","",str(it.get("text","")))
                for x in names:
                    if x==y or names[x] not in txt: continue
                    window=txt[max(0,txt.find(names[x])-20):txt.find(names[x])+40]
                    if AGREE.search(window): end[(x,y)]+=1
            for x in members:
                for y in members:
                    if x==y: continue
                    rows.append(dict(batch=b,info=info,cell=team["cell"],team=m["seed"],x=x,y=y,same_side=int(side.get(x)==side.get(y)),endorsed=int(prop.get(x) is not None and prop.get(x)==prop.get(y)),spoken_endorse=int(end[(x,y)]>0)))
with open(f"{ROOT}/paper/data/tab_endorsement_dyads.csv","w",newline="") as f:
    w=csv.DictWriter(f,fieldnames=list(rows[0].keys())); w.writeheader(); w.writerows(rows)
def rate(sub): return st.mean(r["endorsed"] for r in sub) if sub else float("nan")
def perm(sub,n=5000,seed=1):
    obs=rate([r for r in sub if r["same_side"]])-rate([r for r in sub if not r["same_side"]]); lab=[r["same_side"] for r in sub]; e=[r["endorsed"] for r in sub]; rng=random.Random(seed); c=0
    for _ in range(n):
        rng.shuffle(lab); a=[v for v,l in zip(e,lab) if l]; b=[v for v,l in zip(e,lab) if not l]; c+= (st.mean(a)-st.mean(b))>=obs-1e-12
    return obs,c/n
print("dyads",len(rows))
summ=[]
for info in ("info","noinfo"):
    for cell in ("aligned","crosscut"):
        sub=[r for r in rows if r["info"]==info and r["cell"]==cell]; obs,p=perm(sub)
        summ.append(dict(info=info,cell=cell,n_dyads=len(sub),teams=len(set(r["team"] for r in sub)),same_side_rate=round(rate([r for r in sub if r["same_side"]]),2),cross_rate=round(rate([r for r in sub if not r["same_side"]]),2),diff=round(obs,2),perm_p=round(p,3)))
for info in ("info","noinfo"):
    sub=[r for r in rows if r["info"]==info]; obs,p=perm(sub); summ.append(dict(info=info,cell="all",n_dyads=len(sub),teams=len(set(r["team"] for r in sub)),same_side_rate=round(rate([r for r in sub if r["same_side"]]),2),cross_rate=round(rate([r for r in sub if not r["same_side"]]),2),diff=round(obs,2),perm_p=round(p,3)))
with open(f"{ROOT}/paper/data/tab_endorsement_summary.csv","w",newline="") as f:
    w=csv.DictWriter(f,fieldnames=list(summ[0].keys())); w.writeheader(); w.writerows(summ)
for s in summ: print(s)
