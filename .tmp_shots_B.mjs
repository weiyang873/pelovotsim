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
console.log('landing:', await p.evaluate(()=>document.body.innerText.slice(0,120).replace(/\s+/g,' ')));
console.log('buttons:', JSON.stringify(await btns()));

// distribution page: click team cell (ToC差异化老人 = row1 rightmost) + 体验型 + confirm
const cells=await p.evaluate(()=>{const out=[];for(const el of document.querySelectorAll('[style*="cursor: pointer"],[style*="cursor:pointer"]')){const r=el.getBoundingClientRect();if(r.width>80&&r.width<430&&r.height>40&&r.height<180&&(el.textContent||'').trim().length<6)out.push({x:r.x+r.width/2,y:r.y+r.height/2,t:(el.textContent||'').trim()});}return out;});
console.log('cells:',cells.length);
if(cells.length>=12){
  const row1y=Math.min(...cells.map(c=>c.y));
  const row1=cells.filter(c=>Math.abs(c.y-row1y)<25).sort((a,b)=>a.x-b.x);
  const tgt=row1[row1.length-1];
  await p.mouse.click(tgt.x,tgt.y); await p.waitForTimeout(600);
}
const archBtn=p.locator('button',{hasText:'体验型'});
if(await archBtn.count()){ await archBtn.first().click(); await p.waitForTimeout(600); }
console.log('after cell+arch:', JSON.stringify(await btns()));
// confirm team choice
const confirm=await p.evaluate(()=>{for(const b of document.querySelectorAll('button')){const t=b.textContent.trim();if(/确定|确认/.test(t)&&!b.disabled){const r=b.getBoundingClientRect();return{t,x:r.x+r.width/2,y:r.y+r.height/2};}}return null;});
if(confirm){ console.log('clicking confirm:',confirm.t); await p.mouse.click(confirm.x,confirm.y); await p.waitForTimeout(2500); }
console.log('after confirm:', await p.evaluate(()=>document.body.innerText.slice(0,160).replace(/\s+/g,' ')));
console.log('buttons:', JSON.stringify(await btns()));
await p.screenshot({path:`${OUT}/debug/B1-vp-page.png`});
// dump form fields
const fields=await p.evaluate(()=>[...document.querySelectorAll('textarea,input[type=text]')].map(f=>({tag:f.tagName,ph:(f.placeholder||'').slice(0,40),vis:!!f.offsetParent})));
console.log('fields:', JSON.stringify(fields));
await b.close();
