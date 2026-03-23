# 多人模式前端迁移：React 单页应用

> 目标：把多人模式前端从服务端渲染 HTML 改为 React 单页应用，UI 100% 复用已有的 JSX 原型。
> 后端 Express 只提供 API，不再渲染多人模式的 HTML 页面。
> **现有的单人模式 Round 1 / Round 2 页面完全不动。**

---

## 第一步：搭建 React 前端环境

在项目根目录下新建 `client/` 目录，用 Vite + React 初始化：

```bash
cd EMBA-AI-SIM-V01
npm create vite@latest client -- --template react
cd client
npm install
```

配置 `client/vite.config.js`，添加开发代理指向后端：

```js
export default {
  server: {
    proxy: {
      '/api': 'http://127.0.0.1:8787',
    }
  }
}
```

生产环境构建后，让 Express 托管 `client/dist/` 静态文件。在 `server.js` 中添加：

```js
const path = require('path');
app.use('/multiplayer', express.static(path.join(__dirname, 'client/dist')));
app.get('/multiplayer/*', (req, res) => {
  res.sendFile(path.join(__dirname, 'client/dist/index.html'));
});
```

这样：
- 开发时：`cd client && npm run dev`（端口 5173），API 代理到 8787
- 生产时：`npm run build` 后 Express 直接托管，访问 `/multiplayer` 进入 React 应用

---

## 第二步：迁移原型代码

把 `docs/Round1_multiplayer_prototype.jsx` 作为 React 应用的**主组件**。

文件结构：

```
client/
  src/
    App.jsx                  ← 路由入口
    pages/
      MultiplayerFlow.jsx    ← 从原型 JSX 迁移过来的主组件（6步流程）
    components/
      StepBar.jsx            ← 步骤条组件
      JinangCard.jsx         ← 锦囊翻牌卡片
      GridSelector.jsx       ← 12格选择器（4行×3列）
      VPCoachChat.jsx        ← VP Coach 对话组件
      ResultsPanel.jsx       ← 结果展示组件
    api/
      teamApi.js             ← 封装所有后端 API 调用
    styles/
      global.css             ← 全局样式（从原型提取）
```

### 关键：从原型 JSX 提取组件

原型是一个完整的单文件组件，包含所有 6 个步骤。把它拆分：

**MultiplayerFlow.jsx**（主流程控制）：
- 保留原型的 state 管理（currentStep、teamData、memberData 等）
- 保留原型的步骤条逻辑
- 保留原型的所有 CSS 样式（可以用 CSS modules 或直接内联）
- 把每步的内容拆成子组件

**但第一步可以简单粗暴**：直接把原型 JSX 整个复制为 MultiplayerFlow.jsx，只做以下改动：
1. 把原型中的模拟数据（mock data）替换为真实 API 调用
2. 添加 `import` 语句
3. 导出为默认组件

---

## 第三步：API 层对接

原型中所有需要和后端交互的地方，创建 `client/src/api/teamApi.js`：

```js
const BASE = '/api';

export async function createTeam(teamName, teamSize) {
  const res = await fetch(`${BASE}/team/create`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ teamName, teamSize })
  });
  return res.json();
}

export async function joinTeam(teamId, memberName) {
  const res = await fetch(`${BASE}/team/${teamId}/join`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ memberName })
  });
  return res.json();
}

export async function getMemberJinang(teamId, memberId) {
  const res = await fetch(`${BASE}/team/${teamId}/member/${memberId}/jinang`);
  return res.json();
}

export async function submitPersonalChoice(teamId, memberId, choice) {
  const res = await fetch(`${BASE}/team/${teamId}/phase1/${memberId}/submit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(choice)
  });
  return res.json();
}

export async function getTeamStatus(teamId) {
  const res = await fetch(`${BASE}/team/${teamId}/status`);
  return res.json();
}

export async function getSubmissions(teamId) {
  const res = await fetch(`${BASE}/team/${teamId}/submissions`);
  return res.json();
}

export async function submitVPForCoach(teamId, vpData) {
  const res = await fetch(`${BASE}/team/${teamId}/phase3/submit-vp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(vpData)
  });
  return res.json();
}

export async function finalizeDecision(teamId, finalData) {
  const res = await fetch(`${BASE}/team/${teamId}/phase3/finalize`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(finalData)
  });
  return res.json();
}

export async function getResults(teamId) {
  const res = await fetch(`${BASE}/team/${teamId}/phase4`);
  return res.json();
}

export async function freezeTargetGM(teamId) {
  const res = await fetch(`${BASE}/team/${teamId}/freeze`, {
    method: 'POST'
  });
  return res.json();
}
```

---

## 第四步：后端 API 整理

确保 `server/routes/teamRoutes.js` 提供以下 API（大部分已存在，检查并补齐）：

| 方法 | 路径 | 功能 |
|------|------|------|
| POST | /api/team/create | 建组 + 自动发锦囊 |
| POST | /api/team/:teamId/join | 加入小组 |
| GET | /api/team/:teamId/status | 获取团队状态 + 提交进度 |
| GET | /api/team/:teamId/member/:memberId/jinang | 获取个人锦囊（只返回 name + desc_for_player） |
| POST | /api/team/:teamId/phase1/:memberId/submit | 提交个人选择 |
| GET | /api/team/:teamId/submissions | 获取所有成员提交（Phase 2 分布图用） |
| POST | /api/team/:teamId/phase3/submit-vp | 提交 VP 给 Coach 评分 |
| POST | /api/team/:teamId/phase3/finalize | 确认最终方案 |
| GET | /api/team/:teamId/phase4 | 获取结果（含锦囊结算） |
| POST | /api/team/:teamId/freeze | 冻结 target_gm |

所有 API 统一返回 JSON，不再返回 HTML。如果现有路由中有返回 HTML 的（比如 `res.sendFile`），改为返回 JSON 数据。

---

## 第五步：状态同步

在 React 端实现轮询：

```jsx
// 在 MultiplayerFlow.jsx 中
useEffect(() => {
  if (!teamId) return;
  const interval = setInterval(async () => {
    const status = await getTeamStatus(teamId);
    setTeamStatus(status);
    // 自动推进步骤
    if (status.status === 'phase2' && currentStep < 4) setCurrentStep(4);
    if (status.status === 'phase4' && currentStep < 6) setCurrentStep(6);
  }, 3000);
  return () => clearInterval(interval);
}, [teamId, currentStep]);
```

---

## 第六步：删除旧的多人模式 HTML 页面

迁移完成后，删除以下文件（它们被 React 替代了）：
- phase1-personal.html
- phase2-distribution.html
- phase3-vp-coach.html
- phase4-results.html
- multiplayer-flow.html（如果存在）

不要删除：
- round1.html（单人模式，保留）
- round2.html（保留）
- 首页 index.html（保留，但更新多人入口链接指向 /multiplayer）

---

## 第七步：首页入口更新

修改首页，把"新建多人小组"按钮的链接改为 `/multiplayer`：

```html
<a href="/multiplayer" class="btn">新建多人小组</a>
```

用户点击后进入 React 应用，在 React 内部完成建组、加入、6 步流程。

---

## 锦囊数据源

确保使用 `game_config_v0.1/jinang_cards_v2.json`（不是 v1）。
确保 M-07 的内容是"异业合作与跨界资源整合"（不是跨境相关）。

---

## 绝对不要动的文件

- `server/llm/*` 所有文件
- `server/routes/` 中非 team 相关的路由
- round1.html、round2.html 及其关联的单人模式逻辑
- game_config_v0.1/ 中除 jinang_cards 外的其他 JSON
- GM_max 计算逻辑
- Round 2 scoring 全链条

---

## 执行顺序建议

1. 先搭 Vite + React 环境，确认 `npm run dev` 能跑起来
2. 把原型 JSX 复制为 MultiplayerFlow.jsx，确认页面能渲染
3. 创建 API 层（teamApi.js），逐个对接后端
4. 确保后端所有 API 返回 JSON
5. 实现状态同步轮询
6. 删除旧 HTML 页面，更新首页入口
7. 全流程测试：建组 → 锦囊 → 选战略 → 分布图 → VP Coach → 结果
