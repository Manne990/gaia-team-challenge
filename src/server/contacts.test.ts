import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
// The migration and seed utilities are JavaScript runtime modules shared by all feature services.
// @ts-expect-error JavaScript module declarations are intentionally deferred to the data layer.
import { ensureDatabase } from '../db/database.mjs';
// @ts-expect-error JavaScript module declarations are intentionally deferred to the data layer.
import { seedDatabase } from '../db/seed.mjs';
import { ContactError, ContactService } from './contacts.js';
import { handleContactRequest } from './contacts-routes.js';

const actor = {
  organizationId: 'org-northstar',
  membershipId: 'membership-northstar-member',
  role: 'member' as const,
};
function fixture() {
  const directory = mkdtempSync(join(tmpdir(), 'northstar-contacts-'));
  const db = ensureDatabase(join(directory, 'crm.sqlite'));
  seedDatabase(db);
  return {
    db,
    done: () => {
      db.close();
      rmSync(directory, { recursive: true, force: true });
    },
  };
}
const input = {
  firstName: ' Ada ',
  lastName: ' Lovelace ',
  email: ' ADA@EXAMPLE.TEST ',
  phone: '555-0100',
  jobTitle: 'Engineer',
  ownerMembershipId: actor.membershipId,
  status: 'active' as const,
  tags: ['VIP', 'vip'],
  communicationPreference: 'email' as const,
  companyId: 'company-northstar-1',
};

test('contacts normalize, filter, retain history, and support archive restoration', () => {
  const { db, done } = fixture();
  const service = new ContactService(db, () => '2026-08-05T12:00:00.000Z');
  const created = service.create(actor, input);
  assert.equal(created.email, 'ada@example.test');
  assert.deepEqual(created.tags, ['vip']);
  assert.equal(service.list(actor, { text: 'ada', tag: 'VIP' }).total, 1);
  const updated = service.update(
    actor,
    created.id,
    { ...input, firstName: 'Ada', tags: ['priority'] },
    created.version,
  );
  const archived = service.archive(actor, created.id, updated.version);
  assert.equal(service.list(actor, { text: 'ada' }).total, 0);
  const restored = service.restore(actor, created.id, archived.version);
  assert.equal(restored.archivedAt, null);
  assert.deepEqual(
    service.get(actor, created.id).history.map((item) => item.action),
    ['restored', 'archived', 'updated', 'created'],
  );
  done();
});
test('contacts isolate organizations, enforce roles, and reject conflicts and foreign relationships', () => {
  const { db, done } = fixture();
  const service = new ContactService(db);
  const created = service.create(actor, input);
  assert.throws(
    () => service.get({ ...actor, organizationId: 'org-outside' }, created.id),
    (error: unknown) => error instanceof ContactError && error.code === 'NOT_FOUND',
  );
  assert.throws(
    () => service.create({ ...actor, role: 'viewer' }, input),
    (error: unknown) => error instanceof ContactError && error.code === 'FORBIDDEN',
  );
  assert.throws(
    () =>
      service.create(actor, { ...input, email: 'duplicate@test', companyId: 'company-outside-1' }),
    (error: unknown) => error instanceof ContactError && error.code === 'VALIDATION',
  );
  assert.throws(
    () => service.update(actor, created.id, input, 99),
    (error: unknown) => error instanceof ContactError && error.code === 'CONFLICT',
  );
  done();
});

test('contact HTTP adapter returns deliberate authorization, validation, and mutation responses', async () => {
  const { db, done } = fixture();
  const service = new ContactService(db);
  const unauthenticated = await handleContactRequest(
    new Request('http://crm.test/api/contacts'),
    null,
    service,
  );
  assert.equal(unauthenticated?.status, 401);
  const invalid = await handleContactRequest(
    new Request('http://crm.test/api/contacts', { method: 'POST', body: '{}' }),
    actor,
    service,
  );
  assert.equal(invalid?.status, 422);
  const created = await handleContactRequest(
    new Request('http://crm.test/api/contacts', { method: 'POST', body: JSON.stringify(input) }),
    actor,
    service,
  );
  assert.equal(created?.status, 201);
  const value = (await created?.json()) as { id: string; version: number };
  const listed = await handleContactRequest(
    new Request('http://crm.test/api/contacts?text=ada&tag=vip'),
    actor,
    service,
  );
  assert.equal(((await listed?.json()) as { total: number }).total, 1);
  const archived = await handleContactRequest(
    new Request(`http://crm.test/api/contacts/${value.id}/archive`, {
      method: 'POST',
      body: JSON.stringify({ version: value.version }),
    }),
    actor,
    service,
  );
  assert.equal(archived?.status, 200);
  done();
});
