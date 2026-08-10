// @vitest-environment node
/* eslint-disable @typescript-eslint/no-explicit-any -- compact HTTP boundary fixture decoding */
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { migrate, openDatabase, type CrmDatabase } from "../../db/database.js";
import { seedDatabase } from "../../db/seed.js";
import { createApp } from "../app.js";

let database: CrmDatabase,
  server: Server,
  baseUrl: string,
  directory: string,
  databasePath: string;
beforeEach(async () => {
  directory = mkdtempSync(join(tmpdir(), "northstar-activities-"));
  databasePath = join(directory, "crm.sqlite");
  database = openDatabase(databasePath);
  migrate(database);
  seedDatabase(database);
  server = createApp(database).listen(0, "127.0.0.1");
  await new Promise<void>((r) => server.once("listening", r));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterEach(async () => {
  await new Promise<void>((r) => server.close(() => r()));
  database.close();
  rmSync(directory, { recursive: true, force: true });
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
const input = {
  type: "meeting",
  subject: "Renewal review",
  body: "Agreed next steps",
  occurredAt: "2026-08-10T09:00:00.000Z",
  companyId: "company_northstar_01",
  contactId: "contact_northstar_01",
  participantContactIds: ["contact_northstar_02"],
  followUp: {
    title: "Send renewal proposal",
    description: "Include revised pricing",
    assigneeMembershipId: "membership_member",
    dueAt: "2026-08-12T12:00:00.000Z",
    priority: "high",
  },
};

describe.sequential("activity timeline HTTP boundary", () => {
  it("creates an activity and linked follow-up atomically and exposes provenance", async () => {
    const member = await signIn("member@northstar.test", "MemberPass!2026");
    const response = await request("/api/activities", member, {
      method: "POST",
      body: JSON.stringify(input),
    });
    expect(response.status).toBe(201);
    const { activity } = (await response.json()) as { activity: any };
    expect(activity.creatorLabel).toBe("Northstar Member");
    expect(activity.followUpTitle).toBe("Send renewal proposal");
    expect(activity.participants).toEqual([
      { id: "contact_northstar_02", label: expect.any(String) },
    ]);
    expect(
      (
        database
          .prepare("SELECT count(*) count FROM tasks WHERE id=?")
          .get(activity.followUpTaskId) as { count: number }
      ).count,
    ).toBe(1);
  });
  it("rolls back both records when any related record is foreign", async () => {
    const member = await signIn("member@northstar.test", "MemberPass!2026");
    const before = (
      database.prepare("SELECT count(*) count FROM tasks").get() as {
        count: number;
      }
    ).count;
    const response = await request("/api/activities", member, {
      method: "POST",
      body: JSON.stringify({ ...input, contactId: "contact_outside_01" }),
    });
    expect(response.status).toBe(404);
    expect(
      (
        database.prepare("SELECT count(*) count FROM tasks").get() as {
          count: number;
        }
      ).count,
    ).toBe(before);
  });
  it("supports stable pagination and type, author, relation, and date filters", async () => {
    const owner = await signIn("owner@northstar.test", "OwnerPass!2026");
    const response = await request(
      "/api/activities?page=1&pageSize=5&type=meeting&authorId=membership_member&companyId=company_northstar_01&from=2020-01-01T00%3A00%3A00.000Z&to=2030-01-01T00%3A00%3A00.000Z",
      owner,
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as { items: any[] };
    expect(body.items.length).toBeLessThanOrEqual(5);
    expect(
      body.items.every(
        (a) =>
          a.type === "meeting" &&
          a.creatorMembershipId === "membership_member" &&
          a.companyId === "company_northstar_01",
      ),
    ).toBe(true);
    expect(
      body.items.map((a) => `${a.occurredAt}/${a.createdAt}/${a.id}`),
    ).toEqual(
      [...body.items]
        .sort((a, b) =>
          `${b.occurredAt}/${b.createdAt}/${b.id}`.localeCompare(
            `${a.occurredAt}/${a.createdAt}/${a.id}`,
          ),
        )
        .map((a) => `${a.occurredAt}/${a.createdAt}/${a.id}`),
    );
  });
  it("allows viewers to read, rejects writes, isolates organizations, and reports edit conflicts", async () => {
    const viewer = await signIn("viewer@northstar.test", "ViewerPass!2026"),
      outside = await signIn("other-owner@outside.test", "OutsidePass!2026"),
      member = await signIn("member@northstar.test", "MemberPass!2026");
    expect((await request("/api/activities", viewer)).status).toBe(200);
    expect(
      (
        await request("/api/activities", viewer, {
          method: "POST",
          body: JSON.stringify(input),
        })
      ).status,
    ).toBe(403);
    const created = (await (
      await request("/api/activities", member, {
        method: "POST",
        body: JSON.stringify({ ...input, followUp: null }),
      })
    ).json()) as { activity: any };
    expect(
      (await request(`/api/activities/${created.activity.id}`, outside)).status,
    ).toBe(404);
    const edit = {
      ...input,
      followUp: undefined,
      participantContactIds: [],
      version: created.activity.version,
    };
    const concurrent = await Promise.all([
      request(`/api/activities/${created.activity.id}`, member, {
        method: "PATCH",
        body: JSON.stringify({ ...edit, subject: "Concurrent correction A" }),
      }),
      request(`/api/activities/${created.activity.id}`, member, {
        method: "PATCH",
        body: JSON.stringify({ ...edit, subject: "Concurrent correction B" }),
      }),
    ]);
    expect(concurrent.map(({ status }) => status).sort()).toEqual([200, 409]);
  });
  it("retains safe creator and related labels after later changes and a database restart", async () => {
    const member = await signIn("member@northstar.test", "MemberPass!2026");
    const { activity } = (await (
      await request("/api/activities", member, {
        method: "POST",
        body: JSON.stringify({ ...input, followUp: null }),
      })
    ).json()) as { activity: any };
    database
      .prepare("UPDATE users SET display_name='Renamed' WHERE id='user_member'")
      .run();
    database
      .prepare(
        "UPDATE companies SET name='Renamed company', archived_at='2026-08-10T12:00:00.000Z' WHERE id='company_northstar_01'",
      )
      .run();
    database
      .prepare(
        "UPDATE contacts SET first_name='Renamed' WHERE id='contact_northstar_02'",
      )
      .run();
    const corrected = await request(`/api/activities/${activity.id}`, member, {
      method: "PATCH",
      body: JSON.stringify({
        ...input,
        followUp: undefined,
        subject: "Corrected without changing relationships",
        version: activity.version,
      }),
    });
    expect(corrected.status).toBe(200);
    const correctedActivity = (await corrected.json()) as { activity: any };
    expect(correctedActivity.activity.companyLabel).not.toBe("Renamed company");
    expect(correctedActivity.activity.participants[0].label).not.toContain(
      "Renamed",
    );
    await new Promise<void>((r) => server.close(() => r()));
    database.close();
    database = openDatabase(databasePath);
    migrate(database);
    server = createApp(database).listen(0, "127.0.0.1");
    await new Promise<void>((r) => server.once("listening", r));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const restartedMember = await signIn(
      "member@northstar.test",
      "MemberPass!2026",
    );
    const retained = (await (
      await request(`/api/activities/${activity.id}`, restartedMember)
    ).json()) as { activity: any };
    expect(retained.activity.creatorLabel).toBe("Northstar Member");
    expect(retained.activity.companyLabel).not.toBe("Renamed company");
  });
  it("deletes through the creator window without crossing tenant or viewer boundaries", async () => {
    const member = await signIn("member@northstar.test", "MemberPass!2026"),
      viewer = await signIn("viewer@northstar.test", "ViewerPass!2026"),
      outside = await signIn("other-owner@outside.test", "OutsidePass!2026");
    const { activity } = (await (
      await request("/api/activities", member, {
        method: "POST",
        body: JSON.stringify({ ...input, followUp: null }),
      })
    ).json()) as { activity: any };
    expect(
      (
        await request(`/api/activities/${activity.id}`, outside, {
          method: "DELETE",
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await request(`/api/activities/${activity.id}`, viewer, {
          method: "DELETE",
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await request(`/api/activities/${activity.id}`, member, {
          method: "DELETE",
        })
      ).status,
    ).toBe(204);
    expect(
      (await request(`/api/activities/${activity.id}`, member)).status,
    ).toBe(404);
    expect(
      database
        .prepare(
          "SELECT action,entity_id entityId FROM audit_events WHERE organization_id=? AND action='activity.deleted' ORDER BY occurred_at DESC LIMIT 1",
        )
        .get("org_northstar"),
    ).toEqual({ action: "activity.deleted", entityId: activity.id });
  });
});
