"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");

process.env.DATABASE_URL = "postgresql://health_user:super-secret-password@db:5432/emba_sim";
process.env.GIT_COMMIT = "health-test-commit";

const { createAppServer } = require("../server");

function requestHealth(server) {
  const address = server.address();
  return new Promise((resolve, reject) => {
    http.get(`http://127.0.0.1:${address.port}/api/health`, (response) => {
      let body = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => { body += chunk; });
      response.on("end", () => resolve({ statusCode: response.statusCode, body }));
    }).on("error", reject);
  });
}

test("health exposes only public metadata and never leaks the database URL", async (t) => {
  const server = createAppServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));

  const response = await requestHealth(server);
  assert.equal(response.statusCode, 200);
  assert.equal(response.body.toLowerCase().includes("postgresql"), false);
  assert.equal(response.body.includes("super-secret-password"), false);

  const payload = JSON.parse(response.body);
  assert.deepEqual(Object.keys(payload).sort(), ["ok", "server_commit", "summary_sources"]);
  assert.equal(payload.ok, true);
  assert.equal(payload.server_commit, "health-test-commit");
  assert.equal(typeof payload.summary_sources, "object");
});
