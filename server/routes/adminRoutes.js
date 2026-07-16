const { runSql, sqlQuote } = require("../db/pgSql");
const { createTeam, getTeam, setTeamLeader } = require("../multiplayer/teamManager");
const {
  PRICE_SCALE,
  MONEY_SCALE_CONTRACT,
  addStoredRound1MoneyViews
} = require("../multiplayer/moneyScale");
const { flushAll, readLogEntries } = require("../llm/llm_logger");
const TeacherDebrief = require("./teacherDebrief");

function makeResponse(status, body) {
  return { status, body };
}

async function verifyAdmin(body) {
  const code = String(body?.code || "").trim();
  const adminCode = process.env.ADMIN_CODE || "";
  if (!adminCode) return makeResponse(500, { ok: false, error: "ADMIN_CODE not configured" });
  if (code !== adminCode) return makeResponse(403, { ok: false, error: "密码错误" });
  return makeResponse(200, { ok: true });
}

async function importStudents(body) {
  try {
    const rows = body?.students;
    if (!Array.isArray(rows) || rows.length === 0) {
      return makeResponse(400, { ok: false, error: "students array required" });
    }

    for (let i = 0; i < rows.length; i += 1) {
      const row = rows[i] || {};
      if (!row.student_id || !row.name || !row.group) {
        return makeResponse(400, { ok: false, error: `第 ${i + 1} 行缺少 student_id / name / group` });
      }
    }

    const idSet = new Set();
    for (const row of rows) {
      const sid = String(row.student_id).trim().toUpperCase();
      if (idSet.has(sid)) {
        return makeResponse(400, { ok: false, error: `学号重复: ${sid}` });
      }
      idSet.add(sid);
    }

    const groups = {};
    for (const row of rows) {
      const groupLabel = String(row.group).trim();
      if (!groups[groupLabel]) groups[groupLabel] = [];
      groups[groupLabel].push({
        student_id: String(row.student_id).trim(),
        name: String(row.name).trim(),
        is_leader: Boolean(row.is_leader)
      });
    }

    await runSql("DELETE FROM students;");

    const results = [];
    for (const [groupLabel, members] of Object.entries(groups)) {
      const teamName = `第${groupLabel}组`;
      const team = await createTeam(teamName, members.length);
      const fullTeam = await getTeam(team.id);
      const teamMembers = Array.isArray(fullTeam?.members) ? fullTeam.members : [];

      for (let i = 0; i < members.length; i += 1) {
        const student = members[i];
        const member = teamMembers[i];
        if (!member) continue;

        await runSql(`
          UPDATE team_members
          SET member_name = ${sqlQuote(student.name)}
          WHERE id = ${sqlQuote(member.id)};
        `);

        await runSql(`
          INSERT INTO students (student_id, student_name, group_label, team_id, member_id)
          VALUES (
            ${sqlQuote(student.student_id)},
            ${sqlQuote(student.name)},
            ${sqlQuote(groupLabel)},
            ${sqlQuote(team.id)},
            ${sqlQuote(member.id)}
          )
          ON CONFLICT (student_id) DO UPDATE SET
            student_name = EXCLUDED.student_name,
            group_label = EXCLUDED.group_label,
            team_id = EXCLUDED.team_id,
            member_id = EXCLUDED.member_id;
        `);
      }

      const preferredLeaderIndex = members.findIndex((member) => member.is_leader);
      const leaderIndex = preferredLeaderIndex >= 0 ? preferredLeaderIndex : 0;
      const leaderMember = teamMembers[leaderIndex] || teamMembers[0] || null;
      if (leaderMember?.id) {
        await setTeamLeader(team.id, leaderMember.id);
      }

      results.push({
        group: groupLabel,
        team_id: team.id,
        team_name: teamName,
        size: members.length,
        students: members.map((member) => member.student_id),
        leader_student_id: members[leaderIndex]?.student_id || "",
        leader_name: members[leaderIndex]?.name || ""
      });
    }

    return makeResponse(200, {
      ok: true,
      imported_teams: results.length,
      imported_students: rows.length,
      teams: results
    });
  } catch (e) {
    return makeResponse(400, { ok: false, error: e.message });
  }
}

async function listTeams() {
  try {
    const teams = await runSql(`
      SELECT t.id, t.team_name, t.team_size, t.status, t.created_at,
        t.final_grid_id, t.final_architecture, t.final_sam, t.final_wtp_adj, t.final_wtp_ref,
        (COALESCE(t.lovot_image, '') <> '') AS has_lovot_image
      FROM teams t
      ORDER BY t.created_at ASC;
    `);

    const result = [];
    for (const team of teams) {
      const members = await runSql(`
        SELECT tm.id, tm.member_name, tm.member_index,
          s.student_id, s.group_label
        FROM team_members tm
        LEFT JOIN students s ON s.member_id = tm.id
        WHERE tm.team_id = ${sqlQuote(team.id)}
        ORDER BY tm.member_index ASC;
      `);

      const submittedCount = await runSql(`
        SELECT COUNT(*) AS c FROM member_submissions
        WHERE team_id = ${sqlQuote(team.id)};
      `);

      result.push({
        ...addStoredRound1MoneyViews(team),
        hasProductImage: Boolean(team.has_lovot_image),
        members,
        submitted_count: Number(submittedCount[0]?.c || 0)
      });
    }

    return makeResponse(200, { ok: true, teams: result });
  } catch (e) {
    return makeResponse(500, { ok: false, error: e.message });
  }
}

async function exportResults() {
  try {
    const teamRows = await runSql("SELECT * FROM teams ORDER BY created_at ASC;");
    const teams = teamRows.map((team) => addStoredRound1MoneyViews(team));
    const students = await runSql("SELECT * FROM students ORDER BY group_label, student_id;");
    const submissions = await runSql("SELECT * FROM member_submissions ORDER BY team_id, submitted_at;");
    const settlements = await runSql("SELECT * FROM jinang_settlements ORDER BY team_id;");
    const debriefOut = await TeacherDebrief.debriefDataApi({ session_id: "default" });
    const debriefSnapshot = debriefOut?.body?.ok ? debriefOut.body : null;

    return makeResponse(200, {
      ok: true,
      exported_at: new Date().toISOString(),
      money_scale: PRICE_SCALE,
      money_scale_contract: MONEY_SCALE_CONTRACT,
      teams,
      students,
      submissions,
      settlements,
      debrief_snapshot: debriefSnapshot
    });
  } catch (e) {
    return makeResponse(500, { ok: false, error: e.message });
  }
}

async function flushLlmLogs() {
  try {
    flushAll();
    return makeResponse(200, { ok: true });
  } catch (e) {
    return makeResponse(500, { ok: false, error: e.message });
  }
}

async function readLlmLogs(query) {
  try {
    const date = String(query?.date || new Date().toISOString().slice(0, 10)).trim();
    const entries = readLogEntries(date);
    return makeResponse(200, { ok: true, count: entries.length, entries });
  } catch (e) {
    return makeResponse(500, { ok: false, error: e.message });
  }
}

async function readLlmLogsByTeam(teamId, query) {
  try {
    const date = String(query?.date || new Date().toISOString().slice(0, 10)).trim();
    const entries = readLogEntries(date).filter((entry) => entry.teamId === String(teamId || ""));
    return makeResponse(200, { ok: true, count: entries.length, entries });
  } catch (e) {
    return makeResponse(500, { ok: false, error: e.message });
  }
}

async function readLlmLogsByCaller(caller, query) {
  try {
    const date = String(query?.date || new Date().toISOString().slice(0, 10)).trim();
    const entries = readLogEntries(date).filter((entry) => entry.caller === String(caller || ""));
    return makeResponse(200, { ok: true, count: entries.length, entries });
  } catch (e) {
    return makeResponse(500, { ok: false, error: e.message });
  }
}

module.exports = {
  verifyAdmin,
  importStudents,
  listTeams,
  exportResults,
  flushLlmLogs,
  readLlmLogs,
  readLlmLogsByTeam,
  readLlmLogsByCaller
};
