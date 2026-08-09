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
    expect((await suggestions.json()).items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ sourceId: 'ct_ada', targetId: 'ct_duplicate' }),
      ]),
    );
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
    const retired = await fetch(`${url}/api/contacts/ct_duplicate`, { headers: { cookie } });
    expect(retired.status).toBe(200);
    expect((await retired.json()).id).toBe('ct_ada');
  });
});
