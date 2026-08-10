// @vitest-environment node

import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { migrate, openDatabase } from "./database.js";
import { seedDatabase } from "./seed.js";

const temporaryDirectories: string[] = [];

function freshDatabase() {
  const directory = mkdtempSync(join(tmpdir(), "northstar-db-test-"));
  temporaryDirectories.push(directory);
  return openDatabase(join(directory, "crm.sqlite"));
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("SQLite database lifecycle", () => {
  it("migrates an empty database and records the migration", () => {
    const database = freshDatabase();

    expect(
      database
        .prepare(
          "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'organizations'",
        )
        .get(),
    ).toBeUndefined();
    migrate(database);

    expect(
      database
        .prepare(
          "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'organizations'",
        )
        .get(),
    ).toEqual({
      name: "organizations",
    });
    expect(
      database.prepare("SELECT name FROM schema_migrations").all(),
    ).toEqual([
      { name: "001_initial.sql" },
      { name: "002_membership_access_state.sql" },
      { name: "003_company_archival.sql" },
      { name: "003_contact_management.sql" },
      { name: "003_task_archive.sql" },
      { name: "004_activity_timeline.sql" },
      { name: "004_deal_management.sql" },
      { name: "004_import_preview.sql" },
      { name: "005_duplicate_merge.sql" },
    ]);
    expect(database.pragma("foreign_keys", { simple: true })).toBe(1);
    database.close();
  });

  it("makes migration idempotent", () => {
    const database = freshDatabase();

    migrate(database);
    expect(() => migrate(database)).not.toThrow();
    expect(
      database.prepare("SELECT COUNT(*) AS count FROM schema_migrations").get(),
    ).toEqual({ count: 9 });
    database.close();
  });

  it("seeds fixed fixtures idempotently with the expected accounts and counts", () => {
    const database = freshDatabase();
    migrate(database);

    seedDatabase(database);
    seedDatabase(database);

    const counts = Object.fromEntries(
      [
        "organizations",
        "users",
        "memberships",
        "pipeline_stages",
        "companies",
        "contacts",
        "deals",
        "tasks",
        "activities",
      ].map((table) => [
        table,
        (
          database.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as {
            count: number;
          }
        ).count,
      ]),
    );
    expect(counts).toEqual({
      organizations: 2,
      users: 4,
      memberships: 4,
      pipeline_stages: 6,
      companies: 37,
      contacts: 41,
      deals: 18,
      tasks: 24,
      activities: 30,
    });
    expect(
      database.prepare("SELECT email FROM users ORDER BY email").all(),
    ).toEqual([
      { email: "member@northstar.test" },
      { email: "other-owner@outside.test" },
      { email: "owner@northstar.test" },
      { email: "viewer@northstar.test" },
    ]);
    database.close();
  });

  it("persists migrated and seeded data across close and reopen", () => {
    const directory = mkdtempSync(join(tmpdir(), "northstar-db-test-"));
    temporaryDirectories.push(directory);
    const path = join(directory, "crm.sqlite");
    const first = openDatabase(path);
    migrate(first);
    seedDatabase(first);
    first.close();

    const reopened = openDatabase(path);
    migrate(reopened);
    expect(
      reopened.prepare("SELECT name FROM organizations ORDER BY id").all(),
    ).toEqual([{ name: "Northstar Demo" }, { name: "Outside Demo" }]);
    expect(
      (
        reopened.prepare("SELECT COUNT(*) AS count FROM companies").get() as {
          count: number;
        }
      ).count,
    ).toBe(37);
    reopened.close();
  });

  it("rolls back all writes when a transaction throws", () => {
    const database = freshDatabase();
    migrate(database);

    expect(() =>
      database.transaction(() => {
        database
          .prepare(
            "INSERT INTO organizations (id, name, slug, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
          )
          .run("org_rollback", "Rollback", "rollback", "now", "now");
        throw new Error("abort transaction");
      })(),
    ).toThrow("abort transaction");
    expect(
      database
        .prepare(
          "SELECT COUNT(*) AS count FROM organizations WHERE id = 'org_rollback'",
        )
        .get(),
    ).toEqual({ count: 0 });
    database.close();
  });

  it("rejects a relationship that crosses organizations", () => {
    const database = freshDatabase();
    migrate(database);
    seedDatabase(database);

    expect(() =>
      database
        .prepare(
          `
      INSERT INTO companies
        (id, organization_id, name, lifecycle_status, owner_membership_id, tags_json, description, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
        )
        .run(
          "company_cross_org",
          "org_outside",
          "Invalid Cross Org Company",
          "customer",
          "membership_owner",
          "[]",
          "",
          "now",
          "now",
        ),
    ).toThrow(/FOREIGN KEY constraint failed/);
    expect(
      database
        .prepare(
          "SELECT COUNT(*) AS count FROM companies WHERE id = 'company_cross_org'",
        )
        .get(),
    ).toEqual({ count: 0 });
    database.close();
  });

  it("rejects moving a merge redirect endpoint across organizations", () => {
    const database = freshDatabase();
    migrate(database);
    seedDatabase(database);

    database
      .prepare(
        `INSERT INTO merge_redirects
      (organization_id, entity_type, source_id, target_id, merged_by_membership_id, merged_at)
      VALUES (?, 'company', ?, ?, ?, ?)`,
      )
      .run(
        "org_northstar",
        "company_northstar_01",
        "company_northstar_02",
        "membership_owner",
        "now",
      );

    expect(() =>
      database
        .prepare(
          `UPDATE merge_redirects SET target_id = ?
      WHERE organization_id = ? AND entity_type = 'company' AND source_id = ?`,
        )
        .run("company_outside_01", "org_northstar", "company_northstar_01"),
    ).toThrow(/company merge endpoints must belong to merge organization/);
    expect(
      database
        .prepare(
          `SELECT target_id FROM merge_redirects
      WHERE organization_id = 'org_northstar' AND source_id = 'company_northstar_01'`,
        )
        .get(),
    ).toEqual({ target_id: "company_northstar_02" });

    expect(() =>
      database
        .prepare("DELETE FROM companies WHERE id = ?")
        .run("company_northstar_02"),
    ).toThrow(/cannot delete a company that is a merge target/);
    database.close();
  });

  it("prevents deleting a task referenced by an activity follow-up", () => {
    const database = freshDatabase();
    migrate(database);
    seedDatabase(database);

    database
      .prepare("UPDATE activities SET follow_up_task_id = ? WHERE id = ?")
      .run("task_northstar_01", "activity_northstar_01");

    expect(() =>
      database
        .prepare("DELETE FROM tasks WHERE id = ?")
        .run("task_northstar_01"),
    ).toThrow(/FOREIGN KEY constraint failed/);
    expect(
      database
        .prepare("SELECT follow_up_task_id FROM activities WHERE id = ?")
        .get("activity_northstar_01"),
    ).toEqual({ follow_up_task_id: "task_northstar_01" });
    database.close();
  });
});
