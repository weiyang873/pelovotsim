import { useState, useMemo, Fragment } from "react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell, ScatterChart, Scatter, ZAxis, CartesianGrid, Legend } from "recharts";

// ═══════════════════════════════════════════════════════════════════════════
// MOCK DATA — 10 teams, realistic EMBA simulation results
// ═══════════════════════════════════════════════════════════════════════════

const TEAMS = [
  {
    id:"T01", name:"第1组", members: 6,
    r1: { grid:"B2B_Differentiation_Elder", gridLabel:"ToB·差异化·老人", arch:"体验●",
      vp:"为养老机构提供'有温度的安全守护'——情感陪伴+跌倒检测+情绪预警，让护工从重复巡查中解放，让老人感到被关注而非被监控。",
      who:"养老机构（200床以上）的院长和护理主管", pain:"护工人手不足导致夜间巡查盲区，老人跌倒发现延迟平均47分钟", how:"AI机器人24h情感陪伴+跌倒即时报警+情绪趋势周报",
      C:4, G:4, E:5, Eadj:5, sam:339, wtpAdj:21194, jinangMatch:0.82 },
    r2: { price:14500, dCOGS:2180, cardCount:9, riskTotal:0.32, vscore:0.31,
      radar:{ interaction:7.5, perception:6.8, motion:4.2, safety:8.1, extend:3.5, ops:5.9 },
      bestGrid:"B2B_Differentiation_Elder", bestGridLabel:"ToB·差异化·老人",
      units:687, profit:1842000, profitPerUnit:2681,
      cards:["语音基础·标准","情绪识别·标准","触摸拥抱·标准","基础感知·标准","基础避障·标准","隐私保障·旗舰","老人模式·旗舰","家庭监护·标准","OTA运维·标准"] }
  },
  {
    id:"T02", name:"第2组", members: 6,
    r1: { grid:"B2C_Differentiation_Child", gridLabel:"ToC·差异化·儿童", arch:"混合▲",
      vp:"让3-8岁孩子拥有一个'会成长的AI伙伴'——能一起讲故事、做游戏、学英语，同时帮家长了解孩子的情绪状态和社交发展。",
      who:"一二线城市3-8岁孩子的85后父母", pain:"双职工家庭下班后精力不足，孩子屏幕时间过长但缺乏高质量陪伴替代方案", how:"AI伙伴提供互动故事+教育游戏+情绪日报，替代部分屏幕时间",
      C:4, G:4, E:4, Eadj:4, sam:372, wtpAdj:16850, jinangMatch:0.65 },
    r2: { price:12800, dCOGS:2640, cardCount:10, riskTotal:0.41, vscore:0.27,
      radar:{ interaction:8.2, perception:7.0, motion:3.5, safety:7.5, extend:5.2, ops:4.8 },
      bestGrid:"B2C_Differentiation_Child", bestGridLabel:"ToC·差异化·儿童",
      units:524, profit:985000, profitPerUnit:1880,
      cards:["多轮对话·旗舰","语音基础·标准","视觉表达·标准","情绪识别·标准","基础感知·标准","儿童模式·旗舰","隐私保障·标准","内容合规·标准","家庭监护·标准","智能家居·基础"] }
  },
  {
    id:"T03", name:"第3组", members: 6,
    r1: { grid:"B2C_Cost_Adult", gridLabel:"ToC·成本·成人", arch:"功能■",
      vp:"为独居年轻人提供一个不需要照顾的'室友'——定时提醒、语音控制家电、播放音乐，用最低的价格解决独居的冷清感。",
      who:"一二线城市25-35岁独居年轻人", pain:"独居生活缺乏互动感，回家面对空荡房间的孤独", how:"语音家电控制+日程提醒+氛围音乐，功能实用价格亲民",
      C:3, G:3, E:3, Eadj:3, sam:514, wtpAdj:11163, jinangMatch:0.45 },
    r2: { price:8200, dCOGS:1420, cardCount:8, riskTotal:0.22, vscore:0.12,
      radar:{ interaction:5.5, perception:4.2, motion:2.8, safety:4.0, extend:6.5, ops:6.2 },
      bestGrid:"B2C_Cost_Adult", bestGridLabel:"ToC·成本·成人",
      units:1205, profit:756000, profitPerUnit:627,
      cards:["语音基础·基础","无屏降本·基础","基础感知·基础","基础避障·基础","隐私保障·基础","智能家居·标准","OTA运维·标准","云端升级·基础"] }
  },
  {
    id:"T04", name:"第4组", members: 6,
    r1: { grid:"B2B_Cost_Adult", gridLabel:"ToB·成本·成人", arch:"功能■",
      vp:"为中小型酒店前台提供一个'永不疲倦的迎宾员'——自动问候、引导入住、回答常见问题，降低前台人力成本30%。",
      who:"三四线城市100-300间客房的连锁酒店", pain:"人力成本占运营成本35%以上，前台夜班招人难留人更难", how:"AI机器人承担迎宾+引导+FAQ，7×24无休",
      C:3, G:4, E:3, Eadj:4, sam:556, wtpAdj:15445, jinangMatch:0.55 },
    r2: { price:10500, dCOGS:1680, cardCount:9, riskTotal:0.28, vscore:0.18,
      radar:{ interaction:6.8, perception:5.5, motion:5.8, safety:4.5, extend:4.8, ops:7.2 },
      bestGrid:"B2B_Cost_Adult", bestGridLabel:"ToB·成本·成人",
      units:1580, profit:2105000, profitPerUnit:1332,
      cards:["语音基础·标准","多轮对话·基础","基础感知·标准","室内导航·基础","自动充电·标准","隐私保障·基础","OTA运维·旗舰","云端升级·标准","内容合规·基础"] }
  },
  {
    id:"T05", name:"第5组", members: 6,
    r1: { grid:"B2C_Differentiation_Adult", gridLabel:"ToC·差异化·成人", arch:"体验●",
      vp:"为都市白领打造一个'下班后的情绪出口'——能感知你的疲惫，用温暖的互动帮你从工作模式切换到生活模式。",
      who:"一线城市28-40岁高压职场人士", pain:"长期高压导致下班后难以放松，社交疲劳但又渴望陪伴", how:"多模态情绪感知+个性化安抚互动+渐进式放松引导",
      C:4, G:3, E:4, Eadj:5, sam:354, wtpAdj:18832, jinangMatch:0.78 },
    r2: { price:15800, dCOGS:3120, cardCount:10, riskTotal:0.48, vscore:0.33,
      radar:{ interaction:8.5, perception:8.2, motion:3.0, safety:5.5, extend:4.0, ops:4.5 },
      bestGrid:"B2C_Differentiation_Adult", bestGridLabel:"ToC·差异化·成人",
      units:312, profit:620000, profitPerUnit:1987,
      cards:["多轮对话·旗舰","触摸拥抱·旗舰","语音基础·标准","情绪识别·旗舰","自适应学习·标准","基础感知·标准","场景触发·标准","隐私保障·标准","基础避障·基础","云端升级·基础"] }
  },
  {
    id:"T06", name:"第6组", members: 6,
    r1: { grid:"B2B_Differentiation_Child", gridLabel:"ToB·差异化·儿童", arch:"混合▲",
      vp:"让幼儿园拥有'AI助教'——辅助老师组织教学活动、记录每个孩子的参与度和情绪变化、生成个性化发展报告给家长。",
      who:"一二线城市中高端幼儿园（学费2万+/年）", pain:"师生比不达标，老师无法关注每个孩子的个性化发展，家长投诉增加", how:"AI助教实时记录+自动生成发展报告+辅助教学互动",
      C:5, G:3, E:4, Eadj:5, sam:343, wtpAdj:19845, jinangMatch:0.71 },
    r2: { price:16200, dCOGS:2860, cardCount:9, riskTotal:0.38, vscore:0.29,
      radar:{ interaction:7.8, perception:7.5, motion:4.5, safety:8.5, extend:5.0, ops:6.0 },
      bestGrid:"B2B_Differentiation_Child", bestGridLabel:"ToB·差异化·儿童",
      units:445, profit:1650000, profitPerUnit:3708,
      cards:["多轮对话·标准","语音基础·标准","情绪识别·标准","基础感知·旗舰","基础避障·标准","儿童模式·旗舰","内容合规·旗舰","隐私保障·标准","OTA运维·标准"] }
  },
  {
    id:"T07", name:"第7组", members: 6,
    r1: { grid:"B2C_Cost_Elder", gridLabel:"ToC·成本·老人", arch:"功能■",
      vp:"让子女远在外地也能'陪伴'父母——语音视频通话、用药提醒、异常报警，操作极简，老人一学就会。",
      who:"三四线城市60-80岁空巢老人的子女（付费者）", pain:"子女不在身边，担心父母健康和安全，电话沟通频率低质量差", how:"一键视频+智能用药提醒+跌倒/长时间不动报警",
      C:4, G:4, E:3, Eadj:3, sam:510, wtpAdj:11947, jinangMatch:0.50 },
    r2: { price:7800, dCOGS:1240, cardCount:8, riskTotal:0.20, vscore:0.08,
      radar:{ interaction:5.0, perception:4.5, motion:3.2, safety:7.0, extend:3.8, ops:5.5 },
      bestGrid:"B2C_Cost_Elder", bestGridLabel:"ToC·成本·老人",
      units:1380, profit:520000, profitPerUnit:377,
      cards:["语音基础·基础","基础感知·基础","无屏降本·基础","老人模式·标准","隐私保障·基础","家庭监护·基础","自动充电·基础","OTA运维·基础"] }
  },
  {
    id:"T08", name:"第8组", members: 6,
    r1: { grid:"B2B_Cost_Elder", gridLabel:"ToB·成本·老人", arch:"功能■",
      vp:"为社区日间照料中心提供'智能巡护助手'——自动巡房、异常检测、活动组织提醒，用一台机器人替代半个护工的巡查工作量。",
      who:"城镇社区日间照料中心（50-100人规模）", pain:"政府补贴有限但服务标准提高，护工招聘困难且流动性大", how:"自动巡房+异常报警+活动提醒，降低人力依赖",
      C:4, G:4, E:4, Eadj:5, sam:562, wtpAdj:17561, jinangMatch:0.88 },
    r2: { price:11200, dCOGS:1860, cardCount:9, riskTotal:0.30, vscore:0.25,
      radar:{ interaction:5.8, perception:5.5, motion:6.5, safety:7.8, extend:4.2, ops:7.5 },
      bestGrid:"B2B_Cost_Elder", bestGridLabel:"ToB·成本·老人",
      units:1820, profit:3250000, profitPerUnit:1786,
      cards:["语音基础·标准","基础感知·标准","室内导航·标准","自动充电·标准","基础避障·标准","老人模式·标准","隐私保障·标准","OTA运维·旗舰","云端升级·标准"] }
  },
  {
    id:"T09", name:"第9组", members: 6,
    r1: { grid:"B2C_Differentiation_Elder", gridLabel:"ToC·差异化·老人", arch:"体验●",
      vp:"为退休知识分子打造'永远的学伴'——能陪读书、讨论时事、学习新技能，满足退休后持续学习和智力激活的需求。",
      who:"一二线城市60-75岁退休知识分子（教师/工程师/医生）", pain:"退休后社交圈骤缩，缺乏高质量智力互动，子女忙无暇陪伴", how:"个性化知识对话+新闻讨论+在线课程伴学+记忆训练",
      C:3, G:3, E:4, Eadj:4, sam:347, wtpAdj:16282, jinangMatch:0.60 },
    r2: { price:13500, dCOGS:2480, cardCount:9, riskTotal:0.35, vscore:0.22,
      radar:{ interaction:8.0, perception:6.5, motion:3.0, safety:5.0, extend:5.5, ops:5.0 },
      bestGrid:"B2C_Differentiation_Adult", bestGridLabel:"ToC·差异化·成人",
      units:398, profit:710000, profitPerUnit:1784,
      cards:["多轮对话·旗舰","语音基础·标准","自适应学习·标准","基础感知·标准","场景触发·基础","隐私保障·标准","老人模式·标准","开放API·基础","OTA运维·基础"] }
  },
  {
    id:"T10", name:"第10组", members: 6,
    r1: { grid:"B2C_Cost_Child", gridLabel:"ToC·成本·儿童", arch:"功能■",
      vp:"给6-12岁孩子一个'作业搭子'——定时提醒、专注计时、语音百科问答，帮家长解决'催作业'的日常冲突。",
      who:"二三线城市6-12岁小学生的家长", pain:"每天催作业引发亲子冲突，家长辅导能力有限但又不想完全依赖课外班", how:"专注计时+语音百科+作业提醒+家长进度报告",
      C:4, G:4, E:3, Eadj:3, sam:499, wtpAdj:10150, jinangMatch:0.42 },
    r2: { price:6800, dCOGS:980, cardCount:8, riskTotal:0.18, vscore:0.06,
      radar:{ interaction:5.2, perception:3.8, motion:2.5, safety:6.0, extend:4.0, ops:5.8 },
      bestGrid:"B2C_Cost_Child", bestGridLabel:"ToC·成本·儿童",
      units:1650, profit:380000, profitPerUnit:230,
      cards:["语音基础·基础","无屏降本·基础","基础感知·基础","儿童模式·标准","内容合规·基础","隐私保障·基础","OTA运维·基础","云端升级·基础"] }
  },
];

// ── Per-team descriptive reviews (mock — production version is AI-generated) ──
const TEAM_REVIEWS = {
  T01: { insight: "精准匹配养老场景，安全维度拉满但运动维度克制，研发投入刚好够用。",
    review: "从R1到R2保持了高度战略一致性。VP聚焦'有温度的安全守护'，R2选卡精准匹配——安全8.1分全场最高，交互7.5分支撑情感陪伴。关键克制在于运动维度只给了4.2分（基础避障·标准），没有堆导航和跟随功能：养老机构的机器人不需要满屋跑，稳定可靠比花哨更重要。dCOGS 2,180元控制得当。定价¥14,500低于WTPadj的¥21,194，留出了渠道空间。" },
  T02: { insight: "儿童市场交互体验到位，但10张卡堆料偏多，dCOGS偏高侵蚀利润。",
    review: "VP写得好（'会成长的AI伙伴'），选卡方向正确——交互8.2分、安全7.5分。但选卡纪律不足：10张卡上限，多轮对话选旗舰档（+380元），dCOGS 2,640元偏高。定价¥12,800在ToC儿童市场合理，但25%渠道费吃掉了利润空间。如果多轮对话降一档，省120元×524台=6.3万利润，高6%。" },
  T03: { insight: "成本策略执行到位，走量1,205台但单台利润太薄——VP模糊是根因。",
    review: "典型成本策略执行者：功能型架构，8张基础/标准卡，无屏降本方案。dCOGS仅1,420元。但定价¥8,200太低——25%渠道费后到手¥6,150，减总成本¥5,620，单台利润仅¥530。VP评分C3/G3/E3暴露了'独居年轻人的室友'缺乏痛点深度。如果VP提升到G4/E4，WTPadj可高出20%，定价空间完全不同。" },
  T04: { insight: "ToB成本+酒店场景+运维导航精准投入，低渠道费优势被充分利用。",
    review: "酒店迎宾机器人是被低估的好赛道：SAM 556亿全场第二，ToB渠道费仅15%。R2在运维（7.2分）和运动（5.8分）上投入较多，符合酒店对可靠性和自主移动的要求。OTA运维选旗舰正确——ToB客户最怕机器人坏了没人修。1,580台走量+210.5万利润，证明ToB成本策略被严重低估。" },
  T05: { insight: "情感体验三个旗舰档堆料爆表，312台销量撑不起¥3,120的dCOGS。",
    review: "最典型的'堆料教训'。VP很好（Eadj=5），WTPadj全场最高。但R2选了多轮对话·旗舰+触摸拥抱·旗舰+情绪识别·旗舰，三个旗舰合计dCOGS约1,020元，总dCOGS 3,120元全场最高。定价¥15,800看似合理，但ToC 25%渠道费后到手¥11,850，只卖312台——高价+价格敏感双重夹击。如果三个旗舰降到标准，省的成本支撑更低定价，走量翻倍利润可超150万。" },
  T06: { insight: "幼儿园AI助教精准卡位，安全合规是刚需不是堆料，单台利润¥3,708全场最高。",
    review: "差异化策略正确打法。C=5分（全场唯一）说明人群定位极清晰。安全维度8.5分——儿童模式旗舰+内容合规旗舰是幼儿园硬性门槛，不是堆料是刚需。感知选旗舰（记录每个孩子参与度）直接对应VP'个性化发展报告'的承诺。dCOGS 2,860元不低但每一分钱都花在VP承诺的能力上。ToB 15%低渠道费+高定价+445台=165万利润。" },
  T07: { insight: "极简降本走通了量（1,380台），但单台¥377——ToC渠道费是利润杀手。",
    review: "和第3组类似的极简路线，面向老人ToC。8张基础卡、无屏降本、定价¥7,800。走量1,380台说明低价有效。但25%渠道费把利润压薄——到手¥5,850减总成本¥5,440=单台¥410。如果R1选ToB而非ToC，渠道费从25%降到15%，同定价下每台多¥780，利润翻倍。这是渠道选择影响利润的最直接案例。" },
  T08: { insight: "ToB渠道优势+成本纪律+运维导航精准投入，三重叠加造就利润冠军。",
    review: "三个正确决策的叠加。第一，赛道对了：ToB成本老人，SAM 562亿全场最大，15%低渠道费是结构性优势。第二，选卡有纪律：9张卡全标准档（除OTA运维旗舰），没有旗舰感知或交互卡——社区照料中心需要'可靠巡护工具'而非'温暖陪伴者'。第三，定价¥11,200精准：到手¥9,520减总成本¥6,060=单台¥3,460×1,820台=325万。" },
  T09: { insight: "唯一发生战略调整的组——R2访谈发现'退休知识分子'需求更像成人而非老人。",
    review: "最有教学价值的案例。R1定位ToC差异化老人（退休知识分子的学伴），但R2访谈发现这群人需求更像高知成人（智力激活、新闻讨论）。选卡偏向交互（8.0分）和感知（6.5分），老人模式只选标准档。产品最终匹配ToC差异化成人。利润71万不算高，但展示了'R1假设在R2被推翻'的合理调整。讨论点：如果R1就选成人市场会怎样？" },
  T10: { insight: "作业场景需求真实但解法太弱，产品力6%全场最低——成本策略也有最低门槛。",
    review: "定位其实不差——'催作业'是真实高频痛点，C=4/G=4。但E=3暴露核心问题：专注计时+语音百科本质是智能闹钟+语音助手，手机就能做。R2印证：8张全基础卡，产品力Vscore 6%全场最低。定价¥6,800在25%渠道费下到手¥5,100，减总成本¥5,180——单台在亏钱。1,650台走量纯靠低价，总利润38万垫底。教训：成本策略不等于什么都不投入。" },
};

// ═══════════════════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════════════════
const V = 4200;
const GRID_CELLS = [
  "B2C_Differentiation_Elder","B2C_Differentiation_Adult","B2C_Differentiation_Child",
  "B2C_Cost_Elder","B2C_Cost_Adult","B2C_Cost_Child",
  "B2B_Differentiation_Elder","B2B_Differentiation_Adult","B2B_Differentiation_Child",
  "B2B_Cost_Elder","B2B_Cost_Adult","B2B_Cost_Child",
];
const GRID_LABELS = {
  B2C_Differentiation_Elder:"ToC差异化\n老人", B2C_Differentiation_Adult:"ToC差异化\n成人", B2C_Differentiation_Child:"ToC差异化\n儿童",
  B2C_Cost_Elder:"ToC成本\n老人", B2C_Cost_Adult:"ToC成本\n成人", B2C_Cost_Child:"ToC成本\n儿童",
  B2B_Differentiation_Elder:"ToB差异化\n老人", B2B_Differentiation_Adult:"ToB差异化\n成人", B2B_Differentiation_Child:"ToB差异化\n儿童",
  B2B_Cost_Elder:"ToB成本\n老人", B2B_Cost_Adult:"ToB成本\n成人", B2B_Cost_Child:"ToB成本\n儿童",
};
const DIMS = [
  { id:"interaction", label:"交互", icon:"💬", color:"#D97706" },
  { id:"perception", label:"感知", icon:"👁", color:"#7C3AED" },
  { id:"motion", label:"运动", icon:"🦿", color:"#0891B2" },
  { id:"safety", label:"安全", icon:"🛡", color:"#DC2626" },
  { id:"extend", label:"连接", icon:"🔌", color:"#059669" },
  { id:"ops", label:"运维", icon:"🔧", color:"#4F46E5" },
];

// ═══════════════════════════════════════════════════════════════════════════
// STYLE HELPERS
// ═══════════════════════════════════════════════════════════════════════════
const FONT = "'Noto Sans SC', 'PingFang SC', -apple-system, sans-serif";
const BG = "#0B0F1A";
const CARD_BG = "#111827";
const CARD_BORDER = "#1E293B";
const ACCENT = "#10B981";
const ACCENT2 = "#6366F1";
const WARN = "#F59E0B";
const DANGER = "#EF4444";
const TEXT1 = "#F1F5F9";
const TEXT2 = "#94A3B8";
const TEXT3 = "#64748B";

const card = (extra) => ({
  background: CARD_BG, border: `1px solid ${CARD_BORDER}`, borderRadius: 16,
  padding: 20, ...extra
});

const badge = (bg, color, extra) => ({
  display:"inline-block", padding:"3px 10px", borderRadius:6, fontSize:11, fontWeight:700,
  letterSpacing:"0.03em", background:bg, color, ...extra
});

// ═══════════════════════════════════════════════════════════════════════════
// COMPONENTS
// ═══════════════════════════════════════════════════════════════════════════

// ── Team colors for grid circles ──
const TEAM_COLORS = ["#10B981","#6366F1","#F59E0B","#EF4444","#3B82F6","#EC4899","#8B5CF6","#14B8A6","#F97316","#06B6D4"];

// ── 12-Grid Heatmap with circle badges ──
function GridHeatmap({ teams, field="r1" }) {
  const grouped = useMemo(() => {
    const m = {};
    teams.forEach(t => {
      const g = t[field]?.grid || t.r1.grid;
      if (!m[g]) m[g] = [];
      const num = t.name.replace(/[^0-9]/g,"");
      m[g].push({ num, name: t.name, color: TEAM_COLORS[(parseInt(num)||1)-1] || ACCENT });
    });
    return m;
  }, [teams, field]);

  return (
    <div>
      <div style={{display:"grid",gridTemplateColumns:"60px repeat(3,1fr)",gap:0,fontSize:11}}>
        <div/>
        {['老人',"成人","儿童"].map(a=>(
          <div key={a} style={{textAlign:"center",color:TEXT3,padding:"4px 0",fontWeight:600}}>{a}</div>
        ))}
        {["B2C_Differentiation","B2C_Cost","B2B_Differentiation","B2B_Cost"].map((row)=>{
          const rowLabel = row.replace("B2C_","ToC·").replace("B2B_","ToB·").replace("Differentiation","差异化").replace("Cost","成本");
          return (
            <Fragment key={row}>
            <div style={{display:"flex",alignItems:"center",justifyContent:"flex-end",paddingRight:8,color:TEXT3,fontWeight:600,fontSize:10,lineHeight:1.2,textAlign:"right"}}>
              {rowLabel}
            </div>
            {["Elder","Adult","Child"].map(age => {
              const cellId = `${row}_${age}`;
              const here = grouped[cellId] || [];
              return (
                <div key={cellId} style={{
                  margin:2, padding:"10px 6px", borderRadius:8,
                  background: here.length > 0 ? "rgba(16,185,129,0.06)" : "rgba(255,255,255,0.015)",
                  border: here.length > 0 ? "1.5px solid rgba(16,185,129,0.2)" : "1px solid rgba(255,255,255,0.04)",
                  minHeight: 56, display:"flex", alignItems:"center", justifyContent:"center",
                  gap:5, flexWrap:"wrap", transition:"all 0.2s"
                }}>
                  {here.map((t,i) => (
                    <div key={i} title={t.name} style={{
                      width:28, height:28, borderRadius:"50%",
                      background:t.color, color:"#fff",
                      display:"flex", alignItems:"center", justifyContent:"center",
                      fontSize:12, fontWeight:800,
                      boxShadow:`0 0 0 2px ${CARD_BG}, 0 2px 6px rgba(0,0,0,0.3)`,
                      cursor:"default"
                    }}>
                      {t.num}
                    </div>
                  ))}
                </div>
              );
            })}
            </Fragment>
          );
        })}
      </div>
    </div>
  );
}

// ── SVG Radar (small, for inline use) ──
function MiniRadar({ scores, size=160, color=ACCENT }) {
  const cx=size/2, cy=size/2, maxR=size/2-24, maxVal=10;
  const toXY = (i, r) => {
    const angle = (Math.PI*2*i/6) - Math.PI/2;
    return { x: cx + r*Math.cos(angle), y: cy + r*Math.sin(angle) };
  };
  const rings = [3,6,9];
  const dimIds = DIMS.map(d=>d.id);
  const pts = dimIds.map((d,i) => toXY(i, ((scores[d]||0)/maxVal)*maxR));
  const polyStr = pts.map(p=>`${p.x},${p.y}`).join(" ");

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      {rings.map(v => {
        const r = (v/maxVal)*maxR;
        const hexPts = Array.from({length:6},(_,i)=>toXY(i,r));
        return <polygon key={v} points={hexPts.map(p=>`${p.x},${p.y}`).join(" ")} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth={0.8}/>;
      })}
      {dimIds.map((d,i)=>{
        const end = toXY(i,maxR);
        return <line key={d} x1={cx} y1={cy} x2={end.x} y2={end.y} stroke="rgba(255,255,255,0.06)" strokeWidth={0.5}/>;
      })}
      <polygon points={polyStr} fill={color+"30"} stroke={color} strokeWidth={1.5}/>
      {dimIds.map((d,i)=>{
        const p = toXY(i, maxR+14);
        return <text key={d} x={p.x} y={p.y} textAnchor="middle" dominantBaseline="middle" fill={TEXT3} fontSize={9}>{DIMS[i].icon}</text>;
      })}
    </svg>
  );
}

// ── SAM × WTP Dual Axis Chart ──
function SamWtpChart({ teams }) {
  const data = useMemo(() =>
    [...teams].sort((a,b)=>b.r1.sam-a.r1.sam).map(t => ({
      name: t.name, sam: t.r1.sam, wtp: t.r1.wtpAdj,
      strategy: t.r1.grid.includes("Cost") ? "成本" : "差异化",
      gridLabel: t.r1.gridLabel
    }))
  , [teams]);

  const SamTooltip = ({active, payload}) => {
    if (!active || !payload?.length) return null;
    const d = payload[0]?.payload;
    if (!d) return null;
    return (
      <div style={{background:CARD_BG,border:`1px solid ${CARD_BORDER}`,borderRadius:8,padding:"8px 12px",fontSize:12,color:TEXT1}}>
        <div style={{fontWeight:700,marginBottom:4}}>{d.name}（{d.gridLabel}）</div>
        <div style={{color:"#3B82F6"}}>SAM: {d.sam}亿</div>
        <div style={{color:ACCENT}}>WTPadj: ¥{d.wtp.toLocaleString()}</div>
      </div>
    );
  };

  return (
    <ResponsiveContainer width="100%" height={300}>
      <BarChart data={data} margin={{left:8,right:8,top:8,bottom:4}} barGap={2}>
        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" vertical={false}/>
        <XAxis dataKey="name" tick={{fill:TEXT2,fontSize:11}} axisLine={{stroke:"rgba(255,255,255,0.08)"}} tickLine={false}/>
        <YAxis yAxisId="sam" orientation="left" tick={{fill:"#3B82F6",fontSize:10}} axisLine={false} tickLine={false} tickFormatter={v=>`${v}亿`}/>
        <YAxis yAxisId="wtp" orientation="right" tick={{fill:ACCENT,fontSize:10}} axisLine={false} tickLine={false} tickFormatter={v=>`${(v/1000).toFixed(0)}k`}/>
        <Tooltip content={SamTooltip}/>
        <Bar yAxisId="sam" dataKey="sam" fill="#3B82F6" radius={[4,4,0,0]} barSize={24} opacity={0.8}/>
        <Bar yAxisId="wtp" dataKey="wtp" fill={ACCENT} radius={[4,4,0,0]} barSize={24} opacity={0.8}/>
      </BarChart>
    </ResponsiveContainer>
  );
}

// ── Profit Bar Chart ──
function ProfitChart({ teams }) {
  const data = [...teams].sort((a,b)=>b.r2.profit-a.r2.profit).map(t=>({
    name:t.name, value:Math.round(t.r2.profit/10000), raw:t.r2.profit,
    color: t.r2.profit >= 2000000 ? ACCENT : t.r2.profit >= 1000000 ? "#3B82F6" : t.r2.profit >= 500000 ? WARN : DANGER
  }));
  return (
    <ResponsiveContainer width="100%" height={280}>
      <BarChart data={data} layout="vertical" margin={{left:0,right:40,top:4,bottom:4}}>
        <XAxis type="number" hide/>
        <YAxis type="category" dataKey="name" width={46} tick={{fill:TEXT2,fontSize:11}} axisLine={false} tickLine={false}/>
        <Tooltip cursor={{fill:"rgba(255,255,255,0.03)"}} contentStyle={{background:CARD_BG,border:`1px solid ${CARD_BORDER}`,borderRadius:8,fontSize:12,color:TEXT1}} formatter={(v)=>[`${v}万元`,"利润"]}/>
        <Bar dataKey="value" radius={[0,6,6,0]} barSize={18}>
          {data.map((e,i)=><Cell key={i} fill={e.color}/>)}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

// ── Price vs Profit Scatter ──
function PriceScatter({ teams }) {
  const data = teams.map(t=>({
    name:t.name, price:t.r2.price, profit:Math.round(t.r2.profit/10000),
    units:t.r2.units, color: t.r1.grid.includes("Differentiation") ? ACCENT2 : WARN,
    strategy: t.r1.grid.includes("Differentiation") ? "差异化" : "成本"
  }));

  const CustomTooltip = ({active, payload}) => {
    if (!active || !payload?.length) return null;
    const d = payload[0].payload;
    return (
      <div style={{background:CARD_BG,border:`1px solid ${CARD_BORDER}`,borderRadius:8,padding:"8px 12px",fontSize:12,color:TEXT1}}>
        <div style={{fontWeight:700,marginBottom:4}}>{d.name}（{d.strategy}）</div>
        <div>定价：¥{d.price.toLocaleString()}</div>
        <div>利润：{d.profit}万</div>
        <div>销量：{d.units}台</div>
      </div>
    );
  };

  return (
    <ResponsiveContainer width="100%" height={280}>
      <ScatterChart margin={{left:8,right:20,top:10,bottom:10}}>
        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)"/>
        <XAxis type="number" dataKey="price" name="定价" tick={{fill:TEXT3,fontSize:10}} axisLine={{stroke:"rgba(255,255,255,0.1)"}} tickFormatter={v=>`¥${(v/1000).toFixed(0)}k`}/>
        <YAxis type="number" dataKey="profit" name="利润" tick={{fill:TEXT3,fontSize:10}} axisLine={{stroke:"rgba(255,255,255,0.1)"}} tickFormatter={v=>`${v}万`}/>
        <ZAxis type="number" dataKey="units" range={[80,500]}/>
        <Tooltip content={<CustomTooltip/>}/>
        <Scatter data={data.filter(d=>d.strategy==="差异化")} fill={ACCENT2} name="差异化"/>
        <Scatter data={data.filter(d=>d.strategy==="成本")} fill={WARN} name="成本"/>
      </ScatterChart>
    </ResponsiveContainer>
  );
}

// ── Consistency Badge ──
function ConsistencyBadge({ t }) {
  const same = t.r1.grid === t.r2.bestGrid;
  const profitable = t.r2.profit > 1000000;
  if (same) return <span style={badge(ACCENT+"20",ACCENT)}>✓ 战略一致</span>;
  if (profitable) return <span style={badge("#3B82F620","#3B82F6")}>↗ 跑偏但赚到</span>;
  return <span style={badge(DANGER+"20",DANGER)}>✕ 跑偏且亏损</span>;
}

// ── Team Detail Modal ──
function TeamModal({ team:t, onClose }) {
  if (!t) return null;
  return (
    <div onClick={onClose} style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.7)",zIndex:100,display:"flex",alignItems:"center",justifyContent:"center",padding:20,backdropFilter:"blur(4px)"}}>
      <div onClick={e=>e.stopPropagation()} style={{...card({maxWidth:680,maxHeight:"85vh",overflowY:"auto",width:"100%",padding:28})}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:20}}>
          <div style={{fontSize:20,fontWeight:800,color:TEXT1}}>{t.name} 完整决策摘要</div>
          <button onClick={onClose} style={{background:"none",border:"none",color:TEXT3,fontSize:20,cursor:"pointer"}}>✕</button>
        </div>

        {/* R1 */}
        <div style={{padding:"14px 18px",borderRadius:12,background:"linear-gradient(135deg,#065f46,#14532d)",color:"#fff",marginBottom:16}}>
          <div style={{fontSize:11,opacity:0.7,marginBottom:4}}>Round 1 · 战略定位</div>
          <div style={{fontSize:16,fontWeight:800}}>{t.r1.gridLabel} · {t.r1.arch}</div>
          <div style={{fontSize:12,opacity:0.85,marginTop:8,lineHeight:1.7}}>{t.r1.vp}</div>
          <div style={{display:"flex",gap:8,marginTop:10}}>
            {["C","G","E"].map(k=>(
              <span key={k} style={{padding:"2px 8px",borderRadius:4,background:"rgba(255,255,255,0.15)",fontSize:11,fontWeight:700}}>
                {k}={t.r1[k]}{k==="E" && t.r1.Eadj !== t.r1.E ? `→${t.r1.Eadj}` : ""}
              </span>
            ))}
            <span style={{padding:"2px 8px",borderRadius:4,background:"rgba(255,255,255,0.15)",fontSize:11}}>SAM {t.r1.sam}亿</span>
          </div>
        </div>

        {/* R2 */}
        <div style={{display:"flex",gap:16,marginBottom:16}}>
          <div style={{flex:1}}>
            <div style={{fontSize:13,fontWeight:700,color:TEXT1,marginBottom:8}}>Round 2 · 产品方案</div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:8,marginBottom:12}}>
              <div style={{padding:"10px 12px",borderRadius:10,background:"rgba(16,185,129,0.08)",border:"1px solid rgba(16,185,129,0.2)"}}>
                <div style={{fontSize:10,color:TEXT3}}>定价</div>
                <div style={{fontSize:18,fontWeight:800,color:ACCENT}}>¥{t.r2.price.toLocaleString()}</div>
              </div>
              <div style={{padding:"10px 12px",borderRadius:10,background:"rgba(99,102,241,0.08)",border:"1px solid rgba(99,102,241,0.2)"}}>
                <div style={{fontSize:10,color:TEXT3}}>利润</div>
                <div style={{fontSize:18,fontWeight:800,color:ACCENT2}}>{Math.round(t.r2.profit/10000)}万</div>
              </div>
              <div style={{padding:"10px 12px",borderRadius:10,background:"rgba(245,158,11,0.08)",border:"1px solid rgba(245,158,11,0.2)"}}>
                <div style={{fontSize:10,color:TEXT3}}>销量</div>
                <div style={{fontSize:18,fontWeight:800,color:WARN}}>{t.r2.units}台</div>
              </div>
            </div>
            <div style={{fontSize:12,color:TEXT2,marginBottom:4}}>能力卡（{t.r2.cardCount}张）</div>
            <div style={{display:"flex",gap:4,flexWrap:"wrap"}}>
              {t.r2.cards.map((c,i)=>(
                <span key={i} style={{padding:"2px 8px",borderRadius:4,background:"rgba(255,255,255,0.05)",border:"1px solid rgba(255,255,255,0.08)",fontSize:10,color:TEXT2}}>{c}</span>
              ))}
            </div>
          </div>
          <div style={{width:160,flexShrink:0,display:"flex",alignItems:"center",justifyContent:"center"}}>
            <MiniRadar scores={t.r2.radar} size={160}/>
          </div>
        </div>

        {/* Consistency */}
        <div style={{padding:"12px 16px",borderRadius:10,background:"rgba(255,255,255,0.03)",border:"1px solid rgba(255,255,255,0.06)"}}>
          <div style={{fontSize:12,color:TEXT3,marginBottom:6}}>跨轮一致性</div>
          <div style={{display:"flex",gap:12,alignItems:"center",fontSize:12,color:TEXT2}}>
            <span>R1: {t.r1.gridLabel}</span>
            <span style={{color:TEXT3}}>→</span>
            <span>R2最匹配: {t.r2.bestGridLabel}</span>
            <ConsistencyBadge t={t}/>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── AI Debrief Panel ──
const MOCK_R1_DEBRIEF = `## 全局观察

本届10组学生呈现清晰的两极分化：6组选择差异化策略，4组选择成本策略。差异化阵营中ToB和ToC各半，老人和儿童市场是热门赛道，成人差异化市场仅1组（第5组）选择，形成事实上的蓝海。

成本阵营全部选择了功能型架构——这是正确的战略一致性。但值得注意的是，4组成本策略的VP评分普遍偏低（G/E多为3分），说明"低价"不等于"不需要清晰的价值主张"。

## 典型对比：第1组 vs 第8组

两组都瞄准了老年市场的ToB端，但路径截然不同。第1组走差异化+体验型（SAM 339亿，WTP ¥21,194），聚焦'有温度的守护'；第8组走成本+功能型（SAM 562亿，WTP ¥17,561），聚焦"替代半个护工"。市场空间相差1.66倍，但WTP相差仅20%——这说明养老ToB市场本身有较高的支付刚性，成本策略拿到了更大的基数但并没有"便宜太多"。

Round 2的关键分化点：第1组需要在感知和交互上堆高能力以支撑溢价，第8组需要在运维和导航上做到极致效率。如果两组的R&D方向搞反了，利润差距会非常明显。

## 课堂讨论引导

1. 请第5组解释：你们是唯一选择ToC·差异化·成人的组——这是故意避开竞争，还是对市场判断不同？你们怎么看自己SAM偏小（354亿）但WTP最高的局面？

2. 第3组和第7组都选了ToC·成本策略——第3组面向成人独居年轻人，第7组面向老人子女。你们觉得谁的用户更容易转化为购买？为什么？`;

const MOCK_R2_DEBRIEF = `## 全局观察

10组最终利润排名出现了两个意外：利润冠军不是差异化ToC而是成本ToB（第8组，325万），利润最低的不是成本策略而是差异化策略中堆料最猛的第5组（62万）。这完美印证了模拟的核心教学点——**好产品不等于贵产品，精准匹配比堆料更重要**。

定价分布呈现双峰：差异化组集中在¥12,800-¥16,200区间，成本组集中在¥6,800-¥10,500区间。几乎所有组的最优定价都显著低于用户支付意愿——这就是渠道费的结构性效应。

## 利润冠军分析：第8组（ToB·成本·老人，325万）

第8组的成功来自三个要素的叠加：(1) ToB的低渠道费率（15% vs ToC的25%）保住了更多到手收入；(2) 功能型选卡精准（9张卡，dCOGS仅1,860），没有堆料；(3) 定价¥11,200恰好在成本市场的甜点区域——走量（1,820台）的同时单台还能赚钱。

与之形成鲜明对比的是第5组：旗舰级选卡（dCOGS 3,120）、情绪感知全拉满，定价¥15,800，但只卖了312台。好产品被高成本和低销量夹击，利润只有62万。

## 战略一致性分析

9组保持了跨轮一致（Round 1定位 = Round 2产品最匹配市场），说明大部分团队在访谈后没有偏离原始战略。唯一的例外是第9组：Round 1定位ToC·差异化·老人，但Round 2选卡后产品更像ToC·差异化·成人——访谈中发现退休知识分子的需求更像'高知成人'而非传统意义的'老人'，这是一个合理的战略调整。

## 课堂讨论引导

1. "为什么你们的最优定价都低于用户支付意愿？"——请各组算一下，如果渠道费从25%/15%降到10%，你们会怎么重新定价？

2. 第1组和第8组都做养老ToB，一个差异化一个成本。第8组利润几乎是第1组的2倍——但这是否意味着成本策略"永远"更好？如果这是一个3年的游戏，结论会不同吗？

3. 第5组花了最多的研发费，利润却倒数第二——"堆料"的问题到底出在哪里？是选卡方向错了，还是定价没跟上，还是市场本身不支撑？`;

function DebriefText({ text }) {
  const renderMd = (t) => {
    return t.split("\n\n").map((para, i) => {
      if (para.startsWith("## ")) {
        return <h3 key={i} style={{fontSize:15,fontWeight:800,color:ACCENT,margin:"20px 0 8px",letterSpacing:"0.02em"}}>{para.replace("## ","")}</h3>;
      }
      const html = para
        .replace(/\*\*(.+?)\*\*/g, `<strong style="color:${TEXT1}">$1</strong>`)
        .replace(/\n/g, "<br/>");
      return <p key={i} style={{fontSize:13,color:TEXT2,lineHeight:1.85,margin:"0 0 12px"}} dangerouslySetInnerHTML={{__html:html}}/>;
    });
  };
  return <div>{renderMd(text)}</div>;
}

function DebriefPanel({ round }) {
  const [loading, setLoading] = useState(false);
  const [text, setText] = useState("");
  const content = round === 1 ? MOCK_R1_DEBRIEF : MOCK_R2_DEBRIEF;

  function generate() {
    setLoading(true); setText("");
    setTimeout(() => { setLoading(false); setText(content); }, 1500);
  }

  return (
    <div style={{...card({padding:24})}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16}}>
        <div>
          <div style={{fontSize:14,fontWeight:800,color:ACCENT,letterSpacing:"0.05em"}}>
            AI 讲解稿 · {round === 1 ? "Round 1" : "Round 2"}
          </div>
          <div style={{fontSize:11,color:TEXT3,marginTop:2}}>基于全班数据自动生成，可直接用于课堂复盘</div>
        </div>
        <div style={{display:"flex",gap:8}}>
          {text && (
            <button onClick={()=>navigator.clipboard.writeText(text.replace(/\*\*/g,"").replace(/## /g,""))} style={{
              padding:"8px 16px",borderRadius:8,border:`1px solid ${CARD_BORDER}`,
              background:"transparent",color:TEXT2,fontSize:12,cursor:"pointer"
            }}>复制纯文本</button>
          )}
          <button onClick={generate} disabled={loading} style={{
            padding:"8px 18px",borderRadius:8,border:"none",cursor:loading?"wait":"pointer",
            background:loading?"#1E293B":ACCENT,color:loading?TEXT3:"#000",
            fontSize:12,fontWeight:700,transition:"all 0.2s"
          }}>{loading ? "生成中..." : text ? "重新生成" : "生成讲解稿"}</button>
        </div>
      </div>
      {text ? <DebriefText text={text}/> : (
        <div style={{textAlign:"center",padding:"40px 0",color:TEXT3,fontSize:13}}>
          点击"生成讲解稿"，系统将分析当前班级数据并生成复盘文稿
        </div>
      )}
    </div>
  );
}

// ── Team Reviews Accordion (React-controlled, no HTML details/summary) ──
function TeamReviews({ sorted }) {
  const [openId, setOpenId] = useState(null);
  const toggle = (id) => setOpenId(prev => prev === id ? null : id);

  return (
    <div style={card()}>
      <div style={{fontSize:13,fontWeight:700,color:TEXT1,marginBottom:4}}>全部小组逐一复盘</div>
      <div style={{fontSize:11,color:TEXT3,marginBottom:14}}>点击展开查看每组的详细分析</div>
      <div style={{display:"flex",flexDirection:"column",gap:6}}>
        {sorted.map((t,i)=>{
          const rev = TEAM_REVIEWS[t.id];
          const f = t.r1.grid.includes("B2B") ? 0.15 : 0.25;
          const totalCost = V + t.r2.dCOGS;
          const gm = ((t.r2.price*(1-f) - totalCost) / t.r2.price * 100);
          const medal = i<3 ? ["🥇","🥈","🥉"][i] : null;
          const isOpen = openId === t.id;
          return (
            <div key={t.id} style={{borderRadius:10,border:`1px solid ${i<3?"rgba(16,185,129,0.15)":"rgba(255,255,255,0.06)"}`,overflow:"hidden"}}>
              <div onClick={()=>toggle(t.id)} style={{
                padding:"12px 16px",cursor:"pointer",display:"flex",alignItems:"center",gap:12,
                background:i<3?"rgba(16,185,129,0.04)":"rgba(255,255,255,0.02)",
                transition:"background 0.15s"
              }}>
                <span style={{fontSize:12,color:i<3?ACCENT:TEXT3,fontWeight:700,width:28}}>
                  {medal || "#"+(i+1)}
                </span>
                <span style={{fontSize:13,fontWeight:700,color:TEXT1,width:52}}>{t.name}</span>
                <span style={{fontSize:11,color:TEXT2,width:140}}>{t.r1.gridLabel}</span>
                <span style={{fontSize:12,fontWeight:700,color:t.r2.profit>=2000000?ACCENT:t.r2.profit>=1000000?"#3B82F6":t.r2.profit>=500000?WARN:DANGER,width:64}}>
                  {Math.round(t.r2.profit/10000)}万
                </span>
                <span style={{flex:1,fontSize:11,color:TEXT3,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>
                  {rev?.insight || ""}
                </span>
                <span style={{fontSize:10,color:TEXT3,flexShrink:0,transition:"transform 0.2s",transform:isOpen?"rotate(180deg)":"rotate(0deg)"}}>▼</span>
              </div>
              {isOpen && (
                <div style={{padding:"16px 20px",background:"rgba(0,0,0,0.15)",borderTop:"1px solid rgba(255,255,255,0.04)"}}>
                  <div style={{display:"flex",gap:16,marginBottom:14,flexWrap:"wrap"}}>
                    {[
                      {l:"定价",v:"¥"+t.r2.price.toLocaleString(),c:TEXT2},
                      {l:"销量",v:t.r2.units.toLocaleString()+"台",c:TEXT2},
                      {l:"利润",v:Math.round(t.r2.profit/10000)+"万",c:t.r2.profit>=2000000?ACCENT:"#3B82F6"},
                      {l:"研发增量",v:"+¥"+t.r2.dCOGS.toLocaleString(),c:t.r2.dCOGS>2500?DANGER:WARN},
                      {l:"毛利率",v:gm.toFixed(0)+"%",c:gm>=30?ACCENT:gm>=20?WARN:DANGER},
                      {l:"单台利润",v:"¥"+t.r2.profitPerUnit.toLocaleString(),c:TEXT2},
                      {l:"卡数",v:t.r2.cardCount+"张",c:TEXT2},
                      {l:"产品力",v:(t.r2.vscore*100).toFixed(0)+"%",c:ACCENT2},
                    ].map(m=>(
                      <div key={m.l} style={{minWidth:80}}>
                        <div style={{fontSize:10,color:TEXT3}}>{m.l}</div>
                        <div style={{fontSize:14,fontWeight:700,color:m.c,marginTop:1}}>{m.v}</div>
                      </div>
                    ))}
                  </div>
                  <div style={{fontSize:12,color:TEXT2,lineHeight:1.85,padding:"12px 16px",borderRadius:8,background:"rgba(255,255,255,0.02)",border:"1px solid rgba(255,255,255,0.04)"}}>
                    {rev?.review || "暂无分析"}
                  </div>
                  <div style={{marginTop:12,display:"flex",gap:12}}>
                    <div style={{flex:1}}>
                      <div style={{fontSize:10,color:TEXT3,marginBottom:4}}>价值主张</div>
                      <div style={{fontSize:11,color:TEXT2,lineHeight:1.6,fontStyle:"italic"}}>
                        {'"'+t.r1.vp+'"'}
                      </div>
                    </div>
                    <div style={{width:120,flexShrink:0}}>
                      <MiniRadar scores={t.r2.radar} size={120} color={i<3?ACCENT:ACCENT2}/>
                    </div>
                  </div>
                  <div style={{marginTop:8}}>
                    <div style={{fontSize:10,color:TEXT3,marginBottom:4}}>能力卡</div>
                    <div style={{display:"flex",gap:4,flexWrap:"wrap"}}>
                      {t.r2.cards.map((c,ci)=>(
                        <span key={ci} style={{padding:"2px 8px",borderRadius:4,background:"rgba(255,255,255,0.04)",border:"1px solid rgba(255,255,255,0.06)",fontSize:10,color:TEXT2}}>{c}</span>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN APP
// ═══════════════════════════════════════════════════════════════════════════
const TABS = [
  { id:"r1", label:"Round 1 复盘" },
  { id:"r2", label:"Round 2 复盘" },
  { id:"cross", label:"跨轮对比" },
  { id:"debrief", label:"AI 讲解稿" },
  { id:"export", label:"导出" },
];

export default function TeacherDebrief() {
  const [tab, setTab] = useState("r1");
  const [selectedTeam, setSelectedTeam] = useState(null);
  const [debriefRound, setDebriefRound] = useState(2);

  const sorted = useMemo(()=>[...TEAMS].sort((a,b)=>b.r2.profit-a.r2.profit),[]);

  return (
    <div style={{fontFamily:FONT,background:BG,minHeight:"100vh",color:TEXT1}}>
      {/* Header */}
      <div style={{padding:"16px 24px",borderBottom:`1px solid ${CARD_BORDER}`,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
        <div>
          <div style={{fontSize:18,fontWeight:800,letterSpacing:"0.03em"}}>教师复盘面板</div>
          <div style={{fontSize:11,color:TEXT3,marginTop:2}}>EMBA-AI-SIM · LOVOT 中国市场创新模拟</div>
        </div>
        <div style={{display:"flex",gap:6,alignItems:"center"}}>
          <span style={{...badge("rgba(16,185,129,0.15)",ACCENT),fontSize:13}}>10 组</span>
          <span style={{...badge("rgba(99,102,241,0.15)",ACCENT2),fontSize:13}}>60 人</span>
        </div>
      </div>

      {/* Tab bar */}
      <div style={{display:"flex",gap:0,padding:"0 24px",borderBottom:`1px solid ${CARD_BORDER}`,background:"rgba(0,0,0,0.2)"}}>
        {TABS.map(t=>(
          <button key={t.id} onClick={()=>setTab(t.id)} style={{
            padding:"12px 20px",background:"none",border:"none",cursor:"pointer",
            fontSize:13,fontWeight:tab===t.id?700:500,
            color:tab===t.id?ACCENT:TEXT3,
            borderBottom:tab===t.id?`2px solid ${ACCENT}`:"2px solid transparent",
            transition:"all 0.15s"
          }}>{t.label}</button>
        ))}
      </div>

      {/* Content */}
      <div style={{padding:"20px 24px",maxWidth:1200,margin:"0 auto"}}>

        {/* ═══ Round 1 ═══ */}
        {tab==="r1" && (
          <div>
            <div style={{fontSize:14,fontWeight:700,color:TEXT1,marginBottom:16}}>Round 1 · 市场定位复盘</div>
            <div style={{...card({marginBottom:16})}}>
              <div style={{fontSize:13,fontWeight:700,color:TEXT1,marginBottom:4}}>战略分布图</div>
              <div style={{fontSize:11,color:TEXT3,marginBottom:12}}>各组在12格上的选择分布，颜色深浅代表集中程度</div>
              <GridHeatmap teams={TEAMS}/>
            </div>

            {/* SAM × WTPadj combined chart - full width */}
            <div style={{...card({marginBottom:16})}}>
              <div style={{fontSize:13,fontWeight:700,color:TEXT1,marginBottom:2}}>市场规模（SAM）× 支付意愿（WTPadj）</div>
              <div style={{fontSize:11,color:TEXT3,marginBottom:14}}>蓝柱=SAM（亿元，左轴），绿柱=WTPadj（元，右轴）。COST格市场大但WTP低，DIFF格反之——核心对冲</div>
              <SamWtpChart teams={TEAMS}/>
              <div style={{display:"flex",gap:16,marginTop:6}}>
                <span style={{display:"flex",alignItems:"center",gap:4,fontSize:10,color:TEXT3}}>
                  <span style={{width:10,height:10,borderRadius:2,background:"#3B82F6"}}/> SAM 市场规模（亿元）
                </span>
                <span style={{display:"flex",alignItems:"center",gap:4,fontSize:10,color:TEXT3}}>
                  <span style={{width:10,height:10,borderRadius:2,background:ACCENT}}/> WTPadj 调整后支付意愿（元）
                </span>
                <span style={{fontSize:10,color:TEXT3,opacity:0.7,marginLeft:8}}>按SAM降序排列</span>
              </div>
            </div>

            <div style={{display:"grid",gridTemplateColumns:"1fr",gap:16,marginBottom:16}}>
              {/* VP Score comparison */}
              <div style={card()}>
                <div style={{fontSize:13,fontWeight:700,color:TEXT1,marginBottom:2}}>VP 评分对比</div>
                <div style={{fontSize:11,color:TEXT3,marginBottom:12}}>C(覆盖)·G(泛化)·E(有效，含锦囊加分) 各1-5分</div>
                <div style={{display:"flex",flexDirection:"column",gap:4}}>
                  {/* Header */}
                  <div style={{display:"flex",alignItems:"center",gap:0,padding:"0 0 4px",borderBottom:`1px solid rgba(255,255,255,0.06)`}}>
                    <div style={{width:52,fontSize:10,color:TEXT3,fontWeight:600}}>组</div>
                    <div style={{flex:1,display:"flex"}}>
                      {[{l:"C 覆盖",c:"#10B981"},{l:"G 泛化",c:"#6366F1"},{l:"E 有效",c:"#F59E0B"}].map(h=>(
                        <div key={h.l} style={{flex:1,fontSize:10,color:h.c,fontWeight:600,textAlign:"center"}}>{h.l}</div>
                      ))}
                    </div>
                    <div style={{width:64,fontSize:10,color:TEXT3,fontWeight:600,textAlign:"center"}}>G×E→WTP</div>
                  </div>
                  {/* Rows */}
                  {[...TEAMS].sort((a,b)=>(b.r1.G*b.r1.Eadj)-(a.r1.G*a.r1.Eadj)).map(t=>{
                    const renderDots = (score, color) => (
                      <div style={{flex:1,display:"flex",justifyContent:"center",gap:3}}>
                        {[1,2,3,4,5].map(n=>(
                          <div key={n} style={{
                            width:14,height:14,borderRadius:"50%",
                            background: n<=score ? color : "rgba(255,255,255,0.06)",
                            border: n<=score ? "none" : "1px solid rgba(255,255,255,0.08)",
                            display:"flex",alignItems:"center",justifyContent:"center",
                            fontSize:8,fontWeight:700,color: n<=score ? "#000" : "transparent"
                          }}>{n}</div>
                        ))}
                      </div>
                    );
                    // WTP effect: λ(G)×λ(E), where λ: 1→0.70, 2→0.80, 3→0.90, 4→1.00, 5→1.10
                    const lambda = (s) => [0,0.70,0.80,0.90,1.00,1.10][s];
                    const wtpEffect = lambda(t.r1.G) * lambda(t.r1.Eadj);
                    const wtpPct = Math.round((wtpEffect - 1) * 100);
                    return (
                      <div key={t.id} style={{display:"flex",alignItems:"center",gap:0,padding:"5px 0",borderBottom:"1px solid rgba(255,255,255,0.03)"}}>
                        <div style={{width:52,fontSize:11,color:TEXT2,fontWeight:600}}>{t.name}</div>
                        <div style={{flex:1,display:"flex"}}>
                          {renderDots(t.r1.C, "#10B981")}
                          {renderDots(t.r1.G, "#6366F1")}
                          {renderDots(t.r1.Eadj, "#F59E0B")}
                        </div>
                        <div style={{width:64,textAlign:"center",fontSize:12,fontWeight:700,
                          color: wtpPct > 0 ? ACCENT : wtpPct < 0 ? DANGER : TEXT3
                        }}>
                          {wtpPct > 0 ? "+" : ""}{wtpPct}%
                        </div>
                      </div>
                    );
                  })}
                </div>
                <div style={{marginTop:10,padding:"8px 12px",borderRadius:8,background:"rgba(255,255,255,0.02)",border:"1px solid rgba(255,255,255,0.04)"}}>
                  <div style={{fontSize:10,color:TEXT3,lineHeight:1.6}}>
                    C 不进入WTP计算（仅作覆盖率展示）。G×E 以4分为基准，每升/降一档调整 ±10%。E 含锦囊加分（匹配度高→E升一档）。
                  </div>
                </div>
              </div>
            </div>

            {/* Team table */}
            <div style={card()}>
              <div style={{fontSize:13,fontWeight:700,color:TEXT1,marginBottom:12}}>小组明细</div>
              <div style={{overflowX:"auto"}}>
                <table style={{width:"100%",borderCollapse:"collapse",fontSize:12}}>
                  <thead>
                    <tr style={{borderBottom:`1px solid ${CARD_BORDER}`}}>
                      {["组","格子","架构","C","G","E","SAM","WTPadj",""].map((h,i)=>(
                        <th key={i} style={{padding:"8px 10px",textAlign:"left",color:TEXT3,fontWeight:600,fontSize:11}}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {TEAMS.map(t=>(
                      <tr key={t.id} onClick={()=>setSelectedTeam(t)} style={{borderBottom:`1px solid rgba(255,255,255,0.04)`,cursor:"pointer",transition:"background 0.1s"}}
                        onMouseEnter={e=>e.currentTarget.style.background="rgba(255,255,255,0.03)"}
                        onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
                        <td style={{padding:"10px",fontWeight:700,color:TEXT1}}>{t.name}</td>
                        <td style={{padding:"10px",color:TEXT2}}>{t.r1.gridLabel}</td>
                        <td style={{padding:"10px",color:TEXT2}}>{t.r1.arch}</td>
                        <td style={{padding:"10px",color:ACCENT,fontWeight:700}}>{t.r1.C}</td>
                        <td style={{padding:"10px",color:ACCENT2,fontWeight:700}}>{t.r1.G}</td>
                        <td style={{padding:"10px",color:WARN,fontWeight:700}}>{t.r1.Eadj}</td>
                        <td style={{padding:"10px",color:TEXT2}}>{t.r1.sam}亿</td>
                        <td style={{padding:"10px",color:TEXT2}}>¥{t.r1.wtpAdj.toLocaleString()}</td>
                        <td style={{padding:"10px"}}><span style={{color:ACCENT,fontSize:11}}>详情 →</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* ═══ Round 2 ═══ */}
        {tab==="r2" && (
          <div>
            <div style={{fontSize:14,fontWeight:700,color:TEXT1,marginBottom:16}}>Round 2 · 产品研发复盘</div>

            {/* Top 3 highlight — one per row */}
            <div style={{display:"flex",flexDirection:"column",gap:10,marginBottom:16}}>
              {sorted.slice(0,3).map((t,i)=>{
                const medalColors = ["#FFD700","#C0C0C0","#CD7F32"];
                const medalLabels = ["🥇 冠军","🥈 亚军","🥉 季军"];
                const roi = (t.r2.profit / (t.r2.units * t.r2.dCOGS) * 100).toFixed(0);
                const totalCostPerUnit = V + t.r2.dCOGS;
                const roiSimple = (t.r2.profit / (t.r2.units * totalCostPerUnit) * 100).toFixed(0);
                const gmRate = ((t.r2.price * (t.r1.grid.includes("B2B")?0.85:0.75) - totalCostPerUnit) / t.r2.price * 100).toFixed(0);
                return (
                  <div key={t.id} onClick={()=>setSelectedTeam(t)} style={{
                    ...card({cursor:"pointer",transition:"all 0.15s",position:"relative",overflow:"hidden",padding:"16px 24px"}),
                    borderColor: `${medalColors[i]}40`,
                    background: `linear-gradient(135deg, ${CARD_BG} 0%, ${medalColors[i]}08 100%)`
                  }}>
                    <div style={{display:"flex",alignItems:"center",gap:20}}>
                      {/* Medal + Name */}
                      <div style={{display:"flex",alignItems:"center",gap:12,minWidth:200}}>
                        <div style={{fontSize:28,lineHeight:1}}>{["🥇","🥈","🥉"][i]}</div>
                        <div>
                          <div style={{fontSize:18,fontWeight:800,color:TEXT1}}>{t.name}</div>
                          <div style={{fontSize:11,color:TEXT2,marginTop:2}}>{t.r1.gridLabel} · {t.r1.arch}</div>
                          <div style={{fontSize:11,color:medalColors[i],marginTop:4,lineHeight:1.5,maxWidth:280,fontStyle:"italic"}}>
                            {TEAM_REVIEWS[t.id]?.insight || ""}
                          </div>
                        </div>
                      </div>

                      {/* Key metrics */}
                      <div style={{display:"flex",gap:20,flex:1,alignItems:"center"}}>
                        <div style={{textAlign:"center"}}>
                          <div style={{fontSize:28,fontWeight:800,color:medalColors[i]}}>{Math.round(t.r2.profit/10000)}万</div>
                          <div style={{fontSize:10,color:TEXT3}}>利润</div>
                        </div>
                        <div style={{width:1,height:32,background:"rgba(255,255,255,0.08)"}}/>
                        <div style={{textAlign:"center"}}>
                          <div style={{fontSize:18,fontWeight:700,color:TEXT2}}>¥{t.r2.price.toLocaleString()}</div>
                          <div style={{fontSize:10,color:TEXT3}}>定价</div>
                        </div>
                        <div style={{textAlign:"center"}}>
                          <div style={{fontSize:18,fontWeight:700,color:TEXT2}}>{t.r2.units.toLocaleString()}</div>
                          <div style={{fontSize:10,color:TEXT3}}>销量</div>
                        </div>
                        <div style={{textAlign:"center"}}>
                          <div style={{fontSize:18,fontWeight:700,color:TEXT2}}>+¥{t.r2.dCOGS.toLocaleString()}</div>
                          <div style={{fontSize:10,color:TEXT3}}>研发增量</div>
                        </div>
                        <div style={{width:1,height:32,background:"rgba(255,255,255,0.08)"}}/>
                        <div style={{textAlign:"center"}}>
                          <div style={{fontSize:18,fontWeight:700,color:parseInt(gmRate)>=30?ACCENT:parseInt(gmRate)>=20?WARN:DANGER}}>{gmRate}%</div>
                          <div style={{fontSize:10,color:TEXT3}}>毛利率</div>
                        </div>
                        <div style={{textAlign:"center"}}>
                          <div style={{fontSize:18,fontWeight:700,color:parseInt(roi)>=100?ACCENT:parseInt(roi)>=50?WARN:DANGER}}>{roi}%</div>
                          <div style={{fontSize:10,color:TEXT3}}>研发ROI</div>
                        </div>
                      </div>

                      {/* Mini radar */}
                      <div style={{flexShrink:0}}>
                        <MiniRadar scores={t.r2.radar} size={80} color={medalColors[i]}/>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* R2 Strategic Map: R1 position vs R2 best-fit + SAM */}
            <div style={{...card({marginBottom:16})}}>
              <div style={{fontSize:13,fontWeight:700,color:TEXT1,marginBottom:2}}>战略地图复盘</div>
              <div style={{fontSize:11,color:TEXT3,marginBottom:14}}>
                实心圆 = Round 1 选的格子，空心虚线圆 = Round 2 产品实际最匹配格子。格子底部数字 = 该市场SAM（亿元），背景深浅反映市场规模。
              </div>
              <div style={{display:"grid",gridTemplateColumns:"60px repeat(3,1fr)",gap:0,fontSize:11}}>
                <div/>
                {["老人","成人","儿童"].map(a=>(
                  <div key={a} style={{textAlign:"center",color:TEXT3,padding:"4px 0",fontWeight:600}}>{a}</div>
                ))}
                {["B2C_Differentiation","B2C_Cost","B2B_Differentiation","B2B_Cost"].map((row)=>{
                  const rowLabel = row.replace("B2C_","ToC·").replace("B2B_","ToB·").replace("Differentiation","差异化").replace("Cost","成本");
                  return (
                    <Fragment key={row}>
                    <div style={{display:"flex",alignItems:"center",justifyContent:"flex-end",paddingRight:8,color:TEXT3,fontWeight:600,fontSize:10}}>
                      {rowLabel}
                    </div>
                    {["Elder","Adult","Child"].map(age => {
                      const cellId = `${row}_${age}`;
                      const r1Here = TEAMS.filter(t=>t.r1.grid===cellId).map(t=>{
                        const num = t.name.replace(/[^0-9]/g,"");
                        const profitNorm = Math.max(0, Math.min(1, (t.r2.profit - 300000) / (3300000 - 300000)));
                        const sz = Math.round(24 + profitNorm * 18);
                        return {num, color:TEAM_COLORS[(parseInt(num)||1)-1], id:t.id, r2Match: t.r2.bestGrid===cellId, sz, profit:t.r2.profit};
                      });
                      const r2Drift = TEAMS.filter(t=>t.r2.bestGrid===cellId && t.r1.grid!==cellId).map(t=>{
                        const num = t.name.replace(/[^0-9]/g,"");
                        const profitNorm = Math.max(0, Math.min(1, (t.r2.profit - 300000) / (3300000 - 300000)));
                        const sz = Math.round(24 + profitNorm * 18);
                        return {num, color:TEAM_COLORS[(parseInt(num)||1)-1], id:t.id, sz, profit:t.r2.profit};
                      });
                      const teamHere = TEAMS.find(t=>t.r1.grid===cellId);
                      const sam = teamHere ? teamHere.r1.sam : 0;
                      const samNorm = sam > 0 ? Math.max(0, Math.min(1, (sam - 300) / (570 - 300))) : 0;
                      const hasContent = r1Here.length > 0 || r2Drift.length > 0;
                      return (
                        <div key={cellId} style={{
                          margin:2, padding:"6px 4px 4px", borderRadius:8,
                          background: sam > 0 ? `rgba(16,185,129,${0.03 + samNorm * 0.12})` : "rgba(255,255,255,0.01)",
                          border: hasContent ? `1px solid rgba(16,185,129,${0.12 + samNorm * 0.2})` : "1px solid rgba(255,255,255,0.03)",
                          minHeight:68, display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center",
                          gap:3
                        }}>
                          <div style={{display:"flex",gap:4,flexWrap:"wrap",justifyContent:"center",minHeight:32,alignItems:"center"}}>
                            {r1Here.map((t) => (
                              <div key={"r1"+t.id} title={`${Math.round(t.profit/10000)}万`} style={{
                                width:t.sz, height:t.sz, borderRadius:"50%",
                                background:t.color, color:"#fff",
                                display:"flex", alignItems:"center", justifyContent:"center",
                                fontSize:t.sz >= 32 ? 15 : 13, fontWeight:900,
                                boxShadow: t.r2Match ? `0 0 0 3px ${ACCENT}` : `0 0 0 2px ${CARD_BG}`,
                              }}>
                                {t.num}
                              </div>
                            ))}
                            {r2Drift.map((t) => (
                              <div key={"r2"+t.id} title={`${Math.round(t.profit/10000)}万`} style={{
                                width:t.sz, height:t.sz, borderRadius:"50%",
                                background:"transparent",
                                border:`2px dashed ${t.color}`,
                                color:t.color,
                                display:"flex", alignItems:"center", justifyContent:"center",
                                fontSize:t.sz >= 32 ? 15 : 13, fontWeight:900,
                              }}>
                                {t.num}
                              </div>
                            ))}
                          </div>
                          {sam > 0 && (
                            <div style={{fontSize:9,color:`rgba(16,185,129,${0.4 + samNorm * 0.4})`,fontWeight:600}}>
                              {sam}亿
                            </div>
                          )}
                        </div>
                      );
                    })}
                    </Fragment>
                  );
                })}
              </div>
              <div style={{display:"flex",gap:16,marginTop:10,flexWrap:"wrap"}}>
                <span style={{display:"flex",alignItems:"center",gap:6,fontSize:10,color:TEXT3}}>
                  <span style={{width:18,height:18,borderRadius:"50%",background:ACCENT,display:"flex",alignItems:"center",justifyContent:"center",fontSize:8,color:"#fff",fontWeight:800}}>N</span>
                  R1 定位（实心）
                </span>
                <span style={{display:"flex",alignItems:"center",gap:6,fontSize:10,color:TEXT3}}>
                  <span style={{width:18,height:18,borderRadius:"50%",border:`2px dashed ${WARN}`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:8,color:WARN,fontWeight:800}}>N</span>
                  R2 跑偏至此（虚线）
                </span>
                <span style={{display:"flex",alignItems:"center",gap:6,fontSize:10,color:TEXT3}}>
                  <span style={{width:18,height:18,borderRadius:"50%",background:ACCENT,boxShadow:`0 0 0 3px ${ACCENT}`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:8,color:"#fff",fontWeight:800}}>N</span>
                  R1=R2 一致（绿圈）
                </span>
                <span style={{display:"flex",alignItems:"center",gap:8,fontSize:10,color:TEXT3}}>
                  <span style={{display:"flex",gap:2}}>
                    <span style={{width:14,height:14,borderRadius:3,background:"rgba(16,185,129,0.06)"}}/>
                    <span style={{width:14,height:14,borderRadius:3,background:"rgba(16,185,129,0.10)"}}/>
                    <span style={{width:14,height:14,borderRadius:3,background:"rgba(16,185,129,0.15)"}}/>
                  </span>
                  底色越深 = SAM越大
                </span>
                <span style={{display:"flex",alignItems:"center",gap:6,fontSize:10,color:TEXT3}}>
                  <span style={{display:"flex",alignItems:"center",gap:2}}>
                    <span style={{width:14,height:14,borderRadius:"50%",background:"rgba(255,255,255,0.15)"}}/>
                    <span style={{width:20,height:20,borderRadius:"50%",background:"rgba(255,255,255,0.15)"}}/>
                    <span style={{width:26,height:26,borderRadius:"50%",background:"rgba(255,255,255,0.15)"}}/>
                  </span>
                  圆越大 = 利润越高
                </span>
              </div>
            </div>

            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:16,marginBottom:16}}>
              {/* Profit ranking */}
              <div style={card()}>
                <div style={{fontSize:13,fontWeight:700,color:TEXT1,marginBottom:2}}>利润排名</div>
                <div style={{fontSize:11,color:TEXT3,marginBottom:12}}>最终利润（万元），颜色区分档位</div>
                <ProfitChart teams={TEAMS}/>
                <div style={{display:"flex",gap:10,marginTop:4}}>
                  {[{l:"200万+",c:ACCENT},{l:"100-200万",c:"#3B82F6"},{l:"50-100万",c:WARN},{l:"<50万",c:DANGER}].map(x=>(
                    <span key={x.l} style={{display:"flex",alignItems:"center",gap:4,fontSize:10,color:TEXT3}}>
                      <span style={{width:8,height:8,borderRadius:2,background:x.c}}/>{x.l}
                    </span>
                  ))}
                </div>
              </div>

              {/* Price vs Profit scatter */}
              <div style={card()}>
                <div style={{fontSize:13,fontWeight:700,color:TEXT1,marginBottom:2}}>定价 × 利润 × 销量</div>
                <div style={{fontSize:11,color:TEXT3,marginBottom:12}}>气泡大小=销量，紫=差异化，橙=成本</div>
                <PriceScatter teams={TEAMS}/>
              </div>
            </div>

            {/* Cost vs performance with ROI */}
            <div style={card({marginBottom:16})}>
              <div style={{fontSize:13,fontWeight:700,color:TEXT1,marginBottom:12}}>研发投入 vs 产品力 vs ROI vs 利润</div>
              <div style={{display:"grid",gridTemplateColumns:"repeat(7,1fr)",gap:8,fontSize:11}}>
                <div style={{color:TEXT3,fontWeight:700,padding:"6px 8px"}}>组</div>
                <div style={{color:TEXT3,fontWeight:700,padding:"6px 8px"}}>研发增量</div>
                <div style={{color:TEXT3,fontWeight:700,padding:"6px 8px"}}>产品力</div>
                <div style={{color:TEXT3,fontWeight:700,padding:"6px 8px"}}>风险</div>
                <div style={{color:TEXT3,fontWeight:700,padding:"6px 8px"}}>毛利率</div>
                <div style={{color:TEXT3,fontWeight:700,padding:"6px 8px"}}>研发ROI</div>
                <div style={{color:TEXT3,fontWeight:700,padding:"6px 8px"}}>利润</div>
                {sorted.map(t=>{
                  const f = t.r1.grid.includes("B2B") ? 0.15 : 0.25;
                  const totalCost = V + t.r2.dCOGS;
                  const gm = ((t.r2.price*(1-f) - totalCost) / t.r2.price * 100);
                  const roi = (t.r2.profit / (t.r2.units * t.r2.dCOGS) * 100);
                  return (
                    <Fragment key={t.id}>
                    <div style={{padding:"6px 8px",color:TEXT1,fontWeight:600}}>{t.name}</div>
                    <div style={{padding:"6px 8px",color:t.r2.dCOGS>2500?DANGER:t.r2.dCOGS>1800?WARN:ACCENT}}>+¥{t.r2.dCOGS.toLocaleString()}</div>
                    <div style={{padding:"6px 8px"}}>
                      <div style={{width:"100%",height:6,borderRadius:3,background:"rgba(255,255,255,0.06)"}}>
                        <div style={{width:`${Math.min(t.r2.vscore*100*3,100)}%`,height:6,borderRadius:3,background:ACCENT2}}/>
                      </div>
                      <span style={{fontSize:10,color:TEXT3}}>{(t.r2.vscore*100).toFixed(0)}%</span>
                    </div>
                    <div style={{padding:"6px 8px",color:t.r2.riskTotal>0.4?DANGER:t.r2.riskTotal>0.3?WARN:TEXT2}}>{(t.r2.riskTotal*100).toFixed(0)}%</div>
                    <div style={{padding:"6px 8px",fontWeight:600,color:gm>=30?ACCENT:gm>=20?WARN:DANGER}}>{gm.toFixed(0)}%</div>
                    <div style={{padding:"6px 8px",fontWeight:600,color:roi>=100?ACCENT:roi>=50?"#3B82F6":WARN}}>{roi.toFixed(0)}%</div>
                    <div style={{padding:"6px 8px",color:t.r2.profit>=2000000?ACCENT:t.r2.profit>=1000000?"#3B82F6":WARN,fontWeight:700}}>{Math.round(t.r2.profit/10000)}万</div>
                    </Fragment>
                  );
                })}
              </div>
              <div style={{marginTop:10,padding:"8px 12px",borderRadius:8,background:"rgba(255,255,255,0.02)",border:"1px solid rgba(255,255,255,0.04)"}}>
                <div style={{fontSize:10,color:TEXT3,lineHeight:1.6}}>
                  研发ROI = 利润 ÷ (销量 × dCOGS)，衡量每一元研发增量投入带来多少利润。毛利率 = (到手价 - 单台总成本) ÷ 售价。
                </div>
              </div>
            </div>

            {/* Per-team detailed reviews */}
            <TeamReviews sorted={sorted} onSelect={setSelectedTeam}/>
          </div>
        )}

        {/* ═══ Cross-Round ═══ */}
        {tab==="cross" && (
          <div>
            <div style={{fontSize:14,fontWeight:700,color:TEXT1,marginBottom:16}}>跨轮对比 · "你说的" vs "你做的"</div>

            {/* Consistency overview */}
            <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:12,marginBottom:16}}>
              {[
                {label:"战略一致", count:TEAMS.filter(t=>t.r1.grid===t.r2.bestGrid).length, color:ACCENT, desc:"Round 1定位 = Round 2产品"},
                {label:"跑偏但赚到", count:TEAMS.filter(t=>t.r1.grid!==t.r2.bestGrid && t.r2.profit>1000000).length, color:"#3B82F6", desc:"产品跑偏但利润仍可观"},
                {label:"跑偏且亏损", count:TEAMS.filter(t=>t.r1.grid!==t.r2.bestGrid && t.r2.profit<=1000000).length, color:DANGER, desc:"偏离定位且利润低"},
              ].map(x=>(
                <div key={x.label} style={card({textAlign:"center"})}>
                  <div style={{fontSize:36,fontWeight:800,color:x.color}}>{x.count}</div>
                  <div style={{fontSize:13,fontWeight:700,color:TEXT1,marginTop:4}}>{x.label}</div>
                  <div style={{fontSize:11,color:TEXT3,marginTop:2}}>{x.desc}</div>
                </div>
              ))}
            </div>

            {/* Per-team consistency detail */}
            <div style={card({marginBottom:16})}>
              <div style={{fontSize:13,fontWeight:700,color:TEXT1,marginBottom:12}}>逐组一致性分析</div>
              <div style={{display:"flex",flexDirection:"column",gap:8}}>
                {TEAMS.map(t=>{
                  const same = t.r1.grid === t.r2.bestGrid;
                  return (
                    <div key={t.id} onClick={()=>setSelectedTeam(t)} style={{
                      display:"flex",alignItems:"center",gap:12,padding:"12px 16px",borderRadius:10,cursor:"pointer",
                      background: same ? "rgba(16,185,129,0.04)" : "rgba(239,68,68,0.04)",
                      border: `1px solid ${same ? "rgba(16,185,129,0.15)" : "rgba(239,68,68,0.15)"}`,
                      transition:"background 0.15s"
                    }}>
                      <div style={{width:52,fontWeight:700,color:TEXT1,fontSize:13,flexShrink:0}}>{t.name}</div>
                      <div style={{flex:1,display:"flex",alignItems:"center",gap:8,fontSize:12}}>
                        <span style={{padding:"3px 10px",borderRadius:6,background:"rgba(99,102,241,0.1)",color:ACCENT2,fontWeight:600,fontSize:11}}>
                          R1: {t.r1.gridLabel}
                        </span>
                        <span style={{color:TEXT3,fontSize:16}}>{same?"=":"→"}</span>
                        <span style={{padding:"3px 10px",borderRadius:6,background:same?"rgba(16,185,129,0.1)":"rgba(245,158,11,0.1)",color:same?ACCENT:WARN,fontWeight:600,fontSize:11}}>
                          R2: {t.r2.bestGridLabel}
                        </span>
                      </div>
                      <ConsistencyBadge t={t}/>
                      <div style={{width:80,textAlign:"right",fontWeight:700,color:t.r2.profit>=2000000?ACCENT:t.r2.profit>=1000000?"#3B82F6":WARN,fontSize:13}}>
                        {Math.round(t.r2.profit/10000)}万
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Radar comparison: top vs bottom */}
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:16}}>
              <div style={card()}>
                <div style={{fontSize:13,fontWeight:700,color:TEXT1,marginBottom:4}}>利润冠军 vs 利润末位 · 能力雷达</div>
                <div style={{fontSize:11,color:TEXT3,marginBottom:16}}>绿=第8组（325万），红=第10组（38万）</div>
                <div style={{display:"flex",justifyContent:"center",position:"relative"}}>
                  <MiniRadar scores={sorted[0].r2.radar} size={200} color={ACCENT}/>
                  <div style={{position:"absolute",top:0,left:"50%",transform:"translateX(-50%)"}}>
                    <MiniRadar scores={sorted[sorted.length-1].r2.radar} size={200} color={DANGER}/>
                  </div>
                </div>
                <div style={{display:"flex",justifyContent:"center",gap:16,marginTop:8}}>
                  <span style={{fontSize:11,color:ACCENT}}>● {sorted[0].name}（冠军）</span>
                  <span style={{fontSize:11,color:DANGER}}>● {sorted[sorted.length-1].name}（末位）</span>
                </div>
              </div>

              <div style={card()}>
                <div style={{fontSize:13,fontWeight:700,color:TEXT1,marginBottom:4}}>WTPadj vs 实际定价</div>
                <div style={{fontSize:11,color:TEXT3,marginBottom:12}}>柱=Round 1 预测WTP，线=Round 2 实际定价</div>
                <div style={{display:"flex",flexDirection:"column",gap:6}}>
                  {TEAMS.map(t=>{
                    const maxW = Math.max(...TEAMS.map(x=>x.r1.wtpAdj));
                    const maxP = Math.max(...TEAMS.map(x=>x.r2.price));
                    const scale = Math.max(maxW, maxP);
                    return (
                      <div key={t.id} style={{display:"flex",alignItems:"center",gap:6}}>
                        <div style={{width:44,fontSize:10,color:TEXT2,textAlign:"right"}}>{t.name}</div>
                        <div style={{flex:1,position:"relative",height:16}}>
                          <div style={{position:"absolute",top:2,left:0,height:12,borderRadius:3,background:"rgba(99,102,241,0.2)",width:`${(t.r1.wtpAdj/scale)*100}%`}}/>
                          <div style={{position:"absolute",top:0,left:`${(t.r2.price/scale)*100}%`,width:2,height:16,background:ACCENT,borderRadius:1}}/>
                        </div>
                        <div style={{width:60,fontSize:9,color:TEXT3,textAlign:"right"}}>
                          ¥{(t.r2.price/1000).toFixed(1)}k / ¥{(t.r1.wtpAdj/1000).toFixed(1)}k
                        </div>
                      </div>
                    );
                  })}
                </div>
                <div style={{display:"flex",gap:12,marginTop:8}}>
                  <span style={{fontSize:10,color:TEXT3,display:"flex",alignItems:"center",gap:4}}>
                    <span style={{width:16,height:8,borderRadius:2,background:"rgba(99,102,241,0.3)"}}/> WTPadj
                  </span>
                  <span style={{fontSize:10,color:TEXT3,display:"flex",alignItems:"center",gap:4}}>
                    <span style={{width:2,height:12,background:ACCENT}}/> 实际定价
                  </span>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ═══ Debrief ═══ */}
        {tab==="debrief" && (
          <div>
            <div style={{display:"flex",gap:8,marginBottom:16}}>
              {[{r:1,l:"Round 1 讲解稿"},{r:2,l:"Round 2 讲解稿"}].map(x=>(
                <button key={x.r} onClick={()=>setDebriefRound(x.r)} style={{
                  padding:"8px 20px",borderRadius:8,border:"none",cursor:"pointer",
                  background:debriefRound===x.r?ACCENT:"rgba(255,255,255,0.05)",
                  color:debriefRound===x.r?"#000":TEXT3,fontSize:13,fontWeight:debriefRound===x.r?700:500,
                  transition:"all 0.15s"
                }}>{x.l}</button>
              ))}
            </div>
            <DebriefPanel round={debriefRound}/>
          </div>
        )}

        {/* ═══ Export ═══ */}
        {tab==="export" && (
          <div>
            <div style={{fontSize:14,fontWeight:700,color:TEXT1,marginBottom:16}}>数据导出</div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:16}}>
              {[
                { icon:"📊", title:"复盘 PPT", desc:"包含所有图表、排名、AI讲解稿，可直接投屏或分享", format:"PPTX", color:ACCENT },
                { icon:"📄", title:"数据报告 PDF", desc:"完整数据表格、每组决策明细、跨轮分析", format:"PDF", color:ACCENT2 },
                { icon:"📋", title:"原始数据", desc:"所有组的结构化决策数据，用于进一步分析", format:"CSV", color:WARN },
              ].map(x=>(
                <div key={x.format} style={card({display:"flex",flexDirection:"column",alignItems:"center",textAlign:"center",padding:28})}>
                  <div style={{fontSize:36,marginBottom:12}}>{x.icon}</div>
                  <div style={{fontSize:15,fontWeight:700,color:TEXT1,marginBottom:6}}>{x.title}</div>
                  <div style={{fontSize:12,color:TEXT3,lineHeight:1.6,marginBottom:16}}>{x.desc}</div>
                  <button style={{
                    padding:"10px 24px",borderRadius:10,border:"none",cursor:"pointer",
                    background:x.color,color:"#000",fontSize:13,fontWeight:700,
                    width:"100%",transition:"opacity 0.15s"
                  }}>
                    下载 .{x.format.toLowerCase()}
                  </button>
                </div>
              ))}
            </div>

            <div style={{...card({marginTop:16,display:"flex",gap:16,alignItems:"center"})}}>
              <div style={{fontSize:24}}>🔗</div>
              <div style={{flex:1}}>
                <div style={{fontSize:13,fontWeight:700,color:TEXT1}}>小组自查链接</div>
                <div style={{fontSize:12,color:TEXT3,marginTop:2}}>为每个小组生成独立的复盘页面链接，学生可以查看自己组的完整决策轨迹和结果</div>
              </div>
              <button style={{
                padding:"10px 20px",borderRadius:10,border:`1px solid ${CARD_BORDER}`,
                background:"transparent",color:TEXT2,fontSize:12,cursor:"pointer"
              }}>生成链接</button>
            </div>
          </div>
        )}
      </div>

      {/* Modal */}
      <TeamModal team={selectedTeam} onClose={()=>setSelectedTeam(null)}/>
    </div>
  );
}
