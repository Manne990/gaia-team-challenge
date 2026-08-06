import assert from 'node:assert/strict';
import test from 'node:test';
import { openDatabase, resetDatabase, seedDatabase } from './database.js';
import { TaskError, TaskService, type TaskActor } from './tasks.js';

const actor: TaskActor = {
  organizationId: 'org-northstar',
  membershipId: 'membership-northstar-owner',
  role: 'owner',
};
test('tasks enforce organization assignment, versions, lifecycle, and UTC views', () => {
  resetDatabase();
  seedDatabase();
  const db = openDatabase();
  try {
    const service = new TaskService(db, () => '2026-01-15T12:00:00.000Z');
    const task = service.create(actor, {
      title: 'Follow up',
      assigneeMembershipId: actor.membershipId,
      dueAt: '2026-01-15T15:00:00.000Z',
      priority: 'high',
    });
    assert.equal(service.list(actor, 'due-today').length, 1);
    assert.equal(service.list(actor, 'follow-up').length, 1);
    const later = service.create(actor, {
      title: 'Later',
      assigneeMembershipId: actor.membershipId,
      dueAt: '2026-01-23T12:00:00.000Z',
    });
    assert.equal(service.list(actor, 'follow-up').length, 1);
    service.archive(actor, later.id as string, later.version as number);
    assert.throws(
      () =>
        service.create(actor, { title: 'Bad', assigneeMembershipId: 'membership-outside-owner' }),
      TaskError,
    );
    const completed = service.update(
      actor,
      task.id as string,
      { title: 'Follow up', assigneeMembershipId: actor.membershipId, status: 'completed' },
      task.version as number,
    );
    assert.equal(completed.completedAt, '2026-01-15T12:00:00.000Z');
    assert.equal(service.list(actor, 'completed').length, 1);
    assert.throws(
      () =>
        service.update(
          actor,
          task.id as string,
          { title: 'Old', assigneeMembershipId: actor.membershipId },
          task.version as number,
        ),
      TaskError,
    );
    const archived = service.archive(actor, task.id as string, completed.version as number);
    assert.ok(archived.archivedAt);
    assert.equal(service.list(actor).length, 0);
    assert.ok(
      service.archive(actor, task.id as string, archived.version as number, true).archivedAt ===
        null,
    );
  } finally {
    db.close();
  }
});
