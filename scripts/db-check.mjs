import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDatabase, resetAndSeed, seedDatabase } from '../src/db/database.mjs';

const folder = mkdtempSync(join(tmpdir(), 'northstar-db-'));
const filename = join(folder, 'crm.sqlite');
try {
  let db = resetAndSeed(filename);
  assert.equal(db.prepare('SELECT count(*) AS total FROM users').get().total, 4);
  assert.equal(
    db
      .prepare('SELECT count(*) AS total FROM companies WHERE organization_id = ?')
      .get('org_northstar').total,
    5,
  );
  seedDatabase(db);
  assert.equal(
    db.prepare('SELECT count(*) AS total FROM users').get().total,
    4,
    'seed must be idempotent',
  );
  assert.throws(() =>
    db
      .prepare(
        'INSERT INTO contacts (id, organization_id, company_id, first_name, last_name, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      )
      .run(
        'bad',
        'org_outside',
        'co_acme',
        'No',
        'Leak',
        '2026-01-01T00:00:00.000Z',
        '2026-01-01T00:00:00.000Z',
      ),
  );
  assert.throws(() =>
    db
      .prepare(
        'INSERT INTO companies (id, organization_id, name, owner_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
      )
      .run(
        'bad-owner',
        'org_northstar',
        'Bad Owner',
        'usr_outside',
        '2026-01-01T00:00:00.000Z',
        '2026-01-01T00:00:00.000Z',
      ),
  );
  db.prepare(
    'INSERT INTO audit_events (id, organization_id, action, entity_type, entity_id, summary_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
  ).run(
    'audit_test',
    'org_northstar',
    'created',
    'company',
    'co_acme',
    '{}',
    '2026-01-15T12:00:00.000Z',
  );
  assert.throws(() => db.prepare('DELETE FROM audit_events WHERE id = ?').run('audit_test'));
  db.exec('BEGIN');
  db.prepare(
    'INSERT INTO organizations (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)',
  ).run('rollback_org', 'Rollback', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');
  db.exec('ROLLBACK');
  assert.equal(
    db.prepare("SELECT count(*) AS total FROM organizations WHERE id = 'rollback_org'").get().total,
    0,
  );
  db.close();
  db = openDatabase(filename);
  assert.equal(
    db.prepare("SELECT email FROM users WHERE id = 'usr_owner'").get().email,
    'owner@northstar.test',
    'data must survive reopen',
  );
  db.close();
  console.log('database checks: PASS');
} finally {
  rmSync(folder, { recursive: true, force: true });
}
