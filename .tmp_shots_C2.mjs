import { chromium } from '@playwright/test';
const TID='56c37e3e-43f8-49b9-9cf7-6d4d76387dcb';
const MID='0a5f6257-6ae6-475f-8077-3cc338ff36f7';
const OUT=process.env.HOME+'/Desktop/scale_check_0714/ppt_shots';
const b=await chromium.launch();
const ctx=await b.newContext({viewport:{width:1600,height:1100},deviceScaleFactor:2});
const p=await ctx.newPage();
await p.goto(`https://app.praxisengine.xyz/multiplayer/round2?teamId=${TID}&memberId=${MID}`,{waitUntil:'domcontentloaded'});
await p.waitForTimeout(4000);
const t=await p.evaluate(()=>document.body.innerText);
console.log('on cards page:', /个人选卡/.test(t), '| team status:', (t.match(/R2_[A-Z_]+/)||[])[0]);
console.log('money digits count:', (t.match(/¥\s*\d/g)||[]).length, '| NRE/万 mentions:', (t.match(/\d+(\.\d+)?万/g)||[]).length);
console.log('已选 bar:', (t.match(/已选[^\n]*/)||[])[0]);
console.log('sample cost lines:', JSON.stringify((t.match(/单位成本[^\n]*/g)||[]).slice(0,2)));
await p.screenshot({path:`${OUT}/debug/C2-cards-top.png`});
// measure key element positions for crop planning
const pos=await p.evaluate(()=>{
  const find=(txt)=>{for(const el of document.querySelectorAll('div,h1,h2,h3,span')){if(el.children.length<3&&(el.textContent||'').trim().startsWith(txt)){const r=el.getBoundingClientRect();return {y:Math.round(r.y+window.scrollY),h:Math.round(r.height)};}}return null;};
  return { header:find('个人选卡'), selBar:find('已选'), groupInteraction:find('💬')||find('交互与表达'), firstCard:find('语音基础') };
});
console.log('positions:', JSON.stringify(pos));
await b.close();
