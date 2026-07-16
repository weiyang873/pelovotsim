import { useEffect, useMemo, useState } from "react";
import MultiplayerFlow from "./pages/MultiplayerFlow";
import Round2Flow from "./pages/Round2Flow";
import EntryPage from "./pages/EntryPage";
import AdminPanel from "./pages/AdminPanel";
import TestRound2Entry from "./pages/TestRound2Entry";
import LegalPage from "./pages/LegalPage";
import { hasStoredStudentSession, markRound1ReviewIntent, readStudentSession } from "./utils/studentSession";

const BASE_PREFIX = "/multiplayer";
const ROUND2_PATH = `${BASE_PREFIX}/round2`;
const ROUND1_PATH = `${BASE_PREFIX}/`;

function getPathname() {
  if (typeof window === "undefined") return "/";
  return window.location.pathname || "/";
}

function goTo(pathname, search = "") {
  if (typeof window === "undefined") return;
  const nextUrl = `${pathname}${search}`;
  if (`${window.location.pathname}${window.location.search}` === nextUrl) return;
  window.history.pushState({}, "", nextUrl);
  window.dispatchEvent(new PopStateEvent("popstate"));
}

function hasTeamContext() {
  if (typeof window === "undefined") return false;
  return new URL(window.location.href).searchParams.has("teamId") || hasStoredStudentSession();
}

function shouldForceEntryPage() {
  if (typeof window === "undefined") return false;
  return new URL(window.location.href).searchParams.get("entry") === "1";
}

export default function App() {
  const [pathname, setPathname] = useState(getPathname());

  const isRound2 = useMemo(
    () => pathname === ROUND2_PATH || pathname === "/round2",
    [pathname]
  );
  const isEntry = useMemo(
    () => pathname === BASE_PREFIX || pathname === `${BASE_PREFIX}/`,
    [pathname]
  );
  const isAdmin = useMemo(
    () =>
      pathname === `${BASE_PREFIX}/admin` ||
      pathname === `${BASE_PREFIX}/admin/` ||
      pathname === `${BASE_PREFIX}/teacher` ||
      pathname === `${BASE_PREFIX}/teacher/` ||
      pathname === "/admin" ||
      pathname === "/admin/" ||
      pathname === "/teacher" ||
      pathname === "/teacher/",
    [pathname]
  );
  const isTestR2 = useMemo(
    () => pathname === "/test-r2" || pathname === `${BASE_PREFIX}/test-r2`,
    [pathname]
  );
  const isLegal = useMemo(
    () => pathname === "/legal" || pathname === "/legal/",
    [pathname]
  );
  const shouldShowEntryPage = isEntry && (!hasTeamContext() || shouldForceEntryPage());

  useEffect(() => {
    const onPopState = () => setPathname(getPathname());
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  let content = null;

  if (isLegal) {
    content = <LegalPage />;
  } else if (shouldShowEntryPage) {
    content = <EntryPage />;
  } else if (isAdmin) {
    content = <AdminPanel />;
  } else if (isTestR2) {
    content = <TestRound2Entry />;
  } else if (isRound2) {
    content = (
      <>
        <div style={{ maxWidth: 1060, margin: "12px auto 0", padding: "0 12px" }}>
          <button
            type="button"
            onClick={() => {
              markRound1ReviewIntent();
              goTo(ROUND1_PATH);
            }}
            style={{
              border: "1px solid #d1d5db",
              background: "#fff",
              color: "#111827",
              borderRadius: 8,
              padding: "6px 12px",
              fontSize: 12,
              fontWeight: 700,
              cursor: "pointer"
            }}
          >
            返回 Round 1
          </button>
        </div>
        <Round2Flow />
      </>
    );
  } else {
    content = (
      <>
        <MultiplayerFlow />
      </>
    );
  }

  return (
    <>
      {content}
    </>
  );
}
