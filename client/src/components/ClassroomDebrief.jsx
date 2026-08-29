import { useEffect, useMemo, useRef, useState } from "react";
import { formatYuan as formatMoney, formatWanFromYuan as formatWan } from "../utils/formatMoney";

const CARD_STYLE = {
  background: "#fff",
  border: "1px solid #e2e8f0",
  borderRadius: 18,
  padding: 18
};

const BASE_SLIDES = [
  { id: "cover", label: "总览", section: "封面" },
  { id: "r1-index", label: "R1 目录", section: "R1" },
  { id: "r1-map", label: "R1 地图", section: "R1" },
  { id: "r1-vp", label: "VP 对决", section: "R1" },
  { id: "r1-scatter", label: "宽窄图", section: "R1" },
  { id: "r2-index", label: "R2 目录", section: "R2" },
  { id: "r2-board", label: "利润揭榜", section: "R2" },
  { id: "r2-autopsy", label: "双组拆解", section: "R2" },
  { id: "r2-pricing", label: "定价带", section: "R2" },
  { id: "r2-cards", label: "选卡全景", section: "R2" },
  { id: "r2-intent", label: "意图执行", section: "R2" },
  { id: "end", label: "结尾", section: "终页" }
];

const GRID_ROWS = [
  { key: "ToC·差异化", label: "ToC·差异化" },
  { key: "ToC·成本领先", label: "ToC·成本" },
  { key: "ToB·差异化", label: "ToB·差异化" },
  { key: "ToB·成本领先", label: "ToB·成本" }
];

const GRID_COLS = ["老人", "成人", "儿童"];
const DIMENSIONS = [
  { key: "perception_understanding", label: "感知", aliases: ["感知", "perception", "perception_understanding"] },
  { key: "mobility_navigation", label: "运动", aliases: ["运动", "mobility", "motion", "mobility_navigation"] },
  { key: "interaction_expression", label: "交互", aliases: ["交互", "interaction", "interaction_expression"] },
  { key: "safety_trust", label: "安全", aliases: ["安全", "safety", "safety_trust"] },
  { key: "expand_connect", label: "扩展", aliases: ["扩展", "extend", "expand", "expand_connect"] },
  { key: "ops_maintenance", label: "运维", aliases: ["运维", "运营", "ops", "ops_maintenance"] }
];

const ARCH_MARK = {
  Experience: "●",
  Hybrid: "▲",
  Function: "■",
  "体验型": "●",
  "混合型": "▲",
  "功能型": "■"
};

const TIER_RANK = { low: 1, "低": 1, mid: 2, "中": 2, high: 3, "高": 3 };
const TIER_LABEL = { low: "低", mid: "中", high: "高", "低": "低", "中": "中", "高": "高" };
const ROUND2_BASE_VARIABLE_COST = 600;

function toFiniteNumber(value, fallback = null) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function formatScore(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  return n.toFixed(1);
}

function formatPercent(value, digits = 0) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  return `${n.toFixed(digits)}%`;
}

function formatCompactNumber(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  return Math.round(n).toLocaleString("zh-CN");
}

function clipText(value, max = 42) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (!text) return "—";
  return text.length > max ? `${text.slice(0, max)}...` : text;
}

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

function gridCellKeyFromGridId(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const parts = raw.split("_");
  if (parts.length < 3) return "";
  const market = /^B2B$/i.test(parts[0]) || /^ToB$/i.test(parts[0]) ? "ToB" : "ToC";
  const strategy = /cost/i.test(parts[1]) ? "成本领先" : "差异化";
  const segment = /elder|old|老人|老年/i.test(parts[2]) ? "老人" : /child|儿童/i.test(parts[2]) ? "儿童" : "成人";
  return `${market}·${strategy}|${segment}`;
}

function getTeamNo(team) {
  const match = String(team?.displayName || team?.name || "").match(/(\d+)/);
  if (match) return Number(match[1]);
  return Number(team?.teamIndex || 0) + 1;
}

function getTeamLabel(team, anonymous = true) {
  if (!team) return "—";
  if (anonymous) return `第${getTeamNo(team)}组`;
  return team.name || team.displayName || `第${getTeamNo(team)}组`;
}

function teamSlideId(round, teamId) {
  return `${round}-team-${teamId}`;
}

function getProductLabel(team) {
  return team?.productName
    || team?.product_name
    || clipText(team?.r1?.how || team?.r1?.vp || "产品方案", 34);
}

function getArchSymbol(team) {
  const arch = team?.r1?.arch || team?.r1?.archLabel || "";
  return ARCH_MARK[arch] || ARCH_MARK[String(arch).trim()] || "";
}

function getArchText(team) {
  return team?.r1?.archLabel || team?.r1?.arch || "未提交";
}

function getVpTotal(team) {
  const candidates = [
    team?.r1?.vpFinalScore,
    team?.r1?.VPscore,
    team?.r1?.vpBestScore
  ];
  for (const value of candidates) {
    const n = Number(value);
    if (Number.isFinite(n) && n > 0) return n;
  }
  const scores = [team?.r1?.C, team?.r1?.G, team?.r1?.Eadj ?? team?.r1?.E]
    .map(Number)
    .filter(Number.isFinite);
  return scores.length ? scores.reduce((sum, value) => sum + value, 0) / scores.length : null;
}

function isSubmittedR2(team) {
  const price = team?.r2?.price;
  const profit = team?.r2?.profit;
  return price != null && profit != null
    && Number.isFinite(Number(price)) && Number.isFinite(Number(profit))
    && Number(price) > 0;
}

function getChannelFeeRate(team) {
  return /ToB|B2B/i.test(String(team?.r1?.grid || team?.r1?.gridLabel || "")) ? 0.15 : 0.25;
}

function getPricingPct(team) {
  const direct = Number(team?.r2?.priceWtpPct);
  if (Number.isFinite(direct)) return direct;
  return null;
}

function normalizeNreToYuan(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  if (n === 0) return 0;
  return Math.abs(n) >= 1000000 ? n : n * 10000;
}

function getCardDetails(team) {
  const detail = Array.isArray(team?.r2?.cardsDetail) ? team.r2.cardsDetail : [];
  if (detail.length) return detail;
  return (Array.isArray(team?.r2?.cards) ? team.r2.cards : []).map((item) => {
    if (item && typeof item === "object") {
      return {
        id: item.id || item.cap_id || item.name,
        name: item.name || item.label || item.id || "能力卡",
        dim: item.dim || item.dimension || "",
        dimKey: item.dimKey || item.group_id || "",
        tier: item.tier || item.tierLabel || "",
        tierLabel: item.tierLabel || TIER_LABEL[item.tier] || item.tier || ""
      };
    }
    const label = String(item || "");
    const tier = label.includes("高") ? "高" : (label.includes("中") ? "中" : (label.includes("低") ? "低" : ""));
    const dim = DIMENSIONS.find((entry) => entry.aliases.some((alias) => label.includes(alias)))?.label || "";
    return { id: label, name: label.replace(/·(高|中|低)$/, ""), dim, dimKey: "", tier, tierLabel: tier };
  });
}

function cardDimLabel(card) {
  const values = [card?.dimKey, card?.dim, card?.dimension, card?.group_id]
    .map((value) => String(value || "").trim())
    .filter(Boolean);
  for (const dim of DIMENSIONS) {
    if (values.some((value) => dim.aliases.includes(value) || value === dim.label)) return dim.label;
  }
  return "其他";
}

function getTierRank(card) {
  return TIER_RANK[card?.tier] || TIER_RANK[card?.tierLabel] || 0;
}

function tierTone(rank) {
  if (rank >= 3) return { bg: "#fef3c7", color: "#92400e", text: "高" };
  if (rank === 2) return { bg: "#dbeafe", color: "#1d4ed8", text: "中" };
  if (rank === 1) return { bg: "#f1f5f9", color: "#475569", text: "低" };
  return { bg: "#f8fafc", color: "#94a3b8", text: "—" };
}

function selectVpLineup(teams) {
  const valid = teams
    .filter((team) => team?.r1?.who || team?.r1?.pain || team?.r1?.how || team?.r1?.vp)
    .slice()
    .sort((a, b) => Number(getVpTotal(b) || 0) - Number(getVpTotal(a) || 0));
  if (valid.length <= 3) return valid;
  const picked = [valid[0], valid[Math.floor(valid.length / 2)], valid[valid.length - 1]];
  return Array.from(new Map(picked.map((team) => [team.id, team])).values()).slice(0, 3);
}

function selectAutopsyTeams(teams) {
  const submitted = teams.filter(isSubmittedR2).slice();
  if (submitted.length <= 2) return submitted;
  const top = submitted.slice().sort((a, b) => Number(b?.r2?.profit || 0) - Number(a?.r2?.profit || 0))[0];
  const contrast = submitted
    .filter((team) => team.id !== top.id)
    .sort((a, b) => {
      const byProfit = Number(a?.r2?.profit || 0) - Number(b?.r2?.profit || 0);
      if (byProfit !== 0) return byProfit;
      return Number(getCardDetails(b).length || 0) - Number(getCardDetails(a).length || 0);
    })[0];
  return [top, contrast].filter(Boolean);
}

function buildStorageKey(meta) {
  const marker = [
    meta?.session_date,
    meta?.sessionDate,
    meta?.session_id,
    meta?.sessionId,
    "default"
  ].find((value) => String(value || "").trim());
  return `emba_classroom_debrief_reveals_${String(marker || "default").replace(/[^\w-]/g, "_")}`;
}

function readRevealSet(storageKey) {
  if (typeof window === "undefined") return new Set();
  try {
    const parsed = JSON.parse(window.sessionStorage.getItem(storageKey) || "[]");
    return new Set(Array.isArray(parsed) ? parsed : []);
  } catch (_) {
    return new Set();
  }
}

function Reveal({ id, order = 999, revealed, onReveal, children, block = false }) {
  const open = revealed.has(id);
  return (
    <span
      data-reveal-key={id}
      data-reveal-order={order}
      onClick={(event) => {
        event.stopPropagation();
        if (!open) onReveal(id);
      }}
      style={{
        display: block ? "block" : "inline-block",
        position: "relative",
        borderRadius: 10,
        cursor: open ? "default" : "pointer",
        minHeight: block ? 1 : undefined
      }}
    >
      <span
        style={{
          display: block ? "block" : "inline-block",
          filter: open ? "none" : "blur(9px)",
          opacity: open ? 1 : 0.34,
          transition: "filter 180ms ease, opacity 180ms ease"
        }}
      >
        {children}
      </span>
      {!open ? (
        <span
          style={{
            position: "absolute",
            inset: 0,
            borderRadius: 10,
            border: "1px dashed rgba(245, 158, 11, 0.55)",
            background: "rgba(255, 251, 235, 0.64)",
            color: "#92400e",
            fontSize: 12,
            fontWeight: 900,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            letterSpacing: "0.08em",
            pointerEvents: "none"
          }}
        >
          揭晓
        </span>
      ) : null}
    </span>
  );
}

function TeamChip({ team, anonymous, onFocus, compact = false, large = false, round = "" }) {
  return (
    <button
      type="button"
      onClick={() => onFocus(team.id, round)}
      title={getTeamLabel(team, anonymous)}
      style={{
        border: `1px solid ${team.color || "#cbd5e1"}`,
        background: `${team.color || "#1a5c3a"}16`,
        color: team.color || "#1a5c3a",
        borderRadius: 999,
        padding: compact ? "5px 9px" : (large ? "9px 17px" : "7px 12px"),
        display: "inline-flex",
        alignItems: "center",
        gap: large ? 9 : 7,
        fontSize: compact ? 11 : (large ? 17 : 13),
        fontWeight: 900,
        cursor: "pointer",
        whiteSpace: "nowrap"
      }}
    >
      <span style={{ width: large ? 12 : 9, height: large ? 12 : 9, borderRadius: 999, background: team.color || "#1a5c3a" }} />
      {getTeamLabel(team, anonymous)}
      {getArchSymbol(team) ? <span style={{ color: "#475569" }}>{getArchSymbol(team)}</span> : null}
    </button>
  );
}

function SlideTitle({ title, subtitle }) {
  return (
    <div style={{ marginBottom: 18 }}>
      <div style={{ fontSize: 30, lineHeight: 1.18, fontWeight: 950, color: "#0f172a" }}>{title}</div>
      {subtitle ? <div style={{ marginTop: 8, fontSize: 15, color: "#64748b", lineHeight: 1.7 }}>{subtitle}</div> : null}
    </div>
  );
}

function CoverSlide({ teams, round1Teams, round2Teams }) {
  const profitableCount = round2Teams.filter((team) => Number(team?.r2?.profit || 0) > 0).length;
  const topTeam = round2Teams[0] || null;
  return (
    <div style={{ display: "grid", gap: 18 }}>
      <div style={{ ...CARD_STYLE, padding: 28, background: "linear-gradient(135deg, #0f172a, #1f2937)", borderColor: "#1f2937", color: "#fff" }}>
        <div style={{ fontSize: 13, color: "#86efac", fontWeight: 900, letterSpacing: "0.24em" }}>课堂复盘</div>
        <div style={{ marginTop: 14, fontSize: 38, fontWeight: 950, lineHeight: 1.18 }}>LOVOT 商业模拟</div>
        <div style={{ marginTop: 12, fontSize: 17, color: "#cbd5e1", lineHeight: 1.7 }}>
          R1 市场定位 · R2 产品研发 · 教师投影简版
        </div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 14 }}>
        <Metric label="总组数" value={teams.length} tone="#1a5c3a" />
        <Metric label="R1 已提交" value={`${round1Teams.length}/${teams.length || 0}`} tone="#2563eb" />
        <Metric label="R2 已提交" value={`${round2Teams.length}/${teams.length || 0}`} tone="#7c3aed" />
        <Metric label="盈利组数" value={profitableCount} tone="#059669" />
      </div>
      <div style={CARD_STYLE}>
        <div style={{ fontSize: 13, fontWeight: 900, color: "#64748b", marginBottom: 10 }}>课堂顺序</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: 12 }}>
          {["战略地形", "VP 对决", "利润揭榜", "双组拆解", "定价带", "意图 vs 执行"].map((item, index) => (
            <div key={item} style={{ padding: "12px 14px", borderRadius: 14, background: "#f8fafc", border: "1px solid #e2e8f0" }}>
              <div style={{ color: "#1a5c3a", fontSize: 12, fontWeight: 900 }}>0{index + 1}</div>
              <div style={{ marginTop: 4, fontSize: 16, fontWeight: 900, color: "#0f172a" }}>{item}</div>
            </div>
          ))}
        </div>
        {topTeam ? (
          <div style={{ marginTop: 14, fontSize: 13, color: "#475569" }}>
            当前利润第一：<strong style={{ color: topTeam.color }}>{topTeam.displayName}</strong>，{formatWan(topTeam?.r2?.profit)}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function Metric({ label, value, tone }) {
  return (
    <div style={{ ...CARD_STYLE, padding: 18 }}>
      <div style={{ fontSize: 30, fontWeight: 950, color: tone }}>{value}</div>
      <div style={{ marginTop: 5, color: "#64748b", fontSize: 12, fontWeight: 800 }}>{label}</div>
    </div>
  );
}

function DirectoryCard({ index, title, detail, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        textAlign: "left",
        background: "#fff",
        border: "1px solid #dbe3ef",
        borderRadius: 16,
        padding: "18px 20px",
        cursor: "pointer",
        minHeight: 118,
        display: "grid",
        alignContent: "start",
        gap: 8
      }}
    >
      <div style={{ color: "#0f172a", fontSize: 22, fontWeight: 950, lineHeight: 1.25 }}>{index} {title}</div>
      <div style={{ color: "#64748b", fontSize: 14, fontWeight: 750, lineHeight: 1.55 }}>{detail}</div>
    </button>
  );
}

function TeamButtonStrip({ teams, anonymous, onFocus, round }) {
  if (!teams.length) {
    return <div style={{ marginTop: 18, color: "#94a3b8", fontSize: 13 }}>暂无小组数据</div>;
  }
  return (
    <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginTop: 22 }}>
      {teams.map((team) => (
        <TeamChip key={team.id} team={team} anonymous={anonymous} onFocus={onFocus} round={round} large />
      ))}
    </div>
  );
}

function R1IndexSlide({ teams, anonymous, onFocus, onGo }) {
  return (
    <div>
      <SlideTitle title="R1 复盘 · 市场定位" subtitle="约 25 分钟 · 三个对比页承载教学，组页供取证跳转。" />
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(230px, 1fr))", gap: 14 }}>
        <DirectoryCard index="①" title="战略地形图" detail="个人选择 vs 团队定稿 · 聚集与空白" onClick={() => onGo("r1-map")} />
        <DirectoryCard index="②" title="VP 对决" detail="三份匿名 VP · 全场排序后揭晓" onClick={() => onGo("r1-vp")} />
        <DirectoryCard index="③" title="定位宽窄图" detail="C × (G+E) · 宽而浅 vs 窄而深" onClick={() => onGo("r1-scatter")} />
      </div>
      <TeamButtonStrip teams={teams} anonymous={anonymous} onFocus={onFocus} round="r1" />
    </div>
  );
}

function R2IndexSlide({ teams, anonymous, onFocus, onGo }) {
  return (
    <div>
      <SlideTitle title="R2 复盘 · 产品研发" subtitle="约 20 分钟 · 从结果倒推配置，再回看意图。" />
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(230px, 1fr))", gap: 14 }}>
        <DirectoryCard index="①" title="利润揭榜" detail="先押冠军，从末位逐名揭示" onClick={() => onGo("r2-board")} />
        <DirectoryCard index="②" title="双组拆解" detail="精准组 vs 堆料组 · 利润瀑布对照" onClick={() => onGo("r2-autopsy")} />
        <DirectoryCard index="③" title="定价带" detail="定价 / 支付意愿 · 60–90% 绿带" onClick={() => onGo("r2-pricing")} />
        <DirectoryCard index="④" title="选卡全景" detail="六维热力 + 研发投入 vs 利润" onClick={() => onGo("r2-cards")} />
        <DirectoryCard index="⑤" title="意图 vs 执行" detail="R1 承诺 vs R2 卡组 · 一致性判语" onClick={() => onGo("r2-intent")} />
      </div>
      <TeamButtonStrip teams={teams} anonymous={anonymous} onFocus={onFocus} round="r2" />
    </div>
  );
}

function GridMap({ teams, mode, anonymous, onFocus }) {
  const cellMap = {};
  teams.forEach((team) => {
    const key = gridCellKeyFromGridId(team?.r1?.grid);
    if (key) {
      if (!cellMap[key]) cellMap[key] = { teams: [], members: [] };
      cellMap[key].teams.push(team);
    }
    (team?.members || []).forEach((member) => {
      const memberKey = gridCellKeyFromGridId(member?.r1_personal?.grid);
      if (!memberKey) return;
      if (!cellMap[memberKey]) cellMap[memberKey] = { teams: [], members: [] };
      cellMap[memberKey].members.push({ team, member });
    });
  });

  return (
    <div style={{ display: "grid", gridTemplateColumns: "92px repeat(3, minmax(0, 1fr))", gap: 7 }}>
      <div />
      {GRID_COLS.map((col) => (
        <div key={col} style={{ textAlign: "center", color: "#64748b", fontSize: 12, fontWeight: 900 }}>{col}</div>
      ))}
      {GRID_ROWS.map((row) => (
        <div key={row.key} style={{ display: "contents" }}>
          <div style={{ color: "#64748b", fontSize: 12, fontWeight: 900, textAlign: "right", paddingRight: 8, display: "flex", alignItems: "center", justifyContent: "flex-end" }}>
            {row.label}
          </div>
          {GRID_COLS.map((col) => {
            const info = cellMap[`${row.key}|${col}`] || { teams: [], members: [] };
            const empty = mode === "personal" ? !info.members.length : !info.teams.length;
            return (
              <div
                key={`${row.key}-${col}`}
                style={{
                  minHeight: 104,
                  borderRadius: 14,
                  border: empty ? "1px dashed #cbd5e1" : "1px solid #dbe3ef",
                  background: empty ? "#f8fafc" : "#fff",
                  padding: 10,
                  display: "flex",
                  flexWrap: "wrap",
                  gap: 8,
                  alignContent: "center",
                  justifyContent: "center"
                }}
              >
                {mode === "personal" ? info.members.map(({ team, member }, index) => (
                  <span
                    key={`${member.id}-${index}`}
                    title={`${getTeamLabel(team, anonymous)} · ${member.name || "成员"}`}
                    style={{ width: 18, height: 18, borderRadius: 999, background: team.color || "#1a5c3a", opacity: 0.78, border: "2px solid #fff", boxShadow: "0 0 0 1px rgba(15,23,42,0.08)" }}
                  />
                )) : info.teams.map((team) => (
                  <button
                    key={team.id}
                    type="button"
                    onClick={() => onFocus(team.id, "r1")}
                    title={`${getTeamLabel(team, anonymous)} · ${normalizeGridLabel(team?.r1?.gridLabel)}`}
                    style={{
                      width: 38,
                      height: 38,
                      borderRadius: 999,
                      border: "2px solid #fff",
                      background: team.color || "#1a5c3a",
                      color: "#fff",
                      fontSize: 13,
                      fontWeight: 950,
                      boxShadow: "0 6px 14px rgba(15,23,42,0.14)",
                      cursor: "pointer"
                    }}
                  >
                    {getTeamNo(team)}
                    {getArchSymbol(team)}
                  </button>
                ))}
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

function R1MapSlide({ teams, anonymous, onFocus }) {
  return (
    <div>
      <SlideTitle title="战略地形图" subtitle="个人选择与团队定稿并排看：聚集格、空白格、组内偏离都会浮出来。" />
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        <div style={CARD_STYLE}>
          <div style={{ marginBottom: 12, color: "#64748b", fontSize: 13, fontWeight: 900 }}>个人选择</div>
          <GridMap teams={teams} mode="personal" anonymous={anonymous} onFocus={onFocus} />
        </div>
        <div style={CARD_STYLE}>
          <div style={{ marginBottom: 12, color: "#64748b", fontSize: 13, fontWeight: 900 }}>团队定稿</div>
          <GridMap teams={teams} mode="team" anonymous={anonymous} onFocus={onFocus} />
        </div>
      </div>
    </div>
  );
}

function R1VpSlide({ teams, anonymous, onFocus, revealed, onReveal }) {
  const lineup = selectVpLineup(teams);
  if (!lineup.length) {
    return <EmptySlide title="VP 对决暂无数据" detail="等团队完成 Round 1 后，这里会自动出现三份可对比 VP。" />;
  }
  const letters = ["A", "B", "C"];
  return (
    <div>
      <SlideTitle title="VP 对决" subtitle="三份匿名 VP 并排，C/G/E 分别贴在 WHO/PAIN/HOW 字段上，按列揭晓。" />
      <div style={{ display: "grid", gridTemplateColumns: `repeat(${lineup.length}, minmax(0, 1fr))`, gap: 16 }}>
        {lineup.map((team, index) => {
          const total = getVpTotal(team);
          return (
            <div key={team.id} style={{ ...CARD_STYLE, borderTop: `5px solid ${team.color || "#1a5c3a"}` }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center", marginBottom: 12 }}>
                <div style={{ color: "#64748b", fontSize: 12, fontWeight: 950, letterSpacing: "0.14em" }}>VP {letters[index]}</div>
                <Reveal id={`r1-vp-team-${team.id}`} order={index} revealed={revealed} onReveal={onReveal}>
                  <TeamChip team={team} anonymous={anonymous} onFocus={onFocus} compact round="r1" />
                </Reveal>
              </div>
              <VpField label="WHO" scoreLabel="C" score={team?.r1?.C} value={team?.r1?.who} revealId={`r1-vp-c-${team.id}`} order={index} revealed={revealed} onReveal={onReveal} />
              <VpField label="PAIN" scoreLabel="G" score={team?.r1?.G} value={team?.r1?.pain} revealId={`r1-vp-g-${team.id}`} order={index} revealed={revealed} onReveal={onReveal} />
              <VpField label="HOW" scoreLabel="E" score={team?.r1?.Eadj ?? team?.r1?.E} value={team?.r1?.how} revealId={`r1-vp-e-${team.id}`} order={index} revealed={revealed} onReveal={onReveal} clampLines />
              <div style={{ borderTop: "1px solid #e2e8f0", paddingTop: 12, marginTop: 14, display: "flex", justifyContent: "flex-end" }}>
                <Reveal id={`r1-vp-total-${team.id}`} order={index} revealed={revealed} onReveal={onReveal}>
                  <span style={{ padding: "7px 12px", borderRadius: 999, background: "#fef3c7", color: "#92400e", fontSize: 13, fontWeight: 950 }}>
                    综合 {formatScore(total)}
                  </span>
                </Reveal>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function VpField({ label, scoreLabel, score, value, revealId, order, revealed, onReveal, clampLines = false }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginBottom: 6 }}>
        <div style={{ color: "#64748b", fontSize: 12, fontWeight: 950, letterSpacing: "0.16em" }}>{label}</div>
        <Reveal id={revealId} order={order} revealed={revealed} onReveal={onReveal}>
          <span style={{ padding: "3px 9px", borderRadius: 8, background: "#f8fafc", border: "1px solid #e2e8f0", color: "#0f172a", fontSize: 12, fontWeight: 900 }}>
            {scoreLabel} <strong style={{ color: "#1a5c3a", fontSize: 18 }}>{formatScore(score)}</strong>
          </span>
        </Reveal>
      </div>
      <div
        title={String(value || "")}
        style={{
          minHeight: 48,
          color: value ? "#0f172a" : "#94a3b8",
          fontSize: 17,
          lineHeight: 1.65,
          display: clampLines ? "-webkit-box" : "block",
          WebkitBoxOrient: clampLines ? "vertical" : undefined,
          WebkitLineClamp: clampLines ? 3 : undefined,
          overflow: clampLines ? "hidden" : undefined
        }}
      >
        {value || "未提交"}
      </div>
    </div>
  );
}

function R1ScatterSlide({ teams, anonymous, onFocus }) {
  const zones = Array.from({ length: 9 }, () => []);
  teams.forEach((team) => {
    const c = Number(team?.r1?.C);
    const g = Number(team?.r1?.G);
    const e = Number(team?.r1?.Eadj ?? team?.r1?.E);
    if (!Number.isFinite(c) || !Number.isFinite(g) || !Number.isFinite(e)) return;
    const x = c < 2.7 ? 0 : (c < 3.7 ? 1 : 2);
    const ge = g + e;
    const y = ge >= 7.4 ? 0 : (ge >= 5.4 ? 1 : 2);
    zones[y * 3 + x].push(team);
  });

  return (
    <div>
      <SlideTitle title="定位宽窄图" subtitle="横轴看覆盖宽度，纵轴看价值深度。右下角和左上角通常最值得追问。" />
      <div style={{ ...CARD_STYLE, display: "grid", gridTemplateColumns: "44px 1fr", gridTemplateRows: "1fr 34px", gap: 8 }}>
        <div style={{ writingMode: "vertical-rl", transform: "rotate(180deg)", color: "#64748b", fontSize: 12, fontWeight: 900, display: "flex", alignItems: "center", justifyContent: "center" }}>
          价值深度
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gridTemplateRows: "repeat(3, 120px)", gap: 10 }}>
          {zones.map((zoneTeams, index) => (
            <div
              key={index}
              style={{
                position: "relative",
                borderRadius: 14,
                border: "1px dashed #cbd5e1",
                background: index === 2 || index === 6 ? "#fffbeb" : "#f8fafc",
                padding: 12,
                display: "flex",
                flexWrap: "wrap",
                gap: 8,
                alignItems: "center",
                justifyContent: "center"
              }}
            >
              {index === 2 ? <span style={{ position: "absolute", top: 8, left: 10, color: "#92400e", fontSize: 11, fontWeight: 900 }}>窄而深</span> : null}
              {index === 6 ? <span style={{ position: "absolute", top: 8, left: 10, color: "#92400e", fontSize: 11, fontWeight: 900 }}>宽而浅</span> : null}
              {zoneTeams.map((team) => (
                <TeamChip key={team.id} team={team} anonymous={anonymous} onFocus={onFocus} compact round="r1" />
              ))}
            </div>
          ))}
        </div>
        <div />
        <div style={{ color: "#64748b", fontSize: 12, fontWeight: 900, textAlign: "center" }}>覆盖宽度</div>
      </div>
    </div>
  );
}

function R2BoardSlide({ teams, anonymous, onFocus, revealed, onReveal }) {
  const done = teams.filter(isSubmittedR2).slice().sort((a, b) => Number(b?.r2?.profit || 0) - Number(a?.r2?.profit || 0));
  const pending = teams.filter((team) => !isSubmittedR2(team));
  if (!done.length && !pending.length) {
    return <EmptySlide title="利润揭榜暂无数据" detail="等至少一组完成 Round 2 后，这里会显示排名。" />;
  }

  return (
    <div>
      <SlideTitle title="利润揭榜" subtitle="排名按平台结算利润展示，揭示顺序从未完成组和末位开始。" />
      <div style={{ ...CARD_STYLE, display: "grid", gap: 10 }}>
        {done.map((team, index) => {
          const order = pending.length + (done.length - index);
          const profit = Number(team?.r2?.profit || 0);
          return (
            <Reveal key={team.id} id={`r2-board-${team.id}`} order={order} revealed={revealed} onReveal={onReveal} block>
              <RankingRow
                rank={index + 1}
                team={team}
                anonymous={anonymous}
                onFocus={onFocus}
                profit={profit}
                product={clipText(team?.r1?.how || team?.r1?.vp || "产品方案", 30)}
              />
            </Reveal>
          );
        })}
        {pending.map((team, index) => (
          <Reveal key={team.id} id={`r2-board-pending-${team.id}`} order={index} revealed={revealed} onReveal={onReveal} block>
            <RankingRow rank="—" team={team} anonymous={anonymous} onFocus={onFocus} profit={null} product="未完成" />
          </Reveal>
        ))}
      </div>
    </div>
  );
}

function RankingRow({ rank, team, anonymous, onFocus, profit, product }) {
  const positive = Number(profit) >= 0;
  return (
    <div style={{
      display: "grid",
      gridTemplateColumns: "70px 170px 1fr 180px",
      gap: 14,
      alignItems: "center",
      padding: "13px 16px",
      borderRadius: 14,
      border: "1px solid #e2e8f0",
      background: "#fff"
    }}>
      <div style={{ fontSize: 24, fontWeight: 950, color: rank === 1 ? "#b45309" : "#64748b" }}>#{rank}</div>
      <TeamChip team={team} anonymous={anonymous} onFocus={onFocus} round="r2" />
      <div style={{ color: "#334155", fontSize: 15, lineHeight: 1.55 }}>{product}</div>
      <div style={{ textAlign: "right", color: profit == null ? "#64748b" : (positive ? "#166534" : "#dc2626"), fontSize: profit == null ? 18 : 24, fontWeight: 950 }}>
        {profit == null ? "未完成" : formatWan(profit)}
      </div>
    </div>
  );
}

function R2AutopsySlide({ teams, anonymous, onFocus }) {
  const pair = selectAutopsyTeams(teams);
  if (pair.length < 2) {
    return <EmptySlide title="双组拆解暂无足够样本" detail="至少需要两组完成 Round 2，才能展示对照拆解。" />;
  }
  return (
    <div>
      <SlideTitle title="双组拆解" subtitle="并排看两个方案：定价、渠道费、变动成本、销量和结算利润如何层层传导。" />
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        {pair.map((team) => (
          <WaterfallCard key={team.id} team={team} anonymous={anonymous} onFocus={onFocus} />
        ))}
      </div>
    </div>
  );
}

function WaterfallCard({ team, anonymous, onFocus }) {
  const price = Number(team?.r2?.price);
  const dCOGS = Number(team?.r2?.dCOGS);
  const units = Number(team?.r2?.units);
  const profit = Number(team?.r2?.profit);
  const subProfit = Number(team?.r2?.profitSub || 0);
  const feeRate = getChannelFeeRate(team);
  const netPrice = Number.isFinite(price) ? price * (1 - feeRate) : null;
  const variableCost = Number.isFinite(dCOGS) ? ROUND2_BASE_VARIABLE_COST + dCOGS : null;
  const unitMargin = Number.isFinite(netPrice) && Number.isFinite(variableCost) ? netPrice - variableCost : null;
  const fixedCost = toFiniteNumber(team?.r2?.fixedCost, normalizeNreToYuan(team?.r2?.nre));
  const subPerUnit = Number.isFinite(subProfit) && Number.isFinite(units) && units > 0 ? subProfit / units : 0;
  const unitContribution = Number.isFinite(unitMargin) ? unitMargin + subPerUnit : null;
  const payback = Number.isFinite(unitContribution) && unitContribution > 0 && Number.isFinite(fixedCost)
    ? Math.ceil(fixedCost / unitContribution)
    : null;

  const rows = [
    { label: "定价", value: formatMoney(price), tone: "#0f172a" },
    { label: `渠道后到手`, value: formatMoney(netPrice), hint: `费率 ${formatPercent(feeRate * 100)}`, tone: "#2563eb" },
    { label: "变动成本", value: formatMoney(variableCost), hint: "基础成本 + dCOGS", tone: "#dc2626" },
    { label: "单台毛利", value: formatMoney(unitMargin), tone: Number(unitMargin) >= 0 ? "#166534" : "#dc2626" },
    { label: "销量", value: `${formatCompactNumber(units)} 台`, tone: "#0f172a" },
    { label: "订阅利润", value: formatWan(subProfit), tone: "#7c3aed" },
    { label: "总利润", value: formatWan(profit), tone: Number(profit) >= 0 ? "#166534" : "#dc2626", strong: true }
  ];

  return (
    <div style={{ ...CARD_STYLE, borderTop: `5px solid ${team.color || "#1a5c3a"}` }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 14 }}>
        <TeamChip team={team} anonymous={anonymous} onFocus={onFocus} round="r2" />
        <div style={{ color: "#64748b", fontSize: 12, fontWeight: 800 }}>{normalizeGridLabel(team?.r1?.gridLabel)}</div>
      </div>
      <div style={{ display: "grid", gap: 8 }}>
        {rows.map((row) => (
          <div key={row.label} style={{ display: "grid", gridTemplateColumns: "1fr 130px", gap: 10, alignItems: "center", padding: "9px 11px", borderRadius: 12, background: row.strong ? "#f8fafc" : "#fff", border: "1px solid #e2e8f0" }}>
            <div>
              <div style={{ color: "#475569", fontSize: 13, fontWeight: 850 }}>{row.label}</div>
              {row.hint ? <div style={{ color: "#94a3b8", fontSize: 10, marginTop: 2 }}>{row.hint}</div> : null}
            </div>
            <div style={{ textAlign: "right", color: row.tone, fontSize: row.strong ? 20 : 16, fontWeight: 950 }}>{row.value}</div>
          </div>
        ))}
      </div>
      <div style={{ marginTop: 14, padding: 16, borderRadius: 14, background: "#fffbeb", border: "1px solid #fde68a", textAlign: "center" }}>
        <div style={{ color: "#92400e", fontSize: 12, fontWeight: 900 }}>回本销量</div>
        <div style={{ color: "#92400e", fontSize: 30, fontWeight: 950, marginTop: 4 }}>
          {payback == null ? "∞" : `${formatCompactNumber(payback)} 台`}
        </div>
      </div>
    </div>
  );
}

function R2PricingSlide({ teams, anonymous, onFocus }) {
  const rows = teams
    .map((team) => ({ team, pct: getPricingPct(team) }))
    .filter(({ team }) => team?.r2?.price != null || team?.r2?.profit != null);
  const hasPct = rows.some((row) => Number.isFinite(row.pct));
  const maxPct = Math.max(120, ...rows.map((row) => Number(row.pct || 0)));

  return (
    <div>
      <SlideTitle title="定价带" subtitle="只显示百分比：定价占所在细分市场支付意愿空间的比例，绿色带为 60% 到 90%。" />
      {!hasPct ? (
        <PricingFallbackScatter teams={teams} anonymous={anonymous} onFocus={onFocus} />
      ) : (
        <div style={{ ...CARD_STYLE, display: "grid", gap: 14 }}>
          {rows.map(({ team, pct }) => {
            const valid = Number.isFinite(pct);
            const inBand = valid && pct >= 60 && pct <= 90;
            const left = valid ? clamp((pct / maxPct) * 100, 0, 100) : 0;
            const sweetLeft = clamp((60 / maxPct) * 100, 0, 100);
            const sweetWidth = clamp((30 / maxPct) * 100, 0, 100 - sweetLeft);
            return (
              <div key={team.id} style={{ display: "grid", gridTemplateColumns: "170px 1fr 94px", gap: 14, alignItems: "center" }}>
                <TeamChip team={team} anonymous={anonymous} onFocus={onFocus} round="r2" />
                <div style={{ position: "relative", height: 34, borderRadius: 999, background: "#f1f5f9", border: "1px solid #e2e8f0", overflow: "hidden" }}>
                  <div style={{ position: "absolute", left: `${sweetLeft}%`, width: `${sweetWidth}%`, top: 0, bottom: 0, background: "rgba(16,185,129,0.22)", borderLeft: "1px solid rgba(16,185,129,0.7)", borderRight: "1px solid rgba(16,185,129,0.7)" }} />
                  {valid ? (
                    <div style={{ position: "absolute", left: `calc(${left}% - 2px)`, top: -5, width: 4, height: 44, borderRadius: 999, background: inBand ? "#10b981" : "#dc2626" }} />
                  ) : null}
                </div>
                <div style={{ textAlign: "right", color: valid ? (inBand ? "#166534" : "#dc2626") : "#64748b", fontSize: 22, fontWeight: 950 }}>
                  {valid ? formatPercent(pct, 0) : "无基准"}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function PricingFallbackScatter({ teams, anonymous, onFocus }) {
  const points = teams.filter(isSubmittedR2);
  if (!points.length) return <EmptySlide title="定价带暂无数据" detail="暂无可用于展示的定价与利润结果。" compact />;
  const minPrice = Math.min(...points.map((team) => Number(team?.r2?.price || 0)));
  const maxPrice = Math.max(...points.map((team) => Number(team?.r2?.price || 0)), minPrice + 1);
  const minProfit = Math.min(...points.map((team) => Number(team?.r2?.profit || 0)), 0);
  const maxProfit = Math.max(...points.map((team) => Number(team?.r2?.profit || 0)), minProfit + 1);
  const x = (value) => 58 + ((value - minPrice) / Math.max(1, maxPrice - minPrice)) * 620;
  const y = (value) => 30 + (1 - ((value - minProfit) / Math.max(1, maxProfit - minProfit))) * 300;
  return (
    <div style={CARD_STYLE}>
      <svg viewBox="0 0 740 380" style={{ width: "100%" }}>
        <line x1="58" y1="330" x2="700" y2="330" stroke="#cbd5e1" />
        <line x1="58" y1="30" x2="58" y2="330" stroke="#cbd5e1" />
        <line x1="58" y1={y(0)} x2="700" y2={y(0)} stroke="#e2e8f0" strokeDasharray="4 5" />
        {points.map((team) => (
          <g key={team.id} onClick={() => onFocus(team.id, "r2")} style={{ cursor: "pointer" }}>
            <circle cx={x(Number(team?.r2?.price || 0))} cy={y(Number(team?.r2?.profit || 0))} r="13" fill={team.color || "#1a5c3a"} fillOpacity="0.28" stroke={team.color || "#1a5c3a"} strokeWidth="2" />
            <text x={x(Number(team?.r2?.price || 0)) + 18} y={y(Number(team?.r2?.profit || 0)) + 5} fill="#334155" fontSize="13" fontWeight="800">
              {getTeamLabel(team, anonymous)}
            </text>
          </g>
        ))}
        <text x="360" y="365" textAnchor="middle" fill="#64748b" fontSize="12">定价</text>
        <text x="16" y="180" textAnchor="middle" fill="#64748b" fontSize="12" transform="rotate(-90 16 180)">利润</text>
      </svg>
    </div>
  );
}

function R2CardsSlide({ teams, anonymous, onFocus }) {
  const scatterTeams = teams.filter(isSubmittedR2);
  return (
    <div>
      <SlideTitle title="选卡全景" subtitle="左侧按六维看最高档位和张数，右侧看研发投入与总利润的位置关系。" />
      <div style={{ display: "grid", gridTemplateColumns: "1.15fr 0.85fr", gap: 16 }}>
        <div style={CARD_STYLE}>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr style={{ color: "#64748b" }}>
                  <th style={{ textAlign: "left", padding: "8px 10px", borderBottom: "1px solid #e2e8f0" }}>团队</th>
                  {DIMENSIONS.map((dim) => (
                    <th key={dim.key} style={{ textAlign: "center", padding: "8px 10px", borderBottom: "1px solid #e2e8f0" }}>{dim.label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {teams.map((team) => {
                  const cards = getCardDetails(team);
                  return (
                    <tr key={team.id}>
                      <td style={{ padding: "11px 10px", borderBottom: "1px solid #e2e8f0" }}>
                        <TeamChip team={team} anonymous={anonymous} onFocus={onFocus} compact round="r2" />
                      </td>
                      {DIMENSIONS.map((dim) => {
                        const picked = cards.filter((card) => cardDimLabel(card) === dim.label);
                        const bestRank = Math.max(0, ...picked.map(getTierRank));
                        const tone = tierTone(bestRank);
                        return (
                          <td key={dim.key} style={{ padding: "11px 10px", borderBottom: "1px solid #e2e8f0", textAlign: "center" }}>
                            <span
                              title={picked.map((card) => `${card.name || card.id} · ${card.tierLabel || TIER_LABEL[card.tier] || card.tier || ""}`).join("、") || "未选"}
                              style={{ minWidth: 36, height: 28, padding: "0 8px", borderRadius: 999, display: "inline-flex", alignItems: "center", justifyContent: "center", background: tone.bg, color: tone.color, fontSize: 12, fontWeight: 950 }}
                            >
                              {tone.text}{picked.length > 1 ? ` ×${picked.length}` : ""}
                            </span>
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
        <RdProfitScatter teams={scatterTeams} anonymous={anonymous} onFocus={onFocus} />
      </div>
    </div>
  );
}

function RdProfitScatter({ teams, anonymous, onFocus }) {
  if (!teams.length) return <div style={CARD_STYLE}><div style={{ color: "#64748b", fontSize: 13 }}>暂无 R2 利润样本</div></div>;
  const getSpend = (team) => Number(team?.r2?.rdSpend ?? team?.r2?.fixedCost ?? normalizeNreToYuan(team?.r2?.nre) ?? getCardDetails(team).length * 100000);
  const maxSpend = Math.max(1, ...teams.map(getSpend));
  const minProfit = Math.min(...teams.map((team) => Number(team?.r2?.profit || 0)), 0);
  const maxProfit = Math.max(...teams.map((team) => Number(team?.r2?.profit || 0)), minProfit + 1);
  const x = (value) => 46 + (value / maxSpend) * 330;
  const y = (value) => 24 + (1 - ((value - minProfit) / Math.max(1, maxProfit - minProfit))) * 250;
  return (
    <div style={CARD_STYLE}>
      <div style={{ color: "#64748b", fontSize: 13, fontWeight: 900, marginBottom: 10 }}>研发投入 × 利润</div>
      <svg viewBox="0 0 420 320" style={{ width: "100%" }}>
        <line x1="46" y1="274" x2="390" y2="274" stroke="#cbd5e1" />
        <line x1="46" y1="24" x2="46" y2="274" stroke="#cbd5e1" />
        <line x1="46" y1={y(0)} x2="390" y2={y(0)} stroke="#e2e8f0" strokeDasharray="4 5" />
        {teams.map((team) => (
          <g key={team.id} onClick={() => onFocus(team.id, "r2")} style={{ cursor: "pointer" }}>
            <circle cx={x(getSpend(team))} cy={y(Number(team?.r2?.profit || 0))} r="12" fill={team.color || "#1a5c3a"} fillOpacity="0.3" stroke={team.color || "#1a5c3a"} strokeWidth="2" />
            <text x={x(getSpend(team)) + 16} y={y(Number(team?.r2?.profit || 0)) + 5} fill="#334155" fontSize="12" fontWeight="800">
              {getTeamLabel(team, anonymous)}
            </text>
          </g>
        ))}
      </svg>
    </div>
  );
}

function R2IntentSlide({ teams, anonymous, onFocus, revealed, onReveal }) {
  if (!teams.length) {
    return <EmptySlide title="意图 vs 执行暂无数据" detail="暂无团队可展示。" />;
  }
  return (
    <div>
      <SlideTitle title="意图 vs 执行" subtitle="逐组看 R1 承诺、R2 匹配格、定价与高档卡占比，一致性判语按行揭示。" />
      <div style={{ ...CARD_STYLE, display: "grid", gap: 10 }}>
        <div style={{ display: "grid", gridTemplateColumns: "150px 1fr 1fr 110px 1.35fr", gap: 12, color: "#64748b", fontSize: 11, fontWeight: 950, padding: "0 10px" }}>
          <span>团队</span>
          <span>R1 定位</span>
          <span>R2 匹配</span>
          <span>高档卡</span>
          <span>一致性判语</span>
        </div>
        {teams.map((team, index) => {
          const cards = getCardDetails(team);
          const highCount = cards.filter((card) => getTierRank(card) >= 3).length;
          const highRatio = cards.length ? Math.round((highCount / cards.length) * 100) : null;
          const consistent = String(team?.r1?.grid || "") && String(team?.r1?.grid || "") === String(team?.r2?.bestGrid || "");
          const note = team?.r2?.consistencyNote || team?.r2?.consistency_note || (
            isSubmittedR2(team)
              ? (consistent ? "R1 定位与 R2 匹配格保持一致，执行没有明显漂移。" : "R2 匹配格偏离 R1 定位，值得追问打开卡组后的取舍。")
              : "未完成 R2，先记录 R1 意图，等结算后再追执行证据。"
          );
          return (
            <div key={team.id} style={{ display: "grid", gridTemplateColumns: "150px 1fr 1fr 110px 1.35fr", gap: 12, alignItems: "center", borderRadius: 14, border: "1px solid #e2e8f0", background: "#fff", padding: "12px 10px" }}>
              <TeamChip team={team} anonymous={anonymous} onFocus={onFocus} compact round="r2" />
              <div style={{ color: "#334155", fontSize: 13, lineHeight: 1.5 }}>{normalizeGridLabel(team?.r1?.gridLabel) || "未提交"} · {getArchText(team)}</div>
              <div style={{ color: consistent ? "#166534" : "#92400e", fontSize: 13, fontWeight: 800 }}>
                {normalizeGridLabel(team?.r2?.bestGridLabel) || (isSubmittedR2(team) ? "未识别" : "未完成")}
              </div>
              <div style={{ color: "#0f172a", fontSize: 15, fontWeight: 950 }}>{highRatio == null ? "—" : `${highRatio}%`}</div>
              <Reveal id={`r2-intent-${team.id}`} order={index} revealed={revealed} onReveal={onReveal} block>
                <div style={{ color: "#334155", fontSize: 13, lineHeight: 1.65 }}>{note}</div>
              </Reveal>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function MetaPill({ children, tone = "#334155" }) {
  return (
    <span style={{ padding: "7px 11px", borderRadius: 999, background: "#fff", border: "1px solid #dbe3ef", color: tone, fontSize: 12, fontWeight: 900 }}>
      {children}
    </span>
  );
}

function EvidenceCard({ label, children }) {
  return (
    <div style={{ ...CARD_STYLE, padding: 16 }}>
      <div style={{ color: "#64748b", fontSize: 11, fontWeight: 950, letterSpacing: "0.14em", marginBottom: 8 }}>{label}</div>
      <div style={{ color: "#334155", fontSize: 15, lineHeight: 1.7 }}>{children || "未提交"}</div>
    </div>
  );
}

function TeamBackButton({ children, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{ border: "1px solid #cbd5e1", background: "#fff", color: "#334155", borderRadius: 999, padding: "7px 12px", fontSize: 12, fontWeight: 900, cursor: "pointer", marginBottom: 14 }}
    >
      {children}
    </button>
  );
}

function R1TeamSlide({ team, anonymous, onBack }) {
  if (!team) return <EmptySlide title="R1 组页暂无数据" detail="未找到该小组。" />;
  const members = Array.isArray(team.members) ? team.members : [];
  const teamGridKey = gridCellKeyFromGridId(team?.r1?.grid);
  const devCount = members.filter((member) => {
    const memberGridKey = gridCellKeyFromGridId(member?.r1_personal?.grid);
    return teamGridKey && memberGridKey && memberGridKey !== teamGridKey;
  }).length;
  const feedback = team?.r1?.aiFeedback || team?.r1?.ai_feedback || team?.r1?.feedback || "";

  return (
    <div>
      <TeamBackButton onClick={onBack}>返回 R1 目录</TeamBackButton>
      <SlideTitle title={`${getTeamLabel(team, anonymous)} · R1 组页`} subtitle={getProductLabel(team)} />
      <div style={{ display: "flex", flexWrap: "wrap", gap: 9, marginBottom: 16 }}>
        <MetaPill>{normalizeGridLabel(team?.r1?.gridLabel) || "R1 未提交"}</MetaPill>
        <MetaPill>{getArchText(team)} {getArchSymbol(team)}</MetaPill>
        <MetaPill>C {formatScore(team?.r1?.C)} · G {formatScore(team?.r1?.G)} · E {formatScore(team?.r1?.Eadj ?? team?.r1?.E)}</MetaPill>
        <MetaPill tone={devCount > 0 ? "#92400e" : "#166534"}>{devCount > 0 ? `个人偏离团队定稿：${devCount} 人` : "个人与团队定稿一致"}</MetaPill>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 14 }}>
        <EvidenceCard label="WHO">{team?.r1?.who}</EvidenceCard>
        <EvidenceCard label="PAIN">{team?.r1?.pain}</EvidenceCard>
        <EvidenceCard label="HOW">{team?.r1?.how}</EvidenceCard>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: feedback ? "1fr 1fr" : "1fr", gap: 14, marginTop: 14 }}>
        <EvidenceCard label="成员个人选择">
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {members.length ? members.map((member, index) => (
              <span key={member.id || index} style={{ padding: "6px 9px", borderRadius: 999, background: "#f8fafc", border: "1px solid #e2e8f0", color: "#334155", fontSize: 12, fontWeight: 800 }}>
                {anonymous ? `成员${index + 1}` : (member.name || `成员${index + 1}`)} · {normalizeGridLabel(member?.r1_personal?.gridLabel) || "未提交"}
              </span>
            )) : "暂无成员提交"}
          </div>
        </EvidenceCard>
        {feedback ? <EvidenceCard label="AI 反馈摘要">{feedback}</EvidenceCard> : null}
      </div>
    </div>
  );
}

function CardsByDimension({ cards }) {
  return (
    <div style={{ display: "grid", gap: 10 }}>
      {DIMENSIONS.map((dim) => {
        const picked = cards.filter((card) => cardDimLabel(card) === dim.label);
        return (
          <div key={dim.key} style={{ display: "grid", gridTemplateColumns: "58px 1fr", gap: 10, alignItems: "start" }}>
            <div style={{ color: "#64748b", fontSize: 12, fontWeight: 950, paddingTop: 6 }}>{dim.label}</div>
            <div style={{ display: "flex", gap: 7, flexWrap: "wrap" }}>
              {picked.length ? picked.map((card, index) => {
                const tone = tierTone(getTierRank(card));
                return (
                  <span key={`${card.id || card.name}-${index}`} title={card.label || card.name} style={{ padding: "6px 9px", borderRadius: 999, background: tone.bg, color: tone.color, fontSize: 12, fontWeight: 900 }}>
                    {card.name || card.id || "能力卡"} · {card.tierLabel || tone.text}
                  </span>
                );
              }) : <span style={{ color: "#94a3b8", fontSize: 13, paddingTop: 6 }}>未选</span>}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function R2TeamSlide({ team, anonymous, onFocus, onBack, revealed, onReveal }) {
  if (!team) return <EmptySlide title="R2 组页暂无数据" detail="未找到该小组。" />;
  const cards = getCardDetails(team);
  const submitted = isSubmittedR2(team);
  const consistent = String(team?.r1?.grid || "") && String(team?.r1?.grid || "") === String(team?.r2?.bestGrid || "");
  const note = team?.r2?.consistencyNote || team?.r2?.consistency_note || (
    submitted
      ? (consistent ? "R1 定位与 R2 匹配格保持一致，执行没有明显漂移。" : "R2 匹配格偏离 R1 定位，值得追问打开卡组后的取舍。")
      : "未完成 R2，先记录 R1 意图，等结算后再追执行证据。"
  );

  return (
    <div>
      <TeamBackButton onClick={onBack}>返回 R2 目录</TeamBackButton>
      <SlideTitle title={`${getTeamLabel(team, anonymous)} · R2 组页`} subtitle={getProductLabel(team)} />
      <div style={{ display: "flex", flexWrap: "wrap", gap: 9, marginBottom: 16 }}>
        <MetaPill>R1 {normalizeGridLabel(team?.r1?.gridLabel) || "未提交"}</MetaPill>
        <MetaPill>R2 {normalizeGridLabel(team?.r2?.bestGridLabel) || (submitted ? "未识别" : "未完成")}</MetaPill>
        <MetaPill>定价 {submitted ? formatMoney(team?.r2?.price) : "未完成"}</MetaPill>
        <MetaPill tone={submitted ? (Number(team?.r2?.profit) >= 0 ? "#166534" : "#dc2626") : "#64748b"}>利润 {submitted ? formatWan(team?.r2?.profit) : "未完成"}</MetaPill>
        <MetaPill>选卡 {cards.length || Number(team?.r2?.cardCount || 0)} 张</MetaPill>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(320px, 0.9fr)", gap: 14 }}>
        <div style={CARD_STYLE}>
          <div style={{ color: "#64748b", fontSize: 11, fontWeight: 950, letterSpacing: "0.14em", marginBottom: 12 }}>六维选卡明细</div>
          <CardsByDimension cards={cards} />
          <div style={{ marginTop: 16, paddingTop: 14, borderTop: "1px solid #e2e8f0" }}>
            <div style={{ color: "#64748b", fontSize: 11, fontWeight: 950, letterSpacing: "0.14em", marginBottom: 8 }}>一致性判语</div>
            <Reveal id={`r2-team-note-${team.id}`} order={0} revealed={revealed} onReveal={onReveal} block>
              <div style={{ color: "#334155", fontSize: 15, lineHeight: 1.7 }}>{note}</div>
            </Reveal>
          </div>
        </div>
        {submitted ? (
          <WaterfallCard team={team} anonymous={anonymous} onFocus={onFocus} />
        ) : (
          <EmptySlide title="未完成结算" detail="该组暂无可展示的 R2 利润瀑布。" compact />
        )}
      </div>
    </div>
  );
}

function EndSlide({ revealed, onReveal }) {
  const lines = [
    "市场选择先于一切。",
    "问题被表述清楚，产品才有方向。",
    "配置同时买入收益，也买入成本结构。",
    "利润不是单点决策，是定位、选卡、定价与渠道共同结算。"
  ];
  return (
    <div style={{ ...CARD_STYLE, padding: "42px 28px", textAlign: "center", minHeight: 520, display: "flex", flexDirection: "column", justifyContent: "center" }}>
      <div style={{ fontSize: 30, fontWeight: 950, color: "#0f172a", marginBottom: 28 }}>四句话，收住课堂</div>
      <div style={{ display: "grid", gap: 18, maxWidth: 860, margin: "0 auto", width: "100%" }}>
        {lines.map((line, index) => (
          <Reveal key={line} id={`end-${index}`} order={index} revealed={revealed} onReveal={onReveal} block>
            <div style={{ padding: "18px 20px", borderRadius: 16, background: "#f8fafc", border: "1px solid #e2e8f0", fontSize: 24, fontWeight: 900, color: "#0f172a" }}>
              {line}
            </div>
          </Reveal>
        ))}
      </div>
    </div>
  );
}

function FocusPanel({ team, anonymous, onClose }) {
  if (!team) return null;
  const cards = getCardDetails(team);
  return (
    <div style={{ ...CARD_STYLE, marginTop: 16, borderLeft: `5px solid ${team.color || "#1a5c3a"}` }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "flex-start" }}>
        <div>
          <div style={{ fontSize: 16, fontWeight: 950, color: team.color || "#1a5c3a" }}>{getTeamLabel(team, anonymous)}</div>
          <div style={{ fontSize: 12, color: "#64748b", marginTop: 4 }}>
            {normalizeGridLabel(team?.r1?.gridLabel) || "R1 未提交"} · {getArchText(team)}
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          style={{ border: "1px solid #cbd5e1", background: "#fff", color: "#475569", borderRadius: 999, padding: "6px 10px", fontSize: 11, fontWeight: 900, cursor: "pointer" }}
        >
          关闭
        </button>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12, marginTop: 14 }}>
        {[
          { label: "WHO", value: team?.r1?.who },
          { label: "PAIN", value: team?.r1?.pain },
          { label: "HOW", value: team?.r1?.how }
        ].map((item) => (
          <div key={item.label} style={{ padding: 12, borderRadius: 14, background: "#f8fafc", border: "1px solid #e2e8f0" }}>
            <div style={{ color: "#64748b", fontSize: 10, fontWeight: 950, letterSpacing: "0.14em" }}>{item.label}</div>
            <div style={{ marginTop: 6, color: "#334155", fontSize: 12, lineHeight: 1.65 }}>{item.value || "未提交"}</div>
          </div>
        ))}
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 12 }}>
        {[
          { label: "C", value: formatScore(team?.r1?.C) },
          { label: "G", value: formatScore(team?.r1?.G) },
          { label: "E", value: formatScore(team?.r1?.Eadj ?? team?.r1?.E) },
          { label: "利润", value: isSubmittedR2(team) ? formatWan(team?.r2?.profit) : "未完成" },
          { label: "选卡", value: `${cards.length || Number(team?.r2?.cardCount || 0)} 张` }
        ].map((item) => (
          <span key={item.label} style={{ padding: "6px 10px", borderRadius: 999, background: "#f8fafc", border: "1px solid #e2e8f0", color: "#334155", fontSize: 12, fontWeight: 850 }}>
            {item.label}: <strong style={{ color: "#0f172a" }}>{item.value}</strong>
          </span>
        ))}
      </div>
    </div>
  );
}

function EmptySlide({ title, detail, compact = false }) {
  return (
    <div style={{ ...CARD_STYLE, textAlign: "center", padding: compact ? 24 : "80px 24px" }}>
      <div style={{ fontSize: 20, fontWeight: 950, color: "#0f172a" }}>{title}</div>
      <div style={{ marginTop: 8, color: "#64748b", fontSize: 13 }}>{detail}</div>
    </div>
  );
}

export default function ClassroomDebrief({ teams = [], meta = null }) {
  const [pageIndex, setPageIndex] = useState(0);
  const [anonymous, setAnonymous] = useState(true);
  const [focusedTeamId, setFocusedTeamId] = useState("");
  const storageKey = useMemo(() => buildStorageKey(meta), [meta]);
  const [revealed, setRevealed] = useState(() => readRevealSet(storageKey));
  const stageRef = useRef(null);

  const sortedTeams = useMemo(
    () => (teams || []).filter((team) => team?.id).slice().sort((a, b) => getTeamNo(a) - getTeamNo(b)),
    [teams]
  );

  const round1Teams = useMemo(
    () => sortedTeams.filter((team) => team?.r1?.grid).slice(),
    [sortedTeams]
  );

  const round2Teams = useMemo(
    () => sortedTeams.filter(isSubmittedR2).slice().sort((a, b) => Number(b?.r2?.profit || 0) - Number(a?.r2?.profit || 0)),
    [sortedTeams]
  );

  const slides = useMemo(
    () => {
      const r1TeamSlides = sortedTeams.map((team) => ({
        id: teamSlideId("r1", team.id),
        label: `R1 第${getTeamNo(team)}组`,
        section: "R1",
        teamRound: "r1",
        teamId: team.id
      }));
      const r2TeamSlides = sortedTeams.map((team) => ({
        id: teamSlideId("r2", team.id),
        label: `R2 第${getTeamNo(team)}组`,
        section: "R2",
        teamRound: "r2",
        teamId: team.id
      }));
      const nextSlides = [];
      BASE_SLIDES.forEach((slide) => {
        nextSlides.push(slide);
        if (slide.id === "r1-scatter") nextSlides.push(...r1TeamSlides);
        if (slide.id === "r2-intent") nextSlides.push(...r2TeamSlides);
      });
      return nextSlides;
    },
    [sortedTeams]
  );

  const navSlides = useMemo(
    () => slides.filter((slide) => !slide.teamRound),
    [slides]
  );

  const focusedTeam = useMemo(
    () => sortedTeams.find((team) => team.id === focusedTeamId) || null,
    [sortedTeams, focusedTeamId]
  );

  useEffect(() => {
    setRevealed(readRevealSet(storageKey));
  }, [storageKey]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.sessionStorage.setItem(storageKey, JSON.stringify(Array.from(revealed)));
  }, [revealed, storageKey]);

  useEffect(() => {
    setPageIndex((prev) => clamp(prev, 0, Math.max(0, slides.length - 1)));
  }, [slides.length]);

  useEffect(() => {
    stageRef.current?.scrollTo?.({ top: 0 });
  }, [pageIndex]);

  useEffect(() => {
    const onKeyDown = (event) => {
      const target = event.target;
      if (target?.matches?.("input,textarea,select") || target?.isContentEditable) return;
      if (event.key === "ArrowRight") {
        setPageIndex((prev) => clamp(prev + 1, 0, slides.length - 1));
      } else if (event.key === "ArrowLeft") {
        setPageIndex((prev) => clamp(prev - 1, 0, slides.length - 1));
      } else if (event.key === " ") {
        event.preventDefault();
        revealNext();
      } else if (event.key === "a" || event.key === "A") {
        setAnonymous((prev) => !prev);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });

  const revealOne = (id) => {
    setRevealed((prev) => {
      const next = new Set(prev);
      next.add(id);
      return next;
    });
  };

  const revealNext = () => {
    const nodes = Array.from(stageRef.current?.querySelectorAll("[data-reveal-key]") || []);
    const pending = nodes
      .map((node) => ({
        id: node.getAttribute("data-reveal-key"),
        order: Number(node.getAttribute("data-reveal-order") || 999)
      }))
      .filter((item) => item.id && !revealed.has(item.id));
    if (!pending.length) return;
    const minOrder = Math.min(...pending.map((item) => item.order));
    setRevealed((prev) => {
      const next = new Set(prev);
      pending.filter((item) => item.order === minOrder).forEach((item) => next.add(item.id));
      return next;
    });
  };

  const resetReveals = () => {
    const confirmed = window.confirm("确定重置课堂复盘的揭晓状态？");
    if (!confirmed) return;
    setRevealed(new Set());
  };

  const goToSlide = (slideId) => {
    const nextIndex = slides.findIndex((slide) => slide.id === slideId);
    if (nextIndex < 0) return;
    setFocusedTeamId("");
    setPageIndex(nextIndex);
  };

  const current = slides[pageIndex] || slides[0];

  const handleTeamFocus = (teamId, round = "") => {
    const targetRound = round || (current?.section === "R2" ? "r2" : "r1");
    const nextIndex = slides.findIndex((slide) => slide.id === teamSlideId(targetRound, teamId));
    if (nextIndex >= 0) {
      setFocusedTeamId("");
      setPageIndex(nextIndex);
      return;
    }
    setFocusedTeamId(teamId);
  };

  const renderSlide = () => {
    if (current.teamRound === "r1") {
      return <R1TeamSlide team={sortedTeams.find((team) => team.id === current.teamId)} anonymous={anonymous} onBack={() => goToSlide("r1-index")} />;
    }
    if (current.teamRound === "r2") {
      return <R2TeamSlide team={sortedTeams.find((team) => team.id === current.teamId)} anonymous={anonymous} onFocus={handleTeamFocus} onBack={() => goToSlide("r2-index")} revealed={revealed} onReveal={revealOne} />;
    }
    if (current.id === "cover") return <CoverSlide teams={sortedTeams} round1Teams={round1Teams} round2Teams={round2Teams} />;
    if (current.id === "r1-index") return <R1IndexSlide teams={sortedTeams} anonymous={anonymous} onFocus={handleTeamFocus} onGo={goToSlide} />;
    if (current.id === "r1-map") return <R1MapSlide teams={round1Teams} anonymous={anonymous} onFocus={handleTeamFocus} />;
    if (current.id === "r1-vp") return <R1VpSlide teams={round1Teams} anonymous={anonymous} onFocus={handleTeamFocus} revealed={revealed} onReveal={revealOne} />;
    if (current.id === "r1-scatter") return <R1ScatterSlide teams={round1Teams} anonymous={anonymous} onFocus={handleTeamFocus} />;
    if (current.id === "r2-index") return <R2IndexSlide teams={sortedTeams} anonymous={anonymous} onFocus={handleTeamFocus} onGo={goToSlide} />;
    if (current.id === "r2-board") return <R2BoardSlide teams={sortedTeams} anonymous={anonymous} onFocus={handleTeamFocus} revealed={revealed} onReveal={revealOne} />;
    if (current.id === "r2-autopsy") return <R2AutopsySlide teams={sortedTeams} anonymous={anonymous} onFocus={handleTeamFocus} />;
    if (current.id === "r2-pricing") return <R2PricingSlide teams={sortedTeams} anonymous={anonymous} onFocus={handleTeamFocus} />;
    if (current.id === "r2-cards") return <R2CardsSlide teams={sortedTeams} anonymous={anonymous} onFocus={handleTeamFocus} />;
    if (current.id === "r2-intent") return <R2IntentSlide teams={sortedTeams} anonymous={anonymous} onFocus={handleTeamFocus} revealed={revealed} onReveal={revealOne} />;
    if (current.id === "end") return <EndSlide revealed={revealed} onReveal={revealOne} />;
    return null;
  };

  return (
    <div style={{ display: "grid", gap: 14 }}>
      <div style={{ ...CARD_STYLE, padding: 0, overflow: "hidden", borderRadius: 18 }}>
        <div style={{ background: "#0f172a", color: "#fff", padding: "14px 18px", display: "flex", gap: 12, alignItems: "center", justifyContent: "space-between", flexWrap: "wrap" }}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 950 }}>课堂复盘</div>
            <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 3 }}>{current.section} · {current.label}</div>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {navSlides.map((slide) => {
              const index = slides.findIndex((item) => item.id === slide.id);
              const active = pageIndex === index
                || (current?.teamRound === "r1" && slide.id === "r1-index")
                || (current?.teamRound === "r2" && slide.id === "r2-index");
              return (
              <button
                key={slide.id}
                type="button"
                onClick={() => goToSlide(slide.id)}
                style={{
                  border: active ? "1px solid #86efac" : "1px solid rgba(255,255,255,0.14)",
                  background: active ? "rgba(134,239,172,0.16)" : "rgba(255,255,255,0.06)",
                  color: active ? "#dcfce7" : "#cbd5e1",
                  borderRadius: 999,
                  padding: "7px 10px",
                  fontSize: 11,
                  fontWeight: 850,
                  cursor: "pointer"
                }}
              >
                {slide.label}
              </button>
            );
            })}
          </div>
        </div>
        <div ref={stageRef} style={{ padding: 22, minHeight: 640, background: "#f8fafc" }}>
          {renderSlide()}
          <FocusPanel team={focusedTeam} anonymous={anonymous} onClose={() => setFocusedTeamId("")} />
        </div>
        <div style={{ borderTop: "1px solid #e2e8f0", background: "#fff", padding: "12px 18px", display: "flex", gap: 10, alignItems: "center", justifyContent: "space-between", flexWrap: "wrap" }}>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <ControlButton onClick={() => setPageIndex((prev) => clamp(prev - 1, 0, slides.length - 1))} disabled={pageIndex === 0}>上一页</ControlButton>
            <ControlButton onClick={() => setPageIndex((prev) => clamp(prev + 1, 0, slides.length - 1))} disabled={pageIndex === slides.length - 1}>下一页</ControlButton>
            <ControlButton onClick={revealNext} primary>揭晓</ControlButton>
            <ControlButton onClick={() => setAnonymous((prev) => !prev)}>{anonymous ? "匿名开" : "实名开"}</ControlButton>
            <ControlButton onClick={resetReveals}>重置揭晓</ControlButton>
          </div>
          <div style={{ color: "#64748b", fontSize: 12, fontWeight: 850 }}>
            {pageIndex + 1} / {slides.length}
          </div>
        </div>
      </div>
    </div>
  );
}

function ControlButton({ children, onClick, disabled = false, primary = false }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      style={{
        border: primary ? "none" : "1px solid #cbd5e1",
        background: disabled ? "#f1f5f9" : (primary ? "#1a5c3a" : "#fff"),
        color: disabled ? "#94a3b8" : (primary ? "#fff" : "#334155"),
        borderRadius: 10,
        padding: "9px 13px",
        fontSize: 12,
        fontWeight: 900,
        cursor: disabled ? "not-allowed" : "pointer"
      }}
    >
      {children}
    </button>
  );
}
