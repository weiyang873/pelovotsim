# PROMPTS_DIGEST — 2026-08-22 — code ref: main a0c6efaf · worktree b4abc57a · lock-in study3-app 80ab559

所有 prompt 原文按线分在 `docs/prompts_digest/` 四个文件（逐字摘自代码与已存 artifacts，每段带 file:line）；本文件是调用地图 + 第 5/6 节 + 指向。模型统一 deepseek-v4-flash（thinking 关闭；S1 grid 批为 0731 快照，S1 chat-A 为 a26a7955），传输层 timeout 90 s / maxRetries 2。

## 0. 调用地图

| 线 | 阶段 | 模板位置 | 每队/每人调用 | 温度 |
|---|---|---|---|---|
| **S1 grid**（真人 app 由 Playwright 驱动，LLM 逐屏作答） | 系统 = SPEC4 + 第二人称人设卡 + FORMAT_LINE；每屏 = 抓取的 UI 文本 + JSON 回复包装 | `modeH/runner_explore.mjs:80-101, 247-441`；人设 `modeH/gen_personas.mjs:116-121`；臂操纵 `lib/study-content.js:116-145` | 33–40 次/人（中位 38） | 1.0（max_tokens 2000） |
| **S1 chat-A**（代表性池 + warmth + satisfice） | 系统 = SPEC4 + repr 卡 + warmth 特质句；对话 = 1 条同事消息（按臂）；替换臂 = SUB_DRAFT + SAT 消息；测量 = 信心 1 问 + MDMT "felt" 5 问；决策/替换由 regex 编码 | `modeHs/runner_fullchat.mjs:36-90, 213-251`；`gen_repr_personas.mjs:38, 147-174` | 7 次/人（最多 9） | 见文件（warmth μ=.8 σ=1 的 env 命令未留档 **[待作者补]**） |
| **S2 传记写手**（任务盲） | system + user（姓名 + 14 条冻结事实 + 8 条行为表现句 + 900–1300 字 + JSON-only） | `scripts/analysis/generate_task_blind_persona_pool.js:613-643`（v2/v3 同模板加字段） | 1 次/人 + 重试（42 人 116 次调用） | 0.9（max_tokens 3000） |
| **S2 roleplay · Solo R1** | 草稿 + 解析 + 整场剧本（写手自己 `final_submission` 结束） | `server/synthetic/teamSim/soloRoleplaySim.js` | ≈3.4 次/人 | 0.55（剧本 max_tokens 4200） |
| **S2 roleplay · Team R1**（actor_isolated cap24） | 5 草稿 + 5 解析；每事件 5 个入场判断 + 1 表演；UI 抽取器；写作辅助；结束 = 组长自己的 submit_r1 事件或 24 事件上限（无主持人） | `teamR1Cap24Sim.js` | ≈143 次/队（入场 88、表演 22 均值；13/42 队触顶强制提交） | 0.55；抽取器 min(0.1,T)；写作辅助 0.25 |
| **S2 roleplay · Team R2 B**（编剧线） | D3 客户调研讨论（speak + moderator，cap 7）；D4 阅读习惯 5；D4 个人选卡 5（每人 1 次、两组一起）；D4 六段编剧 6 + 兼容修复；D5 私下层 10（定价观 + 三步 JSON）；D5 三幕 3；收敛句仅 `TEAM_SIM_D5_CONVERGE` | `teamR2StoryScreenplaySim.js`（收敛句 :7559/7572/7585） | ≈41 次/队 R2（+R1 143） | 0.55；主持 0.2；习惯/定价观 0.4；私下 0.6；三幕 max_tokens 2600 |
| **S2 roleplay · Solo R2 v2Q** | D3 7 轮 cap（14）；阅读习惯 1；逐维选卡 6；D4 六段 ×（speak+mod+submit+parser）24；D5 三阶段 ×4 = 12；结束 = 主持 converged 或 7 轮 | `soloRoleplayV2Sim.js`（与 team 模块仅第 2 行不同，靠 env 区分） | ≈57 次/人 | 同上 |
| **S2/S3 benchmark S / L** | 人设 = 属性表（simple）/ 属性表 + MBTI 思维段 + 原型商业字段（layered）；R1 提案 5 + 意愿/发言/主持每轮 + 组长提交 + 解析；R2 原型页（确定性）、个人选卡 5、六个单卡段讨论、价格面板；结束 = 主持人 converged（T 0.2）或 cap（R1 12、每决策点 7） | `benchmarkTeamSim.js`（人设 :1397-1453，锦囊 :1497-1502，turn 循环 :3492-3581） | ≈191 次/队；个人 = 同流程 team_size 1 | 0.55；主持 0.2 |
| **S3 replication**（231 设计队） | 与 Team R2 B 同模块（faultline/triad/shared-card/fn-diversity 固定组队 env） | `teamR2FaultlineSim.js`（worktree） | 同 R2 B | 同上 |
| **D5 逐人探针**（级联） | 每人一次：自己小传 + 声音句 + 私下立场 + 之前公开表态 → JSON | `teamR2CascadeProbeSim.js:7628-7661` | 5 次/队 | 0.55（max_tokens 300） |
| **judge：性格回测** | 只读小传 / 只读 R1 发言 → 8 维 0–1 | `scripts/analysis/probe_personality_backtest.js` | 2 次/人 | 0.1 |
| **coder：冲突编码** | 成员发言 → 任务/关系冲突、让步、子群话语、联盟 | `scripts/analysis/probe_transcript_conflict_coding.js` | 1 次/队 | 0.1 |

注意两点（影响正文措辞）：(1) benchmark 不是"固定 7 轮"，是主持人代理决定是否提前结束、上限封顶（R1 64–69% 由主持人收敛）；成员自己不决定长度。(2) Team R2 B 的个人选卡是每人一次两组一起，逐维选卡只在 Solo v2Q。

## 1. S1 量表翻译对照
见 [prompts_digest/S1_lockin_devices.md](prompts_digest/S1_lockin_devices.md)：MDMT 20 词/5 子维（`lib/study-content.js:152-163`）、决策任务与信心、操纵检验（POST_CHECKS :183-189）、AUX/ACK；grid 施测文本与真人 app 逐条相同（仅合并标题 + 加 JSON 回复行）；chat-A 用 5 句 "felt" 释义题替代 20 词格，且不施测操纵检验/自主性/回忆题。两处 **[原条目待作者补]**：final_reprWarmSat 批的 env 命令；grid 批是否开 QWEN_DISABLE_THINKING。

## 2. S2 传记写手
见 [prompts_digest/S2_biography_writer.md](prompts_digest/S2_biography_writer.md)：system/user 全文、20 字段目录与每字段抽样规则、8 维→表现句映射（写手不见数字）、TBN07 的实际拼装（事实卡 + 生成小传，输入 sha256 与池内记录一致）、v1→v2→v3 差异。

## 3. S2 过程指令
见 [prompts_digest/S2_roleplay_process.md](prompts_digest/S2_roleplay_process.md)：各阶段 system/user 全文；每次注入的状态（小传 + R1 延续记忆 + 私有状态 + 当前屏幕文本）；信息防火墙实现句以 `>` 引用块标出；结束条件逐阶段标注。两点实况需要在方法里如实写：D4 选卡 prompt 对 R2 无条件显示锦囊（`HIDE_JINANG` 只管 R1）；演员表除小传外还印数值化状态（信心/疲劳/成本不适/坚持度/价格敏感）。

## 4. S2/S3 benchmark 线
见 [prompts_digest/S2S3_benchmark_line.md](prompts_digest/S2S3_benchmark_line.md)：simple / layered 人设模板与真实渲染例（R39 / R17）、各阶段 prompt、锦囊文本（对 benchmark 可见）、turn 循环与主持人收敛代码、每队调用计数。layered 实为 "deprecated partial"：属性表 + MBTI 段 + 原型字段，无 L0/L1 小传。

## 5. 编码器与 judge

性格回测 judge（`scripts/analysis/probe_personality_backtest.js`，T 0.1，json_object）：

```
system: 你是人格测评员。只根据给出的材料，对这个人在 8 个特质上的位置打分，0=极低，1=极高，0.5=一般人水平。材料没有直接信息时按你的最佳推断给分，不要全写 0.5。只输出可 JSON.parse 的 JSON。
user:   【这个人的小传】 | 【这个人在一次小组讨论里说过的话（按时间顺序）】
        <文本>
        特质：
        - maximizing_satisficing：Maximizing (vs satisficing)，追求最优解、反复比较而不是够用就行
        - need_for_cognition：…喜欢深入思考、享受复杂问题
        - actively_open_minded_thinking：…主动寻找反证、愿意改变自己的看法
        - risk_propensity_business：…商业决策上敢冒风险
        - ambiguity_tolerance：…能在信息不全、模糊的情况下行动而不焦虑
        - regulatory_focus_promotion：…关注收益与成长（促进导向），而非规避损失
        - consideration_future_consequences：…看重长远后果胜过眼前
        - action_orientation：…倾向先做起来而不是等想清楚
        只输出：{"maximizing_satisficing":0到1的小数, …}
```

S3 信息使用 / 审议长度是代码规则，非 prompt（`paper/tab9_eisenhardt.py:9-20, 54-61`）：

```
lines  = 成员在 r2_transcript 中 decision_point 以 "cards_" 开头的各段里的发言（去掉 screen/moderator/narrator）
length = len(lines)                                   # D4 审议长度
NUM    = /\d+/ ; COST = /成本|价格|定价|毛利|利润|亏|COGS|预算|费用|花|钱|元|万/
info   = mean over lines of ( count(NUM) + count(COST) )   # 每句实时信息量
nums   = mean over lines of count(NUM)                     # 表中 "numbers per line"
row    = 一个队-轮；z 标准化后 OLS，SE 按组队 cluster
```

冲突编码器模板见 `scripts/analysis/probe_transcript_conflict_coding.js:27-40`（Jehn 任务/关系冲突定义 + 让步/子群话语/联盟，JSON 输出）。

## 6. 机械检查与重试

传记写手（v1/v2/v3，详见 §2 文件第 3 节）：
- JSON 围栏/花括号提取 → 解析失败即重试
- 空白折叠后长度 650–1800 字（过长/过短重试；42 人 116 次调用中 68 次因过长）
- 正文必须含姓名
- 任务词防火墙 24 词（机器人/陪伴设备/能力卡/定价等出现即重试）
- 特质标签防火墙 18 词（不得出现 "最大化者/风险偏好" 等维度名）
- v3：≥3 条 `“…”` 引号原话（3–60 字）
- 重试：脚本内 3 次（v1）/ 8 次（v2/v3）+ 手工补跑批（TBN22 到第 12 次）；无姓名唯一性检查（池内实际无重名）

过程线（详见 §3 文件末节）：
- 入场/表演/私下层/三幕：json_object 强制，schema 字段缺失 → 最多 3 次；演员 id 非法 → 重试（设计队曾因 "Rxx" 示例失败，已改动态示例）
- 舞台提示剥离：存 transcript 时 regex 去除（…）括注（v3 线）；不重复规则
- 提交解析：LLM parser + 2 次修复重试，失败 → 确定性守卫（Team R1：24 事件上限强制提交，13/42 队）
- benchmark：提案/选卡 ≤3 次；submit_parse_retries 2；兼容修复 ≤3 轮后确定性守卫
- S1 chat-A：决策/替换由位置 regex 编码（已知误码例：REP001-substitution）

token/成本：deepseekClient 不记录 usage，只能按上表调用数 × 价目估算 **[待作者补]**。
