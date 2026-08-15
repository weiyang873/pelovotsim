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
  const hasTa=await p.evaluate(()=>!![...document.querySelectorAll('textarea')].find(t=>t.offsetParent));
  if(hasTa) break;
  const cont=await p.evaluate(()=>{const c=[...document.querySelectorAll('button')].filter(x=>x.textContent.trim()==='继续'&&!x.disabled);if(!c.length)return null;const b2=c[c.length-1];b2.scrollIntoView({block:'center'});const r=b2.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};});
  if(!cont) break;
  await p.waitForTimeout(300); await p.mouse.click(cont.x,cont.y); await p.waitForTimeout(2500);
}
const tas=p.locator('textarea');
console.log('textareas:', await tas.count());
for(let i=0;i<3;i++){ await tas.nth(i).fill(VP[i]); await p.waitForTimeout(250); }
const sub=p.locator('[data-testid="vp-feedback-submit-btn"]');
for(let i=0;i<20;i++){ if(!(await sub.isDisabled())) break; await p.waitForTimeout(300); }
console.log('submit enabled:', !(await sub.isDisabled()));
await sub.click();
console.log('提交初稿 clicked', new Date().toLocaleTimeString());
let ok=false;
for(let i=0;i<50;i++){
  await p.waitForTimeout(2000);
  const t=await p.evaluate(()=>document.body.innerText);
  if(/做得好|可以更好|一个建议/.test(t)){ ok=true; break; }
}
console.log('feedback rendered:', ok, new Date().toLocaleTimeString());
await p.screenshot({path:`${OUT}/debug/B7-feedback-full.png`, fullPage:true});
// leak check
const leak=await p.evaluate(()=>{const t=document.body.innerText;return {money:(t.match(/¥\s*\d/g)||[]).length, sam:/SAM/.test(t), pct:(t.match(/\d+\s*%/g)||[]).length, cge:/[CGE]\s*[:：]\s*\d/.test(t)};});
console.log('leak:', JSON.stringify(leak));
await b.close();
