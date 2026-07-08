# Persona 系统完整实现清单

> 依据 `scripts/sim/persona_pool.js`(633 行)与 `scripts/sim/persona_student.js`(1117 行)全文整理,
> 决策接触点部分对照 `scripts/sim/team_runner.js`。只读盘点,未改任何源文件。
> 生成日期:2026-07-06

---

## 一、字段总表

### 1.1 原型静态字段(`PERSONAS`,persona_pool.js:5-181)

共 7 个原型(A-G),**每个字段在全部 7 个原型上都有定义(7/7)**,无缺省字段。

| 字段 | 类型 | 取值 / 实例 | 定义原型数 |
|---|---|---|---|
| `id` | 枚举 | `A` `B` `C` `D` `E` `F` `G` | 7/7 |
| `label` | 枚举 | 草根老板 / 职业经理人 / 技术创业者 / 二代接班人 / 体制转型者 / 销售铁军 / 互联网PM转型 | 7/7 |
| `desc` | 自由文本 | 「制造业/贸易起家的民营企业家」「大厂产品经理出身,转型创业或进传统行业」 | 7/7 |
| `age` | 数值区间(字符串) | `"45-55"` `"35-45"` `"30-38"` `"40-55"` `"35-50"` `"30-40"`(6 种区间) | 7/7 |
| `education` | 自由文本 | 「大专或本科」「硕士或博士」——**注意:此字段是死的**,`sampleStudent` 会用 `EDUCATION_DISTRIBUTION` 抽样结果覆盖它(persona_pool.js:511-527) | 7/7 |
| `role` | 自由文本 | 「创始人/董事长」「产品VP/创业者/传统企业数字化负责人」 | 7/7 |
| `background` | 自由文本 | 「从工厂车间或档口白手起家……企业年营收几千万到几个亿」「在大厂做了 5-8 年产品经理,带过千万 DAU 产品」 | 7/7 |
| `industry` | 自由文本 | 「制造业、外贸、建材、农产品加工」「互联网、SaaS、新零售、智能硬件」 | 7/7 |
| `decisionStyle` | 自由文本 | 「快速拍板、凭直觉和经验、不喜欢过度分析」「数据驱动、喜欢框架和模型」 | 7/7 |
| `riskPreference` | 自由文本 | 「高,看准了就干,错了再调」「低,先看看政策怎么说」 | 7/7 |
| `expressionStyle` | 自由文本 | 「直接、接地气、用大白话说复杂的事」「公文腔,统筹、落实、抓手、形成合力」 | 7/7 |
| `blindSpots` | 自由文本 | 「VP 写得接地气但缺结构」「容易把问题都归结为渠道和话术」 | 7/7 |
| `interviewStyle` | 自由文本 | 「像跟客户聊天,问题很直接」「会套用户旅程、JTBD、5 Whys 等方法论」 | 7/7 |
| `pricingBias` | 自由文本 | 「敢定高价,好东西就该卖贵」「保守定价,怕太贵老百姓接受不了」 | 7/7 |
| `vpQuirks` | 自由文本 | 「HOW 极其详细,但 WHO 和 PAIN 可能太窄」「可能写出打造中国版某产品这种对标式表述」 | 7/7 |
| `genderDistribution` | 数值(权重) | `{male, female}` 概率和为 1。male 权重:A 0.85 / B 0.6 / C 0.8 / D 0.55 / E 0.8 / F 0.7 / G 0.55 | 7/7 |
| `mbtiDistribution` | 枚举(权重) | 每原型 3-4 个 MBTI 类型带概率。全池出现过的类型:ESTP ENTJ ESTJ ISTJ INTJ INTP ENFP ENTP ESFP INFP ISFJ ENFJ INFJ(共 13 种) | 7/7 |
| `genderModifiers` | 结构体(自由文本) | 只定义 `female` 键,含 `expressionTweak` 和 `interviewTweak` 两条自由文本;**male 无任何 modifier(设计如此)** | 7/7 |

### 1.2 抽样派生的实例字段(`sampleStudent`,persona_pool.js:506-531)

每个学生实例 = `{...persona}` 展开 + 以下运行时字段:

| 字段 | 类型 | 生成方式 |
|---|---|---|
| `personaId` | 枚举 A-G | 直接赋值 |
| `gender` | 枚举 male/female | 按 `genderDistribution` 加权随机(`sampleGender`) |
| `age` | 整数 | 从原型 `age` 区间均匀抽样(`sampleAge`),**覆盖原型的字符串区间** |
| `education` | 枚举(13 值) | 见 1.3,**覆盖原型的 education** |
| `overseas` | 结构体 | `{hasOverseas, destination, duration}`,见 1.3 |
| `mbti` | 枚举(13 种) | 按 `mbtiDistribution` 加权随机 |
| `expressionModifier` | 自由文本 | `deriveExpressionModifier(education)` 查表,见 1.3 |
| `fullExpressionStyle` | 自由文本(拼接) | `buildFullExpressionStyle`,见 1.3 |
| `interviewStyleFull` | 自由文本(拼接) | 女性 = `interviewStyle` + "。" + `genderModifiers.female.interviewTweak`;男性 = `interviewStyle` 原文 |
| `name` | 自由文本 | LLM 起名(`generateNames`),失败/无 API key 时回退 `BACKUP_NAME_POOLS` 按原型×性别取名 |

### 1.3 派生逻辑逐个说明

**`EDUCATION_DISTRIBUTION`(persona_pool.js:225-262)** — 每原型一张学历概率表,加权抽样。全池共 13 种学历枚举值:中专/高中、高中、大专、本科(非985)、本科(985)、本科(国内)、本科(海外)、硕士(国内)、硕士(海归)、硕士(海外)、博士(海归)、MBA(国内)、MBA(海外)。抽样后经两道修正:
- `adjustEducationByAge`:A/F 原型 ≥50 岁抽到本科 → 30% 概率降为大专;<35 岁抽到中专/高中/大专 → 50% 概率升为本科(非985)。
- `adjustEducationByGender`:A/E 原型女性 ≥45 岁抽到本科 → 25% 概率降级(A→大专,E→本科非985)。

**`deriveOverseasExperience`(persona_pool.js:344-373)** — 学历含"海归/海外" → 必有海外经历,目的地按原型查表(C:MIT/Stanford/东大等;D:LSE/曼大/墨大等;B:Wharton/INSEAD/HKU 等;G:美国CS/NUS/科大),博士 4-6 年、其余 1-3 年;低学历(中专/高中/大专)→ 必无;其他学历 → 15% 概率"短期交换/考察 3-6 个月"。

**`deriveExpressionModifier`(persona_pool.js:375-392)** — 13 种学历 → 13 条"表达能力"文本的硬查表。低学历端:「写东西像说话一样直白,可能有语病」;高端:「MBA(海外)是最会写商业文案的类型……可能过度包装,内容空洞但格式完美」。

**`MBTI_BEHAVIOR_MODIFIERS`(persona_pool.js:183-192)** — 8 个字母(E/I/S/N/T/F/J/P)各对应一句行为描述。`getMBTIDescription(mbti)` 把 4 字母 MBTI 拆开,逐字母查表,4 句话用换行拼接。例:INTJ → I 句 + N 句 + T 句 + J 句。

**`genderModifiers`** — 仅女性生效的两条 tweak:
- `expressionTweak` 在 `buildFullExpressionStyle` 里追加到表达风格后;
- `interviewTweak` 在 `sampleStudent` 里拼成 `interviewStyleFull`。
男性实例拿到的就是原型原文,无修饰。

**`buildFullExpressionStyle(persona, gender, mbti)`(persona_pool.js:485-492)** — 最终表达风格文本的组装公式:

```
expressionStyle
  + (女性时) "。" + genderModifiers.female.expressionTweak
  + "\n\n你的思维特征(MBTI: {mbti}):\n" + getMBTIDescription(mbti)   ← 4 句 MBTI 行为描述
```

**`generateNames`(persona_pool.js:422-475)** — 用 DeepSeek 按「label + background + 性别 + 年龄 + 学历」起中文名,prompt 里硬编码起名规则(50+ 低学历男偏朴实、海归偏现代、体制偏正式、销售偏响亮)。失败或无 API key → `BACKUP_NAME_POOLS`(每原型分性别的备用名单)去重取名。

**其余 pool 级机制**(不属于单个 persona 字段,但影响 persona 输出):`randomizeTeams`(每原型全局至少 3 人、每队同原型 ≤2 人)、`TEAM_ANCHOR_GRIDS` / `PERSONA_GRID_CHOICES` / `getStudentGridChoice`(见第三部分格子选择)。

---

## 二、字段 → Prompt 流向图

### 2.0 先说关键架构事实

`PersonaStudent.buildLayeredSystemPrompt()`(persona_student.js:349-359)的逻辑是:

```
system prompt = seedMemoryText  ‖ 若为空则 buildBaseSystemPrompt(student)   ← 二选一,不叠加!
              + "\n\n## 课堂行为画像\n" + classroomProfileText              ← 有则追加
              + getVPLengthConstraint(education)                            ← 有则追加
```

而 `team_runner.js:660-673`(`r1_init_persona_layers`)在所有任务调用之前就为每个 actor 跑完 `generateSeedMemory` + `generateClassroomProfile`。**因此正常运行路径下,L2 base system prompt 从不出场**——persona 原始字段是通过 L0 底稿 prompt「间接蒸馏」进运行时 system prompt 的,而不是直接注入。L2 只在 init 步骤被跳过/未执行时才作为兜底出现。

### 2.1 各层注入的字段

**L0 底稿 prompt(`buildSeedMemoryPrompt`,persona_student.js:142-178)** — 输入字段:
`name`、`gender`、`age`、`education`、`overseas`、`industry`、`role`、`background`、`mbti`(仅 4 字母代码)、`decisionStyle`、`riskPreference`、`fullExpressionStyle`、`blindSpots`。
输出 7 字段 JSON(backstory / decision_habit / discussion_style / confidence_zone / blind_zone / under_pressure / pet_phrases),经 `seedMemoryToText` 转成文本,成为运行时 system prompt 的主体。无 API key 或失败时的兜底直接从 `background`、`decisionStyle`、`fullExpressionStyle`、`industry`、`blindSpots` 拼装。

**L1 画像 prompt(`buildClassroomProfilePrompt`,persona_student.js:180-204)** — 输入**只有 seedMemoryText**(即 L0 输出),不直接接触任何 persona 原始字段。system 角色为「中欧教授」。输出 8 字段 JSON(abstraction_ability / writing_precision / coach_receptiveness / effort_style / team_role / why_here / knowledge_ceiling / response_to_AI_coach),JSON 全文追加到运行时 system prompt 的「## 课堂行为画像」段。

**L2 base system prompt(`buildBaseSystemPrompt`,persona_student.js:60-92)** — 输入字段:
`name`、`label`、`gender`、`age`、`education`、`overseas`、`role`、`background`、`industry`、**`expressionModifier`**、`mbti`(经 `getMBTIDescription` 展开)、`decisionStyle`、`riskPreference`、`fullExpressionStyle`、`blindSpots`。
如 2.0 所述,仅为兜底路径。

**任务层 user prompt(逐字段)**:
- `vpQuirks` → 仅 `generatePhase1Choice`(「注意你的表达特点:…」)
- `education` → `getVPLengthConstraint`:既拼进 layered system prompt,又在 `generatePhase1Choice` 的 user prompt 里**再注入一次**(双重注入)
- `interviewStyleFull`(回退 `interviewStyle`)→ 仅 `generateInterviewReply`
- `pricingBias` → 仅 `generatePriceChoice`

### 2.2 流向汇总表

| 字段 | L0 底稿 | L1 画像 | L2 base(兜底) | 任务层 | 备注 |
|---|:-:|:-:|:-:|:-:|---|
| name | ✅ | 间接 | ✅ | — | 另进起名 prompt |
| label | — | — | ✅ | — | 主要消费点是起名 prompt 和日志 |
| gender / age / education / overseas / role / background / industry | ✅ | 间接 | ✅ | education 另进长度约束 | 多层注入 |
| mbti | ✅(代码) | 间接 | ✅(展开为 4 句) | — | L0 只给 4 字母,L2 才展开 |
| decisionStyle / riskPreference / blindSpots | ✅ | 间接 | ✅ | — | 多层注入 |
| fullExpressionStyle(含 expressionStyle、female expressionTweak、MBTI 4 句) | ✅ | 间接 | ✅ | — | MBTI 描述经此在 L0 也实际展开了 |
| expressionModifier | ❌ | ❌ | ✅ | ❌ | **半死:正常路径从不进 LLM** |
| vpQuirks | ❌ | ❌ | ❌ | ✅ Phase1 | 只影响 Phase1,不影响 VPDraft |
| interviewStyle(Full) | ❌ | ❌ | ❌ | ✅ 访谈 | |
| pricingBias | ❌ | ❌ | ❌ | ✅ 定价 | |
| desc | ❌ | ❌ | ❌ | ❌ | **死字段** |
| education(原型级,如"大专或本科") | — | — | — | — | **死字段**(被抽样值覆盖) |
| genderDistribution / mbtiDistribution | — | — | — | — | 仅抽样用,不进 prompt(正常) |
| seedMemory 7 字段 | 产物 | ✅ 输入 | — | 经 system prompt 进所有任务 | |
| classroomProfile 8 字段 | — | 产物 | — | JSON 全文进所有任务 system prompt | |

### 2.3 死字段 / 半死字段结论

1. **`desc`(全死)**:7 个原型都定义了,但 persona_student.js 任何 prompt 都不用它;仓库里只有测试脚本 `scripts/test_persona_all_grids.js:63` 拿它做展示。
2. **原型级 `education`(全死)**:`sampleStudent` 用 `EDUCATION_DISTRIBUTION` 抽样结果覆盖,原文「大专或本科」等 7 条文本永远不会被读到。
3. **`expressionModifier`(半死)**:只出现在 L2 base prompt 的「## 你的表达能力」段;由于运行时 system prompt 被 L0 底稿替换,这 13 条精心写的学历表达文本在正常路径下从不进 LLM。学历对文风的实际影响只剩 `getVPLengthConstraint`(且只覆盖中专/高中/大专/本科 4 档,硕士以上无约束)。
4. **`label`(接近半死)**:进 L2(兜底)和起名 prompt,正常任务 prompt 里 LLM 看不到自己的原型名(可视为有意隐藏)。
5. **`genderModifiers` 的 male 分支**:结构上不存在,男性无任何 tweak——是设计而非 bug,但意味着 gender 对行为的影响仅存在于女性实例。

---

## 三、决策接触点清单

通用机制(适用于全部 7 个环节):system prompt 一律来自 `buildLayeredSystemPrompt()`(L0 底稿 + L1 画像 + 学历长度约束);无 `DEEPSEEK_API_KEY` 或 LLM 调用失败时走各自 fallback(`STRICT_DEEPSEEK=1` 时改为抛错);所有调用经 220ms 限速并写 LLM 日志。

### 3.1 `generatePhase1Choice` — 选格/架构 + 初版 WHO/PAIN/HOW

- **格子和架构不是 persona 决定的,是算法硬编码**:`gridChoice` 作为入参传入。来源链(team_runner.js:139-143 → persona_pool.js:607-611):有 teamStrategy 选项时用之;否则 `getStudentGridChoice`——**每队前 4 名成员**固定拿 `TEAM_ANCHOR_GRIDS[teamIndex % 10]`(队伍锚定格),**第 5、6 名**按 `PERSONA_GRID_CHOICES[personaId]` 查表(如 A→ToB_Differentiation_Adult/Function,E→ToB_Differentiation_Elder/Experience)。LLM 对格子零话语权。
- persona 进 prompt 的字段:layered system prompt + user prompt 里的 `vpQuirks`、`education` 长度约束(第二次注入)。
- 输出形式:自由生成的 JSON `{who, pain, how}`(temperature 0.9,max 320 tokens),grid_id/architecture 由代码原样回填。
- 兜底:`getFallbackVP(personaId)`(persona_fallbacks.js)按原型给固定 who/pain/how;单字段缺失也逐字段回退。
- 后续:全队 6 份提交做**多数投票**(`majorityVote`)定团队格子——个人输出只占一票。

### 3.2 `generateVPDraft` — VP 初稿

- **谁来写是算法定的**:`pickVPLeadWriter` 取全队 `WRITING_POWER[education]` 最高者(MBA 海外 9 分 → 中专/高中 2 分,team_runner.js:45-96),persona 只通过学历间接影响人选。
- persona 进 prompt 的字段:仅 layered system prompt(user prompt 只有格子描述和任务指令,**不含 vpQuirks**)。
- 输出形式:自由文本 1-4 句(temperature 0.9,max 200)。
- 兜底:`getFallbackVP(personaId)` 三段拼接成一句话。

### 3.3 `generateVPRevision` — VP 修订(×3 轮)

- 只有 lead writer 执行。persona 字段:仅 layered system prompt;user prompt 是教练反馈 + 队友发言 + 最近 6 条对话 + 当前 VP。
- 输出形式:自由文本(temperature 0.8,max 280)。
- 兜底:**原样返回当前 VP**(即修订失败 = 不修订);`normalizeVpDraftText` 再兜一层用上一版。

### 3.4 `generateVPChatReply` — 与 AI 教练对话

- **发言人顺序是算法定的**:`pickVPSpeakers` 按 writingPower 取最强、最弱、中位三人;**第 1 轮发言是硬编码模板**(「我们团队目前主张的定位是 {grid}/{arch},请指出最该补强的一点。」team_runner.js:757-759),只有第 2、3 轮走 LLM。
- persona 字段:仅 layered system prompt;user prompt 是教练最新发言 + 最近 6 条历史。
- 输出形式:自由文本 1-3 句(temperature 0.9,max 180)。
- 兜底:`getFallbackChatReply(personaId, index)` 按原型轮换的固定台词。

### 3.5 `generateInterviewReply` — 用户访谈提问(每人最多 5 轮)

- persona 字段:layered system prompt + user prompt 里的 **`interviewStyleFull`**(唯一显式用到访谈风格和女性 interviewTweak 的地方)+ 分配维度 `assignedDims`(经 `DIM_LABELS` 转中文)+ 硬编码的 6 维度探索指引(`INTERVIEW_DIMENSION_GUIDANCE`)。
- 输出形式:自由文本追问 1-2 句(temperature 0.9,max 180)。
- 兜底:`getFallbackInterviewReply(personaId, turn)` 按原型×轮次的固定问题。
- 维度分配本身由外部 `assignment` 决定,非 persona。

### 3.6 `generatePriceChoice` — 定价

- **谁定价是硬编码的**:team_runner.js:1199-1206 固定用 `memberIndex 0`(1 号成员)当 pricingStudent——不是按 persona 挑的,该成员是谁取决于组队随机结果。
- persona 字段:layered system prompt + user prompt 里的 **`pricingBias`**;还给出成本、渠道抽成、价格区间。
- 输出形式:**受约束的数值**——LLM 只输出一个数字,代码用正则 `\d{4,6}` 抽取,再 clamp 到 `[min, max]`(min = max(5000, base×0.5),max = base×1.2,由 team_runner 传入)。temperature 0.4,max 60。
- 兜底:**纯算法**——按原型查系数表 `{A:1.02, B:0.95, C:0.9, D:1.0, E:0.82, F:1.04, G:0.88}` × basePrice 后 clamp(persona_student.js:918-927)。即使 LLM 全挂,不同原型的定价差异仍会体现。

### 3.7 `generateCardSelection` — 研发能力卡选择

- persona 字段:仅 layered system prompt(tier 选择「反映你的风险偏好」只是 prompt 里的一句指令,风险偏好本身在 system prompt 里)。user prompt 含访谈摘要、负责维度、预算上限(= Pmax×0.2,算法定)、全量卡目录 JSON、上次违规信息和上次选卡(重试时)。
- 输出形式:**从菜单里挑**——LLM 输出 `{selections:[{cap_id, tier, reason}]}`,`normalizeCardSelections` 严格过滤:cap_id 必须在卡目录里、tier 必须是 low/mid/high 且该卡有此档、去重;全部无效则抛错走兜底。temperature 0.7,max 1500。
- **多级算法兜底**(team_runner.js:1103-1197):① 失败/空结果 → `planSelections` 纯算法方案(按 6 个维度组轮转分配 `SAFE_GROUP_CARDS`,一律 mid 档);② 团队合并后校验不过 → 带 violations 重新让 LLM 选,最多 2 次;③ 仍不过 → `forceFallback` 强制全队用算法方案。**最终落库的组合可能完全没有 persona 参与**。

### 3.8 汇总

| 环节 | persona 显式字段 | 输出形式 | 硬编码/算法成分 |
|---|---|---|---|
| Phase1 选格 | vpQuirks + education 约束 | 自由 JSON(who/pain/how) | **格子/架构 100% 算法**(锚定格+查表);团队格子靠多数投票 |
| VP 初稿 | (仅 system prompt) | 自由文本 | 执笔人按学历分算法选 |
| VP 修订 | (仅 system prompt) | 自由文本 | 失败=不修订 |
| VP 对话 | (仅 system prompt) | 自由文本 | 发言人算法选;第 1 轮台词硬编码 |
| 访谈提问 | interviewStyleFull | 自由文本 | 维度指引硬编码;5 轮上限 |
| 定价 | pricingBias | 数字(正则抽取+clamp) | 定价人固定 1 号成员;兜底 = 原型系数表 |
| 选卡 | (仅 system prompt) | 菜单选择(严格校验) | 兜底 = planSelections 算法;最多 2 次重试后强制算法 |

---

## 四、原型清单

| ID | Label | 核心画像 | decisionStyle | riskPreference | blindSpots |
|---|---|---|---|---|---|
| A | 草根老板 | 制造业/外贸白手起家的民营企业家,45-55 岁,靠时代红利做到几千万到几亿营收 | 快速拍板、凭直觉和经验、不喜欢过度分析 | 高,看准了就干,错了再调 | VP 写得接地气但缺结构,容易从自身经验出发而非用户视角 |
| B | 职业经理人 | 外企/大型民企一路升上来的高管,管过几百人团队,体系化思考 | 数据驱动、喜欢框架和模型、决策前要看数据支撑 | 中等,风险可控的情况下可以激进 | VP 框架漂亮但可能脱离一线用户真实场景,过度依赖二手数据 |
| C | 技术创业者 | 实验室/大厂技术岗出来的理工科创业者,技术很强但商业化在摸索 | 追求技术最优解、第一性原理思考、有时过度工程化 | 对技术风险不怕,对市场风险敏感 | 关注产品胜过商业模式,容易忽略成本和用户优先级 |
| D | 二代接班人 | 家族企业第二代,有国际视野想推转型但受制于老一代 | 有国际视野但对一线运营理解浅,想法大但落地能力弱 | 想激进但会被家族保守文化拉住 | 容易写成愿景式表述,缺少对中国本土用户的深入理解 |
| E | 体制转型者 | 央企/国企/机关十几年出来做基建环保医疗教育,人脉是核心资产 | 谨慎、讲流程和合规、重视政策风向、决策慢但执行力强 | 低,先看看政策怎么说 | VP 容易写成政策文件风格,宏观正确但不够具体 |
| F | 销售铁军 | 保险/医药/快消/教培一线销售干到高管的实战派,极度客户导向 | 客户导向、关注转化率和复购、用销售漏斗思维看一切 | 中高,敢投就有回报,关键是投对渠道 | 产品设计思维弱,容易把问题都归结为渠道和话术 |
| G | 互联网PM转型 | 大厂 5-8 年产品经理,带过千万 DAU,转型创业或进传统行业做数字化 | 方法论驱动、A/B 测试思维、喜欢用数据验证假设 | 中等,小步快跑、快速迭代 | 容易脱离非互联网用户的真实语境,把所有用户都想成年轻互联网用户 |
