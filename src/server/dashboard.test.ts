import assert from 'node:assert/strict';
import test from 'node:test';
// @ts-expect-error JS module
import { ensureDatabase } from '../db/database.mjs';
// @ts-expect-error JS module
import { seedDatabase } from '../db/seed.mjs';
import { dashboard } from './dashboard.js';
test('dashboard aggregates are organization-scoped and date-boundary explicit', () => {
  const db = ensureDatabase(':memory:');
  try {
    seedDatabase(db);
    const result = dashboard(
      db,
      {
        organizationId: 'org-northstar',
        membershipId: 'membership-northstar-owner',
        role: 'owner',
      },
      '2026-01-15T12:00:00.000Z',
    );
    assert.ok(result.openPipeline.amountMinor > 0);
    assert.ok(result.stageDistribution.length);
    assert.ok(result.recentActivity.length);
    const outside = dashboard(
      db,
      { organizationId: 'org-outside', membershipId: 'membership-outside-owner', role: 'owner' },
      '2026-01-15T12:00:00.000Z',
    );
    assert.equal(outside.openPipeline.count, 0);
    assert.equal(outside.recentActivity.length, 0);
  } finally {
    db.close();
  }
});
