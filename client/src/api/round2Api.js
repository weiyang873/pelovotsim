const BASE = "/api";

async function asJson(res) {
  const data = await res.json();
  if (!data.ok) throw new Error(data.error || "请求失败");
  return data;
}

export async function getRound2Recap(teamId) {
  const res = await fetch(`${BASE}/round2/recap?teamId=${encodeURIComponent(teamId)}`);
  return asJson(res);
}

export async function getRound2TeamResult(teamId, sessionId = "default") {
  const res = await fetch(
    `${BASE}/round2/team-result?teamId=${encodeURIComponent(teamId)}&session_id=${encodeURIComponent(sessionId)}`
  );
  return asJson(res);
}

export async function getRound2State(teamId, memberId = "") {
  const query = new URLSearchParams({
    teamId: String(teamId || "").trim()
  });
  if (memberId) query.set("memberId", String(memberId || "").trim());
  const res = await fetch(`${BASE}/round2/state?${query.toString()}`);
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

export async function assignRound2Dimensions(payload) {
  const res = await fetch(`${BASE}/round2/assign-dimensions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
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

export async function startRound2Interview(payload) {
  const res = await fetch(`${BASE}/round2/interview/start`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
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

export async function endRound2Interview(payload) {
  const res = await fetch(`${BASE}/round2/interview/end`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  return asJson(res);
}

export async function getRound2InterviewSession(teamId, memberId, sessionId = "") {
  const query = new URLSearchParams();
  if (sessionId) query.set("sessionId", String(sessionId || "").trim());
  if (teamId) query.set("teamId", String(teamId || "").trim());
  if (memberId) query.set("memberId", String(memberId || "").trim());
  const res = await fetch(`${BASE}/round2/interview/session?${query.toString()}`);
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

export async function getRound2TeamMerge(teamId, COGSbase = "") {
  const query = new URLSearchParams({
    teamId: String(teamId || "").trim()
  });
  if (COGSbase !== "" && COGSbase != null) query.set("COGSbase", String(COGSbase));
  const res = await fetch(`${BASE}/round2/team-merge?${query.toString()}`);
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
