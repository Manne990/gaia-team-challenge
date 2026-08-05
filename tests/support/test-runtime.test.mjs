import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, writeFileSync } from 'node:fs';
import { createCrmFixtures } from '../fixtures/crm-fixtures.mjs';
import { createTestRuntime, expectDeniedWithoutSideEffects } from './test-runtime.mjs';

test('test runtime allocates isolated temporary databases and cleans them', async () => {
  const first = await createTestRuntime('isolation');
  const second = await createTestRuntime('isolation');
  try {
    assert.notEqual(first.root, second.root);
    assert.notEqual(first.port, second.port);
    writeFileSync(first.databasePath, 'temporary database');
    assert.equal(existsSync(first.databasePath), true);
  } finally {
    first.dispose();
    second.dispose();
  }
  assert.equal(existsSync(first.root), false);
  assert.equal(existsSync(second.root), false);
});

test('denied foreign mutations preserve persisted state', async () => {
  const fixtures = createCrmFixtures();
  const persisted = { companies: fixtures.companies.map((company) => ({ ...company })) };
  await expectDeniedWithoutSideEffects({
    snapshot: () => persisted,
    attempt: async () => ({ status: 404, body: { error: 'not_found' } }),
  });
  assert.equal(
    persisted.companies.find((company) => company.id === 'cmp_outside_01').name,
    'Acme Corporation',
  );
});
