# Testing Northstar CRM

`npm run ci` is the single local and hosted-CI entry point. It rejects focused,
skipped, todo, or empty suites, then runs linting, TypeScript checks, unit and
integration tests with coverage, and browser-backed accessibility checks.

Install the browser once on a new machine:

```bash
npx playwright install chromium
```

Run a failing layer directly while reproducing it:

```bash
npm run check:test-suites
npm run lint
npm run typecheck
npm test -- tests/unit/fixtures.test.ts
npm run test:browser -- --grep "critical-path"
```

Tests use operating-system temporary directories and dynamically allocated
ports. `DATABASE_PATH` identifies the per-run database. The browser runner
handles `SIGINT` and `SIGTERM`, terminates its child server, and removes the
temporary directory. Never point a test at the development or production
database.

The shared fixture anchor is `2026-01-15T12:00:00.000Z`. Add scenarios relative
to that anchor rather than the wall clock. Fixture IDs and labels are stable;
duplicate labels are intentional. Authorization mutation tests must snapshot
the foreign organization's persisted rows, make the forbidden request, assert
its generic response, and compare the rows afterward. Use
`expectRejectedWithoutForeignMutation` for that complete assertion.

Playwright traces, screenshots, and the HTML report are retained when browser
tests fail. Vitest prints coverage and writes `coverage/coverage-summary.json`.
