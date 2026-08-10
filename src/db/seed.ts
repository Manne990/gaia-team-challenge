import type { CrmDatabase } from "./database.js";
import { scryptSync } from "node:crypto";

const timestamp = "2026-01-15T12:00:00.000Z";

function passwordHash(password: string, salt: string): string {
  return `scrypt$16384$8$1$${salt}$${scryptSync(password, salt, 64).toString("base64")}`;
}

export function seedDatabase(database: CrmDatabase): void {
  database.transaction(() => {
    const insertOrganization =
      database.prepare(`INSERT OR IGNORE INTO organizations
      (id, name, slug, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`);
    insertOrganization.run(
      "org_northstar",
      "Northstar Demo",
      "northstar-demo",
      timestamp,
      timestamp,
    );
    insertOrganization.run(
      "org_outside",
      "Outside Demo",
      "outside-demo",
      timestamp,
      timestamp,
    );

    const insertUser = database.prepare(`INSERT OR IGNORE INTO users
      (id, email, password_hash, display_name, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`);
    const users = [
      [
        "user_owner",
        "owner@northstar.test",
        "Northstar Owner",
        "OwnerPass!2026",
        "northstar-owner-v1",
      ],
      [
        "user_member",
        "member@northstar.test",
        "Northstar Member",
        "MemberPass!2026",
        "northstar-member-v1",
      ],
      [
        "user_viewer",
        "viewer@northstar.test",
        "Northstar Viewer",
        "ViewerPass!2026",
        "northstar-viewer-v1",
      ],
      [
        "user_outside",
        "other-owner@outside.test",
        "Outside Owner",
        "OutsidePass!2026",
        "outside-owner-v1",
      ],
    ] as const;
    for (const [id, email, name, password, salt] of users) {
      insertUser.run(
        id,
        email,
        passwordHash(password, salt),
        name,
        timestamp,
        timestamp,
      );
    }

    const insertMembership = database.prepare(`INSERT OR IGNORE INTO memberships
      (id, organization_id, user_id, role, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`);
    insertMembership.run(
      "membership_owner",
      "org_northstar",
      "user_owner",
      "owner",
      timestamp,
      timestamp,
    );
    insertMembership.run(
      "membership_member",
      "org_northstar",
      "user_member",
      "member",
      timestamp,
      timestamp,
    );
    insertMembership.run(
      "membership_viewer",
      "org_northstar",
      "user_viewer",
      "viewer",
      timestamp,
      timestamp,
    );
    insertMembership.run(
      "membership_outside",
      "org_outside",
      "user_outside",
      "owner",
      timestamp,
      timestamp,
    );

    const insertStage = database.prepare(`INSERT OR IGNORE INTO pipeline_stages
      (id, organization_id, name, position, kind, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)`);
    for (const [suffix, name, position, kind] of [
      ["lead", "Lead", 0, "open"],
      ["qualified", "Qualified", 1, "open"],
      ["proposal", "Proposal", 2, "open"],
      ["won", "Won", 3, "won"],
      ["lost", "Lost", 4, "lost"],
    ] as const)
      insertStage.run(
        `stage_northstar_${suffix}`,
        "org_northstar",
        name,
        position,
        kind,
        timestamp,
        timestamp,
      );
    insertStage.run(
      "stage_outside_lead",
      "org_outside",
      "Lead",
      0,
      "open",
      timestamp,
      timestamp,
    );

    const insertCompany = database.prepare(`INSERT OR IGNORE INTO companies
      (id, organization_id, name, external_reference, industry, size, lifecycle_status,
       owner_membership_id, tags_json, description, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    for (let index = 1; index <= 36; index += 1) {
      insertCompany.run(
        `company_northstar_${index.toString().padStart(2, "0")}`,
        "org_northstar",
        index <= 2 ? "Duplicate Trading Name" : `Northstar Company ${index}`,
        `NS-${index.toString().padStart(3, "0")}`,
        index % 2 ? "Technology" : "Manufacturing",
        index % 3 ? "11-50" : "51-200",
        index % 5 ? "customer" : "prospect",
        index % 2 ? "membership_owner" : "membership_member",
        JSON.stringify(index % 2 ? ["priority"] : ["regional"]),
        `Deterministic company fixture ${index}`,
        timestamp,
        timestamp,
      );
    }
    insertCompany.run(
      "company_outside_01",
      "org_outside",
      "Outside Company",
      "OUT-001",
      "Services",
      "1-10",
      "customer",
      "membership_outside",
      "[]",
      "Tenant isolation fixture",
      timestamp,
      timestamp,
    );

    const insertContact = database.prepare(`INSERT OR IGNORE INTO contacts
      (id, organization_id, company_id, first_name, last_name, email, owner_membership_id, status,
       tags_json, communication_preference, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    for (let index = 1; index <= 40; index += 1) {
      const padded = index.toString().padStart(2, "0");
      insertContact.run(
        `contact_northstar_${padded}`,
        "org_northstar",
        `company_northstar_${(((index - 1) % 36) + 1).toString().padStart(2, "0")}`,
        `Contact${padded}`,
        index <= 2 ? "Duplicate" : `Person${padded}`,
        `contact${padded}@northstar.test`,
        index % 2 ? "membership_owner" : "membership_member",
        "active",
        "[]",
        index % 2 ? "email" : "phone",
        timestamp,
        timestamp,
      );
    }
    insertContact.run(
      "contact_outside_01",
      "org_outside",
      "company_outside_01",
      "Outside",
      "Contact",
      "contact@outside.test",
      "membership_outside",
      "active",
      "[]",
      "email",
      timestamp,
      timestamp,
    );

    const insertDeal = database.prepare(`INSERT OR IGNORE INTO deals
      (id, organization_id, company_id, owner_membership_id, stage_id, name, amount_minor, currency,
       expected_close_date, probability, status, loss_reason, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    for (let index = 1; index <= 18; index += 1) {
      const suffix =
        index % 5 === 0
          ? "won"
          : index % 4 === 0
            ? "proposal"
            : index % 3 === 0
              ? "qualified"
              : "lead";
      insertDeal.run(
        `deal_northstar_${index.toString().padStart(2, "0")}`,
        "org_northstar",
        `company_northstar_${index.toString().padStart(2, "0")}`,
        index % 2 ? "membership_owner" : "membership_member",
        `stage_northstar_${suffix}`,
        `Expansion ${index}`,
        index * 125000,
        "USD",
        `2026-${String((index % 6) + 2).padStart(2, "0")}-15`,
        suffix === "won" ? 100 : Math.min(90, index * 5),
        suffix === "won" ? "won" : "open",
        null,
        timestamp,
        timestamp,
      );
    }

    const insertTask = database.prepare(`INSERT OR IGNORE INTO tasks
      (id, organization_id, assignee_membership_id, company_id, deal_id, title, due_at, priority, status,
       completed_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    for (let index = 1; index <= 24; index += 1) {
      const completed = index % 7 === 0;
      const due =
        index <= 6
          ? `2025-12-${String(index + 10).padStart(2, "0")}T09:00:00.000Z`
          : `2026-02-${String((index % 20) + 1).padStart(2, "0")}T09:00:00.000Z`;
      insertTask.run(
        `task_northstar_${index.toString().padStart(2, "0")}`,
        "org_northstar",
        index % 2 ? "membership_owner" : "membership_member",
        `company_northstar_${(((index - 1) % 18) + 1).toString().padStart(2, "0")}`,
        `deal_northstar_${(((index - 1) % 18) + 1).toString().padStart(2, "0")}`,
        `Follow up ${index}`,
        due,
        index % 5 === 0 ? "urgent" : "medium",
        completed ? "completed" : "open",
        completed ? timestamp : null,
        timestamp,
        timestamp,
      );
    }

    const insertActivity = database.prepare(`INSERT OR IGNORE INTO activities
      (id, organization_id, creator_membership_id, company_id, contact_id, deal_id, type, subject, body,
       occurred_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    for (let index = 1; index <= 30; index += 1) {
      const padded = index.toString().padStart(2, "0");
      insertActivity.run(
        `activity_northstar_${padded}`,
        "org_northstar",
        index % 2 ? "membership_owner" : "membership_member",
        `company_northstar_${(((index - 1) % 30) + 1).toString().padStart(2, "0")}`,
        `contact_northstar_${padded}`,
        `deal_northstar_${(((index - 1) % 18) + 1).toString().padStart(2, "0")}`,
        index % 3 === 0 ? "meeting" : index % 2 ? "call" : "email",
        `Historical touchpoint ${index}`,
        `Deterministic activity ${index}`,
        `2025-${String((index % 12) + 1).padStart(2, "0")}-10T10:00:00.000Z`,
        timestamp,
        timestamp,
      );
    }
  })();
}
