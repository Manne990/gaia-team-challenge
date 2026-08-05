import { existsSync, unlinkSync } from 'node:fs';
import { databasePath, ensureDatabase } from '../src/db/database.mjs';
import { seedDatabase } from '../src/db/seed.mjs';

const command = process.argv[2];
const path = databasePath();

if (command === 'reset') {
  if (existsSync(path)) unlinkSync(path);
  const db = ensureDatabase(path);
  db.close();
  console.log(`database reset: ${path}`);
} else if (command === 'seed') {
  const db = ensureDatabase(path);
  seedDatabase(db);
  db.close();
  console.log(`database seeded: ${path}`);
} else {
  throw new Error('Usage: node scripts/db.mjs <reset|seed>');
}
