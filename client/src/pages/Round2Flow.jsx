import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import {
  completeRound2SummaryReading,
  continueRound2SummaryReading,
  endRound2Interview,
  getRound2PersonaReport,
  getRound2Recap,
  getRound2InterviewSession,
  getRound2TeamReadingStatus,
  getRound2State,
  getRound2TeamMerge,
  getRound2TeamResult,
  replyRound2Interview,
  rescoreRound2Interview,
  forceAdvanceRound2,
  saveRound2MemberSelection,
  saveRound2TeamDraft,
  startRound2Interview,
  submitRound2TeamDecision
} from "../api/round2Api";
import { getRdCards } from "../api/rdApi";
import { formatSignedYuan, formatWan, formatYuan } from "../utils/formatMoney";
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
const SUMMARY_READING_INDIVIDUAL = "READING_INDIVIDUAL";
const SUMMARY_READING_TEAM_SUMMARY = "READING_TEAM_SUMMARY";
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
const INTERVIEW_START_DEBOUNCE_MS = 3000;
const FORCE_ADVANCE_DELAY_MS = 60000;

function getForceAdvanceRemainingMs(submittedAt, now) {
  const ts = Number(submittedAt || 0);
  if (!ts) return FORCE_ADVANCE_DELAY_MS;
  return Math.max(0, FORCE_ADVANCE_DELAY_MS - Math.max(0, Number(now || Date.now()) - ts));
}

function formatForceAdvanceCountdown(ms) {
  return `${Math.ceil(Math.max(0, Number(ms || 0)) / 1000)} 秒`;
}

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

const ROUND2_NARRATIVE_STAGES = [
  { id: "research", label: "客户调研", steps: [0, 1] },
  { id: "product", label: "产品研发", steps: [2, 3] },
  { id: "pricing", label: "定价发布", steps: [4] },
  { id: "review", label: "经营复盘", steps: [5] }
];

function deriveChannelFeeFromGrid(gridId) {
  const raw = String(gridId || "").trim().toLowerCase();
  return raw.startsWith("tob") || raw.startsWith("b2b") ? 0.15 : 0.25;
}

// ── Card copy only: numeric dCOGS/NRE values are loaded from /api/rd/cards ──
const CARD_COPY = {
interaction: [
  { id:"voice_basic", n:"语音基础", what:"能听懂指令并用语音回应",
    riskNote:"技术成熟度高，风险可控",
    tiers:{ low:{l:"基础",d:"固定指令，预设回复"}, mid:{l:"标准",d:"日常对话，自然语调"}, high:{l:"旗舰",d:"多方言+情感语调"} } },
  { id:"persona_dialog", n:"多轮对话个性化", what:"记住上下文，越聊越懂你，像朋友一样对话",
    riskNote:"依赖大模型能力，对话质量波动大",
    tiers:{ low:{l:"基础",d:"简单多轮，记住近期话题"}, mid:{l:"标准",d:"个性化风格+长期记忆"}, high:{l:"旗舰",d:"深度个性化，模拟角色性格"} },
    deps:[{tier:"high",type:"需要",target:"cloud_update",tl:"标准",cross:true}] },
  { id:"touch_hug", n:"触摸/拥抱交互增强", what:"感知拥抱和抚摸，做出温暖回应",
    riskNote:"传感器硬件成熟，集成风险低",
    tiers:{ low:{l:"基础",d:"基本触摸感应"}, mid:{l:"标准",d:"多区域触感，不同反应"}, high:{l:"旗舰",d:"全身压力感应+体温变化"} } },
  { id:"music_companion", n:"音乐播放与陪伴", what:"会放音乐、哼唱或陪着孩子练习",
    riskNote:"版权与音频适配需要持续维护",
    tiers:{ low:{l:"基础",d:"固定歌单与简单播控"}, mid:{l:"标准",d:"情境音乐与互动播放"}, high:{l:"旗舰",d:"更丰富内容与情绪联动"} } },
  { id:"visual_expr", n:"视觉表达（OLED/灯效）", what:"通过屏幕表情或灯光变化表达情绪",
    riskNote:"显示模组和动画体验会明显拉高开发复杂度",
    tiers:{ low:{l:"基础",d:"灯效表达"}, mid:{l:"标准",d:"OLED 丰富表情动画"}, high:{l:"旗舰",d:"全彩表情+氛围灯联动"} },
    conflicts:["no_screen"] },
  { id:"style_pack", n:"表达风格包", what:"让机器人在语气、角色和动作上更有个性",
    riskNote:"风格做得好很加分，但打磨周期长",
    tiers:{ low:{l:"基础",d:"少量角色与固定语气"}, mid:{l:"标准",d:"多风格切换+动作脚本"}, high:{l:"旗舰",d:"完整角色包+更强表现力"} } },
  { id:"no_screen", n:"无屏降本（删OLED）", what:"去掉屏幕降成本，改用纯语音+灯光",
    riskNote:"用户体验可能受限，需验证接受度", tag:"降本",
    tiers:{ low:{l:"基础",d:"去屏保留LED"}, mid:{l:"标准",d:"去屏+简化外壳"}, high:{l:"旗舰",d:"极简纯语音方案"} },
    conflicts:["visual_expr"] }
],
perception: [
  { id:"percep_base", n:"基础感知（摄像头/语音）", what:"看到和听到周围环境，识别人和物体",
    riskNote:"硬件方案成熟，但需要稳定标定",
    tiers:{ low:{l:"基础",d:"单摄像头+单麦克风"}, mid:{l:"标准",d:"广角+基础识别"}, high:{l:"旗舰",d:"双目视觉+阵列麦克风"} } },
  { id:"emotion_recog", n:"情绪识别与表情捕捉", what:"读懂表情和语气，判断开心还是难过",
    riskNote:"算法精度不稳定，场景与光线变化影响大",
    tiers:{ low:{l:"基础",d:"基础情绪分类"}, mid:{l:"标准",d:"多模态融合识别"}, high:{l:"旗舰",d:"细粒度识别+趋势追踪"} },
    deps:[{tier:"low",type:"需要",target:"percep_base",tl:"基础"},{tier:"mid",type:"需要",target:"percep_base",tl:"标准"},{tier:"high",type:"需要",target:"percep_base",tl:"旗舰"}] },
  { id:"adaptive_learn", n:"自适应学习（习惯/偏好）", what:"越用越懂你——记住习惯、喜好、作息",
    riskNote:"冷启动体验弱，需要长期数据积累",
    tiers:{ low:{l:"基础",d:"记住常用设置"}, mid:{l:"标准",d:"学习日常规律"}, high:{l:"旗舰",d:"跨场景预测需求"} },
    deps:[{tier:"mid",type:"需要",target:"cloud_update",tl:"标准",cross:true},{tier:"high",type:"需要",target:"cloud_update",tl:"旗舰",cross:true}] },
  { id:"memory_social", n:"社交记忆", what:"记住家庭成员、关系和偏好，互动更像熟人",
    riskNote:"涉及隐私和记忆边界，信任设计很关键",
    tiers:{ low:{l:"基础",d:"记住称呼与基本偏好"}, mid:{l:"标准",d:"记住家庭关系和互动习惯"}, high:{l:"旗舰",d:"跨场景长期记忆"} },
    deps:[{tier:"high",type:"需要",target:"privacy_trust",tl:"标准",cross:true}] }
],
motion: [
  { id:"basic_avoid", n:"基础避障", what:"遇到障碍物会停下或绕开",
    riskNote:"基础方案成熟，但复杂家庭环境仍需测试",
    tiers:{ low:{l:"基础",d:"简单碰撞保护"}, mid:{l:"标准",d:"提前减速绕开"}, high:{l:"旗舰",d:"更平滑避障策略"} } },
  { id:"auto_follow", n:"跟随/伴行模式", what:"像小宠物一样跟着你在家走",
    riskNote:"跟随稳定性和安全边界都不好做",
    tiers:{ low:{l:"基础",d:"简单跟随"}, mid:{l:"标准",d:"视觉跟随伴行"}, high:{l:"旗舰",d:"预测路径伴行"} } },
  { id:"lidar_nav", n:"激光雷达导航", what:"自主在家走动，记住房间布局",
    riskNote:"LiDAR 硬件和 SLAM 调参都很重，投入高",
    tiers:{ low:{l:"基础",d:"简单建图导航"}, mid:{l:"标准",d:"精准房间级导航"}, high:{l:"旗舰",d:"复杂户型与更强鲁棒性"} },
    deps:[{tier:"mid",type:"需要",target:"cloud_update",tl:"标准",cross:true},{tier:"high",type:"需要",target:"cloud_update",tl:"标准",cross:true}] }
],
safety: [
  { id:"privacy_trust", n:"隐私与信任保障", what:"数据加密，用户可控制自己的数据",
    riskNote:"合规要求明确，但不能只做表面开关",
    tiers:{ low:{l:"基础",d:"本地加密存储"}, mid:{l:"标准",d:"端到端加密+权限面板"}, high:{l:"旗舰",d:"更严格可信架构"} } },
  { id:"child_safety", n:"儿童安全", what:"更关注碰撞、防夹、材料与儿童使用风险",
    riskNote:"认证和可靠性测试周期长",
    tiers:{ low:{l:"基础",d:"基础儿童防护"}, mid:{l:"标准",d:"更完整的儿童安全设计"}, high:{l:"旗舰",d:"强化防护与更高认证标准"} } },
  { id:"family_guardian", n:"家庭监护", what:"家长远程查看孩子/老人状态，设置使用边界",
    riskNote:"隐私与监护的平衡很难，过度监控会惹人反感",
    tiers:{ low:{l:"基础",d:"基础远程提醒与边界"}, mid:{l:"标准",d:"远程查看+行为边界"}, high:{l:"旗舰",d:"多角色权限+异常报警"} },
    deps:[{tier:"low",type:"需要",target:"privacy_trust",tl:"基础",cross:true},{tier:"mid",type:"需要",target:"privacy_trust",tl:"标准",cross:true},{tier:"high",type:"需要",target:"privacy_trust",tl:"旗舰",cross:true}] }
],
extend: [
  { id:"cloud_update", n:"云端智能更新（OTA）", what:"自动接收新功能和修复",
    riskNote:"灰度和回滚机制能明显降低线上事故",
    tiers:{ low:{l:"基础",d:"手动更新"}, mid:{l:"标准",d:"自动静默+回滚"}, high:{l:"旗舰",d:"灰度发布+更强遥测"} } },
  { id:"api_iot", n:"API / IoT 联动", what:"连接手机和家里其他设备，做更多场景联动",
    riskNote:"协议兼容和认证测试工作量大",
    tiers:{ low:{l:"基础",d:"少量设备接入"}, mid:{l:"标准",d:"主流平台兼容"}, high:{l:"旗舰",d:"开放 API + 深度联动"} },
    deps:[{tier:"high",type:"需要",target:"privacy_trust",tl:"标准",cross:true}] },
  { id:"edu_content", n:"教育内容", what:"提供更丰富的学习内容、课程和陪练素材",
    riskNote:"内容持续供给和版权都需要长期投入",
    tiers:{ low:{l:"基础",d:"少量固定内容"}, mid:{l:"标准",d:"更系统的内容库"}, high:{l:"旗舰",d:"可持续运营的内容平台"} } }
],
ops: [
  { id:"self_diag", n:"自诊断", what:"机器人能自己发现故障并提示处理",
    riskNote:"投入不大，但对长期可维护性很重要",
    tiers:{ low:{l:"基础",d:"基础错误自检"}, mid:{l:"标准",d:"更系统的故障定位"}, high:{l:"旗舰",d:"硬件+软件联合诊断"} } },
  { id:"remote_monitor", n:"远程监控", what:"远程查看设备状态、异常和运行日志",
    riskNote:"云端监控能省售后，但也要做好权限边界",
    tiers:{ low:{l:"基础",d:"基础状态上报"}, mid:{l:"标准",d:"实时监控+日志分析"}, high:{l:"旗舰",d:"更强告警与远程处置"} } },
  { id:"predictive_maint", n:"预测性维护", what:"在坏掉前就预警，减少突然故障",
    riskNote:"需要长期数据和更多传感器支持，开发周期长",
    tiers:{ low:{l:"基础",d:"简单预警规则"}, mid:{l:"标准",d:"基于数据的预警模型"}, high:{l:"旗舰",d:"更完整的预测维护体系"} } }
]
};
const TI = {low:0,mid:1,high:2};
const TS = ["low","mid","high"];

// GM = (P×(1-f) - V - dCOGS) / P
const calcGM = (dCOGS, price, f, baseCost = 0) => {
  const netRev = price * (1 - f);
  return ((netRev - baseCost - dCOGS) / price) * 100;
};
const GM_FLOOR = 20;
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

const DIM_GROUP_TO_FRONT_ID = {
  interaction_expression: "interaction",
  perception_understanding: "perception",
  mobility_navigation: "motion",
  safety_trust: "safety",
  expand_connect: "extend",
  ops_maintenance: "ops"
};
const EMPTY_CARD_CATALOG = DIMS.reduce((acc, dim) => {
  acc[dim.id] = [];
  return acc;
}, {});
const TIER_LABELS = { low: "基础", mid: "标准", high: "旗舰" };
const CARD_COPY_BY_ID = Object.values(CARD_COPY).flat().reduce((acc, card) => {
  acc[card.id] = card;
  return acc;
}, {});

function buildCardCatalog(rdCards) {
  const next = DIMS.reduce((acc, dim) => {
    acc[dim.id] = [];
    return acc;
  }, {});
  (Array.isArray(rdCards?.groups) ? rdCards.groups : []).forEach((group) => {
    const dimId = DIM_GROUP_TO_FRONT_ID[String(group?.group_id || "").trim()];
    if (!dimId) return;
    (Array.isArray(group?.capabilities) ? group.capabilities : []).forEach((cap) => {
      const backendId = String(cap?.cap_id || cap?.id || "").trim();
      if (!backendId) return;
      const id = BACK_TO_FRONT_ID[backendId] || backendId;
      const copy = CARD_COPY_BY_ID[id] || {};
      const tiers = TS.reduce((acc, tierId) => {
        const sourceTier = cap?.tiers?.[tierId] || {};
        const copyTier = copy?.tiers?.[tierId] || {};
        acc[tierId] = {
          l: copyTier.l || TIER_LABELS[tierId],
          d: copyTier.d || String(sourceTier.description || sourceTier.desc || ""),
          cost: Number(sourceTier.dCOGS || 0),
          nre: Number(sourceTier.nre ?? cap.nre ?? 0)
        };
        return acc;
      }, {});
      next[dimId].push({
        ...copy,
        id,
        backendId,
        n: copy.n || cap.name || backendId,
        what: copy.what || String(cap.what || cap.description || ""),
        nreDesc: String(cap.nre_desc || copy.nreDesc || ""),
        riskNote: copy.riskNote || String(cap.risk_note || cap.risk || ""),
        tiers
      });
    });
  });
  return next;
}

function calcCostFromCatalog(s, cardCatalog) {
  let cost = 0;
  let nreWan = 0;
  let cnt = 0;
  const allCards = Object.values(cardCatalog || {}).flat();
  Object.entries(s || {}).forEach(([id, t]) => {
    const c = allCards.find((card) => card.id === id);
    const tier = c?.tiers?.[t];
    if (c && tier) {
      cost += Number(tier.cost || 0);
      nreWan += Number(tier.nre || 0);
      cnt += 1;
    }
  });
  return { cost, nreWan, cnt };
}

function formatSignedCurrency(value) {
  return formatSignedYuan(value);
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
  if (teamStatus === "R2_REVIEW") return 1;
  if (teamStatus === "R2_INTERVIEWING") return 1;
  if (teamStatus === "R2_INDIVIDUAL_CARDS") return 2;
  if (teamStatus === "R2_TEAM_MERGE") return 3;
  if (teamStatus === "R2_TEAM_DISCUSSION") return 4;
  if (teamStatus === "R2_SUBMITTED") return 5;
  return 0;
}

function hasUnlockedRound2Cards({
  interviewMode,
  memberState,
  personaChoice
}) {
  const mode = String(interviewMode || "").trim().toLowerCase() === "live" ? "live" : "summary";
  if (mode === "live") {
    return Number(memberState?.completedInterviews || memberState?.completed_interviews || 0) >= 2
      || memberState?.card_status === "submitted";
  }
  return Boolean(String(personaChoice?.summary_text || "").trim())
    || memberState?.card_status === "submitted";
}

function getRound2NarrativeStageIndex(step) {
  if (step >= 5) return 3;
  if (step >= 4) return 2;
  if (step >= 2) return 1;
  return 0;
}

function getRound2NarrativeTargetStep(stage, currentStep) {
  const available = (Array.isArray(stage?.steps) ? stage.steps : []).filter((step) => step <= currentStep);
  if (!available.length) return null;
  return available[available.length - 1];
}

function teamStatusNotice(teamStatus) {
  if (teamStatus === "R2_REVIEW") return "系统已同步到 Round 2 放行状态";
  if (teamStatus === "R2_INTERVIEWING") return "系统已同步到客户调研阶段";
  if (teamStatus === "R2_INDIVIDUAL_CARDS") return "系统已同步到产品研发阶段";
  if (teamStatus === "R2_TEAM_MERGE") return "系统已推进到产品研发阶段";
  if (teamStatus === "R2_TEAM_DISCUSSION") return "系统已推进到定价发布阶段";
  if (teamStatus === "R2_SUBMITTED") return "系统已同步到经营复盘阶段";
  return "系统已同步到最新阶段";
}

function teamStatusLabel(teamStatus) {
  if (teamStatus === "R2_REVIEW") return "Round 2 放行阶段";
  if (teamStatus === "R2_INTERVIEWING") return "客户调研阶段";
  if (teamStatus === "R2_INDIVIDUAL_CARDS") return "产品研发阶段";
  if (teamStatus === "R2_TEAM_MERGE") return "产品研发阶段";
  if (teamStatus === "R2_TEAM_DISCUSSION") return "定价发布阶段";
  if (teamStatus === "R2_SUBMITTED") return "经营复盘阶段";
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

function parseFiniteNumberOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function parsePositiveNumberOrNull(value) {
  const num = parseFiniteNumberOrNull(value);
  return num != null && num > 0 ? num : null;
}

function normalizePricingContext(...sources) {
  for (const src of sources) {
    const ctx = src?.pricing_context || src;
    if (!ctx || typeof ctx !== "object") continue;
    const min = parsePositiveNumberOrNull(ctx.price_min);
    const max = parsePositiveNumberOrNull(ctx.price_max);
    if (min == null || max == null || max <= min) continue;
    const step = parsePositiveNumberOrNull(ctx.price_step) || 100;
    const defaultPrice = parsePositiveNumberOrNull(ctx.default_price)
      || parsePositiveNumberOrNull(ctx.P)
      || Math.round((min + max) / 2 / step) * step;
    const fixedBaseWan = parseFiniteNumberOrNull(ctx.fixed_base_wan);
    const fixedBase = parseFiniteNumberOrNull(ctx.fixed_base);
    const cogsBase = parseFiniteNumberOrNull(ctx.COGSbase);
    return {
      price_min: min,
      price_max: max,
      price_step: step,
      default_price: Math.max(min, Math.min(max, defaultPrice)),
      fixed_base_wan: fixedBaseWan,
      fixed_base: fixedBase,
      COGSbase: cogsBase
    };
  }
  return null;
}

function clampPriceToContext(price, pricingContext) {
  const parsed = parsePositiveNumberOrNull(price);
  if (parsed == null) return parsePositiveNumberOrNull(pricingContext?.default_price) || 0;
  const min = parsePositiveNumberOrNull(pricingContext?.price_min);
  const max = parsePositiveNumberOrNull(pricingContext?.price_max);
  if (min == null || max == null) return parsed;
  return Math.max(min, Math.min(max, parsed));
}

function buildRadarFromSelections(sels, cardCatalog = EMPTY_CARD_CATALOG) {
  return DIMS.reduce((acc, dim) => {
    const cards = cardCatalog[dim.id] || [];
    const total = cards.reduce((sum, card) => {
      const tier = sels[card.id];
      return tier ? sum + TI[tier] + 1 : sum;
    }, 0);
    acc[dim.id] = Number(clamp(4 + total, 1, 9).toFixed(1));
    return acc;
  }, {});
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
  const tagText = (Array.isArray(result.tags) ? result.tags : [])
    .map((item) => String(item?.tag || "").trim())
    .filter(Boolean)
    .slice(0, 4)
    .join("、");
  return tagText ? `访谈关键词包括 ${tagText}。` : "";
}

function isStudentMergedInterviewReady(mergeData) {
  const mergedInterview = mergeData?.mergedInterview;
  if (!mergedInterview || typeof mergedInterview !== "object") return false;
  if (String(mergedInterview.summaryText || mergedInterview.summary_text || "").trim()) return true;
  if (String(mergedInterview.selectedArchetypeId || mergedInterview.selected_archetype_id || "").trim()) return true;
  if (String(mergeData?.selected_persona_id || mergeData?.selectedPersonaId || "").trim()) return true;
  if (Array.isArray(mergedInterview.tags) && mergedInterview.tags.length > 0) return true;
  return Number.isFinite(Number(mergedInterview.evi));
}

function renderInlineBold(text) {
  const parts = String(text || "").split(/(\*\*[^*]+\*\*)/g);
  return parts.map((part, index) => {
    if (part.startsWith("**") && part.endsWith("**")) {
      return <strong key={index}>{part.slice(2, -2)}</strong>;
    }
    return <span key={index}>{part}</span>;
  });
}

function renderReportText(text) {
  return String(text || "").split(/\r?\n/).map((line, index) => {
    const trimmed = line.trim();
    if (!trimmed) {
      return <div key={index} style={{height:10}} />;
    }
    if (/^━+$/.test(trimmed)) {
      return (
        <div key={index} style={{color:"#cbd5e1",letterSpacing:1,textAlign:"center",lineHeight:1.4}}>
          {trimmed}
        </div>
      );
    }
    if (trimmed.startsWith("▎")) {
      return (
        <div key={index} style={{borderLeft:"4px solid #1a5c3a",padding:"4px 0 4px 10px",margin:"10px 0 6px",fontWeight:800,color:"#111827",background:"#f8fafc"}}>
          {renderInlineBold(trimmed.replace(/^▎\s*/, ""))}
        </div>
      );
    }
    return (
      <div key={index} style={{margin:"0 0 8px"}}>
        {renderInlineBold(line)}
      </div>
    );
  });
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
    let sentence = `为${who}，在${pain}的场景下，这款 AI 宠物机器人通过${how}创造更好的结果。`;
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

function firstFiniteNumber(...values) {
  for (const value of values) {
    if (value == null || value === "") continue;
    const num = Number(value);
    if (Number.isFinite(num)) return num;
  }
  return null;
}

function formatRecapComparison(recap) {
  const src = recap && typeof recap === "object" ? recap : {};
  const round1Sam = firstFiniteNumber(src.round1_sam_scaled, src.round1_sam);
  const round1WtpAdj = firstFiniteNumber(src.round1_wtp_adj_scaled, src.round1_wtp_adj);
  const matchedSam = firstFiniteNumber(src.matched_grid_sam_scaled, src.matched_grid_sam);
  const matchedWtpRef = firstFiniteNumber(src.matched_grid_wtp_ref_scaled, src.matched_grid_wtp_ref);
  const matchedWtpMean = firstFiniteNumber(src.matched_grid_wtp_mean_scaled, src.matched_grid_wtp_mean);
  return {
    round1: {
      gridLabel: String(src.round1_grid_label || formatGridLabel(src.final_grid_id) || "待揭示").trim() || "待揭示",
      sam: round1Sam != null ? `${Math.round(round1Sam).toLocaleString()} 亿` : "待揭示",
      wtp: round1WtpAdj != null ? formatYuan(round1WtpAdj) : "待揭示"
    },
    round2: {
      gridLabel: String(src.matched_grid_label || "待揭示").trim() || "待揭示",
      sam: matchedSam != null ? `${Math.round(matchedSam).toLocaleString()} 亿` : "待揭示",
      wtp: matchedWtpRef != null ? formatYuan(matchedWtpRef) : "待揭示",
      detail: matchedWtpMean != null
        ? `WTPmean ${formatYuan(matchedWtpMean)}`
        : ""
    },
    alignmentLabel: String(src.execution_alignment_label || "").trim(),
    alignmentDetail: src.execution_alignment === "aligned"
      ? "你们实际做出来的产品，和 Round 1 说要做的市场落在同一格。"
      : (src.execution_alignment === "shifted"
        ? "你们实际做出来的产品更贴近另一格，这更适合作为课堂复盘讨论点，不代表简单对错。"
        : "")
  };
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
  const [teamPrice, setTeamPrice] = useState(0);
  const [submitted, setSubmitted] = useState(false);
  const [teamId, setTeamId] = useState("");
  const [memberId, setMemberId] = useState("");
  const [sessionId, setSessionId] = useState("default");
  const [teamInfo, setTeamInfo] = useState(null);
  const [teamRecap, setTeamRecap] = useState(null);
  const [round2PricingContext, setRound2PricingContext] = useState(null);
  const [sessionConfig, setSessionConfig] = useState({ reveal_r1_results: false, hold_before_r2: false, interview_mode: "summary" });
  const [interviewMode, setInterviewMode] = useState("summary");
  const [personaReports, setPersonaReports] = useState([]);
  const [availableSummaryReports, setAvailableSummaryReports] = useState([]);
  const [defaultSummaryReportIndex, setDefaultSummaryReportIndex] = useState(0);
  const [activeSummaryReportIndex, setActiveSummaryReportIndex] = useState(null);
  const [summaryReadingStatus, setSummaryReadingStatus] = useState({
    total_reports: 0,
    team_viewed_count: 0,
    team_viewed_personas: [],
    my_viewed_personas: [],
    my_viewed: [],
    members: [],
    completed_count: 0,
    all_completed: false,
    my_reading_status: "not_started"
  });
  const [summaryReadingSubStep, setSummaryReadingSubStep] = useState(SUMMARY_READING_INDIVIDUAL);
  const [selectedPersonaChoice, setSelectedPersonaChoice] = useState(null);
  const [isLoadingPersonaReports, setIsLoadingPersonaReports] = useState(false);
  const [isLoadingSummaryReport, setIsLoadingSummaryReport] = useState(false);
  const [isLoadingReadingStatus, setIsLoadingReadingStatus] = useState(false);
  const [isFreezingSummary, setIsFreezingSummary] = useState(false);
  const [summaryReportError, setSummaryReportError] = useState("");
  const [serverSelections, setServerSelections] = useState(null);
  const [isLoadingContext, setIsLoadingContext] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [submitError, setSubmitError] = useState("");
  const [isSubmittingFinal, setIsSubmittingFinal] = useState(false);
  const [teamStatus, setTeamStatus] = useState("");
  const [memberState, setMemberState] = useState(null);
  const [round2Members, setRound2Members] = useState([]);
  const [leaderMemberId, setLeaderMemberId] = useState("");
  const [leaderName, setLeaderName] = useState("");
  const [isLeader, setIsLeader] = useState(false);
  const [forceAdvanceGate, setForceAdvanceGate] = useState("");
  const [forceAdvanceSubmittedAt, setForceAdvanceSubmittedAt] = useState({ reading: 0, cards: 0 });
  const [forceAdvanceNow, setForceAdvanceNow] = useState(() => Date.now());
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
  const [interviewRetryAction, setInterviewRetryAction] = useState(null);
  const [interviewRestoreChecked, setInterviewRestoreChecked] = useState(false);
  const [isStartingInterview, setIsStartingInterview] = useState(false);
  const [isSendingInterview, setIsSendingInterview] = useState(false);
  const [isSubmittingIndividual, setIsSubmittingIndividual] = useState(false);
  const [individualSubmitError, setIndividualSubmitError] = useState("");
  const [isResearchDrawerOpen, setIsResearchDrawerOpen] = useState(false);
  const [mergeData, setMergeData] = useState(null);
  const [mergeError, setMergeError] = useState("");
  const [teamDraftSelections, setTeamDraftSelections] = useState({});
  const [teamResultSnapshot, setTeamResultSnapshot] = useState(null);
  const [rdCards, setRdCards] = useState(null);
  const [rdCardsError, setRdCardsError] = useState("");
  const interviewInputRef = useRef(null);
  const round2DraftTouchedRef = useRef(false);
  const previousStatusRef = useRef("");
  const previousStepRef = useRef(0);
  const systemNoticeTimerRef = useRef(null);
  const interviewStartGateRef = useRef({ memberId: "", startedAt: 0 });
  const summaryReportInitializedRef = useRef(false);
  const selectedPersonaChoiceRef = useRef(null);
  const commitSelectedPersonaChoice = (choice) => {
    selectedPersonaChoiceRef.current = choice || null;
    setSelectedPersonaChoice(choice || null);
  };

  const isTeamMode = Boolean(teamId);
  const isSummaryMode = interviewMode !== "live";
  const cardCatalog = useMemo(() => buildCardCatalog(rdCards), [rdCards]);
  const cardsLoaded = Object.values(cardCatalog).some((cards) => cards.length > 0);
  const allCards = useMemo(() => Object.values(cardCatalog).flat(), [cardCatalog]);
  const findCard = useCallback((id) => allCards.find((card) => card.id === id), [allCards]);

  useEffect(() => {
    let canceled = false;
    const controller = new AbortController();
    getRdCards({ signal: controller.signal })
      .then((out) => {
        if (canceled) return;
        setRdCards(out || null);
        setRdCardsError("");
      })
      .catch((error) => {
        if (error?.name === "AbortError" || canceled) return;
        setRdCardsError(error?.message || "研发能力卡数据加载失败");
      });
    return () => {
      canceled = true;
      controller.abort();
    };
  }, []);

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
        const initialPricingContext = normalizePricingContext(stateRes, recapRes);
        if (initialPricingContext) {
          setRound2PricingContext(initialPricingContext);
        }
        setSessionConfig(stateRes?.session_config || { reveal_r1_results: false, hold_before_r2: false, interview_mode: "summary" });
        setMemberState(stateRes?.member || null);
        setRound2Members(Array.isArray(stateRes?.members) ? stateRes.members : []);
        setTeamStatus(String(stateRes?.team_status || ""));
        setInterviewMode(String(stateRes?.session_config?.interview_mode || "summary").trim().toLowerCase() === "live" ? "live" : "summary");
        const initialChoice = stateRes?.persona_choice || null;
        const initialReports = Array.isArray(stateRes?.persona_reports) ? stateRes.persona_reports : [];
        const initialAvailableReports = Array.isArray(stateRes?.available_reports) ? stateRes.available_reports : [];
        const initialDefaultReportIndex = Number.isFinite(Number(stateRes?.default_report_index))
          ? Number(stateRes.default_report_index)
          : 0;
        commitSelectedPersonaChoice(initialChoice);
        setAvailableSummaryReports(initialAvailableReports);
        setDefaultSummaryReportIndex(initialDefaultReportIndex);
        setPersonaReports(initialReports);
        if (initialChoice?.summary_text) {
          const frozenIndex = Number.isFinite(Number(initialReports[0]?.report_index))
            ? Number(initialReports[0].report_index)
            : initialDefaultReportIndex;
          setActiveSummaryReportIndex(frozenIndex);
          summaryReportInitializedRef.current = true;
        } else {
          setActiveSummaryReportIndex(initialDefaultReportIndex);
          summaryReportInitializedRef.current = false;
        }
        setLeaderMemberId(String(stateRes?.leader_member_id || ""));
        setLeaderName(String(stateRes?.leader_name || ""));
        setIsLeader(Boolean(stateRes?.is_leader));
        if (stateRes?.team_draft && !snapshotRes?.submission) {
          const mappedDraft = selectionsToMap(stateRes.team_draft.selections);
          setTeamDraftSelections(mappedDraft);
          const draftPrice = parsePositiveNumberOrNull(stateRes?.team_draft?.price);
          if (draftPrice != null) {
            setTeamPrice(clampPriceToContext(draftPrice, initialPricingContext));
          }
        }

        if (snapshotRes?.submission) {
          const mappedSelections = selectionsToMap(snapshotRes.submission.selections);
          setServerSelections(mappedSelections);
          setTeamDraftSelections(mappedSelections);
          setTeamResultSnapshot(snapshotRes.result || null);
          const submittedPrice = parsePositiveNumberOrNull(snapshotRes?.submission?.price);
          if (submittedPrice != null) {
            setTeamPrice(clampPriceToContext(submittedPrice, initialPricingContext));
          }
          setStep(5);
          setSubmitted(true);
        } else {
          const recapPrice = parsePositiveNumberOrNull(initialPricingContext?.default_price)
            || parsePositiveNumberOrNull(recapRes?.P);
          if (recapPrice != null) {
            setTeamPrice(clampPriceToContext(recapPrice, initialPricingContext));
          }
        }
        if (stateRes?.team_status && !snapshotRes?.submission) {
          const teamStep = mapTeamStatusToStep(stateRes.team_status);
          const entryInterviewMode = String(stateRes?.session_config?.interview_mode || "summary").trim().toLowerCase();
          const cardsUnlocked = hasUnlockedRound2Cards({
            interviewMode: entryInterviewMode,
            memberState: stateRes?.member_state,
            personaChoice: stateRes?.persona_choice
          });
          const safeStep = (teamStep >= 2 && !cardsUnlocked) ? 1 : teamStep;
          setStep((prev) => Math.max(prev, safeStep));
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
    selectedPersonaChoiceRef.current = selectedPersonaChoice;
  }, [selectedPersonaChoice]);

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
        const data = await getRound2State(teamId, memberId, { signal: currentController.signal, lite: true });
        if (canceled) return;

        const nextStatus = String(data?.team_status || "");
        setMemberState(data?.member || null);
        setRound2Members(Array.isArray(data?.members) ? data.members : []);
        setSessionConfig(data?.session_config || { reveal_r1_results: false, hold_before_r2: false, interview_mode: "summary" });
        const nextPricingContext = normalizePricingContext(data);
        if (nextPricingContext) {
          setRound2PricingContext(nextPricingContext);
        }
        setInterviewMode(String(data?.session_config?.interview_mode || "summary").trim().toLowerCase() === "live" ? "live" : "summary");
        const hasPersonaChoice = Object.prototype.hasOwnProperty.call(data || {}, "persona_choice");
        const nextChoice = hasPersonaChoice ? (data?.persona_choice || null) : selectedPersonaChoiceRef.current;
        commitSelectedPersonaChoice(nextChoice);
        if (Array.isArray(data?.available_reports)) {
          setAvailableSummaryReports(data.available_reports);
        }
        if (Number.isFinite(Number(data?.default_report_index))) {
          setDefaultSummaryReportIndex(Number(data.default_report_index));
        }
        if (nextChoice?.summary_text) {
          if (Array.isArray(data?.persona_reports)) {
            const nextReports = data.persona_reports;
            setPersonaReports(nextReports);
            const frozenIndex = Number.isFinite(Number(nextReports[0]?.report_index))
              ? Number(nextReports[0].report_index)
              : (Number.isFinite(Number(data?.default_report_index)) ? Number(data.default_report_index) : 0);
            setActiveSummaryReportIndex(frozenIndex);
            summaryReportInitializedRef.current = true;
          }
        }
        setLeaderMemberId(String(data?.leader_member_id || ""));
        setLeaderName(String(data?.leader_name || ""));
        setIsLeader(Boolean(data?.is_leader));
        if (data?.team_draft && !submitted) {
          const mappedDraft = selectionsToMap(data.team_draft.selections);
          if (!round2DraftTouchedRef.current || !data?.is_leader) {
            setTeamDraftSelections(mappedDraft);
            const draftPrice = parsePositiveNumberOrNull(data?.team_draft?.price);
            if (draftPrice != null) {
              setTeamPrice(clampPriceToContext(draftPrice, nextPricingContext));
            }
          }
        }
        if (!nextStatus) return;

        setTeamStatus(nextStatus);
        const nextStep = mapTeamStatusToStep(nextStatus);
        const prevStatus = previousStatusRef.current;
        const prevStep = previousStepRef.current;
        const nextInterviewMode = String(data?.session_config?.interview_mode || "summary").trim().toLowerCase();
        const cardsUnlocked = hasUnlockedRound2Cards({
          interviewMode: nextInterviewMode,
          memberState: data?.member_state,
          personaChoice: nextChoice
        });

        setSubmitted(nextStatus === "R2_SUBMITTED");
        if (nextStatus !== "R2_SUBMITTED") {
          setTeamResultSnapshot(null);
          setServerSelections(null);
        }

        setStep((prev) => {
          if (nextStatus === "R2_SUBMITTED") return 5;
          if (nextStep >= 2 && !cardsUnlocked) return Math.min(prev, 1);
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

  useEffect(() => {
    if (interviewMode === "live") return;
    setIsLoadingPersonaReports(Boolean(isLoadingContext || isLoadingSummaryReport));
  }, [interviewMode, isLoadingContext, isLoadingSummaryReport]);

  const loadSummaryReadingStatus = useCallback(async (options = {}) => {
    if (!teamId || !memberId || !isSummaryMode) return null;
    const silent = options.silent === true;
    if (!silent) {
      setIsLoadingReadingStatus(true);
    }
    try {
      const out = await getRound2TeamReadingStatus(teamId, memberId, sessionId, options);
      const nextStatus = {
        total_reports: Number(out?.total_reports || 0),
        team_viewed_count: Number(out?.team_viewed_count || 0),
        team_viewed_personas: Array.isArray(out?.team_viewed_personas) ? out.team_viewed_personas : [],
        my_viewed_personas: Array.isArray(out?.my_viewed_personas) ? out.my_viewed_personas : [],
        my_viewed: Array.isArray(out?.my_viewed) ? out.my_viewed : (Array.isArray(out?.my_viewed_personas) ? out.my_viewed_personas : []),
        members: Array.isArray(out?.members) ? out.members : [],
        completed_count: Number(out?.completed_count || 0),
        all_completed: out?.all_completed === true,
        my_reading_status: String(out?.my_reading_status || "not_started")
      };
      setSummaryReadingStatus({
        ...nextStatus
      });
      if (nextStatus.my_reading_status === "completed" || nextStatus.all_completed) {
        setSummaryReadingSubStep(SUMMARY_READING_TEAM_SUMMARY);
      }
      return out;
    } finally {
      if (!silent) {
        setIsLoadingReadingStatus(false);
      }
    }
  }, [isSummaryMode, memberId, sessionId, teamId]);

  const loadSummaryReport = useCallback(async (reportIndex, options = {}) => {
    if (!teamId || !memberId || !isSummaryMode) return null;
    const normalizedIndex = Number(reportIndex);
    if (!Number.isInteger(normalizedIndex) || normalizedIndex < 0) return null;
    const silent = options.silent === true;
    if (!silent) {
      setIsLoadingSummaryReport(true);
      setSummaryReportError("");
    }
    try {
      const out = await getRound2PersonaReport(teamId, memberId, normalizedIndex, sessionId, options);
      const report = out?.report || null;
      setPersonaReports(report ? [report] : []);
      setActiveSummaryReportIndex(Number.isFinite(Number(report?.report_index)) ? Number(report.report_index) : normalizedIndex);
      summaryReportInitializedRef.current = true;
      await loadSummaryReadingStatus({ silent: true });
      return out;
    } catch (err) {
      if (!silent) {
        setSummaryReportError(err.message || "客户调研报告加载失败");
      }
      throw err;
    } finally {
      if (!silent) {
        setIsLoadingSummaryReport(false);
      }
    }
  }, [isSummaryMode, loadSummaryReadingStatus, memberId, sessionId, teamId]);

  useEffect(() => {
    if (!isSummaryMode || !teamId || !memberId) return undefined;
    let canceled = false;
    const controller = new AbortController();
    const tick = async () => {
      try {
        await loadSummaryReadingStatus({ signal: controller.signal, silent: true });
      } catch (error) {
        if (error?.name === "AbortError") return;
        if (!canceled) {
          setSummaryReportError((prev) => prev || error.message || "阅读进度加载失败");
        }
      }
    };
    tick();
    const timer = window.setInterval(tick, 3000);
    return () => {
      canceled = true;
      controller.abort();
      window.clearInterval(timer);
    };
  }, [isSummaryMode, loadSummaryReadingStatus, memberId, teamId]);

  useEffect(() => {
    if (!isSummaryMode || !teamId || !memberId) return undefined;
    if (selectedPersonaChoice?.summary_text) return undefined;
    const targetIndex = Number.isInteger(Number(activeSummaryReportIndex))
      ? Number(activeSummaryReportIndex)
      : (Number.isInteger(Number(defaultSummaryReportIndex)) ? Number(defaultSummaryReportIndex) : null);
    if (targetIndex == null || targetIndex < 0) return undefined;
    if (summaryReportInitializedRef.current && Number(activeSummaryReportIndex) === targetIndex && personaReports.length) {
      return undefined;
    }
    const controller = new AbortController();
    loadSummaryReport(targetIndex, { signal: controller.signal }).catch((error) => {
      if (error?.name === "AbortError") return;
    });
    return () => controller.abort();
  }, [
    activeSummaryReportIndex,
    defaultSummaryReportIndex,
    isSummaryMode,
    loadSummaryReport,
    memberId,
    personaReports.length,
    selectedPersonaChoice?.summary_text,
    teamId
  ]);

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

  const indCalc = useMemo(() => calcCostFromCatalog(sel, cardCatalog), [sel, cardCatalog]);
  const teamCalc = useMemo(() => calcCostFromCatalog(teamSel, cardCatalog), [teamSel, cardCatalog]);
  const effectivePricingContext = useMemo(
    () => normalizePricingContext(round2PricingContext, mergeData, teamRecap),
    [round2PricingContext, mergeData, teamRecap]
  );
  const priceMin = parsePositiveNumberOrNull(effectivePricingContext?.price_min) || 0;
  const priceMax = parsePositiveNumberOrNull(effectivePricingContext?.price_max) || 0;
  const priceStep = parsePositiveNumberOrNull(effectivePricingContext?.price_step) || 100;
  const fallbackPrice = parsePositiveNumberOrNull(effectivePricingContext?.default_price) || 0;
  const priceSliderReady = priceMin > 0 && priceMax > priceMin;
  const baseCost = Number(teamRecap?.COGSbase || effectivePricingContext?.COGSbase || 0);
  const channelFee = Number(
    teamRecap?.f != null
      ? teamRecap.f
      : deriveChannelFeeFromGrid(teamInfo?.final_grid_id || teamRecap?.final_grid_id || "")
  );
  const teamUnitCost = baseCost + teamCalc.cost;
  const fixedBaseWan = Number(effectivePricingContext?.fixed_base_wan ?? teamRecap?.fixed_base_wan ?? 0);
  const fixedBase = Number(effectivePricingContext?.fixed_base ?? teamRecap?.fixed_base ?? fixedBaseWan * 10000);
  const teamFixedCost = fixedBase + teamCalc.nreWan * 10000;
  const teamFixedCostWan = fixedBaseWan + teamCalc.nreWan;
  const previewUnitMargin = Math.round((teamPrice || fallbackPrice) * (1 - channelFee) - teamUnitCost);
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
  const recapVpC = normalizeScoreValue(teamRecap?.vp_scores?.C);
  const recapVpG = normalizeScoreValue(teamRecap?.vp_scores?.G);
  const recapVpE = normalizeScoreValue(teamRecap?.vp_scores?.E);
  const hasRound1VpBreakdown = resultVpScore != null && recapVpC != null && recapVpG != null && recapVpE != null;
  const round1ScoresRevealed = hasRound1VpBreakdown;
  const resultFeedbackText = String(teamRecap?.vp_feedback || "").trim();
  const wtpFinalPct = Number.isFinite(Number(teamRecap?.wtp_breakdown?.final_pct))
    ? Number(teamRecap.wtp_breakdown.final_pct)
    : 0;
  const wtpBasePct = Number.isFinite(Number(teamRecap?.wtp_breakdown?.base_pct))
    ? Number(teamRecap.wtp_breakdown.base_pct)
    : 0;
  const wtpJinangDeltaPct = Number.isFinite(Number(teamRecap?.wtp_breakdown?.jinang_delta_pct))
    ? Number(teamRecap.wtp_breakdown.jinang_delta_pct)
    : Math.round(Number(teamRecap?.wtp_breakdown?.market_jinang_bonus_total ?? teamRecap?.wtp_breakdown?.jinang_bonus ?? 0) * 100);
  const matchedJinangCount = Number(teamRecap?.jinang_summary?.matched_count || 0);
  const matchedMarketJinangCount = Number(teamRecap?.jinang_summary?.matched_market_count || 0);
  const matchedTechJinangCount = Number(teamRecap?.jinang_summary?.matched_tech_count || 0);
  const totalJinangCount = Number(teamRecap?.jinang_summary?.total_count || 0);
  const resultMarketJinang = teamRecap?.jinang_market || null;
  const resultTechJinang = teamRecap?.jinang_tech || null;
  const resultMarketJinangBonusPct = Number.isFinite(Number(resultMarketJinang?.bonus))
    ? Math.round(Number(resultMarketJinang.bonus) * 100)
    : 0;
  const recapComparison = useMemo(
    () => formatRecapComparison(teamRecap),
    [teamRecap]
  );
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
  useEffect(() => {
    if (!priceSliderReady || submitted) return;
    setTeamPrice((prev) => clampPriceToContext(prev, effectivePricingContext));
  }, [effectivePricingContext, priceSliderReady, submitted]);
  const interviewDimensionGuide = useMemo(
    () => buildDimensionGuideItems(memberDims),
    [memberDims]
  );
  const activeInterviewPersona = interviewPersonas[0] || null;
  const activeSummaryReport = useMemo(() => {
    const source = Array.isArray(personaReports) ? personaReports : [];
    return source[0] || null;
  }, [personaReports]);
  const summaryReportReady = Boolean(selectedPersonaChoice?.summary_text || activeSummaryReport?.summary_text);
  const myViewedPersonaIds = useMemo(
    () => Array.isArray(summaryReadingStatus?.my_viewed)
      ? summaryReadingStatus.my_viewed
      : (Array.isArray(summaryReadingStatus?.my_viewed_personas) ? summaryReadingStatus.my_viewed_personas : []),
    [summaryReadingStatus]
  );
  const nextUnreadSummaryReport = useMemo(() => {
    const reports = Array.isArray(availableSummaryReports) ? availableSummaryReports : [];
    if (!reports.length) return null;
    const currentIndex = Number.isFinite(Number(activeSummaryReportIndex)) ? Number(activeSummaryReportIndex) : Number(defaultSummaryReportIndex || 0);
    const startPosition = Math.max(0, reports.findIndex((item) => Number(item?.report_index) === currentIndex));
    const viewedSet = new Set(myViewedPersonaIds.map((item) => String(item || "").trim()));
    for (let offset = 1; offset <= reports.length; offset += 1) {
      const report = reports[(startPosition + offset) % reports.length];
      const personaId = String(report?.persona_id || "").trim();
      if (personaId && !viewedSet.has(personaId)) {
        return report;
      }
    }
    return null;
  }, [activeSummaryReportIndex, availableSummaryReports, defaultSummaryReportIndex, myViewedPersonaIds]);
  const summaryProgressLabel = useMemo(() => {
    const total = Number(summaryReadingStatus?.total_reports || availableSummaryReports.length || 3);
    const viewed = myViewedPersonaIds.length;
    return `你已阅读 ${viewed}/${total} 份`;
  }, [availableSummaryReports.length, summaryReadingStatus]);
  const summaryTeamCoverageLabel = useMemo(() => {
    const total = Number(summaryReadingStatus?.total_reports || availableSummaryReports.length || 3);
    const viewed = Number(summaryReadingStatus?.team_viewed_count || 0);
    return `团队共覆盖 ${viewed}/${total} 位受访者`;
  }, [availableSummaryReports.length, summaryReadingStatus]);
  const summaryReadingMembers = useMemo(
    () => Array.isArray(summaryReadingStatus?.members) ? summaryReadingStatus.members : [],
    [summaryReadingStatus]
  );
  const summaryAllMembersDone = summaryReadingStatus?.all_completed === true;
  const pendingSummaryReadingMembers = useMemo(
    () => summaryReadingMembers.filter((member) => String(member?.reading_status || "") !== "completed"),
    [summaryReadingMembers]
  );
  const pendingCardMembers = useMemo(
    () => (Array.isArray(round2Members) ? round2Members : [])
      .filter((member) => String(member?.card_status || member?.cardStatus || "") !== "submitted")
      .map((member) => ({ id: member.id, name: member.name || member.member_name || member.id })),
    [round2Members]
  );
  const submittedCardMemberCount = useMemo(
    () => (Array.isArray(round2Members) ? round2Members : [])
      .filter((member) => String(member?.card_status || member?.cardStatus || "") === "submitted").length,
    [round2Members]
  );
  const mySummaryReadingDone = String(summaryReadingStatus?.my_reading_status || "") === "completed";
  const myCardSelectionSubmitted = String(memberState?.card_status || memberState?.cardStatus || "") === "submitted";
  const readingForceRemainingMs = getForceAdvanceRemainingMs(forceAdvanceSubmittedAt.reading, forceAdvanceNow);
  const cardsForceRemainingMs = getForceAdvanceRemainingMs(forceAdvanceSubmittedAt.cards, forceAdvanceNow);
  const canShowForceAdvanceReading =
    isLeader
    && mySummaryReadingDone
    && summaryReadingSubStep === SUMMARY_READING_TEAM_SUMMARY
    && !summaryAllMembersDone
    && pendingSummaryReadingMembers.length > 0
    && readingForceRemainingMs <= 0;
  const canShowForceAdvanceCards =
    isLeader
    && myCardSelectionSubmitted
    && teamStatus === "R2_INDIVIDUAL_CARDS"
    && pendingCardMembers.length > 0
    && cardsForceRemainingMs <= 0;
  const selectedPersonaSummaryText = String(
    selectedPersonaChoice?.summary_text
      || activeSummaryReport?.summary_text
      || ""
  ).trim();
  const summaryReportTitle = useMemo(() => {
    const lines = selectedPersonaSummaryText.split("\n").map((line) => line.trim()).filter(Boolean);
    if (lines[0] === "━━━━━━━━━━━━━━━━━━━━" && lines[2]) return lines[2];
    return lines[0] || "客户调研报告";
  }, [selectedPersonaSummaryText]);
  const activeInterviewPersonaIntro = useMemo(
    () => buildPersonaIntro(activeInterviewPersona),
    [activeInterviewPersona]
  );

  useEffect(() => {
    const shouldTick =
      (isLeader && mySummaryReadingDone && pendingSummaryReadingMembers.length > 0 && readingForceRemainingMs > 0)
      || (isLeader && myCardSelectionSubmitted && pendingCardMembers.length > 0 && cardsForceRemainingMs > 0);
    if (!shouldTick) return undefined;
    const timer = window.setInterval(() => {
      setForceAdvanceNow(Date.now());
    }, 1000);
    return () => window.clearInterval(timer);
  }, [
    cardsForceRemainingMs,
    isLeader,
    myCardSelectionSubmitted,
    mySummaryReadingDone,
    pendingCardMembers.length,
    pendingSummaryReadingMembers.length,
    readingForceRemainingMs
  ]);

  useEffect(() => {
    setForceAdvanceSubmittedAt((prev) => {
      const next = { ...prev };
      let changed = false;
      if (mySummaryReadingDone && pendingSummaryReadingMembers.length > 0) {
        if (!next.reading) {
          next.reading = Date.now();
          changed = true;
        }
      } else if (next.reading) {
        next.reading = 0;
        changed = true;
      }
      if (myCardSelectionSubmitted && pendingCardMembers.length > 0) {
        if (!next.cards) {
          next.cards = Date.now();
          changed = true;
        }
      } else if (next.cards) {
        next.cards = 0;
        changed = true;
      }
      return changed ? next : prev;
    });
  }, [myCardSelectionSubmitted, mySummaryReadingDone, pendingCardMembers.length, pendingSummaryReadingMembers.length]);
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
  const showInterviewComposer = Boolean(interviewSessionId) && !interviewTransition && interviewRetryAction?.type !== "rescore";
  const showInterviewSummary = !showInterviewComposer && Boolean(interviewResult);
  const showInterviewEndButton = showInterviewComposer && interviewCanEnd && interviewRound >= INTERVIEW_MIN_TURNS && interviewRound < INTERVIEW_MAX_TURNS;
  const hasMergedInterviewReady = isStudentMergedInterviewReady(mergeData);
  const completedInterviewMaterials = useMemo(() => {
    if (isSummaryMode) return [];
    const completed = Array.isArray(interviewProgress?.completedInterviews)
      ? interviewProgress.completedInterviews
      : [];
    if (completed.length) {
      return completed.map((session, sessionIndex) => ({
        id: session.session_id || `completed-${sessionIndex}`,
        personaName: session.persona_name || session.persona?.name || `访谈对象 ${sessionIndex + 1}`,
        summary: String(session.result?.summary || session.summary || "").trim(),
        messages: (Array.isArray(session.messages) ? session.messages : [])
          .map((message, index) => toInterviewMessage(message, index))
          .filter((message) => message.text)
      }));
    }
    const messages = (Array.isArray(interviewMessages) ? interviewMessages : [])
      .filter((message) => message?.text);
    if (!messages.length && !interviewResult) return [];
    return [{
      id: "current-interview",
      personaName: activeInterviewPersona?.name || "访谈对象",
      summary: String(interviewResult?.summary || buildInterviewSummary(interviewResult, memberDims) || "").trim(),
      messages
    }];
  }, [activeInterviewPersona, interviewMessages, interviewProgress, interviewResult, isSummaryMode, memberDims]);
  const hasResearchMaterials = isSummaryMode
    ? Boolean(selectedPersonaSummaryText)
    : completedInterviewMaterials.some((item) => item.summary || item.messages.length);
  const canEnterCards = isSummaryMode
    ? Boolean(selectedPersonaChoice?.summary_text)
    : Boolean(interviewProgress.canProceed || memberState?.interview_status === "completed");
  const showInterviewStartButton = !isSummaryMode && !showInterviewComposer && !interviewTransition && !canEnterCards;
  const interviewProgressLabel = isSummaryMode
    ? (canEnterCards ? "报告已冻结" : (summaryReportReady ? "报告已就绪" : (isLoadingPersonaReports ? "正在加载报告..." : "等待报告加载")))
    : (interviewTransition
      ? `已完成 ${completedInterviewCount}/${Math.max(MIN_INTERVIEWS_REQUIRED, Number(interviewProgress.maxInterviews || 3))} 次访谈`
      : (showInterviewComposer ? `进行中 ${interviewRound}/${INTERVIEW_MAX_TURNS}` : (canEnterCards ? "访谈要求已满足" : "等待开始")));
  const isWaitingForTeacherRelease = Boolean(sessionConfig?.hold_before_r2 && teamStatus === "R2_NOT_STARTED");
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

  const handleViewAnotherSummaryReport = useCallback(async () => {
    if (!nextUnreadSummaryReport || isLoadingSummaryReport || selectedPersonaChoice?.summary_text) return;
    try {
      await loadSummaryReport(Number(nextUnreadSummaryReport.report_index));
    } catch (err) {
      setSummaryReportError(err.message || "客户调研报告加载失败");
    }
  }, [isLoadingSummaryReport, loadSummaryReport, nextUnreadSummaryReport, selectedPersonaChoice?.summary_text]);

  const handleOpenTeamSummaryReport = useCallback(async (personaId) => {
    const targetId = String(personaId || "").trim();
    if (!targetId || selectedPersonaChoice?.summary_text || isLoadingSummaryReport) return;
    const report = (availableSummaryReports || []).find((item) => String(item?.persona_id || "").trim() === targetId);
    if (!report) return;
    try {
      await loadSummaryReport(Number(report.report_index));
    } catch (err) {
      setSummaryReportError(err.message || "客户调研报告加载失败");
    }
  }, [availableSummaryReports, isLoadingSummaryReport, loadSummaryReport, selectedPersonaChoice?.summary_text]);

  const handleCompleteSummaryReading = useCallback(async () => {
    if (!teamId || !memberId || !summaryReportReady || isFreezingSummary) return;
    try {
      setIsFreezingSummary(true);
      setSummaryReportError("");
      const out = await completeRound2SummaryReading({
        teamId,
        memberId,
        session_id: sessionId
      });
      const nextStatus = {
        total_reports: Number(out?.total_reports || 0),
        team_viewed_count: Number(out?.team_viewed_count || 0),
        team_viewed_personas: Array.isArray(out?.team_viewed_personas) ? out.team_viewed_personas : [],
        my_viewed_personas: Array.isArray(out?.my_viewed_personas) ? out.my_viewed_personas : [],
        my_viewed: Array.isArray(out?.my_viewed) ? out.my_viewed : [],
        members: Array.isArray(out?.members) ? out.members : [],
        completed_count: Number(out?.completed_count || 0),
        all_completed: out?.all_completed === true,
        my_reading_status: String(out?.my_reading_status || "completed")
      };
      setSummaryReadingStatus(nextStatus);
      setForceAdvanceSubmittedAt((prev) => ({ ...prev, reading: Date.now() }));
      setForceAdvanceNow(Date.now());
      if (nextStatus.all_completed && nextStatus.members.length <= 1) {
        const freezeOut = await continueRound2SummaryReading({
          teamId,
          memberId,
          session_id: sessionId
        });
        commitSelectedPersonaChoice(freezeOut?.choice || null);
        setSystemNotice("已完成客户调研阅读，进入个人选卡。");
        setStep(2);
        return;
      }
      setSummaryReadingSubStep(SUMMARY_READING_TEAM_SUMMARY);
      setSystemNotice("已完成个人阅读，等待团队汇总。");
    } catch (err) {
      setSummaryReportError(err.message || "标记阅读完成失败");
    } finally {
      setIsFreezingSummary(false);
    }
  }, [isFreezingSummary, memberId, sessionId, summaryReportReady, teamId]);

  const handleContinueFromSummary = useCallback(async () => {
    if (!teamId || !memberId || !summaryReportReady || isFreezingSummary) return;
    try {
      setIsFreezingSummary(true);
      setSummaryReportError("");
      const out = await continueRound2SummaryReading({
        teamId,
        memberId,
        session_id: sessionId
      });
      commitSelectedPersonaChoice(out?.choice || null);
      setSystemNotice("已阅读调研报告，进入个人选卡。");
      setStep(2);
    } catch (err) {
      setSummaryReportError(err.message || "冻结调研报告失败");
    } finally {
      setIsFreezingSummary(false);
    }
  }, [isFreezingSummary, memberId, sessionId, summaryReportReady, teamId]);

  const handleForceAdvanceReading = useCallback(async () => {
    if (!teamId || !memberId || !isLeader || forceAdvanceGate) return;
    if (readingForceRemainingMs > 0) return;
    const pending = pendingSummaryReadingMembers;
    if (!pending.length) return;
    const names = pending.map((item) => item.name || item.member_name || item.member_id || item.id).join("、");
    const ok = window.confirm(`成员 ${names} 尚未完成。强行推进后，他们将无法补交，团队结果只基于已完成成员的决策。\n\n确定继续？`);
    if (!ok) return;
    try {
      setForceAdvanceGate("reading");
      setSummaryReportError("");
      const out = await forceAdvanceRound2({
        teamId,
        memberId,
        session_id: sessionId,
        gate: "reading"
      });
      if (out?.choice) {
        commitSelectedPersonaChoice(out.choice);
      }
      setTeamStatus(out?.team_status || "R2_INDIVIDUAL_CARDS");
      setSystemNotice("已跳过未完成阅读成员，进入个人选卡。");
      setStep(2);
    } catch (err) {
      setSummaryReportError(err.message || "强行推进失败");
    } finally {
      setForceAdvanceGate("");
    }
  }, [commitSelectedPersonaChoice, forceAdvanceGate, isLeader, memberId, pendingSummaryReadingMembers, readingForceRemainingMs, sessionId, teamId]);

  const handleForceAdvanceCards = useCallback(async () => {
    if (!teamId || !memberId || !isLeader || forceAdvanceGate) return;
    if (cardsForceRemainingMs > 0) return;
    const pending = pendingCardMembers;
    if (!pending.length) return;
    if (submittedCardMemberCount < 1) {
      setIndividualSubmitError("至少需要一名成员已提交选卡，才能由组长强推合并。");
      return;
    }
    const names = pending.map((item) => item.name || item.id).join("、");
    const ok = window.confirm(`成员 ${names} 尚未完成。强行推进后，他们将无法补交，团队结果只基于已完成成员的决策。\n\n确定继续？`);
    if (!ok) return;
    try {
      setForceAdvanceGate("cards");
      setIndividualSubmitError("");
      const out = await forceAdvanceRound2({
        teamId,
        memberId,
        session_id: sessionId,
        gate: "cards"
      });
      setTeamStatus(out?.team_status || "R2_TEAM_MERGE");
      setSystemNotice("已跳过未提交选卡成员，进入团队合并。");
      setStep(3);
    } catch (err) {
      setIndividualSubmitError(err.message || "强行推进失败");
    } finally {
      setForceAdvanceGate("");
    }
  }, [cardsForceRemainingMs, forceAdvanceGate, isLeader, memberId, pendingCardMembers, sessionId, submittedCardMemberCount, teamId]);

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
    const activeSessionId = String(session?.sessionId || payload?.sessionId || "");
    const needsRescore = Boolean(
      payload?.needsRescore
      || (
        activeSessionId &&
        Number(session?.round || 0) >= INTERVIEW_MAX_TURNS &&
        !session?.isComplete
      )
    );
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
    setInterviewSessionId(activeSessionId);
    setInterviewRound(Number(session?.round || 0));
    setInterviewRetryAction(
      needsRescore
        ? {
            type: "rescore",
            sessionId: activeSessionId,
            label: "评分失败，请点击重试。"
          }
        : null
    );
    setInterviewDimensionOpenId((prev) => {
      const first = dimensionGuide[0]?.id || memberDims[0];
      return prev && dimensionGuide.some((item) => item.id === prev) ? prev : first;
    });

    const transition = options.keepTransition
      ? interviewTransition
      : (!session ? buildInterviewTransition(progress, progress.latestCompletedInterview, options.endedByLimit) : null);
    setInterviewTransition(transition);
  }, [interviewTransition, memberDims]);

  const canStartInterviewForMember = useCallback((targetMemberId, options = {}) => {
    const normalizedMemberId = String(targetMemberId || "").trim();
    if (!normalizedMemberId) return false;
    const now = Date.now();
    const last = interviewStartGateRef.current;
    if (
      last.memberId === normalizedMemberId &&
      now - Number(last.startedAt || 0) < INTERVIEW_START_DEBOUNCE_MS
    ) {
      if (options.showError) {
        setInterviewError("请勿重复点击，请 3 秒后再试。");
      }
      return false;
    }
    interviewStartGateRef.current = {
      memberId: normalizedMemberId,
      startedAt: now
    };
    return true;
  }, []);

  const handleStartAnotherInterview = useCallback(async () => {
    if (!teamId || !memberId || isStartingInterview) return;
    if (!canStartInterviewForMember(memberId, { showError: true })) return;
    try {
      setIsStartingInterview(true);
      setInterviewError("");
      setInterviewRetryAction(null);
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
  }, [applyInterviewPayload, canStartInterviewForMember, isStartingInterview, memberDims, memberId, teamId]);

  const handleInterviewEnd = useCallback(async () => {
    if (!interviewSessionId || isSendingInterview) return;
    try {
      setIsSendingInterview(true);
      setInterviewError("");
      setInterviewRetryAction(null);
      const out = await endRound2Interview({ sessionId: interviewSessionId });
      setInterviewResult({
        tags: out.tags || [],
        evi: out.evi,
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
    if (isSummaryMode) {
      setInterviewRestoreChecked(true);
      return undefined;
    }
    if (!teamId || !memberId) return;
    setInterviewRestoreChecked(false);
    setInterviewError("");
    setInterviewRetryAction(null);
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
  }, [isSummaryMode, teamId, memberId]);

  useEffect(() => {
    if (isSummaryMode) return undefined;
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
      if (!canStartInterviewForMember(memberId)) return;
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
  }, [applyInterviewPayload, canStartInterviewForMember, completedInterviewCount, interviewRestoreChecked, interviewSessionId, interviewTransition, isSummaryMode, memberDims, memberId, step, teamId]);

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
        const mergePricingContext = normalizePricingContext(out);
        if (mergePricingContext) {
          setRound2PricingContext(mergePricingContext);
        }
        const mapped = selectionsToMap(out?.team_draft?.selections?.length ? out.team_draft.selections : out.teamSelections);
        if (!serverSelections) {
          setTeamDraftSelections(mapped);
        }
        const draftPrice = parsePositiveNumberOrNull(out?.team_draft?.price);
        if (draftPrice != null) {
          setTeamPrice(clampPriceToContext(draftPrice, mergePricingContext));
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
      const draftPrice = parsePositiveNumberOrNull(teamPrice);
      saveRound2TeamDraft({
        team_id: teamId,
        member_id: memberId,
        price: draftPrice,
        selections: toSubmitSelectionsMap(teamDraftSelections)
      }).catch(() => {});
    }, 350);
    return () => window.clearTimeout(timer);
  }, [isLeader, isTeamMode, memberId, step, submitted, teamDraftSelections, teamId, teamPrice]);

  const handleInterviewSend = useCallback(async () => {
    const message = String(interviewInput || "").trim();
    if (!interviewSessionId || !message || isSendingInterview) return;
    const optimisticMessage = toInterviewMessage({ id: `local-user-${Date.now()}`, role: "user", speaker: "你", text: message }, interviewMessages.length);
    try {
      setIsSendingInterview(true);
      setInterviewError("");
      setInterviewRetryAction(null);
      setInterviewMessages((prev) => [...prev, optimisticMessage]);
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
          tags: out.tags || [],
          evi: out.evi,
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
      const payload = err?.payload || {};
      if (payload?.error === "llm_unavailable") {
        setInterviewMessages((prev) => prev.filter((item) => item.id !== optimisticMessage.id));
        setInterviewInput(message);
        setInterviewRetryAction({
          type: "reply",
          sessionId: interviewSessionId,
          message,
          label: "网络繁忙，请点击重试。"
        });
        setInterviewError(payload?.message || "网络繁忙，请稍后重试");
      } else if (payload?.needsRescore && String(payload?.reply || "").trim()) {
        const replyText = String(payload.reply || "").trim();
        setInterviewMessages((prev) => [
          ...prev,
          toInterviewMessage({
            id: `local-assistant-${Date.now()}`,
            role: "assistant",
            speaker: payload.speaker || activeInterviewPersona?.name || "访谈对象",
            text: replyText
          }, prev.length)
        ]);
        setInterviewRound(Number(payload.round || interviewRound));
        setInterviewProgress(payload.progress || createEmptyInterviewProgress());
        setInterviewCanEnd(Boolean(payload.canEnd));
        setInterviewRetryAction({
          type: "rescore",
          sessionId: interviewSessionId,
          label: "评分失败，请点击重试。"
        });
        setInterviewError(payload?.message || "评分失败，请点击重试");
      } else {
        setInterviewMessages((prev) => prev.filter((item) => item.id !== optimisticMessage.id));
        setInterviewInput(message);
        setInterviewError(err.message || "访谈发送失败");
      }
    } finally {
      setIsSendingInterview(false);
    }
  }, [activeInterviewPersona, interviewInput, interviewMessages.length, interviewRound, interviewSessionId, isSendingInterview]);

  const handleInterviewRetry = useCallback(async () => {
    if (!interviewRetryAction || isSendingInterview) return;
    try {
      setIsSendingInterview(true);
      setInterviewError("");
      if (interviewRetryAction.type === "reply") {
        const retryMessage = String(interviewRetryAction.message || "").trim();
        if (!interviewSessionId || !retryMessage) return;
        const optimisticMessage = toInterviewMessage(
          { id: `retry-user-${Date.now()}`, role: "user", speaker: "你", text: retryMessage },
          interviewMessages.length
        );
        setInterviewRetryAction(null);
        setInterviewMessages((prev) => [...prev, optimisticMessage]);
        setInterviewInput("");
        const out = await replyRound2Interview({
          sessionId: interviewSessionId,
          message: retryMessage
        });
        const replyText = String(out.reply || "").trim();
        setInterviewMessages((prev) => [
          ...prev,
          toInterviewMessage({
            id: `retry-assistant-${Date.now()}`,
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
            tags: out.tags || [],
            evi: out.evi,
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
        return;
      }
      const out = await rescoreRound2Interview(interviewRetryAction.sessionId);
      setInterviewRetryAction(null);
      setInterviewResult({
        tags: out.tags || [],
        evi: out.evi,
        summary: out.summary || ""
      });
      const refreshed = await getRound2InterviewSession(teamId, memberId, "", {});
      applyInterviewPayload(refreshed, { endedByLimit: true });
      if (refreshed?.progress?.reachedInterviewLimit) {
        setSystemNotice("第 3 次访谈完成，已自动进入个人选卡。");
        setStep(2);
      } else {
        setSystemNotice("评分完成，本次访谈已成功收尾。");
      }
    } catch (err) {
      const payload = err?.payload || {};
      if (payload?.error === "llm_unavailable") {
        setInterviewRetryAction({
          type: "reply",
          sessionId: interviewSessionId,
          message: interviewRetryAction?.message || "",
          label: "网络繁忙，请点击重试。"
        });
        setInterviewError(payload?.message || "网络繁忙，请稍后重试");
      } else if (payload?.needsRescore && String(payload?.reply || "").trim()) {
        const replyText = String(payload.reply || "").trim();
        setInterviewMessages((prev) => [
          ...prev,
          toInterviewMessage({
            id: `retry-assistant-${Date.now()}`,
            role: "assistant",
            speaker: payload.speaker || activeInterviewPersona?.name || "访谈对象",
            text: replyText
          }, prev.length)
        ]);
        setInterviewRound(Number(payload.round || interviewRound));
        setInterviewProgress(payload.progress || createEmptyInterviewProgress());
        setInterviewCanEnd(Boolean(payload.canEnd));
        setInterviewRetryAction({
          type: "rescore",
          sessionId: interviewSessionId,
          label: "评分失败，请点击重试。"
        });
        setInterviewError(payload?.message || "评分失败，请点击重试");
      } else if (payload?.scoringError) {
        setInterviewRetryAction((prev) => prev || {
          type: "rescore",
          sessionId: interviewSessionId,
          label: "评分失败，请点击重试。"
        });
        setInterviewError(payload?.message || "评分失败，请稍后重试");
      } else {
        setInterviewError(err.message || "重试失败");
      }
    } finally {
      setIsSendingInterview(false);
    }
  }, [activeInterviewPersona, applyInterviewPayload, interviewMessages.length, interviewRetryAction, interviewRound, interviewSessionId, isSendingInterview, memberId, teamId]);

  const handleIndividualSubmit = useCallback(async () => {
    if (!teamId || !memberId || indCalc.cnt < 1 || isSubmittingIndividual) return;
    try {
      setIsSubmittingIndividual(true);
      setIndividualSubmitError("");
      const submitResult = await saveRound2MemberSelection({
        teamId,
        memberId,
        selections: selectionsMapToArray(sel)
      });
      if (submitResult?.team_status === "R2_TEAM_MERGE") {
        setSystemNotice("全员已提交，进入团队合并。");
        setStep(3);
      } else {
        setForceAdvanceSubmittedAt((prev) => ({ ...prev, cards: Date.now() }));
        setForceAdvanceNow(Date.now());
        setSystemNotice("个人选卡已提交，等待其他成员提交。");
      }
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
    if (!hasMergedInterviewReady) {
      setSystemNotice("团队合并数据未就绪，请等待加载完成后再提交。");
      return;
    }

    try {
      setIsSubmittingFinal(true);
      setSubmitError("");
      const submitSelections = toSubmitSelectionsMap(teamSel);
      const finalPrice = parsePositiveNumberOrNull(teamPrice)
        || parsePositiveNumberOrNull(teamRecap?.P)
        || fallbackPrice;
      const out = await submitRound2TeamDecision({
        team_id: teamId,
        member_id: memberId,
        session_id: sessionId,
        price: finalPrice,
        selections: submitSelections,
        mergedInterview: mergeData?.mergedInterview || null
      });
      setTeamPrice(finalPrice);
      const mappedSelections = selectionsToMap(out?.submission?.selections);
      setServerSelections(mappedSelections);
      setTeamDraftSelections(mappedSelections);
      setTeamResultSnapshot(out?.result || null);
      try {
        const refreshedRecap = await getRound2Recap(teamId);
        setTeamRecap(refreshedRecap || null);
        const refreshedPricingContext = normalizePricingContext(refreshedRecap);
        if (refreshedPricingContext) {
          setRound2PricingContext(refreshedPricingContext);
        }
      } catch (_) {}
      setSubmitted(true);
    } catch (err) {
      setSubmitError(round2LeaderErrorMessage(err));
    } finally {
      setIsSubmittingFinal(false);
    }
  }, [fallbackPrice, hasMergedInterviewReady, isTeamMode, isSubmittingFinal, memberId, mergeData, round2TeamControlsLocked, sessionId, teamId, teamPrice, teamRecap, teamSel]);

  const renderResearchDrawer = () => (
    <>
      <button
        type="button"
        onClick={() => setIsResearchDrawerOpen((open) => !open)}
        aria-expanded={isResearchDrawerOpen}
        aria-label={isResearchDrawerOpen ? "收起调研资料" : "展开调研资料"}
        style={{
          position: "fixed",
          right: isResearchDrawerOpen ? "min(420px, 86vw)" : 0,
          top: "calc(50% + 132px)",
          transform: "translateY(-50%)",
          zIndex: 1000,
          width: 30,
          minHeight: 110,
          border: "none",
          borderRadius: "6px 0 0 6px",
          background: "rgba(26, 92, 58, 0.9)",
          color: "#fff",
          font: "inherit",
          fontSize: 13,
          fontWeight: 800,
          letterSpacing: "0.08em",
          boxShadow: "0 10px 24px rgba(15, 23, 42, 0.16)",
          cursor: "pointer",
          transition: "right 220ms ease, background 180ms ease"
        }}
      >
        <span style={{writingMode:"vertical-rl",textOrientation:"mixed",display:"inline-block",padding:"14px 6px"}}>
          调研资料
        </span>
      </button>
      <aside
        aria-label="调研资料"
        style={{
          position: "fixed",
          top: 0,
          right: 0,
          width: "min(420px, 86vw)",
          height: "100vh",
          zIndex: 999,
          background: "#fafaf8",
          borderLeft: "1px solid #dbe5dd",
          boxShadow: isResearchDrawerOpen ? "-16px 0 36px rgba(15, 23, 42, 0.16)" : "none",
          transform: isResearchDrawerOpen ? "translateX(0)" : "translateX(100%)",
          transition: "transform 220ms ease",
          display: "flex",
          flexDirection: "column",
          pointerEvents: isResearchDrawerOpen ? "auto" : "none"
        }}
      >
        <div style={{padding:"16px 18px",background:"#fff",borderBottom:"1px solid #e5e7eb",display:"flex",alignItems:"center",justifyContent:"space-between",gap:12}}>
          <div>
            <div style={{fontSize:15,fontWeight:900,color:"#111827"}}>调研资料</div>
            <div style={{fontSize:12,color:"#6b7280",marginTop:3}}>
              仅回看本局已获得材料
            </div>
          </div>
          <button
            type="button"
            onClick={() => setIsResearchDrawerOpen(false)}
            aria-label="关闭调研资料"
            style={{width:34,height:34,borderRadius:8,border:"1px solid #d1d5db",background:"#fff",fontSize:20,lineHeight:1,cursor:"pointer"}}
          >
            ×
          </button>
        </div>
        <div style={{flex:1,minHeight:0,overflowY:"auto",padding:16}}>
          {!hasResearchMaterials ? (
            <div style={{padding:"24px 18px",borderRadius:12,background:"#fff",border:"1px solid #e5e7eb",fontSize:13,color:"#6b7280",lineHeight:1.8,textAlign:"center"}}>
              本局暂无调研资料
            </div>
          ) : isSummaryMode ? (
            <div style={{padding:"16px 18px",borderRadius:12,background:"#fff",border:"1px solid #dbe5dd",fontSize:13,color:"#374151",lineHeight:1.85}}>
              <div style={{fontSize:14,fontWeight:800,color:"#166534",marginBottom:10}}>{summaryReportTitle}</div>
              {renderReportText(selectedPersonaSummaryText)}
            </div>
          ) : (
            <div style={{display:"flex",flexDirection:"column",gap:12}}>
              {completedInterviewMaterials.map((item, index) => (
                <div key={item.id || index} style={{padding:"14px 16px",borderRadius:12,background:"#fff",border:"1px solid #e5e7eb"}}>
                  <div style={{fontSize:14,fontWeight:800,color:"#111827",marginBottom:8}}>
                    {item.personaName || `访谈对象 ${index + 1}`}
                  </div>
                  {item.summary && (
                    <div style={{fontSize:13,color:"#374151",lineHeight:1.8,marginBottom:10}}>
                      {item.summary}
                    </div>
                  )}
                  {item.messages.length > 0 && (
                    <div style={{display:"flex",flexDirection:"column",gap:8}}>
                      {item.messages.map((message, messageIndex) => (
                        <div key={`${item.id || index}-${message.id || messageIndex}`} style={{padding:"8px 10px",borderRadius:8,background:message.role === "user" ? "#f0fdf4" : "#f9fafb",border:"1px solid #e5e7eb"}}>
                          <div style={{fontSize:11,fontWeight:800,color:message.role === "user" ? "#166534" : "#6b7280",marginBottom:4}}>
                            {message.speaker || (message.role === "user" ? "你" : "访谈对象")}
                          </div>
                          <div style={{fontSize:12,color:"#374151",lineHeight:1.7,whiteSpace:"pre-wrap"}}>
                            {message.text}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </aside>
    </>
  );

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
                      <div style={{display:"flex",gap:6,flexWrap:"wrap",marginTop:6}}>
                        <span style={{fontSize:10,padding:"2px 6px",borderRadius:999,background:"#f9fafb",color:"#374151",fontWeight:700,border:"1px solid #e5e7eb"}}>
                          单位成本 {formatSignedCurrency(td.cost)}/台 · 研发投入 {formatWan(td.nre)}
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
                      NRE {formatWan(td.nre)}
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
            {dep.type} <strong>{findCard(dep.target)?.n||dep.target}</strong> 达到{dep.tl}以上{dep.cross && <span style={{opacity:0.7}}>（其他成员负责）</span>}
          </div>
        ))}
        {hasConflict && !isOn && <div style={{marginTop:6,marginLeft:24,fontSize:11,color:"#DC2626"}}>✕ 与已选能力卡冲突</div>}
      </div>
    );
  };

  const renderDimGroup = (dimId, sels, showCost, mode) => {
    const dim = DIMS.find(d=>d.id===dimId);
    const cards = cardCatalog[dimId]||[];
    const cnt = cards.filter(c=>!!sels[c.id]).length;
    return (
      <div key={dimId} data-testid={`r2-dim-${dimId}`} style={{marginBottom:8}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"10px 16px",background:dim.c+"10",borderBottom:`3px solid ${dim.c}`,borderRadius:"10px 10px 0 0"}}>
          <div>
            <span style={{fontSize:15,fontWeight:800}}>{dim.icon} {dim.l}</span>
            <span style={{fontSize:12,color:"#666",marginLeft:8}}>{dim.desc}</span>
          </div>
          <div style={{display:"flex",gap:8,alignItems:"center"}}>
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
    const capabilityScores = buildRadarFromSelections(sels || {}, cardCatalog);
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

  if (teamId && !isLoadingContext && teamStatus === "R2_NOT_STARTED") {
    return (
      <div style={{fontFamily:"'Noto Sans SC',-apple-system,sans-serif",background:"#fafaf8",minHeight:"100vh",padding:"16px 14px"}}>
        <div style={{maxWidth:720,margin:"100px auto 0",padding:"32px 28px",borderRadius:16,background:"#fff",border:"1px solid #e5e7eb",textAlign:"center",boxShadow:"0 10px 24px rgba(15,23,42,0.06)"}}>
          <div style={{fontSize:22,fontWeight:800,color:"#111827",marginBottom:10}}>教师尚未开放 Round 2</div>
          <div style={{fontSize:16,lineHeight:1.8,color:"#6b7280"}}>请先返回等待，教师在教师面板开放后，系统会自动允许进入第二轮。</div>
        </div>
      </div>
    );
  }

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
        {ROUND2_NARRATIVE_STAGES.map((stage, i) => {
          const currentStage = getRound2NarrativeStageIndex(step);
          const targetStep = getRound2NarrativeTargetStep(stage, step);
          const completed = i < currentStage;
          const active = i === currentStage;
          return (
            <div key={stage.id} style={{display:"flex",alignItems:"center",flex:i<ROUND2_NARRATIVE_STAGES.length-1?1:"none"}}>
              <div style={{display:"flex",flexDirection:"column",alignItems:"center",gap:4}}>
                <div
                  onClick={()=>!isSubmissionBusy&&targetStep!=null&&setStep(targetStep)}
                  style={{width:28,height:28,borderRadius:"50%",display:"flex",alignItems:"center",justifyContent:"center",fontSize:11,fontWeight:700,cursor:!isSubmissionBusy&&targetStep!=null?"pointer":"default",background:active?"#1a5c3a":completed?"#cbd5e1":"#e5e7eb",color:active||completed?"#fff":"#aaa",boxShadow:active?"0 0 0 3px #1a5c3a33":"none",opacity:isSubmissionBusy?0.55:(targetStep!=null?1:0.55)}}
                >{completed?"✓":(active?"●":"")}</div>
                <span style={{fontSize:11,color:active?"#1a5c3a":completed?"#64748b":"#aaa",fontWeight:active?700:500,whiteSpace:"nowrap"}}>{stage.label}</span>
              </div>
              {i<ROUND2_NARRATIVE_STAGES.length-1 && <div style={{flex:1,height:2,margin:"0 2px",marginBottom:18,background:completed?"#cbd5e1":"#e5e7eb"}}/>}
            </div>
          );
        })}
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
              你们正在为一款 AI 宠物机器人寻找<strong>中国市场的最佳定位</strong>，并基于这个定位进行<strong>产品创新改造</strong>。第一轮你们确定了战略方向，第二轮你们将把战略落地为具体的产品。
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

          {round1ScoresRevealed && (
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
          )}

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
                {title:"客户调研",desc:isSummaryMode ? "先独立阅读客户调研报告，再汇总团队覆盖的受访者，确认你们究竟在为谁而造。" : "与 AI 模拟的目标用户深度访谈，验证你们的需求假设，发现隐藏需求"},
                {title:"产品研发",desc:"为产品选择具体的技术能力组合，明确做什么、不做什么、做到什么程度"},
                {title:"定价发布",desc:"制定价格策略，系统根据你们的产品和定价自动计算市场表现"},
              ].map(item => (
                <div key={item.title} style={{flex:"1 1 180px",padding:"12px",background:"rgba(255,255,255,0.08)",borderRadius:8}}>
                  <div style={{width:24,height:24,borderRadius:999,background:"rgba(255,255,255,0.2)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:12,fontWeight:700,marginBottom:6}}>•</div>
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
          {isWaitingForTeacherRelease && (
            <div style={{padding:"12px 14px",borderRadius:10,background:"#eff6ff",border:"1px solid #bfdbfe",fontSize:13,color:"#1d4ed8",lineHeight:1.8,marginBottom:12}}>
              当前班次启用了教师放行。请先停留在这一页，系统会每 3 秒轮询一次；老师放行后，你们会自动进入第二轮。
            </div>
          )}
          <button onClick={()=>!isWaitingForTeacherRelease&&setStep(1)} disabled={isWaitingForTeacherRelease} style={{...BS,opacity:isWaitingForTeacherRelease?0.55:1,cursor:isWaitingForTeacherRelease?"not-allowed":"pointer"}}>
            {isWaitingForTeacherRelease ? "等待教师放行..." : "继续"}
          </button>
        </div>
      )}

      {/* ═══ Step 1: 用户访谈 ═══ */}
      {step===1 && (
        <div data-testid="r2-interview-container" style={{background:"#fff",borderRadius:14,padding:24,border:"1px solid #e5e7eb"}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:12,flexWrap:"wrap",marginBottom:16}}>
            <div>
              <h2 style={{fontSize:18,fontWeight:800,margin:"0 0 8px"}}>{isSummaryMode ? "阅读客户调研报告" : "深度用户访谈"}</h2>
              <p style={{fontSize:14,color:"#555",margin:0,lineHeight:1.8}}>
                {isSummaryMode
                  ? "每位成员先独立阅读客户调研报告，完成后进入团队调研汇总，再一起推进到个人选卡。"
                  : "每位成员至少完成 2 次访谈，最多 3 次。单次访谈前 4 轮必须继续提问，第 5 轮起可以手动结束，第 10 轮会自动收尾。"}
              </p>
            </div>
            {!isSummaryMode && (
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
            )}
          </div>
          <div style={{padding:"14px 18px",borderRadius:10,background:"#fffbeb",border:"1px solid #fde68a",marginBottom:16}}>
            <div style={{fontSize:14,fontWeight:700,color:"#92400e",marginBottom:6}}>📋 访谈规则</div>
              <div style={{fontSize:13,color:"#78350f",lineHeight:1.8}}>
              {isSummaryMode ? (
                <>
                  先独立阅读客户调研报告，再进入团队调研汇总。团队确认继续后，系统会冻结本队已覆盖的报告范围。
                </>
              ) : (
                <>
                  当前成员负责维度： <strong>{memberDims.map((dimId) => DIMS.find((item) => item.id === dimId)?.l || dimId).join("、")}</strong>。
                  当前已完成 <strong>{completedInterviewCount}</strong> / {Math.max(MIN_INTERVIEWS_REQUIRED, Number(interviewProgress.maxInterviews || 3))} 次访谈。
                </>
              )}
            </div>
          </div>

          {isSummaryMode ? (
            <div style={{border:"1px solid #e5e7eb",borderRadius:16,background:"#fff",overflow:"hidden"}}>
              <div style={{padding:"18px 20px",background:"#f8fafc",borderBottom:"1px solid #e5e7eb",display:"flex",justifyContent:"space-between",gap:12,alignItems:"center",flexWrap:"wrap"}}>
                <div>
                  <div style={{fontSize:11,fontWeight:800,color:"#1a5c3a",letterSpacing:"0.04em",marginBottom:6}}>
                    {summaryReadingSubStep === SUMMARY_READING_TEAM_SUMMARY ? "团队调研汇总" : "阅读客户调研报告"}
                  </div>
                  <div style={{fontSize:20,fontWeight:800,color:"#111827"}}>
                    {summaryReadingSubStep === SUMMARY_READING_TEAM_SUMMARY ? "团队调研汇总" : summaryReportTitle}
                  </div>
                </div>
                {selectedPersonaChoice?.summary_text ? (
                  <div style={{padding:"8px 12px",borderRadius:999,background:"#ecfdf5",color:"#166534",fontSize:12,fontWeight:800,border:"1px solid #bbf7d0"}}>
                    已按团队冻结，不重抽
                  </div>
                ) : (
                  <div style={{display:"flex",alignItems:"center",gap:10,flexWrap:"wrap"}}>
                    <div style={{padding:"8px 12px",borderRadius:999,background:"#ecfdf5",color:"#166534",fontSize:12,fontWeight:800,border:"1px solid #bbf7d0"}}>
                      {summaryProgressLabel}
                    </div>
                    {isLoadingReadingStatus && (
                      <div style={{fontSize:12,color:"#6b7280"}}>同步中…</div>
                    )}
                  </div>
                )}
              </div>
              {summaryReadingSubStep === SUMMARY_READING_TEAM_SUMMARY && (
                <div style={{padding:"18px 20px",borderBottom:"1px solid #e5e7eb",background:"#fff"}}>
                  <div style={{display:"flex",justifyContent:"space-between",gap:12,alignItems:"center",flexWrap:"wrap",marginBottom:14}}>
                    <div style={{fontSize:15,fontWeight:800,color:"#111827"}}>{summaryTeamCoverageLabel}</div>
                    <div style={{fontSize:12,color:"#6b7280"}}>
                      已完成阅读 {Number(summaryReadingStatus?.completed_count || 0)}/{summaryReadingMembers.length || 0} 人
                    </div>
                  </div>
                  <div style={{overflowX:"auto"}}>
                    <table style={{width:"100%",borderCollapse:"collapse",fontSize:13}}>
                      <thead>
                        <tr>
                          <th style={{textAlign:"left",padding:"10px",borderBottom:"1px solid #e5e7eb",color:"#6b7280"}}>成员</th>
                          {(availableSummaryReports || []).map((report) => (
                            <th key={`report_head_${report.persona_id}`} style={{textAlign:"center",padding:"10px",borderBottom:"1px solid #e5e7eb",color:"#6b7280"}}>
                              {String(report.title || report.persona_id || "").trim() || "受访者"}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {summaryReadingMembers.map((member) => {
                          const viewedSet = new Set((member.viewed || []).map((item) => String(item || "").trim()));
                          return (
                            <tr key={member.member_id}>
                              <td style={{padding:"10px",borderBottom:"1px solid #f3f4f6",fontWeight:700,color:"#374151"}}>
                                {member.name}{member.reading_status === "completed" ? " · 已完成" : " · 阅读中"}
                              </td>
                              {(availableSummaryReports || []).map((report) => {
                                const personaId = String(report.persona_id || "").trim();
                                const viewed = viewedSet.has(personaId);
                                return (
                                  <td key={`${member.member_id}_${personaId}`} style={{padding:"10px",borderBottom:"1px solid #f3f4f6",textAlign:"center",color:viewed ? "#166534" : "#d1d5db",fontWeight:800}}>
                                    {viewed ? "✓" : ""}
                                  </td>
                                );
                              })}
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                  <div style={{display:"flex",gap:8,flexWrap:"wrap",marginTop:14}}>
                    {(summaryReadingStatus?.team_viewed_personas || []).map((personaId) => {
                      const report = (availableSummaryReports || []).find((item) => String(item?.persona_id || "").trim() === String(personaId || "").trim());
                      return (
                        <button
                          key={`open_team_report_${personaId}`}
                          type="button"
                          onClick={() => handleOpenTeamSummaryReport(personaId)}
                          disabled={Boolean(selectedPersonaChoice?.summary_text) || isLoadingSummaryReport}
                          style={{padding:"9px 12px",borderRadius:999,border:"1px solid #bbf7d0",background:"#ecfdf5",color:"#166534",fontSize:12,fontWeight:800,cursor:"pointer"}}
                        >
                          查看 {String(report?.title || personaId || "").trim()}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
              <div style={{padding:"22px 24px",fontSize:14,color:"#374151",lineHeight:1.95,minHeight:340}}>
                {isLoadingPersonaReports
                  ? "系统正在加载客户调研报告，请稍候..."
                  : renderReportText(selectedPersonaSummaryText || "暂未分配客户调研报告。")}
              </div>
              {(loadError || summaryReportError) && (
                <div style={{padding:"0 20px 16px"}}>
                  <div style={{padding:"10px 14px",borderRadius:10,background:"#FEF2F2",border:"1px solid #FECACA",fontSize:12,color:"#991B1B"}}>
                    {summaryReportError || loadError}
                  </div>
                </div>
              )}
              <div style={{padding:"16px 20px",borderTop:"1px solid #e5e7eb",background:"#f8fafc",display:"flex",justifyContent:"space-between",gap:12,alignItems:"center",flexWrap:"wrap"}}>
                <button
                  type="button"
                  onClick={handleViewAnotherSummaryReport}
                  disabled={!nextUnreadSummaryReport || Boolean(selectedPersonaChoice?.summary_text) || isLoadingSummaryReport}
                  style={{
                    padding:"12px 16px",
                    borderRadius:10,
                    background:nextUnreadSummaryReport && !selectedPersonaChoice?.summary_text ? "#fff" : "#f3f4f6",
                    color:nextUnreadSummaryReport && !selectedPersonaChoice?.summary_text ? "#1f2937" : "#9ca3af",
                    border:"1px solid #d1d5db",
                    fontSize:14,
                    fontWeight:700,
                    cursor:nextUnreadSummaryReport && !selectedPersonaChoice?.summary_text && !isLoadingSummaryReport ? "pointer" : "not-allowed"
                  }}
                >
                  {selectedPersonaChoice?.summary_text
                    ? "已冻结"
                    : (nextUnreadSummaryReport ? "查看另一位受访者" : "已阅读全部受访者")}
                </button>
                <button
                  type="button"
                  onClick={summaryReadingSubStep === SUMMARY_READING_TEAM_SUMMARY ? handleContinueFromSummary : handleCompleteSummaryReading}
                  disabled={!summaryReportReady || isFreezingSummary || (summaryReadingSubStep === SUMMARY_READING_TEAM_SUMMARY && !summaryAllMembersDone)}
                  style={{padding:"12px 16px",borderRadius:10,background:summaryReportReady && (summaryReadingSubStep !== SUMMARY_READING_TEAM_SUMMARY || summaryAllMembersDone) ? "#1a5c3a" : "#d1d5db",color:"#fff",border:"none",fontSize:14,fontWeight:700,cursor:summaryReportReady && !isFreezingSummary && (summaryReadingSubStep !== SUMMARY_READING_TEAM_SUMMARY || summaryAllMembersDone) ? "pointer" : "not-allowed",opacity:summaryReportReady ? 1 : 0.6}}
                >
                  {isFreezingSummary
                    ? "处理中…"
                    : summaryReadingSubStep === SUMMARY_READING_TEAM_SUMMARY
                      ? (summaryAllMembersDone ? "继续，进入个人选卡" : "等待团队完成阅读")
                      : (mySummaryReadingDone ? "已完成阅读" : "完成阅读，等待团队")}
                </button>
                {summaryReadingSubStep === SUMMARY_READING_TEAM_SUMMARY && isLeader && mySummaryReadingDone && !summaryAllMembersDone && pendingSummaryReadingMembers.length > 0 && (
                  <div style={{flexBasis:"100%",padding:"12px 14px",borderRadius:10,background:"#fff7ed",border:"1px solid #fed7aa",fontSize:12,color:"#9a3412",lineHeight:1.7}}>
                    <div>
                      等待 {pendingSummaryReadingMembers.map((item) => item.name || item.member_name || item.member_id || item.id).join("、")} 完成阅读中…
                    </div>
                    {canShowForceAdvanceReading ? (
                      <button
                        type="button"
                        onClick={handleForceAdvanceReading}
                        disabled={forceAdvanceGate === "reading"}
                        style={{marginTop:8,padding:"7px 0",borderRadius:0,border:"none",background:"transparent",color:"#c2410c",fontSize:12,fontWeight:800,cursor:forceAdvanceGate === "reading" ? "wait" : "pointer",textDecoration:"underline"}}
                      >
                        {forceAdvanceGate === "reading" ? "正在推进…" : "长时间未响应？跳过未完成成员，继续推进"}
                      </button>
                    ) : (
                      <div style={{marginTop:6,color:"#b45309"}}>
                        {`为防误触，${formatForceAdvanceCountdown(readingForceRemainingMs)}后可由组长跳过未完成成员。`}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          ) : (
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
                          <div>你已经完成最少 2 次访谈，可以继续；如果愿意，也可以再访谈一位用户补充更多信息。</div>
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
                              继续
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
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:12,padding:"10px 14px",borderRadius:8,background:"#FEF2F2",border:"1px solid #FECACA",fontSize:12,color:"#991B1B",marginBottom:12}}>
                  <span>{interviewError}</span>
                  {interviewRetryAction && (
                    <button
                      type="button"
                      onClick={handleInterviewRetry}
                      disabled={isSendingInterview}
                      style={{padding:"6px 12px",borderRadius:8,background:"#991B1B",color:"#fff",border:"none",fontSize:12,fontWeight:700,cursor:"pointer",opacity:isSendingInterview ? 0.5 : 1,whiteSpace:"nowrap"}}
                    >
                      {isSendingInterview ? "重试中..." : "立即重试"}
                    </button>
                  )}
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
                {canEnterCards ? "继续" : "至少完成 2 次访谈后继续"}
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
          )}
        </div>
      )}

      {/* ═══ Step 2: 个人选卡 ═══ */}
      {step===2 && (
        <div data-testid="r2-card-selection-container">
          {renderResearchDrawer()}
          <div style={{background:"#fff",padding:"14px 18px",borderRadius:"14px 14px 0 0",border:"1px solid #e5e7eb",borderBottom:"none"}}>
            <h2 style={{fontSize:18,fontWeight:800,margin:"0 0 4px"}}>个人选卡（{memberName}）</h2>
            <p style={{fontSize:13,color:"#666",margin:0,lineHeight:1.6}}>
              为你负责的维度选择能力卡。根据访谈结果和你的判断，把你认为产品应该具备的能力都选上，再选择合适的档次。
              <br/><span style={{color:"#999"}}>每个档位会显示单位成本、研发投入和团队投入说明，便于你在能力与成本之间取舍。</span>
            </p>
          </div>
          {/* Sticky bar */}
          <div style={{position:"sticky",top:0,zIndex:10,display:"flex",gap:10,padding:"10px 16px",background:"#fff",border:"1px solid #e5e7eb",borderTop:"none",borderRadius:"0 0 14px 14px",marginBottom:8,boxShadow:"0 2px 8px rgba(0,0,0,0.04)",flexWrap:"wrap",alignItems:"center"}}>
            <div data-testid="r2-budget-display" style={{padding:"6px 14px",borderRadius:8,background:"#f9fafb",border:"1px solid #e5e7eb",fontSize:13,color:"#374151"}}>
              已选 <strong>{indCalc.cnt}</strong> 张 · dCOGS 小计 <strong>{formatSignedCurrency(indCalc.cost)}/台</strong> · NRE 小计 <strong>{formatWan(indCalc.nreWan)}</strong>
            </div>
            <div style={{flex:1}}/>
            <button onClick={handleIndividualSubmit} disabled={!cardsLoaded || indCalc.cnt < 1 || isSubmittingIndividual} style={{padding:"6px 20px",borderRadius:8,background:(cardsLoaded&&indCalc.cnt>=1)?"#1a5c3a":"#d1d5db",color:"#fff",border:"none",fontSize:13,fontWeight:700,cursor:isSubmittingIndividual?"wait":(cardsLoaded&&indCalc.cnt>=1?"pointer":"not-allowed"),opacity:isSubmittingIndividual?0.7:1}}>
              {isSubmittingIndividual ? "提交中..." : "提交个人选卡 →"}
            </button>
          </div>
          {rdCardsError && (
            <div style={{margin:"0 0 12px",padding:"10px 14px",borderRadius:8,background:"#fef2f2",border:"1px solid #fecaca",fontSize:12,color:"#991b1b",lineHeight:1.7}}>
              {rdCardsError}
            </div>
          )}
          {!cardsLoaded && !rdCardsError && (
            <div style={{margin:"0 0 12px",padding:"10px 14px",borderRadius:8,background:"#f9fafb",border:"1px solid #e5e7eb",fontSize:12,color:"#6b7280",lineHeight:1.7}}>
              正在加载研发能力卡成本数据……
            </div>
          )}
          {isSubmittingIndividual && (
            <div style={{margin:"0 0 12px",padding:"10px 14px",borderRadius:8,background:"#fffbeb",border:"1px solid #fde68a",fontSize:12,color:"#92400e",lineHeight:1.7}}>
              正在提交个人选卡，请稍候。提交成功后会自动进入团队合并。
            </div>
          )}
          {isLeader && myCardSelectionSubmitted && teamStatus === "R2_INDIVIDUAL_CARDS" && pendingCardMembers.length > 0 && (
            <div style={{margin:"0 0 12px",padding:"12px 14px",borderRadius:10,background:"#fff7ed",border:"1px solid #fed7aa",fontSize:12,color:"#9a3412",lineHeight:1.7}}>
              <div>
                等待 {pendingCardMembers.map((item) => item.name || item.id).join("、")} 提交选卡中…
              </div>
              {canShowForceAdvanceCards ? (
                <button
                  type="button"
                  onClick={handleForceAdvanceCards}
                  disabled={forceAdvanceGate === "cards"}
                  style={{marginTop:8,padding:"7px 0",borderRadius:0,border:"none",background:"transparent",color:"#c2410c",fontSize:12,fontWeight:800,cursor:forceAdvanceGate === "cards" ? "wait" : "pointer",textDecoration:"underline"}}
                >
                  {forceAdvanceGate === "cards" ? "正在推进…" : "长时间未响应？跳过未完成成员，继续推进"}
                </button>
              ) : (
                <div style={{marginTop:6,color:"#b45309"}}>
                  {`为防误触，${formatForceAdvanceCountdown(cardsForceRemainingMs)}后可由组长跳过未完成成员。`}
                </div>
              )}
            </div>
          )}

          {/* Interview summary for reference while selecting cards */}
          <div style={{padding:"14px 18px",borderRadius:10,background:"#f0fdf4",border:"1.5px solid #bbf7d0",marginBottom:8}}>
            <div style={{fontSize:13,fontWeight:700,color:"#166534",marginBottom:6}}>{isSummaryMode ? "📄 已冻结调研报告摘录" : "🎙️ 你的访谈洞察"}</div>
            <div style={{fontSize:13,color:"#374151",lineHeight:1.8,marginBottom:10}}>
              {isSummaryMode
                ? (selectedPersonaSummaryText || "请先在上一步阅读调研报告，再根据这份报告选卡。")
                : (buildInterviewSummary(interviewResult, memberDims) || "请先完成真实访谈，再根据提炼结果选卡。")}
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
        const currentGM = calcGM(teamCalc.cost, teamPrice || fallbackPrice, channelFee, baseCost);
        const gmColor = "#374151";
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
                const cards = cardCatalog[dim.id]||[];
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

          {/* Shared interview narrative */}
          <div style={{marginBottom:20}}>
            <div style={{fontSize:14,fontWeight:700,color:"#374151",marginBottom:10}}>🎙️ 访谈洞察</div>
            {mergeError && (
              <div style={{padding:"10px 14px",borderRadius:8,background:"#FEF2F2",border:"1px solid #FECACA",fontSize:12,color:"#991B1B",marginBottom:10}}>
                {mergeError}
              </div>
            )}
            {isSummaryMode && mergeData?.mergedInterview?.summaryText && (
              <div style={{padding:"12px 14px",borderRadius:10,background:"#f8fafc",border:"1px solid #e5e7eb",fontSize:13,color:"#374151",lineHeight:1.8,marginBottom:10}}>
                <strong style={{display:"block",marginBottom:6,color:"#111827"}}>团队共享客户叙事</strong>
                {mergeData.mergedInterview.summaryText}
              </div>
            )}
            {!isSummaryMode && mergeData?.mergedInterview?.tags?.length > 0 && (
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
            <div style={{flex:"1 1 260px",padding:"16px 20px",borderRadius:12,background:"#f9fafb",border:"1.5px solid #e5e7eb"}}>
              <div style={{fontSize:12,fontWeight:600,color:"#6b7280",marginBottom:4}}>当前毛利率</div>
              <div style={{display:"flex",alignItems:"baseline",gap:8}}>
                <span style={{fontSize:32,fontWeight:800,color:gmColor}}>{currentGM.toFixed(0)}%</span>
              </div>
              <div style={{width:"100%",height:8,borderRadius:4,background:"#e5e7eb",marginTop:8}}>
                <div style={{width:`${Math.min(Math.max(currentGM,0)/60*100,100)}%`,height:"100%",borderRadius:4,background:"#64748b",transition:"width 0.3s"}}/>
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
                {formatWan(teamCalc.nreWan)}
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
              当前共选 {teamCalc.cnt} 张卡，研发投入 {formatWan(teamCalc.nreWan)}。
            </div>
          )}

          <div style={{padding:"14px 16px",borderRadius:10,background:"#f9fafb",border:"1px solid #e5e7eb",marginBottom:16}}>
            <div style={{fontSize:13,fontWeight:700,color:"#374151",marginBottom:8}}>已合并能力卡</div>
            <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
              {DIMS.flatMap((dim) => {
                const cards = cardCatalog[dim.id] || [];
                return cards
                  .filter((card) => teamSel[card.id])
                  .map((card) => {
                    const td = card.tiers[teamSel[card.id]];
                    return (
                      <span key={card.id} style={{fontSize:11,padding:"4px 8px",borderRadius:999,background:"#fff",border:"1px solid #e5e7eb",color:"#374151"}}>
                        {card.n} · {td.l} · {formatSignedCurrency(td.cost)}/台 · NRE {formatWan(td.nre)}
                      </span>
                    );
                  });
              })}
            </div>
          </div>

          <div style={{padding:"10px 14px",borderRadius:8,background:"#FEF3C7",border:"1px solid #FDE68A",fontSize:12,color:"#92400E"}}>
            💡 接下来进入团队讨论和定价。你们已经能看到每张卡的具体 dCOGS 和 NRE，可以开始砍卡、降档或改价格。
          </div>
          <button onClick={()=>setStep(4)} style={BS}>继续</button>
        </div>
        );
      })()}

      {/* ═══ Step 4: 集体讨论 (full cost info, adjustable) ═══ */}
      {step===4 && (() => {
        const currentGM = calcGM(teamCalc.cost, teamPrice || fallbackPrice, channelFee, baseCost);
        const gmOk = currentGM >= GM_FLOOR;
        const gmColor = "#374151";
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
                {/* Interview insights */}
                <div style={{marginBottom:10}}>
                  <div style={{fontSize:12,fontWeight:700,color:"#374151",marginBottom:6}}>访谈洞察</div>
                  {mergeData?.mergedInterview?.summaryText ? (
                    <div style={{fontSize:12,color:"#555",lineHeight:1.7}}>
                      {mergeData.mergedInterview.summaryText}
                    </div>
                  ) : mergeData?.mergedInterview?.tags?.length > 0 ? (
                    <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
                      {mergeData.mergedInterview.tags.slice(0, 8).map((item, index) => (
                        <span key={`${item.tag || item}-${index}`} style={{fontSize:11,padding:"3px 8px",borderRadius:999,background:"#EFF6FF",color:"#1E40AF",fontWeight:600}}>
                          #{String(item.tag || item)}
                        </span>
                      ))}
                    </div>
                  ) : (
                    <div style={{fontSize:12,color:"#6b7280",lineHeight:1.7}}>请结合已经完成的访谈记录与团队讨论做取舍。</div>
                  )}
                </div>
                {/* Mini radar */}
                <RadarChart sels={teamSel}/>
              </div>
            </details>
          </div>

          {/* Sticky metrics — neutral margin */}
          <div style={{position:"sticky",top:0,zIndex:10,display:"flex",gap:10,padding:"10px 16px",background:"#fff",border:"1px solid #e5e7eb",borderTop:"none",borderRadius:"0 0 14px 14px",marginBottom:8,boxShadow:"0 2px 8px rgba(0,0,0,0.04)",flexWrap:"wrap"}}>
            <div style={{padding:"6px 14px",borderRadius:8,background:"#f9fafb",border:"1px solid #e5e7eb",fontSize:13,fontWeight:700,color:gmColor}}>
              预期毛利率：{currentGM.toFixed(0)}%
            </div>
            <div style={{padding:"6px 14px",borderRadius:8,background:"#f9fafb",border:"1px solid #e5e7eb",fontSize:13}}>
              已选 <strong>{teamCalc.cnt}</strong> 张
            </div>
            <div style={{flex:1}}/>
            <div style={{padding:"6px 14px",borderRadius:8,background:(teamCalc.cnt>=MIN_TEAM_CARDS&&gmOk)?"#F0FDF4":"#FEF2F2",border:(teamCalc.cnt>=MIN_TEAM_CARDS&&gmOk)?"1px solid #BBF7D0":"1px solid #FECACA",fontSize:12,fontWeight:600,color:(teamCalc.cnt>=MIN_TEAM_CARDS&&gmOk)?"#166534":"#DC2626"}}>
              {!gmOk?`毛利率需 ≥ ${GM_FLOOR}%`:teamCalc.cnt<MIN_TEAM_CARDS?`还需 ${MIN_TEAM_CARDS-teamCalc.cnt} 张`:"\u2713 选卡就绪，下方定价"}
            </div>
          </div>
          {DIMS.map(dim => renderDimGroup(dim.id, teamSel, true, "team"))}

          {/* ── Cost breakdown ── */}
          <div style={{background:"#fff",borderRadius:14,padding:20,border:"1px solid #e5e7eb",marginTop:12}}>
            <h3 style={{fontSize:16,fontWeight:800,margin:"0 0 12px"}}>📊 成本核算</h3>
            <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(180px,1fr))",gap:10,marginBottom:12}}>
              <div style={{padding:"12px 14px",borderRadius:10,background:"#f9fafb",border:"1px solid #e5e7eb"}}>
                <div style={{fontSize:11,color:"#6b7280"}}>基础制造成本</div>
                <div style={{fontSize:22,fontWeight:800,color:"#374151",marginTop:4}}>{formatYuan(baseCost)}</div>
                <div style={{fontSize:10,color:"#999"}}>材料+组装+包装/台</div>
              </div>
              <div style={{padding:"12px 14px",borderRadius:10,background:teamCalc.cost>0?"#FEF3C7":"#F0FDF4",border:teamCalc.cost>0?"1px solid #FDE68A":"1px solid #BBF7D0"}}>
                <div style={{fontSize:11,color:"#6b7280"}}>dCOGS 合计</div>
                <div style={{fontSize:22,fontWeight:800,color:teamCalc.cost>0?"#D97706":"#2FAB6E",marginTop:4}}>{formatSignedCurrency(teamCalc.cost)}</div>
                <div style={{fontSize:10,color:"#999"}}>选卡带来的单位变动成本</div>
              </div>
              <div style={{padding:"12px 14px",borderRadius:10,background:"#fffbeb",border:"1px solid #fde68a"}}>
                <div style={{fontSize:11,color:"#6b7280"}}>NRE 合计</div>
                <div style={{fontSize:22,fontWeight:800,color:"#92400e",marginTop:4}}>{formatWan(teamCalc.nreWan)}</div>
                <div style={{fontSize:10,color:"#999"}}>按当前档位累加的一次性研发投入</div>
              </div>
              <div style={{padding:"12px 14px",borderRadius:10,background:"#EFF6FF",border:"1px solid #BFDBFE"}}>
                <div style={{fontSize:11,color:"#6b7280"}}>单台总变动成本</div>
                <div style={{fontSize:22,fontWeight:800,color:"#1E40AF",marginTop:4}}>{formatYuan(teamUnitCost)}</div>
                <div style={{fontSize:10,color:"#999"}}>V + dCOGS</div>
              </div>
            </div>
            {/* Per-dimension cost breakdown */}
            <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
              {DIMS.map(dim => {
                const cards = cardCatalog[dim.id]||[];
                const dimCost = cards.reduce((sum,c) => sum + (teamSel[c.id] ? c.tiers[teamSel[c.id]].cost : 0), 0);
                const dimNre = cards.reduce((sum,c) => sum + (teamSel[c.id] ? c.tiers[teamSel[c.id]].nre : 0), 0);
                if (dimCost === 0 && dimNre === 0) return null;
                return (
                  <span key={dim.id} style={{fontSize:11,padding:"3px 8px",borderRadius:4,background:dim.c+"10",color:dim.c,fontWeight:600,border:`1px solid ${dim.c}25`}}>
                    {dim.icon} {formatSignedCurrency(dimCost)} / NRE {formatWan(dimNre)}
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
                <div style={{fontSize:11,color:"#6b7280"}}>Round 1 锚定市场</div>
                <div style={{fontSize:18,fontWeight:800,color:"#166534",marginTop:4}}>{recapComparison.round1.gridLabel}</div>
                <div style={{fontSize:11,color:"#15803d",marginTop:6}}>
                  SAM {recapComparison.round1.sam} / WTPadj {recapComparison.round1.wtp}
                </div>
                <div style={{fontSize:10,color:"#888"}}>这是你们在第一轮选择的市场与支付意愿基线。</div>
              </div>
              <div style={{padding:"12px 14px",borderRadius:10,background:"#faf5ff",border:"1.5px solid #e9d5ff"}}>
                <div style={{fontSize:11,color:"#6b7280"}}>价值主张对支付意愿的影响</div>
                <div style={{fontSize:22,fontWeight:800,color:"#7c3aed",marginTop:4}}>{formatSignedPercent(wtpFinalPct)}</div>
                <div style={{fontSize:10,color:"#888"}}>仅看 VP 本身 {formatSignedPercent(wtpBasePct)}，市场锦囊额外影响 {formatSignedPercent(wtpJinangDeltaPct)}</div>
              </div>
            </div>
            <div style={{fontSize:12,color:"#555",lineHeight:1.7,padding:"10px 14px",borderRadius:8,background:"#f9fafb",border:"1px solid #e5e7eb"}}>
              <strong>定价参考框架：</strong>当前单台变动成本是 {formatYuan(teamUnitCost)}，固定成本是 {formatWan(teamFixedCostWan)}（基础 {formatWan(fixedBaseWan)} + NRE {formatWan(teamCalc.nreWan)}）。渠道抽走 {Math.round(channelFee*100)}% 后到手更少，你们需要在价格、销量和固定投入之间找到平衡。
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
                  <strong>产品力影响：</strong>产品能力组合越精准匹配目标场景，用户对价格的敏感度越低——好产品可以卖更贵。
                </div>
              </div>
            </div>

            {/* Price slider */}
            <div style={{padding:"20px",borderRadius:12,background:"#f0fdf4",border:"1.5px solid #bbf7d0",marginBottom:16}}>
              <div style={{fontSize:14,fontWeight:700,color:"#374151",marginBottom:12}}>产品售价</div>
              <div style={{fontSize:36,fontWeight:800,color:"#1a5c3a",marginBottom:8}}>{formatYuan(teamPrice)}</div>
              <input
                data-testid="r2-price-input"
                type="range"
                min={priceMin}
                max={priceMax}
                step={priceStep}
                value={clampPriceToContext(teamPrice, effectivePricingContext)}
                onInput={e => {
                  round2DraftTouchedRef.current = true;
                  setTeamPrice(+e.target.value);
                }}
                onChange={e => {
                  round2DraftTouchedRef.current = true;
                  setTeamPrice(+e.target.value);
                }}
                disabled={round2TeamControlsLocked || !priceSliderReady}
                style={{width:"100%",height:8,borderRadius:4,cursor:(round2TeamControlsLocked || !priceSliderReady) ? "not-allowed" : "pointer"}}
              />
              <div style={{display:"flex",justifyContent:"space-between",fontSize:11,color:"#999",marginTop:4}}>
                <span>{priceSliderReady ? `${formatYuan(priceMin)}（低价走量）` : "定价区间加载中"}</span>
                <span>{priceSliderReady ? `${formatYuan(priceMax)}（高端定位）` : ""}</span>
              </div>
            </div>

            {/* Channel deduction - real-time */}
            <div style={{display:"flex",gap:10,marginBottom:16,alignItems:"center"}}>
              <div style={{flex:1,padding:"12px 16px",borderRadius:10,border:"1.5px solid #D9770630",background:"#D9770608",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                <div>
                  <div style={{fontSize:11,color:"#6b7280"}}>渠道抽成 {Math.round(channelFee*100)}% 后，每台到手</div>
                  <div style={{fontSize:24,fontWeight:800,color:"#D97706",marginTop:2}}>{formatYuan(teamPrice * (1 - channelFee))}</div>
                </div>
                <div style={{fontSize:12,color:"#999",textAlign:"right"}}>
                  售价 {formatYuan(teamPrice)}<br/>
                  − 渠道 {formatYuan(teamPrice * channelFee)}
                </div>
              </div>
            </div>

            <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(180px,1fr))",gap:10,marginBottom:16}}>
              <div style={{padding:"12px 14px",borderRadius:10,background:"#f9fafb",border:"1px solid #e5e7eb"}}>
                <div style={{fontSize:11,color:"#6b7280"}}>总固定成本</div>
                <div style={{fontSize:22,fontWeight:800,color:"#374151",marginTop:4}}>{formatWan(teamFixedCostWan)}</div>
                <div style={{fontSize:10,color:"#999"}}>基础 {formatWan(fixedBaseWan)} + 研发 {formatWan(teamCalc.nreWan)}</div>
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
                  ? `毛利率需 ≥ ${GM_FLOOR}% 才可提交`
                  : teamCalc.cnt < MIN_TEAM_CARDS
                    ? `还需选 ${MIN_TEAM_CARDS-teamCalc.cnt} 张能力卡`
                    : "提交并查看结果"}
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
              const cards = cardCatalog[dim.id]||[];
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
              <div style={{fontSize:20,fontWeight:800,color:"#374151",marginTop:4}}>{formatYuan(teamUnitCost)}</div>
            </div>
            <div style={{padding:"12px 14px",borderRadius:10,background:"#f0fdf4",border:"1.5px solid #bbf7d0"}}>
              <div style={{fontSize:11,color:"#6b7280"}}>定价</div>
              <div style={{fontSize:20,fontWeight:800,color:"#166534",marginTop:4}}>{formatYuan(teamPrice)}</div>
            </div>
            <div style={{padding:"12px 14px",borderRadius:10,background:"#D9770608",border:"1.5px solid #D9770630"}}>
              <div style={{fontSize:11,color:"#6b7280"}}>渠道抽成后到手</div>
              <div style={{fontSize:20,fontWeight:800,color:"#D97706",marginTop:4}}>{formatYuan(teamPrice * (1 - channelFee))}</div>
            </div>
            <div style={{padding:"12px 14px",borderRadius:10,background:"#fffbeb",border:"1.5px solid #fde68a"}}>
              <div style={{fontSize:11,color:"#6b7280"}}>固定成本</div>
              <div style={{fontSize:20,fontWeight:800,color:"#92400e",marginTop:4}}>{formatWan(teamFixedCostWan)}</div>
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
            <button data-testid="r2-final-submit" onClick={handleFinalSubmit} disabled={isSubmittingFinal || round2TeamControlsLocked || !hasMergedInterviewReady} style={{...BS,flex:1,opacity:isSubmittingFinal||round2TeamControlsLocked||!hasMergedInterviewReady?0.7:1,cursor:isSubmittingFinal?"wait":((round2TeamControlsLocked||!hasMergedInterviewReady)?"not-allowed":"pointer")}}>
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
              <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(220px,1fr))",gap:10,margin:"18px 0"}}>
                <div style={{padding:"14px 16px",borderRadius:12,background:"#f8fafc",border:"1px solid #e2e8f0"}}>
                  <div style={{fontSize:12,fontWeight:800,color:"#334155",marginBottom:8}}>Round 1 / Round 2 两线对比</div>
                  <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:10}}>
                    <div style={{padding:"10px 12px",borderRadius:10,background:"#ffffff",border:"1px solid #e2e8f0"}}>
                      <div style={{fontSize:11,color:"#64748b",marginBottom:6}}>Round 1（你说要做什么）</div>
                      <div style={{fontSize:13,color:"#1f2937",lineHeight:1.8}}>
                        <div>目标市场：<strong>{recapComparison.round1.gridLabel}</strong></div>
                        <div>市场规模：<strong>{recapComparison.round1.sam}</strong></div>
                        <div>WTP：<strong>{recapComparison.round1.wtp}</strong></div>
                      </div>
                    </div>
                    <div style={{padding:"10px 12px",borderRadius:10,background:"#f8fafc",border:"1px solid #dbeafe"}}>
                      <div style={{fontSize:11,color:"#64748b",marginBottom:6}}>Round 2（你实际做了什么）</div>
                      <div style={{fontSize:13,color:"#1f2937",lineHeight:1.8}}>
                        <div>最匹配格子：<strong>{recapComparison.round2.gridLabel}</strong></div>
                        <div>市场规模：<strong>{recapComparison.round2.sam}</strong></div>
                        <div>WTP：<strong>{recapComparison.round2.wtp}</strong></div>
                      </div>
                      {recapComparison.round2.detail && (
                        <div style={{fontSize:10,color:"#64748b",marginTop:6}}>{recapComparison.round2.detail}</div>
                      )}
                    </div>
                  </div>
                  <div style={{fontSize:13,color:"#475569",lineHeight:1.8}}>
                    <div>市场锦囊反馈：<strong>{teamRecap?.jinang_market?.match_tier || "待揭示"}</strong></div>
                    <div>VP 评分：<strong>{round1ScoresRevealed ? `C ${recapVpC.toFixed(1)} / G ${recapVpG.toFixed(1)} / E ${recapVpE.toFixed(1)}` : "待揭示"}</strong></div>
                  </div>
                  {recapComparison.alignmentLabel && (
                    <div style={{marginTop:10,padding:"10px 12px",borderRadius:10,background:"#ffffff",border:"1px dashed #cbd5e1",fontSize:12,color:"#475569",lineHeight:1.7}}>
                      <strong>{recapComparison.alignmentLabel}</strong>
                      {recapComparison.alignmentDetail ? `：${recapComparison.alignmentDetail}` : ""}
                    </div>
                  )}
                </div>
                <div style={{padding:"14px 16px",borderRadius:12,background:"#eff6ff",border:"1px solid #bfdbfe"}}>
                  <div style={{fontSize:12,fontWeight:800,color:"#1d4ed8",marginBottom:8}}>Round 2 最终结果</div>
                  <div style={{fontSize:13,color:"#1e3a8a",lineHeight:1.8}}>
                    <div>销量：<strong>{Number(submittedCalc.units || 0).toLocaleString()} 台</strong></div>
                    <div>利润：<strong>{formatSignedCurrency(Math.round(Number(submittedCalc.profit || 0)))}</strong></div>
                    <div>单台毛利：<strong>{formatSignedCurrency(Math.round(Number(submittedCalc.unitMargin || 0)))}</strong></div>
                  </div>
                </div>
              </div>
              <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(180px,1fr))",gap:10,margin:"18px 0"}}>
                <div style={{padding:"14px 16px",borderRadius:10,background:"#eff6ff",border:"1px solid #bfdbfe"}}>
                  <div style={{fontSize:11,color:"#6b7280"}}>实际销量 Q</div>
                  <div style={{fontSize:26,fontWeight:800,color:"#1d4ed8",marginTop:4}}>{Number(submittedCalc.units || 0).toLocaleString()} 台</div>
                </div>
                <div style={{padding:"14px 16px",borderRadius:10,background:"#f0fdf4",border:"1px solid #bbf7d0"}}>
                  <div style={{fontSize:11,color:"#6b7280"}}>收入（渠道后）</div>
                  <div style={{fontSize:26,fontWeight:800,color:"#166534",marginTop:4}}>{formatYuan(submittedCalc.revenueNet)}</div>
                </div>
                <div style={{padding:"14px 16px",borderRadius:10,background:"#fff7ed",border:"1px solid #fed7aa"}}>
                  <div style={{fontSize:11,color:"#6b7280"}}>变动成本</div>
                  <div style={{fontSize:26,fontWeight:800,color:"#c2410c",marginTop:4}}>{formatYuan(submittedCalc.variableCost)}</div>
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
                  <div style={{fontSize:22,fontWeight:800,color:"#374151",marginTop:4}}>{formatYuan(Number(submittedCalc.fixedCost || submittedCalc.f_total || 0))}</div>
                  <div style={{fontSize:10,color:"#999"}}>基础 {formatWan(fixedBaseWan)} + 研发 {formatWan(submittedCalc.nre_total_wan || 0)}</div>
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
                收入 {formatYuan(submittedCalc.revenueNet)}
                {" "}− 变动成本 {formatYuan(submittedCalc.variableCost)}
                {" "}− 固定成本 {formatYuan(Number(submittedCalc.fixedCost || submittedCalc.f_total || 0))}
                {Number(submittedCalc.profitSub || 0) ? ` + 订阅贡献 ${formatYuan(submittedCalc.profitSub)}` : ""}
                {Number(submittedCalc.penalty || 0) ? ` − Penalty ${formatYuan(submittedCalc.penalty)}` : ""}
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
