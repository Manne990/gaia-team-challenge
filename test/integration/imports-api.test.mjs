import { afterEach, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { createApp } from '../../src/server/app.ts';
import { createTemporaryEnvironment } from '../support/temporary-environment.mjs';

const require = createRequire(import.meta.url);
const { openDatabase, seedDatabase } = require('../../src/db/database.mjs');

describe('CSV import and export API', () => {
  let environment;
  let server;
  afterEach(async () => {
    await new Promise((resolve) => server?.close(resolve));
    await environment?.cleanup();
  });
  it('previews, commits once, protects formulas, and scopes import/export', async () => {
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
    const preview = await fetch(`${url}/api/imports/preview`, {
      method: 'POST',
      headers: { cookie: owner, 'content-type': 'application/json' },
      body: JSON.stringify({
        resource: 'companies',
        csv: 'name,external reference,description\nImported Co,IMP-1,=formula\nAgain,IMP-1,test',
      }),
    });
    expect(preview.status).toBe(201);
    const body = await preview.json();
    expect(body.validRows).toBe(1);
    expect(body.rows[1].errors).toContain('Duplicate key appears in this CSV.');
    expect(
      (
        await fetch(`${url}/api/imports/${body.id}/commit`, {
          method: 'POST',
          headers: { cookie: owner },
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await fetch(`${url}/api/imports/${body.id}/commit`, {
          method: 'POST',
          headers: { cookie: owner },
        })
      ).status,
    ).toBe(200);
    const exported = await fetch(`${url}/api/exports/companies.csv?text=Imported`, {
      headers: { cookie: owner },
    });
    expect(exported.status).toBe(200);
    expect(await exported.text()).toContain("'=formula");
    const viewer = await signIn('viewer@northstar.test', 'ViewerPass!2026');
    expect(
      (
        await fetch(`${url}/api/imports/preview`, {
          method: 'POST',
          headers: { cookie: viewer, 'content-type': 'application/json' },
          body: JSON.stringify({ resource: 'companies', csv: 'name\nNope' }),
        })
      ).status,
    ).toBe(403);
    const outside = await signIn('other-owner@outside.test', 'OutsidePass!2026');
    expect(
      (
        await fetch(`${url}/api/imports/${body.id}/commit`, {
          method: 'POST',
          headers: { cookie: outside },
        })
      ).status,
    ).toBe(404);
  });
});
