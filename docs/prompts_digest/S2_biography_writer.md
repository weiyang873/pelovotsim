### Digest S2 — Task-blind biography writer (verbatim prompts, sampling, checks)

Repo: `/Users/weiyang/Dropbox/Github_indiswyang/try/emba-ai-sim-v01` (main, 2026-08-23)
Frozen pool: `data/task_blind_persona_pipeline_v1/r1_pool42_20260812/persona_pool_task_blind_narrative_v1.json` (sha256 3e79d106…, 42/42 generated, provider deepseek / model `deepseek-v4-flash`, seed `20260812-task-blind-persona-v1`).
Generator: `scripts/analysis/generate_task_blind_persona_pool.js` (v1; script_sha256 recorded in manifest `fae34322…`).
Pool dir contents: `biography_calls.jsonl` (116 call records), `frozen_fact_cards.json`, `persona_pool_task_blind_narrative_v1.json`, `pool_manifest.json`. **No `prompt_example.json` exists** anywhere under `data/`; the dir `data/task_blind_persona_pipeline_v1/card_only_pool42_20260819/` **does not exist** in this checkout (the v3 pool lives in the Claude worktree `~/worktrees/.../r1_pool42_v3_20260819` per FREEZE_LEDGER line 69). The assembled messages below were reconstructed by running `biographyMessages(card)` on the frozen card; the resulting user-message sha256 matches the pool record's `generation_provenance.biography_input_sha256` exactly.

---

#### 1. Biography writer — pipeline overview

Three-stage information firewall (`pool_manifest.json` → `information_firewall`):
- task_analyzer sees: `task_text`, `generic_field_catalog`, `trait_dimension_names_only` (stage `inferSchema`, lines 230–322; one LLM call, temperature 0.1, max_tokens 1800, picks 6–12 fields from the 20-field catalog; output `background_schema.json`).
- fact_sampler sees: `expanded_field_ids`, `general_population_priors`, `seed` (deterministic, no LLM; `buildFactCard`, lines 562–611).
- biography_writer sees: `frozen_fact_values`, `natural_language_trait_directives`, `name`; does NOT see `task_text`, `task_id`, `task_options`, `schema_relevance_reasons`, `trait_numbers`.

For the frozen 42-pool, the schema used was `r1_pilot12_20260812/background_schema.json` (sha 14113cb5…): the analyzer selected 10 fields (`customer_and_user_exposure, product_and_technology_familiarity, economic_resources_and_pressure, personal_consumption_habits, price_reference_history, quality_convenience_tradeoffs, intergenerational_contact, caregiving_and_dependents, social_influence_on_choices, communication_and_participation`); dependency expansion added 4 (`age_and_life_stage, education_and_learning, career_context, household_structure`) → **14 facts per card** (`expandDependencies`, lines 211–228). The remaining 6 catalog fields (gender, region_and_mobility, career_trajectory, managerial_scope, procurement_and_budget_exposure, current_life_pressure) are sampled but NOT shown to the writer (line 595: `selectedFacts = Object.fromEntries(schema.expanded_field_ids.map(...))`).

##### 1a. System message (verbatim) — `generate_task_blind_persona_pool.js:615-624`

```
你是严肃现实主义人物小传作者。请把一张已经冻结的人物事实卡写成一个连贯、具体、像真实中国高管项目学员的人。
你不知道这个人以后会参加什么研究、看什么界面或做什么任务，也不要猜测。
事实卡中的内容和八条行为表现都是硬约束，但不要逐字段复述，不要写成用户画像、心理测评、咨询报告或优缺点清单。
先让职业与生活经历有时间连续性，再用具体的小事、成功、吃亏、家庭分工、花钱或工作习惯自然表现行为。
同一个人可以矛盾。不要替人物总结稳定的商业立场，不要预告未来会选择什么。
不得出现任何 trait 名称、分数或高低标签。只输出可 JSON.parse 的 JSON。
```

##### 1b. User message template (verbatim source) — `generate_task_blind_persona_pool.js:613-643`

```js
function biographyMessages(card) {
  return [
    {
      role: "system",
      content: [
        "你是严肃现实主义人物小传作者。请把一张已经冻结的人物事实卡写成一个连贯、具体、像真实中国高管项目学员的人。",
        "你不知道这个人以后会参加什么研究、看什么界面或做什么任务，也不要猜测。",
        "事实卡中的内容和八条行为表现都是硬约束，但不要逐字段复述，不要写成用户画像、心理测评、咨询报告或优缺点清单。",
        "先让职业与生活经历有时间连续性，再用具体的小事、成功、吃亏、家庭分工、花钱或工作习惯自然表现行为。",
        "同一个人可以矛盾。不要替人物总结稳定的商业立场，不要预告未来会选择什么。",
        "不得出现任何 trait 名称、分数或高低标签。只输出可 JSON.parse 的 JSON。"
      ].join("\n")
    },
    {
      role: "user",
      content: [
        `姓名：${card.name}`,
        "",
        "【冻结事实；不得更改】",
        ...Object.entries(card.frozen_facts).map(([id, value]) => `${id}: ${value}`),
        "",
        "【八条行为表现；只能通过故事、动作和语言表现，不能解释成标签】",
        ...Object.values(card.behavioral_directives).map((value) => `- ${value}`),
        "",
        "写一篇 900-1300 字的第三人称人物小传。必须包括连贯职业主线、当前生活结构、两到四件能留下行为痕迹的具体往事、自然的说话和课堂参与状态。",
        "只写这个人的一般人生，不出现任何未来任务、产品方案、市场选项或推荐答案。",
        "只输出：{\"biography\":\"完整连续的小传正文\"}"
      ].join("\n")
    }
  ];
}
```

Retry suffix appended to the user message when a prior attempt failed a mechanical check (`:678`):
```js
if (lastError) messages[1].content += `\n\n上一稿未通过机械检查：${lastError}。请重写全文，不要解释检查。`;
```

##### 1c. LLM call parameters — `generate_task_blind_persona_pool.js:676-688`

| param | value | line |
|---|---|---|
| role | `chat_service` (deepseek-v4-flash per manifest) | 683 |
| temperature | **0.9** | 684 |
| max_tokens | **3000** | 685 |
| timeoutMs | 90000 | 686 |
| response_format | `{ type: "json_object" }` | 687 |
| retries | `for (let attempt = 1; attempt <= 3; attempt += 1)` — **3 attempts** per persona in-script; concurrency default 4 (`p-limit`) | 676, 670 |

Note on the frozen pool: the in-script loop allows 3 attempts, but `pool_manifest.json` records three extra `retry_batches` (`retry_started_attempt` 4, 7, 10) re-running 9, 3, then 1 personas; `biography_calls.jsonl` shows TBN22 succeeding on attempt 12 (11 logged errors, all "biography too long"). Of 116 logged calls, 42 are ok and 74 are errors: 68 "too long" (1810–2712 chars), 3 "too short" (62/268/343 chars), 2 JSON parse failures, and **1 task-leakage hit (TBN38 attempt 1: `机器人`)**. The retry-batch driver is not in the repo at HEAD (grep for `retry_batches` in `scripts/` returns nothing).

##### 1d. Fact card — 20-field catalog and sampling rules

Catalog `FIELD_CATALOG` `:10-31`. Sampling in `buildFactCard` `:562-611`, seeded RNG `createSeededRandom(`${seed}:facts:${index+1}`)` `:563` (FNV-1a-seeded mulberry32, `:180-193`). Base draws (`:565-571`): `age = integer(34, 58)`; `gender = chance(0.42) ? "female" : "male"`; `education = pick(EDUCATIONS)` where `EDUCATIONS = ["本科","本科","硕士（国内）","硕士（国内）","硕士（海外）","大专后继续教育"]` (`:81`, i.e. 2/6 本科, 2/6 国内硕士, 1/6 海外硕士, 1/6 大专); `region = pick(REGIONS)` (14 cities `:80`), `origin = pick(REGIONS \ region)`; `career = careerFacts()` `:421-429`: industry uniform over 18 (`:55-59`), function uniform over 11 (`:61-64`), role uniform within function (`:66-78`), company_context uniform over 6 (`:82`), `career_start_age` = 23–25 if 硕士 / 21 if 大专 / else 22, `career_years = max(10, age − start)`; `household = householdFacts()` `:408-419`: partnership "有稳定伴侣" w.p. 0.82 (age>40) else 0.66, otherwise pick ["单身","离异，目前单身"]; child_count pick([0,0,1]) if age<37 else pick([0,1,1,2]); child ages `integer(max(1,maxAge−8), maxAge)` with `maxAge = clamp(age−24−2i, 2, 30)`; elder_living w.p. 0.7 (age>52) else 0.88; elder_age `min(92, age+integer(22,34))`; elder_proximity pick ["同住","同城不同住","异地，每年见几次","车程半小时内"] else "主要老人已经去世". Name: `pick(SURNAMES)+pick(GIVEN_NAMES[gender])` (20 surnames × 10 given names per gender, `:83-87`); no uniqueness check (the 42 pool happens to have 0 duplicates).

One line per field (template strings verbatim from `:574-593` unless a helper is cited):

1. `age_and_life_stage` (`:574`): `` `${age}岁，处在职业责任已经较重、个人生活结构相对稳定但仍可能变化的阶段。` `` — age ~ U{34..58}.
2. `gender` (`:575`): `"女"`/`"男"` — P(female)=0.42. *(not in writer's card)*
3. `education_and_learning` (`:576`): `` `${education}，专业训练与${career.primary_function}相关或在职业中逐步补齐；符合高管项目的学习基础。` `` — education from 6-slot list above.
4. `region_and_mobility` (`:577`): `` `成长于${origin}，目前在${region}工作生活，中间至少有一次因工作迁移。` `` — two distinct uniform picks from 14 cities. *(not in writer's card)*
5. `career_context` (`:578`): `` `${career.company_context}的${career.current_role}，所在行业为${career.industry}，主要职能是${career.primary_function}。` `` — all uniform picks.
6. `career_trajectory` (`:579`): `` `${career.career_start_age}岁左右进入职场，已有约${career.career_years}年经验；从专业或一线岗位逐步承担项目、团队和经营责任，职业变化必须围绕${career.industry}或相邻行业、${career.primary_function}或相邻职能展开。` `` *(not in writer's card)*
7. `managerial_scope` (`managementScope` `:431-440`): `team = integer(12, role含"总经理" ? 260 : 95)`; uniform pick of 4 templates, e.g. `` `直接或间接管理约 ${team} 人，负责一个区域的收入和交付` ``. *(not in writer's card)*
8. `customer_and_user_exposure` (`customerExposure` `:442-452`): branch on industry set — B2B {智能制造,企业软件,新能源设备,工业自动化,建筑工程,物流仓配} → pick of 2 strings ("长期面对企业采购、业务负责人和一线使用部门，见过付款者与使用者意见不一致。" | "主要服务机构客户，熟悉招采、试用、验收和续约链条。"); consumer {消费品,教育培训,连锁零售,汽车后市场,文旅运营} → pick of 2; else mixed → pick of 2.
9. `procurement_and_budget_exposure` (`procurementExposure` `:454-459`): strong if function ∈ {运营与供应链,财务与投资,工程与制造,技术与研发,综合经营管理} → pick of 2 strong strings; else pick of 2 weak strings. *(not in writer's card)*
10. `product_and_technology_familiarity` (`technologyFamiliarity` `:461-466`): technical if function ∈ {技术与研发,产品与业务,工程与制造} → pick of 2; else pick of 3.
11. `household_structure` (`:584`): `` `${partnership}；子女数${child_count}${child_count ? `，年龄${child_ages.join("、")}岁` : ""}；${elder_living ? `有约${elder_age}岁长辈，${elder_proximity}` : elder_proximity}。` ``
12. `intergenerational_contact` (`intergenerationalFacts` `:516-524`): child sentence (`与N个子女有真实日常接触，年龄为…岁。` or pick of 2 no-child strings) + elder sentence (`有一位约${elder_age}岁的长辈，${elder_proximity}。` or "主要长辈已经去世，近年没有持续照护老人。").
13. `caregiving_and_dependents` (`caregivingFacts` `:526-530`): if no elder and no child → "家庭成员总体独立，目前没有持续照护责任"; else uniform pick among 3 ["本人承担日常安排和关键决定","主要由伴侣或兄弟姐妹照料，本人只在紧急时参与","家庭成员总体独立，目前没有持续照护责任"].
14. `economic_resources_and_pressure` (`economicFacts` `:468-477`): uniform pick of 5 pressure sentences + `` ` 当前岗位为${career.current_role}；家庭状态为${household.partnership}。` ``.
15. `personal_consumption_habits` (`consumptionHabit` `:479-488`): uniform pick of 6 sentences.
16. `price_reference_history` (`priceHistory` `:490-503`): two distinct episodes from 6 templates with numeric draws: 手机 `integer(28,86)*100` 元; 耐用品 `integer(18,75)*100` 元 used `integer(2,9)` 年; 每月 `integer(12,58)*100` 元 服务; 部门采购 `integer(8,85)` 万元; 年订阅 `integer(3,24)*100` 元; 小型智能设备 `integer(3,16)*100` 元.
17. `quality_convenience_tradeoffs` (`qualityTradeoff` `:505-514`): uniform pick of 6.
18. `social_influence_on_choices` (`socialInfluence` `:532-540`): uniform pick of 5.
19. `current_life_pressure` (`currentPressure` `:542-549`): uniform pick of 4 (two conditional on elder_living / child_count). *(not in writer's card)*
20. `communication_and_participation` (`communicationTexture` `:551-560`): uniform pick of 6 speaking/classroom styles.

##### 1e. Fingerprint → directives mapping

Fingerprint: 8 dims, each `Number((0.05 + rng()*0.9).toFixed(2))`, i.e. U[0.05, 0.95], separate seed `${seed}:traits:${index+1}` (`sampleFingerprint` `:324-336`, called `:572`). Band `traitBand` `:338-344`: `<0.2→0, <0.4→1, <0.6→2, <0.8→3, else 4`. Only the band sentence reaches the writer; numbers never do.

`traitDirectives` `:346-406` (verbatim; index = band 0..4):

```js
maximizing_satisficing: [
  "只要遇到一个能过自己底线的方案就容易停下来，不太愿意继续翻找。",
  "通常先看少数几个顺眼的方案，达到基本要求后便倾向收手。",
  "会比较几种选择，但搜索范围随时间和兴趣改变。",
  "常担心还有更合适的选项，会主动扩大搜索并反复比较。",
  "很难接受只是够用，倾向把可见选择查得很全，停手也较晚。"
],
need_for_cognition: [
  "碰到复杂问题容易嫌费脑，偏好凭熟悉印象快速处理。",
  "愿意想一点，但若很快能形成说得通的判断就不再深挖。",
  "重要问题会认真分析，普通问题更多依赖经验。",
  "喜欢追问原因、比较机制，通常愿意投入较多思考。",
  "面对复杂问题会自发拆解、验证和反复推演，即使没有人要求。"
],
actively_open_minded_thinking: [
  "形成第一判断后不太主动找反例，容易把反对意见当成干扰。",
  "会听不同意见，但更容易保留原先看法。",
  "证据清楚时能够调整，是否寻找反证取决于事情重要性。",
  "会主动问自己可能错在哪里，并认真处理可信的反对意见。",
  "习惯邀请最强反方；新证据充分时，即使难堪也会明显更新判断。"
],
risk_propensity_business: [
  "对结果波动非常警惕，宁可放慢也希望避免明显失败。",
  "偏好风险边界清楚的路径，面对较大波动会退回保守方案。",
  "是否冒险取决于熟悉度、资源余量和退出机会。",
  "只要潜在收益足够，会接受较明显的结果波动和试错。",
  "容易被高上行机会吸引，愿意承担别人觉得过大的经营不确定性。"
],
ambiguity_tolerance: [
  "信息缺口会让其明显停滞，倾向等规则和概率更清楚再行动。",
  "能容忍少量未知，但关键环节不清楚时会反复确认。",
  "会边做边补信息，同时为未知部分保留调整余地。",
  "在信息不全时也能形成临时判断，并通过行动获取反馈。",
  "对模糊状态适应很快，愿意先进入情境再逐步定义问题。"
],
regulatory_focus_promotion: [
  "首先想到责任、失误和可能失去什么，目标通常编码成守住底线。",
  "安全和避免后悔更有驱动力，但机会很清楚时也会向前。",
  "进取与防守随情境切换，没有固定一边。",
  "更容易被成长、成就和向上机会激活，停滞会令其不安。",
  "强烈用突破和获得来理解成功，压力下仍倾向寻找向上的动作。"
],
consideration_future_consequences: [
  "眼前结果权重很高，远期收益很难抵消当前麻烦。",
  "偏向先解决近期问题，长期影响通常排在后面。",
  "会在短期兑现与长期积累之间寻找折中。",
  "愿意为未来结果承担近期成本，不轻易透支长期关系或能力。",
  "会持续追踪多年后的后果，必要时牺牲明显的眼前收益。"
],
action_orientation: [
  "拍板后也容易反复回想，受挫时恢复慢，启动常需要外力。",
  "决定后能启动，但遇到阻力容易停下来重新考虑。",
  "通常能推进，恢复速度取决于事情是否熟悉和是否有人支持。",
  "决定后会很快转入行动，受挫后能调整并继续。",
  "行动启动和恢复都很强，阻力反而容易激发持续推进。"
]
```

##### 1f. Pool-dir artifacts quoted

`pool_manifest.json` (excerpt): `"provider": "deepseek", "model": "deepseek-v4-flash", "base_url_host": "api.deepseek.com", "count_requested": 42, "count_generated": 42, "errors": [], "forbidden_biography_term_hits": [], "wall_clock_ms": 423142`; `retry_batches` as described in 1c. `biography_calls.jsonl` record shape: `{"ts","persona_id","attempt","status":"ok"|"error","latency_ms","raw"[,"error"]}`; TBN07 succeeded on attempt 1 in 19921 ms.

---

#### 2. Composed example — TBN07 (徐承宇)

##### 2a. Fingerprint (pool json, `behavioral_fingerprint`)
```json
{"maximizing_satisficing":0.14,"need_for_cognition":0.13,"actively_open_minded_thinking":0.21,"risk_propensity_business":0.86,"ambiguity_tolerance":0.73,"regulatory_focus_promotion":0.09,"consideration_future_consequences":0.81,"action_orientation":0.77}
```
→ bands 0,0,1,4,3,0,4,3. Surface: male, 49, 硕士（国内）, 苏州.

##### 2b. Assembled messages actually sent (system = §1a verbatim; user message below; sha256 of user content = `14876c1b…` = pool `biography_input_sha256`)

```
姓名：徐承宇

【冻结事实；不得更改】
age_and_life_stage: 49岁，处在职业责任已经较重、个人生活结构相对稳定但仍可能变化的阶段。
education_and_learning: 硕士（国内），专业训练与市场与品牌相关或在职业中逐步补齐；符合高管项目的学习基础。
career_context: 大型民营集团的品牌负责人，所在行业为新能源设备，主要职能是市场与品牌。
customer_and_user_exposure: 主要服务机构客户，熟悉招采、试用、验收和续约链条。
product_and_technology_familiarity: 日常办公软件熟练，智能设备主要靠同事或家人推荐，对技术参数耐心有限。
household_structure: 有稳定伴侣；子女数1，年龄18岁；有约80岁长辈，同城不同住。
intergenerational_contact: 与1个子女有真实日常接触，年龄为18岁。 有一位约80岁的长辈，同城不同住。
caregiving_and_dependents: 本人承担日常安排和关键决定
economic_resources_and_pressure: 收入较稳定，可支配空间尚可；工作忙，常愿意用钱换时间，但对长期固定支出谨慎。 当前岗位为品牌负责人；家庭状态为有稳定伴侣。
personal_consumption_habits: 工作太忙时会让伴侣或同事代选，自己只确认几个底线，买后不爱退换。
price_reference_history: 家里买过一件 6900 元的耐用品，使用了3年。 为家人付过每月 5600 元的教育、照护或康复服务。
quality_convenience_tradeoffs: 曾因时间紧直接选了熟悉供应商，结果稳定但价格偏高；本人并不确定当时是否最划算。
social_influence_on_choices: 家里大件通常与伴侣共同决定，工作用品更听实际使用者。
communication_and_participation: 表达有条理但略像汇报，被挑战时会停一下再改口。

【八条行为表现；只能通过故事、动作和语言表现，不能解释成标签】
- 只要遇到一个能过自己底线的方案就容易停下来，不太愿意继续翻找。
- 碰到复杂问题容易嫌费脑，偏好凭熟悉印象快速处理。
- 会听不同意见，但更容易保留原先看法。
- 容易被高上行机会吸引，愿意承担别人觉得过大的经营不确定性。
- 在信息不全时也能形成临时判断，并通过行动获取反馈。
- 首先想到责任、失误和可能失去什么，目标通常编码成守住底线。
- 会持续追踪多年后的后果，必要时牺牲明显的眼前收益。
- 决定后会很快转入行动，受挫后能调整并继续。

写一篇 900-1300 字的第三人称人物小传。必须包括连贯职业主线、当前生活结构、两到四件能留下行为痕迹的具体往事、自然的说话和课堂参与状态。
只写这个人的一般人生，不出现任何未来任务、产品方案、市场选项或推荐答案。
只输出：{"biography":"完整连续的小传正文"}
```

##### 2c. Generated biography (verbatim from pool, 1784 chars after whitespace collapse)

> 徐承宇今年四十九岁，在南方一家新能源设备集团做了近十年的品牌负责人。他的职业生涯起步于一家地方家电企业的市场部，那时候他刚从国内一所普通大学的硕士班毕业，学的是企业管理，论文写得一般，但人踏实，肯跑市场。头几年他跟着老业务员下过乡镇，也蹲过经销商仓库，见过产品被退回时经销商拍着桌子的样子。后来集团被收购，他辗转跳了两家民企，从市场专员做到品牌经理，再到现在的岗位。他管的事不复杂，但多：品牌定位、展会、宣传物料、客户口碑维护，偶尔还要陪销售去谈大客户。他手底下有七八个人，开会时他讲得多，条理清楚，像在做汇报，讲完总会停一下，问大家有没有意见。要是有人提出不同看法，他会愣一拍，然后说‘我再想想’，接着把话题带回原来的路线。有次新来的品牌专员建议换一批展会设计公司，说之前那家报价高，他听完没立刻回应，只说了句‘先让老周他们做一版再看吧’。老周是他的老供应商，合作了五年，熟悉他的风格，虽然价格贵些，但从没出过岔子。 他的家庭结构简单。妻子在一家中学做行政，女儿今年刚满十八岁，在本地读大学，周末回家。他母亲八十岁，住在同城另一个区，身体还行，但膝盖不太好，每周他至少抽一天去看她，顺便帮她把家里的药和日用品备齐。家里的日常开销和老人看病安排基本都是他拿主意，妻子负责买菜做饭和女儿的生活琐事，但遇到大件采购，比如三年前买的那台六千九的净水器，是夫妻俩一起定的。当时妻子看中一款进口的，他嫌贵，但母亲说喝水有点涩，他就答应了，用了三年，效果一直稳定。他平时忙起来顾不上挑东西，有次出差前让妻子代买一套给客户的礼品，只说了句‘别太花哨，实用点’，后来收到发现是保温杯，也没退，直接用了。 他花钱的习惯有点矛盾。日常开销不怎么计较，愿意打车、点外卖，省下时间用来处理邮件或补觉。可对长期固定支出他很谨慎，给母亲找的照料服务每月五千六，是他比较了四家才定的，当时妻子嫌麻烦，说找朋友介绍那家就行，他坚持自己跑了一遍，最后选的这家口碑好，但离家稍远。他解释说：‘多花点时间没关系，定了就不想再换，免得后面麻烦。’他对技术产品没什么耐心，手机和办公软件基本靠同事推荐，家里智能设备都是女儿弄好的，他只会用基础功能，有时参数太多他会直接说‘你们看着办，能打电话发微信就行’。 他有个习惯，只要一个方案能过自己心里的底线，就不太愿意再往下找。去年集团要换一套客户管理系统，供应商提了三个方案，他听了前两个就定了第三个，因为那个销售是熟人介绍的，演示时说得顺，他点了点头，项目就推进了。后来实施时发现有些模块不适合他们的客户数据结构，团队提过要不要换，他说‘先跑起来，不行再调’，后来确实花了不少功夫补救，但他也没后悔，只跟下属说‘当时时间紧，选了就把它做好’。他在信息不全时也敢做判断。有次一个大客户临时要提前验收，他还不清楚具体技术细节，就当场拍板说‘没问题，我们配合’，然后回去连夜协调售后团队，最后赶上了，客户挺满意。 他的工作压力大，常担心品牌出事。有次一批产品在北方冬天出了低温故障，客户投诉到网上，他第一时间想的是责任和影响，组织团队写回应稿，自己盯着每一句话，连续两周没怎么睡好。但他不是怕事的人，事后他主动跟销售提出做一套冬季使用指南，虽然这不在他的预算内，也增加了当年成本，他还是做了。两年后，那批客户续约率反而比同期其他区域高，他开会时提过一次，说‘当时多花钱，现在看值’。 在课堂上，他坐在前排，笔记记得慢，但会抬头听。遇到案例讨论，他发言像在部门例会，先说‘我们公司一般怎么处理’，再讲步骤。别人反驳他时，他会沉默几秒，然后调整措辞，比如‘你这么说也有道理，但实际执行时可能……’他从不争得面红耳赤，但能感觉到他有自己的一套框架，不太容易被说动。他偶尔会提自己女儿，说跟年轻人聊不来，但也愿意听她讲学校的事。他母亲生日那天他请了假，提前走了，同事问他是不是有急事，他笑了笑说‘家里老太太等久了会生气’。 他的生活就是这样，工作占了大半，家庭是另一个重心。他不太想太远的事，但会在意那些已经定了的承诺，比如答应母亲每周去看她，答应客户售后期限，答应妻子这个大件用坏了再换。他吃过亏，也占过便宜，但都不太愿意回头细想。他有时候会觉得自己太保守，可又总在那些别人看来风险不小的事情上点头，比如那次临时答应提前验收。他也不知道这算不算矛盾，反正日子就这么过下来了。

---

#### 3. Mechanical checks applied to biography output

v1 `normalizeBiography` (`generate_task_blind_persona_pool.js:645-656`), identical in v2 (`_v2.js:675-686`) and v3 (`_v3.js:690-702`, plus one extra rule). Any failure throws → retry with the error text appended to the user prompt (`:678`).

- **JSON extraction**: strip ``` fences (`stripFence` `:147-149`, regex `/^```(?:json)?\s*/iu` and `/\s*```$/u`), take first balanced `{…}` by brace-depth scan respecting strings, strip trailing commas `/,\s*([}\]])/gu`, then `JSON.parse` (`parseJsonObject` `:151-178`). Parse failure = error (2 such in the 42-pool log).
- **Field + whitespace normalize**: `String(parsed?.biography || "").replace(/\s+/gu, " ").trim()` (`:647`) — all whitespace runs collapsed to one space before length checks.
- **Min length**: `biography.length < 650` → `biography too short: N` (`:648`). (Length = JS UTF-16 code units ≈ CJK characters.)
- **Max length**: `biography.length > 1800` → `biography too long: N` (`:649`). Dominant failure mode: 68/74 logged errors; all 42 frozen biographies fall in 1245–1793.
- **Frozen name present**: `!biography.includes(card.name)` → `biography does not contain frozen name` (`:650`).
- **Task-word firewall** (`FORBIDDEN_BIOGRAPHY_TERMS` `:42-46`, substring `includes`, case-sensitive): `["ToB","ToC","COST","DIFF","成本领先","差异化","体验型","混合型","功能型","AI宠物","AI 宠物","机器人","目标市场","市场格","grid_id","Round 1","R1","本次任务","这个任务","课堂选择","商业战略","战略偏好","应该选择","建议选择"]` → `task leakage: …` (`:651-652`). Re-checked post hoc over the final pool and written to manifest `forbidden_biography_term_hits` (`:745`; result `[]`).
- **Trait-label firewall** (`TRAIT_LABEL_TERMS` `:48-53`, substring): `["Maximizing","Satisficing","Need for Cognition","Open-Minded","Risk Propensity","Ambiguity Tolerance","Regulatory Focus","Future Consequences","Action Orientation","最大化倾向","满意化倾向","认知需求","开放性思维","风险倾向","模糊容忍","调节焦点","未来后果考量","行动导向"]` → `trait label leakage: …` (`:653-654`).
- **v3 only — quoted-speech count**: `(biography.match(/“[^”]{3,60}”/g) || []).length < 3` → `biography needs >=3 quoted lines, found N` (`_v3.js:696-697`).
- **Retry budget**: v1 `attempt <= 3` (`:676`); v2 and v3 `attempt <= 8` (`_v2.js:706`, `_v3.js:723`). Unresolved personas are collected in `errors` and the run throws `failed to generate N biographies` (`:749`) after still writing the partial pool + manifest.
- **Schema-level checks (analyzer stage, not the biography)**: unknown `field_id` → error; selected count must be 6–12 (`normalizeInferredSchema` `:260-293`); `schema.schema !== "task_background_schema_v1"` → error (`:661`).
- **Not checked**: name uniqueness across personas (none in code; 42-pool has 0 duplicate names by inspection), Chinese-character ratio, paragraph count, 900–1300 target itself (only the 650/1800 envelope is enforced).

---

#### 4. Differences v1 → v2 → v3 (writer prompt and card)

- **Writer system prompt**: byte-identical across v1/v2/v3 (`_v3.js:657-669` = v1 `:613-624`). Temperature 0.9 / max_tokens 3000 / json_object unchanged.
- **v2 (2026-08-16, faultline pool; header `_v2.js:2-8`)**: changes are confined to the fact sampler; output schema stays `task_blind_narrative_v1`.
- **v2 education tiers**: `EDUCATIONS` replaced by weighted first degree `FIRST_DEGREE_TIERS = [["985/211 本科",0.3],["普通本科",0.45],["大专",0.25]]` × postgrad `POSTGRAD_OPTIONS = [["无",0.37],["国内硕士",0.3],["海外硕士",0.33]]` (`_v2.js:67-68`, `weightedPick` `:69-74`, `educationFacts` `:77-87`).
- **v2 overseas facts**: if 海外硕士 → destination pick of 8 (美国/英国/澳大利亚/新加坡/加拿大/法国/德国/香港), duration `integer(1,2)` 年, field pick of 8, `ageAt = integer(24, min(34, age−6))`, first job back pick of 5; written into `education_and_learning` as `` `第一学历${firstTier}；${ageAt}岁左右去${destination}读了${duration}${field}硕士，回国后第一份工作在${firstJobBack}；专业训练与${primary_function}相关或在职业中逐步补齐。` `` else `` `第一学历${firstTier}${postgrad==="国内硕士" ? "，之后在国内读了硕士" : "，没有再读学位"}；…` `` (`_v2.js:604-606`); `surface.overseas` now filled from the card (v1 hard-coded `hasOverseas:false`, v1 `:694`).
- **v2 industries**: 18 → 25, split `INDUSTRIES_BY_TYPE` 传统(15)/新兴(10) (`_v2.js:62-66`); still uniform; `industry_type` is post-hoc classification in `surface` only, never in facts (`_v2.js:449`).
- **v2 retries**: 3 → 8 attempts (`_v2.js:706`); sampler tag `deterministic_general_population_priors_v2_faultline` (`:638`).
- **v2_design** (`_v2_design.js:1-3`): v2 + `--design-file` fixing industry set / function set / age range per persona from a design matrix (`careerFacts(age, education, rng, design)` `:451-454`, `design_cell` in surface `:635`); otherwise identical.
- **v3 (2026-08-17, speech-style probe; header `_v3.js:2-4`)**: adds a 21st card fact `speech_style` = IID pick from 6 sub-lists joined by "；" (`speechStyle` `_v3.js:443-445`; lists `SPEECH_LENGTH`(3), `SPEECH_DIRECT`(4), `SPEECH_TIC`(16), `SPEECH_EXAMPLE`(4), `SPEECH_PUSHBACK`(6), `SPEECH_TEMPO`(4), `:437-442`), always appended to the writer's card regardless of schema (`:639`).
- **v3 user prompt**: one extra line inserted after the 900–1300 instruction (`_v3.js:682`): `speech_style 这一项要变成正文里至少三句他/她的原话（用中文引号“ ”引出，放在具体场景里，各不超过 40 字），让读者光看引号里的话就能听出这个人怎么说话；不要用旁白概括说话风格。`
- **v3 check**: new mechanical rule ≥3 matches of `/“[^”]{3,60}”/g` (`_v3.js:696-697`); everything else identical to v2. (v3 pool output lives in the Claude worktree, not this checkout; FREEZE_LEDGER line 69 reports 42/42, median 13 quoted lines.)
