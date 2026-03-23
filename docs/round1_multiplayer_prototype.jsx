import { useState, useEffect, useRef } from "react";

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
  { id: 2, label: "个人选战略", short: "选战略" },
  { id: 3, label: "战略分布图", short: "分布" },
  { id: 4, label: "VP Coach 共识", short: "VP共识" },
  { id: 5, label: "结果展示", short: "结果" },
];

const MEMBER_COLORS = [
  "#E8634A", "#3B82C4", "#2FAB6E", "#D4A03C", "#8B5CF6", "#EC4899"
];
const MEMBER_NAMES = ["成员A", "成员B", "成员C", "成员D", "成员E", "成员F"];

// Card component
function JinnangCard({ card, size = "full", selected, onSelect, flipped, onFlip }) {
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
        background: bgGrad, border: `1px solid ${accentColor}33`,
        fontSize: 12, color: "#374151", cursor: "default",
      }}>
        <span>{card.icon}</span>
        <span style={{ fontWeight: 600 }}>{card.title}</span>
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
            {isMarket ? "市场锦囊" : "技术锦囊"}
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
              <div style={{ fontSize: 11, color: "#6b7280", marginTop: 2 }}>
                {card.subtitle}
              </div>
            </div>
          </div>
          <div style={{
            fontSize: size === "compact" ? 12 : 13, color: "#374151",
            lineHeight: 1.65, flex: 1,
          }}>
            {card.desc}
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 10 }}>
            {card.tags.map((tag) => (
              <span key={tag} style={{
                fontSize: 10, padding: "2px 8px", borderRadius: 10,
                background: `${accentColor}15`, color: accentColor,
                fontWeight: 600,
              }}>{tag}</span>
            ))}
          </div>
          <div style={{
            position: "absolute", top: 10, right: 10,
            fontSize: 9, fontWeight: 700, color: accentColor, opacity: 0.5,
          }}>{card.id}</div>
          {card.round && (
            <div style={{
              position: "absolute", bottom: 10, right: 12,
              fontSize: 9, color: "#9ca3af", fontWeight: 600,
            }}>适用: {card.round}</div>
          )}
        </>
      )}
    </div>
  );
}

// Step indicator
function StepBar({ current, onStep }) {
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 0,
      margin: "0 auto 28px", maxWidth: 680,
    }}>
      {FLOW_STEPS.map((s, i) => (
        <div key={s.id} style={{ display: "flex", alignItems: "center", flex: i < FLOW_STEPS.length - 1 ? 1 : "none" }}>
          <div
            onClick={() => onStep(s.id)}
            style={{
              width: 36, height: 36, borderRadius: "50%",
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: 13, fontWeight: 700, cursor: "pointer",
              background: i <= current ? "#1a5c3a" : "#e5e7eb",
              color: i <= current ? "#fff" : "#9ca3af",
              transition: "all 0.3s",
              boxShadow: i === current ? "0 0 0 3px #1a5c3a33" : "none",
            }}
          >{i + 1}</div>
          {i < FLOW_STEPS.length - 1 && (
            <div style={{
              flex: 1, height: 2, margin: "0 4px",
              background: i < current ? "#1a5c3a" : "#e5e7eb",
              transition: "all 0.3s",
            }} />
          )}
        </div>
      ))}
      <div style={{ marginLeft: 16, fontSize: 13, color: "#6b7280", fontWeight: 500, minWidth: 120 }}>
        {FLOW_STEPS[current]?.label}
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
                  }}>{c === "ToC" ? "消费者" : "企业"}</td>
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
                            width: 28, height: 28, borderRadius: "50%",
                            background: MEMBER_COLORS[m.memberIdx],
                            color: "#fff", fontSize: 11, fontWeight: 700,
                            display: "flex", alignItems: "center", justifyContent: "center",
                          }}>
                            {String.fromCharCode(65 + m.memberIdx)}
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

// ── Main App ──────────────────────────────────────────
export default function App() {
  const [step, setStep] = useState(0);
  const [teamSize, setTeamSize] = useState(4);
  const [teamName, setTeamName] = useState("第1组");
  const [revealedCards, setRevealedCards] = useState({});
  const [selectedCell, setSelectedCell] = useState(null);
  const [tab, setTab] = useState("flow"); // "flow" | "cards"

  // simulated member selections for step 3
  const demoSelections = [
    { memberIdx: 0, cell: "ToC_DIFF_ADULT" },
    { memberIdx: 1, cell: "ToC_DIFF_ELDER" },
    { memberIdx: 2, cell: "ToC_DIFF_ADULT" },
    { memberIdx: 3, cell: "ToB_DIFF_ELDER" },
  ];

  // demo card assignments (2 per member)
  const demoAssignments = [
    { memberIdx: 0, cards: ["M05", "T02"] },
    { memberIdx: 1, cards: ["M01", "T04"] },
    { memberIdx: 2, cards: ["M08", "T01"] },
    { memberIdx: 3, cards: ["M06", "T07"] },
  ];

  const flipCard = (id) => {
    setRevealedCards((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const getCard = (id) => ALL_CARDS.find((c) => c.id === id);

  // ── Render by Tab ──
  if (tab === "cards") {
    return (
      <div style={{
        fontFamily: "'Noto Sans SC', 'SF Pro Display', -apple-system, sans-serif",
        background: "#fafaf8", minHeight: "100vh", padding: "32px 24px",
      }}>
        <div style={{ maxWidth: 1200, margin: "0 auto" }}>
          {/* Tab switcher */}
          <div style={{ display: "flex", gap: 8, marginBottom: 32 }}>
            <button onClick={() => setTab("flow")} style={{
              padding: "8px 20px", borderRadius: 8, border: "1.5px solid #d1d5db",
              background: "#fff", color: "#374151", fontSize: 14, fontWeight: 600, cursor: "pointer",
            }}>← UI 流程原型</button>
            <button style={{
              padding: "8px 20px", borderRadius: 8, border: "none",
              background: "#1a5c3a", color: "#fff", fontSize: 14, fontWeight: 600,
            }}>锦囊卡全览</button>
          </div>

          {/* Market Cards */}
          <div style={{ marginBottom: 48 }}>
            <div style={{
              display: "flex", alignItems: "center", gap: 12, marginBottom: 20,
            }}>
              <div style={{
                width: 6, height: 28, borderRadius: 3, background: "#2FAB6E",
              }} />
              <h2 style={{ margin: 0, fontSize: 22, fontWeight: 800, color: "#111827" }}>
                市场 / 企业资源锦囊
              </h2>
              <span style={{
                fontSize: 12, padding: "3px 10px", borderRadius: 12,
                background: "#ecfdf5", color: "#2FAB6E", fontWeight: 600,
              }}>10张 · 偏 Round 1</span>
            </div>
            <div style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))",
              gap: 16,
            }}>
              {MARKET_CARDS.map((card) => (
                <JinnangCard key={card.id} card={card} size="full" />
              ))}
            </div>
          </div>

          {/* Tech Cards */}
          <div>
            <div style={{
              display: "flex", alignItems: "center", gap: 12, marginBottom: 20,
            }}>
              <div style={{
                width: 6, height: 28, borderRadius: 3, background: "#3B82C4",
              }} />
              <h2 style={{ margin: 0, fontSize: 22, fontWeight: 800, color: "#111827" }}>
                技术资源锦囊
              </h2>
              <span style={{
                fontSize: 12, padding: "3px 10px", borderRadius: 12,
                background: "#eff6ff", color: "#3B82C4", fontWeight: 600,
              }}>10张 · 偏 Round 2</span>
            </div>
            <div style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))",
              gap: 16,
            }}>
              {TECH_CARDS.map((card) => (
                <JinnangCard key={card.id} card={card} size="full" />
              ))}
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ── Flow Tab (main) ──
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
            Round 1 · 多人模式流程原型
          </h1>
          <button onClick={() => setTab("cards")} style={{
            padding: "7px 16px", borderRadius: 8, border: "1.5px solid #1a5c3a",
            background: "transparent", color: "#1a5c3a", fontSize: 13,
            fontWeight: 600, cursor: "pointer",
          }}>查看全部锦囊卡 →</button>
        </div>
        <p style={{ fontSize: 13, color: "#6b7280", marginTop: 4, marginBottom: 24 }}>
          展示 6 个步骤的界面交互，点击步骤条切换
        </p>

        <StepBar current={step} onStep={setStep} />

        {/* ── Step 0: 建组 ── */}
        {step === 0 && (
          <div style={{
            background: "#fff", borderRadius: 16, padding: "32px 28px",
            border: "1px solid #e5e7eb",
          }}>
            <h2 style={{ fontSize: 20, fontWeight: 800, color: "#111827", marginTop: 0 }}>
              🏠 建立小组
            </h2>
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
                  {[2, 3, 4, 5, 6].map((n) => (
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
              onClick={() => setStep(1)}
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
              🎴 你的个人锦囊
            </h2>
            <p style={{ fontSize: 13, color: "#6b7280", marginTop: 4, marginBottom: 20 }}>
              每位成员获得 2 张锦囊（1 市场 + 1 技术），点击卡片翻开查看。<br/>
              锦囊内容只有你自己能看到，是否分享由你决定。
            </p>

            <div style={{
              background: "#fefce8", borderRadius: 10, padding: "12px 16px",
              marginBottom: 24, fontSize: 13, color: "#854d0e",
              border: "1px solid #fde68a",
            }}>
              💡 提示：你的锦囊暗示了某些战略方向的优势。在后续小组讨论中，你可以选择公开或隐藏锦囊信息来影响集体决策。
            </div>

            {/* Simulating member A's view */}
            <div style={{ fontSize: 12, color: "#9ca3af", marginBottom: 12, fontWeight: 600 }}>
              当前视角：成员A 的锦囊
            </div>
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

            <button
              onClick={() => setStep(2)}
              style={{
                marginTop: 28, padding: "12px 32px", borderRadius: 10,
                background: "#1a5c3a", color: "#fff", border: "none",
                fontSize: 15, fontWeight: 700, cursor: "pointer",
                opacity: Object.keys(revealedCards).length >= 2 ? 1 : 0.4,
              }}
            >我看好了，去选战略 →</button>
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
            <p style={{ fontSize: 13, color: "#6b7280", marginTop: 4, marginBottom: 8 }}>
              在 12 格中点击你认为最合适的定位。结合你的锦囊资源思考——哪个格子能最大化你的优势？
            </p>

            {/* Show mini cards for reference */}
            <div style={{
              display: "flex", gap: 8, marginBottom: 20, alignItems: "center",
            }}>
              <span style={{ fontSize: 12, color: "#9ca3af", fontWeight: 600 }}>你的锦囊：</span>
              <JinnangCard card={getCard("M05")} size="mini" />
              <JinnangCard card={getCard("T02")} size="mini" />
            </div>

            <StrategyGrid
              selections={selectedCell ? [{ memberIdx: 0, cell: selectedCell }] : []}
              highlightCell={selectedCell}
              onCellClick={(cell) => setSelectedCell(cell)}
            />

            <div style={{ marginTop: 16 }}>
              <label style={{ fontSize: 13, fontWeight: 600, color: "#374151", display: "block", marginBottom: 6 }}>
                一句话 VP 大纲（选填）
              </label>
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

            <button
              onClick={() => setStep(3)}
              style={{
                marginTop: 20, padding: "12px 32px", borderRadius: 10,
                background: "#1a5c3a", color: "#fff", border: "none",
                fontSize: 15, fontWeight: 700, cursor: "pointer",
                opacity: selectedCell ? 1 : 0.4,
              }}
            >提交我的选择 →</button>
          </div>
        )}

        {/* ── Step 3: 战略分布图 ── */}
        {step === 3 && (
          <div style={{
            background: "#fff", borderRadius: 16, padding: "32px 28px",
            border: "1px solid #e5e7eb",
          }}>
            <h2 style={{ fontSize: 20, fontWeight: 800, color: "#111827", marginTop: 0 }}>
              📊 小组战略分布
            </h2>
            <p style={{ fontSize: 13, color: "#6b7280", marginTop: 4, marginBottom: 20 }}>
              所有成员的选择已揭晓。观察你们的分歧和共识——接下来需要在 VP Coach 中收敛为一个方向。
            </p>

            <StrategyGrid selections={demoSelections} />

            {/* Member legend */}
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
                            return c ? (
                              <span key={cid} style={{
                                fontSize: 10, padding: "1px 6px", borderRadius: 6,
                                background: cid.startsWith("M") ? "#ecfdf5" : "#eff6ff",
                                color: cid.startsWith("M") ? "#2FAB6E" : "#3B82C4",
                                fontWeight: 600,
                              }}>{c.icon} {c.title}</span>
                            ) : null;
                          })}
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
                3/4 的成员选择了<strong>差异化</strong>策略，2 人集中在 <strong>ToC · 成人</strong>格。
                成员B 和 D 都偏向<strong>老人</strong>市场，且分别持有银发社区和政府补贴锦囊——如果选老人方向，这两张锦囊可以同时激活。
                <br/>需要讨论的核心分歧：<strong>ToC 成人 vs ToB 老人</strong>。
              </div>
            </div>

            <button
              onClick={() => setStep(4)}
              style={{
                marginTop: 24, padding: "12px 32px", borderRadius: 10,
                background: "#1a5c3a", color: "#fff", border: "none",
                fontSize: 15, fontWeight: 700, cursor: "pointer",
              }}
            >进入 VP Coach 讨论 →</button>
          </div>
        )}

        {/* ── Step 4: VP Coach ── */}
        {step === 4 && (
          <div style={{
            background: "#fff", borderRadius: 16, padding: "32px 28px",
            border: "1px solid #e5e7eb",
          }}>
            <h2 style={{ fontSize: 20, fontWeight: 800, color: "#111827", marginTop: 0 }}>
              🤖 VP Coach · 集体共识
            </h2>
            <p style={{ fontSize: 13, color: "#6b7280", marginTop: 4, marginBottom: 20 }}>
              与 AI Coach 对话，将小组分散的想法收敛为一个 Value Proposition。最多 3 轮迭代。
            </p>

            {/* Chat UI mockup */}
            <div style={{
              border: "1.5px solid #e5e7eb", borderRadius: 12,
              overflow: "hidden", marginBottom: 20,
            }}>
              {/* Coach message */}
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
                  <span style={{ fontSize: 13, fontWeight: 700, color: "#1a5c3a" }}>VP Coach</span>
                  <span style={{ fontSize: 11, color: "#9ca3af" }}>Round 1 / 3</span>
                </div>
                <div style={{ fontSize: 14, color: "#374151", lineHeight: 1.7 }}>
                  你们小组有两个主要方向在竞争：<strong>ToC 成人差异化</strong>（成员 A、C 倾向）和 <strong>ToB 老人差异化</strong>（成员 B、D 倾向）。
                  <br/><br/>
                  我先帮你们看一下现状：如果选 ToB 老人，你们有两张锦囊可以激活（银发社区渠道 + 政府补贴通道），渠道成本优势明显；如果选 ToC 成人，体验店联盟 + 情感计算专利可以激活，差异化壁垒更高。
                  <br/><br/>
                  <strong>你们的 VP 需要回答三个问题</strong>：给谁（WHO）、解决什么痛点（PAIN）、怎么解决（HOW）。先告诉我你们倾向哪个方向？
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

              {/* Coach scoring feedback */}
              <div style={{
                padding: "16px 18px", background: "#f9fafb",
              }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
                  <div style={{
                    width: 28, height: 28, borderRadius: "50%",
                    background: "#1a5c3a", color: "#fff",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    fontSize: 14,
                  }}>🤖</div>
                  <span style={{ fontSize: 13, fontWeight: 700, color: "#1a5c3a" }}>VP Coach</span>
                  <span style={{ fontSize: 11, color: "#9ca3af" }}>评分反馈</span>
                </div>
                {/* Score display */}
                <div style={{
                  display: "flex", gap: 12, marginBottom: 14, flexWrap: "wrap",
                }}>
                  {[
                    { label: "Coverage (C)", score: 4, color: "#2FAB6E" },
                    { label: "Generalizability (G)", score: 3, color: "#D4A03C" },
                    { label: "Effectiveness (E)", score: 3, color: "#D4A03C" },
                  ].map((item) => (
                    <div key={item.label} style={{
                      padding: "10px 16px", borderRadius: 10,
                      background: `${item.color}10`, border: `1.5px solid ${item.color}30`,
                      textAlign: "center", minWidth: 140,
                    }}>
                      <div style={{ fontSize: 11, fontWeight: 600, color: "#6b7280" }}>{item.label}</div>
                      <div style={{ fontSize: 28, fontWeight: 800, color: item.color, marginTop: 2 }}>
                        {item.score}<span style={{ fontSize: 14, fontWeight: 500 }}>/5</span>
                      </div>
                    </div>
                  ))}
                </div>
                <div style={{ fontSize: 14, color: "#374151", lineHeight: 1.7 }}>
                  方向不错！<strong>瓶颈在 G（痛点泛化度）</strong>：你们说了"摔倒"和"情绪低落"，但缺少触发情境——是日常还是特定时段？建议补充 2-3 个高频场景（如：午休后、夜间独处、天气突变时情绪波动）。
                  <br/><br/>
                  E（解法有效性）也差一步：你们提到"情感陪伴+跌倒检测"，但没有解释<strong>为什么这比现有的摄像头监控或紧急呼叫器更好</strong>。加上替代对比就可以到 4 分。
                  <br/><br/>
                  <strong>还有 2 轮机会</strong>，修改后重新提交。
                </div>
              </div>
            </div>

            {/* Input area */}
            <div style={{ display: "flex", gap: 10 }}>
              <textarea
                placeholder="修改你们的 VP，回复 Coach……"
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
            >确认 VP，查看结果 →</button>
          </div>
        )}

        {/* ── Step 5: 结果展示 ── */}
        {step === 5 && (
          <div style={{
            background: "#fff", borderRadius: 16, padding: "32px 28px",
            border: "1px solid #e5e7eb",
          }}>
            <h2 style={{ fontSize: 20, fontWeight: 800, color: "#111827", marginTop: 0 }}>
              📈 Round 1 结果
            </h2>

            {/* Final position banner */}
            <div style={{
              padding: "18px 22px", borderRadius: 12, marginTop: 16, marginBottom: 24,
              background: "linear-gradient(135deg, #065f46 0%, #1a5c3a 50%, #14532d 100%)",
              color: "#fff",
            }}>
              <div style={{ fontSize: 12, opacity: 0.7, fontWeight: 600, marginBottom: 4 }}>最终定位</div>
              <div style={{ fontSize: 22, fontWeight: 800 }}>ToB · 差异化 · 老人</div>
              <div style={{ fontSize: 13, opacity: 0.85, marginTop: 8, lineHeight: 1.6 }}>
                VP：为养老机构运营者提供"有温度的安全守护"——通过情感陪伴+跌倒检测+情绪预警，解决老人日间独处时家属和机构"看不到、管不到"的焦虑。
              </div>
            </div>

            {/* KPI cards */}
            <div style={{
              display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
              gap: 14, marginBottom: 24,
            }}>
              {[
                { label: "GM_max", value: "58.2%", sub: "最大可行毛利率", color: "#2FAB6E" },
                { label: "市场容量份额", value: "12.6%", sub: "Svol（C×G×φ(E)）", color: "#3B82C4" },
                { label: "WTP 份额", value: "18.3%", sub: "Swtp（C×G×ψ(E)）", color: "#8B5CF6" },
                { label: "渠道费率", value: "11.4%", sub: "直销60% + 分销40%", color: "#D4A03C" },
              ].map((kpi) => (
                <div key={kpi.label} style={{
                  padding: "18px 16px", borderRadius: 12,
                  border: `1.5px solid ${kpi.color}25`,
                  background: `${kpi.color}08`,
                }}>
                  <div style={{ fontSize: 11, fontWeight: 600, color: "#6b7280" }}>{kpi.label}</div>
                  <div style={{ fontSize: 28, fontWeight: 800, color: kpi.color, margin: "4px 0 2px" }}>
                    {kpi.value}
                  </div>
                  <div style={{ fontSize: 11, color: "#9ca3af" }}>{kpi.sub}</div>
                </div>
              ))}
            </div>

            {/* Jinnang match result */}
            <div style={{
              padding: "18px 20px", borderRadius: 12,
              background: "#f0fdf4", border: "1.5px solid #bbf7d0",
              marginBottom: 20,
            }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: "#166534", marginBottom: 10 }}>
                ✅ 锦囊激活（3/8 张命中）
              </div>
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 10 }}>
                {["M01", "M06", "T04"].map((cid) => {
                  const c = getCard(cid);
                  return c ? <JinnangCard key={cid} card={c} size="mini" /> : null;
                })}
              </div>
              <div style={{ fontSize: 13, color: "#15803d", lineHeight: 1.6 }}>
                <strong>银发社区合伙人</strong>：直销渠道费率获得优惠 → 渠道费从 14.2% 降至 11.4%<br/>
                <strong>政府养老补贴通道</strong>：ToB老人格的 WTP 上浮 → Pmax 提升<br/>
                <strong>跌倒检测传感器套件</strong>：Round 2 选择该能力卡时 BOM 降低（留待 R2 生效）
              </div>
            </div>

            {/* VP score recap */}
            <div style={{
              padding: "18px 20px", borderRadius: 12,
              background: "#f9fafb", border: "1px solid #e5e7eb",
              marginBottom: 20,
            }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: "#374151", marginBottom: 12 }}>
                VP 评分（最终）
              </div>
              <div style={{ display: "flex", gap: 20, flexWrap: "wrap" }}>
                {[
                  { label: "Coverage", score: 4 },
                  { label: "Generalizability", score: 4 },
                  { label: "Effectiveness", score: 4 },
                ].map((item) => (
                  <div key={item.label} style={{ textAlign: "center" }}>
                    <div style={{ fontSize: 11, color: "#6b7280", fontWeight: 600 }}>{item.label}</div>
                    <div style={{ display: "flex", gap: 3, marginTop: 4 }}>
                      {[1, 2, 3, 4, 5].map((n) => (
                        <div key={n} style={{
                          width: 20, height: 20, borderRadius: 4,
                          background: n <= item.score ? "#1a5c3a" : "#e5e7eb",
                        }} />
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Next round CTA */}
            <div style={{
              padding: "16px 20px", borderRadius: 12,
              background: "#1e293b", color: "#fff", textAlign: "center",
            }}>
              <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 4 }}>
                Round 1 完成 · target_gm 已冻结为 55.3%
              </div>
              <div style={{ fontSize: 12, opacity: 0.7, marginBottom: 12 }}>
                进入 Round 2 后将基于此定位进行访谈和 R&D 选卡
              </div>
              <button style={{
                padding: "10px 28px", borderRadius: 8,
                background: "#fff", color: "#1e293b", border: "none",
                fontSize: 14, fontWeight: 700, cursor: "pointer",
              }}>进入 Round 2 →</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
