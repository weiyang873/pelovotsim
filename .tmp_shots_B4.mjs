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
const tas=p.locator('textarea');
const n=await tas.count(); console.log('textareas:',n);
for(let i=0;i<3;i++){ await tas.nth(i).fill(VP[i]); await p.waitForTimeout(200); }
const sub=p.locator('button',{hasText:'提交初稿'});
await sub.first().waitFor({state:'visible',timeout:5000});
// wait until enabled
for(let i=0;i<20;i++){ if(!(await sub.first().isDisabled())) break; await p.waitForTimeout(300); }
console.log('submit disabled?', await sub.first().isDisabled());
await sub.first().click();
console.log('提交初稿 clicked at', new Date().toLocaleTimeString());
// wait for AI feedback to render (up to 90s)
let ok=false;
for(let i=0;i<45;i++){
  await p.waitForTimeout(2000);
  const t=await p.evaluate(()=>document.body.innerText);
  if(/做得好|可以更好|一个建议|AI\s*反馈|教练反馈|反馈意见/.test(t)){ ok=true; break; }
}
console.log('feedback rendered:',ok);
await p.screenshot({path:`${OUT}/debug/B4-feedback-full.png`, fullPage:true});
// leak check
const leak=await p.evaluate(()=>{const t=document.body.innerText;return {cge:/[CGE]\s*[:：]?\s*[0-9](\.[0-9])?/.test(t)&&/覆盖|泛化|有效|评分/.test(t), scoreWords:(t.match(/评分|得分|score/gi)||[]).length, moneyDigits:(t.match(/¥\s*\d/g)||[]).length, sam:/SAM|市场规模/.test(t), pct:/\d+\s*%/.test(t)};});
console.log('leak check:', JSON.stringify(leak));
console.log('page head:', await p.evaluate(()=>document.body.innerText.slice(0,300).replace(/\s+/g,' ')));
await b.close();
