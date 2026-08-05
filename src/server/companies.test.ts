import assert from 'node:assert/strict';
import test from 'node:test';
import {
  archiveCompany,
  CompanyError,
  createCompany,
  getCompany,
  listCompanies,
  updateCompany,
} from './companies.js';
import { openDatabase, resetDatabase, seedDatabase } from './database.js';

test('companies create, filter, conflict, archive, restore, and enforce optimistic concurrency', () => {
  resetDatabase();
  seedDatabase();
  const db = openDatabase();
  try {
    const company = createCompany(db, 'org-northstar', 'membership-northstar-owner', {
      name: 'Aster Labs',
      externalReference: 'ASTER-1',
      lifecycleStatus: 'prospect',
      tags: ['priority'],
    }) as { id: string; version: number };
    assert.equal(listCompanies(db, 'org-northstar', new URLSearchParams('q=Aster')).total, 1);
    assert.throws(
      () =>
        createCompany(db, 'org-northstar', 'membership-northstar-owner', {
          name: 'Copy',
          externalReference: 'ASTER-1',
        }),
      CompanyError,
    );
    assert.throws(() => getCompany(db, 'org-outside', company.id), CompanyError);
    const changed = updateCompany(
      db,
      'org-northstar',
      company.id,
      { name: 'Aster Labs', lifecycleStatus: 'customer', tags: [] },
      company.version,
    ) as { version: number };
    assert.throws(
      () =>
        updateCompany(db, 'org-northstar', company.id, { name: 'Old version' }, company.version),
      CompanyError,
    );
    archiveCompany(db, 'org-northstar', company.id);
    assert.equal(listCompanies(db, 'org-northstar', new URLSearchParams('q=Aster')).total, 0);
    archiveCompany(db, 'org-northstar', company.id, true);
    assert.equal(getCompany(db, 'org-northstar', company.id).company !== null, true);
    assert.equal(changed.version, 2);
  } finally {
    db.close();
  }
});
