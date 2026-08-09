import { expect, test } from '@playwright/test';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const freePort = () =>
  new Promise((resolve) => {
    const server = createServer();
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
const waitForHealth = async (url) => {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      if ((await fetch(`${url}/api/health`)).ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('Server did not start');
};

test('owner previews and commits a CSV import from the Imports workspace', async ({ page }) => {
  const directory = mkdtempSync(join(tmpdir(), 'northstar-imports-'));
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
    await waitForHealth(url);
    await page.goto(url);
    await page.getByLabel('Email').fill('owner@northstar.test');
    await page.getByLabel('Password').fill('OwnerPass!2026');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await page.getByRole('button', { name: 'Imports' }).click();
    await expect(page.getByRole('heading', { name: 'Imports and exports' })).toBeVisible();
    await page.getByLabel('CSV content').fill('name,external reference\nBrowser import,BROWSER-90');
    await page.getByRole('button', { name: 'Preview import' }).click();
    await expect(
      page.getByText('1 rows are ready; invalid or duplicate rows will not be imported.'),
    ).toBeVisible();
    await page.getByRole('button', { name: 'Commit valid rows' }).click();
    await expect(page.getByText('Import committed.')).toBeVisible();
  } finally {
    child.kill();
    rmSync(directory, { recursive: true, force: true });
  }
});
