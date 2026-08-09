import { afterEach, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { createTemporaryEnvironment } from '../support/temporary-environment.mjs';
import { createApp } from '../../src/server/app.ts';

const require = createRequire(import.meta.url);
const { openDatabase, seedDatabase } = require('../../src/db/database.mjs');

describe('dashboard API', () => {
  let environment;
  let server;
  afterEach(async () => {
    await new Promise((resolve) => server?.close(resolve));
    await environment?.cleanup();
  });

  it('derives tenant-scoped metrics and reconciles their record filters', async () => {
    environment = await createTemporaryEnvironment();
    const db = openDatabase(environment.databasePath);
    seedDatabase(db);
    const now = new Date();
    db.prepare('UPDATE deals SET expected_close_date = ? WHERE id = ?').run(
      new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
      'deal_acme',
    );
    db.prepare('UPDATE tasks SET due_at = ? WHERE id = ?').run(
      new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString(),
      'task_today',
    );
    db.close();
    server = createApp({
      host: '127.0.0.1',
      port: 0,
      databasePath: environment.databasePath,
      environment: 'test',
    }).listen(0);
    await new Promise((resolve) => server.once('listening', resolve));
    const url = `http://127.0.0.1:${server.address().port}`;
    const signIn = async (email, password) =>
      (
        await fetch(`${url}/api/auth/sign-in`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ email, password }),
        })
      ).headers.get('set-cookie');
    const owner = await signIn('owner@northstar.test', 'OwnerPass!2026');
    const outside = await signIn('other-owner@outside.test', 'OutsidePass!2026');
    const dashboard = await (
      await fetch(`${url}/api/dashboard`, { headers: { cookie: owner } })
    ).json();
    expect(dashboard.pipeline).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ currency: 'USD', amountCents: expect.any(Number) }),
      ]),
    );
    expect(dashboard.closingSoon).toBeGreaterThan(0);
    expect(dashboard.tasks.upcoming).toBeGreaterThan(0);
    expect(dashboard.trend).toEqual(expect.any(Array));
    expect(dashboard.semantics).toMatchObject({
      timezone: 'UTC',
      closingSoonDays: 30,
      staleAccountDays: 30,
    });
    const outsideDashboard = await (
      await fetch(`${url}/api/dashboard`, { headers: { cookie: outside } })
    ).json();
    expect(outsideDashboard.pipeline).toEqual([]);
    expect(outsideDashboard.recentActivity).toEqual([]);
  });
});
