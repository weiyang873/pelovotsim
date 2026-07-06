const { runSql, sqlQuote } = require("../db/pgSql");
const TeamRoutes = require("./teamRoutes");
const Round2 = require("./round2Routes");
const { getTeam } = require("../multiplayer/teamManager");
const { loadJinangConfig } = require("../multiplayer/jinangDealer");
const { getTeamSessions } = require("../llm/sessions");

function makeResponse(status, body) {
  return { status, body };
}

function parseJson(value, fallback) {
  if (value == null || value === "") return fallback;
  if (typeof value === "object") return value;
  try {
    return JSON.parse(value);
  } catch (_) {
    return fallback;
  }
}

function normalizeArray(value) {
  return Array.isArray(value) ? value : [];
}

function extractVpField(text, label) {
  const src = String(text || "");
  const match = src.match(new RegExp(`${label}\\s*[：:]\\s*([^\\n]+)`));
  return match ? match[1].trim() : "";
}

function normalizeTimestamp(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  const date = new Date(text);
  if (Number.isNaN(date.getTime())) return text;
  return date.toISOString();
}

function csvEscape(value) {
  if (value == null) return "";
  const text = typeof value === "string" ? value : JSON.stringify(value);
  if (/[",\n]/.test(text)) {
    return `"${text.replace(/"/g, "\"\"")}"`;
  }
  return text;
}

function buildCsv(rows) {
  const list = normalizeArray(rows);
  if (!list.length) return "";
  const headers = Array.from(list.reduce((set, row) => {
    Object.keys(row || {}).forEach((key) => set.add(key));
    return set;
  }, new Set()));
  const lines = [
    headers.map(csvEscape).join(",")
  ];
  list.forEach((row) => {
    lines.push(headers.map((header) => csvEscape(row?.[header])).join(","));
  });
  return `${lines.join("\n")}\n`;
}

const CRC32_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let c = i;
    for (let j = 0; j < 8; j += 1) {
      c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    }
    table[i] = c >>> 0;
  }
  return table;
})();

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc = CRC32_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function dosDateTime(dateInput = new Date()) {
  const date = new Date(dateInput);
  const year = Math.max(1980, date.getUTCFullYear());
  const month = date.getUTCMonth() + 1;
  const day = date.getUTCDate();
  const hours = date.getUTCHours();
  const minutes = date.getUTCMinutes();
  const seconds = Math.floor(date.getUTCSeconds() / 2);
  const dosTime = (hours << 11) | (minutes << 5) | seconds;
  const dosDate = ((year - 1980) << 9) | (month << 5) | day;
  return { dosTime, dosDate };
}

function buildZip(files) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;
  const now = dosDateTime();

  files.forEach((file) => {
    const nameBuffer = Buffer.from(file.name, "utf8");
    const content = Buffer.isBuffer(file.content) ? file.content : Buffer.from(String(file.content || ""), "utf8");
    const checksum = crc32(content);

    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(0, 6);
    localHeader.writeUInt16LE(0, 8);
    localHeader.writeUInt16LE(now.dosTime, 10);
    localHeader.writeUInt16LE(now.dosDate, 12);
    localHeader.writeUInt32LE(checksum, 14);
    localHeader.writeUInt32LE(content.length, 18);
    localHeader.writeUInt32LE(content.length, 22);
    localHeader.writeUInt16LE(nameBuffer.length, 26);
    localHeader.writeUInt16LE(0, 28);
    localParts.push(localHeader, nameBuffer, content);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(0, 8);
    centralHeader.writeUInt16LE(0, 10);
    centralHeader.writeUInt16LE(now.dosTime, 12);
    centralHeader.writeUInt16LE(now.dosDate, 14);
    centralHeader.writeUInt32LE(checksum, 16);
    centralHeader.writeUInt32LE(content.length, 20);
    centralHeader.writeUInt32LE(content.length, 24);
    centralHeader.writeUInt16LE(nameBuffer.length, 28);
    centralHeader.writeUInt16LE(0, 30);
    centralHeader.writeUInt16LE(0, 32);
    centralHeader.writeUInt16LE(0, 34);
    centralHeader.writeUInt16LE(0, 36);
    centralHeader.writeUInt32LE(0, 38);
    centralHeader.writeUInt32LE(offset, 42);
    centralParts.push(centralHeader, nameBuffer);

    offset += localHeader.length + nameBuffer.length + content.length;
  });

  const centralDirectory = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);

  return Buffer.concat([...localParts, centralDirectory, end]);
}

function buildCardMaps() {
  const config = loadJinangConfig();
  return {
    market: new Map(normalizeArray(config.market).map((card) => [card.id, card])),
    tech: new Map(normalizeArray(config.tech).map((card) => [card.id, card]))
  };
}

function computeMatchStrength(settlement) {
  const effect = parseJson(settlement?.effect_applied, {});
  const value = Number(effect?.match_strength ?? settlement?.match_strength ?? 0);
  return Number.isFinite(value) ? value : 0;
}

async function loadRound1MemberSubmissions(teamId) {
  const rows = await runSql(`
    SELECT member_id, grid_id, architecture, vp_draft, submitted_at
    FROM member_submissions
    WHERE team_id = ${sqlQuote(teamId)}
    ORDER BY submitted_at ASC;
  `);
  return new Map(rows.map((row) => [row.member_id, row]));
}

async function loadJinangSettlements(teamId) {
  const rows = await runSql(`
    SELECT member_id, jinang_id, jinang_type, matched, match_reason, effect_applied
    FROM jinang_settlements
    WHERE team_id = ${sqlQuote(teamId)};
  `);
  const map = new Map();
  rows.forEach((row) => {
    if (!map.has(row.member_id)) map.set(row.member_id, []);
    map.get(row.member_id).push(row);
  });
  return map;
}

async function loadRound2Raw(teamId) {
  const [
    assignmentRows,
    interviewRows,
    selectionRows,
    radarRows,
    resultRows,
    submissionRows
  ] = await Promise.all([
    runSql(`
      SELECT assignments_json, updated_at
      FROM round2_dimension_assignments
      WHERE team_id = ${sqlQuote(teamId)}
      LIMIT 1;
    `),
    runSql(`
      SELECT session_id, member_id, member_dims_json, personas_json, history_json, result_json, round_no, is_complete, created_at, updated_at
      FROM round2_interview_sessions
      WHERE team_id = ${sqlQuote(teamId)}
      ORDER BY created_at ASC, updated_at ASC;
    `),
    runSql(`
      SELECT member_id, selections_json, updated_at
      FROM round2_member_selections
      WHERE team_id = ${sqlQuote(teamId)}
      ORDER BY updated_at ASC;
    `),
    runSql(`
      SELECT session_id, radar_json, tags_json, evi, updated_at
      FROM fg_team_radar
      WHERE team_id = ${sqlQuote(teamId)}
      ORDER BY updated_at DESC
      LIMIT 1;
    `),
    runSql(`
      SELECT session_id, result_json, units, profit, computed_at
      FROM round2_results
      WHERE team_id = ${sqlQuote(teamId)}
      ORDER BY computed_at DESC
      LIMIT 1;
    `),
    runSql(`
      SELECT session_id, price, selections_json, cards_json, card_count, dcogs, risk_total, submitted_at
      FROM round2_submissions
      WHERE team_id = ${sqlQuote(teamId)}
      ORDER BY submitted_at DESC
      LIMIT 1;
    `)
  ]);

  return {
    assignments: parseJson(assignmentRows[0]?.assignments_json, []),
    interviews: interviewRows,
    memberSelections: selectionRows,
    radar: radarRows[0] || null,
    result: resultRows[0] || null,
    submission: submissionRows[0] || null
  };
}

function buildRound2Json(rawRound2) {
  if (!rawRound2?.submission && !rawRound2?.result && !normalizeArray(rawRound2?.interviews).length) {
    return null;
  }

  const interviewSessions = normalizeArray(rawRound2.interviews).map((row) => {
    const result = parseJson(row.result_json, {});
    const personas = normalizeArray(parseJson(row.personas_json, []));
    const history = normalizeArray(parseJson(row.history_json, []));
    return {
      sessionId: row.session_id,
      memberId: row.member_id,
      createdAt: normalizeTimestamp(row.created_at),
      updatedAt: normalizeTimestamp(row.updated_at),
      roundNo: Number(row.round_no || 0),
      isComplete: row.is_complete === true || row.is_complete === "t",
      personas,
      messages: history.map((message) => ({
        role: message.role || message.speaker || "",
        content: message.content || message.text || "",
        timestamp: normalizeTimestamp(message.timestamp || message.ts || row.updated_at)
      })),
      radar_scores: result.radar || result.radar_scores || {},
      tags: normalizeArray(result.tags)
    };
  });

  const selections = normalizeArray(rawRound2.memberSelections).flatMap((row) => {
    const selected = normalizeArray(parseJson(row.selections_json, []));
    return selected.map((item) => ({
      cap_id: item.cap_id || item.id || item.card_id || "",
      tier: String(item.tier || item.level || "").toUpperCase(),
      dimension: item.dimension || item.dim || item.group || "",
      selectedBy: row.member_id
    }));
  });

  const submission = rawRound2.submission || {};
  const resultPayload = parseJson(rawRound2.result?.result_json, {});

  return {
    dimensionAssignment: normalizeArray(rawRound2.assignments).map((item) => ({
      memberId: item.memberId || item.member_id || "",
      dimensions: normalizeArray(item.dims || item.dimensions)
    })),
    interview: {
      sessions: interviewSessions
    },
    selections,
    calculations: {
      totalDCOGS: submission.dcogs == null ? null : Number(submission.dcogs),
      totalRisk: submission.risk_total == null ? null : Number(submission.risk_total),
      price: submission.price == null ? null : Number(submission.price),
      share: resultPayload.share == null ? null : Number(resultPayload.share),
      units: rawRound2.result?.units == null ? Number(resultPayload.units || 0) : Number(rawRound2.result.units),
      revenue: resultPayload.revenueNet == null ? Number(resultPayload.revenue || 0) : Number(resultPayload.revenueNet),
      profit: rawRound2.result?.profit == null ? Number(resultPayload.profit || 0) : Number(rawRound2.result.profit)
    },
    reflectionReport: String(resultPayload.reflectionReport || resultPayload.reflection_report || "").trim()
  };
}

async function buildExportJson(teamId) {
  const team = await getTeam(teamId);
  if (!team) return null;

  const [phase4Res, recapRes, submissionsByMember, settlementsByMember, rawRound2] = await Promise.all([
    TeamRoutes.phase4Data(teamId),
    Round2.recap({ teamId }),
    loadRound1MemberSubmissions(teamId),
    loadJinangSettlements(teamId),
    loadRound2Raw(teamId)
  ]);

  const phase4 = phase4Res?.body?.ok ? phase4Res.body : null;
  const recap = recapRes?.body?.ok ? recapRes.body : null;
  const sessions = await getTeamSessions(teamId);
  const latestSession = normalizeArray(sessions).slice(-1)[0] || null;
  const vpMessages = normalizeArray(latestSession?.messages)
    .map((message) => ({
      role: message.role === "assistant" ? "coach" : (message.role === "user" ? "student" : message.role),
      content: message.content || "",
      timestamp: normalizeTimestamp(message.timestamp)
    }))
    .sort((a, b) => a.timestamp.localeCompare(b.timestamp));

  const cardMaps = buildCardMaps();
  const members = normalizeArray(team.members).map((member) => {
    const submission = submissionsByMember.get(member.id);
    const settlements = normalizeArray(settlementsByMember.get(member.id));
    const marketSettlement = settlements.find((item) => item.jinang_type === "market") || null;
    const techSettlement = settlements.find((item) => item.jinang_type === "tech") || null;
    const marketCard = cardMaps.market.get(member.jinang_market_id);
    const techCard = cardMaps.tech.get(member.jinang_tech_id);
    return {
      memberId: member.id,
      memberName: member.member_name,
      jinang_market: marketCard ? {
        cardId: marketCard.id,
        name: marketCard.name,
        match_strength: computeMatchStrength(marketSettlement)
      } : null,
      jinang_tech: techCard ? {
        cardId: techCard.id,
        name: techCard.name,
        match_strength: computeMatchStrength(techSettlement)
      } : null,
      strategy: {
        grid: submission?.grid_id || "",
        architecture: submission?.architecture || "",
        vp_draft: submission?.vp_draft || ""
      }
    };
  });

  const scores = parseJson(team.final_vp_scores, {});
  const round2 = buildRound2Json(rawRound2);
  const confirmedFields = latestSession?.pmfScore?._confirmed_fields || null;
  const vpText = String(team.final_vp_text || phase4?.team?.final_vp_text || "").trim();

  return {
    exportedAt: new Date().toISOString(),
    team: {
      teamId: team.id,
      sessionId: rawRound2?.submission?.session_id || rawRound2?.result?.session_id || "default",
      teamSize: Number(team.team_size || members.length || 0),
      createdAt: normalizeTimestamp(team.created_at)
    },
    members,
    vpCoach: {
      messages: vpMessages,
      extractedFields: {
        WHO: confirmedFields?.who_raw || extractVpField(vpText, "WHO"),
        PAIN: confirmedFields?.pain_raw || extractVpField(vpText, "PAIN"),
        HOW: confirmedFields?.how_raw || extractVpField(vpText, "HOW")
      }
    },
    scoring: {
      vpScore: Number(phase4?.vp_scores?.VPscore ?? scores.VPscore ?? 0),
      C: Number(phase4?.vp_scores?.C ?? team.final_vp_c ?? scores.C ?? 0),
      G: Number(phase4?.vp_scores?.G ?? team.final_vp_g ?? scores.G ?? 0),
      E: Number(phase4?.vp_scores?.E ?? team.final_vp_e_adj ?? scores.E ?? 0),
      details: scores
    },
    results: {
      marginHeadroom: recap?.margin_headroom || phase4?.r1_result?.margin_headroom?.tier || "",
      marketSpaceTier: recap?.market_space_tier || phase4?.r1_result?.market_space?.tier || "",
      jinangFit: phase4?.jinang?.market_jinang?.name || "",
      target_gm: team.final_target_gm == null ? null : Number(team.final_target_gm)
    },
    round2
  };
}

function buildCsvFiles(exportData) {
  const teamOverview = buildCsv((exportData.members || []).map((member) => ({
    teamId: exportData.team.teamId,
    teamSize: exportData.team.teamSize,
    createdAt: exportData.team.createdAt,
    memberId: member.memberId,
    memberName: member.memberName,
    marketCard: member.jinang_market?.name || "",
    techCard: member.jinang_tech?.name || "",
    grid: member.strategy?.grid || "",
    architecture: member.strategy?.architecture || ""
  })));

  const vpCoachMessages = buildCsv((exportData.vpCoach?.messages || []).map((message, index) => ({
    seq: index + 1,
    role: message.role,
    timestamp: message.timestamp,
    content: message.content
  })));

  const scoringDetails = buildCsv([{
    teamId: exportData.team.teamId,
    vpScore: exportData.scoring?.vpScore,
    C: exportData.scoring?.C,
    G: exportData.scoring?.G,
    E: exportData.scoring?.E,
    details: exportData.scoring?.details
  }]);

  const round1Results = buildCsv([{
    teamId: exportData.team.teamId,
    marginHeadroom: exportData.results?.marginHeadroom,
    marketSpaceTier: exportData.results?.marketSpaceTier,
    jinangFit: exportData.results?.jinangFit,
    target_gm: exportData.results?.target_gm
  }]);

  const interviewMessages = buildCsv((exportData.round2?.interview?.sessions || []).flatMap((session) =>
    normalizeArray(session.messages).map((message, index) => ({
      sessionId: session.sessionId,
      memberId: session.memberId,
      seq: index + 1,
      role: message.role,
      timestamp: message.timestamp,
      content: message.content
    }))
  ));

  const rdSelections = buildCsv((exportData.round2?.selections || []).map((selection) => ({
    cap_id: selection.cap_id,
    tier: selection.tier,
    dimension: selection.dimension,
    selectedBy: selection.selectedBy
  })));

  const round2Results = buildCsv([{
    teamId: exportData.team.teamId,
    totalDCOGS: exportData.round2?.calculations?.totalDCOGS,
    totalRisk: exportData.round2?.calculations?.totalRisk,
    price: exportData.round2?.calculations?.price,
    share: exportData.round2?.calculations?.share,
    units: exportData.round2?.calculations?.units,
    revenue: exportData.round2?.calculations?.revenue,
    profit: exportData.round2?.calculations?.profit,
    reflectionReport: exportData.round2?.reflectionReport || ""
  }]);

  return [
    { name: "team_overview.csv", content: teamOverview },
    { name: "vp_coach_messages.csv", content: vpCoachMessages },
    { name: "scoring_details.csv", content: scoringDetails },
    { name: "round1_results.csv", content: round1Results },
    { name: "interview_messages.csv", content: interviewMessages || "sessionId,memberId,seq,role,timestamp,content\n" },
    { name: "rd_selections.csv", content: rdSelections || "cap_id,tier,dimension,selectedBy\n" },
    { name: "round2_results.csv", content: round2Results }
  ];
}

function isExportAuthorized(headers = {}) {
  const expected = String(process.env.TEST_EXPORT_KEY || "").trim();
  if (!expected) return false;
  return String(headers["x-test-export-key"] || "").trim() === expected;
}

async function exportTeamDataApi(query = {}, headers = {}) {
  try {
    if (!isExportAuthorized(headers)) {
      return makeResponse(403, { ok: false, error: "forbidden" });
    }

    const teamId = String(query.teamId || "").trim();
    const format = String(query.format || "json").trim().toLowerCase();
    if (!teamId) return makeResponse(400, { ok: false, error: "teamId required" });

    const exportData = await buildExportJson(teamId);
    if (!exportData) {
      return makeResponse(404, { ok: false, error: "team not found" });
    }

    if (format === "csv") {
      const files = buildCsvFiles(exportData);
      const filename = `team-export-${teamId}.zip`;
      return makeResponse(200, {
        ok: true,
        filename,
        contentType: "application/zip",
        buffer: buildZip(files)
      });
    }

    return makeResponse(200, { ok: true, data: exportData });
  } catch (e) {
    return makeResponse(500, { ok: false, error: e.message || "test export failed" });
  }
}

module.exports = {
  exportTeamDataApi
};
