import { ensureDatabase } from '../src/db/database.mjs';

const db = ensureDatabase(':memory:');
db.close();
console.log('build: schema migration verification passed');
