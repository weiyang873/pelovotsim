import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import {
  endRound2Interview,
  getRound2Recap,
  getRound2InterviewSession,
  getRound2State,
  getRound2TeamMerge,
  getRound2TeamResult,
  replyRound2Interview,
  saveRound2MemberSelection,
  saveRound2TeamDraft,
  startRound2Interview,
  submitRound2TeamDecision
} from "../api/round2Api";
import { clearStudentSession, mergeStudentSession, readStudentSession } from "../utils/studentSession";
import { downloadTxtFile, formatExportTime } from "../utils/txtExport";

// ── Constants ──
const DIMS = [
  { id:"interaction", l:"交互与表达", icon:"💬", c:"#D97706", desc:"语音对话、触摸互动、情感表达等能力" },
  { id:"perception", l:"感知与理解", icon:"👁", c:"#7C3AED", desc:"识别人脸、情绪、环境的感知能力" },
  { id:"motion", l:"运动与导航", icon:"🦿", c:"#0891B2", desc:"自主移动、跟随、避障的运动能力" },
  { id:"safety", l:"安全与信任", icon:"🛡", c:"#DC2626", desc:"隐私保护、儿童安全、数据合规" },
  { id:"extend", l:"可扩展与连接", icon:"🔌", c:"#059669", desc:"云端更新、IoT 联动、内容生态" },
  { id:"ops", l:"可运营与可维护", icon:"🔧", c:"#4F46E5", desc:"远程监控、故障诊断、日常维护" },
];
const DEFAULT_MEMBER_DIMS = ["interaction", "safety"];
const IMP = { interaction:"高", perception:"高", motion:"中", safety:"中", extend:"低", ops:"中" };
const IMP_C = { "高":"#DC2626", "中":"#D4A03C", "低":"#9CA3AF" };
const STARTER_QUESTIONS = {
  ELDER: [
    "{name}您好！能聊聊您平时一个人在家的时候，一般怎么度过一天吗？",
    "想了解一下，您跟子女或朋友平时联系多吗？一般怎么联系？",
    "您平时有没有什么事情，觉得要是有人搭把手就好了？"
  ],
  CHILD: [
    "{name}您好！能聊聊您家孩子平时放学回来一般做些什么吗？",
    "作为家长，您觉得带孩子最让您头疼的是什么时候？",
    "孩子平时自己玩的时候，您一般在做什么？会担心什么吗？"
  ],
  ADULT: [
    "{name}您好！能聊聊您平时下班回到家之后，一般怎么度过晚上的时间吗？",
    "您觉得现在的生活里，有什么事情让您觉得特别麻烦或者不太满意的吗？",
    "您平时会用什么智能设备吗？感觉怎么样？"
  ]
};
const STARTER_QUESTIONS_TOB = [
  "{name}您好！能聊聊您目前运营上最头疼的问题吗？",
  "{name}您好！您现在这类业务场景一般是怎么做的？过程中最容易卡在哪？",
  "您在这块有考虑过引入新的方案吗？通常会先看预算、审批流程，还是落地风险？"
];
const STARTER_QUESTIONS_TOC = [
  "{name}您好！能聊聊您平时下班回家之后一般怎么度过的吗？",
  "您觉得现在的生活里，有什么让您觉得特别麻烦或者不满意的吗？",
  "您平时会用什么智能设备吗？感觉怎么样？"
];
const INTERVIEW_DIMENSION_GUIDE = {
  perception: {
    label: "感知与理解",
    hint: "试着了解 TA 希望机器人能「看懂」或「听懂」什么：能认出人吗？能感受情绪吗？能理解说的话吗？"
  },
  motion: {
    label: "运动与导航",
    hint: "聊聊 TA 希望机器人怎么移动：跟着人走？自己找路？待在一个地方不动？会不会担心磕碰？"
  },
  interaction: {
    label: "交互与表达",
    hint: "试着了解 TA 希望怎么跟机器人沟通：说话？触摸？表情？声音？还是越安静越好？"
  },
  safety: {
    label: "安全与信任",
    hint: "聊聊 TA 的顾虑：隐私？数据安全？机器人会不会伤到人？坏了怎么办？能信任它吗？"
  },
  extend: {
    label: "可扩展与连接",
    hint: "了解 TA 对「连接」的期待：能连手机吗？能和家里其他设备配合吗？以后能加新功能吗？"
  },
  ops: {
    label: "可运营与可维护",
    hint: "聊聊日常使用的顾虑：充电麻烦吗？坏了谁修？需要经常更新吗？用着用着会不会淘汰？"
  }
};
const INTERVIEW_MIN_TURNS = 5;
const INTERVIEW_MAX_TURNS = 10;
const MIN_INTERVIEWS_REQUIRED = 2;
const MIN_TEAM_CARDS = 6;

function createEmptyInterviewProgress() {
  return {
    completedCount: 0,
    totalSessions: 0,
    minInterviewsRequired: MIN_INTERVIEWS_REQUIRED,
    maxInterviews: 3,
    canProceed: false,
    canStartAnother: false,
    reachedInterviewLimit: false,
    personaPool: [],
    nextPersona: null,
    activeSessionId: "",
    completedInterviews: [],
    latestCompletedInterview: null
  };
}

function buildInterviewMessageKey(message, fallbackIndex = 0) {
  const explicitId = String(message?.id || message?.messageId || "").trim();
  if (explicitId) return explicitId;
  const role = String(message?.role || "").trim() || "message";
  const speaker = String(message?.speaker || "").trim();
  const ts = String(message?.timestamp || message?.ts || "").trim();
  const text = String(message?.text || "").trim();
  return `${role}::${speaker}::${ts || fallbackIndex}::${text}`;
}

function toInterviewMessage(message, fallbackIndex = 0) {
  return {
    id: buildInterviewMessageKey(message, fallbackIndex),
    role: message?.role === "user" ? "user" : "assistant",
    speaker: message?.speaker || (message?.role === "user" ? "你" : "访谈对象"),
    text: String(message?.text || "").trim()
  };
}

const STEPS = ["第一轮回顾","用户访谈","个人选卡","团队合并","研发与定价","确认提交"];

const F_BASE_WAN = 500;
const F_BASE = F_BASE_WAN * 10000;
function deriveChannelFeeFromGrid(gridId) {
  const raw = String(gridId || "").trim().toLowerCase();
  return raw.startsWith("tob") || raw.startsWith("b2b") ? 0.15 : 0.25;
}

// ── Card data: hidden qualitative hints in individual mode, numeric reveal in team mode ──
const CC = {
interaction: [
  { id:"voice_basic", n:"语音基础", what:"能听懂指令并用语音回应", nreDesc:"嵌入式8月+语音算法6月+QA4月+SDK授权+消音室+样机",
    riskNote:"技术成熟度高，风险可控",
    tiers:{ low:{l:"基础",d:"固定指令，预设回复",cost:150,nre:59}, mid:{l:"标准",d:"日常对话，自然语调",cost:280,nre:98}, high:{l:"旗舰",d:"多方言+情感语调",cost:420,nre:157} } },
  { id:"persona_dialog", n:"多轮对话个性化", what:"记住上下文，越聊越懂你，像朋友一样对话", nreDesc:"NLP高级10月+嵌入式AI8月+后端6月+标注×2人6月+QA4月+GPU算力+训练数据+样机",
    riskNote:"依赖大模型能力，对话质量波动大",
    tiers:{ low:{l:"基础",d:"简单多轮，记住近期话题",cost:400,nre:127}, mid:{l:"标准",d:"个性化风格+长期记忆",cost:650,nre:211}, high:{l:"旗舰",d:"深度个性化，模拟角色性格",cost:950,nre:338} },
    deps:[{tier:"high",type:"需要",target:"cloud_update",tl:"标准",cross:true}] },
  { id:"touch_hug", n:"触摸/拥抱交互增强", what:"感知拥抱和抚摸，做出温暖回应", nreDesc:"硬件8月+嵌入式6月+结构4月+QA3月+柔性PCB打样+传感器样品+样机",
    riskNote:"传感器硬件成熟，集成风险低",
    tiers:{ low:{l:"基础",d:"基本触摸感应",cost:180,nre:59}, mid:{l:"标准",d:"多区域触感，不同反应",cost:350,nre:99}, high:{l:"旗舰",d:"全身压力感应+体温变化",cost:520,nre:158} } },
  { id:"music_companion", n:"音乐播放与陪伴", what:"会放音乐、哼唱或陪着孩子练习", nreDesc:"嵌入式6月+音频4月+QA2月+版权授权+音频测试+样机",
    riskNote:"版权与音频适配需要持续维护",
    tiers:{ low:{l:"基础",d:"固定歌单与简单播控",cost:100,nre:38}, mid:{l:"标准",d:"情境音乐与互动播放",cost:200,nre:64}, high:{l:"旗舰",d:"更丰富内容与情绪联动",cost:320,nre:102} } },
  { id:"visual_expr", n:"视觉表达（OLED/灯效）", what:"通过屏幕表情或灯光变化表达情绪", nreDesc:"显示驱动8月+嵌入式6月+结构6月+工业设计师6月+动画4月+QA4月+OLED样品+动画外包+显示模具+样机",
    riskNote:"显示模组和动画体验会明显拉高开发复杂度",
    tiers:{ low:{l:"基础",d:"灯效表达",cost:300,nre:115}, mid:{l:"标准",d:"OLED 丰富表情动画",cost:600,nre:191}, high:{l:"旗舰",d:"全彩表情+氛围灯联动",cost:850,nre:306} },
    conflicts:["no_screen"] },
  { id:"style_pack", n:"表达风格包", what:"让机器人在语气、角色和动作上更有个性", nreDesc:"工业设计师8月+结构6月+动作设计6月+QA3月+外壳开模30万+3D打样+样机",
    riskNote:"风格做得好很加分，但打磨周期长",
    tiers:{ low:{l:"基础",d:"少量角色与固定语气",cost:120,nre:91}, mid:{l:"标准",d:"多风格切换+动作脚本",cost:250,nre:151}, high:{l:"旗舰",d:"完整角色包+更强表现力",cost:400,nre:242} } },
  { id:"no_screen", n:"无屏降本（删OLED）", what:"去掉屏幕降成本，改用纯语音+灯光", nreDesc:"结构4月+嵌入式3月+QA回归4月+认证2月+结构件打样+重新认证费+回归测试",
    riskNote:"用户体验可能受限，需验证接受度", tag:"降本",
    tiers:{ low:{l:"基础",d:"去屏保留LED",cost:-250,nre:37}, mid:{l:"标准",d:"去屏+简化外壳",cost:-450,nre:61}, high:{l:"旗舰",d:"极简纯语音方案",cost:-600,nre:98} },
    conflicts:["visual_expr"] }
],
perception: [
  { id:"percep_base", n:"基础感知（摄像头/语音）", what:"看到和听到周围环境，识别人和物体", nreDesc:"视觉6月+嵌入式6月+QA3月+摄像头样品+ISP工具+标定设备+样机",
    riskNote:"硬件方案成熟，但需要稳定标定",
    tiers:{ low:{l:"基础",d:"单摄像头+单麦克风",cost:200,nre:46}, mid:{l:"标准",d:"广角+基础识别",cost:380,nre:76}, high:{l:"旗舰",d:"双目视觉+阵列麦克风",cost:550,nre:122} } },
  { id:"emotion_recog", n:"情绪识别与表情捕捉", what:"读懂表情和语气，判断开心还是难过", nreDesc:"CV高级10月+嵌入式AI8月+标注×2人6月+QA4月+GPU算力+表情数据集+AI芯片+样机",
    riskNote:"算法精度不稳定，场景与光线变化影响大",
    tiers:{ low:{l:"基础",d:"基础情绪分类",cost:350,nre:112}, mid:{l:"标准",d:"多模态融合识别",cost:600,nre:186}, high:{l:"旗舰",d:"细粒度识别+趋势追踪",cost:880,nre:298} },
    deps:[{tier:"low",type:"需要",target:"percep_base",tl:"基础"},{tier:"mid",type:"需要",target:"percep_base",tl:"标准"},{tier:"high",type:"需要",target:"percep_base",tl:"旗舰"}] },
  { id:"adaptive_learn", n:"自适应学习（习惯/偏好）", what:"越用越懂你——记住习惯、喜好、作息", nreDesc:"ML高级12月+嵌入式AI8月+数据工程6月+QA6月+GPU算力12月+边缘模组+用户测试+样机",
    riskNote:"冷启动体验弱，需要长期数据积累",
    tiers:{ low:{l:"基础",d:"记住常用设置",cost:350,nre:118}, mid:{l:"标准",d:"学习日常规律",cost:620,nre:197}, high:{l:"旗舰",d:"跨场景预测需求",cost:900,nre:315} },
    deps:[{tier:"mid",type:"需要",target:"cloud_update",tl:"标准",cross:true},{tier:"high",type:"需要",target:"cloud_update",tl:"旗舰",cross:true}] },
  { id:"memory_social", n:"社交记忆", what:"记住家庭成员、关系和偏好，互动更像熟人", nreDesc:"后端8月+安全高级6月+QA4月+隐私审查律所+渗透测试+加密芯片+样机",
    riskNote:"涉及隐私和记忆边界，信任设计很关键",
    tiers:{ low:{l:"基础",d:"记住称呼与基本偏好",cost:250,nre:63}, mid:{l:"标准",d:"记住家庭关系和互动习惯",cost:450,nre:105}, high:{l:"旗舰",d:"跨场景长期记忆",cost:680,nre:168} },
    deps:[{tier:"high",type:"需要",target:"privacy_trust",tl:"标准",cross:true}] }
],
motion: [
  { id:"basic_avoid", n:"基础避障", what:"遇到障碍物会停下或绕开", nreDesc:"嵌入式6月+算法3月+QA3月+超声波模组+测试场地+样机",
    riskNote:"基础方案成熟，但复杂家庭环境仍需测试",
    tiers:{ low:{l:"基础",d:"简单碰撞保护",cost:150,nre:33}, mid:{l:"标准",d:"提前减速绕开",cost:300,nre:55}, high:{l:"旗舰",d:"更平滑避障策略",cost:450,nre:88} } },
  { id:"auto_follow", n:"跟随/伴行模式", what:"像小宠物一样跟着你在家走", nreDesc:"电机控制8月+算法8月+硬件4月+QA6月+伺服电机样品+路测+开发板+样机",
    riskNote:"跟随稳定性和安全边界都不好做",
    tiers:{ low:{l:"基础",d:"简单跟随",cost:320,nre:73}, mid:{l:"标准",d:"视觉跟随伴行",cost:550,nre:122}, high:{l:"旗舰",d:"预测路径伴行",cost:800,nre:195} } },
  { id:"lidar_nav", n:"激光雷达导航", what:"自主在家走动，记住房间布局", nreDesc:"SLAM高级10月+嵌入式8月+电机控制4月+QA8月+LiDAR多款评估+SLAM平台+大量路测+地图设备+样机",
    riskNote:"LiDAR 硬件和 SLAM 调参都很重，投入高",
    tiers:{ low:{l:"基础",d:"简单建图导航",cost:500,nre:110}, mid:{l:"标准",d:"精准房间级导航",cost:850,nre:184}, high:{l:"旗舰",d:"复杂户型与更强鲁棒性",cost:1200,nre:294} },
    deps:[{tier:"mid",type:"需要",target:"cloud_update",tl:"标准",cross:true},{tier:"high",type:"需要",target:"cloud_update",tl:"标准",cross:true}] }
],
safety: [
  { id:"privacy_trust", n:"隐私与信任保障", what:"数据加密，用户可控制自己的数据", nreDesc:"安全高级8月+嵌入式4月+认证4月+渗透测试+安全认证+SE芯片+样机",
    riskNote:"合规要求明确，但不能只做表面开关",
    tiers:{ low:{l:"基础",d:"本地加密存储",cost:180,nre:64}, mid:{l:"标准",d:"端到端加密+权限面板",cost:350,nre:107}, high:{l:"旗舰",d:"更严格可信架构",cost:520,nre:171} } },
  { id:"child_safety", n:"儿童安全", what:"更关注碰撞、防夹、材料与儿童使用风险", nreDesc:"硬件6月+结构4月+QA专项6月+认证6月+GB认证15万+跌落测试+材料检测+样机",
    riskNote:"认证和可靠性测试周期长",
    tiers:{ low:{l:"基础",d:"基础儿童防护",cost:250,nre:68}, mid:{l:"标准",d:"更完整的儿童安全设计",cost:450,nre:113}, high:{l:"旗舰",d:"强化防护与更高认证标准",cost:650,nre:181} } },
  { id:"family_guardian", n:"家庭监护", what:"家长远程查看孩子/老人状态，设置使用边界", nreDesc:"架构师8月+硬件8月+嵌入式6月+后端4月+QA8月+紧急通信认证+可靠性测试+融合套件+样机",
    riskNote:"隐私与监护的平衡很难，过度监控会惹人反感",
    tiers:{ low:{l:"基础",d:"基础远程提醒与边界",cost:420,nre:121}, mid:{l:"标准",d:"远程查看+行为边界",cost:750,nre:201}, high:{l:"旗舰",d:"多角色权限+异常报警",cost:1050,nre:322} },
    deps:[{tier:"low",type:"需要",target:"privacy_trust",tl:"基础",cross:true},{tier:"mid",type:"需要",target:"privacy_trust",tl:"标准",cross:true},{tier:"high",type:"需要",target:"privacy_trust",tl:"旗舰",cross:true}] }
],
extend: [
  { id:"cloud_update", n:"云端智能更新（OTA）", what:"自动接收新功能和修复", nreDesc:"后端6月+嵌入式6月+安全3月+QA4月+云服务器+灰度平台+安全芯片+样机",
    riskNote:"灰度和回滚机制能明显降低线上事故",
    tiers:{ low:{l:"基础",d:"手动更新",cost:150,nre:56}, mid:{l:"标准",d:"自动静默+回滚",cost:300,nre:94}, high:{l:"旗舰",d:"灰度发布+更强遥测",cost:480,nre:150} } },
  { id:"api_iot", n:"API / IoT 联动", what:"连接手机和家里其他设备，做更多场景联动", nreDesc:"IoT8月+后端6月+硬件RF4月+认证4月+协议认证18万+天线外包+网关开发板+样机",
    riskNote:"协议兼容和认证测试工作量大",
    tiers:{ low:{l:"基础",d:"少量设备接入",cost:250,nre:68}, mid:{l:"标准",d:"主流平台兼容",cost:450,nre:114}, high:{l:"旗舰",d:"开放 API + 深度联动",cost:680,nre:182} },
    deps:[{tier:"high",type:"需要",target:"privacy_trust",tl:"标准",cross:true}] },
  { id:"edu_content", n:"教育内容", what:"提供更丰富的学习内容、课程和陪练素材", nreDesc:"前端6月+后端6月+内容运营8月+QA3月+内容授权12万+CMS平台+合规审查+用户测试",
    riskNote:"内容持续供给和版权都需要长期投入",
    tiers:{ low:{l:"基础",d:"少量固定内容",cost:200,nre:61}, mid:{l:"标准",d:"更系统的内容库",cost:380,nre:102}, high:{l:"旗舰",d:"可持续运营的内容平台",cost:580,nre:163} } }
],
ops: [
  { id:"self_diag", n:"自诊断", what:"机器人能自己发现故障并提示处理", nreDesc:"嵌入式6月+QA4月+诊断传感器+故障注入设备+样机",
    riskNote:"投入不大，但对长期可维护性很重要",
    tiers:{ low:{l:"基础",d:"基础错误自检",cost:130,nre:25}, mid:{l:"标准",d:"更系统的故障定位",cost:260,nre:42}, high:{l:"旗舰",d:"硬件+软件联合诊断",cost:400,nre:67} } },
  { id:"remote_monitor", n:"远程监控", what:"远程查看设备状态、异常和运行日志", nreDesc:"后端8月+嵌入式4月+QA3月+认证2月+云平台+通信认证+样机",
    riskNote:"云端监控能省售后，但也要做好权限边界",
    tiers:{ low:{l:"基础",d:"基础状态上报",cost:200,nre:47}, mid:{l:"标准",d:"实时监控+日志分析",cost:380,nre:78}, high:{l:"旗舰",d:"更强告警与远程处置",cost:580,nre:125} } },
  { id:"predictive_maint", n:"预测性维护", what:"在坏掉前就预警，减少突然故障", nreDesc:"ML高级10月+嵌入式6月+数据工程6月+QA6月+GPU算力+长期测试15万+传感器+样机",
    riskNote:"需要长期数据和更多传感器支持，开发周期长",
    tiers:{ low:{l:"基础",d:"简单预警规则",cost:350,nre:103}, mid:{l:"标准",d:"基于数据的预警模型",cost:650,nre:172}, high:{l:"旗舰",d:"更完整的预测维护体系",cost:950,nre:275} } }
]
};
const ALL = Object.values(CC).flat();
const fc = id => ALL.find(c => c.id === id);
const TI = {low:0,mid:1,high:2};
const TS = ["low","mid","high"];

const calcCost = (s) => {
  let cost = 0;
  let nreWan = 0;
  let cnt = 0;
  Object.entries(s).forEach(([id, t]) => {
    const c = fc(id);
    const tier = c?.tiers?.[t];
    if (c && tier) {
      cost += Number(tier.cost || 0);
      nreWan += Number(tier.nre || 0);
      cnt += 1;
    }
  });
  return { cost, nreWan, cnt };
};

// Real parameters from framework doc §12.2, §11.3, §16.1
const V = 2000;         // variable cost per unit
const F_PRICE = 14000;  // demo reference price (ToB_DIFF_ELDER typical)
// GM = (P×(1-f) - V - dCOGS) / P
const calcGM = (dCOGS, price, f, baseCost = V) => {
  const netRev = price * (1 - f);
  return ((netRev - baseCost - dCOGS) / price) * 100;
};
const GM_FLOOR = 20; // below this = danger zone
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const FRONT_TO_BACK_ID = {
  visual_expr: "visual_expression",
  style_pack: "expressive_style_pack",
  no_screen: "no_screen_costdown",
  percep_base: "perception_base",
  emotion_recog: "emotion_recognition",
  adaptive_learn: "adaptive_learning",
  memory_social: "memory_album",
  basic_avoid: "basic_avoidance",
  auto_follow: "follow_mode",
  remote_monitor: "remote_monitor",
  child_safety: "child_safety"
};
const BACK_TO_FRONT_ID = Object.fromEntries(
  Object.entries(FRONT_TO_BACK_ID).map(([frontId, backId]) => [backId, frontId])
);
BACK_TO_FRONT_ID.home_iot = "api_iot";
BACK_TO_FRONT_ID.kids_mode = "child_safety";
BACK_TO_FRONT_ID.remote_diagnostics = "remote_monitor";

function getDcogsLabel(dcogsValue) {
  const value = Number(dcogsValue || 0);
  const abs = Math.abs(value);
  if (value < 0) return "降本";
  if (abs < 300) return "轻";
  if (abs < 500) return "中";
  if (abs < 750) return "较重";
  return "重";
}

function getNreLabel(nreWan) {
  const value = Number(nreWan || 0);
  if (value < 60) return "轻";
  if (value < 120) return "中";
  if (value < 180) return "较重";
  return "重";
}

function getHintTone(label) {
  if (label === "降本" || label === "轻") return { bg: "#ecfdf5", fg: "#166534", border: "#bbf7d0" };
  if (label === "中") return { bg: "#fffbeb", fg: "#92400e", border: "#fde68a" };
  if (label === "较重") return { bg: "#fff7ed", fg: "#c2410c", border: "#fdba74" };
  return { bg: "#fef2f2", fg: "#b91c1c", border: "#fecaca" };
}

function formatSignedCurrency(value) {
  const num = Number(value || 0);
  return `${num > 0 ? "+" : ""}¥${num.toLocaleString()}`;
}

function readTeamContextFromUrl() {
  if (typeof window === "undefined") {
    return { teamId: "", memberId: "", sessionId: "default" };
  }
  const url = new URL(window.location.href);
  const stored = readStudentSession();
  return {
    teamId: url.searchParams.get("teamId") || stored?.teamId || "",
    memberId: url.searchParams.get("memberId") || stored?.memberId || "",
    sessionId: url.searchParams.get("session_id") || url.searchParams.get("sessionId") || "default"
  };
}

function leaderDisplayName(name) {
  return String(name || "").trim() || "组长";
}

function formatStudentGroupName(groupLabel, teamName) {
  const team = String(teamName || "").trim();
  if (team) return team;
  const raw = String(groupLabel || "").trim();
  if (!raw) return "未分组";
  if (raw.startsWith("第") || raw.endsWith("组")) return raw;
  return `第${raw}组`;
}

function round2LeaderErrorMessage(err) {
  if (err?.code === "only_leader") {
    return `当前只有组长 ${leaderDisplayName(err?.leaderName)} 可以操作。`;
  }
  return err?.message || "操作失败";
}

function mapTeamStatusToStep(teamStatus) {
  if (teamStatus === "R2_INTERVIEWING") return 1;
  if (teamStatus === "R2_INDIVIDUAL_CARDS") return 2;
  if (teamStatus === "R2_TEAM_MERGE") return 3;
  if (teamStatus === "R2_TEAM_DISCUSSION") return 4;
  if (teamStatus === "R2_SUBMITTED") return 5;
  return 0;
}

function teamStatusNotice(teamStatus) {
  if (teamStatus === "R2_INTERVIEWING") return "系统已同步到用户访谈阶段";
  if (teamStatus === "R2_INDIVIDUAL_CARDS") return "系统已同步到个人选卡阶段";
  if (teamStatus === "R2_TEAM_MERGE") return "系统已推进到团队合并阶段";
  if (teamStatus === "R2_TEAM_DISCUSSION") return "系统已推进到团队讨论阶段";
  if (teamStatus === "R2_SUBMITTED") return "系统已同步到提交完成状态";
  return "系统已同步到最新阶段";
}

function teamStatusLabel(teamStatus) {
  if (teamStatus === "R2_INTERVIEWING") return "访谈阶段";
  if (teamStatus === "R2_INDIVIDUAL_CARDS") return "个人选卡阶段";
  if (teamStatus === "R2_TEAM_MERGE") return "团队合并阶段";
  if (teamStatus === "R2_TEAM_DISCUSSION") return "定价讨论阶段";
  if (teamStatus === "R2_SUBMITTED") return "提交完成阶段";
  return "当前阶段";
}

function selectionsToMap(selections) {
  return (Array.isArray(selections) ? selections : []).reduce((acc, item) => {
    const rawId = String(item?.cap_id || item?.id || "").trim();
    const id = BACK_TO_FRONT_ID[rawId] || rawId;
    const tier = String(item?.tier || "mid").trim().toLowerCase();
    if (id && TS.includes(tier)) {
      acc[id] = tier;
    }
    return acc;
  }, {});
}

function toSubmitSelectionsMap(sels) {
  return Object.entries(sels || {}).reduce((acc, [frontId, tier]) => {
    const backId = FRONT_TO_BACK_ID[frontId] || frontId;
    acc[backId] = tier;
    return acc;
  }, {});
}

function buildRadarFromSelections(sels) {
  return DIMS.reduce((acc, dim) => {
    const cards = CC[dim.id] || [];
    const total = cards.reduce((sum, card) => {
      const tier = sels[card.id];
      return tier ? sum + TI[tier] + 1 : sum;
    }, 0);
    acc[dim.id] = Number(clamp(4 + total, 1, 9).toFixed(1));
    return acc;
  }, {});
}

function radarToInterviewScores(radar) {
  const src = radar && typeof radar === "object" ? radar : {};
  return {
    interaction: Number(src.interaction || 0),
    perception: Number(src.perception || 0),
    motion: Number(src.motion != null ? src.motion : src.mobility || 0),
    safety: Number(src.safety != null ? src.safety : src.safety_privacy || 0),
    extend: Number(src.extend != null ? src.extend : src.integration || 0),
    ops: Number(src.ops != null ? src.ops : src.operations || 0)
  };
}

function scoreToImportance(score) {
  const n = Number(score || 0);
  if (n >= 7) return "高";
  if (n >= 5) return "中";
  return "低";
}

function selectionsMapToArray(sels) {
  return Object.entries(sels || {}).map(([frontId, tier]) => ({
    cap_id: FRONT_TO_BACK_ID[frontId] || frontId,
    tier: String(tier || "mid").trim().toLowerCase()
  }));
}

function buildInterviewSummary(result, memberDims) {
  if (!result) return "";
  const explicitSummary = String(result.summary || "").trim();
  if (explicitSummary) return explicitSummary;
  const scores = radarToInterviewScores(result.radar);
  const topDims = (Array.isArray(memberDims) ? memberDims : [])
    .map((dimId) => ({
      dimId,
      dim: DIMS.find((item) => item.id === dimId),
      score: Number(scores[dimId] || 0)
    }))
    .filter((item) => item.dim)
    .sort((a, b) => b.score - a.score);
  const tagText = (Array.isArray(result.tags) ? result.tags : [])
    .map((item) => String(item?.tag || "").trim())
    .filter(Boolean)
    .slice(0, 4)
    .join("、");
  if (!topDims.length && !tagText) return "";
  const dimText = topDims
    .slice(0, 2)
    .map((item) => `${item.dim.l}（${scoreToImportance(item.score)}）`)
    .join("、");
  if (dimText && tagText) return `访谈显示用户最关注 ${dimText}，关键词包括 ${tagText}。`;
  return dimText || tagText;
}

function formatGridLabel(gridId) {
  const raw = String(gridId || "").trim();
  if (!raw) return "未确认";
  const parts = raw.split("_");
  const channelMap = { TOB: "企业 (ToB)", B2B: "企业 (ToB)", TOC: "消费者 (ToC)", B2C: "消费者 (ToC)" };
  const strategyMap = { DIFFERENTIATION: "差异化", DIFF: "差异化", COST: "成本领先" };
  const focusMap = { ELDER: "老人", ADULT: "成人", CHILD: "儿童", EXPERIENCE: "体验", HYBRID: "混合", MIXED: "混合", FUNCTION: "功能" };
  return [
    channelMap[String(parts[0] || "").toUpperCase()] || parts[0] || "",
    strategyMap[String(parts[1] || "").toUpperCase()] || parts[1] || "",
    focusMap[String(parts[2] || "").toUpperCase()] || parts[2] || ""
  ].filter(Boolean).join(" · ");
}

function getHHILabel(hhi) {
  const value = Number(hhi);
  if (!Number.isFinite(value)) return "";
  if (value >= 0.25) return "偏高";
  if (value >= 0.18) return "适中偏高";
  if (value >= 0.13) return "适中";
  if (value >= 0.10) return "适中偏低";
  if (value >= 0.08) return "分散";
  return "高度分散";
}

function formatArchitectureLabel(arch) {
  const raw = String(arch || "").trim().toLowerCase();
  if (raw === "experience") return "体验型";
  if (raw === "hybrid") return "混合型";
  if (raw === "function") return "功能型";
  return "体验型";
}

function summarizeVpText(text) {
  return String(text || "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 3)
    .join("；");
}

function parseVpSummaryText(text) {
  const src = String(text || "");
  const pick = (label) => {
    const m = src.match(new RegExp(`${label}\\s*[：:]\\s*([^\\n]+)`));
    return m ? m[1].trim() : "";
  };
  return {
    who: pick("WHO"),
    pain: pick("PAIN"),
    how: pick("HOW"),
    boundary: pick("BOUNDARY")
  };
}

function normalizeVpSummaryData(summary, fallbackText = "") {
  if (summary && typeof summary === "object") {
    return {
      who: String(summary.who || "").trim(),
      pain: String(summary.pain || "").trim(),
      how: String(summary.how || "").trim(),
      boundary: String(summary.boundary || "").trim()
    };
  }
  return parseVpSummaryText(fallbackText);
}

function buildVpRecapSentence(summary, fallbackText) {
  const src = summary && typeof summary === "object" ? summary : {};
  const who = String(src.who || "").trim();
  const pain = String(src.pain || "").trim();
  const how = String(src.how || "").trim();
  const boundary = String(src.boundary || "").trim();

  if (who && pain && how) {
    let sentence = `为${who}，在${pain}的场景下，LOVOT通过${how}创造更好的结果。`;
    if (boundary && boundary !== "未明确") {
      sentence += ` 适用边界：${boundary}。`;
    }
    return sentence;
  }

  const raw = String(fallbackText || "").trim();
  if (!raw) return "未生成最终价值主张。";
  return raw.replace(/\s+/g, " ").trim();
}

function normalizeScoreValue(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(5, Math.round(n * 10) / 10));
}

function formatSignedPercent(value) {
  const n = Number(value || 0);
  return n >= 0 ? `+${n}%` : `${n}%`;
}

function Round1StarRating({ score }) {
  const normalized = normalizeScoreValue(score);
  const fullStars = Math.max(0, Math.min(5, Math.round(normalized)));
  return (
    <div style={{ display: "flex", justifyContent: "center", gap: 4 }}>
      {[0, 1, 2, 3, 4].map((index) => (
        <span
          key={index}
          style={{
            fontSize: 28,
            lineHeight: 1,
            color: index < fullStars ? "#f59e0b" : "#d1d5db"
          }}
        >
          ★
        </span>
      ))}
    </div>
  );
}

function buildPersonaIntro(persona) {
  const name = String(persona?.name || "访谈对象").trim();
  const age = Number(persona?.age || 0);
  const title = String(persona?.title || persona?.occupation || "").trim();
  const orgType = String(persona?.org_type || "").trim();
  const orgScale = String(persona?.org_scale || "").trim();
  const living = String(persona?.living_situation || "").trim();
  const trigger = String(persona?.trigger || "").trim();
  const desc = String(persona?.desc || "").trim();
  const isToBPersona = Boolean(title && (orgType || orgScale));

  let basics = "";
  if (age > 0 && title) basics = `${age}岁，${title}。`;
  else if (age > 0) basics = `${age}岁。`;
  else if (title) basics = `${title}。`;
  else if (desc) basics = `${desc}。`;

  let livingText = "";
  if (isToBPersona) {
    livingText = [orgType, orgScale].filter(Boolean).join("，");
    if (trigger) {
      livingText = `${livingText ? `${livingText}。` : ""}最近触发事件：${trigger}。`;
    } else if (livingText) {
      livingText = `${livingText}。`;
    }
  } else {
    livingText = living ? `${living}。` : "";
  }
  if (!livingText && desc && desc !== title) {
    livingText = `${desc}。`;
  }

  return {
    name,
    basics,
    living: livingText
  };
}

function getGridAgeGroup(gridId, personaAge) {
  const raw = String(gridId || "").toUpperCase();
  if (raw.includes("ELDER")) return "ELDER";
  if (raw.includes("CHILD")) return "CHILD";
  if (raw.includes("ADULT")) return "ADULT";
  return Number(personaAge || 0) >= 60 ? "ELDER" : "ADULT";
}

function buildStarterGridLabel(gridId) {
  const raw = String(gridId || "").trim().toUpperCase();
  if (raw.startsWith("TOB") || raw.startsWith("B2B")) return "ToB";
  if (raw.startsWith("TOC") || raw.startsWith("B2C")) return "ToC";
  return "";
}

function buildStarterQuestions({ persona, gridLabel }) {
  const name = String(persona?.name || "您好").trim();
  if (String(gridLabel || "").startsWith("ToB")) {
    return STARTER_QUESTIONS_TOB
      .map((question) => question.replace("{name}", name))
      .slice(0, 3);
  }
  return STARTER_QUESTIONS_TOC
    .map((question) => question.replace("{name}", name))
    .slice(0, 3);
}

function buildInterviewTransition(progress, completedInterview, endedByLimit = false) {
  const completedCount = Number(progress?.completedCount || 0);
  const minRequired = Number(progress?.minInterviewsRequired || MIN_INTERVIEWS_REQUIRED);
  if (!completedInterview) return null;
  if (completedCount >= Number(progress?.maxInterviews || 3)) {
    return {
      type: "forced_next",
      completedInterview,
      endedByLimit
    };
  }
  if (completedCount < minRequired) {
    return {
      type: "required_next",
      completedInterview,
      nextPersona: progress?.nextPersona || null,
      endedByLimit
    };
  }
  return {
    type: "choice_optional",
    completedInterview,
    nextPersona: progress?.nextPersona || null,
    endedByLimit
  };
}

function buildDimensionGuideItems(memberDims) {
  return (Array.isArray(memberDims) ? memberDims : [])
    .map((dimId) => {
      const guide = INTERVIEW_DIMENSION_GUIDE[dimId];
      if (!guide) return null;
      return {
        id: dimId,
        label: guide.label,
        hint: guide.hint
      };
    })
    .filter(Boolean);
}

function formatInterviewExportMessage(message, fallbackSpeaker = "访谈对象") {
  const role = message?.role === "user" ? "你" : (message?.speaker || fallbackSpeaker);
  return {
    speaker: role,
    text: String(message?.text || "").trim(),
    time: formatExportTime(message?.ts || message?.time || message?.createdAt || "")
  };
}

// ── Main App ──
export default function App() {
  const [step, setStep] = useState(0);
  const [sel, setSel] = useState({});
  const [teamPrice, setTeamPrice] = useState(12000);
  const [submitted, setSubmitted] = useState(false);
  const [teamId, setTeamId] = useState("");
  const [memberId, setMemberId] = useState("");
  const [sessionId, setSessionId] = useState("default");
  const [teamInfo, setTeamInfo] = useState(null);
  const [teamRecap, setTeamRecap] = useState(null);
  const [serverSelections, setServerSelections] = useState(null);
  const [isLoadingContext, setIsLoadingContext] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [submitError, setSubmitError] = useState("");
  const [isSubmittingFinal, setIsSubmittingFinal] = useState(false);
  const [teamStatus, setTeamStatus] = useState("");
  const [memberState, setMemberState] = useState(null);
  const [leaderMemberId, setLeaderMemberId] = useState("");
  const [leaderName, setLeaderName] = useState("");
  const [isLeader, setIsLeader] = useState(false);
  const [systemNotice, setSystemNotice] = useState("");
  const [interviewSessionId, setInterviewSessionId] = useState("");
  const [interviewPersonas, setInterviewPersonas] = useState([]);
  const [interviewMessages, setInterviewMessages] = useState([]);
  const [interviewInput, setInterviewInput] = useState("");
  const [interviewRound, setInterviewRound] = useState(0);
  const [interviewResult, setInterviewResult] = useState(null);
  const [interviewProgress, setInterviewProgress] = useState(createEmptyInterviewProgress());
  const [interviewTransition, setInterviewTransition] = useState(null);
  const [interviewCanEnd, setInterviewCanEnd] = useState(false);
  const [interviewDimensionOpenId, setInterviewDimensionOpenId] = useState(DEFAULT_MEMBER_DIMS[0]);
  const [interviewError, setInterviewError] = useState("");
  const [interviewRestoreChecked, setInterviewRestoreChecked] = useState(false);
  const [isStartingInterview, setIsStartingInterview] = useState(false);
  const [isSendingInterview, setIsSendingInterview] = useState(false);
  const [isSubmittingIndividual, setIsSubmittingIndividual] = useState(false);
  const [individualSubmitError, setIndividualSubmitError] = useState("");
  const [mergeData, setMergeData] = useState(null);
  const [mergeError, setMergeError] = useState("");
  const [teamDraftSelections, setTeamDraftSelections] = useState({});
  const [teamResultSnapshot, setTeamResultSnapshot] = useState(null);
  const interviewInputRef = useRef(null);
  const round2DraftTouchedRef = useRef(false);
  const previousStatusRef = useRef("");
  const previousStepRef = useRef(0);
  const systemNoticeTimerRef = useRef(null);

  const isTeamMode = Boolean(teamId);

  useEffect(() => {
    const ctx = readTeamContextFromUrl();
    if (!ctx.teamId) return;

    let canceled = false;
    const controller = new AbortController();
    setTeamId(ctx.teamId);
    setMemberId(ctx.memberId);
    setSessionId(ctx.sessionId);
    mergeStudentSession({
      teamId: ctx.teamId,
      memberId: ctx.memberId,
      entryMode: readStudentSession()?.entryMode || "classroom"
    });
    setIsLoadingContext(true);
    setLoadError("");

    Promise.all([
      fetch(`/api/team/${encodeURIComponent(ctx.teamId)}`, { signal: controller.signal }).then((res) => res.json()),
      getRound2Recap(ctx.teamId, { signal: controller.signal }),
      getRound2State(ctx.teamId, ctx.memberId, { signal: controller.signal }).catch(() => null),
      getRound2TeamResult(ctx.teamId, ctx.sessionId, { signal: controller.signal }).catch(() => ({ submission: null, radar: null, result: null }))
    ])
      .then(([teamRes, recapRes, stateRes, snapshotRes]) => {
        if (canceled) return;
        if (!teamRes?.ok || !teamRes?.team) {
          throw new Error(teamRes?.error || "团队信息读取失败");
        }

        setTeamInfo(teamRes.team);
        setTeamRecap(recapRes || null);
        setMemberState(stateRes?.member || null);
        setTeamStatus(String(stateRes?.team_status || ""));
        setLeaderMemberId(String(stateRes?.leader_member_id || ""));
        setLeaderName(String(stateRes?.leader_name || ""));
        setIsLeader(Boolean(stateRes?.is_leader));
        if (stateRes?.team_draft && !snapshotRes?.submission) {
          const mappedDraft = selectionsToMap(stateRes.team_draft.selections);
          setTeamDraftSelections(mappedDraft);
          if (Number.isFinite(Number(stateRes.team_draft.price))) {
            setTeamPrice(Number(stateRes.team_draft.price));
          }
        }

        if (snapshotRes?.submission) {
          const mappedSelections = selectionsToMap(snapshotRes.submission.selections);
          setServerSelections(mappedSelections);
          setTeamDraftSelections(mappedSelections);
          setTeamResultSnapshot(snapshotRes.result || null);
          if (Number.isFinite(Number(snapshotRes.submission.price))) {
            setTeamPrice(Number(snapshotRes.submission.price));
          }
          setStep(5);
          setSubmitted(true);
        } else if (Number.isFinite(Number(recapRes?.P))) {
          setTeamPrice(Number(recapRes.P));
        }
        if (stateRes?.team_status && !snapshotRes?.submission) {
          setStep((prev) => Math.max(prev, mapTeamStatusToStep(stateRes.team_status)));
        }
      })
      .catch((err) => {
        if (err?.name === "AbortError") return;
        if (!canceled) {
          setLoadError(err.message || "Round 2 上下文加载失败");
        }
      })
      .finally(() => {
        if (!canceled) setIsLoadingContext(false);
      });

    return () => {
      canceled = true;
      controller.abort();
    };
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    url.searchParams.delete("teamId");
    url.searchParams.delete("memberId");
    url.searchParams.delete("session_id");
    url.searchParams.delete("sessionId");
    window.history.replaceState({}, "", url.toString());
  }, []);

  useEffect(() => {
    if (!teamId || !memberId) return;
    mergeStudentSession({
      teamId,
      memberId,
      entryMode: readStudentSession()?.entryMode || "classroom"
    });
  }, [memberId, teamId]);

  useEffect(() => {
    if (!teamId) return undefined;

    let canceled = false;
    let currentController = null;
    const tick = async () => {
      try {
        currentController?.abort();
        currentController = new AbortController();
        const data = await getRound2State(teamId, memberId, { signal: currentController.signal });
        if (canceled) return;

        const nextStatus = String(data?.team_status || "");
        setMemberState(data?.member || null);
        setLeaderMemberId(String(data?.leader_member_id || ""));
        setLeaderName(String(data?.leader_name || ""));
        setIsLeader(Boolean(data?.is_leader));
        if (data?.team_draft && !submitted) {
          const mappedDraft = selectionsToMap(data.team_draft.selections);
          if (!round2DraftTouchedRef.current || !data?.is_leader) {
            setTeamDraftSelections(mappedDraft);
            if (Number.isFinite(Number(data.team_draft.price))) {
              setTeamPrice(Number(data.team_draft.price));
            }
          }
        }
        if (!nextStatus) return;

        setTeamStatus(nextStatus);
        const nextStep = mapTeamStatusToStep(nextStatus);
        const prevStatus = previousStatusRef.current;
        const prevStep = previousStepRef.current;

        setSubmitted(nextStatus === "R2_SUBMITTED");
        if (nextStatus !== "R2_SUBMITTED") {
          setTeamResultSnapshot(null);
          setServerSelections(null);
        }

        setStep((prev) => {
          if (nextStatus === "R2_SUBMITTED") return 5;
          if (nextStep > 0 && nextStep < prev) return prev;
          return Math.max(prev, nextStep);
        });

        if (prevStatus && prevStatus !== nextStatus) {
          if (systemNoticeTimerRef.current) {
            window.clearTimeout(systemNoticeTimerRef.current);
          }
          if (nextStep > 0 && nextStep < prevStep) {
            setSel({});
            setTeamDraftSelections({});
            setMergeData(null);
            round2DraftTouchedRef.current = false;
            setSystemNotice(`系统已重置你的进度到${teamStatusLabel(nextStatus)}，请重新操作`);
          } else {
            setSystemNotice(teamStatusNotice(nextStatus));
          }
          systemNoticeTimerRef.current = window.setTimeout(() => {
            setSystemNotice("");
            systemNoticeTimerRef.current = null;
          }, 3000);
        }
        previousStatusRef.current = nextStatus;
        previousStepRef.current = nextStep;
      } catch (error) {
        if (error?.name === "AbortError") return;
      }
    };

    tick();
    const timer = setInterval(tick, 3000);
    return () => {
      canceled = true;
      currentController?.abort();
      if (systemNoticeTimerRef.current) {
        window.clearTimeout(systemNoticeTimerRef.current);
        systemNoticeTimerRef.current = null;
      }
      clearInterval(timer);
    };
  }, [teamId, memberId]);

  const toggleSelection = useCallback((id, mode = "individual") => {
    if (mode === "team") {
      round2DraftTouchedRef.current = true;
    }
    const setter = mode === "team" ? setTeamDraftSelections : setSel;
    setter((prev) => {
      const next = { ...prev };
      if (next[id]) delete next[id];
      else next[id] = "mid";
      return next;
    });
  }, []);
  const setSelectionTier = useCallback((id, t, mode = "individual") => {
    if (mode === "team") {
      round2DraftTouchedRef.current = true;
    }
    const setter = mode === "team" ? setTeamDraftSelections : setSel;
    setter((prev) => ({ ...prev, [id]: t }));
  }, []);

  const teamSel = useMemo(() => {
    if (serverSelections) return serverSelections;
    if (Object.keys(teamDraftSelections || {}).length) return teamDraftSelections;
    return sel;
  }, [serverSelections, teamDraftSelections, sel]);

const indCalc = useMemo(() => calcCost(sel), [sel]);
  const teamCalc = useMemo(() => calcCost(teamSel), [teamSel]);
  const baseCost = Number(teamRecap?.COGSbase || V);
  const channelFee = Number(
    teamRecap?.f != null
      ? teamRecap.f
      : deriveChannelFeeFromGrid(teamInfo?.final_grid_id || teamRecap?.final_grid_id || "")
  );
  const teamUnitCost = baseCost + teamCalc.cost;
  const teamFixedCost = F_BASE + teamCalc.nreWan * 10000;
  const teamFixedCostWan = F_BASE_WAN + teamCalc.nreWan;
  const previewUnitMargin = Math.round((teamPrice || F_PRICE) * (1 - channelFee) - teamUnitCost);
  const previewBreakevenQ = previewUnitMargin > 0 ? Math.ceil(teamFixedCost / previewUnitMargin) : null;
  const submittedCalc = teamResultSnapshot?.result || null;
  const positionLabel = `${formatGridLabel(teamInfo?.final_grid_id || teamRecap?.final_grid_id)} · ${formatArchitectureLabel(teamInfo?.final_architecture)}`;
  const vpRawText = String(teamInfo?.final_vp_text || "").trim();
  const vpSummary = normalizeVpSummaryData(
    teamInfo?.final_vp_summary || teamInfo?.vp_summary || teamRecap?.vp_summary,
    vpRawText
  );
  const vpRecapText = buildVpRecapSentence(vpSummary, summarizeVpText(vpRawText));
  const resultVpScore = normalizeScoreValue(teamRecap?.vp_score);
  const resultFeedbackText = String(teamRecap?.vp_feedback || "").trim();
  const wtpFinalPct = Number.isFinite(Number(teamRecap?.wtp_breakdown?.final_pct))
    ? Number(teamRecap.wtp_breakdown.final_pct)
    : 0;
  const wtpBasePct = Number.isFinite(Number(teamRecap?.wtp_breakdown?.base_pct))
    ? Number(teamRecap.wtp_breakdown.base_pct)
    : 0;
  const wtpJinangDeltaPct = Number.isFinite(Number(teamRecap?.wtp_breakdown?.jinang_delta_pct))
    ? Number(teamRecap.wtp_breakdown.jinang_delta_pct)
    : 0;
  const matchedJinangCount = Number(teamRecap?.jinang_summary?.matched_count || 0);
  const matchedMarketJinangCount = Number(teamRecap?.jinang_summary?.matched_market_count || 0);
  const matchedTechJinangCount = Number(teamRecap?.jinang_summary?.matched_tech_count || 0);
  const totalJinangCount = Number(teamRecap?.jinang_summary?.total_count || 0);
  const resultMarketJinang = teamRecap?.jinang_market || null;
  const resultTechJinang = teamRecap?.jinang_tech || null;
  const resultMarketJinangBonusPct = Number.isFinite(Number(resultMarketJinang?.bonus))
    ? Math.round(Number(resultMarketJinang.bonus) * 100)
    : Math.round(Number(resultMarketJinang?.match_strength || 0) * 5);
  const marketSizeYi = Number.isFinite(Number(submittedCalc?.market_size_yi))
    ? Number(submittedCalc.market_size_yi)
    : Number.isFinite(Number(teamRecap?.market_size_yi))
      ? Number(teamRecap.market_size_yi)
      : null;
  const marketHhi = Number.isFinite(Number(submittedCalc?.hhi))
    ? Number(submittedCalc.hhi)
    : Number.isFinite(Number(teamRecap?.hhi))
      ? Number(teamRecap.hhi)
      : null;
  const marketHhiLabel = String(submittedCalc?.hhi_label || teamRecap?.hhi_label || getHHILabel(marketHhi));
  const hasMarketReference = Number.isFinite(marketSizeYi) && Number.isFinite(marketHhi);
  const teamTitle = teamInfo?.team_name || "当前团队";
  const storedStudentSession = readStudentSession() || null;
  const currentStudentId = String(storedStudentSession?.studentId || "").trim() || "—";
  const memberName = memberState?.name || (isTeamMode ? "当前成员" : "当前学生");
  const currentGroupName = formatStudentGroupName(storedStudentSession?.groupLabel, teamTitle);
  const hasLeaderLock = Boolean(leaderMemberId);
  const round2TeamControlsLocked = Boolean(isTeamMode && hasLeaderLock && !isLeader && step >= 3 && !submitted);
  const round2LeaderBanner = round2TeamControlsLocked
    ? `请到组长 ${leaderDisplayName(leaderName)} 的设备上操作`
    : "";
  const isRound2TeamStage = Boolean(isTeamMode && step >= 3 && step <= 4 && !submitted);
  const memberDims = Array.isArray(memberState?.dims) && memberState.dims.length ? memberState.dims : DEFAULT_MEMBER_DIMS;
  const completedInterviewCount = Number(interviewProgress.completedCount || memberState?.completed_interviews || 0);
  const interviewDimensionGuide = useMemo(
    () => buildDimensionGuideItems(memberDims),
    [memberDims]
  );
  const mergedInterviewScores = useMemo(
    () => radarToInterviewScores(mergeData?.mergedInterview?.radar),
    [mergeData]
  );
  const activeInterviewPersona = interviewPersonas[0] || null;
  const activeInterviewPersonaIntro = useMemo(
    () => buildPersonaIntro(activeInterviewPersona),
    [activeInterviewPersona]
  );
  const interviewGridId = String(
    teamInfo?.grid_selection ||
    teamInfo?.final_grid_id ||
    teamRecap?.grid_selection ||
    teamRecap?.final_grid_id ||
    ""
  ).trim();
  const interviewGridLabel = buildStarterGridLabel(interviewGridId);
  const starterQuestions = useMemo(
    () => buildStarterQuestions({
      persona: activeInterviewPersona,
      gridLabel: interviewGridLabel
    }),
    [activeInterviewPersona, interviewGridLabel]
  );
  const showStarterChips = Boolean(
    activeInterviewPersona &&
    !interviewResult &&
    !interviewTransition &&
    !interviewMessages.some((message) => message.role === "user")
  );
  const nextInterviewTurn = Math.min(INTERVIEW_MAX_TURNS, Number(interviewRound || 0) + 1);
  const interviewPlaceholder = useMemo(() => {
    const personaName = activeInterviewPersona?.name || "访谈对象";
    if (nextInterviewTurn >= 10) return "最后一个问题…";
    if (nextInterviewTurn >= 8) return "试试追问更深层的原因…";
    if (nextInterviewTurn >= 5) return "可以结束，也可以继续深挖…";
    if (nextInterviewTurn >= 2) return "继续提问…";
    return `和 ${personaName} 打个招呼，开始你的访谈吧…`;
  }, [activeInterviewPersona, nextInterviewTurn]);
  const showInterviewComposer = Boolean(interviewSessionId) && !interviewTransition;
  const showInterviewSummary = !showInterviewComposer && Boolean(interviewResult);
  const showInterviewEndButton = showInterviewComposer && interviewCanEnd && interviewRound >= INTERVIEW_MIN_TURNS && interviewRound < INTERVIEW_MAX_TURNS;
  const canEnterCards = Boolean(interviewProgress.canProceed || memberState?.interview_status === "completed");
  const showInterviewStartButton = !showInterviewComposer && !interviewTransition && !canEnterCards;
  const interviewProgressLabel = interviewTransition
    ? `已完成 ${completedInterviewCount}/${Math.max(MIN_INTERVIEWS_REQUIRED, Number(interviewProgress.maxInterviews || 3))} 次访谈`
    : (showInterviewComposer ? `进行中 ${interviewRound}/${INTERVIEW_MAX_TURNS}` : (canEnterCards ? "访谈要求已满足" : "等待开始"));
  const pendingSubmission = useMemo(() => {
    if (isSubmittingFinal) {
      return {
        title: "正在提交团队最终方案...",
        detail: "系统正在保存你们的产品方案并计算最终结果，请不要重复点击。"
      };
    }
    if (isSubmittingIndividual) {
      return {
        title: "正在提交个人选卡...",
        detail: "系统正在保存你的个人选择，完成后会自动进入团队合并阶段。"
      };
    }
    if (isSendingInterview) {
      return {
        title: "正在提交访谈问题...",
        detail: "系统正在生成受访者回复，请稍候，不需要重复点击发送。"
      };
    }
    if (isStartingInterview) {
      return {
        title: "正在创建访谈...",
        detail: "系统正在准备新的访谈对象和会话，请稍候。"
      };
    }
    return null;
  }, [isSendingInterview, isStartingInterview, isSubmittingFinal, isSubmittingIndividual]);
  const isSubmissionBusy = Boolean(pendingSubmission);

  const BS = {marginTop:12,width:"100%",padding:"12px",borderRadius:10,background:"#1a5c3a",color:"#fff",border:"none",fontSize:14,fontWeight:700,cursor:"pointer"};
  const renderMarketReferenceCard = () => {
    if (!hasMarketReference) return null;
    return (
      <div style={{marginTop:16,padding:"20px 24px",background:"#f0f9ff",borderRadius:12}}>
        <div style={{fontSize:13,color:"#6b7280",marginBottom:12}}>市场参考</div>
        <div style={{display:"flex",gap:40,flexWrap:"wrap"}}>
          <div>
            <div style={{fontSize:12,color:"#9ca3af"}}>该细分市场规模</div>
            <div style={{fontSize:20,fontWeight:600,marginTop:4}}>~{marketSizeYi}亿元/年</div>
          </div>
          <div>
            <div style={{fontSize:12,color:"#9ca3af"}}>市场集中度 (HHI)</div>
            <div style={{fontSize:20,fontWeight:600,marginTop:4}}>{marketHhi.toFixed(2)}（{marketHhiLabel}）</div>
          </div>
        </div>
        <div style={{fontSize:12,color:"#9ca3af",marginTop:12}}>
          市场集中度越低，竞争越激烈。产品定位精准度和差异化程度决定实际可获得份额。
        </div>
        <div style={{fontSize:12,color:"#9ca3af",marginTop:8}}>
          真实销量和最终利润要到结果页才会全部揭示。
        </div>
      </div>
    );
  };

  const handleSwitchStudent = () => {
    if (typeof window === "undefined") return;
    clearStudentSession();
    window.location.href = "/multiplayer";
  };

  const handleStarterChipClick = useCallback((question) => {
    const nextValue = String(question || "").trim();
    if (!nextValue) return;
    setInterviewInput(nextValue);
    if (typeof window !== "undefined") {
      window.requestAnimationFrame(() => {
        const input = interviewInputRef.current;
        if (!input) return;
        input.focus();
        if (typeof input.setSelectionRange === "function") {
          input.setSelectionRange(nextValue.length, nextValue.length);
        }
      });
    }
  }, []);

  const handleDownloadInterviewTxt = useCallback(() => {
    const lines = [];
    const completedInterviews = Array.isArray(interviewProgress?.completedInterviews)
      ? interviewProgress.completedInterviews
      : [];
    const activePersonaName = activeInterviewPersona?.name || "访谈对象";
    const currentMessages = Array.isArray(interviewMessages) ? interviewMessages : [];

    lines.push("Round 2 深度用户访谈记录导出");
    lines.push(`Team ID: ${teamId || "-"}`);
    lines.push(`成员: ${memberName || "-"}`);
    lines.push(`导出时间: ${new Date().toLocaleString()}`);
    lines.push("");
    lines.push("=== 访谈上下文 ===");
    lines.push(`团队: ${teamTitle}`);
    lines.push(`战略定位: ${positionLabel || "-"}`);
    lines.push(`负责维度: ${memberDims.map((dimId) => DIMS.find((item) => item.id === dimId)?.l || dimId).join("、") || "-"}`);
    lines.push("");
    lines.push("=== 已完成访谈 ===");
    if (!completedInterviews.length) {
      lines.push("（暂无已完成访谈）");
    } else {
      completedInterviews.forEach((session, index) => {
        lines.push(`第 ${index + 1} 场：${session?.persona_name || "访谈对象"}`);
        lines.push(`轮次: ${Number(session?.turn_count || 0)}`);
        lines.push("");
        const sessionMessages = Array.isArray(session?.messages) ? session.messages : [];
        if (!sessionMessages.length) {
          lines.push("（无对话记录）");
        } else {
          sessionMessages.forEach((message) => {
            const item = formatInterviewExportMessage(message, session?.persona_name || "访谈对象");
            lines.push(`[${item.time}] ${item.speaker}:`);
            lines.push(item.text);
            lines.push("");
          });
        }
        lines.push("------");
      });
    }
    lines.push("");
    lines.push("=== 当前进行中的访谈 ===");
    if (!currentMessages.length) {
      lines.push("（当前没有进行中的访谈）");
    } else {
      lines.push(`访谈对象: ${activePersonaName}`);
      lines.push(`当前轮次: ${interviewRound || 0}`);
      lines.push("");
      currentMessages.forEach((message) => {
        const item = formatInterviewExportMessage(message, activePersonaName);
        lines.push(`[${item.time}] ${item.speaker}:`);
        lines.push(item.text);
        lines.push("");
      });
    }

    downloadTxtFile(`round2-interviews-${teamId || "team"}-${memberId || "member"}`, lines);
  }, [
    activeInterviewPersona,
    interviewMessages,
    interviewProgress,
    interviewRound,
    memberDims,
    memberId,
    memberName,
    positionLabel,
    teamId,
    teamTitle
  ]);

  const applyInterviewPayload = useCallback((payload, options = {}) => {
    const progress = payload?.progress || createEmptyInterviewProgress();
    const session = payload?.session || null;
    const latestSession = payload?.latestSession || session || null;
    const dimensionGuide = Array.isArray(payload?.dimensionGuide) && payload.dimensionGuide.length
      ? payload.dimensionGuide
      : buildDimensionGuideItems(session?.memberDims || memberDims);

    setInterviewProgress(progress);
    setInterviewCanEnd(Boolean(payload?.canEnd || Number(session?.round || latestSession?.round || 0) >= INTERVIEW_MIN_TURNS));
    setInterviewResult(session ? null : (latestSession?.result || null));
    setInterviewPersonas(
      Array.isArray(session?.personas) && session.personas.length
        ? session.personas
        : (session?.persona ? [session.persona] : [])
    );
    setInterviewMessages(
      (Array.isArray(session?.history) ? session.history : [])
        .map((message, index) => toInterviewMessage(message, index))
        .filter((message) => message.text)
    );
    setInterviewSessionId(String(session?.sessionId || ""));
    setInterviewRound(Number(session?.round || 0));
    setInterviewDimensionOpenId((prev) => {
      const first = dimensionGuide[0]?.id || memberDims[0];
      return prev && dimensionGuide.some((item) => item.id === prev) ? prev : first;
    });

    const transition = options.keepTransition
      ? interviewTransition
      : (!session ? buildInterviewTransition(progress, progress.latestCompletedInterview, options.endedByLimit) : null);
    setInterviewTransition(transition);
  }, [interviewTransition, memberDims]);

  const handleStartAnotherInterview = useCallback(async () => {
    if (!teamId || !memberId || isStartingInterview) return;
    try {
      setIsStartingInterview(true);
      setInterviewError("");
      const out = await startRound2Interview({
        teamId,
        memberId,
        memberDims,
        forceNew: true
      });
      applyInterviewPayload({ ...out, session: out.sessionId ? {
        sessionId: out.sessionId,
        persona: out.persona,
        personas: out.personas,
        history: [],
        round: out.round || 0,
        result: null,
        memberDims
      } : null });
      setInterviewInput("");
      setInterviewTransition(null);
    } catch (err) {
      setInterviewError(err.message || "启动下一次访谈失败");
    } finally {
      setIsStartingInterview(false);
    }
  }, [applyInterviewPayload, isStartingInterview, memberDims, memberId, teamId]);

  const handleInterviewEnd = useCallback(async () => {
    if (!interviewSessionId || isSendingInterview) return;
    try {
      setIsSendingInterview(true);
      setInterviewError("");
      const out = await endRound2Interview({ sessionId: interviewSessionId });
      setInterviewResult({
        radar: out.radar || null,
        tags: out.tags || [],
        evi: out.evi,
        confidence: out.confidence || {},
        lowConfidenceDims: out.lowConfidenceDims || [],
        insightsByDim: out.insightsByDim || {},
        scoreSource: out.scoreSource || {},
        summary: out.summary || ""
      });
      setInterviewSessionId("");
      setInterviewPersonas([]);
      setInterviewCanEnd(false);
      setInterviewTransition(buildInterviewTransition(out.progress, out.completedInterview, false));
      setInterviewProgress(out.progress || createEmptyInterviewProgress());
      if (out.progress?.reachedInterviewLimit) {
        setStep(2);
        setSystemNotice("第 3 次访谈完成，已进入个人选卡。");
      }
    } catch (err) {
      setInterviewError(err.message || "结束访谈失败");
    } finally {
      setIsSendingInterview(false);
    }
  }, [interviewSessionId, isSendingInterview]);

  useEffect(() => {
    setInterviewDimensionOpenId(memberDims[0] || DEFAULT_MEMBER_DIMS[0]);
  }, [memberDims]);

  useEffect(() => {
    return () => {
      if (systemNoticeTimerRef.current) {
        window.clearTimeout(systemNoticeTimerRef.current);
        systemNoticeTimerRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (!teamId || !memberId) return;
    setInterviewRestoreChecked(false);
    setInterviewError("");
    setInterviewSessionId("");
    setInterviewPersonas([]);
    setInterviewMessages([]);
    setInterviewInput("");
    setInterviewRound(0);
    setInterviewResult(null);
    setInterviewProgress(createEmptyInterviewProgress());
    setInterviewTransition(null);
    setInterviewCanEnd(false);
    const controller = new AbortController();
    let canceled = false;
    const restoreInterview = async () => {
      try {
        const out = await getRound2InterviewSession(teamId, memberId, interviewSessionId, { signal: controller.signal });
        if (canceled) return;
        applyInterviewPayload(out);
        if (!out?.session && out?.progress?.completedCount >= 3) {
          setStep(2);
        }
      } catch (error) {
        if (error?.name === "AbortError") return;
      } finally {
        if (!canceled) setInterviewRestoreChecked(true);
      }
    };
    restoreInterview();
    return () => {
      canceled = true;
      controller.abort();
    };
  }, [teamId, memberId]);

  useEffect(() => {
    if (
      !interviewRestoreChecked ||
      step !== 1 ||
      !teamId ||
      !memberId ||
      interviewSessionId ||
      interviewTransition ||
      completedInterviewCount > 0
    ) {
      return;
    }
    const controller = new AbortController();
    let canceled = false;
    const startInterview = async () => {
      try {
        setIsStartingInterview(true);
        setInterviewError("");
        const out = await startRound2Interview({
          teamId,
          memberId,
          memberDims
        }, { signal: controller.signal });
        if (canceled) return;
        applyInterviewPayload({
          ...out,
          session: out.sessionId ? {
            sessionId: out.sessionId,
            persona: out.persona,
            personas: out.personas,
            history: [],
            round: out.round || 0,
            result: null,
            memberDims
          } : null
        });
      } catch (err) {
        if (err?.name === "AbortError") return;
        if (!canceled) setInterviewError(err.message || "访谈启动失败");
      } finally {
        if (!canceled) setIsStartingInterview(false);
      }
    };
    startInterview();
    return () => {
      canceled = true;
      controller.abort();
    };
  }, [applyInterviewPayload, completedInterviewCount, interviewRestoreChecked, interviewSessionId, interviewTransition, memberDims, memberId, step, teamId]);

  useEffect(() => {
    if (step < 3 || !teamId || submitted) return;
    const controller = new AbortController();
    let canceled = false;
    const loadMerge = async () => {
      try {
        setMergeError("");
        const out = await getRound2TeamMerge(teamId, baseCost, memberId, { signal: controller.signal });
        if (canceled) return;
        setMergeData(out);
        setLeaderMemberId(String(out?.leader_member_id || leaderMemberId));
        setLeaderName(String(out?.leader_name || leaderName));
        setIsLeader(Boolean(out?.is_leader));
        const mapped = selectionsToMap(out?.team_draft?.selections?.length ? out.team_draft.selections : out.teamSelections);
        if (!serverSelections) {
          setTeamDraftSelections(mapped);
        }
        if (Number.isFinite(Number(out?.team_draft?.price))) {
          setTeamPrice(Number(out.team_draft.price));
        }
      } catch (err) {
        if (err?.name === "AbortError") return;
        if (!canceled) setMergeError(round2LeaderErrorMessage(err));
      }
    };
    loadMerge();
    return () => {
      canceled = true;
      controller.abort();
    };
  }, [step, teamId, memberId, submitted, baseCost, serverSelections]);

  useEffect(() => {
    if (!isTeamMode || !teamId || !memberId || submitted || !isLeader || !round2DraftTouchedRef.current) return undefined;
    if (step < 3) return undefined;
    const timer = window.setTimeout(() => {
      saveRound2TeamDraft({
        team_id: teamId,
        member_id: memberId,
        price: teamPrice,
        selections: toSubmitSelectionsMap(teamDraftSelections)
      }).catch(() => {});
    }, 350);
    return () => window.clearTimeout(timer);
  }, [isLeader, isTeamMode, memberId, step, submitted, teamDraftSelections, teamId, teamPrice]);

  const handleInterviewSend = useCallback(async () => {
    const message = String(interviewInput || "").trim();
    if (!interviewSessionId || !message || isSendingInterview) return;
    try {
      setIsSendingInterview(true);
      setInterviewError("");
      setInterviewMessages((prev) => [
        ...prev,
        toInterviewMessage({ id: `local-user-${Date.now()}`, role: "user", speaker: "你", text: message }, prev.length)
      ]);
      setInterviewInput("");
      const out = await replyRound2Interview({
        sessionId: interviewSessionId,
        message
      });
      const replyText = String(out.reply || "").trim();
      setInterviewMessages((prev) => [
        ...prev,
        toInterviewMessage({
          id: `local-assistant-${Date.now()}`,
          role: "assistant",
          speaker: out.speaker || activeInterviewPersona?.name || "访谈对象",
          text: replyText
        }, prev.length)
      ]);
      setInterviewRound(Number(out.round || interviewRound));
      setInterviewProgress(out.progress || createEmptyInterviewProgress());
      setInterviewCanEnd(Boolean(out.canEnd));
      if (out.isComplete) {
        const nextResult = {
          radar: out.radar || null,
          tags: out.tags || [],
          evi: out.evi,
          confidence: out.confidence || {},
          lowConfidenceDims: out.lowConfidenceDims || [],
          insightsByDim: out.insightsByDim || {},
          scoreSource: out.scoreSource || {},
          summary: out.summary || ""
        };
        setInterviewResult(nextResult);
        setInterviewSessionId("");
        setInterviewPersonas([]);
        setInterviewProgress(out.progress || createEmptyInterviewProgress());
        setInterviewCanEnd(false);
        setInterviewTransition(buildInterviewTransition(out.progress, out.completedInterview, Boolean(out.reachedLimit)));
        if (out.progress?.reachedInterviewLimit) {
          setSystemNotice("第 3 次访谈完成，已自动进入个人选卡。");
          setStep(2);
        } else if (out.reachedLimit) {
          setSystemNotice("本次访谈已结束（已达 10 轮上限）。");
        }
      }
    } catch (err) {
      setInterviewError(err.message || "访谈发送失败");
    } finally {
      setIsSendingInterview(false);
    }
  }, [activeInterviewPersona, interviewInput, interviewRound, interviewSessionId, isSendingInterview]);

  const handleIndividualSubmit = useCallback(async () => {
    if (!teamId || !memberId || indCalc.cnt < 1 || isSubmittingIndividual) return;
    try {
      setIsSubmittingIndividual(true);
      setIndividualSubmitError("");
      await saveRound2MemberSelection({
        teamId,
        memberId,
        selections: selectionsMapToArray(sel)
      });
      setSystemNotice("个人选卡已提交，等待团队合并。");
      setStep(3);
    } catch (err) {
      setIndividualSubmitError(err.message || "个人选卡提交失败");
    } finally {
      setIsSubmittingIndividual(false);
    }
  }, [indCalc.cnt, isSubmittingIndividual, memberId, sel, teamId]);

  const handleFinalSubmit = useCallback(async () => {
    if (!isTeamMode) {
      setSubmitted(true);
      return;
    }
    if (!teamId || isSubmittingFinal || round2TeamControlsLocked) return;

    try {
      setIsSubmittingFinal(true);
      setSubmitError("");
      const radar = buildRadarFromSelections(teamSel);
      const submitSelections = toSubmitSelectionsMap(teamSel);
      const out = await submitRound2TeamDecision({
        team_id: teamId,
        member_id: memberId,
        session_id: sessionId,
        price: teamPrice,
        selections: submitSelections,
        radar,
        mergedInterview: mergeData?.mergedInterview || null
      });
      const mappedSelections = selectionsToMap(out?.submission?.selections);
      setServerSelections(mappedSelections);
      setTeamDraftSelections(mappedSelections);
      setTeamResultSnapshot(out?.result || null);
      setSubmitted(true);
    } catch (err) {
      setSubmitError(round2LeaderErrorMessage(err));
    } finally {
      setIsSubmittingFinal(false);
    }
  }, [isTeamMode, isSubmittingFinal, memberId, mergeData?.mergedInterview, round2TeamControlsLocked, sessionId, teamId, teamPrice, teamSel]);

  // ── Render card (individual mode: no cost numbers) ──
  const renderCard = (card, dim, sels, showCost, mode) => {
    const isOn = !!sels[card.id];
    const tier = sels[card.id] || "mid";
    const hasConflict = card.conflicts?.some(cid => !!sels[cid]);

    return (
      <div key={card.id} data-testid={`r2-card-${card.id}`} style={{
        padding:"12px 14px", borderRadius:10, position:"relative",
        border: isOn ? `2px solid ${card.tag==="降本"?"#2FAB6E":dim.c}` : hasConflict ? "1.5px dashed #d1d5db" : "1.5px solid #e5e7eb",
        background: card.tag==="降本"?"#fafff8":card.tag==="降险"?"#f8faff":"#fff",
        opacity: hasConflict && !isOn ? 0.5 : 1,
      }}>
        {card.tag && <div style={{position:"absolute",top:6,right:8,fontSize:10,fontWeight:700,padding:"2px 8px",borderRadius:4,background:card.tag==="降本"?"#DCFCE7":"#DBEAFE",color:card.tag==="降本"?"#166534":"#1E40AF"}}>{card.tag}</div>}

        {/* Header */}
        <div style={{display:"flex",gap:8,marginBottom:6,paddingRight:card.tag?50:0}}>
          <input
            type="checkbox"
            checked={isOn}
            onChange={() => !hasConflict && !(mode === "team" && round2TeamControlsLocked) && toggleSelection(card.id, mode)}
            disabled={(hasConflict && !isOn) || (mode === "team" && round2TeamControlsLocked)}
            style={{width:16,height:16,marginTop:2,cursor:hasConflict || (mode === "team" && round2TeamControlsLocked) ? "not-allowed" : "pointer"}}
          />
          <div>
            <div style={{fontSize:14,fontWeight:700,lineHeight:1.3}}>{card.n}</div>
            <div style={{fontSize:12,color:"#666",marginTop:2,lineHeight:1.5}}>{card.what}</div>
          </div>
        </div>

        {/* Risk note */}
        <div style={{marginLeft:24,fontSize:11,color:"#888",marginBottom:6,fontStyle:"italic"}}>
          ⚠ {card.riskNote}
        </div>

        {/* Tier selection */}
        <div style={{marginLeft:24,display:"flex",flexDirection:"column",gap:4}}>
          {TS.map(t => {
            const td = card.tiers[t];
            const active = tier===t && isOn;
            const ac = card.tag==="降本"?"#2FAB6E":dim.c;
            const dcogsLabel = getDcogsLabel(td.cost);
            const nreLabel = getNreLabel(td.nre);
            const dcogsTone = getHintTone(dcogsLabel);
            const nreTone = getHintTone(nreLabel);
            return (
              <div
                key={t}
                data-testid={`r2-tier-${card.id}-${t.toUpperCase()}`}
                onClick={()=>isOn && !(mode === "team" && round2TeamControlsLocked) && setSelectionTier(card.id, t, mode)}
                style={{
                display:"flex",alignItems:"flex-start",gap:8,padding:"8px 10px",borderRadius:6,
                cursor:isOn && !(mode === "team" && round2TeamControlsLocked) ? "pointer" : "default",
                border:active?`2px solid ${ac}`:"1px solid #e5e7eb",
                background:active?ac+"08":"#fafafa", opacity:isOn?1:0.4, transition:"all 0.2s",
              }}
              >
                <div style={{width:14,height:14,borderRadius:"50%",border:active?`4px solid ${ac}`:"2px solid #d1d5db",background:"#fff",flexShrink:0,marginTop:2}}/>
                <div style={{flex:1}}>
                  <div>
                    <span style={{fontSize:12,fontWeight:700,color:active?ac:"#374151"}}>{td.l}</span>
                    <span style={{fontSize:11,color:"#888",marginLeft:6}}>{td.d}</span>
                  </div>
                  {!showCost && (
                    <>
                      <div style={{display:"flex",gap:4,flexWrap:"wrap",marginTop:6}}>
                        <span style={{fontSize:10,padding:"2px 6px",borderRadius:999,background:dcogsTone.bg,color:dcogsTone.fg,fontWeight:700,border:`1px solid ${dcogsTone.border}`}}>
                          单位成本：{dcogsLabel}
                        </span>
                        <span style={{fontSize:10,padding:"2px 6px",borderRadius:999,background:nreTone.bg,color:nreTone.fg,fontWeight:700,border:`1px solid ${nreTone.border}`}}>
                          研发投入：{nreLabel}
                        </span>
                      </div>
                      <div style={{fontSize:10,color:"#6b7280",lineHeight:1.6,marginTop:6}}>
                        {card.nreDesc}
                      </div>
                    </>
                  )}
                </div>
                {/* Team: show actual cost number */}
                {showCost && (
                  <div style={{display:"flex",flexDirection:"column",gap:4,flexShrink:0,alignItems:"flex-end"}}>
                    <span style={{fontSize:12,fontWeight:700,color:td.cost<0?"#166534":td.cost>500?"#b91c1c":"#374151"}}>
                      {formatSignedCurrency(td.cost)}/台
                    </span>
                    <span style={{fontSize:11,fontWeight:700,color:"#7c2d12"}}>
                      NRE {td.nre}万
                    </span>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Dependencies */}
        {isOn && card.deps?.filter(d => TS.indexOf(d.tier) <= TS.indexOf(tier)).map((dep, i) => (
          <div key={`${dep.type}-${dep.target}-${dep.tl}-${dep.tier || i}`} style={{marginTop:6,marginLeft:24,padding:"4px 8px",borderRadius:4,background:dep.cross?"#EFF6FF":"#FEF3C7",border:dep.cross?"1px solid #BFDBFE":"1px solid #FDE68A",fontSize:11,color:dep.cross?"#1E40AF":"#92400E"}}>
            {dep.type} <strong>{fc(dep.target)?.n||dep.target}</strong> 达到{dep.tl}以上{dep.cross && <span style={{opacity:0.7}}>（其他成员负责）</span>}
          </div>
        ))}
        {hasConflict && !isOn && <div style={{marginTop:6,marginLeft:24,fontSize:11,color:"#DC2626"}}>✕ 与已选能力卡冲突</div>}
      </div>
    );
  };

  const renderDimGroup = (dimId, sels, showCost, mode) => {
    const dim = DIMS.find(d=>d.id===dimId);
    const cards = CC[dimId]||[];
    const cnt = cards.filter(c=>!!sels[c.id]).length;
    const imp = IMP[dimId];
    return (
      <div key={dimId} data-testid={`r2-dim-${dimId}`} style={{marginBottom:8}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"10px 16px",background:dim.c+"10",borderBottom:`3px solid ${dim.c}`,borderRadius:"10px 10px 0 0"}}>
          <div>
            <span style={{fontSize:15,fontWeight:800}}>{dim.icon} {dim.l}</span>
            <span style={{fontSize:12,color:"#666",marginLeft:8}}>{dim.desc}</span>
          </div>
          <div style={{display:"flex",gap:8,alignItems:"center"}}>
            <span style={{fontSize:11,fontWeight:700,padding:"2px 8px",borderRadius:4,background:IMP_C[imp]+"15",color:IMP_C[imp]}}>用户需求：{imp}</span>
            <span style={{fontSize:12,fontWeight:600,color:dim.c}}>{cnt > 0 ? `已选 ${cnt} 张` : ""}</span>
          </div>
        </div>
        <div style={{display:"grid",gap:8,padding:10,gridTemplateColumns:"repeat(auto-fill,minmax(300px,1fr))",background:"#fff",border:`1px solid ${dim.c}15`,borderTop:"none",borderRadius:"0 0 10px 10px"}}>
          {cards.map(card => renderCard(card, dim, sels, showCost, mode))}
        </div>
      </div>
    );
  };

  // ── Simple radar chart (SVG) ──
  const RadarChart = ({sels}) => {
    const capabilityScores = buildRadarFromSelections(sels || {});
    const hasAnySelection = Object.keys(sels || {}).length > 0;
    const dimScores = DIMS.map((dim) => {
      if (!hasAnySelection) return 0;
      return clamp(Number(capabilityScores[dim.id] || 0) / 9, 0, 1);
    });
    const cx=120, cy=120, r=90;
    const pts = dimScores.map((s,i) => {
      const a = (Math.PI*2*i/6) - Math.PI/2;
      return [cx+r*s*Math.cos(a), cy+r*s*Math.sin(a)];
    });
    const bgPts = Array.from({length:6}).map((_,i) => {
      const a = (Math.PI*2*i/6) - Math.PI/2;
      return [cx+r*Math.cos(a), cy+r*Math.sin(a)];
    });
    return (
      <svg width={240} height={240} style={{display:"block",margin:"0 auto"}}>
        {[0.33,0.66,1].map(s => (
          <polygon key={s} points={bgPts.map(([x,y])=>`${cx+(x-cx)*s},${cy+(y-cy)*s}`).join(" ")} fill="none" stroke="#e5e7eb" strokeWidth={1}/>
        ))}
        {bgPts.map(([x,y],i) => (
          <g key={i}>
            <line x1={cx} y1={cy} x2={x} y2={y} stroke="#e5e7eb" strokeWidth={1}/>
            <text x={cx+(x-cx)*1.15} y={cy+(y-cy)*1.15} textAnchor="middle" dominantBaseline="middle" fontSize={10} fill={DIMS[i].c} fontWeight={700}>{DIMS[i].icon}</text>
          </g>
        ))}
        <polygon points={pts.map(p=>p.join(",")).join(" ")} fill="#1a5c3a20" stroke="#1a5c3a" strokeWidth={2}/>
      </svg>
    );
  };

  return (
    <div style={{fontFamily:"'Noto Sans SC',-apple-system,sans-serif",background:"#fafaf8",minHeight:"100vh",padding:"16px 14px"}}>
    <div style={{maxWidth:1060,margin:"0 auto"}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:12}}>
        <h1 style={{fontSize:20,fontWeight:800,margin:"0 0 4px"}}>Round 2 · 第二轮决策：产品研发</h1>
        <button
          type="button"
          onClick={handleSwitchStudent}
          style={{
            border: "1px solid #d1d5db",
            background: "#fff",
            color: "#374151",
            borderRadius: 10,
            padding: "8px 12px",
            fontSize: 12,
            fontWeight: 700,
            cursor: "pointer"
          }}
        >
          切换学号
        </button>
      </div>
      <div style={{fontSize:12,color:"#6b7280",marginBottom:6}}>
        {isTeamMode ? `${teamTitle} · Team ID ${teamId}` : "未连接团队"}
      </div>
      {teamId && memberId && (
        <div style={{
          position: "sticky",
          top: 12,
          zIndex: 10,
          marginBottom: 14,
          padding: "14px 16px",
          borderRadius: 14,
          background: "#fff",
          border: "1px solid #dbe4ea",
          boxShadow: "0 10px 24px rgba(15,23,42,0.06)"
        }}>
          <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit, minmax(140px, 1fr))",gap:12}}>
            {[
              { label: "学号", value: currentStudentId },
              { label: "姓名", value: memberName },
              { label: "所在组", value: currentGroupName },
              { label: "身份", value: isLeader ? "组长 ★" : "组员" }
            ].map((item) => (
              <div key={item.label}>
                <div style={{fontSize:11,color:"#64748b",marginBottom:4}}>{item.label}</div>
                <div style={{fontSize:14,fontWeight:800,color:"#0f172a"}}>{item.value}</div>
              </div>
            ))}
          </div>
          {isRound2TeamStage && hasLeaderLock && (
            <div style={{
              marginTop:12,
              paddingTop:12,
              borderTop:"1px solid #e2e8f0",
              fontSize:12,
              fontWeight:700,
              color:isLeader ? "#166534" : "#92400e"
            }}>
              {isLeader ? "你是本组操作人" : `请到组长 ${leaderDisplayName(leaderName)} 的设备上操作`}
            </div>
          )}
        </div>
      )}
      {Array.isArray(teamInfo?.members) && teamInfo.members.length > 0 && (
        <div style={{display:"flex",gap:10,flexWrap:"wrap",marginBottom:12}}>
          {teamInfo.members.map((member, index) => {
            const isCurrentMember = member.id === memberId;
            const isLeaderMember = member.id === leaderMemberId;
            return (
              <div
                key={member.id || index}
                style={{
                  display:"flex",
                  alignItems:"center",
                  gap:8,
                  padding:"8px 12px",
                  borderRadius:10,
                  background:isCurrentMember ? "#ecfdf5" : "#fff",
                  border:isCurrentMember ? "2px solid #2FAB6E" : "1px solid #d1d5db",
                  boxShadow:isCurrentMember ? "0 0 0 3px rgba(47,171,110,0.12)" : "none"
                }}
              >
                <div style={{
                  width:26,
                  height:26,
                  borderRadius:"50%",
                  background:isCurrentMember ? "#1a5c3a" : "#94a3b8",
                  color:"#fff",
                  display:"flex",
                  alignItems:"center",
                  justifyContent:"center",
                  fontSize:12,
                  fontWeight:800
                }}>
                  {index + 1}
                </div>
                <div style={{fontSize:13,fontWeight:isCurrentMember ? 800 : 600,color:"#334155"}}>
                  {isCurrentMember ? `你（${member.member_name || "成员"}）` : (member.member_name || "成员")}
                  {isLeaderMember ? " 👑" : ""}
                </div>
              </div>
            );
          })}
        </div>
      )}
      {isLoadingContext && (
        <div style={{padding:"10px 14px",borderRadius:8,background:"#EFF6FF",border:"1px solid #BFDBFE",fontSize:12,color:"#1E40AF",marginBottom:12}}>
          正在同步你们团队的 Round 1 结果和 Round 2 提交状态...
        </div>
      )}
      {loadError && (
        <div style={{padding:"10px 14px",borderRadius:8,background:"#FEF2F2",border:"1px solid #FECACA",fontSize:12,color:"#991B1B",marginBottom:12}}>
          {loadError}
        </div>
      )}
      {submitError && (
        <div style={{padding:"10px 14px",borderRadius:8,background:"#FEF2F2",border:"1px solid #FECACA",fontSize:12,color:"#991B1B",marginBottom:12}}>
          {submitError}
        </div>
      )}
      {systemNotice && (
        <div style={{padding:"10px 14px",borderRadius:8,background:"#ECFDF5",border:"1px solid #A7F3D0",fontSize:12,color:"#065F46",marginBottom:12}}>
          {systemNotice}
        </div>
      )}
      {round2LeaderBanner && (
        <div style={{padding:"10px 14px",borderRadius:8,background:"#fef3c7",border:"1px solid #fcd34d",fontSize:12,color:"#92400e",marginBottom:12}}>
          {round2LeaderBanner}
        </div>
      )}
      {pendingSubmission && (
        <div
          role="status"
          aria-live="polite"
          style={{padding:"12px 14px",borderRadius:10,background:"#fffbeb",border:"1px solid #fde68a",fontSize:12,color:"#92400e",marginBottom:12,boxShadow:"0 1px 2px rgba(0,0,0,0.04)"}}
        >
          <div style={{fontSize:13,fontWeight:800,marginBottom:4}}>{pendingSubmission.title}</div>
          <div style={{lineHeight:1.7}}>{pendingSubmission.detail}</div>
        </div>
      )}
      {teamStatus && (
        <div style={{fontSize:12,color:"#6b7280",marginBottom:10}}>
          当前团队状态：<strong style={{color:"#1a5c3a"}}>{teamStatus}</strong>
          {leaderMemberId ? ` · 组长：👑 ${leaderDisplayName(leaderName)}` : ""}
        </div>
      )}

      {/* Step bar */}
      <div style={{display:"flex",alignItems:"center",margin:"8px 0 16px"}}>
        {STEPS.map((s,i) => (
          <div key={i} style={{display:"flex",alignItems:"center",flex:i<STEPS.length-1?1:"none"}}>
            <div style={{display:"flex",flexDirection:"column",alignItems:"center",gap:4}}>
              <div onClick={()=>!isSubmissionBusy&&i<=step&&setStep(i)} style={{width:28,height:28,borderRadius:"50%",display:"flex",alignItems:"center",justifyContent:"center",fontSize:11,fontWeight:700,cursor:!isSubmissionBusy&&i<=step?"pointer":"default",background:i<step?"#2FAB6E":i===step?"#1a5c3a":"#e5e7eb",color:i<=step?"#fff":"#aaa",boxShadow:i===step?"0 0 0 3px #1a5c3a33":"none",opacity:isSubmissionBusy?0.55:1}}>{i<step?"✓":i+1}</div>
              <span style={{fontSize:9,color:i===step?"#1a5c3a":i<step?"#2FAB6E":"#aaa",fontWeight:i===step?700:400,whiteSpace:"nowrap"}}>{s}</span>
            </div>
            {i<STEPS.length-1 && <div style={{flex:1,height:2,margin:"0 2px",marginBottom:18,background:i<step?"#2FAB6E":"#e5e7eb"}}/>}
          </div>
        ))}
      </div>

      {/* ═══ Step 0: 任务背景 + R1 回顾 + R2 预告 ═══ */}
      {step===0 && (
        <div data-testid="r2-recap-container" style={{background:"#fff",borderRadius:14,padding:24,border:"1px solid #e5e7eb"}}>

          {/* Mission context */}
          <div style={{padding:"16px 20px",borderRadius:12,background:"#f9fafb",border:"1px solid #e5e7eb",marginBottom:20}}>
            <div style={{fontSize:15,fontWeight:700,color:"#374151",marginBottom:6}}>
              📋 决策任务回顾：AI 硬件中国市场的创新战略
            </div>
            <div style={{fontSize:14,color:"#555",lineHeight:1.8}}>
              LOVOT 是一款 AI 机器人，你们的团队正在为它寻找<strong>中国市场的最佳定位</strong>，并基于这个定位进行<strong>产品创新改造</strong>。第一轮你们确定了战略方向，第二轮你们将把战略落地为具体的产品。
            </div>
          </div>

          {/* R1 summary - narrative style */}
          <h2 style={{fontSize:18,fontWeight:800,margin:"0 0 12px"}}>第一轮你们做了什么决定</h2>

          <div style={{padding:"18px 20px",borderRadius:12,background:"linear-gradient(135deg,#065f46,#14532d)",color:"#fff",marginBottom:16}}>
            <div style={{fontSize:12,opacity:0.7,marginBottom:6}}>你们选定的战略方向</div>
            <div style={{fontSize:20,fontWeight:800}}>{positionLabel}</div>
          </div>

          <div style={{padding:"16px 18px",borderRadius:10,border:"1px solid #e5e7eb",marginBottom:12,lineHeight:1.8}}>
            <div style={{fontSize:14,fontWeight:700,color:"#374151",marginBottom:8}}>价值主张复盘</div>
            <div style={{fontSize:14,color:"#555"}}>
              {vpRecapText || "Round 1 价值主张将在这里显示。"}
            </div>
          </div>

          <div style={{padding:"16px 18px",borderRadius:10,border:"1px solid #e5e7eb",marginBottom:12}}>
            <div style={{fontSize:14,fontWeight:700,color:"#374151",marginBottom:12}}>价值主张评分</div>
            <div style={{maxWidth:340,margin:"0 auto",padding:"18px 16px",borderRadius:12,background:"#f9fafb",border:"1px solid #e5e7eb",textAlign:"center"}}>
              <div style={{fontSize:12,color:"#6b7280",fontWeight:700,marginBottom:8}}>VP 综合评分</div>
              <div data-testid="r2-recap-vpscore" style={{fontSize:42,fontWeight:800,color:"#111827",lineHeight:1}}>{resultVpScore.toFixed(1)}</div>
              <div style={{marginTop:10}}>
                <Round1StarRating score={resultVpScore} />
              </div>
            </div>
          </div>

          <div style={{padding:"16px 18px",borderRadius:10,border:"1px solid #e5e7eb",marginBottom:12}}>
            <div style={{fontSize:14,fontWeight:700,color:"#374151",marginBottom:8}}>评分评语</div>
            <div style={{fontSize:14,color:"#555",lineHeight:1.8,whiteSpace:"pre-wrap"}}>
              {resultFeedbackText}
            </div>
          </div>

          <div style={{padding:"16px 18px",borderRadius:10,border:"1px solid #e5e7eb",marginBottom:12,display:"flex",gap:16,flexWrap:"wrap",alignItems:"flex-start"}}>
            <div style={{minWidth:220}}>
              <div style={{fontSize:14,fontWeight:700,color:"#374151",marginBottom:8}}>用户支付意愿</div>
              <div style={{fontSize:34,fontWeight:800,color:wtpFinalPct >= 0 ? "#2FAB6E" : "#dc2626",lineHeight:1}}>
                {formatSignedPercent(wtpFinalPct)}
              </div>
              <div style={{fontSize:12,color:"#9ca3af",marginTop:8}}>仅看 VP 本身：{formatSignedPercent(wtpBasePct)}</div>
              <div style={{fontSize:12,color:wtpJinangDeltaPct >= 0 ? "#2FAB6E" : "#dc2626",marginTop:4}}>
                市场锦囊额外影响：{formatSignedPercent(wtpJinangDeltaPct)}
              </div>
            </div>
            <div style={{fontSize:13,color:"#666",lineHeight:1.7,flex:"1 1 260px"}}>
              第一轮的支付意愿结果会直接影响你们对第二轮产品和定价空间的判断，因此这里继续沿用 Round 1 的最终结论，不再展示分项评分。
            </div>
          </div>

          <div style={{padding:"16px 18px",borderRadius:10,background:"#f0fdf4",border:"1px solid #bbf7d0",marginBottom:20}}>
            <div style={{fontSize:14,fontWeight:700,color:"#166534",marginBottom:8}}>锦囊匹配结果</div>
            <div style={{fontSize:13,color:"#15803d",lineHeight:1.7,marginBottom:10}}>
              团队共 {totalJinangCount} 张锦囊中，{matchedJinangCount} 张与当前定位匹配
              {`（市场 ${matchedMarketJinangCount} 张，技术 ${matchedTechJinangCount} 张）`}
            </div>
            <div style={{display:"flex",gap:10,flexWrap:"wrap"}}>
              {resultMarketJinang && (
                <div style={{flex:"1 1 260px",padding:"10px 12px",borderRadius:10,background:"#fff",border:"1px solid #bbf7d0",fontSize:12,lineHeight:1.7,color:"#166534"}}>
                  <div style={{fontWeight:700,marginBottom:4}}>{resultMarketJinang.name}</div>
                  <div style={{color:"#6b7280"}}>{resultMarketJinang.card_id || resultMarketJinang.id || "市场锦囊"}</div>
                  <div style={{marginTop:6}}>生效范围：Round 1 支付意愿</div>
                  {resultMarketJinangBonusPct > 0 && (
                    <div style={{marginTop:4}}>为支付意愿额外增加了 {resultMarketJinangBonusPct}%</div>
                  )}
                </div>
              )}
              {resultTechJinang && (
                <div style={{flex:"1 1 260px",padding:"10px 12px",borderRadius:10,background:"#fff",border:"1px solid #bbf7d0",fontSize:12,lineHeight:1.7,color:"#166534"}}>
                  <div style={{fontWeight:700,marginBottom:4}}>{resultTechJinang.name}</div>
                  <div style={{color:"#6b7280"}}>{resultTechJinang.card_id || resultTechJinang.id || "技术锦囊"}</div>
                  <div style={{marginTop:6}}>生效范围：Round 2 研发与成本</div>
                </div>
              )}
            </div>
          </div>

          {/* R2 preview */}
          <div style={{padding:"18px 20px",borderRadius:12,background:"#1e293b",color:"#fff"}}>
            <div style={{fontSize:16,fontWeight:700,marginBottom:12}}>第二轮：基于定位的产品创新</div>
            <div style={{fontSize:13,opacity:0.9,lineHeight:1.8,marginBottom:16}}>
              战略方向已经定了，现在的问题是：<strong>产品到底做成什么样？</strong>
            </div>
            <div style={{display:"flex",gap:12,flexWrap:"wrap"}}>
              {[
                {num:"1",title:"挖掘需求",desc:"与 AI 模拟的目标用户深度访谈，验证你们的需求假设，发现隐藏需求"},
                {num:"2",title:"技术决策",desc:"为产品选择具体的技术能力组合——做什么、不做什么、做到什么程度"},
                {num:"3",title:"定价与结果",desc:"制定价格策略，系统根据你们的产品和定价自动计算市场表现"},
              ].map(item => (
                <div key={item.num} style={{flex:"1 1 180px",padding:"12px",background:"rgba(255,255,255,0.08)",borderRadius:8}}>
                  <div style={{width:24,height:24,borderRadius:6,background:"rgba(255,255,255,0.2)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:12,fontWeight:700,marginBottom:6}}>{item.num}</div>
                  <div style={{fontSize:13,fontWeight:700,marginBottom:4}}>{item.title}</div>
                  <div style={{fontSize:12,opacity:0.7,lineHeight:1.5}}>{item.desc}</div>
                </div>
              ))}
            </div>
          </div>
          <div style={{display:"none"}}>
            <span data-testid="r2-recap-target-gm">{String(teamRecap?.target_gm ?? "")}</span>
            <span data-testid="r2-recap-space-tier">{String(teamRecap?.market_space_tier || "")}</span>
          </div>
          <button onClick={()=>setStep(1)} style={BS}>进入第二轮 →</button>
        </div>
      )}

      {/* ═══ Step 1: 用户访谈 ═══ */}
      {step===1 && (
        <div data-testid="r2-interview-container" style={{background:"#fff",borderRadius:14,padding:24,border:"1px solid #e5e7eb"}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:12,flexWrap:"wrap",marginBottom:16}}>
            <div>
              <h2 style={{fontSize:18,fontWeight:800,margin:"0 0 8px"}}>深度用户访谈</h2>
              <p style={{fontSize:14,color:"#555",margin:0,lineHeight:1.8}}>
                每位成员至少完成 2 次访谈，最多 3 次。单次访谈前 4 轮必须继续提问，第 5 轮起可以手动结束，第 10 轮会自动收尾。
              </p>
            </div>
            <button
              type="button"
              onClick={handleDownloadInterviewTxt}
              style={{
                padding:"10px 14px",
                borderRadius:10,
                background:"#fff",
                color:"#374151",
                border:"1px solid #d1d5db",
                fontSize:13,
                fontWeight:700,
                cursor:"pointer",
                whiteSpace:"nowrap"
              }}
            >
              下载访谈 TXT
            </button>
          </div>
          <div style={{padding:"14px 18px",borderRadius:10,background:"#fffbeb",border:"1px solid #fde68a",marginBottom:16}}>
            <div style={{fontSize:14,fontWeight:700,color:"#92400e",marginBottom:6}}>📋 访谈规则</div>
            <div style={{fontSize:13,color:"#78350f",lineHeight:1.8}}>
              当前成员负责维度： <strong>{memberDims.map((dimId) => DIMS.find((item) => item.id === dimId)?.l || dimId).join("、")}</strong>。
              当前已完成 <strong>{completedInterviewCount}</strong> / {Math.max(MIN_INTERVIEWS_REQUIRED, Number(interviewProgress.maxInterviews || 3))} 次访谈。
            </div>
          </div>

          <div style={{display:"flex",gap:16,alignItems:"flex-start",flexWrap:"wrap"}}>
            <div style={{flex:"1 1 680px",minWidth:0}}>
              <div style={{border:"1.5px solid #e5e7eb",borderRadius:12,overflow:"hidden",marginBottom:16}}>
                <div style={{padding:"10px 16px",background:"#f9fafb",borderBottom:"1px solid #e5e7eb",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                  <div>
                    <span style={{fontSize:13,fontWeight:700,color:"#374151"}}>访谈对象：</span>
                    <span style={{fontSize:13,color:"#555"}}>
                      {activeInterviewPersona
                        ? activeInterviewPersona.name
                        : (interviewTransition?.nextPersona?.name || interviewTransition?.completedInterview?.persona_name || (isStartingInterview ? "正在生成 Persona..." : "等待启动"))}
                    </span>
                  </div>
                  <div style={{fontSize:12,color:"#888"}}>
                    {showInterviewComposer
                      ? <>对话轮次：<strong style={{color:"#D97706"}}>{interviewRound}</strong> / {INTERVIEW_MAX_TURNS}</>
                      : <>访谈进度：<strong style={{color:"#D97706"}}>{completedInterviewCount}</strong> / {Math.max(MIN_INTERVIEWS_REQUIRED, Number(interviewProgress.maxInterviews || 3))}</>}
                  </div>
                </div>

                {showInterviewComposer && activeInterviewPersona && (
                  <div style={{padding:"16px",background:"#fff",borderBottom:"1px solid #e5e7eb"}}>
                    <div style={{border:"1px solid #d1d5db",borderRadius:12,background:"#f9fafb",padding:"16px 18px"}}>
                      <div style={{fontSize:15,fontWeight:700,color:"#111827",marginBottom:10}}>📋 访谈对象：{activeInterviewPersonaIntro.name}</div>
                      <div style={{fontSize:13,color:"#4b5563",lineHeight:1.8}}>
                        {activeInterviewPersonaIntro.basics ? <div>{activeInterviewPersonaIntro.basics}</div> : null}
                        {activeInterviewPersonaIntro.living ? <div>{activeInterviewPersonaIntro.living}</div> : null}
                      </div>
                      <div style={{fontSize:13,color:"#374151",lineHeight:1.8,marginTop:10}}>
                        <div>TA 同意参加你们的产品调研，但对具体产品了解不多。</div>
                        <div>请你作为访谈者，从了解 TA 的日常生活和需求开始。</div>
                      </div>
                      <div style={{fontSize:12,color:"#6b7280",lineHeight:1.8,marginTop:10}}>
                        <div>💡 提示：好的访谈从开放式问题开始，</div>
                        <div>比如了解对方的日常生活、困扰或期待。</div>
                      </div>
                    </div>
                  </div>
                )}

                {showInterviewComposer && showStarterChips && (
                  <div style={{padding:"0 16px 16px",background:"#fff",borderBottom:"1px solid #e5e7eb"}}>
                    <div style={{display:"flex",flexWrap:"wrap",gap:10}}>
                      {starterQuestions.map((question) => (
                        <button
                          key={question}
                          type="button"
                          onClick={() => handleStarterChipClick(question)}
                          style={{
                            border:"1px solid #FCD34D",
                            background:"#FFFBEB",
                            color:"#92400E",
                            borderRadius:999,
                            padding:"10px 14px",
                            fontSize:13,
                            lineHeight:1.5,
                            cursor:"pointer",
                            textAlign:"left",
                            whiteSpace:"normal"
                          }}
                        >
                          {question}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {interviewTransition ? (
                  <div style={{padding:"20px 16px",background:"#fafafa"}}>
                    <div style={{border:"1px solid #d1d5db",borderRadius:12,background:"#fff",padding:"18px 20px"}}>
                      <div style={{fontSize:16,fontWeight:800,color:"#111827",marginBottom:10}}>
                        {interviewTransition.type === "required_next"
                          ? `✅ 第 ${completedInterviewCount}/${MIN_INTERVIEWS_REQUIRED} 次访谈完成`
                          : "✅ 访谈完成"}
                      </div>
                      <div style={{fontSize:13,color:"#4b5563",lineHeight:1.8,marginBottom:14}}>
                        <div>你刚才和 {interviewTransition.completedInterview?.persona_name} 聊了 {interviewTransition.completedInterview?.turn_count || 0} 轮。</div>
                        {interviewTransition.type === "required_next" && (
                          <div>接下来你将访谈另一位用户，试试从不同角度收集信息。</div>
                        )}
                        {interviewTransition.type === "choice_optional" && (
                          <div>你已经完成最少 2 次访谈，可以进入下一步；如果愿意，也可以再访谈一位用户补充更多信息。</div>
                        )}
                        {interviewTransition.endedByLimit && (
                          <div>本次访谈已达 10 轮上限，系统已自动收尾。</div>
                        )}
                      </div>
                      <div style={{display:"flex",gap:10,flexWrap:"wrap"}}>
                        {interviewTransition.type === "required_next" && (
                          <button type="button" onClick={handleStartAnotherInterview} style={BS}>
                            开始下一次访谈 →
                          </button>
                        )}
                        {interviewTransition.type === "choice_optional" && (
                          <>
                            <button type="button" onClick={() => setStep(2)} style={BS}>
                              进入个人选卡 →
                            </button>
                            {interviewTransition.nextPersona && (
                              <button
                                type="button"
                                onClick={handleStartAnotherInterview}
                                style={{padding:"12px 16px",borderRadius:10,background:"#fff",color:"#1a5c3a",border:"1px solid #1a5c3a",fontSize:14,fontWeight:700,cursor:"pointer"}}
                              >
                                再访谈一位：{interviewTransition.nextPersona.name}
                              </button>
                            )}
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                ) : (
                  <>
                    <div style={{padding:"16px",minHeight:220,maxHeight:420,overflowY:"auto",background:"#fafafa"}}>
                      {interviewMessages.length === 0 && (
                        <div style={{fontSize:13,color:"#9ca3af"}}>{isStartingInterview ? "正在创建访谈..." : "从你的第一个开放式问题开始。"}</div>
                      )}
                      {showInterviewStartButton && interviewMessages.length === 0 && (
                        <div style={{marginTop:16}}>
                          <button
                            type="button"
                            onClick={handleStartAnotherInterview}
                            disabled={isStartingInterview}
                            style={{...BS,marginTop:0,opacity:isStartingInterview ? 0.5 : 1}}
                          >
                            {isStartingInterview ? "正在创建访谈..." : "开始第一场访谈 →"}
                          </button>
                        </div>
                      )}
                      {interviewMessages.map((message, index) => {
                        const isUser = message.role === "user";
                        return (
                          <div
                            key={message.id || buildInterviewMessageKey(message, index)}
                            data-testid={isUser ? "r2-interview-user-msg" : "r2-interview-persona-msg"}
                            style={{
                              padding:"10px 14px",
                              borderRadius:isUser?"10px 10px 2px 10px":"10px 10px 10px 2px",
                              background:isUser?"#1a5c3a":"#e5e7eb",
                              color:isUser?"#fff":"#374151",
                              maxWidth:"80%",
                              marginLeft:isUser?"auto":"0",
                              marginBottom:12
                            }}
                          >
                            <div style={{fontSize:11,fontWeight:600,opacity:isUser?0.7:1,color:isUser?"rgba(255,255,255,0.75)":"#6b7280",marginBottom:4}}>
                              {message.speaker || (isUser ? "你" : "访谈对象")}
                            </div>
                            <div style={{fontSize:13,lineHeight:1.6}}>{message.text}</div>
                          </div>
                        );
                      })}
                    </div>
                    {showInterviewComposer && (
                      <>
                        {showInterviewEndButton && (
                          <div style={{padding:"12px 16px 0",background:"#fff"}}>
                            <button
                              type="button"
                              onClick={handleInterviewEnd}
                              disabled={isSendingInterview}
                              style={{padding:"8px 14px",borderRadius:8,background:"#fff",color:"#374151",border:"1px solid #d1d5db",fontSize:13,fontWeight:700,cursor:"pointer",opacity:isSendingInterview?0.5:1}}
                            >
                              结束本次访谈 →
                            </button>
                          </div>
                        )}
                        <div style={{display:"flex",gap:8,padding:"12px 16px",borderTop:"1px solid #e5e7eb",background:"#fff"}}>
                          <input
                            data-testid="r2-interview-input"
                            ref={interviewInputRef}
                            type="text"
                            value={interviewInput}
                            onChange={(e)=>setInterviewInput(e.target.value)}
                            onKeyDown={(e)=>{ if (e.key === "Enter") handleInterviewSend(); }}
                            disabled={isStartingInterview || isSendingInterview}
                            placeholder={interviewPlaceholder}
                            style={{flex:1,padding:"8px 12px",borderRadius:8,border:"1.5px solid #d1d5db",fontSize:13,outline:"none"}}
                          />
                          <button
                            data-testid="r2-interview-send-btn"
                            type="button"
                            onClick={handleInterviewSend}
                            disabled={isStartingInterview || isSendingInterview || !String(interviewInput || "").trim()}
                            style={{padding:"8px 20px",borderRadius:8,background:"#1a5c3a",color:"#fff",border:"none",fontSize:13,fontWeight:700,cursor:"pointer",opacity:(isStartingInterview || isSendingInterview || !String(interviewInput || "").trim())?0.5:1}}
                          >
                            {isSendingInterview ? "发送中..." : "发送"}
                          </button>
                        </div>
                      </>
                    )}
                  </>
                )}
              </div>

              {interviewError && (
                <div style={{padding:"10px 14px",borderRadius:8,background:"#FEF2F2",border:"1px solid #FECACA",fontSize:12,color:"#991B1B",marginBottom:12}}>
                  {interviewError}
                </div>
              )}
              <div style={{display:"flex",gap:8,alignItems:"center",marginBottom:16}}>
                <div style={{flex:1,height:6,borderRadius:3,background:"#e5e7eb"}}>
                  <div style={{width:`${Math.min(100, (showInterviewComposer ? interviewRound : completedInterviewCount) / (showInterviewComposer ? INTERVIEW_MAX_TURNS : Math.max(MIN_INTERVIEWS_REQUIRED, Number(interviewProgress.maxInterviews || 3))) * 100)}%`,height:"100%",borderRadius:3,background:"#D97706",transition:"width 0.3s"}}/>
                </div>
                <span style={{fontSize:11,color:"#888"}}>{interviewProgressLabel}</span>
              </div>
              <div data-testid="r2-radar-scores" style={{padding:"14px 18px",borderRadius:10,background:"#f9fafb",border:"1px solid #e5e7eb",marginBottom:12}}>
                <div style={{fontSize:13,fontWeight:700,color:"#374151",marginBottom:8}}>访谈结果摘要</div>
                <p style={{fontSize:12,color:"#888",margin:"0 0 8px"}}>
                  {showInterviewSummary ? buildInterviewSummary(interviewResult, memberDims) : "当前完成一场访谈后，这里会展示对应的真实提炼结果。"}
                </p>
                {showInterviewSummary && (
                  <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
                    {memberDims.map((dimId) => {
                      const dim = DIMS.find((item) => item.id === dimId);
                      if (!dim) return null;
                      const interviewScores = radarToInterviewScores(interviewResult?.radar);
                      const importance = scoreToImportance(interviewScores[dim.id]);
                      return (
                        <span key={dim.id} style={{fontSize:11,padding:"4px 10px",borderRadius:6,background:IMP_C[importance]+"12",color:IMP_C[importance],fontWeight:600,border:`1px solid ${IMP_C[importance]}30`}}>
                          {dim.icon} {dim.l}：{importance}
                        </span>
                      );
                    })}
                  </div>
                )}
                {showInterviewSummary && interviewResult?.tags?.length > 0 && (
                  <div style={{display:"flex",gap:6,flexWrap:"wrap",marginTop:10}}>
                    {interviewResult.tags.slice(0, 6).map((item, index) => (
                      <span key={`${item.tag || item}-${index}`} style={{fontSize:11,padding:"3px 8px",borderRadius:999,background:"#EFF6FF",color:"#1E40AF",fontWeight:600}}>
                        #{String(item.tag || item)}
                      </span>
                    ))}
                  </div>
                )}
              </div>
              <button onClick={()=>canEnterCards&&setStep(2)} style={{...BS,opacity:canEnterCards?1:0.5,cursor:canEnterCards?"pointer":"not-allowed"}}>
                {canEnterCards ? "访谈要求已满足，进入个人选卡 →" : "至少完成 2 次访谈后继续"}
              </button>
              {isSendingInterview && (
                <div style={{marginTop:10,fontSize:12,color:"#92400e",lineHeight:1.7}}>
                  正在提交本轮问题并等待受访者回复，请稍候。
                </div>
              )}
            </div>

            <div style={{flex:"0 1 320px",minWidth:260}}>
              <div style={{border:"1px solid #e5e7eb",borderRadius:12,background:"#fff",overflow:"hidden",position:"sticky",top:16}}>
                <div style={{padding:"14px 16px",background:"#f9fafb",borderBottom:"1px solid #e5e7eb",fontSize:14,fontWeight:800,color:"#111827"}}>
                  你负责探索的维度
                </div>
                <div style={{padding:12}}>
                  {interviewDimensionGuide.map((item) => {
                    const isOpen = interviewDimensionOpenId === item.id;
                    return (
                      <div key={item.id} style={{borderBottom:"1px solid #f3f4f6",padding:"8px 0"}}>
                        <button
                          type="button"
                          onClick={() => setInterviewDimensionOpenId(isOpen ? "" : item.id)}
                          style={{display:"flex",alignItems:"center",justifyContent:"space-between",width:"100%",background:"transparent",border:"none",padding:0,cursor:"pointer",color:"#374151"}}
                        >
                          <span style={{fontSize:13,fontWeight:700}}>{isOpen ? "▼" : "▶"} {item.label}</span>
                          <span style={{fontSize:11,color:"#9ca3af"}}>{isOpen ? "展开" : "折叠"}</span>
                        </button>
                        {isOpen && (
                          <div style={{fontSize:12,color:"#6b7280",lineHeight:1.8,padding:"8px 0 2px 18px"}}>
                            {item.hint}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
                <div style={{padding:"12px 16px",borderTop:"1px solid #e5e7eb",background:"#f9fafb",fontSize:12,color:"#6b7280",lineHeight:1.8}}>
                  💡 不用每个维度都问到，跟着对话自然走就好。
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ═══ Step 2: 个人选卡 (NO cost numbers) ═══ */}
      {step===2 && (
        <div data-testid="r2-card-selection-container">
          <div style={{background:"#fff",padding:"14px 18px",borderRadius:"14px 14px 0 0",border:"1px solid #e5e7eb",borderBottom:"none"}}>
            <h2 style={{fontSize:18,fontWeight:800,margin:"0 0 4px"}}>个人选卡（{memberName}）</h2>
            <p style={{fontSize:13,color:"#666",margin:0,lineHeight:1.6}}>
              为你负责的维度选择能力卡。根据访谈结果和你的判断，把你认为产品应该具备的能力都选上，再选择合适的档次。
              <br/><span style={{color:"#999"}}>现在只展示<strong>单位成本</strong>和<strong>研发投入</strong>的定性标签，以及团队投入说明；具体数字会在团队合并后统一揭示。</span>
            </p>
          </div>
          {/* Sticky bar — individual: no cost numbers */}
          <div style={{position:"sticky",top:0,zIndex:10,display:"flex",gap:10,padding:"10px 16px",background:"#fff",border:"1px solid #e5e7eb",borderTop:"none",borderRadius:"0 0 14px 14px",marginBottom:8,boxShadow:"0 2px 8px rgba(0,0,0,0.04)"}}>
            <div data-testid="r2-budget-display" style={{padding:"6px 14px",borderRadius:8,background:"#f9fafb",border:"1px solid #e5e7eb",fontSize:13,color:"#374151"}}>
              已选 <strong>{indCalc.cnt}</strong> 张
            </div>
            <div style={{flex:1}}/>
            <button onClick={handleIndividualSubmit} disabled={indCalc.cnt < 1 || isSubmittingIndividual} style={{padding:"6px 20px",borderRadius:8,background:indCalc.cnt>=1?"#1a5c3a":"#d1d5db",color:"#fff",border:"none",fontSize:13,fontWeight:700,cursor:isSubmittingIndividual?"wait":(indCalc.cnt>=1?"pointer":"not-allowed"),opacity:isSubmittingIndividual?0.7:1}}>
              {isSubmittingIndividual ? "提交中..." : "提交个人选卡 →"}
            </button>
          </div>
          {isSubmittingIndividual && (
            <div style={{margin:"0 0 12px",padding:"10px 14px",borderRadius:8,background:"#fffbeb",border:"1px solid #fde68a",fontSize:12,color:"#92400e",lineHeight:1.7}}>
              正在提交个人选卡，请稍候。提交成功后会自动进入团队合并。
            </div>
          )}

          {/* Interview summary for reference while selecting cards */}
          <div style={{padding:"14px 18px",borderRadius:10,background:"#f0fdf4",border:"1.5px solid #bbf7d0",marginBottom:8}}>
            <div style={{fontSize:13,fontWeight:700,color:"#166534",marginBottom:6}}>🎙️ 你的访谈洞察</div>
            <div style={{fontSize:13,color:"#374151",lineHeight:1.8,marginBottom:10}}>
              {buildInterviewSummary(interviewResult, memberDims) || "请先完成真实访谈，再根据提炼结果选卡。"}
            </div>
            <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
              {memberDims.map(d => {
                const dm = DIMS.find(x=>x.id===d);
                const interviewScores = radarToInterviewScores(interviewResult?.radar);
                const importance = interviewResult ? scoreToImportance(interviewScores[d]) : IMP[d];
                return (
                  <span key={d} style={{fontSize:11,padding:"3px 8px",borderRadius:4,background:IMP_C[importance]+"12",color:IMP_C[importance],fontWeight:600,border:`1px solid ${IMP_C[importance]}30`}}>
                    {dm.icon} {dm.l}：{importance}
                  </span>
                );
              })}
            </div>
            {individualSubmitError && (
              <div style={{fontSize:12,color:"#b91c1c",marginTop:10}}>
                {individualSubmitError}
              </div>
            )}
          </div>

          {memberDims.map(dimId => renderDimGroup(dimId, sel, false, "individual"))}
        </div>
      )}

      {/* ═══ Step 3: 团队合并 (radar + dimension insights + margin status) ═══ */}
      {step===3 && (() => {
        // Margin calculation for display
        const currentGM = calcGM(teamCalc.cost, teamPrice || F_PRICE, channelFee, baseCost);
        const gmColor = currentGM >= 40 ? "#166534" : currentGM >= 25 ? "#D97706" : "#DC2626";
        const gmStatus = currentGM >= 40 ? "\u5065\u5EB7" : currentGM >= 25 ? "\u504F\u7D27" : "\u5371\u9669";
        return (
        <div data-testid="r2-merge-container" style={{background:"#fff",borderRadius:14,padding:24,border:"1px solid #e5e7eb"}}>
          <h2 style={{fontSize:18,fontWeight:800,margin:"0 0 8px"}}>团队合并 — 成本结构第一次揭示</h2>
          <p style={{fontSize:13,color:"#666",margin:"0 0 16px",lineHeight:1.7}}>
            所有成员的选择已自动合并。现在开始揭示每张卡的单位增量成本和研发投入，让你们看到“功能堆上去以后，成本会变成什么样子”。
          </p>

          {/* Radar chart */}
          <div style={{marginBottom:20,textAlign:"center"}}>
            <div style={{fontSize:14,fontWeight:700,color:"#374151",marginBottom:8}}>当前产品性能雷达图</div>
            <RadarChart sels={teamSel}/>
            <div style={{display:"flex",justifyContent:"center",gap:12,marginTop:8,flexWrap:"wrap"}}>
              {DIMS.map(dim => {
                const cards = CC[dim.id]||[];
                const cnt = cards.filter(c=>!!teamSel[c.id]).length;
                return (
                  <div key={dim.id} style={{minWidth:160,maxWidth:200,padding:"8px 10px",borderRadius:10,background:"#fff",border:`1px solid ${dim.c}22`,textAlign:"left"}}>
                    <div style={{fontSize:11,color:dim.c,fontWeight:700,marginBottom:4}}>
                      {dim.icon} {dim.l}
                    </div>
                    <div style={{fontSize:10,color:"#6b7280",lineHeight:1.5,marginBottom:6}}>
                      {dim.desc}
                    </div>
                    <div style={{fontSize:11,color:"#374151",fontWeight:600}}>
                      已选卡数：{cnt > 0 ? `${cnt} 张` : "未选"}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Interview insights organized BY DIMENSION */}
          <div style={{marginBottom:20}}>
            <div style={{fontSize:14,fontWeight:700,color:"#374151",marginBottom:10}}>🎙️ 访谈洞察（按维度）</div>
            {mergeError && (
              <div style={{padding:"10px 14px",borderRadius:8,background:"#FEF2F2",border:"1px solid #FECACA",fontSize:12,color:"#991B1B",marginBottom:10}}>
                {mergeError}
              </div>
            )}
            {DIMS.map((dim) => {
              const score = Number(mergedInterviewScores?.[dim.id] || 0);
              const owners = Array.isArray(mergeData?.mergedInterview?.sourceByDim?.[dim.id])
                ? mergeData.mergedInterview.sourceByDim[dim.id]
                : [];
              return (
                <div key={dim.id} style={{padding:"10px 14px",borderRadius:8,marginBottom:6,background:dim.c+"06",borderLeft:`4px solid ${dim.c}`}}>
                  <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:4}}>
                    <span style={{fontSize:13,fontWeight:700,color:dim.c}}>{dim.icon} {dim.l}</span>
                    <span style={{fontSize:11,padding:"2px 6px",borderRadius:3,background:IMP_C[scoreToImportance(score)]+"12",color:IMP_C[scoreToImportance(score)],fontWeight:600}}>
                      用户需求：{scoreToImportance(score)}
                    </span>
                  </div>
                  <div style={{fontSize:11,color:"#6b7280",marginBottom:4}}>
                    {dim.desc}
                  </div>
                  <div style={{fontSize:12,color:"#555",lineHeight:1.7}}>
                    {owners.length
                      ? owners
                        .map((item) => {
                          const sourceName = item.scoreSource === "interview_evidence"
                            ? "真实访谈"
                            : item.scoreSource === "grid_prior"
                              ? "战略先验"
                              : "当前输入";
                          const insight = String(item.insight || "").trim();
                          return insight
                            ? `${item.memberName}（${sourceName}）：${insight}`
                            : `${item.memberName}（${sourceName}）：当前合并评分 ${score.toFixed(1)} / 9。`;
                        })
                        .join("；")
                      : "当前还没有足够的真实访谈结果支撑该维度。"}
                  </div>
                </div>
              );
            })}
            {mergeData?.mergedInterview?.tags?.length > 0 && (
              <div style={{display:"flex",gap:6,flexWrap:"wrap",marginTop:8}}>
                {mergeData.mergedInterview.tags.slice(0, 8).map((item, index) => (
                  <span key={`${item.tag || item}-${index}`} style={{fontSize:11,padding:"3px 8px",borderRadius:999,background:"#EFF6FF",color:"#1E40AF",fontWeight:600}}>
                    #{String(item.tag || item)}
                  </span>
                ))}
              </div>
            )}
          </div>

          {/* Merge summary */}
          <div style={{display:"flex",gap:10,marginBottom:12,flexWrap:"wrap"}}>
            <div style={{flex:"1 1 260px",padding:"16px 20px",borderRadius:12,background:currentGM>=40?"#F0FDF4":currentGM>=25?"#FFFBEB":"#FEF2F2",border:currentGM>=40?"1.5px solid #BBF7D0":currentGM>=25?"1.5px solid #FDE68A":"1.5px solid #FECACA"}}>
              <div style={{fontSize:12,fontWeight:600,color:"#6b7280",marginBottom:4}}>当前毛利率</div>
              <div style={{display:"flex",alignItems:"baseline",gap:8}}>
                <span style={{fontSize:32,fontWeight:800,color:gmColor}}>{currentGM.toFixed(0)}%</span>
                <span style={{fontSize:14,fontWeight:600,color:gmColor}}>· {gmStatus}</span>
              </div>
              <div style={{width:"100%",height:8,borderRadius:4,background:"#e5e7eb",marginTop:8}}>
                <div style={{width:`${Math.min(Math.max(currentGM,0)/60*100,100)}%`,height:"100%",borderRadius:4,background:gmColor,transition:"width 0.3s"}}/>
              </div>
            </div>
            <div style={{flex:"1 1 220px",padding:"16px 20px",borderRadius:12,background:teamCalc.cost>=0?"#fff7ed":"#ecfdf5",border:teamCalc.cost>=0?"1.5px solid #fed7aa":"1.5px solid #bbf7d0"}}>
              <div style={{fontSize:12,fontWeight:600,color:"#6b7280",marginBottom:4}}>增量成本合计</div>
              <div style={{fontSize:28,fontWeight:800,color:teamCalc.cost>=0?"#c2410c":"#166534",marginTop:4}}>
                {formatSignedCurrency(teamCalc.cost)}/台
              </div>
              <div style={{fontSize:11,color:"#999"}}>所选能力卡带来的单位变动成本</div>
            </div>
            <div style={{flex:"1 1 220px",padding:"16px 20px",borderRadius:12,background:"#fffbeb",border:"1.5px solid #fde68a"}}>
              <div style={{fontSize:12,fontWeight:600,color:"#6b7280",marginBottom:4}}>研发投入合计</div>
              <div style={{fontSize:28,fontWeight:800,color:"#92400e",marginTop:4}}>
                {teamCalc.nreWan}万
              </div>
              <div style={{fontSize:11,color:"#999"}}>按当前档位累加的一次性 NRE</div>
            </div>
            <div style={{flex:"0 0 auto",padding:"16px 20px",borderRadius:12,background:"#f9fafb",border:"1px solid #e5e7eb",textAlign:"center"}}>
              <div style={{fontSize:12,fontWeight:600,color:"#374151"}}>已选能力卡</div>
              <div style={{fontSize:28,fontWeight:800,color:"#374151",marginTop:4}}>{teamCalc.cnt}</div>
              <div style={{fontSize:11,color:"#999"}}>至少 6 张</div>
            </div>
          </div>
          {teamCalc.cnt > 12 && (
            <div style={{fontSize:13,color:"#6b7280",marginBottom:12}}>
              当前共选 {teamCalc.cnt} 张卡，研发投入 {teamCalc.nreWan} 万。
            </div>
          )}

          <div style={{padding:"14px 16px",borderRadius:10,background:"#f9fafb",border:"1px solid #e5e7eb",marginBottom:16}}>
            <div style={{fontSize:13,fontWeight:700,color:"#374151",marginBottom:8}}>已合并能力卡</div>
            <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
              {DIMS.flatMap((dim) => {
                const cards = CC[dim.id] || [];
                return cards
                  .filter((card) => teamSel[card.id])
                  .map((card) => {
                    const td = card.tiers[teamSel[card.id]];
                    return (
                      <span key={card.id} style={{fontSize:11,padding:"4px 8px",borderRadius:999,background:"#fff",border:"1px solid #e5e7eb",color:"#374151"}}>
                        {card.n} · {td.l} · {formatSignedCurrency(td.cost)}/台 · NRE {td.nre}万
                      </span>
                    );
                  });
              })}
            </div>
          </div>

          {currentGM < 25 && (
            <div style={{padding:"10px 14px",borderRadius:8,background:"#FEF2F2",border:"1px solid #FECACA",fontSize:13,color:"#991B1B",marginBottom:12}}>
              ⚠ 当前技术选择成本过高，毛利率已降至危险区间。在下一步集体讨论中，你们需要砍掉或降档一些能力卡来恢复利润空间。
            </div>
          )}

          <div style={{padding:"10px 14px",borderRadius:8,background:"#FEF3C7",border:"1px solid #FDE68A",fontSize:12,color:"#92400E"}}>
            💡 接下来进入团队讨论和定价。你们已经能看到每张卡的具体 dCOGS 和 NRE，可以开始砍卡、降档或改价格。
          </div>
          <button onClick={()=>setStep(4)} style={BS}>进入集体讨论 →</button>
        </div>
        );
      })()}

      {/* ═══ Step 4: 集体讨论 (full cost info, adjustable) ═══ */}
      {step===4 && (() => {
        const currentGM = calcGM(teamCalc.cost, teamPrice || F_PRICE, channelFee, baseCost);
        const gmOk = currentGM >= GM_FLOOR;
        const gmTier = currentGM >= 40 ? "健康" : currentGM >= 30 ? "良好" : currentGM >= 20 ? "偏紧" : "危险";
        const gmColor = currentGM >= 40 ? "#166534" : currentGM >= 30 ? "#2FAB6E" : currentGM >= 20 ? "#D97706" : "#DC2626";
        return (
        <div>
          <div style={{background:"#fff",padding:"14px 18px",borderRadius:"14px 14px 0 0",border:"1px solid #e5e7eb",borderBottom:"none"}}>
            <h2 style={{fontSize:18,fontWeight:800,margin:"0 0 4px"}}>研发与定价决策</h2>
            <p style={{fontSize:13,color:"#666",margin:0,lineHeight:1.6}}>
              全组一起审视产品的技术能力组合。每增加一项能力或提升档次，研发成本都会上升。你们需要在"产品竞争力"和"成本可行性"之间找到平衡。
            </p>

            {/* Collapsible context panel */}
            <details style={{marginTop:12,borderRadius:8,border:"1px solid #e5e7eb",overflow:"hidden"}}>
              <summary style={{padding:"10px 14px",background:"#f9fafb",cursor:"pointer",fontSize:13,fontWeight:600,color:"#374151"}}>
                📋 查看战略背景（定位 · 价值主张 · 访谈洞察 · 雷达图）
              </summary>
              <div style={{padding:"14px 16px"}}>
                {/* R1 positioning */}
                <div style={{padding:"10px 14px",borderRadius:8,background:"linear-gradient(135deg,#065f46,#14532d)",color:"#fff",marginBottom:10}}>
                  <div style={{fontSize:11,opacity:0.7}}>战略定位</div>
                  <div style={{fontSize:16,fontWeight:800,marginTop:2}}>{positionLabel}</div>
                </div>
                {/* VP */}
                <div style={{padding:"10px 14px",borderRadius:8,border:"1px solid #e5e7eb",marginBottom:10,fontSize:13,lineHeight:1.7}}>
                  <strong>价值主张复盘：</strong>{vpRecapText || "暂无 VP 摘要"}
                </div>
                {/* Interview insights by dimension (condensed) */}
                <div style={{marginBottom:10}}>
                  <div style={{fontSize:12,fontWeight:700,color:"#374151",marginBottom:6}}>访谈洞察</div>
                  {DIMS.map((item) => {
                    const owners = Array.isArray(mergeData?.mergedInterview?.sourceByDim?.[item.id])
                      ? mergeData.mergedInterview.sourceByDim[item.id]
                      : [];
                    const score = Number(mergedInterviewScores?.[item.id] || 0);
                    if (!owners.length && score <= 0) return null;
                    return (
                      <div key={item.id} style={{fontSize:11,color:"#555",padding:"3px 0",display:"flex",gap:6}}>
                        <span style={{color:item.c,fontWeight:600,flexShrink:0}}>{item.icon}</span>
                        <span>{item.l}：{owners.length ? `${owners.map((row) => row.memberName).join("、")} 提供输入，评分 ${score.toFixed(1)}/9` : `评分 ${score.toFixed(1)}/9`}</span>
                      </div>
                    );
                  })}
                </div>
                {/* Mini radar */}
                <RadarChart sels={teamSel}/>
              </div>
            </details>
          </div>

          {/* Sticky metrics — qualitative margin */}
          <div style={{position:"sticky",top:0,zIndex:10,display:"flex",gap:10,padding:"10px 16px",background:"#fff",border:"1px solid #e5e7eb",borderTop:"none",borderRadius:"0 0 14px 14px",marginBottom:8,boxShadow:"0 2px 8px rgba(0,0,0,0.04)",flexWrap:"wrap"}}>
            <div style={{padding:"6px 14px",borderRadius:8,background:gmOk?"#F0FDF4":"#FEF2F2",border:gmOk?"1px solid #BBF7D0":"1px solid #FECACA",fontSize:13,fontWeight:700,color:gmColor}}>
              预期毛利：{gmTier}
            </div>
            <div style={{padding:"6px 14px",borderRadius:8,background:"#f9fafb",border:"1px solid #e5e7eb",fontSize:13}}>
              已选 <strong>{teamCalc.cnt}</strong> 张
            </div>
            <div style={{flex:1}}/>
            <div style={{padding:"6px 14px",borderRadius:8,background:(teamCalc.cnt>=MIN_TEAM_CARDS&&gmOk)?"#F0FDF4":"#FEF2F2",border:(teamCalc.cnt>=MIN_TEAM_CARDS&&gmOk)?"1px solid #BBF7D0":"1px solid #FECACA",fontSize:12,fontWeight:600,color:(teamCalc.cnt>=MIN_TEAM_CARDS&&gmOk)?"#166534":"#DC2626"}}>
              {!gmOk?"\u26A0 预期毛利过低":teamCalc.cnt<MIN_TEAM_CARDS?`还需 ${MIN_TEAM_CARDS-teamCalc.cnt} 张`:"\u2713 选卡就绪，下方定价"}
            </div>
          </div>
          {DIMS.map(dim => renderDimGroup(dim.id, teamSel, true, "team"))}

          {/* ── Cost breakdown ── */}
          <div style={{background:"#fff",borderRadius:14,padding:20,border:"1px solid #e5e7eb",marginTop:12}}>
            <h3 style={{fontSize:16,fontWeight:800,margin:"0 0 12px"}}>📊 成本核算</h3>
            <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(180px,1fr))",gap:10,marginBottom:12}}>
              <div style={{padding:"12px 14px",borderRadius:10,background:"#f9fafb",border:"1px solid #e5e7eb"}}>
                <div style={{fontSize:11,color:"#6b7280"}}>基础制造成本</div>
                <div style={{fontSize:22,fontWeight:800,color:"#374151",marginTop:4}}>¥{baseCost.toLocaleString()}</div>
                <div style={{fontSize:10,color:"#999"}}>材料+组装+包装/台</div>
              </div>
              <div style={{padding:"12px 14px",borderRadius:10,background:teamCalc.cost>0?"#FEF3C7":"#F0FDF4",border:teamCalc.cost>0?"1px solid #FDE68A":"1px solid #BBF7D0"}}>
                <div style={{fontSize:11,color:"#6b7280"}}>dCOGS 合计</div>
                <div style={{fontSize:22,fontWeight:800,color:teamCalc.cost>0?"#D97706":"#2FAB6E",marginTop:4}}>{formatSignedCurrency(teamCalc.cost)}</div>
                <div style={{fontSize:10,color:"#999"}}>选卡带来的单位变动成本</div>
              </div>
              <div style={{padding:"12px 14px",borderRadius:10,background:"#fffbeb",border:"1px solid #fde68a"}}>
                <div style={{fontSize:11,color:"#6b7280"}}>NRE 合计</div>
                <div style={{fontSize:22,fontWeight:800,color:"#92400e",marginTop:4}}>{teamCalc.nreWan}万</div>
                <div style={{fontSize:10,color:"#999"}}>按当前档位累加的一次性研发投入</div>
              </div>
              <div style={{padding:"12px 14px",borderRadius:10,background:"#EFF6FF",border:"1px solid #BFDBFE"}}>
                <div style={{fontSize:11,color:"#6b7280"}}>单台总变动成本</div>
                <div style={{fontSize:22,fontWeight:800,color:"#1E40AF",marginTop:4}}>¥{teamUnitCost.toLocaleString()}</div>
                <div style={{fontSize:10,color:"#999"}}>V + dCOGS</div>
              </div>
            </div>
            {/* Per-dimension cost breakdown */}
            <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
              {DIMS.map(dim => {
                const cards = CC[dim.id]||[];
                const dimCost = cards.reduce((sum,c) => sum + (teamSel[c.id] ? c.tiers[teamSel[c.id]].cost : 0), 0);
                const dimNre = cards.reduce((sum,c) => sum + (teamSel[c.id] ? c.tiers[teamSel[c.id]].nre : 0), 0);
                if (dimCost === 0 && dimNre === 0) return null;
                return (
                  <span key={dim.id} style={{fontSize:11,padding:"3px 8px",borderRadius:4,background:dim.c+"10",color:dim.c,fontWeight:600,border:`1px solid ${dim.c}25`}}>
                    {dim.icon} {formatSignedCurrency(dimCost)} / NRE {dimNre}万
                  </span>
                );
              })}
            </div>
          </div>

          {/* ── Market reference (R1 results) ── */}
          <div style={{background:"#fff",borderRadius:14,padding:20,border:"1px solid #e5e7eb",marginTop:12}}>
            <h3 style={{fontSize:16,fontWeight:800,margin:"0 0 12px"}}>📈 市场参考（第一轮结果）</h3>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:12}}>
              <div style={{padding:"12px 14px",borderRadius:10,background:"#f0fdf4",border:"1.5px solid #bbf7d0"}}>
                <div style={{fontSize:11,color:"#6b7280"}}>市场空间</div>
                <div style={{fontSize:22,fontWeight:800,color:"#166534",marginTop:4}}>{teamRecap?.market_space_tier || "中"}</div>
                <div style={{fontSize:10,color:"#888"}}>{formatGridLabel(teamRecap?.final_grid_id || teamInfo?.final_grid_id)}</div>
              </div>
              <div style={{padding:"12px 14px",borderRadius:10,background:"#faf5ff",border:"1.5px solid #e9d5ff"}}>
                <div style={{fontSize:11,color:"#6b7280"}}>价值主张对支付意愿的影响</div>
                <div style={{fontSize:22,fontWeight:800,color:"#7c3aed",marginTop:4}}>{formatSignedPercent(wtpFinalPct)}</div>
                <div style={{fontSize:10,color:"#888"}}>仅看 VP 本身 {formatSignedPercent(wtpBasePct)}，市场锦囊额外影响 {formatSignedPercent(wtpJinangDeltaPct)}</div>
              </div>
            </div>
            <div style={{fontSize:12,color:"#555",lineHeight:1.7,padding:"10px 14px",borderRadius:8,background:"#f9fafb",border:"1px solid #e5e7eb"}}>
              <strong>定价参考框架：</strong>当前单台变动成本是 ¥{teamUnitCost.toLocaleString()}，固定成本是 {teamFixedCostWan} 万（基础 {F_BASE_WAN} 万 + NRE {teamCalc.nreWan} 万）。渠道抽走 {Math.round(channelFee*100)}% 后到手更少，你们需要在价格、销量和固定投入之间找到平衡。
            </div>
          </div>

          {/* ── Pricing section ── */}
          <div style={{background:"#fff",borderRadius:14,padding:20,border:"1px solid #e5e7eb",marginTop:12}}>
            <h3 style={{fontSize:16,fontWeight:800,margin:"0 0 8px"}}>定价决策</h3>

            {/* Pricing principles */}
            <div style={{padding:"12px 16px",borderRadius:10,background:"#f9fafb",border:"1px solid #e5e7eb",marginBottom:16}}>
              <div style={{fontSize:13,fontWeight:700,color:"#374151",marginBottom:8}}>💡 定价须知</div>
              <div style={{fontSize:13,color:"#555",lineHeight:1.8}}>
                <div style={{marginBottom:6}}>
                  <strong>渠道成本：</strong>你们定的售价不等于到手收入。当前渠道抽成约 {Math.round(channelFee*100)}%。
                </div>
                <div style={{marginBottom:6}}>
                  <strong>量价权衡：</strong>价格越高，每台赚得越多，但愿意买的用户越少。价格越低，用户越多，但可能卖一台亏一台。
                </div>
                <div>
                  <strong>产品力影响：</strong>产品能力组合越精准匹配用户需求，用户对价格的敏感度越低——好产品可以卖更贵。
                </div>
              </div>
            </div>

            {/* Price slider */}
            <div style={{padding:"20px",borderRadius:12,background:"#f0fdf4",border:"1.5px solid #bbf7d0",marginBottom:16}}>
              <div style={{fontSize:14,fontWeight:700,color:"#374151",marginBottom:12}}>产品售价</div>
              <div style={{fontSize:36,fontWeight:800,color:"#1a5c3a",marginBottom:8}}>¥{teamPrice.toLocaleString()}</div>
              <input
                data-testid="r2-price-input"
                type="range"
                min={5000}
                max={20000}
                step={100}
                value={teamPrice}
                onChange={e => {
                  round2DraftTouchedRef.current = true;
                  setTeamPrice(+e.target.value);
                }}
                disabled={round2TeamControlsLocked}
                style={{width:"100%",height:8,borderRadius:4,cursor:round2TeamControlsLocked ? "not-allowed" : "pointer"}}
              />
              <div style={{display:"flex",justifyContent:"space-between",fontSize:11,color:"#999",marginTop:4}}>
                <span>¥5,000（低价走量）</span>
                <span>¥20,000（高端定位）</span>
              </div>
            </div>

            {/* Channel deduction - real-time */}
            <div style={{display:"flex",gap:10,marginBottom:16,alignItems:"center"}}>
              <div style={{flex:1,padding:"12px 16px",borderRadius:10,border:"1.5px solid #D9770630",background:"#D9770608",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                <div>
                  <div style={{fontSize:11,color:"#6b7280"}}>渠道抽成 {Math.round(channelFee*100)}% 后，每台到手</div>
                  <div style={{fontSize:24,fontWeight:800,color:"#D97706",marginTop:2}}>¥{Math.round(teamPrice*(1-channelFee)).toLocaleString()}</div>
                </div>
                <div style={{fontSize:12,color:"#999",textAlign:"right"}}>
                  售价 ¥{teamPrice.toLocaleString()}<br/>
                  − 渠道 ¥{Math.round(teamPrice*channelFee).toLocaleString()}
                </div>
              </div>
            </div>

            <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(180px,1fr))",gap:10,marginBottom:16}}>
              <div style={{padding:"12px 14px",borderRadius:10,background:"#f9fafb",border:"1px solid #e5e7eb"}}>
                <div style={{fontSize:11,color:"#6b7280"}}>总固定成本</div>
                <div style={{fontSize:22,fontWeight:800,color:"#374151",marginTop:4}}>{teamFixedCostWan}万</div>
                <div style={{fontSize:10,color:"#999"}}>基础 {F_BASE_WAN} 万 + 研发 {teamCalc.nreWan} 万</div>
              </div>
              <div style={{padding:"12px 14px",borderRadius:10,background:previewBreakevenQ ? "#eff6ff" : "#fef2f2",border:previewBreakevenQ ? "1px solid #bfdbfe" : "1px solid #fecaca"}}>
                <div style={{fontSize:11,color:"#6b7280"}}>盈亏平衡销量</div>
                <div style={{fontSize:22,fontWeight:800,color:previewBreakevenQ ? "#1d4ed8" : "#b91c1c",marginTop:4}}>
                  {previewBreakevenQ ? `${previewBreakevenQ.toLocaleString()} 台` : "无法回本"}
                </div>
                <div style={{fontSize:10,color:"#999"}}>BEQ = F_total / 单台毛利</div>
              </div>
              <div style={{padding:"12px 14px",borderRadius:10,background:previewUnitMargin > 0 ? "#f0fdf4" : "#fef2f2",border:previewUnitMargin > 0 ? "1px solid #bbf7d0" : "1px solid #fecaca"}}>
                <div style={{fontSize:11,color:"#6b7280"}}>单台毛利</div>
                <div style={{fontSize:22,fontWeight:800,color:previewUnitMargin > 0 ? "#166534" : "#b91c1c",marginTop:4}}>
                  {formatSignedCurrency(previewUnitMargin)}
                </div>
                <div style={{fontSize:10,color:"#999"}}>售价净收入 - 单台变动成本</div>
              </div>
            </div>

            {renderMarketReferenceCard()}
            <button
              onClick={() => (teamCalc.cnt >= MIN_TEAM_CARDS && gmOk && !round2TeamControlsLocked) && setStep(5)}
              disabled={round2TeamControlsLocked || teamCalc.cnt < MIN_TEAM_CARDS || !gmOk}
              style={{...BS,background:(teamCalc.cnt>=MIN_TEAM_CARDS&&gmOk&&!round2TeamControlsLocked)?"#1a5c3a":"#d1d5db",cursor:(teamCalc.cnt>=MIN_TEAM_CARDS&&gmOk&&!round2TeamControlsLocked)?"pointer":"not-allowed"}}
            >
              {round2TeamControlsLocked
                ? `仅组长 ${leaderDisplayName(leaderName)} 可继续`
                : !gmOk
                  ? "预期毛利过低，请先调整选卡"
                  : teamCalc.cnt < MIN_TEAM_CARDS
                    ? `还需选 ${MIN_TEAM_CARDS-teamCalc.cnt} 张能力卡`
                    : "确认产品方案与定价，查看结果 →"}
            </button>
          </div>
        </div>
        );
      })()}

      {/* ═══ Step 5: 确认提交 ═══ */}
      {step===5 && !submitted && (
        <div style={{background:"#fff",borderRadius:14,padding:24,border:"1px solid #e5e7eb"}}>
          <h2 style={{fontSize:18,fontWeight:800,margin:"0 0 12px"}}>确认提交 — 请检查你们的决策</h2>

          {/* Positioning */}
          <div style={{padding:"16px 20px",borderRadius:12,background:"linear-gradient(135deg,#065f46,#14532d)",color:"#fff",marginBottom:16}}>
            <div style={{fontSize:12,opacity:0.7}}>战略定位</div>
            <div style={{fontSize:18,fontWeight:800,marginTop:4}}>{positionLabel}</div>
            <div style={{fontSize:13,opacity:0.85,marginTop:6,lineHeight:1.6}}>价值主张复盘：{vpRecapText || "暂无 VP 摘要"}</div>
          </div>

          {/* Radar */}
          <div style={{marginBottom:16,textAlign:"center"}}>
            <RadarChart sels={teamSel}/>
          </div>

          {/* Selected cards summary */}
          <div style={{marginBottom:16}}>
            <div style={{fontSize:14,fontWeight:700,color:"#374151",marginBottom:8}}>产品能力组合（{teamCalc.cnt} 张）</div>
            {DIMS.map(dim => {
              const cards = CC[dim.id]||[];
              const picked = cards.filter(c=>!!teamSel[c.id]);
              if (!picked.length) return null;
              return (
                <div key={dim.id} style={{display:"flex",gap:6,alignItems:"center",padding:"4px 0",borderBottom:"1px solid #f3f4f6"}}>
                  <span style={{fontSize:12,fontWeight:700,color:dim.c,minWidth:100}}>{dim.icon} {dim.l}</span>
                  <div style={{display:"flex",gap:4,flexWrap:"wrap"}}>
                    {picked.map(card => {
                      const t = teamSel[card.id];
                      const td = card.tiers[t];
                      return (
                        <span key={card.id} style={{fontSize:11,padding:"2px 8px",borderRadius:4,background:dim.c+"10",color:dim.c,fontWeight:600}}>
                          {card.n}（{td.l}）
                        </span>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Cost & pricing summary */}
          <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(180px,1fr))",gap:10,marginBottom:16}}>
            <div style={{padding:"12px 14px",borderRadius:10,background:"#f9fafb",border:"1px solid #e5e7eb"}}>
              <div style={{fontSize:11,color:"#6b7280"}}>单台总变动成本</div>
              <div style={{fontSize:20,fontWeight:800,color:"#374151",marginTop:4}}>¥{teamUnitCost.toLocaleString()}</div>
            </div>
            <div style={{padding:"12px 14px",borderRadius:10,background:"#f0fdf4",border:"1.5px solid #bbf7d0"}}>
              <div style={{fontSize:11,color:"#6b7280"}}>定价</div>
              <div style={{fontSize:20,fontWeight:800,color:"#166534",marginTop:4}}>¥{teamPrice.toLocaleString()}</div>
            </div>
            <div style={{padding:"12px 14px",borderRadius:10,background:"#D9770608",border:"1.5px solid #D9770630"}}>
              <div style={{fontSize:11,color:"#6b7280"}}>渠道抽成后到手</div>
              <div style={{fontSize:20,fontWeight:800,color:"#D97706",marginTop:4}}>¥{Math.round(teamPrice*(1-channelFee)).toLocaleString()}</div>
            </div>
            <div style={{padding:"12px 14px",borderRadius:10,background:"#fffbeb",border:"1.5px solid #fde68a"}}>
              <div style={{fontSize:11,color:"#6b7280"}}>固定成本</div>
              <div style={{fontSize:20,fontWeight:800,color:"#92400e",marginTop:4}}>{teamFixedCostWan}万</div>
            </div>
            <div style={{padding:"12px 14px",borderRadius:10,background:previewBreakevenQ ? "#eff6ff" : "#fef2f2",border:previewBreakevenQ ? "1px solid #bfdbfe" : "1px solid #fecaca"}}>
              <div style={{fontSize:11,color:"#6b7280"}}>盈亏平衡销量</div>
              <div style={{fontSize:20,fontWeight:800,color:previewBreakevenQ ? "#1d4ed8" : "#b91c1c",marginTop:4}}>
                {previewBreakevenQ ? `${previewBreakevenQ.toLocaleString()} 台` : "无法回本"}
              </div>
              <div style={{fontSize:10,color:"#999"}}>BEQ = F_total / 单台毛利</div>
            </div>
          </div>

          {/* Confirm prompt */}
          <div style={{padding:"14px 18px",borderRadius:10,background:"#FFFBEB",border:"1px solid #FDE68A",marginBottom:16,fontSize:13,color:"#92400E",lineHeight:1.7}}>
            ⚠ 提交后不可修改。提交后会立即揭示销量、固定成本和最终利润拆解。
          </div>

          <div style={{display:"flex",gap:10}}>
            <button
              onClick={()=>!round2TeamControlsLocked&&setStep(4)}
              disabled={round2TeamControlsLocked}
              style={{...BS,background:"#f9fafb",color:"#374151",border:"1px solid #e5e7eb",flex:1,opacity:round2TeamControlsLocked?0.6:1,cursor:round2TeamControlsLocked?"not-allowed":"pointer"}}
            >
              ← 返回修改
            </button>
            <button data-testid="r2-final-submit" onClick={handleFinalSubmit} disabled={isSubmittingFinal || round2TeamControlsLocked} style={{...BS,flex:1,opacity:isSubmittingFinal||round2TeamControlsLocked?0.7:1,cursor:isSubmittingFinal?"wait":(round2TeamControlsLocked?"not-allowed":"pointer")}}>
              {round2TeamControlsLocked ? `仅组长 ${leaderDisplayName(leaderName)} 可提交` : (isSubmittingFinal ? "提交中..." : "确认提交 ✓")}
            </button>
          </div>
          {isSubmittingFinal && (
            <div style={{marginTop:12,padding:"10px 14px",borderRadius:8,background:"#fffbeb",border:"1px solid #fde68a",fontSize:12,color:"#92400e",lineHeight:1.7}}>
              正在提交最终方案并计算结果，请不要重复点击，完成后会自动显示结果页。
            </div>
          )}
        </div>
      )}

      {/* ═══ Submitted result ═══ */}
      {step===5 && submitted && (
        <div data-testid="r2-results-container" style={{background:"#fff",borderRadius:14,padding:24,border:"1px solid #e5e7eb"}}>
          <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:8}}>
            <div style={{fontSize:36}}>✅</div>
            <div>
              <h2 style={{fontSize:22,fontWeight:800,color:"#166534",margin:0}}>结果已揭示</h2>
              <p style={{fontSize:14,color:"#555",lineHeight:1.7,margin:"4px 0 0"}}>
                你们的产品方案和定价已提交，下面是完整结果。
              </p>
            </div>
          </div>

          {submittedCalc ? (
            <>
              <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(180px,1fr))",gap:10,margin:"18px 0"}}>
                <div style={{padding:"14px 16px",borderRadius:10,background:"#eff6ff",border:"1px solid #bfdbfe"}}>
                  <div style={{fontSize:11,color:"#6b7280"}}>实际销量 Q</div>
                  <div style={{fontSize:26,fontWeight:800,color:"#1d4ed8",marginTop:4}}>{Number(submittedCalc.units || 0).toLocaleString()} 台</div>
                </div>
                <div style={{padding:"14px 16px",borderRadius:10,background:"#f0fdf4",border:"1px solid #bbf7d0"}}>
                  <div style={{fontSize:11,color:"#6b7280"}}>收入（渠道后）</div>
                  <div style={{fontSize:26,fontWeight:800,color:"#166534",marginTop:4}}>¥{Math.round(Number(submittedCalc.revenueNet || 0)).toLocaleString()}</div>
                </div>
                <div style={{padding:"14px 16px",borderRadius:10,background:"#fff7ed",border:"1px solid #fed7aa"}}>
                  <div style={{fontSize:11,color:"#6b7280"}}>变动成本</div>
                  <div style={{fontSize:26,fontWeight:800,color:"#c2410c",marginTop:4}}>¥{Math.round(Number(submittedCalc.variableCost || 0)).toLocaleString()}</div>
                </div>
                <div style={{padding:"14px 16px",borderRadius:10,background:Number(submittedCalc.profit || 0) >= 0 ? "#f0fdf4" : "#fef2f2",border:Number(submittedCalc.profit || 0) >= 0 ? "1px solid #bbf7d0" : "1px solid #fecaca"}}>
                  <div style={{fontSize:11,color:"#6b7280"}}>利润</div>
                  <div data-testid="r2-profit-value" style={{fontSize:26,fontWeight:800,color:Number(submittedCalc.profit || 0) >= 0 ? "#166534" : "#b91c1c",marginTop:4}}>
                    {formatSignedCurrency(Math.round(Number(submittedCalc.profit || 0)))}
                  </div>
                </div>
              </div>

              <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(180px,1fr))",gap:10,marginBottom:16}}>
                <div style={{padding:"12px 14px",borderRadius:10,background:"#f9fafb",border:"1px solid #e5e7eb"}}>
                  <div style={{fontSize:11,color:"#6b7280"}}>固定成本</div>
                  <div style={{fontSize:22,fontWeight:800,color:"#374151",marginTop:4}}>¥{Math.round(Number(submittedCalc.fixedCost || submittedCalc.f_total || 0)).toLocaleString()}</div>
                  <div style={{fontSize:10,color:"#999"}}>基础 {F_BASE_WAN} 万 + 研发 {Number(submittedCalc.nre_total_wan || 0)} 万</div>
                </div>
                <div style={{padding:"12px 14px",borderRadius:10,background:"#fffbeb",border:"1px solid #fde68a"}}>
                  <div style={{fontSize:11,color:"#6b7280"}}>盈亏平衡销量</div>
                  <div style={{fontSize:22,fontWeight:800,color:"#92400e",marginTop:4}}>
                    {submittedCalc.breakeven_q ? `${Number(submittedCalc.breakeven_q).toLocaleString()} 台` : "无法回本"}
                  </div>
                </div>
                <div style={{padding:"12px 14px",borderRadius:10,background:"#f9fafb",border:"1px solid #e5e7eb"}}>
                  <div style={{fontSize:11,color:"#6b7280"}}>单台毛利</div>
                  <div style={{fontSize:22,fontWeight:800,color:Number(submittedCalc.unitMargin || 0) >= 0 ? "#166534" : "#b91c1c",marginTop:4}}>
                    {formatSignedCurrency(Math.round(Number(submittedCalc.unitMargin || 0)))}
                  </div>
                </div>
              </div>
              <div style={{padding:"14px 18px",borderRadius:10,background:"#f9fafb",border:"1px solid #e5e7eb",fontSize:13,color:"#374151",lineHeight:1.8}}>
                <strong>利润拆解：</strong>
                收入 ¥{Math.round(Number(submittedCalc.revenueNet || 0)).toLocaleString()}
                {" "}− 变动成本 ¥{Math.round(Number(submittedCalc.variableCost || 0)).toLocaleString()}
                {" "}− 固定成本 ¥{Math.round(Number(submittedCalc.fixedCost || submittedCalc.f_total || 0)).toLocaleString()}
                {Number(submittedCalc.profitSub || 0) ? ` + 订阅贡献 ¥${Math.round(Number(submittedCalc.profitSub || 0)).toLocaleString()}` : ""}
                {Number(submittedCalc.penalty || 0) ? ` − Penalty ¥${Math.round(Number(submittedCalc.penalty || 0)).toLocaleString()}` : ""}
                {" "} = 利润 {formatSignedCurrency(Math.round(Number(submittedCalc.profit || 0)))}
              </div>
            </>
          ) : (
            <div style={{padding:"14px 18px",borderRadius:10,background:"#f9fafb",border:"1px solid #e5e7eb",fontSize:13,color:"#555"}}>
              结果正在同步，请刷新页面查看完整销量与利润拆解。
            </div>
          )}

          <div style={{padding:"18px",borderRadius:12,background:"#1e293b",color:"#fff",marginTop:18}}>
            <div style={{fontSize:15,fontWeight:700,marginBottom:6}}>继续课堂复盘</div>
            <div style={{fontSize:13,opacity:0.9,lineHeight:1.8}}>
              老师接下来会带大家对比各组的产品选择、定价策略和最终利润，讨论为什么同样的市场方向会得到不同结果。
            </div>
          </div>
        </div>
      )}

    </div>
    </div>
  );
}
