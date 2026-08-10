// @vitest-environment node
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { migrate, openDatabase, type CrmDatabase } from "../../db/database.js";
import { seedDatabase } from "../../db/seed.js";
import {
  AuthService,
  AuthenticationError,
  AuthorizationError,
} from "./service.js";

let directory: string;
let database: CrmDatabase;
let auth: AuthService;

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "northstar-auth-integration-"));
  database = openDatabase(join(directory, "crm.sqlite"));
  migrate(database);
  seedDatabase(database);
  auth = new AuthService(database);
});

afterEach(() => {
  database.close();
  rmSync(directory, { recursive: true, force: true });
});

describe("seeded authentication and persisted isolation", () => {
  it("authenticates every frozen role into the correct organization", async () => {
    const cases = [
      ["owner@northstar.test", "OwnerPass!2026", "owner", "org_northstar"],
      ["member@northstar.test", "MemberPass!2026", "member", "org_northstar"],
      ["viewer@northstar.test", "ViewerPass!2026", "viewer", "org_northstar"],
      ["other-owner@outside.test", "OutsidePass!2026", "owner", "org_outside"],
    ] as const;
    for (const [email, password, role, organizationId] of cases) {
      const result = await auth.signIn(email, password);
      expect(result.identity).toMatchObject({ role, organizationId });
      expect(auth.authenticate(result.token)).toMatchObject({
        role,
        organizationId,
      });
    }
  });

  it("returns nondisclosing failures and leaves foreign persisted state unchanged", async () => {
    const owner = (await auth.signIn("owner@northstar.test", "OwnerPass!2026"))
      .identity;
    const before = database
      .prepare(
        "SELECT * FROM memberships WHERE organization_id = ? ORDER BY id",
      )
      .all("org_outside");
    expect(() => auth.removeMembership(owner, "user_outside")).toThrow(
      AuthorizationError,
    );
    expect(
      database
        .prepare(
          "SELECT * FROM memberships WHERE organization_id = ? ORDER BY id",
        )
        .all("org_outside"),
    ).toEqual(before);
    await expect(
      auth.signIn("owner@northstar.test", "OwnerPass!2026", "org_outside"),
    ).rejects.toThrow(AuthenticationError);
  });
});
