# Organization governance and audit

Only organization owners may use Administration or Audit. Owners can create a
new account in their organization, change roles, revoke access, and update the
organization's display name with an optimistic version check. Account creation
requires a temporary password of 12–256 characters, hashes it before storage,
and never records the password in an audit summary. Email addresses remain
globally unique; conflicts return a generic account-details message rather than
revealing another organization's membership.

An organization always retains an active owner. The last owner cannot demote or
remove themselves. After ownership is transferred, self-demotion or
self-revocation is allowed deliberately; access-changing operations revoke the
affected sessions as applicable, and removed memberships cannot authenticate.

## Audit contract

Material authentication, membership, organization, import, merge, activity,
company, contact, deal, task, and pipeline mutations append an `audit_events`
row in the same domain transaction. Each row records organization, actor
membership (when known), action, entity type and stable ID, UTC occurrence time,
the HTTP request correlation ID, and a deliberately small JSON summary. Direct
non-HTTP service calls use the explicit `system` correlation ID. Passwords,
password hashes, session tokens/digests, and complete CSV rows are excluded.

The owner-only audit API supports exact action, entity type, entity ID, actor
membership, inclusive UTC from/to, and bounded pagination filters. Organization
scope is applied before filters, counts, ordering, limit, or offset. Audit rows
have no mutable entity foreign key, so they remain after archive or merge. The
database rejects every update or delete of an audit row with append-only
triggers, and the product exposes no audit mutation route.
