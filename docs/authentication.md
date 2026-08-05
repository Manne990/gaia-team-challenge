# Authentication boundary

Authentication is server-owned. `AuthService` accepts a persistence adapter,
hashes passwords with bcrypt, and issues 256-bit opaque session identifiers.
The browser receives only an `HttpOnly`, `SameSite=Lax` cookie; it never sends a
user, role, or organization identifier as authority.

Every protected handler must obtain `AuthenticatedUser` from
`AuthService.authenticate`, then call `requireRole` and, for a record lookup,
`requireOrganization`. Unauthorized or foreign-organization records must use
the same not-found/forbidden product policy and must not be fetched first for
existence checks.

The SQLite adapter implements `AuthStore` in the data layer. Creating sessions,
revoking sessions, and changing membership must be transactions. The adapter is
also the extension point for session cleanup and login rate-limit records.

`mountSignInForm` provides the shell with native keyboard submit, accessible
labels, a loading state, and a generic error state. A React screen mounts this
controller or reproduces these same semantics.
