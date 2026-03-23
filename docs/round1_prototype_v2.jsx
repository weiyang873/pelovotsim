import { useState, useEffect, useRef } from "react";

// ── Data: 20 锦囊 Cards (cleaned - no student-facing IDs or round labels) ──
const MARKET_CARDS = [
  { id: "M01", title: "银发社区合伙人", subtitle: "渠道 · 老年市场", desc: "你在养老社区有深度合作关系，能以远低于市场价的成本铺设线下体验点。适合面向老年人群的直销或体验式渠道。", tags: ["老人", "ToC", "渠道优势"], icon: "🏘️", affinity: { age: "ELDER", channel: "DIRECT" } },
  { id: "M02", title: "母婴KOL矩阵", subtitle: "流量 · 儿童市场", desc: "你的团队运营着一个头部母婴内容矩阵，能快速触达有娃家庭的决策者（父母），电商转化率显著高于行业均值。", tags: ["儿童", "ToC", "电商流量"], icon: "👶", affinity: { age: "CHILD", channel: "ECOM" } },
  { id: "M03", title: "企业福利采购入口", subtitle: "客户 · B2B通道", desc: "你有大型企业HR部门的采购关系网，能将机器人打包进员工福利或企业礼品方案，单笔订单量大且决策链短。", tags: ["ToB", "成人", "批量采购"], icon: "🏢", affinity: { customer: "ToB", age: "ADULT" } },
  { id: "M04", title: "跨境供应链资源", subtitle: "成本 · 全球采购", desc: "你有成熟的跨境供应链管理经验和海外代工合作方，能在不牺牲品质的前提下显著压缩硬件生产成本。", tags: ["成本领先", "供应链"], icon: "🚢", affinity: { strategy: "COST" } },
  { id: "M05", title: "高端体验店联盟", subtitle: "品牌 · 差异化渠道", desc: "你与多家高端商场和生活方式买手店有合作协议，能让产品出现在'被策展'的零售场景中，提升品牌调性和支付意愿。", tags: ["差异化", "成人", "品牌溢价"], icon: "✨", affinity: { strategy: "DIFF", age: "ADULT" } },
  { id: "M06", title: "政府养老补贴通道", subtitle: "政策 · 机构市场", desc: "你了解地方政府的智慧养老补贴政策，能帮助养老机构以补贴价采购，降低机构客户的实际支付门槛。", tags: ["ToB", "老人", "政策红利"], icon: "🏛️", affinity: { customer: "ToB", age: "ELDER" } },
  { id: "M07", title: "教育渠道独家协议", subtitle: "渠道 · 教育场景", desc: "你与多家幼儿园和小学课后托管机构有框架合作，能直接将产品植入教育场景，家长接受度高且续费粘性强。", tags: ["ToB", "儿童", "教育场景"], icon: "🎓", affinity: { customer: "ToB", age: "CHILD" } },
  { id: "M08", title: "社交裂变运营团队", subtitle: "增长 · 用户获取", desc: "你的团队擅长私域流量运营和社交裂变，能以极低获客成本快速起量，特别适合单价适中、话题性强的消费品。", tags: ["ToC", "成本领先", "增长"], icon: "📱", affinity: { customer: "ToC", strategy: "COST" } },
  { id: "M09", title: "医疗健康合规资质", subtitle: "壁垒 · 健康场景", desc: "你持有医疗器械二类备案资质和健康数据合规认证，能让产品进入'健康管理'品类，打开医院和康复中心的采购通道。", tags: ["ToB", "老人", "差异化壁垒"], icon: "🏥", affinity: { customer: "ToB", age: "ELDER", strategy: "DIFF" } },
  { id: "M10", title: "订阅内容合作生态", subtitle: "商业模式 · 订阅增值", desc: "你有IP内容授权和持续内容生产能力（故事、音乐、互动剧本），能支撑'硬件+订阅'商业模式，提升用户生命周期价值。", tags: ["差异化", "订阅", "内容生态"], icon: "🎭", affinity: { strategy: "DIFF" } },
];

const TECH_CARDS = [
  { id: "T01", title: "低成本语音芯片方案", subtitle: "硬件 · 语音交互", desc: "你有一颗经过验证的国产语音AI芯片，功耗和成本都远低于主流方案，能让语音交互功能的BOM大幅下降。", tags: ["成本领先", "语音", "降本"], icon: "🔊", affinity: { strategy: "COST", r2dim: "交互与表达" } },
  { id: "T02", title: "情感计算算法专利", subtitle: "软件 · 情感识别", desc: "你的团队拥有多模态情感识别的核心专利（语音+表情+体态），识别准确率领先，能实现真正'读懂情绪'的陪伴体验。", tags: ["差异化", "感知", "专利壁垒"], icon: "🧠", affinity: { strategy: "DIFF", r2dim: "感知与理解" } },
  { id: "T03", title: "模块化机身设计能力", subtitle: "硬件 · 可定制外观", desc: "你有成熟的模块化工业设计团队，能快速出多款外壳/配件，支持不同年龄段和场景的外观定制，降低换代成本。", tags: ["多年龄段", "外观", "灵活"], icon: "🧩", affinity: { r2dim: "可扩展与连接" } },
  { id: "T04", title: "跌倒检测传感器套件", subtitle: "硬件 · 安全监护", desc: "你拿到了一款医疗级跌倒检测传感器的独家代理，体积小、误报率低，能让机器人兼具'安全守护'功能。", tags: ["老人", "安全", "健康监护"], icon: "🛡️", affinity: { age: "ELDER", r2dim: "安全与信任" } },
  { id: "T05", title: "端侧大模型部署经验", subtitle: "软件 · 本地AI", desc: "你的团队有在边缘设备部署轻量大模型的成熟经验，能实现离线多轮对话，不依赖云端，隐私保护和响应速度都更好。", tags: ["差异化", "隐私", "对话"], icon: "⚡", affinity: { strategy: "DIFF", r2dim: "交互与表达" } },
  { id: "T06", title: "机器人运动控制IP", subtitle: "硬件 · 运动能力", desc: "你有自研的小型机器人运动控制方案（步态/平衡/避障），能让机器人在家庭环境中自由移动，而不只是桌面摆件。", tags: ["运动", "差异化", "家庭场景"], icon: "🦿", affinity: { strategy: "DIFF", r2dim: "运动与导航" } },
  { id: "T07", title: "OTA远程运维平台", subtitle: "软件 · 运维效率", desc: "你有成熟的IoT设备远程诊断和OTA升级平台，能大幅降低售后维护成本，支持大规模部署后的远程管理。", tags: ["ToB", "运维", "降本"], icon: "🔧", affinity: { customer: "ToB", r2dim: "可运营与可维护" } },
  { id: "T08", title: "儿童安全交互认证", subtitle: "合规 · 儿童安全", desc: "你的产品已通过儿童产品安全认证（含材料/电磁/数据隐私），这在儿童市场是硬性门槛，竞争对手多数不具备。", tags: ["儿童", "安全", "合规壁垒"], icon: "🧸", affinity: { age: "CHILD", r2dim: "安全与信任" } },
  { id: "T09", title: "低功耗续航方案", subtitle: "硬件 · 电池续航", desc: "你有一套经过量产验证的低功耗方案（含芯片选型+电源管理），能在不增加电池体积的前提下让续航翻倍。", tags: ["成本领先", "续航", "用户体验"], icon: "🔋", affinity: { strategy: "COST", r2dim: "可运营与可维护" } },
  { id: "T10", title: "开放API与生态接口", subtitle: "软件 · 平台化", desc: "你有构建开发者生态的经验和现成SDK，能让第三方开发者为机器人开发技能和内容，形成平台效应。", tags: ["差异化", "平台", "生态"], icon: "🔌", affinity: { strategy: "DIFF", r2dim: "可扩展与连接" } },
];

const ALL_CARDS = [...MARKET_CARDS, ...TECH_CARDS];

// ── Affinity matching helper ──
function cardMatchesCell(card, cellKey) {
  if (!card.affinity) return false;
  const [customer, strategy, age] = cellKey.split("_");
  const a = card.affinity;
  let match = false;
  if (a.customer && a.customer === customer) match = true;
  if (a.strategy && a.strategy === strategy) match = true;
  if (a.age && a.age === age) match = true;
  if (a.customer && a.customer !== customer) return false;
  if (a.strategy && a.strategy !== strategy) return false;
  if (a.age && a.age !== age) return false;
  // If card has at least one relevant affinity key and none conflicts
  const relevantKeys = ["customer", "strategy", "age"].filter(k => a[k]);
  if (relevantKeys.length === 0) return false;
  return true;
}

// ── UI Constants ──
const FLOW_STEPS = [
  { id: 0, label: "建组" },
  { id: 1, label: "个人锦囊" },
  { id: 2, label: "选战略" },
  { id: 3, label: "战略分布" },
  { id: 4, label: "价值主张" },
  { id: 5, label: "结果" },
];

const MEMBER_COLORS = ["#E8634A", "#3B82C4", "#2FAB6E", "#D4A03C", "#8B5CF6", "#EC4899"];
const MEMBER_NAMES = ["成员A", "成员B", "成员C", "成员D", "成员E", "成员F"];

// ── Card Component (cleaned) ──
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
        transition: "all 0.4s ease",
      }}>
        <span>{card.icon}</span>
        <span style={{ fontWeight: 600 }}>{card.title}</span>
        {glowing && <span style={{ fontSize: 10, color: accentColor, fontWeight: 700 }}>✦ 匹配</span>}
      </div>
    );
  }

  const isFlippable = onFlip !== undefined;

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
        background: (isFlippable && !flipped) ? "#1a1a2e" : bgGrad,
        padding: (isFlippable && !flipped) ? 0 : "16px 14px",
        cursor: onSelect || onFlip ? "pointer" : "default",
        transition: "all 0.3s ease",
        boxShadow: selected ? `0 4px 20px ${accentColor}30` : "0 2px 8px rgba(0,0,0,0.06)",
        display: "flex", flexDirection: "column",
        overflow: "hidden",
      }}
    >
      {isFlippable && !flipped ? (
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
        <>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
            <span style={{ fontSize: size === "compact" ? 22 : 28 }}>{card.icon}</span>
            <div>
              <div style={{
                fontSize: size === "compact" ? 14 : 16, fontWeight: 700,
                color: "#111827", lineHeight: 1.3,
              }}>{card.title}</div>
              <div style={{ fontSize: 11, color: isMarket ? "#2FAB6E" : "#3B82C4", fontWeight: 600, marginTop: 2, opacity: 0.8 }}>
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

// ── Step Indicator ──
function StepBar({ current, onStep }) {
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 0,
      margin: "0 auto 28px", maxWidth: 640,
    }}>
      {FLOW_STEPS.map((s, i) => (
        <div key={s.id} style={{ display: "flex", alignItems: "center", flex: i < FLOW_STEPS.length - 1 ? 1 : "none" }}>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 5 }}>
            <div
              onClick={() => onStep(s.id)}
              style={{
                width: 36, height: 36, borderRadius: "50%",
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: 13, fontWeight: 700, cursor: "pointer",
                background: i < current ? "#2FAB6E" : i === current ? "#1a5c3a" : "#e5e7eb",
                color: i <= current ? "#fff" : "#9ca3af",
                transition: "all 0.3s",
                boxShadow: i === current ? "0 0 0 3px #1a5c3a33" : "none",
              }}
            >{i < current ? "✓" : i + 1}</div>
            <span style={{
              fontSize: 11, fontWeight: i === current ? 700 : 400,
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
      ))}
    </div>
  );
}

// ── 12-Grid Strategy Map ──
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
                          <div key={m.memberIdx} style={{
                            width: 28, height: 28, borderRadius: m.memberIdx >= 6 ? 6 : "50%",
                            background: m.memberIdx >= 6 ? "#1a5c3a" : MEMBER_COLORS[m.memberIdx],
                            color: "#fff", fontSize: 11, fontWeight: 700,
                            display: "flex", alignItems: "center", justifyContent: "center",
                          }}>
                            {m.memberIdx >= 6 ? "✓" : String.fromCharCode(65 + m.memberIdx)}
                          </div>
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

// ── Main App ──
export default function App() {
  const [step, setStep] = useState(0);
  const [entryMode, setEntryMode] = useState(null); // "classroom" | "trial"
  const [teamSize, setTeamSize] = useState(4);
  const [teamName, setTeamName] = useState("第3组");
  const [revealedCards, setRevealedCards] = useState({});
  const [selectedCell, setSelectedCell] = useState(null);
  const [selectedArch, setSelectedArch] = useState(null);
  const [teamCell, setTeamCell] = useState(null);
  const [teamArch, setTeamArch] = useState(null);

  // Demo data
  const demoSelections = [
    { memberIdx: 0, cell: "ToC_DIFF_ADULT" },
    { memberIdx: 1, cell: "ToC_DIFF_ELDER" },
    { memberIdx: 2, cell: "ToC_DIFF_ADULT" },
    { memberIdx: 3, cell: "ToB_DIFF_ELDER" },
  ];

  const demoAssignments = [
    { memberIdx: 0, cards: ["M05", "T02"] },
    { memberIdx: 1, cards: ["M01", "T04"] },
    { memberIdx: 2, cards: ["M08", "T01"] },
    { memberIdx: 3, cards: ["M06", "T07"] },
  ];

  // The consensus cell for jinang matching — uses team selection if set, otherwise default demo
  const consensusCell = teamCell || "ToB_DIFF_ELDER";

  const flipCard = (id) => {
    setRevealedCards((prev) => ({ ...prev, [id]: true }));
  };
  const getCard = (id) => ALL_CARDS.find((c) => c.id === id);
  const allFlipped = Object.keys(revealedCards).length >= 2;

  return (
    <div style={{
      fontFamily: "'Noto Sans SC', 'SF Pro Display', -apple-system, sans-serif",
      background: "#fafaf8", minHeight: "100vh", padding: "24px 20px",
    }}>
      <div style={{ maxWidth: 960, margin: "0 auto" }}>
        {/* Header — no "查看全部锦囊卡" button */}
        <div style={{
          display: "flex", alignItems: "baseline", gap: 12,
          marginBottom: 8,
        }}>
          <h1 style={{
            fontSize: 22, fontWeight: 800, color: "#111827", margin: 0,
            letterSpacing: -0.5,
          }}>
            Round 1 · 第一轮决策：产品战略制定
          </h1>
        </div>

        <StepBar current={step} onStep={setStep} />

        {/* ══════════ Step 0: 确认小组 / 建组 ══════════ */}
        {step === 0 && !entryMode && (
          <div style={{
            background: "#fff", borderRadius: 16, padding: "32px 28px",
            border: "1px solid #e5e7eb", textAlign: "center",
          }}>
            <h2 style={{ fontSize: 20, fontWeight: 800, color: "#111827", marginTop: 0 }}>
              👋 欢迎进入 LOVOT 产品创新战略模拟
            </h2>
            <p style={{ fontSize: 14, color: "#666", marginTop: 4, marginBottom: 28, lineHeight: 1.7 }}>
              你们将作为一个团队，为 LOVOT 陪伴机器人制定产品创新战略。
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
                <div style={{ fontSize: 11, opacity: 0.7, marginTop: 4, fontWeight: 400 }}>用学号登录，小组已分好</div>
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
                <div style={{ fontSize: 11, color: "#9ca3af", marginTop: 4, fontWeight: 400 }}>自行建组体验流程</div>
              </button>
            </div>
          </div>
        )}

        {/* Classroom mode: confirm pre-assigned team */}
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
              <div style={{ fontSize: 22, fontWeight: 800, color: "#1a5c3a" }}>{teamName}</div>
              <div style={{ fontSize: 13, color: "#666", marginTop: 4 }}>{teamSize} 人</div>
            </div>

            <div style={{ marginBottom: 24 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: "#374151", marginBottom: 10 }}>
                小组成员
              </div>
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                {Array.from({ length: teamSize }).map((_, i) => (
                  <div key={i} style={{
                    display: "flex", alignItems: "center", gap: 8,
                    padding: "8px 14px", borderRadius: 10,
                    background: i === 0 ? `${MEMBER_COLORS[i]}20` : `${MEMBER_COLORS[i]}12`,
                    border: i === 0 ? `2px solid ${MEMBER_COLORS[i]}` : `1.5px solid ${MEMBER_COLORS[i]}30`,
                  }}>
                    <div style={{
                      width: 28, height: 28, borderRadius: "50%",
                      background: MEMBER_COLORS[i], color: "#fff",
                      display: "flex", alignItems: "center", justifyContent: "center",
                      fontSize: 13, fontWeight: 700,
                    }}>{String.fromCharCode(65 + i)}</div>
                    <span style={{ fontSize: 13, fontWeight: 600, color: "#374151" }}>
                      {i === 0 ? "你（张明）" : MEMBER_NAMES[i]}
                    </span>
                  </div>
                ))}
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
              >← 返回</button>
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

        {/* Trial mode: create team */}
        {step === 0 && entryMode === "trial" && (
          <div style={{
            background: "#fff", borderRadius: 16, padding: "32px 28px",
            border: "1px solid #e5e7eb",
          }}>
            <h2 style={{ fontSize: 20, fontWeight: 800, color: "#111827", marginTop: 0 }}>
              🎮 试玩模式 · 建立小组
            </h2>
            <p style={{ fontSize: 14, color: "#666", marginTop: 4, marginBottom: 20, lineHeight: 1.7 }}>
              体验完整的模拟流程。选择小组人数后开始。
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
                小组成员
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
            <div style={{ display: "flex", gap: 10, marginTop: 28 }}>
              <button
                onClick={() => setEntryMode(null)}
                style={{
                  padding: "12px 20px", borderRadius: 10,
                  background: "#fff", color: "#666", border: "1.5px solid #d1d5db",
                  fontSize: 14, fontWeight: 600, cursor: "pointer",
                }}
              >← 返回</button>
              <button
                onClick={() => setStep(1)}
                style={{
                  padding: "12px 32px", borderRadius: 10,
                  background: "#1a5c3a", color: "#fff", border: "none",
                  fontSize: 15, fontWeight: 700, cursor: "pointer",
                }}
              >确认建组，开始 Round 1 →</button>
            </div>
          </div>
        )}

        {/* ══════════ Step 1: 个人锦囊 (IMPROVED) ══════════ */}
        {step === 1 && (
          <div style={{
            background: "#fff", borderRadius: 16, padding: "32px 28px",
            border: "1px solid #e5e7eb",
          }}>
            <h2 style={{ fontSize: 20, fontWeight: 800, color: "#111827", marginTop: 0, display: "flex", alignItems: "center", gap: 8 }}>
              <span>🎯</span> 你的个人锦囊
            </h2>
            <p style={{ fontSize: 14, color: "#666", marginTop: 4, marginBottom: 20, lineHeight: 1.7 }}>
              每位成员获得 2 张锦囊（1 市场能力 + 1 技术能力），描述了你在某些方面的独特能力。
            </p>

            {/* Tip box — team resource pool logic */}
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
              <div style={{ fontWeight: 700, marginBottom: 4, fontSize: 14 }}>
                💡 怎么用锦囊？
              </div>
              <div>
                锦囊描述了你在某些方面的独特能力。小组所有成员的锦囊都会在最终结算时生效——
                <strong>关键是团队选择的市场定位和价值主张能否"击中"这些能力。</strong>匹配度越高，团队在成本或市场份额上的优势越大。
              </div>
              <div style={{
                marginTop: 8, paddingTop: 8,
                borderTop: "1px dashed #e0d48a",
                color: "#7a6a2a",
              }}>
                🤔 锦囊能力不是必须使用的——你也完全可以根据案例材料和自己的商业判断来选择方向。锦囊是加分项，不是限制项。
              </div>
            </div>

            {/* Reading guide */}
            <p style={{
              fontSize: 13, color: "#888", margin: "0 0 16px",
              lineHeight: 1.6, fontStyle: "italic",
            }}>
              仔细读一读每张卡描述的能力——想想它们和哪些市场方向最契合。
            </p>

            {/* Cards — no IDs, no R1/R2 labels */}
            <div style={{ display: "flex", gap: 20, flexWrap: "wrap" }}>
              <JinnangCard
                card={getCard("M05")}
                flipped={revealedCards["M05"]}
                onFlip={flipCard}
              />
              <JinnangCard
                card={getCard("T02")}
                flipped={revealedCards["T02"]}
                onFlip={flipCard}
              />
            </div>

            {/* CTA — disabled until both flipped */}
            <div style={{ marginTop: 28 }}>
              <button
                onClick={() => allFlipped && setStep(2)}
                style={{
                  padding: "12px 32px", borderRadius: 10,
                  background: allFlipped ? "#1a5c3a" : "#ccc",
                  color: "#fff", border: "none",
                  fontSize: 15, fontWeight: 700,
                  cursor: allFlipped ? "pointer" : "not-allowed",
                  transition: "all 0.3s",
                }}
              >{allFlipped ? "我看好了，去选战略 →" : "请先翻开两张锦囊"}</button>
              {allFlipped && (
                <p style={{ margin: "10px 0 0", fontSize: 12, color: "#999" }}>
                  下一步：选择目标市场和产品定位方向，并撰写你的价值主张草稿
                </p>
              )}
            </div>
          </div>
        )}

        {/* ══════════ Step 2: 个人选战略 (IMPROVED) ══════════ */}
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
              <br/>
              <span style={{ fontSize: 13, color: "#999" }}>这是你的个人初选——之后小组会看到所有人的选择，再一起讨论收敛。</span>
            </p>

            {/* Mini cards for reference */}
            <div style={{
              display: "flex", gap: 8, marginBottom: 16, alignItems: "center", flexWrap: "wrap",
            }}>
              <span style={{ fontSize: 12, color: "#9ca3af", fontWeight: 600 }}>你的锦囊：</span>
              <JinnangCard card={getCard("M05")} size="mini" />
              <JinnangCard card={getCard("T02")} size="mini" />
            </div>

            {/* Grid axis explanation */}
            <div style={{
              display: "flex", gap: 12, marginBottom: 14, flexWrap: "wrap",
              fontSize: 12, color: "#666", lineHeight: 1.6,
            }}>
              <div style={{
                padding: "8px 12px", borderRadius: 8,
                background: "#f9fafb", border: "1px solid #e5e7eb", flex: "1 1 220px",
              }}>
                <strong style={{ color: "#374151" }}>差异化</strong>：靠独特体验或功能赢得用户，可以定更高的价格，但目标人群更窄
              </div>
              <div style={{
                padding: "8px 12px", borderRadius: 8,
                background: "#f9fafb", border: "1px solid #e5e7eb", flex: "1 1 220px",
              }}>
                <strong style={{ color: "#374151" }}>成本领先</strong>：靠性价比和规模赢得用户，价格敏感但人群基数更大
              </div>
            </div>

            <StrategyGrid
              selections={selectedCell ? [{ memberIdx: 0, cell: selectedCell }] : []}
              highlightCell={selectedCell}
              onCellClick={(cell) => setSelectedCell(cell)}
            />

            {/* Architecture selection — main question, selectable */}
            <div style={{ marginTop: 28 }}>
              <div style={{ fontSize: 15, fontWeight: 700, color: "#111827", marginBottom: 14 }}>
                你希望 LOVOT 在这个市场中主要靠什么打动用户？
              </div>
              <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
                {[
                  {
                    key: "experience",
                    label: "体验型 ●",
                    desc: "用户买的是情感价值和陪伴体验，功能够用就行",
                    examples: "例：老人每天和 LOVOT 说话解闷；孩子把它当宠物养",
                    color: "#8B5CF6",
                  },
                  {
                    key: "hybrid",
                    label: "混合型 ▲",
                    desc: "体验和功能都是卖点，缺一不可",
                    examples: "例：既能陪伴老人，又能检测跌倒并通知家属",
                    color: "#D4A03C",
                  },
                  {
                    key: "function",
                    label: "功能型 ■",
                    desc: "用户买的是实用功能，情感体验是锦上添花",
                    examples: "例：企业采购用于前台接待和导览；学校用于编程教育",
                    color: "#3B82C4",
                  },
                ].map((arch) => {
                  const isSelected = selectedArch === arch.key;
                  return (
                    <div
                      key={arch.key}
                      onClick={() => setSelectedArch(arch.key)}
                      style={{
                        padding: "14px 16px", borderRadius: 12,
                        border: isSelected ? `2.5px solid ${arch.color}` : "1.5px solid #d1d5db",
                        background: isSelected ? `${arch.color}08` : "#fff",
                        cursor: "pointer", flex: "1 1 200px",
                        transition: "all 0.2s",
                        boxShadow: isSelected ? `0 2px 12px ${arch.color}20` : "none",
                      }}
                    >
                      <div style={{
                        fontSize: 15, fontWeight: 700,
                        color: isSelected ? arch.color : "#374151",
                      }}>{arch.label}</div>
                      <div style={{ fontSize: 13, color: "#555", marginTop: 6, lineHeight: 1.6 }}>
                        {arch.desc}
                      </div>
                      <div style={{
                        fontSize: 12, color: "#999", marginTop: 6,
                        fontStyle: "italic", lineHeight: 1.5,
                      }}>
                        {arch.examples}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* 价值主张草稿 */}
            <div style={{ marginTop: 24 }}>
              <label style={{ fontSize: 13, fontWeight: 600, color: "#374151", display: "block", marginBottom: 6 }}>
                一句话价值主张草稿（选填）
              </label>
              <p style={{ fontSize: 12, color: "#999", margin: "0 0 6px" }}>
                尝试回答：给谁（WHO）、解决什么问题（PAIN）、怎么解决（HOW）
              </p>
              <textarea
                placeholder="例：为独居年轻白领提供下班后的情感陪伴，通过主动感知情绪和多轮对话缓解孤独感……"
                style={{
                  width: "100%", minHeight: 64, borderRadius: 8,
                  border: "1.5px solid #d1d5db", padding: "10px 12px",
                  fontSize: 14, resize: "vertical", outline: "none",
                  fontFamily: "inherit", boxSizing: "border-box",
                }}
              />
            </div>

            {/* Submit — requires both cell and arch */}
            <button
              onClick={() => selectedCell && selectedArch && setStep(3)}
              style={{
                marginTop: 20, padding: "12px 32px", borderRadius: 10,
                background: (selectedCell && selectedArch) ? "#1a5c3a" : "#ccc",
                color: "#fff", border: "none",
                fontSize: 15, fontWeight: 700,
                cursor: (selectedCell && selectedArch) ? "pointer" : "not-allowed",
                transition: "all 0.3s",
              }}
            >{(selectedCell && selectedArch)
              ? "提交我的选择 →"
              : `请${!selectedCell ? "选择目标市场" : ""}${!selectedCell && !selectedArch ? "并" : ""}${!selectedArch ? "选择产品定位方向" : ""}`
            }</button>
          </div>
        )}

        {/* ══════════ Step 3: 战略分布 + 亮锦囊 (IMPROVED) ══════════ */}
        {step === 3 && (
          <div style={{
            background: "#fff", borderRadius: 16, padding: "32px 28px",
            border: "1px solid #e5e7eb",
          }}>
            <h2 style={{ fontSize: 20, fontWeight: 800, color: "#111827", marginTop: 0 }}>
              📊 小组战略分布
            </h2>
            <p style={{ fontSize: 14, color: "#666", marginTop: 4, marginBottom: 20, lineHeight: 1.7 }}>
              所有人的选择已揭晓。观察你们的共识和分歧，讨论后在下方确定团队的统一方向。
            </p>

            <StrategyGrid selections={demoSelections} />

            {/* Member legend with jinang cards */}
            <div style={{
              marginTop: 20, display: "flex", gap: 16, flexWrap: "wrap",
              padding: "16px", background: "#f9fafb", borderRadius: 10,
            }}>
              {demoSelections.map((sel) => {
                const assignment = demoAssignments.find((a) => a.memberIdx === sel.memberIdx);
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
                        {MEMBER_NAMES[sel.memberIdx]}
                      </div>
                      <div style={{ fontSize: 11, color: "#9ca3af", marginTop: 2 }}>
                        选择: {sel.cell.replace(/_/g, " · ")}
                      </div>
                      {assignment && (
                        <div style={{ display: "flex", gap: 4, marginTop: 4, flexWrap: "wrap" }}>
                          {assignment.cards.map((cid) => {
                            const c = getCard(cid);
                            if (!c) return null;
                            return (
                              <JinnangCard
                                key={cid}
                                card={c}
                                size="mini"
                                glowing={cardMatchesCell(c, consensusCell)}
                              />
                            );
                          })}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Jinang match insight — "亮锦囊" */}
            <div style={{
              marginTop: 20, padding: "16px 20px", borderRadius: 12,
              background: "#f0fdf4", border: "1.5px solid #bbf7d0",
            }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: "#166534", marginBottom: 8 }}>
                🔦 锦囊匹配分析
              </div>
              <div style={{ fontSize: 13, color: "#15803d", lineHeight: 1.8 }}>
                如果团队选择 <strong>ToB · 差异化 · 老人</strong>：
              </div>
              <div style={{
                display: "flex", gap: 8, flexWrap: "wrap", margin: "10px 0",
              }}>
                {[
                  { cid: "M01", member: "成员B", reason: "养老社区渠道资源" },
                  { cid: "M06", member: "成员D", reason: "政府补贴采购通道" },
                  { cid: "T04", member: "成员B", reason: "跌倒检测传感器（R2降本）" },
                  { cid: "T07", member: "成员D", reason: "OTA运维平台（R2降本）" },
                ].map((item) => {
                  const c = getCard(item.cid);
                  return c ? (
                    <div key={item.cid} style={{
                      display: "flex", alignItems: "center", gap: 6,
                      padding: "6px 12px", borderRadius: 8,
                      background: "#dcfce7", border: "1px solid #86efac",
                      fontSize: 12,
                    }}>
                      <span>{c.icon}</span>
                      <span style={{ fontWeight: 600, color: "#166534" }}>{c.title}</span>
                      <span style={{ color: "#4ade80" }}>·</span>
                      <span style={{ color: "#15803d" }}>{item.member}</span>
                    </div>
                  ) : null;
                })}
              </div>
              <div style={{ fontSize: 12, color: "#4ade80", marginTop: 4 }}>
                4 张锦囊可激活 — 市场能力和技术能力都有覆盖
              </div>
            </div>

            {/* Insight box */}
            <div style={{
              marginTop: 16, padding: "14px 18px", borderRadius: 10,
              background: "linear-gradient(135deg, #fef3c7, #fef9c3)",
              border: "1px solid #fde68a",
            }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: "#92400e", marginBottom: 6 }}>
                📌 分布洞察
              </div>
              <div style={{ fontSize: 13, color: "#78350f", lineHeight: 1.7 }}>
                3/4 的成员选择了<strong>差异化</strong>策略，2 人集中在 <strong>ToC · 成人</strong>。
                成员B 和 D 都偏向<strong>老人</strong>市场。
                需要讨论的核心分歧：<strong>ToC 成人 vs ToB 老人</strong>。
              </div>
            </div>

            {/* ── Team Consensus: 确定小组最终选择 ── */}
            <div style={{
              marginTop: 28, padding: "24px 22px", borderRadius: 14,
              background: "linear-gradient(135deg, #f8fafc 0%, #f1f5f9 100%)",
              border: "2px solid #1a5c3a30",
            }}>
              <div style={{ fontSize: 16, fontWeight: 800, color: "#111827", marginBottom: 6 }}>
                ✅ 确定小组最终选择
              </div>
              <p style={{ fontSize: 13, color: "#666", margin: "0 0 16px", lineHeight: 1.6 }}>
                讨论完成后，在这里确认团队的统一方向。这个选择将作为后续撰写价值主张的基础。
              </p>

              {/* Team grid selection */}
              <div style={{ fontSize: 13, fontWeight: 600, color: "#374151", marginBottom: 8 }}>
                团队目标市场
              </div>
              <StrategyGrid
                selections={teamCell ? [{ memberIdx: 99, cell: teamCell }] : []}
                highlightCell={teamCell}
                onCellClick={(cell) => setTeamCell(cell)}
              />

              {/* Team arch selection */}
              <div style={{ fontSize: 13, fontWeight: 600, color: "#374151", marginTop: 20, marginBottom: 10 }}>
                团队产品定位方向
              </div>
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                {[
                  { key: "experience", label: "体验型 ●", color: "#8B5CF6" },
                  { key: "hybrid", label: "混合型 ▲", color: "#D4A03C" },
                  { key: "function", label: "功能型 ■", color: "#3B82C4" },
                ].map((arch) => {
                  const isSel = teamArch === arch.key;
                  return (
                    <button
                      key={arch.key}
                      onClick={() => setTeamArch(arch.key)}
                      style={{
                        padding: "10px 20px", borderRadius: 10,
                        border: isSel ? `2.5px solid ${arch.color}` : "1.5px solid #d1d5db",
                        background: isSel ? `${arch.color}10` : "#fff",
                        color: isSel ? arch.color : "#374151",
                        fontSize: 14, fontWeight: 700, cursor: "pointer",
                        transition: "all 0.2s",
                      }}
                    >{arch.label}</button>
                  );
                })}
              </div>
            </div>

            <button
              onClick={() => teamCell && teamArch && setStep(4)}
              style={{
                marginTop: 24, padding: "12px 32px", borderRadius: 10,
                background: (teamCell && teamArch) ? "#1a5c3a" : "#ccc",
                color: "#fff", border: "none",
                fontSize: 15, fontWeight: 700,
                cursor: (teamCell && teamArch) ? "pointer" : "not-allowed",
                transition: "all 0.3s",
              }}
            >{(teamCell && teamArch) ? "进入价值主张讨论 →" : "请先确定团队的目标市场和产品定位"}</button>
          </div>
        )}

        {/* ══════════ Step 4: 价值主张讨论 (IMPROVED) ══════════ */}
        {step === 4 && (
          <div style={{
            background: "#fff", borderRadius: 16, padding: "32px 28px",
            border: "1px solid #e5e7eb",
          }}>
            <h2 style={{ fontSize: 20, fontWeight: 800, color: "#111827", marginTop: 0 }}>
              🤖 价值主张 Coach · 集体讨论
            </h2>
            <p style={{ fontSize: 14, color: "#666", marginTop: 4, marginBottom: 8, lineHeight: 1.7 }}>
              与 AI Coach 对话，为团队选定的方向撰写和打磨价值主张（Value Proposition）。
            </p>
            <div style={{
              fontSize: 12, color: "#999", marginBottom: 20, padding: "8px 14px",
              background: "#f9fafb", borderRadius: 8, lineHeight: 1.6,
            }}>
              价值主张需要回答三个问题：<strong>给谁</strong>（WHO）、<strong>解决什么痛点</strong>（PAIN）、<strong>怎么解决</strong>（HOW）。
              Coach 会帮你们诊断价值主张的覆盖面、痛点泛化度和解法有效性，最多 3 轮迭代。
            </div>

            {/* Chat UI mockup */}
            <div style={{
              border: "1.5px solid #e5e7eb", borderRadius: 12,
              overflow: "hidden", marginBottom: 20,
            }}>
              {/* Coach opening */}
              <div style={{
                padding: "16px 18px", background: "#f9fafb",
                borderBottom: "1px solid #e5e7eb",
              }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                  <div style={{
                    width: 28, height: 28, borderRadius: "50%",
                    background: "#1a5c3a", color: "#fff",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    fontSize: 14,
                  }}>🤖</div>
                  <span style={{ fontSize: 13, fontWeight: 700, color: "#1a5c3a" }}>价值主张 Coach</span>
                  <span style={{ fontSize: 11, color: "#9ca3af" }}>第 1 轮 / 共 3 轮</span>
                </div>
                <div style={{ fontSize: 14, color: "#374151", lineHeight: 1.7 }}>
                  你们小组有两个方向在竞争：<strong>ToC 成人差异化</strong>（A、C）和 <strong>ToB 老人差异化</strong>（B、D）。
                  <br/><br/>
                  从锦囊匹配来看，ToB 老人方向有 4 张锦囊可以激活，渠道和技术都有覆盖；ToC 成人方向有体验店联盟 + 情感计算专利，差异化壁垒更高但锦囊覆盖较窄。
                  <br/><br/>
                  先告诉我你们倾向哪个方向？然后我们来打磨价值主张的三个要素：<strong>WHO / PAIN / HOW</strong>。
                </div>
              </div>

              {/* Team message */}
              <div style={{
                padding: "16px 18px", background: "#fff",
                borderBottom: "1px solid #e5e7eb",
              }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                  <div style={{
                    width: 28, height: 28, borderRadius: "50%",
                    background: "#E8634A", color: "#fff",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    fontSize: 12, fontWeight: 700,
                  }}>组</div>
                  <span style={{ fontSize: 13, fontWeight: 700, color: "#374151" }}>{teamName}</span>
                </div>
                <div style={{ fontSize: 14, color: "#374151", lineHeight: 1.7 }}>
                  我们讨论后倾向 ToB 老人差异化。WHO 是养老机构的运营负责人，PAIN 是老人白天独处时摔倒或情绪低落无人发现，HOW 是通过情感陪伴+跌倒检测的组合提供"有温度的安全守护"。
                </div>
              </div>

              {/* Coach feedback */}
              <div style={{ padding: "16px 18px", background: "#f9fafb" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
                  <div style={{
                    width: 28, height: 28, borderRadius: "50%",
                    background: "#1a5c3a", color: "#fff",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    fontSize: 14,
                  }}>🤖</div>
                  <span style={{ fontSize: 13, fontWeight: 700, color: "#1a5c3a" }}>价值主张 Coach</span>
                  <span style={{ fontSize: 11, color: "#9ca3af" }}>诊断反馈</span>
                </div>
                {/* Score display */}
                <div style={{ display: "flex", gap: 12, marginBottom: 14, flexWrap: "wrap" }}>
                  {[
                    { label: "覆盖面 (C)", desc: "WHO 的人群覆盖范围", score: 4, color: "#2FAB6E" },
                    { label: "痛点泛化度 (G)", desc: "PAIN 的普遍性", score: 3, color: "#D4A03C" },
                    { label: "解法有效性 (E)", desc: "HOW 的因果说服力", score: 3, color: "#D4A03C" },
                  ].map((item) => (
                    <div key={item.label} style={{
                      padding: "10px 16px", borderRadius: 10,
                      background: `${item.color}10`, border: `1.5px solid ${item.color}30`,
                      textAlign: "center", minWidth: 140, flex: 1,
                    }}>
                      <div style={{ fontSize: 11, fontWeight: 600, color: "#6b7280" }}>{item.label}</div>
                      <div style={{ fontSize: 28, fontWeight: 800, color: item.color, marginTop: 2 }}>
                        {item.score}<span style={{ fontSize: 14, fontWeight: 500 }}>/5</span>
                      </div>
                      <div style={{ fontSize: 10, color: "#aaa", marginTop: 2 }}>{item.desc}</div>
                    </div>
                  ))}
                </div>
                <div style={{ fontSize: 14, color: "#374151", lineHeight: 1.7 }}>
                  方向不错！<strong>瓶颈在 G（痛点泛化度）</strong>：你们说了"摔倒"和"情绪低落"，但缺少触发情境——是日常还是特定时段？建议补充 2-3 个高频场景（如：午休后、夜间独处、天气突变时情绪波动）。
                  <br/><br/>
                  E（解法有效性）也差一步：你们提到"情感陪伴+跌倒检测"，但没有解释<strong>为什么这比现有的摄像头监控或紧急呼叫器更好</strong>。加上替代对比就可以到 4 分。
                  <br/><br/>
                  <span style={{ color: "#9ca3af" }}>还有 2 轮机会，修改后重新提交。</span>
                </div>
              </div>
            </div>

            {/* Input area */}
            <div style={{ display: "flex", gap: 10 }}>
              <textarea
                placeholder="修改你们的价值主张，回复 Coach……"
                style={{
                  flex: 1, minHeight: 48, borderRadius: 10,
                  border: "1.5px solid #d1d5db", padding: "10px 14px",
                  fontSize: 14, resize: "vertical", outline: "none",
                  fontFamily: "inherit",
                }}
              />
              <button style={{
                padding: "0 20px", borderRadius: 10,
                background: "#1a5c3a", color: "#fff", border: "none",
                fontSize: 14, fontWeight: 700, cursor: "pointer",
                whiteSpace: "nowrap",
              }}>发送</button>
            </div>

            <button
              onClick={() => setStep(5)}
              style={{
                marginTop: 20, padding: "12px 32px", borderRadius: 10,
                background: "#1a5c3a", color: "#fff", border: "none",
                fontSize: 15, fontWeight: 700, cursor: "pointer",
              }}
            >确认价值主张，查看结果 →</button>
          </div>
        )}

        {/* ══════════ Step 5: 结果展示 (定性反馈，不暴露引擎) ══════════ */}
        {step === 5 && (
          <div style={{
            background: "#fff", borderRadius: 16, padding: "32px 28px",
            border: "1px solid #e5e7eb",
          }}>
            <h2 style={{ fontSize: 20, fontWeight: 800, color: "#111827", marginTop: 0 }}>
              📈 第一轮结果
            </h2>

            {/* Final position banner */}
            <div style={{
              padding: "18px 22px", borderRadius: 12, marginTop: 16, marginBottom: 24,
              background: "linear-gradient(135deg, #065f46 0%, #1a5c3a 50%, #14532d 100%)",
              color: "#fff",
            }}>
              <div style={{ fontSize: 12, opacity: 0.7, fontWeight: 600, marginBottom: 4 }}>你们的战略选择</div>
              <div style={{ fontSize: 22, fontWeight: 800 }}>企业 (ToB) · 差异化 · 老人 · 体验型</div>
              <div style={{ fontSize: 13, opacity: 0.85, marginTop: 8, lineHeight: 1.6 }}>
                价值主张：为养老机构运营者提供"有温度的安全守护"——通过情感陪伴+跌倒检测+情绪预警，解决老人日间独处时家属和机构"看不到、管不到"的焦虑。
              </div>
            </div>

            {/* ── 市场空间：定性档位 ── */}
            <div style={{
              padding: "20px", borderRadius: 12,
              border: "1.5px solid #e5e7eb", marginBottom: 16,
            }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: "#374151", marginBottom: 12 }}>
                市场空间
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 10 }}>
                {["小", "中", "大"].map((tier, i) => (
                  <div key={tier} style={{
                    flex: 1, padding: "12px", borderRadius: 10, textAlign: "center",
                    background: i === 1 ? "#1a5c3a" : "#f3f4f6",
                    color: i === 1 ? "#fff" : "#9ca3af",
                    fontWeight: 700, fontSize: 16,
                    border: i === 1 ? "none" : "1px solid #e5e7eb",
                    transition: "all 0.3s",
                  }}>
                    {tier}
                  </div>
                ))}
              </div>
              <div style={{ fontSize: 13, color: "#666", lineHeight: 1.7 }}>
                企业养老市场规模适中——机构客户数量有限，但单笔采购量较大。差异化策略下客户支付意愿较高，不过需要较长的销售周期来建立信任。
              </div>
            </div>

            {/* ── 支付意愿影响 ── */}
            <div style={{
              padding: "20px", borderRadius: 12,
              border: "1.5px solid #e5e7eb", marginBottom: 16,
              display: "flex", alignItems: "center", gap: 20, flexWrap: "wrap",
            }}>
              <div style={{ flex: "0 0 auto" }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: "#374151", marginBottom: 4 }}>
                  用户支付意愿
                </div>
                <div style={{ fontSize: 12, color: "#9ca3af" }}>
                  相对于该细分市场平均水平
                </div>
              </div>
              <div style={{
                display: "flex", alignItems: "baseline", gap: 4,
              }}>
                <span style={{ fontSize: 36, fontWeight: 800, color: "#2FAB6E" }}>+8%</span>
              </div>
              <div style={{ fontSize: 13, color: "#666", lineHeight: 1.6, flex: "1 1 300px" }}>
                你们的价值主张和锦囊能力组合，使目标用户的支付意愿略高于该细分市场的平均水平。痛点定义清晰、解法有差异化是主要加分项。
              </div>
            </div>

            {/* ── 价值主张评分 ── */}
            <div style={{
              padding: "20px", borderRadius: 12,
              border: "1.5px solid #e5e7eb", marginBottom: 16,
            }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: "#374151", marginBottom: 14 }}>
                价值主张评分
              </div>
              {[
                {
                  label: "人群覆盖面 (C)",
                  score: 4, color: "#2FAB6E",
                  feedback: "定义清晰，覆盖了主要决策者群体",
                },
                {
                  label: "痛点普遍性 (G)",
                  score: 4, color: "#3B82C4",
                  feedback: "老人独处安全问题普遍存在，触发场景明确",
                },
                {
                  label: "解法说服力 (E)",
                  score: 4, color: "#8B5CF6",
                  feedback: "情感陪伴+安全监测组合有说服力，且与替代方案有明确差异",
                },
              ].map((item) => (
                <div key={item.label} style={{ marginBottom: 16 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: "#374151" }}>{item.label}</div>
                    <div style={{
                      fontSize: 13, fontWeight: 800, color: item.color,
                      marginLeft: "auto",
                    }}>{item.score} / 5</div>
                  </div>
                  {/* Score bar */}
                  <div style={{ display: "flex", gap: 4, marginBottom: 6 }}>
                    {[1, 2, 3, 4, 5].map((n) => (
                      <div key={n} style={{
                        flex: 1, height: 8, borderRadius: 4,
                        background: n <= item.score ? item.color : "#e5e7eb",
                        transition: "all 0.3s",
                      }} />
                    ))}
                  </div>
                  <div style={{ fontSize: 12, color: "#666" }}>{item.feedback}</div>
                </div>
              ))}
            </div>

            {/* ── 锦囊匹配 ── */}
            <div style={{
              padding: "20px", borderRadius: 12,
              background: "#f0fdf4", border: "1.5px solid #bbf7d0",
              marginBottom: 16,
            }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: "#166534", marginBottom: 10 }}>
                🎯 锦囊匹配结果
              </div>
              <div style={{ fontSize: 13, color: "#15803d", lineHeight: 1.8, marginBottom: 10 }}>
                团队共 8 张锦囊中，<strong>4 张与当前定位匹配</strong>：
              </div>
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 10 }}>
                {[
                  { cid: "M01", effect: "养老社区渠道资源 → 提升了价值主张的可信度", strength: "高" },
                  { cid: "M06", effect: "政府补贴采购通道 → 提升了价值主张的可信度", strength: "高" },
                  { cid: "T04", effect: "跌倒检测传感器 → 选择相关能力卡时成本更低", strength: "高" },
                  { cid: "T07", effect: "OTA远程运维平台 → 选择相关能力卡时成本更低", strength: "中" },
                ].map((item) => {
                  const c = getCard(item.cid);
                  return c ? (
                    <div key={item.cid} style={{
                      padding: "10px 14px", borderRadius: 10,
                      background: "#fff", border: "1px solid #bbf7d0",
                      fontSize: 12, lineHeight: 1.6, flex: "1 1 280px",
                    }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
                        <span style={{ fontSize: 18 }}>{c.icon}</span>
                        <span style={{ fontWeight: 700, color: "#166534", fontSize: 13 }}>{c.title}</span>
                        <span style={{
                          marginLeft: "auto", padding: "2px 8px", borderRadius: 4,
                          background: item.strength === "高" ? "#22c55e" : "#86efac",
                          color: "#fff", fontSize: 10, fontWeight: 600,
                        }}>{item.strength}匹配</span>
                      </div>
                      <div style={{ color: "#4b5563" }}>{item.effect}</div>
                    </div>
                  ) : null;
                })}
              </div>
              <div style={{ fontSize: 12, color: "#6b7280", marginTop: 4 }}>
                所有团队成员的锦囊（包括未匹配的）都会带入第二轮计算。未匹配的锦囊在不同的产品能力选择中仍可能发挥作用。
              </div>
            </div>

            {/* ── 第一轮完成，回到课堂 ── */}
            <div style={{
              padding: "22px", borderRadius: 12,
              background: "#1e293b", color: "#fff",
            }}>
              <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 12 }}>
                🎉 第一轮决策完成
              </div>
              <div style={{ fontSize: 14, opacity: 0.9, lineHeight: 1.8, marginBottom: 16 }}>
                你们已经完成了产品战略制定。请先放下手机/电脑，<strong>回到课堂参与集体讨论</strong>。
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
              <div style={{
                fontSize: 12, opacity: 0.5, textAlign: "center",
              }}>
                第二轮将由老师统一开启
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
