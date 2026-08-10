# Hardening evidence

Issue #134 is verified through the repository-root `npm run ci` command. The
hardening checks are deterministic, run against an isolated seeded database,
and retain Playwright traces and screenshots on browser failure.

## Evidence matrix

| Risk                           | Executable evidence                                                                                                                                                                                                                                                                   |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Keyboard and semantics         | `accessibility-runtime.spec.ts` verifies the skip link, main-content focus, named modal dialog, initial dialog focus, Escape dismissal, and trigger-focus restoration. Existing Axe checks cover sign-in and the primary authenticated workflows.                                     |
| Responsive layout              | `accessibility-runtime.spec.ts` waits for every signed-in workspace at 1440×900, 1024×768, and 390×844 and asserts no document-level horizontal overflow; sign-in is checked separately at each viewport. This exposed and fixed the Tasks toolbar and mobile Administration table.   |
| Runtime failures               | A shared fixture captures application console errors, unhandled page errors, and transport failures across every Playwright workflow. Chromium diagnostics for explicitly asserted HTTP 4xx responses are excluded. Component and integration suites cover deliberate failure states. |
| Concurrent edits               | `companies.integration.test.ts` proves a stale version receives `409 VERSION_CONFLICT`, the winning update remains unchanged in SQLite, and a fresh read returns the recoverable current version. Other domain suites exercise the same visible optimistic-concurrency contract.      |
| Restart and interrupted writes | `database.test.ts` closes and reopens the SQLite file after committed seed data, and verifies a thrown multi-record transaction leaves neither record behind. Domain suites additionally reopen persisted tasks, activities, notifications, and merge redirects.                      |
| Test and dependency policy     | `check:test-suites` rejects focused, skipped, todo, and empty suites. SQLite integration files and shared-database browser workflows run serially to prevent resource and mutation races. `npm audit --audit-level=high` reports no vulnerabilities.                                  |

The complete local hardening run on 2026-08-10 passed 31 Vitest files (110
tests), 14 authentication tests, 25 serial Playwright workflows, formatting, suite-policy,
lint, browser/server type checks, production build, and the high-severity
dependency audit.
