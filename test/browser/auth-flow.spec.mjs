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
const signOut = async (page) => {
  await page.getByRole('button', { name: 'Open account menu' }).click();
  await page.getByRole('button', { name: 'Sign out' }).click();
  await page.getByRole('button', { name: 'Confirm sign out' }).click();
};
const navigateTo = async (page, destination) => {
  if ((page.viewportSize()?.width ?? 0) <= 720)
    await page.getByRole('button', { name: 'Open navigation' }).click();
  await page.getByRole('button', { name: destination }).click();
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
    await expect(page.getByRole('heading', { name: 'Good morning, Northstar' })).toBeVisible();
    expect(
      await page.locator('html').evaluate((element) => element.scrollWidth === element.clientWidth),
    ).toBe(true);
    await expect(page.getByRole('button', { name: 'Administration' })).toBeVisible();
    await navigateTo(page, 'Companies');
    await expect(page.getByRole('heading', { name: 'Companies' })).toBeVisible();
    await expect(page.getByRole('table', { name: 'Companies list' })).toBeVisible();
    await navigateTo(page, 'Contacts');
    await expect(page.getByRole('heading', { name: 'Contacts' })).toBeVisible();
    await expect(page.getByRole('table', { name: 'Contacts list' })).toBeVisible();
    expect(
      await page.evaluate(() => fetch('/api/contacts').then((response) => response.status)),
    ).toBe(200);
    await page.getByRole('button', { name: 'Add contact' }).click();
    await page.getByLabel('First name').fill('Browser');
    await page.getByLabel('Last name').fill('Flow');
    await page
      .getByRole('textbox', { name: 'Email', exact: true })
      .fill('browser.flow@example.test');
    await page.getByLabel('Job title').fill('Stakeholder');
    await page.getByLabel('Tags (comma separated)').fill('vip, browser');
    const createResponse = page.waitForResponse(
      (response) =>
        response.url().endsWith('/api/contacts') && response.request().method() === 'POST',
    );
    await page.getByRole('button', { name: 'Save contact' }).click();
    expect((await createResponse).status()).toBe(201);
    await page.getByLabel('Search contacts').fill('Browser');
    const browserContact = page.getByRole('link', { name: 'Browser Flow' });
    await expect(browserContact).toBeVisible();
    await browserContact.click();
    await expect(page.getByRole('dialog', { name: 'Browser Flow' })).toBeVisible();
    await page.getByRole('textbox', { name: 'Phone', exact: true }).fill('+46 70 123 45 67');
    await page.getByRole('button', { name: 'Save changes' }).click();
    await expect(page.getByText('Change history')).toBeVisible();
    await page.getByRole('button', { name: 'Archive contact' }).click();
    await expect(browserContact).toHaveCount(0);
    await page.getByRole('button', { name: 'Filter' }).click();
    await page.getByRole('button', { name: 'Show archived' }).click();
    await expect(browserContact).toBeVisible();
    await page.getByRole('button', { name: 'Restore Browser Flow' }).click();
    await expect(browserContact).toHaveCount(0);
    await navigateTo(page, 'Dashboard');
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole('button', { name: 'Open navigation' }).click();
    await expect(
      page
        .getByRole('complementary', { name: 'Primary navigation' })
        .getByRole('button', { name: 'Close navigation' }),
    ).toBeVisible();
    expect(
      await page.locator('html').evaluate((element) => element.scrollWidth === element.clientWidth),
    ).toBe(true);
    await page
      .getByRole('complementary', { name: 'Primary navigation' })
      .getByRole('button', { name: 'Close navigation' })
      .click();
    const accountTrigger = page.getByRole('button', { name: 'Open account menu' });
    await accountTrigger.focus();
    await accountTrigger.click();
    await expect(page.getByRole('dialog', { name: 'Account menu' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(accountTrigger).toBeFocused();
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
    await expect(page.getByRole('heading', { name: 'Good morning, Northstar' })).toBeVisible();
    await signOut(page);
    await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
    await page.getByLabel('Email').fill('viewer@northstar.test');
    await page.getByLabel('Password').fill('ViewerPass!2026');
    await page.getByRole('button', { name: 'Sign in' }).press('Enter');
    await expect(page.getByRole('heading', { name: 'Good morning, Northstar' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Administration' })).toHaveCount(0);
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
    await expect(
      page.request
        .post(`${url}/api/contacts`, {
          headers: { cookie: cookieHeader, 'content-type': 'application/json' },
          data: { firstName: 'Blocked', lastName: 'Contact' },
        })
        .then((response) => response.status()),
    ).resolves.toBe(403);
    await signOut(page);
    await page.getByLabel('Email').fill('owner@northstar.test');
    await page.getByLabel('Password').fill('OwnerPass!2026');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.getByRole('heading', { name: 'Good morning, Northstar' })).toBeVisible();
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
    await signOut(page);
    await page.getByLabel('Email').fill('member@northstar.test');
    await page.getByLabel('Password').fill('MemberPass!2026');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.getByRole('heading', { name: 'Good morning, Northstar' })).toBeVisible();
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
    await expect(
      page.request
        .post(`${url}/api/contacts`, {
          headers: { cookie: memberCookieHeader, 'content-type': 'application/json' },
          data: { firstName: 'Member', lastName: 'Contact' },
        })
        .then((response) => response.status()),
    ).resolves.toBe(201);
    await signOut(page);
    await page.getByLabel('Email').fill('other-owner@outside.test');
    await page.getByLabel('Password').fill('OutsidePass!2026');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.getByRole('heading', { name: 'Good morning, Outside' })).toBeVisible();
    await expect(page.getByText('Outside Demo', { exact: true })).toBeVisible();
    await expect(page.getByText('Northstar Demo', { exact: true })).toHaveCount(0);
    await navigateTo(page, 'Companies');
    await expect(page.getByText('Acme Nordic AB', { exact: true })).toHaveCount(0);
    await expect(page.getByText('Northstar Logistics', { exact: true })).toHaveCount(0);
    await expect(
      page.request
        .get(`${url}/api/contacts/ct_ada`, {
          headers: {
            cookie: (await page.context().cookies(url))
              .map((cookie) => `${cookie.name}=${cookie.value}`)
              .join('; '),
          },
        })
        .then((response) => response.status()),
    ).resolves.toBe(404);
  } finally {
    child.kill();
    rmSync(directory, { recursive: true, force: true });
  }
});
