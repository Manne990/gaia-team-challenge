import Database from 'better-sqlite3';
import { existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const migrationsDirectory = new URL('../../migrations/', import.meta.url);

export function openDatabase(filename) {
  if (filename !== ':memory:') mkdirSync(dirname(filename), { recursive: true });
  const db = new Database(filename);
  db.pragma('foreign_keys = ON');
  db.pragma('journal_mode = WAL');
  db.pragma('busy_timeout = 5000');
  return db;
}

export function migrate(db) {
  db.exec(
    'CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY NOT NULL, applied_at TEXT NOT NULL)',
  );
  const applied = new Set(
    db
      .prepare('SELECT name FROM schema_migrations')
      .all()
      .map(({ name }) => name),
  );
  const files = readdirSync(migrationsDirectory)
    .filter((file) => file.endsWith('.sql'))
    .sort();
  const insert = db.prepare('INSERT INTO schema_migrations (name, applied_at) VALUES (?, ?)');
  const apply = db.transaction((file) => {
    db.exec(readFileSync(join(migrationsDirectory.pathname, file), 'utf8'));
    insert.run(file, new Date().toISOString());
  });
  for (const file of files) if (!applied.has(file)) apply(file);
}

export function databasePath() {
  return process.env.NORTHSTAR_DB_PATH ?? join(process.cwd(), '.data', 'northstar.sqlite');
}

export function ensureDatabase(filename = databasePath()) {
  const db = openDatabase(filename);
  migrate(db);
  return db;
}

export function databaseExists(filename = databasePath()) {
  return existsSync(filename);
}
