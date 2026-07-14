import { useMemo } from "react";

const COLORS = {
  bg: "#F8F7F4",
  card: "#FFFFFF",
  ink: "#1A1A1A",
  soft: "#6B6B6B",
  mute: "#A0A0A0",
  faint: "#D4D4D4",
  ok: { bg: "#ECFDF5", text: "#065F46", border: "#A7F3D0", dot: "#10B981" },
  warn: { bg: "#FFFBEB", text: "#92400E", border: "#FDE68A", dot: "#F59E0B" }
};

const TEAM_COLORS = ["#E8634A", "#3B82C4", "#2FAB6E", "#D4A03C", "#8B5CF6"];
const RADAR_KEYS = ["perception", "motion", "interaction", "safety", "extend", "ops"];
const RADAR_LABELS = {
  perception: "感知",
  motion: "运动",
  interaction: "交互",
  safety: "安全",
  extend: "扩展",
  ops: "运维"
};
const CHECKS = [
  { id: "r1_ceiling", label: "市场定位", scale: "满分≈50%" },
  { id: "drift", label: "战略漂移", scale: null },
  { id: "interview", label: "访谈深度", scale: "满分 1.0" },
  { id: "coverage", label: "选卡纪律", scale: "满分 100%" },
  { id: "balance", label: "能力均衡", scale: "高低差<3 为佳" },
  { id: "pricing", label: "定价合理", scale: "45~95%" },
  { id: "overinvest", label: "成本控制", scale: "≤10 为佳" }
];

function formatPercent(value, digits = 0) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  return `${(n * 100).toFixed(digits)}%`;
}

function formatScore(value, digits = 2) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  return n.toFixed(digits);
}

function formatMoney(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  return `${Math.round(n).toLocaleString()}`;
}

function formatWan(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  const wan = n / 10000;
  const sign = wan > 0 ? "+" : (wan < 0 ? "-" : "");
  return `${sign}${Math.abs(wan).toFixed(0)}万`;
}

function getTeamName(team) {
  return team?.displayName || team?.name || "未命名团队";
}

function getTeamPosition(team) {
  return team?.r2?.bestGridLabel || team?.r1?.gridLabel || "未识别定位";
}

function getTeamColor(team, index) {
  return team?.color || TEAM_COLORS[index % TEAM_COLORS.length];
}

function getRadarValues(radar) {
  return RADAR_KEYS.map((key) => Number(radar?.[key])).filter((value) => Number.isFinite(value));
}

export function diagnoseTeam(team) {
  const r1 = team?.r1 || {};
  const r2 = team?.r2 || {};
  const causalDetail = team?.causalDetail || {};
  const radar = r2.radar || {};
  const radarValues = getRadarValues(radar);
  const radarEntries = RADAR_KEYS
    .map((key) => ({ key, label: RADAR_LABELS[key], value: Number(radar?.[key]) }))
    .filter((item) => Number.isFinite(item.value));
  const radarMax = radarValues.length ? Math.max(...radarValues) : null;
  const radarMin = radarValues.length ? Math.min(...radarValues) : null;
  const radarGap = radarMax != null && radarMin != null ? radarMax - radarMin : null;
  const highestRadar = radarEntries.reduce(
    (best, item) => (best == null || item.value > best.value ? item : best),
    null
  );
  const lowestRadar = radarEntries.reduce(
    (best, item) => (best == null || item.value < best.value ? item : best),
    null
  );

  const actualGm = Number(r2.actualGm);
  const marketWtpAdj = Number(r1.wtpAdj ?? r2.wtpAdj);
  const pricingWtpAdj = Number(r2.wtpAdj ?? r1.wtpAdj);
  const evi = Number(r2.evi);
  const coverCore = Number(r2.coverCore);
  const price = Number(r2.price);
  const dCOGS = Number(r2.dCOGS);
  const cardCount = Number(r2.cardCount);
  const priceRatio = Number.isFinite(price) && Number.isFinite(pricingWtpAdj) && pricingWtpAdj > 0
    ? price / pricingWtpAdj
    : null;
  const uncoveredCoreTags = Array.isArray(causalDetail.uncoveredCoreTags) ? causalDetail.uncoveredCoreTags : [];

  const ceilingBroken =
    (Number.isFinite(actualGm) && actualGm < 0.20) ||
    (Number.isFinite(marketWtpAdj) && marketWtpAdj < 4000);

  const driftBroken = Boolean(r1.grid && r2.bestGrid && r1.grid !== r2.bestGrid);
  const interviewBroken = Number.isFinite(evi) && evi < 0.70;
  const coverageBroken = Number.isFinite(coverCore) && coverCore < 0.60;
  const balanceBroken = radarValues.length >= 3 && Number.isFinite(radarGap) && radarGap >= 3;
  const pricingBroken = priceRatio != null && (priceRatio > 0.95 || priceRatio < 0.45);
  const overinvestBroken =
    (Number.isFinite(cardCount) && Number.isFinite(dCOGS) && cardCount >= 11 && dCOGS > 2000) ||
    (Number.isFinite(dCOGS) && dCOGS > 3000);

  const results = [
    {
      ...CHECKS[0],
      ok: !ceilingBroken,
      value: formatPercent(actualGm, 0),
      note: ceilingBroken
        ? `GM${formatPercent(actualGm, 0)} / WTP${formatMoney(marketWtpAdj)}`
        : null
    },
    {
      ...CHECKS[1],
      ok: !driftBroken,
      value: driftBroken ? "偏移" : "一致",
      note: driftBroken
        ? `${r1.gridLabel || r1.grid} → ${r2.bestGridLabel || r2.bestGrid}`
        : null
    },
    {
      ...CHECKS[2],
      ok: !interviewBroken,
      value: formatScore(evi),
      note: interviewBroken
        ? "访谈证据不足"
        : null
    },
    {
      ...CHECKS[3],
      ok: !coverageBroken,
      value: formatPercent(coverCore, 0),
      note: coverageBroken
        ? (uncoveredCoreTags.length
          ? `漏了「${uncoveredCoreTags.join("、")}」`
          : "覆盖质量不足")
        : null
    },
    {
      ...CHECKS[4],
      ok: !balanceBroken,
      value: balanceBroken && highestRadar && lowestRadar
        ? `${highestRadar.label}${highestRadar.value} ${lowestRadar.label}${lowestRadar.value}`
        : "均衡",
      note: balanceBroken
        ? `差${radarGap.toFixed(0)}，偏科严重`
        : null
    },
    {
      ...CHECKS[5],
      ok: !pricingBroken,
      value: priceRatio == null ? "—" : `${Math.round(priceRatio * 100)}%`,
      note: pricingBroken
        ? priceRatio > 0.95
          ? "定价过高"
          : "定价过低"
        : null
    },
    {
      ...CHECKS[6],
      ok: !overinvestBroken,
      value: Number.isFinite(cardCount) ? `${Math.round(cardCount)}卡` : "—",
      note: overinvestBroken
        ? `dCOGS=${formatMoney(dCOGS)}`
        : null
    }
  ];

  const warnCount = results.filter((item) => !item.ok).length;

  return {
    results,
    warnCount
  };
}

function Node({ result }) {
  const tone = result.ok ? COLORS.ok : COLORS.warn;
  return (
    <div
      style={{
        minWidth: 74,
        flex: "1 1 0",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        position: "relative"
      }}
    >
      <div
        style={{
          width: 26,
          height: 26,
          borderRadius: "50%",
          background: tone.dot,
          color: "#FFFFFF",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 13,
          fontWeight: 800,
          position: "relative",
          zIndex: 2
        }}
      >
        {result.ok ? "✓" : "!"}
      </div>
      <div
        style={{
          marginTop: 5,
          fontSize: 11,
          fontWeight: 600,
          color: result.ok ? COLORS.ink : COLORS.warn.text,
          textAlign: "center",
          lineHeight: 1.2
        }}
      >
        {result.label}
      </div>
      <div
        style={{
          marginTop: 6,
          padding: "2px 8px",
          borderRadius: 6,
          background: tone.bg,
          border: `1px solid ${tone.border}`,
          color: tone.text,
          fontSize: 11,
          fontWeight: 700,
          whiteSpace: "nowrap",
          fontVariantNumeric: "tabular-nums"
        }}
      >
        {result.value}
      </div>
      {result.scale && (
        <div style={{ marginTop: 2, fontSize: 9, color: COLORS.mute }}>
          {result.scale}
        </div>
      )}
      {!result.ok && result.note && (
        <div
          style={{
            marginTop: 3,
            fontSize: 10,
            color: COLORS.warn.text,
            textAlign: "center",
            lineHeight: 1.3,
            maxWidth: 90
          }}
        >
          {result.note}
        </div>
      )}
    </div>
  );
}

function Connector({ ok }) {
  return (
    <div
      style={{
        flex: "0 0 28px",
        alignSelf: "flex-start",
        marginTop: 13,
        borderTop: `2px solid ${ok ? COLORS.ok.dot : COLORS.faint}`
      }}
    />
  );
}

function HorizontalChain({ diag }) {
  const { results } = diag;

  return (
    <div style={{ display: "grid", gap: 10 }}>
      <div style={{ overflowX: "auto", paddingBottom: 4 }}>
        <div style={{ display: "flex", alignItems: "flex-start", minWidth: 680 }}>
          {results.map((result, index) => {
            return (
              <div key={result.id} style={{ display: "flex", alignItems: "flex-start", flex: "1 1 0" }}>
                <Node result={result} />
                {index < results.length - 1 && <Connector ok={result.ok && results[index + 1]?.ok} />}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function OntologyDiagram() {
  return (
    <div style={{ marginBottom: 24 }}>
      <div style={{ fontSize: 15, fontWeight: 700, color: "#1A1A1A", marginBottom: 8 }}>
        诊断链 × 数据 Ontology
      </div>
      <div style={{ fontSize: 12, color: "#6B6B6B", marginBottom: 12 }}>
        左侧 ①③④⑤ = 正向链检查（上游→下游） · 右侧 ②⑥⑦ = 跨层比对
      </div>
      <svg
        width="100%"
        viewBox="0 0 680 440"
        style={{
          background: "#FFFFFF",
          borderRadius: 12,
          border: "1px solid rgba(0,0,0,0.08)"
        }}
        role="img"
        xmlns="http://www.w3.org/2000/svg"
      >
        <defs>
          <marker
            id="arrow"
            viewBox="0 0 10 10"
            refX="8"
            refY="5"
            markerWidth="6"
            markerHeight="6"
            orient="auto-start-reverse"
          >
            <path
              d="M2 1L8 5L2 9"
              fill="none"
              stroke="context-stroke"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </marker>
        </defs>
        <title>7 关卡诊断 ontology</title>
        <desc>R1 到 R2 的因果链，7 个诊断关卡标注在实体关系上</desc>

        <g>
          <rect x="200" y="24" width="280" height="72" rx="10" fill="#FAEEDA" stroke="#854F0B" strokeWidth="0.5" />
          <text x="340" y="44" textAnchor="middle" fill="#633806" fontSize="14" fontWeight="500">FinalR1</text>
        </g>
        <g>
          <rect x="212" y="52" width="72" height="34" rx="4" fill="#E6F1FB" stroke="#185FA5" strokeWidth="0.5" />
          <text x="248" y="73" textAnchor="middle" fill="#185FA5" fontSize="12">D grid/VP</text>
        </g>
        <g>
          <rect x="294" y="52" width="72" height="34" rx="4" fill="#FAEEDA" stroke="#854F0B" strokeWidth="0.5" />
          <text x="330" y="73" textAnchor="middle" fill="#854F0B" fontSize="12">C gm/wtp</text>
        </g>
        <g>
          <rect x="376" y="52" width="72" height="34" rx="4" fill="#EEEDFE" stroke="#534AB7" strokeWidth="0.5" />
          <text x="412" y="73" textAnchor="middle" fill="#534AB7" fontSize="12">Q C·G·E</text>
        </g>

        <line x1="340" y1="96" x2="340" y2="118" stroke="#3D3D3A" strokeWidth="0.5" strokeDasharray="3 2" />
        <text x="340" y="112" textAnchor="middle" fill="#3D3D3A" fontSize="10">冻结传导</text>

        <g>
          <rect x="240" y="120" width="200" height="36" rx="6" fill="#E1F5EE" stroke="#0F6E56" strokeWidth="0.5" />
          <text x="340" y="135" textAnchor="middle" fill="#085041" fontSize="12" fontWeight="500">InterviewSession</text>
          <text x="340" y="149" textAnchor="middle" fill="#0F6E56" fontSize="10">P 证据 · Q evi</text>
        </g>
        <line x1="340" y1="156" x2="340" y2="172" stroke="#3D3D3A" strokeWidth="0.5" markerEnd="url(#arrow)" />

        <g>
          <rect x="240" y="172" width="200" height="36" rx="6" fill="#EEEDFE" stroke="#534AB7" strokeWidth="0.5" />
          <text x="340" y="187" textAnchor="middle" fill="#3C3489" fontSize="12" fontWeight="500">TeamRadar</text>
          <text x="340" y="201" textAnchor="middle" fill="#534AB7" fontSize="10">Q coverCore · radar{`{6}`}</text>
        </g>
        <line x1="340" y1="208" x2="340" y2="224" stroke="#3D3D3A" strokeWidth="0.5" markerEnd="url(#arrow)" />

        <g>
          <rect x="220" y="224" width="240" height="44" rx="6" fill="#E6F1FB" stroke="#185FA5" strokeWidth="0.5" />
          <text x="340" y="240" textAnchor="middle" fill="#0C447C" fontSize="12" fontWeight="500">R2Submission</text>
        </g>
        <g>
          <rect x="232" y="248" width="62" height="14" rx="3" fill="#E6F1FB" stroke="#185FA5" strokeWidth="0.5" />
          <text x="263" y="259" textAnchor="middle" fill="#185FA5" fontSize="9">D cards</text>
        </g>
        <g>
          <rect x="302" y="248" width="62" height="14" rx="3" fill="#F1EFE8" stroke="#5F5E5A" strokeWidth="0.5" />
          <text x="333" y="259" textAnchor="middle" fill="#5F5E5A" fontSize="9">X bestGrid</text>
        </g>
        <g>
          <rect x="372" y="248" width="62" height="14" rx="3" fill="#FAECE7" stroke="#993C1D" strokeWidth="0.5" />
          <text x="403" y="259" textAnchor="middle" fill="#993C1D" fontSize="9">D dCOGS</text>
        </g>
        <line x1="340" y1="268" x2="340" y2="284" stroke="#3D3D3A" strokeWidth="0.5" markerEnd="url(#arrow)" />

        <g>
          <rect x="240" y="284" width="200" height="36" rx="6" fill="#FAECE7" stroke="#993C1D" strokeWidth="0.5" />
          <text x="340" y="299" textAnchor="middle" fill="#712B13" fontSize="12" fontWeight="500">R2Result</text>
          <text x="340" y="313" textAnchor="middle" fill="#993C1D" fontSize="10">O units · profit · vscore</text>
        </g>

        <circle cx="68" cy="68" r="11" fill="#FF6B35" opacity="0.9" />
        <text x="68" y="72" textAnchor="middle" fill="#FFFFFF" fontSize="11" fontWeight="700">①</text>
        <text x="68" y="52" textAnchor="middle" fill="#3D3D3A" fontSize="10">R1天花板</text>
        <path d="M68 79 L68 300 L238 300" fill="none" stroke="#FF6B35" strokeWidth="0.5" strokeDasharray="3 2" markerEnd="url(#arrow)" />

        <circle cx="612" cy="68" r="11" fill="#3B82F6" opacity="0.9" />
        <text x="612" y="72" textAnchor="middle" fill="#FFFFFF" fontSize="11" fontWeight="700">②</text>
        <text x="612" y="52" textAnchor="middle" fill="#3D3D3A" fontSize="10">漂移</text>
        <path d="M612 79 L612 252 L462 252" fill="none" stroke="#3B82F6" strokeWidth="0.5" strokeDasharray="3 2" markerEnd="url(#arrow)" />

        <circle cx="68" cy="138" r="11" fill="#10B981" opacity="0.9" />
        <text x="68" y="142" textAnchor="middle" fill="#FFFFFF" fontSize="11" fontWeight="700">③</text>
        <text x="68" y="122" textAnchor="middle" fill="#3D3D3A" fontSize="10">访谈</text>
        <line x1="79" y1="138" x2="238" y2="138" stroke="#10B981" strokeWidth="0.5" strokeDasharray="3 2" />

        <circle cx="68" cy="186" r="11" fill="#8B5CF6" opacity="0.9" />
        <text x="68" y="190" textAnchor="middle" fill="#FFFFFF" fontSize="11" fontWeight="700">④</text>
        <text x="68" y="170" textAnchor="middle" fill="#3D3D3A" fontSize="10">选卡</text>
        <line x1="79" y1="186" x2="238" y2="186" stroke="#8B5CF6" strokeWidth="0.5" strokeDasharray="3 2" />

        <circle cx="68" cy="244" r="11" fill="#8B5CF6" opacity="0.9" />
        <text x="68" y="248" textAnchor="middle" fill="#FFFFFF" fontSize="11" fontWeight="700">⑤</text>
        <text x="68" y="228" textAnchor="middle" fill="#3D3D3A" fontSize="10">偏科</text>
        <line x1="79" y1="244" x2="218" y2="244" stroke="#8B5CF6" strokeWidth="0.5" strokeDasharray="3 2" />

        <circle cx="612" cy="244" r="11" fill="#D97706" opacity="0.9" />
        <text x="612" y="248" textAnchor="middle" fill="#FFFFFF" fontSize="11" fontWeight="700">⑥</text>
        <text x="612" y="228" textAnchor="middle" fill="#3D3D3A" fontSize="10">定价</text>
        <path d="M612 233 L612 68 L462 68" fill="none" stroke="#D97706" strokeWidth="0.5" strokeDasharray="3 2" markerEnd="url(#arrow)" />

        <circle cx="612" cy="300" r="11" fill="#EF4444" opacity="0.9" />
        <text x="612" y="304" textAnchor="middle" fill="#FFFFFF" fontSize="11" fontWeight="700">⑦</text>
        <text x="612" y="284" textAnchor="middle" fill="#3D3D3A" fontSize="10">堆料</text>
        <line x1="601" y1="300" x2="462" y2="300" stroke="#EF4444" strokeWidth="0.5" strokeDasharray="3 2" />

        <g transform="translate(120, 340)">
          <rect x="0" y="0" width="10" height="10" rx="2" fill="#E6F1FB" stroke="#185FA5" strokeWidth="0.5" />
          <text x="14" y="9" fill="#3D3D3A" fontSize="10">D 决策</text>
          <rect x="68" y="0" width="10" height="10" rx="2" fill="#FAEEDA" stroke="#854F0B" strokeWidth="0.5" />
          <text x="82" y="9" fill="#3D3D3A" fontSize="10">C 约束</text>
          <rect x="136" y="0" width="10" height="10" rx="2" fill="#EEEDFE" stroke="#534AB7" strokeWidth="0.5" />
          <text x="150" y="9" fill="#3D3D3A" fontSize="10">Q 评分</text>
          <rect x="204" y="0" width="10" height="10" rx="2" fill="#E1F5EE" stroke="#0F6E56" strokeWidth="0.5" />
          <text x="218" y="9" fill="#3D3D3A" fontSize="10">P 过程</text>
          <rect x="272" y="0" width="10" height="10" rx="2" fill="#FAECE7" stroke="#993C1D" strokeWidth="0.5" />
          <text x="286" y="9" fill="#3D3D3A" fontSize="10">O 结果</text>
          <rect x="340" y="0" width="10" height="10" rx="2" fill="#F1EFE8" stroke="#5F5E5A" strokeWidth="0.5" />
          <text x="354" y="9" fill="#3D3D3A" fontSize="10">X 对照</text>
        </g>
        <text x="340" y="380" textAnchor="middle" fill="#3D3D3A" fontSize="10">
          左 ①③④⑤ 正向链 · 右 ②⑥⑦ 跨层比对 · 第一个断的 = 主诊断
        </text>
      </svg>
    </div>
  );
}

function TeamCard({ team, color, diag }) {
  const profit = Number(team?.r2?.profit);
  const warnItems = diag.results.filter((item) => !item.ok);

  return (
    <div
      style={{
        background: COLORS.card,
        border: "1px solid rgba(0,0,0,0.08)",
        borderRadius: 16,
        padding: 18,
        boxShadow: "0 1px 3px rgba(0,0,0,0.04)"
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "baseline",
          gap: 12,
          flexWrap: "wrap",
          marginBottom: 6
        }}
      >
        <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
          <span style={{ fontSize: 18, fontWeight: 800, color }}>{getTeamName(team)}</span>
          <span style={{ fontSize: 12, color: COLORS.soft }}>{getTeamPosition(team)}</span>
        </div>
        <div style={{ fontSize: 18, fontWeight: 800, color: profit >= 0 ? COLORS.ok.text : COLORS.warn.text, fontVariantNumeric: "tabular-nums" }}>
          利润 {formatWan(profit)}
        </div>
      </div>

      <HorizontalChain diag={diag} />

      {warnItems.length === 0 && (
        <div
          style={{
            marginTop: 12,
            padding: "8px 14px",
            background: COLORS.ok.bg,
            border: `1px solid ${COLORS.ok.border}`,
            borderRadius: 8,
            fontSize: 13,
            color: COLORS.ok.text
          }}
        >
          ✓ 7 项全部通过
        </div>
      )}
      {warnItems.length > 0 && (
        <div
          style={{
            marginTop: 12,
            padding: "8px 14px",
            background: COLORS.warn.bg,
            border: `1px solid ${COLORS.warn.border}`,
            borderRadius: 8,
            fontSize: 13,
            color: COLORS.warn.text
          }}
        >
          ⚠ {warnItems.length} 项需关注：{warnItems.map((item) => item.label).join("、")}
        </div>
      )}
    </div>
  );
}

export default function DiagnosticTab({ teams }) {
  const diagnosedTeams = useMemo(
    () => (Array.isArray(teams) ? teams : []).map((team) => ({ team, diag: diagnoseTeam(team) })),
    [teams]
  );

  if (!diagnosedTeams.length) {
    return (
      <div style={{ display: "grid", gap: 16 }}>
        <OntologyDiagram />
        <div
          style={{
            background: "#FFFFFF",
            border: "1px solid #E5E7EB",
            borderRadius: 16,
            padding: 24,
            color: "#6B7280",
            fontSize: 14
          }}
        >
          暂无已提交 Round 2 的团队
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <OntologyDiagram />
      {diagnosedTeams.map(({ team, diag }, index) => (
        <TeamCard
          key={team.id || getTeamName(team)}
          team={team}
          color={getTeamColor(team, index)}
          diag={diag}
        />
      ))}
    </div>
  );
}
