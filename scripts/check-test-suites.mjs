import { readFile, readdir } from "node:fs/promises";
import { extname, join } from "node:path";

const roots = ["tests/unit", "tests/integration", "tests/e2e", "test"];
const forbidden =
  /\b(?:describe|it|test)(?:\s*\.\s*\w+)*\s*\.\s*(?:only|skip|skipIf|runIf|todo|fixme)\b|\b(?:xit|xdescribe)\s*\(/;
let testFiles = 0;

async function scan(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) await scan(path);
    else if ([".ts", ".tsx", ".js", ".mjs"].includes(extname(path))) {
      const source = await readFile(path, "utf8");
      if (forbidden.test(source))
        throw new Error(`Focused or skipped test is forbidden: ${path}`);
      if (/\.(?:test|spec)\.[cm]?[jt]sx?$/.test(path)) testFiles += 1;
    }
  }
}

for (const root of roots) await scan(root);
if (testFiles === 0) throw new Error("No test files discovered");
console.log(
  `test suite policy: PASS (${testFiles} files, no focused or skipped tests)`,
);
