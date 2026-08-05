import assert from 'node:assert/strict';
import test from 'node:test';
// @ts-expect-error JS module
import { ensureDatabase } from '../db/database.mjs';
// @ts-expect-error JS module
import { seedDatabase } from '../db/seed.mjs';
import { SearchError, SearchService } from './search.js';
const actor = {
  organizationId: 'org-northstar',
  membershipId: 'membership-northstar-owner',
  role: 'owner' as const,
};
test('search is grouped, stable, scoped, and views remain personal', () => {
  const db = ensureDatabase(':memory:');
  try {
    seedDatabase(db);
    const service = new SearchService(db, () => '2026-08-05T00:00:00.000Z');
    const results = service.search(actor, 'Northstar');
    assert.ok(results.companies.length);
    assert.ok(results.contacts.length);
    assert.equal(
      service.search({ ...actor, organizationId: 'org-outside' }, 'Northstar').companies.length,
      0,
    );
    const page = service.list(actor, 'companies', { text: 'Northstar', pageSize: 2 });
    assert.equal(page.items.length, 2);
    const view = service.save(actor, {
      name: 'Priority accounts',
      resource: 'companies',
      query: { text: 'Northstar' },
    }) as unknown as { id: string; version: number };
    assert.equal(service.views(actor).length, 1);
    assert.throws(
      () => service.getView({ ...actor, membershipId: 'membership-northstar-member' }, view.id),
      SearchError,
    );
    service.save(actor, { ...view, name: 'Renamed', resource: 'companies', query: {} });
    service.remove(actor, view.id);
    assert.equal(service.views(actor).length, 0);
  } finally {
    db.close();
  }
});
