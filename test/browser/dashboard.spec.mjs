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

test('dashboard derives metrics and opens their filtered records', async ({ page }) => {
  const directory = mkdtempSync(join(tmpdir(), 'northstar-dashboard-'));
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
    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
    await expect(page.getByRole('button', { name: /Open pipeline value/ })).toBeVisible();
    const dashboard = async () => {
      await page.getByRole('button', { name: 'Dashboard', exact: true }).click();
      await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
    };

    await page.getByRole('button', { name: /Open pipeline value/ }).click();
    await expect(page.getByRole('heading', { name: 'Deals' })).toBeVisible();
    await expect(page).toHaveURL(/status=open/);
    await dashboard();
    await page.getByRole('button', { name: /Deals closing soon/ }).click();
    await expect(page.getByRole('heading', { name: 'Deals' })).toBeVisible();
    await expect(page).toHaveURL(/expectedCloseFrom=.*expectedCloseTo=/);
    await dashboard();
    await page.getByRole('button', { name: /Overdue tasks/ }).click();
    await expect(page.getByRole('heading', { name: 'Tasks' })).toBeVisible();
    await expect(page).toHaveURL(/due=overdue/);
    await dashboard();
    await page.getByRole('button', { name: /Upcoming tasks/ }).click();
    await expect(page.getByRole('heading', { name: 'Tasks' })).toBeVisible();
    await expect(page).toHaveURL(/dueFrom=.*dueTo=/);
    await dashboard();
    await page.getByRole('button', { name: /Qualified:/ }).click();
    await expect(page.getByRole('heading', { name: 'Deals' })).toBeVisible();
    await expect(page).toHaveURL(/stageId=stage_qualified/);
    await dashboard();
    await page.getByRole('button', { name: /without activity/ }).click();
    await expect(page.getByRole('heading', { name: 'Companies' })).toBeVisible();
    await expect(page).toHaveURL(/staleBefore=/);
    await dashboard();
    await page.getByRole('button', { name: /won:/ }).click();
    await expect(page.getByRole('heading', { name: 'Deals' })).toBeVisible();
    await expect(page).toHaveURL(/status=won.*transitionedSince=/);
    await dashboard();
    await page
      .getByRole('heading', { name: 'Recent activity' })
      .locator('..')
      .getByRole('button')
      .first()
      .click();
    await expect(page.getByRole('heading', { name: 'Activities' })).toBeVisible();
    await expect(page).toHaveURL(/relatedRecordId=/);
  } finally {
    child.kill();
    rmSync(directory, { recursive: true, force: true });
  }
});
