import test from 'node:test';
import assert from 'node:assert/strict';
import { createCrmFixtures } from './crm-fixtures.mjs';

test('CRM fixtures contain the required deterministic coverage', () => {
  const fixtures = createCrmFixtures();
  assert.equal(fixtures.organizations.length, 2);
  assert.deepEqual(
    fixtures.users
      .filter((user) => user.organizationId === 'org_northstar_demo')
      .map((user) => user.role),
    ['owner', 'member', 'viewer'],
  );
  assert.ok(
    fixtures.companies.filter((company) => company.name === 'Acme Corporation').length >= 3,
  );
  assert.ok(fixtures.companies.length > 25, 'fixture volume exercises pagination');
  assert.ok(fixtures.activities.some((activity) => activity.occurredAt < '2026-01-01'));
  assert.equal(
    new Set(fixtures.stages.map((stage) => stage.position)).size,
    fixtures.stages.length,
  );
  assert.ok(fixtures.tasks.some((task) => task.dueAt < fixtures.clock));
  assert.ok(fixtures.tasks.some((task) => task.dueAt > fixtures.clock));
});
