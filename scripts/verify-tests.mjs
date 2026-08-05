import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

function testFiles(path) {
  return readdirSync(path, { withFileTypes: true }).flatMap((entry) => {
    const target = join(path, entry.name);
    return entry.isDirectory()
      ? testFiles(target)
      : /\.(?:test|spec)\.(?:mjs|ts)$/.test(entry.name)
        ? [target]
        : [];
  });
}

const files = testFiles('tests');
if (files.length === 0) throw new Error('No test files were discovered');
for (const file of files) {
  const source = readFileSync(file, 'utf8');
  if (
    /\btest\.(?:skip|only)\s*\(/.test(source) ||
    /\b(?:describe|it)\.(?:skip|only)\s*\(/.test(source)
  ) {
    throw new Error(`Focused or skipped test is forbidden in CI: ${file}`);
  }
  if (!/\btest\s*\(/.test(source)) throw new Error(`Empty test suite: ${file}`);
}
