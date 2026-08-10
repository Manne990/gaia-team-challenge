import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

export function openDatabase(path: string): Database.Database {
  mkdirSync(dirname(path), { recursive: true });
  const database = new Database(path);
  database.pragma("journal_mode = WAL");
  database.pragma("foreign_keys = ON");
  database.exec(
    `CREATE TABLE IF NOT EXISTS system_metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);`,
  );
  return database;
}
