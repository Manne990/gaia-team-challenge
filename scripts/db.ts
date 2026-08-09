import { mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import Database from 'better-sqlite3';
import { loadConfig } from '../src/shared/config.js';

const action = process.argv[2];
const config = loadConfig();

async function reset() {
  await mkdir(path.dirname(config.databasePath), { recursive: true });
  await rm(config.databasePath, { force: true });
  initialize().close();
  console.log(`Database reset at ${config.databasePath}`);
}

async function seed() {
  await mkdir(path.dirname(config.databasePath), { recursive: true });
  const database = initialize();
  database
    .prepare(
      "INSERT INTO system_metadata (key, value) VALUES ('seed_version', 'foundation') ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    )
    .run();
  database.close();
  console.log(
    `Database initialized at ${config.databasePath}; domain seed data will be supplied by migrations.`,
  );
}

function initialize() {
  const database = new Database(config.databasePath);
  database.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS system_metadata (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);
  return database;
}

if (action === 'reset') await reset();
else if (action === 'seed') await seed();
else throw new Error(`Unknown database action: ${action ?? 'missing'}`);
