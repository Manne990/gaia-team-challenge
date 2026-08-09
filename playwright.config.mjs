import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./test/browser",
  fullyParallel: true,
  forbidOnly: true,
  forbidEmpty: true,
  retries: process.env.CI ? 1 : 0,
  use: { headless: true },
});
