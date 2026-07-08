# 任务：重写 PROJECT_OVERVIEW.md

## 用途（决定写法）

这份文档**不进 git 仓库**——它是贴进 Claude 项目知识、用来启动新对话的上下文。读者是一个对本项目零上下文的 AI 助手。所以：
- 优先"当前状态 + 约定 + 正在飞的事"，不要写成 README 或教程
- 结构照旧版（见下），但**每一条事实性陈述都要对着活仓库核实**，不确定的标注"待确认"而不是猜
- 中文为主，代码/文件名用英文，全文控制在旧版相近的篇幅

## 已知旧版错误（必须修正）

- 旧版写"后端：Node.js + Express，SQLite"——**错**。权威状态存储是 PostgreSQL（`server/db/pgSql.js`，docker named volume `pgdata`）。`db.sqlite`/`sim.db` 是迁移遗留，运行时零引用。README 里的 SQLite 段落描述的是 legacy 单文件架构，不要照抄。
- 旧版的"待修复问题"和"Round 2 需要做的"清单已 stale——对着仓库现状重写，已完成的删掉，写实际还开着的。

## 从仓库核实并写入

- 技术栈现状：Node.js 版本、PG、Docker Compose、nginx、前端哪些页面是 React（Vite）哪些还是原生 HTML、部署目标（GCP VM / `app.praxisengine.xyz`）
- Round 1 / Round 2 的实际流程和状态（读路由和前端入口，别照抄旧版）
- 关键配置文件清单及当前版本号（如 `grid_priors_v4_cap_weights.json`、`jinang_cards_v2.json`、`capability_groups_v2.json`、`compatibility_rules_v2.json`、`tag_map_v2_1.json`、`round2_engine_params.json`——以仓库实际存在的为准，旧版写的 v3 可能已升 v4）
- `server/llm/` 模块清单（以实际文件为准）
- 目录结构图（以实际为准）
- 数据管道：GCP Datastream → BigQuery（`praxis_sync`，Append-only）——如果仓库里有痕迹就写，没有就按本 brief 写并标"配置在 GCP 侧"

## 代码里读不出来、必须原样保留的内容

**设计原则（四条，逐字保留）：**
1. 反优化设计：锦囊/市场数据/评分都刻意模糊，防止学生逆向工程最优解；WTP 对玩家真隐藏
2. 教学优先：每个功能评估标准是"是否增强学习"而非"是否技术完整"
3. 有意义的张力：锦囊能力 vs 市场天花板、利润空间 vs 市场规模、团队分歧 → 讨论
4. 增量开发：能跑就别动，不动现有逻辑，只新增层；等观察到生产问题再修理论问题

**工作流约定（写进文档）：**
- Claude 写架构/spec/调试策略 → Codex 或 Claude Code 实现 → 人测试并回报结果
- Codex spec 一律独立 markdown（`CODEX_*.md`），单一职责，验收标准带具体数值
- 后端是状态唯一真相源；课堂并发用 3–5s 轮询，不用 WebSocket
- LLM 做表达、确定性引擎做精度，语义桥连接

## 正在飞的事（写进"当前进行中"一节）

1. **加固分支 `hardening/auth-and-crash-guards`**：三个 commit。①接口鉴权+静态白名单、②崩溃兜底（pg pool error / 全局 handler / dispatch try-catch）已验收待合并；③persona 池原子写**已决定撤掉不合**（原因见下一条）。
2. **Round 2 访谈改版（已拍板，待写 spec）**：live 多轮 LLM 访谈 → 改为**分配时批量预生成**的用户画像 summary，每队两个客户原型（老人照护向 / 成人陪伴向）二选一，作为目标客群取舍决策。约束：summary 只描述情境/痛点/行为，**绝不点名能力卡**（反优化命门）；evi 证据链入口口径不变（素材→能力卡的翻译仍归学生）。直播课堂走 summary 流程；访谈作为高剂量臂保留给研究/单人 track（ISR 论文的剂量对比需要）。这个改版消除了 persona 并发写窗口，故 ③ 不再需要。
3. 一处**预存在**失败测试：`round2_assign_dimensions_fast_path` 断言 `personaVersion=4` 但代码常量已是 5，测试没跟上，动 persona 层之前需先对齐。

## 交付

- 输出到 `/mnt/user-data/outputs/PROJECT_OVERVIEW.md`（或仓库外任意路径给我），**不要 commit 进仓库**
- 与本 brief 冲突的地方（仓库实际情况 ≠ brief 描述），以仓库为准并在文档末尾列出差异清单
