import assert from 'node:assert/strict';
import test from 'node:test';
import { ActivityError, ActivityService } from './activities.js';
import { openDatabase, resetDatabase, seedDatabase } from './database.js';

const actor = {
  organizationId: 'org-northstar',
  membershipId: 'membership-northstar-member',
  role: 'member' as const,
};
test('activity timeline retains snapshots and atomically creates linked follow-up work', () => {
  resetDatabase();
  seedDatabase();
  const db = openDatabase();
  try {
    db.prepare(
      "INSERT INTO companies (id,organization_id,name,owner_membership_id,created_at,updated_at) VALUES ('timeline-company','org-northstar','Timeline Co','membership-northstar-member','2026-03-01T00:00:00.000Z','2026-03-01T00:00:00.000Z')",
    ).run();
    db.prepare(
      "INSERT INTO contacts (id,organization_id,first_name,last_name,owner_membership_id,company_id,created_at,updated_at) VALUES ('timeline-contact','org-northstar','Pat','Customer','membership-northstar-member','timeline-company','2026-03-01T00:00:00.000Z','2026-03-01T00:00:00.000Z')",
    ).run();
    const service = new ActivityService(db, () => '2026-03-01T10:00:00.000Z');
    const activity = service.create(actor, {
      type: 'call',
      subject: 'Renewal call',
      body: 'Discussed renewal.',
      occurredAt: '2026-03-01T09:00:00.000Z',
      companyId: 'timeline-company',
      contactId: 'timeline-contact',
      participants: ['Pat Customer'],
      followUp: { title: 'Send renewal quote', priority: 'high' },
    }) as {
      id: string;
      follow_up_task_id: string;
      company_label_snapshot: string;
      creator_label_snapshot: string;
    };
    assert.ok(activity.follow_up_task_id);
    assert.equal(activity.company_label_snapshot, 'Timeline Co');
    assert.equal(activity.creator_label_snapshot, 'member@northstar.test');
    assert.equal(service.list(actor, { type: 'call' }).items.length, 1);
    const updated = service.update(actor, activity.id, {
      type: 'meeting',
      subject: 'Renewal meeting',
      body: 'Updated notes.',
      occurredAt: '2026-03-01T09:30:00.000Z',
      companyId: 'timeline-company',
      contactId: 'timeline-contact',
      participants: ['Pat Customer'],
    }) as { subject: string; type: string };
    assert.equal(updated.subject, 'Renewal meeting');
    assert.equal(updated.type, 'meeting');
    assert.throws(
      () =>
        service.update({ ...actor, organizationId: 'org-outside' }, activity.id, {
          type: 'note',
          subject: 'No',
          occurredAt: '2026-03-01T09:00:00.000Z',
        }),
      ActivityError,
    );
    assert.throws(
      () =>
        service.create(
          { ...actor, role: 'viewer' },
          { type: 'note', subject: 'No', occurredAt: '2026-03-01T09:00:00.000Z' },
        ),
      ActivityError,
    );
    assert.throws(
      () => service.get({ ...actor, organizationId: 'org-outside' }, activity.id),
      ActivityError,
    );
  } finally {
    db.close();
  }
});
