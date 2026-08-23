### Digest S2 — process prompts, verbatim (methods appendix source)

Worktree root for all `file:line` citations: `/Users/weiyang/worktrees/emba-ai-sim-v01-claude` (abbreviated `W/`).
Modules:
- `W/server/synthetic/teamSim/teamR1Cap24Sim.js` — team R1, arm `team_room_r1_actor_isolated_v1` (only arm in its `TEAM_ARMS`, line 27).
- `W/server/synthetic/teamSim/soloRoleplaySim.js` — solo R1, arm `team_room_r1_screenplay_v1` (`TEAM_ARMS` line 42; rebuilt from the 8/12 evidence code, tag `frozen/code-0812-solo-evidence`). **This is where solo R1 lives, not `teamR1Cap24Sim.js` or `orchestrator.js`.** Runner `W/scripts/analysis/run_solo_roleplay.js` (`SUPPORTED_ARMS` line 16), `team_size: 1`.
- `W/server/synthetic/teamSim/teamR2StoryScreenplaySim.js` — team R2 "B". `soloRoleplayV2Sim.js` is a **byte-identical copy except the header comment on line 2** (verified with `diff`), so every R2 citation below applies to both; the two lines differ only by arm + env flags.
- `W/server/synthetic/teamSim/teamR2CascadeProbeSim.js` — voice-probe copy + `runD5SequentialAction` (line 7628).
- Presets: `W/scripts/analysis/team_sim_presets.js`.
- Shared LLM wrapper: every `callText` is `chatCompletion(messages, { role: "chat_service", temperature, max_tokens, timeoutMs: 90000, maxRetries: 2, disableThinking: true })` (`teamR1Cap24Sim.js:1802-1811`, `teamR2StoryScreenplaySim.js:1970-1979`, `soloRoleplaySim.js:1686-1695`). `maxRetries: 2` is the transport-level retry (network/HTTP), separate from the prompt-level re-ask loops listed per stage.

#### 0. Presets, env flags, temperatures (`team_sim_presets.js`)

Common env (lines 11-18): `LLM_PROVIDER=deepseek`, `LLM_BASE_URL=https://api.deepseek.com`, `DEEPSEEK_MODEL=deepseek-v4-flash`, `LLM_CONCURRENCY=8`, `LLM_DISABLE_THINKING=1`, `DEEPSEEK_DISABLE_THINKING=1`.

| Line | Preset (lines) | Arm | Extra env | Locked config |
|---|---|---|---|---|
| Team R1 | `team_r1_taskblind_actor_isolated_v1` (21-62) | `team_room_r1_actor_isolated_v1` | `LLM_MODEL_OVERRIDE=deepseek-v4-flash`, `TEAM_SIM_HIDE_JINANG=1`, `TEAM_SIM_R1_STRATEGY_MODE=explicit_diff_cost_grid_button` | `team_size: 5, temperature: 0.55, max_r1_actor_events: 24`, `r1Only: true`, seed `20260813-taskblind-team-actor-r1r2-full42`, 42 teams. (The frozen batches `teamr1_cap24_rep{1..5}_20260815` have `preset: null` in run_meta but identical `config_snapshot`, `r1_actor_event_cap: 24`, `jinang_prompt_visibility: hidden_from_synthetic_prompts`.) |
| Solo R1 | **no preset entry**; batches `solo_r1_hidden_rep{i}_20260815` via `run_solo_roleplay.js` | `team_room_r1_screenplay_v1` | `TEAM_SIM_HIDE_JINANG=1` (run_meta `jinang_prompt_visibility: hidden_from_synthetic_prompts`, `r1_strategy_mode: explicit_diff_cost_grid_button`) | run_meta `config_snapshot`: `team_size: 1, max_turns_r1_discussion: 12, max_turns_r2_per_segment: 7, submit_parse_retries: 2, temperature: 0.55` |
| Team R2 B | `team_r2_story3_converge_v1` (102-125) | `team_room_story_d4_screenplay3_d5_v1` | `TEAM_SIM_HIDE_JINANG=1, TEAM_SIM_D5_IDEOLOGY=1, TEAM_SIM_D5_PRIVATE_STAGE=1, TEAM_SIM_D5_CONVERGE=1`; concurrency 3; control A = `TEAM_SIM_D5_CONVERGE=0` | temperature inherited from source run_meta (0.55); `max_turns_r2_per_segment: 7`; `submit_parse_retries: 2`; `r2_card_segments` three pairs, expanded to 6 singletons at runtime |
| Solo R2 v2Q | `solo_r2_v2q_perdim_reading_v1` (253-276) | `team_room_roleplay_ui` | `TEAM_SIM_HIDE_JINANG=1, TEAM_SIM_D4_PER_DIM=1, TEAM_SIM_D4_READING=1`; concurrency 3; control P = `TEAM_SIM_D4_READING=0` | same config (team_size 1) |
| Cascade probe | `team_r2_cascade_probe_v1` (214-225) | same as B + `TEAM_SIM_D5_SEQUENTIAL=1` | module `teamR2CascadeProbeSim.js` |

Note on the brief: the frozen **team** B preset does **not** set `TEAM_SIM_D4_PER_DIM`; per-dimension (one-group-per-call) individual picks exist only in solo v2Q. In team B each member is asked once for their two assigned groups (verified below: 5 rows in `r2_individual_card_attempts.jsonl`, each with two `groups`).

Temperature per call (all stages): the run temperature 0.55 unless a stage overrides it (extractors `min(0.1, T)`, writing-assist `min(0.25, T)`, moderator check fixed 0.2, biography-derived reading habit / pricing view fixed 0.4, D5 private stage fixed 0.6).

---

#### 1. Team R1 — `teamR1Cap24Sim.js`, arm `team_room_r1_actor_isolated_v1`

##### 1.0 Persona injection (used by every R1 call)

`formatTaskBlindNarrativePersona` (`teamR1Cap24Sim.js:832-841`); `formatR1UiProfile` (1540-1543) returns it unchanged for task-blind members:

```
姓名代号：${member.profile_id}
【人物小传】
${member.task_blind_biography}
${isLeader ? "你是组长，负责推进讨论并代表全队提交。" : "你是普通队员。"}
你现在就是小传中的这个人。像本人临场一样看界面、说话和行动，不要复述或分析小传，不要把自己变成顾问。
人物小传可能没有覆盖眼前问题；遇到没有经历支撑的地方，就按这个人当下会有的直觉、犹豫或误解处理。
```

For the actor-isolated discussion calls `formatR1IsolatedActorPersona` (2589-2595) rewrites the first and the role line:

```js
.replace(/^姓名代号：.*$/mu, `姓名：${publicName}`)
.replace(/你是组长，负责推进讨论并代表全队提交。/gu, "你和其他四个人是平等的讨论参与者；只是网页当前把鼠标和键盘操作权交给了你。")
.replace(/你是普通队员。/gu, "你和其他四个人是平等的讨论参与者；网页当前没有把鼠标和键盘操作权交给你，但你不需要等待任何人邀请才可以说话。")
```

(e) **Biography-only: yes** for team R1. No labels, no numeric traits, no voice cue (the `formatClassroomBehavior`/`personaVoiceCue` branch at 1563-1583 is only reached for non-task-blind members).

##### 1.1 R1 personal initial pick (pre-discussion, 1 call per member + 1 parser call)

`independentProposal` (`teamR1Cap24Sim.js:2250-2320`). System (hideJinang=1 branch, line 2256-2258):

```
${formatR1UiProfile(member, isLeader, arm)}

这次个人 UI 不显示锦囊卡；只根据页面可见内容和自己的临场判断操作。
```

User = `r1UiPersonalDraftPromptBody` (2031-2069) with `naturalStrategy=false`, `chatAskStrategy=false`, `hideJinang=true` (the rendered branch):

```
【Round 1 UI：个人选择页】
标题：选择你的战略定位。
说明：根据你对市场的判断，在下方地图上点击你认为最有机会的目标市场。
提示：这是你的个人初选，之后小组会看到所有人的选择，再一起讨论收敛。

差异化：靠独特体验或功能赢得用户，可以定更高价格，但目标人群更窄。
成本领先：靠性价比和规模赢得用户，价格敏感但人群基数更大。

市场地图上的 12 个可点击格子：
${gridList}

你希望这款 AI 宠物机器人在这个市场中主要靠什么打动用户？
体验型 ●：用户买的是情感价值和陪伴体验，功能够用就行。
混合型 ▲：体验和功能都是卖点，缺一不可。
功能型 ■：用户买的是实用功能，情感体验是锦上添花。

一句话价值主张草稿（选填）。
提示：尝试回答：给谁（WHO）、解决什么问题（PAIN）、怎么解决（HOW）。
输入框 placeholder：描述目标客户、核心痛点和解决方式……
提交按钮：提交我的选择。

你现在只是在操作上面这个 Round 1 UI。只根据页面可见文字和个人经验临场判断，不补充 UI 外的研究背景。
界面已经给出“选择什么战略取得竞争优势”的简短说明。你可以按页面短说明、自己的行业经验、课堂状态和当下理解去操作，也可以理解得不完全标准。
不要把“差异化/成本领先”扩展成 MBA 词典；像真人看界面一样，直接被某些词或格子牵着走。
先按“说话导演提示”写这个人的脑内话：词汇、句长、行业黑话、犹豫方式都要像 TA；不要把所有人都写成同一种理性分析口吻。
多数真人不会完整复盘 12 个格子和 3 个架构；只写这个人最先注意到的一两处，可以漏看、看错、嫌麻烦、图省事。
不要写 JSON，不要 Markdown，不要列表，不要标题；可以有半句话、改口、土话、公文腔、PPT 腔、PM 黑话或工程师吐槽。
最后用很自然的一句话带出你点了哪个市场格 id、哪个产品定位方向，以及草稿框里大概写了什么 WHO/PAIN/HOW；如果说 id，必须与上方按钮逐字一致。
长度按人设来：话少的人 60-120 字也可以，话多的人最多 240 字；不要为了显得完整而写成长篇报告。
```

(b) Injected: biography + the personal UI page text only. Firewall lines:
> 这次个人 UI 不显示锦囊卡；只根据页面可见内容和自己的临场判断操作。
> 你现在只是在操作上面这个 Round 1 UI。只根据页面可见文字和个人经验临场判断，不补充 UI 外的研究背景。

(c) Single-shot; no termination signal. (d) `callText(..., { temperature, maxTokens: 650 })` (2270); up to 3 attempts (`attempt 0..2`, 2268); each attempt is followed by a parser call `parseSubmission` (`submitParser.js:289-313`, `temperature` = run T, `max_tokens: 900`) with system `你是商业模拟提交解析器。只抽取发言中明确提交的内容，不补充、不猜测、不代填。只输出 JSON。` and user `抽取 Round 1 最终提交。输出 JSON：{"grid_id":"12格之一","architecture":"Experience|Hybrid|Function","vp_summary":{"who":"...","pain":"...","how":"..."},"rationale":"..."}。合法 grid_id：${GRID_IDS}\n\n组长发言：\n${text}`. Re-ask system on failure (2290-2293): `${formatR1UiProfile(...)}\n你仍然只是在操作 Round 1 UI，不要输出 JSON。`, user lists the error, `请像真人被同伴追问一样，用自然话补一句：你到底在 UI 上点哪个市场格、哪个产品定位方向，草稿框写给谁、痛点是什么、怎么做。`, the legal grid ids, `产品定位方向按钮只能是 Experience（体验型）、Hybrid（混合型）、Function（功能型）。`, `不要 JSON，不要列表。`, then `你刚才说：${lastRaw}`. After 3 failures: `throw independent_proposal_r1_ui_parse_failure`.
Observed: rep1 team :02 → 5 members × 1 attempt (`r1_ui_screen_process.json` attempts `[1,1,1,1,1]`); batch mean 5.07 attempts per team ⇒ ~10.1 calls (draft + parser).

##### 1.2 Public environment narrator (0 LLM calls)

`createR1ActorPublicEnvironment` (2597-2612): **deterministic** text, `source: "deterministic_environment_only"`; selection phase `投影屏显示小组战略分布页：五份个人初选已经公开，组长操作区的市场格、产品定位和继续按钮位于页面下方。...`, VP phase `投影屏显示价值主张页面，WHO、PAIN、HOW 三个输入框和提交按钮排列在页面中。...`. 2 rows in `r1_actor_isolated_public_environment.jsonl`.

##### 1.3 Private protagonist state (1 call per member per phase = 10 per team)

`createR1ActorPrivateState` (2614-2658). System:

```
你是贴着一个人物行动的第三人称旁白。你只知道下面这一个人的人生和他亲眼看到、亲耳听到的内容。
不要替小组预告结局，不要判断商业上什么最好，也不要知道其他人的内心。
只有人物小传里的经历属于这个人。别人公开讲过的经历只能写成‘他刚听某人说’，绝不能移植成这个人自己的父母、项目、客户或回忆。
只写没说出口的内在状态，不替人物公开发言，不写引号台词，不写他已经开口补充了什么。
写的是这个人此刻身体和心里发生的具体状态，不是心理测评或决策标签。
```

User:

```
【这个人】
${formatR1IsolatedActorPersona(member, isLeader)}

【他自己的个人初选】
${ownProposal.grid_id}/${ownProposal.architecture}；WHO=${...who}；PAIN=${...pain}；HOW=${...how}

【他现在看到的页面】
${screenText}

【到目前为止公开说出口的话】
${heardTranscript || "（讨论刚开始，还没人说话）"}

<selection> 写 80-180 字的私有主人公状态：他先看见什么、是否在意自己的初选被别人看见、想不想开口、想起了哪段真实经历、哪里没把握。不要替他决定团队最后选什么。
<vp>        页面刚切到 WHO/PAIN/HOW。写 80-180 字的私有主人公状态：他如何理解刚才的选择、此刻想补哪句话、是否还挂念被放弃的东西。不要替他写团队最终答案。
只写自然叙事正文，不要 JSON、标题、列表或分析。
```

(b) Injected: biography, own initial pick, screen text (1.6), last 8 public transcript entries (`formatR1ActorPublicTranscript(transcript, members, 8)`, 3924). Firewall:
> 你只知道下面这一个人的人生和他亲眼看到、亲耳听到的内容。
> 只有人物小传里的经历属于这个人。别人公开讲过的经历只能写成‘他刚听某人说’，绝不能移植成这个人自己的父母、项目、客户或回忆。

(d) `maxTokens: 360`, run T, single attempt, no validation (raw trimmed). Observed 10 rows (5 selection + 5 vp).

##### 1.4 Entrance decision (private, 1 call per "camera check"; ~88 per team)

`callR1ActorEntranceDecision` (2782-2901). System:

```
${formatR1IsolatedActorPersona(member, isLeader)}
你只为这一个演员做一次私下的临场动作判断，不写其他人的行为，不替小组规划讨论，也不知道最后结果。
这不是老师点名，也不是轮到你必须贡献内容；现在只是有人刚说了一句话、页面刚变了一下，或现场安静了几秒，镜头扫到你看你会不会自然接话。
只对这一件刚发生的公共事件反应一次。没有被触发就沉默，不要为了补全小组答案而开口。
只有眼前内容真正碰到这个人的经历、利益、困惑或他已经公开显示的个人选择时，才选择公开发言。当前暂存项与自己的判断冲突，也可能是自然开口的理由；不能为了完善答案、推进流程或显得参与而开口。
<leader && allowOperate> 操作网页和公开发言是两件事。组长可以一句话不说就实际改变暂存项、填写草稿或点击继续；也可以只说话而不碰网页。鼠标在手不是操作理由，重复点击当前已暂存的同一按钮不产生任何动作。
<else>                    这次镜头只判断沉默或公开发言，不发生网页操作。
组长只是唯一能碰网页的人，不是主持人、老师或更权威的决策者。普通成员不需要等组长点名、提问、停手或把页面填完才开口。
市场格和产品定位在点击继续前都只是网页里的暂存状态，不是已经形成的结论。任何人都不应仅因为组长点亮了一个按钮，就把继续比较理解成拆台或太迟。
${pageBoundary}
<selection> 如果你此刻想说的是按钮、报告、功能实现、交付、运维、指标或价值主张措辞，但不要求改变市场格或产品定位，这一页最自然是先不说，等进入后续页面。
一个具体疑问、半句话、没把握的反对、个人经历中的小片段都算真实发言动机；不要把‘还没形成完整方案’自动判成沉默。反过来，也不要为了参与而硬凑新案例。
判断依据是人物与此刻现场，不是商业答案质量。输出是私下拍摄决定，不会进入共享 transcript。
```

`pageBoundary` selection (2797-2804): `当前还在市场格与产品定位选择页。这一页只需要判断：当前暂存的市场格或产品定位要不要改。` / `WHO/PAIN/HOW 的具体措辞、功能清单、交付节奏、验收指标、运维、渠道和实施细节属于后续页面；除非它们会直接使你要求改换市场格或产品定位，否则不要在这一页继续展开。` / `如果你能接受当前暂存项，又没有尚未公开的新改选理由或疑问，这一页对你已经没有新话可说，最自然的是保持沉默。` / leader: `如果市场格和产品定位都已暂存，你此刻也不打算改选或继续说，只有你能点击继续进入下一页；这是一项网页操作，不是宣布所有人内心一致。` non-leader: `组长点击继续以前你仍可反对；但没有真实反对时，不要为了拖住页面而延伸实施细节。`
`pageBoundary` vp (2806-2813): `当前在 WHO、PAIN、HOW 页面。只讨论和填写这三个框；市场格与产品定位已经由上一页锁定。` / `如果三个框已经准确承接了你在意的内容，又没有新的具体修改意见，就不必重复赞同或继续扩写。` / `如果你只是认可别人刚说的 VP 方向、没有要改某个框的一句具体文字，最自然是沉默。不要把 WHO/PAIN/HOW 扩成产品方案会。` / leader `提交按钮只有在三个框都非空时可用；有空框就先填写或修改，三个框都能用且你没有新修改时，才可能点击提交。` non-leader `没有新的三框修改意见时，保持沉默即可。`

User:

```
【只给演员看的主人公状态】
${privateContext}

【他自己的个人初选】
${grid}/${arch}；WHO=…；PAIN=…；HOW=…

【眼前页面】
${screenText}

【刚发生、需要你反应的一件事】
${triggerContext || "这是这一阶段开始时看到页面后的第一次自然反应机会。"}

【本阶段公开发生过的全部发言，按时间】
${formatR1ActorPhaseTranscript(transcript, members, phase)}

【你在本阶段已经公开说过的全部话】
${ownPublicHistory}
这些话不能换种说法再说一遍；只有眼前出现了尚未表达的新反应，才值得再次开口。
别人已经公开讲清楚的观点也属于现场记忆；即使你也赞同，只是换个人再说一遍也不算新的反应。

【当前公共停顿】此前连续 ${quietBeatStreak} 个镜头没有出现新的实质内容。
<leader && allowOperate> 你是握鼠标的组长。只有此刻真要首次点选、改选、填写/修改文字、点击继续或点击提交，才选‘操作界面’；重新点击当前同一选项不算操作。不要为了操作硬编一句发言，选择沉默则什么按钮都不会被系统代点。
<leader, no operate>     你虽然握着鼠标，但这次只是听到别人或刚看到页面后的自然反应镜头；要不要真正操作会在现场安静后再判断。
<non-leader>             你是普通成员。公开发言才会生成台词；保持沉默可以包括点头、看屏幕或走神，但不会向别人传递私有理由。
只用一句简短自然中文写这个人为什么在这一秒沉默、发言或操作，不写剧本、不展开经历、不分析团队终局。最后必须单独写且只选一个：
【行动】保持沉默
【行动】公开发言
<leader && allowOperate> 【行动】操作界面
```

`privateContext` (2788-2795): for the member's first two checks in a phase: `下面仍是这个阶段开始时只属于你的主人公状态。它没有因为你上一次沉默而消失，但时间已经往前走了；不要机械重复其中的回忆或措辞。\n${privateState}\n结合眼前页面和后来真正公开发生的内容，只判断这一秒会不会自然开口或操作。`; afterwards: `这个阶段开始时的第一阵冲动已经过去。你自己的个人初选仍显示在下方；不要重新调用同一段回忆或为了有话可说临时搜索新案例，只判断眼前这一秒。`

(b) Injected: biography, private state (only first 2 checks per phase), own pick, screen text, trigger, **full phase transcript** (clipped 12000 chars), own prior lines. Firewall:
> 判断依据是人物与此刻现场，不是商业答案质量。输出是私下拍摄决定，不会进入共享 transcript。
> 公开发言才会生成台词；保持沉默可以包括点头、看屏幕或走神，但不会向别人传递私有理由。

(c) The **model decides** speak / silent / operate via the `【行动】` marker (`parseR1ActorEntranceDecision` 2774-2780: regex `/【行动】(?:保持)?沉默\s*$/`, `/【行动】(?:公开)?发言\s*$/`, `/【行动】(?:操作界面|操作)\s*$/` leader+allowOperate only; otherwise `throw "entrance decision missing the final action marker"`).
(d) `maxTokens: 260`, run T, 2 attempts; attempt 2 appends `刚才末尾动作标记缺失。不要重写理由，只根据刚才已经表达的临场倾向，单独补一行合法【行动】标记。`; after 2 failures `throw`. A system-forced speaker (1.8) skips this call and logs `status: "forced_by_system_fallback"`.
Observed team :02: 92 rows (71 silent, 11 speak, 8 operate, 1 error, 1 forced). Batch mean 88.4 (46-146).

##### 1.5 Actor performance (1 call per speak/operate event; ≤24 events per team)

`callR1IsolatedActor` (2903-3031). System:

```
${formatR1IsolatedActorPersona(member, isLeader)}

你现在只扮演这一个人。你不知道别人心里在想什么，也不知道这场讨论最终会怎样。
不要替其他成员写台词，不要当主持人，不要总结整场会议，不要追求一个漂亮完整的答案。
别人讲过的家庭、客户和工作经历属于别人；你可以回应，但绝不能改写成自己的回忆。
不要每次复述刚才所有观点，也不要重复自己已经讲过的完整理由。每次只推进眼前一个很小的反应。
你已经听过下方本阶段的完整公开记录。别人讲清楚过的观点不能换成你的口吻再讲一遍；赞同但没有新增内容时可以不说。
镜头落到你身上不等于老师点名。先判断这个人此刻是否真的会开口；没有新的、非重复的东西时，最真实的演法通常是点头、沉默、看屏幕、走神或让别人继续，不能为了生成内容临时搜索一个新案例。
不要套用‘这个我认，但我再补一个’的接话模板。听到一个意见不等于必须赞同，也不等于必须追加细节。
你的内心已写在私有主人公状态里，其他人听不见。输出时绝不能写‘我心里想’、回忆浮现、脑子里转、觉得但没说等内心旁白。
只写讨论室里别人能直接看到的动作，以及你真正说出口的原话。公共场合只称呼姓名，不说 TBNxx 之类内部 id。
使用剧本台词格式：可见动作只能写在全角括号（ ）里，真正说出口的话只能写在中文引号“ ”里。括号外和引号外不得有任何叙述。
你只回应此刻真实听到的话和眼前页面。人物可以前后矛盾，也可以没有贡献。
```

User:

```
【只给你看的主人公状态】
${privateContext}            # phaseTurnNumber===1 ? privateState : "阶段开始时的那次内在冲动已经过去，也可能已经体现在你先前的动作或发言里。不要重新调用同一段回忆、案例或担心；现在只从眼前页面、最近公开现场和你自己已经说过的话继续反应。"

【你自己的个人初选】
${grid}/${arch}；WHO=…；PAIN=…；HOW=…

【眼前页面】
${screenText}

【刚发生、你正在回应的一件事】
${triggerContext || "这一阶段刚开始，你正在根据眼前页面自然开口或操作。"}

【本阶段公开发生过的全部发言，按时间】
${formatR1ActorPhaseTranscript(transcript, members, phase)}

【你自己先前公开说过的话】
${ownPublicHistory}

${phaseInstruction}
<if operateRetryNote> 【上一镜作废，重演同一刻】${operateRetryNote}
${selectionBoundary}
${vpBoundary}
<operate> 写这一刻公开发生的一个界面操作。用括号内的可见动作明确写出点了哪个合法按钮，或在哪个输入框写入/改成了什么原文；如果是 WHO/PAIN/HOW 操作，必须逐字写出输入框里的最终文字，不要只写‘敲了一行字’或‘删掉重打’；这一镜不要加台词。
<speak>   写这一刻公开发生的一小段自然剧本文字：一个括号内的可见动作，加 1-3 句中文引号内的短口语。这个人本来很话多时可以稍长，但不要写完整分析文章。
合法形态示意只有格式意义：（低头转了转笔。）
“这块我没想明白，你们先说。” 不要照抄这句话。
不要解释他为什么这么说，不要写没说出口的部分。
如果发生界面操作，必须在自然叙述里明确写出点了什么、输入了什么；没有操作就不要补操作。
不要 JSON、标题、列表、actor 标签、后台字段或研究说明。
```

`phaseInstruction` (2908-2920): operate/selection with both staged: `你刚才已经私下决定这一秒操作界面。市场格和产品定位都已经暂存；这一镜只演你点击继续，或明确改成另一个不同的市场格/定位。重复点击当前相同的市场格或定位没有效果，不要演停在按钮上犹豫。`; operate/selection not both staged: `你刚才已经私下决定这一秒操作界面。这一镜只演你首次点选或实际改选中的一个有效操作；不要改成继续讨论，也不要替操作补理由。重复点击当前相同的市场格或定位没有效果，不能拿它充当一次操作。`; operate/vp all filled: `你刚才已经私下决定这一秒操作界面。WHO、PAIN、HOW 都已有文字；这一镜只演你点击提交，或明确改写某一个输入框的最终文字。不要演空泛犹豫。`; operate/vp not filled: `你刚才已经私下决定这一秒操作界面。这一镜只演你实际输入/覆盖 WHO、PAIN、HOW 中一个或多个字段；必须写出输入框最终文字，不要只写敲了一行字。`; speak/leader: `你刚才已经私下决定这一秒只公开发言。这一镜可以追问、回应或说自己的看法，但不能碰鼠标、键盘、按钮或输入框；要操作留到另一个真实时刻。`; speak/non-leader: `你刚才已经私下决定这一秒公开发言。你可以插话、追问、坚持、改口或跑偏；你不能操作组长区域。只说此刻真会说的话。 `
`selectionBoundary` (2921-2927): `这一页只聊两件事：市场格选哪个、产品定位选 Experience/Hybrid/Function 哪个。` / `如果你要开口，台词里必须清楚落到：支持当前暂存、反对当前暂存、建议改成某个市场格/定位，或提出会影响这两个选择的疑问。` / `不要在这一页展开按钮、报告、功能实现、运维、渠道、交付或 WHO/PAIN/HOW 措辞；这些留到后续页面。`
`vpBoundary` (2928-2934): `这一页只写 WHO、PAIN、HOW 三个框。` / `如果你开口，台词里要给出一个具体改法：WHO 应该怎样改、PAIN 应该怎样改、或 HOW 应该怎样改。` / `不要展开技术实现、市场渠道、投资人话术或完整产品方案；如果只是认可方向、提醒风险但不给字段改法，就沉默。`

(b) Injected: biography, private state (only this member's first event per phase), own pick, screen text, trigger, full phase transcript, own prior public lines. Firewall:
> 你现在只扮演这一个人。你不知道别人心里在想什么，也不知道这场讨论最终会怎样。
> 别人讲过的家庭、客户和工作经历属于别人；你可以回应，但绝不能改写成自己的回忆。
> 你的内心已写在私有主人公状态里，其他人听不见。输出时绝不能写‘我心里想’、回忆浮现、脑子里转、觉得但没说等内心旁白。
> 只写讨论室里别人能直接看到的动作，以及你真正说出口的原话。公共场合只称呼姓名，不说 TBNxx 之类内部 id。

(d) `maxTokens: 320`, run T, 3 attempts (re-ask appends `刚才的版本不能成为公开 transcript：${lastError}。只重演同一刻，把内心、解释和内部代号留在私下；公开输出只能是别人看得到的动作和带引号的真实台词。`); after 3 rejections the deterministic `projectR1ActorPublicRaw` salvage (2733-2758) is applied and logged as `public_projection_salvage`. Observed team :02: 22 rows = 20 ok + 2 rejected(operate) ⇒ 20 accepted events. Batch mean 21.5 rows (11-34).

Validation `validateR1ActorPublicRaw` (2660-2711), all deterministic:
- `/\bTBN\d+\b/` → `public performance exposed an internal persona id`.
- Stage directions = everything inside `（…）`/`(…)`; private markers regex list `/脑子里/,/心里/,/心头/,/内心/,/暗自/,/没说出口/,/浮现/,/回忆起/,/想起/,/想到(?:的是|了)/,/意识到/,/盘算/,/琢磨/,/这个我认/` inside a stage direction → `public performance exposed private narration`.
- Text outside parentheses (`stripR1ParentheticalContent` 2713-2731) and outside `“…”`/`"…"` quotes, after stripping punctuation, must be empty → `public performance must contain only parenthesized visible action and quoted speech`.
- In speak mode a UI-operation regex on stage directions (`(?:鼠标|光标|指针).{0,160}(?:点击|…|提交)|(?:按钮|格子|输入框|选项).{0,60}(?:点击|…)|(?:点击|…).{0,60}(?:按钮|格子|输入框|选项)`) → `speech performance crossed into a UI operation`.
- Operate/selection: explicit `继续` click combined with grid/architecture clicks → error; operate/vp: explicit `提交` with empty WHO/PAIN/HOW → error.

##### 1.6 Screen text (deterministic, rebuilt every loop)

`buildR1ActorIsolatedSelectionScreen` (2546-2571) — includes every member's public pick `成员X（name / 组长）；目标市场：…；产品定位方向：…`, `分布洞察卡：…`, and the firewall-ish page rule:
> 组长负责点击，但这只是网页权限，不代表组长的意见比其他成员更权威。普通成员只能口头讨论，不能操作组长区域。课堂里没有主持人逐一点名，成员要说话只能自己接话或插话。
> 未点击继续以前，暂存选项只是组长操作区当前显示的按钮状态，不代表团队已经同意，也不阻止任何成员提出不同意见。

`buildR1ActorIsolatedVpScreen` (2573-2587): `页面有 WHO、PAIN、HOW 三个输入框。组长可以输入、修改并点击提交；普通成员只能口头讨论。这只是网页权限，不代表其他成员要等组长邀请才说话。` plus current WHO/PAIN/HOW contents.

Trigger texts `r1ActorTriggerContext` (3380-3423): `phase_open` selection `这一页刚打开，屏幕同时显示五个人的个人初选和组长操作区。每个人都能直接看到彼此分歧。`, vp `页面刚切到 WHO/PAIN/HOW。上一页选定的方向显示在页面顶部，三个输入框还是当前状态。`; `response` `刚才 ${speaker} 在公开讨论中发生了这一小段：\n${clipText(trigger.text, 900)}…只判断你这个人听到/看到这件事后会不会自然接一句；如果没有被触动，不要另起一个新话题。`; `leader_operation` `刚才这件事之后，其他人没有再自然接话，现场安静了几秒。` + UI-state line + next-step hint.

##### 1.7 UI-event extractor (1 call per leader operate event; temperature ≤0.1)

`extractR1ActorUiEvent` (3296-3355); non-leader → deterministic `action: none` without a call. System:

```
你是课堂网页的事后操作记录器，只索引文本中已经明确发生的组长界面动作。
不能根据观点、倾向、建议、共识或商业合理性推断点击。没有明确操作就记 none。
evidence_quote 必须逐字复制原文中直接证明动作发生的短句。只输出 JSON。
```

User:

```
当前阶段：${phase}
当前 UI 状态：${JSON.stringify(uiState)}

组长这一刻的原文：
${raw}

<selection> 只允许 action=none|edit_selection|continue_to_vp。
            仅明确写出点击/选择某个市场格或定位按钮才是 edit_selection；仅明确写出点击继续/进入下一页才是 continue_to_vp。
            grid_id 必须来自合法 id；architecture 必须是 Experience/Hybrid/Function。
<vp>        只允许 action=none|edit_vp|submit_r1。
            仅明确写出在输入框输入/修改文字才是 edit_vp；仅明确写出点击提交才是 submit_r1。
            只抽取原文实际写入或提交的 WHO/PAIN/HOW；没写的字段留空。
schema：{"action":"none|edit_selection|continue_to_vp|edit_vp|submit_r1","evidence_quote":"原文逐字短句","grid_id":"","architecture":"","vp_summary":{"who":"","pain":"","how":""}}
```

(d) `temperature: Math.min(0.1, temperature)`, `maxTokens: 550`, 2 attempts, then falls back to `action: none` with `extraction_error`. Output is re-checked deterministically by `normalizeR1ActorUiEvent` (3211-3294) against click evidence regexes (`r1ActorExplicitButtonClickEvidence`, `r1ActorClickedSelectionControls` 3033-3203). If the entrance decision was `operate` but the indexed action is `none`, the actor call is re-shot **once** with `operateRetryNote` = `你刚才那一镜没有落下任何可索引的真实界面动作：没有点中任何合法按钮，也没有逐字写出某个输入框的最终文字。重演这一刻，在括号动作里把操作写实——点击时逐字写出按钮标签（例如 点击市场格“ToB_DIFF_ELDER”、点击产品定位“Hybrid”、点击“继续”按钮、点击“提交”按钮），输入时逐字写出该输入框的完整最终文字。仍然只演这一个操作。` (4074-4078). `applyR1ActorUiEvent` (3425-3437) mutates the deterministic UI state; `continue_to_vp` only when grid+architecture both set; `submit_r1` only when WHO/PAIN/HOW all non-empty. Observed :02: 8 extractor rows.

##### 1.8 Fallback speaker picker (≤1 call per team, temperature ≤0.1)

`chooseR1ActorFallbackSpeaker` (3807-3870), used only when the selection phase's opening queue ends with no non-leader substantive line. System: `你是后台选角记录器，只判断这一秒最可能打破沉默的非组长是谁。` / `不要写台词，不要替小组决定结论，不要选择组长。` / `优先选择：个人初选和屏幕暂存/多数分布冲突、私有状态里有犹豫或真实经验被触发、或者最可能用自己的口吻说出一个具体疑问的人。` / `只输出 JSON。` User: phase, UI state, phase transcript, candidate lines (`member_id=…；姓名=…；个人初选=…；本阶段已公开发言次数=…；私有状态=${clipText(privateState, 700)}`), `schema：{"member_id":"...","reason":"..."}`. `maxTokens: 260`, 2 attempts, then deterministic seeded pick (`deterministicR1ActorFallbackSpeaker`). The chosen member skips the entrance call (`forced_by_system_fallback`) and performs with trigger `system_selected_speaker`: `这一页刚打开后，其他非组长都没有自然接出实质内容，屏幕上的分歧还停在那里。…镜头这次停在你这里。你不用主持全组，也不用给漂亮总结，只按你这个人此刻最自然的方式先说一句。` Observed :02: 1 row; batch 34 rows / 42 teams.

##### 1.9 Termination rule (who ends R1)

`runR1ActorIsolatedDiscussion` (3872-4327). Loop condition (3907): `while (phase !== "submitted" && eventIndex < eventCap && entranceCheckIndex < entranceCheckCap)`. Comment at 3883: `// This is an API runaway guard, not a convergence rule; if reached, the leader must submit through a final public scene.` Constants: `eventCap = 24` (`max_r1_actor_events`), `entranceCheckCap = max(eventCap * max(3, n+1), n*4) = 144`, `deadlineLeaderEventAt = eventCap - max(2, ceil(n/2)) = 21`. Normal end: the leader's own `submit_r1` UI event (`phase = "submitted"`). At event 21 a screen cue is pushed (`课堂时间快到提交前的收口点了。页面不会替小组改写，但组长现在需要把 WHO、PAIN、HOW 的最后版本填好，或提交当前版本。`) and the leader gets a `deadline_leader_operation` entrance check. No moderator/convergence classifier exists in this arm. If the cap is hit unsubmitted → 1.10.

##### 1.10 Timeout forced public submission (leader only; 13/42 teams in rep1)

`callR1ActorTimeoutForcedSubmission` (3556-3653). System:

```
${formatR1IsolatedActorPersona(leader, true)}

你只扮演握鼠标的组长。课堂时间快到，大家的目光自然落回屏幕和你手边的鼠标。
你根据刚才公开讨论的情况临场提交 Round 1：可以坚持自己的判断，也可以顺着别人说过的话调整；不要把它演成投票统计。
继续保持剧本形式：可见动作写在全角括号（ ）里，说出口的话写在中文引号“ ”里。括号外和引号外不得有叙述。
不要写 JSON、字段名说明、研究解释、内心独白或其他人的台词。
<selection> 如果还在市场格/定位页，你可以先明确点选或沿用当前市场格和定位，点击继续，然后在 WHO/PAIN/HOW 三个输入框写入最终文字，最后点击提交。每个最终输入框文字都要在可见动作里逐字出现。
<vp>        如果已经在 WHO/PAIN/HOW 页，你可以改写任一输入框或沿用当前文字，但最后必须在公开动作里点击提交。每个被改写的最终输入框文字都要逐字出现。
可以用一两句很短的口语收口，但最后提交必须是可见网页操作，不是系统默认填值。
```

User: `【只给你看的主人公状态】${privateState || "（此前没有额外私有状态，只按你的人物设定和现场反应。）"}`, `【你自己的个人初选】…`, `【屏幕上可见的五个人个人初选】${formatR1ActorTimeoutProposalLines}`, `【眼前页面】${screenText}`, `【当前 UI 暂存】${JSON.stringify(uiState)}`, `【已经公开发生过的内容】${formatR1ActorPublicTranscript(transcript, members, 14)}`, `镜头里不需要写分析过程；只让你的最后动作像是根据刚才讨论的情况临场提交。`, `【收口提示】已经到第 ${eventIndex} 个公开事件、第 ${entranceCheckIndex} 次入场判断，event_cap=${eventCap}。现场像课堂时间快结束那样自然收住，大家等你把屏幕上的版本交出去。你作为组长，现在像真人在界面上那样当场提交一个 Round 1 决策。`, `输出一段公开剧本。不要解释为什么，不要分析任务，不要生成 JSON。`
(d) `maxTokens: 1150`, run T, 3 attempts; each attempt validated (`timeout_forced_submit` mode) then passed to `extractR1ActorTimeoutSubmission` (3494-3554; `min(0.1,T)`, `maxTokens: 620`, 2 attempts) whose system says `当前 UI 状态只是屏幕可见内容；只有原文明确说“按当前/就这个/不改并提交”时，才可沿用当前 UI 已经非空的值。` and whose user ends with `WHO、PAIN、HOW 必须是最终提交框里的文字；如果原文没有写出且也没有明确沿用当前 UI，不要自行补。`. Failure after 3 → `throw r1_actor_isolated_timeout_forced_public_submission_failed_after_3_attempts` (these are the teams that went to the `_retry` batch).

##### 1.11 AI writing assist (1 call per team, temperature ≤0.25)

`runR1ActorIsolatedWritingAssist` (3664-3768). System:

```
你是课堂界面的 AI 写作辅助，只把组长已经填进 Round 1 页面的 WHO/PAIN/HOW 草稿整理成更清楚的提交文本。
你不是战略决策者：禁止改变 grid_id 或 architecture，禁止新增 transcript 与草稿没有支持的客户、痛点、功能、渠道、付费方或场景。
禁止使用价格、金额、成本、利润、WTP、SAM、GM、隐藏模型指标或财务测算。
保留团队原意，可以让 WHO/PAIN/HOW 更具体、更顺、更像课堂界面可提交的话。
只输出可 JSON.parse 的 JSON。
```

User: `【固定选择，不可更改】grid_id=…\narchitecture=…`, `【组长输入框初稿】WHO=…\nPAIN=…\nHOW=…`, `【公开讨论记录】${clipText(last 80 transcript entries, 14000)}`, `组长：${name}`, `请输出整理后的最终提交。schema：{"grid_id":"...","architecture":"Experience|Hybrid|Function","vp_summary":{"who":"...","pain":"...","how":"..."},"rationale":"..."}`.
(d) `temperature: Math.min(0.25, T)`, `maxTokens: 900`, 3 attempts (`validateParsed("r1")` + `assertR1WritingAssistKeepsChoice`: grid/architecture must be unchanged); after 3 failures `failed_fallback_to_draft` (draft used verbatim). Observed 41/42 ok in rep1 (one dir without state file = retried team).

##### 1.12 Team R1 call count (team :02, cap24 rep1)

| call type | count in :02 | batch rep1 mean |
|---|---|---|
| personal draft + parser | 5 + 5 | 10.1 |
| private states | 10 | 10 |
| entrance decisions | 91 (+1 forced, 0 calls) | 88.4 |
| actor performances | 22 (20 ok + 2 rejected) | 21.5 |
| UI extractors | 8 | 6.2 |
| fallback speaker | 1 | 0.8 |
| timeout submission (+extractor) | 0 | 13/42 teams (≥2 calls each) |
| writing assist | 1 | 1 |
| **total** | **≈143** | **≈140** |

---

#### 2. Solo R1 — `soloRoleplaySim.js`, arm `team_room_r1_screenplay_v1`, team_size 1

Flow: 1 personal draft (identical code to §1.1 — `independentProposal` `soloRoleplaySim.js:2134`, `r1UiPersonalDraftPromptBody` 1915-1973 verified identical by diff; +1 parser call), then **one** screenplay call replaces the discussion.

##### 2.1 R1 screenplay (single writer call)

`runR1ScreenplayDiscussion` (`soloRoleplaySim.js:3185-3418`). System:

```
你是一个场记式编剧。你的任务不是给商业建议，而是按 Round 1 UI 写出真实 EMBA 课堂小组讨论的一幕。
每个角色只能按自己的人设、UI 上看到的个人初选、课堂状态和理解偏差说话或行动。
不要使用当前 UI 之外的信息；本幕只承接个人 UI 选择页和当前小组 UI。
台词第一优先级是人物声音：每个演员都必须按自己的“说话导演提示”说话，允许公文腔、土话、PM 黑话、工程师吐槽、销售画面感或中英文夹杂。
不要把上一轮发言当成公共记事本逐条复述，不要写 moderator，不要写优化报告，不要把所有人都写得同样聪明或同样积极。
可以有人沉默、跑题、插话、没听懂、想显得厉害、怕麻烦、被别人一句话带走，最后自然收束到一次界面提交；不要把这些差异改写成工整总结。
只输出可 JSON.parse 的 JSON。
```

User (rendered branch: `naturalStrategy=false`, `hideJinang=true`):

```
【演员表】
${actorSheet}

【当前 UI 屏幕】
${screenText}

【编剧任务】
写 Round 1 从“小组战略分布”到“确定小组最终选择”再到“撰写价值主张”的这一幕。
角色只能围绕 UI 上可见的目标市场、产品定位方向、WHO/PAIN/HOW 输入框讨论；不要引入当前页面之外的信息或研究背景。
界面已经给出“选择什么战略取得竞争优势”的简短说明。角色如果提到“差异化/成本领先”，只能来自 UI 短说明、自己的个人草稿、锦囊和现场理解；不要替全组扩展成 MBA 词典。
这不是会议纪要，也不是商业分析报告；像写剧本一样写台词和动作。不要把“每个人先依次陈述一遍”写成固定格式，不是每个人都必须发言。
不要让角色朗读合法选项清单，不要让角色像主持人一样总结全部维度。角色可以只抓住自己在意的一两个词。
每句 line 都要像真人现场说出来的短台词，不要写成段落分析；同一个演员可以只说半句、接别人一句、或者用自己的行业词把按钮翻译错。
不要因为某种措辞听起来顺，就自动替换成固定按钮；让角色按自己在个人草稿里已经形成的理解争论和点击。
final_submission 表示最后有人在界面上提交；grid_id 必须是合法按钮 id，architecture 必须是 Experience / Hybrid / Function，WHO/PAIN/HOW 不能为空。
final_submission 的台词和 rationale 必须和 grid_id 的策略一致：*_DIFF_* 就说差异化，*_COST_* 就说成本领先；不要嘴上说成本领先却提交 DIFF id，也不要嘴上说差异化却提交 COST id。
actor 字段只能填写演员表里的真实成员 id：${legalActorIds}。不要发明 Rxx、成员A 或姓名代号。
不要输出 Markdown，不要输出额外说明。schema：
{"scene_state":"一句场景状态","beats":[{"actor":"上面列出的真实成员 id","stage_direction":"动作/神情","line":"台词，可为空","ui_action":null}],"final_submission":{"actor":"上面列出的真实成员 id","stage_direction":"动作/神情","line":"最终提交前说的话","grid_id":"12格之一","architecture":"Experience|Hybrid|Function","vp_summary":{"who":"...","pain":"...","how":"..."},"rationale":"..."}}
```

Actor sheet `formatR1ScreenplayActorSheet` (3041-3060), screenplay-arm branch:

```
【演员 ${profile_id}${leader ? " / 组长" : ""}】
${formatR1UiProfile(member, isLeader, arm)}          # = biography block (§1.0) for task-blind members
UI 上公开可见的个人初选：${gridLabel} (${grid_id})；${archSymbol} ${archLabel} (${architecture})
个人选择页当场写下的 VP 草稿和操作过程（只作为这个演员自己的连续性，不是全员公共文本）：${clipText(proposal.raw, 420)}
课堂状态：${formatClassroomBehavior(member, isLeader, { includeCalculation: false })}
当前主观状态：注意点=${attention_focus}；信心=${confidence.toFixed(2)}；困惑=${confusion.toFixed(2)}；疲劳=${fatigue.toFixed(2)}。
```

(e) **Not biography-only**: in addition to the biography block the sheet carries `课堂状态：发言量：…；任务心态：…；表现动机：…；相关性控制：…；小组位置：…；互动倾向：…` (`formatClassroomBehavior` 1130-1141, labels from `classroomBehaviorProfile`) and four numeric subjective-state values. Verified against the real file `runs_v4flash_0731/team_pilot/solo_r1_hidden_rep1_20260815/…:01/r1_screenplay_prompt.json` (e.g. `课堂状态：发言量：正常发言；任务心态：正常完成任务；表现动机：正常参与；相关性控制：偶尔发散；小组位置：看时机插话；互动倾向：正常回应` / `当前主观状态：注意点=先看市场和用户是否说得通；信心=0.73；困惑=0.41；疲劳=0.25。`). This matches PERSONA_METHODS.md §117/132 ("仅 solo R1").

Screen text `buildR1TeamUiPanel` (2984-3040): three UI pages concatenated in one prompt (小组战略分布页 with the public pick list and `分布洞察卡`, 确定小组最终选择 with `差异化：…/成本领先：…` short explanations and `继续按钮：请先确定团队的目标市场和产品定位。`, 撰写你的价值主张 with WHO/PAIN/HOW guides and `如果不是组长，页面提示：组长正在操作，你可以口头讨论。`).

(b) Firewall:
> 不要使用当前 UI 之外的信息；本幕只承接个人 UI 选择页和当前小组 UI。
> 角色只能围绕 UI 上可见的目标市场、产品定位方向、WHO/PAIN/HOW 输入框讨论；不要引入当前页面之外的信息或研究背景。

(c) Termination: none — the writer ends the scene itself with `final_submission`; `termination: "r1_screenplay_final_submission"`, `mode: "single_pass_screenplay_without_shared_transcript"` (3330-3344). No turn cap, no moderator.
(d) `maxTokens: 4200`, run T, 3 attempts (3267); retry user (3376-3399): `上一版 R1 剧本没有被界面接受。` / `界面/解析提示：${lastError}` / `请重写完整剧本，仍然按演员人设写，不要改成商业报告。` / legal ids, `合法 grid_id 只能是：…`, `architecture 只能是 Experience / Hybrid / Function。`, `final_submission 必须完整包含 grid_id、architecture、vp_summary.who、vp_summary.pain、vp_summary.how、rationale。`, `只输出 JSON。`, `上一版 raw：${lastRaw}`. After 3 → `throw r1_screenplay_parse_failure`.
Post-processing `validateR1Screenplay` (3101-3146): ≥3 beats (`r1_screenplay_beats_must_include_at_least_3`), every `actor` must normalize to a real member id, `final_submission` object required, parsed through `validateParsed("r1")` (grid in 12 ids, architecture normalized, WHO/PAIN/HOW non-empty), and `assertR1ScreenplayStrategyTextMatchesGrid` (DIFF/COST wording must match the grid id). Transcript rendering `r1ScreenplayTranscript` (3164-3183): `（stage_direction）line（界面动作：…）`.

Solo R1 call count per unit: 1 draft + 1 parser + 1.43 screenplay attempts (rep1 mean; max 3) ⇒ **≈3.4 calls**.

---

#### 3. Team R2 "B" — `teamR2StoryScreenplaySim.js`, arm `team_room_story_d4_screenplay3_d5_v1`

Order inside `runR2Decision` (10758→): prototype (D3) → `prepareD4ReadingHabits` → individual picks → conflict board (deterministic) → 6 D4 screenplay segments → deterministic D5 card-review state → `prepareD5PersonaLayer` → 3 D5 scenes.

##### 3.0 Persona injection and R1 memory carried into every R2 call

- `formatProfile(member, isLeader, arm)` → `formatTaskBlindNarrativePersona` (`teamR2StoryScreenplaySim.js:925-934`, same six lines as §1.0).
- `formatR1ActorCarryoverForPrompt` (1464-1480) — **present in every R2 prompt** (individual pick, D4 sheet, D5 sheet, speak, leaderSubmit):

```
【R1 延续记忆】
这是你上一轮在市场/VP界面留下的个人连续性；其他人不知道你的私有状态。不要逐字念出来，也不要把它当价格锚点。
市场选择页当时的私有状态：${clipText(selection_private_state, 520)}
VP页当时的私有状态：${clipText(vp_private_state, 520)}
团队最终提交：${grid_id}/${architecture}；WHO=…；PAIN=…；HOW=…
```

- R1 public memory `buildR1PublicMemory` (10142-10158): tail of member-spoken R1 lines, 220 chars each, ≤1600 chars, injected into D5 scenes and `speak`/`leaderSubmit` (set at 11608).
- Behavioural numeric state (`ensureBehavioralState`, restored from source run_meta `behavioral_state_initial`) is also printed in the D4/D5 actor sheets — see (e) notes below.

##### 3.1 D3 prototype reading discussion (not in the brief, but it costs calls)

`chooseR1MatchedPrototype` (≈6230): prototype is **deterministically matched** to the frozen R1 grid (no choice). Then `runDiscussion` (≈4850-4945) with `maxTurns = max_turns_r2_per_segment = 7`: per turn `pickRoomSceneBeats` (deterministic seeded scheduler, 1-2 speakers + optional non-verbal line) → `speak()` per speaker → `moderatorCheck`. Moderator ends it (`converged: true`) or the 7-turn cap (`termination: "leader_decision"`).
`speak` (4592-4641) system: `${formatProfile}${ideology}\n\n${r1Carry}\n\n私有 context：\n${formatJinang(draw)}\n你的会前提案：${grid}/${arch}，${rationale}${cardStakeContext}${stateContext}` where `stateContext = formatBehavioralState(...)` for this (stateful) arm prints `【当前主观状态】注意力/信心/困惑/疲劳/敷衍/公开承诺压力/价格敏感` bands. User: `${r1Public}共享 transcript：\n${formatTranscript(transcript)}\n\n当前议题：${topic}\n${roomInstruction}` with a beat instruction (`roomBeatInstruction` 4537-4560, e.g. `short_view: "只说一个短观点或直觉，1句，最多补半句理由。"`) and beat note `你的课堂状态：${labels.engagement}，${labels.status}，${labels.relevance}。当前状态：…`. `maxTokens` by beat kind 70-180 (`roomBeatMaxTokens` 4561-4568). Output post-processed by `sanitizeRoomSpeech` (strip leading `name:` prefix, up to 3 passes) + `clampRoomSpeech` (sentence/char clamp by beat).
`moderatorCheck` (≈4761-4777): system `你是团队模拟 moderator。只判断讨论是否已足够收敛，不给建议、不暗示正确答案。`, user `当前议题：${topic}\n共享 transcript：…\n\n是否已经足够收敛，可以让组长提交？只输出 JSON：{"converged":true|false,"reason":"..."}。`, `temperature: 0.2`, `maxTokens: 180`.
Observed team :02: 5 turns (`converged`); batch rep1 mean 4.82 turns, 6.82 speak calls ⇒ ≈11.6 calls.

##### 3.2 D4 reading habit (1 call per member, temperature 0.4)

`prepareD4ReadingHabits` (7637-7649), runs because `d5IdeologyEnabled()` (flag `TEAM_SIM_D5_IDEOLOGY=1`; `TEAM_SIM_D4_READING` not needed). System:

```
你只根据下面这个人的小传，用一两句话说出：他在网页上看一排产品能力卡（每张卡旁边标着单位成本和研发投入）时，会怎么读——他更在意的是功能够不够全、有没有漏，还是花了多少钱；是逐项算成本再定档位，还是扫一眼数字主要看功能名，还是基本不看成本那一栏；以及他对技术/后台类功能是内行、半懂，还是外行。用他自己经历里的事说明为什么（比如做市场、做产品的人多半盯功能，做财务、做采购的人多半盯成本，但以他的小传为准）。不要分析，不要列点。
```

User: `【人物小传】\n${member.task_blind_biography}`. `temperature: 0.4, maxTokens: 120`; output truncated to 160 chars; no retry. Observed 5 rows/team (42/42).

##### 3.3 D4 individual card pick — team B: `individualCardStorySelection` (1 call per member, two groups per call)

(9247-9367; selected because `hasD4StoryPickArm(arm)` 1063). System:

```
${formatProfile(member, isLeader, arm)}

${formatR1ActorCarryoverForPrompt(member)}

你现在不是在做产品经理最优解，而是在演这个人如何读一个真实网页界面。允许漏看、误读、顺手点、嫌麻烦、被卡片名字吸引。
```

User:

```
${formatJinang(draw)}

${buildR2ContextPanel(r1Frozen, chosenPrototype, { omitResearchDetail: true })}

【界面：个人选卡前的短剧本】
你负责的维度：${formatGroupNames(assignment.groups, groupMap)}。
${d4StoryLens(member, isLeader, assignment)}

你先写一段短剧式私有行动轨迹：你怎么扫界面、先注意到什么、误解或跳过什么、最后手上具体点了哪些卡。
重要：这不是事后解释最优方案；你后面的个人选卡只会从 action_trace 里 action=select 的项确定。不要为了显得完整而补齐产品底座。
action_trace 至少 3 条；可以全是 select，也可以有 skip / hesitate；至少 1 条 select。select 必须给 tier。

【你的 Round 1 会前提案】
${proposal.parsed.grid_id}/${proposal.parsed.architecture}：${proposal.parsed.rationale}
【你负责维度的能力卡】
${groupText}
【合法 cap_id 清单】
${formatAllowedCardsForPrompt(allowedCards)}
只输出可 JSON.parse 的 JSON，不要 Markdown，不要额外文字。schema：
{"scene_state":"你此刻的状态","attention_path":"你如何扫界面","misread_or_skip":"你误解/跳过了什么","inner_line":"一句内心独白","action_trace":[{"action":"select|skip|hesitate","cap_id":"真实cap_id","tier":"low|mid|high|null","stance":"must|nice|impulse|unsure","confidence":0到1,"reason":"一句自然话"}],"public_stance":"你可能会在小组里怎么说","ignored_groups":[],"doubts":[],"rationale":"一句话总结这次手上动作"}
```

`d4StoryLens` (8646-8686) when `d4_reading_habit` is set renders:
```
你读这页的习惯（从你的经历看）：${member.d4_reading_habit}
功能观：${taskBlindInferFeatureDoctrine(member.behavioral_fingerprint, member.role)}
显著性偏好：${seededPick([...5 options], seed)}
${isLeader ? "组长身份会让你更想给出能收口的选择，但不代表你看懂所有卡。" : "你不是组长，不需要替全队补齐完整产品方案。"}
```
`buildR2ContextPanel` with `omitResearchDetail` (8527-8546): `【战略背景】R1 冻结市场：…，产品定位：…/R1 WHO/PAIN/HOW/【客户调研 / 痛点提醒】客户画像：${label}/讨论和选卡必须围绕以上冻结市场、客户画像和痛点，不要切换 ToB/ToC、年龄段或策略口径。`

(e) **Not strictly biography-only in the frozen team-B D4 pick** (verified in `…:02__r2_replay/r2_individual_cards.json` `submissions[0].prompt`): the user prompt contains (i) the two 锦囊 cards (`formatJinang` is unconditional here, 1750-1755 — `TEAM_SIM_HIDE_JINANG` only gates the R1 prompts), (ii) `功能观：…` derived from the 8-dim fingerprint, (iii) a seeded `显著性偏好：…` line. The system prompt is biography + carry-over only.
(b) Firewall: R1 carry-over header `其他人不知道你的私有状态。不要逐字念出来，也不要把它当价格锚点。`; the lens `你不是组长，不需要替全队补齐完整产品方案。`
(c) Single shot. (d) `maxTokens: 2400`, run T, 3 attempts; retry system `${formatProfile}\n你必须修正为合法短剧本 action_trace。不要引入新 cap_id 或 tier。`; user lists error, allowed groups/ids, `action_trace 至少 3 条；…select 的 tier 只能是 low/mid/high。`, schema, `上一次输出：${lastRaw}`. After 3 → `throw individual_card_story_parse_failure`.
Post-processing `validateD4StoryTrace` (8694-8756): only `action=select` entries become cards; cap_id must be in the member's assigned groups; tier ∈ low/mid/high; stance/confidence normalized; ≥1 select. `d4_own_selection_note` (10842-10850) = `你刚才在自己那页点的是：${cap@tier…}` + `当时心里那句话：“${inner_line.slice(0,80)}”` (used later in speak/leaderSubmit for non-screenplay arms).
Observed :02: 5 rows, each 1 attempt, groups e.g. `['interaction_expression','safety_trust']` (assignments 6 groups over 5 members → 2 groups each, overlapping). Batch mean 5.02.

##### 3.4 D4 six-segment screenplay review (1 writer call per segment; 6 segments + compatibility repairs)

Segments: `expandCardSegmentsToSingletons(config.r2_card_segments)` (10970) → the six capability groups in order **perception_understanding, mobility_navigation, interaction_expression, safety_trust, expand_connect, ops_maintenance** (order from `r2_card_segments = [[perception_understanding, mobility_navigation],[interaction_expression, safety_trust],[expand_connect, ops_maintenance]]`).

`runD4ScreenplaySegment` (9826-9987). System:

```
你是一个场记式编剧。你的任务不是给商业建议，而是按演员人设续写真实 EMBA 讨论室里的一幕。
每个角色只能按自己的人设、疲劳、面子、理解偏差和刚才个人选卡残留行动；可以沉默、敷衍、跑题、误会、临时改口。
不要写 moderator，不要写讲解，不要写优化分析。只输出可 JSON.parse 的 JSON。
```

User:

```
【演员表】
${actorSheet}

【当前屏幕】
${screenText}

【合法 cap_id 清单】
${formatAllowedCardsForPrompt(allowedCards)}

【编剧任务】
继续写 D4 第 ${segmentIndex + 1} 格能力卡复核这一幕。角色们围着同一台电脑看当前功能区能力卡，像真人一样说话和动手。
actor 字段只能填写演员表里的真实成员 id：${legalActorIds}。不要发明 Rxx、成员A 或姓名代号。
至少 4 个 beat，最多 10 个 beat；不是每个人都必须说话，可以有人只做动作或没展开。
如果有人在界面点卡，写 ui_action={"type":"select_card","cap_id":"真实cap_id","tier":"low|mid|high"}。
如果有人取消某张卡，写 ui_action={"type":"unselect_card","cap_id":"真实cap_id"}。
如果有人改档，写 ui_action={"type":"change_tier","cap_id":"真实cap_id","tier":"low|mid|high"}。
最终当前功能区必须至少有一张卡停留选中；不要另写 final_cards，最终卡只由 UI 动作后界面状态决定。
不要输出 Markdown，不要输出额外说明。schema：
{"scene_state":"一句场景状态","beats":[{"actor":"上面演员表里的真实成员 id","stage_direction":"动作/神情","line":"台词，可为空","ui_action":{"type":"select_card|unselect_card|change_tier","cap_id":"真实cap_id","tier":"low|mid|high"}|null}]}
```

Actor sheet `formatD4ScreenplayActorSheet` (9768-9785), per member:

```
【演员 ${profile_id}${leader ? " / 组长" : ""}】
${formatProfile(member, isLeader, "team_room_story_d4d5_v1")}        # biography block
他自己在 R1 的个人初选（公开过）：${member.r1_own_proposal}
${formatR1ActorCarryoverForPrompt(member)}
D4 当前格私有状态：${groupName}：自己原先点=${own_cards}；当前位置=${last_segment_position || "还没表态"}；成本不适=${cost_discomfort.toFixed(2)}；坚持度=${ownership_commitment.toFixed(2)}     # only for members assigned this group
当前状态：注意点=${attention_focus}；信心=${confidence.toFixed(2)}；疲劳=${fatigue.toFixed(2)}。
```

Screen `buildD4ScreenplayScreen` (9787-9824): `buildR2ContextPanel` (full research detail here — 人物/机构, 情境, 关键场景, 主要痛点, 需求标签), `【界面：D4 能力卡复核页】`, `团队合并草案：…`, `当前功能区合并草案：…`, `【当前功能区的个人意见】` (each responsible member's picks + 备注), `【D4 冲突板】` (`formatD4ConflictBoardForPrompt` 8926: per card `bucket=consensus_keep|lone_advocate|…；支持=TBNxx/tier/stance/conf=…；未点=…；原话理由=…`, `成员犹豫：…`), optional `【界面提示】上一版动作没有被界面接受：${compatibilityFeedback}。只改当前功能区，不要改前序已冻结功能区。`, `当前只复核这些功能区：${groups}。${selectionRules}` (`每个功能区至少选 1 张卡；全队最终累计总数至少 6 张；无硬性总数上限。`), `可以保留、取消、补选或改档；最终当前功能区停留在界面上的卡会替换该功能区草案。`, then the group's card table.

(e) Sheet = biography + R1 public pick + R1 carry-over + **numeric D4/behavioural state lines** (verified in `r2_d4_screenplay_prompts.jsonl` row 0 of team :02, e.g. `成本不适=0.59；坚持度=0.82` and `信心=0.74；疲劳=0.36`). No labels/voice cues.
(b) Firewall: only the carry-over header (`其他人不知道你的私有状态…`). The writer is omniscient over all five sheets by design (single-writer screenplay).
(c) Termination: writer decides beats (4-10) within one call; segment accepted when deterministic compatibility check passes.
(d) `maxTokens: 3600`, run T, 3 parse attempts per call (retry user: `上一版 D4 剧本没有被界面接受。` / `界面/解析提示：${lastError}` / `请从这个界面提示后继续写一版完整 D4 剧本，仍然按演员人设，不要写商业分析。` / `必须包含至少一个合法 UI card action，最终当前功能区至少保留一张卡；只输出 JSON。` / ids / `上一版 raw：`). Outer loop (11012-11080): up to **4 repair rounds** (`repairRound 0..3`) when `RD.validateSelections` finds actionable compatibility violations; feedback pushed as screen entry `兼容性校验未通过：${compatibilityFeedback}。界面提示小组只重议当前功能段，不能改变已冻结的前序段。`; at round 3 `applyDeterministicUiCardGuard` (10085) fixes cards (`termination: "screenplay_ui_guard"`) else `throw compat_violation`.
Post-processing `validateD4Screenplay` (9649-9744, via `parseD4ScreenplayJson` 9630): actor normalization, ui_action type/cap/tier normalization (`inferD4ScreenplayAction` 9595 can infer from line text/aliases), replays actions onto the segment's card state; final cards = UI state after actions; `最终当前功能区必须至少有一张卡`. Then `updateD4CardStateAfterSegment` (9113) updates each member's numeric D4 state deterministically.
Observed :02: 7 rows = 6 segments + 1 compatibility repair (`cards_perception_understanding` repair_round 1); batch mean 6.33 (6-9).

##### 3.5 D5 private stage (per member: 1 pricing-view call + 1 three-step call = 10 calls per team)

`prepareD5PersonaLayer` (7651-7711), gated by `TEAM_SIM_D5_IDEOLOGY=1` and `TEAM_SIM_D5_PRIVATE_STAGE=1`.

Call A — pricing view (7671-7677), system:

```
你只根据下面这个人的小传，用一句话说出：这个人经手产品定价时，一贯是哪一种人——往低了定、先卖出去再说的人；往高了定、保证利润的人；还是跟着身边参照走的人。先明确说是哪一种，再用一句他自己经历里的事说明为什么。不要分析，不要列点。
```
User `【人物小传】\n${biography}`; `temperature: 0.4, maxTokens: 80`, truncated to 80 chars.

Call B — the "three private steps" are **one call** (7679-7697). System: `${formatTaskBlindNarrativePersona(member, false)}\n定价上你一贯的看法：${member.d5_pricing_view}`. User:

```
【眼前页面】
${costPanel}          # buildR2PricingActionPersonaPanel (6546-6558)

小组还没开始讨论。你先自己在纸上把这三步走一遍：
第一步：定价动作——A 压低售价抢量，还是 B 抬高售价守毛利？
第二步：相对档位——高 / 中 / 低？
第三步：具体售价——${price_min} 到 ${price_max} 之间的一个整数。
每步一句人话理由。最后只输出可 JSON.parse 的 JSON：{"action":"A|B","tier":"high|mid|low","price":整数,"why":"一两句"}
```

`costPanel` text: `【界面：产品售价】/已冻结市场：…；架构：…/WHO/PAIN/HOW/已选能力卡：…/成本区可见：基础成本 ¥…，能力增量成本 ¥…，研发投入 …万。这些只是界面信息，不要求逐项复述。/界面显示的价格滑块范围：¥… 到 ¥…；步长不作为决策提示。/请只按这个界面能看到的信息、前面团队已确定的市场和选卡来定价；不要使用界面外的隐藏公式，也不要把讨论变成财务报告。`
(b) Injected: biography (as non-leader), pricing view, the D5 page. No transcript, no teammates. Firewall:
> 小组还没开始讨论。你先自己在纸上把这三步走一遍
> 请只按这个界面能看到的信息、前面团队已确定的市场和选卡来定价；不要使用界面外的隐藏公式
(d) `temperature: 0.6, maxTokens: 220`, **no retry**: if JSON/values invalid the member simply has no `d5_private_stage` (then `d5IdeologyLine` falls back to inner price if any, else nothing). Observed :02: 5 rows all with a private stage; batch mean 4.88 rows.

The result enters every later D5 prompt through `d5IdeologyLine` (7620-7635):

```
定价上你一贯的看法（从你的经历看）：${d5_pricing_view}
你自己的价格参照（真实经历）：${persona_pool_record.frozen_facts.price_reference_history}
你私下已经在纸上填好的：${action} / 档位${tier} / ${price} 元（${why}）——说不说、改不改，看你自己
```

##### 3.6 D5 three-scene screenplay (3 writer calls per team) + converge rule

`runD5ScreenplayStagedPricing` (7549-7610) → `runD5ScreenplayScene` (7496-7547). System (same as D4 writer but `刚才选卡残留`):

```
你是一个场记式编剧。你的任务不是给商业建议，而是按演员人设续写真实 EMBA 讨论室里的一幕。
每个角色只能按自己的人设、疲劳、面子、理解偏差和刚才选卡残留行动；可以沉默、敷衍、跑题、误会、临时改口。
不要写 moderator，不要写讲解，不要写优化分析。只输出可 JSON.parse 的 JSON。
```

User skeleton:

```
【演员表】
${actorSheet}

【上一轮 R1 页面上这几个人公开说过的话（他们都在场，节选）】
${r1Public}
【这一页上此前已经发生的对话】        # scenes 2-3 only
${priorTranscriptText}
【当前屏幕】
${screenText}

【编剧任务】
${taskLines…}
至少 3 个 beat，最多 8 个 beat；不是每个人都必须说话。可以有空台词或只做动作。
不要输出 Markdown，不要输出额外说明。schema：
${schemaLine}
```

Actor sheet `formatD5ScreenplayActorSheet` (7163-7178):

```
【演员 ${id}${leader ? " / 组长" : ""}】
${formatProfile(member, isLeader, "team_room_story_d4d5_v1")}        # biography block
他自己在 R1 的个人初选（公开过）：${r1_own_proposal}
${d5IdeologyLine(member)}                                             # §3.5 three lines
${formatR1ActorCarryoverForPrompt(member)}
D5 私有复盘：${review.value_feel}；${review.cost_feel}；${review.speaking_angle}      # deterministic seedD5CardReviewState (6604)
自己原先点过的卡：${own_cards}；最终保留：${own_retained_cards}
当前状态：注意点=…；信心=…；疲劳=…；价格敏感=…。
```

Scene 1 screen (7556): `${basePanel}\n\n【D5 第一步：定价动作】\n现在小组站在产品售价滑块前，先讨论定价动作，不提交具体价格。\nA：压低售价抢量。意思是用相对更低的售价换更多用户愿意买，不追求单台高毛利。\nB：抬高售价守毛利。意思是接受销量可能少一些，用相对更高售价覆盖能力成本和渠道抽成，保护单台毛利。\n组长在这一步点选 A 或 B。`
Scene 1 task lines (7559):
```
写 D5 第一步这一幕：角色们围着同一台电脑，先说各自更偏压价抢量还是抬价守毛利；这一步不报具体价格，不复述成本金额。
[CONVERGE] 这一幕的收尾不是折中：最后被采纳的是其中一个人的主张——别人被说服了、或让步了、或组长就认他的；不要把几个人的说法取一个中间值。组长按被采纳的那个人的选择操作页面。
幕末必须有组长的界面动作：ui_action={"type":"choose_action","value":"A|B"}。
```
schema `{"scene_state":"一句场景状态","beats":[{"actor":"Rxx","stage_direction":"动作/神情","line":"台词，可为空","ui_action":{"type":"choose_action","value":"A|B"}|null}]}`; retryHint `这一幕必须以组长点选 A 或 B 收尾（ui_action type=choose_action，value 只能是 A 或 B），其他人不能操作页面。`

Scene 2 screen (7569): `${basePanel}\n\n【D5 第二步：相对档位】已选定价动作：${pricingAction}。\n现在讨论相对档位：高 / 中 / 低。这一步仍不报具体价格。\n组长在这一步点选 高 / 中 / 低。` Task lines: `写 D5 第二步这一幕：承接刚才定下的定价动作，说各自觉得该放在高、中、低哪个档位；不报具体价格。` + same CONVERGE sentence + `幕末必须有组长的界面动作：ui_action={"type":"choose_tier","value":"high|mid|low"}。`

Scene 3 screen (7582): `${basePanel}\n\n【D5 第三步：最终价格】已选定价动作：…；已选档位：…。\n价格滑块范围 ¥… 到 ¥…。组长拖动滑块并确认。` Task lines (7585):
```
写 D5 第三步这一幕：承接前两步定下的动作和档位，角色们像真人一样说话和动手，最后落到一个具体售价。
[CONVERGE] 最后落的数不是折中出来的：是其中一个人报的数赢了——别人被说服、或让步、或组长就认他的；组长按那个人的数拖滑块并确认，不要在几个人的数之间取中间。
滑块边界在界面上可见，但不要让角色在台词里复述上下限；也不要把中点、上下限当默认答案。
如果某人动手拖价格，写 ui_action={"type":"drag_slider","price":数字}；如果最终停住/确认，写 ui_action={"type":"confirm_price","price":数字}。
```

**Converge rule** = the two `[CONVERGE]` sentences above, emitted only when `d5ConvergeRuleEnabled()` (`TEAM_SIM_D5_CONVERGE` ∈ 1/true/yes/on, 7612-7614). Control A omits them; nothing else differs.

(b) Injected per scene: all five sheets (biography + private stage + R1 private states), R1 public memory, prior D5 scene transcript, the screen. Firewall: carry-over header; `说不说、改不改，看你自己`; page rule `请只按这个界面能看到的信息…`.
(c) Termination: writer decides (3-8 beats); scene accepted when validator finds the leader's required `ui_action`.
(d) `maxTokens: 2600`, run T, 3 attempts (retry user: `上一版这一幕没有被界面接受。` / `界面/解析提示：${lastError}` / `${retryHint}` / `请从这个界面提示后继续写一版完整的这一幕，仍然按演员人设，不要写商业分析；只输出 JSON。` / `上一版 raw：`), then `throw d5_screenplay3_${scene}_parse_failure`.
Post-processing: `validateD5ChoiceScene` (7471-7494): ≥3 beats; actor must be a member; a `choose_action`/`choose_tier` ui_action from a non-leader → `only the leader can operate the page`; value must be in the allowed set; missing → `screenplay must contain the leader's … ui_action`. `validateD5Screenplay` (7226-7277): prices parsed via `screenplayPriceFromAction` (7188); out-of-range prices are kept as `rejected: true` beats (`价格超出范围，滑块没有停住`); final price = last `confirm_price` if any else last legal `drag_slider`. Any actor may drag in scene 3 (validator does not require the leader).
Observed :02: 3 rows (action/tier/price, 1 attempt each); batch mean 3.0 (0-5; 0 = team failed earlier).

##### 3.7 Team B call count (team :02)

| stage | calls | file |
|---|---|---|
| D3 prototype discussion | 5 turns → ≈5-7 speak + 5 moderator ≈ 11 | `r2_transcript.json[prototype]` |
| D4 reading habit | 5 | `d4_reading_habits.jsonl` = 5 |
| D4 individual pick | 5 | `r2_individual_card_attempts.jsonl` = 5 |
| D4 screenplay | 7 (6 segments + 1 repair) | `r2_d4_screenplay_attempts.jsonl` = 7 |
| D5 private stage | 10 (5 view + 5 three-step) | `d5_persona_layer.jsonl` = 5 rows |
| D5 scenes | 3 | `d5_screenplay3_attempts.jsonl` = 3 |
| **R2 total** | **≈41** | |

---

#### 4. Solo R2 v2Q — same module, arm `team_room_roleplay_ui`, env `TEAM_SIM_D4_PER_DIM=1 TEAM_SIM_D4_READING=1`

Arm predicates: `isRoomRoleplayArm` true; **not** stateful, **not** story-pick, **not** screenplay, **not** human-pick ⇒ plain `individualCardSelection`, `runDiscussion` + `leaderSubmit` for D4 review and for D5 (`runPricingActionPersonaD5`). No D5 ideology / private stage (flags unset).

##### 4.1 D4 reading habit — identical prompt to §3.2 (gated by `TEAM_SIM_D4_READING=1`), 1 call.

##### 4.2 D4 per-dimension individual pick (6 calls, one group each)

Loop at 10804-10829: `perDim = TEAM_SIM_D4_PER_DIM && assignment.groups.length > 1` → one `individualCardSelection` per group with `assignment: { ...assignments[i], groups: [groupId] }`; results merged (`per_dimension_calls: parts.length`). `individualCardSelection` (9369-9518). System:

```
${formatProfile(member, isLeader, arm)}

${formatR1ActorCarryoverForPrompt(member)}        # empty for solo (source R1 is screenplay arm, no private states)

以下锦囊是你的私有信息，只能影响你自己的判断，不要假装别人知道。
```

User (rendered branch: roomRoleplay, not humanPick, not pricingActionActor):

```
${formatJinang(draw)}

${buildR2ContextPanel(r1Frozen, chosenPrototype, { includeReportExcerpt: true })}

【你读这页的习惯（从你的经历看）】${member.d4_reading_habit}
【界面：个人选卡】
你负责的维度：${groupName}。
根据调研结果和你的判断，把你认为产品应该具备的能力都选上，再选择合适的档次。
至少选择 1 张；具体张数、卡片和 low/mid/high 档位由你决定。
界面会显示单位成本、研发投入和团队投入说明，便于你在能力与成本之间取舍。
【你的 Round 1 会前提案】
${grid}/${arch}：${rationale}
【你负责维度的能力卡】
${groupText}
【合法 cap_id 清单】
${formatAllowedCardsForPrompt(allowedCards)}
请像真人在个人选卡界面前一样，先用几句话说你为什么点这些卡、哪些卡你有点犹豫。
最后单独写一行【我的个人选卡提交】，并给出可索引 JSON：
{"cards":[{"cap_id":"真实cap_id","tier":"low|mid|high"}],"rationale":"一句自然话说明你的取舍"}
```

Verified against `…solo_r2_v2Q_rep1…:01__r2_replay/r2_individual_cards.json` (6 submissions, `per_dimension_calls: 6`, `parse_method: direct_json`). (e) System prompt = biography block only (+ jinang note); user carries 锦囊 + full research excerpt + the reading-habit line (biography-derived by LLM) — no fingerprint labels (the `d4StoryLens` doctrine/salience lines are **not** used in this path).
(d) `maxTokens: 1800`, run T, 3 attempts; retry system `${formatProfile}\n你必须修正为合法个人选卡提交，不要引入新 cap_id 或 tier。`; parsing is deterministic `parseJsonLoose` + `validateIndividualCards` (9204-9237; cap in assigned group, tier valid, ≥1 card). Observed :01: 6 rows, 1 attempt each; batch mean 6.07.

##### 4.3 D4 review segments (6 segments; 1 turn each typically)

Non-screenplay branch (11113-11200): `runDiscussion` (§3.1 mechanics, `maxTurns 7`) with the moderator entry (10981-11002): context panel, `【团队合并草案】所有成员个人选卡已合并。当前团队草案：…`, `当前功能区合并草案：…`, `【当前功能区的个人意见】…`, `当前只复核这些功能区：…。${selectionRules}`, `可以保留个人合并草案，也可以基于讨论砍卡、补卡或调整档位；本段提交会替换该功能区的团队草案。`, card table. Per turn: 1 `speak` (system adds `${cardStakeContext}` = `d4_own_selection_note`) + 1 `moderatorCheck`. Then `leaderSubmit` (≈5349+): system `${formatProfile(leader,true,arm)}\n\n${leaderPrivateContext}` (for room arms: carry-over, R1 public memory, `私有 context：${formatJinang}`, `你的会前提案：…`, `d4_own_selection_note`), user `共享 transcript：…`, `submitConstraintText("cards")` (`【界面提交约束】本次只能从下面真实卡片里点选；cap_id 必须逐字一致，禁止自己编 ID。…tier 只能是 low / mid / high。`), and the instruction block `当前要提交：${topic}` / `请像组长在界面前准备点提交一样收口，最多两句口语化说明，然后单独写一行【最终提交】给出明确选择。` / `不要用自己的姓名/编号开头。别人没说出口的东西你不知道，不能当论据。`; `maxTokens: 650`; then `parseSubmission` (LLM, `max_tokens 900`) with `submit_parse_retries = 2` repair rounds (`请只修正最终提交，不引入新论据。`). Compatibility repair loop identical to §3.4 but re-runs `runDiscussion(maxTurns 3)` + `leaderSubmit`.
Observed :01: each segment `converged` after 1 turn ⇒ per segment ≈ 1 speak + 1 moderator + 1 submit + 1 parser = 4 calls; batch mean 1.07 turns.

##### 4.4 D5 pricing-action persona (3 stages: action → tier → price)

`runPricingActionPersonaD5` (6737-6965): each stage = `runDiscussion` (moderator entry with the stage text, e.g. stage 1 `【D5 第一步：定价动作】/现在小组站在产品售价滑块前，先讨论定价动作，不提交具体价格。/A：…/B：…/每个人用自己的说话方式参与；如果心里摇摆，也说出此刻更偏哪边。/这一段不报具体价格，不复述成本金额，不算公式。/不要输出 JSON，不要 Markdown 表格。`; stage 2 `【已冻结定价动作】…/【D5 第二步：相对档位】/承接刚才的动作，现在讨论价格放在相对高档、中档、还是低档。/如果动作偏压低售价抢量，低档或中档更符合这个动作；如果动作偏抬高售价守毛利，中档或高档更符合这个动作。/高/中/低只是滑块相对位置，不给固定数值段，也不代表建议价或锚点。/这一段仍然不要提交具体价格，也不要复述成本金额。`; stage 3 `【D5 第三步：最终价格】/现在请在界面滑块 ¥… 到 ¥… 里讨论并提交一个最终价格。/不要使用固定步长，也不要把上下限或中点当默认答案。/像真实小组一样落到一个数字：…最后由组长提交最终价格。/最终讨论只需要一个价格和人话理由，不要展开成本拆账。/不要输出 JSON，不要 Markdown 表格。`) followed by `leaderSubmit` with `decisionType` `pricing_action` / `pricing_tier` / `price` (instruction lines: `最后只提交定价动作：压低售价抢量 或 抬高售价守毛利；不要提交具体价格、成本金额或公式。` / `最后只提交相对档位：高 / 中 / 低；不要提交具体价格、成本金额或公式。` / `定价提交只需要给出最后滑块价格和一句人话理由，不要展开新的公式计算或成本拆账。`; `maxTokens: 340`) + `parseSubmission` (`validatePrice` range check; `validatePricingAction` A/B; `validatePricingTier`).
`speak` in pricing topics adds `定价时像在拖界面滑块：除非这一轮节拍要求粗算，否则少讲数字；不要重新推公式、不要逐项精算。` and `这一段还没到报最终价格，不要报具体售价，也不要复述成本金额。` (stages 1-2) / `这一段可以提出一个价格，但只说一个数和人话理由，不要做成本拆账。` (stage 3).
(c) Termination per stage: moderator `converged` or 7-turn cap, then the leader (the same solo person) submits. Observed :01: 1 turn each; batch mean 2.02 turns (max 7).

##### 4.5 Solo v2Q call count (unit :01)

D3 prototype 7 turns (cap, `leader_decision`) ⇒ 14 calls; reading habit 1; D4 per-dim 6; D4 review 6 × 4 = 24; D5 3 × 4 = 12 ⇒ **≈57 calls** (batch: D3 mean 4.44 turns ≈ 9; D5 mean 2.02 turns ⇒ ≈ 48-55 typical).

---

#### 5. Cascade probe — `teamR2CascadeProbeSim.js`, `runD5SequentialAction` (7628-7661)

Replaces scene 1 only (`TEAM_SIM_D5_SEQUENTIAL=1`, 7571-7572); tier and price scenes unchanged from §3.6. Order: non-leaders shuffled by seeded RNG, leader last. One call per member (5 per team). System:

```
${formatProfile(member, isLeader, "team_room_story_d4d5_v1")}
${voiceLine(member)}                        # "他在讨论里怎么说话（从小传看）：…" (voice probe; LLM-inferred, cached voice_lines.jsonl)
${d5IdeologyLine(member)}
${formatR1ActorCarryoverForPrompt(member)}
你只扮演这一个人，只说你自己会说出口的话。
```

User:

```
【眼前页面】
${screenText}                               # scene-1 screen from §3.6

【已经公开表态的人（按顺序）】
${prior}                                    # "1. name：压低售价抢量——“line”" … or "（你是第一个表态的人，前面没人说过话）"

<leader>     轮到你了。你是组长，你表完态之后要在页面上点选 A 或 B——你点的就是小组的决定。别人的话你都听到了；你私下的三段也在你手里。你怎么选，看你自己。
<non-leader> 轮到你公开表态了。你只能选 A 或 B，然后用一两句你自己的话说为什么（不报具体价格）。别人说过的你都听到了；你私下的三段也在你手里。跟不跟别人，看你自己。
只输出可 JSON.parse 的 JSON：{"choice":"A|B","line":"你说出口的原话，一两句"}
```

(b) Injected: own biography, own voice line, own private stage, own R1 carry-over, and **only the earlier public announcements** (no other member's private state). Firewall:
> 你只扮演这一个人，只说你自己会说出口的话。
> 别人说过的你都听到了；你私下的三段也在你手里。跟不跟别人，看你自己。
(c) Fixed order, leader's choice is the team choice; no moderator. (d) `chatCompletion(..., { temperature, max_tokens: 300, timeoutMs: 90000, response_format: { type: "json_object" } })`, 3 attempts, then `throw d5_sequential_action_parse_failure`. Logged to `d5_sequential_action.jsonl` with `private_action`, `prior_public`, `public_choice`. (This probe module additionally injects `VOICE_SCENE_RULES` and the voice line into D4/D5 sheets — not part of the frozen B line.)

---

#### 6. Deterministic post-processing summary

- **R1 public-line validator** (`teamR1Cap24Sim.js:2660-2711`): reject `TBN\d+`; reject private-marker words inside parentheses (`脑子里|心里|心头|内心|暗自|没说出口|浮现|回忆起|想起|想到(的是|了)|意识到|盘算|琢磨|这个我认`); reject any text outside `（）` and `“”`; reject UI-operation verbs inside stage directions in speak mode; operate-mode consistency checks (no continue+edit in one take; no submit with empty VP field).
- **R1 projection salvage** (2733-2758): after 3 rejections, keep `“…”` speech, keep ≤3 sentences with visible-action words (`点头|摇头|沉默|…`) that lack private markers (and lack UI verbs in speak mode), wrap as `（…。）`; else `（name没有说话。）`.
- **R1 participation classifier** (2760-2772): silent / acknowledge (quoted speech ≤16 chars or matches `^(嗯|行|可以|好|没意见|我同意|就这样|先这样|差不多|你们定|我都行)+$`) / substantive — drives `quietBeatStreak` and the fallback-speaker trigger.
- **R1 UI-event normalizer** (3211-3294 + 3033-3203): extractor JSON is only accepted if the raw text contains explicit click evidence regexes for the named button/grid/architecture (`点击|点选|点下|点了…|按下|…|单击` + label, negation check `r1ActorClickEvidenceNegated`), else downgraded to `none`; `applyR1ActorUiEvent` gates phase transitions.
- **R1 termination bookkeeping**: `eventCap 24`, `entranceCheckCap 144`, deadline cue at event 21, timeout forced submission + extractor, AI writing assist keeps grid/architecture (`assertR1WritingAssistKeepsChoice` 3655-3662) and falls back to the draft.
- **Submission parser** (`submitParser.js`): `parseJsonLoose` strips ``` fences and slices first `{`…last `}`; `validateR1` (grid in 12 ids, architecture normalized, WHO/PAIN/HOW/rationale required); `validateCards` (cap in allowed list, tier low/mid/high, per-group min); `validatePrice` range; `validatePricingAction` A/B; `validatePricingTier`.
- **Solo R1 screenplay validator** (`soloRoleplaySim.js:3101-3146`): ≥3 beats; actor id normalization (`normalizeScreenplayActor`); `final_submission` required; DIFF/COST wording vs grid id (`assertR1ScreenplayStrategyTextMatchesGrid`).
- **D4 pick validators**: story trace (8694) — only `action=select` become cards, group membership, tier, ≥3 trace rows/≥1 select; direct (9204) — cap/tier/group, ≥1 card. Cards merged across members with `selected_by` (`mergeSelectionsWithSelectedBy` 8594); conflict board buckets (`buildD4ConflictBoard` 8838) deterministic.
- **D4 screenplay validator** (9649-9744): actor normalization, ui_action inference from aliases/line text, replay onto card state, ≥1 card in segment; compatibility `RD.validateSelections` with up to 4 repair rounds then `applyDeterministicUiCardGuard` (10085-10140).
- **Room speech sanitizers** (`sanitizeRoomSpeech` 1882-1896, `clampRoomSpeech`): strip leading `name:`/`id:` prefix (≤3 passes), clamp sentences/chars per beat kind.
- **D5 state seeding** (`seedD5CardReviewState` 6604-6722): deterministic `value_feel/cost_feel/speaking_angle/pricing_position` from retained cards and tier strengths — no LLM.
- **D5 scene validators** (7471-7494, 7226-7277): leader-only `choose_action`/`choose_tier`; price range check with `rejected` beats retained; final price = last `confirm_price` else last legal `drag_slider`. `priceSubmit.parse_method = "deterministic_screenplay_ui_action"`.
- **Cascade probe**: JSON `choice` must be A/B, `line` ≤200 chars; 3 attempts.
