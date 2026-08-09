import { createRequire } from 'node:module';
import { loadRuntimeConfig } from '../src/shared/config.js';
import { assertSafeDatabaseResetTarget } from '../src/shared/database-path.js';

const require = createRequire(import.meta.url);
const { resetDatabase, openDatabase, seedDatabase } = require('../src/db/database.mjs') as {
  resetDatabase(path: string): { close(): void };
  openDatabase(path: string): { close(): void };
  seedDatabase(database: unknown): void;
};

const action = process.argv[2];
const config = loadRuntimeConfig(process.argv.slice(3));

async function reset() {
  await assertSafeDatabaseResetTarget(config.databasePath);
  resetDatabase(config.databasePath).close();
  console.log(`Database reset at ${config.databasePath}`);
}

async function seed() {
  const database = openDatabase(config.databasePath);
  seedDatabase(database);
  database.close();
  console.log(`Database seeded at ${config.databasePath}.`);
}

if (action === 'reset') await reset();
else if (action === 'seed') await seed();
else throw new Error(`Unknown database action: ${action ?? 'missing'}`);
