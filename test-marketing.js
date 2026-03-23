// test-marketing.js - Marketing 模块基础测试
// 运行方式：
//   node test-marketing.js
//   node test-marketing.js --verbose

const BASE_URL = "http://127.0.0.1:8787";
const VERBOSE = process.argv.includes("--verbose");
const { scoreTagsToDimensions } = require("./server/llm/dimensionScorer");
const embeddingService = require("./server/llm/embeddingService");

// ============ 固定测试数据 ============

const TEST_STRATEGY = {
  market: "ToC",
  competitive: "差异化",
  segment: "老人",
  architecture: "体验",
  targetGm: 52.7
};

const TEST_VP_CANVAS = {
  customerJobs: "独居初老女性希望在家感受到陪伴和关怀，不想打扰忙碌的子女",
  pains: "一个人在家感到孤独，子女不在身边时遇到突发情况很害怕，不会用复杂的科技产品",
  gains: "感受到被理解和陪伴，家人放心，简单易用不需要学习",
  products: "LOVOT 陪伴型机器人，具备情感感知和自主移动能力",
  painRelievers: "主动靠近用户给予情感回应，紧急情况自动通知家人，操作极简",
  gainCreators: "记住用户的喜好和习惯，像老朋友一样陪伴，让家人随时了解状态"
};

// 模拟访谈对话（学生提问 + 客户回答）
const TEST_MESSAGES = [
  {
    role: "user",
    content: "您平时一个人在家，会感到孤独吗？"
  },
  {
    role: "assistant",
    content: "唉，当然会啊。孩子们都忙，一天说不上几句话。有时候一整天就我一个人，电视开着也觉得冷清。"
  },
  {
    role: "user",
    content: "如果有一个机器人陪伴您，您最希望它能做什么？"
  },
  {
    role: "assistant",
    content: "能说说话就好了，不需要太复杂。我这把年纪学不了那些高科技。就是有个东西能陪我聊天，知道我喜欢什么，像个老朋友一样。"
  },
  {
    role: "user",
    content: "您需要它帮您监测健康状况吗，比如心率、血压这些？"
  },
  {
    role: "assistant",
    content: "这个倒不太需要，我有自己的血压仪。不过要是能在我摔倒或者突然不舒服的时候通知我女儿，那就好了，她总是担心我。"
  },
  {
    role: "user",
    content: "您希望它能在家里自己走动吗？"
  },
  {
    role: "assistant",
    content: "能走当然好，这样它能跟着我。但最重要的是不要撞到我，我腿脚不太好，怕被绊倒。"
  },
  {
    role: "user",
    content: "您对它连接手机或者智能家居有兴趣吗？"
  },
  {
    role: "assistant",
    content: "不需要那么麻烦，我就用老人机，不会那些智能家居。越简单越好，按一个键就能用最好。"
  },
  {
    role: "user",
    content: "您女儿会希望通过它了解您的状态吗？"
  },
  {
    role: "assistant",
    content: "她肯定希望的。她在外地，总担心我。要是她能看到我今天状态怎么样，她也放心一些，我也不用每天打电话报平安。"
  }
];

// ============ 测试函数 ============

async function request(path, options = {}) {
  const url = `${BASE_URL}${path}`;
  const res = await fetch(url, {
    headers: { "Content-Type": "application/json" },
    ...options
  });
  const data = await res.json();
  if (!data.ok) throw new Error(`API 错误 [${path}]: ${data.error}`);
  return data;
}

async function runTest(label) {
  console.log(`\n${"=".repeat(50)}`);
  console.log(`${label}`);
  console.log("=".repeat(50));

  // Step 1: 创建 session + 生成 Persona
  console.log("\n[1] 创建 session...");
  const startData = await request("/api/marketing/start", {
    method: "POST",
    body: JSON.stringify({
      teamKey: "test-team-001",
      strategy: TEST_STRATEGY,
      vpCanvas: TEST_VP_CANVAS
    })
  });
  const sessionId = startData.sessionId;
  console.log(`✓ sessionId: ${sessionId}`);
  console.log(`✓ Persona:\n${startData.persona}`);
  const personaFull = startData.personaFull || {};

  // Step 2: 注入固定“学生提问”，记录客户实际回答
  console.log("\n[2] 注入测试对话...");
  const userQuestions = TEST_MESSAGES.filter((m) => m.role === "user");
  const interviewTrace = [];
  for (const msg of userQuestions) {
    const data = await request("/api/marketing/interview", {
      method: "POST",
      body: JSON.stringify({ sessionId, message: msg.content })
    });
    interviewTrace.push({
      question: msg.content,
      reply: data.reply
    });
  }
  console.log(`✓ 注入 ${userQuestions.length} 轮对话`);

  // Step 3: 结束访谈，触发标签提取 + 维度评分
  console.log("\n[3] 结束访谈，提取标签...");
  const scoreData = await request("/api/marketing/end-interview", {
    method: "POST",
    body: JSON.stringify({ sessionId })
  });

  // 打印标签
  console.log("\n✓ 提取标签：");
  scoreData.tags.forEach(t => {
    const icon = t.polarity === "positive" ? "✓" : "✗";
    console.log(`  ${icon} [${t.polarity}] ${t.tag}`);
  });
  console.log(`  共 ${scoreData.tags.length} 个标签`);

  // 打印维度分数
  console.log("\n✓ 维度分数：");
  const dims = scoreData.dimensions;
  dims.forEach(d => {
    const score = scoreData.scores[d.key];
    const safeScore = Math.min(10, Math.max(0, Number(score || 0)));
    const bar = "★".repeat(safeScore) + "☆".repeat(10 - safeScore);
    console.log(`  ${d.label_cn.padEnd(10)} ${bar} (${safeScore}/10)`);
  });

  return {
    scores: scoreData.scores,
    tags: scoreData.tags,
    dimensions: scoreData.dimensions,
    personaFull,
    interviewTrace
  };
}

async function main() {
  console.log("Marketing 模块基础测试");
  console.log(`服务器：${BASE_URL}`);

  try {
    // 第一次跑
    const run1 = await runTest("第一次运行");

    // 第二次跑：不再调用 end-interview，直接用第一次 tags 重新评分
    console.log("\n" + "=".repeat(50));
    console.log("第二次运行（同 tags 直接调用 dimensionScorer）");
    console.log("=".repeat(50));
    await embeddingService.init();
    const secondScoreResult = await scoreTagsToDimensions(run1.tags);
    const run2 = {
      tags: run1.tags,
      scores: secondScoreResult.scores,
      dimensions: run1.dimensions
    };

    // 对比两次结果
    console.log("\n" + "=".repeat(50));
    console.log("稳定性对比");
    console.log("=".repeat(50));

    let stable = true;
    Object.keys(run1.scores).forEach(key => {
      const match = run1.scores[key] === run2.scores[key];
      if (!match) stable = false;
      console.log(`  ${key}: ${run1.scores[key]} vs ${run2.scores[key]} ${match ? "✓" : "✗ 不一致！"}`);
    });

    console.log("\n标签一致性对比：");
    const tags1Str = JSON.stringify(run1.tags);
    const tags2Str = JSON.stringify(run2.tags);
    const tagsMatch = tags1Str === tags2Str;
    console.log(`  run1 tags: ${tags1Str}`);
    console.log(`  run2 tags: ${tags2Str}`);
    console.log(`  tags match: ${tagsMatch ? "✓" : "✗ 不一致！"}`);

    console.log(`\n${stable ? "✓ 稳定性测试通过，两次结果完全一致" : "✗ 稳定性测试失败，存在不一致"}`);

    // 检查缓存是否生效（第二次应该更快）
    console.log("\n提示：如果第二次运行明显更快，说明缓存生效。");

    if (VERBOSE) {
      console.log("\n" + "=".repeat(50));
      console.log("详细输出模式");
      console.log("=".repeat(50));

      console.log("\n[PersonaFull]");
      console.log(JSON.stringify(run1.personaFull, null, 2));

      console.log("\n[每轮访谈客户实际回答]");
      run1.interviewTrace.forEach((t, i) => {
        console.log(`\n第${i + 1}轮`);
        console.log(`学生提问: ${t.question}`);
        console.log(`客户回答: ${t.reply}`);
      });

      console.log("\n[最终标签列表（含极性）]");
      run1.tags.forEach((t) => {
        const icon = t.polarity === "positive" ? "✓" : "✗";
        console.log(`${icon} [${t.polarity}] ${t.tag}`);
      });

      console.log("\n[6维度分数]");
      run1.dimensions.forEach((d) => {
        const score = run1.scores[d.key];
        const safeScore = Math.min(10, Math.max(0, Number(score || 0)));
        const bar = "★".repeat(safeScore) + "☆".repeat(10 - safeScore);
        console.log(`${d.label_cn.padEnd(10)} ${bar} (${safeScore}/10)`);
      });
    }

  } catch (e) {
    console.error("\n✗ 测试失败:", e.message);
    process.exit(1);
  }
}

main();
