// @vitest-environment node
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { migrate, openDatabase, type CrmDatabase } from "../../db/database.js";
import { seedDatabase } from "../../db/seed.js";
import { createApp } from "../app.js";

let database: CrmDatabase,
  server: ReturnType<ReturnType<typeof createApp>["listen"]>,
  baseUrl: string;
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
const request = (cookie: string, path: string, init: RequestInit = {}) =>
  fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      cookie,
      ...(init.body ? { "content-type": "application/json" } : {}),
      ...init.headers,
    },
  });

describe.sequential("global search and saved views", () => {
  it("groups stable useful results after tenant scoping and handles no-match and volume limits", async () => {
    expect((await fetch(`${baseUrl}/api/search?q=Northstar`)).status).toBe(401);
    const viewer = await signIn("viewer@northstar.test", "ViewerPass!2026"),
      outside = await signIn("other-owner@outside.test", "OutsidePass!2026");
    const response = await request(viewer, "/api/search?q=Northstar&limit=3");
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      groups: Array<{
        resource: string;
        items: Array<{
          id: string;
          title: string;
          context: string;
          href: string;
        }>;
      }>;
    };
    expect(body.groups.map(({ resource }) => resource)).toEqual([
      "companies",
      "contacts",
      "deals",
      "tasks",
    ]);
    expect(body.groups.every(({ items }) => items.length <= 3)).toBe(true);
    expect(JSON.stringify(body)).not.toContain("outside");
    for (const group of body.groups)
      expect(group.items.map(({ title }) => title)).toEqual(
        [...group.items.map(({ title }) => title)].sort((a, b) =>
          a.localeCompare(b),
        ),
      );
    const foreign = await request(outside, "/api/search?q=Northstar").then(
      (r) => r.json(),
    );
    expect(JSON.stringify(foreign)).not.toContain("Northstar Company");
    const short = (await request(viewer, "/api/search?q=N").then((r) =>
      r.json(),
    )) as { groups: Array<{ items: unknown[] }> };
    expect(short.groups.every(({ items }) => items.length === 0)).toBe(true);
    const none = (await request(
      viewer,
      "/api/search?q=NoSuchRecordAnywhere",
    ).then((r) => r.json())) as { groups: Array<{ items: unknown[] }> };
    expect(none.groups.every(({ items }) => items.length === 0)).toBe(true);
  });

  it("creates renames updates selects and deletes membership-personal views with concurrency", async () => {
    const member = await signIn("member@northstar.test", "MemberPass!2026"),
      owner = await signIn("owner@northstar.test", "OwnerPass!2026");
    const createdResponse = await request(member, "/api/saved-views", {
      method: "POST",
      body: JSON.stringify({
        resource: "deals",
        name: "My pipeline",
        state: { status: "open", stageId: "stage_northstar_lead", page: "2" },
      }),
    });
    expect(createdResponse.status).toBe(201);
    const created = (await createdResponse.json()) as {
      view: { id: string; version: number };
    };
    const own = (await request(member, "/api/saved-views?resource=deals").then(
      (r) => r.json(),
    )) as { items: Array<{ id: string; state: Record<string, string> }> };
    expect(own.items).toContainEqual(
      expect.objectContaining({
        id: created.view.id,
        state: { status: "open", stageId: "stage_northstar_lead", page: "2" },
      }),
    );
    const other = (await request(owner, "/api/saved-views?resource=deals").then(
      (r) => r.json(),
    )) as { items: unknown[] };
    expect(other.items).toHaveLength(0);
    const updated = await request(
      member,
      `/api/saved-views/${created.view.id}`,
      {
        method: "PUT",
        body: JSON.stringify({
          name: "Focused pipeline",
          state: { status: "won", sort: "amount" },
          version: 1,
        }),
      },
    );
    expect(updated.status).toBe(200);
    expect(
      (
        await request(member, `/api/saved-views/${created.view.id}`, {
          method: "PUT",
          body: JSON.stringify({ name: "Stale", state: {}, version: 1 }),
        })
      ).status,
    ).toBe(409);
    expect(
      (
        await request(owner, `/api/saved-views/${created.view.id}`, {
          method: "DELETE",
          body: JSON.stringify({ version: 2 }),
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await request(member, `/api/saved-views/${created.view.id}`, {
          method: "DELETE",
          body: JSON.stringify({ version: 2 }),
        })
      ).status,
    ).toBe(204);
  });

  it("rejects unsupported definitions and safely sanitizes stale persisted view state", async () => {
    const member = await signIn("member@northstar.test", "MemberPass!2026");
    const invalid = await request(member, "/api/saved-views", {
      method: "POST",
      body: JSON.stringify({
        resource: "contacts",
        name: "Unsafe",
        state: { unknownFilter: "secret" },
      }),
    });
    expect(invalid.status).toBe(400);
    database
      .prepare(
        "INSERT INTO saved_views (id,organization_id,owner_membership_id,resource,name,state_json,created_at,updated_at) VALUES ('view_stale','org_northstar','membership_member','contacts','Stale','{\"q\":\"Casey\",\"removed\":42}','2026-01-15','2026-01-15')",
      )
      .run();
    const list = (await request(
      member,
      "/api/saved-views?resource=contacts",
    ).then((r) => r.json())) as {
      items: Array<{ id: string; state: Record<string, string> }>;
    };
    expect(list.items).toContainEqual(
      expect.objectContaining({ id: "view_stale", state: { q: "Casey" } }),
    );
  });
});
