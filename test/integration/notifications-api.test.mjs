import { afterEach, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { createTemporaryEnvironment } from '../support/temporary-environment.mjs';
import { createApp } from '../../src/server/app.ts';

const require = createRequire(import.meta.url);
const { openDatabase, seedDatabase } = require('../../src/db/database.mjs');

describe('notifications API', () => {
  let environment;
  let server;
  afterEach(async () => {
    await new Promise((resolve) => server?.close(resolve));
    await environment?.cleanup();
  });
  it('replays due generation safely and keeps read state personal', async () => {
    environment = await createTemporaryEnvironment();
    const db = openDatabase(environment.databasePath);
    seedDatabase(db);
    db.prepare('UPDATE tasks SET assignee_id = ?, due_at = ? WHERE id = ?').run(
      'usr_owner',
      new Date(Date.now() + 25 * 60 * 60 * 1000).toISOString(),
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
    const first = await fetch(`${url}/api/notifications?unread=true`, {
      headers: { cookie: owner },
    });
    expect(first.status).toBe(200);
    const items = (await first.json()).items;
    expect(items.length).toBeGreaterThan(0);
    expect(items.some((item) => JSON.parse(item.payloadJson).recordId === 'task_today')).toBe(
      false,
    );
    const boundary = openDatabase(environment.databasePath);
    boundary
      .prepare('UPDATE tasks SET due_at = ? WHERE id = ?')
      .run(new Date(Date.now() + 23 * 60 * 60 * 1000).toISOString(), 'task_today');
    boundary.close();
    const withinWindow = await fetch(`${url}/api/notifications?unread=true`, {
      headers: { cookie: owner },
    });
    expect(
      (await withinWindow.json()).items.some(
        (item) => JSON.parse(item.payloadJson).recordId === 'task_today',
      ),
    ).toBe(true);
    const again = await fetch(`${url}/api/notifications?unread=true`, {
      headers: { cookie: owner },
    });
    expect((await again.json()).items).toHaveLength(items.length + 1);
    expect(
      (
        await fetch(`${url}/api/notifications/${items[0].id}/read`, {
          method: 'POST',
          headers: { cookie: owner },
        })
      ).status,
    ).toBe(200);
    const outsider = await signIn('other-owner@outside.test', 'OutsidePass!2026');
    const deal = await fetch(`${url}/api/deals/deal_acme`, { headers: { cookie: owner } });
    const currentDeal = await deal.json();
    expect(
      (
        await fetch(`${url}/api/deals/deal_acme`, {
          method: 'PATCH',
          headers: { cookie: owner, 'content-type': 'application/json' },
          body: JSON.stringify({
            name: currentDeal.name,
            companyId: currentDeal.companyId,
            ownerId: 'usr_outside',
            amountCents: currentDeal.amountCents,
            currency: currentDeal.currency,
            probability: currentDeal.probability,
            version: currentDeal.version,
          }),
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await fetch(`${url}/api/deals`, {
          method: 'POST',
          headers: { cookie: owner, 'content-type': 'application/json' },
          body: JSON.stringify({
            name: 'Foreign owner attempt',
            companyId: 'co_acme',
            stageId: 'stage_proposal',
            ownerId: 'usr_outside',
            amountCents: 100,
            currency: 'USD',
          }),
        })
      ).status,
    ).toBe(400);
    const notificationCheck = openDatabase(environment.databasePath);
    expect(
      notificationCheck
        .prepare(
          'SELECT count(*) AS total FROM notifications WHERE organization_id = ? AND user_id = ?',
        )
        .get('org_northstar', 'usr_outside').total,
    ).toBe(0);
    notificationCheck.close();
    expect(
      (
        await fetch(`${url}/api/notifications/${items[0].id}/read`, {
          method: 'POST',
          headers: { cookie: outsider },
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await fetch(`${url}/api/notifications/read-all`, {
          method: 'POST',
          headers: { cookie: owner },
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await (
          await fetch(`${url}/api/notifications?unread=true`, { headers: { cookie: owner } })
        ).json()
      ).items,
    ).toHaveLength(0);
    const listenPort = server.address().port;
    await new Promise((resolve) => server.close(resolve));
    server = createApp({
      host: '127.0.0.1',
      port: 0,
      databasePath: environment.databasePath,
      environment: 'test',
    }).listen(listenPort);
    await new Promise((resolve) => server.once('listening', resolve));
    const restarted = await fetch(`${url}/api/notifications?unread=true`, {
      headers: { cookie: owner, connection: 'close' },
    }).catch(() =>
      fetch(`${url}/api/notifications?unread=true`, {
        headers: { cookie: owner, connection: 'close' },
      }),
    );
    expect((await restarted.json()).items).toHaveLength(0);
  });
});
