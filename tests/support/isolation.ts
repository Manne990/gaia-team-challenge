import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

export async function reserveUniquePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Failed to reserve a test port");
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return address.port;
}

export async function createTemporaryDatabase(): Promise<{ directory: string; databasePath: string; cleanup: () => Promise<void> }> {
  const directory = await mkdtemp(join(tmpdir(), "northstar-crm-test-"));
  let cleaned = false;
  return {
    directory,
    databasePath: join(directory, "test.sqlite"),
    cleanup: async () => {
      if (cleaned) return;
      cleaned = true;
      await rm(directory, { recursive: true, force: true });
    },
  };
}

export async function expectRejectedWithoutForeignMutation<T>(options: {
  readForeignState: () => Promise<T>;
  attempt: () => Promise<{ status: number; body: unknown }>;
  expectedStatus?: number;
}): Promise<void> {
  const before = structuredClone(await options.readForeignState());
  const response = await options.attempt();
  if (response.status !== (options.expectedStatus ?? 404)) {
    throw new Error(`Expected authorization rejection, received ${response.status}: ${JSON.stringify(response.body)}`);
  }
  const after = await options.readForeignState();
  if (JSON.stringify(after) !== JSON.stringify(before)) {
    throw new Error("Rejected cross-organization request changed foreign persisted state");
  }
}
