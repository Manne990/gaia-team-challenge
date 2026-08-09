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
      // Still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('Northstar server did not become ready');
};
const cookieHeader = async (page, url) =>
  (await page.context().cookies(url)).map((cookie) => `${cookie.name}=${cookie.value}`).join('; ');
const signOut = async (page) => {
  if ((page.viewportSize()?.width ?? 0) <= 720)
    await page.getByRole('button', { name: 'Open account menu' }).click();
  else {
    const profile = page.locator('button.profile');
    await profile.scrollIntoViewIfNeeded();
    await profile.click();
  }
  await page.getByRole('button', { name: 'Sign out' }).click();
  await page.getByRole('button', { name: 'Confirm sign out' }).click();
};
const navigateTo = async (page, destination) => {
  if ((page.viewportSize()?.width ?? 0) <= 720)
    await page.getByRole('button', { name: 'Open navigation' }).click();
  await page.getByRole('button', { name: destination }).click();
};

test('actual company workspace creates, filters, updates, archives, restores, and isolates records', async ({
  page,
}) => {
  const directory = mkdtempSync(join(tmpdir(), 'northstar-company-browser-'));
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
    await expect(page.getByRole('heading', { name: 'Good morning, Northstar' })).toBeVisible();
    await navigateTo(page, 'Companies');
    await expect(page.getByRole('heading', { name: 'Companies' })).toBeVisible();
    const create = page.getByRole('form', { name: 'Create company' });
    await create.getByLabel('Name').fill('Browser Test Company');
    await create.getByLabel('External reference').fill('BROWSER-83');
    await create.getByLabel('Website').fill('https://example.test');
    await create.getByLabel('Phone').fill('+46 8 123');
    await create.getByLabel('Industry').fill('Software');
    await create.getByLabel('Size').fill('11-50');
    await create.getByLabel('Address').fill('Testvägen 1');
    await create.getByLabel('Lifecycle status').selectOption('prospect');
    await create.getByLabel('Tags').fill('priority, nordic');
    await create.getByLabel('Description').fill('A durable browser-created company.');
    await create.getByRole('button', { name: 'Create company' }).click();
    await expect(page.getByRole('list', { name: 'Company results' })).toContainText(
      'Browser Test Company',
    );
    await page.getByRole('button', { name: 'Browser Test Company', exact: true }).click();
    await expect(
      page.getByRole('heading', { name: 'Browser Test Company', exact: true }),
    ).toBeVisible();
    const ownerCookie = await cookieHeader(page, url);
    const listed = await page.request.get(
      `${url}/api/companies?industry=Software&tag=priority&sort=updatedAt&direction=desc`,
      { headers: { cookie: ownerCookie } },
    );
    expect(listed.status()).toBe(200);
    const created = (await listed.json()).items.find(
      (company) => company.external_reference === 'BROWSER-83',
    );
    expect(created).toMatchObject({ name: 'Browser Test Company', lifecycle_status: 'prospect' });
    const edit = page.getByRole('form', { name: 'Edit company' });
    await edit.getByLabel('Name').fill('Browser Test Company Updated');
    await edit.getByLabel('Lifecycle status').selectOption('customer');
    await edit.getByLabel('Description').fill('Updated safely.');
    await edit.getByRole('button', { name: 'Save company' }).click();
    await expect(page.getByRole('button', { name: 'Archive company' })).toBeVisible();
    page.on('dialog', (dialog) => dialog.accept());
    await page.getByRole('button', { name: 'Archive company' }).dispatchEvent('click');
    await expect(page.getByRole('button', { name: 'Restore company' })).toBeVisible();
    expect(
      (
        await (
          await page.request.get(`${url}/api/companies?text=Browser+Test+Company`, {
            headers: { cookie: ownerCookie },
          })
        ).json()
      ).total,
    ).toBe(0);
    const archived = await page.request.get(
      `${url}/api/companies?text=Browser+Test+Company&includeArchived=true`,
      { headers: { cookie: ownerCookie } },
    );
    expect((await archived.json()).total).toBe(1);
    await page.getByRole('button', { name: 'Restore company' }).dispatchEvent('click');
    await expect(page.getByRole('button', { name: 'Archive company' })).toBeVisible();
    const detail = await page.request.get(`${url}/api/companies/${created.id}`, {
      headers: { cookie: ownerCookie },
    });
    expect(detail.status()).toBe(200);
    expect((await detail.json()).history).toHaveLength(4);
    await signOut(page);
    await page.getByLabel('Email').fill('viewer@northstar.test');
    await page.getByLabel('Password').fill('ViewerPass!2026');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.getByRole('heading', { name: 'Good morning, Northstar' })).toBeVisible();
    const viewerCookie = await cookieHeader(page, url);
    const viewerSession = await page.request.get(`${url}/api/auth/session`, {
      headers: { cookie: viewerCookie },
    });
    expect(viewerSession.status()).toBe(200);
    expect((await viewerSession.json()).role).toBe('viewer');
    expect(
      (
        await page.request.post(`${url}/api/companies/${created.id}/archive`, {
          headers: { cookie: viewerCookie },
        })
      ).status(),
    ).toBe(403);
    expect(
      (
        await page.request.get(`${url}/api/companies/co_outside`, {
          headers: { cookie: viewerCookie },
        })
      ).status(),
    ).toBe(404);
  } finally {
    child.kill();
    rmSync(directory, { recursive: true, force: true });
  }
});
