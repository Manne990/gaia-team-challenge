import type Database from "better-sqlite3";

export function migrateAuthSchema(db: Database.Database): void {
  db.exec(`
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS organizations (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      created_at TEXT NOT NULL
    ) STRICT;

    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL COLLATE NOCASE UNIQUE,
      password_hash TEXT NOT NULL,
      display_name TEXT NOT NULL,
      created_at TEXT NOT NULL,
      disabled_at TEXT
    ) STRICT;

    CREATE TABLE IF NOT EXISTS memberships (
      organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      role TEXT NOT NULL CHECK (role IN ('owner', 'member', 'viewer')),
      created_at TEXT NOT NULL,
      PRIMARY KEY (organization_id, user_id)
    ) STRICT;

    CREATE TABLE IF NOT EXISTS sessions (
      id_hash TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      organization_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      revoked_at TEXT,
      FOREIGN KEY (organization_id, user_id)
        REFERENCES memberships(organization_id, user_id) ON DELETE CASCADE
    ) STRICT;

    CREATE INDEX IF NOT EXISTS sessions_user_active
      ON sessions(user_id, expires_at) WHERE revoked_at IS NULL;
  `);
}
