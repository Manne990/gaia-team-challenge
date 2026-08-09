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
const waitForHealth = async (url) => {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      if ((await fetch(`${url}/api/health`)).ok) return;
    } catch {
      // The server is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('Northstar server did not become ready');
};

test('actual product signs in by keyboard, rejects invalid credentials, restores session, and logs out', async ({
  page,
}) => {
  const directory = mkdtempSync(join(tmpdir(), 'northstar-auth-browser-'));
  const databasePath = join(directory, 'crm.sqlite');
  const port = await freePort();
  const environment = { ...process.env, CRM_DB_PATH: databasePath, NODE_ENV: 'test' };
  const reset = spawnSync('npx', ['tsx', 'scripts/db.ts', 'reset'], {
    env: environment,
    encoding: 'utf8',
  });
  const seed = spawnSync('npx', ['tsx', 'scripts/db.ts', 'seed'], {
    env: environment,
    encoding: 'utf8',
  });
  expect(reset.status, reset.stderr).toBe(0);
  expect(seed.status, seed.stderr).toBe(0);
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
    await page.getByLabel('Password').fill('wrong password');
    await page.getByRole('button', { name: 'Sign in' }).press('Enter');
    await expect(page.getByRole('alert')).toHaveText('Email or password is incorrect.');
    await page.getByLabel('Password').fill('OwnerPass!2026');
    await page.getByRole('button', { name: 'Sign in' }).press('Enter');
    await expect(page.getByRole('heading', { name: /Welcome, Northstar Owner/ })).toBeVisible();
    await page.reload();
    await expect(page.getByRole('heading', { name: /Welcome, Northstar Owner/ })).toBeVisible();
    await page.getByRole('button', { name: 'Sign out' }).press('Enter');
    await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
  } finally {
    child.kill();
    rmSync(directory, { recursive: true, force: true });
  }
});
