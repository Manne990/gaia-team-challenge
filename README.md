# Northstar CRM Challenge

Build the CRM described in [`docs/product-contract.md`](docs/product-contract.md).
The GitHub issue queue is the authoritative work breakdown.

This repository begins from a deliberately minimal, green baseline. The
baseline scripts prove only that the challenge repository is installable; they
are not product implementation or product acceptance.

## Required Final Commands

```bash
npm ci
npm run db:reset
npm run db:seed
npm run ci
npm run build
npm run dev -- --host 127.0.0.1 --port 4173
```

The complete product must run locally without paid services or private secrets.
Reality, CI, and external acceptance determine completion.

## Local configuration

The app has no required secrets. Copy `.env.example` only if you need to
override defaults. `HOST` defaults to `127.0.0.1`, `PORT` to `4173`, and
`CRM_DB_PATH` to `data/northstar.sqlite` relative to the repository root. The
same values can be supplied as `--host`, `--port`, and `--db-path` flags. The
database directory is created on demand and is intentionally gitignored.

```bash
npm ci
npm run db:reset
npm run db:seed
npm run dev -- --host 127.0.0.1 --port 4173
```

`npm run ci` runs formatting, TypeScript checks, unit tests, and the production
build. See [the architecture notes](docs/architecture.md) for extension points.

## Database lifecycle and recovery

The application runs migrations automatically when it opens `CRM_DB_PATH`.
`npm run db:seed` creates the database when it is absent and is idempotent for
the deterministic demo data. `npm run db:reset` **deletes and recreates** the
configured database, so use it only for local/demo recovery, never as a way to
repair production data.

To restart the service, stop it and rerun the launch command with the same
`CRM_DB_PATH`; committed records and migrations remain available. If a local
demo database is corrupt or a development migration was interrupted, stop all
processes using that file, preserve a copy if its data matters, then run:

```bash
npm run db:reset
npm run db:seed
npm run dev -- --host 127.0.0.1 --port 4173
```

For an isolated test or evaluation database, set an explicit path before each
command, for example `CRM_DB_PATH=./tmp/evaluation.sqlite npm run db:seed`.

## Demo accounts and limits

| Organization   | Email                      | Password           | Role   |
| -------------- | -------------------------- | ------------------ | ------ |
| Northstar Demo | `owner@northstar.test`     | `OwnerPass!2026`   | owner  |
| Northstar Demo | `member@northstar.test`    | `MemberPass!2026`  | member |
| Northstar Demo | `viewer@northstar.test`    | `ViewerPass!2026`  | viewer |
| Outside Demo   | `other-owner@outside.test` | `OutsidePass!2026` | owner  |

The application is intentionally a single-process local CRM backed by SQLite.
It does not provide hosted deployment, email delivery, background job workers,
or multi-process database coordination. Concurrent record edits use version
conflicts: refresh the record, reconcile the displayed values, and save again
rather than overwriting another user's committed changes.
