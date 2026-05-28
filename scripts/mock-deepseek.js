const http = require("node:http");
const crypto = require("node:crypto");

const PORT = Number(process.env.PORT || "8088");
const HOST = process.env.HOST || "0.0.0.0";
const LATENCY_MEAN = parseInt(process.env.MOCK_LATENCY_MS_MEAN || "1500", 10);
const LATENCY_STDDEV = parseInt(process.env.MOCK_LATENCY_MS_STDDEV || "500", 10);

const state = {
  startedAt: Date.now(),
  inflight: 0,
  maxInflight: 0,
  totalRequests: 0,
  completedRequests: 0,
  totalLatencyMs: 0,
  byCallerType: Object.create(null),
  byRoute: Object.create(null)
};

function nowIso() {
  return new Date().toISOString();
}

function simulateLatency() {
  let z = 0;
  for (let i = 0; i < 12; i += 1) z += Math.random();
  z -= 6;
  const ms = Math.max(200, Math.min(5000, LATENCY_MEAN + z * LATENCY_STDDEV));
  return Math.round(ms);
}

function sendJson(res, statusCode, body, headers = {}) {
  const payload = JSON.stringify(body);
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(payload),
    ...headers
  });
  res.end(payload);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
      if (raw.length > 2 * 1024 * 1024) {
        reject(new Error("request body too large"));
        req.destroy();
      }
    });
    req.on("end", () => resolve(raw));
    req.on("error", reject);
  });
}

function toLowerText(value) {
  return String(value || "").toLowerCase();
}

function compactText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function extractLabeledValue(text, label) {
  const match = String(text || "").match(new RegExp(`${label}\\s*[：:]\\s*([^\\n<]+)`, "i"));
  return match ? compactText(match[1]) : "";
}

function inferArchitecture(text) {
  const raw = String(text || "");
  if (/功能型|Function/i.test(raw)) return "Function";
  if (/混合型|Hybrid/i.test(raw)) return "Hybrid";
  return "Experience";
}

function countUserTurns(messages) {
  return (Array.isArray(messages) ? messages : []).filter((item) => item && item.role === "user").length;
}

function getPromptBundle(payload) {
  const messages = Array.isArray(payload?.messages) ? payload.messages : [];
  const systemText = messages
    .filter((item) => item && item.role === "system")
    .map((item) => String(item.content || ""))
    .join("\n");
  const userText = messages
    .filter((item) => item && item.role === "user")
    .map((item) => String(item.content || ""))
    .join("\n");
  const allText = messages.map((item) => String(item?.content || "")).join("\n");
  return {
    messages,
    systemText,
    userText,
    allText,
    systemLower: toLowerText(systemText),
    userLower: toLowerText(userText),
    allLower: toLowerText(allText)
  };
}

function classifyChatRequest(payload) {
  const prompt = getPromptBundle(payload);
  const systemLower = prompt.systemLower;
  const allLower = prompt.allLower;

  if (allLower.includes("<vp_result>") || allLower.includes("最终确认版本")) {
    return "vp_confirm";
  }
  if (systemLower.includes("价值主张整理工具")) {
    return "vp_synthesize";
  }
  if (systemLower.includes("学生刚完成了一版价值主张") || systemLower.includes("ai 策略顾问")) {
    return "vp_synthesis_feedback";
  }
  if (
    systemLower.includes("访谈质量评估专家") ||
    systemLower.includes("信息覆盖率") ||
    allLower.includes("\"complete\"")
  ) {
    return "interview_complete";
  }
  if (
    systemLower.includes("访谈证据提取助手") ||
    allLower.includes("missing_dimensions") ||
    allLower.includes("focused_dimensions")
  ) {
    return "interview_extract";
  }
  if (
    systemLower.includes("只输出 json") &&
    (allLower.includes("who（目标人群）") || allLower.includes("confirmed_architecture"))
  ) {
    return "vp_summary";
  }
  if (
    systemLower.includes("用户研究专家") ||
    systemLower.includes("画像") ||
    systemLower.includes("persona") ||
    allLower.includes("生成一个具体的个人画像") ||
    allLower.includes("生成一个具体的机构负责人画像")
  ) {
    return "persona_generate";
  }
  if (
    systemLower.includes("你正在扮演") ||
    systemLower.includes("参加一场产品调研访谈") ||
    systemLower.includes("扮演规则")
  ) {
    return "interview_persona_reply";
  }
  if (
    systemLower.includes("课堂复盘助手") ||
    systemLower.includes("输出中文 markdown")
  ) {
    return "teacher_debrief_global";
  }
  if (
    systemLower.includes("课堂点评助手") ||
    allLower.includes("\"insight\"") && allLower.includes("\"review\"")
  ) {
    return "teacher_debrief_team";
  }
  if (
    systemLower.includes("教练") ||
    systemLower.includes("coach") ||
    systemLower.includes("策略顾问") ||
    systemLower.includes("引导")
  ) {
    return "vp_coach";
  }
  if (
    systemLower.includes("提取目标客户约束") ||
    allLower.includes("age_range") && allLower.includes("living_situations")
  ) {
    return "persona_constraints";
  }
  if (
    systemLower.includes("提取") ||
    systemLower.includes("extract") ||
    allLower.includes("who") && allLower.includes("pain") && allLower.includes("how")
  ) {
    return "vp_extract";
  }
  return "fallback";
}

function buildPersonaObject(prompt) {
  const isToB = /tob|b2b|企业|机构|负责人|采购/.test(prompt.allLower);
  if (isToB) {
    return {
      name: "张院长",
      age: 46,
      title: "运营副院长",
      org_type: "民营养老机构",
      org_scale: "120 张床位，夜班护工 6 人",
      pressures: [
        "夜班人手总是偏紧，老人情绪安抚和巡检经常撞车",
        "家属越来越在意服务体验，不只盯安全事故",
        "新设备要能讲清 ROI，否则审批很慢"
      ],
      budget: "年度设备采购预算 50 万，单笔超过 20 万需集团审批",
      trigger: "上个月夜间巡视漏掉一位老人起夜求助，院里开了专项整改会",
      personality: "务实谨慎，愿意试点，但不喜欢空泛概念",
      background: "护理专业出身，在机构干了 9 年，从护士长升到运营副院长",
      daily_routine: "白天盯入住和排班，晚上最怕电话响起说明又出突发情况。",
      tech_comfort: "不排斥新技术，但必须先看到流程价值。",
      interview_style: "说话直接，喜欢具体案例和数字。",
      desires: ["减轻夜班照护压力", "让家属更安心"],
      pains: ["夜班覆盖不够", "安抚和巡视容易冲突"],
      hidden_pain: "最怕再出一次明明能提前发现却没发现的夜间事件。",
      contradictions: ["想试新方案但怕员工不会用", "希望提升体验但预算很紧"]
    };
  }
  return {
    name: "林悦",
    age: 31,
    occupation: "品牌策划",
    living_situation: "一线城市独居，租住小两居",
    personality: "外向但容易情绪透支，回家后不太想再经营复杂关系",
    daily_routine: "早上赶地铁上班，晚上加班后回家，通常点外卖、刷手机、发会儿呆。",
    tech_comfort: "手机和智能设备用得很熟，但讨厌复杂设置。",
    interview_style: "前面回答偏短，问到具体场景会慢慢展开。",
    desires: ["回家时家里别那么冷清", "有人能给一点回应和陪伴"],
    pains: ["忙完一天回家太安静", "情绪低的时候不想再主动找人聊天", "周末一个人在家会觉得时间很空"],
    hidden_pain: "前阵子发烧一个人在家躺了一天，突然很明显地感到没人知道自己状态。",
    contradictions: ["想被陪伴但不想维护复杂关系", "喜欢科技产品但又怕麻烦"],
    family: "父母在外地，平时靠视频联系",
    spending: "愿意为高频、真有感觉的体验付费",
    daily_scenes: ["下班回家开门的一刻", "周末晚上一个人在家", "生病或情绪低落时"],
    trigger: "最近连续几周加班，回家后的空落感比以前明显了。"
  };
}

function buildInterviewExtractJson(prompt) {
  const focusedMatch = prompt.allText.match(/本成员负责维度:\s*([^\n]+)/);
  const focused = (focusedMatch ? focusedMatch[1] : "interaction, safety")
    .split(",")
    .map((item) => compactText(item))
    .filter(Boolean);
  const primary = focused[0] || "interaction";
  const secondary = focused[1] || "safety";
  const dimensionEvidence = {};

  focused.forEach((dim, index) => {
    dimensionEvidence[dim] = {
      mentioned: true,
      strength: index === 0 ? "strong" : "medium",
      evidence: [
        {
          quote: index === 0 ? "下班回家后家里太安静，会觉得情绪往下掉。" : "有时候希望别让我自己再起身折腾。",
          reason: index === 0
            ? `${dim} 维度相关的需求在对话里被明确说到了。`
            : `${dim} 维度相关的顾虑和使用场景被提到了。`
        }
      ],
      needs: index === 0
        ? ["回家时希望被及时回应和陪伴"]
        : ["希望减少起身折腾或额外负担"],
      scenarios: index === 0
        ? ["下班回家开门的一刻"]
        : ["晚上一个人在家、状态不太好的时候"],
      pain_points: index === 0
        ? ["回家后空落感被放大"]
        : ["需要自己再处理很多小事，很容易觉得累"]
    };
  });

  return JSON.stringify({
    focused_dimensions: [primary, secondary],
    dimension_evidence: dimensionEvidence,
    other_dimensions: {
      perception: { mentioned: true, brief: "希望设备能看懂自己的状态和情绪变化。" },
      motion: { mentioned: false, brief: "" },
      safety: { mentioned: true, brief: "独处和身体状态不佳时会担心没人知道。" },
      extend: { mentioned: true, brief: "提到希望和家里环境协同，让回家更省心。" },
      ops: { mentioned: true, brief: "不希望额外增加设置和维护负担。" }
    },
    tags: ["情感陪伴", "语音交互", "隐私保护", "智能家居", "OTA更新"],
    interview_quality: {
      specificity: "high",
      consistency: "medium",
      actionability: "medium"
    },
    missing_dimensions: ["motion"]
  });
}

function buildResponseContent(callerType, payload) {
  const prompt = getPromptBundle(payload);
  const allText = prompt.allText;
  const who = extractLabeledValue(allText, "WHO") || "独居白领";
  const pain = extractLabeledValue(allText, "PAIN") || "下班回家时孤独感明显";
  const how = extractLabeledValue(allText, "HOW") || "通过主动迎接和陪伴互动缓解情绪下坠";
  const architecture = inferArchitecture(allText);
  const userTurns = countUserTurns(prompt.messages);

  switch (callerType) {
    case "persona_constraints":
      return JSON.stringify({
        age_range: [25, 40],
        living_situations: ["独居", "与伴侣同住但作息错开"],
        key_pains: ["回家后过于安静", "情绪低落时没人回应", "周末独处时缺少陪伴感"],
        key_jobs: ["希望回家后更快切换状态", "希望有人陪自己待一会儿"],
        context_clues: ["加班较多", "对智能设备不排斥但怕麻烦"]
      });
    case "persona_generate":
      return JSON.stringify(buildPersonaObject(prompt));
    case "interview_persona_reply":
      return "嗯……最明显的时候还是下班刚到家那一会儿吧。屋里特别安静，人就会一下子松下来，也有点空。要说具体想要什么功能，我其实说不上来，我更在意那种被回应、别太冷清的感觉。";
    case "interview_complete":
      return JSON.stringify({
        complete: userTurns >= 5,
        coverage: userTurns >= 5 ? 82 : 61,
        uncovered: userTurns >= 5 ? [] : ["更具体的触发场景", "长期使用顾虑"],
        reason: userTurns >= 5 ? "核心生活场景、情绪痛点和使用顾虑都已经被问到。" : "还需要继续追问触发时刻和顾虑边界。"
      });
    case "interview_extract":
      return buildInterviewExtractJson(prompt);
    case "vp_extract":
      return JSON.stringify({
        who_raw: who,
        pain_raw: pain,
        how_raw: how,
        alternative_raw: "现有做法主要靠人自己熬过去，缺少稳定回应",
        boundary_raw: "不适合需要人工决策或复杂处置的场景",
        WHO: who,
        PAIN: pain,
        HOW: how
      });
    case "vp_summary":
      return JSON.stringify({
        who,
        pain,
        how,
        arch_consistency: `${architecture} 型表达一致，重点放在高频场景与核心体验上。`,
        coach_comment: "这一版目标人群、场景和解决机制已经成形，后续只要把边界条件说得再清楚一点就够了。",
        confirmed_architecture: architecture
      });
    case "vp_confirm":
      return [
        `为${who}，在高压或独处的生活场景里，解决${pain}的问题，提供${how}的陪伴式方案。`,
        `<vp_result>${JSON.stringify({
          target_customer: who,
          scenario_pain: pain,
          value_creation: how,
          boundary: "不适合处理需要人工判断或复杂投诉的场景"
        })}</vp_result>`
      ].join("\n");
    case "vp_synthesize":
      return `"为${who}，在用户最容易感到空落或需要被回应的时刻，解决${pain}的问题，提供${how}的陪伴式体验——比现有做法更持续、更自然。"`; 
    case "vp_synthesis_feedback":
      return "我帮你整理了一版，填在下方文本框里了。现在目标客户、痛点和解法已经比较完整了，只要再补一句为什么现有方案接不住这种情绪落差，以及什么场景下它不适合，就可以更稳地提交。";
    case "vp_coach":
      return "这个 WHO 已经有方向了。你们下一步可以把场景再压实一点：到底是哪一个时刻最痛，现有做法为什么接不住，这样 HOW 才会更有说服力。";
    case "teacher_debrief_global":
      return [
        "## 课堂复盘",
        "",
        "今天多数团队在目标人群选择上已经聚焦，但常见问题是把痛点写成了功能愿望。",
        "",
        "建议下一轮继续追问三个问题：最痛的时刻是什么、现有替代方案为什么不够、团队方案在哪个边界条件下不成立。"
      ].join("\n");
    case "teacher_debrief_team":
      return JSON.stringify({
        insight: "战略方向是对的，但场景证据还不够锋利。",
        review: "这组从 Round 1 到 Round 2 的方向总体一致，说明定位没有跑偏。问题在于用户场景还可以更具体，导致后续选卡和定价的说服力被削弱。如果能把最高频、最痛的那一刻再压实，产品组合和渠道逻辑会更顺。"
      });
    case "fallback":
    default:
      return "好的，我理解了。";
  }
}

function buildChatCompletionBody(payload, content) {
  return {
    id: `chatcmpl-mock-${crypto.randomUUID()}`,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model: String(payload?.model || "deepseek-chat"),
    choices: [
      {
        index: 0,
        message: { role: "assistant", content },
        finish_reason: "stop"
      }
    ],
    usage: {
      prompt_tokens: 100,
      completion_tokens: 50,
      total_tokens: 150
    }
  };
}

function recordStart(routeKey, callerType) {
  state.totalRequests += 1;
  state.inflight += 1;
  state.maxInflight = Math.max(state.maxInflight, state.inflight);
  state.byCallerType[callerType] = (state.byCallerType[callerType] || 0) + 1;
  state.byRoute[routeKey] = (state.byRoute[routeKey] || 0) + 1;
}

function recordFinish(latencyMs, callerType) {
  state.inflight = Math.max(0, state.inflight - 1);
  state.completedRequests += 1;
  state.totalLatencyMs += latencyMs;
  console.log(`${nowIso()} ${callerType} latency=${latencyMs}ms in-flight=${state.inflight}`);
}

function statsBody() {
  return {
    ok: true,
    started_at: new Date(state.startedAt).toISOString(),
    uptime_sec: Math.round((Date.now() - state.startedAt) / 1000),
    inflight: state.inflight,
    max_inflight: state.maxInflight,
    total_requests: state.totalRequests,
    completed_requests: state.completedRequests,
    avg_latency_ms: state.completedRequests
      ? Math.round(state.totalLatencyMs / state.completedRequests)
      : 0,
    by_caller_type: state.byCallerType,
    by_route: state.byRoute,
    latency_config: {
      mean_ms: LATENCY_MEAN,
      stddev_ms: LATENCY_STDDEV
    }
  };
}

async function handleChatCompletions(req, res) {
  let rawBody = "";
  try {
    rawBody = await readBody(req);
  } catch (err) {
    return sendJson(res, 413, { error: { message: err.message || "invalid body" } });
  }

  let payload = {};
  try {
    payload = rawBody ? JSON.parse(rawBody) : {};
  } catch (err) {
    return sendJson(res, 400, { error: { message: "invalid json body" } });
  }

  const callerType = classifyChatRequest(payload);
  const routeKey = `${req.method} ${req.url}`;
  const latencyMs = simulateLatency();
  recordStart(routeKey, callerType);

  const content = buildResponseContent(callerType, payload);
  const body = buildChatCompletionBody(payload, content);

  setTimeout(() => {
    sendJson(res, 200, body);
    recordFinish(latencyMs, callerType);
  }, latencyMs);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);

  if (req.method === "GET" && url.pathname === "/stats") {
    return sendJson(res, 200, statsBody());
  }

  if (req.method === "GET" && url.pathname === "/v1/models") {
    return sendJson(res, 200, {
      object: "list",
      data: [
        { id: "deepseek-chat", object: "model", owned_by: "mock-deepseek" },
        { id: "deepseek-reasoner", object: "model", owned_by: "mock-deepseek" }
      ]
    });
  }

  if (req.method === "POST" && url.pathname === "/v1/chat/completions") {
    return handleChatCompletions(req, res);
  }

  return sendJson(res, 404, {
    error: { message: `mock deepseek route not found: ${req.method} ${url.pathname}` }
  });
});

server.listen(PORT, HOST, () => {
  console.log(`[mock-deepseek] listening on http://${HOST}:${PORT}`);
});

