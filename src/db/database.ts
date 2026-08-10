import Database from "better-sqlite3";
import { mkdirSync, readFileSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export type CrmDatabase = Database.Database;

const moduleUrl = new URL(import.meta.url);
const migrationsDirectory =
  moduleUrl.protocol === "file:"
    ? fileURLToPath(new URL("./migrations", moduleUrl))
    : resolve(process.cwd(), "src/db/migrations");

export function openDatabase(path: string): CrmDatabase {
  if (path !== ":memory:")
    mkdirSync(dirname(resolve(path)), { recursive: true });
  const database = new Database(path);
  database.pragma("foreign_keys = ON");
  database.pragma("journal_mode = WAL");
  database.pragma("busy_timeout = 5000");
  return database;
}

export function migrate(database: CrmDatabase): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL
    ) STRICT
  `);
  const applied = database.prepare(
    "SELECT 1 FROM schema_migrations WHERE name = ?",
  );
  const record = database.prepare(
    "INSERT INTO schema_migrations (name, applied_at) VALUES (?, ?)",
  );
  for (const name of readdirSync(migrationsDirectory)
    .filter((file) => file.endsWith(".sql"))
    .sort()) {
    if (applied.get(name)) continue;
    const sql = readFileSync(resolve(migrationsDirectory, name), "utf8");
    database.transaction(() => {
      database.exec(sql);
      record.run(name, new Date().toISOString());
    })();
  }
}
