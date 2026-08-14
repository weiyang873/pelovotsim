import { chromium } from '@playwright/test';
const TID='56c37e3e-43f8-49b9-9cf7-6d4d76387dcb';
const MID='0a5f6257-6ae6-475f-8077-3cc338ff36f7';
const OUT=process.env.HOME+'/Desktop/scale_check_0714/ppt_shots';
const b=await chromium.launch();
const ctx=await b.newContext({viewport:{width:1600,height:1100},deviceScaleFactor:2});
const p=await ctx.newPage();
await p.goto(`https://app.praxisengine.xyz/multiplayer/round2?teamId=${TID}&memberId=${MID}`,{waitUntil:'domcontentloaded'});
await p.waitForTimeout(4000);
// find and click 进入个人选卡 (or 继续) button
const go=await p.evaluate(()=>{for(const b of document.querySelectorAll('button')){const t=b.textContent.trim();if(/个人选卡|继续进入/.test(t)&&!b.disabled){b.scrollIntoView({block:'center'});const r=b.getBoundingClientRect();return {t,x:r.x+r.width/2,y:r.y+r.height/2};}}return null;});
console.log('go btn:', JSON.stringify(go));
if(go){ await p.waitForTimeout(300); await p.mouse.click(go.x,go.y); await p.waitForTimeout(3500); }
const t=await p.evaluate(()=>document.body.innerText);
console.log('now on cards?', /已选\s*0\s*张|个人选卡（/.test(t));
console.log('已选 bar:', (t.match(/已选[^\n]*/)||[])[0]);
console.log('money digit occurrences:', (t.match(/¥\s*-?\d/g)||[]).length, '| 万 occurrences:', (t.match(/\d+(\.\d+)?\s*万/g)||[]).length);
console.log('sample cost lines:', JSON.stringify((t.match(/单位成本[^\n]{0,30}/g)||[]).slice(0,3)));
// positions for crop planning
const pos=await p.evaluate(()=>{
  const find=(re)=>{let best=null;for(const el of document.querySelectorAll('div,span,h1,h2,h3,p')){const s=(el.textContent||'').trim();if(re.test(s)&&el.children.length<4){const r=el.getBoundingClientRect();const y=r.y+window.scrollY;if(!best||y<best.y)best={y:Math.round(y),h:Math.round(r.height)};}}return best;};
  return {
    header: find(/^个人选卡/),
    desc: find(/^为你负责的维度选择能力卡/),
    selBar: find(/^已选\s/),
    frozen: find(/^📄|已冻结调研报告摘录/),
    group1: find(/^💬|^交互与表达/),
    card1: find(/^语音基础/)
  };
});
console.log('positions:', JSON.stringify(pos));
await p.screenshot({path:`${OUT}/debug/C3-cards.png`, fullPage:false});
await b.close();
