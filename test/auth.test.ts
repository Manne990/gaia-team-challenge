import argon2 from "@node-rs/argon2";
import Database from "better-sqlite3";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import {
  AuthenticationError, AuthorizationError, AuthService, MembershipConflictError, migrateAuthSchema,
  type SessionIdentity,
} from "../src/server/auth/index.js";

let directory: string;
let db: Database.Database;
let clock: Date;
let auth: AuthService;

const owner: SessionIdentity = {
  sessionHash: "", userId: "user-owner", organizationId: "org-a", role: "owner",
  email: "owner@northstar.test", displayName: "Owner", expiresAt: "",
};

beforeEach(async () => {
  directory = mkdtempSync(join(tmpdir(), "northstar-auth-"));
  db = new Database(join(directory, "test.sqlite"));
  migrateAuthSchema(db);
  clock = new Date("2026-08-10T10:00:00.000Z");
  auth = new AuthService(db, () => clock, 60_000);
  db.prepare("INSERT INTO organizations VALUES (?, ?, ?)").run("org-a", "Northstar", clock.toISOString());
  db.prepare("INSERT INTO organizations VALUES (?, ?, ?)").run("org-b", "Outside", clock.toISOString());
  const passwordHash = await argon2.hash("OwnerPass!2026");
  const insertUser = db.prepare("INSERT INTO users VALUES (?, ?, ?, ?, ?, NULL)");
  insertUser.run("user-owner", "owner@northstar.test", passwordHash, "Owner", clock.toISOString());
  insertUser.run("user-member", "member@northstar.test", passwordHash, "Member", clock.toISOString());
  insertUser.run("user-viewer", "viewer@northstar.test", passwordHash, "Viewer", clock.toISOString());
  insertUser.run("user-outside", "other-owner@outside.test", passwordHash, "Outside", clock.toISOString());
  const insertMembership = db.prepare("INSERT INTO memberships VALUES (?, ?, ?, ?)");
  insertMembership.run("org-a", "user-owner", "owner", clock.toISOString());
  insertMembership.run("org-a", "user-member", "member", clock.toISOString());
  insertMembership.run("org-a", "user-viewer", "viewer", clock.toISOString());
  insertMembership.run("org-b", "user-outside", "owner", clock.toISOString());
});

afterEach(() => {
  db.close();
  rmSync(directory, { recursive: true, force: true });
});

describe("authentication", () => {
  it("creates an organization-bound session and stores only its digest", async () => {
    const result = await auth.signIn(" OWNER@NORTHSTAR.TEST ", "OwnerPass!2026");
    assert.equal(result.token.length, 43);
    assert.equal(result.identity.organizationId, "org-a");
    const persisted = db.prepare("SELECT id_hash AS hash FROM sessions").get() as { hash: string };
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

  it("rejects anonymous, expired, revoked, and disabled sessions", async () => {
    assert.throws(() => auth.authenticate(undefined), AuthenticationError);
    const expired = await auth.signIn("owner@northstar.test", "OwnerPass!2026");
    clock = new Date(clock.getTime() + 60_001);
    assert.throws(() => auth.authenticate(expired.token), AuthenticationError);
    clock = new Date("2026-08-10T10:00:00.000Z");
    const revoked = await auth.signIn("owner@northstar.test", "OwnerPass!2026");
    auth.logout(revoked.token);
    assert.throws(() => auth.authenticate(revoked.token), AuthenticationError);
    const disabled = await auth.signIn("owner@northstar.test", "OwnerPass!2026");
    db.prepare("UPDATE users SET disabled_at = ? WHERE id = ?").run(clock.toISOString(), "user-owner");
    assert.throws(() => auth.authenticate(disabled.token), AuthenticationError);
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

  it("prevents removal or demotion of the last owner transactionally", () => {
    assert.throws(() => auth.removeMembership(owner, "user-owner"), MembershipConflictError);
    assert.throws(() => auth.updateMembership(owner, "user-owner", "member"), MembershipConflictError);
    assert.equal((db.prepare("SELECT role FROM memberships WHERE user_id = 'user-owner'").get() as { role: string }).role, "owner");
  });

  it("allows owner transfer and revokes sessions when access is reduced", async () => {
    auth.updateMembership(owner, "user-member", "owner");
    auth.removeMembership(owner, "user-owner");
    assert.equal(db.prepare("SELECT 1 FROM memberships WHERE user_id = 'user-owner'").get(), undefined);
    const newOwner = { ...owner, userId: "user-member" };
    auth.updateMembership(newOwner, "user-viewer", "member");
    const memberSession = await auth.signIn("viewer@northstar.test", "OwnerPass!2026");
    auth.updateMembership(newOwner, "user-viewer", "viewer");
    assert.throws(() => auth.authenticate(memberSession.token), AuthenticationError);
  });
});
