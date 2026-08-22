// Fixed-triad faultline design: core A,B,C mutually different on surface (age band, gender) and deep (risk/promo/AOT pattern);
// add D,E per condition: control (unlike everyone, unlike each other), surface (D surf=A, E surf=B; deep unlike all), deep (D deep=A, E deep=B; surf unlike all), both (D=A, E=B on surf+deep).
// Isolated core member rotates across triads. Distinct industries and names within a team. Each person used <= MAXUSE.
const fs=require("fs");
const P=JSON.parse(fs.readFileSync("data/task_blind_persona_pipeline_v1/v2_faultline_pool541_20260816/persona_pool_task_blind_narrative_v1.json","utf8"));
const med=k=>{const v=P.map(r=>r.behavioral_fingerprint[k]).sort((a,b)=>a-b);return v[Math.floor(v.length/2)];};
const MR=med("risk_propensity_business"),MP=med("regulatory_focus_promotion"),MA=med("actively_open_minded_thinking");
const A=P.map(r=>{const s=r.surface,c=r.frozen_facts.career_context;const fn=(c.match(/主要职能是([^，,。；;]+)/)||[])[1]||"";
 return {id:r.persona_id,name:s.name,age:s.age,gender:s.gender,fn,ind:s.industry,grad:/硕士/.test(s.edu)?1:0,fin:/财务/.test(fn)?1:0,
  ageBand:s.age<=42?'Y':s.age>=48?'O':'M',young:s.age<=42?1:s.age>=48?0:-1,male:s.gender==="male"?1:0,
  hiRisk:r.behavioral_fingerprint.risk_propensity_business>MR?1:0,hiPromo:r.behavioral_fingerprint.regulatory_focus_promotion>MP?1:0,hiAot:r.behavioral_fingerprint.actively_open_minded_thinking>MA?1:0};});
const surf=a=>`${a.ageBand}${a.male}`,deep=a=>`${a.hiRisk}${a.hiPromo}${a.hiAot}`;
const NT=Number(process.env.NT||10),MAXUSE=Number(process.env.MAXUSE||3);
let seed=Number(process.env.SEED||31);const rnd=()=>{seed=(seed*48271)%2147483647;return seed/2147483647;};
const shuffle=a=>[...a].sort(()=>rnd()-.5);
const use=new Map();const avail=a=>(use.get(a.id)||0)<MAXUSE;const take=t=>t.forEach(m=>use.set(m.id,(use.get(m.id)||0)+1));
const okTeam=t=>new Set(t.map(m=>m.ind)).size===t.length&&new Set(t.map(m=>m.name)).size===t.length;
const surfDiff=(x,y)=>x.young!==y.young&&x.male!==y.male; // differ on BOTH surface attrs
const deepDiff=(x,y)=>x.hiRisk!==y.hiRisk&&x.hiPromo!==y.hiPromo&&x.hiAot!==y.hiAot; // fully opposite deep pattern? too strict; use: differ on >=2 of 3
const deepUnlike=(x,y)=>deep(x)!==deep(y); // not the same deep pattern
const surfUnlike=(x,y)=>surf(x)!==surf(y); // not the same surface pattern (age band x gender)
const teams=[];const triads=[];const fails={};
let guard=0;
while(triads.length<NT&&guard++<5000){
  // pick core: three people pairwise unlike on surface (>=1 attr) and deep (>=2 attrs), distinct patterns
  const cand=shuffle(A.filter(avail)).slice(0,120);let core=null;
  for(let i=0;i<cand.length&&!core;i++)for(let j=i+1;j<cand.length&&!core;j++){if(!surfUnlike(cand[i],cand[j])||!deepUnlike(cand[i],cand[j]))continue;for(let k=j+1;k<cand.length;k++){const t=[cand[i],cand[j],cand[k]];if(!surfUnlike(t[0],t[2])||!surfUnlike(t[1],t[2])||!deepUnlike(t[0],t[2])||!deepUnlike(t[1],t[2]))continue;if(!okTeam(t))continue;core=t;break;}}
  if(!core)break;
  // rotate isolate: choose which core index is unmatched
  const iso=triads.length%3;const idx=[0,1,2].filter(i=>i!==iso);const [a,b]=[core[idx[0]],core[idx[1]]];
  const pool=()=>shuffle(A.filter(x=>avail(x)&&!core.some(c=>c.id===x.id)));
  const find=(pred,exclude=[])=>pool().find(x=>pred(x)&&!exclude.some(e=>e.id===x.id)&&okTeam([...core,...exclude,x]));
  const unlikeAll=(x,others)=>others.every(o=>surfUnlike(x,o)&&deepUnlike(x,o));
  const cond={};
  // control
  {const d=find(x=>unlikeAll(x,core));const e=d&&find(x=>unlikeAll(x,[...core,d]),[d]);if(d&&e)cond.control=[...core,d,e];}
  // surface: D surf=A & deep unlike all; E surf=B & deep unlike all (and unlike D)
  {const d=find(x=>surf(x)===surf(a)&&core.every(o=>deepUnlike(x,o)));const e=d&&find(x=>surf(x)===surf(b)&&[...core,d].every(o=>deepUnlike(x,o)),[d]);if(d&&e)cond.surface=[...core,d,e];}
  // deep: D deep=A & surf unlike all; E deep=B & surf unlike all
  {const d=find(x=>deep(x)===deep(a)&&core.every(o=>surfUnlike(x,o)));const e=d&&find(x=>deep(x)===deep(b)&&[...core,d].every(o=>surfUnlike(x,o)),[d]);if(d&&e)cond.deep=[...core,d,e];}
  // both
  {const d=find(x=>surf(x)===surf(a)&&deep(x)===deep(a));const e=d&&find(x=>surf(x)===surf(b)&&deep(x)===deep(b),[d]);if(d&&e)cond.both=[...core,d,e];}
  if(Object.keys(cond).length<4){fails[Object.keys(cond).join(',')||'core_only']=(fails[Object.keys(cond).join(',')||'core_only']||0)+1;continue;}
  take(core);for(const t of Object.values(cond))take(t.slice(3));
  triads.push({core:core.map(m=>m.id),isolate:core[iso].id,matched:[a.id,b.id],cond:Object.fromEntries(Object.entries(cond).map(([k,t])=>[k,{profile_ids:t.map(m=>m.id),added:t.slice(3).map(m=>m.id)}]))});
}
const tag=m=>`${m.name}(${m.gender==="male"?"男":"女"}${m.age}·${m.grad?"硕":"本"}·${m.fn.slice(0,2)}·S${surf(m)}D${deep(m)})`;
const byId=new Map(A.map(m=>[m.id,m]));
console.log('fail reasons',JSON.stringify(fails));console.log(`triads built: ${triads.length} (target ${NT}); persons used: ${use.size}, max use ${Math.max(...use.values())}`);
for(const [i,tr] of triads.slice(0,3).entries()){console.log(`\n--- triad ${i+1} core: ${tr.core.map(id=>tag(byId.get(id))).join(" | ")}  isolate=${byId.get(tr.isolate).name}`);for(const [c,t] of Object.entries(tr.cond))console.log(`  ${c.padEnd(8)} + ${t.added.map(id=>tag(byId.get(id))).join(" | ")}`);}
// write fixed teams: seed suffix order triad-major
const teamsOut={};let k=0;for(const [i,tr] of triads.entries())for(const c of ["control","surface","deep","both"]){k++;const ids=tr.cond[c].profile_ids;const leader=ids[Math.floor(rnd()*5)];teamsOut[String(k).padStart(2,"0")]={cell:c,triad:i+1,core:tr.core,isolate:tr.isolate,matched:tr.matched,added:tr.cond[c].added,profile_ids:ids,leader_id:leader,leader_role:tr.core.includes(leader)?(leader===tr.isolate?"isolate":"core_matched"):"added"};}
fs.writeFileSync(process.env.OUT||`${process.env.S}/faultline_triad_teams.json`,JSON.stringify({pool:"data/task_blind_persona_pipeline_v1/v2_faultline_pool541_20260816/persona_pool_task_blind_narrative_v1.json",design:"fixed-triad faultline: control/surface/deep/both; surface=age band x gender, deep=risk x promo x AOT pattern; isolate rotates",teams:teamsOut},null,1));
console.log("teams",Object.keys(teamsOut).length,"leader roles",JSON.stringify(Object.values(teamsOut).reduce((c,t)=>(c[t.leader_role]=(c[t.leader_role]||0)+1,c),{})),"fin/team",JSON.stringify(Object.values(teamsOut).reduce((c,t)=>{const n=t.profile_ids.reduce((s,id)=>s+byId.get(id).fin,0);c[n]=(c[n]||0)+1;return c;},{})));
