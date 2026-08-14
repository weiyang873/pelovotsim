import { chromium } from '@playwright/test';
const TID='56c37e3e-43f8-49b9-9cf7-6d4d76387dcb';
const MID='0a5f6257-6ae6-475f-8077-3cc338ff36f7';
const OUT=process.env.HOME+'/Desktop/scale_check_0714/ppt_shots';
const b=await chromium.launch();
const ctx=await b.newContext({viewport:{width:1600,height:1100},deviceScaleFactor:2});
const p=await ctx.newPage();
const btns=async()=>p.evaluate(()=>[...document.querySelectorAll('button')].map(x=>({t:x.textContent.trim().slice(0,28),d:x.disabled})));
await p.goto(`https://app.praxisengine.xyz/multiplayer/?teamId=${TID}&memberId=${MID}`,{waitUntil:'domcontentloaded'});
await p.waitForTimeout(3500);

// scroll confirm-section cell into view, return its viewport coords
const cellPos=await p.evaluate(()=>{
  // find smallest container holding 确定小组最终选择 + 团队目标市场
  let sec=null;
  for(const el of document.querySelectorAll('div,section')){
    const t=el.textContent||'';
    if(t.includes('确定小组最终选择')&&t.includes('团队目标市场')){
      if(!sec||el.getBoundingClientRect().height<sec.getBoundingClientRect().height) sec=el;
    }
  }
  if(!sec) return null;
  const cells=[...sec.querySelectorAll('[style*="cursor: pointer"],[style*="cursor:pointer"]')].filter(el=>{
    const r=el.getBoundingClientRect(); return r.width>80&&r.width<430&&r.height>40&&r.height<180&&(el.textContent||'').trim().length<4;});
  if(cells.length<12) return {err:'cells='+cells.length};
  // top row = min y; rightmost = 老人
  const rects=cells.map(el=>({el,r:el.getBoundingClientRect()}));
  const minY=Math.min(...rects.map(o=>o.r.y));
  const row1=rects.filter(o=>Math.abs(o.r.y-minY)<25).sort((a,b)=>a.r.x-b.r.x);
  const tgt=row1[row1.length-1];
  tgt.el.scrollIntoView({block:'center'});
  const r=tgt.el.getBoundingClientRect();
  return {x:r.x+r.width/2,y:r.y+r.height/2};
});
console.log('cellPos:',JSON.stringify(cellPos));
if(!cellPos||cellPos.err){ console.error('cell locate failed'); process.exit(2); }
await p.waitForTimeout(400);
await p.mouse.click(cellPos.x,cellPos.y);
await p.waitForTimeout(800);
console.log('after cell:', JSON.stringify((await btns()).filter(b=>/确定|请先|体验/.test(b.t))));
// ensure arch 体验型 selected (click once if confirm still disabled)
let state=await btns();
if(state.some(x=>/请先确定/.test(x.t)&&x.d)){
  const arch=p.locator('button',{hasText:'体验型'});
  await arch.first().click(); await p.waitForTimeout(700);
  console.log('arch re-clicked');
}
state=await btns();
console.log('pre-confirm:', JSON.stringify(state.filter(b=>/确定|请先/.test(b.t))));
const conf=await p.evaluate(()=>{for(const b of document.querySelectorAll('button')){const t=b.textContent.trim();if(/确定小组最终选择|确认小组|确定团队/.test(t)&&!b.disabled){b.scrollIntoView({block:'center'});const r=b.getBoundingClientRect();return{t,x:r.x+r.width/2,y:r.y+r.height/2};}}return null;});
console.log('confirm btn:',JSON.stringify(conf));
if(!conf){ console.error('confirm not enabled'); await p.screenshot({path:`${OUT}/debug/B2-fail.png`}); process.exit(2); }
await p.waitForTimeout(300);
await p.mouse.click(conf.x,conf.y);
await p.waitForTimeout(3000);
console.log('after confirm page:', await p.evaluate(()=>document.body.innerText.slice(0,220).replace(/\s+/g,' ')));
const fields=await p.evaluate(()=>[...document.querySelectorAll('textarea,input[type=text]')].map(f=>({tag:f.tagName,ph:(f.placeholder||'').slice(0,50),vis:!!f.offsetParent})));
console.log('fields:', JSON.stringify(fields));
console.log('buttons:', JSON.stringify(await btns()));
await p.screenshot({path:`${OUT}/debug/B2-vp-form.png`});
await b.close();
