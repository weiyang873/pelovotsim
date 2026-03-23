import { useEffect, useState } from "react";
import { writeStudentSession } from "../utils/studentSession";

export default function TestRound2Entry() {
  const [error, setError] = useState("");

  useEffect(() => {
    let canceled = false;

    const bootstrap = async () => {
      try {
        const res = await fetch("/api/test/skip-to-r2");
        const data = await res.json();
        if (!data.ok) {
          throw new Error(data.error || "测试入口初始化失败");
        }
        writeStudentSession({
          teamId: data.team_id,
          memberId: data.member_id,
          entryMode: "trial"
        });
        if (canceled) return;
        window.location.href = data.redirect_url || `/multiplayer/round2?teamId=${encodeURIComponent(data.team_id || "")}&memberId=${encodeURIComponent(data.member_id || "")}&session_id=default`;
      } catch (e) {
        if (!canceled) {
          setError(e.message || "测试入口初始化失败");
        }
      }
    };

    bootstrap();
    return () => {
      canceled = true;
    };
  }, []);

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "linear-gradient(160deg, #0a1628 0%, #162a4a 40%, #1a3a5c 100%)",
        fontFamily: "'Noto Sans SC', sans-serif",
        padding: 24
      }}
    >
      <div
        style={{
          width: 420,
          borderRadius: 24,
          padding: "36px 32px",
          background: "rgba(255,255,255,0.05)",
          border: "1px solid rgba(255,255,255,0.08)",
          boxShadow: "0 32px 64px rgba(0,0,0,0.35)",
          color: "#fff"
        }}
      >
        <div style={{ fontSize: 22, fontWeight: 800 }}>Round 2 测试入口</div>
        <div style={{ marginTop: 10, fontSize: 14, lineHeight: 1.7, color: "rgba(255,255,255,0.72)" }}>
          正在创建预填好的测试队伍，并跳转到多人 Round 2。
        </div>
        {error ? (
          <div
            style={{
              marginTop: 18,
              padding: "12px 14px",
              borderRadius: 12,
              background: "rgba(127,29,29,0.35)",
              border: "1px solid rgba(248,113,113,0.35)",
              color: "#fecaca",
              fontSize: 13,
              lineHeight: 1.6
            }}
          >
            {error}
          </div>
        ) : (
          <div style={{ marginTop: 18, fontSize: 13, color: "#93c5fd" }}>
            请求 `/api/test/skip-to-r2` 中...
          </div>
        )}
      </div>
    </div>
  );
}
