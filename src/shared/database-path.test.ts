import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { assertSafeDatabaseResetTarget } from './database-path.js';

describe('assertSafeDatabaseResetTarget', () => {
  it('allows a new database path', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'northstar-'));
    await expect(
      assertSafeDatabaseResetTarget(path.join(directory, 'new.sqlite')),
    ).resolves.toBeUndefined();
  });

  it('refuses to replace an existing non-SQLite file', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'northstar-'));
    const target = path.join(directory, 'important.txt');
    await writeFile(target, 'do not overwrite');

    await expect(assertSafeDatabaseResetTarget(target)).rejects.toThrow('not a SQLite database');
    await expect(readFile(target, 'utf8')).resolves.toBe('do not overwrite');
  });
});
