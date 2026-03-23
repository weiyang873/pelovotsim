"use strict";

const fs = require("fs");
const path = require("path");

const { chatCompletion } = require("../server/llm/deepseekClient");
const { PersonaStudent } = require("./sim/persona_student");

function loadLocalEnvFile() {
  const envPath = path.join(__dirname, "..", ".env");
  if (!fs.existsSync(envPath)) return;
  const text = fs.readFileSync(envPath, "utf8");
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIndex = trimmed.indexOf("=");
    if (eqIndex <= 0) continue;
    const key = trimmed.slice(0, eqIndex).trim();
    let value = trimmed.slice(eqIndex + 1).trim();
    if (
      (value.startsWith("\"") && value.endsWith("\"")) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) {
      process.env[key] = value;
    }
  }
}

function parseJsonObject(text) {
  const raw = String(text || "").replace(/```json|```/g, "").trim();
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  const candidate = start >= 0 && end > start ? raw.slice(start, end + 1) : raw;
  return JSON.parse(candidate);
}

async function sleep(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function callText(messages, options) {
  let lastError = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await chatCompletion(messages, options);
    } catch (err) {
      lastError = err;
      if (attempt < 2) {
        await sleep(1200 * (attempt + 1));
      }
    }
  }
  throw lastError || new Error("text completion failed");
}

async function callJson(messages, options) {
  let lastError = null;
  let completion = "";
  const attempts = [
    { ...options },
    { ...options, max_tokens: Math.max(Number(options?.max_tokens || 0), 520), temperature: 0.7 }
  ];
  for (let index = 0; index < attempts.length; index += 1) {
    const currentMessages = index === 0
      ? messages
      : messages.concat({
          role: "user",
          content: "刚才你的输出不是合法 JSON。请重新只输出完整、闭合、可解析的 JSON，不要解释。"
        });
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        completion = await chatCompletion(currentMessages, attempts[index]);
        return {
          completion,
          parsed: parseJsonObject(completion)
        };
      } catch (err) {
        lastError = err;
        if (attempt < 2) {
          await sleep(1200 * (attempt + 1));
        }
      }
    }
  }
  throw lastError || new Error("JSON parse failed");
}

function seedMemoryToText(seed) {
  return [
    seed.backstory,
    `做决策的习惯：${seed.decision_habit}`,
    `讨论风格：${seed.discussion_style}`,
    `自信区：${seed.confidence_zone}`,
    `盲区：${seed.blind_zone}`,
    `压力下的反应：${seed.under_pressure}`,
    `口头禅/说话习惯：${seed.pet_phrases}`
  ].join("\n");
}

function parseGrid(gridId) {
  const raw = String(gridId || "").toUpperCase();
  return {
    channel: raw.includes("TOB") || raw.includes("B2B") ? "ToB" : "ToC",
    age: raw.includes("ELDER") ? "老人" : raw.includes("CHILD") ? "儿童" : "成人",
    strategy: raw.includes("COST") ? "成本" : "差异化"
  };
}

function gridDescription(gridChoice) {
  const parsed = parseGrid(gridChoice?.grid_id || "");
  return `${parsed.channel} × ${parsed.strategy} × ${parsed.age}`;
}

function getVPLengthConstraint(education) {
  const value = String(education || "").trim();
  if (["中专/高中", "高中", "中专"].includes(value)) {
    return `

输出约束（非常重要）：
- 用一句大白话说你想做什么生意，不要分段
- WHO/PAIN/HOW 每个字段不超过 20 个字
- 不要用任何商业术语或框架
- 写出来应该像跟朋友聊天，不像写报告
- 示例风格："就是给养老院卖个能陪老人说话的机器人"`;
  }

  if (value === "大专") {
    return `

输出约束（重要）：
- 每个字段用 1-2 句话说，总共不超过 80 字
- 不要用商业术语，用日常用语
- 你可以写"老人""小孩""白领"这种大类，不需要精确细分
- 不需要分析替代方案或边界条件`;
  }

  if (["本科（非985）", "本科（国内）"].includes(value)) {
    return `

输出约束：
- 每个字段 2-3 句话
- 可以有基本框架但不需要很精细
- 不需要引用数据或案例`;
  }

  return "";
}

function buildSeedMemoryPrompt(persona) {
  const genderLabel = persona.gender === "male" ? "男" : "女";
  const overseasText = persona.overseas?.hasOverseas
    ? `${persona.overseas.destination}（${persona.overseas.duration}）`
    : "无";

  return `根据以下人物属性，生成一份行为底稿。这不是人物介绍，是用来预测这个人在商业讨论中会怎么表现的内部参考。

人物属性：
姓名：${persona.name}，${genderLabel}，${persona.age}岁
学历：${persona.education}，海外经历：${overseasText}
行业：${persona.industry}
身份：${persona.role}
背景：${persona.background}
性格：${persona.mbti}
决策风格：${persona.decisionStyle}
风险偏好：${persona.riskPreference}
表达风格：${persona.fullExpressionStyle}
盲区：${persona.blindSpots}

输出 JSON，每个字段 1-2 句话，用这个人自己会说的方式写：
{
  "backstory": "他是怎么走到今天的（2句话）",
  "decision_habit": "他做决策时的习惯——先看数据还是先凭直觉？遇到不确定的怎么办？",
  "discussion_style": "在一群人讨论时他通常怎么表现——先说还是先听？什么时候会突然来劲？",
  "confidence_zone": "他对什么领域的判断最有信心，几乎不会犹豫",
  "blind_zone": "他对什么完全不懂但可能不自知，或者知道不懂但会装懂/回避",
 "under_pressure": "时间紧或不确定的时候，他会怎么应对——简化问题？套用经验？还是干脆摆烂？",
  "pet_phrases": "他常挂嘴边的口头禅或说话习惯（1-2个例子）"
}

注意：
- backstory 要平实，不要写传奇故事或名场面，像在填履历表的备注栏
- pet_phrases 给 1-2 个真实口头禅就够，不要编金句
- 所有字段像在写内部评估备忘，不像在写人物专访

只输出合法 JSON。`;
}

function buildReflectionPrompt(seedText) {
  return `下面是你即将上课的一个 EMBA 学生的背景资料：

${seedText}

写一份课堂行为预测，包含两部分。

{
  "abstraction_ability": "low/medium/high（能不能做抽象分析）",
  "writing_precision": "low/medium/high（文字表达的精确程度）",
  "coach_receptiveness": "low/medium/high（对外部反馈的接受程度）",
  "effort_style": "认真打磨/先交差后面改/依赖队友/看心情",
  "team_role": "主导/质疑/跟随/调停",
  "why_here": "来读 EMBA 最核心的一个动机",
  "knowledge_ceiling": "在市场定位/产品战略/用户研究/定价这些领域，他卡在哪里",
  "response_to_AI_coach": "面对 AI 策略顾问的反馈，他最可能的反应"
}

只输出合法 JSON。抓重点，不要面面俱到。`;
}

function buildVpUserPrompt(persona) {
  const choice = {
    grid_id: persona.grid,
    architecture: persona.architecture
  };
  return [
    `你们小组刚完成了战略定位的选择。你选了：${choice.grid_id}，${choice.architecture}。`,
    "现在进入小组讨论环节。系统让每个人先写下自己对这个方向的初步想法，作为讨论的起点。AI 策略顾问会在你们写完后加入讨论，帮你们完善。",
    "",
    "WHO（这个方向要瞄准谁）：",
    "PAIN（他们最大的问题是什么）：",
    "HOW（LOVOT 怎么帮他们）：",
    "",
    "你现在在课堂上做快速商业判断，不是在写方案书。保留你的思维偏向，但只说核心方向，不要编数据、不要写完整机制、不要写系统架构。",
    "",
    "只输出 JSON：{\"who\":\"...\",\"pain\":\"...\",\"how\":\"...\"}"
  ].join("\n");
}

function layer1ToText(layer1) {
  const x = layer1 && typeof layer1 === "object" ? layer1 : {};
  return [
    "## Classroom Profile",
    `抽象能力：${x.abstraction_ability || "未明确"}`,
    `写作精度：${x.writing_precision || "未明确"}`,
    `反馈接受度：${x.coach_receptiveness || "未明确"}`,
    `做事风格：${x.effort_style || "未明确"}`,
    `团队角色：${x.team_role || "未明确"}`,
    `来读动机：${x.why_here || "未明确"}`,
    `知识上限：${x.knowledge_ceiling || "未明确"}`,
    `面对AI教练：${x.response_to_AI_coach || "未明确"}`
  ].join("\n");
}

function buildPlanPrompt(persona) {
  return `你在 Innovation and Internal Entrepreneurship 课上，教授刚讲了 LOVOT 陪伴机器人的案例。你们小组选好了市场方向（${persona.grid}, ${persona.architecture}），现在系统让每个人先写下初步想法，后面有 AI 教练帮完善。

你打算怎么写这个初稿？一句话，说你的打算。`;
}

function formatStructuredAttributes(persona) {
  const genderLabel = persona.gender === "male" ? "男" : "女";
  const overseasText = persona.overseas?.hasOverseas
    ? `${persona.overseas.destination}（${persona.overseas.duration}）`
    : "无";
  return [
    `姓名：${persona.name}`,
    `性别：${genderLabel}`,
    `年龄：${persona.age}`,
    `学历：${persona.education}`,
    `海外：${overseasText}`,
    `行业：${persona.industry}`,
    `身份：${persona.role}`,
    `背景：${persona.background}`,
    `MBTI：${persona.mbti}`,
    `决策风格：${persona.decisionStyle}`,
    `风险偏好：${persona.riskPreference}`,
    `表达风格：${persona.fullExpressionStyle}`,
    `盲区：${persona.blindSpots}`
  ].join("\n");
}

const personas = [
  {
    id: "A", label: "草根老板",
    name: "杨金实", gender: "male", age: 52,
    education: "中专/高中", overseas: { hasOverseas: false },
    industry: "化工、制造、贸易",
    role: "合肥普力先进材料科技有限公司创始人",
    background: "从化工销售员做起，白手起家20年，年营收过亿。经历过原材料价格暴涨、客户跑路、合伙人散伙。对供应链和客户关系有极强直觉，对品牌营销和数字化完全不懂。",
    mbti: "ESTP", decisionStyle: "靠直觉和经验，快刀斩乱麻",
    riskPreference: "高风险偏好，赌过很多次，赢多输少",
    fullExpressionStyle: "说话直接，爱用比喻，经常蹦出几句方言，不喜欢绕弯子",
    blindSpots: "对品牌溢价、数字化营销、理论框架完全没概念",
    vpQuirks: "会从自己做生意的经验出发，用口语表达",
    grid: "ToB_Differentiation_Elder", architecture: "Function"
  },
  {
    id: "B", label: "职业经理人",
    name: "王建荣", gender: "female", age: 38,
    education: "MBA（海外）", overseas: { hasOverseas: true, destination: "美国", duration: "2年" },
    industry: "快消、乳制品、品牌营销",
    role: "伊利集团婴幼儿营养品事业部品牌总监",
    background: "从宝洁管培生做起，历经联合利华、伊利。擅长品牌定位、消费者洞察、渠道策略。习惯用数据和框架说话。",
    mbti: "ENTJ", decisionStyle: "数据驱动，先看 ROI 再决策",
    riskPreference: "中等，偏好可控风险",
    fullExpressionStyle: "条理清晰，喜欢分点论述，会用英文缩写（ROI、NPS、GMV）",
    blindSpots: "对技术实现细节不敏感，对下沉市场缺乏体感",
    vpQuirks: "会从消费者画像和品牌定位角度切入",
    grid: "ToC_Differentiation_Adult", architecture: "Experience"
  },
  {
    id: "C", label: "技术创业者",
    name: "顾山松", gender: "male", age: 41,
    education: "博士（海归）", overseas: { hasOverseas: true, destination: "美国MIT", duration: "6年" },
    industry: "电子特气、半导体材料、化工技术",
    role: "樾达科技（上海）有限公司创始人",
    background: "化工博士，在美国做了3年研发，回国创业做电子特气。公司从零到年营收过亿，正在考虑重资产还是轻资产路线。技术判断极强，商业直觉也不错，但不擅长管人。",
    mbti: "INTJ", decisionStyle: "第一性原理，从技术本质出发倒推商业逻辑",
    riskPreference: "愿意赌技术方向，但对运营风险保守",
    fullExpressionStyle: "逻辑链很长，喜欢类比，有时候过度分析",
    blindSpots: "对渠道、销售管理、组织建设不够重视",
    vpQuirks: "会从技术壁垒和数据飞轮角度思考",
    grid: "ToC_Differentiation_Adult", architecture: "Experience"
  },
  {
    id: "E", label: "体制转型者",
    name: "张应春", gender: "male", age: 50,
    education: "本科（985）", overseas: { hasOverseas: false },
    industry: "企业管理咨询、制造业精益管理",
    role: "朗欧企业管理咨询有限公司创始人",
    background: "在国企干了15年生产管理，出来做管理咨询。客户全是制造业中小企业。对工厂管理、供应链、ERP系统非常熟，对互联网和消费市场不太懂。",
    mbti: "ISTJ", decisionStyle: "稳健，按流程来，不喜欢拍脑袋",
    riskPreference: "低风险偏好，要看到数据才动",
    fullExpressionStyle: "用词准确但偏正式，有时候带点官话腔，写东西比说话强",
    blindSpots: "对 C 端消费者心理、品牌营销、互联网打法不熟",
    vpQuirks: "会从流程管理和落地执行角度思考",
    grid: "ToB_Cost_Elder", architecture: "Function"
  },
  {
    id: "F", label: "销售铁军",
    name: "李书", gender: "male", age: 45,
    education: "大专", overseas: { hasOverseas: false },
    industry: "跨境物流、国际贸易",
    role: "浙江腾信国际物流有限公司总经理",
    background: "从货代业务员做起，干了12年跨境物流。自己从零搭建了中美物流网络，14家国内分子公司+美国5大转运中心。客户关系极强，能在饭桌上搞定大单。",
    mbti: "ESTP", decisionStyle: "快速决策，边打边看，不行就换",
    riskPreference: "高风险偏好，敢投入敢撤退",
    fullExpressionStyle: "说话节奏快，爱用生意场上的行话，直奔主题不废话",
    blindSpots: "对技术细节不关心，对品牌建设没耐心",
    vpQuirks: "会从\"谁掏钱\"\"怎么卖\"的角度思考",
    grid: "ToC_Cost_Child", architecture: "Hybrid"
  }
];

function pickPersonas() {
  const raw = String(process.env.PERSONA_IDS || "").trim();
  if (!raw) return personas;
  const wanted = new Set(raw.split(",").map((x) => x.trim().toUpperCase()).filter(Boolean));
  return personas.filter((persona) => wanted.has(String(persona.id || "").toUpperCase()));
}

async function main() {
  loadLocalEnvFile();
  if (!process.env.DEEPSEEK_API_KEY) {
    throw new Error("DEEPSEEK_API_KEY not found in environment or .env");
  }

  for (const [index, persona] of pickPersonas().entries()) {
    const actor = new PersonaStudent({
      apiKey: process.env.DEEPSEEK_API_KEY,
      strictMode: false,
      student: {
        ...persona,
        personaId: persona.id
      },
      teamIndex: 0,
      memberIndex: index
    });
    await actor.generateSeedMemory();
    await actor.generateClassroomProfile();
    const vpText = await actor.generateVPDraft({
      grid_id: persona.grid,
      architecture: persona.architecture
    });

    console.log("========================================");
    console.log(`[${persona.id} ${persona.label}/${persona.name}/${persona.age}岁/${persona.education}]`);
    console.log("========================================");
    console.log("");
    console.log("--- 结构化属性（输入）---");
    console.log(formatStructuredAttributes(persona));
    console.log("");
    console.log("--- Layer 0: Seed Memory ---");
    console.log(JSON.stringify(actor.seedMemory || null, null, 2));
    console.log("");
    console.log("--- Layer 1: Classroom Profile ---");
    console.log(JSON.stringify(actor.classroomProfile || null, null, 2));
    console.log("");
    console.log(`--- VP 初稿 (grid: ${persona.grid}, arch: ${persona.architecture}) ---`);
    console.log(String(vpText || "").trim());
    console.log("");
  }
}

main().catch((err) => {
  console.error(err && err.stack ? err.stack : String(err));
  process.exit(1);
});
