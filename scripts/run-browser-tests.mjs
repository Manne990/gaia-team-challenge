import { spawnSync } from 'node:child_process';

const port = String(24000 + (process.pid % 10000));
const environment = { ...process.env, TEST_PORT: port };
const install = spawnSync('./node_modules/.bin/playwright', ['install', 'chromium'], {
  env: environment,
  stdio: 'inherit',
});
if (install.status !== 0) process.exit(install.status ?? 1);
const result = spawnSync('./node_modules/.bin/playwright', ['test', ...process.argv.slice(2)], {
  env: environment,
  stdio: 'inherit',
});
process.exit(result.status ?? 1);
