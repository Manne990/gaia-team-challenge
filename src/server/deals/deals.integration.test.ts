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
const input = {
  name: "Nordic Expansion",
  companyId: "company_northstar_01",
  ownerMembershipId: "membership_member",
  stageId: "stage_northstar_lead",
  amountMinor: 123456,
  currency: "sek",
  probability: 35,
  expectedCloseDate: "2026-10-20",
  contactIds: ["contact_northstar_01"],
};

describe.sequential("deal and pipeline API", () => {
  it("lists tenant-scoped filtered deals with shared aggregates", async () => {
    expect((await fetch(`${baseUrl}/api/deals`)).status).toBe(401);
    const viewer = await signIn("viewer@northstar.test", "ViewerPass!2026"),
      outside = await signIn("other-owner@outside.test", "OutsidePass!2026");
    const response = await request(
      viewer,
      "/api/deals?pageSize=5&stageId=stage_northstar_lead&sort=amount&order=asc",
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      items: Array<{ id: string; amountMinor: number }>;
      total: number;
      totals: { amountMinor: string };
      stages: unknown[];
    };
    expect(body.items).toHaveLength(5);
    expect(body.total).toBeGreaterThan(5);
    expect(body.items.map(({ amountMinor }) => amountMinor)).toEqual(
      [...body.items.map(({ amountMinor }) => amountMinor)].sort(
        (a, b) => a - b,
      ),
    );
    expect(BigInt(body.totals.amountMinor)).toBeGreaterThan(0n);
    expect(JSON.stringify(body)).not.toContain("outside");
    expect(
      (
        await request(viewer, "/api/deals", {
          method: "POST",
          body: JSON.stringify(input),
        })
      ).status,
    ).toBe(403);
    const foreign = await request(outside, "/api/deals");
    expect(((await foreign.json()) as { total: number }).total).toBe(0);
  });

  it("creates edits archives and restores money and relationships with conflicts", async () => {
    const member = await signIn("member@northstar.test", "MemberPass!2026");
    const createdResponse = await request(member, "/api/deals", {
      method: "POST",
      body: JSON.stringify(input),
    });
    expect(createdResponse.status).toBe(201);
    const created = (await createdResponse.json()) as {
      deal: {
        id: string;
        version: number;
        currency: string;
        contactIds: string[];
        auditHistory: Array<{ action: string }>;
      };
    };
    expect(created.deal).toMatchObject({
      amountMinor: 123456,
      currency: "SEK",
      contactIds: ["contact_northstar_01"],
      version: 1,
    });
    expect(created.deal.auditHistory.map(({ action }) => action)).toContain(
      "deal.created",
    );
    const updated = await request(member, `/api/deals/${created.deal.id}`, {
      method: "PUT",
      body: JSON.stringify({
        ...input,
        name: "Nordic Expansion II",
        version: 1,
      }),
    });
    expect(updated.status).toBe(200);
    const conflict = await request(member, `/api/deals/${created.deal.id}`, {
      method: "PUT",
      body: JSON.stringify({ ...input, version: 1 }),
    });
    expect(conflict.status).toBe(409);
    expect(
      (
        await request(member, `/api/deals/${created.deal.id}/archive`, {
          method: "POST",
        })
      ).status,
    ).toBe(200);
    expect(
      (
        (await request(member, "/api/deals?q=Nordic Expansion II").then((r) =>
          r.json(),
        )) as { total: number }
      ).total,
    ).toBe(0);
    expect(
      (
        await request(member, `/api/deals/${created.deal.id}/restore`, {
          method: "POST",
        })
      ).status,
    ).toBe(200);
  });

  it("returns exact aggregates when accepted safe amounts sum beyond the JavaScript integer range", async () => {
    const member = await signIn("member@northstar.test", "MemberPass!2026");
    for (let index = 1; index <= 3; index += 1) {
      const response = await request(member, "/api/deals", {
        method: "POST",
        body: JSON.stringify({
          ...input,
          name: `Exact Aggregate ${index}`,
          amountMinor: Number.MAX_SAFE_INTEGER,
          currency: "USD",
          contactIds: [],
        }),
      });
      expect(response.status).toBe(201);
    }
    const list = (await (
      await request(member, "/api/deals?q=Exact%20Aggregate")
    ).json()) as {
      totals: {
        amountMinor: string;
        byCurrency: Array<{ currency: string; amountMinor: string }>;
      };
    };
    expect(list.totals.amountMinor).toBe("27021597764222973");
    expect(list.totals.byCurrency).toEqual([
      { currency: "USD", amountMinor: "27021597764222973" },
    ]);
  });

  it("requires valid outcomes and preserves transactional transition history including reopen", async () => {
    const owner = await signIn("owner@northstar.test", "OwnerPass!2026");
    const created = (await request(owner, "/api/deals", {
      method: "POST",
      body: JSON.stringify(input),
    }).then((r) => r.json())) as { deal: { id: string; version: number } };
    const invalid = await request(
      owner,
      `/api/deals/${created.deal.id}/transition`,
      {
        method: "POST",
        body: JSON.stringify({ stageId: "stage_northstar_lost", version: 1 }),
      },
    );
    expect(invalid.status).toBe(400);
    const lost = (await request(
      owner,
      `/api/deals/${created.deal.id}/transition`,
      {
        method: "POST",
        body: JSON.stringify({
          stageId: "stage_northstar_lost",
          lossReason: "Budget withdrawn",
          version: 1,
        }),
      },
    ).then((r) => r.json())) as {
      deal: {
        status: string;
        probability: number;
        lossReason: string;
        version: number;
        stageHistory: unknown[];
      };
    };
    expect(lost.deal).toMatchObject({
      status: "lost",
      probability: 0,
      lossReason: "Budget withdrawn",
      version: 2,
    });
    expect(lost.deal.stageHistory).toHaveLength(2);
    const reopened = (await request(
      owner,
      `/api/deals/${created.deal.id}/transition`,
      {
        method: "POST",
        body: JSON.stringify({
          stageId: "stage_northstar_qualified",
          version: 2,
        }),
      },
    ).then((r) => r.json())) as {
      deal: {
        status: string;
        lossReason: null;
        version: number;
        stageHistory: unknown[];
      };
    };
    expect(reopened.deal).toMatchObject({
      status: "open",
      lossReason: null,
      version: 3,
    });
    expect(reopened.deal.stageHistory).toHaveLength(3);
  });

  it("restricts stage configuration to owners and preserves historical stages", async () => {
    const viewer = await signIn("viewer@northstar.test", "ViewerPass!2026"),
      owner = await signIn("owner@northstar.test", "OwnerPass!2026");
    expect(
      (
        await request(viewer, "/api/pipeline/stages", {
          method: "POST",
          body: JSON.stringify({ name: "Review", position: 10, kind: "open" }),
        })
      ).status,
    ).toBe(403);
    const created = await request(owner, "/api/pipeline/stages", {
      method: "POST",
      body: JSON.stringify({ name: "Review", position: 10, kind: "open" }),
    });
    expect(created.status).toBe(201);
    const stage = (await created.json()) as {
      stage: { id: string; version: number };
    };
    const updated = await request(
      owner,
      `/api/pipeline/stages/${stage.stage.id}`,
      {
        method: "PUT",
        body: JSON.stringify({
          name: "Final review",
          position: 10,
          kind: "open",
          version: stage.stage.version,
        }),
      },
    );
    expect(updated.status).toBe(200);
    const deactivated = await request(
      owner,
      `/api/pipeline/stages/${stage.stage.id}/deactivate`,
      { method: "POST" },
    );
    expect(deactivated.status).toBe(200);
    const active = (await request(owner, "/api/pipeline/stages").then((r) =>
      r.json(),
    )) as { stages: Array<{ id: string }> };
    expect(active.stages.map(({ id }) => id)).not.toContain(stage.stage.id);
    const all = (await request(
      owner,
      "/api/pipeline/stages?includeInactive=true",
    ).then((r) => r.json())) as {
      stages: Array<{ id: string; active: number }>;
    };
    expect(all.stages).toContainEqual(
      expect.objectContaining({ id: stage.stage.id, active: 0 }),
    );
  });
});
