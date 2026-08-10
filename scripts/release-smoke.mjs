import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';

const host = '127.0.0.1';
const port = Number(process.env.RELEASE_PORT ?? '4173');
const baseUrl = `http://${host}:${port}`;
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';

let server;
let output = '';

function launch() {
  output = '';
  server = spawn(npm, ['run', 'dev', '--', '--host', host, '--port', String(port)], {
    env: process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  for (const stream of [server.stdout, server.stderr]) {
    stream.on('data', (chunk) => {
      output += chunk;
    });
  }
}

async function stop() {
  if (!server || server.exitCode !== null) return;
  const exited = new Promise((resolve) => server.once('exit', resolve));
  server.kill('SIGTERM');
  await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 5_000))]);
  if (server.exitCode === null) server.kill('SIGKILL');
}

async function waitForHealth() {
  let lastError;
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      const response = await fetch(`${baseUrl}/api/health`);
      if (response.ok) return;
      lastError = new Error(`health returned ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`service did not become healthy: ${lastError}\n${output}`);
}

async function signIn() {
  const response = await fetch(`${baseUrl}/api/auth/sign-in`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'owner@northstar.test', password: 'OwnerPass!2026' }),
  });
  assert.equal(response.status, 200, 'the seeded owner must sign in');
  return response.headers.get('set-cookie');
}

async function assertTenantIsolationAndData() {
  const cookie = await signIn();
  const own = await fetch(`${baseUrl}/api/companies/co_acme`, { headers: { cookie } });
  assert.equal(own.status, 200, 'the seeded organization record must be readable');
  const foreign = await fetch(`${baseUrl}/api/companies/co_outside`, { headers: { cookie } });
  assert.equal(foreign.status, 404, 'a foreign organization record must remain non-disclosing');
}

try {
  launch();
  await waitForHealth();
  await assertTenantIsolationAndData();
  await stop();
  launch();
  await waitForHealth();
  await assertTenantIsolationAndData();
  console.log('release smoke: launch, restart, persistence, and isolation PASS');
} finally {
  await stop();
}
