# CODEX_VP_COACH_TEST.md
## VP Coach + Scorer 独立测试脚本

### 目标

创建一个不依赖 HTTP 服务器的独立测试脚本 `scripts/test_vp_coach.js`，直接调用 `vpCoach.chat()` 和 `vpScorer.scoreVp()`，用 AI persona 模拟学生与 Coach 多轮对话，自动检查 Coach 行为质量和 Scorer 评分合理性。

跑通后输出一份 JSON 报告 + 终端摘要，用于判断 VP Coach prompt 改动是否可以合并。

---

### 前置条件

- `.env` 中有 `DEEPSEEK_API_KEY`
- 不需要启动服务器，不需要数据库
- 直接 `require` 项目内的 `server/llm/vpCoach.js`、`server/llm/vpScorer.js`、`server/llm/deepseekClient.js`

---

### 文件结构

```
scripts/
  test_vp_coach.js          ← 主脚本（本 spec 要创建的）
  test_vp_coach_personas.js ← persona 定义（本 spec 要创建的）
data/
  vp_coach_test_logs/       ← 输出目录（脚本自动创建）
    report_YYYY-MM-DD_HHmmss.json
    conversations/
      scenario_0_ToB_Diff_Adult.txt
      scenario_1_ToC_Cost_Child.txt
      ...
```

---

### Section 0：Persona 定义文件 `scripts/test_vp_coach_personas.js`

定义 4 种学生 persona，覆盖不同表达风格。每个 persona 是一个对象，包含 `id`、`label`、`systemPrompt`（用于调 DeepSeek 生成学生回复）。

**Persona 设计原则——围绕 C/G/E 维度制造差异：**

VP 评分有三个维度：C（目标人群覆盖面 — WHO 是否清晰具体）、G（痛点可泛化率 — PAIN 是否普遍高频）、E（解法说服力 — HOW 是否有因果链和替代方案对比）。不同 persona 天然在不同维度上有强弱差异：

- 草根老板：WHO 和 PAIN 靠行业直觉能给出具体画面（C/G 潜力高），但 HOW 说不清机制（E 弱）
- 互联网 PM：WHO 用框架拆得很细（C 高），PAIN 容易过度抽象化（G 中等），HOW 用产品语言能说清（E 高）
- 体制转型者：WHO 说的是政策对象不是具体用户（C 弱），PAIN 用宏观叙事覆盖面广但不具体（G 虚高），HOW 模糊（E 弱）
- 销售铁军：WHO 非常清楚谁买单（C 高），PAIN 从渠道角度看不从用户角度看（G 偏），HOW 关注卖点不关注机制（E 中等）

system prompt 中不要直接提 C/G/E 术语，而是通过 persona 背景自然产生这些差异。

```javascript
// scripts/test_vp_coach_personas.js

const PERSONAS = [
  {
    id: "lazy_boss",
    label: "草根老板（惜字如金）",
    // C/G 潜力高（行业直觉），E 弱（说不清产品机制）
    systemPrompt: `你是一位 52 岁的 EMBA 学生，高中学历，在三线城市经营了 20 年养老院连锁。
你正在参加一个商业模拟课程，讨论一款日本情感陪伴机器人（LOVOT）的中国市场战略。

你的知识和经验：
- 你非常了解养老行业的客户画像（什么样的家属会掏钱、什么样的机构会采购）
- 你见过太多老人的日常状态——每天坐着发呆、不愿说话、家属一个月来一次
- 你对产品技术一窍不通，不知道 LOVOT 内部怎么工作的，也不关心
- 你判断一个东西行不行，靠的是"我的客户愿不愿意买单"，不是分析框架

你的表达特点：
- 说话很短，能用 5 个字不用 10 个字
- 不喜欢写长句子，经常只给关键词或半句话
- 用大白话，不用商业术语
- 如果不懂就说"不太清楚"或"你说呢"
- 如果教练问到你熟悉的客户或场景，你会突然给出非常具体的画面（"我们院里张阿姨每天就坐那看窗户"）
- 如果教练追问产品怎么解决问题、跟替代方案比有什么优势，你说不出来，会说"这个我不懂，反正老人喜欢就行"

全程中文。每次回复不超过 20 个字，除非被问到你熟悉的领域（客户画像、日常场景、采购决策）。`
  },
  {
    id: "mba_pm",
    label: "互联网产品经理（框架党）",
    // C 高（用户画像拆得细），G 中等（容易抽象化），E 高（产品语言清楚）
    systemPrompt: `你是一位 34 岁的 EMBA 学生，本科计算机、硕士 MBA，在大厂做了 8 年产品经理。
你正在参加一个商业模拟课程，讨论一款日本情感陪伴机器人（LOVOT）的中国市场战略。

你的知识和经验：
- 你擅长定义用户画像：年龄、收入、生活方式、使用场景，能拆得很细
- 你习惯用"场景-痛点-解决方案"的框架思考，写出来的东西结构清晰
- 你能说清楚产品功能怎么作用于用户痛点（因果链），也会主动对比竞品
- 但你有个毛病：容易用抽象概念替代具体画面——比如说"情感陪伴需求"而不是描述一个真实的孤独时刻
- 你对线下渠道和传统行业的运营模式不太了解

你的表达特点：
- 回复比较结构化，喜欢分点
- 偶尔过度使用互联网术语（"赛道""心智""闭环""PMF"）
- 每次回复 2-4 句话
- 如果教练问"具体场景是什么样的"，你倾向于给一个概括性描述而不是一个有画面感的故事

全程中文。`
  },
  {
    id: "govt_转型",
    label: "体制转型者（宏观叙事）",
    // C 弱（说政策对象不说具体用户），G 虚高（宏观覆盖但不具体），E 弱（机制模糊）
    systemPrompt: `你是一位 45 岁的 EMBA 学生，之前在某省发改委工作了 15 年，两年前跳到一家国企做副总。
你正在参加一个商业模拟课程，讨论一款日本情感陪伴机器人（LOVOT）的中国市场战略。

你的知识和经验：
- 你对政策方向非常敏感（银发经济、新基建、普惠养老、智慧社区）
- 你习惯从宏观角度看问题：市场有多大、政策支持什么方向、社会趋势是什么
- 但你很少接触具体的终端用户——你不太清楚一个独居老人每天的生活是什么样的
- 你不太理解产品层面的技术机制，倾向于用"智能化解决方案""提升服务品质"这类概括性表述
- 你想给教授留好印象，所以回复比较认真、用词比较正式

你的表达特点：
- 习惯用政策语言包装想法（"响应银发经济政策号召""赋能基层养老服务体系"）
- 说目标客户时倾向于说"养老机构""社区""政府购买服务"这种机构层面的表述，不太会说到具体的个人
- 说痛点时倾向于引用宏观数据（"中国有 2.6 亿老人""养老护理人员缺口巨大"），但缺少具体场景画面
- 说解决方案时喜欢用"提升""赋能""优化"这类动词，缺少因果链
- 每次回复 2-3 句话

全程中文。`
  },
  {
    id: "sales_dog",
    label: "销售铁军（快准狠）",
    // C 高（知道谁买单），G 偏（从渠道角度看不从用户角度看），E 中等（关注卖点不关注机制）
    systemPrompt: `你是一位 40 岁的 EMBA 学生，从销售代表做到区域总监，管过 200 人的地推团队。
你正在参加一个商业模拟课程，讨论一款日本情感陪伴机器人（LOVOT）的中国市场战略。

你的知识和经验：
- 你非常清楚"谁是决策者、谁掏钱、谁用"这三个角色的区别
- 你关注的核心问题永远是：客户凭什么买？怎么说服他？竞品怎么卖的？
- 你对渠道和终端非常熟悉——经销商要什么利润、门店怎么陈列、导购怎么话术
- 你对产品技术细节不太关心，觉得"功能客户看不懂，关键是卖点"
- 你会主动对比竞品（"小度音箱才几百块""玩具店里一堆便宜的"），但对比的维度是价格和铺货，不是技术机制

你的表达特点：
- 说话直接，不绕弯
- 每次回复 1-3 句话，偶尔反问教练（"你觉得这个价位经销商愿意做吗？"）
- 如果教练追问"产品怎么解决这个问题"，你倾向于说卖点（"就说它会卖萌会动"），不太会解释技术机制
- 如果教练问"跟替代方案比有什么不同"，你会从价格和渠道角度回答，不太会从用户体验角度回答

全程中文。`
  }
];

module.exports = { PERSONAS };
```

---

### Section 1：测试场景定义

在 `test_vp_coach.js` 中定义 6 个测试场景，覆盖不同格子 × 不同 persona 组合：

```javascript
const SCENARIOS = [
  // 格式：{ grid, architecture, persona_id, description }
  { grid: "ToB·差异·成人", arch: "混合", archEn: "Hybrid",
    persona: "lazy_boss", desc: "ToB成人混合-草根老板（灾难复现场景）",
    jinang: { market: ["内容营销"], tech: ["云端运营"] } },

  { grid: "ToC·差异·儿童", arch: "体验", archEn: "Experience",
    persona: "mba_pm", desc: "ToC儿童体验-互联网PM",
    jinang: { market: ["场景调研"], tech: ["视觉光效"] } },

  { grid: "ToB·成本·老人", arch: "功能", archEn: "Function",
    persona: "govt_转型", desc: "ToB老人功能-体制转型者",
    jinang: { market: ["政府关系"], tech: ["安全监测"] } },

  { grid: "ToC·差异·成人", arch: "体验", archEn: "Experience",
    persona: "sales_dog", desc: "ToC成人体验-销售铁军",
    jinang: { market: ["电商运营"], tech: ["情感计算"] } },

  { grid: "ToB·差异·儿童", arch: "混合", archEn: "Hybrid",
    persona: "lazy_boss", desc: "ToB儿童混合-草根老板（好对话复现）",
    jinang: { market: ["场景调研"], tech: ["视觉光效"] } },

  { grid: "ToC·成本·成人", arch: "功能", archEn: "Function",
    persona: "mba_pm", desc: "ToC成人功能-互联网PM",
    jinang: { market: ["渠道分销"], tech: ["语音交互"] } }
];
```

---

### Section 2：单场景测试流程

对每个 scenario，执行以下流程：

```javascript
async function runScenario(scenario) {
  const persona = PERSONAS.find(p => p.id === scenario.persona);
  const session = {
    messages: [],
    strategy: {
      cellLabel: scenario.grid,
      architectureLabel: scenario.arch,
      architecture: scenario.archEn,
      jinang: {
        market: scenario.jinang.market,
        tech: scenario.jinang.tech
      },
      team_size: 1
    }
  };

  const result = {
    scenario: scenario.desc,
    grid: scenario.grid,
    arch: scenario.arch,
    persona: persona.label,
    turns: [],
    checks: {},
    scores: null,
    features: null,
    _session: session  // 保留 session 引用，用于导出 system prompt
  };

  // === 第一轮：学生发"开始" ===
  const turn1 = await vpCoach.chat(session, "开始", { mode: "chat" });
  session.messages.push({ role: "user", content: "开始" });
  session.messages.push({ role: "assistant", content: turn1.replyText });
  result.turns.push({ role: "coach", content: turn1.replyText });

  // === 后续轮次：persona 回复 → Coach 回复，共 8 轮 ===
  for (let i = 0; i < 8; i++) {
    // persona 生成回复
    const studentReply = await generatePersonaReply(
      persona,
      turn1.replyText,  // 不用，下面用最新的 coach 回复
      session.messages,
      scenario
    );

    // 发给 Coach
    const coachResult = await vpCoach.chat(session, studentReply, { mode: "chat" });

    // 更新 session
    session.messages.push({ role: "user", content: studentReply });
    session.messages.push({ role: "assistant", content: coachResult.replyText });

    result.turns.push({ role: "student", content: studentReply });
    result.turns.push({ role: "coach", content: coachResult.replyText });

    // 如果学生说了"提交"或 Coach 说了"请确认"，提前结束
    if (/提交|确认/.test(coachResult.replyText) && i >= 4) break;
  }

  // === 跑 Scorer ===
  const conversation = session.messages
    .map(m => `[${m.role === "user" ? "Team" : "AI策略顾问"}]: ${m.content}`)
    .join("\n\n");

  const scoreResult = await vpScorer.scoreVp(
    conversation,
    scenario.grid,
    scenario.arch
  );
  result.scores = scoreResult.scores;
  result.features = scoreResult.features;
  result.feedback = scoreResult.feedback;

  // === 自动检查 ===
  result.checks = runChecks(result);

  return result;
}
```

---

### Section 3：Persona 回复生成

```javascript
const { chatCompletion } = require("../server/llm/deepseekClient");

async function generatePersonaReply(persona, coachMessage, history, scenario) {
  // 取最近 3 轮对话作为上下文
  const recentHistory = history.slice(-6)
    .map(m => `${m.role === "user" ? "学生" : "教练"}：${m.content}`)
    .join("\n");

  const messages = [
    {
      role: "system",
      content: persona.systemPrompt
    },
    {
      role: "user",
      content: `你正在和 AI 策略顾问讨论你们团队的价值主张。

你们选的市场方向：${scenario.grid}
产品定位：${scenario.arch}型

讨论的核心是三个方面：
1. 目标客户是谁——越具体越好，不能只说"老人"或"企业"，要说清什么样的人/什么样的机构
2. 痛点是什么——要描述具体场景和频率，不能只说"孤独"或"不方便"，要说什么时候、多经常、什么后果
3. LOVOT 怎么解决——要说清具体机制和因果链，不能只说"陪伴"或"智能化"，要说产品做了什么动作、用户因此发生了什么变化、现有方案为什么做不到

教练会围绕这三个方面追问你，基于你的背景和经验回答就好。

最近对话：
${recentHistory}

教练刚说的：
「${coachMessage}」

用你自然的方式回复。不要重复教练说过的话。`
    }
  ];

  try {
    const reply = await chatCompletion(messages, {
      temperature: 0.9,
      max_tokens: 150
    });
    return String(reply || "").trim() || "嗯，继续";
  } catch (err) {
    console.error(`  Persona reply failed: ${err.message}`);
    return "你说呢？";
  }
}
```

注意：这里的 `coachMessage` 参数应该用 `history` 中最后一条 assistant 消息的 content，不是 turn1。修正逻辑在 Section 2 的循环里：

```javascript
// 在循环内，获取最新的 coach 回复
const lastCoachMsg = session.messages.filter(m => m.role === "assistant").slice(-1)[0]?.content || "";
const studentReply = await generatePersonaReply(persona, lastCoachMsg, session.messages, scenario);
```

---

### Section 4：自动检查规则

```javascript
function runChecks(result) {
  const checks = {};
  const firstCoach = result.turns[0]?.content || "";
  const allCoachTurns = result.turns.filter(t => t.role === "coach").map(t => t.content);
  const allStudentTurns = result.turns.filter(t => t.role === "student").map(t => t.content);

  // ========== Coach 行为检查 ==========

  // CHECK 1: 开场白包含扫地机器人例子
  checks.opening_has_vacuum_example = /扫地机器人/.test(firstCoach);

  // CHECK 2: 开场白提到了锦囊
  checks.opening_mentions_jinang = /锦囊|能力/.test(firstCoach) ||
    (result.scenario.includes("内容营销") && /内容营销/.test(firstCoach)) ||
    (result.scenario.includes("场景调研") && /场景调研/.test(firstCoach));

  // CHECK 3: Coach 从不列出 LOVOT 具体场景选项让学生选
  // 检测模式："比如：\n- A\n- B\n- C" 或 "例如：\n1. ...\n2. ...\n3. ..."
  // 排除开场白（第一条允许用扫地机器人举例）
  const coachAfterFirst = allCoachTurns.slice(1);
  checks.no_lovot_option_lists = !coachAfterFirst.some(text => {
    // 检测：是否列了 2+ 个以 LOVOT 应用场景为内容的 bullet
    const bullets = text.match(/[-•\d][.、）]\s*.{4,}/g) || [];
    const lovotBullets = bullets.filter(b =>
      /诊所|养老|幼儿园|酒店|银行|科技公司|学校|医院|商场/.test(b)
    );
    return lovotBullets.length >= 2;
  });

  // CHECK 4: Coach 在 5 轮内至少整合过一次完整 VP 句子
  // 检测："为...提供...解决..." 或引号内的长句（>30字）
  const vpPatterns = allCoachTurns.map((text, i) => {
    const hasQuotedVP = /"[^"]{30,}"/.test(text) || /"[^"]{30,}"/.test(text);
    const hasVPStructure = /为.{4,}(?:提供|解决|缓解|降低)/.test(text);
    return { turn: i, hasVP: hasQuotedVP || hasVPStructure };
  });
  const firstVPTurn = vpPatterns.findIndex(p => p.hasVP);
  checks.coach_synthesizes_vp = firstVPTurn >= 0;
  checks.coach_synthesizes_vp_within_5 = firstVPTurn >= 0 && firstVPTurn <= 5;

  // CHECK 5: ToB 场景下 Coach 提醒客户是机构不是终端用户
  const isToB = result.grid.includes("ToB");
  if (isToB) {
    checks.tob_institution_reminder = allCoachTurns.some(text =>
      /机构|企业.{0,4}客户|不是.{0,4}(终端|消费者|个人)|买单的是/.test(text)
    );
  } else {
    checks.tob_institution_reminder = null; // 不适用
  }

  // CHECK 6: Coach 每轮只问一个问题（不超过 2 个问号）
  const multiQuestionTurns = coachAfterFirst.filter(text => {
    const questions = (text.match(/？/g) || []).length;
    return questions > 2;
  });
  checks.single_question_per_turn = multiQuestionTurns.length <= 1; // 允许 1 次例外

  // CHECK 6b: Coach 在全程中覆盖了 C/G/E 三个维度的追问
  // C 维度关键词：客户、人群、谁、用户、买单、决策者、机构
  // G 维度关键词：场景、频率、多久、经常、普遍、常见、其他人、多少人
  // E 维度关键词：怎么解决、机制、替代、现有方案、为什么比、差在哪、边界、不管用
  const allCoachText = allCoachTurns.join(" ");
  const touchedC = /客户|人群|谁是|什么样的.{0,4}(人|企业|机构)|买单|决策者/.test(allCoachText);
  const touchedG = /场景|频率|多久|多经常|经常|普遍|常见|高频|什么时候.{0,6}(发生|出现|遇到)/.test(allCoachText);
  const touchedE = /怎么解决|机制|因果|替代|现有方案|为什么比|差在哪|边界|不管用|什么时候不/.test(allCoachText);
  checks.coach_covers_C_dimension = touchedC;
  checks.coach_covers_G_dimension = touchedG;
  checks.coach_covers_E_dimension = touchedE;
  checks.coach_covers_all_CGE = touchedC && touchedG && touchedE;

  // ========== Scorer 评分检查 ==========

  if (result.scores) {
    const { C, G, E } = result.scores;

    // CHECK 7: 评分不全是高分（全 > 4.0 说明虚高）
    checks.scores_not_all_high = !(C > 4.0 && G > 4.0 && E > 4.0);

    // CHECK 8: 草根老板（惜字如金）的分数应该偏低（C, G 不超过 3.5）
    if (result.persona.includes("草根老板")) {
      checks.lazy_boss_scores_reasonable = C <= 3.5 && G <= 3.5;
    }

    // CHECK 9: C >= G（通常目标客户比痛点泛化更容易写清楚）
    checks.c_gte_g_typical = true; // 不强制，只记录
    checks.score_spread = { C, G, E };
  }

  // ========== Features 检查 ==========

  if (result.features) {
    // CHECK 10: features 不全是 0（说明 extractor 工作正常）
    const allZero = Object.values(result.features).every(v => v === 0 || v === null);
    checks.features_not_all_zero = !allZero;

    // CHECK 11: features 不全是 2（说明 extractor 不是无脑打高分）
    const allTwo = Object.values(result.features).filter(v => v !== null).every(v => v === 2);
    checks.features_not_all_two = !allTwo;
  }

  return checks;
}
```

---

### Section 5：主函数和报告输出

```javascript
const fs = require("fs");
const path = require("path");

async function main() {
  // 加载 .env
  require("dotenv").config();

  const vpCoach = require("../server/llm/vpCoach");
  const vpScorer = require("../server/llm/vpScorer");
  const { PERSONAS } = require("./test_vp_coach_personas");

  const outputDir = path.join(__dirname, "../data/vp_coach_test_logs");
  const convDir = path.join(outputDir, "conversations");
  fs.mkdirSync(convDir, { recursive: true });

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const results = [];

  console.log(`\n====== VP Coach Test ======`);
  console.log(`${SCENARIOS.length} scenarios × ~8 turns each`);
  console.log(`Estimated time: ${SCENARIOS.length * 2} minutes\n`);

  for (let i = 0; i < SCENARIOS.length; i++) {
    const scenario = SCENARIOS[i];
    console.log(`[${i + 1}/${SCENARIOS.length}] ${scenario.desc}`);

    try {
      const result = await runScenario(scenario);
      results.push(result);

      // 保存对话到 txt（包含完整 system prompt + 评分详情）
      const systemPrompt = vpCoach.buildSystemPrompt(
        result._session.strategy,
        { chatTurnIndex: 1 }
      );
      
      const convHeader = [
        `场景：${scenario.desc}`,
        `格子：${scenario.grid}`,
        `架构：${scenario.arch}`,
        `Persona：${result.persona}`,
        `时间：${new Date().toISOString()}`,
        ``,
        `${"=".repeat(60)}`,
        `VP COACH SYSTEM PROMPT（发给 DeepSeek 的完整指令）`,
        `${"=".repeat(60)}`,
        ``,
        systemPrompt,
        ``,
        `${"=".repeat(60)}`,
        `对话记录`,
        `${"=".repeat(60)}`,
      ].join("\n");

      const convBody = result.turns
        .map(t => `[${t.role === "coach" ? "AI策略顾问" : "Team"}]\n${t.content}`)
        .join("\n\n---\n\n");

      const scorerSection = [
        ``,
        `${"=".repeat(60)}`,
        `SCORER 评分结果`,
        `${"=".repeat(60)}`,
        ``,
        `Scores: C=${result.scores?.C || "N/A"} / G=${result.scores?.G || "N/A"} / E=${result.scores?.E || "N/A"}`,
        ``,
        `Features（13 维特征提取结果，0=没提/1=模糊/2=清楚）:`,
        JSON.stringify(result.features, null, 2),
        ``,
        `Feedback:`,
        result.feedback || "（无）",
        ``,
        `${"=".repeat(60)}`,
        `自动检查结果`,
        `${"=".repeat(60)}`,
        ``,
        ...Object.entries(result.checks)
          .filter(([, v]) => v !== null)
          .map(([k, v]) => {
            if (typeof v === "boolean") return `${v ? "✅" : "❌"} ${k}`;
            if (typeof v === "object") return `📊 ${k}: ${JSON.stringify(v)}`;
            return `  ${k}: ${v}`;
          })
      ].join("\n");

      const convFile = path.join(convDir, `scenario_${i}_${scenario.grid.replace(/[·]/g, "_")}.txt`);
      fs.writeFileSync(convFile, convHeader + "\n\n" + convBody + scorerSection);

      // 打印检查结果
      const passed = Object.entries(result.checks)
        .filter(([, v]) => v !== null)
        .filter(([, v]) => typeof v === "boolean" ? v : true);
      const failed = Object.entries(result.checks)
        .filter(([, v]) => v !== null && typeof v === "boolean" && !v);
      const scores = result.scores || {};

      console.log(`  Scores: C=${scores.C || "?"} G=${scores.G || "?"} E=${scores.E || "?"}`);
      console.log(`  Checks: ${passed.length} passed, ${failed.length} failed`);
      if (failed.length > 0) {
        failed.forEach(([k]) => console.log(`    ❌ ${k}`));
      }
      console.log();

    } catch (err) {
      console.error(`  ❌ SCENARIO FAILED: ${err.message}`);
      results.push({
        scenario: scenario.desc,
        error: err.message,
        checks: {}
      });
    }
  }

  // === 汇总报告 ===
  // 从 results 中移除 _session（大对象，只用于 txt 导出）
  const reportResults = results.map(r => {
    const { _session, ...rest } = r;
    return rest;
  });

  const report = {
    timestamp,
    totalScenarios: SCENARIOS.length,
    results: reportResults,
    summary: {
      totalChecks: 0,
      totalPassed: 0,
      totalFailed: 0,
      failedChecks: []
    }
  };

  for (const r of results) {
    if (!r.checks) continue;
    for (const [k, v] of Object.entries(r.checks)) {
      if (v === null || typeof v !== "boolean") continue;
      report.summary.totalChecks++;
      if (v) {
        report.summary.totalPassed++;
      } else {
        report.summary.totalFailed++;
        report.summary.failedChecks.push({ scenario: r.scenario, check: k });
      }
    }
  }

  // 保存报告
  const reportFile = path.join(outputDir, `report_${timestamp}.json`);
  fs.writeFileSync(reportFile, JSON.stringify(report, null, 2));

  // 打印摘要
  console.log("=".repeat(50));
  console.log(`SUMMARY: ${report.summary.totalPassed}/${report.summary.totalChecks} checks passed`);
  if (report.summary.totalFailed > 0) {
    console.log(`\nFailed checks:`);
    report.summary.failedChecks.forEach(f =>
      console.log(`  ❌ [${f.scenario}] ${f.check}`)
    );
  }
  console.log(`\nReport: ${reportFile}`);
  console.log(`Conversations: ${convDir}/`);
}

main().catch(err => {
  console.error("Test runner crashed:", err);
  process.exit(1);
});
```

---

### Section 6：运行方式

```bash
source .env
node scripts/test_vp_coach.js
```

预计运行时间：6 个场景 × 每场景约 18 次 DeepSeek 调用（8 轮学生 + 9 轮 Coach + 1 次 Scorer）= 约 108 次 API 调用，大约 10-15 分钟。

---

### Section 7：验收标准

1. 脚本能跑通 6 个场景，不崩溃
2. 每个场景输出完整的对话 txt 文件，txt 文件包含三个区块：
   - **VP COACH SYSTEM PROMPT**：发给 DeepSeek 的完整 system prompt 文本
   - **对话记录**：逐轮的 `[AI策略顾问]` 和 `[Team]` 交替记录
   - **SCORER 评分结果**：C/G/E 分数 + 13 维 features JSON + feedback 文本 + 自动检查的 ✅/❌ 列表
3. 最终输出 `report_*.json`，包含 checks 和 scores（不含 `_session`）
4. 终端打印摘要：passed/failed 数量 + 失败的具体 check 名
5. **不需要所有 check 都 pass**——这个脚本是用来发现问题的，不是 CI 门禁

---

### 注意事项

- `vpCoach.chat()` 需要一个 `session` 对象，其中 `session.messages` 是对话历史数组，`session.strategy` 是团队策略。直接在内存中构造，不需要数据库。
- `vpScorer.scoreVp(conversation, cellLabel, architectureLabel)` 的 `conversation` 参数是完整对话的纯文本字符串。
- DeepSeek API 可能有 rate limit，如果报 429 就在每次调用之间加 `await sleep(2000)`。
- persona 的 `temperature: 0.9` 是为了产生多样化的学生回复。Coach 用的 temperature 由 `vpCoach.js` 内部控制（0.6），不要改。
- 如果 `require("../server/llm/deepseekClient")` 路径不对，按实际项目结构调整。
- `dotenv` 如果没装，先 `npm install dotenv`。
