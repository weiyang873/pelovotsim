import { useEffect, useMemo, useState } from "react";
import {
  downloadTeacherCsv,
  generateTeacherDebrief,
  generateTeacherTeamReview,
  getTeacherDebriefData,
  getTeacherVpIterations
} from "../api/teacherApi";

const CARD_STYLE = {
  background: "#fff",
  border: "1px solid #e2e8f0",
  borderRadius: 18,
  padding: 18
};

const GRID_ROWS = [
  { key: "ToC·差异化", label: "ToC·差异化" },
  { key: "ToC·成本领先", label: "ToC·成本领先" },
  { key: "ToB·差异化", label: "ToB·差异化" },
  { key: "ToB·成本领先", label: "ToB·成本领先" }
];

const GRID_COLS = ["老人", "成人", "儿童"];

const ARCH_DISPLAY = {
  Experience: { label: "体验●", color: "#8B5CF6", symbol: "●" },
  Hybrid: { label: "混合▲", color: "#F59E0B", symbol: "▲" },
  Function: { label: "功能■", color: "#3B82F6", symbol: "■" }
};

const RADAR_DIMS = [
  { key: "interaction", label: "交互" },
  { key: "perception", label: "感知" },
  { key: "motion", label: "运动" },
  { key: "safety", label: "安全" },
  { key: "extend", label: "扩展" },
  { key: "ops", label: "运营" }
];

function normalizeGridLabel(value) {
  return String(value || "")
    .replace(/CostLeadership/g, "成本领先")
    .replace(/Cost/g, "成本领先")
    .replace(/Differentiation/g, "差异化")
    .replace(/B2B/g, "ToB")
    .replace(/B2C/g, "ToC")
    .replace(/\s+/g, "")
    .replace(/·成本领先领先/g, "·成本领先");
}

function gridCellKeyFromLabel(value) {
  const label = normalizeGridLabel(value);
  if (!label) return "";
  const parts = label.split("·");
  if (parts.length < 3) return "";
  return `${parts[0]}·${parts[1]}|${parts[2]}`;
}

function gridCellKeyFromGridId(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const parts = raw.split("_");
  if (parts.length < 3) return "";
  const market = /^B2B$/i.test(parts[0]) || /^ToB$/i.test(parts[0]) ? "ToB" : "ToC";
  const strategy = /cost/i.test(parts[1]) ? "成本领先" : "差异化";
  const segment = /elder/i.test(parts[2]) ? "老人" : /child/i.test(parts[2]) ? "儿童" : "成人";
  return `${market}·${strategy}|${segment}`;
}

function formatMoney(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "-";
  return `¥${Math.round(n).toLocaleString()}`;
}

function formatWan(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "-";
  return `${Math.round(n / 10000).toLocaleString()}万`;
}

function formatPercent(value, digits = 0) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "-";
  return `${(n * 100).toFixed(digits)}%`;
}

function formatSignedPercent(value, digits = 0) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "-";
  const text = `${(Math.abs(n) * 100).toFixed(digits)}%`;
  return n > 0 ? `+${text}` : (n < 0 ? `-${text}` : text);
}

function formatScore(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "-";
  return n.toFixed(1);
}

function getRadarScore(scores, key, fallback = 0) {
  const n = Number(scores?.[key]);
  return Number.isFinite(n) ? n : fallback;
}

function computeRadarScale(teams) {
  const values = [];
  (teams || []).forEach((team) => {
    RADAR_DIMS.forEach((dim) => {
      const score = getRadarScore(team?.r2?.radar, dim.key, null);
      if (Number.isFinite(score)) values.push(score);
    });
  });

  if (!values.length) {
    return {
      rangeMin: 0,
      rangeMax: 10,
      tickValues: [0, 2, 4, 6, 8, 10]
    };
  }

  const rawMin = Math.min(...values);
  const rawMax = Math.max(...values);
  const rangeMin = Math.floor(rawMin) - 0.5;
  const derivedMax = Math.ceil(rawMax) + 0.5;
  const rangeMax = derivedMax > rangeMin ? derivedMax : rangeMin + 1;
  const tickStart = Math.ceil(rangeMin);
  const tickEnd = Math.floor(rangeMax);
  const tickValues = [];

  for (let value = tickStart; value <= tickEnd; value += 1) {
    tickValues.push(value);
  }

  return {
    rangeMin,
    rangeMax,
    tickValues: tickValues.length ? tickValues : [Math.round((rangeMin + rangeMax) / 2)]
  };
}

function clipText(value, max = 50) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (!text) return "-";
  return text.length > max ? `${text.slice(0, max)}...` : text;
}

function normalizeArchKey(arch) {
  const raw = String(arch || "").trim().toLowerCase();
  if (raw === "experience" || raw === "体验●") return "Experience";
  if (raw === "hybrid" || raw === "混合▲") return "Hybrid";
  if (raw === "function" || raw === "功能■") return "Function";
  return String(arch || "").trim();
}

function getArchDisplay(arch) {
  const key = normalizeArchKey(arch);
  return ARCH_DISPLAY[key] || { label: String(arch || "-"), color: "#64748b", symbol: "" };
}

function extractTeamNo(team) {
  const match = String(team?.displayName || team?.name || "").match(/(\d+)/);
  if (match) return match[1];
  return String((Number(team?.teamIndex) || 0) + 1);
}

function getTeamLabel(team) {
  return team?.displayName || `第${extractTeamNo(team)}组`;
}

function formatPercentNumber(value, digits = 0) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "-";
  return `${n.toFixed(digits)}%`;
}

function formatSignedPercentNumber(value, digits = 0) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "-";
  if (n > 0) return `+${n.toFixed(digits)}%`;
  if (n < 0) return `-${Math.abs(n).toFixed(digits)}%`;
  return `${n.toFixed(digits)}%`;
}

function getChannelFeeRate(team) {
  return /ToB|B2B/i.test(String(team?.r1?.grid || team?.r1?.gridLabel || "")) ? 0.15 : 0.25;
}

function normalizeNreToYuan(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  if (n === 0) return 0;
  return Math.abs(n) >= 1000000 ? n : n * 10000;
}

function computeNrePerUnit(team) {
  const totalNreYuan = normalizeNreToYuan(team?.r2?.nre);
  const units = Number(team?.r2?.units);
  if (!Number.isFinite(totalNreYuan) || !Number.isFinite(units) || units <= 0) return null;
  return totalNreYuan / units;
}

function computeRdRoiPct(team) {
  const profit = Number(team?.r2?.profit);
  const dCOGS = Number(team?.r2?.dCOGS);
  const units = Number(team?.r2?.units);
  const spend = dCOGS * units;
  if (!Number.isFinite(profit) || !Number.isFinite(spend) || spend <= 0) return null;
  return (profit / spend) * 100;
}

function computeAverageMemberEvi(team) {
  const values = (team?.members || [])
    .map((member) => Number(member?.r2_evi))
    .filter((value) => Number.isFinite(value));
  if (values.length) {
    return values.reduce((sum, value) => sum + value, 0) / values.length;
  }
  const teamEvi = Number(team?.r2?.evi);
  return Number.isFinite(teamEvi) ? teamEvi : null;
}

function computeUnitEconomics(team) {
  const price = Number(team?.r2?.price);
  const dCOGS = Number(team?.r2?.dCOGS);
  if (!Number.isFinite(price) || !Number.isFinite(dCOGS)) return null;
  const feeRate = getChannelFeeRate(team);
  const channelFee = price * feeRate;
  const netPrice = price - channelFee;
  const nrePerUnit = computeNrePerUnit(team);
  const V = 2000;
  return {
    feeRate,
    price,
    channelFee,
    netPrice,
    V,
    dCOGS,
    nrePerUnit,
    unitProfit: Number.isFinite(nrePerUnit) ? netPrice - V - dCOGS - nrePerUnit : null
  };
}

function getPricingQuality(ratio) {
  if (!Number.isFinite(Number(ratio))) {
    return { label: "—", color: "#64748b", fill: "#cbd5e1" };
  }
  if (ratio < 0.5) return { label: "定价严重不足", color: "#dc2626", fill: "#ef4444" };
  if (ratio < 0.65) return { label: "偏低", color: "#d97706", fill: "#f59e0b" };
  if (ratio <= 0.85) return { label: "甜点区间", color: "#059669", fill: "#10b981" };
  if (ratio <= 1.1) return { label: "偏高", color: "#d97706", fill: "#f59e0b" };
  return { label: "超WTP", color: "#dc2626", fill: "#ef4444" };
}

function computePricingBreakdown(team) {
  const price = Number(team?.r2?.price);
  const dCOGS = Number(team?.r2?.dCOGS);
  const wtpAdj = Number(team?.r1?.wtpAdj);
  if (!Number.isFinite(price) || price <= 0 || !Number.isFinite(dCOGS)) return null;

  const feeRate = getChannelFeeRate(team);
  const V = 2000;
  const channelPct = feeRate * 100;
  const vPct = (V / price) * 100;
  const dcogsPct = (dCOGS / price) * 100;
  const marginPct = 100 - channelPct - vPct - dcogsPct;
  const actualMargin = price * (1 - feeRate) - V - dCOGS;
  const ratio = wtpAdj > 0 ? price / wtpAdj : null;
  const wtp72Price = Number.isFinite(wtpAdj) ? wtpAdj * 0.72 : null;
  const wtp72Margin = Number.isFinite(wtp72Price) ? wtp72Price * (1 - feeRate) - V - dCOGS : null;
  const diff = Number.isFinite(wtp72Margin) ? wtp72Margin - actualMargin : null;
  const netPrice = price * (1 - feeRate);
  const channel = feeRate === 0.15 ? "ToB" : "ToC";
  const totalForBar = marginPct >= 0
    ? 100
    : channelPct + vPct + dcogsPct + Math.abs(marginPct);

  return {
    team,
    price,
    dCOGS,
    wtpAdj,
    feeRate,
    channel,
    V,
    channelPct,
    vPct,
    dcogsPct,
    marginPct,
    actualMargin,
    ratio,
    wtp72Price,
    wtp72Margin,
    diff,
    netPrice,
    totalForBar
  };
}

function getPricingCounterfactualLabel(ratio) {
  const value = Number(ratio);
  if (!Number.isFinite(value)) return { label: "—", color: "#64748b" };
  if (value < 0.5) return { label: "⚠ 严重低定", color: "#EF4444" };
  if (value < 0.65) return { label: "偏低——有提价空间", color: "#F59E0B" };
  if (value <= 0.85) return { label: "✓ 甜点区间", color: "#10B981" };
  if (value <= 1.1) return { label: "偏高", color: "#F59E0B" };
  return { label: "超WTP（靠尾部用户）", color: "#EF4444" };
}

function buildPriceGroups(teams) {
  const grouped = new Map();
  (teams || []).forEach((team) => {
    const price = Number(team?.r2?.price);
    if (!Number.isFinite(price)) return;
    const key = Math.round(price);
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(team);
  });
  return Array.from(grouped.entries())
    .map(([price, groupedTeams]) => ({
      price: Number(price),
      teams: groupedTeams,
      count: groupedTeams.length
    }))
    .sort((a, b) => a.price - b.price);
}

function getProfitMixType(hwProfit, subProfit, totalProfit) {
  if (hwProfit < 0) return "硬件亏损";
  const base = Math.max(Math.abs(totalProfit), 1);
  const subShare = Math.abs(subProfit) / base;
  if (subShare >= 0.6) return "订阅驱动";
  if (subShare >= 0.25) return "混合型";
  return "硬件驱动";
}

function getChoiceDisplay(gridLabel, arch) {
  const grid = normalizeGridLabel(gridLabel);
  const archKey = normalizeArchKey(arch);
  return [grid, archKey].filter(Boolean).join(" · ");
}

function isSameChoice(memberChoice, team) {
  return String(memberChoice?.grid || "") === String(team?.r1?.grid || "")
    && normalizeArchKey(memberChoice?.arch) === normalizeArchKey(team?.r1?.arch);
}

function computeActualGm(team) {
  const stored = Number(team?.r2?.actualGm ?? team?.r2?.gm);
  if (Number.isFinite(stored)) return stored;
  const price = Number(team?.r2?.price);
  const dCOGS = Number(team?.r2?.dCOGS);
  if (!Number.isFinite(price) || !Number.isFinite(dCOGS) || price <= 0) return null;
  const f = /ToB|B2B/i.test(String(team?.r1?.grid || "")) ? 0.15 : 0.25;
  return (price * (1 - f) - 2000 - dCOGS) / price;
}

function isSubmittedR2(team) {
  return Number.isFinite(Number(team?.r2?.price)) && Number.isFinite(Number(team?.r2?.profit));
}

function isConsistent(team) {
  return String(team?.r1?.grid || "") && String(team?.r1?.grid || "") === String(team?.r2?.bestGrid || "");
}

function metricColor(value, thresholds) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "#64748b";
  if (n >= thresholds.good) return "#059669";
  if (n >= thresholds.warn) return "#d97706";
  return "#dc2626";
}

function emptyState(title, detail) {
  return (
    <div style={{ ...CARD_STYLE, textAlign: "center", padding: "36px 24px", color: "#64748b" }}>
      <div style={{ fontSize: 16, fontWeight: 900, color: "#0f172a", marginBottom: 8 }}>{title}</div>
      <div style={{ fontSize: 13, lineHeight: 1.7 }}>{detail}</div>
    </div>
  );
}

function sectionTitle(title, detail) {
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ fontSize: 16, fontWeight: 900, color: "#0f172a" }}>{title}</div>
      {detail ? <div style={{ fontSize: 11, color: "#64748b", marginTop: 4 }}>{detail}</div> : null}
    </div>
  );
}

function MetricCard({ label, value, hint, color }) {
  return (
    <div style={{ ...CARD_STYLE, padding: 16 }}>
      <div style={{ fontSize: 28, fontWeight: 900, color }}>{value}</div>
      <div style={{ fontSize: 12, color: "#475569", marginTop: 4 }}>{label}</div>
      {hint ? <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 4 }}>{hint}</div> : null}
    </div>
  );
}

function MiniRadar({ scores, radarScale, size = 120, stroke = "#1a5c3a", fill = "rgba(26,92,58,0.12)" }) {
  const cx = size / 2;
  const cy = size / 2;
  const radius = size * 0.34;
  const tickFontSize = Math.max(8, Math.round(size * 0.052));
  const pointFontSize = Math.max(9, Math.round(size * 0.065));
  const rangeMin = Number(radarScale?.rangeMin);
  const rangeMax = Number(radarScale?.rangeMax);
  const safeRangeMin = Number.isFinite(rangeMin) ? rangeMin : 0;
  const safeRangeMax = Number.isFinite(rangeMax) && rangeMax > safeRangeMin ? rangeMax : safeRangeMin + 10;
  const safeSpan = safeRangeMax - safeRangeMin;
  const tickValues = Array.isArray(radarScale?.tickValues) ? radarScale.tickValues : [];
  const normalize = (value) => Math.max(0, Math.min(1, (value - safeRangeMin) / safeSpan));

  const outer = RADAR_DIMS.map((dim, index) => {
    const angle = (Math.PI * 2 * index) / RADAR_DIMS.length - Math.PI / 2;
    return [cx + radius * Math.cos(angle), cy + radius * Math.sin(angle)];
  });

  const points = RADAR_DIMS.map((dim, index) => {
    const angle = (Math.PI * 2 * index) / RADAR_DIMS.length - Math.PI / 2;
    const score = getRadarScore(scores, dim.key);
    const ratio = normalize(score);
    const x = cx + radius * ratio * Math.cos(angle);
    const y = cy + radius * ratio * Math.sin(angle);
    const labelRadius = radius * 1.32;
    const labelX = cx + labelRadius * Math.cos(angle);
    const labelY = cy + labelRadius * Math.sin(angle);
    const offsetX = labelX > cx + 6 ? 6 : (labelX < cx - 6 ? -6 : 0);
    const offsetY = labelY > cy + 6 ? 8 : (labelY < cy - 6 ? -6 : -8);
    return {
      ...dim,
      score,
      x,
      y,
      labelX: labelX + offsetX,
      labelY: labelY + offsetY,
      textAnchor: labelX > cx + 6 ? "start" : (labelX < cx - 6 ? "end" : "middle")
    };
  });

  return (
    <svg width={size} height={size} overflow="visible" style={{ overflow: "visible" }}>
      <polygon
        points={outer.map(([x, y]) => `${x},${y}`).join(" ")}
        fill="none"
        stroke="#cbd5e1"
        strokeWidth="1"
      />
      {tickValues.map((tick) => {
        const ratio = normalize(tick);
        const y = cy - radius * ratio;
        return (
          <g key={tick}>
            <polygon
              points={outer.map(([x, y]) => `${cx + (x - cx) * ratio},${cy + (y - cy) * ratio}`).join(" ")}
              fill="none"
              stroke="#e2e8f0"
              strokeWidth="1"
            />
            <text x={cx + 4} y={y - 2} fontSize={tickFontSize} fill="#94a3b8">
              {tick}
            </text>
          </g>
        );
      })}
      {outer.map(([x, y], index) => (
        <g key={RADAR_DIMS[index].key}>
          <line x1={cx} y1={cy} x2={x} y2={y} stroke="#e2e8f0" strokeWidth="1" />
        </g>
      ))}
      <polygon points={points.map(({ x, y }) => `${x},${y}`).join(" ")} fill={fill} stroke={stroke} strokeWidth="2" />
      {points.map((point) => (
        <g key={`${point.key}-point`}>
          <circle cx={point.x} cy={point.y} r="2.5" fill={stroke} />
          <text
            x={point.labelX}
            y={point.labelY}
            fontSize={pointFontSize}
            fontWeight="700"
            fill="#0f172a"
            textAnchor={point.textAnchor}
            dominantBaseline="middle"
          >
            {`${point.label} ${formatScore(point.score)}`}
          </text>
        </g>
      ))}
      <text x={cx} y={size + Math.round(size * 0.08)} fontSize={tickFontSize} fill="#94a3b8" textAnchor="middle">
        {`动态区间 ${formatScore(safeRangeMin)} - ${formatScore(safeRangeMax)}`}
      </text>
    </svg>
  );
}

function GridDistribution({ mode, teams }) {
  const cellMap = {};
  const emptyInfo = mode === "personal" ? [] : [];
  teams.forEach((team) => {
    if (mode === "personal") {
      (team?.members || []).forEach((member) => {
        const key = gridCellKeyFromGridId(member?.r1_personal?.grid);
        if (!key) return;
        if (!cellMap[key]) cellMap[key] = [];
        cellMap[key].push({
          id: member.id,
          label: `${team.displayName} ${member.name}`,
          color: team.color,
          arch: getArchDisplay(member?.r1_personal?.arch)
        });
      });
      return;
    }
    const key = gridCellKeyFromGridId(team?.r1?.grid);
    if (!key) return;
    if (!cellMap[key]) cellMap[key] = [];
    cellMap[key].push(team);
  });

  return (
    <div style={CARD_STYLE}>
      {sectionTitle(
        mode === "personal" ? "个人战略选择" : "团队最终定位",
        mode === "personal"
          ? "每个圆点代表一位成员的个人选择，颜色区分小组，符号区分架构。"
          : "VP Coach 讨论后的团队共识，圆圈内为组号。"
      )}
      <div style={{ display: "grid", gridTemplateColumns: "82px repeat(3, 1fr)", gap: 6 }}>
        <div />
        {GRID_COLS.map((col) => (
          <div key={col} style={{ textAlign: "center", fontSize: 11, color: "#64748b", fontWeight: 700 }}>{col}</div>
        ))}
        {GRID_ROWS.map((row) => (
          <div key={row.key} style={{ display: "contents" }}>
            <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", paddingRight: 8, fontSize: 11, color: "#64748b", fontWeight: 700 }}>
              {row.label}
            </div>
            {GRID_COLS.map((col) => {
              const key = `${row.key}|${col}`;
              const list = cellMap[key] || emptyInfo;
              return (
                <div
                  key={key}
                  style={{
                    minHeight: mode === "personal" ? 122 : 110,
                    borderRadius: 16,
                    border: "1px solid #e2e8f0",
                    background: "#f8fafc",
                    padding: 10,
                    position: "relative",
                    display: "flex",
                    flexWrap: "wrap",
                    gap: 8,
                    alignContent: "flex-start"
                  }}
                >
                  {mode === "personal" ? list.map((item) => (
                    <div
                      key={item.id}
                      title={item.label}
                      style={{
                        width: 18,
                        height: 18,
                        borderRadius: 999,
                        background: item.color,
                        color: "#fff",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        fontSize: 10,
                        fontWeight: 900,
                        boxShadow: "0 2px 6px rgba(15,23,42,0.18)"
                      }}
                    >
                      {item.arch.symbol || ""}
                    </div>
                  )) : (
                    list.length ? list.map((team) => {
                      const arch = getArchDisplay(team?.r1?.arch);
                      return (
                        <div key={team.id} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
                          <div
                            title={`${team.displayName} ${normalizeGridLabel(team?.r1?.gridLabel)}`}
                            style={{
                              width: 32,
                              height: 32,
                              borderRadius: 999,
                              background: team.color,
                              color: "#fff",
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                              fontSize: 13,
                              fontWeight: 900,
                              boxShadow: "0 4px 12px rgba(15,23,42,0.18)"
                            }}
                          >
                            {extractTeamNo(team)}
                          </div>
                          <div style={{ fontSize: 10, color: arch.color, fontWeight: 800 }}>{arch.label}</div>
                        </div>
                      );
                    }) : <div style={{ margin: "auto", fontSize: 20, color: "#cbd5e1" }}>—</div>
                  )}
                  <div style={{ position: "absolute", right: 8, bottom: 6, fontSize: 10, color: "#64748b" }}>
                    {list.length || 0}{mode === "personal" ? "人" : "组"}
                  </div>
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

function ConsistencyStats({ teams }) {
  const stats = useMemo(() => {
    const teamDetails = teams.map((team) => {
      const cells = new Set((team?.members || []).map((member) => member?.r1_personal?.grid).filter(Boolean));
      return {
        team,
        distinctCells: cells.size
      };
    });
    const same = teamDetails.filter((item) => item.distinctCells <= 1).length;
    const diff = teamDetails.filter((item) => item.distinctCells > 1).length;
    const max = teamDetails.reduce((best, current) => current.distinctCells > best.distinctCells ? current : best, { distinctCells: 0, team: null });
    return { same, diff, max };
  }, [teams]);

  return (
    <div style={{ ...CARD_STYLE, padding: "14px 16px", background: "#f8fafc" }}>
      <div style={{ fontSize: 13, color: "#334155", lineHeight: 1.8 }}>
        {stats.same} 组全员一致 / {stats.diff} 组有分歧
        {stats.max?.team ? `（最大分歧：${stats.max.team.displayName} 分布在 ${stats.max.distinctCells} 个格子）` : ""}
      </div>
    </div>
  );
}

function SamWtpCard({ teams }) {
  const sorted = teams
    .filter((team) => Number.isFinite(Number(team?.r1?.sam)) || Number.isFinite(Number(team?.r1?.wtpAdj)))
    .slice()
    .sort((a, b) => Number(b?.r1?.sam || 0) - Number(a?.r1?.sam || 0));
  const maxSam = Math.max(1, ...sorted.map((team) => Number(team?.r1?.sam || 0)));
  const maxWtp = Math.max(1, ...sorted.map((team) => Number(team?.r1?.wtpAdj || 0)));

  return (
    <div style={CARD_STYLE}>
      {sectionTitle("SAM × WTP", "每组用自己的颜色，hover 可看完整信息。")}
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {sorted.map((team) => (
          <div key={team.id} title={`${team.displayName} | ${normalizeGridLabel(team?.r1?.gridLabel)} | SAM ${team?.r1?.sam || 0} 亿 | WTP ${formatMoney(team?.r1?.wtpAdj)}`}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 8, marginBottom: 6 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ width: 22, height: 22, borderRadius: 999, background: team.color, color: "#fff", fontSize: 11, fontWeight: 900, display: "inline-flex", alignItems: "center", justifyContent: "center" }}>
                  {extractTeamNo(team)}
                </span>
                <span style={{ fontSize: 12, fontWeight: 800, color: "#0f172a" }}>{team.displayName}</span>
              </div>
              <span style={{ fontSize: 10, color: "#64748b" }}>{normalizeGridLabel(team?.r1?.gridLabel) || "-"}</span>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <div style={{ height: 12, background: "#f1f5f9", borderRadius: 999, overflow: "hidden" }}>
                <div style={{ width: `${(Number(team?.r1?.sam || 0) / maxSam) * 100}%`, height: "100%", background: team.color }} />
              </div>
              <div style={{ height: 12, background: "#f1f5f9", borderRadius: 999, overflow: "hidden" }}>
                <div style={{ width: `${(Number(team?.r1?.wtpAdj || 0) / maxWtp) * 100}%`, height: "100%", background: team.color, opacity: 0.82 }} />
              </div>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 4 }}>
              <span style={{ fontSize: 10, color: "#64748b" }}>SAM {Number(team?.r1?.sam || 0)} 亿</span>
              <span style={{ fontSize: 10, color: "#64748b" }}>WTP {formatMoney(team?.r1?.wtpAdj)}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function VpScoresCard({ teams }) {
  const sorted = teams.slice().sort((a, b) => Number(b?.r1?.vpFinalScore || b?.r1?.VPscore || 0) - Number(a?.r1?.vpFinalScore || a?.r1?.VPscore || 0));
  return (
    <div style={CARD_STYLE}>
      {sectionTitle("VP 评分图", "按 VP 最终分排序，显示从初始分到最终分的改进。")}
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {sorted.map((team) => {
          const initial = Number(team?.r1?.vpInitialScore);
          const finalScore = Number(team?.r1?.vpFinalScore ?? team?.r1?.VPscore);
          const improvement = Number(team?.r1?.vpImprovementPct);
          const width = Math.max(8, (Number.isFinite(finalScore) ? (finalScore / 5) * 100 : 0));
          return (
            <div key={team.id} style={{ border: "1px solid #e2e8f0", borderRadius: 14, padding: "12px 14px" }}>
              <div style={{ display: "grid", gridTemplateColumns: "160px 1fr auto", gap: 12, alignItems: "center" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ width: 24, height: 24, borderRadius: 999, background: team.color, color: "#fff", fontSize: 11, fontWeight: 900, display: "inline-flex", alignItems: "center", justifyContent: "center" }}>
                    {extractTeamNo(team)}
                  </span>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 900, color: "#0f172a" }}>{team.displayName}</div>
                    <div style={{ fontSize: 10, color: "#64748b" }}>{normalizeGridLabel(team?.r1?.gridLabel)}</div>
                  </div>
                </div>
                <div>
                  <div style={{ height: 12, borderRadius: 999, background: "#f1f5f9", overflow: "hidden" }}>
                    <div style={{ width: `${width}%`, height: "100%", background: team.color }} />
                  </div>
                  <div style={{ marginTop: 6, fontSize: 11, color: "#475569" }}>
                    {Number.isFinite(initial) ? formatScore(initial) : "-"} → {Number.isFinite(finalScore) ? formatScore(finalScore) : "-"}
                    {" "}
                    {Number.isFinite(improvement) ? (
                      <span style={{ color: improvement >= 0 ? "#059669" : "#dc2626", fontWeight: 800 }}>
                        ({improvement >= 0 ? "+" : ""}{improvement}%)
                      </span>
                    ) : null}
                  </div>
                </div>
                <div style={{ textAlign: "right", fontSize: 12, color: "#334155", fontWeight: 800 }}>
                  C/G/E {formatScore(team?.r1?.C)}/{formatScore(team?.r1?.G)}/{formatScore(team?.r1?.E)}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function VPIterationTimeline({ iterations, loading }) {
  if (loading) {
    return <div style={{ fontSize: 12, color: "#64748b" }}>正在读取 VP 迭代历程...</div>;
  }
  if (!iterations?.length) {
    return <div style={{ fontSize: 12, color: "#64748b" }}>当前没有可用的 VP 迭代记录。</div>;
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {iterations.map((item) => {
        const delta = Number(item?.scoreAfter) - Number(item?.scoreBefore);
        return (
          <div key={`${item.round}-${item.timestamp || "na"}`} style={{ paddingLeft: 16, borderLeft: "3px solid #cbd5e1" }}>
            <div style={{ fontSize: 12, fontWeight: 900, color: "#0f172a" }}>
              Round {item.round}
              {" | "}
              发言人：{item?.speaker || "团队成员"}
              {item?.persona ? `（${item.persona}）` : ""}
              {" | "}
              {Number.isFinite(Number(item?.scoreBefore)) ? formatScore(item.scoreBefore) : "-"} → {formatScore(item?.scoreAfter)}
              {" "}
              <span style={{ color: delta >= 0 ? "#059669" : "#dc2626" }}>
                {Number.isFinite(delta) ? (delta >= 0 ? "↑" : "↓") : ""}
              </span>
            </div>
            <div style={{ fontSize: 11, color: "#64748b", marginTop: 4 }}>
              C/G/E {formatScore(item?.scoreC)}/{formatScore(item?.scoreG)}/{formatScore(item?.scoreE)}
            </div>
            <div style={{ fontSize: 12, color: "#334155", lineHeight: 1.7, marginTop: 6 }}>
              {item?.note || "这一轮没有额外注释。"}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function Round1DetailAccordion({ teams, teacherCode, sessionId }) {
  const [expandedTeamId, setExpandedTeamId] = useState("");
  const [iterationsByTeam, setIterationsByTeam] = useState({});
  const [loadingByTeam, setLoadingByTeam] = useState({});

  const handleToggle = async (teamId) => {
    const next = expandedTeamId === teamId ? "" : teamId;
    setExpandedTeamId(next);
    if (!next || iterationsByTeam[teamId] || loadingByTeam[teamId]) return;
    setLoadingByTeam((prev) => ({ ...prev, [teamId]: true }));
    try {
      const out = await getTeacherVpIterations(teacherCode, teamId, sessionId);
      setIterationsByTeam((prev) => ({ ...prev, [teamId]: out.iterations || [] }));
    } catch (_) {
      setIterationsByTeam((prev) => ({ ...prev, [teamId]: [] }));
    } finally {
      setLoadingByTeam((prev) => ({ ...prev, [teamId]: false }));
    }
  };

  return (
    <div style={CARD_STYLE}>
      {sectionTitle("Round 1 小组明细", "展开可看 VP Coach 迭代与成员锦囊匹配。")}
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {teams.map((team) => {
          const expanded = expandedTeamId === team.id;
          const arch = getArchDisplay(team?.r1?.arch);
          return (
            <div key={team.id} style={{ border: "1px solid #e2e8f0", borderRadius: 16, overflow: "hidden" }}>
              <button
                type="button"
                onClick={() => handleToggle(team.id)}
                style={{
                  width: "100%",
                  border: "none",
                  background: expanded ? "#f8fafc" : "#fff",
                  padding: "14px 16px",
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  gap: 12,
                  cursor: "pointer"
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 10, textAlign: "left" }}>
                  <span style={{ width: 26, height: 26, borderRadius: 999, background: team.color, color: "#fff", display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 900 }}>
                    {extractTeamNo(team)}
                  </span>
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 900, color: "#0f172a" }}>
                      {team.displayName} | {normalizeGridLabel(team?.r1?.gridLabel)} | <span style={{ color: arch.color }}>{arch.label}</span>
                    </div>
                    <div style={{ fontSize: 11, color: "#64748b", marginTop: 4 }}>
                      VP: {formatScore(team?.r1?.vpInitialScore)} → {formatScore(team?.r1?.vpFinalScore || team?.r1?.VPscore)}
                      {" "}
                      <span style={{ color: Number(team?.r1?.vpImprovementPct) >= 0 ? "#059669" : "#dc2626", fontWeight: 800 }}>
                        ({Number.isFinite(Number(team?.r1?.vpImprovementPct)) ? `${Number(team.r1.vpImprovementPct) >= 0 ? "+" : ""}${Number(team.r1.vpImprovementPct)}%` : "-"})
                      </span>
                    </div>
                  </div>
                </div>
                <div style={{ fontSize: 12, color: "#1a5c3a", fontWeight: 800 }}>{expanded ? "收起" : "展开"}</div>
              </button>
              {expanded ? (
                <div style={{ borderTop: "1px solid #e2e8f0", padding: 16, display: "grid", gap: 16 }}>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 10 }}>
                    {[
                      { label: "C/G/E", value: `${formatScore(team?.r1?.C)}/${formatScore(team?.r1?.G)}/${formatScore(team?.r1?.E)}` },
                      { label: "最佳分", value: formatScore(team?.r1?.vpBestScore) },
                      { label: "迭代次数", value: Number(team?.r1?.vpIterations || 0) },
                      { label: "是否用最佳版本", value: team?.r1?.vpUsedBest ? "是" : "否" }
                    ].map((item) => (
                      <div key={item.label} style={{ padding: "10px 12px", borderRadius: 12, background: "#f8fafc", border: "1px solid #e2e8f0" }}>
                        <div style={{ fontSize: 10, color: "#94a3b8" }}>{item.label}</div>
                        <div style={{ fontSize: 14, fontWeight: 900, color: "#0f172a", marginTop: 3 }}>{item.value}</div>
                      </div>
                    ))}
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "1.1fr 0.9fr", gap: 16 }}>
                    <div style={{ padding: "14px 16px", borderRadius: 14, background: "#f8fafc", border: "1px solid #e2e8f0" }}>
                      <div style={{ fontSize: 13, fontWeight: 900, color: "#0f172a", marginBottom: 10 }}>VP Coach 迭代历程</div>
                      <VPIterationTimeline iterations={iterationsByTeam[team.id] || team?.vpTimeline || []} loading={loadingByTeam[team.id]} />
                    </div>
                    <div style={{ padding: "14px 16px", borderRadius: 14, background: "#fff", border: "1px solid #e2e8f0" }}>
                      <div style={{ fontSize: 13, fontWeight: 900, color: "#0f172a", marginBottom: 10 }}>价值主张摘要</div>
                      <div style={{ fontSize: 12, color: "#334155", lineHeight: 1.8 }}>
                        <div><strong>WHO：</strong>{team?.r1?.who || "-"}</div>
                        <div><strong>PAIN：</strong>{team?.r1?.pain || "-"}</div>
                        <div><strong>HOW：</strong>{team?.r1?.how || "-"}</div>
                      </div>
                    </div>
                  </div>
                  <div style={{ overflowX: "auto" }}>
                    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                      <thead>
                        <tr style={{ background: "#f8fafc", color: "#64748b" }}>
                          {["成员", "个人格子", "架构", "市场锦囊", "匹配度", "技术锦囊", "匹配度"].map((label) => (
                            <th key={label} style={{ padding: "9px 10px", textAlign: "left", borderBottom: "1px solid #e2e8f0" }}>{label}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {(team?.members || []).map((member) => {
                          const memberArch = getArchDisplay(member?.r1_personal?.arch);
                          return (
                            <tr key={member.id}>
                              <td style={{ padding: "10px", borderBottom: "1px solid #e2e8f0", fontWeight: 800, color: "#0f172a" }}>{member.name}</td>
                              <td style={{ padding: "10px", borderBottom: "1px solid #e2e8f0", color: "#475569" }}>{normalizeGridLabel(member?.r1_personal?.gridLabel) || "-"}</td>
                              <td style={{ padding: "10px", borderBottom: "1px solid #e2e8f0", color: memberArch.color, fontWeight: 800 }}>{memberArch.label}</td>
                              <td style={{ padding: "10px", borderBottom: "1px solid #e2e8f0", color: "#475569" }}>{member?.jinang_market || "-"}</td>
                              <td style={{ padding: "10px", borderBottom: "1px solid #e2e8f0", color: "#475569" }}>{formatPercent(member?.jinang_market_match, 0)}</td>
                              <td style={{ padding: "10px", borderBottom: "1px solid #e2e8f0", color: "#475569" }}>{member?.jinang_tech || "-"}</td>
                              <td style={{ padding: "10px", borderBottom: "1px solid #e2e8f0", color: "#475569" }}>{formatPercent(member?.jinang_tech_match, 0)}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function WinnersCard({ teams }) {
  const topTeams = teams.slice(0, 3);
  const medals = ["冠军", "亚军", "季军"];
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 14 }}>
      {topTeams.map((team, index) => (
        <div key={team.id} style={{ ...CARD_STYLE, borderLeft: `6px solid ${team.color}`, paddingLeft: 16 }}>
          <div style={{ fontSize: 11, fontWeight: 900, color: team.color }}>{medals[index]}</div>
          <div style={{ fontSize: 20, fontWeight: 900, color: "#0f172a", marginTop: 6 }}>{team.displayName}</div>
          <div style={{ fontSize: 11, color: "#64748b", marginTop: 4 }}>{normalizeGridLabel(team?.r1?.gridLabel)}</div>
          <div style={{ fontSize: 12, color: "#334155", lineHeight: 1.7, marginTop: 10 }}>
            {clipText(`${team?.r1?.who || ""} ${team?.r1?.pain || ""}`, 50)}
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 10, marginTop: 14 }}>
            <div>
              <div style={{ fontSize: 10, color: "#94a3b8" }}>利润</div>
              <div style={{ fontSize: 18, fontWeight: 900, color: Number(team?.r2?.profit || 0) >= 0 ? "#166534" : "#dc2626" }}>{formatWan(team?.r2?.profit)}</div>
            </div>
            <div>
              <div style={{ fontSize: 10, color: "#94a3b8" }}>销量</div>
              <div style={{ fontSize: 18, fontWeight: 900, color: "#0f172a" }}>{Number(team?.r2?.units || 0).toLocaleString()}</div>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function StrategicMapCard({ teams }) {
  const cellMap = {};
  teams.forEach((team) => {
    const r1Key = gridCellKeyFromGridId(team?.r1?.grid);
    if (r1Key) {
      if (!cellMap[r1Key]) cellMap[r1Key] = { r1: [], r2: [] };
      cellMap[r1Key].r1.push(team);
    }
    const r2Key = gridCellKeyFromGridId(team?.r2?.bestGrid);
    if (r2Key) {
      if (!cellMap[r2Key]) cellMap[r2Key] = { r1: [], r2: [] };
      cellMap[r2Key].r2.push(team);
    }
  });

  return (
    <div style={CARD_STYLE}>
      {sectionTitle("战略地图复盘", "R2 列按 best_grid 统计，不再沿用 Round 1 最终格子。")}
      <div style={{ display: "grid", gridTemplateColumns: "82px repeat(3, 1fr)", gap: 6 }}>
        <div />
        {GRID_COLS.map((col) => (
          <div key={col} style={{ textAlign: "center", fontSize: 11, color: "#64748b", fontWeight: 700 }}>{col}</div>
        ))}
        {GRID_ROWS.map((row) => (
          <div key={row.key} style={{ display: "contents" }}>
            <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", paddingRight: 8, fontSize: 11, color: "#64748b", fontWeight: 700 }}>
              {row.label}
            </div>
            {GRID_COLS.map((col) => {
              const info = cellMap[`${row.key}|${col}`] || { r1: [], r2: [] };
              return (
                <div key={`${row.key}-${col}`} style={{ minHeight: 98, borderRadius: 14, border: "1px solid #e2e8f0", background: "#fff", padding: 10, display: "grid", gap: 8 }}>
                  <div style={{ fontSize: 10, color: "#64748b" }}>
                    R1: {info.r1.length} | R2: {info.r2.length}
                  </div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                    {info.r2.length ? info.r2.map((team) => (
                      <span key={team.id} title={team.displayName} style={{ width: 22, height: 22, borderRadius: 999, background: team.color, color: "#fff", display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 10, fontWeight: 900 }}>
                        {extractTeamNo(team)}
                      </span>
                    )) : <span style={{ color: "#cbd5e1", fontSize: 18, margin: "auto" }}>—</span>}
                  </div>
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

function ProfitRankingCard({ teams }) {
  const maxAbs = Math.max(1, ...teams.map((team) => Math.abs(Number(team?.r2?.profit || 0))));
  return (
    <div style={CARD_STYLE}>
      {sectionTitle("利润排名", "盈利向右，亏损向左；每组用自己的颜色。")}
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {teams.map((team) => {
          const profit = Number(team?.r2?.profit || 0);
          const ratio = (Math.abs(profit) / maxAbs) * 100;
          const positive = profit >= 0;
          return (
            <div key={team.id}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 8, marginBottom: 4, fontSize: 11 }}>
                <span style={{ color: "#0f172a", fontWeight: 800 }}>{team.displayName} | {normalizeGridLabel(team?.r1?.gridLabel)} | {formatMoney(team?.r2?.price)}</span>
                <span style={{ color: positive ? "#166534" : "#dc2626", fontWeight: 900 }}>{formatWan(profit)}</span>
              </div>
              <div style={{ height: 16, borderRadius: 999, background: "#f1f5f9", position: "relative", overflow: "hidden" }}>
                <div style={{ position: "absolute", left: "50%", top: 0, bottom: 0, width: 1, background: "#cbd5e1" }} />
                {positive ? (
                  <div style={{ position: "absolute", left: "50%", top: 0, bottom: 0, width: `${ratio / 2}%`, background: team.color }} />
                ) : (
                  <div style={{ position: "absolute", right: "50%", top: 0, bottom: 0, width: `${ratio / 2}%`, background: "#dc2626" }} />
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ScatterCard({ teams }) {
  const width = 480;
  const height = 260;
  const padding = 32;
  const prices = teams.map((team) => Number(team?.r2?.price || 0)).filter((n) => Number.isFinite(n));
  const profits = teams.map((team) => Number(team?.r2?.profit || 0)).filter((n) => Number.isFinite(n));
  const units = teams.map((team) => Number(team?.r2?.units || 0)).filter((n) => Number.isFinite(n));
  const minPrice = Math.min(...prices, 0);
  const maxPrice = Math.max(...prices, 1);
  const minProfit = Math.min(...profits, 0);
  const maxProfit = Math.max(...profits, 1);
  const maxUnits = Math.max(...units, 1);
  const mapX = (price) => padding + ((price - minPrice) / Math.max(1, maxPrice - minPrice)) * (width - padding * 2);
  const mapY = (profit) => height - padding - ((profit - minProfit) / Math.max(1, maxProfit - minProfit)) * (height - padding * 2);

  return (
    <div style={CARD_STYLE}>
      {sectionTitle("定价 × 利润 × 销量", "标签显示组名，气泡颜色按组区分。")}
      <svg width="100%" viewBox={`0 0 ${width} ${height}`}>
        <line x1={padding} y1={height - padding} x2={width - padding} y2={height - padding} stroke="#cbd5e1" strokeWidth="1.5" />
        <line x1={padding} y1={padding} x2={padding} y2={height - padding} stroke="#cbd5e1" strokeWidth="1.5" />
        {teams.map((team) => {
          const price = Number(team?.r2?.price || 0);
          const profit = Number(team?.r2?.profit || 0);
          const unitCount = Number(team?.r2?.units || 0);
          const cx = mapX(price);
          const cy = mapY(profit);
          const radius = 9 + (unitCount / maxUnits) * 16;
          return (
            <g key={team.id}>
              <title>{`${team.displayName} | ${normalizeGridLabel(team?.r1?.gridLabel)} | 定价 ${formatMoney(price)} | 利润 ${formatWan(profit)} | 销量 ${unitCount.toLocaleString()}`}</title>
              <circle cx={cx} cy={cy} r={radius} fill={team.color} fillOpacity="0.28" stroke={team.color} strokeWidth="2" />
              <text x={cx} y={cy + 4} textAnchor="middle" fontSize="9" fontWeight="800" fill="#0f172a">
                {team.displayName}
              </text>
            </g>
          );
        })}
        <text x={width / 2} y={height - 4} textAnchor="middle" fontSize="10" fill="#64748b">定价</text>
        <text x="12" y={height / 2} textAnchor="middle" fontSize="10" fill="#64748b" transform={`rotate(-90 12 ${height / 2})`}>利润</text>
      </svg>
    </div>
  );
}

function ReviewAccordion({ teams, reviews, reviewLoading, expandedTeamId, onToggle, radarScale }) {
  return (
    <div style={CARD_STYLE}>
      {sectionTitle("逐组 AI 复盘", "展开后会调用后端生成单组点评，并展示经营数据。")}
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {teams.map((team) => {
          const review = reviews[team.id];
          const gm = computeActualGm(team);
          const expanded = expandedTeamId === team.id;
          return (
            <div key={team.id} style={{ border: "1px solid #e2e8f0", borderRadius: 14, overflow: "hidden" }}>
              <button
                type="button"
                onClick={() => onToggle(team.id)}
                style={{
                  width: "100%",
                  padding: "14px 16px",
                  border: "none",
                  background: expanded ? "#f8fafc" : "#fff",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 12,
                  cursor: "pointer"
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 10, textAlign: "left" }}>
                  <span style={{ width: 24, height: 24, borderRadius: 999, background: team.color, color: "#fff", display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 900 }}>
                    {extractTeamNo(team)}
                  </span>
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 900, color: "#0f172a" }}>{team.displayName}</div>
                    <div style={{ fontSize: 11, color: "#64748b", marginTop: 4 }}>
                      {normalizeGridLabel(team?.r1?.gridLabel)} · {formatMoney(team?.r2?.price)} · {formatWan(team?.r2?.profit)}
                    </div>
                  </div>
                </div>
                <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
                  <div style={{ textAlign: "right" }}>
                    <div style={{ fontSize: 11, color: "#94a3b8" }}>实际毛利率</div>
                    <div style={{ fontSize: 12, fontWeight: 800, color: metricColor(gm, { good: 0.3, warn: 0.2 }) }}>{formatPercent(gm)}</div>
                  </div>
                  <div style={{ fontSize: 12, color: "#1a5c3a", fontWeight: 800 }}>{expanded ? "收起" : "展开"}</div>
                </div>
              </button>
              {expanded ? (
                <div style={{ borderTop: "1px solid #e2e8f0", padding: 16 }}>
                  <div style={{ display: "grid", gridTemplateColumns: "1.3fr 0.7fr", gap: 16 }}>
                    <div>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 12 }}>
                        {[
                          { label: "定价", value: formatMoney(team?.r2?.price) },
                          { label: "销量", value: Number(team?.r2?.units || 0).toLocaleString() },
                          { label: "利润", value: formatWan(team?.r2?.profit) },
                          { label: "硬件利润", value: formatWan(team?.r2?.profitHw) },
                          { label: "订阅利润", value: formatWan(team?.r2?.profitSub) },
                          { label: "dCOGS", value: formatMoney(team?.r2?.dCOGS) },
                          { label: "Q", value: Number(team?.r2?.Q || team?.r2?.units || 0).toLocaleString() },
                          { label: "Vscore", value: formatPercent(team?.r2?.vscore) }
                        ].map((item) => (
                          <div key={item.label} style={{ padding: "8px 10px", borderRadius: 10, background: "#f8fafc", border: "1px solid #e2e8f0" }}>
                            <div style={{ fontSize: 10, color: "#94a3b8" }}>{item.label}</div>
                            <div style={{ fontSize: 13, fontWeight: 800, color: "#0f172a", marginTop: 2 }}>{item.value}</div>
                          </div>
                        ))}
                      </div>
                      <div style={{ padding: "12px 14px", borderRadius: 12, background: "#f8fafc", border: "1px solid #e2e8f0" }}>
                        {reviewLoading[team.id] ? (
                          <div style={{ fontSize: 12, color: "#64748b" }}>正在生成 AI 点评...</div>
                        ) : review ? (
                          <>
                            <div style={{ fontSize: 12, fontWeight: 800, color: team.color, marginBottom: 8 }}>{review.insight}</div>
                            <div style={{ fontSize: 13, color: "#334155", lineHeight: 1.8 }}>{review.review}</div>
                          </>
                        ) : (
                          <div style={{ fontSize: 12, color: "#64748b" }}>点击展开后自动生成点评。</div>
                        )}
                      </div>
                      <div style={{ marginTop: 10, fontSize: 11, color: "#64748b", lineHeight: 1.7 }}>
                        <strong style={{ color: "#0f172a" }}>价值主张：</strong>{team?.r1?.vp || "-"}
                      </div>
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 8 }}>
                      <MiniRadar scores={team?.r2?.radar || {}} radarScale={radarScale} size={156} stroke={team.color} fill={`${team.color}20`} />
                      <div style={{ fontSize: 11, color: "#64748b" }}>{normalizeGridLabel(team?.r2?.bestGridLabel || team?.r1?.gridLabel)}</div>
                    </div>
                  </div>
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function CrossCompareCard({ teams, radarScale }) {
  const topTeam = teams[0];
  const bottomTeam = teams[teams.length - 1];
  if (!topTeam || !bottomTeam) return null;
  return (
    <div style={CARD_STYLE}>
      {sectionTitle("冠军 vs 末位", "对比两端团队在能力雷达上的差异。")}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
        {[topTeam, bottomTeam].map((team) => (
          <div key={team.id} style={{ textAlign: "center" }}>
            <div style={{ fontSize: 13, fontWeight: 900, color: "#0f172a" }}>{team.displayName}</div>
            <div style={{ fontSize: 11, color: "#64748b", marginTop: 4 }}>{formatWan(team?.r2?.profit)}</div>
            <div style={{ display: "flex", justifyContent: "center", marginTop: 10 }}>
              <MiniRadar scores={team?.r2?.radar || {}} radarScale={radarScale} size={180} stroke={team.color} fill={`${team.color}20`} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function MarkdownArticle({ text }) {
  const lines = String(text || "").split("\n");
  return (
    <div style={{ ...CARD_STYLE, lineHeight: 1.8, color: "#334155" }}>
      {lines.map((line, index) => {
        const trimmed = line.trim();
        if (!trimmed) return <div key={index} style={{ height: 8 }} />;
        if (trimmed.startsWith("## ")) {
          return (
            <div key={index} style={{ fontSize: 17, fontWeight: 900, color: "#0f172a", marginTop: 8, marginBottom: 6 }}>
              {trimmed.replace(/^##\s+/, "")}
            </div>
          );
        }
        if (/^\d+\.\s+/.test(trimmed)) {
          return (
            <div key={index} style={{ display: "flex", gap: 8, marginBottom: 8 }}>
              <span style={{ fontWeight: 800, color: "#1a5c3a" }}>{trimmed.match(/^\d+\./)?.[0]}</span>
              <span>{trimmed.replace(/^\d+\.\s+/, "")}</span>
            </div>
          );
        }
        if (/^- /.test(trimmed)) {
          return (
            <div key={index} style={{ display: "flex", gap: 8, marginBottom: 6 }}>
              <span style={{ color: "#1a5c3a", fontWeight: 800 }}>•</span>
              <span>{trimmed.replace(/^- /, "")}</span>
            </div>
          );
        }
        return <div key={index} style={{ marginBottom: 8 }}>{trimmed}</div>;
      })}
    </div>
  );
}

function UnitEconomicsCard({ teams }) {
  const rows = teams
    .map((team) => {
      const econ = computeUnitEconomics(team);
      return {
        team,
        econ
      };
    })
    .sort((a, b) => {
      const left = Number(a?.econ?.unitProfit);
      const right = Number(b?.econ?.unitProfit);
      if (!Number.isFinite(left) && !Number.isFinite(right)) return 0;
      if (!Number.isFinite(left)) return 1;
      if (!Number.isFinite(right)) return -1;
      return right - left;
    });

  const missingNre = rows.some((row) => !Number.isFinite(Number(row?.econ?.nrePerUnit)));

  return (
    <div style={CARD_STYLE}>
      {sectionTitle("单台经济性拆解", "每一元售价被谁吃掉了？——从售价到净利的逐层递减")}
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
          <thead>
            <tr style={{ background: "#f8fafc", color: "#64748b" }}>
              {["组", "售价", "渠道费", "到手价", "V", "dCOGS", "NRE/台", "单台净利"].map((label) => (
                <th key={label} style={{ padding: "9px 10px", textAlign: "left", borderBottom: "1px solid #e2e8f0", whiteSpace: "nowrap" }}>{label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map(({ team, econ }) => {
              const unitProfit = Number(econ?.unitProfit);
              return (
                <tr key={team.id}>
                  <td style={{ padding: "10px", borderBottom: "1px solid #e2e8f0", fontWeight: 800, color: team.color }}>{getTeamLabel(team)}</td>
                  <td style={{ padding: "10px", borderBottom: "1px solid #e2e8f0" }}>{formatMoney(econ?.price)}</td>
                  <td style={{ padding: "10px", borderBottom: "1px solid #e2e8f0" }}>
                    {formatMoney(econ?.channelFee)}
                    <span style={{ color: "#94a3b8" }}> ({formatPercent(econ?.feeRate)})</span>
                  </td>
                  <td style={{ padding: "10px", borderBottom: "1px solid #e2e8f0" }}>{formatMoney(econ?.netPrice)}</td>
                  <td style={{ padding: "10px", borderBottom: "1px solid #e2e8f0" }}>{formatMoney(econ?.V)}</td>
                  <td style={{ padding: "10px", borderBottom: "1px solid #e2e8f0" }}>{formatMoney(econ?.dCOGS)}</td>
                  <td style={{ padding: "10px", borderBottom: "1px solid #e2e8f0" }}>
                    {Number.isFinite(Number(econ?.nrePerUnit)) ? formatMoney(econ.nrePerUnit) : "—"}
                  </td>
                  <td style={{ padding: "10px", borderBottom: "1px solid #e2e8f0", color: !Number.isFinite(unitProfit) ? "#64748b" : (unitProfit >= 0 ? "#166534" : "#dc2626"), fontWeight: 900 }}>
                    {Number.isFinite(unitProfit) ? formatMoney(unitProfit) : "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {missingNre ? (
        <div style={{ fontSize: 11, color: "#64748b", marginTop: 10 }}>
          部分组缺少 NRE 字段，相关单台净利按占位显示。
        </div>
      ) : null}
    </div>
  );
}

function PricingQualityCard({ teams }) {
  const rows = teams
    .map((team) => {
      const price = Number(team?.r2?.price);
      const wtp = Number(team?.r1?.wtpAdj);
      const ratio = price > 0 && wtp > 0 ? price / wtp : null;
      return { team, price, wtp, ratio };
    })
    .filter((item) => Number.isFinite(Number(item.ratio)))
    .sort((a, b) => a.ratio - b.ratio);

  const scaleMax = Math.max(1.2, ...rows.map((row) => Number(row.ratio || 0)));
  const sweetMin = (0.65 / scaleMax) * 100;
  const sweetMax = (0.85 / scaleMax) * 100;

  return (
    <div style={CARD_STYLE}>
      {sectionTitle("定价决策质量", "P/WTP 比率——你用了多少支付意愿空间？")}
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {rows.map(({ team, price, wtp, ratio }) => {
          const quality = getPricingQuality(ratio);
          const width = Math.min(ratio, scaleMax) / scaleMax * 100;
          const prefix = quality.label === "甜点区间" ? "✓ " : (quality.label.includes("严重") || quality.label.includes("超") ? "⚠ " : "");
          return (
            <div key={team.id} style={{ border: "1px solid #e2e8f0", borderRadius: 14, padding: "12px 14px" }}>
              <div style={{ display: "grid", gridTemplateColumns: "180px 1fr auto", gap: 12, alignItems: "center" }}>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 900, color: team.color }}>{getTeamLabel(team)}</div>
                  <div style={{ fontSize: 11, color: "#64748b", marginTop: 4 }}>{formatMoney(price)} / {formatMoney(wtp)}</div>
                </div>
                <div>
                  <div style={{ position: "relative", height: 18, background: "#e5e7eb", borderRadius: 999, overflow: "hidden" }}>
                    <div style={{ position: "absolute", left: `${sweetMin}%`, top: 0, bottom: 0, borderLeft: "2px dashed #94a3b8" }} />
                    <div style={{ position: "absolute", left: `${sweetMax}%`, top: 0, bottom: 0, borderLeft: "2px dashed #94a3b8" }} />
                    <div style={{ width: `${width}%`, height: "100%", background: quality.fill, borderRadius: 999 }} />
                  </div>
                  <div style={{ fontSize: 10, color: "#94a3b8", marginTop: 4 }}>甜点区间 65%-85%</div>
                </div>
                <div style={{ textAlign: "right" }}>
                  <div style={{ fontSize: 13, fontWeight: 900, color: quality.color }}>{formatPercent(ratio, 0)}</div>
                  <div style={{ fontSize: 11, color: quality.color, fontWeight: 800, marginTop: 4 }}>{prefix}{quality.label}</div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ProfitMixCard({ teams }) {
  const rows = teams
    .map((team) => {
      const hwProfit = Number(team?.r2?.profitHw || 0);
      const subProfit = Number(team?.r2?.profitSub || 0);
      const totalProfit = Number(team?.r2?.profit || 0);
      return {
        team,
        hwProfit,
        subProfit,
        totalProfit,
        type: getProfitMixType(hwProfit, subProfit, totalProfit)
      };
    })
    .sort((a, b) => b.totalProfit - a.totalProfit);

  const scaleMax = Math.max(1, ...rows.map((row) => Math.abs(row.hwProfit) + Math.abs(row.subProfit)));

  return (
    <div style={CARD_STYLE}>
      {sectionTitle("利润来源拆分", "硬件赚的还是订阅赚的？")}
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {rows.map(({ team, hwProfit, subProfit, totalProfit, type }) => {
          const hwWidth = Math.abs(hwProfit) / scaleMax * 50;
          const subWidth = Math.abs(subProfit) / scaleMax * 50;
          const hwShare = Math.abs(totalProfit) > 0 && hwProfit >= 0 ? (hwProfit / Math.abs(totalProfit)) * 100 : null;
          const subShare = Math.abs(totalProfit) > 0 && subProfit >= 0 ? (subProfit / Math.abs(totalProfit)) * 100 : null;
          return (
            <div key={team.id} style={{ border: "1px solid #e2e8f0", borderRadius: 14, padding: "12px 14px" }}>
              <div style={{ display: "grid", gridTemplateColumns: "120px 1fr auto", gap: 12, alignItems: "center" }}>
                <div style={{ fontSize: 13, fontWeight: 900, color: team.color }}>{getTeamLabel(team)}</div>
                <div>
                  <div style={{ height: 16, borderRadius: 999, background: "#f1f5f9", position: "relative", overflow: "hidden" }}>
                    <div style={{ position: "absolute", left: "50%", top: 0, bottom: 0, width: 1, background: "#cbd5e1" }} />
                    {hwProfit < 0 ? (
                      <div style={{ position: "absolute", right: "50%", top: 0, bottom: 0, width: `${hwWidth}%`, background: "#dc2626" }} />
                    ) : (
                      <div style={{ position: "absolute", left: "50%", top: 0, bottom: 0, width: `${hwWidth}%`, background: "#2563eb" }} />
                    )}
                    {subProfit > 0 ? (
                      <div
                        style={{
                          position: "absolute",
                          left: `calc(50% + ${hwProfit > 0 ? hwWidth : 0}%)`,
                          top: 0,
                          bottom: 0,
                          width: `${subWidth}%`,
                          background: "#7c3aed"
                        }}
                      />
                    ) : null}
                  </div>
                  <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginTop: 6, fontSize: 11 }}>
                    <span style={{ color: hwProfit >= 0 ? "#2563eb" : "#dc2626", fontWeight: 800 }}>
                      硬件 {formatWan(hwProfit)}{Number.isFinite(hwShare) ? ` (${formatPercentNumber(hwShare, 0)})` : ""}
                    </span>
                    <span style={{ color: "#7c3aed", fontWeight: 800 }}>
                      订阅 {formatWan(subProfit)}{Number.isFinite(subShare) ? ` (${formatPercentNumber(subShare, 0)})` : ""}
                    </span>
                  </div>
                </div>
                <div style={{ textAlign: "right" }}>
                  <div style={{ fontSize: 12, fontWeight: 900, color: Number(totalProfit) >= 0 ? "#166534" : "#dc2626" }}>{formatWan(totalProfit)}</div>
                  <div style={{ fontSize: 11, color: "#64748b", marginTop: 4 }}>{type}</div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ChannelFeeErosionCard({ teams }) {
  const rows = teams
    .map((team) => {
      const feeRate = getChannelFeeRate(team);
      const totalChannelFee = Number(team?.r2?.price || 0) * feeRate * Number(team?.r2?.units || 0);
      return { team, feeRate, totalChannelFee };
    })
    .filter((item) => Number.isFinite(item.totalChannelFee));

  const tocRows = rows.filter((item) => item.feeRate === 0.25).sort((a, b) => b.totalChannelFee - a.totalChannelFee);
  const tobRows = rows.filter((item) => item.feeRate === 0.15).sort((a, b) => b.totalChannelFee - a.totalChannelFee);
  const avgToc = tocRows.length ? tocRows.reduce((sum, row) => sum + row.totalChannelFee, 0) / tocRows.length : 0;
  const avgTob = tobRows.length ? tobRows.reduce((sum, row) => sum + row.totalChannelFee, 0) / tobRows.length : 0;
  const delta = avgToc - avgTob;

  const renderColumn = (title, items) => (
    <div style={{ ...CARD_STYLE, padding: 16, background: "#f8fafc" }}>
      <div style={{ fontSize: 14, fontWeight: 900, color: "#0f172a" }}>{title}</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 12 }}>
        {items.map(({ team, totalChannelFee }) => {
          const profit = Number(team?.r2?.profit || 0);
          const note = profit < 0 && totalChannelFee > Math.abs(profit) ? "渠道费比亏损还大" : "";
          return (
            <div key={team.id} style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "baseline" }}>
              <div style={{ fontSize: 12, fontWeight: 800, color: team.color }}>{getTeamLabel(team)}</div>
              <div style={{ textAlign: "right" }}>
                <div style={{ fontSize: 12, fontWeight: 900, color: "#0f172a" }}>{formatWan(totalChannelFee)}</div>
                {note ? <div style={{ fontSize: 10, color: "#b45309" }}>{note}</div> : null}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );

  return (
    <div style={CARD_STYLE}>
      {sectionTitle("渠道费侵蚀", "渠道吃掉了多少收入？")}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        {renderColumn("ToC 组（渠道费 25%）", tocRows)}
        {renderColumn("ToB 组（渠道费 15%）", tobRows)}
      </div>
      <div style={{ marginTop: 12, fontSize: 12, color: "#475569", lineHeight: 1.8 }}>
        ToC 组平均渠道费 {formatWan(avgToc)}，ToB 组平均 {formatWan(avgTob)}。10 个百分点的渠道费差距，平均影响利润 {formatWan(delta)}。
      </div>
    </div>
  );
}

function PricingDeepDebriefSection({ teams }) {
  const priceGroups = buildPriceGroups(teams);
  const maxGroupCount = Math.max(1, ...priceGroups.map((item) => item.count));
  const pricingRows = teams
    .map(computePricingBreakdown)
    .filter(Boolean);
  const normalizedBreakdownRows = pricingRows
    .slice()
    .sort((a, b) => b.marginPct - a.marginPct);
  const counterfactualRows = pricingRows
    .slice()
    .sort((a, b) => {
      const left = Number(a.ratio);
      const right = Number(b.ratio);
      if (!Number.isFinite(left) && !Number.isFinite(right)) return 0;
      if (!Number.isFinite(left)) return 1;
      if (!Number.isFinite(right)) return -1;
      return left - right;
    });
  const biggestPriceGroup = priceGroups
    .slice()
    .sort((a, b) => b.count - a.count || a.price - b.price)[0] || null;
  const sharedPriceTeams = biggestPriceGroup && biggestPriceGroup.count >= 3
    ? biggestPriceGroup.teams
        .map((team) => {
          const breakdown = computePricingBreakdown(team);
          const units = Number(team?.r2?.units);
          const profit = Number(team?.r2?.profit);
          const unitMargin = breakdown?.actualMargin ?? null;
          return {
            team,
            breakdown,
            units,
            profit,
            unitMargin
          };
        })
        .sort((a, b) => b.profit - a.profit)
    : [];
  const feeRateCountMap = sharedPriceTeams.reduce((acc, row) => {
    const key = String(row?.breakdown?.feeRate ?? "");
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
  const hasMixedFeeRates = Object.keys(feeRateCountMap).length > 1;
  const maxSharedDcogs = Math.max(-Infinity, ...sharedPriceTeams.map((row) => Number(row?.breakdown?.dCOGS)));
  const maxSharedUnitMargin = Math.max(-Infinity, ...sharedPriceTeams.map((row) => Number(row?.unitMargin)));
  const minSharedUnits = Math.min(Infinity, ...sharedPriceTeams.map((row) => Number(row?.units)));
  const dynamicSubtitle = priceGroups.length === 3
    ? "全班只用了3个价格档位——你们真的做了定价决策吗？"
    : `全班只用了${priceGroups.length}个价格档位——你们真的做了定价决策吗？`;
  const tableHeadStyle = {
    padding: "10px 12px",
    textAlign: "left",
    background: "#0f172a",
    color: "#e2e8f0",
    fontSize: 11,
    fontWeight: 800,
    whiteSpace: "nowrap"
  };
  const tableCellBaseStyle = {
    padding: "10px 12px",
    borderBottom: "1px solid #e2e8f0",
    fontSize: 12,
    color: "#334155",
    verticalAlign: "middle"
  };

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <div style={{ ...CARD_STYLE, padding: 20 }}>
        <div style={{ fontSize: 22, fontWeight: 900, color: "#0f172a" }}>定价深度复盘</div>
        <div style={{ fontSize: 13, color: "#64748b", marginTop: 6 }}>{dynamicSubtitle}</div>
      </div>

      <div style={CARD_STYLE}>
        {sectionTitle("视图 A：价格档位聚类", "全班一共出现了哪些价格点？")}
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {priceGroups.map((group) => (
            <div key={group.price} style={{ display: "grid", gridTemplateColumns: "110px 1fr", gap: 14, alignItems: "center" }}>
              <div style={{ fontSize: 18, fontWeight: 900, color: "#0f172a" }}>{formatMoney(group.price)}</div>
              <div>
                <div style={{ height: 34, borderRadius: 999, background: "#e2e8f0", overflow: "hidden", position: "relative" }}>
                  <div
                    style={{
                      width: `${(group.count / maxGroupCount) * 100}%`,
                      minWidth: 72,
                      height: "100%",
                      borderRadius: 999,
                      background: "#1a5c3a",
                      display: "flex",
                      alignItems: "center",
                      padding: "0 12px",
                      gap: 10,
                      color: "#fff",
                      fontSize: 12,
                      fontWeight: 800,
                      whiteSpace: "nowrap",
                      overflow: "hidden"
                    }}
                  >
                    <span>{group.count}组</span>
                    <span style={{ opacity: 0.92, overflow: "hidden", textOverflow: "ellipsis" }}>
                      {group.teams.map((team) => getTeamLabel(team)).join("、")}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
        <div style={{ marginTop: 14, fontSize: 12, color: "#475569", lineHeight: 1.8 }}>
          {`${teams.length}组只用了${priceGroups.length}个价格档位。定价是模拟中最自由的决策，但大多数团队选了默认值而非深思熟虑。`}
        </div>
      </div>

      <div style={CARD_STYLE}>
        {sectionTitle("视图 B：售价去向拆解", "每元钱去了哪里？渠道、基础成本、研发增量和净利润一眼看清")}
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {normalizedBreakdownRows.map((row) => {
            const segments = [
              { key: "channel", label: "渠道", pct: row.channelPct, color: "#64748B", textColor: "#fff" },
              { key: "v", label: "V", pct: row.vPct, color: "#93C5FD", textColor: "#0f172a" },
              { key: "dcogs", label: "dCOGS", pct: row.dcogsPct, color: "#F59E0B", textColor: "#0f172a" },
              {
                key: "margin",
                label: row.marginPct >= 0 ? "净利" : "亏损",
                pct: Math.abs(row.marginPct),
                color: row.marginPct >= 0 ? "#10B981" : "#EF4444",
                textColor: "#fff",
                valueText: formatSignedPercentNumber(row.marginPct, 0)
              }
            ];
            return (
              <div key={row.team.id} style={{ border: "1px solid #e2e8f0", borderRadius: 14, padding: "12px 14px", background: "#fff" }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "baseline", marginBottom: 8 }}>
                  <div style={{ fontSize: 13, fontWeight: 900, color: row.team.color }}>
                    {getTeamLabel(row.team)}
                    <span style={{ color: "#0f172a", marginLeft: 10 }}>{formatMoney(row.price)}</span>
                  </div>
                  <div style={{ fontSize: 11, color: Number(row.marginPct) >= 0 ? "#166534" : "#dc2626", fontWeight: 800 }}>
                    单台毛利 {formatMoney(row.actualMargin)}
                  </div>
                </div>
                <div style={{ height: 28, borderRadius: 999, overflow: "hidden", background: "#e2e8f0", display: "flex" }}>
                  {segments.map((segment) => {
                    const width = (segment.pct / row.totalForBar) * 100;
                    const label = segment.key === "margin"
                      ? `${segment.label} ${segment.valueText}`
                      : `${segment.label} ${formatPercentNumber(segment.pct, 0)}`;
                    return (
                      <div
                        key={segment.key}
                        title={label}
                        style={{
                          width: `${width}%`,
                          minWidth: width > 0 ? 2 : 0,
                          background: segment.color,
                          color: segment.textColor,
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          fontSize: 11,
                          fontWeight: 800,
                          overflow: "hidden",
                          whiteSpace: "nowrap"
                        }}
                      >
                        {width >= 13 ? label : ""}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div style={CARD_STYLE}>
        {sectionTitle("视图 C：定价反事实", "如果你定在 72% WTP，会怎样？")}
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "separate", borderSpacing: 0 }}>
            <thead>
              <tr>
                {["组", "当前定价", "P/WTP", "单台毛利", "@72%WTP定价", "@72%毛利", "差额", "判断"].map((label) => (
                  <th key={label} style={tableHeadStyle}>{label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {counterfactualRows.map((row, index) => {
                const label = getPricingCounterfactualLabel(row.ratio);
                return (
                  <tr key={row.team.id} style={{ background: index % 2 === 0 ? "#ffffff" : "#f8fafc" }}>
                    <td style={{ ...tableCellBaseStyle, fontWeight: 800, color: row.team.color }}>{getTeamLabel(row.team)}</td>
                    <td style={tableCellBaseStyle}>{formatMoney(row.price)}</td>
                    <td style={tableCellBaseStyle}>{formatPercent(row.ratio, 0)}</td>
                    <td style={{ ...tableCellBaseStyle, color: row.actualMargin >= 0 ? "#166534" : "#dc2626", fontWeight: 800 }}>{formatMoney(row.actualMargin)}</td>
                    <td style={tableCellBaseStyle}>{formatMoney(row.wtp72Price)}</td>
                    <td style={{ ...tableCellBaseStyle, color: Number(row.wtp72Margin) >= 0 ? "#166534" : "#dc2626", fontWeight: 800 }}>{formatMoney(row.wtp72Margin)}</td>
                    <td style={{ ...tableCellBaseStyle, color: Number(row.diff) > 0 ? "#10B981" : "#64748b", fontWeight: 800 }}>{formatMoney(row.diff)}</td>
                    <td style={{ ...tableCellBaseStyle, color: label.color, fontWeight: 900 }}>{label.label}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {sharedPriceTeams.length >= 3 ? (
        <div style={CARD_STYLE}>
          {sectionTitle("视图 D：同价不同命", `价格档位 ${formatMoney(biggestPriceGroup?.price)} 使用最集中：${sharedPriceTeams.length} 组同价竞争`)}
          <div style={{ fontSize: 12, color: "#475569", marginBottom: 12, lineHeight: 1.8 }}>
            {`${sharedPriceTeams.length}组都定了${formatMoney(biggestPriceGroup?.price)}，利润差了很多——价格不是竞争力的全部。`}
          </div>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "separate", borderSpacing: 0 }}>
              <thead>
                <tr>
                  {["组", "渠道", "费率", "到手价", "dCOGS", "单台毛利", "销量", "利润"].map((label) => (
                    <th key={label} style={tableHeadStyle}>{label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sharedPriceTeams.map((row, index) => {
                  const feeRateKey = String(row?.breakdown?.feeRate ?? "");
                  const uniqueFeeRate = hasMixedFeeRates && feeRateCountMap[feeRateKey] === 1;
                  const maxDcogs = Number(row?.breakdown?.dCOGS) === maxSharedDcogs;
                  const maxUnitMargin = Number(row?.unitMargin) === maxSharedUnitMargin;
                  const minUnits = Number(row?.units) === minSharedUnits;
                  return (
                    <tr key={row.team.id} style={{ background: index % 2 === 0 ? "#ffffff" : "#f8fafc" }}>
                      <td style={{ ...tableCellBaseStyle, fontWeight: 800, color: row.team.color }}>{getTeamLabel(row.team)}</td>
                      <td style={tableCellBaseStyle}>{row?.breakdown?.channel}</td>
                      <td style={{ ...tableCellBaseStyle, background: uniqueFeeRate ? "#dbeafe" : undefined, fontWeight: uniqueFeeRate ? 800 : 600 }}>
                        {formatPercent(row?.breakdown?.feeRate)}
                      </td>
                      <td style={tableCellBaseStyle}>{formatMoney(row?.breakdown?.netPrice)}</td>
                      <td style={{ ...tableCellBaseStyle, background: maxDcogs ? "#ffedd5" : undefined, fontWeight: maxDcogs ? 800 : 600 }}>
                        {formatMoney(row?.breakdown?.dCOGS)}
                      </td>
                      <td style={{ ...tableCellBaseStyle, background: maxUnitMargin ? "#dcfce7" : undefined, fontWeight: 800, color: Number(row?.unitMargin) >= 0 ? "#166534" : "#dc2626" }}>
                        {formatMoney(row?.unitMargin)}
                      </td>
                      <td style={{ ...tableCellBaseStyle, background: minUnits ? "#dbeafe" : undefined, fontWeight: minUnits ? 800 : 600 }}>
                        {Number(row?.units || 0).toLocaleString()}
                      </td>
                      <td style={{ ...tableCellBaseStyle, fontWeight: 800, color: Number(row?.profit) >= 0 ? "#166534" : "#dc2626" }}>
                        {formatWan(row?.profit)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div style={{ marginTop: 12, fontSize: 12, color: "#475569", lineHeight: 1.8 }}>
            同样定价 {formatMoney(biggestPriceGroup?.price)}，利润差了很多倍——渠道、成本和市场规模才是定价之外的竞争力。
          </div>
        </div>
      ) : null}
    </div>
  );
}

function Round1DivergenceCard({ teams }) {
  const [expandedTeamId, setExpandedTeamId] = useState("");

  return (
    <div style={CARD_STYLE}>
      {sectionTitle("组内个人选择分歧", "VP Coach 讨论前，每个成员各自选了什么？")}
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {teams.map((team) => {
          const members = (team?.members || []).filter((member) => member?.r1_personal?.grid || member?.r1_personal?.arch);
          const choices = members.map((member) => getChoiceDisplay(member?.r1_personal?.gridLabel || member?.r1_personal?.grid, member?.r1_personal?.arch));
          const distinctCount = new Set(choices.filter(Boolean)).size;
          const consistentCount = members.filter((member) => isSameChoice(member?.r1_personal, team)).length;
          const diffCount = Math.max(members.length - consistentCount, 0);
          const expanded = expandedTeamId === team.id;
          const summary = members.length
            ? `${distinctCount || 1}种选择（${consistentCount}人一致 / ${diffCount}人不同）`
            : "数据加载中";

          return (
            <div key={team.id} style={{ border: "1px solid #e2e8f0", borderRadius: 16, overflow: "hidden" }}>
              <button
                type="button"
                onClick={() => setExpandedTeamId(expanded ? "" : team.id)}
                style={{
                  width: "100%",
                  border: "none",
                  background: expanded ? "#f8fafc" : "#fff",
                  padding: "14px 16px",
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  gap: 12,
                  cursor: "pointer"
                }}
              >
                <div style={{ textAlign: "left" }}>
                  <div style={{ fontSize: 14, fontWeight: 900, color: "#0f172a" }}>
                    {getTeamLabel(team)} {normalizeGridLabel(team?.r1?.gridLabel)}
                  </div>
                  <div style={{ fontSize: 11, color: distinctCount > 1 ? "#b45309" : "#64748b", marginTop: 4, fontWeight: distinctCount > 1 ? 800 : 500 }}>
                    {distinctCount > 1 ? "⚠ " : ""}{summary}
                  </div>
                </div>
                <div style={{ fontSize: 12, color: "#1a5c3a", fontWeight: 800 }}>{expanded ? "收起" : "展开"}</div>
              </button>
              {expanded ? (
                <div style={{ borderTop: "1px solid #e2e8f0", padding: 16, display: "grid", gap: 10 }}>
                  <div style={{ fontSize: 12, color: "#334155" }}>
                    <strong style={{ color: "#0f172a" }}>最终定位：</strong>{getChoiceDisplay(team?.r1?.gridLabel || team?.r1?.grid, team?.r1?.arch) || "-"}
                  </div>
                  {members.length ? members.map((member) => {
                    const same = isSameChoice(member?.r1_personal, team);
                    return (
                      <div key={member.id} style={{ display: "grid", gridTemplateColumns: "24px 180px 1fr auto", gap: 10, alignItems: "center", fontSize: 12 }}>
                        <div style={{ fontWeight: 900, color: same ? "#166534" : "#dc2626" }}>{same ? "✓" : "✕"}</div>
                        <div style={{ fontWeight: 800, color: "#0f172a" }}>{member.name}</div>
                        <div style={{ color: "#475569" }}>{getChoiceDisplay(member?.r1_personal?.gridLabel || member?.r1_personal?.grid, member?.r1_personal?.arch) || "-"}</div>
                        <div style={{ color: same ? "#166534" : "#dc2626", fontWeight: 800 }}>{same ? "一致" : "不同"}</div>
                      </div>
                    );
                  }) : (
                    <div style={{ fontSize: 12, color: "#64748b" }}>数据加载中</div>
                  )}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function VpVsProfitCard({ teams }) {
  const profitSorted = teams.slice().sort((a, b) => Number(b?.r2?.profit || 0) - Number(a?.r2?.profit || 0));
  const profitRankMap = Object.fromEntries(profitSorted.map((team, index) => [team.id, index + 1]));
  const maxVp = Math.max(0, ...teams.map((team) => Number(team?.r1?.vpFinalScore ?? team?.r1?.VPscore ?? 0)));
  const cutoff = Math.ceil(teams.length / 2);

  const rows = teams
    .map((team) => {
      const vp = Number(team?.r1?.vpFinalScore ?? team?.r1?.VPscore ?? 0);
      const profit = Number(team?.r2?.profit || 0);
      const rank = profitRankMap[team.id] || teams.length;
      let tag = "—";
      let severity = 0;
      if (vp >= 4.9 && rank === 1) {
        tag = "✓ VP满分且利润冠军";
        severity = 1;
      } else if (vp >= 4.9 && rank > cutoff) {
        tag = "⚠ VP高但利润靠后";
        severity = 3;
      } else if (vp < maxVp && rank <= 3) {
        tag = "VP不是最高但利润靠前";
        severity = 2;
      }
      return { team, vp, profit, rank, tag, severity };
    })
    .sort((a, b) => (b.severity - a.severity) || (a.rank - b.rank));

  return (
    <div style={CARD_STYLE}>
      {sectionTitle("VP分数 ≠ 利润", "VP 满分的组不一定赚最多——定价和成本控制同样重要")}
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
          <thead>
            <tr style={{ background: "#f8fafc", color: "#64748b" }}>
              {["组", "VP分", "利润", "矛盾标记"].map((label) => (
                <th key={label} style={{ padding: "9px 10px", textAlign: "left", borderBottom: "1px solid #e2e8f0" }}>{label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map(({ team, vp, profit, tag }) => (
              <tr key={team.id}>
                <td style={{ padding: "10px", borderBottom: "1px solid #e2e8f0", fontWeight: 800, color: team.color }}>{getTeamLabel(team)}</td>
                <td style={{ padding: "10px", borderBottom: "1px solid #e2e8f0" }}>{formatScore(vp)}</td>
                <td style={{ padding: "10px", borderBottom: "1px solid #e2e8f0", color: profit >= 0 ? "#166534" : "#dc2626", fontWeight: 800 }}>{formatWan(profit)}</td>
                <td style={{ padding: "10px", borderBottom: "1px solid #e2e8f0", color: tag.includes("⚠") ? "#b45309" : (tag.includes("✓") ? "#166534" : "#475569"), fontWeight: 800 }}>{tag}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div style={{ marginTop: 10, fontSize: 12, color: "#475569", lineHeight: 1.8 }}>
        VP 影响的是 WTPadj（定价天花板），但利润还取决于实际定价、成本控制和渠道选择。好文案 ≠ 好生意。
      </div>
    </div>
  );
}

function InterviewToProfitChainCard({ teams }) {
  const rows = teams
    .map((team) => {
      const avgEvi = computeAverageMemberEvi(team);
      const coverCore = Number(team?.r2?.coverCore);
      const roi = computeRdRoiPct(team);
      let label = "持续优化";
      if (Number.isFinite(avgEvi) && avgEvi < 0.65) label = "⚠ 访谈薄弱";
      else if (Number.isFinite(coverCore) && coverCore < 0.8) label = "⚠ 选卡偏移";
      else if (Number.isFinite(roi) && roi <= 0) label = "⚠ 定价断裂";
      else if (Number.isFinite(avgEvi) && Number.isFinite(coverCore) && Number.isFinite(roi) && avgEvi >= 0.8 && coverCore >= 0.8 && roi >= 80) label = "✓ 全链路健康";
      return {
        team,
        avgEvi,
        coverCore: Number.isFinite(coverCore) ? coverCore : null,
        roi,
        profit: Number(team?.r2?.profit || 0),
        label
      };
    })
    .sort((a, b) => b.profit - a.profit);

  const healthy = rows.filter((row) => Number.isFinite(row.coverCore) && row.coverCore >= 0.8);
  const weaker = rows.filter((row) => Number.isFinite(row.coverCore) && row.coverCore < 0.8);
  const avgHealthyProfit = healthy.length ? healthy.reduce((sum, row) => sum + row.profit, 0) / healthy.length : null;
  const avgWeakerProfit = weaker.length ? weaker.reduce((sum, row) => sum + row.profit, 0) / weaker.length : null;

  const pillStyle = (tone) => ({
    padding: "6px 10px",
    borderRadius: 999,
    fontSize: 11,
    fontWeight: 800,
    background: tone === "green" ? "#dcfce7" : (tone === "orange" ? "#ffedd5" : (tone === "yellow" ? "#fef9c3" : "#fee2e2")),
    color: tone === "green" ? "#166534" : (tone === "orange" ? "#c2410c" : (tone === "yellow" ? "#a16207" : "#b91c1c"))
  });
  const toneForEvi = (value) => !Number.isFinite(value) ? null : (value >= 0.8 ? "green" : (value >= 0.65 ? "orange" : "red"));
  const toneForCover = (value) => !Number.isFinite(value) ? null : (value >= 0.8 ? "green" : (value >= 0.6 ? "orange" : "red"));
  const toneForRoi = (value) => !Number.isFinite(value) ? null : (value >= 80 ? "green" : (value >= 30 ? "orange" : (value > 0 ? "yellow" : "red")));

  return (
    <div style={CARD_STYLE}>
      {sectionTitle("因果链：访谈 → 选卡 → 利润", "访谈做得好的组，选卡更精准，利润更高")}
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {rows.map(({ team, avgEvi, coverCore, roi, profit, label }) => (
          <div key={team.id} style={{ border: "1px solid #e2e8f0", borderRadius: 14, padding: "12px 14px" }}>
            <div style={{ display: "grid", gridTemplateColumns: "90px 1fr auto", gap: 12, alignItems: "center" }}>
              <div style={{ fontSize: 13, fontWeight: 900, color: team.color }}>{getTeamLabel(team)}</div>
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <span style={Number.isFinite(avgEvi) ? pillStyle(toneForEvi(avgEvi)) : { ...pillStyle("orange"), background: "#f1f5f9", color: "#64748b" }}>
                  evi={Number.isFinite(avgEvi) ? avgEvi.toFixed(2) : "—"}
                </span>
                <span style={{ color: "#94a3b8", fontWeight: 800 }}>→</span>
                <span style={Number.isFinite(coverCore) ? pillStyle(toneForCover(coverCore)) : { ...pillStyle("orange"), background: "#f1f5f9", color: "#64748b" }}>
                  coverCore={Number.isFinite(coverCore) ? formatPercent(coverCore, 0) : "—"}
                </span>
                <span style={{ color: "#94a3b8", fontWeight: 800 }}>→</span>
                <span style={Number.isFinite(roi) ? pillStyle(toneForRoi(roi)) : { ...pillStyle("orange"), background: "#f1f5f9", color: "#64748b" }}>
                  dCOGS效率 {Number.isFinite(roi) ? formatPercentNumber(roi, 0) : "—"}
                </span>
                <span style={{ color: "#94a3b8", fontWeight: 800 }}>→</span>
                <span style={{ ...pillStyle(profit >= 0 ? "green" : "red"), background: profit >= 0 ? "#dcfce7" : "#fee2e2" }}>
                  利润 {formatWan(profit)}
                </span>
              </div>
              <div style={{ fontSize: 11, fontWeight: 800, color: label.includes("✓") ? "#166534" : (label.includes("⚠") ? "#b45309" : "#64748b") }}>{label}</div>
            </div>
          </div>
        ))}
      </div>
      <div style={{ marginTop: 10, fontSize: 12, color: "#475569", lineHeight: 1.8 }}>
        coverCore &gt;= 80% 的组平均利润 {avgHealthyProfit == null ? "—" : formatWan(avgHealthyProfit)}，coverCore &lt; 80% 的组平均利润 {avgWeakerProfit == null ? "—" : formatWan(avgWeakerProfit)}。访谈质量影响选卡方向，选卡方向影响产品-市场匹配度。
      </div>
    </div>
  );
}

function RdRoiRankingCard({ teams }) {
  const rows = teams
    .map((team) => ({
      team,
      roi: computeRdRoiPct(team)
    }))
    .sort((a, b) => {
      const left = Number(a.roi);
      const right = Number(b.roi);
      if (!Number.isFinite(left) && !Number.isFinite(right)) return 0;
      if (!Number.isFinite(left)) return 1;
      if (!Number.isFinite(right)) return -1;
      return right - left;
    });

  const maxAbs = Math.max(1, ...rows.map((row) => Math.abs(Number(row.roi || 0))));

  return (
    <div style={CARD_STYLE}>
      {sectionTitle("研发 ROI", "每投入1元研发费，赚回了多少？")}
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {rows.map(({ team, roi }) => {
          const ratio = Number.isFinite(Number(roi)) ? (Math.abs(roi) / maxAbs) * 100 : 0;
          const positive = Number(roi) >= 0;
          const perYuan = Number.isFinite(Number(roi)) ? Math.abs(roi) / 100 : null;
          return (
            <div key={team.id}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 8, marginBottom: 4, fontSize: 11 }}>
                <span style={{ color: team.color, fontWeight: 800 }}>{getTeamLabel(team)}</span>
                <span style={{ color: !Number.isFinite(Number(roi)) ? "#64748b" : (positive ? "#166534" : "#dc2626"), fontWeight: 900 }}>
                  {Number.isFinite(Number(roi)) ? formatPercentNumber(roi, 0) : "—"}
                </span>
              </div>
              <div style={{ height: 16, borderRadius: 999, background: "#f1f5f9", position: "relative", overflow: "hidden" }}>
                <div style={{ position: "absolute", left: "50%", top: 0, bottom: 0, width: 1, background: "#cbd5e1" }} />
                {Number.isFinite(Number(roi)) ? (positive ? (
                  <div style={{ position: "absolute", left: "50%", top: 0, bottom: 0, width: `${ratio / 2}%`, background: "#10b981" }} />
                ) : (
                  <div style={{ position: "absolute", right: "50%", top: 0, bottom: 0, width: `${ratio / 2}%`, background: "#dc2626" }} />
                )) : null}
              </div>
              <div style={{ marginTop: 4, fontSize: 11, color: "#64748b" }}>
                {Number.isFinite(Number(roi))
                  ? (positive ? `每投¥1研发费赚¥${perYuan.toFixed(2)}` : `每投¥1亏¥${perYuan.toFixed(2)}`)
                  : "研发投入口径不足"}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Round1Tab({ teams, teacherCode, sessionId }) {
  if (!teams.length) {
    return emptyState("Round 1 暂无数据", "等团队完成第一轮后，这里会显示个人分布、团队共识和 VP 迭代。");
  }
  return (
    <div style={{ display: "grid", gap: 16 }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 14 }}>
        <MetricCard label="R1 已提交组数" value={teams.filter((team) => team?.r1?.grid).length} color="#1a5c3a" />
        <MetricCard label="差异化占比" value={formatPercent(teams.filter((team) => /差异化/i.test(normalizeGridLabel(team?.r1?.gridLabel))).length / Math.max(1, teams.length))} color="#6366f1" />
        <MetricCard label="平均 SAM" value={`${Math.round(teams.reduce((sum, team) => sum + Number(team?.r1?.sam || 0), 0) / Math.max(1, teams.length))} 亿`} color="#3b82f6" />
        <MetricCard label="平均 WTPadj" value={formatMoney(teams.reduce((sum, team) => sum + Number(team?.r1?.wtpAdj || 0), 0) / Math.max(1, teams.length))} color="#059669" />
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        <GridDistribution mode="personal" teams={teams} />
        <GridDistribution mode="team" teams={teams} />
      </div>
      <ConsistencyStats teams={teams} />
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        <SamWtpCard teams={teams} />
        <VpScoresCard teams={teams} />
      </div>
      <Round1DetailAccordion teams={teams} teacherCode={teacherCode} sessionId={sessionId} />
      <Round1DivergenceCard teams={teams} />
    </div>
  );
}

function Round2Tab({ teams, reviews, reviewLoading, expandedTeamId, onToggle, radarScale }) {
  if (!teams.length) {
    return emptyState("Round 2 尚无有效提交", "目前还没有团队完成 Round 2 提交，等学生提交后这里会自动显示利润、定价和产品力分析。");
  }
  return (
    <div style={{ display: "grid", gap: 16 }}>
      <WinnersCard teams={teams} />
      <div style={{ display: "grid", gridTemplateColumns: "1.05fr 0.95fr", gap: 16 }}>
        <StrategicMapCard teams={teams} />
        <ProfitRankingCard teams={teams} />
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        <ScatterCard teams={teams} />
        <div style={CARD_STYLE}>
          {sectionTitle("研发投入 / 风险 / 毛利", "利润、硬件利润、订阅利润和实际毛利率都走当前 debrief-data 字段。")}
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
              <thead>
                <tr style={{ background: "#f8fafc", color: "#64748b" }}>
                  {["组别", "dCOGS", "风险", "Q", "Vscore", "实际毛利率", "硬件利润", "订阅利润", "总利润"].map((label) => (
                    <th key={label} style={{ padding: "9px 10px", textAlign: "left", borderBottom: "1px solid #e2e8f0" }}>{label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {teams.map((team) => {
                  const gm = computeActualGm(team);
                  return (
                    <tr key={team.id}>
                      <td style={{ padding: "10px", borderBottom: "1px solid #e2e8f0", fontWeight: 800, color: team.color }}>{team.displayName}</td>
                      <td style={{ padding: "10px", borderBottom: "1px solid #e2e8f0" }}>{formatMoney(team?.r2?.dCOGS)}</td>
                      <td style={{ padding: "10px", borderBottom: "1px solid #e2e8f0" }}>{formatPercent(team?.r2?.riskTotal)}</td>
                      <td style={{ padding: "10px", borderBottom: "1px solid #e2e8f0" }}>{Number(team?.r2?.Q || team?.r2?.units || 0).toLocaleString()}</td>
                      <td style={{ padding: "10px", borderBottom: "1px solid #e2e8f0" }}>{formatPercent(team?.r2?.vscore)}</td>
                      <td style={{ padding: "10px", borderBottom: "1px solid #e2e8f0", color: metricColor(gm, { good: 0.3, warn: 0.2 }), fontWeight: 800 }}>{formatPercent(gm)}</td>
                      <td style={{ padding: "10px", borderBottom: "1px solid #e2e8f0" }}>{formatWan(team?.r2?.profitHw)}</td>
                      <td style={{ padding: "10px", borderBottom: "1px solid #e2e8f0" }}>{formatWan(team?.r2?.profitSub)}</td>
                      <td style={{ padding: "10px", borderBottom: "1px solid #e2e8f0", color: Number(team?.r2?.profit || 0) >= 0 ? "#166534" : "#dc2626", fontWeight: 800 }}>{formatWan(team?.r2?.profit)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>
      <UnitEconomicsCard teams={teams} />
      <PricingQualityCard teams={teams} />
      <ProfitMixCard teams={teams} />
      <ChannelFeeErosionCard teams={teams} />
      <VpVsProfitCard teams={teams} />
      <InterviewToProfitChainCard teams={teams} />
      <RdRoiRankingCard teams={teams} />
      <ReviewAccordion teams={teams} reviews={reviews} reviewLoading={reviewLoading} expandedTeamId={expandedTeamId} onToggle={onToggle} radarScale={radarScale} />
      <PricingDeepDebriefSection teams={teams} />
    </div>
  );
}

function CrossTab({ teams, radarScale }) {
  if (!teams.length) {
    return emptyState("暂无跨轮对比数据", "等至少一组完成 Round 2 提交后，这里会显示战略一致性、WTP 与实际定价的差异。");
  }
  const consistentCount = teams.filter(isConsistent).length;
  const driftProfit = teams.filter((team) => !isConsistent(team) && Number(team?.r2?.profit || 0) > 0).length;
  const driftLoss = teams.filter((team) => !isConsistent(team) && Number(team?.r2?.profit || 0) <= 0).length;
  const scaleMax = Math.max(1, ...teams.map((team) => Math.max(Number(team?.r1?.wtpAdj || 0), Number(team?.r2?.price || 0))));

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 14 }}>
        <MetricCard label="战略一致" value={consistentCount} hint={`共 ${teams.length} 个已提交样本`} color="#1a5c3a" />
        <MetricCard label="跑偏但盈利" value={driftProfit} color="#3b82f6" />
        <MetricCard label="跑偏且亏损" value={driftLoss} color="#dc2626" />
      </div>
      <div style={CARD_STYLE}>
        {sectionTitle("逐组一致性分析", "对比 Round 1 最终定位与 Round 2 产品最匹配格子。")}
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {teams.map((team) => (
            <div key={team.id} style={{ display: "grid", gridTemplateColumns: "140px 1fr auto auto", gap: 12, alignItems: "center", padding: "12px 14px", borderRadius: 12, background: "#f8fafc", border: "1px solid #e2e8f0" }}>
              <div style={{ fontSize: 13, fontWeight: 900, color: team.color }}>{team.displayName}</div>
              <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", fontSize: 12 }}>
                <span style={{ padding: "4px 8px", borderRadius: 999, background: "#eef2ff", color: "#4338ca" }}>{normalizeGridLabel(team?.r1?.gridLabel)}</span>
                <span style={{ color: "#94a3b8" }}>→</span>
                <span style={{ padding: "4px 8px", borderRadius: 999, background: isConsistent(team) ? "#dcfce7" : "#fef3c7", color: isConsistent(team) ? "#166534" : "#92400e" }}>
                  {normalizeGridLabel(team?.r2?.bestGridLabel)}
                </span>
              </div>
              <span style={{ fontSize: 11, fontWeight: 800, color: isConsistent(team) ? "#166534" : "#92400e" }}>{isConsistent(team) ? "一致" : "跑偏"}</span>
              <div style={{ fontSize: 13, fontWeight: 900, color: Number(team?.r2?.profit || 0) >= 0 ? "#166534" : "#dc2626" }}>{formatWan(team?.r2?.profit)}</div>
            </div>
          ))}
        </div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        <div style={CARD_STYLE}>
          {sectionTitle("WTPadj vs 实际定价", "蓝条是 Round 1 支付意愿，竖线是 Round 2 实际定价。")}
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {teams.map((team) => (
              <div key={team.id}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 8, marginBottom: 4 }}>
                  <span style={{ fontSize: 12, fontWeight: 700, color: team.color }}>{team.displayName}</span>
                  <span style={{ fontSize: 10, color: "#64748b" }}>{formatMoney(team?.r2?.price)} / {formatMoney(team?.r1?.wtpAdj)}</span>
                </div>
                <div style={{ height: 14, background: "#eff6ff", borderRadius: 999, position: "relative" }}>
                  <div style={{ width: `${(Number(team?.r1?.wtpAdj || 0) / scaleMax) * 100}%`, height: "100%", background: `${team.color}66`, borderRadius: 999 }} />
                  <div style={{ position: "absolute", top: -2, left: `calc(${(Number(team?.r2?.price || 0) / scaleMax) * 100}% - 1px)`, width: 3, height: 18, background: team.color, borderRadius: 999 }} />
                </div>
              </div>
            ))}
          </div>
        </div>
        <CrossCompareCard teams={teams} radarScale={radarScale} />
      </div>
    </div>
  );
}

function DebriefTab({ round, script, loading, onChangeRound, onGenerate, onCopy }) {
  return (
    <div style={{ display: "grid", gap: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {[1, 2].map((value) => (
            <button
              key={value}
              onClick={() => onChangeRound(value)}
              style={{
                padding: "10px 16px",
                borderRadius: 999,
                border: round === value ? "none" : "1px solid #cbd5e1",
                background: round === value ? "#1a5c3a" : "#fff",
                color: round === value ? "#fff" : "#475569",
                fontSize: 12,
                fontWeight: 800,
                cursor: "pointer"
              }}
            >
              {value === 1 ? "Round 1 讲解稿" : "Round 2 讲解稿"}
            </button>
          ))}
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button onClick={onGenerate} disabled={loading} style={{ padding: "10px 16px", borderRadius: 10, border: "none", background: "#1a5c3a", color: "#fff", fontSize: 12, fontWeight: 800, cursor: loading ? "wait" : "pointer" }}>
            {loading ? "生成中..." : script ? "刷新讲解稿" : "生成讲解稿"}
          </button>
          <button onClick={onCopy} disabled={!script} style={{ padding: "10px 16px", borderRadius: 10, border: "1px solid #cbd5e1", background: "#fff", color: "#334155", fontSize: 12, fontWeight: 700, cursor: script ? "pointer" : "not-allowed" }}>
            复制纯文本
          </button>
        </div>
      </div>
      {script ? (
        <MarkdownArticle text={script} />
      ) : (
        emptyState("还没有生成讲解稿", "点击上方按钮后会调用后端 AI 讲解稿接口，结果会在服务端缓存，之后再次进入可直接复用。")
      )}
    </div>
  );
}

function ExportTab({ onExportCsv, onExportJson, teams }) {
  return (
    <div style={{ display: "grid", gap: 16 }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 14 }}>
        <div style={CARD_STYLE}>
          <div style={{ fontSize: 18, marginBottom: 8 }}>CSV</div>
          <div style={{ fontSize: 14, fontWeight: 800, color: "#0f172a" }}>导出复盘数据</div>
          <div style={{ fontSize: 12, color: "#64748b", lineHeight: 1.7, marginTop: 8 }}>
            下载当前教师复盘面板的聚合数据，包括 Round 1、Round 2、利润、毛利率和战略一致性。
          </div>
          <button onClick={onExportCsv} style={{ marginTop: 14, padding: "10px 16px", borderRadius: 10, border: "none", background: "#1a5c3a", color: "#fff", fontSize: 12, fontWeight: 800, cursor: "pointer" }}>
            下载 CSV
          </button>
        </div>
        <div style={CARD_STYLE}>
          <div style={{ fontSize: 18, marginBottom: 8 }}>JSON</div>
          <div style={{ fontSize: 14, fontWeight: 800, color: "#0f172a" }}>导出原始快照</div>
          <div style={{ fontSize: 12, color: "#64748b", lineHeight: 1.7, marginTop: 8 }}>
            继续保留原来的多人模式 JSON 导出，用于排错、审计或二次分析。
          </div>
          <button onClick={onExportJson} style={{ marginTop: 14, padding: "10px 16px", borderRadius: 10, border: "1px solid #cbd5e1", background: "#fff", color: "#334155", fontSize: 12, fontWeight: 800, cursor: "pointer" }}>
            下载 JSON
          </button>
        </div>
      </div>
      <div style={CARD_STYLE}>
        {sectionTitle("已纳入导出的团队", "下面列出当前会进入 CSV 的团队样本。")}
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          {teams.map((team) => (
            <span key={team.id} style={{ padding: "5px 10px", borderRadius: 999, background: `${team.color}18`, color: team.color, fontSize: 11, fontWeight: 800 }}>
              {team.displayName}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

export default function TeacherDebriefTabs({ activeTab, teacherCode, onExportJson }) {
  const [debriefData, setDebriefData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [expandedTeamId, setExpandedTeamId] = useState("");
  const [reviewLoading, setReviewLoading] = useState({});
  const [reviews, setReviews] = useState({});
  const [debriefRound, setDebriefRound] = useState(2);
  const [scripts, setScripts] = useState({});
  const [scriptLoading, setScriptLoading] = useState(false);

  const sessionId = "default";
  const debriefTabs = ["Round 1 复盘", "Round 2 复盘", "跨轮对比", "AI 讲解稿", "导出"];

  const loadDebriefData = async (force = false) => {
    if (!teacherCode) return;
    if (loading) return;
    if (debriefData && !force) return;
    setLoading(true);
    setError("");
    try {
      const data = await getTeacherDebriefData(teacherCode, sessionId);
      setDebriefData(data);
    } catch (err) {
      setError(err.message || "读取教师复盘数据失败");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!teacherCode || !debriefTabs.includes(activeTab)) return;
    loadDebriefData();
  }, [activeTab, teacherCode]);

  const round1Teams = useMemo(
    () => (debriefData?.teams || []).filter((team) => team?.r1?.grid).slice(),
    [debriefData]
  );

  const round2Teams = useMemo(
    () => (debriefData?.teams || []).filter(isSubmittedR2).slice().sort((a, b) => Number(b?.r2?.profit || 0) - Number(a?.r2?.profit || 0)),
    [debriefData]
  );

  const radarScale = useMemo(
    () => computeRadarScale(round2Teams),
    [round2Teams]
  );

  const handleToggleReview = async (teamId) => {
    const next = expandedTeamId === teamId ? "" : teamId;
    setExpandedTeamId(next);
    if (!next || reviews[teamId] || reviewLoading[teamId]) return;
    setReviewLoading((prev) => ({ ...prev, [teamId]: true }));
    try {
      const out = await generateTeacherTeamReview(teacherCode, teamId, sessionId);
      setReviews((prev) => ({ ...prev, [teamId]: out }));
    } catch (err) {
      setReviews((prev) => ({
        ...prev,
        [teamId]: {
          insight: "点评生成失败",
          review: err.message || "生成单组点评失败"
        }
      }));
    } finally {
      setReviewLoading((prev) => ({ ...prev, [teamId]: false }));
    }
  };

  const handleGenerateDebrief = async () => {
    setScriptLoading(true);
    try {
      const out = await generateTeacherDebrief(teacherCode, debriefRound, sessionId);
      setScripts((prev) => ({ ...prev, [debriefRound]: out.text || "" }));
    } catch (err) {
      window.alert(err.message || "生成讲解稿失败");
    } finally {
      setScriptLoading(false);
    }
  };

  const handleCopyScript = async () => {
    const text = scripts[debriefRound];
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      window.alert("已复制到剪贴板");
    } catch (_) {
      window.alert("复制失败，请手动选择文本复制");
    }
  };

  const handleExportCsv = async () => {
    try {
      const out = await downloadTeacherCsv(teacherCode, sessionId);
      const url = URL.createObjectURL(out.blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = out.filename;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      window.alert(err.message || "CSV 导出失败");
    }
  };

  if (loading && !debriefData) {
    return <div style={{ fontSize: 13, color: "#64748b" }}>正在读取教师复盘数据...</div>;
  }

  if (error && !debriefData) {
    return (
      <div style={{ padding: 14, borderRadius: 12, background: "#fef2f2", border: "1px solid #fecaca", color: "#b91c1c", fontSize: 13 }}>
        {error}
      </div>
    );
  }

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
        <div>
          <div style={{ fontSize: 15, fontWeight: 900, color: "#0f172a" }}>{activeTab}</div>
          <div style={{ fontSize: 12, color: "#64748b", marginTop: 4 }}>
            共 {debriefData?.meta?.totalTeams || 0} 组，Round 1 已提交 {debriefData?.meta?.teamsSubmittedR1 || 0} 组，Round 2 已提交 {debriefData?.meta?.teamsSubmittedR2 || 0} 组
          </div>
        </div>
        <button onClick={() => loadDebriefData(true)} disabled={loading} style={{ padding: "10px 14px", borderRadius: 10, border: "1px solid #cbd5e1", background: "#fff", color: "#334155", fontSize: 12, fontWeight: 700, cursor: loading ? "wait" : "pointer" }}>
          {loading ? "刷新中..." : "刷新数据"}
        </button>
      </div>

      {activeTab === "Round 1 复盘" && <Round1Tab teams={round1Teams} teacherCode={teacherCode} sessionId={sessionId} />}
      {activeTab === "Round 2 复盘" && (
        <Round2Tab
          teams={round2Teams}
          reviews={reviews}
          reviewLoading={reviewLoading}
          expandedTeamId={expandedTeamId}
          onToggle={handleToggleReview}
          radarScale={radarScale}
        />
      )}
      {activeTab === "跨轮对比" && <CrossTab teams={round2Teams} radarScale={radarScale} />}
      {activeTab === "AI 讲解稿" && (
        <DebriefTab
          round={debriefRound}
          script={scripts[debriefRound] || ""}
          loading={scriptLoading}
          onChangeRound={setDebriefRound}
          onGenerate={handleGenerateDebrief}
          onCopy={handleCopyScript}
        />
      )}
      {activeTab === "导出" && (
        <ExportTab
          onExportCsv={handleExportCsv}
          onExportJson={onExportJson}
          teams={debriefData?.teams || []}
        />
      )}
    </div>
  );
}
