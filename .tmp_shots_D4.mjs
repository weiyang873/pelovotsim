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
// what's above the 定价决策 card? sample text at 3860..3995
const above=await p.evaluate(()=>{
  const hits=[];
  for(const el of document.querySelectorAll('div,p,span,h3')){
    const r=el.getBoundingClientRect(); const y=r.y+window.scrollY;
    if(y>3830&&y<3996&&el.children.length<3&&(el.textContent||'').trim()){ hits.push({y:Math.round(y),t:(el.textContent||'').trim().slice(0,60)}); }
  }
  return hits.slice(0,8);
});
console.log('above card:', JSON.stringify(above,null,1));
// scroll and shoot candidate: abs 3903..4452
await p.evaluate(()=>window.scrollTo(0,3800));
await p.waitForTimeout(500);
const off=await p.evaluate(()=>window.scrollY);
const clip={x:20, y:3903-off, width:1020*1.0, height:549};
// widen a bit and center on card (card x 270..1330)
clip.x=290-((1020-1060)/2); clip.x=270-0; clip.width=1020; 
await p.screenshot({path:`${OUT}/debug/D4-shot4-candidate.png`, clip});
console.log('candidate saved, scrollY=',off,'clip=',JSON.stringify(clip));
await b.close();
