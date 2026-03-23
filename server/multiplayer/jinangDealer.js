const fs = require("node:fs");
const path = require("node:path");
const { runSql, sqlQuote } = require("../db/pgSql");

const ROOT = path.join(__dirname, "..", "..");
const JINANG_PATH = path.join(ROOT, "game_config_v0.1", "jinang_cards_v2.json");

function shuffle(arr) {
  const copy = arr.slice();
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = copy[i];
    copy[i] = copy[j];
    copy[j] = tmp;
  }
  return copy;
}

function loadJinangConfig() {
  const raw = fs.readFileSync(JINANG_PATH, "utf8");
  return JSON.parse(raw);
}

async function dealJinang(teamId) {
  const tid = String(teamId || "").trim();
  if (!tid) throw new Error("teamId required");

  const teamRows = await runSql(`
    SELECT id, team_size
    FROM teams
    WHERE id = ${sqlQuote(tid)}
    LIMIT 1;
  `);
  const team = teamRows[0];
  if (!team) throw new Error(`team not found: ${tid}`);

  const members = await runSql(`
    SELECT id, member_index, jinang_market_id, jinang_tech_id
    FROM team_members
    WHERE team_id = ${sqlQuote(tid)}
    ORDER BY member_index ASC;
  `);

  if (members.length === 0) {
    return { team_id: tid, dealt: false, reason: "no_members", assignments: [] };
  }

  if (members.length < Number(team.team_size || 0)) {
    return { team_id: tid, dealt: false, reason: "team_not_full", assignments: [] };
  }

  const config = loadJinangConfig();
  const marketAll = (config.market || []).map((c) => c.id);
  const techAll = (config.tech || []).map((c) => c.id);

  if (members.length > marketAll.length || members.length > techAll.length) {
    throw new Error("jinang card pool is smaller than team size");
  }

  const usedMarket = new Set(members.map((m) => m.jinang_market_id).filter(Boolean));
  const usedTech = new Set(members.map((m) => m.jinang_tech_id).filter(Boolean));
  const unassigned = members.filter((m) => !m.jinang_market_id || !m.jinang_tech_id);

  if (unassigned.length === 0) {
    return {
      team_id: tid,
      dealt: true,
      reason: "already_dealt",
      assignments: members.map((m) => ({
        member_id: m.id,
        jinang_market_id: m.jinang_market_id,
        jinang_tech_id: m.jinang_tech_id
      }))
    };
  }

  const marketPool = shuffle(marketAll.filter((id) => !usedMarket.has(id)));
  const techPool = shuffle(techAll.filter((id) => !usedTech.has(id)));

  if (marketPool.length < unassigned.length || techPool.length < unassigned.length) {
    throw new Error("not enough remaining jinang cards for assignment");
  }

  const assignments = [];
  for (let i = 0; i < unassigned.length; i += 1) {
    const member = unassigned[i];
    const marketId = marketPool[i];
    const techId = techPool[i];
    await runSql(`
      UPDATE team_members
      SET jinang_market_id = ${sqlQuote(marketId)},
          jinang_tech_id = ${sqlQuote(techId)}
      WHERE id = ${sqlQuote(member.id)};
    `);
    assignments.push({
      member_id: member.id,
      jinang_market_id: marketId,
      jinang_tech_id: techId
    });
  }

  return { team_id: tid, dealt: true, reason: "assigned", assignments };
}

function pickSafeFields(card) {
  if (!card) return null;
  return {
    id: card.id,
    name: card.name,
    desc_for_player: card.desc_for_player,
    hint_keyword: card.hint_keyword
  };
}

async function getMemberJinang(memberId) {
  const mid = String(memberId || "").trim();
  if (!mid) throw new Error("memberId required");

  const rows = await runSql(`
    SELECT id, team_id, member_name, jinang_market_id, jinang_tech_id
    FROM team_members
    WHERE id = ${sqlQuote(mid)}
    LIMIT 1;
  `);
  const member = rows[0];
  if (!member) throw new Error(`member not found: ${mid}`);

  const config = loadJinangConfig();
  const marketCard = (config.market || []).find((c) => c.id === member.jinang_market_id);
  const techCard = (config.tech || []).find((c) => c.id === member.jinang_tech_id);

  return {
    member_id: member.id,
    team_id: member.team_id,
    member_name: member.member_name,
    market: pickSafeFields(marketCard),
    tech: pickSafeFields(techCard)
  };
}

module.exports = {
  loadJinangConfig,
  dealJinang,
  getMemberJinang
};
