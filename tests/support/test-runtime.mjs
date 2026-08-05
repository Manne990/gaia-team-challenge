import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';

let sequence = 0;
const activeRoots = new Set();

function cleanupActiveRoots() {
  for (const root of activeRoots) rmSync(root, { recursive: true, force: true });
  activeRoots.clear();
}

process.once('exit', cleanupActiveRoots);
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => {
    cleanupActiveRoots();
    process.exit(128);
  });
}

export async function createTestRuntime(label = 'crm') {
  const root = mkdtempSync(join(tmpdir(), `northstar-${label}-${process.pid}-`));
  activeRoots.add(root);
  const port = await reservePort();
  let disposed = false;
  return {
    root,
    databasePath: join(root, 'test.sqlite'),
    port,
    dispose() {
      if (!disposed) {
        disposed = true;
        activeRoots.delete(root);
        rmSync(root, { recursive: true, force: true });
      }
    },
  };
}

export async function reservePort() {
  const preferred = 21000 + ((process.pid + sequence++) % 10000);
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(preferred, '127.0.0.1', () => {
      const address = server.address();
      server.close((error) => (error ? reject(error) : resolve(address.port)));
    });
  });
}

/** Compare a complete foreign-state snapshot, not merely an HTTP status. */
export async function expectDeniedWithoutSideEffects({ snapshot, attempt, expectedStatus = 404 }) {
  const before = structuredClone(await snapshot());
  const response = await attempt();
  const after = await snapshot();
  if (response.status !== expectedStatus)
    throw new Error(`Expected ${expectedStatus}, received ${response.status}`);
  if (JSON.stringify(after) !== JSON.stringify(before))
    throw new Error('Denied cross-tenant request changed persisted state');
}
