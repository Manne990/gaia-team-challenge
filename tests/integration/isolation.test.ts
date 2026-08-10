import { access } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { describe, expect, it } from "vitest";
import { createApp } from "../../src/server/app.js";
import { openDatabase } from "../../src/server/database/database.js";
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
    const environment = await createTemporaryDatabase();
    const database = openDatabase(environment.databasePath);
    database.exec(`CREATE TABLE companies (
      id TEXT PRIMARY KEY,
      organization_id TEXT NOT NULL,
      name TEXT NOT NULL
    ) STRICT`);
    database
      .prepare("INSERT INTO companies VALUES (?, ?, ?)")
      .run("company_outside_001", "org_outside_demo", "Acme Group");
    const app = createApp((application) => {
      application.put("/api/companies/:id", (request, response) => {
        const result = database
          .prepare(
            "UPDATE companies SET name = ? WHERE id = ? AND organization_id = ?",
          )
          .run(request.body.name, request.params.id, "org_northstar_demo");
        if (result.changes === 0)
          return response.status(404).json({ error: "not_found" });
        return response.status(200).json({ ok: true });
      });
    });
    const server = app.listen(0, "127.0.0.1");
    await new Promise<void>((resolve) => server.once("listening", resolve));
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    try {
      await expectRejectedWithoutForeignMutation({
        readForeignState: async () =>
          database
            .prepare(
              "SELECT id, organization_id, name FROM companies WHERE id = ?",
            )
            .get("company_outside_001"),
        attempt: async () => {
          const response = await fetch(
            `${url}/api/companies/company_outside_001`,
            {
              method: "PUT",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ name: "Leaked mutation" }),
            },
          );
          return { status: response.status, body: await response.json() };
        },
      });
      expect(
        database
          .prepare("SELECT name FROM companies WHERE id = ?")
          .get("company_outside_001"),
      ).toEqual({ name: "Acme Group" });
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
      database.close();
      await environment.cleanup();
    }
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
