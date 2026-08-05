# Testing Northstar CRM

`npm run ci` is the release-feedback command. It runs syntax/static checks,
unit and integration tests, and Playwright critical-path tests; it fails if a
test is skipped, focused, or if discovery finds no tests.

## Deterministic data

`tests/fixtures/crm-fixtures.mjs` is the shared fixture contract. It has two
organizations, all Northstar roles, duplicate names, dated history, pipeline
stages, due-state coverage, and more than one page of companies. Production
seeding should preserve these stable identities and tests should create a fresh
copy for each case.

## Local reproduction

Use an isolated database and port for every process. The helpers in
`tests/support/test-runtime.mjs` allocate a temporary directory/database and a
free loopback port; always call `dispose()` in `finally`. For an authorization
failure, assert both the response and a complete snapshot of the foreign
organization's persisted records with `expectDeniedWithoutSideEffects`.

When a browser test fails, run `npm run test:browser -- --grep "seeded owner"`.
The temporary browser harness is an executable infrastructure check and must be
replaced by the product server as the application becomes available. Do not
point a test at a developer database. The browser runner installs Chromium when
the runner image does not already have the matching Playwright revision.
