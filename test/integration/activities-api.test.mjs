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
    let url = `http://127.0.0.1:${server.address().port}`;
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
    const companyDetail = await fetch(`${url}/api/companies/co_acme`, {
      headers: { cookie: member },
    });
    const contactDetail = await fetch(`${url}/api/contacts/ct_ada`, {
      headers: { cookie: member },
    });
    expect(
      (await companyDetail.json()).activities.filter((item) => item.id === activity.id),
    ).toHaveLength(1);
    expect(
      (await contactDetail.json()).activities.filter((item) => item.id === activity.id),
    ).toHaveLength(1);

    await new Promise((resolve) => server.close(resolve));
    server = createApp({
      host: '127.0.0.1',
      port: 0,
      databasePath: environment.databasePath,
      environment: 'test',
    }).listen(0);
    await new Promise((resolve) => server.once('listening', resolve));
    url = `http://127.0.0.1:${server.address().port}`;
    expect(
      (await fetch(`${url}/api/activities/${activity.id}`, { headers: { cookie: member } })).status,
    ).toBe(200);

    const filtered = await fetch(
      `${url}/api/activities?type=call&authorId=usr_member&relatedRecordId=ct_ada`,
      { headers: { cookie: member } },
    );
    expect(filtered.status, await filtered.clone().text()).toBe(200);
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

    const concurrent = await Promise.all(
      ['Concurrent one', 'Concurrent two'].map((subject) =>
        fetch(`${url}/api/activities/${activity.id}`, {
          method: 'PATCH',
          headers: { cookie: member, 'content-type': 'application/json' },
          body: JSON.stringify({
            subject,
            body: '',
            participantNames: [],
            version: current.version,
          }),
        }),
      ),
    );
    expect(concurrent.map((response) => response.status).sort()).toEqual([200, 409]);
    expect(
      (
        await fetch(`${url}/api/activities/${activity.id}`, {
          method: 'DELETE',
          headers: { cookie: member },
        })
      ).status,
    ).toBe(204);
    expect(
      (await fetch(`${url}/api/activities/${activity.id}`, { headers: { cookie: member } })).status,
    ).toBe(404);

    const firstPage = await fetch(`${url}/api/activities?pageSize=1`, {
      headers: { cookie: member },
    });
    const firstPageBody = await firstPage.json();
    await fetch(`${url}/api/activities`, {
      method: 'POST',
      headers: { cookie: member, 'content-type': 'application/json' },
      body: JSON.stringify({
        type: 'note',
        subject: 'Inserted after snapshot',
        occurredAt: '2026-08-10T10:00:00.000Z',
      }),
    });
    const secondPage = await fetch(
      `${url}/api/activities?pageSize=1&snapshotCreatedAt=${encodeURIComponent(firstPageBody.snapshotCreatedAt)}&cursorOccurredAt=${encodeURIComponent(firstPageBody.nextCursor.occurredAt)}&cursorId=${encodeURIComponent(firstPageBody.nextCursor.id)}`,
      { headers: { cookie: member } },
    );
    expect((await secondPage.json()).items.map((item) => item.id)).not.toContain(
      firstPageBody.items[0].id,
    );

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

    const failingWriter = openDatabase(environment.databasePath);
    failingWriter.exec(
      "CREATE TRIGGER force_activity_failure BEFORE INSERT ON activities WHEN NEW.subject = 'Force rollback' BEGIN SELECT RAISE(ABORT, 'forced activity failure'); END;",
    );
    failingWriter.close();
    const rollback = await fetch(`${url}/api/activities`, {
      method: 'POST',
      headers: { cookie: member, 'content-type': 'application/json' },
      body: JSON.stringify({
        type: 'note',
        subject: 'Force rollback',
        occurredAt: '2026-08-09T12:00:00.000Z',
        followUp: { title: 'Task must roll back' },
      }),
    });
    expect(rollback.status).toBe(500);
    const rollbackReader = openDatabase(environment.databasePath);
    expect(
      rollbackReader
        .prepare("SELECT count(*) AS total FROM tasks WHERE title = 'Task must roll back'")
        .get().total,
    ).toBe(0);
    rollbackReader.close();

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
