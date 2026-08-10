# Northstar CRM

Northstar is the browser CRM described in [`docs/product-contract.md`](docs/product-contract.md). The architecture and extension points are summarized in [`docs/architecture.md`](docs/architecture.md).

## Local setup

Use Node.js 22 or newer. No paid service, private API, or secret is required.

```bash
npm ci
npm run db:reset
npm run db:seed
npm run ci
```

The default SQLite file is `./data/northstar.sqlite`. Reset removes that database and its WAL files before recreating the foundation metadata; seed is idempotent. Override the path with `NORTHSTAR_DATABASE_PATH` or `--database-path`:

```bash
npm run db:seed -- --database-path /tmp/northstar.sqlite
```

## Development

The root development command starts the API and Vite-powered React client on one address:

```bash
npm run dev -- --host 127.0.0.1 --port 4173
```

Host, port, and database path can also be supplied through `NORTHSTAR_HOST`, `NORTHSTAR_PORT`, and `NORTHSTAR_DATABASE_PATH`; explicit CLI flags take precedence. Copy `.env.example` as a reference, but environment files and local databases are ignored by Git.

## Production

Build and start the compiled server and client:

```bash
npm run build
NODE_ENV=production npm start -- --host 127.0.0.1 --port 4173
```

Production startup fails clearly if configuration is invalid or the client build is missing. Client-side routes fall back to the React entry point, while `/api/health` and `/api/bootstrap` expose the server foundation.

## Root commands

- `npm run db:reset` — recreate the configured local database.
- `npm run db:seed` — idempotently apply foundation seed metadata.
- `npm run format` — check formatting.
- `npm run lint` — run static lint checks.
- `npm run typecheck` — type-check browser and server boundaries.
- `npm test` — run deterministic Vitest suites.
- `npm run ci` — run formatting, lint, types, tests, and build.
- `npm run build` — build the React client and compile the Node server.
- `npm run dev` — run the complete product in development.
- `npm start` — run an existing production build.

The complete challenge requires all issue, CI, clean-checkout, review, and external acceptance gates; a passing foundation alone is not product completion.

See [`docs/testing.md`](docs/testing.md) for the deterministic fixtures,
isolated test lifecycle, CI policy, and failure-reproduction commands.

## CSV data movement

The Imports workspace accepts UTF-8 company or contact CSV files up to 512 KiB
and 2,000 data rows. Preview persists normalized rows and all row-level errors;
commit is deliberately all-or-nothing and is disabled while any validation or
duplicate warning remains. Repeating a successful commit is idempotent. CSV
exports are organization-scoped, exclude archived records, apply the supplied
list filters, use stable columns, quote CSV metacharacters, and prefix values
that spreadsheet programs could interpret as formulas.
