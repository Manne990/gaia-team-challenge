import assert from 'node:assert/strict';
import test from 'node:test';
// @ts-expect-error JavaScript data-layer module.
import { ensureDatabase } from '../db/database.mjs';
// @ts-expect-error JavaScript data-layer module.
import { seedDatabase } from '../db/seed.mjs';
import { DealError, DealService } from './deals.js';

const actor = {
  organizationId: 'org-northstar',
  membershipId: 'membership-northstar-owner',
  role: 'owner' as const,
};
function fixture() {
  const db = ensureDatabase(':memory:');
  seedDatabase(db);
  return { db, service: new DealService(db, () => '2026-08-05T12:00:00.000Z') };
}
const input = {
  name: 'Expansion',
  companyId: 'company-northstar-1',
  ownerMembershipId: actor.membershipId,
  amountMinor: 125000,
  currency: 'usd',
  expectedCloseDate: '2026-09-01',
  probability: 35,
  stageId: 'stage-qualified',
  contactIds: ['contact-northstar-1'],
};
test('deals enforce organization relationships, outcomes, transitions, history, and concurrency', () => {
  const { db, service } = fixture();
  try {
    const created = service.create(actor, input) as unknown as {
      id: string;
      version: number;
      status: string;
      currency: string;
      history: unknown[];
    };
    assert.equal(created.currency, 'USD');
    assert.equal(created.status, 'open');
    assert.equal(created.history.length, 1);
    const won = service.transition(actor, created.id, created.version, 'stage-won') as unknown as {
      version: number;
      status: string;
      probability: number;
      history: unknown[];
    };
    assert.equal(won.status, 'won');
    assert.equal(won.probability, 100);
    assert.equal(won.history.length, 2);
    assert.throws(
      () => service.transition(actor, created.id, created.version, 'stage-qualified'),
      (error: unknown) => error instanceof DealError && error.code === 'CONFLICT',
    );
    assert.throws(
      () => service.transition(actor, created.id, won.version, 'stage-lost'),
      (error: unknown) => error instanceof DealError && error.code === 'VALIDATION',
    );
    const lost = service.transition(
      actor,
      created.id,
      won.version,
      'stage-lost',
      'Budget withdrawn',
    ) as unknown as { status: string; loss_reason: string };
    assert.equal(lost.status, 'lost');
    assert.equal(lost.loss_reason, 'Budget withdrawn');
    assert.throws(
      () => service.create({ ...actor, organizationId: 'org-outside' }, input),
      DealError,
    );
  } finally {
    db.close();
  }
});
test('pipeline totals and owner-only stage configuration are scoped and retain historical deals', () => {
  const { db, service } = fixture();
  try {
    const created = service.create(actor, input) as unknown as { id: string; version: number };
    const pipeline = service.list(actor);
    assert.ok(
      (pipeline.totals as { amountMinor: number }[]).some((item) => item.amountMinor >= 125000),
    );
    const closingSoon = service.list(actor, { closingSoon: true }) as unknown as {
      items: Array<{ expected_close_date: string }>;
    };
    assert.equal(
      closingSoon.items.every(
        (deal) =>
          deal.expected_close_date >= '2026-08-05' && deal.expected_close_date < '2026-08-12',
      ),
      true,
    );
    assert.throws(
      () =>
        service.configureStage(
          { ...actor, role: 'member' },
          { name: 'Review', position: 10, category: 'open' },
        ),
      DealError,
    );
    const configured = service.configureStage(actor, {
      name: 'Review',
      position: 10,
      category: 'open',
    }) as unknown as { id: string; version: number };
    service.configureStage(actor, {
      ...configured,
      name: 'Review',
      position: 10,
      category: 'open',
      isActive: false,
    });
    assert.equal(
      (
        service.archive(actor, created.id, created.version) as unknown as {
          archived_at: string | null;
        }
      ).archived_at !== null,
      true,
    );
  } finally {
    db.close();
  }
});
