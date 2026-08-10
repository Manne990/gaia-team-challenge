import { access } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import {
  createTemporaryDatabase,
  expectRejectedWithoutForeignMutation,
  reserveUniquePort,
} from "../support/isolation.js";

describe("isolated test resources", () => {
  it("allocates independent ports and removes temporary databases idempotently", async () => {
    const [firstPort, secondPort] = await Promise.all([
      reserveUniquePort(),
      reserveUniquePort(),
    ]);
    expect(firstPort).not.toBe(secondPort);
    const database = await createTemporaryDatabase();
    await database.cleanup();
    await database.cleanup();
    await expect(access(database.directory)).rejects.toThrow();
  });

  it("asserts both rejection and unchanged foreign persisted state", async () => {
    const foreignRows = [{ id: "company_outside_001", name: "Acme Group" }];
    await expectRejectedWithoutForeignMutation({
      readForeignState: async () => foreignRows,
      attempt: async () => ({ status: 404, body: { error: "not_found" } }),
    });
    expect(foreignRows).toEqual([
      { id: "company_outside_001", name: "Acme Group" },
    ]);
  });

  it("detects a disclosing authorization response even when state is unchanged", async () => {
    await expect(
      expectRejectedWithoutForeignMutation({
        readForeignState: async () => [{ id: "company_outside_001" }],
        attempt: async () => ({
          status: 403,
          body: { error: "belongs_to_another_organization" },
        }),
        expectedStatus: 403,
      }),
    ).rejects.toThrow("disclosed an unexpected response");
  });
});
