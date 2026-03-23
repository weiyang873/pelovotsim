const SimDB = (() => {
  const DB_NAME = "emba_ai_sim_db";
  const DB_VERSION = 1;
  const STORE_RUNS = "team_runs";
  const STORE_ITER = "iteration_events";

  function open() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = (event) => {
        const db = event.target.result;
        if (!db.objectStoreNames.contains(STORE_RUNS)) {
          const runs = db.createObjectStore(STORE_RUNS, { keyPath: "id" });
          runs.createIndex("by_team", "teamId", { unique: false });
          runs.createIndex("by_created", "createdAt", { unique: false });
        }
        if (!db.objectStoreNames.contains(STORE_ITER)) {
          const iter = db.createObjectStore(STORE_ITER, { keyPath: "id" });
          iter.createIndex("by_team", "teamId", { unique: false });
          iter.createIndex("by_created", "createdAt", { unique: false });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  function tx(db, storeName, mode = "readonly") {
    return db.transaction(storeName, mode).objectStore(storeName);
  }

  function put(store, record) {
    return new Promise((resolve, reject) => {
      const req = store.put(record);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  function getAll(store) {
    return new Promise((resolve, reject) => {
      const req = store.getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  }

  async function saveTeamRun(payload) {
    const db = await open();
    const store = tx(db, STORE_RUNS, "readwrite");
    await put(store, payload);
    db.close();
  }

  async function saveIterationEvent(payload) {
    const db = await open();
    const store = tx(db, STORE_ITER, "readwrite");
    await put(store, payload);
    db.close();
  }

  async function listTeamRuns() {
    const db = await open();
    const store = tx(db, STORE_RUNS, "readonly");
    const rows = await getAll(store);
    db.close();
    return rows.sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));
  }

  async function listIterations() {
    const db = await open();
    const store = tx(db, STORE_ITER, "readonly");
    const rows = await getAll(store);
    db.close();
    return rows.sort((a, b) => (a.createdAt || "").localeCompare(b.createdAt || ""));
  }

  async function exportAll() {
    const [runs, iterations] = await Promise.all([listTeamRuns(), listIterations()]);
    return {
      exportedAt: new Date().toISOString(),
      runs,
      iterations
    };
  }

  return {
    saveTeamRun,
    saveIterationEvent,
    listTeamRuns,
    listIterations,
    exportAll
  };
})();
