// @vitest-environment node
import { mkdtempSync, rmSync } from "node:fs";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { migrate, openDatabase, type CrmDatabase } from "../../db/database.js";
import { seedDatabase } from "../../db/seed.js";
import { createApp } from "../app.js";

type Candidate = {
  id: string;
  version: number;
  name: string;
  externalReference: string | null;
  website: string | null;
  phone: string | null;
  industry: string | null;
  size: string | null;
  address: string | null;
  lifecycleStatus: string;
  ownerMembershipId: string | null;
  tags: string[];
  description: string;
  archivedAt: string | null;
};
type ContactCandidate = {
  id: string;
  version: number;
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string | null;
  jobTitle: string | null;
  companyId: string | null;
  ownerMembershipId: string | null;
  status: string;
  tags: string[];
  communicationPreference: string;
  archivedAt: string | null;
};
let directory: string,
  databasePath: string,
  database: CrmDatabase,
  server: Server,
  baseUrl: string;
async function start() {
  server = createApp(database).listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}
beforeEach(async () => {
  directory = mkdtempSync(join(tmpdir(), "northstar-merge-"));
  databasePath = join(directory, "crm.sqlite");
  database = openDatabase(databasePath);
  migrate(database);
  seedDatabase(database);
  await start();
});
afterEach(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  database.close();
  rmSync(directory, { recursive: true, force: true });
});
async function signIn(
  email = "member@northstar.test",
  password = "MemberPass!2026",
) {
  const response = await fetch(`${baseUrl}/api/auth/sign-in`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  expect(response.status).toBe(200);
  return response.headers.get("set-cookie")?.split(";")[0] ?? "";
}
const request = (path: string, cookie: string, init: RequestInit = {}) =>
  fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      cookie,
      ...(init.body ? { "content-type": "application/json" } : {}),
      ...init.headers,
    },
  });
const fields = (record: Candidate) => ({
  name: record.name,
  externalReference: record.externalReference,
  website: record.website,
  phone: record.phone,
  industry: record.industry,
  size: record.size,
  address: record.address,
  lifecycleStatus: record.lifecycleStatus,
  ownerMembershipId: record.ownerMembershipId,
  tags: record.tags,
  description: record.description,
});
const contactFields = (record: ContactCandidate) => ({
  firstName: record.firstName,
  lastName: record.lastName,
  email: record.email,
  phone: record.phone,
  jobTitle: record.jobTitle,
  companyId: record.companyId,
  ownerMembershipId: record.ownerMembershipId,
  status: record.status,
  tags: record.tags,
  communicationPreference: record.communicationPreference,
});
async function companyCandidates(cookie: string) {
  const response = await request("/api/duplicates?entityType=company", cookie);
  expect(response.status).toBe(200);
  return (await response.json()) as {
    items: Array<{
      left: Candidate;
      right: Candidate;
      reasons: Array<{ field: string; normalizedValue: string }>;
    }>;
  };
}

describe.sequential("duplicate review and merge boundary", () => {
  it("explains deterministic candidates without changing records or exposing another organization", async () => {
    const member = await signIn();
    const before = (
      database.prepare("SELECT count(*) count FROM merge_redirects").get() as {
        count: number;
      }
    ).count;
    const { items } = await companyCandidates(member);
    const duplicate = items.find(
      ({ left, right }) =>
        [left.id, right.id].includes("company_northstar_01") &&
        [left.id, right.id].includes("company_northstar_02"),
    );
    expect(duplicate?.reasons).toContainEqual({
      field: "name",
      normalizedValue: "duplicatetradingname",
    });
    expect(JSON.stringify(items)).not.toContain("outside");
    expect(
      (
        database
          .prepare("SELECT count(*) count FROM merge_redirects")
          .get() as { count: number }
      ).count,
    ).toBe(before);
  });

  it("moves every company relation atomically, preserves aliases/history, and safely resolves the retired id", async () => {
    const member = await signIn();
    database
      .prepare(
        "INSERT INTO audit_events (id,organization_id,actor_membership_id,action,entity_type,entity_id,summary_json,occurred_at) VALUES ('audit_premerge','org_northstar','membership_member','company.updated','company','company_northstar_02','{}','2026-01-16T00:00:00.000Z')",
      )
      .run();
    const { items } = await companyCandidates(member);
    const pair = items.find(
      ({ left, right }) =>
        left.id === "company_northstar_01" &&
        right.id === "company_northstar_02",
    )!;
    const response = await request("/api/merges", member, {
      method: "POST",
      body: JSON.stringify({
        entityType: "company",
        survivorId: pair.left.id,
        retiredId: pair.right.id,
        survivorVersion: pair.left.version,
        retiredVersion: pair.right.version,
        fields: {
          ...fields(pair.left),
          industry: pair.right.industry,
          tags: [...pair.left.tags, ...pair.right.tags],
        },
      }),
    });
    expect(response.status).toBe(200);
    for (const table of ["contacts", "deals", "activities", "tasks"]) {
      expect(
        (
          database
            .prepare(
              `SELECT count(*) count FROM ${table} WHERE organization_id='org_northstar' AND company_id='company_northstar_02'`,
            )
            .get() as { count: number }
        ).count,
      ).toBe(0);
    }
    expect(
      (
        database
          .prepare(
            "SELECT count(*) count FROM entity_aliases WHERE source_entity_id='company_northstar_02'",
          )
          .get() as { count: number }
      ).count,
    ).toBeGreaterThan(0);
    expect(
      (
        database
          .prepare(
            "SELECT count(*) count FROM audit_events WHERE entity_type='company' AND entity_id='company_northstar_02'",
          )
          .get() as { count: number }
      ).count,
    ).toBeGreaterThan(0);
    const redirected = await request(
      "/api/companies/company_northstar_02",
      member,
    );
    expect(redirected.status).toBe(200);
    expect(
      ((await redirected.json()) as { redirect: { to: string } }).redirect.to,
    ).toBe("company_northstar_01");
  });

  it("is replay-safe, flattens chained merges, and survives a database restart", async () => {
    const member = await signIn();
    const { items } = await companyCandidates(member);
    const pair = items.find(
      ({ left, right }) =>
        left.id === "company_northstar_01" &&
        right.id === "company_northstar_02",
    )!;
    const payload = {
      entityType: "company",
      survivorId: pair.left.id,
      retiredId: pair.right.id,
      survivorVersion: pair.left.version,
      retiredVersion: pair.right.version,
      fields: fields(pair.left),
    };
    expect(
      (
        await request("/api/merges", member, {
          method: "POST",
          body: JSON.stringify(payload),
        })
      ).status,
    ).toBe(200);
    const replay = await request("/api/merges", member, {
      method: "POST",
      body: JSON.stringify(payload),
    });
    expect(
      ((await replay.json()) as { merge: { replayed: boolean } }).merge
        .replayed,
    ).toBe(true);
    const version = (
      database
        .prepare(
          "SELECT version FROM companies WHERE id='company_northstar_01'",
        )
        .get() as { version: number }
    ).version;
    const third = database
      .prepare(
        "SELECT version,name,external_reference externalReference,website,phone,industry,size,address,lifecycle_status lifecycleStatus,owner_membership_id ownerMembershipId,tags_json tagsJson,description,archived_at archivedAt,id FROM companies WHERE id='company_northstar_03'",
      )
      .get() as Candidate & { tagsJson: string };
    const chained = await request("/api/merges", member, {
      method: "POST",
      body: JSON.stringify({
        entityType: "company",
        survivorId: "company_northstar_01",
        retiredId: third.id,
        survivorVersion: version,
        retiredVersion: third.version,
        fields: fields(pair.left),
      }),
    });
    expect(chained.status).toBe(200);
    await new Promise<void>((resolve) => server.close(() => resolve()));
    database.close();
    database = openDatabase(databasePath);
    migrate(database);
    await start();
    const restarted = await signIn();
    const redirect = await request(
      "/api/merge-redirects/company/company_northstar_02",
      restarted,
    );
    expect(await redirect.json()).toMatchObject({
      targetId: "company_northstar_01",
      redirected: true,
    });
  });

  it("merges an archived contact and deduplicates relationship edges", async () => {
    const member = await signIn();
    database
      .prepare(
        "UPDATE contacts SET email='contact01@northstar.test', email_normalized='contact01@northstar.test', archived_at='2026-08-09T00:00:00.000Z' WHERE id='contact_northstar_02'",
      )
      .run();
    database
      .prepare(
        "INSERT OR IGNORE INTO deal_contacts (organization_id,deal_id,contact_id,created_at) VALUES ('org_northstar','deal_northstar_01','contact_northstar_01','2026-01-15T12:00:00.000Z'),('org_northstar','deal_northstar_01','contact_northstar_02','2026-01-15T12:00:00.000Z')",
      )
      .run();
    const response = await request(
      "/api/duplicates?entityType=contact",
      member,
    );
    const candidates = (await response.json()) as {
      items: Array<{
        left: ContactCandidate;
        right: ContactCandidate;
        reasons: Array<{ field: string }>;
      }>;
    };
    const pair = candidates.items.find(
      ({ left, right }) =>
        left.id === "contact_northstar_01" &&
        right.id === "contact_northstar_02",
    )!;
    expect(pair.reasons).toContainEqual(
      expect.objectContaining({ field: "email" }),
    );
    const merged = await request("/api/merges", member, {
      method: "POST",
      body: JSON.stringify({
        entityType: "contact",
        survivorId: pair.left.id,
        retiredId: pair.right.id,
        survivorVersion: pair.left.version,
        retiredVersion: pair.right.version,
        fields: contactFields(pair.left),
      }),
    });
    expect(merged.status).toBe(200);
    expect(
      (
        database
          .prepare(
            "SELECT count(*) count FROM deal_contacts WHERE deal_id='deal_northstar_01' AND contact_id='contact_northstar_01'",
          )
          .get() as { count: number }
      ).count,
    ).toBe(1);
    expect(
      (
        database
          .prepare(
            "SELECT count(*) count FROM deal_contacts WHERE contact_id='contact_northstar_02'",
          )
          .get() as { count: number }
      ).count,
    ).toBe(0);
    expect(
      (
        database
          .prepare(
            "SELECT count(*) count FROM activity_participants WHERE contact_id='contact_northstar_02'",
          )
          .get() as { count: number }
      ).count,
    ).toBe(0);
  });

  it("rejects viewer, foreign, stale, and competing merge writes without foreign mutation", async () => {
    const viewer = await signIn("viewer@northstar.test", "ViewerPass!2026"),
      member = await signIn(),
      outside = await signIn("other-owner@outside.test", "OutsidePass!2026");
    const { items } = await companyCandidates(member);
    const pair = items.find(
      ({ left, right }) =>
        left.id === "company_northstar_01" &&
        right.id === "company_northstar_02",
    )!;
    const payload = {
      entityType: "company",
      survivorId: pair.left.id,
      retiredId: pair.right.id,
      survivorVersion: pair.left.version,
      retiredVersion: pair.right.version,
      fields: fields(pair.left),
    };
    expect(
      (
        await request("/api/merges", viewer, {
          method: "POST",
          body: JSON.stringify(payload),
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await request("/api/merges", outside, {
          method: "POST",
          body: JSON.stringify(payload),
        })
      ).status,
    ).toBe(404);
    const competing = await Promise.all([
      request("/api/merges", member, {
        method: "POST",
        body: JSON.stringify(payload),
      }),
      request("/api/merges", member, {
        method: "POST",
        body: JSON.stringify({
          ...payload,
          fields: { ...payload.fields, name: "Alternative survivor" },
        }),
      }),
    ]);
    expect(competing.map(({ status }) => status).sort()).toEqual([200, 409]);
    expect(
      (
        database
          .prepare("SELECT name FROM companies WHERE id='company_outside_01'")
          .get() as { name: string }
      ).name,
    ).toBe("Outside Company");
  });
});
