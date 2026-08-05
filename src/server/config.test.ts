import assert from 'node:assert/strict';
import test from 'node:test';

test('configuration uses a local default database path', async () => {
  const { config } = await import('./config.js');
  assert.match(config.databasePath, /data\/northstar\.sqlite$/);
  assert.equal(config.port, 4173);
});
