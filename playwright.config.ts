import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './test/browser',
  testMatch: '**/*.spec.mjs',
  fullyParallel: false,
  workers: 1,
  forbidOnly: true,
  forbidEmpty: true,
  retries: process.env.CI ? 1 : 0,
  use: { headless: true },
  projects: [
    { name: 'desktop-wide', use: { viewport: { width: 1440, height: 900 } } },
    { name: 'desktop', use: { viewport: { width: 1024, height: 768 } } },
    { name: 'mobile', use: { viewport: { width: 390, height: 844 } } },
  ],
});
