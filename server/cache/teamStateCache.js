const teamStateCache = new Map();

function normalizeTeamId(teamId) {
  return String(teamId || "").trim();
}

function isTeamStateCacheDisabled() {
  return String(process.env.TEAM_STATE_CACHE_DISABLED || "").trim() === "1";
}

function cloneState(state) {
  if (state == null) return state;
  try {
    return JSON.parse(JSON.stringify(state));
  } catch (_) {
    return state;
  }
}

function diffMinutes(fromIso) {
  if (!fromIso) return 0;
  const from = new Date(fromIso).getTime();
  if (!Number.isFinite(from)) return 0;
  return Math.max(0, Math.floor((Date.now() - from) / 60000));
}

function refreshVolatileFields(state) {
  const next = cloneState(state);
  if (!next || typeof next !== "object") return next;
  if (next.r2 && typeof next.r2 === "object") {
    next.r2.durationMinutes = diffMinutes(next.r2.enteredAt);
  }
  if (Array.isArray(next.members)) {
    next.members = next.members.map((member) => ({
      ...member,
      lastActivityMinutes: diffMinutes(member?.lastActivityAt)
    }));
  }
  return next;
}

function getTeamStateCache(teamId) {
  if (isTeamStateCacheDisabled()) return null;
  const tid = normalizeTeamId(teamId);
  if (!tid) return null;
  const entry = teamStateCache.get(tid);
  if (!entry) return null;
  return {
    state: refreshVolatileFields(entry.state),
    updated_at: entry.updated_at,
    cache_hit: true
  };
}

function setTeamStateCache(teamId, state) {
  if (isTeamStateCacheDisabled()) return null;
  const tid = normalizeTeamId(teamId);
  if (!tid) return null;
  if (!state) {
    teamStateCache.delete(tid);
    return null;
  }
  const entry = {
    state: refreshVolatileFields(state),
    updated_at: new Date().toISOString()
  };
  teamStateCache.set(tid, entry);
  return {
    state: refreshVolatileFields(entry.state),
    updated_at: entry.updated_at,
    cache_hit: false
  };
}

function clearTeamStateCache(teamId) {
  const tid = normalizeTeamId(teamId);
  if (!tid) return;
  teamStateCache.delete(tid);
}

function clearAllTeamStateCache() {
  teamStateCache.clear();
}

async function readThroughTeamStateCache(teamId, loader) {
  const cached = getTeamStateCache(teamId);
  if (cached) return cached.state;
  const state = await loader();
  setTeamStateCache(teamId, state);
  return state;
}

async function refreshTeamStateCache(teamId, loader) {
  const state = await loader();
  setTeamStateCache(teamId, state);
  return state;
}

function getTeamStateCacheStats() {
  return {
    enabled: !isTeamStateCacheDisabled(),
    size: teamStateCache.size,
    keys: Array.from(teamStateCache.keys())
  };
}

module.exports = {
  getTeamStateCache,
  setTeamStateCache,
  clearTeamStateCache,
  clearAllTeamStateCache,
  readThroughTeamStateCache,
  refreshTeamStateCache,
  getTeamStateCacheStats
};
