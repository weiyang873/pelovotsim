const { defineConfig } = require("@playwright/test");

module.exports = defineConfig({
  testDir: "./tests/e2e",
  timeout: 120000,
  retries: 0,
  use: {
    baseURL: process.env.TEST_URL || "https://app.praxisengine.xyz",
    headless: true,
    screenshot: "only-on-failure",
    video: "retain-on-failure",
    trace: "retain-on-failure"
  },
  reporter: [["html", { open: "never" }], ["list"]]
});
