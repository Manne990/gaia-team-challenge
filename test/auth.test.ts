import argon2 from "@node-rs/argon2";
import Database from "better-sqlite3";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { scryptSync } from "node:crypto";
import { afterEach, beforeEach, describe, it } from "node:test";
import { createServer } from "node:http";
import {
  AuthenticationError, AuthorizationError, AuthService, MembershipConflictError, createAuthHttpHandler, migrateAuthSchema,
  type SessionIdentity,
} from "../src/server/auth/index.js";

let directory: string;
let db: Database.Database;
let clock: Date;
let auth: AuthService;

const owner: SessionIdentity = {
  sessionHash: "", userId: "user-owner", organizationId: "org-a", role: "owner",
  membershipId: "membership-owner",
  email: "owner@northstar.test", displayName: "Owner", expiresAt: "",
};

beforeEach(async () => {
  directory = mkdtempSync(join(tmpdir(), "northstar-auth-"));
  db = new Database(join(directory, "test.sqlite"));
  migrateAuthSchema(db);
  clock = new Date("2026-08-10T10:00:00.000Z");
  auth = new AuthService(db, () => clock, 60_000);
  db.prepare("INSERT INTO organizations (id, name, slug, created_at, updated_at) VALUES (?, ?, ?, ?, ?)").run("org-a", "Northstar", "northstar", clock.toISOString(), clock.toISOString());
  db.prepare("INSERT INTO organizations (id, name, slug, created_at, updated_at) VALUES (?, ?, ?, ?, ?)").run("org-b", "Outside", "outside", clock.toISOString(), clock.toISOString());
  const passwordHash = await argon2.hash("OwnerPass!2026");
  const insertUser = db.prepare("INSERT INTO users (id, email, password_hash, display_name, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)");
  insertUser.run("user-owner", "owner@northstar.test", passwordHash, "Owner", clock.toISOString(), clock.toISOString());
  insertUser.run("user-member", "member@northstar.test", passwordHash, "Member", clock.toISOString(), clock.toISOString());
  insertUser.run("user-viewer", "viewer@northstar.test", passwordHash, "Viewer", clock.toISOString(), clock.toISOString());
  insertUser.run("user-outside", "other-owner@outside.test", passwordHash, "Outside", clock.toISOString(), clock.toISOString());
  const insertMembership = db.prepare("INSERT INTO memberships (id, organization_id, user_id, role, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)");
  insertMembership.run("membership-owner", "org-a", "user-owner", "owner", clock.toISOString(), clock.toISOString());
  insertMembership.run("membership-member", "org-a", "user-member", "member", clock.toISOString(), clock.toISOString());
  insertMembership.run("membership-viewer", "org-a", "user-viewer", "viewer", clock.toISOString(), clock.toISOString());
  insertMembership.run("membership-outside", "org-b", "user-outside", "owner", clock.toISOString(), clock.toISOString());
});

afterEach(() => {
  db.close();
  rmSync(directory, { recursive: true, force: true });
});

describe("authentication", () => {
  it("accepts deterministic seeded scrypt credentials during the Argon2 transition", async () => {
    const encoded = `scrypt$16384$8$1$seed-owner-v1$${scryptSync("OwnerPass!2026", "seed-owner-v1", 64).toString("base64")}`;
    db.prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(encoded, "user-owner");
    await assert.doesNotReject(() => auth.signIn("owner@northstar.test", "OwnerPass!2026"));
  });

  it("creates an organization-bound session and stores only its digest", async () => {
    const result = await auth.signIn(" OWNER@NORTHSTAR.TEST ", "OwnerPass!2026");
    assert.equal(result.token.length, 43);
    assert.equal(result.identity.organizationId, "org-a");
    const persisted = db.prepare("SELECT token_hash AS hash FROM sessions").get() as { hash: string };
    assert.notEqual(persisted.hash, result.token);
    assert.deepEqual(auth.authenticate(result.token).role, "owner");
    assert(!readFileSync(join(directory, "test.sqlite")).includes(Buffer.from(result.token)));
  });

  it("uses the same generic failure for absent users, wrong passwords, and foreign organizations", async () => {
    for (const attempt of [
      () => auth.signIn("missing@northstar.test", "OwnerPass!2026"),
      () => auth.signIn("owner@northstar.test", "wrong-password"),
      () => auth.signIn("owner@northstar.test", "OwnerPass!2026", "org-b"),
    ]) {
      await assert.rejects(attempt, (error: unknown) => error instanceof AuthenticationError && error.message === "The email or password is incorrect.");
    }
  });

  it("rejects anonymous, expired, and revoked sessions", async () => {
    assert.throws(() => auth.authenticate(undefined), AuthenticationError);
    const expired = await auth.signIn("owner@northstar.test", "OwnerPass!2026");
    clock = new Date(clock.getTime() + 60_001);
    assert.throws(() => auth.authenticate(expired.token), AuthenticationError);
    clock = new Date("2026-08-10T10:00:00.000Z");
    const revoked = await auth.signIn("owner@northstar.test", "OwnerPass!2026");
    auth.logout(revoked.token);
    assert.throws(() => auth.authenticate(revoked.token), AuthenticationError);
  });
});

describe("authorization and tenant isolation", () => {
  it("enforces the owner, member, and viewer capability ordering", () => {
    assert.doesNotThrow(() => auth.requireRole(owner, "owner"));
    assert.doesNotThrow(() => auth.requireRole({ ...owner, role: "member" }, "member"));
    assert.throws(() => auth.requireRole({ ...owner, role: "viewer" }, "member"), AuthorizationError);
    assert.throws(() => auth.requireRole({ ...owner, role: "member" }, "owner"), AuthorizationError);
  });

  it("returns a not-found-shaped error for foreign organization identifiers", () => {
    assert.throws(
      () => auth.assertOrganization(owner, "org-b"),
      (error: unknown) => error instanceof AuthorizationError && error.message === "The requested resource was not found.",
    );
  });

  it("does not change foreign persisted state when an identifier is guessed", () => {
    const before = db.prepare("SELECT * FROM memberships WHERE organization_id = 'org-b'").all();
    assert.throws(() => auth.removeMembership(owner, "user-outside"), AuthorizationError);
    const after = db.prepare("SELECT * FROM memberships WHERE organization_id = 'org-b'").all();
    assert.deepEqual(after, before);
  });

  it("restricts membership administration to owners", () => {
    assert.throws(() => auth.addMembership({ ...owner, role: "member" }, { userId: "user-outside", role: "viewer" }), AuthorizationError);
    assert.throws(() => auth.addMembership({ ...owner, role: "viewer" }, { userId: "user-outside", role: "viewer" }), AuthorizationError);
  });

  it("lists only the authenticated owner's organization members", () => {
    const members = auth.listMemberships(owner);
    assert.equal(members.length, 3);
    assert(!members.some((member) => member.email === "other-owner@outside.test"));
  });

  it("prevents removal or demotion of the last owner transactionally", () => {
    assert.throws(() => auth.removeMembership(owner, "user-owner"), MembershipConflictError);
    assert.throws(() => auth.updateMembership(owner, "user-owner", "member"), MembershipConflictError);
    assert.equal((db.prepare("SELECT role FROM memberships WHERE user_id = 'user-owner'").get() as { role: string }).role, "owner");
  });

  it("allows owner transfer and revokes sessions when access is reduced", async () => {
    auth.updateMembership(owner, "user-member", "owner");
    auth.removeMembership(owner, "user-owner");
    assert.equal(typeof (db.prepare("SELECT removed_at AS removedAt FROM memberships WHERE user_id = 'user-owner'").get() as { removedAt: string }).removedAt, "string");
    await assert.rejects(() => auth.signIn("owner@northstar.test", "OwnerPass!2026"), AuthenticationError);
    const newOwner = { ...owner, userId: "user-member" };
    auth.updateMembership(newOwner, "user-viewer", "member");
    const memberSession = await auth.signIn("viewer@northstar.test", "OwnerPass!2026");
    auth.updateMembership(newOwner, "user-viewer", "viewer");
    assert.throws(() => auth.authenticate(memberSession.token), AuthenticationError);
  });
});

describe("authentication HTTP boundary", () => {
  it("sets an HTTP-only cookie and revokes it through logout", async () => {
    const handler = createAuthHttpHandler(auth);
    const server = createServer((request, response) => void handler(request, response));
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    try {
      const address = server.address();
      assert(address && typeof address === "object");
      const base = `http://127.0.0.1:${address.port}`;
      const signIn = await fetch(`${base}/api/auth/sign-in`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: "owner@northstar.test", password: "OwnerPass!2026" }),
      });
      assert.equal(signIn.status, 200);
      const cookie = signIn.headers.get("set-cookie");
      assert(cookie?.includes("HttpOnly"));
      assert(cookie?.includes("SameSite=Lax"));
      const session = await fetch(`${base}/api/auth/session`, { headers: { cookie: cookie!.split(";")[0]! } });
      assert.equal(session.status, 200);
      const logout = await fetch(`${base}/api/auth/logout`, { method: "POST", headers: { cookie: cookie!.split(";")[0]! } });
      assert.equal(logout.status, 204);
      const revoked = await fetch(`${base}/api/auth/session`, { headers: { cookie: cookie!.split(";")[0]! } });
      assert.equal(revoked.status, 401);
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  });

  it("rejects cross-origin state changes before credentials are processed", async () => {
    const handler = createAuthHttpHandler(auth);
    const server = createServer((request, response) => void handler(request, response));
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    try {
      const address = server.address();
      assert(address && typeof address === "object");
      const response = await fetch(`http://127.0.0.1:${address.port}/api/auth/sign-in`, {
        method: "POST", headers: { origin: "https://attacker.test", "content-type": "application/json" },
        body: JSON.stringify({ email: "owner@northstar.test", password: "OwnerPass!2026" }),
      });
      assert.equal(response.status, 403);
      assert.equal((db.prepare("SELECT count(*) AS count FROM sessions").get() as { count: number }).count, 0);
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  });
});
