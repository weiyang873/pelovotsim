const Engine = require("../../engine");
const { runSql, sqlQuote } = require("../db/pgSql");
const { createTeam, getTeam, updateTeamStatus } = require("../multiplayer/teamManager");
const { compressWtpMult } = require("../llm/rdCalculator");
const {
  ensureSchema: ensureRound2Schema,
  updateTeamRound2Status,
  updateMemberProgress
} = require("../multiplayer/round2State");

function makeResponse(status, body) {
  return { status, body };
}

function nowIso() {
  return new Date().toISOString();
}

function extractErrorMessage(err) {
  if (!err) return "skip to round2 failed";
  if (typeof err === "string") return err;
  if (err.message) return err.message;
  if (Array.isArray(err.errors) && err.errors.length) {
    return err.errors.map((item) => item?.message || String(item)).filter(Boolean).join("; ");
  }
  return String(err);
}

async function skipToRound2(options = {}) {
  try {
    const teamSize = Math.max(1, Math.min(6, Math.floor(Number(options.teamSize || options.team_size || 1))));
    const gridId = "ToB_Differentiation_Elder";
    const architecture = "Experience";
    const vpText = "养老院老板，护工不够老人出事赔不起，搞个能防摔倒的机器人";
    const vpScores = { C: 4, G: 3, E: 4 };
    const round1 = Engine.computeRound1V2(gridId, architecture, vpScores, 0);
    const compressedMult = compressWtpMult(round1.wtp_multiplier);

    const createdTeam = await createTeam(`R2 测试队 ${Date.now()}`, teamSize);
    const team = await getTeam(createdTeam.id);
    const member = Array.isArray(team?.members) ? team.members[0] : null;
    if (!team || !member) {
      throw new Error("test team bootstrap failed");
    }

    await runSql(`
      UPDATE teams
      SET final_grid_id = ${sqlQuote(gridId)},
          final_architecture = ${sqlQuote(architecture)},
          final_architecture_source = 'player_selected',
          final_vp_text = ${sqlQuote(vpText)},
          final_vp_scores = ${sqlQuote(JSON.stringify(vpScores))},
          final_sam = ${Number(round1.SAM_billion)},
          final_wtp_adj = ${Number(round1.WTPadj)},
          final_wtp_ref = ${Number(round1.WTPref)},
          final_vp_c = ${Number(round1.C)},
          final_vp_g = ${Number(round1.G)},
          final_vp_e_raw = ${Number(round1.E_raw)},
          final_vp_e_adj = ${Number(round1.Eadj)},
          final_rho_c = ${Number(round1.rho_C)},
          final_wtp_multiplier = ${Number(round1.wtp_multiplier)}
      WHERE id = ${sqlQuote(team.id)};
    `);

    await updateTeamStatus(team.id, "frozen");
    await ensureRound2Schema();
    const enteredAt = nowIso();
    await updateTeamRound2Status(team.id, "R2_INTERVIEWING", enteredAt);
    for (const teamMember of team.members || []) {
      await updateMemberProgress(team.id, teamMember.id, {
        interview_status: "in_progress",
        interview_rounds: 0,
        card_status: "not_started",
        cards_selected: 0,
        current_step: "interviewing",
        forced_by_teacher: false,
        last_activity_at: enteredAt
      });
    }

    return makeResponse(200, {
      ok: true,
      team_id: team.id,
      member_id: member.id,
      member_links: (team.members || []).map((teamMember) => ({
        member_id: teamMember.id,
        member_name: teamMember.member_name,
        member_index: teamMember.member_index
      })),
      session_id: "default",
      redirect_url: `/multiplayer/round2?teamId=${encodeURIComponent(team.id)}&memberId=${encodeURIComponent(member.id)}&session_id=default`,
      round1_seed: {
        grid: gridId,
        arch: architecture,
        vp_text: vpText,
        vp_C: vpScores.C,
        vp_G: vpScores.G,
        vp_E: vpScores.E,
        wtp_multiplier: Number(round1.wtp_multiplier),
        compressed_mult: compressedMult
      }
    });
  } catch (e) {
    return makeResponse(400, { ok: false, error: extractErrorMessage(e) });
  }
}

module.exports = {
  skipToRound2
};
