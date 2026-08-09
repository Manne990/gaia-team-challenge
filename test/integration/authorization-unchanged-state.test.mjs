import { afterEach, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { createTemporaryEnvironment } from '../support/temporary-environment.mjs';
import { createApp } from '../../src/server/app.ts';

const require = createRequire(import.meta.url);
const { openDatabase, seedDatabase } = require('../../src/db/database.mjs');

describe('tenant-boundary mutation contract', () => {
  let environment;
  let server;
  afterEach(async () => {
    await new Promise((resolve) => server?.close(resolve));
    await environment?.cleanup();
  });

  it('rejects foreign reads and writes through the product without altering persisted state', async () => {
    environment = await createTemporaryEnvironment();
    const database = openDatabase(environment.databasePath);
    seedDatabase(database);
    const before = database
      .prepare('SELECT id, name, updated_at FROM companies WHERE id = ?')
      .get('co_outside');
    server = createApp({
      host: '127.0.0.1',
      port: 0,
      databasePath: environment.databasePath,
      environment: 'test',
    }).listen(0);
    await new Promise((resolve) => server.once('listening', resolve));
    const url = `http://127.0.0.1:${server.address().port}`;
    const signIn = await fetch(`${url}/api/auth/sign-in`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'owner@northstar.test', password: 'OwnerPass!2026' }),
    });
    const cookie = signIn.headers.get('set-cookie');
    expect(signIn.status).toBe(200);
    expect((await fetch(`${url}/api/companies/co_outside`, { headers: { cookie } })).status).toBe(
      404,
    );
    expect(
      (await fetch(`${url}/api/companies/co_outside`, { method: 'PUT', headers: { cookie } }))
        .status,
    ).toBe(404);
    expect(
      database.prepare('SELECT id, name, updated_at FROM companies WHERE id = ?').get('co_outside'),
    ).toEqual(before);
    database.close();
  });
});
