import { afterEach, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { createTemporaryEnvironment } from '../support/temporary-environment.mjs';
import { createApp } from '../../src/server/app.ts';

const require = createRequire(import.meta.url);
const { openDatabase, seedDatabase } = require('../../src/db/database.mjs');

describe('search and saved views API', () => {
  let environment;
  let server;
  afterEach(async () => {
    await new Promise((resolve) => server?.close(resolve));
    await environment?.cleanup();
  });
  it('groups scoped search and keeps saved views personal', async () => {
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
    const searchResponse = await fetch(`${url}/api/search?q=Acme`, { headers: { cookie: owner } });
    expect(searchResponse.status, await searchResponse.clone().text()).toBe(200);
    const search = await searchResponse.json();
    expect(search.groups.companies.map((item) => item.id)).toContain('co_acme');
    expect(search.groups.companies.map((item) => item.id)).not.toContain('co_outside');
    const created = await fetch(`${url}/api/saved-views`, {
      method: 'POST',
      headers: { cookie: owner, 'content-type': 'application/json' },
      body: JSON.stringify({
        resource: 'companies',
        name: 'Acme accounts',
        filters: { text: 'Acme', lifecycle: 'customer' },
      }),
    });
    expect(created.status).toBe(201);
    const view = await created.json();
    expect(
      (
        await fetch(`${url}/api/saved-views/${view.id}`, {
          method: 'PUT',
          headers: { cookie: owner, 'content-type': 'application/json' },
          body: JSON.stringify({
            resource: 'companies',
            name: 'Current Acme accounts',
            filters: { text: 'Acme', lifecycle: 'customer', sort: 'updatedAt' },
          }),
        })
      ).status,
    ).toBe(204);
    expect(
      (
        await (
          await fetch(`${url}/api/saved-views?resource=companies`, { headers: { cookie: owner } })
        ).json()
      ).items,
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: view.id,
          name: 'Current Acme accounts',
          filters: { text: 'Acme', lifecycle: 'customer', sort: 'updatedAt' },
        }),
      ]),
    );
    const member = await signIn('member@northstar.test', 'MemberPass!2026');
    expect(
      (await (await fetch(`${url}/api/saved-views`, { headers: { cookie: member } })).json()).items,
    ).toHaveLength(0);
    expect(
      (
        await fetch(`${url}/api/saved-views/${view.id}`, {
          method: 'DELETE',
          headers: { cookie: member },
        })
      ).status,
    ).toBe(404);
    expect(
      (await fetch(`${url}/api/search?q=Outside`, { headers: { cookie: owner } })).status,
    ).toBe(200);
    const dealList = await fetch(`${url}/api/deals?text=Acme&sort=name&direction=asc`, {
      headers: { cookie: owner },
    });
    expect(dealList.status).toBe(200);
    expect((await dealList.json()).items.every((deal) => deal.name.includes('Acme'))).toBe(true);
    expect(
      (await fetch(`${url}/api/saved-views?resource=activities`, { headers: { cookie: owner } }))
        .status,
    ).toBe(400);
  });
});
