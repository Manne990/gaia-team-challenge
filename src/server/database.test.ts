import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('database reset and seed are idempotent', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'northstar-test-'));
  process.env.NORTHSTAR_DB_PATH = join(directory, 'test.sqlite');
  const { resetDatabase, seedDatabase, openDatabase } = await import('./database.js');
  resetDatabase();
  seedDatabase();
  seedDatabase();
  const database = openDatabase();
  const count = database.prepare('SELECT count(*) AS count FROM users').get() as { count: number };
  const owner = database
    .prepare("SELECT password_hash FROM users WHERE email = 'owner@northstar.test'")
    .get() as { password_hash: string };
  assert.equal(count.count, 4);
  assert.match(owner.password_hash, /^\$2[aby]\$/);
  database.close();
  rmSync(directory, { recursive: true, force: true });
});
