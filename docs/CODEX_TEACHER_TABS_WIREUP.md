# CODEX_TEACHER_TABS_WIREUP.md — 教师控制台剩余 Tab 接入

> **日期**: 2026-03-17  
> **前置**: 实时监控 tab 已完成。Round 1 / Round 2 学生端数据已在数据库中。  
> **参考原型**: `docs/teacher_debrief_dashboard.jsx`（前端原型，含完整 mock 数据结构）  
> **参考后端 spec**: `docs/CODEX_TEACHER_DEBRIEF_BACKEND.md`（完整 API 定义）

---

## 目标

把教师控制台的 5 个空 tab 接上真实数据：

| Tab | 数据来源 | 需要新后端 | 复杂度 |
|-----|---------|-----------|--------|
| Round 1 复盘 | 读已有 teams 表 | 需要聚合 API | 低 |
| Round 2 复盘 | 读已有 teams + round2 表 | 需要聚合 API + rdCalculator | 中 |
| 跨轮对比 | 同上两者 | 不需要，前端组合 | 低 |
| AI 讲解稿 | DeepSeek API 调用 | 需要新 API | 中 |
| 导出 | 组合所有数据 | 需要 CSV 生成 | 低 |

---

## 第1步：后端数据聚合 API

### 新建 `server/routes/teacherDebrief.js`

```javascript
const router = require('express').Router();
// 复用现有教师鉴权

/**
 * GET /api/teacher/debrief-data
 * 返回所有组的 R1 + R2 完整数据
 * 这是所有复盘 tab 的唯一数据源
 */
router.get('/debrief-data', async (req, res) => {
  try {
    // 1. 查所有团队
    const teams = await db.query(`
      SELECT * FROM teams WHERE status IN ('frozen', 'r2_submitted')
    `);
    
    const result = [];
    
    for (const team of teams) {
      // 2. 读 Round 1 数据
      const r1 = {
        grid: team.final_grid_id,
        gridLabel: formatGridLabel(team.final_grid_id), // 转成 "ToB·差异化·老人" 格式
        arch: team.final_architecture,
        vp: team.final_vp_text || '',
        who: extractVpField(team.final_vp_text, 'WHO'),
        pain: extractVpField(team.final_vp_text, 'PAIN'),
        how: extractVpField(team.final_vp_text, 'HOW'),
        C: team.final_vp_c || 3,
        G: team.final_vp_g || 3,
        E: team.final_vp_e_raw || 3,
        Eadj: team.final_vp_e_adj || team.final_vp_e_raw || 3,
        // SAM 和 WTPadj：从 grid_priors 实时计算，或读已保存的值
        sam: team.r1_sam || computeSAM(team.final_grid_id),
        wtpAdj: team.r1_wtp_adj || computeWTPadj(team.final_grid_id, team.final_vp_g, team.final_vp_e_adj),
        jinangMatch: team.jinang_match_strength || 0,
      };
      
      // 3. 读 Round 2 数据（如果已提交）
      let r2 = null;
      if (team.r2_status === 'R2_SUBMITTED') {
        const submission = await db.query(`
          SELECT * FROM round2_submissions WHERE team_id = ?
        `, [team.id]);
        
        const r2result = await db.query(`
          SELECT * FROM round2_results WHERE team_id = ?
        `, [team.id]);
        
        // 如果还没有计算结果，触发计算
        if (!r2result && submission) {
          r2result = await rdCalculator.compute(team.id);
        }
        
        const radar = await db.query(`
          SELECT * FROM fg_team_radar WHERE team_id = ?
        `, [team.id]);
        
        if (submission && r2result) {
          r2 = {
            price: submission.price,
            dCOGS: r2result.total_dcogs,
            cardCount: r2result.card_count,
            riskTotal: r2result.total_risk,
            vscore: r2result.vscore,
            radar: radar ? JSON.parse(radar.radar_scores_10) : {},
            bestGrid: r2result.best_match_grid,
            bestGridLabel: formatGridLabel(r2result.best_match_grid),
            units: r2result.units,
            profit: r2result.profit,
            profitPerUnit: r2result.units > 0 ? Math.round(r2result.profit / r2result.units) : 0,
            cards: JSON.parse(submission.selections || '{}'),
          };
        }
      }
      
      // 4. 读成员列表
      const members = await db.query(`
        SELECT * FROM team_members WHERE team_id = ?
      `, [team.id]);
      
      result.push({
        id: team.id,
        name: team.team_name,
        members: members.length,
        r1,
        r2,
      });
    }
    
    res.json({
      teams: result,
      meta: {
        totalStudents: result.reduce((s, t) => s + t.members, 0),
        totalTeams: result.length,
        teamsSubmittedR1: result.filter(t => t.r1.grid).length,
        teamsSubmittedR2: result.filter(t => t.r2).length,
      }
    });
  } catch (e) {
    console.error('[debrief-data error]', e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// 辅助函数
function formatGridLabel(gridId) {
  if (!gridId) return '';
  // B2B_Differentiation_Elder → ToB·差异化·老人
  return gridId
    .replace('B2C_', 'ToC·').replace('B2B_', 'ToB·')
    .replace('Differentiation', '差异化').replace('Cost', '成本')
    .replace('_Elder', '·老人').replace('_Adult', '·成人').replace('_Child', '·儿童');
}

function extractVpField(text, field) {
  if (!text) return '';
  const re = new RegExp(field + '\\s*[：:]\\s*([^\\n]+)');
  const m = text.match(re);
  return m ? m[1].trim() : '';
}
```

**注意**：上面的 `db.query` 和 `computeSAM` / `computeWTPadj` 要适配你现有的数据库访问方式和引擎函数。查看现有的 `teamRoutes.js` 和 `engine.js` 中的函数命名。

### 注册路由

在 `server/index.js`（或现有路由注册处）添加：

```javascript
app.use('/api/teacher', require('./routes/teacherDebrief'));
```

---

## 第2步：AI 讲解稿 API

在同一个 `teacherDebrief.js` 中添加：

```javascript
/**
 * POST /api/teacher/generate-debrief
 * Body: { round: 1 | 2 }
 * 用 DeepSeek 生成课堂复盘讲解稿
 */
router.post('/generate-debrief', async (req, res) => {
  try {
    const { round } = req.body;
    
    // 读取全班数据
    const debriefData = await getDebriefData(); // 复用上面的逻辑
    
    // 精简数据（只传必要字段，控制 token）
    const teamsSlim = debriefData.teams.map(t => ({
      name: t.name,
      grid: t.r1.gridLabel,
      arch: t.r1.arch,
      vp: t.r1.vp?.substring(0, 100),
      C: t.r1.C, G: t.r1.G, E: t.r1.Eadj,
      sam: t.r1.sam,
      wtpAdj: t.r1.wtpAdj,
      ...(t.r2 ? {
        price: t.r2.price,
        dCOGS: t.r2.dCOGS,
        units: t.r2.units,
        profit: t.r2.profit,
        vscore: t.r2.vscore,
        bestGrid: t.r2.bestGridLabel,
        cardCount: t.r2.cardCount,
      } : {})
    }));
    
    const prompt = round === 1
      ? buildR1DebriefPrompt(teamsSlim)   // 见 CODEX_TEACHER_DEBRIEF_BACKEND.md §3.2
      : buildR2DebriefPrompt(teamsSlim);  // 见 §3.3
    
    // 调 DeepSeek（复用现有 chatService）
    const response = await callDeepSeek(prompt);
    
    res.json({ ok: true, text: response });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

/**
 * POST /api/teacher/generate-team-review
 * Body: { team_id: "xxx" }
 * 生成单组的 insight + review
 */
router.post('/generate-team-review', async (req, res) => {
  try {
    const { team_id } = req.body;
    // 读取该组数据 + 全班范围（用于对比）
    // 调 DeepSeek，prompt 见 CODEX_TEACHER_DEBRIEF_BACKEND.md §3.4
    // 返回 { insight: "一句话", review: "3-5句" }
    const result = await generateTeamReview(team_id);
    res.json({ ok: true, ...result });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});
```

**Prompt 模板**：完整的 prompt 在 `CODEX_TEACHER_DEBRIEF_BACKEND.md` §3.2 / §3.3 / §3.4 中，直接复制使用。调 DeepSeek 的方式参考现有的 `server/llm/chatService.js` 或 `vpCoach.js` 中的调用模式。

---

## 第3步：CSV 导出 API

```javascript
/**
 * GET /api/teacher/export-csv
 * 返回全班数据的 CSV 文件
 */
router.get('/export-csv', async (req, res) => {
  try {
    const debriefData = await getDebriefData();
    
    const headers = ['组名','格子','架构','C','G','E','Eadj','SAM','WTPadj',
      '定价','dCOGS','卡数','销量','利润','单台利润','R2最匹配格子','战略一致'];
    
    const rows = debriefData.teams.map(t => {
      const consistent = t.r2 ? (t.r1.grid === t.r2.bestGrid ? '是' : '否') : '-';
      return [
        t.name, t.r1.gridLabel, t.r1.arch,
        t.r1.C, t.r1.G, t.r1.E, t.r1.Eadj, t.r1.sam, t.r1.wtpAdj,
        t.r2?.price || '-', t.r2?.dCOGS || '-', t.r2?.cardCount || '-',
        t.r2?.units || '-', t.r2?.profit || '-', t.r2?.profitPerUnit || '-',
        t.r2?.bestGridLabel || '-', consistent
      ].join(',');
    });
    
    const csv = '\uFEFF' + [headers.join(','), ...rows].join('\n'); // BOM for Excel 中文
    
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="debrief_data.csv"');
    res.send(csv);
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});
```

---

## 第4步：前端 Tab 接入

### 数据获取（所有 tab 共用）

在教师控制台的 React 组件顶层，加载一次 debrief 数据：

```javascript
const [debriefData, setDebriefData] = useState(null);
const [loading, setLoading] = useState(false);

// 切换到任何复盘 tab 时加载数据
useEffect(() => {
  if (['r1','r2','cross','debrief','export'].includes(activeTab) && !debriefData) {
    setLoading(true);
    fetch('/api/teacher/debrief-data')
      .then(r => r.json())
      .then(data => { setDebriefData(data); setLoading(false); })
      .catch(() => setLoading(false));
  }
}, [activeTab]);
```

### 各 Tab 组件

参照 `docs/teacher_debrief_dashboard.jsx` 原型中的组件，将 mock 的 `TEAMS` 常量替换为 `debriefData.teams`。原型中的所有组件（GridHeatmap, SamWtpChart, ProfitChart, PriceScatter, TeamReviews, ConsistencyBadge 等）可以直接复用，只需要把数据源从常量换成 API 返回值。

**Round 1 复盘 Tab**：
- 战略分布 12 格图（GridHeatmap 组件）
- SAM × WTP 双轴图（SamWtpChart 组件）
- VP 评分对比（圆点矩阵）
- 小组明细表

**Round 2 复盘 Tab**：
- 冠亚季军卡片（按 profit 降序取前3）
- 战略地图复盘（带 SAM 背景 + 圆圈大小编码利润）
- 利润排名条形图
- 定价×利润×销量散点图
- 研发投入 vs ROI 矩阵表
- 逐组手风琴复盘（TeamReviews 组件）
  - 展开时调 `/api/teacher/generate-team-review` 获取 AI 分析
  - 缓存已获取的 review，不重复调用

**跨轮对比 Tab**：
- 一致性统计（3个数字卡片）
- 逐组一致性行（R1 grid vs R2 bestGrid + ConsistencyBadge）
- WTPadj vs 实际定价对比
- 雷达图对比（冠军 vs 末位）

**AI 讲解稿 Tab**：
- Round 1 / Round 2 切换按钮
- 点"生成讲解稿"→ 调 `/api/teacher/generate-debrief`
- 显示 markdown 渲染后的文本
- "复制纯文本"按钮

**导出 Tab**：
- CSV 下载：`window.location.href = '/api/teacher/export-csv'`
- PPT 导出：暂时显示"即将上线"（PPT 生成需要 pptxgenjs，优先级低）
- 小组自查链接：为每组生成 `/recap/:teamId` URL

### 关键：R2 数据可能为空

如果 Round 2 还没开始或没有组提交，`r2` 字段为 null。所有 R2 相关的组件都要处理这种情况：

```javascript
// Round 2 Tab
if (!debriefData.meta.teamsSubmittedR2) {
  return <div>Round 2 尚未开始或没有组提交</div>;
}
```

---

## 第5步：prompt 模板文件

创建 `server/llm/debriefPrompts.js`，包含三个 prompt 模板函数：

```javascript
function buildR1DebriefPrompt(teamsData) {
  return `你是一位EMBA商业模拟课程的教学助手...
  ## 数据
  ${JSON.stringify(teamsData, null, 2)}
  ## 输出格式
  ...`;
  // 完整 prompt 见 CODEX_TEACHER_DEBRIEF_BACKEND.md §3.2
}

function buildR2DebriefPrompt(teamsData) { /* §3.3 */ }
function buildTeamReviewPrompt(teamData, classRange) { /* §3.4 */ }

module.exports = { buildR1DebriefPrompt, buildR2DebriefPrompt, buildTeamReviewPrompt };
```

完整的 prompt 内容在 `CODEX_TEACHER_DEBRIEF_BACKEND.md` §3.2、§3.3、§3.4 中，逐字复制到这个文件中。

---

## Checklist

- [ ] 新建 `server/routes/teacherDebrief.js`
- [ ] `GET /api/teacher/debrief-data` 聚合 R1+R2 数据
- [ ] `POST /api/teacher/generate-debrief` Round 1/Round 2 讲解稿
- [ ] `POST /api/teacher/generate-team-review` 单组 AI 复盘
- [ ] `GET /api/teacher/export-csv` CSV 导出
- [ ] 路由注册
- [ ] 前端：debrief-data 加载逻辑（切 tab 时加载一次）
- [ ] 前端：Round 1 复盘 tab（12格图+SAM/WTP+VP评分+明细表）
- [ ] 前端：Round 2 复盘 tab（冠亚季军+战略地图+利润排名+散点+ROI矩阵+逐组复盘）
- [ ] 前端：跨轮对比 tab（一致性统计+逐组对比+WTP vs 定价+雷达）
- [ ] 前端：AI 讲解稿 tab（生成+显示+复制）
- [ ] 前端：导出 tab（CSV 下载+占位）
- [ ] R2 数据为空时的降级显示
- [ ] `server/llm/debriefPrompts.js` prompt 模板
