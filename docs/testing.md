# Testing Northstar CRM

Run the full feedback loop with `npm run ci`. It rejects empty, skipped,
focused, or todo test suites before running lint, static checking, unit tests,
integration tests, and browser tests.

Use `npm run test:unit`, `npm run test:integration`, or `npm run test:browser`
to reproduce a failure in one layer. Browser tests require the Chromium binary:
run `npx playwright install chromium` once after `npm ci` on a new machine.

Integration tests must allocate their own temporary database/environment and
remove it in cleanup. Authorization tests must assert both the non-disclosing
response and an unchanged foreign record after a rejected read or mutation.
Browser tests exercise owner sign-in, dashboard and company navigation, foreign
identifier isolation, and automated accessibility checks. Use
`createProductFixtures()` for the stable two-organization test graph rather
than depending on a developer database or test execution order.
