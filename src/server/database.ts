import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { hashSync } from 'bcryptjs';
import { config } from './config.js';
const migrationsDirectory = fileURLToPath(new URL('../../migrations/', import.meta.url));

function migrate(database: Database.Database): void {
  database.exec(
    'CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY NOT NULL, applied_at TEXT NOT NULL)',
  );
  const applied = new Set(
    database
      .prepare('SELECT name FROM schema_migrations')
      .all()
      .map((row) => (row as { name: string }).name),
  );
  const record = database.prepare('INSERT INTO schema_migrations (name, applied_at) VALUES (?, ?)');
  for (const file of readdirSync(migrationsDirectory)
    .filter((name) => name.endsWith('.sql'))
    .sort()) {
    if (applied.has(file)) continue;
    database.transaction(() => {
      database.exec(readFileSync(join(migrationsDirectory, file), 'utf8'));
      record.run(file, new Date().toISOString());
    })();
  }
}
export function openDatabase(): Database.Database {
  mkdirSync(dirname(config.databasePath), { recursive: true });
  const database = new Database(config.databasePath);
  database.pragma('foreign_keys = ON');
  database.pragma('journal_mode = WAL');
  migrate(database);
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
    'INSERT OR IGNORE INTO organizations (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)',
  );
  const user = database.prepare(
    'INSERT OR IGNORE INTO users (id, email, display_name, password_hash, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
  );
  const membership = database.prepare(
    'INSERT OR IGNORE INTO memberships (id, organization_id, user_id, role, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
  );
  database.transaction(() => {
    organization.run('org-northstar', 'Northstar Demo', now, now);
    organization.run('org-outside', 'Outside Demo', now, now);
    [
      [
        'user-owner',
        'membership-northstar-owner',
        'org-northstar',
        'owner@northstar.test',
        'OwnerPass!2026',
        'owner',
      ],
      [
        'user-member',
        'membership-northstar-member',
        'org-northstar',
        'member@northstar.test',
        'MemberPass!2026',
        'member',
      ],
      [
        'user-viewer',
        'membership-northstar-viewer',
        'org-northstar',
        'viewer@northstar.test',
        'ViewerPass!2026',
        'viewer',
      ],
      [
        'user-outside-owner',
        'membership-outside-owner',
        'org-outside',
        'other-owner@outside.test',
        'OutsidePass!2026',
        'owner',
      ],
    ].forEach(([id, membershipId, organizationId, email, password, role]) => {
      user.run(id, email, email, hashSync(password, 12), now, now);
      membership.run(membershipId, organizationId, id, role, now, now);
    });
  })();
  database.close();
}
