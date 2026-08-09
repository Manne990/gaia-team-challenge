import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { openDatabase } from '../../src/db/database.mjs';

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
    let releaseSession;
    const sessionGate = new Promise((resolve) => {
      releaseSession = resolve;
    });
    await page.route('**/api/auth/session', async (route) => {
      await sessionGate;
      await route.continue();
    });
    const navigation = page.goto(url);
    await expect(page.locator('main')).toHaveAttribute('aria-busy', 'true');
    releaseSession();
    await navigation;
    await page.unroute('**/api/auth/session');
    await page.getByLabel('Email').fill('owner@northstar.test');
    await page.getByLabel('Password').fill('wrong password');
    await page.getByRole('button', { name: 'Sign in' }).press('Enter');
    await expect(page.getByRole('alert')).toHaveText('Email or password is incorrect.');
    await page.getByLabel('Password').fill('OwnerPass!2026');
    await page.getByRole('button', { name: 'Sign in' }).press('Enter');
    await expect(page.getByRole('heading', { name: /Welcome, Northstar Owner/ })).toBeVisible();
    const database = openDatabase(databasePath);
    database.prepare("UPDATE sessions SET expires_at = '2020-01-01T00:00:00.000Z'").run();
    database.close();
    await page.reload();
    await expect(page.getByRole('alert')).toHaveText(
      'Your session has expired. Please sign in again.',
    );
    await page.getByLabel('Email').fill('owner@northstar.test');
    await page.getByLabel('Password').fill('OwnerPass!2026');
    await page.getByRole('button', { name: 'Sign in' }).press('Enter');
    await expect(page.getByRole('heading', { name: /Welcome, Northstar Owner/ })).toBeVisible();
    await page.getByRole('button', { name: 'Sign out' }).press('Enter');
    await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
    await page.getByLabel('Email').fill('viewer@northstar.test');
    await page.getByLabel('Password').fill('ViewerPass!2026');
    await page.getByRole('button', { name: 'Sign in' }).press('Enter');
    await expect(page.getByRole('heading', { name: /Welcome, Northstar Viewer/ })).toBeVisible();
    const cookieHeader = (await page.context().cookies(url))
      .map((cookie) => `${cookie.name}=${cookie.value}`)
      .join('; ');
    const before = openDatabase(databasePath)
      .prepare('SELECT name FROM companies WHERE id = ?')
      .get('co_outside');
    await expect(
      page.request
        .put(`${url}/api/companies/co_acme`, {
          method: 'PUT',
          headers: { cookie: cookieHeader, 'content-type': 'application/json' },
          data: { name: 'Blocked' },
        })
        .then((response) => response.status()),
    ).resolves.toBe(403);
    await page.getByRole('button', { name: 'Sign out' }).click();
    await page.getByLabel('Email').fill('owner@northstar.test');
    await page.getByLabel('Password').fill('OwnerPass!2026');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.getByRole('heading', { name: /Welcome, Northstar Owner/ })).toBeVisible();
    const ownerCookieHeader = (await page.context().cookies(url))
      .map((cookie) => `${cookie.name}=${cookie.value}`)
      .join('; ');
    await expect(
      page.request
        .get(`${url}/api/companies/co_outside`, { headers: { cookie: ownerCookieHeader } })
        .then((response) => response.status()),
    ).resolves.toBe(404);
    await expect(
      page.request
        .put(`${url}/api/companies/co_outside`, {
          headers: { cookie: ownerCookieHeader, 'content-type': 'application/json' },
          data: { name: 'Mutated outside record' },
        })
        .then((response) => response.status()),
    ).resolves.toBe(404);
    expect(
      openDatabase(databasePath)
        .prepare('SELECT name FROM companies WHERE id = ?')
        .get('co_outside'),
    ).toEqual(before);
    await page.getByRole('button', { name: 'Sign out' }).click();
    await page.getByLabel('Email').fill('member@northstar.test');
    await page.getByLabel('Password').fill('MemberPass!2026');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.getByRole('heading', { name: /Welcome, Northstar Member/ })).toBeVisible();
    const memberCookieHeader = (await page.context().cookies(url))
      .map((cookie) => `${cookie.name}=${cookie.value}`)
      .join('; ');
    await expect(
      page.request
        .put(`${url}/api/companies/co_acme`, {
          headers: { cookie: memberCookieHeader, 'content-type': 'application/json' },
          data: { name: 'Allowed member write' },
        })
        .then((response) => response.status()),
    ).resolves.toBe(409);
  } finally {
    child.kill();
    rmSync(directory, { recursive: true, force: true });
  }
});
