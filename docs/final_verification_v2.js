#!/usr/bin/env node
/**
 * 最终参数全景验证
 * 
 * 改动总结（vs 原始引擎）:
 *   F:            800万 → 500万
 *   f_ToC:        0.30  → 0.25
 *   f_ToB:        0.10  → 0.15
 *   friction_ToB: 0.30  → 0.65
 *   μ:            新增 1.89 (仅 DIFF 格生效)
 *   γ 公式:       DIFF: γ_eff = γ_raw / (1 + μ×Vscore)
 *                 COST: γ_eff = γ_raw (不变)
 * 
 * 不动: Panchor, V, cv, σ_log, Percentile, Aw, N, 所有 ω/θ/w 系数
 * 校准值: α=-9, wI=5.4, wfit=6.0
 */

function sigmoid(x){return 1/(1+Math.exp(-x));}
function clip(x,lo,hi){return Math.max(lo,Math.min(hi,x));}
function normalInverseCDF(p){const a=[-3.969683028665376e+01,2.209460984245205e+02,-2.759285104469687e+02,1.383577518672690e+02,-3.066479806614716e+01,2.506628277459239e+00];const b=[-5.447609879822406e+01,1.615858368580409e+02,-1.556989798598866e+02,6.680131188771972e+01,-1.328068155288572e+01];const c=[-7.784894002430293e-03,-3.223964580411365e-01,-2.400758277161838e+00,-2.549732539343734e+00,4.374664141464968e+00,2.938163982698783e+00];const d=[7.784695709041462e-03,3.224671290700398e-01,2.445134137142996e+00,3.754408661907416e+00];const pLow=0.02425,pHigh=1-pLow;let q;if(p<pLow){q=Math.sqrt(-2*Math.log(p));return(((((c[0]*q+c[1])*q+c[2])*q+c[3])*q+c[4])*q+c[5])/((((d[0]*q+d[1])*q+d[2])*q+d[3])*q+1);}if(p<=pHigh){q=p-0.5;const r=q*q;return(((((a[0]*r+a[1])*r+a[2])*r+a[3])*r+a[4])*r+a[5])*q/(((((b[0]*r+b[1])*r+b[2])*r+b[3])*r+b[4])*r+1);}q=Math.sqrt(-2*Math.log(1-p));return-(((((c[0]*q+c[1])*q+c[2])*q+c[3])*q+c[4])*q+c[5])/((((d[0]*q+d[1])*q+d[2])*q+d[3])*q+1);}

// ============================================================
// 最终参数
// ============================================================
const alpha=-9, wI=5.4, wfit=6.0, mu=1.8889;
const V=4200, F=5000000, Panchor=30000, S_monthly=99, gm_sub=0.7, T=24;
const SHAPE={cv:{ELDER:0.35,ADULT:0.4,CHILD:0.38},sigma_log:{ELDER:0.5,ADULT:0.55,CHILD:0.50}};
const PERCENTILES={ELDER:0.97,ADULT:0.97,CHILD:0.97};

const GRIDS={
  ToC_ELDER:{N_DIFF:12e6,N_COST:24e6,Aw:0.16,friction:1.0,f:0.25},
  ToC_ADULT:{N_DIFF:18e6,N_COST:36e6,Aw:0.115,friction:1.0,f:0.25},
  ToC_CHILD:{N_DIFF:13e6,N_COST:26e6,Aw:0.17,friction:1.0,f:0.25},
  ToB_ELDER:{N_DIFF:8e6,N_COST:16e6,Aw:0.22,friction:0.8667,f:0.15},
  ToB_ADULT:{N_DIFF:15e6,N_COST:30e6,Aw:0.12,friction:0.65,f:0.15},
  ToB_CHILD:{N_DIFF:10e6,N_COST:20e6,Aw:0.19,friction:1.0,f:0.15},
};

const FX={wsub:0.5,wrisk:-1.0,wcx:-0.5,attach0:0.08,theta_core:0.2,theta_nice:0.1,theta_sub:0.25,theta_risk:0.2,budget_pmax_ratio:0.2,penalty_budget_coeff:1.5,penalty_cap_coeff:50,capacity_cap:24,omega_core:0.45,omega_nice:0.25,omega_sub:0.2,omega_risk:0.35,omega_cost:0.2};

function computeWTP(ch,st,age){
  const ps=clip(PERCENTILES[age]||0.97,1e-6,1-1e-6);const z_ps=normalInverseCDF(ps);let md,ref,g;
  if(st==="DIFF"){const cv=SHAPE.cv[age]||0.4;const m=Panchor/(1+cv*z_ps);md=m;g=4/(cv*Math.sqrt(2*Math.PI));}
  else{const sl=SHAPE.sigma_log[age]||0.55;const ml=Math.log(Panchor)-sl*z_ps;md=Math.exp(ml);g=4/(sl*Math.sqrt(2*Math.PI));}
  if(ch==="ToB"){const steps=20;let sum=0;for(let k=1;k<=steps;k++){const p=Math.min(k/steps,0.9999);const z=normalInverseCDF(p);let bp;if(st==="DIFF"){const cv=SHAPE.cv[age]||0.4;const m=Panchor/(1+cv*z_ps);bp=m+cv*m*z;}else{const sl=SHAPE.sigma_log[age]||0.55;const ml=Math.log(Panchor)-sl*z_ps;bp=Math.exp(ml+sl*z);}sum+=Math.max(bp,0);}ref=sum/steps;}
  else{ref=md;}
  return{WTPref:ref,gamma:g};
}

function computeVscore(sc){
  const cr=V>0?sc.positiveDCOGS/V:0;
  return clip(FX.omega_core*sc.coverCore+FX.omega_nice*sc.coverNice+FX.omega_sub*sc.subLift-FX.omega_risk*sc.risk-FX.omega_cost*cr,0,1);
}

const profiles={
  precise:{evi:0.7,sev:0.65,coverCore:0.85,coverNice:0.5,subLift:0.22,risk:0.55,dCOGS:680,positiveDCOGS:680,load:18,label:"精准"},
  pileup:{evi:0.5,sev:0.45,coverCore:0.6,coverNice:0.7,subLift:0.35,risk:0.85,dCOGS:1400,positiveDCOGS:1400,load:28,label:"堆料"},
  mismatch:{evi:0.4,sev:0.3,coverCore:0.25,coverNice:0.3,subLift:0.1,risk:0.7,dCOGS:600,positiveDCOGS:600,load:16,label:"错配"},
};

function run(gridKey, strategy, sc) {
  const age=gridKey.split("_")[1];const ch=gridKey.split("_")[0];
  const wtp=computeWTP(ch,strategy,age);
  const Vs=computeVscore(sc);
  const gEff=strategy==="DIFF"?wtp.gamma/(1+mu*Vs):wtp.gamma;
  const grid=GRIDS[gridKey];const f=grid.f;
  const N=strategy==="DIFF"?grid.N_DIFF:grid.N_COST;
  const Meff=N*grid.Aw*grid.friction;
  const I=sc.evi*(0.5*sc.sev+0.35*sc.coverCore+0.1*sc.coverNice);
  const fit=clip(0.7*sc.coverCore+0.3*sc.coverNice,0,1);
  const cx=V>0?sc.positiveDCOGS/V:0;
  const X=wI*I+wfit*fit+FX.wsub*sc.subLift+FX.wrisk*sc.risk+FX.wcx*cx;
  const bb=wtp.WTPref*FX.budget_pmax_ratio;
  const oB=Math.max(0,sc.dCOGS-bb);const oC=Math.max(0,sc.load-FX.capacity_cap);
  const pen=FX.penalty_budget_coeff*oB+FX.penalty_cap_coeff*oC;
  const att=clip(FX.attach0+FX.theta_core*sc.coverCore+FX.theta_nice*sc.coverNice+FX.theta_sub*sc.subLift-FX.theta_risk*sc.risk,0,0.9);
  const ltv=att*S_monthly*gm_sub*T;
  
  let bp=-Infinity,bP=0,bS=0,bQ=0;
  for(let i=0;i<=100;i++){
    const r=0.40+(i/100)*0.60;const P=Math.round(wtp.WTPref*r);
    const z=alpha+X-gEff*(P/wtp.WTPref);const s=sigmoid(z);const Q=Meff*s;
    if(Q<=0)continue;const cb=V+F/Q;const C=cb+sc.dCOGS;
    const pr=Q*(P*(1-f)-C)+Q*ltv-pen;
    if(pr>bp){bp=pr;bP=P;bS=s;bQ=Q;}
  }

  const Q=bQ;const COGSunit=Q>0?V+F/Q+sc.dCOGS:Infinity;
  const hwPerUnit=Q>0?bP*(1-f)-COGSunit:0;
  const revenue=Q>0?Math.round(Q*bP*(1-f)):0;
  const totalCost=Q>0?Math.round(Q*COGSunit):0;

  return{profit:bp,P:bP,priceRatio:bP/wtp.WTPref,share:bS,Q:Math.round(Q),
    WTPref:wtp.WTPref,gammaRaw:wtp.gamma,gammaEff:gEff,Vscore:Vs,Meff,f,
    hwPerUnit:Math.round(hwPerUnit),COGSunit:Math.round(COGSunit),ltv:Math.round(ltv),
    attach:att,revenue,totalCost,pen};
}

function main(){
  console.log("╔═══════════════════════════════════════════════════════════════════════╗");
  console.log("║  EMBA-AI-SIM Round 2 引擎 — 最终参数全景验证                        ║");
  console.log("╚═══════════════════════════════════════════════════════════════════════╝\n");

  // === 参数改动总结 ===
  console.log("  ┌─────────────────────────────────────────────────────┐");
  console.log("  │ 参数改动总结 (vs 原始引擎)                         │");
  console.log("  ├──────────────┬──────────┬──────────┬───────────────┤");
  console.log("  │ 参数         │ 原值     │ 新值     │ 性质          │");
  console.log("  ├──────────────┼──────────┼──────────┼───────────────┤");
  console.log("  │ F            │ 800万    │ 500万    │ 调整          │");
  console.log("  │ f_ToC        │ 0.30     │ 0.25     │ 调整          │");
  console.log("  │ f_ToB        │ 0.10     │ 0.15     │ 调整          │");
  console.log("  │ friction_ToB │ 0.30     │ 0.65     │ 调整          │");
  console.log("  │ μ (DIFF only)│ 不存在   │ 1.89     │ 新增          │");
  console.log("  ├──────────────┼──────────┴──────────┴───────────────┤");
  console.log("  │ γ 公式       │ DIFF: γ/(1+μ×V), COST: γ (原始)    │");
  console.log("  │ 校准值       │ α=-9, wI=5.4, wfit=6.0             │");
  console.log("  │ 不动         │ Panchor, V, cv, σ_log, Perc, Aw, N │");
  console.log("  └──────────────┴─────────────────────────────────────┘\n");

  // === 1. WTP & γ 总览 ===
  console.log("\n  ═══ 1. WTP & γ 总览 ═══\n");
  console.log("  格子           | strategy | WTPref  | γ_raw | γ_eff(精准) | γ_eff(错配) | Meff       | f");
  console.log("  "+"-".repeat(95));
  const gridKeys=Object.keys(GRIDS);
  for(const gk of gridKeys){
    for(const st of ["DIFF","COST"]){
      const age=gk.split("_")[1];const ch=gk.split("_")[0];
      const wtp=computeWTP(ch,st,age);
      const vsP=computeVscore(profiles.precise);
      const vsM=computeVscore(profiles.mismatch);
      const gP=st==="DIFF"?wtp.gamma/(1+mu*vsP):wtp.gamma;
      const gM=st==="DIFF"?wtp.gamma/(1+mu*vsM):wtp.gamma;
      const grid=GRIDS[gk];const N=st==="DIFF"?grid.N_DIFF:grid.N_COST;const Meff=N*grid.Aw*grid.friction;
      console.log(
        `  ${gk.padEnd(16)} | ${st.padEnd(8)} | ¥${Math.round(wtp.WTPref).toString().padStart(6)} | ${wtp.gamma.toFixed(2)} |`+
        `    ${gP.toFixed(2).padStart(5)}     |    ${gM.toFixed(2).padStart(5)}     | ${Meff.toLocaleString().padStart(10)} | ${grid.f}`
      );
    }
  }

  // === 2. 精准场景全 12 格 ===
  console.log("\n\n  ═══ 2. 精准场景 — 全 12 格 ═══\n");
  console.log("  格子           | strategy | 利润(万) | 销量    | Pr(buy) | 最优P  | P/WTP | γ_eff | 单台HW | 单台订阅");
  console.log("  "+"-".repeat(110));
  for(const gk of gridKeys){
    for(const st of ["DIFF","COST"]){
      const r=run(gk,st,profiles.precise);
      const flag=(r.priceRatio>=0.65&&r.priceRatio<=0.90)?"✓":(r.priceRatio>=0.60?"~":"⚠");
      console.log(
        `  ${gk.padEnd(16)} | ${st.padEnd(8)} | ${(r.profit/1e4).toFixed(0).padStart(7)} | ${String(r.Q).padStart(7)} | ${(r.share*100).toFixed(3).padStart(6)}% |`+
        ` ¥${String(r.P).padStart(5)} | ${(r.priceRatio*100).toFixed(1).padStart(4)}%${flag} |`+
        ` ${r.gammaEff.toFixed(2).padStart(5)} | ¥${String(r.hwPerUnit).padStart(5)} | ¥${String(r.ltv).padStart(4)}`
      );
    }
  }

  // === 3. 排序验证 ===
  console.log("\n\n  ═══ 3. 排序验证 (精准 > 堆料 > 错配) ═══\n");
  console.log("  格子           | strategy | 精准(万)  | 堆料(万)  | 错配(万)  | 排序 | 精-错差距");
  console.log("  "+"-".repeat(90));
  let allOK=true;
  for(const gk of gridKeys){
    for(const st of ["DIFF","COST"]){
      const rP=run(gk,st,profiles.precise);
      const rL=run(gk,st,profiles.pileup);
      const rM=run(gk,st,profiles.mismatch);
      const ok=rP.profit>rL.profit&&rL.profit>rM.profit;
      if(!ok) allOK=false;
      const gap=rP.profit>0?((rP.profit-rM.profit)/rP.profit*100).toFixed(0)+"%":"N/A";
      console.log(
        `  ${gk.padEnd(16)} | ${st.padEnd(8)} | ${(rP.profit/1e4).toFixed(0).padStart(8)} | ${(rL.profit/1e4).toFixed(0).padStart(8)} | ${(rM.profit/1e4).toFixed(0).padStart(8)} |`+
        `  ${ok?"✓":"✗"}   | ${gap.padStart(7)}`
      );
    }
  }
  console.log(`\n  排序全部正确: ${allOK?"✓ YES":"✗ NO"}`);

  // === 4. B/C 利润比 ===
  console.log("\n\n  ═══ 4. B/C 利润比 (精准场景) ═══\n");
  console.log("  age    | strategy | ToC利润(万) | ToB利润(万) | B/C比  | 状态 | P%ToC | P%ToB");
  console.log("  "+"-".repeat(90));
  for(const age of ["ELDER","ADULT","CHILD"]){
    for(const st of ["DIFF","COST"]){
      const rC=run(`ToC_${age}`,st,profiles.precise);
      const rB=run(`ToB_${age}`,st,profiles.precise);
      const bc=(rC.profit>0&&rB.profit>0)?Math.max(rC.profit,rB.profit)/Math.min(rC.profit,rB.profit):99;
      const flag=bc<=1.5?"✓":bc<=2.0?"~":"⚠";
      console.log(
        `  ${age.padEnd(7)} | ${st.padEnd(8)} | ${(rC.profit/1e4).toFixed(0).padStart(9)} | ${(rB.profit/1e4).toFixed(0).padStart(9)} |`+
        ` ${bc.toFixed(2).padStart(5)}x | ${flag.padStart(2)}   | ${(rC.priceRatio*100).toFixed(1).padStart(5)}% | ${(rB.priceRatio*100).toFixed(1).padStart(5)}%`
      );
    }
  }

  // === 5. γ 机制可解释性 ===
  console.log("\n\n  ═══ 5. γ 机制可解释性 ═══\n");
  console.log("  DIFF 格: γ_eff = γ_raw / (1 + 1.89 × Vscore)\n");
  console.log("  场景 | Vscore | γ_raw → γ_eff | 最优P/WTP | 解读");
  console.log("  "+"-".repeat(75));
  for(const [k,sc] of Object.entries(profiles)){
    const wtp=computeWTP("ToC","DIFF","ADULT");
    const vs=computeVscore(sc);
    const ge=wtp.gamma/(1+mu*vs);
    const r=run("ToC_ADULT","DIFF",sc);
    console.log(
      `  ${sc.label.padEnd(4)} |  ${vs.toFixed(3)} | ${wtp.gamma.toFixed(2)} →  ${ge.toFixed(2)}  |`+
      `  ${(r.priceRatio*100).toFixed(1).padStart(5)}%    | ${vs>0.2?"产品力强→消费者不在意价格→可以定高价":vs>0.1?"中等产品力→价格有些敏感":"产品力弱→非常在意价格→只能低价竞争"}`
    );
  }

  console.log("\n  COST 格: γ_eff = γ_raw (不变换)\n");
  console.log("  解读: 成本策略靠价格竞争力, 不靠溢价, 所以 μ 不生效");

  // === 6. 单台经济学分解 (ADULT DIFF) ===
  console.log("\n\n  ═══ 6. 单台经济学分解 (ToC_ADULT DIFF 精准) ═══\n");
  const r=run("ToC_ADULT","DIFF",profiles.precise);
  const rev=r.P*(1-r.f);
  const cogs=r.COGSunit;
  const hw=rev-cogs;
  console.log(`  售价:        ¥${r.P}`);
  console.log(`  渠道费:      ¥${Math.round(r.P*r.f)} (${(r.f*100).toFixed(0)}%)`);
  console.log(`  到手收入:    ¥${Math.round(rev)}`);
  console.log(`  COGS:`);
  console.log(`    可变成本:  ¥${V}`);
  console.log(`    固定成本:  ¥${Math.round(F/r.Q)} (F=${(F/1e4).toFixed(0)}万 ÷ ${r.Q}台)`);
  console.log(`    增量成本:  ¥${profiles.precise.dCOGS}`);
  console.log(`    合计COGS:  ¥${cogs}`);
  console.log(`  硬件利润/台: ¥${Math.round(hw)}`);
  console.log(`  订阅LTV/台:  ¥${r.ltv} (attach=${(r.attach*100).toFixed(1)}%)`);
  console.log(`  合计/台:     ¥${Math.round(hw+r.ltv)}`);
  console.log(`  总利润:      ${(r.profit/1e4).toFixed(0)}万 (${r.Q}台 × ¥${Math.round(hw+r.ltv)}/台)`);

  // === 7. 教学场景对比 (ADULT DIFF) ===
  console.log("\n\n  ═══ 7. 教学场景对比 — 同一格子(ToC_ADULT DIFF)三队对比 ═══\n");
  console.log("  指标             | 精准队伍        | 堆料队伍        | 错配队伍");
  console.log("  "+"-".repeat(70));
  const rP=run("ToC_ADULT","DIFF",profiles.precise);
  const rL=run("ToC_ADULT","DIFF",profiles.pileup);
  const rM=run("ToC_ADULT","DIFF",profiles.mismatch);
  
  const rows=[
    ["产品力 Vscore",rP.Vscore.toFixed(2),rL.Vscore.toFixed(2),rM.Vscore.toFixed(2)],
    ["γ_eff (越低=越不敏感)",rP.gammaEff.toFixed(2),rL.gammaEff.toFixed(2),rM.gammaEff.toFixed(2)],
    ["最优定价",`¥${rP.P}`,`¥${rL.P}`,`¥${rM.P}`],
    ["定价/WTPref",`${(rP.priceRatio*100).toFixed(1)}%`,`${(rL.priceRatio*100).toFixed(1)}%`,`${(rM.priceRatio*100).toFixed(1)}%`],
    ["转化率 Pr(buy)",`${(rP.share*100).toFixed(3)}%`,`${(rL.share*100).toFixed(3)}%`,`${(rM.share*100).toFixed(3)}%`],
    ["销量",`${rP.Q}台`,`${rL.Q}台`,`${rM.Q}台`],
    ["单台COGS",`¥${rP.COGSunit}`,`¥${rL.COGSunit}`,`¥${rM.COGSunit}`],
    ["单台硬件利润",`¥${rP.hwPerUnit}`,`¥${rL.hwPerUnit}`,`¥${rM.hwPerUnit}`],
    ["订阅LTV/台",`¥${rP.ltv}`,`¥${rL.ltv}`,`¥${rM.ltv}`],
    ["总利润",`${(rP.profit/1e4).toFixed(0)}万`,`${(rL.profit/1e4).toFixed(0)}万`,`${(rM.profit/1e4).toFixed(0)}万`],
  ];
  for(const row of rows){
    console.log(`  ${row[0].padEnd(20)} | ${row[1].padStart(13)}  | ${row[2].padStart(13)}  | ${row[3].padStart(13)}`);
  }

  // === 8. 教学洞察 ===
  console.log("\n\n  ═══ 8. 教学洞察 ═══\n");
  
  console.log("  1. 选卡质量决定一切（精准 vs 错配）");
  console.log(`     精准: ${(rP.profit/1e4).toFixed(0)}万 → 错配: ${(rM.profit/1e4).toFixed(0)}万`);
  console.log(`     差距来自: 转化率(${(rP.share/rM.share).toFixed(0)}倍) × 单台利润(¥${rP.hwPerUnit} vs ¥${rM.hwPerUnit})`);
  console.log(`     → "选对功能比选多功能重要"`);

  console.log("\n  2. 产品好 → 可以卖更贵（γ 机制）");
  console.log(`     精准γ=${rP.gammaEff.toFixed(2)} → 定价${(rP.priceRatio*100).toFixed(0)}% WTP`);
  console.log(`     错配γ=${rM.gammaEff.toFixed(2)} → 定价${(rM.priceRatio*100).toFixed(0)}% WTP`);
  console.log(`     → "好产品的溢价来自消费者信任, 不是定价策略"`);

  console.log("\n  3. 堆料≠好产品（堆料 vs 精准）");
  console.log(`     堆料dCOGS=¥${profiles.pileup.dCOGS} (精准的${(profiles.pileup.dCOGS/profiles.precise.dCOGS).toFixed(1)}倍)`);
  console.log(`     堆料利润=${(rL.profit/1e4).toFixed(0)}万 (精准的${(rL.profit/rP.profit*100).toFixed(0)}%)`);
  console.log(`     → "花了2倍的钱, 利润反而只有精准的${(rL.profit/rP.profit*100).toFixed(0)}%"`);

  console.log("\n  4. B/C 端差异来自市场结构, 不是产品");
  const rToB=run("ToB_ADULT","DIFF",profiles.precise);
  console.log(`     ToC: f=${GRIDS.ToC_ADULT.f}, Meff=${(GRIDS.ToC_ADULT.N_DIFF*GRIDS.ToC_ADULT.Aw*GRIDS.ToC_ADULT.friction/1e6).toFixed(1)}M → ${(rP.profit/1e4).toFixed(0)}万`);
  console.log(`     ToB: f=${GRIDS.ToB_ADULT.f}, Meff=${(GRIDS.ToB_ADULT.N_DIFF*GRIDS.ToB_ADULT.Aw*GRIDS.ToB_ADULT.friction/1e6).toFixed(1)}M → ${(rToB.profit/1e4).toFixed(0)}万`);
  console.log(`     → "同样的产品, 渠道和市场选择决定了利润天花板"`);

  console.log("\n  5. 错配队伍的死亡螺旋");
  console.log(`     转化率低(${(rM.share*100).toFixed(3)}%) → 量少(${rM.Q}台) → F摊不薄 → 单台成本¥${rM.COGSunit}`);
  console.log(`     → "不是定价错了, 是没人想买你的产品"`);

  // === 9. 问题清单 ===
  console.log("\n\n  ═══ 9. 问题清单 ═══\n");
  let issues=[];
  for(const gk of gridKeys){
    for(const st of ["DIFF","COST"]){
      const rP=run(gk,st,profiles.precise);
      const rL=run(gk,st,profiles.pileup);
      const rM=run(gk,st,profiles.mismatch);
      if(rP.priceRatio>0.95) issues.push(`${gk}_${st}: 精准P/WTP=${(rP.priceRatio*100).toFixed(1)}% (过高)`);
      if(rP.profit<0) issues.push(`${gk}_${st}: 精准亏损`);
      if(!(rP.profit>rL.profit&&rL.profit>rM.profit)) issues.push(`${gk}_${st}: 排序错误`);
    }
  }
  for(const age of ["ELDER","ADULT","CHILD"]){
    for(const st of ["DIFF","COST"]){
      const rC=run(`ToC_${age}`,st,profiles.precise);
      const rB=run(`ToB_${age}`,st,profiles.precise);
      const bc=(rC.profit>0&&rB.profit>0)?Math.max(rC.profit,rB.profit)/Math.min(rC.profit,rB.profit):99;
      if(bc>2.0) issues.push(`${age}_${st}: B/C比=${bc.toFixed(2)}x (>2.0)`);
    }
  }
  if(issues.length===0) console.log("  无严重问题 ✓");
  else{
    for(const iss of issues) console.log(`  ${iss.includes(">2.0")?"~":"⚠"} ${iss}`);
  }

  // === 10. JSON ===
  console.log("\n\n  ═══ 10. 最终推荐参数 JSON ═══\n");
  const gj={};for(const [k,v] of Object.entries(GRIDS)) gj[k]={N_DIFF:v.N_DIFF,N_COST:v.N_COST,Aw:v.Aw,friction:parseFloat(v.friction.toFixed(4)),f:v.f};
  console.log(JSON.stringify({
    global:{alpha:-9,Panchor:30000,Nsteps:20,V:4200,F:5000000,S_monthly:99,gm_sub:0.7,T:24},
    gamma_transform:{
      formula_DIFF:"γ_eff = γ_raw / (1 + μ × Vscore)",
      formula_COST:"γ_eff = γ_raw",
      mu:1.8889,
      interpretation:"DIFF:产品越好→价格越不敏感; COST:靠价格竞争,γ不变"
    },
    shape:{cv:SHAPE.cv,sigma_log:SHAPE.sigma_log},
    percentiles:PERCENTILES,
    grids:gj,
    logit_weights:{wI:5.4,wfit:6.0,wsub:0.5,wrisk:-1.0,wcx:-0.5},
    changes_from_original:["F: 800万→500万","f_ToC: 0.30→0.25","f_ToB: 0.10→0.15","friction_ToB: 0.30→0.65","μ=1.89 新增(DIFF only)"]
  },null,2));
}

main();
