import { useEffect, useMemo, useRef, useState } from "react";
import * as d3 from "d3";

const PANEL_STYLE = {
  background: "#fff",
  border: "1px solid #e2e8f0",
  borderRadius: 18,
  padding: 18,
  boxShadow: "0 1px 2px rgba(15, 23, 42, 0.04)"
};

const SVG_HEIGHT = 660;
const GRAPH_PADDING = {
  top: 56,
  right: 88,
  bottom: 132,
  left: 88
};

const DIM_COLORS = {
  interaction_expression: { color: "#8B5CF6", label: "交互与表达" },
  perception_understanding: { color: "#3B82F6", label: "感知与理解" },
  mobility_navigation: { color: "#10B981", label: "运动与导航" },
  safety_trust: { color: "#EF4444", label: "安全与信任" },
  expand_connect: { color: "#06B6D4", label: "可扩展与连接" },
  ops_maintenance: { color: "#F97316", label: "可运营与可维护" }
};

const CARDS = [
  { id: "voice_basic", name: "语音基础", dim: "interaction_expression", covers: ["语音交互", "情感陪伴"] },
  { id: "persona_dialog", name: "多轮对话", dim: "interaction_expression", covers: ["情感陪伴", "语音交互", "个性化推荐", "多轮对话"] },
  { id: "touch_hug", name: "触摸拥抱", dim: "interaction_expression", covers: ["情感陪伴"] },
  { id: "music_companion", name: "音乐陪伴", dim: "interaction_expression", covers: ["音乐播放", "情感陪伴"] },
  { id: "visual_expression", name: "视觉表达", dim: "interaction_expression", covers: ["情感陪伴", "表情显示"] },
  { id: "expressive_style_pack", name: "表达风格包", dim: "interaction_expression", covers: ["情感陪伴", "多轮对话"] },
  { id: "no_screen_costdown", name: "无屏降本", dim: "interaction_expression", covers: [] },
  { id: "perception_base", name: "基础感知", dim: "perception_understanding", covers: ["拍照功能", "场景感知"] },
  { id: "emotion_recognition", name: "情绪识别", dim: "perception_understanding", covers: ["情绪识别", "情感陪伴", "拍照功能"] },
  { id: "adaptive_learning", name: "自适应学习", dim: "perception_understanding", covers: ["个性化推荐", "情感陪伴", "记忆回溯"] },
  { id: "memory_album", name: "社交记忆", dim: "perception_understanding", covers: ["拍照功能", "情感陪伴", "记忆回溯"] },
  { id: "basic_avoidance", name: "基础避障", dim: "mobility_navigation", covers: ["碰撞保护", "自主移动"] },
  { id: "follow_mode", name: "跟随伴行", dim: "mobility_navigation", covers: ["跟随陪伴", "自主移动"] },
  { id: "lidar_nav", name: "LiDAR导航", dim: "mobility_navigation", covers: ["室内导航", "自主移动"] },
  { id: "privacy_trust", name: "隐私信任", dim: "safety_trust", covers: ["安全与信任", "隐私保护"] },
  { id: "child_safety", name: "儿童安全", dim: "safety_trust", covers: ["儿童安全"] },
  { id: "family_guardian", name: "家庭监护", dim: "safety_trust", covers: ["隐私保护", "儿童安全", "远程控制"] },
  { id: "cloud_update", name: "云端更新", dim: "expand_connect", covers: ["OTA更新"] },
  { id: "api_iot", name: "IoT联动", dim: "expand_connect", covers: ["智能家居", "家庭版"] },
  { id: "edu_content", name: "教育内容", dim: "expand_connect", covers: ["教育内容", "家庭版"] },
  { id: "self_diag", name: "自诊断", dim: "ops_maintenance", covers: ["OTA更新"] },
  { id: "remote_monitor", name: "远程监控", dim: "ops_maintenance", covers: ["OTA更新", "远程控制"] },
  { id: "predictive_maint", name: "预测维护", dim: "ops_maintenance", covers: ["OTA更新"] }
];

const HARD_RULES = [
  { from: "persona_dialog", to: "cloud_update", type: "requires" },
  { from: "adaptive_learning", to: "cloud_update", type: "requires" },
  { from: "emotion_recognition", to: "perception_base", type: "requires" },
  { from: "emotion_recognition", to: "privacy_trust", type: "requires" },
  { from: "family_guardian", to: "privacy_trust", type: "requires" },
  { from: "no_screen_costdown", to: "visual_expression", type: "excludes" }
];

const BOTTLENECK = {
  persona_dialog: { tier: 1, short: "端云困境", detail: "LLM on-device vs cloud：延迟/成本/隐私三选二" },
  emotion_recognition: { tier: 1, short: "感知鸿沟", detail: "实验室→部署的泛化断崖：光线、角度、跨人群" },
  adaptive_learning: { tier: 1, short: "学习悖论", detail: "端上持续学习 + 不遗忘 + 隐私合规，三约束无解" },
  lidar_nav: { tier: 2, short: "成本墙", detail: "技术成熟但 BOM +$50-150，消费级难消化" },
  privacy_trust: { tier: 2, short: "合规税", detail: "PIPL/儿童数据/生物特征——持续性成本，非一次性" }
};

const BN_STYLE = {
  1: { ring: "#FF6B35", label: "Structural", labelBg: "#FFF0E6", labelColor: "#C2410C" },
  2: { ring: "#D97706", label: "Access", labelBg: "#FFF8E7", labelColor: "#92400E" }
};

const CARD_BY_ID = new Map(CARDS.map((card) => [card.id, card]));
const CARD_ID_LOOKUP = CARDS.reduce((acc, card) => {
  acc[normalizeLookup(card.id)] = card.id;
  acc[normalizeLookup(card.name)] = card.id;
  return acc;
}, {});

function normalizeLookup(value) {
  return String(value || "")
    .trim()
    .replace(/[·•]/g, "")
    .replace(/\s+/g, "")
    .toLowerCase();
}

function buildCoverEdges() {
  const edges = [];
  for (let index = 0; index < CARDS.length; index += 1) {
    for (let next = index + 1; next < CARDS.length; next += 1) {
      const shared = CARDS[index].covers.filter((item) => CARDS[next].covers.includes(item));
      if (shared.length >= 1) {
        edges.push({
          source: CARDS[index].id,
          target: CARDS[next].id,
          type: "covers",
          weight: shared.length,
          shared
        });
      }
    }
  }
  return edges;
}

const COVER_EDGES = buildCoverEdges();
const ALL_EDGES = [
  ...COVER_EDGES,
  ...HARD_RULES.map((rule) => ({ source: rule.from, target: rule.to, type: rule.type, weight: 2 }))
];

function buildDimAnchors(width, height) {
  const dims = Object.keys(DIM_COLORS);
  const innerWidth = Math.max(220, width - GRAPH_PADDING.left - GRAPH_PADDING.right);
  const innerHeight = Math.max(220, height - GRAPH_PADDING.top - GRAPH_PADDING.bottom);
  const radius = Math.max(110, Math.min(innerWidth, innerHeight) * 0.32);
  const centerX = GRAPH_PADDING.left + innerWidth / 2;
  const centerY = GRAPH_PADDING.top + innerHeight / 2;
  const anchors = {};
  dims.forEach((dim, index) => {
    const angle = (index / dims.length) * Math.PI * 2 - Math.PI / 2;
    anchors[dim] = {
      x: centerX + radius * Math.cos(angle),
      y: centerY + radius * Math.sin(angle)
    };
  });
  return anchors;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function resolveCardId(raw) {
  if (!raw) return "";
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    const direct = CARD_ID_LOOKUP[normalizeLookup(trimmed)];
    if (direct) return direct;
    const base = trimmed.split("·")[0]?.split("|")[0]?.split("@")[0]?.trim();
    return CARD_ID_LOOKUP[normalizeLookup(base)] || "";
  }

  const candidates = [
    raw.cap_id,
    raw.id,
    raw.card_id,
    raw.name,
    raw.label
  ];
  for (const candidate of candidates) {
    const resolved = resolveCardId(candidate);
    if (resolved) return resolved;
  }
  return "";
}

function analyzeFrequency(teams) {
  const freq = {};
  let hasNamedCards = false;
  let hasCardCountOnly = false;

  (Array.isArray(teams) ? teams : []).forEach((team) => {
    const cards = Array.isArray(team?.r2?.cards) ? team.r2.cards : [];
    let resolvedCount = 0;

    cards.forEach((card) => {
      const id = resolveCardId(card);
      if (!id) return;
      freq[id] = (freq[id] || 0) + 1;
      resolvedCount += 1;
      hasNamedCards = true;
    });

    if (Number(team?.r2?.cardCount) > 0 && resolvedCount === 0) {
      hasCardCountOnly = true;
    }
  });

  return { freq, hasNamedCards, hasCardCountOnly };
}

function useContainerWidth(ref) {
  const [width, setWidth] = useState(960);

  useEffect(() => {
    const element = ref.current;
    if (!element) return undefined;

    const update = () => {
      const nextWidth = Math.max(320, Math.round(element.getBoundingClientRect().width || 0));
      if (nextWidth) {
        setWidth(nextWidth);
      }
    };

    update();

    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", update);
      return () => window.removeEventListener("resize", update);
    }

    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref]);

  return width;
}

function getBottleneckSelectionCounts(freq) {
  return Object.entries(BOTTLENECK).reduce((acc, [id, meta]) => {
    if (meta.tier === 1) {
      acc.structural += Number(freq[id] || 0);
    } else if (meta.tier === 2) {
      acc.access += Number(freq[id] || 0);
    }
    return acc;
  }, { structural: 0, access: 0 });
}

function renderPulseRing(node, color, delay = "0s") {
  return (
    <circle
      key={`${node.id}-pulse-${delay}`}
      cx={node.x}
      cy={node.y}
      r={node.radius + 4}
      fill="none"
      stroke={color}
      strokeWidth={2}
      style={{
        opacity: 0,
        transformOrigin: "center",
        transformBox: "fill-box",
        animation: "card-bn-pulse 2s ease-out infinite",
        animationDelay: delay
      }}
    />
  );
}

export default function CardEcosystemTab({ teams }) {
  const containerRef = useRef(null);
  const graphWidth = useContainerWidth(containerRef);
  const [graphNodes, setGraphNodes] = useState([]);
  const [graphLinks, setGraphLinks] = useState([]);
  const [hoveredId, setHoveredId] = useState("");

  const frequencySummary = useMemo(() => analyzeFrequency(teams), [teams]);
  const frequency = frequencySummary.freq;
  const maxFreq = useMemo(
    () => Math.max(0, ...CARDS.map((card) => Number(frequency[card.id] || 0))),
    [frequency]
  );
  const selectionCounts = useMemo(
    () => getBottleneckSelectionCounts(frequency),
    [frequency]
  );

  const sortedCards = useMemo(() => {
    return CARDS.slice().sort((left, right) => {
      const diff = Number(frequency[right.id] || 0) - Number(frequency[left.id] || 0);
      return diff || left.name.localeCompare(right.name, "zh-Hans-CN");
    });
  }, [frequency]);

  const hoveredCard = hoveredId ? CARD_BY_ID.get(hoveredId) : null;
  const hoveredBottleneck = hoveredId ? BOTTLENECK[hoveredId] : null;
  const connectedIds = useMemo(() => {
    if (!hoveredId) return new Set();
    const ids = new Set([hoveredId]);
    ALL_EDGES.forEach((edge) => {
      const source = typeof edge.source === "object" ? edge.source.id : edge.source;
      const target = typeof edge.target === "object" ? edge.target.id : edge.target;
      if (source === hoveredId) ids.add(target);
      if (target === hoveredId) ids.add(source);
    });
    return ids;
  }, [hoveredId]);

  useEffect(() => {
    const width = Math.max(320, graphWidth);
    const anchors = buildDimAnchors(width, SVG_HEIGHT);
    const cardOrderInDim = {};
    const cardCountInDim = {};

    CARDS.forEach((card) => {
      cardCountInDim[card.dim] = (cardCountInDim[card.dim] || 0) + 1;
    });

    const nodeData = CARDS.map((card) => {
      const position = cardOrderInDim[card.dim] || 0;
      cardOrderInDim[card.dim] = position + 1;
      const totalInDim = cardCountInDim[card.dim] || 1;
      const angle = totalInDim === 1 ? 0 : (position / totalInDim) * Math.PI * 2;
      const radius = 14 + Number(frequency[card.id] || 0) * 3.5;
      return {
        ...card,
        freq: Number(frequency[card.id] || 0),
        bn: BOTTLENECK[card.id] || null,
        radius,
        x: anchors[card.dim].x + Math.cos(angle) * 28,
        y: anchors[card.dim].y + Math.sin(angle) * 28
      };
    });

    const linkData = ALL_EDGES.map((edge) => ({ ...edge }));
    const simulation = d3.forceSimulation(nodeData)
      .force("charge", d3.forceManyBody().strength(-150))
      .force("center", d3.forceCenter(width / 2, SVG_HEIGHT / 2))
      .force("link", d3.forceLink(linkData).id((node) => node.id).distance((edge) => edge.type === "covers" ? 86 : 96).strength((edge) => edge.type === "covers" ? 0.08 : 0.24))
      .force("x", d3.forceX((node) => anchors[node.dim].x).strength(0.16))
      .force("y", d3.forceY((node) => anchors[node.dim].y).strength(0.16))
      .force("collide", d3.forceCollide((node) => node.radius + 10))
      .alpha(1)
      .alphaDecay(0.04)
      .on("tick", () => {
        nodeData.forEach((node) => {
          const topPadding = node.radius + 22;
          const sidePadding = node.radius + 34;
          const bottomPadding = node.radius + (node.bn ? 72 : 52);
          node.x = clamp(node.x, sidePadding, width - sidePadding);
          node.y = clamp(node.y, topPadding, SVG_HEIGHT - bottomPadding);
        });
        setGraphNodes(nodeData.map((node) => ({ ...node })));
        setGraphLinks(linkData.map((edge) => ({ ...edge })));
      });

    return () => simulation.stop();
  }, [frequency, graphWidth]);

  const hasTeams = Array.isArray(teams) && teams.length > 0;
  const hasAnyFrequency = maxFreq > 0;
  const showNoData = !hasTeams || (!hasAnyFrequency && !frequencySummary.hasCardCountOnly);
  const showInsufficient = !hasAnyFrequency && frequencySummary.hasCardCountOnly;
  const summaryCards = hoveredCard
    ? HARD_RULES.filter((rule) => rule.from === hoveredCard.id || rule.to === hoveredCard.id)
    : [];

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <style>{`
        @keyframes card-bn-pulse {
          0% { transform: scale(1); opacity: 0.55; }
          100% { transform: scale(1.34); opacity: 0; }
        }
      `}</style>

      <div style={{ ...PANEL_STYLE, padding: 20 }} ref={containerRef}>
        <div style={{ display: "grid", gap: 8, marginBottom: 14 }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
            <div>
              <div style={{ fontSize: 18, fontWeight: 900, color: "#0f172a" }}>能力卡生态图</div>
              <div style={{ fontSize: 12, color: "#64748b", marginTop: 4 }}>
                23 张卡 · 6 个维度 · 节点大小 = 实际选卡频次 · Hover 可查看关系与瓶颈说明
              </div>
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <div style={{ padding: "8px 10px", borderRadius: 10, background: "#f8fafc", border: "1px solid #e2e8f0", fontSize: 12, color: "#334155" }}>
                已聚合 {Array.isArray(teams) ? teams.length : 0} 组 Round 2 提交
              </div>
              <div style={{ padding: "8px 10px", borderRadius: 10, background: "#fff7ed", border: "1px solid #fed7aa", fontSize: 12, color: "#9a3412" }}>
                Structural 频次 {selectionCounts.structural} · Access 频次 {selectionCounts.access}
              </div>
            </div>
          </div>

          {showInsufficient && (
            <div style={{ padding: "10px 12px", borderRadius: 12, background: "#fff7ed", border: "1px solid #fed7aa", fontSize: 12, color: "#9a3412", lineHeight: 1.6 }}>
              数据不足：当前部分团队只记录了 `cardCount`，没有具体卡名，因此柱状图无法还原真实卡牌频次。
            </div>
          )}
        </div>

        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 12, fontSize: 12 }}>
          {Object.entries(DIM_COLORS).map(([key, value]) => (
            <span key={key} style={{ display: "inline-flex", alignItems: "center", gap: 6, color: "#475569" }}>
              <span style={{ width: 10, height: 10, borderRadius: "50%", background: value.color }} />
              {value.label}
            </span>
          ))}
          <span style={{ width: 1, height: 16, background: "#e2e8f0", margin: "0 2px" }} />
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6, color: BN_STYLE[1].labelColor, fontWeight: 700 }}>
            <span style={{ width: 16, height: 16, borderRadius: "50%", border: `3px solid ${BN_STYLE[1].ring}` }} />
            Structural
          </span>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6, color: BN_STYLE[2].labelColor, fontWeight: 700 }}>
            <span style={{ width: 16, height: 16, borderRadius: "50%", border: `2.5px dashed ${BN_STYLE[2].ring}` }} />
            Access
          </span>
          <span style={{ width: 1, height: 16, background: "#e2e8f0", margin: "0 2px" }} />
          <span style={{ color: "#64748b" }}>灰线 = 共享 covers</span>
          <span style={{ color: "#1d4ed8" }}>蓝箭头 = requires</span>
          <span style={{ color: "#dc2626" }}>红虚线 = excludes</span>
        </div>

        <svg
          width={graphWidth}
          height={SVG_HEIGHT}
          style={{
            width: "100%",
            height: SVG_HEIGHT,
            background: "#ffffff",
            borderRadius: 16,
            border: "1px solid rgba(15, 23, 42, 0.08)",
            boxShadow: "0 1px 3px rgba(15, 23, 42, 0.04)",
            display: "block"
          }}
        >
          <defs>
            <marker id="card-ecosystem-arrow" viewBox="0 0 10 10" refX="10" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse">
              <path d="M 0 0 L 10 5 L 0 10 z" fill="#3B82F6" />
            </marker>
          </defs>

          {graphLinks.map((edge, index) => {
            const source = typeof edge.source === "object" ? edge.source : null;
            const target = typeof edge.target === "object" ? edge.target : null;
            if (!source || !target || !Number.isFinite(source.x) || !Number.isFinite(target.x)) return null;

            const isHighlighted = hoveredId && connectedIds.has(source.id) && connectedIds.has(target.id);
            const dimmed = hoveredId && !isHighlighted;

            if (edge.type === "covers") {
              return (
                <line
                  key={`covers-${index}`}
                  x1={source.x}
                  y1={source.y}
                  x2={target.x}
                  y2={target.y}
                  stroke={dimmed ? "rgba(15,23,42,0.03)" : isHighlighted ? "rgba(15,23,42,0.28)" : "rgba(15,23,42,0.08)"}
                  strokeWidth={isHighlighted ? 2 : edge.weight > 1 ? 1.2 : 0.8}
                />
              );
            }

            if (edge.type === "requires") {
              return (
                <line
                  key={`requires-${index}`}
                  x1={source.x}
                  y1={source.y}
                  x2={target.x}
                  y2={target.y}
                  stroke={dimmed ? "rgba(59,130,246,0.05)" : isHighlighted ? "#3B82F6" : "rgba(59,130,246,0.32)"}
                  strokeWidth={isHighlighted ? 2.4 : 1.6}
                  markerEnd="url(#card-ecosystem-arrow)"
                />
              );
            }

            return (
              <line
                key={`excludes-${index}`}
                x1={source.x}
                y1={source.y}
                x2={target.x}
                y2={target.y}
                stroke={dimmed ? "rgba(239,68,68,0.05)" : isHighlighted ? "#EF4444" : "rgba(239,68,68,0.34)"}
                strokeWidth={isHighlighted ? 2.4 : 1.6}
                strokeDasharray="6 4"
              />
            );
          })}

          {graphNodes.map((node) => {
            const dimColor = DIM_COLORS[node.dim];
            const bottleneck = node.bn;
            const bottleneckStyle = bottleneck ? BN_STYLE[bottleneck.tier] : null;
            const isHovered = hoveredId === node.id;
            const isConnected = connectedIds.has(node.id);
            const dimmed = hoveredId && !isConnected;

            return (
              <g
                key={node.id}
                onMouseEnter={() => setHoveredId(node.id)}
                onMouseLeave={() => setHoveredId("")}
                style={{ cursor: "pointer" }}
              >
                {bottleneck?.tier === 1 && !dimmed && (
                  <>
                    {renderPulseRing(node, bottleneckStyle.ring, "0s")}
                    {renderPulseRing(node, bottleneckStyle.ring, "1s")}
                    <circle
                      cx={node.x}
                      cy={node.y}
                      r={node.radius + 4}
                      fill="none"
                      stroke={bottleneckStyle.ring}
                      strokeWidth={3}
                      opacity={0.85}
                    />
                  </>
                )}

                {bottleneck?.tier === 2 && !dimmed && (
                  <circle
                    cx={node.x}
                    cy={node.y}
                    r={node.radius + 4}
                    fill="none"
                    stroke={bottleneckStyle.ring}
                    strokeWidth={2.5}
                    strokeDasharray="5 3"
                    opacity={0.8}
                  />
                )}

                {isHovered && (
                  <circle
                    cx={node.x}
                    cy={node.y}
                    r={node.radius + (bottleneck ? 10 : 6)}
                    fill="none"
                    stroke={bottleneck ? bottleneckStyle.ring : dimColor.color}
                    strokeWidth={2}
                    opacity={0.38}
                  />
                )}

                <circle
                  cx={node.x}
                  cy={node.y}
                  r={node.radius}
                  fill={dimmed ? "#cbd5e1" : dimColor.color}
                  opacity={dimmed ? 0.26 : isHovered ? 1 : 0.9}
                  stroke={isHovered ? (bottleneck ? bottleneckStyle.ring : dimColor.color) : "rgba(255,255,255,0.82)"}
                  strokeWidth={isHovered ? 3 : 1.5}
                />

                <text
                  x={node.x}
                  y={node.y}
                  textAnchor="middle"
                  dy="0.35em"
                  fontSize={node.radius > 22 ? 14 : 11}
                  fontWeight={800}
                  fill="#fff"
                  opacity={dimmed ? 0.3 : 1}
                  style={{ pointerEvents: "none" }}
                >
                  {node.freq}
                </text>

                <text
                  x={node.x}
                  y={node.y + node.radius + 14}
                  textAnchor="middle"
                  fontSize={11}
                  fontWeight={bottleneck ? 700 : 500}
                  fill={dimmed ? "#cbd5e1" : "#475569"}
                  style={{ pointerEvents: "none" }}
                >
                  {node.name}
                </text>

                {bottleneck && !dimmed && (
                  <g>
                    <rect
                      x={node.x - 24}
                      y={node.y + node.radius + 23}
                      width={48}
                      height={16}
                      rx={5}
                      fill={bottleneckStyle.labelBg}
                      stroke={bottleneckStyle.ring}
                      strokeWidth={0.8}
                    />
                    <text
                      x={node.x}
                      y={node.y + node.radius + 34}
                      textAnchor="middle"
                      fontSize={9}
                      fontWeight={800}
                      fill={bottleneckStyle.labelColor}
                      style={{ pointerEvents: "none" }}
                    >
                      {bottleneck.short}
                    </text>
                  </g>
                )}
              </g>
            );
          })}
        </svg>

        <div
          style={{
            marginTop: 12,
            padding: "16px 18px",
            borderRadius: 14,
            background: hoveredBottleneck ? BN_STYLE[hoveredBottleneck.tier].labelBg : "#f8fafc",
            border: `2px solid ${hoveredBottleneck ? BN_STYLE[hoveredBottleneck.tier].ring : "#e2e8f0"}`,
            minHeight: 122
          }}
        >
          {hoveredCard ? (
            <>
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center", marginBottom: 10 }}>
                <span style={{ fontSize: 17, fontWeight: 900, color: DIM_COLORS[hoveredCard.dim].color }}>
                  {hoveredCard.name}
                </span>
                <span style={{ fontSize: 11, color: "#64748b" }}>{DIM_COLORS[hoveredCard.dim].label}</span>
                <span style={{ fontSize: 11, background: "#ffffff", border: "1px solid #e2e8f0", borderRadius: 999, padding: "2px 8px", color: "#334155" }}>
                  {Number(frequency[hoveredCard.id] || 0)} 次选择
                </span>
                {hoveredBottleneck && (
                  <span
                    style={{
                      fontSize: 11,
                      fontWeight: 800,
                      padding: "2px 10px",
                      borderRadius: 999,
                      background: BN_STYLE[hoveredBottleneck.tier].ring,
                      color: "#fff"
                    }}
                  >
                    {hoveredBottleneck.tier === 1 ? "Structural Bottleneck" : "Access Bottleneck"}
                  </span>
                )}
              </div>

              {hoveredBottleneck && (
                <div
                  style={{
                    padding: "10px 12px",
                    marginBottom: 10,
                    borderRadius: 10,
                    background: hoveredBottleneck.tier === 1 ? "rgba(255,107,53,0.08)" : "rgba(217,119,6,0.08)",
                    border: `1px solid ${BN_STYLE[hoveredBottleneck.tier].ring}33`,
                    fontSize: 13,
                    color: BN_STYLE[hoveredBottleneck.tier].labelColor,
                    lineHeight: 1.6
                  }}
                >
                  <strong>{hoveredBottleneck.short}</strong>：{hoveredBottleneck.detail}
                </div>
              )}

              <div style={{ fontSize: 13, color: "#475569", lineHeight: 1.7 }}>
                <strong style={{ color: "#334155" }}>覆盖标签：</strong>
                {hoveredCard.covers.length ? hoveredCard.covers.map((cover) => (
                  <span
                    key={cover}
                    style={{
                      display: "inline-block",
                      margin: "2px 4px",
                      padding: "1px 8px",
                      background: "#eef2ff",
                      color: "#4338ca",
                      borderRadius: 999,
                      fontSize: 12
                    }}
                  >
                    {cover}
                  </span>
                )) : <span style={{ color: "#94a3b8" }}>无（降本卡）</span>}
              </div>

              {summaryCards.length > 0 && (
                <div style={{ marginTop: 8, fontSize: 13, color: "#475569", lineHeight: 1.7 }}>
                  <strong style={{ color: "#334155" }}>硬规则：</strong>
                  {summaryCards.map((rule) => {
                    const peerId = rule.from === hoveredCard.id ? rule.to : rule.from;
                    const peer = CARD_BY_ID.get(peerId);
                    return (
                      <span
                        key={`${rule.type}-${rule.from}-${rule.to}`}
                        style={{
                          display: "inline-block",
                          margin: "2px 4px",
                          padding: "1px 8px",
                          background: rule.type === "requires" ? "#dbeafe" : "#fee2e2",
                          color: rule.type === "requires" ? "#1d4ed8" : "#b91c1c",
                          borderRadius: 999,
                          fontSize: 11,
                          fontWeight: 700
                        }}
                      >
                        {rule.type === "requires" ? `→ 依赖 ${peer?.name || peerId}` : `⊘ 互斥 ${peer?.name || peerId}`}
                      </span>
                    );
                  })}
                </div>
              )}
            </>
          ) : (
            <div style={{ fontSize: 13, color: "#64748b", lineHeight: 1.7 }}>
              将鼠标移到任一节点上，可查看该卡的 covers、依赖/互斥关系，以及是否属于 Structural / Access bottleneck。
            </div>
          )}
        </div>
      </div>

      <div style={PANEL_STYLE}>
        <div style={{ fontSize: 16, fontWeight: 900, color: "#0f172a", marginBottom: 12 }}>选卡频次分布</div>
        {showNoData ? (
          <div style={{ padding: "18px 14px", borderRadius: 14, background: "#f8fafc", border: "1px dashed #cbd5e1", fontSize: 13, color: "#64748b" }}>
            暂无选卡数据
          </div>
        ) : showInsufficient ? (
          <div style={{ padding: "18px 14px", borderRadius: 14, background: "#fff7ed", border: "1px dashed #fdba74", fontSize: 13, color: "#9a3412", lineHeight: 1.7 }}>
            数据不足：这些团队只提交了卡片数量，没有提交具体卡名，因此无法展示真实频次柱状图。
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {sortedCards.map((card) => {
              const freqValue = Number(frequency[card.id] || 0);
              const bottleneck = BOTTLENECK[card.id] || null;
              const color = bottleneck ? BN_STYLE[bottleneck.tier].ring : DIM_COLORS[card.dim].color;
              const widthPct = maxFreq > 0 ? (freqValue / maxFreq) * 100 : 0;
              return (
                <div key={card.id} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <div style={{ width: 90, flexShrink: 0, textAlign: "right", fontSize: 12, color: "#475569", fontWeight: bottleneck ? 800 : 500 }}>
                    {bottleneck ? (bottleneck.tier === 1 ? "⚡ " : "🔒 ") : ""}{card.name}
                  </div>
                  <div style={{ flex: 1, height: 18, background: "#f1f5f9", borderRadius: 5, overflow: "hidden", position: "relative" }}>
                    <div
                      style={{
                        width: `${widthPct}%`,
                        height: "100%",
                        background: color,
                        borderRadius: 5,
                        transition: "width 0.3s ease"
                      }}
                    />
                  </div>
                  <div style={{ width: 24, textAlign: "center", fontSize: 12, fontWeight: 800, color: freqValue > 0 ? color : "#cbd5e1" }}>
                    {freqValue}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: graphWidth < 860 ? "1fr" : "1fr 1fr", gap: 14 }}>
        <div
          style={{
            ...PANEL_STYLE,
            background: "linear-gradient(135deg, #FFF5EE 0%, #FFF0E6 100%)",
            border: "1.5px solid rgba(255,107,53,0.3)"
          }}
        >
          <div style={{ fontSize: 14, fontWeight: 900, color: "#C2410C", marginBottom: 10 }}>
            ⚡ Structural Bottleneck · 技术本身未解
          </div>
          {Object.entries(BOTTLENECK).filter(([, value]) => value.tier === 1).map(([id, meta]) => {
            const card = CARD_BY_ID.get(id);
            return (
              <div key={id} style={{ marginBottom: 10, fontSize: 13, color: "#7c2d12", lineHeight: 1.6 }}>
                <span style={{ fontWeight: 800, color: DIM_COLORS[card.dim].color }}>{card.name}</span>
                <span style={{ margin: "0 6px", color: "#C2410C", fontWeight: 700 }}>·</span>
                <span style={{ fontWeight: 700 }}>{meta.short}</span>
                <div style={{ marginTop: 2, fontSize: 12, color: "#9a3412" }}>{meta.detail}</div>
              </div>
            );
          })}
          <div style={{ marginTop: 10, paddingTop: 8, borderTop: "1px solid rgba(255,107,53,0.18)", fontSize: 12, color: "#9a3412", fontStyle: "italic", lineHeight: 1.7 }}>
            共性：全部卡在端上智能 vs 云端依赖的矛盾上——技术本身未解，砸钱也突破不了。应对策略不是加投入，是分阶段验证或绕道。
          </div>
        </div>

        <div
          style={{
            ...PANEL_STYLE,
            background: "linear-gradient(135deg, #FFFBEB 0%, #FFF8E7 100%)",
            border: "1.5px solid rgba(217,119,6,0.25)"
          }}
        >
          <div style={{ fontSize: 14, fontWeight: 900, color: "#92400E", marginBottom: 10 }}>
            🔒 Access Bottleneck · 获取被门控
          </div>
          {Object.entries(BOTTLENECK).filter(([, value]) => value.tier === 2).map(([id, meta]) => {
            const card = CARD_BY_ID.get(id);
            return (
              <div key={id} style={{ marginBottom: 10, fontSize: 13, color: "#78350f", lineHeight: 1.6 }}>
                <span style={{ fontWeight: 800, color: DIM_COLORS[card.dim].color }}>{card.name}</span>
                <span style={{ margin: "0 6px", color: "#92400E", fontWeight: 700 }}>·</span>
                <span style={{ fontWeight: 700 }}>{meta.short}</span>
                <div style={{ marginTop: 2, fontSize: 12, color: "#a16207" }}>{meta.detail}</div>
              </div>
            );
          })}
          <div style={{ marginTop: 10, paddingTop: 8, borderTop: "1px solid rgba(217,119,6,0.16)", fontSize: 12, color: "#a16207", fontStyle: "italic", lineHeight: 1.7 }}>
            共性：技术已验证，但获取被门控——成本、法规、供应链。应对策略不是等突破，是谈判门槛：规模降本、预置合规、替代供应。
          </div>
        </div>
      </div>

      <div style={{ ...PANEL_STYLE, background: "#fff8e7", border: "1px solid #fcd34d", color: "#854d0e", fontSize: 13, lineHeight: 1.7 }}>
        <strong>教学锚点：</strong>
        "你选的卡里有几张落在 Structural 区、几张落在 Access 区？Structural 意味着你在赌技术突破（高方差），Access 意味着你在赌规模经济或监管放松（可预测但有时间线）——你的产品组合里，哪种赌注占主导？"
      </div>
    </div>
  );
}
