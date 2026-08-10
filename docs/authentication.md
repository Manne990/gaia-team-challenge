# Authentication and authorization contract

`AuthService` is the only source of request identity. Route handlers must read the
opaque `northstar_session` cookie, call `authenticate`, and use the returned
`organizationId` for every query. Organization, owner, role, and user values from
request bodies or query strings are never authorization facts.

Domain reads should include `organization_id = identity.organizationId` directly
in SQL. A missing row and a row owned by another organization must return the same
not-found response. Domain writes additionally call `requireRole(identity,
"member")`; membership administration calls `requireRole(identity, "owner")`.
Viewers are read-only.

Sessions contain 256 bits of random entropy. Only a SHA-256 digest is persisted;
the cookie is HTTP-only, same-site, secure in production, path-scoped to `/`, and
sent with `Cache-Control: no-store` responses. Logout and administrative access
reductions revoke persisted sessions. Expiry is checked on every request.

Membership removal and last-owner checks execute inside database transactions.
Foreign identifiers use a not-found-shaped error and tests compare the foreign
organization's persisted state before and after denied operations.

The sign-in component exposes keyboard-focusable labeled fields, a busy state,
generic invalid-credential feedback, a network failure, and an explicit expired
session notice. The application shell should render `SignInPage` after a 401 and
set its `expired` property when a previously authenticated session expires.
