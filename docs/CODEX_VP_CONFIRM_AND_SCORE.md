# CODEX_VP_CONFIRM_AND_SCORE.md
## VP 切片确认与评分前端集成

### 概述

在 VP Coach 页面增加"切片确认"步骤。学生提交 VP 后，系统用 LLM 预填 5 个字段，学生确认/修改后锁定，再调词级评分器打分。

流程：

```
Coach 对话 → 合成 VP → 学生编辑 VP → 点"提交VP"
→ LLM 切片预填 5 个框 → 学生确认/修改 → 点"确认并评分"
→ 锁定字段 → 调 vpWordScorer → 显示 VPscore + C/G/E
```

---

### Section 1：后端 — 新增两个 API

在 `server/routes/` 下新增路由（或加到现有 VP 相关路由文件里）。

#### 1a. `POST /api/vp/extract-fields`

接收 VP 文本，返回 LLM 切片结果。

```javascript
// 请求
{
  "vpText": "为面临护工成本上涨和夜间跌倒高风险的养老机构..."
}

// 响应
{
  "fields": {
    "who_raw": "面临护工成本上涨和夜间跌倒高风险的养老机构",
    "pain_raw": "护工成本上涨和夜间跌倒高风险；传统依赖人力巡检难以实时响应",
    "how_raw": "提供具备离床监测功能的机器人，通过替代部分人工巡检来优化人力配置",
    "alternative_raw": "传统依赖人力巡检",
    "boundary_raw": "失智老人特殊照护单元需结合个性化护理"
  }
}
```

实现：

```javascript
const { extractVpFields } = require("../llm/vpEmbeddingScorer");

router.post("/api/vp/extract-fields", async (req, res) => {
  try {
    const { vpText } = req.body;
    if (!vpText || vpText.trim().length < 5) {
      return res.status(400).json({ error: "VP 文本太短" });
    }
    const fields = await extractVpFields(vpText);
    res.json({ fields });
  } catch (err) {
    console.error("[extract-fields] error:", err);
    res.status(500).json({ error: "切片失败，请重试" });
  }
});
```

#### 1b. `POST /api/vp/confirm-and-score`

接收学生确认后的 5 个字段 + 格子 + 架构，评分并存储。

```javascript
// 请求
{
  "teamId": "team_xxx",
  "memberId": "member_xxx",
  "vpText": "原始 VP 全文",
  "confirmedFields": {
    "who_raw": "面临护工成本上涨和夜间跌倒高风险的养老机构",
    "pain_raw": "护工成本上涨和夜间跌倒高风险",
    "how_raw": "提供具备离床监测功能的机器人...",
    "alternative_raw": "传统依赖人力巡检",
    "boundary_raw": "失智老人特殊照护单元需结合个性化护理"
  },
  "gridId": "ToB_Cost_Elder",
  "architecture": "Hybrid"
}

// 响应
{
  "scores": {
    "C": 4.5,
    "G": 5.0,
    "E": 5.0,
    "VPscore": 4.7
  },
  "confirmedAt": "2026-03-23T16:30:00.000Z"
}
```

实现：

```javascript
const { scoreVpByWord } = require("../llm/vpWordScorer");

router.post("/api/vp/confirm-and-score", async (req, res) => {
  try {
    const { teamId, memberId, vpText, confirmedFields, gridId, architecture } = req.body;

    // 验证
    if (!confirmedFields || !gridId || !architecture) {
      return res.status(400).json({ error: "缺少必要参数" });
    }
    if (!confirmedFields.who_raw || confirmedFields.who_raw.trim().length < 2) {
      return res.status(400).json({ error: "目标客户不能为空" });
    }
    if (!confirmedFields.pain_raw || confirmedFields.pain_raw.trim().length < 2) {
      return res.status(400).json({ error: "痛点不能为空" });
    }
    if (!confirmedFields.how_raw || confirmedFields.how_raw.trim().length < 2) {
      return res.status(400).json({ error: "解决方式不能为空" });
    }

    // 评分
    const result = await scoreVpByWord(confirmedFields, gridId, architecture);

    // 存入数据库
    const confirmedAt = new Date().toISOString();
    // TODO: 存入 team/member 记录，包括：
    // - vpText（原始全文）
    // - confirmedFields（5 个字段）
    // - scores（C/G/E/VPscore）
    // - confirmedAt
    // 具体存储方式取决于当前数据库结构（PostgreSQL），
    // 可以加一个 vp_confirmed_fields 列（JSON）和 vp_scores 列（JSON）

    res.json({
      scores: result.scores,
      confirmedAt
    });
  } catch (err) {
    console.error("[confirm-and-score] error:", err);
    res.status(500).json({ error: "评分失败，请重试" });
  }
});
```

#### 1c. vpWordScorer.js 修改

当前 `scoreVpByWord` 的第一个参数是 VP 文本（内部调 extractVpFields）。改为直接接收 confirmedFields：

```javascript
// 改前
async function scoreVpByWord(vpText, gridId, architecture) {
  const fields = await extractVpFields(vpText);
  // ...
}

// 改后
async function scoreVpByWord(confirmedFields, gridId, architecture) {
  // 直接用 confirmedFields，不再调 extractVpFields
  const fields = confirmedFields;
  // ... 后面逻辑不变
}
```

注意：测试脚本 `test_vp_word_scorer.js` 里仍然需要调 `extractVpFields` 来生成 fields，然后传给 `scoreVpByWord`。所以测试脚本要同步改：

```javascript
// 测试脚本改为
const fields = await extractVpFields(sample.vp);
const result = await scoreVpByWord(fields, sample.grid, sample.arch);
```

---

### Section 2：前端 — VP Coach 页面改动

#### 2a. 当前页面结构（不动的部分）

```
┌──────────────────────────────────────────┐
│ 对话区                                    │
│ ┌──────────────────────────────────────┐ │
│ │ Coach: 你们选的方向是 ToB·成本·老人...│ │
│ │ 学生: 养老院用。老人孤单...           │ │
│ │ Coach: 第一版收到...                  │ │
│ │ ...                                  │ │
│ └──────────────────────────────────────┘ │
│ [输入框]                    [发送]        │
├──────────────────────────────────────────┤
│ VP 文本框（可编辑）                        │
│ ┌──────────────────────────────────────┐ │
│ │ 为面临护工成本上涨...                  │ │
│ └──────────────────────────────────────┘ │
│ [合成VP]                                  │
└──────────────────────────────────────────┘
```

#### 2b. 新增"提交VP"按钮

在"合成VP"按钮旁边（或下方）新增"提交VP"按钮。

```
│ [合成VP]        [提交VP]                  │
```

"提交VP"按钮的出现条件：VP 文本框有内容（至少 10 个字）。

点击"提交VP"后：
1. 按钮变为 loading 状态，文字改为"正在分析..."
2. 调 `POST /api/vp/extract-fields`
3. 成功后显示切片确认面板（Section 2c）
4. 失败后显示错误提示，按钮恢复

#### 2c. 切片确认面板

在 VP 文本框下方展开。VP 文本框和对话区在确认期间**不可编辑**（灰掉）。

```
┌──────────────────────────────────────────┐
│ 确认你的价值主张切片：                      │
│                                          │
│ 目标客户                                  │
│ ┌──────────────────────────────────────┐ │
│ │ 面临护工成本上涨和夜间跌倒高风险的养老机构│ │
│ └──────────────────────────────────────┘ │
│                                          │
│ 痛点                                      │
│ ┌──────────────────────────────────────┐ │
│ │ 护工成本上涨；夜间跌倒高风险            │ │
│ └──────────────────────────────────────┘ │
│                                          │
│ 解决方式                                  │
│ ┌──────────────────────────────────────┐ │
│ │ 提供离床监测机器人，替代人工巡检优化人力  │ │
│ └──────────────────────────────────────┘ │
│                                          │
│ 替代方案对比（可选）                       │
│ ┌──────────────────────────────────────┐ │
│ │ 传统依赖人力巡检                       │ │
│ └──────────────────────────────────────┘ │
│                                          │
│ 边界条件（可选）                           │
│ ┌──────────────────────────────────────┐ │
│ │ 失智老人需结合个性化护理                │ │
│ └──────────────────────────────────────┘ │
│                                          │
│ [返回修改]          [确认并评分]           │
└──────────────────────────────────────────┘
```

**UI 细节：**

- 5 个字段都是可编辑的 textarea（单行或 2 行高度）
- "目标客户""痛点""解决方式"前面有红色 * 标记（必填）
- "替代方案对比""边界条件"标注"可选"，如果 LLM 返回"未明确"则显示空框，placeholder 提示"如果有的话写在这里"
- "返回修改"按钮：关闭确认面板，恢复 VP 文本框和对话区的可编辑状态
- "确认并评分"按钮：提交并评分

#### 2d. 点击"确认并评分"

1. 按钮变为 loading，文字改为"正在评分..."
2. 验证：目标客户、痛点、解决方式三个必填框不能为空
3. 调 `POST /api/vp/confirm-and-score`
4. 成功后：
   - 切片确认面板变为不可编辑（锁定）
   - 显示评分结果（Section 2e）
5. 失败后显示错误提示，按钮恢复

#### 2e. 评分结果展示

在切片确认面板下方展开。

```
┌──────────────────────────────────────────┐
│ VP 评分结果                                │
│                                          │
│ ┌────────────────────────────────────┐   │
│ │        VP 综合评分                   │   │
│ │           4.0                       │   │
│ │         ★★★★☆                      │   │
│ └────────────────────────────────────┘   │
│                                          │
│  人群覆盖面 (C)    ████████░░  4.5       │
│  痛点典型性 (G)    ██████████  5.0       │
│  解法说服力 (E)    ██████████  5.0       │
│                                          │
└──────────────────────────────────────────┘
```

**UI 细节：**

- VPscore 大字居中显示，配星级图标（1-5 星，支持半星）
- C/G/E 用水平进度条 + 数值显示
- C 的标签是"人群覆盖面"
- G 的标签是"痛点典型性"
- E 的标签是"解法说服力"
- 不显示词级匹配细节（那些留给教师 dashboard）
- 不显示 simSum、hitCount 等内部数据

#### 2f. 删除独立的"查看评分"按钮

现有的"查看评分"按钮（限用 2 次的那个）删掉。评分功能合并到"确认并评分"流程里了。

---

### Section 3：状态管理

VP Coach 页面的状态流转：

```
状态 1：对话中
  - 对话区可用
  - VP 文本框可编辑
  - [合成VP] 可点
  - [提交VP] 灰掉（VP 文本框为空时）/ 可点（有内容时）
  - 切片面板隐藏
  - 评分结果隐藏

状态 2：切片确认中
  - 对话区灰掉（不可输入）
  - VP 文本框灰掉（不可编辑）
  - [合成VP] 灰掉
  - [提交VP] 灰掉
  - 切片面板显示，5 个字段可编辑
  - [返回修改] [确认并评分] 可点
  - 评分结果隐藏

状态 3：已评分
  - 对话区灰掉
  - VP 文本框灰掉
  - 切片面板显示但不可编辑（锁定）
  - 评分结果显示
  - 所有按钮灰掉

状态 4：（可选）返回修改
  - 从状态 2 点"返回修改" → 回到状态 1
  - 对话区和 VP 文本框恢复可编辑
```

注意：一旦进入状态 3（已评分），**不能回退**。VP 和切片已锁定存入数据库。

---

### Section 4：数据库存储

在 team/member 的现有表结构上增加字段（或新建关联表）：

```sql
-- 如果加列到现有表
ALTER TABLE team_members ADD COLUMN vp_text TEXT;
ALTER TABLE team_members ADD COLUMN vp_confirmed_fields JSONB;
ALTER TABLE team_members ADD COLUMN vp_scores JSONB;
ALTER TABLE team_members ADD COLUMN vp_confirmed_at TIMESTAMP;

-- vp_confirmed_fields 示例
{
  "who_raw": "面临护工成本上涨...",
  "pain_raw": "护工成本上涨...",
  "how_raw": "提供离床监测机器人...",
  "alternative_raw": "传统依赖人力巡检",
  "boundary_raw": "失智老人需结合个性化护理"
}

-- vp_scores 示例
{
  "C": 4.5,
  "G": 5.0,
  "E": 5.0,
  "VPscore": 4.7
}
```

如果现有表结构不方便加列，可以新建：

```sql
CREATE TABLE vp_results (
  id SERIAL PRIMARY KEY,
  team_id VARCHAR(50) NOT NULL,
  member_id VARCHAR(50),
  vp_text TEXT NOT NULL,
  confirmed_fields JSONB NOT NULL,
  scores JSONB NOT NULL,
  confirmed_at TIMESTAMP NOT NULL DEFAULT NOW()
);
```

具体选哪种方式，看现有数据库结构决定。

---

### Section 5：不要改的东西

- `vpCoach.js`：Coach 对话逻辑不动
- `vpWordScorer.js`：评分逻辑不动（只改参数接口从 vpText 到 confirmedFields）
- `vpEmbeddingScorer.js`：extractVpFields 保留，被 extract-fields API 调用
- `synthesizeVP`：合成逻辑不动
- `precompute_vp_words.js`：不需要重新预计算
- `vp_word_cache.json`：不动
- `vp_anchor_profiles.json`：不动
- 所有测试脚本：保留（测试脚本自己调 extractVpFields 生成 fields）
- Coach 的 system prompt：不动
- 开场白逻辑：不动

---

### Section 6：验收标准

1. "提交VP"按钮点击后能调通 extract-fields API，5 个字段正确预填
2. 学生能修改 5 个字段
3. "确认并评分"点击后能调通 confirm-and-score API，返回 C/G/E/VPscore
4. 评分结果正确显示（进度条 + 数值）
5. 确认后切片和分数存入数据库
6. 确认后页面锁定，不能回退
7. "返回修改"能正确回到可编辑状态
8. 必填字段为空时点"确认并评分"有错误提示
9. 网络错误时有友好提示
10. 整个流程不影响 Coach 对话功能
