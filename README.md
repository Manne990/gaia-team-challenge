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
