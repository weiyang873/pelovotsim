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
// selections persisted (cell ✓ + 体验型): find enabled 继续 at bottom of confirm section
const cont=await p.evaluate(()=>{const cands=[...document.querySelectorAll('button')].filter(b=>b.textContent.trim()==='继续'&&!b.disabled);if(!cands.length)return null;const b2=cands[cands.length-1];b2.scrollIntoView({block:'center'});const r=b2.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};});
console.log('继续 btn:',JSON.stringify(cont));
if(!cont){ console.error('no 继续'); console.log(JSON.stringify(await btns())); process.exit(2); }
await p.waitForTimeout(300); await p.mouse.click(cont.x,cont.y);
await p.waitForTimeout(3000);
console.log('page now:', await p.evaluate(()=>document.body.innerText.slice(0,260).replace(/\s+/g,' ')));
const fields=await p.evaluate(()=>[...document.querySelectorAll('textarea,input[type=text]')].filter(f=>f.offsetParent).map((f,i)=>({i,tag:f.tagName,ph:(f.placeholder||'').slice(0,60)})));
console.log('fields:', JSON.stringify(fields,null,0));
console.log('buttons:', JSON.stringify(await btns()));
await p.screenshot({path:`${OUT}/debug/B3-vp-form.png`, fullPage:false});
await b.close();
