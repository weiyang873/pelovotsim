import { chromium } from '@playwright/test';
const TID='56c37e3e-43f8-49b9-9cf7-6d4d76387dcb';
const MID='0a5f6257-6ae6-475f-8077-3cc338ff36f7';
const OUT=process.env.HOME+'/Desktop/scale_check_0714/ppt_shots';
const b=await chromium.launch();
const ctx=await b.newContext({viewport:{width:1600,height:1200},deviceScaleFactor:2});
const p=await ctx.newPage();
await p.goto(`https://app.praxisengine.xyz/multiplayer/round2?teamId=${TID}&memberId=${MID}`,{waitUntil:'domcontentloaded'});
await p.waitForTimeout(4000);
const cont=await p.evaluate(()=>{const c=[...document.querySelectorAll('button')].filter(x=>x.textContent.trim()==='继续'&&!x.disabled);if(!c.length)return null;const b2=c[c.length-1];b2.scrollIntoView({block:'center'});const r=b2.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};});
if(cont){ await p.mouse.click(cont.x,cont.y); await p.waitForTimeout(3500); }
const m=await p.evaluate(()=>{
  const find=(re)=>{for(const el of document.querySelectorAll('div,span,h2,h3,p,label')){const s=(el.textContent||'').trim();if(re.test(s)&&el.children.length<4){const r=el.getBoundingClientRect();return {y:r.y+window.scrollY,x:r.x,w:r.width,h:r.height};}}return null;};
  const priceLabel=find(/^产品售价/);
  const rangeLow=find(/^¥1,000/);
  const slider=document.querySelector('input[type=range]').getBoundingClientRect();
  return {priceLabel, rangeLow, sliderY:Math.round(slider.y+window.scrollY)};
});
console.log('landmarks:', JSON.stringify(m));
// crop full card width; height = W/1.857; center vertically on slider so price above + labels below, cut deep panels
const cardX=270, cardW=1060;
const H=Math.round(cardW/1.857);   // 571
const sliderAbs=m.sliderY;
// place slider a bit below center → show 产品售价 above, ¥1000/¥6000 labels + a little below
const top=Math.round(m.priceLabel.y-40);
await p.evaluate(y=>window.scrollTo(0,Math.max(0,y-30)), top);
await p.waitForTimeout(500);
const off=await p.evaluate(()=>window.scrollY);
let clip={x:cardX, y:top-off, width:cardW, height:H};
if(clip.y<0) clip.y=0;
if(clip.y+clip.height>1200) clip.height=1200-clip.y;
await p.screenshot({path:`${OUT}/raw_shot4.png`, clip});
console.log('SHOT4 v2 saved', JSON.stringify(clip));
await b.close();
