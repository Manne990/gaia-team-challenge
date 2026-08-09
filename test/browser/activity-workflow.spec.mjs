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
      // Server is starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('Northstar server did not become ready');
};
const navigateTo = async (page, destination) => {
  if ((page.viewportSize()?.width ?? 0) <= 720)
    await page.getByRole('button', { name: 'Open navigation' }).click();
  await page.getByRole('button', { name: destination }).click();
};

test('actual activity workspace records, filters, edits, and links a follow-up', async ({
  page,
}) => {
  const directory = mkdtempSync(join(tmpdir(), 'northstar-activity-browser-'));
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
    await page.getByLabel('Email').fill('member@northstar.test');
    await page.getByLabel('Password').fill('MemberPass!2026');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await navigateTo(page, 'Activities');
    await expect(page.getByRole('heading', { name: 'Activities' })).toBeVisible();
    const create = page.getByRole('form', { name: 'Log activity' });
    await create.getByLabel('Type').selectOption('meeting');
    await create.getByLabel('Subject').fill('Browser renewal meeting');
    await create.getByLabel('Occurred at').fill('2026-08-09T12:00');
    await create.getByLabel('Notes', { exact: true }).fill('Confirmed renewal scope.');
    await create.getByLabel('Participants').fill('Ada Lovelace, Northstar Member');
    await create.getByLabel('Company ID').fill('co_acme');
    await create.getByLabel('Contact ID').fill('ct_ada');
    await create.getByLabel('Task title').fill('Send renewal summary');
    await create.getByRole('button', { name: 'Record activity' }).click();
    await expect(page.getByRole('list', { name: 'Activity timeline' })).toContainText(
      'Browser renewal meeting',
    );
    await page.getByRole('button', { name: 'Browser renewal meeting' }).click();
    const edit = page.getByRole('form', { name: 'Edit activity' });
    await edit.getByLabel('Subject').fill('Browser renewal meeting confirmed');
    await edit.getByRole('button', { name: 'Save activity notes' }).click();
    await expect(page.getByRole('alert')).toHaveText('Activity updated.');
    const filters = page.getByRole('form', { name: 'Activity filters' });
    await filters.getByLabel('Type').selectOption('meeting');
    await filters.getByRole('button', { name: 'Apply filters' }).click();
    await expect(page.getByRole('list', { name: 'Activity timeline' })).toContainText(
      'Browser renewal meeting confirmed',
    );
    expect(
      await page.locator('html').evaluate((element) => element.scrollWidth === element.clientWidth),
    ).toBe(true);
  } finally {
    child.kill();
    rmSync(directory, { recursive: true, force: true });
  }
});
