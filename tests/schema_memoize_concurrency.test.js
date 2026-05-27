const test = require("node:test");
const assert = require("node:assert/strict");

const PG_SQL_MODULE_PATH = require.resolve("../server/db/pgSql");

const MODULE_SPECS = [
  {
    name: "computationLog.ensureSchema",
    modulePath: "../server/multiplayer/computationLog",
    extraModulePaths: []
  },
  {
    name: "teamManager.ensureSchema",
    modulePath: "../server/multiplayer/teamManager",
    extraModulePaths: [
      "../server/multiplayer/computationLog",
      "../server/multiplayer/vpIterationStore"
    ]
  },
  {
    name: "vpIterationStore.ensureSchema",
    modulePath: "../server/multiplayer/vpIterationStore",
    extraModulePaths: []
  },
  {
    name: "round2State.ensureSchema",
    modulePath: "../server/multiplayer/round2State",
    extraModulePaths: []
  },
  {
    name: "sessions.ensureSchema",
    modulePath: "../server/llm/sessions",
    extraModulePaths: []
  },
  {
    name: "marketingSessions.ensureSchema",
    modulePath: "../server/llm/marketingSessions",
    extraModulePaths: []
  },
  {
    name: "round2Routes.ensureSchema",
    modulePath: "../server/routes/round2Routes",
    extraModulePaths: [
      "../server/multiplayer/round2State"
    ]
  },
  {
    name: "teacherDebrief.ensureSchema",
    modulePath: "../server/routes/teacherDebrief",
    extraModulePaths: [
      "../server/routes/round2Routes",
      "../server/multiplayer/round2State"
    ]
  }
];

function countDdlStatements(sql) {
  const matches = String(sql || "").match(
    /\b(?:CREATE TABLE|ALTER TABLE|CREATE INDEX|DROP TABLE|DROP INDEX|DROP COLUMN|DROP SCHEMA|CREATE SCHEMA)\b/gi
  );
  return matches ? matches.length : 0;
}

function sqlQuote(value) {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "NULL";
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
  return `'${String(value).replace(/'/g, "''")}'`;
}

function loadModuleWithMockedPgSql(spec, runSqlImpl) {
  const modulePaths = [spec.modulePath, ...(spec.extraModulePaths || [])].map((item) => require.resolve(item));
  const originalEntries = new Map();

  originalEntries.set(PG_SQL_MODULE_PATH, require.cache[PG_SQL_MODULE_PATH]);
  for (const modulePath of modulePaths) {
    originalEntries.set(modulePath, require.cache[modulePath]);
    delete require.cache[modulePath];
  }

  require.cache[PG_SQL_MODULE_PATH] = {
    id: PG_SQL_MODULE_PATH,
    filename: PG_SQL_MODULE_PATH,
    loaded: true,
    exports: {
      runSql: runSqlImpl,
      runTransaction: async () => {
        throw new Error("runTransaction should not be called in schema memoize tests");
      },
      shutdown: async () => {},
      sqlQuote
    }
  };

  const loadedModule = require(spec.modulePath);
  return {
    loadedModule,
    restore() {
      for (const modulePath of modulePaths) {
        delete require.cache[modulePath];
        const original = originalEntries.get(modulePath);
        if (original) require.cache[modulePath] = original;
      }
      const originalPgSql = originalEntries.get(PG_SQL_MODULE_PATH);
      if (originalPgSql) require.cache[PG_SQL_MODULE_PATH] = originalPgSql;
      else delete require.cache[PG_SQL_MODULE_PATH];
    }
  };
}

async function measureSingleRunDdlCount(spec) {
  let ddlCount = 0;
  const harness = loadModuleWithMockedPgSql(spec, async (sql) => {
    ddlCount += countDdlStatements(sql);
    return [];
  });
  try {
    await harness.loadedModule.ensureSchema();
    return ddlCount;
  } finally {
    harness.restore();
  }
}

async function measureConcurrentRunDdlCount(spec, concurrency = 50) {
  let ddlCount = 0;
  const harness = loadModuleWithMockedPgSql(spec, async (sql) => {
    ddlCount += countDdlStatements(sql);
    await new Promise((resolve) => setImmediate(resolve));
    return [];
  });
  try {
    await Promise.all(Array.from({ length: concurrency }, () => harness.loadedModule.ensureSchema()));
    return ddlCount;
  } finally {
    harness.restore();
  }
}

for (const spec of MODULE_SPECS) {
  test(`${spec.name} runs DDL only once under concurrency`, { concurrency: false }, async () => {
    const expectedDdlCount = await measureSingleRunDdlCount(spec);
    const concurrentDdlCount = await measureConcurrentRunDdlCount(spec, 50);

    assert.ok(expectedDdlCount > 0, `${spec.name} should execute at least one DDL statement`);
    assert.equal(
      concurrentDdlCount,
      expectedDdlCount,
      `${spec.name} should execute exactly one round of DDL under concurrency`
    );
  });

  test(`${spec.name} resets cached promise after failure`, { concurrency: false }, async () => {
    let callCount = 0;
    let ddlCount = 0;
    const harness = loadModuleWithMockedPgSql(spec, async (sql) => {
      callCount += 1;
      ddlCount += countDdlStatements(sql);
      if (callCount === 1) {
        throw new Error("boom");
      }
      return [];
    });

    try {
      await assert.rejects(harness.loadedModule.ensureSchema(), /boom/);
      const ddlCountAfterFailure = ddlCount;
      assert.ok(ddlCountAfterFailure > 0, `${spec.name} should attempt DDL before failing`);

      await assert.doesNotReject(harness.loadedModule.ensureSchema());
      const ddlCountAfterSuccess = ddlCount;
      assert.ok(
        ddlCountAfterSuccess > ddlCountAfterFailure,
        `${spec.name} should retry DDL after a failed initialization`
      );

      await assert.doesNotReject(harness.loadedModule.ensureSchema());
      assert.equal(
        ddlCount,
        ddlCountAfterSuccess,
        `${spec.name} should memoize the successful promise after retry`
      );
    } finally {
      harness.restore();
    }
  });
}
