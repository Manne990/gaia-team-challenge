import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

const socket = createServer();
await new Promise((resolve, reject) =>
  socket.once("error", reject).listen(0, "127.0.0.1", resolve),
);
const address = socket.address();
if (!address || typeof address === "string")
  throw new Error("Unable to allocate browser-test port");
await new Promise((resolve, reject) =>
  socket.close((error) => (error ? reject(error) : resolve())),
);

const directory = await mkdtemp(join(tmpdir(), "northstar-crm-browser-"));
const env = {
  ...process.env,
  TEST_PORT: String(address.port),
  NORTHSTAR_HOST: "127.0.0.1",
  NORTHSTAR_PORT: String(address.port),
  NORTHSTAR_DATABASE_PATH: join(directory, "test.sqlite"),
  NORTHSTAR_TEST_MODE: "1",
};

async function run(command) {
  const child = spawn(
    process.platform === "win32" ? "npm.cmd" : "npm",
    ["run", command],
    {
      env,
      stdio: "inherit",
    },
  );
  const code = await new Promise((resolve) => child.once("exit", resolve));
  if (code !== 0) throw new Error(`${command} failed (${code})`);
}

await run("db:reset");
await run("db:seed");

const server = spawn(
  process.platform === "win32" ? "npm.cmd" : "npm",
  [
    "run",
    "dev",
    "--",
    "--host",
    "127.0.0.1",
    "--port",
    String(address.port),
    "--database-path",
    env.NORTHSTAR_DATABASE_PATH,
  ],
  { env, detached: process.platform !== "win32", stdio: "inherit" },
);
let finished = false;

async function cleanup() {
  if (finished) return;
  finished = true;
  if (server.exitCode === null) {
    if (process.platform === "win32") server.kill("SIGTERM");
    else process.kill(-server.pid, "SIGTERM");
    await Promise.race([
      new Promise((resolve) => server.once("exit", resolve)),
      new Promise((resolve) => setTimeout(resolve, 5_000)),
    ]);
  }
  await rm(directory, { recursive: true, force: true });
}

for (const signal of ["SIGINT", "SIGTERM"])
  process.once(signal, async () => {
    await cleanup();
    process.kill(process.pid, signal);
  });

try {
  const deadline = Date.now() + 10_000;
  while (true) {
    if (server.exitCode !== null)
      throw new Error(`Browser test server exited early (${server.exitCode})`);
    try {
      const response = await fetch(
        `http://127.0.0.1:${address.port}/api/health`,
      );
      if (response.ok) break;
    } catch {
      // The product process is still starting.
    }
    if (Date.now() >= deadline)
      throw new Error("Browser test server did not start");
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  const test = spawn(
    process.platform === "win32" ? "npx.cmd" : "npx",
    ["playwright", "test", ...process.argv.slice(2)],
    { env, stdio: "inherit" },
  );
  const code = await new Promise((resolve) => test.once("exit", resolve));
  if (code !== 0) process.exitCode = typeof code === "number" ? code : 1;
} finally {
  await cleanup();
}
