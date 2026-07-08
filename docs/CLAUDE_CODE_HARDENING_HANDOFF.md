# Claude Code Handoff：生产可靠性紧急加固（仅三件）

## 0. 给你的总守则（先读，别跳）

1. **以活仓库为准，不以文档为准。** 这份 handoff 里的文件名+行号来自一次**只读副本**上的审计，可能已经漂移。每一条动手前，先 `read` 实际文件，确认问题仍然成立、行号仍然对得上。**若实际代码与描述不符，停下来报告，不要硬改。**
2. **项目概述（PROJECT_OVERVIEW.md）有一处是错的**：它写"后端 SQLite"，但权威状态存储是 **PostgreSQL**（`server/db/pgSql.js`，docker named volume `pgdata`）。`db.sqlite`/`sim.db` 是迁移遗留，运行时零引用。以仓库为准。顺手把 overview 里"后端：Node.js + Express，SQLite"改成 PostgreSQL。
3. **在新分支上工作**（如 `hardening/auth-and-crash-guards`）。**只产出 diff，不要部署、不要 push 到 main。** 我会人肉审 diff 再决定合并。
4. **这三件全部是"加一层 guard"，不是重写业务逻辑。** 如果你发现自己在改任何业务计算、状态机、评分或数据结构，说明走偏了，停。
5. 分开三个 commit，每件一个，commit message 里写清动了哪些文件、加了什么、没动什么。

---

## 1. 禁区（NO-TOUCH，一律不碰）

以下即使你觉得"顺手能修"也**不要动**，它们要么已在真实课堂验证过、要么需要人的判断、要么属于另一批工作：

- **经济模型与评分逻辑**：`server/llm/` 下全部（`vpWordScorer.js`、`dimensionScorer.js`、`rdCalculator.js`、`embeddingService.js` 等）。除了本 handoff 第 4 节明确点名的 persona 写入路径，`server/llm/` 一律只读。
- **反优化设计**：锦囊匹配、WTP 隐藏、格子先验、卡牌选择逻辑，全部不动。
- **各类并发竞态**（审计里的 T1-2 joinTeam 抢槽、T2-1~T2-6 各种 read-modify-write 丢更新、状态倒退、leader 双证、finalizePhase3 无事务等）：**本次不修**，已知存在、等真实复现再说。不要顺手改。
- LLM 队列背压（T1-1）、日志轮转（T2-9）、错误文案中文化（T2-10）：本次不做。
- 数据库 schema、迁移、config JSON：不动。

如果你在实现三件事时发现某个禁区问题"必须先改才能改这件"，**停下来报告**，不要自作主张扩范围。

---

## 2. 任务 ①：接口鉴权 + 静态目录白名单

**根因**：多个 `/api/admin/*`、`/api/test/export/*`、`/api/computation-log` 端点零鉴权；静态 fallback 能读 ROOT 内任意文件（含 `.env`）。这是同一个洞的两面，一起补。这也是 B 端客户的直接 dealbreaker，不只是课堂风险。

### 2a. 给裸奔端点套上已有的鉴权中间件

- **先确认** `/api/teacher/*` 实际用的是哪个鉴权函数（审计指向 `server/routes/teacherDebrief.js:65-71` 的 `verifyTeacherAuth`）。**复用那个完全相同的中间件，不要新写一个。**
- 给以下端点加上同一鉴权（行号先核对）：
  - `server.js:1917` `/api/admin/import`
  - `server.js:1924` `/api/admin/export`
  - `server.js:1930` `/api/admin/teams`
  - `server.js:1942 / 1949 / 1957` `/api/admin/llm-logs*`
  - `server.js:2530` `/api/computation-log`
  - `server.js:2804` `/api/test/export/:teamId`（另见 `testExportRoutes.js:490-494`：`TEST_EXPORT_KEY` 未配置时 `return true`，等于默认放行——一并堵死）
- **关键守卫**：admin 路由现有的 `/api/admin/verify`（校验 ADMIN_CODE、教师用来登录）**必须保持可无 token 访问**，否则教师登录不进来。别把登录入口一起锁了。

**验收标准**：
- `curl -X POST .../api/admin/import`（无 token）→ 返回 401/403，**不**执行 `DELETE FROM students`。
- `curl .../api/admin/llm-logs`（无 token）→ 401/403。
- `curl .../api/test/export/<任意teamId>`（无 token 且未设 `TEST_EXPORT_KEY`）→ 401/403。
- 带合法教师 token 的**现有教师流程全部照常通过**（这条要你实际跑一遍确认没误伤）。
- `/api/admin/verify` 无 token 仍可访问。

### 2b. 静态 fallback 改白名单

- **位置**：`server.js:3120-3138`（`path.join(ROOT, safePath)` 后 `fs.readFile`；现有 `path.normalize`+`startsWith(ROOT)` 只挡 `..` 穿越，不挡读 ROOT 内任意文件）。
- **改法**：不要在 ROOT 上做黑名单打补丁。改成**只从已知静态资源目录**提供文件，且**扩展名白名单**（按实际前端产物取，如 `.html .js .css .map .png .jpg .jpeg .svg .ico .woff .woff2 .json`——先看仓库实际 serve 了哪些）。任何点文件（`.env` 等）、`.db`、`.log`、`.jsonl`、以及目录外路径一律拒绝。

**验收标准**：
- `curl .../.env` → 404/403，**不返回文件内容**。
- `curl .../sim.db`、`.../server.log`、`.../data/llm_logs/xxx.jsonl` → 同样拒绝。
- 前端正常静态资源（首页、JS/CSS bundle、图片）**照常 200**（实跑确认）。

---

## 3. 任务 ②：崩溃兜底（pg pool + 全局 + dispatch）

**根因**：pg pool 无 `error` 监听、全进程无 `uncaughtException`/`unhandledRejection` 兜底、请求分发无 try/catch。任一处一个畸形输入或一次 DB 抖动就崩全班且不自愈。

### 3a. pg pool error 监听
- **位置**：`server/db/pgSql.js:3`（`new Pool({...})`，全文件无 `pool.on("error")`）。
- 加 `pool.on('error', (err) => { /* log */ })`，**只记日志，不 throw、不退出**。空闲连接被 DB 端断开时 pool 会 emit error，无监听 = uncaughtException。这是 node-postgres 官方文档明确警告的经典崩溃。

### 3b. 全局兜底（注意两者写法不同）
- `process.on('uncaughtException', ...)`：**log 完优雅退出**（记录错误 → 关闭 server/pool → `process.exit(1)`），靠 docker `restart: unless-stopped` 拉起。**不要吞掉继续跑**——进程已处于未定义状态，继续跑更危险。本项目是无状态设计、重启即恢复，这跟优雅退出天然吻合。
- `process.on('unhandledRejection', ...)`：**只 log，不退出。**
- 位置：`server.js`（当前 `3169-3173` 只有 SIGINT/SIGTERM，缺这两个）。

### 3c. 请求分发包 try/catch
- **位置**：`server.js:3141-3149`（`handleApi(req,res)` 裸调用）。此外 handleApi 内有 31 处裸 `decodeURIComponent`（如 `1863/2208-2219/2756`）和 `new URL(reqUrl,"http://"+req.headers.host)`（`1858/3004`，畸形 Host 头 → TypeError）。
- 在 handleApi 最外层包一层 try/catch，捕获 URIError（非法百分号编码如 `/api/student/%zz`）和 TypeError（畸形 Host），返回 **400** 而不是崩进程。不要逐个去改那 31 处——一层外层兜底即可。

**验收标准**：
- `curl .../api/student/%zz` → 返回 400，进程**不崩**。
- 带畸形 `Host` 头的请求 → 400，不崩。
- 模拟 pg pool emit `'error'`（或杀掉 DB 连接）→ 日志有记录，进程**不因此 throw 崩溃**。
- `uncaughtException` 触发时：日志留痕 + 进程退出 + 容器自动重启后可正常服务（无状态恢复）。

---

## 4. 任务 ③：persona 池原子写

**为什么做这条**（跟前两件的动机不同）：这条修的**不是课堂可靠性，是 ISR 论文实验数据的可复现性**。当前"读整行 → 中间夹几秒 `generatePersonaVariant` LLM 调用 → 整行写回"的竞态，会在同队多人同时访谈时，用旧快照写回**静默抹掉别人的 persona 池 → 访谈对象中途换人、结果不可复现、LLM 花费翻倍**。它污染的是 dose-response / fidelity 实验数据，比一节课的影响更持久。

- **位置**：`server/routes/round2Routes.js:1666-1685`（`ensureMemberPersonaPool`）、`1558-1611`、`1630-1640`（`saveAssignments` 无条件全量 upsert）。整队维度分配 + 每人 persona 池挤在一行 JSON。
- **正确写法参照**：round1 的 `server/llm/sessions.js:54-63`，用 PostgreSQL JSONB `||` 做**原子追加/合并**，而不是"读整行→JS 里改→整行覆盖写回"。把 persona 池的写入改成**针对该 member 的条件/JSONB 合并更新**，使并发写不互相覆盖。
- `round2Routes.js:1528-1532` 那句"60 秒锁定 persona"注释是时间窗补丁，根因未除（git 有 `codex/fix-persona-lock-race` 痕迹）——这次把根因修掉。
- **边界**：只改 persona 池的**写入并发安全**。不要改 persona 的生成逻辑、层结构、字段（`under_pressure/blind_zone/effort_style/pricingBias` 等一律不动）。

**验收标准**：
- 同队 2 人并发触发 persona 生成/写入，两人的 persona 池**都保留**，无一方被对方旧快照覆盖（写个并发测试或用两个并发请求验证）。
- 单人流程行为不变。
- 不新增对 `server/llm/` 里生成逻辑的修改。

---

## 5. 交付

- 三个独立 commit（①②③），在 `hardening/*` 分支。
- 每件附：动了哪些文件、验收标准逐条的实测结果（curl 输出 / 测试结果）。
- **不要部署，不要合 main。** 输出 diff 等我审。
- 若任一条在活仓库里与本文件描述不符（行号漂移、函数已重构、问题已被修），**报告差异，不要猜着改**。
