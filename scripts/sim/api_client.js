"use strict";

class ApiError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = "ApiError";
    this.status = details.status || null;
    this.method = details.method || "";
    this.path = details.path || "";
    this.data = details.data;
    this.code = details.code || null;
  }
}

class ApiClient {
  constructor(baseUrl, options = {}) {
    this.baseUrl = String(baseUrl || "http://127.0.0.1:8787").replace(/\/+$/, "");
    this.retries = Number.isInteger(options.retries) ? options.retries : 2;
    this.retryDelay = Number.isFinite(Number(options.retryDelay)) ? Number(options.retryDelay) : 2000;
    this.timeoutMs = Number.isFinite(Number(options.timeoutMs)) ? Number(options.timeoutMs) : 60000;
    this.logger = options.logger || null;
    this.teamId = options.teamId || null;
    this.currentStep = options.currentStep || null;
    this.currentMemberId = options.currentMemberId || null;
  }

  async get(path, options = {}) {
    return this.request("GET", path, null, options);
  }

  async post(path, body, options = {}) {
    return this.request("POST", path, body, options);
  }

  async request(method, path, body, options = {}) {
    const retries = Number.isInteger(options.retries) ? options.retries : this.retries;
    const timeoutMs = Number.isFinite(Number(options.timeoutMs)) ? Number(options.timeoutMs) : this.timeoutMs;
    let attempt = 0;
    let lastError = null;

    while (attempt <= retries) {
      const startedAt = Date.now();
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      let status = null;
      let response = null;
      let error = null;
      try {
        const res = await fetch(`${this.baseUrl}${path}`, {
          method,
          headers: body ? { "Content-Type": "application/json" } : {},
          body: body ? JSON.stringify(body) : undefined,
          signal: controller.signal
        });
        clearTimeout(timer);

        const text = await res.text();
        let data = {};
        try {
          data = text ? JSON.parse(text) : {};
        } catch (_) {
          data = { raw: text };
        }
        status = res.status;
        response = data;

        const inferredTeamId = this.inferTeamId(path, data);
        if (!this.teamId && inferredTeamId) {
          this.teamId = inferredTeamId;
        }

        if (!res.ok || data?.ok === false) {
          const err = new ApiError(
            String(data?.error || `${method} ${path} failed with HTTP ${res.status}`),
            { status: res.status, method, path, data }
          );
          error = err.message;
          if (this.shouldRetry(err, attempt, retries)) {
            lastError = err;
            await this.sleep(this.retryDelay);
            attempt += 1;
            continue;
          }
          throw err;
        }

        return data;
      } catch (err) {
        clearTimeout(timer);
        const apiErr = err instanceof ApiError
          ? err
          : new ApiError(
              err.name === "AbortError" ? `${method} ${path} timed out` : String(err.message || err),
              {
                method,
                path,
                code: err.code || (err.name === "AbortError" ? "ETIMEDOUT" : null)
              }
            );
        error = apiErr.message;
        if (this.shouldRetry(apiErr, attempt, retries)) {
          lastError = apiErr;
          await this.sleep(this.retryDelay);
          attempt += 1;
          continue;
        }
        throw apiErr;
      }
      finally {
        if (status != null || response != null || error != null) {
          const inferredTeamId = this.inferTeamId(path, response);
          const entryTeamId = inferredTeamId || this.teamId || null;
          if (!this.teamId && inferredTeamId) {
            this.teamId = inferredTeamId;
          }
          this.logApiCall({
            teamId: entryTeamId,
            memberId: this.currentMemberId,
            step: this.currentStep,
            method,
            path,
            request: body,
            status,
            response,
            durationMs: Date.now() - startedAt,
            attempt: attempt + 1,
            error
          });
        }
      }
    }

    throw lastError || new ApiError(`${method} ${path} failed`);
  }

  shouldRetry(err, attempt, retries) {
    if (attempt >= retries) return false;
    if (!err) return false;
    if (err.code === "ETIMEDOUT") return true;
    if (err.status == null) return true;
    return err.status >= 500;
  }

  sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  setContext(step, memberId = null) {
    this.currentStep = step || null;
    this.currentMemberId = memberId || null;
    return this;
  }

  setTeamId(teamId) {
    this.teamId = teamId || null;
    return this;
  }

  withContext(step, memberId = null) {
    return new ApiClient(this.baseUrl, {
      retries: this.retries,
      retryDelay: this.retryDelay,
      timeoutMs: this.timeoutMs,
      logger: this.logger,
      teamId: this.teamId,
      currentStep: step || null,
      currentMemberId: memberId || null
    });
  }

  inferTeamId(path, response) {
    if (response && typeof response === "object") {
      if (response.team?.id) return response.team.id;
      if (response.team_id) return response.team_id;
      if (response.teamId) return response.teamId;
      if (response.submission?.team_id) return response.submission.team_id;
      if (response.result?.team_id) return response.result.team_id;
    }
    const match = String(path || "").match(/^\/api\/team\/([^/]+)/);
    if (match) return decodeURIComponent(match[1]);
    const queryMatch = String(path || "").match(/[?&]teamId=([^&]+)/);
    if (queryMatch) return decodeURIComponent(queryMatch[1]);
    return null;
  }

  logApiCall(entry) {
    if (!this.logger || typeof this.logger.logApiCall !== "function") return;
    this.logger.logApiCall(entry);
  }

  async health() {
    return this.get("/api/health");
  }

  async createTeam(teamName, teamSize) {
    return this.post("/api/team/create", { teamName, teamSize });
  }

  async joinTeam(teamId, memberName) {
    return this.post(`/api/team/${encodeURIComponent(teamId)}/join`, { memberName });
  }

  async getTeam(teamId) {
    return this.get(`/api/team/${encodeURIComponent(teamId)}`);
  }

  async getJinang(teamId, memberId) {
    return this.get(`/api/team/${encodeURIComponent(teamId)}/member/${encodeURIComponent(memberId)}/jinang`);
  }

  async submitPhase1(teamId, memberId, data) {
    return this.post(`/api/team/${encodeURIComponent(teamId)}/phase1/${encodeURIComponent(memberId)}/submit`, data);
  }

  async getTeamStatus(teamId) {
    return this.get(`/api/team/${encodeURIComponent(teamId)}/status`);
  }

  async getSubmissions(teamId) {
    return this.get(`/api/team/${encodeURIComponent(teamId)}/submissions`);
  }

  async chatVP(teamId, payload) {
    return this.post(`/api/team/${encodeURIComponent(teamId)}/phase3/chat`, payload);
  }

  async submitVP(teamId, payload) {
    return this.post(`/api/team/${encodeURIComponent(teamId)}/phase3/submit-vp`, payload);
  }

  async confirmAndScoreVP(payload) {
    return this.post("/api/vp/confirm-and-score", payload);
  }

  async getPhase3State(teamId) {
    return this.get(`/api/team/${encodeURIComponent(teamId)}/phase3/state`);
  }

  async finalizeVP(teamId, payload) {
    return this.post(`/api/team/${encodeURIComponent(teamId)}/phase3/finalize`, payload);
  }

  async getPhase4(teamId) {
    return this.get(`/api/team/${encodeURIComponent(teamId)}/phase4`);
  }

  async freezeTeam(teamId, payload = {}) {
    return this.post(`/api/team/${encodeURIComponent(teamId)}/freeze`, payload);
  }

  async getRecap(teamId) {
    return this.get(`/api/round2/recap?teamId=${encodeURIComponent(teamId)}`);
  }

  async getRound2State(teamId, memberId = "") {
    const query = new URLSearchParams({ teamId: String(teamId || "") });
    if (memberId) query.set("memberId", String(memberId));
    return this.get(`/api/round2/state?${query.toString()}`);
  }

  async assignDimensions(teamId, memberCount) {
    return this.post("/api/round2/assign-dimensions", { teamId, memberCount });
  }

  async startInterview(teamId, memberId, payload = {}) {
    return this.post("/api/round2/interview/start", { teamId, memberId, ...payload });
  }

  async replyInterview(sessionId, message) {
    return this.post("/api/round2/interview/reply", { sessionId, message });
  }

  async endInterview(sessionId) {
    return this.post("/api/round2/interview/end", { sessionId });
  }

  async getInterviewSession(teamId, memberId, sessionId = "") {
    const query = new URLSearchParams({ teamId: String(teamId || ""), memberId: String(memberId || "") });
    if (sessionId) query.set("sessionId", String(sessionId));
    return this.get(`/api/round2/interview/session?${query.toString()}`);
  }

  async getRDCards() {
    return this.get("/api/rd/cards");
  }

  async validateSelections(payload) {
    return this.post("/api/rd/validate", payload);
  }

  async calculateRD(payload) {
    return this.post("/api/rd/calculate", payload);
  }

  async saveMemberSelection(teamId, memberId, selections) {
    return this.post("/api/round2/individual-submit", { teamId, memberId, selections });
  }

  async mergeTeam(teamId, COGSbase = "") {
    const query = new URLSearchParams({ teamId: String(teamId || "") });
    if (COGSbase !== "" && COGSbase != null) query.set("COGSbase", String(COGSbase));
    return this.get(`/api/round2/team-merge?${query.toString()}`);
  }

  async submitFinal(teamId, payload) {
    return this.post("/api/round2/team-submit", { teamId, ...payload });
  }

  async getTeamResult(teamId, sessionId = "default") {
    return this.get(`/api/round2/team-result?teamId=${encodeURIComponent(teamId)}&sessionId=${encodeURIComponent(sessionId)}`);
  }

  async getComputationLog(teamId, stage = "") {
    const query = stage ? `?stage=${encodeURIComponent(stage)}` : "";
    return this.get(`/api/computation-log/${encodeURIComponent(teamId)}${query}`);
  }

  async getComputationChain(teamId) {
    return this.get(`/api/computation-log/${encodeURIComponent(teamId)}/chain`);
  }
}

module.exports = {
  ApiClient,
  ApiError
};
