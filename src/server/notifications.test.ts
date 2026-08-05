import assert from 'node:assert/strict';
import test from 'node:test';
import { NotificationError, NotificationService } from './notifications.js';
import { openDatabase, resetDatabase, seedDatabase } from './database.js';
test('notifications are recipient-scoped and replay-safe', () => {
  resetDatabase();
  seedDatabase();
  const db = openDatabase();
  try {
    db.prepare(
      "INSERT INTO tasks (id,organization_id,title,assignee_membership_id,due_at,priority,status,created_at,updated_at) VALUES ('notice-task','org-northstar','Call back','membership-northstar-member','2026-01-15T11:00:00.000Z','high','open','2026-01-01T00:00:00.000Z','2026-01-01T00:00:00.000Z')",
    ).run();
    const service = new NotificationService(db, () => new Date('2026-01-15T12:00:00.000Z'));
    assert.equal(service.generate('org-northstar').created, 1);
    assert.equal(service.generate('org-northstar').created, 0);
    const actor = {
        organizationId: 'org-northstar',
        membershipId: 'membership-northstar-member',
        role: 'member' as const,
      },
      list = service.list(actor, true);
    assert.equal(list.length, 1);
    service.markRead(actor, (list[0] as unknown as { id: string }).id);
    assert.equal(service.list(actor, true).length, 0);
    assert.throws(
      () =>
        service.markRead(
          { ...actor, membershipId: 'membership-northstar-owner' },
          (list[0] as unknown as { id: string }).id,
        ),
      NotificationError,
    );
  } finally {
    db.close();
  }
});
