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
    const again = await fetch(`${url}/api/notifications?unread=true`, {
      headers: { cookie: owner },
    });
    expect((await again.json()).items).toHaveLength(items.length);
    expect(
      (
        await fetch(`${url}/api/notifications/${items[0].id}/read`, {
          method: 'POST',
          headers: { cookie: owner },
        })
      ).status,
    ).toBe(200);
    const outsider = await signIn('other-owner@outside.test', 'OutsidePass!2026');
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
