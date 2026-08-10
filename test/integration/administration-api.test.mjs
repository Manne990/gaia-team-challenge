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
      (
        await (
          await fetch(`${url}/api/audit-events?action=membership.created`, {
            headers: { cookie: outside },
          })
        ).json()
      ).total,
    ).toBe(0);

    const lastOwnerRoleChange = await fetch(`${url}/api/administration/members/mem_owner`, {
      method: 'PATCH',
      headers: { cookie: owner, 'content-type': 'application/json' },
      body: JSON.stringify({ role: 'member' }),
    });
    expect(lastOwnerRoleChange.status).toBe(400);
    expect((await lastOwnerRoleChange.json()).error.code).toBe('LAST_OWNER');
    const lastOwnerRemoval = await fetch(`${url}/api/administration/members/mem_owner`, {
      method: 'DELETE',
      headers: { cookie: owner },
    });
    expect(lastOwnerRemoval.status).toBe(400);
    expect((await lastOwnerRemoval.json()).error.code).toBe('LAST_OWNER');

    const addedOwner = await fetch(`${url}/api/administration/members`, {
      method: 'POST',
      headers: { cookie: owner, 'content-type': 'application/json' },
      body: JSON.stringify({
        email: 'second-owner@northstar.test',
        displayName: 'Second Owner',
        password: 'SecondOwnerPass!2026',
        role: 'owner',
      }),
    });
    expect(addedOwner.status).toBe(201);
    const addedOwnerMembership = await addedOwner.json();
    const secondOwner = await signIn('second-owner@northstar.test', 'SecondOwnerPass!2026');
    expect(
      (
        await fetch(`${url}/api/administration/members/${addedOwnerMembership.id}`, {
          method: 'DELETE',
          headers: { cookie: secondOwner },
        })
      ).status,
    ).toBe(204);
    const revokedSession = await fetch(`${url}/api/administration/members`, {
      headers: { cookie: secondOwner },
    });
    expect(revokedSession.status).toBe(401);
    expect((await revokedSession.json()).error.code).toBe('UNAUTHENTICATED');

    const staleOwner = await signIn('owner@northstar.test', 'OwnerPass!2026');
    const testDatabase = openDatabase(environment.databasePath);
    testDatabase
      .prepare(
        "UPDATE sessions SET expires_at = '2000-01-01T00:00:00.000Z' WHERE user_id = 'usr_owner'",
      )
      .run();
    testDatabase.close();
    const staleSession = await fetch(`${url}/api/administration/members`, {
      headers: { cookie: staleOwner },
    });
    expect(staleSession.status).toBe(401);
    expect((await staleSession.json()).error.code).toBe('SESSION_EXPIRED');
  });
});
