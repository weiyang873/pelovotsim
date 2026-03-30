# 部署就绪审计报告

生成时间：2026-03-30 15:17:37 CST

## 总结

- ✅ 已就绪：3 项
- ⚠️ 需要修复：5 项
- ❌ 未处理：2 项

## 详细结果

### 1. API Base URL
状态：⚠️ 需要修复

发现：
- 前端运行时代码已经统一使用相对路径 `/api`，未发现把生产 API 主机写死在 React 代码里，例如 `client/src/api/teamApi.js:1-170`、`client/src/api/round2Api.js:1-180`、`client/src/api/teacherApi.js:1-196`。
- Vite 开发代理仍硬编码到本地地址 `http://127.0.0.1:8787`，见 `client/vite.config.js:7-10`。这只影响开发环境，但也说明生产环境必须由 Node 或 nginx 接管 `/api` 转发。
- 后端监听地址默认是 `127.0.0.1`，见 `server.js:50-57`。如果容器里没有显式设置 `HOST=0.0.0.0`，服务默认不会对外暴露。
- 多个测试/压测脚本仍写死 `http://127.0.0.1:8787`，例如 `scripts/test_round1_e2e.js:14`、`scripts/test_round2_e2e.js:14`、`scripts/smoke_test_round1.js:15`、`scripts/smoke_test_v2.js:16`、`scripts/ai_simulation_test.js:57`、`scripts/batch_sim_test.js:432`。

建议：
- 生产部署时明确设置 `HOST=0.0.0.0`，不要依赖 `server.js:51` 的默认值。
- 保持前端调用相对路径 `/api`，不要回退到绝对域名。
- 如果生产用 nginx，补一条 `/api -> Node` 的反向代理规则，等价替代 `client/vite.config.js:7-10` 的开发代理。
- 把测试脚本里的默认 `BASE_URL` 标成“仅本地测试默认值”，避免被误用到 CI/CD 或运维脚本。

### 2. 数据库连接
状态：⚠️ 需要修复

发现：
- PostgreSQL 连接读取自环境变量，没有在源码中硬编码连接串，见 `server/db/pgSql.js:3-15`。
- 连接池 `max: 20`，满足“60 人并发建议至少 20”的基线，见 `server/db/pgSql.js:13-15`。
- 服务端启动日志仍保留一个混淆性的 `DB_PATH` 拼接字符串，见 `server.js:53-57`、`server.js:3092-3095`。它不是实际连接实现，但会让运维误以为数据库配置来自这个值。
- 运行时主路径已经是 PostgreSQL，但仓库文档仍大面积写着 SQLite，例如 `README.md:29`、`README.md:63-77`、`AGENTS.md:10-19`、`AGENTS.md:98-99`。
- SQLite 迁移脚本仍保留在仓库中，属于迁移工具而非线上运行依赖，例如 `scripts/migrations/migrate-sqlite-to-postgres.js:7-12`、`scripts/migrations/verify-postgres-migration.js:7-24`。

建议：
- 部署文档统一声明“生产数据库为 PostgreSQL”，把 SQLite 限定为历史迁移工具。
- 清理或重命名 `server.js:53-57` 的 `DB_PATH` 日志语义，避免和真实连接配置混淆。
- 为运维提供明确的 PostgreSQL 配置方式：`DATABASE_URL` 或 `PGHOST/PGPORT/PGUSER/PGPASSWORD/PGDATABASE` 二选一。

### 3. DeepSeek API 并发与错误处理
状态：⚠️ 需要修复

发现：
- DeepSeek API key 来自环境变量，未在源码中硬编码，见 `server/llm/deepseekClient.js:117-121`。
- 已实现超时控制，默认 `60000ms`，见 `server/llm/deepseekClient.js:5`、`server/llm/deepseekClient.js:95-99`。
- 已实现错误处理和有限重试；`429`、`5xx`、超时和部分网络错误会重试 1 次，见 `server/llm/deepseekClient.js:24-29`、`server/llm/deepseekClient.js:131-150`。
- 主要调用点通常会记录日志并在上层兜底，例如 `server/routes/teamRoutes.js:1022-1065`、`server/routes/round2Routes.js:1031-1047`、`server/routes/round2Routes.js:2571-2579`、`server/routes/round2Routes.js:3112-3134`、`server/routes/teacherDebrief.js:929-995`。
- 但服务端未发现统一的并发控制器。`server/` 内对 `chatCompletion(...)` 的调用是直接发出的，例如 `server/routes/teamRoutes.js:1027-1035`、`server/routes/round2Routes.js:1032-1038`、`server/routes/teacherDebrief.js:929-934`；检索 `server/` 未发现 `p-limit`、semaphore、队列或类似限流器。
- 本地 `.env` 含有真实 `DEEPSEEK_API_KEY` 配置项，见 `.env:7`；虽然该文件未加入索引，但生产镜像和运维流程仍应避免把本地密钥打包进去。

建议：
- 在 `chatCompletion` 外层增加服务端并发闸门或请求队列，至少按实例总并发数做限制。
- 将 `MAX_RETRIES=1` 提升为可配置项，并对 `429` 做指数退避，而不是固定 2 秒重试。
- 把 DeepSeek 降级策略写清楚：哪些端点失败后返回 fallback，哪些端点必须显式报错。
- 确认部署流程不会把本地 `.env` 复制进镜像或公开到日志。

### 4. 前端构建
状态：✅ 已处理

发现：
- `client/package.json:6-9` 定义了标准构建命令 `vite build`。
- 实际执行 `cd client && npm run build` 成功，产物输出到 `client/dist/`，包含 `index.html`、`assets/`、`docs/`。
- 构建产物 `client/dist/index.html:7-8` 使用的是 `/multiplayer/assets/...` 绝对路径，与 `client/vite.config.js:5` 的 `base: "/multiplayer/"` 一致。
- 对 `client/dist/` 进行 `localhost|127.0.0.1` 检索，没有匹配结果。

建议：
- 如果生产不是部署在 `/multiplayer/` 子路径，而是挂在域名根路径或别的子路径，需要同步调整 `client/vite.config.js:5`。

### 5. 静态文件服务
状态：✅ 已处理

发现：
- Node 后端已经内建静态资源服务和 SPA fallback。
- `/multiplayer` 会从 `client/dist` 提供文件，并在资源不存在时回退到 `client/dist/index.html`，见 `server.js:2930-2957`。
- `/admin`、`/teacher` 也会回退到 `client/dist/index.html`，见 `server.js:2988-3015`。
- `/docs/*` 和 `/legal/terms_zh.md` 也有单独静态出口，见 `server.js:2905-2927`、`server.js:2960-2970`。
- 非 `/api/*` 请求统一进入 `serveStatic()`，见 `server.js:3039-3047`。

建议：
- 如果后续改为 nginx 直出前端静态文件，需要把 `/multiplayer`、`/admin`、`/teacher` 的 fallback 规则完整迁过去。

### 6. WebSocket / SSE / 流式响应
状态：✅ 已处理

发现：
- 在前后端检索中，没有发现对外暴露的 `EventSource`、`text/event-stream`、`WebSocket`、`ws://` 或 `res.write` 持续流式接口。
- 仓库中唯一明确的“流式”实现是上游 Anthropic 流读取助手 `server/llm/chatService.js:3-49`，它是服务端消费上游流，不是向浏览器提供 SSE/WebSocket。
- 因此当前部署不依赖反向代理对 SSE/WebSocket 的特殊保活配置。

建议：
- 当前无需为 SSE/WebSocket 添加 nginx 特殊配置。
- 如果后续把 `server/llm/chatService.js` 暴露成浏览器可访问流式接口，需要补上 `Cache-Control: no-cache`、`Connection: keep-alive` 和心跳机制。

### 7. 文件路径与权限
状态：⚠️ 需要修复

发现：
- 运行时会写入 `data/llm_logs/`，见 `server/llm/llm_logger.js:6-15`、`server/llm/llm_logger.js:72-82`。
- 运行时会写入 `data/tag_cache.json`，见 `server/llm/tagExtractor.js:8-22`。
- 运行时会写入 `data/score_cache.json`，见 `server/llm/dimensionScorer.js:7-21`。
- Embedding 模型默认使用 `$HOME/.cache/huggingface` 作为缓存目录，见 `server/llm/embeddingService.js:7-16`。如果本地缓存不完整，还会尝试在线拉取模型，见 `server/llm/embeddingService.js:54-71`。
- 数据库存储本身已经不写本地 `.db/.sqlite` 文件，主路径走 PostgreSQL；根目录里的 `sim.db`、`db.sqlite` 更像历史文件，不是当前运行主依赖。

建议：
- 容器内至少保证这两个位置可写：项目内 `data/`，以及 `HF_CACHE_DIR` 指向的模型缓存目录。
- 生产建议显式设置 `HF_CACHE_DIR`、`HF_LOCAL_MODEL_PATH`，不要默认落到 `$HOME/.cache/...`。
- 如果部署环境禁止在线下载模型，必须提前把 embedding 模型预热到本地缓存，并设置 `HF_DISABLE_REMOTE=1` 验证启动行为。

### 8. 环境变量完整性
状态：❌ 未处理

发现：
- `.env.example:1-5` 只覆盖了 DeepSeek 相关变量，没有覆盖 PostgreSQL、管理口令、监听地址、embedding 缓存等部署必需项。
- 代码中实际依赖的运行时环境变量至少包括：
  - 数据库：`DATABASE_URL` 或 `PGHOST/PGPORT/PGUSER/PGPASSWORD/PGDATABASE`，见 `server/db/pgSql.js:3-15`。
  - 服务监听：`PORT`、`HOST`，见 `server.js:50-57`。
  - 管理端：`ADMIN_CODE`，见 `server/routes/adminRoutes.js:10-14`、`server/routes/teacherDebrief.js:64-67`。
  - 试用入口：`TRIAL_CODE`，见 `server.js:1889`。
  - DeepSeek：`DEEPSEEK_API_KEY`、`DEEPSEEK_BASE_URL`、`DEEPSEEK_MODEL`、`DEEPSEEK_TIMEOUT_MS`，见 `server/llm/deepseekClient.js:5`、`server/llm/deepseekClient.js:117-129`。
  - 日志：`LLM_LOG`、`LLM_DEBUG`，见 `server/llm/llm_logger.js:6-7`、`server.js:622`。
  - Embedding：`HF_CACHE_DIR`、`HF_LOCAL_MODEL_PATH`、`HF_DISABLE_REMOTE`、`HOME`，见 `server/llm/embeddingService.js:7-16`、`server/llm/embeddingService.js:23-31`。
  - 可选上游：`ANTHROPIC_API_KEY`，见 `server/llm/chatService.js:3-5`。
- 测试/压测脚本还依赖一组只在脚本场景使用的变量：`BASE_URL`、`NUM_TEAMS`、`TEAM_SIZE`、`CONCURRENCY`、`LOG_LEVEL`、`STRICT_DEEPSEEK`、`SKIP_LLM`、`SKIP_ROUND`、`BATCH_ROUNDS`、`BATCH_SLEEP_MS`、`PERSONA_IDS`、`FIXED_TAU`、`FIXED_CAP`，见 `scripts/ai_simulation_test.js:57-62`、`scripts/batch_sim_test.js:432-439`、`scripts/persona_sim_test.js:179-184`、`scripts/smoke_test_round1.js:15-17`、`scripts/smoke_test_v2.js:16-18`。
- 本地 `.env:1-9` 已经存在一份“真实运行配置”，但它不是正式部署模板，也没有说明哪些变量是必填、哪些有默认值。

建议：
- 新增正式的部署模板，例如 `.env.production.example`，至少列出：
  - 必填：`DATABASE_URL` 或 `PG*` 全套、`ADMIN_CODE`、`DEEPSEEK_API_KEY`
  - 强烈建议显式设置：`HOST=0.0.0.0`、`PORT`、`TRIAL_CODE`、`PGSSL`
  - embedding 相关：`HF_CACHE_DIR`、`HF_LOCAL_MODEL_PATH`、`HF_DISABLE_REMOTE`
  - 可选：`DEEPSEEK_BASE_URL`、`DEEPSEEK_MODEL`、`DEEPSEEK_TIMEOUT_MS`、`LLM_LOG`、`LLM_DEBUG`、`ANTHROPIC_API_KEY`
- 在文档里明确区分“运行时必需变量”和“测试脚本变量”。
- 不要把本地 `.env` 当作部署契约；部署系统应单独管理 secrets。

### 9. 数据库初始化脚本
状态：⚠️ 需要修复

发现：
- 没有独立的 `.sql` 初始化文件可直接放进 `docker-entrypoint-initdb.d/`。
- 但存在独立的 Node 初始化脚本 `scripts/migrations/init-postgres-schema.js:4-259`，能创建主要 PostgreSQL 表和索引。
- 应用启动时也会自动建表：`server.js:3078-3095` 会调用 `initDb()`、`ensureTeamSchema()`、`Round2.ensureSchema()`、`TeacherDebrief.ensureSchema()` 等。
- 核心多人表 `teams`、`team_members`、`member_submissions`、`jinang_settlements` 也会在运行时自动创建，见 `server/multiplayer/teamManager.js:15-120`。

建议：
- 如果计划把数据库初始化前置到 PostgreSQL 容器阶段，补一份纯 SQL schema 文件。
- 如果继续采用“应用首次启动自动建表”，要把这一点写进部署说明，并在健康检查前确认数据库账号具备 `CREATE TABLE/ALTER TABLE/CREATE INDEX` 权限。
- 将 `scripts/migrations/init-postgres-schema.js` 纳入部署文档或镜像入口，避免首次启动依赖隐式行为。

### 10. package.json 入口与脚本
状态：❌ 未处理

发现：
- 根目录 `package.json:4-9` 只有 `dev`、`build-client`、`dev-client`、`preview-client`，没有 `main` 字段，也没有 `start` 脚本。
- 后端真实入口仍然是 `server.js`，可从 `package.json:5` 和 `server.js:3075-3100` 推断出来，但这没有被正式声明为生产入口。
- 前端 `client/package.json:6-9` 已经具备清晰的 `build` 脚本，这部分没有问题。

建议：
- 至少补一个正式生产入口约定：
  - 方案 A：在根 `package.json` 增加 `start: "node server.js"`
  - 方案 B：在 Dockerfile/Procfile/systemd 中明确写 `node server.js`
- 如果希望工具链自动识别入口，再补 `main: "server.js"`。
- 在部署文档中把“后端启动命令”和“前端构建命令”分别写死，避免运维猜测。
