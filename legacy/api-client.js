const ApiClient = (() => {
  async function request(url, options) {
    const res = await fetch(url, options);
    const raw = await res.text();
    let data;
    try {
      data = raw ? JSON.parse(raw) : {};
    } catch (_) {
      throw new Error(`接口返回非JSON（${url}）：${raw.slice(0, 120)}`);
    }
    if (!res.ok || data.ok === false) {
      throw new Error(data.error || `HTTP ${res.status}`);
    }
    return data;
  }

  async function health() {
    return request("/api/health");
  }

  async function saveTeamRun(payload) {
    return request("/api/team-runs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
  }

  async function saveIterationEvent(payload) {
    return request("/api/iteration-events", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
  }

  async function getRanking() {
    return request("/api/ranking");
  }

  async function getDbStatus() {
    return request("/api/db-status");
  }

  async function computeRound1(payload) {
    return request("/api/round1-gm", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
  }

  async function exportAll() {
    return request("/api/export");
  }

  async function llmRound1Pain(payload) {
    return request("/api/llm/round1/pain", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
  }

  async function llmRound1Archetypes(payload) {
    return request("/api/llm/round1/archetypes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
  }

  async function llmRound1Features(payload) {
    return request("/api/llm/round1/features", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
  }

  async function llmRound1Summary(payload) {
    return request("/api/llm/round1/summary", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
  }

  async function round1ChatHealth() {
    return request("/api/vp/health");
  }

  async function round1Chat(payload) {
    return request("/api/round1/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
  }

  async function vpCreateSession(payload) {
    return request("/api/vp/session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
  }

  async function vpSubmitCanvas(payload) {
    return request("/api/vp/canvas", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
  }

  async function vpChat(payload) {
    return request("/api/vp/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
  }

  async function marketingStart(payload) {
    return request("/api/marketing/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
  }

  async function marketingInterview(payload) {
    return request("/api/marketing/interview", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
  }

  async function marketingEndInterview(payload) {
    return request("/api/marketing/end-interview", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
  }

  return {
    request,
    health,
    saveTeamRun,
    saveIterationEvent,
    getRanking,
    getDbStatus,
    computeRound1,
    exportAll,
    llmRound1Pain,
    llmRound1Archetypes,
    llmRound1Features,
    llmRound1Summary,
    round1Chat,
    round1ChatHealth,
    vpCreateSession,
    vpSubmitCanvas,
    vpChat,
    marketingStart,
    marketingInterview,
    marketingEndInterview
  };
})();

if (typeof globalThis !== "undefined") {
  globalThis.ApiClient = ApiClient;
}
