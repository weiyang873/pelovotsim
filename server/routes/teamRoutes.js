const path = require("node:path");
const { runSql, sqlQuote } = require("../db/pgSql");

const Engine = require("../../engine");
const { chat } = require("../llm/vpCoach");
const { scoreVp } = require("../llm/vpScorer");
const { chatCompletion } = require("../llm/deepseekClient");
const { withLlmLogging } = require("../llm/llm_logger");
const {
  createVpSession,
  appendMessage,
  getSession,
  updateSession,
  getTeamSessions
} = require("../llm/sessions");
const { settleAllJinang } = require("../multiplayer/jinangSettler");
const { getMemberJinang } = require("../multiplayer/jinangDealer");
const { getTeam, updateTeamStatus, createTeam: createTeamRow, joinTeam: joinTeamRow } = require("../multiplayer/teamManager");
const { getTeamRound2State } = require("../multiplayer/round2State");

const ROOT = path.join(__dirname, "..", "..");
const CONFIG_DIR = path.join(ROOT, "game_config_v0.1");

let cachedEngineConfig = null;

function makeResponse(status, body) {
  return { status, body };
}

function getEngineConfig() {
  if (!cachedEngineConfig) {
    cachedEngineConfig = Engine.loadConfig(CONFIG_DIR);
  }
  return cachedEngineConfig;
}

function clipScore(v, lo, hi) {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return Math.max(lo, Math.min(hi, Math.round(n * 10) / 10));
}

function getEligibleMarketMatchStrength(settlements) {
  const list = Array.isArray(settlements) ? settlements : [];
  return list.reduce((mx, item) => {
    if (!item || item.jinang_type !== "market" || !item.matched) return mx;
    let effect = {};
    try {
      effect = item.effect_applied && typeof item.effect_applied === "object"
        ? item.effect_applied
        : JSON.parse(item.effect_applied || "{}");
    } catch (_) {
      effect = {};
    }
    if (!effect.E_boost_eligible) return mx;
    const strength = Number(effect.match_strength ?? item.match_strength ?? 0);
    if (!Number.isFinite(strength)) return mx;
    return Math.max(mx, strength);
  }, 0);
}

function hasAnyScore(scores) {
  if (!scores || typeof scores !== "object") return false;
  return ["C", "G", "E"].some((key) => clipScore(scores[key], 1, 5) != null);
}

function isClearlyBrokenScoreSet(scores) {
  if (!scores || typeof scores !== "object") return true;
  const values = ["C", "G", "E"].map((key) => clipScore(scores[key], 1, 5));
  if (values.every((v) => v == null)) return true;
  return values.every((v) => v != null && v <= 1.0);
}

async function getRecoveredVpScores(teamId) {
  const sessions = await getTeamSessions(teamId);
  const list = Array.isArray(sessions) ? sessions.slice().reverse() : [];
  for (const session of list) {
    const recovered = vpResultToApiScores(session?.pmfScore || null);
    if (!recovered) continue;
    return {
      C: clipScore(recovered.coverage, 1, 5),
      G: clipScore(recovered.generalizability, 1, 5),
      E: clipScore(recovered.effectiveness, 1, 5)
    };
  }
  return null;
}

function getLatestPhase3Session(sessions) {
  const list = Array.isArray(sessions) ? sessions : [];
  return list
    .filter((s) => s && s.sessionId)
    .sort((a, b) => String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")))[0] || null;
}

function shouldHideRestoredUserMessage(text) {
  const src = String(text || "").trim();
  if (!src) return true;
  if (/^你是 EMBA 课程中的 AI 产品教练/.test(src)) return true;
  if (/^请基于我们目前的讨论内容给出本轮评分/.test(src)) return true;
  if (/^请基于我们目前的讨论，继续以教练方式指出这一版最需要补强的一点/.test(src)) return true;
  if (/^我们决定确认提交最终版价值主张/.test(src)) return true;
  return false;
}

function inferCoachMessageType(text) {
  const src = String(text || "");
  if (/<vp_result>/i.test(src) || /确认提交|最终结果/.test(src)) return "confirm";
  if (/\d\.\d\/5\.0/.test(src)) return "score";
  return "chat";
}

function restoreCoachHistory(messages) {
  const list = Array.isArray(messages) ? messages : [];
  return list
    .filter((m) => m && m.role && (! (m.role === "user" && shouldHideRestoredUserMessage(m.content))))
    .map((m, idx) => ({
      type: m.role === "assistant" ? inferCoachMessageType(m.content) : "chat",
      role: m.role === "assistant" ? "coach" : "user",
      text: String(m.content || ""),
      ts: m.timestamp || `${idx}`
    }));
}

function parseGridId(gridId) {
  const raw = String(gridId || "").trim();
  if (!raw) throw new Error("grid_id is required");
  const parts = raw.split("_");
  if (parts.length < 3) {
    throw new Error(`invalid grid_id: ${raw}`);
  }

  const customerRaw = String(parts[0] || "").toLowerCase();
  const strategyRaw = String(parts[1] || "").toLowerCase();
  const ageRaw = String(parts[2] || "").toLowerCase();

  const customerType = customerRaw === "tob" || customerRaw === "b2b" ? "ToB" : "ToC";
  const strategy = strategyRaw.includes("cost") ? "COST" : "DIFF";
  let ageGroup = "ADULT";
  if (ageRaw.includes("child")) ageGroup = "CHILD";
  if (ageRaw.includes("elder")) ageGroup = "ELDER";

  return { customerType, strategy, ageGroup };
}

function normalizeArchitecture(value) {
  const v = String(value || "").trim().toLowerCase();
  if (v === "experience") return "Experience";
  if (v === "hybrid") return "Hybrid";
  if (v === "function") return "Function";
  throw new Error("architecture must be Experience / Hybrid / Function");
}

function normalizeConfirmedArchitecture(value) {
  const raw = String(value || "").trim();
  if (!raw) return null;
  const low = raw.toLowerCase();
  if (low === "experience" || low.includes("体验")) return "Experience";
  if (low === "hybrid" || low.includes("混合")) return "Hybrid";
  if (low === "function" || low.includes("功能")) return "Function";
  return null;
}

function computePersonalGmMax({ gridId, architecture }) {
  const arch = normalizeArchitecture(architecture);
  const result = Engine.computeRound1(
    {
      round1: {
        cell_id: gridId,
        arch_tag: arch,
        vp_scores: { C: 3, G: 3, E: 3 },
        jinang_market_match_strength: 0
      }
    },
    getEngineConfig()
  );
  return {
    gmMax: Number(result.WTPadj || result.WTPref || 0),
    channelPrefNormalized: null
  };
}

async function readSubmission(teamId, memberId) {
  const rows = await runSql(`
    SELECT id, member_id, team_id, grid_id, architecture, channel_pref, vp_draft, personal_gm_max, submitted_at
    FROM member_submissions
    WHERE team_id = ${sqlQuote(teamId)} AND member_id = ${sqlQuote(memberId)}
    LIMIT 1;
  `);
  return rows[0] || null;
}


async function countTeamSubmissions(teamId) {
  const rows = await runSql(`
    SELECT COUNT(*) AS c
    FROM member_submissions
    WHERE team_id = ${sqlQuote(teamId)};
  `);
  return Number(rows[0]?.c || 0);
}

async function assertMemberInTeam(teamId, memberId) {
  const rows = await runSql(`
    SELECT id, team_id, member_name, member_index, jinang_market_id, jinang_tech_id, joined_at
    FROM team_members
    WHERE id = ${sqlQuote(memberId)} AND team_id = ${sqlQuote(teamId)}
    LIMIT 1;
  `);
  if (!rows[0]) throw new Error("member not found in team");
  return rows[0];
}


async function submitPhase1(teamId, memberId, body) {
  try {
    const team = await getTeam(teamId);
    if (!team) return makeResponse(404, { ok: false, error: "team not found" });
    await assertMemberInTeam(teamId, memberId);
    if (await readSubmission(teamId, memberId)) {
      return makeResponse(400, { ok: false, error: "already submitted" });
    }

    const payload = body || {};
    const gridId = String(payload.grid_id || "").trim();
    const architecture = String(payload.architecture || "").trim();
    const outline = String(payload.vp_outline || "").trim();
    const who = String(payload.who || outline || "").trim();
    const pain = String(payload.pain || outline || "").trim();
    const how = String(payload.how || outline || "").trim();
    const vpDraft = `WHO: ${who}\nPAIN: ${pain}\nHOW: ${how}`.trim();
    if (!gridId) return makeResponse(400, { ok: false, error: "grid_id required" });
    if (!architecture) return makeResponse(400, { ok: false, error: "architecture required" });
    if (!who || !pain || !how) return makeResponse(400, { ok: false, error: "who, pain, how required" });

    const calc = computePersonalGmMax({
      gridId,
      architecture
    });

    const id = cryptoRandomId();
    const now = new Date().toISOString();
    await runSql(`
      INSERT INTO member_submissions (
        id, member_id, team_id, grid_id, architecture, channel_pref, vp_draft, personal_gm_max, submitted_at
      ) VALUES (
        ${sqlQuote(id)},
        ${sqlQuote(memberId)},
        ${sqlQuote(teamId)},
        ${sqlQuote(gridId)},
        ${sqlQuote(normalizeArchitecture(architecture))},
        NULL,
        ${sqlQuote(vpDraft)},
        ${Number(calc.gmMax)},
        ${sqlQuote(now)}
      );
    `);

    const submittedCount = await countTeamSubmissions(teamId);
    const teamSize = Number(team.team_size || 0);
    let statusUpdated = false;
    if (submittedCount >= teamSize && team.status !== "phase2") {
      await updateTeamStatus(teamId, "phase2");
      statusUpdated = true;
    }

    return makeResponse(200, {
      ok: true,
      submission_id: id,
      personal_gm_max: Number(calc.gmMax),
      submitted_count: submittedCount,
      team_size: teamSize,
      team_status_updated_to_phase2: statusUpdated
    });
  } catch (e) {
    return makeResponse(400, { ok: false, error: e.message });
  }
}

function cryptoRandomId() {
  return `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function scoreToFiveDecimal(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  // Legacy 0-1 scores should only be upscaled when they are strictly below 1.
  // Current scoring pipeline already uses 1.0-5.0, so 1.0 must stay 1.0.
  if (n > 0 && n < 1) return Math.max(1.0, Math.min(5.0, Math.round(n * 5 * 10) / 10));
  return Math.max(1.0, Math.min(5.0, Math.round(n * 10) / 10));
}

function vpResultToApiScores(vpResult) {
  if (!vpResult || typeof vpResult !== "object") return null;
  const scores = vpResult.scores;
  if (!scores || typeof scores !== "object") return null;
  const read = (x) => {
    if (x && typeof x === "object") return scoreToFiveDecimal(x.score);
    return scoreToFiveDecimal(x);
  };
  const coverage = read(scores.C);
  const generalizability = read(scores.G);
  const effectiveness = read(scores.E);
  if (!coverage || !generalizability || !effectiveness) return null;
  return { coverage, generalizability, effectiveness };
}

function areApiScoresEmpty(scores) {
  if (!scores || typeof scores !== "object") return true;
  return ["coverage", "generalizability", "effectiveness"].every((key) => scores[key] == null);
}

function pickLatestLabeledValue(parts, label) {
  const list = Array.isArray(parts) ? parts : [];
  for (let i = list.length - 1; i >= 0; i -= 1) {
    const value = extractTextValue(list[i], label);
    if (value) return value;
  }
  return "";
}

function buildFallbackVpResult({ sessionMessages, replyText, userMessage, scores }) {
  const parts = [];
  const list = Array.isArray(sessionMessages) ? sessionMessages : [];
  list.forEach((m) => {
    parts.push(String(m?.content || ""));
  });
  parts.push(String(replyText || ""));
  parts.push(String(userMessage || ""));

  const who = pickLatestLabeledValue(parts, "WHO") || "未提取到明确目标人群";
  const pain = pickLatestLabeledValue(parts, "PAIN") || "未提取到明确痛点场景";
  const how = pickLatestLabeledValue(parts, "HOW") || "未提取到明确解决机制";
  const normalizedScores = {
    coverage: clipScore(scores?.coverage, 1, 5),
    generalizability: clipScore(scores?.generalizability, 1, 5),
    effectiveness: clipScore(scores?.effectiveness, 1, 5)
  };

  return {
    target_customer: who,
    scenario_pain: pain,
    value_creation: how,
    boundary: pickLatestLabeledValue(parts, "BOUNDARY") || "未明确",
    scores: {
      C: { score: normalizedScores.coverage, feedback: "" },
      G: { score: normalizedScores.generalizability, feedback: "" },
      E: { score: normalizedScores.effectiveness, feedback: "" }
    }
  };
}

function buildMemberLinks(teamId, members) {
  const arr = Array.isArray(members) ? members : [];
  return arr.map((m) => ({
    member_id: m.id,
    member_name: m.member_name,
    member_index: m.member_index,
    flow_url: `/multiplayer?teamId=${encodeURIComponent(teamId)}&memberId=${encodeURIComponent(m.id)}`
  }));
}

async function getOrCreatePhase3Session(teamId) {
  const all = await getTeamSessions(teamId) || [];
  const existing = all
    .filter((s) => s && s.status !== "submitted")
    .sort((a, b) => String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")))[0];
  if (existing?.sessionId) return existing.sessionId;
  return createVpSession(teamId, {});
}

async function buildPhase3JinangContext(teamId) {
  const team = await getTeam(teamId);
  const members = Array.isArray(team?.members) ? team.members : [];
  const market = [];
  const tech = [];
  for (const member of members) {
    try {
      const jinang = await getMemberJinang(member.id);
      if (jinang?.market?.name || jinang?.market?.id) {
        market.push(jinang.market.name || jinang.market.id);
      }
      if (jinang?.tech?.name || jinang?.tech?.id) {
        tech.push(jinang.tech.name || jinang.tech.id);
      }
    } catch (_) {
      // ignore missing jinang and keep best-effort prompt context
    }
  }
  return { market, tech };
}

function toArchLabel(arch) {
  if (arch === "Experience") return "体验";
  if (arch === "Function") return "功能";
  if (arch === "Hybrid") return "混合";
  return arch || "未知";
}

function toArchitecturePromptLabel(arch) {
  if (arch === "Experience") return "体验型";
  if (arch === "Function") return "功能型";
  if (arch === "Hybrid") return "混合型";
  return arch || "未提供";
}

function emptyApiScores() {
  return {
    coverage: null,
    generalizability: null,
    effectiveness: null
  };
}

function scorerScoresToApi(scores) {
  if (!scores || typeof scores !== "object") return null;
  const coverage = clipScore(scores.C, 1, 5);
  const generalizability = clipScore(scores.G, 1, 5);
  const effectiveness = clipScore(scores.E, 1, 5);
  if (coverage == null || generalizability == null || effectiveness == null) return null;
  return { coverage, generalizability, effectiveness };
}

function buildVpResultScoringText(vpResult) {
  const result = vpResult && typeof vpResult === "object" ? vpResult : null;
  if (!result) return "";
  return [
    result.target_customer || result.who ? `目标客户：${String(result.target_customer || result.who || "").trim()}` : "",
    result.scenario_pain || result.pain ? `场景痛点：${String(result.scenario_pain || result.pain || "").trim()}` : "",
    result.value_creation || result.how ? `价值创造：${String(result.value_creation || result.how || "").trim()}` : "",
    result.boundary ? `边界条件：${String(result.boundary || "").trim()}` : ""
  ].filter(Boolean).join("\n");
}

const AUTO_VP_DRAFT_REQUEST = "请帮我们整理当前最新版本的价值主张，用一句完整的话，放在引号里。然后指出当前最需要提升的一个方向。";

function extractVpSentence(text) {
  const content = String(text || "");
  const patterns = [
    /[“"]([\s\S]{20,}?)[”"]/g,
    /「([\s\S]{20,}?)」/g,
    /"([\s\S]{20,}?)"/g
  ];

  let longest = "";
  for (const pattern of patterns) {
    let match = null;
    while ((match = pattern.exec(content)) !== null) {
      const candidate = String(match[1] || "").trim();
      if (candidate.length > longest.length) {
        longest = candidate;
      }
    }
  }
  return longest || null;
}

function countPhase3StudentMessages(messages) {
  const list = Array.isArray(messages) ? messages : [];
  return list.filter((item) => item && item.role === "user").length;
}

function getCachedPhase3ScorePayload(pmfScore) {
  const cached = pmfScore && typeof pmfScore === "object" ? pmfScore : null;
  if (!cached || !cached.scores) return null;
  const scores = vpResultToApiScores(cached);
  if (!scores || areApiScoresEmpty(scores) || !String(cached._vp_sentence || "").trim()) return null;
  return {
    replyText: "",
    vpResult: cached,
    vpResultRaw: null,
    vpDraft: String(cached._vp_sentence || "").trim(),
    scores,
    scoreValid: true,
    features: cached._scoring_features || cached.features || null,
    scoredAtUserMsgCount: Number(cached._scored_at_user_msg_count || 0)
  };
}

function extractTextValue(src, key) {
  const text = String(src || "");
  const re = new RegExp(`${key}\\s*[：:]\\s*([^\\n]+)`);
  const m = text.match(re);
  return m ? m[1].trim() : "";
}

async function summarizeVpFromConversation({ gridId, architecture, sessionMessages, payloadConversation, payloadVpResult }) {
  const directVpResult = payloadVpResult && typeof payloadVpResult === "object" ? payloadVpResult : null;
  if (directVpResult) {
    const who = String(directVpResult.target_customer || directVpResult.who || "").trim();
    const pain = String(directVpResult.scenario_pain || directVpResult.pain || "").trim();
    const how = String(directVpResult.value_creation || directVpResult.how || "").trim();
    const boundary = String(directVpResult.boundary || "").trim();
    return {
      text: [
        `WHO：${who || "未提取到明确目标人群"}`,
        `PAIN：${pain || "未提取到明确痛点场景"}`,
        `HOW：${how || "未提取到明确解决机制"}`,
        `BOUNDARY：${boundary || "未明确"}`,
        `架构一致性：${toArchLabel(architecture)}（待确认）`,
        "AI策略顾问点评：已按确认版本写入最终价值主张。"
      ].join("\n"),
      confirmedArchitecture: null
    };
  }

  const convoLines = [];
  const msgs = Array.isArray(sessionMessages) ? sessionMessages : [];
  msgs.forEach((m) => {
    const role = m.role === "assistant" ? "Coach" : "Team";
    convoLines.push(`[${role}] ${String(m.content || "").trim()}`);
  });
  const payloadLines = Array.isArray(payloadConversation) ? payloadConversation : [];
  payloadLines.forEach((m) => {
    const role = m.role === "coach" ? "Coach" : "Team";
    convoLines.push(`[${role}] ${String(m.text || "").trim()}`);
  });
  const convoText = convoLines.join("\n").trim() || "（暂无有效对话记录）";

  const prompt = `请根据以下小组与 AI 教练的对话记录，提取并输出最终的 Value Proposition 摘要。
请仅输出 JSON（不要输出代码块），字段如下：
{
  "who": "一句话",
  "pain": "一句话",
  "how": "一句话",
  "arch_consistency": "一句话",
  "coach_comment": "一句话",
  "confirmed_architecture": "Experience|Hybrid|Function|null"
}

补充上下文：
- 小组定位格子：${gridId}
- 架构标签：${toArchLabel(architecture)}

架构提取规则：
- 如果对话中 Coach 明确说“明确了是XX型”或同义确认语句，以该架构为准
- 如果学生在对话中改变了架构选择，以最后一次明确表态为准
- 如果对话中从未讨论过架构，返回 null

对话记录：
${convoText}`;

  try {
    const messages = [
      { role: "system", content: "你是 EMBA 课程助教。请严格按给定格式输出，简洁清晰，不要输出多余段落。" },
      { role: "user", content: prompt }
    ];
    const raw = await withLlmLogging({
      caller: "teamRoutes.summarizeVpFromConversation",
      teamId: null,
      memberId: null,
      messages
    }, () => chatCompletion(
      messages,
      { temperature: 0.2, max_tokens: 500 }
    ));
    let parsed = null;
    const jsonMatch = String(raw || "").match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      try {
        parsed = JSON.parse(jsonMatch[0]);
      } catch (_) {
        parsed = null;
      }
    }
    const who = String(parsed?.who || "").trim() || extractTextValue(raw, "WHO（目标人群）") || extractTextValue(raw, "WHO");
    const pain = String(parsed?.pain || "").trim() || extractTextValue(raw, "PAIN（核心痛点\\+触发情境）") || extractTextValue(raw, "PAIN");
    const how = String(parsed?.how || "").trim() || extractTextValue(raw, "HOW（解决机制）") || extractTextValue(raw, "HOW");
    const archLine = String(parsed?.arch_consistency || "").trim() || extractTextValue(raw, "架构一致性");
    const coachLine =
      String(parsed?.coach_comment || "").trim() ||
      extractTextValue(raw, "AI策略顾问点评") ||
      extractTextValue(raw, "Coach 最终评价");
    const confirmedArchitecture = normalizeConfirmedArchitecture(
      parsed?.confirmed_architecture ||
      extractTextValue(raw, "confirmed_architecture") ||
      extractTextValue(raw, "确认架构")
    );
    const normalized = [
      `WHO：${who || "未提取到明确目标人群"}`,
      `PAIN：${pain || "未提取到明确痛点场景"}`,
      `HOW：${how || "未提取到明确解决机制"}`,
      `架构一致性：${archLine || `${toArchLabel(architecture)}（待确认）`}`,
      `AI策略顾问点评：${coachLine || "建议继续补充关键细节后再提交。"}`
    ].join("\n");
    return { text: normalized, confirmedArchitecture };
  } catch (_) {
    return {
      text: [
      "WHO：未提取到明确目标人群",
      "PAIN：未提取到明确痛点场景",
      "HOW：未提取到明确解决机制",
      `架构一致性：${toArchLabel(architecture)}（待确认）`,
      "AI策略顾问点评：AI策略顾问暂不可用，建议手动整理 VP 后重试。"
      ].join("\n"),
      confirmedArchitecture: null
    };
  }
}

async function createTeamApi(body) {
  try {
    const teamName = String(body?.teamName || "").trim();
    const teamSize = Number(body?.teamSize);
    const team = await createTeamRow(teamName, teamSize);
    const full = await getTeam(team.id);
    return makeResponse(200, {
      ok: true,
      team: full,
      member_links: buildMemberLinks(full.id, full.members),
      flow_url: `/multiplayer?teamId=${encodeURIComponent(full.id)}`
    });
  } catch (e) {
    return makeResponse(400, { ok: false, error: e.message });
  }
}

async function joinTeamApi(body) {
  try {
    const teamId = String(body?.teamId || "").trim();
    const memberName = String(body?.memberName || "").trim();
    const member = await joinTeamRow(teamId, memberName);
    const full = await getTeam(teamId);
    return makeResponse(200, {
      ok: true,
      team: full,
      member,
      flow_url: `/multiplayer?teamId=${encodeURIComponent(teamId)}&memberId=${encodeURIComponent(member.id)}`,
      member_links: buildMemberLinks(teamId, full?.members || [])
    });
  } catch (e) {
    return makeResponse(400, { ok: false, error: e.message });
  }
}

async function getTeamApi(teamId) {
  try {
    const tid = String(teamId || "").trim();
    const team = await getTeam(tid);
    if (!team) return makeResponse(404, { ok: false, error: "team not found" });
    return makeResponse(200, {
      ok: true,
      team,
      member_links: buildMemberLinks(team.id, team.members)
    });
  } catch (e) {
    return makeResponse(400, { ok: false, error: e.message });
  }
}


function resolvePhase3Strategy(gridId, architecture) {
  const parsed = parseGridId(gridId);
  const normalizedArchitecture = normalizeArchitecture(architecture);
  const cellLabel = `${parsed.customerType}·${parsed.strategy === "DIFF" ? "差异" : "成本"}·${parsed.ageGroup === "CHILD" ? "儿童" : (parsed.ageGroup === "ELDER" ? "老人" : "成人")}`;
  return {
    grid_id: gridId,
    cell_label: cellLabel,
    market: parsed.customerType === "ToC" ? "ToC" : "ToB",
    competitive: parsed.strategy === "DIFF" ? "DIFF" : "COST",
    segment: parsed.ageGroup,
    architecture: normalizedArchitecture,
    architecture_label: normalizedArchitecture
  };
}

function getPhaseByStatus(status) {
  const s = String(status || "").toLowerCase();
  if (s === "forming" || s === "phase1") return "phase1";
  if (s === "phase2") return "phase2";
  if (s === "phase3") return "phase3";
  if (s === "phase4") return "phase4";
  if (s === "frozen") return "frozen";
  return "phase1";
}

async function readTeamSubmissions(teamId) {
  const members = await runSql(`
    SELECT id, member_name, member_index
    FROM team_members
    WHERE team_id = ${sqlQuote(teamId)}
    ORDER BY member_index ASC;
  `);

  const out = [];
  for (const m of members) {
    const row = (await runSql(`
      SELECT id, member_id, team_id, grid_id, architecture, channel_pref, vp_draft, personal_gm_max, submitted_at
      FROM member_submissions
      WHERE team_id = ${sqlQuote(teamId)} AND member_id = ${sqlQuote(m.id)}
      LIMIT 1;
    `))[0] || null;

    let hints = { market: null, tech: null };
    try {
      const j = await getMemberJinang(m.id);
      hints = {
        market: j?.market?.hint_keyword || null,
        tech: j?.tech?.hint_keyword || null
      };
    } catch (_) {}

    let channelPref = null;
    if (row?.channel_pref) {
      try {
        channelPref = JSON.parse(row.channel_pref);
      } catch (_) {
        channelPref = null;
      }
    }

    out.push({
      member_id: m.id,
      member_name: m.member_name,
      member_index: m.member_index,
      submitted: Boolean(row),
      submission: row
        ? {
            id: row.id,
            grid_id: row.grid_id,
            architecture: row.architecture,
            channel_pref: channelPref,
            vp_draft: row.vp_draft,
            personal_gm_max: Number(row.personal_gm_max || 0),
            submitted_at: row.submitted_at
          }
        : null,
      hint_keyword: hints
    });
  }
  return out;
}


async function teamSubmissions(teamId) {
  try {
    const team = await getTeam(teamId);
    if (!team) return makeResponse(404, { ok: false, error: "team not found" });
    const submissions = await readTeamSubmissions(teamId);
    return makeResponse(200, {
      ok: true,
      team: {
        id: team.id,
        team_name: team.team_name,
        team_size: Number(team.team_size || 0),
        status: team.status || "forming"
      },
      submissions
    });
  } catch (e) {
    return makeResponse(400, { ok: false, error: e.message });
  }
}


async function submitPhase3Vp(teamId, body) {
  try {
    const team = await getTeam(teamId);
    if (!team) return makeResponse(404, { ok: false, error: "team not found" });

    const payload = body || {};
    const mode = String(payload.mode || payload.action || "score").toLowerCase();
    if (mode !== "score" && mode !== "confirm") {
      return makeResponse(400, { ok: false, error: "mode must be score or confirm" });
    }

    const requestedGridId = String(payload.grid_id || "").trim();
    const requestedArch = String(payload.architecture || "").trim();
    const gridId = requestedGridId || String(team.final_grid_id || "").trim();
    const architecture = requestedArch || String(team.final_architecture || "Experience").trim();
    if (!gridId || !architecture) {
      return makeResponse(400, { ok: false, error: "grid_id and architecture required" });
    }

    const jinangContext = payload.jinang && typeof payload.jinang === "object"
      ? payload.jinang
      : await buildPhase3JinangContext(teamId);
    const strategy = {
      ...resolvePhase3Strategy(gridId, architecture),
      jinang: jinangContext
    };
    const architectureLabel = toArchitecturePromptLabel(strategy.architecture_label || strategy.architecture);
    const confirmUserMessage = "我们决定确认提交最终版价值主张，请给出最终提交结果。";

    const sessionId = await getOrCreatePhase3Session(teamId);
    await updateSession(sessionId, { strategy });
    let session = await getSession(sessionId);
    if (!session) return makeResponse(500, { ok: false, error: "vp session not found" });

    let replyText = "";
    let vpResult = null;
    let vpResultRaw = null;
    let vpDraft = null;
    let scoreValid = false;
    let scores = emptyApiScores();
    let features = null;
    let pmfScorePayload = null;
    let scoredAtUserMsgCount = countPhase3StudentMessages(session.messages);

    if (mode === "score") {
      const cached = getCachedPhase3ScorePayload(session.pmfScore);
      console.log("[phase3-score] enter", {
        mode,
        teamId,
        sessionId,
        hasCached: Boolean(cached),
        cachedScoredAtUserMsgCount: Number(session?.pmfScore?._scored_at_user_msg_count || 0),
        currentUserMsgCount: scoredAtUserMsgCount
      });
      if (cached && cached.scoredAtUserMsgCount === scoredAtUserMsgCount) {
        console.log("[phase3-score] cache-hit", {
          mode,
          teamId,
          sessionId,
          hasCached: true,
          cachedScoredAtUserMsgCount: cached.scoredAtUserMsgCount,
          currentUserMsgCount: scoredAtUserMsgCount
        });
        replyText = "";
        vpResult = cached.vpResult;
        vpResultRaw = cached.vpResultRaw;
        vpDraft = cached.vpDraft;
        scores = cached.scores;
        scoreValid = cached.scoreValid;
        features = cached.features;
      } else {
        console.log("[phase3-score] cache-miss", {
          mode,
          teamId,
          sessionId,
          hasCached: Boolean(cached),
          cachedScoredAtUserMsgCount: cached ? cached.scoredAtUserMsgCount : null,
          currentUserMsgCount: scoredAtUserMsgCount
        });
        const out = await chat(session, AUTO_VP_DRAFT_REQUEST, { mode: "chat", temperature: 0 });
        replyText = String(out?.replyText || "").trim();

        await appendMessage(sessionId, "user", AUTO_VP_DRAFT_REQUEST);
        await appendMessage(sessionId, "assistant", replyText);

        vpDraft = extractVpSentence(replyText) || "";
        const scoringResult = vpDraft
          ? await scoreVp(vpDraft, strategy.cell_label, architectureLabel).catch(() => null)
          : null;
        features = scoringResult?.features || null;
        scores = scorerScoresToApi(scoringResult?.scores);
        scoreValid = Boolean(scores && !areApiScoresEmpty(scores));
        if (!scoreValid) {
          scores = emptyApiScores();
        }

        const newUserMsgCount = scoredAtUserMsgCount + 1;
        pmfScorePayload = scoreValid ? {
          scores: {
            C: { score: scores.coverage, feedback: "" },
            G: { score: scores.generalizability, feedback: "" },
            E: { score: scores.effectiveness, feedback: "" }
          },
          _scoring_features: features,
          _vp_sentence: vpDraft || "",
          _scored_at_user_msg_count: newUserMsgCount
        } : null;
        await updateSession(sessionId, { pmfScore: pmfScorePayload });
        scoredAtUserMsgCount = newUserMsgCount;
      }
    } else {
      const cached = getCachedPhase3ScorePayload(session.pmfScore);
      const out = await chat(session, confirmUserMessage, { mode: "confirm", temperature: 0 });
      replyText = String(out?.replyText || "").trim();
      vpResult = out?.vpResult || null;
      vpResultRaw = out?.vpResultRaw || null;

      await appendMessage(sessionId, "user", confirmUserMessage);
      await appendMessage(sessionId, "assistant", replyText);

      if (!vpResult) {
        vpResult = buildFallbackVpResult({
          sessionMessages: session.messages,
          replyText,
          userMessage: confirmUserMessage,
          scores: null
        });
      }

      if (cached && cached.scoredAtUserMsgCount === scoredAtUserMsgCount) {
        scores = cached.scores;
        scoreValid = cached.scoreValid;
        features = cached.features;
        vpDraft = cached.vpDraft;
      } else {
        const scoringText = buildVpResultScoringText(vpResult) || replyText || "";
        const scoringResult = await scoreVp(scoringText, strategy.cell_label, architectureLabel).catch(() => null);
        features = scoringResult?.features || null;
        scores = scorerScoresToApi(scoringResult?.scores);
        scoreValid = Boolean(scores && !areApiScoresEmpty(scores));
        if (!scoreValid) {
          scores = emptyApiScores();
        }
        vpDraft = extractVpSentence(replyText) || "";
      }

      if (vpResult && scoreValid) {
        vpResult = {
          ...vpResult,
          scores: {
            C: { score: scores.coverage, feedback: "" },
            G: { score: scores.generalizability, feedback: "" },
            E: { score: scores.effectiveness, feedback: "" }
          }
        };
      }

      pmfScorePayload = {
        ...(vpResult || {}),
        ...(features ? { _scoring_features: features } : {}),
        _vp_sentence: String(vpDraft || "").trim(),
        _scored_at_user_msg_count: scoredAtUserMsgCount
      };

      await updateSession(sessionId, {
        pmfScore: pmfScorePayload,
        status: "submitted"
      });
    }

    const bottleneck = String(replyText || "").split(/\n+/).map((s) => s.trim()).find(Boolean) || "建议补充更具体场景。";
    if (mode === "score") {
      console.log("[phase3-score] vpDraft", {
        teamId,
        sessionId,
        vpDraft,
        coachReply: replyText
      });
    }

    return makeResponse(200, {
      ok: true,
      mode,
      session_id: sessionId,
      has_score_preview: mode === "score" || mode === "confirm",
      score_valid: scoreValid,
      scores,
      features,
      vp_draft: vpDraft,
      scored_at_user_msg_count: scoredAtUserMsgCount,
      bottleneck,
      coach_reply: replyText,
      vp_result: vpResult || null,
      vp_result_raw: vpResultRaw || null
    });
  } catch (e) {
    return makeResponse(400, { ok: false, error: e.message });
  }
}

async function chatPhase3(teamId, body) {
  try {
    const team = await getTeam(teamId);
    if (!team) return makeResponse(404, { ok: false, error: "team not found" });
    const message = String(body?.message || "").trim();
    if (!message) return makeResponse(400, { ok: false, error: "message required" });
    const requestedGridId = String(body?.grid_id || "").trim();
    const requestedArch = String(body?.architecture || "").trim();
    const jinangContext = body?.jinang && typeof body.jinang === "object"
      ? body.jinang
      : await buildPhase3JinangContext(teamId);

    const sessionId = await getOrCreatePhase3Session(teamId);
    if (requestedGridId && requestedArch) {
      const strategy = {
        ...resolvePhase3Strategy(requestedGridId, requestedArch),
        jinang: jinangContext
      };
      await updateSession(sessionId, { strategy });
    }
    const session = await getSession(sessionId);
    if (!session) return makeResponse(500, { ok: false, error: "vp session not found" });

    const out = await chat(session, message, { mode: "chat" });
    await appendMessage(sessionId, "user", message);
    await appendMessage(sessionId, "assistant", out.replyText);
    if (String(session.status || "") !== "submitted") {
      await updateSession(sessionId, { status: "chatting" });
    }

    return makeResponse(200, {
      ok: true,
      session_id: sessionId,
      coach_reply: out.replyText
    });
  } catch (e) {
    return makeResponse(400, { ok: false, error: e.message });
  }
}

async function finalizePhase3(teamId, body) {
  try {
    const team = await getTeam(teamId);
    if (!team) return makeResponse(404, { ok: false, error: "team not found" });

    const payload = body || {};
    const gridId = String(payload.grid_id || "").trim();
    const architecture = String(payload.architecture || "").trim();
    if (!gridId || !architecture) {
      return makeResponse(400, { ok: false, error: "grid_id and architecture required" });
    }

    const arch = normalizeArchitecture(architecture);
    const sessionId = await getOrCreatePhase3Session(teamId);
    const session = await getSession(sessionId);
    const vpSummary = await summarizeVpFromConversation({
      gridId,
      architecture: arch,
      sessionMessages: session?.messages || [],
      payloadConversation: payload.conversation_history || [],
      payloadVpResult: payload.vp_result || null
    });
    const confirmedArch = normalizeConfirmedArchitecture(vpSummary?.confirmedArchitecture);
    const finalArch = confirmedArch && confirmedArch !== arch ? confirmedArch : arch;
    const archSource = confirmedArch && confirmedArch !== arch ? "coach_confirmed" : "player_selected";

    const payloadVpScores = vpResultToApiScores(payload.vp_result || null);
    const scoreInput = payload.scores && typeof payload.scores === "object" ? payload.scores : {};
    const vpScores = {
      C: clipScore(scoreInput.coverage ?? payloadVpScores?.coverage, 1, 5),
      G: clipScore(scoreInput.generalizability ?? payloadVpScores?.generalizability, 1, 5),
      E: clipScore(scoreInput.effectiveness ?? payloadVpScores?.effectiveness, 1, 5)
    };
    const engineVpScores = {
      C: vpScores.C ?? 3,
      G: vpScores.G ?? 3,
      E: vpScores.E ?? 3
    };

    await runSql(`
      UPDATE teams
      SET final_grid_id = ${sqlQuote(gridId)},
          final_architecture = ${sqlQuote(finalArch)},
          final_architecture_source = ${sqlQuote(archSource)},
          final_vp_text = ${sqlQuote(vpSummary.text)},
          final_vp_scores = ${sqlQuote(JSON.stringify(vpScores))}
      WHERE id = ${sqlQuote(teamId)};
    `);

    const settle = await settleAllJinang(teamId);
    const maxMarketMs = getEligibleMarketMatchStrength(settle?.settlements || []);
    const r1 = Engine.computeRound1V2(gridId, finalArch, engineVpScores, maxMarketMs);

    await runSql(`
      UPDATE teams
      SET final_sam = ${Number(r1.SAM_billion)},
          final_wtp_adj = ${Number(r1.WTPadj)},
          final_wtp_ref = ${Number(r1.WTPref)},
          final_vp_c = ${Number(r1.C)},
          final_vp_g = ${Number(r1.G)},
          final_vp_e_raw = ${Number(r1.E_raw)},
          final_vp_e_adj = ${Number(r1.Eadj)},
          final_rho_c = ${Number(r1.rho_C)},
          final_wtp_multiplier = ${Number(r1.wtp_multiplier)}
      WHERE id = ${sqlQuote(teamId)};
    `);

    await updateTeamStatus(teamId, "phase4");

    return makeResponse(200, {
      ok: true,
      team_id: teamId,
      status: "phase4",
      r1_result: r1,
      vp_summary: vpSummary,
      settle
    });
  } catch (e) {
    return makeResponse(400, { ok: false, error: e.message });
  }
}

async function buildPhase4Data(teamId) {
  const team = await getTeam(teamId);
  if (!team) return { ok: false, status: 404, error: "team not found" };
  if (!team.final_grid_id || !team.final_architecture) {
    return { ok: false, status: 400, error: "team final decision incomplete" };
  }

  let rawScores = {};
  try {
    rawScores = JSON.parse(team.final_vp_scores || "{}");
  } catch (_) {
    rawScores = {};
  }
  if (!hasAnyScore(rawScores) || isClearlyBrokenScoreSet(rawScores)) {
    const recoveredScores = await getRecoveredVpScores(teamId);
    if (recoveredScores && !isClearlyBrokenScoreSet(recoveredScores)) {
      rawScores = recoveredScores;
      await runSql(`
        UPDATE teams
        SET final_vp_scores = ${sqlQuote(JSON.stringify(recoveredScores))},
            final_vp_c = ${Number(recoveredScores.C)},
            final_vp_g = ${Number(recoveredScores.G)},
            final_vp_e_raw = ${Number(recoveredScores.E)}
        WHERE id = ${sqlQuote(teamId)};
      `);
    }
  }
  const vpScores = {
    C: clipScore(rawScores.C ?? team.final_vp_c, 1, 5),
    G: clipScore(rawScores.G ?? team.final_vp_g, 1, 5),
    E: clipScore(rawScores.E ?? team.final_vp_e_raw, 1, 5)
  };
  const engineVpScores = {
    C: vpScores.C ?? 3,
    G: vpScores.G ?? 3,
    E: vpScores.E ?? 3
  };

  const settle = await settleAllJinang(teamId);
    const maxMarketMs = getEligibleMarketMatchStrength(settle?.settlements || []);
    const r1Base = Engine.computeRound1V2(team.final_grid_id, team.final_architecture, engineVpScores, 0);
    const r1 = Engine.computeRound1V2(team.final_grid_id, team.final_architecture, engineVpScores, maxMarketMs);

  const vpText = team.final_vp_text || "";
  const extractField = (text, key) => {
    const re = new RegExp(key + "\\s*[：:]\\s*([^\\n]+)");
    const match = String(text || "").match(re);
    return match ? match[1].trim() : "";
  };

  await runSql(`
    UPDATE teams
    SET final_sam = ${Number(r1.SAM_billion)},
        final_wtp_adj = ${Number(r1.WTPadj)},
        final_wtp_ref = ${Number(r1.WTPref)},
        final_vp_c = ${Number(r1.C)},
        final_vp_g = ${Number(r1.G)},
        final_vp_e_raw = ${Number(r1.E_raw)},
        final_vp_e_adj = ${Number(r1.Eadj)},
        final_rho_c = ${Number(r1.rho_C)},
        final_wtp_multiplier = ${Number(r1.wtp_multiplier)}
    WHERE id = ${sqlQuote(teamId)};
  `);

    return {
      ok: true,
      team: {
      id: team.id,
      team_name: team.team_name,
      status: team.status,
      final_grid_id: team.final_grid_id,
      final_architecture: team.final_architecture,
      final_architecture_source: team.final_architecture_source || "player_selected",
      final_vp_text: team.final_vp_text
      },
      r1_result: r1,
      wtp_breakdown: {
        base_result: r1Base,
        final_result: r1,
        market_jinang_match_strength: maxMarketMs,
        base_pct: Math.round(((Number(r1Base.WTPadj || 0) / Math.max(1, Number(r1Base.WTPref || 1))) - 1) * 100),
        final_pct: Math.round(((Number(r1.WTPadj || 0) / Math.max(1, Number(r1.WTPref || 1))) - 1) * 100),
        jinang_delta_pct: Math.round((((Number(r1.WTPadj || 0) - Number(r1Base.WTPadj || 0)) / Math.max(1, Number(r1Base.WTPref || 1)))) * 100)
      },
      vp_scores: {
        C: clipScore(rawScores.C ?? vpScores.C, 1, 5),
        G: clipScore(rawScores.G ?? vpScores.G, 1, 5),
      E: clipScore(rawScores.E ?? vpScores.E, 1, 5)
    },
    vp_summary: {
      who: extractField(vpText, "WHO"),
      pain: extractField(vpText, "PAIN"),
      how: extractField(vpText, "HOW")
    },
    settle
  };
}

async function phase4Data(teamId) {
  try {
    const data = await buildPhase4Data(teamId);
    if (!data.ok) return makeResponse(data.status || 400, { ok: false, error: data.error || "phase4 failed" });
    return makeResponse(200, data);
  } catch (e) {
    return makeResponse(400, { ok: false, error: e.message });
  }
}

async function phase3State(teamId) {
  try {
    const team = await getTeam(teamId);
    if (!team) return makeResponse(404, { ok: false, error: "team not found" });

    const sessions = await getTeamSessions(teamId);
    const session = getLatestPhase3Session(sessions);
    if (!session) {
      return makeResponse(200, {
        ok: true,
        team_id: teamId,
        session_id: null,
        status: "chatting",
        strategy: null,
        coach_history: [],
        score_state: {
          has_score_preview: false,
          score_valid: false,
          scores: {
            coverage: null,
            generalizability: null,
            effectiveness: null
          },
          vp_draft: null,
          scored_at_user_msg_count: 0
        }
      });
    }

    const messages = Array.isArray(session.messages) ? session.messages : [];
    const coachHistory = restoreCoachHistory(messages);
    const scoreFromSession = vpResultToApiScores(session.pmfScore || null);
    const vpDraft = String(session?.pmfScore?._vp_sentence || "").trim();
    const scores = scoreFromSession || {
      coverage: null,
      generalizability: null,
      effectiveness: null
    };
    const scoreValid = Object.values(scores).some((v) => v != null);
    const status = String(session.status || "chatting");
    const hasScorePreview = status === "scored" || status === "submitted" || scoreFromSession != null;

    return makeResponse(200, {
      ok: true,
      team_id: teamId,
      session_id: session.sessionId,
      status,
      strategy: session.strategy || null,
      coach_history: coachHistory,
      score_state: {
        has_score_preview: hasScorePreview,
        score_valid: scoreValid,
        scores,
        vp_draft: vpDraft || "",
        scored_at_user_msg_count: Number(session?.pmfScore?._scored_at_user_msg_count || 0)
      }
    });
  } catch (e) {
    return makeResponse(400, { ok: false, error: e.message });
  }
}

async function getPhase3Scores(teamId) {
  try {
    const team = await getTeam(teamId);
    if (!team) return makeResponse(404, { ok: false, error: "team not found" });

    const sessions = await getTeamSessions(teamId);
    const session = getLatestPhase3Session(sessions);
    if (!session) {
      return makeResponse(200, {
        ok: true,
        team_id: teamId,
        session_id: null,
        score_valid: false,
        scores: {
          coverage: null,
          generalizability: null,
          effectiveness: null
        },
        vp_draft: null,
        scored_at_user_msg_count: 0
      });
    }

    const scores = vpResultToApiScores(session.pmfScore || null) || {
      coverage: null,
      generalizability: null,
      effectiveness: null
    };
    const vpDraft = String(session?.pmfScore?._vp_sentence || "").trim();
    const scoreValid = !areApiScoresEmpty(scores);

    return makeResponse(200, {
      ok: true,
      team_id: teamId,
      session_id: session.sessionId,
      score_valid: scoreValid,
      scores,
      vp_draft: vpDraft || "",
      scored_at_user_msg_count: Number(session?.pmfScore?._scored_at_user_msg_count || 0)
    });
  } catch (e) {
    return makeResponse(400, { ok: false, error: e.message });
  }
}

async function freezeTeam(teamId) {
  try {
    const team = await getTeam(teamId);
    if (!team) return makeResponse(404, { ok: false, error: "team not found" });
    if (!team.final_grid_id) {
      return makeResponse(400, { ok: false, error: "must finalize before freezing" });
    }
    await updateTeamStatus(teamId, "frozen");
    return makeResponse(200, { ok: true, status: "frozen" });
  } catch (e) {
    return makeResponse(400, { ok: false, error: e.message });
  }
}

async function getTeamStatus(teamId) {
  try {
    const team = await getTeam(teamId);
    if (!team) return makeResponse(404, { ok: false, error: "team not found" });
    const memberCount = Array.isArray(team.members) ? team.members.length : 0;
    const submittedCount = await countTeamSubmissions(teamId);
    const status = String(team.status || "forming");
    const round2State = await getTeamRound2State(teamId);
    return makeResponse(200, {
      ok: true,
      status,
      phase: getPhaseByStatus(status),
      all_submitted: submittedCount >= memberCount && memberCount > 0,
      member_count: memberCount,
      submitted_count: submittedCount,
      r2_status: round2State?.r2?.status || "R2_NOT_STARTED",
      r2_status_label: round2State?.r2?.statusLabel || "未开始"
    });
  } catch (e) {
    return makeResponse(400, { ok: false, error: e.message });
  }
}

async function getMemberJinangApi(teamId, memberId) {
  try {
    await assertMemberInTeam(teamId, memberId);
    const jinang = await getMemberJinang(memberId);
    return makeResponse(200, {
      ok: true,
      jinang: {
        member_id: jinang.member_id,
        team_id: jinang.team_id,
        member_name: jinang.member_name,
        market: jinang.market ? {
          id: jinang.market.id,
          name: jinang.market.name,
          desc_for_player: jinang.market.desc_for_player
        } : null,
        tech: jinang.tech ? {
          id: jinang.tech.id,
          name: jinang.tech.name,
          desc_for_player: jinang.tech.desc_for_player
        } : null
      }
    });
  } catch (e) {
    return makeResponse(400, { ok: false, error: e.message });
  }
}

module.exports = {
  createTeamApi,
  joinTeamApi,
  getTeamApi,
  submitPhase1,
  teamSubmissions,
  submitPhase3Vp,
  chatPhase3,
  finalizePhase3,
  phase3State,
  getPhase3Scores,
  phase4Data,
  freezeTeam,
  getTeamStatus,
  getMemberJinangApi,
  clipScore,
  vpResultToApiScores,
  buildVpResultScoringText
};
