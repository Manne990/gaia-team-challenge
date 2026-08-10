import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";

const socket = createServer();
await new Promise((resolve, reject) => socket.once("error", reject).listen(0, "127.0.0.1", resolve));
const address = socket.address();
if (!address || typeof address === "string") throw new Error("Unable to allocate browser-test port");
await new Promise((resolve, reject) => socket.close((error) => error ? reject(error) : resolve()));

const directory = await mkdtemp(join(tmpdir(), "northstar-crm-browser-"));
const env = { ...process.env, TEST_PORT: String(address.port), DATABASE_PATH: join(directory, "test.sqlite") };
const server = spawn(process.execPath, ["scripts/test-server.mjs"], { env, stdio: ["ignore", "pipe", "inherit"] });
let finished = false;

async function cleanup() {
  if (finished) return;
  finished = true;
  server.kill("SIGTERM");
  await rm(directory, { recursive: true, force: true });
}

for (const signal of ["SIGINT", "SIGTERM"]) process.once(signal, async () => {
  await cleanup();
  process.kill(process.pid, signal);
});

try {
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Browser test server did not start")), 10_000);
    server.once("exit", (code) => reject(new Error(`Browser test server exited early (${code})`)));
    server.stdout.once("data", () => { clearTimeout(timeout); resolve(); });
  });
  const test = spawn(process.platform === "win32" ? "npx.cmd" : "npx", ["playwright", "test", ...process.argv.slice(2)], { env, stdio: "inherit" });
  const code = await new Promise((resolve) => test.once("exit", resolve));
  if (code !== 0) process.exitCode = typeof code === "number" ? code : 1;
} finally {
  await cleanup();
}
