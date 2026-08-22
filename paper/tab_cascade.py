# Cascade / herding. (a) Per-member sequential D5 probe (team_r2_cascade_smoke_rep1_20260817): public announcement vs own private
# action; follow = when private action disagrees with the strict majority of earlier public announcements, public equals that majority.
# (b) Frozen team B (single-writer screenplay): each member's first classified D5 price_action line (keyword stance A=压价/冲量, B=抬价/守毛利)
# vs own private_stage action (d5_persona_layer); same keep/follow definitions over beat order.
import json,glob,os,re,csv,collections,statistics as st
from common_runs import ROOT,WT,TEAM_B
LOW=re.compile(r"压价|压低|降价|冲量|走量|低一点|低价|先卖出去|便宜|往低|定低|低档"); HIGH=re.compile(r"抬价|抬高|守毛利|保毛利|定高|高一点|高价|往高|提价|不能低|撑不住")
def stance(line):
    l=len(LOW.findall(line)); h=len(HIGH.findall(line)); return "A" if l>h else ("B" if h>l else None)
def maj(prior):
    c=collections.Counter(prior); 
    if not c: return None
    (a,na),=c.most_common(1); return a if na>len(prior)/2 else None
out=[]
def tally(name,seqs):
    keep=[];follow=[];leader_keep=[]
    for seq in seqs:
        prior=[]
        for s in seq:
            if s["public"] is None: continue
            keep.append(s["public"]==s["private"])
            if s.get("leader"): leader_keep.append(s["public"]==s["private"])
            m=maj(prior)
            if m and s["private"]!=m: follow.append(s["public"]==m)
            prior.append(s["public"])
    out.append(dict(line=name,teams=len(seqs),announcements=len(keep),public_eq_private=round(st.mean(keep),2),n_conflict=len(follow),follow_majority=round(st.mean(follow),2) if follow else None,leader_keeps_own=round(st.mean(leader_keep),2) if leader_keep else None))
# (a)
seqs=[]
for p in sorted(glob.glob(f"{WT}/data/synthetic/team_sim/team_r2_cascade_smoke_rep1_20260817/*/d5_sequential_action.jsonl")):
    L=[json.loads(l) for l in open(p)]; seqs.append([dict(public=x["public_choice"],private=x["private_action"],leader=x["is_leader"]) for x in sorted(L,key=lambda x:x["position"])])
tally("Sequential per-member D5 (probe)",seqs)
# (b)
seqs=[]
for pat in TEAM_B:
    for d in sorted(glob.glob(pat)):
        pl=os.path.join(d,"d5_persona_layer.jsonl"); tr=os.path.join(d,"r2_transcript.json")
        if not (os.path.exists(pl) and os.path.exists(tr)): continue
        priv={}
        for l in open(pl):
            x=json.loads(l); a=(x.get("private_stage") or {}).get("action",""); priv[x["member_id"]]="A" if "压" in a or "低" in a else ("B" if "抬" in a or "高" in a else None)
        m=json.load(open(os.path.join(d,"run_meta.json"))); seen=set(); seq=[]
        for dp in json.load(open(tr))["transcript"]:
            if dp["decision_point"]!="price_action": continue
            for t in dp.get("turns",[]):
                for b in (t.get("screenplay") or {}).get("beats",[]):
                    a=b.get("actor"); 
                    if a in seen or a not in priv or priv[a] is None: continue
                    s=stance(str(b.get("line","")))
                    if s is None: continue
                    seen.add(a); seq.append(dict(public=s,private=priv[a],leader=a==m.get("leader_id")))
        if seq: seqs.append(seq)
tally("Frozen team B single-writer D5 (keyword stance)",seqs)
with open(f"{ROOT}/paper/data/tab_cascade.csv","w",newline="") as f:
    w=csv.DictWriter(f,fieldnames=list(out[0].keys())); w.writeheader(); w.writerows(out)
for o in out: print(o)
