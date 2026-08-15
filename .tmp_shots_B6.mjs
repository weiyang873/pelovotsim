import { chromium } from '@playwright/test';
const TID='56c37e3e-43f8-49b9-9cf7-6d4d76387dcb';
const MID='0a5f6257-6ae6-475f-8077-3cc338ff36f7';
const OUT=process.env.HOME+'/Desktop/scale_check_0714/ppt_shots';
const b=await chromium.launch();
const ctx=await b.newContext({viewport:{width:1600,height:1100},deviceScaleFactor:2});
const p=await ctx.newPage();
await p.goto(`https://app.praxisengine.xyz/multiplayer/?teamId=${TID}&memberId=${MID}`,{waitUntil:'domcontentloaded'});
await p.waitForTimeout(3500);
// walk forward past 确认/分布 if needed
for(let step=0; step<4; step++){
  const t=await p.evaluate(()=>document.body.innerText);
  if(/做得好|可以更好|AI\s*反馈|初稿反馈|反馈/.test(t) && /喜欢新鲜科技产品的家庭/.test(t)){ console.log('feedback screen at step',step); break; }
  const cont=await p.evaluate(()=>{const c=[...document.querySelectorAll('button')].filter(b=>b.textContent.trim()==='继续'&&!b.disabled);if(!c.length)return null;const b2=c[c.length-1];b2.scrollIntoView({block:'center'});const r=b2.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};});
  if(!cont){ console.log('no 继续; page:', t.slice(0,150).replace(/\s+/g,' ')); break; }
  await p.waitForTimeout(300); await p.mouse.click(cont.x,cont.y); await p.waitForTimeout(2500);
}
const t2=await p.evaluate(()=>document.body.innerText);
console.log('has draft text:', /喜欢新鲜科技产品的家庭/.test(t2), '| has feedback:', /做得好|可以更好|建议/.test(t2));
console.log('page snippet:', t2.slice(0,400).replace(/\s+/g,' '));
await p.screenshot({path:`${OUT}/debug/B6-state.png`, fullPage:true});
await b.close();
