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
    30,
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
  db.prepare(
    'INSERT INTO companies (id, organization_id, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
  ).run(
    'co_redirect_source',
    'org_northstar',
    'Redirect source',
    '2026-01-15T12:00:00.000Z',
    '2026-01-15T12:00:00.000Z',
  );
  db.prepare(
    'INSERT INTO companies (id, organization_id, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
  ).run(
    'co_redirect_target',
    'org_northstar',
    'Redirect target',
    '2026-01-15T12:00:00.000Z',
    '2026-01-15T12:00:00.000Z',
  );
  db.prepare(
    'INSERT INTO merge_redirects (id, organization_id, resource, source_id, target_id, created_at) VALUES (?, ?, ?, ?, ?, ?)',
  ).run(
    'redirect_delete_target',
    'org_northstar',
    'companies',
    'co_redirect_source',
    'co_redirect_target',
    '2026-01-15T12:00:00.000Z',
  );
  assert.throws(() => db.prepare('DELETE FROM companies WHERE id = ?').run('co_redirect_target'));
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
    'INSERT INTO sessions (id, user_id, organization_id, token_hash, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?)',
  ).run(
    'session_test',
    'usr_owner',
    'org_northstar',
    'test-token',
    '2026-02-01T00:00:00.000Z',
    '2026-01-01T00:00:00.000Z',
  );
  assert.throws(() =>
    db
      .prepare('UPDATE sessions SET organization_id = ? WHERE id = ?')
      .run('org_outside', 'session_test'),
  );
  assert.throws(() =>
    db
      .prepare('UPDATE companies SET organization_id = ? WHERE id = ?')
      .run('org_outside', 'co_acme'),
  );
  assert.throws(() =>
    db
      .prepare(
        'INSERT INTO deals (id, organization_id, company_id, stage_id, name, amount_cents, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      )
      .run(
        'bad-deal-status',
        'org_northstar',
        'co_acme',
        'stage_qualified',
        'Impossible won deal',
        10000,
        'won',
        '2026-01-15T12:00:00.000Z',
        '2026-01-15T12:00:00.000Z',
      ),
  );
  assert.throws(() =>
    db
      .prepare('UPDATE deals SET stage_id = ?, status = ? WHERE id = ?')
      .run('stage_lost', 'open', 'deal_acme'),
  );
  assert.throws(() =>
    db
      .prepare(
        'INSERT INTO deal_stage_history (id, organization_id, deal_id, from_stage_id, to_stage_id, changed_at) VALUES (?, ?, ?, ?, ?, ?)',
      )
      .run(
        'bad-history',
        'org_northstar',
        'deal_acme',
        'stage_missing',
        'stage_won',
        '2026-01-15T12:00:00.000Z',
      ),
  );
  assert.throws(() => db.prepare('DELETE FROM memberships WHERE id = ?').run('mem_owner'));
  assert.throws(() =>
    db
      .prepare(
        'INSERT INTO merge_redirects (id, organization_id, resource, source_id, target_id, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      )
      .run(
        'bad-merge',
        'org_northstar',
        'companies',
        'co_acme',
        'co_outside',
        '2026-01-15T12:00:00.000Z',
      ),
  );
  assert.throws(() =>
    db
      .prepare(
        'INSERT INTO saved_views (id, organization_id, user_id, resource, name, filters_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      )
      .run(
        'bad-view',
        'org_outside',
        'usr_owner',
        'companies',
        'Cross tenant',
        '{}',
        '2026-01-01T00:00:00.000Z',
        '2026-01-01T00:00:00.000Z',
      ),
  );
  assert.throws(() =>
    db
      .prepare(
        'INSERT INTO notifications (id, organization_id, user_id, type, dedupe_key, payload_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      )
      .run(
        'bad-note',
        'org_northstar',
        'usr_outside',
        'deal_changed',
        'cross',
        '{}',
        '2026-01-01T00:00:00.000Z',
      ),
  );
  assert.throws(() =>
    db.prepare('UPDATE activities SET creator_id = ? WHERE id = ?').run('usr_outside', 'act_1'),
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
