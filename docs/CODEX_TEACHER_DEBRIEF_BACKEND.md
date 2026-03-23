# CODEX_TEACHER_DEBRIEF_BACKEND.md — 教师复盘面板后端

> **版本**: v1.0 | **日期**: 2026-03-15  
> **范围**: 教师复盘面板的后端 API + AI 讲解稿生成 + PPT/PDF 导出  
> **前置**: Round 1 和 Round 2 学生端已完成提交，数据已在数据库中  
> **参考原型**: `docs/teacher_debrief_dashboard.jsx`（前端原型，mock 数据）

---

## 1. 总览

教师复盘面板需要三类后端能力：

| 类别 | 功能 | 技术方案 |
|------|------|----------|
| **数据读取** | 聚合所有组的 R1/R2 决策和结果 | REST API，读 PostgreSQL |
| **AI 讲解稿** | 基于全班数据生成中文复盘文稿 | DeepSeek API 调用 |
| **导出** | 生成 PPT / PDF / CSV 下载文件 | PptxGenJS + PDFKit |

---

## 2. 数据读取 API

### 2.1 全班汇总（复盘面板主数据源）

```
GET /api/teacher/debrief-data?session_id=xxx
```

需要教师密码或 token 验证（复用现有 `/teacher` 路由的鉴权）。

**返回结构**（JSON）：

```json
{
  "teams": [
    {
      "id": "team_abc123",
      "name": "第1组",
      "members": 6,
      "r1": {
        "grid": "B2B_Differentiation_Elder",
        "gridLabel": "ToB·差异化·老人",
        "arch": "体验●",
        "vp": "为养老机构提供...",
        "who": "养老机构（200床以上）的院长和护理主管",
        "pain": "护工人手不足...",
        "how": "AI机器人24h情感陪伴...",
        "C": 4, "G": 4, "E": 5, "Eadj": 5,
        "sam": 339,
        "wtpAdj": 21194,
        "jinangMatch": 0.82
      },
      "r2": {
        "price": 14500,
        "dCOGS": 2180,
        "cardCount": 9,
        "riskTotal": 0.32,
        "vscore": 0.31,
        "radar": {
          "interaction": 7.5, "perception": 6.8,
          "motion": 4.2, "safety": 8.1,
          "extend": 3.5, "ops": 5.9
        },
        "bestGrid": "B2B_Differentiation_Elder",
        "bestGridLabel": "ToB·差异化·老人",
        "units": 687,
        "profit": 1842000,
        "profitPerUnit": 2681,
        "cards": [
          {"id": "voice_basic", "name": "语音基础", "tier": "mid", "tierLabel": "标准"}
        ]
      }
    }
  ],
  "meta": {
    "totalStudents": 60,
    "totalTeams": 10,
    "teamsSubmittedR1": 10,
    "teamsSubmittedR2": 10
  }
}
```

**数据来源映射**：

| 字段 | 数据库来源 | 备注 |
|------|-----------|------|
| r1.grid, arch, vp, who, pain, how | `teams` 表 Round 1 冻结数据 | VP 是 finalize 时 LLM 生成的结构化摘要 |
| r1.C, G, E, Eadj | `teams` 表 VP 评分字段 | Eadj = min(ceil(E + δ×m), 5) |
| r1.sam, wtpAdj | `teams` 表或实时计算 | 按 §3.2/§6 公式从 grid_priors 计算 |
| r2.price, dCOGS, cards | `round2_submissions` 表 | 团队最终提交 |
| r2.radar | `fg_team_radar` 表 | 访谈融合后的 6 维度分数 |
| r2.units, profit | `round2_results` 表 | rdCalculator 计算结果 |
| r2.bestGrid | `round2_results` 表 | §13 产品-市场重匹配 |
| r2.vscore | `round2_results` 表 | 产品力综合得分 |

### 2.2 计算 Round 2 结果（如果尚未计算）

Round 2 结果（units, profit, bestGrid 等）需要在团队提交后由 `rdCalculator.js` 计算。如果 `round2_results` 表为空，`GET /api/teacher/debrief-data` 应该先触发计算再返回。

```javascript
// 伪代码
async function getDebriefData(sessionId) {
  const teams = await db.query('SELECT * FROM teams WHERE session_id = ?', [sessionId]);
  
  for (const team of teams) {
    // 检查是否已有 R2 结果
    let r2result = await db.query('SELECT * FROM round2_results WHERE team_id = ?', [team.id]);
    if (!r2result && team.r2_submitted) {
      // 触发计算
      r2result = await rdCalculator.compute(team);
      await db.insert('round2_results', r2result);
    }
  }
  
  return assembleDebriefResponse(teams);
}
```

---

## 3. AI 讲解稿生成

### 3.1 API 端点

```
POST /api/teacher/generate-debrief
Body: { "round": 1 | 2, "session_id": "xxx" }
→ { "text": "## 全局观察\n\n本届学生..." }
```

调用 DeepSeek API，用结构化的 prompt 生成中文讲解稿。

### 3.2 Round 1 讲解稿 Prompt

```
你是一位EMBA商业模拟课程的教学助手。以下是本届学生在Round 1（市场定位）的决策数据。
请生成一份中文课堂复盘讲解稿，供教授在课堂上直接使用。

## 数据

{teams_json}

## 输出格式

严格按以下结构输出，使用 Markdown 格式：

## 全局观察
2-3句话总结本届学生整体的选择倾向。包括：
- 哪些格子最热门/最冷门
- 差异化 vs 成本策略的比例
- 架构选择（体验/混合/功能）和策略的一致性
- 有没有集体盲点（所有人都忽略的市场）

## 典型对比：第X组 vs 第Y组
自动选择对比度最大的一对组。选择标准（按优先级）：
1. 选了相同格子但VP评分差距大（说明同一市场的VP质量差异）
2. 选了相似策略（都差异化或都成本）但结果分化大
3. SAM和WTPadj呈现明显对冲（一个市场大WTP低，一个反过来）
用3-5句话解释两组的差异原因，引用具体数据（SAM、WTPadj、C/G/E）。

## 课堂讨论引导
生成2个问题，每个问题：
- 点名1-2个组（用"请第X组"开头）
- 问一个他们必须用自己的决策逻辑来回答的问题
- 不给答案，让学生自己解释

## 注意事项
- 语言风格：像一位经验丰富的教授在课堂上说话，不是书面报告
- 不要说"数据显示"——直接说结论
- 可以用反问句增加互动感
- 引用数据时用自然语言（"SAM差了将近200亿"而不是"SAM差值为187亿"）
```

### 3.3 Round 2 讲解稿 Prompt

```
你是一位EMBA商业模拟课程的教学助手。以下是本届学生在Round 2（产品研发+定价）的完整决策和结果数据。
请生成一份中文课堂复盘讲解稿，供教授在课堂上直接使用。

## 数据

{teams_json}

## 输出格式

严格按以下结构输出，使用 Markdown 格式：

## 全局观察
2-3句话总结结果分布。必须包括：
- 利润冠军是谁，赢在哪里（一句话）
- 利润最低的组，问题出在哪里（一句话）
- 一个出乎意料的发现（比如成本策略反而比差异化赚钱，或者堆料最多的组利润最低）

## 利润冠军分析：第X组（定位，Y万）
3-5句话深入分析冠军的成功原因。包括：
- 赛道选择（格子+渠道费率的结构性优势）
- 选卡纪律（dCOGS控制、是否有不必要的旗舰档）
- 定价精准度（定价vs成本vs渠道后到手价的关系）
引用具体数字。

## 堆料教训：第X组（定位，Y万）
选择dCOGS最高且利润偏低的组，分析3个问题：
- 哪几张卡选了旗舰档但没必要
- 高成本如何通过渠道费被放大
- 如果降档的反事实估算

## 战略一致性
一句话总结有多少组R1和R2保持一致。如果有跑偏的组，用2句话说明跑偏原因和结果。

## 课堂讨论引导
生成3个问题：
1. 关于渠道费的结构性效应（"为什么最优定价都低于WTP"）
2. 关于ToB vs ToC的利润差异
3. 关于堆料 vs 精准选卡

## 注意事项
- 语言风格同Round 1
- 毛利率公式：GM = (P×(1-f) - V - dCOGS) / P，其中 V=4200，ToB f=0.15，ToC f=0.25
- 研发ROI = 利润 ÷ (销量 × dCOGS)
- 不要暴露模型参数（α、γ、Logit等），只用自然语言描述因果关系
```

### 3.4 每组个别复盘 Prompt

```
POST /api/teacher/generate-team-review
Body: { "team_id": "xxx", "session_id": "xxx" }
→ { "insight": "一句话洞察", "review": "3-5句详细分析" }
```

Prompt：

```
你是一位EMBA商业模拟课程的教学助手。以下是一个团队的完整决策数据（Round 1 + Round 2）。
请生成两段文字：

## 数据
{team_json}
全班利润范围：{min_profit}万 - {max_profit}万
全班dCOGS范围：{min_dcogs}元 - {max_dcogs}元

## 输出格式（严格JSON）
{
  "insight": "一句话（20-40字），概括这组做对了什么或做错了什么，像报纸标题一样精炼",
  "review": "3-5句话的详细分析（150-250字）。必须包含：(1)从R1到R2的战略一致性，(2)选卡亮点或问题，(3)定价和渠道的互动效果。引用具体数字。"
}

## 注意事项
- insight 要有判断性（"做对了X"或"错在Y"），不是中性描述
- review 的语气是教授点评学生作业，直接但不尖锐
- 不要用引号包裹中文短语（用单引号或直接写）
- 返回纯 JSON，不要 markdown 代码块
```

### 3.5 实现注意事项

- DeepSeek API 调用使用现有的 `chatService.js` 封装
- 讲解稿生成可能需要 10-20 秒，前端用 loading 状态
- `{teams_json}` 只传必要字段（不传完整对话历史），控制 token 长度
- 每组个别复盘可以批量生成（10组并行调用），也可以按需生成（用户展开时才调用）
- 生成结果缓存到 `debrief_cache` 表，避免重复调用

---

## 4. PPT 导出

### 4.1 API 端点

```
POST /api/teacher/export-ppt
Body: { "session_id": "xxx", "include_r1": true, "include_r2": true }
→ 返回 .pptx 文件流（Content-Disposition: attachment）
```

### 4.2 技术方案

使用 **PptxGenJS**（已在项目 node_modules 中，如果没有则 `npm install pptxgenjs`）。

```javascript
const pptxgen = require('pptxgenjs');

async function generateDebrief PPT(sessionId, options) {
  const data = await getDebriefData(sessionId);
  const pptx = new pptxgen();
  
  // 全局设置
  pptx.defineLayout({ name: 'CUSTOM', width: 13.33, height: 7.5 }); // 16:9
  pptx.layout = 'CUSTOM';
  
  // 生成各页
  addCoverSlide(pptx, data);
  if (options.include_r1) {
    addR1GridSlide(pptx, data);        // 12格战略分布
    addR1SamWtpSlide(pptx, data);      // SAM × WTP 对比
    addR1VpScoreSlide(pptx, data);     // VP 评分
  }
  if (options.include_r2) {
    addR2RankingSlide(pptx, data);     // 利润排名（冠亚季军）
    addR2StrategicMapSlide(pptx, data); // 战略地图复盘
    addR2ScatterSlide(pptx, data);     // 定价×利润×销量
    addR2RoiTableSlide(pptx, data);    // 研发ROI矩阵
    addR2TeamDetailsSlides(pptx, data); // 每组一页详情（可选）
  }
  addDebriefTextSlide(pptx, data);     // AI 讲解稿文字页
  
  const buffer = await pptx.write({ outputType: 'nodebuffer' });
  return buffer;
}
```

### 4.3 Slide 设计规范

**配色方案**（和前端原型统一的深色系）：

```javascript
const COLORS = {
  bg: '0B0F1A',        // 深色背景
  cardBg: '111827',    // 卡片背景
  accent: '10B981',    // 绿色主色
  accent2: '6366F1',   // 紫色辅色
  warn: 'F59E0B',      // 橙色警告
  danger: 'EF4444',    // 红色
  text1: 'F1F5F9',     // 主文字
  text2: '94A3B8',     // 次文字
  text3: '64748B',     // 辅助文字
};
```

**字体**：标题用 Arial Black 36pt，正文用 Arial 14-16pt。中文回退到系统默认。

**每页结构**：
- 左上角固定 logo 文字 "EMBA-AI-SIM"（10pt, text3 色）
- 右下角页码
- 深色背景 + 浅色文字（和前端保持一致）

### 4.4 关键 Slide 内容

**Slide 1: 封面**
- 大标题: "LOVOT 中国市场创新模拟 · 课堂复盘"
- 副标题: "10组 × 60人 · {日期}"

**Slide 2: 12格战略分布**
- 用 PptxGenJS 的 shape + text 画 4×3 网格
- 每个格子里放组号圆圈（和前端原型一致）

**Slide 3: SAM × WTP**
- 用 PptxGenJS 的 chart（clustered bar）或手画矩形条

**Slide 4: 利润排名**
- 横向条形图，冠亚季军用金银铜色

**Slide 5: 战略地图复盘**
- 12格 + 实心/虚线圆圈 + SAM 深浅底色

**Slide 6: 定价×利润散点**
- 用 PptxGenJS 内置的 scatter chart

**Slide 7+: AI 讲解稿**
- 纯文字页，markdown 转为格式化文本

---

## 5. PDF 导出

### 5.1 API 端点

```
POST /api/teacher/export-pdf
Body: { "session_id": "xxx" }
→ 返回 .pdf 文件流
```

### 5.2 技术方案

两种方案（选一个）：

**方案 A：PPT 转 PDF**
```bash
# 先生成 PPT，再用 LibreOffice 转
soffice --headless --convert-to pdf output.pptx
```
优点：和 PPT 完全一致。缺点：需要服务器装 LibreOffice。

**方案 B：直接用 PDFKit 生成**
```javascript
const PDFDocument = require('pdfkit');
```
优点：纯 Node.js，不依赖外部软件。缺点：图表需要手画。

**建议用方案 A**——PPT 已经有了，转 PDF 一行命令。部署时 `apt install libreoffice-core` 即可。

---

## 6. CSV 导出

### 6.1 API 端点

```
GET /api/teacher/export-csv?session_id=xxx
→ 返回 .csv 文件流
```

### 6.2 内容

一行一组，所有关键字段平铺：

```csv
组名,格子,架构,VP,C,G,E,Eadj,SAM,WTPadj,定价,dCOGS,卡数,风险,产品力,销量,利润,单台利润,毛利率,研发ROI,R2最匹配格子,战略一致
第1组,B2B_Differentiation_Elder,体验●,"为养老机构...",4,4,5,5,339,21194,14500,2180,9,0.32,0.31,687,1842000,2681,35,120,B2B_Differentiation_Elder,是
```

用 Node.js 原生实现，不需要额外库：

```javascript
function generateCSV(teams) {
  const headers = ['组名','格子','架构','VP','C','G','E','Eadj','SAM','WTPadj','定价','dCOGS','卡数','风险','产品力','销量','利润','单台利润','毛利率','研发ROI','R2最匹配格子','战略一致'];
  const rows = teams.map(t => {
    const f = t.r1.grid.includes('B2B') ? 0.15 : 0.25;
    const totalCost = 4200 + t.r2.dCOGS;
    const gm = ((t.r2.price * (1-f) - totalCost) / t.r2.price * 100).toFixed(0);
    const roi = (t.r2.profit / (t.r2.units * t.r2.dCOGS) * 100).toFixed(0);
    const consistent = t.r1.grid === t.r2.bestGrid ? '是' : '否';
    return [
      t.name, t.r1.grid, t.r1.arch,
      `"${t.r1.vp.replace(/"/g, '""')}"`,
      t.r1.C, t.r1.G, t.r1.E, t.r1.Eadj, t.r1.sam, t.r1.wtpAdj,
      t.r2.price, t.r2.dCOGS, t.r2.cardCount,
      t.r2.riskTotal, t.r2.vscore, t.r2.units,
      t.r2.profit, t.r2.profitPerUnit, gm, roi,
      t.r2.bestGrid, consistent
    ].join(',');
  });
  return [headers.join(','), ...rows].join('\n');
}
```

---

## 7. 路由注册

在 `server/routes/` 下新建 `teacherDebrief.js`：

```javascript
// server/routes/teacherDebrief.js
const router = require('express').Router();

// 鉴权中间件（复用现有教师密码验证）
router.use(requireTeacherAuth);

router.get('/debrief-data', async (req, res) => { /* §2 */ });
router.post('/generate-debrief', async (req, res) => { /* §3 */ });
router.post('/generate-team-review', async (req, res) => { /* §3.4 */ });
router.post('/export-ppt', async (req, res) => { /* §4 */ });
router.post('/export-pdf', async (req, res) => { /* §5 */ });
router.get('/export-csv', async (req, res) => { /* §6 */ });

module.exports = router;
```

在 `server/index.js` 中注册：

```javascript
app.use('/api/teacher', require('./routes/teacherDebrief'));
```

---

## 8. 依赖

```bash
npm install pptxgenjs    # PPT 生成
# PDFKit 可选（如果不用 LibreOffice 转 PDF 的话）
# npm install pdfkit
```

服务器部署时（如果用方案 A 生成 PDF）：
```bash
apt install libreoffice-core
```

---

## 9. 数据库新增

```sql
-- AI 讲解稿缓存
CREATE TABLE IF NOT EXISTS debrief_cache (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  round INTEGER NOT NULL,          -- 1 or 2
  type TEXT NOT NULL,               -- 'global' | 'team_T01' | 'team_T02' ...
  content TEXT NOT NULL,            -- JSON string
  generated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

缓存逻辑：先查 cache，如果 generated_at 在最后一次团队提交之后则直接返回，否则重新生成。

---

## 10. 不涉及的内容

- 前端 React 组件（已有原型 `teacher_debrief_dashboard.jsx`，另写 spec）
- 学生端任何改动
- rdCalculator.js 引擎（已由 `CODEX_RD_ENGINE_V2.md` 覆盖）
- 访谈模块（已由 `CODEX_INTERVIEW_BACKEND_V2.md` 覆盖）

---

## 11. Checklist

- [ ] `GET /api/teacher/debrief-data` 聚合 R1+R2 全部数据
- [ ] 如果 R2 结果未计算，自动触发 rdCalculator
- [ ] `POST /api/teacher/generate-debrief` Round 1 讲解稿
- [ ] `POST /api/teacher/generate-debrief` Round 2 讲解稿
- [ ] `POST /api/teacher/generate-team-review` 单组复盘
- [ ] 讲解稿缓存到 `debrief_cache` 表
- [ ] `POST /api/teacher/export-ppt` 生成 PPTX
- [ ] PPT 至少包含：封面、战略分布、利润排名、战略地图、讲解稿文字
- [ ] `GET /api/teacher/export-csv` 导出全部数据
- [ ] `POST /api/teacher/export-pdf`（PPT 转 PDF 或 PDFKit）
- [ ] 路由注册到 server/index.js
- [ ] 教师鉴权中间件
