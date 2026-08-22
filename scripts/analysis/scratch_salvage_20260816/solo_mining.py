import json,glob,os,re,statistics as st,collections,math
POOL=json.load(open("data/task_blind_persona_pipeline_v1/r1_pool42_20260812/persona_pool_task_blind_narrative_v1.json"))
byid={r["persona_id"]:r for r in POOL}
DIMS=list(POOL[0]["behavioral_fingerprint"].keys())
rows=[]
for i in range(1,6):
    for d in glob.glob(f"runs_v4flash_0731/team_r2_replay/solo_r2_v2Q_rep{i}_20260816/*"):
        p=os.path.join(d,"settlement.json")
        if not os.path.exists(p): continue
        s=json.load(open(p)); m=json.load(open(os.path.join(d,"run_meta.json"))); r2=s["r2"]; r1=s["r1"]
        pid=m["profile_ids"][0]; per=byid[pid]; fp=per["behavioral_fingerprint"]; sf=per["surface"]; cc=per["frozen_facts"]["career_context"]
        rh=""
        rp=os.path.join(d,"d4_reading_habits.jsonl")
        if os.path.exists(rp):
            for l in open(rp):
                rh=json.loads(l).get("reading_habit","")
        cards=s["r2_cards"]; tiers=collections.Counter(c.get("tier") for c in cards)
        price=r2["P"]
        row=dict(rep=i,pid=pid,age=sf["age"],male=sf["gender"]=="male",grad="硕士" in sf["edu"],fin="财务" in cc,mkt=bool(re.search("市场|销售|品牌|客户|产品",cc)),
                 rh_cost=bool(re.search("成本|逐项|算|抠|毛利|价格",rh)) and not re.search("不会逐项|不看成本|不太看成本|扫一眼成本",rh),rh_feature=bool(re.search("功能全不全|有没有漏|卖点|体验|先看功能",rh)),
                 cost=r1["strategy"]=="COST",toB=r1["channel"]=="ToB",elder=r1["age"]=="ELDER",child=r1["age"]=="CHILD",exp=r1.get("architecture")=="Experience",
                 cards=len(cards),high=tiers.get("high",0),low=tiers.get("low",0),dcogs=r2["dCOGS"],cogs=r2["COGS"],nre=r2["nre_total_wan"],price=price,
                 price_wtp=price/r2["WTPref"] if r2.get("WTPref") else None,gm=r2["actualGm"],unitMargin=r2["unitMargin"],breakeven=r2["breakeven_q"],units=r2["units"],share=r2["share"],
                 coverCore=r2["coverCore"],penalty=r2["penalty"],overBudget=r2["overBudget"],risk=r2["risk"],complexity=r2["complexity"],
                 profit=s["profit"]/1e4,loss=s["profitable"] is False,**{k:fp[k] for k in DIMS})
        rows.append(row)
print("runs",len(rows))
def pear(x,y):
    pr=[(a,b) for a,b in zip(x,y) if a is not None and b is not None and isinstance(a,(int,float,bool)) and isinstance(b,(int,float,bool))]
    n=len(pr); mx=sum(a for a,b in pr)/n; my=sum(b for a,b in pr)/n
    sx=math.sqrt(sum((a-mx)**2 for a,b in pr)); sy=math.sqrt(sum((b-my)**2 for a,b in pr))
    return sum((a-mx)*(b-my) for a,b in pr)/(sx*sy) if sx and sy else float("nan"), n
def pval(r,n):
    if not (abs(r)<1): return 0
    t=abs(r)*math.sqrt((n-2)/(1-r*r)); z=t*(1-1/(4*(n-2)))/math.sqrt(1+t*t/(2*(n-2)))
    return 2*(1-0.5*(1+math.erf(z/math.sqrt(2))))
OUT=[("loss","loss"),("profit","profit"),("cards","cards"),("price","price"),("COST","cost"),("dCOGS","dcogs")]
IND=[("maximizing","maximizing_satisficing"),("NFC","need_for_cognition"),("AOT","actively_open_minded_thinking"),("risk","risk_propensity_business"),("ambiguity","ambiguity_tolerance"),("promotion","regulatory_focus_promotion"),("CFC","consideration_future_consequences"),("action","action_orientation"),("age","age"),("male","male"),("grad","grad"),("finance","fin"),("mkt/sales fn","mkt"),("读法:盯成本","rh_cost"),("读法:盯功能","rh_feature")]
print("\n== persona 指标 × 结果 (r, *p<.05 **p<.01), n=%d 运行 (5 轮 × 42, 28 人)"%len(rows))
print("indicator".ljust(14)+"".join(o[0].rjust(10) for o in OUT))
for nm,k in IND:
    cells=[]
    for on,ok in OUT:
        r,n=pear([row[k] for row in rows],[row[ok] for row in rows]); p=pval(r,n); cells.append(f"{r:+.2f}{'**' if p<.01 else '*' if p<.05 else ''}".rjust(10))
    print(nm.ljust(14)+"".join(cells))
print("\n== 过程/决策指标 × 结果")
PROC=[("COST","cost"),("ToB","toB"),("老人","elder"),("儿童","child"),("Experience","exp"),("卡数","cards"),("high档卡","high"),("low档卡","low"),("dCOGS","dcogs"),("NRE","nre"),("价格","price"),("价格/WTPref","price_wtp"),("毛利率","gm"),("单位毛利","unitMargin"),("coverCore","coverCore"),("超预算","overBudget"),("复杂度","complexity")]
OUT2=[("loss","loss"),("profit","profit"),("units","units")]
print("indicator".ljust(14)+"".join(o[0].rjust(10) for o in OUT2))
for nm,k in PROC:
    cells=[]
    for on,ok in OUT2:
        r,n=pear([row[k] for row in rows],[row[ok] for row in rows]); p=pval(r,n); cells.append(f"{r:+.2f}{'**' if p<.01 else '*' if p<.05 else ''}".rjust(10))
    print(nm.ljust(14)+"".join(cells))
# patterns: loss rate by strategy x cards tercile x price/WTP
print("\n== 亏损率分格：战略 × 卡数 (≤12 / 13-15 / ≥16)")
for strat in [True,False]:
    for lo,hi,lab in [(0,12,"≤12"),(13,15,"13-15"),(16,99,"≥16")]:
        R=[r for r in rows if r["cost"]==strat and lo<=r["cards"]<=hi]
        if R: print(f"  {'COST' if strat else 'DIFF'} 卡{lab}: n={len(R)} 亏={sum(r['loss'] for r in R)/len(R):.2f} 利润={st.mean(r['profit'] for r in R):.0f} 价格={st.mean(r['price'] for r in R):.0f} dCOGS={st.mean(r['dcogs'] for r in R):.0f}")
print("\n== 亏损率分格：市场 × 战略")
for g in sorted(set((r['toB'],r['elder'],r['child'],r['cost']) for r in rows)):
    R=[r for r in rows if (r['toB'],r['elder'],r['child'],r['cost'])==g]
    if len(R)>=5: print(f"  {'ToB' if g[0] else 'ToC'}/{'老人' if g[1] else '儿童' if g[2] else '成人'}/{'COST' if g[3] else 'DIFF'}: n={len(R)} 亏={sum(r['loss'] for r in R)/len(R):.2f} 利润={st.mean(r['profit'] for r in R):.0f} 卡={st.mean(r['cards'] for r in R):.1f} 价={st.mean(r['price'] for r in R):.0f}")
# person-level: mean loss per persona vs traits (28 persons)
print("\n== 人级（28 人均值）: 特质 × 亏损率/卡数/COST")
by=collections.defaultdict(list)
for r in rows: by[r["pid"]].append(r)
P=[{"loss":st.mean(x["loss"] for x in v),"cards":st.mean(x["cards"] for x in v),"cost":st.mean(x["cost"] for x in v),"profit":st.mean(x["profit"] for x in v),**{k:v[0][k] for k in DIMS+["age","male","grad","fin","mkt","rh_cost","rh_feature"]}} for v in by.values()]
for nm,k in IND:
    cells=[]
    for on,ok in [("loss","loss"),("cards","cards"),("COST","cost"),("profit","profit")]:
        r,n=pear([p[k] for p in P],[p[ok] for p in P]); pv=pval(r,n); cells.append(f"{r:+.2f}{'**' if pv<.01 else '*' if pv<.05 else ''}".rjust(10))
    print(nm.ljust(14)+"".join(cells))
json.dump(rows,open(os.environ.get("S","/tmp")+"/solo_mining_rows.json","w"))
