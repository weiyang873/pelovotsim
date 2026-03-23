import { useState, useMemo, useCallback } from "react";

const MC = ["#E8634A","#3B82C4","#2FAB6E","#D4A03C"];
const MN = ["李婷","张磊","王建国","陈晓萱"];
const DIMS = [
  {id:"interaction",l:"交互与表达",icon:"💬",c:"#D97706"},
  {id:"perception",l:"感知与理解",icon:"👁",c:"#7C3AED"},
  {id:"motion",l:"运动与导航",icon:"🦿",c:"#0891B2"},
  {id:"safety",l:"安全与信任",icon:"🛡",c:"#DC2626"},
  {id:"extend",l:"可扩展与连接",icon:"🔌",c:"#059669"},
  {id:"ops",l:"可运营与可维护",icon:"🔧",c:"#4F46E5"},
];
const ASGN = [
  {m:0,dims:["interaction","safety"],ps:"李婷,张磊"},
  {m:1,dims:["perception","motion"],ps:"王建国,陈晓萱"},
  {m:2,dims:["extend","ops"],ps:"李婷,陈晓萱"},
  {m:3,dims:["perception","interaction"],ps:"王建国,张磊"},
];
const RDR = {interaction:7.1,perception:7.2,motion:5.8,safety:6.5,extend:4.3,ops:5.0};
const JIN = {voice_basic:"T01-30%",persona_dialog:"T05-20%",emotion_recog:"T02 rsk",elder_mode:"T04-25%",family_guardian:"T04-25%",kids_mode:"T08 rsk",content_comply:"T08 rsk",cloud_update:"T07-30%",remote_diag:"T07-30%",cost_eng:"T09-40",connect_base:"T10-20%",skill_store:"T10-20%",basic_avoid:"T06 rsk",follow_mode:"T06 rsk",home_iot:"T03-20%",multi_device:"T03-20%",offline_mode:"T05 rsk"};

const mk = (t,r,cap,mt,x) => ({t,r,cap,mt:mt||null,x:!!x});
const CC = {
interaction:[
  {id:"voice_basic",n:"语音基础",tg:"语音交互,情感陪伴",b:[60,120,180],r:[.05,.08,.1],l:[1,2,3],s:[.01,.03,.04],d:[]},
  {id:"persona_dialog",n:"多轮对话个性化",tg:"情感陪伴,语音交互",b:[180,260,380],r:[.14,.18,.22],l:[3,4,6],s:[.05,.08,.1],d:[mk("high","req","cloud_update","mid",1)]},
  {id:"touch_hug",n:"触摸/拥抱交互",tg:"情感陪伴",b:[60,120,200],r:[.07,.1,.12],l:[1,2,2],s:[.02,.04,.05],d:[]},
  {id:"music_companion",n:"音乐播放陪伴",tg:"音乐,情感陪伴",b:[40,90,140],r:[.05,.07,.09],l:[1,2,3],s:[.03,.05,.06],d:[]},
  {id:"visual_expr",n:"视觉表达(OLED)",tg:"情感,表情显示",b:[60,220,340],r:[.06,.1,.14],l:[1,2,2],s:[.02,.03,.04],d:[mk("mid","exc","no_screen"),mk("high","exc","no_screen")]},
  {id:"style_pack",n:"表达风格包",tg:"情感,多轮对话",b:[30,80,140],r:[.04,.06,.08],l:[1,2,3],s:[.02,.04,.06],d:[mk("high","req","content_comply","mid",1)]},
  {id:"no_screen",n:"无屏降本(删OLED)",tg:"降本",b:[-120,-220,-300],r:[.1,.14,.18],l:[0,0,0],s:[-.01,-.02,-.02],cd:1,d:[mk("low","exc","visual_expr"),mk("mid","exc","visual_expr"),mk("high","exc","visual_expr")]},
],
perception:[
  {id:"percep_base",n:"基础感知",tg:"拍照,场景感知",b:[80,160,240],r:[.06,.09,.12],l:[1,2,3],s:[.01,.02,.03],d:[]},
  {id:"emotion_recog",n:"情绪识别",tg:"情绪识别,情感",b:[160,260,380],r:[.12,.16,.2],l:[2,4,6],s:[.04,.07,.09],d:[mk("low","req","percep_base","low"),mk("mid","req","percep_base","mid"),mk("high","req","percep_base","high"),mk("high","req","privacy_trust","mid",1)]},
  {id:"adaptive_learn",n:"自适应学习",tg:"个性化,记忆",b:[160,260,380],r:[.14,.2,.24],l:[3,5,7],s:[.05,.09,.12],d:[mk("mid","req","cloud_update","mid",1),mk("high","req","cloud_update","high",1)]},
  {id:"memory_album",n:"拍照/回忆",tg:"拍照,记忆回溯",b:[80,140,220],r:[.07,.09,.12],l:[2,3,4],s:[.03,.05,.06],d:[mk("high","req","privacy_trust","mid",1)]},
  {id:"scene_trigger",n:"场景识别触发",tg:"情感,场景感知",b:[60,120,200],r:[.08,.1,.14],l:[2,3,4],s:[.02,.04,.05],d:[]},
  {id:"recommend_eng",n:"个性化推荐",tg:"个性化推荐",b:[80,140,220],r:[.08,.1,.12],l:[2,3,4],s:[.04,.06,.08],d:[mk("high","req","content_comply","mid",1)]},
],
motion:[
  {id:"basic_avoid",n:"基础避障",tg:"碰撞保护,移动",b:[40,100,160],r:[.08,.1,.12],l:[1,2,3],s:[.01,.02,.02],d:[]},
  {id:"lidar_nav",n:"室内导航(LiDAR)",tg:"室内导航,移动",b:[260,380,480],r:[.16,.2,.22],l:[3,5,7],s:[.03,.04,.05],d:[mk("low","exc","no_lidar"),mk("mid","req","cloud_update","mid",1),mk("high","req","cloud_update","mid",1)]},
  {id:"auto_dock",n:"自动充电/回桩",tg:"自动充电",b:[80,140,220],r:[.08,.1,.12],l:[1,2,3],s:[.02,.03,.04],d:[]},
  {id:"follow_mode",n:"跟随/伴行",tg:"跟随陪伴",b:[60,120,200],r:[.1,.12,.15],l:[2,3,4],s:[.01,.02,.03],d:[mk("high","req","privacy_trust","mid",1)]},
  {id:"collision_prot",n:"碰撞/跌落保护",tg:"碰撞保护",b:[40,90,140],r:[.06,.07,.08],l:[1,2,2],s:[0,.01,.01],d:[]},
  {id:"no_lidar",n:"轻量降本(删LiDAR)",tg:"降本",b:[-120,-220,-300],r:[.18,.22,.26],l:[0,0,0],s:[-.01,-.02,-.03],cd:1,d:[mk("low","exc","lidar_nav"),mk("mid","exc","lidar_nav"),mk("high","exc","lidar_nav")]},
],
safety:[
  {id:"privacy_trust",n:"隐私与信任保障",tg:"安全,隐私保护",b:[60,140,220],r:[.06,.08,.1],l:[1,2,3],s:[.01,.02,.03],d:[]},
  {id:"family_guardian",n:"家庭监护",tg:"隐私,远程控制",b:[180,340,480],r:[.14,.24,.3],l:[2,4,6],s:[.03,.06,.08],d:[mk("low","req","privacy_trust","low"),mk("mid","req","privacy_trust","mid"),mk("high","req","privacy_trust","high"),mk("high","req","audit_log","mid")]},
  {id:"kids_mode",n:"儿童模式",tg:"儿童安全",b:[60,120,200],r:[.08,.1,.12],l:[1,2,3],s:[.03,.05,.06],d:[mk("mid","req","content_comply","mid"),mk("high","req","content_comply","high")]},
  {id:"elder_mode",n:"老人模式",tg:"远程,隐私",b:[80,160,260],r:[.1,.12,.16],l:[1,2,3],s:[.03,.04,.05],d:[mk("high","req","privacy_trust","mid")]},
  {id:"content_comply",n:"内容合规审核",tg:"安全,儿童安全",b:[60,120,180],r:[.06,.07,.08],l:[1,2,3],s:[.01,.02,.03],d:[]},
  {id:"audit_log",n:"可信日志/审计",tg:"安全,隐私",b:[40,90,140],r:[.05,.06,.07],l:[1,2,3],s:[.01,.02,.03],d:[]},
],
extend:[
  {id:"connect_base",n:"基础联网同步",tg:"OTA更新",b:[20,50,90],r:[.03,.04,.05],l:[1,1,2],s:[0,.01,.02],d:[]},
  {id:"mobile_app",n:"手机App联动",tg:"远程,家庭版",b:[40,90,140],r:[.05,.07,.09],l:[1,2,3],s:[.02,.03,.04],d:[mk("high","req","privacy_trust","mid",1)]},
  {id:"home_iot",n:"家庭IoT联动",tg:"智能家居",b:[60,120,200],r:[.08,.1,.12],l:[2,3,4],s:[.01,.02,.03],d:[mk("high","req","privacy_trust","mid",1)]},
  {id:"skill_store",n:"第三方插件",tg:"智能家居",b:[80,160,260],r:[.1,.14,.18],l:[2,3,4],s:[.02,.03,.05],d:[mk("mid","req","privacy_trust","mid",1),mk("high","req","privacy_trust","high",1)]},
  {id:"multi_device",n:"多设备协同",tg:"家庭版,远程",b:[60,120,180],r:[.08,.1,.12],l:[2,3,4],s:[.02,.03,.04],d:[mk("high","req","cloud_update","mid",1)]},
  {id:"offline_mode",n:"离线模式",tg:"断网可用",b:[40,90,140],r:[.05,.07,.09],l:[1,2,3],s:[-.01,-.01,-.02],d:[]},
],
ops:[
  {id:"cloud_update",n:"云端智更新",tg:"OTA更新",b:[60,120,200],r:[.08,.1,.12],l:[2,3,4],s:[.03,.06,.08],d:[]},
  {id:"remote_diag",n:"远程诊断",tg:"OTA更新",b:[40,90,140],r:[.06,.07,.08],l:[1,2,3],s:[.01,.02,.03],d:[]},
  {id:"qa_system",n:"质量体系",tg:"降风险",b:[40,90,140],r:[-.03,-.06,-.1],l:[0,0,0],s:[0,.01,.02],rd:1,d:[]},
  {id:"cost_eng",n:"成本工程",tg:"降本",b:[-60,-120,-200],r:[.05,.06,.08],l:[0,0,0],s:[0,0,0],cd:1,d:[]},
  {id:"sla_support",n:"客服/SLA",tg:"降风险",b:[40,90,140],r:[-.02,-.04,-.06],l:[0,0,0],s:[.01,.02,.03],rd:1,d:[]},
],
};
const ALL = Object.values(CC).flat();
const fc = (id) => ALL.find((c) => c.id === id);
const TI = {low:0,mid:1,high:2};
const TS = ["low","mid","high"];
const TL = {low:"基础",mid:"标准",high:"旗舰"};
const R1 = {gm:.553,P:12800,cogs:4200};
const BUD = Math.round(R1.cogs * 0.13);
const CAPMAX = 24;
const STEPS = ["R1回顾","维度分配","焦点访谈","个人选卡","团队合并","集体讨论","最终结果"];
const OTHER = {
  1:{percep_base:"mid",scene_trigger:"mid",basic_avoid:"mid",auto_dock:"mid"},
  2:{connect_base:"mid",mobile_app:"mid",cloud_update:"mid",remote_diag:"mid",cost_eng:"mid"},
  3:{emotion_recog:"high",percep_base:"high",persona_dialog:"mid",style_pack:"mid"},
};

const doCalc = (s) => {
  let c=0,l=0,r=0,sb=0,n=0;
  Object.entries(s).forEach(([id,t]) => {
    const cd = fc(id); if(!cd) return;
    const i = TI[t]; c+=cd.b[i]; l+=cd.l[i]; r+=cd.r[i]; sb+=cd.s[i]; n++;
  });
  return {cost:c,ld:l,rk:r,sb,cnt:n,gm:R1.gm-c/R1.P};
};

const doViols = (s,ph) => {
  const vs = []; const seen = {};
  Object.entries(s).forEach(([id,tier]) => {
    const c = fc(id); if(!c) return;
    c.d.forEach((dep) => {
      const app = dep.t===tier||(dep.r==="exc"&&TS.indexOf(dep.t)<=TS.indexOf(tier));
      if(!app) return;
      if(dep.x && ph==="ind") return;
      const key = [id,dep.cap].sort().join("-")+dep.r;
      if(seen[key]) return; seen[key]=true;
      const tn = fc(dep.cap); const tname = tn?tn.n:dep.cap;
      if(dep.r==="req"){
        const h=s[dep.cap];
        if(!h) vs.push(c.n+"("+tier+") → "+tname+"≥"+dep.mt+(dep.x?" [跨维度]":""));
        else if(TI[h]<TI[dep.mt]) vs.push(c.n+" → "+tname+"≥"+dep.mt+", 当前 "+h);
      }
      if(dep.r==="exc"&&s[dep.cap]) vs.push(c.n+" ✕ "+tname);
    });
  });
  return vs;
};

export default function App() {
  const [step, setStep] = useState(0);
  const [am, setAm] = useState(0);
  const [sel, setSel] = useState({});

  const ph = step <= 3 ? "ind" : "team";
  const myA = ASGN[am];

  const tog = useCallback((id) => {
    setSel((p) => {
      const n = {...p};
      if(n[id]) { delete n[id]; } else { n[id] = "mid"; }
      return n;
    });
  }, []);

  const stier = useCallback((id, t) => {
    setSel((p) => ({...p, [id]: t}));
  }, []);

  const tot = useMemo(() => doCalc(sel), [sel]);
  const vl = useMemo(() => doViols(sel, ph), [sel, ph]);

  const teamSel = useMemo(() => {
    if(step < 4) return sel;
    const m = {...sel};
    Object.entries(OTHER).forEach(([mi, cards]) => {
      if(parseInt(mi) !== am) {
        Object.entries(cards).forEach(([cid, t]) => {
          if(!m[cid]) m[cid] = t;
        });
      }
    });
    return m;
  }, [sel, am, step]);

  const tTot = useMemo(() => doCalc(teamSel), [teamSel]);
  const tVl = useMemo(() => doViols(teamSel, "team"), [teamSel]);

  const gcnt = useMemo(() => {
    const g = {};
    DIMS.forEach((d) => { g[d.id] = 0; });
    Object.keys(sel).forEach((id) => {
      Object.entries(CC).forEach(([gid, cards]) => {
        if(cards.find((c) => c.id === id)) g[gid]++;
      });
    });
    return g;
  }, [sel]);

  // ── Render Helpers ──

  const renderMetrics = (t, v) => {
    const overB = t.cost > BUD;
    const overC = t.ld > CAPMAX;
    return (
      <div style={{display:"flex",gap:6,flexWrap:"wrap",marginBottom:8}}>
        <div style={{flex:"1 1 220px",padding:"6px 10px",borderRadius:6,background:overB?"#FEF2F2":"#F0FDF4",border:overB?"1px solid #FECACA":"1px solid #BBF7D0"}}>
          <div style={{fontSize:11,display:"flex",justifyContent:"space-between"}}>
            <b style={{color:overB?"#991B1B":"#166534"}}>{overB?"⚠ 超预算":"✓ 预算内"}</b>
            <span>增量成本 <b>{t.cost>0?"+":""}{t.cost}</b>/{BUD}</span>
          </div>
          <div style={{width:"100%",height:5,borderRadius:3,background:"#e5e7eb",marginTop:2}}>
            <div style={{width:Math.min(Math.max(t.cost,0)/BUD*100,100)+"%",height:"100%",borderRadius:3,background:overB?"#EF4444":"#2FAB6E"}} />
          </div>
          <div style={{fontSize:10,marginTop:1}}>毛利 <b style={{color:t.gm<0?"#DC2626":"#166534"}}>{(t.gm*100).toFixed(1)}%</b></div>
        </div>
        <div style={{flex:"1 1 120px",padding:"6px 10px",borderRadius:6,background:overC?"#FEF2F2":"#F9FAFB",border:overC?"1px solid #FECACA":"1px solid #e5e7eb"}}>
          <div style={{fontSize:11}}><b>系统负载</b> {t.ld}/{CAPMAX}</div>
          <div style={{width:"100%",height:5,borderRadius:3,background:"#e5e7eb",marginTop:2}}>
            <div style={{width:Math.min(t.ld/CAPMAX*100,100)+"%",height:"100%",borderRadius:3,background:overC?"#EF4444":"#0891B2"}} />
          </div>
        </div>
        <div style={{flex:"0 0 auto",padding:"6px 10px",borderRadius:6,background:"#F9FAFB",border:"1px solid #e5e7eb",fontSize:11}}>
          已选 {t.cnt}/8-10 | 依赖问题 {v.length}
        </div>
      </div>
    );
  };

  const renderCard = (card, dim, sels, showCross) => {
    const isOn = !!sels[card.id];
    const tier = sels[card.id] || "mid";
    const ti = TI[tier];
    const bom = card.b[ti];
    const risk = card.r[ti];
    const load = card.l[ti];
    const jin = JIN[card.id];
    const rC = risk<0?"#2FAB6E":risk<.08?"#2FAB6E":risk<.15?"#D4A03C":"#EF4444";
    const rL = risk<0?"降险":risk<.08?"低":risk<.15?"中":"高";
    const bC = bom<0?"#2FAB6E":bom>200?"#DC2626":"#374151";

    const xdeps = isOn ? card.d.filter((dd) => dd.x && (dd.t===tier||(dd.r==="exc"&&TS.indexOf(dd.t)<=TS.indexOf(tier)))) : [];
    const sdeps = isOn ? card.d.filter((dd) => !dd.x && (dd.t===tier||(dd.r==="exc"&&TS.indexOf(dd.t)<=TS.indexOf(tier)))) : [];

    return (
      <div key={card.id} style={{padding:"10px 12px",borderRadius:10,position:"relative",border:isOn?("2px solid "+(card.cd?"#2FAB6E":dim.c)):"1.5px solid #e5e7eb",background:card.cd?"#fafff8":"#fff"}}>
        {card.cd && <div style={{position:"absolute",top:4,right:6,fontSize:9,fontWeight:700,padding:"1px 5px",borderRadius:3,background:"#DCFCE7",color:"#166534"}}>降本</div>}
        {card.rd && <div style={{position:"absolute",top:4,right:6,fontSize:9,fontWeight:700,padding:"1px 5px",borderRadius:3,background:"#DBEAFE",color:"#1E40AF"}}>降险</div>}
        {jin && <div style={{position:"absolute",top:(card.cd||card.rd)?20:4,right:6,fontSize:8,padding:"1px 4px",borderRadius:3,background:"#FEF3C7",color:"#92400E",border:"1px solid #FDE68A"}}>{jin}</div>}

        <div style={{display:"flex",gap:5,marginBottom:4,paddingRight:jin?80:50}}>
          <input type="checkbox" checked={isOn} onChange={() => tog(card.id)} style={{width:14,height:14,marginTop:1,cursor:"pointer"}} />
          <div>
            <div style={{fontSize:13,fontWeight:700,lineHeight:1.2}}>{card.n}</div>
            <div style={{fontSize:9,color:"#9ca3af"}}>{card.tg}</div>
          </div>
        </div>

        <div style={{marginLeft:19,display:"flex",gap:5,flexWrap:"wrap",marginBottom:4,alignItems:"center"}}>
          <span style={{fontSize:11,fontWeight:700,color:bC}}>{bom>0?"+":""}{bom}</span>
          <span style={{fontSize:9,fontWeight:700,padding:"1px 4px",borderRadius:3,background:rC+"18",color:rC}}>风险-{rL}</span>
          <span style={{fontSize:10,color:load>=4?"#D97706":"#6b7280"}}>负载 {load}</span>
        </div>

        <div style={{marginLeft:19,display:"flex",gap:4}}>
          {TS.map((tt) => {
            const active = tier===tt && isOn;
            const ac = card.cd ? "#2FAB6E" : dim.c;
            return (
              <button key={tt} onClick={() => { if(isOn) stier(card.id, tt); }} style={{
                padding:"2px 10px",borderRadius:4,fontSize:10,fontWeight:600,cursor:isOn?"pointer":"default",
                border:active?("2px solid "+ac):"1px solid #d1d5db",
                background:active?(ac+"10"):"#fff",
                color:active?ac:"#aaa",opacity:isOn?1:.4
              }}>
                {TL[tt]}({card.b[TI[tt]]>0?"+":""}{card.b[TI[tt]]})
              </button>
            );
          })}
        </div>

        {showCross && xdeps.length > 0 && (
          <div style={{marginTop:4,marginLeft:19,padding:"3px 6px",borderRadius:4,background:"#EFF6FF",border:"1px solid #BFDBFE"}}>
            {xdeps.map((dd, i) => {
              const tn = fc(dd.cap);
              return (
                <div key={i} style={{fontSize:10,color:"#1E40AF"}}>
                  {"→ "}{dd.r==="req" ? ("需要 "+(tn?tn.n:dd.cap)+"≥"+dd.mt) : ("✕ "+(tn?tn.n:dd.cap))} [其他成员负责]
                </div>
              );
            })}
          </div>
        )}

        {sdeps.map((dd, i) => {
          const tn = fc(dd.cap);
          const tname = tn ? tn.n : dd.cap;
          const sat = dd.r==="req" ? (sels[dd.cap] && TI[sels[dd.cap]]>=TI[dd.mt]) : !sels[dd.cap];
          return (
            <div key={i} style={{marginTop:2,marginLeft:19,fontSize:10,color:sat?"#2FAB6E":"#DC2626"}}>
              {dd.r==="req" ? ("→ 需要 "+tname+"≥"+dd.mt) : ("✕ "+tname)} {sat?"✓":"!!"}
            </div>
          );
        })}
      </div>
    );
  };

  const renderDimGroup = (dimId, sels, showCross) => {
    const dim = DIMS.find((d) => d.id === dimId);
    const cards = CC[dimId] || [];
    const cnt = cards.filter((c) => !!sels[c.id]).length;
    return (
      <div key={dimId} style={{marginBottom:4}}>
        <div style={{display:"flex",justifyContent:"space-between",padding:"7px 14px",background:dim.c+"12",borderBottom:"3px solid "+dim.c}}>
          <span style={{fontSize:14,fontWeight:800}}>{dim.icon} {dim.l}</span>
          <span style={{fontSize:12,fontWeight:700,color:dim.c}}>雷达{RDR[dimId]} | {cnt}/1-3</span>
        </div>
        <div style={{display:"grid",gap:6,padding:8,gridTemplateColumns:"repeat(auto-fill,minmax(280px,1fr))",background:"#fff",border:"1px solid "+dim.c+"15",borderTop:"none"}}>
          {cards.map((card) => renderCard(card, dim, sels, showCross))}
        </div>
      </div>
    );
  };

  const BS = {marginTop:10,width:"100%",padding:"10px",borderRadius:10,background:"#1a5c3a",color:"#fff",border:"none",fontSize:14,fontWeight:700,cursor:"pointer"};

  return (
    <div style={{fontFamily:"'Noto Sans SC',-apple-system,sans-serif",background:"#fafaf8",minHeight:"100vh",padding:"14px 12px"}}>
    <div style={{maxWidth:1060,margin:"0 auto"}}>
      <h1 style={{fontSize:18,fontWeight:800,margin:"0 0 2px"}}>Round 2 - 用户访谈 + 研发选卡</h1>

      {/* Step bar */}
      <div style={{display:"flex",alignItems:"center",margin:"8px 0 16px"}}>
        {STEPS.map((s, i) => (
          <div key={i} style={{display:"flex",alignItems:"center",flex:i<6?1:"none"}}>
            <div onClick={() => setStep(i)} style={{
              width:28,height:28,borderRadius:"50%",display:"flex",alignItems:"center",justifyContent:"center",
              fontSize:11,fontWeight:700,cursor:"pointer",
              background:i<=step?"#1a5c3a":"#e5e7eb",color:i<=step?"#fff":"#aaa",
              boxShadow:i===step?"0 0 0 3px #1a5c3a33":"none"
            }}>{i+1}</div>
            {i < 6 && <div style={{flex:1,height:2,margin:"0 2px",background:i<step?"#1a5c3a":"#e5e7eb"}} />}
          </div>
        ))}
        <span style={{marginLeft:8,fontSize:11,fontWeight:600,color:"#6b7280"}}>{STEPS[step]}</span>
      </div>

      {/* Step 0: R1 Recap — mirrors phase4 output structure */}
      {step === 0 && (
        <div style={{background:"#fff",borderRadius:14,padding:20,border:"1px solid #e5e7eb"}}>
          <h2 style={{fontSize:16,fontWeight:800,margin:"0 0 12px"}}>Round 1 决策回顾</h2>

          {/* Team positioning banner */}
          <div style={{padding:"14px 18px",borderRadius:12,background:"linear-gradient(135deg,#065f46,#14532d)",color:"#fff",marginBottom:14}}>
            <div style={{fontSize:10,opacity:.7}}>最终定位 (final_grid_id + architecture)</div>
            <div style={{fontSize:20,fontWeight:800,marginTop:2}}>ToB · 差异化 · 老人 · 体验型</div>
            <div style={{fontSize:11,opacity:.85,marginTop:6,lineHeight:1.5}}>VP: 为养老机构提供"有温度的安全守护"——情感陪伴 + 跌倒检测 + 情绪预警，让护工从重复巡视中解放</div>
          </div>

          {/* Margin Headroom card */}
          <div style={{padding:"14px 16px",borderRadius:10,background:"#F0FDF4",border:"1.5px solid #BBF7D0",marginBottom:8}}>
            <div style={{fontSize:10,color:"#6b7280"}}>利润空间（Margin Headroom）</div>
            <div style={{display:"flex",alignItems:"baseline",gap:8,marginTop:2}}>
              <span style={{fontSize:26,fontWeight:800,color:"#166534"}}>55%–65%</span>
              <span style={{fontSize:14,fontWeight:700,color:"#166534"}}>· 宽裕</span>
            </div>
            <div style={{fontSize:11,color:"#374151",marginTop:4}}>你的战略定位留出了充足的利润上限空间</div>
          </div>

          {/* Market Space card */}
          <div style={{padding:"14px 16px",borderRadius:10,background:"#EFF6FF",border:"1.5px solid #BFDBFE",marginBottom:8}}>
            <div style={{fontSize:10,color:"#6b7280"}}>Market Space（市场空间）</div>
            <div style={{display:"flex",alignItems:"baseline",gap:10,marginTop:2}}>
              <span style={{fontSize:26,fontWeight:800,color:"#1E40AF"}}>S（小）</span>
              <span style={{fontSize:12,fontWeight:600,color:"#9CA3AF"}}>进入难度：低</span>
            </div>
            <div style={{fontSize:11,color:"#374151",marginTop:4}}>利润空间与市场规模通常存在对冲关系：利基市场利润高但基数窄</div>
          </div>

          {/* VP Scores */}
          <div style={{padding:"12px 16px",borderRadius:10,background:"#F9FAFB",border:"1px solid #e5e7eb",marginBottom:8}}>
            <div style={{fontSize:12,fontWeight:700,marginBottom:6}}>VP 战略评估</div>
            <div style={{display:"flex",gap:20}}>
              {[["覆盖率 (C)", 5], ["可泛化率 (G)", 4], ["有效性 (E)", 4]].map(([label, score]) => (
                <div key={label}>
                  <div style={{fontSize:10,color:"#6b7280",marginBottom:3}}>{label}</div>
                  <div style={{display:"flex",gap:2}}>
                    {[1,2,3,4,5].map((i) => (
                      <div key={i} style={{width:18,height:10,borderRadius:2,background:i <= score ? "#1a5c3a" : "#e5e7eb"}} />
                    ))}
                  </div>
                </div>
              ))}
            </div>
            <div style={{fontSize:11,color:"#374151",marginTop:6}}>可占容量份额：<b>大</b> ｜ 溢价能力：<b>强</b></div>
          </div>

          {/* Jinang activation */}
          <div style={{padding:"12px 16px",borderRadius:10,background:"#F0FDF4",border:"1.5px solid #BBF7D0",marginBottom:8}}>
            <div style={{fontSize:12,fontWeight:700,color:"#166534",marginBottom:6}}>锦囊激活（2/2 张命中）</div>
            <div style={{padding:"6px 10px",borderRadius:6,background:"#fff",border:"1px solid #BBF7D0",marginBottom:4,fontSize:11}}>
              <b style={{color:"#166534"}}>社群运营与口碑裂变</b>：高度契合（契合度 0.78）
            </div>
            <div style={{padding:"6px 10px",borderRadius:6,background:"#fff",border:"1px solid #BBF7D0",marginBottom:4,fontSize:11}}>
              <b style={{color:"#166534"}}>自然语言交互</b>：高度契合（契合度 0.87）<span style={{color:"#D97706",marginLeft:4}}>（Round 2 生效）</span>
            </div>
            <div style={{fontSize:11,color:"#6b7280",marginTop:4}}>渠道结构：DIRECT 60% / ECOMMERCE 40%</div>
          </div>

          {/* R2 key params */}
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr 1fr",gap:6,marginBottom:10}}>
            {[["target_gm","55.3%","#2FAB6E"],["Pmax","12,800","#3B82C4"],["COGSbase","4,200","#D4A03C"],["渠道费率","12.4%","#8B5CF6"]].map(([label,val,clr]) => (
              <div key={label} style={{padding:8,borderRadius:8,border:"1.5px solid "+clr+"40",background:clr+"08"}}>
                <div style={{fontSize:9,color:"#6b7280"}}>{label}</div>
                <div style={{fontSize:18,fontWeight:800,color:clr}}>{val}</div>
              </div>
            ))}
          </div>

          {/* Budget warning */}
          <div style={{padding:"8px 12px",borderRadius:8,background:"#FEF3C7",border:"1px solid #FDE68A",fontSize:11,color:"#92400E"}}>
            Round 2 预算上限 = <b>{BUD}元</b>（COGSbase x 0.13）。技术锦囊「自然语言交互」将降低语音/对话卡 dCOGS 20%
          </div>

          {/* Frozen banner */}
          <div style={{marginTop:12,padding:"14px 18px",borderRadius:12,background:"#1e293b",color:"#fff",textAlign:"center"}}>
            <div style={{fontSize:14,fontWeight:700}}>Round 1 完成 · target_gm 已冻结</div>
            <div style={{fontSize:11,opacity:.7,marginTop:2}}>进入 Round 2 后将基于此定位进行访谈和 R&D 选卡</div>
            <button onClick={() => setStep(1)} style={{marginTop:10,padding:"8px 28px",borderRadius:8,background:"#fff",color:"#1e293b",border:"none",fontSize:14,fontWeight:700,cursor:"pointer"}}>进入 Round 2 →</button>
          </div>
        </div>
      )}

      {/* Step 1 */}
      {step === 1 && (
        <div style={{background:"#fff",borderRadius:14,padding:20,border:"1px solid #e5e7eb"}}>
          <h2 style={{fontSize:16,fontWeight:800,margin:"0 0 10px"}}>维度分配</h2>
          {ASGN.map((a) => (
            <div key={a.m} onClick={() => setAm(a.m)} style={{
              display:"flex",alignItems:"center",gap:6,padding:"8px 10px",borderRadius:8,marginBottom:4,cursor:"pointer",
              background:am===a.m?(MC[a.m]+"10"):"#fafafa",border:am===a.m?("2px solid "+MC[a.m]+"60"):"1px solid #f3f4f6"
            }}>
              <div style={{width:20,height:20,borderRadius:"50%",background:MC[a.m],color:"#fff",display:"flex",alignItems:"center",justifyContent:"center",fontSize:9,fontWeight:700}}>{String.fromCharCode(65+a.m)}</div>
              <span style={{fontSize:12,fontWeight:600,minWidth:40}}>{MN[a.m]}</span>
              <div style={{display:"flex",gap:3,flex:1}}>
                {a.dims.map((d) => {
                  const dm = DIMS.find((x) => x.id === d);
                  return (
                    <span key={d} style={{fontSize:10,fontWeight:600,padding:"2px 5px",borderRadius:4,background:dm.c+"15",color:dm.c}}>{dm.icon} {dm.l.slice(0,2)}</span>
                  );
                })}
              </div>
              <span style={{fontSize:10,color:"#9ca3af"}}>{a.ps}</span>
            </div>
          ))}
          <button onClick={() => setStep(2)} style={BS}>以 {MN[am]} 身份进入</button>
        </div>
      )}

      {/* Step 2 */}
      {step === 2 && (
        <div style={{background:"#fff",borderRadius:14,padding:20,border:"1px solid #e5e7eb"}}>
          <h2 style={{fontSize:16,fontWeight:800,margin:"0 0 8px"}}>焦点小组访谈</h2>
          <div style={{border:"1.5px solid #e5e7eb",borderRadius:10,marginBottom:12}}>
            {[
              {n:"李婷",c:"#2FAB6E",t:"我希望它能感知情绪。简单的语音回应就很治愈。跌倒检测是必须的。"},
              {n:"张磊",c:"#9CA3AF",t:"太多语音会烦人。安全是硬性要求——数据要留在本地，跌倒检测精度要高。"},
              {n:"李婷",c:"#2FAB6E",t:"表情和肢体语言比语音更重要。手势交互感觉更自然。"},
              {n:"张磊",c:"#9CA3AF",t:"同意。但高级功能要花钱。还是先把核心安全做好。"},
            ].map((m, i) => (
              <div key={i} style={{padding:"8px 12px",borderBottom:i<3?"1px solid #f3f4f6":"none"}}>
                <span style={{fontSize:11,fontWeight:700,color:m.c}}>{m.n}</span>
                <div style={{fontSize:12,color:"#374151",marginTop:2,lineHeight:1.5}}>{m.t}</div>
              </div>
            ))}
          </div>
          <div style={{padding:"6px 10px",borderRadius:6,background:"#F0FDF4",border:"1px solid #BBF7D0",fontSize:11,color:"#166534"}}>
            访谈完成。雷达评分已生成，请开始选卡。
          </div>
          <button onClick={() => setStep(3)} style={BS}>开始选卡</button>
        </div>
      )}

      {/* Step 3: Individual */}
      {step === 3 && (
        <div>
          <div style={{background:"#fff",padding:"12px 16px",borderRadius:"14px 14px 0 0",border:"1px solid #e5e7eb",borderBottom:"none"}}>
            <h2 style={{fontSize:16,fontWeight:800,margin:"0 0 4px"}}>个人选卡（{MN[am]}）</h2>
            <div style={{fontSize:11,color:"#9ca3af"}}>Your dims only. Cross-dim deps = blue info, not enforced.</div>
          </div>
          <div style={{background:"#fff",padding:"6px 16px 10px",border:"1px solid #e5e7eb",borderTop:"none",borderRadius:"0 0 14px 14px"}}>
            {renderMetrics(tot, vl)}
          </div>
          {myA.dims.map((dimId) => renderDimGroup(dimId, sel, true))}
          <button onClick={() => setStep(4)} style={BS}>提交，等待队友</button>
        </div>
      )}

      {/* Step 4: Team Merge */}
      {step === 4 && (
        <div style={{background:"#fff",borderRadius:14,padding:20,border:"1px solid #e5e7eb"}}>
          <h2 style={{fontSize:16,fontWeight:800,margin:"0 0 6px"}}>团队合并 - 预算影响</h2>
          {renderMetrics(tTot, tVl)}
          {tVl.length > 0 && (
            <div style={{padding:"8px 12px",borderRadius:8,background:"#FEF2F2",border:"1px solid #FECACA",marginBottom:10}}>
              <div style={{fontSize:12,fontWeight:700,color:"#991B1B",marginBottom:4}}>Dep Issues ({tVl.length})</div>
              {tVl.slice(0,5).map((v,i) => (
                <div key={i} style={{fontSize:11,color:"#7F1D1D"}}>- {v}</div>
              ))}
            </div>
          )}
          {DIMS.map((dim) => {
            const cards = CC[dim.id] || [];
            const picked = cards.filter((c) => !!teamSel[c.id]);
            if(picked.length === 0) {
              return (
                <div key={dim.id} style={{fontSize:11,color:"#aaa",padding:"4px 0"}}>{dim.icon} {dim.l}: none</div>
              );
            }
            return (
              <div key={dim.id} style={{marginBottom:6,padding:"6px 10px",borderRadius:8,background:dim.c+"06",border:"1px solid "+dim.c+"20"}}>
                <div style={{fontSize:12,fontWeight:700,color:dim.c,marginBottom:4}}>{dim.icon} {dim.l}</div>
                {picked.map((card) => {
                  const t = teamSel[card.id];
                  const bom = card.b[TI[t]];
                  let who = am;
                  Object.keys(OTHER).forEach((mi) => { if(OTHER[mi][card.id]) who = parseInt(mi); });
                  return (
                    <div key={card.id} style={{display:"flex",alignItems:"center",gap:6,fontSize:11,padding:"2px 0"}}>
                      <div style={{width:16,height:16,borderRadius:"50%",background:MC[who],color:"#fff",display:"flex",alignItems:"center",justifyContent:"center",fontSize:8,fontWeight:700}}>{String.fromCharCode(65+who)}</div>
                      <span style={{flex:1}}>{card.n}</span>
                      <span style={{fontSize:10,padding:"1px 5px",borderRadius:3,background:"#f3f4f6"}}>{t}</span>
                      <span style={{fontWeight:700,color:bom<0?"#2FAB6E":bom>200?"#DC2626":"#374151"}}>{bom>0?"+":""}{bom}</span>
                    </div>
                  );
                })}
              </div>
            );
          })}
          <button onClick={() => setStep(5)} style={{...BS,background:"#DC2626"}}>进入集体讨论</button>
        </div>
      )}

      {/* Step 5: Discussion */}
      {step === 5 && (
        <div>
          <div style={{background:"#fff",borderRadius:14,padding:"16px 20px",border:"1px solid #e5e7eb",marginBottom:4}}>
            <h2 style={{fontSize:16,fontWeight:800,margin:"0 0 6px"}}>集体讨论</h2>
            <div style={{fontSize:11,color:"#9ca3af",marginBottom:8}}>All dims. Uncheck or downgrade to fix budget/load/deps.</div>
            {renderMetrics(tTot, tVl)}
          </div>
          {DIMS.map((dim) => renderDimGroup(dim.id, teamSel, false))}
          <button onClick={() => setStep(6)} style={{...BS,background:(tVl.length===0 && tTot.cnt>=8 && tTot.cnt<=10)?"#1a5c3a":"#d1d5db"}}>
            {tVl.length>0 ? ("修复 "+tVl.length+" 个依赖") : tTot.cnt<8 ? ("还需 "+(8-tTot.cnt)+" 张") : "确认提交"}
          </button>
        </div>
      )}

      {/* Step 6: Results */}
      {step === 6 && (
        <div style={{background:"#fff",borderRadius:14,padding:20,border:"1px solid #e5e7eb"}}>
          <h2 style={{fontSize:16,fontWeight:800,margin:"0 0 12px"}}>Round 2 最终结果</h2>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr 1fr 1fr",gap:8,marginBottom:16}}>
            {[["渗透率","18.2%","#2FAB6E"],["销量","1820","#3B82C4"],["硬件利润","4982","#8B5CF6"],["订阅LTV","227","#D97706"],["总利润","1.30M","#1a5c3a"]].map(([label,val,clr]) => (
              <div key={label} style={{padding:10,borderRadius:10,border:"1.5px solid "+clr+"30",background:clr+"08"}}>
                <div style={{fontSize:9,color:"#6b7280"}}>{label}</div>
                <div style={{fontSize:20,fontWeight:800,color:clr}}>{val}</div>
              </div>
            ))}
          </div>
          <div style={{padding:"14px 18px",borderRadius:12,background:"#1e293b",color:"#fff",textAlign:"center"}}>
            <div style={{fontSize:14,fontWeight:700}}>Round 2 Complete</div>
            <div style={{fontSize:11,opacity:.7}}>AI reflection report generating...</div>
          </div>
        </div>
      )}

    </div>
    </div>
  );
}
