# CODEX_PERSONA_RANDOMIZE.md — Persona 随机化 + 教育背景关联

## 目标

把 `scripts/sim/persona_pool.js` 从固定分配改成每次运行随机生成 60 个全新学生。包括原型分配、姓名（DeepSeek 生成）、教育背景（概率分布 + 关联规则）、MBTI、性别、年龄。

---

## 1. 队伍随机组合

删掉写死的 `TEAM_COMPOSITIONS` 数组。新增 `randomizeTeams(numTeams, teamSize)` 函数：

- 从 7 个原型（A-G）随机抽取
- 同队最多 2 个相同原型
- 全局确保 7 个原型都至少出现 3 次（权重偏向出现少的原型）

---

## 2. 教育背景概率分布（按原型）

```javascript
const EDUCATION_DISTRIBUTION = {
  A: { // 草根老板
    '中专/高中':   0.25,
    '大专':        0.40,
    '本科（非985）': 0.35,
  },
  B: { // 职业经理人
    '本科（985）':   0.30,
    'MBA（国内）':   0.40,
    'MBA（海外）':   0.30,
  },
  C: { // 技术创业者
    '本科（985）':   0.10,
    '硕士（国内）':   0.25,
    '硕士（海归）':   0.30,
    '博士（海归）':   0.35,
  },
  D: { // 二代接班人
    '本科（国内）':   0.10,
    '本科（海外）':   0.50,
    '硕士（海外）':   0.40,
  },
  E: { // 体制转型者
    '大专':          0.20,
    '本科（985）':    0.50,
    '本科（非985）':  0.30,
  },
  F: { // 销售铁军
    '高中':          0.15,
    '大专':          0.40,
    '本科（非985）':  0.45,
  },
  G: { // 互联网PM
    '本科（985）':   0.35,
    '硕士（国内）':   0.35,
    '硕士（海归）':   0.30,
  },
};
```

---

## 3. 关联规则（抽完教育后做修正）

### 3.1 教育 × 年龄

```javascript
function adjustEducationByAge(persona, education, age) {
  // 50岁以上的草根老板/销售铁军：低学历概率翻倍
  if (['A', 'F'].includes(persona) && age >= 50) {
    // 如果抽到了本科，30% 概率降级为大专
    if (education.includes('本科')) {
      if (Math.random() < 0.3) return '大专';
    }
  }

  // 35岁以下：不太可能是大专/高中（这代人基本都上了大学）
  if (age < 35 && ['中专/高中', '高中', '大专'].includes(education)) {
    // 50% 概率升级为本科
    if (Math.random() < 0.5) return '本科（非985）';
  }

  return education;
}
```

### 3.2 教育 × 性别

```javascript
function adjustEducationByGender(persona, education, gender, age) {
  // 45岁以上的女性草根老板/体制转型者：低学历概率更高
  if (gender === 'female' && age >= 45 && ['A', 'E'].includes(persona)) {
    if (education.includes('本科') && Math.random() < 0.25) {
      return persona === 'A' ? '大专' : '本科（非985）';
    }
  }
  // 35岁以下的女性：分布跟男性一致，不做调整
  return education;
}
```

### 3.3 教育 → 海外经历

```javascript
function deriveOverseasExperience(persona, education, age) {
  // 海归学历 → 必须有海外经历
  if (education.includes('海归') || education.includes('海外')) {
    const destinations = {
      C: ['美国（MIT/Stanford/CMU）', '美国（UC系）', '日本（东大/东工大）'],
      D: ['英国（LSE/UCL）', '英国（曼大/利兹）', '澳洲（墨大/悉大）'],
      B: ['美国（Wharton/Kellogg）', '欧洲（INSEAD/LBS）', '香港（HKU/HKUST）'],
      G: ['美国（CS硕士）', '新加坡（NUS）', '香港（科大）'],
    };
    const pool = destinations[persona] || ['海外'];
    return {
      hasOverseas: true,
      destination: pool[Math.floor(Math.random() * pool.length)],
      duration: education.includes('博士') ? '4-6年' : '1-3年',
    };
  }

  // 大专/高中/中专 → 不可能有海外留学
  if (['中专/高中', '高中', '大专'].includes(education)) {
    return { hasOverseas: false, destination: null, duration: null };
  }

  // 国内本科/硕士 → 小概率有短期海外经历
  if (Math.random() < 0.15) {
    return {
      hasOverseas: true,
      destination: '短期交换/考察',
      duration: '3-6个月',
    };
  }

  return { hasOverseas: false, destination: null, duration: null };
}
```

### 3.4 教育 → 表达能力标签（注入 prompt，影响 VP 质量）

```javascript
function deriveExpressionModifier(education) {
  const modifiers = {
    '中专/高中':    '你的文字表达偏口语化，不太会用商业术语，写东西像说话一样直白，可能有语病或不通顺的地方。',
    '高中':         '你的文字表达偏口语化，不太会用商业术语，写东西像说话一样直白。',
    '大专':         '你的文字表达基本通顺但缺少结构感，不太会分层次写东西，倾向一段话说完所有想法。',
    '本科（非985）': '你的文字表达通顺，能写出基本的商业文案，但缺少框架感和专业术语。',
    '本科（985）':   '你的文字表达清晰有逻辑，会用基本的商业框架，但不会过度包装。',
    '本科（国内）':  '你的文字表达通顺，有基本逻辑，但不太会用商业术语。',
    '本科（海外）':  '你的文字表达流利，偶尔中英文混杂，喜欢引用国外的案例和概念。',
    '硕士（国内）':  '你的文字表达结构化，会用专业术语，逻辑层次清晰。',
    '硕士（海归）':  '你的文字表达很结构化，习惯中英文混杂，会用框架和模型来组织思路，引用海外案例。',
    '博士（海归）':  '你的文字表达非常精确和结构化，倾向用学术语言和第一性原理思考，可能过度严谨而缺少商业直觉。',
    'MBA（国内）':   '你非常擅长写商业文案，WHO/PAIN/HOW 这种框架对你来说很自然，表达结构化且有说服力。',
    'MBA（海外）':   '你是最会写商业文案的类型，框架感极强，中英文切换自如，但可能过度包装，内容空洞但格式完美。',
  };
  return modifiers[education] || '';
}
```

---

## 4. 姓名生成（DeepSeek）

删掉固定的 `PERSONA_NAMES` 姓名池。新增 `generateNames(members)` 函数：

- 一次 DeepSeek 调用批量生成一队 6 人的姓名（减少 API 调用）
- prompt 注入每人的原型、性别、年龄、教育背景

```text
请为以下 {n} 个人物各取一个中文姓名（姓+名，2-3个字）。

{for each member:}
人物 {i+1}：
- 背景：{persona.label}，{persona.background}
- 性别：{gender}
- 年龄：{age}岁
- 学历：{education}

取名规则：
- 符合这个年龄段、学历背景和中国社会阶层的起名习惯
- 50岁以上低学历男性：偏朴实（建国、德胜、福根、大力）
- 50岁以上低学历女性：偏传统（桂兰、秀英、翠花）
- 30-40岁海归/高学历：偏现代（天宇、若曦、博文、思涵）
- 体制背景：偏正式（建明、志远、国栋）
- 销售背景：偏响亮（彪、虎、龙、超）
- {n} 个名字不能重复
- 不要用明星或名人的名字
- 只输出 JSON 数组：["姓名1", "姓名2", ...]
```

Fallback：DeepSeek 失败时从保留的小型备用姓名池随机抽。

---

## 5. 完整的 sampleStudent 流程

```javascript
function sampleStudent(personaId, age, gender) {
  const persona = PERSONAS[personaId];

  // 1. 抽教育（按原型概率）
  let education = weightedSample(EDUCATION_DISTRIBUTION[personaId]);

  // 2. 关联修正
  education = adjustEducationByAge(personaId, education, age);
  education = adjustEducationByGender(personaId, education, gender, age);

  // 3. 派生海外经历
  const overseas = deriveOverseasExperience(personaId, education, age);

  // 4. 派生表达能力修饰
  const expressionModifier = deriveExpressionModifier(education);

  // 5. 抽 MBTI（保持现有逻辑）
  const mbti = weightedSample(persona.mbtiDistribution);

  return {
    ...persona,
    gender,
    age,
    mbti,
    education,           // 具体学历（如"大专"、"MBA（海外）"）
    overseas,            // { hasOverseas, destination, duration }
    expressionModifier,  // 注入 prompt 的表达能力描述
    // name 后续由 generateNames 批量生成
  };
}
```

---

## 6. Prompt 注入

在 `persona_student.js` 的 `buildBaseSystemPrompt` 中加入教育和表达能力：

```javascript
function buildBaseSystemPrompt(student) {
  let prompt = `你是一位正在读 EMBA 的中国商业人士...

## 你的个人信息
- 姓名：${student.name}
- 性别：${student.gender === 'male' ? '男' : '女'}
- 年龄：${student.age}岁
- 学历：${student.education}
${student.overseas.hasOverseas ? `- 海外经历：${student.overseas.destination}（${student.overseas.duration}）` : '- 海外经历：无'}
- 身份：${student.role}
- 行业经验：${student.background}

## 你的表达能力
${student.expressionModifier}

## 你的性格特征（MBTI: ${student.mbti}）
...`;

  return prompt;
}
```

---

## 7. VP 团队写作动力学（改 `team_runner.js`）

VP 是小组产出，不是个人写的。团队成员的教育背景组合决定了 VP 质量。

### 7.1 写作能力排序

给每个教育背景一个"写作能力权重"，用于决定谁主笔、谁发言：

```javascript
const WRITING_POWER = {
  'MBA（海外）':     9,
  'MBA（国内）':     8,
  '博士（海归）':    7,
  '硕士（海归）':    7,
  '硕士（国内）':    6,
  '本科（985）':     5,
  '本科（海外）':    5,
  '本科（国内）':    4,
  '本科（非985）':   4,
  '大专':           3,
  '高中':           2,
  '中专/高中':      2,
};
```

### 7.2 VP 初始提交者 = 队内写作能力最强的成员

```javascript
function pickVPLeadWriter(teamStudents) {
  // 按写作能力排序，最强的人提交初始 VP
  return teamStudents.slice().sort((a, b) =>
    (WRITING_POWER[b.education] || 3) - (WRITING_POWER[a.education] || 3)
  )[0];
}
```

这决定了 VP 的起点质量：MBA 主笔 → 框架清晰但可能空洞；大专主笔 → 朴实但缺结构。

### 7.3 VP Coach 对话的 3 轮发言者

现有逻辑是 `speakerOrder = [0, 2, 4]`（按 memberIndex 固定）。改为：

```javascript
function pickVPSpeakers(teamStudents, leadWriterIndex) {
  // 3 轮发言者：
  // 第 1 轮：写作能力最强的人（leadWriter）
  // 第 2 轮：写作能力最弱的人（制造质量落差）
  // 第 3 轮：中间水平的人（拉回来或拉偏）
  const sorted = teamStudents
    .map((s, i) => ({ ...s, idx: i }))
    .sort((a, b) => (WRITING_POWER[b.education] || 3) - (WRITING_POWER[a.education] || 3));

  return [
    sorted[0].idx,                          // 最强
    sorted[sorted.length - 1].idx,          // 最弱
    sorted[Math.floor(sorted.length / 2)].idx, // 中间
  ];
}
```

这样一个典型的讨论可能是：
- 第 1 轮：MBA 海归 → "建议用年龄×收入×家庭结构三个维度交叉细分"
- 第 2 轮：高中销售铁军 → "想那么复杂干嘛，关键是谁掏钱买"
- 第 3 轮：985 本科体制转型者 → "两位说的都有道理，要统筹考虑市场规模和付费意愿"

VP Coach 面对这三种风格的回复，给出的反馈也会不同，最终 VP 质量自然受团队组合影响。

### 7.4 预期效果

| 团队组合 | VP 预期质量 | 原因 |
|---------|-----------|------|
| MBA + 博士 + 985 本科 | C/G/E 都高 | 主笔和发言者都很强 |
| MBA + 大专 + 高中 | C/G 高但 E 偏低 | MBA 主笔框架好，但弱成员拉低了 HOW 的具体度 |
| 大专 + 大专 + 高中 | C/G/E 都偏低 | 没有人能写好结构化文案 |
| 博士 + 大专 + 销售 | C 低 G 中 E 高 | 博士写了很强的 HOW 但 WHO 太窄，销售的直觉补了些 PAIN |

---

## 8. 验证

改完后：

1. 连续跑两次 `NUM_TEAMS=2 TEAM_SIZE=3`，对比两次 `student_roster.json`，确认：
   - 两次的姓名、原型分配、MBTI、教育背景都不同
   - 教育 × 年龄关联合理（没有 52 岁草根老板拿 MBA 海外的情况）
   - 海外经历跟学历对应（大专不能有留学经历）

2. 跑满载 `NUM_TEAMS=10 TEAM_SIZE=6`，贴出：
   - 控制台 60 人概况（含教育背景列）
   - `teams_summary.csv` 完整内容
   - `students_summary.csv` 行数确认（60行）
   - VP 评分的 C/G/E 分布——检查是否比之前有更多区分度（不再全是 4.5）
   - 统计：盈利几队、亏损几队

3. 从日志中挑 3 条 VP：
   - 1 条低学历原型（草根老板/大专 或 销售铁军/高中）
   - 1 条高学历原型（技术创业者/博士海归 或 职业经理人/MBA海外）
   - 1 条中间学历
   - 对比 VP 文本的结构化程度和表达质量

4. VP 团队动力学验证：
   - 确认初始 VP 提交者是队内写作能力最强的成员（不是固定第一个人）
   - 确认 3 轮发言者分别是最强、最弱、中间
   - 对比两队：一队有 MBA 成员，一队没有 → VP 评分是否有差异

---

## 9. student_roster.json 新增字段

每个学生增加：
```json
{
  "education": "大专",
  "overseas": { "hasOverseas": false, "destination": null, "duration": null },
  "expressionModifier": "你的文字表达基本通顺但缺少结构感..."
}
```

`sim_students` 表和 `students_summary.csv` 也加 `education` 和 `has_overseas` 列。

---

## 10. 不要动的东西

- `server/` 下所有文件
- 已有的 persona 原型定义（7 个原型的核心字段保留）
- DeepSeek 选卡逻辑（`generateCardSelection`）
- 数据导出逻辑（`decision_tracker.js`, `data_export.js`）
- 改动范围：`persona_pool.js`、`persona_student.js` 的 prompt、`team_runner.js` 的 VP 发言者选择逻辑
