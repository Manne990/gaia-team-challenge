import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';

const port = () =>
  new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close(() => resolve(address.port));
    });
  });
const ready = async (url) => {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      if ((await fetch(`${url}/api/health`)).ok) return;
    } catch {
      /* starting */
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('Northstar server did not become ready');
};
const navigate = async (page, name) => {
  if ((page.viewportSize()?.width ?? 0) <= 720)
    await page.getByRole('button', { name: 'Open navigation' }).click();
  await page.getByRole('button', { name, exact: true }).click();
};

test('actual task workspace creates, completes, reopens, archives, and keeps viewers read-only', async ({
  page,
}) => {
  const directory = mkdtempSync(join(tmpdir(), 'northstar-task-browser-'));
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
  const url = `http://127.0.0.1:${listenPort}`;
  try {
    await ready(url);
    await page.goto(url);
    await page.getByLabel('Email').fill('owner@northstar.test');
    await page.getByLabel('Password').fill('OwnerPass!2026');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await navigate(page, 'Tasks');
    await expect(page.getByRole('heading', { name: 'Tasks' })).toBeVisible();
    const create = page.getByRole('form', { name: 'Create task' });
    await create.getByLabel('Title').fill('Browser task');
    await create.getByLabel('Description').fill('A durable task workflow.');
    await create.getByLabel('Due time').fill('2020-01-16T09:30');
    await create.getByLabel('Priority').selectOption('high');
    const [createResponse] = await Promise.all([
      page.waitForResponse(
        (response) =>
          response.url().endsWith('/api/tasks') && response.request().method() === 'POST',
      ),
      create.getByRole('button', { name: 'Create task' }).click(),
    ]);
    expect(createResponse.status()).toBe(201);
    const results = page.getByRole('list', { name: 'Task results' });
    await expect(results).toContainText('Browser task');
    const taskRow = page.getByRole('listitem').filter({ hasText: 'Browser task' });
    await taskRow.getByRole('button', { name: 'Complete task' }).click();
    await expect(taskRow).toContainText('completed');
    await taskRow.getByRole('button', { name: 'Reopen task' }).click();
    await expect(taskRow).toContainText('open');
    await taskRow.getByRole('button', { name: 'Archive task' }).click();
    await expect(page.getByText('Task archived.')).toBeVisible();
    await navigate(page, 'Deals');
    await page.evaluate(() => history.replaceState(null, '', '?sort=name&direction=desc&page=1'));
    await navigate(page, 'Tasks');
    await expect(page.getByRole('list', { name: 'Task results' })).not.toBeEmpty();
    await expect(page).toHaveURL(/sort=dueAt/);
    const account = page.getByRole('button', { name: /Northstar Owner owner/ });
    await account.focus();
    await page.keyboard.press('Enter');
    await page.getByRole('button', { name: 'Sign out' }).click();
    await page.getByRole('button', { name: 'Confirm sign out' }).click();
    await page.getByLabel('Email').fill('viewer@northstar.test');
    await page.getByLabel('Password').fill('ViewerPass!2026');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await navigate(page, 'Tasks');
    await expect(page.getByRole('form', { name: 'Create task' })).toHaveCount(0);
  } finally {
    child.kill();
    rmSync(directory, { recursive: true, force: true });
  }
});
