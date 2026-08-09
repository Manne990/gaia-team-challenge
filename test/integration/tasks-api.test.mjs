import { afterEach, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { createTemporaryEnvironment } from '../support/temporary-environment.mjs';
import { createApp } from '../../src/server/app.ts';

const require = createRequire(import.meta.url);
const { openDatabase, seedDatabase } = require('../../src/db/database.mjs');
const start = async (databasePath) => {
  const app = createApp({ host: '127.0.0.1', port: 0, databasePath, environment: 'test' });
  const server = await new Promise((resolve) => {
    const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
  });
  return { server, url: `http://127.0.0.1:${server.address().port}` };
};

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
    let url;
    ({ server, url } = await start(environment.databasePath));
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
    const now = new Date();
    const tomorrow = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1),
    );
    const boundaryTasks = [
      ['Boundary overdue', new Date(now.getTime() - 60_000).toISOString()],
      ['Boundary today', new Date(now.getTime() + 60_000).toISOString()],
      ['Boundary upcoming', tomorrow.toISOString()],
    ];
    for (const [title, dueAt] of boundaryTasks) {
      expect(
        (
          await fetch(`${url}/api/tasks`, {
            method: 'POST',
            headers: { cookie: owner, 'content-type': 'application/json' },
            body: JSON.stringify({ title, dueAt }),
          })
        ).status,
      ).toBe(201);
    }
    const dueView = async (due) =>
      (
        await (await fetch(`${url}/api/tasks?due=${due}`, { headers: { cookie: owner } })).json()
      ).items.map((item) => item.title);
    expect(await dueView('overdue')).toContain('Boundary overdue');
    expect(await dueView('today')).toContain('Boundary today');
    expect(await dueView('upcoming')).toContain('Boundary upcoming');
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
    await new Promise((resolve) => server.close(resolve));
    ({ server, url } = await start(environment.databasePath));
    const restartedOwner = await signIn('owner@northstar.test', 'OwnerPass!2026');
    expect(
      (await fetch(`${url}/api/tasks/${task.id}`, { headers: { cookie: restartedOwner } })).status,
    ).toBe(200);
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
