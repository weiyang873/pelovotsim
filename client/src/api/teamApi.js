const BASE = "/api";

async function asJson(res) {
  const data = await res.json();
  if (!data.ok) throw new Error(data.error || "请求失败");
  return data;
}

export async function createTeam(teamName, teamSize) {
  const res = await fetch(`${BASE}/team/create`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ teamName, teamSize })
  });
  return asJson(res);
}

export async function joinTeam(teamId, memberName) {
  const res = await fetch(`${BASE}/team/${encodeURIComponent(teamId)}/join`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ memberName })
  });
  return asJson(res);
}

export async function getMemberJinang(teamId, memberId) {
  const res = await fetch(`${BASE}/team/${encodeURIComponent(teamId)}/member/${encodeURIComponent(memberId)}/jinang`);
  return asJson(res);
}

export async function submitPersonalChoice(teamId, memberId, choice) {
  const res = await fetch(`${BASE}/team/${encodeURIComponent(teamId)}/phase1/${encodeURIComponent(memberId)}/submit`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(choice)
  });
  return asJson(res);
}

export async function getTeamStatus(teamId) {
  const res = await fetch(`${BASE}/team/${encodeURIComponent(teamId)}/status`);
  return asJson(res);
}

export async function getSubmissions(teamId) {
  const res = await fetch(`${BASE}/team/${encodeURIComponent(teamId)}/submissions`);
  return asJson(res);
}

export async function submitVPForCoach(teamId, vpData) {
  const res = await fetch(`${BASE}/team/${encodeURIComponent(teamId)}/phase3/submit-vp`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(vpData)
  });
  return asJson(res);
}

export async function chatWithCoach(teamId, payload) {
  const body = typeof payload === "string" ? { message: payload } : (payload || {});
  const res = await fetch(`${BASE}/team/${encodeURIComponent(teamId)}/phase3/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  return asJson(res);
}

export async function finalizeDecision(teamId, finalData) {
  const res = await fetch(`${BASE}/team/${encodeURIComponent(teamId)}/phase3/finalize`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(finalData)
  });
  return asJson(res);
}

export async function getPhase3State(teamId) {
  const res = await fetch(`${BASE}/team/${encodeURIComponent(teamId)}/phase3/state`);
  return asJson(res);
}

export async function getVpScores(teamId) {
  const res = await fetch(`${BASE}/vp/scores?team_id=${encodeURIComponent(teamId)}`);
  return asJson(res);
}

export async function getResults(teamId) {
  const res = await fetch(`${BASE}/team/${encodeURIComponent(teamId)}/phase4`);
  return asJson(res);
}

export async function freezeTeam(teamId) {
  const res = await fetch(`${BASE}/team/${encodeURIComponent(teamId)}/freeze`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({})
  });
  return asJson(res);
}
