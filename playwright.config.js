const { defineConfig } = require("@playwright/test");

module.exports = defineConfig({
  testDir: "./tests/e2e",
  timeout: 120000,
  retries: 0,
  use: {
    baseURL: process.env.BASE_URL || process.env.TEST_URL || "http://localhost:8787",
    headless: true,
    screenshot: "only-on-failure",
    video: "retain-on-failure",
    trace: "retain-on-failure"
  },
  reporter: [["html", { open: "never" }], ["list"]]
});
