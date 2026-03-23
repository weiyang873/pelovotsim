"use strict";

const fs = require("node:fs");
const path = require("node:path");

class SimLogger {
  constructor() {
    this.entries = [];
  }

  logApiCall(entry) {
    this.entries.push({
      type: "api",
      timestamp: new Date().toISOString(),
      teamId: entry.teamId || null,
      memberId: entry.memberId || null,
      step: entry.step || null,
      method: entry.method || null,
      path: entry.path || null,
      requestBody: entry.request ?? null,
      responseStatus: entry.status ?? null,
      responseBody: entry.response ?? null,
      durationMs: entry.durationMs ?? null,
      attempt: entry.attempt ?? null,
      error: entry.error || null
    });
  }

  logStudentLLM(entry) {
    this.entries.push({
      type: "student_llm",
      timestamp: new Date().toISOString(),
      teamId: entry.teamId || null,
      memberId: entry.memberId || null,
      personaId: entry.personaId || null,
      personaLabel: entry.personaLabel || null,
      step: entry.step || null,
      prompt: entry.prompt ?? null,
      completion: entry.completion ?? null,
      model: entry.model || "deepseek-chat",
      tokens: entry.tokens || null,
      durationMs: entry.durationMs ?? null,
      usedFallback: entry.usedFallback === true
    });
  }

  exportAll(filePath) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(this.entries, null, 2));
  }

  exportByTeam(dirPath) {
    const grouped = {};
    for (const entry of this.entries) {
      const key = entry.teamId || "_global";
      if (!grouped[key]) grouped[key] = [];
      grouped[key].push(entry);
    }
    fs.mkdirSync(dirPath, { recursive: true });
    Object.entries(grouped).forEach(([teamId, entries]) => {
      fs.writeFileSync(
        path.join(dirPath, `${teamId}.json`),
        JSON.stringify(entries, null, 2)
      );
    });
  }
}

module.exports = {
  SimLogger
};
