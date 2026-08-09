import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const roots = ['test/unit', 'test/integration', 'test/browser'];
const prohibited = /\.(?:skip|only|todo)\s*\(/;

function filesIn(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? filesIn(path) : [path];
  });
}

for (const root of roots) {
  const tests = filesIn(root).filter((file) => /\.(test|spec)\.mjs$/.test(file));
  if (tests.length === 0) throw new Error(`No test files found in ${root}`);
  for (const file of tests) {
    if (prohibited.test(readFileSync(file, 'utf8'))) {
      throw new Error(`Focused, skipped, or todo test found: ${file}`);
    }
  }
}
