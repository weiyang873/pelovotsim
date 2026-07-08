# PERSONA_DESIGN_HISTORY

> 目的：回答本仓库里 3 个 persona 设计史问题，只读代码 / 文档 / git 历史后形成结论。
> 范围：`docs/`、根目录 `*PERSONA*.md`、LaTeX 源、`scripts/sim/persona_student.js`、`scripts/sim/team_runner.js`。
> 生成日期：2026-07-06

## 问题一：Layer 2 "Plan(阶段策略)" 层的下落

### 1.1 相关 spec 现在是否还在

结论：**还在，但仍停留在设计稿 / 测试稿，没有进入任何可见实现版本。**

现存物证：

1. `docs/CODEX_PERSONA_LAYERED_ARCHITECTURE_V2.md`
   - 文件仍在。
   - 文中明确把 layered persona 架构写成 4 层：
     - Layer 0: Seed Memory
     - Layer 1: Reflection
     - Layer 2: Plan
     - Layer 3: Action
   - 对 Layer 2 的定义原文是“**阶段策略（每个阶段开始时调一次 LLM）**”。
   - 文中还给了完整的 `async generatePlan(sceneDescription)` 伪实现，并要求：
     - 把输出存到 `this.currentPlan`
     - 在 `buildLayeredSystemPrompt()` 里追加 `## 我现在的想法`
     - 在 `team_runner.js` 的多个阶段开始前调用 `await actor.generatePlan(...)`
   - 这份文档等于把 Plan 层写成了“设计上应存在”的一层。

2. `docs/CODEX_TEST_LAYERED_PERSONA.md`
   - 文件仍在。
   - 它要求测试脚本按 3 步跑：
     - Layer 0 Seed Memory
     - Layer 1 Reflection
     - VP 初稿
   - 但在“输出格式”里又明确要求打印：
     - Seed Memory
     - Reflection
     - **Layer 2 Plan**
     - VP 初稿
   - 说明 2026-03-21 左右的测试 spec 仍把 Plan 层视为架构组成部分。

3. `docs/old docs/EMBA_Simulator_R1R2_V7_CN_PlusPlus_v7_1_5.tex`
   - 当前仓库可见的 LaTeX 源里，**没有找到 layered persona / Seed Memory / Reflection / generatePlan / 阶段策略 相关章节**。
   - 用全文检索后，命中的只有：
     - `D.2 参数校准的最小流程（4 个 anchor plan）`
     - `I.2 锚点策略（Anchor Plans）与排序约束`
     - `代表性策略（4个 anchor plans）`
   - 这里的 `plan` 指的是校准 / 锚点策略，不是 persona 的 Layer 2 Plan。
   - 因此：**在当前可见 LaTeX 源里，没有 persona Plan 层的正文物证。**

### 1.2 代码历史里有没有实现过 `generatePlan / phasePlan / 阶段策略`

结论：**从未实现。不是“实现过后来删了”，而是“全 history 零匹配”。**

证据分两层：

#### A. `persona_student.js` 历史

- `git log --follow -- scripts/sim/persona_student.js`
  - 只显示 2 次触达：
    - `d01c307` `2026-03-23` `Initial commit`
    - `b136dc7` `2026-03-29` `chore: checkpoint current multiplayer and round2 work`
- 对该文件做历史正则检索：
  - `git log --follow -G 'generatePlan|currentPlan|phasePlan|阶段策略' -- scripts/sim/persona_student.js`
  - **结果为空，零命中。**
- 逐版本抽样验证 `d01c307 / b136dc7 / 0b28356 / 40b6faf / HEAD`：
  - 一直能看到的是：
    - `buildLayeredSystemPrompt()`
    - `generateSeedMemory()`
    - `generateClassroomProfile()`
  - **从未出现**：
    - `generatePlan`
    - `currentPlan`
    - `phasePlan`
    - `Reflection` 层函数

#### B. `team_runner.js` 历史

- `git log --follow -- scripts/sim/team_runner.js`
  - 触达链是：
    - `d01c307` `2026-03-23`
    - `b136dc7` `2026-03-29`
    - `0b28356` `2026-03-29`
    - `40b6faf` `2026-04-06`
- 对该文件做历史正则检索：
  - `git log --follow -G 'generatePlan|currentPlan|phasePlan|阶段策略' -- scripts/sim/team_runner.js`
  - **结果为空，零命中。**
- 逐版本抽样验证 `d01c307 / b136dc7 / 0b28356 / 40b6faf / HEAD`：
  - 一直存在的是初始化步骤 `r1_init_persona_layers`
  - 该步骤只做：
    - `await actor.generateSeedMemory()`
    - `await actor.generateClassroomProfile()`
  - **从未调用**：
    - `actor.generatePlan(...)`
    - 任何阶段性 plan 更新

### 1.3 最终判断

Layer 2 Plan 的状态可以明确写成：

- **Spec 中存在**：是。
- **测试 spec 中仍被引用**：是。
- **LaTeX 源中有 persona Plan 章节**：否。
- **任何 commit 实现过 `generatePlan/currentPlan/phasePlan`**：否。
- **更接近的真实历史判断**：`Plan` 层是一个写进文档的设计分支，**从未进入仓库可见实现**。

---

## 问题二：3/29 (`b136dc7`) 之后 persona prompt 还动过什么

### 2.1 先给结论

结论：**`b136dc7` 之后，`scripts/sim/persona_student.js` 没再动过。**

也就是说，如果把 `b136dc7` 视为 Gen 4 落地后的 checkpoint，那么：

- **后续没有新的 persona prompt 迭代**
- **没有新的层结构变化**
- **没有新的字段注入变化**
- 只有同日之前的 `b136dc7` 相对初版做过两处 prompt 细化

直接证据：

- `git log --follow -- scripts/sim/persona_student.js`
  - 只有 `d01c307` 和 `b136dc7`
- `git diff b136dc7..HEAD -- scripts/sim/persona_student.js`
  - **空输出**

### 2.2 按你指定的链路看：`b136dc7 -> 0b28356 -> 之后所有触及此文件的 commit`

#### A. `b136dc7 -> 0b28356`

结论：**无 diff。**

- `0b28356` 的提交信息是 `fix: preserve round1 age in persona sim round2`
- 但它**没有触及** `scripts/sim/persona_student.js`
- 因而这一段对 persona prompt / 层结构 / 字段注入 **没有任何改动**

#### B. `0b28356 -> 后续`

结论：**仍然没有任何触及 `persona_student.js` 的 commit。**

- 后续即便 `team_runner.js` 在 `40b6faf` 被改过，`persona_student.js` 仍未动
- 所以后续也不存在 persona prompt 层面的 commit diff 可列

### 2.3 真正发生过的 diff：`d01c307 -> b136dc7`

虽然你问题聚焦 3/29 之后，但为了回答“Gen 4 落地后实质有没有变”，需要把 `b136dc7` 自身相对初版的变化列清楚。

#### 变更 1：`generateInterviewReply()` 注入了访谈维度引导

`b136dc7` 新增常量：

- `INTERVIEW_DIMENSION_GUIDANCE`

并把以下内容塞进访谈 prompt：

- `当前轮次：第 ${turn + 1} 轮`
- 6 个维度探索指南：
  - 感知与理解
  - 运动与导航
  - 交互与表达
  - 安全与信任
  - 可扩展与连接
  - 可运营与可维护
- “前 2-3 轮自由探索，后面主动补齐没聊到的维度”

判断：

- 这是**prompt 文本增强**
- 会改变访谈问题的覆盖面与追问策略
- 但**没有改变 layered persona 的层结构**

#### 变更 2：`generatePriceChoice()` 的定价 prompt 被重写

初版给的是直接参数清单：

- 可售价格区间
- 参考基础价
- 硬件成本
- 渠道费率

`b136dc7` 改成了更解释性的“已知信息”：

- 硬件成本
- 渠道抽成及“定价 10000 实际到手多少”的例子
- “高价赚更多但买的人少，低价买的人多但可能亏本”的 tradeoff
- 最后再给定价区间

判断：

- 这是**定价 prompt 的语义强化**
- 会影响 LLM 对价格博弈的理解
- 但仍然**不构成 persona 架构层级变化**

#### 变更 3：没有发生的变化，反而更重要

`b136dc7` 并没有动这些核心结构：

- `buildLayeredSystemPrompt()` 仍然只拼：
  - `seedMemoryText`
  - `classroomProfileText`
  - `getVPLengthConstraint(education)`
- 没有追加：
  - `reflection`
  - `currentPlan`
- `team_runner.js` 的初始化仍然只调：
  - `generateSeedMemory()`
  - `generateClassroomProfile()`
- 没有任何阶段性 `generatePlan(...)`

这说明到 `b136dc7` 为止，真正落地的其实不是文档中的 4 层：

- 文档写的是：`Seed Memory -> Reflection -> Plan -> Action`
- 代码实际是：`Seed Memory -> Classroom Profile -> Action`

### 2.4 回答：Gen 4 落地后，persona 的设计实质有没有变过

结论：**没有。**

更精确地说：

1. **若以 `b136dc7` 为 Gen 4 落地点**
   - 之后 `persona_student.js` 再无任何提交
   - 所以 Gen 4 落地后，persona 设计 **没有继续演化**

2. **若看 `b136dc7` 自身相对初版**
   - 变化只在：
     - 访谈 prompt 引导
     - 定价 prompt 解释性增强
   - layered 架构本体并未改成文档里那套 4 层
   - 所以这些更像是**prompt 细化**，不是**persona 设计范式升级**

一句话归纳：

> Gen 4 之后，persona 设计实质上是冻结的；后续没有再发生 prompt 架构级变更。

---

## 顺手第三件：persona 相关设计文档族谱（物证目录）

说明：下面的“修改日期”取 **文件系统当前 mtime**，因为其中一部分文件并不都能从单文件 `git log -1` 稳定取到完整结果。

### 3.1 根目录 `*PERSONA*.md`

| 文件 | 修改日期 |
|---|---|
| `PERSONA_INVENTORY.md` | `2026-07-06 15:40:58` |
| `PERSONA_RUN_LEDGER.md` | `2026-07-06 16:08:07` |

### 3.2 `docs/` 下 `*PERSONA*.md`

| 文件 | 修改日期 | 备注 |
|---|---|---|
| `docs/CODEX_PERSONA_SIM_TEST.md` | `2026-03-19 08:52:05` | persona 驱动模拟测试总 spec |
| `docs/CODEX_PERSONA_CARD_SELECTION.md` | `2026-03-19 14:33:07` | persona 与选卡行为设计 |
| `docs/CODEX_PERSONA_RANDOMIZE.md` | `2026-03-19 15:44:44` | persona 池随机化、学历/年龄/海外经历关联 |
| `docs/CODEX_TEST_LAYERED_PERSONA.md` | `2026-03-21 12:27:18` | layered persona 测试 spec |
| `docs/CODEX_PERSONA_LAYERED_ARCHITECTURE_V2.md` | `2026-03-21 12:29:34` | Layer 0/1/2/3 的正式设计稿 |

### 3.3 LaTeX 源

| 文件 | 修改日期 | 与 persona 的关系 |
|---|---|---|
| `docs/old docs/EMBA_Simulator_R1R2_V7_CN_PlusPlus_v7_1_5.tex` | `2026-03-23 22:46:50` | 当前可见检索中未发现 layered persona / Plan 层章节；只发现 `anchor plans`（非 persona） |

---

## 最短结论

1. **Layer 2 Plan 只存在于设计稿，没有任何可见实现 commit。**
2. **`b136dc7` 之后 `persona_student.js` 完全未再改动。**
3. **Gen 4 落地后，persona 设计实质没有继续演化；只有落地点本身带来的 prompt 细化。**

