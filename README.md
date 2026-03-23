# EMBA AI机器人生态 Simulation v0.1

> 当前默认前端：`/multiplayer`（React 多人模式新 UI）  
> 旧版单页前端已归档：`/legacy/*`

## 运行方式
1. 在项目根目录运行 `npm run dev`（等价于 `node server.js`）
2. 浏览器打开 `http://localhost:8787/multiplayer`
3. Root 入口 `http://localhost:8787/` 会自动跳转到多人模式
4. 若需查看旧版单页流程，使用 `http://localhost:8787/legacy/index.html`

## 前端构建
- 根目录构建多人前端：`npm run build-client`
- 如需单独启动前端 Vite 开发服务器：`npm run dev-client`
- 注意：`/multiplayer` 实际读取的是 `client/dist`，所以修改 `client/src/*` 后，如果不是跑 Vite 开发服务器，就需要先执行一次 `npm run build-client`

## 当前版本功能
- 12格立方体（B2C/B2B × 差异化/成本领先 × 体验/混合/功能）
- LOVOT 起点默认值
- Round 1 PMF 宏观评分
- Round 2 自动定价（BOM + 毛利/渠道/缓冲）
- 价格驱动销量 + Fit 系数
- 24个月订阅收入/利润
- 两次改参机制（每次最多两项）
- 小组冻结和总利润排名

## 代码结构
- `engine.js`: 计算函数（PMF一致性、自动定价、销量、订阅24个月、风险标签）
- `server.js`: Node + SQLite后端（无第三方依赖）
- `client/src/*`: 多人模式新前端（Round1/2 + VP Coach）
- `legacy/*`: 旧版单页前端及其脚本（仅归档）
- `game_config_v0.1/*.json`: 仿真引擎配置（市场/功能卡/定价/需求/订阅）
- `game_config_v0.1/round1_gm_model.json`: Round1 GM_max 经济学参数
- `example_simulation.js`: 最小示例（调用 `loadConfig + simulate`）

## 仿真引擎（deterministic）
- 引擎入口：`engine.js` 中 `simulate(teamState, config)`。
- Round1入口：`engine.js` 中 `evaluateRound1(teamState, config)`（内部调用 `scoreRound1`）。
- Round2入口：`engine.js` 中 `simulateRound2(teamState, config)`（`simulate` 为其别名）。
- 配置加载：`loadConfig(configDir)`，读取：
  - `market_knowledge.json`
  - `feature_cards.json`
  - `pricing_rules.json`
  - `demand_model.json`
  - `subscription_model.json`
- 无随机数（同输入同输出）。
- 前端 Round2 已切换为调用该 deterministic 引擎（读取 `game_config_v0.1`）。
- Round1 评分同样切到 deterministic 经济代理模型，且明确不使用渠道费和保修项。
- Round2 明确使用渠道费；Round2 定价明确不使用保修项（warranty）。
- Round2 的 `target_gm` 由 Round1 冻结（优先用 `round1.target_gm`，否则用 `round1.target_gm_suggested`）。
- 前端 Round1 必填渠道策略（3选2 + 份额），并通过“冻结 target_gm”后才能进入 Round2 计算。

运行示例：
```bash
cd /Users/weiyang/Dropbox/Github_indiswyang/try/emba-ai-sim-v01
node example_simulation.js
```

## 说明
- 数据为教学模拟参数，不代表真实商业预测。
- 若要在课堂中定制参数，优先编辑 `settings.js`、`cards.js`、`macro-db.js`、`persona-db.js`。

## 学生决策数据存储（已接入）
- 后端可用时：写入 `SQLite(sim.db)`。
- 后端不可用时：自动回退到浏览器 `IndexedDB`。
- 冻结成绩写入 `team_runs`；每次改参写入 `iteration_events`。
- 页面支持“刷新数据库统计”和“导出数据库JSON”。

## API（SQLite后端）
- `POST /api/team-runs`: 保存冻结成绩
- `POST /api/iteration-events`: 保存一次改参事件
- `GET /api/ranking`: 拉取每组最新成绩排名（按总利润降序）
- `GET /api/db-status`: 数据库计数统计
- `GET /api/export`: 导出全部记录(JSON)

## 若要做全班统一数据库（建议下一步）
- 课堂多人同时提交时，建议升级到 `SQLite/Postgres + API`。
- 参考表结构：
```sql
CREATE TABLE team_runs (
  id TEXT PRIMARY KEY,
  team_id TEXT NOT NULL,
  team_name TEXT NOT NULL,
  created_at TEXT NOT NULL,
  setup_json TEXT NOT NULL,
  round1_json TEXT NOT NULL,
  round2_json TEXT NOT NULL,
  history_json TEXT NOT NULL
);

CREATE TABLE iteration_events (
  id TEXT PRIMARY KEY,
  team_id TEXT NOT NULL,
  team_name TEXT NOT NULL,
  iteration_no INTEGER NOT NULL,
  changes_json TEXT NOT NULL,
  delta_profit REAL NOT NULL,
  round2_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);
```
