### Benchmark simulation line — verbatim prompt digest

Repo: `/Users/weiyang/Dropbox/Github_indiswyang/try/emba-ai-sim-v01` (files unchanged since run commit `d8bfd27e`; verified with `git diff d8bfd27e HEAD --stat` on the three files below = empty).

Runner: `scripts/analysis/run_benchmark_team_simple_layered.js` → `runTeam()` in `server/synthetic/teamSim/benchmarkTeamSim.js` (8548 lines). `orchestrator.js` is NOT on this path (the runner requires `benchmarkTeamSim` only, line 198). Both benchmark batches run with arm strings `simple` and `layered` passed straight to `runTeam` (runner line 233); the preset's `runtime_arm_aliases: {layered: "team_layered_nomap"}` (`scripts/analysis/team_sim_presets.js:74-76`) is recorded in `pilot_summary.json` but is **never applied** by this runner, so the run_meta of every layered dir says `arm: "layered"` and `arm_definition: "layered (deprecated partial): random42 surface + archetype business fields/pricingBias/speaking_tendency only; no deterministic L0/L1 classroom profile and no cognitive map."` (`benchmarkTeamSim.js:1555-1557`), `layered_nomap_generation: null`.

Batches (both `preset: random42_simple_layered_team5_v1`, lifecycle `fork`, model `deepseek-v4-flash`, `disable_thinking: true`, pool `data/persona_pool_random42_free_0731_interface_20260814/persona_pool_v2.json`, 42 seeds × 2 arms, 0 failures):
- Team: `runs_v4flash_0731/team_pilot/benchmark_team_rep2_20260816/` — `config_overrides: {team_size: 5, temperature: 0.55}`
- Individual: `runs_v4flash_0731/team_pilot/benchmark_indiv_orch_rep1_20260816/` — `config_overrides: {team_size: 1, temperature: 0.55}` (same code path; one member is sampled, is leader, and "discusses" with itself)

Frozen config `game_config_v0.1/team_sim_config.json` (verbatim):
```json
{
  "team_size": 5,
  "max_turns_r1_discussion": 12,
  "max_turns_r2_per_segment": 7,
  "submit_parse_retries": 2,
  "leader_willingness_boost": 1.5,
  "speakers_per_turn": { "min": 1, "max": 2 },
  "r2_card_segments": [
    ["perception_understanding", "mobility_navigation"],
    ["interaction_expression", "safety_trust"],
    ["expand_connect", "ops_maintenance"]
  ],
  "temperature": 0.55
}
```

---

#### 1. Persona rendering

##### Pool record → member (`benchmarkTeamSim.js:531-555`, default branch of `loadRandom42ProfilePool`)
Pool record has `persona_id`, `archetype` (A–G letter), `archetype_label`, `surface {name, gender, age, edu, overseas{hasOverseas,destination,duration}, mbti, expression_style}`. Business fields come from `PERSONAS[record.archetype]` in `scripts/sim/persona_pool.js`:
```js
const base = PERSONAS[record.archetype] || {};
const surface = record.surface || {};
const speakingTendency = String(surface.mbti || "").startsWith("E")
  ? "high"
  : String(surface.mbti || "").startsWith("I") ? "low" : ["high", "mid", "low"][index % 3];
const member = {
  profile_id: record.persona_id || `R${String(index + 1).padStart(2, "0")}`,
  archetype_id: record.archetype || base.id || "",
  label: record.archetype_label || base.label || record.archetype || "课堂参与者",
  desc: base.desc || record.archetype_label || "EMBA 课堂参与者",
  role: base.role || "小组成员",
  background: base.background || record.archetype_label || "",
  industry: base.industry || "",
  decisionStyle: base.decisionStyle || "",
  riskPreference: base.riskPreference || "",
  expressionStyle: surface.expression_style || base.expressionStyle || "自然表达",
  blindSpots: base.blindSpots || "",
  pricingBias: base.pricingBias || "",
  speaking_tendency: speakingTendency,
  surface,
  persona_pool_record: record
};
return attachLayeredNoMap(member);
```
(`attachLayeredNoMap` builds `layeredSystemPrompt`/L0/L1 but it is only rendered for `isLayeredNoMapArm(arm)` arms — **not** for `"layered"`; see below.)

`surface.expression_style` in the pool is `"<archetype expression style>\n\n你的思维特征（MBTI: XXXX）：\n<4 MBTI lines>"`; `splitExpressionStyle` (`:810-819`) splits on the marker `"\n\n你的思维特征"` into `display` and `behavior`.

##### `formatSurface` default branch (`benchmarkTeamSim.js:937-948`)
```js
return [
  `姓名：${surface.name || member.profile_id}`,
  `原型：${member.label}（${member.desc}）`,
  `性别：${gender}`,
  surface.age ? `年龄：${surface.age}岁` : "",
  surface.edu ? `学历：${surface.edu}` : "",
  `海外经历：${overseas}`,
  surface.mbti ? `MBTI：${surface.mbti}` : "",
  `表达风格：${expression.display || "自然表达"}`,
  options.includeBehavior && expression.behavior ? expression.behavior : ""
].filter(Boolean).join("\n");
```
(`gender`: female→"女", male→"男", else "未知"; `overseas`: `${destination}，${duration}` or "无".)

##### `simple` arm template (`benchmarkTeamSim.js:1397-1405`)
```js
if (arm === "simple") {
  return [
    `姓名代号：${member.profile_id}`,
    formatSurface(member),
    isLeader ? "你是组长，负责推进讨论、总结共识并代表全队提交。" : "你是普通队员。",
    "你正在使用课堂界面。只根据界面上看得到的信息、共享讨论和你自己的直觉发言。",
    "不要把自己当研究助理，不要输出隐藏模型分析；发言像真实小组讨论，简短、自然、可以不完美。"
  ].join("\n");
}
```
Note: `formatSurface(member)` without `includeBehavior` → MBTI trait paragraph is **not** shown in simple.

**Rendered example (simple, R39, non-leader)** — verbatim from `benchmark_team_rep2_20260816/SYN-…-simple-…:01/r1_transcript.json` `proposals[0].prompt[0].content`:
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

以下锦囊是你的私有信息，只能影响你自己的判断，不要假装别人知道。
```
(last line is the R1-proposal system suffix, see §2.)

##### `layered` arm template = fallback branch of `formatProfile` (`benchmarkTeamSim.js:1438-1453`)
```js
return [
  `姓名代号：${member.profile_id}`,
  member.surface ? "" : `原型：${member.label}（${member.desc}）`,
  member.surface ? formatSurface(member, { includeBehavior: true }) : "",
  `角色：${member.role}`,
  `行业经验：${member.industry}`,
  `背景：${member.background}`,
  `决策风格：${member.decisionStyle}`,
  `表达风格：${splitExpressionStyle(member.expressionStyle).display || member.expressionStyle}`,
  `盲区：${member.blindSpots}`,
  `定价倾向：${member.pricingBias}`,
  `发言倾向：${member.speaking_tendency}`,
  isLeader ? "你是组长，负责推进讨论、总结共识并代表全队提交。" : "你是普通队员。",
  "你正在使用课堂界面。只根据界面上看得到的信息、共享讨论和你自己的经验发言；不要输出隐藏模型分析。"
].filter(Boolean).join("\n");
```
So "layered" = simple surface + MBTI trait paragraph + archetype business fields (role/industry/background/decisionStyle/blindSpots/pricingBias) + `发言倾向`. `riskPreference` is loaded but not rendered. `表达风格` appears twice (once inside formatSurface, once again). This is NOT a "layered biography"; no L0 seed_memory / L1 classroom profile is injected (that would be `team_layered_nomap`, `:1406-1436`).

**Rendered example (layered, R17, leader)** — verbatim from `…-layered-…:01/r1_transcript.json` `proposals[4].prompt[0].content`:
```
姓名代号：R17
姓名：张晓薇
原型：职业经理人（外企或大型民企的职业高管）
性别：女
年龄：38岁
学历：MBA（国内）
海外经历：无
MBTI：INTJ
表达风格：结构化、有逻辑层次、喜欢第一第二第三、PPT 思维。同样结构化但更注重团队共识，会主动询问大家怎么看
你的思维特征（MBTI: INTJ）：
你在小组讨论中倾向先听别人说，等想清楚再发言，但观点往往更深入。
你喜欢看大局和趋势，善于联想和类比，有时会忽略执行细节。
你做决策偏逻辑分析，写 VP 时注重因果关系和数据支撑，访谈时关注功能和效率。
你喜欢尽快达成结论、做好计划，讨论时倾向推动收敛，不喜欢开放式发散太久。
角色：VP/总监/事业部总经理
行业经验：消费品、金融、地产、汽车
背景：在大型企业一路升上来，管过几百人团队，擅长体系化思考
决策风格：数据驱动、喜欢框架和模型、决策前要看数据支撑
表达风格：结构化、有逻辑层次、喜欢第一第二第三、PPT 思维。同样结构化但更注重团队共识，会主动询问大家怎么看
盲区：VP 框架漂亮但可能脱离一线用户真实场景，过度依赖二手数据
定价倾向：算得很细，倾向找最优价格点
发言倾向：low
你是组长，负责推进讨论、总结共识并代表全队提交。
你正在使用课堂界面。只根据界面上看得到的信息、共享讨论和你自己的经验发言；不要输出隐藏模型分析。

以下锦囊是你的私有信息，只能影响你自己的判断，不要假装别人知道。
```

##### Team sampling & jinang (锦囊) draw
- `sampleTeam` (`:557-562`): `members = sampleWithoutReplacement(pool, team_size, rng(seed))`; `leaderIdx = floor(rng()*members.length)`. Same seed → same members/leader/jinang in both arms (run_meta note line 8207).
- `drawJinangForMembers` (`:789-808`): `rng = makeRng("jinang:"+seed)`; market and tech cards sampled without replacement from `game_config_v0.1/jinang_cards_v2.json` (NOT the pool record's `jinang_draw`).
- `formatJinang` (`:1497-1502`):
```js
return [
  `市场锦囊：${draw.market.name}。${draw.market.desc_for_player}`,
  `技术锦囊：${draw.tech.name}。${draw.tech.desc_for_player}`
].join("\n");
```
- Visibility: `TEAM_SIM_HIDE_JINANG` unset in this preset → run_meta `jinang_prompt_visibility: "visible_in_synthetic_prompts"`. (In the legacy/benchmark path the jinang is unconditionally included; the hide flag only affects room-roleplay arms.)

**Rendered 锦囊 text shown to the benchmark persona** (R39, seed :01, both arms; from `proposals[0].prompt[1].content`):
```
市场锦囊：场景化需求调研。你擅长在真实场景中观察用户行为，用'在场'而非'问卷'获得洞察。你的方法论是：去现场看他们怎么用替代品，比问他们想要什么更有价值。
技术锦囊：健康数据与算法。你的团队在健康数据采集、清洗和算法分析方面有经验——从传感器选型到数据管线到异常检测模型。你知道'数据准确'比'算法花哨'重要一百倍。
```
Where 锦囊 is injected: R1 individual proposal (user msg, first block); every `speak()` call (system, "私有 context"); R2 individual card pick (user msg, first block). Not in willingness, moderator, or leader-submit prompts.

---

#### 2. Stage prompts (verbatim templates)

##### Shared LLM wrapper (`benchmarkTeamSim.js:1709-1723`)
```js
async function callText(messages, options) {
  return chatCompletion(messages, {
    role: "chat_service",
    temperature: options.temperature,
    max_tokens: options.maxTokens,
    timeoutMs: 90000,
    maxRetries: 2,
    disableThinking: true
  });
}
async function callJson(messages, options) {
  const raw = await callText(messages, options);
  return { raw, parsed: parseJsonLoose(raw) };
}
```

##### R1-a. Individual proposal (`independentProposal`, legacy branch `:2404-2452`)
System:
```
${formatProfile(member, isLeader, arm)}

以下锦囊是你的私有信息，只能影响你自己的判断，不要假装别人知道。
```
User (`:2415`):
```
${formatJinang(draw)}

你们要进入中国陪伴机器人市场。请先独立提出 Round 1 战略：12 格市场、架构标签、WHO/PAIN/HOW。
合法 grid_id 只能从以下列表选择：
${gridList}

自然语言说明理由，最后输出 JSON：{"grid_id":"...","architecture":"Experience|Hybrid|Function","vp_summary":{"who":"...","pain":"...","how":"..."},"rationale":"..."}。
```
`gridList` = 12 lines `- ToC_DIFF_CHILD: ToC / 儿童 / 差异化` … `- ToB_COST_ELDER: ToB / 老人 / 成本`. `maxTokens: 1500` (`:2431`). Output is then passed to `parseSubmission({decisionType:"r1"})` (a second LLM call, see below). Up to 3 attempts (`attempt <= 2`); repair system: `${formatProfile(...)}\n你必须修正为合法提交，不要引入新枚举。`; repair user (`:2444`):
```
上一次独立提案无法解析，原因：${lastError}
合法 grid_id 只能是：${GRID_IDS.join(", ")}
架构只能是 Experience, Hybrid, Function。
请重新提交 Round 1 独立提案，最后输出同样 JSON。

上一次输出：
${lastRaw}
```

##### R1-b. Discussion opener (`runTeam`, `:8245-8253`; `strategicDistribution` `:3214-3222`)
Transcript starts with one moderator line:
```
【战略分布】${grid_id/architecture}: ${count}人；…。这些只是选择结果，不含私人理由。
```
Topic string: `"Round 1 市场定位、架构、VP 共识"`; `maxTurns = max_turns_r1_discussion` (12).

##### Discussion turn machinery (shared by R1 and every R2 decision point) — `runDiscussion` willingness branch (`:3556-3581`)
```js
const willingness = [];
for (let i = 0; i < members.length; i += 1) {
  const item = await getWillingness(members[i], i === leaderIdx, transcript, topic, temperature, arm);
  const boosted = i === leaderIdx ? item.value * Number(config.leader_willingness_boost) : item.value;
  willingness.push({ index: i, value: item.value, weight: boosted, defaulted: item.defaulted });
}
const speakers = pickSpeakers(willingness, config, rng);
const turnLog = { turn, willingness, speakers: [] };
for (const speaker of speakers) {
  const i = speaker.index;
  const text = await speak(members[i], i === leaderIdx, draws[i], proposals[i], transcript, topic, temperature, arm);
  const entry = { speaker: members[i].profile_id, text };
  transcript.push(entry);
  turnLog.speakers.push(entry);
}
const check = await moderatorCheck(transcript, topic, temperature, arm);
turnLog.moderator = check;
turns.push(turnLog);
if (check.converged) {
  termination = "converged";
  break;
}
```
Loop header `for (let turn = 1; turn <= maxTurns; turn += 1)` (`:3493`); `let termination = "leader_decision"` (`:3492`) — i.e. termination is **moderator-judged convergence OR max-turns cap**, not a fixed count.

Willingness prompt (`getWillingness` `:3224-3240`): system = `formatProfile(member, isLeader, arm)`; user:
```
当前议题：${topic}
共享 transcript：
${formatTranscript(transcript)}

你现在有多想发言？0-10整数。只输出 JSON：{"willingness":数字}。
```
`maxTokens: 80`; on parse failure defaults to 5 (`defaulted: true`; 0 defaults observed in both batches).

Speaker pick (`pickSpeakers` `:3242-3263`):
```js
const min = Number(config.speakers_per_turn.min);   // 1
const max = Number(config.speakers_per_turn.max);   // 2
const count = min + Math.floor(rng() * (max - min + 1));
// weighted sampling without replacement, weight = max(0.1, willingness weight)
```
`rng = makeRng("discussion:"+seed+":"+topic)` (`:3490`) → speaker counts per turn are seed-determined and identical across arms for the same seed (verified: seed :01 simple and layered both have R1 per-turn speaker counts 1,1,2,1,2,2,1,1,2,…).

Speak prompt (`speak` `:3318-3354`, non-room branch): system
```
${formatProfile(member, isLeader, arm)}

私有 context：
${formatJinang(draw)}
你的会前提案：${privateProposal.parsed.grid_id}/${privateProposal.parsed.architecture}，${privateProposal.parsed.rationale}
```
user
```
共享 transcript：
${formatTranscript(transcript)}

当前议题：${topic}
请自然发言 2-4 句。只能说你愿意公开说出口的内容。若你改变立场，点名触发你的具体发言。
```
`maxTokens: 500`; output `raw.trim()`. `formatTranscript` (`:1562-1565`) = `${speaker}: ${text}` lines or `（暂无共享发言）`.

Moderator check (`moderatorCheck` `:3469-3486`): system `你是团队模拟 moderator。只判断讨论是否已足够收敛，不给建议、不暗示正确答案。`; user
```
当前议题：${topic}
共享 transcript：
${formatTranscript(transcript)}

是否已经足够收敛，可以让组长提交？只输出 JSON：{"converged":true|false,"reason":"..."}。
```
`temperature: 0.2` (fixed, overrides 0.55), `maxTokens: 180`.

##### R1-c. Leader submit (`leaderSubmit` `:4156-4234`, non-room branch)
System = `formatProfile(leader, true, arm)`. User = three blocks joined by `\n\n`:
```
共享 transcript：
${formatTranscript(transcript)}

【界面提交约束】
grid_id 必须逐字使用下面 12 个之一，禁止把 Experience/Hybrid/Function 拼进 grid_id。
${12 grid lines}
architecture 只能是 Experience / Hybrid / Function。

当前要提交：提交 Round 1 最终战略
请基于共享 transcript 已经说出口的论据代表全队提交。不要引用私人 context。自然语言总结，必须给出明确最终选择。

提交前可以把全队共识整理成更清楚的 WHO/PAIN/HOW，像使用课堂界面的 AI 写作辅助一样润色表达；但不能新增 transcript 没有支持的市场、用户或隐藏模型指标。
```
`submitMaxTokens = 1000` (`:4190-4192`); then `parseSubmission`; on failure up to `submit_parse_retries` (2) repair rounds with repair instruction (`:4209-4216`):
```
请只输出一个可 JSON.parse 的 JSON，不要自然语言。
合法 grid_id 只能是：${GRID_IDS.join(", ")}
architecture 只能是 Experience / Hybrid / Function。
JSON schema 必须完整：{"grid_id":"...","architecture":"Experience|Hybrid|Function","vp_summary":{"who":"...","pain":"...","how":"..."},"rationale":"..."}。
WHO、PAIN、HOW、rationale 都不能为空；只根据上一次提交和共享 transcript 修正，不引入新市场。
```
(repair `maxTokens: 900`). Then `scoreVp` → `vpWordScorer.scoreVpByWord` (separate LLM+embedding scorer, `:4329-4347`).

##### Submission parser (`server/synthetic/teamSim/submitParser.js:289-313`) — extra LLM call after every proposal / leader submit
System: `你是商业模拟提交解析器。只抽取发言中明确提交的内容，不补充、不猜测、不代填。只输出 JSON。`
User: `${parserInstruction(decisionType, context)}\n\n组长发言：\n${text}`; `max_tokens: 900, timeoutMs: 90000, maxRetries: 2, disableThinking: true`, temperature = run temperature.
`parserInstruction` (`:251-277`):
- r1: `抽取 Round 1 最终提交。输出 JSON：{"grid_id":"12格之一","architecture":"Experience|Hybrid|Function","vp_summary":{"who":"...","pain":"...","how":"..."},"rationale":"..."}。合法 grid_id：${GRID_IDS.join(", ")}`
- cards: `抽取当前选卡段的最终卡片。只允许当前段 group：${allowedGroups}；当前段每个 group 至少 ${perGroupMin} 张；全队最终累计总数至少 ${totalMin} 张；无硬性总数上限。` / `合法 cap_id 清单：${formatAllowedCards(context)}。` / (optional `界面错误提示：…`) / `如果组长用了中文名或简称，只能映射到上述清单中的真实 cap_id；禁止创造清单外 cap_id。输出 JSON：{"cards":[{"cap_id":"真实cap_id","tier":"low|mid|high"}],"rationale":"..."}。`
- price: `抽取最终定价。合法区间 ${priceMin}-${priceMax}。输出 JSON：{"price":数字,"rationale":"..."}。`

##### R2-a. Prototype / customer research page (`chooseR1MatchedPrototype` `:4528-4565`)
Prototype is **deterministically** matched to the frozen R1 grid (`buildR1MatchedPrototype`, persona picked by `makeRng("r2-matched-persona:"+seed+":"+gridPriorId)`); no LLM submit (`prototypeSubmit.attempts: 0`). One discussion (topic `R2 客户画像理解：${label}`, maxTurns = 7) opened by moderator (`:4533`, non-room branch):
```
我们队 Round 1 的市场已经冻结为 ${grid_label}。R2 客户画像必须继承这个市场，不允许切换 ToB/ToC、年龄段或策略口径。

已匹配的 R2 客户画像如下：

${summarizePrototype(chosenPrototype)}

请讨论这个客户在界面里的需求证据，以及它对后续六个功能区选卡和定价的影响。
```
`summarizePrototype` (`:4350-4359`): `${id}: ${label}` / `seed.person` / `seed.routine` / `关键痛点：${pain_points.join("；")}` / `标签：${tags.join("、")}`.
Rendered (seed :01, ToB_DIFF_ELDER): see `r2_transcript.json[0].transcript[0].text` — "B2B_Differentiation_Elder__ToB_Diff_Elder_P1: ToB / 老人 / 差异化 · 李院长 / 李院长，52岁，院长。连锁养老机构区域分院长… / 标签：情绪识别、隐私保护、场景感知、安全与信任、语音交互、远程控制".

##### R2-b. Individual card pick (`individualCardSelection` `:6945-7084`, non-humanPick, non-room)
Assignments: `assignDimensions(5)` from `server/multiplayer/rdTeamAdapter.js` — for team5 each member gets 2 of 6 groups (observed: R39 [interaction_expression, safety_trust], R09 [perception_understanding, mobility_navigation], R40 [expand_connect, ops_maintenance], R14 [interaction_expression, perception_understanding], R17 [safety_trust, expand_connect]); team_size 1 → all 6 groups.
System: `${formatProfile(member, isLeader, arm)}\n\n以下锦囊是你的私有信息，只能影响你自己的判断，不要假装别人知道。`
User (lines joined by `\n`):
```
${formatJinang(draw)}

${buildR2ContextPanel(r1Frozen, chosenPrototype, { includeReportExcerpt: true })}

【界面：个人选卡】
你负责的维度：${formatGroupNames(assignment.groups, groupMap)}。
根据调研结果和你的判断，把你认为产品应该具备的能力都选上，再选择合适的档次。
至少选择 1 张；具体张数、卡片和 low/mid/high 档位由你决定。
界面会显示单位成本、研发投入和团队投入说明，便于你在能力与成本之间取舍。
【你的 Round 1 会前提案】
${proposal.parsed.grid_id}/${proposal.parsed.architecture}：${proposal.parsed.rationale}
【你负责维度的能力卡】
${groupText}
【合法 cap_id 清单】
${formatAllowedCardsForPrompt(allowedCards)}
请只输出可 JSON.parse 的 JSON：{"cards":[{"cap_id":"真实cap_id","tier":"low|mid|high"}],"rationale":"一句自然话说明你的取舍"}
```
`maxTokens: 1800`; parsed directly (`parse_method: "direct_json"`, no parser LLM call); ≤3 attempts; each attempt appended to `r2_individual_card_attempts.jsonl`. Repair system `…\n你必须修正为合法个人选卡提交，不要引入新 cap_id 或 tier。`; repair user (`:7059-7070`): `上一次个人选卡无法解析，原因：${lastError}` / `你负责的维度只能是：${groups}` / `合法 cap_id 只能从下面清单逐字选择，不能创造新 ID：` / list / `至少选择 1 张；tier 只能是 low/mid/high。` / `请重新输出同样 JSON，不要 Markdown，不要额外文字。` / `上一次输出：` / raw.

`buildR2ContextPanel` (`:6172-6191`):
```
【战略背景】
R1 冻结市场：${grid_label}（${grid_id}），产品定位：${architecture}
R1 WHO：${vp_summary.who}
R1 PAIN：${vp_summary.pain}
R1 HOW：${vp_summary.how}
【客户调研 / 痛点提醒】
客户画像：${chosenPrototype.label}
人物/机构：${seed.person}
情境：${seed.routine}
关键场景：${prototypeSceneText}
主要痛点：${prototypePainText}
需求标签：${tags.join("、")}
调研报告摘录：${seed.report_excerpt}          ← only when includeReportExcerpt (individual pick)
讨论和选卡必须围绕以上冻结市场、客户画像和痛点，不要切换 ToB/ToC、年龄段或策略口径。
```
`formatGroup` (`:1638-1649`) card line: `- ${cap_id}｜${name}｜覆盖=${covers}｜${nre_desc}｜档位=low: ${dCOGS}元增量/研发${nre_tier}万/${load}负载；mid: …；high: …`.

##### R2-c. Team merge + card-review discussion per segment (`runR2Decision` `:7479-7492`, `:7525-7558`, `:7655-7745`)
After individual picks, `mergeSelectionsWithSelectedBy` (union, `:6239-6255`) forms the team draft. Segments: `expandCardSegmentsToSingletons(r2_card_segments)` (`:7268-7279`) → **6 singleton segments** (one per capability group, in config order), each a separate discussion (`decision_point: cards_<group_id>`). Opening moderator text (`:7525-7558`, non-humanPick):
```
${buildR2ContextPanel(r1Frozen, chosenPrototype)}

【团队合并草案】所有成员个人选卡已合并。当前团队草案：${cardsToText(selectedCards)}。
当前功能区合并草案：${cardsToText(cards in this group)}。
【当前功能区的个人意见】
${formatMemberSelectionSummary(individualSelections, groupMap, segment) || "（无）"}

当前只复核这些功能区：${formatGroupNames(segment, groupMap)}。每个功能区至少选 ${per_group_min} 张卡；全队最终累计总数至少 ${total_min} 张；无硬性总数上限。
可以保留个人合并草案，也可以基于讨论砍卡、补卡或调整档位；本段提交会替换该功能区的团队草案。

${groupText}
```
(+ optional moderator line `当前共选 ${n} 张卡，研发投入 ${wan}。` when >12 cards, `:6132-6135`). `per_group_min=1, total_min=6` (run_meta `selection_constraints`). `formatMemberSelectionSummary` entries: `${member_id}（负责：${groups}）` / `个人选卡：${cards}` / `备注：${rationale}`.
Discussion: topic `R2 选卡段 ${segmentIndex + 1}: ${group_id}`, `maxTurns = max_turns_r2_per_segment` (7), seed `${seed}:cards:${segmentIndex}`.
Leader submit (`:7678-7695`): topic `提交当前功能段最终选卡：${group}；本次提交会替换该功能段草案；${selectionRules}`, decisionType `cards`, constraints block (`submitConstraintText` `:1698-1707`):
```
【界面提交约束】
本次只能从下面真实卡片里点选；cap_id 必须逐字一致，禁止自己编 ID。
- cap_id=${cap_id}（${name}；group=${group_id}）…
tier 只能是 low / mid / high。
上一次界面错误提示：${compatibilityFeedback}      ← only on repair
```
Submit instruction: `当前要提交：${topic}\n请基于共享 transcript 已经说出口的论据代表全队提交。不要引用私人 context。自然语言总结，必须给出明确最终选择。` Then `RD.validateSelections`; on actionable compatibility violation (≤3 repair rounds) a moderator line `兼容性校验未通过：${feedback}。请只重议当前功能段，修正卡或档位，不能改变已冻结的前序段。` and a re-discussion with `maxTurns: 3` (`:7730-7742`); after 3 failures a deterministic UI guard (`applyDeterministicUiCardGuard`).

##### R2-d. Price (`:7875-7922`)
Opening moderator text:
```
${buildR2PricingContextPanel(r1Frozen, chosenPrototype)}

${buildR2PricingInterfacePanel(r1Frozen, selectedCards, priceConfig, { roomRoleplay: false })}

请像真实小组在这个界面前一样讨论最终售价：可以有人担心贵、销量下滑、渠道抽成或卖一台亏钱，但最后要收敛到一个可提交价格。
```
`buildR2PricingContextPanel` (`:6193-6202`): `【定价】` / `R1 冻结市场：…，产品定位：…` / `客户画像：…` / `需求标签：…` / `定价只需要基于已冻结市场和已选功能做最终提交，不要切换 ToB/ToC、年龄段或策略口径。`
`buildR2PricingInterfacePanel` (`:4786-4821`, roomRoleplay=false):
```
【界面：研发与定价决策 / 定价发布】
预期毛利率：${gm}%；提交按钮要求毛利率 ≥ 20%。
已选能力卡：${cap_id｜name｜tier（+¥dCOGS/台，研发X万）…}
已选 ${n} 张；dCOGS 合计 ${…}/台；NRE 合计 ${…}；单台总变动成本 ${…}（基础 ${base} + dCOGS）。
分功能区成本：${group}: ${dCOGS}/台 / NRE ${…}；…
Round 1 锚定市场：${grid_label}；SAM ${sam} 亿 / WTPadj ${wtp}。
价值主张对支付意愿的影响：${final}%（仅看 VP 本身 ${base}%，市场锦囊额外影响 ${jinang}%）。
【定价须知】
渠道成本：你们定的售价不等于到手收入。当前渠道抽成约 ${pct}%。
量价权衡：价格越高，每台赚得越多，但愿意买的用户越少；价格越低，用户越多，但可能卖一台亏一台。
产品力影响：产品能力组合越精准匹配目标场景，用户对价格的敏感度越低——好产品可以卖更贵。
【产品售价控件】
当前显示 ${default_price}；滑块最低 ${price_min}（低价走量），最高 ${price_max}（高端定位）。
按当前显示价格估算：渠道抽成后每台到手 ${…}；总固定成本 ${…}；盈亏平衡销量 ${…} 台；单台毛利 ${…}。
```
Rendered example (seed :01 simple): `预期毛利率：42%；… 已选 10 张；dCOGS 合计 +¥921/台；NRE 合计 275.8万；单台总变动成本 ¥1,521（基础 ¥600 + dCOGS）。… SAM 102 亿 / WTPadj ¥6,556。 … 渠道抽成约 15%。… 当前显示 ¥3,500；滑块最低 ¥2,000（低价走量），最高 ¥6,000（高端定位）。 … 盈亏平衡销量 2,929 台；单台毛利 +¥1,454。`
Discussion topic `"R2 定价"`, maxTurns 7, seed `${seed}:price`; leader submit topic `提交最终定价`, decisionType `price` (no constraint block; parser instruction carries `合法区间 ${priceMin}-${priceMax}`). **There is no separate pricing_action / pricing_tier stage in the benchmark line** — those decision types (`:1684-1697`) are only used by room-roleplay arms (`runPricingActionPersonaD5`). Settlement via `RD.calculate` (`:7930-7950`).

---

#### 3. Turn structure & call counts

Not "fixed 7 turns": every discussion runs `for turn=1..maxTurns` with a moderator convergence check after each turn and breaks on `converged`. Caps: R1 = 12 turns; each R2 decision point (prototype, 6 card segments, price) = 7 turns; compatibility re-discussion = 3. Speakers per turn = uniform{1,2} then willingness-weighted sampling without replacement (`pickSpeakers`). Per turn LLM calls = `team_size` willingness + (1–2) speak + 1 moderator.

Verified counts in `benchmark_team_rep2_20260816/SYN-…-simple-…:01` (layered :01 in parentheses):
- `r1_transcript.json`: 5 proposals (attempts all 1); 9 turns (12), speakers per turn 1,1,2,1,2,2,1,1,2; 13 (17) speaker items + 1 moderator opener; termination `converged` (`leader_decision` = hit cap); leader_submit attempts 1.
- `r2_transcript.json` items per decision_point (transcript items incl. moderator opener / turns): prototype 4/2 (4/2); individual_cards 1/0 (moderator summary only); cards_perception_understanding 3/1; cards_mobility_navigation 2/1; cards_interaction_expression 2/1; cards_safety_trust 2/1; cards_expand_connect 2/1; cards_ops_maintenance 3/1 (same for layered); price 9/5 (4/2).
- `r2_checkpoints.json`: 10 checkpoints (prototype, individual_cards, team_merge, 6× cards_*, price) — all 84 team runs.
- `r2_individual_card_attempts.jsonl`: 5 lines, all `status: ok` (5 members × 1 attempt).

LLM chat calls for that run (simple :01): R1 proposals 5 + 5 parser; R1 discussion 9×(5+1) + 13 speak = 67; R1 submit 1 + 1 parser; prototype 2×6 + 3 = 15; individual cards 5; 6 card segments: 6×(1×6) + 8 speak + 6 submit + 6 parser = 56; price 5×6 + 8 + 1 + 1 = 40 → ≈191 persona/moderator/parser calls (+ vpWordScorer).

Batch means over 42 teams (team5 rep2; simple / layered): R1 turns 7.9 / 7.4 (range 1–12; converged 64% / 69%); R1 speak calls 11.8 / 11.5; prototype turns 2.1 / 2.05; card segments 6/6 with total card turns 7.4 / 8.0 (range 6–14 → most segments converge in 1 turn); price turns 3.1 / 3.8 (range 1–7); card-attempt lines 5.05 / 5.00 (2 parse errors total in simple); compatibility re-discussions in 4 / 10 teams.

Individual batch (team_size 1; simple / layered): per turn = 1 willingness + 1 speak + 1 moderator; the single member is leader (`leader_willingness_boost` irrelevant) and submits. R1 turns 3.3 / 5.5 (converged 95% / 81%); prototype 2.7 / 3.1; card turns total 7.8 / 8.1; price 3.2 / 4.0; card-attempt lines exactly 1; all 6 groups assigned to the one member.

---

#### 4. Model / sampling params
- Provider `deepseek`, base `https://api.deepseek.com`, model `deepseek-v4-flash` for all roles (run_meta `model_config`), `LLM_DISABLE_THINKING=1` → request body `thinking: {type: "disabled"}` (`server/llm/deepseekClient.js:204`).
- Temperature 0.55 (preset override; config default also 0.55) for persona, parser and submit calls; moderator fixed 0.2.
- max_tokens: proposal 1500; willingness 80; speak 500; moderator 180; leader submit 1000 (repair 900); individual cards 1800; parser 900.
- Retries: HTTP level `maxRetries: 2` with exponential backoff `2000·2^attempt + rand(500)` ms, timeout 90 s (`deepseekClient.js:313-340`); application level: proposal ≤3 attempts, individual cards ≤3 attempts, leader submit `submit_parse_retries=2` repair rounds, compatibility ≤3 repair rounds then deterministic guard.
- Seeds: `makeRng(seed)` for member/leader sampling; `jinang:${seed}`; `discussion:${seed}:${topic}` for speaker count/pick; LLM outputs not reproducible (run_meta `seed_reproducibility_note`).

#### 5. simple vs layered — differences
- **Only the persona system text differs** (`formatProfile` branch): simple = id + surface (name/archetype label/gender/age/edu/overseas/MBTI/expression-style headline) + role line + 2 instruction lines; layered = the same surface **plus** the MBTI "思维特征" paragraph, archetype business fields (角色/行业经验/背景/决策风格/盲区/定价倾向), and `发言倾向` (high/mid/low from MBTI E/I), with a slightly different closing instruction ("…你自己的经验发言；不要输出隐藏模型分析" vs "…你自己的直觉发言。/ 不要把自己当研究助理…简短、自然、可以不完美").
- Same sampled members, leader, jinang draws, speaker-count RNG, prototype match and all user-side prompts/panels for a given seed (run_meta implementation note; verified identical speaker-count sequences).
- Same pipeline, caps, temperatures, max_tokens, parsers, settlement.
- Layered arm does **not** inject L0 seed_memory / L1 classroom profile or cognitive map (`arm_definition: "layered (deprecated partial)…"`); the preset alias to `team_layered_nomap` is recorded but not applied by `run_benchmark_team_simple_layered.js`.
- `archetype_label`/`desc` appear in both arms (simple still shows `原型：体制转型者（国企/政府背景出来的管理者）`).
