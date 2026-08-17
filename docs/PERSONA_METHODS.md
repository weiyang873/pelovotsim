# PERSONA_METHODS — 四条冻结线的 persona 生成与注入方法（2026-08-16）

配套 `docs/FREEZE_LEDGER.md`。本文只写"人是怎么造出来的、每条线往 prompt 里塞了什么"，数字不重复。所有引文都是从代码里 dump 出来的实际拼装结果（`server/synthetic/teamSim/orchestrator.js` @ d8bfd27e；shim：`formatProfile / formatR1UiProfile / formatTaskBlindNarrativePersona`），不是转述。

**Framing（roleplay 池）**：persona = 类别事实（人口学 / 职业 / 家庭 / 消费，按总体先验独立抽样并钉死）⊕ 连续行为特质（8 维 IID，与类别正交）→ 由不知任务的写手粘合成一篇小传；注入只给小传。类别层保"像谁"的散度（trait-only 生成会塌到众数，见 §2.2 探针），特质层保"怎么做"的散度（只有类别的原型池，同原型的人业务字段与定价倾向完全相同，见 §1.2）。两层正交是设计选择：效应可分离，代价是不模拟真实总体里两者的相关。

两套池、两种方法：

| | Benchmark（team / individual，simple & layered） | Roleplay（solo R1/R2、team R1/R2） |
|---|---|---|
| 池 | `data/persona_pool_random42_free_0731_interface_20260814/persona_pool_v2.json` | `data/task_blind_persona_pipeline_v1/r1_pool42_20260812/persona_pool_task_blind_narrative_v1.json`（sha256 3e79d106…） |
| 生成脚本 | `scripts/sim/generate_persona_pool_random42.js`（git 437a2435） | `scripts/analysis/generate_task_blind_persona_pool.js` |
| 身份来源 | 7 个手写原型（A–G）+ 随机 surface | 20 字段事实卡 → LLM 写小传；无原型 |
| 行为特质 | MBTI 四字母 → 固定"思维特征"段落（layered 才注入） | 8 维连续指纹（0.05–0.95 均匀 IID，与人口学、货币事实相互独立）→ 5 档自然语言"行为表现"→ 只进小传 |
| 注入形式 | 字段块（姓名/原型/性别/年龄/学历/海外/MBTI/表达风格 [+ 原型业务字段]） | 小传 + 两句 |
| 锦囊 | 可见 | 隐藏（`TEAM_SIM_HIDE_JINANG=1`） |
| 记录数 | 42（每条 seed 同时用于 simple 与 layered，配对） | 42（solo 与 team 共用同一池；team 42 队 = 从 42 人五人一组抽样；solo 42 units 逐 unit 有放回抽 1 人 → 只覆盖 28 个不同的人，见 §3.4） |

---

## 1. Benchmark 池（random42_free_0731_interface）

### 1.1 生成
- PRNG：fnv1a-seeded mulberry32，seed `20260814-random42-free-persona-simple-layered-interface-v1`。
- 原型：7 个（草根老板 A / 职业经理人 B / 技术创业者 C / 二代接班人 D / 体制转型者 E / 销售铁军 F / 互联网PM转型 G，定义在 `scripts/sim/persona_pool.js::PERSONAS`），iid 均匀有放回抽 42 个（实际 A7 B7 G6 D6 E6 C5 F5）。
- surface：`persona_pool.js::sampleStudent` 在同一 PRNG 下抽 姓名 / 性别 / 年龄 / 学历 / 海外 / MBTI / expression_style。
- 锦囊：每人 seed 抽一张市场 + 一张技术；Q/S 共用。
- manifest：`pool_manifest.json`（字段、方法、sha、git hash）。

### 1.2 注入（`formatProfile(member, isLeader, arm)`）
**simple 臂**（surface only）：
```
姓名代号：R39
姓名：李同方
原型：体制转型者（国企/政府背景出来的管理者）
性别：男
年龄：48岁
学历：本科（非985）
海外经历：无
MBTI：ISFJ
表达风格：公文腔，统筹、落实、抓手、形成合力，严谨但缺少用户语言
你是普通队员。
你正在使用课堂界面。只根据界面上看得到的信息、共享讨论和你自己的直觉发言。
不要把自己当研究助理，不要输出隐藏模型分析；发言像真实小组讨论，简短、自然、可以不完美。
```
注意：simple 臂也带"原型：…"一行（surface 里带 archetype_label），但不带原型的业务字段。

**layered 臂**（surface + MBTI 思维特征 + 原型业务字段；run_meta 自述 "layered (deprecated partial): … no deterministic L0/L1 classroom profile and no cognitive map"）：
```
（同上 9 行）
你的思维特征（MBTI: ISFJ）：
你在小组讨论中倾向先听别人说，等想清楚再发言，但观点往往更深入。
你关注具体的事实和细节，喜欢用实际案例说话，不太信空洞的理论。
你做决策时会考虑人的感受，写 VP 时自然关注用户情感痛点，访谈时善于共情。
你喜欢尽快达成结论、做好计划，讨论时倾向推动收敛，不喜欢开放式发散太久。
角色：从国企中层出来创业，或在民企做高管
行业经验：基建、能源、环保、医疗、教育
背景：在央企、国企或政府机关干了十几年，出来后做基建、环保、医疗、教育相关业务，人脉是核心资产
决策风格：谨慎、讲流程和合规、重视政策风向、决策慢但执行力强
表达风格：公文腔，统筹、落实、抓手、形成合力，严谨但缺少用户语言
盲区：VP 容易写成政策文件风格，宏观正确但不够具体
定价倾向：保守定价，怕太贵老百姓接受不了
发言倾向：low
你是普通队员。
你正在使用课堂界面。只根据界面上看得到的信息、共享讨论和你自己的经验发言；不要输出隐藏模型分析。
```
- 原型业务字段（角色/行业/背景/决策风格/盲区/**定价倾向**）来自 `PERSONAS[archetype]`，7 个原型各一套固定文本；同原型的 6–7 个人这一块完全相同。
- `发言倾向` 由 MBTI 首字母决定（E→high，I→low，其它按下标轮转）；只影响发言调度。
- MBTI 思维特征段落是 `expression_style` 里 `\n\n你的思维特征` 之后的固定文本，按 4 个字母各取一句。
- 与 3 月的 `CODEX_PERSONA_LAYERED_ARCHITECTURE_V2.md`（L0 seed memory / L1 classroom profile）**无关**：benchmark layered 臂不生成也不注入 L0/L1。

### 1.3 运行器差异（individual）
- 08-14 冻结证据 individual（`random42_simple_layered_individual_v1`，runner_type `single_ui_parity`）走的是 `full_game_all_personas` 一条独立管线（interface prompt、S 条件），与 team 的 orchestrator 不是一台机器。
- 08-16 补跑 individual 改用 orchestrator `--team-size 1`（batches `benchmark_indiv_orch_rep{1-5}_20260816`），persona 注入与 team 完全一致；这是 FREEZE_LEDGER 里 individual 行的最终口径（rep1：simple 亏 10% / layered 17%，与 08-14 full_game 的 62%/50% 差异来自管线，不是 persona）。

---

## 2. Task-blind 池（r1_pool42_20260812）

### 2.1 信息防火墙（`pool_manifest.information_firewall`）
| 环节 | 看得到 | 看不到 |
|---|---|---|
| 任务分析器（LLM，一次） | R1 个人选择页的任务文本、通用字段目录（20 项）、8 维特质**名称** | — |
| 事实卡采样器（确定性 PRNG） | 分析器选出并按依赖扩展的字段 id、人口先验、seed | 任务 |
| 小传写手（LLM，每人一次） | 冻结事实值、8 条自然语言行为表现、姓名 | 任务文本 / 任务 id / 选项 / 字段入选理由 / **特质数字与标签** |

禁用词（小传里不得出现）：ToB、ToC、COST、DIFF、成本领先、差异化、体验型、混合型、功能型、AI宠物、机器人、目标市场 …（全表见 manifest `forbidden_biography_terms`）。

### 2.2 事实卡（`buildFactCard`）
- 字段目录 `FIELD_CATALOG` 20 项，带依赖（如 `price_reference_history` requires `personal_consumption_habits`）。分析器为本任务选出 14 项：年龄阶段 / 教育 / 行业职能岗位 / 客户与使用者接触 / 产品技术熟悉度 / 家庭结构 / 代际接触 / 照护 / 经济余量 / 消费习惯 / 价格参照 / 质量-便利取舍 / 他人影响 / 表达与参与习惯（`background_schema.json`，sha 14113cb5…）。
- 每项由 seed PRNG 按人口先验抽具体值（`householdFacts / careerFacts / priceHistory / consumptionHabit …`），surface 同步产出 姓名 / 性别 / 年龄 / 学历 / 地区 / 海外（本池 42 人海外全为无）。
- **IID 设定（设计，不是 bug）**：8 维指纹（PRNG 流 `seed:traits:i`）、人口学（年龄/性别/学历/地区/行业/职能/家庭，PRNG 流 `seed:facts:i`）、货币类事实（消费习惯 / 价格参照 / 质量取舍，`pick([...], rng)`）三块彼此独立同分布抽样，互不条件化；只在小传写作阶段由写手叙事粘合。后果：人口学与特质在设计上正交（42 队上人口学 Fau 与认知 Fau 相关 r=0.03），效应可分离；promotion / risk 不通过货币事实表达，个体定价立场靠程序机制（私下承诺 + 从小传推定价观）拉开。
- **为什么要事实卡（对照探针，2026-08-16，`scripts/analysis/probe_trait_only_biography.js` → `runs_v4flash_0731/probes/trait_only_bio_ceibs_20260816/`）**：同一批 42 个指纹、同一套 8 句行为表现、同一写手 prompt，只把事实卡换成唯一线索"在中欧读 EMBA"，让模型自编人口学。结果塌缩到先验众数：男 36/42、年龄 38–46（SD 2.2 vs 池 7.5）、42/42 硕士、上海 28/42、运营/财务/制造 33/42、5 个重名，"父亲/工厂"母题 67%/57%；小传两两 3-gram Jaccard 0.028 vs 池 0.024（不更散）；特质只在"是否创始人"上留下相关（risk +0.47、promotion −0.49），性别/年龄/学历/职能与特质无关。即 trait-only 生成得不到人口学散度，IID 事实卡是保散度的必要装置。 把这 42 篇 trait-only 小传当池子跑一遍冻结 solo 线（R1 screenplay → R2 v2Q，`solo_r1_traitonly_rep1_20260816` / `solo_r2_v2Q_traitonly_rep1_20260816`，n=32）：R2 价格 SD 838 vs 冻结池 909、卡 13.5 vs 15.1、亏 50% vs 56%、COST 31% vs 32%——定价层差别不大；差别在 R1 市场选择：ToB 66% vs 49%、老人市场 28% vs 49%（trait-only 的人都是制造业运营高管、没有照护事实）。按战略拆：COST 份额 31% vs 32%、亏 10% vs 23%；DIFF 份额 69% vs 68%、亏 68% vs 71%——战略结构不变；但 DIFF 组内价格 SD 395 vs 679（trait-only 的 DIFF 挤在 ToB 成人一格，报价扎堆 4700），总 SD 相近是 COST 更散 + DIFF 更聚的抵消。**核心结论：类别塌缩、行为不塌。** 把类别层全部抽掉、42 个人几乎长成同一张脸（36 男 / 全硕士 / 28 个上海 / 5 个重名），行为散度仍在：COST 29% vs 28%、亏损 50% vs 56%、总价格 SD 838 vs 909、DIFF/COST 各自亏损结构一致。行为散度由 8 维 IID 特质（经 5 档句子进小传、再被角色扮演读出）+ 程序机制承担，不是人口学异质性堆出来的；反面是 benchmark 原型池——有类别没有连续特质，42 人=7 个点，SD 400–500。类别层增加的是身份散度（人口学变量可用、可追溯）和市场想象（ToC 老人 49%→28%，DIFF 组内 SD 679→395）。限制：n=32 单轮，无按人配对。

### 2.3 行为指纹 → 行为表现 → 小传
- 8 维：maximizing_satisficing、need_for_cognition、actively_open_minded_thinking、risk_propensity_business、ambiguity_tolerance、regulatory_focus_promotion、consideration_future_consequences、action_orientation；每维 `0.05 + U(0,1)·0.9`，iid。
- `traitDirectives`：每维按 5 档（<0.2/0.4/0.6/0.8/≥0.8）取一句固定模板（例：AOT 档 4 = "习惯邀请最强反方；新证据充分时，即使难堪也会明显更新判断。"）。
- 小传 prompt（`biographyMessages`）：system = "严肃现实主义人物小传作者…事实卡和八条行为表现是硬约束但不要逐字段复述…同一个人可以矛盾。不要替人物总结稳定的商业立场…不得出现任何 trait 名称、分数或高低标签"；user = 姓名 + 冻结事实 + 八条行为表现 + "写 900–1300 字第三人称小传，含连贯职业主线、当前生活结构、两到四件留下行为痕迹的往事、说话和课堂参与状态；不出现任何未来任务/产品/市场/推荐答案"。
- 池记录字段：`surface / behavioral_fingerprint / frozen_facts / biography / generation_provenance(sha)`；`biography_calls.jsonl` 存每次调用。

### 2.4 注入（`formatTaskBlindNarrativePersona`）— 四条 roleplay 线同一段
```
姓名代号：TBN01
【人物小传】
徐若琳在工地上长大。父亲是县建筑队的木工，……（900–1300 字原文）
你是普通队员。                       ← 组长："你是组长，负责推进讨论并代表全队提交。"
你现在就是小传中的这个人。像本人临场一样看界面、说话和行动，不要复述或分析小传，不要把自己变成顾问。
人物小传可能没有覆盖眼前问题；遇到没有经历支撑的地方，就按这个人当下会有的直觉、犹豫或误解处理。
```
- 没有字段块、没有指纹数字、没有派生标签 / 教条 / 账本 / 行为指令（设计决定 1，见 FREEZE_LEDGER）。
- team R1 actor_isolated 在此基础上把"姓名代号"换成真名、把组长/队员两句换成"你和其他四个人是平等的讨论参与者；只是网页当前把鼠标和键盘操作权交给了你 / 没有交给你"（`formatR1IsolatedActorPersona`）。

### 2.5 指纹在冻结线里还去了哪里（小传之外）
| 消费端 | 用途 | 进 prompt 吗 |
|---|---|---|
| `taskBlindClassroomBehaviorProfile`（1:1：action→话多/主导，promotion→表现动机，NFC→投入，CFC→相关性，1−AOT→附和，maximizing→算账冲动，AOT→质疑） | 房间 beat 调度（谁在什么时候被点到、发言长度上限）— 只改"谁说、说多长"，不改台词内容 | 否（team R2 B / solo v2Q 的 speak/screenplay 不打印标签） |
| `formatClassroomBehavior` 标签（话少/正常/话多…） | R1 **screenplay** 演员表 `课堂状态：…` + `当前主观状态：注意点/信心/困惑/疲劳` | **是，仅 solo R1**（arm `team_room_r1_screenplay_v1`，8/12 冻结代码）；team R1 actor_isolated 与所有 R2 线不注入 |
| `d4_reading_habit`（LLM 从小传推："看一排能力卡时更在意功能全不全还是花了多少钱、逐项算成本还是扫一眼、对技术类功能内行/半懂/外行"，≤160 字） | D4 个人选卡的读法一句 | 是（solo v2Q `TEAM_SIM_D4_READING=1`；team R2 B 的 story D4 lens） |
| `d5_pricing_view`（LLM 从小传推："往低了定先卖出去 / 往高了定保利润 / 跟着参照走"，≤80 字）+ `frozen_facts.price_reference_history` 原句 + 私下三段（动作/档位/价格/理由） | D5 每次 speak / screenplay 的"定价上你一贯的看法（从你的经历看）…你自己的价格参照（真实经历）…你私下已经在纸上填好的…说不说、改不改，看你自己" | 是（team R2 B `TEAM_SIM_D5_IDEOLOGY=1 D5_PRIVATE_STAGE=1`；`=dims` 的阈值规则模式只用于实验，冻结线不用） |
| R1 记忆（`r1_actor_carryover` 自己的私下状态 + `r1_public_memory` R1 公开 transcript 尾 1600 字 + `r1_own_proposal`） | R2 每次调用都带 | 是（team R2 B；solo v2Q 带自己的 R1 提案） |

规则：所有派生层都是"模型读小传自己推"，不允许阈值规则兜底（缺小传直接 throw；`d5IdeologyLine` 注释："falls back to nothing, never to a rule"）。

---

## 3. 冻结线 × 注入点对照

| 线 | arm | 池 | persona 主体 | 额外注入 | 锦囊 |
|---|---|---|---|---|---|
| Benchmark team simple / layered | `simple` / `layered`，team_size 5 | random42 free interface | §1.2 字段块 | 无 | 可见 |
| Benchmark individual（08-16 口径） | 同上，team_size 1 | 同上 | 同上 | 无 | 可见 |
| Solo R1 | `team_room_r1_screenplay_v1`，team_size 1 | task-blind | 小传 + 两句 | 演员表带 `课堂状态` 标签 + 主观状态四数（8/12 代码） | 隐藏 |
| Solo R2 v2Q | `team_room_roleplay_ui`（模块 `soloRoleplayV2Sim.js`） | task-blind | 小传 + 两句 | 读法一句（D4 逐维）、R1 自己的提案 | 隐藏 |
| Team R1 | `team_room_r1_actor_isolated_v1`，cap24 | task-blind | 小传 + 两句（真名、平等参与者措辞） | 旁白叙述的私下状态（从公开事件推） | 隐藏 |
| Team R2 B | `team_room_story_d4_screenplay3_d5_v1`（模块 `teamR2StoryScreenplaySim.js`） | task-blind | 小传 + 两句 | 读法一句（D4 lens）、定价观 + 价格参照 + 私下三段（D5）、R1 公开/私下记忆、收敛到一人规则 | 隐藏 |

### 3.4 组队
- Benchmark team：seed `20260814-random42-free-persona-team5-interface:{01..42}` 逐队从 42 人池无放回抽 5 人 + 抽组长；simple / layered 同 seed 同人同组长同锦囊。
- Roleplay team：42 队 = 同一 seed 族从 task-blind 42 人无放回抽 5 人（run_meta.profile_ids / leader_id）；team R2 是从 team R1 的 `r1_frozen.json` 回放，人、组长、R1 结果全部继承。
- Solo：42 units（team_size 1），seed `20260812-task-blind-r1-pool42-v1:{01..42}` 逐 unit 从 42 人池抽 1 人，**跨 unit 有放回** → 五轮都是同样的 28 个不同的人（TBN32 ×4，TBN01/TBN29 ×3）；R2 从各自 R1 回放。ledger 口径应写 "42 units / 28 unique personas"。
- 因此 solo 与 team 用的是**同一池**（team 覆盖全部 42 人，solo 覆盖其中 28 人）；faultline 强度只是随机组队的分布（人口学 Fau 0.30–0.62，中位 0.40）。

---

## 4. 与旧文档的关系
- `CODEX_PERSONA_RANDOMIZE.md`（3 月）：60 人随机化 + 教育关联规则的老设计，`sampleStudent` 沿用了其中的 surface 抽样；原型集合仍是那 7 个。
- `CODEX_PERSONA_LAYERED_ARCHITECTURE_V2.md`（3 月）与 `PERSONA_NEWFLOW_PROMPT_AUDIT.md`（7 月）：L0/L1 三层架构，属于 `scripts/sim` 那条老 sim 路径；本文四条线**都不用**（benchmark layered 明确 no L0/L1；roleplay 用小传替代）。
- `CODEX_FULL_GAME_ALL_PERSONAS.md` / `CODEX_INFO_SET_ALIGNMENT.md`：7 张认知地图那条线 + 信息集白名单规范；后者的 §1.5（分页不拼页、记忆传导不重印）对四条线仍有效。

---

## 5. 候选方向（未冻结）：trait-only persona 生成 — PROMISING（WY 2026-08-16）

- 设计：唯一线索"在中欧读 EMBA"+ 8 维 IID 指纹翻成的 8 句行为表现 → 写手自编姓名/人口学/职业/家庭/消费并写小传 → 注入仍是小传 + 两句。零事实卡、零原型、零人口学先验；persona 完全由特质定义。
- 现有证据（§2.2 探针）：类别塌缩、行为不塌 —— solo 线 COST 份额 / 亏损 / 总价格 SD 与事实卡池相当。
- 产物：`scripts/analysis/probe_trait_only_biography.js`（写小传）、`scripts/analysis/build_trait_only_pool.js`（转 task_blind_narrative_v1 schema，8 项 frozen_facts 从小传抽取，缺则"小传未提及"）、池 `data/task_blind_persona_pipeline_v1/trait_only_pool42_20260816/persona_pool_trait_only_v1.json`、runs `solo_r1_traitonly_rep1_20260816` / `solo_r2_v2Q_traitonly_rep1_20260816`。
- 若推进要做的事：(1) 池按 TBN 排序重建，与冻结池同 seed 严格按指纹配对；(2) 补 R1 解析失败重试，跑 5×42；(3) 跑 team R1→R2 B 看团队 SD 是否同样保住；(4) 决定人口学怎么处理——完全放任（现状，塌到众数）或只钉最少几个类别（性别/年龄）保脸面；(5) 记录人口学与特质的相关（现状只在"是否创始人"上 |r|≈0.4–0.5）。

---

## 6. 语言层注入：现状与 v3 方向（2026-08-17 探针）

**现状（冻结线）**：性格进了小传、没进语言。性格回测（评审只看文本反推 8 维，与指纹相关）：读小传 r 0.6–0.76、二分一致 0.73；读同一人 38 句 R1 台词 r ≈ 0.1、二分一致 0.48（随机）。台词同质化来源：房间层从不提醒特质、语域被压平（1–3 句/客气务实腔）、D4/D5 一支笔写五人、模型对齐先验；每次调用把同腔的公开记录喂回 → 上下文模仿把所有人拉向房间均值。

**试过无效的**：从小传让模型"推说话方式"再注入（31 张说话卡 71% "爱举例"、55% "先听再说"、3% 有口头禅——推导本身塌回众数）；prompt 里禁"手指敲桌"类套话（R1 里 0.55→0.36，模型不听）。

**有效的（v3 方向，未冻结）**：
1. 说话风格当**事实卡类别** IID 抽（`generate_task_blind_persona_pool_v3.js`：句长 × 直白度 × 口头禅(16 条池，队内不放回) × 举例习惯 × 被反驳反应 × 语速），写手必须把它写成小传里 ≥3 句原话（机械检查）；actor 调用取小传原话当样本（不是模型转述）。两队 R1 探针（`teamr1_speechquote_v2/v3_20260817`）肉眼可见：口头禅上嘴、"顶回去"的人真的顶、句长可分。
2. 剧本/演员规则：每个 beat 回应上一句的具体说法、禁经历引用开头、允许半句——R2 12 队探针：敲桌 0.16→0.02、问句 0.27→0.42、半句 0.08→0.18，决策结果不变。
3. 舞台指示：prompt 禁不住，**存 transcript 时确定性剥掉非 UI 括号**（`teamR1SpeechQuoteSim.js`），只留 UI 操作。
待做：42 人 v3 小传 + 12 队 R1 做性格回测量化（目标二分一致 ≥0.65）。
