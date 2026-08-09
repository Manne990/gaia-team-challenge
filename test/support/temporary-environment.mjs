import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** Creates an isolated filesystem location for one integration-test database. */
export async function createTemporaryEnvironment(prefix = 'northstar-crm-test-') {
  const directory = await mkdtemp(join(tmpdir(), prefix));
  let cleaned = false;
  return {
    directory,
    databasePath: join(directory, 'database.sqlite'),
    async cleanup() {
      if (!cleaned) {
        cleaned = true;
        await rm(directory, { force: true, recursive: true });
      }
    },
  };
}
