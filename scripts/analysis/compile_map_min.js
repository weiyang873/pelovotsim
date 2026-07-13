"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const ROOT = path.join(__dirname, "..", "..");
const SOURCE_RUN = "sim_layered_newflow_2026-07-10T23-54-52-761Z";
const ROSTER_PATH = path.join(ROOT, "data", "persona_sim_logs", SOURCE_RUN, "students_summary.csv");
const OUTPUTS = {
  caogen: path.join(__dirname, "cognitive_map_caogen_min.json"),
  erdai: path.join(__dirname, "cognitive_map_erdai_min.json")
};
const PERSONAS = [
  {
    key: "caogen",
    archetype: "草根老板",
    idPrefix: "map_caogen_",
    blindTerms: ["品牌", "调性", "海外", "澳洲", "美国", "欧洲", "留学", "出国", "国际化", "外国", "外贸", "数字化", "线上营销", "供应链金融", "AI"]
  },
  {
    key: "erdai",
    archetype: "二代接班人",
    idPrefix: "map_erdai_",
    blindTerms: ["单耗", "工序", "机修", "模具", "原料", "良率", "库存", "亩产", "季节性风险", "一线成本", "单件成本", "生产成本", "夜班排班"]
  }
];
const GAME_TERMS = ["LOVOT", "陪伴机器人", "能力卡", "格子名", "ToB_", "ToC_", "B2B_", "B2C_"];

const DRAFTS = {
  caogen: {
    experiences: [
      "95年借3万元，在县城租两间房开五金作坊",
      "第一台二手机床花1.8万元，用了整整8年",
      "开张时只有3个工人，他每天跟着装货送货",
      "第1个客户是老同学介绍的建材店老板",
      "97年客户压价5%，他靠加量拿下整年订单",
      "3个老师傅说设备能修，他当场决定不换新",
      "2001年先赊给老客户2万元货，月底全收回",
      "一批螺丝少赚800元，却换来客户连续下单",
      "建材旺季连干30天，他每天先看出货车数",
      "老客户拖款60天，他亲自吃饭把账催回来",
      "2008年订单骤减，他先砍掉2个慢销品类",
      "当年拿5万元试做新规格，卖完才继续追加",
      "第一次接农产品加工单，只先收了30%订金",
      "碰到新生意，他固定先问2个老部下的意见",
      "一次会议听了10分钟报表，就追问订单在哪",
      "新产品先做100件试水，卖动后才开第二批",
      "首批返工损失6000元，他认作交学费没停单",
      "账期从90天谈到45天，现金一下宽松许多",
      "给采购关系留2000元机动款，订单少卡一周",
      "一次现金只剩4万元，他先保工资再付供应商",
      "农产品线先试加工5吨，客户复购才扩到20吨",
      "连续3天暴雨停运，他临时找了2辆本地货车",
      "时间紧时把5个方案砍成“干”和“不干”",
      "一次饭局20分钟，他凭老板态度判断单能做",
      "看见3页长数据就犯困，听到成本数马上追问",
      "老会计报出毛利少2个点，他当天就重谈采购",
      "曾误判一个风口，压了7万元货才慢慢清掉",
      "遇到类似难题，他会翻出10年前那笔旧账",
      "手里3家厂各有1个跟了十年以上的老负责人",
      "一批包装每件贵2元，他直接换回熟悉供应商",
      "夜班师傅月薪加500元后，关键岗位稳了半年",
      "机器停1天损失近9000元，他先修再谈升级",
      "给20个骨干各发1000元奖金，赶完急单",
      "抽检发现30件次品，他让整批500件重查",
      "仓库压着4万元慢货，他搭给畅销品一起出",
      "客户投诉第2次时，他带厂长当天上门换货",
      "一张8万元急单利润薄，他为保关系仍然接了",
      "压力最大那周，他连续3次说“再看看”拖决定",
      "一次报价高出同行3000元，客户转身就走",
      "商会饭局上认识2个老板，半年后带来3笔单"
    ],
    beliefs: [
      "先做一小批，卖得动再加码",
      "账上有现金，比纸面利润更踏实",
      "熟人肯担保，生意就多一半把握",
      "够用就行，花架子不能多赚一分钱",
      "客户反复压价，说明他其实想买",
      "老员工敢说真话，比长报表更可信",
      "亏一小单能学会门道，就不算白亏",
      "订单和回款说得清，项目才值得干",
      "成本每省下一块，都是自己挣的一块",
      "拿不准时先拖一拖，好过一脚踩空"
    ]
  },
  erdai: {
    experiences: [
      "18岁去澳洲读书，第一次独自租房签12个月",
      "留学第1年学费18万元，父亲要求写年度计划",
      "22岁在当地连锁店实习3个月，负责陈列提案",
      "23岁住过4200元一晚的酒店，记住服务细节",
      "24岁买2.6万元手袋，认同设计能抬高价格",
      "25岁完成硕士答辩，用12页PPT讲增长故事",
      "回国后在家族工厂轮岗6个月，先提形象改造",
      "第2站到地产公司，参与1个社区配套方案",
      "第3站到农场，建议办开放日吸引家庭客户",
      "3年前升任集团最年轻副总，负责转型升级",
      "首个50万元转型提案，被董事会批为太激进",
      "2位长辈连续追问风险，她改用同业案例回应",
      "一次30万元形象更新，被要求先证明长期回报",
      "董事会前夜，她重做了12页大框架而非细表",
      "拿不准方向时，她私下问3个年轻中层",
      "第1次被否后，她没有向长辈追问判断依据",
      "美国考察7天，她拍下20个新零售服务细节",
      "欧洲论坛门票1.2万元，她重点记录ESG案例",
      "澳洲社区活动用200人故事打动了她",
      "她推动20万元公益项目，董事会要求挂钩声誉",
      "员工福利方案预算8万元，她在会上主动加码",
      "环保包装试点15万元，她主张先立项再优化",
      "连锁门店改造38万元，她先讲体验再讲回报",
      "请顾问做定位方案花12万元，换来董事会背书",
      "一次展会预算30万元，她坚持做沉浸式展台",
      "行业报告订阅6万元，她用数据支撑原有判断",
      "2天管理层共创营花9万元，产出一张战略图",
      "百人社区活动花18万元，媒体报道带来关注",
      "请5位达人合作花25万元，她看重话题扩散",
      "一个体验试点预算60万元，她建议先跑再细化",
      "董事会把60万元试点砍到20万元，她仍先启动",
      "转型方案被压了2次，她转而寻找外部权威案例",
      "她为集团3家公司画过同一套升级路线图",
      "每次定方向前，她会约4个年轻经理喝咖啡",
      "会上只有10分钟时，她先讲big picture",
      "复杂问题来不及拆时，她先画2页框架立项",
      "接到临时任务后48小时，她先交愿景版方案",
      "一次高管礼品预算10万元，她优先选设计感",
      "赴外考察8万元，她把照片整理成趋势提案",
      "集团奖学金项目20万元，她强调长期社会价值"
    ],
    beliefs: [
      "东西太便宜，客户反而不相信它有价值",
      "先把方向立住，执行细节可以边做边调",
      "外部成熟案例能降低董事会的心理阻力",
      "体验被人记住，价格就不再是唯一标准",
      "企业承担社会责任，长期会转成信任",
      "年轻团队更懂新趋势，也更愿意尝试",
      "大框架讲清楚，资源自然会向项目靠拢",
      "权威背书能让激进方案显得没那么冒险",
      "高投入只要能形成差异，就值得先试",
      "不能只看眼前回报，要看长期位置"
    ]
  }
};

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function readCsv(filePath) {
  const text = fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, "");
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') {
        cell += '"';
        i += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        cell += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === ",") {
      row.push(cell);
      cell = "";
    } else if (char === "\n") {
      row.push(cell);
      if (row.some((value) => value !== "")) rows.push(row);
      row = [];
      cell = "";
    } else if (char !== "\r") {
      cell += char;
    }
  }
  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }
  const headers = rows.shift() || [];
  return rows.map((values) => Object.fromEntries(headers.map((header, index) => [header, values[index] || ""])));
}

function parseJsonCell(value, label, memberKey) {
  try {
    return JSON.parse(String(value || ""));
  } catch (error) {
    throw new Error(`${memberKey}: invalid ${label}: ${error.message || error}`);
  }
}

function loadSelectedMembers() {
  const rows = readCsv(ROSTER_PATH);
  if (rows.length !== 72) throw new Error(`expected 72 roster rows, got ${rows.length}`);
  return PERSONAS.map((spec) => {
    const row = rows.find((candidate) => candidate.persona === spec.archetype);
    if (!row) throw new Error(`missing roster archetype: ${spec.archetype}`);
    const memberKey = `t${row.team_index}_m${row.member_index}`;
    const seedMemory = parseJsonCell(row.seed_memory_json, "seed_memory_json", memberKey);
    const classroomProfile = parseJsonCell(row.classroom_profile_json, "classroom_profile_json", memberKey);
    return {
      ...spec,
      memberKey,
      name: row.name,
      sourceSha256: sha256(`${row.seed_memory_json}\n${row.classroom_profile_json}`)
    };
  });
}

function buildMap(member) {
  const draft = DRAFTS[member.key];
  return [...draft.experiences, ...draft.beliefs].map((content, index) => ({
    id: `${member.idPrefix}${String(index + 1).padStart(2, "0")}`,
    type: index < 40 ? "经验" : "信条",
    content
  }));
}

function extractYuanAmounts(items) {
  const amounts = [];
  const pattern = /(\d+(?:\.\d+)?)\s*(万)?\s*元/g;
  for (const item of items) {
    let match;
    while ((match = pattern.exec(String(item.content || "")))) {
      amounts.push(Number(match[1]) * (match[2] ? 10000 : 1));
    }
  }
  return amounts.sort((a, b) => a - b);
}

function median(values) {
  if (!values.length) return null;
  const middle = Math.floor(values.length / 2);
  return values.length % 2 ? values[middle] : (values[middle - 1] + values[middle]) / 2;
}

function validateMap(items, member) {
  const errors = [];
  if (!Array.isArray(items) || items.length !== 50) errors.push(`expected 50 rows, got ${items?.length}`);
  const contents = new Set();
  (items || []).forEach((item, index) => {
    const expectedId = `${member.idPrefix}${String(index + 1).padStart(2, "0")}`;
    const expectedType = index < 40 ? "经验" : "信条";
    if (Object.keys(item).sort().join(",") !== "content,id,type") errors.push(`${expectedId}: invalid fields`);
    if (item.id !== expectedId) errors.push(`row ${index + 1}: expected ${expectedId}`);
    if (item.type !== expectedType) errors.push(`${expectedId}: expected ${expectedType}`);
    const content = String(item.content || "").trim();
    if (!content || Array.from(content).length > 50) errors.push(`${expectedId}: invalid content length`);
    if (contents.has(content)) errors.push(`${expectedId}: duplicate content`);
    contents.add(content);
    for (const term of [...member.blindTerms, ...GAME_TERMS]) {
      if (content.toLowerCase().includes(term.toLowerCase())) errors.push(`${expectedId}: forbidden term ${term}`);
    }
    if (index < 40 && !/[0-9一二三四五六七八九十百千万年月日]/.test(content)) {
      errors.push(`${expectedId}: experience lacks a concrete marker`);
    }
  });
  const amounts = extractYuanAmounts(items || []);
  if (amounts.length < 12) errors.push(`expected at least 12 yuan amounts, got ${amounts.length}`);
  if (member.key === "caogen" && amounts.some((amount) => amount > 100000)) errors.push("caogen amount exceeds 100000 yuan");
  if (member.key === "erdai" && amounts.some((amount) => amount < 1000 || amount > 1000000)) {
    errors.push("erdai amount outside 1000-1000000 yuan");
  }
  if (errors.length) throw new Error(`${member.memberKey}: ${errors.join("; ")}`);
  return { amountCount: amounts.length, amountMedianYuan: median(amounts) };
}

function main() {
  for (const outputPath of Object.values(OUTPUTS)) {
    if (fs.existsSync(outputPath)) throw new Error(`refusing to overwrite frozen map: ${outputPath}`);
  }
  const members = loadSelectedMembers();
  const compiled = members.map((member) => {
    const items = buildMap(member);
    return { member, items, validation: validateMap(items, member) };
  });
  const caogen = compiled.find((entry) => entry.member.key === "caogen");
  const erdai = compiled.find((entry) => entry.member.key === "erdai");
  if (erdai.validation.amountMedianYuan < caogen.validation.amountMedianYuan * 3) {
    throw new Error(`amount separation failed: ${caogen.validation.amountMedianYuan} vs ${erdai.validation.amountMedianYuan}`);
  }

  const pending = compiled.map((entry) => {
    const outputPath = OUTPUTS[entry.member.key];
    const tempPath = `${outputPath}.tmp-${process.pid}`;
    const payload = `${JSON.stringify(entry.items, null, 2)}\n`;
    fs.writeFileSync(tempPath, payload, { encoding: "utf8", flag: "wx" });
    return { entry, outputPath, tempPath, payload };
  });
  for (const item of pending) fs.renameSync(item.tempPath, item.outputPath);
  for (const { entry, outputPath, payload } of pending) {
    console.log(JSON.stringify({
      archetype: entry.member.archetype,
      member_key: entry.member.memberKey,
      name: entry.member.name,
      output: outputPath,
      sha256: sha256(payload),
      source_sha256: entry.member.sourceSha256,
      amount_count: entry.validation.amountCount,
      amount_median_yuan: entry.validation.amountMedianYuan
    }));
  }
}

try {
  main();
} catch (error) {
  console.error(error.stack || error.message || String(error));
  process.exitCode = 1;
}
