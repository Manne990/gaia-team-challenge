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
  if (server)
    await new Promise<void>((resolve) => server.close(() => resolve()));
  database?.close();
});

async function signIn(email: string, password: string) {
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

const contactInput = {
  firstName: "  CASEY ",
  lastName: "Rivera",
  email: " CASEY@Example.COM ",
  phone: "+46 70 123 45 67",
  jobTitle: "VP Sales",
  companyId: "company_northstar_01",
  ownerMembershipId: "membership_member",
  status: "active",
  tags: ["Priority", "priority", "Nordic"],
  communicationPreference: "email",
};

describe.sequential("contact HTTP boundary", () => {
  it("requires authentication and isolates list results by organization", async () => {
    expect((await fetch(`${baseUrl}/api/contacts`)).status).toBe(401);
    const owner = await signIn("owner@northstar.test", "OwnerPass!2026");
    const outside = await signIn(
      "other-owner@outside.test",
      "OutsidePass!2026",
    );

    const northstar = (await (
      await request("/api/contacts?pageSize=5&sort=name", owner)
    ).json()) as { items: Array<{ id: string }>; total: number };
    const other = (await (await request("/api/contacts", outside)).json()) as {
      items: Array<{ id: string }>;
      total: number;
    };
    expect(northstar.items).toHaveLength(5);
    expect(northstar.total).toBe(40);
    expect(
      northstar.items.every(({ id }) => id.startsWith("contact_northstar")),
    ).toBe(true);
    expect(other.total).toBe(1);
    expect(other.items[0]?.id).toBe("contact_outside_01");
  });

  it("creates normalized contacts, warns on duplicates, and returns retained history", async () => {
    const member = await signIn("member@northstar.test", "MemberPass!2026");
    const firstResponse = await request("/api/contacts", member, {
      method: "POST",
      body: JSON.stringify(contactInput),
    });
    expect(firstResponse.status).toBe(201);
    const first = (await firstResponse.json()) as {
      contact: {
        id: string;
        firstName: string;
        email: string;
        tags: string[];
        duplicateWarning: boolean;
      };
    };
    expect(first.contact).toMatchObject({
      firstName: "CASEY",
      email: "CASEY@Example.COM",
      tags: ["nordic", "priority"],
      duplicateWarning: false,
    });
    const tagFiltered = (await (
      await request(
        `/api/contacts?tag=${encodeURIComponent("Priority")}`,
        member,
      )
    ).json()) as { items: Array<{ id: string }> };
    expect(tagFiltered.items.map(({ id }) => id)).toContain(first.contact.id);

    const secondResponse = await request("/api/contacts", member, {
      method: "POST",
      body: JSON.stringify({
        ...contactInput,
        firstName: "Casey Duplicate",
        email: "casey@example.com",
      }),
    });
    expect(secondResponse.status).toBe(201);
    const detail = (await (
      await request(`/api/contacts/${first.contact.id}`, member)
    ).json()) as {
      contact: {
        duplicateWarning: boolean;
        company: { name: string };
        history: Array<{ action: string }>;
      };
    };
    expect(detail.contact.duplicateWarning).toBe(true);
    expect(detail.contact.company.name).toBe("Duplicate Trading Name");
    expect(detail.contact.history.map(({ action }) => action)).toContain(
      "contact.created",
    );
  });

  it("enforces viewer mutation denial and opaque foreign identifiers", async () => {
    const viewer = await signIn("viewer@northstar.test", "ViewerPass!2026");
    const owner = await signIn("owner@northstar.test", "OwnerPass!2026");
    expect(
      (
        await request("/api/contacts", viewer, {
          method: "POST",
          body: JSON.stringify(contactInput),
        })
      ).status,
    ).toBe(403);
    expect(
      (await request("/api/contacts/contact_outside_01", owner)).status,
    ).toBe(404);
    expect(
      (
        await request("/api/contacts", owner, {
          method: "POST",
          body: JSON.stringify({
            ...contactInput,
            companyId: "company_outside_01",
          }),
        })
      ).status,
    ).toBe(404);
  });

  it("archives, excludes, restores, and rejects stale edits deterministically", async () => {
    const owner = await signIn("owner@northstar.test", "OwnerPass!2026");
    const created = (await (
      await request("/api/contacts", owner, {
        method: "POST",
        body: JSON.stringify(contactInput),
      })
    ).json()) as { contact: { id: string; version: number } };
    const id = created.contact.id;
    expect(
      (await request(`/api/contacts/${id}/archive`, owner, { method: "POST" }))
        .status,
    ).toBe(200);
    const defaultList = (await (
      await request(`/api/contacts?q=CASEY`, owner)
    ).json()) as { total: number };
    const archivedList = (await (
      await request(`/api/contacts?q=CASEY&includeArchived=true`, owner)
    ).json()) as { total: number };
    expect(defaultList.total).toBe(0);
    expect(archivedList.total).toBe(1);
    expect(
      (await request(`/api/contacts/${id}/restore`, owner, { method: "POST" }))
        .status,
    ).toBe(200);
    const stale = await request(`/api/contacts/${id}`, owner, {
      method: "PATCH",
      body: JSON.stringify({
        ...contactInput,
        version: created.contact.version,
      }),
    });
    expect(stale.status).toBe(409);
  });

  it("retains the contact and activity facts when company display facts change", async () => {
    const owner = await signIn("owner@northstar.test", "OwnerPass!2026");
    database
      .prepare(
        "UPDATE companies SET name = 'Renamed Account', version = version + 1 WHERE id = 'company_northstar_01'",
      )
      .run();
    const detail = (await (
      await request("/api/contacts/contact_northstar_01", owner)
    ).json()) as {
      contact: {
        company: { name: string };
        activities: Array<{ subject: string }>;
      };
    };
    expect(detail.contact.company.name).toBe("Renamed Account");
    expect(detail.contact.activities[0]?.subject).toBe(
      "Historical touchpoint 1",
    );
  });
});
