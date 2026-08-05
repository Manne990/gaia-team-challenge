import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { dirname } from 'node:path';
import Database from 'better-sqlite3';
import { hashSync } from 'bcryptjs';
import { config } from './config.js';
const migrations = [
  'CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);',
  'CREATE TABLE IF NOT EXISTS organizations (id TEXT PRIMARY KEY, name TEXT NOT NULL, created_at TEXT NOT NULL);',
  "CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, organization_id TEXT NOT NULL REFERENCES organizations(id), email TEXT NOT NULL, password_hash TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('owner', 'member', 'viewer')), created_at TEXT NOT NULL, UNIQUE(organization_id, email));",
];
export function openDatabase(): Database.Database {
  mkdirSync(dirname(config.databasePath), { recursive: true });
  const database = new Database(config.databasePath);
  database.pragma('foreign_keys = ON');
  database.pragma('journal_mode = WAL');
  migrations.forEach((sql, index) => {
    const version = index + 1;
    database.exec(sql);
    if (!database.prepare('SELECT 1 FROM schema_migrations WHERE version = ?').get(version)) {
      database
        .prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)')
        .run(version, new Date().toISOString());
    }
  });
  return database;
}
export function resetDatabase(): void {
  if (existsSync(config.databasePath)) rmSync(config.databasePath);
  for (const suffix of ['-wal', '-shm'])
    if (existsSync(`${config.databasePath}${suffix}`)) rmSync(`${config.databasePath}${suffix}`);
  openDatabase().close();
}
export function seedDatabase(): void {
  const database = openDatabase();
  const now = '2026-01-15T12:00:00.000Z';
  const organization = database.prepare(
    'INSERT OR IGNORE INTO organizations (id, name, created_at) VALUES (?, ?, ?)',
  );
  const user = database.prepare(
    'INSERT OR IGNORE INTO users (id, organization_id, email, password_hash, role, created_at) VALUES (?, ?, ?, ?, ?, ?)',
  );
  database.transaction(() => {
    organization.run('org_northstar_demo', 'Northstar Demo', now);
    organization.run('org_outside_demo', 'Outside Demo', now);
    [
      ['user_owner', 'org_northstar_demo', 'owner@northstar.test', 'OwnerPass!2026', 'owner'],
      ['user_member', 'org_northstar_demo', 'member@northstar.test', 'MemberPass!2026', 'member'],
      ['user_viewer', 'org_northstar_demo', 'viewer@northstar.test', 'ViewerPass!2026', 'viewer'],
      [
        'user_other_owner',
        'org_outside_demo',
        'other-owner@outside.test',
        'OutsidePass!2026',
        'owner',
      ],
    ].forEach(([id, organizationId, email, password, role]) =>
      user.run(id, organizationId, email, hashSync(password, 12), role, now),
    );
  })();
  database.close();
}
