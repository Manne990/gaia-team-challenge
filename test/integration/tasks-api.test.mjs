import { afterEach, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { createTemporaryEnvironment } from '../support/temporary-environment.mjs';
import { createApp } from '../../src/server/app.ts';

const require = createRequire(import.meta.url);
const { openDatabase, seedDatabase } = require('../../src/db/database.mjs');

describe('tasks API', () => {
  let environment;
  let server;
  afterEach(async () => {
    await new Promise((resolve) => server?.close(resolve));
    await environment?.cleanup();
  });

  it('persists task lifecycle without crossing role or organization boundaries', async () => {
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
    const create = await fetch(`${url}/api/tasks`, {
      method: 'POST',
      headers: { cookie: owner, 'content-type': 'application/json' },
      body: JSON.stringify({
        title: 'Close renewal',
        description: 'Confirm terms',
        assigneeId: 'usr_member',
        dueAt: '2030-01-16T09:30:00.000Z',
        priority: 'high',
        companyId: 'co_acme',
        contactId: 'ct_ada',
      }),
    });
    expect(create.status).toBe(201);
    const task = await create.json();
    expect(task).toMatchObject({
      title: 'Close renewal',
      status: 'open',
      archived_at: null,
      version: 1,
    });
    const listed = await fetch(`${url}/api/tasks?assigneeId=usr_member&due=upcoming&sort=dueAt`, {
      headers: { cookie: owner },
    });
    expect((await listed.json()).items.map((item) => item.id)).toContain(task.id);
    const completed = await fetch(`${url}/api/tasks/${task.id}/complete`, {
      method: 'POST',
      headers: { cookie: owner },
    });
    expect(await completed.json()).toMatchObject({
      status: 'completed',
      completed_at: expect.any(String),
      version: 2,
    });
    const reopened = await fetch(`${url}/api/tasks/${task.id}/reopen`, {
      method: 'POST',
      headers: { cookie: owner },
    });
    expect(await reopened.json()).toMatchObject({ status: 'open', completed_at: null, version: 3 });
    const stale = await fetch(`${url}/api/tasks/${task.id}`, {
      method: 'PUT',
      headers: { cookie: owner, 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'Stale update', version: 1 }),
    });
    expect(stale.status).toBe(409);
    const archived = await fetch(`${url}/api/tasks/${task.id}/archive`, {
      method: 'POST',
      headers: { cookie: owner },
    });
    expect(await archived.json()).toMatchObject({ archived_at: expect.any(String) });
    const detail = await fetch(`${url}/api/tasks/${task.id}`, { headers: { cookie: owner } });
    expect((await detail.json()).history.map((event) => event.action)).toContain('task.archived');
    const viewer = await signIn('viewer@northstar.test', 'ViewerPass!2026');
    expect(
      (
        await fetch(`${url}/api/tasks`, {
          method: 'POST',
          headers: { cookie: viewer, 'content-type': 'application/json' },
          body: JSON.stringify({ title: 'Blocked' }),
        })
      ).status,
    ).toBe(403);
    const foreign = await signIn('other-owner@outside.test', 'OutsidePass!2026');
    expect(
      (await fetch(`${url}/api/tasks/${task.id}`, { headers: { cookie: foreign } })).status,
    ).toBe(404);
    const persisted = openDatabase(environment.databasePath)
      .prepare('SELECT title, organization_id FROM tasks WHERE id = ?')
      .get(task.id);
    expect(persisted).toEqual({ title: 'Close renewal', organization_id: 'org_northstar' });
  });
});
