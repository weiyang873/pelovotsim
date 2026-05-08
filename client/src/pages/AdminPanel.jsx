import { useEffect, useRef, useState } from "react";
import * as XLSX from "xlsx";
import TeacherDebriefTabs from "../components/TeacherDebriefTabs";
import {
  exportTeacherResults,
  generateTeacherLovot,
  generateTeacherLovotBatch,
  getTeacherSessionStatus,
  getTeacherLovotImage,
  importStudentsForTeacher,
  openTeacherRound2,
  teacherForceAdvance,
  teacherForceEndInterview,
  teacherForceMerge,
  teacherForceMergeAll,
  teacherMarkAbsent,
  teacherForceSubmitCards,
  teacherResetMember,
  teacherResetSession,
  teacherResetTeam,
  verifyTeacherCode
} from "../api/teacherApi";

const TEACHER_CODE_KEY = "emba_teacher_code";
const TABS = ["实时监控", "Round 1 复盘", "Round 2 复盘", "跨轮对比", "AI 讲解稿", "导出", "7关卡诊断", "能力卡生态"];
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

function parseLeaderMarker(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return normalized === "1" || normalized === "是" || normalized === "y";
}

function normalizeImportedStudents(rows) {
  const explicitLeaderByGroup = new Map();
  const fallbackLeaderByGroup = new Map();

  rows.forEach((row) => {
    const groupKey = String(row.group || "");
    if (!fallbackLeaderByGroup.has(groupKey)) {
      fallbackLeaderByGroup.set(groupKey, row.id);
    }
    if (row.is_leader && !explicitLeaderByGroup.has(groupKey)) {
      explicitLeaderByGroup.set(groupKey, row.id);
    }
  });

  return rows.map((row) => {
    const groupKey = String(row.group || "");
    const leaderId = explicitLeaderByGroup.get(groupKey) || fallbackLeaderByGroup.get(groupKey);
    return { ...row, is_leader: row.id === leaderId };
  });
}

function buildImportPreviewRows(rawRows) {
  const parsedRows = (Array.isArray(rawRows) ? rawRows : [])
    .filter((row) => row && row.length >= 3 && row[0] && row[1] && row[2])
    .map((row, index) => ({
      id: `${String(row[0]).trim()}-${String(row[1]).trim()}-${index}`,
      group: String(row[0]).trim(),
      student_id: String(row[1]).trim(),
      name: String(row[2]).trim(),
      is_leader: parseLeaderMarker(row[3])
    }));
  return normalizeImportedStudents(parsedRows);
}

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

function isMarkedAbsent(member) {
  return Boolean(
    member?.forcedByTeacher &&
    member?.interviewStatus === "completed" &&
    member?.cardStatus === "submitted"
  );
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

function TeamCard({ team, expanded, onToggle, onAction, busy, lovotImage, lovotLoading, onLoadLovotImage }) {
  const timeout = timeoutState(team);
  const statusColor = STATUS_COLORS[team.r2.status] || "#64748b";
  const submittedMembers = team.members.filter((member) => member.cardStatus === "submitted").length;
  const [actionChoice, setActionChoice] = useState("");

  useEffect(() => {
    if (!expanded || !team.hasLovotImage || lovotImage || lovotLoading) return;
    onLoadLovotImage(team.id);
  }, [expanded, team.hasLovotImage, team.id, lovotImage, lovotLoading, onLoadLovotImage]);

  const handleTeamAction = () => {
    if (!actionChoice) return;
    onAction(actionChoice, { team_id: team.id });
    setActionChoice("");
  };

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
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <select
                value={actionChoice}
                onChange={(e) => setActionChoice(e.target.value)}
                style={{
                  padding: "8px 10px",
                  borderRadius: 10,
                  border: "1px solid #cbd5e1",
                  background: "#fff",
                  color: "#334155",
                  fontSize: 12,
                  fontWeight: 700
                }}
              >
                <option value="">操作 ▼</option>
                <option value="forceMerge">推进：强制合并（用已提交的卡）</option>
                <option value="forceAdvancePricing">推进：强制推进到定价</option>
                <option value="forceAdvanceSubmitted">推进：强制提交</option>
                <option value="generateLovot">生成团队 LOVOT</option>
                <option value="resetTeamInterview">重置：到访谈阶段（清空全部 R2）</option>
                <option value="resetTeamCards">重置：到选卡阶段（清空选卡及之后）</option>
                <option value="resetTeamMerge">重置：到合并阶段（清空合并及之后）</option>
                <option value="resetTeamPricing">重置：到定价阶段（清空定价及之后）</option>
              </select>
              <button
                onClick={handleTeamAction}
                disabled={!actionChoice || busy}
                style={{
                  padding: "8px 12px",
                  borderRadius: 10,
                  border: "1px solid #cbd5e1",
                  background: actionChoice ? "#1a5c3a" : "#f8fafc",
                  color: actionChoice ? "#fff" : "#94a3b8",
                  fontSize: 12,
                  fontWeight: 700,
                  cursor: actionChoice && !busy ? "pointer" : "not-allowed"
                }}
              >
                执行
              </button>
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
                        {member.cardStatus === "selecting" && (
                          <button
                            onClick={() => onAction("forceSubmitCards", { team_id: team.id, member_id: member.id })}
                            disabled={busy}
                            style={actionButtonStyle("#8b5cf6")}
                          >
                            强制提交选卡
                          </button>
                        )}
                        {member.interviewStatus === "in_progress" && (
                          <button
                            onClick={() => onAction("resetMemberInterview", { team_id: team.id, member_id: member.id })}
                            disabled={busy}
                            style={ghostButtonStyle(true)}
                          >
                            重置访谈
                          </button>
                        )}
                        {(member.cardStatus === "selecting" || member.cardStatus === "submitted") && (
                          <button
                            onClick={() => onAction("resetMemberSelecting", { team_id: team.id, member_id: member.id })}
                            disabled={busy}
                            style={ghostButtonStyle(true)}
                          >
                            重置选卡
                          </button>
                        )}
                        <button
                          onClick={() => onAction("markAbsent", { team_id: team.id, member_id: member.id, member_name: member.name })}
                          disabled={busy || isMarkedAbsent(member)}
                          style={{
                            ...ghostButtonStyle(true),
                            opacity: busy || isMarkedAbsent(member) ? 0.55 : 1,
                            cursor: busy || isMarkedAbsent(member) ? "not-allowed" : "pointer"
                          }}
                        >
                          {isMarkedAbsent(member) ? "已标记缺席" : "标记缺席"}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div style={{ fontSize: 11, color: "#94a3b8" }}>
            可在上方“操作”菜单中执行推进或重置。
          </div>

          {lovotLoading && (
            <div style={{ marginTop: 16, textAlign: "center", padding: 20, color: "#64748b", borderRadius: 14, background: "#f8fafc", border: "1px solid #e2e8f0" }}>
              正在准备该组的 LOVOT 形象，通常需要几秒钟...
            </div>
          )}

          {lovotImage && (
            <div style={{ marginTop: 16, padding: 16, background: "#f8fafc", borderRadius: 14, border: "1px solid #e2e8f0", textAlign: "center" }}>
              <div style={{ fontSize: 15, fontWeight: 700, color: "#334155", marginBottom: 12, textAlign: "center" }}>
                团队专属 LOVOT
              </div>
              <div style={{ display: "flex", justifyContent: "center" }}>
                <img
                  src={lovotImage}
                  alt={`${team.name} LOVOT`}
                  style={{
                    maxWidth: 480,
                    width: "100%",
                    objectFit: "contain",
                    borderRadius: 16,
                    boxShadow: "0 4px 12px rgba(15,23,42,0.12)"
                  }}
                />
              </div>
            </div>
          )}
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

function ghostButtonStyle(isSubtle = false) {
  return {
    padding: isSubtle ? "6px 10px" : "8px 12px",
    borderRadius: 10,
    border: isSubtle ? "1px solid #e2e8f0" : "1px solid #cbd5e1",
    background: "#fff",
    color: isSubtle ? "#6b7280" : "#334155",
    fontSize: isSubtle ? 11 : 12,
    fontWeight: isSubtle ? 600 : 700,
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
  const [importPreviewRows, setImportPreviewRows] = useState([]);
  const [importPreviewFileName, setImportPreviewFileName] = useState("");
  const [lastUpdatedAt, setLastUpdatedAt] = useState("");
  const [toasts, setToasts] = useState([]);
  const [lovotImages, setLovotImages] = useState({});
  const [generatingLovot, setGeneratingLovot] = useState({});
  const [batchGenerating, setBatchGenerating] = useState(false);
  const fileRef = useRef(null);
  const toastTimersRef = useRef([]);

  const pushToast = (type, message) => {
    const id = `${Date.now()}-${Math.random()}`;
    setToasts((prev) => [...prev, { id, type, message }]);
    const timer = window.setTimeout(() => {
      setToasts((prev) => prev.filter((item) => item.id !== id));
      toastTimersRef.current = toastTimersRef.current.filter((item) => item !== timer);
    }, 3000);
    toastTimersRef.current.push(timer);
  };

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

  useEffect(() => {
    return () => {
      toastTimersRef.current.forEach((timer) => window.clearTimeout(timer));
      toastTimersRef.current = [];
    };
  }, []);

  const handleLogout = () => {
    clearTeacherCode();
    setTeacherCode("");
  };

  const withRefresh = async (label, fn, successMessage) => {
    setBusyAction(label);
    try {
      const result = await fn();
      await loadSession(true);
      if (successMessage) pushToast("success", successMessage);
      return result;
    } catch (err) {
      pushToast("error", err.message || "操作失败");
      return null;
    } finally {
      setBusyAction("");
    }
  };

  const handleAction = async (type, payload) => {
    if (!teacherCode) return;

    if (type === "forceEndInterview") {
      await withRefresh("forceEndInterview", () => teacherForceEndInterview(teacherCode, payload), "已强制结束该成员访谈");
      return;
    }
    if (type === "forceSubmitCards") {
      await withRefresh("forceSubmitCards", () => teacherForceSubmitCards(teacherCode, payload), "已强制提交该成员选卡");
      return;
    }
    if (type === "markAbsent") {
      const memberName = String(payload?.member_name || "该成员").trim();
      const confirmed = window.confirm(`确定将${memberName}标记为缺席？`);
      if (!confirmed) return;
      await withRefresh(
        "markAbsent",
        () => teacherMarkAbsent(teacherCode, {
          teamId: payload?.team_id,
          memberId: payload?.member_id
        }),
        "已将该成员标记为缺席"
      );
      return;
    }
    if (type === "forceMerge") {
      await withRefresh("forceMerge", () => teacherForceMerge(teacherCode, payload), "已强制合并该组");
      return;
    }
    if (type === "forceAdvancePricing") {
      await withRefresh("forceAdvancePricing", () => teacherForceAdvance(teacherCode, { ...payload, target_step: "pricing" }), "已推进到定价阶段");
      return;
    }
    if (type === "forceAdvanceSubmitted") {
      await withRefresh("forceAdvanceSubmitted", () => teacherForceAdvance(teacherCode, { ...payload, target_step: "submitted" }), "已强制提交该组");
      return;
    }
    if (type === "forceAdvance") {
      await withRefresh("forceAdvance", () => teacherForceAdvance(teacherCode, payload), "已推进该组状态");
      return;
    }
    if (type === "generateLovot") {
      const teamId = String(payload?.team_id || "").trim();
      if (!teamId) return;
      setGeneratingLovot((prev) => ({ ...prev, [teamId]: true }));
      try {
        const out = await generateTeacherLovot(teacherCode, teamId);
        setLovotImages((prev) => ({ ...prev, [teamId]: out.image }));
        await loadSession(true);
        pushToast("success", "已生成该组的 LOVOT 形象");
      } catch (err) {
        pushToast("error", err.message || "生成 LOVOT 失败");
      } finally {
        setGeneratingLovot((prev) => ({ ...prev, [teamId]: false }));
      }
      return;
    }
    if (type === "resetMemberInterview") {
      const confirmed = window.confirm("确认要重置该成员到访谈阶段？\n将清除其访谈记录与选卡数据。");
      if (!confirmed) return;
      await withRefresh(
        "resetMemberInterview",
        () => teacherResetMember(teacherCode, { ...payload, reset_to: "interviewing", confirm: true }),
        "已重置该成员到访谈阶段"
      );
      return;
    }
    if (type === "resetMemberSelecting") {
      const confirmed = window.confirm("确认要重置该成员到选卡阶段？\n将清除其选卡数据，保留访谈结果。");
      if (!confirmed) return;
      await withRefresh(
        "resetMemberSelecting",
        () => teacherResetMember(teacherCode, { ...payload, reset_to: "selecting", confirm: true }),
        "已重置该成员到选卡阶段"
      );
      return;
    }
    if (type === "resetTeamInterview") {
      const confirmed = window.confirm("确认重置到访谈阶段？\n将清除：全部访谈/选卡/合并/定价数据。");
      if (!confirmed) return;
      await withRefresh(
        "resetTeamInterview",
        () => teacherResetTeam(teacherCode, { ...payload, reset_to: "R2_INTERVIEWING", confirm: true }),
        "已重置该组到访谈阶段"
      );
      return;
    }
    if (type === "resetTeamCards") {
      const confirmed = window.confirm("确认重置到选卡阶段？\n将清除：全员选卡、合并与定价数据。\n保留：访谈记录。");
      if (!confirmed) return;
      await withRefresh(
        "resetTeamCards",
        () => teacherResetTeam(teacherCode, { ...payload, reset_to: "R2_INDIVIDUAL_CARDS", confirm: true }),
        "已重置该组到选卡阶段"
      );
      return;
    }
    if (type === "resetTeamMerge") {
      const confirmed = window.confirm("确认重置到合并阶段？\n将清除：合并结果与定价数据。\n保留：访谈记录与个人选卡。");
      if (!confirmed) return;
      await withRefresh(
        "resetTeamMerge",
        () => teacherResetTeam(teacherCode, { ...payload, reset_to: "R2_TEAM_MERGE", confirm: true }),
        "已重置该组到合并阶段"
      );
      return;
    }
    if (type === "resetTeamPricing") {
      const confirmed = window.confirm("确认重置到定价阶段？\n将清除：定价与提交数据。\n保留：访谈、选卡与合并结果。");
      if (!confirmed) return;
      await withRefresh(
        "resetTeamPricing",
        () => teacherResetTeam(teacherCode, { ...payload, reset_to: "R2_TEAM_DISCUSSION", confirm: true }),
        "已重置该组到定价阶段"
      );
    }
  };

  const loadLovotImage = async (teamId, options = {}) => {
    const force = options.force === true;
    if (!teacherCode || !teamId) return null;
    if (!force && lovotImages[teamId]) return lovotImages[teamId];
    if (generatingLovot[teamId]) return null;

    setGeneratingLovot((prev) => ({ ...prev, [teamId]: true }));
    try {
      const out = await getTeacherLovotImage(teacherCode, teamId);
      setLovotImages((prev) => ({ ...prev, [teamId]: out.image }));
      return out.image;
    } catch (_) {
      return null;
    } finally {
      setGeneratingLovot((prev) => ({ ...prev, [teamId]: false }));
    }
  };

  const handleImportFileChange = async () => {
    const file = fileRef.current?.files?.[0];
    if (!file) return;

    setImporting(true);
    setImportError("");
    setImportResult(null);

    try {
      const buffer = await file.arrayBuffer();
      const workbook = XLSX.read(buffer, { type: "array" });
      const worksheet = workbook.Sheets[workbook.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(worksheet, { header: 1 });

      let dataRows = rows;
      if (rows.length > 0) {
        const first = rows[0] || [];
        const isHeader = first.some((value) => /组号|group|学号|student|姓名|name|组长|leader/i.test(String(value || "")));
        if (isHeader) dataRows = rows.slice(1);
      }

      const students = buildImportPreviewRows(dataRows);

      if (!students.length) {
        setImportPreviewRows([]);
        setImportPreviewFileName("");
        setImportError("未找到有效数据。请确认格式：A列=组号 B列=学号 C列=姓名 D列=组长");
        return;
      }
      setImportPreviewRows(students);
      setImportPreviewFileName(file.name || "");
    } catch (err) {
      setImportPreviewRows([]);
      setImportPreviewFileName("");
      setImportError(err.message || "导入失败");
    } finally {
      setImporting(false);
    }
  };

  const handleTogglePreviewLeader = (groupLabel, rowId) => {
    setImportPreviewRows((prev) => normalizeImportedStudents(prev.map((row) => (
      row.group === groupLabel
        ? { ...row, is_leader: row.id === rowId }
        : row
    ))));
  };

  const handleConfirmImport = async () => {
    if (!teacherCode || importPreviewRows.length === 0) return;
    setImporting(true);
    setImportError("");
    setImportResult(null);
    try {
      const out = await importStudentsForTeacher(teacherCode, importPreviewRows.map((row) => ({
        group: row.group,
        student_id: row.student_id,
        name: row.name,
        is_leader: row.is_leader
      })));
      setImportResult(out);
      setImportPreviewRows([]);
      setImportPreviewFileName("");
      if (fileRef.current) fileRef.current.value = "";
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

  const handleBatchGenerateLovot = async () => {
    if (!teacherCode) return;
    setBatchGenerating(true);
    try {
      const out = await generateTeacherLovotBatch(teacherCode);
      const successCount = (out.results || []).filter((item) => item.ok).length;
      pushToast("success", `已生成 ${successCount}/${Number(out.total || 0)} 组 LOVOT`);
      await loadSession(true);
    } catch (err) {
      pushToast("error", err.message || "批量生成 LOVOT 失败");
    } finally {
      setBatchGenerating(false);
    }
  };

  const handleResetSession = async () => {
    if (!teacherCode) return;
    const confirmed = window.confirm("确定要清空所有数据？此操作不可撤销。");
    if (!confirmed) return;

    setBusyAction("resetSession");
    try {
      const out = await teacherResetSession(teacherCode, { confirm: true });
      window.alert(`已清空课程数据：删除 ${Number(out?.deleted_teams || 0)} 个团队，${Number(out?.deleted_members || 0)} 个成员。`);
      window.location.reload();
    } catch (err) {
      window.alert(err.message || "重置课程失败");
      setBusyAction("");
    }
  };

  if (!teacherCode) {
    return <AuthGate onVerified={setTeacherCode} />;
  }

  const meta = sessionData.meta || { totalStudents: 0, totalTeams: 0, r1Frozen: 0, r2Submitted: 0 };
  const importPreviewGroups = importPreviewRows.reduce((acc, row) => {
    const groupKey = String(row.group || "");
    if (!acc[groupKey]) acc[groupKey] = [];
    acc[groupKey].push(row);
    return acc;
  }, {});

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
      {toasts.length > 0 && (
        <div style={{ position: "fixed", top: 16, right: 16, display: "flex", flexDirection: "column", gap: 10, zIndex: 50 }}>
          {toasts.map((toast) => (
            <div
              key={toast.id}
              style={{
                padding: "10px 14px",
                borderRadius: 10,
                background: toast.type === "error" ? "#fee2e2" : "#dcfce7",
                color: toast.type === "error" ? "#991b1b" : "#166534",
                fontSize: 12,
                fontWeight: 700,
                boxShadow: "0 8px 16px rgba(15,23,42,0.12)"
              }}
            >
              {toast.message}
            </div>
          ))}
        </div>
      )}

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
                onClick={() => withRefresh("openRound2", () => openTeacherRound2(teacherCode), "已开放 Round 2")}
                disabled={Boolean(busyAction)}
                style={actionButtonStyle("#1a5c3a")}
              >
                开放 Round 2
              </button>
              <button
                onClick={() => withRefresh("forceMergeAll", () => teacherForceMergeAll(teacherCode), "已批量强制合并")}
                disabled={Boolean(busyAction)}
                style={actionButtonStyle("#8b5cf6")}
              >
                全部强制合并
              </button>
              <button
                onClick={handleBatchGenerateLovot}
                disabled={Boolean(busyAction) || batchGenerating}
                style={actionButtonStyle("#f59e0b")}
              >
                {batchGenerating ? "批量生成中..." : "批量生成 LOVOT"}
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
              <button
                onClick={handleResetSession}
                disabled={Boolean(busyAction)}
                style={actionButtonStyle("#dc2626")}
              >
                重置课程
              </button>
            </div>

            <div style={{ padding: 20, borderRadius: 18, background: "#fff", border: "1px solid #e2e8f0", marginBottom: 18 }}>
              <div style={{ fontSize: 14, fontWeight: 800, color: "#0f172a", marginBottom: 8 }}>班级导组</div>
              <div style={{ fontSize: 12, color: "#64748b", marginBottom: 12 }}>
                A列=组号 B列=学号 C列=姓名 D列=组长（选填，填1或"是"）。第一行可为表头。
              </div>
              <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" style={{ display: "none" }} onChange={handleImportFileChange} />
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
                <button onClick={() => fileRef.current?.click()} disabled={importing || Boolean(busyAction)} style={ghostButtonStyle()}>
                  {importing ? "处理中..." : (importPreviewRows.length > 0 ? "重新选择 Excel" : "选择 Excel")}
                </button>
                <button
                  onClick={handleConfirmImport}
                  disabled={importing || Boolean(busyAction) || importPreviewRows.length === 0}
                  style={actionButtonStyle("#1a5c3a")}
                >
                  {importing ? "导入中..." : "确认导入并建组"}
                </button>
                {importPreviewFileName && (
                  <span style={{ fontSize: 12, color: "#64748b" }}>
                    当前文件：{importPreviewFileName}
                  </span>
                )}
              </div>
              {importError && <div style={{ fontSize: 12, color: "#dc2626", marginTop: 8 }}>{importError}</div>}
              {importResult && (
                <div style={{ fontSize: 12, color: "#059669", marginTop: 8 }}>
                  已导入 {importResult.imported_teams} 组 / {importResult.imported_students} 人
                </div>
              )}
              {importPreviewRows.length > 0 && (
                <div style={{ marginTop: 14, borderRadius: 14, border: "1px solid #e2e8f0", overflow: "hidden" }}>
                  <div style={{ padding: "12px 14px", background: "#f8fafc", fontSize: 12, color: "#475569", fontWeight: 700 }}>
                    导入预览：点击 `★` 可切换组长
                  </div>
                  <div style={{ padding: 14, display: "flex", flexDirection: "column", gap: 12 }}>
                    {Object.entries(importPreviewGroups).map(([groupLabel, members]) => (
                      <div key={groupLabel} style={{ border: "1px solid #e2e8f0", borderRadius: 12, overflow: "hidden" }}>
                        <div style={{ padding: "10px 12px", background: "#fff", borderBottom: "1px solid #e2e8f0", fontSize: 13, fontWeight: 800, color: "#0f172a" }}>
                          第{groupLabel}组 · {members.length} 人
                        </div>
                        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12, background: "#fff" }}>
                          <thead>
                            <tr style={{ background: "#f8fafc", color: "#64748b" }}>
                              {["组长", "学号", "姓名"].map((label) => (
                                <th key={label} style={{ textAlign: "left", padding: "10px 12px", borderBottom: "1px solid #e2e8f0" }}>{label}</th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {members.map((row) => (
                              <tr
                                key={row.id}
                                onClick={() => handleTogglePreviewLeader(groupLabel, row.id)}
                                style={{ cursor: "pointer" }}
                              >
                                <td style={{ padding: "10px 12px", borderBottom: "1px solid #f1f5f9", width: 80 }}>
                                  <button
                                    type="button"
                                    onClick={(event) => {
                                      event.stopPropagation();
                                      handleTogglePreviewLeader(groupLabel, row.id);
                                    }}
                                    style={{
                                      border: "none",
                                      background: "transparent",
                                      color: row.is_leader ? "#f59e0b" : "#cbd5e1",
                                      fontSize: 18,
                                      cursor: "pointer",
                                      padding: 0,
                                      lineHeight: 1
                                    }}
                                    aria-label={`设置 ${row.name} 为第${groupLabel}组组长`}
                                  >
                                    ★
                                  </button>
                                </td>
                                <td style={{ padding: "10px 12px", borderBottom: "1px solid #f1f5f9", color: "#334155", fontWeight: 700 }}>
                                  {row.student_id}
                                </td>
                                <td style={{ padding: "10px 12px", borderBottom: "1px solid #f1f5f9", color: "#334155" }}>
                                  {row.name}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ))}
                  </div>
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
                      lovotImage={lovotImages[team.id] || ""}
                      lovotLoading={Boolean(generatingLovot[team.id])}
                      onLoadLovotImage={loadLovotImage}
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
