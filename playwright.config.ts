import { defineConfig } from "@playwright/test";

const port = Number(process.env.TEST_PORT ?? 4173);

export default defineConfig({
  testDir: "tests/e2e",
  forbidOnly: true,
  // Browser workflows share one isolated seeded database for the run. Keep
  // them serial so mutation evidence cannot race or leak transient state into
  // another workflow; retries remain diagnostic rather than synchronization.
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["line"], ["html", { open: "never" }]] : "line",
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
});
