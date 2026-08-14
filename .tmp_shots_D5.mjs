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
// crop: 定价决策 header → down through slider + range labels, cutting cost panels (渠道到手 kept as price info; cut 总固定成本 onward)
const m=await p.evaluate(()=>{
  const find=(re)=>{for(const el of document.querySelectorAll('div,span,h2,h3,p,label')){const s=(el.textContent||'').trim();if(re.test(s)&&el.children.length<4){const r=el.getBoundingClientRect();return {y:r.y+window.scrollY, x:r.x, w:r.width};}}return null;};
  const header=find(/^定价决策/);
  const channel=find(/^渠道抽成\s*25%\s*后/);   // "每台到手" line (price info)
  const fixed=find(/^总固定成本/);              // cut from here
  return {header, channel, fixed};
});
console.log('landmarks:', JSON.stringify(m));
// region: header top → just above 总固定成本
const cardX=270, cardW=1060;
const top=m.header.y-16;
const bottomCut=m.fixed.y-14;  // cut cost panels
const naturalH=bottomCut-top;
console.log('natural region h:', naturalH, 'w:', cardW, 'ratio:', (cardW/naturalH).toFixed(2));
// target 1.857:1 → widthForRatio = naturalH*1.857
const H=naturalH;
const W=Math.round(H*1.857);
const cx=cardX+cardW/2;
let clip={x:Math.round(cx-W/2), y:0, width:W, height:H};
if(clip.x<0) clip.x=0;
if(clip.x+clip.width>1600) clip.x=1600-clip.width;
// scroll so 'top' is at viewport 40
await p.evaluate(y=>window.scrollTo(0,Math.max(0,y-40)), top);
await p.waitForTimeout(500);
const off=await p.evaluate(()=>window.scrollY);
clip.y=Math.max(0, top-off);
if(clip.y+clip.height>1100) clip.height=1100-clip.y;
await p.screenshot({path:`${OUT}/raw_shot4.png`, clip});
console.log('SHOT4 saved', JSON.stringify(clip));
// leak/content sanity of the cropped area text
await b.close();
