import { useState, useEffect, useRef } from "react";
import {
  createTeam,
  getMemberJinang,
  submitPersonalChoice,
  getTeamStatus,
  getSubmissions,
  savePhase2Draft,
  savePhase3Draft,
  synthesizeTeamVP,
  chatWithCoach,
  extractVpFields,
  confirmAndScoreVp,
  finalizeDecision,
  getPhase3State,
  getResults,
  freezeTeam
} from "../api/teamApi";
import {
  consumeRound1ReviewIntent,
  clearStudentSession,
  mergeStudentSession,
  readStudentSession,
  shouldOpenRound2,
  writeStudentSession
} from "../utils/studentSession";
import { downloadTxtFile, formatExportTime } from "../utils/txtExport";

// ── Data: 20 锦囊 Cards ──────────────────────────────────────────
const MARKET_CARDS = [
  {
    id: "M01",
    title: "银发社区合伙人",
    subtitle: "渠道 · 老年市场",
    desc: "你在养老社区有深度合作关系，能以远低于市场价的成本铺设线下体验点。适合面向老年人群的直销或体验式渠道。",
    tags: ["老人", "ToC", "渠道优势"],
    icon: "🏘️",
    affinity: { age: "ELDER", channel: "DIRECT" },
    round: "R1",
  },
  {
    id: "M02",
    title: "母婴KOL矩阵",
    subtitle: "流量 · 儿童市场",
    desc: "你的团队运营着一个头部母婴内容矩阵，能快速触达有娃家庭的决策者（父母），电商转化率显著高于行业均值。",
    tags: ["儿童", "ToC", "电商流量"],
    icon: "👶",
    affinity: { age: "CHILD", channel: "ECOM" },
    round: "R1",
  },
  {
    id: "M03",
    title: "企业福利采购入口",
    subtitle: "客户 · B2B通道",
    desc: "你有大型企业HR部门的采购关系网，能将机器人打包进员工福利或企业礼品方案，单笔订单量大且决策链短。",
    tags: ["ToB", "成人", "批量采购"],
    icon: "🏢",
    affinity: { customer: "ToB", age: "ADULT" },
    round: "R1",
  },
  {
    id: "M04",
    title: "跨境供应链资源",
    subtitle: "成本 · 全球采购",
    desc: "你有成熟的跨境供应链管理经验和海外代工合作方，能在不牺牲品质的前提下显著压缩硬件生产成本。",
    tags: ["成本领先", "供应链"],
    icon: "🚢",
    affinity: { strategy: "COST" },
    round: "R1+R2",
  },
  {
    id: "M05",
    title: "高端体验店联盟",
    subtitle: "品牌 · 差异化渠道",
    desc: "你与多家高端商场和生活方式买手店有合作协议，能让产品出现在'被策展'的零售场景中，提升品牌调性和支付意愿。",
    tags: ["差异化", "成人", "品牌溢价"],
    icon: "✨",
    affinity: { strategy: "DIFF", age: "ADULT" },
    round: "R1",
  },
  {
    id: "M06",
    title: "政府养老补贴通道",
    subtitle: "政策 · 机构市场",
    desc: "你了解地方政府的智慧养老补贴政策，能帮助养老机构以补贴价采购，降低机构客户的实际支付门槛。",
    tags: ["ToB", "老人", "政策红利"],
    icon: "🏛️",
    affinity: { customer: "ToB", age: "ELDER" },
    round: "R1",
  },
  {
    id: "M07",
    title: "教育渠道独家协议",
    subtitle: "渠道 · 教育场景",
    desc: "你与多家幼儿园和小学课后托管机构有框架合作，能直接将产品植入教育场景，家长接受度高且续费粘性强。",
    tags: ["ToB", "儿童", "教育场景"],
    icon: "🎓",
    affinity: { customer: "ToB", age: "CHILD" },
    round: "R1",
  },
  {
    id: "M08",
    title: "社交裂变运营团队",
    subtitle: "增长 · 用户获取",
    desc: "你的团队擅长私域流量运营和社交裂变，能以极低获客成本快速起量，特别适合单价适中、话题性强的消费品。",
    tags: ["ToC", "成本领先", "增长"],
    icon: "📱",
    affinity: { customer: "ToC", strategy: "COST" },
    round: "R1",
  },
  {
    id: "M09",
    title: "医疗健康合规资质",
    subtitle: "壁垒 · 健康场景",
    desc: "你持有医疗器械二类备案资质和健康数据合规认证，能让产品进入'健康管理'品类，打开医院和康复中心的采购通道。",
    tags: ["ToB", "老人", "差异化壁垒"],
    icon: "🏥",
    affinity: { customer: "ToB", age: "ELDER", strategy: "DIFF" },
    round: "R1+R2",
  },
  {
    id: "M10",
    title: "订阅内容合作生态",
    subtitle: "商业模式 · 订阅增值",
    desc: "你有IP内容授权和持续内容生产能力（故事、音乐、互动剧本），能支撑'硬件+订阅'商业模式，提升用户生命周期价值。",
    tags: ["差异化", "订阅", "内容生态"],
    icon: "🎭",
    affinity: { strategy: "DIFF" },
    round: "R2",
  },
];

const TECH_CARDS = [
  {
    id: "T01",
    title: "低成本语音芯片方案",
    subtitle: "硬件 · 语音交互",
    desc: "你有一颗经过验证的国产语音AI芯片，功耗和成本都远低于主流方案，能让语音交互功能的BOM大幅下降。",
    tags: ["成本领先", "语音", "降本"],
    icon: "🔊",
    affinity: { strategy: "COST", r2dim: "交互与表达" },
    round: "R2",
  },
  {
    id: "T02",
    title: "情感计算算法专利",
    subtitle: "软件 · 情感识别",
    desc: "你的团队拥有多模态情感识别的核心专利（语音+表情+体态），识别准确率领先，能实现真正'读懂情绪'的陪伴体验。",
    tags: ["差异化", "感知", "专利壁垒"],
    icon: "🧠",
    affinity: { strategy: "DIFF", r2dim: "感知与理解" },
    round: "R2",
  },
  {
    id: "T03",
    title: "模块化机身设计能力",
    subtitle: "硬件 · 可定制外观",
    desc: "你有成熟的模块化工业设计团队，能快速出多款外壳/配件，支持不同年龄段和场景的外观定制，降低换代成本。",
    tags: ["多年龄段", "外观", "灵活"],
    icon: "🧩",
    affinity: { r2dim: "可扩展与连接" },
    round: "R2",
  },
  {
    id: "T04",
    title: "跌倒检测传感器套件",
    subtitle: "硬件 · 安全监护",
    desc: "你拿到了一款医疗级跌倒检测传感器的独家代理，体积小、误报率低，能让机器人兼具'安全守护'功能。",
    tags: ["老人", "安全", "健康监护"],
    icon: "🛡️",
    affinity: { age: "ELDER", r2dim: "安全与信任" },
    round: "R2",
  },
  {
    id: "T05",
    title: "端侧大模型部署经验",
    subtitle: "软件 · 本地AI",
    desc: "你的团队有在边缘设备部署轻量大模型的成熟经验，能实现离线多轮对话，不依赖云端，隐私保护和响应速度都更好。",
    tags: ["差异化", "隐私", "对话"],
    icon: "⚡",
    affinity: { strategy: "DIFF", r2dim: "交互与表达" },
    round: "R2",
  },
  {
    id: "T06",
    title: "机器人运动控制IP",
    subtitle: "硬件 · 运动能力",
    desc: "你有自研的小型机器人运动控制方案（步态/平衡/避障），能让机器人在家庭环境中自由移动，而不只是桌面摆件。",
    tags: ["运动", "差异化", "家庭场景"],
    icon: "🦿",
    affinity: { strategy: "DIFF", r2dim: "运动与导航" },
    round: "R2",
  },
  {
    id: "T07",
    title: "OTA远程运维平台",
    subtitle: "软件 · 运维效率",
    desc: "你有成熟的IoT设备远程诊断和OTA升级平台，能大幅降低售后维护成本，支持大规模部署后的远程管理。",
    tags: ["ToB", "运维", "降本"],
    icon: "🔧",
    affinity: { customer: "ToB", r2dim: "可运营与可维护" },
    round: "R2",
  },
  {
    id: "T08",
    title: "儿童安全交互认证",
    subtitle: "合规 · 儿童安全",
    desc: "你的产品已通过儿童产品安全认证（含材料/电磁/数据隐私），这在儿童市场是硬性门槛，竞争对手多数不具备。",
    tags: ["儿童", "安全", "合规壁垒"],
    icon: "🧸",
    affinity: { age: "CHILD", r2dim: "安全与信任" },
    round: "R2",
  },
  {
    id: "T09",
    title: "低功耗续航方案",
    subtitle: "硬件 · 电池续航",
    desc: "你有一套经过量产验证的低功耗方案（含芯片选型+电源管理），能在不增加电池体积的前提下让续航翻倍。",
    tags: ["成本领先", "续航", "用户体验"],
    icon: "🔋",
    affinity: { strategy: "COST", r2dim: "可运营与可维护" },
    round: "R2",
  },
  {
    id: "T10",
    title: "开放API与生态接口",
    subtitle: "软件 · 平台化",
    desc: "你有构建开发者生态的经验和现成SDK，能让第三方开发者为机器人开发技能和内容，形成平台效应。",
    tags: ["差异化", "平台", "生态"],
    icon: "🔌",
    affinity: { strategy: "DIFF", r2dim: "可扩展与连接" },
    round: "R2",
  },
];

const ALL_CARDS = [...MARKET_CARDS, ...TECH_CARDS];

// ── UI Components ──────────────────────────────────────────
const GRID_LABELS = {
  customer: ["ToC (消费者)", "ToB (企业)"],
  strategy: ["差异化", "成本领先"],
  age: ["儿童", "成人", "老人"],
};

const FLOW_STEPS = [
  { id: 0, label: "建组", short: "建组" },
  { id: 1, label: "个人锦囊", short: "锦囊" },
  { id: 2, label: "选战略", short: "选战略" },
  { id: 3, label: "战略分布", short: "分布" },
  { id: 4, label: "价值主张", short: "价值主张" },
  { id: 5, label: "结果", short: "结果" },
];

const MEMBER_COLORS = [
  "#E8634A", "#3B82C4", "#2FAB6E", "#D4A03C", "#8B5CF6", "#EC4899"
];
const MEMBER_NAMES = ["成员A", "成员B", "成员C", "成员D", "成员E", "成员F"];
const ARCH_OPTIONS = [
  { key: "Experience", label: "体验", symbol: "●" },
  { key: "Hybrid", label: "混合", symbol: "▲" },
  { key: "Function", label: "功能", symbol: "■" }
];
function archToSymbol(architecture) {
  if (architecture === "Hybrid") return "▲";
  if (architecture === "Function") return "■";
  return "●";
}

function archToLabel(architecture) {
  if (architecture === "Hybrid") return "混合";
  if (architecture === "Function") return "功能";
  return "体验";
}

function formatGridIdCn(gridId) {
  const raw = String(gridId || "").trim();
  if (!raw) return "--";
  const parts = raw.split("_");
  if (parts.length < 3) return raw;
  const customer = parts[0] === "ToB" ? "ToB" : "ToC";
  const strategy = String(parts[1]).includes("Cost") ? "成本" : "差异";
  const age = parts[2] === "Child" ? "儿童" : (parts[2] === "Elder" ? "老人" : "成人");
  return `${customer}·${strategy}·${age}`;
}

function formatUiCellCn(cell) {
  const raw = String(cell || "").trim();
  if (!raw) return "--";
  const parts = raw.split("_");
  if (parts.length < 3) return raw;
  const customer = parts[0] === "ToB" ? "ToB" : "ToC";
  const strategy = parts[1] === "COST" ? "成本" : "差异";
  const age = parts[2] === "CHILD" ? "儿童" : (parts[2] === "ELDER" ? "老人" : "成人");
  return `${customer}·${strategy}·${age}`;
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
    boundary: pick("BOUNDARY"),
    archConsistency: pick("架构一致性"),
    coachComment: pick("AI策略顾问点评") || pick("Coach 最终评价")
  };
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
  return raw
    .replace(/\bWHO\s*[：:]\s*/g, "为")
    .replace(/\bPAIN\s*[：:]\s*/g, "，在")
    .replace(/\bHOW\s*[：:]\s*/g, "的场景下，LOVOT通过")
    .replace(/\bBOUNDARY\s*[：:]\s*/g, "。适用边界：")
    .replace(/\s+/g, " ")
    .trim();
}

function cardMatchesCell(card, cellKey) {
  if (!card || !card.affinity || !cellKey) return false;
  const [customer, strategy, age] = String(cellKey).split("_");
  const affinity = card.affinity || {};

  const keys = ["customer", "strategy", "age"].filter((k) => Boolean(affinity[k]));
  if (!keys.length) return false;

  for (const key of keys) {
    const expected = String(affinity[key]);
    const actual = key === "customer" ? customer : key === "strategy" ? strategy : age;
    if (expected !== actual) return false;
  }
  return true;
}

function toPercentChange(adj, ref) {
  const a = Number(adj || 0);
  const b = Number(ref || 0);
  if (!Number.isFinite(a) || !Number.isFinite(b) || b <= 0) return 0;
  return Math.round(((a / b) - 1) * 100);
}

function normalizeScoreValue(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.max(1, Math.min(5, Math.round(n * 10) / 10));
}

function normalizeApiScores(scores) {
  const src = scores && typeof scores === "object" ? scores : {};
  return {
    coverage: normalizeScoreValue(src.coverage),
    generalizability: normalizeScoreValue(src.generalizability),
    effectiveness: normalizeScoreValue(src.effectiveness)
  };
}

function formatScore(value) {
  const n = normalizeScoreValue(value);
  return n == null ? "—" : n.toFixed(1);
}

function emptyConfirmedFields() {
  return {
    who_raw: "",
    pain_raw: "",
    how_raw: "",
    alternative_raw: "",
    boundary_raw: ""
  };
}

function normalizeEditableVpField(value) {
  const text = String(value || "").trim();
  return !text || text === "未明确" ? "" : text;
}

function normalizeEditableVpFields(fields) {
  const src = fields && typeof fields === "object" ? fields : {};
  return {
    who_raw: normalizeEditableVpField(src.who_raw),
    pain_raw: normalizeEditableVpField(src.pain_raw),
    how_raw: normalizeEditableVpField(src.how_raw),
    alternative_raw: normalizeEditableVpField(src.alternative_raw),
    boundary_raw: normalizeEditableVpField(src.boundary_raw)
  };
}

function buildConfirmPayloadFields(fields) {
  const src = fields && typeof fields === "object" ? fields : {};
  return {
    who_raw: String(src.who_raw || "").trim(),
    pain_raw: String(src.pain_raw || "").trim(),
    how_raw: String(src.how_raw || "").trim(),
    alternative_raw: String(src.alternative_raw || "").trim() || "未明确",
    boundary_raw: String(src.boundary_raw || "").trim() || "未明确"
  };
}

function buildVpResultFromConfirmedFields(fields) {
  const src = buildConfirmPayloadFields(fields);
  return {
    target_customer: src.who_raw,
    scenario_pain: src.pain_raw,
    value_creation: src.how_raw,
    boundary: src.boundary_raw
  };
}

function buildLastCoachTurns(history) {
  const list = Array.isArray(history) ? history : [];
  const recent = list.slice(-10);
  return recent.map((item) => {
    const role = item?.role === "coach" ? "AI策略顾问" : "学生";
    return `${role}：${String(item?.text || "").trim()}`;
  }).filter(Boolean).join("\n");
}

function coachMessageSignature(message) {
  const role = String(message?.role || "").trim();
  const text = String(message?.text || "").trim();
  return `${role}::${text}`;
}

function normalizeStepValue(value, fallback = 0) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.min(5, Math.round(n)));
}

function stepFromTeamStatus(status, fallback = 0) {
  const s = String(status || "").toLowerCase();
  if (s === "phase4" || s === "frozen") return 5;
  if (s === "phase3") return 4;
  if (s === "phase2") return 3;
  return fallback;
}

function coachDraftStorageKey(teamId) {
  return `multiplayer_phase3_draft:${String(teamId || "")}`;
}

function leaderBannerName(leaderName) {
  return String(leaderName || "").trim() || "组长";
}

function formatLeaderLockMessage(error) {
  const leader = leaderBannerName(error?.leaderName);
  if (error?.code === "only_leader") {
    return `当前只有组长 ${leader} 可以操作。`;
  }
  return error?.message || "操作失败";
}

// Card component
function JinnangCard({ card, size = "full", selected, onSelect, flipped, onFlip, glowing }) {
  const isMarket = card.id.startsWith("M");
  const accentColor = isMarket ? "#2FAB6E" : "#3B82C4";
  const bgGrad = isMarket
    ? "linear-gradient(135deg, #f0fdf4 0%, #ecfdf5 100%)"
    : "linear-gradient(135deg, #eff6ff 0%, #f0f9ff 100%)";

  if (size === "mini") {
    return (
      <div style={{
        display: "inline-flex", alignItems: "center", gap: 6,
        padding: "4px 10px", borderRadius: 6,
        background: glowing ? `${accentColor}18` : bgGrad,
        border: glowing ? `2px solid ${accentColor}` : `1px solid ${accentColor}33`,
        fontSize: 12, color: "#374151", cursor: "default",
        boxShadow: glowing ? `0 0 12px ${accentColor}30` : "none",
        transition: "all 0.3s ease",
      }}>
        <span>{card.icon}</span>
        <span style={{ fontWeight: 600 }}>{card.title}</span>
        {glowing && <span style={{ fontSize: 10, color: accentColor, fontWeight: 700 }}>✦ 匹配</span>}
      </div>
    );
  }

  const isFlippable = onFlip !== undefined;
  const showBack = flipped;

  return (
    <div
      onClick={() => {
        if (onSelect) onSelect(card.id);
        if (onFlip) onFlip(card.id);
      }}
      style={{
        position: "relative",
        width: size === "compact" ? 200 : 240,
        minHeight: size === "compact" ? 180 : 260,
        borderRadius: 14,
        border: selected ? `2.5px solid ${accentColor}` : "1.5px solid #e5e7eb",
        background: showBack ? bgGrad : (isFlippable && !flipped) ? "#1a1a2e" : bgGrad,
        padding: showBack || !isFlippable ? "16px 14px" : 0,
        cursor: onSelect || onFlip ? "pointer" : "default",
        transition: "all 0.3s ease",
        boxShadow: selected ? `0 4px 20px ${accentColor}30` : "0 2px 8px rgba(0,0,0,0.06)",
        display: "flex", flexDirection: "column",
        overflow: "hidden",
      }}
    >
      {isFlippable && !flipped ? (
        // Card back (unrevealed)
        <div style={{
          flex: 1, display: "flex", flexDirection: "column",
          alignItems: "center", justifyContent: "center", gap: 12,
        }}>
          <div style={{ fontSize: 48, opacity: 0.6 }}>🎴</div>
          <div style={{ color: "#a0a0b8", fontSize: 13, fontWeight: 600, letterSpacing: 2 }}>
            {isMarket ? "市场能力" : "技术能力"}
          </div>
          <div style={{
            color: "#6b6b80", fontSize: 11, marginTop: 4,
            padding: "4px 12px", borderRadius: 20,
            border: "1px solid #3a3a52",
          }}>点击翻开</div>
        </div>
      ) : (
        // Card front
        <>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
            <span style={{ fontSize: size === "compact" ? 22 : 28 }}>{card.icon}</span>
            <div>
              <div style={{
                fontSize: size === "compact" ? 14 : 16, fontWeight: 700,
                color: "#111827", lineHeight: 1.3,
              }}>{card.title}</div>
              <div style={{ fontSize: 11, color: accentColor, marginTop: 2, fontWeight: 700 }}>
                {isMarket ? "市场能力" : "技术能力"}
              </div>
            </div>
          </div>
          <div style={{
            fontSize: size === "compact" ? 12 : 13, color: "#374151",
            lineHeight: 1.65, flex: 1,
          }}>
            {card.desc}
          </div>
        </>
      )}
    </div>
  );
}

// Step indicator
function StepBar({ current, onStep, maxUnlocked = 0 }) {
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 0,
      margin: "0 auto 28px", maxWidth: 680,
    }}>
      {FLOW_STEPS.map((s, i) => {
        const unlocked = i <= maxUnlocked;
        return (
        <div key={s.id} style={{ display: "flex", alignItems: "center", flex: i < FLOW_STEPS.length - 1 ? 1 : "none" }}>
          <div
            onClick={() => {
              if (!unlocked) return;
              onStep(s.id);
            }}
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 5,
              cursor: unlocked ? "pointer" : "not-allowed"
            }}
          >
            <div
              style={{
                width: 36, height: 36, borderRadius: "50%",
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: 13, fontWeight: 700,
                background: i < current ? "#2FAB6E" : i === current ? "#1a5c3a" : "#e5e7eb",
                color: i <= current ? "#fff" : "#9ca3af",
                transition: "all 0.3s",
                boxShadow: i === current ? "0 0 0 3px #1a5c3a33" : "none",
                opacity: unlocked ? 1 : 0.55,
              }}
            >{i < current ? "✓" : i + 1}</div>
            <span style={{
              fontSize: 11,
              fontWeight: i === current ? 700 : 400,
              color: i === current ? "#1a5c3a" : i < current ? "#2FAB6E" : "#aaa",
              whiteSpace: "nowrap",
            }}>{s.label}</span>
          </div>
          {i < FLOW_STEPS.length - 1 && (
            <div style={{
              flex: 1, height: 2, margin: "0 4px", marginBottom: 20,
              background: i < current ? "#2FAB6E" : "#e5e7eb",
              transition: "all 0.3s",
            }} />
          )}
        </div>
      );
      })}
    </div>
  );
}

function ArchitecturePicker({ value, onChange }) {
  return (
    <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
      {ARCH_OPTIONS.map((o) => {
        const active = value === o.key;
        return (
          <button
            key={o.key}
            onClick={() => onChange(o.key)}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              padding: "8px 12px",
              borderRadius: 10,
              border: active ? "2px solid #1a5c3a" : "1px solid #d1d5db",
              background: active ? "#ecfdf5" : "#f3f4f6",
              color: active ? "#166534" : "#6b7280",
              fontSize: 13,
              fontWeight: 700,
              cursor: "pointer"
            }}
          >
            <span style={{ fontSize: 16, lineHeight: 1 }}>{o.symbol}</span>
            <span>{o.label}</span>
          </button>
        );
      })}
    </div>
  );
}

function StarRating({ score }) {
  const safeScore = normalizeScoreValue(score);
  const width = safeScore == null ? "0%" : `${Math.max(0, Math.min(100, (safeScore / 5) * 100))}%`;
  return (
    <div style={{ position: "relative", display: "inline-block", fontSize: 22, letterSpacing: 2, lineHeight: 1 }}>
      <div style={{ color: "#d1d5db" }}>★★★★★</div>
      <div style={{
        position: "absolute",
        inset: 0,
        width,
        overflow: "hidden",
        color: "#f59e0b",
        whiteSpace: "nowrap"
      }}>
        ★★★★★
      </div>
    </div>
  );
}

// 12-grid strategy map
function StrategyGrid({ selections, highlightCell, onCellClick }) {
  const customers = ["ToC", "ToB"];
  const strategies = ["DIFF", "COST"];
  const ages = ["CHILD", "ADULT", "ELDER"];
  const ageLabels = { CHILD: "儿童", ADULT: "成人", ELDER: "老人" };
  const stratLabels = { DIFF: "差异化", COST: "成本领先" };

  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ borderCollapse: "collapse", width: "100%", minWidth: 500, tableLayout: "fixed" }}>
        <thead>
          <tr>
            <th style={{ width: 60 }} />
            <th style={{ width: 60 }} />
            {ages.map((a) => (
              <th key={a} style={{
                padding: "8px 4px", fontSize: 13, fontWeight: 700,
                color: "#374151", textAlign: "center",
              }}>{ageLabels[a]}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {customers.map((c) =>
            strategies.map((s, si) => (
              <tr key={`${c}-${s}`}>
                {si === 0 && (
                  <td rowSpan={2} style={{
                    fontWeight: 700, fontSize: 13, color: "#111827",
                    textAlign: "center", verticalAlign: "middle",
                    borderRight: "2px solid #d1d5db", padding: 6,
                    writingMode: "vertical-rl", letterSpacing: 3,
                  }}>{c === "ToC" ? "消费者 (ToC)" : "企业 (ToB)"}</td>
                )}
                <td style={{
                  fontSize: 11, fontWeight: 600, color: "#6b7280",
                  textAlign: "center", padding: "4px 6px",
                  borderBottom: si === 1 ? "2px solid #d1d5db" : "1px solid #e5e7eb",
                }}>{stratLabels[s]}</td>
                {ages.map((a) => {
                  const cellKey = `${c}_${s}_${a}`;
                  const members = selections ? selections.filter((sel) => sel.cell === cellKey) : [];
                  const isHighlight = highlightCell === cellKey;
                  return (
                    <td
                      key={a}
                      onClick={() => onCellClick && onCellClick(cellKey)}
                      style={{
                        border: "1px solid #d1d5db",
                        borderBottom: si === 1 ? "2px solid #d1d5db" : undefined,
                        padding: 8, textAlign: "center", verticalAlign: "middle",
                        minHeight: 60, height: 64,
                        background: isHighlight ? "#f0fdf4" : members.length > 0 ? "#fefce8" : "#fff",
                        cursor: onCellClick ? "pointer" : "default",
                        transition: "all 0.2s",
                        outline: isHighlight ? "2px solid #1a5c3a" : "none",
                      }}
                    >
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 4, justifyContent: "center" }}>
                        {members.map((m) => (
                          m.memberIdx >= 90 ? (
                            <div key={`${m.memberIdx}-${m.architecture || "Experience"}`} style={{
                              width: 24, height: 24, borderRadius: 6,
                              background: "#1a5c3a", color: "#fff",
                              fontSize: 14, fontWeight: 900,
                              display: "flex", alignItems: "center", justifyContent: "center",
                            }}>✓</div>
                          ) : (
                            <div key={`${m.memberIdx}-${m.architecture || "Experience"}`} style={{
                              width: 24, height: 24,
                              color: MEMBER_COLORS[m.memberIdx],
                              fontSize: 18, fontWeight: 900,
                              display: "flex", alignItems: "center", justifyContent: "center",
                            }}>
                              {archToSymbol(m.architecture)}
                            </div>
                          )
                        ))}
                      </div>
                    </td>
                  );
                })}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

// ── Main App ──────────────────────────────────────────
export default function App() {
  const [step, setStep] = useState(0);
  const [entryMode, setEntryMode] = useState(null); // classroom | trial
  const [teamSize, setTeamSize] = useState(4);
  const [teamName, setTeamName] = useState("第1组");
  const [revealedCards, setRevealedCards] = useState({});
  const [selectedCell, setSelectedCell] = useState(null);
  const [teamCell, setTeamCell] = useState(null);
  const [teamId, setTeamId] = useState("");
  const [memberId, setMemberId] = useState("");
  const [jinangPair, setJinangPair] = useState({ market: null, tech: null });
  const [memberCardsMap, setMemberCardsMap] = useState({});
  const [submissions, setSubmissions] = useState([]);
  const [coachReply, setCoachReply] = useState("");
  const [results, setResults] = useState(null);
  const [statusLine, setStatusLine] = useState("");
  const [teamStatus, setTeamStatus] = useState("forming");
  const [teamMembers, setTeamMembers] = useState([]);
  const [leaderMemberId, setLeaderMemberId] = useState("");
  const [leaderName, setLeaderName] = useState("");
  const [isLeader, setIsLeader] = useState(false);
  const [memberLinks, setMemberLinks] = useState([]);
  const [vpDraft, setVpDraft] = useState("");
  const [coachVpText, setCoachVpText] = useState("");
  const [arch, setArch] = useState(null);
  const [teamArch, setTeamArch] = useState(null);
  const [step1Done, setStep1Done] = useState(false);
  const [selfSubmitted, setSelfSubmitted] = useState(false);
  const [isSubmittingPersonal, setIsSubmittingPersonal] = useState(false);
  const [isSendingCoach, setIsSendingCoach] = useState(false);
  const [isSynthesizingVp, setIsSynthesizingVp] = useState(false);
  const [isExtractingVp, setIsExtractingVp] = useState(false);
  const [isConfirmingVp, setIsConfirmingVp] = useState(false);
  const [isFreezing, setIsFreezing] = useState(false);
  const [coachHistory, setCoachHistory] = useState([]);
  const [coachInput, setCoachInput] = useState("");
  const [phase3StateLoaded, setPhase3StateLoaded] = useState(false);
  const [vpPanelState, setVpPanelState] = useState("chatting");
  const [vpConfirmedFields, setVpConfirmedFields] = useState(emptyConfirmedFields());
  const [vpConfirmedScores, setVpConfirmedScores] = useState(null);
  const [vpConfirmedAt, setVpConfirmedAt] = useState("");
  const [vpFeedbackText, setVpFeedbackText] = useState("");
  const [vpFeedbackError, setVpFeedbackError] = useState("");
  const [vpFeedbackRequest, setVpFeedbackRequest] = useState(null);
  const [isGeneratingVpFeedback, setIsGeneratingVpFeedback] = useState(false);
  const [vpPanelError, setVpPanelError] = useState("");
  const coachBootstrappedRef = useRef(false);
  const coachHistoryRef = useRef([]);
  const vpPanelStateRef = useRef("chatting");
  const pendingCoachMessagesRef = useRef([]);
  const pendingCoachSeqRef = useRef(0);
  const coachScrollRef = useRef(null);
  const autoRound2RedirectRef = useRef(false);
  const allowRound1ReviewRef = useRef(false);
  const round1StrategyDraftTouchedRef = useRef(false);
  const round1VpDraftTouchedRef = useRef(false);
  const userCoachTurns = coachHistory.filter((m) => m.role === "user").length;
  const assistantCoachTurns = coachHistory.filter((m) => m.role === "coach").length;

  const syncCoachReply = (history) => {
    const list = Array.isArray(history) ? history : [];
    const lastCoachMessage = [...list].reverse().find((item) => item?.role === "coach");
    setCoachReply(lastCoachMessage ? String(lastCoachMessage.text || "") : "");
  };

  const syncCoachHistoryWithPending = (serverHistory) => {
    const restoredHistory = Array.isArray(serverHistory) ? serverHistory : [];
    const serverCounts = new Map();
    restoredHistory.forEach((item) => {
      const signature = coachMessageSignature(item);
      serverCounts.set(signature, (serverCounts.get(signature) || 0) + 1);
    });

    const matchedCounts = new Map();
    const remainingPending = [];
    pendingCoachMessagesRef.current.forEach((item) => {
      const signature = coachMessageSignature(item);
      const matchedCount = matchedCounts.get(signature) || 0;
      const serverCount = serverCounts.get(signature) || 0;
      if (matchedCount < serverCount) {
        matchedCounts.set(signature, matchedCount + 1);
      } else {
        remainingPending.push(item);
      }
    });

    pendingCoachMessagesRef.current = remainingPending;
    const mergedHistory = [...restoredHistory, ...remainingPending];
    coachHistoryRef.current = mergedHistory;
    setCoachHistory(mergedHistory);
    syncCoachReply(mergedHistory);
  };

  const queuePendingCoachMessage = ({ role, text, type = "chat" }) => {
    const messageText = String(text || "").trim();
    if (!messageText) return "";
    pendingCoachSeqRef.current += 1;
    const pendingMessage = {
      clientId: `pending-${Date.now()}-${pendingCoachSeqRef.current}`,
      type,
      role,
      text: messageText,
      ts: Date.now(),
      pending: true
    };
    pendingCoachMessagesRef.current = [...pendingCoachMessagesRef.current, pendingMessage];
    const nextHistory = [...coachHistoryRef.current, pendingMessage];
    coachHistoryRef.current = nextHistory;
    setCoachHistory(nextHistory);
    syncCoachReply(nextHistory);
    return pendingMessage.clientId;
  };

  const dropPendingCoachMessage = (clientId) => {
    if (!clientId) return;
    pendingCoachMessagesRef.current = pendingCoachMessagesRef.current.filter((item) => item.clientId !== clientId);
    const nextHistory = coachHistoryRef.current.filter((item) => item.clientId !== clientId);
    coachHistoryRef.current = nextHistory;
    setCoachHistory(nextHistory);
    syncCoachReply(nextHistory);
  };

  function toUiCell(gridId) {
    const raw = String(gridId || "").trim();
    if (!raw) return "";
    const parts = raw.split("_");
    if (parts.length < 3) return "";
    const customer = parts[0] === "ToB" ? "ToB" : "ToC";
    const strategy = String(parts[1]).includes("Cost") ? "COST" : "DIFF";
    const age = parts[2] === "Child" ? "CHILD" : (parts[2] === "Elder" ? "ELDER" : "ADULT");
    return `${customer}_${strategy}_${age}`;
  }

  function toGridId(cell) {
    const raw = String(cell || "").trim();
    if (!raw) return "";
    const parts = raw.split("_");
    if (parts.length < 3) return "";
    const customer = parts[0] === "ToB" ? "ToB" : "ToC";
    const strategy = parts[1] === "COST" ? "CostLeadership" : "Differentiation";
    const age = parts[2] === "CHILD" ? "Child" : (parts[2] === "ELDER" ? "Elder" : "Adult");
    return `${customer}_${strategy}_${age}`;
  }

  function strategyGridToUiCell(gridId) {
    return toUiCell(gridId);
  }

  const demoSelections = submissions.map((s, idx) => ({
    memberIdx: idx,
    cell: toUiCell(s?.submission?.grid_id || ""),
    architecture: s?.submission?.architecture || "Experience"
  })).filter((x) => x.cell);

  const divergenceInsight = (() => {
    const parsed = demoSelections.map((s) => {
      const [customer, strategy, age] = String(s.cell || "").split("_");
      return { customer, strategy, age };
    }).filter((x) => x.customer && x.strategy && x.age);

    if (!parsed.length) {
      return "暂无可用分布数据。";
    }

    const countBy = (key, values) => {
      const map = Object.fromEntries(values.map((v) => [v, 0]));
      parsed.forEach((p) => { map[p[key]] = (map[p[key]] || 0) + 1; });
      return map;
    };

    const customerMap = countBy("customer", ["ToC", "ToB"]);
    const strategyMap = countBy("strategy", ["DIFF", "COST"]);
    const ageMap = countBy("age", ["CHILD", "ADULT", "ELDER"]);

    const splitScore = (map) => {
      const vals = Object.values(map);
      const total = vals.reduce((a, b) => a + b, 0);
      if (!total) return 0;
      const max = Math.max(...vals);
      return total - max;
    };

    const axes = [
      { axis: "客群", score: splitScore(customerMap), map: customerMap, labels: { ToC: "ToC", ToB: "ToB" } },
      { axis: "竞争策略", score: splitScore(strategyMap), map: strategyMap, labels: { DIFF: "差异化", COST: "成本领先" } },
      { axis: "年龄段", score: splitScore(ageMap), map: ageMap, labels: { CHILD: "儿童", ADULT: "成人", ELDER: "老人" } }
    ].sort((a, b) => b.score - a.score);

    const top = axes[0];
    if (!top || top.score <= 0) {
      return "当前分布共识较高，未出现明显分歧。";
    }

    const sortedBuckets = Object.entries(top.map).sort((a, b) => b[1] - a[1]);
    const a = sortedBuckets[0];
    const b = sortedBuckets[1];
    const left = top.labels[a[0]] || a[0];
    const right = top.labels[b[0]] || b[0];
    return `主要分歧：${left}（${a[1]}人） vs ${right}（${b[1]}人）`;
  })();

  const flipCard = (id) => {
    setRevealedCards((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const applyPhase3StatePayload = (data, { preserveDraft = true } = {}) => {
    const restoredHistory = Array.isArray(data?.coach_history) ? data.coach_history : [];
    const strategy = data?.strategy || {};
    const confirmation = data?.vp_confirmation || null;
    const sharedDraft = data?.team_draft || null;
    const requesterIsLeader = Boolean(data?.is_leader);
    const savedDraft = preserveDraft && typeof window !== "undefined"
      ? window.sessionStorage.getItem(coachDraftStorageKey(teamId)) || ""
      : "";
    const restoredTeamCell = strategyGridToUiCell(strategy.grid_id || sharedDraft?.grid_id || "");
    const restoredTeamArch = String(strategy.architecture || sharedDraft?.architecture || "").trim();
    const restoredVpText = String(confirmation?.vp_text || data?.score_state?.vp_draft || sharedDraft?.vp_text || "").trim();
    setLeaderMemberId(String(data?.leader_member_id || ""));
    setLeaderName(String(data?.leader_name || ""));
    setIsLeader(requesterIsLeader);
    if (restoredTeamCell && (!requesterIsLeader || !round1StrategyDraftTouchedRef.current)) {
      setTeamCell(restoredTeamCell);
      setSelectedCell((prev) => prev || restoredTeamCell);
    }
    if (restoredTeamArch && (!requesterIsLeader || !round1StrategyDraftTouchedRef.current)) {
      setTeamArch(restoredTeamArch);
      setArch((prev) => prev || restoredTeamArch);
    }
    syncCoachHistoryWithPending(restoredHistory);
    if (preserveDraft) setCoachInput(savedDraft);
    setCoachVpText((prev) => {
      if (round1VpDraftTouchedRef.current && requesterIsLeader) return prev;
      if (confirmation) return restoredVpText;
      if (restoredVpText) return restoredVpText;
      return prev;
    });
    if (confirmation?.fields) {
      setVpConfirmedFields(normalizeEditableVpFields(confirmation.fields));
      setVpConfirmedScores(confirmation.scores || null);
      setVpConfirmedAt(String(confirmation.confirmed_at || ""));
      setVpFeedbackText(String(confirmation.feedback || ""));
      setVpFeedbackError("");
      setVpFeedbackRequest(null);
      setIsGeneratingVpFeedback(false);
      setVpPanelState(confirmation.status === "confirming" ? "confirming" : "scored");
    } else if (vpPanelStateRef.current !== "confirming") {
      setVpConfirmedFields(emptyConfirmedFields());
      setVpConfirmedScores(null);
      setVpConfirmedAt("");
      setVpFeedbackText("");
      setVpFeedbackError("");
      setVpFeedbackRequest(null);
      setIsGeneratingVpFeedback(false);
      setVpPanelState("chatting");
    }
    setVpPanelError("");
    coachBootstrappedRef.current = restoredHistory.length > 0;
    setPhase3StateLoaded(true);
  };

  const reloadPhase3State = async (options = {}) => {
    if (!teamId) return null;
    const data = await getPhase3State(teamId, memberId);
    applyPhase3StatePayload(data, options);
    return data;
  };

  const getCard = (id) => ALL_CARDS.find((c) => c.id === id);
  const toUiCard = (card, type) => {
    if (!card) return null;
    return {
      id: type === "market" ? `M_${card.id}` : `T_${card.id}`,
      title: card.name || card.id,
      subtitle: type === "market" ? "市场锦囊" : "技术锦囊",
      desc: card.desc_for_player || "",
      tags: [],
      icon: type === "market" ? "🧭" : "🛠️",
      round: "R1"
    };
  };

  useEffect(() => {
    const url = new URL(window.location.href);
    const t = url.searchParams.get("teamId") || "";
    const m = url.searchParams.get("memberId") || "";
    const stepParam = url.searchParams.get("step");
    const stored = readStudentSession();
    const ctxTeamId = t || stored?.teamId || "";
    const ctxMemberId = m || stored?.memberId || "";
    const ctxEntryMode = t ? "classroom" : (stored?.entryMode || null);
    if (!ctxTeamId) return;
    allowRound1ReviewRef.current = consumeRound1ReviewIntent();
    setTeamId(ctxTeamId);
    setMemberId(ctxMemberId);
    setEntryMode(ctxEntryMode || "classroom");
    setStep(normalizeStepValue(stepParam, 0));
    if (ctxTeamId && ctxMemberId) {
      writeStudentSession({
        ...(stored || {}),
        teamId: ctxTeamId,
        memberId: ctxMemberId,
        entryMode: ctxEntryMode || stored?.entryMode || "classroom"
      });
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    url.searchParams.delete("teamId");
    url.searchParams.delete("memberId");
    url.searchParams.set("step", String(normalizeStepValue(step, 0)));
    window.history.replaceState({}, "", url.toString());
  }, [step]);

  useEffect(() => {
    if (!teamId || !memberId) return;
    mergeStudentSession({
      teamId,
      memberId,
      entryMode: entryMode || "classroom"
    });
  }, [entryMode, memberId, teamId]);

  useEffect(() => {
    if (!teamId) return;
    fetch(`/api/team/${encodeURIComponent(teamId)}`)
      .then((res) => res.json())
      .then((data) => {
        if (!data?.ok || !data?.team) return;
        setTeamName(data.team.team_name || teamName);
        setTeamSize(Number(data.team.team_size || 1));
        setTeamMembers(Array.isArray(data.team.members) ? data.team.members : []);
        setLeaderMemberId(String(data.team.leader_member_id || ""));
        setLeaderName(String(data.team.leader_name || ""));
        setIsLeader(Boolean(memberId && data.team.leader_member_id && data.team.leader_member_id === memberId));
        const matchedMember = Array.isArray(data.team.members)
          ? data.team.members.find((item) => item.id === memberId)
          : null;
        if (matchedMember?.member_name) {
          mergeStudentSession({
            teamId,
            memberId,
            entryMode: entryMode || "classroom",
            studentName: matchedMember.member_name
          });
        }
      })
      .catch(() => {});
  }, [entryMode, memberId, teamId]);

  const marketUiId = toUiCard(jinangPair.market, "market")?.id || "M05";
  const techUiId = toUiCard(jinangPair.tech, "tech")?.id || "T02";
  const cardsReady = Boolean(jinangPair.market && jinangPair.tech);
  const cardsRevealed = Boolean(revealedCards[marketUiId] && revealedCards[techUiId]);

  useEffect(() => {
    if (!teamId) return;
    let previousR2Status = "";
    const syncStatus = async () => {
      try {
        const status = await getTeamStatus(teamId, memberId);
        setTeamStatus(status.status || "forming");
        setStatusLine(`已提交 ${status.submitted_count}/${status.member_count}`);
        setLeaderMemberId(String(status.leader_member_id || ""));
        setLeaderName(String(status.leader_name || ""));
        setIsLeader(Boolean(status.is_leader));
        if (status.team_draft && (!round1StrategyDraftTouchedRef.current || !status.is_leader)) {
          if (status.team_draft.grid_id) {
            const nextCell = toUiCell(status.team_draft.grid_id);
            if (nextCell) setTeamCell(nextCell);
          }
          if (status.team_draft.architecture) {
            setTeamArch(String(status.team_draft.architecture || ""));
          }
        }
        if (
          entryMode === "trial" &&
          status.status === "frozen" &&
          !allowRound1ReviewRef.current &&
          !autoRound2RedirectRef.current
        ) {
          autoRound2RedirectRef.current = true;
          goToRound2Room();
          return;
        }
        const nextR2Status = String(status.r2_status || "R2_NOT_STARTED");
        if (
          entryMode === "classroom" &&
          previousR2Status &&
          !shouldOpenRound2(previousR2Status) &&
          shouldOpenRound2(nextR2Status) &&
          !autoRound2RedirectRef.current
        ) {
          autoRound2RedirectRef.current = true;
          goToRound2Room();
          return;
        }
        allowRound1ReviewRef.current = false;
        previousR2Status = nextR2Status;
        const url = new URL(window.location.href);
        const requestedStep = normalizeStepValue(url.searchParams.get("step"), 0);
        const statusStep = stepFromTeamStatus(status.status, 0);
        const nextStep = step === 4 && statusStep === 5
          ? Math.max(requestedStep, 4)
          : Math.max(requestedStep, statusStep);
        if (nextStep !== step && nextStep > 0) setStep(nextStep);
      } catch (_) {}
    };

    syncStatus();
    const timer = setInterval(syncStatus, 3000);
    return () => clearInterval(timer);
  }, [entryMode, memberId, teamId, step]);

  useEffect(() => {
    if (step !== 1 || !teamId || !memberId) return;
    getMemberJinang(teamId, memberId)
      .then((data) => {
        setJinangPair({
          market: data.jinang?.market || null,
          tech: data.jinang?.tech || null
        });
      })
      .catch(() => {});
  }, [step, teamId, memberId]);

  useEffect(() => {
    if (step !== 3 || !teamId) return;
    getSubmissions(teamId)
      .then((data) => setSubmissions(data.submissions || []))
      .catch(() => {});
  }, [step, teamId]);

  useEffect(() => {
    if (step !== 3 || !teamId || !submissions.length) return;
    Promise.all(
      submissions.map((s) =>
        getMemberJinang(teamId, s.member_id)
          .then((data) => {
            const marketId = data?.jinang?.market?.id || "";
            const techId = data?.jinang?.tech?.id || "";
            const market = getCard(marketId) || null;
            const tech = getCard(techId) || null;
            return {
              member_id: s.member_id,
              cards: [market, tech].filter(Boolean)
            };
          })
          .catch(() => ({ member_id: s.member_id, cards: [] }))
      )
    ).then((list) => {
      const nextMap = {};
      list.forEach((item) => {
        nextMap[item.member_id] = item.cards;
      });
      setMemberCardsMap(nextMap);
    });
  }, [step, teamId, submissions]);

  useEffect(() => {
    if (step !== 4 || !teamId) return;
    if (!submissions.length) {
      getSubmissions(teamId)
        .then((data) => setSubmissions(data.submissions || []))
        .catch(() => {});
    }
  }, [step, teamId, submissions.length]);

  useEffect(() => {
    if (!coachScrollRef.current) return;
    coachScrollRef.current.scrollTop = coachScrollRef.current.scrollHeight;
  }, [coachHistory]);

  useEffect(() => {
    coachHistoryRef.current = coachHistory;
  }, [coachHistory]);

  useEffect(() => {
    if (typeof window === "undefined" || !teamId) return;
    window.sessionStorage.setItem(coachDraftStorageKey(teamId), String(coachInput || ""));
  }, [teamId, coachInput]);

  useEffect(() => {
    vpPanelStateRef.current = vpPanelState;
  }, [vpPanelState]);

  useEffect(() => {
    if (step !== 5 || !teamId) return;
    getResults(teamId)
      .then((data) => setResults(data))
      .catch(() => {});
  }, [step, teamId]);

  useEffect(() => {
    if (step !== 4) return;
    if (selectedCell) return;
    if (teamCell) {
      setSelectedCell(teamCell);
      return;
    }
    if (!demoSelections.length) return;
    setSelectedCell(demoSelections[0].cell);
  }, [step, selectedCell, teamCell, demoSelections]);

  useEffect(() => {
    if (step !== 4 || !teamId) {
      setPhase3StateLoaded(false);
      return;
    }
    let cancelled = false;
    getPhase3State(teamId, memberId)
      .then((stateData) => {
        if (cancelled) return;
        applyPhase3StatePayload(stateData, { preserveDraft: true });
      })
      .catch(() => {
        if (cancelled) return;
        coachBootstrappedRef.current = false;
        setPhase3StateLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [memberId, step, teamId]);

  useEffect(() => {
    if (step !== 4 || !teamId) return;
    const sync = () => {
      reloadPhase3State({ preserveDraft: true }).catch(() => {});
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") sync();
    };
    window.addEventListener("focus", sync);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      window.removeEventListener("focus", sync);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [step, teamId]);

  useEffect(() => {
    if (step !== 4 || !teamId) return undefined;
    const timer = window.setInterval(() => {
      reloadPhase3State({ preserveDraft: true }).catch(() => {});
    }, 3000);
    return () => window.clearInterval(timer);
  }, [memberId, step, teamId]);

  useEffect(() => {
    if (step !== 4 || !teamId) return;
    if (!phase3StateLoaded) return;
    if (coachBootstrappedRef.current) return;
    if (!isLeader) return;
    if (!submissions.length) return;
    const grouped = {};
    submissions.forEach((s) => {
      const key = String(s?.submission?.grid_id || "未提交");
      if (!grouped[key]) grouped[key] = [];
      grouped[key].push(s.member_name || "成员");
    });
    const distributionLines = Object.entries(grouped)
      .map(([grid, names]) => `- ${formatGridIdCn(grid)}: ${names.join("、")}`)
      .join("\n");
    const abilityLines = submissions.map((s) => {
      const m = s?.hint_keyword?.market || "无";
      const t = s?.hint_keyword?.tech || "无";
      return `- ${s.member_name || "成员"}：市场能力=${m}；技术能力=${t}`;
    }).join("\n");
    const drafts = submissions.map((s) => {
      const draft = s.submission?.vp_draft || "（未填写）";
      return `- ${s.member_name}: ${draft}`;
    }).join("\n");
    const teamChoiceLine = `团队已确认方向：目标市场=${formatUiCellCn(teamCell || selectedCell)}；产品定位方向=${archToLabel(teamArch || arch)}。`;
    const intro = [
      "你是 EMBA 课程中的 AI 产品教练。团队已经完成方向选择，现在请直接进入价值主张打磨阶段。",
      "",
      "请按以下要求输出：",
      "1) 不要再分析团队分歧、共识度或替他们重新选方向；",
      "2) 先用自然语言重述团队已确认的目标市场和产品定位，确认讨论边界；",
      "3) 结合团队成员能力背景，指出这一路径最值得抓住的 1-2 个优势；",
      "4) 直接引导他们开始写第一版价值主张，重点是 WHO / PAIN / HOW / 为什么现有替代方案做不到；",
      "5) 不要使用系统术语（如 锦囊激活 / match / affinity），改用自然语言表述“团队能力优势”。",
      "",
      teamChoiceLine,
      "",
      "仅供你理解背景的小组分布（不要在回复里展开讨论分歧）：",
      distributionLines || "- 暂无",
      "",
      `仅供参考的分布观察（不要直接复述“共识高/分歧大”）：${divergenceInsight}`,
      "",
      "成员能力关键词：",
      abilityLines || "- 暂无",
      "",
      "成员价值主张草稿：",
      drafts
    ].join("\n");
    if (typeof window !== "undefined" && window.__DEBUG_COACH_PROMPT__ === true) {
      console.log("[AI策略顾问 Bootstrap Prompt]\n" + intro);
    }

    coachBootstrappedRef.current = true;
    setIsSendingCoach(true);
    chatWithCoach(teamId, {
      message: intro,
      grid_id: toGridId(teamCell || selectedCell),
      architecture: teamArch || arch
    })
      .then((out) => {
        const reply = out.coach_reply || "";
        queuePendingCoachMessage({ type: "chat", role: "coach", text: reply });
        return reloadPhase3State({ preserveDraft: true }).catch(() => {});
      })
      .catch((e) => {
        queuePendingCoachMessage({ type: "chat", role: "coach", text: `教练暂不可用：${e.message || e}` });
      })
      .finally(() => {
        setIsSendingCoach(false);
      });
  }, [step, teamId, submissions, selectedCell, demoSelections, arch, phase3StateLoaded, isLeader]);

  useEffect(() => {
    if (step === 4) return;
    coachBootstrappedRef.current = false;
    pendingCoachMessagesRef.current = [];
    round1VpDraftTouchedRef.current = false;
    setPhase3StateLoaded(false);
    setCoachVpText("");
    setVpPanelState("chatting");
    setVpConfirmedFields(emptyConfirmedFields());
    setVpConfirmedScores(null);
    setVpConfirmedAt("");
    setVpFeedbackText("");
    setVpFeedbackError("");
    setVpFeedbackRequest(null);
    setIsGeneratingVpFeedback(false);
    setVpPanelError("");
  }, [step, teamId]);

  useEffect(() => {
    if (step === 3) return;
    round1StrategyDraftTouchedRef.current = false;
  }, [step]);

  useEffect(() => {
    const reviewLocked = step < 5 && (["phase4", "frozen"].includes(teamStatus) || Boolean(results));
    if (step !== 3 || !teamId || !memberId || !isLeader || !teamCell || !teamArch || reviewLocked) return undefined;
    round1StrategyDraftTouchedRef.current = true;
    const timer = window.setTimeout(() => {
      savePhase2Draft(teamId, {
        memberId,
        grid_id: toGridId(teamCell),
        architecture: teamArch
      }).catch(() => {});
    }, 300);
    return () => window.clearTimeout(timer);
  }, [isLeader, memberId, results, step, teamArch, teamCell, teamId, teamStatus]);

  useEffect(() => {
    const reviewLocked = step < 5 && (["phase4", "frozen"].includes(teamStatus) || Boolean(results));
    if (step !== 4 || !teamId || !memberId || !isLeader || reviewLocked) return undefined;
    round1VpDraftTouchedRef.current = true;
    const timer = window.setTimeout(() => {
      savePhase3Draft(teamId, {
        memberId,
        grid_id: toGridId(teamCell || selectedCell),
        architecture: teamArch || arch,
        vp_text: coachVpText
      }).catch(() => {});
    }, 350);
    return () => window.clearTimeout(timer);
  }, [arch, coachVpText, isLeader, memberId, results, selectedCell, step, teamArch, teamCell, teamId, teamStatus]);

  const handleCreateTeam = async () => {
    try {
      const out = await createTeam(teamName, teamSize);
      const createdTeamId = out.team?.id || "";
      const firstMemberId = out.member_links?.[0]?.member_id || "";
      setEntryMode("trial");
      setMemberLinks(out.member_links || []);
      setTeamId(createdTeamId);
      setMemberId(firstMemberId);
      setTeamMembers(Array.isArray(out?.team?.members) ? out.team.members : []);
      setTeamStatus(out.team?.status || "forming");
      setStatusLine(`建组成功，成员 ${teamSize} 人`);
      setStep(1);
      if (createdTeamId && firstMemberId) {
        writeStudentSession({
          teamId: createdTeamId,
          memberId: firstMemberId,
          entryMode: "trial"
        });
      }
    } catch (e) {
      setStatusLine(`建组失败: ${e.message || e}`);
    }
  };

  const handleSubmitPersonal = async () => {
    if (!teamId || !memberId || !selectedCell || !arch || isSubmittingPersonal) return;
    const grid = toGridId(selectedCell);
    try {
      setIsSubmittingPersonal(true);
      const out = await submitPersonalChoice(teamId, memberId, {
        grid_id: grid,
        architecture: arch,
        vp_outline: vpDraft,
        who: vpDraft || "待补充",
        pain: vpDraft || "待补充",
        how: vpDraft || "待补充"
      });
      setSelfSubmitted(true);
      setStatusLine(`已提交 (${out.submitted_count}/${out.team_size})`);
      if (out.team_status_updated_to_phase2) {
        setStep(3);
      }
    } catch (e) {
      setStatusLine(`提交失败: ${e.message || e}`);
    } finally {
      setIsSubmittingPersonal(false);
    }
  };

  const handleCoachSend = async () => {
    const message = String(coachInput || "").trim();
    if (!teamId || !message || isSendingCoach || vpPanelState !== "chatting") return;
    let pendingUserId = "";
    try {
      setIsSendingCoach(true);
      pendingUserId = queuePendingCoachMessage({ type: "chat", role: "user", text: message });
      setCoachInput("");
      const out = await chatWithCoach(teamId, {
        message,
        grid_id: toGridId(teamCell || selectedCell),
        architecture: teamArch || arch,
        memberId
      });
      const reply = out.coach_reply || "";
      queuePendingCoachMessage({ type: "chat", role: "coach", text: reply });
      await reloadPhase3State({ preserveDraft: false }).catch(() => {});
    } catch (e) {
      dropPendingCoachMessage(pendingUserId);
      queuePendingCoachMessage({ type: "chat", role: "coach", text: `发送失败：${e.message || e}` });
    } finally {
      setIsSendingCoach(false);
    }
  };

  const handleSynthesizeVp = async () => {
    const finalCell = teamCell || selectedCell;
    const finalArch = teamArch || arch;
    if (!teamId || !finalCell || !finalArch || isSynthesizingVp || vpPanelState !== "chatting" || round1TeamControlsLocked) return;
    const grid = toGridId(finalCell);
    try {
      setIsSynthesizingVp(true);
      setVpPanelError("");
      const out = await synthesizeTeamVP(teamId, {
        grid_id: grid,
        architecture: finalArch,
        memberId
      });
      const nextVp = String(out?.vp_text || "").trim();
      const feedbackText = String(out?.feedback || "").trim();
      setCoachVpText(nextVp);
      if (!out?.cached && feedbackText) {
        const last = coachHistoryRef.current[coachHistoryRef.current.length - 1];
        if (!(last?.role === "coach" && String(last?.text || "").trim() === feedbackText)) {
          queuePendingCoachMessage({ type: "chat", role: "coach", text: feedbackText });
        }
        await reloadPhase3State({ preserveDraft: true }).catch(() => {});
      }
      setStatusLine(out?.cached ? "当前对话没有新消息，返回了上次合成结果。" : "已根据当前对话合成 VP，可继续编辑。");
    } catch (e) {
      setVpPanelError(`合成失败：${formatLeaderLockMessage(e)}`);
    } finally {
      setIsSynthesizingVp(false);
    }
  };

  const handleSubmitVp = async () => {
    const vpText = String(coachVpText || "").trim();
    if (vpText.length < 10 || isExtractingVp || vpPanelState !== "chatting" || round1TeamControlsLocked) return;
    try {
      setIsExtractingVp(true);
      setVpPanelError("");
      const out = await extractVpFields(vpText, buildLastCoachTurns(coachHistory));
      setVpConfirmedFields(normalizeEditableVpFields(out?.fields));
      setVpConfirmedScores(null);
      setVpConfirmedAt("");
      setVpFeedbackText("");
      setVpFeedbackError("");
      setVpFeedbackRequest(null);
      setIsGeneratingVpFeedback(false);
      setVpPanelState("confirming");
    } catch (e) {
      setVpPanelError(`分析失败：${formatLeaderLockMessage(e)}`);
    } finally {
      setIsExtractingVp(false);
    }
  };

  const handleReturnToEditing = () => {
    if (vpPanelState !== "confirming") return;
    setVpPanelState("chatting");
    setVpFeedbackText("");
    setVpFeedbackError("");
    setVpFeedbackRequest(null);
    setIsGeneratingVpFeedback(false);
    setVpPanelError("");
  };

  const handleConfirmedFieldChange = (key, value) => {
    setVpConfirmedFields((prev) => ({ ...prev, [key]: value }));
  };

  const handleConfirmAndScore = async () => {
    const finalCell = teamCell || selectedCell;
    const finalArch = teamArch || arch;
    const confirmedFields = buildConfirmPayloadFields(vpConfirmedFields);
    if (!teamId || !finalCell || !finalArch || isConfirmingVp || vpPanelState !== "confirming" || round1TeamControlsLocked) return;
    if (!confirmedFields.who_raw || !confirmedFields.pain_raw || !confirmedFields.how_raw) {
      setVpPanelError("请先补全目标客户、痛点和解决方式。");
      return;
    }

    const grid = toGridId(finalCell);
    try {
      setIsConfirmingVp(true);
      setVpPanelError("");
      const out = await confirmAndScoreVp({
        teamId,
        memberId,
        vpText: String(coachVpText || "").trim(),
        confirmedFields,
        grid_id: grid,
        gridId: grid,
        architecture: finalArch
      });

      setVpConfirmedFields(normalizeEditableVpFields(out?.fields || confirmedFields));
      setVpConfirmedScores(out?.scores || null);
      setVpConfirmedAt(String(out?.confirmedAt || ""));
      setVpFeedbackText(String(out?.feedback || "").trim());
      setVpFeedbackError("");
      setVpFeedbackRequest(null);
      setIsGeneratingVpFeedback(false);
      setVpPanelState("scored");

      await finalizeDecision(teamId, {
        grid_id: grid,
        architecture: finalArch,
        memberId,
        scores: normalizeApiScores({
          coverage: out?.scores?.C,
          generalizability: out?.scores?.G,
          effectiveness: out?.scores?.E
        }),
        conversation_history: coachHistory,
        vp_result: out?.vp_result || buildVpResultFromConfirmedFields(confirmedFields)
      });
      const latestResults = await getResults(teamId).catch(() => null);
      if (latestResults) setResults(latestResults);
      setTeamStatus("phase4");
      setStatusLine("VP 已评分并锁定。可点击上方“结果”查看团队结果。");
      setStep(5);
    } catch (e) {
      setVpPanelError(`评分失败：${formatLeaderLockMessage(e)}`);
    } finally {
      setIsConfirmingVp(false);
    }
  };

  const handleFreeze = async () => {
    if (!teamId || isFreezing) return;
    try {
      setIsFreezing(true);
      await freezeTeam(teamId, memberId);
      setTeamStatus("frozen");
      if (teamSize === 1 || entryMode === "trial") {
        setStatusLine("已冻结，正在进入 Round 2...");
        goToRound2Room();
        return;
      }
      setStatusLine("已冻结。建议先回教室讨论，再进入 Round 2。");
    } catch (e) {
      setStatusLine(`冻结失败: ${formatLeaderLockMessage(e)}`);
    } finally {
      setIsFreezing(false);
    }
  };

  const goToRound2Room = () => {
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    url.pathname = "/multiplayer/round2";
    url.search = "";
    window.location.href = url.toString();
  };

  const goToClassroom = () => {
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    url.pathname = "/index.html";
    window.location.href = url.toString();
  };

  const handleDownloadCoachChat = () => {
    const lines = [];
    lines.push("Round 1 AI策略顾问对话导出");
    lines.push(`Team ID: ${teamId || "-"}`);
    lines.push(`导出时间: ${new Date().toLocaleString()}`);
    lines.push("");
    lines.push("=== 只读上下文 ===");
    lines.push(`目标市场: ${formatUiCellCn(teamCell || selectedCell || demoSelections[0]?.cell)}`);
    lines.push(`产品定位方向: ${archToSymbol(teamArch || arch)} ${archToLabel(teamArch || arch)}`);
    (submissions || []).forEach((s, idx) => {
      lines.push(`${s.member_name || `成员${idx + 1}`}: ${s?.hint_keyword?.market || "无"} + ${s?.hint_keyword?.tech || "无"}`);
    });
    lines.push("");
    lines.push("=== 对话记录 ===");
    if (!coachHistory.length) {
      lines.push("（暂无对话）");
    } else {
      coachHistory.forEach((m) => {
        lines.push(`[${formatExportTime(m.ts)}] ${m.role === "coach" ? "AI策略顾问" : "Team"}:`);
        lines.push(String(m.text || ""));
        lines.push("");
      });
    }
    downloadTxtFile(`vp-coach-chat-${teamId || "team"}`, lines);
  };

  function renderCoachText(text) {
    const src = String(text || "");
    const parts = src.split(/(\*\*[^*]+\*\*)/g);
    return parts.map((p, i) => {
      if (p.startsWith("**") && p.endsWith("**")) {
        return <strong key={i}>{p.slice(2, -2)}</strong>;
      }
      return <span key={i}>{p}</span>;
    });
  }

  const canStep0 = true;
  const canStep1 = Boolean(teamId) || entryMode === "trial";
  const canStep2 = canStep1 && step1Done;
  const canStep3 = ["phase2", "phase3", "phase4", "frozen"].includes(teamStatus);
  const canStep4 = canStep3 && Boolean(teamCell && teamArch);
  const canStep5 = ["phase4", "frozen"].includes(teamStatus) || Boolean(results);
  const maxUnlockedStep = canStep5 ? 5 : canStep4 ? 4 : canStep3 ? 3 : canStep2 ? 2 : canStep1 ? 1 : 0;
  const isReadOnlyReview = step < 5 && canStep5;
  const hasLeaderLock = Boolean(leaderMemberId);
  const isLeaderLockedViewer = hasLeaderLock && !isLeader && ["phase2", "phase3", "phase4", "frozen"].includes(teamStatus);
  const reviewBannerText = teamStatus === "frozen"
    ? "本轮结果已冻结。你们可以点击上方步骤回看前面的内容，但当前为只读模式。"
    : "本轮已经提交。你们可以点击上方步骤回看前面的内容，但当前为只读模式。";
  const coachFinalCell = teamCell || selectedCell;
  const coachFinalArch = teamArch || arch;
  const round1LeaderBanner = isLeaderLockedViewer
    ? `当前由 ${leaderBannerName(leaderName)} 操作，请口头讨论你的建议`
    : "";
  const round1TeamControlsLocked = isReadOnlyReview || isLeaderLockedViewer;
  const phase3EditLocked = round1TeamControlsLocked || vpPanelState !== "chatting";
  const phase3ChatLocked = isReadOnlyReview || vpPanelState !== "chatting";
  const canSynthesizeVp = Boolean(
    !round1TeamControlsLocked &&
    !isSendingCoach &&
    !isSynthesizingVp &&
    !isExtractingVp &&
    !isConfirmingVp &&
    teamId &&
    coachFinalCell &&
    coachFinalArch &&
    assistantCoachTurns >= 2
  );
  const canSubmitVp = Boolean(
    canSynthesizeVp &&
    String(coachVpText || "").trim().length >= 10
  );
  const settleItems = Array.isArray(results?.settle?.settlements) ? results.settle.settlements : [];
  const r1 = results?.r1_result || {};
  const resultVpScore = normalizeScoreValue(results?.vp_scores?.VPscore ?? r1?.VPscore);
  const resultFeedbackText = String(results?.vp_feedback || vpFeedbackText || "").trim();
  const resultMarketJinang = results?.jinang?.market_jinang || null;
  const vpSummary = results?.vp_summary || parseVpSummaryText(results?.team?.final_vp_text);
  const vpRecapSentence = buildVpRecapSentence(vpSummary, results?.team?.final_vp_text);
  const finalCell = results?.team?.final_grid_id ? toUiCell(results.team.final_grid_id) : (teamCell || selectedCell);
  const finalArch = results?.team?.final_architecture || teamArch || arch || "Experience";
  const wtpBreakdown = results?.wtp_breakdown || {};
  const wtpPct = Number.isFinite(Number(wtpBreakdown?.final_pct))
    ? Number(wtpBreakdown.final_pct)
    : toPercentChange(r1?.WTPadj, r1?.WTPref);
  const wtpBasePct = Number.isFinite(Number(wtpBreakdown?.base_pct))
    ? Number(wtpBreakdown.base_pct)
    : wtpPct;
  const wtpJinangDeltaPct = Number.isFinite(Number(wtpBreakdown?.jinang_delta_pct))
    ? Number(wtpBreakdown.jinang_delta_pct)
    : 0;
  const rhoDiscountValue = Number.isFinite(Number(wtpBreakdown?.rho_discount))
    ? Number(wtpBreakdown.rho_discount)
    : null;
  const wtpHasJinangBoost = Math.abs(wtpJinangDeltaPct) > 0;
  const resultMarketJinangBonusPct = Number.isFinite(Number(resultMarketJinang?.bonus))
    ? Math.round(Number(resultMarketJinang.bonus) * 100)
    : Math.round(Number(resultMarketJinang?.match_strength || 0) * 5);
  const matchedJinangCount = settleItems.filter((s) => Boolean(s?.matched)).length;
  const matchedMarketJinangCount = settleItems.filter((s) => Boolean(s?.matched) && s?.jinang_type === "market").length;
  const matchedTechJinangCount = settleItems.filter((s) => Boolean(s?.matched) && s?.jinang_type === "tech").length;
  const totalJinangCount = settleItems.length || (teamMembers.length ? teamMembers.length * 2 : 0);
  const visibleMatches = settleItems
    .filter((s) => Boolean(s?.matched))
    .map((s) => {
      const strength = Number(s?.match_strength || 0);
      if (strength < 0.3) return null;
      const rawJinangId = String(s?.jinang_id || "").trim();
      const normalizedJinangId = rawJinangId.replace("-", "");
      const card = getCard(rawJinangId) || getCard(normalizedJinangId) || { icon: "🎴", title: s?.name || rawJinangId || "锦囊" };
      const bonusPct = Math.round(strength * 5);
      return {
        id: s?.id || `${s?.member_id}-${s?.jinang_id}`,
        card,
        cardId: rawJinangId || card.id || "—",
        cardTitle: s?.name || card.title || rawJinangId || "锦囊",
        label: strength >= 0.7 ? "高匹配" : "中匹配",
        type: s?.jinang_type,
        scope: s?.jinang_type === "market" ? "Round 1 支付意愿" : "Round 2 研发与成本",
        text: s?.jinang_type === "market"
          ? `→ 为支付意愿额外增加了 ${bonusPct}%`
          : "→ 只在第二轮生效：相关能力卡成本/风险更低"
      };
    })
    .filter(Boolean);
  const goStep = (target) => {
    if (target > maxUnlockedStep) return;
    setStep(target);
  };

  const handleSwitchStudent = () => {
    if (typeof window === "undefined") return;
    clearStudentSession();
    window.location.href = "/multiplayer";
  };

  return (
    <div style={{
      fontFamily: "'Noto Sans SC', 'SF Pro Display', -apple-system, sans-serif",
      background: "#fafaf8", minHeight: "100vh", padding: "24px 20px",
    }}>
      <div style={{ maxWidth: 960, margin: "0 auto" }}>
        {/* Header */}
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          marginBottom: 8,
        }}>
          <h1 style={{
            fontSize: 22, fontWeight: 800, color: "#111827", margin: 0,
            letterSpacing: -0.5,
          }}>
            Round 1 · 第一轮决策：产品战略制定
          </h1>
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
        <p style={{ fontSize: 13, color: "#6b7280", marginTop: 4, marginBottom: 24 }}>
          {statusLine || "请按步骤完成小组第一轮战略决策。"}
        </p>

        <StepBar current={step} onStep={goStep} maxUnlocked={maxUnlockedStep} />
        {isReadOnlyReview && (
          <div style={{
            margin: "-10px auto 20px",
            maxWidth: 760,
            padding: "10px 14px",
            borderRadius: 10,
            background: "#fffbeb",
            border: "1px solid #fcd34d",
            color: "#92400e",
            fontSize: 13,
            lineHeight: 1.6,
          }}>
            {reviewBannerText}
          </div>
        )}
        {round1LeaderBanner && !isReadOnlyReview && (
          <div style={{
            margin: "-10px auto 20px",
            maxWidth: 760,
            padding: "10px 14px",
            borderRadius: 10,
            background: "#fef3c7",
            border: "1px solid #fcd34d",
            color: "#92400e",
            fontSize: 13,
            lineHeight: 1.6,
          }}>
            {round1LeaderBanner}
          </div>
        )}

        {/* ── Step 0: 入口与建组 ── */}
        {step === 0 && !entryMode && (
          <div style={{
            background: "#fff", borderRadius: 16, padding: "32px 28px",
            border: "1px solid #e5e7eb", textAlign: "center",
          }}>
            <h2 style={{ fontSize: 20, fontWeight: 800, color: "#111827", marginTop: 0 }}>
              👋 欢迎进入 LOVOT 产品创新战略模拟
            </h2>
            <p style={{ fontSize: 14, color: "#666", marginTop: 4, marginBottom: 28, lineHeight: 1.7 }}>
              请选择你的进入方式。
            </p>
            <div style={{ display: "flex", gap: 16, justifyContent: "center", flexWrap: "wrap" }}>
              <button
                onClick={() => setEntryMode("classroom")}
                style={{
                  padding: "20px 32px", borderRadius: 12,
                  background: "#1a5c3a", color: "#fff", border: "none",
                  fontSize: 15, fontWeight: 700, cursor: "pointer",
                  minWidth: 220,
                }}
              >
                <div>📋 课堂模式</div>
                <div style={{ fontSize: 11, opacity: 0.75, marginTop: 4, fontWeight: 400 }}>
                  用学号登录，小组已分好
                </div>
              </button>
              <button
                onClick={() => setEntryMode("trial")}
                style={{
                  padding: "20px 32px", borderRadius: 12,
                  background: "#fff", color: "#374151", border: "1.5px solid #d1d5db",
                  fontSize: 15, fontWeight: 700, cursor: "pointer",
                  minWidth: 220,
                }}
              >
                <div>🎮 试玩模式</div>
                <div style={{ fontSize: 11, color: "#9ca3af", marginTop: 4, fontWeight: 400 }}>
                  自行建组体验流程
                </div>
              </button>
            </div>
          </div>
        )}

        {step === 0 && entryMode === "classroom" && (
          <div style={{
            background: "#fff", borderRadius: 16, padding: "32px 28px",
            border: "1px solid #e5e7eb",
          }}>
            <h2 style={{ fontSize: 20, fontWeight: 800, color: "#111827", marginTop: 0 }}>
              📋 确认你的小组
            </h2>
            <p style={{ fontSize: 14, color: "#666", marginTop: 4, marginBottom: 20, lineHeight: 1.7 }}>
              你已通过学号登录，系统已将你分配到以下小组。确认成员无误后即可开始。
            </p>
            <div style={{
              padding: "18px 22px", borderRadius: 12,
              background: "linear-gradient(135deg, #f0fdf4 0%, #ecfdf5 100%)",
              border: "1.5px solid #bbf7d0",
              marginBottom: 20,
            }}>
              <div style={{ fontSize: 12, color: "#2FAB6E", fontWeight: 600, marginBottom: 4 }}>你的小组</div>
              <div style={{ fontSize: 22, fontWeight: 800, color: "#1a5c3a" }}>{teamName || "未分配"}</div>
              <div style={{ fontSize: 13, color: "#666", marginTop: 4 }}>{teamSize || 0} 人</div>
            </div>
            <div style={{ marginBottom: 24 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: "#374151", marginBottom: 10 }}>小组成员</div>
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                {(teamMembers.length ? teamMembers : Array.from({ length: teamSize }).map((_, i) => ({
                  id: `demo-${i}`,
                  member_name: MEMBER_NAMES[i] || `成员${i + 1}`
                }))).map((member, i) => {
                  const isCurrent = member.id === memberId;
                  const isTeamLeaderMember = member.id === leaderMemberId;
                  return (
                    <div key={member.id || i} style={{
                      display: "flex", alignItems: "center", gap: 8,
                      padding: "8px 14px", borderRadius: 10,
                      background: `${MEMBER_COLORS[i % MEMBER_COLORS.length]}12`,
                      border: isCurrent
                        ? `2px solid ${MEMBER_COLORS[i % MEMBER_COLORS.length]}`
                        : `1.5px solid ${MEMBER_COLORS[i % MEMBER_COLORS.length]}30`,
                    }}>
                      <div style={{
                        width: 28, height: 28, borderRadius: "50%",
                        background: MEMBER_COLORS[i % MEMBER_COLORS.length], color: "#fff",
                        display: "flex", alignItems: "center", justifyContent: "center",
                        fontSize: 13, fontWeight: 700,
                      }}>{String.fromCharCode(65 + i)}</div>
                      <span style={{ fontSize: 13, fontWeight: 600, color: "#374151" }}>
                        {isCurrent ? `你（${member.member_name || "成员"}）` : (member.member_name || `成员${i + 1}`)}
                        {isTeamLeaderMember ? " 👑" : ""}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
            <div style={{ display: "flex", gap: 10 }}>
              <button
                onClick={() => setEntryMode(null)}
                style={{
                  padding: "12px 20px", borderRadius: 10,
                  background: "#fff", color: "#666", border: "1.5px solid #d1d5db",
                  fontSize: 14, fontWeight: 600, cursor: "pointer",
                }}
              >返回</button>
              <button
                onClick={() => setStep(1)}
                style={{
                  padding: "12px 32px", borderRadius: 10,
                  background: "#1a5c3a", color: "#fff", border: "none",
                  fontSize: 15, fontWeight: 700, cursor: "pointer",
                }}
              >确认，开始 Round 1 →</button>
            </div>
          </div>
        )}

        {step === 0 && entryMode === "trial" && (
          <div style={{
            background: "#fff", borderRadius: 16, padding: "32px 28px",
            border: "1px solid #e5e7eb",
          }}>
            <h2 style={{ fontSize: 20, fontWeight: 800, color: "#111827", marginTop: 0 }}>
              🎮 试玩模式 · 建立小组
            </h2>
            <p style={{ fontSize: 14, color: "#666", marginTop: 4, marginBottom: 20, lineHeight: 1.7 }}>
              体验完整流程。可自由设置小组名称和人数。
            </p>
            <div style={{ display: "flex", gap: 32, marginTop: 20, flexWrap: "wrap" }}>
              <div>
                <label style={{ fontSize: 13, fontWeight: 600, color: "#374151", display: "block", marginBottom: 6 }}>
                  小组名称
                </label>
                <input
                  value={teamName}
                  onChange={(e) => setTeamName(e.target.value)}
                  style={{
                    padding: "10px 14px", borderRadius: 8, border: "1.5px solid #d1d5db",
                    fontSize: 15, width: 200, outline: "none",
                  }}
                />
              </div>
              <div>
                <label style={{ fontSize: 13, fontWeight: 600, color: "#374151", display: "block", marginBottom: 6 }}>
                  小组人数
                </label>
                <div style={{ display: "flex", gap: 8 }}>
                  {[1, 2, 3, 4, 5, 6].map((n) => (
                    <button
                      key={n}
                      onClick={() => setTeamSize(n)}
                      style={{
                        width: 44, height: 44, borderRadius: 10,
                        border: teamSize === n ? "2px solid #1a5c3a" : "1.5px solid #d1d5db",
                        background: teamSize === n ? "#f0fdf4" : "#fff",
                        color: teamSize === n ? "#1a5c3a" : "#6b7280",
                        fontSize: 16, fontWeight: 700, cursor: "pointer",
                      }}
                    >{n}</button>
                  ))}
                </div>
              </div>
            </div>
            <div style={{ marginTop: 24 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: "#374151", marginBottom: 10 }}>
                小组成员预览
              </div>
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                {Array.from({ length: teamSize }).map((_, i) => (
                  <div key={i} style={{
                    display: "flex", alignItems: "center", gap: 8,
                    padding: "8px 14px", borderRadius: 10,
                    background: `${MEMBER_COLORS[i]}12`,
                    border: `1.5px solid ${MEMBER_COLORS[i]}30`,
                  }}>
                    <div style={{
                      width: 28, height: 28, borderRadius: "50%",
                      background: MEMBER_COLORS[i], color: "#fff",
                      display: "flex", alignItems: "center", justifyContent: "center",
                      fontSize: 13, fontWeight: 700,
                    }}>{String.fromCharCode(65 + i)}</div>
                    <span style={{ fontSize: 13, fontWeight: 600, color: "#374151" }}>
                      {MEMBER_NAMES[i]}
                    </span>
                  </div>
                ))}
              </div>
            </div>
            <button
              onClick={handleCreateTeam}
              style={{
                marginTop: 28, padding: "12px 32px", borderRadius: 10,
                background: "#1a5c3a", color: "#fff", border: "none",
                fontSize: 15, fontWeight: 700, cursor: "pointer",
              }}
            >确认建组，开始 Round 1 →</button>
          </div>
        )}

        {/* ── Step 1: 个人锦囊 ── */}
        {step === 1 && (
          <div style={{
            background: "#fff", borderRadius: 16, padding: "32px 28px",
            border: "1px solid #e5e7eb",
          }}>
            <h2 style={{ fontSize: 20, fontWeight: 800, color: "#111827", marginTop: 0 }}>
              🎯 你的个人锦囊
            </h2>
            <p style={{ fontSize: 14, color: "#666", marginTop: 4, marginBottom: 20, lineHeight: 1.7 }}>
              每位成员获得 2 张锦囊（1 市场能力 + 1 技术能力），描述了你在某些方面的独特能力。
            </p>

            <div style={{
              background: "linear-gradient(135deg, #fffbe6 0%, #fff9db 100%)",
              border: "1px solid #f0e6a8",
              borderRadius: 12,
              padding: "16px 20px",
              marginBottom: 24,
              fontSize: 13.5,
              lineHeight: 1.8,
              color: "#5a4a1a",
            }}>
              <div style={{ fontWeight: 700, marginBottom: 4, fontSize: 14 }}>💡 怎么用锦囊？</div>
              <div>
                锦囊描述了你在某些方面的独特能力。小组所有成员的锦囊都会在最终结算时生效，关键是团队选择的市场定位和价值主张能否击中这些能力。匹配度越高，团队在成本或市场份额上的优势越大。
              </div>
              <div style={{ marginTop: 8, paddingTop: 8, borderTop: "1px dashed #e0d48a", color: "#7a6a2a" }}>
                🧭 锦囊能力不是必须使用的，你也可以根据案例材料和课堂讨论，对市场方向做出自主判断。
              </div>
            </div>

            <p style={{ fontSize: 13, color: "#888", margin: "0 0 16px", fontStyle: "italic" }}>
              仔细读一读每张卡描述的能力，想想它们和哪些市场方向最契合。
            </p>
            <div style={{ display: "flex", gap: 20, flexWrap: "wrap" }}>
              <JinnangCard
                card={toUiCard(jinangPair.market, "market") || getCard("M05")}
                flipped={isReadOnlyReview || revealedCards[marketUiId]}
                onFlip={isReadOnlyReview ? undefined : flipCard}
              />
              <JinnangCard
                card={toUiCard(jinangPair.tech, "tech") || getCard("T02")}
                flipped={isReadOnlyReview || revealedCards[techUiId]}
                onFlip={isReadOnlyReview ? undefined : flipCard}
              />
            </div>

            <button
              onClick={() => {
                if (!cardsReady || !cardsRevealed) return;
                setStep1Done(true);
                setStep(2);
              }}
              disabled={isReadOnlyReview || !cardsReady || !cardsRevealed}
              style={{
                marginTop: 28, padding: "12px 32px", borderRadius: 10,
                background: cardsReady && cardsRevealed ? "#1a5c3a" : "#ccc", color: "#fff", border: "none",
                fontSize: 15, fontWeight: 700, cursor: "pointer",
                opacity: !isReadOnlyReview && cardsReady && cardsRevealed ? 1 : 0.4,
              }}
            >{isReadOnlyReview ? "回看模式：不可修改" : (cardsReady && cardsRevealed ? "我看好了，去选战略 →" : "请先翻开两张锦囊")}</button>
            {cardsReady && cardsRevealed && (
              <p style={{ margin: "10px 0 0", fontSize: 12, color: "#999" }}>
                下一步：选择目标市场和产品定位方向，并撰写你的价值主张草稿
              </p>
            )}
          </div>
        )}

        {/* ── Step 2: 个人选战略 ── */}
        {step === 2 && (
          <div style={{
            background: "#fff", borderRadius: 16, padding: "32px 28px",
            border: "1px solid #e5e7eb",
          }}>
            <h2 style={{ fontSize: 20, fontWeight: 800, color: "#111827", marginTop: 0 }}>
              🎯 选择你的战略定位
            </h2>
            <p style={{ fontSize: 14, color: "#666", marginTop: 4, marginBottom: 8, lineHeight: 1.7 }}>
              根据你的锦囊能力和对市场的判断，在下方地图上点击你认为最有机会的目标市场。
            </p>
            <p style={{ fontSize: 12, color: "#9ca3af", marginTop: 0, marginBottom: 14 }}>
              这是你的个人初选，之后小组会看到所有人的选择，再一起讨论收敛。
            </p>

            {/* Show mini cards for reference */}
            <div style={{
              display: "flex", gap: 8, marginBottom: 14, alignItems: "center", flexWrap: "wrap",
            }}>
              <span style={{ fontSize: 12, color: "#9ca3af", fontWeight: 600 }}>你的锦囊：</span>
              <JinnangCard card={toUiCard(jinangPair.market, "market") || getCard("M05")} size="mini" />
              <JinnangCard card={toUiCard(jinangPair.tech, "tech") || getCard("T02")} size="mini" />
            </div>

            <div style={{ display: "flex", gap: 12, marginBottom: 14, flexWrap: "wrap", fontSize: 12, color: "#666" }}>
              <div style={{ padding: "8px 12px", borderRadius: 8, background: "#f9fafb", border: "1px solid #e5e7eb", flex: "1 1 220px" }}>
                <strong style={{ color: "#374151" }}>差异化</strong>：靠独特体验或功能赢得用户，可以定更高价格，但目标人群更窄
              </div>
              <div style={{ padding: "8px 12px", borderRadius: 8, background: "#f9fafb", border: "1px solid #e5e7eb", flex: "1 1 220px" }}>
                <strong style={{ color: "#374151" }}>成本领先</strong>：靠性价比和规模赢得用户，价格敏感但人群基数更大
              </div>
            </div>

            <StrategyGrid
              selections={selectedCell ? [{ memberIdx: 0, cell: selectedCell, architecture: arch || "Experience" }] : []}
              highlightCell={selectedCell}
              onCellClick={isReadOnlyReview ? undefined : (cell) => setSelectedCell(cell)}
            />

            <div style={{ marginTop: 26 }}>
              <div style={{ fontSize: 15, fontWeight: 700, color: "#111827", marginBottom: 14 }}>
                你希望 LOVOT 在这个市场中主要靠什么打动用户？
              </div>
              <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
                {[
                  {
                    key: "Experience",
                    label: "体验型 ●",
                    desc: "用户买的是情感价值和陪伴体验，功能够用就行",
                    example: "例：老人每天和 LOVOT 说话解闷；孩子把它当宠物养",
                    color: "#8B5CF6"
                  },
                  {
                    key: "Hybrid",
                    label: "混合型 ▲",
                    desc: "体验和功能都是卖点，缺一不可",
                    example: "例：既能陪伴老人，又能检测跌倒并通知家属",
                    color: "#D4A03C"
                  },
                  {
                    key: "Function",
                    label: "功能型 ■",
                    desc: "用户买的是实用功能，情感体验是锦上添花",
                    example: "例：企业采购用于前台接待和导览；学校用于编程教育",
                    color: "#3B82C4"
                  }
                ].map((item) => {
                  const selected = arch === item.key;
                  return (
                    <div key={item.key} onClick={() => {
                      if (isReadOnlyReview) return;
                      setArch(item.key);
                    }} style={{
                      padding: "14px 16px", borderRadius: 12,
                      border: selected ? `2.5px solid ${item.color}` : "1.5px solid #d1d5db",
                      background: selected ? `${item.color}08` : "#fff",
                      cursor: isReadOnlyReview ? "default" : "pointer", flex: "1 1 220px",
                      boxShadow: selected ? `0 2px 12px ${item.color}20` : "none",
                      transition: "all 0.2s",
                      opacity: isReadOnlyReview ? 0.8 : 1,
                    }}>
                      <div style={{ fontSize: 15, fontWeight: 700, color: selected ? item.color : "#374151" }}>{item.label}</div>
                      <div style={{ fontSize: 13, color: "#555", marginTop: 6, lineHeight: 1.6 }}>{item.desc}</div>
                      <div style={{ fontSize: 12, color: "#999", marginTop: 6, fontStyle: "italic", lineHeight: 1.5 }}>
                        {item.example}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div style={{ marginTop: 16 }}>
              <label style={{ fontSize: 13, fontWeight: 600, color: "#374151", display: "block", marginBottom: 6 }}>
                一句话价值主张草稿（选填）
              </label>
              <p style={{ fontSize: 12, color: "#9ca3af", margin: "0 0 6px" }}>
                尝试回答：给谁（WHO）、解决什么问题（PAIN）、怎么解决（HOW）
              </p>
              <textarea
                value={vpDraft}
                onChange={(e) => setVpDraft(e.target.value)}
                placeholder="例：为独居年轻白领提供下班后的情感陪伴，通过主动感知情绪和多轮对话缓解孤独感……"
                readOnly={isReadOnlyReview}
                style={{
                  width: "100%", minHeight: 64, borderRadius: 8,
                  border: "1.5px solid #d1d5db", padding: "10px 12px",
                  fontSize: 14, resize: "vertical", outline: "none",
                  fontFamily: "inherit", boxSizing: "border-box",
                  background: isReadOnlyReview ? "#f9fafb" : "#fff",
                }}
              />
            </div>

            <button
              onClick={handleSubmitPersonal}
              disabled={isReadOnlyReview || !selectedCell || !arch || isSubmittingPersonal || selfSubmitted}
              style={{
                marginTop: 20, padding: "12px 32px", borderRadius: 10,
                background: "#1a5c3a", color: "#fff", border: "none",
                fontSize: 15, fontWeight: 700, cursor: "pointer",
                opacity: !isReadOnlyReview && selectedCell && arch && !selfSubmitted ? 1 : 0.4,
              }}
            >{isReadOnlyReview
              ? "回看模式：不可修改"
              : selfSubmitted
              ? "已提交，等待其他组员…"
              : selectedCell && arch
                ? "提交我的选择 →"
                : (!selectedCell && !arch)
                  ? "请选择目标市场并选择产品定位方向"
                  : (!selectedCell ? "请选择目标市场" : "请选择产品定位方向")
            }</button>
          </div>
        )}

        {/* ── Step 3: 战略分布 ── */}
        {step === 3 && (
          <div style={{
            background: "#fff", borderRadius: 16, padding: "32px 28px",
            border: "1px solid #e5e7eb",
          }}>
            <h2 style={{ fontSize: 20, fontWeight: 800, color: "#111827", marginTop: 0 }}>
              📊 小组战略分布
            </h2>
            <p style={{ fontSize: 14, color: "#666", marginTop: 4, marginBottom: 20, lineHeight: 1.7 }}>
              所有人的选择已揭晓。观察你们的共识和分歧，讨论后在下方确定团队统一方向。
            </p>

            <StrategyGrid selections={demoSelections} />

            <div style={{ marginTop: 10, fontSize: 12, color: "#4b5563" }}>
              图例：<span style={{ fontWeight: 700 }}>●</span> 体验　<span style={{ fontWeight: 700 }}>▲</span> 混合　<span style={{ fontWeight: 700 }}>■</span> 功能
            </div>

            {/* Member legend */}
            <div style={{
              marginTop: 20, display: "flex", gap: 16, flexWrap: "wrap",
              padding: "16px", background: "#f9fafb", borderRadius: 10,
            }}>
              {demoSelections.map((sel) => {
                const member = submissions[sel.memberIdx] || {};
                const cards = memberCardsMap[member.member_id] || [];
                return (
                  <div key={sel.memberIdx} style={{
                    display: "flex", alignItems: "flex-start", gap: 8,
                    flex: "1 1 200px", minWidth: 200,
                  }}>
                    <div style={{
                      width: 28, height: 28, borderRadius: "50%", flexShrink: 0,
                      background: MEMBER_COLORS[sel.memberIdx], color: "#fff",
                      display: "flex", alignItems: "center", justifyContent: "center",
                      fontSize: 12, fontWeight: 700, marginTop: 2,
                    }}>{String.fromCharCode(65 + sel.memberIdx)}</div>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 600, color: "#374151" }}>
                        {member.member_name || MEMBER_NAMES[sel.memberIdx]}
                      </div>
                      <div style={{ fontSize: 11, color: "#9ca3af", marginTop: 2 }}>
                        目标市场：{formatUiCellCn(sel.cell)}
                      </div>
                      <div style={{ fontSize: 11, color: "#6b7280", marginTop: 2 }}>
                        产品定位方向：{archToSymbol(member.submission?.architecture)} {archToLabel(member.submission?.architecture)}
                      </div>
                      {cards.length > 0 && (
                        <div style={{ display: "flex", gap: 4, marginTop: 4, flexWrap: "wrap" }}>
                          {cards.map((card) => (
                            <JinnangCard
                              key={`${member.member_id}-${card.id}`}
                              card={card}
                              size="mini"
                              glowing={Boolean(teamCell) && cardMatchesCell(card, teamCell)}
                            />
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Insight box */}
            <div style={{
              marginTop: 20, padding: "14px 18px", borderRadius: 10,
              background: "linear-gradient(135deg, #fef3c7, #fef9c3)",
              border: "1px solid #fde68a",
            }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: "#92400e", marginBottom: 6 }}>
                📌 分布洞察
              </div>
              <div style={{ fontSize: 13, color: "#78350f", lineHeight: 1.7 }}>
                {divergenceInsight}
              </div>
            </div>

            <div style={{
              marginTop: 18, padding: "16px 20px", borderRadius: 12,
              background: "#f0fdf4", border: "1.5px solid #bbf7d0",
            }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: "#166534", marginBottom: 8 }}>
                🔦 锦囊匹配分析
              </div>
              <div style={{ fontSize: 13, color: "#15803d", lineHeight: 1.8, marginBottom: 8 }}>
                {teamCell ? `如果团队选择 ${formatUiCellCn(teamCell)}：` : "请先在下方确定团队目标市场后查看匹配分析。"}
              </div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {teamCell && submissions.flatMap((s) => {
                  const cards = memberCardsMap[s.member_id] || [];
                  return cards
                    .filter((card) => cardMatchesCell(card, teamCell))
                    .map((card) => (
                      <div key={`${s.member_id}-${card.id}`} style={{
                        display: "flex", alignItems: "center", gap: 6,
                        padding: "6px 12px", borderRadius: 8,
                        background: "#dcfce7", border: "1px solid #86efac",
                        fontSize: 12,
                      }}>
                        <span>{card.icon}</span>
                        <span style={{ fontWeight: 700, color: "#166534" }}>{card.title}</span>
                        <span style={{ color: "#15803d" }}>· {s.member_name || "成员"}</span>
                      </div>
                    ));
                })}
              </div>
              {teamCell && (
                <div style={{ fontSize: 12, color: "#4ade80", marginTop: 8 }}>
                  {submissions.reduce((acc, s) => {
                    const cards = memberCardsMap[s.member_id] || [];
                    return acc + cards.filter((card) => cardMatchesCell(card, teamCell)).length;
                  }, 0)} 张锦囊可激活
                </div>
              )}
            </div>

            <div style={{
              marginTop: 24, padding: "24px 22px", borderRadius: 14,
              background: "linear-gradient(135deg, #f8fafc 0%, #f1f5f9 100%)",
              border: "2px solid #1a5c3a30",
            }}>
              <div style={{ fontSize: 16, fontWeight: 800, color: "#111827", marginBottom: 6 }}>
                ✅ 确定小组最终选择
              </div>
              <p style={{ fontSize: 13, color: "#666", margin: "0 0 16px", lineHeight: 1.6 }}>
                讨论完成后，在这里确认团队统一方向。这个选择将作为后续价值主张讨论的基础。
              </p>
              <div style={{ fontSize: 13, fontWeight: 600, color: "#374151", marginBottom: 8 }}>团队目标市场</div>
              <StrategyGrid
                selections={teamCell ? [{ memberIdx: 99, cell: teamCell, architecture: teamArch || "Experience" }] : []}
                highlightCell={teamCell}
                onCellClick={round1TeamControlsLocked ? undefined : (cell) => setTeamCell(cell)}
              />
              <div style={{ fontSize: 13, fontWeight: 600, color: "#374151", marginTop: 20, marginBottom: 10 }}>
                团队产品定位方向
              </div>
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                {[
                  { key: "Experience", label: "体验型 ●", color: "#8B5CF6" },
                  { key: "Hybrid", label: "混合型 ▲", color: "#D4A03C" },
                  { key: "Function", label: "功能型 ■", color: "#3B82C4" },
                ].map((item) => {
                  const selected = teamArch === item.key;
                  return (
                    <button
                      key={item.key}
                      onClick={() => {
                        if (round1TeamControlsLocked) return;
                        setTeamArch(item.key);
                      }}
                      style={{
                        padding: "10px 20px", borderRadius: 10,
                        border: selected ? `2.5px solid ${item.color}` : "1.5px solid #d1d5db",
                        background: selected ? `${item.color}10` : "#fff",
                        color: selected ? item.color : "#374151",
                        fontSize: 14, fontWeight: 700, cursor: round1TeamControlsLocked ? "default" : "pointer",
                        opacity: round1TeamControlsLocked ? 0.8 : 1,
                      }}
                    >{item.label}</button>
                  );
                })}
              </div>
            </div>

            <button
              onClick={() => {
                if (!teamCell || !teamArch) return;
                setSelectedCell(teamCell);
                setArch(teamArch);
                setStep(4);
              }}
              disabled={round1TeamControlsLocked || !teamCell || !teamArch}
              style={{
                marginTop: 24, padding: "12px 32px", borderRadius: 10,
                background: "#1a5c3a", color: "#fff", border: "none",
                fontSize: 15, fontWeight: 700, cursor: "pointer",
                opacity: !round1TeamControlsLocked && teamCell && teamArch ? 1 : 0.4,
              }}
            >{round1TeamControlsLocked ? "当前为只读视图" : (teamCell && teamArch ? "进入价值主张讨论 →" : "请先确定团队的目标市场和产品定位")}</button>
          </div>
        )}

        {/* ── Step 4: 价值主张讨论 ── */}
        {step === 4 && (
          <div style={{
            background: "#fff", borderRadius: 16, padding: "32px 28px",
            border: "1px solid #e5e7eb",
          }}>
            <h2 style={{ fontSize: 20, fontWeight: 800, color: "#111827", marginTop: 0 }}>
              🤖 AI策略顾问 · 集体讨论
            </h2>
            <p style={{ fontSize: 14, color: "#666", marginTop: 4, marginBottom: 8, lineHeight: 1.7 }}>
              与 AI策略顾问对话，为团队选定方向、收敛讨论并打磨价值主张（Value Proposition）。
            </p>
            <div style={{
              fontSize: 12, color: "#999", marginBottom: 20, padding: "8px 14px",
              background: "#f9fafb", borderRadius: 8, lineHeight: 1.6,
            }}>
              价值主张需要回答三个问题：给谁（WHO）、解决什么痛点（PAIN）、怎么解决（HOW）。
              对话阶段只给定性反馈；确认提交后，系统会在结果页展示最终评分。
            </div>

            <div style={{
              marginBottom: 14,
              border: "1px solid #d1d5db",
              borderRadius: 10,
              background: "#f9fafb",
              padding: "12px 14px"
            }}>
              <div style={{ fontSize: 12, color: "#6b7280", marginBottom: 6 }}>当前讨论上下文（只读）</div>
              <div style={{ fontSize: 13, color: "#111827", lineHeight: 1.7 }}>
                <div>目标市场：<strong>{formatUiCellCn(teamCell || selectedCell || demoSelections[0]?.cell)}</strong></div>
                <div>产品定位方向：<strong>{archToSymbol(teamArch || arch)} {archToLabel(teamArch || arch)}</strong></div>
                <div style={{ marginTop: 6 }}>
                  团队能力关键词：
                  {(submissions || []).map((s, idx) => (
                    <div key={`${s.member_id || idx}_ability`} style={{ fontSize: 12, color: "#374151" }}>
                      {(s.member_name || `成员${idx + 1}`)}：{s?.hint_keyword?.market || "无"} + {s?.hint_keyword?.tech || "无"}
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div style={{
              border: "1.5px solid #e5e7eb", borderRadius: 12,
              overflow: "hidden", marginBottom: 20,
              opacity: phase3EditLocked ? 0.72 : 1,
              transition: "opacity 0.2s ease"
            }}>
              <div style={{
                padding: "16px 18px", background: "#f9fafb",
                borderBottom: "1px solid #e5e7eb",
              }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <div style={{
                      width: 28, height: 28, borderRadius: "50%",
                      background: "#1a5c3a", color: "#fff",
                      display: "flex", alignItems: "center", justifyContent: "center",
                      fontSize: 14,
                    }}>🤖</div>
                    <span style={{ fontSize: 13, fontWeight: 700, color: "#1a5c3a" }}>AI策略顾问</span>
                  </div>
                  <button
                    type="button"
                    onClick={handleDownloadCoachChat}
                    style={{
                      padding: "8px 12px",
                      borderRadius: 8,
                      border: "1px solid #d1d5db",
                      background: "#fff",
                      color: "#374151",
                      fontSize: 12,
                      fontWeight: 700,
                      cursor: "pointer",
                      whiteSpace: "nowrap"
                    }}
                  >
                    下载 TXT
                  </button>
                </div>
              </div>

              <div style={{ padding: "14px 16px", background: "#fff", borderBottom: "1px solid #e5e7eb" }}>
                <div
                  ref={coachScrollRef}
                  style={{
                    maxHeight: 360, overflowY: "auto", display: "flex", flexDirection: "column", gap: 10,
                  }}
                >
                  {coachHistory.length === 0 && (
                    <div style={{ fontSize: 13, color: "#9ca3af" }}>正在初始化教练对话...</div>
                  )}
                  {coachHistory.map((m, idx) => (
                    <div
                      key={`${m.role}-${idx}`}
                      style={{
                        alignSelf: m.role === "coach" ? "flex-start" : "flex-end",
                        maxWidth: "82%",
                        display: "flex",
                        gap: 8,
                        alignItems: "flex-start"
                      }}
                    >
                      {m.role === "coach" && (
                        <div style={{
                          width: 22, height: 22, borderRadius: "50%",
                          background: "#1a5c3a", color: "#fff",
                          fontSize: 12, display: "flex", alignItems: "center", justifyContent: "center",
                          marginTop: 2
                        }}>🤖</div>
                      )}
                      <div style={{
                        background: m.role === "coach" ? "#ffffff" : "#e8f5ee",
                        border: "1px solid #e5e7eb",
                        borderRadius: 12,
                        padding: "10px 12px",
                        fontSize: 14,
                        color: "#374151",
                        lineHeight: 1.65,
                        whiteSpace: "pre-wrap",
                      }}>
                        {m.role === "coach" ? renderCoachText(m.text) : m.text}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div style={{ display: "flex", gap: 10, alignItems: "stretch", padding: "16px", background: "#fff" }}>
                <input
                  value={coachInput}
                  onChange={(e) => setCoachInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      handleCoachSend();
                    }
                  }}
                  placeholder={isReadOnlyReview
                    ? "回看模式：不可继续发送消息"
                    : vpPanelState === "scored"
                    ? "已评分锁定，不能继续修改"
                    : vpPanelState === "confirming"
                    ? "确认切片中，请先完成确认或返回修改"
                    : "输入给 AI策略顾问 的消息..."}
                  style={{
                    flex: 1, height: 46, borderRadius: 10,
                    border: "1.5px solid #d1d5db", padding: "10px 14px",
                    fontSize: 14, outline: "none",
                    fontFamily: "inherit",
                    background: phase3ChatLocked ? "#f9fafb" : "#fff",
                  }}
                  disabled={phase3ChatLocked || isSendingCoach}
                />
                <button
                  style={{
                    padding: "0 20px", borderRadius: 10,
                    background: "#1a5c3a", color: "#fff", border: "none",
                    fontSize: 14, fontWeight: 700, cursor: "pointer",
                    whiteSpace: "nowrap", opacity: isSendingCoach ? 0.6 : 1,
                  }}
                  disabled={phase3ChatLocked || isSendingCoach || !String(coachInput || "").trim()}
                  onClick={handleCoachSend}
                >
                  发送
                </button>
              </div>
            </div>

            <div style={{
              border: "1.5px solid #e5e7eb",
              borderRadius: 12,
              padding: "18px 18px 16px",
              background: phase3EditLocked ? "#f9fafb" : "#fff",
              marginBottom: 18
            }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: "#374151", marginBottom: 8 }}>
                VP 文本框
              </div>
              <p style={{ fontSize: 12, color: "#6b7280", margin: "0 0 10px", lineHeight: 1.6 }}>
                先和顾问聊几轮，再点“合成VP”生成一句完整价值主张；你也可以继续手动修改。
              </p>
              {isLeaderLockedViewer && (
                <div style={{ marginBottom: 10, fontSize: 12, color: "#92400e", lineHeight: 1.6 }}>
                  组长 {leaderBannerName(leaderName)} 正在操作，你可以口头讨论。
                </div>
              )}
              <textarea
                value={coachVpText}
                onChange={(e) => setCoachVpText(e.target.value)}
                readOnly={phase3EditLocked}
                style={{
                  width: "100%",
                  minHeight: 112,
                  borderRadius: 10,
                  border: "1.5px solid #d1d5db",
                  padding: "12px 14px",
                  fontSize: 14,
                  resize: "vertical",
                  outline: "none",
                  fontFamily: "inherit",
                  boxSizing: "border-box",
                  background: phase3EditLocked ? "#f3f4f6" : "#fff",
                  color: "#374151",
                  lineHeight: 1.7
                }}
              />
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 14 }}>
                <button
                  type="button"
                  onClick={handleSynthesizeVp}
                  disabled={!canSynthesizeVp}
                  style={{
                    padding: "11px 20px",
                    borderRadius: 10,
                    background: "#1a5c3a",
                    color: "#fff",
                    border: "none",
                    fontSize: 14,
                    fontWeight: 700,
                    cursor: "pointer",
                    opacity: canSynthesizeVp ? (isSynthesizingVp ? 0.7 : 1) : 0.4
                  }}
                >
                  {isSynthesizingVp ? "正在合成..." : "合成VP"}
                </button>
                <button
                  type="button"
                  onClick={handleSubmitVp}
                  disabled={!canSubmitVp}
                  style={{
                    padding: "11px 20px",
                    borderRadius: 10,
                    background: canSubmitVp ? "#2FAB6E" : "#9ca3af",
                    color: "#fff",
                    border: "none",
                    fontSize: 14,
                    fontWeight: 700,
                    cursor: "pointer",
                    opacity: canSubmitVp ? (isExtractingVp ? 0.7 : 1) : 0.6
                  }}
                >
                  {isExtractingVp ? "正在分析..." : "提交VP"}
                </button>
              </div>
            </div>

            {vpPanelError && (
              <div style={{
                marginBottom: 16,
                padding: "12px 14px",
                borderRadius: 10,
                background: "#fef2f2",
                border: "1px solid #fecaca",
                color: "#b91c1c",
                fontSize: 13,
                lineHeight: 1.6
              }}>
                {vpPanelError}
              </div>
            )}

            {vpPanelState !== "chatting" && (
              <div style={{
                border: "1.5px solid #d1d5db",
                borderRadius: 12,
                padding: "18px 18px 16px",
                background: "#fff",
                marginBottom: 18
              }}>
                <div style={{ fontSize: 16, fontWeight: 800, color: "#111827", marginBottom: 6 }}>
                  确认你的价值主张切片
                </div>
                <div style={{ fontSize: 12, color: "#6b7280", marginBottom: 14, lineHeight: 1.6 }}>
                  先检查 5 个字段。确认并评分后，这一版 VP 会锁定，不能再回退修改。
                </div>

                {[
                  { key: "who_raw", label: "目标客户", required: true, placeholder: "填写目标客户是谁" },
                  { key: "pain_raw", label: "痛点", required: true, placeholder: "填写场景痛点" },
                  { key: "how_raw", label: "解决方式", required: true, placeholder: "填写解决方式" },
                  { key: "alternative_raw", label: "替代方案对比", required: false, placeholder: "如果有的话写在这里" },
                  { key: "boundary_raw", label: "边界条件", required: false, placeholder: "如果有的话写在这里" }
                ].map((item) => (
                  <div key={item.key} style={{ marginBottom: 14 }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: "#374151", marginBottom: 6 }}>
                      {item.required && <span style={{ color: "#dc2626", marginRight: 4 }}>*</span>}
                      {item.label}
                      {!item.required && <span style={{ color: "#9ca3af", marginLeft: 6, fontWeight: 500 }}>可选</span>}
                    </div>
                    <textarea
                      value={vpConfirmedFields[item.key]}
                      onChange={(e) => handleConfirmedFieldChange(item.key, e.target.value)}
                      disabled={vpPanelState === "scored" || round1TeamControlsLocked}
                      placeholder={item.placeholder}
                      style={{
                        width: "100%",
                        minHeight: 62,
                        borderRadius: 10,
                        border: "1.5px solid #d1d5db",
                        padding: "10px 12px",
                        fontSize: 14,
                        resize: "vertical",
                        outline: "none",
                        fontFamily: "inherit",
                        boxSizing: "border-box",
                        background: vpPanelState === "scored" || round1TeamControlsLocked ? "#f3f4f6" : "#fff",
                        color: "#374151",
                        lineHeight: 1.6
                      }}
                    />
                  </div>
                ))}

                {vpPanelState === "confirming" && (
                  <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 6 }}>
                    <button
                      type="button"
                      onClick={handleReturnToEditing}
                      disabled={round1TeamControlsLocked}
                      style={{
                        padding: "11px 18px",
                        borderRadius: 10,
                        border: "1px solid #d1d5db",
                        background: round1TeamControlsLocked ? "#f3f4f6" : "#fff",
                        color: "#374151",
                        fontSize: 14,
                        fontWeight: 700,
                        cursor: round1TeamControlsLocked ? "default" : "pointer"
                      }}
                    >
                      返回修改
                    </button>
                    <button
                      type="button"
                      onClick={handleConfirmAndScore}
                      disabled={isConfirmingVp || round1TeamControlsLocked}
                      style={{
                        padding: "11px 18px",
                        borderRadius: 10,
                        border: "none",
                        background: "#1a5c3a",
                        color: "#fff",
                        fontSize: 14,
                        fontWeight: 700,
                        cursor: "pointer",
                        opacity: isConfirmingVp || round1TeamControlsLocked ? 0.7 : 1
                      }}
                    >
                      {isConfirmingVp ? "正在评分..." : "确认并评分"}
                    </button>
                  </div>
                )}

                {vpPanelState === "scored" && (
                  <div style={{
                    marginTop: 6,
                    paddingTop: 12,
                    borderTop: "1px dashed #d1d5db",
                    fontSize: 12,
                    color: "#6b7280"
                  }}>
                    已确认并锁定 {vpConfirmedAt ? `· ${new Date(vpConfirmedAt).toLocaleString()}` : ""}
                  </div>
                )}
              </div>
            )}

          </div>
        )}

        {/* ── Step 5: 结果展示 ── */}
        {step === 5 && (
          <div style={{
            background: "#fff", borderRadius: 16, padding: "32px 28px",
            border: "1px solid #e5e7eb",
          }}>
            <h2 style={{ fontSize: 20, fontWeight: 800, color: "#111827", marginTop: 0 }}>
              📈 第一轮结果
            </h2>
            <div style={{
              marginTop: 12,
              marginBottom: 18,
              padding: "10px 14px",
              borderRadius: 10,
              background: "#fffbeb",
              border: "1px solid #fcd34d",
              color: "#92400e",
              fontSize: 13,
              lineHeight: 1.6,
            }}>
              你们可以点击上方步骤回看前面的讨论与选择，但此时已经进入只读模式，不能再修改。
            </div>

            <div style={{
              padding: "18px 22px", borderRadius: 12, marginTop: 16, marginBottom: 24,
              background: "linear-gradient(135deg, #065f46 0%, #1a5c3a 50%, #14532d 100%)",
              color: "#fff",
            }}>
              <div style={{ fontSize: 12, opacity: 0.7, fontWeight: 600, marginBottom: 4 }}>你们的战略选择</div>
              <div style={{ fontSize: 22, fontWeight: 800 }}>
                {formatUiCellCn(finalCell)} · {archToLabel(finalArch)}
              </div>
            </div>

            <div style={{
              padding: "20px", borderRadius: 12,
              border: "1.5px solid #e5e7eb",
              marginBottom: 16
            }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: "#374151", marginBottom: 10 }}>价值主张复盘</div>
              <div style={{
                padding: "16px 18px",
                borderRadius: 10,
                background: "#f9fafb",
                border: "1px solid #e5e7eb",
                fontSize: 16,
                color: "#111827",
                lineHeight: 1.9,
                fontWeight: 600
              }}>
                {vpRecapSentence}
              </div>
              {(vpSummary?.archConsistency || vpSummary?.coachComment) && (
                <div style={{
                  marginTop: 14,
                  paddingTop: 14,
                  borderTop: "1px dashed #d1d5db",
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
                  gap: 12
                }}>
                  <div>
                    <div style={{ fontSize: 11, color: "#6b7280", fontWeight: 700, marginBottom: 6 }}>定位一致性</div>
                    <div style={{ fontSize: 13, color: "#374151", lineHeight: 1.7 }}>
                      {vpSummary?.archConsistency || "未明确"}
                    </div>
                  </div>
                  <div>
                    <div style={{ fontSize: 11, color: "#6b7280", fontWeight: 700, marginBottom: 6 }}>AI策略顾问点评</div>
                    <div style={{ fontSize: 13, color: "#374151", lineHeight: 1.7 }}>
                      {vpSummary?.coachComment || "未明确"}
                    </div>
                  </div>
                </div>
              )}
            </div>

            <div style={{
              padding: "20px", borderRadius: 12,
              border: "1.5px solid #e5e7eb",
              marginBottom: 16
            }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: "#374151", marginBottom: 14 }}>价值主张评分</div>
              <div style={{
                maxWidth: 340,
                margin: "0 auto 18px",
                padding: "18px 16px",
                borderRadius: 12,
                background: "#f9fafb",
                border: "1px solid #e5e7eb",
                textAlign: "center"
              }}>
                <div style={{ fontSize: 12, color: "#6b7280", fontWeight: 700, marginBottom: 8 }}>
                  VP 综合评分
                </div>
                <div style={{ fontSize: 42, fontWeight: 800, color: "#111827", lineHeight: 1 }}>
                  {formatScore(resultVpScore)}
                </div>
                <div style={{ marginTop: 10 }}>
                  <StarRating score={resultVpScore} />
                </div>
              </div>
            </div>

            <div style={{
              padding: "20px", borderRadius: 12,
              border: "1.5px solid #e5e7eb",
              marginBottom: 16
            }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: "#374151", marginBottom: 10 }}>评分评语</div>
              <div style={{
                fontSize: 14,
                color: "#374151",
                lineHeight: 1.9,
                whiteSpace: "pre-wrap"
              }}>
                {resultFeedbackText}
              </div>
            </div>

            <div style={{
              padding: "20px", borderRadius: 12,
              border: "1.5px solid #e5e7eb",
              display: "flex", alignItems: "flex-start", gap: 20, flexWrap: "wrap",
              marginBottom: 16,
            }}>
              <div style={{ flex: "0 0 auto" }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: "#374151", marginBottom: 4 }}>用户支付意愿</div>
                <div style={{ fontSize: 12, color: "#9ca3af" }}>相对于该细分市场平均水平（拆分显示 VP 本身与市场锦囊）</div>
              </div>
              <div style={{ minWidth: 220 }}>
                <div style={{ fontSize: 12, color: "#6b7280", marginBottom: 4 }}>最终结果（含市场锦囊）</div>
                <div style={{ fontSize: 36, fontWeight: 800, color: wtpPct >= 0 ? "#2FAB6E" : "#dc2626" }}>
                  {wtpPct >= 0 ? `+${wtpPct}%` : `${wtpPct}%`}
                </div>
                <div style={{ fontSize: 12, color: "#9ca3af", marginTop: 8 }}>
                  仅看 VP 本身：{wtpBasePct >= 0 ? `+${wtpBasePct}%` : `${wtpBasePct}%`}
                </div>
                <div style={{ fontSize: 12, color: wtpJinangDeltaPct >= 0 ? "#2FAB6E" : "#dc2626", marginTop: 4 }}>
                  市场锦囊额外影响：{wtpJinangDeltaPct >= 0 ? `+${wtpJinangDeltaPct}%` : `${wtpJinangDeltaPct}%`}
                </div>
                {rhoDiscountValue != null && (
                  <div style={{ fontSize: 12, color: "#6b7280", marginTop: 4 }}>
                    系统已将客户定义清晰度纳入支付意愿修正。
                  </div>
                )}
                {!wtpHasJinangBoost && matchedTechJinangCount > 0 && (
                  <div style={{ fontSize: 12, color: "#6b7280", marginTop: 4 }}>
                    当前命中的是技术锦囊，只在第二轮研发/成本端生效，不影响本轮支付意愿。
                  </div>
                )}
              </div>
              <div style={{ fontSize: 13, color: "#666", lineHeight: 1.7, flex: "1 1 280px" }}>
                {wtpPct >= 0
                  ? "支付意愿先根据价值主张本身计算，再叠加市场锦囊影响；如果客户定义还不够清晰，系统会适当压低最终溢价。"
                  : "当前最终结果仍低于该细分市场平均水平，说明价值主张还需要继续加强。"}
              </div>
            </div>

            <div style={{
              padding: "20px", borderRadius: 12,
              background: "#f0fdf4", border: "1.5px solid #bbf7d0",
              marginBottom: 16,
            }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: "#166534", marginBottom: 10 }}>🎯 锦囊匹配结果</div>
              <div style={{ fontSize: 13, color: "#15803d", marginBottom: 10 }}>
                团队共 {totalJinangCount} 张锦囊中，{matchedJinangCount} 张与当前定位匹配
                {`（市场 ${matchedMarketJinangCount} 张，技术 ${matchedTechJinangCount} 张）`}
              </div>
              {resultMarketJinang && (
                <div style={{
                  marginBottom: 10,
                  padding: "10px 12px",
                  borderRadius: 10,
                  background: "#dcfce7",
                  border: "1px solid #86efac",
                  fontSize: 12,
                  color: "#166534",
                  lineHeight: 1.7
                }}>
                  市场锦囊最高匹配项：<strong>{resultMarketJinang.name}</strong>
                  {`（契合度 ${Math.round(Number(resultMarketJinang.match_strength || 0) * 100)}%）`}
                  {resultMarketJinangBonusPct > 0
                    ? `，为支付意愿额外增加了 ${resultMarketJinangBonusPct}%。`
                    : "，但本轮未形成额外市场端增益。"}
                </div>
              )}
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 10 }}>
                {visibleMatches.map((item) => (
                  <div key={item.id} style={{
                    padding: "10px 14px", borderRadius: 10,
                    background: "#fff", border: "1px solid #bbf7d0",
                    fontSize: 12, lineHeight: 1.6, flex: "1 1 260px",
                  }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
                      <span style={{ fontSize: 18 }}>{item.card.icon}</span>
                      <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
                        <span style={{ fontWeight: 700, color: "#166534", fontSize: 13 }}>{item.cardTitle}</span>
                        <span style={{ fontSize: 11, color: "#6b7280" }}>{item.cardId}</span>
                      </div>
                      <span style={{
                        marginLeft: "auto", padding: "2px 8px", borderRadius: 4,
                        background: item.label === "高匹配" ? "#22c55e" : "#86efac",
                        color: "#fff", fontSize: 10, fontWeight: 600
                      }}>{item.label}</span>
                    </div>
                    <div style={{ fontSize: 11, color: "#6b7280", marginBottom: 4 }}>
                      生效范围：{item.scope}
                    </div>
                    <div style={{ color: "#4b5563" }}>{item.text}</div>
                  </div>
                ))}
              </div>
              <div style={{ fontSize: 12, color: "#6b7280" }}>
                市场锦囊会影响第一轮支付意愿；技术锦囊不直接加第一轮分数，而是在第二轮产品能力、成本和风险计算里生效。所有团队成员的锦囊（包括未匹配的）都会带入第二轮计算。
              </div>
            </div>

            <div style={{
              padding: "22px", borderRadius: 12,
              background: "#1e293b", color: "#fff",
            }}>
              <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 12 }}>
                🎉 第一轮决策完成
              </div>
              <div style={{ fontSize: 14, opacity: 0.9, lineHeight: 1.8, marginBottom: 16 }}>
                你们已经完成了产品战略制定。请先放下手机/电脑，回到课堂参与集体讨论。
              </div>
              <div style={{
                padding: "16px", borderRadius: 10,
                background: "rgba(255,255,255,0.08)",
                marginBottom: 16,
              }}>
                <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8, opacity: 0.7 }}>
                  接下来的课堂环节
                </div>
                <div style={{ fontSize: 13, lineHeight: 1.8, opacity: 0.85 }}>
                  老师将带领大家回顾各组的战略选择，讨论不同方向的优劣势。之后再进入第二轮：产品研发决策。
                </div>
              </div>
              <button
                type="button"
                onClick={handleFreeze}
                disabled={round1TeamControlsLocked || isFreezing}
                style={{
                  width: "100%",
                  padding: "12px 18px",
                  borderRadius: 10,
                  border: "none",
                  background: "#10b981",
                  color: "#fff",
                  fontSize: 14,
                  fontWeight: 800,
                  cursor: round1TeamControlsLocked ? "default" : "pointer",
                  opacity: round1TeamControlsLocked ? 0.5 : 1,
                  marginBottom: 14
                }}
              >
                {round1TeamControlsLocked
                  ? (isReadOnlyReview ? "本轮结果已冻结" : `仅组长 ${leaderBannerName(leaderName)} 可冻结`)
                  : isFreezing
                    ? "处理中..."
                    : (teamSize === 1 || entryMode === "trial"
                      ? "完成 Round 1 并进入 Round 2"
                      : "冻结本轮结果")}
              </button>
              <div style={{ fontSize: 12, opacity: 0.5, textAlign: "center" }}>
                {teamSize === 1 || entryMode === "trial" ? "单人模式会自动进入第二轮" : "第二轮将由老师统一开启"}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
