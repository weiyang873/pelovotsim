# CODEX_PERSONA_LAYERED_ARCHITECTURE_V2.md

## 目标

重构 AI persona 的 prompt 架构，从"属性列表驱动"改为"三层涌现式"架构。

核心原则（来自 ChatGPT 反馈）：
- Seed Memory 不是"人物小传"，是"行为底稿"——可持续约束行为的内部人格状态
- 半结构化输出，方便调试和约束
- Reflection 要有偏见感和口语感，不要像高质量访谈摘录
- 重点是知识边界：他擅长什么判断、会被什么术语吓住、会把问题理解成什么题

## 架构总览

```
Layer 0: Seed Memory     — 行为底稿（半结构化 JSON，初始化时调一次 LLM）
Layer 1: Reflection      — 自我认知（口语化、有偏见，初始化时调一次 LLM）
Layer 2: Plan            — 阶段策略（每个阶段开始时调一次 LLM）
Layer 3: Action          — 具体行为（每步调 LLM，system prompt = L0 + L1 + L2）
```

## 改动文件

- `scripts/sim/persona_student.js` — 主要改动
- `scripts/sim/team_runner.js` — 初始化流程调整

## 详细实现

### 1. Layer 0: generateSeedMemory()

输出半结构化 JSON，不是自由文本小传。

```javascript
async generateSeedMemory() {
  const s = this.student;
  const genderLabel = s.gender === 'male' ? '男' : '女';
  const overseasText = s.overseas?.hasOverseas 
    ? `${s.overseas.destination}（${s.overseas.duration}）` 
    : '无';
  
  const messages = [
    {
      role: "user",
      content: `根据以下人物属性，生成一份行为底稿。这不是人物介绍，是用来预测这个人在商业讨论中会怎么表现的内部参考。

人物属性：
姓名：${s.name}，${genderLabel}，${s.age}岁
学历：${s.education}，海外经历：${overseasText}
行业：${s.industry}
身份：${s.role}
背景：${s.background}
性格：${s.mbti}
决策风格：${s.decisionStyle}
风险偏好：${s.riskPreference}
表达风格：${s.fullExpressionStyle}
盲区：${s.blindSpots}

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

只输出合法 JSON。`
    }
  ];

  const startedAt = Date.now();
  try {
    const completion = await rateLimitedChat(messages, { 
      temperature: 0.9, 
      max_tokens: 400 
    });
    const parsed = parseJsonObject(completion);
    this.seedMemoryData = parsed;
    // 拼成可读的 system prompt 片段
    this.seedMemory = [
      parsed.backstory,
      `做决策的习惯：${parsed.decision_habit}`,
      `讨论风格：${parsed.discussion_style}`,
      `自信区：${parsed.confidence_zone}`,
      `盲区：${parsed.blind_zone}`,
      `压力下的反应：${parsed.under_pressure}`,
      `口头禅/说话习惯：${parsed.pet_phrases}`
    ].join('\n');
  } catch (err) {
    this.seedMemoryData = null;
    this.seedMemory = buildBaseSystemPrompt(this.student);
  }

  this.logStudentLLM({
    caller: 'persona_student.generateSeedMemory',
    step: 'L0_seed_memory',
    prompt: messages,
    completion: this.seedMemoryData || this.seedMemory,
    durationMs: Date.now() - startedAt
  });
}
```

### 2. Layer 1: generateReflection()

要碎、要土、有偏见。不是四句完美的自我总结，是这个人喝了点酒会跟你说的大实话。

```javascript
async generateReflection() {
  const messages = [
    {
      role: "system",
      content: this.seedMemory
    },
    {
      role: "user",
      content: `你就是上面这个人。跟老朋友喝酒，对方问你"你觉得你是个什么样的人"。

你不会认真回答，你会随便说说，带点自嘲或者吹牛，像真人聊天：
- 说一件事证明你是什么样的人（不要用形容词）
- 碰到不懂的新东西你第一反应是什么（老实说）
- 你在团队里是什么角色（不要美化）
- 你最相信什么道理（从你自己经历来的）

4 句话以内。像聊天不像演讲。允许有偏见、有盲点、有口头禅。`
    }
  ];

  const startedAt = Date.now();
  try {
    const completion = await rateLimitedChat(messages, {
      temperature: 0.95,
      max_tokens: 200
    });
    this.reflection = String(completion || '').trim();
  } catch (err) {
    this.reflection = '';
  }

  this.logStudentLLM({
    caller: 'persona_student.generateReflection',
    step: 'L1_reflection',
    prompt: messages,
    completion: this.reflection,
    durationMs: Date.now() - startedAt
  });
}
```

### 3. Layer 2: generatePlan(sceneDescription)

每个新阶段调用一次。一句话策略。

```javascript
async generatePlan(sceneDescription) {
  const messages = [
    {
      role: "system",
      content: `${this.seedMemory}\n\n我对自己的认识：\n${this.reflection}`
    },
    {
      role: "user",
      content: `现在的情况：${sceneDescription}

你打算怎么应对？一句话，说你的直觉策略。不要分析，就说你会怎么做。`
    }
  ];

  const startedAt = Date.now();
  try {
    const completion = await rateLimitedChat(messages, {
      temperature: 0.9,
      max_tokens: 80
    });
    this.currentPlan = String(completion || '').trim();
  } catch (err) {
    this.currentPlan = '';
  }

  this.logStudentLLM({
    caller: 'persona_student.generatePlan',
    step: 'L2_plan',
    prompt: messages,
    completion: this.currentPlan,
    durationMs: Date.now() - startedAt
  });
}
```

### 4. buildLayeredSystemPrompt()

```javascript
buildLayeredSystemPrompt() {
  let prompt = this.seedMemory || buildBaseSystemPrompt(this.student);
  
  if (this.reflection) {
    prompt += `\n\n## 我对自己的认识\n${this.reflection}`;
  }
  
  if (this.currentPlan) {
    prompt += `\n\n## 我现在的想法\n${this.currentPlan}`;
  }

  const lengthConstraint = getVPLengthConstraint(this.student?.education);
  if (lengthConstraint) {
    prompt += `\n${lengthConstraint}`;
  }

  return prompt;
}
```

### 5. 替换所有 Action 方法中的 system prompt

以下方法中，将 `buildBaseSystemPrompt(this.student)` 替换为 `this.buildLayeredSystemPrompt()`：

- `generatePhase1Choice`
- `generateVPRevision`
- `generateVPChatReply`
- `generateInterviewReply`
- `generateCardSelection`
- `generatePriceChoice`

### 6. 改动 generatePhase1Choice 的 user prompt

去掉"要有具体触发情境""要有具体机制"。替换为：

```javascript
{
  role: "user",
  content: [
    "## 当前任务",
    `你选择了市场定位：${gridDescription(choice)}（${choice.grid_id}）`,
    `架构标签：${choice.architecture}`,
    "",
    "你们小组刚完成了战略定位的选择。现在进入小组讨论环节。",
    "系统让每个人先写下自己对这个方向的初步想法，作为讨论的起点。",
    "AI 策略顾问会在你们写完后加入讨论，帮你们完善。",
    "",
    "WHO（这个方向要瞄准谁）：",
    "PAIN（他们最大的问题是什么）：",
    "HOW（LOVOT 怎么帮他们）：",
    "",
    `注意你的表达特点：${this.student.vpQuirks}`,
    getVPLengthConstraint(this.student?.education),
    '只输出 JSON：{"who":"...","pain":"...","how":"..."}'
  ].filter(Boolean).join("\n")
}
```

### 7. 修复 generateVPRevision 的 message 结构

拆成 system + user 两条（修复现有 bug）：

```javascript
const messages = [
  {
    role: "system",
    content: this.buildLayeredSystemPrompt()
  },
  {
    role: "user",
    content: `你刚看完 AI 策略顾问给你们团队的反馈：

「${String(coachReply || '').trim()}」

你的队友刚才也说了自己的想法：

「${String(speakerReply || '').trim()}」

${historyText ? '最近对话：\n' + historyText : ''}

现在请修改团队的 VP 草稿：
WHO: ${current.who || '（未明确）'}
PAIN: ${current.pain || '（未明确）'}
HOW: ${current.how || '（未明确）'}

请修改后输出 JSON：{"who":"...","pain":"...","how":"..."}`
  }
];
```

### 8. team_runner.js 初始化流程

```javascript
// === 初始化（任何决策之前）===
for (const actor of memberActors) {
  await actor.generateSeedMemory();   // Layer 0
  await actor.generateReflection();    // Layer 1
}

// === Phase 1: 选格子 + 写 VP ===
for (const actor of memberActors) {
  await actor.generatePlan(
    '你在 Innovation and Internal Entrepreneurship 课上，教授刚讲了 LOVOT 陪伴机器人的案例。现在要选一个中国市场进入方向并写下初步想法。'
  );
}

// === VP Coach 讨论（每轮更新 speaker 和 leadWriter）===
await speakerActor.generatePlan(
  'AI 策略顾问刚给了你们团队 VP 的反馈，指出了具体改进方向。现在轮到你发言回应。'
);
await leadWriterActor.generatePlan(
  'AI 策略顾问和队友都发了言。你作为主笔要决定怎么修改 VP。'
);

// === Round 2 访谈 ===
for (const actor of interviewActors) {
  await actor.generatePlan(
    '你正在对潜在用户做焦点访谈，了解他们对陪伴机器人的真实需求和顾虑。'
  );
}

// === Round 2 选卡 ===
for (const actor of cardSelectors) {
  await actor.generatePlan(
    '访谈结束了。现在要根据访谈发现选择研发能力卡，预算有限，必须做取舍。'
  );
}

// === Round 2 定价 ===
await pricingActor.generatePlan(
  '产品方案定了，现在要定最终售价。定高了卖不动，定低了不赚钱。'
);
```

### 9. 数据导出

**sim_students 表/CSV 新增列：**
- `seed_memory_json` — TEXT（JSON string），Layer 0 的半结构化输出
- `reflection` — TEXT，Layer 1 输出

在 `decision_tracker.js` 和 `data_export.js` 中对应更新。

### 10. 保留不动的逻辑

- `getVPLengthConstraint()` — 教育背景字数约束保留
- `persona_pool.js` 的结构化属性生成 — Layer 0 的输入源
- `persona_fallbacks.js` — API 失败时的兜底
- `buildBaseSystemPrompt()` — 保留不删，作为 seedMemory 失败时的 fallback
- VP 迭代中 leadWriter 固定执笔
- Card selection 的 validation retry 逻辑

## 验证

### Step 1: 单独测试 Layer 0 + 1

跑 `test_vp_prompt.js`（不启动服务器），5 个 persona 各打印：
1. Seed Memory JSON（7 个字段）
2. Reflection 全文
3. Layer 2 Plan
4. VP 初稿

确认：
- Seed Memory 的 7 个字段有明显 persona 差异
- `confidence_zone` 和 `blind_zone` 跟行业背景吻合
- `pet_phrases` 不同 persona 风格不同
- Reflection 读起来像聊天不像简历
- VP 初稿粗糙程度跟 persona 一致

### Step 2: 完整模拟 2x3

```bash
source .env && node server.js &
sleep 3
NUM_TEAMS=2 TEAM_SIZE=3 node scripts/persona_sim_test.js
```

贴出：
1. 2 队 6 人的 Seed Memory JSON + Reflection
2. vp_iterations.csv 完整分数轨迹
3. VP 初稿文本
4. changed 列

### Step 3: 满载 10x6

```bash
NUM_TEAMS=10 TEAM_SIZE=6 node scripts/persona_sim_test.js
```

贴出 teams_summary.csv + 统计。
