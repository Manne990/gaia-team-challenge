import assert from "node:assert/strict";
import test from "node:test";
import { AuthService, AuthorizationError, hashPassword, requireOrganization, requireRole } from "../src/server/auth.js";
import { MemoryAuthStore } from "../src/server/memory-auth-store.js";
import { handleAuthRequest } from "../src/server/auth-routes.js";

async function fixture() {
  const store = new MemoryAuthStore();
  store.users.set("user-1", { id: "user-1", email: "owner@northstar.test", passwordHash: await hashPassword("OwnerPass!2026") });
  store.users.set("user-2", { id: "user-2", email: "viewer@northstar.test", passwordHash: await hashPassword("ViewerPass!2026") });
  store.memberships.push(
    { userId: "user-1", organizationId: "northstar", role: "owner" },
    { userId: "user-2", organizationId: "northstar", role: "viewer" },
  );
  let now = new Date("2026-08-05T12:00:00.000Z");
  return { store, auth: new AuthService(store, () => now), setNow: (value: Date) => { now = value; } };
}

test("sign-in uses a generic failure for unknown account and wrong password", async () => {
  const { auth } = await fixture();
  await assert.rejects(() => auth.signIn("missing@example.test", "anything"), { message: "Invalid email or password." });
  await assert.rejects(() => auth.signIn("owner@northstar.test", "incorrect"), { message: "Invalid email or password." });
});

test("sessions are opaque, organization-bound, expiring, and revocable", async () => {
  const { auth, setNow } = await fixture();
  const { token } = await auth.signIn("OWNER@northstar.test", "OwnerPass!2026");
  assert.match(token, /^[A-Za-z0-9_-]{40,}$/);
  assert.equal((await auth.authenticate(token))?.organizationId, "northstar");
  await auth.signOut(token);
  assert.equal(await auth.authenticate(token), null);
  const next = await auth.signIn("owner@northstar.test", "OwnerPass!2026");
  setNow(new Date("2026-08-13T12:00:00.000Z"));
  assert.equal(await auth.authenticate(next.token), null);
});

test("authorization derives scope from the session context", async () => {
  const { auth } = await fixture();
  const { token } = await auth.signIn("owner@northstar.test", "OwnerPass!2026");
  const actor = await auth.authenticate(token);
  requireRole(actor, "member");
  assert.throws(() => requireOrganization(actor, "outside"), AuthorizationError);
  assert.throws(() => requireRole({ ...actor!, role: "viewer" }, "member"), AuthorizationError);
});

test("only owners can administer membership and the last owner remains", async () => {
  const { auth, store } = await fixture();
  const owner = await auth.authenticate((await auth.signIn("owner@northstar.test", "OwnerPass!2026")).token);
  await assert.rejects(() => auth.removeMember(owner!, "user-1"), { message: "An organization must retain at least one owner." });
  await assert.rejects(() => auth.removeMember({ ...owner!, role: "member" }, "user-2"), AuthorizationError);
  await auth.removeMember(owner!, "user-2");
  assert.equal(await store.findMembership("user-2", "northstar"), null);
});

test("HTTP routes issue an HttpOnly session cookie and clear it on logout", async () => {
  const { auth } = await fixture();
  const signIn = await handleAuthRequest(new Request("http://crm.test/api/auth/sign-in", { method: "POST", body: JSON.stringify({ email: "owner@northstar.test", password: "OwnerPass!2026" }) }), auth);
  assert.equal(signIn?.status, 200);
  assert.match(signIn?.headers.get("set-cookie") ?? "", /HttpOnly; SameSite=Lax/);
  const invalid = await handleAuthRequest(new Request("http://crm.test/api/auth/sign-in", { method: "POST", body: JSON.stringify({ email: "unknown@test", password: "wrong" }) }), auth);
  assert.deepEqual(await invalid?.json(), { error: "Invalid email or password." });
  const logout = await handleAuthRequest(new Request("http://crm.test/api/auth/sign-out", { method: "POST", headers: { cookie: signIn!.headers.get("set-cookie")! } }), auth);
  assert.match(logout?.headers.get("set-cookie") ?? "", /Max-Age=0/);
});
