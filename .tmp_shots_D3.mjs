import { chromium } from '@playwright/test';
const TID='56c37e3e-43f8-49b9-9cf7-6d4d76387dcb';
const MID='0a5f6257-6ae6-475f-8077-3cc338ff36f7';
const OUT=process.env.HOME+'/Desktop/scale_check_0714/ppt_shots';
const b=await chromium.launch();
const ctx=await b.newContext({viewport:{width:1600,height:1100},deviceScaleFactor:2});
const p=await ctx.newPage();
await p.goto(`https://app.praxisengine.xyz/multiplayer/round2?teamId=${TID}&memberId=${MID}`,{waitUntil:'domcontentloaded'});
await p.waitForTimeout(4000);
const cont=await p.evaluate(()=>{const c=[...document.querySelectorAll('button')].filter(x=>x.textContent.trim()==='继续'&&!x.disabled);if(!c.length)return null;const b2=c[c.length-1];b2.scrollIntoView({block:'center'});const r=b2.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};});
if(cont){ await p.mouse.click(cont.x,cont.y); await p.waitForTimeout(3500); }
// measure landmarks (absolute y)
const marks=await p.evaluate(()=>{
  const find=(re)=>{let best=null;for(const el of document.querySelectorAll('div,span,h2,h3,p,label')){const s=(el.textContent||'').trim();if(re.test(s)&&el.children.length<4){const r=el.getBoundingClientRect();const y=r.y+window.scrollY;if(r.height<200&&(!best||y<best.y))best={y:Math.round(y),h:Math.round(r.height),x:Math.round(r.x),w:Math.round(r.width)};}}return best;};
  const slider=document.querySelector('input[type=range]');
  const sr=slider.getBoundingClientRect();
  return {
    header: find(/^定价决策/),
    note: find(/^💡|^定价须知/),
    priceLabel: find(/^产品售价/),
    priceValue: find(/^¥3,500$|^¥3,?500/),
    low: find(/^¥1,000/),
    high: find(/^¥6,000/),
    channel: find(/^渠道抽成/),
    fixed: find(/^总固定成本/),
    slider: {y:Math.round(sr.y+window.scrollY), x:Math.round(sr.x), w:Math.round(sr.width)}
  };
});
console.log(JSON.stringify(marks,null,1));
await b.close();
