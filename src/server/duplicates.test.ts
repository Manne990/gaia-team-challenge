import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
// @ts-expect-error shared JavaScript database utility
import { ensureDatabase } from '../db/database.mjs';
// @ts-expect-error shared JavaScript seed utility
import { seedDatabase } from '../db/seed.mjs';
import { DuplicateError, DuplicateService } from './duplicates.js';
const actor = {
  organizationId: 'org-northstar',
  membershipId: 'membership-northstar-owner',
  role: 'owner' as const,
};
function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'northstar-merge-'));
  const db = ensureDatabase(join(dir, 'crm.sqlite'));
  seedDatabase(db);
  return {
    db,
    done: () => {
      db.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}
function insertContact(
  db: { prepare(sql: string): { run(...values: unknown[]): unknown } },
  id: string,
  email: string,
  first = 'Avery',
) {
  db.prepare(
    "INSERT INTO contacts (id,organization_id,first_name,last_name,email,owner_membership_id,company_id,created_at,updated_at) VALUES (?, 'org-northstar', ?, 'Stone', ?, 'membership-northstar-owner', 'company-northstar-1', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')",
  ).run(id, first, email);
}
test('suggestions explain normalized facts and contact merge preserves relations with redirects', () => {
  const { db, done } = fixture();
  insertContact(db, 'merge-a', 'avery@acme.test');
  insertContact(db, 'merge-b', 'AVERY@ACME.TEST', 'Avery');
  db.prepare("UPDATE contacts SET email='avery+old@acme.test' WHERE id='merge-b'").run();
  db.prepare(
    "INSERT INTO deal_contacts (organization_id,deal_id,contact_id,created_at) VALUES ('org-northstar','deal-northstar-1','merge-a','2026-01-01T00:00:00.000Z')",
  ).run();
  db.prepare("UPDATE activities SET contact_id='merge-b' WHERE id='activity-northstar-1'").run();
  const service = new DuplicateService(db, () => '2026-08-05T12:00:00.000Z');
  assert.ok(service.candidates(actor, 'contact', 'merge-a').some((item) => item.id === 'merge-b'));
  const survivor = db.prepare("SELECT version FROM contacts WHERE id='merge-a'").get() as {
    version: number;
  };
  const result = service.merge(actor, {
    resource: 'contact',
    survivorId: 'merge-a',
    retiredId: 'merge-b',
    survivorVersion: survivor.version,
    resolvedFields: { email: 'avery@acme.test' },
  });
  assert.equal(result.resolvedId, 'merge-a');
  assert.equal(
    (
      db.prepare("SELECT contact_id FROM activities WHERE id='activity-northstar-1'").get() as {
        contact_id: string;
      }
    ).contact_id,
    'merge-a',
  );
  assert.equal(
    (
      db
        .prepare(
          "SELECT count(*) AS count FROM deal_contacts WHERE deal_id='deal-northstar-1' AND contact_id='merge-a'",
        )
        .get() as { count: number }
    ).count,
    1,
  );
  assert.equal(
    (
      db.prepare("SELECT archived_at FROM contacts WHERE id='merge-b'").get() as {
        archived_at: string;
      }
    ).archived_at,
    '2026-08-05T12:00:00.000Z',
  );
  done();
});
test('merge rejects foreign, stale, incomplete, and replayed decisions without crossing organization state', () => {
  const { db, done } = fixture();
  insertContact(db, 'merge-c', 'c@acme.test', 'Chris');
  insertContact(db, 'merge-d', 'd@acme.test', 'Dana');
  const service = new DuplicateService(db);
  const version = (
    db.prepare("SELECT version FROM contacts WHERE id='merge-c'").get() as { version: number }
  ).version;
  assert.throws(
    () =>
      service.merge(actor, {
        resource: 'contact',
        survivorId: 'merge-c',
        retiredId: 'merge-d',
        survivorVersion: version,
        resolvedFields: {},
      }),
    (error: unknown) => error instanceof DuplicateError && error.code === 'VALIDATION',
  );
  assert.throws(
    () =>
      service.merge(
        { ...actor, organizationId: 'org-outside' },
        {
          resource: 'contact',
          survivorId: 'merge-c',
          retiredId: 'merge-d',
          survivorVersion: version,
          resolvedFields: { first_name: 'Chris', email: 'c@acme.test' },
        },
      ),
    (error: unknown) => error instanceof DuplicateError && error.code === 'NOT_FOUND',
  );
  const merged = service.merge(actor, {
    resource: 'contact',
    survivorId: 'merge-c',
    retiredId: 'merge-d',
    survivorVersion: version,
    resolvedFields: { first_name: 'Chris', email: 'c@acme.test' },
  });
  assert.equal(merged.resolvedId, 'merge-c');
  assert.throws(
    () =>
      service.merge(actor, {
        resource: 'contact',
        survivorId: 'merge-c',
        retiredId: 'merge-d',
        survivorVersion: version + 1,
        resolvedFields: { first_name: 'Chris', email: 'c@acme.test' },
      }),
    (error: unknown) => error instanceof DuplicateError && error.code === 'CONFLICT',
  );
  done();
});
