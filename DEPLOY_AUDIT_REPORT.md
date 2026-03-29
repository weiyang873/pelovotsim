# 部署就绪审计报告

生成时间：2026-03-25 19:08:50 CST

## 总结

- ✅ 已就绪：3 项
- ⚠️ 需要修复：6 项
- ❌ 未处理：1 项

## 详细结果

### 1. API Base URL
状态：⚠️ 需要修复

发现：
- 新前端 API 调用已使用相对路径 `/api`，没有把生产 API 域名写死在浏览器代码里：`client/src/api/teamApi.js:1`、`client/src/api/teacherApi.js:1`、`client/src/api/round2Api.js:1`、`client/src/api/rdApi.js:1`。
- Vite 开发代理仍硬编码到本地后端：`client/vite.config.js:7-10` 使用 `http://127.0.0.1:8787`。这只适用于开发，生产环境必须由 nginx / ingress 代理 `/api`。
- 后端默认监听地址是本地回环：`server.js:50-51` 定义 `HOST = process.env.HOST || "127.0.0.1"`，`server.js:2975-2977` 用该地址启动服务。若 Docker/云主机未显式设置 `HOST=0.0.0.0`，外部无法访问。
- 多个测试/冒烟脚本默认指向本地地址，例如 `scripts/smoke_test_v2.js:11-18`、`scripts/sim/api_client.js:16-20`、`test-marketing.js:6`。这些不是生产前端代码，但容易混淆部署说明。

建议：
- 生产部署显式设置 `HOST=0.0.0.0`。
- 保持前端继续使用相对 `/api`，并在 nginx / ingress 上转发 `/api` 到 Node 服务。
- 将测试脚本里的本地默认地址与生产部署文档明确分开。

### 2. 数据库连接
状态：⚠️ 需要修复

发现：
- 运行时数据库连接已切到 PostgreSQL，且从环境变量读取：`server/db/pgSql.js:3-15` 使用 `DATABASE_URL` 或 `PGHOST/PGPORT/PGUSER/PGPASSWORD/PGDATABASE`。
- 连接池大小为 `20`，空闲超时 `30000ms`，连接超时 `5000ms`：`server/db/pgSql.js:13-15`。按“60 人并发至少 20”的要求，当前配置达标。
- `server.js:53-57` 中的 `DB_PATH` 仅用于启动日志展示，不是实际连接实现。
- 仓库里仍保留 SQLite 迁移/校验脚本：`scripts/migrations/migrate-sqlite-to-postgres.js:6-12`、`scripts/migrations/verify-postgres-migration.js:6-11`，并且 `README.md:63-70` 仍写着“写入 SQLite(sim.db)”，与当前 PostgreSQL 主路径不一致。

建议：
- 运行时继续以 PostgreSQL 为唯一主路径，并把 SQLite 明确标注为“仅迁移工具”。
- 更新部署文档，避免运维人员误以为生产仍依赖 `sim.db`。
- 保持 `pool max = 20` 作为起点，压测后按真实连接占用再调优。

### 3. DeepSeek API 并发与错误处理
状态：❌ 未处理

发现：
- DeepSeek API key 通过环境变量读取，这点是正确的：`server/llm/deepseekClient.js:12-16`。
- 共享调用器没有超时控制：`server/llm/deepseekClient.js:25-58` 只创建 `http/https.request`，没有 `AbortController`、`req.setTimeout()` 或任何超时兜底。上游卡住时，请求可能长期悬挂。
- 共享调用器没有 429 / 5xx / 网络抖动重试：同一文件 `server/llm/deepseekClient.js:25-58` 不包含退避重试逻辑。
- 生产代码中的多个调用点都直接依赖这个共享调用器，例如 `server/routes/teamRoutes.js:816-824`、`server/routes/round2Routes.js:937-945`、`server/routes/teacherDebrief.js:615-620`、`server/routes/teacherDebrief.js:672-677`、`server/llm/vpCoach.js:447-452`。
- 唯一能看到的“重试”只是解析失败后二次要求模型输出 JSON，不是网络/限流重试：`server/llm/requirementBuilder.js:103-117`。
- 没有统一的出站并发控制。`server.js:323-332` 与 `server.js:772-775` 的 rate limit 只覆盖一类 LLM wizard 请求，不覆盖全部 DeepSeek 调用链。
- 错误处理不一致：有些路由在顶层 `.catch()` 返回 500，例如 `server.js:1978-1980`、`server.js:2005-2006`；也有逻辑本地吞掉异常后降级为 `null`，如 `server/routes/round2Routes.js:937-953`。

建议：
- 在 `server/llm/deepseekClient.js` 统一增加请求超时。
- 在共享客户端增加 429 / 5xx / `ECONNRESET` / `ETIMEDOUT` 的指数退避重试。
- 在共享客户端前增加 semaphore / 队列，限制同时出站的 DeepSeek 请求数。
- 统一调用失败的返回策略，不要有的直接报错、有的静默降级。

### 4. 前端构建
状态：✅ 已处理

发现：
- `client` 构建成功，产物输出到 `client/dist/`。本次审计执行 `npm run build` 已通过。
- 构建后的入口文件是 `client/dist/index.html`，资源路径为 `/multiplayer/assets/...`：`client/dist/index.html:7-8`。
- 该路径与 `client/vite.config.js:5` 的 `base: "/multiplayer/"` 一致。
- 对构建产物执行 `rg 'localhost|127.0.0.1' client/dist` 无匹配，未发现本地地址残留。

建议：
- 若生产就部署在 `/multiplayer/` 路径下，当前产物可直接用。
- 若未来部署路径变化到根路径或其他子路径，需要同步调整 Vite `base`。

### 5. 静态文件服务
状态：✅ 已处理

发现：
- 静态文件服务逻辑不在 `server/` 子目录，而在根目录 `server.js`，这一点需要注意。
- `/multiplayer` 路由会从 `client/dist` 读取文件：`server.js:2841-2868`。
- `/admin` 与 `/teacher` 也复用同一个 `client/dist`，并带有 fallback 到 `index.html`：`server.js:2871-2898`。
- 所有非 `/api/` 请求最终都会进入静态资源分发：`server.js:2922-2929`。

建议：
- 当前 Node 服务已经具备生产级静态资源托管与 SPA fallback 的基本能力。
- 如果前面再接 nginx，需保持同样的 `index.html` fallback 行为。

### 6. WebSocket / SSE / 流式响应
状态：✅ 已处理

发现：
- 全仓库未发现对外暴露的 `EventSource`、`WebSocket`、`ws://`、`text/event-stream` 接口。
- `server.js:1989-1993` 与 `server.js:2634-2658` 的 `res.writeHead()` 只是普通文件下载响应，不是流式长连接。
- `server/llm/chatService.js:3-49` 确实存在一个 Anthropic 流式辅助函数，但仓库内没有调用点；`rg 'streamChatCompletion\\(' .` 只命中定义本身。

建议：
- 当前部署不需要为 WebSocket / SSE 单独配置 keepalive。
- 如果未来启用真实流式接口，应补上 `Cache-Control: no-cache`、`Connection: keep-alive` 和心跳包。

### 7. 文件路径与权限
状态：⚠️ 需要修复

发现：
- 运行时会写入 `data/llm_logs`：`server/llm/llm_logger.js:6-7`、`server/llm/llm_logger.js:79-81`。
- 运行时会写入 `data/tag_cache.json`：`server/llm/tagExtractor.js:8`、`server/llm/tagExtractor.js:19-22`、`server/llm/tagExtractor.js:106-108`。
- 运行时会写入 `data/score_cache.json`：`server/llm/dimensionScorer.js:7`、`server/llm/dimensionScorer.js:18-21`、`server/llm/dimensionScorer.js:47-48`。
- embedding 模型缓存默认落在 `$HOME/.cache/huggingface`，除非显式指定 `HF_CACHE_DIR` 或 `HF_LOCAL_MODEL_PATH`：`server/llm/embeddingService.js:7-16`、`server/llm/embeddingService.js:23-29`、`server/llm/embeddingService.js:54-71`。
- 迁移工具仍会读取根目录 `sim.db`：`scripts/migrations/migrate-sqlite-to-postgres.js:6-10`，但这不是生产运行路径。

建议：
- Docker 镜像内必须保证应用目录下 `data/` 可写。
- 若要持久化日志/缓存，给 `data/` 挂 volume。
- 若容器是只读根文件系统，需提前指定可写缓存目录，并为 HuggingFace 模型缓存单独挂载 volume。
- 若生产环境禁止在线拉模型，预烘焙模型并设置 `HF_LOCAL_MODEL_PATH`，必要时加 `HF_DISABLE_REMOTE=1`。

### 8. 环境变量完整性
状态：⚠️ 需要修复

发现：
- 生产必填变量：
  - `ADMIN_CODE`，无默认值：`server/routes/adminRoutes.js:9-14`、`server/routes/teacherDebrief.js:51-56`。
  - `DEEPSEEK_API_KEY`，无默认值：`server/llm/deepseekClient.js:12-16`。
  - 数据库连接信息：`DATABASE_URL` 或 `PGHOST/PGPORT/PGUSER/PGPASSWORD/PGDATABASE`：`server/db/pgSql.js:3-15`。
- 生产可选但常见变量：
  - `PORT` 默认 `8787`、`HOST` 默认 `127.0.0.1`：`server.js:50-51`。
  - `PGSSL` 默认关闭：`server/db/pgSql.js:10-12`。
  - `DEEPSEEK_MODEL` 默认 `deepseek-chat`、`DEEPSEEK_BASE_URL` 默认 `https://api.deepseek.com`：`server/llm/deepseekClient.js:13-14`。
  - `LLM_LOG` 默认开启：`server/llm/llm_logger.js:6-7`。
  - `HF_CACHE_DIR`、`HF_LOCAL_MODEL_PATH`、`HF_DISABLE_REMOTE` 影响 embedding 模型加载与缓存：`server/llm/embeddingService.js:7-16`、`server/llm/embeddingService.js:27-29`。
  - `ANTHROPIC_API_KEY` 仅在未来启用 `server/llm/chatService.js` 时需要：`server/llm/chatService.js:3-7`。
- 测试/脚本专用变量也很多，如 `BASE_URL`、`TEAM_SIZE`、`NUM_TEAMS`、`CONCURRENCY`、`SKIP_LLM`、`SKIP_ROUND2`、`STRICT_DEEPSEEK`、`BATCH_ROUNDS`、`BATCH_SLEEP_MS`、`PERSONA_IDS`、`FIXED_TAU`、`FIXED_CAP`、`LOG_LEVEL`、`TRIAL_CODE`、`NODE_ENV` 等，来源分散在 `scripts/`、`server.js` 与工具脚本。
- 仓库内没有统一的 `.env.example` 或部署变量清单。

建议：
- 补一份部署变量清单，把“生产必填 / 生产可选 / 测试专用”分开。
- 启动时对 `ADMIN_CODE`、`DEEPSEEK_API_KEY`、数据库连接变量做 fail-fast 校验。
- 明确写出生产推荐值，尤其是 `HOST=0.0.0.0`、是否启用 `PGSSL`、以及 HuggingFace 缓存目录。

### 9. 数据库初始化脚本
状态：⚠️ 需要修复

发现：
- 有独立初始化脚本，但它是 Node 脚本，不是 `.sql`：`scripts/migrations/init-postgres-schema.js:1-258`。
- 应用启动时也会自动建表：`server.js:105-176` 创建核心表，`server.js:2963-2969` 在启动阶段调用 `initDb()`、`ensureTeamSchema()`、`Round2.ensureSchema()`、`TeacherDebrief.ensureSchema()`、`TeacherConsole.ensureSchema()`、`Sessions.ensureSchema()`、`MarketingSessions.ensureSchema()`。
- 多人模式相关表会在模块内自动创建，例如 `server/multiplayer/teamManager.js:14-110`、`server/multiplayer/computationLog.js:75-97`、`server/multiplayer/round2State.js:146-157`。
- 当前仓库没有可直接放进 `docker-entrypoint-initdb.d/` 的 `.sql` 文件。

建议：
- 在 Docker/CI/CD 中明确“谁负责建表”。更稳妥的做法是把初始化作为独立步骤，而不是依赖应用首次启动自动 DDL。
- 如果继续依赖启动自动建表，必须确保应用连接账号拥有 `CREATE/ALTER` 权限。
- 最好补一份可审阅的 SQL 初始化脚本，方便 DBA 或托管数据库环境接入。

### 10. package.json 入口与脚本
状态：⚠️ 需要修复

发现：
- 根目录 `package.json` 没有 `main`，也没有 `start` 脚本：`package.json:4-9`。
- 后端入口只能从 `dev` 脚本推断为 `node server.js`：`package.json:5`。
- 前端构建脚本是根目录 `build-client` 与 `client/package.json:6-9` 的 `build`。

建议：
- Dockerfile / PaaS 需要显式用 `node server.js` 作为后端启动命令，不能依赖 `npm start`。
- 若要兼容通用部署平台，建议后续补上 `start` 脚本。
- 当前前端 build 命令已明确，可直接用于镜像构建阶段。
