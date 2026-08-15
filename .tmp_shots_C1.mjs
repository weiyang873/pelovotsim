import { chromium } from '@playwright/test';
const TID='56c37e3e-43f8-49b9-9cf7-6d4d76387dcb';
const MID='0a5f6257-6ae6-475f-8077-3cc338ff36f7';
const OUT=process.env.HOME+'/Desktop/scale_check_0714/ppt_shots';
const VP=['喜欢新鲜科技产品的家庭，对智能产品都挺感兴趣','生活有点单调，想要一些陪伴和乐趣，具体说不太上来','我们的机器人很智能，能给家里带来快乐和便利'];
const b=await chromium.launch();
const ctx=await b.newContext({viewport:{width:1600,height:1100},deviceScaleFactor:2});
const p=await ctx.newPage();
await p.goto(`https://app.praxisengine.xyz/multiplayer/?teamId=${TID}&memberId=${MID}`,{waitUntil:'domcontentloaded'});
await p.waitForTimeout(3500);
for(let step=0; step<4; step++){
  const hasTa=await p.evaluate(()=>!![...document.querySelectorAll('textarea')].find(x=>x.offsetParent));
  if(hasTa) break;
  const cont=await p.evaluate(()=>{const c=[...document.querySelectorAll('button')].filter(x=>x.textContent.trim()==='继续'&&!x.disabled);if(!c.length)return null;const b2=c[c.length-1];b2.scrollIntoView({block:'center'});const r=b2.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};});
  if(!cont) break;
  await p.mouse.click(cont.x,cont.y); await p.waitForTimeout(2500);
}
const tas=p.locator('textarea');
for(let i=0;i<3;i++){ const v=await tas.nth(i).inputValue(); if(!v) await tas.nth(i).fill(VP[i]); }
const sub=p.locator('[data-testid="vp-feedback-submit-btn"]');
for(let i=0;i<20;i++){ if(!(await sub.isDisabled())) break; await p.waitForTimeout(300); }
await sub.click(); console.log('初稿 submitted');
for(let i=0;i<50;i++){ await p.waitForTimeout(2000); const t=await p.evaluate(()=>document.body.innerText); if(/做得好|可以更好/.test(t)) break; }
console.log('feedback ok');
// 定稿
const fin=p.locator('button',{hasText:'接受反馈，提交定稿'});
await fin.first().click(); console.log('定稿 clicked', new Date().toLocaleTimeString());
// wait for scoring/finalize to complete (up to 90s): look for 战略确认/冻结/进入第二轮 affordance
let done='';
for(let i=0;i<60;i++){
  await p.waitForTimeout(2000);
  const t=await p.evaluate(()=>document.body.innerText);
  if(/战略确认|已锁定|冻结|进入第二轮|Round 2/.test(t)){ done=t.slice(0,150).replace(/\s+/g,' '); break; }
}
console.log('after 定稿:', done || '(timeout)');
const btnsNow=await p.evaluate(()=>[...document.querySelectorAll('button')].map(x=>({t:x.textContent.trim().slice(0,25),d:x.disabled})));
console.log('buttons:', JSON.stringify(btnsNow));
await p.screenshot({path:`${OUT}/debug/C1-after-final.png`, fullPage:true});
// freeze via testid if present
const fz=p.locator('[data-testid="r1-freeze-btn"]');
if(await fz.count()){ await fz.first().click(); console.log('freeze clicked'); await p.waitForTimeout(4000); }
else {
  const alt=await p.evaluate(()=>{for(const b of document.querySelectorAll('button')){const t=b.textContent.trim();if(/进入第二轮|冻结|前往 Round 2|进入 Round 2/.test(t)&&!b.disabled){b.scrollIntoView({block:'center'});const r=b.getBoundingClientRect();return {t,x:r.x+r.width/2,y:r.y+r.height/2};}}return null;});
  console.log('freeze alt:', JSON.stringify(alt));
  if(alt){ await p.mouse.click(alt.x,alt.y); await p.waitForTimeout(4000); }
}
console.log('final page:', await p.evaluate(()=>document.body.innerText.slice(0,150).replace(/\s+/g,' ')));
await b.close();
