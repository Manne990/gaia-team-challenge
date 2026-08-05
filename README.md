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

## Local runtime

`npm run dev -- --host 127.0.0.1 --port 4173` starts the browser application
and its same-origin API. The equivalent configuration can be supplied with
`NORTHSTAR_HOST`, `NORTHSTAR_PORT`, and `NORTHSTAR_DB_PATH`; an invalid port
fails at startup with a clear message. The database defaults to the ignored
`./data/northstar.sqlite` path. `npm run build && npm start` runs the production
server using the same configuration.

`npm run db:reset` creates a fresh local database and `npm run db:seed` is
idempotent. `npm run ci` checks formatting, types, and isolated tests. Local
databases and environment files are ignored; use [.env.example](.env.example)
as a configuration reference.

## Foundation decisions

- React and Vite provide the browser boundary; the Node HTTP server owns API
  responses and production static delivery.
- SQLite access is centralized in `src/server/database.ts`, which applies
  forward-only numbered migrations and enables foreign keys. Domain migrations
  and transactional write services belong alongside it as the product grows.
- API errors use a stable `{ error: { code, message } }` shape. The client has
  explicit loading and unavailable states, while later feature routes can add
  validation, forbidden, conflict, and not-found handling without changing that
  contract.
