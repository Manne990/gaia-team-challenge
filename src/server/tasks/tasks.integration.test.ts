// @vitest-environment node
import type { AddressInfo } from "node:net";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { migrate, openDatabase, type CrmDatabase } from "../../db/database.js";
import { seedDatabase } from "../../db/seed.js";
import { createApp } from "../app.js";
import type { SessionIdentity } from "../auth/index.js";
import { TaskService } from "./service.js";

let database: CrmDatabase;
let server: ReturnType<ReturnType<typeof createApp>["listen"]>;
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

const taskInput = {
  title: "Prepare renewal review",
  description: "Confirm decision makers and next steps.",
  assigneeMembershipId: "membership_member",
  dueAt: "2026-02-10T10:30:00+01:00",
  priority: "high",
  companyId: "company_northstar_01",
  contactId: "contact_northstar_01",
  dealId: "deal_northstar_01",
};

const request = (cookie: string, path = "", init: RequestInit = {}) =>
  fetch(`${baseUrl}/api/tasks${path}`, {
    ...init,
    headers: {
      cookie,
      ...(init.body ? { "content-type": "application/json" } : {}),
      ...init.headers,
    },
  });

describe.sequential("task API", () => {
  it("creates, normalizes UTC, updates and executes versioned lifecycle actions", async () => {
    const member = await signIn("member@northstar.test", "MemberPass!2026");
    const createdResponse = await request(member, "", {
      method: "POST",
      body: JSON.stringify(taskInput),
    });
    expect(createdResponse.status).toBe(201);
    const created = (await createdResponse.json()) as {
      task: { id: string; dueAt: string; version: number };
      history: unknown[];
    };
    expect(created.task.dueAt).toBe("2026-02-10T09:30:00.000Z");
    expect(created.history).toHaveLength(1);

    const updatedResponse = await request(member, `/${created.task.id}`, {
      method: "PUT",
      body: JSON.stringify({
        ...taskInput,
        title: "Prepare signed renewal",
        status: "in_progress",
        version: created.task.version,
      }),
    });
    expect(updatedResponse.status).toBe(200);
    const updated = (await updatedResponse.json()) as {
      task: { status: string; version: number };
    };
    expect(updated.task.version).toBe(2);
    expect(updated.task.status).toBe("in_progress");
    const stale = await request(member, `/${created.task.id}`, {
      method: "PUT",
      body: JSON.stringify({ ...taskInput, version: 1 }),
    });
    expect(stale.status).toBe(409);
    expect(await stale.json()).toMatchObject({ code: "VERSION_CONFLICT" });

    const completedResponse = await request(
      member,
      `/${created.task.id}/complete`,
      { method: "POST", body: JSON.stringify({ version: 2 }) },
    );
    const completed = (await completedResponse.json()) as {
      task: { status: string; completedAt: string; version: number };
    };
    expect(completed.task).toMatchObject({ status: "completed", version: 3 });
    expect(completed.task.completedAt).toBeTruthy();
    const reopenedResponse = await request(
      member,
      `/${created.task.id}/reopen`,
      { method: "POST", body: JSON.stringify({ version: 3 }) },
    );
    const reopened = (await reopenedResponse.json()) as {
      task: { status: string; completedAt: null; version: number };
    };
    expect(reopened.task).toMatchObject({
      status: "open",
      completedAt: null,
      version: 4,
    });
    expect(
      (
        await request(member, `/${created.task.id}/archive`, {
          method: "POST",
          body: JSON.stringify({ version: 4 }),
        })
      ).status,
    ).toBe(200);
    const activeList = (await (
      await request(
        member,
        `?q=${encodeURIComponent("Prepare signed renewal")}`,
      )
    ).json()) as { total: number };
    const archivedList = (await (
      await request(
        member,
        `?archived=include&q=${encodeURIComponent("Prepare signed renewal")}`,
      )
    ).json()) as { total: number };
    expect(activeList.total).toBe(0);
    expect(archivedList.total).toBe(1);
    expect(
      (
        await request(member, `/${created.task.id}/restore`, {
          method: "POST",
          body: JSON.stringify({ version: 5 }),
        })
      ).status,
    ).toBe(200);
  });

  it("derives UTC overdue, today, upcoming, and assigned-to-me views at boundaries", () => {
    const service = new TaskService(
      database,
      () => new Date("2026-02-10T12:00:00.000Z"),
    );
    const identity = {
      organizationId: "org_northstar",
      membershipId: "membership_member",
    } as SessionIdentity;
    database
      .prepare(
        "UPDATE tasks SET due_at = ?, assignee_membership_id = ? WHERE id = ?",
      )
      .run(
        "2026-02-10T11:59:59.000Z",
        "membership_member",
        "task_northstar_01",
      );
    database
      .prepare("UPDATE tasks SET due_at = ? WHERE id = ?")
      .run("2026-02-10T18:00:00.000Z", "task_northstar_02");
    database
      .prepare("UPDATE tasks SET due_at = ? WHERE id = ?")
      .run("2026-02-11T00:00:00.000Z", "task_northstar_03");
    database
      .prepare("UPDATE tasks SET due_at = ? WHERE id = ?")
      .run("2026-02-10T23:59:59.999Z", "task_northstar_04");
    expect(
      service
        .list(identity, new URLSearchParams("view=overdue&pageSize=100"))
        .items.map(({ id }) => id),
    ).toContain("task_northstar_01");
    expect(
      service
        .list(identity, new URLSearchParams("view=today&pageSize=100"))
        .items.map(({ id }) => id),
    ).toEqual(
      expect.arrayContaining(["task_northstar_01", "task_northstar_02"]),
    );
    expect(
      service
        .list(identity, new URLSearchParams("view=upcoming&pageSize=100"))
        .items.map(({ id }) => id),
    ).toContain("task_northstar_03");
    expect(
      service
        .list(identity, new URLSearchParams("view=upcoming&pageSize=100"))
        .items.map(({ id }) => id),
    ).not.toContain("task_northstar_04");
    expect(
      service
        .list(identity, new URLSearchParams("view=today&pageSize=100"))
        .items.map(({ id }) => id),
    ).toContain("task_northstar_04");
    expect(
      service
        .list(identity, new URLSearchParams("view=assigned_to_me&pageSize=100"))
        .items.every(
          (task) => task.assigneeMembershipId === "membership_member",
        ),
    ).toBe(true);
    expect(
      service
        .list(
          identity,
          new URLSearchParams("company=company_northstar_01&pageSize=100"),
        )
        .items.every((task) => task.companyId === "company_northstar_01"),
    ).toBe(true);
  });

  it("denies viewers and keeps foreign task and relationship identifiers opaque", async () => {
    const viewer = await signIn("viewer@northstar.test", "ViewerPass!2026");
    expect(
      (
        await request(viewer, "", {
          method: "POST",
          body: JSON.stringify(taskInput),
        })
      ).status,
    ).toBe(403);
    const owner = await signIn("owner@northstar.test", "OwnerPass!2026");
    database
      .prepare(
        `INSERT INTO tasks
          (id, organization_id, assignee_membership_id, company_id, title, due_at,
           priority, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'open', ?, ?)`,
      )
      .run(
        "task_outside_01",
        "org_outside",
        "membership_outside",
        "company_outside_01",
        "Outside private task",
        "2026-02-10T10:00:00.000Z",
        "high",
        "2026-01-15T12:00:00.000Z",
        "2026-01-15T12:00:00.000Z",
      );
    const before = database
      .prepare("SELECT * FROM tasks WHERE id = 'task_outside_01'")
      .get();
    expect((await request(owner, "/task_outside_01")).status).toBe(404);
    expect(
      (
        await request(owner, "", {
          method: "POST",
          body: JSON.stringify({
            ...taskInput,
            companyId: "company_outside_01",
          }),
        })
      ).status,
    ).toBe(404);
    expect(
      database
        .prepare("SELECT * FROM tasks WHERE id = 'task_outside_01'")
        .get(),
    ).toEqual(before);
  });

  it("rejects foreign assignees and records safe audit history", async () => {
    const member = await signIn("member@northstar.test", "MemberPass!2026");
    expect(
      (
        await request(member, "", {
          method: "POST",
          body: JSON.stringify({
            ...taskInput,
            assigneeMembershipId: "membership_outside",
          }),
        })
      ).status,
    ).toBe(400);
    database
      .prepare("UPDATE memberships SET removed_at = ? WHERE id = ?")
      .run("2026-02-01T00:00:00.000Z", "membership_viewer");
    expect(
      (
        await request(member, "", {
          method: "POST",
          body: JSON.stringify({
            ...taskInput,
            assigneeMembershipId: "membership_viewer",
          }),
        })
      ).status,
    ).toBe(400);
    const created = (await (
      await request(member, "", {
        method: "POST",
        body: JSON.stringify(taskInput),
      })
    ).json()) as { task: { id: string } };
    expect(
      database
        .prepare(
          "SELECT action FROM audit_events WHERE entity_type = 'task' AND entity_id = ?",
        )
        .all(created.task.id),
    ).toEqual([{ action: "task.created" }]);
  });

  it("persists task state across a database restart", () => {
    const directory = mkdtempSync(join(tmpdir(), "northstar-task-restart-"));
    const path = join(directory, "tasks.sqlite");
    const first = openDatabase(path);
    try {
      migrate(first);
      seedDatabase(first);
      first
        .prepare(
          "UPDATE tasks SET status = 'completed', completed_at = ?, version = version + 1 WHERE id = ?",
        )
        .run("2026-02-10T12:00:00.000Z", "task_northstar_01");
    } finally {
      first.close();
    }
    const reopened = openDatabase(path);
    try {
      migrate(reopened);
      expect(
        reopened
          .prepare(
            "SELECT status, completed_at AS completedAt, version FROM tasks WHERE id = ?",
          )
          .get("task_northstar_01"),
      ).toEqual({
        status: "completed",
        completedAt: "2026-02-10T12:00:00.000Z",
        version: 2,
      });
    } finally {
      reopened.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
