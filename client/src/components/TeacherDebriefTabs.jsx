import { useEffect, useMemo, useState } from "react";
import {
  downloadTeacherCsv,
  generateTeacherDebrief,
  generateTeacherTeamReview,
  getTeacherDebriefData
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
  const n = Number(value || 0);
  if (!Number.isFinite(n)) return "-";
  return `¥${Math.round(n).toLocaleString()}`;
}

function formatWan(value) {
  const n = Number(value || 0);
  if (!Number.isFinite(n)) return "-";
  return `${Math.round(n / 10000).toLocaleString()}万`;
}

function formatPercent(value, digits = 0) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "-";
  return `${(n * 100).toFixed(digits)}%`;
}

function computeActualGm(team) {
  const price = Number(team?.r2?.price);
  const dCOGS = Number(team?.r2?.dCOGS);
  if (!Number.isFinite(price) || !Number.isFinite(dCOGS) || price <= 0) return null;
  const f = /ToB|B2B/i.test(String(team?.r1?.grid || "")) ? 0.15 : 0.25;
  return (price * (1 - f) - 2000 - dCOGS) / price;
}

function isSubmittedR2(team) {
  return team?.r2?.price != null && team?.r2?.profit != null;
}

function isConsistent(team) {
  const r1 = String(team?.r1?.grid || "");
  const r2 = String(team?.r2?.bestGrid || "");
  return Boolean(r1 && r2 && r1 === r2);
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
    <div style={{ ...CARD_STYLE, textAlign: "center", padding: "38px 24px", color: "#64748b" }}>
      <div style={{ fontSize: 16, fontWeight: 800, color: "#0f172a", marginBottom: 8 }}>{title}</div>
      <div style={{ fontSize: 13, lineHeight: 1.7 }}>{detail}</div>
    </div>
  );
}

function MetricCard({ label, value, hint, color }) {
  return (
    <div style={{ ...CARD_STYLE, padding: 16 }}>
      <div style={{ fontSize: 28, fontWeight: 900, color }}>{value}</div>
      <div style={{ fontSize: 12, color: "#475569", marginTop: 4 }}>{label}</div>
      {hint && <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 4 }}>{hint}</div>}
    </div>
  );
}

function sectionTitle(title, detail) {
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ fontSize: 15, fontWeight: 900, color: "#0f172a" }}>{title}</div>
      {detail && <div style={{ fontSize: 11, color: "#64748b", marginTop: 4 }}>{detail}</div>}
    </div>
  );
}

function MiniRadar({ scores, size = 124, stroke = "#1a5c3a", fill = "rgba(26,92,58,0.12)" }) {
  const dims = [
    { key: "interaction", label: "交互" },
    { key: "perception", label: "感知" },
    { key: "motion", label: "运动" },
    { key: "safety", label: "安全" },
    { key: "extend", label: "扩展" },
    { key: "ops", label: "运营" }
  ];
  const cx = size / 2;
  const cy = size / 2;
  const radius = size * 0.34;
  const outer = dims.map((dim, index) => {
    const angle = (Math.PI * 2 * index) / dims.length - Math.PI / 2;
    return [cx + radius * Math.cos(angle), cy + radius * Math.sin(angle)];
  });
  const points = dims.map((dim, index) => {
    const angle = (Math.PI * 2 * index) / dims.length - Math.PI / 2;
    const score = Math.max(0, Math.min(9, Number(scores?.[dim.key] || 0)));
    const ratio = score / 9;
    return [cx + radius * ratio * Math.cos(angle), cy + radius * ratio * Math.sin(angle)];
  });

  return (
    <svg width={size} height={size}>
      {[0.33, 0.66, 1].map((ratio) => (
        <polygon
          key={ratio}
          points={outer.map(([x, y]) => `${cx + (x - cx) * ratio},${cy + (y - cy) * ratio}`).join(" ")}
          fill="none"
          stroke="#e2e8f0"
          strokeWidth="1"
        />
      ))}
      {outer.map(([x, y], index) => (
        <g key={dims[index].key}>
          <line x1={cx} y1={cy} x2={x} y2={y} stroke="#e2e8f0" strokeWidth="1" />
          <text x={cx + (x - cx) * 1.15} y={cy + (y - cy) * 1.15} fontSize="9" fill="#64748b" textAnchor="middle" dominantBaseline="middle">
            {dims[index].label}
          </text>
        </g>
      ))}
      <polygon points={points.map(([x, y]) => `${x},${y}`).join(" ")} fill={fill} stroke={stroke} strokeWidth="2" />
    </svg>
  );
}

function HeatmapCard({ teams }) {
  const counts = teams.reduce((acc, team) => {
    const key = gridCellKeyFromGridId(team?.r1?.grid);
    if (key) acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
  const maxCount = Math.max(1, ...Object.values(counts));

  return (
    <div style={CARD_STYLE}>
      {sectionTitle("战略分布图", "按 Round 1 最终定位汇总，各格子的颜色越深表示团队越集中。")}
      <div style={{ display: "grid", gridTemplateColumns: "76px repeat(3, 1fr)", gap: 6 }}>
        <div />
        {GRID_COLS.map((col) => (
          <div key={col} style={{ textAlign: "center", fontSize: 11, color: "#64748b", fontWeight: 700 }}>{col}</div>
        ))}
        {GRID_ROWS.map((row) => (
          <div key={row.key} style={{ display: "contents" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", fontSize: 10, color: "#64748b", fontWeight: 700, paddingRight: 8 }}>
              {row.label}
            </div>
            {GRID_COLS.map((col) => {
              const key = `${row.key}|${col}`;
              const count = counts[key] || 0;
              const opacity = count ? 0.12 + (count / maxCount) * 0.34 : 0.03;
              return (
                <div
                  key={key}
                  style={{
                    minHeight: 74,
                    borderRadius: 14,
                    border: "1px solid #e2e8f0",
                    background: `rgba(26,92,58,${opacity})`,
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: 4
                  }}
                >
                  <div style={{ fontSize: 28, fontWeight: 900, color: count ? "#0f172a" : "#cbd5e1" }}>{count}</div>
                  <div style={{ fontSize: 10, color: "#64748b" }}>{count ? "组" : "空"}</div>
                </div>
              );
            })}
          </div>
        ))}
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
      {sectionTitle("市场规模 × 支付意愿", "蓝条表示 SAM，绿条表示调整后支付意愿。")}
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {sorted.map((team) => (
          <div key={team.id}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 8, marginBottom: 5 }}>
              <span style={{ fontSize: 12, fontWeight: 700, color: "#0f172a" }}>{team.name}</span>
              <span style={{ fontSize: 10, color: "#64748b" }}>{normalizeGridLabel(team?.r1?.gridLabel)}</span>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              <div style={{ background: "#eff6ff", borderRadius: 999, height: 12, overflow: "hidden", position: "relative" }}>
                <div style={{ width: `${(Number(team?.r1?.sam || 0) / maxSam) * 100}%`, background: "#3b82f6", height: "100%" }} />
              </div>
              <div style={{ background: "#ecfdf5", borderRadius: 999, height: 12, overflow: "hidden", position: "relative" }}>
                <div style={{ width: `${(Number(team?.r1?.wtpAdj || 0) / maxWtp) * 100}%`, background: "#10b981", height: "100%" }} />
              </div>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 4 }}>
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
  return (
    <div style={CARD_STYLE}>
      {sectionTitle("VP 评分对比", "C=覆盖率，G=痛点泛化，E=说服力（Eadj 为锦囊调整后分数）。")}
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
          <thead>
            <tr style={{ background: "#f8fafc", color: "#64748b" }}>
              {["组别", "格子", "C", "G", "E", "Eadj", "SAM", "WTPadj"].map((label) => (
                <th key={label} style={{ padding: "9px 10px", textAlign: "left", borderBottom: "1px solid #e2e8f0", fontWeight: 700 }}>{label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {teams.map((team) => (
              <tr key={team.id}>
                <td style={{ padding: "10px", borderBottom: "1px solid #e2e8f0", fontWeight: 700, color: "#0f172a" }}>{team.name}</td>
                <td style={{ padding: "10px", borderBottom: "1px solid #e2e8f0", color: "#475569" }}>{normalizeGridLabel(team?.r1?.gridLabel) || "-"}</td>
                <td style={{ padding: "10px", borderBottom: "1px solid #e2e8f0", color: "#059669", fontWeight: 800 }}>{team?.r1?.C ?? "-"}</td>
                <td style={{ padding: "10px", borderBottom: "1px solid #e2e8f0", color: "#6366f1", fontWeight: 800 }}>{team?.r1?.G ?? "-"}</td>
                <td style={{ padding: "10px", borderBottom: "1px solid #e2e8f0", color: "#d97706", fontWeight: 800 }}>{team?.r1?.E ?? "-"}</td>
                <td style={{ padding: "10px", borderBottom: "1px solid #e2e8f0", color: "#0f172a", fontWeight: 800 }}>{team?.r1?.Eadj ?? "-"}</td>
                <td style={{ padding: "10px", borderBottom: "1px solid #e2e8f0", color: "#475569" }}>{team?.r1?.sam ?? "-"}</td>
                <td style={{ padding: "10px", borderBottom: "1px solid #e2e8f0", color: "#475569" }}>{formatMoney(team?.r1?.wtpAdj)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Round1Table({ teams }) {
  return (
    <div style={CARD_STYLE}>
      {sectionTitle("Round 1 小组明细", "展示每组最终定位、价值主张和核心评分。")}
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
          <thead>
            <tr style={{ background: "#f8fafc", color: "#64748b" }}>
              {["组别", "定位", "架构", "WHO", "PAIN", "HOW"].map((label) => (
                <th key={label} style={{ padding: "10px", textAlign: "left", borderBottom: "1px solid #e2e8f0", fontWeight: 700 }}>{label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {teams.map((team) => (
              <tr key={team.id}>
                <td style={{ padding: "10px", borderBottom: "1px solid #e2e8f0", fontWeight: 700, color: "#0f172a", whiteSpace: "nowrap" }}>{team.name}</td>
                <td style={{ padding: "10px", borderBottom: "1px solid #e2e8f0", color: "#475569", whiteSpace: "nowrap" }}>{normalizeGridLabel(team?.r1?.gridLabel) || "-"}</td>
                <td style={{ padding: "10px", borderBottom: "1px solid #e2e8f0", color: "#475569", whiteSpace: "nowrap" }}>{team?.r1?.arch || "-"}</td>
                <td style={{ padding: "10px", borderBottom: "1px solid #e2e8f0", color: "#475569", maxWidth: 220 }}>{team?.r1?.who || "-"}</td>
                <td style={{ padding: "10px", borderBottom: "1px solid #e2e8f0", color: "#475569", maxWidth: 260 }}>{team?.r1?.pain || "-"}</td>
                <td style={{ padding: "10px", borderBottom: "1px solid #e2e8f0", color: "#475569", maxWidth: 260 }}>{team?.r1?.how || "-"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function WinnersCard({ teams }) {
  const topTeams = teams.slice(0, 3);
  const medals = ["冠军", "亚军", "季军"];
  const colors = ["#ca8a04", "#64748b", "#b45309"];

  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 14 }}>
      {topTeams.map((team, index) => (
        <div key={team.id} style={{ ...CARD_STYLE, background: index === 0 ? "linear-gradient(180deg, #fffbeb, #fff)" : "#fff" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
            <div>
              <div style={{ fontSize: 11, color: colors[index], fontWeight: 900 }}>{medals[index]}</div>
              <div style={{ fontSize: 18, fontWeight: 900, color: "#0f172a", marginTop: 4 }}>{team.name}</div>
              <div style={{ fontSize: 11, color: "#64748b", marginTop: 4 }}>{normalizeGridLabel(team?.r1?.gridLabel)}</div>
            </div>
            <MiniRadar scores={team?.r2?.radar || {}} size={84} stroke={colors[index]} fill={`${colors[index]}20`} />
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 10, marginTop: 14 }}>
            <div>
              <div style={{ fontSize: 10, color: "#94a3b8" }}>利润</div>
              <div style={{ fontSize: 18, fontWeight: 900, color: colors[index] }}>{formatWan(team?.r2?.profit)}</div>
            </div>
            <div>
              <div style={{ fontSize: 10, color: "#94a3b8" }}>销量</div>
              <div style={{ fontSize: 18, fontWeight: 900, color: "#0f172a" }}>{Number(team?.r2?.units || 0).toLocaleString()}</div>
            </div>
            <div>
              <div style={{ fontSize: 10, color: "#94a3b8" }}>定价</div>
              <div style={{ fontSize: 13, fontWeight: 800, color: "#0f172a" }}>{formatMoney(team?.r2?.price)}</div>
            </div>
            <div>
              <div style={{ fontSize: 10, color: "#94a3b8" }}>dCOGS</div>
              <div style={{ fontSize: 13, fontWeight: 800, color: "#0f172a" }}>{formatMoney(team?.r2?.dCOGS)}</div>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function StrategicMapCard({ teams }) {
  const byR1 = teams.reduce((acc, team) => {
    const key = gridCellKeyFromGridId(team?.r1?.grid);
    if (!key) return acc;
    if (!acc[key]) acc[key] = { r1: 0, driftIn: 0, totalProfit: 0 };
    acc[key].r1 += 1;
    acc[key].totalProfit += Number(team?.r2?.profit || 0);
    return acc;
  }, {});
  teams.forEach((team) => {
    const key = gridCellKeyFromGridId(team?.r2?.bestGrid);
    if (!key) return;
    if (!byR1[key]) byR1[key] = { r1: 0, driftIn: 0, totalProfit: 0 };
    if (!isConsistent(team)) byR1[key].driftIn += 1;
  });

  return (
    <div style={CARD_STYLE}>
      {sectionTitle("战略地图复盘", "实心数字=Round 1 选在这里的组数，虚线数字=Round 2 产品最终跑到这里的组数。")}
      <div style={{ display: "grid", gridTemplateColumns: "82px repeat(3, 1fr)", gap: 6 }}>
        <div />
        {GRID_COLS.map((col) => (
          <div key={col} style={{ textAlign: "center", fontSize: 11, color: "#64748b", fontWeight: 700 }}>{col}</div>
        ))}
        {GRID_ROWS.map((row) => (
          <div key={row.key} style={{ display: "contents" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", fontSize: 10, color: "#64748b", fontWeight: 700, paddingRight: 8 }}>
              {row.label}
            </div>
            {GRID_COLS.map((col) => {
              const info = byR1[`${row.key}|${col}`] || { r1: 0, driftIn: 0, totalProfit: 0 };
              return (
                <div
                  key={`${row.key}-${col}`}
                  style={{
                    minHeight: 86,
                    borderRadius: 14,
                    border: "1px solid #e2e8f0",
                    background: info.r1 || info.driftIn ? "linear-gradient(180deg, #f8fafc, #fff)" : "#fff",
                    padding: 10,
                    display: "flex",
                    flexDirection: "column",
                    justifyContent: "space-between"
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                    <span style={{ fontSize: 11, color: "#1a5c3a", fontWeight: 900 }}>R1 {info.r1}</span>
                    <span style={{ fontSize: 11, color: "#d97706", fontWeight: 900 }}>R2 {info.driftIn}</span>
                  </div>
                  <div style={{ fontSize: 10, color: "#64748b" }}>累计利润</div>
                  <div style={{ fontSize: 16, fontWeight: 900, color: info.totalProfit >= 0 ? "#0f172a" : "#dc2626" }}>
                    {formatWan(info.totalProfit)}
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
  const maxProfit = Math.max(1, ...teams.map((team) => Math.abs(Number(team?.r2?.profit || 0))));
  return (
    <div style={CARD_STYLE}>
      {sectionTitle("利润排名", "按最终利润排序，负利润会显示为红色。")}
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {teams.map((team) => {
          const profit = Number(team?.r2?.profit || 0);
          const width = (Math.abs(profit) / maxProfit) * 100;
          const color = profit >= 0 ? "#1a5c3a" : "#dc2626";
          return (
            <div key={team.id}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 8, marginBottom: 4 }}>
                <span style={{ fontSize: 12, color: "#0f172a", fontWeight: 700 }}>{team.name}</span>
                <span style={{ fontSize: 11, color, fontWeight: 800 }}>{formatWan(profit)}</span>
              </div>
              <div style={{ height: 10, background: "#f1f5f9", borderRadius: 999, overflow: "hidden" }}>
                <div style={{ width: `${width}%`, height: "100%", background: color }} />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ScatterCard({ teams }) {
  const width = 420;
  const height = 240;
  const padding = 28;
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
      {sectionTitle("定价 × 利润 × 销量", "横轴为定价，纵轴为利润，气泡大小表示销量。")}
      <svg width="100%" viewBox={`0 0 ${width} ${height}`}>
        <line x1={padding} y1={height - padding} x2={width - padding} y2={height - padding} stroke="#cbd5e1" strokeWidth="1.5" />
        <line x1={padding} y1={padding} x2={padding} y2={height - padding} stroke="#cbd5e1" strokeWidth="1.5" />
        {teams.map((team) => {
          const price = Number(team?.r2?.price || 0);
          const profit = Number(team?.r2?.profit || 0);
          const unitCount = Number(team?.r2?.units || 0);
          const cx = mapX(price);
          const cy = mapY(profit);
          const radius = 6 + (unitCount / maxUnits) * 18;
          const fill = /差异化/i.test(normalizeGridLabel(team?.r1?.gridLabel)) ? "#1a5c3a" : "#f59e0b";
          return (
            <g key={team.id}>
              <circle cx={cx} cy={cy} r={radius} fill={fill} fillOpacity="0.28" stroke={fill} strokeWidth="2" />
              <text x={cx} y={cy + 4} textAnchor="middle" fontSize="9" fontWeight="800" fill="#0f172a">
                {team.name.replace(/^.*?(\d+)$/, "$1")}
              </text>
            </g>
          );
        })}
        <text x={width / 2} y={height - 4} textAnchor="middle" fontSize="10" fill="#64748b">定价</text>
        <text x="12" y={height / 2} textAnchor="middle" fontSize="10" fill="#64748b" transform={`rotate(-90 12 ${height / 2})`}>利润</text>
      </svg>
      <div style={{ display: "flex", gap: 14, fontSize: 10, color: "#64748b", marginTop: 8 }}>
        <span style={{ display: "flex", alignItems: "center", gap: 4 }}><span style={{ width: 10, height: 10, borderRadius: 999, background: "#1a5c3a" }} />差异化</span>
        <span style={{ display: "flex", alignItems: "center", gap: 4 }}><span style={{ width: 10, height: 10, borderRadius: 999, background: "#f59e0b" }} />成本领先</span>
      </div>
    </div>
  );
}

function ReviewAccordion({ teams, reviews, reviewLoading, expandedTeamId, onToggle }) {
  return (
    <div style={CARD_STYLE}>
      {sectionTitle("逐组 AI 复盘", "展开后会调用后端生成单组点评，并在前端缓存。")}
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {teams.map((team) => {
          const review = reviews[team.id];
          const gm = computeActualGm(team);
          const expanded = expandedTeamId === team.id;
          return (
            <div key={team.id} style={{ border: "1px solid #e2e8f0", borderRadius: 14, overflow: "hidden" }}>
              <button
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
                <div style={{ textAlign: "left" }}>
                  <div style={{ fontSize: 14, fontWeight: 900, color: "#0f172a" }}>{team.name}</div>
                  <div style={{ fontSize: 11, color: "#64748b", marginTop: 4 }}>
                    {normalizeGridLabel(team?.r1?.gridLabel)} · {formatMoney(team?.r2?.price)} · {formatWan(team?.r2?.profit)}
                  </div>
                </div>
                <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
                  <div style={{ textAlign: "right" }}>
                    <div style={{ fontSize: 11, color: "#94a3b8" }}>毛利率</div>
                    <div style={{ fontSize: 12, fontWeight: 800, color: metricColor(gm, { good: 0.3, warn: 0.2 }) }}>{formatPercent(gm)}</div>
                  </div>
                  <div style={{ fontSize: 12, color: "#1a5c3a", fontWeight: 800 }}>{expanded ? "收起" : "展开"}</div>
                </div>
              </button>
              {expanded && (
                <div style={{ borderTop: "1px solid #e2e8f0", padding: 16 }}>
                  <div style={{ display: "grid", gridTemplateColumns: "1.4fr 0.8fr", gap: 16 }}>
                    <div>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 12 }}>
                        {[
                          { label: "定价", value: formatMoney(team?.r2?.price) },
                          { label: "销量", value: Number(team?.r2?.units || 0).toLocaleString() },
                          { label: "利润", value: formatWan(team?.r2?.profit) },
                          { label: "dCOGS", value: formatMoney(team?.r2?.dCOGS) },
                          { label: "卡数", value: `${team?.r2?.cardCount || 0} 张` },
                          { label: "产品力", value: formatPercent(team?.r2?.vscore) }
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
                            <div style={{ fontSize: 12, fontWeight: 800, color: "#1a5c3a", marginBottom: 8 }}>{review.insight}</div>
                            <div style={{ fontSize: 13, color: "#334155", lineHeight: 1.8 }}>{review.review}</div>
                          </>
                        ) : (
                          <div style={{ fontSize: 12, color: "#64748b" }}>点击展开后自动生成点评。</div>
                        )}
                      </div>
                      <div style={{ marginTop: 10, fontSize: 11, color: "#64748b", lineHeight: 1.7 }}>
                        <strong style={{ color: "#0f172a" }}>价值主张：</strong>{team?.r1?.vp || "-"}
                      </div>
                      <div style={{ marginTop: 10, display: "flex", flexWrap: "wrap", gap: 6 }}>
                        {(team?.r2?.cards || []).map((card, index) => (
                          <span key={`${team.id}-${index}`} style={{ padding: "3px 8px", borderRadius: 999, background: "#f1f5f9", color: "#475569", fontSize: 10 }}>
                            {card}
                          </span>
                        ))}
                      </div>
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 8 }}>
                      <MiniRadar scores={team?.r2?.radar || {}} size={156} />
                      <div style={{ fontSize: 11, color: "#64748b" }}>{normalizeGridLabel(team?.r2?.bestGridLabel || team?.r1?.gridLabel)}</div>
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

function ConsistencyBadge({ team }) {
  const consistent = isConsistent(team);
  return (
    <span
      style={{
        padding: "6px 10px",
        borderRadius: 999,
        fontSize: 11,
        fontWeight: 800,
        background: consistent ? "#dcfce7" : "#fef3c7",
        color: consistent ? "#166534" : "#92400e"
      }}
    >
      {consistent ? "一致" : "跑偏"}
    </span>
  );
}

function CrossCompareCard({ teams }) {
  const topTeam = teams[0];
  const bottomTeam = teams[teams.length - 1];

  return (
    <div style={CARD_STYLE}>
      {sectionTitle("冠军 vs 末位 雷达对比", "用于对比两端策略在能力分布上的差异。")}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
        {[topTeam, bottomTeam].map((team, index) => (
          <div key={team.id} style={{ textAlign: "center" }}>
            <div style={{ fontSize: 13, fontWeight: 900, color: "#0f172a" }}>{team.name}</div>
            <div style={{ fontSize: 11, color: "#64748b", marginTop: 4 }}>{formatWan(team?.r2?.profit)}</div>
            <div style={{ display: "flex", justifyContent: "center", marginTop: 10 }}>
              <MiniRadar
                scores={team?.r2?.radar || {}}
                size={180}
                stroke={index === 0 ? "#1a5c3a" : "#dc2626"}
                fill={index === 0 ? "rgba(26,92,58,0.10)" : "rgba(220,38,38,0.10)"}
              />
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

function Round1Tab({ teams }) {
  return (
    <div style={{ display: "grid", gap: 16 }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 14 }}>
        <MetricCard label="R1 已提交组数" value={teams.filter((team) => team?.r1?.grid).length} color="#1a5c3a" />
        <MetricCard label="差异化占比" value={formatPercent(teams.filter((team) => /差异化/i.test(normalizeGridLabel(team?.r1?.gridLabel))).length / Math.max(1, teams.length))} color="#6366f1" />
        <MetricCard label="平均 SAM" value={`${Math.round(teams.reduce((sum, team) => sum + Number(team?.r1?.sam || 0), 0) / Math.max(1, teams.length))} 亿`} color="#3b82f6" />
        <MetricCard label="平均 WTPadj" value={formatMoney(teams.reduce((sum, team) => sum + Number(team?.r1?.wtpAdj || 0), 0) / Math.max(1, teams.length))} color="#059669" />
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1.15fr 1fr", gap: 16 }}>
        <HeatmapCard teams={teams} />
        <SamWtpCard teams={teams} />
      </div>
      <VpScoresCard teams={teams} />
      <Round1Table teams={teams} />
    </div>
  );
}

function Round2Tab({ teams, reviews, reviewLoading, expandedTeamId, onToggle }) {
  if (!teams.length) {
    return emptyState("Round 2 尚无有效提交", "目前还没有团队完成 Round 2 提交，等学生提交后这里会自动显示利润、定价和产品力分析。");
  }

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <WinnersCard teams={teams} />
      <div style={{ display: "grid", gridTemplateColumns: "1.1fr 0.9fr", gap: 16 }}>
        <StrategicMapCard teams={teams} />
        <ProfitRankingCard teams={teams} />
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        <ScatterCard teams={teams} />
        <div style={CARD_STYLE}>
          {sectionTitle("研发投入 vs 产品力 vs ROI", "用来快速识别堆料、低效投入和高转化策略。")}
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
              <thead>
                <tr style={{ background: "#f8fafc", color: "#64748b" }}>
                  {["组别", "dCOGS", "产品力", "风险", "毛利率", "ROI", "利润"].map((label) => (
                    <th key={label} style={{ padding: "9px 10px", textAlign: "left", borderBottom: "1px solid #e2e8f0", fontWeight: 700 }}>{label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {teams.map((team) => {
                  const gm = computeActualGm(team);
                  const roi = Number(team?.r2?.roi);
                  return (
                    <tr key={team.id}>
                      <td style={{ padding: "10px", borderBottom: "1px solid #e2e8f0", fontWeight: 700, color: "#0f172a" }}>{team.name}</td>
                      <td style={{ padding: "10px", borderBottom: "1px solid #e2e8f0", color: metricColor(team?.r2?.dCOGS, { good: 1200, warn: 2200 }), fontWeight: 800 }}>{formatMoney(team?.r2?.dCOGS)}</td>
                      <td style={{ padding: "10px", borderBottom: "1px solid #e2e8f0", color: "#475569" }}>{formatPercent(team?.r2?.vscore)}</td>
                      <td style={{ padding: "10px", borderBottom: "1px solid #e2e8f0", color: metricColor(1 - Number(team?.r2?.riskTotal || 0), { good: 0.7, warn: 0.5 }) }}>{formatPercent(team?.r2?.riskTotal)}</td>
                      <td style={{ padding: "10px", borderBottom: "1px solid #e2e8f0", color: metricColor(gm, { good: 0.3, warn: 0.2 }), fontWeight: 800 }}>{formatPercent(gm)}</td>
                      <td style={{ padding: "10px", borderBottom: "1px solid #e2e8f0", color: metricColor(roi, { good: 1, warn: 0.5 }), fontWeight: 800 }}>{formatPercent(roi)}</td>
                      <td style={{ padding: "10px", borderBottom: "1px solid #e2e8f0", color: Number(team?.r2?.profit || 0) >= 0 ? "#1a5c3a" : "#dc2626", fontWeight: 800 }}>{formatWan(team?.r2?.profit)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>
      <ReviewAccordion teams={teams} reviews={reviews} reviewLoading={reviewLoading} expandedTeamId={expandedTeamId} onToggle={onToggle} />
    </div>
  );
}

function CrossTab({ teams }) {
  if (!teams.length) {
    return emptyState("暂无跨轮对比数据", "等至少一组完成 Round 2 提交后，这里会显示战略一致性、WTP 与实际定价的差异。");
  }

  const consistentCount = teams.filter(isConsistent).length;
  const driftProfit = teams.filter((team) => !isConsistent(team) && Number(team?.r2?.profit || 0) > 0).length;
  const driftLoss = teams.filter((team) => !isConsistent(team) && Number(team?.r2?.profit || 0) <= 0).length;
  const scaleMax = Math.max(
    1,
    ...teams.map((team) => Math.max(Number(team?.r1?.wtpAdj || 0), Number(team?.r2?.price || 0)))
  );

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
            <div key={team.id} style={{ display: "grid", gridTemplateColumns: "120px 1fr auto auto", gap: 12, alignItems: "center", padding: "12px 14px", borderRadius: 12, background: "#f8fafc", border: "1px solid #e2e8f0" }}>
              <div style={{ fontSize: 13, fontWeight: 900, color: "#0f172a" }}>{team.name}</div>
              <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", fontSize: 12 }}>
                <span style={{ padding: "4px 8px", borderRadius: 999, background: "#eef2ff", color: "#4338ca" }}>{normalizeGridLabel(team?.r1?.gridLabel)}</span>
                <span style={{ color: "#94a3b8" }}>→</span>
                <span style={{ padding: "4px 8px", borderRadius: 999, background: isConsistent(team) ? "#dcfce7" : "#fef3c7", color: isConsistent(team) ? "#166534" : "#92400e" }}>
                  {normalizeGridLabel(team?.r2?.bestGridLabel)}
                </span>
              </div>
              <ConsistencyBadge team={team} />
              <div style={{ fontSize: 13, fontWeight: 900, color: Number(team?.r2?.profit || 0) >= 0 ? "#1a5c3a" : "#dc2626" }}>
                {formatWan(team?.r2?.profit)}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        <div style={CARD_STYLE}>
          {sectionTitle("WTPadj vs 实际定价", "蓝条是 Round 1 可支付意愿，绿线是 Round 2 实际定价。")}
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {teams.map((team) => (
              <div key={team.id}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 8, marginBottom: 4 }}>
                  <span style={{ fontSize: 12, fontWeight: 700, color: "#0f172a" }}>{team.name}</span>
                  <span style={{ fontSize: 10, color: "#64748b" }}>{formatMoney(team?.r2?.price)} / {formatMoney(team?.r1?.wtpAdj)}</span>
                </div>
                <div style={{ height: 14, background: "#eff6ff", borderRadius: 999, position: "relative" }}>
                  <div style={{ width: `${(Number(team?.r1?.wtpAdj || 0) / scaleMax) * 100}%`, height: "100%", background: "#bfdbfe", borderRadius: 999 }} />
                  <div style={{ position: "absolute", top: -2, left: `calc(${(Number(team?.r2?.price || 0) / scaleMax) * 100}% - 1px)`, width: 3, height: 18, background: "#1a5c3a", borderRadius: 999 }} />
                </div>
              </div>
            ))}
          </div>
        </div>
        <CrossCompareCard teams={teams} />
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
        <div style={CARD_STYLE}>
          <div style={{ fontSize: 18, marginBottom: 8 }}>PPT</div>
          <div style={{ fontSize: 14, fontWeight: 800, color: "#0f172a" }}>投屏版复盘包</div>
          <div style={{ fontSize: 12, color: "#64748b", lineHeight: 1.7, marginTop: 8 }}>
            按你的优先级，这一项先保留占位。等数据展示和 AI 讲解稿稳定后再补。
          </div>
          <button disabled style={{ marginTop: 14, padding: "10px 16px", borderRadius: 10, border: "1px solid #e2e8f0", background: "#f8fafc", color: "#94a3b8", fontSize: 12, fontWeight: 800, cursor: "not-allowed" }}>
            即将上线
          </button>
        </div>
      </div>
      <div style={CARD_STYLE}>
        {sectionTitle("已纳入导出的团队", "下面列出当前会进入 CSV 的团队样本。")}
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          {teams.map((team) => (
            <span key={team.id} style={{ padding: "5px 10px", borderRadius: 999, background: "#f1f5f9", color: "#475569", fontSize: 11 }}>
              {team.name}
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
    () => (debriefData?.teams || []).filter((team) => team?.r1?.grid),
    [debriefData]
  );
  const round2Teams = useMemo(
    () => (debriefData?.teams || []).filter(isSubmittedR2).slice().sort((a, b) => Number(b?.r2?.profit || 0) - Number(a?.r2?.profit || 0)),
    [debriefData]
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

      {activeTab === "Round 1 复盘" && <Round1Tab teams={round1Teams} />}
      {activeTab === "Round 2 复盘" && (
        <Round2Tab
          teams={round2Teams}
          reviews={reviews}
          reviewLoading={reviewLoading}
          expandedTeamId={expandedTeamId}
          onToggle={handleToggleReview}
        />
      )}
      {activeTab === "跨轮对比" && <CrossTab teams={round2Teams} />}
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
