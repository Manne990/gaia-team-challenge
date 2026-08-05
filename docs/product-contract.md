# Northstar CRM V1 Product Contract

## Product Goal

Build a production-quality browser CRM for a small business sales and account
team. Users must be able to maintain organizations, customers, contacts,
activities, deals, and follow-up work without losing history or crossing
organization boundaries.

Northstar CRM should feel like a focused operational product, not a demo or a
marketing page. The first screen after sign-in is the working CRM dashboard.

## Platform Contract

- TypeScript, Node.js, and React.
- Durable SQLite database with committed migrations.
- No paid service, private API, cloud database, or secret is required.
- Current maintained dependencies with a committed lockfile.
- Data survives process restart.
- Timestamps are stored as UTC and rendered clearly for the user.
- Browser and server validation are both required for mutable data.
- IDs are stable, opaque, and not reused.

The repository root must support:

```text
npm ci
npm run db:reset
npm run db:seed
npm run ci
npm run build
npm run dev -- --host 127.0.0.1 --port 4173
```

The launch command may forward the host and port to internal packages but must
make the complete product available at the requested address. Tests must not
depend on execution order or a developer's existing database.

## Deterministic Seed

`npm run db:seed` must create these isolated accounts:

| Organization | Email | Password | Role |
| --- | --- | --- | --- |
| Northstar Demo | `owner@northstar.test` | `OwnerPass!2026` | owner |
| Northstar Demo | `member@northstar.test` | `MemberPass!2026` | member |
| Northstar Demo | `viewer@northstar.test` | `ViewerPass!2026` | viewer |
| Outside Demo | `other-owner@outside.test` | `OutsidePass!2026` | owner |

The seed also supplies enough companies, contacts, activities, deals, tasks,
and historical dates to make lists, filters, charts, pagination, and dashboard
metrics meaningfully testable. Seed execution is idempotent.

## Core Domain

### Companies

Companies have at least name, organization number or external reference,
website, phone, industry, size, address, lifecycle status, owner, tags, freeform
description, created timestamp, and updated timestamp. Lists support server-side
pagination, sorting, filters, and empty/loading/error states.

### Contacts

Contacts have at least first name, last name, email, phone, job title, owner,
status, tags, communication preference, and optional company relationship. One
company can have many contacts. Company and contact details expose their shared
history without copying mutable facts into activity records.

### Activities

Users record calls, emails, meetings, notes, and status changes. An activity has
type, subject, body/summary, occurred time, creator, optional participants,
company, contact, deal, and follow-up link. Historical entries retain creator
and occurrence facts after related records change.

### Deals And Pipeline

Deals have name, company, contacts, owner, monetary amount, currency, expected
close date, probability, stage, status, and loss reason where relevant. Pipeline
stages have stable ordering. Movement between stages is validated and recorded
as history. Both a list and visual pipeline view are required.

### Tasks

Tasks have title, description, assignee, due date/time, priority, status,
related company/contact/deal, created timestamp, and completed timestamp. Users
can find overdue, due-today, upcoming, completed, and assigned-to-me work.

## User Experience

- Quiet, information-dense operational interface.
- Persistent navigation for Dashboard, Companies, Contacts, Activities, Deals,
  Tasks, Imports, Audit, and Administration where authorized.
- Responsive at 1440x900, 1024x768, and 390x844 without page-level horizontal
  scrolling.
- Keyboard-visible focus, semantic controls, useful labels, and WCAG AA color
  contrast for primary workflows.
- Destructive actions require explicit confirmation and show consequences.
- User-facing failures explain what can be corrected without exposing secrets.
- Loading, empty, validation, forbidden, not-found, conflict, and unexpected
  failure states are deliberate rather than blank screens.

## Authentication And Authorization

- Secure password hashing through a maintained dependency.
- Server-side authenticated sessions with expiry, logout, and revocation.
- Generic sign-in errors do not disclose whether an account exists.
- Every read and mutation is scoped to the authenticated organization.
- Owners manage members and organization settings.
- Members create and edit CRM records but cannot manage membership.
- Viewers may read CRM data but cannot mutate it.
- Guessing an identifier from another organization must not reveal or mutate
  data, counts, search matches, exports, audit events, or existence details.

## Search And Views

Global search covers companies, contacts, deals, and tasks with organization
isolation and grouped results. Major lists provide combined filters, sorting,
pagination, clear-all, URL-preserved state, and saved personal views.

## Data Movement And Quality

- CSV import for companies and contacts includes mapping, preview, validation,
  duplicate warnings, partial-row error reporting, and explicit commit.
- CSV export respects active organization, authorization, and filters.
- Duplicate detection is explainable and never merges automatically.
- Explicit company and contact merge preserves history and redirects references
  without creating cross-organization relationships.

## Dashboard And Notifications

The dashboard shows evidence-derived counts and trends for pipeline value,
stage distribution, recent activity, overdue/upcoming tasks, deals closing soon,
and stale accounts. Metrics link to the filtered underlying records.

In-app notifications cover assignment, approaching/overdue task, and important
deal changes. Read state is per user. Notification generation is deterministic
and replay-safe.

## Audit And Reliability

Security-relevant and material domain changes append structured audit events
with actor, organization, action, entity reference, timestamp, and safe change
summary. Audit records cannot be edited through product APIs.

Write paths use transactions where partial state would violate invariants.
Concurrent edits use a visible conflict policy rather than silent last-write
data loss. Expected errors are stable and tested. Logs never contain passwords,
session tokens, or complete imported rows.

## Completion Boundary

The product is not complete because it looks plausible. Completion requires
all challenge issues merged and closed, exact-main CI, clean-checkout commands,
the frozen external scenarios, independent review, and exact-commit referee
attestation defined by the experiment contract.
