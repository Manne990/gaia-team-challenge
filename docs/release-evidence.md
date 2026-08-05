# Release candidate evidence

## Exact candidate procedure

From a clean checkout, run:

```bash
npm ci
npm run db:reset
npm run db:seed
npm run ci
npm run build
npm run dev -- --host 127.0.0.1 --port 4173
```

The release feedback command covers formatting, type checking, static test
inventory, server/UI/database/fixture/browser tests, and a production build.
SQLite is local and durable at `NORTHSTAR_DB_PATH` (default
`.data/northstar.sqlite`). To recover a local demonstration environment, stop
the server, run `npm run db:reset`, then `npm run db:seed`.

## Seed accounts

| Organization   | Account                  | Password         | Role   |
| -------------- | ------------------------ | ---------------- | ------ |
| Northstar Demo | owner@northstar.test     | OwnerPass!2026   | owner  |
| Northstar Demo | member@northstar.test    | MemberPass!2026  | member |
| Northstar Demo | viewer@northstar.test    | ViewerPass!2026  | viewer |
| Outside Demo   | other-owner@outside.test | OutsidePass!2026 | owner  |

## Architecture and surface review

- React/Vite supplies the browser shell; the Node HTTP server owns same-origin
  API responses and production static delivery.
- SQLite migrations and transactional services own durable domain state.
- Anonymous requests receive authentication failures; owner, member, viewer,
  and outside-organization paths are covered by authentication and domain
  isolation tests.
- Product limitations: the supplied UI is an operational shell; services and
  HTTP routes are the authoritative behavior surface for CRUD workflows.

## Verification record

Candidate verification executed on 2026-08-05: clean dependency install,
database reset, idempotent seed, complete CI suite, and production build all
passed locally. GitHub CI repeats the same command sequence for the PR. The
external referee, not this document, determines final acceptance.
