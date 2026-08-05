import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  use: { baseURL: 'http://127.0.0.1:4174' },
  webServer: {
    command:
      'NORTHSTAR_DB_PATH=.data/northstar.sqlite npm run db:reset && NORTHSTAR_DB_PATH=.data/northstar.sqlite npm run db:seed && NORTHSTAR_DB_PATH=.data/northstar.sqlite npm run dev -- --host 127.0.0.1 --port 4174',
    url: 'http://127.0.0.1:4174',
    reuseExistingServer: false,
  },
});
