import { chromium } from '@playwright/test';
const TID='56c37e3e-43f8-49b9-9cf7-6d4d76387dcb';
const MID='0a5f6257-6ae6-475f-8077-3cc338ff36f7';
const OUT=process.env.HOME+'/Desktop/scale_check_0714/ppt_shots';
const VP=['喜欢新鲜科技产品的家庭','生活有点单调，想要一些陪伴和乐趣','我们的机器人很智能，能给家里带来快乐'];
const b=await chromium.launch();
const ctx=await b.newContext({viewport:{width:1600,height:1100},deviceScaleFactor:2});
const p=await ctx.newPage();
await p.goto(`https://app.praxisengine.xyz/multiplayer/?teamId=${TID}&memberId=${MID}`,{waitUntil:'domcontentloaded'});
await p.waitForTimeout(3500);
// walk forward: click enabled 继续 up to 3 times until textareas appear
for(let step=0; step<4; step++){
  const hasTa=await p.evaluate(()=>!![...document.querySelectorAll('textarea')].find(t=>t.offsetParent));
  if(hasTa){ console.log('VP form reached at step',step); break; }
  const cont=await p.evaluate(()=>{const cands=[...document.querySelectorAll('button')].filter(b=>b.textContent.trim()==='继续'&&!b.disabled);if(!cands.length)return null;const b2=cands[cands.length-1];b2.scrollIntoView({block:'center'});const r=b2.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};});
  if(!cont){ console.log('no 继续 at step',step,'-- page:', await p.evaluate(()=>document.body.innerText.slice(0,120).replace(/\s+/g,' '))); break; }
  await p.waitForTimeout(300); await p.mouse.click(cont.x,cont.y); await p.waitForTimeout(2500);
}
const tas=p.locator('textarea');
const n=await tas.count(); console.log('textareas:',n);
if(n<3){ await p.screenshot({path:`${OUT}/debug/B5-fail.png`}); process.exit(2); }
for(let i=0;i<3;i++){ await tas.nth(i).fill(VP[i]); await p.waitForTimeout(200); }
const sub=p.locator('button',{hasText:'提交初稿'});
for(let i=0;i<20;i++){ if(!(await sub.first().isDisabled())) break; await p.waitForTimeout(300); }
await sub.first().click();
console.log('提交初稿 clicked', new Date().toLocaleTimeString());
let ok=false;
for(let i=0;i<45;i++){
  await p.waitForTimeout(2000);
  const t=await p.evaluate(()=>document.body.innerText);
  if(/做得好|可以更好|一个建议|AI\s*反馈|教练反馈/.test(t)){ ok=true; break; }
}
console.log('feedback rendered:',ok, new Date().toLocaleTimeString());
await p.screenshot({path:`${OUT}/debug/B5-feedback-full.png`, fullPage:true});
const leak=await p.evaluate(()=>{const t=document.body.innerText;return {cgeScore:/评分|得分/.test(t)&&/[CGE1-5]\s*\.\s*\d/.test(t), moneyDigits:(t.match(/¥\s*\d/g)||[]).length, sam:/SAM/.test(t), pct:(t.match(/\d+\s*%/g)||[]).length};});
console.log('leak:', JSON.stringify(leak));
await b.close();
