import { describe, expect, it } from 'vitest';
import { createProductFixtures } from '../fixtures/product-fixtures.mjs';

describe('deterministic product fixtures', () => {
  it('models isolated organizations, every role, historical work, and list volume', () => {
    const fixtures = createProductFixtures();
    expect(fixtures.organizations).toHaveLength(2);
    expect(fixtures.users.map((user) => user.role)).toEqual(['owner', 'member', 'viewer', 'owner']);
    expect(
      fixtures.companies.filter((company) => company.organizationId === 'org_northstar_demo'),
    ).toHaveLength(27);
    expect(fixtures.companies.filter((company) => company.name === 'Acme Holdings')).toHaveLength(
      3,
    );
    expect(fixtures.activities.map((activity) => activity.occurredAt)).toContain(
      '2024-01-15T10:00:00.000Z',
    );
    expect(new Set(fixtures.deals.map((deal) => deal.stage)).size).toBeGreaterThan(1);
    expect(fixtures.tasks.map((task) => task.id)).toEqual(['task_overdue', 'task_upcoming']);
  });

  it('returns a fresh fixture graph on every call', () => {
    const first = createProductFixtures();
    createProductFixtures().companies[0].name = 'Changed by a test';
    expect(first.companies[0].name).toBe('Acme Holdings');
  });
});
