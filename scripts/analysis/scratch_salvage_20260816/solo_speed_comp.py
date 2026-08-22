import json,glob,os,re,math,statistics as st,collections
CAPS=set()
rows=json.load(open(os.environ["S"]+"/solo_mining_rows.json"))
# rebuild dir map by rep+pid+seed: easier: recompute from dirs
def pear(x,y):
    pr=[(a,b) for a,b in zip(x,y) if a is not None and b is not None]
    n=len(pr); mx=sum(a for a,b in pr)/n; my=sum(b for a,b in pr)/n
    sx=math.sqrt(sum((a-mx)**2 for a,b in pr)); sy=math.sqrt(sum((b-my)**2 for a,b in pr))
    return (sum((a-mx)*(b-my) for a,b in pr)/(sx*sy) if sx and sy else float("nan")), n
def pv(r,n):
    if not abs(r)<1: return 0
    t=abs(r)*math.sqrt((n-2)/(1-r*r)); z=t*(1-1/(4*(n-2)))/math.sqrt(1+t*t/(2*(n-2))); return 2*(1-0.5*(1+math.erf(z/math.sqrt(2))))
data=[]
for i in range(1,6):
    for d in glob.glob(f"runs_v4flash_0731/team_r2_replay/solo_r2_v2Q_rep{i}_20260816/*"):
        p=os.path.join(d,"settlement.json")
        if not os.path.exists(p): continue
        s=json.load(open(p)); m=json.load(open(os.path.join(d,"run_meta.json"))); pid=m["profile_ids"][0]
        att=[json.loads(l) for l in open(os.path.join(d,"r2_individual_card_attempts.jsonl"))]
        ok=[a for a in att if a["status"]=="ok"]; raw="\n".join(a["raw"] for a in ok)
        caps=set(re.findall(r"\b([a-z]+(?:_[a-z0-9]+)+)\b",raw)); caps={c for c in caps if not c.startswith(("json","ui_","cap_"))}
        d4_chars=len(raw); retries=len(att)-len(ok)
        hes=len(re.findall("犹豫|纠结|拿不准|不确定|想了想|再看看|要不要|还是",raw)); costm=len(re.findall("成本|增量|研发|预算|毛利|元",raw)); cust=len(re.findall("痛点|阿姨|园长|客户|用户|她|他要|需要",raw))
        r2=json.load(open(os.path.join(d,"r2_transcript.json")))["transcript"]
        mem=lambda dp:[x for x in dp["transcript"] if x["speaker"]==pid]
        price_turns=sum(len(mem(dp)) for dp in r2 if dp["decision_point"].startswith("price")); price_chars=sum(len(x["text"]) for dp in r2 if dp["decision_point"].startswith("price") for x in mem(dp))
        card_turns=sum(len(mem(dp)) for dp in r2 if dp["decision_point"].startswith("cards_"))
        tr=json.load(open(os.path.join(d,"r1_transcript.json"))); r1n=len(tr.get("transcript",[])); r1c=sum(len(x.get("text","")) for x in tr.get("transcript",[]))
        cards=len(s["r2_cards"])
        data.append(dict(pid=pid,rep=i,cards=cards,loss=s["profitable"] is False,profit=s["profit"]/1e4,cost=s["r1"]["strategy"]=="COST",price=s["r2"]["P"],
            comp_caps=len(caps),comp_chars=d4_chars,comp_cost=costm,comp_cust=cust,hes=hes,retries=retries,speed_r1=r1n,r1_chars=r1c,price_turns=price_turns,price_chars=price_chars,card_turns=card_turns))
print("runs",len(data))
X=[("D4 考虑过的卡数(文本提及)","comp_caps"),("D4 思考文本量(字)","comp_chars"),("D4 成本词频","comp_cost"),("D4 客户词频","comp_cust"),("D4 犹豫词频","hes"),("D4 重试次数","retries"),("R1 剧本 beat 数","speed_r1"),("R1 字数","r1_chars"),("D5 定价发言轮数","price_turns"),("D5 定价字数","price_chars"),("D4 复核发言轮数","card_turns")]
Y=[("loss","loss"),("profit","profit"),("cards","cards"),("price","price"),("COST","cost")]
print("indicator".ljust(22)+"".join(y[0].rjust(9) for y in Y)+"    mean")
for nm,k in X:
    cells=[]
    for yn,yk in Y:
        r,n=pear([d[k] for d in data],[d[yk] for d in data]); p=pv(r,n); cells.append(f"{r:+.2f}{'**' if p<.01 else '*' if p<.05 else ''}".rjust(9))
    print(nm.ljust(22)+"".join(cells)+f"    {st.mean(d[k] for d in data):.1f}")
# partial: comprehensiveness -> profit controlling cards
def partial(x,y,z):
    rxy,_=pear(x,y); rxz,_=pear(x,z); ryz,_=pear(y,z); return (rxy-rxz*ryz)/math.sqrt((1-rxz**2)*(1-ryz**2))
print("\n偏相关（控制卡数）：")
for nm,k in X[:5]:
    print(f"  {nm} → profit | cards: {partial([d[k] for d in data],[d['profit'] for d in data],[d['cards'] for d in data]):+.2f}   → loss | cards: {partial([d[k] for d in data],[d['loss'] for d in data],[d['cards'] for d in data]):+.2f}")
# within-strategy
for strat in [True,False]:
    D=[d for d in data if d["cost"]==strat]
    r1,_=pear([d["comp_caps"] for d in D],[d["profit"] for d in D]); r2,_=pear([d["comp_chars"] for d in D],[d["profit"] for d in D]); r3,_=pear([d["comp_cost"] for d in D],[d["profit"] for d in D])
    print(f"{'COST' if strat else 'DIFF'} 内 (n={len(D)}): 考虑卡数→profit {r1:+.2f} | 思考量→profit {r2:+.2f} | 成本词频→profit {r3:+.2f}")
json.dump(data,open(os.environ["S"]+"/solo_speed_comp.json","w"))
