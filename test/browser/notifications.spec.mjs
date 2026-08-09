import { expect, test } from '@playwright/test';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const port = () =>
  new Promise((resolve) => {
    const server = createServer();
    server.listen(0, '127.0.0.1', () => {
      const value = server.address().port;
      server.close(() => resolve(value));
    });
  });
const ready = async (url) => {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      if ((await fetch(`${url}/api/health`)).ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('Server did not start');
};

test('owner reads notification inbox', async ({ page }) => {
  const directory = mkdtempSync(join(tmpdir(), 'northstar-notifications-'));
  const databasePath = join(directory, 'crm.sqlite');
  const listenPort = await port();
  const environment = { ...process.env, CRM_DB_PATH: databasePath, NODE_ENV: 'test' };
  expect(spawnSync('npx', ['tsx', 'scripts/db.ts', 'reset'], { env: environment }).status).toBe(0);
  expect(spawnSync('npx', ['tsx', 'scripts/db.ts', 'seed'], { env: environment }).status).toBe(0);
  const child = spawn(
    'npx',
    [
      'tsx',
      'src/server/index.ts',
      '--host',
      '127.0.0.1',
      '--port',
      String(listenPort),
      '--db-path',
      databasePath,
    ],
    { env: environment, stdio: 'ignore' },
  );
  try {
    const url = `http://127.0.0.1:${listenPort}`;
    await ready(url);
    await page.goto(url);
    await page.getByLabel('Email').fill('owner@northstar.test');
    await page.getByLabel('Password').fill('OwnerPass!2026');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await page.getByRole('button', { name: 'Notifications' }).click();
    await expect(page.getByRole('region', { name: 'Notifications' })).toBeVisible();
    await page.getByRole('button', { name: 'Mark all read' }).click({ force: true });
    await expect(page.getByText('No unread notifications.')).toBeVisible();
  } finally {
    child.kill();
    rmSync(directory, { recursive: true, force: true });
  }
});
