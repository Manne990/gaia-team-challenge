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

const navigateTo = async (page, destination) => {
  if ((page.viewportSize()?.width ?? 0) <= 720)
    await page.getByRole('button', { name: 'Open navigation' }).click();
  await page.getByRole('button', { name: destination, exact: true }).click();
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

test('task and deal saved views restore pagination, and a selected task respects later filters', async ({
  page,
}) => {
  const directory = mkdtempSync(join(tmpdir(), 'northstar-search-view-state-'));
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
    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
    expect(
      await page.evaluate(async () =>
        fetch('/api/tasks', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ title: 'Deep link task', priority: 'medium' }),
        }).then((response) => response.status),
      ),
    ).toBe(201);
    await page.getByLabel('Search CRM').fill('Deep link task');
    await page.getByRole('button', { name: /Deep link task/ }).click();
    const taskViews = page.getByRole('form', { name: 'Task views' });
    await expect(page.getByRole('list', { name: 'Task results' })).toContainText('Deep link task');
    await taskViews.getByLabel('Due state').selectOption('completed');
    await taskViews.getByRole('button', { name: 'Apply view' }).click();
    await expect(page.getByRole('list', { name: 'Task results' })).not.toContainText(
      'Deep link task',
    );

    expect(
      await page.evaluate(async () =>
        fetch('/api/saved-views', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            resource: 'tasks',
            name: 'Task ordered page',
            filters: {
              due: '',
              mine: false,
              relation: '',
              page: 2,
              sort: 'createdAt',
              direction: 'desc',
            },
          }),
        }).then((response) => response.status),
      ),
    ).toBe(201);
    await navigateTo(page, 'Dashboard');
    await navigateTo(page, 'Tasks');
    const taskSaved = page.locator('[aria-label="Manage saved views for tasks"]');
    await expect(
      taskSaved.getByRole('button', { name: 'Task ordered page', exact: true }),
    ).toBeVisible();
    await taskSaved.getByRole('button', { name: 'Task ordered page', exact: true }).click();
    await expect(page).toHaveURL(/sort=createdAt&direction=desc&page=2/);
    expect(
      await page.evaluate(async () =>
        fetch('/api/saved-views', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            resource: 'tasks',
            name: 'Stale task due',
            filters: { due: 'obsolete' },
          }),
        }).then((response) => response.status),
      ),
    ).toBe(201);
    await navigateTo(page, 'Dashboard');
    await navigateTo(page, 'Tasks');
    await taskSaved.getByRole('button', { name: 'Stale task due', exact: true }).click();
    await expect(taskSaved.getByRole('status')).toHaveText('This saved view is no longer valid.');

    await navigateTo(page, 'Deals');
    expect(
      await page.evaluate(async () =>
        fetch('/api/saved-views', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            resource: 'deals',
            name: 'Deal ordered page',
            filters: {
              stageId: '',
              status: '',
              includeArchived: false,
              page: 2,
              sort: 'name',
              direction: 'asc',
            },
          }),
        }).then((response) => response.status),
      ),
    ).toBe(201);
    await navigateTo(page, 'Dashboard');
    await navigateTo(page, 'Deals');
    const dealSaved = page.locator('[aria-label="Manage saved views for deals"]');
    await expect(
      dealSaved.getByRole('button', { name: 'Deal ordered page', exact: true }),
    ).toBeVisible();
    await dealSaved.getByRole('button', { name: 'Deal ordered page', exact: true }).click();
    await expect(page).toHaveURL(/page=2&sort=name&direction=asc/);
    expect(
      await page.evaluate(async () =>
        fetch('/api/saved-views', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            resource: 'deals',
            name: 'Stale deal status',
            filters: { status: 'obsolete' },
          }),
        }).then((response) => response.status),
      ),
    ).toBe(201);
    await navigateTo(page, 'Dashboard');
    await navigateTo(page, 'Deals');
    await dealSaved.getByRole('button', { name: 'Stale deal status', exact: true }).click();
    await expect(dealSaved.getByRole('status')).toHaveText('This saved view is no longer valid.');

    expect(
      await page.evaluate(async () =>
        fetch('/api/saved-views', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            resource: 'companies',
            name: 'Stale lifecycle',
            filters: { lifecycle: 'obsolete' },
          }),
        }).then((response) => response.status),
      ),
    ).toBe(201);
    await navigateTo(page, 'Companies');
    const companySaved = page.locator('[aria-label="Manage saved views for companies"]');
    await expect(
      companySaved.getByRole('button', { name: 'Stale lifecycle', exact: true }),
    ).toBeVisible();
    await companySaved.getByRole('button', { name: 'Stale lifecycle', exact: true }).click();
    await expect(companySaved.getByRole('status')).toHaveText(
      'This saved view is no longer valid.',
    );
  } finally {
    child.kill();
    rmSync(directory, { recursive: true, force: true });
  }
});
