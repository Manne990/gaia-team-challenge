import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../app.js";
import { migrate, openDatabase, type CrmDatabase } from "../../db/database.js";
import { seedDatabase } from "../../db/seed.js";
import { createTemporaryDatabase } from "../../../tests/support/isolation.js";

let database: CrmDatabase;
let cleanup: () => Promise<void>;
let server: ReturnType<ReturnType<typeof createApp>["listen"]>;
let baseUrl: string;

beforeEach(async () => {
  const temporary = await createTemporaryDatabase();
  cleanup = temporary.cleanup;
  database = openDatabase(temporary.databasePath);
  migrate(database);
  seedDatabase(database);
  server = createApp(database).listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterEach(async () => {
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  database.close();
  await cleanup();
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

const completeCompany = {
  name: "Aperture Accounts",
  externalReference: "ORG-4242",
  website: "https://aperture.example",
  phone: "+1 555 0100",
  industry: "Research",
  size: "51-200",
  address: "100 Test Chamber Way",
  lifecycleStatus: "prospect",
  ownerMembershipId: "membership_member",
  tags: ["priority", "research"],
  description: "A complete deterministic account.",
};

async function companyRequest(cookie: string, path = "", init?: RequestInit) {
  return fetch(`${baseUrl}/api/companies${path}`, {
    ...init,
    headers: { "content-type": "application/json", cookie, ...init?.headers },
  });
}

describe.sequential("company API", () => {
  it("lists with tenant-safe server pagination sorting and combined filters", async () => {
    const cookie = await signIn("viewer@northstar.test", "ViewerPass!2026");
    const response = await companyRequest(
      cookie,
      "?page=2&pageSize=5&sort=name&direction=asc&industry=Technology&tag=priority&q=Northstar",
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      items: Array<{ name: string; tags: string[] }>;
      page: number;
      pageSize: number;
      total: number;
    };
    expect(body).toMatchObject({ page: 2, pageSize: 5, total: 17 });
    expect(body.items).toHaveLength(5);
    expect(
      body.items.every((company) => company.tags.includes("priority")),
    ).toBe(true);
    expect(body.items.map((company) => company.name)).toEqual(
      [...body.items.map((company) => company.name)].sort(),
    );
    expect(JSON.stringify(body)).not.toContain("Outside Company");
  });

  it("creates updates archives and restores complete companies with safe history and conflicts", async () => {
    const cookie = await signIn("member@northstar.test", "MemberPass!2026");
    const createdResponse = await companyRequest(cookie, "", {
      method: "POST",
      body: JSON.stringify(completeCompany),
    });
    expect(createdResponse.status).toBe(201);
    const created = (await createdResponse.json()) as {
      company: { id: string; version: number; website: string };
      history: unknown[];
    };
    expect(created.company).toMatchObject({
      version: 1,
      website: completeCompany.website,
    });
    expect(created.history).toHaveLength(1);

    const duplicate = await companyRequest(cookie, "", {
      method: "POST",
      body: JSON.stringify({
        ...completeCompany,
        name: "Duplicate ref",
        externalReference: completeCompany.externalReference.toLowerCase(),
      }),
    });
    expect(duplicate.status).toBe(409);
    expect(await duplicate.json()).toMatchObject({
      code: "CONFLICT",
      error: expect.stringContaining("external reference"),
    });

    const invalidWebsite = await companyRequest(cookie, "", {
      method: "POST",
      body: JSON.stringify({
        ...completeCompany,
        externalReference: "ORG-OTHER",
        website: "not a URL",
      }),
    });
    expect(invalidWebsite.status).toBe(400);
    expect(await invalidWebsite.json()).toMatchObject({
      code: "VALIDATION_ERROR",
    });

    const updatedResponse = await companyRequest(
      cookie,
      `/${created.company.id}`,
      {
        method: "PUT",
        body: JSON.stringify({
          ...completeCompany,
          name: "Aperture Science",
          version: created.company.version,
        }),
      },
    );
    expect(updatedResponse.status).toBe(200);
    const updated = (await updatedResponse.json()) as {
      company: { version: number };
      history: unknown[];
    };
    expect(updated.company.version).toBe(2);
    expect(updated.history).toHaveLength(2);

    const stale = await companyRequest(cookie, `/${created.company.id}`, {
      method: "PUT",
      body: JSON.stringify({ ...completeCompany, version: 1 }),
    });
    expect(stale.status).toBe(409);
    expect(await stale.json()).toMatchObject({ code: "VERSION_CONFLICT" });

    expect(
      (
        await companyRequest(cookie, `/${created.company.id}/archive`, {
          method: "POST",
        })
      ).status,
    ).toBe(200);
    const activeList = (await (
      await companyRequest(
        cookie,
        `?q=${encodeURIComponent("Aperture Science")}`,
      )
    ).json()) as { total: number };
    expect(activeList.total).toBe(0);
    const archivedList = (await (
      await companyRequest(
        cookie,
        `?archived=include&q=${encodeURIComponent("Aperture Science")}`,
      )
    ).json()) as { total: number };
    expect(archivedList.total).toBe(1);
    expect(
      (
        await companyRequest(cookie, `/${created.company.id}/restore`, {
          method: "POST",
        })
      ).status,
    ).toBe(200);
  });

  it("enforces viewer mutation denial and non-disclosing foreign behavior without side effects", async () => {
    const viewer = await signIn("viewer@northstar.test", "ViewerPass!2026");
    expect(
      (
        await companyRequest(viewer, "", {
          method: "POST",
          body: JSON.stringify(completeCompany),
        })
      ).status,
    ).toBe(403);

    const owner = await signIn("owner@northstar.test", "OwnerPass!2026");
    const before = database
      .prepare("SELECT * FROM companies WHERE id = 'company_outside_01'")
      .get();
    expect((await companyRequest(owner, "/company_outside_01")).status).toBe(
      404,
    );
    expect(
      (
        await companyRequest(owner, "/company_outside_01", {
          method: "PUT",
          body: JSON.stringify(completeCompany),
        })
      ).status,
    ).toBe(404);
    expect(
      database
        .prepare("SELECT * FROM companies WHERE id = 'company_outside_01'")
        .get(),
    ).toEqual(before);
  });

  it("returns related contacts activities deals tasks ownership and history in detail", async () => {
    const cookie = await signIn("owner@northstar.test", "OwnerPass!2026");
    const response = await companyRequest(cookie, "/company_northstar_01");
    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown[]> & {
      company: { ownerName: string };
    };
    expect(body.company.ownerName).toBe("Northstar Owner");
    expect(body.contacts.length).toBeGreaterThan(0);
    expect(body.activities.length).toBeGreaterThan(0);
    expect(body.deals.length).toBeGreaterThan(0);
    expect(body.tasks.length).toBeGreaterThan(0);
    expect(body.history).toEqual([]);
  });
});
