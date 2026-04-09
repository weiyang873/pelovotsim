// vpCoach.js - VP Coach logic v5b
const { chatCompletion } = require("./deepseekClient");
const { withLlmLogging } = require("./llm_logger");

const CELL_RULES = {
  ToB_ELDER: {
    label: "ToB·老人",
    examples: ["养老院", "护理院", "康复中心"],
    allowedDesc: "客户只能是服务老年人的机构（养老院、护理院、康复中心等），不能是企业办公、学校",
    keywords: ["养老院", "护理院", "康复中心", "养老机构", "老年照护机构", "社区养老服务中心"]
  },
  ToB_ADULT: {
    label: "ToB·成人",
    examples: ["科技公司", "金融机构", "酒店"],
    allowedDesc: "客户只能是面向成年人的企业/商业机构（科技公司、金融机构、酒店、办公场所等），不能是养老机构、幼儿园、学校",
    keywords: ["科技公司", "金融机构", "酒店", "办公场所", "办公室", "写字楼", "企业前台", "公司行政", "商场门店"]
  },
  ToB_CHILD: {
    label: "ToB·儿童",
    examples: ["幼儿园", "早教机构", "儿童医院"],
    allowedDesc: "客户只能是服务儿童的机构（幼儿园、早教、儿童医院等），不能是养老院、企业",
    keywords: ["幼儿园", "早教", "儿童医院", "托育机构", "少儿培训", "小学", "儿科"]
  },
  ToC_ELDER: {
    label: "ToC·老人",
    examples: ["老年人本人", "独居老人", "老人的子女"],
    allowedDesc: "客户只能是老年人本人或其子女，不能是年轻人、企业",
    keywords: ["老年人", "独居老人", "空巢老人", "退休老人", "老人本人", "老人的子女", "老人子女"]
  },
  ToC_ADULT: {
    label: "ToC·成人",
    examples: ["白领", "独居青年", "成年个人消费者"],
    allowedDesc: "客户只能是成年个人消费者（白领、独居青年等），不能是老人、家长、企业",
    keywords: ["白领", "独居青年", "年轻白领", "上班族", "都市青年", "成年个人消费者", "单身青年"]
  },
  ToC_CHILD: {
    label: "ToC·儿童",
    examples: ["有孩子的家庭", "家长", "亲子家庭"],
    allowedDesc: "客户只能是有孩子的家庭/家长，不能是成人个人、老人",
    keywords: ["有孩子的家庭", "家长", "宝妈", "宝爸", "亲子家庭", "父母", "带娃家庭"]
  }
};

const CELL_RULE_ORDER = [
  "ToB_ELDER",
  "ToB_ADULT",
  "ToB_CHILD",
  "ToC_ELDER",
  "ToC_ADULT",
  "ToC_CHILD"
];

const SYNTHESIS_BANNED_PATTERNS = [
  /C\/G\/E/iu,
  /评分/iu,
  /分数/iu,
  /痛点典型性/iu,
  /解法说服力/iu,
  /人群覆盖面/iu,
  /综合评分/iu
];

function normalizeTeamContext(strategy) {
  const s = strategy && typeof strategy === "object" ? strategy : {};
  const cellLabel = String(
    s.cell_label || s.cellLabel || s.grid_label || s.gridLabel || s.grid_id || s.gridId || "未提供"
  ).trim() || "未提供";

  const architectureRaw = String(s.architecture_label || s.architectureLabel || s.architecture || "").trim();
  const architectureMap = {
    Experience: "体验型",
    Hybrid: "混合型",
    Function: "功能型"
  };
  const architectureLabel = architectureMap[architectureRaw] || architectureRaw || "未提供";

  const jinangRaw = s.jinang || s.jinang_summary || s.jinangSummary || "";
  const normalizeList = (value) => {
    if (!Array.isArray(value)) return [];
    return value
      .map((x) => {
        if (typeof x === "string") return x.trim();
        if (x && typeof x === "object") return String(x.ability_name || x.title || x.name || x.label || x.id || "").trim();
        return "";
      })
      .filter(Boolean);
  };
  let marketJinang = normalizeList(jinangRaw.market || s.jinang_market_list || s.jinangMarketList);
  let techJinang = normalizeList(jinangRaw.tech || s.jinang_tech_list || s.jinangTechList);
  if ((!marketJinang.length && !techJinang.length)) {
    const summaryList = normalizeList(jinangRaw);
    if (summaryList.length > 0) {
      marketJinang = summaryList;
    }
  }
  const jinangSummary = [
    marketJinang.length ? `市场能力：${marketJinang.join("、")}` : "",
    techJinang.length ? `技术能力：${techJinang.join("、")}` : ""
  ].filter(Boolean).join("；") || "暂无";

  const sizeNum = Number(s.team_size || s.teamSize || 0);
  const teamSize = Number.isFinite(sizeNum) && sizeNum > 0 ? String(Math.round(sizeNum)) : "未提供";

  return { cellLabel, architectureLabel, jinangSummary, teamSize, marketJinang, techJinang };
}

function inferCellRuleKey(strategy) {
  const s = strategy && typeof strategy === "object" ? strategy : {};
  const marketRaw = String(s.market || s.customerType || s.customer_type || "").trim().toUpperCase();
  const segmentRaw = String(s.segment || s.ageGroup || s.age || "").trim().toUpperCase();
  if ((marketRaw === "TOB" || marketRaw === "B2B") && segmentRaw === "ELDER") return "ToB_ELDER";
  if ((marketRaw === "TOB" || marketRaw === "B2B") && segmentRaw === "ADULT") return "ToB_ADULT";
  if ((marketRaw === "TOB" || marketRaw === "B2B") && segmentRaw === "CHILD") return "ToB_CHILD";
  if ((marketRaw === "TOC" || marketRaw === "B2C") && segmentRaw === "ELDER") return "ToC_ELDER";
  if ((marketRaw === "TOC" || marketRaw === "B2C") && segmentRaw === "ADULT") return "ToC_ADULT";
  if ((marketRaw === "TOC" || marketRaw === "B2C") && segmentRaw === "CHILD") return "ToC_CHILD";

  const text = [
    s.cell_label,
    s.cellLabel,
    s.grid_label,
    s.gridLabel,
    s.grid_id,
    s.gridId
  ].map((item) => String(item || "")).join(" ").toLowerCase();

  const isToB = /tob|b2b/.test(text);
  const isToC = /toc|b2c/.test(text);
  const isElder = /老人|elder/.test(text);
  const isAdult = /成人|adult/.test(text);
  const isChild = /儿童|child/.test(text);

  if (isToB && isElder) return "ToB_ELDER";
  if (isToB && isAdult) return "ToB_ADULT";
  if (isToB && isChild) return "ToB_CHILD";
  if (isToC && isElder) return "ToC_ELDER";
  if (isToC && isAdult) return "ToC_ADULT";
  if (isToC && isChild) return "ToC_CHILD";
  return null;
}

function buildCellConsistencyPrompt(strategy, cellLabel) {
  const currentKey = inferCellRuleKey(strategy);
  const currentRule = currentKey ? CELL_RULES[currentKey] : null;
  const currentExamples = currentRule ? currentRule.examples.join("、") : "当前格子下的具体客户类型";
  const correctionDirection = String(cellLabel || (currentRule ? currentRule.label : "当前市场"));

  return [
    "## 格子一致性（最高优先级，违反此规则等于帮学生走错方向）",
    "",
    `学生选的市场是"${cellLabel}"。你在整个对话中必须严格遵守以下规则：`,
    "",
    "1. 绝对不能建议、举例、暗示任何不属于这个市场的客户类型。",
    ...CELL_RULE_ORDER.map((key) => `   - ${CELL_RULES[key].label}：${CELL_RULES[key].allowedDesc}`),
    "",
    "2. 如果学生自己提出了不属于所选格子的客户，你必须第一时间指出：",
    `   "你们选的是${cellLabel}市场，[学生说的客户]属于[正确的格子]市场。`,
    `    你们是想继续在${correctionDirection}里找客户，还是觉得[学生说的方向]更合适？`,
    `    如果想换方向，需要回到格子选择页重新选。在当前格子下，`,
    `    适合的客户类型比如：${currentExamples}。"`,
    "",
    "3. 当你举例或给选项时，所有例子必须属于当前格子的市场范围。"
  ].join("\n");
}

function detectCellMismatch(strategy, text) {
  const currentKey = inferCellRuleKey(strategy);
  if (!currentKey) return null;
  const currentRule = CELL_RULES[currentKey];
  const currentDisplayLabel = normalizeTeamContext(strategy).cellLabel || currentRule.label;
  const src = String(text || "");
  for (const key of CELL_RULE_ORDER) {
    if (key === currentKey) continue;
    const rule = CELL_RULES[key];
    const hit = rule.keywords.find((keyword) => keyword && src.includes(keyword));
    if (hit) {
      return {
        currentLabel: currentDisplayLabel,
        currentExamples: currentRule.examples,
        matchedKeyword: hit,
        matchedLabel: rule.label
      };
    }
  }
  return null;
}

function hasBannedSynthesisTerms(text) {
  const src = String(text || "");
  return SYNTHESIS_BANNED_PATTERNS.some((pattern) => pattern.test(src));
}

function inferVpCoverage(vpText) {
  const text = compactText(vpText);
  const normalized = text.replace(/[“”"「」]/g, "");
  const hasPlaceholder = /（待补充）|\(待补充\)/u;
  const segments = normalized.split(/[，。,；;——]/).map((item) => item.trim()).filter(Boolean);
  const first = segments[0] || "";
  const second = segments[1] || "";
  const third = segments[2] || "";
  const last = segments[segments.length - 1] || "";

  const hasWho = /^为.+/.test(first) && !hasPlaceholder.test(first);
  const hasPain = (
    /痛点|问题|压力|焦虑|孤独|风险|等待|跌倒|流失|成本|约束|负担|低效|麻烦/u.test(normalized) ||
    /解决.+问题/u.test(normalized)
  ) && !hasPlaceholder.test(second);
  const hasHow = /提供|通过|让|借助|利用|方案|服务|机器人/u.test(normalized) && !hasPlaceholder.test(third);
  const hasAlternative = /现有方案|传统|人工|相比|而不是|不用|替代|做不到|差在哪/u.test(normalized);
  const hasBoundary = /边界|不适用|不管用|仅限|除非|效果打折|不适合|例外/u.test(normalized) && !hasPlaceholder.test(last);

  return {
    hasWho,
    hasPain,
    hasHow,
    hasAlternative,
    hasBoundary
  };
}

function pickRelevantAbility(abilities, vpText) {
  const list = (Array.isArray(abilities) ? abilities : [])
    .map((item) => String(item || "").trim())
    .filter(Boolean);
  if (!list.length) return null;
  const text = String(vpText || "");

  const matchers = [
    {
      pattern: /巡检|异常|监测|识别|预警|数据|行为/u,
      keyword: /算法|数据|识别|健康|分析/u,
      suggestion: (name) => `你们团队的${name}能力也可以顺手写进解法里，比如补一句“通过持续识别异常信号来提前发现风险”，会让方案更扎实。`
    },
    {
      pattern: /机构|采购|连锁|门店|渠道|经销|落地/u,
      keyword: /渠道|经销|机构|客户需求|销售|BD/u,
      suggestion: (name) => `你们团队的${name}能力也可以带进去，比如补一句“能更快判断哪些机构最先愿意试点并推进落地”，这样会更像可执行方案。`
    },
    {
      pattern: /陪伴|互动|情绪|等待|安抚|体验/u,
      keyword: /运营|服务|用户|体验/u,
      suggestion: (name) => `你们团队的${name}能力也可以自然写进去，比如说明你们更懂怎么把互动流程设计得不打扰人、但能真正缓解情绪。`
    }
  ];

  for (const matcher of matchers) {
    if (!matcher.pattern.test(text)) continue;
    const matchedAbility = list.find((item) => matcher.keyword.test(item));
    if (matchedAbility) {
      return matcher.suggestion(matchedAbility);
    }
  }

  const fallbackAbility = list[0];
  if (!fallbackAbility) return null;
  if (!text) return null;
  return `你们团队的${fallbackAbility}能力也可以自然写进这一版里，最好直接补一句它会怎么帮助方案落地或提升效果。`;
}

function buildCoverageSummary(coverage) {
  const present = [];
  if (coverage.hasWho) present.push("客户");
  if (coverage.hasPain) present.push("痛点");
  if (coverage.hasHow) present.push("解法");
  if (coverage.hasAlternative) present.push("替代方案对比");
  if (coverage.hasBoundary) present.push("边界条件");
  if (!present.length) return "目前这版还更像一个方向描述，五个关键要素都需要再补。";
  return `这版已经把${present.join("、")}说出来了。`;
}

function buildMissingAdvice(coverage, strategy) {
  const currentKey = inferCellRuleKey(strategy);
  const currentRule = currentKey ? CELL_RULES[currentKey] : null;
  const advice = [];

  if (!coverage.hasWho) {
    advice.push(currentRule && /^ToB_/u.test(currentKey)
      ? `客户还不够准，最好直接写成“为${currentRule.examples[0]}这类机构里的具体负责人”再往下展开。`
      : "客户还不够准，最好直接写成“为哪类人、处在什么生活状态”再往下展开。");
  }
  if (!coverage.hasPain) {
    advice.push("痛点还偏空，最好补一个具体场景句，比如“在什么时刻会卡住、会焦虑、会出错”。");
  }
  if (!coverage.hasHow) {
    advice.push("解法还不够清楚，最好补一句“产品具体通过什么动作或机制解决这个问题”。");
  }
  if (!coverage.hasAlternative) {
    advice.push("替代方案对比还没说，最好补一句“现在通常靠什么凑合，而这些办法为什么不够”。");
  }
  if (!coverage.hasBoundary) {
    advice.push("边界条件还没落下，最好补一句“在什么场景下不适用，或者效果会明显打折”。");
  }

  return advice;
}

function buildSynthesisFallbackFeedback(session, synthesizedVP, teamJinangs) {
  const strategy = session?.strategy || {};
  const strategyContext = normalizeTeamContext(strategy);
  const mismatch = detectCellMismatch(strategy, synthesizedVP);
  const coverage = inferVpCoverage(synthesizedVP);
  const advice = buildMissingAdvice(coverage, strategy);
  const abilityLine = pickRelevantAbility(teamJinangs, synthesizedVP);

  const lines = ["我帮你整理了一版，填在下方文本框里了。"];
  if (mismatch) {
    lines.push(`你们选的是${mismatch.currentLabel}市场，“${mismatch.matchedKeyword}”更像${mismatch.matchedLabel}方向。如果想换方向，需要回到格子选择页重新选；在当前格子下，更适合的客户类型比如：${mismatch.currentExamples.join("、")}。`);
  }
  lines.push(buildCoverageSummary(coverage));
  if (advice.length > 0) {
    lines.push(advice.slice(0, 2).join(""));
  }
  if (abilityLine) {
    lines.push(abilityLine);
  }
  lines.push(advice.length === 0 && !mismatch
    ? "这版五个要素都覆盖了，可以点'提交VP'了。"
    : "补完这些再点'提交VP'。");
  return compactText(lines.join("\n\n"));
}

function sanitizeSynthesisFeedback(feedback, synthesizedVP, strategy, teamJinangs) {
  const text = compactText(feedback);
  if (!text || hasBannedSynthesisTerms(text)) {
    return buildSynthesisFallbackFeedback({ strategy }, synthesizedVP, teamJinangs);
  }
  return text;
}

function ensureSynthesisLead(feedback) {
  const text = compactText(feedback);
  if (!text) return "我帮你整理了一版，填在下方文本框里了。";
  if (text.startsWith("我帮你整理了一版")) return text;
  return compactText(`我帮你整理了一版，填在下方文本框里了。\n\n${text}`);
}

function enforceSynthesisMismatch(feedback, mismatch) {
  if (!mismatch) return ensureSynthesisLead(feedback);
  const warning = `你们选的是${mismatch.currentLabel}市场，“${mismatch.matchedKeyword}”属于${mismatch.matchedLabel}方向。如果想换方向，需要回到格子选择页重新选；在当前格子下，适合的客户类型比如：${mismatch.currentExamples.join("、")}。`;
  const text = ensureSynthesisLead(feedback);
  if (text.includes(warning)) return text;
  const prefix = "我帮你整理了一版，填在下方文本框里了。";
  const suffix = text.slice(prefix.length).trim();
  return compactText(`${prefix}\n\n${warning}\n\n${suffix}`);
}

function countScoringRounds(messages) {
  const list = Array.isArray(messages) ? messages : [];
  return list.filter((m) => {
    if (!m || m.role !== "assistant") return false;
    const content = String(m.content || "");
    return /\d\.\d\/5\.0/.test(content);
  }).length;
}

function buildSystemPrompt(strategy, runtime = {}) {
  const { cellLabel, architectureLabel, jinangSummary, teamSize, marketJinang, techJinang } = normalizeTeamContext(strategy);
  const chatTurnIndex = Number(runtime.chatTurnIndex || 0);
  const shouldMentionJinang = chatTurnIndex === 1;
  const shouldAskPersonalExperience = chatTurnIndex === 2 || chatTurnIndex === 3;

  return `${buildCellConsistencyPrompt(strategy, cellLabel)}

你是 LOVOT 产品创新战略模拟的价值主张教练。语气平实、客观，像一个见过很多案例的顾问在帮学生想清楚。

## 背景

学生已经选定了市场方向，不需要你帮他们重新选：
- 目标市场：${cellLabel}
- 产品定位：${architectureLabel}
- 团队锦囊能力：${jinangSummary}
- 团队人数：${teamSize} 人

这个团队的成员拿到了以下能力锦囊：
- 市场能力：${marketJinang.length ? marketJinang.join("、") : "暂无"}
- 技术能力：${techJinang.length ? techJinang.join("、") : "暂无"}

## 你要做的事

帮学生写出一句完整的价值主张，说清楚：LOVOT 为什么样的客户、在什么场景下、创造了什么价值、为什么现有方案做不到。

第一轮开场白已由系统自动生成（包含扫地机器人举例和团队锦囊提示），你不需要重复。学生的第一条消息会是他们对方向的初步想法或问题。直接进入点评或引导。

收到学生的每一版后，你做四件事：

第一，检查有没有跑偏。学生写的内容必须跟他们选的定位一致。如果选了体验型却在列功能清单，或者选了功能型却在讲情感故事，直接平实地指出来。如果是 ToB 市场但学生把客户写成终端用户而不是机构，也要指出来。

第二，帮学生把想法发展得更具体。目标客户的描述必须达到以下标准才算够具体，否则继续追问：

ToB 市场的客户描述必须包含至少 3 个要素：
① 机构类型（幼儿园/养老院/酒店 等）
② 机构的具体处境或约束（师幼比不足/护工短缺/客户等待焦虑 等）
③ 决策者或规模（园长/连锁品牌/50-200床 等）

不够的例子："幼儿园"（只有①） → 追问"什么样的幼儿园？规模多大？面临什么问题？"
够了的例子："师幼比严重不足、每年9月新生哭闹最严重的民办幼儿园"（①②③都有）

ToC 市场的客户描述必须包含至少 2 个要素：
① 人群类型（白领/老人/家长 等）
② 生活状态或约束（独居/加班多/孩子上幼儿园 等）

不够的例子："年轻人"（只有①） → 追问"什么样的年轻人？什么生活状态？"
够了的例子："一线城市独居、每天加班到9点的单身白领"（①②都有）

在客户描述达标之前，不要跳到痛点讨论。如果痛点停在"孤独""不方便"这种抽象词，问他们能不能描述一个具体场景。如果价值创造在列功能，问他们客户用了之后生活/运营有什么不同。如果没有提到替代方案，问他们客户现在怎么解决这个问题、那些方案差在哪。每轮只推一个方向，不要同时问多个问题。如果学生卡住或主动要求给方向，可以给 2-3 个方向示例帮他们打开思路，但不要用 LOVOT 的具体写法做示例。给示例时，必须确保每个示例与学生已经确定的客户定义逻辑一致——不要给出隐含不同前提的示例。

在每一轮追问之前，检查逻辑一致性。具体来说：

- 当学生定义了客户的状态（比如"想养宠物但没养的人"），后续讨论的痛点场景必须基于同一个状态前提。如果学生说的是"想养但养不了"，痛点就应该是"为什么养不了"，而不是"养了之后怎么办"。
- 当你发现当前讨论的场景前提与前面确定的客户定义矛盾时，不要继续往下推，而是先指出来："你前面说的客户是[客户定义]，但这个场景假设他们已经[矛盾的前提]——这两个对不上。我们是要改客户定义，还是换个痛点场景？"
- 当你给学生示例帮他们打开思路时，示例本身必须与已确定的客户定义逻辑兼容。不要给出预设了不同前提的示例。

第三，帮学生整理和收敛。这是你最重要的工作之一——学生的写作能力有限，他们在对话中说出的零散想法需要你帮他们组织成一句完整的价值主张。具体规则：
- 当学生的素材差不多了（目标客户、场景痛点、价值创造基本清楚），你就主动帮他们收成一句话。不要等学生要求。
- 每次学生补充了新的素材或修改了方向，你都要重新帮他们整理一版新的完整句子。不是只整理一次——每次有更新都要重写。
- 整理时只用学生自己说过的素材，不加你自己的想法。
- 整理完之后直接点评这句话——哪里到位了、哪里还可以更好，指出一个具体的可以提升的方向。
- 如果学生主动说"你帮我写个草稿"或"帮我整理一下"，立刻帮他们写，不要拒绝。
- 检查有没有边界（什么时候不管用），如果没有就提醒学生想想。

轮次附加要求：
${shouldMentionJinang ? "- 这是第一轮反馈。请自然地提到 1-2 张锦囊，问团队有没有考虑怎么发挥这些能力。例如：'我注意到你们团队有人具备区域经销网络的能力——你们的方案里有考虑怎么利用这个优势吗？'" : "- 如果当前方案明显和团队锦囊能力矛盾，请点出来。"}
${shouldAskPersonalExperience ? "- 如果自然合适，可以插入一个需要个人经验的问题（如'你们身边有没有人会是这个产品的真实用户？'），但不要在已经有其他追问的回复里追加。宁可下一轮再问。" : ""}

在对话过程中，如果学生在写解法（HOW）或讨论痛点（PAIN）时，且内容和团队能力有关，请自然地提一句团队的相应能力可以怎么用。例如学生写“机器人巡检”时，你可以说“你们团队的健康算法能力正好可以用在这里，比如分析巡检数据来识别异常模式，这会让解法更有说服力。”
规则：
- 只在和团队能力相关的地方提，不要每轮都提
- 最多提 2 次，开场白里的能力提示算第 1 次
- 不要说“根据你们的锦囊”，改说“你们团队的XX能力”

## 锦囊能力的使用

在对话中，如果学生在写解法或讨论痛点时，你应该自然地提一句团队的锦囊能力可以怎么用。

规则：
- 只在跟锦囊能力相关的地方提，不要每轮都提
- 整个对话中最多主动提 2 次（开场白里的提及算第 1 次）
- 不要说"根据你们的锦囊"或"你们的锦囊卡"
- 要说"你们团队的XX能力"或"你们在XX方面的经验"
- 要给一个具体的用法建议，不要泛泛地说"可以用上"

示例：
- 学生说"机器人巡检"，团队有"健康数据与算法"能力 →
  "你们团队的健康算法能力正好可以用在这里——比如通过分析巡检数据来识别老人的行为异常模式，这会让你的解法更有说服力。"

全程不要在发散阶段给 LOVOT 场景的具体写法做示例。不要引导学生量化具体数字。不要说"太棒了""非常好"这种空话。评分模式以外不要输出 C/G/E 分数或任何评分。每轮回复不超过 150 字（收敛整合除外）。

## 最终提交

学生确认提交时，输出最终版的一句话价值主张，然后输出 JSON（放在 <vp_result> 标签内）：

<vp_result>
{
  "target_customer": "目标客户（学生原话整理）",
  "scenario_pain": "场景痛点（学生原话整理）",
  "value_creation": "价值创造（学生原话整理）",
  "boundary": "边界条件（学生原话整理，没提则写'未明确'）"
}
</vp_result>

## 硬性格式约束（必须遵守）
1. 你的每条回复里，最多只能包含一个问号。如果你要追问，只能问一个问题。
2. 不要在回复末尾贴固定格式的诊断标签。如果你觉得哪里薄弱，自然地融进你的点评里，不要用"当前最需要补强的是：……"这种模板。
3. 回复不超过 150 字（帮学生整合 VP 句子时除外）。`;
}

function buildStaticOpening(strategy) {
  const { cellLabel, architectureLabel, marketJinang, techJinang } = normalizeTeamContext(strategy);
  const archDesc = {
    "体验型": "主打情感体验价值",
    "混合型": "既要有功能价值，也要有情感体验",
    "功能型": "主打功能实用价值"
  }[architectureLabel] || "";

  const jinangLines = [];
  if (marketJinang.length > 0) jinangLines.push(`市场能力：${marketJinang.join("、")}`);
  if (techJinang.length > 0) jinangLines.push(`技术能力：${techJinang.join("、")}`);
  const jinangMention = jinangLines.length > 0
    ? `\n\n我注意到你们团队具备${jinangLines.join("，")}的能力，后面可以想想怎么把这些优势用进去。`
    : "";

  const isToB = /ToB|tob|B2B/i.test(cellLabel);
  const tobReminder = isToB
    ? "\n\n提醒一下：你们选的是 ToB 市场，所以买单的客户是企业或机构，不是终端消费者个人。写价值主张时要围绕机构的需求和痛点来写。"
    : "";

  return `你们选的方向是${cellLabel}，产品定位${architectureLabel}${archDesc ? `——${archDesc}` : ""}。

在开始之前，先看个例子。扫地机器人的价值主张不是"它能自动扫地"——那是功能描述。好的价值主张是这样的：

"为每天要维持家里整洁但没时间打扫的双职工家庭，提供一台能自主清扫的家用机器人，让他们不在家时地板也能保持干净——而不用请保洁或挤周末时间自己扫。"

这句话做到了三件事：说清了客户是谁和他们的处境；说清了痛点卡在哪；说清了产品带来什么变化、为什么现有方案做不到。${jinangMention}${tobReminder}

请团队讨论 2-3 分钟，写第一版——LOVOT 为什么样的${isToB ? "企业客户" : "客户"}、在什么场景下、解决了什么问题、为什么现有方案做不到。写好发给我。`;
}

function parseVpResult(text) {
  const match = String(text || "").match(/<vp_result>([\s\S]*?)<\/vp_result>/i);
  if (!match) return null;
  try {
    return JSON.parse(match[1].trim());
  } catch (e) {
    console.error("VP result JSON parse failed", e);
    return null;
  }
}

function extractVpResultRaw(text) {
  const match = String(text || "").match(/<vp_result>[\s\S]*?<\/vp_result>/i);
  return match ? match[0].trim() : null;
}

function stripVpResultTag(text) {
  return String(text || "")
    .replace(/<vp_result>[\s\S]*?<\/vp_result>/ig, "")
    .replace(/<vp_result>[\s\S]*$/ig, "")
    .trim();
}

function normalizeScore(v, fallback = null) {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(1.0, Math.min(5.0, Math.round(n * 10) / 10));
}

function parseVpScore() {
  return null;
}

function parseScoresFromText() {
  return null;
}

function compactText(text) {
  return String(text || "")
    .replace(/\r/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function hasAnyMention(text, items) {
  const src = String(text || "");
  return (Array.isArray(items) ? items : []).some((item) => {
    const key = String(item || "").trim();
    return key && src.includes(key);
  });
}

function ensureJinangMention(text, marketJinang, techJinang) {
  const reply = compactText(text);
  const market = (Array.isArray(marketJinang) ? marketJinang : []).filter(Boolean);
  const tech = (Array.isArray(techJinang) ? techJinang : []).filter(Boolean);
  if (hasAnyMention(reply, market) || hasAnyMention(reply, tech) || /锦囊|能力/.test(reply)) {
    return reply;
  }

  const picked = [];
  if (market[0]) picked.push(`我注意到你们团队有人具备“${market[0]}”这张市场锦囊`);
  if (tech[0]) picked.push(`也有人具备“${tech[0]}”这张技术锦囊`);
  if (picked.length === 0) return reply;

  return compactText(`${picked.join("，")}。你们这一版里有考虑怎么把这个优势用进去吗？\n\n${reply}`);
}

async function chat(session, userMessage, options = {}) {
  const requestedMode = options.mode || (options.isSubmit ? "score" : "chat");
  const mode = requestedMode;
  console.log("[vpCoach] mode:", mode);
  const existingAssistantMsgs = (Array.isArray(session?.messages) ? session.messages : [])
    .filter((m) => m && m.role === "assistant");
  if (mode === "chat" && existingAssistantMsgs.length === 0) {
    return {
      replyText: buildStaticOpening(session?.strategy || {}),
      vpResult: null,
      vpResultRaw: null,
      scorePreview: null,
      scoreValid: false,
      scoringRounds: 0
    };
  }
  const scoringRounds = countScoringRounds(Array.isArray(session?.messages) ? session.messages : []);
  const forceSubmitGuide = Boolean(options.forceSubmitGuide);
  const finalRoundHint = forceSubmitGuide ? "，本轮后只能确认提交" : "";
  const chatTurnIndex = mode === "chat"
    ? (Array.isArray(session?.messages) ? session.messages.filter((item) => item && item.role === "assistant").length : 0) + 1
    : 0;
  const strategyContext = normalizeTeamContext(session?.strategy || {});

  const systemPrompt = buildSystemPrompt(session?.strategy || {}, { finalRoundHint, chatTurnIndex });
  const messages = [
    { role: "system", content: systemPrompt },
    ...((Array.isArray(session?.messages) ? session.messages : []).map((m) => ({ role: m.role, content: m.content }))),
    { role: "user", content: String(userMessage || "") }
  ];

  if (mode === "confirm") {
    messages.push({
      role: "user",
      content: "请输出最终确认版本。先输出最终版的一句话价值主张，然后输出 <vp_result> JSON。JSON 字段为 target_customer/scenario_pain/value_creation/boundary。scores 字段不需要你填，系统会自动填入。"
    });
  }

  const temperature = options.temperature !== undefined ? options.temperature : 0.6;
  const maxTokens = mode === "confirm" ? 800 : 500;
  const rawReply = await withLlmLogging({
    caller: "vpCoach.chat",
    teamId: session?.teamId || session?.team_id || session?.teamKey || null,
    memberId: session?.memberId || session?.member_id || null,
    messages
  }, () => chatCompletion(messages, { temperature, max_tokens: maxTokens }));
  const vpResult = parseVpResult(rawReply);
  const vpResultRaw = extractVpResultRaw(rawReply);
  let replyText = compactText(stripVpResultTag(rawReply));
  let scorePreview = null;
  let scoreValid = false;

  if (mode === "confirm" && !replyText) {
    replyText = "已确认提交，最终结果如下。";
  }

  if (mode === "chat") {
    replyText = replyText
      .replace(/(?:^|\n).*?(?:\d\.\d\s*\/\s*5(?:\.0)?|\b[CGE]\s*[:：=]?\s*[1-5](?:\.\d)?\b).*(?=\n|$)/gi, "")
      .replace(/(?:^|\n)\*{0,2}评分[:：]?\*{0,2}(?=\n|$)/gi, "")
      .replace(/(?:^|\n).*继续修改，或者确认提交.*(?=\n|$)/gi, "")
      .replace(/(?:^|\n).*本轮后请确认提交。*(?=\n|$)/gi, "")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
    if (chatTurnIndex === 1) {
      replyText = ensureJinangMention(replyText, strategyContext.marketJinang, strategyContext.techJinang);
    }
    scorePreview = null;
    scoreValid = false;
  }

  replyText = replyText
    .replace(/[\uFFFD\uFFFE\uFFFF]/g, "")
    .replace(/\uD800[\uDC00-\uDFFF]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, "")
    .trim();

  return {
    replyText,
    vpResult,
    vpResultRaw,
    scorePreview,
    scoreValid,
    scoringRounds
  };
}

async function startWithCanvas(session, vpCanvas) {
  const canvasText = formatCanvas(vpCanvas);
  const firstMessage = `以下是我们团队的 Value Proposition Canvas 初稿：\n\n${canvasText}\n\n请帮我们点评。`;
  return chat(session, firstMessage, { mode: "chat" });
}

async function generateSynthesisFeedback(session, synthesizedVP, teamJinangs = null) {
  const strategyContext = normalizeTeamContext(session?.strategy || {});
  const abilityList = Array.isArray(teamJinangs) && teamJinangs.length
    ? teamJinangs.map((item) => {
        if (typeof item === "string") return item.trim();
        if (item && typeof item === "object") return String(item.ability_name || item.name || item.title || item.label || "").trim();
        return "";
      }).filter(Boolean)
    : []
      .concat(strategyContext.marketJinang || [])
      .concat(strategyContext.techJinang || []);
  const messages = [
    {
      role: "system",
      content: `你是一个 EMBA 商业模拟的 AI 策略顾问。学生刚完成了一版价值主张，你需要在对话中给反馈。

学生选择的市场：${strategyContext.cellLabel}
学生选择的架构：${strategyContext.architectureLabel}
团队锦囊能力：${abilityList.join("、") || "无"}

学生合成的价值主张：
"${synthesizedVP}"

你需要做三件事：

第一，检查客户类型是否属于"${strategyContext.cellLabel}"市场。如果不属于，第一句就要指出跑偏了，建议修正。

第二，检查以下五个要素是否在价值主张中出现：
1. 目标客户（WHO）：明确说了是什么类型的客户
2. 痛点（PAIN）：说了客户面临什么具体问题
3. 解决方式（HOW）：说了产品怎么解决这个问题
4. 替代方案对比：说了跟现有方案比好在哪
5. 边界条件：说了什么情况下不管用

第三，如果团队有锦囊能力，且当前VP的解法部分可以用上这个能力，自然地提一句怎么用。

输出格式：
- 先说一句"我帮你整理了一版，填在下方文本框里了。"
- 如果客户跑偏了，立刻指出
- 然后说当前覆盖了哪些要素（一句话带过，不要逐条列）
- 然后说还缺什么，每个缺的给一个具体的补充建议（不要泛泛地说"补充替代方案"，要给一个例句方向）
- 如果锦囊能力跟当前VP相关，自然地提一句怎么用（不要说"根据你们的锦囊"，说"你们团队的XX能力"）
- 如果五个要素都有了且客户方向正确，说"这版五个要素都覆盖了，可以点'提交VP'了。"
- 如果还缺要素，说"补完这些再点'提交VP'。"

规则：
- 不要用列表，写成自然对话
- 不要提C/G/E或任何评分维度名称
- 总长度控制在 100-200 字
- 语气平实，像有经验的顾问在点评`
    },
    { role: "user", content: "请给出反馈" }
  ];

  const raw = await withLlmLogging({
    caller: "vpCoach.generateSynthesisFeedback",
    teamId: session?.teamId || session?.team_id || null,
    memberId: null,
    messages
  }, () => chatCompletion(messages, { temperature: 0.3, max_tokens: 400 }));

  const mismatch = detectCellMismatch(session?.strategy || {}, synthesizedVP);
  const sanitized = sanitizeSynthesisFeedback(raw, synthesizedVP, session?.strategy || {}, abilityList);
  return enforceSynthesisMismatch(sanitized, mismatch);
}

async function synthesizeVP(session) {
  const { cellLabel, architectureLabel } = normalizeTeamContext(session?.strategy || {});
  const cachedPmf = session?.pmfScore && typeof session.pmfScore === "object" ? session.pmfScore : {};
  const currentCount = Array.isArray(session?.messages) ? session.messages.length : 0;
  if (
    Number(cachedPmf._synthesis_message_count || 0) === currentCount &&
    String(cachedPmf._vp_sentence || "").trim() &&
    String(cachedPmf._synthesis_feedback || "").trim()
  ) {
    return {
      vpText: String(cachedPmf._vp_sentence || "").trim(),
      raw: String(cachedPmf._synthesis_raw || "").trim(),
      feedback: String(cachedPmf._synthesis_feedback || "").trim(),
      cached: true,
      messageCount: currentCount
    };
  }

  const history = (Array.isArray(session?.messages) ? session.messages : [])
    .map((message) => {
      const tag = message.role === "user" ? "学生" : "教练";
      return `${tag}：${message.content}`;
    })
    .join("\n\n");

  const messages = [
    {
      role: "system",
      content: `你是一个价值主张整理工具。你的唯一任务是从对话记录中提取学生讨论的素材，组装成一句完整的价值主张。

规则：
1. 只用对话中出现过的素材（学生说的 + 教练帮学生整理过且学生没有否定的内容）
2. 不要加你自己的想法或信息
3. 输出格式：一句话，用引号包裹。结构是："为[目标客户]，在[场景]下，解决[痛点]的问题，提供[产品/方案]——[为什么现有方案做不到]。[边界条件，如果有的话]"
4. 如果对话中某个要素（客户/场景/痛点/方案/替代对比/边界）还没讨论到，就在那个位置写"（待补充）"
5. 只输出这句话，不要输出任何解释、点评、评分`
    },
    {
      role: "user",
      content: `学生选定的市场：${cellLabel}
学生选定的架构：${architectureLabel}

对话记录：
${history}

请从以上对话中提取素材，组装成一句完整的价值主张。`
    }
  ];

  const raw = await withLlmLogging({
    caller: "vpCoach.synthesizeVP",
    teamId: session?.teamId || session?.team_id || null,
    memberId: null,
    messages
  }, () => chatCompletion(messages, { temperature: 0.3, max_tokens: 300 }));

  const quotedMatch = String(raw || "").match(/["“「]([^"”」]{20,})["”」]/);
  const vpText = quotedMatch
    ? quotedMatch[1].trim()
    : String(raw || "").replace(/^["“「\s]+|["”」\s]+$/g, "").trim();
  const feedback = await generateSynthesisFeedback(session, vpText);

  return {
    vpText,
    raw: String(raw || ""),
    feedback,
    cached: false,
    messageCount: currentCount
  };
}

function formatCanvas(canvas) {
  if (!canvas) return "（未提供）";
  if (typeof canvas === "string") return canvas;

  return [
    "【客户档案】",
    `Customer Jobs：${canvas.customerJobs || ""}`,
    `Pains：${canvas.pains || ""}`,
    `Gains：${canvas.gains || ""}`,
    "",
    "【价值地图】",
    `Products & Services：${canvas.products || ""}`,
    `Pain Relievers：${canvas.painRelievers || ""}`,
    `Gain Creators：${canvas.gainCreators || ""}`
  ].join("\n");
}

module.exports = {
  chat,
  startWithCanvas,
  synthesizeVP,
  generateSynthesisFeedback,
  buildSystemPrompt,
  buildStaticOpening,
  parseVpResult,
  parseVpScore,
  parseScoresFromText,
  normalizeScore,
  compactText
};
