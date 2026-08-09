import { afterEach, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { createTemporaryEnvironment } from '../support/temporary-environment.mjs';
import { createApp } from '../../src/server/app.ts';

const require = createRequire(import.meta.url);
const { openDatabase, seedDatabase } = require('../../src/db/database.mjs');

describe('administration API', () => {
  let environment;
  let server;
  afterEach(async () => {
    await new Promise((resolve) => server?.close(resolve));
    await environment?.cleanup();
  });
  it('keeps members and audit events owner-authorized and organization-scoped', async () => {
    environment = await createTemporaryEnvironment();
    const database = openDatabase(environment.databasePath);
    seedDatabase(database);
    database.close();
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
    const viewer = await signIn('viewer@northstar.test', 'ViewerPass!2026');
    const created = await fetch(`${url}/api/administration/members`, {
      method: 'POST',
      headers: { cookie: owner, 'content-type': 'application/json' },
      body: JSON.stringify({
        email: 'new@northstar.test',
        displayName: 'New Member',
        password: 'NewPass!2026',
        role: 'member',
      }),
    });
    expect(created.status).toBe(201);
    expect(
      (await fetch(`${url}/api/administration/members`, { headers: { cookie: viewer } })).status,
    ).toBe(403);
    const audit = await (
      await fetch(`${url}/api/audit-events?page=1&pageSize=1&action=membership.created`, {
        headers: { cookie: owner },
      })
    ).json();
    expect(audit.total).toBe(1);
    expect(audit.items[0].summaryJson).not.toContain('NewPass');
    const outside = await signIn('other-owner@outside.test', 'OutsidePass!2026');
    expect(
      (await (await fetch(`${url}/api/audit-events`, { headers: { cookie: outside } })).json())
        .total,
    ).toBe(0);
  });
});
