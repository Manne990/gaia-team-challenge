import { afterEach, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { createTemporaryEnvironment } from '../support/temporary-environment.mjs';
import { createApp } from '../../src/server/app.ts';

const require = createRequire(import.meta.url);
const { openDatabase, seedDatabase } = require('../../src/db/database.mjs');

describe('contacts API', () => {
  let environment;
  let server;
  afterEach(async () => {
    await new Promise((resolve) => server?.close(resolve));
    await environment?.cleanup();
  });
  it('creates normalized contacts, scopes them, and archives them', async () => {
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
    const created = await fetch(`${url}/api/contacts`, {
      method: 'POST',
      headers: { cookie: owner, 'content-type': 'application/json' },
      body: JSON.stringify({
        firstName: 'New',
        lastName: 'Person',
        email: 'NEW@EXAMPLE.TEST',
        companyId: 'co_acme',
        tags: ['vip'],
      }),
    });
    expect(created.status).toBe(201);
    const contact = await created.json();
    expect(contact.email).toBe('new@example.test');
    const duplicate = await fetch(`${url}/api/contacts`, {
      method: 'POST',
      headers: { cookie: owner, 'content-type': 'application/json' },
      body: JSON.stringify({ firstName: 'Again', lastName: 'Person', email: 'NEW@example.test' }),
    });
    expect((await duplicate.json()).duplicateWarning.id).toBe(contact.id);
    expect(
      (await fetch(`${url}/api/contacts?query=New`, { headers: { cookie: owner } })).status,
    ).toBe(200);
    expect(
      (
        await fetch(`${url}/api/contacts?ownerId=usr_owner&tag=vip&sort=createdAt`, {
          headers: { cookie: owner },
        })
      ).status,
    ).toBe(200);
    expect(
      (await fetch(`${url}/api/contacts/${contact.id}`, { headers: { cookie: owner } })).status,
    ).toBe(200);
    expect(
      (
        await fetch(`${url}/api/contacts/${contact.id}/archive`, {
          method: 'POST',
          headers: { cookie: owner },
        })
      ).status,
    ).toBe(204);
    const viewer = await signIn('viewer@northstar.test', 'ViewerPass!2026');
    expect(
      (
        await fetch(`${url}/api/contacts`, {
          method: 'POST',
          headers: { cookie: viewer, 'content-type': 'application/json' },
          body: JSON.stringify({ firstName: 'No', lastName: 'Write' }),
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await fetch(`${url}/api/contacts/${contact.id}`, {
          headers: { cookie: await signIn('other-owner@outside.test', 'OutsidePass!2026') },
        })
      ).status,
    ).toBe(404);
  });
});
