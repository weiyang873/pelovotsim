import { chromium } from '@playwright/test';
const TID='56c37e3e-43f8-49b9-9cf7-6d4d76387dcb';
const MID='0a5f6257-6ae6-475f-8077-3cc338ff36f7';
const OUT=process.env.HOME+'/Desktop/scale_check_0714/ppt_shots';
const b=await chromium.launch();
const ctx=await b.newContext({viewport:{width:1600,height:1100},deviceScaleFactor:2});
const p=await ctx.newPage();
await p.goto(`https://app.praxisengine.xyz/multiplayer/?teamId=${TID}&memberId=${MID}`,{waitUntil:'domcontentloaded'});
await p.waitForTimeout(3500);
// feedback screen restores? (fields persisted client-side only... verify)
let t=await p.evaluate(()=>document.body.innerText);
console.log('restored feedback?', /做得好|评语/.test(t));
if(!/做得好|评语/.test(t)){
  // re-walk: textareas restored with padded text? then re-submit quickly
  for(let step=0; step<4; step++){
    const hasTa=await p.evaluate(()=>!![...document.querySelectorAll('textarea')].find(x=>x.offsetParent));
    if(hasTa) break;
    const cont=await p.evaluate(()=>{const c=[...document.querySelectorAll('button')].filter(x=>x.textContent.trim()==='继续'&&!x.disabled);if(!c.length)return null;const b2=c[c.length-1];b2.scrollIntoView({block:'center'});const r=b2.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};});
    if(!cont) break;
    await p.mouse.click(cont.x,cont.y); await p.waitForTimeout(2500);
  }
  const tas=p.locator('textarea');
  const vals=await p.evaluate(()=>[...document.querySelectorAll('textarea')].map(x=>x.value.slice(0,10)));
  console.log('ta values:', JSON.stringify(vals));
  const VP=['喜欢新鲜科技产品的家庭，对智能产品都挺感兴趣','生活有点单调，想要一些陪伴和乐趣，具体说不太上来','我们的机器人很智能，能给家里带来快乐和便利'];
  for(let i=0;i<3;i++){ const v=await tas.nth(i).inputValue(); if(!v) await tas.nth(i).fill(VP[i]); }
  const sub=p.locator('[data-testid="vp-feedback-submit-btn"]');
  for(let i=0;i<20;i++){ if(!(await sub.isDisabled())) break; await p.waitForTimeout(300); }
  await sub.click();
  for(let i=0;i<50;i++){ await p.waitForTimeout(2000); t=await p.evaluate(()=>document.body.innerText); if(/做得好|可以更好/.test(t)) break; }
}
// measure two-column container = smallest element containing 你的初稿 + 策略顾问评语
const box=await p.evaluate(()=>{
  let best=null;
  for(const el of document.querySelectorAll('div,section')){
    const s=el.textContent||'';
    if(s.includes('你的初稿')&&s.includes('策略顾问评语')){
      const r=el.getBoundingClientRect();
      if(r.width>500){ if(!best||r.height<best.h) best={x:r.x,y:r.y+window.scrollY,w:r.width,h:r.height}; }
    }
  }
  return best;
});
console.log('container:', JSON.stringify(box));
if(!box){ process.exit(2); }
// desired: width = container width + pad; height = W/1.857; anchor slightly above container top to include 策略顾问反馈 title
const W=Math.min(1560, box.w+48);
const H=Math.round(W/1.857);
const absTop=box.y-10; // include card title
await p.evaluate(y=>window.scrollTo(0,Math.max(0,y-40)), absTop);
await p.waitForTimeout(500);
const vb=await p.evaluate(()=>{
  let best=null;
  for(const el of document.querySelectorAll('div,section')){
    const s=el.textContent||'';
    if(s.includes('你的初稿')&&s.includes('策略顾问评语')){
      const r=el.getBoundingClientRect();
      if(r.width>500){ if(!best||r.height<best.h) best={x:r.x,y:r.y,w:r.width,h:r.height}; } } }
  return best; });
const clip={x:Math.max(0,vb.x-24), y:Math.max(0,vb.y-10), width:W, height:H};
if(clip.y+clip.height>1100) clip.height=1100-clip.y;
await p.screenshot({path:`${OUT}/raw_shot2.png`, clip});
console.log('SHOT2 saved', JSON.stringify(clip));
await b.close();
