# CODEX_TEST_LAYERED_PERSONA.md

## 任务

参考 docs/CODEX_PERSONA_LAYERED_ARCHITECTURE_V2.md 中的 prompt 设计，改 `scripts/test_vp_prompt.js`，在测试脚本里实现三层调用。**不改 persona_student.js，不改任何主代码。**

## 实现

对 5 个 persona 依次执行 3 步 LLM 调用：

### Step 1 — Layer 0 Seed Memory

使用 spec 第 1 节 `generateSeedMemory()` 中的 prompt，输出半结构化 JSON（7 个字段：backstory、decision_habit、discussion_style、confidence_zone、blind_zone、under_pressure、pet_phrases）。

### Step 2 — Layer 1 Reflection

使用 spec 第 2 节 `generateReflection()` 中的 prompt。system message 是 Layer 0 拼成的文本。

### Step 3 — VP 初稿

system message = Layer 0 文本 + Layer 1 Reflection。user prompt 使用 spec 第 6 节的 generatePhase1Choice user prompt。

## 5 个 Persona 定义

手动写死，不需要随机生成：

```javascript
const personas = [
  {
    id: 'A', label: '草根老板',
    name: '杨金实', gender: 'male', age: 52,
    education: '中专/高中', overseas: { hasOverseas: false },
    industry: '化工、制造、贸易',
    role: '合肥普力先进材料科技有限公司创始人',
    background: '从化工销售员做起，白手起家20年，年营收过亿。经历过原材料价格暴涨、客户跑路、合伙人散伙。对供应链和客户关系有极强直觉，对品牌营销和数字化完全不懂。',
    mbti: 'ESTP', decisionStyle: '靠直觉和经验，快刀斩乱麻',
    riskPreference: '高风险偏好，赌过很多次，赢多输少',
    fullExpressionStyle: '说话直接，爱用比喻，经常蹦出几句方言，不喜欢绕弯子',
    blindSpots: '对品牌溢价、数字化营销、理论框架完全没概念',
    vpQuirks: '会从自己做生意的经验出发，用口语表达',
    grid: 'ToB_Differentiation_Elder', architecture: 'Function'
  },
  {
    id: 'B', label: '职业经理人',
    name: '王建荣', gender: 'female', age: 38,
    education: 'MBA（海外）', overseas: { hasOverseas: true, destination: '美国', duration: '2年' },
    industry: '快消、乳制品、品牌营销',
    role: '伊利集团婴幼儿营养品事业部品牌总监',
    background: '从宝洁管培生做起，历经联合利华、伊利。擅长品牌定位、消费者洞察、渠道策略。习惯用数据和框架说话。',
    mbti: 'ENTJ', decisionStyle: '数据驱动，先看 ROI 再决策',
    riskPreference: '中等，偏好可控风险',
    fullExpressionStyle: '条理清晰，喜欢分点论述，会用英文缩写（ROI、NPS、GMV）',
    blindSpots: '对技术实现细节不敏感，对下沉市场缺乏体感',
    vpQuirks: '会从消费者画像和品牌定位角度切入',
    grid: 'ToC_Differentiation_Adult', architecture: 'Experience'
  },
  {
    id: 'C', label: '技术创业者',
    name: '顾山松', gender: 'male', age: 41,
    education: '博士（海归）', overseas: { hasOverseas: true, destination: '美国MIT', duration: '6年' },
    industry: '电子特气、半导体材料、化工技术',
    role: '樾达科技（上海）有限公司创始人',
    background: '化工博士，在美国做了3年研发，回国创业做电子特气。公司从零到年营收过亿，正在考虑重资产还是轻资产路线。技术判断极强，商业直觉也不错，但不擅长管人。',
    mbti: 'INTJ', decisionStyle: '第一性原理，从技术本质出发倒推商业逻辑',
    riskPreference: '愿意赌技术方向，但对运营风险保守',
    fullExpressionStyle: '逻辑链很长，喜欢类比，有时候过度分析',
    blindSpots: '对渠道、销售管理、组织建设不够重视',
    vpQuirks: '会从技术壁垒和数据飞轮角度思考',
    grid: 'ToC_Differentiation_Adult', architecture: 'Experience'
  },
  {
    id: 'E', label: '体制转型者',
    name: '张应春', gender: 'male', age: 50,
    education: '本科（985）', overseas: { hasOverseas: false },
    industry: '企业管理咨询、制造业精益管理',
    role: '朗欧企业管理咨询有限公司创始人',
    background: '在国企干了15年生产管理，出来做管理咨询。客户全是制造业中小企业。对工厂管理、供应链、ERP系统非常熟，对互联网和消费市场不太懂。',
    mbti: 'ISTJ', decisionStyle: '稳健，按流程来，不喜欢拍脑袋',
    riskPreference: '低风险偏好，要看到数据才动',
    fullExpressionStyle: '用词准确但偏正式，有时候带点官话腔，写东西比说话强',
    blindSpots: '对 C 端消费者心理、品牌营销、互联网打法不熟',
    vpQuirks: '会从流程管理和落地执行角度思考',
    grid: 'ToB_Cost_Elder', architecture: 'Function'
  },
  {
    id: 'F', label: '销售铁军',
    name: '李书', gender: 'male', age: 45,
    education: '大专', overseas: { hasOverseas: false },
    industry: '跨境物流、国际贸易',
    role: '浙江腾信国际物流有限公司总经理',
    background: '从货代业务员做起，干了12年跨境物流。自己从零搭建了中美物流网络，14家国内分子公司+美国5大转运中心。客户关系极强，能在饭桌上搞定大单。',
    mbti: 'ESTP', decisionStyle: '快速决策，边打边看，不行就换',
    riskPreference: '高风险偏好，敢投入敢撤退',
    fullExpressionStyle: '说话节奏快，爱用生意场上的行话，直奔主题不废话',
    blindSpots: '对技术细节不关心，对品牌建设没耐心',
    vpQuirks: '会从"谁掏钱""怎么卖"的角度思考',
    grid: 'ToC_Cost_Child', architecture: 'Hybrid'
  }
];
```

## 输出格式

每个 persona 打印完整三层输出：

```
========================================
[A 草根老板/杨金实/52岁/中专]
========================================

--- Layer 0: Seed Memory ---
{
  "backstory": "...",
  "decision_habit": "...",
  "discussion_style": "...",
  "confidence_zone": "...",
  "blind_zone": "...",
  "under_pressure": "...",
  "pet_phrases": "..."
}

--- Layer 1: Reflection ---
（原文）

--- VP 初稿 (grid: ToB_Differentiation_Elder, arch: Function) ---
WHO: ...
PAIN: ...
HOW: ...
```

## 运行方式

```bash
source .env && node scripts/test_vp_prompt.js
```

不需要启动服务器。直接调 DeepSeek API。跑完贴完整结果。
