# AGENTS.md

## 1) 如何启动 dev

项目是原生 HTML + Vanilla JS + Node.js（无 Next.js/React、无 npm scripts）。

> 当前默认 UI：`/multiplayer`（多人模式新前端）。  
> 旧版单页 `index.html / round1.html / round2.html` 已归档到 `legacy/`，仅做兼容参考。

推荐后端模式（SQLite + API）：
```bash
cd /Users/weiyang/Dropbox/Github_indiswyang/try/emba-ai-sim-v01
node server.js
```
浏览器打开：
- `http://127.0.0.1:8787/multiplayer`（多人 Round 1）
- `http://127.0.0.1:8787/multiplayer/round2`（多人 Round 2）
- `http://127.0.0.1:8787/`（会跳转到多人入口）
- 旧版归档入口：`http://127.0.0.1:8787/legacy/index.html`

纯静态模式（不启服务）：
- 直接打开 `round1.html` / `round2.html`（会回退到本地 IndexedDB，且部分 API 能力不可用）

## 2) 如何跑测试 / lint

当前仓库没有 ESLint/Prettier 配置，也没有 `package.json` 脚本。

Round 1 回归测试：
```bash
node tests/round1_wtp_decimal.test.js
```

语法检查（作为轻量 lint 替代）：
```bash
node --check app.js
node --check engine.js
node --check server.js
```

## 3) Round 1 相关文件路径

前端页面：
- `/Users/weiyang/Dropbox/Github_indiswyang/try/emba-ai-sim-v01/round1.html`：Round 1 独立页面
- `/Users/weiyang/Dropbox/Github_indiswyang/try/emba-ai-sim-v01/index.html`：导航入口

前端状态管理与交互：
- `/Users/weiyang/Dropbox/Github_indiswyang/try/emba-ai-sim-v01/app.js`
  - 全局状态对象：`state`
  - 本地持久化：`LOCAL_STATE_KEY = "emba_ai_sim_state_v1"` + `localStorage`
  - Round 1 主流程：`runRound1()`、`freezeTargetGm()`、`resetRound1()`
  - Round 1 渠道输入：`round1ChannelsAndShare()`
  - Round 1 API 调用：通过 `ApiClient.computeRound1(...)`

前端 API 封装：
- `/Users/weiyang/Dropbox/Github_indiswyang/try/emba-ai-sim-v01/api-client.js`
  - `computeRound1(payload)` -> `POST /api/round1-gm`

服务端路由：
- `/Users/weiyang/Dropbox/Github_indiswyang/try/emba-ai-sim-v01/server.js`
  - Round 1 路由：`POST /api/round1-gm`
  - 调用引擎：`Engine.computeRound1(...)`

引擎与配置：
- `/Users/weiyang/Dropbox/Github_indiswyang/try/emba-ai-sim-v01/engine.js`
  - Round 1 核心函数：`computeRound1GM(teamState, knowledge, params)`
  - 兼容入口：`computeRound1(...)` / `evaluateRound1(...)`
- `/Users/weiyang/Dropbox/Github_indiswyang/try/emba-ai-sim-v01/game_config_v0.1/round1_gm_model.json`
- `/Users/weiyang/Dropbox/Github_indiswyang/try/emba-ai-sim-v01/game_config_v0.1/round1_market_knowledge.json`
  - 若存在，Round 1 优先读取；否则回退到 `market_knowledge.json`

## 4) 代码风格 / 命名约定

- 语言与模块：CommonJS（`require/module.exports`）+ 浏览器全局脚本。
- 缩进：2 空格。
- 字符串：JS 代码以双引号为主。
- 语句结尾：使用分号。
- 命名：
  - 变量/函数：`camelCase`（如 `runRound1`, `computeRound2`）
  - 常量：`UPPER_SNAKE_CASE`（如 `LOCAL_STATE_KEY`）
  - DOM 引用集中在 `els` 对象。
- 状态结构：统一放在 `state`，Round 1/2 数据挂在 `state.activeTeam.round1`、`state.activeTeam.round2`。
- 计算逻辑：
  - 引擎保持 deterministic（同输入同输出，不使用随机数）
  - 配置优先从 `game_config_v0.1/*.json` 读取，不硬编码业务参数。
# AGENTS.md — 多人模式升级补丁（追加到现有 AGENTS.md 末尾）

---

## 多人模式升级（v0.2）

### 目标
在现有 Round 1/Round 2 基础上新增多人协作层。**不修改现有计算逻辑和 LLM 模块。**

### 核心规格
详见 `docs/MULTIPLAYER_SPEC.md`（必读）。

### 关键约束
1. **数据库仍用 SQLite**，新增 4 张表（teams, team_members, member_submissions, jinang_settlements）
2. **锦囊配置**在 `game_config_v0.1/jinang_cards.json`，运行时只读
3. **不动的文件**：`server/llm/*` 全部、`game_config_v0.1/grid_priors*.json`、现有 Round 1/2 计算模块
4. **Phase 3 的 VP Coach** 调用现有 `server/llm/vpCoach.js`，不要重写
5. **前端风格**保持与现有页面一致（深色 header、白色卡片、绿色按钮）

### 新模块位置
```
server/multiplayer/     ← 新增目录，所有多人逻辑放这里
server/routes/teamRoutes.js  ← 新路由
pages/ 或 views/        ← 5 个新 HTML 页面
```

### 测试
每个 task 完成后运行 `node scripts/smoke-multiplayer.mjs`（需新建此脚本）。
