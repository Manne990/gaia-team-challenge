import { afterEach, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { createTemporaryEnvironment } from '../support/temporary-environment.mjs';
import { createApp } from '../../src/server/app.ts';

const require = createRequire(import.meta.url);
const { openDatabase, seedDatabase } = require('../../src/db/database.mjs');

describe('activities API', () => {
  let environment;
  let server;
  afterEach(async () => {
    await new Promise((resolve) => server?.close(resolve));
    await environment?.cleanup();
  });

  it('keeps timeline history scoped, stable, and atomic with a follow-up', async () => {
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
    const member = await signIn('member@northstar.test', 'MemberPass!2026');
    const created = await fetch(`${url}/api/activities`, {
      method: 'POST',
      headers: { cookie: member, 'content-type': 'application/json' },
      body: JSON.stringify({
        type: 'call',
        subject: 'Renewal call',
        body: 'Reviewed the renewal timeline.',
        occurredAt: '2026-08-09T10:00:00.000Z',
        participantNames: ['Ada Lovelace'],
        companyId: 'co_acme',
        contactId: 'ct_ada',
        followUp: {
          title: 'Send renewal notes',
          dueAt: '2026-08-10T09:00:00.000Z',
          priority: 'high',
        },
      }),
    });
    expect(created.status).toBe(201);
    const activity = await created.json();
    expect(activity.companyLabel).toBe('Acme Industries');
    expect(activity.contactLabel).toBe('Ada Lovelace');
    expect(activity.followUpTaskId).toMatch(/^task_/);

    const filtered = await fetch(
      `${url}/api/activities?type=call&authorId=usr_member&relatedRecordId=ct_ada`,
      { headers: { cookie: member } },
    );
    expect(filtered.status).toBe(200);
    expect((await filtered.json()).items.map((item) => item.id)).toContain(activity.id);

    const updated = await fetch(`${url}/api/activities/${activity.id}`, {
      method: 'PATCH',
      headers: { cookie: member, 'content-type': 'application/json' },
      body: JSON.stringify({
        subject: 'Renewal call — confirmed',
        body: 'Reviewed the renewal timeline and confirmed next steps.',
        participantNames: ['Ada Lovelace', 'Northstar Member'],
        version: activity.version,
      }),
    });
    expect(updated.status).toBe(200);
    const current = await updated.json();
    expect(current.version).toBe(activity.version + 1);
    expect(current.occurredAt).toBe(activity.occurredAt);
    expect(current.companyLabel).toBe('Acme Industries');

    const stale = await fetch(`${url}/api/activities/${activity.id}`, {
      method: 'PATCH',
      headers: { cookie: member, 'content-type': 'application/json' },
      body: JSON.stringify({
        subject: 'Stale edit',
        body: '',
        participantNames: [],
        version: activity.version,
      }),
    });
    expect(stale.status).toBe(409);

    const invalidFollowUp = await fetch(`${url}/api/activities`, {
      method: 'POST',
      headers: { cookie: member, 'content-type': 'application/json' },
      body: JSON.stringify({
        type: 'note',
        subject: 'Should not persist',
        occurredAt: '2026-08-09T11:00:00.000Z',
        companyId: 'co_outside',
        followUp: { title: 'Should not persist either' },
      }),
    });
    expect(invalidFollowUp.status).toBe(404);
    const reader = openDatabase(environment.databasePath);
    expect(
      reader
        .prepare("SELECT count(*) AS total FROM tasks WHERE title = 'Should not persist either'")
        .get().total,
    ).toBe(0);
    reader.close();

    const viewer = await signIn('viewer@northstar.test', 'ViewerPass!2026');
    expect(
      (
        await fetch(`${url}/api/activities`, {
          method: 'POST',
          headers: { cookie: viewer, 'content-type': 'application/json' },
          body: JSON.stringify({
            type: 'note',
            subject: 'Viewer cannot write',
            occurredAt: '2026-08-09T11:00:00.000Z',
          }),
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await fetch(`${url}/api/activities/${activity.id}`, {
          headers: {
            cookie: await signIn('other-owner@outside.test', 'OutsidePass!2026'),
          },
        })
      ).status,
    ).toBe(404);
  });
});
