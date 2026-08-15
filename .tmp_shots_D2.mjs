import { chromium } from '@playwright/test';
const TID='56c37e3e-43f8-49b9-9cf7-6d4d76387dcb';
const MID='0a5f6257-6ae6-475f-8077-3cc338ff36f7';
const OUT=process.env.HOME+'/Desktop/scale_check_0714/ppt_shots';
const b=await chromium.launch();
const ctx=await b.newContext({viewport:{width:1600,height:1100},deviceScaleFactor:2});
const p=await ctx.newPage();
await p.goto(`https://app.praxisengine.xyz/multiplayer/round2?teamId=${TID}&memberId=${MID}`,{waitUntil:'domcontentloaded'});
await p.waitForTimeout(4000);
// click 继续 (merge → discussion/pricing)
const cont=await p.evaluate(()=>{const c=[...document.querySelectorAll('button')].filter(x=>x.textContent.trim()==='继续'&&!x.disabled);if(!c.length)return null;const b2=c[c.length-1];b2.scrollIntoView({block:'center'});const r=b2.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};});
if(cont){ await p.mouse.click(cont.x,cont.y); await p.waitForTimeout(3500); }
const nSlider=await p.locator('input[type=range]').count();
console.log('sliders:', nSlider);
if(nSlider){
  const sb=await p.locator('input[type=range]').first().boundingBox();
  console.log('slider box:', JSON.stringify(sb));
  // surrounding texts
  const info=await p.evaluate(()=>{
    const el=document.querySelector('input[type=range]');
    let container=el; for(let i=0;i<6&&container.parentElement;i++){ container=container.parentElement; if(container.getBoundingClientRect().height>180) break; }
    const r=container.getBoundingClientRect();
    return {containerAbs:{x:r.x,y:r.y+window.scrollY,w:r.width,h:r.height}, text:container.innerText.slice(0,400).replace(/\s+/g,' ')};
  });
  console.log('container:', JSON.stringify(info.containerAbs));
  console.log('container text:', info.text);
}
const t=await p.evaluate(()=>document.body.innerText);
console.log('cost panel hints:', JSON.stringify((t.match(/[^\n]*(盈亏平衡|BEQ|毛利|单台成本|固定成本)[^\n]*/g)||[]).slice(0,5)));
await p.screenshot({path:`${OUT}/debug/D2-pricing.png`, fullPage:true});
await b.close();
