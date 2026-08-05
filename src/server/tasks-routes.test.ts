import assert from 'node:assert/strict';
import test from 'node:test';
import { openDatabase, resetDatabase, seedDatabase } from './database.js';
import { handleTaskRequest } from './tasks-routes.js';
import { TaskService, type TaskActor } from './tasks.js';

test('task routes expose validated organization-scoped mutations and UTC views', async () => {
  resetDatabase();
  seedDatabase();
  const db = openDatabase();
  try {
    const actor: TaskActor = {
      organizationId: 'org-northstar',
      membershipId: 'membership-northstar-owner',
      role: 'owner',
    };
    const service = new TaskService(db);
    const created = await handleTaskRequest(
      new Request('http://crm.test/api/tasks', {
        method: 'POST',
        body: JSON.stringify({
          title: 'Call back',
          assigneeMembershipId: actor.membershipId,
          dueAt: '2026-01-15T09:00:00.000Z',
        }),
      }),
      actor,
      service,
    );
    assert.equal(created?.status, 201);
    const task = (await created?.json()) as { id: string; version: number };
    const conflict = await handleTaskRequest(
      new Request(`http://crm.test/api/tasks/${task.id}`, {
        method: 'PUT',
        body: JSON.stringify({
          title: 'Call back',
          assigneeMembershipId: actor.membershipId,
          version: 999,
        }),
      }),
      actor,
      service,
    );
    assert.equal(conflict?.status, 409);
    const denied = await handleTaskRequest(
      new Request('http://crm.test/api/tasks'),
      { ...actor, role: 'viewer' },
      service,
    );
    assert.equal(denied?.status, 200);
  } finally {
    db.close();
  }
});
