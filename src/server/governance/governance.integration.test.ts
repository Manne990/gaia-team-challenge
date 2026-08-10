// @vitest-environment node
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { migrate, openDatabase, type CrmDatabase } from "../../db/database.js";
import { seedDatabase } from "../../db/seed.js";
import { createApp } from "../app.js";

let db: CrmDatabase;
let server: ReturnType<ReturnType<typeof createApp>["listen"]>;
let baseUrl: string;

beforeEach(async () => {
  db = openDatabase(":memory:");
  migrate(db);
  seedDatabase(db);
  server = createApp(db).listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterEach(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  db.close();
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

describe.sequential("organization governance and append-only audit", () => {
  it("creates and revokes a member without recording credentials", async () => {
    const owner = await signIn("owner@northstar.test", "OwnerPass!2026");
    const created = await request(owner, "/api/admin/members", {
      method: "POST",
      body: JSON.stringify({
        email: "new.member@northstar.test",
        displayName: "New Member",
        password: "TemporaryPass!2026",
        role: "member",
      }),
    });
    expect(created.status).toBe(201);
    const body = (await created.json()) as {
      member: { userId: string; role: string; email: string };
    };
    expect(body.member).toMatchObject({
      email: "new.member@northstar.test",
      role: "member",
    });
    const member = await signIn(
      "new.member@northstar.test",
      "TemporaryPass!2026",
    );
    expect((await request(member, "/api/admin/organization")).status).toBe(403);

    const auditText = JSON.stringify(
      db
        .prepare("SELECT * FROM audit_events WHERE action='membership.created'")
        .all(),
    );
    expect(auditText).not.toContain("TemporaryPass!2026");
    expect(auditText).not.toContain("password");
    expect(auditText).not.toContain(member.split("=")[1]);

    expect(
      (
        await request(owner, `/api/admin/members/${body.member.userId}`, {
          method: "DELETE",
        })
      ).status,
    ).toBe(200);
    expect((await request(member, "/api/auth/session")).status).toBe(401);
  });

  it("protects the last owner, rejects stale settings, and revokes a transferred owner", async () => {
    const owner = await signIn("owner@northstar.test", "OwnerPass!2026");
    expect(
      (
        await request(owner, "/api/admin/members/user_owner", {
          method: "DELETE",
        })
      ).status,
    ).toBe(409);
    expect(
      (
        await request(owner, "/api/admin/members/user_owner", {
          method: "PATCH",
          body: JSON.stringify({ role: "member" }),
        })
      ).status,
    ).toBe(409);

    const current = (await (
      await request(owner, "/api/admin/organization")
    ).json()) as { organization: { version: number; name: string } };
    const updated = await request(owner, "/api/admin/organization", {
      method: "PATCH",
      body: JSON.stringify({
        name: "Northstar Revenue",
        version: current.organization.version,
      }),
    });
    expect(updated.status).toBe(200);
    expect(
      (
        await request(owner, "/api/admin/organization", {
          method: "PATCH",
          body: JSON.stringify({
            name: "Stale overwrite",
            version: current.organization.version,
          }),
        })
      ).status,
    ).toBe(409);
    expect(
      (
        db
          .prepare("SELECT name FROM organizations WHERE id='org_northstar'")
          .get() as { name: string }
      ).name,
    ).toBe("Northstar Revenue");

    const successor = await request(owner, "/api/admin/members", {
      method: "POST",
      body: JSON.stringify({
        email: "successor@northstar.test",
        displayName: "Successor Owner",
        password: "SuccessorPass!2026",
        role: "owner",
      }),
    });
    expect(successor.status).toBe(201);
    expect(
      (
        await request(owner, "/api/admin/members/user_owner", {
          method: "DELETE",
        })
      ).status,
    ).toBe(200);
    expect((await request(owner, "/api/auth/session")).status).toBe(401);
  });

  it("propagates request correlation and filters audit without foreign counts", async () => {
    const owner = await signIn("owner@northstar.test", "OwnerPass!2026");
    const organization = (await (
      await request(owner, "/api/admin/organization")
    ).json()) as { organization: { version: number } };
    const changed = await request(owner, "/api/admin/organization", {
      method: "PATCH",
      body: JSON.stringify({
        name: "Northstar Correlated",
        version: organization.organization.version,
      }),
    });
    const correlationId = changed.headers.get("x-request-id");
    expect(correlationId).toBeTruthy();

    const filtered = await request(
      owner,
      "/api/audit?action=organization.updated&page=1&pageSize=1",
    );
    expect(filtered.status).toBe(200);
    const result = (await filtered.json()) as {
      items: Array<{
        action: string;
        correlationId: string;
        summary: { name: string };
      }>;
      total: number;
      totalPages: number;
    };
    expect(result).toMatchObject({ total: 1, totalPages: 1 });
    expect(result.items[0]).toMatchObject({
      action: "organization.updated",
      correlationId,
      summary: { name: "Northstar Correlated" },
    });

    const outside = await signIn(
      "other-owner@outside.test",
      "OutsidePass!2026",
    );
    const outsideAudit = (await (
      await request(outside, "/api/audit?action=organization.updated")
    ).json()) as { total: number; items: unknown[] };
    expect(outsideAudit).toEqual(
      expect.objectContaining({ total: 0, items: [] }),
    );
  });

  it("enforces append-only storage and exposes no mutation API", async () => {
    const owner = await signIn("owner@northstar.test", "OwnerPass!2026");
    await request(owner, "/api/admin/members/user_member", {
      method: "PATCH",
      body: JSON.stringify({ role: "viewer" }),
    });
    const event = db
      .prepare(
        "SELECT id FROM audit_events WHERE action='membership.role_updated'",
      )
      .get() as { id: string };
    expect(() =>
      db
        .prepare("UPDATE audit_events SET action='tampered' WHERE id=?")
        .run(event.id),
    ).toThrow("audit events are append-only");
    expect(() =>
      db.prepare("DELETE FROM audit_events WHERE id=?").run(event.id),
    ).toThrow("audit events are append-only");
    expect(
      (
        await request(owner, `/api/audit/${event.id}`, {
          method: "DELETE",
        })
      ).status,
    ).toBe(404);
    expect(
      (
        db
          .prepare("SELECT action FROM audit_events WHERE id=?")
          .get(event.id) as { action: string }
      ).action,
    ).toBe("membership.role_updated");
  });
});
