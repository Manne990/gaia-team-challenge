import { afterEach, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { createTemporaryEnvironment } from '../support/temporary-environment.mjs';
import { createApp } from '../../src/server/app.ts';

const require = createRequire(import.meta.url);
const { openDatabase, seedDatabase } = require('../../src/db/database.mjs');

describe('explicit contact merge', () => {
  let environment;
  let server;
  afterEach(async () => {
    await new Promise((resolve) => server?.close(resolve));
    await environment?.cleanup();
  });

  it('moves relations, archives the source, and resolves its retired identifier', async () => {
    environment = await createTemporaryEnvironment();
    const db = openDatabase(environment.databasePath);
    seedDatabase(db);
    const now = new Date().toISOString();
    db.prepare(
      'INSERT INTO contacts (id, organization_id, first_name, last_name, email, status, tags_json, communication_preference, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    ).run(
      'ct_duplicate',
      'org_northstar',
      'Ada',
      'Duplicate',
      'ada@example.test',
      'active',
      '[]',
      'email',
      now,
      now,
    );
    db.prepare(
      'INSERT INTO contacts (id, organization_id, first_name, last_name, email, status, tags_json, communication_preference, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    ).run(
      'ct_third',
      'org_northstar',
      'Ada',
      'Third',
      'ada@example.test',
      'active',
      '[]',
      'email',
      now,
      now,
    );
    db.prepare('UPDATE contacts SET archived_at = ?, email = ? WHERE id = ?').run(
      now,
      'ada@example.test',
      'ct_grace',
    );
    db.prepare('UPDATE contacts SET email = ? WHERE id = ?').run('ada@example.test', 'ct_ada');
    const sourceVersion = db
      .prepare('SELECT version FROM contacts WHERE id = ?')
      .get('ct_duplicate').version;
    const targetVersion = db
      .prepare('SELECT version FROM contacts WHERE id = ?')
      .get('ct_ada').version;
    db.close();
    server = createApp({
      host: '127.0.0.1',
      port: 0,
      databasePath: environment.databasePath,
      environment: 'test',
    }).listen(0);
    await new Promise((resolve) => server.once('listening', resolve));
    const url = `http://127.0.0.1:${server.address().port}`;
    const login = await fetch(`${url}/api/auth/sign-in`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'owner@northstar.test', password: 'OwnerPass!2026' }),
    });
    const cookie = login.headers.get('set-cookie');
    const suggestions = await fetch(`${url}/api/duplicates/contacts`, { headers: { cookie } });
    const suggestionItems = (await suggestions.json()).items;
    expect(suggestionItems).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ sourceId: 'ct_ada', targetId: 'ct_duplicate' }),
      ]),
    );
    expect(suggestionItems).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ sourceId: 'ct_ada', targetId: 'ct_grace' }),
        expect.objectContaining({ sourceId: 'ct_grace', targetId: 'ct_duplicate' }),
        expect.objectContaining({ sourceId: 'ct_katherine' }),
        expect.objectContaining({ targetId: 'ct_katherine' }),
      ]),
    );
    const staleVersion = await fetch(`${url}/api/merges`, {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({
        resource: 'contacts',
        sourceId: 'ct_duplicate',
        targetId: 'ct_ada',
        sourceVersion: sourceVersion + 1,
        targetVersion,
        fields: {},
      }),
    });
    expect(staleVersion.status).toBe(409);
    const merge = await fetch(`${url}/api/merges`, {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({
        resource: 'contacts',
        sourceId: 'ct_duplicate',
        targetId: 'ct_ada',
        sourceVersion,
        targetVersion,
        fields: {},
      }),
    });
    expect(merge.status).toBe(201);
    const replay = await fetch(`${url}/api/merges`, {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({
        resource: 'contacts',
        sourceId: 'ct_duplicate',
        targetId: 'ct_ada',
        sourceVersion,
        targetVersion,
        fields: {},
      }),
    });
    expect(replay.status).toBe(400);
    const stale = await fetch(`${url}/api/merges`, {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({
        resource: 'contacts',
        sourceId: 'ct_ada',
        targetId: 'ct_duplicate',
        sourceVersion: targetVersion,
        targetVersion: sourceVersion,
        fields: {},
      }),
    });
    expect(stale.status).toBe(400);
    const retired = await fetch(`${url}/api/contacts/ct_duplicate`, { headers: { cookie } });
    expect(retired.status).toBe(200);
    expect((await retired.json()).id).toBe('ct_ada');
    const chainedCandidate = (
      await (await fetch(`${url}/api/duplicates/contacts`, { headers: { cookie } })).json()
    ).items.find((item) => item.sourceId === 'ct_ada' && item.targetId === 'ct_third');
    const chained = await fetch(`${url}/api/merges`, {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({
        resource: 'contacts',
        sourceId: 'ct_ada',
        targetId: 'ct_third',
        sourceVersion: chainedCandidate.sourceVersion,
        targetVersion: chainedCandidate.targetVersion,
        fields: {},
      }),
    });
    expect(chained.status).toBe(201);
    const chainedRetired = await fetch(`${url}/api/contacts/ct_duplicate`, { headers: { cookie } });
    expect((await chainedRetired.json()).id).toBe('ct_third');
  });

  it('keeps company history resolvable after restart and rejects a foreign merge', async () => {
    environment = await createTemporaryEnvironment();
    const db = openDatabase(environment.databasePath);
    seedDatabase(db);
    const now = new Date().toISOString();
    db.prepare(
      'INSERT INTO companies (id, organization_id, name, external_reference, lifecycle_status, tags_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    ).run(
      'co_acme_duplicate',
      'org_northstar',
      'Acme duplicate',
      'ref-co_acme',
      'lead',
      '[]',
      now,
      now,
    );
    const sourceVersion = db
      .prepare('SELECT version FROM companies WHERE id = ?')
      .get('co_acme_duplicate').version;
    const targetVersion = db
      .prepare('SELECT version FROM companies WHERE id = ?')
      .get('co_acme').version;
    db.close();
    server = createApp({
      host: '127.0.0.1',
      port: 0,
      databasePath: environment.databasePath,
      environment: 'test',
    }).listen(0);
    await new Promise((resolve) => server.once('listening', resolve));
    let url = `http://127.0.0.1:${server.address().port}`;
    const signIn = async (email, password) => {
      const response = await fetch(`${url}/api/auth/sign-in`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      return response.headers.get('set-cookie');
    };
    const cookie = await signIn('owner@northstar.test', 'OwnerPass!2026');
    const suggestions = await fetch(`${url}/api/duplicates/companies`, { headers: { cookie } });
    expect((await suggestions.json()).items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ sourceId: 'co_acme', targetId: 'co_acme_duplicate' }),
      ]),
    );
    const outsideCookie = await signIn('other-owner@outside.test', 'OutsidePass!2026');
    const foreign = await fetch(`${url}/api/merges`, {
      method: 'POST',
      headers: { cookie: outsideCookie, 'content-type': 'application/json' },
      body: JSON.stringify({
        resource: 'companies',
        sourceId: 'co_acme_duplicate',
        targetId: 'co_acme',
        sourceVersion,
        targetVersion,
        fields: {},
      }),
    });
    expect(foreign.status).toBe(400);
    const foreignOwner = await fetch(`${url}/api/merges`, {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({
        resource: 'companies',
        sourceId: 'co_acme_duplicate',
        targetId: 'co_acme',
        sourceVersion,
        targetVersion,
        fields: { ownerId: 'usr_outside' },
      }),
    });
    expect(foreignOwner.status).toBe(400);
    const unchanged = await fetch(`${url}/api/companies/co_acme`, { headers: { cookie } });
    expect((await unchanged.json()).owner_id).toBe('usr_owner');
    const merge = await fetch(`${url}/api/merges`, {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({
        resource: 'companies',
        sourceId: 'co_acme_duplicate',
        targetId: 'co_acme',
        sourceVersion,
        targetVersion,
        fields: { name: 'Acme Industries', ownerId: null },
      }),
    });
    expect(merge.status).toBe(201);
    await new Promise((resolve) => server.close(resolve));
    server = createApp({
      host: '127.0.0.1',
      port: 0,
      databasePath: environment.databasePath,
      environment: 'test',
    }).listen(0);
    await new Promise((resolve) => server.once('listening', resolve));
    url = `http://127.0.0.1:${server.address().port}`;
    const restartedCookie = await signIn('owner@northstar.test', 'OwnerPass!2026');
    const retired = await fetch(`${url}/api/companies/co_acme_duplicate`, {
      headers: { cookie: restartedCookie },
    });
    expect(retired.status).toBe(200);
    expect(await retired.json()).toMatchObject({ id: 'co_acme', owner_id: null });
  });
});
