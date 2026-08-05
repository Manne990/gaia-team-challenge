import { defineConfig } from '@playwright/test';

const port = Number(process.env.TEST_PORT);
if (!Number.isInteger(port)) throw new Error('TEST_PORT must be set by the browser test runner');
const baseURL = `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: 'tests/browser',
  forbidOnly: true,
  fullyParallel: false,
  reporter: 'list',
  use: { baseURL, browserName: 'chromium', headless: true },
  webServer: {
    command: `TEST_PORT=${port} node tests/browser/test-server.mjs`,
    url: baseURL,
    reuseExistingServer: false,
    timeout: 15_000,
  },
});
