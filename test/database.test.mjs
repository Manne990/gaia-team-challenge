import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { ensureDatabase } from '../src/db/database.mjs';
import { seedDatabase } from '../src/db/seed.mjs';

function temporaryDatabase() {
  const directory = mkdtempSync(join(tmpdir(), 'northstar-db-'));
  return { directory, path: join(directory, 'crm.sqlite') };
}

test('migrations create the full relational model in an isolated database', () => {
  const temp = temporaryDatabase();
  try {
    const db = ensureDatabase(temp.path);
    const names = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
      .all()
      .map(({ name }) => name);
    for (const name of [
      'organizations',
      'users',
      'memberships',
      'sessions',
      'companies',
      'contacts',
      'activities',
      'pipeline_stages',
      'deals',
      'tasks',
      'notifications',
      'saved_views',
      'imports',
      'merge_redirects',
      'audit_events',
    ])
      assert.ok(names.includes(name), `missing ${name}`);
    assert.equal(db.prepare('PRAGMA foreign_keys').pluck().get(), 1);
    db.close();
  } finally {
    rmSync(temp.directory, { recursive: true, force: true });
  }
});

test('seed is deterministic, idempotent, and survives reopening the database', () => {
  const temp = temporaryDatabase();
  try {
    let db = ensureDatabase(temp.path);
    seedDatabase(db);
    const counts = () =>
      db
        .prepare(
          'SELECT (SELECT count(*) FROM organizations) organizations, (SELECT count(*) FROM users) users, (SELECT count(*) FROM companies) companies, (SELECT count(*) FROM contacts) contacts, (SELECT count(*) FROM deals) deals, (SELECT count(*) FROM tasks) tasks',
        )
        .get();
    const firstCounts = counts();
    seedDatabase(db);
    assert.deepEqual(counts(), firstCounts);
    assert.equal(firstCounts.organizations, 2);
    assert.equal(firstCounts.users, 4);
    assert.equal(
      db
        .prepare(
          "SELECT count(*) FROM users WHERE email IN ('owner@northstar.test', 'member@northstar.test', 'viewer@northstar.test', 'other-owner@outside.test')",
        )
        .pluck()
        .get(),
      4,
    );
    assert.match(
      db.prepare("SELECT password_hash FROM users WHERE id = 'user-owner'").pluck().get(),
      /^\$2[aby]\$/,
    );
    assert.ok(firstCounts.companies >= 16);
    assert.ok(firstCounts.contacts >= 15);
    db.close();
    db = ensureDatabase(temp.path);
    assert.equal(
      db
        .prepare("SELECT count(*) FROM companies WHERE organization_id = 'org-northstar'")
        .pluck()
        .get(),
      15,
    );
    db.close();
  } finally {
    rmSync(temp.directory, { recursive: true, force: true });
  }
});

test('audit events are database-enforced append-only records', () => {
  const db = ensureDatabase(':memory:');
  try {
    seedDatabase(db);
    assert.throws(
      () => db.prepare("UPDATE audit_events SET action = 'tampered' WHERE id = 'audit-seed'").run(),
      /append-only/,
    );
    assert.throws(
      () => db.prepare("DELETE FROM audit_events WHERE id = 'audit-seed'").run(),
      /append-only/,
    );
  } finally {
    db.close();
  }
});

test('organization-scoped foreign keys reject cross-organization relationships', () => {
  const db = ensureDatabase(':memory:');
  try {
    seedDatabase(db);
    assert.throws(
      () =>
        db
          .prepare(
            "INSERT INTO contacts (id, organization_id, first_name, last_name, owner_membership_id, company_id, created_at, updated_at) VALUES ('bad-contact', 'org-northstar', 'Bad', 'Reference', 'membership-northstar-owner', 'company-outside-1', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')",
          )
          .run(),
      /FOREIGN KEY/,
    );
  } finally {
    db.close();
  }
});

test('transactions roll back atomically after constraint failures', () => {
  const db = ensureDatabase(':memory:');
  try {
    seedDatabase(db);
    const createPair = db.transaction(() => {
      db.prepare(
        "INSERT INTO companies (id, organization_id, name, owner_membership_id, created_at, updated_at) VALUES ('rollback-company', 'org-northstar', 'Rollback Co', 'membership-northstar-owner', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')",
      ).run();
      db.prepare(
        "INSERT INTO contacts (id, organization_id, first_name, last_name, owner_membership_id, company_id, created_at, updated_at) VALUES ('rollback-contact', 'org-northstar', 'Rollback', 'Contact', 'membership-northstar-owner', 'company-outside-1', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')",
      ).run();
    });
    assert.throws(createPair, /FOREIGN KEY/);
    assert.equal(
      db.prepare("SELECT count(*) FROM companies WHERE id = 'rollback-company'").pluck().get(),
      0,
    );
  } finally {
    db.close();
  }
});
