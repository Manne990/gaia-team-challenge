import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';

const freePort = () =>
  new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });

const ready = async (url) => {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      if ((await fetch(`${url}/api/health`)).ok) return;
    } catch {
      // Still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('Northstar server did not become ready');
};

test('global search is keyboard reachable and saved company views are actionable', async ({
  page,
}) => {
  const directory = mkdtempSync(join(tmpdir(), 'northstar-search-browser-'));
  const databasePath = join(directory, 'crm.sqlite');
  const port = await freePort();
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
      String(port),
      '--db-path',
      databasePath,
    ],
    { env: environment, stdio: 'ignore' },
  );
  const url = `http://127.0.0.1:${port}`;
  try {
    await ready(url);
    await page.goto(url);
    await page.getByLabel('Email').fill('owner@northstar.test');
    await page.getByLabel('Password').fill('OwnerPass!2026');
    await page.getByRole('button', { name: 'Sign in' }).click();
    const search = page.getByLabel('Search CRM');
    await expect(search).toBeVisible();
    await page.locator('body').press('Control+k');
    await expect(search).toBeFocused();
    await search.fill('Acme');
    await expect(page.getByRole('button', { name: /Acme Industries/ })).toBeVisible();
    await page.getByRole('button', { name: /Acme Industries/ }).click();
    await expect(page.getByRole('heading', { name: 'Companies' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Acme Industries' })).toBeVisible();
    const saved = page.locator('[aria-label="Manage saved views for companies"]');
    await saved.getByLabel('New saved view name').fill('Acme focus');
    await saved.getByRole('button', { name: 'Save current view' }).click();
    await expect(saved.getByRole('button', { name: 'Acme focus', exact: true })).toBeVisible();
    await page.getByLabel('Search CRM').fill('no such record');
    await expect(page.getByText('No records match', { exact: false })).toBeVisible();
  } finally {
    child.kill();
    rmSync(directory, { recursive: true, force: true });
  }
});
