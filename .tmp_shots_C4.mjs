import { chromium } from '@playwright/test';
const TID='56c37e3e-43f8-49b9-9cf7-6d4d76387dcb';
const MID='0a5f6257-6ae6-475f-8077-3cc338ff36f7';
const OUT=process.env.HOME+'/Desktop/scale_check_0714/ppt_shots';
const b=await chromium.launch();
const ctx=await b.newContext({viewport:{width:1600,height:1100},deviceScaleFactor:2});
const p=await ctx.newPage();
await p.goto(`https://app.praxisengine.xyz/multiplayer/round2?teamId=${TID}&memberId=${MID}`,{waitUntil:'domcontentloaded'});
await p.waitForTimeout(4000);
const go=await p.evaluate(()=>{for(const b of document.querySelectorAll('button')){const t=b.textContent.trim();if(/个人选卡|继续进入/.test(t)&&!b.disabled){b.scrollIntoView({block:'center'});const r=b.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};}}return null;});
if(go){ await p.mouse.click(go.x,go.y); await p.waitForTimeout(3500); }
// find 交互与表达 group header absolute y
const g=await p.evaluate(()=>{
  let best=null;
  for(const el of document.querySelectorAll('div,span,h2,h3')){
    const s=(el.textContent||'').trim();
    if(/^💬/.test(s)&&s.includes('交互与表达')&&el.children.length<5){const r=el.getBoundingClientRect();const y=r.y+window.scrollY;if(!best||y<best.y)best={y,x:r.x};}
  }
  if(!best){ for(const el of document.querySelectorAll('div,span,h2,h3')){const s=(el.textContent||'').trim();if(s.startsWith('交互与表达')&&el.children.length<3){const r=el.getBoundingClientRect();best={y:r.y+window.scrollY,x:r.x};break;}}}
  return best;
});
console.log('group1 abs:', JSON.stringify(g));
const W=1560, H=Math.round(W/1.857); // 840
const absTop=g.y-30;
await p.evaluate(y=>window.scrollTo(0,y), absTop-80);
await p.waitForTimeout(600);
const vy=await p.evaluate(()=>{ for(const el of document.querySelectorAll('div,span,h2,h3')){const s=(el.textContent||'').trim();if(/^💬/.test(s)&&s.includes('交互与表达')&&el.children.length<5){return el.getBoundingClientRect().y;}} return null; });
console.log('group1 viewport y:', vy);
const clip={x:20, y:Math.max(0,vy-30), width:W, height:H};
if(clip.y+clip.height>1100){ clip.y=Math.max(0,1100-clip.height); }
await p.screenshot({path:`${OUT}/raw_shot3.png`, clip});
console.log('SHOT3 saved', JSON.stringify(clip));
await b.close();
