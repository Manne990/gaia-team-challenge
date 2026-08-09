import { open, stat } from 'node:fs/promises';

const SQLITE_HEADER = 'SQLite format 3\u0000';

/** Prevent db:reset from replacing a user file that is not a SQLite database. */
export async function assertSafeDatabaseResetTarget(databasePath: string) {
  try {
    const information = await stat(databasePath);
    if (!information.isFile()) {
      throw new Error(`Refusing to reset ${databasePath}: the target is not a regular file.`);
    }

    const file = await open(databasePath, 'r');
    try {
      const header = Buffer.alloc(SQLITE_HEADER.length);
      await file.read(header, 0, header.length, 0);
      if (header.toString('utf8') !== SQLITE_HEADER) {
        throw new Error(`Refusing to reset ${databasePath}: the target is not a SQLite database.`);
      }
    } finally {
      await file.close();
    }
  } catch (error: unknown) {
    if (isMissingFile(error)) return;
    throw error;
  }
}

function isMissingFile(error: unknown) {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT';
}
