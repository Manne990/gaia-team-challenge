# Application architecture

Northstar uses one Node.js/Express process as its runtime boundary. In development it mounts Vite middleware; in production it serves the compiled React assets and API from the same host and port. This avoids cross-origin configuration and keeps the required root launch command authoritative.

## Boundaries

- `src/client` owns React rendering, browser data loading, and deliberate loading, unavailable, and unexpected-error states.
- `src/server/app.ts` owns HTTP middleware, API routes, safe error responses, and request correlation IDs.
- `src/server/index.ts` composes configuration, SQLite, API, and development or production asset serving.
- `src/server/database` owns SQLite connection lifecycle and database commands. Domain code should reach persistence through repository modules added beside each future feature, not issue raw SQL from routes.
- `src/shared` contains transport contracts shared by browser and server without importing either runtime.

Future CRM capabilities should be grouped by domain under the client and server boundaries. Authentication and organization scope belong in server middleware and domain services so every read and mutation receives an explicit actor and organization context.

## Configuration and persistence

`src/server/config.ts` is the only runtime configuration parser. CLI values override environment values, which override safe local defaults. Host must be non-empty, port must be an integer from 1 through 65535, database path must be non-empty, and environment must be `development`, `production`, or `test`; invalid input stops startup with a configuration error.

SQLite uses WAL mode and foreign keys. The foundation metadata table is intentionally small: issue #119 owns the durable CRM schema, committed migrations, and complete seed lifecycle. Database files, WAL files, environment files, builds, logs, and dependencies are excluded from version control.

## Failures and extension points

Expected future domain failures should be mapped to stable API codes and appropriate HTTP statuses. Unexpected server errors return a generic message plus a request ID and log structured diagnostic context without exposing it to the browser. React shows a loading state while bootstrapping, an actionable unavailable state for transport failures, and an error boundary for unexpected render failures.

The CI workflow begins with a clean locked install, resets and seeds SQLite, then checks formatting, lint, separate browser/server types, deterministic tests, and the production build. Later issues can extend these commands without changing their repository-root contract.
