# CODEX_FULL_GAME_ALL_PERSONAS.md
## 7 个 persona 各自完整走一遍游戏：R1 自由选格 → R2 真实访谈 → 利润，横向比较

**版本**：v1，2026-07-14
**分支**：`research/experiments-20260714`（当前实验产物所在分支）。独立脚本，不起 server，不改路由/UI，不动 main。**全程不碰 Dockerfile / package.json / package-lock.json 的工作区改动**（生产修复现场，别人在改）。
**前置**：7 张认知地图全部就位——草根老板/二代接班人（Phase A 手工冻结，sha `40d8de67…`/`97fa4be7…`）+ 体制转型者/职业经理人/销售铁军/技术创业者/互联网PM转型（`ai_generated_persona_maps_v2_2026-07-14_maps.json`，5/5 过 4a 硬校验）。D1-D5 链式机制已三轮验证；真实引擎结算已跑通（engine pilot v5）；5 张新地图的 D1-D4 已各跑通 1 次。

**与既往 bench 的关键装置差异（必须写进产物报告）**：既往所有链（bench 32 链、engine pilot、search effort、5 人 D1-D4）的 D3 都是"读固定的 persona_reports_v1.1 报告"——那是 bench 为控制变量做的实验装置，且只有 B2B_Differentiation_Elder 一格有素材。本轮 D3 改走真实游戏通道：按 persona 实际所选格子，用真实 `personaGenerator.js` 动态生成该格子的用户画像 summary，persona 读 summary 提取证据。**因此本轮结果与既往 bench 数字不属于同一实验装置，横向比较只在本轮 7 人内部做，不与 bench 的价差/主题频次数字直接对比**。

**假设声明（如有误直接改）**：
- 7 个 persona 各跑 1 次（N=1/人），M 条件（各自全量地图在场）。这轮是"7 人完整走一遍 + 横向看分化"，不是统计检验。
- R1 完全开放：12 格（儿童/成人/老人 × ToC/ToB × 差异化/成本）全部由 persona 自选，不预设任何维度。通用场景框架："你在中国推广一款陪伴机器人产品，目标是找到一个能盈利的市场定位"。
- R2 访谈用 summary 流程（分配时批量预生成用户画像 summary，persona 读后提取证据）——与已拍板的 Round 2 访谈改版方向一致，不做 live 多轮访谈。
- VP Coach solo 对话复用真实 `vpCoach.js` 逻辑；R1/R2 结算全部调真实引擎，不重新推导公式。
- evi 沿用真实计算路径现状：本轮 D3 产出的证据过现有通道能算出什么就用什么；若与 engine pilot v5 一样退到 fallback（覆盖标签精确匹配 0 命中→grid prior 回填），如实记录，不算失败——Direction B（模糊匹配桥）还没修，这是已知现状。

---

## 0. 目的

7 个不同认知地图的 persona，各自从游戏的第一个决策（12 格自由选择）开始完整走到最后的利润数字，产出一张横向比较表：谁选了什么市场、立了什么 VP、访谈后抓了什么证据、配了什么产品、定了什么价、赚/亏了多少。检验"persona=认知地图×链式决策"这套机制在完整游戏、全开放决策空间下能否产生 7 条彼此可辨、方向自洽的完整策略轨迹。

## 1. 流程（每个 persona 独立走完，7 条完整 playthrough）

### R1 阶段（团队人数=1 的合法配置）

| 步骤 | 输入 | 处理 | 输出 |
|---|---|---|---|
| R0 锦囊分配 | `jinang_cards_v2.json` | 真随机抽 1 市场 + 1 技术锦囊（复用产线随机分配函数） | 2 张锦囊卡 |
| R1 选战略（第一个决策） | persona 地图 + 锦囊卡 + 通用场景（不提示任何细分市场/渠道/策略） | 自选完整 12 格 + 架构标签（体验●/混合▲/功能■）+ VP 草稿（WHO/PAIN/HOW），M 条件地图引用校验同现有规则 | 格子 + 架构 + VP 草稿 + updated_constraints |
| R2c Coach solo 对话 | R1 栈 + 真实 `vpCoach.js` | persona 基于（地图+栈+coach 问题）逐轮作答至收敛或轮数上限（沿用现有判定） | 最终 VP + 轮数 |
| R3 结算 | 格子 + 架构 + VP + 锦囊 | 真实 R1 引擎：GMmax、Market Space Tier、VP 打分（anchor 按所选格子对应的 customer_group 词表取，Codex 按实际代码定位）、锦囊契合度 | 档位 + tier + VP 评分 + jinang fit + 冻结 target_gm |

### R2 阶段（衔接 R1 产出，格子用 persona 实际所选的）

| 步骤 | 输入 | 处理 | 输出 |
|---|---|---|---|
| 画像生成 | persona 所选格子 | 真实 `personaGenerator.js` 生成该格子的用户画像 summary（summary 只描述情境/痛点/行为，不点名能力卡——沿用已拍板的反优化约束） | 用户画像 summary |
| D3' 证据提取 | persona 头 + 累计栈 + 画像 summary | 结构同现有 D3（key_evidence ≤3 + market_judgment + updated_constraints），素材从固定报告换成动态 summary | 证据 + 市场判断 |
| D4 选卡 | persona 头 + 栈 + 真实卡池（id+tier）+ 兼容性规则 | 同 engine pilot v5：每维至少 1 张、总数至少 6 张、过 `compatibility_rules_v2.json`，数量无上限 | 选卡列表（id+tier） |
| D5 定价 | persona 头 + 栈 | 同现有 D5，价格 [1000,6000] | price + basis + reasoning |
| 引擎结算 | 选卡 + 对齐 price（取最近 100）+ target_gm（R1 冻结值）+ evi/tags（真实通道，退 fallback 如实记录） | 真实 `calculate()` | cost/risk、Vscore、Q、profit |
| VP 打分（仅报告） | 最终 VP | 真实 `vpWordScorer.js`，不进 profit/Q | C/G/E + VPscore |

**栈传递**：R1 的全部决策记录（格子选择理由、VP、Coach 对话结论、R3 结算结果）压入栈带进 R2——两轮是一条连续的链，不是两个独立实验。

## 2. 矩阵

7 persona × 1 次 × M 条件 = **7 条完整 playthrough**。每条 LLM 调用约 4-8 次（R1 选战略 1 + Coach 若干轮 + D3'/D4/D5 各 1），总量约 30-60 次调用。

## 3. 判决指标（N=1/人，全部描述性，不做统计声明）

1. **格子分布表（第一张表）**：7 人各选了哪格 + 架构标签 + 一句话选择理由摘录。观察：选择是否散开、每个选择与该 persona 地图签名是否可辨认地对应（如实呈现，不强行解读）
2. **VP 与 Coach**：7 人最终 VP 的 WHO/PAIN/HOW 一览 + Coach 对话轮数 + VP C/G/E
3. **R1 结算**：GMmax 档位、Market Space Tier、jinang fit、target_gm，7 人一览
4. **R2 决策**：证据提取主题、选卡（张数/tier 分布/维度覆盖）、价格，7 人一览
5. **最终经济结果**：cost、Vscore、Q、profit，7 人排序
6. **target_gm 传导检验**：R2 的定价/结算是否真实受 R1 冻结的 target_gm 影响（沿用 solo pilot spec 的检验点）
7. 一句话观察：7 条轨迹是否彼此可辨、内部自洽（选格→VP→选卡→定价方向一致）；哪几条出现"漂亮叙事被超支吃掉"这类有教学解释力的模式

## 4. 验收

1. 7/7 完成 R0→R3→R2 全链（若个别 persona 在某步经重试仍 FAIL，如实记录该链断点并继续其余链，6/7 以上完成即验收通过，7/7 为目标）
2. 所有数值输出合法（无 NaN/null）；D4 选卡全部过兼容性校验
3. 产物四件套：summary（判决指标 1-7 的表）、raw_samples（7 条链完整原文，含画像 summary、Coach 对话全文）、jsonl、meta（7 张地图各自 sha256、脚本/commit sha256、涉及配置文件 sha256、明确标注"D3 装置为动态画像 summary，与既往 bench 不可直接对比"）
4. evi 若退 fallback，在 summary 里如实标注，不隐藏

## 5. 不做

- 不做团队/多人协商（已叫停）
- 不做 N 次重复、不做统计推断
- 不与既往 bench 的数字做跨装置直接对比
- 不为未选中的格子预生成任何素材
- 不做 live 多轮访谈（summary 流程）
- 不修 Direction B（覆盖标签模糊匹配）——evi 退 fallback 属已知现状，如实记录即可
- 不新造 `vpCoach.js`/`personaGenerator.js`/R1/R2 引擎逻辑，只调用；发现假设与仓库现状不符，停下报告，不编造
- 不动 main、不碰 Dockerfile/package.json/package-lock.json、不改路由/UI、不做 UI E2E
