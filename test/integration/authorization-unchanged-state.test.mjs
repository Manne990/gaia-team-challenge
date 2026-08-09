import { afterEach, describe, expect, it } from "vitest";
import { readFile, writeFile } from "node:fs/promises";
import { createTemporaryEnvironment } from "../support/temporary-environment.mjs";
import { expectForeignWriteToBeRejected } from "../support/authorization-assertions.mjs";

describe("tenant-boundary mutation contract", () => {
  let environment;
  afterEach(async () => environment?.cleanup());

  it("rejects a guessed foreign identifier without changing its persisted representation", async () => {
    environment = await createTemporaryEnvironment();
    const foreignCompany = { id: "cmp_outside_acme", organizationId: "org_outside_demo", name: "Acme Holdings" };
    await writeFile(environment.databasePath, JSON.stringify({ companies: [foreignCompany] }));
    const readForeignState = async () => {
      const database = JSON.parse(await readFile(environment.databasePath, "utf8"));
      return database.companies.find((company) => company.id === foreignCompany.id);
    };
    await expectForeignWriteToBeRejected({
      readForeignState,
      attempt: async () => {
        const target = await readForeignState();
        if (target.organizationId !== "org_northstar_demo") return { status: 404 };
        target.name = "Mutated";
        await writeFile(environment.databasePath, JSON.stringify({ companies: [target] }));
        return { status: 200 };
      },
    });
    expect(environment.databasePath).toContain("northstar-crm-test-");
  });
});
