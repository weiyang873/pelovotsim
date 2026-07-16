const BASE = "/api";

function teacherHeaders(code, extra = {}) {
  return {
    "Content-Type": "application/json",
    "x-teacher-code": String(code || "").trim(),
    ...extra
  };
}

async function asJson(res) {
  const data = await res.json();
  if (!data.ok) throw new Error(data.error || "请求失败");
  return data;
}

export async function verifyTeacherCode(code) {
  const res = await fetch(`${BASE}/admin/verify`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code })
  });
  return asJson(res);
}

export async function getTeacherSessionStatus(code) {
  const res = await fetch(`${BASE}/teacher/session-status`, {
    headers: { "x-teacher-code": String(code || "").trim() }
  });
  return asJson(res);
}

export async function getTeacherSessionConfig(code, sessionId = "default") {
  const res = await fetch(`${BASE}/teacher/session-config?session_id=${encodeURIComponent(sessionId)}`, {
    headers: { "x-teacher-code": String(code || "").trim() }
  });
  return asJson(res);
}

export async function updateTeacherSessionConfig(code, sessionId = "default", config = {}) {
  const res = await fetch(`${BASE}/teacher/session-config`, {
    method: "POST",
    headers: teacherHeaders(code),
    body: JSON.stringify({
      session_id: sessionId,
      config
    })
  });
  return asJson(res);
}

export async function getTeacherDebriefData(code, sessionId = "default") {
  const res = await fetch(
    `${BASE}/teacher/debrief-data?session_id=${encodeURIComponent(sessionId)}`,
    {
      headers: { "x-teacher-code": String(code || "").trim() }
    }
  );
  return asJson(res);
}

export async function getTeacherVpIterations(code, teamId, sessionId = "default") {
  const res = await fetch(
    `${BASE}/teacher/vp-iterations?team_id=${encodeURIComponent(teamId)}&session_id=${encodeURIComponent(sessionId)}`,
    {
      headers: { "x-teacher-code": String(code || "").trim() }
    }
  );
  return asJson(res);
}

export async function generateTeacherDebrief(code, round, sessionId = "default") {
  const res = await fetch(`${BASE}/teacher/generate-debrief`, {
    method: "POST",
    headers: teacherHeaders(code),
    body: JSON.stringify({ round, session_id: sessionId })
  });
  return asJson(res);
}

export async function generateTeacherTeamReview(code, teamId, sessionId = "default") {
  const res = await fetch(`${BASE}/teacher/generate-team-review`, {
    method: "POST",
    headers: teacherHeaders(code),
    body: JSON.stringify({ team_id: teamId, session_id: sessionId })
  });
  return asJson(res);
}

export async function generateTeacherProductImage(code, teamId) {
  const res = await fetch(`${BASE}/teacher/generate-product-image`, {
    method: "POST",
    headers: teacherHeaders(code),
    body: JSON.stringify({ team_id: teamId })
  });
  return asJson(res);
}

export async function generateTeacherProductImageBatch(code) {
  const res = await fetch(`${BASE}/teacher/generate-product-image-batch`, {
    method: "POST",
    headers: teacherHeaders(code),
    body: JSON.stringify({})
  });
  return asJson(res);
}

export async function getTeacherProductImage(code, teamId) {
  const res = await fetch(`${BASE}/teacher/product-image/${encodeURIComponent(teamId)}`, {
    headers: { "x-teacher-code": String(code || "").trim() }
  });
  return asJson(res);
}

export async function downloadTeacherCsv(code, sessionId = "default") {
  const res = await fetch(`${BASE}/teacher/export-csv?session_id=${encodeURIComponent(sessionId)}`, {
    headers: { "x-teacher-code": String(code || "").trim() }
  });
  if (!res.ok) {
    let message = "下载失败";
    try {
      const data = await res.json();
      message = data.error || message;
    } catch (_) {}
    throw new Error(message);
  }
  const blob = await res.blob();
  const contentDisposition = res.headers.get("content-disposition") || "";
  const match = contentDisposition.match(/filename=\"?([^"]+)\"?/i);
  return {
    blob,
    filename: match?.[1] || `teacher-debrief-${sessionId}.csv`
  };
}

export async function openTeacherRound2(code) {
  const res = await fetch(`${BASE}/teacher/open-round2`, {
    method: "POST",
    headers: teacherHeaders(code),
    body: JSON.stringify({})
  });
  return asJson(res);
}

export async function teacherForceMergeAll(code) {
  const res = await fetch(`${BASE}/teacher/force-merge-all`, {
    method: "POST",
    headers: teacherHeaders(code),
    body: JSON.stringify({})
  });
  return asJson(res);
}

export async function teacherForceEndInterview(code, payload) {
  const res = await fetch(`${BASE}/teacher/force-end-interview`, {
    method: "POST",
    headers: teacherHeaders(code),
    body: JSON.stringify(payload)
  });
  return asJson(res);
}

export async function teacherForceSubmitCards(code, payload) {
  const res = await fetch(`${BASE}/teacher/force-submit-cards`, {
    method: "POST",
    headers: teacherHeaders(code),
    body: JSON.stringify(payload)
  });
  return asJson(res);
}

export async function teacherMarkAbsent(code, payload) {
  const res = await fetch(`${BASE}/teacher/mark-absent`, {
    method: "POST",
    headers: teacherHeaders(code),
    body: JSON.stringify(payload)
  });
  return asJson(res);
}

export async function teacherForceMerge(code, payload) {
  const res = await fetch(`${BASE}/teacher/force-merge`, {
    method: "POST",
    headers: teacherHeaders(code),
    body: JSON.stringify(payload)
  });
  return asJson(res);
}

export async function teacherSetLeader(code, payload) {
  const res = await fetch(`${BASE}/teacher/set-leader`, {
    method: "POST",
    headers: teacherHeaders(code),
    body: JSON.stringify(payload)
  });
  return asJson(res);
}

export async function teacherForceAdvance(code, payload) {
  const res = await fetch(`${BASE}/teacher/force-advance`, {
    method: "POST",
    headers: teacherHeaders(code),
    body: JSON.stringify(payload)
  });
  return asJson(res);
}

export async function teacherResetMember(code, payload) {
  const res = await fetch(`${BASE}/teacher/reset-member`, {
    method: "POST",
    headers: teacherHeaders(code),
    body: JSON.stringify(payload)
  });
  return asJson(res);
}

export async function teacherResetTeam(code, payload) {
  const res = await fetch(`${BASE}/teacher/reset-team`, {
    method: "POST",
    headers: teacherHeaders(code),
    body: JSON.stringify(payload)
  });
  return asJson(res);
}

export async function teacherResetSession(code, payload) {
  const res = await fetch(`${BASE}/teacher/reset-session`, {
    method: "POST",
    headers: teacherHeaders(code),
    body: JSON.stringify(payload)
  });
  return asJson(res);
}

export async function importStudentsForTeacher(code, students) {
  const res = await fetch(`${BASE}/admin/import`, {
    method: "POST",
    headers: teacherHeaders(code),
    body: JSON.stringify({ students })
  });
  return asJson(res);
}

export async function exportTeacherResults(code) {
  const res = await fetch(`${BASE}/admin/export`, {
    headers: { "x-teacher-code": String(code || "").trim() }
  });
  return asJson(res);
}
