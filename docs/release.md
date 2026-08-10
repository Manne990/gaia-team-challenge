# Release and recovery

This document is the release operator contract for Northstar CRM. The candidate
is identified by a full Git commit, not a branch name or a local working tree.

## Clean release verification

From a fresh checkout of the candidate commit, use Node.js 22 or newer and run:

```bash
npm ci
npx playwright install chromium
npm run db:reset
npm run db:seed
npm run db:seed
npm run ci
npm run build
NODE_ENV=production npm start -- --host 127.0.0.1 --port 4173
```

`npm run ci` checks formatting, suite policy, high/critical dependency
findings, lint, browser and server types, unit/integration/authentication tests,
real-browser workflows, accessibility, runtime diagnostics, and the production
build. Test files containing no executable test, as well as focused, skipped,
todo, or globally empty inventories, fail the suite-policy step.

The deterministic sign-in accounts are:

| Organization   | Email                      | Password           | Role   |
| -------------- | -------------------------- | ------------------ | ------ |
| Northstar Demo | `owner@northstar.test`     | `OwnerPass!2026`   | owner  |
| Northstar Demo | `member@northstar.test`    | `MemberPass!2026`  | member |
| Northstar Demo | `viewer@northstar.test`    | `ViewerPass!2026`  | viewer |
| Outside Demo   | `other-owner@outside.test` | `OutsidePass!2026` | owner  |

These credentials are fixtures for local verification, not production
credentials.

## Browser route and role inventory

All workspace routes require a live session. Anonymous or expired requests see
the sign-in/expired-session state. Owner, member, viewer, and outside-owner
sessions are always scoped to their own organization.

| Hash route                | Owner         | Member        | Viewer | Outside owner | Mutation policy     |
| ------------------------- | ------------- | ------------- | ------ | ------------- | ------------------- |
| `#dashboard`              | read          | read          | read   | own org       | none                |
| `#companies`, `#contacts` | CRUD          | CRUD          | read   | own org       | member+             |
| `#activities`             | CRU           | CRU           | read   | own org       | member+             |
| `#deals`, `#deals/:id`    | CRUD          | CRUD          | read   | own org       | member+             |
| `#tasks`, `#tasks/:id`    | CRUD          | CRUD          | read   | own org       | member+             |
| `#notifications`          | own           | own           | own    | own org       | personal read state |
| `#imports`                | import/export | import/export | export | own org       | imports member+     |
| `#duplicates`             | review/merge  | review/merge  | read   | own org       | merge member+       |
| `#audit`                  | read          | hidden        | hidden | own org       | owner only          |
| `#administration`         | manage        | hidden        | hidden | own org       | owner only          |

The global search and personal saved-view controls are available within the
authenticated shell. Search results, saved views, dashboard aggregates,
exports, duplicate candidates, notifications, and audit counts remain
organization-scoped.

## API authorization inventory

Public health/bootstrap endpoints disclose no CRM data. Authentication routes
support sign-in, session inspection, and logout. Authenticated route families
apply these minimum roles:

| API route family                                                                 | Minimum role and behavior                   |
| -------------------------------------------------------------------------------- | ------------------------------------------- |
| `/api/dashboard`, `/api/search`                                                  | viewer; organization-scoped reads           |
| `/api/companies`, `/api/contacts`, `/api/activities`, `/api/deals`, `/api/tasks` | viewer reads; member creates and mutations  |
| `/api/pipeline/stages`                                                           | viewer reads; owner configuration           |
| `/api/saved-views`                                                               | authenticated personal CRUD                 |
| `/api/imports`, `/api/exports`                                                   | member import; viewer filtered export       |
| `/api/duplicates`, `/api/merges`, `/api/merge-redirects`                         | viewer review/redirect reads; member merge  |
| `/api/notifications`                                                             | authenticated personal list/read/generation |
| `/api/audit`, `/api/admin/members`, `/api/admin/organization`                    | owner only                                  |

Foreign opaque identifiers return the same not-found-shaped outcome as absent
records and cannot change foreign state. Role checks are server-side; hiding a
browser control is not an authorization boundary.

## Persistence and recovery

The configured SQLite file is the durable state boundary. For backup, stop the
Northstar process and copy the database together with any `-wal` and `-shm`
sidecars, or use a SQLite-aware online backup tool. Restore only while the
process is stopped, keep the original files until the restored instance has
started successfully, and start the same or newer application version so
forward migrations can run.

If startup fails, preserve the database and sidecars, inspect the configuration
error, confirm the process can read/write the parent directory, and retry with
an explicit `--database-path`. Do not use `db:reset` for recovery: it deliberately
removes the configured database. `db:seed` is idempotent but installs fixture
data and is intended for local/test environments.

Interrupted multi-record writes roll back transactionally. After an unclean
process stop, restart against the same path; SQLite WAL recovery preserves
committed state. A visible `VERSION_CONFLICT` means another user won an
optimistic update. Refresh the record, reconcile the current values with the
pending edit, and submit again; never overwrite the database file to resolve a
record conflict.

## Known limitations

- Northstar V1 is a single-process application backed by one SQLite database;
  it does not provide multi-node coordination or hosted backup scheduling.
- Currency totals are grouped by currency and are not converted through an
  exchange-rate service.
- Notifications are generated in-app from deterministic product events; there
  is no email, SMS, or background delivery provider.
- CSV import is limited to UTF-8 company/contact files of 512 KiB and 2,000
  data rows, and a preview with any validation or duplicate warning cannot be
  committed.
- Migrations are forward-only. Restore from a verified backup to return to an
  older application version.
