const STORAGE_KEY = "emba_student_session_v1";
const ROUND1_REVIEW_INTENT_KEY = "emba_round1_review_intent_v1";

function getStorage() {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch (_) {
    return null;
  }
}

function normalizeSession(raw) {
  if (!raw || typeof raw !== "object") return null;
  const session = {
    studentId: String(raw.studentId || raw.student_id || "").trim(),
    studentName: String(raw.studentName || raw.student_name || "").trim(),
    groupLabel: String(raw.groupLabel || raw.group_label || "").trim(),
    teamId: String(raw.teamId || raw.team_id || "").trim(),
    memberId: String(raw.memberId || raw.member_id || "").trim(),
    entryMode: String(raw.entryMode || "").trim()
  };
  if (!session.teamId || !session.memberId) return null;
  return session;
}

export function readStudentSession() {
  const storage = getStorage();
  if (!storage) return null;
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return normalizeSession(JSON.parse(raw));
  } catch (_) {
    return null;
  }
}

export function writeStudentSession(next) {
  const storage = getStorage();
  if (!storage) return null;
  const normalized = normalizeSession(next);
  if (!normalized) return null;
  storage.setItem(STORAGE_KEY, JSON.stringify(normalized));
  return normalized;
}

export function mergeStudentSession(patch) {
  const current = readStudentSession() || {};
  return writeStudentSession({ ...current, ...patch });
}

export function clearStudentSession() {
  const storage = getStorage();
  if (!storage) return;
  storage.removeItem(STORAGE_KEY);
}

export function hasStoredStudentSession() {
  const session = readStudentSession();
  return Boolean(session?.teamId && session?.memberId);
}

export function shouldOpenRound2(r2Status) {
  const value = String(r2Status || "").trim().toUpperCase();
  return Boolean(value) && value !== "R2_NOT_STARTED";
}

export function markRound1ReviewIntent() {
  const storage = getStorage();
  if (!storage) return;
  storage.setItem(ROUND1_REVIEW_INTENT_KEY, "1");
}

export function consumeRound1ReviewIntent() {
  const storage = getStorage();
  if (!storage) return false;
  const flagged = storage.getItem(ROUND1_REVIEW_INTENT_KEY) === "1";
  storage.removeItem(ROUND1_REVIEW_INTENT_KEY);
  return flagged;
}
