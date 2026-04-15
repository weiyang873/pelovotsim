import { useState } from "react";
import { getRound2State } from "../api/round2Api";
import { getTeamStatus } from "../api/teamApi";
import { clearStudentSession, readStudentSession, shouldOpenRound2, writeStudentSession } from "../utils/studentSession";

async function resolveStudentPath(teamId, memberId) {
  try {
    const state = await getRound2State(teamId, memberId);
    if (state?.ok && shouldOpenRound2(state.team_status)) {
      return "/multiplayer/round2";
    }
  } catch (_) {}
  return "/multiplayer";
}

async function resolveStoredPath(session) {
  if (!session?.teamId || !session?.memberId) return "/multiplayer";
  if (session.entryMode === "trial") {
    try {
      const status = await getTeamStatus(session.teamId);
      if (shouldOpenRound2(status?.r2_status)) {
        return "/multiplayer/round2";
      }
    } catch (_) {}
    return "/multiplayer";
  }
  return resolveStudentPath(session.teamId, session.memberId);
}

export default function EntryPage() {
  const [storedSession, setStoredSession] = useState(() => readStudentSession());
  const [studentId, setStudentId] = useState("");
  const [error, setError] = useState("");
  const [found, setFound] = useState(null);
  const [loading, setLoading] = useState(false);
  const [hasAcceptedTerms, setHasAcceptedTerms] = useState(false);
  const [resumeLoading, setResumeLoading] = useState(false);
  const [resumeError, setResumeError] = useState("");

  const [showTrialInput, setShowTrialInput] = useState(false);
  const [trialCode, setTrialCode] = useState("");
  const [trialError, setTrialError] = useState("");
  const [trialLoading, setTrialLoading] = useState(false);

  const [showAdminInput, setShowAdminInput] = useState(false);
  const [adminCode, setAdminCode] = useState("");
  const [adminError, setAdminError] = useState("");

  const handleLookup = async () => {
    if (!hasAcceptedTerms) {
      setError("请先阅读并同意服务与隐私条款");
      return;
    }
    const sid = studentId.trim();
    if (!sid) {
      setError("请输入学号");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`/api/student/${encodeURIComponent(sid)}`);
      const data = await res.json();
      if (!data.ok) {
        setError(data.error || "学号未找到");
        setFound(null);
      } else {
        setFound(data);
        setError("");
      }
    } catch (e) {
      setError(`网络错误: ${e.message}`);
    } finally {
      setLoading(false);
    }
  };

  const handleEnter = async () => {
    if (!hasAcceptedTerms || !found?.team_id || !found?.member_id) return;
    writeStudentSession({
      studentId: found.student_id,
      studentName: found.student_name,
      groupLabel: found.group_label,
      teamId: found.team_id,
      memberId: found.member_id,
      entryMode: "classroom"
    });
    const nextPath = await resolveStudentPath(found.team_id, found.member_id);
    window.location.href = nextPath;
  };

  const handleResume = async () => {
    if (!storedSession?.teamId || !storedSession?.memberId) return;
    setResumeLoading(true);
    setResumeError("");
    try {
      const nextPath = await resolveStoredPath(storedSession);
      window.location.href = nextPath;
    } catch (e) {
      setResumeError(e.message || "无法恢复上次进度");
    } finally {
      setResumeLoading(false);
    }
  };

  const handleClearStoredSession = () => {
    clearStudentSession();
    setStoredSession(null);
    setResumeError("");
  };

  const handleTrial = async () => {
    if (!hasAcceptedTerms) {
      setTrialError("请先阅读并同意服务与隐私条款");
      return;
    }
    const code = trialCode.trim();
    if (!code) {
      setTrialError("请输入试玩密码");
      return;
    }
    setTrialLoading(true);
    setTrialError("");
    try {
      const res = await fetch("/api/trial/enter", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code })
      });
      const data = await res.json();
      if (!data.ok) {
        setTrialError(data.error || "验证失败");
      } else {
        writeStudentSession({
          teamId: data.team_id,
          memberId: data.member_id,
          entryMode: "trial"
        });
        window.location.href = "/multiplayer";
      }
    } catch (e) {
      setTrialError(`网络错误: ${e.message}`);
    } finally {
      setTrialLoading(false);
    }
  };

  const handleAdmin = async () => {
    const code = adminCode.trim();
    if (!code) {
      setAdminError("请输入管理密码");
      return;
    }
    try {
      const res = await fetch("/api/admin/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code })
      });
      const data = await res.json();
      if (!data.ok) {
        setAdminError(data.error || "验证失败");
      } else {
        window.localStorage.setItem("emba_teacher_code", code);
        window.location.href = "/teacher";
      }
    } catch (e) {
      setAdminError(`网络错误: ${e.message}`);
    }
  };

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "linear-gradient(160deg, #0a1628 0%, #162a4a 40%, #1a3a5c 100%)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontFamily: "'Noto Sans SC', sans-serif"
      }}
    >
      <div
        style={{
          width: 400,
          padding: "48px 40px",
          borderRadius: 24,
          background: "rgba(255,255,255,0.04)",
          border: "1px solid rgba(255,255,255,0.08)",
          boxShadow: "0 32px 64px rgba(0,0,0,0.4)"
        }}
      >
        <div style={{ textAlign: "center", marginBottom: 32 }}>
          <h1 style={{ fontSize: 22, fontWeight: 800, color: "#fff", margin: 0 }}>LOVOT 战略模拟</h1>
          <div style={{ fontSize: 13, color: "rgba(255,255,255,0.4)", marginTop: 6 }}>高管教育创新战略AI模拟练习</div>
        </div>

        {storedSession && (
          <div
            style={{
              padding: "16px",
              borderRadius: 14,
              marginBottom: 18,
              background: "rgba(16,185,129,0.12)",
              border: "1px solid rgba(16,185,129,0.28)"
            }}
          >
            <div style={{ fontSize: 13, color: "#6ee7b7", fontWeight: 700 }}>检测到上次进度</div>
            <div style={{ fontSize: 15, color: "#fff", fontWeight: 700, marginTop: 6 }}>
              {storedSession.entryMode === "trial"
                ? "试玩模式"
                : (storedSession.studentName || storedSession.studentId || "课堂模式")}
            </div>
            <div style={{ fontSize: 12, color: "rgba(255,255,255,0.6)", marginTop: 4, lineHeight: 1.6 }}>
              {storedSession.entryMode === "trial"
                ? "可继续进入你上次的试玩进度"
                : `${storedSession.groupLabel || "当前"} 组 · ${storedSession.studentId || "已记录身份"}`}
            </div>
            {resumeError && <div style={{ fontSize: 12, color: "#fca5a5", marginTop: 8 }}>{resumeError}</div>}
            <div style={{ display: "flex", gap: 10, marginTop: 12 }}>
              <button
                type="button"
                onClick={handleResume}
                disabled={resumeLoading}
                style={{
                  flex: 1,
                  padding: "10px 12px",
                  borderRadius: 10,
                  border: "none",
                  background: "linear-gradient(135deg, #065f46, #10b981)",
                  color: "#fff",
                  fontSize: 13,
                  fontWeight: 700,
                  cursor: resumeLoading ? "wait" : "pointer"
                }}
              >
                {resumeLoading ? "进入中..." : "继续上次进度"}
              </button>
              <button
                type="button"
                onClick={handleClearStoredSession}
                style={{
                  padding: "10px 12px",
                  borderRadius: 10,
                  border: "1px solid rgba(255,255,255,0.14)",
                  background: "rgba(255,255,255,0.04)",
                  color: "rgba(255,255,255,0.8)",
                  fontSize: 13,
                  fontWeight: 700,
                  cursor: "pointer"
                }}
              >
                重新输入
              </button>
            </div>
          </div>
        )}

        <label style={{ fontSize: 12, fontWeight: 700, color: "rgba(255,255,255,0.5)" }}>学号</label>
        <input
          value={studentId}
          onChange={(e) => {
            setStudentId(e.target.value);
            setError("");
            setFound(null);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              if (!hasAcceptedTerms) return;
              if (found) handleEnter();
              else handleLookup();
            }
          }}
          placeholder="例如 EMB24001"
          style={{
            width: "100%",
            padding: "14px 16px",
            marginTop: 8,
            borderRadius: 12,
            border: "1px solid rgba(255,255,255,0.12)",
            background: "rgba(255,255,255,0.06)",
            color: "#fff",
            fontSize: 16,
            fontWeight: 600,
            outline: "none",
            boxSizing: "border-box"
          }}
        />
        {error && <div style={{ fontSize: 13, color: "#f87171", marginTop: 6 }}>{error}</div>}

        {found && (
          <div
            style={{
              padding: "14px 16px",
              borderRadius: 12,
              marginTop: 12,
              background: "rgba(16,185,129,0.12)",
              border: "1px solid rgba(16,185,129,0.25)"
            }}
          >
            <div style={{ fontSize: 13, color: "#6ee7b7", fontWeight: 600 }}>已找到</div>
            <div style={{ fontSize: 15, color: "#fff", fontWeight: 700, marginTop: 4 }}>{found.student_name}</div>
            <div style={{ fontSize: 12, color: "rgba(255,255,255,0.5)", marginTop: 2 }}>
              {found.group_label} 组 · {found.student_id}
            </div>
          </div>
        )}

        <label
          style={{
            display: "flex",
            alignItems: "flex-start",
            gap: 10,
            marginTop: 14,
            color: "rgba(255,255,255,0.54)",
            fontSize: 11,
            lineHeight: 1.7,
            cursor: "pointer"
          }}
        >
          <input
            type="checkbox"
            checked={hasAcceptedTerms}
            onChange={(e) => {
              setHasAcceptedTerms(e.target.checked);
              setError("");
              setTrialError("");
            }}
            style={{ marginTop: 3, accentColor: "#10b981" }}
          />
          <span>
            我已阅读并同意
            <a
              href="/legal"
              target="_blank"
              rel="noreferrer"
              style={{
                color: "#93c5fd",
                textDecoration: "underline",
                margin: "0 2px"
              }}
            >
              《服务与隐私条款》
            </a>
            ，并知晓本平台仅为课堂模拟，不构成真实投资与战略建议。
          </span>
        </label>

        <button
          onClick={found ? handleEnter : handleLookup}
          disabled={loading || !hasAcceptedTerms}
          style={{
            width: "100%",
            padding: "14px 0",
            marginTop: 16,
            borderRadius: 12,
            border: "none",
            background: !hasAcceptedTerms
              ? "rgba(148,163,184,0.36)"
              : found
                ? "linear-gradient(135deg, #065f46, #10b981)"
                : "linear-gradient(135deg, #1e40af, #3b82f6)",
            color: !hasAcceptedTerms ? "rgba(255,255,255,0.6)" : "#fff",
            fontSize: 15,
            fontWeight: 700,
            cursor: !hasAcceptedTerms ? "not-allowed" : (loading ? "wait" : "pointer")
          }}
        >
          {loading ? "查找中..." : found ? "进入模拟" : "查找"}
        </button>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            margin: "24px 0",
            color: "rgba(255,255,255,0.2)",
            fontSize: 12
          }}
        >
          <div style={{ flex: 1, height: 1, background: "rgba(255,255,255,0.1)" }} />
          或
          <div style={{ flex: 1, height: 1, background: "rgba(255,255,255,0.1)" }} />
        </div>

        {!showTrialInput ? (
          <button
            onClick={() => setShowTrialInput(true)}
            disabled={!hasAcceptedTerms}
            style={{
              width: "100%",
              padding: "12px 0",
              borderRadius: 12,
              background: !hasAcceptedTerms ? "rgba(148,163,184,0.14)" : "rgba(255,255,255,0.04)",
              border: "1px solid rgba(255,255,255,0.1)",
              color: !hasAcceptedTerms ? "rgba(255,255,255,0.35)" : "rgba(255,255,255,0.5)",
              fontSize: 14,
              fontWeight: 600,
              cursor: !hasAcceptedTerms ? "not-allowed" : "pointer"
            }}
          >
            试玩模式
          </button>
        ) : (
          <div
            style={{
              padding: "16px",
              borderRadius: 12,
              background: "rgba(255,255,255,0.04)",
              border: "1px solid rgba(255,255,255,0.1)"
            }}
          >
            <div style={{ fontSize: 12, color: "rgba(255,255,255,0.4)", marginBottom: 8 }}>请输入试玩密码</div>
            <input
              value={trialCode}
              onChange={(e) => {
                setTrialCode(e.target.value);
                setTrialError("");
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && hasAcceptedTerms) handleTrial();
              }}
              type="password"
              placeholder="试玩密码"
              style={{
                width: "100%",
                padding: "10px 14px",
                borderRadius: 8,
                border: "1px solid rgba(255,255,255,0.12)",
                background: "rgba(255,255,255,0.06)",
                color: "#fff",
                fontSize: 14,
                outline: "none",
                boxSizing: "border-box"
              }}
            />
            {trialError && <div style={{ fontSize: 12, color: "#f87171", marginTop: 4 }}>{trialError}</div>}
            <button
              onClick={handleTrial}
              disabled={trialLoading || !hasAcceptedTerms}
              style={{
                width: "100%",
                padding: "10px 0",
                marginTop: 8,
                borderRadius: 8,
                border: "none",
                background: !hasAcceptedTerms
                  ? "rgba(148,163,184,0.36)"
                  : "linear-gradient(135deg, #7c3aed, #a78bfa)",
                color: !hasAcceptedTerms ? "rgba(255,255,255,0.6)" : "#fff",
                fontSize: 13,
                fontWeight: 700,
                cursor: !hasAcceptedTerms ? "not-allowed" : (trialLoading ? "wait" : "pointer")
              }}
            >
              {trialLoading ? "创建中..." : "开始试玩"}
            </button>
          </div>
        )}

        <div style={{ textAlign: "center", marginTop: 16, fontSize: 11, color: "rgba(255,255,255,0.2)" }}>
          如有问题请联系教师
        </div>
      </div>

      {!showAdminInput ? (
        <button
          onClick={() => setShowAdminInput(true)}
          style={{
            position: "fixed",
            bottom: 16,
            right: 16,
            padding: "8px 14px",
            borderRadius: 8,
            background: "rgba(255,255,255,0.06)",
            border: "1px solid rgba(255,255,255,0.1)",
            color: "rgba(255,255,255,0.25)",
            fontSize: 11,
            cursor: "pointer"
          }}
        >
          教师入口
        </button>
      ) : (
        <div
          style={{
            position: "fixed",
            bottom: 16,
            right: 16,
            padding: "16px",
            borderRadius: 12,
            width: 240,
            background: "#1e293b",
            border: "1px solid rgba(255,255,255,0.1)",
            boxShadow: "0 8px 24px rgba(0,0,0,0.4)"
          }}
        >
          <div style={{ fontSize: 12, color: "#94a3b8", marginBottom: 8 }}>管理密码</div>
          <input
            value={adminCode}
            onChange={(e) => {
              setAdminCode(e.target.value);
              setAdminError("");
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleAdmin();
            }}
            type="password"
            style={{
              width: "100%",
              padding: "8px 12px",
              borderRadius: 6,
              border: "1px solid rgba(255,255,255,0.12)",
              background: "rgba(255,255,255,0.06)",
              color: "#fff",
              fontSize: 13,
              outline: "none",
              boxSizing: "border-box"
            }}
          />
          {adminError && <div style={{ fontSize: 11, color: "#f87171", marginTop: 4 }}>{adminError}</div>}
          <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
            <button
              onClick={() => setShowAdminInput(false)}
              style={{
                flex: 1,
                padding: "6px 0",
                borderRadius: 6,
                background: "transparent",
                border: "1px solid rgba(255,255,255,0.1)",
                color: "#94a3b8",
                fontSize: 11,
                cursor: "pointer"
              }}
            >
              取消
            </button>
            <button
              onClick={handleAdmin}
              style={{
                flex: 1,
                padding: "6px 0",
                borderRadius: 6,
                background: "#3b82f6",
                border: "none",
                color: "#fff",
                fontSize: 11,
                fontWeight: 700,
                cursor: "pointer"
              }}
            >
              进入
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
