const assert = require("node:assert/strict");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const ROUND1_GRID_LABEL = "ToB·差异化·老人";

function makePersona(name, id) {
  return {
    id,
    name,
    age: 48,
    title: "运营总监",
    occupation: "运营总监",
    org_type: "集团化养老机构",
    org_scale: "3家分院，共360张床位",
    living_situation: "集团化养老机构，3家分院，共360张床位",
    personality: "务实",
    daily_routine: "每天巡视各分院，处理运营问题",
    tech_comfort: "关注投入产出比",
    interview_style: "务实直接",
    desires: ["提高护理效率"],
    pains: ["护工流失率高"],
    hidden_pain: "集团领导对事故很敏感",
    contradictions: ["想引入新技术但怕老人不接受"],
    pressures: ["夜间值班覆盖不了所有楼层"],
    constraints: {
      who_raw: "养老机构运营负责人",
      gridLabel: ROUND1_GRID_LABEL
    }
  };
}

function createRound2RoutesLoader({ team, generatePersonaImpl }) {
  const dbState = {
    assignmentsByTeam: new Map(),
    sessionsById: new Map(),
    memberProgress: new Map(),
    teamStatusByTeam: new Map()
  };

  const encode = (value) => `__Q${Buffer.from(JSON.stringify(value)).toString("base64")}Q__`;
  const decodeToken = (token) => {
    const raw = String(token || "").trim().replace(/^__Q/, "").replace(/Q__$/, "");
    return JSON.parse(Buffer.from(raw, "base64").toString("utf8"));
  };
  const decodeMarkers = (sql) => Array.from(String(sql).matchAll(/__Q([A-Za-z0-9+/=]+)Q__/g)).map((m) => {
    return JSON.parse(Buffer.from(m[1], "base64").toString("utf8"));
  });
  const parseValues = (sql) => {
    const match = String(sql).match(/VALUES\s*\(([^]*?)\)\s*ON CONFLICT/i);
    return match ? match[1].split(",").map((item) => item.trim()) : [];
  };

  const paths = {
    pgSql: require.resolve(path.join(ROOT, "server/db/pgSql.js")),
    teamRoutes: require.resolve(path.join(ROOT, "server/routes/teamRoutes.js")),
    deepseek: require.resolve(path.join(ROOT, "server/llm/deepseekClient.js")),
    logger: require.resolve(path.join(ROOT, "server/llm/llm_logger.js")),
    personaGen: require.resolve(path.join(ROOT, "server/llm/personaGenerator.js")),
    sessions: require.resolve(path.join(ROOT, "server/llm/sessions.js")),
    teamManager: require.resolve(path.join(ROOT, "server/multiplayer/teamManager.js")),
    computationLog: require.resolve(path.join(ROOT, "server/multiplayer/computationLog.js")),
    rdCalculator: require.resolve(path.join(ROOT, "server/llm/rdCalculator.js")),
    rdTeamAdapter: require.resolve(path.join(ROOT, "server/multiplayer/rdTeamAdapter.js")),
    marketInfo: require.resolve(path.join(ROOT, "server/multiplayer/marketInfo.js")),
    round2State: require.resolve(path.join(ROOT, "server/multiplayer/round2State.js")),
    round2: require.resolve(path.join(ROOT, "server/routes/round2Routes.js"))
  };

  const stubs = {
    [paths.pgSql]: {
      sqlQuote: encode,
      runSql: async (sql) => {
        const text = String(sql || "");
        if (/CREATE TABLE|ALTER TABLE/i.test(text)) return [];

        if (/INSERT INTO round2_dimension_assignments/i.test(text)) {
          const values = parseValues(text);
          dbState.assignmentsByTeam.set(decodeToken(values[0]), {
            team_id: decodeToken(values[0]),
            assignments_json: decodeToken(values[1]),
            updated_at: decodeToken(values[2])
          });
          return [];
        }

        if (/SELECT assignments_json\s+FROM round2_dimension_assignments/i.test(text)) {
          const [teamId] = decodeMarkers(text);
          const row = dbState.assignmentsByTeam.get(teamId);
          return row ? [{ assignments_json: row.assignments_json }] : [];
        }

        if (/INSERT INTO round2_interview_sessions/i.test(text)) {
          const values = parseValues(text);
          const row = {
            session_id: decodeToken(values[0]),
            team_id: decodeToken(values[1]),
            member_id: decodeToken(values[2]),
            member_dims_json: decodeToken(values[3]),
            personas_json: decodeToken(values[4]),
            history_json: decodeToken(values[5]),
            result_json: decodeToken(values[6]),
            persona_locked_at: decodeToken(values[7]),
            round_no: Number(values[8]),
            is_complete: values[9] === "TRUE",
            created_at: decodeToken(values[10]),
            updated_at: decodeToken(values[11])
          };
          dbState.sessionsById.set(row.session_id, row);
          return [];
        }

        if (/SELECT \*\s+FROM round2_interview_sessions/i.test(text)) {
          const [sessionId] = decodeMarkers(text);
          const row = dbState.sessionsById.get(sessionId);
          return row ? [row] : [];
        }

        if (/SELECT session_id\s+FROM round2_interview_sessions/i.test(text)) {
          const [teamId, memberId] = decodeMarkers(text);
          return Array.from(dbState.sessionsById.values())
            .filter((row) => row.team_id === teamId && row.member_id === memberId)
            .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)) || String(a.updated_at).localeCompare(String(b.updated_at)))
            .map((row) => ({ session_id: row.session_id }));
        }

        throw new Error(`Unhandled SQL in smoke test:\n${text}`);
      }
    },
    [paths.teamRoutes]: {},
    [paths.deepseek]: {
      chatCompletion: async () => {
        throw new Error("chatCompletion should not run in smoke test");
      }
    },
    [paths.logger]: {
      withLlmLogging: async (_meta, fn) => fn()
    },
    [paths.personaGen]: {
      generatePersona: generatePersonaImpl
    },
    [paths.sessions]: {
      getTeamSessions: async (teamId) => [{
        sessionId: `phase3-${teamId}`,
        updatedAt: "2026-04-09T10:00:00.000Z",
        pmfScore: { _confirmed_fields: { who_raw: "养老机构运营负责人" } }
      }]
    },
    [paths.teamManager]: {
      getTeam: async (teamId) => (teamId === team.id ? team : null),
      setTeamLeader: async () => null
    },
    [paths.computationLog]: {
      scheduleStages: async () => null
    },
    [paths.rdCalculator]: {
      calculate: () => ({}),
      validateSelections: () => [],
      computeSoftPenalties: () => ({}),
      getCapabilityParams: () => ({})
    },
    [paths.rdTeamAdapter]: {
      assignDimensions: (memberCount) => Array.from({ length: memberCount }, (_, idx) => {
        return idx % 2 === 0 ? ["interaction", "safety"] : ["motion", "ops"];
      }),
      mergeTeamSelections: () => []
    },
    [paths.marketInfo]: {
      getRound2MarketInfo: () => ({})
    },
    [paths.round2State]: {
      ensureSchema: async () => null,
      updateTeamRound2Status: async (teamId, status) => {
        dbState.teamStatusByTeam.set(teamId, status);
      },
      updateMemberProgress: async (teamId, memberId, payload) => {
        dbState.memberProgress.set(`${teamId}:${memberId}`, payload);
      },
      getTeamRound2State: async (teamId) => ({
        members: (team.members || []).map((member) => {
          const progress = dbState.memberProgress.get(`${teamId}:${member.id}`) || {};
          return {
            id: member.id,
            interviewStatus: progress.interview_status || "not_started"
          };
        })
      })
    }
  };

  for (const modPath of [paths.round2, ...Object.keys(stubs)]) {
    delete require.cache[modPath];
  }
  for (const [modPath, exports] of Object.entries(stubs)) {
    require.cache[modPath] = { id: modPath, filename: modPath, loaded: true, exports };
  }

  return require(paths.round2);
}

async function runDistinctScenario() {
  const team = {
    id: "team-distinct",
    final_grid_id: "ToB_Differentiation_Elder",
    final_architecture: "experience",
    members: [
      { id: "m1", member_name: "成员1", member_index: 1 },
      { id: "m2", member_name: "成员2", member_index: 2 }
    ]
  };
  const round2Routes = createRound2RoutesLoader({
    team,
    generatePersonaImpl: async (_unused, options) => {
      const usedNames = (options.previousPersonas || []).map((item) => item.name);
      return usedNames.includes("陈晓薇") ? makePersona("李阿姨", "p-2") : makePersona("陈晓薇", "p-1");
    }
  });

  const first = await round2Routes.interviewStart({ teamId: team.id, memberId: "m1" });
  const second = await round2Routes.interviewStart({ teamId: team.id, memberId: "m2" });
  assert.equal(first.status, 200);
  assert.equal(second.status, 200);
  assert.equal(first.body.persona.name, "陈晓薇");
  assert.equal(second.body.persona.name, "李阿姨");
  assert.notEqual(first.body.persona.name, second.body.persona.name);
  return {
    first: first.body.persona.name,
    second: second.body.persona.name
  };
}

async function runSingleScenario() {
  const team = {
    id: "team-single",
    final_grid_id: "ToB_Differentiation_Elder",
    final_architecture: "experience",
    members: [
      { id: "solo", member_name: "单人成员", member_index: 1 }
    ]
  };
  const round2Routes = createRound2RoutesLoader({
    team,
    generatePersonaImpl: async () => makePersona("陈晓薇", "solo-1")
  });

  const result = await round2Routes.interviewStart({ teamId: team.id, memberId: "solo" });
  assert.equal(result.status, 200);
  assert.equal(result.body.persona.name, "陈晓薇");
  return {
    persona: result.body.persona.name
  };
}

async function runSkipScenario() {
  const team = {
    id: "team-skip",
    final_grid_id: "ToB_Differentiation_Elder",
    final_architecture: "experience",
    members: [
      { id: "m1", member_name: "成员1", member_index: 1 },
      { id: "m2", member_name: "成员2", member_index: 2 }
    ]
  };
  let callCount = 0;
  const round2Routes = createRound2RoutesLoader({
    team,
    generatePersonaImpl: async (_unused, options) => {
      callCount += 1;
      const hasPrevious = (options.previousPersonas || []).some((item) => item.name === "陈晓薇");
      if (!hasPrevious) return makePersona("陈晓薇", `seed-${callCount}`);
      return makePersona("陈晓薇", `dup-${callCount}`);
    }
  });

  const first = await round2Routes.interviewStart({ teamId: team.id, memberId: "m1" });
  const second = await round2Routes.interviewStart({ teamId: team.id, memberId: "m2" });
  assert.equal(first.status, 200);
  assert.equal(second.status, 200);
  assert.equal(first.body.persona.name, "陈晓薇");
  assert.equal(second.body.persona.name, "陈晓薇");
  assert.equal(callCount, 7);
  return {
    first: first.body.persona.name,
    second: second.body.persona.name,
    totalGenerateCalls: callCount
  };
}

async function main() {
  const distinct = await runDistinctScenario();
  const single = await runSingleScenario();
  const skip = await runSkipScenario();

  console.log("Round 2 cross-member persona dedupe smoke passed.");
  console.log(JSON.stringify({ distinct, single, skip }, null, 2));
}

main().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exit(1);
});
