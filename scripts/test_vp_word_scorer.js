"use strict";

const { extractVpFields } = require("../server/llm/vpEmbeddingScorer");
const { scorePreparedVpByWord, prepareVpForWordScoring, scoreVpByWord } = require("../server/llm/vpWordScorer");

const CALIBRATION = [
  { grid: "ToB_Cost_Elder", arch: "Hybrid", vp: "养老院用。老人孤单，员工忙。机器人陪聊。", expected: "差" },
  { grid: "ToC_Diff_Adult", arch: "Experience", vp: "年轻人买，好玩。", expected: "差" },
  { grid: "ToB_Cost_Elder", arch: "Hybrid", vp: "为护工短缺的养老院，提供能陪聊的机器人，让员工能去忙别的事，比请人便宜。失智老人不行。", expected: "中" },
  { grid: "ToC_Diff_Adult", arch: "Experience", vp: "为独居白领，下班回家冷清，提供能主动蹭腿的陪伴机器人，比智能音箱有温度。长期出差不适用。", expected: "中" },
  { grid: "ToB_Cost_Elder", arch: "Hybrid", vp: "为面临护工成本上涨和夜间跌倒高风险的养老机构，提供具备离床监测功能的机器人，通过替代部分人工巡检来优化人力配置并实现风险主动预防——传统依赖人力巡检难以实时响应且成本刚性上涨。失智老人特殊照护单元需结合个性化护理。", expected: "好" },
  { grid: "ToC_Diff_Adult", arch: "Experience", vp: "为25-35岁一线城市独居、每天加班到9点回家只有冰箱声的单身白领，提供一台回家时主动蹭腿发出声音的陪伴机器人，获得不需要维护关系的即时情感连接——智能音箱只能被动问候，养猫狗要喂要遛出差要寄养。长期出差超两周效果打折。", expected: "好" },
  { grid: "ToB_Diff_Child", arch: "Experience", vp: "幼儿园放个机器人，小孩喜欢。", expected: "差" },
  { grid: "ToB_Diff_Child", arch: "Experience", vp: "为每年9月新入园哭闹严重的幼儿园，提供能用光效和声音吸引孩子注意力的陪伴机器人，减轻老师安抚压力。比传统玩具更持久。", expected: "中" },
  { grid: "ToB_Diff_Child", arch: "Experience", vp: "为师幼比严重不足、每年9月新生入园哭闹导致老师疲于安抚的民办幼儿园，提供能通过光效互动和非指令性陪伴持续吸引3-5岁幼儿注意力的机器人，让老师从一对一安抚中解放出来专注集体教学——目前只能靠增加临时老师或家长陪园，成本高且不可持续。自闭症等特殊需求儿童需专业干预。", expected: "好" },
  { grid: "ToC_Cost_Elder", arch: "Function", vp: "老人用，便宜。", expected: "差" },
  { grid: "ToC_Cost_Elder", arch: "Function", vp: "为独居老人的子女，提供能让老人不孤单的机器人，比请保姆便宜。老人不愿意用的话没办法。", expected: "中" },
  { grid: "ToC_Cost_Elder", arch: "Function", vp: "为在外地工作、无法经常回家探望独居父母的子女，提供一台能主动陪父母聊天并在异常情况下通知子女的机器人，缓解子女的远程愧疚感同时降低请钟点工陪护的费用——目前只能靠定期打电话但父母报喜不报忧，请保姆月费高且陪伴质量取决于个人。视力听力严重退化的老人使用受限。", expected: "好" }
];

function summarizeBuckets(results) {
  const grouped = { "差": [], "中": [], "好": [] };
  for (const item of results) {
    grouped[item.expected].push(item.result.scores.VPscore);
  }
  const bad = grouped["差"].reduce((sum, value) => sum + value, 0) / grouped["差"].length;
  const mid = grouped["中"].reduce((sum, value) => sum + value, 0) / grouped["中"].length;
  const good = grouped["好"].reduce((sum, value) => sum + value, 0) / grouped["好"].length;
  return {
    bad: Number(bad.toFixed(3)),
    mid: Number(mid.toFixed(3)),
    good: Number(good.toFixed(3)),
    separated: bad < mid && mid < good
  };
}

function printMatchDetails(prefix, matchDetails) {
  for (const d of matchDetails) {
    console.log(`    "${d.vpWord}" → "${d.bestAnchorWord}"(${d.bestSim.toFixed(2)}) ${d.qualified ? "✓" : "✗"}`);
  }
}

async function main() {
  console.log("====== VP Word Scorer Calibration ======\n");

  const calibrationResults = [];
  for (const sample of CALIBRATION) {
    const prepared = await prepareVpForWordScoring(sample.vp);
    const result = await scorePreparedVpByWord(prepared, sample.grid, sample.arch);
    calibrationResults.push({ expected: sample.expected, sample, prepared, result });

    console.log(`[${sample.expected}] grid=${sample.grid} arch=${sample.arch}`);
    console.log(`  VP: "${sample.vp}"`);
    console.log("  fields:");
    console.log(`    who: "${result.fields.who_raw}"`);
    console.log(`    pain: "${result.fields.pain_raw}"`);
    console.log(`    how: "${result.fields.how_raw}"`);
    console.log(`    alt: "${result.fields.alternative_raw}"`);
    console.log(`    boundary: "${result.fields.boundary_raw}"`);
    console.log();

    console.log(`  C: who_coverage=${result.details.who_coverage.toFixed(2)}(${result.details.who_coverage >= 0.2 ? "PASS" : "FAIL"}) simSum=${result.details.C_match.simSum.toFixed(2)}`);
    printMatchDetails("C", result.details.C_match.matchDetails);
    console.log(`  C = ${result.scores.C}`);
    console.log();

    console.log(`  G: (去掉C命中的${result.details.G_match.excludedCount}个anchor词) simSum=${result.details.G_match.simSum.toFixed(2)}`);
    printMatchDetails("G", result.details.G_match.matchDetails);
    console.log(`  G = ${result.scores.G}`);
    console.log();

    console.log(`  E: (how vs pain 内部匹配) simSum=${result.details.E_match.simSum.toFixed(2)}`);
    printMatchDetails("E", result.details.E_match.matchDetails);
    console.log(`  E = ${result.scores.E} (含 alt_bonus=${result.details.alt_bonus.toFixed(1)} bnd_bonus=${result.details.bnd_bonus.toFixed(1)})`);
    console.log();

    const avgGE = ((result.scores.G + result.scores.E) / 2).toFixed(1);
    console.log(`  VPscore = sqrt(${result.scores.C.toFixed(1)} × avg(${result.scores.G.toFixed(1)}, ${result.scores.E.toFixed(1)})) = sqrt(${result.scores.C.toFixed(1)} × ${avgGE}) = ${result.scores.VPscore.toFixed(1)}`);
    console.log();
  }

  const summary = summarizeBuckets(calibrationResults);
  console.log(`Bucket averages: 差=${summary.bad} 中=${summary.mid} 好=${summary.good}`);
  console.log(`Three-tier separated: ${summary.separated ? "YES" : "NO"}`);
  console.log();

  console.log("====== minSim Scan (12 samples) ======");
  console.log("minSim | 差avg | 中avg | 好avg | gap(好-差) | separated?");
  for (let minSim = 0.30; minSim <= 0.75 + 1e-9; minSim += 0.05) {
    const rescored = [];
    for (const item of calibrationResults) {
      const rescoredResult = await scorePreparedVpByWord(item.prepared, item.sample.grid, item.sample.arch, {
        minSim: Number(minSim.toFixed(2))
      });
      rescored.push({ expected: item.expected, result: rescoredResult });
    }
    const scanSummary = summarizeBuckets(rescored);
    const gap = Number((scanSummary.good - scanSummary.bad).toFixed(3));
    console.log(` ${minSim.toFixed(2)}  | ${scanSummary.bad.toFixed(2)}  | ${scanSummary.mid.toFixed(2)}  | ${scanSummary.good.toFixed(2)}  | ${gap.toFixed(2)}       | ${scanSummary.separated ? "YES" : "NO"}`);
  }

  const fields = await extractVpFields(CALIBRATION[0].vp);
  const r1 = await scoreVpByWord(fields, CALIBRATION[0].grid, CALIBRATION[0].arch);
  const r2 = await scoreVpByWord(fields, CALIBRATION[0].grid, CALIBRATION[0].arch);
  console.log(`Deterministic: ${JSON.stringify(r1.scores) === JSON.stringify(r2.scores)}`);
}

main().catch((err) => {
  console.error("test_vp_word_scorer failed:", err);
  process.exit(1);
});
