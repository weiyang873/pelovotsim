# CODEX_TEACHER_EXPORT_FIX.md
# 教师面板 Round 2 复盘 — 数据修复 + 展示优化

## 背景

教师面板 Round 2 复盘 Tab 当前存在以下问题，需要逐一修复：
1. 硬件利润百分比 + 订阅利润百分比 > 100%（缺少固定成本/penalty层）
2. Vscore 显示值含义不清（可能混淆 VPscore 1-5 和 Vscore 0-1）
3. 只有少数组（n<3）时，比较性分析退化为无意义文字
4. dCOGS效率/研发ROI 在因果链和独立卡片中重复
5. 导出缺少叙事串联

---

## 修复 1：利润来源拆分 — 补齐 NRE/Penalty 层

### 问题
当前显示：`硬件 4,896万 (115%)  订阅 155万 (4%)` → 总利润 4,269万
百分比之和 = 119%，且硬件利润 > 总利润，读者无法理解差额去了哪里。

差额 = profitHw + profitSub - profit = NRE摊销 + penalty（固定成本）

### 修复方案

在利润来源拆分卡片中，改为三段式瀑布展示：

```
硬件毛利  +4,896万     ← profitHw
订阅收入  +155万       ← profitSub  
固定成本  -782万       ← -(profitHw + profitSub - profit)
──────────────────
总利润    4,269万      ← profit
```

百分比改为以 **总收入**（profitHw + profitSub，正值之和）为基数：
- 硬件占比 = profitHw / (profitHw + profitSub) 
- 订阅占比 = profitSub / (profitHw + profitSub)
- 固定成本侵蚀 = fixedCost / (profitHw + profitSub)

如果 profitHw < 0（硬件亏损），改为标记"硬件亏损"而非显示负百分比。

### 实现位置
找到利润来源拆分的渲染代码（搜索 `profitHw` 或 `profitSub` 或 `硬件驱动` 或 `利润来源`），修改展示逻辑。

### 验收标准
- 三段（硬件毛利 / 订阅收入 / 固定成本）之和 === profit，精确到万
- 百分比之和 = 100%（硬件 + 订阅 - 固定成本侵蚀）
- 标签改为"硬件毛利"/"订阅收入"/"固定成本"，不再显示"硬件驱动"/"订阅驱动"

---

## 修复 2：Vscore 显示值

### 问题
表格中 `Vscore = 14%` — 需确认数据来源。

### 规则
- 如果后端 `debrief-data` 返回的字段名是 `vscore`，且值域在 0-1 范围，则显示为百分比（如 `14%`），列标题改为 **"产品力 V"**
- 如果后端返回的是 `vpScore`，且值域在 1-5 范围，则显示为小数（如 `4.0`），列标题改为 **"VP分"**
- 当前表格中这两个指标应该分开显示为两列：
  - **VP分**：1-5 分，来自 Round 1 VP评分（C×G×E映射）
  - **产品力 V**：0-1，来自 Round 2 value completion score

### 实现
1. 在 debrief-data API 返回中确认字段名和值域
2. 如果只有一个字段，根据值域自动判断（>1 → VPscore，≤1 → Vscore）
3. 表头和格式对应调整

### 验收标准
- VP分 显示为 X.X 格式（1位小数），值域 1.0-5.0
- 产品力V 显示为 XX% 格式，值域 0%-100%
- 两者不混淆

---

## 修复 3：少组数 graceful degradation

### 问题
当提交组数 n < 3 时，以下比较性分析模块退化为无意义文字：
- "ToC组平均渠道费 vs ToB组平均" → 其中一侧为空
- "coverCore >= 80% 的组平均利润" → 样本不足
- "全班只用了 N 个价格档位" → n=1 时 trivial
- "VP满分的组不一定赚最多" → 只有1组无法对比

### 修复规则

在每个比较性分析卡片的渲染逻辑中，加入 `n` 检查：

```javascript
// 获取有效组数
const submittedTeams = teams.filter(t => t.r2 && t.r2.profit !== undefined);
const n = submittedTeams.length;
```

按模块设定最低组数阈值：

| 模块 | 最低 n | n 不足时处理 |
|------|--------|-------------|
| 冠军卡片 | 1 | 正常显示 |
| 利润排名条形图 | 1 | 正常显示 |
| 战略地图复盘（12格） | 1 | 正常显示 |
| 单台经济性拆解表 | 1 | 正常显示 |
| 利润来源拆分 | 1 | 正常显示 |
| 定价决策质量（P/WTP） | 1 | 正常显示 |
| 逐组AI复盘 | 1 | 正常显示 |
| **渠道费侵蚀**（ToC vs ToB） | **3** | 隐藏整个卡片 |
| **VP分数 ≠ 利润** | **3** | 隐藏整个卡片 |
| **因果链统计**（coverCore>=80% 的组 vs <80%） | **4** | 隐藏统计对比文字，只保留逐组因果链 |
| **定价深度复盘**（价格档位聚类） | **3** | 隐藏"全班只用了N个价格档位"评论，只保留数据 |
| **定价反事实** | 1 | 正常显示（见修复6） |

### 实现方式

每个需要 n 检查的卡片，在渲染前加条件：

```javascript
{n >= 3 && (
  <Card title="渠道费侵蚀" subtitle="渠道吃掉了多少收入？">
    {/* ... */}
  </Card>
)}
```

对于因果链统计，保留逐组展示但移除跨组对比文字：

```javascript
{/* 逐组因果链始终显示 */}
{teams.map(t => <CausalChainRow team={t} />)}

{/* 跨组统计仅在 n>=4 时显示 */}
{n >= 4 && (
  <p>coverCore >= 80% 的组平均利润 {avgHigh}，
     coverCore < 80% 的组平均利润 {avgLow}。</p>
)}
```

### 验收标准
- n=1 时，渠道费侵蚀、VP≠利润 卡片完全不显示
- n=1 时，因果链逐组行正常显示，跨组统计文字不显示
- n=10 时，所有卡片正常显示（无regression）

---

## 修复 4：去除 dCOGS效率/研发ROI 重复

### 问题
`dCOGS效率 549%` 在因果链卡片中出现一次，又在独立的"研发ROI"卡片中出现一次。

### 修复方案

**保留研发ROI独立卡片**（因为它有"每投¥1研发费赚¥X"的解读），**从因果链中移除 dCOGS效率**。

因果链改为：
```
evi=0.85 → coverCore=30% → Vscore=14% → 利润 4,269万
```

即：**访谈质量 → 需求匹配 → 产品力 → 利润**，这是更干净的因果叙事。

### 实现位置
搜索因果链渲染代码（含 `evi` 和 `coverCore` 和 `dCOGS效率`），移除 dCOGS效率节点，替换为 Vscore。

### 验收标准
- 因果链显示 4 个节点：evi → coverCore → Vscore(产品力V) → 利润
- 研发ROI卡片保持不变
- 因果链中不再出现 dCOGS 相关字段

---

## 修复 5：导出叙事串联

### 问题
当前导出是一堆独立分析卡片平铺，教师不知道该按什么顺序讲。

### 修复方案

在 Round 2 复盘 Tab 顶部（冠军卡片之前），加一个**"课堂复盘引导"**折叠区块，内容为固定模板 + 动态数据填充：

```javascript
const DebriefGuide = ({ teams }) => {
  const n = teams.length;
  const winner = teams[0]; // 假设已按profit降序
  const loser = teams[teams.length - 1];
  const avgProfit = teams.reduce((s,t) => s + t.profit, 0) / n;
  const profitableCount = teams.filter(t => t.profit > 0).length;
  
  return (
    <CollapsibleCard title="📋 课堂复盘建议流程" defaultOpen={false}>
      <ol style={{lineHeight: 1.8, fontSize: 14}}>
        <li><strong>开场（2分钟）</strong>：{n}个组完成了产品研发，
          {profitableCount}个组盈利，{n - profitableCount}个组亏损。
          先看冠军是谁。</li>
        <li><strong>利润排名（3分钟）</strong>：展示利润条形图。
          提问：为什么{winner.name}赚最多？
          是因为定价高？成本低？还是销量大？</li>
        <li><strong>单台经济性（5分钟）</strong>：展示拆解表。
          每一元售价去了哪里？渠道费的影响有多大？</li>
        <li><strong>定价决策（5分钟）</strong>：展示P/WTP比率。
          谁在甜点区间？谁定价过低留了钱在桌上？</li>
        <li><strong>因果链（5分钟）</strong>：访谈质量如何影响选卡，
          选卡如何影响产品力，产品力如何影响利润。</li>
        <li><strong>反事实（3分钟）</strong>：如果换个定价会怎样？
          展示定价反事实表。</li>
        <li><strong>总结（2分钟）</strong>：好文案≠好生意。
          VP影响的是WTP天花板，但利润还取决于定价和成本。</li>
      </ol>
    </CollapsibleCard>
  );
};
```

### 放置位置
Round 2 复盘 Tab 最顶部，在冠军卡片之前。

### 验收标准
- 折叠区块默认收起，点击展开
- 数字（盈利组数、冠军组名等）从真实数据动态填充
- 流程中的"展示XXX"对应下方实际卡片的标题，方便教师对照滚动

---

## 修复 6：定价反事实表 — 增加总利润和销量列

### 问题
当前定价反事实表只显示单台毛利的对比（当前 vs @72%WTP），缺少总利润和销量，教师无法判断"定高价少卖 vs 定低价多卖"的全局影响。

### 修复方案

在反事实表中新增 3 列：**@72%WTP销量**、**@72%WTP总利润**、**利润差额**。

当前列顺序：
```
组 | 当前定价 | P/WTP | 单台毛利 | @72%WTP定价 | @72%毛利 | 差额 | 判断
```

改为：
```
组 | 当前定价 | P/WTP | 销量 | 总利润 | @72%WTP定价 | @72%销量 | @72%总利润 | 利润差额 | 判断
```

其中：
- **销量**：当前实际销量，直接取 `team.r2.units` 或 debrief-data 中的 Q
- **总利润**：当前实际总利润，直接取 `team.r2.profit`
- **@72%销量**：需要后端计算。在反事实定价下重新跑 adoption × share × M
- **@72%总利润**：需要后端计算。用反事实定价重新算 profitHw + profitSub - penalty
- **利润差额**：@72%总利润 - 当前总利润（正值=当前定价偏低留了钱，负值=当前定价已是更优选择）

### 后端支持

如果当前反事实数据只在前端用简单公式算（只改单台毛利），则需要扩展：

在 debrief-data API 的每个 team 数据中，增加 `counterfactual` 字段：

```javascript
// 在组装 debrief-data 时，为每个 team 计算反事实
const cfPrice = Math.round(team.wtpAdj * 0.72);
// 调用 rdCalculator 或等效函数，用 cfPrice 替代 team.price 重算
const cfResult = computeProfitAtPrice(team, cfPrice);

team.counterfactual = {
  price: cfPrice,
  units: cfResult.units,
  profit: cfResult.profit,
  unitMargin: cfResult.unitProfitHW,
  profitDelta: cfResult.profit - team.profit
};
```

如果 `computeProfitAtPrice` 函数不存在，可以从 `rdCalculator.js` 中的定价扫描逻辑提取。核心逻辑是：给定不同的 P，重新计算 adoption → share → Q → profit。

### 前端展示

```javascript
<tr>
  <td>{team.name}</td>
  <td>¥{team.price.toLocaleString()}</td>
  <td>{(team.price / team.wtpAdj * 100).toFixed(0)}%</td>
  <td>{team.units.toLocaleString()}</td>
  <td>{formatWan(team.profit)}</td>
  <td>¥{team.counterfactual.price.toLocaleString()}</td>
  <td>{team.counterfactual.units.toLocaleString()}</td>
  <td>{formatWan(team.counterfactual.profit)}</td>
  <td style={{color: team.counterfactual.profitDelta > 0 ? 'green' : 'inherit'}}>
    {formatWan(team.counterfactual.profitDelta)}
  </td>
  <td>{判断标签}</td>
</tr>
```

`formatWan` = 除以10000，保留整数，加"万"后缀。

### 判断标签逻辑调整

当前判断只看 P/WTP 是否在 65%-85% 甜点区间。增加一条：

- 如果 profitDelta > 0 且 > 当前利润的 5%：标记 `💰 有提价空间`
- 如果 profitDelta < 0：标记 `✓ 当前定价更优`  
- 如果 |profitDelta| < 当前利润的 5%：标记 `≈ 差异不大`

### 验收标准
- 反事实表包含 销量、总利润、@72%销量、@72%总利润、利润差额 共5个新列
- 利润差额正值显示绿色，负值显示默认色
- 数据来自后端计算（非前端近似），用 rdCalculator 的完整逻辑
- 判断标签同时考虑甜点区间 + 利润差额

---

## 文件定位提示

教师面板的前端代码大概率在以下位置之一：
- `client/src/` 下搜索 `Teacher` 或 `teacher` 或 `debrief`
- 或 `client/src/components/` 下的某个 Dashboard/Debrief 组件

后端 debrief-data API 大概率在：
- `server/routes/` 下搜索 `teacher` 或 `debrief` 或 `admin`

请先 `grep -r "profitHw\|profitSub\|硬件驱动\|利润来源" client/src/` 和 `grep -r "vscore\|Vscore\|vpScore" client/src/` 定位具体文件和行号，再做修改。

---

## 执行顺序

1. 修复 2（Vscore）— 最简单，先确认数据源
2. 修复 1（利润百分比）— 纯前端展示修改
3. 修复 4（去重复）— 纯前端删减
4. 修复 3（n检查）— 加条件渲染
5. 修复 6（定价反事实）— 需要后端+前端
6. 修复 5（叙事引导）— 新增组件

## 测试

- `node --check` 所有修改的文件
- 用 n=1 的测试数据验证修复3（渠道费侵蚀卡片不显示）
- 用 n=10 的测试数据验证所有卡片正常（无regression）
