# Database lifecycle

Northstar uses SQLite with forward-only SQL migrations in `src/db/migrations`.
The runtime path defaults to `data/northstar.sqlite` and can be overridden with
`NORTHSTAR_DATABASE_PATH`. Local databases and SQLite sidecar files are ignored.

`npm run db:reset` removes only the configured database and recreates the schema.
`npm run db:seed` migrates and idempotently installs deterministic product data.
Application code should call `openDatabase` and `migrate` at process startup.
Write workflows that span multiple records must use a `better-sqlite3`
transaction; thrown errors roll back the complete callback.
The production build copies committed SQL migrations beside the compiled
database module so startup does not depend on TypeScript source files.

Opaque text identifiers are application-generated. UTC timestamps use ISO 8601
text, money uses integer minor units plus a three-letter currency, enumerations
are constrained, and mutable domain records expose an integer `version` for
optimistic concurrency. Composite foreign keys carry `organization_id` through
relationships so cross-organization links fail at the database boundary.
