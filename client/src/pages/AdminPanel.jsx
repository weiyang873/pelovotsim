import { useEffect, useRef, useState } from "react";
import TeacherDebriefTabs from "../components/TeacherDebriefTabs";
import {
  exportTeacherResults,
  getTeacherSessionStatus,
  importStudentsForTeacher,
  openTeacherRound2,
  teacherForceAdvance,
  teacherForceEndInterview,
  teacherForceMerge,
  teacherForceMergeAll,
  teacherForceSubmitCards,
  teacherResetMember,
  teacherResetTeam,
  verifyTeacherCode
} from "../api/teacherApi";

const TEACHER_CODE_KEY = "emba_teacher_code";
const TABS = ["实时监控", "Round 1 复盘", "Round 2 复盘", "跨轮对比", "AI 讲解稿", "导出"];
const STATUS_ORDER = [
  "R2_NOT_STARTED",
  "R2_REVIEW",
  "R2_INTERVIEWING",
  "R2_INDIVIDUAL_CARDS",
  "R2_TEAM_MERGE",
  "R2_TEAM_DISCUSSION",
  "R2_SUBMITTED"
];
const STATUS_COLORS = {
  R2_NOT_STARTED: "#374151",
  R2_REVIEW: "#6B7280",
  R2_INTERVIEWING: "#3B82F6",
  R2_INDIVIDUAL_CARDS: "#8B5CF6",
  R2_TEAM_MERGE: "#F59E0B",
  R2_TEAM_DISCUSSION: "#10B981",
  R2_SUBMITTED: "#10B981"
};
const TIMEOUT_THRESHOLDS = {
  R2_INTERVIEWING: 15,
  R2_INDIVIDUAL_CARDS: 10,
  R2_TEAM_MERGE: 3,
  R2_TEAM_DISCUSSION: 20
};
const DIM_LABELS = {
  interaction: "交互",
  perception: "感知",
  motion: "运动",
  safety: "安全",
  extend: "扩展",
  ops: "运营"
};

function readTeacherCode() {
  if (typeof window === "undefined") return "";
  return window.localStorage.getItem(TEACHER_CODE_KEY) || "";
}

function saveTeacherCode(code) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(TEACHER_CODE_KEY, code);
}

function clearTeacherCode() {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(TEACHER_CODE_KEY);
}

function progressPercent(status) {
  const index = Math.max(0, STATUS_ORDER.indexOf(status));
  return ((index + 1) / STATUS_ORDER.length) * 100;
}

function timeoutState(team) {
  const limit = TIMEOUT_THRESHOLDS[team?.r2?.status];
  const minutes = Number(team?.r2?.durationMinutes || 0);
  if (!limit || minutes <= limit) return { kind: "normal", text: "" };
  const overtime = minutes - limit;
  return {
    kind: overtime >= Math.max(3, Math.ceil(limit / 2)) ? "critical" : "warning",
    text: `已超时 ${overtime} 分钟`
  };
}

function memberIndicator(teamStatus, member) {
  if (member.forcedByTeacher) return { icon: "⚡", color: "#F59E0B" };
  if (member.lastActivityMinutes >= 20 && teamStatus !== "R2_SUBMITTED") return { icon: "⚠", color: "#DC2626" };

  if (teamStatus === "R2_NOT_STARTED" || teamStatus === "R2_REVIEW") {
    return member.currentStep === "reviewing"
      ? { icon: "●", color: "#3B82F6" }
      : { icon: "○", color: "#94A3B8" };
  }

  if (teamStatus === "R2_INTERVIEWING") {
    if (member.interviewStatus === "completed") return { icon: "✓", color: "#10B981" };
    if (member.interviewStatus === "in_progress") return { icon: "●", color: "#3B82F6" };
    return { icon: "○", color: "#94A3B8" };
  }

  if (teamStatus === "R2_INDIVIDUAL_CARDS") {
    if (member.cardStatus === "submitted") return { icon: "✓", color: "#10B981" };
    if (member.cardStatus === "selecting") return { icon: "●", color: "#3B82F6" };
    if (member.interviewStatus === "in_progress") return { icon: "●", color: "#3B82F6" };
    return { icon: "○", color: "#94A3B8" };
  }

  if (teamStatus === "R2_TEAM_MERGE" || teamStatus === "R2_TEAM_DISCUSSION") {
    return { icon: "✓", color: "#10B981" };
  }

  if (teamStatus === "R2_SUBMITTED") {
    return { icon: "✓", color: "#10B981" };
  }

  return { icon: "○", color: "#94A3B8" };
}

function fmtMinutes(minutes) {
  const value = Number(minutes || 0);
  if (value < 60) return `${value} 分钟`;
  const hours = Math.floor(value / 60);
  const mins = value % 60;
  return mins ? `${hours} 小时 ${mins} 分钟` : `${hours} 小时`;
}

function detailInterviewLabel(member) {
  if (member.interviewStatus === "completed") return `✓ ${member.interviewRounds} 轮完成`;
  if (member.interviewStatus === "in_progress") return `● 第 ${Math.max(1, member.interviewRounds)} 轮`;
  return "— 未开始";
}

function detailCardLabel(member) {
  if (member.cardStatus === "submitted") return "✓ 已提交";
  if (member.cardStatus === "selecting") return "● 选卡中";
  return "— 未开始";
}

function formatDims(dims) {
  return (Array.isArray(dims) ? dims : []).map((dim) => DIM_LABELS[dim] || dim);
}

function AuthGate({ onVerified }) {
  const [code, setCode] = useState(readTeacherCode());
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleVerify = async () => {
    const value = code.trim();
    if (!value) {
      setError("请输入教师密码");
      return;
    }
    setLoading(true);
    setError("");
    try {
      await verifyTeacherCode(value);
      saveTeacherCode(value);
      onVerified(value);
    } catch (err) {
      setError(err.message || "验证失败");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#f8fafc",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontFamily: "'Noto Sans SC', sans-serif"
      }}
    >
      <div
        style={{
          width: 360,
          padding: "28px",
          borderRadius: 20,
          background: "#fff",
          border: "1px solid #e2e8f0",
          boxShadow: "0 20px 40px rgba(15,23,42,0.08)"
        }}
      >
        <div style={{ fontSize: 20, fontWeight: 900, color: "#0f172a", marginBottom: 6 }}>教师控制台</div>
        <div style={{ fontSize: 12, color: "#64748b", marginBottom: 18 }}>实时查看各组 Round 2 进度并进行干预</div>
        <input
          value={code}
          onChange={(e) => {
            setCode(e.target.value);
            setError("");
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") handleVerify();
          }}
          type="password"
          placeholder="教师密码"
          style={{
            width: "100%",
            boxSizing: "border-box",
            padding: "12px 14px",
            borderRadius: 10,
            border: "1px solid #cbd5e1",
            fontSize: 14,
            outline: "none"
          }}
        />
        {error && <div style={{ fontSize: 12, color: "#dc2626", marginTop: 8 }}>{error}</div>}
        <button
          onClick={handleVerify}
          disabled={loading}
          style={{
            width: "100%",
            marginTop: 14,
            padding: "12px 0",
            borderRadius: 10,
            border: "none",
            background: "#1a5c3a",
            color: "#fff",
            fontWeight: 800,
            cursor: loading ? "wait" : "pointer"
          }}
        >
          {loading ? "验证中..." : "进入控制台"}
        </button>
      </div>
    </div>
  );
}

function TeamCard({ team, expanded, onToggle, onAction, busy }) {
  const timeout = timeoutState(team);
  const statusColor = STATUS_COLORS[team.r2.status] || "#64748b";
  const submittedMembers = team.members.filter((member) => member.cardStatus === "submitted").length;

  return (
    <div
      style={{
        borderRadius: 18,
        border: "1px solid #e2e8f0",
        background: "#fff",
        overflow: "hidden"
      }}
    >
      <div style={{ padding: "18px 18px 14px" }}>
        <div style={{ display: "flex", gap: 12, alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ flex: 1 }}>
            <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
              <span style={{ fontSize: 16, fontWeight: 900, color: "#0f172a" }}>{team.name}</span>
              <span style={{ fontSize: 12, color: "#64748b" }}>{team.memberCount} 人</span>
              {team.r1.gridLabel && (
                <span style={{ fontSize: 12, color: "#475569" }}>
                  {team.r1.gridLabel} · {team.r1.arch}
                </span>
              )}
            </div>
            <div style={{ marginTop: 10 }}>
              <div
                style={{
                  width: "100%",
                  height: 10,
                  borderRadius: 999,
                  background: "#e2e8f0",
                  overflow: "hidden"
                }}
              >
                <div
                  style={{
                    width: `${progressPercent(team.r2.status)}%`,
                    height: "100%",
                    background: statusColor
                  }}
                />
              </div>
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10 }}>
              {team.members.map((member) => {
                const marker = memberIndicator(team.r2.status, member);
                return (
                  <span key={member.id} style={{ fontSize: 12, color: marker.color }}>
                    {member.name} {marker.icon}
                  </span>
                );
              })}
            </div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 8 }}>
            <span
              style={{
                padding: "6px 10px",
                borderRadius: 999,
                background: timeout.kind === "critical" ? "#fee2e2" : timeout.kind === "warning" ? "#ffedd5" : `${statusColor}15`,
                color: timeout.kind === "critical" ? "#dc2626" : timeout.kind === "warning" ? "#c2410c" : statusColor,
                fontSize: 11,
                fontWeight: 800
              }}
            >
              {team.r2.statusLabel}
            </span>
            <span style={{ fontSize: 11, color: timeout.kind === "normal" ? "#64748b" : timeout.kind === "critical" ? "#dc2626" : "#c2410c" }}>
              {timeout.text || `已在此状态 ${fmtMinutes(team.r2.durationMinutes)}`}
            </span>
            <button
              onClick={onToggle}
              style={{
                padding: "8px 12px",
                borderRadius: 10,
                border: "1px solid #cbd5e1",
                background: "#fff",
                color: "#334155",
                fontSize: 12,
                fontWeight: 700,
                cursor: "pointer"
              }}
            >
              {expanded ? "收起" : "展开"}
            </button>
          </div>
        </div>
      </div>

      {expanded && (
        <div style={{ borderTop: "1px solid #e2e8f0", padding: "18px" }}>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 16 }}>
            <div style={{ fontSize: 13, color: "#334155" }}>
              团队状态: <strong>{team.r2.status}</strong>
            </div>
            <div style={{ fontSize: 13, color: "#334155" }}>已在此状态: {fmtMinutes(team.r2.durationMinutes)}</div>
            <div style={{ fontSize: 13, color: "#334155" }}>已提交个人选卡: {submittedMembers}/{team.memberCount}</div>
          </div>

          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr style={{ background: "#f8fafc", color: "#475569" }}>
                  {["成员", "负责维度", "访谈状态", "选卡状态", "已选卡数", "操作"].map((label) => (
                    <th key={label} style={{ textAlign: "left", padding: "10px 12px", borderBottom: "1px solid #e2e8f0" }}>{label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {team.members.map((member) => (
                  <tr key={member.id}>
                    <td style={{ padding: "12px", borderBottom: "1px solid #e2e8f0", fontWeight: 700, color: "#0f172a" }}>{member.name}</td>
                    <td style={{ padding: "12px", borderBottom: "1px solid #e2e8f0", color: "#475569" }}>
                      {member.dims.length ? formatDims(member.dims).join(" / ") : "— 未分配"}
                    </td>
                    <td style={{ padding: "12px", borderBottom: "1px solid #e2e8f0", color: "#475569" }}>{detailInterviewLabel(member)}</td>
                    <td style={{ padding: "12px", borderBottom: "1px solid #e2e8f0", color: "#475569" }}>{detailCardLabel(member)}</td>
                    <td style={{ padding: "12px", borderBottom: "1px solid #e2e8f0", color: "#475569" }}>{member.cardsSelected || "—"}</td>
                    <td style={{ padding: "12px", borderBottom: "1px solid #e2e8f0" }}>
                      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                        {member.interviewStatus === "in_progress" && (
                          <button
                            onClick={() => onAction("forceEndInterview", { team_id: team.id, member_id: member.id })}
                            disabled={busy}
                            style={actionButtonStyle("#f59e0b")}
                          >
                            强制结束访谈
                          </button>
                        )}
                        {member.cardStatus !== "submitted" && member.cardsSelected > 0 && (
                          <button
                            onClick={() => onAction("forceSubmitCards", { team_id: team.id, member_id: member.id })}
                            disabled={busy}
                            style={actionButtonStyle("#8b5cf6")}
                          >
                            强制提交
                          </button>
                        )}
                        <button
                          onClick={() => onAction("resetMemberInterview", { team_id: team.id, member_id: member.id })}
                          disabled={busy}
                          style={ghostButtonStyle()}
                        >
                          重置到访谈
                        </button>
                        <button
                          onClick={() => onAction("resetMemberSelecting", { team_id: team.id, member_id: member.id })}
                          disabled={busy}
                          style={ghostButtonStyle()}
                        >
                          重置到选卡
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 16 }}>
            <button
              onClick={() => onAction("forceMerge", { team_id: team.id })}
              disabled={busy}
              style={actionButtonStyle("#1a5c3a")}
            >
              强制合并（用已提交 {submittedMembers} 人的卡）
            </button>
            <button
              onClick={() => onAction("forceAdvance", { team_id: team.id, target_status: "R2_TEAM_DISCUSSION" })}
              disabled={busy}
              style={actionButtonStyle("#0f766e")}
            >
              跳到讨论阶段
            </button>
            <button
              onClick={() => onAction("resetTeamInterview", { team_id: team.id })}
              disabled={busy}
              style={ghostButtonStyle()}
            >
              重置到访谈阶段
            </button>
            <button
              onClick={() => onAction("resetTeamReview", { team_id: team.id })}
              disabled={busy}
              style={ghostButtonStyle()}
            >
              重置到回顾阶段
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function actionButtonStyle(color) {
  return {
    padding: "8px 12px",
    borderRadius: 10,
    border: "none",
    background: color,
    color: "#fff",
    fontSize: 12,
    fontWeight: 800,
    cursor: "pointer"
  };
}

function ghostButtonStyle() {
  return {
    padding: "8px 12px",
    borderRadius: 10,
    border: "1px solid #cbd5e1",
    background: "#fff",
    color: "#334155",
    fontSize: 12,
    fontWeight: 700,
    cursor: "pointer"
  };
}

export default function AdminPanel() {
  const [teacherCode, setTeacherCode] = useState(readTeacherCode());
  const [activeTab, setActiveTab] = useState("实时监控");
  const [sessionData, setSessionData] = useState({ meta: null, teams: [] });
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [busyAction, setBusyAction] = useState("");
  const [expanded, setExpanded] = useState({});
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState(null);
  const [importError, setImportError] = useState("");
  const [lastUpdatedAt, setLastUpdatedAt] = useState("");
  const fileRef = useRef(null);

  const loadSession = async (silent = false) => {
    if (!teacherCode) return;
    if (!silent) setLoading(true);
    setLoadError("");
    try {
      const data = await getTeacherSessionStatus(teacherCode);
      setSessionData({
        meta: data.meta || null,
        teams: data.teams || []
      });
      setLastUpdatedAt(new Date().toLocaleTimeString());
    } catch (err) {
      if (String(err.message || "").includes("密码错误")) {
        clearTeacherCode();
        setTeacherCode("");
        return;
      }
      setLoadError(err.message || "读取实时状态失败");
    } finally {
      if (!silent) setLoading(false);
    }
  };

  useEffect(() => {
    if (!teacherCode || activeTab !== "实时监控") return undefined;
    loadSession();
    const timer = setInterval(() => loadSession(true), 5000);
    return () => clearInterval(timer);
  }, [teacherCode, activeTab]);

  const handleLogout = () => {
    clearTeacherCode();
    setTeacherCode("");
  };

  const withRefresh = async (label, fn) => {
    setBusyAction(label);
    try {
      const result = await fn();
      await loadSession(true);
      return result;
    } catch (err) {
      window.alert(err.message || "操作失败");
      return null;
    } finally {
      setBusyAction("");
    }
  };

  const handleAction = async (type, payload) => {
    if (!teacherCode) return;

    if (type === "forceEndInterview") {
      await withRefresh("forceEndInterview", () => teacherForceEndInterview(teacherCode, payload));
      return;
    }
    if (type === "forceSubmitCards") {
      await withRefresh("forceSubmitCards", () => teacherForceSubmitCards(teacherCode, payload));
      return;
    }
    if (type === "forceMerge") {
      await withRefresh("forceMerge", () => teacherForceMerge(teacherCode, payload));
      return;
    }
    if (type === "forceAdvance") {
      await withRefresh("forceAdvance", () => teacherForceAdvance(teacherCode, payload));
      return;
    }
    if (type === "resetMemberInterview") {
      const confirmed = window.confirm("将该成员重置到访谈阶段，并清除其此后数据。继续吗？");
      if (!confirmed) return;
      await withRefresh("resetMemberInterview", () => teacherResetMember(teacherCode, { ...payload, reset_to: "interviewing" }));
      return;
    }
    if (type === "resetMemberSelecting") {
      const confirmed = window.confirm("将该成员重置到选卡阶段，并清除其此后数据。继续吗？");
      if (!confirmed) return;
      await withRefresh("resetMemberSelecting", () => teacherResetMember(teacherCode, { ...payload, reset_to: "selecting" }));
      return;
    }
    if (type === "resetTeamInterview") {
      const confirmed = window.confirm("此操作不可撤销，将清除该组在访谈阶段之后的所有数据。继续吗？");
      if (!confirmed) return;
      await withRefresh("resetTeamInterview", () => teacherResetTeam(teacherCode, { ...payload, reset_to: "R2_INTERVIEWING", confirm: true }));
      return;
    }
    if (type === "resetTeamReview") {
      const confirmed = window.confirm("此操作不可撤销，将清除该组在回顾阶段之后的所有数据。继续吗？");
      if (!confirmed) return;
      await withRefresh("resetTeamReview", () => teacherResetTeam(teacherCode, { ...payload, reset_to: "R2_REVIEW", confirm: true }));
    }
  };

  const handleImport = async () => {
    const file = fileRef.current?.files?.[0];
    if (!file || !teacherCode) return;

    setImporting(true);
    setImportError("");
    setImportResult(null);

    try {
      const XLSX = await import("https://cdn.jsdelivr.net/npm/xlsx@0.20.0/+esm");
      const buffer = await file.arrayBuffer();
      const workbook = XLSX.read(buffer, { type: "array" });
      const worksheet = workbook.Sheets[workbook.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(worksheet, { header: 1 });

      let dataRows = rows;
      if (rows.length > 0) {
        const first = rows[0] || [];
        const isHeader = first.some((value) => /组号|group|学号|student|姓名|name/i.test(String(value || "")));
        if (isHeader) dataRows = rows.slice(1);
      }

      const students = dataRows
        .filter((row) => row && row.length >= 3 && row[0] && row[1] && row[2])
        .map((row) => ({
          group: String(row[0]).trim(),
          student_id: String(row[1]).trim(),
          name: String(row[2]).trim()
        }));

      if (!students.length) {
        setImportError("未找到有效数据。请确认格式：A列=组号 B列=学号 C列=姓名");
        setImporting(false);
        return;
      }

      const out = await importStudentsForTeacher(teacherCode, students);
      setImportResult(out);
      await loadSession(true);
    } catch (err) {
      setImportError(err.message || "导入失败");
    } finally {
      setImporting(false);
    }
  };

  const handleExport = async () => {
    if (!teacherCode) return;
    try {
      const data = await exportTeacherResults(teacherCode);
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `teacher-export-${Date.now()}.json`;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      window.alert(err.message || "导出失败");
    }
  };

  if (!teacherCode) {
    return <AuthGate onVerified={setTeacherCode} />;
  }

  const meta = sessionData.meta || { totalStudents: 0, totalTeams: 0, r1Frozen: 0, r2Submitted: 0 };

  return (
    <div style={{ minHeight: "100vh", background: "#f8fafc", fontFamily: "'Noto Sans SC', sans-serif", color: "#0f172a" }}>
      <div style={{ background: "#0f172a", color: "#fff", borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
        <div style={{ maxWidth: 1280, margin: "0 auto", padding: "18px 24px", display: "flex", justifyContent: "space-between", gap: 16, alignItems: "center" }}>
          <div>
            <div style={{ fontSize: 20, fontWeight: 900 }}>教师控制台</div>
            <div style={{ fontSize: 12, color: "#94a3b8", marginTop: 4 }}>课中状态监控与教师干预</div>
          </div>
          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <a
              href="/multiplayer"
              style={{
                padding: "9px 14px",
                borderRadius: 10,
                background: "rgba(255,255,255,0.08)",
                color: "#e2e8f0",
                textDecoration: "none",
                fontSize: 12,
                fontWeight: 700
              }}
            >
              学生入口
            </a>
            <button onClick={handleLogout} style={ghostButtonStyle()}>退出</button>
          </div>
        </div>
      </div>

      <div style={{ maxWidth: 1280, margin: "0 auto", padding: "24px" }}>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 18 }}>
          {TABS.map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              style={{
                padding: "10px 14px",
                borderRadius: 999,
                border: activeTab === tab ? "none" : "1px solid #cbd5e1",
                background: activeTab === tab ? "#1a5c3a" : "#fff",
                color: activeTab === tab ? "#fff" : "#475569",
                fontSize: 12,
                fontWeight: 800,
                cursor: "pointer"
              }}
            >
              {tab}
            </button>
          ))}
        </div>

        {activeTab !== "实时监控" && (
          <TeacherDebriefTabs
            activeTab={activeTab}
            teacherCode={teacherCode}
            onExportJson={handleExport}
          />
        )}

        {activeTab === "实时监控" && (
          <>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 14, marginBottom: 18 }}>
              {[
                { label: "总学生数", value: meta.totalStudents, color: "#2563eb" },
                { label: "总组数", value: meta.totalTeams, color: "#7c3aed" },
                { label: "R1 已冻结", value: `${meta.r1Frozen}/${meta.totalTeams || 0}`, color: "#059669" },
                { label: "R2 已提交", value: `${meta.r2Submitted}/${meta.totalTeams || 0}`, color: "#10b981" }
              ].map((item) => (
                <div key={item.label} style={{ padding: 18, borderRadius: 18, background: "#fff", border: "1px solid #e2e8f0" }}>
                  <div style={{ fontSize: 28, fontWeight: 900, color: item.color }}>{item.value}</div>
                  <div style={{ fontSize: 12, color: "#64748b", marginTop: 4 }}>{item.label}</div>
                </div>
              ))}
            </div>

            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 18 }}>
              <button
                onClick={() => withRefresh("openRound2", () => openTeacherRound2(teacherCode))}
                disabled={Boolean(busyAction)}
                style={actionButtonStyle("#1a5c3a")}
              >
                开放 Round 2
              </button>
              <button
                onClick={() => withRefresh("forceMergeAll", () => teacherForceMergeAll(teacherCode))}
                disabled={Boolean(busyAction)}
                style={actionButtonStyle("#8b5cf6")}
              >
                全部强制合并
              </button>
              <button
                onClick={handleExport}
                disabled={Boolean(busyAction)}
                style={ghostButtonStyle()}
              >
                导出全部成绩 JSON
              </button>
              <span style={{ marginLeft: "auto", fontSize: 12, color: "#64748b", alignSelf: "center" }}>
                {busyAction ? "操作中..." : lastUpdatedAt ? `最近刷新 ${lastUpdatedAt}` : ""}
              </span>
            </div>

            <div style={{ padding: 20, borderRadius: 18, background: "#fff", border: "1px solid #e2e8f0", marginBottom: 18 }}>
              <div style={{ fontSize: 14, fontWeight: 800, color: "#0f172a", marginBottom: 8 }}>班级导组</div>
              <div style={{ fontSize: 12, color: "#64748b", marginBottom: 12 }}>A列=组号 B列=学号 C列=姓名。第一行可为表头。</div>
              <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" style={{ display: "none" }} onChange={handleImport} />
              <button onClick={() => fileRef.current?.click()} disabled={importing || Boolean(busyAction)} style={ghostButtonStyle()}>
                {importing ? "导入中..." : "选择 Excel 并建组"}
              </button>
              {importError && <div style={{ fontSize: 12, color: "#dc2626", marginTop: 8 }}>{importError}</div>}
              {importResult && (
                <div style={{ fontSize: 12, color: "#059669", marginTop: 8 }}>
                  已导入 {importResult.imported_teams} 组 / {importResult.imported_students} 人
                </div>
              )}
            </div>

            {loading ? (
              <div style={{ fontSize: 13, color: "#64748b" }}>正在读取课堂实时状态...</div>
            ) : loadError ? (
              <div style={{ padding: 14, borderRadius: 12, background: "#fef2f2", border: "1px solid #fecaca", color: "#b91c1c", fontSize: 13 }}>
                {loadError}
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                {sessionData.teams.length === 0 ? (
                  <div style={{ padding: 18, borderRadius: 18, background: "#fff", border: "1px solid #e2e8f0", fontSize: 13, color: "#64748b" }}>
                    暂无班级数据，请先导入分组 Excel。
                  </div>
                ) : (
                  sessionData.teams.map((team) => (
                    <TeamCard
                      key={team.id}
                      team={team}
                      expanded={Boolean(expanded[team.id])}
                      onToggle={() => setExpanded((prev) => ({ ...prev, [team.id]: !prev[team.id] }))}
                      onAction={handleAction}
                      busy={Boolean(busyAction)}
                    />
                  ))
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
