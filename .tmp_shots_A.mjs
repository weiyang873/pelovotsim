import { chromium } from '@playwright/test';
const TID='56c37e3e-43f8-49b9-9cf7-6d4d76387dcb';
const MID='0a5f6257-6ae6-475f-8077-3cc338ff36f7';
const OUT=process.env.HOME+'/Desktop/scale_check_0714/ppt_shots';
const dbg=async(p,n)=>{await p.screenshot({path:`${OUT}/debug/${n}.png`}); };
const btns=async(p)=>p.evaluate(()=>[...document.querySelectorAll('button')].map(b=>({t:b.textContent.trim().slice(0,25),d:b.disabled})));
const log=(...a)=>console.log(...a);

const b=await chromium.launch();
const ctx=await b.newContext({viewport:{width:1600,height:1000},deviceScaleFactor:2});
const p=await ctx.newPage();
await p.goto(`https://app.praxisengine.xyz/multiplayer/?teamId=${TID}&memberId=${MID}`,{waitUntil:'domcontentloaded'});
await p.waitForTimeout(3500);
log('step0 buttons:',JSON.stringify(await btns(p)));

// 确认小组 → 继续
const cont=p.locator('button',{hasText:'继续'});
if(await cont.count()){ await cont.first().click(); await p.waitForTimeout(1500); log('clicked 继续 (确认小组)'); }

// 锦囊: click dark cards by coordinates (real pointer events)
const cardBoxes=await p.evaluate(()=>{
  const out=[];
  for(const el of document.querySelectorAll('div')){
    const r=el.getBoundingClientRect(); const bg=getComputedStyle(el).backgroundColor;
    const m=bg.match(/rgb\((\d+),\s*(\d+),\s*(\d+)/);
    if(m && (+m[1]+ +m[2]+ +m[3])<120 && r.width>150 && r.width<430 && r.height>120 && el.offsetParent) out.push({x:r.x+r.width/2,y:r.y+r.height/2});
  }
  return out.slice(0,2);
});
log('jinang cards found:',cardBoxes.length);
for(const c of cardBoxes){ await p.mouse.click(c.x,c.y); await p.waitForTimeout(700); }
await dbg(p,'A1-jinang');
// 继续 to grid
const cont2=p.locator('button',{hasText:'继续'});
await cont2.first().waitFor({timeout:8000});
await cont2.first().click(); await p.waitForTimeout(1800);
log('after jinang 继续, buttons:',JSON.stringify(await btns(p)));
await dbg(p,'A2-grid-page');

// ===== SHOT 1: 12格市场选择器 =====
// find grid container: element containing 儿童+成人+老人 headers and 差异化 rows
const gridBox=await p.evaluate(()=>{
  function findGrid(){
    const els=[...document.querySelectorAll('div,table,section')];
    let best=null;
    for(const el of els){
      const t=el.textContent||'';
      if(t.includes('儿童')&&t.includes('成人')&&t.includes('老人')&&t.includes('差异化')&&t.includes('成本领先')){
        const r=el.getBoundingClientRect();
        if(r.width>600&&r.height>250&&r.height<900){ if(!best||r.height<best.h) best={x:r.x,y:r.y,w:r.width,h:r.height}; }
      }
    }
    return best;
  }
  const g=findGrid(); if(g) window.scrollTo(0, Math.max(0, g.y+window.scrollY-120));
  return g;
});
log('gridBox:',JSON.stringify(gridBox));
await p.waitForTimeout(600);
const gb=await p.evaluate(()=>{ // re-measure after scroll
  const els=[...document.querySelectorAll('div,table,section')]; let best=null;
  for(const el of els){ const t=el.textContent||'';
    if(t.includes('儿童')&&t.includes('成人')&&t.includes('老人')&&t.includes('差异化')&&t.includes('成本领先')){
      const r=el.getBoundingClientRect(); if(r.width>600&&r.height>250&&r.height<900){ if(!best||r.height<best.h) best={x:r.x,y:r.y,w:r.width,h:r.height}; } } }
  return best; });
if(!gb){ console.error('GRID NOT FOUND'); await dbg(p,'A2-fail'); process.exit(2); }
// pad region slightly; clip within viewport
const clip={x:Math.max(0,gb.x-8), y:Math.max(0,gb.y-8), width:Math.min(1600-Math.max(0,gb.x-8), gb.w+16), height:Math.min(1000-Math.max(0,gb.y-8), gb.h+16)};
await p.screenshot({path:`${OUT}/raw_shot1.png`, clip});
log('SHOT1 saved, clip:',JSON.stringify(clip));
// leakage grep on grid page
const leak1=await p.evaluate(()=>{const t=document.body.innerText;return {sam:/SAM|亿/.test(t), wtp:/WTP|支付意愿[:：]?\s*¥/.test(t), cge:/C\s*[:：]\s*\d|G\s*[:：]\s*\d|E\s*[:：]\s*\d/.test(t), cost:/dCOGS|NRE|¥\d/.test(t)};});
log('shot1 leak check:',JSON.stringify(leak1));

// ===== select cell + arch + submit =====
// click ToC·差异化·老人 cell: find clickable empty cells, choose one under 老人 column in first 差异化 row → coordinates: rightmost of first row
const cells=await p.evaluate(()=>{
  const out=[];
  for(const el of document.querySelectorAll('[style*="cursor: pointer"],[style*="cursor:pointer"]')){
    const r=el.getBoundingClientRect();
    if(r.width>80&&r.width<420&&r.height>40&&r.height<170&&(el.textContent||'').trim().length<4) out.push({x:r.x+r.width/2,y:r.y+r.height/2});
  } return out;
});
log('grid cells:',cells.length);
if(cells.length<12){ console.error('unexpected cell count'); }
// first row = 消费者差异化; rightmost x in that row = 老人
const row1y=Math.min(...cells.map(c=>c.y));
const row1=cells.filter(c=>Math.abs(c.y-row1y)<20).sort((a,b)=>a.x-b.x);
const target=row1[row1.length-1];
await p.mouse.click(target.x,target.y); await p.waitForTimeout(600);
// arch 体验型
const arch=await p.evaluate(()=>{
  for(const el of document.querySelectorAll('div,button')){ const t=(el.textContent||'').trim(); if(/^体验型/.test(t)&&t.length<70){ const r=el.getBoundingClientRect(); if(r.height<160&&r.width<640) return {x:r.x+r.width/2,y:r.y+r.height/2}; } } return null; });
if(arch){ await p.mouse.click(arch.x,arch.y); await p.waitForTimeout(500); log('arch clicked'); }
// submit
const sub=p.locator('button',{hasText:'提交我的选择'});
await sub.first().waitFor({timeout:8000}); await sub.first().click();
log('提交我的选择 clicked'); await p.waitForTimeout(3000);
await dbg(p,'A3-after-submit');
log('post-submit buttons:',JSON.stringify(await btns(p)));
log('page hint:',await p.evaluate(()=>document.body.innerText.slice(0,200).replace(/\s+/g,' ')));
await b.close();
