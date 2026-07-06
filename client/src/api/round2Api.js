const BASE = "/api";

async function asJson(res) {
  const data = await res.json();
  if (!data.ok) {
    const error = new Error(data.error || "请求失败");
    error.code = data.error || "request_failed";
    error.leaderName = data.leader_name || "";
    error.leaderMemberId = data.leader_member_id || "";
    error.payload = data;
    throw error;
  }
  return data;
}

export async function getRound2Recap(teamId, options = {}) {
  const res = await fetch(`${BASE}/round2/recap?teamId=${encodeURIComponent(teamId)}`, {
    signal: options.signal
  });
  return asJson(res);
}

export async function getRound2TeamResult(teamId, sessionId = "default", options = {}) {
  const res = await fetch(
    `${BASE}/round2/team-result?teamId=${encodeURIComponent(teamId)}&session_id=${encodeURIComponent(sessionId)}`,
    { signal: options.signal }
  );
  return asJson(res);
}

export async function getRound2State(teamId, memberId = "", options = {}) {
  const query = new URLSearchParams({
    teamId: String(teamId || "").trim()
  });
  if (memberId) query.set("memberId", String(memberId || "").trim());
  const res = await fetch(`${BASE}/round2/state?${query.toString()}`, {
    signal: options.signal
  });
  return asJson(res);
}

export async function getRound2TeamStatus(teamId, memberId = "") {
  return getRound2State(teamId, memberId);
}

export async function submitRound2TeamDecision(payload) {
  const res = await fetch(`${BASE}/round2/team-submit`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  return asJson(res);
}

export async function saveRound2TeamDraft(payload) {
  const res = await fetch(`${BASE}/round2/team-draft`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload || {})
  });
  return asJson(res);
}

export async function assignRound2Dimensions(payload) {
  const res = await fetch(`${BASE}/round2/assign-dimensions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  return asJson(res);
}

export async function getRound2PersonaReports(teamId, sessionId = "default", options = {}) {
  const query = new URLSearchParams({
    teamId: String(teamId || "").trim(),
    session_id: String(sessionId || "default").trim()
  });
  const res = await fetch(`${BASE}/round2/persona-reports?${query.toString()}`, {
    signal: options.signal
  });
  return asJson(res);
}

export async function selectRound2PersonaArchetype(payload) {
  const res = await fetch(`${BASE}/round2/persona-select`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload || {})
  });
  return asJson(res);
}

export async function round2InterviewAuto(payload) {
  const res = await fetch(`${BASE}/round2/interview/auto`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  return asJson(res);
}

export async function startRound2Interview(payload, options = {}) {
  const res = await fetch(`${BASE}/round2/interview/start`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    signal: options.signal
  });
  return asJson(res);
}

export async function replyRound2Interview(payload) {
  const res = await fetch(`${BASE}/round2/interview/reply`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  return asJson(res);
}

export async function rescoreRound2Interview(sessionId) {
  const res = await fetch(`${BASE}/round2/interview/rescore`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionId })
  });
  return asJson(res);
}

export async function endRound2Interview(payload) {
  const res = await fetch(`${BASE}/round2/interview/end`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  return asJson(res);
}

export async function getRound2InterviewSession(teamId, memberId, sessionId = "", options = {}) {
  const query = new URLSearchParams();
  if (sessionId) query.set("sessionId", String(sessionId || "").trim());
  if (teamId) query.set("teamId", String(teamId || "").trim());
  if (memberId) query.set("memberId", String(memberId || "").trim());
  const res = await fetch(`${BASE}/round2/interview/session?${query.toString()}`, {
    signal: options.signal
  });
  return asJson(res);
}

export async function saveRound2MemberSelection(payload) {
  const res = await fetch(`${BASE}/round2/member-selection`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  return asJson(res);
}

export async function mergeRound2Selections(payload) {
  const res = await fetch(`${BASE}/round2/merge`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  return asJson(res);
}

export async function getRound2TeamMerge(teamId, COGSbase = "", memberId = "", options = {}) {
  const query = new URLSearchParams({
    teamId: String(teamId || "").trim()
  });
  if (COGSbase !== "" && COGSbase != null) query.set("COGSbase", String(COGSbase));
  if (memberId) query.set("memberId", String(memberId || "").trim());
  const res = await fetch(`${BASE}/round2/team-merge?${query.toString()}`, {
    signal: options.signal
  });
  return asJson(res);
}

export async function getRound2Reflection(payload) {
  const res = await fetch(`${BASE}/round2/reflection`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  return asJson(res);
}

export async function startMarketingInterview(payload) {
  const res = await fetch(`${BASE}/marketing/start`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  return asJson(res);
}

export async function sendMarketingMessage(payload) {
  const res = await fetch(`${BASE}/marketing/interview`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  return asJson(res);
}

export async function endMarketingInterview(payload) {
  const res = await fetch(`${BASE}/marketing/end-interview`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  return asJson(res);
}

export async function getMarketingTeamSummary(teamKey) {
  const res = await fetch(`${BASE}/marketing/team-summary?teamKey=${encodeURIComponent(teamKey)}`);
  return asJson(res);
}
