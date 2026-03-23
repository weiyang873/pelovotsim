# MULTIPLAYER_SPEC.md — Round 1 多人模式升级规格

> 本文件用于指导 Codex 对 EMBA-AI-SIM-V01 项目进行增量升级。
> **核心原则：不删不改现有计算逻辑，只新增多人协作层。**

---

## 0. 当前状态与约束

- **框架**：Node.js (Express)，前端 HTML/JS（非 React）
- **数据库**：SQLite（本地沙盒，暂不迁移 Postgres）
- **现有模块不动**：`server/llm/` 下所有文件、`game_config_v0.1/` 下所有 JSON、Round 1 GM_max 计算逻辑、Round 2 scoring 全链条
- **新增模块**：多人组队 + 锦囊系统 + 4 阶段流程

---

## 1. 新增数据表（SQLite）

### teams
| 字段 | 类型 | 说明 |
|------|------|------|
| id | TEXT PRIMARY KEY | UUID |
| team_name | TEXT | 小组名称 |
| team_size | INTEGER | 人数（2-6） |
| status | TEXT | 'forming' / 'phase1' / 'phase2' / 'phase3' / 'phase4' / 'frozen' |
| created_at | DATETIME | |
| final_grid_id | TEXT | 最终选定的12格ID（Phase3确认后写入） |
| final_architecture | TEXT | 最终架构标签 |
| final_channel1 | TEXT | |
| final_channel2 | TEXT | |
| final_channel1_share | REAL | |
| final_vp_text | TEXT | 最终VP文本 |
| final_vp_scores | TEXT | JSON: {C, G, E, Svol, Swtp} |
| final_gm_max | REAL | 含锦囊修正后的GM_max |
| final_target_gm | REAL | 冻结值 |

### team_members
| 字段 | 类型 | 说明 |
|------|------|------|
| id | TEXT PRIMARY KEY | UUID |
| team_id | TEXT FK | |
| member_name | TEXT | 组员姓名/昵称 |
| member_index | INTEGER | 1-6，组内序号 |
| jinang_market_id | TEXT | 发到的市场锦囊ID（如 M-03） |
| jinang_tech_id | TEXT | 发到的技术锦囊ID（如 T-07） |
| joined_at | DATETIME | |

### member_submissions（Phase 1 个人提交）
| 字段 | 类型 | 说明 |
|------|------|------|
| id | TEXT PRIMARY KEY | |
| member_id | TEXT FK | |
| team_id | TEXT FK | |
| grid_id | TEXT | 个人选择的12格 |
| architecture | TEXT | 个人选择的架构标签 |
| channel_pref | TEXT | 个人渠道偏好（可选） |
| vp_draft | TEXT | 一句话VP草稿 |
| personal_gm_max | REAL | 系统为个人选择计算的GM_max预估（不展示给他人） |
| submitted_at | DATETIME | |

### jinang_settlements（Phase 4 锦囊结算）
| 字段 | 类型 | 说明 |
|------|------|------|
| id | TEXT PRIMARY KEY | |
| team_id | TEXT FK | |
| member_id | TEXT FK | |
| jinang_id | TEXT | 锦囊ID |
| jinang_type | TEXT | 'market' / 'tech' |
| matched | BOOLEAN | 是否激活 |
| match_reason | TEXT | 激活/未激活原因 |
| effect_applied | TEXT | JSON: 实际应用的参数修正 |

---

## 2. 锦囊系统

### 2.1 配置文件
将 `jinang_cards.json` 放入 `game_config_v0.1/` 目录。

### 2.2 发牌逻辑（建组时触发）
```
function dealJinang(teamSize):
  marketPool = shuffle(ALL_MARKET_IDS)  // M-01 到 M-10
  techPool = shuffle(ALL_TECH_IDS)      // T-01 到 T-10
  for i in 0..teamSize-1:
    member[i].jinang_market_id = marketPool[i]
    member[i].jinang_tech_id = techPool[i]
```
- 同组内不重复
- teamSize <= 6 所以不会超出池子

### 2.3 匹配结算逻辑（Phase 4 触发）
```
function settleJinang(team, finalDecision):
  for each member in team:
    for jinang in [member.market_jinang, member.tech_jinang]:
      matched = evaluateMatchRule(jinang.match_rule, finalDecision)
      if matched:
        applyEffect(jinang.effect_if_matched, team.round1_params)
      record(jinang_id, matched, reason, effect)
```

市场锦囊修正 Round 1 参数：
- `channel_fee_delta` → 加到加权渠道费 f 上
- `wtp_multiplier` → 乘到 WTP_s 上
- `tam_multiplier` → 乘到 TAM 上
- `cogs_proxy_delta` → 加到 COGS_proxy 上
- `crowding_override` → 替换 crowding 等级

技术锦囊记录到 team 上，Round 2 时生效：
- `r2_dCOGS_discount` → 对指定卡的 dCOGS 乘以 (1 - discount)
- `r2_risk_reduction` → 对指定卡的 risk 乘以 (1 - reduction)
- `r2_performance_bonus` → 加到对应卡的性能指数上
- `r2_sub_lift_bonus` → 加到 sub_lift 上
- `r2_complexity_reduction` → 减少 complexity 值
- `r2_total_dCOGS_discount` → 对所有卡的总 dCOGS 打折

---

## 3. 四阶段流程（路由与页面）

### 3.1 首页改动
在现有首页的「页面入口」区域新增：
- "新建多人小组" 按钮 → 输入小组名称 + 人数 → 创建 team → 生成加入链接
- "加入小组" 按钮 → 输入 team_id / 扫码 → 加入

### 3.2 Phase 1 — 个人探索（新页面 `/team/:teamId/phase1`）
**路由**：GET 展示界面，POST 提交个人选择

**界面要素**：
- 顶部：显示该成员的 2 张锦囊卡（从 jinang_cards.json 读取 desc_for_player）
- 中间：12 格选择器（复用现有 Round 1 的格子 UI）+ 架构标签选择 + 渠道偏好
- 底部：一句话 VP 输入框 + "提交" 按钮
- 提交后锁定（不可修改）
- 后端为每人的选择调用现有 GM_max 计算，存入 member_submissions.personal_gm_max

**状态管理**：
- 所有人提交前：每人只看到自己的界面
- 所有人提交后：team.status 自动切换为 'phase2'，前端自动跳转

### 3.3 Phase 2 — 分歧可视化（新页面 `/team/:teamId/phase2`）
**全组共享视图**：
- 12 格分布图：6列（儿童/成人/老人 × 差异化/成本） × 2行（ToC/ToB）
- 每个格子里显示该格子的组员头像/颜色标识
- 高亮"主要分歧轴"（找到成员分散最大的维度）
- 每人的锦囊 hint_keyword（不是完整描述）

**无操作**：纯展示页，设定 2 分钟后自动解锁 Phase 3 入口（或手动点击"进入讨论"）

### 3.4 Phase 3 — VP Coach 协作（新页面 `/team/:teamId/phase3`）

**左侧**：集体决策面板
- 12 格投票/选择器（选定最终格子）
- 架构标签选择
- 渠道选择 + 比例滑块
- VP 编辑器（WHO / PAIN / HOW）

**右侧**：VP Coach 对话窗
- 接入现有 `server/llm/vpCoach.js`
- 每次提交 VP 文本后，Coach 返回 C/G/E 评分 + 一句话瓶颈提示
- 顶部显示当前 C/G/E 评分（实时更新）
- 最多 3 轮迭代

**提交**：确认最终方案 → 写入 teams 表的 final_* 字段 → team.status = 'phase4'

### 3.5 Phase 4 — 结果 + 锦囊结算（新页面 `/team/:teamId/phase4`）

**计算流程**：
1. 用最终选择调用现有 GM_max 计算 → 得到基础 GM_max
2. 运行锦囊匹配结算 → 得到参数修正
3. 用修正后参数重新计算 → 得到最终 GM_max
4. VP 评分（C/G/E）→ Svol/Swtp

**展示**：
- 最终定位 + 架构 + 渠道
- GM_max（基础 vs 锦囊加成后）
- VP 三维评分 + Svol% + Swtp%
- 锦囊结算明细：每张锦囊是否激活、原因、效果
- "冻结 target_gm → 进入 Round 2" 按钮

---

## 4. 文件改动清单

### 新增文件
```
game_config_v0.1/jinang_cards.json          ← 锦囊配置（已提供）
server/multiplayer/
  teamManager.js        ← 建组/加入/状态管理
  jinangDealer.js       ← 发牌逻辑
  jinangSettler.js      ← 匹配结算逻辑
  phaseController.js    ← 4阶段状态机
server/routes/
  teamRoutes.js         ← /api/team/* 路由
pages/（或 views/）
  team-lobby.html       ← 建组/加入页
  phase1-personal.html  ← 个人探索
  phase2-distribution.html ← 分布图
  phase3-vp-coach.html  ← VP Coach 协作
  phase4-results.html   ← 结果页
```

### 修改文件
```
server/routes/index.js  ← 注册新路由
app.js (或 server.js)   ← 初始化新表
首页 HTML               ← 新增多人入口按钮
```

### 不动的文件
```
server/llm/*            ← 全部不动，Phase 3 调用 vpCoach.js
game_config_v0.1/grid_priors*.json  ← 不动
现有 Round 1 / Round 2 计算逻辑    ← 不动
```

---

## 5. 给 Codex 的任务拆分建议

按以下顺序提交 task，每个 task 小而完整：

**Task 1**：新建数据表 + teamManager.js（建组/加入/查询）
**Task 2**：jinangDealer.js（发牌）+ jinang_cards.json 加载
**Task 3**：Phase 1 页面 + member_submissions 写入 + 个人 GM_max 计算
**Task 4**：Phase 2 页面（12格分布图可视化）
**Task 5**：Phase 3 页面（集体决策 + VP Coach 集成）
**Task 6**：jinangSettler.js + Phase 4 结果页
**Task 7**：首页改动 + 全流程联调

---

## 6. 注意事项

- 锦囊的 `desc_for_player` 展示给学生看，**不含数字**
- 锦囊的 `effect_if_matched` 只在后端执行，前端只展示 `description` 文案
- Phase 1 个人提交后**不可修改**，这是核心博弈设计
- Phase 2 的分歧图是**只读**的，目的是触发讨论
- Phase 3 的 VP Coach 复用现有 vpCoach.js，不需要重写
- 技术锦囊在 Round 1 结算时只做**记录**，实际生效在 Round 2
