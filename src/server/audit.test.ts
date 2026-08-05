import assert from 'node:assert/strict';
import test from 'node:test';
import { appendAudit, AuditError, listAudit, type AuditActor } from './audit.js';
import { openDatabase, resetDatabase, seedDatabase } from './database.js';

test('audit is owner-scoped, paginated, and removes sensitive summary fields', () => {
  resetDatabase();
  seedDatabase();
  const db = openDatabase();
  try {
    const owner: AuditActor = {
      organizationId: 'org-northstar',
      membershipId: 'membership-northstar-owner',
      role: 'owner',
    };
    appendAudit(
      db,
      owner,
      'member.invited',
      'membership',
      'member-2',
      { email: 'new@test', password: 'never-record', token: 'never-record', values: ['a', 'b'] },
      'request-1',
    );
    const result = listAudit(db, owner, new URLSearchParams('action=member.invited&pageSize=1'));
    assert.equal(result.total, 1);
    assert.deepEqual((result.items[0] as { summary: { changes: unknown } }).summary.changes, {
      email: 'new@test',
      values: { itemCount: 2 },
    });
    assert.throws(
      () => listAudit(db, { ...owner, role: 'member' }, new URLSearchParams()),
      AuditError,
    );
  } finally {
    db.close();
  }
});
