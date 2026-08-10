// @vitest-environment node
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { migrate, openDatabase, type CrmDatabase } from "../../db/database.js";
import { seedDatabase } from "../../db/seed.js";
import { createApp } from "../app.js";

let database: CrmDatabase;
let server: Server;
let baseUrl: string;

beforeEach(async () => {
  database = openDatabase(":memory:");
  migrate(database);
  seedDatabase(database);
  server = createApp(database).listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterEach(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  database.close();
});

async function signIn(email: string, password: string) {
  const response = await fetch(`${baseUrl}/api/auth/sign-in`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  expect(response.status).toBe(200);
  return response.headers.get("set-cookie")!.split(";")[0];
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

describe.sequential("CSV import and export", () => {
  it("previews normalized company rows, commits atomically, and makes double-submit replay safe", async () => {
    const member = await signIn("member@northstar.test", "MemberPass!2026");
    const previewResponse = await request("/api/imports/preview", member, {
      method: "POST",
      body: JSON.stringify({
        resource: "companies",
        sourceName: "accounts.csv",
        csv: 'Company,Reference,Tags,Status\r\n"Acme, Nordic", acme-77,"Priority; Nordic",PROSPECT',
        mapping: {
          name: "Company",
          externalReference: "Reference",
          tags: "Tags",
          lifecycleStatus: "Status",
        },
      }),
    });
    expect(previewResponse.status).toBe(201);
    const preview = (await previewResponse.json()) as {
      import: {
        id: string;
        summary: object;
        rows: Array<{ normalized: Record<string, unknown> }>;
      };
    };
    expect(preview.import.summary).toEqual({
      total: 1,
      valid: 1,
      warnings: 0,
      errors: 0,
    });
    expect(preview.import.rows[0]?.normalized).toMatchObject({
      name: "Acme, Nordic",
      externalReference: "ACME-77",
      tags: ["priority", "nordic"],
      lifecycleStatus: "prospect",
    });
    const before = (
      database
        .prepare(
          "SELECT count(*) AS count FROM companies WHERE organization_id = 'org_northstar'",
        )
        .get() as { count: number }
    ).count;
    const first = await request(
      `/api/imports/${preview.import.id}/commit`,
      member,
      { method: "POST" },
    );
    const second = await request(
      `/api/imports/${preview.import.id}/commit`,
      member,
      { method: "POST" },
    );
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(
      (
        database
          .prepare(
            "SELECT count(*) AS count FROM companies WHERE organization_id = 'org_northstar'",
          )
          .get() as { count: number }
      ).count,
    ).toBe(before + 1);
  });

  it("retains row errors and duplicate warnings and refuses mixed commits without partial writes", async () => {
    const owner = await signIn("owner@northstar.test", "OwnerPass!2026");
    const before = (
      database
        .prepare(
          "SELECT count(*) AS count FROM contacts WHERE organization_id = 'org_northstar'",
        )
        .get() as { count: number }
    ).count;
    const response = await request("/api/imports/preview", owner, {
      method: "POST",
      body: JSON.stringify({
        resource: "contacts",
        sourceName: "mixed.csv",
        csv: "First,Last,Email,Phone\nValid,Person,valid@example.test,+46701234567\nMissing,,bad-email,\nDuplicate,Existing,contact01@northstar.test,",
        mapping: {
          firstName: "First",
          lastName: "Last",
          email: "Email",
          phone: "Phone",
        },
      }),
    });
    const body = (await response.json()) as {
      import: {
        id: string;
        summary: { valid: number; warnings: number; errors: number };
        rows: Array<{ rowNumber: number; errors: string[] }>;
      };
    };
    expect(body.import.summary).toEqual({
      total: 3,
      valid: 1,
      warnings: 1,
      errors: 1,
    });
    expect(
      body.import.rows.find((row) => row.rowNumber === 3)?.errors,
    ).toContain("lastName is required.");
    expect(body.import.rows[0]?.errors).toEqual([]);
    const commit = await request(
      `/api/imports/${body.import.id}/commit`,
      owner,
      { method: "POST" },
    );
    expect(commit.status).toBe(409);
    expect(
      (
        database
          .prepare(
            "SELECT count(*) AS count FROM contacts WHERE organization_id = 'org_northstar'",
          )
          .get() as { count: number }
      ).count,
    ).toBe(before);
  });

  it("rejects malformed, formula-like, oversized, viewer, and foreign import access", async () => {
    const owner = await signIn("owner@northstar.test", "OwnerPass!2026");
    const viewer = await signIn("viewer@northstar.test", "ViewerPass!2026");
    const outside = await signIn(
      "other-owner@outside.test",
      "OutsidePass!2026",
    );
    const payload = {
      resource: "companies",
      sourceName: "unsafe.csv",
      csv: 'Name\n"unterminated',
      mapping: { name: "Name" },
    };
    expect(
      (
        await request("/api/imports/preview", owner, {
          method: "POST",
          body: JSON.stringify(payload),
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await request("/api/imports/preview", viewer, {
          method: "POST",
          body: JSON.stringify({ ...payload, csv: "Name\nValid" }),
        })
      ).status,
    ).toBe(403);
    const formula = await request("/api/imports/preview", owner, {
      method: "POST",
      body: JSON.stringify({ ...payload, csv: "Name\n=CMD()" }),
    });
    const formulaBody = (await formula.json()) as {
      import: { rows: Array<{ errors: string[] }> };
    };
    expect(formulaBody.import.rows[0]?.errors[0]).toContain("formula marker");
    expect(
      (
        await request("/api/imports/preview", owner, {
          method: "POST",
          body: JSON.stringify({
            ...payload,
            csv: `Name\n${"x".repeat(512 * 1024)}`,
          }),
        })
      ).status,
    ).toBe(400);
    expect(
      (await request(`/api/imports/${formulaBody.import.id}`, outside)).status,
    ).toBe(404);
  });

  it("exports stable filtered tenant-only CSV with quoting and formula neutralization", async () => {
    database
      .prepare(
        "UPDATE companies SET description = '=HYPERLINK(\"bad\")' WHERE id = 'company_northstar_03'",
      )
      .run();
    const viewer = await signIn("viewer@northstar.test", "ViewerPass!2026");
    const response = await request(
      "/api/exports/companies.csv?lifecycle=customer&q=Northstar",
      viewer,
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/csv");
    const csv = await response.text();
    expect(csv.split("\r\n")[0]).toBe(
      "name,externalReference,website,phone,industry,size,address,lifecycleStatus,tags,description",
    );
    expect(csv).not.toContain("Outside Company");
    expect(csv).toContain("'=HYPERLINK");

    expect((await fetch(`${baseUrl}/api/exports/companies.csv`)).status).toBe(
      401,
    );
    const outside = await signIn(
      "other-owner@outside.test",
      "OutsidePass!2026",
    );
    const outsideCsv = await (
      await request("/api/exports/companies.csv", outside)
    ).text();
    expect(outsideCsv).toContain("Outside Company");
    expect(outsideCsv).not.toContain("Northstar Company");

    for (const [query, predicate, value] of [
      ["companyId", "company_id", "company_northstar_01"],
      ["ownerId", "owner_membership_id", "membership_member"],
    ] as const) {
      const filtered = await (
        await request(
          `/api/exports/contacts.csv?${query}=${encodeURIComponent(value)}`,
          viewer,
        )
      ).text();
      const expected = (
        database
          .prepare(
            `SELECT count(*) AS count FROM contacts WHERE organization_id = 'org_northstar' AND archived_at IS NULL AND ${predicate} = ?`,
          )
          .get(value) as { count: number }
      ).count;
      expect(filtered.trimEnd().split("\r\n")).toHaveLength(expected + 1);
    }

    database
      .prepare(
        "UPDATE contacts SET phone = '+46709998877' WHERE id = 'contact_northstar_01'",
      )
      .run();
    const phoneFiltered = await (
      await request("/api/exports/contacts.csv?q=709998877", viewer)
    ).text();
    expect(phoneFiltered.trimEnd().split("\r\n")).toHaveLength(2);
    expect(phoneFiltered).toContain("contact01@northstar.test");
  });
});
