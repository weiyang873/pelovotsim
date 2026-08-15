import { chromium } from '@playwright/test';
const TID='fffe61b9-4375-4be9-a885-7e135fc0dde1', MID='e772f802-187e-4e1a-974c-0839c7b2e135';
const OUT=process.env.HOME+'/Desktop/scale_check_0714/ppt_shots';
const b=await chromium.launch();
const ctx=await b.newContext({viewport:{width:1600,height:1100},deviceScaleFactor:2});
const p=await ctx.newPage();
await p.goto(`https://app.praxisengine.xyz/multiplayer/?teamId=${TID}&memberId=${MID}`,{waitUntil:'domcontentloaded'});
await p.waitForTimeout(3500);
const cont=p.locator('button',{hasText:'继续'});
if(await cont.count()){ await cont.first().click(); await p.waitForTimeout(1500); }
const cards=await p.evaluate(()=>{const out=[];for(const el of document.querySelectorAll('div')){const r=el.getBoundingClientRect();const bg=getComputedStyle(el).backgroundColor;const m=bg.match(/rgb\((\d+),\s*(\d+),\s*(\d+)/);if(m&&(+m[1]+ +m[2]+ +m[3])<120&&r.width>150&&r.width<430&&r.height>120&&el.offsetParent)out.push({x:r.x+r.width/2,y:r.y+r.height/2});}return out.slice(0,2);});
for(const c of cards){ await p.mouse.click(c.x,c.y); await p.waitForTimeout(700); }
await p.locator('button',{hasText:'继续'}).first().click(); await p.waitForTimeout(1800);
// measure grid, build 1.86:1 clip centered on grid, extra height split up/down
const gb=await p.evaluate(()=>{const els=[...document.querySelectorAll('div,table,section')];let best=null;
 for(const el of els){const t=el.textContent||'';if(t.includes('儿童')&&t.includes('成人')&&t.includes('老人')&&t.includes('差异化')&&t.includes('成本领先')){const r=el.getBoundingClientRect();if(r.width>600&&r.height>250&&r.height<900){if(!best||r.height<best.h)best={x:r.x,y:r.y+window.scrollY,w:r.width,h:r.height};}}}
 return best;});
if(!gb){ console.error('grid not found'); process.exit(2); }
const W=Math.min(1560, gb.w+140), H=Math.round(W/1.857);
const cx=gb.x+gb.w/2;
const targetTopAbs=(gb.y+gb.h/2)-H/2;
await p.evaluate(y=>window.scrollTo(0,Math.max(0,y-80)), targetTopAbs);
await p.waitForTimeout(500);
const gb2=await p.evaluate(()=>{const els=[...document.querySelectorAll('div,table,section')];let best=null;
 for(const el of els){const t=el.textContent||'';if(t.includes('儿童')&&t.includes('成人')&&t.includes('老人')&&t.includes('差异化')&&t.includes('成本领先')){const r=el.getBoundingClientRect();if(r.width>600&&r.height>250&&r.height<900){if(!best||r.height<best.h)best={x:r.x,y:r.y,w:r.width,h:r.height};}}}
 return best;});
const clip={x:Math.max(0,cx-W/2), y:Math.max(0,(gb2.y+gb2.h/2)-H/2), width:W, height:H};
if(clip.y+clip.height>1100) clip.y=1100-clip.height;
await p.screenshot({path:`${OUT}/raw_shot1.png`, clip});
console.log('SHOT1 v2 saved', JSON.stringify(clip), 'grid:', JSON.stringify(gb2));
const leak=await p.evaluate(()=>{const t=document.body.innerText;return {sam:/SAM|亿/.test(t),wtp:/WTP/.test(t),moneyDigits:(t.match(/¥\s*[0-9]/g)||[]).length};});
console.log('leak:',JSON.stringify(leak));
await b.close();
