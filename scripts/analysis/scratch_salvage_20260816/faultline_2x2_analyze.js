const fs=require("fs"),path=require("path");
const POOL=JSON.parse(fs.readFileSync("data/task_blind_persona_pipeline_v1/v2_faultline_pool541_20260816/persona_pool_task_blind_narrative_v1.json","utf8"));
const byId=new Map(POOL.map(r=>[r.persona_id,r]));
const fin=id=>/财务/.test(byId.get(id)?.frozen_facts?.career_context||"")?1:0;
const dirs=[];for(const b of fs.readdirSync("data/synthetic/team_sim").filter(x=>/^faultline2x2_r2B_rep[12]_/.test(x)))for(const d of fs.readdirSync(path.join("data/synthetic/team_sim",b)))dirs.push(path.join("data/synthetic/team_sim",b,d));
const sd=a=>{const m=a.reduce((x,y)=>x+y,0)/a.length;return Math.sqrt(a.reduce((s,v)=>s+(v-m)**2,0)/a.length);};
const rows=[];
for(const dir of dirs){const need=["run_meta.json","settlement.json","d5_persona_layer.jsonl","r1_actor_isolated_state.json"];if(!need.every(f=>fs.existsSync(path.join(dir,f))))continue;
  const m=JSON.parse(fs.readFileSync(path.join(dir,"run_meta.json"),"utf8")),s=JSON.parse(fs.readFileSync(path.join(dir,"settlement.json"),"utf8"));
  // fixed_team info from source R1 run_meta
  const srcMeta=JSON.parse(fs.readFileSync(path.join(m.replay_from||m.source_dir||"", "run_meta.json").replace(/^\/?/,""),"utf8"));
  const ft=srcMeta.fixed_team||{};const ids=m.profile_ids,leader=m.leader_id;
  const pl=fs.readFileSync(path.join(dir,"d5_persona_layer.jsonl"),"utf8").split("\n").filter(Boolean).map(l=>JSON.parse(l));const priv=new Map(pl.map(x=>[x.member_id,x.private_stage||{}]));
  const prices=ids.map(id=>Number(priv.get(id)?.price)).filter(Number.isFinite);const actions=ids.map(id=>priv.get(id)?.action||"");const nB=actions.filter(a=>/抬高|B/.test(a)).length;
  const teamPrice=Number(typeof s.r2_price==="object"?s.r2_price?.price:s.r2_price);const owners=ids.filter(id=>Number(priv.get(id)?.price)===teamPrice);
  const majIds=ids.slice(0,3); // construction: first 3 = majority subgroup (aligned cells)
  const r1=JSON.parse(fs.readFileSync(path.join(dir,"r1_actor_isolated_state.json"),"utf8"));const turns=r1.turns||[];
  // majority-subgroup private price mean vs minority
  const g=(arr)=>arr.map(id=>Number(priv.get(id)?.price)).filter(Number.isFinite);const a=g(ids.slice(0,3)),b=g(ids.slice(3));
  rows.push({cell:ft.cell,surf:ft.surf_fau,deep:ft.deep_fau,leaderMaj:ft.leader_in_majority,fin:ids.reduce((x,id)=>x+fin(id),0),
    price:teamPrice,cards:(s.r2_cards||[]).length,profit:Number(s.profit),loss:s.profitable===false?1:0,cost:s.r1?.strategy==="COST"?1:0,coverCore:Number(s.r2?.coverCore),
    privSD:sd(prices),privRange:Math.max(...prices)-Math.min(...prices),actMinority:Math.min(nB,actions.length-nB),subgroupGap:(a.length&&b.length)?Math.abs(a.reduce((x,y)=>x+y,0)/a.length-b.reduce((x,y)=>x+y,0)/b.length):null,
    eqMember:owners.length?1:0,eqLeader:owners.includes(leader)?1:0,ownerMaj:owners.length?(owners.some(o=>majIds.includes(o))?1:0):null,
    r1Events:turns.length,r1Spoke:turns.filter(t=>t.entrance_decision==="speak").length,r1Forced:r1.timeout_forced_submission?1:0,dir});}
console.log("teams",rows.length,JSON.stringify(rows.reduce((c,r)=>(c[r.cell]=(c[r.cell]||0)+1,c),{})));
const cells=["strong_strong","strong_weak","weak_strong","weak_weak"];
const M=(arr,k)=>{const v=arr.map(r=>r[k]).filter(x=>x!==null&&Number.isFinite(x));return v.length?v.reduce((x,y)=>x+y,0)/v.length:NaN;};
const KEYS=[["n",null],["价格mean","price"],["价格SD",null],["卡数","cards"],["亏损率","loss"],["利润(万)","profit"],["COST份额","cost"],["coverCore","coverCore"],["私下价SD","privSD"],["私下价极差","privRange"],["动作少数派","actMinority"],["多数vs少数子组价差","subgroupGap"],["队价=某人私下价","eqMember"],["队价=组长私下价","eqLeader"],["价主在多数子组","ownerMaj"],["R1事件数","r1Events"],["R1开口","r1Spoke"],["R1强制提交","r1Forced"],["财务人数","fin"]];
console.log("\n指标".padEnd(18)+cells.map(c=>c.padStart(14)).join(""));
for(const [nm,k] of KEYS){const line=cells.map(c=>{const R=rows.filter(r=>r.cell===c);if(nm==="n")return String(R.length).padStart(14);if(nm==="价格SD")return sd(R.map(r=>r.price)).toFixed(0).padStart(14);let v=M(R,k);if(k==="profit")v=v/10000;return (Number.isFinite(v)?(Math.abs(v)<10?v.toFixed(2):v.toFixed(0)):"-").padStart(14);}).join("");console.log(nm.padEnd(18)+line);}
// main effects (2x2 marginal means) + simple t-tests
function ttest(a,b){const ma=a.reduce((x,y)=>x+y,0)/a.length,mb=b.reduce((x,y)=>x+y,0)/b.length;const va=a.reduce((s,v)=>s+(v-ma)**2,0)/(a.length-1),vb=b.reduce((s,v)=>s+(v-mb)**2,0)/(b.length-1);const se=Math.sqrt(va/a.length+vb/b.length);const t=(ma-mb)/se;const df=Math.min(a.length,b.length)-1;const p=2*(1-tcdf(Math.abs(t),df));return{diff:ma-mb,t,p};}
function tcdf(t,df){const x=df/(df+t*t);return 1-0.5*ibeta(x,df/2,0.5);}
function ibeta(x,a,b){const bt=(x===0||x===1)?0:Math.exp(lgamma(a+b)-lgamma(a)-lgamma(b)+a*Math.log(x)+b*Math.log(1-x));if(x<(a+1)/(a+b+2))return bt*betacf(x,a,b)/a;return 1-bt*betacf(1-x,b,a)/b;}
function betacf(x,a,b){let m,m2,aa,c=1,d=1-(a+b)*x/(a+1);if(Math.abs(d)<1e-30)d=1e-30;d=1/d;let h=d;for(m=1;m<=200;m++){m2=2*m;aa=m*(b-m)*x/((a+m2-1)*(a+m2));d=1+aa*d;if(Math.abs(d)<1e-30)d=1e-30;c=1+aa/c;if(Math.abs(c)<1e-30)c=1e-30;d=1/d;h*=d*c;aa=-(a+m)*(a+b+m)*x/((a+m2)*(a+m2+1));d=1+aa*d;if(Math.abs(d)<1e-30)d=1e-30;c=1+aa/c;if(Math.abs(c)<1e-30)c=1e-30;d=1/d;const del=d*c;h*=del;if(Math.abs(del-1)<3e-7)break;}return h;}
function lgamma(z){const g=7,C=[0.99999999999980993,676.5203681218851,-1259.1392167224028,771.32342877765313,-176.61502916214059,12.507343278686905,-0.13857109526572012,9.9843695780195716e-6,1.5056327351493116e-7];if(z<0.5)return Math.log(Math.PI/Math.sin(Math.PI*z))-lgamma(1-z);z-=1;let x=C[0];for(let i=1;i<g+2;i++)x+=C[i]/(z+i);const t=z+g+0.5;return 0.5*Math.log(2*Math.PI)+(z+0.5)*Math.log(t)-t+Math.log(x);}
console.log("\n主效应（强 − 弱），Welch t 检验：");
for(const [nm,k] of [["利润(万)","profit"],["亏损率","loss"],["卡数","cards"],["价格","price"],["私下价SD","privSD"],["动作少数派","actMinority"],["多数vs少数子组价差","subgroupGap"],["队价=组长私下价","eqLeader"],["价主在多数子组","ownerMaj"],["R1开口","r1Spoke"],["coverCore","coverCore"]]){
  const get=(pred)=>rows.filter(pred).map(r=>r[k]).filter(x=>x!==null&&Number.isFinite(x)).map(v=>k==="profit"?v/10000:v);
  const s=ttest(get(r=>r.cell.startsWith("strong_")),get(r=>r.cell.startsWith("weak_")));const d=ttest(get(r=>r.cell.endsWith("_strong")),get(r=>r.cell.endsWith("_weak")));
  console.log(nm.padEnd(18)+`表层强−弱 ${s.diff.toFixed(2).padStart(9)} (p=${s.p.toFixed(3)})   深层强−弱 ${d.diff.toFixed(2).padStart(9)} (p=${d.p.toFixed(3)})`);}
fs.writeFileSync(`${process.env.S}/faultline_2x2_rows.json`,JSON.stringify(rows));
