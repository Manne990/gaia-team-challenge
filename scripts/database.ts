import { resetDatabase, seedDatabase } from '../src/server/database.js';

const command = process.argv[2];
if (command === 'reset') {
  resetDatabase();
  console.log('Database reset.');
} else if (command === 'seed') {
  seedDatabase();
  console.log('Database seeded.');
} else throw new Error('Usage: tsx scripts/database.ts <reset|seed>');
