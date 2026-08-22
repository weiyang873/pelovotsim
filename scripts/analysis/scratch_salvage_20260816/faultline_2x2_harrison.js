const fs=require("fs");
const A0=JSON.parse(fs.readFileSync("data/task_blind_persona_pipeline_v1/v2_faultline_pool200_20260816/persona_pool_task_blind_narrative_v1.json","utf8")).map(r=>({...r,persona_id:"A"+r.persona_id}));
const B0=JSON.parse(fs.readFileSync("data/task_blind_persona_pipeline_v1/v2_faultline_pool200b_20260816/persona_pool_task_blind_narrative_v1.json","utf8")).map(r=>({...r,persona_id:"B"+r.persona_id}));
const C0=JSON.parse(fs.readFileSync("data/task_blind_persona_pipeline_v1/v2_faultline_pool200c_20260816/persona_pool_task_blind_narrative_v1.json","utf8")).map(r=>({...r,persona_id:"C"+r.persona_id}));
const P=[...A0,...B0,...C0];
const med=k=>{const v=P.map(r=>r.behavioral_fingerprint[k]).sort((a,b)=>a-b);return v[Math.floor(v.length/2)];};
const MR=med("risk_propensity_business"),MP=med("regulatory_focus_promotion"),MA=med("actively_open_minded_thinking");
const A=P.map(r=>{const s=r.surface,c=r.frozen_facts.career_context;const fn=(c.match(/主要职能是([^，,。；;]+)/)||[])[1]||"";
 return {id:r.persona_id,name:s.name,age:s.age,gender:s.gender,fn,ind:s.industry,young:s.age<=42?1:s.age>=48?0:-1,male:s.gender==="male"?1:0,ret:s.overseas.hasOverseas?1:0,grad:/硕士/.test(s.edu)?1:0,newind:s.industry_type==="新兴"?1:0,fin:/财务/.test(fn)?1:0,
  hiRisk:r.behavioral_fingerprint.risk_propensity_business>MR?1:0,hiPromo:r.behavioral_fingerprint.regulatory_focus_promotion>MP?1:0,hiAot:r.behavioral_fingerprint.actively_open_minded_thinking>MA?1:0};});
function fau(team,keys){const n=team.length,cols=keys.map(k=>team.map(m=>m[k]));const means=cols.map(c=>c.reduce((a,b)=>a+b,0)/n);const tot=cols.reduce((s,c,j)=>s+c.reduce((a,x)=>a+(x-means[j])**2,0),0);if(!tot)return 0;let best=0;for(let mask=1;mask<(1<<n)-1;mask++){const g1=[],g2=[];for(let i=0;i<n;i++)(mask>>i&1?g1:g2).push(i);if(g1.length<2||g2.length<2)continue;let b=0;for(let j=0;j<cols.length;j++){const m1=g1.reduce((a,i)=>a+cols[j][i],0)/g1.length,m2=g2.reduce((a,i)=>a+cols[j][i],0)/g2.length;b+=g1.length*(m1-means[j])**2+g2.length*(m2-means[j])**2;}best=Math.max(best,b/tot);}return best;}
const SURF=["young","male"],DEEP=["hiRisk","hiPromo","hiAot"];
const use=A.filter(a=>a.young>=0);
console.log("pool",P.length,"usable(age ends)",use.length);
let seed=23;const rnd=()=>{seed=(seed*48271)%2147483647;return seed/2147483647;};
const shuffle=a=>[...a].sort(()=>rnd()-.5);
const useCount=new Map();const MAXUSE=3;
const avail=(a)=>(useCount.get(a.id)||0)<MAXUSE;
const take=t=>t.forEach(m=>useCount.set(m.id,(useCount.get(m.id)||0)+1));
const distinctInd=t=>new Set(t.map(m=>m.ind)).size===t.length&&new Set(t.map(m=>m.name)).size===t.length;
const comp=p=>[...p].map(x=>x==="1"?"0":"1").join("");
const pat=(a,keys)=>keys.map(k=>a[k]).join("");
// single-team builders (return one team or null), preferring least-used persons
const byUse=arr=>shuffle(arr).sort((a,b)=>(useCount.get(a.id)||0)-(useCount.get(b.id)||0));
function oneStrongStrong(){const KEYS=[...SURF,...DEEP];const g={};for(const a of use.filter(avail))(g[pat(a,KEYS)]=g[pat(a,KEYS)]||[]).push(a);
  for(const p of shuffle(Object.keys(g))){const q=comp(p);if(!g[q])continue;const G=byUse(g[p]),H=byUse(g[q]);if(G.length<3||H.length<2)continue;
    for(let i=0;i+3<=G.length;i++){for(let j=0;j+2<=H.length;j++){const t=[...G.slice(i,i+3),...H.slice(j,j+2)];if(distinctInd(t))return t;}}}return null;}
function oneStrongWeak(){const g={};for(const a of use.filter(avail))(g[pat(a,SURF)]=g[pat(a,SURF)]||[]).push(a);
  for(let k=0;k<100000;k++){const p=shuffle(Object.keys(g))[0],q=comp(p);if(!g[q])continue;const G=byUse(g[p]).slice(0,40),H=byUse(g[q]).slice(0,30);if(G.length<3||H.length<2)continue;
    const t=[...shuffle(G).slice(0,3),...shuffle(H).slice(0,2)];if(!distinctInd(t))continue;
    if(!DEEP.every(kk=>{const s=t.reduce((x,m)=>x+m[kk],0);return s===2||s===3;}))continue;if(fau(t,DEEP)>0.5)continue;
    if(DEEP.some(kk=>{const s=t.slice(0,3).reduce((x,m)=>x+m[kk],0);return s===0||s===3;}))continue;return t;}return null;}
function oneWeakStrong(){const g={};for(const a of use.filter(avail))(g[pat(a,DEEP)]=g[pat(a,DEEP)]||[]).push(a);
  for(let k=0;k<100000;k++){const p=shuffle(Object.keys(g))[0],q=comp(p);if(!g[q])continue;const G=byUse(g[p]).slice(0,40),H=byUse(g[q]).slice(0,30);if(G.length<3||H.length<2)continue;
    const t=[...shuffle(G).slice(0,3),...shuffle(H).slice(0,2)];if(!distinctInd(t))continue;
    if(!SURF.every(kk=>{const s=t.reduce((x,m)=>x+m[kk],0);return s===2||s===3;}))continue;if(SURF.some(kk=>{const s=t.slice(0,3).reduce((x,m)=>x+m[kk],0);return s===0||s===3;}))continue;return t;}return null;}
function oneWeakWeak(){const K=[...SURF,...DEEP];const c=byUse(use.filter(avail)).slice(0,300);
  for(let k=0;k<600000;k++){if(c.length<5)return null;const idx=new Set();while(idx.size<5)idx.add(Math.floor(rnd()*c.length));const t=[...idx].map(i=>c[i]);
    if(!K.every(kk=>{const s=t.reduce((x,m)=>x+m[kk],0);return s===2||s===3;}))continue;if(fau(t,SURF)>0.7||fau(t,DEEP)>0.5||fau(t,K)>0.42)continue;if(!distinctInd(t))continue;return t;}return null;}
const builders={weak_weak:oneWeakWeak,weak_strong:oneWeakStrong,strong_weak:oneStrongWeak,strong_strong:oneStrongStrong};const ONLY=process.env.ONLY;if(ONLY)for(const k of Object.keys(builders))if(k!==ONLY)delete builders[k];
const cellsRR={strong_strong:[],strong_weak:[],weak_strong:[],weak_weak:[]};const fails={};
for(let round=0;round<40;round++){for(const [name,fn] of Object.entries(builders)){if(cellsRR[name].length>=40||(fails[name]||0)>=3)continue;const t=fn();if(!t){fails[name]=(fails[name]||0)+1;continue;}take(t);cellsRR[name].push(t);}}
const cells=cellsRR;
const tag=m=>`${m.name}(${m.gender==="male"?"男":"女"}${m.age}${m.grad?"硕":"本"}·${m.fn.slice(0,2)}·R${m.hiRisk}P${m.hiPromo}A${m.hiAot})`;
const mean=a=>a.reduce((x,y)=>x+y,0)/a.length;
for(const [name,teams] of Object.entries(cells)){
  const fs_=teams.map(t=>fau(t,SURF)),fd=teams.map(t=>fau(t,DEEP)),fa=teams.map(t=>fau(t,[...SURF,...DEEP]));
  const fin=teams.map(t=>t.reduce((s,m)=>s+m.fin,0)).reduce((c,n)=>(c[n]=(c[n]||0)+1,c),{});
  console.log(`\n=== ${name}: ${teams.length} teams | 表层Fau ${mean(fs_).toFixed(2)} [${Math.min(...fs_).toFixed(2)}–${Math.max(...fs_).toFixed(2)}] | 深层Fau ${mean(fd).toFixed(2)} [${Math.min(...fd).toFixed(2)}–${Math.max(...fd).toFixed(2)}] | 五属性 ${mean(fa).toFixed(2)} | 财务分布 ${JSON.stringify(fin)}`);
  teams.slice(0,2).forEach(t=>console.log("  "+t.map(tag).join(" | ")));}
const uc=[...useCount.values()];console.log(`\npersons used: ${uc.length}, x1=${uc.filter(x=>x===1).length} x2=${uc.filter(x=>x===2).length} x3=${uc.filter(x=>x===3).length}`);
// leader: random member per team, record whether in majority (first 3) for aligned cells
const out={};for(const [name,teams] of Object.entries(cells)){out[name]=teams.map(t=>{const li=Math.floor(rnd()*5);return {profile_ids:t.map(m=>m.id),leader_id:t[li].id,leader_in_majority:li<3?1:0,surf_fau:fau(t,SURF),deep_fau:fau(t,DEEP),fin:t.reduce((s,m)=>s+m.fin,0)};});}
fs.writeFileSync(`${process.env.S}/faultline_2x2_harrison_teams.json`,JSON.stringify(out,null,1));
